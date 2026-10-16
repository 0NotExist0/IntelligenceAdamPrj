// NotExist Intelligience Studio - Sonda di comportamento.
//
// Nasce da un caso reale. L'utente segnala "i nemici sono velocissimi e la navicella
// e' sparita". Adam legge i file, ipotizza, abbassa le velocita' e dichiara risolto
// senza mai eseguire il gioco. Le cause vere si vedevano solo eseguendolo:
//   - un livello dell'interfaccia copriva tutto il canvas: il mouse non arrivava mai,
//     la navicella restava a y = 0, disegnata sopra il bordo dello schermo;
//   - il ciclo di animazione non si fermava mai e ogni "Riprova" ne aggiungeva un
//     altro: 144 callback al secondo al primo avvio, 286 al secondo.
// La differenza fra indovinare e sapere e' eseguire, agire come una persona e
// misurare nel tempo. Questa sonda fa esattamente questo, e Adam la puo' usare da
// solo con Bash, come io uso il mio browser.
//
// Uso:
//   node sonda.js <pagina.html> [--osserva "espr1;espr2"] [--passi "scrivi #campo | pane; tasto Enter; osserva dopo"]
//                 [--passi-file passi.json] [--dir <cartella>] [--base <url>]
//                 [--larghezza 1280 --altezza 800] [--json]
//
// Senza --passi esegue un'esplorazione standard: carica, controlla chi riceve il
// mouse sopra i canvas, preme il pulsante principale con un clic VERO, muove mouse e
// tasti, osserva lo stato a +1s e +3s, e se il pulsante riappare lo preme di nuovo
// per vedere se il riavvio si comporta come il primo avvio.

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

let puppeteer = null;
try {
  puppeteer = require('puppeteer-core');
} catch (e) {
  puppeteer = null;
}

const runtime = require('../analisi-runtime');
const misure = require('./confronto-misure');
const aspettoPagina = require('./aspetto');
const schermataLeggera = require('./schermata-leggera');
const { leggiPasso } = require('./collaudatore');

const BASE_PREDEFINITA = 'http://127.0.0.1:' + (process.env.PORT || 3456) + '/preview';
const attesa = (ms) => new Promise((r) => setTimeout(r, ms));

// Iniettata PRIMA degli script della pagina. Conta le callback di animazione della
// pagina (non le nostre) e raccoglie gli errori con file e riga.
const STRUMENTAZIONE = `(() => {
  const s = window.__sonda = { raf: 0, perNome: {}, errori: [] };
  const originale = window.requestAnimationFrame.bind(window);
  s.rafOriginale = originale;
  window.requestAnimationFrame = function (cb) {
    const nome = (cb && cb.name) || 'anonima';
    return originale(function (t) {
      s.raf++;
      s.perNome[nome] = (s.perNome[nome] || 0) + 1;
      return cb(t);
    });
  };
  window.addEventListener('error', function (e) {
    var dove = e.filename ? ' [' + String(e.filename).split('/').pop().split('?')[0] + ':' + e.lineno + ']' : '';
    s.errori.push((e.message || 'errore') + dove);
  });
  window.addEventListener('unhandledrejection', function (e) {
    s.errori.push('Promise non gestita: ' + (e.reason && e.reason.message ? e.reason.message : e.reason));
  });
  // Con che cosa la pagina disegna e si collega davvero: un FPS in prima persona usa WebGL e
  // il blocco del mouse, un multiplayer apre una connessione. Cosi' non lo si deduce dal codice.
  s.tecnologia = { contesti: [], pointerLock: 0, connessioni: [] };
  try {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (tipo) {
      if (s.tecnologia.contesti.indexOf(String(tipo)) === -1) s.tecnologia.contesti.push(String(tipo));
      return getContext.apply(this, arguments);
    };
    const blocca = Element.prototype.requestPointerLock;
    if (blocca) {
      Element.prototype.requestPointerLock = function () {
        s.tecnologia.pointerLock++;
        return blocca.apply(this, arguments);
      };
    }
    // Proxy e non una funzione al posto del costruttore: cosi' WebSocket.OPEN, il prototype e
    // instanceof continuano a funzionare come prima.
    ['WebSocket', 'RTCPeerConnection', 'EventSource'].forEach(function (nome) {
      const costruttore = window[nome];
      if (typeof costruttore !== 'function' || typeof Proxy !== 'function') return;
      window[nome] = new Proxy(costruttore, {
        construct: function (bersaglio, argomenti) {
          s.tecnologia.connessioni.push(nome + ' ' + String(argomenti[0] || '').slice(0, 120));
          return Reflect.construct(bersaglio, argomenti);
        }
      });
    });
  } catch (e) { /* la strumentazione non deve mai rompere la pagina */ }
})();`;

// ------------------------------------------------ funzioni eseguite nella pagina

// Valuta un'espressione nello scope globale (dove vivono anche i let/const di primo
// livello degli script) e ne restituisce un riassunto leggibile e compatto.
function riassumiNellaPagina(espressione) {
  function riassumi(v, prof) {
    if (v === null || v === undefined) return String(v);
    const t = typeof v;
    if (t === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10);
    if (t === 'boolean') return String(v);
    if (t === 'string') return JSON.stringify(v.length > 60 ? v.slice(0, 57) + '...' : v);
    if (t === 'function') return 'funzione ' + (v.name || '');
    if (typeof Node !== 'undefined' && v instanceof Node) {
      if (v.nodeType !== 1) return 'nodo';
      const r = v.getBoundingClientRect();
      const interno = v.tagName === 'CANVAS' ? ' interno ' + v.width + 'x' + v.height : '';
      return '<' + v.tagName.toLowerCase() + (v.id ? '#' + v.id : '') + ' ' +
        Math.round(r.width) + 'x' + Math.round(r.height) + interno + '>';
    }
    if (Array.isArray(v)) {
      if (prof > 0 || v.length === 0) return 'Array(' + v.length + ')';
      return 'Array(' + v.length + ') primo: ' + riassumi(v[0], 1);
    }
    if (t === 'object') {
      if (prof > 1) return '{...}';
      const nome = v.constructor && v.constructor.name;
      if (nome && /RenderingContext|Context2D|WebGL/.test(nome)) return nome;
      const parti = [];
      Object.keys(v).slice(0, 10).forEach(function (k) {
        const x = v[k];
        const tx = typeof x;
        if (tx === 'number' || tx === 'boolean' || tx === 'string') parti.push(k + ':' + riassumi(x, prof + 1));
        else if (Array.isArray(x)) parti.push(k + ':Array(' + x.length + ')');
      });
      return '{' + parti.join(', ') + '}';
    }
    return String(v);
  }
  try {
    return { ok: true, valore: riassumi((0, eval)(espressione), 0) };
  } catch (e) {
    return { ok: false, valore: 'errore: ' + e.message };
  }
}

// Il pulsante piu' evidente e visibile: di solito l'azione che l'utente fa per prima.
function trovaAzionePrincipale() {
  const candidati = Array.from(document.querySelectorAll(
    'button, [role="button"], input[type="button"], input[type="submit"]'))
    .filter(function (el) {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return !el.disabled && r.width > 4 && r.height > 4 && s.display !== 'none' &&
        s.visibility !== 'hidden' && s.opacity !== '0';
    })
    .map(function (el) {
      const r = el.getBoundingClientRect();
      return {
        descr: el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''),
        testo: (el.textContent || el.value || '').trim().slice(0, 40),
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        area: r.width * r.height
      };
    })
    .sort(function (a, b) { return b.area - a.area; });
  return candidati[0] || null;
}

// Per ogni canvas: in quanti punti il mouse arriva davvero al canvas, e chi lo
// intercetta negli altri. E' il controllo che avrebbe trovato il livello UI sopra il gioco.
function controllaCanvas() {
  const esiti = [];
  document.querySelectorAll('canvas').forEach(function (c) {
    const r = c.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    const punti = [[0.5, 0.5], [0.2, 0.8], [0.8, 0.8], [0.2, 0.2], [0.8, 0.2]];
    const intercettatori = {};
    const elementi = {};
    let liberi = 0;
    punti.forEach(function (p) {
      const x = r.left + r.width * p[0];
      const y = r.top + r.height * p[1];
      const e = document.elementFromPoint(x, y);
      if (!e || e === c || c.contains(e)) { liberi++; return; }
      // Un pulsante sopra il gioco (il menu iniziale, "Riprova") e' voluto: si clicca e
      // sparisce. Il difetto vero era un livello NON cliccabile che copriva tutto il canvas.
      if (e.closest && e.closest('button, a[href], input, select, textarea, [role="button"]')) { liberi++; return; }
      const nome = e.tagName.toLowerCase() + (e.id ? '#' + e.id : '');
      intercettatori[nome] = (intercettatori[nome] || 0) + 1;
      if (!elementi[nome]) elementi[nome] = e;
    });
    // Come e' fatto chi copre il canvas: e' li' la leva della correzione (di solito
    // pointer-events), non nel codice JavaScript che ascolta il mouse.
    const dettagli = {};
    Object.keys(elementi).forEach(function (nome) {
      const el = elementi[nome];
      const st = getComputedStyle(el);
      const q = el.getBoundingClientRect();
      const larga = Math.max(0, Math.min(q.right, r.right) - Math.max(q.left, r.left));
      const alta = Math.max(0, Math.min(q.bottom, r.bottom) - Math.max(q.top, r.top));
      dettagli[nome] = 'position ' + st.position + ', z-index ' + st.zIndex + ', pointer-events ' +
        st.pointerEvents + ', copre il ' + Math.round(larga * alta * 100 / (r.width * r.height)) + '% del canvas';
    });
    esiti.push({
      canvas: 'canvas' + (c.id ? '#' + c.id : ''), punti: punti.length, liberi: liberi,
      intercettatori: intercettatori, dettagli: dettagli,
      rect: { x: r.left, y: r.top, w: r.width, h: r.height }
    });
  });
  return esiti;
}

// Campi vuoti e visibili da compilare prima del clic principale, con un valore plausibile.
// Un modulo si prova compilandolo: a campi vuoti un "Aggiungi" o un "Invia" spesso,
// giustamente, non fa nulla, e sembrerebbe rotto.
function campiDaCompilare() {
  const esclusi = ['hidden', 'checkbox', 'radio', 'submit', 'button', 'reset', 'file', 'image', 'range', 'color',
    'date', 'time', 'datetime-local', 'month', 'week'];
  return Array.from(document.querySelectorAll('input, textarea')).filter(function (el) {
    const tipo = (el.getAttribute('type') || 'text').toLowerCase();
    if (esclusi.indexOf(tipo) !== -1 || el.disabled || el.readOnly || el.value) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 4 && r.height > 4 && s.display !== 'none' && s.visibility !== 'hidden';
  }).slice(0, 8).map(function (el) {
    const tipo = (el.getAttribute('type') || 'text').toLowerCase();
    const indizio = ((el.name || '') + ' ' + (el.id || '') + ' ' + (el.placeholder || '')).toLowerCase();
    let valore = 'prova';
    if (tipo === 'email' || /mail/.test(indizio)) valore = 'prova@esempio.it';
    else if (tipo === 'number' || /quant|numer|prezzo|anni|eta/.test(indizio)) valore = '3';
    else if (tipo === 'tel' || /telef|cellul/.test(indizio)) valore = '3331234567';
    else if (tipo === 'password') valore = 'Prova123!';
    else if (tipo === 'url') valore = 'https://esempio.it';
    const r = el.getBoundingClientRect();
    return {
      descr: el.tagName.toLowerCase() + (el.id ? '#' + el.id : (el.name ? '[name=' + el.name + ']' : '')),
      valore: valore,
      x: r.left + r.width / 2,
      y: r.top + r.height / 2
    };
  });
}

