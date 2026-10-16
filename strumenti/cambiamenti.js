// NotExist Intelligience Studio - Cosa e' cambiato sul disco in un turno.
//
// Visto dal vivo (17/9/2026, progetto sitoprova). Adam scrive un curriculum in stile acid tekno
// rave: style.css, 425 righe. Un'ora dopo, per rimettere i loghi, lancia da Bash
// `cp ...\SitoCurriculum\css\style.css ...\curriculum\style.css` e ci scrive sopra il CSS vecchio
// dello zip (242 righe). L'utente: "il css e' rotto, non e' piu' lo stile di prima". Adam risponde
// che il file "e' stato TRONCATO durante la scrittura precedente (limite token)" - falso: l'aveva
// sostituito lui undici minuti prima - e lo riscrive a memoria, inventandone un terzo.
//
// Non e' che ragiona male: nessuno gli aveva detto cosa era cambiato. La conversazione si era
// compattata otto volte in un'ora, e il diario di bordo registra solo i file toccati con Edit e
// Write: un `cp`, un `del`, un unzip non compaiono da nessuna parte. Il modo piu' distruttivo di
// cambiare un file era anche l'unico invisibile.
//
// Qui il confronto lo fa lo STUDIO, sul disco vero: la copia di inizio turno (istantanee.js)
// contro i file di adesso. Non "cosa credo di aver fatto", ma cosa e' successo: quante righe aveva
// prima, quante ne ha adesso, quanto del vecchio file e' sopravvissuto e cosa e' sparito. Un file
// che cambia del tutto non e' "troncato": e' stato sostituito, e la versione di prima si rimette
// com'era con ripristina.js invece di riscriverla a memoria.

const fs = require('fs');
const path = require('path');

const MAX_BYTE_TESTO = 2 * 1024 * 1024;   // oltre, si confrontano solo i byte: un .glb non si legge a righe
const MAX_VOCI = 40;
const MAX_STORICO = 30;
const CARTELLE_ESCLUSE = /^(node_modules|\.git|\.svn|\.hg|dist|build|\.next|__pycache__|\.venv|venv|coverage)$/i;
const MAX_PROFONDITA = 6;

// Un file sostituito: del vecchio e' sopravvissuto meno di un terzo, e il vecchio non era
// un abbozzo di due righe (li' cambiare tutto e' normale).
const SOPRAVVIVENZA_SOSTITUITO = 0.3;
const RIGHE_MINIME_SOSTITUITO = 20;
// Accorciato di molto: meno della meta' delle righe. E' il sintomo che l'utente vede per primo
// ("mi manca tutto"), quindi si dice anche quando il contenuto e' rimasto simile.
const QUOTA_ACCORCIATO = 0.5;

function slash(p) { return String(p).split('\\').join('/'); }

function testuale(rel) {
  return /\.(js|mjs|cjs|jsx|ts|tsx|py|cs|java|html?|css|scss|json|md|txt|xml|svg|bat|cmd|ps1|sh|yml|yaml|ini|cfg|toml|glsl|frag|vert)$/i.test(rel);
}

// I file di una cartella, con gli stessi tagli di istantanee.js: quello che non viene
// fotografato non si puo' nemmeno confrontare.
function elencaFile(radice) {
  const mappa = new Map();
  const base = path.resolve(radice);
  (function scendi(cartella, profondita) {
    if (profondita > MAX_PROFONDITA || mappa.size > 4000) return;
    let voci;
    try { voci = fs.readdirSync(cartella, { withFileTypes: true }); } catch (e) { return; }
    for (const v of voci) {
      if (v.name.charAt(0) === '.') continue;
      const pieno = path.join(cartella, v.name);
      if (v.isDirectory()) {
        if (!CARTELLE_ESCLUSE.test(v.name)) scendi(pieno, profondita + 1);
      } else if (v.isFile()) {
        let st;
        try { st = fs.statSync(pieno); } catch (e) { continue; }
        mappa.set(slash(path.relative(base, pieno)), { file: pieno, byte: st.size });
      }
    }
  })(base, 0);
  return mappa;
}

function leggiTesto(percorso, byte) {
  if (byte > MAX_BYTE_TESTO) return null;
  try { return fs.readFileSync(percorso, 'utf8'); } catch (e) { return null; }
}

