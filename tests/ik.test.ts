import { describe, expect, it } from 'vitest';
import type { PuppetView } from '@/types';
import { plantFeet, reachArm, twoBoneIK } from '@/engine/puppet/ik';
import { apply, boneMatrices, buildRig, templateLandmarks } from '@/engine/puppet/skeleton';
import { makePreset, kindsForView } from '@/engine/puppet/animation';
import { chooseViewForState } from '@/engine/puppet/runtime';
import { blendPoses, samplePose } from '@/engine/puppet/animation';
import { buildSequence, concatClips, SEQUENCES } from '@/engine/puppet/sequences';
import { EXTRA_KINDS } from '@/engine/puppet/presets';
import { PuppetPlayer } from '@/engine/puppet/player';
import { createPuppet } from '@/lib/studio/pipeline';
import { defaultClips } from '@/engine/puppet/animation';

const b = { x: 0, y: 0, w: 300, h: 800 };
const view: PuppetView = { id: 'side', crop: { x: 0, y: 0, w: 300, h: 800 }, cutoutAssetId: 'a', width: 300, height: 800, figureHeight: 800, pivot: { x: 150, y: 800 }, landmarks: templateLandmarks('side', b, 150), mesh: null, skin: null, weightParams: { falloff: 0.3, smooth: 2, farPenalty: 1 }, ...defaultClips('side') };
const ankle = (pose: ReturnType<typeof plantFeet>, id: 'ankleR' | 'ankleL') => {
  const rig = buildRig(view)!, mats = boneMatrices(rig, pose), bone = rig.bones.find((x) => x.id === (id === 'ankleR' ? 'shinR' : 'shinL'))!;
  return apply(mats[bone.index], bone.tail);
};

describe('inverse kinematics', () => {
  it('two-bone IK reaches a reachable target and clamps an unreachable one', () => {
    const r = twoBoneIK({ x: 0, y: 0 }, 10, 10, { x: 0, y: 15 }, -1), knee = { x: 10 * Math.cos((r.a1 * Math.PI) / 180), y: 10 * Math.sin((r.a1 * Math.PI) / 180) };
    expect(Math.hypot(knee.x + 10 * Math.cos((r.a2 * Math.PI) / 180) - 0, knee.y + 10 * Math.sin((r.a2 * Math.PI) / 180) - 15)).toBeLessThan(0.01);
    expect(knee.x).toBeGreaterThan(0);                         // bend = −1: the knee points forward (+x) for a leg pointing down
    expect(twoBoneIK({ x: 0, y: 0 }, 10, 10, { x: 0, y: 100 }, -1).reach).toBeGreaterThan(1);
  });
  it('plantFeet keeps both ankles on their rest position while the pelvis goes down', () => {
    const rest = ankle({ rot: {}, dx: 0, dy: 0 }, 'ankleR');
    const crouched = plantFeet(view, { rot: { torso: 15 }, dx: 0, dy: 0.17 });
    for (const id of ['ankleR', 'ankleL'] as const) { const a = ankle(crouched, id), r0 = ankle({ rot: {}, dx: 0, dy: 0 }, id); expect(Math.hypot(a.x - r0.x, a.y - r0.y)).toBeLessThan(0.5); }
    expect(crouched.rot.thighR!).toBeLessThan(-20);             // thighs swing forward…
    expect(crouched.rot.shinR!).toBeGreaterThan(20);            // …knees bend
    expect(Math.hypot(rest.x - ankle(crouched, 'ankleR').x, rest.y - ankle(crouched, 'ankleR').y)).toBeLessThan(0.5);
  });
  it('reachArm puts the wrist on the target', () => {
    const t = { x: 215, y: 470 }, p = reachArm(view, { rot: { torso: 30 }, dx: 0, dy: 0.1 }, 'R', t);
    const rig = buildRig(view)!, mats = boneMatrices(rig, p), farm = rig.bones.find((x) => x.id === 'farmR')!, w = apply(mats[farm.index], farm.tail);
    expect(Math.hypot(w.x - t.x, w.y - t.y)).toBeLessThan(2);
  });
});

