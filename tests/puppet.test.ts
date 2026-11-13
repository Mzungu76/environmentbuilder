import { describe, expect, it } from 'vitest';
import { BONE_IDS, type PuppetView } from '@/types';
import { BONE_DEFS, boneMatrices, buildRig, mirrorLandmarks, refineLandmarks, rotAbout, templateLandmarks, bodyCenterX } from '@/engine/puppet/skeleton';
import { addFarLimbs, autoWeights, DEFAULT_WEIGHT_PARAMS, denseToSkin, generateMesh, adjacency, paintWeights, skinToDense } from '@/engine/puppet/mesh';
import { makePreset, defaultClips, samplePose, phaseRate } from '@/engine/puppet/animation';
import { skinVertices, advancePhase, chooseView, poseAt } from '@/engine/puppet/runtime';
import { newImg, opaqueBounds, type Img } from '@/engine/puppet/imageProc';

/** Synthetic front-view figure on a 400x800 cut-out: head, torso, two arms hanging away from the body, two legs. */
function figure(): Img {
  const img = newImg(400, 800);
  const rect = (x0: number, y0: number, x1: number, y1: number) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * 400 + x) * 4; img.data[i] = 120; img.data[i + 1] = 90; img.data[i + 2] = 60; img.data[i + 3] = 255; } };
  rect(180, 20, 220, 90);            // head
  rect(150, 100, 250, 330);          // torso
  rect(95, 100, 140, 420); rect(260, 100, 305, 420); // arms (separated from the torso by a gap)
  rect(155, 330, 195, 780); rect(205, 330, 245, 780); // legs
  return img;
}
function viewOf(img: Img, id: 'front' | 'side' = 'front'): PuppetView {
  const b = opaqueBounds(img)!; const cx = bodyCenterX(img, b);
  const landmarks = refineLandmarks(img, templateLandmarks(id, b, cx), id, b);
  const { clips, stateClips } = defaultClips(id);
  return { id, crop: { x: 0, y: 0, w: 400, h: 800 }, cutoutAssetId: 'a', width: 400, height: 800, figureHeight: b.h, pivot: { x: cx, y: b.y + b.h }, landmarks, mesh: null, skin: null, weightParams: DEFAULT_WEIGHT_PARAMS, clips, stateClips };
}

describe('skeleton', () => {
  it('bone definitions follow the BONE_IDS order and every bone has a valid parent before it', () => {
    expect(BONE_DEFS.map((b) => b.id)).toEqual([...BONE_IDS]);
    BONE_DEFS.forEach((b, i) => { if (b.parent) expect(BONE_IDS.indexOf(b.parent)).toBeLessThan(i); });
  });
  it('template placement tolerates a real silhouette: knees/ankles snap onto the two legs, landmarks fall inside the body', () => {
    const img = figure(); const v = viewOf(img);
    expect(v.landmarks.kneeL!.x).toBeCloseTo(175, -1); expect(v.landmarks.kneeR!.x).toBeCloseTo(225, -1);
    expect(v.landmarks.ankleL!.x).toBeLessThan(200); expect(v.landmarks.ankleR!.x).toBeGreaterThan(200);
    expect(v.landmarks.elbowL!.x).toBeLessThan(150); expect(v.landmarks.elbowR!.x).toBeGreaterThan(250);
    expect(v.landmarks.headTop!.y).toBeLessThanOrEqual(22);
    expect(buildRig(v)).not.toBeNull();
  });
  it('mirrors one side onto the other', () => {
    const m = mirrorLandmarks({ pelvis: { x: 100, y: 5 }, elbowL: { x: 60, y: 10 } }, 'L');
    expect(m.elbowR).toEqual({ x: 140, y: 10 });
  });
  it('rest pose is the identity; a rotation about a joint moves the end of the chain but not the joint', () => {
    const v = viewOf(figure()); const rig = buildRig(v)!;
    for (const m of boneMatrices(rig, { rot: {}, dx: 0, dy: 0 })) [1, 0, 0, 1, 0, 0].forEach((e, i) => expect(m[i]).toBeCloseTo(e, 6));
    const mats = boneMatrices(rig, { rot: { uarmR: 90 }, dx: 0, dy: 0 });
    const idx = BONE_IDS.indexOf('uarmR'), sh = v.landmarks.shoulderR!, wr = v.landmarks.wristR!;
    const move = (p: { x: number; y: number }) => ({ x: mats[idx][0] * p.x + mats[idx][2] * p.y + mats[idx][4], y: mats[idx][1] * p.x + mats[idx][3] * p.y + mats[idx][5] });
    expect(move(sh).x).toBeCloseTo(sh.x, 4); expect(move(sh).y).toBeCloseTo(sh.y, 4);
    const w2 = move(wr); expect(Math.hypot(w2.x - sh.x, w2.y - sh.y)).toBeCloseTo(Math.hypot(wr.x - sh.x, wr.y - sh.y), 3);
    // child bones inherit the parent's rotation (the hand follows the forearm)
    const hand = BONE_IDS.indexOf('handR'); expect(mats[hand][0]).toBeCloseTo(Math.cos(Math.PI / 2), 4);
    [1, 0, 0, 1, 0, 0].forEach((e, i) => expect(rotAbout(0, { x: 5, y: 5 })[i]).toBeCloseTo(e, 9));
  });
});

