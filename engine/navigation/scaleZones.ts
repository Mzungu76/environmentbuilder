import type { Environment, ScaleZone } from '@/types';

/** Grid of the painted zones: 256 cells across, same aspect as the environment. */
export const ZONE_GRID_W = 256;
export const zoneGrid = (env: Pick<Environment, 'width' | 'height'>) => ({ w: ZONE_GRID_W, h: Math.max(8, Math.round((ZONE_GRID_W * (env.height || 1)) / (env.width || 1))) });

const b64 = {
  enc: (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); },
  dec: (t: string) => { const s = atob(t), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; },
};
const cache = new Map<string, Uint8Array>();
/** Decoded coverage grid (cached; do not mutate the result). Wrong-sized or empty masks give an empty grid. */
export function decodeMask(mask: string, w: number, h: number): Uint8Array {
  const key = `${w}x${h}:${mask}`;
  let m = cache.get(key);
  if (!m) { m = mask ? b64.dec(mask) : new Uint8Array(w * h); if (m.length !== w * h) m = new Uint8Array(w * h); cache.set(key, m); if (cache.size > 24) cache.delete(cache.keys().next().value as string); }
  return m;
}
export const encodeMask = (m: Uint8Array) => b64.enc(m);
export const emptyMask = (w: number, h: number) => new Uint8Array(w * h);

/**
 * Stamps a round soft brush into `mask` (grid cells). `cx, cy` and `radius` are normalized to the environment width/height
 * (radius = fraction of the HEIGHT, so it is round on screen). Paint raises the coverage, erase lowers it.
 */
export function stamp(mask: Uint8Array, w: number, h: number, envAspect: number, cx: number, cy: number, radius: number, mode: 'paint' | 'erase', hardness = 0.2) {
  const rx = (radius / envAspect) * w, ry = radius * h;         // radius in cells (x and y cells have the same physical size)
  const gx = cx * w, gy = cy * h;
  const x0 = Math.max(0, Math.floor(gx - rx)), x1 = Math.min(w - 1, Math.ceil(gx + rx)), y0 = Math.max(0, Math.floor(gy - ry)), y1 = Math.min(h - 1, Math.ceil(gy + ry));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const d = Math.hypot((x + 0.5 - gx) / rx, (y + 0.5 - gy) / ry);
    if (d >= 1) continue;
    const a0 = d <= hardness ? 1 : 1 - (d - hardness) / (1 - hardness), a = a0 * a0 * (3 - 2 * a0);        // smoothstep falloff
    const i = y * w + x, v = mask[i];
    mask[i] = mode === 'paint' ? Math.max(v, Math.round(a * 255)) : Math.max(0, Math.round(v - a * 255));
  }
}

/** Default softness of the transitions (0–1). */
export const DEFAULT_SOFTNESS = 0.5;
/** Blur radius in grid cells for a softness value: up to 20% of the image height. */
export const softRadius = (softness: number, gridH: number) => Math.max(0, Math.min(1, softness)) * 0.2 * gridH;

/** Separable box blur (running sums), applied three times ≈ a Gaussian. Result is a new array. */
export function blurMask(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const b = Math.round(radius / 2);
  if (b < 1) return mask;
  let a = Float32Array.from(mask), t = new Float32Array(a.length);
  const pass = (src: Float32Array, dst: Float32Array, horizontal: boolean) => {
    const len = horizontal ? w : h, lines = horizontal ? h : w, stride = horizontal ? 1 : w, lineStride = horizontal ? w : 1;
    for (let l = 0; l < lines; l++) {
      const base = l * lineStride; let sum = 0;
      for (let i = -b; i <= b; i++) sum += src[base + Math.min(len - 1, Math.max(0, i)) * stride];      // edges repeat their value
      for (let i = 0; i < len; i++) {
        dst[base + i * stride] = sum / (2 * b + 1);
        sum += src[base + Math.min(len - 1, i + b + 1) * stride] - src[base + Math.max(0, i - b) * stride];
      }
    }
  };
  for (let k = 0; k < 3; k++) { pass(a, t, true); pass(t, a, false); }
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = Math.round(a[i]);
  return out;
}
const blurCache = new Map<string, Uint8Array>();
/** The coverage grid of a zone softened by `radius` cells (cached). */
export function softMask(mask: string, w: number, h: number, radius: number): Uint8Array {
  const key = `${w}x${h}:${Math.round(radius * 10)}:${mask}`;
  let m = blurCache.get(key);
  if (!m) { m = blurMask(decodeMask(mask, w, h), w, h, radius); blurCache.set(key, m); if (blurCache.size > 24) blurCache.delete(blurCache.keys().next().value as string); }
  return m;
}

/** Coverage (0–1) of a zone at a normalized position (bilinear between cells). */
export function coverageAt(mask: Uint8Array, w: number, h: number, nx: number, ny: number): number {
  const fx = Math.min(w - 1, Math.max(0, nx * w - 0.5)), fy = Math.min(h - 1, Math.max(0, ny * h - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
  const v = (x: number, y: number) => mask[y * w + x];
  return ((v(x0, y0) * (1 - tx) + v(x1, y0) * tx) * (1 - ty) + (v(x0, y1) * (1 - tx) + v(x1, y1) * tx) * ty) / 255;
}

/** Scale at a position coming from the painted zones: each zone pulls the value toward its own scale by its coverage (later zones on top). */
export function zonesScale(env: Partial<Pick<Environment, 'scaleZones' | 'width' | 'height' | 'scaleSoftness'>>, nx: number, ny: number, base: number): number {
  const zs = env.scaleZones;
  if (!zs?.length || !env.width || !env.height) return base;
  const { w, h } = zoneGrid({ width: env.width, height: env.height });
  const rad = softRadius(env.scaleSoftness ?? DEFAULT_SOFTNESS, h);
  let v = base;
  for (const z of zs) { const c = coverageAt(softMask(z.mask, w, h, rad), w, h, nx, ny); if (c > 0.001) v += (z.scale - v) * c; }
  return v;
}

export const ZONE_COLORS = ['#38bdf8', '#f472b6', '#facc15', '#4ade80', '#a78bfa', '#fb923c'];
export const newZone = (index: number, scale = 0.6): ScaleZone => ({ id: `zone-${Math.random().toString(36).slice(2, 9)}`, name: `Zona ${index + 1}`, scale, color: ZONE_COLORS[index % ZONE_COLORS.length], mask: '' });
