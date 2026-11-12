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
export { clampPose, limitsFor } from '@/engine/puppet/limits';
export { activeAttachments, attachmentQuad } from '@/engine/puppet/attachments';
export { sampleSet, posePartway, frameQualities } from '@/engine/puppet/keyposes';
export { rigOf, skinVertices, clipFor, advancePhase, poseAt, chooseView, chooseViewForState, flipsWithFacing, resolveView } from '@/engine/puppet/runtime';
export { samplePose, phaseRate, makePreset, defaultClips } from '@/engine/puppet/animation';
export { buildRig, boneMatrices, BONE_DEFS } from '@/engine/puppet/skeleton';
export { drawPuppet, type DrawOptions } from '@/engine/puppet/canvasRenderer';
export { buildManikin, DEFAULT_MANIKIN } from '@/engine/puppet/manikin';

// --- procedural characters ("omini") ---------------------------------------------------------------------------------
export { buildDollShapes, dollLandmarks, DOLL_HEIGHT, type DollShape } from '@/engine/doll/shapes';
export { DollPlayer, dollClips } from '@/engine/doll/player';
export { drawDoll, shapesBounds, type DollDrawOptions } from '@/engine/doll/render';
export { createDoll, randomDoll, DOLL_PRESETS, ACCESSORY_LABEL } from '@/engine/doll/defaults';
