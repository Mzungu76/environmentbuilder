# Usare i personaggi dello Studio in un gioco

Lo Studio esporta ogni personaggio come **pacchetto ZIP** (*Anteprima ed esporta → Esporta pacchetto ZIP*):

```
puppet.json                scheletro, mesh, pesi e animazioni di ogni vista
textures/side.png          profilo (guarda a destra)
textures/front.png         fronte
textures/back.png          retro
textures/climb.png         arrampicata (opzionale, di profilo a destra)
textures/jump.png          salto e caduta (opzionale, di profilo a destra)
environment-runtime.mjs    runtime senza dipendenze (nessuna build)
demo.html                  lettore autonomo: doppio click, funziona anche da file://
README.md                  promemoria d'uso
```

Il progetto intero (*Esporta → ZIP*) contiene anche i personaggi (`puppets` in `project.json`, schema v3) con le loro immagini.

## Come funziona in breve
Ogni vista è **una sola immagine** deformata da uno **scheletro di 15 ossa**. A ogni frame il runtime:
1. sceglie la vista (`chooseView`);
2. avanza il tempo dell'animazione (`advancePhase`) e calcola la posa (`poseAt`);
3. restituisce i **vertici deformati** (`skinVertices`) da disegnare con le UV e gli indici della mesh.

Le coordinate dei vertici sono in **pixel della texture**; `view.pivot` è il punto di appoggio dei piedi e `view.figureHeight` l'altezza della figura in pixel (uguale per tutte le viste dopo la correzione fatta nello Studio).

## Esempio minimo (Canvas 2D)
```js
import * as R from './environment-runtime.mjs';
const data = await (await fetch('puppet.json')).json();
const img = {};                                   // texture per vista
for (const [id, v] of Object.entries(data.views)) { img[id] = new Image(); img[id].src = v.texture; await img[id].decode(); }

let phase = 0, state = 'IDLE';
function frame(dt, { moving, speedPx, targetHeightPx, x, y, facingLeft, viewHint }) {
  const vid = R.chooseViewForState(data.views, state, data.idleView, viewHint);   // 'side' | 'front' | 'back' | 'climb' | 'jump'
  const view = data.views[vid];
  phase = R.advancePhase(view, state, phase, dt, speedPx / targetHeightPx);  // passo sincronizzato alla velocità
  const pos = R.skinVertices(view, R.poseAt(view, state, phase));
  const scale = targetHeightPx / view.figureHeight;
  R.drawPuppet(ctx, img[vid], pos, view.mesh.uvs, view.mesh.indices,
    { x, y, scale, flip: facingLeft && R.flipsWithFacing(view), pivot: view.pivot });
}
```
`state` è lo stato del tuo personaggio: `IDLE`, `WALK`, `CLIMB`, `INTERACT`, `COLLECT`, `JUMP`, `FALL`, `CUSTOM`. Uno stato senza animazione usa IDLE.

## Con PixiJS (WebGL)
```js
import { MeshSimple, Assets } from 'pixi.js';
const tex = await Assets.load(view.texture);
const mesh = new MeshSimple({ texture: tex, vertices: new Float32Array(view.mesh.vertices),
  uvs: new Float32Array(view.mesh.uvs), indices: new Uint32Array(view.mesh.indices) });
mesh.pivot.set(view.pivot.x, view.pivot.y);
app.stage.addChild(mesh);
// ogni frame:
phase = R.advancePhase(view, state, phase, dt, speed / heightPx);
mesh.vertices = R.skinVertices(view, R.poseAt(view, state, phase), buffer);   // riusa lo stesso Float32Array
mesh.scale.set((heightPx / view.figureHeight) * (flip ? -1 : 1), heightPx / view.figureHeight);
mesh.position.set(feetX, feetY);
```
(Per cambiare vista serve una mesh per vista: crea tre `MeshSimple` e mostra quella scelta.)

