// NotExist Intelligience Studio - Il revisore.
//
// Adam scrive il codice e poi e' anche lui a dire se funziona: come correggersi il compito
// da solo. Visto dal vivo (10/9/2026): lo Studio aveva detto "2 risolti, 0 ancora presenti"
// su un gioco in cui i nemici distrutti restavano in gioco, ne nascevano 30 al secondo e la
// navicella era invulnerabile. La sonda misura difetti generici; quello che il gioco
// PROMETTE ("-20 vita se ti toccano", "+100 punti per alieno") lo sa solo chi legge la
// descrizione.
//
// Il revisore e' un secondo modello con un contesto tutto suo: legge descrizione, richiesta
// dell'utente e codice, e scrive COLLAUDI, prove eseguibili di quelle promesse. Non ha
// strumenti: risponde solo con JSON, quindi non puo' modificare nulla. I collaudi li esegue
// la sonda (eseguiCollaudi), in un browser isolato. Servono due volte:
//   - quelli che falliscono sono difetti misurati da passare ad Adam;
//   - quelli che passano sono capacita' da proteggere: se dopo una modifica non passano
//     piu' e' una REGRESSIONE, cioe' una correzione che ha rotto altro.
//
// Sulla GPU da 8 GB di questa macchina due modelli non stanno in memoria insieme, e due
// generazioni contemporanee si rallentano a vicenda. Il revisore usa quindi lo stesso
// modello di Adam (gia' caricato) in una conversazione separata, e lavora mentre il browser
// prova la pagina: in parallelo alla sonda, mai mentre Adam genera.

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

const MAX_COLLAUDI = 6;          // scritti dal revisore per ogni segnalazione
const MAX_CONSERVATI = 10;       // per pagina, contando le vecchie guardie
const MAX_ATTESE_MS = 10000;     // somma di "attendi" e "tasto" in un collaudo
const BUDGET_CONTESTO = 24000;   // caratteri di descrizione e codice passati al revisore
const CARTELLA_DATI = path.join(__dirname, '..', 'dati', 'collaudi');

// Forma della risposta, imposta a Ollama con "format": il modello non puo' uscirne.
const SCHEMA = {
  type: 'object',
  properties: {
    collaudi: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nome: { type: 'string' },
          fonte: { type: 'string' },
          passi: { type: 'array', items: { type: 'string' } },
          verifica: { type: 'string' },
          misura: { type: 'array', items: { type: 'string' } }
        },
        required: ['nome', 'fonte', 'passi', 'verifica', 'misura']
      }
    }
  },
  required: ['collaudi']
};

// ------------------------------------------------------------- formato dei passi

// Un passo e' una riga di testo, piu' facile da scrivere giusta per un modello piccolo di un
// oggetto con campi facoltativi:
//   "clic #start"  "clic 640 400"  "trascina #handle | #target"  "tasto ArrowLeft 300"
//   "mouse 640 700"  "attendi 500"  "js codice"
function puntoTrascinamento(testo) {
  const t = String(testo || '').trim();
  let m;
  if ((m = t.match(/^(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)$/))) {
    return { tipo: 'coordinate', x: Number(m[1]), y: Number(m[2]) };
  }
  if ((m = t.match(/^(\d+(?:\.\d+)?)\s*%$/))) {
    const percentuale = Number(m[1]);
    if (percentuale >= 0 && percentuale <= 100) return { tipo: 'percentuale', valore: percentuale };
    return null;
  }
  return t ? { tipo: 'selettore', selettore: t } : null;
}

function leggiPasso(testo) {
  const t = String(testo || '').trim();
  let m;
  if ((m = t.match(/^trascina\s+(.+?)\s*\|\s*(.+)$/i))) {
    const origine = puntoTrascinamento(m[1]);
    const destinazione = puntoTrascinamento(m[2]);
    if (!origine || !destinazione || origine.tipo === 'percentuale') return null;
    if (destinazione.tipo === 'percentuale' && origine.tipo !== 'selettore') return null;
    return { tipo: 'trascina', origine: origine, destinazione: destinazione };
  }
  if ((m = t.match(/^clic\s+(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)\s*$/i))) return { tipo: 'clicxy', x: Number(m[1]), y: Number(m[2]) };
  if ((m = t.match(/^clic\s+(.+)$/i))) return { tipo: 'clic', selettore: m[1].trim() };
  if ((m = t.match(/^tasto\s+(\S+)(?:\s+(\d+))?\s*$/i))) return { tipo: 'tasto', tasto: m[1], ms: Math.min(Number(m[2]) || 100, 5000) };
  if ((m = t.match(/^mouse\s+(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)\s*$/i))) return { tipo: 'mouse', x: Number(m[1]), y: Number(m[2]) };
  if ((m = t.match(/^attendi\s+(\d+)/i))) return { tipo: 'attendi', ms: Math.min(Number(m[1]), 5000) };
  // I flussi delle app (moduli, liste) passano dai campi: si scrive davvero, tasto per tasto.
  if ((m = t.match(/^scrivi\s+(.+?)\s*\|\s?([\s\S]*)$/i))) return { tipo: 'scrivi', selettore: m[1].trim(), testo: m[2].slice(0, 300) };
  if ((m = t.match(/^seleziona\s+(.+?)\s*\|\s*(.*)$/i))) return { tipo: 'seleziona', selettore: m[1].trim(), valore: m[2].trim() };
  if ((m = t.match(/^js\s+([\s\S]+)$/i))) return { tipo: 'js', codice: m[1] };
  return null;
}

