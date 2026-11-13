'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Puppet, PuppetView, Rect, ViewId } from '@/types';
import { VIEW_IDS } from '@/types';
import { cloneImg, crop, detectCells, opaqueBounds, paintAlpha, trim, type Img } from '@/engine/puppet/imageProc';
import { imgToBlob, imgToCanvas, makeView, processedSheet, pruneAssets, storePuppetImage, updatePuppet, forgetAsset } from '@/lib/studio/pipeline';
import { ExtraViews } from './ExtraViews';
import { ZoomCanvas } from './ZoomCanvas';
import { ed, st, useAssetImage, useView, ViewTabs, VIEW_LABEL, type StepProps } from './shared';
import { NumberField } from '../inspector/fields';

const COLORS: Partial<Record<ViewId, string>> = { front: '#4f8cff', side: '#3ecf8e', back: '#f5b84a' };
const ORDER: ViewId[] = ['front', 'side', 'back']; // as in the turnaround sheet: left → right

/** Step 3 — cut the sheet into views (adjustable rectangles), then retouch each cut-out and fix its proportions. */
export function ViewsStep({ store, puppet, projectId, go }: StepProps) {
  const [sheet, setSheet] = useState<{ processed: Img; source: Img; canvas: HTMLCanvasElement } | null>(null);
  const [cells, setCells] = useState<Record<ViewId, Rect> | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const drag = useRef<{ view: ViewId; edge: string; startX: number; startY: number; rect: Rect } | null>(null);

  useEffect(() => {
    let alive = true;
    processedSheet(projectId, puppet).then((r) => { if (alive && r) setSheet({ ...r, canvas: imgToCanvas(r.processed) }); });
    return () => { alive = false; };
  }, [projectId, puppet.source?.assetId, puppet.keying]); // eslint-disable-line react-hooks/exhaustive-deps

  // initial rectangles: existing crops, else auto-detected
  useEffect(() => {
    if (!sheet || cells) return;
    const existing = Object.fromEntries(ORDER.filter((v) => puppet.views[v] && !puppet.views[v]!.sourceAssetId).map((v) => [v, puppet.views[v]!.crop])) as Partial<Record<ViewId, Rect>>;
    if (Object.keys(existing).length === 3) { setCells(existing as Record<ViewId, Rect>); return; }
    detect(sheet.processed);
  }, [sheet]); // eslint-disable-line react-hooks/exhaustive-deps

  const detect = (img: Img) => {
    const found = detectCells(img, 3);
    const out = {} as Record<ViewId, Rect>;
    ORDER.forEach((v, i) => { const c = found[i]; const sub = opaqueBounds(crop(img, c)); out[v] = sub ? { x: c.x + Math.max(0, sub.x - 10), y: Math.max(0, sub.y - 10), w: Math.min(c.w, sub.w + 20), h: Math.min(img.height, sub.h + 20) } : c; });
    setCells(out); setVersion((n) => n + 1);
  };

  const generate = async () => {
    if (!sheet || !cells) return;
    setBusy(true); setNote(null);
    try {
      const views: Partial<Record<ViewId, PuppetView>> = { ...puppet.views };
      const metas = [] as Puppet['assets'];
      for (const id of ORDER) {
        const cell = cells[id];
        const t = trim(crop(sheet.processed, cell), 8);
        const b = opaqueBounds(t.img);
        if (!b) { setNote(`Nella cella «${VIEW_LABEL[id]}» non c’è nessuna figura: sposta il rettangolo o regola le tolleranze.`); setBusy(false); return; }
        const blob = await imgToBlob(t.img);
        const meta = await storePuppetImage(store, blob, `${puppet.name}-${id}.png`, t.img.width, t.img.height);
        metas.push(meta);
        const view = makeView(id, t.img, { x: cell.x + t.offset.x, y: cell.y + t.offset.y, w: t.img.width, h: t.img.height }, meta.id, views[id]);
        if (view) views[id] = view;
      }
      updatePuppet(store, puppet.id, (p) => ({ ...p, views, assets: [...p.assets, ...metas] }));
      await pruneAssets(store, puppet.id);
      setNote('Viste generate. Ora puoi ritoccarle oppure passare allo scheletro.');
    } catch (e) { setNote(`Errore: ${e instanceof Error ? e.message : e}`); }
    setBusy(false);
  };

  // --- rectangle editing on the sheet --------------------------------------------------------------------------------
  const hit = (x: number, y: number, zoom: number, touch = false) => {
    if (!cells) return null;
    const tol = (touch ? 24 : 9) / zoom;
    for (const v of ORDER) {
      const r = cells[v];
      const inX = x >= r.x - tol && x <= r.x + r.w + tol, inY = y >= r.y - tol && y <= r.y + r.h + tol;
      if (!inX || !inY) continue;
      const nl = Math.abs(x - r.x) < tol, nr = Math.abs(x - (r.x + r.w)) < tol, nt = Math.abs(y - r.y) < tol, nb = Math.abs(y - (r.y + r.h)) < tol;
      if (nl || nr || nt || nb) return { view: v, edge: `${nt ? 't' : nb ? 'b' : ''}${nl ? 'l' : nr ? 'r' : ''}` };
      if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) return { view: v, edge: 'move' };
    }
    return null;
  };

  const sheetCanvas = (
    sheet && cells && (
      <ZoomCanvas contentWidth={sheet.processed.width} contentHeight={sheet.processed.height} version={version} fitKey={puppet.source?.assetId} checker testId="views-canvas"
        draw={(ctx, v) => {
          ctx.drawImage(sheet.canvas, 0, 0);
          ORDER.forEach((id) => {
            const r = cells[id];
            ctx.strokeStyle = COLORS[id]!; ctx.lineWidth = 2 / v.zoom; ctx.strokeRect(r.x, r.y, r.w, r.h);
            ctx.fillStyle = COLORS[id]!; ctx.font = `${16 / v.zoom}px sans-serif`; ctx.fillText(VIEW_LABEL[id], r.x + 4 / v.zoom, r.y + 18 / v.zoom);
          });
        }}
        onPointer={(e, v) => {
          if (e.type === 'down') { const h = hit(e.x, e.y, v.zoom, e.pointerType !== 'mouse'); if (h) drag.current = { ...h, startX: e.x, startY: e.y, rect: { ...cells[h.view] } }; }
          else if (e.type === 'move' && drag.current) {
            const d = drag.current, dx = e.x - d.startX, dy = e.y - d.startY; const r = { ...d.rect };
            if (d.edge === 'move') { r.x += dx; r.y += dy; }
            else { if (d.edge.includes('l')) { r.x += dx; r.w -= dx; } if (d.edge.includes('r')) r.w += dx; if (d.edge.includes('t')) { r.y += dy; r.h -= dy; } if (d.edge.includes('b')) r.h += dy; }
            if (r.w > 20 && r.h > 20) { setCells({ ...cells, [d.view]: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) } }); setVersion((n) => n + 1); }
          } else if (e.type === 'up') drag.current = null;
        }} />
    )
  );

  const have = VIEW_IDS.some((v) => puppet.views[v]);
  return (
    <div className={st.main}>
      <div className={st.stage}>
        <div className={st.toolbar}>
          <button className={ed.btn} onClick={() => sheet && detect(sheet.processed)}>Rileva le figure</button>
          <button className={`${ed.btn} ${ed.btnPrimary}`} onClick={generate} disabled={busy || !cells} data-testid="generate-views">{busy ? 'Elaborazione…' : have ? 'Rigenera le viste' : 'Genera le viste'}</button>
          {have && <button className={ed.btn} onClick={() => go(3)} data-testid="next-step">Avanti: scheletro →</button>}
          <span className={ed.help}>Trascina i bordi o il rettangolo per correggerlo (le tolleranze qui servono: lo schema non è mai rispettato al 100%).</span>
        </div>
        <div className={st.canvasWrap}>{sheetCanvas ?? <div className={st.empty}>Importa il foglio nel passo 1.</div>}</div>
        {note && <div className={ed.banner} style={{ position: 'static' }} role="status">{note}</div>}
      </div>
      <aside className={st.panel}>
        {cells && (
          <div className={ed.section}>
            <h4>Rettangoli (px del foglio)</h4>
            {ORDER.map((id) => (
              <div key={id} style={{ display: 'grid', gap: 4 }}>
                <span className={ed.help} style={{ color: COLORS[id] }}>{VIEW_LABEL[id]}{id === 'side' ? ' (guarda a destra)' : ''}</span>
                <div className={ed.row2} style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
                  {(['x', 'y', 'w', 'h'] as const).map((k) => <NumberField key={k} id={`r-${id}-${k}`} label={k.toUpperCase()} value={cells[id][k]} min={0} onCommit={(v) => { setCells({ ...cells, [id]: { ...cells[id], [k]: v } }); setVersion((n) => n + 1); }} />)}
                </div>
              </div>
            ))}
          </div>
        )}
        <ExtraViews store={store} puppet={puppet} projectId={projectId} />
        {have && <Retouch store={store} puppet={puppet} projectId={projectId} source={sheet?.source ?? null} />}
      </aside>
    </div>
  );
}

