import type { Character, CharacterState, Environment, InteractiveObject, Interaction, InteractionTrigger } from '@/types';
import { nodeForObject } from './objects';
import { uid } from '@/lib/ids';

/**
 * Interaction system. Nothing happens just because a character walks past an object:
 * an interaction runs only when the character ENDS a route on the object's node ('on-arrival')
 * or when the tester/host triggers it ('manual'). State is runtime-only and never written to the project.
 */
export interface GameEvent {
  t: number;
  type: 'arrival' | 'interaction' | 'transition';
  character: string;
  environment: string;
  node?: string;
  objectId?: string;
  objectName?: string;
  kind?: string;
  /** Event name configured on the interaction (for the host game). */
  event?: string;
  item?: string;
  message?: string;
}

export interface RuntimeState {
  collected: Set<string>;
  consumed: Set<string>;
  flags: Record<string, boolean>;
  inventory: Record<string, number>;
  events: GameEvent[];
}
export const createRuntimeState = (): RuntimeState => ({ collected: new Set(), consumed: new Set(), flags: {}, inventory: {}, events: [] });
export function resetRuntimeState(rt: RuntimeState) { rt.collected.clear(); rt.consumed.clear(); rt.flags = {}; rt.inventory = {}; rt.events = []; }

export const newInteraction = (kind = 'inspect'): Interaction => ({
  id: uid('int'), kind, label: kind === 'collect' ? 'Raccogli' : kind === 'inspect' ? 'Osserva' : kind === 'activate' ? 'Attiva' : 'Interagisci',
  trigger: kind === 'collect' ? 'on-arrival' : 'manual', once: kind === 'collect', requires: [], duration: 1, message: '', event: '', props: {},
});

export const INTERACTION_KINDS: { id: string; label: string }[] = [
  { id: 'collect', label: 'Raccolta' }, { id: 'inspect', label: 'Osservazione' }, { id: 'activate', label: 'Attivazione' }, { id: 'custom', label: 'Personalizzata' },
];

export interface Available { object: InteractiveObject; interaction: Interaction }

/** Interactions a character with `abilities` can run at `nodeId` right now. */
export function availableInteractions(env: Environment, nodeId: string, abilities: string[], rt: RuntimeState, trigger?: InteractionTrigger): Available[] {
  const out: Available[] = [];
  for (const object of env.objects) {
    if (!object.visible || rt.collected.has(object.id) || !object.interactions.length) continue;
    if (nodeForObject(env, object) !== nodeId) continue;
    for (const interaction of object.interactions) {
      if (trigger && interaction.trigger !== trigger) continue;
      if (interaction.once && rt.consumed.has(`${object.id}:${interaction.id}`)) continue;
      if (!interaction.requires.every((r) => abilities.includes(r))) continue;
      out.push({ object, interaction });
    }
  }
  return out;
}

export interface Outcome { state: CharacterState; seconds: number; message: string; event: GameEvent }

/** Applies an interaction to the runtime state and describes what happened. */
export function performInteraction(env: Environment, a: Available, character: Character, rt: RuntimeState, time: number): Outcome {
  const { object, interaction: i } = a;
  let message = i.message, item: string | undefined;
  if (i.kind === 'collect') {
    item = i.props.item || object.name;
    rt.collected.add(object.id);
    rt.inventory[item] = (rt.inventory[item] ?? 0) + 1;
    message ||= `Raccolto: ${item}`;
  } else if (i.kind === 'activate') {
    rt.flags[object.id] = !rt.flags[object.id];
    message ||= `${object.name}: ${rt.flags[object.id] ? 'attivato' : 'disattivato'}`;
  } else message ||= `${character.name} — ${i.label}: ${object.name}`;
  if (i.once) rt.consumed.add(`${object.id}:${i.id}`);
  const event: GameEvent = { t: time, type: 'interaction', character: character.name, environment: env.name, node: nodeForObject(env, object) ?? undefined, objectId: object.id, objectName: object.name, kind: i.kind, event: i.event || undefined, item, message };
  rt.events.push(event);
  if (rt.events.length > 200) rt.events.shift();
  return { state: i.kind === 'collect' ? 'COLLECT' : 'INTERACT', seconds: i.duration, message, event };
}
