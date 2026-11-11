import { describe, expect, it } from 'vitest';
import { PUPPET_FORMAT, puppetJson, validatePuppet } from '@/lib/import-export/puppetPackage';
import { createPuppet } from '@/lib/studio/pipeline';
import { newImg, opaqueBounds } from '@/engine/puppet/imageProc';
import { addFarLimbs, autoWeights, DEFAULT_WEIGHT_PARAMS, denseToSkin, generateMesh } from '@/engine/puppet/mesh';
import { bodyCenterX, buildRig, refineLandmarks, templateLandmarks } from '@/engine/puppet/skeleton';
import { defaultClips } from '@/engine/puppet/animation';
import { PuppetPlayer } from '@/engine/puppet/player';
import { RUNTIME_SOURCE } from '@/lib/generated/runtimeSource';
import { SCHEMA_VERSION, type Puppet, type ViewId } from '@/types';

function build(views: ViewId[], complete = true): Puppet {
  const img = newImg(300, 700);
  for (let y = 20; y < 690; y++) for (let x = 100; x < 200; x++) img.data[(y * 300 + x) * 4 + 3] = 255;
  const p = createPuppet('Test');
  for (const id of views) {
    const b = opaqueBounds(img)!;
    const lm = refineLandmarks(img, templateLandmarks(id, b, bodyCenterX(img, b)), id, b);
    const view = { id, crop: { x: 0, y: 0, w: 300, h: 700 }, cutoutAssetId: `a-${id}`, width: 300, height: 700, figureHeight: b.h, pivot: { x: 150, y: 690 }, landmarks: lm, mesh: null as any, skin: null as any, weightParams: DEFAULT_WEIGHT_PARAMS, ...defaultClips(id) };
    if (complete) { const rig = buildRig(view)!; const mesh = generateMesh(img, 20, 4); const skin = denseToSkin(autoWeights(mesh, rig, id, DEFAULT_WEIGHT_PARAMS, img)); const r = id === 'side' ? addFarLimbs(mesh, skin, { arm: true, leg: true }) : { mesh, skin }; view.mesh = r.mesh; view.skin = r.skin; }
    p.views[id] = view;
  }
  return p;
}

describe('puppet package', () => {
  it('validates: errors for missing parts, warnings for optional ones', () => {
    expect(validatePuppet(createPuppet('x')).errors).toContain('Nessuna vista generata.');
    const incomplete = build(['side'], false);
    expect(validatePuppet(incomplete).errors.join(' ')).toMatch(/mesh e pesi/);
    const ok = build(['side', 'front']);
    expect(validatePuppet(ok).errors).toEqual([]);
    expect(validatePuppet(ok).warnings.join(' ')).not.toMatch(/Manca la vista di profilo/);
    expect(validatePuppet(build(['front'])).warnings.join(' ')).toMatch(/Manca la vista di profilo/);
  });
  it('puppet.json uses texture paths instead of asset ids and keeps the rig data', () => {
    const j = puppetJson(build(['side', 'front'])) as any;
    expect(j.format).toBe(PUPPET_FORMAT); expect(j.schemaVersion).toBe(SCHEMA_VERSION);
    expect(j.views.side.texture).toBe('textures/side.png'); expect(j.views.side.cutoutAssetId).toBeUndefined();
    expect(j.views.side.mesh.indices.length).toBeGreaterThan(0); expect(j.views.side.skin.w.length).toBeGreaterThan(0);
    expect(JSON.parse(JSON.stringify(j)).views.front.clips.length).toBeGreaterThan(3);
  });
  it('the player picks the view, syncs the walk to the speed and returns skinned vertices', () => {
    const p = build(['side', 'front']); const pl = new PuppetPlayer();
    const idle = pl.frame(p, 'IDLE', 0, 0)!; expect(idle.viewId).toBe('front');
    const walk = pl.frame(p, 'WALK', 1 / 60, 0.75)!; expect(walk.viewId).toBe('side'); expect(walk.positions.length).toBe(walk.view.mesh!.vertices.length);
    const forced = pl.frame(p, 'WALK', 0, 0, 'front')!; expect(forced.viewId).toBe('front');
    expect(new PuppetPlayer().frame({ ...p, views: {} }, 'IDLE', 0, 0)).toBeNull();
  });
  it('the embedded runtime source exports the integration API', () => {
    for (const name of ['skinVertices', 'advancePhase', 'poseAt', 'chooseView', 'drawPuppet', 'Agent', 'migrateProject']) expect(RUNTIME_SOURCE).toContain(name);
    expect(RUNTIME_SOURCE.length).toBeGreaterThan(10000);
  });
});
