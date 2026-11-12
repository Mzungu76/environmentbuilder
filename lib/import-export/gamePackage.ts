import JSZip from 'jszip';
import type { Project } from '@/types';
import { SCHEMA_VERSION } from '@/types';
import { getAsset } from '@/lib/persistence/db';
import { RUNTIME_SOURCE } from '@/lib/generated/runtimeSource';
import { gameReadiness } from '@/engine/game/validate';
import { computeLightMap } from '@/lib/studio/lightmap';

/**
 * Scenario package for the game app:
 *   project.json                 the full project (environments, navigation graph, objects, gameplay rules, characters + puppets)
 *   assets/<id>.<ext>            every image
 *   scenario.json                the contract: format, version, entry environment, collectibles, collapse stages (no hidden timings)
 *   environment-runtime.mjs      dependency-free runtime: createGameSession(project, { environmentId, seed })
 *   game-example.html            a tiny complete game (dice → gem → counter → collapse) that works from file://
 *   README.md                    how to integrate it in a PixiJS game
 */
export const SCENARIO_FORMAT = 'environment-builder-scenario';
const extOf = (mime: string) => (mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : mime === 'image/jpeg' ? 'jpg' : 'bin');
const blobToDataUrl = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(b); });

export function scenarioManifest(project: Project, environmentId: string) {
  const env = project.environments.find((e) => e.id === environmentId) ?? project.environments[0];
  const g = env.gameplay;
  return {
    format: SCENARIO_FORMAT, version: 1, schemaVersion: SCHEMA_VERSION, name: env.name, environmentId: env.id, size: { width: env.width, height: env.height },
    characters: env.characters.map((c) => ({ id: c.id, name: c.name, puppetId: c.puppetId ?? null })),
    nodes: env.navigation.nodes.length, edges: env.navigation.edges.length,
    perspective: env.perspective ?? null, lighting: env.lighting?.enabled ? { strength: env.lighting.strength } : null,
    // what the game may know: the items and how the collapse is announced. The duration of the collapse is NEVER exported.
    collectibles: (g?.collectibles ?? []).map((c) => ({ id: c.id, name: c.name, points: c.points, weight: c.weight, color: c.color })),
    collectSeconds: g?.collectSeconds ?? 1.4, celebrateSeconds: g?.celebrateSeconds ?? 1.2,
    collapse: g?.collapse.enabled ? { stages: g.collapse.stages.map((s) => ({ at: s.at, effect: s.effect, intensity: s.intensity, event: s.event })) } : null,
    events: ['collect:start', 'collect:pick', 'collect:done', 'score', 'stage', 'collapse', 'arrival', 'interaction'],
  };
}

export async function buildGamePackage(project: Project, environmentId?: string): Promise<{ blob: Blob; issues: ReturnType<typeof gameReadiness> }> {
  const env = project.environments.find((e) => e.id === environmentId) ?? project.environments.find((e) => e.id === project.activeEnvironmentId) ?? project.environments[0];
  const issues = gameReadiness(project, env);
  const zip = new JSZip(), assetFiles: Record<string, string> = {}, urls: Record<string, string> = {};
  const usedPuppets = new Set(env.characters.map((c) => c.puppetId).filter(Boolean) as string[]);
  const groups = [env.assets, ...project.puppets.filter((p) => usedPuppets.has(p.id)).map((p) => p.assets)];
  for (const assets of groups) for (const a of assets) {
    if (assetFiles[a.id]) continue;
    const blob = await getAsset(project.id, a.id);
    if (!blob) continue;
    const path = `assets/${a.id}.${extOf(a.mime)}`; zip.file(path, blob); assetFiles[a.id] = path; urls[a.id] = await blobToDataUrl(blob);
  }
  // only what this scenario needs
  // the light map travels with the scenario (computed now if the scene uses light but it was never calculated)
  let envOut = env;
  if (env.lighting?.enabled && !env.lightMap) { const m = await computeLightMap(project.id, env).catch(() => null); if (m) envOut = { ...env, lightMap: m }; }
  const slim: Project = { ...project, environments: [envOut], activeEnvironmentId: env.id, puppets: project.puppets.filter((p) => usedPuppets.has(p.id)) };
  zip.file('project.json', JSON.stringify(slim, null, 2));
  zip.file('scenario.json', JSON.stringify({ ...scenarioManifest(project, env.id), assets: assetFiles }, null, 2));
  zip.file('environment-runtime.mjs', RUNTIME_SOURCE);
  zip.file('game-example.html', exampleHtml(slim, urls));
  zip.file('README.md', readme(env.name));
  return { blob: await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }), issues };
}