// Cio' che il modello restituisce, ripulito. Un collaudo con un passo sconosciuto o senza
// verifica si scarta dicendo perche': meglio un collaudo in meno che uno che mente.
function normalizzaCollaudi(dati) {
  const grezzi = dati && Array.isArray(dati.collaudi) ? dati.collaudi : (Array.isArray(dati) ? dati : []);
  const collaudi = [];
  const scartati = [];
  const nomi = new Set();
  grezzi.forEach(function (c) {
    if (!c || typeof c !== 'object') return;
    // « e » delimitano il nome nei fatti: non possono stare dentro il nome.
    const nome = String(c.nome || '').replace(/[«»]/g, '"').replace(/\s+/g, ' ').trim().slice(0, 90);
    const scarta = function (motivo) { scartati.push({ nome: nome || '(senza nome)', motivo: motivo }); };
    if (!nome) return scarta('senza nome');
    if (nomi.has(nome.toLowerCase())) return scarta('nome ripetuto');
    const verifica = String(c.verifica || '').trim().replace(/;+\s*$/, '');
    if (!verifica) return scarta('manca la verifica');
    if (verifica.length > 400) return scarta('verifica troppo lunga');
    if (/\.click\s*\(\s*\)/i.test(verifica)) return scarta('la verifica usa .click(): i clic vanno nei passi, .click() in JS ritorna undefined');
    if (/!\s*isNaN\s*\([^)]*textContent/i.test(verifica)) return scarta('la verifica usa !isNaN su textContent: fallisce se il testo include parole oltre alle cifre');
    const passi = (Array.isArray(c.passi) ? c.passi : [])
      .map(function (p) { return String(p || '').trim(); })
      .filter(Boolean);
    if (passi.length > 14) return scarta('troppi passi');
    const cattivo = passi.find(function (p) { return !leggiPasso(p); });
    if (cattivo) return scarta('passo non riconosciuto: ' + cattivo.slice(0, 60));
    const attese = passi.map(leggiPasso)
      .filter(function (p) { return p.tipo === 'attendi' || p.tipo === 'tasto'; })
      .reduce(function (s, p) { return s + p.ms; }, 0);
    if (attese > MAX_ATTESE_MS) return scarta('attese troppo lunghe (' + attese + ' ms)');
    const misura = (Array.isArray(c.misura) ? c.misura : [])
      .map(function (m) { return String(m || '').trim(); })
      .filter(Boolean)
      .slice(0, 4)
      .map(function (m) { return m.slice(0, 160); });
    nomi.add(nome.toLowerCase());
    collaudi.push({
      nome: nome,
      fonte: String(c.fonte || '').replace(/\s+/g, ' ').trim().slice(0, 200),
      passi: passi.map(function (p) { return p.slice(0, 700); }),
      verifica: verifica,
      misura: misura
    });
  });
  collaudi.slice(MAX_COLLAUDI).forEach(function (c) {
    scartati.push({ nome: c.nome, motivo: 'oltre il massimo di ' + MAX_COLLAUDI });
  });
  return { collaudi: collaudi.slice(0, MAX_COLLAUDI), scartati: scartati };
}

// ------------------------------------------------------------- il modello

function leggiTroncato(file, max) {
  try {
    const t = fs.readFileSync(file, 'utf8');
    return t.length > max ? t.slice(0, max) + '\n[...troncato]' : t;
  } catch (e) {
    return '';
  }
}

