import type { BoneId, LandmarkId, Pose, PuppetView, Vec2 } from '@/types';
import { BONE_IDS } from '@/types';
import { apply, boneMatrices, type Rig } from './skeleton';
import { buildRig } from './skeleton';
import { opaqueBounds, type Img } from './imageProc';

/**
 * Automatic skeleton for a pose drawn by the AI: analysis-by-synthesis. The character's own profile view (known skeleton, mesh
 * and weights) is posed until its silhouette overlaps the silhouette of the new drawing as much as possible. Because the segment
 * lengths come from the profile, the result is consistent between poses and also gives the scale (standing height) of each
 * drawing — unlike proportions guessed from the bounding box, which change with the pose.
 */

/** Joint ranges (degrees, facing right: thighs swing forward with negative angles, knees bend with positive, elbows with negative). */
const LIMITS: Record<BoneId, [number, number]> = {
  pelvis: [-30, 30], torso: [-45, 60], head: [-45, 45],
  uarmL: [-180, 90], farmL: [-150, 10], handL: [-60, 60], uarmR: [-180, 90], farmR: [-150, 10], handR: [-60, 60],
  thighL: [-130, 70], shinL: [-5, 150], footL: [-50, 50], thighR: [-130, 70], shinR: [-5, 150], footR: [-50, 50],
};
/** Order matters: big masses first, extremities last. */
/** Limb pairs (near + far) that are tried together too: in a silhouette both limbs often move alike (crouch, jump). */
const PAIRS: [BoneId, BoneId][] = [['thighR', 'thighL'], ['shinR', 'shinL'], ['uarmR', 'uarmL'], ['farmR', 'farmL'], ['footR', 'footL']];
const ORDER: BoneId[] = ['torso', 'pelvis', 'thighR', 'thighL', 'uarmR', 'uarmL', 'head', 'shinR', 'shinL', 'farmR', 'farmL', 'footR', 'footL', 'handR', 'handL'];

export interface FitResult {
  landmarks: Partial<Record<LandmarkId, Vec2>>;
  pose: Pose;
  /** Target pixels per reference pixel: standing height of the drawing = scale × reference figureHeight. */
  scale: number;
  /** Silhouette overlap (IoU, 0–1). */
  score: number;
}

interface Mask { w: number; h: number; d: Float32Array }

function blurred(img: Img, box: { x: number; y: number; w: number; h: number }, k: number, R: number): Mask {
  // downsample the opaque mask of `img` (bbox `box`) into an R×R grid scaled by k, then box-blur radius 1
  const w = Math.max(8, Math.ceil(box.w * k)), h = Math.max(8, Math.ceil(box.h * k));
  const out = new Float32Array(w * h), cnt = new Float32Array(w * h);
  for (let y = 0; y < box.h; y++) for (let x = 0; x < box.w; x++) {
    const sx = Math.min(w - 1, Math.floor(x * k)), sy = Math.min(h - 1, Math.floor(y * k)), i = sy * w + sx;
    out[i] += img.data[((box.y + y) * img.width + box.x + x) * 4 + 3] > 40 ? 1 : 0; cnt[i]++;
  }
  for (let i = 0; i < out.length; i++) out[i] = cnt[i] ? out[i] / cnt[i] : 0;
  void R;
  const b = new Float32Array(out.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, c = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; s += out[yy * w + xx]; c++; }
    b[y * w + x] = s / c;
  }
  return { w, h, d: b };
}

