import React, { useEffect, useRef, useState } from 'react';
import { createDemo, demoAction, demoSteps, demoContent, type DemoAction } from '../core/quick-demo';
import { Dock, Icon } from './shell';
import { closeTab, emptyTabs, openTab, reopenTab, moveTab, type TabState, type WorkspaceTab } from '../core/tabs';
import './quick-experience.css';

const freshExperience = () => ({ ...createDemo(), planTarget: '能用自己的话说明一次 HTTP 请求发出了什么、收到了什么' });

export function QuickExperience({ onClose, onCreate, onSettings, onComplete }: {
  onClose: () => void; onCreate: () => void; onSettings: () => void; onComplete: () => void;
}) {
  const [demo, setDemo] = useState(freshExperience), [tabs, setTabs] = useState<TabState>(emptyTabs);
  const [visible, setVisible] = useState(false), [context, setContext] = useState(false), [status, setStatus] = useState('');
  const root = useRef<HTMLDivElement>(null), heading = useRef<HTMLHeadingElement>(null), scroll = useRef<HTMLDivElement>(null);
  const callbacks = useRef({onClose,onComplete}); callbacks.current={onClose,onComplete};
  const apply = (action: DemoAction) => setDemo(old => demoAction(old, action));
  const index = demoSteps.findIndex(item=>item.phase===demo.phase);
  useEffect(()=>{
    const before = document.activeElement as HTMLElement | null;
    heading.current?.focus();
    const keys = (event:KeyboardEvent)=>{
      if(event.key==='Escape'){
        if(root.current?.querySelector('.dock-add-menu,.dock-context'))return;
        if(root.current?.querySelector('.demo-context')){event.preventDefault();setContext(false);return;}
        event.preventDefault(); callbacks.current.onClose(); return;
      }
      if(event.key!=='Tab')return;
      const focusable=Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex="0"]')||[]).filter(el=>el.getClientRects().length>0);
      const first=focusable[0],last=focusable.at(-1);
      if(event.shiftKey&&(document.activeElement===first||!focusable.includes(document.activeElement as HTMLElement))){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&(document.activeElement===last||!focusable.includes(document.activeElement as HTMLElement))){event.preventDefault();first?.focus();}
    };
    document.addEventListener('keydown',keys);return()=>{document.removeEventListener('keydown',keys);before?.focus();};
  },[]);
  useEffect(()=>{ scroll.current?.scrollTo({top:0}); heading.current?.focus(); if(demo.phase==='done')callbacks.current.onComplete(); },[demo.phase]);
  function open(kind:'side'|'file') {
    const tab:WorkspaceTab=kind==='side'?{id:'demo-side',kind:'side',title:'状态码是什么意思？'}:{id:'demo-file',kind:'file',title:'request.http'};
    setTabs(old=>openTab(old,tab)); setVisible(true); setContext(false);
    if(kind==='side')apply({type:'open-side'});
  }
  function carry() {
    apply({type:'set-main-draft',value:[demo.mainDraft,`关于「${demoContent.quote}」：${demoContent.sideReply}`].filter(Boolean).join('\n\n')});
    setStatus('结论已放入体验草稿；不会自动发送。');
  }
  function next(action:DemoAction) { setStatus('');apply(action);setVisible(false); }
  function reset() {setDemo(freshExperience());setTabs(emptyTabs());setVisible(false);setStatus('');}
  const prompt = ({plan:'从目录选一个知识点',lesson:'先学一小块，看看真实动作',side:'遇到不懂的词，单独追问',answer:'现在才问一个小问题',recap:'用自己的话讲一遍',gap:'把遗漏的一小块补上',checkin:'为这次体验打个卡',done:'你已经走过一遍工作台'})[demo.phase];
  const controls = () => {
    if(demo.phase==='plan')return <button className="primary" disabled={!demo.planTarget.trim()} onClick={()=>next({type:'confirm-plan'})}>进入知识点，开始这一块<Icon name="arrow-right"/></button>;
    if(demo.phase==='lesson')return <button className="primary" disabled={!demo.responseShown} onClick={()=>next({type:'continue-lesson'})}>这块看过了，试试辅助对话<Icon name="arrow-right"/></button>;
    if(demo.phase==='side')return <button className="primary" disabled={!demo.sideOpened} onClick={()=>next({type:'continue-side'})}>继续到学后回答<Icon name="arrow-right"/></button>;
    if(demo.phase==='answer')return <button className="primary" disabled={!demo.answer.trim()} onClick={()=>next({type:'continue-answer'})}>提交体验回答</button>;
    if(demo.phase==='recap')return <button className="primary" disabled={!demo.recap.trim()} onClick={()=>next({type:'continue-recap'})}>提交我的复述</button>;
    if(demo.phase==='gap')return <button className="primary" disabled={!demo.gap.trim()} onClick={()=>next({type:'continue-gap'})}>补充好了，看看打卡</button>;
    if(demo.phase==='checkin')return <button className="primary" onClick={()=>next({type:'check-in'})}><Icon name="check"/>完成体验打卡</button>;
    return <><button onClick={onSettings}>先配置模型</button><button className="primary" onClick={onCreate}>选择我的课程<Icon name="arrow-right"/></button></>;
  };
  const renderTab = (tab:WorkspaceTab) => tab.kind==='file'?<div className="demo-tab-doc"><div className="demo-example-label">内置请求示例 · 只读</div><pre>{demoContent.request}</pre><h4>返回的内容</h4><pre>{demoContent.response}</pre><p>正式项目中，可在文件标签里编辑并保存代码。AI 改动先放入 Docker 副本，检查后再应用。</p></div>:<div className="demo-tab-doc"><div className="demo-example-label">辅助对话 · 固定示例讲解</div><blockquote>{demoContent.quote}</blockquote><p>{demoContent.sideReply}</p><label className="demo-field">试着写一句追问<textarea value={demo.sideDraft} placeholder="例如：200 和 404 有什么区别？这段草稿可以保留。" onChange={e=>apply({type:'set-side-draft',value:e.target.value})}/></label><small>体验不调用模型，这里用于试写草稿；切换或关闭标签后，重新打开仍能看到。</small><button onClick={carry}><Icon name="arrow-left"/>把示例结论带回主聊天草稿</button></div>;
  return <div className="experience-backdrop"><section className="quick-experience" role="dialog" aria-modal="true" aria-labelledby="experience-title" ref={root}>
    <header className="experience-header"><div className="experience-brand"><Icon name="compass"/><strong id="experience-title">快速体验</strong><span>约 3 分钟 · 无需 API Key</span></div><button className="experience-close" onClick={onClose}><span>退出体验</span><Icon name="close"/></button></header>
    <div className="experience-notice"><Icon name="info"/>离线交互示例 · 退出后清空本次体验输入，不计入正式能力或打卡记录。</div>
    <div className="experience-body"><nav className="experience-progress" aria-label="体验进度"><small>认识 HTTP 请求</small>{demoSteps.map((step,i)=><div key={step.phase} className={`${i===index?'current':''} ${i<index?'passed':''}`} aria-current={i===index?'step':undefined}><span>{i<index?<Icon name="check"/>:i+1}</span>{step.title}</div>)}<button className="restart-demo" onClick={reset}><Icon name="refresh"/>从头体验</button></nav>
      <div className="experience-main"><div className="experience-scroll" ref={scroll}><div className="experience-step-label">示例栏目 · 第 {index+1} / {demoSteps.length} 步</div><h2 tabIndex={-1} ref={heading}>{prompt}</h2>
        {demo.phase==='plan'&&<><p>正式使用先在中间浏览原站资料，点“教我这一节”才开启右侧 AI 教学。本体验用本地示例演示教学环节。这里示范一个 HTTP 知识点，目标和小节来自教材，无需 AI 规划。</p><label className="demo-field">这次想做到什么<input value={demo.planTarget} maxLength={200} onChange={e=>apply({type:'set-target',value:e.target.value})}/></label><div className="demo-ladder"><div><strong>1 · 看懂一次请求</strong><span>区分方法、路径和返回结果</span><small>这次先体验这一块</small></div><div><strong>2 · 在代码里发出请求</strong><span>正式学习时再推进下一块</span></div></div><div className="demo-tip"><Icon name="lightbulb"/><p>当前最重要的一步：先看清“发出了什么、收到了什么”，再进入代码。</p></div></>}
        {demo.phase==='lesson'&&<><p>{demoContent.lesson}</p><div className="demo-request"><div><strong>发送的请求</strong><button onClick={()=>open('file')}><Icon name="file-code"/>在标签页查看</button></div><pre>{demoContent.request}</pre><button className="demo-action" onClick={()=>apply({type:'show-response'})}><Icon name="play"/>{demo.responseShown?'再看一次模拟响应':'模拟发送请求'}</button>{demo.responseShown&&<div className="demo-response" role="status"><small>模拟服务器响应 · 未访问网络</small><pre>{demoContent.response}</pre><p><strong>200</strong> 是成功状态码；<strong>message</strong> 里的“你好”是具体返回内容。</p></div>}</div><p className="demo-hint">先点击“模拟发送请求”，看清结果后再继续。正式学习也会先讲解，再让你回答。</p></>}
        {demo.phase==='side'&&<><p>不懂的词可以单独问，不打断主学习流程。选中下面的“状态码”并右键，或直接点击按钮试一下。</p><div className="demo-quote" onContextMenu={event=>{const selected=window.getSelection()?.toString().trim();if(selected&&demoContent.quote.includes(selected)){event.preventDefault();setContext(true);}}}>{demoContent.quote}</div>{context&&<button className="demo-context" onClick={()=>open('side')}><Icon name="comment-discussion"/>辅助对话 · 追问选中文字</button>}<div className="demo-actions"><button onClick={()=>open('side')}><Icon name="comment-discussion"/>打开辅助对话</button><button onClick={()=>open('file')}><Icon name="file-code"/>再打开一个文件标签</button></div><p className="demo-hint">试试在右侧切换标签、点 × 关闭，再用“＋”重新打开。主聊天还在这里。</p><label className="demo-field">主聊天待发送草稿<textarea value={demo.mainDraft} disabled={!demo.sideOpened} onChange={e=>apply({type:'set-main-draft',value:e.target.value})} placeholder="在辅助对话里点“带回”，结论才会进入这里。"/></label>{status&&<div role="status" className="demo-tip"><Icon name="check"/>{status}</div>}</>}
        {demo.phase==='answer'&&<><div className="demo-coach"><small>教练 · 学过后才问</small><p>刚才收到的 <code>200</code> 状态码表示什么？</p></div><label className="demo-field">写一句自己的理解<textarea autoFocus value={demo.answer} onChange={e=>apply({type:'set-answer',value:e.target.value})} placeholder="一句话即可。体验不会给这句话评分。"/></label><details className="demo-help"><summary>回看刚才的讲解</summary><p>HTTP 状态码表达处理结果的大类，200 表示这次请求成功。</p></details></>}
        {demo.phase==='recap'&&<><div className="demo-coach"><small>教练 · 邀请复述</small><p>用自己的话说：刚才学到了什么？还有哪里不清楚？</p></div><label className="demo-field">我的复述<textarea value={demo.recap} onChange={e=>apply({type:'set-recap',value:e.target.value})} placeholder="比如提到请求、响应，以及自己还有疑问的部分。"/></label><p className="demo-hint">这里演示的是操作顺序。正式学习会把你的回答和所用提示程度一起记录，再由你确认判断。</p></>}
        {demo.phase==='gap'&&<><div className="demo-coach"><small>固定补缺示例 · 未分析你的回答</small><p>再区分一个容易混淆的地方：状态码说明“处理得怎样”，响应内容告诉你“具体得到了什么”。</p></div><div className="demo-comparison"><div><code>200</code><span>这次处理成功</span></div><div><code>{'{ "message": "你好" }'}</code><span>具体返回的数据</span></div></div><label className="demo-field">补充到刚才的理解里<textarea value={demo.gap} onChange={e=>apply({type:'set-gap',value:e.target.value})} placeholder="试着用一句话区分状态码和响应内容。"/></label><p className="demo-hint">正式学习会按你的实际回答找缺口；这次只是体验一个预设的补充步骤。</p></>}
        {demo.phase==='checkin'&&<><p>打卡记录今天有推进；能力证据来自你自己的回答、代码和调试结果。</p><div className="demo-summary"><h3>这次体验中的输入</h3><dl><dt>我的回答</dt><dd>{demo.answer}</dd><dt>我的复述</dt><dd>{demo.recap}</dd><dt>补充理解</dt><dd>{demo.gap}</dd></dl></div><div className="demo-tip"><Icon name="calendar"/><p>点下面的“体验打卡”完成流程。它不会停止今天真实的学习提醒。</p></div></>}
        {demo.phase==='done'&&<><div className="demo-finished"><Icon name="pass"/><strong>体验完成</strong><p>选知识点 → 讲解 → 独立追问 → 学后回答 → 复述 → 补缺 → 打卡</p></div><div className="demo-next"><h3>开始自己的学习，只需两步</h3><ol><li>在“设置 → 模型与接口”填入自己的 API Key。</li><li>在首页阅读菜鸟教程，点“教我这一节”；右侧点“开始当前小节讲解”。</li></ol></div><div className="demo-feature-notes"><p><Icon name="mic"/><span><strong>想用语音？</strong>聊天输入框下方点“语音输入”，识别后检查草稿再发送。</span></p><p><Icon name="unmute"/><span><strong>想听讲解？</strong>回复旁点“朗读”；设置里可自动朗读。</span></p><p><Icon name="bell"/><span><strong>想每天提醒？</strong>在“提醒与打卡”设定日期和时间。</span></p></div></>}
      </div><footer className="experience-footer"><small>{demo.phase==='done'?'随时可以从左侧“使用指南”重新体验。':demo.phase==='plan'?'进入后只推进当前这一小节。':`当前：${demoSteps[index]?.title}`}</small><div>{controls()}</div></footer></div>
      {visible&&<Dock state={tabs} onSelect={id=>setTabs(old=>({...old,activeId:id}))} onClose={ids=>setTabs(old=>ids.reduce((s,id)=>closeTab(s,id),old))} onMove={(id,before)=>setTabs(old=>moveTab(old,id,before))} onReopen={()=>setTabs(reopenTab)} onHide={()=>setVisible(false)} dirty={{}} menu={<><button disabled={demo.phase!=='side'} onClick={()=>open('side')}><Icon name="comment-discussion"/>状态码是什么意思？</button><button onClick={()=>open('file')}><Icon name="file-code"/>request.http</button></>}>{renderTab}</Dock>}
    </div>
  </section></div>;
}
