import type { BoneId, Clip, Pose, PuppetView } from '@/types';
import { uid } from '@/lib/ids';
import { plantFeet, reachArm } from './ik';

/**
 * Extra movement presets for side-view (paper) puppets. Legs are re-solved with inverse kinematics so the feet stay on the
 * ground whenever the pelvis moves (crouch, land, dig, sit…). Every preset is plain keyframes the user can edit afterwards.
 * Conventions (facing right): positive rotation = clockwise on screen; torso lean forward > 0; arms raised forward < 0.
 */
export const EXTRA_KINDS = ['run', 'crouch', 'land', 'sit', 'pickUp', 'lookAround', 'wave', 'celebrate', 'scared', 'surprised', 'hit', 'swing', 'dig', 'push', 'carry', 'showObject'] as const;
export type ExtraKind = (typeof EXTRA_KINDS)[number];
export const EXTRA_LABEL: Record<ExtraKind, string> = {
  run: 'Corsa', crouch: 'Accucciati', land: 'Atterraggio', sit: 'Siediti', pickUp: 'Raccogli da terra', lookAround: 'Guardati intorno', wave: 'Saluta', celebrate: 'Esulta',
  scared: 'Spavento', surprised: 'Sorpresa', hit: 'Colpito', swing: 'Colpo con attrezzo', dig: 'Scava', push: 'Spingi', carry: 'Trasporta', showObject: 'Mostra un oggetto',
};
export const isExtra = (k: string): k is ExtraKind => (EXTRA_KINDS as readonly string[]).includes(k);

type Rot = Partial<Record<BoneId, number>>;
const pose = (rot: Rot, dx = 0, dy = 0): Pose => ({ rot, dx, dy });

