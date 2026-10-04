import { createHash, randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ignored = new Set(['node_modules', '.git', '.venv', 'venv', 'dist', 'build', '.next', 'coverage', '.cache', 'target']);
const secretName = /(^\.env($|\.)|\.pem$|\.key$|id_rsa|credentials|secrets?\.json$)/i;
const secretContent = /(?:\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\b\s*[:=]\s*["']?[^\s"']{8,}|\bAKIA[0-9A-Z]{16}\b|\bsk-[A-Za-z0-9_-]{20,})/i;
export const limits = { files: 8000, bytes: 500 * 1024 * 1024 };
export type Preflight = { files: number; bytes: number; ignoredDirs: string[]; suspectedSecrets: string[]; tooLarge: boolean };

export function safeRelative(relative: string): string {
  const normalized = path.posix.normalize(relative.replaceAll('\\', '/'));
  if (!relative || path.isAbsolute(relative) || normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/') || normalized.includes('\0')) throw new Error('文件路径越界');
  return normalized;
}

export async function safeProjectPath(root: string, relative: string, allowMissing = false): Promise<string> {
  const normalized = safeRelative(relative);
  let current = root;
  for (const part of normalized.split('/')) {
    current = path.join(current, part);
    const info = await lstat(current).catch(error => { if (allowMissing && error.code === 'ENOENT') return null; throw error; });
    if (info?.isSymbolicLink()) throw new Error('不允许经过符号链接');
  }
  return current;
}

async function walk(root: string, collect: (relative: string, size: number, kind: 'file' | 'ignored') => void, relative = ''): Promise<void> {
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const next = path.posix.join(relative, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) { if (ignored.has(entry.name)) collect(next, 0, 'ignored'); else await walk(root, collect, next); }
    else if (entry.isFile()) collect(next, (await stat(path.join(root, next))).size, 'file');
  }
}

export async function projectTopEntries(root: string): Promise<string[]> {
  return (await readdir(root, { withFileTypes: true })).filter(entry => !entry.isSymbolicLink() && !ignored.has(entry.name)).map(entry => entry.name).sort();
}

export async function preflight(root: string, selectedEntries?: string[]): Promise<Preflight> {
  let files = 0, bytes = 0;
  const ignoredDirs: string[] = [], suspectedSecrets: string[] = [];
  const candidates: string[] = [];
  const selected = selectedEntries ? new Set(selectedEntries) : null;
  await walk(root, (relative, size, kind) => {
    if (selected && !selected.has(relative.split('/')[0])) return;
    if (kind === 'ignored') { ignoredDirs.push(relative); return; }
    files++; bytes += size;
    if (secretName.test(path.basename(relative))) suspectedSecrets.push(relative);
    else if (size <= 1024 * 1024) candidates.push(relative);
  });
  for (const relative of candidates) {
    const data = await readFile(path.join(root, relative)).catch(() => Buffer.from(''));
    if (secretContent.test(data.subarray(0, 65536).toString('utf8'))) suspectedSecrets.push(relative);
  }
  return { files, bytes, ignoredDirs, suspectedSecrets, tooLarge: files > limits.files || bytes > limits.bytes };
}

export interface ProjectSession { original: string; copy: string; snapshot: string; baseline: Record<string, string>; includeSecrets: boolean; network: boolean }
function hash(buffer: Buffer) { return createHash('sha256').update(buffer).digest('hex'); }

export async function copyProject(original: string, includeSecrets: boolean, network: boolean, selectedEntries?: string[]): Promise<ProjectSession> {
  if (selectedEntries && (!selectedEntries.length || selectedEntries.some(entry => entry.includes('/') || entry === '..'))) throw new Error('至少选择一个顶层文件或目录');
  const report = await preflight(original, selectedEntries);
  if (report.tooLarge) throw new Error(`项目过大：${report.files} 个文件、${Math.round(report.bytes / 1024 / 1024)} MB。先缩小项目。`);
  const copy = path.join(tmpdir(), `growth-workbench-${randomUUID()}`);
  const snapshot = path.join(tmpdir(), `growth-workbench-baseline-${randomUUID()}`);
  const baseline: Record<string, string> = {};
  const secrets = new Set(report.suspectedSecrets);
  await mkdir(copy, { recursive: true });
  await mkdir(snapshot, { recursive: true });
  const selected = selectedEntries ? new Set(selectedEntries) : null;
  await walk(original, (relative, _size, kind) => { if (kind === 'file' && (!selected || selected.has(relative.split('/')[0]))) baseline[relative] = ''; });
  for (const relative of Object.keys(baseline)) {
    if (!includeSecrets && secrets.has(relative)) { delete baseline[relative]; continue; }
    const data = await readFile(path.join(original, relative));
    baseline[relative] = hash(data);
    await mkdir(path.dirname(path.join(copy, relative)), { recursive: true });
    await writeFile(path.join(copy, relative), data);
    await mkdir(path.dirname(path.join(snapshot, relative)), { recursive: true });
    await writeFile(path.join(snapshot, relative), data);
  }
  return { original, copy, snapshot, baseline, includeSecrets, network };
}

export async function listFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  await walk(root, (relative, _size, kind) => { if (kind === 'file') files.push(relative); });
  return files.sort();
}

export async function projectDiff(session: ProjectSession): Promise<Array<{ path: string; before: string; after: string; status: 'added' | 'modified' | 'deleted'; conflict: boolean }>> {
  const copyFiles = await listFiles(session.copy);
  const all = new Set([...Object.keys(session.baseline), ...copyFiles]);
  const result = [];
  for (const relative of [...all].sort()) {
    const inCopy = copyFiles.includes(relative);
    const afterBuffer = inCopy ? await readFile(await safeProjectPath(session.copy, relative)) : Buffer.from('');
    const after = afterBuffer.toString('utf8');
    const beforeExists = relative in session.baseline;
    const before = beforeExists ? (await readFile(path.join(session.snapshot, relative))).toString('utf8') : '';
    const currentHash = beforeExists ? await readFile(path.join(session.original, relative)).then(hash).catch(() => null) : null;
    const conflict = beforeExists ? currentHash !== session.baseline[relative] : await stat(path.join(session.original, relative)).then(() => true).catch(() => false);
    if ((beforeExists && !inCopy) || !beforeExists || (inCopy && hash(afterBuffer) !== session.baseline[relative])) result.push({ path: relative, before, after, status: !beforeExists ? 'added' as const : !inCopy ? 'deleted' as const : 'modified' as const, conflict });
  }
  return result;
}

export async function applyDiff(session: ProjectSession, selected: string[]): Promise<string[]> {
  const diffs = await projectDiff(session);
  const chosen = diffs.filter(item => selected.includes(item.path));
  if (chosen.some(item => item.conflict)) throw new Error('原项目文件已变化；请先重新检查差异');
  for (const item of chosen) {
    const target = await safeProjectPath(session.original, item.path, true);
    if (item.status === 'deleted') await rm(target);
    else { await mkdir(path.dirname(target), { recursive: true }); await cp(await safeProjectPath(session.copy, item.path), target); }
    if (item.status === 'deleted') { delete session.baseline[item.path]; await rm(path.join(session.snapshot, item.path), { force: true }); }
    else {
      const applied = await readFile(target);
      session.baseline[item.path] = hash(applied);
      const snap = path.join(session.snapshot, item.path);
      await mkdir(path.dirname(snap), { recursive: true });
      await writeFile(snap, applied);
    }
  }
  return chosen.map(item => item.path);
}

export async function dockerRun(session: ProjectSession, command: string, allowNetwork = session.network): Promise<{ code: number; output: string }> {
  if (!command.trim()) throw new Error('命令不能为空');
  return await new Promise((resolve, reject) => {
    const args = ['run', '--rm', '--init', '--cpus=2', '--memory=2g', '--pids-limit=128', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--network', allowNetwork ? 'bridge' : 'none', '-v', `${session.copy}:/workspace`, '-w', '/workspace', 'node:22-alpine', 'sh', '-lc', command];
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const append = (part: Buffer) => { output += part.toString(); if (output.length > 200000) { child.kill(); output = output.slice(0, 200000) + '\n[输出过长，已停止]'; } };
    child.stdout.on('data', append); child.stderr.on('data', append);
    child.on('error', error => reject(new Error(`Docker 不可用：${error.message}`)));
    child.on('close', code => resolve({ code: code ?? -1, output }));
    setTimeout(() => child.kill(), 120000).unref();
  });
}

export async function closeProject(session: ProjectSession): Promise<void> { await Promise.all([rm(session.copy, { recursive: true, force: true }), rm(session.snapshot, { recursive: true, force: true })]); }
