// NotExist Intelligience Studio - Il cestino: rimettere un file com'era prima.
//
// Accorgersi che un file e' stato sostituito (cambiamenti.js) serve a poco se poi l'unico modo di
// tornare indietro e' riscriverlo a memoria. E' quello che e' successo il 17/9/2026: lo style.css
// in stile acid tekno rave (425 righe) viene coperto da un `cp`, e Adam, invece di rimettere
// quello di prima, ne inventa un terzo da 299 righe. Per l'utente il sito era rotto due volte.
//
// Le istantanee (istantanee.js) la versione di prima ce l'hanno gia', ma durano un turno: la copia
// successiva ci scrive sopra. Qui, ogni volta che lo Studio vede un file cambiare, la versione di
// PRIMA viene messa da parte con la sua data. Poche decine di KB a turno, solo i file toccati.
//
// Regola: ripristinare non distrugge mai niente. Il file che si sta per sostituire entra anche lui
// nel cestino, quindi si puo' sempre tornare indietro dal ripristino stesso.

const fs = require('fs');
const path = require('path');

const CARTELLA_RIPRISTINO = path.join(__dirname, '..', 'dati', 'ripristino');
const MAX_VERSIONI = 200;        // un unzip puo' toccare decine di file in un turno solo
const MAX_PER_FILE = 6;          // dello stesso file bastano le ultime versioni
const MAX_BYTE_TOTALI = 25 * 1024 * 1024;
// Il cestino vive nella cartella dello Studio, che sta su OneDrive: copiare a ogni turno le
// immagini e i modelli 3D lo terrebbe a sincronizzare per niente. Quello che serve rimettere
// com'era e' il codice; di un file che non e' testo si tiene solo il piccolo (un'icona, un .svg).
const MAX_BYTE_FILE = 1024 * 1024;
const MAX_BYTE_NON_TESTO = 256 * 1024;

function slash(p) { return String(p).split('\\').join('/'); }

function cartella(dir, base) {
  return require('./cervello-comandi').cartellaProgetto(dir, base || CARTELLA_RIPRISTINO);
}

function fileIndice(dir, base) {
  return path.join(cartella(dir, base), 'indice.json');
}

function leggiIndice(dir, base) {
  try {
    const d = JSON.parse(fs.readFileSync(fileIndice(dir, base), 'utf8'));
    return Array.isArray(d.versioni) ? d.versioni : [];
  } catch (e) {
    return [];
  }
}

function scriviIndice(dir, versioni, base) {
  const file = fileIndice(dir, base);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    progetto: path.resolve(dir), aggiornato: new Date().toISOString(), versioni: versioni
  }, null, 1));
}

function nomeCopia(id, rel) {
  return id + '-' + path.basename(rel).replace(/[^\w.-]/g, '_');
}

// Cosa si butta per prima cosa: le copie in piu' dello stesso file (dell'ultimo style.css ne
// bastano sei, non trenta). Solo dopo, se il cestino resta troppo grande, si buttano le piu'
// vecchie in assoluto - a malincuore, perche' l'unica copia rimasta di un file e' proprio quella
// che serve quando ci si accorge del danno tre turni dopo.
function pota(dir, versioni, base, limiti) {
  const max = (limiti && limiti.versioni) || MAX_VERSIONI;
  const perFileMax = (limiti && limiti.perFile) || MAX_PER_FILE;
  const maxByte = (limiti && limiti.byte) || MAX_BYTE_TOTALI;
  const tenute = [];
  const perFile = new Map();
  let byte = 0;
  versioni.slice().reverse().forEach(function (v) {
    const quante = perFile.get(v.rel) || 0;
    if (quante >= perFileMax) return;                  // di questo file ne ho gia' abbastanza
    if (tenute.length >= max || byte + (v.byte || 0) > maxByte) return;
    perFile.set(v.rel, quante + 1);
    byte += v.byte || 0;
    tenute.push(v);
  });
  const vive = new Set(tenute.map(function (v) { return v.copia; }));
  versioni.forEach(function (v) {
    if (vive.has(v.copia)) return;
    try { fs.unlinkSync(path.join(cartella(dir, base), 'versioni', v.copia)); } catch (e) { /* gia' sparita */ }
  });
  return tenute.reverse();
}

