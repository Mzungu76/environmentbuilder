import type { Vec2 } from './navigation';

/** Open set of generic object types. Games can register more. */
export type ObjectType =
  | 'generic' | 'collectible' | 'interaction-point' | 'observation-point'
  | 'entrance' | 'exit' | 'trigger' | (string & {});

export interface Interaction {
  id: string;
  /** Free-form verb understood by the host game (e.g. "collect", "inspect"). */
  kind: string;
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
