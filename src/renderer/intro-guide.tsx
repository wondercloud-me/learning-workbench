import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './shell';
import './intro-guide.css';

type IntroGuideProps = {
  onClose: () => void;
  onStartDemo: () => void;
  onCreate: () => void;
  onSettings: () => void;
};

const pages = [
  { label: '学习流程', title: '先阅读，再按需请教', description: '打开原站资料自由阅读；需要解释或教学时，再请 AI 帮忙。' },
  { label: '认识界面', title: '中间读资料，右侧问 AI', description: '教程保留原站网页，AI 教学、辅助对话和文件在右侧独立标签中。' },
  { label: '常用工具', title: '按你的习惯学习', description: '可以打字，也可以说出来。准备好后，再连接真实 AI 和项目。' },
  { label: '开始使用', title: '先试一遍，再开始自己的学习', description: '快速体验会带你走过一次简短流程。也可以直接选择课程。' },
];

const learningSteps = [
  ['home', '选方向', '分类里找课程'],
  ['list-ordered', '选知识点', '查看章节小节'],
  ['book', '学一小步', '概念连着动作'],
  ['comment-discussion', '自己解释', '说出你的理解'],
  ['lightbulb', '补齐缺口', '再继续下一步'],
];

export function IntroGuide({ onClose, onStartDemo, onCreate, onSettings }: IntroGuideProps) {
  const [page, setPage] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const closeRef = useRef(onClose);
  const titleId = useId();
  const descriptionId = useId();
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
    ) ?? []).filter(element => element.getClientRects().length > 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = focusable();
      const first = controls[0];
      const last = controls[controls.length - 1];
      const active = document.activeElement;
      if (!first) {
        event.preventDefault();
        headingRef.current?.focus();
      } else if (event.shiftKey && (active === first || !controls.includes(active as HTMLElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog?.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    const keepFocusInside = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog?.contains(event.target)) headingRef.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', keepFocusInside);
    headingRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', keepFocusInside);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  useLayoutEffect(() => {
    headingRef.current?.focus();
  }, [page]);

  return <div className="intro-backdrop">
    <div className="intro-guide" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
      <header className="intro-topbar">
        <span className="intro-brand"><Icon name="book"/>学习工作台<span className="intro-brand-divider"/>入门介绍</span>
        <button className="intro-close" onClick={onClose} aria-label="关闭入门介绍" title="关闭（Esc）"><Icon name="close"/></button>
      </header>

      <div className="intro-scroll">
        <div className="intro-heading">
          <span className="intro-eyebrow">{String(page + 1).padStart(2, '0')} / 04 <span>{pages[page].label}</span></span>
          <h2 id={titleId} ref={headingRef} tabIndex={-1}>{pages[page].title}</h2>
          <p id={descriptionId}>{pages[page].description}</p>
        </div>

        {page === 0 && <section className="intro-page" aria-label="学习流程说明">
          <ol className="intro-flow">
            {learningSteps.map(([icon, title, detail], index) => <li key={title}>
              <span className="intro-step-icon"><Icon name={icon}/></span>
              <strong>{title}</strong><small>{detail}</small>
              {index < learningSteps.length - 1 && <span className="intro-flow-arrow"><Icon name="chevron-right"/></span>}
            </li>)}
          </ol>
          <div className="intro-example">
            <span className="intro-card-label">一个小目标的样子</span>
            <strong>“我想弄清楚，一次 HTTP 请求发生了什么。”</strong>
            <p>首页直接浏览菜鸟教程。需要系统学习时点“教我这一节”，在右侧逐块学请求与响应。学完后，用自己的话解释；有卡点，就把这一步讲小一点。</p>
          </div>
          <p className="intro-note"><Icon name="check"/>掌握程度依据你自己的解释、代码和运行结果。</p>
        </section>}

        {page === 1 && <section className="intro-page" aria-label="工作台界面说明">
          <div className="intro-layout-map">
            <div className="intro-map-sidebar"><span><Icon name="layout-sidebar-left"/>左侧 · 首页与栏目</span><div className="intro-map-selection">HTTP 入门</div><div className="intro-map-muted">Python 基础</div><small>每个目标有自己的进度</small></div>
            <div className="intro-map-chat"><span><Icon name="comment-discussion"/>中间 · 教程原网页</span><div className="intro-map-bubble">HTTP 请求与响应 · 目录 / 正文 / 示例</div><div className="intro-map-bubble is-user">可以自由阅读、切换章节</div><small>阅读不调用 AI，也不计掌握证据</small></div>
            <div className="intro-map-dock"><span><Icon name="layout-panel"/>右侧 · 工作区</span><div className="intro-map-tabs"><span>AI 教学</span><span>文件</span><span>终端</span><span>辅助对话</span></div><div className="intro-map-code">request → response</div><small>“＋”打开 · “×”关闭标签</small></div>
          </div>
          <div className="intro-selection-example">
            <span className="intro-selection-text"><Icon name="comment-discussion"/><span>选中文字 → 右键辅助对话<br/><mark>状态码 200</mark></span></span>
            <Icon name="arrow-right"/>
            <div className="intro-draft"><strong>辅助对话草稿</strong><span>这段话是什么意思？</span><small>检查内容后，手动发送。</small></div>
          </div>
          <p className="intro-note">辅助对话独立保存。想把结论带回教学，点“带回教学草稿”，检查后自行发送。</p>
        </section>}

        {page === 2 && <section className="intro-page intro-tools" aria-label="常用工具说明">
          <div className="intro-tool"><span className="intro-tool-icon"><Icon name="mic"/></span><div><h3>说出来，也可以听讲解</h3><p>点麦克风，把语音转成草稿后发送；点回复旁的朗读按钮，听一遍讲解。</p></div></div>
          <div className="intro-tool"><span className="intro-tool-icon"><Icon name="key"/></span><div><h3>连接你自己的 AI</h3><p>在「设置 → 模型与接口」填写自己的 API Key。快速体验无需配置，正式 AI 对话需要连接模型。</p></div></div>
          <div className="intro-tool"><span className="intro-tool-icon"><Icon name="package"/></span><div><h3>带着真实项目动手</h3><p>项目代理在 Docker 中的项目副本里操作。先检查变更，再选择应用到原项目。</p></div></div>
          <p className="intro-note">语音、外观和发送快捷键，都可以在设置里调整。</p>
        </section>}

        {page === 3 && <section className="intro-page" aria-label="开始使用学习工作台">
          <button className="intro-demo-choice" onClick={onStartDemo}>
            <span className="intro-choice-icon"><Icon name="rocket"/></span>
            <span className="intro-choice-copy"><span className="intro-choice-title">快速体验<span className="intro-tag">推荐</span></span><span>跟着 HTTP 示例，走一遍学习与辅助提问。</span><small>离线演示 · 无需 API Key · 不计入能力证据</small></span>
            <Icon name="arrow-right"/>
          </button>
          <div className="intro-other-choices">
            <button onClick={onCreate}><Icon name="add"/><span><strong>选择自己的课程</strong><small>打开网页，从分类和课程开始</small></span><Icon name="chevron-right"/></button>
            <button onClick={onSettings}><Icon name="settings-gear"/><span><strong>先设置模型</strong><small>连接 API Key，准备真实对话</small></span><Icon name="chevron-right"/></button>
          </div>
          <p className="intro-note">以后可从左下角个人菜单，再次打开入门介绍。</p>
        </section>}
      </div>

      <footer className="intro-footer">
        <button className="intro-skip" onClick={onClose}>跳过介绍</button>
        <nav className="intro-pagination" aria-label="介绍页面">
          {pages.map((item, index) => <button key={item.label} className={index === page ? 'current' : ''} onClick={() => setPage(index)} aria-label={`第 ${index + 1} 页：${item.label}`} aria-current={index === page ? 'step' : undefined}><span/></button>)}
        </nav>
        <div className="intro-navigation">
          {page > 0 && <button onClick={() => setPage(page - 1)}>上一步</button>}
          {page < pages.length - 1 ? <button className="intro-next" onClick={() => setPage(page + 1)}>下一步<Icon name="arrow-right"/></button> : <button className="intro-next" onClick={onClose}>进入工作台</button>}
        </div>
      </footer>
    </div>
  </div>;
}
