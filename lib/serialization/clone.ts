import type { Environment, Project } from '@/types';
import { uid } from '@/lib/ids';

/**
 * Deep copy of an environment with FRESH ids everywhere (env, nodes, edges, objects, layers, characters,
 * entrances/exits) and all internal references remapped. Image assets are shared (same asset ids).
 * Exits keep pointing at the same external targets; entrances of the copy are new and unreferenced.
 */
export function duplicateEnvironment(src: Environment, name: string): Environment {
  const nodeMap = new Map(src.navigation.nodes.map((n) => [n.id, uid('node')]));
  const edgeMap = new Map(src.navigation.edges.map((e) => [e.id, uid('edge')]));
  const objMap = new Map(src.objects.map((o) => [o.id, uid('obj')]));
  const entMap = new Map(src.entrances.map((e) => [e.id, uid('ent')]));
  const nm = (id: string | null) => (id ? nodeMap.get(id) ?? null : null);
  const em = (id: string | null) => (id ? edgeMap.get(id) ?? null : null);
  const copy = structuredClone(src);
  return {
    ...copy, id: uid('env'), name,
    navigation: {
      nodes: copy.navigation.nodes.map((n) => ({ ...n, id: nodeMap.get(n.id)! })),
      edges: copy.navigation.edges.map((e) => ({ ...e, id: edgeMap.get(e.id)!, from: nodeMap.get(e.from)!, to: nodeMap.get(e.to)! })),
    },
    objects: copy.objects.map((o) => ({ ...o, id: objMap.get(o.id)!, linkedNodeId: nm(o.linkedNodeId), linkedEdgeId: em(o.linkedEdgeId) })),
    entrances: copy.entrances.map((e) => ({ ...e, id: entMap.get(e.id)!, objectId: objMap.get(e.objectId)! })),
    exits: copy.exits.map((x) => ({ ...x, id: uid('exit'), objectId: objMap.get(x.objectId)! })),
    layers: copy.layers.map((l) => ({ ...l, id: uid('layer') })),
    characters: copy.characters.map((c) => ({ ...c, id: uid('char'), startNodeId: nm(c.startNodeId) })),
  };
}

/** Next free "Name N" style label. */
export function uniqueName(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base;
  const root = base.replace(/\s+\d+$/, '');
  for (let i = 2; ; i++) { const n = `${root} ${i}`; if (!existing.includes(n)) return n; }
}

export const projectEnvNames = (p: Project) => p.environments.map((e) => e.name);
