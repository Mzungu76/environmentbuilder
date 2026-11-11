import type { Mesh, Skin, ViewId, WeightParams } from '@/types';
import { BONE_IDS } from '@/types';
import type { Img } from './imageProc';
import type { Rig } from './skeleton';

export const DEFAULT_WEIGHT_PARAMS: WeightParams = { falloff: 0.3, smooth: 2, farPenalty: 1 };

/**
 * Regular-grid triangle mesh over the silhouette: every grid cell touching the (slightly grown) opaque area becomes
 * two triangles. The transparent texels of the cut-out hide the stair-stepped outline.
 */
export function generateMesh(img: Img, cell = 14, margin = 6): Mesh {
  const { width: w, height: h, data } = img;
  // summed-area table of the opaque mask
  const sat = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += data[(y * w + x) * 4 + 3] > 12 ? 1 : 0; sat[(y + 1) * (w + 1) + x + 1] = sat[y * (w + 1) + x + 1] + row; }
  }
  const count = (x0: number, y0: number, x1: number, y1: number) => {
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(w, x1); y1 = Math.min(h, y1);
    if (x1 <= x0 || y1 <= y0) return 0;
    return sat[y1 * (w + 1) + x1] - sat[y0 * (w + 1) + x1] - sat[y1 * (w + 1) + x0] + sat[y0 * (w + 1) + x0];
  };
  const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
  const vIndex = new Map<number, number>();
  const vertices: number[] = [], uvs: number[] = [], indices: number[] = [];
  const vtx = (gx: number, gy: number) => {
    const key = gy * (cols + 1) + gx;
    let i = vIndex.get(key);
    if (i === undefined) {
      const x = Math.min(w, gx * cell), y = Math.min(h, gy * cell);
      i = vertices.length / 2; vIndex.set(key, i);
      vertices.push(x, y); uvs.push(x / w, y / h);
    }
    return i;
  };
  for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < cols; gx++) {
    if (!count(gx * cell - margin, gy * cell - margin, (gx + 1) * cell + margin, (gy + 1) * cell + margin)) continue;
    const a = vtx(gx, gy), b = vtx(gx + 1, gy), c = vtx(gx, gy + 1), d = vtx(gx + 1, gy + 1);
    indices.push(a, b, c, b, d, c);
  }
  return { cell, vertices, uvs, indices };
}

const NB = BONE_IDS.length;

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Vertex adjacency from the triangle list. With the cut-out image, an edge only connects two vertices when the pixels
 * along it are visible: smoothing and the smooth brush then never leak across gaps (e.g. between the two legs). */
export function adjacency(mesh: Mesh, img?: Img): number[][] {
  const n = mesh.vertices.length / 2;
  const adj: Set<number>[] = Array.from({ length: n }, () => new Set());
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const [a, b, c] = [mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]];
    adj[a].add(b); adj[a].add(c); adj[b].add(a); adj[b].add(c); adj[c].add(a); adj[c].add(b);
  }
  const solid = (x: number, y: number) => {
    const xi = Math.round(x), yi = Math.round(y);
    return !!img && xi >= 0 && yi >= 0 && xi < img.width && yi < img.height && img.data[(yi * img.width + xi) * 4 + 3] > 12;
  };
  const V = mesh.vertices;
  return adj.map((set, v) => {
    const l = [...set];
    if (!img || !solid(V[v * 2], V[v * 2 + 1])) return l;
    return l.filter((u) => [0.25, 0.5, 0.75].every((t) => solid(V[v * 2] + (V[u * 2] - V[v * 2]) * t, V[v * 2 + 1] + (V[u * 2 + 1] - V[v * 2 + 1]) * t)) || !solid(V[u * 2], V[u * 2 + 1]));
  });
}

/**
 * Automatic weights. Each vertex is influenced by the bones whose *normalised* distance (distance / bone thickness) is close
 * to the minimum: thin bones (arms) and thick ones (torso) compete fairly and blend only near the joints.
 * Returns a dense N×15 matrix.
 */
