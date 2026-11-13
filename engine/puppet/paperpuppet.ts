import type { BoneId, LandmarkId, Mesh, Skin, Vec2 } from '@/types';
import { BONE_IDS } from '@/types';
import { BONE_DEFS } from './skeleton';
import { components, newImg, type Img } from './imageProc';

/**
 * Paper puppet ("burattino di carta"): the character arrives as a sheet of SEPARATE parts drawn by the AI (head, torso, pelvis,
 * arm, forearm, hand, thigh, shin, foot + optional accessories). This module
 *   1. finds the parts on the sheet (connected components, two rows, left → right — tolerant to the AI not respecting the slots);
 *   2. finds each part's joints from its own pixels (centre of the rounded ends);
 *   3. assembles the standing pose by chaining joints, with the far arm/leg as darkened copies;
 *   4. produces the assembled cut-out, a texture atlas and a rigid-part mesh skinned to the existing 15-bone skeleton, so the
 *      existing animation clips, player, Playtest and export work unchanged.
 */

export const PART_IDS = ['head', 'torso', 'pelvis', 'uarm', 'farm', 'hand', 'thigh', 'shin', 'foot'] as const;
export type PartId = (typeof PART_IDS)[number];
export const LIMB_IDS = ['uarm', 'farm', 'hand', 'thigh', 'shin', 'foot'] as const;
export type LimbId = (typeof LIMB_IDS)[number];
/** Frontal sheets can draw the image-LEFT limbs as pieces of their own (keys …L), instead of mirroring the right ones. */
export type LimbLeft = `${LimbId}L`;
export type PieceId = PartId | 'accA' | 'accB' | LimbLeft;
export const PIECE_LABEL: Record<PieceId, string> = {
  head: 'Testa', torso: 'Busto', pelvis: 'Bacino', uarm: 'Braccio', farm: 'Avambraccio', hand: 'Mano', thigh: 'Coscia', shin: 'Gamba', foot: 'Piede', accA: 'Accessorio A', accB: 'Accessorio B',
  uarmL: 'Braccio sx', farmL: 'Avambraccio sx', handL: 'Mano sx', thighL: 'Coscia sx', shinL: 'Gamba sx', footL: 'Piede sx',
};
const TOP_ROW: PieceId[] = ['head', 'torso', 'pelvis', 'accA', 'accB'];
const BOTTOM_ROW: PieceId[] = ['uarm', 'farm', 'hand', 'thigh', 'shin', 'foot'];