/** Retouch tools for one view: eraser/restore brush, figure height (proportions) and feet pivot. */
function Retouch({ store, puppet, projectId, source }: { store: StepProps['store']; puppet: Puppet; projectId: string; source: Img | null }) {
  const [view, setView, v] = useView(puppet);
  const cut = useAssetImage(projectId, v?.cutoutAssetId);
  const own = useAssetImage(projectId, v?.sourceAssetId);
  const restoreSrc = v?.sourceAssetId ? own?.img ?? null : source;
  const [tool, setTool] = useState<'erase' | 'restore' | 'pivot' | 'pan'>('erase');
  const [size, setSize] = useState(14);
  const [ver, setVer] = useState(0);
  const work = useRef<{ img: Img; canvas: HTMLCanvasElement; orig: Img | null } | null>(null);
  const dirty = useRef(false);
  const drawing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!cut || !v) { work.current = null; return; }
    const img = cloneImg(cut.img);
    let orig: Img | null = null;
    if (restoreSrc) { orig = cloneImg(crop(restoreSrc, v.crop)); for (let i = 3; i < orig.data.length; i += 4) orig.data[i] = 255; }
    work.current = { img, canvas: imgToCanvas(img), orig }; setVer((n) => n + 1);
  }, [cut, v?.crop.x, v?.crop.y, restoreSrc]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(async () => {
    const w = work.current; if (!w || !v || !dirty.current) return;
    dirty.current = false;
    const oldId = v.cutoutAssetId;
    const blob = await imgToBlob(w.img);
    const meta = await storePuppetImage(store, blob, `${puppet.name}-${view}.png`, w.img.width, w.img.height);
    updatePuppet(store, puppet.id, (p) => ({ ...p, assets: [...p.assets, meta], views: { ...p.views, [view]: { ...p.views[view]!, cutoutAssetId: meta.id } } }));
    if (oldId) forgetAsset(projectId, oldId);
    await pruneAssets(store, puppet.id);
  }, [store, puppet.id, puppet.name, view, v, projectId]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const setView2 = (patch: Partial<PuppetView>) => updatePuppet(store, puppet.id, (p) => ({ ...p, views: { ...p.views, [view]: { ...p.views[view]!, ...patch } } }));
  if (!v) return null;
  return (
    <>
      <div className={ed.section}>
        <h4>Ritocco e proporzioni</h4>
        <ViewTabs puppet={puppet} value={view} onChange={setView} />
        <div className={ed.checkGrid}>
          {([['erase', 'Gomma'], ['restore', 'Ripristina'], ['pivot', 'Punto di appoggio'], ['pan', 'Mano']] as const).map(([t, l]) => <button key={t} className={ed.chip} aria-pressed={tool === t} onClick={() => setTool(t)}>{l}</button>)}
        </div>
        <label className={ed.field}><span>Dimensione pennello: {size}px</span><input type="range" min={2} max={80} value={size} onChange={(e) => setSize(Number(e.target.value))} /></label>
        <div style={{ height: 300 }}>
          {cut && work.current && (
            <ZoomCanvas contentWidth={cut.img.width} contentHeight={cut.img.height} version={ver} fitKey={v.cutoutAssetId ?? ''} checker panMode={tool === 'pan'} cursor={tool === 'pan' ? 'grab' : 'crosshair'} testId="retouch-canvas"
              draw={(ctx, vw) => {
                const w = work.current!; ctx.drawImage(w.canvas, 0, 0);
                ctx.strokeStyle = '#f0616d'; ctx.lineWidth = 2 / vw.zoom; ctx.beginPath(); ctx.moveTo(v.pivot.x - 14 / vw.zoom, v.pivot.y); ctx.lineTo(v.pivot.x + 14 / vw.zoom, v.pivot.y); ctx.moveTo(v.pivot.x, v.pivot.y - 14 / vw.zoom); ctx.lineTo(v.pivot.x, v.pivot.y + 14 / vw.zoom); ctx.stroke();
              }}
              onPointer={(e) => {
                const w = work.current; if (!w) return;
                if (tool === 'pivot') { if (e.type === 'down') setView2({ pivot: { x: Math.round(e.x), y: Math.round(e.y) } }); return; }
                const paint = () => { paintAlpha(w.img, w.orig, e.x, e.y, size / 2, tool === 'erase' ? 'erase' : 'restore'); imgToCanvas(w.img, w.canvas); dirty.current = true; setVer((n) => n + 1); };
                if (e.type === 'down') { drawing.current = true; paint(); }
                else if (e.type === 'move' && drawing.current) paint();
                else if (e.type === 'up') { drawing.current = false; if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => void save(), 400); }
              }} />
          )}
        </div>
        <span className={ed.help}>Gomma: cancella aloni e residui di sfondo. Ripristina: riporta i pixel originali. I ritocchi si salvano da soli.</span>
      </div>
      <div className={ed.section}>
        <h4>Dimensioni e appoggio ({VIEW_LABEL[view]})</h4>
        <NumberField id="fh" label="Altezza della figura (px)" value={Math.round(v.figureHeight)} min={50} onCommit={(n) => setView2({ figureHeight: n })} help="Tutte le viste vengono scalate in modo che la figura abbia la stessa altezza nel gioco: correggi qui se una vista è venuta più alta o più bassa delle altre." />
        <div className={ed.row2}>
          <NumberField id="pvx" label="Appoggio X" value={Math.round(v.pivot.x)} onCommit={(n) => setView2({ pivot: { ...v.pivot, x: n } })} />
          <NumberField id="pvy" label="Appoggio Y" value={Math.round(v.pivot.y)} onCommit={(n) => setView2({ pivot: { ...v.pivot, y: n } })} />
        </div>
        <button className={ed.btn} onClick={() => { const w = work.current; if (!w) return; const b = opaqueBounds(w.img); if (b) setView2({ figureHeight: b.h, pivot: { x: v.pivot.x, y: b.y + b.h } }); }}>Misura dalla sagoma</button>
      </div>
    </>
  );
}
