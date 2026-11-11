import type { BoneId, CharacterState, Clip, Pose, ViewId } from '@/types';
import { uid } from '@/lib/ids';

export const EMPTY_POSE: Pose = { rot: {}, dx: 0, dy: 0 };
const smooth = (u: number) => (1 - Math.cos(Math.PI * u)) / 2;

/** Pose at `phase` (fraction of the cycle, wraps for looping clips). Cosine interpolation between keyframes. */
export function samplePose(clip: Clip, phase: number): Pose {
  const keys = clip.keys;
  if (!keys.length) return EMPTY_POSE;
  if (keys.length === 1) return keys[0].pose;
  const t = clip.loop ? ((phase % 1) + 1) % 1 : Math.max(0, Math.min(1, phase));
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
  const a = keys[i];
  let b = keys[i + 1], bt = b?.t ?? 1;
  if (!b) { if (!clip.loop) return a.pose; b = { ...keys[0], t: 1 }; bt = 1; }
  const span = Math.max(1e-6, bt - a.t);
  const u = smooth(Math.max(0, Math.min(1, (t - a.t) / span)));
  const rot: Partial<Record<BoneId, number>> = {};
  for (const k of new Set([...Object.keys(a.pose.rot), ...Object.keys(b.pose.rot)]) as Set<BoneId>) rot[k] = (a.pose.rot[k] ?? 0) * (1 - u) + (b.pose.rot[k] ?? 0) * u;
  return { rot, dx: a.pose.dx * (1 - u) + b.pose.dx * u, dy: a.pose.dy * (1 - u) + b.pose.dy * u };
}

/** Playback phase advance per second. Walk-like clips sync to the travel speed (no foot sliding). */
export function phaseRate(clip: Clip, speedInFigureHeights = 0): number {
  if (clip.cycleLength && clip.cycleLength > 0 && speedInFigureHeights > 0) return speedInFigureHeights / clip.cycleLength;
  return 1 / Math.max(0.05, clip.duration);
}

// ---- presets ----------------------------------------------------------------------------------------------------------------
// Rotation convention: positive = clockwise on screen. Facing right, a limb hanging down swings FORWARD with negative angles.

export type PresetKind = 'idle' | 'walk' | 'climb' | 'jump' | 'fall' | 'interact' | 'collect';
export const PRESET_STATE: Record<PresetKind, CharacterState> = { idle: 'IDLE', walk: 'WALK', climb: 'CLIMB', jump: 'JUMP', fall: 'FALL', interact: 'INTERACT', collect: 'COLLECT' };
export const PRESET_LABEL: Record<PresetKind, string> = { idle: 'Riposo', walk: 'Camminata', climb: 'Arrampicata', jump: 'Salto', fall: 'Caduta', interact: 'Interazione', collect: 'Raccolta' };

const pose = (rot: Partial<Record<BoneId, number>>, dx = 0, dy = 0): Pose => ({ rot, dx, dy });

