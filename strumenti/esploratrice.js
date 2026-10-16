// NotExist Intelligience Studio - Sonda dei flussi (esploratrice).
//
// Storia misurata l'11/9/2026 con qwen3.5 9B sulla lista della spesa con 3 difetti piantati:
//  - il modello che guida il browser: 12 azioni in giro, mai un Aggiungi, passi inventati nella
//    trascrizione. 0 collaudi buoni su 2;
//  - il modello che giudica le misure (vede prima e dopo, dice "rispetta"): 2 difetti su 3, poi
//    0 su 3 per due giri; verdetti in contraddizione con il suo stesso "atteso", e una guardia
//    che asseriva "Invio non aggiunge niente", cioe' proteggeva il difetto;
//  - il modello come oracolo alla cieca, tutte le prove in un messaggio: 3 difetti su 3 per due
//    giri, ma voci e numeri trascinati da una prova all'altra (collaudi sbagliati);
//  - una prova per messaggio: il modello, da solo, rinuncia (6 prove su 7 senza risposta).
//
// Disegno attuale. Al modello resta solo leggere la descrizione: fa da ORACOLO alla cieca, vede
// lo stato PRIMA e l'azione (non il DOPO, che potrebbe copiare) e dice cosa dovrebbe esserci
// dopo: quali voci negli elenchi, che numero nei contatori. Tutto il resto e' dello Studio:
//  1. prova la pagina in modo meccanico, ogni prova su una pagina appena riaperta (Invio,
//     ciascun pulsante, due voci, una vuota, la prima casella, gli altri pulsanti), e misura;
//  2. chiede l'oracolo fino a 3 volte, ogni volta con le prove in un ORDINE diverso (normale,
//     rovesciato, ruotato): cosi' cio' che si trascina da una prova all'altra cambia a ogni voto
//     e diventa rumore;
//  3. consenso CAMPO PER CAMPO: per ogni elenco e ogni contatore vale il valore dato da almeno 2
//     voti; i campi senza maggioranza cadono;
//  4. violazione = il consenso non coincide con la misura: la verifica la scrive lo Studio e la
//     si tiene solo se FALLISCE sulla pagina di adesso;
//  5. guardia = il consenso coincide E l'elenco e' cresciuto. Mai una guardia che asserisce
//     "non succede niente": congelerebbe una funzione mancante.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const runtime = require('../analisi-runtime');
const collaudatore = require('./collaudatore');
const { eseguiCollaudi } = require('./sonda');

let puppeteer = null;
try { puppeteer = require('puppeteer-core'); } catch (e) { puppeteer = null; }

const MAX_PULSANTI = 4;
const MAX_VOTI = 3;
const attesa = (ms) => new Promise((r) => setTimeout(r, ms));

const ATTESA = {
  type: 'object',
  properties: {
    promessa: { type: 'string' },
    elenchi: {
      type: 'array',
      items: {
        type: 'object',
        properties: { selettore: { type: 'string' }, voci: { type: 'array', items: { type: 'string' } } },
        required: ['selettore', 'voci']
      }
    },
    numeri: {
      type: 'array',
      items: {
        type: 'object',
        properties: { selettore: { type: 'string' }, numero: { type: 'number' } },
        required: ['selettore', 'numero']
      }
    }
  },
  required: ['promessa', 'elenchi', 'numeri']
};

// Una chiave obbligatoria per ogni prova (prova1 ... provaN). Con un elenco libero il modello,
// misurato, rispondeva solo sulla prima prova: la grammatica di Ollama vincola la forma, non
// quanti elementi ci sono.
function schemaAttese(n) {
  const properties = {};
  const required = [];
  for (let i = 1; i <= n; i++) { properties['prova' + i] = ATTESA; required.push('prova' + i); }
  return { type: 'object', properties: properties, required: required };
}

// L'ordine delle prove a ogni voto: normale, rovesciato, ruotato a meta'.
const ORDINI = [
  function (n) { return Array.from({ length: n }, function (_, i) { return i; }); },
  function (n) { return Array.from({ length: n }, function (_, i) { return n - 1 - i; }); },
  function (n) { const k = Math.floor(n / 2); return Array.from({ length: n }, function (_, i) { return (i + k) % n; }); }
];

// ------------------------------------------------------------- nella pagina