describe('presets, sequences and blending', () => {
  it('every extra preset builds sorted keyframes in range and uses the view for the IK', () => {
    for (const k of EXTRA_KINDS) {
      const c = makePreset(k, 'side', 1, view);
      expect(c.keys.length).toBeGreaterThanOrEqual(2); expect(c.name.length).toBeGreaterThan(2);
      for (let i = 1; i < c.keys.length; i++) expect(c.keys[i].t).toBeGreaterThanOrEqual(c.keys[i - 1].t);
      expect(c.keys.every((x) => x.t >= 0 && x.t <= 1 && Object.values(x.pose.rot).every((v) => Number.isFinite(v)))).toBe(true);
    }
    expect(makePreset('crouch', 'side', 1, view).keys[1].pose.dy).toBeGreaterThan(0.1);
  });
  it('crouch lowers the pelvis with feet planted (the ankles do not move)', () => {
    const c = makePreset('crouch', 'side', 1, view), down = c.keys[1].pose, r0 = ankle({ rot: {}, dx: 0, dy: 0 }, 'ankleR');
    expect(down.dy).toBeGreaterThan(0.1); const a = ankle(down, 'ankleR'); expect(Math.hypot(a.x - r0.x, a.y - r0.y)).toBeLessThan(0.6);
  });
  it('concatClips chains clips with their durations, closes loops and keeps keys sorted', () => {
    const walk = makePreset('walk', 'side', 1), wave = makePreset('wave', 'side', 1);
    const seq = concatClips([{ clip: walk, repeat: 2 }, { clip: wave, repeat: 3 }], 'Prova');
    expect(seq.duration).toBeCloseTo(walk.duration * 2 + wave.duration * 3 + 0.15, 1);
    for (let i = 1; i < seq.keys.length; i++) expect(seq.keys[i].t).toBeGreaterThanOrEqual(seq.keys[i - 1].t);
    expect(seq.keys[seq.keys.length - 1].t).toBeLessThanOrEqual(1); expect(seq.loop).toBe(false);
    expect(Object.keys(samplePose(seq, 0.5).rot).length).toBeGreaterThan(0);
  });
  it('every predefined sequence builds; missing presets are added once, existing ones reused', () => {
    for (const d of SEQUENCES) {
      const r = buildSequence(d, view, 1);
      expect(r.clip.keys.length).toBeGreaterThan(4); expect(r.clip.duration).toBeGreaterThan(1);
      const again = buildSequence(d, { ...view, clips: [...view.clips, ...r.added] }, 1); expect(again.added).toHaveLength(0);
    }
  });
  it('blendPoses interpolates; the player cross-fades when the state changes', () => {
    expect(blendPoses({ rot: { head: 0 }, dx: 0, dy: 0 }, { rot: { head: 10 }, dx: 1, dy: 0 }, 0.5)).toEqual({ rot: { head: 5 }, dx: 0.5, dy: 0 });
    const v = { ...view, mesh: { cell: 1, vertices: [0, 0, 10, 0, 0, 10], uvs: [0, 0, 1, 0, 0, 1], indices: [0, 1, 2] }, skin: { idx: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], w: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] } };
    const puppet = { ...createPuppet('p'), views: { side: v }, idleView: 'side' as const };
    const pl = new PuppetPlayer(); pl.frame(puppet, 'IDLE', 0.016, 0); pl.frame(puppet, 'WALK', 0.016, 0);
    // internal: a blend is running right after the switch and finishes after blendTime
    expect((pl as unknown as { blend: unknown }).blend).not.toBeNull();
    for (let i = 0; i < 20; i++) pl.frame(puppet, 'WALK', 0.016, 0);
    expect((pl as unknown as { blend: unknown }).blend).toBeNull();
  });
  it('frontal presets mirror the image-left arm; side-only presets are not offered for front/back; CLIMB falls back to the back view', () => {
    const side = makePreset('wave', 'side', 1, view), front = makePreset('celebrate', 'front', 1, view);
    const k = front.keys[0].pose.rot; expect(Math.sign(k.uarmL!)).toBe(-Math.sign(k.uarmR!));
    expect(side.keys[0].pose.rot.uarmR).toBeLessThan(0);
    expect(kindsForView('front')).not.toContain('crouch'); expect(kindsForView('side')).toContain('crouch');
    const mk = (id: 'side' | 'back') => ({ ...view, id, mesh: { cell: 1, vertices: [0, 0, 1, 0, 0, 1], uvs: [0, 0, 1, 0, 0, 1], indices: [0, 1, 2] }, skin: { idx: new Array(12).fill(0), w: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] } });
    expect(chooseViewForState({ side: mk('side'), back: mk('back') }, 'CLIMB', 'side')).toBe('back');
    expect(chooseViewForState({ side: mk('side') }, 'CLIMB', 'side')).toBe('side');
  });
});

