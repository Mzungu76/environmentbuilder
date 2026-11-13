import { describe, expect, it } from 'vitest';
import { applyStroke, hasCoverage, newOccluder, occGrid, occluderAlpha, occluderCoverage, seedCoverage } from '@/engine/navigation/occluders';
import { createProject } from '@/lib/serialization/factory';
import { migrateProject } from '@/lib/serialization/migrations';
import { SCHEMA_VERSION, type OccluderOp, type OccluderStroke } from '@/types';

const env = { width: 1600, height: 900 };
const stroke = (mode: 'add' | 'sub', pts: number[], radius = 0.05): OccluderStroke => ({ kind: 'stroke', mode, radius, pts });
const at = (m: Uint8Array, nx: number, ny: number) => { const { w, h } = occGrid(env); return m[Math.floor(ny * h) * w + Math.floor(nx * w)]; };

describe('occluders', () => {
  it('a brush stroke covers its path and nothing far from it', () => {
    const m = occluderCoverage(env, { ops: [stroke('add', [0.2, 0.5, 0.6, 0.5])] });
    expect(at(m, 0.4, 0.5)).toBe(255);            // along the line, even between the recorded points
    expect(at(m, 0.4, 0.9)).toBe(0);
    expect(hasCoverage(m)).toBe(true);
  });
  it('the eraser removes what an earlier stroke painted, in order', () => {
    const m = occluderCoverage(env, { ops: [stroke('add', [0.5, 0.5]), stroke('sub', [0.5, 0.5], 0.02)] });
    expect(at(m, 0.5, 0.5)).toBe(0);
    expect(at(m, 0.5 + 0.03 * (900 / 1600), 0.5)).toBeGreaterThan(200);  // outside the small eraser, still painted
  });
  it('is cached per ops array and can be seeded with a live mask', () => {
    const ops = [stroke('add', [0.3, 0.3])];
    const a = occluderCoverage(env, { ops });
    expect(occluderCoverage(env, { ops })).toBe(a);
    const ops2 = [...ops, stroke('add', [0.7, 0.7])], live = new Uint8Array(a); applyStroke(live, occGrid(env).w, occGrid(env).h, 1600 / 900, ops2[1]);
    seedCoverage(env, ops2, live);
    expect(occluderCoverage(env, { ops: ops2 })).toBe(live);
  });
  it('softness feathers the edge without moving the middle', () => {
    const ops = [stroke('add', [0.5, 0.5], 0.1)];
    const hard = occluderAlpha(env, { ops, softness: 0 }), soft = occluderAlpha(env, { ops, softness: 0.1 });
    expect(at(hard, 0.5, 0.5)).toBe(255); expect(at(soft, 0.5, 0.5)).toBeGreaterThan(240);
    const edge = 0.5 + 0.1 * (900 / 1600);
    expect(at(soft, edge + 0.01, 0.5)).toBeGreaterThan(at(hard, edge + 0.01, 0.5));       // coverage leaks past the edge
  });
  it('new occluders get a name and colour from the list', () => {
    const a = newOccluder([], 'a'), b = newOccluder([a], 'b');
    expect(a.name).toBe('Primo piano 1'); expect(b.name).toBe('Primo piano 2'); expect(a.color).not.toBe(b.color); expect(a.ops).toEqual([]);
  });
});

describe('schema v4 → v5', () => {
  it('turns old foreground layers into mid-ground layers and adds occluders', () => {
    const p: any = createProject('Vecchio'); p.schemaVersion = 4;
    p.environments[0].layers = [
      { id: 'bg', name: 'bg', role: 'background', assetId: 'a', visible: true, offsetX: 0, offsetY: 0, opacity: 1 },
      { id: 'fg', name: 'fg', role: 'foreground', assetId: 'b', visible: true, offsetX: 0, offsetY: 0, opacity: 1 },
    ];
    delete p.environments[0].occluders;
    const m = migrateProject(p);
    expect(m.schemaVersion).toBe(SCHEMA_VERSION);
    expect(m.environments[0].layers.map((l) => l.role)).toEqual(['background', 'midground']);
    expect(m.environments[0].occluders).toEqual([]);
  });
});

import { fillPolygon, insertShapePoint, moveShapeHandle, nearestEdge, pointInPolygon, removeShapePoint, shapeHandles, shapePolygon, splinePolygon, translateShape } from '@/engine/navigation/occluders';
import type { OccluderShape } from '@/types';

const shape = (kind: OccluderShape['shape'], pts: number[], mode: 'add' | 'sub' = 'add'): OccluderShape => ({ kind: 'shape', mode, shape: kind, pts });
const area = (m: Uint8Array) => { let s = 0; for (const v of m) s += v / 255; return s / m.length; };