// Elementi con cui si interagisce, con un selettore stabile (id, o percorso dal genitore con
// un id) e il loro stato.
function elementiInterattivi() {
  const NOME = /^[A-Za-z][\w-]*$/;
  function selettoreDi(el) {
    if (el.id && NOME.test(el.id) && document.querySelectorAll('#' + el.id).length === 1) return '#' + el.id;
    const parti = [];
    let cur = el;
    while (cur && cur !== document.body && cur.nodeType === 1 && parti.length < 6) {
      if (cur !== el && cur.id && NOME.test(cur.id)) { parti.unshift('#' + cur.id); break; }
      let p = cur.tagName.toLowerCase();
      const fratelli = cur.parentElement ? Array.from(cur.parentElement.children).filter(function (x) { return x.tagName === cur.tagName; }) : [];
      if (fratelli.length > 1) p += ':nth-of-type(' + (fratelli.indexOf(cur) + 1) + ')';
      parti.unshift(p);
      cur = cur.parentElement;
    }
    return parti.join(' > ');
  }
  return Array.from(document.querySelectorAll('button, input, textarea, [role="button"]'))
    .filter(function (el) {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      const tipo = (el.getAttribute('type') || '').toLowerCase();
      return tipo !== 'hidden' && !el.disabled && r.width > 2 && r.height > 2 && s.display !== 'none' && s.visibility !== 'hidden';
    })
    .slice(0, 40)
    .map(function (el) {
      const tag = el.tagName.toLowerCase();
      const tipo = (el.getAttribute('type') || '').toLowerCase();
      const genere = tipo === 'checkbox' ? 'casella' : tipo === 'radio' ? 'opzione'
        : (tag === 'button' || el.getAttribute('role') === 'button' || tipo === 'submit' || tipo === 'button') ? 'pulsante'
        : (tag === 'textarea' || tag === 'input') ? 'campo' : 'altro';
      return { selettore: selettoreDi(el), genere: genere, testo: (el.textContent || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 40) };
    });
}

// Cio' che una persona vede cambiare, in forma misurabile.
function fotografia() {
  const pulisci = function (t) { return String(t || '').replace(/\s+/g, ' ').trim(); };
  const f = { elenchi: {}, caselle: { totale: 0, spuntate: 0 }, testi: {}, campi: {} };
  Array.from(document.querySelectorAll('ul, ol')).forEach(function (l, i) {
    const nome = l.id ? '#' + l.id : l.tagName.toLowerCase() + ':nth-of-type(' + (i + 1) + ')';
    const figli = Array.from(l.children).slice(0, 6);
    f.elenchi[nome] = {
      voci: l.children.length,
      testi: figli.map(function (x) { return pulisci(x.textContent).slice(0, 30); }),
      spuntate: figli.map(function (x) { const c = x.querySelector('input[type="checkbox"]'); return !!(c && c.checked); })
    };
  });
  document.querySelectorAll('input[type="checkbox"]').forEach(function (c) {
    f.caselle.totale++;
    if (c.checked) f.caselle.spuntate++;
  });
  document.querySelectorAll('[id]').forEach(function (el) {
    if (/^(INPUT|TEXTAREA|SELECT|UL|OL|SCRIPT|STYLE|BUTTON|BODY|HTML|MAIN)$/.test(el.tagName)) return;
    const t = pulisci(el.textContent);
    if (t && t.length <= 60 && el.children.length <= 2) f.testi['#' + el.id] = t;
  });
  document.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]), textarea').forEach(function (el) {
    if (el.id) f.campi['#' + el.id] = el.value;
  });
  return f;
}

// ------------------------------------------------------------- misure

// Le voci di un elenco, con quelle spuntate segnate: senza il segno il modello non capiva che
// dopo "Svuota completati" era rimasta proprio la voce spuntata.
function vociLeggibili(e) {
  return e.testi.map(function (t, i) { return '"' + t + '"' + (e.spuntate && e.spuntate[i] ? ' (spuntata)' : ''); }).join(', ');
}

// Lo stato intero in una riga: elenchi con le loro voci e testi brevi.
function statoLeggibile(f) {
  const parti = [];
  Object.keys(f.elenchi || {}).forEach(function (sel) {
    const e = f.elenchi[sel];
    parti.push(sel + ': ' + e.voci + ' voci' + (e.voci ? ' (' + vociLeggibili(e) + ')' : ''));
  });
  Object.keys(f.testi || {}).slice(0, 6).forEach(function (sel) { parti.push(sel + ': "' + f.testi[sel] + '"'); });
  return parti.join('; ');
}

