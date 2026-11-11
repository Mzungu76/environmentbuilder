import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, type AccessoryId, type Doll } from '@/types';
import { ACCESSORY_LABEL, accessory, createDoll, DOLL_PRESETS, randomDoll } from '@/engine/doll/defaults';
import { buildDollShapes, dollLandmarks, dollRig, DOLL_HEIGHT, shade } from '@/engine/doll/shapes';
import { DollPlayer, dollClips } from '@/engine/doll/player';
import { drawDoll, shapesBounds } from '@/engine/doll/render';
import { migrateProject } from '@/lib/serialization/migrations';
import { createProject } from '@/lib/serialization/factory';
import { dollJson, DOLL_FORMAT } from '@/lib/import-export/dollPackage';
import { LANDMARK_IDS } from '@/types';

const rest = { rot: {}, dx: 0, dy: 0 };

describe('doll geometry', () => {
  it('builds a complete skeleton from the proportions: feet on the ground, head at the top, everything finite', () => {
    const d = createDoll(); const lm = dollLandmarks(d);
    for (const k of LANDMARK_IDS) { expect(Number.isFinite(lm[k].x) && Number.isFinite(lm[k].y)).toBe(true); }
    expect(lm.headTop.y).toBeCloseTo(-DOLL_HEIGHT, 5);
    expect(lm.ankleR.y).toBeLessThan(0); expect(lm.toeR.y).toBeLessThanOrEqual(0);
    expect(lm.hipR.y).toBeGreaterThan(lm.shoulderR.y); expect(lm.kneeR.y).toBeGreaterThan(lm.hipR.y); expect(lm.ankleR.y).toBeGreaterThan(lm.kneeR.y);
    expect(dollRig(d).rig.bones).toHaveLength(15);
  });
  it('proportion sliders change the shape: a bigger head makes the figure top-heavier and the legs shorter', () => {
    const a = createDoll(), b = createDoll('x', { body: { ...createDoll().body, headSize: 0.3 } });
    const la = dollLandmarks(a), lb = dollLandmarks(b);
    expect(lb.shoulderR.y).toBeGreaterThan(la.shoulderR.y); expect(Math.abs(lb.hipR.y - lb.ankleR.y)).toBeLessThan(Math.abs(la.hipR.y - la.ankleR.y));
  });
  it('every preset and 30 random dolls produce valid shapes inside sensible bounds', () => {
    const dolls: Doll[] = [...DOLL_PRESETS.map((p) => p.make()), ...Array.from({ length: 30 }, (_, i) => randomDoll(i + 1))];
    for (const d of dolls) {
      const shapes = buildDollShapes(d, rest);
      expect(shapes.length).toBeGreaterThan(15);
      for (const s of shapes) { expect(s.pts.length % 2).toBe(0); expect(s.pts.every(Number.isFinite)).toBe(true); expect(/^#[0-9a-f]{6}$/i.test(s.fill)).toBe(true); }
      const b = shapesBounds(shapes);
      expect(b.y0).toBeGreaterThan(-1250); expect(b.y1).toBeLessThan(120); expect(b.x1 - b.x0).toBeLessThan(700);
    }
  });
  it('every accessory adds shapes and can be removed again', () => {
    const base = createDoll('x', { features: { hair: 'none', face: 'dots', top: 'tshirt', bottom: 'long', shoes: 'sneakers' } });
    const n0 = buildDollShapes(base, rest).length;
    for (const id of Object.keys(ACCESSORY_LABEL) as AccessoryId[]) {
      const n1 = buildDollShapes({ ...base, accessories: [accessory(id)] }, rest).length;
      expect(n1, id).toBeGreaterThan(n0);
    }
    expect(buildDollShapes({ ...base, accessories: [] }, rest).length).toBe(n0);
  });
  it('colour choices land in the shapes; far limbs are drawn darker', () => {
    const d = createDoll('x', { colors: { ...createDoll().colors, top: '#ff0000' } });
    const fills = buildDollShapes(d, rest).map((s) => s.fill);
    expect(fills).toContain('#ff0000'); expect(fills).toContain(shade(d.colors.skin, d.style.farShade));
    expect(shade('#ffffff', 0.5)).toBe('#808080'); expect(shade('#000000', -0.5)).toBe('#808080');
  });
  it('poses move the body: swinging a thigh moves leg shapes, torso shapes stay', () => {
    const d = createDoll();
    const a = buildDollShapes(d, rest), b = buildDollShapes(d, { rot: { thighR: -35 }, dx: 0, dy: 0 });
    expect(a.length).toBe(b.length);
    let moved = 0, still = 0;
    for (let i = 0; i < a.length; i++) { const dd = Math.max(...a[i].pts.map((v, k) => Math.abs(v - b[i].pts[k]))); if (dd > 20) moved++; else still++; }
    expect(moved).toBeGreaterThan(2); expect(still).toBeGreaterThan(moved);
  });
  it('the player animates walking (limbs differ between frames) and respects speed sync', () => {
    const d = createDoll(); const p = new DollPlayer();
    const f0 = p.frame(d, 'WALK', 0, 0.75).flatMap((s) => s.pts);
    p.frame(d, 'WALK', 0.2, 0.75); const f1 = p.frame(d, 'WALK', 0.001, 0.75).flatMap((s) => s.pts);
    expect(f0.some((v, i) => Math.abs(v - f1[i]) > 5)).toBe(true);
    const { clips } = dollClips({ ...d, motion: { vivacity: 2 } }); const walk = clips.find((c) => c.name === 'Camminata')!;
    expect(Math.abs(walk.keys[2].pose.rot.thighR!)).toBeGreaterThan(Math.abs(dollClips(d).clips.find((c) => c.name === 'Camminata')!.keys[2].pose.rot.thighR!) * 1.5);
  });
  it('Canvas renderer draws every shape (stub context)', () => {
    const calls: string[] = [];
    const ctx = new Proxy({}, { get: (_t, k) => (typeof k === 'string' && ['save', 'restore', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'fill', 'stroke'].includes(k) ? () => calls.push(k) : undefined), set: () => true }) as unknown as CanvasRenderingContext2D;
    const shapes = buildDollShapes(createDoll(), rest);
    drawDoll(ctx, shapes, { x: 0, y: 0, scale: 0.2, outline: '#000', outlineWidth: 6 });
    expect(calls.filter((c) => c === 'fill').length).toBeGreaterThan(10);
  });
});

describe('doll data', () => {
  it('random dolls are reproducible per seed and different across seeds', () => {
    const strip = (d: Doll) => ({ ...d, id: '' });
    expect(strip(randomDoll(7))).toEqual(strip(randomDoll(7))); expect(strip(randomDoll(7))).not.toEqual(strip(randomDoll(8)));
  });
  it('migrates v3 → v4 (dolls + dollId) and round-trips a project with dolls', () => {
    const v3: any = createProject('Vecchio'); v3.schemaVersion = 3; delete v3.dolls;
    v3.environments[0].characters = [{ id: 'c', name: 'c', color: '#fff', spriteAssetId: null, spriteSheet: null, animations: [], width: .04, height: .08, speed: .12, shadow: true, startNodeId: null, abilities: [], behavior: {} }];
    const p = migrateProject(v3);
    expect(p.schemaVersion).toBe(SCHEMA_VERSION); expect(p.dolls).toEqual([]); expect(p.environments[0].characters[0].dollId).toBeNull();
    const q = createProject('Con omini'); q.dolls = [randomDoll(3)];
    expect(migrateProject(JSON.parse(JSON.stringify(q)))).toEqual(q);
  });
  it('v1 documents also reach the current schema through every step', () => {
    const v1: any = createProject('Antico'); v1.schemaVersion = 1; delete v1.customProfiles; delete v1.puppets; delete v1.dolls;
    const p = migrateProject(v1); expect(p.schemaVersion).toBe(SCHEMA_VERSION); expect(p.puppets).toEqual([]); expect(p.dolls).toEqual([]);
  });
  it('package json is tagged with its format', () => { const j = dollJson(createDoll()); expect(j.format).toBe(DOLL_FORMAT); expect(j.doll.name).toBe('Omino'); });
});
