import type { CharacterState } from '@/types';

/**
 * Movement types: how a character travels along an edge of a given type.
 * Data-driven and open: `registerMovementType()` lets a host game add its own without touching the engine.
 * Any edge can also override its travel time with `props.duration` (seconds).
 */
export interface MovementType {
  id: string;
  label: string;
  /** Character state (animation) while travelling. */
  state: CharacterState;
  /** Design-overlay colour. */
  color: number;
  /** Speed multiplier along the edge as a function of progress u ∈ [0,1] (must stay > 0). Default: constant 1. */
  speedProfile?: (u: number) => number;
  /** Visual lift (px, upwards) at progress u, e.g. the arc of a jump. Does not change the logical position. */
  lift?: (u: number, lengthPx: number) => number;
  /** Default travel time in seconds, ignoring character speed (e.g. teleport). */
  duration?: number;
  /** Keep the current facing instead of following the direction of travel (climbing, falling). */
  keepFacing?: boolean;
}

const REGISTRY = new Map<string, MovementType>();
export function registerMovementType(t: MovementType) { REGISTRY.set(t.id, t); }
export const movementTypes = () => [...REGISTRY.values()];
export function getMovementType(id: string): MovementType {
  return REGISTRY.get(id) ?? { id, label: id, state: 'WALK', color: 0xa3a3a3 };
}

for (const t of [
  { id: 'walk', label: 'Camminata', state: 'WALK', color: 0x2dd4bf },
  { id: 'ramp', label: 'Rampa', state: 'WALK', color: 0xfb923c },
  { id: 'stairs', label: 'Scale', state: 'WALK', color: 0xf472b6 },
  { id: 'platform-link', label: 'Passaggio tra piattaforme', state: 'WALK', color: 0x60a5fa },
  { id: 'curve', label: 'Curva', state: 'WALK', color: 0x4ade80 },
  { id: 'climb', label: 'Arrampicata', state: 'CLIMB', color: 0xc084fc, keepFacing: true },
  { id: 'jump', label: 'Salto', state: 'JUMP', color: 0xfacc15, lift: (u, len) => 4 * u * (1 - u) * Math.min(0.3 * len, 160) },
  { id: 'fall', label: 'Caduta', state: 'FALL', color: 0xa3e635, speedProfile: (u) => 0.35 + 1.9 * u * u, keepFacing: true },
  { id: 'teleport', label: 'Teletrasporto', state: 'CUSTOM', color: 0xe879f9, duration: 0.25 },
] as MovementType[]) registerMovementType(t);

export const EDGE_COLOR = (type: string) => getMovementType(type).color;