// Da una fotografia all'altra: righe leggibili, e se un elenco e' cresciuto.
function differenze(a, b) {
  const righe = [];
  let cresciuto = false;
  let cambiato = false;
  const elenchi = Array.from(new Set(Object.keys(a.elenchi || {}).concat(Object.keys(b.elenchi || {}))));
  elenchi.forEach(function (sel) {
    const x = (a.elenchi || {})[sel] || { voci: 0, testi: [] };
    const y = (b.elenchi || {})[sel] || { voci: 0, testi: [] };
    if (x.voci !== y.voci) {
      cambiato = true;
      if (y.voci > x.voci) cresciuto = true;
      righe.push(sel + ': da ' + x.voci + ' a ' + y.voci + ' voci' + (y.voci ? ' (' + vociLeggibili(y) + ')' : ''));
    } else if (JSON.stringify(x.testi) !== JSON.stringify(y.testi) || JSON.stringify(x.spuntate || []) !== JSON.stringify(y.spuntate || [])) {
      cambiato = true;
      righe.push(sel + ': stesse ' + y.voci + ' voci, ma ora ' + vociLeggibili(y));
    } else {
      righe.push(sel + ': resta con ' + y.voci + ' voci');
    }
  });
  const ca = a.caselle || { totale: 0, spuntate: 0 };
  const cb = b.caselle || { totale: 0, spuntate: 0 };
  if (ca.totale !== cb.totale || ca.spuntate !== cb.spuntate) {
    cambiato = true;
    righe.push('caselle spuntate: da ' + ca.spuntate + ' su ' + ca.totale + ' a ' + cb.spuntate + ' su ' + cb.totale);
  }
  Array.from(new Set(Object.keys(a.testi || {}).concat(Object.keys(b.testi || {})))).slice(0, 6).forEach(function (sel) {
    const x = (a.testi || {})[sel];
    const y = (b.testi || {})[sel];
    if (x === y) righe.push(sel + ': resta "' + y + '"');
    else { cambiato = true; righe.push(sel + ': da "' + (x === undefined ? '' : x) + '" a "' + (y === undefined ? '' : y) + '"'); }
  });
  Object.keys(b.campi || {}).forEach(function (sel) {
    const x = (a.campi || {})[sel];
    const y = b.campi[sel];
    if (x !== undefined && x !== y) righe.push('campo ' + sel + ': da "' + x + '" a "' + y + '"');
  });
  return { righe: righe, cresciuto: cresciuto, cambiato: cambiato };
}

// Verifica di una guardia, scritta dallo Studio dallo stato misurato: solo quante voci ha ogni
// elenco (caselle e testi potrebbero fissare un difetto scambiato per giusto).
function verificaDaStato(prima, dopo) {
  return Object.keys(dopo.elenchi).map(function (sel) {
    return "document.querySelectorAll('" + sel + " > *').length === " + dopo.elenchi[sel].voci;
  }).join(' && ');
}

// ------------------------------------------------------------- attese, consenso e confronto

