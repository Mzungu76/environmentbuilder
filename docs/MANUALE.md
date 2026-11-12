# Environment Builder — Manuale operativo

Strumento per trasformare **un’illustrazione 2D** (prodotta altrove, es. con AI) in un **ambiente esplorabile**: fondale + percorsi percorribili + oggetti + personaggi. Funziona interamente nel browser; i dati restano sul tuo computer.

## 1. Avvio

- **Questo manuale è anche nell’app:** pulsante *Manuale* nella Libreria e icona **?** nella barra superiore dell’editor (si apre in una nuova scheda, così non perdi il lavoro).
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

## 8. Studio personaggi (modellini con scheletro)

Sezione a parte (icona personaggio nella barra dell’editor, oppure *Personaggi* nella Libreria) che trasforma **un foglio di rotazione** — un’unica immagine con fronte, profilo verso destra e retro dello stesso personaggio — in un personaggio con **scheletro e animazioni**. Il builder non genera immagini: nel passo 1 trovi la **guida da dare al tuo generatore AI** (sagoma, mappa delle parti, prompt già scritto da compilare). Funziona anche da **smartphone e tablet**: l’area di lavoro resta fissa in alto e i controlli scorrono sotto; con due dita zoomi e sposti, il pulsante **✋ Sposta** trasforma un dito in «mano» (utile per pennello e ritocchi), e i punti si trascinano toccandoli. Per lavori di precisione (pesi, chiavi) il computer resta più comodo. I passi si possono ripetere e correggere in ogni momento (`Ctrl+Z`, salvataggio automatico).

1. **Importa** — carica il foglio. Qui trovi anche la guida e il prompt (pulsante *Copia*).
2. **Sfondo** — rimuove lo sfondo piatto. Le tolleranze servono perché le immagini AI non sono mai perfette: *tolleranza colore* (sfondi sporchi o JPEG), *morbidezza del bordo*, *restringi/allarga il contorno* (per eliminare gli aloni), *pulizia dell’alone*, *elimina macchie*, e l’opzione «solo lo sfondo collegato ai bordi» che salva i dettagli chiari dentro il personaggio. Il contagocce sceglie il colore a mano. Anteprima: risultato, originale o confronto.
3. **Viste** — (**pose aggiuntive** in fondo al pannello: *Arrampicata* e *Salto*, vedi sotto) il foglio viene diviso nelle tre figure (rilevamento automatico). Se non coincidono, **trascina i bordi dei rettangoli** o scrivi i valori. *Genera le viste* ritaglia ogni figura. Poi: **gomma** e **ripristina** per ritoccare i difetti, **altezza della figura** (se una vista è venuta più alta o bassa delle altre) e **punto di appoggio** dei piedi.
4. **Scheletro** — 19 giunti piazzati in automatico dalle proporzioni del modello e agganciati alla sagoma. Trascinali dove servono (*Affina sul contorno*, *Specchia sx→dx*, *Simmetria* aiutano). Nel profilo «vicino» è l’arto più vicino a chi guarda, «lontano» quello nascosto.
5. **Mesh e pesi** — crea una rete di triangoli sul personaggio e calcola quanto ogni osso muove ogni punto. *Morbidezza delle giunture* e *Lisciatura* regolano la deformazione; il **pennello dei pesi** (assegna, aggiungi, togli, sfuma) corregge a mano. *Prova deformazione* ruota un osso per vedere subito se qualcosa si strappa. Nel profilo, *Gamba/Braccio lontano* aggiungono una **copia dell’arto vicino dietro al corpo**, così la camminata di profilo mostra entrambi gli arti.
6. **Animazioni** — preset (riposo, camminata, arrampicata, salto, caduta, interazione, raccolta) da modificare: **trascina i cerchi bianchi** per ruotare le ossa; dove trascini si crea una *chiave*. Timeline, riproduzione, durata, ripetizione e **passo per ciclo** (sincronizza la camminata alla velocità: niente piedi che scivolano). Per ogni stato (IDLE, WALK, CLIMB…) scegli quale animazione usare.
7. **Anteprima ed esporta** — provi ogni stato e vista, controlli la lista di verifica, **esporti il pacchetto** per un gioco e **assegni l’aspetto** ai personaggi del progetto (o ne crei uno).

