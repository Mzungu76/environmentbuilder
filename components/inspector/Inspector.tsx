'use client';


import type { EdgeDirection, Environment, NavigationEdge, NavigationNode } from '@/types';
import type { EditorStore, Selection } from '@/lib/store/editorStore';
import { reverseEdge, updateEdge, updateNode, validateGraph, moveNode } from '@/engine/navigation/graph';
import { edgeLengthPx } from '@/engine/navigation/geometry';
import { ALL_NODE_TYPES, allEdgeTypes, allProfiles, suggestedTypes } from '@/engine/profiles';
import { getMovementType, movementTypes } from '@/engine/movement/movementTypes';
import { ProfilesPanel } from './ProfilesPanel';
import { Icon } from '@/components/ui/icons';
import styles from '../editor/editor.module.css';
import { CheckField, Field, NumberField, PropsField, TextField } from './fields';
import { CharacterPanel } from './CharacterPanel';
import { ObjectPanel } from './ObjectPanel';
import { LayersPanel } from './LayersPanel';
import { objectIssues, objectTypeInfo } from '@/engine/interaction/objects';
import { createCharacter } from '@/engine/characters/factory';

/* ---- inspector -------------------------------------------------------------------------------- */

interface Props { store: EditorStore; env: Environment; selection: Selection; revision: number; open?: boolean; onFit: () => void; onReplaceImage: () => void; onToggleCurve: (id: string) => void; onDeleteSelection: () => void }

export function Inspector({ store, env, selection, open, onFit, onReplaceImage, onToggleCurve, onDeleteSelection }: Props) {
  const nav = env.navigation;
  const node = selection?.kind === 'node' ? nav.nodes.find((n) => n.id === selection.id) : undefined;
  const edge = selection?.kind === 'edge' ? nav.edges.find((e) => e.id === selection.id) : undefined;
  const obj = selection?.kind === 'object' ? env.objects.find((o) => o.id === selection.id) : undefined;
  const chr = selection?.kind === 'character' ? env.characters.find((c) => c.id === selection.id) : undefined;
  const select = (s: Selection) => store.setSelection(s);

  return (
    <aside className={`${styles.inspector} ${open ? styles.inspectorOpen : ''}`} aria-label="Inspector" data-testid="inspector">
      <div className={styles.inspHead}>
        <h3>{node ? 'Nodo' : edge ? 'Percorso' : chr ? 'Personaggio' : obj ? 'Oggetto' : 'Ambiente'}</h3>
        {(node || edge || chr || obj) && <button className={`${styles.btn} ${styles.btnDanger}`} onClick={onDeleteSelection} title="Elimina (Canc)" data-testid="delete-selected">{Icon.trash}Elimina</button>}
      </div>
      {obj ? <ObjectPanel store={store} env={env} o={obj} />
        : chr ? <CharacterPanel store={store} env={env} c={chr} />
        : node ? <NodePanel store={store} env={env} node={node} select={select} />
        : edge ? <EdgePanel store={store} env={env} edge={edge} select={select} onToggleCurve={onToggleCurve} />
        : <EnvPanel store={store} env={env} onFit={onFit} onReplaceImage={onReplaceImage} />}
    </aside>
  );
}

function NodePanel({ store, env, node, select }: { store: EditorStore; env: Environment; node: NavigationNode; select: (s: Selection) => void }) {
  const nav = env.navigation;
  const sug = suggestedTypes(env.profiles, store.project.customProfiles);
  const types = Array.from(new Set([...ALL_NODE_TYPES, node.type]));
  const edit = (patch: Partial<NavigationNode>) => store.commitEnv((e) => ({ ...e, navigation: updateNode(e.navigation, node.id, patch) }));
  const move = (x: number, y: number) => store.commitEnv((e) => ({ ...e, navigation: moveNode(e.navigation, node.id, x, y) }));
  const links = nav.edges.filter((e) => e.from === node.id || e.to === node.id);
  return (
    <>
      <div className={styles.section}>
        <TextField id="n-id" label="ID" value={node.id} readOnly mono />
        <TextField id="n-name" label="Nome" value={node.name} onCommit={(v) => edit({ name: v })} />
        <Field label="Tipo" id="n-type">
          <select id="n-type" className={styles.select} value={node.type} onChange={(e) => edit({ type: e.target.value })}>
            {types.map((t) => <option key={t} value={t}>{t}{sug.nodes.has(t) ? '' : ' (fuori profilo)'}</option>)}
          </select>
        </Field>
      </div>
      <div className={styles.section}>
        <h4>Posizione (px dell’immagine originale)</h4>
        <div className={styles.row2}>
          <NumberField id="n-x" label="X" value={Math.round(node.x * env.width)} min={0} max={env.width} onCommit={(v) => move(v / env.width, node.y)} />
          <NumberField id="n-y" label="Y" value={Math.round(node.y * env.height)} min={0} max={env.height} onCommit={(v) => move(node.x, v / env.height)} />
        </div>
        <span className={styles.help}>Normalizzate: {node.x.toFixed(4)}, {node.y.toFixed(4)}</span>
      </div>
      <div className={styles.section}>
        <h4>Collegamenti ({links.length})</h4>
        <div className={styles.list}>
          {links.length === 0 && <span className={styles.warn}>Non collegato. Usa lo strumento Collega nodi.</span>}
          {links.map((e) => {
            const otherId = e.from === node.id ? e.to : e.from;
            const other = nav.nodes.find((n) => n.id === otherId);
            return <button key={e.id} className={styles.listItem} onClick={() => select({ kind: 'edge', id: e.id })}><span>{e.from === node.id ? '→' : '←'} {other?.name ?? otherId}</span><span className={styles.badge}>{e.type}</span></button>;
          })}
        </div>
      </div>
      <div className={styles.section}><PropsField id="n-props" value={node.props} onCommit={(p) => edit({ props: p })} /></div>
    </>
  );
}

