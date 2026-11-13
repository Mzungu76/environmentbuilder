import type { AccessoryId, Doll } from '@/types';
import { uid } from '@/lib/ids';
import { createRng } from '@/engine/simulation/rng';

export const BASE_BODY: Doll['body'] = {
  headSize: 0.19, headWidth: 1, neck: 0.03, torso: 0.3, torsoWidth: 0.13, hips: 1, arm: 0.34, armThickness: 0.022, legThickness: 0.036, hand: 0.05, foot: 0.12,
};

export const ACCESSORY_LABEL: Record<AccessoryId, string> = {
  helmet: 'Casco con lampada', cap: 'Berretto', hat: 'Cappello a tesa', backpack: 'Zaino', pickaxe: 'Piccone', scarf: 'Fazzoletto',
  belt: 'Cintura', gloves: 'Guanti', kneepads: 'Ginocchiere', glasses: 'Occhiali',
};
export const ACCESSORY_DEFAULT_COLOR: Record<AccessoryId, string> = {
  helmet: '#f2b705', cap: '#3b6fd4', hat: '#8a5a2b', backpack: '#7a5230', pickaxe: '#8c8f94', scarf: '#c8312b', belt: '#4a3524', gloves: '#2b2b33', kneepads: '#4b4f57', glasses: '#222831',
};
export const accessory = (id: AccessoryId, color?: string) => ({ id, color: color ?? ACCESSORY_DEFAULT_COLOR[id] });

export function createDoll(name = 'Omino', patch: Partial<Doll> = {}): Doll {
  return {
    id: uid('doll'), name, body: { ...BASE_BODY },
    colors: { skin: '#f0c8a0', hair: '#4a2e1b', top: '#4f8cff', bottom: '#4b5563', shoes: '#3a2a1c', accent: '#f5b84a', outline: '#10131a' },
    features: { hair: 'short', face: 'smile', top: 'tshirt', bottom: 'long', shoes: 'sneakers' },
    accessories: [], style: { outline: 0.0065, farShade: 0.28 }, motion: { vivacity: 1 }, ...patch,
  };
}

export interface DollPreset { id: string; label: string; make: () => Doll }

/** Ready-made starting points. */
export const DOLL_PRESETS: DollPreset[] = [
  { id: 'miner', label: 'Minatore', make: () => createDoll('Minatore', {
    colors: { skin: '#e8b88f', hair: '#4a2e1b', top: '#cdbd98', bottom: '#6b6a3a', shoes: '#7a5230', accent: '#c8312b', outline: '#10131a' },
    features: { hair: 'messy', face: 'smile', top: 'shirt', bottom: 'cargo', shoes: 'boots' },
    accessories: [accessory('helmet'), accessory('backpack'), accessory('pickaxe'), accessory('scarf'), accessory('belt'), accessory('gloves'), accessory('kneepads')],
    body: { ...BASE_BODY, torsoWidth: 0.14, armThickness: 0.024 }, motion: { vivacity: 1.05 } }) },
  { id: 'explorer', label: 'Esploratrice', make: () => createDoll('Esploratrice', {
    colors: { skin: '#d9a47a', hair: '#2a1a12', top: '#3b8f6d', bottom: '#8a6a3a', shoes: '#4a3524', accent: '#f5b84a', outline: '#10131a' },
    features: { hair: 'ponytail', face: 'smile', top: 'vest', bottom: 'shorts', shoes: 'boots' },
    accessories: [accessory('hat'), accessory('backpack'), accessory('belt')], body: { ...BASE_BODY, torsoWidth: 0.115, hips: 1.1, legThickness: 0.033 } }) },
  { id: 'chibi', label: 'Piccolo (testa grande)', make: () => createDoll('Piccolo', {
    colors: { skin: '#f0c8a0', hair: '#c0572b', top: '#f5b84a', bottom: '#2f6f9f', shoes: '#f0f0f0', accent: '#c8312b', outline: '#10131a' },
    features: { hair: 'bun', face: 'dots', top: 'tshirt', bottom: 'shorts', shoes: 'sneakers' },
    accessories: [accessory('cap', '#c8312b')], body: { ...BASE_BODY, headSize: 0.3, headWidth: 1.05, torso: 0.24, torsoWidth: 0.15, arm: 0.3, armThickness: 0.028, legThickness: 0.045, hand: 0.06, foot: 0.13 }, motion: { vivacity: 1.2 } }) },
  { id: 'tall', label: 'Slanciato', make: () => createDoll('Slanciato', {
    colors: { skin: '#b98260', hair: '#101010', top: '#222831', bottom: '#222831', shoes: '#101010', accent: '#8a5ad6', outline: '#0a0c11' },
    features: { hair: 'long', face: 'stern', top: 'jacket', bottom: 'long', shoes: 'boots' },
    accessories: [accessory('scarf', '#8a5ad6'), accessory('gloves')], body: { ...BASE_BODY, headSize: 0.14, neck: 0.04, torso: 0.33, torsoWidth: 0.1, arm: 0.4, armThickness: 0.018, legThickness: 0.028, hand: 0.045, foot: 0.11 }, motion: { vivacity: 0.9 } }) },
];

