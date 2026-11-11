# Guida di prova per i generatori di immagini AI

Esperimento per capire **quanto fedelmente un generatore AI segue una guida** (sagoma, proporzioni, viste) prima di costruire il modellino nel builder. Nessun codice dell'app è coinvolto: servono solo queste immagini e il tuo generatore.

## File
| File | A cosa serve |
|---|---|
| `guida-silhouette.png` | **Immagine di riferimento da dare all'AI.** Manichino neutro, 3 viste (fronte · profilo verso destra · retro) in 3 celle da 1024×1536. Piedi tutti sulla stessa linea. Nessuna scritta. |
| `guida-mappa-parti.png` | **Per te, non per l'AI.** Stesso layout con le parti colorate e le linee di riferimento (testa, mento, spalle, gomiti, anche, ginocchia, piedi). Serve a controllare e, in futuro, ad allineare. |
| `prompt-guida.txt` | Testo da incollare (inglese e italiano) con i parametri da compilare. |
| `scheda-valutazione.md` | Cosa guardare nel risultato e come mandarmelo. |

## Come fare la prova
1. Apri il tuo generatore che accetta un'immagine di riferimento.
2. Carica `guida-silhouette.png`, incolla il prompt di `prompt-guida.txt` (compilando i parametri) e genera.
3. Prova **due modalità**, se puoi:
   - **A. Foglio unico** con le tre viste (consigliata);
   - **B. Una vista alla volta**: prima il fronte, poi usa il fronte come riferimento per profilo e retro.
4. Ripeti con **un secondo vestiario** (es. un altro personaggio) per capire se lo stile resta coerente.
5. Mandami i risultati: il foglio generato e, se vuoi, le immagini singole.
6. Compila `scheda-valutazione.md` (basta un sì/no per riga).

## Note
- Sfondo: chiedi un colore **piatto e uniforme** (magenta `#FF00FF` o bianco). La trasparenza vera è rara; il builder rimuoverà lo sfondo. Se ottieni la trasparenza, meglio ancora.
- Il profilo guarda **a destra**: nel gioco si specchia per andare a sinistra.
- I disegni non verranno modificati o resi pubblici: l'esperimento resta sul tuo computer.
- Le immagini si rigenerano con `python3 tools/make-guide.py`.
