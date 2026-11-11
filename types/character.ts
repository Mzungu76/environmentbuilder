import type { Vec2 } from './navigation';

export type CharacterState = 'IDLE' | 'WALK' | 'CLIMB' | 'INTERACT' | 'COLLECT' | 'JUMP' | 'FALL' | 'CUSTOM';

export interface Animation {
  id: string;
  name: string;
  state: CharacterState;
  /** Frame indices in the sprite sheet. Empty for static sprites. */
  frames: number[];
  fps: number;
  loop: boolean;
}

export interface SpriteSheetSpec { assetId: string; frameWidth: number; frameHeight: number }

/** Character model (placeholder in M1; driven by the simulation engine from M2). */
export interface Character {
  id: string;
  name: string;
  spriteAssetId: string | null;
  spriteSheet: SpriteSheetSpec | null;
  animations: Animation[];
  /** Size relative to environment height (normalized). */
  width: number;
  height: number;
  speed: number;
  shadow: boolean;
  startNodeId: string | null;
  position: Vec2;
}
