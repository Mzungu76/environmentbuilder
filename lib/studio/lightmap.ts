import type { Environment, LightMapData } from '@/types';
import { buildLightMap } from '@/engine/game/light';
import { imgToCanvas, loadAssetImg } from './pipeline';

const ORDER: Record<string, number> = { background: 0, midground: 1, foreground: 2 };

/** Reduces the visible layers of the environment to a coarse light map (the colours the characters walk through). */
export const LIGHT_PRECISIONS = [64, 128, 256, 384, 512];
export const DEFAULT_LIGHT_PRECISION = 256;

export async function computeLightMap(projectId: string, env: Environment, precision = env.lighting?.precision ?? DEFAULT_LIGHT_PRECISION): Promise<LightMapData | null> {
  const W = Math.min(Math.max(precision * 2, 256), 1024, Math.max(32, Math.round(env.width))), k = W / env.width, H = Math.max(18, Math.round(env.height * k));
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  const layers = env.layers.filter((l) => l.visible).map((l, i) => ({ l, i })).sort((a, b) => (ORDER[a.l.role] ?? 0) - (ORDER[b.l.role] ?? 0) || a.i - b.i);
  let drawn = 0;
  for (const { l } of layers) {
    const img = await loadAssetImg(projectId, l.assetId); if (!img) continue;
    ctx.globalAlpha = l.opacity ?? 1;
    ctx.drawImage(imgToCanvas(img), l.offsetX * W, l.offsetY * H, img.width * k, img.height * k); drawn++;
  }
  ctx.globalAlpha = 1;
  if (!drawn) return null;
  const d = ctx.getImageData(0, 0, W, H);
  return buildLightMap(d.data, W, H, precision);
}
