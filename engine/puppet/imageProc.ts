import type { KeyParams, Rect } from '@/types';

/** Pixel operations on raw RGBA data. Pure functions (no DOM) so they are testable and reusable by host tools. */
export interface Img { data: Uint8ClampedArray; width: number; height: number }

export const DEFAULT_KEYING: KeyParams = { color: null, tolerance: 38, feather: 28, choke: 0, defringe: 0.8, floodFromBorder: true, minIsland: 150 };

export const newImg = (w: number, h: number): Img => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
export const cloneImg = (i: Img): Img => ({ data: new Uint8ClampedArray(i.data), width: i.width, height: i.height });

/** Typical background colour: median of the pixels along the border (robust to a few intruding pixels). */
export function estimateKeyColor(img: Img): [number, number, number] {
  const { data, width: w, height: h } = img;
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  const step = Math.max(1, Math.floor(Math.max(w, h) / 200));
  const push = (x: number, y: number) => { const i = (y * w + x) * 4; if (data[i + 3] > 200) { rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]); } };
  for (let x = 0; x < w; x += step) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y += step) { push(0, y); push(w - 1, y); }
  const med = (a: number[]) => (a.length ? a.sort((p, q) => p - q)[a.length >> 1] : 255);
  return [med(rs), med(gs), med(bs)];
}

const dist = (data: Uint8ClampedArray, i: number, c: [number, number, number]) => {
  const dr = data[i] - c[0], dg = data[i + 1] - c[1], db = data[i + 2] - c[2];
  // slightly weighted towards green/red like human vision; scale ~0..441 → comparable to 8-bit steps
  return Math.sqrt(0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db) * 1.7;
};

/**
 * Removes a flat background. Tolerant of slightly uneven / JPEG-compressed backgrounds:
 *  - tolerance: colour distance still treated as pure background;
 *  - feather: width of the soft transition (anti-aliased edge);
 *  - floodFromBorder: only background connected to the image border is removed (keeps white details inside the figure);
 *  - choke: shrink (+) or grow (−) the silhouette by N px to hide halos;
 *  - defringe: removes background colour bleeding into semi-transparent edge pixels;
 *  - minIsland: drops stray specks smaller than N px².
 */
export function keyBackground(src: Img, p: KeyParams): Img {
  const { width: w, height: h } = src;
  const out = cloneImg(src);
  const d = out.data;
  const bg = p.color ?? estimateKeyColor(src);
  const hi = p.tolerance + Math.max(1, p.feather);
  const region = new Uint8Array(w * h); // 1 = background candidate reached by the flood fill
  const cand = (idx: number) => dist(d, idx * 4, bg) <= hi || d[idx * 4 + 3] < 8;

  if (p.floodFromBorder) {
    const stack: number[] = [];
    const seed = (x: number, y: number) => { const i = y * w + x; if (!region[i] && cand(i)) { region[i] = 1; stack.push(i); } };
    for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
    for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }
    while (stack.length) {
      const i = stack.pop()!, x = i % w, y = (i / w) | 0;
      if (x > 0) seed(x - 1, y); if (x < w - 1) seed(x + 1, y); if (y > 0) seed(x, y - 1); if (y < h - 1) seed(x, y + 1);
    }
  } else for (let i = 0; i < w * h; i++) if (cand(i)) region[i] = 1;

  const alpha = new Uint8ClampedArray(w * h).fill(255);
  for (let i = 0; i < w * h; i++) {
    if (!region[i]) { alpha[i] = d[i * 4 + 3]; continue; }
    const dd = dist(d, i * 4, bg);
    alpha[i] = dd <= p.tolerance ? 0 : Math.min(255, Math.round(((dd - p.tolerance) / Math.max(1, p.feather)) * 255));
  }

  // choke / grow
  const steps = Math.abs(Math.round(p.choke));
  for (let s = 0; s < steps; s++) morph(alpha, w, h, p.choke > 0 ? 'erode' : 'dilate');

  // defringe: un-mix the background colour from partially transparent pixels
  if (p.defringe > 0) {
    for (let i = 0; i < w * h; i++) {
      const a = alpha[i];
      if (a === 0 || a >= 250) continue;
      const k = a / 255;
      for (let c = 0; c < 3; c++) {
        const un = (d[i * 4 + c] - bg[c] * (1 - k)) / k;
        d[i * 4 + c] = Math.max(0, Math.min(255, d[i * 4 + c] * (1 - p.defringe) + un * p.defringe));
      }
    }
  }
  for (let i = 0; i < w * h; i++) { d[i * 4 + 3] = alpha[i]; if (!alpha[i]) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 0; } }
  if (p.minIsland > 0) removeIslands(out, p.minIsland);
  return out;
}

function morph(a: Uint8ClampedArray, w: number, h: number, mode: 'erode' | 'dilate') {
  const src = new Uint8ClampedArray(a);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = mode === 'erode' ? 255 : 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = Math.min(w - 1, Math.max(0, x + dx)), yy = Math.min(h - 1, Math.max(0, y + dy));
      const s = src[yy * w + xx];
      v = mode === 'erode' ? Math.min(v, s) : Math.max(v, s);
    }
    a[y * w + x] = v;
  }
}

/** Connected components (4-neighbour) of pixels with alpha > threshold. */
export function components(img: Img, threshold = 16): { labels: Int32Array; count: number; areas: number[]; boxes: Rect[] } {
  const { width: w, height: h, data } = img;
  const labels = new Int32Array(w * h).fill(-1);
  const areas: number[] = [], boxes: Rect[] = [];
  let count = 0;
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (labels[s] >= 0 || data[s * 4 + 3] <= threshold) continue;
    let minX = w, minY = h, maxX = 0, maxY = 0, area = 0;
    labels[s] = count; stack.push(s);
    while (stack.length) {
      const i = stack.pop()!, x = i % w, y = (i / w) | 0;
      area++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const n of nb) if (n >= 0 && labels[n] < 0 && data[n * 4 + 3] > threshold) { labels[n] = count; stack.push(n); }
    }
    areas.push(area); boxes.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }); count++;
  }
  return { labels, count, areas, boxes };
}

