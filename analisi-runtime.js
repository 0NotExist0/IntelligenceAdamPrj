// NotExist Intelligience Studio - Analisi a RUNTIME.
//
// L'analisi statica (analisi-progetto.js) trova riferimenti rotti, ma non vede i bug
// di comportamento. Caso reale: un gioco con sintassi valida, tutti gli id presenti e
// tutti i riferimenti corretti, ma il canvas copriva il pulsante di avvio - quindi
// inavviabile. Nessun controllo testuale poteva accorgersene: serviva una pagina
// davvero renderizzata.
//
// Questo modulo apre la pagina in Edge headless, raccoglie gli errori di console,
// verifica che gli elementi interattivi ricevano davvero i clic, e cattura uno
// screenshot che viene poi mostrato ad Adam (qwen3.5 ha capacita' vision).

const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');

let puppeteer = null;
try {
  puppeteer = require('puppeteer-core');
} catch (e) {
  puppeteer = null;
}

const PERCORSI_EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];

// Cerca prima il Chrome dedicato scaricato da puppeteer: su questa macchina Edge
// esce con codice 0 sotto puppeteer (probabile restrizione di policy), quindi Edge
// resta solo come ripiego.
function trovaChromeScaricato() {
  try {
    const base = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome');
    if (!fs.existsSync(base)) return null;
    const versioni = fs.readdirSync(base).sort().reverse();
    for (const v of versioni) {
      const candidato = path.join(base, v, 'chrome-win64', 'chrome.exe');
      if (fs.existsSync(candidato)) return candidato;
      const candidatoNix = path.join(base, v, 'chrome-linux64', 'chrome');
      if (fs.existsSync(candidatoNix)) return candidatoNix;
    }
  } catch (e) {}
  return null;
}

