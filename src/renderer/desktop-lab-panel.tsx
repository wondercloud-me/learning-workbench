import React, {useEffect, useRef, useSyncExternalStore} from 'react';
import {labTask, sameJson, type LabMode, type LabState} from '../core/lab';
import type {LabDraft} from '../core/browser-state';
import {LabPanel} from './lab-panel';
import type {DesktopDocumentController, DesktopDocumentView} from './desktop-document';

export function DesktopLabPanel({controller}: {controller: DesktopDocumentController}) {
  const view = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const retries = useRef({controller, generation: view.generation, ids: new Set<string>()});
  if (retries.current.controller !== controller || retries.current.generation !== view.generation) {
    retries.current = {controller, generation: view.generation, ids: new Set()};
  }
  const durable = new Map(view.committedDocument.state.lab.attempts.map(item => [item.id, item]));
  for (const attempt of view.document.state.lab.attempts) if (!sameJson(durable.get(attempt.id), attempt)) retries.current.ids.add(attempt.id);
  if (!view.loaded || view.status === 'locked') return null;
  return <BoundLab key={view.generation} controller={controller} view={view} retryIds={retries.current.ids}/>;
}

function BoundLab({controller, view, retryIds}: {controller: DesktopDocumentController; view: DesktopDocumentView; retryIds: Set<string>}) {
  const live = useRef(true);
  useEffect(() => {live.current = true; return () => {live.current = false;};}, []);
  const expectedGeneration = view.generation;
  const expectedLab = view.document.state.lab;
  let expectedDraftLab = expectedLab;
  // A pending replacement can keep the same identity as a durable attempt.
  // History must show the confirmed record itself, not merely a matching ID.
  const visibleLab = {...expectedLab, attempts: view.committedDocument.state.lab.attempts};

  function current(expected: LabState) {
    const latest = controller.snapshot();
    if (!live.current || !latest.loaded || latest.status === 'locked' || latest.generation !== expectedGeneration
      || !sameJson(latest.document.state.lab, expected)) throw new Error('动手学习文档已更新，请使用当前页面');
    return latest;
  }
  function change(next: LabState): Promise<void> {
    const latest = current(expectedLab);
    const durable = new Map(latest.committedDocument.state.lab.attempts.map(item => [item.id, item]));
    const pending = latest.document.state.lab.attempts.filter(item => !sameJson(durable.get(item.id), item));
    const retryable = latest.document.state.lab.attempts.filter(item => retryIds.has(item.id) || !sameJson(durable.get(item.id), item));
    // A barrier unmount retires LabPanel's local retry map. Reconcile only the
    // same unit/mode/code/task candidate, retaining every other pending attempt.
    const used = new Set<string>();
    const submitted: string[] = [];
    const attempts = next.attempts.map(item => {
      // Ordinary session/help edits echo the visible durable history. Preserve
      // any same-ID pending replacement rather than reverting its content.
      if (sameJson(durable.get(item.id), item)) return pending.find(candidate => candidate.id === item.id) || item;
      const prior = retryable.find(candidate => !used.has(candidate.id) && candidate.unitId === item.unitId && candidate.mode === item.mode
        && candidate.code === item.code && candidate.taskId === item.taskId);
      if (prior) {used.add(prior.id); submitted.push(prior.id); return {...item, id: prior.id};}
      submitted.push(item.id);
      return item;
    });
    for (const candidate of pending) if (!used.has(candidate.id) && !attempts.some(item => item.id === candidate.id)) attempts.push(candidate);
    const unique = [...new Map(attempts.map(item => [item.id, item])).values()];
    const operation = controller.change(document => ({...document, state: {...document.state, lab: {...next, attempts: unique}}}), {generation: expectedGeneration});
    // LabPanel changes code and clears its run draft in one event. Permit that
    // paired draft update, while this old onChange still expects its old lab.
    expectedDraftLab = controller.snapshot().document.state.lab;
    return operation.then(() => {for (const id of submitted) retryIds.delete(id);});
  }
  function draft(key: string, next: LabDraft): Promise<void> {
    current(expectedDraftLab);
    if (next.lastRun) {
      const session = expectedDraftLab.sessions[key];
      const [unit, mode] = key.split(':');
      if (!session || session.code !== next.lastRun.code || labTask(unit, mode as LabMode).id !== next.lastRun.taskId) throw new Error('运行草稿与当前代码或任务不一致');
    }
    return controller.change(document => ({...document, drafts: {...document.drafts, lab: {...document.drafts.lab, [key]: next}}}), {generation: expectedGeneration});
  }
  return <LabPanel value={visibleLab} drafts={view.document.drafts.lab} onChange={change} onDraftChange={draft}/>;
}
