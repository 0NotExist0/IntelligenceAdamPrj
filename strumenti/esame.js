// NotExist Intelligience Studio - Esame del modello, prima e dopo un cambio di regole.
//
// Le regole dell'utente entrano nel prompt di Adam (strumenti/regole.js). Una regola scritta
// male puo' peggiorare il modello anche dove non c'entra: "rispondi sempre in una parola"
// rovina le spiegazioni sul codice. Prima di adottarle si fa un esame con correzione
// automatica, con le regole di adesso e con quelle nuove: matematica, lettura del codice, uso
// degli strumenti, piu' le prove che l'utente scrive per le sue regole. Si adotta solo se
// nessuna risposta che prima era giusta diventa sbagliata.
//
// Onesta' sui limiti: l'esame parla con Ollama direttamente, con il prompt dello Studio ma
// senza quello (lunghissimo) di Claude Code, e con temperatura 0. Misura l'effetto delle
// regole, non riproduce ogni turno di Adam.

const http = require('http');
const https = require('https');
const regole = require('./regole');

const DOMANDE = [
  { id: 'mat-molt', area: 'matematica', domanda: 'Quanto fa 17 × 23? Rispondi solo con il numero.', giusta: /\b391\b/ },
  { id: 'mat-sconto', area: 'matematica', domanda: 'Un prodotto costa 80 euro ed e\' scontato del 25%. Quanto costa dopo lo sconto? Rispondi solo con il numero.', giusta: /\b60\b/ },
  { id: 'mat-eq', area: 'matematica', domanda: 'Se 3x + 5 = 20, quanto vale x? Rispondi solo con il numero.', giusta: /(^|[^\d])5([^\d]|$)/ },
  { id: 'mat-perc', area: 'matematica', domanda: 'Quanto e\' il 15% di 240? Rispondi solo con il numero.', giusta: /\b36\b/ },
  { id: 'cod-js', area: 'codice', domanda: 'Cosa stampa questo JavaScript? console.log([1, 2, 3].map(n => n * 2).join(\'-\'))  Rispondi solo con l\'output.', giusta: /2-4-6/ },
  { id: 'cod-py', area: 'codice', domanda: 'Cosa stampa questo Python? print(len(\'ciao mondo\'))  Rispondi solo con l\'output.', giusta: /\b10\b/ },
  { id: 'cod-null', area: 'codice', domanda: 'In JavaScript, cosa restituisce typeof null? Rispondi solo con la stringa.', giusta: /object/i },
  { id: 'cod-bug', area: 'codice', domanda: 'Questa funzione deve restituire la somma di tutti gli elementi, ma sbaglia: function somma(a) { let s = 0; for (let i = 1; i < a.length; i++) s += a[i]; return s; }  Qual e\' l\'errore? Rispondi in una riga.', giusta: /(i\s*=\s*0|primo elemento|indice 0|parte da 1|salta|a\[0\])/i },
  { id: 'str-leggi', area: 'strumenti', domanda: 'Leggi il file config.json e dimmi cosa contiene.', strumento: 'leggi_file', argomento: /config\.json/ }
];

const STRUMENTO = {
  name: 'leggi_file',
  description: 'Legge un file di testo del progetto e ne restituisce il contenuto.',
  input_schema: { type: 'object', properties: { percorso: { type: 'string', description: 'percorso del file' } }, required: ['percorso'] }
};

function sistema(elenco) {
  return ['Ti chiami Adam. Sei un assistente di programmazione. Rispondi in italiano.', regole.testoRegole(elenco)]
    .filter(Boolean).join('\n\n');
}

