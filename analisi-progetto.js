// NotExist Intelligience Studio - Analisi dell'intero progetto.
//
// La verifica automatica controlla solo i file toccati nel turno, e solo la sintassi.
// Un file puo' compilare perfettamente ed essere comunque rotto: e' successo davvero
// con un gioco in cui il canvas copriva il pulsante di avvio. Questo modulo aggiunge
// i controlli INCROCIATI fra file, che sono quelli che trovano i bug veri.
//
// Nessuna dipendenza esterna: analisi testuale, volutamente conservativa. Meglio
// non segnalare un problema dubbio che riempire l'utente di falsi allarmi.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const CARTELLE_IGNORATE = new Set([
  'node_modules', '.git', '.svn', 'dist', 'build', '__pycache__',
  '.venv', 'venv', '.next', 'coverage', '.backup-originali',
  'library', 'Library', 'temp', 'Temp', 'obj', 'Obj', 'logs', 'Logs', 'usersettings', 'UserSettings'
]);

const MAX_FILE = 400;          // limite di sicurezza su progetti enormi
const MAX_BYTE_FILE = 2000000; // oltre questa soglia il file non viene analizzato

function elencaFile(radice) {
  const risultato = [];

  function scendi(cartella, profondita) {
    if (profondita > 8 || risultato.length >= MAX_FILE) return;
    let voci;
    try {
      voci = fs.readdirSync(cartella, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const voce of voci) {
      if (risultato.length >= MAX_FILE) return;
      const completo = path.join(cartella, voce.name);
      if (voce.isDirectory()) {
        if (CARTELLE_IGNORATE.has(voce.name) || voce.name.startsWith('.')) continue;
        scendi(completo, profondita + 1);
      } else if (voce.isFile()) {
        try {
          if (fs.statSync(completo).size <= MAX_BYTE_FILE) risultato.push(completo);
        } catch (e) {}
      }
    }
  }

  scendi(radice, 0);
  return risultato;
}

function leggi(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    return '';
  }
}

// ---------------------------------------------------------------- sintassi

function controllaSintassi(file, cwd) {
  return new Promise(function (resolve) {
    const ext = path.extname(file).toLowerCase();

    if (ext === '.json') {
      try {
        JSON.parse(leggi(file));
        return resolve(null);
      } catch (e) {
        return resolve({ file, tipo: 'sintassi', messaggio: 'JSON non valido: ' + e.message });
      }
    }

    let comando = null;
    let argomenti = null;
    if (['.js', '.mjs', '.cjs'].indexOf(ext) !== -1) {
      comando = process.execPath;
      argomenti = ['--check', file];
    } else if (ext === '.py') {
      comando = 'python';
      argomenti = ['-m', 'py_compile', file];
    } else {
      return resolve(null);
    }

    execFile(comando, argomenti, { timeout: 30000, cwd }, function (err, stdout, stderr) {
      if (!err) return resolve(null);
      const testo = (String(stderr || '') + String(stdout || '')).trim();
      resolve({ file, tipo: 'sintassi', messaggio: testo.slice(0, 900) || err.message });
    });
  });
}

// ------------------------------------------------- riferimenti fra file

