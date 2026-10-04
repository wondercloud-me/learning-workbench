export interface WorkspaceTab { id: string; kind: 'side' | 'file' | 'terminal' | 'diff' | 'preview' | 'lesson' | 'teaching'; title: string; resource?: string }
export interface TabState { tabs: WorkspaceTab[]; activeId: string | null; closed: WorkspaceTab[] }
export const emptyTabs = (): TabState => ({ tabs: [], activeId: null, closed: [] });
export function openTab(state: TabState, tab: WorkspaceTab): TabState {
  return { tabs: state.tabs.some(item => item.id === tab.id) ? state.tabs : [...state.tabs, tab], activeId: tab.id, closed: state.closed.filter(item => item.id !== tab.id) };
}
export function closeTab(state: TabState, id: string): TabState {
  const index = state.tabs.findIndex(tab => tab.id === id); if (index < 0) return state;
  const tabs = state.tabs.filter(tab => tab.id !== id);
  return { tabs, activeId: state.activeId === id ? tabs[Math.min(index, tabs.length - 1)]?.id || null : state.activeId, closed: [...state.closed.filter(tab => tab.id !== id), state.tabs[index]].slice(-20) };
}
export function reopenTab(state: TabState): TabState { const tab = state.closed.at(-1); return tab ? openTab(state, tab) : state; }
export function moveTab(state: TabState, id: string, beforeId: string): TabState {
  if (id === beforeId) return state;
  const tab = state.tabs.find(item => item.id === id); if (!tab || !state.tabs.some(item => item.id === beforeId)) return state;
  const tabs = state.tabs.filter(item => item.id !== id); tabs.splice(tabs.findIndex(item => item.id === beforeId), 0, tab); return { ...state, tabs };
}
