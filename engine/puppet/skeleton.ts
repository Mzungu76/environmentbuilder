import type { BoneId, LandmarkId, Pose, PuppetView, Rect, Vec2, ViewId } from '@/types';
import { BONE_IDS } from '@/types';
import { alphaAt, rowRuns, type Img } from './imageProc';

export interface BoneDef { id: BoneId; parent: BoneId | null; head: LandmarkId; tail: LandmarkId | 'hipMid'; /** half thickness as a fraction of the figure height (weights) */ radius: number }

/** Bone hierarchy. L/R = sides of the image (front/back) or far/near (side view). */
export const BONE_DEFS: BoneDef[] = [
  { id: 'pelvis', parent: null, head: 'pelvis', tail: 'hipMid', radius: 0.11 },
  { id: 'torso', parent: 'pelvis', head: 'pelvis', tail: 'neck', radius: 0.13 },
  { id: 'head', parent: 'torso', head: 'neck', tail: 'headTop', radius: 0.09 },
  { id: 'uarmL', parent: 'torso', head: 'shoulderL', tail: 'elbowL', radius: 0.045 },
  { id: 'farmL', parent: 'uarmL', head: 'elbowL', tail: 'wristL', radius: 0.04 },
  { id: 'handL', parent: 'farmL', head: 'wristL', tail: 'handL', radius: 0.035 },
  { id: 'uarmR', parent: 'torso', head: 'shoulderR', tail: 'elbowR', radius: 0.045 },
  { id: 'farmR', parent: 'uarmR', head: 'elbowR', tail: 'wristR', radius: 0.04 },
  { id: 'handR', parent: 'farmR', head: 'wristR', tail: 'handR', radius: 0.035 },
  { id: 'thighL', parent: 'pelvis', head: 'hipL', tail: 'kneeL', radius: 0.07 },
  { id: 'shinL', parent: 'thighL', head: 'kneeL', tail: 'ankleL', radius: 0.055 },
  { id: 'footL', parent: 'shinL', head: 'ankleL', tail: 'toeL', radius: 0.05 },
  { id: 'thighR', parent: 'pelvis', head: 'hipR', tail: 'kneeR', radius: 0.07 },
  { id: 'shinR', parent: 'thighR', head: 'kneeR', tail: 'ankleR', radius: 0.055 },
  { id: 'footR', parent: 'shinR', head: 'ankleR', tail: 'toeR', radius: 0.05 },
];

export interface Bone { id: BoneId; index: number; parent: number; head: Vec2; tail: Vec2; radius: number }
export interface Rig { bones: Bone[]; figureHeight: number }

/** Builds the rest skeleton from the landmarks; null when a landmark is missing. */
export function buildRig(view: Pick<PuppetView, 'landmarks' | 'figureHeight'>): Rig | null {
  const lm = view.landmarks;
  const bones: Bone[] = [];
  for (const def of BONE_DEFS) {
    const head = lm[def.head];
    const tail = def.tail === 'hipMid' ? (lm.hipL && lm.hipR ? { x: (lm.hipL.x + lm.hipR.x) / 2, y: (lm.hipL.y + lm.hipR.y) / 2 } : undefined) : lm[def.tail];
    if (!head || !tail) return null;
    bones.push({ id: def.id, index: BONE_IDS.indexOf(def.id), parent: def.parent ? BONE_IDS.indexOf(def.parent) : -1, head, tail, radius: def.radius });
  }
  // BONE_IDS order == BONE_DEFS order (asserted by tests)
  return { bones, figureHeight: view.figureHeight };
}

// ---- 2D affine transforms: [a, b, c, d, e, f]  x' = a x + c y + e ; y' = b x + d y + f -------------------------------------
export type Mat = [number, number, number, number, number, number];
export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];
/** (A ∘ B)(p) = A(B(p)) */
export function mul(A: Mat, B: Mat): Mat {
  return [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
}
/** Rotation by `deg` degrees about `p`. */
export function rotAbout(deg: number, p: Vec2): Mat {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return [c, s, -s, c, p.x - (c * p.x - s * p.y), p.y - (s * p.x + c * p.y)];
}

/** Rest → posed transform of every bone (forward kinematics). */
export function boneMatrices(rig: Rig, pose: Pose): Mat[] {
  const out: Mat[] = new Array(rig.bones.length);
  for (const b of rig.bones) {
    const local = rotAbout(pose.rot[b.id] ?? 0, b.head);
    if (b.parent < 0) out[b.index] = mul([1, 0, 0, 1, pose.dx * rig.figureHeight, pose.dy * rig.figureHeight], local);
    else out[b.index] = mul(out[b.parent], local);
  }
  return out;
}

/** Absolute (accumulated) rotation of a bone's parent chain, in degrees; used by the pose editor. */
export function parentRotation(rig: Rig, pose: Pose, boneIndex: number): number {
  let sum = 0;
  for (let p = rig.bones[boneIndex].parent; p >= 0; p = rig.bones[p].parent) sum += pose.rot[rig.bones[p].id] ?? 0;
  return sum;
}
export const restAngle = (b: Bone) => (Math.atan2(b.tail.y - b.head.y, b.tail.x - b.head.x) * 180) / Math.PI;
export function apply(m: Mat, p: Vec2): Vec2 { return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] }; }