export type Pieces = Partial<Record<PieceId, Img>>;
export interface Extracted { pieces: Pieces; warnings: string[] }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ---- 1) finding the parts ------------------------------------------------------------------------------------------------------
/** `keyed` = the sheet with the background already removed (alpha). Throws an Error with a readable message when the sheet cannot be read. */
export function extractPieces(keyed: Img): Extracted {
  const cc = components(keyed, 24);
  if (!cc.count) throw new Error('Non trovo nessun pezzo nell’immagine: controlla la rimozione dello sfondo.');
  const maxArea = Math.max(...cc.areas), keep = cc.areas.map((a) => a >= Math.max(200, maxArea * 0.04));
  const mainIds = cc.areas.map((_, i) => i).filter((i) => keep[i]);
  // small fragments (stray pixels, a detached finger…) join the nearest main component
  const owner = new Int32Array(cc.count).fill(-1);
  for (const i of mainIds) owner[i] = i;
  const dist = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => {
    const dx = Math.max(0, Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w))), dy = Math.max(0, Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h))); return Math.hypot(dx, dy);
  };
  for (let i = 0; i < cc.count; i++) if (!keep[i]) {
    let best = -1, bd = Infinity;
    for (const j of mainIds) { const d = dist(cc.boxes[i], cc.boxes[j]); if (d < bd) { bd = d; best = j; } }
    if (best >= 0 && bd < Math.max(keyed.width, keyed.height) * 0.04) owner[i] = best;
  }
  const groups = new Map<number, { ids: number[]; box: { x0: number; y0: number; x1: number; y1: number } }>();
  for (let i = 0; i < cc.count; i++) {
    const o = owner[i]; if (o < 0) continue;
    const b = cc.boxes[i]; let g = groups.get(o);
    if (!g) { g = { ids: [], box: { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity } }; groups.set(o, g); }
    g.ids.push(i); g.box.x0 = Math.min(g.box.x0, b.x); g.box.y0 = Math.min(g.box.y0, b.y); g.box.x1 = Math.max(g.box.x1, b.x + b.w); g.box.y1 = Math.max(g.box.y1, b.y + b.h);
  }
  const list = [...groups.values()].map((g) => ({ ...g, cy: (g.box.y0 + g.box.y1) / 2, cx: (g.box.x0 + g.box.x1) / 2 }));
  if (list.length < 9) throw new Error(`Ho trovato ${list.length} pezzi separati, ne servono almeno 9 (testa, busto, bacino, braccio, avambraccio, mano, coscia, gamba, piede). Se due pezzi si toccano, rigenera il foglio lasciando più spazio.`);
  // rows: the top row (head, torso, pelvis, gear) and one or two rows of limbs — split at the largest vertical gaps between piece centres
  const byY = [...list].sort((a, b) => a.cy - b.cy);
  const gaps = byY.slice(1).map((g, i) => ({ i: i + 1, gap: g.cy - byY[i].cy })).sort((a, b) => b.gap - a.gap);
  let cut = gaps[0].i;
  const warnings: string[] = [];
  let top = byY.slice(0, cut).sort((a, b) => a.cx - b.cx), rest = byY.slice(cut);
  let bottom = rest.sort((a, b) => a.cx - b.cx), bottomL: typeof rest | null = null;
  if (rest.length >= 11) {      // two rows of limbs: right then left of the image
    const rs = [...rest].sort((a, b) => a.cy - b.cy);
    let c2 = 1, g2 = -1; for (let i = 1; i < rs.length; i++) { const g = rs[i].cy - rs[i - 1].cy; if (g > g2) { g2 = g; c2 = i; } }
    bottom = rs.slice(0, c2).sort((a, b) => a.cx - b.cx); bottomL = rs.slice(c2).sort((a, b) => a.cx - b.cx);
    if (bottom.length !== 6 || bottomL.length !== 6) throw new Error(`Con gli arti su due righe servono 6 pezzi per riga: ne ho trovati ${bottom.length} e ${bottomL.length}.`);
  }
  if (top.length < 3) throw new Error(`Nella riga alta servono almeno 3 pezzi (testa, busto, bacino): ne ho trovati ${top.length}.`);
  if (bottom.length !== 6) throw new Error(`Nella riga degli arti servono 6 pezzi (braccio, avambraccio, mano, coscia, gamba, piede): ne ho trovati ${bottom.length}.`);
  if (top.length > 5) warnings.push(`Nella riga alta ci sono ${top.length} pezzi: uso i primi 5 (testa, busto, bacino e due accessori).`);
  const assign = (row: typeof top, ids: PieceId[], pieces: Pieces) => row.slice(0, ids.length).forEach((g, k) => {
    const x0 = Math.floor(g.box.x0), y0 = Math.floor(g.box.y0), w = Math.ceil(g.box.x1) - x0, h = Math.ceil(g.box.y1) - y0, P = 3;
    const img = newImg(w + 2 * P, h + 2 * P), set = new Set(g.ids);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const l = cc.labels[(y0 + y) * keyed.width + x0 + x]; if (l < 0 || !set.has(l)) continue;
      const s = ((y0 + y) * keyed.width + x0 + x) * 4, t = ((y + P) * img.width + x + P) * 4;
      img.data[t] = keyed.data[s]; img.data[t + 1] = keyed.data[s + 1]; img.data[t + 2] = keyed.data[s + 2]; img.data[t + 3] = keyed.data[s + 3];
    }
    pieces[ids[k]] = img;
  });
  const pieces: Pieces = {};
  assign(top, TOP_ROW, pieces); assign(bottom, BOTTOM_ROW, pieces);
  if (bottomL) assign(bottomL, BOTTOM_ROW.map((id) => `${id}L` as PieceId), pieces);
  return { pieces, warnings };
}

