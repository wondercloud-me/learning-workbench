import React, {useEffect, useRef, useState} from 'react';
import {
  beginLab, declareLabHelp, labPassed, labSummary, labTask, revealLabHint, sameJson, saveLabAttempt, setLabCode,
  type LabAttempt, type LabMode, type LabRun, type LabState,
} from '../core/lab';
import {practiceUnit, practiceUnits, type LabTask} from '../data/practice-units';
import type {HelpLevel} from '../core/learning';
import {executeLab} from './lab-client';
import type {LabDraft} from '../core/browser-state';
import {Icon} from './icon';
import './lab-panel.css';

export interface LabPanelProps {
  value: LabState;
  onChange: (next: LabState) => void | Promise<void>;
  drafts?: Record<string, LabDraft>;
  onDraftChange?: (key: string, next: LabDraft) => void | Promise<void>;
  execute?: (code: string, task: LabTask, signal?: AbortSignal) => Promise<LabRun>;
}

const helpLabel = {independent: '独立尝试', hinted: '看过提示', explained: '看过讲解'};
const output = (value: unknown) => value === undefined ? 'undefined（没有返回值）' : JSON.stringify(value, null, 2);
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

function sameDraft(a?: LabDraft, b?: LabDraft): boolean {
  if (a === b) return true;
  if (!a || !b || a.explanation !== b.explanation || a.updatedAt !== b.updatedAt) return false;
  // Browser validation reconstructs objects in schema order and omits undefined
  // optional fields. Compare contract fields, with the optional keys on both sides.
  const runValue = (run: LabRun | null) => run && ({
    code: run.code, taskId: run.taskId, error: run.error, logs: run.logs,
    checks: run.checks.map(({label, passed, expected, actual, input, error}) => ({label, passed, expected, actual, input, error})),
  });
  return sameJson(runValue(a.lastRun), runValue(b.lastRun));
}

function RunReport({run, task, passed, label}: {run: LabRun; task: LabTask; passed: boolean; label: string}) {
  return <section className="lab-run" aria-label={label}>
    <div className="lab-section-title"><Icon name={passed ? 'pass' : 'error'}/><h3>{passed ? '通过当前用例' : '本次运行未通过'}</h3></div>
    {run.error && <p className="lab-error">{run.error}</p>}
    {!!run.checks.length && <ul className="lab-checks">{run.checks.map((check, index) => <li key={index}>
      <div className="lab-check-title"><Icon name={check.passed ? 'check' : 'close'}/><strong>{check.label}</strong><span>{check.passed ? '通过' : '未通过'}</span></div>
      <div className="lab-check-output"><div className="lab-check-input"><small>输入参数</small><pre>{output(check.input ?? task.cases[index]?.args)}</pre></div><div><small>预期</small><pre>{output(check.expected)}</pre></div><div><small>实际</small><pre>{check.error || output(check.actual)}</pre></div></div>
    </li>)}</ul>}
    {!!run.logs.length && <details className="lab-logs" open><summary>运行日志</summary><pre>{run.logs.join('\n')}</pre></details>}
    {passed && <p className="lab-muted">本次结果只说明这段代码通过了当前用例。写下自己的解释，再保存产出。</p>}
  </section>;
}

function AttemptRecord({attempt}: {attempt: LabAttempt}) {
  return <details className="lab-attempt">
    <summary><span>{attempt.passed ? '通过当前用例' : '未通过'} · {attempt.mode === 'practice' ? '基础任务' : '隔日变式'}</span><small>{helpLabel[attempt.helpLevel]} · {new Date(attempt.createdAt).toLocaleString('zh-CN')}</small></summary>
    <div className="lab-attempt-body"><p className="lab-muted">帮助程度：{helpLabel[attempt.helpLevel]}，按你的声明和本页提示记录。</p><h4>实际运行的代码</h4><pre><code>{attempt.code}</code></pre><h4>自己的解释</h4><p>{attempt.explanation}</p><RunReport run={attempt} task={labTask(attempt.unitId, attempt.mode)} passed={attempt.passed} label="已保存的运行结果"/></div>
  </details>;
}

