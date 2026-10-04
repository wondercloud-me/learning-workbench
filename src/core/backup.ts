import { validateState, type AppState } from './state';
import { emptyBrowserDocument, requireRecord, validateBrowserDocument, type BrowserDocument, type BrowserDrafts } from './browser-state';

export type VersionedBackup = {
  format: 'growth-workbench'; schemaVersion: 1; appVersion: string; exportedAt: string;
  state: AppState; browser: { drafts: BrowserDrafts };
};

export function createBackup(document: BrowserDocument, appVersion: string, now: string): VersionedBackup {
  const validated = validateBrowserDocument(document);
  if (typeof appVersion !== 'string' || !appVersion.trim()) throw new Error('备份缺少应用版本');
  if (typeof now !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(now) || !Number.isFinite(Date.parse(now))) throw new Error('备份导出时间不正确');
  return { format: 'growth-workbench', schemaVersion: 1, appVersion, exportedAt: now, state: validated.state, browser: { drafts: validated.drafts } };
}

/** Plain desktop files retain validateState's legacy normalization policy:
 * missing defaults are supplied; malformed lab/usage/context/model/reading and
 * optional configuration may be normalized. No browser drafts exist in them.
 * Versioned files instead reject invalid declared records without dropping any.
 */
export function readBackup(value: unknown): BrowserDocument {
  const data = requireRecord(value, '文件');
  if ('format' in data || 'schemaVersion' in data) {
    if (typeof data.schemaVersion === 'number' && data.schemaVersion > 1) throw new Error('不支持未来版本的备份，请升级应用后再导入');
    if (data.format !== 'growth-workbench' || data.schemaVersion !== 1) throw new Error('备份格式或版本不正确');
    if (typeof data.appVersion !== 'string' || !data.appVersion.trim()) throw new Error('备份缺少应用版本');
    if (typeof data.exportedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(data.exportedAt) || !Number.isFinite(Date.parse(data.exportedAt))) throw new Error('备份导出时间不正确');
    const browser = requireRecord(data.browser, 'browser');
    return validateBrowserDocument({ state: data.state, drafts: browser.drafts });
  }
  return { state: validateState(value), drafts: emptyBrowserDocument().drafts };
}