// ---- 2) joints from the pixels ---------------------------------------------------------------------------------------------------
const alphaOf = (img: Img, x: number, y: number) => img.data[(y * img.width + x) * 4 + 3];
/** Mean x of the opaque pixels in rows [y0, y1). */
function rowsCx(img: Img, y0: number, y1: number): number {
  let s = 0, n = 0;
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(img.height, Math.ceil(y1)); y++) for (let x = 0; x < img.width; x++) if (alphaOf(img, x, y) > 40) { s += x; n++; }
  return n ? s / n : img.width / 2;
}
/** Mean y of the opaque pixels in columns [x0, x1). */
function colsCy(img: Img, x0: number, x1: number): number {
  let s = 0, n = 0;
  for (let x = Math.max(0, Math.floor(x0)); x < Math.min(img.width, Math.ceil(x1)); x++) for (let y = 0; y < img.height; y++) if (alphaOf(img, x, y) > 40) { s += y; n++; }
  return n ? s / n : img.height / 2;
}
/** Width of the opaque pixels on the rows [y0, y1) (mean per row). */
function rowsWidth(img: Img, y0: number, y1: number): number {
  let tot = 0, rows = 0;
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(img.height, Math.ceil(y1)); y++) { let c = 0; for (let x = 0; x < img.width; x++) if (alphaOf(img, x, y) > 40) c++; if (c) { tot += c; rows++; } }
  return rows ? tot / rows : 0;
}
function opaqueBox(img: Img) {
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (alphaOf(img, x, y) > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

interface Joints { prox: Vec2; dist: Vec2; extra?: Vec2; top?: Vec2 }
/** Joint points in the piece's own pixel coordinates. */
export function jointsOf(id: PieceId, img: Img, frontal = false): Joints {
  const b = opaqueBox(img), top = b.y0, H = b.h, bot = b.y1;
  const at = (f: number) => top + f * H;
  switch (id) {
    case 'head': return { prox: { x: rowsCx(img, at(0.82), at(0.97)), y: at(0.88) }, dist: { x: rowsCx(img, at(0), at(0.1)), y: top + 1 }, top: { x: rowsCx(img, at(0), at(0.1)), y: top + 1 } };
    case 'torso': return { prox: { x: rowsCx(img, at(0.85), at(0.97)), y: at(0.9) }, dist: { x: rowsCx(img, at(0), at(0.12)), y: at(0.12) }, extra: { x: rowsCx(img, at(0.1), at(0.3)), y: at(0.2) } };
    case 'pelvis': return { prox: { x: rowsCx(img, at(0), at(0.2)), y: at(0.2) }, dist: { x: rowsCx(img, at(0.5), at(0.85)), y: at(0.68) } };
    case 'hand': return { prox: { x: rowsCx(img, at(0), at(0.18)), y: at(0.16) }, dist: { x: rowsCx(img, at(0.82), bot), y: at(0.94) } };
    case 'foot': {
      if (frontal) return { prox: { x: rowsCx(img, at(0), at(0.2)), y: at(0.22) }, dist: { x: rowsCx(img, at(0.8), bot), y: at(0.88) } };
      const x0 = b.x0, W = b.w;
      return { prox: { x: x0 + W * 0.3, y: at(0.28) }, dist: { x: x0 + W * 0.94, y: colsCy(img, x0 + W * 0.88, x0 + W) } };
    }
    default: { // limbs: the rounded ends are circles of the limb's width
      const wTop = rowsWidth(img, at(0), at(0.12)), wBot = rowsWidth(img, at(0.88), bot);
      return { prox: { x: rowsCx(img, at(0), at(0.12)), y: top + clamp(wTop * 0.55, 0.06 * H, 0.25 * H) }, dist: { x: rowsCx(img, at(0.88), bot), y: bot - clamp(wBot * 0.55, 0.06 * H, 0.25 * H) } };
    }
  }
}

// ---- 3) assembly -------------------------------------------------------------------------------------------------------------------
const FAR_DX = 0.012;                                           // far limbs sit slightly ahead (× figure height)
const Z_ORDER: { id: PieceId; far?: boolean }[] = [
  { id: 'accA' },
  { id: 'uarm', far: true }, { id: 'farm', far: true }, { id: 'hand', far: true }, { id: 'thigh', far: true }, { id: 'shin', far: true }, { id: 'foot', far: true },
  { id: 'pelvis' }, { id: 'torso' }, { id: 'head' }, { id: 'accB' },
  { id: 'thigh' }, { id: 'shin' }, { id: 'foot' }, { id: 'uarm' }, { id: 'farm' }, { id: 'hand' },
];
const BONE_OF = (id: PieceId, far: boolean): BoneId => {
  const side = far ? 'L' : 'R';
  switch (id) { case 'head': return 'head'; case 'torso': case 'accA': case 'accB': return 'torso'; case 'pelvis': return 'pelvis'; case 'uarm': return `uarm${side}`; case 'farm': return `farm${side}`; case 'hand': return `hand${side}`; case 'thigh': return `thigh${side}`; case 'shin': return `shin${side}`; default: return `foot${side}`; }
};

export interface Placed { id: PieceId; far: boolean; bone: BoneId; img: Img; x: number; y: number; /** The piece's joint with its parent bone, in the same coordinates as x / y (for soft joints). */ prox?: Vec2 }
export interface PaperAssembly {
  placed: Placed[];
  landmarks: Partial<Record<LandmarkId, Vec2>>;
  /** Assembled standing figure (transparent background), tight to the parts. */
  cutout: Img;
  figureHeight: number;
  pivot: Vec2;
}

export interface PaperOptions { farShade: number; /** per piece: offset from its default place (px) and depth bias */ adjust?: Record<string, { dx: number; dy: number; z: number }>; /** manual joint corrections: piece id → joints in the piece's pixels */ joints?: Partial<Record<PieceId, Partial<Joints>>> }
export const DEFAULT_PAPER: PaperOptions = { farShade: 0.32 };

function darkened(img: Img, shade: number): Img {
  const o = newImg(img.width, img.height), k = 1 - shade;
  for (let i = 0; i < img.data.length; i += 4) { o.data[i] = img.data[i] * k; o.data[i + 1] = img.data[i + 1] * k; o.data[i + 2] = img.data[i + 2] * k; o.data[i + 3] = img.data[i + 3]; }
  return o;
}

export function assemble(pieces: Pieces, opt: PaperOptions = DEFAULT_PAPER): PaperAssembly {
  for (const id of PART_IDS) if (!pieces[id]) throw new Error(`Manca il pezzo «${PIECE_LABEL[id]}».`);
  const J = (id: PieceId): Joints => ({ ...jointsOf(id, pieces[id]!), ...(opt.joints?.[id] ?? {}) });
  const jp = Object.fromEntries((PART_IDS as readonly PieceId[]).map((id) => [id, J(id)])) as Record<PartId, Joints>;
  const pos: Partial<Record<PieceId, Vec2>> = {};
  const sub = (a: Vec2, b: Vec2) => ({ x: a.x - b.x, y: a.y - b.y }), add = (a: Vec2, b: Vec2) => ({ x: a.x + b.x, y: a.y + b.y });
  const off = (id: PieceId): Vec2 => { const a = opt.adjust?.[id]; return a ? { x: a.dx, y: a.dy } : { x: 0, y: 0 }; };
  pos.pelvis = { x: 0, y: 0 };
  const waist = add(pos.pelvis, jp.pelvis.prox), hip = add(pos.pelvis, jp.pelvis.dist);
  pos.torso = add(sub(waist, jp.torso.prox), off('torso'));
  const neck = add(pos.torso, jp.torso.dist), shoulder = add(pos.torso, jp.torso.extra ?? jp.torso.dist);
  pos.head = add(sub(neck, jp.head.prox), off('head'));
  const headTop = add(pos.head, jp.head.top ?? jp.head.dist);
  pos.uarm = add(sub(shoulder, jp.uarm.prox), off('uarm')); const elbow = add(pos.uarm, jp.uarm.dist);
  pos.farm = add(sub(elbow, jp.farm.prox), off('farm')); const wrist = add(pos.farm, jp.farm.dist);
  pos.hand = add(sub(wrist, jp.hand.prox), off('hand')); const handTip = add(pos.hand, jp.hand.dist);
  pos.thigh = add(sub(hip, jp.thigh.prox), off('thigh')); const knee = add(pos.thigh, jp.thigh.dist);
  pos.shin = add(sub(knee, jp.shin.prox), off('shin')); const ankle = add(pos.shin, jp.shin.dist);
  pos.foot = add(sub(ankle, jp.foot.prox), off('foot')); const toe = add(pos.foot, jp.foot.dist);
  const footImg = pieces.foot!, footBottom = pos.foot.y + opaqueBox(footImg).y1;
  const H = Math.max(10, footBottom - headTop.y), dx = FAR_DX * H;
  // accessories ride on the torso: A behind (backpack), B in front
  const tI = pieces.torso!, tb = opaqueBox(tI);
  if (pieces.accA) {   // backpack: sticks out behind the back (25% of its width overlaps the torso)
    const ab = opaqueBox(pieces.accA), o = off('accA');
    pos.accA = { x: pos.torso.x + tb.x0 + 0.25 * ab.w - (ab.x0 + ab.w) + o.x, y: pos.torso.y + tb.y0 + tb.h * 0.45 - (ab.y0 + ab.h * 0.5) + o.y };
  }
  if (pieces.accB) {   // strap: over the chest, from the shoulder down
    const ab = opaqueBox(pieces.accB), o = off('accB');
    pos.accB = { x: pos.torso.x + tb.x0 + tb.w * 0.45 - (ab.x0 + ab.w / 2) + o.x, y: pos.torso.y + tb.y0 + tb.h * 0.04 - ab.y0 + o.y };
  }
  const placed: Placed[] = [];
  const zs = Z_ORDER.map((z, i) => ({ z, key: i + (z.far ? 0 : (opt.adjust?.[z.id]?.z ?? 0) * 1.5) })).sort((a, b) => a.key - b.key).map((e) => e.z);
  for (const z of zs) {
    if (!pieces[z.id]) continue;
    const base = pos[z.id]!, far = !!z.far;
    placed.push({ id: z.id, far, bone: BONE_OF(z.id, far), img: far ? darkened(pieces[z.id]!, opt.farShade) : pieces[z.id]!, x: base.x + (far ? dx : 0), y: base.y, prox: (PART_IDS as readonly string[]).includes(z.id) ? { x: base.x + (far ? dx : 0) + jp[z.id as PartId].prox.x, y: base.y + jp[z.id as PartId].prox.y } : undefined });
  }
  // canvas
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of placed) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + p.img.width); y1 = Math.max(y1, p.y + p.img.height); }
  const ox = Math.floor(-x0) + 4, oy = Math.floor(-y0) + 4, cw = Math.ceil(x1 - x0) + 8, ch = Math.ceil(y1 - y0) + 8;
  const cut = newImg(cw, ch);
  for (const p of placed) {
    const px = Math.round(p.x + ox), py = Math.round(p.y + oy);
    for (let y = 0; y < p.img.height; y++) for (let x = 0; x < p.img.width; x++) {
      const s = (y * p.img.width + x) * 4, a = p.img.data[s + 3] / 255; if (!a) continue;
      const X = px + x, Y = py + y; if (X < 0 || Y < 0 || X >= cw || Y >= ch) continue;
      const t = (Y * cw + X) * 4, ba = cut.data[t + 3] / 255, oa = a + ba * (1 - a);
      for (let c = 0; c < 3; c++) cut.data[t + c] = (p.img.data[s + c] * a + cut.data[t + c] * ba * (1 - a)) / (oa || 1);
      cut.data[t + 3] = oa * 255;
    }
  }
  const W = (p: Vec2): Vec2 => ({ x: p.x + ox, y: p.y + oy }), F = (p: Vec2): Vec2 => ({ x: p.x + dx + ox, y: p.y + oy });
  const lm: Partial<Record<LandmarkId, Vec2>> = {
    headTop: W(headTop), neck: W(neck), pelvis: W(waist),
    shoulderR: W(shoulder), shoulderL: F(shoulder), elbowR: W(elbow), elbowL: F(elbow), wristR: W(wrist), wristL: F(wrist), handR: W(handTip), handL: F(handTip),
    hipR: W(hip), hipL: F(hip), kneeR: W(knee), kneeL: F(knee), ankleR: W(ankle), ankleL: F(ankle), toeR: W(toe), toeL: F(toe),
  };
  return { placed: placed.map((p) => ({ ...p, x: p.x + ox, y: p.y + oy, prox: p.prox && { x: p.prox.x + ox, y: p.prox.y + oy } })), landmarks: lm, cutout: cut, figureHeight: H, pivot: { x: W(ankle).x + (opaqueBox(footImg).w * 0.15), y: footBottom + oy } };
}

