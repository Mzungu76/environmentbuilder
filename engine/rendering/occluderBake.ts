/** Browser-only: cuts a backdrop image with an occluder alpha grid. The result is the backdrop where the occluder covers, transparent elsewhere. */

const MAX_SIDE = 2048;

let scratch: HTMLCanvasElement | null = null;

/** Draws `alpha` (w×h, 0–255) as the alpha channel of a white canvas. */
function alphaCanvas(alpha: Uint8Array, w: number, h: number): HTMLCanvasElement {
  const c = scratch ?? (scratch = document.createElement('canvas'));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const ctx = c.getContext('2d')!, img = ctx.createImageData(w, h);
  for (let i = 0, o = 0; i < alpha.length; i++, o += 4) { img.data[o] = 255; img.data[o + 1] = 255; img.data[o + 2] = 255; img.data[o + 3] = alpha[i]; }
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * Bakes the cut-out into `target` (created when missing; reused when the size is unchanged so a texture can be refreshed in place).
 * Returns the canvas and the scale to apply to a sprite so that it covers the original image (when it was reduced to MAX_SIDE).
 */
export function bakeCutout(image: CanvasImageSource & { width: number; height: number }, alpha: Uint8Array, gw: number, gh: number, target?: HTMLCanvasElement): { canvas: HTMLCanvasElement; scale: number } {
  const nw = image.width, nh = image.height, k = Math.min(1, MAX_SIDE / Math.max(nw, nh));
  const W = Math.max(1, Math.round(nw * k)), H = Math.max(1, Math.round(nh * k));
  const canvas = target ?? document.createElement('canvas');
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const ctx = canvas.getContext('2d')!;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, W, H);
  ctx.globalCompositeOperation = 'destination-in';   // keep the picture only where the mask is opaque (bilinear upscale of the grid)
  ctx.drawImage(alphaCanvas(alpha, gw, gh), 0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';
  return { canvas, scale: 1 / k };
}

/** PNG of the cut-out (game package). */
export function cutoutBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('PNG non creato'))), 'image/png'));
}
