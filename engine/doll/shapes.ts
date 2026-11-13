import type { BoneId, Doll, LandmarkId, Pose, Vec2 } from '@/types';
import { BONE_IDS } from '@/types';
import { apply, boneMatrices, buildRig, type Mat, type Rig } from '@/engine/puppet/skeleton';

/**
 * Pure geometry of the "omino": proportions → rest skeleton → posed shapes.
 * Units: the figure is 1000 tall, feet at (0,0), y down (up is negative), the character faces +x.
 * Output is a flat list of polygons/polylines in drawing order: any renderer (Pixi, Canvas, SVG…) can draw it.
 */
export const DOLL_HEIGHT = 1000;

export interface DollShape {
  /** Flat [x0,y0,x1,y1,…]. */
  pts: number[];
  fill: string;
  /** 'line' = open (or closed) polyline stroked with width `w`, never filled. */
  kind?: 'poly' | 'line';
  w?: number;
  closed?: boolean;
  /** No outline around this shape. */
  bare?: boolean;
}

const H = DOLL_HEIGHT;
const IDX: Record<BoneId, number> = Object.fromEntries(BONE_IDS.map((b, i) => [b, i])) as Record<BoneId, number>;

/** Which bone carries each landmark. */
function owner(id: LandmarkId): BoneId {
  if (id === 'headTop' || id === 'neck') return 'head';
  if (id === 'pelvis') return 'pelvis';
  const m = id.match(/^(shoulder|elbow|wrist|hand|hip|knee|ankle|toe)([LR])$/)!;
  const side = m[2];
  switch (m[1]) {
    case 'shoulder': return `uarm${side}` as BoneId;
    case 'elbow': return `farm${side}` as BoneId;
    case 'wrist': case 'hand': return `hand${side}` as BoneId;
    case 'hip': return `thigh${side}` as BoneId;
    case 'knee': return `shin${side}` as BoneId;
    default: return `foot${side}` as BoneId;
  }
}

/** Rest landmarks (A-pose seen from the side) from the doll's proportions. R = near limbs, L = far limbs. */
export function dollLandmarks(doll: Doll): Record<LandmarkId, Vec2> {
  const b = doll.body;
  const headH = b.headSize * H, neckL = b.neck * H, torsoL = b.torso * H, footH = 0.035 * H;
  const top = -H, chin = top + headH, neckBase = chin + neckL, shY = neckBase + 0.015 * H, pelvisY = shY + torsoL, hipY = pelvisY + 0.02 * H, ankleY = -footH;
  const kneeY = (hipY + ankleY) / 2 + 0.01 * H;
  const armL = b.arm * H, up = armL * 0.52, fo = armL * 0.48, hand = b.hand * H, toeL = b.foot * H;
  const x = (f: number) => f * H;
  return {
    headTop: { x: x(0.012), y: top }, neck: { x: x(0.006), y: neckBase }, pelvis: { x: x(0), y: pelvisY },
    shoulderR: { x: 0, y: shY }, shoulderL: { x: x(0.012), y: shY },
    elbowR: { x: x(0.012), y: shY + up }, elbowL: { x: x(0.024), y: shY + up },
    wristR: { x: x(0.02), y: shY + up + fo }, wristL: { x: x(0.032), y: shY + up + fo },
    handR: { x: x(0.024), y: shY + up + fo + hand }, handL: { x: x(0.036), y: shY + up + fo + hand },
    hipR: { x: x(-0.008), y: hipY }, hipL: { x: x(0.012), y: hipY },
    kneeR: { x: x(0.004), y: kneeY }, kneeL: { x: x(0.016), y: kneeY },
    ankleR: { x: x(-0.004), y: ankleY }, ankleL: { x: x(0.01), y: ankleY },
    toeR: { x: x(-0.004) + toeL, y: ankleY + footH * 0.7 }, toeL: { x: x(0.01) + toeL, y: ankleY + footH * 0.7 },
  };
}

