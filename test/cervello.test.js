// Prova il cervello del progetto su progetti finti costruiti al volo: gli errori che un
// modello piccolo fa davvero (visti su "gioco": ui.startBtn mai creato, funzioni scritte
// due volte) e i casi che NON devono dare allarmi (nomi del browser, typeof, librerie
// esterne, codice mandato dentro Chrome con puppeteer). Un falso allarme e' grave quanto
// un errore mancato: Adam "correggerebbe" codice giusto.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cervello = require('../strumenti/cervello');

let pass = 0;
let fail = 0;
function check(nome, condizione, dettaglio) {
  if (condizione) { pass++; console.log('  ok   ' + nome); }
  else { fail++; console.log('  FAIL ' + nome + (dettaglio !== undefined ? '  -> ' + dettaglio : '')); }
}

const cartelle = [];
function progetto(file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prova-cervello-'));
  cartelle.push(dir);
  Object.keys(file).forEach(function (nome) {
    const completo = path.join(dir, nome);
    fs.mkdirSync(path.dirname(completo), { recursive: true });
    fs.writeFileSync(completo, file[nome]);
  });
  return dir;
}
function problemi(dir) { return cervello.analizzaProgettoCervello(dir).problemi; }
function trova(lista, testo) { return lista.find(function (p) { return p.messaggio.indexOf(testo) !== -1; }); }
function elenco(lista) {
  return lista.map(function (p) { return (p.grave ? 'GRAVE ' : '') + p.file + ':' + p.riga + ' ' + p.messaggio; }).join(' | ') || '(nessuno)';
}

console.log('\n=== Il caso vero di "gioco": chiave mai creata e funzione scritta due volte ===');
let lista = problemi(progetto({
  'index.html': '<!doctype html><html><body>\n<button id="btn-start">Via</button>\n<button id="btn-restart">Ancora</button>\n' +
    '<canvas id="scena"></canvas>\n<script src="js/main.js"></script>\n</body></html>',
  'js/main.js': [
    'const ui = {',
    "  restartBtn: document.getElementById('btn-restart')",
    '};',
    "ui.startBtn.addEventListener('click', startGame);",
    "ui.restartBtn.addEventListener('click', startGame);",
    'function startGame() { initGame(); requestAnimationFrame(ciclo); }',
    'function initGame() { scena.width = 800; }',
    'function ciclo() { requestAnimationFrame(ciclo); }',
    'function initGame() { scena.width = 1024; }'
  ].join('\n')
}));
const chiave = trova(lista, 'ui.startBtn non esiste');
check('ui.startBtn segnalato come GRAVE in js/main.js:4', chiave && chiave.grave && chiave.file === 'js/main.js' && chiave.riga === 4, elenco(lista));
check('suggerisce ui.restartBtn', chiave && chiave.messaggio.indexOf('restartBtn') !== -1);
const doppia = trova(lista, 'initGame() e\' definita 2 volte');
check('funzione doppia: da controllare, alla riga 9', doppia && !doppia.grave && doppia.riga === 9, elenco(lista));
check('un id usato come variabile (scena) non e\' un errore', !trova(lista, 'scena'), elenco(lista));
check('requestAnimationFrame non e\' un errore', !trova(lista, 'requestAnimationFrame'), elenco(lista));
check('nessun altro problema', lista.length === 2, elenco(lista));

console.log('\n=== Nome scritto male, script diversi della stessa pagina, attributi onclick ===');
lista = problemi(progetto({
  'index.html': '<script src="a.js"></script>\n<script src="b.js"></script>\n<button onclick="avvia()">x</button>\n<button onclick="ferma()">y</button>',
  'a.js': 'function spawnZombies(n) { return n; }\nfunction avvia() { spawnZombie(3); }\nvar punteggio = 0;',
  'b.js': 'function aggiorna() { punteggio++; spawnZombies(1); }\nif (typeof nonCaricato !== "undefined") nonCaricato();'
}));
const typo = trova(lista, 'chiami spawnZombie()');
check('spawnZombie() segnalato GRAVE in a.js:2', typo && typo.grave && typo.file === 'a.js' && typo.riga === 2, elenco(lista));
check('suggerisce spawnZombies con file e riga', typo && typo.messaggio.indexOf('"spawnZombies" (a.js:1)') !== -1, typo && typo.messaggio);
check('nomi di a.js usati da b.js: nessun errore', !trova(lista, 'punteggio') && !trova(lista, 'b.js'), elenco(lista));
const gestore = trova(lista, 'onclick usa "ferma"');
check('onclick="ferma()" inesistente: GRAVE in index.html:4', gestore && gestore.grave && gestore.file === 'index.html' && gestore.riga === 4, elenco(lista));
check('onclick="avvia()" esistente: nessun errore', !trova(lista, '"avvia"'), elenco(lista));
check('typeof protegge i nomi che possono mancare', !trova(lista, 'nonCaricato'), elenco(lista));

