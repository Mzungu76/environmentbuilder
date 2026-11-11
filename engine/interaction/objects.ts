import type { Entrance, Environment, Exit, InteractiveObject, ObjectType, Project, Vec2 } from '@/types';
import { uid } from '@/lib/ids';
import { clamp01 } from '@/engine/navigation/geometry';

/** Generic object types. The list is open: any string is accepted as a type, these are just the built-ins. */
export const OBJECT_TYPES: { id: ObjectType; label: string; color: number }[] = [
  { id: 'generic', label: 'Oggetto generico', color: 0x9ca3af },
  { id: 'collectible', label: 'Raccoglibile', color: 0xfacc15 },
  { id: 'interaction-point', label: 'Punto di interazione', color: 0x60a5fa },
  { id: 'observation-point', label: 'Punto di osservazione', color: 0xc084fc },
  { id: 'entrance', label: 'Ingresso', color: 0x22c55e },
  { id: 'exit', label: 'Uscita', color: 0xef4444 },
  { id: 'trigger', label: 'Trigger', color: 0xfb923c },
];
export const objectTypeInfo = (t: ObjectType) => OBJECT_TYPES.find((o) => o.id === t) ?? { id: t, label: t, color: 0xd4d4d4 };

/** Size is in fractions of the ENVIRONMENT HEIGHT (like characters); position is the object's centre (normalized). */
export function createObject(type: ObjectType, pos: Vec2, existing: number): InteractiveObject {
  const isDoor = type === 'entrance' || type === 'exit';
  return {
    id: uid('obj'), name: `${objectTypeInfo(type).label} ${existing + 1}`, type,
    position: { x: clamp01(pos.x), y: clamp01(pos.y) }, width: isDoor ? 0.07 : 0.06, height: isDoor ? 0.1 : 0.06,
    assetId: null, visible: true, linkedNodeId: null, linkedEdgeId: null, interactions: [], props: {},
  };
}

/**
 * Entrance/Exit records are derived from objects of type 'entrance'/'exit'; this keeps them consistent
 * after every object mutation (stable record ids per object, targets preserved, dangling targets cleared).
 */
export function syncRecords(env: Environment, allEnvs?: Environment[]): Environment {
  const entrances: Entrance[] = [];
  const exits: Exit[] = [];
  for (const o of env.objects) {
    if (o.type === 'entrance') entrances.push(env.entrances.find((e) => e.objectId === o.id) ?? { id: uid('ent'), name: o.name, objectId: o.id });
    if (o.type === 'exit') exits.push(env.exits.find((e) => e.objectId === o.id) ?? { id: uid('exit'), name: o.name, objectId: o.id, targetEnvironmentId: null, targetEntranceId: null });
  }
  const named = <T extends { objectId: string; name: string }>(r: T): T => ({ ...r, name: env.objects.find((o) => o.id === r.objectId)?.name ?? r.name });
  let res = { ...env, entrances: entrances.map(named), exits: exits.map(named) };
  if (allEnvs) res = { ...res, exits: res.exits.map((x) => validTarget(allEnvs, x) ? x : { ...x, targetEnvironmentId: x.targetEnvironmentId && allEnvs.some((e) => e.id === x.targetEnvironmentId) ? x.targetEnvironmentId : null, targetEntranceId: null }) };
  return res;
}
function validTarget(envs: Environment[], x: Exit) {
  if (!x.targetEnvironmentId) return true;
  const t = envs.find((e) => e.id === x.targetEnvironmentId);
  return !!t && (!x.targetEntranceId || t.entrances.some((en) => en.id === x.targetEntranceId));
}

export const addObject = (env: Environment, o: InteractiveObject) => syncRecords({ ...env, objects: [...env.objects, o] });
export const updateObject = (env: Environment, id: string, patch: Partial<InteractiveObject>) =>
  syncRecords({ ...env, objects: env.objects.map((o) => (o.id === id ? { ...o, ...patch, id: o.id } : o)) });
