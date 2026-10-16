'use strict';

// Test per strumenti/whatsapp-protettore.js
// Verifica: rilevamento euristiche truffe, phishing, OTP, rabbia, link sospetti,
// estrazione JSON e generazione prompt di protezione.

const protettore = require('../strumenti/whatsapp-protettore');

let pass = 0;
let fail = 0;

function check(nome, condizione, dettaglio) {
  if (condizione) {
    pass++;
    console.log('  ok   ' + nome);
  } else {
    fail++;
    console.log('  FAIL ' + nome + (dettaglio ? '  -> ' + dettaglio : ''));
  }
}

console.log('\n=== Rilevamento Truffe & Phishing (Euristica) ===');

// 1. Truffa finto figlio
const rFiglio = protettore.analizzaEuristica('Ciao mamma, ho perso il cellulare e questo è il mio nuovo numero, scrivimi qui su whatsapp!');
check('finto figlio: truffa rilevata', rFiglio.truffa.rilevata);
check('finto figlio: rischio critico', rFiglio.rischio === 'critico');
check('finto figlio: id pattern', rFiglio.truffa.tipi.some(t => t.id === 'finto_figlio_parente'));

// 2. Richiesta codice OTP
const rOtp = protettore.analizzaEuristica('Ti ho inviato un codice a 6 cifre per errore, me lo puoi rimandare subito?');
check('richiesta OTP: truffa rilevata', rOtp.truffa.rilevata);
check('richiesta OTP: punteggio altissimo', rOtp.punteggioRischio >= 95);

// 3. Phishing bancario
const rBanca = protettore.analizzaEuristica('Postepay: rilevato accesso anomalo sul tuo conto bloccato. Aggiorna i tuoi dati.');
check('phishing banca: truffa rilevata', rBanca.truffa.rilevata);
check('phishing banca: rischio alto o critico', rBanca.rischio === 'alto' || rBanca.rischio === 'critico');

// 4. Link sospetti (IP nudo)
const rLinkIp = protettore.analizzaEuristica('Clicca qui per confermare la tua identità: http://194.26.29.112/login');
check('link IP nudo: rilevato come sospetto', rLinkIp.linkSospetti.length > 0);
check('link IP nudo: rischio almeno medio', rLinkIp.rischio !== 'basso');

// 5. Messaggio normale (nessuna truffa)
const rNormale = protettore.analizzaEuristica('Ciao Marco, ci vediamo stasera per la pizza alle 20? Fammi sapere!');
check('messaggio normale: nessuna truffa', !rNormale.truffa.rilevata);
check('messaggio normale: rischio basso', rNormale.rischio === 'basso');
check('messaggio normale: non arrabbiato', !rNormale.emozione.arrabbiata);

console.log('\n=== Rilevamento Emotivo & Rabbia ===');

// 1. Rabbia esplicita
const rRabbia = protettore.analizzaEuristica('Sei un incompetente idiota! Non voglio più sentirti!');
check('insulti: arrabbiato rilevato', rRabbia.emozione.arrabbiata);
check('insulti: tipo aggressivo o arrabbiato', rRabbia.emozione.tipo === 'aggressivo' || rRabbia.emozione.tipo === 'arrabbiato');

// 2. Maiuscolo / Urla
const rCaps = protettore.analizzaEuristica('DOVE SEI FINITO RISPONDI SUBITO A QUESTO MESSAGGIO');
check('all caps: arrabbiato rilevato', rCaps.emozione.arrabbiata);

// 3. Passivo-aggressivo
const rPassivo = protettore.analizzaEuristica('Fai come ti pare, tanto non ti importa nulla...');
check('passivo-aggressivo: tipo rilevato', rPassivo.emozione.tipo === 'passivo-aggressivo');

console.log('\n=== Prompt & Estrazione JSON ===');

