import type { BoneId, Pose, PuppetView, Vec2 } from '@/types';
import { apply, boneMatrices, buildRig, restAngle, type Rig } from './skeleton';

/**
 * Two-bone inverse kinematics for the puppet's limbs: keeps the feet planted on the ground while the pelvis goes down
 * (crouching, sitting, landing) and lets a hand reach a point (picking something up). Angles follow the rig's convention:
 * degrees, positive = clockwise on screen, relative to the parent bone, rest pose = 0.
 */

const DEG = 180 / Math.PI;
const norm = (a: number) => ((a + 540) % 360) - 180;

/** Absolute angles (deg) of bone 1 (root → joint) and bone 2 (joint → target). `bend` picks which side the joint points to (+1 / −1). */
export function twoBoneIK(root: Vec2, l1: number, l2: number, target: Vec2, bend: 1 | -1): { a1: number; a2: number; reach: number } {
  const dx = target.x - root.x, dy = target.y - root.y, raw = Math.hypot(dx, dy);
  const d = Math.min(l1 + l2 - 1e-3, Math.max(Math.abs(l1 - l2) + 1e-3, raw));
  const theta = Math.atan2(dy, dx), alpha = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
  const a1 = theta + bend * alpha, knee = { x: root.x + l1 * Math.cos(a1), y: root.y + l1 * Math.sin(a1) };
  return { a1: a1 * DEG, a2: Math.atan2(target.y - knee.y, target.x - knee.x) * DEG, reach: raw / (l1 + l2) };
}

const bone = (rig: Rig, id: BoneId) => rig.bones.find((b) => b.id === id)!;
const len = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Re-solves the legs so that the ankles stay at their REST position (the ground contact) whatever the pelvis does
 * (`pose.dy`, `pose.rot.pelvis`…). The foot is kept flat. Facing right: knees point forward.
 */
export function plantFeet(view: Pick<PuppetView, 'landmarks' | 'figureHeight'>, pose: Pose, sides: ('L' | 'R')[] = ['L', 'R']): Pose {
  const rig = buildRig(view);
  if (!rig) return pose;
  const rot: Pose['rot'] = { ...pose.rot };
  for (const s of sides) { delete rot[`thigh${s}` as BoneId]; delete rot[`shin${s}` as BoneId]; delete rot[`foot${s}` as BoneId]; }
  const mats = boneMatrices(rig, { ...pose, rot });
  const pelvisRot = pose.rot.pelvis ?? 0;
  for (const s of sides) {
    const thigh = bone(rig, `thigh${s}` as BoneId), shin = bone(rig, `shin${s}` as BoneId);
    const hip = apply(mats[thigh.index], thigh.head), target = shin.tail;
    const ik = twoBoneIK(hip, len(thigh.head, thigh.tail), len(shin.head, shin.tail), target, -1);
    const thighRot = norm(ik.a1 - restAngle(thigh) - pelvisRot);
    const shinRot = norm(ik.a2 - restAngle(shin) - pelvisRot - thighRot);
    rot[`thigh${s}` as BoneId] = Math.round(thighRot * 10) / 10; rot[`shin${s}` as BoneId] = Math.round(shinRot * 10) / 10;
    rot[`foot${s}` as BoneId] = Math.round(norm(-(pelvisRot + thighRot + shinRot)) * 10) / 10;       // sole stays flat on the ground
  }
  return { ...pose, rot };
}

/** Bends the arm of `side` so that the hand reaches `target` (rig coordinates). The elbow points backwards/down. */
export function reachArm(view: Pick<PuppetView, 'landmarks' | 'figureHeight'>, pose: Pose, side: 'L' | 'R', target: Vec2): Pose {
  const rig = buildRig(view);
  if (!rig) return pose;
  const rot: Pose['rot'] = { ...pose.rot };
  delete rot[`uarm${side}` as BoneId]; delete rot[`farm${side}` as BoneId];
  const mats = boneMatrices(rig, { ...pose, rot });
  const up = bone(rig, `uarm${side}` as BoneId), fa = bone(rig, `farm${side}` as BoneId);
  const shoulder = apply(mats[up.index], up.head);
  const ik = twoBoneIK(shoulder, len(up.head, up.tail), len(fa.head, fa.tail), target, 1);
  const parentRot = (pose.rot.pelvis ?? 0) + (pose.rot.torso ?? 0);
  const uRot = norm(ik.a1 - restAngle(up) - parentRot), fRot = norm(ik.a2 - restAngle(fa) - parentRot - uRot);
  rot[`uarm${side}` as BoneId] = Math.round(uRot * 10) / 10; rot[`farm${side}` as BoneId] = Math.round(fRot * 10) / 10;
  return { ...pose, rot };
}

/** Where the ground is for this view (y of the lowest ankle/toe landmark). */
export function groundY(view: Pick<PuppetView, 'landmarks' | 'pivot'>): number { return view.pivot.y; }