function EdgePanel({ store, env, edge, select, onToggleCurve }: { store: EditorStore; env: Environment; edge: NavigationEdge; select: (s: Selection) => void; onToggleCurve: (id: string) => void }) {
  const nav = env.navigation;
  const a = nav.nodes.find((n) => n.id === edge.from), b = nav.nodes.find((n) => n.id === edge.to);
  const sug = suggestedTypes(env.profiles, store.project.customProfiles);
  const types = Array.from(new Set([...allEdgeTypes(), edge.type]));
  const edit = (patch: Partial<NavigationEdge>) => store.commitEnv((e) => ({ ...e, navigation: updateEdge(e.navigation, edge.id, patch) }));
  const len = a && b ? Math.round(edgeLengthPx(a, b, edge.geometry, env.width, env.height)) : 0;
  return (
    <>
      <div className={styles.section}>
        <TextField id="e-id" label="ID" value={edge.id} readOnly mono />
        <Field label="Tipo" id="e-type">
          <select id="e-type" className={styles.select} value={edge.type} onChange={(e) => edit({ type: e.target.value })}>
            {types.map((t) => <option key={t} value={t}>{getMovementType(t).label}{sug.edges.has(t) ? '' : ' (fuori profilo)'}</option>)}
          </select>
        </Field>
      </div>
      <div className={styles.section}>
        <h4>Connessione</h4>
        <div className={styles.list}>
          <button className={styles.listItem} onClick={() => a && select({ kind: 'node', id: a.id })}><span>Da: {a?.name ?? edge.from}</span></button>
          <button className={styles.listItem} onClick={() => b && select({ kind: 'node', id: b.id })}><span>A: {b?.name ?? edge.to}</span></button>
        </div>
        <Field label="Direzione consentita" id="e-dir">
          <select id="e-dir" className={styles.select} value={edge.direction} onChange={(e) => edit({ direction: e.target.value as EdgeDirection })}>
            <option value="both">Entrambi i sensi</option>
            <option value="forward">Solo Da → A</option>
            <option value="backward">Solo A → Da</option>
          </select>
        </Field>
        <button className={styles.btn} onClick={() => store.commitEnv((e) => ({ ...e, navigation: reverseEdge(e.navigation, edge.id) }))}>{Icon.swap}Inverti percorso</button>
      </div>
      <div className={styles.section}>
        <h4>Geometria</h4>
        <button className={styles.btn} onClick={() => onToggleCurve(edge.id)} data-testid="toggle-curve">{Icon.curve}{edge.geometry.kind === 'line' ? 'Converti in curva' : 'Raddrizza'}</button>
        {edge.geometry.kind === 'bezier' && <span className={styles.help}>Trascina le maniglie gialle sulla scena (strumento Seleziona) per modellare la curva.</span>}
        <span className={styles.help}>Lunghezza: {len}px</span>
      </div>
      <div className={styles.section}>
        <h4>Movimento</h4>
        <NumberField id="e-speed" label="Moltiplicatore di velocità" value={edge.speed} min={0.1} max={10} step={0.1} onCommit={(v) => edit({ speed: v })} help="Applicato alla velocità base del personaggio." />
        <TextField id="e-req" label="Requisiti" value={edge.requirements.join(', ')} onCommit={(v) => edit({ requirements: v.split(',').map((s) => s.trim()).filter(Boolean) })} />
        <span className={styles.help}>Abilità richieste, separate da virgola (es. can-climb). Un personaggio senza tutte le abilità non può percorrere il collegamento.</span>
      </div>
      <div className={styles.section}>
        <Field label="Vista del personaggio con scheletro" id="e-view" help="Per i personaggi creati nello Studio: su questo collegamento mostra il profilo, il fronte o il retro (es. scale verso lo spettatore). Automatico = profilo mentre cammina.">
          <select id="e-view" className={styles.select} value={edge.props.view ?? ''} data-testid="edge-view"
            onChange={(ev) => { const props = { ...edge.props }; if (ev.target.value) props.view = ev.target.value; else delete props.view; edit({ props }); }}>
            <option value="">Automatica</option><option value="side">Profilo</option><option value="front">Fronte</option><option value="back">Retro</option>
          </select>
        </Field>
      </div>
      <div className={styles.section}><PropsField id="e-props" value={edge.props} onCommit={(p) => edit({ props: p })} /></div>
    </>
  );
}

