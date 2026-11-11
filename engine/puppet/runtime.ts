import type { CharacterState, Clip, Pose, PuppetView, ViewId } from '@/types';
import { boneMatrices, buildRig, type Rig } from './skeleton';
import { phaseRate, samplePose } from './animation';

/** Runtime evaluation of a rigged view. No DOM: usable by any host game. */

const rigCache = new WeakMap<PuppetView, Rig | null>();
export function rigOf(view: PuppetView): Rig | null {
  if (!rigCache.has(view)) rigCache.set(view, buildRig(view));
  return rigCache.get(view) ?? null;
}

export function clipFor(view: PuppetView, state: CharacterState): Clip | undefined {
  const id = view.stateClips[state] ?? view.stateClips.IDLE;
  return view.clips.find((c) => c.id === id);
}

/** Skinned vertex positions (cut-out pixels) for a pose. Returns null if the view has no mesh/skin/skeleton yet. */
export function skinVertices(view: PuppetView, pose: Pose, out?: Float32Array): Float32Array | null {
  const rig = rigOf(view);
  if (!rig || !view.mesh || !view.skin) return null;
  const mats = boneMatrices(rig, pose);
  const n = view.mesh.vertices.length / 2;
  const res = out && out.length === n * 2 ? out : new Float32Array(n * 2);
  const v = view.mesh.vertices, { idx, w } = view.skin;
  for (let i = 0; i < n; i++) {
    const x = v[i * 2], y = v[i * 2 + 1];
    let ox = 0, oy = 0;
    for (let k = 0; k < 4; k++) {
      const wk = w[i * 4 + k];
      if (!wk) continue;
      const m = mats[idx[i * 4 + k]];
      ox += wk * (m[0] * x + m[2] * y + m[4]); oy += wk * (m[1] * x + m[3] * y + m[5]);
    }
    res[i * 2] = ox; res[i * 2 + 1] = oy;
  }
  return res;
}

/** Playback clock helper: advances `phase` for a state, syncing walk-like clips to the travel speed (figure heights / s). */
export function advancePhase(view: PuppetView, state: CharacterState, phase: number, dt: number, speedFigureHeights = 0): number {
  const clip = clipFor(view, state);
  if (!clip) return phase;
  const next = phase + dt * phaseRate(clip, speedFigureHeights);
  return clip.loop ? next % 1 : Math.min(1, next);
}

export const poseAt = (view: PuppetView, state: CharacterState, phase: number): Pose => {
  const clip = clipFor(view, state);
  return clip ? samplePose(clip, phase) : { rot: {}, dx: 0, dy: 0 };
};

/** Which view to show: explicit hint (edge `props.view`), else side when moving and the puppet's idle view when still. */
export function chooseView(views: Partial<Record<ViewId, PuppetView>>, moving: boolean, idleView: ViewId, hint?: string): ViewId | null {
  const ok = (v: string | undefined): v is ViewId => (v === 'side' || v === 'front' || v === 'back') && !!views[v]?.mesh;
  if (ok(hint)) return hint;
  const prefer: ViewId[] = moving ? ['side', 'front', 'back'] : [idleView, 'side', 'front', 'back'];
  return prefer.find((v) => ok(v)) ?? null;
}
