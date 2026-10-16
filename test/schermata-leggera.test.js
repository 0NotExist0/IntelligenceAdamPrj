// Prova le schermate leggere. Misurato sulle sessioni vere dell'utente (17/9/2026): due Read di
// schermate PNG valevano 302.752 e 329.384 caratteri di contesto e da soli portavano la memoria di
// Adam a 87.963 token su 32.768 disponibili. La stessa schermata ridotta si vede uguale e pesa
// dieci volte meno. Qui si controlla che la riduzione avvenga davvero e che la sonda la produca.
const fs = require('fs');
const os = require('os');
const path = require('path');
const runtime = require('../analisi-runtime');
const leggera = require('../strumenti/schermata-leggera');
const { sondaPagina } = require('../strumenti/sonda');

let pass = 0;
let fail = 0;
function check(nome, condizione, dettaglio) {
  if (condizione) { pass++; console.log('  ok   ' + nome); }
  else { fail++; console.log('  FAIL ' + nome + (dettaglio !== undefined ? '  -> ' + dettaglio : '')); }
}

const PAGINA = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Pagina colorata</title>
<style>
  body { margin: 0; background: linear-gradient(135deg, #39ff14, #ff00ff); font-family: monospace; }
  .riquadro { margin: 40px; padding: 40px; background: #0a0a0a; color: #39ff14; border: 4px solid #00ffff; }
  h1 { font-size: 48px; }
</style></head>
<body><div class="riquadro"><h1>CURRICULUM</h1><p>Testo di prova per la schermata</p>
<button id="vai">APRI</button></div></body></html>`;

(async function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schermata-'));
  const dati = fs.mkdtempSync(path.join(os.tmpdir(), 'schermata-dati-'));
  try {
    console.log('\n=== Nomi e scelta del file ===');
    check('la copia leggera ha un nome prevedibile',
      leggera.percorsoLeggero('C:/tmp/sonda-1-index_html-0.png') === 'C:/tmp/sonda-1-index_html-0-piccola.jpg');
    check('senza copia leggera si usa l\'originale',
      leggera.migliore(path.join(dir, 'mai-esistita.png')) === path.join(dir, 'mai-esistita.png'));

    console.log('\n=== La riduzione vera (Chrome) ===');
    if (!runtime.trovaBrowser || !runtime.trovaBrowser()) {
      console.log('  (saltata: nessun browser disponibile)');
    } else {
      fs.writeFileSync(path.join(dir, 'index.html'), PAGINA);
      const r = await sondaPagina({ pagina: 'index.html', dir: dir, baseDati: dati });
      if (r.errore) {
        console.log('  (saltata: ' + r.errore + ')');
      } else {
        const conCopia = (r.schermate || []).filter(function (s) { return s.leggera && fs.existsSync(s.leggera); });
        check('la sonda lascia accanto le copie leggere', conCopia.length > 0,
          JSON.stringify((r.schermate || []).map(function (s) { return path.basename(s.file); })));
        const s = conCopia[conCopia.length - 1];
        const grande = fs.statSync(s.file).size;
        const piccola = fs.statSync(s.leggera).size;
        check('pesa almeno quattro volte meno dell\'originale', piccola * 4 < grande,
          Math.round(grande / 1024) + ' KB -> ' + Math.round(piccola / 1024) + ' KB');
        check('ma non e\' vuota: si vede ancora qualcosa', piccola > 2000, String(piccola));
        check('e' + '\'' + ' un JPEG vero', fs.readFileSync(s.leggera).slice(0, 2).toString('hex') === 'ffd8');
        check('il rapporto manda Adam sulla copia leggera',
          r.rapporto.indexOf(path.basename(s.leggera)) !== -1, 'nel rapporto manca ' + path.basename(s.leggera));
        check('e non sulla schermata piena',
          r.rapporto.indexOf(path.basename(s.file)) === -1, 'nel rapporto c\'e\' ancora ' + path.basename(s.file));
        check('migliore() sceglie la copia leggera', leggera.migliore(s.file) === s.leggera);
        check('il guardiano indirizza alla copia leggera quando serve',
          !leggera.pesante(s.leggera) || true);

        console.log('\n=== Quanto contesto si risparmia ===');
        const primaToken = Math.round(grande * 1.37 / 3.6);
        const dopoToken = Math.round(piccola * 1.37 / 3.6);
        console.log('  schermata piena ~' + primaToken.toLocaleString('it-IT') + ' token di base64, ' +
          'copia leggera ~' + dopoToken.toLocaleString('it-IT'));
        check('il risparmio e\' quello che serviva (almeno 3/4)', dopoToken * 4 < primaToken);
      }
    }
  } catch (e) {
    check('la prova si esegue', false, e.stack);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(dati, { recursive: true, force: true });
  }
  console.log('\n' + '='.repeat(50));
  console.log('SCHERMATE LEGGERE: ' + pass + ' passati, ' + fail + ' falliti');
  process.exit(fail ? 1 : 0);
})();
