// "Adam non riesce a vedere la console del browser" (utente, 17/9/2026). Della pagina
// aperta nell'Anteprima le righe finivano solo nel pannello dello Studio: Adam poteva
// solo chiedere all'utente di aprire gli strumenti di sviluppo e di copiargliele.
// Qui si prova la strada intera: il ponte iniettato nella pagina spedisce davvero (in un
// Chrome vero), lo Studio tiene le righe raggruppate e ne fa un testo per Adam.
//
// Il codice non e' copiato: viene estratto da server.js, cosi' se qualcuno lo sposta o lo
// riscrive la prova se ne accorge.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const runtime = require('../analisi-runtime');

let puppeteer = null;
try { puppeteer = require('puppeteer-core'); } catch (e) { puppeteer = null; }

let pass = 0;
let fail = 0;
function check(nome, condizione, dettaglio) {
  if (condizione) { pass++; console.log('  ok   ' + nome); }
  else { fail++; console.log('  FAIL ' + nome + (dettaglio !== undefined ? '  -> ' + dettaglio : '')); }
}

const sorgente = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

// ---------------------------------------------------------------- estrazione da server.js
function ritaglia(da, a, cosa) {
  const inizio = sorgente.indexOf(da);
  const fine = sorgente.indexOf(a, inizio + 1);
  if (inizio === -1 || fine === -1) throw new Error('in server.js non trovo piu\' ' + cosa + ': aggiorna questa prova');
  return sorgente.slice(inizio, fine);
}

const bloccoMemoria = ritaglia('const MAX_CONSOLE_UTENTE', '// Elenco delle pagine apribili in anteprima.', 'la memoria della console');
const rotte = {};
const appFinto = {
  post: function (percorso, gestore) { rotte['POST ' + percorso] = gestore; },
  get: function (percorso, gestore) { rotte['GET ' + percorso] = gestore; }
};
const api = new Function('app', bloccoMemoria +
  '\nreturn { consoleUtente, aggiungiConsoleUtente, testoConsoleUtente, azzeraConsoleUtente };')(appFinto);

// Nel sorgente la chiusura e' scritta <\/script> (dentro un testo fra apici inversi non
// puo' stare altrimenti): qui serve quella vera, se no la pagina non chiude mai lo script.
const ponte = ritaglia('const PONTE_ANTEPRIMA = `', '`;', 'il ponte dell\'Anteprima')
  .replace('const PONTE_ANTEPRIMA = `', '')
  .split('<\\/script>').join('</script>');

function chiama(rotta, corpo) {
  const risposta = { dati: null };
  rotte[rotta]({ body: corpo }, { json: function (d) { risposta.dati = d; } });
  return risposta.dati;
}

// ---------------------------------------------------------------- 1. la memoria
console.log('\n=== Lo Studio tiene la console dell\'utente ===');
check('le rotte esistono', !!rotte['POST /api/console-anteprima'] && !!rotte['GET /api/console-anteprima'],
  Object.keys(rotte).join(', '));

chiama('POST /api/console-anteprima', {
  sessione: 's1', pagina: '/preview/gioco.html',
  voci: [
    { tipo: 'log', testo: 'avvio del gioco' },
    { tipo: 'error', testo: 'LIVELLI non definito, punteggio 10' },
    { tipo: 'error', testo: 'LIVELLI non definito, punteggio 40' },
    { tipo: 'warn', testo: 'texture mancante' }
  ]
});
let stato = chiama('GET /api/console-anteprima', {});
check('tre messaggi tenuti: i due errori uguali contano come uno', stato.voci.length === 3,
  JSON.stringify(stato.voci.map(function (v) { return v.tipo + ':' + v.testo; })));
const erroreUnito = stato.voci.find(function (v) { return v.tipo === 'errore'; });
check('l\'errore ripetuto porta il conteggio', erroreUnito && erroreUnito.volte === 2, erroreUnito && erroreUnito.volte);
check('warn diventa avviso', stato.voci.some(function (v) { return v.tipo === 'avviso'; }),
  JSON.stringify(stato.voci.map(function (v) { return v.tipo; })));
check('ricorda quale pagina era aperta', stato.pagina === '/preview/gioco.html', stato.pagina);

const perAdam = api.testoConsoleUtente(false);
check('il testo per Adam mette gli errori per primi',
  perAdam.indexOf('[errore]') !== -1 && perAdam.indexOf('[errore]') < perAdam.indexOf('[log]'), perAdam);
