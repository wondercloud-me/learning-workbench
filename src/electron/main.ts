import {TutorialReader} from './reader';
import {createDesktopSecurity, installShellNavigationGuards} from './security';
import {TutorialStore,tutorialUrl} from '../node/tutorials';
import {sourceMaterial} from '../core/course-learning';
import { ModelOperations } from '../node/model-operations';
import { trackRequest } from '../node/usage-tracker';
import { runProjectAgent } from '../node/project-agent';
import { runConversation } from '../node/conversation';
import { usageRecord, type UsagePurpose } from '../core/usage';
import { boundToolOutput, type ContextTurn, type ConversationContext } from '../core/context-cache';
import { app, BrowserWindow, dialog, ipcMain, net, Notification, protocol, Tray, Menu, nativeImage, systemPreferences, shell } from 'electron';
import { readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import { spawn } from 'node:child_process';
import { type ChatTurn, type ModelReply } from '../core/providers';
import { validateProfile, type ApiProfile } from '../core/model-library';
import { ModelRuntime } from '../node/model-runtime';
import { openDesktopStore } from '../node/desktop-store';
import { createQuitCoordinator } from '../node/quit-coordinator';
import type { AppState } from '../core/state';
import { readBackup } from '../core/backup';
import { personalInstruction } from '../core/preferences';
import { LocalVoiceService } from '../node/voice';
import {desktopAppId, desktopToastClsid} from '../core/system-controls';
import {LoginControls, NotificationControls} from '../node/system-controls';
import { applyDiff, closeProject, copyProject, dockerRun, listFiles, preflight, projectDiff, projectTopEntries, safeProjectPath, type ProjectSession } from '../node/projects';

// Set stable Windows identity before any native notification API or window creation.
if (process.platform === 'win32') {app.setAppUserModelId(desktopAppId); app.setToastActivatorCLSID(desktopToastClsid);}
protocol.registerSchemesAsPrivileged([{ scheme: 'growth', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
const desktopSecurity = createDesktopSecurity({isPackaged: app.isPackaged, devServerUrl: process.env.VITE_DEV_SERVER_URL});

// Development QA uses an isolated data folder and Chromium's synthetic audio device.
if (!app.isPackaged && process.env.GROWTH_WORKBENCH_TEST_DATA) app.setPath('userData', path.resolve(process.env.GROWTH_WORKBENCH_TEST_DATA));
const voice = new LocalVoiceService(app.isPackaged ? path.join(process.resourcesPath, 'speech') : path.resolve('resources/speech'));
let store: Awaited<ReturnType<typeof openDesktopStore>>;
let window: BrowserWindow | null = null;
let reader:TutorialReader|null=null;
let previewWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let forceQuit = false;
const currentState = () => store.snapshot().document.state;
let session: ProjectSession | null = null;
let chosenRoot: string | null = null;
const models = new ModelRuntime();
const modelOperations = new ModelOperations();
const tutorials = new TutorialStore(path.join(app.getPath('userData'),'tutorial-cache'));
let previewContainer: string | null = null;

const stateFile = () => path.join(app.getPath('userData'), 'document-v1.json');
const reminderFile = () => path.join(app.getPath('userData'), 'reminder.json');
const loginFile = () => path.join(app.getPath('userData'), 'login.json');
const loginControls = new LoginControls({platform: process.platform, isPackaged: app.isPackaged, execPath: process.execPath,
  storage: {read: () => readFile(loginFile(), 'utf8'), write: text => atomicWrite(loginFile(), text)},
  api: {get: options => app.getLoginItemSettings(options), set: options => app.setLoginItemSettings(options)},
});
const notifications = new NotificationControls({
  storage: {read: () => readFile(reminderFile(), 'utf8'), write: text => atomicWrite(reminderFile(), text)},
  native: {supported: () => Notification.isSupported(), create: options => new Notification(options)},
  dailySettings: now => {
    const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
    const state=currentState();
    return {time: state.settings.reminderTime, enabled: state.settings.reminderEnabled, checkedIn: state.checkins.some(item => item.date === date), startDate: state.settings.reminderDate};
  },
  focus: () => {window?.show(); window?.focus();},
});
async function atomicWrite(file: string, data: string | Buffer) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await writeFile(temp, data);
  await rename(temp, file);
}
async function loadState() {
  store = await openDesktopStore({file:stateFile(),legacyFile:path.join(app.getPath('userData'),'state.json'),appVersion:app.getVersion()});
  if (store.recoveryFile) await dialog.showMessageBox({type:'warning',title:'学习记录需要恢复',message:'原学习记录暂时无法读取，已保留完整副本。',detail:`软件将从空白状态启动。请保留此文件，以便恢复原记录：\n${store.recoveryFile}`,buttons:['知道了']});
  await Promise.all([notifications.initialize(), loginControls.initialize()]);
}
async function persistRuntime(generation:number, change:(current:AppState)=>AppState) {
  const data=await store.runtime(generation,change);
  window?.webContents.send('runtime:update',data);
}
const quitCoordinator=createQuitCoordinator({
  requestFlush:token=>{
    if(!window || window.isDestroyed() || window.webContents.isDestroyed())throw Error('学习页面不可用，无法确认草稿已保存。');
    window.webContents.send('app:quit-request',token);
  },
  // Do not discard a model request's eventual runtime record during a clean quit.
  flush:()=>modelOperations.restore(()=>store.flush()),
  confirmDiscard:async error=>{
    if(window && !window.isDestroyed())window.show();
    const result=await dialog.showMessageBox({type:'warning',title:'尚未完成保存',message:'当前输入尚未确认保存，是否取消退出？',detail:error instanceof Error?error.message:String(error),buttons:['取消退出，继续保存','放弃未保存修改并退出'],defaultId:0,cancelId:0,noLink:true});
    return result.response===1;
  },
  finish:()=>{forceQuit=true;app.quit();},
  release:token=>{if(window && !window.isDestroyed() && !window.webContents.isDestroyed())window.webContents.send('app:quit-cancelled',token);},
  timeoutMs:15000,
});

function requireSession() { if (!session) throw new Error('先选择项目并创建 Docker 工作副本'); return session; }
async function waitForPreview(url: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(700) });
      await response.body?.cancel();
      return;
    } catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  throw new Error('预览服务未在 3000 端口响应，请检查启动命令和终端输出');
}
function mainWindow() {
  window = new BrowserWindow({ width: 1500, height: 920, minWidth: 1060, minHeight: 650,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  installShellNavigationGuards(window.webContents, desktopSecurity);
  if (desktopSecurity.developmentOrigin) {
    const contents = window.webContents;
    contents.session.webRequest.onHeadersReceived({urls: [`${desktopSecurity.developmentOrigin}/*`]}, (details, callback) => {
      if (details.webContentsId !== contents.id || details.resourceType !== 'mainFrame') { callback({}); return; }
      const headers = {...details.responseHeaders};
      for (const name of Object.keys(headers)) if (name.toLowerCase() === 'content-security-policy') delete headers[name];
      headers['Content-Security-Policy'] = [desktopSecurity.contentSecurityPolicy];
      callback({responseHeaders: headers});
    });
  }
  window.webContents.session.setPermissionCheckHandler((contents, permission, _origin, details) => contents === window?.webContents && permission === 'media' && details.mediaType !== 'video');
  window.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => callback(contents === window?.webContents && permission === 'media' && 'mediaTypes' in details && !!details.mediaTypes?.length && details.mediaTypes.every(type => type === 'audio')));
  reader=new TutorialReader(window,tutorials);
  window.on('hide', () => voice.cancelAll());
  window.loadURL(desktopSecurity.launchUrl);
  window.on('close', event => { if (forceQuit) return; event.preventDefault(); if (currentState().settings.preferences.closeToTray) window?.hide(); else app.quit(); });
}

function createTray() {
  const icon = nativeImage.createFromPath(app.isPackaged ? path.join(process.resourcesPath, 'tray.png') : path.resolve('assets/tray.png'));
  if (icon.isEmpty()) throw new Error('菜单栏图标无法读取');
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('学习工作台');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开学习工作台', click: () => { window?.show(); window?.focus(); } },
    { label: '退出', click: () => app.quit() }
  ]));
  tray.on('double-click', () => window?.show());
}

