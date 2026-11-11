import type { BoneId, ManikinParams, Mesh, Skin, Vec2, ViewId } from '@/types';
import { BONE_IDS, PROFILE_VIEWS } from '@/types';
import { BONE_DEFS, buildRig, type Bone } from './skeleton';
import { newImg, type Img } from './imageProc';

/**
 * Manikin builder (prototype). Turns a view's cut-out + skeleton into a PART-BASED model:
 *   1. one strip mesh per bone, as thick as the silhouette (measured), extended past the joints;
 *   2. one UV island per part in a texture atlas, baked by sampling the image along each strip;
 *   3. areas hidden by parts in front (the torso under the near arm…) are rebuilt from their surroundings;
 *   4. far limbs of profile views are darkened copies of the near ones (the image never shows them);
 *   5. two-bone skin weights blend each part with its neighbour across the joints.
 * Everything lives in the view's own pixel space, so the existing skeleton, animations and runtime keep working.
 */
export const DEFAULT_MANIKIN: ManikinParams = { overlap: 0.16, segments: 7, cols: 4, widthScale: 1.0, farShade: 0.3, inpaint: true };

const PROFILE_Z: BoneId[] = ['uarmL', 'farmL', 'handL', 'thighL', 'shinL', 'footL', 'pelvis', 'torso', 'head', 'thighR', 'shinR', 'footR', 'uarmR', 'farmR', 'handR'];
const FRONT_Z: BoneId[] = ['thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR', 'pelvis', 'torso', 'uarmL', 'farmL', 'handL', 'uarmR', 'farmR', 'handR', 'head'];
const NEAR = new Set<BoneId>(['uarmR', 'farmR', 'handR', 'thighR', 'shinR', 'footR']);
const FAR_OF = (b: BoneId) => b.replace(/R$/, 'L') as BoneId;

interface Part {
  bone: Bone;
  /** Rest-pose geometry of the strip: rows × (cols+1) vertices. */
  rows: { c: Vec2; wl: number; wr: number }[];
  n: Vec2;
  d: Vec2;
  len: number;
  /** Island rectangle in the atlas (set by the packer). */
  rect: { x: number; y: number; w: number; h: number };
  /** Source of the texture: 'bake' = sample the image, otherwise copy (darkened) from another part. */
  copyOf?: BoneId;
  /** Fraction of the strip that is the bone's own segment (the rest is joint overlap). */
  core: [number, number];
}

