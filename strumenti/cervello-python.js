// NotExist Intelligience Studio - Ponte fra lo Studio (Node) e il cervello per Python e Blender.
//
// L'analisi vera la fa cervello-python.py con l'analizzatore di Python stesso (ast e symtable):
// qui lo si trova, lo si lancia e se ne legge il risultato, con i problemi nella stessa forma del
// cervello per JavaScript (file, riga, grave, messaggio, chiave).

const fs = require('fs');
const path = require('path');
const { execFile, execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, 'cervello-python.py');
const API_BLENDER = path.join(__dirname, 'vendor', 'blender-api.json');
const CARTELLE_IGNORATE = new Set(['.git', 'node_modules', '__pycache__', 'venv', '.venv', 'env', 'site-packages', 'Library', 'dati']);

let pythonTrovato;   // undefined: non ancora cercato; null: non c'e'

function trovaPython() {
  if (pythonTrovato !== undefined) return pythonTrovato;
  pythonTrovato = null;
  for (const comando of ['python', 'py', 'python3']) {
    try {
      execFileSync(comando, ['--version'], { stdio: 'ignore', timeout: 15000, windowsHide: true });
      pythonTrovato = comando;
      break;
    } catch (e) { /* il prossimo */ }
  }
  return pythonTrovato;
}

// C'e' almeno un file .py (senza scendere nelle cartelle di dipendenze)?
function haFilePython(dir, profonditaMassima) {
  const massimo = profonditaMassima || 4;
  function scendi(cartella, profondita) {
    if (profondita > massimo) return false;
    let voci;
    try { voci = fs.readdirSync(cartella, { withFileTypes: true }); } catch (e) { return false; }
    for (const v of voci) {
      if (v.isFile() && /\.py$/i.test(v.name)) return true;
    }
    for (const v of voci) {
      if (v.isDirectory() && !CARTELLE_IGNORATE.has(v.name) && !v.name.startsWith('.') && scendi(path.join(cartella, v.name), profondita + 1)) return true;
    }
    return false;
  }
  return scendi(path.resolve(dir), 0);
}

function analizzaPython(dir, opzioni) {
  opzioni = opzioni || {};
  return new Promise(function (risolvi) {
    const python = trovaPython();
    if (!python) return risolvi({ disponibile: false, problemi: [], file: [], motivo: 'Python non e\' installato' });
    const args = [SCRIPT, path.resolve(dir)];
    if (fs.existsSync(API_BLENDER)) args.push('--api-blender', API_BLENDER);
    if (opzioni.solo) args.push('--solo', path.resolve(dir, opzioni.solo));
    const inizio = Date.now();
    execFile(python, args, { timeout: opzioni.timeout || 120000, maxBuffer: 50 * 1024 * 1024, windowsHide: true }, function (err, stdout, stderr) {
      let dati = null;
      try { dati = JSON.parse(stdout); } catch (e) { dati = null; }
      if (!dati) {
        return risolvi({ disponibile: true, problemi: [], file: [], errore: (String(stderr || '') || (err && err.message) || 'risposta non valida').slice(0, 500) });
      }
      const problemi = [].concat.apply([], (dati.file || []).map(function (f) { return f.problemi || []; }));
      risolvi({
        disponibile: true, python: dati.python, pytest: !!dati.pytest, troncato: !!dati.troncato,
        file: dati.file || [], problemi: problemi, durataMs: Date.now() - inizio
      });
    });
  });
}

module.exports = { trovaPython: trovaPython, haFilePython: haFilePython, analizzaPython: analizzaPython, API_BLENDER: API_BLENDER };
