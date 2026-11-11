import type { EditorStore } from '@/lib/store/editorStore';
import { putAsset } from '@/lib/persistence/db';
import { readImageFile } from './image';
import { uid } from '@/lib/ids';

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
