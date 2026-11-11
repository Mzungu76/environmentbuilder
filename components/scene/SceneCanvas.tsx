'use client';

import { useEffect, useRef } from 'react';
import { SceneView } from '@/engine/rendering/SceneView';
import { SceneController } from '@/engine/editor/SceneController';
import type { EditorStore } from '@/lib/store/editorStore';
import { getAsset } from '@/lib/persistence/db';
import styles from '../editor/editor.module.css';

export interface SceneHandle {
  view: SceneView;
  editor: SceneController;
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
    let editor: SceneController | null = null;
    let unsub: (() => void) | null = null;

    SceneView.create(host)
      .then((v) => {
        if (cancelled) { v.destroy(); return; }
        view = v;
        v.onCamera = (z) => cbs.current.onZoom(z);
        v.onAssetError = (id, msg) => cbs.current.onAssetError(id, msg);
        editor = new SceneController(store, v);

        let lastLayers: unknown = null, lastObjects: unknown = null, lastW = -1, lastH = -1, lastEnv = '';
        const sync = () => {
          const env = store.env;
          const layersChanged = env.layers !== lastLayers || env.width !== lastW || env.height !== lastH || env.id !== lastEnv;
          if (layersChanged) {
            const first = lastW === -1 || lastW === 0 || env.id !== lastEnv; // new environment → refit the camera
            lastLayers = env.layers; lastW = env.width; lastH = env.height; lastEnv = env.id;
            if (env.width && env.height) v.setEnvironmentSize(env.width, env.height, first);
            void v.setLayers(env.layers.map((layer) => ({ layer, blobLoader: () => getAsset(store.project.id, layer.assetId) })));
          }
          if (layersChanged || env.objects !== lastObjects) {
            lastObjects = env.objects;
            void v.setObjects(env.objects.map((object) => ({ object, blobLoader: () => object.assetId ? getAsset(store.project.id, object.assetId) : Promise.resolve(undefined) })));
          }
        };
        unsub = store.subscribe(sync);
        sync();
        cbs.current.onReady({ view: v, editor });
      })
      .catch((err) => cbs.current.onAssetError('renderer', `Impossibile avviare il renderer: ${err instanceof Error ? err.message : err}`));

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
