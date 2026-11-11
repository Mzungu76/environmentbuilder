import { describe, expect, it } from 'vitest';
import { migrateProject } from '@/lib/serialization/migrations';
import { createProject } from '@/lib/serialization/factory';
import { SCHEMA_VERSION } from '@/types';
import { createEnvironment } from '@/lib/serialization/factory';
import { addEdge, addNode, createEdge, createNode, emptyGraph, updateEdge } from '@/engine/navigation/graph';
import { createCharacter } from '@/engine/characters/factory';
import { Agent } from '@/engine/simulation/Agent';
import { getMovementType, registerMovementType } from '@/engine/movement/movementTypes';
import { allProfiles, suggestedTypes } from '@/engine/profiles';

function line(type: string, props: Record<string, string> = {}) {
  const env = createEnvironment(); env.width = 1000; env.height = 1000;
  const a = createNode(0.1, 0.5), b = createNode(0.9, 0.5); // 800px
  let g = addNode(addNode(emptyGraph(), a), b);
  g = addEdge(g, { ...createEdge(a.id, b.id, type), props });
  env.navigation = g;
  const c = createCharacter(0, a.id); c.speed = 0.4; // 400 px/s
  return { env, a, b, ag: new Agent(env, c) };
}
const run = (ag: Agent, sec: number) => { for (let t = 0; t < sec; t += 1 / 60) ag.step(1 / 60); };

describe('schema migration v1 → v2', () => {
  it('upgrades a v1 document (no customProfiles, thin interactions)', () => {
    const v1: any = createProject('Vecchio');
    v1.schemaVersion = 1; delete v1.customProfiles;
    v1.environments[0].objects = [{ id: 'o1', name: 'x', type: 'generic', position: { x: .5, y: .5 }, width: .1, height: .1, assetId: null, visible: true, linkedNodeId: null, linkedEdgeId: null, interactions: [{ id: 'i1', kind: 'collect', props: {} }], props: {} }];
    const p = migrateProject(v1);
    expect(p.schemaVersion).toBe(SCHEMA_VERSION);
    expect(p.customProfiles).toEqual([]);
    const i = p.environments[0].objects[0].interactions[0];
    expect(i).toMatchObject({ kind: 'collect', trigger: 'manual', once: false, requires: [], duration: 1, message: '', event: '' });
  });
});

describe('movement types', () => {
  it('jump uses the JUMP state and lifts the character in an arc', () => {
    const { b, ag } = line('jump'); ag.goTo(b.id);
    let maxLift = 0, sawJump = false;
    for (let i = 0; i < 240; i++) { ag.step(1 / 60); const s = ag.snapshot(); maxLift = Math.max(maxLift, s.lift); if (s.state === 'JUMP') sawJump = true; }
    expect(sawJump).toBe(true); expect(maxLift).toBeGreaterThan(50);
    expect(ag.snapshot().lift).toBe(0); // lands
  });
  it('fall accelerates: slower start than end, FALL state', () => {
    const { b, ag } = line('fall'); ag.goTo(b.id);
    run(ag, 0.2); const early = ag.snapshot();
    expect(early.state).toBe('FALL');
    const speed0 = early.speedPx;
    run(ag, 1.8); expect(ag.snapshot().speedPx).toBeGreaterThan(speed0 * 1.5);
  });
  it('teleport takes a fixed duration regardless of distance and speed', () => {
    const { b, ag } = line('teleport'); ag.goTo(b.id);
    run(ag, 0.3); expect(ag.snapshot().nodeId).toBe(b.id);
  });
  it('edge props.duration overrides the travel time of any type', () => {
    const { b, ag } = line('walk', { duration: '4' }); ag.goTo(b.id);
    run(ag, 3.5); expect(ag.snapshot().nodeId).toBeNull();
    run(ag, 0.7); expect(ag.snapshot().nodeId).toBe(b.id);
  });
  it('is extensible without touching the engine', () => {
    registerMovementType({ id: 'swim', label: 'Nuoto', state: 'CUSTOM', color: 0x00ffff, speedProfile: () => 0.5 });
    expect(getMovementType('swim').state).toBe('CUSTOM');
    const { env, a, b } = line('swim');
    const ag = new Agent(env, { ...createCharacter(0, a.id), speed: 0.4 }); ag.goTo(b.id); run(ag, 3);
    expect(ag.snapshot().nodeId).toBeNull(); // half speed: 800px @200px/s = 4s
    run(ag, 1.2); expect(ag.snapshot().nodeId).toBe(b.id);
  });
  it('plain walking is unchanged', () => {
    const { b, ag } = line('walk'); ag.goTo(b.id); run(ag, 2.1);
    expect(ag.snapshot().nodeId).toBe(b.id);
  });
});

