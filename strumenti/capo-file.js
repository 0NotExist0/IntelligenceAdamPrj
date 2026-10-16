// NotExist Intelligience Studio - Il capo progetto per file (file grossi a sezioni).
//
// Richiesta dell'utente (19/9/2026): "serve una modifica, per i file grossi è un problema,
// servirebbe un capo progetto 'per file' per i progetti grossi senza retrocedere o rompere il codice".
//
// Perché esiste:
// Un modello piccolo (come Adam 9B o modelli con memoria limitata) su un file da 1000-3000+ righe
// (es. blendergame/main.js, server.js) fallisce per due motivi:
// 1. Se legge tutto il file esplode il contesto (Read rifiutato dal guardiano o compattazione immediata).
// 2. Se fa una modifica a memoria rischia di rompere funzioni e variabili di sezioni vicine.
//
// Questo strumento seziona i file grossi leggendo i commenti strutturali (// --- Titolo ---,
// // ── Titolo ──, // === Titolo ===, # --- Titolo ---) o i blocchi logici.
// Fornisce ad Adam:
// - La mappa compatta delle sezioni (--sezioni)
// - L'estrazione di UNA sola sezione con numeri di riga (--sezione)
// - L'indicazione di dove si trova un simbolo e quali sezioni NON toccare (--guarda)

const fs = require('fs');
const path = require('path');

const SOGLIA_FILE_GROSSO = 300; // righe minime per considerare un file "grosso"

function slash(p) {
  return String(p || '').split('\\').join('/');
}

function leggiFile(percorso) {
  try {
    return fs.readFileSync(percorso, 'utf8');
  } catch (e) {
    return null;
  }
}

