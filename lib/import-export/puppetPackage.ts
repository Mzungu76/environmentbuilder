import JSZip from 'jszip';
import type { Project, Puppet, PuppetView, ViewId } from '@/types';
import { SCHEMA_VERSION, VIEW_IDS } from '@/types';
import { getAsset } from '@/lib/persistence/db';
import { RUNTIME_SOURCE } from '@/lib/generated/runtimeSource';

/**
 * Self-contained puppet package for host games:
 *   puppet.json              rig, meshes, weights, clips (texture paths instead of asset ids)
 *   textures/<view>.png      transparent cut-outs
 *   environment-runtime.mjs  dependency-free runtime (skinning, animation, Canvas2D drawing)
 *   demo.html                single-file player that works from file:// (also the integration example)
 *   README.md                how to use it in a game
 */
export const PUPPET_FORMAT = 'environment-builder-puppet';

export interface PuppetValidation { errors: string[]; warnings: string[] }
export function validatePuppet(p: Puppet): PuppetValidation {
  const errors: string[] = [], warnings: string[] = [];
  const views = VIEW_IDS.filter((v) => p.views[v]);
  if (!views.length) errors.push('Nessuna vista generata.');
  for (const v of views) {
    const w = p.views[v]!;
    const label = ({ side: 'Profilo', front: 'Fronte', back: 'Retro', climb: 'Arrampicata', jump: 'Salto' } as Record<string, string>)[v];
    if (!w.cutoutAssetId) errors.push(`${label}: manca l’immagine.`);
    if (Object.keys(w.landmarks).length < 19) errors.push(`${label}: scheletro incompleto.`);
    else if (!w.mesh || !w.skin) errors.push(`${label}: mesh e pesi non generati.`);
    if (!w.clips.length) warnings.push(`${label}: nessuna animazione.`);
    else if (!w.stateClips.IDLE) warnings.push(`${label}: manca l’animazione IDLE.`);
    if (v === 'side' && !w.stateClips.WALK) warnings.push('Profilo: manca la camminata (WALK).');
  }
  if (!p.views.side) warnings.push('Manca la vista di profilo: serve per camminare a destra e a sinistra.');
  if (!p.views.climb) warnings.push('Nessuna vista di arrampicata: nello stato CLIMB si userà il profilo.');
  if (!p.views.jump) warnings.push('Nessuna vista di salto: negli stati JUMP e FALL si userà il profilo.');
  return { errors, warnings };
}

const texturePath = (v: ViewId) => `textures/${v}.png`;

export function puppetJson(p: Puppet) {
  const views: Record<string, unknown> = {};
  for (const v of VIEW_IDS) {
    const w = p.views[v];
    if (!w) continue;
    const { cutoutAssetId, crop: _crop, sourceAssetId, ...rest } = w as PuppetView;
    void cutoutAssetId; void _crop; void sourceAssetId;
    views[v] = { ...rest, texture: texturePath(v) };
  }
  return { format: PUPPET_FORMAT, schemaVersion: SCHEMA_VERSION, name: p.name, idleView: p.idleView, views };
}

const blobToDataUrl = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(b); });