function chiRiceve(x, y) {
  const e = document.elementFromPoint(x, y);
  return e ? e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') : 'nulla';
}

// Elenchi di oggetti fra le variabili osservate, e un livello dentro gli oggetti (come
// player.bullets): quanti elementi hanno e quanti sono "eliminati" ma ancora li'. Un
// oggetto e' eliminato quando un campo di vita (health, hp, life, vita...) e' <= 0; se e'
// anche marcato spento (active/alive false) fa parte di una riserva riusabile, e va bene.
// Ognuno viene ricordato dal momento in cui lo si vede eliminato: se dopo 1,5 secondi e'
// ancora nell'elenco, il codice non lo toglie. Caso reale: nemici distrutti che restavano,
// continuavano a prendere colpi e a dare punti (12.200 punti in 10 secondi).
function censimentoOggetti(nomi) {
  const s = window.__sonda || (window.__sonda = {});
  if (!s.primaMorte) s.primaMorte = new WeakMap();
  const ora = performance.now();
  const VITA = /^(health|hp|life|lives|vita|vite|salute|energia|energy|hitpoints)$/i;
  const SPENTO = /^(active|alive|attivo|attiva|vivo|viva|enabled)$/i;
  const esito = { elenchi: {}, morti: [] };
  function breve(o) {
    const parti = [];
    Object.keys(o).slice(0, 8).forEach(function (k) {
      const v = o[k];
      if (typeof v === 'number') parti.push(k + ':' + (Number.isInteger(v) ? v : Math.round(v * 10) / 10));
      else if (typeof v === 'boolean') parti.push(k + ':' + v);
      else if (typeof v === 'string' && v.length < 20) parti.push(k + ':"' + v + '"');
    });
    return '{' + parti.join(', ') + '}';
  }
  function valuta(nome, arr) {
    esito.elenchi[nome] = arr.length;
    let morti = 0;
    let vecchi = 0;
    let esempio = null;
    const campi = {};
    const n = Math.min(arr.length, 3000);
    for (let i = 0; i < n; i++) {
      const e = arr[i];
      if (!e || typeof e !== 'object' || Array.isArray(e)) continue;
      let campo = '';
      let spento = false;
      const chiavi = Object.keys(e);
      for (let j = 0; j < chiavi.length; j++) {
        const v = e[chiavi[j]];
        if (typeof v === 'number' && v <= 0 && VITA.test(chiavi[j])) campo = chiavi[j];
        else if (v === false && SPENTO.test(chiavi[j])) spento = true;
      }
      if (!campo || spento) continue;
      morti++;
      campi[campo] = (campi[campo] || 0) + 1;
      if (!s.primaMorte.has(e)) s.primaMorte.set(e, ora);
      else if (ora - s.primaMorte.get(e) >= 1500) {
        vecchi++;
        if (!esempio) esempio = breve(e);
      }
    }
    if (morti) {
      const campo = Object.keys(campi).sort(function (a, b) { return campi[b] - campi[a]; })[0];
      esito.morti.push({ nome: nome, totale: arr.length, morti: morti, vecchi: vecchi, campo: campo, esempio: esempio });
    }
  }
  (nomi || []).forEach(function (nome) {
    try {
      const v = (0, eval)(nome);
      if (Array.isArray(v)) valuta(nome, v);
      else if (v && typeof v === 'object' && !(typeof Node !== 'undefined' && v instanceof Node)) {
        Object.keys(v).slice(0, 30).forEach(function (k) {
          if (Array.isArray(v[k])) valuta(nome + '.' + k, v[k]);
        });
      }
    } catch (e) {
      // variabile non leggibile: la si salta
    }
  });
  return esito;
}

// ------------------------------------------------------------- misure

async function misuraHz(p) {
  return p.evaluate(function () {
    return new Promise(function (res) {
      const s = window.__sonda;
      const raf = (s && s.rafOriginale) || window.requestAnimationFrame.bind(window);
      let n = 0;
      const t0 = performance.now();
      const giro = function () {
        n++;
        if (performance.now() - t0 < 500) raf(giro);
        else res(Math.round(n * 1000 / (performance.now() - t0)));
      };
      raf(giro);
    });
  });
}

// Callback di animazione DELLA PAGINA al secondo, misurate su un intervallo.
async function rafAlSecondo(p, ms) {
  const leggi = () => p.evaluate(function () { return window.__sonda ? window.__sonda.raf : 0; });
  const a = await leggi();
  await attesa(ms);
  const b = await leggi();
  return Math.round((b - a) * 1000 / ms);
}

// Come rafAlSecondo, ma dice anche QUALE funzione viene eseguita: "gameLoop 122/s" porta
// dritto alla riga da guardare, "122 callback" no.
async function rafConNomi(p, ms) {
  const leggi = () => p.evaluate(function () {
    const s = window.__sonda || { raf: 0, perNome: {} };
    return { raf: s.raf, perNome: Object.assign({}, s.perNome) };
  });
  const a = await leggi();
  await attesa(ms);
  const b = await leggi();
  const nomi = Object.keys(b.perNome)
    .map(function (n) { return { nome: n, alSecondo: Math.round(((b.perNome[n] || 0) - (a.perNome[n] || 0)) * 1000 / ms) }; })
    .filter(function (x) { return x.alSecondo > 0; })
    .sort(function (x, y) { return y.alSecondo - x.alSecondo; });
  return { alSecondo: Math.round((b.raf - a.raf) * 1000 / ms), nomi: nomi };
}

function chiDisegna(misura) {
  const nomi = (misura && misura.nomi) || [];
  if (!nomi.length) return '';
  return ' (le esegue ' + nomi.slice(0, 2).map(function (n) { return n.nome + ' ' + n.alSecondo + '/s'; }).join(', ') + ')';
}

// Righe dei file .js esterni eseguite davvero durante la prova. Servono a non chiamare
// "risolto" un errore la cui riga, nella prova dopo, non e' mai stata eseguita. Visto dal
// vivo: Adam ha sostituito un ReferenceError con un altro sulla stessa riga, e la riprova
// l'ha dato per risolto perche' in quella partita nessun proiettile aveva colpito un nemico.
// Gli script scritti dentro l'HTML restano fuori: le righe dei loro errori sono quelle
// del documento, non dello script, e il confronto diventerebbe sbagliato.
function lineeEseguiteDa(copertura) {
  const esito = {};
  (copertura || []).forEach(function (voce) {
    const nome = String(voce.url || '').split('?')[0].split('/').pop();
    if (!/\.m?js$/i.test(nome) || typeof voce.text !== 'string') return;
    const inizi = [0];
    for (let i = 0; i < voce.text.length; i++) if (voce.text.charCodeAt(i) === 10) inizi.push(i + 1);
    const riga = function (pos) {
      let lo = 0;
      let hi = inizi.length - 1;
      while (lo < hi) {
        const meta = (lo + hi + 1) >> 1;
        if (inizi[meta] <= pos) lo = meta; else hi = meta - 1;
      }
      return lo + 1;
    };
    esito[nome] = (voce.ranges || []).map(function (r) {
      return [riga(r.start), riga(Math.max(r.start, r.end - 1))];
    });
  });
  return esito;
}

// Valori delle variabili osservate e HTML della pagina in un istante. null se la pagina non
// e' leggibile (per esempio perche' il clic ha portato a un'altra pagina).
async function leggiStato(p, osservate) {
  try {
    const valori = {};
    for (const espressione of osservate) {
      valori[espressione] = (await p.evaluate(riassumiNellaPagina, espressione)).valore;
    }
    const html = await p.evaluate(function () { return document.body ? document.body.innerHTML : ''; });
    return { valori: valori, html: html };
  } catch (e) {
    return null;
  }
}

// Solo 200: un 404 dello Studio significa che quella pagina li' non c'e'.
function raggiungibile(url) {
  return new Promise(function (resolve) {
    const req = http.get(url, { timeout: 1500 }, function (res) {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', function () { resolve(false); });
    req.on('timeout', function () { req.destroy(); resolve(false); });
  });
}

// /preview serve la cartella di lavoro DELLO STUDIO. Se la sonda deve guardare un'altra
// cartella, /preview mostrerebbe la pagina sbagliata con lo stesso nome: prima di
// fidarsi si chiede allo Studio quale cartella sta servendo.
function studioServeLaCartella(base, dir) {
  return new Promise(function (resolve) {
    let origine;
    try { origine = new URL(base).origin; } catch (e) { return resolve(false); }
    const req = http.get(origine + '/api/status', { timeout: 1500 }, function (res) {
      let dati = '';
      res.on('data', function (c) { dati += c; });
      res.on('end', function () {
        try {
          const cwd = JSON.parse(dati).cwd;
          resolve(!!cwd && path.resolve(cwd).toLowerCase() === path.resolve(dir).toLowerCase());
        } catch (e) { resolve(false); }
      });
    });
    req.on('error', function () { resolve(false); });
    req.on('timeout', function () { req.destroy(); resolve(false); });
  });
}

// Senza indicazioni si osservano le variabili di primo livello degli script inclusi
// dalla pagina: le stesse che la Mappa del codice ha gia' raccolto per Adam.
function osservazioniPredefinite(radice, pagina) {
  const nomi = [];
  const aggiungi = function (v) { if (nomi.indexOf(v) === -1) nomi.push(v); };
  try {
    const progetto = require('../analisi-progetto');
    const mappa = progetto.mappaCodice(radice);
    const inclusi = new Set(mappa.collegamenti
      .filter(function (c) { return c.da === pagina && c.motivo === 'include'; })
      .map(function (c) { return c.a; }));
    mappa.schede.forEach(function (s) {
      if (s.tipo !== 'js' || !inclusi.has(s.nome)) return;
      s.variabili.forEach(aggiungi);
    });
    // Anche gli script scritti dentro la pagina: molte pagine semplici non hanno altro.
    const html = fs.readFileSync(path.join(radice, pagina), 'utf8');
    const re = /<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html)) !== null) progetto.simboliJs(togliRientro(m[1])).variabili.forEach(aggiungi);
  } catch (e) {
    // senza mappa si osserva solo cio' che viene chiesto con --osserva
  }
  return nomi.filter(function (n) { return !/^(ctx|context|gl)$/i.test(n); }).slice(0, 14);
}

// Il codice dentro <script> e' di solito rientrato insieme all'HTML: senza togliere il
// rientro comune le dichiarazioni di primo livello sembrerebbero annidate.
function togliRientro(codice) {
  const righe = codice.replace(/\r/g, '').split('\n');
  const rientri = righe.filter(function (r) { return r.trim(); })
    .map(function (r) { return r.match(/^[ \t]*/)[0].length; });
  const minimo = rientri.length ? Math.min.apply(null, rientri) : 0;
  return righe.map(function (r) { return r.slice(Math.min(minimo, r.match(/^[ \t]*/)[0].length)); }).join('\n');
}

// ------------------------------------------------------------- si vede qualcosa?
//
// Visto dal vivo (15/9/2026): gioco "completo" per Adam e per la riprova dello Studio (partita
// avviata, zombie che nascono, nessun errore), ma a schermo solo lo sfondo blu: niente veniva
// disegnato. Le variabili non lo dicono; i pixel della schermata si'. Si misura la quota di pixel
// dello stesso colore sulla schermata vera, piu' il testo leggibile nella pagina.

