import type { Vec2 } from './navigation';

/** Open set of generic object types. Games can register more. */
export type ObjectType =
  | 'generic' | 'collectible' | 'interaction-point' | 'observation-point'
  | 'entrance' | 'exit' | 'trigger' | (string & {});

/** 'on-arrival': runs when a character ends a route on the object's node. 'manual': offered as a button in the playtest. */
export type InteractionTrigger = 'on-arrival' | 'manual';

/** Built-in kinds: 'collect' (adds to the inventory, hides the object), 'inspect' (message), 'activate', 'custom'. Open set. */
export interface Interaction {
  id: string;
  kind: string;
  label: string;
  trigger: InteractionTrigger;
  /** Can run only once per playtest. */
  once: boolean;
  /** Abilities the character needs. */
  requires: string[];
  /** Seconds the character spends performing it (INTERACT / COLLECT state). */
  duration: number;
  /** Text shown to the player/tester. */
  message: string;
  /** Name of the event sent to the host game (see integration docs). */
  event: string;
  props: Record<string, string>;
}

export interface InteractiveObject {
  id: string;
  name: string;
  type: ObjectType;
  position: Vec2;
  width: number;
  height: number;
  assetId: string | null;
  visible: boolean;
  linkedNodeId: string | null;
  linkedEdgeId: string | null;
  interactions: Interaction[];
  props: Record<string, string>;
}

/** Entrance/Exit link an environment to another one (M3). */
export interface Entrance { id: string; name: string; objectId: string }
export interface Exit { id: string; name: string; objectId: string; targetEnvironmentId: string | null; targetEntranceId: string | null }