export function removeIslands(img: Img, minArea: number) {
  const c = components(img, 8);
  const { data, width: w, height: h } = img;
  for (let i = 0; i < w * h; i++) { const l = c.labels[i]; if (l >= 0 && c.areas[l] < minArea) { data[i * 4 + 3] = 0; data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 0; } }
}

export function crop(img: Img, r: Rect): Img {
  const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(img.width, Math.ceil(r.x + r.w)), y1 = Math.min(img.height, Math.ceil(r.y + r.h));
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
  const out = newImg(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = ((y0 + y) * img.width + (x0 + x)) * 4, t = (y * w + x) * 4;
    out.data[t] = img.data[s]; out.data[t + 1] = img.data[s + 1]; out.data[t + 2] = img.data[s + 2]; out.data[t + 3] = img.data[s + 3];
  }
  return out;
}

/** Tight bounding box of the opaque pixels (null if empty). */
export function opaqueBounds(img: Img, threshold = 16): Rect | null {
  const { width: w, height: h, data } = img;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > threshold) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Crop to the figure with some padding. Returns the image and the offset of its top-left corner in the source. */
export function trim(img: Img, pad = 6): { img: Img; offset: { x: number; y: number } } {
  const b = opaqueBounds(img);
  if (!b) return { img, offset: { x: 0, y: 0 } };
  const r = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
  const x0 = Math.max(0, r.x), y0 = Math.max(0, r.y);
  return { img: crop(img, r), offset: { x: x0, y: y0 } };
}

/**
 * Finds the figures of a turnaround sheet. Looks for gaps in the column projection of the opaque pixels;
 * when the figures touch or the count differs from `expected`, falls back to equal columns.
 * Returns one search region per figure (full height), ordered left to right.
 */
export function detectCells(img: Img, expected = 3): Rect[] {
  const { width: w, height: h, data } = img;
  const col = new Int32Array(w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > 24) col[x]++;
  const minCount = Math.max(2, Math.round(h * 0.004));
  const runs: [number, number][] = [];
  let start = -1;
  for (let x = 0; x <= w; x++) {
    const on = x < w && col[x] >= minCount;
    if (on && start < 0) start = x;
    if (!on && start >= 0) { runs.push([start, x - 1]); start = -1; }
  }
  // merge runs separated by tiny gaps (e.g. a thin pickaxe tip)
  const gapMin = Math.max(6, Math.round(w * 0.012));
  const merged: [number, number][] = [];
  for (const r of runs) { const last = merged[merged.length - 1]; if (last && r[0] - last[1] < gapMin) last[1] = r[1]; else merged.push([...r] as [number, number]); }
  const wide = merged.filter((r) => r[1] - r[0] > w * 0.04);
  if (wide.length === expected) {
    const cells: Rect[] = [];
    for (let i = 0; i < wide.length; i++) {
      const left = i === 0 ? 0 : Math.round((wide[i - 1][1] + wide[i][0]) / 2);
      const right = i === wide.length - 1 ? w : Math.round((wide[i][1] + wide[i + 1][0]) / 2);
      cells.push({ x: left, y: 0, w: right - left, h });
    }
    return cells;
  }
  return Array.from({ length: expected }, (_, i) => ({ x: Math.round((w / expected) * i), y: 0, w: Math.round(w / expected), h }));
}

/** Horizontal runs of opaque pixels on row `y` (used to find legs/arms for the automatic skeleton fit). */
export function rowRuns(img: Img, y: number, threshold = 24): [number, number][] {
  const { width: w, height: h, data } = img;
  const yy = Math.max(0, Math.min(h - 1, Math.round(y)));
  const runs: [number, number][] = [];
  let s = -1;
  for (let x = 0; x <= w; x++) {
    const on = x < w && data[(yy * w + x) * 4 + 3] > threshold;
    if (on && s < 0) s = x;
    if (!on && s >= 0) { runs.push([s, x - 1]); s = -1; }
  }
  return runs;
}

export const alphaAt = (img: Img, x: number, y: number) => {
  const xi = Math.round(x), yi = Math.round(y);
  return xi < 0 || yi < 0 || xi >= img.width || yi >= img.height ? 0 : img.data[(yi * img.width + xi) * 4 + 3];
};

/** Paints (mode 'erase' | 'restore') alpha with a soft round brush; `original` supplies the pixels to restore. */
export function paintAlpha(img: Img, original: Img | null, cx: number, cy: number, radius: number, mode: 'erase' | 'restore', hardness = 0.6) {
  const { width: w, height: h, data } = img;
  const x0 = Math.max(0, Math.floor(cx - radius)), x1 = Math.min(w - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius)), y1 = Math.min(h - 1, Math.ceil(cy + radius));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const d = Math.hypot(x - cx, y - cy);
    if (d > radius) continue;
    const k = d <= radius * hardness ? 1 : 1 - (d - radius * hardness) / (radius * (1 - hardness) + 1e-6);
    const i = (y * w + x) * 4;
    if (mode === 'erase') data[i + 3] = Math.round(data[i + 3] * (1 - k));
    else if (original) {
      const oa = original.data[i + 3];
      const na = Math.max(data[i + 3], Math.round(oa * k));
      if (data[i + 3] < na) { data[i] = original.data[i]; data[i + 1] = original.data[i + 1]; data[i + 2] = original.data[i + 2]; data[i + 3] = na; }
    }
  }
}