/** Parametric starting clips (sampled into keyframes the user can edit). `amount` scales the motion (0.2 … 2). */
export function makePreset(kind: PresetKind, view: ViewId, amount = 1): Clip {
  if (view === 'climb' || view === 'jump') return makePosePreset(kind, view, amount);
  const keys: { t: number; pose: Pose }[] = [];
  const N = kind === 'walk' ? 8 : kind === 'idle' ? 6 : 0;
  const a = amount;
  let duration = 1, cycleLength: number | undefined;
  const base = (name: string, d: number, extra?: Partial<Clip>): Clip => ({ id: uid('clip'), name, duration: d, loop: true, keys, ...extra });

  if (kind === 'walk') {
    duration = 0.9; cycleLength = view === 'side' ? 0.75 : 0.6;
    const sideK = view === 'side' ? 1 : 0.22; // front/back: limbs swing mostly towards/away from the camera
    for (let i = 0; i < N; i++) {
      const p = i / N, s = Math.sin(2 * Math.PI * p), c = Math.cos(2 * Math.PI * p);
      const thighR = -28 * s * sideK * a, thighL = 28 * s * sideK * a;
      const shinR = 32 * Math.max(0, c) * sideK * a, shinL = 32 * Math.max(0, -c) * sideK * a;
      keys.push({
        t: p, pose: pose({
          thighR, thighL, shinR, shinL, footR: -(thighR + shinR) * 0.6, footL: -(thighL + shinL) * 0.6,
          uarmR: 20 * s * sideK * a, uarmL: -20 * s * sideK * a, farmR: -12 * a * sideK, farmL: -12 * a * sideK,
          torso: view === 'side' ? 3 * a : 3.5 * s * a, head: view === 'side' ? 0 : -2 * s * a,
        }, view === 'side' ? 0 : 0.008 * s * a, -0.012 * Math.cos(4 * Math.PI * p) * a),
      });
    }
    return base('Camminata', duration, { cycleLength });
  }
  if (kind === 'idle') {
    duration = 2.6;
    for (let i = 0; i < N; i++) {
      const p = i / N, s = Math.sin(2 * Math.PI * p);
      keys.push({ t: p, pose: pose({ torso: 1.2 * s * a, head: -1.0 * s * a, uarmR: 1.8 * s * a, uarmL: -1.8 * s * a, farmR: -2 * s * a, farmL: -2 * s * a }, 0, -0.004 * s * a) });
    }
    return base('Riposo', duration);
  }
  if (kind === 'climb') {
    duration = 1.2;
    const A = (u: number, t: number) => ({ t, pose: pose({ uarmR: -150 + 30 * u * a, uarmL: -120 - 30 * u * a, farmR: -20, farmL: -20, thighR: -45 * (1 - u) * a, shinR: 70 * (1 - u) * a, thighL: -45 * u * a, shinL: 70 * u * a, torso: 4 }, 0, -0.01 * u) });
    keys.push(A(0, 0), A(1, 0.5), A(0, 1));
    return base('Arrampicata', duration, { loop: true });
  }
  if (kind === 'jump') {
    keys.push(
      { t: 0, pose: pose({ thighR: -30, thighL: -30, shinR: 50, shinL: 50, torso: 14, uarmR: 20, uarmL: -20 }, 0, 0.04 * a) },
      { t: 0.3, pose: pose({ thighR: -4, thighL: 4, shinR: 6, shinL: 4, uarmR: -150, uarmL: -140, torso: -4 }, 0, -0.03 * a) },
      { t: 0.65, pose: pose({ thighR: -55, thighL: -50, shinR: 75, shinL: 70, uarmR: -40, uarmL: -30, torso: 6 }, 0, -0.01 * a) },
      { t: 1, pose: pose({ thighR: -30, thighL: -30, shinR: 50, shinL: 50, torso: 14, uarmR: 20, uarmL: -20 }, 0, 0.04 * a) });
    return base('Salto', 0.7, { loop: false });
  }
  if (kind === 'fall') {
    keys.push({ t: 0, pose: pose({ uarmR: -140, uarmL: -150, farmR: -25, farmL: -25, thighR: -25, thighL: 10, shinR: 30, shinL: 20 }, 0, 0) }, { t: 0.5, pose: pose({ uarmR: -160, uarmL: -130, farmR: -15, farmL: -35, thighR: -10, thighL: -25, shinR: 20, shinL: 35 }, 0, -0.006) }, { t: 1, pose: pose({ uarmR: -140, uarmL: -150, farmR: -25, farmL: -25, thighR: -25, thighL: 10, shinR: 30, shinL: 20 }, 0, 0) });
    return base('Caduta', 0.5);
  }
  if (kind === 'interact') {
    keys.push({ t: 0, pose: pose({ torso: 2, uarmR: 0 }) }, { t: 0.4, pose: pose({ torso: 6, uarmR: -75 * a, farmR: -30 * a, head: -3 }, 0, 0.004) }, { t: 0.7, pose: pose({ torso: 6, uarmR: -75 * a, farmR: -45 * a, head: -3 }, 0, 0.004) }, { t: 1, pose: pose({ torso: 2, uarmR: 0 }) });
    return base('Interazione', 1, { loop: false });
  }
  // collect: bend down and up
  keys.push({ t: 0, pose: pose({}) }, { t: 0.45, pose: pose({ torso: 28 * a, head: -8, uarmR: -18 * a, uarmL: -12 * a, thighR: -26 * a, thighL: -22 * a, shinR: 38 * a, shinL: 34 * a }, 0, 0.05 * a) }, { t: 0.6, pose: pose({ torso: 28 * a, head: -8, uarmR: -20 * a, uarmL: -12 * a, thighR: -26 * a, thighL: -22 * a, shinR: 38 * a, shinL: 34 * a }, 0, 0.05 * a) }, { t: 1, pose: pose({}) });
  return base('Raccolta', 1.1, { loop: false });
}