// ---- 4) atlas + rigid-part mesh ---------------------------------------------------------------------------------------------------
export interface PaperBuild { atlas: Img; mesh: Mesh; skin: Skin; parts: { id: PieceId; bone: BoneId; far: boolean }[] }

export function buildPaperMesh(asm: PaperAssembly, rows = 6, cols = 2, soft = 0.5): PaperBuild {
  const PAD = 3, MAXW = 1024;
  const order = asm.placed;
  const rects = order.map((p) => ({ w: p.img.width, h: p.img.height, x: 0, y: 0 }));
  const idx = rects.map((_, i) => i).sort((a, b) => rects[b].h - rects[a].h);
  let x = PAD, y = PAD, rowH = 0, AW = 64;
  for (const i of idx) {
    if (x + rects[i].w + PAD > MAXW) { x = PAD; y += rowH + PAD; rowH = 0; }
    rects[i].x = x; rects[i].y = y; x += rects[i].w + PAD; rowH = Math.max(rowH, rects[i].h); AW = Math.max(AW, x);
  }
  const AH = y + rowH + PAD, atlas = newImg(AW, AH);
  order.forEach((p, i) => {
    const r = rects[i];
    for (let yy = 0; yy < r.h; yy++) for (let xx = 0; xx < r.w; xx++) { const s = (yy * r.w + xx) * 4, t = ((r.y + yy) * AW + r.x + xx) * 4; for (let c = 0; c < 4; c++) atlas.data[t + c] = p.img.data[s + c]; }
  });
  const vertices: number[] = [], uvs: number[] = [], indices: number[] = [], sIdx: number[] = [], sW: number[] = [];
  const parentOf = (b: BoneId): number => { const d = BONE_DEFS.find((x) => x.id === b); return d?.parent ? BONE_IDS.indexOf(d.parent) : -1; };
  order.forEach((p, i) => {
    const r = rects[i], base = vertices.length / 2, bi = BONE_IDS.indexOf(p.bone), pb = p.prox ? parentOf(p.bone) : -1;
    const R = Math.max(1, soft * 0.9 * Math.min(p.img.width, p.img.height));       // soft joint: radius around the joint where the piece also follows its parent
    for (let ry = 0; ry <= rows; ry++) for (let cx = 0; cx <= cols; cx++) {
      const u = cx / cols, v = ry / rows;
      const vx = p.x + u * p.img.width, vy = p.y + v * p.img.height;
      vertices.push(vx, vy);
      uvs.push((r.x + u * r.w) / AW, (r.y + v * r.h) / AH);
      const wp = pb >= 0 && p.prox && soft > 0.01 ? 0.5 * Math.max(0, 1 - Math.hypot(vx - p.prox.x, vy - p.prox.y) / R) : 0;
      if (wp > 0.002) { sIdx.push(bi, pb, 0, 0); sW.push(1 - wp, wp, 0, 0); } else { sIdx.push(bi, 0, 0, 0); sW.push(1, 0, 0, 0); }
    }
    for (let ry = 0; ry < rows; ry++) for (let cx = 0; cx < cols; cx++) { const a = base + ry * (cols + 1) + cx, b = a + 1, d = a + cols + 1, e = d + 1; indices.push(a, b, d, b, e, d); }
  });
  return { atlas, mesh: { cell: 1, vertices, uvs, indices }, skin: { idx: sIdx, w: sW }, parts: order.map((p) => ({ id: p.id, bone: p.bone, far: p.far })) };
}