export function makeExtraPreset(kind: ExtraKind, pv: PuppetView | undefined, amount = 1): Clip {
  const a = amount;
  const keys: Clip['keys'] = [];
  const P = (p: Pose) => (pv ? plantFeet(pv, p) : p);                                // feet planted
  const at = (t: number, p: Pose) => keys.push({ t, pose: p });
  const mk = (name: string, duration: number, loop: boolean, extra?: Partial<Clip>): Clip => ({ id: uid('clip'), name, duration, loop, keys, ...extra });
  const H = pv?.figureHeight ?? 1000, ank = pv?.landmarks.ankleR ?? { x: 0, y: 0 };
  const rest = pose({});

  switch (kind) {
    case 'run': {
      const N = 8;
      for (let i = 0; i < N; i++) {
        const p = i / N, s = Math.sin(2 * Math.PI * p), c = Math.cos(2 * Math.PI * p);
        const tR = -48 * s * a, tL = 48 * s * a, sR = 70 * Math.max(0, c) * a, sL = 70 * Math.max(0, -c) * a;
        at(p, pose({ thighR: tR, thighL: tL, shinR: sR, shinL: sL, footR: -(tR + sR) * 0.5, footL: -(tL + sL) * 0.5, uarmR: 52 * s * a, uarmL: -52 * s * a, farmR: -75, farmL: -75, torso: 10 * a, head: -6 }, 0, -0.035 * Math.abs(Math.cos(2 * Math.PI * p)) * a));
      }
      return mk('Corsa', 0.55, true, { cycleLength: 1.3 });
    }
    case 'crouch': {
      const d = 0.17 * a, down = P(pose({ torso: 18 * a, head: -10, uarmR: -30, uarmL: -20 }, 0, d));
      at(0, rest); at(0.3, down); at(0.7, down); at(1, rest);
      return mk('Accucciati', 1.2, false);
    }
    case 'land': {
      const down = P(pose({ torso: 22 * a, head: -12, uarmR: -35, uarmL: -45 }, 0, 0.2 * a));
      at(0, P(pose({ torso: 6 }, 0, 0.02))); at(0.3, down); at(1, rest);
      return mk('Atterraggio', 0.5, false);
    }
    case 'sit': {
      const seat = P(pose({ torso: -4, head: 0, uarmR: -25, uarmL: -20 }, -0.04, 0.27 * a));
      at(0, rest); at(0.5, seat); at(1, seat);
      return mk('Siediti', 1.2, false);
    }
    case 'pickUp': {
      const reachTo = { x: ank.x + 0.1 * H, y: (pv?.pivot.y ?? 0) - 0.09 * H };
      const grab = (p: Pose) => (pv ? reachArm(pv, P(p), 'R', reachTo) : p);
      const low = grab(pose({ torso: 40 * a, head: -16, uarmL: -20 }, 0.03, 0.2 * a));
      const up = P(pose({ torso: 10, head: -6, uarmR: -50, farmR: -70, uarmL: -10 }, 0, 0.03));
      at(0, rest); at(0.3, low); at(0.5, low); at(0.75, up); at(1, rest);
      return mk('Raccogli da terra', 1.6, false);
    }
    case 'lookAround': {
      for (let i = 0; i < 8; i++) { const s = Math.sin((2 * Math.PI * i) / 8); at(i / 8, pose({ head: -14 * s * a, torso: 2.5 * s * a, uarmR: 2 * s, uarmL: -2 * s }, 0.004 * s, 0)); }
      return mk('Guardati intorno', 3, true);
    }
    case 'wave': {
      const frontal = pv?.id === 'front' || pv?.id === 'back';   // from the front the arm opens sideways and the forearm waves in the image plane
      for (let i = 0; i < 8; i++) { const s = Math.sin((2 * Math.PI * i) / 8); at(i / 8, frontal ? pose({ uarmR: -125, farmR: -10 + 28 * s * a, head: 3 * s, torso: 1.5 * s }, 0, 0) : pose({ uarmR: -140, farmR: -35 + 32 * s * a, head: -4, torso: -2 }, 0, 0)); }
      return mk('Saluta', 1.2, true);
    }
    case 'celebrate': {
      for (let i = 0; i < 8; i++) { const p = i / 8, s = Math.sin(2 * Math.PI * p); at(p, P(pose({ uarmR: -155 + 10 * s, uarmL: -145 - 10 * s, farmR: -20, farmL: -20, head: -6, torso: -3 + 2 * s }, 0, -0.01 + 0.03 * Math.cos(2 * Math.PI * p) * a))); }
      return mk('Esulta', 0.8, true);
    }
    case 'scared': {
      for (let i = 0; i < 6; i++) { const p = i / 6, s = Math.sin(2 * Math.PI * p * 2); at(p, P(pose({ torso: -9 + 1.5 * s, head: -10, uarmR: -70 + 3 * s, uarmL: -62 - 3 * s, farmR: -95, farmL: -90 }, -0.02, 0.04 * a))); }
      return mk('Spavento', 0.5, true);
    }
    case 'surprised': {
      const hold = pose({ torso: -14 * a, head: -10, uarmR: -50, uarmL: -38, farmR: -30, farmL: -25 }, -0.015, -0.01);
      at(0, rest); at(0.15, hold); at(0.65, hold); at(1, rest);
      return mk('Sorpresa', 0.9, false);
    }
    case 'hit': {
      at(0, rest); at(0.15, pose({ torso: -20 * a, head: -26 * a, uarmR: 38, uarmL: 30, thighR: 8, shinR: 6 }, -0.035, 0.01)); at(0.5, pose({ torso: -8, head: -10, uarmR: 12, uarmL: 8 }, -0.015, 0)); at(1, rest);
      return mk('Colpito', 0.7, false);
    }
    case 'swing': {
      const wind = P(pose({ uarmR: -168, uarmL: -160, farmR: -35, farmL: -35, torso: -10, head: 4 }, -0.01, 0.01));
      const hit = P(pose({ uarmR: -18, uarmL: -12, farmR: -12, farmL: -10, torso: 28 * a, head: -8 }, 0.02, 0.05 * a));
      at(0, rest); at(0.3, wind); at(0.5, hit); at(0.7, hit); at(1, rest);
      return mk('Colpo con attrezzo', 1.1, false);
    }
    case 'dig': {
      const wind = P(pose({ uarmR: -165, uarmL: -158, farmR: -35, farmL: -35, torso: -8 }, -0.01, 0.01));
      const hit = P(pose({ uarmR: -20, uarmL: -14, farmR: -12, farmL: -10, torso: 26 * a, head: -8 }, 0.02, 0.05 * a));
      at(0, wind); at(0.25, hit); at(0.4, hit); at(0.75, wind);
      return mk('Scava', 1.2, true);
    }
    case 'push': {
      const N = 8;
      for (let i = 0; i < N; i++) { const p = i / N, s = Math.sin(2 * Math.PI * p), c = Math.cos(2 * Math.PI * p); at(p, pose({ thighR: -18 * s, thighL: 18 * s, shinR: 24 * Math.max(0, c), shinL: 24 * Math.max(0, -c), uarmR: -85, uarmL: -78, farmR: -8, farmL: -8, torso: 15, head: -8 }, 0, 0.012 * Math.abs(c))); }
      return mk('Spingi', 0.9, true, { cycleLength: 0.5 });
    }
    case 'carry': {
      const N = 8;
      for (let i = 0; i < N; i++) { const p = i / N, s = Math.sin(2 * Math.PI * p), c = Math.cos(2 * Math.PI * p); const tR = -24 * s, tL = 24 * s, sR = 28 * Math.max(0, c), sL = 28 * Math.max(0, -c); at(p, pose({ thighR: tR, thighL: tL, shinR: sR, shinL: sL, footR: -(tR + sR) * 0.6, footL: -(tL + sL) * 0.6, uarmR: -58, uarmL: -52, farmR: -88, farmL: -85, torso: -4 }, 0, -0.012 * Math.cos(4 * Math.PI * p))); }
      return mk('Trasporta', 0.9, true, { cycleLength: 0.7 });
    }
    case 'showObject': {
      const show = pose({ uarmR: -82, farmR: -6, uarmL: -10, torso: 2, head: -3 });
      at(0, rest); at(0.3, show); at(0.75, show); at(1, rest);
      return mk('Mostra un oggetto', 1.4, false);
    }
  }
}
