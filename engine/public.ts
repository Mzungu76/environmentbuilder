/**
 * Public runtime API for host games (no DOM, no PixiJS, no React).
 * Build: `npm run build:runtime` → dist/environment-runtime.mjs
 *
 *   import { migrateProject, Agent, findRoute, resolveExit, availableInteractions, … } from './environment-runtime.mjs';
 *   const project = migrateProject(JSON.parse(projectJsonFromTheExportedZip));
 *   const env = project.environments[0];
 *   const agent = new Agent(env, env.characters[0]);   // graph-driven character
 *   agent.goTo(nodeId);                                 // follows the links only
 *   agent.step(1 / 60);                                 // deterministic fixed step
 *   agent.snapshot();                                   // { x, y, facing, state, … } normalized coordinates
 */
export { SCHEMA_VERSION } from '@/types';
export type * from '@/types';
export { migrateProject, SchemaError } from '@/lib/serialization/migrations';
export { createProject, createEnvironment } from '@/lib/serialization/factory';
export { Agent, type AgentSnapshot, type GoToResult } from '@/engine/simulation/Agent';
export { findRoute, reachableNodes, canTraverse, type RouteStep } from '@/engine/simulation/routing';
export { buildTrack, pointAt, type Track } from '@/engine/simulation/track';
export { createRng } from '@/engine/simulation/rng';
export { outgoing, reachable, validateGraph } from '@/engine/navigation/graph';
export { edgeLengthPx, sampleEdge, bezierPoint } from '@/engine/navigation/geometry';
export { nodeForObject, resolveExit, exitNodeIds, objectIssues } from '@/engine/interaction/objects';
export {
  availableInteractions, performInteraction, createRuntimeState, resetRuntimeState,
  type GameEvent, type RuntimeState, type Available, type Outcome,
} from '@/engine/interaction/system';
export { getMovementType, registerMovementType, movementTypes, type MovementType } from '@/engine/movement/movementTypes';
export { spriteFor, parseFrames, type SpriteDraw } from '@/engine/characters/sprites';
export { allProfiles, suggestedTypes } from '@/engine/profiles';

// --- rigged characters ("puppets") ---------------------------------------------------------------------------------
export { rigOf, skinVertices, clipFor, advancePhase, poseAt, chooseView, chooseViewForState, flipsWithFacing } from '@/engine/puppet/runtime';
export { samplePose, phaseRate, makePreset, defaultClips } from '@/engine/puppet/animation';
export { buildRig, boneMatrices, BONE_DEFS } from '@/engine/puppet/skeleton';
export { drawPuppet, type DrawOptions } from '@/engine/puppet/canvasRenderer';