// Descrizione, pagina e script locali che la pagina include. Niente CSS: per scrivere un
// collaudo servono le promesse e i nomi delle variabili, e ogni carattere costa tempo.
// extra.mappa: mappa del codice fatta dallo Studio (nomi esatti di funzioni, variabili, id).
// extra.memoria: memoria del progetto (regole e note dell'utente, correzioni gia' verificate).
function contestoDelProgetto(dir, pagina, extra) {
  const radice = path.resolve(dir);
  const parti = [];
  let budget = BUDGET_CONTESTO;
  const aggiungi = function (nome, testo) {
    if (!testo || budget <= 0) return;
    const t = testo.length > budget ? testo.slice(0, budget) + '\n[...troncato]' : testo;
    budget -= t.length;
    parti.push('=== ' + nome + ' ===\n' + t);
  };
  const x = extra || {};
  if (x.mappa) aggiungi('MAPPA DEL CODICE (fatta dallo Studio: nomi esatti)', String(x.mappa).slice(0, 3000));
  if (x.memoria) aggiungi('MEMORIA DEL PROGETTO (regole e note dell\'utente)', String(x.memoria).slice(0, 2500));
  const readme = ['README.md', 'readme.md', 'README.txt', 'LEGGIMI.md', 'leggimi.md']
    .find(function (f) { return fs.existsSync(path.join(radice, f)); });
  if (readme) aggiungi(readme, leggiTroncato(path.join(radice, readme), 5000));
  const html = leggiTroncato(path.join(radice, pagina), 8000);
  if (!html) return '';
  aggiungi(pagina, html);
  // (mappa e memoria stanno prima del codice: sono le parti che il revisore deve usare per i nomi)
  const re = /<script[^>]*\bsrc\s*=\s*["']([^"'?#]+)/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (/^(https?:)?\/\//i.test(m[1])) continue;
    const file = path.resolve(radice, m[1].replace(/^\//, ''));
    if (file.toLowerCase().indexOf(radice.toLowerCase() + path.sep) !== 0) continue;
    aggiungi(m[1], leggiTroncato(file, 18000));
  }
  return parti.join('\n\n');
}

// Un collaudo di flusso per un'app che non e' un gioco: e' il caso che mancava.
const ESEMPIO_FLUSSO = `{"nome":"Due voci aggiunte, una con Invio e una col pulsante, e il contatore sale a 2",` +
  `"fonte":"\\"Premi Aggiungi o Invio; il contatore mostra quante voci restano\\"",` +
  `"passi":["scrivi #campo | pane","tasto Enter","scrivi #campo | latte","clic #aggiungi","attendi 300"],` +
  `"verifica":"document.querySelectorAll('#elenco li').length === 2 && document.getElementById('conta').textContent.indexOf('2') !== -1",` +
  `"misura":["document.querySelectorAll('#elenco li').length","document.getElementById('conta').textContent"]}`;

function promptRevisore(pagina, richiesta, contesto) {
  return [
    'Sei il REVISORE di un progetto web. Non scrivi e non correggi il codice: scrivi COLLAUDI, cioe\' prove ' +
      'automatiche che un browser (finestra 1280x800) eseguira\' sulla pagina ' + pagina + ' per controllare se fa ' +
      'quello che promette.',
    '',
    'Un collaudo e\' un oggetto JSON con:',
    '- "nome": frase breve che dice cosa deve succedere (es. "Un nemico colpito sparisce").',
    '- "fonte": la frase della descrizione o della richiesta dell\'utente da cui nasce, tra virgolette.',
    '- "passi": azioni eseguite in ordine dopo il caricamento della pagina. Ogni passo e\' una stringa:',
    '    "clic <selettore CSS>"  clic vero del mouse al centro dell\'elemento',
    '    "tasto <Tasto> <ms>"    tiene premuto un tasto (es. "tasto ArrowLeft 300", "tasto Space 100")',
    '    "mouse <x> <y>"         muove il mouse a quelle coordinate della finestra',
    '    "trascina <origine> | <destinazione>" trascina il mouse tra selettori/coordinate; per input range: "trascina #volume | 75%"',
    '    "attendi <ms>"          aspetta, al massimo 5000',
    '    "scrivi <selettore CSS> | <testo>"      scrive davvero nel campo, dopo averlo svuotato, come una persona',
    '    "seleziona <selettore CSS> | <valore>"  sceglie una voce di un menu a tendina',
    '    "js <codice>"           esegue JavaScript nella pagina: puo\' chiamare le funzioni e cambiare le variabili ' +
      'globali del codice qui sotto, per creare una situazione precisa',
    '- "verifica": UNA espressione JavaScript che vale true se il comportamento e\' corretto.',
    '- "misura": da 1 a 4 espressioni JavaScript da riportare, per capire cosa e\' successo se la verifica fallisce.',
    '',
    'Regole:',
    '1. Usa SOLO variabili, funzioni e id che esistono nel codice qui sotto: la MAPPA DEL CODICE li elenca. ' +
      'Rispetta le regole scritte nella MEMORIA DEL PROGETTO, se c\'e\'.',
    '2. Ogni collaudo controlla UNA promessa scritta nella descrizione o nella richiesta. Non inventare regole.',
    '3. Il gioco puo\' usare numeri casuali: con "js" crea tu la situazione (per esempio metti un nemico ' +
      'esattamente dove serve) invece di sperare che capiti. Su punti, vita, livelli e conteggi usa confronti ' +
      'robusti (>, <, >=, <=), MAI ===: altri eventi del gioco possono cambiarli nello stesso momento.',
    '4. Crea la CAUSA, non il risultato. Per provare che distruggere un nemico da\' punti metti un proiettile ' +
      'addosso al nemico e lascia che sia il codice del gioco a gestire la collisione; NON scrivere ' +
      '"nemico.vita = 0": i punti il gioco li assegna solo dove gestisce la collisione, e il collaudo fallirebbe ' +
      'anche su un gioco giusto. Per la vita, allo stesso modo, metti il nemico addosso alla nave.',
    '5. Per cio\' che succede durante la partita, prima avvia la partita (clic sul pulsante) e poi crea o ' +
      'muovi le cose: l\'avvio puo\' azzerare le variabili.',
    '6. Un collaudo deve poter fallire: se la verifica sarebbe vera anche senza fare nulla (un valore che e\' ' +
      'gia\' in quell\'intervallo all\'inizio), non serve a niente.',
    '7. Dopo un passo "js" che crea una situazione aspetta che il codice la elabori ("attendi 500").',
    '7b. Per spuntare una casella o scegliere un\'opzione serve "clic" SULLA casella (per esempio "clic #lista li:nth-of-type(1) ' +
      'input"): "tasto Space", "tasto Enter" e "mouse" agiscono solo sull\'elemento che ha il fuoco, e dopo un clic su un ' +
      'pulsante il fuoco non e\' sulla casella.',
    '8. Scrivi da 3 a 6 collaudi: almeno 2 su funzioni di base che devono continuare a funzionare (per esempio ' +
      'che il pulsante avvii il gioco), gli altri sulle promesse piu\' precise (punti, vita, livelli, cosa ' +
      'succede quando due oggetti si toccano) e su cio\' che l\'utente segnala.',
    '9. Almeno un collaudo percorre il FLUSSO principale dall\'inizio alla fine, passo per passo come un utente, ' +
      'e controlla il risultato finale: per un gioco avvia, gioca, perdi e ricomincia; per un modulo o una lista ' +
      'scrivi nei campi, conferma (con il pulsante E con Invio, se la descrizione lo promette), poi usa le altre ' +
      'funzioni sul risultato (spunta, cancella, filtra) e controlla cosa resta. I difetti di flusso non danno ' +
      'errori: si vedono solo arrivando in fondo.',
    '',
    'Esempi, per ALTRI progetti con altri nomi (non copiare i nomi):',
    '{"collaudi":[' +
      '{"nome":"Il pulsante Gioca avvia la partita","fonte":"\\"Premi Gioca per iniziare\\"",' +
      '"passi":["clic #play","attendi 500"],"verifica":"inGioco === true","misura":["inGioco"]},' +
      '{"nome":"Un asteroide che tocca la nave toglie una vita","fonte":"\\"Perdi una vita se un asteroide ti colpisce\\"",' +
      '"passi":["clic #play","attendi 300","js asteroidi = [{x: nave.x, y: nave.y, r: 20}]","attendi 500"],' +
      '"verifica":"vite < 3","misura":["vite","asteroidi.length"]},' +
      '{"nome":"Colpire un asteroide da\' punti","fonte":"\\"10 punti per ogni asteroide distrutto\\"",' +
      '"passi":["clic #play","attendi 300","js asteroidi = [{x: 300, y: 200, r: 20}]; colpi.push({x: 300, y: 205})","attendi 500"],' +
      '"verifica":"punti >= 10","misura":["punti","asteroidi.length","colpi.length"]},' + ESEMPIO_FLUSSO + ']}',
    '',
    'RICHIESTA DELL\'UTENTE:',
    String(richiesta || '(nessuna richiesta specifica: collauda le promesse della descrizione)').slice(0, 2000),
    '',
    'DESCRIZIONE E CODICE DEL PROGETTO:',
    contesto,
    '',
    'Rispondi solo con il JSON dei collaudi.'
  ].join('\n');
}

// Chiamata diretta a Ollama (/api/chat), in streaming per poter dire a che punto e'.
// Nessuno strumento, formato JSON imposto, ragionamento spento: con il ragionamento acceso
// qwen3.5 pensa per migliaia di token anche su richieste semplici.
function chiediAlModello(o) {
  return new Promise(function (resolve) {
    let url;
    try {
      url = new URL(String(o.baseUrl || 'http://localhost:11434').replace(/\/+$/, '') + '/api/chat');
    } catch (e) {
      return resolve({ testo: '', errore: 'indirizzo del modello non valido' });
    }
    const richiesta = {
      model: o.modello,
      stream: true,
      format: o.schema,
      options: { temperature: 0.2, num_predict: 3000 },
      messages: [{ role: 'user', content: o.prompt }]
    };
    if (!o.conPensiero) richiesta.think = false;
    const corpo = JSON.stringify(richiesta);
    const lib = url.protocol === 'https:' ? https : http;
    const inizio = Date.now();
    let testo = '';
    let resto = '';
    let finito = false;
    let timer = null;
    let req = null;
    const fine = function (esito) {
      if (finito) return;
      finito = true;
      clearTimeout(timer);
      resolve(Object.assign({ testo: testo, durataMs: Date.now() - inizio }, esito || {}));
    };
    req = lib.request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(corpo) }
    }, function (res) {
      res.setEncoding('utf8');
      if (res.statusCode !== 200) {
        let err = '';
        res.on('data', function (c) { err += c; });
        res.on('end', function () { fine({ errore: 'il modello ha risposto ' + res.statusCode + ': ' + err.slice(0, 200) }); });
        return;
      }
      res.on('data', function (pezzo) {
        resto += pezzo;
        let i;
        while ((i = resto.indexOf('\n')) !== -1) {
          const riga = resto.slice(0, i).trim();
          resto = resto.slice(i + 1);
          if (!riga) continue;
          let d;
          try { d = JSON.parse(riga); } catch (e) { continue; }
          if (d.error) return fine({ errore: String(d.error) });
          if (d.message && d.message.content) {
            testo += d.message.content;
            if (o.progresso) o.progresso(testo.length);
          }
          if (d.done) return fine({ token: d.eval_count || 0 });
        }
      });
      res.on('end', function () { fine({}); });
      res.on('error', function (e) { fine({ errore: e.message }); });
    });
    req.on('error', function (e) { fine({ errore: e.message }); });
    timer = setTimeout(function () {
      req.destroy();
      fine({ errore: 'il revisore non ha finito entro ' + Math.round(o.timeoutMs / 1000) + ' s' });
    }, o.timeoutMs || 300000);
    if (o.segnale) o.segnale.annulla = function () { req.destroy(); fine({ errore: 'annullato' }); };
    req.write(corpo);
    req.end();
  });
}