export function autoWeights(mesh: Mesh, rig: Rig, view: ViewId, params: WeightParams, img?: Img): Float32Array {
  const n = mesh.vertices.length / 2, H = rig.figureHeight;
  const dense = new Float32Array(n * NB);
  const tl = rig.bones.find((b) => b.id === 'thighL')!.head, tr = rig.bones.find((b) => b.id === 'thighR')!.head;
  const axis = (tl.x + tr.x) / 2; // body midline between the hips
  for (let v = 0; v < n; v++) {
    const px = mesh.vertices[v * 2], py = mesh.vertices[v * 2 + 1];
    const dn: number[] = [];
    let dmin = Infinity;
    for (const b of rig.bones) {
      let d = segDist(px, py, b.head.x, b.head.y, b.tail.x, b.tail.y) / (b.radius * H);
      const left = b.id.endsWith('L'), right = b.id.endsWith('R');
      if (view !== 'side') { // never let a limb of one side grab pixels clearly on the other side of the body
        if (left && px > axis) d += 3; if (right && px < axis) d += 3;
      } else if (left) d += params.farPenalty * 1.2;
      dn.push(d); if (d < dmin) dmin = d;
    }
    let sum = 0;
    for (let b = 0; b < NB; b++) { const w = Math.exp(-(dn[b] - dmin) / Math.max(0.02, params.falloff)); dense[v * NB + b] = w < 0.04 ? 0 : w; sum += dense[v * NB + b]; }
    for (let b = 0; b < NB; b++) dense[v * NB + b] /= sum || 1;
  }
  smoothWeights(dense, adjacency(mesh, img), params.smooth);
  return dense;
}

export function smoothWeights(dense: Float32Array, adj: number[][], iterations: number, amount = 0.5) {
  const n = adj.length;
  for (let it = 0; it < iterations; it++) {
    const src = new Float32Array(dense);
    for (let v = 0; v < n; v++) {
      if (!adj[v].length) continue;
      for (let b = 0; b < NB; b++) {
        let s = 0; for (const u of adj[v]) s += src[u * NB + b];
        dense[v * NB + b] = src[v * NB + b] * (1 - amount) + (s / adj[v].length) * amount;
      }
    }
  }
  normalizeDense(dense);
}

export function normalizeDense(dense: Float32Array) {
  const n = dense.length / NB;
  for (let v = 0; v < n; v++) {
    let s = 0; for (let b = 0; b < NB; b++) s += dense[v * NB + b];
    if (s <= 1e-6) { dense[v * NB] = 1; continue; }
    for (let b = 0; b < NB; b++) dense[v * NB + b] /= s;
  }
}

/** Keeps the 4 strongest influences per vertex (the runtime format). */
export function denseToSkin(dense: Float32Array): Skin {
  const n = dense.length / NB;
  const idx: number[] = new Array(n * 4), w: number[] = new Array(n * 4);
  for (let v = 0; v < n; v++) {
    const order = Array.from({ length: NB }, (_, b) => b).sort((a, b) => dense[v * NB + b] - dense[v * NB + a]).slice(0, 4);
    let s = 0; for (const b of order) s += dense[v * NB + b];
    let acc = 0;
    order.forEach((b, k) => {
      idx[v * 4 + k] = b;
      const val = s > 0 ? Math.round((dense[v * NB + b] / s) * 10000) / 10000 : k === 0 ? 1 : 0;
      w[v * 4 + k] = val; acc += val;
    });
    w[v * 4] = Math.round((w[v * 4] + (1 - acc)) * 10000) / 10000; // weights always sum to exactly 1
  }
  return { idx, w };
}

export function skinToDense(skin: Skin): Float32Array {
  const n = skin.idx.length / 4;
  const dense = new Float32Array(n * NB);
  for (let v = 0; v < n; v++) for (let k = 0; k < 4; k++) dense[v * NB + skin.idx[v * 4 + k]] += skin.w[v * 4 + k];
  return dense;
}

export type BrushMode = 'assign' | 'add' | 'remove' | 'smooth';
/**
 * Weight-paint brush. 'assign' pushes the chosen bone towards weight 1 (others towards 0), 'add' only adds to it,
 * 'remove' lowers it, 'smooth' relaxes the weights with the neighbours. Strength 0..1, soft falloff towards the rim.
 */