import { activeAttachments, attachmentQuad } from '@/engine/puppet/attachments';
import type { Attachment } from '@/types';
describe('attachments (tools and objects)', () => {
  const att: Attachment = { id: 'pick', name: 'Piccone', assetId: 'img', width: 100, height: 300, bone: 'handR', grip: { x: 50, y: 250 }, offset: { x: 0, y: 0 }, rot: 0, scale: 0.4, front: true, always: false };
  it('the grip sits on the bone anchor and the tool is scaled by the figure height', () => {
    const q = attachmentQuad(view, { rot: {}, dx: 0, dy: 0 }, att)!, rig = buildRig(view)!, hand = rig.bones.find((b) => b.id === 'handR')!;
    const anchor = { x: (hand.head.x + hand.tail.x) / 2, y: (hand.head.y + hand.tail.y) / 2 }, s = (0.4 * view.figureHeight) / 300;
    // grip (50,250) → anchor: the top-left corner is at (-50, -250) × s from it
    expect(q.positions[0]).toBeCloseTo(anchor.x - 50 * s, 3); expect(q.positions[1]).toBeCloseTo(anchor.y - 250 * s, 3);
    expect(Math.hypot(q.positions[6] - q.positions[0], q.positions[7] - q.positions[1])).toBeCloseTo(300 * s, 3);   // image height
  });
  it('follows the bone: the tool moves with the hand when the arm turns', () => {
    const rest = attachmentQuad(view, { rot: {}, dx: 0, dy: 0 }, att)!, up = attachmentQuad(view, { rot: { uarmR: -150 }, dx: 0, dy: 0 }, att)!;
    expect(Math.hypot(up.positions[0] - rest.positions[0], up.positions[1] - rest.positions[1])).toBeGreaterThan(100);
    const a = attachmentQuad(view, { rot: {}, dx: 0, dy: 0 }, { ...att, rot: 90 })!;                                // extra rotation about the grip
    expect(Math.abs(a.positions[0] - rest.positions[0]) + Math.abs(a.positions[1] - rest.positions[1])).toBeGreaterThan(10);
  });
  it('shown always, or only in the clips that list it, and only in the views it is made for', () => {
    const clip = { ...makePreset('dig', 'side', 1, view), attach: ['pick'] }, other = makePreset('walk', 'side', 1);
    expect(activeAttachments([att], clip, 'side')).toHaveLength(1); expect(activeAttachments([att], other, 'side')).toHaveLength(0);
    expect(activeAttachments([{ ...att, always: true }], other, 'side')).toHaveLength(1);
    expect(activeAttachments([att], clip, 'front')).toHaveLength(0); expect(activeAttachments([{ ...att, views: ['front'] }], clip, 'front')).toHaveLength(1);
  });
  it('the player returns the quads of the attachments of the current clip', () => {
    const v = { ...view, mesh: { cell: 1, vertices: [0, 0, 10, 0, 0, 10], uvs: [0, 0, 1, 0, 0, 1], indices: [0, 1, 2] }, skin: { idx: new Array(12).fill(0), w: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] } };
    const dig = { ...makePreset('dig', 'side', 1, view), attach: ['pick'] };
    const puppet = { ...createPuppet('p'), views: { side: { ...v, clips: [...v.clips, dig], stateClips: { ...v.stateClips, INTERACT: dig.id } } }, idleView: 'side' as const, attachments: [att] };
    expect(new PuppetPlayer().frame(puppet, 'INTERACT', 0.02, 0)!.attachments).toHaveLength(1);
    expect(new PuppetPlayer().frame(puppet, 'WALK', 0.02, 0)!.attachments).toBeUndefined();
  });
});
