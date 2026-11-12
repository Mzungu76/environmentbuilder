# Environment Builder

Editor 2D universale per trasformare illustrazioni (prodotte esternamente, es. con AI) in **ambienti esplorabili**: fondale statico + grafo di navigazione + oggetti + personaggi. Indipendente da qualsiasi gioco (il primo utilizzatore sarà *AT THE LIMIT*, ma il motore non contiene nulla di specifico).

Tutto gira nel browser: nessun backend, nessun database remoto, nessun servizio a pagamento. I dati sono salvati in **IndexedDB**.

## Stato: Milestone 1 (Editor base) ✅ · Milestone 2 (Simulazione) ✅ · Milestone 3 (Gestione ambienti) ✅ · Milestone 4 (Estensioni) ✅ · **Studio personaggi** ✅ · **Omini** ✅

📘 **Manuale operativo:** [docs/MANUALE.md](docs/MANUALE.md)

L’interfaccia è in **italiano** (stringhe ancora inline nei componenti; un livello i18n è da prevedere se servirà un’altra lingua).

| Funzione | Stato |
|---|---|
| Creazione/apertura/eliminazione progetti (libreria) | ✅ |
| Import immagine PNG / JPG / WebP (qualsiasi proporzione, mai deformata) | ✅ |
| Scena PixiJS con zoom (rotella / pinch), pan (trascinamento, tasto centrale/destro, Spazio, strumento Mano), *fit to window* | ✅ |
| Nodi: crea, trascina, rinomina, tipo, coordinate in pixel, proprietà custom | ✅ |
| Collegamenti: crea (strumento Connetti o Disegna percorso), tipo, direzione consentita, velocità, requisiti, inversione | ✅ |
| Curve Bézier cubiche: doppio click su un percorso o pulsante nell'Inspector, maniglie trascinabili | ✅ |
| Undo / Redo (illimitato entro 150 passi), eliminazione con `Del` | ✅ |
| Salvataggio automatico (800 ms) + manuale (`Ctrl+S`), riapertura senza perdite | ✅ |
| Esportazione ZIP (project.json + immagini + manifest) e JSON; importazione ZIP/JSON | ✅ |
| Modalità anteprima senza strumenti (`O`) | ✅ |
| Touch: selezione, trascinamento nodi, pinch-zoom e pan a due dita, layout responsive | ✅ |
| Smartphone in orizzontale (altezza ≤ 500 px): scena a tutto schermo, comandi tondi flottanti, menu progetto, pannello proprietà che affianca la scena (mockup in `docs/mockup-mobile.html`, proposta B) | ✅ |
| **Primo piano**: parti dello sfondo dipinte (pennello/gomma, bordo morbido) che nascondono il personaggio; sostituisce il vecchio livello «primo piano» (schema v5, migrazione automatica) | ✅ (passo 1) |

### Studio personaggi (modellini con scheletro) — sezione `/studio`

Pipeline guidata in 7 passi per trasformare un **foglio di rotazione** (fronte, profilo, retro; generato con una guida inclusa) in un personaggio animato: rimozione sfondo con tolleranze, ritaglio delle viste con rettangoli regolabili, ritocco (gomma/ripristina), scheletro di 19 giunti con posizionamento automatico e correzione manuale, mesh e **pesi automatici + pennello**, copie degli arti lontani nel profilo, animazioni a chiavi con preset, anteprima ed **esportazione ZIP** (puppet.json + texture + runtime + `demo.html`). Nel Playtest il personaggio cammina con passo sincronizzato alla velocità e vista fronte/retro per collegamento. Dati: schema **v3** (`Project.puppets`, `Character.puppetId`), migrazione da v2 automatica. Guida all'integrazione: [docs/INTEGRAZIONE-PERSONAGGI.md](docs/INTEGRAZIONE-PERSONAGGI.md). Utilizzabile anche da smartphone/tablet (area di lavoro fissa in alto, modalità «mano», bersagli touch più grandi).

### Burattino di carta — Studio personaggi → passo *Importa*
Foglio di pezzi separati disegnati dall'AI → ritrovamento dei pezzi, snodi dai pixel, montaggio di profilo, atlante e mesh rigida sullo scheletro esistente (`engine/puppet/paperpuppet.ts`, `lib/studio/paper.ts`). Guide e prompt in `docs/guida-di-prova/` (`tools/make-puppet-guide.py` rigenera le guide e il layout).