check('il testo per Adam dice che e\' la pagina dell\'utente',
  /CONSOLE DELLA PAGINA CHE L'UTENTE HA APERTO/.test(perAdam), perAdam.split('\n')[0]);
check('con soloProblemi il racconto normale sparisce',
  api.testoConsoleUtente(true).indexOf('[log]') === -1, api.testoConsoleUtente(true));

// Ricaricare la pagina e' una sessione nuova: quello di prima non c'entra piu'.
chiama('POST /api/console-anteprima', { sessione: 's2', pagina: '/preview/gioco.html', voci: [{ tipo: 'log', testo: 'riparto' }] });
stato = chiama('GET /api/console-anteprima', {});
check('ricaricando la pagina la console riparte pulita', stato.voci.length === 1 && stato.voci[0].testo === 'riparto',
  JSON.stringify(stato.voci));

// Un gioco puo' stampare senza fermarsi: si tiene un tetto, e si dice quanto si e' buttato.
// Messaggi davvero diversi: se cambiassero solo i numeri sarebbero lo stesso messaggio
// ripetuto, che e' proprio cio' che il raggruppamento deve unire.
const tante = [];
for (let i = 0; i < 80; i++) {
  tante.push({ tipo: 'log', testo: 'carico la stanza ' + String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + Math.floor(i / 26)) });
}
chiama('POST /api/console-anteprima', { sessione: 's3', pagina: '/p', voci: tante });
stato = chiama('GET /api/console-anteprima', {});
check('non si tengono piu\' di 40 messaggi diversi', stato.voci.length === 40, stato.voci.length);
check('dice quanti ne ha buttati', stato.scartate > 0, stato.scartate);
check('senza messaggi il testo per Adam e\' vuoto',
  (function () { api.azzeraConsoleUtente('s4', '/p'); return api.testoConsoleUtente(false) === ''; })());

// ---------------------------------------------------------------- 2. il ponte, in Chrome
const cartelle = [];
function fine() {
  cartelle.forEach(function (d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} });
  console.log('\n' + '='.repeat(50));
  console.log('CONSOLE ANTEPRIMA: ' + pass + ' passati, ' + fail + ' falliti');
  process.exit(fail ? 1 : 0);
}

(async function () {
  console.log('\n=== Il ponte spedisce davvero, da un Chrome vero ===');
  if (!puppeteer || !runtime.trovaBrowser || !runtime.trovaBrowser()) {
    console.log('  (browser non disponibile: prova saltata)');
    return fine();
  }

  const ricevuti = [];
  const pagina = '<!doctype html><html><head><title>prova</title></head><body><h1>ciao</h1>' +
    '<script>console.log("avvio"); console.warn("attenzione"); try { null.x; } catch (e) { console.error("preso: " + e.message); }<\/script>' +
    '</body></html>';

  // Un server che fa le due parti dello Studio: serve la pagina con il ponte dentro e
  // riceve quello che il ponte spedisce.
  const server = http.createServer(function (req, res) {
    if (req.method === 'POST' && req.url === '/api/console-anteprima') {
      let corpo = '';
      req.on('data', function (p) { corpo += p; });
      req.on('end', function () {
        try { ricevuti.push(JSON.parse(corpo)); } catch (e) { ricevuti.push({ errore: e.message, grezzo: corpo }); }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(pagina.replace('<head>', '<head>' + ponte));
  });
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  const porta = server.address().port;

  const profilo = path.join(os.tmpdir(), 'prova-ponte-' + process.pid + '-' + Date.now());
  cartelle.push(profilo);
  let browser = null;
  try {
    browser = await puppeteer.launch({
      executablePath: runtime.trovaBrowser(),
      headless: true,
      args: ['--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage',
        '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + profilo]
    });
    const p = await browser.newPage();
    await p.goto('http://127.0.0.1:' + porta + '/', { waitUntil: 'load', timeout: 20000 });
    // Il ponte spedisce a gruppi ogni 700 ms.
    await new Promise(function (r) { setTimeout(r, 1800); });

    const voci = ricevuti.reduce(function (tutte, r) { return tutte.concat(r.voci || []); }, []);
    check('lo Studio ha ricevuto qualcosa dalla pagina', ricevuti.length > 0, JSON.stringify(ricevuti).slice(0, 200));
    check('c\'e\' il console.log', voci.some(function (v) { return /avvio/.test(v.testo); }), JSON.stringify(voci));
    check('c\'e\' il console.warn', voci.some(function (v) { return v.tipo === 'warn' && /attenzione/.test(v.testo); }), JSON.stringify(voci));
    check('c\'e\' il console.error preso dal try/catch',
      voci.some(function (v) { return v.tipo === 'error' && /preso:/.test(v.testo); }), JSON.stringify(voci));
    check('dice quale pagina era aperta', ricevuti[0] && ricevuti[0].pagina === '/', ricevuti[0] && ricevuti[0].pagina);
    check('il saluto dello Studio resta nel pannello e non finisce nel contesto di Adam',
      !voci.some(function (v) { return /Anteprima collegata/.test(v.testo); }), JSON.stringify(voci));
    check('ogni invio porta la sessione della pagina', ricevuti.every(function (r) { return !!r.sessione; }));

    // Le righe ricevute passano per la memoria dello Studio come farebbero davvero.
    api.azzeraConsoleUtente('', '');
    ricevuti.forEach(function (r) { chiama('POST /api/console-anteprima', r); });
    const testo = api.testoConsoleUtente(false);
    check('e diventano un testo che Adam puo\' leggere', /\[errore\] preso:/.test(testo), testo);

    // Il pannello dell'utente non deve perdere niente: il ponte parla ancora con lui.
    check('il ponte continua a parlare anche al pannello dell\'utente',
      ponte.indexOf('__anteprima: true') !== -1);
  } catch (e) {
    check('la prova in Chrome si completa', false, e.message);
  } finally {
    try { if (browser) await browser.close(); } catch (e) {}
    try { server.close(); } catch (e) {}
  }
  fine();
})();
