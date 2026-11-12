import type { Environment, NavigationNode } from '@/types';

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

export function nodeScale(env: Pick<Environment, 'perspective'>, n: Pick<NavigationNode, 'y' | 'props'> | undefined): number {
  if (!n) return 1;
  const v = Number.parseFloat(n.props?.scale ?? '');
  return Number.isFinite(v) && v > 0 ? v : baseScale(env, n.y);
}

export const scaleAlong = (env: Pick<Environment, 'perspective'>, a: NavigationNode | undefined, b: NavigationNode | undefined, u: number): number => {
  const sa = nodeScale(env, a), sb = nodeScale(env, b), t = Math.min(1, Math.max(0, u));
  return sa + (sb - sa) * t;
};
