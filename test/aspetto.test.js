// Prova l'aspetto della pagina: una pagina che perde il CSS non da' nessun errore, quindi
// l'unico modo di accorgersene e' confrontarla con com'era l'ultima volta. Caso vero del
// 17/9/2026: curriculum senza stile, e lo Studio che rispondeva "Nessun difetto misurato".
// La seconda parte apre un browser vero: sonda una pagina con stile, poi la stessa pagina
// dopo che il CSS e' stato svuotato.
const fs = require('fs');
const os = require('os');
const path = require('path');
const aspetto = require('../strumenti/aspetto');
const misure = require('../strumenti/confronto-misure');
const { sondaPagina } = require('../strumenti/sonda');

let pass = 0;
let fail = 0;
function check(nome, condizione, dettaglio) {
  if (condizione) { pass++; console.log('  ok   ' + nome); }
  else { fail++; console.log('  FAIL ' + nome + (dettaglio !== undefined ? '  -> ' + dettaglio : '')); }
}

const ricco = { regole: 412, fogli: 2, esterni: 2, sfondo: 'rgb(10, 10, 10)', colore: 'rgb(57, 255, 20)', elementi: 120 };
const spoglio = { regole: 12, fogli: 1, esterni: 1, sfondo: 'rgb(255, 255, 255)', colore: 'rgb(0, 0, 0)', elementi: 120 };

const dati = fs.mkdtempSync(path.join(os.tmpdir(), 'aspetto-dati-'));
const progetto = fs.mkdtempSync(path.join(os.tmpdir(), 'aspetto-progetto-'));