// Se il modello risponde con testo attorno al JSON, si prende l'oggetto piu' esterno.
function estraiJson(testo) {
  const t = String(testo || '');
  try { return JSON.parse(t); } catch (e) { /* si prova sotto */ }
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a === -1 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { return null; }
}

// Seconda passata: i collaudi che il browser non ha potuto usare tornano al revisore con il
// motivo misurato. Lo strumento si costruisce, si prova, e si corregge con il risultato.
function promptCorrezione(pagina, contesto, daCorreggere) {
  return [
    'Sei il REVISORE. Hai scritto dei collaudi per ' + pagina + ', ma questi non si possono usare: lo Studio li ha ' +
      'eseguiti in un browser e per ognuno c\'e\' il motivo MISURATO.',
    '',
    daCorreggere.map(function (d, i) {
      return (i + 1) + '. ' + JSON.stringify(d.collaudo) + '\n   MOTIVO: ' + d.motivo;
    }).join('\n'),
    '',
    'Riscrivili correggendo solo cio\' che il motivo indica, con lo stesso nome e lo stesso scopo:',
    '- un elemento che "non esiste" o "non e\' visibile": usa un selettore che c\'e\' davvero nel codice qui sotto, ' +
      'e se l\'elemento compare solo dopo un\'azione (per esempio una voce aggiunta) fai prima quell\'azione;',
    '- una variabile o una funzione "is not defined": usa i nomi esatti del codice;',
    '- una verifica "vera anche senza eseguire i passi": riscrivila in modo che dipenda da cio\' che i passi fanno;',
    '- un risultato "che dipende dal caso": crea tu la situazione con "js" invece di sperare che capiti.',
    'Se uno scopo non si puo\' verificare, omettilo. Passi ammessi: clic, trascina, tasto, mouse, attendi, js, ' +
      '"scrivi <selettore> | <testo>", "seleziona <selettore> | <valore>".',
    'Stesso formato: {"collaudi":[{"nome","fonte","passi","verifica","misura"}]}.',
    '',
    'DESCRIZIONE E CODICE DEL PROGETTO:',
    contesto,
    '',
    'Rispondi solo con il JSON.'
  ].join('\n');
}