// Via ogni annotazione tra parentesi: il modello, misurato, scrive "uno (barrato)", "uno(barrata)",
// "uno (spuntata)", che non sono il testo della voce.
const pulisciVoce = function (t) {
  return String(t || '').replace(/\([^)]*\)/g, '').replace(/["'«»]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
};
const primoNumero = function (t) { const m = String(t || '').match(/\d+/); return m ? Number(m[0]) : null; };

// Tiene della risposta dell'oracolo solo cio' che si puo' confrontare con la misura: elenchi
// che esistono, e numeri solo per testi che contengono davvero una cifra (un titolo senza
// cifre non e' un contatore). Un'attesa per selettore: il modello a volte ripete un elenco.
function attesaUtile(a, prima, dopo) {
  if (!a || !String(a.promessa || '').trim()) return null;
  const visti = new Set();
  const unaVolta = function (x) { if (visti.has(x.selettore)) return false; visti.add(x.selettore); return true; };
  const elenchi = (Array.isArray(a.elenchi) ? a.elenchi : []).filter(function (e) {
    return e && dopo.elenchi[e.selettore] && Array.isArray(e.voci);
  }).filter(unaVolta).map(function (e) {
    return { selettore: e.selettore, voci: e.voci.map(pulisciVoce).filter(Boolean).slice(0, 8) };
  });
  const numeri = (Array.isArray(a.numeri) ? a.numeri : []).filter(function (n) {
    return n && typeof n.numero === 'number' && n.numero >= 0 && Number.isInteger(n.numero) &&
      (primoNumero(dopo.testi[n.selettore]) !== null || primoNumero(prima.testi[n.selettore]) !== null);
  }).filter(unaVolta).map(function (n) { return { selettore: n.selettore, numero: n.numero }; });
  if (!elenchi.length && !numeri.length) return null;
  return { promessa: String(a.promessa).trim().slice(0, 200), elenchi: elenchi, numeri: numeri };
}

// Consenso campo per campo fra i voti di una prova (attese gia' passate da attesaUtile, o
// null): per ogni elenco e ogni contatore vale il valore dato da almeno 2 voti (o dall'unico
// voto, se ce n'e' uno solo); i campi senza maggioranza cadono. Misurato: scegliere un voto
// intero faceva vincere un'attesa sbagliata quando le promesse erano scritte in modo diverso.
function consenso(attese) {
  const soglia = attese.length === 1 ? 1 : 2;
  const piene = attese.filter(Boolean);
  if (piene.length < soglia) return null;
  const conta = function (mappa, sel, chiave) { mappa[sel] = mappa[sel] || {}; mappa[sel][chiave] = (mappa[sel][chiave] || 0) + 1; };
  const elenchi = {};
  const numeri = {};
  const promesse = {};
  piene.forEach(function (a) {
    promesse[a.promessa] = (promesse[a.promessa] || 0) + 1;
    a.elenchi.forEach(function (e) { conta(elenchi, e.selettore, JSON.stringify(e.voci.slice().sort())); });
    a.numeri.forEach(function (n) { conta(numeri, n.selettore, String(n.numero)); });
  });
  const migliore = function (m) { return Object.keys(m).sort(function (x, y) { return m[y] - m[x]; })[0]; };
  const out = { promessa: migliore(promesse), elenchi: [], numeri: [] };
  Object.keys(elenchi).forEach(function (sel) {
    const k = migliore(elenchi[sel]);
    if (elenchi[sel][k] >= soglia) out.elenchi.push({ selettore: sel, voci: JSON.parse(k) });
  });
  Object.keys(numeri).forEach(function (sel) {
    const k = migliore(numeri[sel]);
    if (numeri[sel][k] >= soglia) out.numeri.push({ selettore: sel, numero: Number(k) });
  });
  return out.elenchi.length || out.numeri.length ? out : null;
}

// L'attesa contro la misura: 'nessuna' (niente da confrontare), 'rispetta' o 'viola', con le
// differenze leggibili.
function confronta(att, dopo) {
  if (!att) return { verdetto: 'nessuna', differenze: [] };
  const diff = [];
  att.elenchi.forEach(function (e) {
    const m = dopo.elenchi[e.selettore];
    const misurate = m.testi.map(pulisciVoce);
    const mancano = e.voci.filter(function (v) { return !misurate.some(function (x) { return x.indexOf(v) !== -1; }); });
    if (m.voci !== e.voci.length || mancano.length) {
      diff.push(e.selettore + ': attese ' + e.voci.length + ' voci' + (e.voci.length ? ' (' + e.voci.map(function (v) { return '"' + v + '"'; }).join(', ') + ')' : '') +
        ', misurate ' + m.voci + (m.voci ? ' (' + vociLeggibili(m) + ')' : ''));
    }
  });
  att.numeri.forEach(function (n) {
    const t = dopo.testi[n.selettore];
    if (primoNumero(t) !== n.numero) diff.push(n.selettore + ': atteso ' + n.numero + ', misurato "' + (t === undefined ? '' : t) + '"');
  });
  return { verdetto: diff.length ? 'viola' : 'rispetta', differenze: diff };
}

// La verifica di una violazione, scritta dallo Studio dall'attesa: vera solo se succede cio'
// che la descrizione promette.
function verificaDaAttesa(att) {
  const parti = [];
  att.elenchi.forEach(function (e) {
    const q = JSON.stringify(e.selettore + ' > *');
    parti.push('document.querySelectorAll(' + q + ').length === ' + e.voci.length);
    if (e.voci.length) {
      parti.push('(v => ' + JSON.stringify(e.voci) + '.every(t => v.some(x => x.includes(t))))' +
        '([...document.querySelectorAll(' + q + ')].map(x => x.textContent.toLowerCase()))');
    }
  });
  att.numeri.forEach(function (n) {
    parti.push("((document.querySelector(" + JSON.stringify(n.selettore) + ") || {}).textContent || '').match(/\\d+/)?.[0] === '" + n.numero + "'");
  });
  let v = parti.join(' && ');
  // Oltre il limite dei collaudi si rinuncia al controllo dei testi, non a quello dei numeri.
  if (v.length > 400) v = parti.filter(function (p) { return p.indexOf('.every(') === -1; }).join(' && ');
  return v;
}

// ------------------------------------------------------------- azioni

async function eseguiPasso(p, testo) {
  const q = collaudatore.leggiPasso(testo);
  if (!q) throw new Error('passo non valido: ' + testo);
  if (q.tipo === 'attendi') return attesa(q.ms);
  if (q.tipo === 'tasto') {
    await p.keyboard.press(q.tasto);
    return attesa(150);
  }
  if (q.tipo !== 'scrivi' && q.tipo !== 'clic') throw new Error('passo non ammesso: ' + testo);
  const pos = await p.evaluate(function (s) {
    const el = document.querySelector(s);
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, q.selettore);
  if (!pos) throw new Error('elemento ' + q.selettore + ' non trovato o nascosto');
  await p.mouse.click(pos.x, pos.y);
  if (q.tipo === 'scrivi') {
    await p.evaluate(function (s) { const el = document.querySelector(s); if (el) { el.focus(); if (el.select) el.select(); } }, q.selettore);
    await p.keyboard.press('Backspace');
    if (q.testo) await p.keyboard.type(q.testo, { delay: 5 });
  } else {
    await attesa(150);
  }
}

// Una prova: pagina appena riaperta, passi di preparazione, poi l'azione misurata.
async function unaProva(p, url, preparazione, azione) {
  await p.goto(url, { waitUntil: 'load', timeout: 15000 });
  await attesa(250);
  for (const s of preparazione) await eseguiPasso(p, s);
  await attesa(200);
  const prima = await p.evaluate(fotografia);
  for (const s of azione) await eseguiPasso(p, s);
  await attesa(350);
  const dopo = await p.evaluate(fotografia);
  return { prima: prima, dopo: dopo, diff: differenze(prima, dopo) };
}

// ------------------------------------------------------------- il modello

// L'oracolo vede lo stato PRIMA e l'azione di ogni prova, mai il DOPO misurato.
function promptAttese(pagina, descrizione, richiesta, prove) {
  return [
    'Sei l\'ORACOLO della descrizione di ' + pagina + '. Per ogni prova ti do lo stato della pagina PRIMA e l\'azione ' +
      'fatta. Tu dici cosa DOVREBBE esserci DOPO secondo la descrizione. Non sai cosa succede davvero, e non importa: ' +
      'conta solo cosa promette la descrizione.',
    '',
    'DESCRIZIONE (e\' la regola):',
    descrizione || '(nessuna descrizione)',
    '',
    'RICHIESTA DELL\'UTENTE: ' + (richiesta || '(nessuna)'),
    '',
    'PROVE (ognuna e\' indipendente e parte SOLO dal suo stato PRIMA):',
    prove.map(function (x, i) {
      return (i + 1) + '. ' + x.racconto + '\n   PRIMA: ' + statoLeggibile(x.prima);
    }).join('\n'),
    '',
    '"(spuntata)" accanto a una voce vuol dire che la sua casella e\' spuntata.',
    'Per ogni prova:',
    '- "promessa": la frase della descrizione che dice cosa fa quell\'azione. "" se la descrizione non ne parla.',
    '- "elenchi": per ogni ELENCO del suo stato PRIMA (quelli con "voci"), i testi delle voci che dovrebbero esserci DOPO (senza "(spuntata)").',
    '- "numeri": per ogni CONTATORE del suo stato PRIMA (un testo con un numero), il numero che dovrebbe mostrare DOPO.',
    'Leggi la descrizione alla lettera: cosa conta ogni contatore, cosa aggiunge o toglie ogni pulsante e ogni tasto.',
    'NON portarti dietro voci o numeri da un\'altra prova: in ogni prova ci sono solo le voci del suo PRIMA, piu\' quelle che l\'azione aggiunge.',
    'Se "promessa" e\' "", lascia "elenchi" e "numeri" vuoti.',
    'Rispondi solo con {"prova1":{"promessa":"...","elenchi":[{"selettore":"#...","voci":["..."]}],' +
      '"numeri":[{"selettore":"#...","numero":0}]}, "prova2":{...}, ...}: una chiave per OGNI prova, da prova1 a prova' + prove.length + '.'
  ].join('\n');
}

function chiediOllama(o) {
  return new Promise(function (resolve) {
    let url;
    try { url = new URL(String(o.baseUrl || 'http://localhost:11434').replace(/\/+$/, '') + '/api/chat'); } catch (e) {
      return resolve({ errore: 'indirizzo non valido' });
    }
    const corpo = JSON.stringify({
      model: o.modello, stream: false, think: false, format: o.schema,
      options: { temperature: typeof o.temperatura === 'number' ? o.temperatura : 0.1, num_predict: 3000 },
      messages: [{ role: 'user', content: o.prompt }]
    });
    const req = (url.protocol === 'https:' ? https : http).request(url, {
      method: 'POST', timeout: o.timeoutMs || 240000,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(corpo) }
    }, function (res) {
      let testo = '';
      res.setEncoding('utf8');
      res.on('data', function (c) { testo += c; });
      res.on('end', function () {
        try {
          const d = JSON.parse(testo);
          if (d.error) return resolve({ errore: String(d.error) });
          resolve({ testo: (d.message && d.message.content) || '' });
        } catch (e) {
          resolve({ errore: 'risposta non valida' });
        }
      });
    });
    req.on('error', function (e) { resolve({ errore: e.message }); });
    req.on('timeout', function () { req.destroy(); resolve({ errore: 'il modello non ha risposto in tempo' }); });
    if (o.segnale) o.segnale.annulla = function () { req.destroy(); };
    req.write(corpo);
    req.end();
  });
}

// ------------------------------------------------------------- esplorazione

function lanciaBrowser(profilo) {
  return puppeteer.launch({
    executablePath: runtime.trovaBrowser(),
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run',
      '--no-default-browser-check', '--user-data-dir=' + profilo]
  });
}

