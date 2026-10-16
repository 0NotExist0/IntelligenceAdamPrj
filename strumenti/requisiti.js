// NotExist Intelligience Studio - La richiesta dell'utente contro il risultato.
//
// Il codice puo' essere senza errori e fare tutt'altro da cio' che l'utente ha chiesto. Visto dal
// vivo il 15/9/2026: richiesta "un FPS multiplayer in stile Minecraft, da provare in localhost",
// risultato un giochino 2D visto dall'alto, senza rete, con un .bat che apriva il file; poi
// "rimuovi l'HTML, fallo in Python" e i file HTML e JS erano ancora li'. Adam diceva "FATTO".
// Io prima di dire che una cosa e' fatta rileggo la richiesta punto per punto e cerco la prova di
// ciascun punto. Qui lo fa lo Studio: dalle ultime richieste salvate ricava i punti controllabili
// e cerca nei file la prova che ci siano. Non giudica la qualita': dice cosa manca, con la prova.

const fs = require('fs');
const path = require('path');

const CARTELLE_IGNORATE = new Set(['.git', 'node_modules', '__pycache__', 'venv', '.venv', 'env', 'site-packages', 'Library', 'dati', 'dist', 'build']);

function slash(p) { return String(p).split('\\').join('/'); }

const MAX_RICHIESTE = 12;

