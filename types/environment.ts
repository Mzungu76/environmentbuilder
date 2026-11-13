import type { NavigationGraph } from './navigation';
import type { InteractiveObject, Entrance, Exit } from './interaction';
import type { Character } from './character';

export type LayerRole = 'background' | 'midground';

export interface SceneLayer {
  id: string;
  name: string;
  role: LayerRole;
  assetId: string;
  visible: boolean;
  /** Offset, normalized to the environment size. */
  offsetX: number;
  offsetY: number;
  opacity: number;
}

/** Metadata of an imported image asset. The binary lives in IndexedDB / the ZIP archive. */
export interface ImageAssetMeta {
  id: string;
  fileName: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
}

export type BuiltinProfileId = 'cave' | 'forest' | 'building' | 'ship' | 'industrial' | 'outdoor' | 'dungeon' | 'city' | 'underwater' | 'space' | 'custom';
/** Built-in id or the id of a user-defined profile stored in the project (`Project.customProfiles`). */
export type ProfileId = BuiltinProfileId | (string & {});

/**
 * A painted area of the backdrop where characters are shown at a different size (perspective by zones). `mask` is a coverage grid
 * (one byte per cell, base64) with the grid size of the environment (`scaleGrid`); soft brush edges blend smoothly into the neighbours.
 */
export interface ScaleZone { id: string; name: string; /** 1 = normal size, 0.4 = 40% */ scale: number; color: string; mask: string }

/** Coarse colour map of the background (RGB bytes, base64): the light the character walks through. */
export interface LightMapData { w: number; h: number; data: string }

/** Something the character can find (a gem, a coin…): counted by the game, worth points. */
export interface Collectible {
  id: string;
  name: string;
  points: number;
  /** Relative probability when the game does not name the item ("a random one"). */
  weight: number;
  /** Optional icon / sprite (image asset of the environment). */
  assetId: string | null;
  color: string;
}

/** One step of the collapse: fires when the (hidden) progress of the collapse reaches `at` (0–1). */
export interface CollapseStage {
  id: string;
  at: number;
  /** Visual / audio cue the game renders: 'tremor' | 'dust' | 'rocks' | 'darken' | 'flash' | 'final' | any custom name. */
  effect: string;
  intensity: number;
  /** Optional event name sent to the game. */
  event: string;
}

/**
 * The environment is about to collapse, but not when: like a spinning top, the end comes after an unpredictable time and the
 * wobble grows irregularly (with false alarms that subside). The game gets the signals, never the remaining time.
 */
export interface CollapseConfig {
  enabled: boolean;
  /** The real duration is drawn between these (seconds). */
  minSeconds: number;
  maxSeconds: number;
  /** Strength of the wobble (0–1). */
  wobble: number;
  /** Number of early alarms (tremors that die down). */
  falseAlarms: number;
  stages: CollapseStage[];
}

/** What the game does with this environment: items to find, how long the cave holds. */
export interface GameplayConfig {
  collectibles: Collectible[];
  /** Seconds of the "pick up" action and of the celebration that follows. */
  collectSeconds: number;
  celebrateSeconds: number;
  collapse: CollapseConfig;
}

/**
 * One brush stroke of an occluder, in order. `add` paints coverage, `sub` erases it. Points are normalized (x, y pairs) to the
 * environment; `radius` is a fraction of the image HEIGHT (round on screen). Shapes (rect, ellipse, polygon, spline) are ops too.
 */
export interface OccluderStroke { kind: 'stroke'; mode: 'add' | 'sub'; radius: number; pts: number[] }
export type OccluderShapeKind = 'rect' | 'ellipse' | 'polygon' | 'spline';
/**
 * A filled geometric shape. `pts` are normalized (x, y pairs): rect and ellipse use two opposite corners of their box (x0, y0, x1, y1),
 * polygon its vertices, spline the control points of a closed smooth curve that passes through them.
 */
export interface OccluderShape { kind: 'shape'; mode: 'add' | 'sub'; shape: OccluderShapeKind; pts: number[] }
export type OccluderOp = OccluderStroke | OccluderShape;
/**
 * A part of the backdrop that can hide a character: where `ops` paint coverage, the backdrop itself is drawn again on top of the
 * characters (no extra image). `softness` 0–1 feathers the edge.
 */
export interface Occluder { id: string; name: string; color: string; softness: number; ops: OccluderOp[] }

export interface Environment {
  id: string;
  name: string;
  /** Original pixel size of the main background. All normalized coordinates refer to it. */
  width: number;
  height: number;
  profiles: ProfileId[];
  /** Order = draw order (back to front) within each role; roles are drawn background → midground. Parts of the scene in front of the characters are `occluders`, not layers. */
  layers: SceneLayer[];
  assets: ImageAssetMeta[];
  navigation: NavigationGraph;
  objects: InteractiveObject[];
  entrances: Entrance[];
  exits: Exit[];
  characters: Character[];
  /** Rules of the game for this scenario (optional). */
  gameplay?: GameplayConfig;
  /** Characters shrink with distance: scale at the top / bottom of the image (see engine/navigation/perspective). */
  perspective?: { topScale: number; bottomScale: number };
  /** Size zones painted on the backdrop (they refine / override the automatic perspective). */
  scaleZones?: ScaleZone[];
  /** Parts of the backdrop drawn over the characters (painted like the scale zones). */
  occluders?: Occluder[];
  /** 0–1: how gently the size changes across and around the painted zones (default 0.5). */
  scaleSoftness?: number;
  /** Light of the scene reproduced on the characters (see engine/game/light). */
  lighting?: { enabled: boolean; strength: number; /** cells across the map (default 256) */ precision?: number };
  lightMap?: LightMapData;
}
