import { describe, expect, it } from 'vitest';
import { createProject } from '@/lib/serialization/factory';
import { migrateProject, SchemaError } from '@/lib/serialization/migrations';
import { SCHEMA_VERSION } from '@/types';
import { addEdge, addNode, createEdge, createNode } from '@/engine/navigation/graph';

describe('serialization', () => {
  it('round-trips a project through JSON without losing graph data', () => {
    const p = createProject('X');
    const a = createNode(0.2, 0.3), b = createNode(0.8, 0.7);
    let nav = addNode(addNode(p.environments[0].navigation, a), b);
    nav = addEdge(nav, { ...createEdge(a.id, b.id, 'ramp'), speed: 1.5, direction: 'forward', geometry: { kind: 'bezier', c1: { x: 0.3, y: 0.1 }, c2: { x: 0.6, y: 0.9 } } });
    p.environments[0].navigation = nav;
    const back = migrateProject(JSON.parse(JSON.stringify(p)));
    expect(back).toEqual(p);
    expect(back.schemaVersion).toBe(SCHEMA_VERSION);
  });
  it('rejects invalid / newer documents', () => {
    expect(() => migrateProject(null)).toThrow(SchemaError);
    expect(() => migrateProject({ schemaVersion: SCHEMA_VERSION + 1 })).toThrow(/newer schema/);
    expect(() => migrateProject({ schemaVersion: 1, id: 'p', environments: [{ name: 'e' }] })).toThrow(SchemaError);
  });
});
