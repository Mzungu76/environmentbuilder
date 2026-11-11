import type { EdgeGeometry, NavigationEdge, NavigationGraph, NavigationNode, Vec2 } from '@/types';

export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Point on a cubic Bézier at t. */
export function bezierPoint(p0: Vec2, c1: Vec2, c2: Vec2, p1: Vec2, t: number): Vec2 {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return { x: a * p0.x + b * c1.x + c * c2.x + d * p1.x, y: a * p0.y + b * c1.y + c * c2.y + d * p1.y };
}

/** Default control points for converting a straight edge to a gentle curve. */
export function defaultBezier(a: Vec2, b: Vec2): EdgeGeometry {
  const dx = b.x - a.x, dy = b.y - a.y;
  return {
    kind: 'bezier',
    c1: { x: a.x + dx / 3 - dy * 0.15, y: a.y + dy / 3 + dx * 0.15 },
    c2: { x: a.x + (2 * dx) / 3 - dy * 0.15, y: a.y + (2 * dy) / 3 + dx * 0.15 },
  };
}

/**
 * Samples an edge into a polyline. `aspect` = width/height of the environment so that
 * distances are measured in pixel space, not distorted normalized space.
 */
export function sampleEdge(from: Vec2, to: Vec2, g: EdgeGeometry, segments = 24): Vec2[] {
  if (g.kind === 'line') return [from, to];
  const pts: Vec2[] = [];
  for (let i = 0; i <= segments; i++) pts.push(bezierPoint(from, g.c1, g.c2, to, i / segments));
  return pts;
}

/** Length of an edge in environment pixels. */
export function edgeLengthPx(from: Vec2, to: Vec2, g: EdgeGeometry, envW: number, envH: number): number {
  const pts = sampleEdge(from, to, g, 32);
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot((pts[i].x - pts[i - 1].x) * envW, (pts[i].y - pts[i - 1].y) * envH);
  return len;
}

/** Distance (in env pixels) from a point to a segment. */
export function distToSegmentPx(p: Vec2, a: Vec2, b: Vec2, envW: number, envH: number): number {
  const px = p.x * envW, py = p.y * envH, ax = a.x * envW, ay = a.y * envH, bx = b.x * envW, by = b.y * envH;
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function nodeById(g: NavigationGraph, id: string): NavigationNode | undefined {
  return g.nodes.find((n) => n.id === id);
}

export function edgePolyline(g: NavigationGraph, e: NavigationEdge, segments = 24): Vec2[] | null {
  const a = nodeById(g, e.from), b = nodeById(g, e.to);
  if (!a || !b) return null;
  return sampleEdge(a, b, e.geometry, segments);
}
