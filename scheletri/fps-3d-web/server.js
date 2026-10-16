// Server del gioco: serve i file del gioco in localhost e mette in contatto i giocatori.
//
// Non serve installare niente: il WebSocket e' scritto qui sotto con quello che Node ha gia'
// dentro (una cinquantina di righe). Avvialo con:  node server.js
// Poi apri http://localhost:8000 in due finestre: sono due giocatori.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORTA = Number(process.env.PORTA || 8000);
const TIPI = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg'
};

// ------------------------------------------------------------------ i file del gioco

const server = http.createServer(function (richiesta, risposta) {
  const rel = decodeURIComponent(String(richiesta.url || '/').split('?')[0]);
  const file = path.join(__dirname, rel === '/' ? 'index.html' : rel);
  // Mai fuori dalla cartella del gioco, nemmeno con "..".
  if (file !== __dirname && !file.startsWith(__dirname + path.sep)) {
    risposta.writeHead(403);
    return risposta.end('vietato');
  }
  fs.readFile(file, function (errore, dati) {
    if (errore) {
      risposta.writeHead(404);
      return risposta.end('file non trovato: ' + rel);
    }
    risposta.writeHead(200, { 'Content-Type': TIPI[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    risposta.end(dati);
  });
});

// ------------------------------------------------------------------ WebSocket fatto in casa

const MAGIA = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';   // costante del protocollo WebSocket

// Un messaggio di testo da mandare al browser (il server non maschera mai i dati).
function incornicia(testo) {
  const corpo = Buffer.from(testo, 'utf8');
  let testa;
  if (corpo.length < 126) {
    testa = Buffer.from([0x81, corpo.length]);
  } else if (corpo.length < 65536) {
    testa = Buffer.alloc(4);
    testa[0] = 0x81; testa[1] = 126; testa.writeUInt16BE(corpo.length, 2);
  } else {
    testa = Buffer.alloc(10);
    testa[0] = 0x81; testa[1] = 127; testa.writeBigUInt64BE(BigInt(corpo.length), 2);
  }
  return Buffer.concat([testa, corpo]);
}

// Legge dal flusso tutti i messaggi completi che sono arrivati; restituisce quello che avanza.
function sconfeziona(avanzo, suMessaggio, suChiusura) {
  let dati = avanzo;
  while (dati.length >= 2) {
    const opcode = dati[0] & 0x0f;
    const mascherato = (dati[1] & 0x80) === 0x80;
    let lunghezza = dati[1] & 0x7f;
    let inizio = 2;
    if (lunghezza === 126) {
      if (dati.length < 4) break;
      lunghezza = dati.readUInt16BE(2);
      inizio = 4;
    } else if (lunghezza === 127) {
      if (dati.length < 10) break;
      lunghezza = Number(dati.readBigUInt64BE(2));
      inizio = 10;
    }
    const maschera = mascherato ? dati.slice(inizio, inizio + 4) : null;
    if (mascherato) inizio += 4;
    if (dati.length < inizio + lunghezza) break;              // messaggio ancora incompleto
    const corpo = Buffer.from(dati.slice(inizio, inizio + lunghezza));
    if (maschera) for (let i = 0; i < corpo.length; i++) corpo[i] ^= maschera[i % 4];
    dati = dati.slice(inizio + lunghezza);
    if (opcode === 8) { suChiusura(); return Buffer.alloc(0); }
    if (opcode === 1) suMessaggio(corpo.toString('utf8'));
    // opcode 9 (ping) e 10 (pong) non servono a questo gioco
  }
  return dati;
}

// ------------------------------------------------------------------ la partita

const giocatori = new Map();       // id -> { presa, nome, x, y, z, ry, vita, punti }
const zombie = [];                 // li muove il server, cosi' tutti vedono gli stessi
let prossimoId = 1;
let prossimoZombie = 1;

function mandaATutti(messaggio) {
  const dati = incornicia(JSON.stringify(messaggio));
  giocatori.forEach(function (g) {
    try { g.presa.write(dati); } catch (e) { /* giocatore uscito */ }
  });
}

function statoDeiGiocatori() {
  return Array.from(giocatori.entries()).map(function (voce) {
    const g = voce[1];
    return { id: voce[0], nome: g.nome, x: g.x, y: g.y, z: g.z, ry: g.ry, vita: g.vita, punti: g.punti };
  });
}

server.on('upgrade', function (richiesta, presa) {
  const chiave = richiesta.headers['sec-websocket-key'];
  if (!chiave) return presa.destroy();
  presa.write([
    'HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade',
    'Sec-WebSocket-Accept: ' + crypto.createHash('sha1').update(chiave + MAGIA).digest('base64'), '', ''
  ].join('\r\n'));
  presa.setNoDelay(true);

  const id = prossimoId++;
  const giocatore = { presa: presa, nome: 'Giocatore ' + id, x: 8, y: 6, z: 8, ry: 0, vita: 100, punti: 0 };
  giocatori.set(id, giocatore);
  console.log('[Gioco] Giocatore ' + id + ' collegato (' + giocatori.size + ' in partita)');

  presa.write(incornicia(JSON.stringify({ tipo: 'benvenuto', id: id, giocatori: statoDeiGiocatori(), zombie: zombie })));
  mandaATutti({ tipo: 'entrato', id: id, nome: giocatore.nome });

  let avanzo = Buffer.alloc(0);
  const saluta = function () {
    if (!giocatori.has(id)) return;
    giocatori.delete(id);
    console.log('[Gioco] Giocatore ' + id + ' uscito (' + giocatori.size + ' in partita)');
    mandaATutti({ tipo: 'uscito', id: id });
    try { presa.destroy(); } catch (e) {}
  };

  presa.on('data', function (pezzo) {
    avanzo = sconfeziona(Buffer.concat([avanzo, pezzo]), function (testo) {
      let m;
      try { m = JSON.parse(testo); } catch (e) { return; }
      if (m.tipo === 'stato') {
        giocatore.x = m.x; giocatore.y = m.y; giocatore.z = m.z; giocatore.ry = m.ry;
        if (m.nome) giocatore.nome = String(m.nome).slice(0, 20);
      } else if (m.tipo === 'sparo') {
        colpito(id, m);
      }
    }, saluta);
  });
  presa.on('error', saluta);
  presa.on('close', saluta);
});

function colpito(idSparatore, m) {
  const sparatore = giocatori.get(idSparatore);
  if (!sparatore) return;
  if (m.bersaglio === 'giocatore') {
    const vittima = giocatori.get(m.id);
    if (!vittima) return;
    vittima.vita -= 25;
    if (vittima.vita <= 0) {
      vittima.vita = 100;
      vittima.x = 8; vittima.y = 6; vittima.z = 8;
      sparatore.punti += 1;
      mandaATutti({ tipo: 'morto', id: m.id, da: idSparatore });
    }
    mandaATutti({ tipo: 'vita', id: m.id, vita: vittima.vita });
  } else if (m.bersaglio === 'zombie') {
    const z = zombie.find(function (x) { return x.id === m.id; });
    if (!z) return;
    z.vita -= 34;
    if (z.vita <= 0) {
      zombie.splice(zombie.indexOf(z), 1);
      sparatore.punti += 1;
      mandaATutti({ tipo: 'zombieMorto', id: z.id, da: idSparatore });
    }
  }
}

// Zombie: nascono ogni 5 secondi (massimo 6) e camminano verso il giocatore piu' vicino.
setInterval(function () {
  if (!giocatori.size) {
    zombie.length = 0;
    return;
  }
  if (zombie.length < 6) {
    const angolo = Math.random() * Math.PI * 2;
    zombie.push({
      id: prossimoZombie++, vita: 100,
      x: 8 + Math.cos(angolo) * 10, y: 6, z: 8 + Math.sin(angolo) * 10
    });
  }
}, 5000);

setInterval(function () {
  const elenco = statoDeiGiocatori();
  zombie.forEach(function (z) {
    let vicino = null;
    let minimo = Infinity;
    elenco.forEach(function (g) {
      const d = (g.x - z.x) * (g.x - z.x) + (g.z - z.z) * (g.z - z.z);
      if (d < minimo) { minimo = d; vicino = g; }
    });
    if (!vicino) return;
    const distanza = Math.sqrt(minimo) || 1;
    z.x += ((vicino.x - z.x) / distanza) * 0.06;
    z.z += ((vicino.z - z.z) / distanza) * 0.06;
    z.y = vicino.y;
  });
  if (giocatori.size) mandaATutti({ tipo: 'mondo', giocatori: elenco, zombie: zombie });
}, 66);   // circa 15 volte al secondo

server.listen(PORTA, function () {
  console.log('Gioco pronto: apri http://localhost:' + PORTA + ' (aprilo in due finestre per giocare in due)');
});
