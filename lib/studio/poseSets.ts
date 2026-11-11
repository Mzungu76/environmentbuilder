import type { Puppet, PuppetView } from '@/types';
import type { EditorStore } from '@/lib/store/editorStore';
import { detectCells, keyBackground, crop, trim, opaqueBounds, type Img } from '@/engine/puppet/imageProc';
import { addFarLimbs, autoWeights, denseToSkin, generateMesh } from '@/engine/puppet/mesh';
import { buildRig } from '@/engine/puppet/skeleton';
import { alignLimbSides, torsoLength, TORSO_FRACTION } from '@/engine/puppet/keyposes';
import { fitPoseToSilhouette } from '@/engine/puppet/fit';
import { imgToBlob, makeView, storePuppetImage } from './pipeline';
import { putAsset } from '@/lib/persistence/db';
import { readImageFile } from '@/lib/import-export/image';
import { blobToImg } from './pipeline';

/** Mesh + automatic weights for a freshly made view (same defaults as the Mesh step). */
export function autoMesh(view: PuppetView, img: Img, cell = 14, margin = 6): PuppetView {
  const rig = buildRig(view);
  if (!rig) return view;
  const base = generateMesh(img, cell, margin);
  const skin = denseToSkin(autoWeights(base, rig, view.id, view.weightParams, img));
  const far = view.farLimbs ?? { arm: false, leg: false };
  const r = far.arm || far.leg ? addFarLimbs(base, skin, far) : { mesh: base, skin };
  return { ...view, mesh: r.mesh, skin: r.skin, farLimbs: far };
}

/**
 * Equal torso length ⇒ equal scale. The bounding-box height changes with the pose (arms up make it taller), so each frame's
 * `figureHeight` is derived from its torso length instead, using the proportion of the puppet's own profile when it has one.
 */
export function normalizeScale(frames: PuppetView[], puppet: Puppet): PuppetView[] {
  const side = puppet.views.side, st = side ? torsoLength(side) : null;
  const frac = side && st ? st / side.figureHeight : TORSO_FRACTION;
  return frames.map((f) => { const t = torsoLength(f); return t ? { ...f, figureHeight: t / frac, pivot: { ...f.pivot } } : f; });
}

export interface ImportedSheet { frames: PuppetView[]; metas: import('@/types').ImageAssetMeta[]; sourceMeta: import('@/types').ImageAssetMeta }

/** Sheet of N poses side by side → ordered key frames (background removed, figures found, skeleton proposed, mesh + weights built). */
export async function importPoseSheet(store: EditorStore, puppet: Puppet, file: File, count: number): Promise<ImportedSheet> {
  const { meta, blob } = await readImageFile(file);
  await putAsset(store.project.id, meta.id, blob);
  const raw = await blobToImg(blob);
  const keyed = keyBackground(raw, { ...puppet.keying, color: null });
  const cells = detectCells(keyed, count);
  const metas = [] as ImportedSheet['metas'];
  let frames: PuppetView[] = [];
  const imgs: Img[] = [];
  for (let i = 0; i < cells.length; i++) {
    const tr = trim(crop(keyed, cells[i]), 8);
    if (!opaqueBounds(tr.img)) throw new Error(`Non trovo la figura n. ${i + 1} nell’immagine: controlla lo sfondo o il numero di pose.`);
    const m = await storePuppetImage(store, await imgToBlob(tr.img), `${puppet.name}-climb-${i + 1}.png`, tr.img.width, tr.img.height);
    metas.push(m);
    const v = makeView('climb', tr.img, { x: cells[i].x + tr.offset.x, y: cells[i].y + tr.offset.y, w: tr.img.width, h: tr.img.height }, m.id, undefined, meta.id);
    if (!v) throw new Error(`Figura n. ${i + 1} non valida.`);
    frames.push(v); imgs.push(tr.img);
  }
  // skeleton: fit the character's own profile to each drawing's silhouette (gives joints AND scale); templates are the fallback
  const side = puppet.views.side;
  const canFit = !!side && Object.keys(side.landmarks).length >= 19;
  if (canFit) {
    for (let i = 0; i < frames.length; i++) {
      await new Promise((r) => setTimeout(r, 0));    // let the UI breathe between frames
      const fit = fitPoseToSilhouette(side!, imgs[i]);
      if (fit && fit.score >= 0.4) frames[i] = { ...frames[i], landmarks: fit.landmarks, figureHeight: side!.figureHeight * fit.scale, fitScore: fit.score };
      else frames[i] = normalizeScale([frames[i]], puppet)[0];
    }
    frames = alignLimbSides(frames);
  } else frames = normalizeScale(frames, puppet);
  frames = frames.map((f, i) => autoMesh(f, imgs[i]));
  return { frames, metas, sourceMeta: meta };
}
