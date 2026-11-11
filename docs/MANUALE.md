# Environment Builder — Manuale operativo

Strumento per trasformare **un’illustrazione 2D** (prodotta altrove, es. con AI) in un **ambiente esplorabile**: fondale + percorsi percorribili + oggetti + personaggi. Funziona interamente nel browser; i dati restano sul tuo computer.

## 1. Avvio

- **File unico:** apri `environment-builder.html` con doppio click (Chrome, Edge, Firefox).
- **Da codice:** `npm install` poi `npm run dev` e apri http://localhost:3000. Il file unico si rigenera con `npm run build:standalone`.
- I progetti sono salvati **nel browser** (IndexedDB), legati al modo in cui apri l’app: cambiando browser o spostando il file non li vedi più. **Fai backup con Esporta → ZIP.**

## 2. Flusso di lavoro in 8 passi

1. **Libreria** → scrivi un nome → *Nuovo progetto*.
2. **Importa l’illustrazione** (PNG/JPG/WebP, qualsiasi proporzione): diventa lo sfondo.
3. **Disegna i percorsi** con *Disegna percorso* (`P`): un click = un nodo collegato al precedente; doppio click o `Esc` per finire.
4. **Rifinisci** con *Seleziona* (`V`): trascina i nodi; doppio click su un percorso per renderlo curvo e trascina le maniglie gialle.
5. **Imposta i collegamenti** nell’Inspector (a destra): tipo di movimento, direzione consentita, velocità, requisiti.
6. **Aggiungi oggetti** (`I`), **ingressi/uscite** e **personaggi** (`K`, clicca un nodo).
7. **Prova** con *Playtest* (in alto): Play, Pausa, Stop, Reset.
8. **Salva ed esporta** (salvataggio automatico ogni ~1 s; `Ctrl+S` per forzarlo).

## 3. Schermata

| Area | Funzione |
|---|---|
| Barra superiore | Nome progetto e ambiente, Apri, Nuovo, Salva, Annulla/Ripeti, **Editor / Playtest**, Esporta |
| Schede ambienti | Passa da un ambiente all’altro; **+** nuovo, **copia** duplica, **cestino** elimina (min. 1) |
| Barra strumenti (sinistra) | Seleziona, Mano, Nodo, Collega, Percorso, Oggetto, Personaggio, Livelli |
| Scena (centro) | Rotella = zoom · trascinamento (Mano, tasto centrale/destro o `Spazio`) = sposta · `F` adatta · `O` anteprima senza strumenti |
| Inspector (destra) | Proprietà dell’elemento selezionato; senza selezione mostra l’ambiente (sfondo, livelli, profili, oggetti, personaggi) |

Scorciatoie: `V` `H` `N` `C` `P` `I` `K` `L` strumenti · `Canc` elimina · `Esc` annulla/seleziona · `Ctrl+Z` / `Ctrl+Shift+Z` · `Ctrl+S` · `+`/`-` zoom. Su tablet/telefono: tocco per selezionare, due dita per zoom e spostamento; l’Inspector si apre dal pulsante in alto a destra.

## 4. Percorsi e movimento

Il personaggio si muove **solo lungo i collegamenti**: non esiste fisica né collisioni, il movimento è deterministico. I nodi non collegati non sono raggiungibili.

| Tipo di collegamento | Stato/animazione | Note |
|---|---|---|
| Camminata, Rampa, Scale, Passaggio, Curva | WALK | velocità costante, anche su curve |
| Arrampicata | CLIMB | mantiene l’orientamento |
| Salto | JUMP | traiettoria ad arco |
| Caduta | FALL | accelera (di solito a senso unico) |
| Teletrasporto | CUSTOM | durata fissa 0,25 s |

Proprietà di un collegamento: **direzione** (entrambi i sensi / solo Da→A / solo A→Da), **moltiplicatore di velocità**, **requisiti** (abilità richieste, es. `can-climb`: senza tutte le abilità il collegamento non è percorribile) e **proprietà libere**; con `duration=<secondi>` si impone il tempo di percorrenza di qualunque collegamento.

**Profili** (Caverna, Foresta, Edificio, Nave, Industriale, Esterno, Dungeon, Città, Subacqueo, Spazio, Personalizzato): sono solo *suggerimenti* sui tipi da usare, mai limiti; se ne possono combinare più di uno e crearne di propri (*Nuovo profilo…*).

## 5. Oggetti, ingressi/uscite, interazioni

- **Oggetto** (`I`): scegli il tipo in alto (generico, raccoglibile, punto di interazione, punto di osservazione, ingresso, uscita, trigger) e clicca sulla scena. Trascina per spostare, maniglia gialla per ridimensionare. Puoi associare un’**immagine**, nasconderlo, collegarlo a un nodo/percorso. Senza immagine vedi un segnaposto di progetto, invisibile nel Playtest.
- **Collegare due ambienti:** crea un **Ingresso** nell’ambiente di arrivo e un’**Uscita** in quello di partenza; selezionando l’uscita scegli *ambiente* e *ingresso di destinazione*. Nel Playtest chi termina un percorso sull’uscita compare all’ingresso.
- **Interazioni** (sezione nell’Inspector dell’oggetto): *Raccolta*, *Osservazione*, *Attivazione*, *Personalizzata*. Ognuna ha etichetta, **quando parte** (*all’arrivo* sul nodo dell’oggetto, oppure *manuale* con pulsante nel Playtest), durata, abilità richieste, messaggio, **evento per il gioco ospite**, «una sola volta». **Nulla avviene per semplice vicinanza.**