export async function buildPuppetPackage(project: Project, puppet: Puppet): Promise<Blob> {
  const zip = new JSZip();
  const json = puppetJson(puppet);
  const urls: Record<string, string> = {};
  for (const v of VIEW_IDS) {
    const w = puppet.views[v];
    if (!w?.cutoutAssetId) continue;
    const blob = await getAsset(project.id, w.cutoutAssetId);
    if (!blob) throw new Error(`Immagine mancante per la vista «${v}»`);
    zip.file(texturePath(v), blob);
    urls[texturePath(v)] = await blobToDataUrl(blob);
  }
  zip.file('puppet.json', JSON.stringify(json, null, 2));
  zip.file('environment-runtime.mjs', RUNTIME_SOURCE);
  zip.file('demo.html', demoHtml(json, urls));
  zip.file('README.md', readme(puppet.name));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

function readme(name: string) {
  return `# ${name} — pacchetto personaggio (Environment Builder)

Contenuto
- puppet.json            scheletro, mesh, pesi e animazioni (coordinate in pixel della texture)
- textures/*.png         immagini con sfondo trasparente (side = profilo verso destra, front, back)
- environment-runtime.mjs  runtime senza dipendenze (nessuna build necessaria)
- demo.html              lettore autonomo: aprilo con doppio click (funziona anche da file://)

Uso minimo (browser, ES module; serve un piccolo server locale per fetch/import)

    import * as R from './environment-runtime.mjs';
    const data = await (await fetch('puppet.json')).json();
    const views = data.views;                      // { side, front, back }
    const img = await loadImage(views.side.texture);

    // ogni frame:
    const viewId = R.chooseViewForState(views, state, data.idleView, edgeViewHint);   // 'side' | 'front' | 'back' | 'climb' | 'jump'
    const view = views[viewId];
    phase = R.advancePhase(view, state, phase, dt, speedInFigureHeights);        // state: 'IDLE' | 'WALK' | 'CLIMB' | ...
    const pose = R.poseAt(view, state, phase);
    const pos = R.skinVertices(view, pose);                                       // Float32Array di vertici deformati
    const s = targetHeightPx / view.figureHeight;                                 // scala: tutte le viste hanno la stessa altezza
    R.drawPuppet(ctx, img, pos, view.mesh.uvs, view.mesh.indices, { x: feetX, y: feetY, scale: s, flip: facingLeft && R.flipsWithFacing(view), pivot: view.pivot });

Con PixiJS / WebGL usa gli stessi array (pos, view.mesh.uvs, view.mesh.indices) in una Mesh e aggiorna i vertici a ogni frame.

Note
- Stati supportati: IDLE, WALK, CLIMB, INTERACT, COLLECT, JUMP, FALL, CUSTOM (quelli senza animazione usano IDLE).
- speedInFigureHeights = velocità in altezze del personaggio al secondo: sincronizza il passo (clip.cycleLength) ed evita i piedi che scivolano.
- Il profilo guarda a destra: per andare a sinistra usa flip: true.
- Vista fronte/retro: scegli con l'indicazione "view" dei collegamenti (props.view) o per le soste (idleView).
`;
}

function demoHtml(json: unknown, urls: Record<string, string>): string {
  const esc = (s: string) => s.replace(/<\/script/gi, '<\\/script');
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Anteprima personaggio</title>
<style>body{margin:0;background:#14161a;color:#e6e8ec;font:14px system-ui,sans-serif;display:grid;grid-template-columns:1fr 260px;height:100vh}canvas{width:100%;height:100%;background:repeating-conic-gradient(#222 0 25%,#2a2a2a 0 50%) 0 0/32px 32px}aside{padding:12px;background:#171a20;overflow:auto}button,select{font:inherit;padding:6px 10px;margin:2px;background:#1e222a;color:inherit;border:1px solid #3a4150;border-radius:6px;cursor:pointer}button[aria-pressed=true]{background:#2a3b66;border-color:#4f8cff}label{display:block;margin:10px 0 2px;color:#9aa3b2;font-size:12px}h4{margin:14px 0 4px;color:#9aa3b2;font-size:12px;text-transform:uppercase}@media(max-width:700px){body{grid-template-columns:1fr;grid-template-rows:60% 1fr}}</style></head>
<body><canvas id="c"></canvas><aside><h3 style="margin:0">Anteprima</h3><div id="info" style="color:#9aa3b2;font-size:12px"></div>
<h4>Stato</h4><div id="states"></div><h4>Vista</h4><div id="views"></div>
<label>Velocità (altezze/s, per la camminata)</label><input id="spd" type="range" min="0" max="2" step="0.05" value="0.75" style="width:100%">
<label><input id="flip" type="checkbox"> Specchia (cammina a sinistra)</label>
<p style="font-size:12px;color:#9aa3b2">Questo file usa lo stesso runtime incluso nel pacchetto (<code>environment-runtime.mjs</code>): è un esempio di integrazione.</p></aside>
<script type="text/plain" id="rt">${esc(RUNTIME_SOURCE)}</script>
<script type="application/json" id="data">${esc(JSON.stringify(json))}</script>
<script type="application/json" id="tex">${esc(JSON.stringify(urls))}</script>
<script type="module">
const R = await import(URL.createObjectURL(new Blob([document.getElementById('rt').textContent.replace(/<\\\\\\/script/g,'</script')],{type:'text/javascript'})));
const data = JSON.parse(document.getElementById('data').textContent), tex = JSON.parse(document.getElementById('tex').textContent);
const imgs = {};
await Promise.all(Object.entries(data.views).map(([id,v]) => new Promise(r => { const i = new Image(); i.onload = () => { imgs[id] = i; r(); }; i.src = tex[v.texture]; })));
const ids = Object.keys(data.views); let state = 'WALK', forced = null, phase = 0, last = performance.now();
const STATES = ['IDLE','WALK','CLIMB','INTERACT','COLLECT','JUMP','FALL','CUSTOM'];
const $ = (id) => document.getElementById(id), cv = $('c'), ctx = cv.getContext('2d');
const mk = (box, items, cur, fn) => { box.innerHTML=''; items.forEach(x => { const b = document.createElement('button'); b.textContent = x; b.setAttribute('aria-pressed', String(cur()===x)); b.onclick = () => { fn(x); [...box.children].forEach(c => c.setAttribute('aria-pressed', String(c.textContent===cur()))); }; box.appendChild(b); }); };
mk($('states'), STATES, () => state, (s) => { state = s; phase = 0; });
mk($('views'), ['auto', ...ids], () => forced ?? 'auto', (v) => { forced = v === 'auto' ? null : v; });
$('info').textContent = data.name + ' · viste: ' + ids.join(', ');
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const vid = forced ?? R.chooseViewForState(data.views, state, data.idleView);
  const view = data.views[vid];
  if (view) {
    phase = R.advancePhase(view, state, phase, dt, Number($('spd').value));
    const pos = R.skinVertices(view, R.poseAt(view, state, phase));
    const dpr = devicePixelRatio || 1; cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr;
    ctx.setTransform(dpr,0,0,dpr,0,0);
    if (pos) { const s = (cv.clientHeight * 0.8) / view.figureHeight; R.drawPuppet(ctx, imgs[vid], pos, view.mesh.uvs, view.mesh.indices, { x: cv.clientWidth / 2, y: cv.clientHeight * 0.92, scale: s, flip: $('flip').checked && R.flipsWithFacing(view), pivot: view.pivot }); }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
</script></body></html>`;
}
