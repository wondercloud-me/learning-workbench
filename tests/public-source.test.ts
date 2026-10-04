import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/export-public-source.mjs', import.meta.url));
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true })));
});

async function fixture(extra: Record<string, string | Buffer> = {}) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'public-source-')));
  folders.push(root);
  const source = path.join(root, 'source');
  const output = path.join(root, 'snapshot');
  const files = {
    'README.md': '# Public project\n\n[Export policy](docs/public-source.md)\n',
    'LICENSE': 'MIT test fixture\n',
    'package.json': '{"name":"public-source-fixture","version":"1.0.0","type":"module"}\n',
    'pnpm-lock.yaml': 'lockfileVersion: "9.0"\n',
    'docs/public-source.md': '# Public source policy\n',
    'src/main.ts': 'export const message = "学习记录由用户自己保存";\n',
    'tests/fake.test.ts': 'const apiKey = "sk-example-not-a-real-key";\n',
    'scripts/build.mjs': 'console.log("build");\n',
    'website/index.html': '<!doctype html><title>Public fixture</title>\n',
    '.github/workflows/ci.yml': 'name: CI\n',
    'licenses/example-1.0.0-LICENSE': 'Fixture license\n',
    '.gitignore': 'node_modules/\n.cache/\n',
    ...extra,
  };
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(source, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
  }
  return { root, source, output };
}

function run(source: string, output: string, args: string[] = []) {
  return spawnSync(process.execPath, [script, '--source', source, '--output', output, ...args], { encoding: 'utf8' });
}

async function filesUnder(directory: string, prefix = ''): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) result.push(...await filesUnder(path.join(directory, entry.name), relative + '/'));
    else result.push(relative);
  }
  return result.sort();
}

