import type { CustomProfile, EdgeType, NodeType, ObjectType, ProfileId } from '@/types';
import { movementTypes } from '@/engine/movement/movementTypes';

/**
 * Profiles are CONFIGURATION, not engines. They only suggest which tools/types to surface first.
 * An environment may combine several profiles and nothing is ever restricted.
 * Built-ins live here; users can define more per project (`Project.customProfiles`).
 */
export interface EnvironmentProfile {
  id: ProfileId;
  label: string;
  description: string;
  suggestedEdgeTypes: EdgeType[];
  suggestedNodeTypes: NodeType[];
  suggestedObjectTypes: ObjectType[];
  builtin?: boolean;
}

const P = (id: string, label: string, description: string, e: EdgeType[], n: NodeType[], o: ObjectType[]): EnvironmentProfile =>
  ({ id, label, description, suggestedEdgeTypes: e, suggestedNodeTypes: n, suggestedObjectTypes: o, builtin: true });

export const PROFILES: Record<string, EnvironmentProfile> = Object.fromEntries([
  P('cave', 'Caverna', 'Terreno irregolare, rampe, scale, cenge e cadute.', ['walk', 'ramp', 'climb', 'curve', 'jump', 'fall'], ['waypoint', 'junction', 'platform'], ['collectible', 'observation-point', 'trigger']),
  P('forest', 'Foresta', 'Sentieri tortuosi e radure.', ['walk', 'curve', 'ramp', 'jump'], ['waypoint', 'junction'], ['collectible', 'interaction-point']),
  P('building', 'Edificio', 'Piani, scale e porte.', ['walk', 'stairs', 'platform-link'], ['waypoint', 'entrance', 'exit'], ['interaction-point', 'entrance', 'exit']),
  P('ship', 'Nave', 'Ponti, scale a pioli e boccaporti.', ['walk', 'climb', 'stairs'], ['waypoint', 'platform', 'entrance'], ['interaction-point', 'trigger']),
  P('industrial', 'Industriale', 'Passerelle, scale e piattaforme.', ['walk', 'climb', 'stairs', 'platform-link'], ['waypoint', 'platform'], ['interaction-point', 'trigger']),
  P('outdoor', 'Esterno', 'Terreno aperto e sentieri.', ['walk', 'curve', 'ramp'], ['waypoint', 'junction'], ['observation-point', 'collectible']),
  P('dungeon', 'Dungeon', 'Corridoi, botole, trappole e teletrasporti.', ['walk', 'stairs', 'fall', 'teleport'], ['waypoint', 'junction', 'entrance', 'exit'], ['collectible', 'trigger', 'interaction-point']),
  P('city', 'Città', 'Strade, marciapiedi, scale e ingressi agli edifici.', ['walk', 'stairs', 'ramp', 'platform-link'], ['waypoint', 'junction', 'entrance', 'exit'], ['interaction-point', 'observation-point', 'entrance', 'exit']),
  P('underwater', 'Subacqueo', 'Percorsi curvi e correnti: movimento fluido.', ['curve', 'walk', 'climb'], ['waypoint', 'junction'], ['collectible', 'observation-point']),
  P('space', 'Spazio', 'Moduli, portelli e teletrasporti.', ['walk', 'climb', 'teleport', 'platform-link'], ['waypoint', 'platform', 'entrance', 'exit'], ['interaction-point', 'trigger', 'collectible']),
  P('custom', 'Personalizzato', 'Nessun suggerimento, massima libertà.', [], [], []),
].map((p) => [p.id, p]));

export const toProfile = (c: CustomProfile): EnvironmentProfile => ({ ...c });

/** Built-ins followed by the project's own profiles. */
export function allProfiles(custom: CustomProfile[] = []): EnvironmentProfile[] {
  return [...Object.values(PROFILES), ...custom.map(toProfile)];
}

/** Every edge type the editor knows: the movement-type registry (extensible). */
export const allEdgeTypes = (): EdgeType[] => movementTypes().map((t) => t.id);
export const ALL_EDGE_TYPES: EdgeType[] = allEdgeTypes();
export const ALL_NODE_TYPES: NodeType[] = ['waypoint', 'junction', 'endpoint', 'platform', 'entrance', 'exit'];

/** Union of suggestions from the active profiles; if none suggests anything (custom) everything is suggested. */
export function suggestedTypes(profiles: ProfileId[], custom: CustomProfile[] = []) {
  const edges = new Set<EdgeType>(), nodes = new Set<NodeType>(), objects = new Set<ObjectType>();
  const all = allProfiles(custom);
  for (const id of profiles) {
    const p = all.find((x) => x.id === id);
    p?.suggestedEdgeTypes.forEach((t) => edges.add(t)); p?.suggestedNodeTypes.forEach((t) => nodes.add(t)); p?.suggestedObjectTypes.forEach((t) => objects.add(t));
  }
  return { edges: edges.size ? edges : new Set(allEdgeTypes()), nodes: nodes.size ? nodes : new Set(ALL_NODE_TYPES), objects };
}
