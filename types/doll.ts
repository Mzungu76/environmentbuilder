/** "Omino": a procedural character built from adjustable parts (no image needed). Added in schema v4. */

export type HairStyle = 'none' | 'short' | 'messy' | 'long' | 'ponytail' | 'bun';
export type FaceStyle = 'dots' | 'simple' | 'smile' | 'stern';
export type TopStyle = 'tshirt' | 'shirt' | 'jacket' | 'vest';
export type BottomStyle = 'long' | 'shorts' | 'cargo';
export type ShoeStyle = 'boots' | 'sneakers' | 'bare';
export type AccessoryId = 'helmet' | 'cap' | 'hat' | 'backpack' | 'pickaxe' | 'scarf' | 'belt' | 'gloves' | 'kneepads' | 'glasses';

export interface DollAccessory { id: AccessoryId; color: string }

export interface Doll {
  id: string;
  name: string;
  /** Proportions as fractions of the total height (the figure is always 1000 units tall). */
  body: {
    headSize: number;
    headWidth: number;
    neck: number;
    torso: number;
    torsoWidth: number;
    hips: number;
    arm: number;
    armThickness: number;
    legThickness: number;
    hand: number;
    foot: number;
  };
  colors: { skin: string; hair: string; top: string; bottom: string; shoes: string; accent: string; outline: string };
  features: { hair: HairStyle; face: FaceStyle; top: TopStyle; bottom: BottomStyle; shoes: ShoeStyle };
  accessories: DollAccessory[];
  style: { outline: number; farShade: number };
  /** Movement personality: vivacity scales the amplitude of every animation. */
  motion: { vivacity: number };
}