export interface ManikinBuild {
  mesh: Mesh;
  skin: Skin;
  atlas: Img;
  /** Debug/inspection: parts in drawing order with their rest-pose quads. */
  parts: { bone: BoneId; quad: Vec2[]; island: { x: number; y: number; w: number; h: number }; copy: boolean }[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function alphaBilinear(img: Img, x: number, y: number, out: number[]): void {
  const { width: w, height: h, data } = img;
  if (x < -0.5 || y < -0.5 || x > w - 0.5 || y > h - 0.5) { out[0] = out[1] = out[2] = out[3] = 0; return; }
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  out[0] = out[1] = out[2] = out[3] = 0;
  let wsum = 0, asum = 0;
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    const xx = clamp(x0 + i, 0, w - 1), yy = clamp(y0 + j, 0, h - 1), k = (yy * w + xx) * 4;
    const wt = (i ? fx : 1 - fx) * (j ? fy : 1 - fy), a = data[k + 3] / 255;
    out[0] += data[k] * wt * a; out[1] += data[k + 1] * wt * a; out[2] += data[k + 2] * wt * a; asum += a * wt; wsum += wt;
  }
  if (asum > 1e-4) { out[0] /= asum; out[1] /= asum; out[2] /= asum; }
  out[3] = (asum / Math.max(wsum, 1e-6)) * 255;
}

/** Thickness of the silhouette on both sides of the axis, sampled along the segment (scans outward until the pixels turn transparent). */
function measure(img: Img, a: Vec2, d: Vec2, n: Vec2, len: number, samples: number, cap: number, minW: number) {
  const { width: w, height: h, data } = img;
  const opaque = (x: number, y: number) => { const xi = Math.round(x), yi = Math.round(y); return xi >= 0 && yi >= 0 && xi < w && yi < h && data[(yi * w + xi) * 4 + 3] > 40; };
  const wl: number[] = [], wr: number[] = [];
  for (let k = 0; k <= samples; k++) {
    const t = k / samples, px = a.x + d.x * len * t, py = a.y + d.y * len * t;
    const scan = (sgn: number) => { let r = 0; while (r < cap && opaque(px + n.x * sgn * (r + 1), py + n.y * sgn * (r + 1))) r++; return r; };
    wl.push(scan(-1)); wr.push(scan(1));
  }
  const smooth = (arr: number[]) => arr.map((_, i) => { let s = 0, c = 0; for (let j = -1; j <= 1; j++) { const v = arr[clamp(i + j, 0, arr.length - 1)]; if (v > 0) { s += v; c++; } } return c ? s / c : 0; });
  const sl = smooth(wl), sr = smooth(wr);
  const pos = [...sl, ...sr].filter((v) => v > 0), mean = pos.length ? pos.reduce((p, q) => p + q, 0) / pos.length : minW;
  const fix = (v: number) => (v > 0 ? Math.max(v, minW * 0.5) : Math.max(mean, minW));
  return { wl: sl.map(fix), wr: sr.map(fix) };
}

function rasterMask(w: number, h: number, quads: Vec2[][]): Uint8Array {
  const m = new Uint8Array(w * h);
  for (const q of quads) {
    for (const tri of [[q[0], q[1], q[2]], [q[0], q[2], q[3]]]) {
      const [a, b, c] = tri;
      const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x))), x1 = Math.min(w - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
      const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y))), y1 = Math.min(h - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
      const den = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
      if (Math.abs(den) < 1e-9) continue;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const l1 = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / den, l2 = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / den, l3 = 1 - l1 - l2;
        if (l1 >= -0.01 && l2 >= -0.01 && l3 >= -0.01) m[y * w + x] = 1;
      }
    }
  }
  return m;
}

/** Shelf packer: islands sorted by height, left to right. */
function pack(parts: Part[], pad: number, maxW: number): { w: number; h: number } {
  const order = [...parts].sort((a, b) => b.rect.h - a.rect.h);
  let x = pad, y = pad, rowH = 0, W = 0;
  for (const p of order) {
    if (x + p.rect.w + pad > maxW) { x = pad; y += rowH + pad; rowH = 0; }
    p.rect.x = x; p.rect.y = y; x += p.rect.w + pad; rowH = Math.max(rowH, p.rect.h); W = Math.max(W, x);
  }
  return { w: Math.max(64, W), h: y + rowH + pad };
}

/** Wavefront fill of unknown texels from known ones (average of the filled 4-neighbours), then a light blur inside the filled area. */
function inpaint(atlas: Img, known: Uint8Array, rect: { x: number; y: number; w: number; h: number }) {
  const W = atlas.width, d = atlas.data;
  const filled = new Uint8Array(rect.w * rect.h);
  for (let j = 0; j < rect.h; j++) for (let i = 0; i < rect.w; i++) filled[j * rect.w + i] = known[(rect.y + j) * W + rect.x + i];
  const unknown: number[] = [];
  for (let k = 0; k < filled.length; k++) if (!filled[k]) unknown.push(k);
  let remaining = unknown.length, guard = 0;
  const filledNow: number[] = [];
  while (remaining > 0 && guard++ < 400) {
    filledNow.length = 0;
    for (const k of unknown) {
      if (filled[k]) continue;
      const i = k % rect.w, j = (k / rect.w) | 0;
      let r = 0, g = 0, b = 0, a = 0, c = 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= rect.w || jj >= rect.h || !filled[jj * rect.w + ii]) continue;
        const o = ((rect.y + jj) * W + rect.x + ii) * 4;
        r += d[o]; g += d[o + 1]; b += d[o + 2]; a += d[o + 3]; c++;
      }
      if (c) { const o = ((rect.y + j) * W + rect.x + i) * 4; d[o] = r / c; d[o + 1] = g / c; d[o + 2] = b / c; d[o + 3] = a / c; filledNow.push(k); }
    }
    for (const k of filledNow) { filled[k] = 1; remaining--; }
    if (!filledNow.length) break;
  }
  // diffuse the reconstructed area (known texels stay fixed) so it becomes a smooth blend of its surroundings instead of stripes
  for (let it = 0; it < 60; it++) {
    const copy = new Uint8ClampedArray(d);
    for (const k of unknown) {
      const i = k % rect.w, j = (k / rect.w) | 0; const o = ((rect.y + j) * W + rect.x + i) * 4;
      let r = 0, g = 0, b = 0, c = 0;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= rect.w || jj >= rect.h) continue;
        const q = ((rect.y + jj) * W + rect.x + ii) * 4; r += copy[q]; g += copy[q + 1]; b += copy[q + 2]; c++;
      }
      d[o] = r / c; d[o + 1] = g / c; d[o + 2] = b / c;
    }
  }
}

