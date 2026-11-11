/** Navigation graph model. All coordinates are NORMALIZED (0..1) against the environment's original image size. */

export interface Vec2 { x: number; y: number }

/** Open set: new node types can be added without touching the engine. */
export type NodeType = 'waypoint' | 'junction' | 'endpoint' | 'platform' | 'entrance' | 'exit' | (string & {});

export type EdgeType = 'walk' | 'ramp' | 'climb' | 'stairs' | 'platform-link' | 'curve' | 'jump' | 'fall' | 'teleport' | (string & {});

/** 'both' = bidirectional; 'forward' = from→to only; 'backward' = to→from only. */
export type EdgeDirection = 'both' | 'forward' | 'backward';

export type EdgeGeometry =
  | { kind: 'line' }
  /** Cubic Bézier. Control points are absolute normalized coordinates. */
  | { kind: 'bezier'; c1: Vec2; c2: Vec2 };

export interface NavigationNode {
  id: string;
  name: string;
  x: number;
  y: number;
  type: NodeType;
  props: Record<string, string>;
}

export interface NavigationEdge {
  id: string;
  from: string;
  to: string;
  type: EdgeType;
  geometry: EdgeGeometry;
  direction: EdgeDirection;
  /** Speed multiplier applied to the character's base speed. */
  speed: number;
  /** Free-form movement requirements (e.g. "can-climb"). Evaluated by the simulation engine (M2). */
  requirements: string[];
  props: Record<string, string>;
}

export interface NavigationGraph {
  nodes: NavigationNode[];
  edges: NavigationEdge[];
}
