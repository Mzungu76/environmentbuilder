'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { BONE_IDS, type BoneId, type Pose, type PuppetView } from '@/types';
import { buildManikin, DEFAULT_MANIKIN, type ManikinBuild } from '@/engine/puppet/manikin';
import { samplePose } from '@/engine/puppet/animation';
import { buildRig } from '@/engine/puppet/skeleton';
import { resolveView } from '@/engine/puppet/runtime';
import { imgToBlob, imgToCanvas, pruneAssets, storePuppetImage, updatePuppet } from '@/lib/studio/pipeline';
import { ZoomCanvas } from './ZoomCanvas';
import { drawBones, renderPuppet } from './draw';
import { ed, st, boneLabel, Slider, useAssetImage, useView, ViewTabs, VIEW_LABEL, type StepProps } from './shared';
import { CheckField } from '../inspector/fields';

const POSES: { id: string; label: string; pose: Pose }[] = [
  { id: 'rest', label: 'Riposo', pose: { rot: {}, dx: 0, dy: 0 } },
  { id: 'step', label: 'Passo ampio', pose: { rot: { thighR: -55, shinR: 35, footR: -10, thighL: 40, shinL: 10, uarmR: 30, uarmL: -30, farmR: -15, farmL: -15 }, dx: 0, dy: 0 } },
  { id: 'armup', label: 'Braccia alzate', pose: { rot: { uarmR: -160, farmR: -20, uarmL: -140, farmL: -15, torso: -4 }, dx: 0, dy: 0 } },
  { id: 'kick', label: 'Calcio', pose: { rot: { thighR: -85, shinR: 15, footR: -10, torso: -6, uarmL: -40, uarmR: 35 }, dx: 0, dy: 0 } },
  { id: 'climb', label: 'Arrampicata', pose: { rot: { uarmR: -150, farmR: -25, uarmL: -125, farmL: -20, thighR: -75, shinR: 65, thighL: 12, torso: 4 }, dx: 0, dy: -0.01 } },
  { id: 'crouch', label: 'Accovacciato', pose: { rot: { thighR: -65, thighL: -60, shinR: 85, shinL: 80, torso: 24, uarmR: -30, uarmL: -25 }, dx: 0, dy: 0.05 } },
];

/**
 * Step 6 (prototype) — "Manichino": rebuilds the figure as separate parts with their own mesh and UV island, baked from the
 * view's image (hidden areas are reconstructed). Compare it side by side with the single-image mesh on wide poses.
 */