interface Cached { lm: Record<LandmarkId, Vec2>; rig: Rig }
const cache = new WeakMap<Doll, Cached>();
export function dollRig(doll: Doll): Cached {
  let c = cache.get(doll);
  if (!c) { const lm = dollLandmarks(doll); c = { lm, rig: buildRig({ landmarks: lm, figureHeight: H })! }; cache.set(doll, c); }
  return c;
}

// ---- geometry helpers ------------------------------------------------------------------------------------------------------
const ellipse = (c: Vec2, rx: number, ry: number, rot = 0, n = 20): number[] => {
  const out: number[] = [], co = Math.cos(rot), si = Math.sin(rot);
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, px = Math.cos(a) * rx, py = Math.sin(a) * ry; out.push(c.x + px * co - py * si, c.y + px * si + py * co); }
  return out;
};
/** Stadium shape between two circles. */
const capsule = (a: Vec2, b: Vec2, ra: number, rb: number, n = 7): number[] => {
  const th = Math.atan2(b.y - a.y, b.x - a.x), out: number[] = [];
  for (let i = 0; i <= n; i++) { const t = th + Math.PI / 2 + (i / n) * Math.PI; out.push(a.x + Math.cos(t) * ra, a.y + Math.sin(t) * ra); }
  for (let i = 0; i <= n; i++) { const t = th - Math.PI / 2 + (i / n) * Math.PI; out.push(b.x + Math.cos(t) * rb, b.y + Math.sin(t) * rb); }
  return out;
};
const roundRect = (c: Vec2, w: number, h: number, r: number, rot = 0): number[] => {
  const hw = w / 2 - r, hh = h / 2 - r, out: number[] = [], co = Math.cos(rot), si = Math.sin(rot);
  const corners: [number, number, number][] = [[hw, -hh, -Math.PI / 2], [hw, hh, 0], [-hw, hh, Math.PI / 2], [-hw, -hh, Math.PI]];
  for (const [cx, cy, a0] of corners) for (let i = 0; i <= 4; i++) { const a = a0 + (i / 4) * (Math.PI / 2), px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r; out.push(c.x + px * co - py * si, c.y + px * si + py * co); }
  return out;
};
const mapPts = (pts: number[], m: Mat): number[] => { const o = new Array(pts.length); for (let i = 0; i < pts.length; i += 2) { o[i] = m[0] * pts[i] + m[2] * pts[i + 1] + m[4]; o[i + 1] = m[1] * pts[i] + m[3] * pts[i + 1] + m[5]; } return o; };
const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const mid = (a: Vec2, b: Vec2) => lerp(a, b, 0.5);

export function shade(hex: string, f: number): string {
  const n = parseInt(hex.replace('#', ''), 16) || 0;
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(f >= 0 ? v * (1 - f) : v + (255 - v) * -f)));
  return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => ch(v).toString(16).padStart(2, '0')).join('');
}

const SLEEVE: Record<Doll['features']['top'], [number, number]> = { tshirt: [0.55, 0], shirt: [1, 0], jacket: [1, 0.96], vest: [0, 0] };

