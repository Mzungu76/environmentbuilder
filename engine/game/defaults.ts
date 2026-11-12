import type { CollapseConfig, Collectible, GameplayConfig } from '@/types';
import { uid } from '@/lib/ids';

export const newCollectible = (name = 'Gemma', points = 1, color = '#4fd1c5'): Collectible => ({ id: uid('col'), name, points, weight: 1, assetId: null, color });

export function defaultCollapse(): CollapseConfig {
  return {
    enabled: false, minSeconds: 90, maxSeconds: 240, wobble: 0.6, falseAlarms: 2,
    stages: [
      { id: uid('stg'), at: 0.35, effect: 'tremor', intensity: 0.3, event: '' },
      { id: uid('stg'), at: 0.6, effect: 'dust', intensity: 0.5, event: '' },
      { id: uid('stg'), at: 0.8, effect: 'rocks', intensity: 0.8, event: '' },
      { id: uid('stg'), at: 1, effect: 'final', intensity: 1, event: 'collapse' },
    ],
  };
}

export const defaultGameplay = (): GameplayConfig => ({ collectibles: [newCollectible()], collectSeconds: 1.4, celebrateSeconds: 1.2, collapse: defaultCollapse() });