// Con fileConfronto misura anche quanti pixel cambiano fra le due schermate: un oggetto piccolo
// che si muove su uno sfondo grande e' un gioco vivo, non uno schermo vuoto.
async function coloreDominante(browser, file, fileConfronto) {
  const dati = fs.readFileSync(file).toString('base64');
  const datiConfronto = fileConfronto && fs.existsSync(fileConfronto) ? fs.readFileSync(fileConfronto).toString('base64') : null;
  const pagina = await browser.newPage();
  try {
    return await pagina.evaluate(async function (b64, b64Confronto) {
      const pixelDi = async function (sorgente) {
        const img = new Image();
        img.src = 'data:image/png;base64,' + sorgente;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, c.width, c.height).data;
      };
      const px = await pixelDi(b64);
      let cambiati = null;
      if (b64Confronto) {
        const altro = await pixelDi(b64Confronto);
        if (altro.length === px.length) {
          let diversi = 0;
          for (let i = 0; i < px.length; i += 4) {
            if (Math.abs(px[i] - altro[i]) + Math.abs(px[i + 1] - altro[i + 1]) + Math.abs(px[i + 2] - altro[i + 2]) > 30) diversi++;
          }
          cambiati = diversi / (px.length / 4);
        }
      }
      const conta = new Map();
      for (let i = 0; i < px.length; i += 4) {
        // colori quasi uguali insieme: sfumature e antialiasing non contano
        const k = (px[i] >> 3) * 1024 + (px[i + 1] >> 3) * 32 + (px[i + 2] >> 3);
        conta.set(k, (conta.get(k) || 0) + 1);
      }
      let chiave = 0;
      let massimo = 0;
      conta.forEach(function (v, k) { if (v > massimo) { massimo = v; chiave = k; } });
      const esa = function (x) { return ('0' + ((x << 3) | 4).toString(16)).slice(-2); };
      return {
        quota: massimo / (px.length / 4),
        colore: '#' + esa(chiave >> 10) + esa((chiave >> 5) & 31) + esa(chiave & 31),
        colori: conta.size,
        cambiati: cambiati
      };
    }, dati, datiConfronto);
  } finally {
    await pagina.close().catch(function () {});
  }
}

function testoVisibileNellaPagina() {
  let caratteri = 0;
  const radice = document.body || document.documentElement;
  if (!radice) return 0;
  const giro = document.createTreeWalker(radice, NodeFilter.SHOW_TEXT);
  let nodo;
  while ((nodo = giro.nextNode())) {
    const testo = nodo.textContent.trim();
    const el = nodo.parentElement;
    if (!testo || !el) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || Number(st.opacity) === 0) continue;
    const b = el.getBoundingClientRect();
    if (b.width < 1 || b.height < 1 || b.bottom <= 0 || b.right <= 0 || b.top >= innerHeight || b.left >= innerWidth) continue;
    caratteri += testo.length;
  }
  return caratteri;
}

// ------------------------------------------------------------- esplorazione

async function esplorazionePredefinita(p, ctx) {
  const { fotografaStato, scatta, note, r, hz, vp, avanza, campiona } = ctx;

  avanza('Controllo chi riceve il mouse sopra i canvas');
  const canvas = await p.evaluate(controllaCanvas);
  r.canvas = canvas;
  // Prima di premere "Gioca" e' normale che il menu stia davanti al gioco: il canvas coperto si
  // giudica DOPO il clic. Il difetto vero e' il menu che resta li' anche dopo, e il mouse non
  // arriva mai al gioco (il gioco dell'utente, 15/9/2026).
  const segnalaCanvasCoperti = function (elenco, coda) {
    (elenco || []).forEach(function (c) {
      const nomi = Object.keys(c.intercettatori);
      if (c.liberi < c.punti && nomi.length) {
        const peggiore = nomi.sort(function (a, b) { return c.intercettatori[b] - c.intercettatori[a]; })[0];
        note.push('Il mouse sopra ' + c.canvas + ' arriva a ' + peggiore + ' in ' +
          c.intercettatori[peggiore] + ' punti su ' + c.punti +
          (c.dettagli && c.dettagli[peggiore] ? ' (' + peggiore + ': ' + c.dettagli[peggiore] + ')' : '') +
          ': in quelle zone il canvas non riceve ne\' movimenti ne\' clic.' + (coda || ''));
      }
    });
  };

  const azione = await p.evaluate(trovaAzionePrincipale);
  if (!azione) {
    note.push('Nessun pulsante visibile: mi limito a osservare la pagina nel tempo.');
    segnalaCanvasCoperti(canvas);   // senza un pulsante da premere, vale quello che si vede subito
    const raf = await rafAlSecondo(p, 1500);
    await fotografaStato('+1,5s', raf);
    await scatta('+1,5s');
    return;
  }

  const campi = await p.evaluate(campiDaCompilare);
  if (campi.length) {
    avanza('Compilo ' + campi.length + (campi.length === 1 ? ' campo' : ' campi') + ' prima del clic');
    for (const c of campi) {
      try {
        await p.mouse.click(c.x, c.y);
        await p.keyboard.type(c.valore, { delay: 5 });
      } catch (e) { /* un campo che sparisce mentre si scrive non ferma la prova */ }
    }
    r.compilati = campi.map(function (c) { return c.descr + ' = "' + c.valore + '"'; });
    note.push('Ho compilato ' + campi.length + (campi.length === 1 ? ' campo' : ' campi') + ' prima del clic: ' +
      r.compilati.join(', ') + '.');
  }

  const ricevente = await p.evaluate(chiRiceve, azione.x, azione.y);
  r.azione = { descr: azione.descr, testo: azione.testo, ricevente: ricevente };
  // Come una persona: il puntatore arriva al pulsante attraversando la pagina, non
  // teletrasportato sopra. Visto dal vivo: col salto diretto il movimento non passava mai
  // sul canvas, il gioco partiva con la navicella a y=0 e la partita finiva in meno di un
  // secondo, uno stato che nessun utente vede (e che nascondeva un errore vero).
  await p.mouse.move(azione.x, azione.y, { steps: 15 });
  // Stato con il puntatore gia' sul pulsante, subito prima del clic: confrontato con lo
  // stato poco dopo misura l'effetto del clic e basta. Il confronto con il caricamento non
  // funzionava: nel frattempo la sonda stessa muove il mouse e preme tasti, e le variabili
  // del mouse cambiavano comunque (visto sul gioco che non partiva piu').
  const statoPrima = await leggiStato(p, r.osservate);
  avanza('Clic vero su "' + azione.testo + '"');
  await p.mouse.click(azione.x, azione.y);
  r.t0Clic = Date.now();
  // Il pulsante appena premuto resta selezionato: Spazio lo ripremerebbe, e le misure
  // successive conterebbero un secondo avvio che nessuno ha chiesto.
  await p.evaluate(function () {
    const a = document.activeElement;
    if (a && /^(BUTTON|INPUT|A|SELECT)$/.test(a.tagName)) a.blur();
  });
  if (ricevente !== azione.descr) {
    note.push('Il clic sul pulsante "' + azione.testo + '" e\' arrivato a ' + ricevente + ', non al pulsante.');
  }

  // Il clic ha fatto qualcosa? 800 ms senza toccare mouse e tasti: se nessuna variabile
  // osservata cambia e l'HTML e' identico, il pulsante non avvia piu' niente. Visto dal vivo:
  // dopo una "correzione" il gioco non partiva piu' e la riprova dava per risolti tutti i
  // difetti di prima, che non potevano piu' comparire.
  await attesa(800);
  const statoDopo = await leggiStato(p, r.osservate);
  if (statoPrima && statoDopo && r.osservate.length >= 2 && statoPrima.html === statoDopo.html &&
      r.osservate.every(function (k) { return statoPrima.valori[k] === statoDopo.valori[k]; })) {
    r.clicSenzaEffetto = true;
    note.push('Il clic sul pulsante "' + azione.testo + '" non produce alcun effetto misurabile: nel secondo ' +
      'dopo il clic nessuna delle variabili osservate cambia (' + r.osservate.slice(0, 5).join(', ') + ') e ' +
      'l\'HTML della pagina resta identico. L\'azione principale non avvia piu\' niente.');
  }

  // Uso realistico: mouse vero sopra l'area di gioco e qualche tasto, come una persona.
  // L'area e' il canvas piu' grande, se c'e': un mouse mosso fuori dal canvas farebbe
  // sembrare "ferme" variabili che semplicemente non hanno mai visto il mouse.
  const area = canvas.map(function (c) { return c.rect; })
    .sort(function (a, b) { return b.w * b.h - a.w * a.h; })[0] || { x: 0, y: 0, w: vp.width, h: vp.height };
  const dentro = function (fx, fy) {
    return [
      Math.max(1, Math.min(vp.width - 1, area.x + area.w * fx)),
      Math.max(1, Math.min(vp.height - 1, area.y + area.h * fy))
    ];
  };
  const da = dentro(0.3, 0.75);
  const a = dentro(0.7, 0.75);
  await p.mouse.move(da[0], da[1], { steps: 8 });
  await p.mouse.move(a[0], a[1], { steps: 8 });
  for (const tasto of ['ArrowLeft', 'ArrowRight']) {
    await p.keyboard.down(tasto);
    await attesa(150);
    await p.keyboard.up(tasto);
  }
  await p.keyboard.press('Space');

  const misura1 = await rafConNomi(p, 1000);
  const raf1 = misura1.alSecondo;
  await fotografaStato('+1s dal clic', raf1);
  await scatta('+1s dal clic');
  await campiona();

  // Adesso il gioco dovrebbe essere partito: se qualcosa copre ancora il canvas, e' un difetto.
  segnalaCanvasCoperti(await p.evaluate(controllaCanvas),
    ' Misurato dopo il clic su "' + azione.testo + '": a partita avviata il gioco deve ricevere il mouse.');

  avanza('Osservo cosa succede nei primi 3 secondi');
  await attesa(1500);
  const raf3 = await rafAlSecondo(p, 500);
  await fotografaStato('+3s dal clic', raf3);
  await scatta('+3s dal clic');
  await campiona();

  // Si vede qualcosa? Pixel veri della schermata appena scattata e testo leggibile.
  try {
    const ultima = r.schermate[r.schermate.length - 1];
    const precedente = r.schermate[r.schermate.length - 2];
    const pixel = ultima ? await coloreDominante(p.browser(), ultima.file, precedente && precedente.file) : null;
    const testo = await p.evaluate(testoVisibileNellaPagina);
    // Superfici su cui si disegna (canvas, svg, immagini, video) grandi almeno un ventesimo dello
    // schermo: una pagina che le ha puo' mostrare poco di proposito (un puntino su un canvas bianco).
    const superfici = await p.evaluate(function () {
      const area = innerWidth * innerHeight;
      let quante = 0;
      document.querySelectorAll('canvas, svg, img, video, iframe').forEach(function (el) {
        const st = getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return;
        const b = el.getBoundingClientRect();
        const w = Math.max(0, Math.min(b.right, innerWidth) - Math.max(b.left, 0));
        const h = Math.max(0, Math.min(b.bottom, innerHeight) - Math.max(b.top, 0));
        if (w * h >= area * 0.05) quante++;
      });
      return quante;
    });
    // Vuoto davvero: quasi tutto di un colore, niente testo, niente superfici di disegno e niente
    // che si muova fra +1s e +3s. Il gioco di Adam era cosi': solo div vuoti su uno sfondo.
    const fermo = !pixel || pixel.cambiati === null || pixel.cambiati < 0.0005;
    if (pixel && pixel.quota >= 0.985 && testo < 20 && superfici === 0 && fermo) {
      r.schermoVuoto = { momento: ultima.momento, quota: pixel.quota, colore: pixel.colore, testo: testo };
      note.push('Dopo il clic su "' + azione.testo + '" lo schermo resta quasi vuoto: ' + Math.floor(pixel.quota * 100) +
        '% dei pixel ha lo stesso colore (' + pixel.colore + ') e non si legge nessun testo. La pagina puo\' funzionare ' +
        'dentro (variabili che cambiano) ma chi la usa non vede niente: controlla che gli oggetti vengano davvero disegnati.');
    }
  } catch (e) {
    // la misura dello schermo non deve fermare il resto della prova
  }


  if (hz && raf1 > hz * 1.5) {
    note.push('Circa ' + Math.round(raf1 / hz) + ' cicli di animazione in parallelo: ' + raf1 +
      ' callback al secondo con il browser a ' + hz + ' fotogrammi/s' + chiDisegna(misura1) + '.');
  }

  // Il pulsante riappare (fine partita, "Riprova")? Premiamolo di nuovo: il secondo
  // avvio deve comportarsi come il primo. Quando finisce la partita dipende dal caso,
  // quindi se la pagina sta animando qualcosa si aspetta fino a 15 secondi. Visto dal
  // vivo: vita all'80% dopo 3 secondi, nessun secondo clic, e il ciclo che raddoppia a
  // ogni partita (la causa principale del difetto) non era emerso.
  let dinuovo = await p.evaluate(trovaAzionePrincipale);
  if (!dinuovo && raf1 > 0) {
    // Quanto si aspetta la fine della partita: 15 secondi quando misura lo Studio, meno quando la
    // verifica la lancia Adam (il suo strumento Bash ha un tempo massimo e non deve scadere).
    const quanto = r.attesaRiavvio || 15000;
    const secondi = Math.round(quanto / 1000);
    const limite = Date.now() + quanto;
    while (!dinuovo && Date.now() < limite) {
      await attesa(500);
      // Intanto si contano gli elenchi: e' cosi' che si vede cio' che cresce senza fine.
      await campiona();
      avanza('Aspetto la fine della partita: ' + Math.min(secondi, Math.round((quanto - (limite - Date.now())) / 1000)) + '/' + secondi + ' s');
      dinuovo = await p.evaluate(trovaAzionePrincipale);
    }
    if (!dinuovo) note.push('Il pulsante principale non e\' riapparso entro ' + secondi + ' secondi: il riavvio non e\' stato provato.');
  }
  if (dinuovo) {
    // Il ciclo gira ancora prima del secondo clic (a partita finita, se e' un gioco)?
    // E' la prova che il ciclo della partita precedente non si ferma.
    avanza('Premo di nuovo "' + dinuovo.testo + '" per provare il riavvio');
    const primaDelClic = await rafConNomi(p, 500);
    await fotografaStato('prima del secondo clic', primaDelClic.alSecondo);
    await p.mouse.move(dinuovo.x, dinuovo.y, { steps: 15 });
    await p.mouse.click(dinuovo.x, dinuovo.y);
    const misura2 = await rafConNomi(p, 1000);
    const raf2 = misura2.alSecondo;
    await fotografaStato('+1s dal secondo clic', raf2);
    await scatta('+1s dal secondo clic');
    r.secondoAvvio = { testo: dinuovo.testo, rafAlSecondo: raf2 };
    if (raf1 > 0 && raf2 > raf1 * 1.6) {
      const f = misura2.nomi[0];
      note.push('Dopo il secondo clic su "' + dinuovo.testo + '" le callback di animazione passano da ' +
        raf1 + ' a ' + raf2 + ' al secondo' +
        (f ? ': la funzione ' + f.nome + ' ora gira ' + f.alSecondo + ' volte al secondo' : '') +
        (primaDelClic.alSecondo > 0 ? ', e gia\' prima del secondo clic girava ' + primaDelClic.alSecondo +
          ' volte al secondo' : '') +
        '. Ogni riavvio aggiunge un ciclo invece di sostituirlo (il ciclo della partita precedente non si ' +
        'ferma), quindi tutto cio\' che si muove "per fotogramma" accelera a ogni partita.');
    }
  }
}