/** Posed shapes of the doll, back to front. `pose` is the same Pose the puppets use (rotations in degrees per bone). */
export function buildDollShapes(doll: Doll, pose: Pose): DollShape[] {
  const { lm, rig } = dollRig(doll);
  const M = boneMatrices(rig, pose);
  const mat = (b: BoneId) => M[IDX[b]];
  const P = (id: LandmarkId): Vec2 => apply(mat(owner(id)), lm[id]);
  const c = doll.colors, f = doll.features, b = doll.body;
  const out: DollShape[] = [];
  const add = (pts: number[], fill: string, extra: Partial<DollShape> = {}) => out.push({ pts, fill, ...extra });
  const farSkin = shade(c.skin, doll.style.farShade), farTop = shade(c.top, doll.style.farShade), farBottom = shade(c.bottom, doll.style.farShade), farShoes = shade(c.shoes, doll.style.farShade);
  const has = (id: string) => doll.accessories.find((a) => a.id === id);
  const acc = (id: string) => has(id)?.color ?? '#888888';

  const armR = b.armThickness * H, legR = b.legThickness * H, tw = b.torsoWidth * H * 0.6, handR = b.hand * H * 0.62;
  const [sleeveU, sleeveF] = SLEEVE[f.top];
  const arm = (s: 'L' | 'R') => {
    const far = s === 'L', skin = far ? farSkin : c.skin, top = far ? farTop : c.top;
    const sh = P(`shoulder${s}`), el = P(`elbow${s}`), wr = P(`wrist${s}`), hd = P(`hand${s}`);
    add(capsule(sh, el, armR, armR * 0.9), skin);
    add(capsule(el, wr, armR * 0.88, armR * 0.72), skin);
    if (sleeveU > 0) add(capsule(sh, lerp(sh, el, sleeveU), armR * 1.08, armR * (sleeveU >= 1 ? 1.0 : 0.98)), top);
    if (sleeveF > 0) add(capsule(el, lerp(el, wr, sleeveF), armR * 0.94, armR * 0.78), top);
    if (has('gloves')) { const g = far ? shade(acc('gloves'), doll.style.farShade) : acc('gloves'); add(capsule(lerp(el, wr, 0.8), wr, armR * 0.86, armR * 0.8), g); add(ellipse(mid(wr, hd), handR * 1.08, handR * 1.2, Math.atan2(hd.y - wr.y, hd.x - wr.x) + Math.PI / 2), g); }
    else add(ellipse(mid(wr, hd), handR, handR * 1.15, Math.atan2(hd.y - wr.y, hd.x - wr.x) + Math.PI / 2), skin);
  };
  const leg = (s: 'L' | 'R') => {
    const far = s === 'L', skin = far ? farSkin : c.skin, bottom = far ? farBottom : c.bottom, shoes = far ? farShoes : c.shoes;
    const hp = P(`hip${s}`), kn = P(`knee${s}`), an = P(`ankle${s}`), to = P(`toe${s}`);
    const shorts = f.bottom === 'shorts';
    add(capsule(hp, kn, legR * 1.05, legR * 0.9), shorts ? skin : bottom);
    add(capsule(kn, an, legR * 0.88, legR * 0.7), shorts ? skin : bottom);
    if (shorts) add(capsule(hp, lerp(hp, kn, 0.62), legR * 1.12, legR * 1.02), bottom);
    if (f.bottom === 'cargo') add(roundRect(lerp(hp, kn, 0.45), legR * 1.5, legR * 1.7, legR * 0.3, Math.atan2(kn.y - hp.y, kn.x - hp.x) - Math.PI / 2), shade(bottom, 0.18), { bare: false });
    if (f.shoes === 'boots') add(capsule(an, lerp(an, kn, 0.3), legR * 0.86, legR * 0.84), shoes);
    add(capsule(an, to, legR * 0.8, legR * 0.5), f.shoes === 'bare' ? skin : shoes);
    if (f.shoes === 'sneakers') add(capsule(lerp(an, to, 0.05), to, legR * 0.22, legR * 0.22), '#f4f4f4', { bare: true });
    if (has('kneepads')) add(ellipse({ x: kn.x + legR * 0.35, y: kn.y }, legR * 0.95, legR * 1.05, Math.atan2(kn.y - hp.y, kn.x - hp.x) - Math.PI / 2), far ? shade(acc('kneepads'), doll.style.farShade) : acc('kneepads'));
  };

  // 1) far limbs
  arm('L'); leg('L');

  // 2) behind the torso: backpack, pickaxe, back hair
  const mt = mat('torso'), shY = lm.shoulderR.y, pelY = lm.pelvis.y, torsoL = pelY - shY;
  if (has('pickaxe')) {
    const base = { x: -tw - 0.075 * H, y: pelY - torsoL * 0.1 }, tip = { x: -tw - 0.085 * H, y: shY - 0.16 * H };
    add(mapPts(capsule(base, tip, 0.011 * H, 0.011 * H), mt), '#8a5a2b');
    const head = [tip.x - 0.1 * H, tip.y + 0.045 * H, tip.x - 0.04 * H, tip.y - 0.005 * H, tip.x + 0.045 * H, tip.y - 0.012 * H, tip.x + 0.1 * H, tip.y + 0.04 * H, tip.x + 0.03 * H, tip.y + 0.012 * H, tip.x - 0.04 * H, tip.y + 0.015 * H];
    add(mapPts(head, mt), acc('pickaxe'));
  }
  if (has('backpack')) {
    const col = acc('backpack'), cx = -tw - 0.04 * H, cy = shY + torsoL * 0.42;
    add(mapPts(roundRect({ x: cx, y: cy }, 0.11 * H, torsoL * 0.86, 0.035 * H), mt), col);
    add(mapPts(ellipse({ x: cx - 0.004 * H, y: cy - torsoL * 0.43 - 0.012 * H }, 0.055 * H, 0.03 * H), mt), shade(col, -0.18));
    add(mapPts(roundRect({ x: cx - 0.03 * H, y: cy + torsoL * 0.12 }, 0.05 * H, torsoL * 0.3, 0.015 * H), mt), shade(col, 0.18));
  }
  const hc0 = { x: lm.headTop.x, y: lm.headTop.y + (b.headSize * H) / 2 }, rx = (b.headSize * H * 0.5) * b.headWidth * 0.92, ry = (b.headSize * H) / 2;
  const mh = mat('head');
  const hl = (dx: number, dy: number): Vec2 => apply(mh, { x: hc0.x + dx, y: hc0.y + dy });   // head-local → posed
  const hpoly = (pts: [number, number][]) => pts.flatMap(([dx, dy]) => { const p = hl(dx, dy); return [p.x, p.y]; });
  const hellipse = (dx: number, dy: number, ex: number, ey: number, rot = 0) => { const p = hl(dx, dy); return ellipse(p, ex, ey, rot + Math.atan2(mh[1], mh[0])); };
  if (f.hair === 'long') add(hpoly([[-rx * 0.4, -ry * 0.5], [-rx * 1.05, -ry * 0.1], [-rx * 1.15, ry * 1.5], [-rx * 0.55, ry * 1.95], [rx * 0.05, ry * 1.2]]), c.hair);
  if (f.hair === 'ponytail') add(capsule(hl(-rx * 0.8, -ry * 0.35), hl(-rx * 1.7, ry * 0.7), ry * 0.2, ry * 0.12), c.hair);

  // 3) torso, pelvis, belt, neck
  const sMid = mid(P('shoulderR'), P('shoulderL')), hMid = mid(P('hipR'), P('hipL')), pel = P('pelvis');
  add(capsule({ x: sMid.x, y: sMid.y - 0.012 * H }, pel, tw * 0.95, tw * 0.86 * b.hips), c.top);
  add(capsule(pel, hMid, tw * 0.9 * b.hips, tw * 0.88 * b.hips), f.bottom === 'shorts' || f.bottom === 'long' || f.bottom === 'cargo' ? c.bottom : c.bottom);
  if (f.top === 'jacket' || f.top === 'vest') add(capsule(lerp(sMid, pel, 0.08), lerp(sMid, pel, 0.9), tw * 0.2, tw * 0.2), shade(c.top, 0.25), { bare: true });
  if (f.top === 'vest') add(capsule({ x: sMid.x + tw * 0.2, y: sMid.y }, { x: pel.x + tw * 0.2, y: pel.y - 0.03 * H }, tw * 0.28, tw * 0.28), c.accent, { bare: true });
  if (has('belt')) { const p0 = mat('pelvis'); add(mapPts(roundRect({ x: 0, y: pelY + 0.003 * H }, tw * 2.05, 0.03 * H, 0.008 * H), p0), acc('belt')); add(mapPts(roundRect({ x: tw * 0.7, y: pelY + 0.003 * H }, 0.026 * H, 0.026 * H, 0.004 * H), p0), '#c9c9c9'); }
  const nk = P('neck'), headBot = hl(rx * 0.1, ry * 0.85);
  add(capsule(nk, headBot, 0.03 * H, 0.026 * H), c.skin);

  // 4) head
  if (f.hair === 'bun') add(hellipse(-rx * 0.5, -ry * 1.02, ry * 0.3, ry * 0.3), c.hair);
  add(hellipse(0, 0, rx, ry), c.skin);
  add(hellipse(-rx * 0.1, ry * 0.08, ry * 0.12, ry * 0.17), shade(c.skin, 0.1), { bare: true });   // ear
  add(hellipse(rx * 0.98, ry * 0.12, ry * 0.1, ry * 0.12), shade(c.skin, 0.06));                      // nose
  const eyeX = rx * 0.5, eyeY = -ry * 0.1;
  add(hellipse(eyeX, eyeY, ry * 0.075, ry * (f.face === 'dots' ? 0.075 : 0.1)), '#1b1f27', { bare: true });
  if (f.face !== 'dots') {
    const tilt = f.face === 'stern' ? 0.16 : f.face === 'smile' ? -0.05 : 0;
    add(hpoly([[eyeX - ry * 0.15, -ry * 0.3 + (tilt > 0 ? -ry * 0.04 : 0)], [eyeX + ry * 0.17, -ry * 0.3 + tilt * ry * 0.6]]), '#2b2018', { kind: 'line', w: 0.009 * H, bare: true });
  }
  if (f.face === 'smile') add(hpoly([[rx * 0.32, ry * 0.45], [rx * 0.5, ry * 0.55], [rx * 0.7, ry * 0.46]]), '#7a3b2b', { kind: 'line', w: 0.008 * H, bare: true });
  if (f.face === 'stern') add(hpoly([[rx * 0.35, ry * 0.52], [rx * 0.68, ry * 0.5]]), '#7a3b2b', { kind: 'line', w: 0.008 * H, bare: true });
  if (f.face === 'simple') add(hpoly([[rx * 0.4, ry * 0.5], [rx * 0.66, ry * 0.5]]), '#7a3b2b', { kind: 'line', w: 0.008 * H, bare: true });
  if (has('glasses')) { add(hellipse(eyeX, eyeY, ry * 0.22, ry * 0.2), acc('glasses'), { kind: 'line', w: 0.008 * H, closed: true, bare: true }); add(hpoly([[eyeX - ry * 0.22, eyeY], [-rx * 0.05, eyeY - ry * 0.02]]), acc('glasses'), { kind: 'line', w: 0.007 * H, bare: true }); }
  if (f.hair !== 'none') {
    const arc: [number, number][] = [];
    for (let i = 0; i <= 14; i++) { const a = Math.PI + (i / 14) * Math.PI; arc.push([Math.cos(a) * rx * 1.05, Math.sin(a) * ry * 1.03 - ry * 0.02]); }
    const hairline: [number, number][] = f.hair === 'messy' ? [[rx * 0.9, -ry * 0.25], [rx * 0.55, -ry * 0.45], [rx * 0.2, -ry * 0.32], [-rx * 0.3, -ry * 0.4]] : [[rx * 1.0, -ry * 0.28], [rx * 0.4, -ry * 0.4], [-rx * 0.4, -ry * 0.3]];
    add(hpoly([...arc, ...hairline]), c.hair);
    if (f.hair === 'messy') for (const [dx, w] of [[-0.55, 0.22], [-0.05, 0.25], [0.5, 0.2]] as const) add(hpoly([[rx * dx - rx * w, -ry * 0.98], [rx * dx, -ry * 1.35], [rx * dx + rx * w, -ry * 0.98]]), c.hair);
  }
  if (has('helmet')) {
    const col = acc('helmet'), dome: [number, number][] = [];
    for (let i = 0; i <= 14; i++) { const a = Math.PI + (i / 14) * Math.PI; dome.push([Math.cos(a) * rx * 1.16, Math.sin(a) * ry * 1.1 - ry * 0.12]); }
    add(hpoly([...dome, [rx * 1.2, -ry * 0.2], [-rx * 1.18, -ry * 0.2]]), col);
    add(hpoly([[-rx * 1.18, -ry * 0.2], [rx * 1.32, -ry * 0.2], [rx * 1.3, -ry * 0.1], [-rx * 1.18, -ry * 0.08]]), shade(col, 0.2));
    add(hpoly([[rx * 0.2, -ry * 0.9], [rx * 0.55, -ry * 0.98], [rx * 0.5, -ry * 0.55], [rx * 0.18, -ry * 0.5]]), shade(col, -0.2), { bare: true });
    add(hellipse(rx * 1.18, -ry * 0.62, ry * 0.2, ry * 0.2), '#fff6c8');
    add(hellipse(rx * 1.18, -ry * 0.62, ry * 0.09, ry * 0.09), '#ffffff', { bare: true });
  }
  if (has('cap')) {
    const col = acc('cap'), dome: [number, number][] = [];
    for (let i = 0; i <= 14; i++) { const a = Math.PI + (i / 14) * Math.PI; dome.push([Math.cos(a) * rx * 1.08, Math.sin(a) * ry * 1.06 - ry * 0.06]); }
    add(hpoly([...dome, [rx * 1.0, -ry * 0.12], [-rx * 1.0, -ry * 0.12]]), col);
    add(hpoly([[rx * 0.7, -ry * 0.3], [rx * 1.55, -ry * 0.12], [rx * 1.5, -ry * 0.02], [rx * 0.6, -ry * 0.1]]), shade(col, 0.25));
  }
  if (has('hat')) {
    const col = acc('hat'), dome: [number, number][] = [];
    for (let i = 0; i <= 14; i++) { const a = Math.PI + (i / 14) * Math.PI; dome.push([Math.cos(a) * rx * 0.95, Math.sin(a) * ry * 0.95 - ry * 0.35]); }
    add(hellipse(rx * 0.1, -ry * 0.28, rx * 1.75, ry * 0.2), shade(col, 0.15));
    add(hpoly([...dome, [rx * 0.95, -ry * 0.35], [-rx * 0.95, -ry * 0.35]]), col);
    add(hpoly([[-rx * 0.95, -ry * 0.42], [rx * 0.95, -ry * 0.42], [rx * 0.95, -ry * 0.52], [-rx * 0.95, -ry * 0.52]]), c.accent, { bare: true });
  }

  // 5) near limbs
  leg('R'); arm('R');

  // 6) front accessories
  if (has('scarf')) {
    const col = acc('scarf');
    const nkp = P('neck');
    add(capsule({ x: nkp.x - 0.035 * H, y: nkp.y - 0.004 * H }, { x: nkp.x + 0.04 * H, y: nkp.y + 0.006 * H }, 0.026 * H, 0.03 * H), col);
    const ox = sMid.x + tw * 0.35, oy = sMid.y + 0.004 * H;
    add([0, 0, 0.05 * H, 0.012 * H, 0.03 * H, 0.1 * H, -0.01 * H, 0.085 * H].map((v, i) => v + (i % 2 ? oy : ox)), shade(col, 0.15));
  }
  if (has('backpack')) add(capsule({ x: sMid.x - tw * 0.1, y: sMid.y - 0.005 * H }, { x: pel.x + tw * 0.35, y: pel.y - torsoL * 0.12 }, 0.011 * H, 0.011 * H), shade(acc('backpack'), 0.25));
  return out;
}
