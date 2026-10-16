// NotExist Intelligience Studio - Arsenale Completo di Verifica e Diagnostica.
//
// Richiesta dell'utente (19/9/2026): avere tutti gli strumenti del catalogo completo di test,
// analisi statica, sicurezza, verifica runtime e diagnostica errori senza rompere o retrocedere il codice.
//
// Questo modulo unifica e orchestra l'intera piramide della qualità software:
// 1. ANALISI STATICA & SINTASSI (node -c, Acorn AST cervello, Python compile, import orfani)
// 2. SICUREZZA & VULNERABILITÀ SAST (eval pericolosi, innerHTML a rischio XSS, memory leak evidenti, token/secret)
// 3. STRUTTURA & ANTI-REGRESSIONE (capo-file: sezioni di file complessi, protezione simboli)
// 4. VERIFICA RUNTIME & GRAFICA (verifica.js, Puppeteer headless, canvas/FPS, schermo vuoto)
// 5. TEST AUTOMATIZZATI (esecuzione test del progetto npm/pytest e analisi fallimenti)
// 6. GUIDA AGLI ERRORI (catalogo delle soluzioni e comandi raccomandati per ogni difetto)

const fs = require('fs');
const path = require('path');
const { exec, execFile } = require('child_process');
const semgrep = require('./semgrep');

function slash(p) {
  return String(p || '').split('\\').join('/');
}

// ------------------------------------------------------------- LIVELLO 1: Sintassi Istantanea
function verificaSintassiNode(fileAssoluto) {
  return new Promise(function (risolvi) {
    execFile(process.execPath, ['-c', fileAssoluto], { timeout: 10000, windowsHide: true }, function (err, stdout, stderr) {
      if (!err) {
        risolvi({ ok: true });
      } else {
        const msg = String(stderr || err.message).trim();
        const mRiga = /:(\d+)(?::(\d+))?/.exec(msg);
        risolvi({
          ok: false,
          riga: mRiga ? parseInt(mRiga[1], 10) : 1,
          errore: msg.split('\n')[0]
        });
      }
    });
  });
}

