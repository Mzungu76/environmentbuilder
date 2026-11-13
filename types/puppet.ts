import type { CharacterState } from './character';
import type { ImageAssetMeta } from './environment';
import type { Vec2 } from './navigation';

/** A rigged character ("modellino"): one cut-out image per view, deformed with a bone skeleton. Added in schema v3. */

/**
 * side/front/back come from the turnaround sheet. `climb` and `jump` are extra POSE views (drawn in that posture, facing
 * right): they are shown automatically for the CLIMB and JUMP/FALL states and animated around their own rest pose.
 */
export type ViewId = 'side' | 'front' | 'back' | 'climb' | 'jump';
export const VIEW_IDS: ViewId[] = ['side', 'front', 'back', 'climb', 'jump'];
/** Views that look to the right and are drawn in profile (limbs: R = near, L = far). */
export const PROFILE_VIEWS: ViewId[] = ['side', 'climb', 'jump'];

/**
 * Skeleton landmarks (pixel coordinates of the view's cut-out image).
 * L / R are the sides AS SEEN IN THE IMAGE for front/back views; in the side view (character facing right)
 * R = the NEAR limbs, L = the FAR limbs.
 */
export const LANDMARK_IDS = [
  'headTop', 'neck', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'wristL', 'wristR', 'handL', 'handR',
  'pelvis', 'hipL', 'hipR', 'kneeL', 'kneeR', 'ankleL', 'ankleR', 'toeL', 'toeR',
] as const;
export type LandmarkId = (typeof LANDMARK_IDS)[number];

export const BONE_IDS = [
  'pelvis', 'torso', 'head', 'uarmL', 'farmL', 'handL', 'uarmR', 'farmR', 'handR',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR',
] as const;
export type BoneId = (typeof BONE_IDS)[number];

export interface Rect { x: number; y: number; w: number; h: number }

/** Triangle mesh over the cut-out (positions in cut-out pixels). */
export interface Mesh { cell: number; vertices: number[]; uvs: number[]; indices: number[] }
/** Up to 4 bone influences per vertex, flattened (4 entries per vertex). Bone index = position in BONE_IDS. */
export interface Skin { idx: number[]; w: number[] }

/** Rotations in degrees relative to the parent bone (rest = 0). dx/dy move the whole body, in figure heights. */
export interface Pose { rot: Partial<Record<BoneId, number>>; dx: number; dy: number }
export interface Keyframe { t: number; pose: Pose }
export interface Clip {
  id: string;
  name: string;
  /** Seconds per cycle. */
  duration: number;
  loop: boolean;
  /** Keyframes with t in [0,1] (fraction of the cycle), sorted. */
  keys: Keyframe[];
  /** Distance covered per cycle, in figure heights: lets the runtime sync the speed and avoid foot sliding. */
  cycleLength?: number;
  /** Ids of the attachments (tools / objects) shown while this clip plays. */
  attach?: string[];
}

export interface WeightParams {
  /** Joint softness: larger = smoother bends, smaller = more rigid limbs. */
  falloff: number;
  smooth: number;
  /** Side view: how strongly vertices prefer the NEAR limbs (R) over the far ones (L). */
  farPenalty: number;
}

export interface ManikinParams {
  /** Extra length of each part beyond its joints (fraction of the bone length) so bends stay closed. */
  overlap: number;
  /** Rows along each part. */
  segments: number;
  /** Columns across each part. */
  cols: number;
  /** Scales the measured thickness of the parts. */
  widthScale: number;
  /** Darkening of the far limbs (profile views). */
  farShade: number;
  /** Fill the areas hidden by other parts (e.g. the torso under the arm) from their surroundings. */
  inpaint: boolean;
}

/**
 * "Manichino" (prototype): the figure rebuilt as separate parts, each with its own mesh and UV island in a texture atlas
 * baked from the view's image. Drawn instead of the single-image mesh when `enabled`; same skeleton and animations.
 */
export interface ManikinData {
  enabled: boolean;
  atlasAssetId: string;
  width: number;
  height: number;
  mesh: Mesh;
  skin: Skin;
  params: ManikinParams;
}