**Pose aggiuntive (arrampicata e salto):** il profilo da solo non può arrampicarsi o saltare in modo convincente. Nel passo 1 trovi la guida e il prompt per generare il personaggio **già in posa** (sempre di profilo, verso destra); nel passo 3, *Pose aggiuntive*, importi un foglio con le due pose (arrampicata a sinistra, salto a destra) o una posa alla volta. Ogni posa ha il suo scheletro (proposto dalla sagoma e correggibile), la sua mesh e i suoi pesi; le animazioni sono piccoli movimenti *attorno alla posa* (arti che si alternano, raccolta delle gambe). Nel gioco la vista giusta compare da sola: **Arrampicata** nello stato CLIMB, **Salto** in JUMP e FALL. Senza queste viste si usa il profilo.

Nell’editor, il personaggio usa il modellino scegliendolo in *Aspetto con scheletro* (Inspector del personaggio). Nel Playtest cammina con la vista di profilo (specchiata a sinistra), sosta di fronte, e su un collegamento puoi forzare la vista *Fronte/Retro* (Inspector del percorso → *Vista del personaggio*), ad esempio per scale verso lo spettatore.

**Dimensione nel gioco:** il modellino si scala dall’Inspector del personaggio (*Altezza, % dell’immagine*): la larghezza segue le proporzioni. Regola l’altezza in base ai nodi e agli oggetti dell’ambiente.

**Limiti:** l’immagine unica non contiene ciò che è nascosto (dietro un braccio, l’altra gamba): le copie degli arti lontani e il pennello dei pesi compensano, ma movimenti molto ampi mostrano deformazioni. L’aspetto non cambia con l’inventario.

**Burattino di carta (pezzi separati, consigliato).** Il personaggio come un burattino di carta: l'AI disegna in un unico foglio i pezzi separati (testa, busto, bacino, braccio, avambraccio, mano, coscia, gamba, piede, più due accessori facoltativi come lo zaino) e il programma li rimonta e li fa ruotare nelle articolazioni. Nel passo 1 «Importa» usa il pulsante *Importa foglio pezzi (burattino di carta)*: sul pannello a destra trovi la guida «pulita» (da dare all'AI insieme all'immagine del personaggio), quella con le misure e il prompt. Il programma trova i pezzi da solo (non servono posizioni esatte), ricava gli snodi dai pezzi stessi, monta il personaggio di profilo e crea gli arti lontani come copie scurite. Si apre il passo *Montaggio* (il 3° passo cambia nome): clicca un pezzo, spostalo con le frecce rispetto all'articolazione a cui è attaccato (i pezzi collegati lo seguono), portalo davanti o dietro agli altri e regola l'oscuramento degli arti lontani; le modifiche si salvano da sole. Poi passa al passo *Animazioni*, con le animazioni di sempre (camminata, arrampicata, salto…): i pezzi sono interi, quindi i movimenti ampi non strappano il disegno. Vista di profilo verso destra, specchiabile. Consigli: il busto va disegnato *senza* braccio, manica, bretella o zaino (zaino e bretella sono pezzi a parte: lo zaino sta dietro al busto, la bretella sopra), ogni pezzo deve proseguire oltre lo snodo (estremità arrotondata) e niente ombre dipinte. Limiti: nessuna vista di fronte o di retro, nessuna torsione del busto; gli accessori si agganciano al busto in una posizione standard, da ritoccare nel Montaggio. Per un aspetto 3/4 c'è la variante delle guide e del prompt (`guida-burattino-34-pulita.png`, `prompt-burattino-34.txt`).