console.log('\n=== Stessa variabile dichiarata in due script della pagina ===');
lista = problemi(progetto({
  'index.html': '<script src="uno.js"></script><script src="due.js"></script>',
  'uno.js': 'let giocatore = { x: 0 };\nconsole.log(giocatore.x);',
  'due.js': '\nconst giocatore = null;'
}));
const dop = trova(lista, 'has already been declared');
check('let in uno.js + const in due.js: GRAVE in due.js:2', dop && dop.grave && dop.file === 'due.js' && dop.riga === 2, elenco(lista));

console.log('\n=== Librerie esterne: niente falsi allarmi ===');
lista = problemi(progetto({
  'index.html': '<script src="https://cdn.jsdelivr.net/npm/three/build/three.min.js"></script>\n<script src="scena.js"></script>',
  'scena.js': 'const renderer = new THREE.WebGLRenderer();\nconst camera = new THREE.PerspectiveCamera();\nrenderer.render(scene, camera);'
}));
check('THREE preso da una CDN non e\' segnalato', !trova(lista, 'THREE'), elenco(lista));
const scene = trova(lista, '"scene"');
check('un nome minuscolo isolato resta, ma solo da controllare', scene && !scene.grave, elenco(lista));

console.log('\n=== Programmi Node e codice mandato dentro Chrome ===');
lista = problemi(progetto({
  'server.js': "const http = require('http');\nconst util = require('./util');\n" +
    "http.createServer(function (q, r) { r.end(util.saluta()); }).listen(3000);\nmodule.exports = { avvia: avvia };",
  'util.js': "function saluta() { return 'ciao'; }\nmodule.exports = { saluta: saluta };",
  'sonda.js': "const puppeteer = require('puppeteer-core');\nasync function prova() {\n" +
    '  return this.page.evaluate(function () { return document.title + window.innerWidth; });\n}\nmodule.exports = prova;'
}));
const avv = trova(lista, 'usi "avvia"');
check('server.js: avvia non esiste = GRAVE', avv && avv.grave && avv.file === 'server.js', elenco(lista));
check('require, module e http non sono errori', !trova(lista, '"require"') && !trova(lista, '"module"') && !trova(lista, '"http"'), elenco(lista));
check('document dentro this.page.evaluate non e\' un errore', !trova(lista, 'document') && !trova(lista, 'window'), elenco(lista));

console.log('\n=== Moduli: import di un nome che il file non esporta ===');
lista = problemi(progetto({
  'index.html': '<script type="module" src="main.js"></script>',
  'main.js': "import { creaNemico, velocita } from './nemici.js';\ncreaNemico(velocita);",
  'nemici.js': 'export function creaNemici() {}\nexport const velocita = 3;'
}));
const imp = trova(lista, 'importa "creaNemico"');
check('import di creaNemico (esiste creaNemici): GRAVE alla riga 1', imp && imp.grave && imp.riga === 1 && imp.messaggio.indexOf('creaNemici') !== -1, elenco(lista));
check('velocita esportata: nessun errore', !trova(lista, 'velocita'), elenco(lista));

console.log('\n=== Id mancanti, file inesistenti, file mai caricati ===');
lista = problemi(progetto({
  'index.html': '<link rel="stylesheet" href="css/stile.css">\n<div id="punteggio"></div>\n<script src="js/gioco.js"></script>',
  'css/style.css': '#punteggio { color: red; }',
  'js/gioco.js': "document.getElementById('puntegio').textContent = '0';\ndocument.getElementById('punteggio').textContent = '0';",
  'js/extra.js': "document.body.style.background = 'black';"
}));
const idm = trova(lista, 'id "puntegio"');
check('id "puntegio" scritto male: GRAVE alla riga 1 con suggerimento "punteggio"', idm && idm.grave && idm.riga === 1 && idm.messaggio.indexOf('"punteggio"') !== -1, elenco(lista));
check('id "punteggio" presente: nessun errore', !trova(lista, 'id "punteggio"'), elenco(lista));
const ris = trova(lista, 'carica "css/stile.css"');
check('css/stile.css inesistente: GRAVE in index.html:1', ris && ris.grave && ris.file === 'index.html' && ris.riga === 1, elenco(lista));
const mai = trova(lista, 'nessuna pagina HTML carica questo file');
check('js/extra.js mai caricato: da controllare', mai && !mai.grave && mai.file === 'js/extra.js', elenco(lista));
const css = trova(lista, 'nessuna pagina HTML collega');
check('css/style.css non collegato: da controllare', css && !css.grave && css.file === 'css/style.css', elenco(lista));

