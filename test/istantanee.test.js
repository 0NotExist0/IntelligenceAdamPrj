// Prova le istantanee del progetto: cosa si copia, cosa no, e quando si rinuncia.
const fs = require('fs');
const os = require('os');
const path = require('path');
const ist = require('../strumenti/istantanee');

let pass = 0;
let fail = 0;
function check(nome, condizione, dettaglio) {
  if (condizione) { pass++; console.log('  ok   ' + nome); }
  else { fail++; console.log('  FAIL ' + nome + (dettaglio !== undefined ? '  -> ' + dettaglio : '')); }
}

const progetto = fs.mkdtempSync(path.join(os.tmpdir(), 'prova-istantanea-'));
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'prova-copie-'));
try {
  const scrivi = function (rel, testo) {
    const f = path.join(progetto, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, testo);
  };
  scrivi('gioco.html', '<script src="js/gioco.js"></script>');
  scrivi('js/gioco.js', 'let vita = 100;');
  scrivi('img/nave.png', 'PNG');
  scrivi('node_modules/lib/index.js', 'enorme');
  scrivi('.git/HEAD', 'ref');
  scrivi('.claude_memory.json', '{}');

  console.log('\n=== Copia ===');
  const foto = ist.scatta(progetto, { base: base });
  check('fa la copia', !!foto && fs.existsSync(foto.dir), JSON.stringify(foto));
  const c = function (rel) { return fs.existsSync(path.join(foto.dir, rel)); };
  check('copia pagina, script nelle sottocartelle e immagini', c('gioco.html') && c('js/gioco.js') && c('img/nave.png'));
  check('non copia dipendenze, .git e file nascosti', !c('node_modules') && !c('.git') && !c('.claude_memory.json'));
  check('conta file e byte', foto.file === 3 && foto.byte > 0, JSON.stringify(foto));

  console.log('\n=== Prima e dopo ===');
  scrivi('js/gioco.js', 'let vita = 999;');
  check('la copia resta quella di prima', fs.readFileSync(path.join(foto.dir, 'js/gioco.js'), 'utf8') === 'let vita = 100;');
  const seconda = ist.scatta(progetto, { base: base });
  check('una nuova copia sostituisce la precedente', seconda.dir === foto.dir &&
    fs.readFileSync(path.join(seconda.dir, 'js/gioco.js'), 'utf8') === 'let vita = 999;');
  fs.unlinkSync(path.join(progetto, 'img/nave.png'));
  ist.scatta(progetto, { base: base });
  check('un file cancellato sparisce anche dalla copia', !fs.existsSync(path.join(foto.dir, 'img/nave.png')));
  check('non restano copie a meta\'', !fs.existsSync(foto.dir + '.nuova'));

  console.log('\n=== Limiti ===');
  check('troppi file: nessuna copia', ist.scatta(progetto, { base: base, maxFile: 1 }) === null);
  check('troppi byte: nessuna copia', ist.scatta(progetto, { base: base, maxByte: 5 }) === null);
  const dettaglioFile = ist.scattaConEsito(progetto, { base: base, maxFile: 1 });
  const dettaglioByte = ist.scattaConEsito(progetto, { base: base, maxByte: 5 });
  check('il limite file spiega perche\' manca la copia', !dettaglioFile.ok && dettaglioFile.motivo === 'troppi-file', JSON.stringify(dettaglioFile));
  check('il limite byte spiega perche\' manca la copia', !dettaglioByte.ok && dettaglioByte.motivo === 'troppi-byte', JSON.stringify(dettaglioByte));
  check('cartella inesistente: nessuna copia', ist.scatta(path.join(progetto, 'non-esiste'), { base: base }) === null);
  check('progetti diversi, copie diverse', ist.cartellaIstantanea('C:/a', base) !== ist.cartellaIstantanea('C:/b', base));
} catch (e) {
  check('la prova si esegue', false, e.stack);
} finally {
  fs.rmSync(progetto, { recursive: true, force: true });
  fs.rmSync(base, { recursive: true, force: true });
}

console.log('\n' + '='.repeat(50));
console.log('ISTANTANEE: ' + pass + ' passati, ' + fail + ' falliti');
process.exit(fail ? 1 : 0);
