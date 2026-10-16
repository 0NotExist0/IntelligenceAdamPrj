// NotExist Intelligience Studio - La verifica completa, come la fa un programmatore esperto.
//
// Un programmatore esperto non dice "fatto" dopo aver scritto il codice: lo esegue e guarda.
// Visto dal vivo sul gioco di Adam (15/9/2026): il codice sembrava completo, ma main.js si
// fermava alla riga 26 (ui.startBtn non esisteva) e il pulsante "Inizia Gioco" non faceva
// niente. La sonda sapeva trovarlo in 10 secondi, ma ad Adam nessuno aveva mai detto che
// esisteva. E dopo la correzione il gioco "girava" (zombie che nascono nelle variabili) ma a
// schermo non si vedeva niente: si scopre solo guardando i pixel della schermata.
//
// In un solo comando, per il tipo di progetto che c'e':
//  - web: cervello del codice + ogni pagina aperta in un Chrome vero (clic, tasti, errori con file
//    e riga, cosa cambia nel tempo, schermo vuoto, schermate da guardare), anche a larghezza telefono;
//  - Unity: compilazione con il compilatore di Unity, errori della Console, impostazioni Android;
//  - Python: cervello del codice (nomi, import, argomenti) e test con pytest se ci sono;
//  - Blender: add-on registrati e tolti in Blender senza finestra, script eseguiti con anteprima.
// Poi un riepilogo con cosa fare adesso.
//
// Uso, dalla cartella del progetto:
//   node verifica.js                      tutto il progetto (fino a 3 pagine)
//   node verifica.js gioco.html           una pagina sola
//   node verifica.js gioco.html --passi "clic #start; attendi 1000; tasto Space 300"
//   node verifica.js gioco.html --osserva "PLAYER.health;nemici.length"
//   node verifica.js gioco.html --telefono         la pagina larga come un telefono
//   node verifica.js --blender scena.py            lo script in Blender, con anteprima da guardare
//   opzioni: --dir <cartella del progetto>

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const cervello = require('./cervello');
const comandi = require('./cervello-comandi');

const MAX_PAGINE = 3;
const COMANDO = 'node "' + path.join(__dirname, 'verifica.js').split(path.sep).join('/') + '"';
const PASSI_POSSIBILI = 'clic #id, clic x y, tasto NomeTasto [ms], mouse x y, attendi ms, scrivi #campo | testo, ' +
  'seleziona #menu | valore, trascina origine | destinazione (CSS/x y/%), js codice';
const TELEFONO = { larghezza: 390, altezza: 844 };

function plurale(n, uno, tanti) { return n + ' ' + (n === 1 ? uno : tanti); }
function slash(p) { return String(p).split('\\').join('/'); }

function leggiArgomenti(argv) {
  const o = { dir: process.cwd(), pagine: [], programmi: [], passi: null, osserva: null, telefono: false, blender: null, aiuto: false, sconosciuti: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') o.dir = argv[++i] || o.dir;
    else if (a === '--passi') o.passi = String(argv[++i] || '').split(/[;\n]/).map(function (x) { return x.trim(); }).filter(Boolean);
    else if (a === '--osserva') o.osserva = String(argv[++i] || '').split(';').map(function (x) { return x.trim(); }).filter(Boolean);
    else if (a === '--telefono') o.telefono = true;
    else if (a === '--blender') o.blender = argv[++i] || null;
    else if (a === '--secondi') o.secondi = Number(argv[++i]) || null;
    else if (a === '--richiesta') o.richiesta = argv[++i] || null;
    else if (a === '--aiuto' || a === '--help') o.aiuto = true;
    // Un'opzione che non esiste e' un malinteso, non un dettaglio: visto dal vivo, Adam ha lanciato
    // piu' volte "verifica.js --cerca nome" (quello e' il cervello) e ha creduto alla risposta.
    else if (a.startsWith('--')) o.sconosciuti.push(a);
    else if (/\.py$/i.test(a)) o.programmi.push(a);
    else if (/\.html?$/i.test(a)) o.pagine.push(a);
    else o.sconosciuti.push(a);
  }
  return o;
}

// index.html per prima, poi le pagine meno annidate.
function ordinaPagine(a, b) {
  const pa = /(^|\/)index\.html?$/i.test(a) ? 0 : 1;
  const pb = /(^|\/)index\.html?$/i.test(b) ? 0 : 1;
  return (pa - pb) || (a.split('/').length - b.split('/').length) || a.localeCompare(b);
}