/**
 * Pose views (climb / jump) are drawn IN the posture, so their clips are small movements AROUND the rest pose
 * (alternating limbs for climbing, a tuck/stretch for jumping and falling) instead of full cycles.
 */
function makePosePreset(kind: PresetKind, view: 'climb' | 'jump', amount: number): Clip {
  const keys: { t: number; pose: Pose }[] = [];
  const a = amount, N = 8;
  const mk = (name: string, duration: number, loop = true, extra?: Partial<Clip>): Clip => ({ id: uid('clip'), name, duration, loop, keys, ...extra });
  if (view === 'climb' && kind === 'climb') {
    for (let i = 0; i < N; i++) {
      const p = i / N, s = Math.sin(2 * Math.PI * p), c = Math.cos(2 * Math.PI * p);
      keys.push({ t: p, pose: pose({ uarmR: -14 * s * a, uarmL: 14 * s * a, farmR: -8 * c * a, farmL: 8 * c * a, thighR: 14 * s * a, thighL: -14 * s * a, shinR: -10 * Math.max(0, s) * a, shinL: 10 * Math.max(0, -s) * a, torso: 2.5 * s * a, head: -2 * s * a }, 0.004 * s * a, -0.008 * Math.abs(c) * a) });
    }
    return mk('Arrampicata', 1.2, true, { cycleLength: 0.5 });
  }
  if (view === 'jump' && kind === 'jump') {
    for (let i = 0; i < 6; i++) {
      const p = i / 6, s = Math.sin(2 * Math.PI * p);
      keys.push({ t: p, pose: pose({ thighR: -9 * s * a, thighL: -7 * s * a, shinR: 12 * s * a, shinL: 10 * s * a, uarmR: -10 * s * a, uarmL: -8 * s * a, torso: 2 * s * a }, 0, -0.012 * s * a) });
    }
    return mk('Salto', 0.7);
  }
  if (view === 'jump' && kind === 'fall') {
    for (let i = 0; i < 6; i++) {
      const p = i / 6, s = Math.sin(2 * Math.PI * p);
      keys.push({ t: p, pose: pose({ thighR: 14 + 6 * s * a, thighL: 8 - 6 * s * a, shinR: -8 * a, shinL: -6 * a, uarmR: -22 - 8 * s * a, uarmL: -18 + 8 * s * a, torso: -3 }, 0, 0.004 * s * a) });
    }
    return mk('Caduta', 0.5);
  }
  // everything else: a tiny breathing motion around the pose
  for (let i = 0; i < 4; i++) { const p = i / 4, s = Math.sin(2 * Math.PI * p); keys.push({ t: p, pose: pose({ torso: 1.2 * s * a, head: -1 * s * a, uarmR: -2 * s * a, uarmL: 2 * s * a }, 0, -0.003 * s * a) }); }
  return mk('Riposo', 2.4);
}

/** Default set: every state gets a clip (the front/back views get a gentler walk). */
export function defaultClips(view: ViewId): { clips: Clip[]; stateClips: Partial<Record<CharacterState, string>> } {
  if (view === 'climb') {
    const idle = makePreset('idle', view), climb = makePreset('climb', view);
    return { clips: [climb, idle], stateClips: { CLIMB: climb.id, IDLE: idle.id, CUSTOM: idle.id } };
  }
  if (view === 'jump') {
    const idle = makePreset('idle', view), jump = makePreset('jump', view), fall = makePreset('fall', view);
    return { clips: [jump, fall, idle], stateClips: { JUMP: jump.id, FALL: fall.id, IDLE: idle.id, CUSTOM: idle.id } };
  }
  const kinds: PresetKind[] = ['idle', 'walk', 'climb', 'jump', 'fall', 'interact', 'collect'];
  const clips = kinds.map((k) => makePreset(k, view));
  const stateClips: Partial<Record<CharacterState, string>> = {};
  kinds.forEach((k, i) => { stateClips[PRESET_STATE[k]] = clips[i].id; });
  stateClips.CUSTOM = clips[0].id;
  return { clips, stateClips };
}