// Pulisce il titolo di una sezione togliendo decorazioni e trattini
function pulisciTitolo(raw) {
  if (!raw) return '';
  let t = String(raw).trim();
  // Rimuovi commenti iniziali e finali
  t = t.replace(/^\/\/\s*/, '')
       .replace(/^#\s*/, '')
       .replace(/^\/\*+\s*/, '')
       .replace(/\s*\*+\/$/, '');
  // Rimuovi caratteri di delimitazione ripetuti (=, -, _, ─, ~, *)
  t = t.replace(/^[-=─_~*#]{2,}\s*/, '')
       .replace(/\s*[-=─_~*#]{2,}$/, '');
  // Rimuovi prefissi tipo "SECTION:", "SEZIONE:", "MODULE:"
  t = t.replace(/^(?:SECTION|SEZIONE|MODULO|MODULE)\s*:\s*/i, '');
  t = t.trim();
  return t;
}

// Verifica se una riga è un header di sezione
function matchIntestazione(riga) {
  const trim = riga.trim();
  if (!trim) return null;

  // 1. Box style o separatore puro: solo trattini/uguali/box (es. // ---------------------- o // =================)
  if (/^(\/\/|#|\/\*)\s*[-=─_~*]{4,}\s*(\*\/)?$/.test(trim)) {
    return { tipo: 'separatore' };
  }

  // 2. Commento con titolo tra delimitatori:
  // es: // --- Canvas & Renderer ---
  // es: // ── CAPO PROGETTO ──────────────────────
  // es: // === Zombie AI ===
  // es: # --- Terrain Generation ---
  // es: /* --- Physics Loop --- */
  const m1 = /^(\/\/|#|\/\*+)\s*[-=─_~*]{2,}\s*(.+?)\s*[-=─_~*]{0,}\s*(\*+\/)?$/.exec(trim);
  if (m1 && m1[2]) {
    const pulito = pulisciTitolo(m1[2]);
    if (pulito.length >= 2 && !/^[-=─_~*]+$/.test(pulito)) {
      return { tipo: 'sezione', titolo: pulito };
    }
  }

  // 3. Commento con prefisso SECTION / SEZIONE:
  const m2 = /^(\/\/|#)\s*(?:SECTION|SEZIONE|MODULO|MODULE)\s*:\s*(.+)$/i.exec(trim);
  if (m2 && m2[2]) {
    const pulito = pulisciTitolo(m2[2]);
    if (pulito.length >= 2) {
      return { tipo: 'sezione', titolo: pulito };
    }
  }

  return null;
}

// Estrae funzioni e variabili principali con regex veloce per dare contesto
function estraiSimboliRiga(riga) {
  const simboli = [];
  // function nome(...)
  const mFunc = /\bfunction\s+([a-zA-Z0-9_$]+)\s*\(/g;
  let m;
  while ((m = mFunc.exec(riga)) !== null) {
    simboli.push({ tipo: 'funzione', nome: m[1] });
  }
  // const/let/var nome = ...
  const mVar = /\b(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=/g;
  while ((m = mVar.exec(riga)) !== null) {
    simboli.push({ tipo: 'variabile', nome: m[1] });
  }
  // class Nome
  const mClass = /\bclass\s+([a-zA-Z0-9_$]+)\b/g;
  while ((m = mClass.exec(riga)) !== null) {
    simboli.push({ tipo: 'classe', nome: m[1] });
  }
  // def nome(...): per python
  const mDef = /\bdef\s+([a-zA-Z0-9_$]+)\s*\(/g;
  while ((m = mDef.exec(riga)) !== null) {
    simboli.push({ tipo: 'funzione', nome: m[1] });
  }
  return simboli;
}

// Rileva le sezioni di un testo
function rilevaSezioni(testo, opzioni) {
  opzioni = opzioni || {};
  const righe = String(testo || '').split(/\r?\n/);
  const totali = righe.length;
  if (!totali) return [];

  const trovate = [];
  let ultimoSeparatoreRiga = -1;

  for (let i = 0; i < totali; i++) {
    const numRiga = i + 1;
    const riga = righe[i];
    const match = matchIntestazione(riga);

    if (match) {
      if (match.tipo === 'separatore') {
        ultimoSeparatoreRiga = numRiga;
        continue;
      }
      if (match.tipo === 'sezione') {
        // Se c'era un separatore subito prima (entro 2 righe), l'inizio effettivo della sezione comprende il banner
        const inizio = (ultimoSeparatoreRiga > 0 && numRiga - ultimoSeparatoreRiga <= 2)
          ? ultimoSeparatoreRiga
          : numRiga;

        trovate.push({
          titolo: match.titolo,
          rigaInizio: inizio,
          rigaIntestazione: numRiga
        });
      }
    }
  }

  // Se non sono state trovate abbastanza sezioni o nessuna:
  // per file grossi creiamo sezioni basate su blocchi logici o top-level functions
  if (trovate.length < 2 && totali >= 150) {
    const blocchi = [];
    const passo = Math.max(80, Math.floor(totali / 6));
    for (let start = 1; start <= totali; start += passo) {
      const end = Math.min(totali, start + passo - 1);
      // Cerca la prima funzione/classe nel blocco per darle un nome
      let nomeBlocco = '';
      for (let j = start - 1; j < end; j++) {
        const sim = estraiSimboliRiga(righe[j]);
        if (sim.length) {
          nomeBlocco = sim[0].tipo + ' ' + sim[0].nome;
          break;
        }
      }
      blocchi.push({
        titolo: nomeBlocco ? 'Blocco: ' + nomeBlocco : 'Righe ' + start + '-' + end,
        rigaInizio: start,
        rigaIntestazione: start
      });
    }
    return calcolaLimitiSezioni(blocchi, righe);
  }

  // Aggiungi una prima sezione "Setup / Inizializzazione" se ci sono righe prima della prima sezione
  if (trovate.length > 0 && trovate[0].rigaInizio > 1) {
    let haContenuto = false;
    let titoloIniziale = 'Inizializzazione & Setup';
    for (let k = 0; k < trovate[0].rigaInizio - 1; k++) {
      const t = righe[k].trim();
      if (t) {
        haContenuto = true;
        if ((t.startsWith('//') || t.startsWith('#')) && !t.startsWith('///')) {
          const pulito = pulisciTitolo(t);
          if (pulito.length >= 3) {
            titoloIniziale = pulito;
          }
        }
      }
    }
    if (haContenuto) {
      trovate.unshift({
        titolo: titoloIniziale,
        rigaInizio: 1,
        rigaIntestazione: 1
      });
    }
  }

  return calcolaLimitiSezioni(trovate, righe);
}

function calcolaLimitiSezioni(sezioniTrovate, righe) {
  const totali = righe.length;
  const risultato = [];

  for (let i = 0; i < sezioniTrovate.length; i++) {
    const curr = sezioniTrovate[i];
    const succ = sezioniTrovate[i + 1];
    const rigaInizio = curr.rigaInizio;
    const rigaFine = succ ? Math.max(rigaInizio, succ.rigaInizio - 1) : totali;

    // Raccogli simboli definiti nella sezione
    const funzioni = [];
    const variabili = [];
    const classi = [];

    for (let r = rigaInizio - 1; r < rigaFine && r < totali; r++) {
      const sim = estraiSimboliRiga(righe[r]);
      sim.forEach(function (s) {
        if (s.tipo === 'funzione' && funzioni.indexOf(s.nome) === -1) funzioni.push(s.nome);
        if (s.tipo === 'variabile' && variabili.indexOf(s.nome) === -1) variabili.push(s.nome);
        if (s.tipo === 'classe' && classi.indexOf(s.nome) === -1) classi.push(s.nome);
      });
    }

    risultato.push({
      indice: i + 1,
      titolo: curr.titolo,
      rigaInizio: rigaInizio,
      rigaFine: rigaFine,
      righeTotali: rigaFine - rigaInizio + 1,
      funzioni: funzioni,
      variabili: variabili,
      classi: classi
    });
  }

  return risultato;
}

// Analizza un file su disco e ne ricava la mappa delle sezioni
function analizzaFile(percorsoAssolutoOrelativo) {
  const p = path.resolve(percorsoAssolutoOrelativo);
  const codice = leggiFile(p);
  if (codice === null) return null;

  const righe = codice.split(/\r?\n/);
  const sezioni = rilevaSezioni(codice);

  return {
    file: slash(path.basename(p)),
    percorso: slash(p),
    righeTotali: righe.length,
    byte: fs.statSync(p).size,
    sezioni: sezioni
  };
}

// Restituisce la mappa leggibile delle sezioni (per Adam o l'utente)
function testoSezioni(infoOfile, opzioni) {
  const info = (typeof infoOfile === 'string') ? analizzaFile(infoOfile) : infoOfile;
  if (!info) return 'File non trovato o illeggibile.';

  const righe = [
    info.file + ' (' + info.righeTotali + ' righe, ' + info.sezioni.length + ' sezioni):'
  ];

  info.sezioni.forEach(function (s) {
    let dettagli = '';
    const simboli = s.funzioni.slice(0, 4);
    if (simboli.length) {
      dettagli = ' (' + simboli.join(', ') + (s.funzioni.length > 4 ? ', ...' : '') + ')';
    } else if (s.classi.length) {
      dettagli = ' [' + s.classi.slice(0, 2).join(', ') + ']';
    } else if (s.variabili.length) {
      dettagli = ' {var: ' + s.variabili.slice(0, 3).join(', ') + (s.variabili.length > 3 ? ', ...' : '') + '}';
    }
    const numStr = String(s.indice).padStart(2, ' ');
    const rangeStr = ('r.' + s.rigaInizio + '-' + s.rigaFine).padEnd(14, ' ');
    righe.push('  ' + numStr + '. ' + rangeStr + ' ' + s.titolo + dettagli);
  });

  righe.push('');
  righe.push('Usa: node strumenti/capo-file.js --sezione ' + info.file + ' <numero> per leggere solo una sezione.');
  return righe.join('\n');
}

// Estrae il codice di una singola sezione con numeri di riga
function estraiSezione(percorsoAssolutoOrelativo, indiceOtitolo, opzioni) {
  opzioni = opzioni || {};
  const p = path.resolve(percorsoAssolutoOrelativo);
  const codice = leggiFile(p);
  if (codice === null) return { ok: false, errore: 'File non trovato.' };

  const righe = codice.split(/\r?\n/);
  const sezioni = rilevaSezioni(codice);
  if (!sezioni.length) return { ok: false, errore: 'Nessuna sezione trovata nel file.' };

  let sez = null;
  const targetNum = parseInt(indiceOtitolo, 10);

  if (!isNaN(targetNum) && targetNum >= 1 && targetNum <= sezioni.length) {
    sez = sezioni[targetNum - 1];
  } else {
    // Ricerca per titolo
    const q = String(indiceOtitolo || '').toLowerCase().trim();
    sez = sezioni.find(function (s) {
      return s.titolo.toLowerCase().indexOf(q) !== -1;
    });
  }

  if (!sez) {
    return {
      ok: false,
      errore: 'Sezione non trovata. Sezioni disponibili: 1 a ' + sezioni.length
    };
  }

  const outRighe = [];
  const padLen = String(sez.rigaFine).length;

  outRighe.push('=== SEZIONE ' + sez.indice + ' di ' + sezioni.length + ': ' + sez.titolo +
                ' (righe ' + sez.rigaInizio + '-' + sez.rigaFine + ') ===');

  for (let r = sez.rigaInizio; r <= sez.rigaFine && r <= righe.length; r++) {
    const num = String(r).padStart(padLen, ' ');
    outRighe.push(num + ': ' + righe[r - 1]);
  }

  return {
    ok: true,
    sezione: sez,
    totaleSezioni: sezioni.length,
    testo: outRighe.join('\n'),
    codicePuro: righe.slice(sez.rigaInizio - 1, sez.rigaFine).join('\n')
  };
}

// Trova in quale sezione si trova un simbolo e avvisa cosa NON toccare
function guardaSimbolo(percorsoAssolutoOrelativo, simbolo, opzioni) {
  const p = path.resolve(percorsoAssolutoOrelativo);
  const codice = leggiFile(p);
  if (codice === null) return 'File non trovato.';

  const nome = String(simbolo || '').trim();
  if (!nome) return 'Specificare il nome del simbolo da cercare.';

  const info = analizzaFile(p);
  const sezioni = info.sezioni;
  const righe = codice.split(/\r?\n/);

  // Trova righe in cui compare il simbolo
  const occorrenze = [];
  const re = new RegExp('\\b' + nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');

  for (let i = 0; i < righe.length; i++) {
    if (re.test(righe[i])) {
      const numRiga = i + 1;
      const sez = sezioni.find(function (s) { return numRiga >= s.rigaInizio && numRiga <= s.rigaFine; });
      occorrenze.push({
        riga: numRiga,
        sezione: sez,
        testo: righe[i].trim()
      });
    }
  }

  if (!occorrenze.length) {
    return 'Il simbolo "' + nome + '" non compare in ' + info.file + '.';
  }

  const sezioniCoinvolte = new Set();
  occorrenze.forEach(function (o) {
    if (o.sezione) sezioniCoinvolte.add(o.sezione.indice);
  });

  const sezioniNomi = Array.from(sezioniCoinvolte).map(function (idx) {
    const s = sezioni[idx - 1];
    return 'Sezione ' + s.indice + ' (' + s.titolo + ', r.' + s.rigaInizio + '-' + s.rigaFine + ')';
  });

  const sezioniProtette = sezioni
    .filter(function (s) { return !sezioniCoinvolte.has(s.indice); })
    .slice(0, 5)
    .map(function (s) { return s.titolo; });

  const out = [
    'CAPO FILE - Simbolo "' + nome + '" in ' + info.file + ':',
    '- Trovato in ' + occorrenze.length + ' punti nelle sezioni:',
    '  ' + sezioniNomi.join('\n  '),
    '',
    'PRIME RIGHE DI UTILIZZO:',
  ];

  occorrenze.slice(0, 6).forEach(function (o) {
    out.push('  r.' + o.riga + ' [' + (o.sezione ? o.sezione.titolo : 'extra') + ']: ' + o.testo.slice(0, 80));
  });

  if (sezioniProtette.length) {
    out.push('');
    out.push('ATTENZIONE (Non retrocedere / non rompere il codice):');
    out.push('Non toccare le altre sezioni che non c\'entrano (' + sezioniProtette.join(', ') + '...).');
    out.push('Fai modifiche mirate solo all\'interno della sezione coinvolta.');
  }

  return out.join('\n');
}

// Trova tutti i file grossi di un progetto
function trovaFileGrossi(dirProgetto, soglia) {
  const sogliaRighe = soglia || SOGLIA_FILE_GROSSO;
  const radice = path.resolve(dirProgetto || process.cwd());
  const grossi = [];

  function esplora(dir) {
    let voci;
    try { voci = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (let i = 0; i < voci.length; i++) {
      const v = voci[i];
      const nome = v.name;
      if (nome.startsWith('.') || nome === 'node_modules' || nome === 'dist' || nome === 'build' || nome === 'vendor') continue;
      const completo = path.join(dir, nome);
      if (v.isDirectory()) {
        esplora(completo);
      } else if (v.isFile() && /\.(m?js|ts|py|html|css)$/i.test(nome)) {
        try {
          const testo = fs.readFileSync(completo, 'utf8');
          const nRighe = testo.split(/\r?\n/).length;
          if (nRighe >= sogliaRighe) {
            grossi.push({
              file: slash(path.relative(radice, completo)),
              percorso: slash(completo),
              righe: nRighe,
              byte: fs.statSync(completo).size
            });
          }
        } catch (e) {}
      }
    }
  }

  esplora(radice);
  grossi.sort(function (a, b) { return b.righe - a.righe; });
  return grossi;
}

// Genera il blocco di contesto sintetico per il prompt di Adam
function testoPerPrompt(dirProgetto, opzioni) {
  opzioni = opzioni || {};
  const grossi = trovaFileGrossi(dirProgetto, opzioni.soglia || SOGLIA_FILE_GROSSO);
  if (!grossi.length) return '';

  const righe = [
    'CAPO FILE (per file grossi): Questo progetto contiene file complessi con molte righe:',
  ];

  grossi.slice(0, 4).forEach(function (g) {
    righe.push('- ' + g.file + ' (' + g.righe + ' righe): NON leggerlo intero! Usa `node strumenti/capo-file.js --sezioni ' + g.file + '`');
  });

  righe.push('Prima di modificare un file grosso:');
  righe.push('1. Guarda la mappa delle sezioni con `--sezioni <file>`');
  righe.push('2. Leggi SOLO la sezione su cui devi lavorare con `--sezione <file> <numero>`');
  righe.push('3. Prima di toccare un nome usa `--guarda <file> <nome>` per vedere quali sezioni coinvolge e cosa NON toccare.');

  return righe.join('\n');
}

// ------------------------------------------------------------- CLI
if (require.main === module) {
  const argv = process.argv.slice(2);
  const valore = function (nome) {
    const i = argv.indexOf(nome);
    return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
  };

  const dir = valore('--dir') || process.cwd();

  if (argv.indexOf('--aiuto') !== -1 || argv.indexOf('-h') !== -1 || !argv.length) {
    console.log('Uso di capo-file.js (guida sezioni per file grossi):');
    console.log('  node capo-file.js --sezioni <file>          mappa compatta delle sezioni');
    console.log('  node capo-file.js --sezione <file> <n>      legge solo la sezione n (con numeri di riga)');
    console.log('  node capo-file.js --guarda <file> <simbolo> dove si trova il simbolo e cosa NON toccare');
    console.log('  node capo-file.js --grossi                  elenca i file grossi del progetto (>300 righe)');
    console.log('  node capo-file.js --prompt                  testo della guida per il prompt di Adam');
    process.exit(0);
  }

  if (argv.indexOf('--grossi') !== -1) {
    const grossi = trovaFileGrossi(dir);
    if (!grossi.length) {
      console.log('Nessun file oltre ' + SOGLIA_FILE_GROSSO + ' righe in ' + dir);
    } else {
      console.log('File grossi in ' + dir + ':');
      grossi.forEach(function (g) {
        console.log('  ' + g.file + ' (' + g.righe + ' righe, ' + Math.round(g.byte / 1024) + ' KB)');
      });
    }
    process.exit(0);
  }

  if (argv.indexOf('--prompt') !== -1) {
    console.log(testoPerPrompt(dir));
    process.exit(0);
  }

  if (argv.indexOf('--sezioni') !== -1) {
    const f = valore('--sezioni') || argv[argv.indexOf('--sezioni') + 1] || argv[argv.length - 1];
    const fileTarget = path.isAbsolute(f) ? f : path.join(dir, f);
    console.log(testoSezioni(fileTarget));
    process.exit(0);
  }

  if (argv.indexOf('--sezione') !== -1) {
    const idxSez = argv.indexOf('--sezione');
    const f = argv[idxSez + 1];
    const n = argv[idxSez + 2];
    if (!f || !n) {
      console.error('Uso: node capo-file.js --sezione <file> <numero_o_titolo>');
      process.exit(1);
    }
    const fileTarget = path.isAbsolute(f) ? f : path.join(dir, f);
    const res = estraiSezione(fileTarget, n);
    if (!res.ok) {
      console.error('Errore: ' + res.errore);
      process.exit(1);
    }
    console.log(res.testo);
    process.exit(0);
  }

  if (argv.indexOf('--guarda') !== -1) {
    const idxGuarda = argv.indexOf('--guarda');
    const f = argv[idxGuarda + 1];
    const s = argv[idxGuarda + 2];
    if (!f || !s) {
      console.error('Uso: node capo-file.js --guarda <file> <simbolo>');
      process.exit(1);
    }
    const fileTarget = path.isAbsolute(f) ? f : path.join(dir, f);
    console.log(guardaSimbolo(fileTarget, s));
    process.exit(0);
  }

  // Fallback se passato solo il nome del file
  const primo = argv[0];
  if (primo && !primo.startsWith('--')) {
    const fileTarget = path.isAbsolute(primo) ? primo : path.join(dir, primo);
    console.log(testoSezioni(fileTarget));
    process.exit(0);
  }
}

module.exports = {
  SOGLIA_FILE_GROSSO: SOGLIA_FILE_GROSSO,
  rilevaSezioni: rilevaSezioni,
  analizzaFile: analizzaFile,
  testoSezioni: testoSezioni,
  estraiSezione: estraiSezione,
  guardaSimbolo: guardaSimbolo,
  trovaFileGrossi: trovaFileGrossi,
  testoPerPrompt: testoPerPrompt
};