### Fronte/retro, attrezzi e animazioni del burattino
Viste frontali con arti specchiati (`assembleFrontal`), attrezzi agganciati alle ossa (`engine/puppet/attachments.ts`), IK per i piedi a terra (`ik.ts`), preset (`presets.ts`) e sequenze (`sequences.ts`).

### Sequenze di pose (arrampicata) — passo *Viste*
Foglio con N pose → ritaglio, scheletro automatico per adattamento della sagoma (`engine/puppet/fit.ts`), scala uniforme, riproduzione chiave→chiave con deformazione e dissolvenza (`engine/puppet/keyposes.ts`). Esportato nel pacchetto (`puppet.json → poseSets`) con `sampleSet` nel runtime.

### Manichino a parti (prototipo) — Studio personaggi → passo *Manichino*
Mesh separata per ogni osso con texture cotta dalle viste (`engine/puppet/manikin.ts`): movimenti ampi senza strappare l'immagine unica; confronto affiancato e pose di prova.

### Omini (personaggi procedurali) — Studio personaggi → *Omini*

Evoluzione del piccolo personaggio disegnato dal programma: ora ha **braccia**, vestiti e accessori e si personalizza interamente (proporzioni, colori, capelli, volto, maglia, pantaloni, scarpe, 10 accessori tra cui casco con lampada, zaino e piccone), con modelli di partenza (Minatore, Esploratrice, Piccolo, Slanciato) e generatore **Casuale**. Lo scheletro e le animazioni sono gli stessi dei modellini (passo sincronizzato, arrampicata, salto…). Geometria pura (`engine/doll/`): una lista di poligoni disegnabile con Pixi, Canvas o qualunque motore; esportazione ZIP con `doll.json` + runtime + `demo.html`. Schema **v4** (`Project.dolls`, `Character.dollId`), migrazione automatica.

### Milestone 4 – Estensioni

| Funzione | Stato |
|---|---|
| **Interazioni configurabili** sugli oggetti (raccolta, osservazione, attivazione, personalizzata): all'arrivo o manuali, durata, requisiti, messaggio, evento per il gioco ospite, «una volta sola». Mai per semplice vicinanza | ✅ |
| Raccolta nel Playtest: inventario, oggetto nascosto, stato COLLECT/INTERACT, registro eventi; reset ripristina tutto | ✅ |
| **Sprite e sprite sheet** importabili, animazioni per stato (frame, fps, ripetizione), specchio per l'orientamento; fallback su IDLE e sul personaggio procedurale | ✅ |
| **Nuovi tipi di movimento** (registro estensibile): salto (arco, JUMP), caduta (accelera, FALL), teletrasporto (durata fissa); `props.duration` su qualunque collegamento | ✅ |
| **Nuovi profili** (Dungeon, Città, Subacqueo, Spazio) e **profili personalizzati** per progetto | ✅ |
| **Schema v2** con migrazione automatica da v1 (testata) | ✅ |
| **Integrazione con giochi esterni**: runtime autonomo `dist/environment-runtime.mjs` (`npm run build:runtime`, ~19 KB, senza DOM) + eventi `window`/`postMessage` dal Playtest | ✅ |
| Collisioni e fisica | ➖ Non implementate: per scelta il movimento è deterministico e guidato dal grafo |

### Milestone 3 – Gestione completa degli ambienti

| Funzione | Stato |
|---|---|
| Più ambienti per progetto con schede (crea, duplica, elimina, rinomina); ogni ambiente ha immagine, grafo, oggetti, personaggi e livelli propri | ✅ |
| Duplicazione con nuovi id e riferimenti interni rimappati (nodi, percorsi, oggetti, personaggi); le immagini restano condivise | ✅ |
| Libreria progetti con elenco degli ambienti (apertura diretta), duplicazione e importazione di interi progetti | ✅ |
| Oggetti (`I`): generico, raccoglibile, punto di interazione, punto di osservazione, ingresso, uscita, trigger — tipologie aperte | ✅ |
| Oggetti: sposta, ridimensiona (maniglia gialla), elimina, nascondi, immagine associata, proprietà libere, collegamento a nodo e percorso | ✅ |
| **Ingressi e uscite**: un’uscita punta all’ingresso di un altro (o dello stesso) ambiente; la validità è controllata | ✅ |
| **Playtest tra ambienti**: un personaggio che termina un percorso su un’uscita compare all’ingresso collegato; uscendo dal Playtest si torna all’ambiente di partenza | ✅ |
| Livelli grafici (`L`): sfondo obbligatorio + piani intermedi e primi piani; visibilità, ordine, spostamento, opacità. Il primo piano è disegnato sopra i personaggi | ✅ |
| Esportazione/importazione ZIP di progetti multi-ambiente senza perdite (verificato) | ✅ |

