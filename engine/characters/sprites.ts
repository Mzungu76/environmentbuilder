import type { Character, CharacterState } from '@/types';

/** What the renderer needs to draw a character's sprite for the current state. */
export interface SpriteDraw {
  assetId: string;
  /** Frame size in px for sprite sheets; null = the whole image is a single static frame. */
  frameWidth: number | null;
  frameHeight: number | null;
  frames: number[];
  fps: number;
  loop: boolean;
}

/** Animation for `state`; falls back to IDLE, then to frame 0. Returns null when the character has no sprite. */
export function spriteFor(c: Character, state: CharacterState): SpriteDraw | null {
  const assetId = c.spriteSheet?.assetId ?? c.spriteAssetId;
  if (!assetId) return null;
  const anim = c.animations.find((a) => a.state === state && a.frames.length) ?? c.animations.find((a) => a.state === 'IDLE' && a.frames.length);
  return {
    assetId, frameWidth: c.spriteSheet?.frameWidth ?? null, frameHeight: c.spriteSheet?.frameHeight ?? null,
    frames: anim?.frames.length ? anim.frames : [0], fps: anim?.fps ?? 8, loop: anim?.loop ?? true,
  };
}

/** "0-3, 7" → [0,1,2,3,7]. Invalid tokens are ignored. */
export function parseFrames(text: string): number[] {
  const out: number[] = [];
  for (const tok of text.split(',').map((t) => t.trim()).filter(Boolean)) {
    const m = tok.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) { const a = +m[1], b = +m[2]; for (let i = a; i <= b && out.length < 512; i++) out.push(i); }
    else if (/^\d+$/.test(tok)) out.push(+tok);
  }
  return out;
}
export const framesToText = (f: number[]): string => {
  const parts: string[] = []; let i = 0;
  while (i < f.length) { let j = i; while (j + 1 < f.length && f[j + 1] === f[j] + 1) j++; parts.push(j > i + 1 ? `${f[i]}-${f[j]}` : f.slice(i, j + 1).join(', ')); i = j + 1; }
  return parts.join(', ');
};