const HAIR = ['none', 'short', 'messy', 'long', 'ponytail', 'bun'] as const;
const FACE = ['dots', 'simple', 'smile', 'stern'] as const;
const TOP = ['tshirt', 'shirt', 'jacket', 'vest'] as const;
const BOTTOM = ['long', 'shorts', 'cargo'] as const;
const SHOES = ['boots', 'sneakers', 'bare'] as const;
const SKIN = ['#f0c8a0', '#e8b88f', '#d9a47a', '#b98260', '#8c5a3c', '#5e3b26'];
const HAIRC = ['#2a1a12', '#4a2e1b', '#7a4b24', '#c0572b', '#d8b45a', '#101010', '#6b6b73', '#8a5ad6'];
const CLOTH = ['#4f8cff', '#3b8f6d', '#c8312b', '#f5b84a', '#8a5ad6', '#cdbd98', '#2f6f9f', '#222831', '#e9e4d8', '#6b6a3a'];

/** A new, different character on every call (seeded: same seed → same omino). */
export function randomDoll(seed = Math.floor(Math.random() * 1e9)): Doll {
  const r = createRng(seed), pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length) % a.length];
  const range = (lo: number, hi: number) => Math.round((lo + r() * (hi - lo)) * 1000) / 1000;
  const pool: AccessoryId[] = ['helmet', 'cap', 'hat', 'backpack', 'pickaxe', 'scarf', 'belt', 'gloves', 'kneepads', 'glasses'];
  const heads: AccessoryId[] = ['helmet', 'cap', 'hat'];
  const chosen = new Set<AccessoryId>();
  if (r() < 0.6) chosen.add(pick(heads));
  for (const a of pool) if (!heads.includes(a) && r() < 0.28) chosen.add(a);
  if (chosen.has('pickaxe')) chosen.add('backpack');
  const d = createDoll(`Omino ${seed % 1000}`, {
    body: { headSize: range(0.15, 0.28), headWidth: range(0.9, 1.15), neck: range(0.02, 0.045), torso: range(0.25, 0.33), torsoWidth: range(0.1, 0.15), hips: range(0.9, 1.15),
      arm: range(0.3, 0.4), armThickness: range(0.018, 0.028), legThickness: range(0.03, 0.045), hand: range(0.045, 0.06), foot: range(0.1, 0.14) },
    colors: { skin: pick(SKIN), hair: pick(HAIRC), top: pick(CLOTH), bottom: pick(CLOTH), shoes: pick(['#3a2a1c', '#7a5230', '#101010', '#f0f0f0']), accent: pick(CLOTH), outline: '#10131a' },
    features: { hair: pick(HAIR), face: pick(FACE), top: pick(TOP), bottom: pick(BOTTOM), shoes: pick(SHOES) },
    accessories: [...chosen].map((id) => accessory(id, id === 'scarf' || id === 'cap' ? pick(CLOTH) : undefined)), motion: { vivacity: range(0.85, 1.3) },
  });
  return d;
}