// Terza passata: GIUDIZIO. Un collaudo che fallisce puo' essere un difetto vero o un collaudo
// sbagliato. Visto dal vivo (lista della spesa, 11/9/2026): 3 collaudi falliti su 6 erano
// sbagliati (uno pretendeva un contatore solo numerico contro la descrizione, due "spuntavano"
// una casella muovendo il mouse), il primo e' diventato il focus e Adam ha rovinato il
// contatore per accontentarlo, lasciando i difetti veri. Prima di passarli ad Adam, il
// revisore -- in una conversazione nuova, senza aver scritto lui quei collaudi -- confronta ogni
// fallimento con la DESCRIZIONE e con le misure.
const SCHEMA_GIUDIZIO = {
  type: 'object',
  properties: {
    giudizi: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nome: { type: 'string' },
          verdetto: { type: 'string', enum: ['difetto', 'collaudo sbagliato'] },
          motivo: { type: 'string' }
        },
        required: ['nome', 'verdetto', 'motivo']
      }
    }
  },
  required: ['giudizi']
};

function promptGiudizio(pagina, richiesta, contesto, falliti) {
  return [
    'Sei un GIUDICE imparziale. Alcuni collaudi automatici sulla pagina ' + pagina + ' sono falliti in un browser vero. ' +
      'Un collaudo fallito vuol dire una di due cose: la pagina ha un DIFETTO (non fa cio\' che la descrizione ' +
      'promette), oppure il COLLAUDO E\' SBAGLIATO (pretende qualcosa che la descrizione non dice, o i suoi passi ' +
      'non fanno davvero cio\' che il nome dice).',
    '',
    falliti.map(function (f, i) {
      const c = f.collaudo || {};
      const e = f.esito || {};
      const misure = Object.keys(e.misure || {}).map(function (k) { return k + ' = ' + String(e.misure[k]).slice(0, 100); }).join('; ');
      return (i + 1) + '. NOME: ' + c.nome + '\n   PASSI: ' + (c.passi || []).join(' | ') + '\n   VERIFICA: ' + c.verifica +
        '\n   MISURATO: ' + (misure || '(nulla)') + (e.errori && e.errori.length ? '\n   ERRORI: ' + e.errori.join(' | ') : '') +
        (c.fonte ? '\n   FONTE DICHIARATA: ' + c.fonte : '');
    }).join('\n'),
    '',
    'Criteri:',
    '- La regola e\' la DESCRIZIONE (README) e la richiesta dell\'utente, NON cio\' che il codice fa oggi: il codice qui ' +
      'sotto serve solo per controllare che nomi e selettori esistano.',
    '- Se la verifica pretende un formato o un comportamento diverso da quello promesso dalla descrizione, e\' ' +
      '"collaudo sbagliato".',
    '- Controlla i passi: "mouse x y" sposta soltanto il puntatore e non clicca; "trascina" tiene premuto il mouse ' +
      'mentre si muove; per premere o scegliere servono "clic", "scrivi", "seleziona". Se i passi non possono produrre cio\' che la verifica controlla, e\' ' +
      '"collaudo sbagliato".',
    '- Se i passi fanno davvero cio\' che il nome dice, la verifica rispecchia la descrizione e le misure mostrano che ' +
      'la pagina non lo fa, e\' "difetto".',
    '',
    'RICHIESTA DELL\'UTENTE: ' + String(richiesta || '(nessuna)').slice(0, 1000),
    '',
    'DESCRIZIONE E CODICE DEL PROGETTO:',
    contesto,
    '',
    'Rispondi solo con {"giudizi":[{"nome":"...","verdetto":"difetto" oppure "collaudo sbagliato","motivo":"una riga"}]}, ' +
      'un giudizio per ogni collaudo, con il nome esatto.'
  ].join('\n');
}

