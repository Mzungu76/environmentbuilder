'use client';

import { useState, useSyncExternalStore } from 'react';
import type { Environment } from '@/types';
import type { EditorStore } from '@/lib/store/editorStore';
import type { PlaytestController } from '@/engine/simulation/PlaytestController';
import { BehaviorFields } from '@/components/inspector/CharacterFields';
import { CheckField, Field } from '@/components/inspector/fields';
import { Icon } from '@/components/ui/icons';
import styles from '../editor/editor.module.css';

const STATE_IT: Record<string, string> = { IDLE: 'IDLE (fermo)', WALK: 'WALK (cammina)', CLIMB: 'CLIMB (si arrampica)', INTERACT: 'INTERACT', COLLECT: 'COLLECT', JUMP: 'JUMP', FALL: 'FALL', CUSTOM: 'CUSTOM' };

export function PlaytestPanel({ store, env, ctrl, showPaths, open }: { store: EditorStore; env: Environment; ctrl: PlaytestController; showPaths: boolean; open: boolean }) {
  const v = useSyncExternalStore(ctrl.subscribe, ctrl.getView, ctrl.getView);
  const [diag, setDiag] = useState(true);
  const [dest, setDest] = useState('');
  const chars = ctrl.listCharacters().filter((c) => v.snapshots[c.id]);
  const visitor = !!v.activeId && ctrl.isVisitor(v.activeId);
  const c = chars.find((x) => x.id === v.activeId);
  const snap = c ? v.snapshots[c.id] : undefined;
  const nodes = env.navigation.nodes;
  const nodeName = (id: string | null) => (id ? nodes.find((n) => n.id === id)?.name ?? id : '—');
  const edge = snap?.edgeId ? env.navigation.edges.find((e) => e.id === snap.edgeId) : undefined;
  const playing = v.status === 'playing';

  return (
    <aside className={`${styles.inspector} ${open ? styles.inspectorOpen : ''}`} aria-label="Pannello Playtest" data-testid="playtest-panel">
      <div className={styles.inspHead}>
        <h3>Playtest</h3>
        <span className={styles.badge} data-testid="play-status">{v.status === 'playing' ? 'In esecuzione' : v.status === 'paused' ? 'In pausa' : 'Fermo'}</span>
      </div>

      <div className={styles.section}>
        <div className={styles.row2} style={{ gridTemplateColumns: '1fr 1fr' }}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => ctrl.play()} disabled={playing || !chars.length} data-testid="pt-play">{Icon.play}Play</button>
          <button className={styles.btn} onClick={() => ctrl.pause()} disabled={!playing} data-testid="pt-pause">{Icon.pause}Pausa</button>
          <button className={styles.btn} onClick={() => ctrl.stop()} disabled={!chars.length} data-testid="pt-stop">{Icon.stop}Stop</button>
          <button className={styles.btn} onClick={() => ctrl.reset()} disabled={!chars.length} data-testid="pt-reset">{Icon.reset}Reset</button>
        </div>
        <span className={styles.help}><kbd>Spazio</kbd> Play/Pausa</span>
        <div role="status" aria-live="polite" data-testid="pt-message" style={{ minHeight: 20 }} className={v.message?.kind === 'error' ? styles.warn : styles.help}>{v.message?.text ?? ''}</div>
      </div>

      {!!chars.length && (
        <div className={styles.section} data-testid="pt-game">
          <h4>Gioco di prova</h4>
          <span className={styles.help}>Simula ciò che farà l’app di gioco: quando due dadi sono uguali il personaggio si ferma, raccoglie e esulta.</span>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => ctrl.triggerCollect()} disabled={v.game.collapse.collapsed} data-testid="pt-trigger">🎲 Dadi uguali: trova un oggetto</button>
          <div data-testid="pt-score" style={{ fontSize: 13 }}>Punti: <strong>{v.game.points}</strong>{Object.keys(v.game.counts).length ? ' — ' + Object.entries(v.game.counts).map(([k, n]) => `${k} ×${n}`).join(', ') : ''}</div>
          {v.game.collapse.enabled && (
            <>
              <div role="progressbar" aria-label="Tremore della grotta" aria-valuenow={Math.round(v.game.collapse.intensity * 100)} style={{ height: 8, borderRadius: 4, background: 'var(--panel-2, #222)', overflow: 'hidden' }}>
                <div style={{ width: `${Math.round(v.game.collapse.intensity * 100)}%`, height: '100%', background: v.game.collapse.intensity > 0.7 ? '#ef4444' : '#f59e0b' }} />
              </div>
              <span className={styles.help} data-testid="pt-collapse">{v.game.collapse.collapsed ? 'La grotta è crollata.' : 'La grotta trema… non si sa quando cederà. Reset = nuova estrazione.'}</span>
            </>
          )}
        </div>
      )}
      {!chars.length ? (
        <div className={styles.section}>
          <span className={styles.warn}>{nodes.length === 0 ? 'Nessun nodo: disegna almeno un percorso nell’editor.' : 'Nessun personaggio: torna all’editor e aggiungine uno (strumento Personaggio).'}</span>
        </div>
      ) : (
        <>
          <div className={styles.section}>
            <h4>Personaggio</h4>
            {chars.length > 1 && (
              <Field label="Personaggio attivo" id="pt-char">
                <select id="pt-char" className={styles.select} value={v.activeId ?? ''} onChange={(e) => ctrl.setActive(e.target.value)}>
                  {chars.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </Field>
            )}
            {c && (
              <>
                <div className={styles.seg} role="group" aria-label="Modalità di movimento" style={{ width: '100%' }}>
                  {(['manual', 'autonomous'] as const).map((m) => (
                    <button key={m} style={{ flex: 1 }} aria-pressed={c.behavior.mode === m} data-testid={`pt-mode-${m}`}
                      onClick={() => { ctrl.setMode(c.id, m); if (m === 'autonomous') ctrl.play(); }}>
                      {m === 'manual' ? 'Manuale' : 'Autonomo'}
                    </button>
                  ))}
                </div>
                {c.behavior.mode === 'manual' ? (
                  <>
                    <span className={styles.help}>Clicca un nodo sulla scena (cerchi bianchi) oppure scegli la destinazione qui sotto.</span>
                    <div className={styles.row2} style={{ gridTemplateColumns: '1fr auto' }}>
                      <select className={styles.select} aria-label="Nodo di destinazione" value={dest} onChange={(e) => setDest(e.target.value)} data-testid="pt-dest">
                        <option value="">Destinazione…</option>
                        {nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                      </select>
                      <button className={styles.btn} disabled={!dest} onClick={() => ctrl.goTo(dest)} data-testid="pt-go">Vai</button>
                    </div>
                    <button className={styles.btn} onClick={() => ctrl.haltActive()}>{Icon.stop}Ferma il personaggio</button>
                  </>
                ) : <span className={styles.help}>Sceglie da solo destinazioni raggiungibili, fa soste e può invertire la marcia.</span>}
              </>
            )}
          </div>

          <div className={styles.section}>
            <h4>Visualizzazione</h4>
            <CheckField id="pt-paths" label="Mostra percorsi e nodi di progetto" checked={showPaths} onChange={(v2) => store.setShowPaths(v2)} />
            <CheckField id="pt-diag" label="Pannello diagnostico" checked={diag} onChange={setDiag} />
          </div>

          {(v.available.length > 0 || Object.keys(v.inventory).length > 0 || v.events.length > 0) && (
            <div className={styles.section} data-testid="interaction-panel">
              <h4>Interazioni</h4>
              {v.available.length > 0 && (
                <div className={styles.list}>
                  {v.available.map((a) => <button key={a.objectId + a.interactionId} className={styles.listItem} onClick={() => ctrl.interact(a.objectId, a.interactionId)} data-testid="interact-btn"><span>{a.label}</span><span className={styles.badge}>{a.objectName}</span></button>)}
                </div>
              )}
              {Object.keys(v.inventory).length > 0 && (
                <div data-testid="inventory"><span className={styles.help}>Inventario</span>
                  <div className={styles.checkGrid}>{Object.entries(v.inventory).map(([k, n]) => <span key={k} className={styles.chip}>{k} × {n}</span>)}</div>
                </div>
              )}
              {v.events.length > 0 && (
                <div><span className={styles.help}>Eventi inviati al gioco ospite</span>
                  <ol className={styles.help} style={{ margin: '4px 0 0', paddingLeft: 18 }} data-testid="event-log">
                    {v.events.slice().reverse().map((e, k) => <li key={k}><b>{e.type}</b>{e.event ? ` · ${e.event}` : e.kind ? ` · ${e.kind}` : ''} — {e.character}{e.objectName ? ` / ${e.objectName}` : ''}</li>)}
                  </ol>
                </div>
              )}
            </div>
          )}

          {diag && snap && c && (
            <div className={styles.section} data-testid="diagnostics">
              <h4>Diagnostica</h4>
              <dl className={styles.diag}>
                <dt>Posizione</dt><dd>{Math.round(snap.x * env.width)}, {Math.round(snap.y * env.height)} px<br /><small>({snap.x.toFixed(4)}, {snap.y.toFixed(4)})</small></dd>
                <dt>Nodo corrente</dt><dd data-testid="diag-node">{snap.nodeId ? nodeName(snap.nodeId) : `in transito (da ${nodeName(snap.lastNodeId)})`}</dd>
                <dt>Collegamento</dt><dd data-testid="diag-edge">{edge ? `${edge.type} · ${nodeName(edge.from)} → ${nodeName(edge.to)}` : '—'}</dd>
                <dt>Velocità</dt><dd>{Math.round(snap.speedPx)} px/s</dd>
                <dt>Animazione</dt><dd data-testid="diag-state">{STATE_IT[snap.state] ?? snap.state}</dd>
                <dt>Direzione</dt><dd>{snap.facing === 1 ? 'destra →' : '← sinistra'}</dd>
                <dt>Destinazione</dt><dd>{nodeName(snap.destinationId)}</dd>
                <dt>Percorso</dt><dd>{snap.routeNodeIds.length ? snap.routeNodeIds.map(nodeName).join(' → ') : '—'}</dd>
                {snap.waiting > 0 && (<><dt>Sosta</dt><dd>{snap.waiting.toFixed(1)} s</dd></>)}
                <dt>Tempo</dt><dd>{snap.time.toFixed(1)} s</dd>
              </dl>
            </div>
          )}

          {c && !visitor && <div className={styles.section}><h4>Parametri (modificano il personaggio)</h4><BehaviorFields store={store} c={c} idp="pt" /></div>}
          {c && visitor && <div className={styles.section}><span className={styles.help}>{c.name} è in visita da un altro ambiente: i suoi parametri si modificano nell’ambiente d’origine.</span></div>}
        </>
      )}
    </aside>
  );
}
