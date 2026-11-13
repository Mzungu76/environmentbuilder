/**
 * Reference renderer for any web game: draws the skinned mesh with the Canvas 2D API (affine texture mapping per triangle).
 * For PixiJS/WebGL use the same arrays (positions from `skinVertices`, `mesh.uvs`, `mesh.indices`) with a Mesh object.
 */
export interface DrawOptions {
  /** Where the pivot (feet) lands on the canvas. */
  x: number; y: number;
  /** Canvas pixels per cut-out pixel. */
  scale: number;
  /** Mirror horizontally (side view facing left). */
  flip?: boolean;
  pivot: { x: number; y: number };
}

export function drawPuppet(
  ctx: CanvasRenderingContext2D, image: CanvasImageSource & { width: number; height: number },
  positions: Float32Array, uvs: number[], indices: number[], o: DrawOptions,
) {
  const W = image.width, H = image.height, f = o.flip ? -1 : 1;
  const px = (i: number) => o.x + (positions[i * 2] - o.pivot.x) * o.scale * f;
  const py = (i: number) => o.y + (positions[i * 2 + 1] - o.pivot.y) * o.scale;
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t], i1 = indices[t + 1], i2 = indices[t + 2];
    const u = [uvs[i0 * 2] * W, uvs[i1 * 2] * W, uvs[i2 * 2] * W], v = [uvs[i0 * 2 + 1] * H, uvs[i1 * 2 + 1] * H, uvs[i2 * 2 + 1] * H];
    const X = [px(i0), px(i1), px(i2)], Y = [py(i0), py(i1), py(i2)];
    // solve [X;Y] = M · [u;v;1]
    const det = u[0] * (v[1] - v[2]) + u[1] * (v[2] - v[0]) + u[2] * (v[0] - v[1]);
    if (Math.abs(det) < 1e-9) continue;
    const a = (X[0] * (v[1] - v[2]) + X[1] * (v[2] - v[0]) + X[2] * (v[0] - v[1])) / det;
    const c = (X[0] * (u[2] - u[1]) + X[1] * (u[0] - u[2]) + X[2] * (u[1] - u[0])) / det;
    const e = (X[0] * (u[1] * v[2] - u[2] * v[1]) + X[1] * (u[2] * v[0] - u[0] * v[2]) + X[2] * (u[0] * v[1] - u[1] * v[0])) / det;
    const b = (Y[0] * (v[1] - v[2]) + Y[1] * (v[2] - v[0]) + Y[2] * (v[0] - v[1])) / det;
    const d = (Y[0] * (u[2] - u[1]) + Y[1] * (u[0] - u[2]) + Y[2] * (u[1] - u[0])) / det;
    const fy = (Y[0] * (u[1] * v[2] - u[2] * v[1]) + Y[1] * (u[2] * v[0] - u[0] * v[2]) + Y[2] * (u[0] * v[1] - u[1] * v[0])) / det;
    // clip a hair larger than the triangle to hide seams between neighbours
    const cx = (X[0] + X[1] + X[2]) / 3, cy = (Y[0] + Y[1] + Y[2]) / 3;
    ctx.save();
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const dx = X[k] - cx, dy = Y[k] - cy, l = Math.hypot(dx, dy) || 1;
      const qx = X[k] + (dx / l) * 0.7, qy = Y[k] + (dy / l) * 0.7;
      if (k === 0) ctx.moveTo(qx, qy); else ctx.lineTo(qx, qy);
    }
    ctx.closePath(); ctx.clip();
    ctx.transform(a, b, c, d, e, fy);
    ctx.drawImage(image, 0, 0);
    ctx.restore();
  }
}
