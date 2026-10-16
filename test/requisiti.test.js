// Prova il confronto fra quello che l'utente ha chiesto e quello che c'e' davvero nel progetto.
// Caso vero del 15-16/9/2026: "un gioco multiplayer in stile minecraft, un FPS... in html css e js"
// e poi "rimuovi completamente il gioco in html css e js, fallo in python". Risultato: un gioco 2D
// visto dall'alto, senza rete, e Adam che scriveva "Fatto!".
const fs = require('fs');
const os = require('os');
const path = require('path');
const archivio = require('../strumenti/archivio-chat');
const requisiti = require('../strumenti/requisiti');

let pass = 0;
let fail = 0;
function check(nome, condizione, dettaglio) {
  if (condizione) { pass++; console.log('  ok   ' + nome); }
  else { fail++; console.log('  FAIL ' + nome + (dettaglio !== undefined ? '  -> ' + dettaglio : '')); }
}

const cartelle = [];
const baseChat = fs.mkdtempSync(path.join(os.tmpdir(), 'prova-requisiti-chat-'));
cartelle.push(baseChat);

function progetto(file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prova-requisiti-'));
  cartelle.push(dir);
  Object.keys(file).forEach(function (nome) {
    const completo = path.join(dir, nome);
    fs.mkdirSync(path.dirname(completo), { recursive: true });
    fs.writeFileSync(completo, file[nome]);
  });
  return dir;
}

// Scrive un archivio di chat come lo salva lo Studio: messaggi dell'utente, risposte di Adam e
// messaggi automatici dello Studio (che NON sono richieste dell'utente).
function chat(dir, scambio) {
  const messaggi = scambio.map(function (m, i) {
    return { role: m.auto ? 'user' : m.ruolo, auto: !!m.auto, ts: Date.now() - (scambio.length - i) * 60000, blocks: [{ kind: 'text', text: m.testo }] };
  });
  archivio.salva(dir, archivio.nuovoId() + '_' + Math.random().toString(16).slice(2, 6), messaggi, {}, baseChat);
}

function punto(esito, pezzo) {
  return esito.punti.find(function (p) { return p.nome.indexOf(pezzo) !== -1; });
}

console.log('\n=== Il caso vero: FPS multiplayer chiesto, gioco 2D per uno solo consegnato ===');
let dir = progetto({
  'main.py': [
    'import pygame, socket, math',
    'pygame.init()',
    'screen = pygame.display.set_mode((1024, 768))',
    'ws = None',
    'SERVER_URL = "wss://qualcosa"',
    'def draw():',
    '    pygame.draw.rect(screen, (0, 100, 255), (10, 10, 60, 80))'
  ].join('\n')
});
chat(dir, [
  { ruolo: 'user', testo: 'scrivi un gioco multiplayer in stile minecraf deve ssere un fps dove ci spariamo e in piu spariamo agli zombie fallo in html css e js' },
  { ruolo: 'assistant', testo: 'Ecco il gioco.' },
  { ruolo: 'user', testo: 'finisci il gioco, correggi gli errori e crea un bat in modo che posso testarlo in localhost' },
  { ruolo: 'user', testo: 'rimuovi completamente il gioco in html css e js  fallo in python' },
  { ruolo: 'assistant', testo: 'Fatto!' }
]);
let e = requisiti.controllaRequisiti(dir, { base: baseChat });
check('richieste lette dagli archivi delle chat', e.richieste === 3, JSON.stringify(e.richieste));
check('l\'ultima parola dell\'utente vince: il progetto va in Python', e.piattaforma === 'python' && punto(e, 'in Python').ok, JSON.stringify(e.punti));
check('niente piu\' HTML, CSS e JS: rispettato', punto(e, 'rimuovere HTML').ok, JSON.stringify(punto(e, 'rimuovere HTML')));
check('FPS 3D: MANCA, e dice cosa serve', !punto(e, 'FPS').ok && /pygame senza OpenGL/.test(punto(e, 'FPS').prova) && /Ursina|Panda3D/.test(punto(e, 'FPS').prova), JSON.stringify(punto(e, 'FPS')));
check('multiplayer: MANCA, import socket non basta', !punto(e, 'multiplayer').ok && /import socket da solo non basta/.test(punto(e, 'multiplayer').prova), JSON.stringify(punto(e, 'multiplayer')));
check('localhost non si pretende da un programma Python', punto(e, 'localhost').ok, JSON.stringify(punto(e, 'localhost')));

console.log('\n=== "Rimuovi l\'HTML" con i file HTML ancora li\' ===');
dir = progetto({ 'main.py': 'import pygame\n', 'index.html': '<p>gioco</p>', 'js/main.js': 'console.log(1)' });
chat(dir, [
  { ruolo: 'user', testo: 'fai un gioco in html css e js' },
  { ruolo: 'user', testo: 'rimuovi il gioco in html e js, fallo in python' }
]);
e = requisiti.controllaRequisiti(dir, { base: baseChat });
check('trova i file web rimasti e li elenca', !punto(e, 'rimuovere HTML').ok && /index\.html/.test(punto(e, 'rimuovere HTML').prova) && /main\.js/.test(punto(e, 'rimuovere HTML').prova), JSON.stringify(punto(e, 'rimuovere HTML')));