function righeDi(testo) {
  return testo === null || testo === undefined ? null : String(testo).split(/\r?\n/).length;
}

// Le righe che contano per il confronto: quelle vuote e le parentesi da sole sono uguali in
// qualsiasi file e direbbero che due file diversi si somigliano.
function righeSignificative(testo) {
  const insieme = new Set();
  String(testo || '').split(/\r?\n/).forEach(function (r) {
    const pulita = r.replace(/\s+/g, ' ').trim();
    if (pulita.length >= 4) insieme.add(pulita);
  });
  return insieme;
}

// Quanto del vecchio file e' ancora dentro il nuovo, da 0 a 1.
function sopravvivenza(testoPrima, testoDopo) {
  const prima = righeSignificative(testoPrima);
  if (!prima.size) return 1;
  const dopo = righeSignificative(testoDopo);
  let vive = 0;
  prima.forEach(function (r) { if (dopo.has(r)) vive++; });
  return vive / prima.size;
}

// I nomi che danno identita' a un file: se spariscono quelli, non e' "un po' diverso", e'
// un altro file. Servono a dire ad Adam COSA ha perso, non solo quante righe.
function simboli(rel, testo) {
  const t = String(testo || '');
  const trovati = [];
  const aggiungi = function (espressione, formato) {
    let m;
    const re = new RegExp(espressione.source, espressione.flags.indexOf('g') === -1 ? espressione.flags + 'g' : espressione.flags);
    while ((m = re.exec(t)) !== null && trovati.length < 400) trovati.push(formato(m));
  };
  if (/\.s?css$/i.test(rel)) {
    aggiungi(/@keyframes\s+([\w-]+)/i, function (m) { return '@keyframes ' + m[1]; });
    aggiungi(/(--[\w-]{3,})\s*:/, function (m) { return m[1]; });
    aggiungi(/@media[^{]{3,60}/i, function (m) { return m[0].replace(/\s+/g, ' ').trim(); });
  } else if (/\.html?$/i.test(rel)) {
    aggiungi(/<(script|link)\b[^>]*\b(?:src|href)\s*=\s*["']([^"']+)["']/i, function (m) { return m[2]; });
    aggiungi(/\bid\s*=\s*["']([\w-]{2,})["']/i, function (m) { return '#' + m[1]; });
  } else if (/\.py$/i.test(rel)) {
    aggiungi(/^\s*(?:def|class)\s+(\w+)/m, function (m) { return m[1]; });
  } else if (/\.(js|mjs|cjs|jsx|ts|tsx|cs|java)$/i.test(rel)) {
    aggiungi(/\b(?:function|class)\s+(\w{3,})/, function (m) { return m[1]; });
    aggiungi(/\b(?:const|let|var)\s+(\w{3,})\s*=\s*(?:function|\()/, function (m) { return m[1]; });
  }
  return trovati;
}

function persi(rel, testoPrima, testoDopo) {
  if (testoPrima === null || testoDopo === null) return [];
  const dopo = new Set(simboli(rel, testoDopo));
  const visti = new Set();
  return simboli(rel, testoPrima).filter(function (s) {
    if (dopo.has(s) || visti.has(s)) return false;
    visti.add(s);
    return true;
  });
}

// Confronta la copia di prima (dirPrima) con il progetto adesso (dirDopo).
// Restituisce { voci: [...], modificati, nuovi, spariti, sostituiti } ordinato per gravita'.
function confronta(dirPrima, dirDopo) {
  const vuoto = { voci: [], modificati: 0, nuovi: 0, spariti: 0, sostituiti: 0 };
  if (!dirPrima || !dirDopo || !fs.existsSync(dirPrima) || !fs.existsSync(dirDopo)) return vuoto;
  const prima = elencaFile(dirPrima);
  const dopo = elencaFile(dirDopo);
  const voci = [];

  prima.forEach(function (p, rel) {
    const d = dopo.get(rel);
    if (!d) {
      const testo = testuale(rel) ? leggiTesto(p.file, p.byte) : null;
      voci.push({
        rel: rel, tipo: 'sparito', prima: path.join(dirPrima, rel),
        bytePrima: p.byte, byteDopo: 0, righePrima: righeDi(testo), righeDopo: 0,
        sostituito: false, accorciato: false, sopravvivenza: 0, persi: []
      });
      return;
    }
    if (d.byte === p.byte) {
      // Stessa dimensione: quasi sempre lo stesso file. Si controlla comunque il contenuto,
      // ma solo per i file di testo (una modifica che non cambia i byte esiste).
      if (!testuale(rel)) return;
      const tp = leggiTesto(p.file, p.byte);
      const td = leggiTesto(d.file, d.byte);
      if (tp !== null && td !== null && tp === td) return;
    }
    const tp = testuale(rel) ? leggiTesto(p.file, p.byte) : null;
    const td = testuale(rel) ? leggiTesto(d.file, d.byte) : null;
    if (tp !== null && td !== null && tp === td) return;
    const righePrima = righeDi(tp);
    const righeDopo = righeDi(td);
    const viva = tp !== null && td !== null ? sopravvivenza(tp, td) : 1;
    const sostituito = tp !== null && td !== null && righePrima >= RIGHE_MINIME_SOSTITUITO && viva < SOPRAVVIVENZA_SOSTITUITO;
    const accorciato = righePrima !== null && righeDopo !== null && righePrima >= RIGHE_MINIME_SOSTITUITO &&
      righeDopo < righePrima * QUOTA_ACCORCIATO;
    voci.push({
      rel: rel, tipo: 'modificato', prima: path.join(dirPrima, rel),
      bytePrima: p.byte, byteDopo: d.byte, righePrima: righePrima, righeDopo: righeDopo,
      sostituito: sostituito, accorciato: accorciato, sopravvivenza: viva,
      persi: sostituito || accorciato ? persi(rel, tp, td).slice(0, 6) : []
    });
  });

  dopo.forEach(function (d, rel) {
    if (prima.has(rel)) return;
    const testo = testuale(rel) ? leggiTesto(d.file, d.byte) : null;
    voci.push({
      rel: rel, tipo: 'nuovo', prima: null,
      bytePrima: 0, byteDopo: d.byte, righePrima: 0, righeDopo: righeDi(testo),
      sostituito: false, accorciato: false, sopravvivenza: 1, persi: []
    });
  });

  // Prima le perdite: un file sparito o sostituito e' cio' che l'utente vede come "rotto".
  const peso = function (v) {
    if (v.tipo === 'sparito') return 0;
    if (v.sostituito) return 1;
    if (v.accorciato) return 2;
    if (v.tipo === 'modificato') return 3;
    return 4;
  };
  voci.sort(function (a, b) { return peso(a) - peso(b) || a.rel.localeCompare(b.rel); });
  return {
    voci: voci.slice(0, MAX_VOCI),
    modificati: voci.filter(function (v) { return v.tipo === 'modificato'; }).length,
    nuovi: voci.filter(function (v) { return v.tipo === 'nuovo'; }).length,
    spariti: voci.filter(function (v) { return v.tipo === 'sparito'; }).length,
    sostituiti: voci.filter(function (v) { return v.sostituito; }).length
  };
}

// Le voci che meritano un avviso: una perdita di lavoro, non un normale "ho aggiunto tre righe".
function perdite(risultato) {
  return ((risultato && risultato.voci) || []).filter(function (v) {
    return v.tipo === 'sparito' || v.sostituito || v.accorciato;
  });
}

function descriviVoce(v) {
  if (v.tipo === 'sparito') {
    return 'CANCELLATO ' + v.rel + (v.righePrima ? ' (' + v.righePrima + ' righe)' : '');
  }
  if (v.tipo === 'nuovo') {
    return 'nuovo ' + v.rel + (v.righeDopo ? ' (' + v.righeDopo + ' righe)' : '');
  }
  const righe = v.righePrima !== null && v.righeDopo !== null ? v.righePrima + ' -> ' + v.righeDopo + ' righe' : v.bytePrima + ' -> ' + v.byteDopo + ' byte';
  if (v.sostituito) {
    // La sopravvivenza puo' mancare (voce riletta da uno storico vecchio): meglio tacere che
    // stampare un numero senza senso.
    const resta = typeof v.sopravvivenza === 'number' && isFinite(v.sopravvivenza)
      ? ', del file di prima resta il ' + Math.round(v.sopravvivenza * 100) + '%' : '';
    return 'SOSTITUITO ' + v.rel + ': ' + righe + resta +
      (v.persi.length ? '. Spariti: ' + v.persi.join(', ') : '');
  }
  if (v.accorciato) {
    return 'ACCORCIATO ' + v.rel + ': ' + righe + (v.persi.length ? '. Spariti: ' + v.persi.join(', ') : '');
  }
  return 'modificato ' + v.rel + ': ' + righe;
}

// Il testo per Adam. Corto: deve stare nel contesto di un 9B senza mangiarselo.
function testo(risultato, opzioni) {
  opzioni = opzioni || {};
  const voci = (risultato && risultato.voci) || [];
  if (!voci.length) return '';
  const gravi = perdite(risultato);
  const altre = voci.filter(function (v) { return gravi.indexOf(v) === -1; });
  const righe = [opzioni.titolo || 'COSA E\' CAMBIATO SUL DISCO (misurato dallo Studio, non e\' un ricordo):'];
  gravi.slice(0, 6).forEach(function (v) { righe.push('  - ' + descriviVoce(v)); });
  altre.slice(0, opzioni.quante || 6).forEach(function (v) { righe.push('  - ' + descriviVoce(v)); });
  const restanti = voci.length - Math.min(gravi.length, 6) - Math.min(altre.length, opzioni.quante || 6);
  if (restanti > 0) righe.push('  - e altri ' + restanti + ' file');
  if (gravi.length) {
    righe.push('ATTENZIONE: un file sostituito o cancellato NON e\' un file "troncato": qualcosa gli e\' passato sopra ' +
      '(Write, un cp, un unzip). La versione di prima ce l\'ho: elencala con "node ' +
      slash(path.join(opzioni.cartellaStrumenti || 'strumenti', 'ripristina.js')) + ' --elenco" e rimettila com\'era ' +
      'invece di riscriverla a memoria.');
  }
  return righe.join('\n');
}

// ------------------------------------------------------------------ storico
// Il confronto vive un turno; la domanda dell'utente arriva mezz'ora dopo ("il css e' rotto").
// Per questo ogni turno lascia una riga sul disco: cosi' si puo' rispondere a "chi ha toccato
// questo file e quando" anche tre sessioni piu' tardi.

function fileStorico(dir, base) {
  return path.join(require('./cervello-comandi').cartellaProgetto(dir, base), 'cambiamenti.json');
}

function leggiStorico(dir, base) {
  try {
    const d = JSON.parse(fs.readFileSync(fileStorico(dir, base), 'utf8'));
    return Array.isArray(d.turni) ? d.turni : [];
  } catch (e) {
    return [];
  }
}

function registra(dir, risultato, opzioni) {
  opzioni = opzioni || {};
  const voci = (risultato && risultato.voci) || [];
  if (!voci.length) return leggiStorico(dir, opzioni.base);
  const turni = leggiStorico(dir, opzioni.base);
  // Un turno puo' finire piu' volte (la ripresa automatica riparte dalla stessa copia di inizio
  // turno): con la stessa chiave si riscrive la voce invece di farne un'altra uguale.
  if (opzioni.chiave && turni.length && turni[turni.length - 1].chiave === opzioni.chiave) turni.pop();
  turni.push({
    quando: new Date().toISOString(),
    chiave: opzioni.chiave || '',
    nota: opzioni.nota || '',
    file: voci.slice(0, 20).map(function (v) {
      return {
        rel: v.rel, tipo: v.tipo, righePrima: v.righePrima, righeDopo: v.righeDopo,
        sostituito: !!v.sostituito, accorciato: !!v.accorciato,
        sopravvivenza: typeof v.sopravvivenza === 'number' ? Math.round(v.sopravvivenza * 100) / 100 : undefined,
        persi: v.persi || []
      };
    })
  });
  const tenuti = turni.slice(-MAX_STORICO);
  const file = fileStorico(dir, opzioni.base);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ progetto: path.resolve(dir), aggiornato: new Date().toISOString(), turni: tenuti }, null, 1));
  } catch (e) { /* lo storico non e' indispensabile */ }
  return tenuti;
}