describe('fresh public source export', () => {
  it('exports selected public files, omits local history/data and hashes exactly the copied bytes', async () => {
    const { source, output } = await fixture({
      '.git/config': 'private history\n',
      'node_modules/private/index.js': 'not source\n',
      '.cache/private.json': 'cache\n',
      'release/backup.zip': 'installer\n',
      'resources/speech/model.onnx': 'downloaded model\n',
      'userData/state.json': 'personal answers\n',
      'docs/research/internal.md': 'private research\n',
      'docs/cache-qa.md': 'private QA\n',
      'docs/plans/internal.md': 'private plan\n',
      'docs/superpowers/specs/internal.md': 'private specification\n',
      'src/userData/state.json': 'nested user data\n',
      'src/.env.local': 'API_KEY=not-for-export\n',
      'assets/signing/certificate.p12': 'signing material\n',
    });
    const result = run(source, output);
    expect(result.status, result.stderr).toBe(0);
    const exported = await filesUnder(output);
    expect(exported).toEqual([
      '.github/workflows/ci.yml', '.gitignore', 'LICENSE', 'PUBLIC_SOURCE_MANIFEST.json', 'README.md',
      'docs/public-source.md', 'licenses/example-1.0.0-LICENSE', 'package.json', 'pnpm-lock.yaml',
      'scripts/build.mjs', 'src/main.ts', 'tests/fake.test.ts', 'website/index.html',
    ]);
    const serialized = await readFile(path.join(output, 'PUBLIC_SOURCE_MANIFEST.json'), 'utf8');
    expect(serialized).not.toContain(source);
    expect(serialized).not.toContain(output);
    const manifest = JSON.parse(serialized);
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.files.map((file: { path: string }) => file.path)).toEqual(exported.filter(file => file !== 'PUBLIC_SOURCE_MANIFEST.json'));
    for (const file of manifest.files) {
      const data = await readFile(path.join(output, file.path));
      expect(file.bytes).toBe(data.length);
      expect(file.sha256).toBe(createHash('sha256').update(data).digest('hex'));
      expect(data.equals(await readFile(path.join(source, file.path)))).toBe(true);
    }
  });

  it('does not rewrite learner examples or known fake credentials', async () => {
    const contents = 'const apiKey = "YOUR_API_KEY"; const url = "https://user:pass@example.com/v1"; const lesson = "请输入自己的 API Key";\n';
    const { source, output } = await fixture({ 'tests/example.test.ts': contents });
    const result = run(source, output);
    expect(result.status, result.stderr).toBe(0);
    expect(await readFile(path.join(output, 'tests/example.test.ts'), 'utf8')).toBe(contents);
  });

  it('preserves the one-character x:y URL used to test real-site credential rejection', async () => {
    const contents = 'const rejectedUrl = "https://x:y@www.runoob.com/";\n';
    const { source, output } = await fixture({ 'tests/url-security.test.ts': contents });
    const result = run(source, output);
    expect(result.status, result.stderr).toBe(0);
    expect(await readFile(path.join(output, 'tests/url-security.test.ts'), 'utf8')).toBe(contents);
  });

  it('preserves a reserved example-host URL used by the website verifier', async () => {
    const contents = 'const invalidRelease = "https://user:secret@example.com/";\n';
    const { source, output } = await fixture({ 'website/verify.mjs': contents });
    const result = run(source, output);
    expect(result.status, result.stderr).toBe(0);
    expect(await readFile(path.join(output, 'website/verify.mjs'), 'utf8')).toBe(contents);
  });

  it.each(['file', 'directory'])('rejects an included symlink %s before creating an export', async kind => {
    const { source, output, root } = await fixture();
    const privateFile = path.join(root, 'private.ts');
    await writeFile(privateFile, 'private outside the source tree');
    if (kind === 'file') await symlink(privateFile, path.join(source, 'src', 'leak.ts'));
    else await symlink(root, path.join(source, 'src', 'linked'));
    const result = run(source, output);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/symlink/i);
    expect(result.stderr).not.toContain(privateFile);
    expect(result.stderr).not.toContain('private outside');
    expect(await readdir(root)).not.toContain('snapshot');
  });

  it.each(['src/blob.zip', 'tests/answer.csv', 'website/.hidden.js', 'src/private notes.ts'])('rejects unexpected selected path %s', async relative => {
    const { source, output, root } = await fixture({ [relative]: 'unexpected' });
    const result = run(source, output);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/path|type|extension/i);
    expect(await readdir(root)).not.toContain('snapshot');
  });

  it('checks binary contents instead of accepting renamed arbitrary files', async () => {
    const { source, output } = await fixture({ 'assets/icon.png': 'not a PNG' });
    const result = run(source, output);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('assets/icon.png');
  });

  it('scans a credential embedded after a valid image header', async () => {
    const secret = 'sk-proj-' + 'A1b2C3d4E5f6G7h8'.repeat(3);
    const contents = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from(secret)]);
    const { source, output, root } = await fixture({ 'assets/icon.png': contents });
    const result = run(source, output);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('assets/icon.png');
    expect(result.stderr).not.toContain(secret);
    expect(await readdir(root)).not.toContain('snapshot');
  });

  it.each([
    ['OpenAI', () => 'sk-proj-' + 'aBcDeF0123456789'.repeat(4)],
    ['DeepSeek', () => 'sk-' + 'a1b2c3d4e5f60789'.repeat(2)],
    ['GitHub', () => 'ghp_' + 'aBcDeF012345'.repeat(3)],
    ['AWS', () => 'AKIA' + 'A1B2C3D4E5F6G7H8'],
    ['private key', () => ['-----BEGIN', ' PRIVATE KEY-----\nprivate bytes'].join('')],
    ['credential URL', () => 'https://' + 'actual-user:actual-password@real-provider.com/v1'],
    ['uppercase credential URL', () => 'HTTPS://' + 'actual-user:actual-password@real-provider.com/v1'],
  ])('rejects a %s secret without printing its value or an absolute source path', async (_name, value) => {
    const secret = value();
    const { source, output, root } = await fixture({ 'src/config.ts': `const credential = ${JSON.stringify(secret)};\n` });
    const result = run(source, output);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('src/config.ts');
    expect(result.stderr).not.toContain(secret);
    expect(result.stderr).not.toContain(source);
    expect(await readdir(root)).not.toContain('snapshot');
  });

  it('rejects a personal home path in selected product code', async () => {
    const homePath = '/' + 'Users/' + 'PrivateOwner/Desktop/classroom.txt';
    const { source, output } = await fixture({ 'src/config.ts': `const privatePath = ${JSON.stringify(homePath)};\n` });
    const result = run(source, output);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('src/config.ts');
    expect(result.stderr).not.toContain(homePath);
  });

  it('rejects a lowercase Windows home path in selected product code', async () => {
    const homePath = 'c:' + '\\users\\PrivateOwner\\Documents\\classroom.txt';
    const { source, output } = await fixture({ 'src/config.ts': `const privatePath = ${JSON.stringify(homePath)};\n` });
    const result = run(source, output);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('src/config.ts');
    expect(result.stderr).not.toContain(homePath);
  });

  it('preserves deliberate fake home paths in security tests', async () => {
    const fakeAccount = path.basename(homedir()).toLowerCase() === 'alice' ? 'bob' : 'alice';
    const homePath = '/' + 'Users/' + fakeAccount + '/private.txt';
    const contents = `const invalidPath = ${JSON.stringify(homePath)};\n`;
    const { source, output } = await fixture({ 'tests/path-security.test.ts': contents });
    const result = run(source, output);
    expect(result.status, result.stderr).toBe(0);
    expect(await readFile(path.join(output, 'tests/path-security.test.ts'), 'utf8')).toBe(contents);
  });

  it('rejects README links to documents omitted from the snapshot', async () => {
    const { source, output } = await fixture({ 'README.md': '[Private QA](docs/cache-qa.md)\n', 'docs/cache-qa.md': 'private\n' });
    const result = run(source, output);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('README.md');
    expect(result.stderr).toMatch(/link/i);
  });

  it('refuses to overwrite an existing output directory', async () => {
    const { source, output } = await fixture();
    await mkdir(output);
    await writeFile(path.join(output, 'do-not-touch.txt'), 'keep this');
    const result = run(source, output);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/output.*exists/i);
    expect(await readFile(path.join(output, 'do-not-touch.txt'), 'utf8')).toBe('keep this');
    expect(await readdir(output)).toEqual(['do-not-touch.txt']);
  });

  it('preserves a preexisting directory if the output ancestor is replaced after creation', async () => {
    const { source, root } = await fixture();
    const parent = path.join(root, 'output-parent');
    const output = path.join(parent, 'snapshot');
    const privateParent = path.join(root, 'preexisting-parent');
    const privateOutput = path.join(privateParent, 'snapshot');
    await mkdir(parent);
    await mkdir(privateOutput, { recursive: true });
    await writeFile(path.join(privateOutput, '.gitignore'), 'preexisting file forces wx collision');
    await writeFile(path.join(privateOutput, 'sentinel.txt'), 'keep this private fixture');
    // Interpose only the real mkdir boundary to model the otherwise timing-dependent ancestor change.
    const preload = path.join(root, 'replace-parent.mjs');
    await writeFile(preload, `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      const original = fs.promises.mkdir;
      let changed = false;
      fs.promises.mkdir = async (file, options) => {
        const result = await original(file, options);
        if (String(file) === ${JSON.stringify(output)} && !options?.recursive && !changed) {
          changed = true;
          await fs.promises.rename(${JSON.stringify(parent)}, ${JSON.stringify(parent + '-moved')});
          await fs.promises.symlink(${JSON.stringify(privateParent)}, ${JSON.stringify(parent)});
        }
        return result;
      };
      syncBuiltinESMExports();
    `);
    const result = spawnSync(process.execPath, ['--import', preload, script, '--source', source, '--output', output], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(await readFile(path.join(privateOutput, 'sentinel.txt'), 'utf8')).toBe('keep this private fixture');
    expect(await readFile(path.join(privateOutput, '.gitignore'), 'utf8')).toBe('preexisting file forces wx collision');
  });

  it('rejects output within a public source directory', async () => {
    const { source } = await fixture();
    const result = run(source, path.join(source, 'src', 'snapshot'));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/output.*path/i);
    expect(await readdir(path.join(source, 'src'))).toEqual(['main.ts']);
  });

  it('allows a new cache snapshot without recursively exporting existing cache snapshots', async () => {
    const { source } = await fixture({ '.cache/old-export/src/private.ts': 'old copy' });
    const output = path.join(source, '.cache', 'new-export');
    const result = run(source, output);
    expect(result.status, result.stderr).toBe(0);
    expect(await filesUnder(output)).not.toContain('.cache/old-export/src/private.ts');
  });

  it('fails on ambiguous command arguments without leaking argument values', async () => {
    const { source, output } = await fixture();
    const result = run(source, output, ['--force', 'private-argument-value']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).not.toContain('private-argument-value');
    expect(result.stderr).toMatch(/argument/i);
  });
});