**Animazioni del burattino: suolo, accucciarsi, preset e sequenze.** Nel passo *Animazioni* la linea verde tratteggiata è il **suolo** (all'altezza dei piedi a riposo): serve a controllare che i piedi non fluttuino né affondino. Il bacino si abbassa con lo slider *Abbassa il bacino* (sezione «Suolo e bacino»): con «Piedi a terra» attivo le gambe si piegano da sole (cinematica inversa) per tenere i piedi sul suolo, quindi ci si può accucciare, sedere o atterrare in modo credibile; il pulsante *Pianta i piedi a terra* ricalcola la chiave corrente. I preset ora sono molti: corsa, accucciati, atterraggio, siediti, raccogli da terra, guardati intorno, saluta, esulta, spavento, sorpresa, colpito, colpo con attrezzo, scava, spingi, trasporta, mostra un oggetto. Le **sequenze predefinite** (esplora, raccogli e rialzati, corsa e salto, scoperta, scava, pericolo, saluto) concatenano più movimenti in un'unica animazione, con un breve raccordo fra le parti: si assegna a uno stato o si modifica come qualunque animazione. Quando il personaggio cambia stato il passaggio fra le animazioni è sfumato (circa 0,18 s).

**Resa nella scena.** Nell'ispettore del personaggio (sezione «Resa nella scena») regoli luminosità, contrasto, saturazione, *tinta d'ambiente* (per intonarlo alla luce dello sfondo), *alone chiaro* (lo fa spiccare da sfondi molto dettagliati) e opacità dell'ombra a terra. Le texture sono filtrate con mipmap, così un personaggio grande ridotto a poche decine di pixel non appare «frastagliato».

**Fronte e retro del burattino.** Nel passo *Importa* scegli la vista (Profilo, Fronte, Retro) accanto al pulsante di importazione. Per fronte e retro c'è una guida e un prompt dedicati: gli arti si disegnano **un segmento per casella** (braccio, avambraccio, mano, coscia, gamba, piede) e **per ciascun lato**, su due righe (destra e sinistra dell'immagine), non specchiati; dal retro lo zaino si vede sopra il busto. Se il foglio ha una sola riga di arti (6 pezzi) l'app li specchia per l'altro lato. Nel *Montaggio* di fronte e retro ogni arto si seleziona e si sposta lato per lato. Prima va importato il profilo. Nel passo *Montaggio* compaiono le schede Profilo / Fronte / Retro per ritoccare ciascuna vista. Ogni vista ha le sue animazioni; nelle viste frontali non sono offerti i movimenti che piegano le gambe nel piano dell'immagine (accucciarsi, sedersi…), e il braccio sinistro dell'immagine ruota in senso opposto così i preset restano coerenti. Durante l'arrampicata, se manca la vista dedicata, si usa il retro (si sale allontanandosi dalla camera).