Note: le uscite non sono mai scelte come meta dal movimento autonomo (il passaggio avviene solo su comando). Raccolta e interazioni con gli oggetti non sono ancora attive nel Playtest (Milestone 4); un personaggio in visita da un altro ambiente si configura nell’ambiente d’origine.

### Milestone 2 – Simulazione

| Funzione | Stato |
|---|---|
| Personaggio provvisorio procedurale (nessun asset richiesto), colore/dimensioni/ombra, più personaggi | ✅ |
| Strumento **Personaggio** (`K`): clicca un nodo per posizionarlo; nodo di partenza modificabile nell’Inspector | ✅ |
| Movimento solo lungo i collegamenti (direzione consentita, requisiti/abilità, velocità per collegamento) | ✅ |
| Movimento a velocità costante anche su curve Bézier (campionamento per lunghezza d’arco) | ✅ |
| Percorso minimo (Dijkstra) con preferenze per tipo di collegamento; inversione di marcia a metà percorso se conviene | ✅ |
| **Manuale**: click su un nodo della scena o scelta dall’elenco; destinazioni non raggiungibili rifiutate con messaggio | ✅ |
| **Autonomo**: sceglie destinazioni raggiungibili, soste (min/max), probabilità di sosta ai nodi, frequenza decisioni e probabilità di cambio direzione, preferenze di percorso | ✅ |
| **Playtest**: strumenti nascosti, Play / Pausa / Stop / Reset, pannello diagnostico (posizione, nodo, collegamento, velocità, stato animazione, percorso) | ✅ |
| Stati: IDLE, WALK, CLIMB animati proceduralmente (INTERACT, COLLECT, JUMP, FALL, CUSTOM previsti dal modello, non ancora animati) | ✅/⏳ |
| Tornando all’Editor le modifiche restano; il Playtest non modifica mai il documento | ✅ |

La simulazione usa un passo fisso di 1/60 s e un generatore pseudo-casuale con seme per personaggio: stesso progetto → stesso comportamento autonomo. Non c’è fisica né collisioni.

**Non ancora**: sprite/sprite sheet importabili per il personaggio (il modello `Character` li prevede), raccolta/interazione con oggetti (Milestone 3).

## Installazione e avvio

Richiede Node.js ≥ 20.

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # test unitari (vitest)
npm run typecheck
npm run build      # export statico in ./out, pubblicabile su qualsiasi hosting statico
npm run build:runtime      # dist/environment-runtime.mjs per giochi esterni
npm run build:standalone   # genera dist/environment-builder.html, un singolo file apribile con doppio click
```

## Uso rapido

1. Libreria → scrivi un nome → **New project**.
2. Trascina un'immagine sulla scena (o *Choose image…*).
3. Strumento **Draw path** (`P`): clicca per creare nodi collegati in sequenza; doppio click o `Esc` per terminare.
4. **Select** (`V`): trascina nodi, seleziona un percorso, doppio click per curvarlo e trascina le maniglie gialle.
5. **Inspector** (destra): modifica nome, tipo, coordinate, direzione, velocità, requisiti.
6. Il progetto si salva da solo; **Export → ZIP** produce un pacchetto autonomo re-importabile dalla libreria.

Scorciatoie: `I` oggetto · `L` livelli · `K` personaggio · `Spazio` Play/Pausa (in Playtest) · `V` selezione · `H` mano · `N` nodo · `C` connetti · `P` percorso · `Del` elimina · `Esc` annulla · `F` adatta · `+`/`-` zoom · `O` anteprima · `Ctrl+Z` / `Ctrl+Shift+Z` · `Ctrl+S`.

## Architettura

Quattro componenti indipendenti che comunicano solo tramite tipi e interfacce:

```
types/                  Modelli TypeScript versionati (Project, Environment, SceneLayer, NavigationNode/Edge,
                        InteractiveObject, Character, Animation, Interaction, Entrance, Exit)