function quandoUmano(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso || '');
  const due = function (n) { return ('0' + n).slice(-2); };
  return due(d.getDate()) + '/' + due(d.getMonth() + 1) + ' ' + due(d.getHours()) + ':' + due(d.getMinutes());
}

// La storia di un file (o di tutto il progetto) dallo storico salvato.
function storia(dir, opzioni) {
  opzioni = opzioni || {};
  const cerca = opzioni.file ? slash(opzioni.file).toLowerCase() : null;
  const righe = [];
  leggiStorico(dir, opzioni.base).slice().reverse().forEach(function (t) {
    t.file.forEach(function (v) {
      if (cerca && v.rel.toLowerCase().indexOf(cerca) === -1) return;
      righe.push({ quando: t.quando, nota: t.nota, voce: v });
    });
  });
  return righe.slice(0, opzioni.quante || 20);
}

function testoStoria(dir, opzioni) {
  const righe = storia(dir, opzioni);
  if (!righe.length) return '';
  return righe.map(function (r) {
    return '  - ' + quandoUmano(r.quando) + ' ' + descriviVoce(r.voce);
  }).join('\n');
}

// Le perdite degli ultimi turni: quello che serve al quadro della situazione e quando
// l'utente dice "e' rotto" senza dire cosa.
function perditeRecenti(dir, opzioni) {
  opzioni = opzioni || {};
  const quanti = opzioni.turni || 3;
  const righe = [];
  leggiStorico(dir, opzioni.base).slice(-quanti).reverse().forEach(function (t) {
    t.file.forEach(function (v) {
      if (v.tipo === 'sparito' || v.sostituito || v.accorciato) righe.push({ quando: t.quando, voce: v });
    });
  });
  return righe.slice(0, opzioni.quante || 5);
}

