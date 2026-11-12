import type { EditorStore } from '@/lib/store/editorStore';
import type { PaperSetup, Puppet, PuppetView } from '@/types';

export type PaperKind = 'side' | 'front' | 'back';
export const PAPER_LABEL: Record<PaperKind, string> = { side: 'Profilo', front: 'Fronte', back: 'Retro' };
/** The setup (sheet + corrections) of a paper view. */
export const setupOf = (p: Puppet, kind: PaperKind): PaperSetup | undefined => (kind === 'side' ? p.paper : p.paperViews?.[kind]);
import { keyBackground } from '@/engine/puppet/imageProc';
import { assemble, assembleFrontal, buildPaperMesh, extractPieces, DEFAULT_PAPER, type Pieces } from '@/engine/puppet/paperpuppet';
import { DEFAULT_MANIKIN } from '@/engine/puppet/manikin';
import { DEFAULT_WEIGHT_PARAMS } from '@/engine/puppet/mesh';
import { defaultClips } from '@/engine/puppet/animation';
import { readImageFile } from '@/lib/import-export/image';
import { putAsset } from '@/lib/persistence/db';
import { blobToImg, imgToBlob, loadAssetImg, pruneAssets, storePuppetImage, updatePuppet } from './pipeline';

/**
 * "Burattino di carta": sheet of separate parts → assembled side view whose drawn mesh is the set of rigid parts
 * (the view's manikin), so every existing step, clip, Playtest and export works on it.
 */
export const defaultSetup = (sheetAssetId: string): PaperSetup => ({ sheetAssetId, adjust: {}, farShade: DEFAULT_PAPER.farShade });

export const assembleSetup = (pieces: Pieces, setup: PaperSetup, kind: PaperKind = 'side') => (kind === 'side' ? assemble(pieces, { farShade: setup.farShade, adjust: setup.adjust }) : assembleFrontal(pieces, { farShade: setup.farShade, adjust: setup.adjust }, kind));

/** Parts of a stored sheet (background removed with the puppet's keying; colour auto-detected). */
export async function loadPieces(projectId: string, puppet: Puppet, kind: PaperKind = 'side'): Promise<{ pieces: Pieces; warnings: string[] } | null> {
  const id = setupOf(puppet, kind)?.sheetAssetId; if (!id) return null;
  const raw = await loadAssetImg(projectId, id); if (!raw) return null;
  return extractPieces(keyBackground(raw, { ...puppet.keying, color: null }));
}

/** Builds the view for a setup and writes it (images as new assets) into the puppet, keeping the clips and weight settings. */
export async function commitPaper(store: EditorStore, puppetId: string, pieces: Pieces, setup: PaperSetup, kind: PaperKind = 'side'): Promise<void> {
  const puppet = store.project.puppets.find((p) => p.id === puppetId); if (!puppet) return;
  const asm = assembleSetup(pieces, setup, kind), built = buildPaperMesh(asm, 6, 2, setup.soft ?? 0.5);
  const cut = await storePuppetImage(store, await imgToBlob(asm.cutout), `${puppet.name}-burattino-${kind}.png`, asm.cutout.width, asm.cutout.height);
  const atlas = await storePuppetImage(store, await imgToBlob(built.atlas), `${puppet.name}-burattino-atlante-${kind}.png`, built.atlas.width, built.atlas.height);
  updatePuppet(store, puppetId, (p) => {
    const old = p.views[kind];
    const view: PuppetView = {
      id: kind, crop: { x: 0, y: 0, w: asm.cutout.width, h: asm.cutout.height }, sourceAssetId: setup.sheetAssetId, cutoutAssetId: cut.id,
      width: asm.cutout.width, height: asm.cutout.height, figureHeight: asm.figureHeight, pivot: asm.pivot, landmarks: asm.landmarks, mesh: null, skin: null,
      manikin: { enabled: true, atlasAssetId: atlas.id, width: built.atlas.width, height: built.atlas.height, mesh: built.mesh, skin: built.skin, params: { ...DEFAULT_MANIKIN } },
      weightParams: old?.weightParams ?? { ...DEFAULT_WEIGHT_PARAMS }, ...(old?.clips?.length ? { clips: old.clips, stateClips: old.stateClips } : defaultClips('side')),
    };
    const next = { ...p, assets: [...p.assets, cut, atlas], views: { ...p.views, [kind]: view } };
    if (kind === 'side') return { ...next, paper: setup, idleView: p.views.front ? p.idleView : 'side' };
    return { ...next, paperViews: { ...(p.paperViews ?? {}), [kind]: setup }, idleView: kind === 'front' ? 'front' : p.idleView };
  });
  await pruneAssets(store, puppetId);
}

export async function importPaperSheet(store: EditorStore, puppet: Puppet, file: File, kind: PaperKind = 'side'): Promise<{ warnings: string[]; parts: number }> {
  const { meta, blob } = await readImageFile(file);
  const raw = await blobToImg(blob);
  const ex = extractPieces(keyBackground(raw, { ...puppet.keying, color: null }));   // throws readable errors
  await putAsset(store.project.id, meta.id, blob);
  const setup = defaultSetup(meta.id);
  assembleSetup(ex.pieces, setup, kind);                                               // throws if a part is missing
  if (kind === 'side') updatePuppet(store, puppet.id, (p) => ({ ...p, source: { assetId: meta.id, width: meta.width, height: meta.height }, assets: [...p.assets, meta], views: { ...(p.views.front ? { front: p.views.front } : {}), ...(p.views.back ? { back: p.views.back } : {}) }, poseSets: undefined, paper: setup }));
  else updatePuppet(store, puppet.id, (p) => ({ ...p, assets: [...p.assets, meta], paperViews: { ...(p.paperViews ?? {}), [kind]: setup } }));
  await commitPaper(store, puppet.id, ex.pieces, setup, kind);
  return { warnings: ex.warnings, parts: Object.keys(ex.pieces).length };
}