// Gli stessi passi testuali dei collaudi, piu' "osserva <nome>". Visto dal vivo: per
// verificare da solo un flusso con un campo di testo, Adam ha passato 20 minuti a leggere il
// sorgente della sonda e a scrivere script a mano, perche' qui non si poteva scrivere in un campo.
function passoDaTesto(testo, n) {
  const t = String(testo || '').trim();
  const oss = t.match(/^osserva\s*(.*)$/i);
  if (oss) return { osserva: oss[1] || ('passo ' + n) };
  const q = leggiPasso(t);
  if (!q) return { ignoto: t };
  if (q.tipo === 'clic') return { clic: q.selettore };
  if (q.tipo === 'clicxy') return { clic: [q.x, q.y] };
  if (q.tipo === 'tasto') return { tasto: q.tasto, per: q.ms };
  if (q.tipo === 'mouse') return { mouse: [q.x, q.y] };
  if (q.tipo === 'trascina') return { trascina: q };
  if (q.tipo === 'attendi') return { attendi: q.ms };
  if (q.tipo === 'js') return { esegui: q.codice };
  if (q.tipo === 'scrivi') return { scrivi: q.selettore, testo: q.testo };
  if (q.tipo === 'seleziona') return { seleziona: q.selettore, valore: q.valore };
  return { ignoto: t };
}

function puntiInputRange(selettore, percentuale) {
  let el;
  try { el = document.querySelector(selettore); } catch (e) { return { errore: 'selettore non valido' }; }
  if (!el) return { errore: 'non esiste' };
  if (String(el.tagName).toLowerCase() !== 'input' || el.type !== 'range') {
    return { errore: 'non e\' un input type="range"' };
  }
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  if (rect.width < 2 || rect.height < 2 || style.display === 'none' || style.visibility === 'hidden') {
    return { errore: 'non e\' visibile' };
  }

  const minimo = el.min === '' ? 0 : Number(el.min);
  const massimo = el.max === '' ? 100 : Number(el.max);
  if (!Number.isFinite(minimo) || !Number.isFinite(massimo) || massimo <= minimo) {
    return { errore: 'ha un intervallo non valido' };
  }
  const verticale = el.getAttribute('orient') === 'vertical' || /^vertical-/.test(style.writingMode || '');
  let dimensionePollice = 16;
  try {
    const pseudo = getComputedStyle(el, '::-webkit-slider-thumb');
    const pollice = parseFloat(verticale ? pseudo.height : pseudo.width);
    // Chromium riporta talvolta la larghezza dell'intero input per il pseudo-elemento:
    // oltre 64 px non puo' essere il pollice standard e falserebbe la posizione del valore.
    if (Number.isFinite(pollice) && pollice > 0 && pollice <= 64) dimensionePollice = pollice;
  } catch (e) { /* dimensione standard del pollice */ }

  const span = massimo - minimo;
  let posizione = Math.max(0, Math.min(1, (Number(el.value) - minimo) / span));
  let destinazione = Math.max(0, Math.min(1, Number(percentuale) / 100));
  const inverso = !verticale && style.direction === 'rtl';
  if (inverso) {
    posizione = 1 - posizione;
    destinazione = 1 - destinazione;
  }

  if (verticale) {
    const pollice = Math.min(dimensionePollice, Math.max(1, rect.height / 2));
    const corsa = Math.max(1, rect.height - pollice);
    const x = rect.left + rect.width / 2;
    return {
      origine: { x: x, y: rect.top + pollice / 2 + (1 - posizione) * corsa },
      destinazione: { x: x, y: rect.top + pollice / 2 + (1 - destinazione) * corsa }
    };
  }
  const pollice = Math.min(dimensionePollice, Math.max(1, rect.width / 2));
  const corsa = Math.max(1, rect.width - pollice);
  const y = rect.top + rect.height / 2;
  return {
    origine: { x: rect.left + pollice / 2 + posizione * corsa, y: y },
    destinazione: { x: rect.left + pollice / 2 + destinazione * corsa, y: y }
  };
}

async function coordinateTrascinamento(passo, p) {
  if (passo.destinazione.tipo === 'percentuale') {
    const punti = await p.evaluate(puntiInputRange, passo.origine.selettore, passo.destinazione.valore);
    if (punti.errore) return { errore: 'il controllo "' + passo.origine.selettore + '" ' + punti.errore };
    return Object.assign(punti, { descrizione: passo.origine.selettore + ' a ' + passo.destinazione.valore + '%' });
  }

  const risolvi = async function (punto, nome) {
    if (punto.tipo === 'coordinate') return { x: punto.x, y: punto.y };
    const posizione = await p.evaluate(centroDi, punto.selettore);
    if (posizione.errore) return { errore: nome + ' "' + punto.selettore + '" ' + posizione.errore };
    return posizione;
  };
  const origine = await risolvi(passo.origine, 'origine');
  if (origine.errore) return { errore: origine.errore };
  const destinazione = await risolvi(passo.destinazione, 'destinazione');
  if (destinazione.errore) return { errore: destinazione.errore };
  return {
    origine: origine,
    destinazione: destinazione,
    descrizione: (passo.origine.tipo === 'selettore' ? passo.origine.selettore : origine.x + ',' + origine.y) +
      ' -> ' + (passo.destinazione.tipo === 'selettore' ? passo.destinazione.selettore : destinazione.x + ',' + destinazione.y)
  };
}

async function eseguiTrascinamento(p, punti) {
  const distanza = Math.hypot(punti.destinazione.x - punti.origine.x, punti.destinazione.y - punti.origine.y);
  const passi = Math.max(8, Math.min(32, Math.ceil(distanza / 20)));
  await p.mouse.move(punti.origine.x, punti.origine.y, { steps: 8 });
  await p.mouse.down();
  try {
    await p.mouse.move(punti.destinazione.x, punti.destinazione.y, { steps: passi });
  } finally {
    await p.mouse.up();
  }
  await attesa(80);
}

async function eseguiPassi(p, passi, ctx) {
  const { fotografaStato, scatta, note } = ctx;
  let n = 0;
  for (const grezzo of passi) {
    n++;
    const passo = typeof grezzo === 'string' ? passoDaTesto(grezzo, n) : grezzo;
    if (passo.scrivi !== undefined) {
      const pos = await p.evaluate(centroDi, passo.scrivi);
      if (pos.errore) {
        note.push('Passo ' + n + ': il campo "' + passo.scrivi + '" ' + pos.errore + '.');
        continue;
      }
      await p.mouse.click(pos.x, pos.y);
      await p.evaluate(function (sel) {
        const el = document.querySelector(sel);
        if (el) { el.focus(); if (el.select) el.select(); }
      }, passo.scrivi);
      await p.keyboard.press('Backspace');
      await p.keyboard.type(String(passo.testo || ''), { delay: 8 });
      note.push('Passo ' + n + ': scritto "' + passo.testo + '" in ' + passo.scrivi);
    } else if (passo.trascina !== undefined) {
      const punti = await coordinateTrascinamento(passo.trascina, p);
      if (punti.errore) {
        note.push('Passo ' + n + ': trascinamento non eseguito: ' + punti.errore + '.');
        continue;
      }
      await eseguiTrascinamento(p, punti);
      note.push('Passo ' + n + ': trascinato ' + punti.descrizione);
    } else if (passo.seleziona !== undefined) {
      const scelti = await p.select(passo.seleziona, String(passo.valore || '')).catch(function () { return []; });
      note.push('Passo ' + n + ': ' + (scelti.length ? 'scelto "' + passo.valore + '" in ' + passo.seleziona
        : 'nel menu ' + passo.seleziona + ' non c\'e\' "' + passo.valore + '"'));
    } else if (passo.ignoto !== undefined) {
      note.push('Passo ' + n + ': non riconosciuto "' + passo.ignoto + '" (passi: clic, scrivi, seleziona, tasto, mouse, attendi, js, osserva).');
    } else if (passo.attendi !== undefined) {
      await attesa(Math.min(Number(passo.attendi) || 0, 15000));
    } else if (passo.clic !== undefined) {
      let x;
      let y;
      let descr;
      if (Array.isArray(passo.clic)) {
        x = passo.clic[0];
        y = passo.clic[1];
        descr = x + ',' + y;
      } else {
        const pos = await p.evaluate(function (sel) {
          const el = document.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }, passo.clic);
        if (!pos) { note.push('Passo ' + n + ': elemento "' + passo.clic + '" non trovato.'); continue; }
        x = pos.x;
        y = pos.y;
        descr = passo.clic;
      }
      const ricevente = await p.evaluate(chiRiceve, x, y);
      await p.mouse.move(x, y, { steps: 10 });
      await p.mouse.click(x, y);
      note.push('Passo ' + n + ': clic su ' + descr + ' -> ricevuto da ' + ricevente);
    } else if (passo.mouse) {
      await p.mouse.move(passo.mouse[0], passo.mouse[1], { steps: 6 });
    } else if (passo.tasto) {
      await p.keyboard.down(passo.tasto);
      await attesa(Number(passo.per) || 100);
      await p.keyboard.up(passo.tasto);
    } else if (passo.esegui) {
      const esito = await p.evaluate(function (codice) {
        try {
          const v = (0, eval)(codice);
          return 'ok' + (v === undefined ? '' : ': ' + String(v).slice(0, 120));
        } catch (e) {
          return 'errore: ' + e.message;
        }
      }, passo.esegui);
      note.push('Passo ' + n + ': ' + passo.esegui + ' -> ' + esito);
    } else if (passo.osserva) {
      const raf = await rafAlSecondo(p, 500);
      await fotografaStato(String(passo.osserva), raf);
      await scatta(String(passo.osserva));
    } else {
      note.push('Passo ' + n + ' non riconosciuto: ' + JSON.stringify(passo));
    }
  }
}

