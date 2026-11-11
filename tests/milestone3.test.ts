import { describe, expect, it } from 'vitest';
import { createProject, createEnvironment } from '@/lib/serialization/factory';
import { duplicateEnvironment, uniqueName } from '@/lib/serialization/clone';
import { addObject, cleanObjectLinks, createObject, exitNodeIds, nodeForObject, objectIssues, removeObject, resolveExit, syncRecords, updateObject } from '@/engine/interaction/objects';
import { addLayer, moveLayer, removeLayer, updateLayer } from '@/engine/scene/layers';
import { addEdge, addNode, createEdge, createNode, removeNode } from '@/engine/navigation/graph';
import { createCharacter } from '@/engine/characters/factory';
import { migrateProject } from '@/lib/serialization/migrations';
import { hitTest } from '@/engine/navigation/hit';
import type { Environment, ImageAssetMeta } from '@/types';

const meta = (id: string): ImageAssetMeta => ({ id, fileName: id + '.png', mime: 'image/png', width: 100, height: 100, bytes: 1 });
function env2() {
  const a = createEnvironment('A'), b = createEnvironment('B');
  for (const e of [a, b]) { e.width = 2000; e.height = 1000; }
  const mk = (e: Environment, x: number) => { const n = createNode(x, 0.5); e.navigation = addNode(e.navigation, n); return n; };
  const a1 = mk(a, 0.2), a2 = mk(a, 0.8); a.navigation = addEdge(a.navigation, createEdge(a1.id, a2.id));
  const b1 = mk(b, 0.3);
  return { a, b, a1, a2, b1 };
}

describe('objects', () => {
  it('creates entrance/exit records and keeps them in sync', () => {
    const { a } = env2();
    let e = addObject(a, createObject('exit', { x: 0.8, y: 0.5 }, 0));
    expect(e.exits).toHaveLength(1);
    const id = e.objects[0].id;
    e = updateObject(e, id, { name: 'Porta' });
    expect(e.exits[0].name).toBe('Porta');
    e = updateObject(e, id, { type: 'generic' });
    expect(e.exits).toHaveLength(0);
    e = updateObject(e, id, { type: 'entrance' });
    expect(e.entrances).toHaveLength(1);
    expect(removeObject(e, id).entrances).toHaveLength(0);
  });
  it('clears links to deleted nodes', () => {
    const { a, a1 } = env2();
    let e = addObject(a, { ...createObject('generic', { x: 0.2, y: 0.5 }, 0), linkedNodeId: a1.id });
    e = { ...e, navigation: removeNode(e.navigation, a1.id) };
    expect(cleanObjectLinks(e).objects[0].linkedNodeId).toBeNull();
  });
  it('attaches an object to its linked or nearest node', () => {
    const { a, a1, a2 } = env2();
    const o = createObject('exit', { x: 0.78, y: 0.55 }, 0);
    expect(nodeForObject(a, o)).toBe(a2.id);
    expect(nodeForObject(a, { ...o, linkedNodeId: a1.id })).toBe(a1.id);
  });
  it('resolves an exit to the target environment entrance node', () => {
    const { a, b, a2, b1 } = env2();
    let ea = addObject(a, createObject('exit', { x: 0.8, y: 0.5 }, 0));
    let eb = addObject(b, createObject('entrance', { x: 0.3, y: 0.5 }, 0));
    const p = createProject(); p.environments = [ea, eb];
    expect(resolveExit(p, ea, a2.id)).toBeNull(); // no destination yet
    expect(objectIssues(p, ea)).toHaveLength(1);
    ea = { ...ea, exits: [{ ...ea.exits[0], targetEnvironmentId: eb.id, targetEntranceId: eb.entrances[0].id }] };
    p.environments = [ea, eb];
    const r = resolveExit(p, ea, a2.id)!;
    expect(r.targetEnv.id).toBe(eb.id); expect(r.entranceNodeId).toBe(b1.id);
    expect(exitNodeIds(ea).has(a2.id)).toBe(true);
    expect(objectIssues(p, ea)).toHaveLength(0);
  });
  it('drops exit targets whose entrance no longer exists', () => {
    const { a, b } = env2();
    let eb = addObject(b, createObject('entrance', { x: 0.3, y: 0.5 }, 0));
    let ea = addObject(a, createObject('exit', { x: 0.8, y: 0.5 }, 0));
    ea = { ...ea, exits: [{ ...ea.exits[0], targetEnvironmentId: eb.id, targetEntranceId: eb.entrances[0].id }] };
    eb = removeObject(eb, eb.objects[0].id);
    expect(syncRecords(ea, [ea, eb]).exits[0].targetEntranceId).toBeNull();
  });
  it('hit-tests objects and prefers the topmost', () => {
    const { a } = env2();
    const e = addObject(a, createObject('generic', { x: 0.5, y: 0.5 }, 0));
    const ctx = { graph: e.navigation, envW: 2000, envH: 1000, pxPerScreenPx: 1, objects: e.objects };
    expect(hitTest({ x: 0.5, y: 0.5 }, ctx)).toEqual({ kind: 'object', id: e.objects[0].id });
    expect(hitTest({ x: 0.5, y: 0.9 }, ctx)).toBeNull();
  });
});