function registerIpc() {
  // Every native operation belongs to the local shell, never the embedded website.
  const handle=(channel:string,handler:(event:Electron.IpcMainInvokeEvent,...args:any[])=>any)=>ipcMain.handle(channel,(event,...args)=>{
    desktopSecurity.assertTrustedIpc(event, window?.webContents);
    return handler(event,...args);
  });
  handle('reader:viewport',(_event,rect,visible)=>reader?.viewport(rect,visible));
  handle('reader:navigate',(_event,url)=>reader?.navigate(url));
  handle('reader:action',(_event,action)=>reader?.action(action));
  handle('reader:cached',(_event,url)=>tutorials.cachedLesson(url));
  const trustedVoice = (event: Electron.IpcMainInvokeEvent) => desktopSecurity.assertTrustedIpc(event, window?.webContents);
  handle('voice:status', event => { trustedVoice(event); return voice.status(); });
  handle('voice:microphone', async event => { trustedVoice(event); const status = await voice.status(); if (!status.ready) throw new Error(status.reason); voice.stopSpeaking(); if (!app.isPackaged && app.commandLine.hasSwitch('use-fake-device-for-media-stream')) return true; return process.platform === 'darwin' ? systemPreferences.askForMediaAccess('microphone') : true; });
  handle('voice:transcribe', (event, id: string, wav: ArrayBuffer) => { trustedVoice(event); return voice.transcribe(id, wav); });
  handle('voice:cancel', (event, id: string) => { trustedVoice(event); voice.cancel(id); });
  handle('voice:voices', event => { trustedVoice(event); return voice.listVoices(); });
  handle('voice:speak', (event, text: string, name: string, rate: number) => { trustedVoice(event); return voice.speak(text, name, rate); });
  handle('voice:stop', event => { trustedVoice(event); voice.stopSpeaking(); });
  handle('state:load', () => store.load());
  handle('state:save', (_event, input) => store.save(input));
  handle('state:export', (_event,generation:number) => modelOperations.restore(()=>store.export(generation,async backup=>{
    const result=await dialog.showSaveDialog({defaultPath:`学习工作台备份-${new Date().toLocaleDateString('sv-SE')}.json`,filters:[{name:'JSON',extensions:['json']}]});
    if(!result.filePath)return false;
    await atomicWrite(result.filePath,JSON.stringify(backup,null,2));return true;
  })));
  handle('state:import', (_event,generation:number) => modelOperations.restore(async()=>{
    const restored=await store.restore(generation,async()=>{
      const result=await dialog.showOpenDialog({properties:['openFile'],filters:[{name:'JSON',extensions:['json']}]});
      if(!result.filePaths[0])return null;
      return readBackup(JSON.parse(await readFile(result.filePaths[0],'utf8')));
    });
    if(restored)models.clearKeys();
    return restored;
  }));
  // Credentials remain per-profile and in memory; no key is exposed by state or backups.
  const trustedModel = (event: Electron.IpcMainInvokeEvent) => desktopSecurity.assertTrustedIpc(event, window?.webContents);
  handle('tutorial:course',(event,url:string,refresh:boolean)=>{trustedModel(event);return tutorials.course(url,refresh===true);});
  handle('tutorial:lesson',(event,url:string,refresh:boolean)=>{trustedModel(event);return tutorials.lesson(url,refresh===true);});
  handle('tutorial:pin',(event,url:string,pinned:boolean)=>{trustedModel(event);return tutorials.pin(url,pinned);});
  handle('tutorial:status',(event,url:string)=>{trustedModel(event);return tutorials.status(url);});
  handle('tutorial:stats',event=>{trustedModel(event);return tutorials.stats();});
  handle('tutorial:clear',(event,includePinned:boolean)=>{trustedModel(event);return tutorials.clear(includePinned===true);});
  handle('tutorial:external',(event,url:string)=>{trustedModel(event);return shell.openExternal(tutorialUrl(url));});
  const modelSnapshot = (input: ApiProfile, model: string) => {
    const profile = validateProfile(input);
    const selection = { profileId: profile.id, model };
    return models.snapshot({ profiles: [profile], active: selection }, selection);
  };
  handle('model:set-key', (event, profile: ApiProfile, key: string) => { trustedModel(event); models.setKey(validateProfile(profile), key); });
  handle('model:key-status', (event, profiles: ApiProfile[]) => { trustedModel(event); return Object.fromEntries(profiles.map(profile => [profile.id, models.hasKey(validateProfile(profile))])); });
  handle('model:forget-key', (event, id: string) => { trustedModel(event); models.forgetKey(id); });
  const trackedRequest = (generation:number, snapshot: ReturnType<typeof modelSnapshot>, system:string, turns:ChatTurn[], purpose:UsagePurpose, timeout=180000) => trackRequest(snapshot,system,turns,purpose,
    record=>persistRuntime(generation,current=>({...current,usageRecords:[...current.usageRecords,record]})),timeout);
  handle('model:test' , async (event, profile: ApiProfile, model: string) => modelOperations.run(async () => {
    trustedModel(event);
    const generation=store.snapshot().generation;
    const snapshot = modelSnapshot(profile, model);
    await trackedRequest(generation,snapshot,'这是接口连通性检查。请只回复 OK。', [{ role: 'user', content: 'OK' }],'test',20000);
    return `${snapshot.profile.name} / ${snapshot.settings.model} 已成功返回文本`;
  }));
  handle('model:chat', async (event, system: string, history:ContextTurn[], profile:ApiProfile, model:string, options:{scope:string;task:string;compactOnly?:boolean;purpose?:'chat'|'side';lesson?:{url:string;version:string;sectionId:string}}) => modelOperations.run(async () => {
    trustedModel(event);
    if(!options?.scope || !Array.isArray(history))throw new Error('聊天上下文缺少标识');
    const generation=store.snapshot().generation;
    const snapshot=modelSnapshot(profile,model);
    await store.flush();
    const state=currentState();
    const bound=state.columns.find(c=>c.id===options.scope)?.source;
    let task=options.task;
    if(bound && !options.compactOnly){
      const request=options.lesson;
      if(!request||request.url!==bound.url||request.version!==bound.version)throw new Error('课程教材与当前栏目不匹配');
      const document=await tutorials.lesson(bound.url);
      task+=`\n${sourceMaterial(bound,request.sectionId,document)}`;
    } else if(options.lesson)throw new Error('课程栏目已改变，请重新打开章节');
    const result=await runConversation({history,system:`${system}\n${personalInstruction(state.settings.preferences)}`,task,context:state.contexts[options.scope]??{},window:snapshot.profile.contextWindows?.[model],profileId:snapshot.profile.id,model,compactOnly:options.compactOnly,purpose:options.purpose},
      (fixed,turns,purpose)=>trackedRequest(generation,snapshot,fixed,turns,purpose),
      context=>persistRuntime(generation,current=>({...current,contexts:{...current.contexts,[options.scope]:context}})));
    return result.reply?.text ?? '较早对话已整理；原聊天和能力证据仍保留。';
  }));
  handle('project:choose', async () => { const result = await dialog.showOpenDialog({ properties: ['openDirectory'] }); if (!result.filePaths[0]) return null; chosenRoot = result.filePaths[0]; return { root: chosenRoot, entries: await projectTopEntries(chosenRoot), report: await preflight(chosenRoot) }; });
  handle('project:preflight-selection', (_event, entries: string[]) => { if (!chosenRoot) throw new Error('先选择项目'); return preflight(chosenRoot, entries); });
  handle('project:prepare', async (_event, includeSecrets: boolean, network: boolean, entries: string[]) => { if (!chosenRoot) throw new Error('先选择项目'); if (session) await closeProject(session); session = await copyProject(chosenRoot, includeSecrets, network, entries); return { root: chosenRoot, copy: session.copy }; });
  handle('project:files', () => listFiles(requireSession().copy));
  handle('project:read', async (_event, relative: string) => (await readFile(await safeProjectPath(requireSession().copy, relative), 'utf8')));
  handle('project:save', async (_event, relative: string, value: string) => { const file = await safeProjectPath(requireSession().copy, relative); if ((await stat(file)).size > 2 * 1024 * 1024) throw new Error('文件过大，不能在编辑器中保存'); await writeFile(file, value); return true; });
  handle('project:diff', () => projectDiff(requireSession()));
  handle('project:apply', (_event, paths: string[]) => applyDiff(requireSession(), paths));
  handle('project:run', (_event, command: string) => dockerRun(requireSession(), command));
  handle('project:agent', async (event, goal: string, profile: ApiProfile, model: string) => modelOperations.run(async () => {
    trustedModel(event);
    const generation=store.snapshot().generation;
    const snapshot = modelSnapshot(profile, model);
    const current = requireSession();
    return runProjectAgent(await listFiles(current.copy),goal,
      async (instruction,history)=>(await trackedRequest(generation,snapshot,instruction,history,'agent')).text,
      {read:async relative=>readFile(await safeProjectPath(current.copy,relative),'utf8'),
       write:async (relative,content)=>{const dest=await safeProjectPath(current.copy,relative,true);await mkdir(path.dirname(dest),{recursive:true});await writeFile(dest,content);},
       run:command=>dockerRun(current,command)},
      log=>window?.webContents.send('agent:log',log));
  }));
  handle('project:preview', async (_event, command: string, port: number) => {
    const current = requireSession();
    if (!current.network) throw new Error('网页预览需先为副本开启联网');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口不正确');
    if (previewContainer) spawn('docker', ['rm', '-f', previewContainer]);
    return await new Promise<string>((resolve, reject) => {
      const child = spawn('docker', ['run', '-d', '--rm', '--cpus=2', '--memory=2g', '--network=bridge', '-p', `127.0.0.1::${port}`, '-v', `${current.copy}:/workspace`, '-w', '/workspace', 'node:22-alpine', 'sh', '-lc', command]);
      let output = ''; child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => output += chunk);
      child.on('error', reject);
      child.on('close', code => {
        if (code !== 0) { reject(new Error(output)); return; }
        previewContainer = output.trim();
        const probe = spawn('docker', ['port', previewContainer, String(port)]);
        let ports = ''; probe.stdout.on('data', chunk => ports += chunk);
        probe.on('close', async () => {
          const match = ports.match(/127\.0\.0\.1:(\d+)/);
          if (!match) { reject(new Error('无法找到预览端口')); return; }
          const url = `http://127.0.0.1:${match[1]}`;
          try { await waitForPreview(url); resolve(url); }
          catch (error) { spawn('docker', ['rm', '-f', previewContainer!]); previewContainer = null; reject(error); }
        });
      });
    });
  });
  handle('preview:open', (_event, url: string) => { if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(url)) throw new Error('只允许本机预览'); previewWindow?.close(); previewWindow = new BrowserWindow({ width: 1100, height: 750, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } }); previewWindow.loadURL(url); });
  handle('app:quit', () => app.quit());
  handle('app:quit-ready', (_event,input:{token:string;generation?:number;error?:string})=>{
    if(!input || typeof input.token!=='string')throw Error('退出确认格式不正确');
    const error=typeof input.error==='string'?input.error:input.generation===store.snapshot().generation?undefined:'学习文档已改变，请重新保存后退出';
    return quitCoordinator.acknowledge(input.token,error);
  });
  handle('app:login-status', () => loginControls.status());
  handle('app:set-login', (_event, enabled: unknown) => loginControls.set(enabled));
  handle('app:reminder-status', () => notifications.status());
  handle('app:test-notification', () => notifications.test());
  handle('app:notification-test-status', () => notifications.testStatus());
}