console.log('\n=== Valori chiamati come funzioni, classi senza new ===');
lista = problemi(progetto({
  'index.html': '<script src="a.js"></script>',
  'a.js': 'const VELOCITA = 5;\nclass Nemico {}\nVELOCITA();\nconst n = Nemico();\nconst m = new Nemico();'
}));
const nf = trova(lista, 'chiami VELOCITA()');
check('VELOCITA() non e\' una funzione: GRAVE alla riga 3', nf && nf.grave && nf.riga === 3, elenco(lista));
const cl = trova(lista, 'va creata con new Nemico');
check('Nemico() senza new: GRAVE alla riga 4 (non alla 5)', cl && cl.grave && cl.riga === 4, elenco(lista));

console.log('\n=== eval e variabili globali create senza dichiarazione ===');
lista = problemi(progetto({
  'index.html': '<script src="a.js"></script><script src="b.js"></script>',
  'a.js': "punti = 10;\neval('function nascosta() {}');\nnascosta();",
  'b.js': 'console.log(punti);'
}));
check('punti = 10 crea una globale usabile in b.js', !trova(lista, 'punti'), elenco(lista));
check('file con eval: niente allarmi sui nomi', !trova(lista, 'nascosta'), elenco(lista));

console.log('\n=== Errori di sintassi, anche dentro l\'HTML ===');
lista = problemi(progetto({
  'index.html': '<html>\n<body>\n<script>\nlet a = 1;\nlet b = ;\n</script>\n</body></html>',
  'app.js': 'const x = ;'
}));
const sintassi = lista.filter(function (p) { return p.messaggio.indexOf('errore di sintassi') !== -1; });
check('script dentro l\'HTML: errore alla riga giusta (5)', sintassi.some(function (p) { return p.file === 'index.html' && p.riga === 5 && p.grave; }), elenco(lista));
check('app.js: errore alla riga 1', sintassi.some(function (p) { return p.file === 'app.js' && p.riga === 1 && p.grave; }), elenco(lista));

console.log('\n=== Server che fornisce file da altre cartelle (come lo Studio) ===');
lista = problemi(progetto({
  'server.js': "const express = require('express');\nconst app = express();\napp.use('/vendor', express.static('node_modules'));",
  'public/index.html': '<script src="/vendor/lib/lib.js"></script>\n<script src="/app.js"></script>',
  'public/app.js': 'const t = new Terminal();\nlet summ = 1;\nconsole.log(sum);'
}));
check('/vendor fornito dal server: nessun "file inesistente"', !trova(lista, '/vendor/lib/lib.js'), elenco(lista));
check('/app.js trovato nella cartella dell\'HTML', !trova(lista, 'nessuna pagina HTML carica'), elenco(lista));
check('Terminal (nome da libreria) non segnalato', !trova(lista, 'Terminal'), elenco(lista));
const sum = trova(lista, '"sum"');
check('sum (esiste summ): da controllare, con suggerimento', sum && !sum.grave && sum.messaggio.indexOf('"summ"') !== -1, elenco(lista));