// Mette da parte la versione di PRIMA di un file. origine = il file da copiare (di solito
// dentro l'istantanea di inizio turno). Restituisce la voce salvata, o null.
function metti(dir, rel, origine, opzioni) {
  opzioni = opzioni || {};
  try {
    if (!fs.existsSync(origine)) return null;
    const st = fs.statSync(origine);
    if (!st.isFile()) return null;
    const testo = require('./cambiamenti').testuale(rel);
    if (st.size > (testo ? MAX_BYTE_FILE : MAX_BYTE_NON_TESTO)) return null;
    const versioni = leggiIndice(dir, opzioni.base);
    // Gia' salvata: lo stesso turno puo' finire due volte (ripresa automatica) e il cestino si
    // riempirebbe di copie identiche, buttando fuori quelle che servono davvero.
    const ultimaUguale = versioni.slice().reverse().find(function (v) { return v.rel === slash(rel); });
    if (ultimaUguale && ultimaUguale.byte === st.size) {
      try {
        const vecchia = path.join(cartella(dir, opzioni.base), 'versioni', ultimaUguale.copia);
        if (fs.existsSync(vecchia) && fs.readFileSync(vecchia).equals(fs.readFileSync(origine))) return ultimaUguale;
      } catch (e) { /* nel dubbio si salva */ }
    }
    const id = String(Date.now()) + '-' + (versioni.length % 1000);
    const copia = nomeCopia(id, rel);
    const destinazione = path.join(cartella(dir, opzioni.base), 'versioni', copia);
    fs.mkdirSync(path.dirname(destinazione), { recursive: true });
    fs.copyFileSync(origine, destinazione);
    let righe = null;
    if (st.size < 2 * 1024 * 1024) {
      try { righe = fs.readFileSync(destinazione, 'utf8').split(/\r?\n/).length; } catch (e) { righe = null; }
    }
    const voce = {
      id: id, rel: slash(rel), copia: copia, byte: st.size, righe: righe,
      quando: new Date().toISOString(), perche: opzioni.perche || '', esisteva: true
    };
    versioni.push(voce);
    scriviIndice(dir, pota(dir, versioni, opzioni.base, opzioni.limiti), opzioni.base);
    return voce;
  } catch (e) {
    return null;
  }
}

// Tutte le copie di un turno: le voci di cambiamenti.js che hanno una versione di prima.
function mettiDalConfronto(dir, risultato, opzioni) {
  opzioni = opzioni || {};
  const messe = [];
  ((risultato && risultato.voci) || []).forEach(function (v) {
    if (!v.prima) return;                                  // un file nuovo non ha un "prima"
    if (opzioni.solamentePerdite && !(v.tipo === 'sparito' || v.sostituito || v.accorciato)) return;
    const voce = metti(dir, v.rel, v.prima, {
      base: opzioni.base,
      perche: v.tipo === 'sparito' ? 'cancellato' : (v.sostituito ? 'sostituito' : (v.accorciato ? 'accorciato' : 'modificato'))
    });
    if (voce) messe.push(voce);
  });
  return messe;
}

function elenco(dir, opzioni) {
  opzioni = opzioni || {};
  const cerca = opzioni.file ? slash(opzioni.file).toLowerCase() : null;
  return leggiIndice(dir, opzioni.base)
    .filter(function (v) { return !cerca || v.rel.toLowerCase().indexOf(cerca) !== -1; })
    .slice()
    .reverse()
    .slice(0, opzioni.quante || 30);
}

function quandoUmano(iso) {
  return require('./cambiamenti').quandoUmano(iso);
}

function testoElenco(dir, opzioni) {
  const voci = elenco(dir, opzioni);
  if (!voci.length) return '';
  return voci.map(function (v) {
    return '  - ' + v.id + '  ' + quandoUmano(v.quando) + '  ' + v.rel +
      (v.righe ? ' (' + v.righe + ' righe)' : '') + (v.perche ? '  [' + v.perche + ']' : '');
  }).join('\n');
}

