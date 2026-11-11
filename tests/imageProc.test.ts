import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYING, components, crop, detectCells, estimateKeyColor, keyBackground, newImg, opaqueBounds, paintAlpha, removeIslands, rowRuns, trim, cloneImg, type Img } from '@/engine/puppet/imageProc';

/** Synthetic turnaround sheet: near-white noisy (JPEG-like) background and three coloured "figures". */
function sheet(w = 600, h = 300, noise = 6): Img {
  const img = newImg(w, h); let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < w * h; i++) { const n = (rnd() - 0.5) * noise * 2; img.data[i * 4] = 250 + n; img.data[i * 4 + 1] = 250 + n; img.data[i * 4 + 2] = 248 + n; img.data[i * 4 + 3] = 255; }
  const rect = (x0: number, y0: number, x1: number, y1: number, c: [number, number, number]) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * w + x) * 4; img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; } };
  for (const cx of [100, 300, 500]) { rect(cx - 30, 40, cx + 30, 260, [90, 110, 40]); rect(cx - 12, 10, cx + 12, 40, [200, 150, 120]); }
  rect(80, 120, 90, 135, [255, 255, 255]); // white detail INSIDE the first figure's body? (inside torso region)
  return img;
}

describe('background removal', () => {
  it('estimates the key colour from the border', () => { const c = estimateKeyColor(sheet()); expect(c[0]).toBeGreaterThan(240); expect(c[2]).toBeGreaterThan(238); });
  it('removes a noisy flat background and keeps the figures', () => {
    const out = keyBackground(sheet(), { ...DEFAULT_KEYING });
    const a = (x: number, y: number) => out.data[(y * out.width + x) * 4 + 3];
    expect(a(5, 5)).toBe(0); expect(a(200, 150)).toBe(0);      // background between figures
    expect(a(100, 150)).toBe(255); expect(a(300, 20)).toBe(255); // figure bodies / heads
    expect(opaqueBounds(out)!.y).toBeLessThanOrEqual(11);
  });
  it('keeps enclosed light details when flooding from the border, removes them otherwise', () => {
    const inside = (() => { const s = sheet(); for (let y = 100; y < 140; y++) for (let x = 90; x < 110; x++) { const i = (y * s.width + x) * 4; s.data[i] = s.data[i + 1] = 252; s.data[i + 2] = 250; } return s; })();
    const flood = keyBackground(inside, { ...DEFAULT_KEYING, floodFromBorder: true });
    const all = keyBackground(inside, { ...DEFAULT_KEYING, floodFromBorder: false });
    expect(flood.data[(120 * 600 + 100) * 4 + 3]).toBe(255);
    expect(all.data[(120 * 600 + 100) * 4 + 3]).toBe(0);
  });
  it('tolerance: a stronger JPEG noise still keys out with a higher tolerance', () => {
    const noisy = sheet(600, 300, 22);
    const strict = keyBackground(noisy, { ...DEFAULT_KEYING, tolerance: 4, feather: 2, minIsland: 0 });
    const loose = keyBackground(noisy, { ...DEFAULT_KEYING, tolerance: 45, minIsland: 0 });
    const left = (o: Img) => components(o, 16).areas.filter((a) => a > 500).length;
    expect(left(loose)).toBe(3);
    expect(opaqueBounds(strict)!.w).toBeGreaterThan(opaqueBounds(loose)!.w - 1);
  });
  it('choke shrinks and negative choke grows the silhouette; islands are dropped', () => {
    const base = keyBackground(sheet(), { ...DEFAULT_KEYING, choke: 0 });
    const shrunk = keyBackground(sheet(), { ...DEFAULT_KEYING, choke: 3 });
    const grown = keyBackground(sheet(), { ...DEFAULT_KEYING, choke: -3 });
    expect(opaqueBounds(shrunk)!.w).toBeLessThan(opaqueBounds(base)!.w);
    expect(opaqueBounds(grown)!.w).toBeGreaterThan(opaqueBounds(base)!.w);
    const speck = cloneImg(base); for (let y = 280; y < 284; y++) for (let x = 20; x < 24; x++) speck.data[(y * 600 + x) * 4 + 3] = 255;
    removeIslands(speck, 50); expect(speck.data[(281 * 600 + 21) * 4 + 3]).toBe(0);
  });
});

describe('sheet slicing', () => {
  it('finds three figures separated by gaps', () => {
    const cells = detectCells(keyBackground(sheet(), { ...DEFAULT_KEYING }));
    expect(cells).toHaveLength(3);
    expect(cells[0].x).toBe(0); expect(cells[2].x + cells[2].w).toBe(600);
    for (let i = 0; i < 3; i++) { const cx = [100, 300, 500][i]; expect(cells[i].x).toBeLessThan(cx - 30); expect(cells[i].x + cells[i].w).toBeGreaterThan(cx + 30); }
  });
  it('falls back to equal columns when figures touch, and crop/trim return the figure', () => {
    const touching = newImg(300, 100); for (let i = 0; i < 300 * 100; i++) touching.data[i * 4 + 3] = 255;
    expect(detectCells(touching).map((c) => c.w)).toEqual([100, 100, 100]);
    const k = keyBackground(sheet(), { ...DEFAULT_KEYING });
    const t = trim(crop(k, { x: 0, y: 0, w: 200, h: 300 }), 4);
    expect(t.img.height).toBeGreaterThanOrEqual(250); expect(t.img.height).toBeLessThanOrEqual(262); expect(t.offset.y).toBeLessThanOrEqual(10);
  });
  it('row runs find separate legs', () => {
    const img = newImg(100, 50); for (const [a, b] of [[20, 30], [60, 70]]) for (let x = a; x < b; x++) img.data[(25 * 100 + x) * 4 + 3] = 255;
    expect(rowRuns(img, 25)).toEqual([[20, 29], [60, 69]]);
  });
});

describe('retouch brush', () => {
  it('erases and restores alpha', () => {
    const img = newImg(40, 40); for (let i = 0; i < 1600; i++) { img.data[i * 4] = 200; img.data[i * 4 + 3] = 255; }
    const orig = cloneImg(img);
    paintAlpha(img, orig, 20, 20, 8, 'erase');
    expect(img.data[(20 * 40 + 20) * 4 + 3]).toBe(0); expect(img.data[(2 * 40 + 2) * 4 + 3]).toBe(255);
    paintAlpha(img, orig, 20, 20, 5, 'restore');
    expect(img.data[(20 * 40 + 20) * 4 + 3]).toBe(255);
  });
});
