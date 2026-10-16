// Prova il capo file: guida per sezioni nei file grossi.
// Richiesta dell'utente del 19/9/2026 ("serve un capo progetto per file per i progetti grossi senza retrocedere o rompere il codice").

const fs = require('fs');
const os = require('os');
const path = require('path');
const capoFile = require('../strumenti/capo-file');

let pass = 0;
let fail = 0;
function check(nome, condizione, dettaglio) {
  if (condizione) {
    pass++;
    console.log('  ok   ' + nome);
  } else {
    fail++;
    console.log('  FAIL ' + nome + (dettaglio !== undefined ? '  -> ' + dettaglio : ''));
  }
}

const dirTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'capo-file-test-'));

try {
  console.log('\n=== Rilevamento delle sezioni da commenti strutturali ===');

  const codiceTest = [
    '// Setup iniziale',
    'const canvas = document.getElementById("c");',
    'const ctx = canvas.getContext("2d");',
    '',
    '// --- Web Audio SFX ---',
    'function playJumpSound() {',
    '  return true;',
    '}',
    'function playHitSound() {',
    '  return false;',
    '}',
    '',
    '// ── FISICA E MOVIMENTO ───────────────────────────────────────',
    'const gravita = 9.8;',
    'function updatePhysics() {',
    '  return gravita;',
    '}',
    '',
    '// === Zombie AI Management ===',
    'const zombies = [];',
    'class Zombie {',
    '  constructor() { this.hp = 100; }',
    '}',
    'function spawnZombie() {',
    '  zombies.push(new Zombie());',
    '}',
    '',
    '// --- Main Loop ---',
    'function loop() {',
    '  updatePhysics();',
    '}'
  ].join('\n');

  const sezioni = capoFile.rilevaSezioni(codiceTest);

  check('trova le sezioni corrette', sezioni.length >= 4, 'trovate ' + sezioni.length);
  check('prima sezione è setup o prima dichiarazione', sezioni[0].titolo.indexOf('Setup') !== -1 || sezioni[0].titolo.indexOf('Inizializzazione') !== -1, sezioni[0].titolo);

  const sezAudio = sezioni.find(function (s) { return s.titolo.indexOf('Web Audio') !== -1; });
  check('trova sezione Audio', !!sezAudio);
  if (sezAudio) {
    check('estrae funzioni della sezione Audio', sezAudio.funzioni.indexOf('playJumpSound') !== -1 && sezAudio.funzioni.indexOf('playHitSound') !== -1, JSON.stringify(sezAudio.funzioni));
  }

  const sezZombie = sezioni.find(function (s) { return s.titolo.indexOf('Zombie') !== -1; });
  check('trova sezione Zombie con classe e funzione', !!sezZombie && sezZombie.classi.indexOf('Zombie') !== -1 && sezZombie.funzioni.indexOf('spawnZombie') !== -1);

  console.log('\n=== Estrazione di una singola sezione ===');
  const fileTest = path.join(dirTmp, 'gioco.js');
  fs.writeFileSync(fileTest, codiceTest);

  const estratta = capoFile.estraiSezione(fileTest, 2);
  check('estrazione per indice funziona', estratta.ok === true);
  check('contiene il codice con numeri di riga', estratta.testo.indexOf('playJumpSound') !== -1 && /^\s*\d+:/m.test(estratta.testo));

  const estrattaNome = capoFile.estraiSezione(fileTest, 'zombie');
  check('estrazione per ricerca nome funziona', estrattaNome.ok === true && estrattaNome.sezione.titolo.indexOf('Zombie') !== -1);

  console.log('\n=== Guarda Simbolo (prevenzione regressioni) ===');
  const infoGuarda = capoFile.guardaSimbolo(fileTest, 'updatePhysics');
  check('trova la sezione in cui è definito il simbolo', infoGuarda.indexOf('FISICA E MOVIMENTO') !== -1, infoGuarda);
  check('segnala dove compare nel main loop', infoGuarda.indexOf('Main Loop') !== -1, infoGuarda);
  check('avvisa di non toccare le altre sezioni', infoGuarda.indexOf('Non toccare le altre sezioni') !== -1, infoGuarda);

  console.log('\n=== Formattazione testo per Adam ed elenco sezioni ===');
  const testoMappa = capoFile.testoSezioni(fileTest);
  check('mappa leggibile contiene il nome del file e le sezioni', testoMappa.indexOf('gioco.js') !== -1 && testoMappa.indexOf('Web Audio') !== -1);

  console.log('\n=== Rilevamento file grossi e testo prompt ===');
  // Creiamo un file fittizio sopra la soglia
  const righeGrosse = [];
  for (let i = 0; i < 350; i++) {
    righeGrosse.push('// riga ' + i);
  }
  const fileGrosso = path.join(dirTmp, 'grosso.js');
  fs.writeFileSync(fileGrosso, righeGrosse.join('\n'));

  const grossi = capoFile.trovaFileGrossi(dirTmp, 300);
  check('trova il file che supera 300 righe', grossi.length === 1 && grossi[0].file === 'grosso.js');

  const promptAdam = capoFile.testoPerPrompt(dirTmp, { soglia: 300 });
  check('genera istruzioni mirate nel prompt di Adam', promptAdam.indexOf('CAPO FILE') !== -1 && promptAdam.indexOf('grosso.js') !== -1 && promptAdam.indexOf('--sezioni') !== -1);

  console.log('\n=== Compatibilità con codice Python ===');
  const codicePy = [
    '# Setup',
    'import sys',
    '',
    '# --- Terrain Generation ---',
    'def generate_terrain():',
    '    pass',
    '',
    '# --- Game Physics ---',
    'def apply_gravity():',
    '    pass'
  ].join('\n');
  const sezioniPy = capoFile.rilevaSezioni(codicePy);
  check('rileva sezioni in commenti Python (# --- Titolo ---)', sezioniPy.some(function (s) { return s.titolo === 'Terrain Generation'; }));

} finally {
  try {
    fs.rmSync(dirTmp, { recursive: true, force: true });
  } catch (e) {}
}

console.log('\n----------------------------------------');
console.log('Esito test: ' + pass + ' passati, ' + fail + ' falliti.');
process.exit(fail ? 1 : 0);
