// Il collegamento con gli altri giocatori. Sta in un file a parte apposta: chi lavora sul gioco
// (mondo, sparo, zombie) non deve toccare la rete, e chi lavora sulla rete non tocca il gioco.
//
// Se il server non c'e' (per esempio la pagina e' stata aperta col doppio clic invece che da
// http://localhost:8000) il gioco NON si rompe: si gioca da soli e l'avviso lo dice.

export function collega(ascoltatori) {
  const stato = { collegato: false, id: null, presa: null, errore: null };
  let indirizzo;
  try {
    indirizzo = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
  } catch (e) {
    indirizzo = '';
  }
  // Pagina aperta col doppio clic (file://): non c'e' nessun server a cui collegarsi.
  if (!indirizzo || location.protocol === 'file:') {
    stato.errore = 'Gioco aperto senza server: si gioca da soli. Avvia "avvia.bat" (oppure "node server.js") e apri http://localhost:8000.';
    if (ascoltatori.suErrore) ascoltatori.suErrore(stato.errore);
    return stato;
  }

  let presa;
  try {
    presa = new WebSocket(indirizzo);
  } catch (e) {
    stato.errore = 'Non riesco a collegarmi al server: ' + e.message;
    if (ascoltatori.suErrore) ascoltatori.suErrore(stato.errore);
    return stato;
  }
  stato.presa = presa;

  presa.addEventListener('open', function () {
    stato.collegato = true;
    if (ascoltatori.suApertura) ascoltatori.suApertura();
  });

  presa.addEventListener('message', function (evento) {
    let messaggio;
    try {
      messaggio = JSON.parse(evento.data);
    } catch (e) {
      return;
    }
    if (messaggio.tipo === 'benvenuto') stato.id = messaggio.id;
    if (ascoltatori.suMessaggio) ascoltatori.suMessaggio(messaggio);
  });

  // Un errore di rete non deve fermare il gioco: si continua da soli.
  presa.addEventListener('error', function () {
    stato.collegato = false;
    stato.errore = 'Server non raggiungibile: stai giocando da solo.';
    if (ascoltatori.suErrore) ascoltatori.suErrore(stato.errore);
  });

  presa.addEventListener('close', function () {
    stato.collegato = false;
    if (ascoltatori.suChiusura) ascoltatori.suChiusura();
  });

  stato.manda = function (messaggio) {
    if (presa.readyState === WebSocket.OPEN) presa.send(JSON.stringify(messaggio));
  };
  return stato;
}
