'use client';

import { useEffect, useRef, useState } from 'react';
import type { LandmarkId, PuppetView, Vec2 } from '@/types';
import { LANDMARK_IDS } from '@/types';
import { bodyCenterX, buildRig, mirrorLandmarks, refineLandmarks, snapInside, templateLandmarks } from '@/engine/puppet/skeleton';
import { opaqueBounds } from '@/engine/puppet/imageProc';
import { updatePuppet } from '@/lib/studio/pipeline';
import { ZoomCanvas } from './ZoomCanvas';
import { drawBones } from './draw';
import { ed, st, landmarkLabel, useAssetImage, useView, ViewTabs, VIEW_LABEL, type StepProps } from './shared';
import { CheckField } from '../inspector/fields';

/** Step 4 — place the 19 joints. Automatic placement from the model proportions, snapping to the silhouette, then manual fixes. */
export function SkeletonStep({ store, puppet, projectId, go }: StepProps) {
  const [vid, setVid, view] = useView(puppet);
  const cut = useAssetImage(projectId, view?.cutoutAssetId);
  const [sel, setSel] = useState<LandmarkId | null>(null);
  const [sym, setSym] = useState(false);
  const [ver, setVer] = useState(0);
  const dragging = useRef<{ id: LandmarkId; moved: boolean } | null>(null);
  const placed = useRef<string>('');

  const setLm = (lm: PuppetView['landmarks'], mode: 'commit' | 'live' = 'commit') =>
    updatePuppet(store, puppet.id, (p) => ({ ...p, views: { ...p.views, [vid]: { ...p.views[vid]!, landmarks: lm, mesh: mode === 'commit' ? null : p.views[vid]!.mesh, skin: mode === 'commit' ? null : p.views[vid]!.skin } } }), mode);

  const autoPlace = () => {
    if (!cut || !view) return;
    const b = opaqueBounds(cut.img); if (!b) return;
    const lm = refineLandmarks(cut.img, templateLandmarks(vid, b, bodyCenterX(cut.img, b, vid)), vid, b);
    setLm(lm);
  };
  const refine = () => { if (!cut || !view) return; const b = opaqueBounds(cut.img); if (b) setLm(refineLandmarks(cut.img, view.landmarks, vid, b)); };

  // first visit to a view: place automatically
  useEffect(() => {
    if (!cut || !view) return;
    const key = `${vid}:${view.cutoutAssetId}`;
    if (placed.current === key) return;
    placed.current = key;
    if (Object.keys(view.landmarks).length < LANDMARK_IDS.length) autoPlace();
  }, [cut, view?.cutoutAssetId, vid]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setVer((n) => n + 1), [view?.landmarks, cut]);

  if (!view) return <div className={st.empty}>Genera prima le viste (passo 3).</div>;
  const lm = view.landmarks;
  const complete = LANDMARK_IDS.every((k) => lm[k]);
  const counterpart = (k: LandmarkId): LandmarkId | null => (k.endsWith('L') ? (k.slice(0, -1) + 'R') as LandmarkId : k.endsWith('R') ? (k.slice(0, -1) + 'L') as LandmarkId : null);
  const rig = complete ? buildRig(view) : null;

  return (
    <div className={st.main}>
      <div className={st.stage}>
        <div className={st.toolbar}>
          <ViewTabs puppet={puppet} value={vid} onChange={(v) => { setVid(v); setSel(null); }} />
          <button className={ed.btn} onClick={autoPlace} data-testid="auto-place">Posiziona dal modello</button>
          <button className={ed.btn} onClick={refine}>Affina sul contorno</button>
          <button className={ed.btn} onClick={() => setLm(mirrorLandmarks(lm, 'L'))} title="Copia i giunti sinistri sui destri">Specchia sx→dx</button>
          <button className={ed.btn} onClick={() => setLm(mirrorLandmarks(lm, 'R'))}>Specchia dx→sx</button>
          <CheckField id="sym" label="Simmetria nel trascinamento" checked={sym} onChange={setSym} />
          <button className={`${ed.btn} ${ed.btnPrimary}`} disabled={!complete} onClick={() => go(4)} data-testid="next-step">Avanti: mesh e pesi →</button>
        </div>
        <div className={st.canvasWrap}>
          {cut && <ZoomCanvas contentWidth={cut.img.width} contentHeight={cut.img.height} version={ver} fitKey={`${vid}${view.cutoutAssetId}`} checker testId="skeleton-canvas"
            cursor="crosshair"
            draw={(ctx, v) => {
              ctx.globalAlpha = 0.9; ctx.drawImage(cut.canvas, 0, 0); ctx.globalAlpha = 1;
              if (rig) drawBones(ctx, rig, null, v.zoom);
              for (const k of LANDMARK_IDS) {
                const p = lm[k]; if (!p) continue;
                ctx.beginPath(); ctx.arc(p.x, p.y, (k === sel ? 8 : 6) / v.zoom, 0, Math.PI * 2);
                ctx.fillStyle = k === sel ? '#fde047' : '#ffffff'; ctx.fill(); ctx.lineWidth = 2 / v.zoom; ctx.strokeStyle = '#111'; ctx.stroke();
              }
              if (sel && lm[sel]) { ctx.fillStyle = '#fde047'; ctx.font = `${14 / v.zoom}px sans-serif`; ctx.fillText(landmarkLabel(sel, vid), lm[sel]!.x + 10 / v.zoom, lm[sel]!.y - 10 / v.zoom); }
            }}
            onPointer={(e, v) => {
              if (e.type === 'down') {
                let best: LandmarkId | null = null, bd = (e.pointerType === 'mouse' ? 14 : 28) / v.zoom;
                for (const k of LANDMARK_IDS) { const p = lm[k]; if (!p) continue; const d = Math.hypot(p.x - e.x, p.y - e.y); if (d < bd) { bd = d; best = k; } }
                setSel(best); dragging.current = best ? { id: best, moved: false } : null;
              } else if (e.type === 'move' && dragging.current) {
                const d = dragging.current;
                if (!d.moved) { d.moved = true; store.checkpoint(); }
                const p: Vec2 = { x: Math.round(e.x * 10) / 10, y: Math.round(e.y * 10) / 10 };
                const next = { ...lm, [d.id]: p };
                const c = counterpart(d.id);
                if (sym && c && lm.pelvis) next[c] = { x: 2 * lm.pelvis.x - p.x, y: p.y };
                setLm(next, 'live');
              } else if (e.type === 'up') {
                if (dragging.current?.moved) updatePuppet(store, puppet.id, (pp) => ({ ...pp, views: { ...pp.views, [vid]: { ...pp.views[vid]!, mesh: null, skin: null } } }), 'live');
                dragging.current = null;
              }
            }} />}
        </div>
      </div>
      <aside className={st.panel}>
        <div className={ed.section}>
          <h4>Giunti — {VIEW_LABEL[vid]}</h4>
          <span className={ed.help}>{vid === 'side' || vid === 'climb' || vid === 'jump' ? 'Profilo: «vicino» = arti più vicini a chi guarda, «lontano» = arti nascosti dietro.' : 'Sx/dx sono i lati dell’immagine, non del personaggio.'} Trascina i punti bianchi sulla figura: il posizionamento automatico è solo un punto di partenza.</span>
          <div className={st.list}>
            {LANDMARK_IDS.map((k) => (
              <button key={k} className={st.item} aria-current={sel === k} onClick={() => setSel(k)}>
                <span>{landmarkLabel(k, vid)}</span><span className={st.tag}>{lm[k] ? `${Math.round(lm[k]!.x)}, ${Math.round(lm[k]!.y)}` : '—'}</span>
              </button>
            ))}
          </div>
          {!complete && <span className={st.bad}>Mancano dei giunti: premi «Posiziona dal modello».</span>}
          <button className={ed.btn} onClick={() => { if (cut) setLm(snapInside(cut.img, lm)); }}>Riporta i giunti dentro la sagoma</button>
        </div>
      </aside>
    </div>
  );
}