// opzioni: dir, pagina, richiesta, falliti: [{ collaudo, esito }], baseUrl, modello, mappa,
// memoria, progresso, segnale. Restituisce { giudizi: { nome: { verdetto, motivo } } }.
async function giudicaCollaudi(opzioni) {
  const o = opzioni || {};
  if (!o.falliti || !o.falliti.length) return { giudizi: {} };
  if (!o.modello) return { giudizi: {}, errore: 'nessun modello configurato' };
  const contesto = contestoDelProgetto(o.dir, o.pagina, { mappa: o.mappa, memoria: o.memoria });
  if (!contesto) return { giudizi: {}, errore: o.pagina + ' non leggibile' };
  const avanza = typeof o.progresso === 'function' ? function (t) { try { o.progresso(t); } catch (e) {} } : function () {};
  const prompt = promptGiudizio(o.pagina, o.richiesta, contesto, o.falliti);
  const chiedi = function (conPensiero) {
    return chiediAlModello({
      baseUrl: o.baseUrl, modello: o.modello, prompt: prompt, schema: SCHEMA_GIUDIZIO,
      timeoutMs: o.timeoutMs || 300000, segnale: o.segnale, conPensiero: conPensiero,
      progresso: function (n) { avanza('Il revisore giudica i collaudi falliti: ' + n + ' caratteri'); }
    });
  };
  let r = await chiedi(false);
  if (r.errore && /think/i.test(r.errore)) r = await chiedi(true);
  if (r.errore) return { giudizi: {}, errore: r.errore };
  const dati = estraiJson(r.testo);
  if (!dati || !Array.isArray(dati.giudizi)) return { giudizi: {}, errore: 'la risposta del giudizio non e\' JSON valido' };
  // Solo giudizi su collaudi che c'erano davvero, riconosciuti dal nome (maiuscole a parte).
  const perNome = {};
  o.falliti.forEach(function (f) { perNome[String(f.collaudo && f.collaudo.nome).toLowerCase()] = f.collaudo.nome; });
  const giudizi = {};
  dati.giudizi.forEach(function (g) {
    const nome = perNome[String(g && g.nome).replace(/[«»]/g, '"').trim().toLowerCase()];
    if (!nome || (g.verdetto !== 'difetto' && g.verdetto !== 'collaudo sbagliato')) return;
    giudizi[nome] = { verdetto: g.verdetto, motivo: String(g.motivo || '').replace(/\s+/g, ' ').trim().slice(0, 240) };
  });
  return { giudizi: giudizi, durataMs: r.durataMs };
}

async function chiediCollaudi(o, prompt, etichetta) {
  const avanza = typeof o.progresso === 'function'
    ? function (t) { try { o.progresso(t); } catch (e) {} }
    : function () {};
  const chiedi = function (conPensiero) {
    return chiediAlModello({
      baseUrl: o.baseUrl, modello: o.modello, prompt: prompt, schema: SCHEMA,
      timeoutMs: o.timeoutMs || 300000, segnale: o.segnale, conPensiero: conPensiero,
      progresso: function (n) { avanza(etichetta + ': ' + n + ' caratteri'); }
    });
  };
  let r = await chiedi(false);
  // Un modello senza ragionamento puo' rifiutare il parametro "think": si riprova senza.
  if (r.errore && /think/i.test(r.errore)) r = await chiedi(true);
  if (r.errore) return { collaudi: [], scartati: [], errore: r.errore, durataMs: r.durataMs };
  const dati = estraiJson(r.testo);
  if (!dati) return { collaudi: [], scartati: [], errore: 'la risposta del revisore non e\' JSON valido', durataMs: r.durataMs };
  const n = normalizzaCollaudi(dati);
  return { collaudi: n.collaudi, scartati: n.scartati, durataMs: r.durataMs, token: r.token || 0, modello: o.modello };
}