export function ManikinStep({ store, puppet, projectId, go }: StepProps) {
  const [vid, setVid, view] = useView(puppet);
  const cut = useAssetImage(projectId, view?.cutoutAssetId);
  const atlas = useAssetImage(projectId, view?.manikin?.atlasAssetId);
  const [params, setParams] = useState(view?.manikin?.params ?? DEFAULT_MANIKIN);
  const [mode, setMode] = useState<'compare' | 'parts' | 'atlas' | 'test'>('compare');
  const [bone, setBone] = useState<BoneId>('thighR');
  const [rot, setRot] = useState(0);
  const [poseId, setPoseId] = useState('step');
  const [clipId, setClipId] = useState<string>('');
  const [playing, setPlaying] = useState(false);
  const [phase, setPhase] = useState(0);
  const [ver, setVer] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [debug, setDebug] = useState<ManikinBuild | null>(null);
  const rig = useMemo(() => (view ? buildRig(view) : null), [view]);

  useEffect(() => { if (view?.manikin) setParams(view.manikin.params); setDebug(null); }, [vid]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setVer((n) => n + 1), [view, atlas, cut, mode, bone, rot, poseId, phase, clipId]);
  useEffect(() => {
    if (!playing || !view) return;
    const clip = view.clips.find((c) => c.id === clipId) ?? view.clips[0];
    if (!clip) return;
    let raf = 0, last = performance.now();
    const loop = (now: number) => { const dt = (now - last) / 1000; last = now; setPhase((p) => (p + dt / Math.max(0.05, clip.duration)) % 1); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, clipId, view]);
  // parts overlay needs the build: recompute lazily
  useEffect(() => {
    if (mode !== 'parts' || debug || !cut || !view || !rig) return;
    setDebug(buildManikin(cut.img, view, vid, params));
  }, [mode, debug, cut, view, rig, vid, params]);

  if (!view) return <div className={st.empty}>Genera prima le viste (passo 3).</div>;
  if (!rig) return <div className={st.empty}>Posiziona prima tutti i giunti (passo 4).</div>;

  const generate = async () => {
    if (!cut) return;
    setBusy(true); setMsg(null);
    try {
      const b = buildManikin(cut.img, view, vid, params);
      if (!b) { setMsg('Scheletro incompleto.'); setBusy(false); return; }
      const meta = await storePuppetImage(store, await imgToBlob(b.atlas), `${puppet.name}-${vid}-manichino.png`, b.atlas.width, b.atlas.height);
      updatePuppet(store, puppet.id, (p) => ({ ...p, assets: [...p.assets, meta], views: { ...p.views, [vid]: { ...p.views[vid]!, manikin: { enabled: true, atlasAssetId: meta.id, width: b.atlas.width, height: b.atlas.height, mesh: b.mesh, skin: b.skin, params } } } }));
      await pruneAssets(store, puppet.id);
      setDebug(b); setMsg(`Manichino creato: ${b.parts.length} parti, ${b.mesh.indices.length / 3} triangoli, atlante ${b.atlas.width}×${b.atlas.height}.`);
    } catch (e) { setMsg(`Errore: ${e instanceof Error ? e.message : e}`); }
    setBusy(false);
  };
  const setManikin = (patch: Partial<NonNullable<PuppetView['manikin']>>) => updatePuppet(store, puppet.id, (p) => ({ ...p, views: { ...p.views, [vid]: { ...p.views[vid]!, manikin: { ...p.views[vid]!.manikin!, ...patch } } } }));
  const remove = () => { updatePuppet(store, puppet.id, (p) => { const v = { ...p.views[vid]! }; delete v.manikin; return { ...p, views: { ...p.views, [vid]: v } }; }); void pruneAssets(store, puppet.id); setDebug(null); };

  const clip = view.clips.find((c) => c.id === clipId) ?? null;
  const base = POSES.find((p) => p.id === poseId)!.pose;
  const pose: Pose = playing && clip ? samplePose(clip, phase) : { ...base, rot: { ...base.rot, [bone]: (base.rot[bone] ?? 0) + rot } };
  const m = view.manikin;
  const manikinView: PuppetView | null = m ? resolveView({ ...view, manikin: { ...m, enabled: true } }) : null;
  const W = view.width, Hh = view.height;
  const contentW = mode === 'compare' ? W * 2 + 60 : mode === 'atlas' && m ? m.width : W;
  const contentH = mode === 'atlas' && m ? m.height : Hh;

  return (
    <div className={st.main}>
      <div className={st.stage}>
        <div className={st.toolbar}>
          <ViewTabs puppet={puppet} value={vid} onChange={setVid} />
          <div className={ed.seg} role="group" aria-label="Visualizzazione">
            {([['compare', 'Confronto'], ['test', 'Manichino'], ['parts', 'Parti'], ['atlas', 'Atlante']] as const).map(([k, l]) => <button key={k} aria-pressed={mode === k} onClick={() => setMode(k)} data-testid={`mk-${k}`}>{l}</button>)}
          </div>
          <button className={`${ed.btn} ${ed.btnPrimary}`} onClick={() => go(6)} data-testid="next-step">Avanti: animazioni →</button>
        </div>
        <div className={st.canvasWrap}>
          {cut && <ZoomCanvas contentWidth={contentW} contentHeight={contentH} version={ver} fitKey={`${vid}${mode}${view.cutoutAssetId}`} checker testId="manikin-canvas"
            draw={(ctx, v) => {
              if (mode === 'atlas') { if (atlas) ctx.drawImage(atlas.canvas, 0, 0); return; }
              if (mode === 'parts') {
                ctx.globalAlpha = 0.5; ctx.drawImage(cut.canvas, 0, 0); ctx.globalAlpha = 1;
                debug?.parts.forEach((p, i) => {
                  const hue = (i * 47) % 360; ctx.strokeStyle = `hsl(${hue} 85% 60%)`; ctx.fillStyle = `hsla(${hue} 85% 60% / .14)`; ctx.lineWidth = 1.6 / v.zoom;
                  ctx.beginPath(); p.quad.forEach((q, k) => (k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); ctx.fill(); ctx.stroke();
                });
                drawBones(ctx, rig, null, v.zoom); return;
              }
              if (mode === 'compare') {
                ctx.save(); renderPuppet(ctx, cut.canvas, resolveView({ ...view, manikin: undefined }), pose); ctx.restore();
                ctx.save(); ctx.translate(W + 60, 0);
                if (manikinView && atlas) renderPuppet(ctx, atlas.canvas, manikinView, pose); else { ctx.fillStyle = '#9aa3b2'; ctx.font = `${22 / v.zoom * v.zoom}px sans-serif`; ctx.fillText('Premi «Genera il manichino»', 20, 60); }
                ctx.restore();
                ctx.fillStyle = '#e6e8ec'; ctx.font = '22px sans-serif'; ctx.fillText('Immagine unica (attuale)', 10, 28); ctx.fillText('Manichino a parti', W + 70, 28);
                return;
              }
              if (manikinView && atlas) { renderPuppet(ctx, atlas.canvas, manikinView, pose); drawBones(ctx, rig, pose, v.zoom); } else ctx.drawImage(cut.canvas, 0, 0);
            }} />}
        </div>
        {msg && <div className={ed.banner} style={{ position: 'static' }} role="status" data-testid="mk-msg">{msg}</div>}
      </div>
      <aside className={st.panel}>
        <div className={ed.section}>
          <h4>Manichino a parti — {VIEW_LABEL[vid]} <span className={st.tag}>prototipo</span></h4>
          <span className={ed.help}>Ricostruisce la figura come <b>parti separate</b> (testa, busto, braccia, gambe…), ognuna con la sua mesh e la sua porzione di texture «cotta» dall’immagine. Le zone nascoste (es. il busto sotto il braccio) vengono ricostruite. Così i movimenti ampi non strappano l’immagine. Scheletro e animazioni restano gli stessi.</span>
          <Slider id="mk-ov" label="Sovrapposizione alle giunture" value={params.overlap} min={0.05} max={0.35} step={0.01} onChange={(v) => setParams({ ...params, overlap: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
          <Slider id="mk-seg" label="Righe per parte" value={params.segments} min={3} max={14} onChange={(v) => setParams({ ...params, segments: v })} />
          <Slider id="mk-cols" label="Colonne per parte" value={params.cols} min={1} max={8} onChange={(v) => setParams({ ...params, cols: v })} />
          <Slider id="mk-wid" label="Spessore delle parti" value={params.widthScale} min={0.7} max={1.4} step={0.02} onChange={(v) => setParams({ ...params, widthScale: v })} fmt={(v) => `×${v.toFixed(2)}`} />
          {['side', 'climb', 'jump'].includes(vid) && <Slider id="mk-far" label="Ombra degli arti lontani" value={params.farShade} min={0} max={0.6} step={0.02} onChange={(v) => setParams({ ...params, farShade: v })} fmt={(v) => v.toFixed(2)} />}
          <CheckField id="mk-inp" label="Ricostruisci le zone nascoste" checked={params.inpaint} onChange={(v) => setParams({ ...params, inpaint: v })} />
          <button className={`${ed.btn} ${ed.btnPrimary}`} disabled={busy || !cut} onClick={generate} data-testid="generate-manikin">{busy ? 'Elaborazione…' : m ? 'Rigenera il manichino' : 'Genera il manichino'}</button>
          {m && (
            <>
              <CheckField id="mk-on" label="Usa il manichino al posto dell’immagine (anteprima, Playtest, esportazione)" checked={m.enabled} onChange={(v) => setManikin({ enabled: v })} />
              <button className={`${ed.btn} ${ed.btnDanger}`} onClick={remove}>Elimina il manichino di questa vista</button>
            </>
          )}
        </div>
        <div className={ed.section}>
          <h4>Pose di prova</h4>
          <div className={ed.checkGrid}>{POSES.map((p) => <button key={p.id} className={ed.chip} aria-pressed={!playing && poseId === p.id} onClick={() => { setPlaying(false); setPoseId(p.id); setRot(0); }} data-testid={`pose-${p.id}`}>{p.label}</button>)}</div>
          <div className={st.list} style={{ maxHeight: 150, overflowY: 'auto' }}>{BONE_IDS.map((b) => <button key={b} className={st.item} aria-current={bone === b} onClick={() => { setBone(b); setRot(0); }}>{boneLabel(b, vid)}</button>)}</div>
          <Slider id="mk-rot" label={`Ruota in più «${boneLabel(bone, vid)}»`} value={rot} min={-150} max={150} onChange={(v) => { setPlaying(false); setRot(v); }} fmt={(v) => `${v}°`} />
          <div className={ed.row2} style={{ gridTemplateColumns: '1fr auto' }}>
            <select className={ed.select} value={clipId} onChange={(e) => setClipId(e.target.value)} aria-label="Animazione" data-testid="mk-clip"><option value="">Animazione…</option>{view.clips.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <button className={ed.btn} disabled={!clipId} onClick={() => setPlaying((p) => !p)} data-testid="mk-play">{playing ? 'Pausa' : 'Riproduci'}</button>
          </div>
          <span className={ed.help}>«Confronto» mostra a sinistra l’immagine unica e a destra il manichino nella stessa posa: provate le pose ampie.</span>
        </div>
      </aside>
    </div>
  );
}