// ------------------------------------------------------------- rapporto

// "enemies: 84 (1s) -> 131 (3s) -> 251 (10s)", solo per gli elenchi che cambiano.
function elenchiNelTempo(serie) {
  const s = serie || [];
  const nomi = {};
  s.forEach(function (c) { Object.keys(c.elenchi || {}).forEach(function (n) { nomi[n] = true; }); });
  const righe = [];
  Object.keys(nomi).forEach(function (nome) {
    const punti = s.filter(function (c) { return typeof (c.elenchi || {})[nome] === 'number'; });
    if (punti.length < 2 || punti.every(function (c) { return c.elenchi[nome] === punti[0].elenchi[nome]; })) return;
    const passo = Math.max(1, Math.ceil(punti.length / 6));
    const scelti = punti.filter(function (c, i) { return i % passo === 0 || i === punti.length - 1; });
    righe.push(nome + ': ' + scelti.map(function (c) {
      return c.elenchi[nome] + ' (' + Math.round(c.t / 1000) + 's)';
    }).join(' -> '));
  });
  return righe;
}

// ------------------------------------------------------------- console del browser

// Il primo posto dove guarda un programmatore, e l'unico che alla sonda mancava. Un
// console.error dentro un try/catch, l'avviso di una libreria, un <script src> sbagliato:
// niente di tutto questo fa scattare 'pageerror', quindi il rapporto diceva "nessun
// errore" mentre la pagina di prova stampava tre console.error e non caricava un file.
// Ora ogni messaggio passa di qui: quelli uguali raggruppati (un gioco puo' stamparne
// sessanta al secondo), con il file e la riga da cui sono usciti.
const RUMORE_DEL_BROWSER = [
  /favicon\.ico/i,
  // Il 404 lo raccontiamo con il nome del file, guardando le risposte: qui arriverebbe
  // senza URL ("Failed to load resource"), inutile per capire quale file manca.
  /^Failed to load resource/i,
  // Lo dice Chrome perche' lo avviamo noi senza scheda video: non e' della pagina.
  /swiftshader/i,
  /software\s+webgl/i,
  /GL Driver Message/i
];

function nuovoRegistroConsole(massimo) {
  const voci = [];
  const perChiave = new Map();
  let scartati = 0;
  return {
    voci: voci,
    scartati: function () { return scartati; },
    aggiungi: function (tipo, testo, dove) {
      const t = String(testo === undefined || testo === null ? '' : testo).replace(/\s+/g, ' ').trim();
      if (!t) return;
      if (RUMORE_DEL_BROWSER.some(function (re) { return re.test(t); })) return;
      // I numeri cambiano a ogni giro (punteggio, tempo, coordinate): due messaggi che
      // differiscono solo per quelli sono lo stesso messaggio, ripetuto.
      const chiave = tipo + '|' + t.replace(/\d+(?:[.,]\d+)?/g, '#').slice(0, 200);
      const vista = perChiave.get(chiave);
      if (vista) {
        vista.volte++;
        return;
      }
      if (voci.length >= massimo) {
        scartati++;
        return;
      }
      const voce = { tipo: tipo, testo: t.slice(0, 300), dove: dove || '', volte: 1 };
      perChiave.set(chiave, voce);
      voci.push(voce);
    }
  };
}

// 'error' e 'warning' sono quelli che contano; il resto e' il racconto che la pagina fa
// di se' stessa, e serve per capire dove si e' fermata.
function tipoConsole(tipo) {
  if (tipo === 'error' || tipo === 'assert') return 'errore';
  if (tipo === 'warning' || tipo === 'warn') return 'avviso';
  return 'log';
}

// "gioco.js:12" dal luogo che da' puppeteer: solo il nome del file, come la sonda gia'
// scrive per gli errori JavaScript. Le righe di puppeteer partono da 0.
function luogoConsole(luogo) {
  if (!luogo || !luogo.url) return '';
  const nome = String(luogo.url).split('?')[0].split('/').pop();
  if (!nome) return '';
  const riga = luogo.lineNumber;
  return nome + (typeof riga === 'number' ? ':' + (riga + 1) : '');
}

// La stessa cosa arriva da piu' strade (la pagina, puppeteer, la console): senza una
// chiave comune Adam vedrebbe lo stesso errore tre volte.
function chiaveErrore(testo) {
  return String(testo).split('\n')[0].split(' [')[0]
    .replace(/^Uncaught\s+/, '').replace(/^[A-Za-z]*Error:\s*/, '').trim();
}

// Un 404 NON fa scattare 'requestfailed' (la richiesta riesce, e' la risposta a essere
// 404): per sapere QUALE file manca bisogna guardare le risposte.
function segnaRete(mappa, url, motivo, base) {
  const u = String(url || '');
  if (!u || /favicon\.ico/i.test(u)) return;
  // Una richiesta annullata mentre la pagina cambia o il browser si chiude non e' un
  // difetto del progetto.
  if (/ERR_ABORTED/i.test(String(motivo))) return;
  const breve = ((base && u.indexOf(base) === 0) ? u.slice(base.length) : u).split('?')[0] || u;
  const vista = mappa.get(breve);
  if (vista) {
    vista.volte++;
    return;
  }
  if (mappa.size >= 15) return;
  mappa.set(breve, { file: breve, motivo: String(motivo).slice(0, 80), volte: 1 });
}

// Il gioco chiede un WebSocket al server del progetto; se la pagina l'ha aperta la sonda
// con il suo server statico, quel WebSocket non c'e' e il browser scrive un errore. E'
// colpa di come abbiamo aperto la pagina, non del progetto: detto come difetto manderebbe
// Adam a "riparare" un multiplayer che funziona.
function wsDelNostroServer(testo, base) {
  const m = String(testo).match(/WebSocket connection to '(wss?:\/\/[^']+)'/i);
  if (!m || !base) return false;
  try {
    return new URL(m[1]).host === new URL(base).host;
  } catch (e) {
    return false;
  }
}

// Dalla console ai FATTI. Un console.error e' il programma che dichiara da solo che una
// sua parte non ha funzionato, e un file che non si carica spiega da se' perche' la
// pagina non fa niente. Gli avvisi restano nel rapporto ma NON diventano problemi: un
// falso "GRAVE" fa correggere ad Adam codice giusto.
function noteDaConsoleERete(r, contesto) {
  const note = [];
  (r.rete || []).slice(0, 4).forEach(function (v) {
    // Un file che manca e una chiamata che risponde male sono due storie diverse: dire
    // "il file /api/punteggi" manderebbe Adam a cercare un file che non e' mai esistito.
    const eUnFile = /\.[a-z0-9]{2,5}$/i.test(v.file);
    note.push(eUnFile
      ? 'Il file ' + v.file + ' non si carica (' + v.motivo + '): il browser non lo trova, quindi tutto ' +
        'quello che c\'e\' dentro non esiste per la pagina. Controlla il nome e il percorso dove viene ' +
        'chiamato (<script src>, <link href>, <img src>).'
      : 'La richiesta a ' + v.file + ' non riesce (' + v.motivo + '): la pagina la chiede e non ottiene ' +
        'risposta, quindi quello che doveva arrivare da li\' non arriva. Controlla l\'indirizzo e chi ' +
        'dovrebbe rispondere (il server e\' avviato?).');
  });
  const statico = !!(contesto && contesto.serverStatico);
  const gia = new Set((r.errori || []).map(chiaveErrore));
  let quanti = 0;
  (r.console || []).forEach(function (v) {
    if (v.tipo !== 'errore' || quanti >= 4) return;
    if (statico && wsDelNostroServer(v.testo, contesto.base)) {
      v.nostro = true;
      return;
    }
    // Un errore non catturato compare sia fra gli errori JavaScript sia nella console.
    if (gia.has(chiaveErrore(v.testo))) return;
    quanti++;
    note.push('Nella console del browser: "' + v.testo + '"' + (v.dove ? ' [' + v.dove + ']' : '') +
      (v.volte > 1 ? ', ripetuto ' + v.volte + ' volte' : '') + '. Il programma non si e\' fermato, ma dice ' +
      'lui stesso che quella parte non ha funzionato: guarda quella riga.');
  });
  return note;
}

