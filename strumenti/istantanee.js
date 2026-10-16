// NotExist Intelligience Studio - Istantanee del progetto ("prima/dopo").
//
// Per dire che una modifica ha rotto qualcosa non basta vedere che adesso non funziona:
// bisogna sapere che PRIMA funzionava. A ogni inizio turno di Adam si copia la cartella del
// progetto (per una pagina web sono pochi KB). Se dopo il turno un collaudo che passava
// fallisce, lo si riesegue sulla copia: passa li' e fallisce ora = l'ha rotto quel turno;
// fallisce anche li' = era gia' rotto prima.
//
// Le copie stanno nella cartella temporanea del sistema: lo Studio vive su OneDrive, e una
// copia a ogni turno la farebbe sincronizzare di continuo.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const BASE_PREDEFINITA = path.join(os.tmpdir(), 'studio-istantanee');
const MAX_FILE = 400;
const MAX_BYTE = 25 * 1024 * 1024;
const MAX_PROFONDITA = 6;
// Dipendenze, controllo versione e cartelle generate: non servono a eseguire la pagina.
const CARTELLE_ESCLUSE = /^(node_modules|\.git|\.svn|\.hg|dist|build|\.next|__pycache__|\.venv|venv)$/i;

function cartellaIstantanea(dir, base) {
  const chiave = crypto.createHash('sha1').update(path.resolve(dir).toLowerCase()).digest('hex').slice(0, 16);
  return path.join(base || BASE_PREDEFINITA, chiave);
}

// File da copiare, o null se il progetto supera i limiti: una cartella enorme (per esempio
// il Desktop scelto come cartella di lavoro) non si copia a ogni turno.
function elencaDaCopiare(radice, maxFile, maxByte) {
  const elenco = [];
  let byte = 0;
  let motivo = '';
  const visita = function (cartella, profondita) {
    if (motivo) return;
    if (profondita > MAX_PROFONDITA) { motivo = 'progetto-troppo-profondo'; return; }
    let voci;
    try { voci = fs.readdirSync(cartella, { withFileTypes: true }); } catch (e) { motivo = 'cartella-illeggibile'; return; }
    for (const v of voci) {
      if (motivo) return;
      if (v.name.charAt(0) === '.') continue;   // .git, .claude_memory.json, file nascosti
      const pieno = path.join(cartella, v.name);
      if (v.isDirectory()) {
        if (!CARTELLE_ESCLUSE.test(v.name)) visita(pieno, profondita + 1);
      } else if (v.isFile()) {
        let dimensione = 0;
        try { dimensione = fs.statSync(pieno).size; } catch (e) { continue; }
        byte += dimensione;
        elenco.push({ file: pieno, rel: path.relative(radice, pieno), byte: dimensione });
        if (elenco.length > maxFile) motivo = 'troppi-file';
        else if (byte > maxByte) motivo = 'troppi-byte';
      }
    }
  };
  visita(radice, 0);
  return { ok: !motivo, motivo: motivo, elenco: elenco, byte: byte };
}

// opzioni: base (cartella delle copie), maxFile, maxByte.
// Restituisce { dir, file, byte, quando } oppure null se non si e' potuta fare.
function scattaConEsito(dir, opzioni) {
  const o = opzioni || {};
  const radice = path.resolve(dir);
  if (!fs.existsSync(radice)) return { ok: false, motivo: 'cartella-inesistente', foto: null };
  const trovati = elencaDaCopiare(radice, o.maxFile || MAX_FILE, o.maxByte || MAX_BYTE);
  if (!trovati.ok) {
    return {
      ok: false,
      motivo: trovati.motivo,
      foto: null,
      file: trovati.elenco.length,
      byte: trovati.byte,
      limiteFile: o.maxFile || MAX_FILE,
      limiteByte: o.maxByte || MAX_BYTE
    };
  }
  if (!trovati.elenco.length) return { ok: false, motivo: 'progetto-vuoto', foto: null };
  const destinazione = cartellaIstantanea(radice, o.base);
  // Si scrive in una cartella nuova e si sostituisce alla fine: una copia a meta' (disco
  // pieno, file bloccato) non deve mai passare per "la versione di prima".
  const nuova = destinazione + '.nuova';
  try {
    fs.rmSync(nuova, { recursive: true, force: true });
    trovati.elenco.forEach(function (f) {
      const bersaglio = path.join(nuova, f.rel);
      fs.mkdirSync(path.dirname(bersaglio), { recursive: true });
      fs.copyFileSync(f.file, bersaglio);
    });
    fs.rmSync(destinazione, { recursive: true, force: true });
    fs.renameSync(nuova, destinazione);
    return {
      ok: true,
      motivo: '',
      foto: { dir: destinazione, file: trovati.elenco.length, byte: trovati.byte, quando: Date.now() }
    };
  } catch (e) {
    try { fs.rmSync(nuova, { recursive: true, force: true }); } catch (cleanup) {}
    return { ok: false, motivo: 'errore-copia', errore: e.message, foto: null };
  }
}

function scatta(dir, opzioni) {
  const esito = scattaConEsito(dir, opzioni);
  return esito.ok ? esito.foto : null;
}

module.exports = { scatta, scattaConEsito, cartellaIstantanea, BASE_PREDEFINITA, MAX_FILE, MAX_BYTE };
