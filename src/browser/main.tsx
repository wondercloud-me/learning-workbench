import React from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserApp} from './app';
import {openBrowserRepository} from './repository';
import {createBrowserController} from './controller';
import {StartupRecovery} from './startup-recovery';

const root = createRoot(document.getElementById('root')!);
async function boot() {
  root.render(<div className="browser-start"><h1>学习工作台</h1><p role="status">正在读取当前浏览器的学习记录…</p></div>);
  let repository: Awaited<ReturnType<typeof openBrowserRepository>> | undefined;
  try {
    repository = await openBrowserRepository();
    const controller = await createBrowserController(repository);
    root.render(<BrowserApp controller={controller}/>);
  } catch (cause) {
    repository?.close();
    root.render(<StartupRecovery cause={cause} onRetry={() => void boot()}/>);
  }
}
void boot();