function componiRapporto(r) {
  const righe = [];
  const slash = (f) => String(f).split(path.sep).join('/');

  righe.push('SONDA - ' + r.pagina + '  (' + r.url + ')');
  if (r.errore) {
    righe.push('ERRORE DELLA SONDA: ' + r.errore);
    return righe.join('\n');
  }
  righe.push('Browser di controllo: ' + r.vp.width + 'x' + r.vp.height + ', ' + (r.hz || '?') + ' fotogrammi/s');
  if (r.azione) {
    righe.push('Azione principale: clic reale su ' + r.azione.descr + ' ("' + r.azione.testo +
      '"), ricevuto da ' + r.azione.ricevente);
  }

  righe.push('');
  righe.push('STATO NEL TEMPO');
  r.momenti.forEach(function (m) {
    righe.push('  [' + m.momento + ']' +
      (m.rafAlSecondo === null ? '' : '  callback di animazione: ' + m.rafAlSecondo + '/s'));
    Object.keys(m.valori).forEach(function (k) {
      righe.push('    ' + k + ' = ' + String(m.valori[k]).slice(0, 160));
    });
  });

  const cambi = [];
  (r.osservate || []).forEach(function (k) {
    const seq = r.momenti.map(function (m) { return String(m.valori[k]); });
    if (seq.length > 1 && seq.some(function (v) { return v !== seq[0]; })) {
      cambi.push('  ' + k + ': ' + seq.map(function (v) { return v.slice(0, 60); }).join('  ->  '));
    }
  });
  righe.push('');
  righe.push('COSA CAMBIA NEL TEMPO');
  righe.push(cambi.length ? cambi.join('\n') : '  nessuna delle variabili osservate cambia');

  const elenchi = elenchiNelTempo(r.serie);
  if (elenchi.length) {
    righe.push('');
    righe.push('ELENCHI NEL TEMPO (elementi, secondi dal clic)');
    elenchi.forEach(function (l) { righe.push('  ' + l); });
  }

  righe.push('');
  righe.push('FATTI RILEVATI');
  righe.push(r.note.length ? r.note.map(function (n) { return '  - ' + n; }).join('\n') : '  nessuno');

  righe.push('');
  righe.push('ERRORI JAVASCRIPT');
  righe.push(r.errori.length ? r.errori.map(function (e) { return '  - ' + e; }).join('\n') : '  nessuno');

  righe.push('');
  righe.push('CONSOLE DEL BROWSER (quello che la pagina stampa, come negli strumenti di sviluppo)');
  const messaggi = (r.console || []).slice();
  if (!messaggi.length) {
    righe.push('  nessun messaggio');
  } else {
    // Prima gli errori, poi gli avvisi, poi il racconto: se l'elenco si taglia, si taglia
    // dalla parte che conta meno.
    const ordine = { errore: 0, avviso: 1, log: 2 };
    const peso = function (m) { return ordine[m.tipo] === undefined ? 2 : ordine[m.tipo]; };
    messaggi.sort(function (a, b) { return peso(a) - peso(b); });
    messaggi.slice(0, 20).forEach(function (m) {
      righe.push('  [' + m.tipo + '] ' + m.testo + (m.dove ? '  [' + m.dove + ']' : '') +
        (m.volte > 1 ? '  (x' + m.volte + ')' : '') + (m.nostro ? '  <- lo causa la sonda, non il progetto' : ''));
    });
    if (messaggi.length > 20) righe.push('  ... e altri ' + (messaggi.length - 20) + ' messaggi');
    if (r.consoleScartati) righe.push('  ... piu\' ' + r.consoleScartati + ' messaggi diversi non riportati (troppi)');
  }

  if ((r.rete || []).length) {
    righe.push('');
    righe.push('FILE CHE IL BROWSER NON RIESCE A CARICARE');
    r.rete.forEach(function (v) {
      righe.push('  - ' + v.file + ' (' + v.motivo + ')' + (v.volte > 1 ? ' x' + v.volte : ''));
    });
  }

  righe.push('');
  righe.push('SCHERMATE (aprile con lo strumento Read per guardarle)');
  // Si indica la copia leggera: la schermata a piena risoluzione costa 235.000 caratteri di
  // contesto contro 21.000, e per vedere layout e colori la piccola basta (schermata-leggera.js).
  r.schermate.forEach(function (s) { righe.push('  ' + s.momento + ': ' + slash(s.leggera || s.file)); });

  return righe.join('\n');
}

// ------------------------------------------------------------- principale

async function sondaPagina(opzioni) {
  const opts = Object.assign({
    dir: process.cwd(),
    base: BASE_PREDEFINITA,
    larghezza: 1280,
    altezza: 800
  }, opzioni || {});

  const pagina = String(opts.pagina || '').replace(/^[\\/]+/, '');
  const vp = { width: opts.larghezza, height: opts.altezza };
  const r = { pagina, url: '', vp, osservate: [], momenti: [], schermate: [], note: [], errori: [], console: [], consoleScartati: 0, rete: [], serie: [], morti: {} };
  if (opts.attesaRiavvio) r.attesaRiavvio = opts.attesaRiavvio;
  // A che punto e' la misura, per la scheda di avanzamento dello Studio: dura decine di
  // secondi e un'attesa muta sembra un blocco.
  const avanza = typeof opts.progresso === 'function'
    ? function (testo) { try { opts.progresso(testo); } catch (e) {} }
    : function () {};

  if (!pagina) r.errore = 'indica la pagina da sondare, per esempio: node sonda.js index.html';
  else if (!puppeteer) r.errore = 'puppeteer-core non installato (npm install puppeteer-core)';
  else if (!runtime.trovaBrowser || !runtime.trovaBrowser()) r.errore = 'nessun browser disponibile (npx puppeteer browsers install chrome)';
  if (r.errore) { r.rapporto = componiRapporto(r); return r; }

  // Stessa URL dell'Anteprima se lo Studio e' acceso; altrimenti un server temporaneo
  // sulla cartella, perche' la sonda deve funzionare anche da sola.
  let server = null;
  let base = String(opts.base).replace(/\/+$/, '');
  if (!(await studioServeLaCartella(base, opts.dir)) || !(await raggiungibile(base + '/' + pagina))) {
    const t = await runtime.avviaServerTemporaneo(opts.dir);
    server = t.server;
    base = 'http://127.0.0.1:' + t.porta;
  }
  r.url = base + '/' + pagina;
  r.osservate = (opts.osserva && opts.osserva.length) ? opts.osserva : osservazioniPredefinite(opts.dir, pagina);

  const cartellaScatti = path.join(os.tmpdir(), 'studio-screenshot');
  if (!fs.existsSync(cartellaScatti)) fs.mkdirSync(cartellaScatti, { recursive: true });
  const prefisso = 'sonda-' + Date.now() + '-' + path.basename(pagina).replace(/\W+/g, '_');
  const profilo = path.join(os.tmpdir(), 'studio-sonda-' + process.pid + '-' + Date.now());
  const erroriPuppeteer = [];
  const registroConsole = nuovoRegistroConsole(30);
  const reteFallita = new Map();
  let browser = null;

  try {
    avanza('Avvio il browser di controllo');
    browser = await puppeteer.launch({
      executablePath: runtime.trovaBrowser(),
      headless: true,
      args: ['--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage', '--no-first-run',
        '--no-default-browser-check', '--user-data-dir=' + profilo]
    });
    const p = await browser.newPage();
    // Schermate a meta' risoluzione: al modello costano un quarto del contesto, e per
    // capire cosa c'e' sullo schermo bastano. Le coordinate CSS non cambiano.
    await p.setViewport(Object.assign({ deviceScaleFactor: 0.5 }, vp));
    await p.evaluateOnNewDocument(STRUMENTAZIONE);
    await p.coverage.startJSCoverage({ resetOnNavigation: false });
    p.on('pageerror', function (e) { erroriPuppeteer.push(String(e.message).slice(0, 300)); });
    // La console, come la vedrebbe una persona con gli strumenti di sviluppo aperti.
    p.on('console', function (msg) {
      let dove = '';
      try { dove = luogoConsole(msg.location()); } catch (e) { dove = ''; }
      let testo = '';
      try { testo = msg.text(); } catch (e) { testo = ''; }
      registroConsole.aggiungi(tipoConsole(msg.type()), testo, dove);
    });
    p.on('response', function (risposta) {
      try {
        if (risposta.status() >= 400) segnaRete(reteFallita, risposta.url(), 'HTTP ' + risposta.status(), base);
      } catch (e) { /* risposta gia' sparita */ }
    });
    p.on('requestfailed', function (req) {
      try {
        const f = req.failure();
        segnaRete(reteFallita, req.url(), (f && f.errorText) || 'richiesta fallita', base);
      } catch (e) { /* richiesta gia' sparita */ }
    });

    avanza('Carico ' + pagina);
    // Un gioco 3D disegna in continuazione e Chrome non dichiara mai "rete tranquilla":
    // si aspetta che la pagina ci sia, poi si da' alla rete al massimo 8 secondi per calmarsi.
    await p.goto(r.url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    if (typeof p.waitForNetworkIdle === 'function') {
      await p.waitForNetworkIdle({ idleTime: 500, timeout: 8000 }).catch(function () {});
    }
    await attesa(800);
    r.hz = await misuraHz(p);

    const scatta = async function (momento) {
      const file = path.join(cartellaScatti, prefisso + '-' + r.schermate.length + '.png');
      await p.screenshot({ path: file });
      r.schermate.push({ momento, file });
    };
    const fotografaStato = async function (momento, raf) {
      const valori = {};
      for (const espressione of r.osservate) {
        const esito = await p.evaluate(riassumiNellaPagina, espressione);
        valori[espressione] = esito.valore;
      }
      r.momenti.push({ momento, valori, rafAlSecondo: raf === undefined ? null : raf });
    };

    await fotografaStato('caricamento', await rafAlSecondo(p, 500));
    await scatta('caricamento');

    // Quanto stile e' DAVVERO applicato appena aperta la pagina. Una pagina che ha perso il CSS
    // non da' nessun errore - funziona benissimo - ma per chi la guarda e' rotta: l'unico modo di
    // accorgersene e' confrontarla con com'era l'ultima volta (strumenti/aspetto.js).
    try {
      const misuraAspetto = await p.evaluate(aspettoPagina.misuraNellaPagina);
      const esitoAspetto = aspettoPagina.registra(opts.dir, pagina, misuraAspetto, {
        base: opts.baseDati, contesto: server ? 'statico' : 'studio'
      });
      r.aspetto = esitoAspetto.aspetto;
      if (esitoAspetto.prima) r.aspettoPrima = esitoAspetto.prima;
      if (esitoAspetto.regressione) r.note.push(esitoAspetto.nota);
    } catch (e) {
      // la misura dell'aspetto non deve fermare la prova
    }

    // Lunghezza degli elenchi e oggetti eliminati, a ogni campione dopo il clic.
    const campiona = async function () {
      const c = await p.evaluate(censimentoOggetti, r.osservate).catch(function () { return null; });
      if (!c) return;
      r.serie.push({ t: Date.now() - (r.t0Clic || Date.now()), elenchi: c.elenchi });
      c.morti.forEach(function (m) {
        const prima = r.morti[m.nome];
        if (!prima || m.vecchi > prima.vecchi) r.morti[m.nome] = m;
      });
    };

    const ctx = { fotografaStato, scatta, note: r.note, r, hz: r.hz, vp, avanza, campiona };
    if (Array.isArray(opts.passi) && opts.passi.length) await eseguiPassi(p, opts.passi, ctx);
    else await esplorazionePredefinita(p, ctx);

    // Cosa questa misura ha potuto provare davvero. Un fatto non provato non e' un fatto
    // risolto: una partita che dura di piu' non dimostra che il riavvio sia corretto.
    const esplorata = !(Array.isArray(opts.passi) && opts.passi.length);
    r.provati = {
      canvas: esplorata && Array.isArray(r.canvas),
      clic: esplorata && !!r.azione,
      // Se il clic principale non fa nulla, cicli e riavvio non sono stati provati davvero:
      // un gioco che non parte non puo' mostrare il ciclo che raddoppia.
      cicli: esplorata && !!r.azione && !r.clicSenzaEffetto,
      riavvio: esplorata && !!r.secondoAvvio && !r.clicSenzaEffetto,
      mouse: esplorata && r.osservate.some(function (k) { return /^mouse/i.test(k); }),
      // Gli oggetti eliminati si vedono solo se la partita e' partita davvero, e la crescita
      // solo se la si e' seguita per almeno 3 secondi.
      oggetti: esplorata && !!r.azione && !r.clicSenzaEffetto && r.serie.length > 0,
      crescita: esplorata && r.serie.length >= 4 && (r.serie[r.serie.length - 1].t - r.serie[0].t) >= 3000,
      // lo schermo si giudica solo se la pagina e' partita davvero dopo il clic
      schermo: esplorata && !!r.azione && !r.clicSenzaEffetto,
      errori: true
    };

    // Variabili di posizione del mouse ferme a 0 dopo movimenti veri: gli eventi non
    // arrivano al codice che li ascolta (tipicamente perche' un altro elemento li intercetta).
    const ultimo = r.momenti[r.momenti.length - 1];
    if (ultimo && !opts.passi) {
      const ferme = Object.keys(ultimo.valori).filter(function (k) {
        return /^mouse/i.test(k) && ultimo.valori[k] === '0';
      });
      if (ferme.length) {
        r.note.push('Dopo movimenti reali del mouse, ' + ferme.join(' e ') +
          ' valgono ancora 0: gli eventi del mouse non raggiungono il codice che li ascolta.');
      }
    }

    if (!opts.passi) {
      Object.keys(r.morti).forEach(function (nome) {
        const m = r.morti[nome];
        if (!m.vecchi) return;
        r.note.push('Oggetti eliminati che restano in gioco: in ' + nome + ' ' + m.vecchi +
          (m.vecchi === 1 ? ' elemento ha ' : ' elementi hanno ') + m.campo + ' <= 0 da oltre 1,5 secondi ma ' +
          (m.vecchi === 1 ? 'e\' ancora' : 'sono ancora') + ' nell\'elenco (' + m.totale + ' elementi in tutto). ' +
          'Un oggetto eliminato che resta continua a esistere nel gioco: viene disegnato e conta nelle collisioni ' +
          'e nei punteggi. Va tolto dall\'elenco (splice o filter) nel punto in cui ' + m.campo + ' arriva a 0.' +
          (m.esempio ? ' Esempio: ' + m.esempio : ''));
      });
      misure.analizzaCrescita(r.serie).forEach(function (c) {
        r.note.push('L\'elenco ' + c.nome + ' continua a crescere: in media ' + c.mediane[0] + ' elementi nel primo ' +
          'terzo della prova, ' + c.mediane[1] + ' nel secondo e ' + c.mediane[2] + ' nell\'ultimo (' + c.secondi +
          ' secondi, circa ' + c.alSecondo + ' in piu\' al secondo). Ne entrano piu\' di quanti ne escano: guarda ' +
          'dove vengono aggiunti (push), quanto spesso, e dove dovrebbero uscire dall\'elenco (splice o filter).');
      });
    }

    avanza('Raccolgo errori e righe eseguite');
    r.lineeEseguite = lineeEseguiteDa(await p.coverage.stopJSCoverage());
    // Con che cosa la pagina ha davvero disegnato e si e' collegata (canvas 2d, WebGL, blocco del
    // mouse, WebSocket): la verifica dei requisiti se ne serve per dire se e' davvero un FPS 3D
    // o un multiplayer.
    r.tecnologia = await p.evaluate(function () { return (window.__sonda && window.__sonda.tecnologia) || null; }).catch(function () { return null; });
    const erroriPagina = await p.evaluate(function () { return (window.__sonda && window.__sonda.errori) || []; });
    const visti = new Set();
    erroriPagina.concat(erroriPuppeteer).forEach(function (e) {
      // Lo stesso errore arriva dalla pagina ("Uncaught ReferenceError: x [file:riga]") e
      // da puppeteer ("x"): la chiave li riconosce come uno solo.
      // Solo la prima riga: puppeteer aggiunge lo stack sotto il messaggio, e senza
      // questo lo stesso errore diventava due fatti diversi per Adam.
      const chiave = chiaveErrore(e);
      if (visti.has(chiave)) return;
      visti.add(chiave);
      r.errori.push(e);
    });
  } catch (err) {
    r.errore = err.message;
  } finally {
    // Anche se la prova si e' interrotta a meta': quello che la pagina ha stampato fino a
    // quel momento e' spesso proprio il motivo per cui si e' interrotta.
    // Copie leggere delle schermate finche' il browser c'e': e' quello che vedra' Adam.
    try {
      if (browser && r.schermate.length) await schermataLeggera.riduciSchermate(browser, r.schermate);
    } catch (e) { /* senza copia leggera restano le schermate piene */ }
    r.console = registroConsole.voci;
    r.consoleScartati = registroConsole.scartati();
    r.rete = Array.from(reteFallita.values());
    noteDaConsoleERete(r, { serverStatico: !!server, base: base }).forEach(function (n) { r.note.push(n); });
    if ((r.console || []).some(function (v) { return v.nostro; })) {
      r.note.push('La sonda ha aperto la pagina con un server statico, che non parla WebSocket: il ' +
        'collegamento fra giocatori non si e\' potuto provare cosi\' (l\'errore nella console e\' nostro, non ' +
        'del progetto). Per provarlo davvero avvia il server del progetto e sonda l\'indirizzo che stampa.');
    }
    try { if (browser) await browser.close(); } catch (e) {}
    try { if (server) server.close(); } catch (e) {}
    try { fs.rmSync(profilo, { recursive: true, force: true }); } catch (e) {}
  }

  r.rapporto = componiRapporto(r);
  return r;
}

// ------------------------------------------------------------- collaudi

// I collaudi li scrive un modello (il revisore, strumenti/collaudatore.js): codice che
// nessuno ha controllato. Girano quindi in una gabbia: un server temporaneo che serve solo
// la cartella del progetto (mai /preview dello Studio, che ha accanto le sue API), nessuna
// richiesta verso altre origini o con metodi diversi da GET, niente WebSocket, e un
// contesto del browser nuovo per ogni collaudo, cosi' uno non sporca l'altro. Un collaudo
// puo' sbagliare, ma non puo' toccare niente fuori dalla pagina che prova.
const GABBIA = `(() => {
  const vieta = function () { throw new Error('rete non disponibile durante un collaudo'); };
  try { window.WebSocket = vieta; } catch (e) {}
  try { window.EventSource = vieta; } catch (e) {}
  try { navigator.sendBeacon = function () { return false; }; } catch (e) {}
  try { window.open = function () { return null; }; } catch (e) {}
})();`;

function conTempo(promessa, ms, cosa) {
  let timer = null;
  const scadenza = new Promise(function (_, rifiuta) {
    timer = setTimeout(function () {
      rifiuta(new Error((cosa || 'operazione') + ' oltre ' + Math.round(ms / 1000) + ' s'));
    }, ms);
  });
  return Promise.race([promessa, scadenza]).finally(function () { clearTimeout(timer); });
}

function eseguiNellaPagina(codice) {
  try {
    const v = (0, eval)(codice);
    return Promise.resolve(v).then(
      function () { return { ok: true }; },
      function (e) { return { ok: false, errore: String((e && e.message) || e) }; });
  } catch (e) {
    return { ok: false, errore: e.message };
  }
}

function verificaNellaPagina(espressione) {
  try {
    const v = (0, eval)('(' + espressione + ')');
    return Promise.resolve(v).then(
      function (x) { return { ok: true, valore: !!x }; },
      function (e) { return { ok: false, errore: String((e && e.message) || e) }; });
  } catch (e) {
    return { ok: false, errore: e.message };
  }
}

function centroDi(selettore) {
  let el;
  try { el = document.querySelector(selettore); } catch (e) { return { errore: 'selettore non valido' }; }
  if (!el) return { errore: 'non esiste' };
  const q = el.getBoundingClientRect();
  const st = getComputedStyle(el);
  if (q.width < 2 || q.height < 2 || st.display === 'none' || st.visibility === 'hidden') return { errore: 'non e\' visibile' };
  return { x: q.left + q.width / 2, y: q.top + q.height / 2 };
}

const CDN_SICURI = /^https:\/\/(cdnjs\.cloudflare\.com|unpkg\.com|cdn\.jsdelivr\.net|ajax\.googleapis\.com|code\.jquery\.com|threejs\.org)\//i;

function lanciaBrowser(profilo) {
  return puppeteer.launch({
    executablePath: runtime.trovaBrowser(),
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage', '--no-first-run',
      '--no-default-browser-check', '--user-data-dir=' + profilo]
  });
}

