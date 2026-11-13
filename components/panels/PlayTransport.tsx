'use client';

import { useSyncExternalStore } from 'react';
import type { PlaytestController } from '@/engine/simulation/PlaytestController';
import { Icon } from '@/components/ui/icons';
import styles from '../editor/editor.module.css';

/** Floating Play / Pausa / Stop / Reset controls over the scene (always reachable, also on phones). */
export function PlayTransport({ ctrl }: { ctrl: PlaytestController }) {
  const v = useSyncExternalStore(ctrl.subscribe, ctrl.getView, ctrl.getView);
  const playing = v.status === 'playing';
  const none = !Object.keys(v.snapshots).length;
  return (
    <div className={styles.transport} role="group" aria-label="Controlli simulazione" data-testid="play-transport">
      <button className={`${styles.btn} ${styles.iconBtn} ${styles.btnPrimary}`} onClick={() => (playing ? ctrl.pause() : ctrl.play())} disabled={none} aria-label={playing ? 'Pausa' : 'Play'} title={playing ? 'Pausa (Spazio)' : 'Play (Spazio)'} data-testid="tr-play">{playing ? Icon.pause : Icon.play}</button>
      <button className={`${styles.btn} ${styles.iconBtn}`} onClick={() => ctrl.stop()} disabled={none} aria-label="Stop" title="Stop" data-testid="tr-stop">{Icon.stop}</button>
      <button className={`${styles.btn} ${styles.iconBtn}`} onClick={() => ctrl.reset()} disabled={none} aria-label="Reset" title="Reset" data-testid="tr-reset">{Icon.reset}</button>
      {none && <span className={styles.transportHint}>Aggiungi un personaggio nell’editor</span>}
    </div>
  );
}
