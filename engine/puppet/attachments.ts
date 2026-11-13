import type { Attachment, Clip, Pose, PuppetView, ViewId } from '@/types';
import { apply, boneMatrices } from './skeleton';
import { rigOf } from './runtime';

/** A tool/object as a textured quad in the view's pixel space (same space as the skinned mesh). */
export interface AttachQuad { id: string; assetId: string; front: boolean; positions: Float32Array; uvs: number[]; indices: number[] }

export const QUAD_UVS = [0, 0, 1, 0, 1, 1, 0, 1];
export const QUAD_INDICES = [0, 1, 2, 0, 2, 3];

/** Attachments visible for a clip in a view. */
export function activeAttachments(list: Attachment[] | undefined, clip: Clip | undefined, viewId: ViewId): Attachment[] {
  if (!list?.length) return [];
  const ids = new Set(clip?.attach ?? []);
  return list.filter((a) => (a.always || ids.has(a.id)) && (a.views ?? ['side']).includes(viewId));
}

/** The attachment's corners for a pose: placed on its bone's rest anchor, then carried by the bone's transform. */
export function attachmentQuad(view: PuppetView, pose: Pose, a: Attachment): AttachQuad | null {
  const rig = rigOf(view);
  const bone = rig?.bones.find((b) => b.id === a.bone);
  if (!rig || !bone) return null;
  const H = view.figureHeight, s = (a.scale * H) / Math.max(1, a.height);
  const anchor = { x: (bone.head.x + bone.tail.x) / 2 + a.offset.x * H, y: (bone.head.y + bone.tail.y) / 2 + a.offset.y * H };
  const r = (a.rot * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r);
  const M = boneMatrices(rig, pose)[bone.index];
  const pos = new Float32Array(8);
  [[0, 0], [a.width, 0], [a.width, a.height], [0, a.height]].forEach(([cx, cy], i) => {
    const dx = (cx - a.grip.x) * s, dy = (cy - a.grip.y) * s;
    const q = apply(M, { x: anchor.x + dx * c - dy * sn, y: anchor.y + dx * sn + dy * c });
    pos[i * 2] = q.x; pos[i * 2 + 1] = q.y;
  });
  return { id: a.id, assetId: a.assetId, front: a.front, positions: pos, uvs: QUAD_UVS, indices: QUAD_INDICES };
}

export const DEFAULT_ATTACHMENT: Omit<Attachment, 'id' | 'name' | 'assetId' | 'width' | 'height'> = {
  bone: 'handR', grip: { x: 0, y: 0 }, offset: { x: 0, y: 0 }, rot: 0, scale: 0.35, front: true, always: false,
};
