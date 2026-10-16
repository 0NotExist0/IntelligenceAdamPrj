// Prova la scelta di cosa mettere nelle istruzioni di Adam. Misurato il 17/9/2026: i blocchi su
// scheletri, texture e modelli 3D pesano 598 token e viaggiano in OGNI richiesta, anche quando il
// progetto e' un sito curriculum. Qui si controlla che entrino quando servono e restino fuori
// quando no - e soprattutto che un falso allarme non li tolga a un gioco vero.
const fs = require('fs');
const os = require('os');
const path = require('path');
const pertinenza = require('../strumenti/pertinenza');

let pass = 0;
let fail = 0;
function check(nome, condizione, dettaglio) {
  if (condizione) { pass++; console.log('  ok   ' + nome); }
  else { fail++; console.log('  FAIL ' + nome + (dettaglio !== undefined ? '  -> ' + dettaglio : '')); }
}

function progetto(file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pertinenza-'));
  Object.keys(file || {}).forEach(function (nome) {
    const completo = path.join(dir, nome);
    fs.mkdirSync(path.dirname(completo), { recursive: true });
    fs.writeFileSync(completo, file[nome]);
  });
  return dir;
}

const cartelle = [];
function prova(nome, file) {
  const dir = progetto(file);
  cartelle.push(dir);
  return pertinenza.serveRobaDaGioco(dir);
}

try {
  console.log('\n=== Progetti che NON sono giochi ===');
  const sito = prova('sito', {
    'index.html': '<html><body><h1>Curriculum</h1><p>Three. Ho lavorato in tre aziende.</p><script src="app.js"></script></body></html>',
    'app.js': 'document.querySelector("h1").addEventListener("click", function () { alert("ciao"); });',
    'stile.css': 'body { background: #111; color: #0f0; }'
  });
  check('un sito curriculum non si porta dietro le risorse di gioco', sito.serve === false, sito.perche);
  // Il caso vero: nel curriculum dell'utente c'era la parola "Three." e bastava a far passare
  // il sito per un progetto 3D.
  check('la parola "Three." in un testo non e\' three.js', !/three/i.test(sito.perche), sito.perche);
  const gestionale = prova('gestionale', {
    'main.py': 'import csv\nprint("fatture")',
    'dati.csv': 'a,b,c'
  });
  check('un programma Python senza pygame nemmeno', gestionale.serve === false, gestionale.perche);
  const grafico = prova('grafico', {
    'index.html': '<canvas id="c"></canvas>',
    'grafico.js': 'const g = document.getElementById("c").getContext("2d"); g.fillRect(0,0,10,10);'
  });
  check('un canvas 2D per un grafico non e\' un gioco', grafico.serve === false, grafico.perche);

  console.log('\n=== Progetti che sono giochi (o lo diventeranno) ===');
  const pygame = prova('pygame', { 'gioco.py': 'import pygame\npygame.init()' });
  check('pygame lo riconosce', pygame.serve === true && /pygame/.test(pygame.perche), pygame.perche);
  const three = prova('three', { 'gioco.js': 'import * as THREE from "three";\nconst s = new THREE.Scene();' });
  check('three.js lo riconosce', three.serve === true, three.perche);
  const webgl = prova('webgl', { 'gioco.js': 'const gl = canvas.getContext("webgl2");\ndocument.body.requestPointerLock();' });
  check('WebGL e il puntatore bloccato lo riconoscono', webgl.serve === true, webgl.perche);
  const blender = prova('blender', { 'addon.py': 'import bpy\nbpy.ops.mesh.primitive_cube_add()' });
  check('uno script Blender lo riconosce', blender.serve === true, blender.perche);
  const unity = prova('unity', { 'ProjectSettings/ProjectSettings.asset': 'm_Name: gioco' });
  check('un progetto Unity lo riconosce', unity.serve === true, unity.perche);
  const modelli = prova('modelli', { 'risorse/zombie.glb': 'glTF' });
  check('un modello 3D nella cartella lo riconosce', modelli.serve === true, modelli.perche);

  console.log('\n=== Quando il progetto e\' vuoto contano le parole dell\'utente ===');
  const vuoto = progetto({ 'LEGGIMI.md': 'cartella nuova' });
  cartelle.push(vuoto);
  const baseChat = fs.mkdtempSync(path.join(os.tmpdir(), 'pertinenza-chat-'));
  cartelle.push(baseChat);
  const archivio = require('../strumenti/archivio-chat');
  archivio.salva(vuoto, archivio.nuovoId(), [
    { role: 'user', ts: Date.now(), blocks: [{ kind: 'text', text: 'fammi un gioco fps multiplayer in stile minecraft' }] }
  ], {}, baseChat);
  const chiesto = pertinenza.serveRobaDaGioco(vuoto, { baseChat: baseChat });
  check('se l\'utente ha chiesto un gioco, le risorse ci sono subito', chiesto.serve === true, chiesto.perche);
  check('e dice quale parola l\'ha convinto', /"(gioco|fps|multiplayer|minecraft)"/.test(chiesto.perche), chiesto.perche);

  const baseChat2 = fs.mkdtempSync(path.join(os.tmpdir(), 'pertinenza-chat2-'));
  cartelle.push(baseChat2);
  const vuoto2 = progetto({ 'LEGGIMI.md': 'altra cartella' });
  cartelle.push(vuoto2);
  archivio.salva(vuoto2, archivio.nuovoId(), [
    { role: 'user', ts: Date.now(), blocks: [{ kind: 'text', text: 'fammi il sito del mio negozio di scarpe con il modulo contatti' }] }
  ], {}, baseChat2);
  check('per un sito no', pertinenza.serveRobaDaGioco(vuoto2, { baseChat: baseChat2 }).serve === false);

  console.log('\n=== La riga di riserva: la scelta resta ad Adam ===');
  const riga = pertinenza.rigaDiRiserva({ scheletri: 'node scheletri.js', texture: 'node texture.js', modelli: 'node modelli.js' });
  check('dice come chiamare scheletri, texture e modelli',
    /scheletri\.js --elenco/.test(riga) && /texture\.js --aiuto/.test(riga) && /modelli\.js --aiuto/.test(riga), riga);
  check('sta in una riga (sotto i 350 caratteri)', riga.length < 350, String(riga.length));
  check('senza comandi non inventa niente', pertinenza.rigaDiRiserva({}) === '');

  console.log('\n=== Si puo\' sempre forzare a mano ===');
  check('forza true', pertinenza.serveRobaDaGioco(sito, { forza: true }).serve === true);
  check('forza false su un gioco vero', pertinenza.serveRobaDaGioco(pygame, { forza: false }).serve === false);

  console.log('\n=== Aggancio nello Studio (server.js) ===');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  check('le risorse entrano solo se servono', /pertinenza\.serveRobaDaGioco\(config\.cwd\)/.test(server) &&
    /if \(gioco\.serve\) \{/.test(server));
  check('altrimenti va la riga di riserva', /pertinenza\.rigaDiRiserva\(\{/.test(server));
  check('e lo Studio scrive nel log cosa ha deciso e perche\'', /\[Prompt\] Risorse di gioco/.test(server));
  check('il peso delle istruzioni si vede nel log', /\[Prompt\] Istruzioni di Adam/.test(server));
} catch (e) {
  check('la prova si esegue', false, e.stack);
} finally {
  cartelle.forEach(function (d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} });
}

console.log('\n' + '='.repeat(50));
console.log('PERTINENZA: ' + pass + ' passati, ' + fail + ' falliti');
process.exit(fail ? 1 : 0);