describe('occluder shapes', () => {
  it('a rectangle covers its box exactly (anti-aliased edge cells aside) and nothing outside', () => {
    const m = occluderCoverage(env, { ops: [shape('rect', [0.2, 0.3, 0.6, 0.7])] });
    expect(at(m, 0.4, 0.5)).toBe(255); expect(at(m, 0.1, 0.5)).toBe(0); expect(at(m, 0.4, 0.8)).toBe(0);
    expect(area(m)).toBeCloseTo(0.4 * 0.4, 2);
  });
  it('corner order does not matter', () => {
    const a = occluderCoverage(env, { ops: [shape('rect', [0.2, 0.3, 0.6, 0.7])] }), b = occluderCoverage(env, { ops: [shape('rect', [0.6, 0.7, 0.2, 0.3])] });
    expect(Array.from(a)).toEqual(Array.from(b));
  });
  it('an ellipse is π/4 of its box, centre covered, corners not', () => {
    const m = occluderCoverage(env, { ops: [shape('ellipse', [0.2, 0.2, 0.8, 0.8])] });
    expect(at(m, 0.5, 0.5)).toBe(255); expect(at(m, 0.21, 0.21)).toBe(0);
    expect(area(m)).toBeCloseTo((Math.PI / 4) * 0.36, 2);
  });
  it('a polygon fills its triangle', () => {
    const m = occluderCoverage(env, { ops: [shape('polygon', [0.1, 0.9, 0.9, 0.9, 0.5, 0.1])] });
    expect(area(m)).toBeCloseTo(0.5 * 0.8 * 0.8, 2); expect(at(m, 0.5, 0.7)).toBe(255); expect(at(m, 0.12, 0.2)).toBe(0);
  });
  it('a spline is a smooth closed curve through its points', () => {
    const pts = [0.3, 0.3, 0.7, 0.3, 0.7, 0.7, 0.3, 0.7], poly = splinePolygon(pts);
    expect(poly.length).toBeGreaterThan(pts.length * 5);
    for (let i = 0; i < pts.length; i += 2) expect(poly.some((_, k) => k % 2 === 0 && Math.hypot(poly[k] - pts[i], poly[k + 1] - pts[i + 1]) < 1e-9)).toBe(true);   // passes through every control point
    const m = occluderCoverage(env, { ops: [shape('spline', pts)] });
    expect(at(m, 0.5, 0.5)).toBe(255); expect(at(m, 0.1, 0.1)).toBe(0);
  });
  it('a subtracted shape cuts a hole in what was added before', () => {
    const m = occluderCoverage(env, { ops: [shape('rect', [0.1, 0.1, 0.9, 0.9]), shape('ellipse', [0.4, 0.4, 0.6, 0.6], 'sub')] });
    expect(at(m, 0.5, 0.5)).toBe(0); expect(at(m, 0.2, 0.2)).toBe(255);
  });
  it('shapes and strokes mix in order', () => {
    const m = occluderCoverage(env, { ops: [shape('rect', [0.1, 0.1, 0.5, 0.5]), stroke('sub', [0.3, 0.3], 0.05)] });
    expect(at(m, 0.3, 0.3)).toBe(0); expect(at(m, 0.15, 0.15)).toBe(255);
  });
  it('point-in-polygon and handles', () => {
    const r = shape('rect', [0.2, 0.2, 0.6, 0.6]);
    expect(pointInPolygon(shapePolygon(r), 0.4, 0.4)).toBe(true); expect(pointInPolygon(shapePolygon(r), 0.7, 0.4)).toBe(false);
    expect(shapeHandles(r)).toHaveLength(4);
    const dragged = moveShapeHandle(r, 2, { x: 0.8, y: 0.9 });          // corner (x1, y1): the opposite corner (0.2, 0.2) stays
    expect(dragged.pts).toEqual([0.8, 0.9, 0.2, 0.2]);
  });
  it('polygon points can be inserted on an edge and removed down to the minimum', () => {
    let p = shape('polygon', [0.1, 0.1, 0.9, 0.1, 0.5, 0.9]);
    const ne = nearestEdge(p, { x: 0.5, y: 0.1 }, 1600, 900)!;
    expect(ne.index).toBe(0); expect(ne.dist).toBeLessThan(1);
    p = insertShapePoint(p, ne.index, ne.at);
    expect(p.pts).toHaveLength(8); expect(p.pts.slice(2, 4)).toEqual([0.5, 0.1]);
    expect(removeShapePoint(p, 1).pts).toHaveLength(6);
    expect(removeShapePoint(shape('polygon', [0.1, 0.1, 0.9, 0.1, 0.5, 0.9]), 0).pts).toHaveLength(6);      // a triangle keeps its 3 points
    expect(translateShape(p, 0.1, -0.1).pts.slice(0, 2)).toEqual([0.2, 0]);
  });
  it('fillPolygon ignores degenerate input', () => {
    const m = new Uint8Array(64 * 36); fillPolygon(m, 64, 36, [0.1, 0.1, 0.9, 0.9], 'add'); expect(area(m)).toBe(0);
  });
});
