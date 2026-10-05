import type {LearningColumn} from '../../core/learning';

/** A synchronous operation reservation; release never waits for permission. */
export interface BrowserVoiceLease {
  readonly documentGeneration: number;
  current(): boolean;
  release(): void;
}

export type VoiceDraftMode = 'question' | 'material' | 'ai' | 'learner';
export interface VoiceDraftTarget {
  readonly page: 'learn';
  readonly learningView: 'teaching';
  readonly columnId: string;
  readonly sideId: string | null;
  readonly mode: VoiceDraftMode;
  readonly key: string;
  readonly phase: LearningColumn['phase'];
  readonly stepId: string | null;
  readonly documentGeneration: number;
  readonly scopeVersion: number;
}
export interface VoiceDraftPort {
  target(): VoiceDraftTarget | null;
  current(target: VoiceDraftTarget): boolean;
  composing(): boolean;
}
declare const voiceDraftRequestBrand: unique symbol;
/** Issued by the draft helper; object identity is verified again at runtime. */
export interface VoiceDraftRequest {
  readonly requestId: number;
  readonly [voiceDraftRequestBrand]: true;
}
export interface VoiceDraftPreview {
  readonly requestId: number;
  readonly target: VoiceDraftTarget;
  readonly transcript: string;
  readonly baseText: string;
  readonly baseRevision: number;
}
