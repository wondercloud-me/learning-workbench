import type { BrowserDocument } from './browser-state';
import type { AppState } from './state';

/** Node commit version and renderer input version are separate counters. */
export type DesktopSnapshot = {
  document: BrowserDocument;
  generation: number;
  revision: number;
  mutationRevision: number;
};
export type DesktopWrite = {
  document: BrowserDocument;
  generation: number;
  mutationRevision: number;
};
export type DesktopRuntime = {
  generation: number;
  revision: number;
  usageRecords: AppState['usageRecords'];
  contexts: AppState['contexts'];
};