// ---- automatic placement ------------------------------------------------------------------------------------------------------
/**
 * Default landmarks from the proportions of the reference guide, scaled to the figure's bounding box.
 * It is only a starting point: real characters never match 100%, so everything stays editable.
 */
export function templateLandmarks(view: ViewId, bounds: Rect, cx: number): Partial<Record<LandmarkId, Vec2>> {
  const H = bounds.h, top = bounds.y;
  const Y = (f: number) => top + f * H;
  const lm: Partial<Record<LandmarkId, Vec2>> = {
    headTop: { x: cx, y: top + 1 }, neck: { x: cx, y: Y(0.17) }, pelvis: { x: cx, y: Y(0.5) },
  };
  if (view === 'side') {
    const o = (f: number) => cx + f * H;
    Object.assign(lm, {
      neck: { x: o(0.003), y: Y(0.17) },
      shoulderR: { x: o(-0.005), y: Y(0.2) }, shoulderL: { x: o(0.005), y: Y(0.2) },
      elbowR: { x: o(0.02), y: Y(0.39) }, elbowL: { x: o(0.03), y: Y(0.39) },
      wristR: { x: o(0.04), y: Y(0.56) }, wristL: { x: o(0.05), y: Y(0.56) },
      handR: { x: o(0.05), y: Y(0.64) }, handL: { x: o(0.06), y: Y(0.64) },
      hipR: { x: o(-0.01), y: Y(0.52) }, hipL: { x: o(0.02), y: Y(0.52) },
      kneeR: { x: o(0.005), y: Y(0.75) }, kneeL: { x: o(0.03), y: Y(0.75) },
      ankleR: { x: o(-0.01), y: Y(0.955) }, ankleL: { x: o(0.015), y: Y(0.955) },
      toeR: { x: o(0.085), y: Y(0.985) }, toeL: { x: o(0.11), y: Y(0.985) },
    });
  } else {
    const o = (f: number) => f * H;
    Object.assign(lm, {
      shoulderL: { x: cx - o(0.116), y: Y(0.2) }, shoulderR: { x: cx + o(0.116), y: Y(0.2) },
      elbowL: { x: cx - o(0.19), y: Y(0.39) }, elbowR: { x: cx + o(0.19), y: Y(0.39) },
      wristL: { x: cx - o(0.248), y: Y(0.557) }, wristR: { x: cx + o(0.248), y: Y(0.557) },
      handL: { x: cx - o(0.262), y: Y(0.64) }, handR: { x: cx + o(0.262), y: Y(0.64) },
      hipL: { x: cx - o(0.06), y: Y(0.52) }, hipR: { x: cx + o(0.06), y: Y(0.52) },
      kneeL: { x: cx - o(0.076), y: Y(0.75) }, kneeR: { x: cx + o(0.076), y: Y(0.75) },
      ankleL: { x: cx - o(0.08), y: Y(0.955) }, ankleR: { x: cx + o(0.08), y: Y(0.955) },
      toeL: { x: cx - o(0.093), y: Y(0.985) }, toeR: { x: cx + o(0.093), y: Y(0.985) },
    });
  }
  return lm;
}

/** Horizontal centre of the body: opaque centroid of the torso rows. */
export function bodyCenterX(img: Img, bounds: Rect): number {
  let sum = 0, n = 0;
  for (let f = 0.25; f <= 0.45; f += 0.02) {
    const runs = rowRuns(img, bounds.y + f * bounds.h);
    if (!runs.length) continue;
    const x0 = runs[0][0], x1 = runs[runs.length - 1][1];
    sum += (x0 + x1) / 2; n++;
  }
  return n ? sum / n : bounds.x + bounds.w / 2;
}