// Le prove, decise in base a cio' che la pagina offre: il primo campo, i pulsanti, e le
// caselle che compaiono dopo aver aggiunto qualcosa.
async function faiLeProve(p, url, avanza) {
  await p.goto(url, { waitUntil: 'load', timeout: 15000 });
  await attesa(250);
  const elementi = await p.evaluate(elementiInterattivi);
  const campo = elementi.find(function (e) { return e.genere === 'campo'; });
  const pulsanti = elementi.filter(function (e) { return e.genere === 'pulsante'; }).slice(0, MAX_PULSANTI);
  const prove = [];
  if (!campo) return { prove: prove, motivo: 'nessun campo di testo da provare' };
  const F = campo.selettore;
  const aggiungi = async function (racconto, preparazione, azione) {
    avanza('Prova ' + (prove.length + 1) + ': ' + racconto);
    try {
      const m = await unaProva(p, url, preparazione, azione);
      prove.push({ racconto: racconto, passi: preparazione.concat(azione), diff: m.diff, prima: m.prima, dopo: m.dopo });
      return m;
    } catch (e) {
      prove.push({ racconto: racconto, passi: preparazione.concat(azione), diff: { righe: ['non eseguibile: ' + e.message], cambiato: false, cresciuto: false }, errore: e.message });
      return null;
    }
  };

  // Come si conferma: Invio e ciascun pulsante, ognuno su una pagina nuova.
  const conInvio = await aggiungi('Pagina appena aperta: scrivo "uno" nel campo ' + F + ' e premo Invio', [], ['scrivi ' + F + ' | uno', 'tasto Enter']);
  let conferma = null;
  for (const b of pulsanti) {
    const m = await aggiungi('Pagina appena aperta: scrivo "due" nel campo ' + F + ' e clicco il pulsante "' + b.testo + '" (' + b.selettore + ')',
      [], ['scrivi ' + F + ' | due', 'clic ' + b.selettore]);
    if (!conferma && m && m.diff.cresciuto) conferma = ['clic ' + b.selettore];
  }
  if (!conferma && conInvio && conInvio.diff.cresciuto) conferma = ['tasto Enter'];
  if (!conferma) return { prove: prove, motivo: 'nessun modo di aggiungere trovato' };

  const dueVoci = ['scrivi ' + F + ' | uno'].concat(conferma, ['scrivi ' + F + ' | due'], conferma);
  await aggiungi('Pagina appena aperta: aggiungo "uno" e poi "due"', [], dueVoci);
  await aggiungi('Pagina appena aperta: provo ad aggiungere una voce vuota', [], ['scrivi ' + F + ' | '].concat(conferma));

  // Le caselle esistono solo dopo aver aggiunto qualcosa.
  await p.goto(url, { waitUntil: 'load', timeout: 15000 });
  for (const s of dueVoci) await eseguiPasso(p, s);
  await attesa(300);
  const dopoDue = await p.evaluate(elementiInterattivi);
  const casella = dopoDue.find(function (e) { return e.genere === 'casella'; });
  const preparazione = casella ? dueVoci.concat(['clic ' + casella.selettore]) : dueVoci;
  if (casella) await aggiungi('Dopo aver aggiunto "uno" e "due", spunto la casella della prima voce', dueVoci, ['clic ' + casella.selettore]);
  const usato = conferma[0];
  for (const b of pulsanti) {
    if ('clic ' + b.selettore === usato) continue;
    await aggiungi('Dopo aver aggiunto "uno" e "due"' + (casella ? ' e spuntato la prima' : '') + ', clicco il pulsante "' + b.testo + '" (' + b.selettore + ')',
      preparazione, ['clic ' + b.selettore]);
  }
  return { prove: prove, conferma: conferma };
}