## Convenzioni da rispettare
- **Orientamento:** profilo, salto e arrampicata guardano a **destra**. Per andare a sinistra specchia con `R.flipsWithFacing(view)` (vero per profilo e salto; falso per fronte, retro e arrampicata, salvo `view.flipWithFacing`).
- **Velocità e passo:** passa a `advancePhase` la velocità in *altezze del personaggio al secondo* (`px/s ÷ altezza in px`). Le clip di camminata hanno `cycleLength` (distanza per ciclo): il passo resta agganciato al terreno. Con velocità 0 la clip gira alla sua durata naturale.
- **Scelta della vista:** `chooseViewForState(views, state, idleView, hint)`: `climb` per CLIMB e `jump` per JUMP/FALL se il personaggio le ha, altrimenti di profilo quando ci si muove e `idleView` da fermi; `hint` (`'side'|'front'|'back'|'climb'|'jump'`) vince su tutto. (`chooseView` resta per chi non usa gli stati.) Nel builder il suggerimento è la proprietà `view` di un collegamento (Inspector del percorso); nel tuo gioco puoi usarla per scale verso lo spettatore, porte, ecc.
- **Ordine di disegno:** la mesh di profilo contiene anche le **copie degli arti lontani**, già ordinate dietro al corpo: disegna i triangoli nell'ordine dell'array `indices`.
- **Animazioni proprie:** le clip sono dati (`view.clips[].keys[].pose.rot` = gradi per osso, relativi al genitore). Puoi crearne altre da codice (`R.makePreset(kind, view, ampiezza)`) o dallo Studio.

## Ossa
`pelvis, torso, head, uarmL, farmL, handL, uarmR, farmR, handR, thighL, shinL, footL, thighR, shinR, footR`.
L/R = lati dell'immagine nelle viste fronte/retro; nel profilo **R = arti vicini, L = arti lontani**. Una posa è `{ rot: { thighR: -28, … }, dx, dy }` (rotazioni in gradi, positive in senso orario sullo schermo; `dx`/`dy` spostano il corpo, in altezze della figura).

## Eventi di gioco e ambienti
Per percorsi, uscite, interazioni e inventario degli ambienti vedi `docs/MANUALE.md` (sezione *Integrazione con altri giochi*) e la stessa libreria `environment-runtime.mjs` (`Agent`, `findRoute`, `resolveExit`, `availableInteractions`…): lo stesso file serve sia per muovere il personaggio sul grafo sia per animarlo.

## Compatibilità e versioni
`puppet.json` riporta `format: "environment-builder-puppet"` e `schemaVersion`. File di schemi precedenti si aggiornano con `R.migrateProject` (per i progetti interi). Il runtime non ha dipendenze e gira in qualunque browser moderno e in Node (solo `drawPuppet` richiede Canvas).

---

# Omini (personaggi procedurali)

Pacchetto: `doll.json`, `environment-runtime.mjs`, `demo.html`, `README.md`. Nessuna immagine: il runtime trasforma `doll` + stato + tempo in **poligoni** pronti da disegnare.

```js
import * as R from './environment-runtime.mjs';
const { doll } = await (await fetch('doll.json')).json();
const player = new R.DollPlayer();                    // uno per personaggio
// ogni frame:
const shapes = player.frame(doll, state, dt, speedPx / heightPx);   // 'IDLE' | 'WALK' | 'CLIMB' | 'JUMP' | …
R.drawDoll(ctx, shapes, { x: feetX, y: feetY, scale: heightPx / R.DOLL_HEIGHT, flip: facingLeft,
                          outline: doll.colors.outline, outlineWidth: doll.style.outline * R.DOLL_HEIGHT });
```
- `shapes` è una lista ordinata (dal fondo al primo piano) di `{ pts: [x0,y0,x1,y1,…], fill: '#rrggbb', kind?: 'poly'|'line', w?, closed?, bare? }`. Unità: figura alta **1000**, piedi in (0,0), y verso il basso, il personaggio guarda a **destra**. Con un altro motore (Pixi, WebGL, SVG…) disegna gli stessi poligoni: prima il riempimento, poi il contorno (`outline`, escluso se `bare`); le `line` sono polilinee con spessore `w`.
- Il passo si aggancia alla velocità (`speedPx / heightPx` = altezze al secondo).
- Da codice: `R.createDoll()`, `R.randomDoll(seed)`, `R.DOLL_PRESETS`; le proprietà di `doll` (proporzioni, colori, parti, accessori, stile, movimento) sono in `types/doll.ts`.
- Nel progetto (ZIP intero, schema v4) gli omini stanno in `project.dolls` e un personaggio li usa con `dollId`.

