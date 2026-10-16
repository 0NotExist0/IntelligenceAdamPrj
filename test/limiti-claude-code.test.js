// Estrae da server.js il calcolo dei limiti che Claude Code applica da solo e lo prova sui casi
// misurati dal vivo: con una finestra da 16384 token Adam si fermava dopo una sola risposta.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');

const start = src.indexOf('function parametriCompattazione(finestra)');
const end = src.indexOf("// PERCHE' LA MEMORIA E' SALVATA COME TESTO");
if (start === -1 || end === -1 || end < start) {
  console.error('Funzioni non trovate in server.js: aggiorna gli indicatori di inizio e fine del test.');
  process.exit(1);
}
let config = { maxOutputTokens: 0 };   // parametriCompattazione legge questa variabile
eval(src.slice(start, end));

let pass = 0, fail = 0;
function check(nome, ottenuto, atteso) {
  const ok = JSON.stringify(ottenuto) === JSON.stringify(atteso);
  ok ? pass++ : fail++;
  console.log((ok ? '  PASS  ' : '! FAIL  ') + nome.padEnd(66) +
    ' atteso=' + JSON.stringify(atteso) + ' ottenuto=' + JSON.stringify(ottenuto));
}

// Numeri ricavati dal codice di Claude Code 2.1.267: blocco = finestra - output - 3000,
// compattazione = min(pct% di (finestra - output), finestra - output - 13000).
check('16384 token: blocco a 9288, compattazione sotto zero', limitiClaudeCode(16384), { compattazione: -712, blocco: 9288 });
check('32768 token: blocco a 25672, compattazione a 15672', limitiClaudeCode(32768), { compattazione: 15672, blocco: 25672 });
check('finestra sconosciuta: nessun limite', limitiClaudeCode(0), null);

// CASO REALE (15/09/2026, qwen3.5-aggressive-q6:9b): la prima risposta della sessione occupava 9129 token.
check('CASO REALE: base 9129 su 16384 = sessione senza spazio', sessioneSenzaSpazio(9129, 16384), true);
check('stessa base su 32768 = spazio sufficiente', sessioneSenzaSpazio(9129, 32768), false);
check('base con report di passaggio (10260) su 32768 = spazio sufficiente', sessioneSenzaSpazio(10260, 32768), false);
check('prompt piccolo (5000) su 16384 = spazio sufficiente', sessioneSenzaSpazio(5000, 16384), false);
check('finestra sconosciuta: mai "senza spazio"', sessioneSenzaSpazio(9129, 0), false);

// Con un tetto di output scelto nelle impostazioni i limiti seguono quel tetto.
config = { maxOutputTokens: 2048 };
check('tetto di output 2048 su 16384: blocco a 11336', limitiClaudeCode(16384).blocco, 11336);

console.log('\n' + pass + ' passati, ' + fail + ' falliti');
process.exit(fail ? 1 : 0);
