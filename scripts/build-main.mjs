import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
await mkdir('dist-main', { recursive: true });
await Promise.all([
  build({ entryPoints: ['src/electron/main.ts'], outfile: 'dist-main/main.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'] }),
  build({ entryPoints: ['src/electron/preload.ts'], outfile: 'dist-main/preload.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'] })
]);