// Esiti: 'superato', 'fallito', 'non valido' (il collaudo stesso non si puo' eseguire:
// variabile inesistente, passo sbagliato) e, dopo la conferma, 'instabile'.
// causa 'elemento' = un elemento su cui cliccare manca o e' nascosto: sulla prima misura
// e' quasi sempre un errore del revisore, dopo una modifica e' una funzione tolta.
async function unCollaudo(browser, base, pagina, c, vp) {
  const inizio = Date.now();
  const esito = { nome: c.nome, fonte: c.fonte || '', esito: 'non valido', motivo: '', causa: '', misure: {}, errori: [], bloccate: [] };
  const passi = [];
  for (const testo of c.passi || []) {
    const passo = leggiPasso(testo);
    if (!passo) {
      esito.motivo = 'passo non riconosciuto: ' + String(testo).slice(0, 80);
      return esito;
    }
    passi.push(passo);
  }

  let contesto = null;
  try {
    contesto = await browser.createBrowserContext();
    const p = await contesto.newPage();
    await p.setViewport(Object.assign({ deviceScaleFactor: 0.5 }, vp));
    await p.evaluateOnNewDocument(GABBIA);
    await p.evaluateOnNewDocument(STRUMENTAZIONE);
    await p.setRequestInterception(true);
    p.on('request', function (req) {
      const u = req.url();
      if (req.method() === 'GET' && (u.indexOf(base + '/') === 0 || /^(data|blob):/.test(u) || CDN_SICURI.test(u))) {
        req.continue().catch(function () {});
        return;
      }
      if (esito.bloccate.length < 5) esito.bloccate.push(req.method() + ' ' + u.slice(0, 100));
      req.abort().catch(function () {});
    });
    p.on('pageerror', function (e) {
      if (esito.errori.length < 5) esito.errori.push(String(e.message).split('\n')[0].slice(0, 200));
    });

    await conTempo(p.goto(base + '/' + pagina, { waitUntil: 'load', timeout: 15000 }), 16000, 'caricamento');
    await attesa(400);

    for (const passo of passi) {
      if (passo.tipo === 'attendi') {
        await attesa(passo.ms);
      } else if (passo.tipo === 'js') {
        const r = await conTempo(p.evaluate(eseguiNellaPagina, passo.codice), 5000, 'passo js');
        if (!r.ok) {
          esito.motivo = 'il passo "js ' + passo.codice.slice(0, 70) + '" da\' errore: ' + r.errore;
          return esito;
        }
      } else if (passo.tipo === 'trascina') {
        const punti = await coordinateTrascinamento(passo, p);
        if (punti.errore) {
          esito.esito = 'fallito';
          esito.causa = 'elemento';
          esito.motivo = 'il trascinamento non si puo\' eseguire: ' + punti.errore;
          return esito;
        }
        await eseguiTrascinamento(p, punti);
      } else if (passo.tipo === 'clic' || passo.tipo === 'clicxy') {
        let pos = { x: passo.x, y: passo.y };
        if (passo.tipo === 'clic') {
          pos = await p.evaluate(centroDi, passo.selettore);
          if (pos.errore) {
            esito.esito = 'fallito';
            esito.causa = 'elemento';
            esito.motivo = 'l\'elemento "' + passo.selettore + '" ' + pos.errore;
            return esito;
          }
        }
        await p.mouse.move(pos.x, pos.y, { steps: 8 });
        await p.mouse.click(pos.x, pos.y);
        // Un clic puo' portare a un'altra pagina del flusso: si aspetta che sia carica.
        await attesa(120);
        await p.waitForFunction(function () { return document.readyState === 'complete'; }, { timeout: 5000 }).catch(function () {});
        await p.evaluate(function () {
          const a = document.activeElement;
          if (a && /^(BUTTON|A|SELECT)$/.test(a.tagName)) a.blur();
        }).catch(function () {});
      } else if (passo.tipo === 'scrivi' || passo.tipo === 'seleziona') {
        const pos = await p.evaluate(centroDi, passo.selettore);
        if (pos.errore) {
          esito.esito = 'fallito';
          esito.causa = 'elemento';
          esito.motivo = 'il campo "' + passo.selettore + '" ' + pos.errore;
          return esito;
        }
        if (passo.tipo === 'seleziona') {
          const scelti = await p.select(passo.selettore, passo.valore);
          if (!scelti.length) {
            esito.esito = 'fallito';
            esito.causa = 'elemento';
            esito.motivo = 'nel menu "' + passo.selettore + '" non c\'e\' la voce "' + passo.valore + '"';
            return esito;
          }
        } else {
          // Come una persona: clic nel campo, via il testo che c'era, poi un tasto alla volta
          // (cosi' partono gli eventi input e keydown che la pagina ascolta).
          await p.mouse.click(pos.x, pos.y);
          await p.evaluate(function (sel) {
            const el = document.querySelector(sel);
            if (el) { el.focus(); if (el.select) el.select(); }
          }, passo.selettore);
          await p.keyboard.press('Backspace');
          await p.keyboard.type(passo.testo, { delay: 8 });
        }
      } else if (passo.tipo === 'tasto') {
        await p.keyboard.down(passo.tasto);
        await attesa(passo.ms);
        await p.keyboard.up(passo.tasto);
      } else if (passo.tipo === 'mouse') {
        await p.mouse.move(passo.x, passo.y, { steps: 6 });
      }
    }

    const v = await conTempo(p.evaluate(verificaNellaPagina, c.verifica), 5000, 'verifica');
    for (const espressione of c.misura || []) {
      const m = await conTempo(p.evaluate(riassumiNellaPagina, espressione), 3000, 'misura')
        .catch(function (e) { return { valore: 'errore: ' + e.message }; });
      esito.misure[espressione] = m.valore;
    }
    if (!v.ok) {
      esito.motivo = 'la verifica da\' errore: ' + v.errore;
      return esito;
    }
    esito.esito = v.valore ? 'superato' : 'fallito';
    if (!v.valore) esito.motivo = 'la verifica risulta falsa';
  } catch (e) {
    esito.esito = 'non valido';
    esito.motivo = e.message;
  } finally {
    esito.durataMs = Date.now() - inizio;
    if (contesto) await conTempo(contesto.close(), 5000, 'chiusura').catch(function () {});
  }
  return esito;
}