describe('mesh and weights', () => {
  const img = figure(); const view = viewOf(img);
  const mesh = generateMesh(img, 16, 4);
  it('covers the silhouette: every opaque pixel lies in a cell that has triangles', () => {
    expect(mesh.indices.length % 3).toBe(0);
    const xs = new Set<number>(); // set of covered cells
    for (let t = 0; t < mesh.indices.length; t += 3) { const i = mesh.indices[t]; xs.add(Math.floor(mesh.vertices[i * 2] / 16) + 1000 * Math.floor(mesh.vertices[i * 2 + 1] / 16)); }
    for (const [x, y] of [[200, 50], [200, 200], [110, 300], [280, 380], [175, 700], [225, 700]]) expect(xs.has(Math.floor(x / 16) + 1000 * Math.floor(y / 16))).toBe(true);
    expect(mesh.uvs.every((u) => u >= 0 && u <= 1)).toBe(true);
  });
  const rig = buildRig(view)!;
  const dense = autoWeights(mesh, rig, 'front', DEFAULT_WEIGHT_PARAMS, img);
  const dom = (x: number, y: number) => { let bi = 0, bv = -1; for (let v = 0; v < mesh.vertices.length / 2; v++) { const d = Math.hypot(mesh.vertices[v * 2] - x, mesh.vertices[v * 2 + 1] - y); if (bv < 0 || d < bv) { bv = d; bi = v; } } let best = 0; for (let b = 0; b < 15; b++) if (dense[bi * 15 + b] > dense[bi * 15 + best]) best = b; return BONE_IDS[best]; };
  it('assigns arms to arms, legs to the right leg and the head to the head', () => {
    expect(dom(280, 250)).toMatch(/arm|hand/); expect(dom(115, 250)).toMatch(/arm|hand/);
    expect(dom(225, 600)).toMatch(/^(shin|thigh|foot)R$/); expect(dom(175, 600)).toMatch(/^(shin|thigh|foot)L$/);
    expect(dom(200, 50)).toBe('head'); expect(dom(200, 230)).toMatch(/torso|pelvis/);
    for (let v = 0; v < dense.length / 15; v++) { let s = 0; for (let b = 0; b < 15; b++) s += dense[v * 15 + b]; expect(s).toBeCloseTo(1, 4); }
  });
  it('skinning: rest pose reproduces the mesh, a thigh rotation moves only the leg', () => {
    const full: PuppetView = { ...view, mesh, skin: denseToSkin(dense) };
    const rest = skinVertices(full, { rot: {}, dx: 0, dy: 0 })!;
    for (let i = 0; i < rest.length; i++) expect(rest[i]).toBeCloseTo(mesh.vertices[i], 3);
    const moved = skinVertices(full, { rot: { thighR: -40 }, dx: 0, dy: 0 })!;
    const dist = (x: number, y: number) => { let bi = 0, bd = 1e9; for (let v = 0; v < mesh.vertices.length / 2; v++) { const d = Math.hypot(mesh.vertices[v * 2] - x, mesh.vertices[v * 2 + 1] - y); if (d < bd) { bd = d; bi = v; } } return Math.hypot(moved[bi * 2] - rest[bi * 2], moved[bi * 2 + 1] - rest[bi * 2 + 1]); };
    expect(dist(225, 740)).toBeGreaterThan(60); expect(dist(200, 150)).toBeLessThan(1); expect(dist(175, 740)).toBeLessThan(3);
  });
  it('the brush reassigns weights and the 4-influence skin round-trips', () => {
    const d2 = skinToDense(denseToSkin(dense)); const adj = adjacency(mesh);
    paintWeights(d2, mesh, adj, BONE_IDS.indexOf('torso'), 175, 600, 30, 1, 'assign');
    expect(dom.length).toBeGreaterThan(0);
    let v = 0, bd = 1e9; for (let i = 0; i < mesh.vertices.length / 2; i++) { const d = Math.hypot(mesh.vertices[i * 2] - 175, mesh.vertices[i * 2 + 1] - 600); if (d < bd) { bd = d; v = i; } }
    expect(d2[v * 15 + BONE_IDS.indexOf('torso')]).toBeGreaterThan(0.9);
  });
  it('side view prefers the near limbs (R) over the far ones (L)', () => {
    const sv = viewOf(img, 'side'); const r = buildRig(sv)!;
    const dd = autoWeights(mesh, r, 'side', DEFAULT_WEIGHT_PARAMS, img);
    let near = 0, far = 0; for (let v = 0; v < mesh.vertices.length / 2; v++) if (mesh.vertices[v * 2 + 1] > 520) for (const b of ['thighR', 'shinR', 'footR']) near += dd[v * 15 + BONE_IDS.indexOf(b as never)];
    for (let v = 0; v < mesh.vertices.length / 2; v++) if (mesh.vertices[v * 2 + 1] > 520) for (const b of ['thighL', 'shinL', 'footL']) far += dd[v * 15 + BONE_IDS.indexOf(b as never)];
    expect(near).toBeGreaterThan(far);
  });
});