const prompt = protettore.buildPromptAnalisi('+39 340 1234567', 'Ho perso il telefono mandami 500 euro', [
  { daMe: false, mittente: 'Sconosciuto', testo: 'Ciao' }
]);
check('prompt contiene mittente', prompt.includes('+39 340 1234567'));
check('prompt contiene messaggio', prompt.includes('Ho perso il telefono mandami 500 euro'));
check('prompt richiede json', prompt.includes('FORMATO JSON RICHIESTO'));

// Estrazione JSON da markdown fences
const jsonRaw = '```json\n{"intenzione":"Truffa","livelloRischio":"critico"}\n```';
const parsed = protettore.estraiJson(jsonRaw);
check('estrazione JSON pulita', parsed && parsed.intenzione === 'Truffa' && parsed.livelloRischio === 'critico');

console.log('\n=== analizzaMessaggio (Metodo Completo) ===');

protettore.analizzaMessaggio({
  contatto: 'Sconosciuto (+39 349 9999999)',
  messaggio: 'Ciao mamma, ho perso il telefono, questo è il mio nuovo numero scrivimi qui!',
  usaLlm: false // test modalità euristica immediata
}).then(function (res) {
  check('risultato completo: contatto presente', res.contatto.includes('Sconosciuto'));
  check('risultato completo: truffa segnalata', res.truffa.rilevata);
  check('risultato completo: consiglio presente', res.consiglio && res.consiglio.length > 10);
  check('risultato completo: risposta suggerita', res.rispostaSuggerita && res.rispostaSuggerita.length > 5);

  console.log('\n=== WhatsAppBridge (Gestore Connessione & Scenari) ===');
  const bridgeMod = require('../strumenti/whatsapp-bridge');
  const bridge = bridgeMod.getWhatsAppBridge();

  const scenari = bridge.getScenariTest();
  check('bridge: lista scenari presente', Array.isArray(scenari) && scenari.length >= 5);
  check('bridge: scenario truffa figlio presente', scenari.some(s => s.id === 'truffa_figlio'));
  check('bridge: scenario phishing banca presente', scenari.some(s => s.id === 'phishing_banca'));

  const stato = bridge.getStato();
  check('bridge: stato iniziale presente', stato && stato.stato !== undefined);
  check('bridge: messaggiRecenti è array', Array.isArray(stato.messaggiRecenti));

  let eventoMessaggioRicevuto = false;
  bridge.once('messaggio', function (msg) {
    eventoMessaggioRicevuto = true;
  });

  bridge.analizzaManuale({
    contatto: 'Test Tester (+39 333 0000000)',
    messaggio: 'Gentile cliente accesso anomalo sul conto BancoPosta postepay bloccato',
    usaLlm: false
  }).then(function (resManuale) {
    check('bridge analizzaManuale: eseguito', resManuale && resManuale.analisi.truffa.rilevata);
    check('bridge analizzaManuale: evento emesso', eventoMessaggioRicevuto);

    return bridge.apriChat('Test Tester (+39 333 0000000)');
  }).then(function (resApri) {
    check('bridge apriChat: eseguito con successo', resApri && resApri.ok);
    check('bridge apriChat: contatto corretto', resApri && resApri.contatto === 'Test Tester (+39 333 0000000)');

    return bridge.sincronizzaChat();
  }).then(function (resSync) {
    check('bridge sincronizzaChat: eseguito', resSync && resSync.ok && Array.isArray(resSync.contatti));
    check('bridge: lista contatti non vuota', resSync && resSync.contatti.length > 0);

    return bridge.chiudiLiveSession();
  }).then(function (chiusura) {
    check('bridge: chiudiLiveSession ok', chiusura && chiusura.ok);

    setTimeout(function () {
      console.log('\n──────────────────────────────────────────');
      console.log('Risultato: ' + pass + ' ok, ' + fail + ' falliti');
      if (fail > 0) process.exit(1);
    }, 50);
  }).catch(function (err) {
    fail++;
    console.log('  FAIL eccezione bridge: ' + err.message);
    process.exit(1);
  });
}).catch(function (e) {
  fail++;
  console.log('  FAIL eccezione analizzaMessaggio: ' + e.message);
  process.exit(1);
});