console.log('\n=== Le domande di Adam ===');
const comandi = require('../strumenti/cervello-comandi');
const baseDati = fs.mkdtempSync(path.join(os.tmpdir(), 'prova-cervello-dati-'));
cartelle.push(baseDati);
const pg = progetto({
  'index.html': '<button id="btn-start">Via</button>\n<script src="main.js"></script>',
  'main.js': "const ui = { start: document.getElementById('btn-start') };\n" +
    'function spara(danno, bersaglio = null) { return danno; }\n' +
    "ui.start.addEventListener('click', function () { spara(5); });"
});
const an = cervello.analizzaProgettoCervello(pg);
let r = comandi.cerca(an, 'spara');
check('--cerca: la firma con i parametri', r.indexOf('main.js:2  funzione spara(danno, bersaglio = null)') !== -1, r);
check('--cerca: dove e\' usato, con la riga', r.indexOf('main.js:3') !== -1, r);
r = comandi.cerca(an, 'ui.stop');
check('--cerca oggetto.chiave inesistente: NON ESISTE, con le chiavi vere', r.indexOf('ui.stop NON ESISTE') !== -1 && r.indexOf('Chiavi di ui: start') !== -1, r);
r = comandi.cerca(an, 'sparaa');
check('--cerca nome inesistente: suggerisce quello vero', r.indexOf('non esiste nessun nome "sparaa"') !== -1 && r.indexOf('spara') !== -1, r);
r = comandi.cerca(an, '#btn-start');
check('--cerca #id: nell\'HTML e nel codice', r.indexOf('index.html:1') !== -1 && r.indexOf('main.js:1') !== -1, r);
r = comandi.scheda(an, 'main.js');
check('--file: funzioni, variabili e id cercati', r.indexOf('spara(danno') !== -1 && r.indexOf('const ui') !== -1 && r.indexOf('#btn-start') !== -1, r);
check('--controlla su un progetto pulito', comandi.controlla(an).indexOf('Nessun problema') === 0, comandi.controlla(an));

console.log('\n=== Il controllo dopo ogni modifica e la memoria degli errori ===');
const input = { cwd: pg, tool_name: 'Edit', tool_input: { file_path: path.join(pg, 'main.js') } };
check('hook su un progetto pulito: silenzio', comandi.perHook(input, { base: baseDati }).testo === '');
// Adam rinomina spara in colpisci ma lascia la vecchia chiamata: l'errore piu' tipico.
fs.writeFileSync(path.join(pg, 'main.js'), "const ui = { start: document.getElementById('btn-start') };\n" +
  'function colpisci(danno) { return danno; }\n' + "ui.start.addEventListener('click', function () { spara(5); });");
let h = comandi.perHook(input, { base: baseDati });
check('hook dopo l\'errore: codice 2, GRAVE con file e riga', h.codice === 2 && h.testo.indexOf('GRAVE main.js:3') !== -1 && h.testo.indexOf('spara') !== -1, h.testo);
const graviTurno = comandi.erroriGraviPerVerifica(pg, [path.join(pg, 'main.js')]);
check('verifica di fine turno: lo stesso errore, con il percorso completo', graviTurno.length === 1 && graviTurno[0].percorso === path.join(pg, 'main.js'), JSON.stringify(graviTurno));
fs.writeFileSync(path.join(pg, 'main.js'), "const ui = { start: document.getElementById('btn-start') };\n" +
  'function colpisci(danno) { return danno; }\n' + "ui.start.addEventListener('click', function () { colpisci(5); });");
h = comandi.perHook(input, { base: baseDati });
check('hook dopo la correzione: silenzio', h.codice === 0 && h.testo === '', h.testo);
check('verifica di fine turno dopo la correzione: niente', comandi.erroriGraviPerVerifica(pg, [path.join(pg, 'main.js')]).length === 0);
const storia = comandi.testoErrori(pg, baseDati);
check('--errori ricorda l\'errore fatto e corretto', storia.indexOf('corretti') !== -1 && storia.indexOf('spara') !== -1, storia);
const prompt = comandi.testoPerPrompt(pg, { base: baseDati });
check('prompt: comandi, panoramica ed errori gia\' fatti', prompt.indexOf('--cerca nome') !== -1 && prompt.indexOf('colpisci') !== -1 &&
  prompt.indexOf('non ripeterli') !== -1, prompt);
check('prompt compatto (sotto i 3000 caratteri)', prompt.length < 3000, prompt.length);
check('prompt senza hook: chiede di controllare a mano', comandi.testoPerPrompt(pg, { base: baseDati, dopoOgniModifica: false }).indexOf('controlla tu il progetto') !== -1);
const fuori = comandi.perHook({ cwd: pg, tool_input: { file_path: path.join(os.tmpdir(), 'altro.js') } }, { base: baseDati });
check('hook su un file fuori dal progetto: silenzio', fuori.codice === 0 && fuori.testo === '');
check('hook su un file non di codice: silenzio', comandi.perHook({ cwd: pg, tool_input: { file_path: path.join(pg, 'note.md') } }, { base: baseDati }).testo === '');

cartelle.forEach(function (d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} });
console.log('\n' + '='.repeat(50));
console.log('CERVELLO: ' + pass + ' passati, ' + fail + ' falliti');
process.exit(fail ? 1 : 0);