// ---- frontal views (front / back) ---------------------------------------------------------------------------------------------
function flipX(img: Img): Img {
  const o = newImg(img.width, img.height);
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) { const s = (y * img.width + x) * 4, t = (y * img.width + (img.width - 1 - x)) * 4; for (let c = 0; c < 4; c++) o.data[t + c] = img.data[s + c]; }
  return o;
}
/** Leftmost / rightmost opaque x on rows [y0, y1). */
function rowExtent(img: Img, y0: number, y1: number): { x0: number; x1: number } {
  let x0 = img.width, x1 = -1;
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(img.height, Math.ceil(y1)); y++) for (let x = 0; x < img.width; x++) if (alphaOf(img, x, y) > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
  return x1 < 0 ? { x0: 0, x1: img.width - 1 } : { x0, x1 };
}

/**
 * Front / back assembly. Limbs are drawn once and mirrored for the other side; image-RIGHT limbs are the drawn ones (bones …R),
 * image-LEFT limbs the mirrored copies (bones …L), as the rig expects for frontal views. From the back the backpack is drawn over the torso.
 */
export function assembleFrontal(pieces: Pieces, opt: PaperOptions, kind: 'front' | 'back'): PaperAssembly {
  for (const id of PART_IDS) if (!pieces[id]) throw new Error(`Manca il pezzo «${PIECE_LABEL[id]}».`);
  const off = (id: string, side?: 'R' | 'L'): Vec2 => { const a = opt.adjust?.[id], b = side ? opt.adjust?.[`${id}:${side}`] : undefined; return { x: (a?.dx ?? 0) + (b?.dx ?? 0), y: (a?.dy ?? 0) + (b?.dy ?? 0) }; };
  const sub = (a: Vec2, b: Vec2) => ({ x: a.x - b.x, y: a.y - b.y }), add = (a: Vec2, b: Vec2) => ({ x: a.x + b.x, y: a.y + b.y });
  const base = Object.fromEntries((PART_IDS as readonly PieceId[]).map((id) => [id, { ...jointsOf(id, pieces[id]!, true), ...(opt.joints?.[id] ?? {}) }])) as Record<PartId, Joints>;
  const imgs: Record<'R' | 'L', Record<string, Img>> = { R: {}, L: {} }, jt: Record<'R' | 'L', Record<string, Joints>> = { R: {}, L: {} };
  for (const id of LIMB_IDS) {
    const im = pieces[id]!, j = base[id], lk = `${id}L` as LimbLeft, own = pieces[lk];
    imgs.R[id] = im; jt.R[id] = j;
    if (own) { imgs.L[id] = own; jt.L[id] = { ...jointsOf(id, own, true), ...(opt.joints?.[lk] ?? {}) }; }        // the left limb was drawn separately
    else { const w = im.width - 1; imgs.L[id] = flipX(im); jt.L[id] = { prox: { x: w - j.prox.x, y: j.prox.y }, dist: { x: w - j.dist.x, y: j.dist.y } }; }  // …or mirrored from the right one
  }
  const pos: Record<string, Vec2> = {};
  const pel = pieces.pelvis!, pb = opaqueBox(pel);
  pos.pelvis = { x: 0, y: 0 };
  const waist = add(pos.pelvis, base.pelvis.prox);
  const pe = rowExtent(pel, pb.y0 + pb.h * 0.6, pb.y0 + pb.h * 0.75), hipY = pb.y0 + pb.h * 0.68, pw = pe.x1 - pe.x0;
  const hip = { R: { x: pe.x1 - pw * 0.26, y: hipY }, L: { x: pe.x0 + pw * 0.26, y: hipY } };
  pos.torso = add(sub(waist, base.torso.prox), off('torso'));
  const tor = pieces.torso!, tb = opaqueBox(tor), shY = tb.y0 + tb.h * 0.2, te = rowExtent(tor, shY - 4, shY + 4), tw = te.x1 - te.x0;
  const neck = add(pos.torso, base.torso.dist);
  const shoulder = { R: add(pos.torso, { x: te.x1 - tw * 0.1, y: shY }), L: add(pos.torso, { x: te.x0 + tw * 0.1, y: shY }) };
  pos.head = add(sub(neck, base.head.prox), off('head'));
  const headTop = add(pos.head, base.head.top ?? base.head.dist);
  const lm: Partial<Record<LandmarkId, Vec2>> = { headTop, neck, pelvis: waist };
  const placed: Placed[] = [];
  const joint: Record<string, Vec2> = {};
  const sides = ['R', 'L'] as const;
  for (const s of sides) {
    const J = jt[s];
    pos[`uarm${s}`] = add(sub(shoulder[s], J.uarm.prox), off('uarm', s)); const elbow = add(pos[`uarm${s}`], J.uarm.dist);
    pos[`farm${s}`] = add(sub(elbow, J.farm.prox), off('farm', s)); const wrist = add(pos[`farm${s}`], J.farm.dist);
    pos[`hand${s}`] = add(sub(wrist, J.hand.prox), off('hand', s)); const tip = add(pos[`hand${s}`], J.hand.dist);
    pos[`thigh${s}`] = add(sub(add(pos.pelvis, hip[s]), J.thigh.prox), off('thigh', s)); const knee = add(pos[`thigh${s}`], J.thigh.dist);
    pos[`shin${s}`] = add(sub(knee, J.shin.prox), off('shin', s)); const ankle = add(pos[`shin${s}`], J.shin.dist);
    pos[`foot${s}`] = add(sub(ankle, J.foot.prox), off('foot', s)); const toe = add(pos[`foot${s}`], J.foot.dist);
    Object.assign(lm, { [`shoulder${s}`]: shoulder[s], [`elbow${s}`]: elbow, [`wrist${s}`]: wrist, [`hand${s}`]: tip, [`hip${s}`]: add(pos.pelvis, hip[s]), [`knee${s}`]: knee, [`ankle${s}`]: ankle, [`toe${s}`]: toe });
    joint[`ankle${s}`] = ankle;
  }
  const footBottom = Math.max(...sides.map((s) => pos[`foot${s}`].y + opaqueBox(imgs[s].foot).y1));
  const H = Math.max(10, footBottom - headTop.y);
  const tcx = pos.torso.x + (tb.x0 + tb.x1) / 2;
  if (pieces.accA) { const ab = opaqueBox(pieces.accA), o = off('accA'); pos.accA = { x: tcx - (ab.x0 + ab.w / 2) + o.x, y: pos.torso.y + tb.y0 + tb.h * 0.42 - (ab.y0 + ab.h / 2) + o.y }; }
  if (pieces.accB) { const ab = opaqueBox(pieces.accB), o = off('accB'); pos.accB = { x: tcx - (ab.x0 + ab.w / 2) + o.x, y: pos.torso.y + tb.y0 + tb.h * 0.04 - ab.y0 + o.y }; }
  const order: { id: PieceId; side?: 'R' | 'L'; key: string }[] = [
    ...(kind === 'front' ? [{ id: 'accA' as PieceId, key: 'accA' }] : []),
    ...sides.flatMap((s) => (['thigh', 'shin', 'foot'] as const).map((id) => ({ id: id as PieceId, side: s, key: `${id}${s}` }))),
    { id: 'pelvis', key: 'pelvis' }, { id: 'torso', key: 'torso' },
    ...(kind === 'back' ? [{ id: 'accA' as PieceId, key: 'accA' }] : []),
    { id: 'accB', key: 'accB' },
    ...sides.flatMap((s) => (['uarm', 'farm', 'hand'] as const).map((id) => ({ id: id as PieceId, side: s, key: `${id}${s}` }))),
    { id: 'head', key: 'head' },
  ];
  const zs = order.map((o, i) => ({ o, k: i + ((opt.adjust?.[o.id]?.z ?? 0) + (o.side ? opt.adjust?.[`${o.id}:${o.side}`]?.z ?? 0 : 0)) * 1.5 })).sort((a, b) => a.k - b.k).map((e) => e.o);
  for (const o of zs) {
    const img = o.side ? imgs[o.side][o.id] : pieces[o.id];
    if (!img || !pos[o.key]) continue;
    placed.push({ id: o.id, far: false, bone: (o.side ? `${o.id}${o.side}` : o.id === 'accA' || o.id === 'accB' ? 'torso' : o.id) as BoneId, img, x: pos[o.key].x, y: pos[o.key].y, prox: o.id === 'accA' || o.id === 'accB' ? undefined : { x: pos[o.key].x + (o.side ? jt[o.side][o.id] : base[o.id as PartId]).prox.x, y: pos[o.key].y + (o.side ? jt[o.side][o.id] : base[o.id as PartId]).prox.y } });
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of placed) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + p.img.width); y1 = Math.max(y1, p.y + p.img.height); }
  const ox = Math.floor(-x0) + 4, oy = Math.floor(-y0) + 4, cw = Math.ceil(x1 - x0) + 8, ch = Math.ceil(y1 - y0) + 8, cut = newImg(cw, ch);
  for (const p of placed) compositeOver(cut, p.img, Math.round(p.x + ox), Math.round(p.y + oy));
  const W = (p: Vec2): Vec2 => ({ x: p.x + ox, y: p.y + oy });
  for (const k of Object.keys(lm) as LandmarkId[]) lm[k] = W(lm[k]!);
  const cx = W(pos.pelvis).x + pe.x0 + pw / 2;
  return { placed: placed.map((p) => ({ ...p, x: p.x + ox, y: p.y + oy, prox: p.prox && { x: p.prox.x + ox, y: p.prox.y + oy } })), landmarks: lm, cutout: cut, figureHeight: H, pivot: { x: cx, y: footBottom + oy } };
}

/** Alpha-composites `src` onto `dst` at (px, py). */
function compositeOver(dst: Img, src: Img, px: number, py: number) {
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
    const s = (y * src.width + x) * 4, a = src.data[s + 3] / 255; if (!a) continue;
    const X = px + x, Y = py + y; if (X < 0 || Y < 0 || X >= dst.width || Y >= dst.height) continue;
    const t = (Y * dst.width + X) * 4, ba = dst.data[t + 3] / 255, oa = a + ba * (1 - a);
    for (let c = 0; c < 3; c++) dst.data[t + c] = (src.data[s + c] * a + dst.data[t + c] * ba * (1 - a)) / (oa || 1);
    dst.data[t + 3] = oa * 255;
  }
}
