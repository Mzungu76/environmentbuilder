'use client';

import type { Environment } from '@/types';
import type { EditorStore } from '@/lib/store/editorStore';
import { CheckField, NumberField } from './fields';
import { LightControls } from './LightControls';
import { ZonesPanel } from './ZonesPanel';
import styles from '../editor/editor.module.css';

/** How the scene affects the characters: perspective (they shrink in the depth) and light (they take the light of the zone they walk through). */
export function ScenePanel({ store, env }: { store: EditorStore; env: Environment }) {
  const p = env.perspective;
  const setP = (v: Environment['perspective']) => store.commitEnv((e) => ({ ...e, perspective: v }));
  return (
    <div className={styles.section} data-testid="scene-panel">
      <h4>Prospettiva</h4>
      <CheckField id="persp-on" label="Il personaggio si rimpicciolisce in profondità" checked={!!p} onChange={(v) => setP(v ? { topScale: 0.6, bottomScale: 1 } : undefined)} />
      {p && (
        <>
          <div className={styles.row2}>
            <NumberField id="persp-top" label="In alto nell’immagine (%)" value={Math.round(p.topScale * 100)} min={5} max={300} step={5} onCommit={(v) => setP({ ...p, topScale: v / 100 })} />
            <NumberField id="persp-bot" label="In basso nell’immagine (%)" value={Math.round(p.bottomScale * 100)} min={5} max={300} step={5} onCommit={(v) => setP({ ...p, bottomScale: v / 100 })} />
          </div>
          <span className={styles.help}>Scala automatica in base all’altezza dove si trova il personaggio. Dove non basta (un tunnel che si stringe, una scala verso il fondo) imposta la scala di ogni nodo: ha la precedenza e nei percorsi passa gradualmente da un nodo all’altro. Con la distanza anche i passi si accorciano.</span>
        </>
      )}
      <ZonesPanel store={store} env={env} />
      <LightControls store={store} env={env} />
    </div>
  );
}

