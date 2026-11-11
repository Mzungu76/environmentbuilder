import type { Character, CharacterBehavior } from '@/types';
import { uid } from '@/lib/ids';

export const DEFAULT_BEHAVIOR: CharacterBehavior = {
  mode: 'manual', pauseMin: 1, pauseMax: 3, stopProbability: 0.15, turnProbability: 0.1, decisionInterval: 3, edgeWeights: {},
};

const PALETTE = ['#4f8cff', '#f5b84a', '#3ecf8e', '#f0616d', '#c084fc', '#2dd4bf'];

export function createCharacter(index: number, startNodeId: string | null): Character {
  return {
    id: uid('char'), name: `Personaggio ${index + 1}`, color: PALETTE[index % PALETTE.length],
    spriteAssetId: null, spriteSheet: null,
    animations: (['IDLE', 'WALK', 'CLIMB'] as const).map((state) => ({ id: uid('anim'), name: state.toLowerCase(), state, frames: [], fps: 8, loop: true })),
    width: 0.04, height: 0.08, speed: 0.12, shadow: true, startNodeId, abilities: [],
    behavior: { ...DEFAULT_BEHAVIOR, edgeWeights: {} },
  };
}
