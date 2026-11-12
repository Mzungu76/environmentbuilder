import { describe, expect, it } from 'vitest';
import { assemble, assembleFrontal, buildPaperMesh, extractPieces, jointsOf } from '@/engine/puppet/paperpuppet';
import { newImg, type Img } from '@/engine/puppet/imageProc';
import { BONE_IDS } from '@/types';

function rect(img: Img, x0: number, y0: number, w: number, h: number, c: [number, number, number]) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const i = (y * img.width + x) * 4; img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255; }
}
/** Sheet like the AI's: top row head/torso/pelvis/backpack, bottom row arm/forearm/hand/thigh/shin/foot. Positions are NOT on a grid. */
function sheet(drop?: string): Img {
  const s = newImg(1400, 1000);
  const top: [string, number, number, number, number][] = [['head', 40, 90, 200, 240], ['torso', 300, 70, 180, 340], ['pelvis', 560, 120, 190, 200], ['acc', 820, 100, 210, 300]];
  const bot: [string, number, number, number, number][] = [['uarm', 50, 560, 90, 230], ['farm', 220, 580, 80, 210], ['hand', 380, 600, 80, 130], ['thigh', 520, 540, 110, 290], ['shin', 700, 545, 100, 295], ['foot', 880, 640, 180, 120]];
  for (const [n, x, y, w, h] of [...top, ...bot]) if (n !== drop) rect(s, x, y, w, h, [(x / 6) % 255, (y / 4) % 255, 90]);
  return s;
}