describe('layers', () => {
  it('adds, reorders within role, hides and protects the background', () => {
    let e = createEnvironment();
    e.layers = [{ id: 'bg', name: 'bg', role: 'background', assetId: 'a0', visible: true, offsetX: 0, offsetY: 0, opacity: 1 }];
    e = addLayer(e, 'midground', meta('m1')); e = addLayer(e, 'foreground', meta('f1')); e = addLayer(e, 'midground', meta('m2'));
    const ids = e.layers.map((l) => l.assetId);
    expect(ids).toEqual(['a0', 'm1', 'f1', 'm2']);
    const m2 = e.layers[3].id;
    e = moveLayer(e, m2, 'down'); // swaps with m1, skipping foreground
    expect(e.layers.map((l) => l.assetId)).toEqual(['a0', 'm2', 'f1', 'm1']);
    expect(moveLayer(e, m2, 'down')).toBe(e); // already at the back of its role
    e = updateLayer(e, m2, { visible: false, offsetX: 0.1 });
    expect(e.layers.find((l) => l.id === m2)!.visible).toBe(false);
    expect(removeLayer(e, 'bg')).toBe(e);
    expect(removeLayer(e, m2).layers).toHaveLength(3);
  });
});

describe('environments', () => {
  it('duplicates with fresh ids and remapped references', () => {
    const { a, a1 } = env2();
    let e = addObject(a, { ...createObject('exit', { x: 0.8, y: 0.5 }, 0), linkedNodeId: a1.id });
    const c = createCharacter(0, a1.id); e = { ...e, characters: [c] };
    const d = duplicateEnvironment(e, 'A copia');
    expect(d.id).not.toBe(e.id);
    const ids = new Set([...e.navigation.nodes, ...e.navigation.edges, ...e.objects, ...e.characters].map((x) => x.id));
    for (const x of [...d.navigation.nodes, ...d.navigation.edges, ...d.objects, ...d.characters]) expect(ids.has(x.id)).toBe(false);
    const nodeIds = new Set(d.navigation.nodes.map((n) => n.id));
    expect(d.navigation.edges.every((x) => nodeIds.has(x.from) && nodeIds.has(x.to))).toBe(true);
    expect(nodeIds.has(d.objects[0].linkedNodeId!)).toBe(true);
    expect(nodeIds.has(d.characters[0].startNodeId!)).toBe(true);
    expect(d.exits[0].objectId).toBe(d.objects[0].id);
    expect(e.name).toBe('A'); // original untouched
  });
  it('generates unique names', () => {
    expect(uniqueName('Ambiente 1', ['Ambiente 1'])).toBe('Ambiente 2');
    expect(uniqueName('Ambiente 1', ['Ambiente 1', 'Ambiente 2'])).toBe('Ambiente 3');
  });
  it('round-trips a multi-environment project through JSON', () => {
    const { a, b } = env2();
    const ea = addObject(a, createObject('exit', { x: 0.8, y: 0.5 }, 0)), eb = addObject(b, createObject('entrance', { x: 0.3, y: 0.5 }, 0));
    const p = createProject(); p.environments = [ea, eb]; p.activeEnvironmentId = eb.id;
    expect(migrateProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });
});
