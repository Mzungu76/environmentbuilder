import type { BoneId, Pose, PoseSet, PuppetView } from '@/types';
import { BONE_IDS } from '@/types';
import { buildRig, restAngle } from './skeleton';

/**
 * Key-pose playback. Frames are full views (image + skeleton + mesh drawn in a posture). Between key A and key B the skeleton
 * difference (bone angles measured from each frame's own landmarks) tells how to bend A toward B and B toward A so that both
 * reach the same in-between pose; the two renders are then cross-faded. No DOM: usable by any host game.
 */

const norm = (a: number) => { let x = ((a + 180) % 360 + 360) % 360 - 180; if (x === -180) x = 180; return x; };
const smooth = (u: number) => (1 - Math.cos(Math.PI * u)) / 2;
const sharp = (u: number) => { const t = Math.min(1, Math.max(0, (u - 0.2) / 0.6)); return t * t * (3 - 2 * t); };

interface Measure { ang: number[]; parent: number[]; pelvis: { x: number; y: number }; ok: boolean }
const cache = new WeakMap<PuppetView, Measure>();
function measure(v: PuppetView): Measure {
  let m = cache.get(v);
  if (m) return m;
  const rig = buildRig(v);
  if (!rig) m = { ang: new Array(BONE_IDS.length).fill(0), parent: BONE_IDS.map(() => -1), pelvis: { x: 0, y: 0 }, ok: false };
  else {
    const ang = new Array(BONE_IDS.length).fill(0), parent = new Array(BONE_IDS.length).fill(-1);
    for (const b of rig.bones) { ang[b.index] = restAngle(b); parent[b.index] = b.parent; }
    const lm = v.landmarks.pelvis!;
    m = { ang, parent, pelvis: { x: (lm.x - v.pivot.x) / v.figureHeight, y: (lm.y - v.pivot.y) / v.figureHeight }, ok: true };
  }
  cache.set(v, m);
  return m;
}

/** Pose that bends `from` a fraction `u` of the way toward the posture of `to` (bone angles + pelvis position). */
export function posePartway(from: PuppetView, to: PuppetView, u: number): Pose {
  const a = measure(from), b = measure(to);
  const rot: Partial<Record<BoneId, number>> = {};
  if (!a.ok || !b.ok) return { rot, dx: 0, dy: 0 };
  const delta = a.ang.map((x, i) => norm(b.ang[i] - x));
  for (let i = 0; i < BONE_IDS.length; i++) {
    const p = a.parent[i];
    const r = u * (delta[i] - (p >= 0 ? delta[p] : 0));
    if (Math.abs(r) > 1e-4) rot[BONE_IDS[i]] = r;
  }
  return { rot, dx: u * (b.pelvis.x - a.pelvis.x), dy: u * (b.pelvis.y - a.pelvis.y) };
}

export interface SetLayer { view: PuppetView; pose: Pose; alpha: number }
export interface SetSample { under: SetLayer; over?: SetLayer }

/** Sample at `phase` (cycle fraction). `under` is drawn opaque; `over` (the neighbouring key) is drawn on top with `alpha`. */
export function sampleSet(set: PoseSet, phase: number): SetSample | null {
  const n = set.frames.length;
  if (n < 1) return null;
  if (n === 1) return { under: { view: set.frames[0], pose: { rot: {}, dx: 0, dy: 0 }, alpha: 1 } };
  const segs = set.loop ? n : n - 1;
  const t = set.loop ? ((phase % 1) + 1) % 1 : Math.min(1, Math.max(0, phase));
  const f = Math.min(segs - 1e-6, t * segs), i = Math.floor(f), raw = f - i, u = smooth(raw);
  const A = set.frames[i], B = set.frames[(i + 1) % n];
  const mixB = sharp(u);
  const pa = posePartway(A, B, u), pb = posePartway(B, A, 1 - u);
  if (u < 0.5) return { under: { view: A, pose: pa, alpha: 1 }, over: mixB > 0.003 ? { view: B, pose: pb, alpha: mixB } : undefined };
  return { under: { view: B, pose: pb, alpha: 1 }, over: 1 - mixB > 0.003 ? { view: A, pose: pa, alpha: 1 - mixB } : undefined };
}

/** Scale reference: the standing height implied by a frame's torso length (pose-independent, unlike the bounding box). */
export function torsoLength(v: Pick<PuppetView, 'landmarks'>): number | null {
  const { neck, pelvis } = v.landmarks;
  return neck && pelvis ? Math.hypot(neck.x - pelvis.x, neck.y - pelvis.y) : null;
}
export const TORSO_FRACTION = 0.33;