// Chiave di confronto fra due voti (senza la promessa, che il modello scrive ogni volta in
// modo diverso).
function chiaveAttesa(a) {
  if (!a) return 'nessuna';
  return JSON.stringify([
    a.elenchi.map(function (e) { return [e.selettore, e.voci.slice().sort()]; }).sort(),
    a.numeri.map(function (n) { return [n.selettore, n.numero]; }).sort()
  ]);
}

// I voti dell'oracolo: tutte le prove in un messaggio, in un ordine diverso a ogni voto. Dopo
// 2 voti identici su ogni prova il terzo non cambierebbe niente, e non si chiede.
async function votaAttese(chiedi, prompt, valide, avanza) {
  const attese = valide.map(function () { return []; });
  const risposte = [];
  let errore = null;
  for (let v = 0; v < MAX_VOTI; v++) {
    if (v === 2 && attese.every(function (a) { return chiaveAttesa(a[0]) === chiaveAttesa(a[1]); })) break;
    const ordine = ORDINI[v](valide.length);
    avanza('L\'oracolo legge la descrizione: voto ' + (v + 1) + ' di ' + MAX_VOTI);
    const r = await chiedi({ prompt: prompt(ordine.map(function (i) { return valide[i]; })), schema: schemaAttese(valide.length), temperatura: 0.3 });
    if (r.errore) { errore = r.errore; break; }
    // Le risposte grezze restano nel risultato: senza, un "nessuna" non si sa se viene da una
    // promessa vuota o da selettori che non esistono.
    risposte.push(String(r.testo || '').slice(0, 6000));
    const dati = collaudatore.estraiJson(r.testo) || {};
    ordine.forEach(function (i, pos) {
      attese[i].push(attesaUtile(dati['prova' + (pos + 1)], valide[i].prima, valide[i].dopo));
    });
  }
  return { attese: attese, risposte: risposte, errore: errore };
}

