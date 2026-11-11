'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { BONE_IDS, type BoneId, type Pose, type Skin } from '@/types';
import { addFarLimbs, adjacency, autoWeights, denseToSkin, generateMesh, paintWeights, skinToDense, type BrushMode } from '@/engine/puppet/mesh';
import { buildRig } from '@/engine/puppet/skeleton';
import { updatePuppet } from '@/lib/studio/pipeline';
import { ZoomCanvas } from './ZoomCanvas';
import { drawBones, renderPuppet } from './draw';
import { CheckField } from '../inspector/fields';
import { ed, st, boneLabel, Slider, useAssetImage, useView, ViewTabs, VIEW_LABEL, type StepProps } from './shared';

const NB = BONE_IDS.length;

/** Step 5 — triangle mesh over the silhouette, automatic bone weights, weight-paint brush and a live deformation test. */
export function MeshStep({ store, puppet, projectId, go }: StepProps) {
  const [vid, setVid, view] = useView(puppet);
  const cut = useAssetImage(projectId, view?.cutoutAssetId);
  const [cell, setCell] = useState(14);
  const [margin, setMargin] = useState(6);
  const [bone, setBone] = useState<BoneId>('torso');
  const [mode, setMode] = useState<BrushMode>('assign');
  const [radius, setRadius] = useState(40);
  const [strength, setStrength] = useState(0.6);
  const [show, setShow] = useState<'weights' | 'wire' | 'test'>('weights');
  const [testRot, setTestRot] = useState(0);
  const [ver, setVer] = useState(0);
  const dense = useRef<Float32Array | null>(null);
  const adj = useRef<number[][] | null>(null);
  const painting = useRef(false);
  const rig = useMemo(() => (view ? buildRig(view) : null), [view]);

  // dense weights + adjacency follow the stored mesh/skin
  useEffect(() => {
    if (view?.mesh && view.skin && cut) { dense.current = skinToDense(view.skin); adj.current = adjacency(view.mesh, cut.img); } else { dense.current = null; adj.current = null; }
    setVer((n) => n + 1);
  }, [view?.mesh, view?.skin, cut]);

  useEffect(() => setVer((n) => n + 1), [bone, show, testRot, vid, mode]);

  const setView = (patch: Partial<NonNullable<typeof view>>, mode2: 'commit' | 'live' = 'commit') =>
    updatePuppet(store, puppet.id, (p) => ({ ...p, views: { ...p.views, [vid]: { ...p.views[vid]!, ...patch } } }), mode2);

  const generate = () => {
    if (!cut || !view || !rig) return;
    const base = generateMesh(cut.img, cell, margin);
    const skin0 = denseToSkin(autoWeights(base, rig, vid, view.weightParams, cut.img));
    const far = view.farLimbs ?? { arm: vid === 'side', leg: vid === 'side' };
    const r = vid === 'side' ? addFarLimbs(base, skin0, far) : { mesh: base, skin: skin0 };
    setView({ mesh: r.mesh, skin: r.skin, farLimbs: far });
  };
  const recompute = () => {
    if (!cut || !view || !rig || !view.mesh) return;
    generate(); // far limbs and weights are rebuilt together
  };

  if (!view) return <div className={st.empty}>Genera prima le viste (passo 3).</div>;
  if (!rig) return <div className={st.empty}>Posiziona prima tutti i giunti (passo 4).</div>;

  const testPose: Pose = { rot: { [bone]: testRot }, dx: 0, dy: 0 };
  const bi = BONE_IDS.indexOf(bone);
  const heat = (w: number) => `rgba(${Math.round(255 * w)}, ${Math.round(80 + 100 * (1 - Math.abs(w - 0.5) * 2))}, ${Math.round(255 * (1 - w))}, ${0.15 + 0.6 * w})`;

  return (
    <div className={st.main}>
      <div className={st.stage}>
        <div className={st.toolbar}>
          <ViewTabs puppet={puppet} value={vid} onChange={setVid} requireMesh />
          <div className={ed.seg} role="group" aria-label="Visualizzazione">
            {([['weights', 'Pesi'], ['wire', 'Mesh'], ['test', 'Prova deformazione']] as const).map(([m, l]) => <button key={m} aria-pressed={show === m} onClick={() => setShow(m)} data-testid={`show-${m}`}>{l}</button>)}
          </div>
          <button className={`${ed.btn} ${ed.btnPrimary}`} disabled={!view.skin} onClick={() => go(5)} data-testid="next-step">Avanti: animazioni →</button>
        </div>
        <div className={st.canvasWrap}>
          {cut && <ZoomCanvas contentWidth={cut.img.width} contentHeight={cut.img.height} version={ver} fitKey={`${vid}${view.cutoutAssetId}`} checker testId="mesh-canvas"
            cursor={show === 'weights' && view.mesh ? 'crosshair' : 'default'}
            draw={(ctx, v) => {
              if (show === 'test' && view.mesh && view.skin) { renderPuppet(ctx, cut.canvas, view, testPose); drawBones(ctx, rig, testPose, v.zoom, bi); return; }
              ctx.globalAlpha = 0.85; ctx.drawImage(cut.canvas, 0, 0); ctx.globalAlpha = 1;
              const m = view.mesh;
              if (m) {
                if (show === 'weights' && dense.current) {
                  const d = dense.current;
                  for (let t = 0; t < m.indices.length; t += 3) {
                    const [a, b, c] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]];
                    const w = (d[a * NB + bi] + d[b * NB + bi] + d[c * NB + bi]) / 3;
                    if (w < 0.03) continue;
                    ctx.fillStyle = heat(w); ctx.beginPath();
                    ctx.moveTo(m.vertices[a * 2], m.vertices[a * 2 + 1]); ctx.lineTo(m.vertices[b * 2], m.vertices[b * 2 + 1]); ctx.lineTo(m.vertices[c * 2], m.vertices[c * 2 + 1]); ctx.closePath(); ctx.fill();
                  }
                } else if (show === 'wire') {
                  ctx.strokeStyle = 'rgba(79,140,255,.7)'; ctx.lineWidth = 1 / v.zoom; ctx.beginPath();
                  for (let t = 0; t < m.indices.length; t += 3) {
                    const [a, b, c] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]];
                    ctx.moveTo(m.vertices[a * 2], m.vertices[a * 2 + 1]); ctx.lineTo(m.vertices[b * 2], m.vertices[b * 2 + 1]); ctx.lineTo(m.vertices[c * 2], m.vertices[c * 2 + 1]); ctx.closePath();
                  }
                  ctx.stroke();
                }
              }
              drawBones(ctx, rig, null, v.zoom, bi);
            }}
            onPointer={(e) => {
              if (show !== 'weights' || !view.mesh || !dense.current || !adj.current) return;
              const paint = () => { paintWeights(dense.current!, view.mesh!, adj.current!, bi, e.x, e.y, radius, strength, mode); setVer((n) => n + 1); };
              if (e.type === 'down') { painting.current = true; store.checkpoint(); paint(); }
              else if (e.type === 'move' && painting.current) paint();
              else if (e.type === 'up' && painting.current) { painting.current = false; setView({ skin: denseToSkin(dense.current) as Skin }, 'live'); }
            }} />}
        </div>
      </div>
      <aside className={st.panel}>
        <div className={ed.section}>
          <h4>Mesh — {VIEW_LABEL[vid]}</h4>
          <Slider id="m-cell" label="Dimensione delle celle" value={cell} min={8} max={32} onChange={setCell} fmt={(v) => `${v}px (più piccole = più morbido, più lento)`} />
          <Slider id="m-mar" label="Margine attorno alla sagoma" value={margin} min={0} max={24} onChange={setMargin} fmt={(v) => `${v}px`} />
          <button className={`${ed.btn} ${ed.btnPrimary}`} onClick={generate} data-testid="generate-mesh">{view.mesh ? 'Rigenera mesh e pesi' : 'Genera mesh e pesi'}</button>
          {vid === 'side' && (
            <>
              <CheckField id="far-leg" label="Gamba lontana (copia dietro il corpo)" checked={view.farLimbs?.leg ?? true} onChange={(v) => setView({ farLimbs: { arm: view.farLimbs?.arm ?? true, leg: v } })} />
              <CheckField id="far-arm" label="Braccio lontano (copia dietro il corpo)" checked={view.farLimbs?.arm ?? true} onChange={(v) => setView({ farLimbs: { leg: view.farLimbs?.leg ?? true, arm: v } })} />
              <span className={ed.help}>Nel profilo l’immagine mostra una sola gamba e un solo braccio. Le copie permettono di vedere i due arti muoversi in modo opposto. Rigenera la mesh dopo aver cambiato queste opzioni.</span>
            </>
          )}
          {view.mesh && <span className={ed.help}>{view.mesh.vertices.length / 2} vertici · {view.mesh.indices.length / 3} triangoli</span>}
        </div>
        {view.mesh && (
          <>
            <div className={ed.section}>
              <h4>Pesi automatici</h4>
              <Slider id="w-fall" label="Morbidezza delle giunture" value={view.weightParams.falloff} min={0.05} max={1} step={0.05} onChange={(v) => setView({ weightParams: { ...view.weightParams, falloff: v } }, 'live')} fmt={(v) => v.toFixed(2)} />
              <Slider id="w-smo" label="Lisciatura" value={view.weightParams.smooth} min={0} max={8} onChange={(v) => setView({ weightParams: { ...view.weightParams, smooth: v } }, 'live')} />
              {vid === 'side' && <Slider id="w-far" label="Preferenza per gli arti vicini" value={view.weightParams.farPenalty} min={0} max={3} step={0.1} onChange={(v) => setView({ weightParams: { ...view.weightParams, farPenalty: v } }, 'live')} fmt={(v) => v.toFixed(1)} />}
              <button className={ed.btn} onClick={recompute} data-testid="recompute-weights">Ricalcola i pesi (cancella le pennellate)</button>
            </div>
            <div className={ed.section}>
              <h4>Pennello dei pesi</h4>
              <span className={ed.help}>Scegli l’osso, poi dipingi sull’immagine (modalità «Pesi»). Il colore mostra quanto quell’osso muove ogni punto.</span>
              <div className={st.list} style={{ maxHeight: 190, overflowY: 'auto' }}>
                {BONE_IDS.map((b) => <button key={b} className={st.item} aria-current={bone === b} onClick={() => setBone(b)} data-testid={`bone-${b}`}>{boneLabel(b, vid)}</button>)}
              </div>
              <div className={ed.checkGrid}>
                {([['assign', 'Assegna'], ['add', 'Aggiungi'], ['remove', 'Togli'], ['smooth', 'Sfuma']] as const).map(([m, l]) => <button key={m} className={ed.chip} aria-pressed={mode === m} onClick={() => setMode(m)}>{l}</button>)}
              </div>
              <Slider id="b-rad" label="Raggio" value={radius} min={6} max={160} onChange={setRadius} fmt={(v) => `${v}px`} />
              <Slider id="b-str" label="Intensità" value={strength} min={0.1} max={1} step={0.05} onChange={setStrength} fmt={(v) => v.toFixed(2)} />
            </div>
            <div className={ed.section}>
              <h4>Prova deformazione</h4>
              <Slider id="t-rot" label={`Ruota «${boneLabel(bone, vid)}»`} value={testRot} min={-120} max={120} onChange={(v) => { setTestRot(v); setShow('test'); }} fmt={(v) => `${v}°`} />
              <button className={ed.btn} onClick={() => setTestRot(0)}>Azzera</button>
              <span className={ed.help}>Se un pezzo si strappa o trascina parti che non dovrebbe, torna a «Pesi» e correggi con il pennello.</span>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
