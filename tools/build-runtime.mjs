// Builds dist/environment-runtime.mjs: the dependency-free runtime for host games (ES module).
import { build } from 'esbuild';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
await build({
  entryPoints: [path.join(root, 'engine/public.ts')], bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', minify: true,
  outfile: path.join(root, 'dist/environment-runtime.mjs'), alias: { '@': root }, logLevel: 'warning',
});
console.log('dist/environment-runtime.mjs');
