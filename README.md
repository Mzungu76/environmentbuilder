# Environment Builder

Editor 2D universale per trasformare illustrazioni (prodotte esternamente, es. con AI) in **ambienti esplorabili**: fondale statico + grafo di navigazione + oggetti + personaggi. Indipendente da qualsiasi gioco (il primo utilizzatore sarà *AT THE LIMIT*, ma il motore non contiene nulla di specifico).

Tutto gira nel browser: nessun backend, nessun database remoto, nessun servizio a pagamento. I dati sono salvati in **IndexedDB**.

## Stato: Milestone 1 – Editor base ✅

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
| Playtest, personaggi, oggetti, ingressi/uscite, layer mid/foreground | ⏳ Milestone 2–3 (modello dati già pronto, UI non ancora presente) |

Il pulsante *Playtest* è volutamente disabilitato finché non esiste la simulazione.

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

Scorciatoie: `V` selezione · `H` mano · `N` nodo · `C` connetti · `P` percorso · `Del` elimina · `Esc` annulla · `F` adatta · `+`/`-` zoom · `O` anteprima · `Ctrl+Z` / `Ctrl+Shift+Z` · `Ctrl+S`.

## Architettura

Quattro componenti indipendenti che comunicano solo tramite tipi e interfacce:

```
types/                  Modelli TypeScript versionati (Project, Environment, SceneLayer, NavigationNode/Edge,
                        InteractiveObject, Character, Animation, Interaction, Entrance, Exit)
engine/
  rendering/SceneView   Scene Manager (PixiJS): fondale, layer, camera, input grezzo, overlay di progettazione.
                        Non conosce store né strumenti.
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

- **M2 – Simulazione**: personaggio provvisorio, movimento lungo nodi e curve, manuale (click su nodo di destinazione) e autonomo, Playtest con pannello diagnostico.
- **M3 – Ambienti completi**: più scene, ingressi/uscite collegati, oggetti, layer mid/foreground, duplicazione ambienti.
- **M4 – Estensioni**: nuovi profili, tipi di movimento, animazioni, interazioni configurabili.
