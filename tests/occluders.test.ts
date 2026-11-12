import { describe, expect, it } from 'vitest';
import { applyStroke, hasCoverage, newOccluder, occGrid, occluderAlpha, occluderCoverage, seedCoverage } from '@/engine/navigation/occluders';
import { createProject } from '@/lib/serialization/factory';
import { migrateProject } from '@/lib/serialization/migrations';
import { SCHEMA_VERSION, type OccluderOp } from '@/types';

const env = { width: 1600, height: 900 };
const stroke = (mode: 'add' | 'sub', pts: number[], radius = 0.05): OccluderOp => ({ kind: 'stroke', mode, radius, pts });
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
