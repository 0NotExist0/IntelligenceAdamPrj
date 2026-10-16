# FPS 3D multiplayer per il web — scheletro di partenza

Questo **non è un esempio da leggere: è un gioco che funziona**. Parte così com'è, poi si aggiunge
un pezzo per volta.

## Come si avvia

Doppio clic su **avvia.bat** (oppure `node server.js`), poi si apre da solo `http://localhost:8000`.
Per giocare in due: apri lo stesso indirizzo in **due finestre** (o su due computer della stessa
rete, mettendo l'indirizzo del computer che fa da server).

Comandi: **W A S D** per muoversi, **mouse** per guardare, **tasto sinistro** per sparare,
**Spazio** per saltare, **R** per ricaricare, **Esc** per liberare il mouse.

## Cosa fa già

- mondo a blocchi in 3D e vista in prima persona (il mouse gira la testa, non la freccia);
- movimento, salto e collisioni con i blocchi;
- sparo con mirino: si colpiscono zombie e altri giocatori;
- zombie che nascono e inseguono il giocatore più vicino;
- più giocatori collegati insieme, con vita e punti tenuti dal server;
- server in `localhost` **senza installare niente**: il WebSocket è scritto dentro `server.js`.

## Quale file fa cosa

| file | a cosa serve |
| --- | --- |
| `index.html` | la pagina, il menu iniziale, vita/munizioni/punti |
| `gioco.js` | il gioco: mondo, giocatore, comandi, sparo, zombie, disegno |
| `rete.js` | il collegamento con gli altri giocatori (niente altro) |
| `server.js` | serve i file e tiene la partita: giocatori, zombie, vita, punti |
| `vendor/` | Three.js, la libreria 3D. **Non si modifica** |

Se il server non è acceso il gioco **non si rompe**: si gioca da soli, con qualche zombie messo dal
gioco stesso, e in alto a destra c'è scritto perché.

## Come si aggiunge un pezzo (il modo che funziona)

1. una cosa sola per volta (esempio: "i blocchi si rompono sparandoci");
2. si scrive nel pezzo giusto (il mondo in `gioco.js`, la rete in `rete.js`, la partita in `server.js`);
3. si verifica **subito** con lo Studio: `node ...\strumenti\verifica.js`
   — apre il gioco in un browser vero, clicca, guarda lo schermo e riporta gli errori con la riga;
4. se la verifica è pulita si passa al pezzo dopo. Se no, si corregge **prima** di aggiungere altro.

## Cose da aggiungere, in ordine di difficoltà

1. rompere e mettere blocchi (con il tasto destro);
2. armi diverse, ricarica, tempo fra un colpo e l'altro;
3. vita e danno decisi solo dal server (così nessuno può barare);
4. mappa più grande o generata a caso;
5. suoni e schermata di fine partita.