function readme(name: string) {
  return `# ${name} — pacchetto scenario per il gioco

Contenuto
- project.json              progetto completo dello scenario (ambiente, grafo, oggetti, regole di gioco, personaggi)
- assets/                   immagini (sfondi, oggetti, texture dei personaggi)
- scenario.json             il contratto: formato, versione, oggetti da trovare, fasi del crollo
- environment-runtime.mjs   runtime senza dipendenze (nessuna build)
- game-example.html         mini gioco completo (doppio click): dadi → oggetto → contatore → crollo

## Integrazione (PixiJS)

    import * as R from './environment-runtime.mjs';
    const project = await (await fetch('project.json')).json();
    const session = R.createGameSession(project, { seed: 'partita-1' });   // stesso seed = stessa partita

    session.on((e) => {                      // eventi per il gioco
      // 'collect:start' | 'collect:pick' (il punto è in mano) | 'collect:done' | 'score' | 'stage' | 'collapse' | 'arrival' | 'interaction'
    });

    // ogni frame di Pixi:
    session.update(dtSeconds);               // fa muovere da soli i personaggi e avanza il crollo
    const f = session.frame(dtSeconds);      // tutto ciò che serve per disegnare
    for (const c of f.characters) { /* c.x, c.y (px dell'ambiente), c.facing, c.heightPx, c.puppet */ }
    // c.puppet = { view, positions, over?, attachments? }: vertici deformati già pronti (vedi docs di integrazione del personaggio)
    // f.pickups  = oggetti appena raccolti (animazione da far volare verso il contatore)
    // f.collapse = { intensity 0-1, shake {x,y,angle}, stage, collapsed }  →  scuoti la camera, polvere, buio…
    // f.score    = { points, counts }

    // quando i dadi escono uguali:
    session.triggerCollect();                // oggetto a caso (per peso)  |  triggerCollect('Gemma')  |  triggerCollect(idOggetto)
    // il personaggio si ferma, raccoglie, esulta; il punto si conta a metà raccolta; poi riprende a vagare

## Regole importanti
- Il personaggio si muove SEMPRE da solo (percorso casuale sul grafo); il gioco non gli dà ordini di movimento.
- Il crollo ha una durata casuale tra due limiti che il gioco non conosce mai: riceve solo l'intensità del tremore (che cresce in modo irregolare, con falsi allarmi) e gli eventi di fase. All'evento 'collapse' il gioco finisce: nessuno si muove più e triggerCollect() risponde { ok:false, reason:'collapsed' }.
- Le richieste di raccolta fatte mentre il personaggio sta già raccogliendo vengono messe in coda.
- Gli oggetti e i punti sono quelli di scenario.json (collectibles): ogni scenario può avere cose diverse.
- Prospettiva: c.heightPx e la velocità sono già scalati (c.scale). Luce: c.light = { brightness, tint, tintAmount } della zona in cui si trova il personaggio (null se lo scenario non la usa): applicali allo sprite (in Pixi: ColorMatrixFilter o sprite.tint).
`;
}