/** Distance (grid px) to the nearest `on` pixel — two-pass chamfer (3-4), good enough for scoring. */
function distanceTransform(on: ArrayLike<number>, w: number, h: number, out: Float32Array, thresh = 0.5) {
  const INF = 1e6;
  for (let i = 0; i < w * h; i++) out[i] = on[i] >= thresh ? 0 : INF;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; let v = out[i]; if (v === 0) continue;
    if (x > 0) v = Math.min(v, out[i - 1] + 3);
    if (y > 0) { v = Math.min(v, out[i - w] + 3); if (x > 0) v = Math.min(v, out[i - w - 1] + 4); if (x < w - 1) v = Math.min(v, out[i - w + 1] + 4); }
    out[i] = v;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x; let v = out[i]; if (v === 0) continue;
    if (x < w - 1) v = Math.min(v, out[i + 1] + 3);
    if (y < h - 1) { v = Math.min(v, out[i + w] + 3); if (x < w - 1) v = Math.min(v, out[i + w + 1] + 4); if (x > 0) v = Math.min(v, out[i + w - 1] + 4); }
    out[i] = v;
  }
  for (let i = 0; i < w * h; i++) out[i] = Math.min(out[i], INF) / 3;
}

/** Half thickness of every bone in a PROFILE silhouette, as a fraction of the standing height. */
const FIT_RADIUS: Record<BoneId, number> = {
  pelvis: 0.055, torso: 0.07, head: 0.06, uarmL: 0.03, farmL: 0.027, handL: 0.024, uarmR: 0.03, farmR: 0.027, handR: 0.024,
  thighL: 0.045, shinL: 0.036, footL: 0.03, thighR: 0.045, shinR: 0.036, footR: 0.03,
};

/** Rasterises the posed skeleton as capsules (segment + radius) into `mask` (grid coordinates). Exported for tests. */
export function fillCapsules(mask: Uint8Array, w: number, h: number, segs: { a: Vec2; b: Vec2; r: number }[]) {
  mask.fill(0);
  for (const { a, b, r } of segs) {
    const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - r)), x1 = Math.min(w - 1, Math.ceil(Math.max(a.x, b.x) + r));
    const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - r)), y1 = Math.min(h - 1, Math.ceil(Math.max(a.y, b.y) + r));
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1e-9, r2 = r * r;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5 - a.x, py = y + 0.5 - a.y, t = Math.max(0, Math.min(1, (px * dx + py * dy) / l2)), qx = px - dx * t, qy = py - dy * t;
      if (qx * qx + qy * qy <= r2) mask[y * w + x] = 1;
    }
  }
}

/** Capsules of the posed reference skeleton (reference pixels, pelvis kept in place). */
export function poseCapsules(ref: Pick<PuppetView, 'landmarks' | 'figureHeight'>, pose: Pose): { a: Vec2; b: Vec2; r: number }[] {
  const rig = buildRig(ref)!, mats = boneMatrices(rig, pose);
  return rig.bones.map((b) => ({ a: apply(mats[b.index], b.head), b: apply(mats[b.index], b.tail), r: FIT_RADIUS[b.id] * ref.figureHeight }));
}

const LM_BONE: [LandmarkId, BoneId][] = [
  ['pelvis', 'pelvis'], ['hipL', 'thighL'], ['hipR', 'thighR'], ['kneeL', 'shinL'], ['kneeR', 'shinR'], ['ankleL', 'footL'], ['ankleR', 'footR'], ['toeL', 'footL'], ['toeR', 'footR'],
  ['neck', 'head'], ['headTop', 'head'], ['shoulderL', 'uarmL'], ['shoulderR', 'uarmR'], ['elbowL', 'farmL'], ['elbowR', 'farmR'], ['wristL', 'handL'], ['wristR', 'handR'], ['handL', 'handL'], ['handR', 'handR'],
];