function chiediMessaggio(o) {
  return new Promise(function (resolve) {
    let url;
    try { url = new URL(String(o.baseUrl || 'http://localhost:11434').replace(/\/+$/, '') + '/v1/messages'); } catch (e) {
      return resolve({ errore: 'indirizzo non valido' });
    }
    const corpo = JSON.stringify(Object.assign({
      model: o.modello,
      max_tokens: 400,
      temperature: 0,
      thinking: { type: 'disabled' },
      system: o.sistema,
      messages: [{ role: 'user', content: o.domanda }]
    }, o.strumenti ? { tools: o.strumenti } : {}));
    const req = (url.protocol === 'https:' ? https : http).request(url, {
      method: 'POST',
      timeout: o.timeoutMs || 180000,
      headers: {
        'content-type': 'application/json', 'content-length': Buffer.byteLength(corpo),
        'x-api-key': 'ollama', 'anthropic-version': '2023-06-01'
      }
    }, function (res) {
      let testo = '';
      res.setEncoding('utf8');
      res.on('data', function (c) { testo += c; });
      res.on('end', function () {
        try {
          const d = JSON.parse(testo);
          if (res.statusCode !== 200) return resolve({ errore: (d.error && (d.error.message || d.error)) || 'stato ' + res.statusCode });
          resolve({ contenuto: d.content || [], stop: d.stop_reason });
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

function testoDi(risposta) {
  return (risposta.contenuto || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join(' ').trim();
}

function corretta(d, risposta) {
  if (risposta.errore) return false;
  if (d.strumento) {
    return (risposta.contenuto || []).some(function (b) {
      return b.type === 'tool_use' && b.name === d.strumento && d.argomento.test(JSON.stringify(b.input || {}));
    });
  }
  const t = testoDi(risposta);
  if (d.giusta) return d.giusta.test(t);
  const minuscolo = t.toLowerCase();
  if (d.contiene && minuscolo.indexOf(d.contiene.toLowerCase()) === -1) return false;
  if (d.nonContiene && minuscolo.indexOf(d.nonContiene.toLowerCase()) !== -1) return false;
  return true;
}

// Le prove scritte dall'utente per le sue regole diventano domande dell'esame.
function domandeDelleRegole(elenco) {
  return (elenco || []).filter(function (r) { return r.prova; }).map(function (r, i) {
    return { id: 'regola-' + (i + 1), area: 'regole', regola: r.testo, domanda: r.prova.domanda,
      contiene: r.prova.contiene, nonContiene: r.prova.nonContiene };
  });
}

// opzioni: baseUrl, modello, regole (quelle da mettere nel prompt), prove (regole con le
// prove da controllare: di solito le nuove), progresso(testo), segnale
async function faiEsame(opzioni) {
  const o = opzioni || {};
  const avanza = typeof o.progresso === 'function' ? function (t) { try { o.progresso(t); } catch (e) {} } : function () {};
  const domande = DOMANDE.concat(domandeDelleRegole(o.prove || o.regole));
  const sis = sistema(o.regole);
  const risposte = [];
  for (let i = 0; i < domande.length; i++) {
    const d = domande[i];
    avanza('Domanda ' + (i + 1) + '/' + domande.length + ' (' + d.area + ')');
    const chiedi = function () {
      return chiediMessaggio({ baseUrl: o.baseUrl, modello: o.modello, sistema: sis, domanda: d.domanda,
        strumenti: d.strumento ? [STRUMENTO] : null, segnale: o.segnale, timeoutMs: o.timeoutMs });
    };
    let r = await chiedi();
    if (r.errore && /annull|ECONNRESET|socket hang up/i.test(r.errore) && o.segnale && o.segnale.annullato) break;
    let ok = corretta(d, r);
    // Un errore isolato puo' essere un caso: si riprova una volta prima di crederci.
    if (!ok && !r.errore) {
      r = await chiedi();
      ok = corretta(d, r);
    }
    risposte.push({ id: d.id, area: d.area, regola: d.regola || '', giusta: ok,
      testo: r.errore ? 'errore: ' + r.errore : (testoDi(r) || (r.stop === 'tool_use' ? '[usa lo strumento]' : '')).slice(0, 200) });
  }
  return { risposte: risposte, punti: risposte.filter(function (x) { return x.giusta; }).length, totale: risposte.length };
}

// Si adotta solo se nulla di cio' che era giusto diventa sbagliato, e se le prove delle
// regole passano con le regole nuove.
function decidi(prima, dopo) {
  const giustePrima = {};
  (prima.risposte || []).forEach(function (r) { if (r.giusta) giustePrima[r.id] = true; });
  const peggiorate = (dopo.risposte || []).filter(function (r) { return r.area !== 'regole' && giustePrima[r.id] && !r.giusta; });
  const regoleNonSeguite = (dopo.risposte || []).filter(function (r) { return r.area === 'regole' && !r.giusta; });
  const erroriModello = (dopo.risposte || []).filter(function (r) { return /^errore:/.test(r.testo); });
  const motivi = [];
  peggiorate.forEach(function (r) { motivi.push('Con le regole nuove sbaglia (' + r.area + ', ' + r.id + '): "' + r.testo + '"'); });
  regoleNonSeguite.forEach(function (r) { motivi.push('La regola "' + r.regola + '" non viene seguita: "' + r.testo + '"'); });
  if (erroriModello.length) motivi.push(erroriModello.length + ' domande senza risposta dal modello: esame non affidabile');
  return { adotta: motivi.length === 0, motivi: motivi, peggiorate: peggiorate.length, regoleNonSeguite: regoleNonSeguite.length };
}

module.exports = { DOMANDE, sistema, corretta, domandeDelleRegole, faiEsame, decidi, chiediMessaggio };
