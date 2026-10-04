import { describe, it, expect } from 'vitest';
import { emptyTabs, openTab, closeTab, reopenTab, moveTab } from '../src/core/tabs';
import { normalizePreferences, shouldSend } from '../src/core/preferences';
import { emptyState, validateState } from '../src/core/state';
describe('workspace tabs', () => {
  it('focuses an existing resource without creating a second tab', () => {
    const a = { id: 'side:a', kind: 'side' as const, title: 'A', resource: 'a' };
    const s = openTab(openTab(emptyTabs(), a), a);
    expect(s.tabs).toHaveLength(1); expect(s.activeId).toBe(a.id);
  });
  it('closing the active tab focuses its neighbor and can restore it', () => {
    let s = emptyTabs();
    for (const id of ['a','b','c']) s = openTab(s, { id, title: id, kind: 'file', resource: id });
    s = closeTab(s, 'c'); expect(s.activeId).toBe('b');
    s = closeTab(s, 'a'); expect(s.activeId).toBe('b');
    s = reopenTab(s); expect(s.activeId).toBe('a'); expect(s.tabs).toHaveLength(2);
  });
  it('reordering does not change focus or lose resources', () => {
    let s = emptyTabs(); for (const id of ['a','b','c']) s = openTab(s,{id,title:id,kind:'side',resource:id});
    s=moveTab(s,'c','a'); expect(s.tabs.map(t=>t.id)).toEqual(['c','a','b']); expect(s.activeId).toBe('c');
  });
});
describe('preferences', () => {
  it('migrates previous backups without changing learning data', () => {
    const old = emptyState(); delete (old.settings as any).preferences;
    const migrated=validateState(old); expect(migrated.settings.preferences.theme).toBe('system'); expect(migrated.columns).toEqual(old.columns);
  });
  it('bounds imported preferences and rejects invalid values', () => {
    const p=normalizePreferences({theme:'broken',fontSize:500,codeSize:-4,sendKey:'wrong',name:3});
    expect(p.theme).toBe('system');expect(p.fontSize).toBe(14);expect(p.codeSize).toBe(13);expect(p.name).toBe('学习者');
  });
  it('IME confirmation never sends; modifier setting supports multiline drafts', () => {
    const e={key:'Enter',shiftKey:false,metaKey:false,ctrlKey:false,isComposing:false};
    expect(shouldSend(e,'enter')).toBe(true);expect(shouldSend({...e,isComposing:true},'enter')).toBe(false);
    expect(shouldSend(e,'mod-enter')).toBe(false);expect(shouldSend({...e,metaKey:true},'mod-enter')).toBe(true);
  });
});