---

# Usare uno scenario completo nel gioco (Pacchetto per il gioco)

*Editor → Esporta → «Pacchetto per il gioco»* produce `<ambiente>.scenario.zip`:

```
project.json              ambiente, grafo di navigazione, oggetti, regole di gioco ("gameplay"), personaggi e puppet usati
assets/                   immagini
scenario.json             il contratto (formato, versione, oggetti da trovare, fasi del crollo)
environment-runtime.mjs   runtime senza dipendenze
game-example.html         mini gioco completo (doppio click): dadi → oggetto → contatore → crollo
README.md
```

Prima di esportare, la sezione **Gioco** dell'editor (Inspector senza selezione) controlla che lo scenario sia «pronto» (nodi collegati, personaggio, oggetti da trovare, animazioni COLLECT / CELEBRATE…).

## Il modello di gioco
- Il personaggio **vaga da solo** sul grafo (comportamento autonomo del personaggio). Il gioco non gli dà ordini di movimento.
- Quando i dadi sono uguali il gioco chiama `session.triggerCollect()`: il personaggio si ferma dove si trova, esegue l'animazione di raccolta (stato `COLLECT`), esulta (`CELEBRATE`), poi riprende a vagare. Il **punto si conta a metà raccolta**, quando l'oggetto è in mano.
- Gli oggetti da trovare (gemme, monete, …) sono definiti per scenario, con punti e frequenza: `scenario.json → collectibles`.
- **Il crollo** ha la tempistica di una trottola: la durata reale è casuale tra due limiti e **non viene mai esportata né esposta**. Il gioco riceve solo `collapse.intensity` (0–1) e `shake`, che crescono in modo irregolare e sempre più veloce con qualche falso allarme, più gli eventi delle fasi (`stage`) e infine `collapse`.

## API (JavaScript, adatta a PixiJS)
```js
import * as R from './environment-runtime.mjs';
const project = await (await fetch('project.json')).json();
const session = R.createGameSession(project, { seed: 'partita-1' });      // stesso seed → stessa partita

session.on((e) => { /* e.type: 'collect:start' | 'collect:pick' | 'collect:done' | 'score' | 'stage' | 'collapse' | 'arrival' | 'interaction' */ });

// ogni frame:
session.update(dt);
const f = session.frame(dt);
// f.characters[i] = { id, name, x, y, facing, state, heightPx, lift, puppet }   (x, y in px dell'ambiente)
//   puppet = { view, positions, over?, attachments? }  → vertici deformati già pronti (vedi sopra per il disegno con PixiJS)
// f.pickups   = oggetti appena raccolti (per l'animazione verso il contatore)
// f.collapse  = { intensity, shake: {x, y, angle}, stage, collapsed }
// f.score     = { points, counts }

session.triggerCollect();                 // oggetto a caso (per peso)
session.triggerCollect('Gemma');          // per nome o per id
// risposta: { ok, collectible?, character? }  oppure { ok:false, reason: 'collapsed' | 'no-collectible' | 'no-character' }
```
Le richieste fatte durante una raccolta vanno in coda. Dopo `collapse` nessuno si muove più. `game-example.html` è un esempio completo e funzionante da copiare.
