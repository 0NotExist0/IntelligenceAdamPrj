// Prova il cestino: mettere da parte la versione di prima di un file e rimetterla com'era.
// Regola da non rompere mai: un ripristino non deve distruggere quello che c'e' adesso.
const fs = require('fs');
const os = require('os');
const path = require('path');
const camb = require('../strumenti/cambiamenti');
const rip = require('../strumenti/ripristina');

let pass = 0;
let fail = 0;
function check(nome, condizione, dettaglio) {
  if (condizione) { pass++; console.log('  ok   ' + nome); }
  else { fail++; console.log('  FAIL ' + nome + (dettaglio !== undefined ? '  -> ' + dettaglio : '')); }
}

function righe(n, testo) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(testo + ' riga ' + i + ';');
  return out.join('\n');
}

const prima = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-prima-'));
const progetto = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-progetto-'));
const cestino = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-cestino-'));
try {
  const scrivi = function (radice, rel, testo) {
    const f = path.join(radice, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, testo);
  };
  const leggi = function (radice, rel) { return fs.readFileSync(path.join(radice, rel), 'utf8'); };

  const rave = '@keyframes glitch { from { opacity: 1; } }\n' + righe(40, '.rave');
  const zip = righe(10, '.vecchio');
  scrivi(prima, 'curriculum/style.css', rave);
  scrivi(progetto, 'curriculum/style.css', zip);
  scrivi(prima, 'curriculum/app.js', 'function mostra() { return 1; }');   // cancellato nel progetto
  scrivi(prima, 'curriculum/index.html', righe(30, '<p>'));
  scrivi(progetto, 'curriculum/index.html', righe(30, '<p>') + '\n<p>aggiunta</p>');

  console.log('\n=== Il cestino si riempie da solo ===');
  const confronto = camb.confronta(prima, progetto);
  const messe = rip.mettiDalConfronto(progetto, confronto, { base: cestino });
  const nomi = messe.map(function (v) { return v.rel; });
  check('salva la versione di prima dei file cambiati', nomi.indexOf('curriculum/style.css') !== -1, nomi.join(', '));
  check('salva anche i file cancellati', nomi.indexOf('curriculum/app.js') !== -1, nomi.join(', '));
  check('salva anche i file solo modificati', nomi.indexOf('curriculum/index.html') !== -1, nomi.join(', '));
  check('registra il motivo', (messe.find(function (v) { return v.rel === 'curriculum/style.css'; }) || {}).perche === 'sostituito');
  check('registra quante righe aveva', (messe.find(function (v) { return v.rel === 'curriculum/style.css'; }) || {}).righe === 41);
  const ancora = rip.mettiDalConfronto(progetto, confronto, { base: cestino });
  check('lo stesso file salvato due volte non fa due copie',
    rip.elenco(progetto, { base: cestino }).length === messe.length, rip.elenco(progetto, { base: cestino }).length);
  check('ma restituisce comunque la copia gia\' salvata', ancora.length === messe.length);

  console.log('\n=== Elenco ===');
  const testo = rip.testoElenco(progetto, { base: cestino });
  check('l\'elenco mostra file, data e righe', /curriculum\/style\.css \(41 righe\)/.test(testo), testo);
  check('si puo\' filtrare per file', rip.elenco(progetto, { base: cestino, file: 'style.css' }).length === 1);
  check('un progetto senza cestino non inventa niente', rip.testoElenco(prima, { base: cestino }) === '');

  console.log('\n=== Ripristino ===');
  const esito = rip.ripristinaFile(progetto, 'curriculum/style.css', { base: cestino });
  check('rimette il file com\'era', esito.ok === true && leggi(progetto, 'curriculum/style.css') === rave, JSON.stringify(esito));
  check('dice quante righe ha rimesso', esito.righe === 41, esito.righe);
  check('mette da parte anche la versione di adesso', !!esito.salvataggioPrecedente &&
    esito.salvataggioPrecedente.perche === 'prima del ripristino');
  const indietro = rip.ripristinaFile(progetto, 'curriculum/style.css', { base: cestino, id: esito.salvataggioPrecedente.id });
  check('si puo\' tornare indietro dal ripristino', indietro.ok === true && leggi(progetto, 'curriculum/style.css') === zip);
  const risorto = rip.ripristinaFile(progetto, 'curriculum/app.js', { base: cestino });
  check('rimette anche un file cancellato', risorto.ok === true &&
    fs.existsSync(path.join(progetto, 'curriculum/app.js')), JSON.stringify(risorto));
  check('un file mai salvato non si ripristina', rip.ripristinaFile(progetto, 'mai-visto.js', { base: cestino }).ok === false);

  console.log('\n=== Potatura ===');
  const tanti = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-tanti-'));
  const cestino2 = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-cestino2-'));
  scrivi(tanti, 'unico.css', 'body { color: red; }');
  rip.metti(tanti, 'unico.css', path.join(tanti, 'unico.css'), { base: cestino2, perche: 'primo' });
  for (let i = 0; i < 20; i++) {
    scrivi(tanti, 'ripetuto.js', 'let x = ' + i + ';');
    rip.metti(tanti, 'ripetuto.js', path.join(tanti, 'ripetuto.js'), { base: cestino2 });
  }
  const rimaste = rip.leggiIndice(tanti, cestino2);
  const quanteRipetuto = rimaste.filter(function (v) { return v.rel === 'ripetuto.js'; }).length;
  check('dello stesso file restano poche versioni', quanteRipetuto <= 6, quanteRipetuto);
  check('e sono le ultime', fs.readFileSync(path.join(rip.cartella(tanti, cestino2), 'versioni',
    rimaste[rimaste.length - 1].copia), 'utf8') === 'let x = 19;');
  check('l\'unica copia di un altro file non si butta',
    rimaste.some(function (v) { return v.rel === 'unico.css'; }), JSON.stringify(rimaste.map(function (v) { return v.rel; })));
  check('le copie buttate spariscono anche da disco',
    fs.readdirSync(path.join(rip.cartella(tanti, cestino2), 'versioni')).length === rimaste.length);

  // Quando il cestino e' pieno davvero, si buttano le piu' vecchie.
  const cestino3 = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-cestino3-'));
  for (let i = 0; i < 10; i++) {
    scrivi(tanti, 'file' + i + '.js', 'let y = ' + i + ';');
    rip.metti(tanti, 'file' + i + '.js', path.join(tanti, 'file' + i + '.js'), { base: cestino3, limiti: { versioni: 4 } });
  }
  const poche = rip.leggiIndice(tanti, cestino3);
  check('con il cestino pieno restano le piu\' recenti', poche.length === 4 &&
    poche[poche.length - 1].rel === 'file9.js', JSON.stringify(poche.map(function (v) { return v.rel; })));
  fs.rmSync(cestino3, { recursive: true, force: true });
  fs.rmSync(tanti, { recursive: true, force: true });
  fs.rmSync(cestino2, { recursive: true, force: true });
} catch (e) {
  check('la prova si esegue', false, e.stack);
} finally {
  fs.rmSync(prima, { recursive: true, force: true });
  fs.rmSync(progetto, { recursive: true, force: true });
  fs.rmSync(cestino, { recursive: true, force: true });
}

console.log('\n' + '='.repeat(50));
console.log('RIPRISTINA: ' + pass + ' passati, ' + fail + ' falliti');
process.exit(fail ? 1 : 0);