// opzioni: dir, pagina, descrizione, richiesta, baseUrl, modello, progresso, segnale,
// chiedi (per le prove: sostituisce la chiamata al modello).
async function esplora(opzioni) {
  const o = opzioni || {};
  const avanza = typeof o.progresso === 'function' ? function (t) { try { o.progresso(t); } catch (e) {} } : function () {};
  const chiedi = typeof o.chiedi === 'function' ? o.chiedi : function (x) {
    return chiediOllama(Object.assign({ baseUrl: o.baseUrl, modello: o.modello, segnale: o.segnale }, x));
  };
  const esito = { prove: [], percorso: [], difetti: [], collaudi: [], scartati: [], verdetti: [], errore: null };
  const pagina = String(o.pagina || '').replace(/^[\\/]+/, '');
  if (!pagina) esito.errore = 'pagina non indicata';
  else if (!puppeteer || !runtime.trovaBrowser()) esito.errore = 'browser non disponibile';
  if (esito.errore) return esito;

  let server = null;
  let browser = null;
  const profilo = path.join(os.tmpdir(), 'studio-flussi-' + process.pid + '-' + Date.now());
  try {
    const t = await runtime.avviaServerTemporaneo(o.dir);
    server = t.server;
    browser = await lanciaBrowser(profilo);
    const p = await browser.newPage();
    await p.setViewport({ width: 1280, height: 800 });
    const r = await faiLeProve(p, 'http://127.0.0.1:' + t.porta + '/' + pagina, avanza);
    esito.prove = r.prove;
    esito.conferma = r.conferma || null;
    if (r.motivo) esito.errore = r.motivo;
  } catch (e) {
    esito.errore = e.message;
  } finally {
    try { if (browser) await browser.close(); } catch (e) {}
    try { if (server) server.close(); } catch (e) {}
    try { fs.rmSync(profilo, { recursive: true, force: true }); } catch (e) {}
  }
  esito.percorso = esito.prove.map(function (x) { return { passo: x.racconto, dopo: x.diff.righe.join('; ') }; });
  const valide = esito.prove.filter(function (x) { return !x.errore; });
  if (!valide.length) return esito;

  // Senza l'oracolo non si scrive nessun collaudo: una guardia su un comportamento sbagliato
  // proteggerebbe il difetto.
  const v = await votaAttese(chiedi, function (prove) { return promptAttese(pagina, o.descrizione, o.richiesta, prove); }, valide, avanza);
  esito.risposte = v.risposte;
  if (v.errore && !v.attese[0].length) { esito.errore = esito.errore || ('giudizio non riuscito: ' + v.errore); return esito; }

  const candidati = [];
  valide.forEach(function (x, i) {
    const cons = consenso(v.attese[i]);
    const c = confronta(cons, x.dopo);
    const nomeBreve = x.racconto.replace(/^Pagina appena aperta: /, '').replace(/ \([^)]*\)/g, '');
    esito.verdetti.push({ prova: x.racconto, verdetto: c.verdetto, voti: v.attese[i].length, concordi: v.attese[i].filter(Boolean).length, differenze: c.differenze });
    if (c.verdetto === 'viola') {
      const verifica = verificaDaAttesa(cons);
      if (verifica) {
        candidati.push({ tipo: 'violazione', differenze: c.differenze, promessa: cons.promessa,
          collaudo: { nome: ('Come promesso: ' + nomeBreve).slice(0, 90), fonte: '"' + cons.promessa + '"', passi: x.passi.concat(['attendi 300']), verifica: verifica, misura: [] } });
      }
    } else if (c.verdetto === 'rispetta' && x.diff.cresciuto) {
      candidati.push({ tipo: 'guardia',
        collaudo: { nome: ('Funziona: ' + nomeBreve).slice(0, 90), fonte: '(misurato dalla sonda dei flussi)', passi: x.passi.concat(['attendi 300']), verifica: verificaDaStato(x.prima, x.dopo), misura: [] } });
    }
  });
  // Prima le violazioni: se i collaudi superano il tetto, si perdono guardie, non difetti.
  candidati.sort(function (a, b) { return (a.tipo === 'violazione' ? 0 : 1) - (b.tipo === 'violazione' ? 0 : 1); });
  const pulite = collaudatore.normalizzaCollaudi({ collaudi: candidati.map(function (c) { return c.collaudo; }) });
  esito.scartati = pulite.scartati;
  if (!pulite.collaudi.length) return esito;

  // Coerenza con le misure: una guardia deve passare sulla pagina di adesso, una violazione
  // deve fallire. Solo le violazioni confermate diventano "difetti".
  avanza('Controllo che i collaudi dicano cio\' che dichiarano');
  const ec = await eseguiCollaudi({ dir: o.dir, pagina: pagina, collaudi: pulite.collaudi });
  const esiti = {};
  (ec.esiti || []).forEach(function (e) { esiti[e.nome] = e.esito; });
  pulite.collaudi.forEach(function (c) {
    const cand = candidati.find(function (x) { return x.collaudo.nome === c.nome; }) || {};
    const atteso = cand.tipo === 'guardia' ? 'superato' : 'fallito';
    if (esiti[c.nome] !== atteso) {
      esito.scartati.push({ nome: c.nome, motivo: 'non coerente con le misure: doveva risultare ' + atteso + ', e\' ' + (esiti[c.nome] || 'non eseguito') });
      return;
    }
    esito.collaudi.push(Object.assign({}, c, { origine: 'flussi', tipo: cand.tipo }));
    if (cand.tipo === 'violazione') {
      esito.difetti.push({ descrizione: c.nome.replace(/^Come promesso: /, '') + ': ' + cand.differenze.join('; '), promessa: cand.promessa });
    }
  });
  return esito;
}

function descrizioneDelProgetto(dir) {
  const f = ['README.md', 'readme.md', 'README.txt', 'LEGGIMI.md'].map(function (n) { return path.join(dir, n); })
    .find(function (x) { return fs.existsSync(x); });
  if (!f) return '';
  try { return fs.readFileSync(f, 'utf8').slice(0, 3000); } catch (e) { return ''; }
}

module.exports = {
  schemaAttese, esplora, differenze, verificaDaStato, verificaDaAttesa, attesaUtile, consenso, confronta,
  promptAttese, descrizioneDelProgetto
};