function unitari() {
  console.log('\n=== Confronto ===');
  const crollo = aspetto.confronta(ricco, spoglio);
  check('vede il crollo delle regole di stile', crollo.regressione === true, JSON.stringify(crollo));
  check('dice i numeri veri', /da 412 a 12/.test(crollo.nota), crollo.nota);
  check('dice anche com\'e\' cambiato lo sfondo', /rgb\(10, 10, 10\).*rgb\(255, 255, 255\)/.test(crollo.nota), crollo.nota);
  check('indica dove guardare', /cambiamenti\.js/.test(crollo.nota) && /ripristina\.js/.test(crollo.nota));
  check('lascia aperta la possibilita\' che sia voluto', /ti ha chiesto l'utente/.test(crollo.nota), crollo.nota);

  console.log('\n=== Prudenza: quando NON e\' una regressione ===');
  check('stile invariato: niente', aspetto.confronta(ricco, ricco).regressione === false);
  check('stile cresciuto: niente', aspetto.confronta(spoglio, ricco).regressione === false);
  check('calo piccolo: niente', aspetto.confronta(ricco, Object.assign({}, ricco, { regole: 380 })).regressione === false);
  check('calo a meta\': niente (soglia alta apposta)',
    aspetto.confronta(ricco, Object.assign({}, ricco, { regole: 210 })).regressione === false);
  const paginetta = { regole: 20, fogli: 1, esterni: 1, sfondo: 'rgb(255, 255, 255)', colore: 'rgb(0, 0, 0)', elementi: 10 };
  check('pagina con pochissime regole: non si giudica',
    aspetto.confronta(paginetta, Object.assign({}, paginetta, { regole: 1 })).regressione === false);
  check('senza misura di prima: niente', aspetto.confronta(null, spoglio).regressione === false);
  const foglioPerso = Object.assign({}, ricco, { fogli: 1, esterni: 1, regole: 300 });
  check('un foglio di stile in meno basta', aspetto.confronta(ricco, foglioPerso).regressione === true);

  console.log('\n=== Memoria delle misure ===');
  aspetto.salva(progetto, 'curriculum/index.html', ricco, dati);
  check('salva per pagina', !!aspetto.ultima(progetto, 'curriculum/index.html', dati));
  check('la pagina si riconosce anche con le barre rovesciate',
    !!aspetto.ultima(progetto, 'curriculum\\index.html', dati));
  check('un\'altra pagina non c\'entra', aspetto.ultima(progetto, 'altra.html', dati) === null);
  const esito = aspetto.registra(progetto, 'curriculum/index.html', spoglio, { base: dati });
  check('registra confronta con l\'ultima e avvisa', esito.regressione === true, JSON.stringify(esito.motivi));
  const esito2 = aspetto.registra(progetto, 'curriculum/index.html', spoglio, { base: dati });
  check('due misure uguali di fila non avvisano piu\'', esito2.regressione === false);
  aspetto.registra(progetto, 'p.html', ricco, { base: dati, contesto: 'studio' });
  const altroContesto = aspetto.registra(progetto, 'p.html', spoglio, { base: dati, contesto: 'statico' });
  check('misure prese in modi diversi non si confrontano fra loro', altroContesto.regressione === false,
    JSON.stringify(altroContesto.motivi));
  const stessoContesto = aspetto.registra(progetto, 'p.html', spoglio, { base: dati, contesto: 'studio' });
  check('ma nello stesso modo si', stessoContesto.regressione === true);

  console.log('\n=== Posto nella scaletta dei problemi ===');
  const nota = aspetto.confronta(ricco, spoglio).nota;
  check('e\' un fatto della categoria "aspetto"', misure.categoriaFatto(nota) === 'aspetto', misure.categoriaFatto(nota));
  check('viene prima di un canvas coperto o di un collaudo',
    misure.prioritaFatto(nota) < misure.prioritaFatto('Il clic sul pulsante "Gioca" non produce alcun effetto misurabile: x'));
  check('ma dopo un errore JavaScript, che spesso ne e\' la causa',
    misure.prioritaFatto(nota) > misure.prioritaFatto('Errore JavaScript: x is not defined'));
}

const CON_STILE = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Curriculum</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
  <h1 class="titolo">PIETRO</h1>
  <p class="riga">Sviluppatore e raver</p>
  <button id="vai">INFORMAZIONI</button>
  <div class="scheda"><span class="tag">acid</span><span class="tag">tekno</span></div>
  <script>document.getElementById('vai').addEventListener('click', function () {
    document.querySelector('.scheda').style.opacity = '0.5';
  });</script>
</body></html>`;

function cssRicco() {
  const blocchi = ['body { background: #0a0a0a; color: #39ff14; font-family: monospace; }',
    '@keyframes glitch { from { opacity: 1; } to { opacity: 0.6; } }',
    '.titolo { text-shadow: 0 0 10px #39ff14; letter-spacing: 4px; }',
    '.scheda { border: 2px solid #ff00ff; padding: 20px; }',
    '.tag { background: #ff00ff; color: #000; padding: 4px; }',
    '#vai { background: #39ff14; border: none; padding: 12px 30px; }'];
  for (let i = 0; i < 40; i++) blocchi.push('.blocco-' + i + ' { margin: ' + i + 'px; color: #39ff14; }');
  return blocchi.join('\n');
}

async function conIlBrowser() {
  console.log('\n=== Una pagina vera che perde il CSS ===');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aspetto-sonda-'));
  const baseDati = fs.mkdtempSync(path.join(os.tmpdir(), 'aspetto-sonda-dati-'));
  try {
    fs.writeFileSync(path.join(dir, 'index.html'), CON_STILE);
    fs.writeFileSync(path.join(dir, 'style.css'), cssRicco());
    const prima = await sondaPagina({ pagina: 'index.html', dir: dir, baseDati: baseDati });
    if (prima.errore) {
      console.log('  (saltata: ' + prima.errore + ')');
      return;
    }
    check('la sonda misura quanto stile e\' applicato', !!prima.aspetto && prima.aspetto.regole > 40,
      JSON.stringify(prima.aspetto));
    check('alla prima misura non grida al lupo',
      !misure.fattiDellaSonda(prima).some(function (f) { return misure.categoriaFatto(f) === 'aspetto'; }),
      JSON.stringify(prima.note));

    // Quello che e' successo davvero: il file dello stile viene coperto da un altro.
    fs.writeFileSync(path.join(dir, 'style.css'), '.container { width: 90%; }\n.navbar { color: #333; }');
    const dopo = await sondaPagina({ pagina: 'index.html', dir: dir, baseDati: baseDati });
    const fatti = misure.fattiDellaSonda(dopo);
    const suAspetto = fatti.filter(function (f) { return misure.categoriaFatto(f) === 'aspetto'; });
    check('dopo la perdita del CSS lo Studio se ne accorge', suAspetto.length === 1, JSON.stringify(dopo.note));
    check('e lo dice con i numeri', suAspetto.length === 1 && /da \d+ a \d+/.test(suAspetto[0]), suAspetto[0]);
    check('la pagina non ha errori JavaScript: senza questo controllo passerebbe per sana',
      (dopo.errori || []).length === 0, JSON.stringify(dopo.errori));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(baseDati, { recursive: true, force: true });
  }
}

(async function () {
  try {
    unitari();
    await conIlBrowser();
  } catch (e) {
    check('la prova si esegue', false, e.stack);
  } finally {
    fs.rmSync(dati, { recursive: true, force: true });
    fs.rmSync(progetto, { recursive: true, force: true });
  }
  console.log('\n' + '='.repeat(50));
  console.log('ASPETTO: ' + pass + ' passati, ' + fail + ' falliti');
  process.exit(fail ? 1 : 0);
})();