export interface PuppetView {
  id: ViewId;
  /** Region of the source image (pixels) that contains this figure. */
  crop: Rect;
  /** Extra pose views come from their own image; when absent the puppet's turnaround sheet is the source. */
  sourceAssetId?: string;
  /** Mirror the view when the character faces left (default: profile views yes, front/back no, climb no). */
  flipWithFacing?: boolean;
  /** Processed cut-out (transparent background) image asset. */
  cutoutAssetId: string | null;
  width: number;
  height: number;
  /** Height of the figure in cut-out pixels (used to scale all views to the same size; editable). */
  figureHeight: number;
  /** Ground contact point (feet centre), in cut-out pixels. */
  pivot: Vec2;
  landmarks: Partial<Record<LandmarkId, Vec2>>;
  /** Key-pose frames: silhouette overlap (0–1) of the automatic skeleton fit; absent when the skeleton was not fitted. */
  fitScore?: number;
  mesh: Mesh | null;
  skin: Skin | null;
  /** Optional part-based rebuild of this view (see ManikinData). */
  manikin?: ManikinData;
  /** Profile only: draw copies of the near arm/leg behind the body as the far limbs (the flat image hides them). */
  farLimbs?: { arm: boolean; leg: boolean };
  weightParams: WeightParams;
  clips: Clip[];
  stateClips: Partial<Record<CharacterState, string>>;
}

export interface KeyParams {
  /** Background colour to remove (null = detect from the borders). */
  color: [number, number, number] | null;
  tolerance: number;
  feather: number;
  /** Positive shrinks the silhouette, negative grows it (pixels). */
  choke: number;
  defringe: number;
  floodFromBorder: boolean;
  minIsland: number;
}

/**
 * Pose-keyed animation: an ordered list of key poses (each a full view drawn in that posture: own image, skeleton, mesh).
 * Playback goes key → key; between two keys the skeleton difference of the neighbours is used to warp both toward the
 * in-between pose and they are cross-faded. Deformations stay small because every frame starts from a nearby drawing.
 */
export interface PoseSet {
  frames: PuppetView[];
  /** Seconds for one full cycle through all the keys. */
  duration: number;
  loop: boolean;
}
export type PoseSetKey = 'climb' | 'jump';

/**
 * A tool or object carried by the character (pickaxe, torch, a collected item…): an image fixed to a bone. The `grip` point of the
 * image sits on the bone's anchor (the middle of the bone, e.g. the centre of the hand), then `offset`, `rot` and `scale` fine-tune it.
 */
export interface Attachment {
  id: string;
  name: string;
  assetId: string;
  width: number;
  height: number;
  bone: BoneId;
  /** Point of the image (pixels) that is held. */
  grip: Vec2;
  /** From the bone anchor, in figure heights. */
  offset: Vec2;
  /** Degrees, relative to the bone's rest orientation. */
  rot: number;
  /** Height of the image as a fraction of the figure height. */
  scale: number;
  /** Drawn in front of the body (true) or behind it. */
  front: boolean;
  /** Always visible (e.g. a carried object); otherwise only in the clips that list it in `attach`. */
  always: boolean;
  /** Views that show it (default: the profile only). */
  views?: ViewId[];
}

/** Paper puppet: hand corrections of the automatic assembly. Keys are piece ids (head, torso, pelvis, uarm, farm, hand, thigh, shin, foot, accA, accB). */
export interface PaperAdjust { dx: number; dy: number; /** > 0 draws the piece in front of its default place, < 0 behind */ z: number }
export interface PaperSetup { sheetAssetId: string; adjust: Record<string, PaperAdjust>; farShade: number; /** 0 = rigid pieces, 1 = very soft joints (pieces follow their parent near the joint). Default 0.5. */ soft?: number }

export interface Puppet {
  id: string;
  name: string;
  source: { assetId: string; width: number; height: number } | null;
  keying: KeyParams;
  views: Partial<Record<ViewId, PuppetView>>;
  /** Key-pose sequences (override the single climb/jump view when they have 2+ frames). */
  poseSets?: Partial<Record<PoseSetKey, PoseSet>>;
  /** Present when the character was assembled from a sheet of separate parts (paper puppet). */
  paper?: PaperSetup;
  /** Front / back views assembled from their own sheets of parts (the profile view is `paper`). */
  /** Tools and objects the character can hold. */
  attachments?: Attachment[];
  paperViews?: Partial<Record<'front' | 'back', PaperSetup>>;
  /** View used when standing still. */
  idleView: ViewId;
  /** Asset metadata for every image of this puppet (source + cut-outs), exported with the project. */
  assets: ImageAssetMeta[];
}
