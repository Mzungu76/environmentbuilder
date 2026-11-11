'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { BONE_IDS, type BoneId, type CharacterState, type Clip, type Pose, type PuppetView } from '@/types';
import { makePreset, PRESET_LABEL, PRESET_STATE, samplePose, type PresetKind } from '@/engine/puppet/animation';
import { apply, boneMatrices, parentRotation, restAngle, buildRig } from '@/engine/puppet/skeleton';
import { updatePuppet } from '@/lib/studio/pipeline';
import { uid } from '@/lib/ids';
import { ZoomCanvas } from './ZoomCanvas';
import { renderPuppet } from './draw';
import { ed, st, boneLabel, Slider, useAssetImage, useView, ViewTabs, type StepProps } from './shared';
import { CheckField, NumberField, TextField } from '../inspector/fields';

const STATES: CharacterState[] = ['IDLE', 'WALK', 'CLIMB', 'INTERACT', 'COLLECT', 'JUMP', 'FALL', 'CUSTOM'];
const KINDS = Object.keys(PRESET_LABEL) as PresetKind[];

/** Step 6 — clips made of keyframes: start from a preset, then drag the bones (a key is created where you drag). */
export function AnimateStep({ store, puppet, projectId, go }: StepProps) {
  const [vid, setVid, view] = useView(puppet);
  const cut = useAssetImage(projectId, view?.cutoutAssetId);
  const [clipId, setClipId] = useState<string | null>(null);
  const [phase, setPhase] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selKey, setSelKey] = useState<number | null>(null);
  const [kind, setKind] = useState<PresetKind>('walk');
  const [amount, setAmount] = useState(1);
  const [ver, setVer] = useState(0);
  const drag = useRef<{ bone: BoneId; moved: boolean } | null>(null);
  const clip = view?.clips.find((c) => c.id === clipId) ?? view?.clips[0];
  const rig = useMemo(() => (view ? buildRig(view) : null), [view]);

  useEffect(() => { if (view && !view.clips.some((c) => c.id === clipId)) setClipId(view.clips[0]?.id ?? null); }, [view, clipId]);
  useEffect(() => setVer((n) => n + 1), [view, phase, selKey, clip]);

  // playback
  useEffect(() => {
    if (!playing || !clip) return;
    let raf = 0, last = performance.now();
    const loop = (now: number) => { const dt = (now - last) / 1000; last = now; setPhase((p) => { const n = p + dt / Math.max(0.05, clip.duration); return clip.loop ? n % 1 : Math.min(1, n); }); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, clip?.id, clip?.duration, clip?.loop]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!view) return <div className={st.empty}>Genera prima le viste (passo 3).</div>;
  if (!view.mesh || !view.skin || !rig) return <div className={st.empty}>Completa scheletro, mesh e pesi per questa vista (passi 4–5).</div>;

  const setClips = (fn: (clips: Clip[], sc: PuppetView['stateClips']) => { clips: Clip[]; stateClips?: PuppetView['stateClips'] }, mode: 'commit' | 'live' = 'commit') =>
    updatePuppet(store, puppet.id, (p) => { const v = p.views[vid]!; const r = fn(v.clips, v.stateClips); return { ...p, views: { ...p.views, [vid]: { ...v, clips: r.clips, stateClips: r.stateClips ?? v.stateClips } } }; }, mode);
  const setClip = (patch: Partial<Clip>, mode: 'commit' | 'live' = 'commit') => clip && setClips((cs) => ({ clips: cs.map((c) => (c.id === clip.id ? { ...c, ...patch } : c)) }), mode);

  const keys = clip?.keys ?? [];
  const nearKey = keys.findIndex((k) => Math.abs(k.t - phase) < 0.02);
  const pose: Pose = clip ? (nearKey >= 0 ? keys[nearKey].pose : samplePose(clip, phase)) : { rot: {}, dx: 0, dy: 0 };

  const addKeyAtPhase = (): number => {
    if (!clip) return -1;
    const k = { t: Math.round(phase * 1000) / 1000, pose: JSON.parse(JSON.stringify(samplePose(clip, phase))) as Pose };
    const next = [...clip.keys, k].sort((a, b) => a.t - b.t);
    setClip({ keys: next }); const idx = next.findIndex((x) => x === k); setSelKey(idx); return idx;
  };

  return (
    <div className={st.main}>
      <div className={st.stage}>
        <div className={st.toolbar}>
          <ViewTabs puppet={puppet} value={vid} onChange={(v) => { setVid(v); setClipId(null); setSelKey(null); }} requireMesh />
          <button className={`${ed.btn} ${playing ? ed.btnPrimary : ''}`} onClick={() => setPlaying((p) => !p)} data-testid="anim-play">{playing ? 'Pausa' : 'Riproduci'}</button>
          <button className={`${ed.btn} ${ed.btnPrimary}`} onClick={() => go(6)} data-testid="next-step">Avanti: anteprima ed esporta →</button>
        </div>
        <div className={st.canvasWrap} style={{ display: 'grid', gridTemplateRows: '1fr auto', gap: 8 }}>
          {cut && <ZoomCanvas contentWidth={cut.img.width} contentHeight={cut.img.height} version={ver} fitKey={`${vid}${view.cutoutAssetId}`} checker testId="anim-canvas"
            draw={(ctx, v) => {
              renderPuppet(ctx, cut.canvas, view, pose);
              const mats = boneMatrices(rig, pose);
              for (const b of rig.bones) {
                const t = apply(mats[b.index], b.tail);
                ctx.beginPath(); ctx.arc(t.x, t.y, 6 / v.zoom, 0, Math.PI * 2); ctx.fillStyle = drag.current?.bone === b.id ? '#fde047' : 'rgba(255,255,255,.9)'; ctx.fill(); ctx.lineWidth = 2 / v.zoom; ctx.strokeStyle = '#111'; ctx.stroke();
              }
            }}
            onPointer={(e, v) => {
              if (!clip) return;
              if (e.type === 'down') {
                const mats = boneMatrices(rig, pose);
                let best: BoneId | null = null, bd = (e.pointerType === 'mouse' ? 14 : 28) / v.zoom;
                for (const b of rig.bones) { const t = apply(mats[b.index], b.tail); const d = Math.hypot(t.x - e.x, t.y - e.y); if (d < bd) { bd = d; best = b.id; } }
                if (best) { drag.current = { bone: best, moved: false }; setPlaying(false); }
              } else if (e.type === 'move' && drag.current) {
                const d = drag.current;
                if (!d.moved) { d.moved = true; store.checkpoint(); }
                // ensure a key exists at this phase, then rotate the bone towards the pointer
                let idx = nearKey;
                let ks = clip.keys;
                if (idx < 0) { const k = { t: Math.round(phase * 1000) / 1000, pose: JSON.parse(JSON.stringify(samplePose(clip, phase))) as Pose }; ks = [...clip.keys, k].sort((a, b) => a.t - b.t); idx = ks.findIndex((x) => x === k); setSelKey(idx); }
                const key = ks[idx], bone = rig.bones.find((b) => b.id === d.bone)!;
                const mats = boneMatrices(rig, key.pose);
                const head = apply(mats[bone.index], bone.head);
                const target = (Math.atan2(e.y - head.y, e.x - head.x) * 180) / Math.PI;
                let rot = target - restAngle(bone) - parentRotation(rig, key.pose, bone.index);
                rot = ((rot + 540) % 360) - 180;
                const np: Pose = { ...key.pose, rot: { ...key.pose.rot, [d.bone]: Math.round(rot * 10) / 10 } };
                setClips((cs) => ({ clips: cs.map((c) => (c.id === clip.id ? { ...c, keys: ks.map((k, i) => (i === idx ? { ...k, pose: np } : k)) } : c)) }), 'live');
              } else if (e.type === 'up') drag.current = null;
            }} />}
          {clip && (
            <div className={ed.section} style={{ borderRadius: 8, border: '1px solid var(--border)' }}>
              <Slider id="phase" label="Istante del ciclo" value={phase} min={0} max={1} step={0.005} onChange={(v) => { setPhase(v); setPlaying(false); }} fmt={(v) => `${Math.round(v * 100)}%  ·  ${(v * clip.duration).toFixed(2)} s`} />
              <div className={ed.checkGrid} data-testid="keys">
                {keys.map((k, i) => <button key={i} className={ed.chip} aria-pressed={selKey === i || nearKey === i} onClick={() => { setSelKey(i); setPhase(k.t); setPlaying(false); }}>◆ {Math.round(k.t * 100)}%</button>)}
                <button className={ed.btn} style={{ height: 28 }} onClick={addKeyAtPhase} data-testid="add-key">+ Chiave qui</button>
                {nearKey >= 0 && keys.length > 2 && <button className={`${ed.btn} ${ed.btnDanger}`} style={{ height: 28 }} onClick={() => { setClip({ keys: keys.filter((_, i) => i !== nearKey) }); setSelKey(null); }}>Elimina chiave</button>}
              </div>
            </div>
          )}
        </div>
      </div>
      <aside className={st.panel}>
        <div className={ed.section}>
          <h4>Animazioni — {vid}</h4>
          <div className={st.list} data-testid="clips">
            {view.clips.map((c) => <button key={c.id} className={st.item} aria-current={clip?.id === c.id} onClick={() => { setClipId(c.id); setSelKey(null); setPhase(0); }}><span>{c.name}</span><span className={st.tag}>{c.keys.length} chiavi · {c.duration}s</span></button>)}
          </div>
          <div className={ed.row2} style={{ gridTemplateColumns: '1fr auto' }}>
            <select className={ed.select} value={kind} onChange={(e) => setKind(e.target.value as PresetKind)} aria-label="Preset">{KINDS.map((k) => <option key={k} value={k}>{PRESET_LABEL[k]}</option>)}</select>
            <button className={ed.btn} onClick={() => { const c = makePreset(kind, vid, amount); setClips((cs, sc) => ({ clips: [...cs, c], stateClips: { ...sc, [PRESET_STATE[kind]]: sc[PRESET_STATE[kind]] ?? c.id } })); setClipId(c.id); }} data-testid="add-preset">Aggiungi</button>
          </div>
          <Slider id="amt" label="Ampiezza del preset" value={amount} min={0.2} max={2} step={0.1} onChange={setAmount} fmt={(v) => `×${v.toFixed(1)}`} />
        </div>
        {clip && (
          <div className={ed.section}>
            <h4>Clip selezionata</h4>
            <TextField id="c-name" label="Nome" value={clip.name} onCommit={(v) => setClip({ name: v })} />
            <div className={ed.row2}>
              <NumberField id="c-dur" label="Durata (s)" value={clip.duration} min={0.1} max={30} step={0.1} onCommit={(v) => setClip({ duration: v })} />
              <NumberField id="c-cyc" label="Passo per ciclo" value={clip.cycleLength ?? 0} min={0} max={5} step={0.05} onCommit={(v) => setClip({ cycleLength: v || undefined })} help="Distanza percorsa in un ciclo, in altezze del personaggio (0 = nessuna sincronia). Evita i piedi che scivolano." />
            </div>
            <CheckField id="c-loop" label="Ripeti" checked={clip.loop} onChange={(v) => setClip({ loop: v })} />
            <div className={ed.row2}>
              <NumberField id="k-dx" label="Spostamento X (altezze)" value={pose.dx} step={0.005} onCommit={(v) => { const i = nearKey >= 0 ? nearKey : addKeyAtPhase(); const ks = (view.clips.find((c) => c.id === clip.id)?.keys ?? keys).map((k, j) => (j === i ? { ...k, pose: { ...k.pose, dx: v } } : k)); setClip({ keys: ks }); }} />
              <NumberField id="k-dy" label="Spostamento Y (altezze)" value={pose.dy} step={0.005} onCommit={(v) => { const i = nearKey >= 0 ? nearKey : addKeyAtPhase(); const ks = (view.clips.find((c) => c.id === clip.id)?.keys ?? keys).map((k, j) => (j === i ? { ...k, pose: { ...k.pose, dy: v } } : k)); setClip({ keys: ks }); }} />
            </div>
            <span className={ed.help}>Trascina i cerchi bianchi sul personaggio per ruotare le ossa: dove trascini si crea una chiave. Angoli: {BONE_IDS.filter((b) => pose.rot[b]).map((b) => `${boneLabel(b, vid)} ${Math.round(pose.rot[b]!)}°`).join(' · ') || 'posa di riposo'}</span>
            <button className={`${ed.btn} ${ed.btnDanger}`} disabled={view.clips.length <= 1} onClick={() => { setClips((cs, sc) => { const rest = cs.filter((c) => c.id !== clip.id); const m = { ...sc }; for (const k of Object.keys(m) as CharacterState[]) if (m[k] === clip.id) m[k] = rest[0]?.id; return { clips: rest, stateClips: m }; }); setClipId(null); }}>Elimina clip</button>
          </div>
        )}
        <div className={ed.section}>
          <h4>Quale animazione per quale stato</h4>
          {STATES.map((s) => (
            <label key={s} className={ed.field}><span>{s}</span>
              <select className={ed.select} value={view.stateClips[s] ?? ''} onChange={(e) => setClips((cs, sc) => ({ clips: cs, stateClips: { ...sc, [s]: e.target.value || undefined } }))} data-testid={`state-${s}`}>
                <option value="">— (usa IDLE)</option>{view.clips.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          ))}
        </div>
      </aside>
    </div>
  );
}