// Risorse locali citate da un HTML: <link href>, <script src>, <img src>.
// Gli URL assoluti e i data: vengono ignorati, non sono file del progetto.
function risorseCitate(html) {
  const trovate = [];
  const schemi = [
    /<link[^>]+href\s*=\s*["']([^"']+)["']/gi,
    /<script[^>]+src\s*=\s*["']([^"']+)["']/gi,
    /<img[^>]+src\s*=\s*["']([^"']+)["']/gi
  ];
  schemi.forEach(function (re) {
    let m;
    while ((m = re.exec(html)) !== null) {
      const rif = m[1].trim();
      if (!rif) continue;
      if (/^(https?:)?\/\//i.test(rif) || rif.startsWith('data:') || rif.startsWith('#')) continue;
      trovate.push(rif.split('?')[0].split('#')[0]);
    }
  });
  return trovate;
}

function idDichiarati(html) {
  const insieme = new Set();
  let m;
  const re = /\sid\s*=\s*["']([^"']+)["']/gi;
  while ((m = re.exec(html)) !== null) insieme.add(m[1].trim());
  return insieme;
}

// Elementi cercati dal codice: getElementById e querySelector('#id').
function idCercati(js) {
  const trovati = [];
  let m;
  const reId = /getElementById\(\s*["']([^"']+)["']\s*\)/g;
  while ((m = reId.exec(js)) !== null) trovati.push(m[1]);
  const reSel = /querySelector(?:All)?\(\s*["']#([A-Za-z][\w-]*)["']\s*\)/g;
  while ((m = reSel.exec(js)) !== null) trovati.push(m[1]);
  return trovati;
}

// Funzioni invocate dagli attributi inline: onclick="avvia()".
function funzioniInline(html) {
  const trovate = [];
  let m;
  const re = /\son[a-z]+\s*=\s*["']\s*([A-Za-z_$][\w$]*)\s*\(/gi;
  while ((m = re.exec(html)) !== null) trovate.push(m[1]);
  return trovate;
}

function definisceFunzione(js, nome) {
  const escapato = nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    '(function\\s+' + escapato + '\\s*\\()' +
    '|((?:const|let|var)\\s+' + escapato + '\\s*=)' +
    '|(window\\.' + escapato + '\\s*=)' +
    '|(\\b' + escapato + '\\s*=\\s*(?:async\\s*)?(?:function|\\())'
  ).test(js);
}

function analizzaRiferimenti(file, cwd) {
  const problemi = [];
  const html = file.filter(function (f) { return /\.html?$/i.test(f); });
  const script = file.filter(function (f) { return /\.(js|mjs|cjs)$/i.test(f); });

  const tuttoIlJs = script.map(leggi).join('\n');
  const tuttiGliId = new Set();
  html.forEach(function (h) {
    idDichiarati(leggi(h)).forEach(function (id) { tuttiGliId.add(id); });
  });

  // 1. Risorse citate dall'HTML che non esistono su disco.
  html.forEach(function (h) {
    const contenuto = leggi(h);
    const base = path.dirname(h);
    risorseCitate(contenuto).forEach(function (rif) {
      const atteso = path.resolve(base, rif);
      if (!fs.existsSync(atteso)) {
        problemi.push({
          file: h,
          tipo: 'riferimento',
          messaggio: 'Risorsa citata ma inesistente: "' + rif + '" (attesa in ' + atteso + ')'
        });
      }
    });

    // 2. Funzioni chiamate da attributi inline ma mai definite.
    const definiteQui = contenuto;
    funzioniInline(contenuto).forEach(function (nome) {
      if (!definisceFunzione(tuttoIlJs, nome) && !definisceFunzione(definiteQui, nome)) {
        problemi.push({
          file: h,
          tipo: 'riferimento',
          messaggio: 'L\'attributo inline chiama "' + nome + '()" ma la funzione non e\' definita in nessun file JavaScript del progetto.'
        });
      }
    });
  });

  // 3. Elementi cercati dal JavaScript che nessun HTML dichiara.
  //    Solo se il progetto contiene almeno un HTML: altrimenti gli id possono
  //    arrivare da pagine esterne e la segnalazione sarebbe un falso allarme.
  if (html.length > 0) {
    script.forEach(function (s) {
      const contenuto = leggi(s);
      const visti = new Set();
      idCercati(contenuto).forEach(function (id) {
        if (visti.has(id) || tuttiGliId.has(id)) return;
        visti.add(id);
        problemi.push({
          file: s,
          tipo: 'riferimento',
          messaggio: 'Il codice cerca l\'elemento con id "' + id + '" ma nessun HTML del progetto lo dichiara.'
        });
      });
    });
  }

  // 4. Import o require di file locali che non esistono.
  script.forEach(function (s) {
    const contenuto = leggi(s);
    const base = path.dirname(s);
    const re = /(?:require\(\s*|from\s+|import\s+)["'](\.[^"']+)["']/g;
    let m;
    while ((m = re.exec(contenuto)) !== null) {
      const rif = m[1];
      const candidati = [rif, rif + '.js', rif + '.json', path.join(rif, 'index.js')];
      const esiste = candidati.some(function (c) {
        try { return fs.existsSync(path.resolve(base, c)); } catch (e) { return false; }
      });
      if (!esiste) {
        problemi.push({
          file: s,
          tipo: 'riferimento',
          messaggio: 'Import di un file locale inesistente: "' + rif + '"'
        });
      }
    }
  });

  return problemi;
}

// ---------------------------------------------------------------- analisi

async function analizzaProgetto(radice) {
  const inizio = Date.now();
  const file = elencaFile(radice);
  const problemi = [];

  for (const f of file) {
    const esito = await controllaSintassi(f, radice);
    if (esito) problemi.push(esito);
  }

  analizzaRiferimenti(file, radice).forEach(function (p) { problemi.push(p); });

  return {
    radice,
    elenco: file,          // serve a riassumere la struttura nella memoria
    fileEsaminati: file.length,
    troncato: file.length >= MAX_FILE,
    durataMs: Date.now() - inizio,
    problemi
  };
}

module.exports = { analizzaProgetto, elencaFile };

// ============================================================
// MAPPA DEL CODICE
// Non basta sapere che i file esistono: serve sapere COSA contengono e COME si
// collegano. Questo estrae, per ogni file, le sue variabili e funzioni, e ricava
// i collegamenti verso gli altri file (import, id usati, funzioni chiamate).
// Il risultato alimenta sia la memoria di Adam sia il diagramma nella UI.
// ============================================================

// Toglie commenti e stringhe lasciando intatti gli a-capo, cosi' le espressioni
// regolari sui simboli non scambiano testo o esempi per codice eseguibile.
function mascheraJs(codice) {
  let stato = 'codice';
  let uscita = '';
  let escapato = false;
  let dentroClasseRegex = false;

  for (let i = 0; i < codice.length; i++) {
    const c = codice[i];
    const dopo = codice[i + 1];

    if (stato === 'linea') {
      if (c === '\n') { stato = 'codice'; uscita += '\n'; }
      else uscita += ' ';
      continue;
    }
    if (stato === 'blocco') {
      if (c === '*' && dopo === '/') { uscita += '  '; i++; stato = 'codice'; }
      else uscita += c === '\n' ? '\n' : ' ';
      continue;
    }
    if (stato === 'stringa' || stato === 'template') {
      if (c === '\n') { uscita += '\n'; escapato = false; continue; }
      uscita += ' ';
      if (escapato) { escapato = false; continue; }
      if (c === '\\') { escapato = true; continue; }
      if ((stato === 'stringa' && c === virgolette) || (stato === 'template' && c === '`')) {
        stato = 'codice';
      }
      continue;
    }
    if (stato === 'regex') {
      if (c === '\n') { uscita += '\n'; stato = 'codice'; escapato = false; dentroClasseRegex = false; continue; }
      uscita += ' ';
      if (escapato) { escapato = false; continue; }
      if (c === '\\') { escapato = true; continue; }
      if (c === '[') dentroClasseRegex = true;
      else if (c === ']') dentroClasseRegex = false;
      else if (c === '/' && !dentroClasseRegex) {
        stato = 'codice';
        while (/[a-z]/i.test(codice[i + 1] || '')) { uscita += ' '; i++; }
      }
      continue;
    }

    if (c === '/' && dopo === '/') { uscita += '  '; i++; stato = 'linea'; continue; }
    if (c === '/' && dopo === '*') { uscita += '  '; i++; stato = 'blocco'; continue; }
    if (c === '/') {
      const significativo = uscita.trimEnd();
      const ultimo = significativo.slice(-1);
      const parola = significativo.match(/[A-Za-z_$][\w$]*$/);
      const puoEssereRegex = !significativo || '=(:,!&|?{;['.indexOf(ultimo) !== -1 ||
        /^(?:return|throw|case|delete|void|typeof|instanceof|in|of|yield|await|else|do)$/.test(parola ? parola[0] : '');
      if (puoEssereRegex) { uscita += ' '; stato = 'regex'; escapato = false; dentroClasseRegex = false; continue; }
    }
    if (c === '"' || c === "'") { var virgolette = c; uscita += ' '; stato = 'stringa'; escapato = false; continue; }
    if (c === '`') { uscita += ' '; stato = 'template'; escapato = false; continue; }
    // Una graffa escapata in una regex letterale non apre un blocco JS.
    if (c === '\\' && dopo) { uscita += '  '; i++; continue; }
    uscita += c;
  }

  return uscita;
}

// Dichiarazioni di primo livello: ignora le variabili locali dentro blocchi e
// funzioni, senza affidarsi al numero di spazi usato per indentare il file.
function simboliJs(codice) {
  const variabili = [];
  const funzioni = [];
  const codiceVisibile = mascheraJs(codice);
  const righe = codiceVisibile.split('\n');
  let profondita = 0;

  righe.forEach(function (riga) {
    if (profondita === 0) {
      let m = riga.match(/^\s*(?:(?:export|declare)\s+)*(?:default\s+)?(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)/);
      if (m) funzioni.push(m[1]);
      else {
        m = riga.match(/^\s*(?:(?:export|declare)\s+)*(?:default\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/);
        if (m) {
          const dopo = riga.slice(riga.indexOf('=') + 1).trim();
          if (/^(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/.test(dopo)) funzioni.push(m[1]);
          else variabili.push(m[1]);
        } else {
          m = riga.match(/^\s*(?:(?:export|declare)\s+)*(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/);
          if (m) variabili.push(m[1]);
          else {
            m = riga.match(/^\s*(?:window|globalThis)\.([A-Za-z_$][\w$]*)\s*=/);
            if (m) variabili.push(m[1]);
          }
        }
      }
    }

    for (let i = 0; i < riga.length; i++) {
      if (riga[i] === '{') profondita++;
      else if (riga[i] === '}') profondita = Math.max(0, profondita - 1);
    }
  });

  // Include anche le API CommonJS assegnate direttamente a exports.nome.
  const reExportDiretto = /\b(?:module\s*\.\s*exports|exports)\s*\.\s*([A-Za-z_$][\w$]*)\s*=/g;
  let esportato;
  while ((esportato = reExportDiretto.exec(codiceVisibile)) !== null) {
    const resto = codiceVisibile.slice(reExportDiretto.lastIndex).trimStart();
    if (/^(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/.test(resto)) funzioni.push(esportato[1]);
    else variabili.push(esportato[1]);
  }

  return {
    variabili: Array.from(new Set(variabili)),
    funzioni: Array.from(new Set(funzioni))
  };
}

function importLocali(codice) {
  const trovati = [];
  const mascherato = mascheraJs(codice);
  const re = /(?:require\(\s*|from\s+|import\s*\(?\s*)["'](\.[^"']+)["']/g;
  let m;
  while ((m = re.exec(codice)) !== null) {
    if (/\b(?:require|from|import)\b/.test(mascherato.slice(m.index, m.index + m[0].length))) trovati.push(m[1]);
  }
  return Array.from(new Set(trovati));
}

function importConSimboli(codice) {
  const riferimenti = [];
  let codiceUsi = codice;
  const mascherato = mascheraJs(codice);
  const dichiarazioneDefault = mascherato.match(/\bexport\s+default\s+(?:async\s+)?(?:function\s*\*?\s+|class\s+)([A-Za-z_$][\w$]*)|\bexport\s+default\s+([A-Za-z_$][\w$]*)\b|\bmodule\s*\.\s*exports\s*=\s*([A-Za-z_$][\w$]*)\b/);
  const defaultEsportato = dichiarazioneDefault && (dichiarazioneDefault[1] || dichiarazioneDefault[2] || dichiarazioneDefault[3]);
  const reImport = /\bimport\s+([\s\S]*?)\s+from\s*(['"])(\.[^'"]+)\2\s*;?/g;
  let m;
  while ((m = reImport.exec(codice)) !== null) {
    if (!/\bimport\b/.test(mascherato.slice(m.index, m.index + m[0].length))) continue;
    const specifica = m[1].trim();
    const fonte = m[3];
    const parti = specifica.split(',');
    const nomi = [];
    if (parti[0] && !parti[0].trim().startsWith('{') && !parti[0].trim().startsWith('*')) {
      nomi.push({ locale: parti[0].trim(), importato: 'default' });
    }
    const stelle = specifica.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
    if (stelle) nomi.push({ locale: stelle[1], importato: null, namespace: true });
    const graffe = specifica.match(/\{([^}]*)\}/);
    if (graffe) {
      graffe[1].split(',').forEach(function (parte) {
        const campi = parte.trim().split(/\s+as\s+/);
        if (!campi[0]) return;
        nomi.push({ locale: (campi[1] || campi[0]).trim(), importato: campi[0].trim() });
      });
    }
    nomi.forEach(function (n) { riferimenti.push(Object.assign({ fonte: fonte }, n)); });
    codiceUsi = codiceUsi.split(m[0]).join(' ');
  }

  const reRequire = /\b(?:const|let|var)\s+(?:\{([^}]*)\}|([A-Za-z_$][\w$]*))\s*=\s*require\(\s*(['"])(\.[^'"]+)\3\s*\)\s*;?/g;
  while ((m = reRequire.exec(codice)) !== null) {
    if (!/\brequire\b/.test(mascherato.slice(m.index, m.index + m[0].length))) continue;
    const fonte = m[4];
    if (m[1]) {
      m[1].split(',').forEach(function (parte) {
        const campi = parte.trim().split(/\s*:\s*|\s+as\s+/);
        if (!campi[0]) return;
        riferimenti.push({ fonte: fonte, locale: (campi[1] || campi[0]).trim(), importato: campi[0].trim() });
      });
    } else {
      riferimenti.push({ fonte: fonte, locale: m[2], importato: null, namespace: true });
    }
    codiceUsi = codiceUsi.split(m[0]).join(' ');
  }

  return { riferimenti: riferimenti, usi: mascheraJs(codiceUsi), defaultEsportato: defaultEsportato || null };
}

function escapeRegExp(testo) {
  return String(testo).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function risorseCss(css) {
  const trovate = [];
  const re = /@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?/gi;
  let m;
  while ((m = re.exec(css)) !== null) {
    const rif = m[1].trim();
    if (rif && !/^(https?:)?\/\//i.test(rif) && !rif.startsWith('data:')) trovate.push(rif);
  }
  return Array.from(new Set(trovate));
}

function mappaCodice(radice) {
  const file = elencaFile(radice).filter(function (f) {
    return /\.(js|mjs|cjs|html?|css|py|json|cs)$/i.test(f);
  });

  const dettagliJs = new Map();
  const schede = file.map(function (f) {
    const contenuto = leggi(f);
    const ext = path.extname(f).toLowerCase();
    const scheda = {
      percorso: f,
      nome: path.relative(radice, f),
      tipo: ext.replace('.', ''),
      righe: contenuto.split('\n').length,
      variabili: [],
      funzioni: [],
      importa: [],
      usaId: [],
      dichiaraId: [],
      chiama: []
    };

    if (/\.(js|mjs|cjs)$/i.test(f)) {
      const s = simboliJs(contenuto);
      scheda.variabili = s.variabili;
      scheda.funzioni = s.funzioni;
      scheda.importa = importLocali(contenuto);
      scheda.usaId = Array.from(new Set(idCercati(contenuto)));
      dettagliJs.set(scheda.nome, importConSimboli(contenuto));
    } else if (/\.html?$/i.test(f)) {
      scheda.dichiaraId = Array.from(idDichiarati(contenuto));
      scheda.importa = risorseCitate(contenuto);
      scheda.chiama = Array.from(new Set(funzioniInline(contenuto)));
    } else if (/\.css$/i.test(f)) {
      scheda.importa = risorseCss(contenuto);
    } else if (/\.cs$/i.test(f)) {
      const righe = contenuto.split('\n');
      righe.forEach(function (r) {
        const mCls = r.match(/\bclass\s+([A-Za-z0-9_]+)/);
        if (mCls) scheda.variabili.push('class ' + mCls[1]);
        const mFn = r.match(/(?:public|private|protected|internal|void|int|float|bool|string)\s+([A-Za-z0-9_]+)\s*\(/);
        if (mFn && !['if', 'for', 'while', 'switch'].includes(mFn[1])) scheda.funzioni.push(mFn[1]);
        const mUs = r.match(/^using\s+([A-Za-z0-9_.]+);/);
        if (mUs) scheda.importa.push(mUs[1]);
      });
    }

    return scheda;
  });

  // Collegamenti fra file, con il MOTIVO: e' il motivo che rende leggibile un
  // diagramma, non la freccia in se'.
  const collegamenti = [];
  const schedaPerPercorso = new Map();
  schede.forEach(function (s) {
    let chiave = path.normalize(path.resolve(s.percorso));
    if (process.platform === 'win32') chiave = chiave.toLowerCase();
    schedaPerPercorso.set(chiave, s);
  });

  function trova(daScheda, riferimento) {
    const pulito = String(riferimento || '').split(/[?#]/)[0].replace(/[\\/]/g, path.sep);
    if (!pulito) return null;
    const base = path.isAbsolute(pulito) ? radice : path.dirname(daScheda.percorso);
    const rel = path.isAbsolute(pulito) ? pulito.replace(/^[\\/]+/, '') : pulito;
    const candidati = [rel];
    if (!path.extname(rel)) {
      ['.js', '.mjs', '.cjs', '.json', '.html', '.htm', '.css', '.py', '.cs'].forEach(function (ext) {
        candidati.push(rel + ext);
      });
      ['index.js', 'index.mjs', 'index.cjs', 'index.html'].forEach(function (index) {
        candidati.push(path.join(rel, index));
      });
    }
    for (const c of candidati) {
      const assoluto = path.resolve(base, c);
      let chiave = path.normalize(assoluto);
      if (process.platform === 'win32') chiave = chiave.toLowerCase();
      const trovata = schedaPerPercorso.get(chiave);
      if (trovata) return trovata;
    }
    return null;
  }

  function aggiungiCollegamento(da, a, motivo) {
    if (!da || !a || collegamenti.some(function (c) {
      return c.da === da && c.a === a && c.motivo === motivo;
    })) return;
    collegamenti.push({ da: da, a: a, motivo: motivo });
  }

  schede.forEach(function (s) {
    s.importa.forEach(function (rif) {
      const bersaglio = trova(s, rif);
      if (bersaglio) aggiungiCollegamento(s.nome, bersaglio.nome, 'include');
    });

    // Gli import nominati collegano anche il simbolo usato al file che lo dichiara.
    // I riferimenti non risolti restano collegati come include, senza inventare bersagli.
    const info = dettagliJs.get(s.nome);
    if (info) {
      info.riferimenti.forEach(function (r) {
        const bersaglio = trova(s, r.fonte);
        if (!bersaglio) return;
        if (r.namespace) {
          const re = new RegExp('\\b' + escapeRegExp(r.locale) + '\\s*\\.\\s*([A-Za-z_$][\\w$]*)', 'g');
          let uso;
          while ((uso = re.exec(info.usi)) !== null) {
            const nome = uso[1];
            const fn = bersaglio.funzioni.indexOf(nome) !== -1;
            const variabile = bersaglio.variabili.indexOf(nome) !== -1;
            if (fn || variabile) aggiungiCollegamento(s.nome, bersaglio.nome,
              (fn ? 'usa funzione ' : 'usa variabile ') + nome + (fn ? '()' : ''));
          }
          return;
        }
        const locale = new RegExp('\\b' + escapeRegExp(r.locale) + '\\b');
        if (!locale.test(info.usi)) return;
        const datiBersaglio = dettagliJs.get(bersaglio.nome);
        const nome = r.importato === 'default'
          ? (datiBersaglio && datiBersaglio.defaultEsportato)
          : (r.importato || r.locale);
        if (!nome) return;
        const fn = bersaglio.funzioni.indexOf(nome) !== -1;
        const variabile = bersaglio.variabili.indexOf(nome) !== -1;
        if (fn || variabile) aggiungiCollegamento(s.nome, bersaglio.nome,
          (fn ? 'usa funzione ' : 'usa variabile ') + nome + (fn ? '()' : ''));
      });
    }

    // Un JS che cerca un id dichiarato in un HTML dipende da quell'HTML.
    s.usaId.forEach(function (id) {
      schede.forEach(function (altro) {
        if (altro !== s && altro.dichiaraId.indexOf(id) !== -1) {
          aggiungiCollegamento(s.nome, altro.nome, 'usa #' + id);
        }
      });
    });

    // Un HTML che chiama una funzione definita in un JS dipende da quel JS.
    s.chiama.forEach(function (fn) {
      schede.forEach(function (altro) {
        if (altro !== s && altro.funzioni.indexOf(fn) !== -1) {
          aggiungiCollegamento(s.nome, altro.nome, 'chiama ' + fn + '()');
        }
      });
    });
  });

  return { radice, schede, collegamenti };
}

module.exports.mappaCodice = mappaCodice;
module.exports.simboliJs = simboliJs;