export const removeObject = (env: Environment, id: string) => syncRecords({ ...env, objects: env.objects.filter((o) => o.id !== id) });

/** Removes the references to deleted nodes/edges from objects (no dangling links). */
export function cleanObjectLinks(env: Environment): Environment {
  const nodes = new Set(env.navigation.nodes.map((n) => n.id)), edges = new Set(env.navigation.edges.map((e) => e.id));
  let changed = false;
  const objects = env.objects.map((o) => {
    const ln = o.linkedNodeId && !nodes.has(o.linkedNodeId) ? null : o.linkedNodeId;
    const le = o.linkedEdgeId && !edges.has(o.linkedEdgeId) ? null : o.linkedEdgeId;
    if (ln !== o.linkedNodeId || le !== o.linkedEdgeId) { changed = true; return { ...o, linkedNodeId: ln, linkedEdgeId: le }; }
    return o;
  });
  return changed ? { ...env, objects } : env;
}

export function nearestNodeId(env: Environment, p: Vec2, maxPx = Infinity): string | null {
  let best: string | null = null, bd = maxPx;
  for (const n of env.navigation.nodes) {
    const d = Math.hypot((n.x - p.x) * env.width, (n.y - p.y) * env.height);
    if (d <= bd) { bd = d; best = n.id; }
  }
  return best;
}

/** The navigation node an object is attached to: its explicit link, otherwise the closest node. */
export function nodeForObject(env: Environment, o: InteractiveObject): string | null {
  if (o.linkedNodeId && env.navigation.nodes.some((n) => n.id === o.linkedNodeId)) return o.linkedNodeId;
  // doors stand on the ground: their reference point is the base, not the centre
  const base = o.type === 'entrance' || o.type === 'exit' ? { x: o.position.x, y: o.position.y + o.height / 2 } : o.position;
  return nearestNodeId(env, base);
}

export interface ExitResolution { exit: Exit; targetEnv: Environment; entranceObj: InteractiveObject; entranceNodeId: string }

/** If `nodeId` of `env` is where an exit lies, returns where it leads (null when unlinked or the destination is incomplete). */
export function resolveExit(project: Project, env: Environment, nodeId: string): ExitResolution | null {
  for (const x of env.exits) {
    const obj = env.objects.find((o) => o.id === x.objectId);
    if (!obj || nodeForObject(env, obj) !== nodeId || !x.targetEnvironmentId || !x.targetEntranceId) continue;
    const targetEnv = project.environments.find((e) => e.id === x.targetEnvironmentId);
    const ent = targetEnv?.entrances.find((e) => e.id === x.targetEntranceId);
    const entranceObj = targetEnv?.objects.find((o) => o.id === ent?.objectId);
    if (!targetEnv || !entranceObj) continue;
    const entranceNodeId = nodeForObject(targetEnv, entranceObj);
    if (entranceNodeId) return { exit: x, targetEnv, entranceObj, entranceNodeId };
  }
  return null;
}

/** Nodes that act as exits (autonomous characters never pick them as destination). */
export function exitNodeIds(env: Environment): Set<string> {
  const s = new Set<string>();
  for (const x of env.exits) { const o = env.objects.find((q) => q.id === x.objectId); const n = o && nodeForObject(env, o); if (n) s.add(n); }
  return s;
}

export function objectIssues(project: Project, env: Environment): { id: string; message: string }[] {
  const out: { id: string; message: string }[] = [];
  for (const x of env.exits) {
    const o = env.objects.find((q) => q.id === x.objectId);
    if (!o) continue;
    if (!x.targetEnvironmentId || !x.targetEntranceId) out.push({ id: o.id, message: `L’uscita “${o.name}” non ha una destinazione.` });
    else if (!resolveExit(project, env, nodeForObject(env, o) ?? '')) out.push({ id: o.id, message: `L’uscita “${o.name}” non è collegata a un nodo valido o ha una destinazione incompleta.` });
  }
  return out;
}
