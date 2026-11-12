import type { EditorStore } from '@/lib/store/editorStore';
import { putAsset } from '@/lib/persistence/db';
import { readImageFile } from './image';
import { uid } from '@/lib/ids';
import { addLayer } from '@/engine/scene/layers';
import { updateObject } from '@/engine/interaction/objects';

/**
 * Imports an image as the environment's main background (replacing the previous one).
 * Normalized coordinates are preserved, so existing nodes keep their relative position.
 */
export async function importBackground(store: EditorStore, file: File): Promise<void> {
  const { meta, blob } = await readImageFile(file);
  await putAsset(store.project.id, meta.id, blob);
  store.commitEnv((env) => {
    const old = env.layers.find((l) => l.role === 'background');
    const layers = old
      ? env.layers.map((l) => (l.id === old.id ? { ...l, assetId: meta.id, name: meta.fileName } : l))
      : [...env.layers, { id: uid('layer'), name: meta.fileName, role: 'background' as const, assetId: meta.id, visible: true, offsetX: 0, offsetY: 0, opacity: 1 }];
    const usedAssets = new Set(layers.map((l) => l.assetId));
    const assets = [...env.assets.filter((a) => usedAssets.has(a.id)), meta];
    return { ...env, width: meta.width, height: meta.height, layers, assets };
  });
}

/** Adds a mid-ground layer (the file is stored as a normal image asset). */
export async function importLayer(store: EditorStore, role: 'midground', file: File): Promise<void> {
  const { meta, blob } = await readImageFile(file);
  await putAsset(store.project.id, meta.id, blob);
  store.commitEnv((env) => addLayer(env, role, meta));
}

/** Associates an image with an interactive object; size follows the image aspect ratio. */
export async function importObjectImage(store: EditorStore, objectId: string, file: File): Promise<void> {
  const { meta, blob } = await readImageFile(file);
  await putAsset(store.project.id, meta.id, blob);
  store.commitEnv((env) => {
    const o = env.objects.find((x) => x.id === objectId);
    if (!o) return env;
    const aspect = meta.width / meta.height;
    return updateObject({ ...env, assets: [...env.assets.filter((a) => a.id !== meta.id), meta] }, objectId, { assetId: meta.id, width: Math.min(1, o.height * aspect) });
  });
}

/** Sets the character's sprite image (a static picture; configure frame size in the inspector to use it as a sprite sheet). */
export async function importCharacterSprite(store: EditorStore, characterId: string, file: File): Promise<void> {
  const { meta, blob } = await readImageFile(file);
  await putAsset(store.project.id, meta.id, blob);
  store.commitEnv((env) => ({
    ...env, assets: [...env.assets.filter((a) => a.id !== meta.id), meta],
    characters: env.characters.map((c) => (c.id === characterId ? { ...c, spriteAssetId: meta.id, spriteSheet: null } : c)),
  }));
}
