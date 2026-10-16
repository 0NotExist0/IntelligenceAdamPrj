// NotExist Intelligience Studio - Eseguire davvero un programma Python e guardare cosa fa.
//
// "Il processo e' uscito con codice 0" non vuol dire che funzioni: e' quello che Adam ha scambiato
// per successo il 15/9/2026, su un gioco pygame che non aggiornava mai la finestra. Come verifico io
// un programma: lo lancio, leggo gli errori con file e riga, e se ha una finestra la guardo.
// Qui il programma gira per qualche secondo senza aprire finestre sullo schermo dell'utente
// (SDL_VIDEODRIVER=dummy); prova-python/sitecustomize.py registra da dentro cosa succede.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const CARTELLA_AGGANCIO = path.join(__dirname, 'prova-python');
const CANDIDATI = ['main.py', 'app.py', 'game.py', 'gioco.py', 'run.py', '__main__.py'];

function slash(p) { return String(p).split('\\').join('/'); }

// Il file da lanciare: quello indicato, o un nome classico, o l'unico .py con if __name__ == "__main__".
function trovaPuntoDiAvvio(dir, file) {
  if (file) return fs.existsSync(path.resolve(dir, file)) ? path.resolve(dir, file) : null;
  for (const nome of CANDIDATI) {
    if (fs.existsSync(path.join(dir, nome))) return path.join(dir, nome);
  }
  let voci = [];
  try { voci = fs.readdirSync(dir).filter(function (f) { return /\.py$/i.test(f); }); } catch (e) { voci = []; }
  const principali = voci.filter(function (f) {
    try { return /if\s+__name__\s*==\s*['"]__main__['"]/.test(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { return false; }
  });
  return principali.length === 1 ? path.join(dir, principali[0]) : null;
}

// Ultimo punto del traceback che sta nel progetto, e la riga dell'errore.
function leggiTraceback(testo, dir) {
  const righe = String(testo || '').split(/\r?\n/);
  const inizio = righe.map(function (r, i) { return /^Traceback \(most recent call last\):/.test(r) ? i : -1; }).filter(function (i) { return i !== -1; }).pop();
  if (inizio === undefined) return null;
  let punto = null;
  let ultimo = null;
  const radice = path.resolve(dir).toLowerCase();
  for (let i = inizio + 1; i < righe.length; i++) {
    const m = /^\s*File "([^"]+)", line (\d+)/.exec(righe[i]);
    if (m) {
      ultimo = { file: m[1], riga: Number(m[2]) };
      if (path.resolve(m[1]).toLowerCase().indexOf(radice) === 0) punto = ultimo;
      continue;
    }
    if (/^\S/.test(righe[i]) && righe[i].trim()) {
      const scelto = punto || ultimo || {};
      return {
        messaggio: righe[i].trim().slice(0, 300),
        file: scelto.file ? slash(path.relative(dir, scelto.file)) : null,
        riga: scelto.riga || null
      };
    }
  }
  return null;
}

// Un programma con finestra (pygame) si puo' guardare mentre gira: e' l'unico caso in cui lo
// Studio esegue da solo il programma dell'utente, a fine turno. Uno script qualsiasi no: potrebbe
// cancellare file o mandare dati, e non e' compito dello Studio decidere di lanciarlo.
function usaPygame(dir) {
  let trovato = false;
  (function scendi(cartella, profondita) {
    if (trovato || profondita > 3) return;
    let voci;
    try { voci = fs.readdirSync(cartella, { withFileTypes: true }); } catch (e) { return; }
    for (const v of voci) {
      if (trovato) return;
      if (v.isDirectory()) {
        if (!/^(\.|node_modules$|venv$|\.venv$|__pycache__$|site-packages$|dati$)/i.test(v.name)) scendi(path.join(cartella, v.name), profondita + 1);
      } else if (/\.py$/i.test(v.name)) {
        try {
          if (/^\s*(import\s+pygame|from\s+pygame)/m.test(fs.readFileSync(path.join(cartella, v.name), 'utf8'))) trovato = true;
        } catch (e) { /* file illeggibile */ }
      }
    }
  })(path.resolve(dir), 0);
  return trovato;
}