function trovaBrowser() {
  const scaricato = trovaChromeScaricato();
  if (scaricato) return scaricato;
  for (const p of PERCORSI_EDGE) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function disponibile() {
  return !!puppeteer && !!trovaBrowser();
}

// Serve la cartella su una porta effimera: i file aperti con file:// hanno
// restrizioni che falserebbero l'analisi (moduli, fetch, CORS).
function avviaServerTemporaneo(radice) {
  const tipi = {
    '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css',
    '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
  };
  return new Promise(function (resolve, reject) {
    const server = http.createServer(function (req, res) {
      let rel = decodeURIComponent(String(req.url).split('?')[0]);
      if (rel === '/') rel = '/index.html';
      const file = path.join(radice, rel);
      // Non uscire dalla cartella servita.
      if (!path.resolve(file).startsWith(path.resolve(radice))) {
        res.writeHead(403); return res.end('403');
      }
      fs.readFile(file, function (err, dati) {
        if (err) { res.writeHead(404); return res.end('404'); }
        res.writeHead(200, { 'content-type': tipi[path.extname(file).toLowerCase()] || 'application/octet-stream' });
        res.end(dati);
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', function () {
      resolve({ server: server, porta: server.address().port });
    });
  });
}

// Elementi interattivi che NON ricevono il clic perche' qualcosa li copre.
// E' il controllo che avrebbe trovato il bug del canvas sul pulsante.
const SCRIPT_ELEMENTI_COPERTI = `(() => {
  const selettori = 'button, a[href], input, select, textarea, [onclick], [role="button"]';
  const problemi = [];
  document.querySelectorAll(selettori).forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const stile = getComputedStyle(el);
    if (stile.display === 'none' || stile.visibility === 'hidden' || stile.opacity === '0') return;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return;
    const sopra = document.elementFromPoint(cx, cy);
    if (!sopra) return;
    if (sopra === el || el.contains(sopra) || sopra.contains(el)) return;
    problemi.push({
      elemento: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
                (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/)[0] : ''),
      testo: (el.textContent || '').trim().slice(0, 40),
      coperto_da: sopra.tagName.toLowerCase() + (sopra.id ? '#' + sopra.id : '')
    });
  });
  return problemi;
})()`;

async function analizzaPagina(radice, paginaRelativa, opzioni) {
  const opts = opzioni || {};
  if (!disponibile()) {
    return {
      disponibile: false,
      errore: !puppeteer
        ? 'puppeteer-core non installato (npm install puppeteer-core)'
        : 'Microsoft Edge non trovato: serve un browser per l\'analisi a runtime.'
    };
  }

  // La stessa identica URL che vede l'utente nell'Anteprima. Avere due sorgenti
  // diverse (un server temporaneo qui, /preview la') significherebbe controllare una
  // pagina e mostrarne un'altra: divergendo anche di poco, la verifica di Adam non
  // descriverebbe piu' cio' che l'utente ha davanti.
  let server = null;
  let porta = null;
  let url;

  if (opts.baseUrl) {
    url = opts.baseUrl.replace(/\/+$/, '') + '/' +
      String(paginaRelativa).replace(/^[\\/]+/, '');
  } else {
    const temporaneo = await avviaServerTemporaneo(radice);
    server = temporaneo.server;
    porta = temporaneo.porta;
    url = 'http://127.0.0.1:' + porta + '/' + String(paginaRelativa).replace(/^[\\/]+/, '');
  }

  const origineDaRipulire = opts.baseUrl
    ? opts.baseUrl.replace(/\/+$/, '')
    : 'http://127.0.0.1:' + porta;

  let browser = null;
  const erroriConsole = [];
  const erroriPagina = [];
  const risorseFallite = [];

  try {
    // Profilo separato obbligatorio: l'utente ha gia' Edge aperto con lo Studio, e
    // senza --user-data-dir la nuova istanza si aggancia a quella esistente ed esce
    // subito, facendo fallire l'avvio con un messaggio poco chiaro.
    // Profilo UNIVOCO per ogni avvio: due analisi ravvicinate, o un tentativo
    // precedente rimasto appeso, bloccherebbero la cartella condivisa.
    const profilo = path.join(os.tmpdir(),
      'studio-edge-' + process.pid + '-' + Date.now());
    browser = await puppeteer.launch({
      executablePath: trovaBrowser(),
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-gpu',
        '--enable-unsafe-swiftshader',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--user-data-dir=' + profilo,
        '--window-size=1280,800'
      ]
    });
    const pagina = await browser.newPage();
    // Le dimensioni contano: un bug di sovrapposizione puo' esistere solo sotto una
    // certa larghezza. Verificato sul campo con un canvas che copriva un pulsante
    // solo a finestra stretta.
    const vp = opts.viewport || { width: 1280, height: 800 };
    await pagina.setViewport({ width: vp.width, height: vp.height });

    // La favicon la chiede il browser da solo: se manca produce un 404 che non e' un
    // difetto del progetto. Segnalarlo a ogni analisi sarebbe solo rumore.
    const daIgnorare = function (testo) {
      return /favicon\.ico/i.test(testo);
    };

    // Un 404 NON fa scattare 'requestfailed' (la richiesta riesce, e' la risposta a
    // essere 404) e il messaggio di console e' generico, senza URL. L'unico modo per
    // sapere QUALE risorsa manca e' guardare le risposte.
    pagina.on('response', function (risposta) {
      const stato = risposta.status();
      if (stato < 400) return;
      const url = risposta.url();
      if (daIgnorare(url)) return;
      risorseFallite.push(url.replace(origineDaRipulire, '') + ' (HTTP ' + stato + ')');
    });

    pagina.on('console', function (msg) {
      if (msg.type() !== 'error') return;
      const testo = msg.text().slice(0, 300);
      if (daIgnorare(testo)) return;
      // Il 404 generico e' gia' riportato, con l'URL, dal gestore delle risposte:
      // ripeterlo senza dettagli sarebbe solo rumore.
      if (/Failed to load resource/i.test(testo)) return;
      erroriConsole.push(testo);
    });
    pagina.on('pageerror', function (err) {
      erroriPagina.push(String(err.message).slice(0, 300));
    });
    pagina.on('requestfailed', function (req) {
      if (/favicon\.ico/i.test(req.url())) return;
      risorseFallite.push(req.url().replace(origineDaRipulire, '') +
        ' (' + (req.failure() ? req.failure().errorText : 'errore') + ')');
    });

    await pagina.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });
    await new Promise(function (r) { setTimeout(r, opts.attesaMs || 1500); });

    const coperti = await pagina.evaluate(SCRIPT_ELEMENTI_COPERTI);

    const cartellaScatti = path.join(os.tmpdir(), 'studio-screenshot');
    if (!fs.existsSync(cartellaScatti)) fs.mkdirSync(cartellaScatti, { recursive: true });
    const scatto = path.join(cartellaScatti,
      'pagina-' + Date.now() + '-' + path.basename(paginaRelativa).replace(/\W+/g, '_') + '.png');
    await pagina.screenshot({ path: scatto, fullPage: false });

    const titolo = await pagina.title();

    await browser.close();
    browser = null;
    if (server) server.close();
    try { fs.rmSync(profilo, { recursive: true, force: true }); } catch (e) {}

    const problemi = [];
    erroriPagina.forEach(function (e) {
      problemi.push({ tipo: 'runtime', messaggio: 'Errore JavaScript in pagina: ' + e });
    });
    erroriConsole.forEach(function (e) {
      problemi.push({ tipo: 'console', messaggio: 'Errore in console: ' + e });
    });
    // Una risorsa mancante genera spesso due eventi (404 della risposta e abort
    // della richiesta): all'utente interessa il file, non quante volte e' fallito.
    const risorseViste = new Set();
    risorseFallite.forEach(function (r) {
      const percorso = r.split(' (')[0];
      if (risorseViste.has(percorso)) return;
      risorseViste.add(percorso);
      problemi.push({ tipo: 'risorsa', messaggio: 'Risorsa non caricata: ' + r });
    });
    coperti.forEach(function (c) {
      problemi.push({
        tipo: 'interazione',
        messaggio: 'L\'elemento ' + c.elemento + (c.testo ? ' ("' + c.testo + '")' : '') +
          ' non riceve i clic: e\' coperto da ' + c.coperto_da +
          '. Chi usa la pagina non riesce a cliccarlo.'
      });
    });

    return {
      disponibile: true,
      pagina: paginaRelativa,
      titolo: titolo,
      screenshot: scatto,
      problemi: problemi
    };
  } catch (err) {
    try { if (browser) await browser.close(); } catch (e) {}
    try { if (server) server.close(); } catch (e) {}
    try { fs.rmSync(path.join(os.tmpdir(), 'studio-edge-' + process.pid + '-*'), { recursive: true, force: true }); } catch (e) {}
    return { disponibile: true, pagina: paginaRelativa, errore: err.message, problemi: [] };
  }
}

