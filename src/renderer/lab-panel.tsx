import React, {useEffect, useRef, useState} from 'react';
import {
  beginLab, declareLabHelp, labPassed, labSummary, labTask, revealLabHint, saveLabAttempt, setLabCode,
  type LabAttempt, type LabMode, type LabRun, type LabState,
} from '../core/lab';
import {practiceUnit, practiceUnits, type LabTask} from '../data/practice-units';
import type {HelpLevel} from '../core/learning';
import {executeLab} from './lab-client';
import {Icon} from './shell';
import './lab-panel.css';

export interface LabPanelProps {
  value: LabState;
  onChange: (next: LabState) => void;
  execute?: (code: string, task: LabTask, signal?: AbortSignal) => Promise<LabRun>;
}

const helpLabel = {independent: '独立尝试', hinted: '看过提示', explained: '看过讲解'};
const output = (value: unknown) => value === undefined ? 'undefined（没有返回值）' : JSON.stringify(value, null, 2);
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

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

export function LabPanel({value, onChange, execute = executeLab}: LabPanelProps) {
  const [unitId, setUnitId] = useState(practiceUnits[0].id);
  const [mode, setMode] = useState<LabMode>('practice');
  const [run, setRun] = useState<LabRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [explanation, setExplanation] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saved, setSaved] = useState(false);
  const generation = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const current = useRef({value, unitId, mode});
  current.current = {value, unitId, mode};
  const unit = practiceUnit(unitId);
  const task = labTask(unitId, mode);
  const session = value.sessions[`${unitId}:${mode}`];
  const code = session?.code;
  const helpLevel = session?.helpLevel || (session?.hintsSeen ? 'hinted' : 'independent');
  const summary = labSummary(value, unitId, new Date().toISOString());
  const attempts = value.attempts.filter(attempt => attempt.unitId === unitId).slice().reverse();
  const passed = !!run && labPassed(run, unitId, mode);
  const canSave = !!run && !!session && run.code === session.code && run.taskId === task.id && explanation.trim().length >= 8 && !busy && !saved;

  function cancelRun() {
    generation.current += 1;
    pending.current?.abort();
    pending.current = null;
  }
  function resetView() {
    cancelRun();
    setRun(null); setBusy(false); setExplanation(''); setError(''); setNotice(''); setSaved(false);
  }
  useEffect(() => () => {
    generation.current += 1;
    pending.current?.abort();
  }, []);
  // Restored or externally updated code also makes an earlier result unusable.
  useEffect(() => {
    cancelRun(); setRun(null); setBusy(false); setSaved(false);
  }, [unitId, mode, code]);

  function begin() {
    try {onChange(beginLab(value, unitId, mode, new Date().toISOString())); setError('');}
    catch (cause) {setError(message(cause));}
  }
  function changeCode(next: string) {
    try {
      onChange(setLabCode(value, unitId, mode, next));
      cancelRun(); setRun(null); setBusy(false); setSaved(false); setError('');
      setNotice('代码已修改，重新运行后才能保存此次产出。');
    } catch (cause) {setError(message(cause));}
  }
  function hint() {
    try {onChange(revealLabHint(value, unitId, mode)); setError('');}
    catch (cause) {setError(message(cause));}
  }
  function declareHelp(next: HelpLevel) {
    try {onChange(declareLabHelp(value, unitId, mode, next)); setError('');}
    catch (cause) {setError(message(cause));}
  }
  async function runCode() {
    if (!session || busy) return;
    cancelRun();
    const request = generation.current;
    const controller = new AbortController();
    pending.current = controller;
    const submittedCode = session.code;
    const submittedUnit = unitId;
    const submittedMode = mode;
    setBusy(true); setRun(null); setError(''); setNotice(''); setSaved(false);
    const isCurrent = () => generation.current === request && !controller.signal.aborted && current.current.unitId === submittedUnit && current.current.mode === submittedMode && current.current.value.sessions[`${submittedUnit}:${submittedMode}`]?.code === submittedCode;
    try {
      const result = await execute(submittedCode, task, controller.signal);
      if (!isCurrent()) return;
      if (result.taskId !== task.id || result.code !== submittedCode) throw new Error('运行结果与当前任务或代码不一致，请重新运行。');
      setRun(result);
    } catch (cause) {
      if (isCurrent()) setError(message(cause));
    } finally {
      if (isCurrent()) {setBusy(false); pending.current = null;}
    }
  }
  function save() {
    if (!run || !canSave) return;
    try {
      onChange(saveLabAttempt(value, unitId, mode, run, explanation, new Date().toISOString()));
      setSaved(true); setNotice(passed ? '已保存此次产出，包括代码、结果、提示程度和自己的解释。' : '已保存这次未通过的尝试，可以修改代码后重试。'); setError('');
    } catch (cause) {setError(message(cause));}
  }

  return <div className="lab-panel">
    <header className="lab-header"><div className="lab-section-title"><Icon name="code"/><h1>动手学习</h1></div><p>先看懂一个例子，再用自己的代码完成一件事。</p><small>本机运行，无需连接模型。产出保留代码、结果和自己的解释。</small></header>
    <nav className="lab-units" aria-label="学习单元">{practiceUnits.map(item => <button key={item.id} aria-pressed={unitId === item.id} className={unitId === item.id ? 'selected' : ''} onClick={() => {if (item.id !== unitId) {resetView(); setUnitId(item.id); setMode('practice');}}}><Icon name={item.id === 'functions' ? 'symbol-method' : item.id === 'lists' ? 'list-unordered' : 'server'}/><span>{item.title}</span></button>)}</nav>
    <div className="lab-content">
      <article className="lab-lesson" aria-label="本单元教材"><div className="lab-section-title"><Icon name="book"/><h2>{unit.title}</h2></div><p className="lab-outcome">现在能拿它做什么：{unit.outcome}</p>{unit.lesson.map((paragraph, index) => <p key={index}>{paragraph}</p>)}<h3>最小例子</h3><pre><code>{unit.example}</code></pre><div className="lab-example-output"><small>运行后会看到</small><pre>{unit.expected}</pre></div><div className="lab-lesson-notes"><div><h3>常见错误</h3><p>{unit.errors}</p></div><div><h3>在真实工程里的位置</h3><p>{unit.position}</p></div></div></article>
      <section className="lab-work" aria-label="动手任务"><div className="lab-mode" aria-label="任务类型"><button aria-pressed={mode === 'practice'} className={mode === 'practice' ? 'selected' : ''} onClick={() => {if (mode !== 'practice') {resetView(); setMode('practice');}}}>基础任务</button><button aria-pressed={mode === 'transfer'} className={mode === 'transfer' ? 'selected' : ''} onClick={() => {if (mode !== 'transfer') {resetView(); setMode('transfer');}}}>隔日变式</button></div>
        {error && <p className="lab-error" role="alert"><Icon name="error"/>{error}</p>}
        {!session ? <div className="lab-study-gate"><Icon name={mode === 'practice' ? 'book' : 'history'}/><h2>{mode === 'practice' ? '读完例子，再开始动手' : '换一天，再试一个变化'}</h2><p>{mode === 'practice' ? '先读上面的讲解、例子和常见错误。准备好了再打开任务。' : '先保存基础任务的通过结果和自己的解释。另一天再用同一知识处理变化。'}</p><button className="primary" onClick={begin}>{mode === 'practice' ? '我学过了，开始动手' : '开始隔日变式'}</button></div> : <>
          <div className="lab-task-heading"><h2>{mode === 'practice' ? '你的任务' : '隔日变式任务'}</h2><span className="lab-assistance">{helpLabel[helpLevel]}{session.hintsSeen ? ` · 提示 ${session.hintsSeen}/${task.hints.length}` : ''}</span></div><p className="lab-prompt">{task.prompt}</p><label className="lab-code-label" htmlFor="lab-code">你的代码</label><textarea id="lab-code" className="lab-code" aria-label="你的代码" spellCheck={false} autoCapitalize="off" autoCorrect="off" maxLength={20000} value={session.code} onChange={event => changeCode(event.target.value)}/>
          <div className="lab-actions"><button className="primary" disabled={busy} onClick={() => void runCode()}><Icon name={busy ? 'loading' : 'play'}/>{busy ? '运行中…' : '运行代码'}</button><button disabled={session.hintsSeen >= task.hints.length} onClick={hint}><Icon name="lightbulb"/>{session.hintsSeen >= task.hints.length ? '已查看全部提示' : '查看下一层提示'}</button></div>
          {!!session.hintsSeen && <aside className="lab-hints" aria-label="已查看的提示"><strong>提示会记入本次帮助程度</strong><ol>{task.hints.slice(0, session.hintsSeen).map((text, index) => <li key={index}>{text}</li>)}</ol></aside>}
          {run && <RunReport run={run} task={task} passed={passed} label="本次运行结果"/>}
          <div className="lab-help-declaration"><label htmlFor="lab-help">其他帮助 / AI</label><select id="lab-help" aria-label="其他帮助 / AI" value={helpLevel} onChange={event => declareHelp(event.target.value as HelpLevel)}><option value="independent" disabled={helpLevel !== 'independent'}>未使用其他帮助</option><option value="hinted" disabled={helpLevel === 'explained'}>使用过额外提示</option><option value="explained">看过完整讲解或 AI 答案</option></select><p className="lab-muted">如果用了外部提示、完整答案或 AI 帮助，请如实标记。帮助程度按你的声明和本页提示记录。</p></div>
          <div className="lab-explanation"><label htmlFor="lab-explanation">用自己的话解释</label><p className="lab-muted">说明输入怎样变成结果。没通过时，也可以写下观察到的问题。至少 8 个字。</p><textarea id="lab-explanation" aria-label="用自己的话解释" rows={3} value={explanation} onChange={event => {setExplanation(event.target.value); setSaved(false);}} placeholder="例如：这个参数收到什么，代码怎样处理，最后返回什么。"/><div className="lab-save-row"><small>{explanation.trim().length} 字 · 这次记为{helpLabel[helpLevel]}</small><button disabled={!canSave} onClick={save}><Icon name="save"/>{saved ? '已保存此次产出' : '保存此次产出'}</button></div></div>
          {notice && <p className="lab-notice" role="status">{notice}</p>}
        </>}
      </section>
      <section className="lab-history" aria-label="尝试记录"><div className="lab-section-title"><Icon name="history"/><h2>实际产出</h2><small>{summary.attempts} 次尝试 · {summary.passed} 次通过当前用例</small></div><p className="lab-muted">用例通过不代表稳定掌握。记录保留当时的代码、结果、解释和帮助程度。</p>{summary.transferDue && <p className="lab-transfer-due"><Icon name="history"/>基础任务已在之前的日期完成，可以打开隔日变式。</p>}{summary.independentRepeated && <p className="lab-notice">已有跨日重复独立表现：基础任务和变式都有自己的代码与解释。</p>}{attempts.length ? attempts.map(attempt => <AttemptRecord key={attempt.id} attempt={attempt}/>) : <p className="lab-history-empty">还没有保存产出。学完、运行代码并写下解释后，记录会出现在这里。</p>}</section>
    </div>
  </div>;
}
