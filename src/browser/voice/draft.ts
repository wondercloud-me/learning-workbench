import {validateBrowserDocument, type BrowserDocument, type BrowserSnapshot} from '../../core/browser-state';
import type {BrowserController} from '../controller';
import {BrowserStorageError} from '../repository';
import type {VoiceDraftPort, VoiceDraftPreview, VoiceDraftRequest, VoiceDraftTarget} from './types';

type Request = {controller: BrowserController | null; target: VoiceDraftTarget | null; applied: boolean; appending: boolean; retired: boolean};
type RequestState = {lastId: number; currentRequest?: Request};
const requests = new WeakMap<BrowserController, RequestState>();
const handles = new WeakMap<VoiceDraftRequest, Request>();
const issued = new WeakMap<VoiceDraftPreview, Request>();
const currentPreviews = new WeakMap<BrowserController, VoiceDraftPreview>();
const fields = ['page','learningView','columnId','sideId','mode','key','phase','stepId','documentGeneration','scopeVersion'] as const;
const sameTarget = (one: VoiceDraftTarget, two: VoiceDraftTarget) => fields.every(key => one[key] === two[key]);
const invalid = (message = '语音目标或草稿已变化，请重新检查。') => new BrowserStorageError('invalid', message);

function activeRequest(request: Request | undefined, controller: BrowserController): request is Request & {target: VoiceDraftTarget} {
  return !!request && request.controller === controller && requests.get(controller)?.currentRequest === request
    && !request.retired && !request.applied && request.target !== null;
}
function currentRequest(request: Request | undefined, controller: BrowserController): request is Request & {target: VoiceDraftTarget} {
  return activeRequest(request, controller) && !request.appending;
}
function retire(request: Request) {
  if (request.retired) return;
  const controller = request.controller;
  if (controller && requests.get(controller)?.currentRequest === request) {
    delete requests.get(controller)!.currentRequest;
    currentPreviews.delete(controller);
  }
  request.retired = true;
  request.target = null;
  request.controller = null;
}

/** The helper owns IDs; a controller retains only its one current request. */
export function issueVoiceDraftRequest(controller: BrowserController, target: VoiceDraftTarget): VoiceDraftRequest {
  let state = requests.get(controller);
  if (!state) {state = {lastId: -1}; requests.set(controller, state);}
  const requestId = state.lastId + 1;
  if (!Number.isSafeInteger(requestId)) throw invalid('语音请求编号已耗尽，请重新打开工作台。');
  const captured = Object.freeze({...target});
  if (state.currentRequest) retire(state.currentRequest);
  const handle = Object.freeze({requestId}) as VoiceDraftRequest;
  const request: Request = {controller, target: captured, applied: false, appending: false, retired: false};
  state.lastId = requestId;
  state.currentRequest = request;
  handles.set(handle, request);
  return handle;
}

/** Idempotent; an old request can never retire a newer one. */
export function retireVoiceDraftRequest(handle: VoiceDraftRequest): void {
  const request = handles.get(handle);
  if (request) retire(request);
}

function requireTarget(target: VoiceDraftTarget, document: BrowserDocument, controller: BrowserController, port: VoiceDraftPort) {
  const current = port.target();
  if (!current || !sameTarget(target, current) || !port.current(target)
    || target.page !== 'learn' || target.learningView !== 'teaching'
    || !Number.isSafeInteger(target.scopeVersion) || target.scopeVersion < 0
    || target.documentGeneration !== controller.documentGeneration()
    || ['conflict','unavailable'].includes(controller.storageStatus())) throw invalid();
  const column = document.state.columns.find(item => item.id === target.columnId);
  if (!document.state.onboarding.introSeen || document.state.activeColumnId !== target.columnId || !column
    || column.phase !== target.phase || (column.plan?.steps[column.currentStepIndex]?.id ?? null) !== target.stepId) throw invalid();
  let key: string;
  if (target.sideId !== null) {
    if (!document.state.sideChats.some(side => side.id === target.sideId && side.columnId === target.columnId)) throw invalid();
    key = `question:side:${target.sideId}`;
  } else {
    if (!['question','material','ai','learner'].includes(target.mode)) throw invalid();
    if (target.mode === 'learner' && !['verify','teachback'].includes(target.phase)) throw invalid();
    const kind = target.mode === 'learner' ? (target.phase === 'teachback' ? 'teachback' : 'answer') : target.mode;
    key = `${kind}:${target.columnId}`;
  }
  if (target.key !== key) throw invalid();
}

/** Review snapshots are transient capabilities, bound to one document target. */
export function previewVoiceDraft(handle: VoiceDraftRequest, transcript: string, controller: BrowserController, port: VoiceDraftPort): VoiceDraftPreview {
  const request = handles.get(handle);
  if (!currentRequest(request, controller)) throw invalid('这次识别已退休、正在追加或不属于当前工作台。');
  if (typeof transcript !== 'string' || !transcript.trim() || transcript.length > 20000) throw invalid('识别文字为空或过长。');
  const target = request.target;
  const document = controller.pendingDocument();
  requireTarget(target, document, controller, port);
  const preview: VoiceDraftPreview = Object.freeze({
    requestId: handle.requestId, target, transcript,
    baseText: document.drafts.messages[target.key] ?? '', baseRevision: controller.messageDraftRevision(target.key),
  });
  if (!currentRequest(request, controller)) throw invalid();
  issued.set(preview, request);
  currentPreviews.set(controller, preview);
  return preview;
}

/** Applied means the optimistic candidate exists, even if its save later fails. */
export function appendReviewedVoiceDraft(preview: VoiceDraftPreview, controller: BrowserController, port: VoiceDraftPort): {applied: boolean; saving: Promise<BrowserSnapshot>} {
  const request = issued.get(preview);
  const reject = (cause: unknown) => ({applied: false, saving: Promise.reject<BrowserSnapshot>(cause)});
  if (!currentRequest(request, controller) || currentPreviews.get(controller) !== preview) return reject(invalid('这份语音预览已变化、不属于当前工作台或已经追加。'));
  // Reserve before acquisition emits: subscribers can synchronously replay clicks.
  request.appending = true;
  let lease: ReturnType<BrowserController['acquireVoiceOperation']> | undefined;
  let applied = false;
  try {
    lease = controller.acquireVoiceOperation();
    const saving = controller.change(latest => {
      if (!lease!.current() || !activeRequest(request, controller)
        || currentPreviews.get(controller) !== preview || port.composing()) throw invalid();
      requireTarget(preview.target, latest, controller, port);
      if (!lease!.current() || !activeRequest(request, controller) || currentPreviews.get(controller) !== preview) throw invalid();
      const key = preview.target.key;
      if (controller.messageDraftRevision(key) !== preview.baseRevision || (latest.drafts.messages[key] ?? '') !== preview.baseText) throw invalid('草稿在检查后有新输入，请重新预览追加。');
      const separator = preview.baseText && !preview.baseText.endsWith('\n') ? '\n' : '';
      const text = preview.baseText + separator + preview.transcript;
      if (text.length > 20000) throw invalid('追加后草稿超过 20,000 字，已保留原草稿。');
      const candidate = validateBrowserDocument({...latest, drafts: {...latest.drafts, messages: {...latest.drafts.messages, [key]: text}}});
      request.applied = true; applied = true;
      retire(request);
      return candidate;
    });
    return {applied, saving: saving.finally(() => {request.appending = false; lease!.release();})};
  } catch (cause) {
    request.appending = false; lease?.release();
    return reject(cause);
  }
}