## 6. Livelli grafici (`L`)

Sfondo (obbligatorio) + piani intermedi + primi piani. Per ogni livello: mostra/nascondi, avanti/indietro, spostamento X/Y, opacità. Il **primo piano passa sopra i personaggi**. Usa PNG con trasparenza grandi come lo sfondo.

## 7. Personaggi

Senza immagine è usato un personaggio provvisorio (colore, dimensioni, ombra). Per usare i tuoi disegni: **Importa sprite** (immagine singola) oppure spunta *È uno sprite sheet*, indica la dimensione del fotogramma e assegna a ogni stato (IDLE, WALK, CLIMB, INTERACT, COLLECT, JUMP, FALL, CUSTOM) i fotogrammi (`0-3`, `0, 2, 4`), i fotogrammi/s e se ripetere. Lo sprite guarda a destra (a sinistra viene specchiato); uno stato senza animazione usa IDLE.
**Comportamento:** *Manuale* (clicchi un nodo di destinazione) o *Autonomo* (sceglie da solo destinazioni raggiungibili). Parametri: velocità, sosta min/max, probabilità di sosta ai nodi, frequenza delle decisioni, probabilità di cambio direzione, **preferenze per tipo di collegamento** (1 neutro, >1 preferito, 0 mai). Le uscite non sono mai scelte in autonomia.

## 8. Playtest

Nasconde gli strumenti. **Play / Pausa / Stop / Reset** (`Spazio` = Play/Pausa). *Stop* riporta tutti alla partenza; *Reset* riparte da capo. In manuale clicca un nodo (cerchi bianchi) o usa l’elenco; destinazioni non raggiungibili vengono rifiutate con un messaggio. Pannelli: **Interazioni** (pulsanti manuali, inventario, eventi inviati al gioco), **Diagnostica** (posizione, nodo, collegamento, velocità, stato, percorso), **Parametri** (modificano davvero il personaggio). *Mostra percorsi* sovrappone i nodi di progetto. Tornando all’Editor **nulla è perso**: il Playtest non modifica il progetto (inventario e oggetti raccolti sono solo temporanei).

## 9. Salvataggio ed esportazione

- **Esporta → ZIP:** `project.json` + `manifest.json` + tutte le immagini (`assets/`). È il formato di backup e di consegna. **Importa** dalla Libreria (crea sempre un *nuovo* progetto, non sovrascrive).
- **Esporta → JSON:** solo configurazione, senza immagini.
- Vecchi progetti (schema v1) vengono aggiornati automaticamente; file più recenti dell’app vengono rifiutati con un avviso.

## 10. Integrazione con altri giochi

1. Esporta lo ZIP: le coordinate sono **normalizzate (0–1)** rispetto alla dimensione originale dell’immagine, quindi indipendenti da schermo e risoluzione; moltiplica per larghezza/altezza dell’immagine del livello.
2. Per riusare movimento, percorsi, uscite e interazioni senza riscriverli: `npm run build:runtime` produce `dist/environment-runtime.mjs` (~19 KB, nessuna dipendenza, niente DOM):
   ```js
   import { migrateProject, Agent } from './environment-runtime.mjs';
   const env = migrateProject(JSON.parse(testoDiProject_json)).environments[0];
   const eroe = new Agent(env, env.characters[0]);
   eroe.goTo(idNodo);         // segue solo i collegamenti
   eroe.step(1 / 60);         // passo fisso, deterministico
   eroe.snapshot();           // { x, y, facing, state, nodeId, edgeId, … }
   ```
   Sono esportati anche `findRoute`, `resolveExit`, `availableInteractions`, `performInteraction`, `registerMovementType` (nuovi tipi di movimento).
3. **Eventi in uscita dal Playtest** (per prove di integrazione): ogni evento (`arrival`, `interaction`, `transition`, con il nome evento configurato) è un `CustomEvent` sulla `window` — `window.addEventListener('environment-builder:event', e => e.detail)` — e un `postMessage` al genitore se l’app è in un iframe (`{ source: 'environment-builder', event }`).

## 11. Limiti noti e consigli

- Niente fisica/collisioni (scelta di progetto: movimento guidato dal grafo).
- Immagini oltre la dimensione massima di texture della GPU (spesso 8192–16384 px) possono non comparire: verrà mostrato un avviso.
- Svuotare i dati del sito cancella i progetti: **esporta lo ZIP a fine sessione**.
- Un personaggio in visita da un altro ambiente si configura nell’ambiente d’origine.
- Le uscite con destinazione incompleta sono segnalate in arancione nell’Inspector: controlla l’elenco *Oggetti* dell’ambiente prima di consegnare.
- Interfaccia solo in italiano (per ora).
