# FPS 3D multiplayer in Python — scheletro di partenza

Questo **non è un esempio da leggere: è un gioco che funziona**. Parte così com'è, poi si aggiunge
un pezzo per volta. Serve solo **pygame** (già installato su questo computer): niente librerie 3D
da scaricare, niente scheda grafica particolare.

## Come si avvia

Doppio clic su **avvia.bat**. Oppure a mano:

1. `python server.py` in una finestra (una volta sola, è la partita condivisa);
2. `python main.py` in ogni finestra che gioca.

Comandi: **W A S D** per muoversi, **mouse** (o frecce) per girare, **tasto sinistro** per sparare,
**R** per ricaricare, **ESC** per uscire.

## Cosa fa già

- vista in prima persona in 3D con i **raggi** (raycasting): un mondo a blocchi con muri, corridoi,
  ombre e prospettiva, disegnato una colonna di schermo per volta;
- movimento con collisioni (si scivola lungo i muri invece di incastrarsi);
- sparo con mirino: colpisce solo ciò che è davvero davanti e non dietro un muro;
- zombie che inseguono, e altri giocatori disegnati come sagome;
- partita condivisa: vita, punti, zombie e posizioni li decide `server.py`.

## Quale file fa cosa

| file | a cosa serve |
| --- | --- |
| `main.py` | il gioco: comandi, motore 3D, sparo, zombie, interfaccia |
| `mondo.py` | la mappa (la stessa per gioco e server: si cambia qui, cambia per tutti) |
| `server.py` | la partita condivisa: chi c'è, dove sta, vita, punti, zombie |
| `avvia.bat` | avvia server e gioco insieme |

Se il server non è acceso il gioco **non si rompe**: si gioca da soli, con qualche zombie messo dal
gioco stesso, e sullo schermo c'è scritto perché.

## La riga da non togliere mai

```python
pygame.display.flip()
```

È quella che mostra sullo schermo ciò che hai disegnato. Senza, il gioco "gira" ma la finestra resta
nera: è successo davvero, ed è il motivo per cui lo Studio adesso lancia il programma e lo guarda.

## Come si aggiunge un pezzo (il modo che funziona)

1. una cosa sola per volta;
2. nel file giusto (il mondo in `mondo.py`, la partita in `server.py`, il resto in `main.py`);
3. si verifica **subito** con lo Studio: `node ...\strumenti\verifica.js`
   — lancia il gioco senza aprire finestre, preme i tasti, fotografa lo schermo e legge gli errori
   con il numero di riga;
4. se la verifica è pulita si passa al pezzo dopo.

## Cose da aggiungere, in ordine di difficoltà

1. texture sui muri al posto dei colori pieni;
2. armi diverse, ricarica, tempo fra un colpo e l'altro;
3. blocchi che si rompono (basta cambiare la mappa in `mondo.py` e avvisare tutti);
4. mappa più grande o generata a caso;
5. suoni e schermata di fine partita.