console.log('\n=== Un FPS 3D multiplayer sul serio: tutto a posto ===');
dir = progetto({
  'index.html': '<script src="https://cdn/three.min.js"></script><script src="gioco.js"></script>',
  'gioco.js': 'const r = new THREE.WebGLRenderer();\ndocument.body.requestPointerLock();\nconst s = new WebSocket("ws://localhost:8080");\n',
  'server.js': 'const { WebSocketServer } = require("ws");\nnew WebSocketServer({ port: 8080 });\n',
  'avvia.bat': '@echo off\r\nstart http://localhost:8000\r\npython -m http.server 8000\r\n'
});
chat(dir, [{ ruolo: 'user', testo: 'un fps multiplayer in html css e js, devo provarlo in localhost' }]);
e = requisiti.controllaRequisiti(dir, { base: baseChat });
check('3D in prima persona riconosciuto (Three.js + blocco del mouse)', punto(e, 'FPS').ok, JSON.stringify(punto(e, 'FPS')));
check('multiplayer riconosciuto (client e server)', punto(e, 'multiplayer').ok, JSON.stringify(punto(e, 'multiplayer')));
check('localhost riconosciuto (il bat avvia un server)', punto(e, 'localhost').ok, JSON.stringify(punto(e, 'localhost')));

console.log('\n=== Un .bat che apre il file invece di usare localhost (quello di Adam) ===');
dir = progetto({ 'index.html': '<canvas></canvas><script src="g.js"></script>', 'g.js': 'const c = document.querySelector("canvas").getContext("2d");', 'lancia_gioco.bat': '@echo off\r\nstart index.html\r\n' });
chat(dir, [{ ruolo: 'user', testo: 'fai un fps in html e js e un bat per provarlo in localhost' }]);
e = requisiti.controllaRequisiti(dir, { base: baseChat });
check('dice che il bat apre il file, non localhost', !punto(e, 'localhost').ok && /senza server/.test(punto(e, 'localhost').prova), JSON.stringify(punto(e, 'localhost')));
check('canvas 2d: non e\' un FPS 3D', !punto(e, 'FPS').ok && /canvas 2D/.test(punto(e, 'FPS').prova), JSON.stringify(punto(e, 'FPS')));
check('la sonda che vede WebGL e il blocco del mouse cambia il verdetto',
  requisiti.controllaRequisiti(dir, { base: baseChat, tecnologia: { contesti: ['webgl2'], pointerLock: 1, connessioni: [] } }).punti
    .find(function (p) { return p.nome.indexOf('FPS') !== -1; }).ok);

console.log('\n=== Quello che dice lo Studio ad Adam non e\' una richiesta dell\'utente ===');
dir = progetto({ 'index.html': '<p>ciao</p>' });
chat(dir, [
  { ruolo: 'user', testo: 'fai una pagina con la lista della spesa' },
  { auto: true, testo: 'Continua esattamente da dove ti eri fermato: fallo in python e rendilo multiplayer.' }
]);
e = requisiti.controllaRequisiti(dir, { base: baseChat });
check('il messaggio automatico dello Studio e\' ignorato', e.richieste === 1 && !punto(e, 'multiplayer') && e.piattaforma !== 'python', JSON.stringify(e));

console.log('\n=== Senza richieste da confrontare non si inventa niente ===');
dir = progetto({ 'main.py': 'print(1)\n' });
e = requisiti.controllaRequisiti(dir, { base: baseChat });
check('nessun punto da controllare', e.punti.length === 0, JSON.stringify(e));
e = requisiti.controllaRequisiti(dir, { base: baseChat, richiesta: 'fammi un gioco 3d in prima persona in python' });
check('con --richiesta scritta a mano il controllo si fa lo stesso', e.punti.length === 2 && !punto(e, 'FPS').ok, JSON.stringify(e.punti));

console.log('\n=== Progetto Unity: riconosce la piattaforma senza pretendere Web/Three.js ===');
dir = progetto({
  'Assets/Scripts/Player.cs': 'using UnityEngine;\npublic class Player : MonoBehaviour {}\n',
  'ProjectSettings/ProjectVersion.txt': 'm_EditorVersion: 6000.2.2f1\n',
  'ProjectSettings/ProjectSettings.asset': 'companyName: NotExist\n'
});
chat(dir, [{ ruolo: 'user', testo: 'crea un fps che posso sparare a degli zombie' }]);
e = requisiti.controllaRequisiti(dir, { base: baseChat });
check('riconosce automaticamente Unity dalla struttura della cartella', e.piattaforma === 'unity', JSON.stringify(e.piattaforma));
check('FPS 3D in Unity e\' considerato valido perche Unity e\' un motore 3D', punto(e, 'FPS') && punto(e, 'FPS').ok && /Unity e' un motore 3D/.test(punto(e, 'FPS').prova), JSON.stringify(punto(e, 'FPS')));

cartelle.forEach(function (d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} });
console.log('\n' + '='.repeat(50));
console.log('REQUISITI: ' + pass + ' passati, ' + fail + ' falliti');
process.exit(fail ? 1 : 0);
