import type {BrowserDocument} from './browser-state';
import type {ContextTurn, ConversationContext} from './context-cache';
import type {ModelLibrary, ModelSelection} from './model-library';
import type {ChatTurn, ModelReply} from './providers';
import type {UsagePurpose, UsageRecord} from './usage';
import type {ModelSnapshot} from '../node/model-runtime';
import {runConversation} from '../node/conversation';
import {trackRequest} from '../node/usage-tracker';

export interface ChatInput {
  scope: string;
  columnId: string;
  system: string;
  task: string;
  turns: ContextTurn[];
  library: ModelLibrary;
  selected?: ModelSelection;
  purpose: 'chat' | 'side';
  requestId: string;
}
export interface ModelTestInput {
  library: ModelLibrary;
  selected?: ModelSelection;
  requestId: string;
}
export interface ModelSession {
  chat(input: ChatInput, signal?: AbortSignal): Promise<string>;
  compact(input: Omit<ChatInput, 'purpose'>, signal?: AbortSignal): Promise<void>;
  test(input: ModelTestInput, signal?: AbortSignal): Promise<string>;
  /** Clear only when idle; disposal closes acceptance while paid work settles. */
  clear(): void;
  dispose(): void;
}
export interface SessionModelPort {
  snapshot(library: ModelLibrary, selected?: ModelSelection): ModelSnapshot;
  clearKeys(): void;
}
export interface SessionController {
  pendingDocument(): BrowserDocument;
  change(mutator: (latest: BrowserDocument) => BrowserDocument): Promise<unknown>;
  withOperation<T>(kind: 'model', operation: () => Promise<T>): Promise<T>;
}

type Outcome = {ok: true; value: string | undefined} | {ok: false; error: unknown};
type Phase = {record?: UsageRecord; outcome?: {ok: true; reply: ModelReply} | {ok: false; error: unknown}};
type Invocation = {
  scope: string; snapshot: ModelSnapshot; phases: Map<UsagePurpose, Phase>;
  outcome?: Outcome; persistenceFailed: boolean;
} & (
  {kind: 'conversation'; input: ChatInput; compactOnly: boolean} |
  {kind: 'test'; input: ModelTestInput; compactOnly: false}
);

function assertRequestId(input: ModelTestInput): void {
  if (!input.requestId.trim()) throw new Error('模型请求缺少标识');
}
function assertTarget(document: BrowserDocument, input: ChatInput): void {
  assertRequestId(input);
  if (!document.state.columns.some(column => column.id === input.columnId)) throw new Error('原教学栏目已不存在');
  if (input.scope === input.columnId && input.purpose === 'chat') return;
  if (input.purpose === 'side' && document.state.sideChats.some(side => input.scope === `side:${side.id}` && side.columnId === input.columnId)) return;
  throw new Error('请求上下文与选定栏目或辅助对话不一致');
}