describe('animation', () => {
  it('interpolates keyframes and wraps looping clips', () => {
    const clip = makePreset('walk', 'side');
    const a = samplePose(clip, 0), b = samplePose(clip, 1);
    expect(b.rot.thighR).toBeCloseTo(a.rot.thighR ?? 0, 3);
    const mid = samplePose(clip, 0.25); expect(mid.rot.thighR).toBeLessThan(-20); // forward swing at a quarter cycle
    expect(samplePose(clip, 1.25).rot.thighR).toBeCloseTo(mid.rot.thighR!, 3);
  });
  it('non-looping clips hold the last pose', () => { const j = makePreset('jump', 'side'); expect(samplePose(j, 3)).toEqual(samplePose(j, 1)); });
  it('walk speed syncs to the clip cycle length (no foot sliding)', () => {
    const w = makePreset('walk', 'side');
    expect(phaseRate(w, 0.75)).toBeCloseTo(1, 5); expect(phaseRate(w, 1.5)).toBeCloseTo(2, 5);
    expect(phaseRate(w, 0)).toBeCloseTo(1 / w.duration, 5);
  });
  it('front/back walks swing the limbs less than the side walk', () => {
    expect(Math.abs(samplePose(makePreset('walk', 'front'), 0.25).rot.thighR!)).toBeLessThan(Math.abs(samplePose(makePreset('walk', 'side'), 0.25).rot.thighR!) / 2);
  });
  it('runtime helpers: state → clip, phase advance, view choice', () => {
    const v = viewOf(figure(), 'side'); const full: PuppetView = { ...v, mesh: { cell: 1, vertices: [0, 0], uvs: [0, 0], indices: [] }, skin: { idx: [0, 0, 0, 0], w: [1, 0, 0, 0] } };
    expect(poseAt(full, 'WALK', 0.25).rot.thighR).toBeLessThan(-20);
    expect(advancePhase(full, 'WALK', 0.9, 0.5, 0.75)).toBeCloseTo(((0.9 + 0.5 * 1) % 1), 5);
    expect(chooseView({ side: full, front: { ...full, id: 'front' } }, true, 'front')).toBe('side');
    expect(chooseView({ side: full, front: { ...full, id: 'front' } }, false, 'front')).toBe('front');
    expect(chooseView({ side: full, front: { ...full, id: 'front' } }, true, 'front', 'front')).toBe('front');
    expect(chooseView({}, true, 'side')).toBeNull();
  });
});

describe('far limbs (profile)', () => {
  it('adds copies of the near leg/arm bound to the far bones and drawn behind the body', () => {
    const img = figure(); const view = viewOf(img, 'side'); const rig = buildRig(view)!;
    const mesh = generateMesh(img, 16, 4);
    const skin = denseToSkin(autoWeights(mesh, rig, 'side', DEFAULT_WEIGHT_PARAMS, img));
    const r = addFarLimbs(mesh, skin, { arm: true, leg: true });
    expect(r.mesh.vertices.length).toBeGreaterThan(mesh.vertices.length);
    expect(r.skin.idx.length).toBe((r.mesh.vertices.length / 2) * 4); expect(r.mesh.uvs.length).toBe(r.mesh.vertices.length);
    expect(r.mesh.indices.length).toBeGreaterThan(mesh.indices.length);
    // the original triangles come LAST (drawn on top), the copies first
    expect(r.mesh.indices.slice(-mesh.indices.length)).toEqual(mesh.indices);
    // weights of every vertex still sum to 1; the copies use only far bones for the limb part
    const n = r.mesh.vertices.length / 2;
    for (let v = 0; v < n; v++) { let s = 0; for (let k = 0; k < 4; k++) s += r.skin.w[v * 4 + k]; expect(s).toBeCloseTo(1, 3); }
    const farIdx = new Set(['thighL', 'shinL', 'footL', 'uarmL', 'farmL', 'handL'].map((b) => BONE_IDS.indexOf(b as never)));
    let usesFar = false; for (let v = mesh.vertices.length / 2; v < n; v++) for (let k = 0; k < 4; k++) if (r.skin.w[v * 4 + k] > 0.5 && farIdx.has(r.skin.idx[v * 4 + k])) usesFar = true;
    expect(usesFar).toBe(true);
    // rotating only the far thigh moves the copy but leaves the original (near) leg untouched
    const full: PuppetView = { ...view, mesh: r.mesh, skin: r.skin };
    const rest = skinVertices(full, { rot: {}, dx: 0, dy: 0 })!, moved = skinVertices(full, { rot: { thighL: 40 }, dx: 0, dy: 0 })!;
    let origMoved = 0, copyMoved = 0;
    for (let v = 0; v < n; v++) { const d = Math.hypot(moved[v * 2] - rest[v * 2], moved[v * 2 + 1] - rest[v * 2 + 1]); if (d > 20) { if (v < mesh.vertices.length / 2) origMoved++; else copyMoved++; } }
    expect(copyMoved).toBeGreaterThan(5); expect(origMoved).toBeLessThan(copyMoved / 2);
  });
  it('does nothing when both options are off', () => { const m = generateMesh(figure(), 16, 4); const s = { idx: new Array((m.vertices.length / 2) * 4).fill(0), w: new Array((m.vertices.length / 2) * 4).fill(0).map((_, i) => (i % 4 === 0 ? 1 : 0)) }; expect(addFarLimbs(m, s, { arm: false, leg: false }).mesh).toBe(m); });
});

