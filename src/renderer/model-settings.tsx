import React, { useRef, useState } from 'react';
import { validateProfile, type ApiProfile, type ModelLibrary, type ModelSelection } from '../core/model-library';
import { endpoint } from '../core/providers';
import { Icon } from './shell';
import './model-settings.css';

interface ModelSettingsProps {
  library: ModelLibrary;
  keyStatus: Record<string, boolean>;
  busy: boolean;
  onSave: (profile: ApiProfile, key: string) => Promise<void>;
  onSelect: (selection: ModelSelection) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onTest: (selection: ModelSelection) => Promise<string>;
}

type TemplateId = 'openai' | 'deepseek' | 'custom';
type ProfileForm = Omit<ApiProfile, 'models'> & { models: string; key: string };
const blankForm = (): ProfileForm => ({ id: '', name: '', baseUrl: '', protocol: 'chat', models: '', key: '', contextWindows: {} });
const templates: Array<{ id: TemplateId; title: string; detail: string; form: Partial<ProfileForm> }> = [
  { id: 'openai', title: 'OpenAI', detail: 'Responses API', form: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', protocol: 'responses', models: 'gpt-6-sol\ngpt-6-luna\ngpt-6-astra' } },
  { id: 'deepseek', title: 'DeepSeek', detail: 'Chat Completions', form: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', protocol: 'chat', models: 'deepseek-flash\ndeepseek-v4-pro' } },
  { id: 'custom', title: '自定义兼容接口', detail: '填写自己的服务地址', form: { protocol: 'chat' } },
];
const protocolLabel = (protocol: ApiProfile['protocol']) => protocol === 'responses' ? 'Responses' : 'Chat Completions';

/** Configuration metadata is persistent; API keys never enter this component's saved profiles. */
export function ModelSettings({ library, keyStatus, busy, onSave, onSelect, onRemove, onTest }: ModelSettingsProps) {
  const [form, setForm] = useState<ProfileForm>(blankForm);
  const [template, setTemplate] = useState<TemplateId | null>(null);
  const [editing, setEditing] = useState(false);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [testModels, setTestModels] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const requestLock = useRef(false);
  const locked = busy || working;
  const field = <K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) => setForm(current => ({ ...current, [key]: value }));
  const savedProfile = library.profiles.find(profile => profile.id === form.id);
  let connectionChanged = false;
  let requestUrl = '';
  try {
    // Preview the normalized connection even before a name or model has been entered.
    const draft = validateProfile({ id: form.id || 'preview', name: 'preview', baseUrl: form.baseUrl, protocol: form.protocol, models: ['preview'] });
    requestUrl = endpoint({ provider: 'custom', baseUrl: draft.baseUrl, customProtocol: draft.protocol, model: 'preview' }).url;
    if (savedProfile) {
      const saved = validateProfile(savedProfile);
      connectionChanged = draft.baseUrl !== saved.baseUrl || draft.protocol !== saved.protocol;
    }
  } catch { connectionChanged = !!savedProfile; }
  const canKeepKey = editing && !!keyStatus[form.id] && !connectionChanged;

  async function run(action: () => Promise<void>) {
    if (locked || requestLock.current) return;
    requestLock.current = true;
    setWorking(true); setError(''); setStatus('');
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '操作未完成，请重试。'); }
    finally { requestLock.current = false; setWorking(false); }
  }

  function chooseTemplate(id: TemplateId) {
    const selected = templates.find(item => item.id === id)!;
    setTemplate(id); setEditing(false); setForm({ ...blankForm(), ...selected.form });
    setError(''); setStatus(''); setRemoveId(null);
    requestAnimationFrame(() => nameRef.current?.focus());
  }

  function edit(profile: ApiProfile) {
    setForm({ ...profile, models: profile.models.join('\n'), key: '' });
    setTemplate(null); setEditing(true); setError(''); setStatus(''); setRemoveId(null);
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    requestAnimationFrame(() => nameRef.current?.focus({ preventScroll: true }));
  }

  function cancelEdit() {
    setForm(blankForm()); setTemplate(null); setEditing(false); setError(''); setStatus('');
  }

  function save(event: React.FormEvent) {
    event.preventDefault();
    const name = form.name.trim(), baseUrl = form.baseUrl.trim();
    const models = [...new Set(form.models.split(/[\n,，]+/).map(value => value.trim()).filter(Boolean))];
    if (!name) { setError('请填写接口名称，方便之后切换。'); return; }
    try {
      const url = new URL(baseUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    } catch { setError('请填写完整的 HTTP 或 HTTPS 基地址，不要附带 API Key、查询参数或请求路径。'); return; }
    if (!models.length) { setError('至少填写一个模型 ID；可以从接口提供方的文档中复制。'); return; }
    if (models.some(model => /\s/.test(model))) { setError('模型 ID 中不能包含空格；多个模型请分行填写。'); return; }
    const profile = validateProfile({ id: form.id || crypto.randomUUID(), name, baseUrl, protocol: form.protocol, models, contextWindows:form.contextWindows });
    const key = form.key.trim();
    void run(async () => {
      await onSave(profile, key);
      setForm({ ...profile, models: models.join('\n'), key: '' }); setTemplate(null); setEditing(true);
      setStatus(`已保存「${profile.name}」。${key || canKeepKey ? '可以在上方选择模型或测试连接。' : connectionChanged ? '地址或协议已更改，请重新填写 API Key 后再调用。' : '配置已保留，填写 API Key 后即可调用。'}`);
    });
  }

  return <div className="model-settings">
    <h2>模型与接口</h2>
    <p className="model-settings-intro">保存多个 API，在聊天中随时切换接口和模型。</p>
    <div className="model-storage-note"><Icon name="key"/><span>配置保存在本机。API Key 仅在本次运行中使用，退出应用后需要重新填写，也不会进入备份。</span></div>
    <div className="model-feedback" aria-live="polite">{error ? <p className="model-error" role="alert"><Icon name="error"/>{error}</p> : status ? <p className="model-status"><Icon name="check"/>{status}</p> : null}</div>

    <section className="configured-apis" aria-labelledby="configured-api-title">
      <div className="model-section-heading"><h3 id="configured-api-title">已配置的 API</h3><span>{library.profiles.length} 个接口</span></div>
      {!library.profiles.length && <div className="model-empty"><Icon name="plug"/><div><strong>还没有配置接口</strong><p>从下方选择模板，填写自己的 API Key 和模型，即可开始正式学习。</p></div></div>}
      <div className="api-profile-list">{library.profiles.map(profile => {
        const active = library.active?.profileId === profile.id;
        const ready = !!keyStatus[profile.id];
        const chosenTestModel = profile.models.includes(testModels[profile.id]) ? testModels[profile.id] : (active && library.active ? library.active.model : profile.models[0]);
        return <article className={`api-profile ${active ? 'is-current' : ''}`} key={profile.id} aria-label={`${profile.name} 接口`}>
          <header className="api-profile-head"><div className="api-profile-icon"><Icon name="server"/></div><div className="api-profile-title"><strong>{profile.name}</strong><span>{protocolLabel(profile.protocol)}</span></div>{active && <span className="api-current-badge"><Icon name="check"/>当前使用</span>}<button className="icon-button" disabled={locked} title={`编辑 ${profile.name}`} aria-label={`编辑 ${profile.name}`} onClick={() => edit(profile)}><Icon name="edit"/></button><button className="icon-button" disabled={locked} title={`移除 ${profile.name}`} aria-label={`移除 ${profile.name}`} onClick={() => setRemoveId(removeId === profile.id ? null : profile.id)}><Icon name="trash"/></button></header>
          <div className="api-address" title={profile.baseUrl}>{profile.baseUrl}</div>
          <div className="api-model-choices" aria-label={`${profile.name} 可用模型`}>{profile.models.map(model => {
            const selected = active && library.active?.model === model;
            return <button key={model} disabled={locked} className={selected ? 'selected' : ''} aria-pressed={selected} title={`使用 ${profile.name} / ${model}`} onClick={() => void run(async () => { await onSelect({ profileId: profile.id, model }); setStatus(`已切换到 ${profile.name} / ${model}${ready ? '。' : '，请补填此接口的 API Key。'}`); })}><Icon name={selected ? 'check' : 'hubot'}/><span>{model}</span></button>;
          })}</div>
          <footer className="api-profile-footer"><span className={`api-key-state ${ready ? 'ready' : ''}`}><Icon name={ready ? 'pass' : 'key'}/>{ready ? 'Key 已填写' : '待填写 Key'}</span><div className="api-test-controls">{profile.models.length > 1 && <select aria-label={`${profile.name} 连接测试模型`} value={chosenTestModel} disabled={locked} onChange={event => setTestModels(current => ({ ...current, [profile.id]: event.target.value }))}>{profile.models.map(model => <option key={model} value={model}>{model}</option>)}</select>}<button disabled={locked || !ready || !chosenTestModel} title={ready ? '发送一条简短测试请求，可能产生少量费用' : '请先编辑接口并填写 API Key'} onClick={() => void run(async () => { const result = await onTest({ profileId: profile.id, model: chosenTestModel }); setStatus(result); })}><Icon name="debug-disconnect"/>测试连接</button></div></footer>
          {removeId === profile.id && <div className="api-remove-confirm"><span>移除「{profile.name}」的配置和本次 Key？学习记录会保留。</span><div><button disabled={locked} onClick={() => setRemoveId(null)}>取消</button><button disabled={locked} className="model-remove-button" onClick={() => void run(async () => { await onRemove(profile.id); setRemoveId(null); if (form.id === profile.id) cancelEdit(); setStatus(`已移除「${profile.name}」。`); })}>确认移除</button></div></div>}
        </article>;
      })}</div>
      {!!library.profiles.length && <p className="api-selection-hint">点选模型后，对下一次请求生效。测试连接会发送一条简短请求。</p>}
    </section>

    <section className="api-form-section" ref={formRef} aria-labelledby="api-form-title">
      <div className="model-section-heading"><h3 id="api-form-title">{editing ? `编辑接口${form.name ? ` · ${form.name}` : ''}` : '添加 API'}</h3>{editing && <button disabled={locked} onClick={cancelEdit}><Icon name="add"/>添加新接口</button>}</div>
      {!editing && <><p className="api-template-hint">选一个模板填入默认值，或从空白开始。保存后才会加入上方列表。</p><div className="api-templates" aria-label="接口模板">{templates.map(item => <button key={item.id} disabled={locked} aria-pressed={template === item.id} className={template === item.id ? 'selected' : ''} onClick={() => chooseTemplate(item.id)}><Icon name={item.id === 'custom' ? 'settings-gear' : 'hubot'}/><span><strong>{item.title}</strong><small>{item.detail}</small></span></button>)}</div></>}
      {(editing || template) && <form className="api-config-form" onSubmit={save}>
        <div className="api-field-grid"><label className="api-field">配置名称<input ref={nameRef} value={form.name} disabled={locked} maxLength={80} placeholder="例如：我的 DeepSeek" onChange={event => field('name', event.target.value)}/></label><label className="api-field">接口协议<select value={form.protocol} disabled={locked} onChange={event => field('protocol', event.target.value as ApiProfile['protocol'])}><option value="responses">OpenAI Responses</option><option value="chat">Chat Completions</option></select></label></div>
        <label className="api-field">API 基地址<input value={form.baseUrl} disabled={locked} type="url" spellCheck={false} autoCapitalize="none" autoCorrect="off" placeholder="https://api.example.com/v1" onChange={event => field('baseUrl', event.target.value)}/><small>填写服务基地址；不需要添加 /responses 或 /chat/completions。</small>{requestUrl && <small className="api-request-preview">实际请求：<code>{requestUrl}</code></small>}</label>
        <label className="api-field">API Key <span className="api-field-optional">可稍后填写</span><input value={form.key} disabled={locked} type="password" autoComplete="off" spellCheck={false} autoCapitalize="none" autoCorrect="off" placeholder={connectionChanged ? '地址或协议已修改，请重新填写 API Key' : canKeepKey ? '已填写；留空保留本次运行中的 Key' : '粘贴此接口的 API Key'} onChange={event => field('key', event.target.value)}/><small>{connectionChanged ? '地址或协议已修改，保存后原 Key 不再沿用；调用前请重新填写。' : canKeepKey ? '留空不会清除现有 Key；填写新值后会替换。' : '未填写也可以先保存配置，调用模型前再补上。'}</small></label>
        <label className="api-field">模型 ID<textarea rows={3} value={form.models} disabled={locked} spellCheck={false} autoCapitalize="none" autoCorrect="off" placeholder={'每行一个，例如：\nmy-chat-model\nmy-reasoning-model'} onChange={event => field('models', event.target.value)}/><small>一行一个，也可以用逗号分隔。请使用接口实际支持的模型 ID。</small></label>
        <div className="context-windows"><strong>上下文窗口（可选，单位 token）</strong><small>从服务商文档填写真实窗口。已设置且接口报告输入用量时，接近 80% 自动整理；留空仅提示手动整理。</small>{[...new Set(form.models.split(/[\n,，]+/).map(x=>x.trim()).filter(Boolean))].map(model=><label key={model}>{model}<input aria-label={`${model} 上下文窗口`} type="number" min={256} max={10000000} step={1} placeholder="未知，留空" disabled={locked} value={form.contextWindows?.[model]??''} onChange={e=>field('contextWindows',{...form.contextWindows,[model]:e.target.value?Number(e.target.value):0})}/></label>)}</div>
        <div className="api-save-row"><span>保存配置不会自动发送请求。</span><button type="button" disabled={locked} onClick={cancelEdit}>取消</button><button className="primary" type="submit" disabled={locked}><Icon name={working ? 'loading' : 'save'}/>{working ? '处理中…' : editing ? '保存修改' : '保存配置'}</button></div>
      </form>}
    </section>
  </div>;
}