**Vincoli e giunture morbide.** Ogni articolazione ha **limiti angolari** (il ginocchio non si piega all'indietro, il gomito non si iperestende, di fronte le braccia si aprono ai lati e le gambe quasi non ruotano nel piano): valgono quando trascini le ossa, nelle animazioni pronte e nel gioco, quindi nessuna posa può diventare impossibile. Nel passo *Montaggio* lo slider **Morbidezza delle giunture** fa seguire a ogni pezzo, vicino allo snodo, anche il pezzo a cui è attaccato: spalle, gomiti, ginocchia e collo si piegano senza «strappi» o buchi (0 = pezzi rigidi come carta). Da *Montaggio* puoi anche rifinire la sovrapposizione dei pezzi.

**Attrezzi e oggetti.** Nel passo *Animazioni*, sezione «Attrezzi e oggetti»: aggiungi un'immagine (piccone, torcia, un oggetto…), scegli l'osso a cui è attaccata (di solito la mano destra), il punto di impugnatura (pallino verde nell'anteprima), scala, rotazione e spostamento. Si mostra **sempre** (oggetto trasportato) oppure solo nelle animazioni in cui spunti «Mostra in…» (per esempio il piccone in «Scava» e «Colpo con attrezzo»). Si può scegliere se sta davanti o dietro al corpo e in quali viste compare. Gli attrezzi sono esportati nel pacchetto (`puppet.json → attachments`, `clip.attach`) con le funzioni `activeAttachments` e `attachmentQuad` del runtime.

**Sequenza di pose (arrampicata).** Il metodo che rende di più per i movimenti ampi: invece di deformare un'unica immagine, importi un foglio con *N pose* dell'arrampicata (passo 3 «Viste» → «Sequenza di pose»). Il programma ritaglia le figure, toglie lo sfondo, trova da solo lo scheletro di ciascuna (adattando il profilo del personaggio alla sagoma disegnata, e ricavando anche la scala), tiene la stessa mano «la stessa mano» da una posa all'altra e crea mesh e pesi. Durante l'arrampicata il gioco passa da una posa-chiave alla successiva: lo scheletro piega le due immagini vicine verso la posa intermedia e le sfuma. Sotto le miniature trovi ◀ ▶ per riordinare, ✕ per togliere e gli avvisi ⚠ (scheletro poco sicuro, scala o proporzioni diverse). Il prompt per l'AI è in `docs/guida-di-prova/prompt-sequenza-arrampicata.txt`. Limiti: la sagoma non distingue braccio vicino e lontano (il programma li tiene coerenti seguendo l'ordine delle pose), con gambe molto ripiegate l'adattamento può sbagliare; l'importazione guidata è solo per l'arrampicata.

**Manichino a parti (prototipo, passo 6).** Per i movimenti molto ampi (arrampicata, salto, passi lunghi) l'immagine unica si strappa. Il passo *Manichino* ricostruisce la figura come **parti separate** (testa, busto, braccia, gambe…), ciascuna con la propria mesh e la propria porzione di texture «cotta» dalla vista; le zone nascoste (il busto sotto il braccio) vengono ricostruite sfumando i dintorni, e negli profili gli arti lontani sono copie scurite di quelli vicini. Scheletro e animazioni restano gli stessi. Nel passo trovi *Confronto* (immagine unica a sinistra, manichino a destra) con pose di prova, *Parti* e *Atlante* per ispezionare il risultato; con l'opzione «Usa il manichino» attiva, anteprima, Playtest ed esportazione lo usano al posto dell'immagine. Limiti: è 2.5D (non vero 3D), la zona ricostruita è sfocata e il risultato dipende da quanto la vista è pulita; riprova con *Spessore delle parti* e *Sovrapposizione*.

## 9. Omini (personaggi procedurali)

Nello Studio personaggi, il pulsante **Omini** (accanto a *Modellini*) apre l’editor di un personaggio **senza immagini**: un omino con testa, busto, **braccia, gambe**, vestiti e accessori, disegnato dal programma e animato con lo stesso scheletro dei modellini. Ha uno stile pulito e coerente, si adatta a qualunque scena ed è leggerissimo.

- **Si parte da un modello** (*Minatore*, *Esploratrice*, *Piccolo (testa grande)*, *Slanciato*) con **Nuovo**, oppure da **Casuale** (ogni clic un omino diverso). **Copia** duplica quello corrente.
- **Aspetto:** capelli (nessuno, corti, spettinati, lunghi, coda, chignon), volto (puntini, semplice, sorriso, serio), maglia (maglietta, camicia, giacca, gilet), pantaloni (lunghi, pantaloncini, cargo), scarpe (stivali, scarpe da ginnastica, scalzo).
- **Colori:** pelle, capelli, maglia, pantaloni, scarpe, accento, contorno.
- **Accessori** (ognuno col suo colore): casco con lampada, berretto, cappello a tesa, zaino, piccone, fazzoletto, cintura, guanti, ginocchiere, occhiali.
- **Proporzioni:** 11 cursori (testa, collo, busto, fianchi, braccia, gambe, mani, piedi…): dal personaggio «testa grande» a quello slanciato. *Ripristina* torna ai valori base.
- **Stile e movimento:** spessore del contorno, ombra degli arti lontani (dà profondità), **vivacità** (ampiezza di tutti i movimenti).
- **Anteprima animata** in tutti gli stati (IDLE, WALK, CLIMB, INTERACT, COLLECT, JUMP, FALL), con velocità, specchio e *Ferma* per osservare una posa. Il passo della camminata segue la velocità.
- **Usalo:** nell’editor, Inspector del personaggio → *Omino (procedurale)*, oppure dallo Studio con *Crea un personaggio con questo omino* o l’elenco dei personaggi del progetto. Se un personaggio ha anche un modellino, questo ha la precedenza (ordine: modellino → omino → sprite → segnaposto).
- **Esporta:** *Esporta pacchetto ZIP* = `doll.json` + runtime senza dipendenze + `demo.html` (lettore autonomo). Non servono immagini.

Funziona bene anche da smartphone. **Limiti:** solo vista di profilo (specchiata per l’altra direzione); gli accessori sono quelli elencati; non ci sono ancora texture dipinte sulle parti né cambio d’abito in base all’inventario.

## 10. Playtest

Nasconde gli strumenti. **Play / Pausa / Stop / Reset** (`Spazio` = Play/Pausa). *Stop* riporta tutti alla partenza; *Reset* riparte da capo. In manuale clicca un nodo (cerchi bianchi) o usa l’elenco; destinazioni non raggiungibili vengono rifiutate con un messaggio. Pannelli: **Interazioni** (pulsanti manuali, inventario, eventi inviati al gioco), **Diagnostica** (posizione, nodo, collegamento, velocità, stato, percorso), **Parametri** (modificano davvero il personaggio). *Mostra percorsi* sovrappone i nodi di progetto. Tornando all’Editor **nulla è perso**: il Playtest non modifica il progetto (inventario e oggetti raccolti sono solo temporanei).

## 11. Salvataggio ed esportazione

- **Esporta → ZIP:** `project.json` + `manifest.json` + tutte le immagini (`assets/`). È il formato di backup e di consegna. **Importa** dalla Libreria (crea sempre un *nuovo* progetto, non sovrascrive).
- **Esporta → JSON:** solo configurazione, senza immagini.
- Vecchi progetti (schema v1) vengono aggiornati automaticamente; file più recenti dell’app vengono rifiutati con un avviso.

## 12. Integrazione con altri giochi

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
   Per i personaggi dello Studio vedi **docs/INTEGRAZIONE-PERSONAGGI.md** e il pacchetto *Esporta pacchetto ZIP* (include runtime e `demo.html`).
   Sono esportati anche `findRoute`, `resolveExit`, `availableInteractions`, `performInteraction`, `registerMovementType` (nuovi tipi di movimento).
3. **Eventi in uscita dal Playtest** (per prove di integrazione): ogni evento (`arrival`, `interaction`, `transition`, con il nome evento configurato) è un `CustomEvent` sulla `window` — `window.addEventListener('environment-builder:event', e => e.detail)` — e un `postMessage` al genitore se l’app è in un iframe (`{ source: 'environment-builder', event }`).

## 13. Limiti noti e consigli

- Niente fisica/collisioni (scelta di progetto: movimento guidato dal grafo).
- Immagini oltre la dimensione massima di texture della GPU (spesso 8192–16384 px) possono non comparire: verrà mostrato un avviso.
- Svuotare i dati del sito cancella i progetti: **esporta lo ZIP a fine sessione**.
- Un personaggio in visita da un altro ambiente si configura nell’ambiente d’origine.
- Le uscite con destinazione incompleta sono segnalate in arancione nell’Inspector: controlla l’elenco *Oggetti* dell’ambiente prima di consegnare.
- Interfaccia solo in italiano (per ora).
