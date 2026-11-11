import type { Environment, ImageAssetMeta, LayerRole, SceneLayer } from '@/types';
import { uid } from '@/lib/ids';

/** Layer list order = draw order (back→front) within the same role. Roles: background < midground < foreground. */

export function addLayer(env: Environment, role: Exclude<LayerRole, 'background'>, meta: ImageAssetMeta): Environment {
  const layer: SceneLayer = { id: uid('layer'), name: meta.fileName, role, assetId: meta.id, visible: true, offsetX: 0, offsetY: 0, opacity: 1 };
  return { ...env, layers: [...env.layers, layer], assets: [...env.assets.filter((a) => a.id !== meta.id), meta] };
}

export function updateLayer(env: Environment, id: string, patch: Partial<SceneLayer>): Environment {
  return { ...env, layers: env.layers.map((l) => (l.id === id ? { ...l, ...patch, id: l.id } : l)) };
}

/** The background is mandatory and cannot be removed. */
export function removeLayer(env: Environment, id: string): Environment {
  const l = env.layers.find((x) => x.id === id);
  if (!l || l.role === 'background') return env;
  const layers = env.layers.filter((x) => x.id !== id);
  const used = new Set(layers.map((x) => x.assetId));
  return { ...env, layers, assets: env.assets.filter((a) => used.has(a.id) || env.objects.some((o) => o.assetId === a.id) || env.characters.some((c) => c.spriteAssetId === a.id)) };
}

/** Moves a layer one step within its own role group ('up' = towards the front). */
export function moveLayer(env: Environment, id: string, dir: 'up' | 'down'): Environment {
  const idx = env.layers.findIndex((l) => l.id === id);
  if (idx < 0) return env;
  const role = env.layers[idx].role;
  const step = dir === 'up' ? 1 : -1;
  let j = idx + step;
  while (j >= 0 && j < env.layers.length && env.layers[j].role !== role) j += step;
  if (j < 0 || j >= env.layers.length) return env;
  const layers = env.layers.slice();
  [layers[idx], layers[j]] = [layers[j], layers[idx]];
  return { ...env, layers };
}

export const ROLE_LABEL: Record<LayerRole, string> = { background: 'Sfondo', midground: 'Piano intermedio', foreground: 'Primo piano' };
