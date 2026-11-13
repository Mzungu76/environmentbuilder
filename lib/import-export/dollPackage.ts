import JSZip from 'jszip';
import type { Doll } from '@/types';
import { SCHEMA_VERSION } from '@/types';
import { RUNTIME_SOURCE } from '@/lib/generated/runtimeSource';

export const DOLL_FORMAT = 'environment-builder-doll';

/**
 * Package for host games:  doll.json · environment-runtime.mjs · demo.html (single-file player, works from file://) · README.md
 * An omino needs no images: the runtime turns doll.json + a state + a time into drawable polygons.
 */
export function dollJson(doll: Doll) { return { format: DOLL_FORMAT, schemaVersion: SCHEMA_VERSION, doll }; }

export async function buildDollPackage(doll: Doll): Promise<Blob> {
  const zip = new JSZip();
  zip.file('doll.json', JSON.stringify(dollJson(doll), null, 2));
  zip.file('environment-runtime.mjs', RUNTIME_SOURCE);
  zip.file('demo.html', demoHtml(doll));
  zip.file('README.md', readme(doll.name));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

function readme(name: string) {
  return `# ${name} — omino (Environment Builder)

Un omino è un personaggio procedurale: nessuna immagine, solo parametri (proporzioni, colori, parti, accessori) in doll.json.

    import * as R from './environment-runtime.mjs';
    const { doll } = await (await fetch('doll.json')).json();
    const player = new R.DollPlayer();                       // uno per personaggio
    // ogni frame:
    const shapes = player.frame(doll, state, dt, speedPx / heightPx);   // state: 'IDLE' | 'WALK' | 'CLIMB' | 'JUMP' | ...
    R.drawDoll(ctx, shapes, { x: feetX, y: feetY, scale: heightPx / R.DOLL_HEIGHT, flip: facingLeft,
                              outline: doll.colors.outline, outlineWidth: doll.style.outline * R.DOLL_HEIGHT });

- \`shapes\` è una lista di poligoni e polilinee già nell'ordine di disegno (unità: figura alta 1000, piedi in (0,0), guarda a destra): puoi disegnarla con qualunque motore.
- \`speedPx / heightPx\` = velocità in altezze del personaggio al secondo: il passo resta agganciato al terreno.
- \`R.createDoll()\`, \`R.randomDoll(seed)\` e \`R.DOLL_PRESETS\` creano nuovi omini da codice.
- demo.html è un lettore autonomo (doppio click) e un esempio completo.
`;
}

function demoHtml(doll: Doll): string {
  const esc = (s: string) => s.replace(/<\/script/gi, '<\\/script');
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${doll.name.replace(/[<>&]/g, '')}</title>
<style>body{margin:0;background:#14161a;color:#e6e8ec;font:14px system-ui,sans-serif;display:grid;grid-template-columns:1fr 240px;height:100vh}canvas{width:100%;height:100%}aside{padding:12px;background:#171a20;overflow:auto}button{font:inherit;padding:6px 10px;margin:2px;background:#1e222a;color:inherit;border:1px solid #3a4150;border-radius:6px;cursor:pointer}button[aria-pressed=true]{background:#2a3b66;border-color:#4f8cff}label{display:block;margin:10px 0 2px;color:#9aa3b2;font-size:12px}@media(max-width:700px){body{grid-template-columns:1fr;grid-template-rows:62% 1fr}}</style></head>
<body><canvas id="c"></canvas><aside><h3 style="margin:0 0 8px">${doll.name.replace(/[<>&]/g, '')}</h3><div id="states"></div>
<label>Velocità (altezze/s)</label><input id="spd" type="range" min="0" max="2" step="0.05" value="0.75" style="width:100%">
<label><input id="flip" type="checkbox"> Specchia</label><p style="font-size:12px;color:#9aa3b2">Esempio di integrazione: usa <code>environment-runtime.mjs</code>.</p></aside>
<script type="text/plain" id="rt">${esc(RUNTIME_SOURCE)}</script>
<script type="application/json" id="data">${esc(JSON.stringify(doll))}</script>
<script type="module">
const R = await import(URL.createObjectURL(new Blob([document.getElementById('rt').textContent],{type:'text/javascript'})));
const doll = JSON.parse(document.getElementById('data').textContent), player = new R.DollPlayer();
const STATES = ['IDLE','WALK','CLIMB','INTERACT','COLLECT','JUMP','FALL'];
let state = 'WALK', last = performance.now();
const $ = (i) => document.getElementById(i), cv = $('c'), ctx = cv.getContext('2d');
const box = $('states'); STATES.forEach((s) => { const b = document.createElement('button'); b.textContent = s; b.setAttribute('aria-pressed', String(s === state)); b.onclick = () => { state = s; [...box.children].forEach((c) => c.setAttribute('aria-pressed', String(c.textContent === state))); }; box.appendChild(b); });
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const dpr = devicePixelRatio || 1; cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr; ctx.setTransform(dpr,0,0,dpr,0,0);
  const h = cv.clientHeight * 0.78, shapes = player.frame(doll, state, dt, state === 'WALK' || state === 'CLIMB' ? Number($('spd').value) : 0);
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(cv.clientWidth / 2, cv.clientHeight * 0.9, h * 0.12, h * 0.025, 0, 0, 7); ctx.fill();
  R.drawDoll(ctx, shapes, { x: cv.clientWidth / 2, y: cv.clientHeight * 0.9, scale: h / R.DOLL_HEIGHT, flip: $('flip').checked, outline: doll.colors.outline, outlineWidth: doll.style.outline * R.DOLL_HEIGHT });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
</script></body></html>`;
}