/**
 * Refines a template placement using the silhouette (front/back): legs, knees, ankles and arms are snapped to the
 * actual blobs found on the rows where they are separated. Anything it cannot decide stays where it was.
 */
export function refineLandmarks(img: Img, lm: Partial<Record<LandmarkId, Vec2>>, view: ViewId, bounds: Rect): Partial<Record<LandmarkId, Vec2>> {
  const out = { ...lm };
  if (view === 'side') {
    // snap vertical landmarks to the silhouette
    out.headTop = { x: out.headTop?.x ?? bounds.x + bounds.w / 2, y: bounds.y + 1 };
    return snapInside(img, out);
  }
  const pairs: [LandmarkId, LandmarkId][] = [['kneeL', 'kneeR'], ['ankleL', 'ankleR']];
  for (const [l, r] of pairs) {
    const a = out[l], b = out[r];
    if (!a || !b) continue;
    const runs = rowRuns(img, a.y).filter((x) => x[1] - x[0] > 3);
    const cx = ((out.pelvis?.x ?? (a.x + b.x) / 2));
    const left = runs.filter((x) => (x[0] + x[1]) / 2 < cx), right = runs.filter((x) => (x[0] + x[1]) / 2 >= cx);
    const pick = (rs: [number, number][], ref: number) => rs.sort((p, q) => Math.abs((p[0] + p[1]) / 2 - ref) - Math.abs((q[0] + q[1]) / 2 - ref))[0];
    const pl = left.length ? pick(left, a.x) : null, pr = right.length ? pick(right, b.x) : null;
    if (pl && left.length && right.length) out[l] = { x: (pl[0] + pl[1]) / 2, y: a.y };
    if (pr && left.length && right.length) out[r] = { x: (pr[0] + pr[1]) / 2, y: b.y };
  }
  // arms: only where the outermost blobs are clearly separate from the torso (gap) on the elbow/wrist rows
  for (const [l, r] of [['elbowL', 'elbowR'], ['wristL', 'wristR']] as [LandmarkId, LandmarkId][]) {
    const a = out[l], b = out[r];
    if (!a || !b) continue;
    const runs = rowRuns(img, a.y);
    if (runs.length >= 3) {
      const first = runs[0], last = runs[runs.length - 1];
      if (first[1] - first[0] < bounds.w * 0.3 && last[1] - last[0] < bounds.w * 0.3) {
        out[l] = { x: (first[0] + first[1]) / 2, y: a.y }; out[r] = { x: (last[0] + last[1]) / 2, y: b.y };
      }
    }
  }
  out.headTop = { x: out.pelvis?.x ?? bounds.x + bounds.w / 2, y: bounds.y + 1 };
  return snapInside(img, out);
}

/** Moves any landmark that falls on transparent pixels to the nearest opaque pixel (within a small radius). */
export function snapInside(img: Img, lm: Partial<Record<LandmarkId, Vec2>>, radius = 40): Partial<Record<LandmarkId, Vec2>> {
  const out: Partial<Record<LandmarkId, Vec2>> = {};
  for (const [k, p] of Object.entries(lm) as [LandmarkId, Vec2][]) {
    if (k === 'toeL' || k === 'toeR' || k === 'handL' || k === 'handR') { out[k] = p; continue; } // tips may sit on the edge
    if (alphaAt(img, p.x, p.y) > 24) { out[k] = p; continue; }
    let best: Vec2 | null = null, bd = Infinity;
    for (let dy = -radius; dy <= radius; dy += 2) for (let dx = -radius; dx <= radius; dx += 2) {
      const d = dx * dx + dy * dy;
      if (d < bd && alphaAt(img, p.x + dx, p.y + dy) > 24) { bd = d; best = { x: p.x + dx, y: p.y + dy }; }
    }
    out[k] = best ?? p;
  }
  return out;
}

/** Copies the left landmarks onto the right ones (mirror about the vertical axis through the pelvis) or the opposite. */
export function mirrorLandmarks(lm: Partial<Record<LandmarkId, Vec2>>, from: 'L' | 'R'): Partial<Record<LandmarkId, Vec2>> {
  const axis = lm.pelvis?.x ?? 0;
  const out = { ...lm };
  for (const base of ['shoulder', 'elbow', 'wrist', 'hand', 'hip', 'knee', 'ankle', 'toe']) {
    const src = lm[`${base}${from}` as LandmarkId];
    if (src) out[`${base}${from === 'L' ? 'R' : 'L'}` as LandmarkId] = { x: 2 * axis - src.x, y: src.y };
  }
  return out;
}