/** Owns usage/context only. Original learner messages and teaching transitions belong to the caller. */
export function createModelSession(port: SessionModelPort, controller: SessionController): ModelSession {
  const tails = new Map<string, Promise<void>>();
  const invocations = new Map<string, Invocation>();
  let disposed = false;
  let active = 0;

  const execute = async (invocation: Invocation, signal?: AbortSignal): Promise<string | undefined> => {
    if (disposed) throw new Error('模型会话已关闭');
    const {snapshot} = invocation;
    const records = () => [...invocation.phases.values()].flatMap(phase => phase.record ? [phase.record] : []);
    const mergeUsage = (document: BrowserDocument) => {
      const existing = new Set(document.state.usageRecords.map(record => record.id));
      return {...document, state: {...document.state, usageRecords: [...document.state.usageRecords, ...records().filter(record => !existing.has(record.id))]}};
    };
    // Retry the current pending document, never replay an old scope context.
    if (invocation.outcome) {
      if (invocation.persistenceFailed) {
        await controller.change(mergeUsage);
        invocation.persistenceFailed = false;
      }
      if (!invocation.outcome.ok) throw invocation.outcome.error;
      return invocation.outcome.value;
    }
    signal?.throwIfAborted();
    if (invocation.kind === 'conversation') assertTarget(controller.pendingDocument(), invocation.input);
    let persistenceError: unknown;
    const stage = async (nextContext?: ConversationContext) => {
      try {
        await controller.change(latest => {
          const merged = mergeUsage(latest);
          return nextContext ? {...merged, state: {...merged.state, contexts: {...merged.state.contexts, [invocation.scope]: nextContext}}} : merged;
        });
      } catch (error) {
        // The controller retains its staged candidate in RAM. Finish the accepted
        // invocation so paid text survives too, then surface the storage failure.
        persistenceError = error;
        invocation.persistenceFailed = true;
      }
    };
    const request = async (system: string, turns: ChatTurn[], purpose: UsagePurpose): Promise<ModelReply> => {
      if (disposed) throw new Error('模型会话已关闭');
      const id = JSON.stringify(['model', invocation.scope, invocation.input.requestId, purpose]);
      if (controller.pendingDocument().state.usageRecords.some(record => record.id === id)) {
        throw new Error('此付费请求已有用量记录；请查看原回复，不能自动重发');
      }
      signal?.throwIfAborted();
      const phase: Phase = {};
      invocation.phases.set(purpose, phase);
      try {
        const reply = await trackRequest(snapshot, system, turns, purpose, async record => {phase.record = record;}, 180000, () => id, signal);
        phase.outcome = {ok: true, reply};
      } catch (error) {phase.outcome = {ok: false, error};}
      if (phase.record) await stage();
      if (!phase.outcome.ok) throw phase.outcome.error;
      return phase.outcome.reply;
    };
    try {
      if (invocation.kind === 'test') {
        const reply = await request('这是用户主动发起的 API 连接测试。只回复 OK。', [{role: 'user', content: '请回复 OK。'}], 'test');
        invocation.outcome = {ok: true, value: reply.text};
      } else {
        const {input, compactOnly} = invocation;
        const context = controller.pendingDocument().state.contexts[input.scope] ?? {};
        const result = await runConversation({
          history: input.turns, system: input.system, task: input.task,
          context, window: snapshot.profile.contextWindows?.[snapshot.settings.model],
          profileId: snapshot.profile.id, model: snapshot.settings.model,
          compactOnly, purpose: input.purpose
        }, request, stage);
        invocation.outcome = {ok: true, value: result.reply?.text};
      }
    } catch (error) {invocation.outcome = {ok: false, error};}
    if (persistenceError) throw persistenceError;
    if (!invocation.outcome.ok) throw invocation.outcome.error;
    return invocation.outcome.value;
  };

  const accept = (source: ChatInput | ModelTestInput, kind: Invocation['kind'], compactOnly: boolean, signal?: AbortSignal): Promise<string | undefined> => {
    // The guard starts synchronously and includes all time in the scope queue.
    return controller.withOperation('model', async () => {
      if (disposed) throw new Error('模型会话已关闭');
      signal?.throwIfAborted();
      const input = structuredClone(source);
      if (kind === 'conversation') assertTarget(controller.pendingDocument(), input as ChatInput);
      else assertRequestId(input);
      const scope = kind === 'conversation' ? (input as ChatInput).scope : '$connection';
      const id = JSON.stringify([kind, scope, input.requestId]);
      let invocation = invocations.get(id);
      if (invocation && (invocation.compactOnly !== compactOnly || JSON.stringify(invocation.input) !== JSON.stringify(input))) {
        throw new Error('同一个请求标识不能用于不同的模型操作');
      }
      if (!invocation) {
        const base = {scope, snapshot: port.snapshot(input.library, input.selected), phases: new Map<UsagePurpose, Phase>(), persistenceFailed: false};
        invocation = kind === 'test' ? {...base, kind, input, compactOnly: false} : {...base, kind, input: input as ChatInput, compactOnly};
        invocations.set(id, invocation);
      }
      const previous = tails.get(scope) ?? Promise.resolve();
      active++;
      const operation = previous.then(() => execute(invocation!, signal));
      const tail = operation.then(() => {}, () => {});
      tails.set(scope, tail);
      try {return await operation;} finally {
        active--;
        if (tails.get(scope) === tail) tails.delete(scope);
        if (disposed && !active) invocations.clear();
      }
    });
  };
  const clear = () => {
    if (active) throw new Error('请等待模型操作完成后清空会话');
    port.clearKeys();
    invocations.clear();
  };
  return {
    chat: async (input, signal) => (await accept(input, 'conversation', false, signal))!,
    compact: async (input, signal) => {await accept({...input, purpose: input.scope.startsWith('side:') ? 'side' : 'chat'}, 'conversation', true, signal);},
    test: async (input, signal) => (await accept(input, 'test', false, signal))!,
    clear,
    dispose: () => {
      disposed = true;
      port.clearKeys();
      // Preserve guards until accepted work settles. Queued/new phases cannot
      // dispatch after disposal; already dispatched usage can still be saved.
      if (!active) invocations.clear();
    }
  };
}
