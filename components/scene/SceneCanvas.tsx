'use client';

import { useEffect, useRef } from 'react';
import { SceneView } from '@/engine/rendering/SceneView';
import { NavigationEditor } from '@/engine/navigation/NavigationEditor';
import type { EditorStore } from '@/lib/store/editorStore';
import { getAsset } from '@/lib/persistence/db';
import styles from '../editor/editor.module.css';

export interface SceneHandle {
  view: SceneView;
  editor: NavigationEditor;
}

interface Props {
  store: EditorStore;
  onReady: (h: SceneHandle | null) => void;
  onZoom: (z: number) => void;
  onAssetError: (assetId: string, message: string) => void;
}

/** Hosts the PixiJS canvas and keeps it synchronized with the store (layers, size, overlay). */
export function SceneCanvas({ store, onReady, onZoom, onAssetError }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cbs = useRef({ onReady, onZoom, onAssetError });
  cbs.current = { onReady, onZoom, onAssetError };

  useEffect(() => {
    const host = hostRef.current!;
    let cancelled = false;
    let view: SceneView | null = null;
    let editor: NavigationEditor | null = null;
    let unsub: (() => void) | null = null;

    SceneView.create(host)
      .then((v) => {
        if (cancelled) { v.destroy(); return; }
        view = v;
        v.onCamera = (z) => cbs.current.onZoom(z);
        v.onAssetError = (id, msg) => cbs.current.onAssetError(id, msg);
        editor = new NavigationEditor(store, v);

        let lastLayers: unknown = null, lastW = -1, lastH = -1;
        const sync = () => {
          const env = store.env;
          if (env.layers !== lastLayers || env.width !== lastW || env.height !== lastH) {
            const first = lastW === -1 || lastW === 0;
            lastLayers = env.layers; lastW = env.width; lastH = env.height;
            if (env.width && env.height) v.setEnvironmentSize(env.width, env.height, first);
            void v.setLayers(env.layers.map((layer) => ({ layer, blobLoader: () => getAsset(store.project.id, layer.assetId) })));
          }
        };
        unsub = store.subscribe(sync);
        sync();
        cbs.current.onReady({ view: v, editor });
      })
      .catch((err) => cbs.current.onAssetError('renderer', `Cannot start the renderer: ${err instanceof Error ? err.message : err}`));

    return () => {
      cancelled = true;
      cbs.current.onReady(null);
      unsub?.();
      editor?.dispose();
      view?.destroy();
    };
  }, [store]);

  return <div ref={hostRef} className={styles.stage} data-testid="stage" />;
}
