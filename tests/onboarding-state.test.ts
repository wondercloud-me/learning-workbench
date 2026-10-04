import { describe, expect, it } from 'vitest';
import { cleanBackup, emptyState, validateState } from '../src/core/state';

describe('onboarding state migration', () => {
  it('opens the introduction for existing backups without changing learning records', () => {
    const original = emptyState();
    original.checkins.push({ date: '2026-09-26', columnId: 'kept', note: '真实记录' });
    const { onboarding: _, ...legacy } = original;
    const restored = validateState(legacy);
    expect(restored.onboarding).toEqual({ introSeen: false, demoCompleted: false });
    expect(restored.checkins).toEqual(original.checkins);
    expect(restored.columns).toEqual(original.columns);
    expect(restored.settings).toEqual(original.settings);
  });

  it('round-trips completion flags and defaults malformed values', () => {
    const state = emptyState();
    state.onboarding = { introSeen: true, demoCompleted: true };
    expect(validateState(cleanBackup(state)).onboarding).toEqual(state.onboarding);
    expect(validateState({ ...state, onboarding: { introSeen: 'yes', demoCompleted: null } }).onboarding).toEqual({ introSeen: false, demoCompleted: false });
  });
});
