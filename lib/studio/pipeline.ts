import type { ImageAssetMeta, Puppet, PuppetView, Rect, ViewId } from '@/types';
import type { EditorStore } from '@/lib/store/editorStore';
import { getAsset, putAsset, deleteAsset } from '@/lib/persistence/db';
import { uid } from '@/lib/ids';
import { DEFAULT_KEYING, keyBackground, newImg, opaqueBounds, type Img } from '@/engine/puppet/imageProc';
import { DEFAULT_WEIGHT_PARAMS } from '@/engine/puppet/mesh';
import { defaultClips } from '@/engine/puppet/animation';
import { bodyCenterX, refineLandmarks, templateLandmarks } from '@/engine/puppet/skeleton';

/** Browser-side glue: decoding/encoding images and keeping puppet documents + assets in sync. */

export async function blobToImg(blob: Blob): Promise<Img> {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, bmp.width, bmp.height);
  bmp.close?.();
  return { data: d.data, width: d.width, height: d.height };
}

export function imgToCanvas(img: Img, canvas?: HTMLCanvasElement): HTMLCanvasElement {
  const c = canvas ?? document.createElement('canvas');
  if (c.width !== img.width) c.width = img.width;
  if (c.height !== img.height) c.height = img.height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return c;
}

export const imgToBlob = (img: Img): Promise<Blob> => new Promise((res, rej) => imgToCanvas(img).toBlob((b) => (b ? res(b) : rej(new Error('Codifica PNG non riuscita'))), 'image/png'));

// small cache of decoded assets (pixel data) so steps do not decode the same PNG repeatedly
const cache = new Map<string, Promise<Img | null>>();
export function loadAssetImg(projectId: string, assetId: string): Promise<Img | null> {
  const key = `${projectId}:${assetId}`;
  let p = cache.get(key);
  if (!p) { p = getAsset(projectId, assetId).then((b) => (b ? blobToImg(b) : null)).catch(() => null); cache.set(key, p); if (cache.size > 24) cache.delete(cache.keys().next().value as string); }
  return p;
}
export const forgetAsset = (projectId: string, assetId: string) => cache.delete(`${projectId}:${assetId}`);

export function createPuppet(name: string): Puppet {
  return { id: uid('pup'), name, source: null, keying: { ...DEFAULT_KEYING }, views: {}, idleView: 'front', assets: [] };
}

export const puppetOf = (store: EditorStore, id: string | null) => store.project.puppets.find((p) => p.id === id);

/** Document updates. 'live' = no undo step (drags); call store.checkpoint() once before a gesture. */
export function updatePuppet(store: EditorStore, id: string, fn: (p: Puppet) => Puppet, mode: 'commit' | 'live' = 'commit') {
  const apply = (pr: typeof store.project) => ({ ...pr, puppets: pr.puppets.map((p) => (p.id === id ? fn(p) : p)) });
  if (mode === 'commit') store.commitProject(apply); else store.updateProject(apply);
}

/** Stores a PNG as an asset of the puppet; returns its metadata. */
export async function storePuppetImage(store: EditorStore, blob: Blob, name: string, width: number, height: number): Promise<ImageAssetMeta> {
  const meta: ImageAssetMeta = { id: uid('asset'), fileName: name, mime: 'image/png', width, height, bytes: blob.size };
  await putAsset(store.project.id, meta.id, blob);
  return meta;
}

/** Removes puppet assets no longer referenced (called after replacing images). */
export async function pruneAssets(store: EditorStore, puppetId: string) {
  const p = puppetOf(store, puppetId);
  if (!p) return;
  const used = new Set<string>([p.source?.assetId, ...Object.values(p.views).flatMap((v) => [v?.cutoutAssetId, v?.sourceAssetId])].filter(Boolean) as string[]);
  const stale = p.assets.filter((a) => !used.has(a.id));
  if (!stale.length) return;
  for (const a of stale) { await deleteAsset(store.project.id, a.id).catch(() => {}); forgetAsset(store.project.id, a.id); }
  updatePuppet(store, puppetId, (pp) => ({ ...pp, assets: pp.assets.filter((a) => used.has(a.id)) }), 'live');
}

/** Source sheet with the background removed using the puppet's keying parameters (cached by parameters). */
const sheetCache = new Map<string, Img>();
export async function processedSheet(projectId: string, puppet: Puppet): Promise<{ processed: Img; source: Img } | null> {
  if (!puppet.source) return null;
  const source = await loadAssetImg(projectId, puppet.source.assetId);
  if (!source) return null;
  const key = `${puppet.source.assetId}|${JSON.stringify(puppet.keying)}`;
  let processed = sheetCache.get(key);
  if (!processed) { processed = keyBackground(source, puppet.keying); sheetCache.set(key, processed); if (sheetCache.size > 4) sheetCache.delete(sheetCache.keys().next().value as string); }
  return { processed, source };
}

/**
 * Builds a view from a trimmed cut-out: measures the figure, places the feet pivot, proposes the skeleton (model proportions
 * snapped to the silhouette) and keeps the clips/weight settings of the view it replaces.
 */
export function makeView(id: ViewId, trimmed: Img, crop: Rect, cutoutAssetId: string, old?: PuppetView, sourceAssetId?: string): PuppetView | null {
  const b = opaqueBounds(trimmed);
  if (!b) return null;
  let sx = 0, n = 0;
  for (let y = Math.max(b.y, b.y + b.h - Math.max(4, Math.round(b.h * 0.04))); y < b.y + b.h; y++) for (let x = 0; x < trimmed.width; x++) if (trimmed.data[(y * trimmed.width + x) * 4 + 3] > 24) { sx += x; n++; }
  const clips = old?.clips?.length ? { clips: old.clips, stateClips: old.stateClips } : defaultClips(id);
  return {
    id, crop, sourceAssetId, cutoutAssetId, width: trimmed.width, height: trimmed.height, figureHeight: b.h,
    pivot: { x: n ? sx / n : b.x + b.w / 2, y: b.y + b.h },
    landmarks: refineLandmarks(trimmed, templateLandmarks(id, b, bodyCenterX(trimmed, b, id)), id, b),
    mesh: null, skin: null, farLimbs: old?.farLimbs, flipWithFacing: old?.flipWithFacing,
    weightParams: old?.weightParams ?? { ...DEFAULT_WEIGHT_PARAMS }, ...clips,
  };
}

export const emptyRect = (): Rect => ({ x: 0, y: 0, w: 0, h: 0 });
export { newImg };