// opzioni: come scriviCollaudi, piu' daCorreggere: [{ collaudo, motivo }]
async function correggiCollaudi(opzioni) {
  const o = opzioni || {};
  if (!o.daCorreggere || !o.daCorreggere.length) return { collaudi: [], scartati: [] };
  if (!o.modello) return { collaudi: [], scartati: [], errore: 'nessun modello configurato' };
  const contesto = contestoDelProgetto(o.dir, o.pagina, { mappa: o.mappa, memoria: o.memoria });
  if (!contesto) return { collaudi: [], scartati: [], errore: o.pagina + ' non leggibile' };
  const r = await chiediCollaudi(o, promptCorrezione(o.pagina, contesto, o.daCorreggere), 'Il revisore corregge i collaudi');
  // Solo correzioni: al massimo quanti erano da correggere, niente collaudi nuovi in piu'.
  if (r.collaudi) r.collaudi = r.collaudi.slice(0, o.daCorreggere.length);
  return r;
}

// opzioni: dir, pagina, richiesta, baseUrl, modello, progresso(testo), segnale, timeoutMs
async function scriviCollaudi(opzioni) {
  const o = opzioni || {};
  const avanza = typeof o.progresso === 'function'
    ? function (t) { try { o.progresso(t); } catch (e) {} }
    : function () {};
  if (!o.modello) return { collaudi: [], scartati: [], errore: 'nessun modello configurato' };
  const contesto = contestoDelProgetto(o.dir, o.pagina, { mappa: o.mappa, memoria: o.memoria });
  if (!contesto) return { collaudi: [], scartati: [], errore: o.pagina + ' non leggibile' };
  const prompt = promptRevisore(o.pagina, o.richiesta, contesto);
  avanza('Il revisore legge descrizione e codice (' + Math.round(prompt.length / 1000) + 'k caratteri)');
  return chiediCollaudi(o, prompt, 'Il revisore scrive i collaudi');
}

// ------------------------------------------------------------- esiti e fatti

function testoFatto(tipo, e, c) {
  const misure = Object.keys(e.misure || {})
    .map(function (k) { return k + ' = ' + String(e.misure[k]).slice(0, 80); })
    .join(', ');
  const pezzi = [];
  if (tipo === 'regressione') {
    pezzi.push('Regressione «' + e.nome + '»: prima delle ultime modifiche questo collaudo passava, ora no.');
  } else {
    pezzi.push('Collaudo fallito «' + e.nome + '»:');
  }
  pezzi.push(e.causa === 'elemento' ? e.motivo + '.' : 'atteso che ' + (c ? c.verifica : '?') + ', ma e\' falso.');
  if (misure) pezzi.push('Misurato: ' + misure + '.');
  if (e.errori && e.errori.length) pezzi.push('Errori durante la prova: ' + e.errori.slice(0, 2).join(' | ') + '.');
  if (e.fonte) pezzi.push('Dalla descrizione: ' + e.fonte);
  if (c && c.passi && c.passi.length) pezzi.push('Passi del collaudo: ' + c.passi.join('; ').slice(0, 400) + '.');
  if (tipo === 'regressione') {
    pezzi.push('Una correzione non deve togliere cio\' che funzionava: ripristina questo comportamento.');
  } else {
    // Visto dal vivo: per accontentare un collaudo sbagliato Adam ha rovinato un contatore giusto.
    pezzi.push('Se questo collaudo pretende qualcosa che la descrizione non dice, non modificare il progetto per ' +
      'soddisfarlo: spiegalo.');
  }
  return pezzi.join(' ');
}

// esiti: dalla sonda. precedenti: { nome: 'superato' | 'fallito' } della misura di riferimento.
// Un collaudo senza storia che non si puo' eseguire, o che dipende dal caso, o che clicca
// un elemento inesistente, e' quasi sempre un errore del revisore: si scarta. Con una storia,
// la stessa cosa dopo una modifica non dimostra niente e resta "non provato" -- tranne un
// elemento sparito da un collaudo che passava, che e' una funzione tolta.
function fattiDaiCollaudi(esiti, precedenti, collaudi) {
  const perNome = {};
  (collaudi || []).forEach(function (c) { perNome[c.nome] = c; });
  const out = { falliti: [], regressioni: [], superati: [], nonProvati: [], scartati: [] };
  (esiti || []).forEach(function (e) {
    const prima = precedenti ? precedenti[e.nome] : undefined;
    const c = perNome[e.nome];
    if (e.esito === 'superato') {
      out.superati.push(e.nome);
    } else if (e.esito === 'fallito') {
      if (prima === 'superato') out.regressioni.push(testoFatto('regressione', e, c));
      else if (!prima && e.causa === 'elemento') out.scartati.push({ nome: e.nome, motivo: e.motivo });
      else out.falliti.push(testoFatto('fallito', e, c));
    } else if (!prima) {
      out.scartati.push({ nome: e.nome, motivo: e.motivo || e.esito });
    } else {
      out.nonProvati.push(e.nome);
    }
  });
  return out;
}

// ------------------------------------------------------------- conservazione

// I collaudi stanno nella cartella dello Studio, non in quella del progetto: Adam li
// vedrebbe con Glob e potrebbe "correggerli" invece di correggere il gioco.
function fileCollaudi(dir, pagina, cartella) {
  const chiave = crypto.createHash('sha1')
    .update(path.resolve(dir).toLowerCase() + '|' + String(pagina).toLowerCase())
    .digest('hex').slice(0, 16);
  return path.join(cartella || CARTELLA_DATI, chiave + '.json');
}