app.whenReady().then(async () => {
  console.log('startup ready', app.isPackaged, app.getPath('userData'));
  protocol.handle('growth', async request => {
    const root = path.resolve(__dirname, '..', 'dist');
    const file = desktopSecurity.resolveGrowthAsset(request.url, root);
    if (!file) return new Response('Forbidden', { status: 403 });
    const response = await net.fetch(pathToFileURL(file).href);
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', desktopSecurity.contentSecurityPolicy);
    return new Response(response.body, {status: response.status, statusText: response.statusText, headers});
  });
  await loadState(); console.log('startup state loaded'); registerIpc(); mainWindow(); console.log('startup window created');
  try { createTray(); } catch (error) { console.error('菜单栏初始化失败', error); }
  console.log('startup tray completed');
  console.log('startup login completed');
  setInterval(() => {
    void notifications.checkDaily().catch(() => console.error('每日提醒检查失败'));
  }, 30000).unref();
}).catch(async error => { console.error('学习工作台启动失败', error); await dialog.showMessageBox({type:'error',title:'无法启动学习工作台',message:'读取本机资料失败，原文件未被覆盖。',detail:error instanceof Error?error.message:String(error)}); forceQuit=true;app.quit(); });
app.on('window-all-closed', () => {});
app.on('before-quit', event => {
  if(!forceQuit){
    event.preventDefault();
    void quitCoordinator.request().catch(error=>console.error('退出保存检查失败',error));
    return;
  }
  voice.cancelAll();
  if (previewContainer) spawn('docker', ['rm', '-f', previewContainer]);
  if (session) void closeProject(session);
});