export function paintWeights(dense: Float32Array, mesh: Mesh, adj: number[][], bone: number, cx: number, cy: number, radius: number, strength: number, mode: BrushMode) {
  const n = mesh.vertices.length / 2;
  const touched: number[] = [];
  for (let v = 0; v < n; v++) {
    const d = Math.hypot(mesh.vertices[v * 2] - cx, mesh.vertices[v * 2 + 1] - cy);
    if (d > radius) continue;
    const k = strength * (1 - (d / radius) ** 2);
    touched.push(v);
    if (mode === 'smooth') {
      for (let b = 0; b < NB; b++) {
        let s = 0; for (const u of adj[v]) s += dense[u * NB + b];
        const avg = adj[v].length ? s / adj[v].length : dense[v * NB + b];
        dense[v * NB + b] = dense[v * NB + b] * (1 - k) + avg * k;
      }
    } else if (mode === 'assign') {
      for (let b = 0; b < NB; b++) dense[v * NB + b] *= 1 - k;
      dense[v * NB + bone] += k;
    } else if (mode === 'add') dense[v * NB + bone] += k;
    else dense[v * NB + bone] *= 1 - k;
  }
  for (const v of touched) { let s = 0; for (let b = 0; b < NB; b++) s += dense[v * NB + b]; if (s <= 1e-6) dense[v * NB] = 1; else for (let b = 0; b < NB; b++) dense[v * NB + b] /= s; }
}

const NEAR_LEG: string[] = ['thighR', 'shinR', 'footR'], NEAR_ARM: string[] = ['uarmR', 'farmR', 'handR'];
const toFar = (name: string) => name.replace(/R$/, 'L');

/**
 * Profile views show one arm and one leg: the others are hidden behind them in the flat picture. This adds COPIES of the
 * near limbs (same texture, same rest position), bound to the far-limb bones and drawn BEHIND the body. When the far limb
 * swings away from the near one, the copy becomes visible, which is what makes a profile walk cycle readable.
 */
export function addFarLimbs(mesh: Mesh, skin: Skin, opts: { arm: boolean; leg: boolean }): { mesh: Mesh; skin: Skin } {
  const n = mesh.vertices.length / 2;
  const groups: string[][] = [];
  if (opts.leg) groups.push(NEAR_LEG);
  if (opts.arm) groups.push(NEAR_ARM);
  if (!groups.length) return { mesh, skin };
  const dense = skinToDense(skin);
  const vertices = mesh.vertices.slice(), uvs = mesh.uvs.slice();
  const idx = skin.idx.slice(), w = skin.w.slice();
  const behind: number[] = [];
  for (const g of groups) {
    const gi = g.map((b) => BONE_IDS.indexOf(b as never));
    const inGroup = new Uint8Array(n);
    for (let v = 0; v < n; v++) { let s = 0; for (const b of gi) s += dense[v * NB + b]; inGroup[v] = s >= 0.5 ? 1 : 0; }
    const map = new Map<number, number>();
    const clone = (v: number) => {
      let c = map.get(v);
      if (c === undefined) {
        c = vertices.length / 2; map.set(v, c);
        vertices.push(mesh.vertices[v * 2], mesh.vertices[v * 2 + 1]); uvs.push(mesh.uvs[v * 2], mesh.uvs[v * 2 + 1]);
        for (let k = 0; k < 4; k++) {
          const b = skin.idx[v * 4 + k], name = BONE_IDS[b] as string;
          idx.push(g.includes(name) ? BONE_IDS.indexOf(toFar(name) as never) : b); w.push(skin.w[v * 4 + k]);
        }
      }
      return c;
    };
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const [a, b, c] = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]];
      if (inGroup[a] + inGroup[b] + inGroup[c] >= 2) behind.push(clone(a), clone(b), clone(c));
    }
  }
  return { mesh: { ...mesh, vertices, uvs, indices: [...behind, ...mesh.indices] }, skin: { idx, w } };
}