engine/
  rendering/SceneView   Scene Manager (PixiJS): fondale, layer, camera, input grezzo, overlay di progettazione.
                        Non conosce store né strumenti.
  simulation/           Simulation Engine: Agent (movimento), routing (Dijkstra), track (curve a lunghezza d'arco),
                        PlaytestController (loop a passo fisso, input, diagnostica)
  interaction/          Object & Interaction Editor: oggetti, ingressi/uscite (risoluzione dei passaggi), ObjectEditor
  scene/                Operazioni sui livelli grafici
  editor/SceneController  Instrada l'input agli editor (oggetti → navigazione)
  puppet/               Studio personaggi: imageProc (sfondo/ritaglio), skeleton, mesh+pesi, animation, runtime, player, canvasRenderer
  doll/                 Omini: proporzioni → scheletro → poligoni (shapes), player, renderer Canvas
  characters/           Factory e valori predefiniti dei personaggi
  navigation/           Navigation Editor: grafo (funzioni pure e immutabili), geometria Bézier, hit-testing,
                        NavigationEditor (controller strumenti → comandi sullo store)
  profiles/             Profili ambientali = configurazione (suggerimenti), non motori
lib/
  store/editorStore     Stato unico del documento + undo/redo + autosave
  persistence/db        IndexedDB (progetti e asset binari)
  serialization/        Factory, validazione, migrazioni di schema
  import-export/        Import immagini, archivio ZIP
components/             UI React (toolbar, scena, inspector)
app/                    Next.js App Router: `/` libreria, `/editor?id=…`
```

Scelte principali:

- **Coordinate normalizzate** (0–1) rispetto alle dimensioni originali dell'immagine: la configurazione non dipende mai dal viewport né dalla risoluzione dello schermo. Le lunghezze sono calcolate in pixel dell'immagine (aspect-ratio aware).
- **Documento immutabile**: ogni modifica produce un nuovo `Project`; undo/redo sono array di riferimenti. I gesti continui (drag) creano un solo passo di history.
- **Il grafo è l'unica fonte di movimento**: `outgoing()`/`reachable()` rispettano la direzione consentita dei collegamenti; i nodi non collegati non sono raggiungibili. Pronto per la Simulation Engine (M2).
- **Tipi aperti** (`NodeType`, `EdgeType`, `ObjectType` accettano stringhe arbitrarie): nuove tipologie senza toccare il motore.
- **Schema versionato** (`SCHEMA_VERSION` + `migrations.ts`): i file futuri potranno essere migrati; file più recenti dell'app vengono rifiutati con messaggio chiaro.
- **Export statico** (`output: 'export'`): nessun server richiesto, pronto per la pubblicazione.

## Formato di esportazione

`<progetto>.ebproj.zip`:

```
project.json     progetto completo (ambienti, grafi, oggetti, layer, schemaVersion)
manifest.json    metadati (app, schema, data, conteggi, asset mancanti)
assets/<id>.png  tutte le immagini referenziate
```

L'import crea sempre un **nuovo** progetto (nuovo id) e non sovrascrive quelli esistenti.

## Limiti noti / criticità

- Le immagini molto grandi (> dimensione massima di texture della GPU, tipicamente 8192–16384 px) possono non essere renderizzate; l'errore viene mostrato in un banner.
- IndexedDB è locale al browser: svuotare i dati del sito cancella i progetti. Usare l'export ZIP come backup.
- Nessuna collisione/fisica: per scelta il movimento sarà deterministico e guidato dal grafo.

## Roadmap

- **Idee future**: oggetti animati, condizioni/sequenze di interazioni, editor di sprite con anteprima, più lingue, collisioni solo se un gioco le richiedesse. (Le milestone M1–M4 sono completate.)
- ~~M4~~ (completata): nuovi profili, tipi di movimento, animazioni, interazioni configurabili.