describe('profiles', () => {
  it('provides built-in and project profiles', () => {
    const custom = [{ id: 'mine', label: 'Mio', description: '', suggestedEdgeTypes: ['teleport'], suggestedNodeTypes: [], suggestedObjectTypes: ['trigger'] }];
    expect(allProfiles(custom).some((p) => p.id === 'underwater')).toBe(true);
    const s = suggestedTypes(['mine', 'dungeon'], custom);
    expect(s.edges.has('teleport') && s.edges.has('fall')).toBe(true);
    expect(suggestedTypes(['custom']).edges.has('jump')).toBe(true); // custom = everything
  });
});

import { framesToText, parseFrames, spriteFor } from '@/engine/characters/sprites';
import { availableInteractions, createRuntimeState, newInteraction, performInteraction } from '@/engine/interaction/system';
import { addObject, createObject } from '@/engine/interaction/objects';

describe('sprites', () => {
  it('parses and prints frame lists', () => {
    expect(parseFrames('0-3, 7, x, 9-8')).toEqual([0, 1, 2, 3, 7]);
    expect(framesToText([0, 1, 2, 3, 7, 9, 10])).toBe('0-3, 7, 9, 10');
  });
  it('falls back to IDLE and to a static frame', () => {
    const c = createCharacter(0, null);
    expect(spriteFor(c, 'WALK')).toBeNull(); // no image
    c.spriteAssetId = 'a'; c.spriteSheet = { assetId: 'a', frameWidth: 32, frameHeight: 32 };
    expect(spriteFor(c, 'WALK')!.frames).toEqual([0]);
    c.animations = [{ id: '1', name: 'idle', state: 'IDLE', frames: [2, 3], fps: 4, loop: true }, { id: '2', name: 'walk', state: 'WALK', frames: [4, 5, 6], fps: 10, loop: true }];
    expect(spriteFor(c, 'WALK')!.frames).toEqual([4, 5, 6]);
    expect(spriteFor(c, 'JUMP')!.frames).toEqual([2, 3]);
  });
});

describe('interactions', () => {
  function scene() {
    const { env, a, b } = line('walk');
    const obj = { ...createObject('collectible', { x: 0.9, y: 0.5 }, 0), linkedNodeId: b.id, name: 'Gemma', interactions: [newInteraction('collect'), { ...newInteraction('inspect'), requires: ['can-read'] }] };
    return { env: addObject(env, obj), obj, b };
  }
  it('are never triggered by proximity: only at the object node, by trigger type', () => {
    const { env, a, b } = (() => { const s = scene(); return { env: s.env, a: s.env.navigation.nodes[0], b: s.b }; })();
    const rt = createRuntimeState();
    expect(availableInteractions(env, a.id, [], rt)).toHaveLength(0); // elsewhere
    expect(availableInteractions(env, b.id, [], rt)).toHaveLength(1); // requires-gated one hidden
    expect(availableInteractions(env, b.id, ['can-read'], rt)).toHaveLength(2);
    expect(availableInteractions(env, b.id, ['can-read'], rt, 'on-arrival')).toHaveLength(1);
    expect(availableInteractions(env, b.id, ['can-read'], rt, 'manual')).toHaveLength(1);
  });
  it('collect fills the inventory, hides the object and runs once', () => {
    const { env, b } = scene();
    const rt = createRuntimeState(); const ch = createCharacter(0, b.id);
    const av = availableInteractions(env, b.id, [], rt, 'on-arrival')[0];
    const out = performInteraction(env, av, ch, rt, 1.5);
    expect(out.state).toBe('COLLECT'); expect(out.message).toBe('Raccolto: Gemma');
    expect(rt.inventory).toEqual({ Gemma: 1 }); expect(rt.collected.has(av.object.id)).toBe(true);
    expect(rt.events[0]).toMatchObject({ type: 'interaction', kind: 'collect', objectName: 'Gemma' });
    expect(availableInteractions(env, b.id, [], rt)).toHaveLength(0);
  });
  it('queued actions make the agent stand still in the action state', () => {
    const { env, a, b } = line('walk');
    const ag = new Agent(env, createCharacter(0, b.id));
    ag.queueAction('COLLECT', 0.5); ag.step(1 / 60);
    expect(ag.snapshot().state).toBe('COLLECT'); expect(ag.snapshot().acting).toBe(true);
    run(ag, 0.6); expect(ag.snapshot().acting).toBe(false);
    ag.step(1 / 60); expect(ag.snapshot().state).toBe('IDLE');
    void a;
  });
});
