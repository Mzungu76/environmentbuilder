import type { GameEvent } from '@/engine/interaction/system';

/**
 * Host integration (browser). Every game event of the playtest is announced two ways:
 *  - `window` CustomEvent  "environment-builder:event"  (detail = GameEvent) for scripts on the same page;
 *  - `postMessage` to the parent window ({ source: 'environment-builder', event }) when embedded in an iframe.
 * See docs/MANUALE.md (Integrazione con altri giochi).
 */
export const HOST_EVENT = 'environment-builder:event';

export function emitHostEvent(event: GameEvent) {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(HOST_EVENT, { detail: event }));
    if (window.parent && window.parent !== window) window.parent.postMessage({ source: 'environment-builder', event }, '*');
  } catch { /* a misbehaving listener must never break the simulation */ }
}
