'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { Icon } from '@/components/ui/icons';
import styles from './shell.module.css';

/* ---- tiny store: install prompt + display mode ---- */
type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: BIPEvent | null = null;
let installed = false;
const subs = new Set<() => void>();
let snap = { canInstall: false, installed: false };
const emit = () => { snap = { canInstall: !!deferred, installed }; subs.forEach((f) => f()); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const getSnap = () => snap;
const serverSnap = { canInstall: false, installed: false };

const isStandalone = () => typeof window !== 'undefined' && (window.matchMedia('(display-mode: fullscreen)').matches || window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
const isIOS = () => typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
const isPhone = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;

async function goFullscreenLandscape() {
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch { /* refused: the page still works */ }
  try { await (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.('landscape'); } catch { /* not supported (iOS) or not allowed */ }
}

/** Mounted once: registers the service worker, captures the install prompt, and on a phone asks for fullscreen + landscape on the first tap. */
export function MobileShell() {
  const [portrait, setPortrait] = useState(false);
  useEffect(() => {
    installed = isStandalone(); emit();
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      void navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
    }
    const onPrompt = (e: Event) => { e.preventDefault(); deferred = e as BIPEvent; emit(); };
    const onInstalled = () => { deferred = null; installed = true; emit(); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);

    // Browsers only allow fullscreen / orientation lock from a user gesture, so it happens on the first tap.
    let first: (() => void) | null = null;
    if (isPhone() && !isStandalone()) {
      // keep trying on every tap until the browser actually grants it
      first = () => { void goFullscreenLandscape().then(() => { if (document.fullscreenElement) window.removeEventListener('pointerup', first!); }); };
      window.addEventListener('pointerup', first);
    }
    // iOS cannot lock the orientation: ask the user to turn the phone.
    const mq = window.matchMedia('(orientation: portrait)');
    const upd = () => setPortrait(isPhone() && mq.matches);
    upd(); mq.addEventListener('change', upd);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled);
      if (first) window.removeEventListener('pointerup', first);
      mq.removeEventListener('change', upd);
    };
  }, []);
  if (!portrait) return null;
  return (
    <div className={styles.rotate} role="alert" data-testid="rotate-overlay">
      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="7" y="2" width="10" height="20" rx="2" transform="rotate(90 12 12)" /><path d="M4 8a8 8 0 018-5M20 16a8 8 0 01-8 5" /></svg>
      <p>Ruota il telefono in orizzontale</p>
      <small>L’editor è pensato per lo schermo orizzontale.</small>
    </div>
  );
}

/** Install icon: native prompt where available (Chrome/Edge/Android), a short how-to on iOS. Hidden once installed. */
export function InstallButton({ className, label = true }: { className?: string; label?: boolean }) {
  const s = useSyncExternalStore(subscribe, getSnap, () => serverSnap);
  const [help, setHelp] = useState(false);
  const [ios, setIos] = useState(false);
  useEffect(() => setIos(isIOS()), []);
  if (s.installed || (!s.canInstall && !ios)) return null;
  const click = async () => {
    if (deferred) { const d = deferred; deferred = null; emit(); await d.prompt(); await d.userChoice.catch(() => {}); }
    else setHelp((h) => !h);
  };
  return (
    <span className={styles.installWrap}>
      <button className={className} onClick={click} title="Installa l’app sul dispositivo" aria-label="Installa l’app" data-testid="install-app">{Icon.install}{label && <span>Installa</span>}</button>
      {help && <span className={styles.iosHelp} role="note">Tocca <b>Condividi</b> e poi <b>Aggiungi a Home</b>.</span>}
    </span>
  );
}

/** Fullscreen toggle for browsers that allow it (not needed once the app is installed). */
export function FullscreenButton({ className }: { className?: string }) {
  const [on, setOn] = useState(false);
  const [ok, setOk] = useState(false);
  useEffect(() => {
    setOk(!!document.fullscreenEnabled && !isStandalone());
    const f = () => setOn(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', f);
    return () => document.removeEventListener('fullscreenchange', f);
  }, []);
  if (!ok) return null;
  return <button className={className} onClick={() => (on ? void document.exitFullscreen() : void goFullscreenLandscape())} data-testid="fullscreen">{Icon.fit}{on ? 'Esci da schermo intero' : 'Schermo intero'}</button>;
}

/** Round fullscreen button for the floating controls: only while the browser bars are showing. */
export function FullscreenFab({ className }: { className?: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const upd = () => setShow(!!document.fullscreenEnabled && !document.fullscreenElement && !isStandalone());
    upd(); document.addEventListener('fullscreenchange', upd);
    return () => document.removeEventListener('fullscreenchange', upd);
  }, []);
  if (!show) return null;
  return <button className={className} onClick={() => void goFullscreenLandscape()} aria-label="Schermo intero" title="Schermo intero" data-testid="fullscreen-fab">{Icon.fit}</button>;
}