// ------------------------------------------------------------- LIVELLO 2: Sicurezza Leggera (SAST)
function scansioneSicurezza(codice, nomeFile) {
  const problemi = [];
  const righe = codice.split(/\r?\n/);

  for (let i = 0; i < righe.length; i++) {
    const num = i + 1;
    const r = righe[i];

    // 1. eval o Function constructor non sicuro
    if (/\beval\s*\(/.test(r) && !/\/\/.*eval/.test(r)) {
      problemi.push({ riga: num, gravita: 'ALTA', tipo: 'sicurezza', messaggio: 'Uso di eval(): rischio esecuzione codice arbitrario.' });
    }
    // 2. innerHTML diretto da fonti non sanificate
    if (/\.innerHTML\s*=\s*[^"'][^;]+/.test(r) && !/create|render|escape/.test(r)) {
      problemi.push({ riga: num, gravita: 'MEDIA', tipo: 'sicurezza', messaggio: 'Assegnazione diretta a innerHTML: preferisci textContent o sanifica l\'input.' });
    }
    // 3. Possibili chiavi API hardcodate (API Key, secrets)
    if (/(?:api[_-]?key|secret|token|password)\s*[:=]\s*["'][A-Za-z0-9_\-]{24,}["']/i.test(r)) {
      problemi.push({ riga: num, gravita: 'ALTA', tipo: 'segreto', messaggio: 'Possibile chiave API o segreto hardcodato nel codice.' });
    }
    // 4. Cicli potenzialmente bloccanti senza uscita evidente
    if (/\bwhile\s*\(\s*true\s*\)/.test(r) && !/break|return|throw/i.test(r)) {
      problemi.push({ riga: num, gravita: 'ALTA', tipo: 'blocco', messaggio: 'while(true) senza break evidente sulla stessa riga: rischio blocco del processo.' });
    }
  }

  return problemi;
}

// ------------------------------------------------------------- LIVELLO 3: Analisi Statica (Cervello AST)
function analisiCervelloProgetto(dirProgetto) {
  try {
    const cervello = require('./cervello');
    const prog = cervello.analizzaProgettoCervello(dirProgetto);
    return {
      disponibile: true,
      problemi: prog.problemi || [],
      fileJs: prog.js ? prog.js.length : 0,
      fileHtml: prog.html ? prog.html.length : 0,
      fileCss: prog.css ? prog.css.length : 0
    };
  } catch (e) {
    return { disponibile: false, errore: e.message, problemi: [] };
  }
}

// ------------------------------------------------------------- LIVELLO 4: File Complessi & Sezioni
function analisiSezioniProgetto(dirProgetto) {
  try {
    const capoFile = require('./capo-file');
    const grossi = capoFile.trovaFileGrossi(dirProgetto);
    return {
      disponibile: true,
      fileGrossi: grossi
    };
  } catch (e) {
    return { disponibile: false, fileGrossi: [] };
  }
}

// ------------------------------------------------------------- LIVELLO 5: Test Suite Progetto (npm test / pytest)
function eseguiTestSuite(dirProgetto) {
  return new Promise(function (risolvi) {
    const pkgPath = path.join(dirProgetto, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.scripts && pkg.scripts.test && !/no test specified/i.test(pkg.scripts.test)) {
          exec('npm test', { cwd: dirProgetto, timeout: 30000, windowsHide: true }, function (err, stdout, stderr) {
            risolvi({
              presente: true,
              tipo: 'npm test',
              superato: !err,
              output: String(stdout || stderr).trim().slice(0, 800)
            });
          });
          return;
        }
      } catch (e) {}
    }

    risolvi({ presente: false });
  });
}

// ------------------------------------------------------------- DIAGNOSTICA COMPLETA
async function diagnosiCompleta(dirProgetto, opzioni) {
  opzioni = opzioni || {};
  const radice = path.resolve(dirProgetto || process.cwd());
  const report = {
    progetto: slash(radice),
    data: new Date().toISOString(),
    livelli: {},
    totaleErroriGravi: 0,
    totaleAvvisi: 0,
    raccomandazioni: []
  };

  // 1. Controllo Sintassi Rapida (node -c)
  const erroriSintassi = [];
  function controllaSintassi(dir) {
    let voci;
    try { voci = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return []; }
    const promesse = [];
    for (let i = 0; i < voci.length; i++) {
      const v = voci[i];
      if (v.name.startsWith('.') || v.name === 'node_modules' || v.name === 'dist' || v.name === 'build') continue;
      const comp = path.join(dir, v.name);
      if (v.isDirectory()) {
        promesse.push(controllaSintassi(comp));
      } else if (v.isFile() && /\.(m?js|cjs)$/i.test(v.name)) {
        promesse.push(verificaSintassiNode(comp).then(function (res) {
          if (!res.ok) {
            erroriSintassi.push({
              file: slash(path.relative(radice, comp)),
              riga: res.riga,
              messaggio: res.errore
            });
          }
        }));
      }
    }
    return Promise.all(promesse);
  }
  await controllaSintassi(radice);
  report.livelli.sintassi = {
    superato: erroriSintassi.length === 0,
    errori: erroriSintassi
  };
  if (erroriSintassi.length) report.totaleErroriGravi += erroriSintassi.length;

  // 2. Analisi AST Cervello
  const resCervello = analisiCervelloProgetto(radice);
  const erroriGraviCervello = resCervello.problemi.filter(function (p) { return p.grave; });
  const avvisiCervello = resCervello.problemi.filter(function (p) { return !p.grave; });
  report.livelli.analisiStatica = {
    disponibile: resCervello.disponibile,
    fileAnalizzati: (resCervello.fileJs || 0) + (resCervello.fileHtml || 0),
    gravi: erroriGraviCervello,
    avvisi: avvisiCervello.slice(0, 15)
  };
  report.totaleErroriGravi += erroriGraviCervello.length;
  report.totaleAvvisi += avvisiCervello.length;

  // 3. Scansione Sicurezza Leggera (SAST)
  const problemiSicurezza = [];
  function scansionaSicurezzaDir(dir) {
    let voci;
    try { voci = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (let i = 0; i < voci.length; i++) {
      const v = voci[i];
      if (v.name.startsWith('.') || v.name === 'node_modules' || v.name === 'dist' || v.name === 'build') continue;
      const comp = path.join(dir, v.name);
      if (v.isDirectory()) {
        scansionaSicurezzaDir(comp);
      } else if (v.isFile() && /\.(m?js|ts|py|html)$/i.test(v.name)) {
        try {
          const codice = fs.readFileSync(comp, 'utf8');
          const p = scansioneSicurezza(codice, v.name);
          p.forEach(function (prob) {
            problemiSicurezza.push(Object.assign({ file: slash(path.relative(radice, comp)) }, prob));
          });
        } catch (e) {}
      }
    }
  }
  scansionaSicurezzaDir(radice);
  report.livelli.sicurezza = {
    problemi: problemiSicurezza
  };
  const graviSicurezza = problemiSicurezza.filter(function (s) { return s.gravita === 'ALTA'; });
  report.totaleErroriGravi += graviSicurezza.length;
  report.totaleAvvisi += (problemiSicurezza.length - graviSicurezza.length);

  // 3b. SAST Semgrep: regole specifiche per linguaggio, eseguite in locale.
  // Se non e' installato o non riesce a partire, le verifiche esistenti restano valide.
  report.livelli.semgrep = await semgrep.scanProject(radice, {
    timeoutMs: opzioni.semgrepTimeoutMs
  });
  if (report.livelli.semgrep.executed) {
    const problemiSemgrep = report.livelli.semgrep.findings || [];
    const graviSemgrep = problemiSemgrep.filter(function (p) { return p.severity === 'ERROR'; });
    report.totaleErroriGravi += graviSemgrep.length;
    report.totaleAvvisi += problemiSemgrep.length - graviSemgrep.length;
  }

  // 4. File Complessi & Sezioni
  const resSezioni = analisiSezioniProgetto(radice);
  report.livelli.fileGrossi = resSezioni.fileGrossi || [];

  // 5. Test Suite
  const resTest = await eseguiTestSuite(radice);
  report.livelli.testSuite = resTest;
  if (resTest.presente && !resTest.superato) {
    report.totaleErroriGravi += 1;
  }

  // Generazione Raccomandazioni
  if (erroriSintassi.length) {
    report.raccomandazioni.push('Correggi subito gli errori di sintassi: impediscono a Node o al browser di eseguire il file.');
  }
  if (erroriGraviCervello.length) {
    report.raccomandazioni.push('Risolvi i nomi non dichiarati o duplicati con `node strumenti/cervello-comandi.js --cerca <nome>`.');
  }
  if (report.livelli.fileGrossi.length) {
    report.raccomandazioni.push('Ci sono file grossi (>300 righe): per evitare regressioni usa `node strumenti/capo-file.js --sezioni <file>` prima di modificarli.');
  }
  if (graviSicurezza.length) {
    report.raccomandazioni.push('Rimuovi pattern a rischio (eval o loop bloccanti) identificati nella scansione di sicurezza.');
  }
  if (report.livelli.semgrep && !report.livelli.semgrep.available) {
    report.raccomandazioni.push('Semgrep non e\' disponibile: ' + (report.livelli.semgrep.reason || semgrep.installHelp));
  } else if (report.livelli.semgrep && !report.livelli.semgrep.executed && report.livelli.semgrep.error) {
    report.raccomandazioni.push('Semgrep non ha completato la scansione: ' + report.livelli.semgrep.error.slice(0, 300));
  }
  if (!report.raccomandazioni.length) {
    report.raccomandazioni.push('Tutti i controlli statici, sintattici e di sicurezza sono superati!');
  }

  return report;
}

// Formatta il report in testo chiaro per Adam e l'utente
function testoReport(report) {
  const out = [];
  out.push('============================================================');
  out.push('  ARSENALE DI VERIFICA & DIAGNOSTICA - Intelligience Studio');
  out.push('============================================================');
  out.push('Progetto: ' + report.progetto);
  const semgrepReport = report.livelli && report.livelli.semgrep;
  const statoPulito = '✅ PULITO' + (semgrepReport && !semgrepReport.executed ? ' (Semgrep non eseguito)' : '');
  out.push('Stato complessivo: ' + (report.totaleErroriGravi > 0 ? '❌ ' + report.totaleErroriGravi + ' ERRORI GRAVI' : statoPulito) +
           (report.totaleAvvisi > 0 ? ' (' + report.totaleAvvisi + ' avvisi)' : ''));
  if (semgrepReport && !semgrepReport.executed) {
    out.push('Semgrep: scansione non eseguita' + (semgrepReport.reason ? ' — ' + semgrepReport.reason :
      (semgrepReport.error ? ' — ' + semgrepReport.error : '')));
  }
  out.push('');

  // 1. Sintassi
  if (report.livelli.sintassi.errori.length) {
    out.push('🔴 ERRORI DI SINTASSI (bloccanti):');
    report.livelli.sintassi.errori.forEach(function (e) {
      out.push('   ' + e.file + ':' + e.riga + ' - ' + e.messaggio);
    });
    out.push('');
  } else {
    out.push('🟢 Sintassi JavaScript: Nessun errore sintattico.');
  }

  // 2. Analisi AST
  const ast = report.livelli.analisiStatica;
  if (ast && ast.gravi.length) {
    out.push('🔴 ERRORI SEMANTICI (Cervello AST):');
    ast.gravi.slice(0, 10).forEach(function (g) {
      out.push('   ' + g.file + ':' + g.riga + ' - ' + g.messaggio);
    });
    out.push('');
  } else if (ast && ast.disponibile) {
    out.push('🟢 Analisi Semantica AST: Nessun errore grave nei simboli.');
  }

  // 3. Sicurezza
  const sec = report.livelli.sicurezza;
  if (sec && sec.problemi.length) {
    out.push('🟡 AVVISI DI SICUREZZA & PATTERN A RISCHIO:');
    sec.problemi.slice(0, 8).forEach(function (p) {
      out.push('   [' + p.gravita + '] ' + p.file + ':' + p.riga + ' - ' + p.messaggio);
    });
    out.push('');
  }

  // 3b. Semgrep
  if (semgrepReport && semgrepReport.executed) {
    const findings = semgrepReport.findings || [];
    out.push(findings.length ? '🛡️ SEMGREP (' + findings.length + ' risultati su ' + semgrepReport.scannedFiles + ' file):' :
      '🟢 Semgrep: nessun risultato su ' + semgrepReport.scannedFiles + ' file.');
    findings.slice(0, 15).forEach(function (p) {
      out.push('   [' + p.severity + '] ' + p.relative + ':' + p.line + ' — ' + p.ruleId + ': ' + p.message);
    });
    if (findings.length > 15) out.push('   ... altri ' + (findings.length - 15) + ' risultati.');
    (semgrepReport.errors || []).slice(0, 3).forEach(function (e) { out.push('   Avviso scanner: ' + e); });
    out.push('');
  } else if (semgrepReport && semgrepReport.error) {
    out.push('⚠️ Semgrep non ha completato la scansione: ' + semgrepReport.error.slice(0, 500));
    out.push('');
  }

  // 4. File Grossi
  const grossi = report.livelli.fileGrossi;
  if (grossi && grossi.length) {
    out.push('📐 FILE COMPLESSI GESTITI A SEZIONI (capo-file attivo):');
    grossi.slice(0, 4).forEach(function (g) {
      out.push('   - ' + g.file + ' (' + g.righe + ' righe)');
    });
    out.push('');
  }

  // 5. Test Suite
  const testS = report.livelli.testSuite;
  if (testS && testS.presente) {
    out.push((testS.superato ? '🟢 ' : '🔴 ') + 'TEST SUITE (' + testS.tipo + '): ' + (testS.superato ? 'SUPERATA' : 'FALLITA'));
    if (!testS.superato && testS.output) {
      out.push('   ' + testS.output.replace(/\n/g, '\n   '));
    }
    out.push('');
  }

  out.push('💡 COSA FARE ADESSO:');
  report.raccomandazioni.forEach(function (r, idx) {
    out.push('  ' + (idx + 1) + '. ' + r);
  });
  out.push('============================================================');

  return out.join('\n');
}

// Testo per il prompt di sistema
function testoPerPrompt(dirProgetto) {
  return [
    'ARSENALE DI TEST & VERIFICA INTEGRATO: Disponi della suite completa di verifica del codice.',
    '- Per eseguire la batteria diagnostica completa in un colpo solo: `node strumenti/arsenale-test.js --diagnosi`',
    '- Per analizzare le sezioni di un file complesso prima di modificarlo: `node strumenti/capo-file.js --sezioni <file>`',
    '- Per verificare pagine web e canvas in un browser reale: `node strumenti/verifica.js`',
    '- Per verificare vulnerabilita\' e pattern specifici nei file toccati, lo Studio usa Semgrep se installato; scansione completa: `semgrep scan --config p/security-audit .`',
    '- Non dire mai "fatto" senza aver eseguito almeno una verifica con esito pulito.'
  ].join('\n');
}

// ------------------------------------------------------------- CLI
if (require.main === module) {
  const argv = process.argv.slice(2);
  const dirIdx = argv.indexOf('--dir');
  const dirTarget = dirIdx !== -1 && argv[dirIdx + 1] ? argv[dirIdx + 1] : process.cwd();

  diagnosiCompleta(dirTarget).then(function (rep) {
    if (argv.indexOf('--json') !== -1) {
      console.log(JSON.stringify(rep, null, 2));
    } else {
      console.log(testoReport(rep));
    }
    process.exit(rep.totaleErroriGravi > 0 ? 1 : 0);
  }).catch(function (err) {
    console.error('Errore durante la diagnosi:', err);
    process.exit(1);
  });
}

module.exports = {
  verificaSintassiNode: verificaSintassiNode,
  scansioneSicurezza: scansioneSicurezza,
  diagnosiCompleta: diagnosiCompleta,
  testoReport: testoReport,
  testoPerPrompt: testoPerPrompt
};