// Le richieste vere dell'utente stanno gia' negli archivi delle chat che lo Studio salva a ogni
// turno (dati/chat/<progetto>/*.md): le righe sotto "### Utente, 22:25". Quelle sotto
// "### Studio -> Adam" e le righe "> Sistema"/"> Verifica" sono messaggi automatici, non richieste.
function richiesteConQuando(dir, opzioni) {
  opzioni = opzioni || {};
  const voci = [];
  try {
    const archivio = require('./archivio-chat');
    archivio.elenco(dir, opzioni.base)
      .filter(function (c) { return c.collegata !== false; })
      .sort(function (a, b) { return (a.fine || 0) - (b.fine || 0); })
      .slice(-6)
      .forEach(function (c) {
        let contenuto = '';
        try { contenuto = fs.readFileSync(c.percorso, 'utf8'); } catch (e) { return; }
        let dentro = false;
        let quando = '';
        let corrente = [];
        const chiudi = function () {
          const t = corrente.join('\n').trim();
          if (t) voci.push({ quando: quando, testo: t, chat: c.percorso });
          corrente = [];
        };
        contenuto.split(/\r?\n/).forEach(function (riga) {
          const intestazione = /^### /.test(riga);
          if (intestazione) {
            if (dentro) chiudi();
            const utente = /^### Utente,?\s*(.*)$/.exec(riga);
            dentro = !!utente;
            quando = utente ? utente[1].trim() : '';
            return;
          }
          if (dentro && !/^> /.test(riga)) corrente.push(riga);
        });
        if (dentro) chiudi();
      });
  } catch (e) { /* nessun archivio di chat */ }
  if (!voci.length) {
    try {
      const report = fs.readFileSync(path.join(dir, 'REPORT-PASSAGGIO-SESSIONE.md'), 'utf8');
      const m = /richiesta[^\n]*\n+([\s\S]{0,1500}?)(\n#|\n\*\*|$)/i.exec(report);
      if (m) voci.push({ quando: '', testo: m[1] });
    } catch (e) { /* nessun report */ }
  }
  return voci;
}

function caricaRichieste(dir, opzioni) {
  return richiesteConQuando(dir, opzioni).map(function (v) { return v.testo; });
}

// Le richieste da rimettere davanti ad Adam con le PAROLE dell'utente. I punti controllabili
// (piattaforma, 3D, multiplayer...) sono pochi e fissi: di "sono un raver che suona acid tekno,
// i colori devono essere quelli" non resta niente, ed e' proprio la parte che, dopo una
// compattazione, Adam non ha piu' da nessuna parte. Si tiene la prima (e' quella che ha creato
// il progetto) e le ultime due (sono quelle a cui deve rispondere adesso).
function richiesteDaRicordare(dir, opzioni) {
  opzioni = opzioni || {};
  const voci = richiesteConQuando(dir, opzioni).filter(function (v) { return v.testo.trim().length > 2; });
  if (!voci.length) return [];
  const quante = opzioni.quante || 3;
  const scelte = voci.length <= quante ? voci.slice() : [voci[0]].concat(voci.slice(-(quante - 1)));
  const massimo = opzioni.caratteri || 200;
  return scelte.map(function (v) {
    const testo = v.testo.replace(/\s+/g, ' ').trim();
    return {
      quando: v.quando,
      testo: testo.length > massimo ? testo.slice(0, massimo - 1).trim() + '...' : testo
    };
  });
}

// I punti controllabili di una richiesta. Le richieste piu' recenti possono cambiare la piattaforma
// ("fallo in Python" dopo "in html css e js").
function puntiDellaRichiesta(testi) {
  const tutto = testi.join('\n').toLowerCase();
  const punti = [];
  let piattaforma = null;
  testi.forEach(function (t) {
    const s = t.toLowerCase();
    if (/\b(in|con|usando)\s+python\b|fallo in python|in pygame|\bpygame\b/.test(s)) piattaforma = 'python';
    else if (/\bunity\b/.test(s)) piattaforma = 'unity';
    else if (/\b(html|css|javascript|js)\b/.test(s) && !/rimuovi|elimina|togli|cancella/.test(s)) piattaforma = 'web';
  });
  if (piattaforma) punti.push({ id: 'piattaforma', valore: piattaforma });
  const ultimaConRimozione = testi.slice().reverse().find(function (t) { return /(rimuovi|elimina|togli|cancella)[^.\n]*\b(html|css|js|javascript)\b/i.test(t); });
  if (ultimaConRimozione && piattaforma && piattaforma !== 'web') punti.push({ id: 'senzaWeb' });
  if (/\bfps\b|prima persona|first person|\b3d\b|minecraft/.test(tutto)) punti.push({ id: 'treD', fps: /\bfps\b|prima persona|first person/.test(tutto) });
  if (/multiplayer|multi-player|online|in rete|giocare insieme|piu' giocatori|più giocatori|ci spariamo/.test(tutto)) punti.push({ id: 'multiplayer' });
  if (/localhost/.test(tutto)) punti.push({ id: 'localhost' });
  if (/telefono|cellulare|smartphone|mobile|android|iphone/.test(tutto)) punti.push({ id: 'telefono' });
  return punti;
}

function leggiProgetto(dir) {
  const file = [];
  (function scendi(cartella, profondita) {
    if (profondita > 5 || file.length > 400) return;
    let voci;
    try { voci = fs.readdirSync(cartella, { withFileTypes: true }); } catch (e) { return; }
    voci.forEach(function (v) {
      const completo = path.join(cartella, v.name);
      if (v.isDirectory()) {
        if (!CARTELLE_IGNORATE.has(v.name) && !v.name.startsWith('.')) scendi(completo, profondita + 1);
      } else if (/\.(html?|js|mjs|cjs|css|py|bat|cmd|ps1|sh|json|cs)$/i.test(v.name)) {
        let testo = '';
        try { if (fs.statSync(completo).size < 1500000) testo = fs.readFileSync(completo, 'utf8'); } catch (e) { testo = ''; }
        file.push({ rel: slash(path.relative(dir, completo)), testo: testo });
      }
    });
  })(path.resolve(dir), 0);
  return file;
}

function conTesto(file, espressione, filtro) {
  return file.filter(function (f) { return (!filtro || filtro.test(f.rel)) && espressione.test(f.testo); }).map(function (f) { return f.rel; });
}

function controllaRequisiti(dir, opzioni) {
  opzioni = opzioni || {};
  const testi = opzioni.richiesta ? [opzioni.richiesta] : caricaRichieste(dir, opzioni);
  const punti = puntiDellaRichiesta(testi);
  if (!punti.length) return { richieste: testi.length, punti: [] };
  const file = leggiProgetto(dir);
  const py = file.filter(function (f) { return /\.py$/i.test(f.rel); });
  const web = file.filter(function (f) { return /\.(html?|js|mjs|css)$/i.test(f.rel); });
  const radice = dir ? path.resolve(dir) : process.cwd();
  const eUnity = (function () {
    try {
      let cartella = radice;
      for (let i = 0; i < 8; i++) {
        if (fs.existsSync(path.join(cartella, 'Assets')) &&
           (fs.existsSync(path.join(cartella, 'ProjectSettings')) || fs.existsSync(path.join(cartella, 'ProjectSettings', 'ProjectVersion.txt')))) {
          return true;
        }
        const su = path.dirname(cartella);
        if (su === cartella) break;
        cartella = su;
      }
    } catch (e) { return false; }
    return false;
  })();
  const piattaforma = (punti.find(function (p) { return p.id === 'piattaforma'; }) || {}).valore ||
    (eUnity ? 'unity' : (py.length && !web.length ? 'python' : (web.length ? 'web' : null)));
  const risultati = [];
  const aggiungi = function (nome, ok, prova) { risultati.push({ nome: nome, ok: ok, prova: prova }); };
  const tecnologia = opzioni.tecnologia || {};   // dalla sonda: contesti grafici, pointer lock, connessioni

  punti.forEach(function (p) {
    if (p.id === 'piattaforma') {
      if (p.valore === 'python') aggiungi('in Python', py.length > 0, py.length ? 'file Python: ' + py.slice(0, 4).map(function (f) { return f.rel; }).join(', ') : 'nessun file .py nel progetto');
      else if (p.valore === 'web') aggiungi('in HTML, CSS e JavaScript', web.length > 0, web.length ? 'file web: ' + web.slice(0, 4).map(function (f) { return f.rel; }).join(', ') : 'nessun file HTML o JavaScript');
      else if (p.valore === 'unity') aggiungi('in Unity', file.some(function (f) { return /\.cs$/i.test(f.rel); }), 'script C# del progetto');
    } else if (p.id === 'senzaWeb') {
      const rimasti = web.map(function (f) { return f.rel; });
      aggiungi('rimuovere HTML, CSS e JS', rimasti.length === 0, rimasti.length ? 'ci sono ancora: ' + rimasti.slice(0, 6).join(', ') : 'nessun file web rimasto');
    } else if (p.id === 'treD') {
      const nome = p.fps ? 'FPS in prima persona (3D)' : 'grafica 3D';
      if (piattaforma === 'python') {
        // Una libreria 3D, oppure un motore a raggi scritto a mano (raycasting): e' come si fa un
        // FPS in prima persona con il solo pygame, senza far installare niente a chi gioca.
        const raggi = conTesto(py, /MOTORE 3D|def\s+\w*raggio|\braycast\w*\s*\(/);
        const librerie3d = conTesto(py, /^\s*(import|from)\s+(ursina|panda3d|direct|pyglet|moderngl|OpenGL|pyopengl|vpython|pyray|raylib)\b|pygame\.OPENGL/m);
        aggiungi(nome, librerie3d.length > 0 || raggi.length > 0, librerie3d.length ? 'libreria 3D in ' + librerie3d.join(', ')
          : raggi.length ? 'motore 3D a raggi (raycasting) in ' + raggi.join(', ')
          : (conTesto(py, /^\s*import pygame|from pygame/m).length ? 'usa pygame senza OpenGL: disegna in 2D, non in prima persona. Per un FPS serve una libreria 3D (per esempio Ursina o Panda3D, da installare con pip)' : 'nessuna libreria 3D'));
      } else if (piattaforma === 'unity') {
        aggiungi(nome, true, 'Unity e\' un motore 3D');
      } else {
        const tre = conTesto(web, /three(\.module)?(\.min)?\.js|from\s+['"]three['"]|babylon|playcanvas|getContext\(\s*['"]webgl2?['"]|WebGLRenderer/i);
        const puntatore = conTesto(web, /requestPointerLock|PointerLockControls/);
        const vistoInPagina = (tecnologia.contesti || []).some(function (c) { return /webgl/i.test(c); });
        const ok = (tre.length > 0 || vistoInPagina) && (!p.fps || puntatore.length > 0 || vistoInPagina && (tecnologia.pointerLock || 0) > 0);
        aggiungi(nome, ok, ok ? '3D con ' + (tre.join(', ') || 'WebGL visto nella pagina') + (p.fps ? ', vista in prima persona con il blocco del mouse' : '')
          : (tre.length ? 'c\'e\' il 3D ma non la vista in prima persona (manca requestPointerLock / PointerLockControls)'
            : 'nessun 3D: ' + (conTesto(web, /getContext\(\s*['"]2d['"]/).length ? 'il gioco disegna su un canvas 2D' : 'nessuna libreria 3D e nessun WebGL') + '. Per un FPS nel browser serve una libreria 3D (per esempio Three.js) con PointerLockControls'));
      }
    } else if (p.id === 'multiplayer') {
      if (piattaforma === 'python') {
        const server = conTesto(py, /websockets\.serve|asyncio\.start_server|socketserver|\.bind\(|\.listen\(/);
        const client = conTesto(py, /websockets\.connect|\.connect\(\s*\(|socket\.create_connection|\.sendto\(/);
        aggiungi('multiplayer', server.length > 0 && client.length > 0, server.length && client.length ? 'server in ' + server.join(', ') + ', client in ' + client.join(', ')
          : (server.length ? 'c\'e\' il server ma nessun client si collega' : client.length ? 'il gioco prova a collegarsi ma nel progetto non c\'e\' nessun server' : 'nessun server e nessuna connessione di rete (un import socket da solo non basta)'));
      } else if (piattaforma === 'unity') {
        const net = conTesto(file.filter(function (f) { return /\.cs$/i.test(f.rel); }), /Unity\.Netcode|Mirror|Photon|NetworkBehaviour|NetworkManager/);
        aggiungi('multiplayer', net.length > 0, net.length ? 'libreria o codice multiplayer Unity in ' + net.join(', ') : 'nessun componente multiplayer Unity (es. Netcode for GameObjects, Mirror o NetworkBehaviour)');
      } else {
        const client = conTesto(web, /new\s+WebSocket\s*\(|socket\.io|\bio\s*\(|RTCPeerConnection|new\s+Peer\s*\(/);
        // Anche un server WebSocket scritto a mano vale (l'upgrade HTTP e la chiave di risposta):
        // e' il modo per non far installare niente a chi gioca.
        const server = conTesto(file.filter(function (f) { return /\.(js|mjs|cjs|py)$/i.test(f.rel); }),
          /require\(\s*['"](ws|socket\.io)['"]\)|from\s+['"](ws|socket\.io)['"]|WebSocketServer|websockets\.serve|new\s+Server\s*\(|Sec-WebSocket-Accept|\.on\(\s*['"]upgrade['"]/);
        const provato = (tecnologia.connessioni || []).length > 0;
        aggiungi('multiplayer', client.length > 0 && server.length > 0, client.length && server.length ? 'client in ' + client.join(', ') + ', server in ' + server.join(', ') + (provato ? ', connessione vista nella pagina' : '')
          : (client.length ? 'il gioco prova a collegarsi ma nel progetto non c\'e\' nessun server (serve per esempio un server Node con la libreria ws)' : 'nessuna connessione di rete: e\' un gioco per una persona sola'));
      }
    } else if (p.id === 'localhost') {
      const lanciatori = file.filter(function (f) { return /\.(bat|cmd|ps1|sh)$/i.test(f.rel) || /(^|\/)package\.json$/.test(f.rel); });
      const conServer = lanciatori.filter(function (f) { return /http\.server|http-server|live-server|\bserve\b|node\s+\S+\.js|npm\s+(start|run)|npx\s|vite|flask|uvicorn/i.test(f.testo); });
      const apreFile = lanciatori.filter(function (f) { return /start\s+("")?\s*\S*\.html/i.test(f.testo) && !/localhost/i.test(f.testo); });
      if (piattaforma === 'python' && !web.length) {
        aggiungi('da provare in localhost', true, 'un programma Python si prova lanciandolo, localhost serve solo alle pagine web');
      } else if (piattaforma === 'unity') {
        aggiungi('da provare in localhost', true, 'un gioco Unity si prova direttamente nell\'Editor premendo Play o con una build, non usa localhost');
      } else {
        aggiungi('da provare in localhost', conServer.length > 0, conServer.length ? 'avvio con server locale in ' + conServer.map(function (f) { return f.rel; }).join(', ')
          : (apreFile.length ? apreFile.map(function (f) { return f.rel; }).join(', ') + ' apre il file direttamente, senza server: non e\' localhost' : 'nessun modo di avviarlo in localhost (per esempio un .bat con python -m http.server 8000 e l\'apertura di http://localhost:8000)'));
      }
    } else if (p.id === 'telefono') {
      if (piattaforma === 'python') aggiungi('per telefono', false, 'un programma Python per PC non gira sul telefono: serve per esempio Kivy o una versione web');
      else if (piattaforma === 'unity') {
        const android = conTesto(file, /ProjectSettings\.asset/);
        aggiungi('per telefono', android.length > 0, 'Unity supporta la build Android e iOS tramite Player Settings');
      } else if (piattaforma === 'web') {
        const viewport = conTesto(web, /name=["']viewport["']/i, /\.html?$/i);
        const tocco = conTesto(web, /touchstart|pointerdown|@media/i);
        aggiungi('per telefono', viewport.length > 0 && tocco.length > 0, viewport.length && tocco.length ? 'viewport e adattamento in ' + tocco.slice(0, 3).join(', ') : 'mancano ' + [viewport.length ? '' : 'il meta viewport', tocco.length ? '' : 'i comandi a tocco o le regole @media'].filter(Boolean).join(' e '));
      }
    }
  });
  return { richieste: testi.length, piattaforma: piattaforma, punti: risultati };
}

module.exports = {
  controllaRequisiti: controllaRequisiti,
  puntiDellaRichiesta: puntiDellaRichiesta,
  caricaRichieste: caricaRichieste,
  richiesteConQuando: richiesteConQuando,
  richiesteDaRicordare: richiesteDaRicordare
};
