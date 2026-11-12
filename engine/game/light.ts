import type { CharacterLook, LightMapData } from '@/types';
import { DEFAULT_LOOK } from '@/types';

/**
 * Light of the scene on the characters. The background is reduced to a coarse colour map (a few KB, stored with the scenario); at any
 * position the local luminance and hue give a brightness factor and an ambient tint, so a character walking from a lit clearing
 * into a dark tunnel (or under a blue shaft of light) takes on the light of the place it stands in.
 */
export interface LightSample { brightness: number; tint: string; tintAmount: number }

const b64 = { enc: (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); }, dec: (t: string) => { const s = atob(t), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; } };

/** Box-averages `rgba` (w×h) into outW × (outW·h/w) cells, then softens it with a 3×3 blur. */
export function buildLightMap(rgba: ArrayLike<number>, w: number, h: number, outW = 256): LightMapData {
  const ow = Math.max(2, Math.min(outW, w)), oh = Math.max(2, Math.round((ow * h) / w));
  const sum = new Float64Array(ow * oh * 3), cnt = new Float64Array(ow * oh);
  for (let y = 0; y < h; y++) {
    const cy = Math.min(oh - 1, Math.floor((y * oh) / h));
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, a = (rgba[i + 3] ?? 255) / 255; if (!a) continue;
      const c = cy * ow + Math.min(ow - 1, Math.floor((x * ow) / w));
      sum[c * 3] += rgba[i] * a; sum[c * 3 + 1] += rgba[i + 1] * a; sum[c * 3 + 2] += rgba[i + 2] * a; cnt[c] += a;
    }
  }
  const avg = new Float64Array(ow * oh * 3);
  for (let c = 0; c < ow * oh; c++) for (let k = 0; k < 3; k++) avg[c * 3 + k] = cnt[c] ? sum[c * 3 + k] / cnt[c] : 0;
  const out = new Uint8Array(ow * oh * 3);
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) for (let k = 0; k < 3; k++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= ow || yy >= oh) continue; s += avg[(yy * ow + xx) * 3 + k]; n++; }
    out[(y * ow + x) * 3 + k] = Math.round(s / n);
  }
  return { w: ow, h: oh, data: b64.enc(out) };
}

interface Decoded { rgb: Uint8Array; w: number; h: number; meanLum: number }
const cache = new Map<string, Decoded>();
const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
function decode(m: LightMapData): Decoded {
  let d = cache.get(m.data);
  if (!d) {
    const rgb = b64.dec(m.data); let s = 0;
    for (let i = 0; i < rgb.length; i += 3) s += lum(rgb[i], rgb[i + 1], rgb[i + 2]);
    d = { rgb, w: m.w, h: m.h, meanLum: Math.max(1, s / (rgb.length / 3)) };
    cache.set(m.data, d); if (cache.size > 6) cache.delete(cache.keys().next().value as string);
  }
  return d;
}
const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

/** Light at a normalized position (bilinear). `strength` 0–1 scales how much the character follows the scene. */
export function sampleLight(map: LightMapData, nx: number, ny: number, strength = 0.7): LightSample {
  const d = decode(map);
  const fx = Math.min(d.w - 1, Math.max(0, nx * d.w - 0.5)), fy = Math.min(d.h - 1, Math.max(0, ny * d.h - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(d.w - 1, x0 + 1), y1 = Math.min(d.h - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
  const px = (x: number, y: number, k: number) => d.rgb[(y * d.w + x) * 3 + k];
  const ch = (k: number) => (px(x0, y0, k) * (1 - tx) + px(x1, y0, k) * tx) * (1 - ty) + (px(x0, y1, k) * (1 - tx) + px(x1, y1, k) * tx) * ty;
  const r = ch(0), g = ch(1), b = ch(2), L = lum(r, g, b), m = Math.max(r, g, b, 1), mn = Math.min(r, g, b), sat = (m - mn) / m;
  const ratio = Math.min(1.7, Math.max(0.4, L / d.meanLum));
  const s = Math.min(1, Math.max(0, strength));
  return { brightness: 1 + (ratio - 1) * s * 0.9, tint: hex((r / m) * 255, (g / m) * 255, (b / m) * 255), tintAmount: Math.min(0.6, sat * 0.9) * s };
}

/** The character's own look combined with the light of the place (its own tint, if it has one, wins; brightness multiplies). */
export function applyLight(look: CharacterLook | undefined, light: LightSample | null): CharacterLook | undefined {
  if (!light) return look;
  const base = { ...DEFAULT_LOOK, ...(look ?? {}) };
  const own = base.tintAmount > 0.01;
  return { ...base, brightness: base.brightness * light.brightness, tint: own ? base.tint : light.tint, tintAmount: own ? base.tintAmount : light.tintAmount };
}

/** Decodes a map to RGBA for a small preview. */
export function lightMapPixels(m: LightMapData): { w: number; h: number; rgba: Uint8ClampedArray } {
  const d = decode(m), out = new Uint8ClampedArray(d.w * d.h * 4);
  for (let i = 0; i < d.w * d.h; i++) { out[i * 4] = d.rgb[i * 3]; out[i * 4 + 1] = d.rgb[i * 3 + 1]; out[i * 4 + 2] = d.rgb[i * 3 + 2]; out[i * 4 + 3] = 255; }
  return { w: d.w, h: d.h, rgba: out };
}
