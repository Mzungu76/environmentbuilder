import type { DollShape } from './shapes';

/** Canvas 2D renderer for dolls (reference implementation; the Pixi renderer in SceneView draws the same shapes). */
export interface DollDrawOptions {
  /** Feet position on the canvas. */
  x: number; y: number;
  /** Canvas pixels per doll unit (figure height in px / 1000). */
  scale: number;
  flip?: boolean;
  outline: string;
  /** Outline width in doll units. */
  outlineWidth: number;
}

export function drawDoll(ctx: CanvasRenderingContext2D, shapes: DollShape[], o: DollDrawOptions) {
  const f = o.flip ? -1 : 1;
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (const s of shapes) {
    const n = s.pts.length;
    if (n < 4) continue;
    ctx.beginPath();
    ctx.moveTo(o.x + s.pts[0] * o.scale * f, o.y + s.pts[1] * o.scale);
    for (let i = 2; i < n; i += 2) ctx.lineTo(o.x + s.pts[i] * o.scale * f, o.y + s.pts[i + 1] * o.scale);
    if (s.kind === 'line') {
      if (s.closed) ctx.closePath();
      ctx.strokeStyle = s.fill; ctx.lineWidth = (s.w ?? 8) * o.scale; ctx.stroke();
      continue;
    }
    ctx.closePath();
    ctx.fillStyle = s.fill; ctx.fill();
    if (!s.bare && o.outlineWidth > 0) { ctx.strokeStyle = o.outline; ctx.lineWidth = o.outlineWidth * o.scale; ctx.stroke(); }
  }
  ctx.restore();
}

/** Approximate bounds of a pose (doll units) — used to frame previews. */
export function shapesBounds(shapes: DollShape[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of shapes) for (let i = 0; i < s.pts.length; i += 2) { x0 = Math.min(x0, s.pts[i]); x1 = Math.max(x1, s.pts[i]); y0 = Math.min(y0, s.pts[i + 1]); y1 = Math.max(y1, s.pts[i + 1]); }
  return { x0, y0, x1, y1 };
}