export function buildManikin(img: Img, view: { landmarks: Parameters<typeof buildRig>[0]['landmarks']; figureHeight: number }, viewId: ViewId, params: ManikinParams = DEFAULT_MANIKIN): ManikinBuild | null {
  const rig = buildRig(view);
  if (!rig) return null;
  const H = view.figureHeight, profile = PROFILE_VIEWS.includes(viewId);
  const zOrder = profile ? PROFILE_Z : FRONT_Z;
  const seg = Math.max(2, Math.round(params.segments)), cols = Math.max(1, Math.round(params.cols));
  const byBone = new Map(rig.bones.map((b) => [b.id, b]));
  const parts = new Map<BoneId, Part>();

  // ---- 1) geometry -----------------------------------------------------------------------------------------------------------
  const bakeBones = zOrder.filter((b) => !(profile && !NEAR.has(b) && /[LR]$/.test(b) && b.endsWith('L')));
  for (const id of bakeBones) {
    const bone = byBone.get(id)!;
    const dx = bone.tail.x - bone.head.x, dy = bone.tail.y - bone.head.y, blen = Math.max(4, Math.hypot(dx, dy));
    const d = { x: dx / blen, y: dy / blen }, n = { x: -d.y, y: d.x };
    const ovS = id === 'pelvis' ? 0.05 : params.overlap, ovE = id.startsWith('hand') || id.startsWith('foot') ? 0.05 : params.overlap;
    const ext = { a: { x: bone.head.x - d.x * blen * ovS, y: bone.head.y - d.y * blen * ovS }, len: blen * (1 + ovS + ovE) };
    const capK = /^(uarm|farm|hand)/.test(id) ? 1.05 : /^(thigh|shin|foot)/.test(id) ? 1.3 : 1.55;
    const cap = Math.max(10, bone.radius * H * capK * params.widthScale), minW = Math.max(5, bone.radius * H * 0.45);
    const m = measure(img, ext.a, d, n, ext.len, seg, cap, minW);
    const rows = m.wl.map((wl, k) => { const t = k / seg; return { c: { x: ext.a.x + d.x * ext.len * t, y: ext.a.y + d.y * ext.len * t }, wl: wl * params.widthScale, wr: m.wr[k] * params.widthScale }; });
    const maxW = Math.max(...rows.map((r) => r.wl + r.wr));
    parts.set(id, { bone, rows, n, d, len: ext.len, rect: { x: 0, y: 0, w: Math.ceil(maxW) + 2, h: Math.ceil(ext.len) + 2 }, core: [ovS / (1 + ovS + ovE), (ovS + 1) / (1 + ovS + ovE)] });
  }
  // far limbs (profile views): same geometry as the near ones, anchored at the far-bone joints, texture copied and darkened
  if (profile) {
    for (const id of zOrder.filter((b) => NEAR.has(b))) {
      const far = FAR_OF(id), nearP = parts.get(id)!, bone = byBone.get(far)!;
      const dx = bone.tail.x - bone.head.x, dy = bone.tail.y - bone.head.y, blen = Math.max(4, Math.hypot(dx, dy));
      const d = { x: dx / blen, y: dy / blen }, n = { x: -d.y, y: d.x };
      const start = { x: bone.head.x - d.x * (nearP.len - blen) * (nearP.core[0] / Math.max(1e-6, nearP.core[0] + 1 - nearP.core[1])), y: bone.head.y - d.y * (nearP.len - blen) * (nearP.core[0] / Math.max(1e-6, nearP.core[0] + 1 - nearP.core[1])) };
      const rows = nearP.rows.map((r, k) => { const t = k / seg; return { c: { x: start.x + d.x * nearP.len * t, y: start.y + d.y * nearP.len * t }, wl: r.wl, wr: r.wr }; });
      parts.set(far, { bone, rows, n, d, len: nearP.len, rect: { ...nearP.rect }, copyOf: id, core: nearP.core });
    }
  }
  const ordered = zOrder.map((id) => parts.get(id)!).filter(Boolean);

  // ---- 2) atlas layout ---------------------------------------------------------------------------------------------------------
  const PAD = 3;
  const { w: AW0, h: AH0 } = pack(ordered, PAD, 1024);
  const AW = AW0 + PAD, AH = AH0;
  const atlas = newImg(AW, AH);
  const known = new Uint8Array(AW * AH);

  // ---- 3) footprints (core areas) of the parts, used to find what is hidden ------------------------------------------------------
  const quadOf = (p: Part, t0: number, t1: number): Vec2[] => {
    const at = (t: number, sgn: -1 | 1) => { const f = t * seg, i = Math.min(seg - 1, Math.floor(f)), u = f - i, r0 = p.rows[i], r1 = p.rows[i + 1];
      const c = { x: lerp(r0.c.x, r1.c.x, u), y: lerp(r0.c.y, r1.c.y, u) }, wl = lerp(r0.wl, r1.wl, u), wr = lerp(r0.wr, r1.wr, u);
      const off = sgn < 0 ? -wl : wr; return { x: c.x + p.n.x * off, y: c.y + p.n.y * off }; };
    return [at(t0, -1), at(t0, 1), at(t1, 1), at(t1, -1)];
  };
  const bakeParts = ordered.filter((p) => !p.copyOf);
  const masks = new Map<BoneId, Uint8Array>();
  for (const p of bakeParts) {
    const quads: Vec2[][] = [];
    const t0 = p.core[0], t1 = p.core[1], steps = seg;
    for (let k = 0; k < steps; k++) quads.push(quadOf(p, lerp(t0, t1, k / steps), lerp(t0, t1, (k + 1) / steps)));
    masks.set(p.bone.id, rasterMask(img.width, img.height, quads));
  }

  // ---- 4) bake ---------------------------------------------------------------------------------------------------------------
  const px = [0, 0, 0, 0];
  for (const p of bakeParts) {
    const idx = ordered.indexOf(p);
    const later = ordered.slice(idx + 1).filter((q) => !q.copyOf).map((q) => masks.get(q.bone.id)!);
    const { rect } = p;
    for (let j = 0; j < rect.h; j++) for (let i = 0; i < rect.w; i++) {
      const s = (i + 0.5) / rect.w, t = (j + 0.5) / rect.h, f = t * seg, r = Math.min(seg - 1, Math.floor(f)), u = f - r;
      const r0 = p.rows[r], r1 = p.rows[r + 1];
      const wl = lerp(r0.wl, r1.wl, u), wr = lerp(r0.wr, r1.wr, u), cx = lerp(r0.c.x, r1.c.x, u), cy = lerp(r0.c.y, r1.c.y, u);
      const off = -wl + s * (wl + wr), sx = cx + p.n.x * off, sy = cy + p.n.y * off;
      alphaBilinear(img, sx, sy, px);
      const o = ((rect.y + j) * AW + rect.x + i) * 4, kk = (rect.y + j) * AW + rect.x + i;
      const xi = Math.round(sx), yi = Math.round(sy);
      const hidden = params.inpaint && xi >= 0 && yi >= 0 && xi < img.width && yi < img.height && later.some((m) => m[yi * img.width + xi]);
      if (hidden) { known[kk] = 0; continue; }
      atlas.data[o] = px[0]; atlas.data[o + 1] = px[1]; atlas.data[o + 2] = px[2]; atlas.data[o + 3] = px[3];
      known[kk] = px[3] > 30 ? 1 : 0;
    }
    if (params.inpaint) inpaint(atlas, known, rect);
  }
  // far copies
  for (const p of ordered.filter((q) => q.copyOf)) {
    const src = parts.get(p.copyOf!)!, k = 1 - params.farShade;
    for (let j = 0; j < p.rect.h; j++) for (let i = 0; i < p.rect.w; i++) {
      const o = ((p.rect.y + j) * AW + p.rect.x + i) * 4, q = ((src.rect.y + j) * AW + src.rect.x + i) * 4;
      atlas.data[o] = atlas.data[q] * k; atlas.data[o + 1] = atlas.data[q + 1] * k; atlas.data[o + 2] = atlas.data[q + 2] * k; atlas.data[o + 3] = atlas.data[q + 3];
    }
  }
  // bleed the island borders outwards (no seams when the GPU filters the texture)
  for (const p of ordered) {
    const { rect } = p;
    for (let ring = 1; ring <= 2; ring++) for (let j = -ring; j < rect.h + ring; j++) for (let i = -ring; i < rect.w + ring; i++) {
      if (i >= 0 && j >= 0 && i < rect.w && j < rect.h) continue;
      const x = rect.x + i, y = rect.y + j; if (x < 0 || y < 0 || x >= AW || y >= AH) continue;
      const sx = rect.x + clamp(i, 0, rect.w - 1), sy = rect.y + clamp(j, 0, rect.h - 1);
      const o = (y * AW + x) * 4, q = (sy * AW + sx) * 4;
      if (atlas.data[o + 3] === 0) { atlas.data[o] = atlas.data[q]; atlas.data[o + 1] = atlas.data[q + 1]; atlas.data[o + 2] = atlas.data[q + 2]; atlas.data[o + 3] = atlas.data[q + 3]; }
    }
  }

  // ---- 5) mesh + skin ----------------------------------------------------------------------------------------------------------
  const vertices: number[] = [], uvs: number[] = [], indices: number[] = [], sIdx: number[] = [], sW: number[] = [];
  const childOf = new Map<BoneId, BoneId>();
  for (const def of BONE_DEFS) if (def.parent && !childOf.has(def.parent)) childOf.set(def.parent, def.id);
  const idxOf = (b: BoneId) => BONE_IDS.indexOf(b);
  const quadsOut: ManikinBuild['parts'] = [];
  for (const p of ordered) {
    const base = vertices.length / 2, own = p.bone.id;
    const parent = p.bone.parent >= 0 ? BONE_IDS[p.bone.parent] : null;
    const child = childOf.get(own) ?? null;
    for (let r = 0; r <= seg; r++) for (let c = 0; c <= cols; c++) {
      const s = c / cols, row = p.rows[r], off = -row.wl + s * (row.wl + row.wr);
      vertices.push(row.c.x + p.n.x * off, row.c.y + p.n.y * off);
      uvs.push((p.rect.x + s * p.rect.w) / AW, (p.rect.y + (r / seg) * p.rect.h) / AH);
      // position along the bone (0 = head joint, 1 = tail joint) decides the blend with the neighbour
      const u = ((row.c.x - p.bone.head.x) * (p.bone.tail.x - p.bone.head.x) + (row.c.y - p.bone.head.y) * (p.bone.tail.y - p.bone.head.y)) / Math.max(1, (p.bone.tail.x - p.bone.head.x) ** 2 + (p.bone.tail.y - p.bone.head.y) ** 2);
      const zone = 0.3;
      let other: BoneId | null = null, wOther = 0;
      if (u < zone && parent) { other = parent; wOther = clamp(0.5 * (zone - u) / zone, 0, 0.62); }
      else if (u > 1 - zone && child) { other = child; wOther = clamp(0.5 * (u - (1 - zone)) / zone, 0, 0.62); }
      const a = idxOf(own);
      if (other && wOther > 0.001) { sIdx.push(a, idxOf(other), 0, 0); sW.push(1 - wOther, wOther, 0, 0); }
      else { sIdx.push(a, 0, 0, 0); sW.push(1, 0, 0, 0); }
    }
    for (let r = 0; r < seg; r++) for (let c = 0; c < cols; c++) {
      const a = base + r * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1;
      indices.push(a, b, d, b, e, d);
    }
    const q = quadOf(p, 0, 1);
    quadsOut.push({ bone: own, quad: q, island: { ...p.rect }, copy: !!p.copyOf });
  }
  return { mesh: { cell: 1, vertices, uvs, indices }, skin: { idx: sIdx, w: sW }, atlas, parts: quadsOut };
}
