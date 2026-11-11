import type { Pose, PuppetView } from '@/types';
import { BONE_IDS } from '@/types';
import { apply, boneMatrices, type Rig } from '@/engine/puppet/skeleton';
import { skinVertices } from '@/engine/puppet/runtime';
import { drawPuppet } from '@/engine/puppet/canvasRenderer';

/** Draws the skinned puppet in cut-out coordinates (scale 1, origin = cut-out top-left). */
export function renderPuppet(ctx: CanvasRenderingContext2D, image: HTMLCanvasElement, view: PuppetView, pose: Pose, flip = false, out?: Float32Array): Float32Array | null {
  const pos = skinVertices(view, pose, out);
  if (!pos || !view.mesh) { ctx.drawImage(image, 0, 0); return null; }
  drawPuppet(ctx, image, pos, view.mesh.uvs, view.mesh.indices, { x: view.pivot.x, y: view.pivot.y, scale: 1, flip, pivot: view.pivot });
  return pos;
}

const CHAIN_COLOR: Record<string, string> = { torso: '#ffca3a', head: '#ff595e', arm: '#4cc9f0', leg: '#3ecf8e' };
const colorOf = (id: string) => (id.includes('arm') || id.includes('hand') ? CHAIN_COLOR.arm : id.match(/thigh|shin|foot/) ? CHAIN_COLOR.leg : id === 'head' ? CHAIN_COLOR.head : CHAIN_COLOR.torso);

/** Bones as lines with joint handles; returns nothing. `pose` deforms the skeleton too. */
export function drawBones(ctx: CanvasRenderingContext2D, rig: Rig, pose: Pose | null, zoom: number, selected: number | null = null) {
  const mats = pose ? boneMatrices(rig, pose) : null;
  for (const b of rig.bones) {
    const h = mats ? apply(mats[b.index], b.head) : b.head, t = mats ? apply(mats[b.index], b.tail) : b.tail;
    ctx.strokeStyle = colorOf(b.id); ctx.lineWidth = (b.index === selected ? 5 : 3) / zoom;
    ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.lineTo(t.x, t.y); ctx.stroke();
    ctx.fillStyle = b.index === selected ? '#fff' : '#111'; ctx.strokeStyle = colorOf(b.id); ctx.lineWidth = 2 / zoom;
    ctx.beginPath(); ctx.arc(t.x, t.y, 5 / zoom, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
}

export const boneIndex = (id: (typeof BONE_IDS)[number]) => BONE_IDS.indexOf(id);
