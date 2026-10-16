// Prova l'arsenale completo di verifica e diagnostica.
// Richiesta dell'utente del 19/9/2026: avere tutti gli strumenti del catalogo completo di test,
// analisi statica, sicurezza e verifica senza rompere o retrocedere il codice.

const fs = require('fs');
const os = require('os');
const path = require('path');
const arsenale = require('../strumenti/arsenale-test');

let pass = 0;
let fail = 0;
function check(nome, condizione, dettaglio) {
  if (condizione) {
    pass++;
    console.log('  ok   ' + nome);
  } else {
    fail++;
    console.log('  FAIL ' + nome + (dettaglio !== undefined ? '  -> ' + dettaglio : ''));
  }
}

const dirTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arsenale-test-'));

async function eseguiTest() {
  try {
    console.log('\n=== Controllo Sintattico Rapido (node -c) ===');
    const fileValido = path.join(dirTmp, 'valido.js');
    fs.writeFileSync(fileValido, 'const a = 10;\nfunction test() { return a * 2; }\n');
    const resValido = await arsenale.verificaSintassiNode(fileValido);
    check('file con sintassi valida passa', resValido.ok === true);

    const fileInvalido = path.join(dirTmp, 'invalido.js');
    fs.writeFileSync(fileInvalido, 'const a = ; // Errore di sintassi\n');
    const resInvalido = await arsenale.verificaSintassiNode(fileInvalido);
    check('file con sintassi errata viene intercettato con riga', resInvalido.ok === false && resInvalido.riga === 1);

    console.log('\n=== Scansione Sicurezza e Vulnerabilità (SAST) ===');
    const codiceInsicuro = [
      'const apiKey = "sk-1234567890abcdef1234567890abcdef";',
      'eval("console.log(1)");',
      'element.innerHTML = userInput;',
      'while(true) {}'
    ].join('\n');
    const problemi = arsenale.scansioneSicurezza(codiceInsicuro, 'insicuro.js');
    check('rileva token/api key', problemi.some(function (p) { return p.tipo === 'segreto'; }));
    check('rileva eval()', problemi.some(function (p) { return p.messaggio.indexOf('eval') !== -1; }));
    check('rileva loop infinito sincrono', problemi.some(function (p) { return p.tipo === 'blocco'; }));

    const codiceSicuro = 'const x = 5;\nconsole.log(x);\n';
    const problemiSicuri = arsenale.scansioneSicurezza(codiceSicuro, 'sicuro.js');
    check('codice pulito non ha falsi positivi di sicurezza', problemiSicuri.length === 0);

    console.log('\n=== Diagnosi Completa del Progetto ===');
    // Rimuoviamo il file invalido per testare la diagnosi su cartella pulita
    fs.unlinkSync(fileInvalido);
    const report = await arsenale.diagnosiCompleta(dirTmp);
    check('genera report completo con tutti i livelli', report && report.livelli && report.livelli.sintassi);
    check('include lo stato separato della scansione Semgrep', report.livelli.semgrep &&
      typeof report.livelli.semgrep.executed === 'boolean', JSON.stringify(report.livelli.semgrep));
    check('sintassi valida segnalata nel report', report.livelli.sintassi.superato === true);
    check('raccomandazioni generate correttamente', Array.isArray(report.raccomandazioni) && report.raccomandazioni.length > 0);
    if (!report.livelli.semgrep.executed) {
      check('scanner Semgrep assente/non disponibile dichiarato nel report', /Semgrep: scansione non eseguita/.test(arsenale.testoReport(report)), arsenale.testoReport(report));
    }

    console.log('\n=== Formattazione Testo del Report e Prompt ===');
    const testo = arsenale.testoReport(report);
    check('il report contiene l\'intestazione dell\'arsenale', testo.indexOf('ARSENALE DI VERIFICA') !== -1);
    check('il prompt contiene le istruzioni per Adam', arsenale.testoPerPrompt(dirTmp).indexOf('--diagnosi') !== -1);

  } finally {
    try {
      fs.rmSync(dirTmp, { recursive: true, force: true });
    } catch (e) {}
  }

  console.log('\n----------------------------------------');
  console.log('Esito test arsenale: ' + pass + ' passati, ' + fail + ' falliti.');
  process.exit(fail ? 1 : 0);
}

eseguiTest();