export function LabPanel({value, onChange, drafts, onDraftChange, execute = executeLab}: LabPanelProps) {
  const [unitId, setUnitId] = useState(practiceUnits[0].id);
  const [mode, setMode] = useState<LabMode>('practice');
  const [run, setRun] = useState<LabRun | null>(null);
  const [historical, setHistorical] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [explanation, setExplanation] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saved, setSaved] = useState(false);
  const generation = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const savePending = useRef(false);
  const pendingAttemptIds = useRef<Record<string, string>>({});
  const composing = useRef(false);
  const mounted = useRef(true);
  const reviewActions = useRef<HTMLDivElement>(null);
  const localDrafts = useRef<Record<string, LabDraft>>({...drafts});
  const current = useRef({value, unitId, mode, explanation, drafts});
  current.current = {value, unitId, mode, explanation, drafts};
  const key = `${unitId}:${mode}`;
  const unit = practiceUnit(unitId);
  const task = labTask(unitId, mode);
  const session = value.sessions[key];
  const code = session?.code;
  const priorCode = useRef({key, code});
  const helpLevel = session?.helpLevel || (session?.hintsSeen ? 'hinted' : 'independent');
  const pendingIds = Object.values(pendingAttemptIds.current);
  const committedView = {...value, attempts: value.attempts.filter(attempt => !pendingIds.includes(attempt.id))};
  const now = new Date().toISOString();
  const summary = labSummary(committedView, unitId, now);
  const reviews = practiceUnits.filter(item => labSummary(committedView, item.id, now).transferDue);
  const attempts = committedView.attempts.filter(attempt => attempt.unitId === unitId).slice().reverse();
  const passed = !!run && labPassed(run, unitId, mode);
  const canSave = !!run && !historical && !!session && run.code === session.code && run.taskId === task.id && explanation.trim().length >= 8 && !busy && !saving && !saved;
  const activeKey = () => `${current.current.unitId}:${current.current.mode}`;

  function cancelRun() {
    generation.current += 1;
    pending.current?.abort();
    pending.current = null;
  }
  function restoreDraft(next?: LabDraft) {
    cancelRun(); composing.current = false;
    setRun(next?.lastRun || null); setHistorical(!!next?.lastRun); setBusy(false);
    setExplanation(next?.explanation || ''); setError(''); setNotice(''); setSaved(false);
  }
  function resetView() {restoreDraft();}
  function viewReview(target: string) {
    const latest = current.current;
    // Retained callbacks cannot select a view after its state/drafts were
    // replaced, or while its currently mounted navigation is unavailable.
    if (!mounted.current || savePending.current || !reviewActions.current?.isConnected
      || latest.value !== value || latest.drafts !== drafts || latest.unitId !== unitId || latest.mode !== mode) return;
    for (let parent: HTMLElement | null = reviewActions.current; parent; parent = parent.parentElement) {
      if (parent.hidden || parent.inert || parent.hasAttribute('inert') || parent instanceof HTMLDetailsElement && !parent.open) return;
    }
    const pending = Object.values(pendingAttemptIds.current);
    const committed = {...latest.value, attempts: latest.value.attempts.filter(item => !pending.includes(item.id))};
    if (!labSummary(committed, target, new Date().toISOString()).transferDue || latest.unitId === target && latest.mode === 'transfer') return;
    resetView(); setUnitId(target); setMode('transfer');
  }
  function persistDraft(nextExplanation: string, lastRun: LabRun | null) {
    const draft: LabDraft = {explanation: nextExplanation, lastRun, updatedAt: new Date().toISOString()};
    localDrafts.current[key] = draft;
    try {
      const result = onDraftChange?.(key, draft);
      if (result) void Promise.resolve(result).catch(cause => {
        if (mounted.current && activeKey() === key) setError(`草稿尚未保存：${message(cause)}`);
      });
    } catch (cause) {setError(`草稿尚未保存：${message(cause)}`);}
  }
  // Desktop callbacks can return void. Browser mutation failures keep the optimistic
  // document in the controller and are also shown beside the learner's inputs.
  function changeState(next: LabState) {
    const result = onChange(next);
    if (result) void Promise.resolve(result).catch(cause => {
      if (mounted.current && activeKey() === key) setError(`尚未保存：${message(cause)}`);
    });
  }
  useEffect(() => {
    mounted.current = true;
    return () => {mounted.current = false; generation.current += 1; pending.current?.abort();};
  }, []);
  useEffect(() => {restoreDraft(localDrafts.current[key]);}, [unitId, mode]);
  useEffect(() => {
    if (!drafts) return;
    const next = drafts[key];
    // An echo of this panel's own draft must not turn a fresh execution into history.
    const changed = !sameDraft(next, localDrafts.current[key]);
    localDrafts.current = {...drafts};
    if (changed) restoreDraft(next);
  }, [drafts]);
  useEffect(() => {
    const prior = priorCode.current;
    priorCode.current = {key, code};
    if (prior.key !== key || prior.code === code) return;
    cancelRun(); setRun(null); setHistorical(false); setBusy(false); setSaved(false);
  }, [unitId, mode, code]);

  function begin() {
    try {setError(''); changeState(beginLab(value, unitId, mode, new Date().toISOString()));}
    catch (cause) {setError(message(cause));}
  }
  function changeCode(next: string) {
    try {
      setError(''); changeState(setLabCode(value, unitId, mode, next));
      cancelRun(); setRun(null); setHistorical(false); setBusy(false); setSaved(false);
      persistDraft(explanation, null);
      setNotice('代码已修改，重新运行后才能保存此次产出。');
    } catch (cause) {setError(message(cause));}
  }
  function changeExplanation(next: string) {
    if (next.length > 20000) {setError('解释最多 20000 字符，已有内容已保留。'); return;}
    setExplanation(next); setSaved(false); setError('');
    persistDraft(next, run);
  }
  function hint() {
    try {setError(''); changeState(revealLabHint(value, unitId, mode));}
    catch (cause) {setError(message(cause));}
  }
  function declareHelp(next: HelpLevel) {
    try {setError(''); changeState(declareLabHelp(value, unitId, mode, next));}
    catch (cause) {setError(message(cause));}
  }
  function stop() {
    cancelRun(); setBusy(false); setNotice('运行已停止，可以修改代码后重新运行。');
  }
  async function runCode() {
    if (!session || busy || saving || composing.current || pending.current) return;
    cancelRun();
    const request = generation.current;
    const controller = new AbortController();
    pending.current = controller;
    const submittedCode = session.code;
    const submittedUnit = unitId;
    const submittedMode = mode;
    setBusy(true); setRun(null); setHistorical(false); setError(''); setNotice(''); setSaved(false);
    persistDraft(current.current.explanation, null);
    const isCurrent = () => mounted.current && generation.current === request && !controller.signal.aborted && current.current.unitId === submittedUnit && current.current.mode === submittedMode && current.current.value.sessions[`${submittedUnit}:${submittedMode}`]?.code === submittedCode;
    try {
      const result = await execute(submittedCode, task, controller.signal);
      if (!isCurrent()) return;
      if (result.taskId !== task.id || result.code !== submittedCode) throw new Error('运行结果与当前任务或代码不一致，请重新运行。');
      setRun(result);
      persistDraft(current.current.explanation, result);
    } catch (cause) {
      if (isCurrent()) setError(message(cause));
    } finally {
      if (isCurrent()) {setBusy(false); pending.current = null;}
    }
  }
  async function save() {
    if (!run || !canSave || savePending.current || composing.current) return;
    savePending.current = true; setSaving(true); setError(''); setNotice('');
    const request = generation.current;
    try {
      // A failed browser commit still exposes its candidate in pendingDocument.
      // Reuse that attempt's identity when retrying so it is never appended twice.
      const retryId = pendingAttemptIds.current[key];
      const base = retryId ? {...value, attempts: value.attempts.filter(item => item.id !== retryId)} : value;
      const next = saveLabAttempt(base, unitId, mode, run, explanation, new Date().toISOString());
      const attempt = next.attempts[next.attempts.length - 1];
      if (retryId) attempt.id = retryId;
      pendingAttemptIds.current[key] = attempt.id;
      await onChange(next);
      delete pendingAttemptIds.current[key];
      if (mounted.current && activeKey() === key && generation.current === request) {
        setSaved(true); setNotice(passed ? '已保存此次产出，包括代码、结果、提示程度和自己的解释。' : '已保存这次未通过的尝试，可以修改代码后重试。');
      }
    } catch (cause) {
      if (mounted.current && activeKey() === key) setError(`尚未保存：${message(cause)}`);
    } finally {
      savePending.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return <div className="lab-panel">
    <header className="lab-header"><div className="lab-section-title"><Icon name="code"/><h1>动手学习</h1></div><p>先看懂一个例子，再用自己的代码完成一件事。</p><small>本机运行，无需连接模型。产出保留代码、结果和自己的解释。</small></header>
    <nav className="lab-units" aria-label="学习单元">{practiceUnits.map(item => <button key={item.id} disabled={saving} aria-pressed={unitId === item.id} className={unitId === item.id ? 'selected' : ''} onClick={() => {if (item.id !== unitId) {resetView(); setUnitId(item.id); setMode('practice');}}}><Icon name={item.id === 'functions' ? 'symbol-method' : item.id === 'lists' ? 'list-unordered' : 'server'}/><span>{item.title}</span></button>)}</nav>
    {!!reviews.length && <div className="lab-review-actions" ref={reviewActions} aria-label="可以继续的隔日变式"><h2>继续隔日变式</h2><p className="lab-muted">这些基础任务的通过产出已在之前日期保存。查看后，由你决定何时开始。</p><div>{reviews.map(item => <button key={item.id} disabled={saving} onClick={() => viewReview(item.id)}><Icon name="history"/>查看{item.title.split('：')[0]}的隔日变式</button>)}</div></div>}
    <div className="lab-content">
      <article className="lab-lesson" aria-label="本单元教材"><div className="lab-section-title"><Icon name="book"/><h2>{unit.title}</h2></div><p className="lab-outcome">现在能拿它做什么：{unit.outcome}</p>{unit.lesson.map((paragraph, index) => <p key={index}>{paragraph}</p>)}<h3>最小例子</h3><pre><code>{unit.example}</code></pre><div className="lab-example-output"><small>运行后会看到</small><pre>{unit.expected}</pre></div><div className="lab-lesson-notes"><div><h3>常见错误</h3><p>{unit.errors}</p></div><div><h3>在真实工程里的位置</h3><p>{unit.position}</p></div></div></article>
      <section className="lab-work" aria-label="动手任务"><div className="lab-mode" aria-label="任务类型"><button disabled={saving} aria-pressed={mode === 'practice'} className={mode === 'practice' ? 'selected' : ''} onClick={() => {if (mode !== 'practice') {resetView(); setMode('practice');}}}>基础任务</button><button disabled={saving} aria-pressed={mode === 'transfer'} className={mode === 'transfer' ? 'selected' : ''} onClick={() => {if (mode !== 'transfer') {resetView(); setMode('transfer');}}}>隔日变式</button></div>
        {error && <p className="lab-error" role="alert"><Icon name="error"/>{error}</p>}
        {!session ? <div className="lab-study-gate"><Icon name={mode === 'practice' ? 'book' : 'history'}/><h2>{mode === 'practice' ? '读完例子，再开始动手' : '换一天，再试一个变化'}</h2><p>{mode === 'practice' ? '先读上面的讲解、例子和常见错误。准备好了再打开任务。' : '先保存基础任务的通过结果和自己的解释。另一天再用同一知识处理变化。'}</p><button className="primary" onClick={begin}>{mode === 'practice' ? '我学过了，开始动手' : '开始隔日变式'}</button></div> : <>
          <div className="lab-task-heading"><h2>{mode === 'practice' ? '你的任务' : '隔日变式任务'}</h2><span className="lab-assistance">{helpLabel[helpLevel]}{session.hintsSeen ? ` · 提示 ${session.hintsSeen}/${task.hints.length}` : ''}</span></div><p className="lab-prompt">{task.prompt}</p><label className="lab-code-label" htmlFor="lab-code">你的代码</label><textarea id="lab-code" className="lab-code" aria-label="你的代码" spellCheck={false} autoCapitalize="off" autoCorrect="off" disabled={saving} onCompositionStart={() => {composing.current = true;}} onCompositionEnd={() => {composing.current = false;}} value={session.code} onChange={event => changeCode(event.target.value)}/>
          <div className="lab-actions"><button className="primary" disabled={busy || saving} onClick={() => void runCode()}><Icon name={busy ? 'loading' : 'play'}/>{busy ? '运行中…' : '运行代码'}</button>{busy && <button onClick={stop}><Icon name="debug-stop"/>停止运行</button>}<button disabled={saving || session.hintsSeen >= task.hints.length} onClick={hint}><Icon name="lightbulb"/>{session.hintsSeen >= task.hints.length ? '已查看全部提示' : '查看下一层提示'}</button></div>
          {!!session.hintsSeen && <aside className="lab-hints" aria-label="已查看的提示"><strong>提示会记入本次帮助程度</strong><ol>{task.hints.slice(0, session.hintsSeen).map((text, index) => <li key={index}>{text}</li>)}</ol></aside>}
          {run && <>{historical && <p className="lab-notice">上次运行的反馈已恢复。重新运行当前代码后，才能保存新的尝试。</p>}<RunReport run={run} task={task} passed={passed} label={historical ? "上次运行结果" : "本次运行结果"}/></>}
          <div className="lab-help-declaration"><label htmlFor="lab-help">其他帮助 / AI</label><select id="lab-help" aria-label="其他帮助 / AI" disabled={saving} value={helpLevel} onChange={event => declareHelp(event.target.value as HelpLevel)}><option value="independent" disabled={helpLevel !== 'independent'}>未使用其他帮助</option><option value="hinted" disabled={helpLevel === 'explained'}>使用过额外提示</option><option value="explained">看过完整讲解或 AI 答案</option></select><p className="lab-muted">如果用了外部提示、完整答案或 AI 帮助，请如实标记。帮助程度按你的声明和本页提示记录。</p></div>
          <div className="lab-explanation"><label htmlFor="lab-explanation">用自己的话解释</label><p className="lab-muted">说明输入怎样变成结果。没通过时，也可以写下观察到的问题。至少 8 个字。</p><textarea id="lab-explanation" aria-label="用自己的话解释" rows={3} disabled={saving} onCompositionStart={() => {composing.current = true;}} onCompositionEnd={() => {composing.current = false;}} value={explanation} onChange={event => changeExplanation(event.target.value)} placeholder="例如：这个参数收到什么，代码怎样处理，最后返回什么。"/><div className="lab-save-row"><small>{explanation.trim().length} 字 · 这次记为{helpLabel[helpLevel]}</small><button disabled={!canSave} onClick={() => void save()}><Icon name="save"/>{saving ? '保存中…' : saved ? '已保存此次产出' : '保存此次产出'}</button></div></div>
          {notice && <p className="lab-notice" role="status">{notice}</p>}
        </>}
      </section>
      <section className="lab-history" aria-label="尝试记录"><div className="lab-section-title"><Icon name="history"/><h2>实际产出</h2><small>{summary.attempts} 次尝试 · {summary.passed} 次通过当前用例</small></div><p className="lab-muted">用例通过不代表稳定掌握。记录保留当时的代码、结果、解释和帮助程度。</p>{summary.transferDue && <p className="lab-transfer-due"><Icon name="history"/>基础任务已在之前的日期完成，可以打开隔日变式。</p>}{summary.independentRepeated && <p className="lab-notice">已有跨日重复独立表现：基础任务和变式都有自己的代码与解释。</p>}{attempts.length ? attempts.map(attempt => <AttemptRecord key={attempt.id} attempt={attempt}/>) : <p className="lab-history-empty">还没有保存产出。学完、运行代码并写下解释后，记录会出现在这里。</p>}</section>
    </div>
  </div>;
}