/** Fits the reference (profile) view to the silhouette of `target`. Landmarks are returned in the target's pixel coordinates. */
export function fitPoseToSilhouette(ref: Pick<PuppetView, 'landmarks' | 'figureHeight'>, target: Img, opts: { budget?: number } = {}): FitResult | null {
  const rig: Rig | null = buildRig(ref);
  if (!rig) return null;
  const tb = opaqueBounds(target);
  if (!tb) return null;
  const longest = Math.max(tb.w, tb.h), k = 120 / longest;           // low-resolution working grid
  const tm = blurred(target, tb, k, 120);
  const W = tm.w, H = tm.h, mask = new Uint8Array(W * H);
  const dtTarget = new Float32Array(W * H), dtModel = new Float32Array(W * H);
  distanceTransform(tm.d, W, H, dtTarget);
  const pelvis = ref.landmarks.pelvis!;
  const rot: Partial<Record<BoneId, number>> = {};
  const pose: Pose = { rot, dx: 0, dy: 0 };
    // params in low-res space: s (grid px per reference px), tx/ty = where the reference pelvis lands in the grid
  let s = (H * 0.95) / ref.figureHeight, tx = W / 2, ty = H * 0.55;
  const score = (): number => {
    const mats = boneMatrices(rig, pose), ox = tx - pelvis.x * s, oy = ty - pelvis.y * s;
    const segs = rig.bones.map((b) => { const p = apply(mats[b.index], b.head), q = apply(mats[b.index], b.tail); return { a: { x: p.x * s + ox, y: p.y * s + oy }, b: { x: q.x * s + ox, y: q.y * s + oy }, r: FIT_RADIUS[b.id] * ref.figureHeight * s }; });
    fillCapsules(mask, W, H, segs);
    let inter = 0, union = 0, nModel = 0, dModel = 0;
    for (let i = 0; i < mask.length; i++) { const a = mask[i], b = tm.d[i]; inter += Math.min(a, b); union += Math.max(a, b); if (a) { nModel++; dModel += dtTarget[i]; } }
    distanceTransform(mask, W, H, dtModel);
    let dTarget = 0, nTarget = 0;
    for (let i = 0; i < mask.length; i++) if (tm.d[i] >= 0.5) { nTarget++; dTarget += dtModel[i]; }
    const iou = union > 0 ? inter / union : 0;
    // chamfer terms (model → drawing and drawing → model) give a gradient even when a thin limb is far from where it should be
    return iou - 0.9 * ((nModel ? dModel / nModel : 0) + (nTarget ? dTarget / nTarget : 0)) / Math.max(W, H) * 2;
  };
  // a light prior keeps joints near rest when the silhouette cannot tell
  const prior = () => { let p = 0; for (const b of ORDER) p += Math.abs(rot[b] ?? 0); return 0.00004 * p; };
  let best = -1;
  const tryVal = (apply2: (v: number) => void, cur: number, cand: number) => {
    apply2(cand); const sc = score() - prior();
    if (sc > best + 1e-5) { best = sc; return true; }
    apply2(cur); return false;
  };
  const budget = opts.budget ?? 1;
  const setRot = (b: BoneId) => (v: number) => { rot[b] = v; };
  const place = (scaleSteps: number[]) => {
    for (const step of [0.2, 0.1, 0.05].map((f) => f * budget)) {
      for (let it = 0; it < 2; it++) {
        for (const d of [step * W * 0.25, -step * W * 0.25]) { const o = tx; tryVal((v) => { tx = v; }, o, o + d); }
        for (const d of [step * H * 0.25, -step * H * 0.25]) { const o = ty; tryVal((v) => { ty = v; }, o, o + d); }
      }
    }
    for (const st of scaleSteps) for (const cs of [1 + st, 1 / (1 + st)]) { const o = s; tryVal((v) => { s = v; }, o, o * cs); }
  };
  const run = (s0: number) => {
    for (const b of BONE_IDS) delete rot[b];
    s = s0; tx = W / 2; ty = H * 0.55; best = score() - prior();
    place([]);
    // coarse line search per joint (twice: the placement improves in between), then refinement of every parameter
    for (let pass = 0; pass < 2; pass++) {
      for (const b of ORDER) {
        const [lo, hi] = LIMITS[b]; let pick = rot[b] ?? 0;
        for (let a = Math.ceil(lo / 30) * 30; a <= hi; a += 30) { const old = rot[b] ?? 0; if (tryVal(setRot(b), old, a)) pick = a; }
        rot[b] = pick;
      }
      for (const [a, b] of PAIRS) {
        const [lo, hi] = LIMITS[a]; let pick: number | null = null;
        const oa = rot[a] ?? 0, ob = rot[b] ?? 0;
        for (let v = Math.ceil(lo / 30) * 30; v <= hi; v += 30) {
          const ca = rot[a] ?? 0, cb = rot[b] ?? 0;
          if (tryVal((x) => { rot[a] = x; rot[b] = x; }, ca, v) ) pick = v; else { rot[a] = ca; rot[b] = cb; }
        }
        if (pick === null) { rot[a] = oa; rot[b] = ob; }
      }
      place(pass ? [] : [0.06]);
    }
    place([0.06, 0.03]);
    for (const step of [24, 12, 6, 3, 1.5]) {
      for (let sweep = 0; sweep < 3; sweep++) {
        for (const b of ORDER) { const [lo, hi] = LIMITS[b]; for (const d of [step, -step]) { const old = rot[b] ?? 0, cand = Math.min(hi, Math.max(lo, old + d)); if (cand !== old) tryVal(setRot(b), old, cand); } }
        for (const chain of [['thigh', 'shin', 'foot'], ['uarm', 'farm', 'hand']]) {   // whole-limb copy: far limb takes the near limb's pose (and vice versa)
          for (const [fs, ts] of [['R', 'L'], ['L', 'R']]) {
            const ids = chain.map((c) => [c + fs, c + ts] as [BoneId, BoneId]);
            const olds = ids.map(([, t]) => rot[t] ?? 0);
            if (ids.every(([f], i) => Math.abs((rot[f] ?? 0) - olds[i]) < 1)) continue;
            ids.forEach(([f, t]) => { rot[t] = rot[f] ?? 0; });
            const sc = score() - prior(); if (sc > best + 1e-5) best = sc; else ids.forEach(([, t], i) => { rot[t] = olds[i]; });
          }
        }
        for (const [a, b] of PAIRS) {   // copy moves: the limb that is far from the silhouette takes the other one's angle
          for (const [from, to] of [[a, b], [b, a]] as [BoneId, BoneId][]) {
            const old = rot[to] ?? 0, v = rot[from] ?? 0; if (Math.abs(old - v) < 1) continue;
            rot[to] = v; const sc = score() - prior(); if (sc > best + 1e-5) best = sc; else rot[to] = old;
          }
        }
        for (const [a, b] of PAIRS) {
          const [lo, hi] = LIMITS[a];
          for (const d of [step, -step]) {
            const oa = rot[a] ?? 0, ob = rot[b] ?? 0, na = Math.min(hi, Math.max(lo, oa + d)), nb = Math.min(hi, Math.max(lo, ob + d));
            if (na === oa && nb === ob) continue;
            rot[a] = na; rot[b] = nb; const sc = score() - prior();
            if (sc > best + 1e-5) best = sc; else { rot[a] = oa; rot[b] = ob; }
          }
        }
        place([0.04, 0.02]);
      }
    }
    return best;
  };
  // the scale is entangled with the pose (raised arms make the drawing taller): try several starting scales, keep the best fit
  const s00 = s;
  let top: { best: number; s: number; tx: number; ty: number; rot: Partial<Record<BoneId, number>> } | null = null;
  for (const f of [0.8, 0.9, 1, 1.12, 1.3]) {
    const sc = run(s00 * f);
    if (!top || sc > top.best) top = { best: sc, s, tx, ty, rot: { ...rot } };
  }
  s = top!.s; tx = top!.tx; ty = top!.ty; for (const b of BONE_IDS) delete rot[b]; Object.assign(rot, top!.rot);
  const final = score();
  // landmarks: pose the reference landmarks, then map grid → target pixels
  const mats = boneMatrices(rig, pose), lm: Partial<Record<LandmarkId, Vec2>> = {};
  const inv = 1 / k;
  for (const [id, bone] of LM_BONE) {
    const p0 = ref.landmarks[id]; if (!p0) continue;
    const p = apply(mats[BONE_IDS.indexOf(bone)], p0);
    lm[id] = { x: tb.x + (tx + (p.x - pelvis.x) * s) * inv, y: tb.y + (ty + (p.y - pelvis.y) * s) * inv };
  }
  return { landmarks: lm, pose, scale: (s * inv), score: final };
}
