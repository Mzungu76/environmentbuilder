import type { CharacterState, Clip, Pose, PuppetView, ViewId } from '@/types';
import { boneMatrices, buildRig, type Rig } from './skeleton';
import { phaseRate, samplePose } from './animation';

/** Runtime evaluation of a rigged view. No DOM: usable by any host game. */

const resolved = new WeakMap<PuppetView, PuppetView>();
/**
 * The view as it must be DRAWN: when a manikin (part-based rebuild) is enabled its mesh, skin and atlas texture replace the
 * single-image ones. The skeleton and animations are shared, so everything else works unchanged.
 */
export function resolveView(view: PuppetView): PuppetView {
  const m = view.manikin;
  if (!m?.enabled) return view;
  let r = resolved.get(view);
  if (!r) { r = { ...view, mesh: m.mesh, skin: m.skin, cutoutAssetId: m.atlasAssetId, width: m.width, height: m.height }; resolved.set(view, r); }
  return r;
}

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
  const ok = (v: string | undefined): v is ViewId => !!v && ['side', 'front', 'back', 'climb', 'jump'].includes(v) && !!views[v as ViewId] && !!resolveView(views[v as ViewId]!).mesh;
  if (ok(hint)) return hint;
  const prefer: ViewId[] = moving ? ['side', 'front', 'back'] : [idleView, 'side', 'front', 'back'];  // pose views are chosen by state (see chooseViewForState)
  return prefer.find((v) => ok(v)) ?? null;
}

/**
 * View for a character state: an explicit `hint` wins; CLIMB uses the climb view and JUMP/FALL the jump view when the puppet has
 * them; everything else falls back to chooseView (profile while moving, `idleView` when still).
 */
export function chooseViewForState(views: Partial<Record<ViewId, PuppetView>>, state: CharacterState, idleView: ViewId, hint?: string): ViewId | null {
  const has = (v: ViewId) => !!views[v] && !!resolveView(views[v]!).mesh;
  if (!hint) {
    if (state === 'CLIMB' && has('climb')) return 'climb';
    if (state === 'CLIMB' && has('back')) return 'back';           // climbing away from the camera
    if ((state === 'JUMP' || state === 'FALL') && has('jump')) return 'jump';
  }
  const moving = state === 'WALK' || state === 'CLIMB' || state === 'JUMP' || state === 'FALL';
  return chooseView(views, moving, idleView, hint);
}

/** Should the view be mirrored when the character faces left? Profile and jump yes; front, back and climb no (unless set on the view). */
export function flipsWithFacing(view: Pick<PuppetView, 'id' | 'flipWithFacing'>): boolean {
  return view.flipWithFacing ?? (view.id === 'side' || view.id === 'jump');
}
