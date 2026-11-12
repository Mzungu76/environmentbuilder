import type { Environment, NavigationNode } from '@/types';
import { zonesScale } from './scaleZones';

/**
 * Perspective: where the scene recedes into the depth the character must get smaller.
 * - `env.perspective` = automatic scale by height in the image (top of the image = far = topScale, bottom = near = bottomScale);
 * - a node can fix its own scale (`props.scale`, e.g. 0.4 at the far end of a tunnel); along a path the scale is interpolated
 *   between the scales of its two nodes. A node without a value uses the automatic one.
 */
export const baseScale = (env: Pick<Environment, 'perspective'>, y: number): number => {
  const p = env.perspective;
  if (!p) return 1;
  const t = Math.min(1, Math.max(0, y));
  return p.topScale + (p.bottomScale - p.topScale) * t;
};

type Persp = Pick<Environment, 'perspective'> & Partial<Pick<Environment, 'scaleZones' | 'width' | 'height'>>;

/** Scale at a normalized position: automatic perspective by height, refined by the painted zones. */
export const scaleAt = (env: Persp, x: number, y: number): number => zonesScale(env, x, y, baseScale(env, y));

const explicit = (n: Pick<NavigationNode, 'props'> | undefined): number | null => {
  const v = Number.parseFloat(n?.props?.scale ?? '');
  return Number.isFinite(v) && v > 0 ? v : null;
};

/** A node's scale: the value set on the node, otherwise whatever the scene gives at its position. */
export function nodeScale(env: Persp, n: Pick<NavigationNode, 'x' | 'y' | 'props'> | undefined): number {
  if (!n) return 1;
  return explicit(n) ?? scaleAt(env, n.x, n.y);
}

/**
 * Scale along a path: between two nodes with their own scale it blends them; otherwise it follows the scene at the actual position
 * (`pos`, normalized), so a path that crosses a painted zone shrinks exactly where the zone is.
 */
export const scaleAlong = (env: Persp, a: NavigationNode | undefined, b: NavigationNode | undefined, u: number, pos?: { x: number; y: number }): number => {
  const ea = explicit(a), eb = explicit(b), t = Math.min(1, Math.max(0, u));
  if (ea === null && eb === null && pos) return scaleAt(env, pos.x, pos.y);
  const sa = nodeScale(env, a), sb = nodeScale(env, b);
  return sa + (sb - sa) * t;
};