function provaPython(dir, opzioni) {
  opzioni = opzioni || {};
  const radice = path.resolve(dir);
  return new Promise(function (risolvi) {
    const python = opzioni.python || require('./cervello-python').trovaPython();
    if (!python) return risolvi({ provato: false, motivo: 'Python non e\' installato' });
    const avvio = trovaPuntoDiAvvio(radice, opzioni.file);
    if (!avvio) return risolvi({ provato: false, motivo: 'non trovo il file da lanciare (main.py, app.py, gioco.py...): indicalo' });
    const lavoro = fs.mkdtempSync(path.join(os.tmpdir(), 'prova-python-'));
    const schermate = path.join(os.tmpdir(), 'studio-screenshot');
    fs.mkdirSync(schermate, { recursive: true });
    const fileEsito = path.join(lavoro, 'esito.json');
    const secondi = opzioni.secondi || 8;
    const env = Object.assign({}, process.env, {
      PYTHONPATH: CARTELLA_AGGANCIO + (process.env.PYTHONPATH ? path.delimiter + process.env.PYTHONPATH : ''),
      PROVA_PYTHON_ESITO: fileEsito, PROVA_PYTHON_SCHERMATE: schermate,
      SDL_VIDEODRIVER: 'dummy', SDL_AUDIODRIVER: 'dummy', PYGAME_HIDE_SUPPORT_PROMPT: '1', PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8'
    });
    const inizio = Date.now();
    const processo = spawn(python, [avvio], { cwd: path.dirname(avvio), env: env, windowsHide: true });
    let uscita = '';
    const aggiungi = function (d) { if (uscita.length < 40000) uscita += d; };
    processo.stdout.on('data', aggiungi);
    processo.stderr.on('data', aggiungi);
    let fermato = false;
    const timer = setTimeout(function () { fermato = true; try { processo.kill(); } catch (e) {} }, secondi * 1000);
    processo.on('close', function (codice) {
      clearTimeout(timer);
      let dentro = {};
      try { dentro = JSON.parse(fs.readFileSync(fileEsito, 'utf8')); } catch (e) { dentro = {}; }
      try { fs.rmSync(lavoro, { recursive: true, force: true }); } catch (e) {}
      risolvi({
        provato: true, file: slash(path.relative(radice, avvio)), durataMs: Date.now() - inizio,
        codice: fermato ? null : codice, restaAperto: fermato, secondi: secondi,
        errore: leggiTraceback(uscita, radice), uscita: uscita.slice(-2500), finestra: dentro
      });
    });
    processo.on('error', function (e) {
      clearTimeout(timer);
      risolvi({ provato: false, motivo: 'il programma non parte: ' + e.message });
    });
  });
}

// Da un esito a problemi e righe da mostrare (stessa forma del cervello).
function problemiDellaProva(r) {
  const problemi = [];
  const righe = [];
  if (!r.provato) return { problemi: problemi, righe: ['non provato: ' + r.motivo] };
  const f = r.finestra || {};
  righe.push('lanciato ' + r.file + (r.restaAperto ? ': ancora aperto dopo ' + r.secondi + ' s (normale per un gioco o una finestra), fermato dallo Studio'
    : ': terminato dopo ' + (r.durataMs / 1000).toFixed(1) + ' s con codice ' + r.codice));
  if (r.errore) {
    problemi.push({ file: r.errore.file || r.file, riga: r.errore.riga || 1, grave: true, chiave: (r.errore.file || r.file) + '|esecuzione:' + r.errore.messaggio.replace(/\d+/g, '#').slice(0, 80),
      messaggio: 'eseguendolo davvero si ferma con ' + r.errore.messaggio + (r.errore.riga ? ' (riga ' + r.errore.riga + ')' : '') + '.' });
  }
  if (f.pygame) {
    if (!f.finestra) {
      righe.push('pygame importato ma nessuna finestra aperta' + (r.restaAperto ? ' (forse aspetta qualcosa, per esempio input dalla tastiera)' : ''));
    } else {
      righe.push('finestra ' + f.finestra.join('x') + (f.titolo ? ' "' + f.titolo + '"' : '') + ', aperta dopo ' + f.finestraDopo + ' s; aggiornamenti dello schermo: ' + f.aggiornamenti +
        (f.input && f.input.length ? '; premuti: ' + f.input.join(', ') : ''));
      // Anche se poi si ferma con un errore: un secondo e mezzo di finestra mai aggiornata e' gia' una prova.
      const secondiConFinestra = r.durataMs / 1000 - (f.finestraDopo || 0);
      if (!f.aggiornamenti && secondiConFinestra >= 1.5) {
        problemi.push({ file: r.file, riga: 1, grave: true, chiave: r.file + '|mai-aggiornato',
          messaggio: 'la finestra si apre ma lo schermo non viene MAI aggiornato: nel ciclo principale manca pygame.display.flip() (o update()) dopo aver disegnato. Chi gioca vede una finestra nera o bloccata.' });
      }
      (f.schermate || []).forEach(function (s) {
        if (s.file) righe.push('schermata ' + s.momento + ', da guardare con Read: ' + slash(s.file) + (s.quota !== undefined ? ' (colore dominante ' + s.colore + ' su ' + Math.round(s.quota * 100) + '% dello schermo)' : ''));
      });
      const ultima = (f.schermate || []).filter(function (s) { return s.quota !== undefined; }).pop();
      if (ultima && ultima.quota >= 0.97 && f.aggiornamenti) {
        problemi.push({ file: r.file, riga: 1, grave: false, chiave: r.file + '|schermo-quasi-vuoto',
          messaggio: 'dopo 3 secondi (e dopo Spazio, Invio e un clic) lo schermo e\' quasi tutto di un colore (' + ultima.colore + ' su ' + Math.round(ultima.quota * 100) + '%): controlla che il gioco disegni davvero qualcosa.' });
      }
    }
  } else if (r.codice === 0 && !r.restaAperto && r.durataMs < 1500) {
    righe.push('terminato subito senza errori: se doveva aprire una finestra o restare in attesa, non l\'ha fatto');
  }
  return { problemi: problemi, righe: righe };
}

module.exports = { provaPython: provaPython, problemiDellaProva: problemiDellaProva, trovaPuntoDiAvvio: trovaPuntoDiAvvio, leggiTraceback: leggiTraceback, usaPygame: usaPygame };