function EnvPanel({ store, env, onFit, onReplaceImage }: { store: EditorStore; env: Environment; onFit: () => void; onReplaceImage: () => void }) {
  const bg = env.layers.find((l) => l.role === 'background');
  const asset = env.assets.find((a) => a.id === bg?.assetId);
  const issues = validateGraph(env.navigation);
  return (
    <>
      <div className={styles.section}>
        <TextField id="env-id" label="ID" value={env.id} readOnly mono />
        <TextField id="env-name" label="Nome" value={env.name} onCommit={(v) => store.commitEnv((e) => ({ ...e, name: v }))} />
      </div>
      <div className={styles.section}>
        <h4>Immagine di sfondo</h4>
        {asset ? (
          <div className={styles.help} style={{ color: 'var(--text-dim)' }}>
            <div>{asset.fileName}</div>
            <div>{asset.width} × {asset.height}px · {asset.mime.replace('image/', '').toUpperCase()} · {(asset.bytes / 1024).toFixed(0)} KB</div>
          </div>
        ) : <span className={styles.help}>Nessuna immagine.</span>}
        <button className={styles.btn} onClick={onFit}>{Icon.fit}Adatta vista</button>
        {!asset && <button className={styles.btn} onClick={onReplaceImage}>{Icon.image}Importa immagine</button>}
      </div>
      <LayersPanel store={store} env={env} />
      <div className={styles.section}>
        <h4>Oggetti ({env.objects.length})</h4>
        <div className={styles.list}>
          {env.objects.map((o) => (
            <button key={o.id} className={styles.listItem} onClick={() => store.setSelection({ kind: 'object', id: o.id })}>
              <span><i className={styles.swatchDot} style={{ background: '#' + objectTypeInfo(o.type).color.toString(16).padStart(6, '0'), marginRight: 8 }} />{o.name}</span>
              <span className={styles.badge}>{o.visible ? objectTypeInfo(o.type).label : 'nascosto'}</span>
            </button>
          ))}
        </div>
        {objectIssues(store.project, env).map((i, k) => <span key={k} className={styles.warn}>{i.message}</span>)}
        <span className={styles.help}>Aggiungili con lo strumento Oggetto (<kbd>I</kbd>).</span>
      </div>
      <ProfilesPanel store={store} env={env} />
      <div className={styles.section}>
        <h4>Personaggi ({env.characters.length})</h4>
        <div className={styles.list}>
          {env.characters.map((c) => (
            <button key={c.id} className={styles.listItem} onClick={() => store.setSelection({ kind: 'character', id: c.id })}>
              <span><i className={styles.swatchDot} style={{ background: c.color, marginRight: 8 }} />{c.name}</span>
              <span className={styles.badge}>{c.behavior.mode === 'manual' ? 'manuale' : 'autonomo'}</span>
            </button>
          ))}
        </div>
        <button className={styles.btn} data-testid="add-character" onClick={() => {
          const c = createCharacter(env.characters.length, env.navigation.nodes[0]?.id ?? null);
          store.commitEnv((e) => ({ ...e, characters: [...e.characters, c] }));
          store.setSelection({ kind: 'character', id: c.id });
        }}>{Icon.plus}Aggiungi personaggio</button>
        <span className={styles.help}>Posizionalo con lo strumento Personaggio (cliccando un nodo).</span>
      </div>
      <div className={styles.section}>
        <h4>Grafo di navigazione</h4>
        <span className={styles.help} style={{ color: 'var(--text-dim)' }}>{env.navigation.nodes.length} nodi · {env.navigation.edges.length} percorsi</span>
        {issues.slice(0, 6).map((i, k) => <span key={k} className={styles.warn}>{i.message}</span>)}
        {issues.length > 6 && <span className={styles.help}>+{issues.length - 6} altri</span>}
      </div>
      <div className={styles.section}>
        <h4>Legenda</h4>
        <div className={styles.legend}>
          {movementTypes().map((t) => (
            <span key={t.id}><i className={styles.swatch} style={{ background: '#' + t.color.toString(16).padStart(6, '0') }} />{t.label}</span>
          ))}
          <span><i className={styles.swatchDot} style={{ background: '#fff' }} />nodo · <i className={styles.swatchDot} style={{ background: '#22c55e' }} />ingresso · <i className={styles.swatchDot} style={{ background: '#ef4444' }} />uscita</span>
        </div>
      </div>
    </>
  );
}

