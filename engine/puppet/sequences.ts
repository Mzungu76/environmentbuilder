import type { Clip, Pose, PuppetView } from '@/types';
import { uid } from '@/lib/ids';
import { makePreset, PRESET_LABEL, samplePose, type PresetKind } from './animation';

/**
 * Movement sequences: several clips chained into ONE clip (keyframes are concatenated, with a short blend between parts), so the
 * player, the preview and the export need nothing new — a sequence is just a clip.
 */
export interface SeqStep { kind: PresetKind; /** times the step is played (looping clips) */ repeat?: number; /** playback speed factor */ speed?: number }
export interface SeqDef { id: string; label: string; help: string; steps: SeqStep[]; loop?: boolean }

export const SEQUENCES: SeqDef[] = [
  { id: 'explore', label: 'Esplora', help: 'Si ferma, si guarda intorno, cammina un po’ e torna a riposo.', steps: [{ kind: 'idle' }, { kind: 'lookAround' }, { kind: 'walk', repeat: 3 }, { kind: 'lookAround' }] },
  { id: 'pickup', label: 'Raccogli e rialzati', help: 'Si china, raccoglie da terra, si rialza e mostra l’oggetto.', steps: [{ kind: 'crouch' }, { kind: 'pickUp' }, { kind: 'showObject' }] },
  { id: 'obstacle', label: 'Corsa e salto', help: 'Rincorsa, preparazione, salto e atterraggio.', steps: [{ kind: 'run', repeat: 3 }, { kind: 'crouch', speed: 2 }, { kind: 'jump' }, { kind: 'land' }] },
  { id: 'discover', label: 'Scoperta', help: 'Sorpresa, un respiro, poi esulta.', steps: [{ kind: 'surprised' }, { kind: 'idle' }, { kind: 'celebrate', repeat: 2 }] },
  { id: 'miner', label: 'Scava', help: 'Colpi di piccone ripetuti e una pausa.', steps: [{ kind: 'dig', repeat: 3 }, { kind: 'idle' }] },
  { id: 'danger', label: 'Pericolo', help: 'Spavento, indietreggia, colpo subito e si riprende.', steps: [{ kind: 'scared', repeat: 3 }, { kind: 'hit' }, { kind: 'crouch' }] },
  { id: 'greet', label: 'Saluto', help: 'Saluta con la mano e torna a riposo.', steps: [{ kind: 'wave', repeat: 3 }, { kind: 'idle' }] },
];

const GAP = 0.15;   // seconds of blend between two parts

/** Chains clips (already built) into one. Looping clips are repeated `repeat` times; each part is closed back on its first pose. */
export function concatClips(parts: { clip: Clip; repeat?: number; speed?: number }[], name: string, loop = false, gap = GAP): Clip {
  type K = { time: number; pose: Pose };
  const out: K[] = [];
  let T = 0;
  const copy = (p: Pose): Pose => JSON.parse(JSON.stringify(p));
  parts.forEach(({ clip, repeat = 1, speed = 1 }, idx) => {
    const d = clip.duration / Math.max(0.1, speed);
    const reps = clip.loop ? Math.max(1, repeat) : 1;
    for (let r = 0; r < reps; r++) for (const k of clip.keys) { const t = T + (r + k.t) * d; if (!(clip.loop && k.t >= 1)) out.push({ time: t, pose: copy(k.pose) }); }
    if (clip.loop) out.push({ time: T + reps * d, pose: copy(clip.keys[0].pose) });    // close the cycle
    T += reps * d + (idx < parts.length - 1 ? gap : 0);
  });
  const dur = Math.max(0.1, T), merged: K[] = [];
  for (const k of out.sort((a, b) => a.time - b.time)) { const last = merged[merged.length - 1]; if (last && k.time - last.time < 1e-3) merged[merged.length - 1] = k; else merged.push(k); }
  return { id: uid('clip'), name, duration: Math.round(dur * 100) / 100, loop, keys: merged.map((k) => ({ t: Math.min(1, k.time / dur), pose: k.pose })) };
}

/**
 * Builds a sequence for a view. Steps use the view's existing clip of that kind when there is one (matched by name), otherwise a
 * preset is created. Returns the sequence clip plus any preset clips that had to be added to the view.
 */
export function buildSequence(def: SeqDef, view: PuppetView, amount = 1): { clip: Clip; added: Clip[] } {
  const added: Clip[] = [];
  const parts = def.steps.map((s) => {
    const label = PRESET_LABEL[s.kind];
    let clip = [...view.clips, ...added].find((c) => c.name === label);
    if (!clip) { clip = makePreset(s.kind, view.id, amount, view); added.push(clip); }
    return { clip, repeat: s.repeat, speed: s.speed };
  });
  return { clip: concatClips(parts, def.label, !!def.loop), added };
}

export const poseAtTime = (clip: Clip, seconds: number): Pose => samplePose(clip, clip.loop ? seconds / clip.duration : Math.min(1, seconds / clip.duration));
