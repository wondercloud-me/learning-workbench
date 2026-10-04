import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, symlink, truncate, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyDiff, closeProject, copyProject, preflight, projectDiff, safeProjectPath } from '../src/node/projects';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'growth-project-test-')); roots.push(root);
    await writeFile(path.join(root, 'app.js'), 'before');
    await writeFile(path.join(root, 'config.js'), 'const api_key = "test-secret-value-123"');
  await writeFile(path.join(root, '.env'), 'API_KEY=private');
  await mkdir(path.join(root, 'node_modules'));
  await writeFile(path.join(root, 'node_modules', 'lib.js'), 'ignored');
  return root;
}

describe('project copy and selective apply', () => {
  it('reports secrets/dependencies and excludes them from the default copy', async () => {
    const root = await fixture();
    const report = await preflight(root);
    expect(report.suspectedSecrets).toContain('.env');
    expect(report.suspectedSecrets).toContain('config.js');
    expect(report.ignoredDirs).toContain('node_modules');
    const session = await copyProject(root, false, false);
    expect(await readFile(path.join(session.copy, 'app.js'), 'utf8')).toBe('before');
    await expect(readFile(path.join(session.copy, '.env'))).rejects.toThrow();
    await expect(readFile(path.join(session.copy, 'config.js'))).rejects.toThrow();
    await closeProject(session);
  });

  it('applies only chosen changes and rejects a changed original', async () => {
    const root = await fixture();
    const session = await copyProject(root, false, false);
    await writeFile(path.join(session.copy, 'app.js'), 'after');
    await writeFile(path.join(session.copy, 'new.js'), 'new');
    expect((await projectDiff(session)).map(item => item.path)).toEqual(['app.js', 'new.js']);
    await applyDiff(session, ['new.js']);
    expect(await readFile(path.join(root, 'app.js'), 'utf8')).toBe('before');
    expect(await readFile(path.join(root, 'new.js'), 'utf8')).toBe('new');
    await writeFile(path.join(root, 'app.js'), 'changed outside');
    await expect(applyDiff(session, ['app.js'])).rejects.toThrow('原项目文件已变化');
    await closeProject(session);
  });

  it('rejects symlink paths that leave the copy', async () => {
    const root = await fixture();
    const session = await copyProject(root, false, false);
    await symlink(root, path.join(session.copy, 'escape'));
    await expect(safeProjectPath(session.copy, 'escape/app.js')).rejects.toThrow('符号链接');
    await closeProject(session);
  });

  it('stops before copying a project above the size limit', async () => {
    const root = await fixture();
    await writeFile(path.join(root, 'huge.bin'), '');
    await truncate(path.join(root, 'huge.bin'), 501 * 1024 * 1024);
    expect((await preflight(root)).tooLarge).toBe(true);
    await expect(copyProject(root, false, false)).rejects.toThrow('项目过大');
    const selected = await copyProject(root, false, false, ['app.js']);
    expect(await readFile(path.join(selected.copy, 'app.js'), 'utf8')).toBe('before');
    await closeProject(selected);
  });
});
