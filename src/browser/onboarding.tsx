import React from 'react';
import {Icon} from '../renderer/icon';

export function BrowserOnboarding({onStart, onImport, error}: {onStart: () => void; onImport: () => void; error?: string}) {
  return <section className="browser-intro" aria-label="手机学习介绍">
    <div className="intro-brand"><Icon name="book"/>学习工作台</div>
    <h1>从知道，到能做</h1>
    <p>选一个知识块，先看例子，再写自己的代码。</p>
    <p className="browser-muted">三个原创 JavaScript 单元无需 API Key。首次联网下载后可离线运行。</p>
    {error && <p role="alert" className="browser-error">{error}</p>}
    <div className="browser-actions"><button className="primary" onClick={onStart}>开始学习</button><button onClick={onImport}>导入已有备份</button></div>
    <ol>
      <li><Icon name="book"/><div><h2>先看一个例子</h2><p>知道输入、过程和结果。确认读过，才会打开任务。</p></div></li>
      <li><Icon name="code"/><div><h2>写自己的代码</h2><p>在当前设备运行，看每条实际结果。卡住时再展开提示。</p></div></li>
      <li><Icon name="save"/><div><h2>说清楚，再保存</h2><p>留下代码、结果和自己的解释。记录保存在当前浏览器，可导出备份。</p></div></li>
    </ol>
    <p className="browser-muted">通过用例只是这次任务的证据。</p>
  </section>;
}
