# Environment Builder

Editor 2D universale per trasformare illustrazioni (prodotte esternamente, es. con AI) in **ambienti esplorabili**: fondale statico + grafo di navigazione + oggetti + personaggi. Indipendente da qualsiasi gioco (il primo utilizzatore sarà *AT THE LIMIT*, ma il motore non contiene nulla di specifico).

Tutto gira nel browser: nessun backend, nessun database remoto, nessun servizio a pagamento. I dati sono salvati in **IndexedDB**.

## Stato: Milestone 1 (Editor base) ✅ · Milestone 2 (Simulazione) ✅

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
| Oggetti, ingressi/uscite, layer mid/foreground, più ambienti | ⏳ Milestone 3 (modello dati già pronto, UI non ancora presente) |

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
npm run build:standalone   # genera dist/environment-builder.html, un singolo file apribile con doppio click
```

## Uso rapido

1. Libreria → scrivi un nome → **New project**.
2. Trascina un'immagine sulla scena (o *Choose image…*).
3. Strumento **Draw path** (`P`): clicca per creare nodi collegati in sequenza; doppio click o `Esc` per terminare.
4. **Select** (`V`): trascina nodi, seleziona un percorso, doppio click per curvarlo e trascina le maniglie gialle.
5. **Inspector** (destra): modifica nome, tipo, coordinate, direzione, velocità, requisiti.
6. Il progetto si salva da solo; **Export → ZIP** produce un pacchetto autonomo re-importabile dalla libreria.

Scorciatoie: `K` personaggio · `Spazio` Play/Pausa (in Playtest) · `V` selezione · `H` mano · `N` nodo · `C` connetti · `P` percorso · `Del` elimina · `Esc` annulla · `F` adatta · `+`/`-` zoom · `O` anteprima · `Ctrl+Z` / `Ctrl+Shift+Z` · `Ctrl+S`.

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

- **M3 – Ambienti completi**: più scene, ingressi/uscite collegati, oggetti, layer mid/foreground, duplicazione ambienti.
- **M4 – Estensioni**: nuovi profili, tipi di movimento, animazioni, interazioni configurabili.
