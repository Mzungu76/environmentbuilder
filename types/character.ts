export type CharacterState = 'IDLE' | 'WALK' | 'CLIMB' | 'INTERACT' | 'COLLECT' | 'JUMP' | 'FALL' | 'CUSTOM';

export interface Animation {
  id: string;
  name: string;
  state: CharacterState;
  /** Frame indices in the sprite sheet. Empty = procedural/static. */
  frames: number[];
  fps: number;
  loop: boolean;
}

export interface SpriteSheetSpec { assetId: string; frameWidth: number; frameHeight: number }

export type MovementMode = 'manual' | 'autonomous';

/** Autonomous-movement configuration. All durations in seconds, probabilities in 0..1. */
export interface CharacterBehavior {
  mode: MovementMode;
  pauseMin: number;
  pauseMax: number;
  /** Chance to stop briefly at each intermediate node of a route. */
  stopProbability: number;
  /** Chance, at every decision tick while walking, to turn back along the current path. */
  turnProbability: number;
  /** Seconds between "turn back?" decisions. */
  decisionInterval: number;
  /** Preference per edge type: >1 preferred, <1 avoided, 0 never chosen autonomously. */
  edgeWeights: Record<string, number>;
}

/**
 * Character model. Independent from any specific game: sprite/animations are optional,
 * a procedural placeholder is drawn when no asset is set.
 * `width`/`height` are fractions of the ENVIRONMENT HEIGHT; `speed` is environment-heights per second.
 */
export interface Character {
  id: string;
  name: string;
  color: string;
  spriteAssetId: string | null;
  spriteSheet: SpriteSheetSpec | null;
  animations: Animation[];
  width: number;
  height: number;
  speed: number;
  shadow: boolean;
  startNodeId: string | null;
  /** Rigged character from the Studio used instead of sprite/placeholder (schema v3). */
  puppetId?: string | null;
  /** Procedural "omino" used when no puppet is set (schema v4). */
  dollId?: string | null;
  /** Abilities matched against edge requirements (e.g. "can-climb"). */
  abilities: string[];
  behavior: CharacterBehavior;
}
