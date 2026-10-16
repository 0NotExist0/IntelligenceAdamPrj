// Prova il capo progetto: il piano del lavoro tenuto dallo Studio, un passo alla volta.
// Richiesta dell'utente del 17/9/2026 ("manca una guida che racconta ad Adam cosa deve fare"),
// nata da questo: dopo una compattazione Adam si e' ripresentato - "cosa posso aiutarti a fare?" -
// mentre stava sistemando il CSS, perche' il compito viveva solo nella conversazione.
const fs = require('fs');
const os = require('os');
const path = require('path');
const capo = require('../strumenti/capo-progetto');

let pass = 0;
let fail = 0;
function check(nome, condizione, dettaglio) {
  if (condizione) { pass++; console.log('  ok   ' + nome); }
  else { fail++; console.log('  FAIL ' + nome + (dettaglio !== undefined ? '  -> ' + dettaglio : '')); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capo-progetto-'));
const dati = fs.mkdtempSync(path.join(os.tmpdir(), 'capo-dati-'));
const O = { base: dati };
try {
  console.log('\n=== I passi vengono dalla richiesta dell\'utente ===');
  check('elenco numerato su una riga sola',
    JSON.stringify(capo.passiEspliciti('fammi il sito: 1) le foto 2) i contatti 3) mettilo online')) ===
    JSON.stringify(['le foto', 'i contatti', 'mettilo online']),
    JSON.stringify(capo.passiEspliciti('fammi il sito: 1) le foto 2) i contatti 3) mettilo online')));
  check('elenco con i trattini su piu\' righe',
    capo.passiEspliciti('- aggiungi il menu\n- sfondo nero\n- aggiusta il footer').length === 3);
  check('"e poi" separa due passi',
    JSON.stringify(capo.passiEspliciti('aggiungi il menu e poi metti lo sfondo nero')) ===
    JSON.stringify(['aggiungi il menu', 'metti lo sfondo nero']));
  check('una frase sola non e\' un elenco', capo.passiEspliciti('sistema il css').length === 0);
  capo.azzera(dir, dati);
  const composto = capo.aggiornaDallaRichiesta(dir, 'perche gli ingranaggi non girano? e sono invisibili?', O);
  check('una segnalazione composta formulata come domanda apre un piano', !!composto && composto.tipo === 'bug', JSON.stringify(composto));
  check('la richiesta composta resta intera', /non girano/.test(composto.richiestaCompleta) && /invisibili/.test(composto.richiestaCompleta), composto.richiestaCompleta);
  check('ogni parte diventa un criterio da non perdere', composto.criteri.length >= 2, JSON.stringify(composto.criteri));
  check('il prompt ricorda entrambi i problemi', /non girano/.test(capo.testoPerAdam(dir, O)) && /invisibili/.test(capo.testoPerAdam(dir, O)), capo.testoPerAdam(dir, O));
  const quandoComposto = composto.quando;
  const riformulato = capo.aggiornaDallaRichiesta(dir, 'gli ingranaggi sono invisibili e non girano', O);
  check('una riformulazione morfologica non apre un altro lavoro', riformulato.quando === quandoComposto, JSON.stringify(riformulato));
  const dopoRiprova = capo.aggiornaDallaRichiesta(dir, 'riprova', O);
  const dopoFinisci = capo.aggiornaDallaRichiesta(dir, 'finisci', O);
  check('riprova e finisci conservano il piano dopo un riavvio', dopoRiprova.quando === quandoComposto && dopoFinisci.quando === quandoComposto);

  console.log('\n=== Quando l\'utente non elenca niente, ci si mette il metodo ===');
  check('un "non funziona" e\' un bug', capo.tipoDiRichiesta('il pulsante non funziona') === 'bug');
  check('"crea un gioco" e\' una creazione', capo.tipoDiRichiesta('crea un gioco fps in localhost') === 'creazione');
  const passiBug = capo.passiStandard('il pulsante non funziona', 'bug');
  check('per un bug si parte dalla causa, non dal codice a caso', /capire DA COSA dipende/.test(passiBug[0]), passiBug[0]);
  check('e si finisce verificando', /verificare/.test(passiBug[2]), passiBug[2]);
  check('per una creazione si parte da uno scheletro che si vede',
    /scheletro minimo/.test(capo.passiStandard('crea un sito', 'creazione')[0]));

  console.log('\n=== Il blocco che Adam vede a ogni messaggio ===');
  capo.azzera(dir, dati);
  let piano = capo.aggiornaDallaRichiesta(dir, 'sistema il css che il sito fa schifo', O);
  let testo = capo.testoPerAdam(dir, O);
  check('c\'e\' il compito con le parole dell\'utente', /COMPITO: sistema il css/.test(testo), testo);
  check('c\'e\' un passo solo, quello di adesso', /PASSO 1 di 3 - FALLO ADESSO:/.test(testo), testo);
  check('dice come si chiude un passo', /PASSO FATTO:/.test(testo), testo);
  check('dice di non saltare avanti', /non saltare avanti/.test(testo), testo);
  check('sta in poco spazio (sotto i 700 caratteri)', testo.length < 700, String(testo.length));
  check('senza piano non dice niente', capo.testoPerAdam(fs.mkdtempSync(path.join(os.tmpdir(), 'vuoto-')), O) === '');

  console.log('\n=== Si avanza di un passo alla volta ===');
  const senzaProva = capo.segnaPassoFatto(dir, Object.assign({ nota: 'lo dichiaro soltanto' }, O));
  check('una dichiarazione senza verifica non avanza', senzaProva.corrente === 0 && senzaProva.passi[0].stato === 'in corso');
  piano = capo.segnaPassoFatto(dir, Object.assign({ verificato: true, nota: 'trovato in style.css' }, O));
  check('il passo 1 risulta fatto', piano.passi[0].stato === 'fatto' && piano.corrente === 1);
  testo = capo.testoPerAdam(dir, O);
  check('adesso il passo di adesso e\' il secondo', /PASSO 2 di 3/.test(testo), testo);
  check('e ricorda cosa e\' gia\' stato fatto', /GIA' FATTI: 1\)/.test(testo), testo);
  const nonPassa = capo.segnaPassoFatto(dir, Object.assign({ verificato: false, nota: 'la pagina resta bianca' }, O));
  check('se i controlli trovano problemi il passo NON avanza', nonPassa.corrente === 1 &&
    nonPassa.passi[1].stato === 'in corso', JSON.stringify(nonPassa.passi[1]));
  check('e il motivo finisce davanti ad Adam', /DA SISTEMARE IN QUESTO PASSO: la pagina resta bianca/.test(capo.testoPerAdam(dir, O)));
  capo.segnaPassoFatto(dir, Object.assign({ verificato: true }, O));
  const finito = capo.segnaPassoFatto(dir, Object.assign({ verificato: true }, O));
  check('finiti i passi il piano si chiude', finito.finito === true);
  check('e il blocco lo dice senza far ricominciare tutto',
    /tutti i 3 passi risultano fatti/.test(capo.testoPerAdam(dir, O)), capo.testoPerAdam(dir, O));

  capo.azzera(dir, dati);
  capo.aggiornaDallaRichiesta(dir, '1) analizza 2) modifica 3) verifica', O);
  const saltato = capo.saltaPasso(dir, 'non applicabile al progetto', O);
  check('saltare un passo lo mantiene distinto da un passo verificato',
    saltato.passi[0].stato === 'saltato' && saltato.passi[0].verificato === false, JSON.stringify(saltato.passi[0]));
  check('dopo un passo saltato si avanza a quello successivo',
    saltato.corrente === 1 && saltato.passi[1].stato === 'in corso', JSON.stringify(saltato.passi));

  console.log('\n=== L\'utente comanda sempre ===');
  capo.azzera(dir, dati);
  capo.aggiornaDallaRichiesta(dir, 'fammi il sito del curriculum con le foto', O);
  capo.segnaPassoFatto(dir, Object.assign({ verificato: true }, O));
  const conUrgente = capo.aggiornaDallaRichiesta(dir, 'il sito non carica le foto, sono sparite', O);
  check('una segnalazione sullo stesso lavoro diventa il passo di adesso',
    /l'utente adesso chiede/.test(capo.passoCorrente(conUrgente).testo), JSON.stringify(conUrgente.passi.map(function (p) { return p.stato; })));
  check('il lavoro gia' + '\'' + ' fatto non si butta', conUrgente.passi.some(function (p) { return p.stato === 'fatto'; }));
  const ripetuto = capo.aggiornaDallaRichiesta(dir, 'il sito non carica le foto, sono sparite', O);
  check('lo stesso messaggio due volte non fa due passi', ripetuto.passi.length === conUrgente.passi.length,
    JSON.stringify(ripetuto.passi.map(function (p) { return p.testo.slice(0, 22); })));
  const altro = capo.aggiornaDallaRichiesta(dir, 'adesso scrivimi un programma python che calcola le tasse', O);
  check('una richiesta che parla d\'altro apre un compito nuovo', /tasse/.test(altro.compito) && altro.corrente === 0, altro.compito);
  check('del compito di prima resta traccia', (altro.storia || []).length >= 1, JSON.stringify(altro.storia));
  const dopoOk = capo.aggiornaDallaRichiesta(dir, 'ok', O);
  check('"ok" non cambia il piano', dopoOk.quando === altro.quando);
  const dopoSi = capo.aggiornaDallaRichiesta(dir, 'si vai', O);
  check('nemmeno "si vai"', dopoSi.passi.length === altro.passi.length);
  const dopoDomanda = capo.aggiornaDallaRichiesta(dir, 'come si chiama il file del css?', O);
  check('una domanda non sposta il piano', dopoDomanda.quando === altro.quando &&
    dopoDomanda.passi.length === altro.passi.length, JSON.stringify(dopoDomanda.compito));
  check('riconosce le domande', capo.sembraUnaDomanda('quanto pesa il file?') &&
    capo.sembraUnaDomanda('che modello stai usando') && capo.sembraUnaDomanda('perche non funziona?'));
  check('ma un ordine non e\' una domanda', !capo.sembraUnaDomanda('sistema il css') &&
    !capo.sembraUnaDomanda('come mai non lo aggiusti? aggiustalo'));

  console.log('\n=== Girare in tondo si vede ===');
  capo.contaTurno(dir, O);
  capo.contaTurno(dir, O);
  capo.contaTurno(dir, O);
  check('dopo tre turni sullo stesso passo lo dice',
    /sei su questo passo da 3 turni/.test(capo.testoPerAdam(dir, O)), capo.testoPerAdam(dir, O));
  check('e ricorda che e\' meglio dirlo all\'utente',
    /dillo chiaro all'utente/.test(capo.testoPerAdam(dir, O)));

  console.log('\n=== Adam puo\' proporre un piano migliore ===');
  const riscritto = capo.riscriviPassi(dir, '1) leggere il file delle tasse 2) scrivere la formula 3) provarla con un esempio', O);
  check('accetta un piano numerato', riscritto.ok === true && riscritto.piano.passi.length === 3, JSON.stringify(riscritto));
  check('e riparte dal primo passo', riscritto.piano.corrente === 0 && riscritto.piano.passi[0].stato === 'in corso');
  check('un piano con un passo solo viene rifiutato', capo.riscriviPassi(dir, 'faccio tutto io', O).ok === false);

  console.log('\n=== Leggere le risposte vere di Adam (18/9/2026) ===');
  const rispostaVera = 'Il gioco **funziona**!\n\n**PASSO FATTO: Gioco FPS Zombie Multiplayer ora funziona correttamente con movimento, sparo e AI zombie!**';
  check('"PASSO FATTO" in grassetto e\' una dichiarazione (prima diceva "non dichiarato")',
    capo.dichiarazioneDiPasso(rispostaVera) === 'Gioco FPS Zombie Multiplayer ora funziona correttamente con movimento, sparo e AI zombie!',
    JSON.stringify(capo.dichiarazioneDiPasso(rispostaVera)));
  check('anche dentro un elenco', capo.dichiarazioneDiPasso('- PASSO FATTO: menu aggiunto') === 'menu aggiunto');
  check('senza dichiarazione niente', capo.dichiarazioneDiPasso('ho fatto il menu, adesso passo al footer') === null);
  const rispostaAlQuadro = '**1) A che punto sono:** Il gioco parte.\n\n**2) Cosa manca davvero:** il multiplayer.\n\n' +
    '**3) Causa probabile:** array statico.\n\n**4) UN solo prossimo passo:** Creare un file `server.js` Node.js semplice ' +
    'che gestisca la connessione multiplayer reale con Socket.io.\n\n**5) Comando di verifica:** Dopo aver creato il server, ' +
    'avviare `node server.js` e collegarsi da piu\' browser.';
  const deciso = capo.prossimoPassoDichiarato(rispostaAlQuadro);
  check('dalla risposta al quadro si legge il passo che Adam si e\' dato',
    !!deciso && /^Creare un file `server\.js`/.test(deciso.passo), JSON.stringify(deciso));
  check('senza l\'etichetta "UN solo prossimo passo"', !!deciso && !/prossimo passo/i.test(deciso.passo));
  check('e anche come lo verifichera\'', !!deciso && /node server\.js/.test(deciso.verifica), deciso && deciso.verifica);
  check('una risposta senza il punto 4 non si inventa un passo',
    capo.prossimoPassoDichiarato('Non posso farlo: serve un server che non so scrivere.') === null);
  capo.azzera(dir, dati);
  capo.nuovoPiano(dir, 'sistema il gioco che non parte', O);
  const conPassoDiAdam = capo.aggiungiPassoUrgente(dir, deciso.passo, Object.assign({ urgente: false }, O));
  check('il passo deciso da Adam diventa quello di adesso', /server\.js/.test(capo.passoCorrente(conPassoDiAdam).testo));
  check('ma non conta come richiesta a voce dell\'utente', capo.passoCorrente(conPassoDiAdam).urgente === false);

  console.log('\n=== Per l\'utente ===');
  const perUtente = capo.testoPerUtente(capo.leggi(dir, dati));
  check('mostra i passi con lo stato', /\[adesso\]/.test(perUtente) && /1\./.test(perUtente), perUtente);

  console.log('\n=== Agganci nello Studio (server.js) ===');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  check('il piano si aggiorna a ogni messaggio dell\'utente', /aggiornaCapoProgetto\(trimmed\);/.test(server));
  check('il blocco viaggia in testa a tutto quello che arriva ad Adam',
    /function testoPerIlModello[\s\S]{0,700}capoProgetto\.testoPerAdam\(config\.cwd\)/.test(server));
  check('e non si ripete se c\'e\' gia\'', /indexOf\('CAPO PROGETTO'\) === -1/.test(server));
  check('il passo avanza solo se la verifica e\' andata bene',
    /if \(failures\.length === 0\) \{[\s\S]{0,1800}chiudiPassoDelTurno\(checked > 0, null, filesChecked\.length, testiMancanti, funzionale\);/.test(server) &&
    /failures\.forEach\(rememberIssue\);[\s\S]{0,300}chiudiPassoDelTurno\(false, problemiMisurati\);/.test(server));
  check('si puo\' spegnere dalla configurazione', /config\.capoProgetto === false/.test(server));
  check('se Adam non dichiara PASSO FATTO il passo resta aperto',
    /if \(!dichiarato\) \{\s*capoProgetto\.contaTurno\(config\.cwd\);\s*return;/.test(server) && !/const daiFatti =/.test(server));
  check('analisi, modifica e verifica richiedono evidenze diverse',
    /tipo === 'analisi'[\s\S]{0,180}turnEvidence\.letture/.test(server) &&
    /tipo === 'verifica'[\s\S]{0,180}statoFunzionale/.test(server) &&
    /verificaOk === true && \(fileToccati \|\| 0\) > 0/.test(server));

  // Il 18/9/2026 lo Studio ha scritto "Passo fatto" e subito dopo "i controlli dicono di no", poi
  // ha fermato Adam per il quadro e non l'ha piu' fatto ripartire. Tre difetti, tre prove.
  check('"PASSO FATTO" si riconosce anche in grassetto', /capoProgetto\.dichiarazioneDiPasso\(testo\)/.test(server));
  check('se alla richiesta manca qualcosa il passo non si chiude e non si annuncia',
    /function chiudiPassoDelTurno\(verificaOk, problemi, fileToccati, mancanti, statoFunzionale\)/.test(server) &&
    /chiudiPassoDelTurno\(checked > 0, null, filesChecked\.length, testiMancanti, funzionale\)/.test(server));
  check('l\'utente legge COSA manca, non "i controlli dicono di no"',
    /Adam ha detto che era fatto, ma nella tua richiesta c\\'e\\' un punto che nel/.test(server));
  check('dopo la risposta al quadro Adam riparte da solo dal passo che si e\' dato',
    /function rilanciaDopoIlQuadro\(\)/.test(server) && /capoProgetto\.prossimoPassoDichiarato\(currentTurnText\(\)\)/.test(server) &&
    /if \(rilanciaDopoIlQuadro\(\)\) \{/.test(server));
  check('ma non all\'infinito: al massimo due volte per richiesta', /const MAX_RILANCI_DOPO_QUADRO = 2;/.test(server) &&
    /rilanciDopoQuadro = 0;/.test(server));
  check('se era un gioco multiplayer o 3D gli ricorda lo scheletro che funziona gia\'',
    /multiplayer\|FPS\|3D/.test(server) && /scheletri\.COMANDO \+ ' --elenco/.test(server));
  check('e quanti file sono stati toccati arriva davvero', /chiudiPassoDelTurno\(checked > 0, null, filesChecked\.length, testiMancanti, funzionale\)/.test(server));
  check('Adam sa come riscrivere il piano', /COMANDO_CAPO \+ " --piano/.test(server));
} catch (e) {
  check('la prova si esegue', false, e.stack);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(dati, { recursive: true, force: true });
}

console.log('\n' + '='.repeat(50));
console.log('CAPO PROGETTO: ' + pass + ' passati, ' + fail + ' falliti');
process.exit(fail ? 1 : 0);
