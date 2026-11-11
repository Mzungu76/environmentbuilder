import type { EdgeType, NodeType, ObjectType, ProfileId } from '@/types';

/**
 * Profiles are CONFIGURATION, not engines. They only suggest which tools/types to surface first.
 * An environment may combine several profiles and nothing is ever restricted.
 */
export interface EnvironmentProfile {
  id: ProfileId;
  label: string;
  description: string;
  suggestedEdgeTypes: EdgeType[];
  suggestedNodeTypes: NodeType[];
  suggestedObjectTypes: ObjectType[];
}

export const PROFILES: Record<ProfileId, EnvironmentProfile> = {
  cave: { id: 'cave', label: 'Caverna', description: 'Terreno irregolare, rampe, scale e cenge.', suggestedEdgeTypes: ['walk', 'ramp', 'climb', 'curve'], suggestedNodeTypes: ['waypoint', 'junction', 'platform'], suggestedObjectTypes: ['collectible', 'observation-point', 'trigger'] },
  forest: { id: 'forest', label: 'Foresta', description: 'Sentieri tortuosi e radure.', suggestedEdgeTypes: ['walk', 'curve', 'ramp'], suggestedNodeTypes: ['waypoint', 'junction'], suggestedObjectTypes: ['collectible', 'interaction-point'] },
  building: { id: 'building', label: 'Edificio', description: 'Piani, scale e porte.', suggestedEdgeTypes: ['walk', 'stairs', 'platform-link'], suggestedNodeTypes: ['waypoint', 'entrance', 'exit'], suggestedObjectTypes: ['interaction-point', 'entrance', 'exit'] },
  ship: { id: 'ship', label: 'Nave', description: 'Ponti, scale a pioli e boccaporti.', suggestedEdgeTypes: ['walk', 'climb', 'stairs'], suggestedNodeTypes: ['waypoint', 'platform', 'entrance'], suggestedObjectTypes: ['interaction-point', 'trigger'] },
  industrial: { id: 'industrial', label: 'Industriale', description: 'Passerelle, scale e piattaforme.', suggestedEdgeTypes: ['walk', 'climb', 'stairs', 'platform-link'], suggestedNodeTypes: ['waypoint', 'platform'], suggestedObjectTypes: ['interaction-point', 'trigger'] },
  outdoor: { id: 'outdoor', label: 'Esterno', description: 'Terreno aperto e sentieri.', suggestedEdgeTypes: ['walk', 'curve', 'ramp'], suggestedNodeTypes: ['waypoint', 'junction'], suggestedObjectTypes: ['observation-point', 'collectible'] },
  custom: { id: 'custom', label: 'Personalizzato', description: 'Nessun suggerimento, massima libertà.', suggestedEdgeTypes: [], suggestedNodeTypes: [], suggestedObjectTypes: [] },
};

export const ALL_EDGE_TYPES: EdgeType[] = ['walk', 'ramp', 'climb', 'stairs', 'platform-link', 'curve'];
export const ALL_NODE_TYPES: NodeType[] = ['waypoint', 'junction', 'endpoint', 'platform', 'entrance', 'exit'];

/** Union of suggestions from the active profiles; if empty (custom) everything is suggested. */
export function suggestedTypes(profiles: ProfileId[]) {
  const edges = new Set<EdgeType>(), nodes = new Set<NodeType>();
  for (const id of profiles) { PROFILES[id]?.suggestedEdgeTypes.forEach((t) => edges.add(t)); PROFILES[id]?.suggestedNodeTypes.forEach((t) => nodes.add(t)); }
  return { edges: edges.size ? edges : new Set(ALL_EDGE_TYPES), nodes: nodes.size ? nodes : new Set(ALL_NODE_TYPES) };
}
