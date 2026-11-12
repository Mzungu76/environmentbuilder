import type { BoneId, Pose, ViewId } from '@/types';

/**
 * Joint limits (degrees, relative to the parent bone, rest = 0, positive = clockwise on screen). They keep poses humanly possible
 * (no knee bending backwards, no arm through the head) whatever the clip asks for. Profile views move in the image plane;
 * frontal views (front / back) only allow what is visible from the front: arms and legs open sideways, small torso/head tilts.
 * Left (L) bones of frontal views are the mirror of the right ones.
 */
type Limits = Partial<Record<BoneId, [number, number]>>;

const SIDE: Limits = {
  pelvis: [-25, 25], torso: [-35, 45], head: [-45, 45],
  uarmR: [-175, 70], uarmL: [-175, 70], farmR: [-150, 8], farmL: [-150, 8], handR: [-60, 60], handL: [-60, 60],
  thighR: [-115, 55], thighL: [-115, 55], shinR: [-10, 140], shinL: [-10, 140], footR: [-80, 80], footL: [-80, 80],
};
const FRONT_R: Limits = { uarmR: [-170, 15], farmR: [-120, 120], handR: [-70, 70], thighR: [-45, 15], shinR: [-15, 15], footR: [-25, 25] };
const mirror = (l: Limits): Limits => Object.fromEntries(Object.entries(l).map(([k, [a, b]]) => [k.replace(/R$/, 'L'), [-b, -a]]));
const FRONTAL: Limits = { pelvis: [-15, 15], torso: [-20, 20], head: [-35, 35], ...FRONT_R, ...mirror(FRONT_R) };

export const limitsFor = (view: ViewId): Limits => (view === 'front' || view === 'back' ? FRONTAL : view === 'side' ? SIDE : {});

/** Clamps every rotation of a pose to the view's limits (returns the same object when nothing changes). */
export function clampPose(pose: Pose, view: ViewId): Pose {
  const lim = limitsFor(view);
  let out: Pose['rot'] | null = null;
  for (const [b, v] of Object.entries(pose.rot) as [BoneId, number][]) {
    const l = lim[b]; if (!l) continue;
    const c = Math.min(l[1], Math.max(l[0], v));
    if (c !== v) { out ??= { ...pose.rot }; out[b] = c; }
  }
  return out ? { ...pose, rot: out } : pose;
}
