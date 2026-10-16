// Prova la copia di uno scheletro in una cartella che ha gia' dei file dell'utente.
// Visto dal vivo (18/9/2026): "--usa fps-3d-web" in Gioco-Shooter rispondeva "sposta quei file,
// oppure --sostituisci se vanno buttati". Adam non ha voluto buttare il gioco dell'utente, si e'
// fermato e ha cominciato a chiedere; all'utente sembrava che si rifiutasse di fare il lavoro grosso.
// Adesso lo scheletro va accanto, in una sottocartella, e i file dell'utente restano come sono.
// Veloce: non avvia i server (quelli li prova scheletri.test.js).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const scheletri = require('../strumenti/scheletri');

let pass = 0;
let fail = 0;
function check(nome, condizione, dettaglio) {
  if (condizione) { pass++; console.log('  ok   ' + nome); }
  else { fail++; console.log('  FAIL ' + nome + (dettaglio !== undefined ? '  -> ' + dettaglio : '')); }
}

const progetto = fs.mkdtempSync(path.join(os.tmpdir(), 'scheletro-accanto-'));
const comando = path.join(__dirname, '..', 'strumenti', 'scheletri.js');
try {
  fs.writeFileSync(path.join(progetto, 'index.html'), '<html>il gioco 2D dell\'utente</html>');
  fs.writeFileSync(path.join(progetto, 'server.js'), '// server dell\'utente');

  console.log('\n=== La funzione non sovrascrive e propone la strada sicura ===');
  const occupata = scheletri.copia('fps-3d-web', progetto);
  check('non copia sopra i file dell\'utente', occupata.ok === false && occupata.esistenti.indexOf('index.html') !== -1);
  check('propone per prima la sottocartella', /Copialo accanto, in una sottocartella/.test(occupata.errore) &&
    occupata.errore.indexOf('--dir') < occupata.errore.indexOf('--sostituisci'), occupata.errore);
  check('la sottocartella proposta e\' libera', !fs.existsSync(occupata.sottocartella), occupata.sottocartella);

  console.log('\n=== Da riga di comando (come la usa Adam) ===');
  const uscita = execFileSync(process.execPath, [comando, '--usa', 'fps-3d-web'], { cwd: progetto, encoding: 'utf8' });
  check('copia lo scheletro accanto invece di fermarsi', /NON li ho toccati/.test(uscita) &&
    fs.existsSync(path.join(progetto, 'fps-3d-web', 'gioco.js')), uscita.slice(0, 200));
  check('i file dell\'utente sono rimasti com\'erano',
    fs.readFileSync(path.join(progetto, 'index.html'), 'utf8') === '<html>il gioco 2D dell\'utente</html>' &&
    fs.readFileSync(path.join(progetto, 'server.js'), 'utf8') === '// server dell\'utente');
  execFileSync(process.execPath, [comando, '--usa', 'fps-3d-web'], { cwd: progetto, encoding: 'utf8' });
  check('una seconda volta va in una cartella nuova, non sopra la prima', fs.existsSync(path.join(progetto, 'fps-3d-web-2', 'gioco.js')));
  let fermata = '';
  try {
    execFileSync(process.execPath, [comando, '--usa', 'fps-3d-web', '--dir', progetto], { encoding: 'utf8' });
  } catch (e) { fermata = String(e.stdout || ''); }
  check('se Adam sceglie lui una cartella occupata, si ferma e spiega', /Copialo accanto/.test(fermata), fermata.slice(0, 160));
} catch (e) {
  check('la prova si esegue', false, e.stack);
} finally {
  fs.rmSync(progetto, { recursive: true, force: true });
}

console.log('\n' + '='.repeat(50));
console.log('SCHELETRI ACCANTO: ' + pass + ' passati, ' + fail + ' falliti');
process.exit(fail ? 1 : 0);