function consiglioPerNode(dir) {
  let pacchetto = null;
  try { pacchetto = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch (e) { pacchetto = null; }
  if (pacchetto && pacchetto.scripts && pacchetto.scripts.test && !/no test specified/i.test(pacchetto.scripts.test)) {
    return 'c\'e\' uno script di test in package.json: lancia npm test e leggi il risultato.';
  }
  return 'esegui davvero il programma (node ' + ((pacchetto && pacchetto.main) || 'nomefile.js') +
    ') e leggi l\'uscita: un errore li\' vale piu\' di cento letture del codice.';
}

// Le variabili osservate che cambiano fra un momento e l'altro: "gameState: menu -> playing".
function cosaCambia(momenti) {
  if (!momenti || momenti.length < 2) return [];
  const nomi = Object.keys(momenti[0].valori || {});
  const righe = [];
  nomi.forEach(function (nome) {
    const valori = [];
    momenti.forEach(function (m) {
      const v = m.valori ? m.valori[nome] : undefined;
      if (v !== undefined && valori[valori.length - 1] !== v) valori.push(v);
    });
    if (valori.length > 1) righe.push(nome + ': ' + valori.slice(0, 4).map(function (v) { return String(v).slice(0, 40); }).join(' -> '));
  });
  return righe;
}

function esegui(comando, argomenti, opzioni) {
  return new Promise(function (risolvi) {
    execFile(comando, argomenti, Object.assign({ maxBuffer: 20 * 1024 * 1024, windowsHide: true }, opzioni), function (err, stdout, stderr) {
      risolvi({ codice: err ? (typeof err.code === 'number' ? err.code : 1) : 0, uscita: String(stdout || '') + String(stderr || ''), scaduto: !!(err && err.killed) });
    });
  });
}

// ------------------------------------------------------------ Blender

function trovaBlender() {
  if (process.env.BLENDER_PATH && fs.existsSync(process.env.BLENDER_PATH)) return process.env.BLENDER_PATH;
  const base = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Blender Foundation');
  try {
    const versioni = fs.readdirSync(base).filter(function (d) { return fs.existsSync(path.join(base, d, 'blender.exe')); })
      .sort(function (a, b) { return b.localeCompare(a, undefined, { numeric: true }); });
    if (versioni.length) return path.join(base, versioni[0], 'blender.exe');
  } catch (e) { /* non installato qui */ }
  return null;
}

async function provaInBlender(modo, bersaglio, anteprima) {
  const blender = trovaBlender();
  if (!blender) return { errore: 'Blender non e\' installato (o non e\' in Program Files\\Blender Foundation)' };
  const argomenti = ['-b', '--factory-startup', '--python', path.join(__dirname, 'blender-prova.py'), '--', modo, bersaglio];
  if (anteprima) argomenti.push(anteprima);
  const r = await esegui(blender, argomenti, { timeout: 180000 });
  const riga = r.uscita.split(/\r?\n/).find(function (l) { return l.indexOf('PROVA_BLENDER=') === 0; });
  if (!riga) return { errore: r.scaduto ? 'Blender ci ha messo troppo ed e\' stato fermato' : 'Blender non ha risposto: ' + r.uscita.slice(-300) };
  try { return JSON.parse(riga.slice('PROVA_BLENDER='.length)); } catch (e) { return { errore: 'risposta di Blender non leggibile' }; }
}

// ------------------------------------------------------------ Python

function haTestPython(dir) {
  const trovati = [];
  (function scendi(cartella, profondita) {
    if (profondita > 4 || trovati.length) return;
    let voci;
    try { voci = fs.readdirSync(cartella, { withFileTypes: true }); } catch (e) { return; }
    for (const v of voci) {
      if (v.isFile() && /^(test_.*|.*_test)\.py$/i.test(v.name)) { trovati.push(v.name); return; }
      if (v.isDirectory() && !/^(\.|node_modules$|venv$|\.venv$|__pycache__$|site-packages$)/.test(v.name)) scendi(path.join(cartella, v.name), profondita + 1);
    }
  })(dir, 0);
  return trovati.length > 0;
}

async function sezionePython(dir, conta, righe, numero) {
  const py = require('./cervello-python');
  const r = await py.analizzaPython(dir);
  if (!r.disponibile) { righe.push(numero + ') PYTHON: ' + (r.motivo || 'non disponibile')); return r; }
  const gravi = r.problemi.filter(function (p) { return p.grave; });
  conta.gravi += gravi.length;
  conta.avvisi += r.problemi.length - gravi.length;
  righe.push(numero + ') IL CODICE PYTHON, controllato con l\'analizzatore di Python ' + (r.python || '') + ' (' + r.file.length + ' file' +
    (r.file.some(function (f) { return f.blender; }) ? ', anche script di Blender' : '') + ')');
  if (!r.problemi.length) righe.push('   nessun problema');
  r.problemi.slice().sort(function (x, y) { return y.grave - x.grave; }).slice(0, 12).forEach(function (p) {
    righe.push('   ' + (p.grave ? 'GRAVE ' : 'da controllare ') + p.file + ':' + p.riga + '  ' + p.messaggio);
  });
  if (r.problemi.length > 12) righe.push('   ... altri ' + (r.problemi.length - 12) + ': ' + comandi.COMANDO + ' --controlla');
  if (r.pytest && haTestPython(dir)) {
    const t = await esegui(py.trovaPython(), ['-m', 'pytest', '-q', '-x', '--maxfail=5', '-p', 'no:cacheprovider'], { cwd: dir, timeout: 180000 });
    const riepilogo = t.uscita.split(/\r?\n/).reverse().find(function (l) { return /\b(passed|failed|error|no tests ran)\b/.test(l); }) || '';
    if (t.codice === 0) {
      righe.push('   test (pytest): ' + riepilogo.replace(/=+/g, '').trim());
    } else {
      conta.testFalliti++;
      righe.push('   TEST FALLITI (pytest): ' + (riepilogo.replace(/=+/g, '').trim() || 'uscita ' + t.codice));
      t.uscita.split(/\r?\n/).filter(function (l) { return /^(E\s|FAILED|ERROR|\S+\.py:\d+)/.test(l); }).slice(0, 10).forEach(function (l) { righe.push('   ' + l.slice(0, 220)); });
    }
  }
  return r;
}

// ------------------------------------------------------------ verifica

async function verifica(opzioni) {
  opzioni = opzioni || {};
  const dir = path.resolve(opzioni.dir || process.cwd());
  const conta = { gravi: 0, avvisi: 0, erroriPagina: 0, fatti: 0, pagine: 0, nonProvate: 0, testFalliti: 0, blender: 0, requisiti: 0 };
  // Con che cosa le pagine disegnano e si collegano davvero (canvas 2d, WebGL, blocco del mouse,
  // WebSocket): serve per dire se e' davvero un gioco 3D in prima persona o un multiplayer.
  const tecnologia = { contesti: [], pointerLock: 0, connessioni: [] };

  if (opzioni.sconosciuti && opzioni.sconosciuti.length) {
    const noto = opzioni.sconosciuti[0];
    const consiglio = /^--?(cerca|scheda|controlla|panoramica)/.test(noto)
      ? 'quella e\' un\'opzione del cervello del progetto: ' + comandi.COMANDO + ' ' + noto + ' ...'
      : 'questo comando prova il progetto: pagine .html, programmi .py, progetti Unity e script di Blender.';
    return { conta: conta, testo: 'non conosco "' + noto + '": non ho verificato niente. ' + consiglio + '\n' + USO };
  }

  if (opzioni.passi && opzioni.passi.length) {
    const leggiPasso = require('./collaudatore').leggiPasso;
    const sbagliato = opzioni.passi.find(function (p) { return !leggiPasso(p) && !/^osserva\b/i.test(p); });
    if (sbagliato) {
      return { conta: conta, testo: 'passo non riconosciuto: "' + sbagliato + '". Passi possibili: ' + PASSI_POSSIBILI + '. Separali con ";".' };
    }
  }

  const righe = [];
  let numero = 0;

  // Script di Blender da eseguire con anteprima: e' una richiesta precisa, si fa solo quella.
  if (opzioni.blender) {
    const script = path.resolve(dir, opzioni.blender);
    const anteprima = path.join(os.tmpdir(), 'studio-screenshot', 'blender-' + Date.now() + '.png');
    fs.mkdirSync(path.dirname(anteprima), { recursive: true });
    righe.push((++numero) + ') LO SCRIPT ' + slash(path.relative(dir, script)) + ', eseguito in Blender senza finestra');
    const r = await provaInBlender('script', script, anteprima);
    if (r.errore && !r.modo) {
      righe.push('   non si e\' potuto eseguire: ' + r.errore);
    } else if (!r.ok) {
      conta.blender++;
      righe.push('   ERRORE' + (r.riga ? ' alla riga ' + r.riga : '') + ': ' + r.errore);
      if (r.traccia) righe.push('   ' + r.traccia.split(/\r?\n/).slice(-4).join(' | ').slice(0, 400));
    } else {
      righe.push('   eseguito fino in fondo in Blender ' + r.versione + ': ' + r.oggetti + ' oggetti nella scena' +
        (r.nuovi && r.nuovi.length ? ', creati: ' + r.nuovi.slice(0, 12).join(', ') : ', nessun oggetto nuovo') +
        (r.tolti && r.tolti.length ? ', tolti: ' + r.tolti.slice(0, 8).join(', ') : ''));
      if (r.anteprima) righe.push('   anteprima, da guardare con Read: ' + slash(r.anteprima) + ' (la scena di partenza di Blender ha cubo, camera e luce)');
      if (r.avviso) righe.push('   nota: ' + r.avviso);
    }
    return { testo: righe.concat(['', riepilogo(conta)]).join('\n'), conta: conta };
  }

  // Progetto Unity: il resto delle cartelle (Library, pacchetti) confonderebbe gli altri controlli.
  const unity = require('./cervello-unity');
  if (unity.trovaProgettoUnity(dir)) {
    const r = await unity.analizzaUnity(dir, { compila: true, console: true });
    const gravi = r.problemi.filter(function (p) { return p.grave; });
    conta.gravi += gravi.length;
    conta.avvisi += r.problemi.length - gravi.length;
    righe.push((++numero) + ') IL PROGETTO UNITY ' + (r.versione || '') + ' (' + r.fileCs + ' script C#' + (r.android ? ', app Android' : '') + ')');
    r.compilati.forEach(function (c) { righe.push('   compilato con il compilatore di Unity: ' + c.assembly + ', ' + c.file + ' file, ' + plurale(c.errori, 'errore', 'errori') + ' (' + c.durataMs + ' ms)'); });
    r.note.forEach(function (n) { righe.push('   nota: ' + n); });
    if (!r.problemi.length) righe.push('   nessun problema');
    r.problemi.slice(0, 15).forEach(function (p) { righe.push('   ' + (p.grave ? 'GRAVE ' : 'da controllare ') + p.file + ':' + p.riga + '  ' + p.messaggio); });
    if (r.problemi.length > 15) righe.push('   ... altri ' + (r.problemi.length - 15) + ': ' + comandi.COMANDO + ' --controlla');
    righe.push('   per provarlo davvero: premi Play in Unity; gli errori che escono in Console li rileggo con la prossima verifica.');
    return { testo: righe.concat(['', riepilogo(conta)]).join('\n'), conta: conta };
  }

  const progetto = cervello.analizzaProgettoCervello(dir);
  const conWeb = progetto.js.length || progetto.html.length || progetto.css.length;
  if (conWeb) {
    const gravi = progetto.problemi.filter(function (p) { return p.grave; }).length;
    conta.gravi += gravi;
    conta.avvisi += progetto.problemi.length - gravi;
    righe.push((++numero) + ') IL CODICE, controllato dal cervello del progetto (' + progetto.js.filter(function (a) { return !a.inline; }).length +
      ' script, ' + plurale(progetto.html.length, 'pagina', 'pagine') + ', ' + progetto.css.length + ' fogli di stile)');
    if (!progetto.problemi.length) righe.push('   nessun problema');
    progetto.problemi.slice(0, 12).forEach(function (p) {
      righe.push('   ' + (p.grave ? 'GRAVE ' : 'da controllare ') + p.file + ':' + p.riga + '  ' + p.messaggio);
    });
    if (progetto.problemi.length > 12) righe.push('   ... altri ' + (progetto.problemi.length - 12) + ': ' + comandi.COMANDO + ' --controlla');
    try { comandi.aggiornaMemoria(dir, progetto, null, opzioni.base); } catch (e) { /* la memoria non e' indispensabile */ }
  }

  const py = require('./cervello-python');
  if (py.haFilePython(dir)) {
    const r = await sezionePython(dir, conta, righe, ++numero);
    // Gli add-on di Blender si provano davvero: registrati e tolti in un Blender senza finestra.
    const addon = (r.file || []).filter(function (f) { return f.addon; }).slice(0, 2);
    for (const f of addon) {
      const percorso = path.join(dir, f.file);
      const bersaglio = path.basename(percorso) === '__init__.py' ? path.dirname(percorso) : percorso;
      const esito = await provaInBlender('addon', bersaglio);
      if (esito.errore && !esito.modo) {
        righe.push('   add-on ' + f.file + ': non provato in Blender (' + esito.errore + ')');
      } else if (!esito.ok) {
        conta.blender++;
        righe.push('   ADD-ON ' + f.file + ' in Blender ' + (esito.versione || '') + ': ERRORE' + (esito.riga ? ' alla riga ' + esito.riga : '') + ': ' + esito.errore);
      } else {
        righe.push('   add-on ' + f.file + ' registrato e tolto in Blender ' + esito.versione + ' senza errori' +
          (esito.registrate && esito.registrate.length ? ' (classi: ' + esito.registrate.slice(0, 8).join(', ') + ')' : '') +
          (esito.avviso ? '. Attenzione: ' + esito.avviso : ''));
      }
    }
  }

  // Un gioco Python con finestra si guarda mentre gira: dal codice non si vede se lo schermo
  // viene davvero aggiornato, ne' cosa succede quando una persona preme Spazio.
  await sezioneProgrammaPython(dir, opzioni, conta, righe, function () { return ++numero; });

  let pagine = (opzioni.pagine || []).map(slash);
  const sceltaAutomatica = !pagine.length;
  if (sceltaAutomatica) pagine = progetto.html.map(function (h) { return h.file; }).sort(ordinaPagine).slice(0, MAX_PAGINE);

  if (!pagine.length && !numero) {
    righe.push((++numero) + ') NESSUN FILE DA PROVARE: ' + consiglioPerNode(dir));
  } else if (!pagine.length && progetto.js.length && !progetto.html.length) {
    righe.push((++numero) + ') NESSUNA PAGINA HTML da aprire: ' + consiglioPerNode(dir));
  } else if (pagine.length) {
    let sonda = null;
    try { sonda = require('./sonda'); } catch (e) { righe.push((++numero) + ') Le pagine non si possono provare: ' + e.message); }
    for (let i = 0; sonda && i < pagine.length; i++) {
      const relativa = slash(path.relative(dir, path.resolve(dir, pagine[i])));
      righe.push((++numero) + ') LA PAGINA ' + relativa + ', aperta in un browser vero come farebbe una persona' +
        (opzioni.telefono ? ', larga come un telefono (' + TELEFONO.larghezza + 'x' + TELEFONO.altezza + ')' : ''));
      let r;
      try {
        r = await sonda.sondaPagina(Object.assign({
          dir: dir,
          pagina: relativa,
          // Adam aspetta la risposta per continuare: la fine della partita si aspetta 5 secondi,
          // non 15 come quando misura lo Studio per conto suo.
          attesaRiavvio: 5000,
          passi: i === 0 && opzioni.passi && opzioni.passi.length ? opzioni.passi : undefined,
          osserva: i === 0 && opzioni.osserva && opzioni.osserva.length ? opzioni.osserva : undefined
        }, opzioni.telefono ? TELEFONO : {}));
      } catch (e) {
        r = { errore: e.message };
      }
      if (!r || r.errore) {
        conta.nonProvate++;
        righe.push('   non si e\' potuta provare: ' + ((r && r.errore) || 'motivo sconosciuto'));
        continue;
      }
      conta.pagine++;
      if (r.tecnologia) {
        (r.tecnologia.contesti || []).forEach(function (c) { if (tecnologia.contesti.indexOf(c) === -1) tecnologia.contesti.push(c); });
        tecnologia.pointerLock += r.tecnologia.pointerLock || 0;
        (r.tecnologia.connessioni || []).forEach(function (c) { if (tecnologia.connessioni.indexOf(c) === -1) tecnologia.connessioni.push(c); });
        righe.push('   come disegna e si collega davvero: ' + [
          (r.tecnologia.contesti || []).length ? 'disegna con ' + r.tecnologia.contesti.join(', ') : 'nessun canvas usato',
          r.tecnologia.pointerLock ? 'blocco del mouse (vista in prima persona)' : '',
          (r.tecnologia.connessioni || []).length ? 'si collega a ' + r.tecnologia.connessioni.slice(0, 3).join(', ') : 'nessuna connessione di rete'
        ].filter(Boolean).join('; '));
      }
      if (r.azione && r.azione.descr) {
        const coperto = r.azione.ricevente && r.azione.ricevente !== r.azione.descr;
        righe.push('   azione principale: clic su ' + r.azione.descr + (r.azione.testo ? ' ("' + r.azione.testo + '")' : '') +
          (coperto ? ', ma il clic lo riceve ' + r.azione.ricevente + ': qualcosa copre il pulsante' : ''));
      }
      const errori = r.errori || [];
      conta.erroriPagina += errori.length;
      if (errori.length) {
        righe.push('   ERRORI JAVASCRIPT (fermano il programma):');
        errori.slice(0, 8).forEach(function (e) { righe.push('   - ' + e); });
      } else {
        righe.push('   nessun errore JavaScript');
      }
      // Quello che si vedrebbe aprendo gli strumenti di sviluppo: un console.error dentro un
      // try/catch non ferma niente, ma e' il programma che dice dove ha smesso di funzionare.
      const rete = r.rete || [];
      if (rete.length) {
        righe.push('   NON SI CARICANO (il browser li chiede e non li ottiene):');
        rete.slice(0, 6).forEach(function (v) { righe.push('   - ' + v.file + ' (' + v.motivo + ')'); });
      }
      const messaggi = (r.console || []).slice();
      const ordine = { errore: 0, avviso: 1, log: 2 };
      const peso = function (m) { return ordine[m.tipo] === undefined ? 2 : ordine[m.tipo]; };
      messaggi.sort(function (a, b) { return peso(a) - peso(b); });
      const erroriConsole = messaggi.filter(function (m) { return m.tipo === 'errore' && !m.nostro; });
      if (!messaggi.length) {
        righe.push('   console del browser: nessun messaggio');
      } else {
        righe.push('   console del browser: ' + messaggi.length +
          (messaggi.length === 1 ? ' messaggio' : ' messaggi') +
          (erroriConsole.length ? ', di cui ' + erroriConsole.length + ' in errore' : '') + ':');
        messaggi.slice(0, 8).forEach(function (m) {
          righe.push('   - [' + m.tipo + '] ' + m.testo + (m.dove ? ' [' + m.dove + ']' : '') +
            (m.volte > 1 ? ' (x' + m.volte + ')' : '') + (m.nostro ? ' <- lo causa la verifica, non il progetto' : ''));
        });
      }
      // Gli stessi difetti che conta lo Studio dopo ogni turno (confronto-misure.js): le note che
      // raccontano solo cosa e' stato provato restano note, non problemi.
      const problemi = require('./confronto-misure').fattiDellaSonda(r)
        .filter(function (f) { return !/^Errore JavaScript: /.test(f); });
      const informazioni = (r.note || []).filter(function (n) { return problemi.indexOf(n) === -1; });
      conta.fatti += problemi.length;
      const cambi = cosaCambia(r.momenti);
      if (cambi.length) righe.push('   cosa cambia nel tempo: ' + cambi.slice(0, 6).join(' | '));
      if (problemi.length) {
        righe.push('   PROBLEMI MISURATI:');
        problemi.slice(0, 6).forEach(function (n) { righe.push('   - ' + n); });
      }
      if (informazioni.length) righe.push('   note: ' + informazioni.slice(0, 3).join(' | '));
      const schermate = r.schermate || [];
      if (schermate.length) {
        righe.push('   schermate, da guardare con Read: ' + schermate.slice(0, 3).map(function (s) {
          return s.momento + ' ' + slash(s.file);
        }).join(' | '));
      }
    }
    if (sceltaAutomatica && progetto.html.length > pagine.length) {
      righe.push('   (provate ' + pagine.length + ' pagine su ' + progetto.html.length + ': per le altre ' + COMANDO + ' nomepagina.html)');
    }
  }

  sezioneRequisiti(dir, opzioni, tecnologia, conta, righe, function () { return ++numero; });

  righe.push('');
  righe.push(riepilogo(conta));
  return { testo: righe.join('\n'), conta: conta };
}

// Il programma Python eseguito davvero. "Il processo e' uscito con codice 0" non vuol dire che
// funzioni: il gioco del 16/9/2026 si fermava dopo 3 secondi con un TypeError e non aggiornava mai
// lo schermo, e Adam aveva scritto "Fatto!". Lo Studio lo lancia da solo solo se c'e' una finestra
// (pygame): uno script qualsiasi potrebbe fare qualunque cosa, e lo si lancia solo se lo si chiede.
async function sezioneProgrammaPython(dir, opzioni, conta, righe, prossimo) {
  const prova = require('./prova-python');
  const daLanciare = (opzioni.programmi && opzioni.programmi[0]) || null;
  if (!daLanciare && !prova.usaPygame(dir)) return null;
  const esito = await prova.provaPython(dir, { file: daLanciare, secondi: opzioni.secondi || 8 });
  const d = prova.problemiDellaProva(esito);
  righe.push(prossimo() + ') IL PROGRAMMA ESEGUITO DAVVERO (senza aprire finestre sullo schermo; Spazio, Invio e un clic come farebbe una persona)');
  d.righe.forEach(function (x) { righe.push('   ' + x); });
  d.problemi.forEach(function (p) {
    if (p.grave) conta.gravi++; else conta.avvisi++;
    righe.push('   ' + (p.grave ? 'GRAVE ' : 'da controllare ') + p.file + ':' + p.riga + '  ' + p.messaggio);
  });
  if (!d.problemi.length && esito.provato) righe.push('   nessun problema mentre girava');
  return esito;
}

// La richiesta dell'utente, punto per punto. Un programma senza errori puo' fare tutt'altro da
// quello che era stato chiesto: "ma non e' un fps multiplayer...", i file HTML ancora li' dopo
// "rimuovi l'html, fallo in python", il .bat che apre il file invece di usare localhost.
function sezioneRequisiti(dir, opzioni, tecnologia, conta, righe, prossimo) {
  let esito = null;
  try {
    esito = require('./requisiti').controllaRequisiti(dir, {
      base: opzioni.baseChat, richiesta: opzioni.richiesta, tecnologia: tecnologia
    });
  } catch (e) {
    return null;
  }
  if (!esito.punti.length) return esito;
  conta.requisiti = esito.punti.filter(function (p) { return !p.ok; }).length;
  righe.push(prossimo() + ') QUELLO CHE L\'UTENTE HA CHIESTO, punto per punto' +
    (opzioni.richiesta ? '' : ' (preso dalle vostre chat)'));
  esito.punti.forEach(function (p) {
    righe.push('   ' + (p.ok ? 'c\'e\': ' : 'MANCA: ') + p.nome + ' - ' + p.prova);
  });
  return esito;
}

function riepilogo(conta) {
  const bloccanti = conta.gravi + conta.erroriPagina + conta.testFalliti + conta.blender;
  if (!bloccanti && !conta.fatti && !conta.requisiti) {
    return 'RIEPILOGO: nessun errore' +
      (conta.pagine ? (conta.pagine === 1 ? ', e nessun errore nella pagina provata' : ', e nessun errore nelle ' + conta.pagine + ' pagine provate') : '') +
      (conta.avvisi ? ' (' + plurale(conta.avvisi, 'avviso', 'avvisi') + ' da controllare)' : '') + '.' +
      (conta.pagine ? ' Prima di dire che e\' fatto guarda almeno una schermata con Read: deve vedersi quello che l\'utente ha chiesto.' : '') +
      ' Rileggi la richiesta dell\'utente punto per punto e controlla che ci sia tutto.';
  }
  return 'RIEPILOGO: NON e\' ancora a posto: ' + [
    conta.gravi ? plurale(conta.gravi, 'errore grave', 'errori gravi') + ' nel codice' : '',
    conta.erroriPagina ? plurale(conta.erroriPagina, 'errore JavaScript', 'errori JavaScript') + ' nelle pagine' : '',
    conta.testFalliti ? 'test falliti' : '',
    conta.blender ? plurale(conta.blender, 'errore in Blender', 'errori in Blender') : '',
    conta.fatti ? plurale(conta.fatti, 'problema misurato', 'problemi misurati') : '',
    conta.requisiti ? plurale(conta.requisiti, 'punto della richiesta dell\'utente non ancora fatto', 'punti della richiesta dell\'utente non ancora fatti') : ''
  ].filter(Boolean).join(', ') + '.\nCOSA FARE ADESSO: correggi prima gli errori gravi (spesso il primo blocca tutto il resto), poi rilancia ' +
    COMANDO + '.' + (conta.requisiti ? ' I punti segnati MANCA vanno fatti davvero: se uno non si puo\' fare, scrivilo chiaro all\'utente, non dire che e\' fatto.' : '') +
    ' Di\' che e\' fatto solo quando la verifica e\' pulita.';
}

// Le istruzioni per Adam, nel prompt di sistema.
function testoPerPrompt(dir) {
  let tipi = null;
  try { tipi = require('./esperti').tipiDelProgetto(dir); } catch (e) { tipi = null; }
  const conPagine = !!(tipi && tipi.web);
  const righe = ['VERIFICA PRIMA DI DIRE "FATTO": un programmatore esperto non indovina, esegue e guarda. Dopo aver scritto o corretto codice:'];
  if (conPagine) {
    righe.push('- lancia ' + COMANDO + ': controlla il codice e apre ogni pagina in un Chrome vero (clic, mouse, tasti); riporta errori JavaScript con la riga, la console del browser (log/warn/error con file e riga), i file che non si caricano, cosa cambia nel tempo e schermo vuoto;');
    righe.push('- la console del browser la leggi da li\': non chiederla all\'utente;');
    righe.push('- azione precisa: ' + COMANDO + ' pagina.html --passi "clic #btn-start; trascina #volume | 75%; attendi 200" (passi: ' + PASSI_POSSIBILI + '); valori nel tempo: --osserva "PLAYER.health";');
    righe.push('- guarda le schermate con Read: deve vedersi quello che l\'utente ha chiesto;');
  }
  if (tipi && (tipi.unity || tipi.python || tipi.blender)) {
    righe.push('- ' + (conPagine ? 'lo stesso comando' : 'lancia ' + COMANDO + ':') + ' ' + [
      tipi.unity ? 'compila gli script Unity con il compilatore di Unity e legge la Console' : '',
      tipi.python ? 'controlla il codice Python, ESEGUE davvero il programma se ha una finestra (schermo aggiornato? errori con la riga?) e lancia i test se ci sono; un programma preciso: ' + COMANDO + ' main.py' : '',
      tipi.blender ? 'prova gli add-on in Blender (e con --blender script.py esegue uno script e salva l\'anteprima)' : ''
    ].filter(Boolean).join('; ') + ';');
  }
  if (!conPagine && !(tipi && (tipi.unity || tipi.python || tipi.blender))) {
    righe.push('- controlla il codice con ' + comandi.COMANDO + ' --controlla, poi esegui davvero il programma e leggi l\'uscita;');
  }
  righe.push('- la verifica confronta anche la richiesta dell\'utente punto per punto: se un punto MANCA, fallo o dillo chiaro, non dire "fatto";');
  righe.push('- lanciala con Bash senza abbassare il tempo massimo (mai sotto 180000): dura circa mezzo minuto;');
  righe.push('- se trovi errori correggili e rilancia finche\' e\' pulita: solo allora di\' che e\' fatto, scrivendo cosa hai verificato.');
  return righe.join('\n');
}

const USO = [
  'Verifica completa del progetto. Uso: ' + COMANDO + ' [pagina.html ...] [programma.py] [--passi "..."] [--osserva "a;b"] [--telefono] [--blender script.py] [--dir cartella]',
  '  senza argomenti: controlla il codice, prova fino a ' + MAX_PAGINE + ' pagine HTML, esegue il programma Python se apre una finestra; per Unity compila e legge la Console',
  '  programma.py: esegue quel programma per qualche secondo e guarda cosa fa (--secondi N per cambiare la durata)',
  '  --richiesta "...": confronta il risultato con questa richiesta invece che con quelle delle vostre chat',
  '  --passi: ' + PASSI_POSSIBILI + ' (separati da ";")',
  '  --osserva: espressioni JavaScript da seguire nel tempo, separate da ";"',
  '  --telefono: apre le pagine larghe come un telefono',
  '  --blender script.py: esegue lo script in Blender senza finestra e salva un\'anteprima'
].join('\n');

if (require.main === module) {
  const o = leggiArgomenti(process.argv.slice(2));
  if (o.aiuto) {
    console.log(USO);
    process.exit(0);
  }
  verifica(o).then(function (r) {
    console.log(r.testo);
    const c = r.conta;
    process.exit(c.gravi + c.erroriPagina + c.fatti + c.testFalliti + c.blender ? 1 : 0);
  }, function (e) {
    console.log('Verifica non riuscita: ' + e.message);
    process.exit(1);
  });
}

module.exports = { verifica: verifica, testoPerPrompt: testoPerPrompt, leggiArgomenti: leggiArgomenti, trovaBlender: trovaBlender, COMANDO: COMANDO };