export interface FrameQuality { ok: boolean; issues: string[] }
/** Sanity check of a key-pose sequence: scale and limb proportions compared with the other frames (tolerances are wide on purpose). */
export function frameQualities(frames: Pick<PuppetView, 'landmarks' | 'figureHeight' | 'width' | 'height'>[]): FrameQuality[] {
  const LIMBS: [string, string][] = [['shoulderR', 'elbowR'], ['elbowR', 'wristR'], ['hipR', 'kneeR'], ['kneeR', 'ankleR'], ['neck', 'headTop']];
  const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const torso = frames.map((f) => torsoLength(f));
  const mt = med(torso.filter((t): t is number => !!t));
  const rel = frames.map((f, i) => LIMBS.map(([a, b]) => { const p = f.landmarks[a as 'neck'], q = f.landmarks[b as 'neck']; return p && q && torso[i] ? Math.hypot(p.x - q.x, p.y - q.y) / torso[i]! : null; }));
  const mrel = LIMBS.map((_, k) => med(rel.map((r) => r[k]).filter((v): v is number => v !== null)));
  return frames.map((f, i) => {
    const issues: string[] = [];
    const fs = (f as { fitScore?: number }).fitScore;
    if (fs !== undefined && fs < 0.6) issues.push('scheletro poco sicuro (la sagoma non coincide bene: ritoccalo)');
    if (Object.keys(f.landmarks).length < 19) issues.push('scheletro incompleto');
    else {
      for (const p of Object.values(f.landmarks)) if (p && (p.x < -0.08 * f.width || p.y < -0.08 * f.height || p.x > 1.08 * f.width || p.y > 1.08 * f.height)) { issues.push('articolazioni fuori dall’immagine'); break; }
      if (torso[i] && mt && Math.abs(torso[i]! / mt - 1) > 0.25) issues.push('scala del busto diversa dalle altre pose');
      const bad = LIMBS.filter((_, k) => rel[i][k] !== null && mrel[k] > 0 && Math.abs(rel[i][k]! / mrel[k] - 1) > 0.6).length;
      if (bad >= 2) issues.push('proporzioni degli arti molto diverse dalle altre pose');
    }
    return { ok: !issues.length, issues };
  });
}

const SWAP_GROUPS: Record<'arms' | 'legs', [string, string][]> = {
  arms: [['shoulderL', 'shoulderR'], ['elbowL', 'elbowR'], ['wristL', 'wristR'], ['handL', 'handR']],
  legs: [['hipL', 'hipR'], ['kneeL', 'kneeR'], ['ankleL', 'ankleR'], ['toeL', 'toeR']],
};
/**
 * A silhouette cannot tell the near limb from the far one. Walking the sequence in order, each frame's arms (and legs) are swapped
 * when that keeps them closer to the previous frame's, so a hand that goes up stays the same hand from key to key.
 */
export function alignLimbSides<T extends { landmarks: PuppetView['landmarks']; figureHeight: number }>(frames: T[]): T[] {
  const out = frames.map((f) => ({ ...f, landmarks: { ...f.landmarks } }));
  const rel = (f: T, id: string) => { const p = f.landmarks[id as 'neck'], o = f.landmarks.pelvis; return p && o ? { x: (p.x - o.x) / f.figureHeight, y: (p.y - o.y) / f.figureHeight } : null; };
  for (let k = 1; k < out.length; k++) {
    for (const group of Object.values(SWAP_GROUPS)) {
      let keep = 0, swap = 0;
      for (const [l, r] of group.slice(1)) {          // joints that move (not the shoulder / hip)
        const pl = rel(out[k - 1], l), pr = rel(out[k - 1], r), cl = rel(out[k], l), cr = rel(out[k], r);
        if (!pl || !pr || !cl || !cr) continue;
        keep += Math.hypot(cl.x - pl.x, cl.y - pl.y) + Math.hypot(cr.x - pr.x, cr.y - pr.y);
        swap += Math.hypot(cr.x - pl.x, cr.y - pl.y) + Math.hypot(cl.x - pr.x, cl.y - pr.y);
      }
      if (swap < keep * 0.85) for (const [l, r] of group) { const t = out[k].landmarks[l as 'neck']; out[k].landmarks[l as 'neck'] = out[k].landmarks[r as 'neck']; out[k].landmarks[r as 'neck'] = t; }
    }
  }
  return out;
}
