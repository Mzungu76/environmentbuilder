// Builds dist/environment-builder.html: one self-contained file (JS + CSS inlined), openable by double-click.
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const res = await build({
  entryPoints: [path.join(root, 'tools/standalone/entry.tsx')], bundle: true, write: false, outdir: path.join(root, 'dist'),
  format: 'iife', minify: true, target: 'es2022', jsx: 'automatic', platform: 'browser',
  loader: { '.module.css': 'local-css', '.css': 'css', '.md': 'text', '.txt': 'text', '.png': 'dataurl' },
  alias: { 'next/link': path.join(root, 'tools/standalone/next-link.tsx'), 'next/navigation': path.join(root, 'tools/standalone/next-navigation.ts'), '@': root },
  define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning',
});
let js = '', css = '';
for (const f of res.outputFiles) { if (f.path.endsWith('.js')) js = f.text; else if (f.path.endsWith('.css')) css = f.text; }
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover"><title>Environment Builder</title><style>${css}</style></head><body><div id="root"></div><script>${js.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
mkdirSync(path.join(root, 'dist'), { recursive: true });
writeFileSync(path.join(root, 'dist/environment-builder.html'), html);
console.log('dist/environment-builder.html', (html.length / 1024).toFixed(0) + ' KB');
