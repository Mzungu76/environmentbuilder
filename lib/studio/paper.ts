import type { EditorStore } from '@/lib/store/editorStore';
import type { Puppet, PuppetView } from '@/types';
import { keyBackground } from '@/engine/puppet/imageProc';
import { assemble, buildPaperMesh, extractPieces, DEFAULT_PAPER } from '@/engine/puppet/paperpuppet';
import { DEFAULT_MANIKIN } from '@/engine/puppet/manikin';
import { DEFAULT_WEIGHT_PARAMS } from '@/engine/puppet/mesh';
import { defaultClips } from '@/engine/puppet/animation';
import { readImageFile } from '@/lib/import-export/image';
import { putAsset } from '@/lib/persistence/db';
import { blobToImg, imgToBlob, pruneAssets, storePuppetImage, updatePuppet } from './pipeline';

/**
 * "Burattino di carta": sheet of separate parts → assembled side view whose drawn mesh is the set of rigid parts
 * (the view's manikin), so every existing step, clip, Playtest and export works on it.
 */
export async function importPaperSheet(store: EditorStore, puppet: Puppet, file: File): Promise<{ warnings: string[]; parts: number }> {
  const { meta, blob } = await readImageFile(file);
  const raw = await blobToImg(blob);
  const keyed = keyBackground(raw, { ...puppet.keying, color: null });
  const ex = extractPieces(keyed);                       // throws readable errors
  const asm = assemble(ex.pieces, DEFAULT_PAPER);
  const built = buildPaperMesh(asm);
  await putAsset(store.project.id, meta.id, blob);
  const cut = await storePuppetImage(store, await imgToBlob(asm.cutout), `${puppet.name}-burattino.png`, asm.cutout.width, asm.cutout.height);
  const atlas = await storePuppetImage(store, await imgToBlob(built.atlas), `${puppet.name}-burattino-atlante.png`, built.atlas.width, built.atlas.height);
  const view: PuppetView = {
    id: 'side', crop: { x: 0, y: 0, w: asm.cutout.width, h: asm.cutout.height }, sourceAssetId: meta.id, cutoutAssetId: cut.id,
    width: asm.cutout.width, height: asm.cutout.height, figureHeight: asm.figureHeight, pivot: asm.pivot, landmarks: asm.landmarks,
    mesh: null, skin: null,
    manikin: { enabled: true, atlasAssetId: atlas.id, width: built.atlas.width, height: built.atlas.height, mesh: built.mesh, skin: built.skin, params: { ...DEFAULT_MANIKIN } },
    weightParams: { ...DEFAULT_WEIGHT_PARAMS }, ...defaultClips('side'),
  };
  updatePuppet(store, puppet.id, (p) => ({
    ...p, source: { assetId: meta.id, width: meta.width, height: meta.height }, assets: [...p.assets, meta, cut, atlas],
    views: { side: view }, idleView: 'side', poseSets: undefined,
  }));
  await pruneAssets(store, puppet.id);
  return { warnings: ex.warnings, parts: built.parts.length };
}