async function eseguiCollaudi(opzioni) {
  const opts = Object.assign({ dir: process.cwd(), larghezza: 1280, altezza: 800, ripeti: true }, opzioni || {});
  const pagina = String(opts.pagina || '').replace(/^[\\/]+/, '');
  const collaudi = Array.isArray(opts.collaudi) ? opts.collaudi : [];
  const vp = { width: opts.larghezza, height: opts.altezza };
  const avanza = typeof opts.progresso === 'function'
    ? function (testo) { try { opts.progresso(testo); } catch (e) {} }
    : function () {};
  // Nomi dei collaudi il cui successo va confermato: quelli che non sono ancora guardie.
  const confermare = new Set(Array.isArray(opts.confermaSuperati) ? opts.confermaSuperati : []);
  const esito = { pagina: pagina, esiti: [], errore: null };

  if (!pagina) esito.errore = 'pagina non indicata';
  else if (!puppeteer) esito.errore = 'puppeteer-core non installato';
  else if (!runtime.trovaBrowser()) esito.errore = 'nessun browser disponibile';
  if (esito.errore || !collaudi.length) return esito;

  let server = null;
  let browser = null;
  const profilo = path.join(os.tmpdir(), 'studio-collaudi-' + process.pid + '-' + Date.now());
  try {
    const t = await runtime.avviaServerTemporaneo(opts.dir);
    server = t.server;
    const base = 'http://127.0.0.1:' + t.porta;
    avanza('Avvio il browser dei collaudi');
    browser = await lanciaBrowser(profilo);
    for (let i = 0; i < collaudi.length; i++) {
      const c = collaudi[i];
      const etichetta = (i + 1) + '/' + collaudi.length + ': ' + c.nome;
      avanza(etichetta);
      let e = await unCollaudo(browser, base, pagina, c, vp);
      // Un gioco usa numeri casuali: un fallimento si conferma con una seconda prova prima
      // di crederci, altrimenti Adam correggerebbe un caso sfortunato.
      if (e.esito === 'fallito' && e.causa !== 'elemento' && opts.ripeti) {
        avanza(etichetta + ' (fallito: lo ripeto per conferma)');
        const e2 = await unCollaudo(browser, base, pagina, c, vp);
        if (e2.esito === 'superato') {
          e.esito = 'instabile';
          e.motivo = 'fallito una volta e superato alla seconda prova: dipende dal caso';
        }
      }
      // Anche un successo si conferma quando il collaudo sta per diventare una guardia: visto
      // dal vivo, un collaudo mal scritto ("level === 2" dopo tre nemici tolti a mano) e' passato
      // per caso, e da guardia avrebbe poi segnalato regressioni inesistenti.
      if (e.esito === 'superato' && confermare.has(c.nome) && opts.ripeti) {
        avanza(etichetta + ' (superato: lo ripeto per conferma)');
        const e2 = await unCollaudo(browser, base, pagina, c, vp);
        if (e2.esito !== 'superato') {
          e.esito = 'instabile';
          e.motivo = 'superato una volta e non alla seconda prova: dipende dal caso';
        } else if ((c.passi || []).length) {
          // Prova a vuoto: stessa verifica senza i passi. Se e' vera lo stesso, il collaudo non
          // misura niente. Visto dal vivo: "la navicella segue il cursore" passava senza nemmeno
          // avviare la partita, perche' la navicella parte gia' al centro dell'intervallo.
          avanza(etichetta + ' (prova a vuoto, senza i suoi passi)');
          const e3 = await unCollaudo(browser, base, pagina, Object.assign({}, c, { passi: [] }), vp);
          if (e3.esito === 'superato') {
            e.esito = 'vuoto';
            e.motivo = 'la verifica e\' vera anche senza eseguire i passi: non misura niente';
          }
        }
      }
      esito.esiti.push(e);
    }
  } catch (err) {
    esito.errore = err.message;
  } finally {
    try { if (browser) await browser.close(); } catch (e) {}
    try { if (server) server.close(); } catch (e) {}
    try { fs.rmSync(profilo, { recursive: true, force: true }); } catch (e) {}
  }
  return esito;
}

// ------------------------------------------------------------- stili applicati

// Nella pagina: per ogni regola, lo stile calcolato del primo elemento scelto e' quello
// voluto? Il valore voluto passa da un elemento di prova, cosi' "#16a34a" e
// "rgb(22, 163, 74)" risultano uguali.
function controllaStiliNellaPagina(regole) {
  const prova = document.createElement('div');
  document.body.appendChild(prova);
  const esiti = [];
  (regole || []).forEach(function (r) {
    let elementi;
    try { elementi = Array.from(document.querySelectorAll(r.selettore)); } catch (e) {
      esiti.push({ selettore: r.selettore, trovati: 0, errore: 'selettore non valido', diversi: [] });
      return;
    }
    const diversi = [];
    if (elementi.length) {
      const reale = getComputedStyle(elementi[0]);
      Object.keys(r.proprieta || {}).forEach(function (p) {
        prova.style.cssText = 'display:none;' + p + ':' + r.proprieta[p];
        const atteso = getComputedStyle(prova);
        const da = p === 'background' ? ['background-color', 'background-image'] : [p];
        da.forEach(function (q) {
          const a = atteso.getPropertyValue(q);
          const v = reale.getPropertyValue(q);
          if (a && v !== a) diversi.push({ proprieta: q, atteso: a, reale: v });
        });
      });
    }
    // Un colore di sfondo applicato ma coperto da un gradiente o da un'immagine: risulta
    // "giusto" e non si vede. Visto dal vivo sul pulsante del gioco.
    let coperto = '';
    if (elementi.length && r.proprieta && r.proprieta['background-color'] !== undefined &&
        getComputedStyle(elementi[0]).backgroundImage !== 'none') {
      coperto = 'il colore di sfondo e\' coperto da un gradiente o da un\'immagine di sfondo';
    }
    esiti.push({ selettore: r.selettore, trovati: elementi.length, diversi: diversi, coperto: coperto });
  });
  prova.remove();
  return esiti;
}

// Per l'editor visivo: dopo aver scritto il CSS, le modifiche si vedono davvero? Una regola
// piu' specifica del progetto puo' coprirle senza alcun errore visibile.
async function verificaStili(opzioni) {
  const opts = Object.assign({ dir: process.cwd(), larghezza: 1280, altezza: 800 }, opzioni || {});
  const pagina = String(opts.pagina || '').replace(/^[\\/]+/, '');
  const esito = { risultati: [], errore: null };
  if (!pagina) esito.errore = 'pagina non indicata';
  else if (!puppeteer || !runtime.trovaBrowser()) esito.errore = 'browser non disponibile';
  if (esito.errore) return esito;
  let server = null;
  let browser = null;
  const profilo = path.join(os.tmpdir(), 'studio-stili-' + process.pid + '-' + Date.now());
  try {
    const t = await runtime.avviaServerTemporaneo(opts.dir);
    server = t.server;
    browser = await lanciaBrowser(profilo);
    const p = await browser.newPage();
    await p.setViewport({ width: opts.larghezza, height: opts.altezza, deviceScaleFactor: 0.5 });
    await conTempo(p.goto('http://127.0.0.1:' + t.porta + '/' + pagina, { waitUntil: 'load', timeout: 15000 }), 16000, 'caricamento');
    await attesa(300);
    esito.risultati = await conTempo(p.evaluate(controllaStiliNellaPagina, opts.regole || []), 8000, 'controllo degli stili');
  } catch (e) {
    esito.errore = e.message;
  } finally {
    try { if (browser) await browser.close(); } catch (e) {}
    try { if (server) server.close(); } catch (e) {}
    try { fs.rmSync(profilo, { recursive: true, force: true }); } catch (e) {}
  }
  return esito;
}

// ------------------------------------------------------------- riga di comando

function leggiArgomenti(argv) {
  const opts = { osserva: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const valore = () => argv[++i];
    if (a === '--osserva') opts.osserva = String(valore() || '').split(';').map((s) => s.trim()).filter(Boolean);
    else if (a === '--passi') {
      // Due forme: JSON (come prima) oppure testo, un passo per ";" o per riga:
      //   --passi "scrivi #campo | pane; tasto Enter; clic #aggiungi; osserva dopo"
      const testo = String(valore() || '').trim();
      if (/^[\[{]/.test(testo)) {
        try { opts.passi = JSON.parse(testo); } catch (e) { opts.erroreArgomenti = 'JSON di --passi non valido: ' + e.message; }
      } else {
        opts.passi = testo.split(/[;\n]/).map(function (x) { return x.trim(); }).filter(Boolean);
      }
    } else if (a === '--passi-file') {
      try { opts.passi = JSON.parse(fs.readFileSync(valore(), 'utf8')); } catch (e) { opts.erroreArgomenti = 'file di --passi-file non leggibile: ' + e.message; }
    } else if (a === '--dir') opts.dir = valore();
    else if (a === '--base') opts.base = valore();
    else if (a === '--larghezza') opts.larghezza = Number(valore()) || 1280;
    else if (a === '--altezza') opts.altezza = Number(valore()) || 800;
    else if (a === '--json') opts.json = true;
    else if (!a.startsWith('--') && !opts.pagina) opts.pagina = a;
  }
  return opts;
}

if (require.main === module) {
  const opts = leggiArgomenti(process.argv.slice(2));
  // Anche il percorso completo della pagina: la cartella da servire e' quella che la contiene.
  if (opts.pagina && path.isAbsolute(opts.pagina)) {
    if (!opts.dir) opts.dir = path.dirname(opts.pagina);
    opts.pagina = path.relative(opts.dir, opts.pagina).split(path.sep).join('/');
  }
  if (opts.erroreArgomenti) {
    console.log('Errore: ' + opts.erroreArgomenti);
    process.exit(2);
  }
  sondaPagina(opts).then(function (r) {
    if (opts.json) {
      const copia = Object.assign({}, r);
      delete copia.rapporto;
      console.log(JSON.stringify(copia, null, 2));
    } else {
      console.log(r.rapporto);
    }
    process.exit(r.errore ? 1 : 0);
  });
}

module.exports = { sondaPagina, eseguiCollaudi, verificaStili, leggiPasso };