describe('paper puppet', () => {
  it('finds the 9 parts + the accessory even when they are not on a fixed grid', () => {
    const r = extractPieces(sheet());
    expect(Object.keys(r.pieces).sort()).toEqual(['accA', 'farm', 'foot', 'hand', 'head', 'pelvis', 'shin', 'thigh', 'torso', 'uarm'].sort());
    expect(r.pieces.head!.width).toBe(200 + 6); expect(r.pieces.thigh!.height).toBe(290 + 6);   // exact size + 3px margin each side
    expect(r.pieces.foot!.width).toBeGreaterThan(r.pieces.foot!.height);
  });
  it('explains what is wrong when parts are missing', () => {
    expect(() => extractPieces(sheet('shin'))).toThrow(/riga bassa|pezzi/);
    expect(() => extractPieces(newImg(100, 100))).toThrow(/nessun pezzo/);
  });
  it('limb joints are the centres of the rounded ends, inside the piece', () => {
    const p = extractPieces(sheet()).pieces, j = jointsOf('thigh', p.thigh!);
    expect(j.prox.y).toBeLessThan(j.dist.y); expect(j.prox.y).toBeGreaterThan(3); expect(j.dist.y).toBeLessThan(p.thigh!.height);
    expect(Math.abs(j.prox.x - p.thigh!.width / 2)).toBeLessThan(4);
  });
  it('assembles a standing figure: head over torso over pelvis over legs, far limbs behind, joints chained', () => {
    const a = assemble(extractPieces(sheet()).pieces), L = a.landmarks;
    expect(L.headTop!.y).toBeLessThan(L.neck!.y); expect(L.neck!.y).toBeLessThan(L.pelvis!.y); expect(L.pelvis!.y).toBeLessThan(L.hipR!.y);
    expect(L.hipR!.y).toBeLessThan(L.kneeR!.y); expect(L.kneeR!.y).toBeLessThan(L.ankleR!.y); expect(L.shoulderR!.y).toBeLessThan(L.elbowR!.y); expect(L.elbowR!.y).toBeLessThan(L.wristR!.y);
    expect(L.toeR!.x).toBeGreaterThan(L.ankleR!.x);                                     // toes point right
    expect(a.placed.findIndex((p) => p.far && p.id === 'thigh')).toBeLessThan(a.placed.findIndex((p) => p.id === 'torso'));
    expect(a.placed.findIndex((p) => !p.far && p.id === 'uarm')).toBeGreaterThan(a.placed.findIndex((p) => p.id === 'torso'));
    expect(a.cutout.width).toBeGreaterThan(100); expect(a.figureHeight).toBeGreaterThan(500);
    expect(Object.keys(L)).toHaveLength(19);
  });
  it('rigid-part mesh: every vertex skinned to exactly one bone, valid UVs and indices', () => {
    const a = assemble(extractPieces(sheet()).pieces), b = buildPaperMesh(a), n = b.mesh.vertices.length / 2;
    expect(b.mesh.uvs.length).toBe(n * 2); expect(b.skin.idx.length).toBe(n * 4); expect(Math.max(...b.mesh.indices)).toBeLessThan(n);
    expect(b.mesh.uvs.every((u) => u >= 0 && u <= 1)).toBe(true);
    for (let i = 0; i < n; i++) { expect(b.skin.w[i * 4]).toBe(1); expect(b.skin.idx[i * 4]).toBeLessThan(BONE_IDS.length); }
    expect(new Set(b.parts.map((p) => p.bone)).size).toBe(15);                           // all bones have a part
    expect(b.atlas.width).toBeLessThanOrEqual(1100);
  });
  it('manual adjustments: moving a piece moves its children (not its parent); z bias reorders; far limbs follow', () => {
    const pieces = extractPieces(sheet()).pieces, base = assemble(pieces), moved = assemble(pieces, { farShade: 0.3, adjust: { uarm: { dx: 20, dy: 10, z: 0 }, head: { dx: -8, dy: 0, z: 0 } } });
    expect(moved.landmarks.elbowR!.x - base.landmarks.elbowR!.x).toBeCloseTo(20, 3);     // the forearm hangs from the moved arm…
    expect(moved.landmarks.wristR!.y - base.landmarks.wristR!.y).toBeCloseTo(10, 3);
    expect(moved.landmarks.shoulderR).toEqual(base.landmarks.shoulderR);                  // …but the shoulder (parent joint) stays
    expect(moved.landmarks.headTop!.x - base.landmarks.headTop!.x).toBeCloseTo(-8, 3);
    expect(moved.landmarks.hipR).toEqual(base.landmarks.hipR);
    const farBase = base.placed.find((p) => p.far && p.id === 'uarm')!, farMoved = moved.placed.find((p) => p.far && p.id === 'uarm')!;
    expect(farMoved.x - farBase.x).toBeCloseTo(20, 3);
    const idx = (a: typeof base, id: string) => a.placed.findIndex((p) => !p.far && p.id === id);
    const back = assemble(pieces, { farShade: 0.3, adjust: { uarm: { dx: 0, dy: 0, z: -8 } } });
    expect(idx(back, 'uarm')).toBeLessThan(idx(back, 'torso'));                           // pushed behind the torso
    expect(idx(base, 'uarm')).toBeGreaterThan(idx(base, 'torso'));
  });
  it('accessories: the backpack sticks out behind the torso, the strap lies on it', () => {
    const a = assemble(extractPieces(sheet()).pieces), tor = a.placed.find((p) => p.id === 'torso')!, pack = a.placed.find((p) => p.id === 'accA')!;
    expect(pack.x).toBeLessThan(tor.x);                                                   // starts behind (left of) the torso
    expect(pack.x + pack.img.width).toBeLessThan(tor.x + tor.img.width * 0.6);            // and only overlaps it a little
  });
  it('frontal assembly: mirrored limbs, shoulders and hips left/right of the body, backpack over the torso only from the back', () => {
    const pieces = extractPieces(sheet()).pieces, f = assembleFrontal(pieces, { farShade: 0.3 }, 'front'), b = assembleFrontal(pieces, { farShade: 0.3 }, 'back'), L = f.landmarks;
    expect(L.shoulderL!.x).toBeLessThan(L.neck!.x); expect(L.shoulderR!.x).toBeGreaterThan(L.neck!.x);
    expect(L.hipL!.x).toBeLessThan(L.hipR!.x); expect(L.kneeL!.y).toBeGreaterThan(L.hipL!.y); expect(L.ankleR!.y).toBeGreaterThan(L.kneeR!.y);
    expect(Math.abs((L.shoulderL!.x + L.shoulderR!.x) / 2 - L.neck!.x)).toBeLessThan(30);       // symmetric about the neck
    expect(Object.keys(L)).toHaveLength(19);
    const bones = new Set(f.placed.map((p) => p.bone)); expect(bones.size).toBe(15);
    expect(f.placed.every((p) => !p.far)).toBe(true);                                         // no darkened copies: both sides are drawn
    const idx = (a: typeof f, id: string) => a.placed.findIndex((p) => p.id === id);
    expect(idx(f, 'accA')).toBeLessThan(idx(f, 'torso')); expect(idx(b, 'accA')).toBeGreaterThan(idx(b, 'torso'));
    const m = buildPaperMesh(f), n = m.mesh.vertices.length / 2; expect(m.skin.idx.length).toBe(n * 4);
  });
  it('frontal sheets with limbs on two rows: left limbs are their own pieces (not mirrored) and move independently', () => {
    const s2 = newImg(1400, 1200);
    const top: [number, number, number, number][] = [[40, 90, 200, 240], [300, 70, 250, 340], [600, 120, 240, 200], [900, 100, 210, 300]];
    for (const [x, y, w, h] of top) rect(s2, x, y, w, h, [(x / 6) % 255, 120, 90]);
    const limbs: [number, number, number][] = [[50, 90, 230], [220, 80, 210], [380, 80, 130], [520, 110, 290], [700, 100, 295], [880, 180, 120]];
    limbs.forEach(([x, w, h]) => rect(s2, x, 520, w, h, [40, (x / 5) % 255, 200]));                  // right row
    limbs.forEach(([x, w, h], i) => rect(s2, x, 900, w + (i === 0 ? 30 : 0), h, [200, (x / 5) % 255, 40]));   // left row: the upper arm is wider → not a mirror
    const ex = extractPieces(s2);
    expect(ex.pieces.uarmL).toBeDefined(); expect(ex.pieces.uarmL!.width).toBe(120 + 6); expect(ex.pieces.uarm!.width).toBe(90 + 6);
    const f = assembleFrontal(ex.pieces, { farShade: 0.3 }, 'front'), base = f.placed;
    const uR = base.find((p) => p.bone === 'uarmR')!, uL = base.find((p) => p.bone === 'uarmL')!;
    expect(uL.img.width).toBe(126); expect(uR.img.width).toBe(96);                              // each side uses its own drawing
    const moved = assembleFrontal(ex.pieces, { farShade: 0.3, adjust: { 'uarm:L': { dx: 15, dy: 8, z: 0 } } }, 'front');
    const rel = (a: typeof f, k: 'elbowL' | 'elbowR') => a.landmarks[k]!.x - a.landmarks.neck!.x;        // the canvas origin may shift when a piece moves, so measure from the neck
    expect(rel(moved, 'elbowL') - rel(f, 'elbowL')).toBeCloseTo(15, 3); expect(rel(moved, 'elbowR')).toBeCloseTo(rel(f, 'elbowR'), 3);   // only the left arm moved
    expect(buildPaperMesh(moved).parts.length).toBe(base.length);
  });
});