function testoPerditeRecenti(dir, opzioni) {
  const righe = perditeRecenti(dir, opzioni);
  if (!righe.length) return '';
  return ['FILE CHE HANNO PERSO ROBA DI RECENTE (dal disco, non dai ricordi):']
    .concat(righe.map(function (r) { return '  - ' + quandoUmano(r.quando) + ' ' + descriviVoce(r.voce); }))
    .join('\n');
}

// ------------------------------------------------------------------ riga di comando
if (require.main === module) {
  const argv = process.argv.slice(2);
  const valore = function (nome) {
    const i = argv.indexOf(nome);
    return i !== -1 && argv[i + 1] && argv[i + 1].charAt(0) !== '-' ? argv[i + 1] : null;
  };
  const dir = valore('--progetto') || process.cwd();
  if (argv.indexOf('--aiuto') !== -1 || argv.indexOf('-h') !== -1) {
    console.log('Uso: node cambiamenti.js [--progetto <cartella>] [--file <nome>] [--quante <n>]');
    console.log('     node cambiamenti.js --prima <cartella copia> --dopo <cartella progetto>');
    process.exit(0);
  }
  const prima = valore('--prima');
  if (prima) {
    const r = confronta(prima, valore('--dopo') || dir);
    console.log(testo(r) || 'Nessuna differenza fra le due cartelle.');
    process.exit(0);
  }
  const file = valore('--file');
  const t = testoStoria(dir, { file: file, quante: Number(valore('--quante')) || 20 });
  if (t) {
    console.log(file ? 'STORIA DI ' + file + ':' : 'ULTIMI CAMBIAMENTI SUL DISCO:');
    console.log(t);
  } else {
    console.log('Nessun cambiamento registrato per questo progetto' + (file ? ' su ' + file : '') + '.');
  }
}

module.exports = {
  confronta: confronta,
  testuale: testuale,
  perdite: perdite,
  testo: testo,
  descriviVoce: descriviVoce,
  simboli: simboli,
  persi: persi,
  sopravvivenza: sopravvivenza,
  elencaFile: elencaFile,
  registra: registra,
  leggiStorico: leggiStorico,
  fileStorico: fileStorico,
  storia: storia,
  testoStoria: testoStoria,
  perditeRecenti: perditeRecenti,
  testoPerditeRecenti: testoPerditeRecenti,
  quandoUmano: quandoUmano
};