// Rimette un file com'era. opzioni.id sceglie una versione precisa, altrimenti la piu' recente.
// Il file attuale finisce nel cestino prima di essere sostituito: nessun ripristino distrugge
// quello che c'e' adesso.
function ripristinaFile(dir, rel, opzioni) {
  opzioni = opzioni || {};
  const voci = leggiIndice(dir, opzioni.base).filter(function (v) {
    return opzioni.id ? v.id === opzioni.id : v.rel.toLowerCase().indexOf(slash(rel).toLowerCase()) !== -1;
  });
  if (!voci.length) return { ok: false, errore: 'nessuna versione salvata per ' + rel };
  const voce = voci[voci.length - 1];
  const sorgente = path.join(cartella(dir, opzioni.base), 'versioni', voce.copia);
  if (!fs.existsSync(sorgente)) return { ok: false, errore: 'la copia ' + voce.copia + ' non c\'e\' piu\'' };
  const bersaglio = path.join(path.resolve(dir), voce.rel);
  let sostituito = null;
  if (fs.existsSync(bersaglio)) {
    sostituito = metti(dir, voce.rel, bersaglio, { base: opzioni.base, perche: 'prima del ripristino' });
  }
  try {
    fs.mkdirSync(path.dirname(bersaglio), { recursive: true });
    fs.copyFileSync(sorgente, bersaglio);
  } catch (e) {
    return { ok: false, errore: e.message };
  }
  let righe = null;
  try { righe = fs.readFileSync(bersaglio, 'utf8').split(/\r?\n/).length; } catch (e) { righe = null; }
  return { ok: true, rel: voce.rel, id: voce.id, quando: voce.quando, righe: righe, file: bersaglio, salvataggioPrecedente: sostituito };
}

// ------------------------------------------------------------------ riga di comando
if (require.main === module) {
  const argv = process.argv.slice(2);
  const valore = function (nome) {
    const i = argv.indexOf(nome);
    return i !== -1 && argv[i + 1] && argv[i + 1].charAt(0) !== '-' ? argv[i + 1] : null;
  };
  const dir = valore('--progetto') || process.cwd();
  const file = valore('--file');
  if (argv.indexOf('--aiuto') !== -1 || argv.indexOf('-h') !== -1 || (!file && argv.indexOf('--elenco') === -1)) {
    console.log('Uso:');
    console.log('  node ripristina.js --elenco                 tutte le versioni salvate');
    console.log('  node ripristina.js --elenco --file style.css  solo quelle di un file');
    console.log('  node ripristina.js --file curriculum/style.css   rimette la piu\' recente versione di prima');
    console.log('  node ripristina.js --file style.css --id <id>    rimette una versione precisa');
    console.log('  (--progetto <cartella> se non sei gia\' dentro il progetto)');
    process.exit(0);
  }
  if (argv.indexOf('--elenco') !== -1) {
    const t = testoElenco(dir, { file: file });
    console.log(t ? 'VERSIONI SALVATE (id, quando, file):\n' + t +
      '\nPer rimetterne una: node ripristina.js --file <nome> [--id <id>]'
      : 'Il cestino di questo progetto e\' vuoto.');
    process.exit(0);
  }
  const esito = ripristinaFile(dir, file, { id: valore('--id') });
  if (!esito.ok) {
    console.log('Non ripristinato: ' + esito.errore);
    process.exit(1);
  }
  console.log('Rimesso ' + esito.rel + ' com\'era il ' + quandoUmano(esito.quando) +
    (esito.righe ? ' (' + esito.righe + ' righe)' : '') +
    (esito.salvataggioPrecedente ? '. La versione di adesso l\'ho messa nel cestino (id ' + esito.salvataggioPrecedente.id + ').' : '.'));
}

module.exports = {
  metti: metti,
  pota: pota,
  mettiDalConfronto: mettiDalConfronto,
  elenco: elenco,
  testoElenco: testoElenco,
  ripristinaFile: ripristinaFile,
  leggiIndice: leggiIndice,
  cartella: cartella,
  CARTELLA_RIPRISTINO: CARTELLA_RIPRISTINO
};
