'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

export interface ViewXform { zoom: number; ox: number; oy: number; dpr: number }
export interface CanvasPointer { type: 'down' | 'move' | 'up'; x: number; y: number; button: number; shift: boolean; pointerType: string }

interface Props {
  /** Size of the content in its own coordinates (used for fit). */
  contentWidth: number;
  contentHeight: number;
  /** Draws in content coordinates (the context transform is already applied). */
  draw: (ctx: CanvasRenderingContext2D, v: ViewXform) => void;
  onPointer?: (e: CanvasPointer, v: ViewXform) => void;
  /** Re-draw whenever this value changes (cheap change counter from the parent). */
  version: number;
  /** Single-pointer drag pans instead of calling onPointer. */
  panMode?: boolean;
  cursor?: string;
  /** Changing this key re-fits the content to the window. */
  fitKey?: string;
  checker?: boolean;
  style?: CSSProperties;
  testId?: string;
}

/** Canvas with wheel/pinch zoom and pan; pointer positions are reported in content coordinates. */
export function ZoomCanvas({ contentWidth, contentHeight, draw, onPointer, version, panMode, cursor, fitKey, checker, style, testId }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const view = useRef<ViewXform>({ zoom: 1, ox: 0, oy: 0, dpr: 1 });
  const props = useRef({ draw, onPointer, panMode, checker, contentWidth, contentHeight });
  props.current = { draw, onPointer, panMode, checker, contentWidth, contentHeight };
  const raf = useRef(0);
  const [hand, setHand] = useState(false);
  const [coarse, setCoarse] = useState(false);
  const handRef = useRef(false);
  handRef.current = hand;
  useEffect(() => setCoarse(window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 900), []);

  const render = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const c = cv.current; if (!c) return;
      const ctx = c.getContext('2d')!; const v = view.current;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height);
      if (props.current.checker) {
        const s = 16 * v.dpr; ctx.fillStyle = '#2a2e37'; ctx.fillRect(0, 0, c.width, c.height); ctx.fillStyle = '#343946';
        for (let y = 0; y < c.height; y += s) for (let x = ((y / s) % 2) * s; x < c.width; x += s * 2) ctx.fillRect(x, y, s, s);
      }
      ctx.setTransform(v.zoom * v.dpr, 0, 0, v.zoom * v.dpr, v.ox * v.dpr, v.oy * v.dpr);
      props.current.draw(ctx, v);
    });
  }, []);

  const fit = useCallback(() => {
    const h = host.current; if (!h) return;
    const { contentWidth: cw, contentHeight: ch } = props.current;
    const z = Math.min(h.clientWidth / Math.max(1, cw), h.clientHeight / Math.max(1, ch)) * 0.94;
    view.current = { ...view.current, zoom: z, ox: (h.clientWidth - cw * z) / 2, oy: (h.clientHeight - ch * z) / 2 };
    render();
  }, [render]);

  useEffect(() => {
    const h = host.current!, c = cv.current!;
    const resize = () => { const dpr = Math.min(window.devicePixelRatio || 1, 2); view.current.dpr = dpr; c.width = Math.max(1, Math.round(h.clientWidth * dpr)); c.height = Math.max(1, Math.round(h.clientHeight * dpr)); render(); };
    const ro = new ResizeObserver(() => { const prevW = c.clientWidth, prevH = c.clientHeight; resize(); if (prevW && prevH) { view.current.ox += (h.clientWidth - prevW) / 2; view.current.oy += (h.clientHeight - prevH) / 2; render(); } });
    ro.observe(h); resize(); fit();
    return () => { ro.disconnect(); cancelAnimationFrame(raf.current); };
  }, [render, fit]);

  useEffect(() => { fit(); }, [fitKey, contentWidth, contentHeight, fit]);
  useEffect(() => { render(); }, [version, render]);

  useEffect(() => {
    const c = cv.current!;
    const pts = new Map<number, { x: number; y: number }>();
    let pan: { x: number; y: number } | null = null, pinch: { d: number; cx: number; cy: number } | null = null;
    const local = (e: PointerEvent | WheelEvent) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const toContent = (s: { x: number; y: number }) => ({ x: (s.x - view.current.ox) / view.current.zoom, y: (s.y - view.current.oy) / view.current.zoom });
    const zoomAt = (f: number, s: { x: number; y: number }) => {
      const v = view.current, z = Math.max(0.02, Math.min(40, v.zoom * f)), k = z / v.zoom;
      v.ox = s.x - (s.x - v.ox) * k; v.oy = s.y - (s.y - v.oy) * k; v.zoom = z; render();
    };
    const emit = (type: CanvasPointer['type'], e: PointerEvent) => { const p = toContent(local(e)); props.current.onPointer?.({ type, x: p.x, y: p.y, button: e.button, shift: e.shiftKey, pointerType: e.pointerType }, view.current); };
    const wheel = (e: WheelEvent) => { e.preventDefault(); zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), local(e)); };
    const down = (e: PointerEvent) => {
      c.setPointerCapture(e.pointerId); const s = local(e); pts.set(e.pointerId, s);
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }; pan = null; return; }
      if (e.button === 1 || e.button === 2 || props.current.panMode || handRef.current) { pan = s; return; }
      emit('down', e);
    };
    const move = (e: PointerEvent) => {
      const s = local(e); if (pts.has(e.pointerId)) pts.set(e.pointerId, s);
      if (pinch && pts.size >= 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2; view.current.ox += cx - pinch.cx; view.current.oy += cy - pinch.cy; if (pinch.d) zoomAt(d / pinch.d, { x: cx, y: cy }); pinch = { d, cx, cy }; return; }
      if (pan) { view.current.ox += s.x - pan.x; view.current.oy += s.y - pan.y; pan = s; render(); return; }
      emit('move', e);
    };
    const up = (e: PointerEvent) => { pts.delete(e.pointerId); if (pinch) { if (pts.size < 2) pinch = null; return; } if (pan) { pan = null; return; } emit('up', e); };
    c.addEventListener('wheel', wheel, { passive: false }); c.addEventListener('pointerdown', down); c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up); c.addEventListener('contextmenu', (e) => e.preventDefault());
    return () => { c.removeEventListener('wheel', wheel); c.removeEventListener('pointerdown', down); c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', up); c.removeEventListener('pointercancel', up); };
  }, [render]);

  return (
    <div ref={host} style={{ position: 'relative', width: '100%', height: '100%', minHeight: 240, background: '#14161a', borderRadius: 8, overflow: 'hidden', ...style }}>
      <canvas ref={cv} data-testid={testId} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none', cursor: hand ? 'grab' : cursor ?? 'default' }} />
      {coarse && <button onClick={() => setHand((h) => !h)} aria-pressed={hand} aria-label="Sposta la vista con un dito" title="Sposta la vista con un dito" data-testid="hand-toggle" style={{ position: 'absolute', left: 8, bottom: 8, height: 34, padding: '0 12px', borderRadius: 6, border: `1px solid ${hand ? 'var(--accent)' : 'var(--border)'}`, background: hand ? 'var(--accent-soft)' : 'rgba(23,26,32,.92)', color: 'var(--text)' }}>✋ Sposta</button>}
      <button onClick={fit} aria-label="Adatta alla finestra" title="Adatta alla finestra" style={{ position: 'absolute', right: 8, bottom: 8, height: 30, padding: '0 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'rgba(23,26,32,.92)', color: 'var(--text)' }}>Adatta</button>
    </div>
  );
}