// Analizza tutte le pagine HTML di primo livello del progetto.
async function analizzaRuntime(radice, opzioni) {
  if (!disponibile()) {
    return {
      disponibile: false,
      errore: !puppeteer
        ? 'puppeteer-core non installato'
        : 'Microsoft Edge non trovato',
      pagine: []
    };
  }

  let voci = [];
  try {
    voci = fs.readdirSync(radice, { withFileTypes: true })
      .filter(function (v) { return v.isFile() && /\.html?$/i.test(v.name); })
      .map(function (v) { return v.name; });
  } catch (e) {
    voci = [];
  }

  // index.html per primo se c'e': e' la pagina d'ingresso.
  voci.sort(function (a, b) {
    if (/^index\.html?$/i.test(a)) return -1;
    if (/^index\.html?$/i.test(b)) return 1;
    return a.localeCompare(b);
  });

  // Piu' dimensioni di finestra: verificato sul campo che un elemento coperto puo'
  // esserlo solo sotto una certa larghezza. Provarne una sola darebbe falsi "tutto ok".
  const DIMENSIONI = (opzioni && opzioni.viewports) || [
    { width: 1280, height: 800, nome: 'desktop' },
    { width: 800, height: 600, nome: 'finestra stretta' },
    { width: 420, height: 780, nome: 'telefono' }
  ];

  // Se viene indicata una pagina precisa (quella aperta nell'Anteprima) si controlla
  // solo quella: e' il caso d'uso "dimmi cosa non va in CIO' CHE STO GUARDANDO".
  if (opzioni && opzioni.pagina) {
    voci = voci.filter(function (v) { return v === opzioni.pagina; });
    if (voci.length === 0) voci = [opzioni.pagina];
  }

  const pagine = [];
  for (const nome of voci.slice(0, 5)) {
    let principale = null;
    const copertiPerDimensione = [];

    for (const vp of DIMENSIONI) {
      const esito = await analizzaPagina(radice, nome,
        Object.assign({}, opzioni, { viewport: vp }));
      if (!principale) principale = esito;   // la prima e' quella con lo screenshot
      (esito.problemi || []).forEach(function (x) {
        if (x.tipo !== 'interazione') return;
        copertiPerDimensione.push({
          tipo: 'interazione',
          messaggio: x.messaggio + ' (a ' + vp.width + 'x' + vp.height + ', ' + vp.nome + ')'
        });
      });
    }

    if (principale) {
      // I problemi di interazione trovati a QUALSIASI dimensione, senza duplicati.
      principale.problemi = (principale.problemi || []).filter(function (x) {
        return x.tipo !== 'interazione';
      });
      // Se lo stesso elemento e' coperto a OGNI dimensione, il problema e' strutturale
      // e va detto una volta sola. Se lo e' solo ad alcune, allora la dimensione e'
      // l'informazione utile e va conservata.
      const perElemento = {};
      copertiPerDimensione.forEach(function (x) {
        const chiave = x.messaggio.split(' (a ')[0];
        (perElemento[chiave] = perElemento[chiave] || []).push(x.messaggio);
      });
      Object.keys(perElemento).forEach(function (chiave) {
        const occorrenze = perElemento[chiave];
        if (occorrenze.length >= DIMENSIONI.length) {
          principale.problemi.push({ tipo: 'interazione', messaggio: chiave + ' (a tutte le dimensioni provate)' });
        } else {
          occorrenze.forEach(function (m) {
            principale.problemi.push({ tipo: 'interazione', messaggio: m });
          });
        }
      });
      pagine.push(principale);
    }
  }
  return { disponibile: true, pagine: pagine };
}

module.exports = { analizzaRuntime, analizzaPagina, disponibile, trovaBrowser, avviaServerTemporaneo };