export function exampleHtml(project: Project, urls: Record<string, string>): string {
  const esc = (s: string) => s.replace(/<\/script/gi, '<\\/script');
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Esempio di gioco</title>
<style>*{box-sizing:border-box}body{margin:0;background:#0b0d12;color:#e8eaf0;font:15px system-ui,sans-serif;display:grid;grid-template-rows:auto 1fr auto;height:100vh}
header,footer{display:flex;gap:12px;align-items:center;padding:8px 12px;background:#141821;flex-wrap:wrap}canvas{width:100%;height:100%;display:block;background:#000;min-height:0}
button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid #3a4150;background:#2a3b66;color:#fff;cursor:pointer}button:disabled{opacity:.5}
.dice{display:flex;gap:6px}.die{width:34px;height:34px;border-radius:7px;background:#fff;color:#111;display:grid;place-items:center;font-weight:700}.die.match{background:#fde047}
#score{font-weight:700;font-size:18px}small{color:#9aa3b2}</style></head>
<body><header><span id="score">Punti: 0</span><span id="counts"></span><small id="msg"></small></header><canvas id="c"></canvas>
<footer><button id="roll">🎲 Lancia i dadi</button><div class="dice" id="dice"></div><button id="again" hidden>Nuova partita</button><small>Esempio: usa il runtime incluso. Il personaggio vaga da solo; quando almeno due dadi sono uguali raccoglie un oggetto. La grotta può cedere in qualsiasi momento.</small></footer>
<script type="text/plain" id="rt">${esc(RUNTIME_SOURCE)}</script>
<script type="application/json" id="proj">${esc(JSON.stringify(project))}</script>
<script type="application/json" id="urls">${esc(JSON.stringify(urls))}</script>
<script type="module">
const R = await import(URL.createObjectURL(new Blob([document.getElementById('rt').textContent.replace(/<\\\\\\/script/g,'</script')],{type:'text/javascript'})));
const project = JSON.parse(document.getElementById('proj').textContent), urls = JSON.parse(document.getElementById('urls').textContent);
const img = {}; await Promise.all(Object.entries(urls).map(([id,u]) => new Promise(r => { const i = new Image(); i.onload = () => { img[id] = i; r(); }; i.onerror = r; i.src = u; })));
const $ = (id) => document.getElementById(id), cv = $('c'), ctx = cv.getContext('2d');
let session, last = performance.now(), over = false;
const env = project.environments[0];
function start() {
  session = R.createGameSession(project, { seed: 'partita-' + Date.now() }); over = false; $('again').hidden = true; $('roll').disabled = false; $('msg').textContent = '';
  session.on((e) => {
    if (e.type === 'collect:pick') $('msg').textContent = 'Trovato: ' + e.collectible.name + '!';
    if (e.type === 'stage') $('msg').textContent = 'La grotta si sta muovendo… (' + e.stage.effect + ')';
    if (e.type === 'collapse') { over = true; $('msg').textContent = 'La grotta è crollata!'; $('roll').disabled = true; $('again').hidden = false; }
  });
}
start(); $('again').onclick = start;
$('roll').onclick = () => {
  if (over) return; const n = 3, v = Array.from({ length: n }, () => 1 + Math.floor(Math.random() * 6));
  const counts = {}; v.forEach(x => counts[x] = (counts[x] || 0) + 1); const match = Math.max(...Object.values(counts)) >= 2;
  $('dice').innerHTML = v.map(x => '<div class="die' + (match && counts[x] >= 2 ? ' match' : '') + '">' + x + '</div>').join('');
  if (match) session.triggerCollect();
};
const order = { background: 0, midground: 1, foreground: 2 };
function drawLayers(role) { for (const l of env.layers.filter(l => l.visible && (role === 'foreground') === (l.role === 'foreground')).sort((a, b) => (order[a.role] ?? 0) - (order[b.role] ?? 0))) { const im = img[l.assetId]; if (!im) continue; ctx.globalAlpha = l.opacity ?? 1; ctx.drawImage(im, l.offsetX * env.width, l.offsetY * env.height); ctx.globalAlpha = 1; } }
function drawPuppet(c, pf) {
  const layers = [pf.under ?? pf, ...(pf.over ? [pf.over] : [])]; void layers;
  const draw = (view, pos, alpha) => { const tex = img[view.cutoutAssetId]; if (!tex || !pos || !view.mesh) return; const s = c.heightPx / view.figureHeight; ctx.save(); ctx.globalAlpha = alpha; if (c.light) ctx.filter = 'brightness(' + c.light.brightness.toFixed(2) + ')';
    R.drawPuppet(ctx, tex, pos, view.mesh.uvs, view.mesh.indices, { x: c.x, y: c.y - c.lift, scale: s, flip: c.facing < 0 && R.flipsWithFacing(view), pivot: view.pivot }); ctx.restore(); };
  const atts = (front) => (pf.attachments || []).filter(a => a.front === front).forEach(a => { const tex = img[a.assetId]; if (!tex) return; const v = pf.view, s = c.heightPx / v.figureHeight; ctx.save(); R.drawPuppet(ctx, tex, a.positions, a.uvs, a.indices, { x: c.x, y: c.y - c.lift, scale: s, flip: c.facing < 0 && R.flipsWithFacing(v), pivot: v.pivot }); ctx.restore(); });
  atts(false); draw(pf.view, pf.positions, 1); if (pf.over) draw(pf.over.view, pf.over.positions, pf.over.alpha); atts(true);
}
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  session.update(dt); const f = session.frame(dt);
  const dpr = devicePixelRatio || 1; cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr;
  const k = Math.min(cv.width / env.width, cv.height / env.height);
  ctx.setTransform(k, 0, 0, k, (cv.width - env.width * k) / 2, (cv.height - env.height * k) / 2);
  const sh = f.collapse.shake, amp = 14; ctx.translate(sh.x * amp, sh.y * amp);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, env.width, env.height);
  drawLayers('back');
  for (const c of f.characters) { if (c.puppet) drawPuppet(c, c.puppet); else { ctx.fillStyle = '#fbbf24'; ctx.fillRect(c.x - 15, c.y - c.heightPx, 30, c.heightPx); } }
  drawLayers('foreground');
  for (const p of f.pickups) { const t = p.progress; ctx.beginPath(); ctx.fillStyle = p.collectible.color; ctx.globalAlpha = 1 - t * t; ctx.arc(p.x, p.y - 60 - t * 160, 16 + 8 * Math.sin(t * Math.PI), 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
  // dust and darkness grow with the intensity
  ctx.fillStyle = 'rgba(0,0,0,' + (f.collapse.intensity * 0.55) + ')'; ctx.fillRect(0, 0, env.width, env.height);
  $('score').textContent = 'Punti: ' + f.score.points;
  $('counts').textContent = Object.entries(f.score.counts).map(([id, n]) => (session.collectibles.find(c => c.id === id)?.name || id) + ' ×' + n).join('  ');
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
</script></body></html>`;
}