function caricaCollaudi(dir, pagina, cartella) {
  const vuoto = { dir: path.resolve(dir), pagina: pagina, collaudi: [], esiti: {}, ritirati: [], validati: {}, aggiornato: null };
  try {
    const d = JSON.parse(fs.readFileSync(fileCollaudi(dir, pagina, cartella), 'utf8'));
    return Object.assign(vuoto, d, {
      collaudi: Array.isArray(d.collaudi) ? d.collaudi : [],
      esiti: d.esiti && typeof d.esiti === 'object' ? d.esiti : {},
      ritirati: Array.isArray(d.ritirati) ? d.ritirati : [],
      validati: d.validati && typeof d.validati === 'object' ? d.validati : {}
    });
  } catch (e) {
    return vuoto;
  }
}

function salvaCollaudi(stato, cartella) {
  const file = fileCollaudi(stato.dir, stato.pagina, cartella);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  stato.aggiornato = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(stato, null, 2));
}

function attivi(stato) {
  const ritirati = new Set(((stato && stato.ritirati) || []).map(function (n) { return n.toLowerCase(); }));
  return ((stato && stato.collaudi) || []).filter(function (c) { return !ritirati.has(c.nome.toLowerCase()); });
}

// Le capacita' da proteggere: collaudi che hanno gia' dimostrato di passare.
function guardie(stato) {
  return attivi(stato).filter(function (c) { return stato.esiti[c.nome] === 'superato'; });
}

// I nuovi (scritti adesso, per questa richiesta) vincono sui vecchi con lo stesso nome; dei
// vecchi restano solo le guardie: proteggono cio' che funzionava gia'.
function unisciCollaudi(stato, nuovi) {
  const nomiNuovi = new Set((nuovi || []).map(function (c) { return c.nome.toLowerCase(); }));
  const vecchie = guardie(stato).filter(function (c) { return !nomiNuovi.has(c.nome.toLowerCase()); });
  const collaudi = (nuovi || []).concat(vecchie).slice(0, MAX_CONSERVATI);
  const esiti = {};
  const validati = {};
  collaudi.forEach(function (c) {
    if (nomiNuovi.has(c.nome.toLowerCase())) return;
    if (stato.esiti[c.nome]) esiti[c.nome] = stato.esiti[c.nome];
    if (stato.validati && stato.validati[c.nome]) validati[c.nome] = stato.validati[c.nome];
  });
  return Object.assign({}, stato, { collaudi: collaudi, esiti: esiti, validati: validati });
}

// Prima/dopo: un collaudo che falliva sulla versione rotta e ora passa (confermato due
// volte e non vuoto: vedi eseguiCollaudi) e' VALIDATO. Distingue davvero il gioco rotto da
// quello corretto, quindi e' la guardia di cui fidarsi di piu'.
function segnaValidati(stato, riferimento, esiti) {
  stato.validati = stato.validati || {};
  (esiti || []).forEach(function (e) {
    if (e.esito === 'superato' && riferimento && riferimento[e.nome] === 'fallito' && !stato.validati[e.nome]) {
      stato.validati[e.nome] = new Date().toISOString();
    }
  });
  return stato;
}

// Dopo un'esecuzione. Una guardia che fallisce resta 'superato' come riferimento: e' cio'
// che deve tornare vero, e la regressione viene segnalata finche' non si risolve o
// l'utente non ritira il collaudo. I collaudi inutilizzabili senza storia si tolgono.
function registraEsiti(stato, esiti) {
  const rimuovi = new Set();
  (esiti || []).forEach(function (e) {
    const prima = stato.esiti[e.nome];
    if (e.esito === 'superato') stato.esiti[e.nome] = 'superato';
    else if (e.esito === 'fallito') {
      if (!prima && e.causa === 'elemento') rimuovi.add(e.nome);
      else if (prima !== 'superato') stato.esiti[e.nome] = 'fallito';
    } else if (!prima) {
      rimuovi.add(e.nome);
    }
  });
  stato.collaudi = stato.collaudi.filter(function (c) { return !rimuovi.has(c.nome); });
  rimuovi.forEach(function (n) { delete stato.esiti[n]; });
  return stato;
}

function ritira(stato, nome) {
  if (!nome) return stato;
  if (stato.ritirati.map(function (n) { return n.toLowerCase(); }).indexOf(String(nome).toLowerCase()) === -1) {
    stato.ritirati.push(String(nome));
  }
  return stato;
}

module.exports = {
  SCHEMA,
  MAX_COLLAUDI,
  CARTELLA_DATI,
  leggiPasso,
  normalizzaCollaudi,
  contestoDelProgetto,
  promptRevisore,
  chiediAlModello,
  estraiJson,
  scriviCollaudi,
  promptCorrezione,
  correggiCollaudi,
  promptGiudizio,
  giudicaCollaudi,
  testoFatto,
  fattiDaiCollaudi,
  fileCollaudi,
  caricaCollaudi,
  salvaCollaudi,
  attivi,
  guardie,
  unisciCollaudi,
  segnaValidati,
  registraEsiti,
  ritira
};