import { chooseViewForState, flipsWithFacing } from '@/engine/puppet/runtime';
import { PROFILE_VIEWS } from '@/types';

describe('pose views (climb / jump)', () => {
  const mkView = (id: any): PuppetView => ({ ...viewOf(figure(), 'side'), id, mesh: { cell: 1, vertices: [0, 0], uvs: [0, 0], indices: [] }, skin: { idx: [0, 0, 0, 0], w: [1, 0, 0, 0] } });
  const views = { side: mkView('side'), front: mkView('front'), climb: mkView('climb'), jump: mkView('jump') };
  it('picks the view from the state: climb → climb view, jump/fall → jump view, otherwise the usual choice', () => {
    expect(chooseViewForState(views, 'CLIMB', 'front')).toBe('climb');
    expect(chooseViewForState(views, 'JUMP', 'front')).toBe('jump');
    expect(chooseViewForState(views, 'FALL', 'front')).toBe('jump');
    expect(chooseViewForState(views, 'WALK', 'front')).toBe('side');
    expect(chooseViewForState(views, 'IDLE', 'front')).toBe('front');
    expect(chooseViewForState(views, 'CLIMB', 'front', 'front')).toBe('front'); // an explicit hint wins
    expect(chooseViewForState({ side: views.side }, 'CLIMB', 'side')).toBe('side'); // no climb view → profile
    expect(chooseViewForState({ side: { ...views.side, mesh: null } }, 'WALK', 'side')).toBeNull();
  });
  it('mirrors profile and jump views when facing left; front, back and climb stay put unless overridden', () => {
    expect(flipsWithFacing({ id: 'side' })).toBe(true); expect(flipsWithFacing({ id: 'jump' })).toBe(true);
    expect(flipsWithFacing({ id: 'front' })).toBe(false); expect(flipsWithFacing({ id: 'climb' })).toBe(false);
    expect(flipsWithFacing({ id: 'climb', flipWithFacing: true })).toBe(true);
    expect(PROFILE_VIEWS).toEqual(['side', 'climb', 'jump']);
  });
  it('default clips: climb view animates CLIMB, jump view animates JUMP and FALL, both have IDLE; motions stay small', () => {
    const c = defaultClips('climb'), j = defaultClips('jump');
    expect(c.stateClips.CLIMB && c.stateClips.IDLE).toBeTruthy(); expect(c.stateClips.JUMP).toBeUndefined();
    expect(j.stateClips.JUMP && j.stateClips.FALL && j.stateClips.IDLE).toBeTruthy();
    const climb = c.clips.find((x) => x.id === c.stateClips.CLIMB)!;
    for (const k of climb.keys) for (const v of Object.values(k.pose.rot)) expect(Math.abs(v!)).toBeLessThan(25); // around the rest pose, not a full cycle
    expect(climb.cycleLength).toBeGreaterThan(0);
  });
  it('pose templates place the arms above the head for climbing and in front for jumping', () => {
    const img = figure(); const b = opaqueBounds(img)!;
    const climb = templateLandmarks('climb', b, 200), jump = templateLandmarks('jump', b, 200);
    expect(climb.wristR!.y).toBeLessThan(climb.neck!.y); expect(Object.keys(climb)).toHaveLength(19);
    expect(jump.wristR!.x).toBeGreaterThan(jump.shoulderR!.x + 50); expect(jump.kneeR!.x).toBeGreaterThan(jump.hipR!.x);
  });
});
