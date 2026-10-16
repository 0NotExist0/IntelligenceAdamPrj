# Personaggio su un cubo, con fisica — scheletro di partenza

Questo **non è un esempio da leggere: è un gioco che funziona**. Parte così com'è, poi si aggiunge
un pezzo per volta. Serve solo **pygame** (già installato su questo computer): niente librerie 3D o
di fisica da scaricare.

## Come si avvia

Doppio clic su **avvia.bat**, oppure `python main.py`.

Comandi: **W A S D** (o le frecce) per muoversi, **Spazio** per saltare, **Q / E** oppure il **mouse**
(tieni premuto il tasto sinistro e trascina) per girare la camera, **R** per ripartire, **Esc** per uscire.
I comandi seguono la camera: "avanti" è sempre lontano da chi guarda.

## Cosa fa già

- un cubo di 8 × 8 metri sospeso nel vuoto, con tre gradini (0,6 m, 0,8 m e 1,5 m);
- il personaggio è **Robott**, il modello riggato di Unity: Blender l'ha fotografato da 8 direzioni,
  fermo e in 8 pose della camminata (72 immagini in `personaggio-3d/sprite`);
- il personaggio in terza persona, con l'ombra sotto i piedi (dice dove atterrerà);
- **fisica vera**: gravità, salto alto circa 1,6 m, spinta e frenata, velocità massima 6 m/s;
- **collisioni**: sale sui gradini saltando, sbatte contro i lati, non li attraversa;
- se esce dal bordo cade e, sotto i −15 metri, riparte dal punto di partenza;
- la fisica va a passi fissi (1/120 di secondo): i salti sono uguali su qualsiasi computer.

## Quale file fa cosa

| file | a cosa serve |
| --- | --- |
| `main.py` | la finestra, i tasti e il ciclo del gioco |
| `fisica.py` | gravità, salto, attrito e collisioni: solo numeri, niente pygame |
| `mondo.py` | il cubo e i gradini: per cambiare il livello si cambia solo qui |
| `personaggio.py` | dai tasti a una direzione nel mondo, e la ripartenza se cade |
| `disegno.py` | la camera e il 3D |
| `figura.py` | le foto del personaggio: quale direzione e quale passo mostrare |
| `personaggio-3d/` | Robott: `robott.glb` (il modello 3D, lo mostra il pannello 3D dello Studio) e le foto in `sprite/` |

Ogni file è corto apposta: si legge tutto in una volta e si cambia senza toccare gli altri.
La fisica non usa pygame, quindi si prova da sola, senza aprire finestre.

## Il personaggio (in `figura.py`)

Il modello 3D vero è troppo pesante per questo disegno fatto a mano, quindi si usano le sue foto.
A ogni fotogramma `figura.py` sceglie:

- la **direzione** (una delle 8) da dove guarda il personaggio *rispetto alla camera*: 0 = di spalle,
  2 = va verso destra, 4 = viene verso chi guarda, 6 = va verso sinistra;
- la **posa** da quanta strada ha fatto (`METRI_PER_CICLO`): così i piedi non scivolano. Fermo usa la
  foto di riposo, in aria quella a gambe aperte.

La foto si mette con i piedi sul punto giusto e alla misura giusta per la distanza, in fila con le
facce del mondo: il gradino alto davanti lo copre, il pavimento sotto i piedi mai.
Se le foto non ci sono, il personaggio torna a essere fatto di scatole (nessun errore).

**Un altro personaggio** (un FBX riggato con le ossa di Mixamo, per esempio da Unity): nel pannello **3D**
dello Studio, "Converti con Blender". Le foto nuove finiscono in `personaggio-3d/sprite` della cartella
del progetto, e il gioco usa quelle (prima cerca in `../personaggio-3d/sprite`, poi nella sua cartella).
Da riga di comando: `node ...\strumenti\personaggio.js --prepara "<file.fbx>" --uscita personaggio-3d`.

## Le regole della fisica (in `fisica.py`)

Tutto ciò che è solido è una **scatola dritta** (un cubo o un parallelepipedo, mai storto).
A ogni passo il personaggio si muove **un asse alla volta**: se finisce dentro una scatola lo si
rimette a filo e si ferma la velocità su quell'asse. Se succede scendendo, è a terra.
I numeri in cima al file (`GRAVITA`, `VELOCITA_SALTO`, `ATTRITO`...) cambiano come si muove.

## La riga da non togliere mai

```python
pygame.display.flip()
```

È quella che mostra sullo schermo ciò che è stato disegnato. Senza, il gioco "gira" ma la finestra
resta nera.

## Come si aggiunge un pezzo (il modo che funziona)

1. una cosa sola per volta, nel file giusto (il livello in `mondo.py`, le regole in `fisica.py`...);
2. si verifica **subito** con lo Studio: `node ...\strumenti\verifica.js` — lancia il gioco senza
   aprire finestre, preme i tasti, fotografa lo schermo e legge gli errori con il numero di riga;
3. se la verifica è pulita si passa al pezzo dopo.

## Cose da aggiungere, in ordine di difficoltà

1. piattaforme che si muovono (una scatola in `mondo.py` che cambia posizione a ogni passo);
2. casse da spingere, con la loro fisica;
3. monete da raccogliere e punteggio;
4. doppio salto e corsa;
5. un altro personaggio: si converte dal pannello 3D dello Studio (vedi sopra).
