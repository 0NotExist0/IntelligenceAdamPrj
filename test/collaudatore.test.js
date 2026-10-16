// Prova il revisore senza il modello vero: formato dei passi, pulizia di cio' che il
// modello restituisce, trasformazione degli esiti in fatti per Adam (compresa la
// regressione), conservazione su disco, e la chiamata a Ollama contro un server finto
// che risponde in streaming come quello vero.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const c = require('../strumenti/collaudatore');
const m = require('../strumenti/confronto-misure');

let pass = 0;
let fail = 0;
function check(nome, condizione, dettaglio) {
  if (condizione) { pass++; console.log('  ok   ' + nome); }
  else { fail++; console.log('  FAIL ' + nome + (dettaglio !== undefined ? '  -> ' + dettaglio : '')); }
}

function collaudo(nome, altro) {
  return Object.assign({ nome: nome, fonte: '"frase"', passi: ['clic #start', 'attendi 300'], verifica: 'gioco === true', misura: ['gioco'] }, altro || {});
}

(async function () {
  console.log('\n=== Passi ===');
  check('clic su selettore', JSON.stringify(c.leggiPasso('clic #start-btn')) === JSON.stringify({ tipo: 'clic', selettore: '#start-btn' }));
  check('clic su coordinate', c.leggiPasso('clic 640 400').tipo === 'clicxy');
  check('tasto con durata', c.leggiPasso('tasto ArrowLeft 300').ms === 300);
  check('tasto senza durata = 100 ms', c.leggiPasso('tasto Space').ms === 100);
  check('attesa limitata a 5 s', c.leggiPasso('attendi 60000').ms === 5000);
  check('mouse', c.leggiPasso('mouse 10, 20').x === 10);
  const trascinaSelettori = c.leggiPasso('trascina #maniglia | #bersaglio');
  check('trascina tra selettori CSS', trascinaSelettori && trascinaSelettori.tipo === 'trascina' &&
    trascinaSelettori.origine.selettore === '#maniglia' && trascinaSelettori.destinazione.selettore === '#bersaglio', JSON.stringify(trascinaSelettori));
  const trascinaCoordinate = c.leggiPasso('trascina 10, 20 | 300 400');
  check('trascina tra coordinate', trascinaCoordinate && trascinaCoordinate.origine.x === 10 && trascinaCoordinate.destinazione.y === 400, JSON.stringify(trascinaCoordinate));
  const trascinaSlider = c.leggiPasso('trascina #volume | 75%');
  check('trascina uno slider alla percentuale indicata', trascinaSlider && trascinaSlider.destinazione.tipo === 'percentuale' &&
    trascinaSlider.destinazione.valore === 75, JSON.stringify(trascinaSlider));
  check('rifiuta percentuali fuori intervallo e passi incompleti', c.leggiPasso('trascina #volume | 101%') === null &&
    c.leggiPasso('trascina | #target') === null);
  check('js su piu\' righe', c.leggiPasso('js a = 1;\nb = 2').codice === 'a = 1;\nb = 2');
  check('passo sconosciuto', c.leggiPasso('premi il pulsante') === null);
  const scrivi = c.leggiPasso('scrivi #campo | pane integrale');
  check('scrivi in un campo', scrivi && scrivi.tipo === 'scrivi' && scrivi.selettore === '#campo' && scrivi.testo === 'pane integrale', JSON.stringify(scrivi));
  check('scrivi un testo vuoto (svuota il campo)', c.leggiPasso('scrivi #campo |').testo === '');
  const sel = c.leggiPasso('seleziona #categoria | frutta');
  check('seleziona una voce di un menu', sel && sel.tipo === 'seleziona' && sel.valore === 'frutta', JSON.stringify(sel));
  check('un flusso con scrivi e Invio passa la pulizia', c.normalizzaCollaudi({ collaudi: [collaudo('Flusso', {
    passi: ['scrivi #campo | pane', 'tasto Enter', 'seleziona #cat | pane', 'clic #aggiungi'] })] }).collaudi.length === 1);
  check('un collaudo con trascinamento passa la pulizia', c.normalizzaCollaudi({ collaudi: [collaudo('Trascina slider', {
    passi: ['trascina #volume | 75%'] })] }).collaudi.length === 1);
  check('il prompt del revisore chiede un collaudo di flusso', /FLUSSO principale dall'inizio alla fine/.test(c.promptRevisore('a.html', '', 'x')) &&
    /scrivi #campo \| pane/.test(c.promptRevisore('a.html', '', 'x')));

  check('il prompt del revisore conosce i trascinamenti', /trascina #volume/.test(c.promptRevisore('a.html', '', 'x')));

  console.log('\n=== Pulizia della risposta del modello ===');
  const n = c.normalizzaCollaudi({ collaudi: [
    collaudo('Il gioco parte', { verifica: 'gameRunning === true;' }),
    collaudo('Il gioco parte'),
    collaudo('Senza verifica', { verifica: '' }),
    collaudo('Passo strano', { passi: ['premi start'] }),
    collaudo('Attese infinite', { passi: ['attendi 5000', 'attendi 5000', 'attendi 5000'] }),
    collaudo('Nome «con» caporali'),
    collaudo('Misure troppe', { misura: ['a', 'b', 'c', 'd', 'e', 'f'] })
  ] });
  const nomi = n.collaudi.map(function (x) { return x.nome; });
  check('tiene i collaudi validi', nomi.length === 3, JSON.stringify(nomi));
  check('toglie il punto e virgola finale dalla verifica', n.collaudi[0].verifica === 'gameRunning === true');
  check('scarta il nome ripetuto', n.scartati.some(function (s) { return s.motivo === 'nome ripetuto'; }), JSON.stringify(n.scartati));
  check('scarta chi non ha verifica', n.scartati.some(function (s) { return s.motivo === 'manca la verifica'; }));
  check('scarta il passo sconosciuto', n.scartati.some(function (s) { return /passo non riconosciuto/.test(s.motivo); }));
  check('scarta le attese troppo lunghe', n.scartati.some(function (s) { return /attese troppo lunghe/.test(s.motivo); }));
  check('i caporali non entrano nel nome', nomi.indexOf('Nome "con" caporali') !== -1, JSON.stringify(nomi));
  check('al massimo 4 misure', n.collaudi[2].misura.length === 4);
  const molti = c.normalizzaCollaudi({ collaudi: [1, 2, 3, 4, 5, 6, 7, 8].map(function (i) { return collaudo('C' + i); }) });
  check('al massimo ' + c.MAX_COLLAUDI + ' collaudi', molti.collaudi.length === c.MAX_COLLAUDI && molti.scartati.length === 2);
  check('risposta non valida = nessun collaudo', c.normalizzaCollaudi(null).collaudi.length === 0);
  check('JSON con testo attorno', c.estraiJson('Ecco:\n{"collaudi":[]}\nFatto.').collaudi.length === 0);
  check('JSON rotto', c.estraiJson('{"collaudi": [') === null);

  console.log('\n=== Dagli esiti ai fatti ===');
  const definiti = [
    collaudo('Il gioco parte'),
    collaudo('Un nemico colpito sparisce', { verifica: 'enemies.length === 0', fonte: '"Distruggi gli alieni"' }),
    collaudo('Selettore sbagliato'),
    collaudo('Variabile inventata')
  ];
  const esitiPrima = [
    { nome: 'Il gioco parte', esito: 'superato', misure: {} },
    { nome: 'Un nemico colpito sparisce', esito: 'fallito', misure: { 'enemies.length': '1', score: '400' }, fonte: '"Distruggi gli alieni"' },
    { nome: 'Selettore sbagliato', esito: 'fallito', causa: 'elemento', motivo: 'l\'elemento "#via" non esiste' },
    { nome: 'Variabile inventata', esito: 'non valido', motivo: 'la verifica da\' errore: punti is not defined' }
  ];
  const f1 = c.fattiDaiCollaudi(esitiPrima, {}, definiti);
  check('superato = capacita\' da proteggere', f1.superati.join() === 'Il gioco parte');
  check('fallito = fatto per Adam', f1.falliti.length === 1 && /^Collaudo fallito «Un nemico colpito sparisce»/.test(f1.falliti[0]), JSON.stringify(f1.falliti));
  check('il fatto dice cosa era atteso e cosa e\' stato misurato',
    /atteso che enemies\.length === 0/.test(f1.falliti[0]) && /Misurato: enemies\.length = 1, score = 400/.test(f1.falliti[0]), f1.falliti[0]);
  check('il fatto cita la descrizione', /Dalla descrizione: "Distruggi gli alieni"/.test(f1.falliti[0]));
  check('alla prima misura un elemento inesistente e\' un errore del revisore', f1.scartati.some(function (s) { return s.nome === 'Selettore sbagliato'; }));
  check('alla prima misura un collaudo non eseguibile si scarta', f1.scartati.some(function (s) { return s.nome === 'Variabile inventata'; }));
  check('categoria del collaudo fallito', m.categoriaFatto(f1.falliti[0]) === 'collaudo');

  const riferimento = { 'Il gioco parte': 'superato', 'Un nemico colpito sparisce': 'fallito' };
  const f2 = c.fattiDaiCollaudi([
    { nome: 'Il gioco parte', esito: 'fallito', misure: { gameRunning: 'false' } },
    { nome: 'Un nemico colpito sparisce', esito: 'superato', misure: {} }
  ], riferimento, definiti);
  check('passava e ora fallisce = regressione', f2.regressioni.length === 1 && /^Regressione «Il gioco parte»/.test(f2.regressioni[0]), JSON.stringify(f2));
  check('la regressione chiede di ripristinare', /ripristina questo comportamento/.test(f2.regressioni[0]));
  check('categoria della regressione', m.categoriaFatto(f2.regressioni[0]) === 'regressione');
  const f3 = c.fattiDaiCollaudi([
    { nome: 'Il gioco parte', esito: 'non valido', motivo: 'gameRunning is not defined' },
    { nome: 'Un nemico colpito sparisce', esito: 'instabile' }
  ], riferimento, definiti);
  check('con una storia, non eseguibile = non provato', f3.nonProvati.length === 2 && f3.regressioni.length === 0, JSON.stringify(f3));
  const f4 = c.fattiDaiCollaudi([{ nome: 'Il gioco parte', esito: 'fallito', causa: 'elemento', motivo: 'l\'elemento "#start" non esiste' }], riferimento, definiti);
  check('un pulsante sparito da un collaudo che passava e\' una regressione', f4.regressioni.length === 1, JSON.stringify(f4));

  console.log('\n=== Confronto prima/dopo dei collaudi ===');
  const primaF = c.fattiDaiCollaudi([esitiPrima[1]], {}, definiti).falliti[0];
  const dopoF = c.fattiDaiCollaudi([{ nome: 'Un nemico colpito sparisce', esito: 'fallito', misure: { 'enemies.length': '3', score: 'undefined' } }], {}, definiti).falliti[0];
  check('stesso collaudo con misure diverse = stesso fatto', m.chiaveFatto(primaF) === m.chiaveFatto(dopoF));
  const cmp1 = m.confrontaFatti([primaF], [], { collaudo: true });
  check('collaudo che ora passa = risolto', cmp1.risolti.length === 1);
  const cmp2 = m.confrontaFatti([primaF], [], { collaudo: true, collaudiNonProvati: ['Un nemico colpito sparisce'] });
  check('collaudo che non si e\' potuto eseguire = non provato', cmp2.nonVerificati.length === 1 && cmp2.risolti.length === 0, JSON.stringify(cmp2));
  const cmp3 = m.confrontaFatti([primaF], [dopoF], { collaudo: true });
  check('collaudo che fallisce ancora = resta', cmp3.restano.length === 1 && cmp3.nuovi.length === 0);

  console.log('\n=== Conservazione ===');
  const cartella = fs.mkdtempSync(path.join(os.tmpdir(), 'prova-collaudi-'));
  try {
    const dir = path.join(os.tmpdir(), 'progetto-finto');
    const vuoto = c.caricaCollaudi(dir, 'gioco.html', cartella);
    check('senza file: stato vuoto', vuoto.collaudi.length === 0 && vuoto.ritirati.length === 0);
    let stato = c.unisciCollaudi(vuoto, definiti);
    stato = c.registraEsiti(stato, esitiPrima);
    check('i collaudi inutilizzabili senza storia si tolgono', stato.collaudi.length === 2, JSON.stringify(stato.collaudi.map(function (x) { return x.nome; })));
    check('gli esiti vengono ricordati', stato.esiti['Il gioco parte'] === 'superato' && stato.esiti['Un nemico colpito sparisce'] === 'fallito');
    check('guardie = collaudi che passano', c.guardie(stato).map(function (x) { return x.nome; }).join() === 'Il gioco parte');
    c.salvaCollaudi(stato, cartella);
    const riletto = c.caricaCollaudi(dir, 'gioco.html', cartella);
    check('salva e rilegge', riletto.collaudi.length === 2 && riletto.esiti['Il gioco parte'] === 'superato');
    check('il file sta nella cartella dello Studio, non nel progetto', c.fileCollaudi(dir, 'gioco.html', cartella).indexOf(cartella) === 0);

    c.registraEsiti(riletto, [{ nome: 'Il gioco parte', esito: 'fallito' }]);
    check('una guardia che fallisce resta il riferimento', riletto.esiti['Il gioco parte'] === 'superato');

    const nuovi = [collaudo('Un nemico colpito sparisce', { verifica: 'enemies.every(e => e.health > 0)' }), collaudo('La vita scende se ti toccano')];
    const unito = c.unisciCollaudi(riletto, nuovi);
    check('dei vecchi restano le guardie', unito.collaudi.some(function (x) { return x.nome === 'Il gioco parte'; }));
    check('il nuovo vince sul vecchio con lo stesso nome',
      unito.collaudi.filter(function (x) { return x.nome === 'Un nemico colpito sparisce'; })[0].verifica === 'enemies.every(e => e.health > 0)');
    check('il nuovo parte senza storia', unito.esiti['Un nemico colpito sparisce'] === undefined && unito.esiti['Il gioco parte'] === 'superato');

    c.ritira(unito, 'Il gioco parte');
    check('un collaudo ritirato non si esegue piu\'', !c.attivi(unito).some(function (x) { return x.nome === 'Il gioco parte'; }));
    check('e non e\' piu\' una guardia', c.guardie(unito).length === 0);
  } finally {
    fs.rmSync(cartella, { recursive: true, force: true });
  }

  console.log('\n=== Prima/dopo e prova a vuoto ===');
  const statoV = { esiti: {}, validati: {} };
  c.segnaValidati(statoV, { 'Il gioco parte': 'superato', 'La vita scende': 'fallito' }, [
    { nome: 'Il gioco parte', esito: 'superato' },
    { nome: 'La vita scende', esito: 'superato' },
    { nome: 'Nuovo', esito: 'superato' }
  ]);
  check('fallito prima e superato dopo = validato', !!statoV.validati['La vita scende']);
  check('superato anche prima, o senza storia = non validato', !statoV.validati['Il gioco parte'] && !statoV.validati['Nuovo']);
  const fv = c.fattiDaiCollaudi([{ nome: 'Il cursore', esito: 'vuoto', motivo: 'vera anche senza passi' }], {}, []);
  check('un collaudo vuoto alla prima misura si scarta', fv.scartati.length === 1 && fv.superati.length === 0, JSON.stringify(fv));
  const fv2 = c.fattiDaiCollaudi([{ nome: 'Il gioco parte', esito: 'vuoto' }], { 'Il gioco parte': 'superato' }, []);
  check('una guardia diventata vuota non e\' una regressione', fv2.regressioni.length === 0 && fv2.nonProvati.length === 1);
  const unitoV = c.unisciCollaudi({ collaudi: [collaudo('La vita scende')], esiti: { 'La vita scende': 'superato' }, ritirati: [], validati: { 'La vita scende': 'x' } }, [collaudo('Altro')]);
  check('unendo, una guardia validata resta validata', unitoV.validati['La vita scende'] === 'x');

  console.log('\n=== Contesto per il revisore ===');
  const progetto = fs.mkdtempSync(path.join(os.tmpdir(), 'prova-contesto-'));
  try {
    fs.writeFileSync(path.join(progetto, 'README.md'), '# Gioco\n-20 vita se ti toccano');
    fs.writeFileSync(path.join(progetto, 'gioco.html'),
      '<html><body><script src="gioco.js"></script><script src="https://cdn.example.com/lib.js"></script>' +
      '<script src="../fuori.js"></script></body></html>');
    fs.writeFileSync(path.join(progetto, 'gioco.js'), 'let vita = 100;');
    const ctx = c.contestoDelProgetto(progetto, 'gioco.html');
    check('contiene la descrizione', /-20 vita se ti toccano/.test(ctx));
    check('contiene lo script locale', /=== gioco\.js ===\nlet vita = 100;/.test(ctx));
    check('non segue script remoti ne\' fuori dal progetto', !/cdn\.example\.com\/lib\.js ===/.test(ctx) && !/fuori\.js ===/.test(ctx));
    check('pagina inesistente = nessun contesto', c.contestoDelProgetto(progetto, 'nulla.html') === '');
    const ctx2 = c.contestoDelProgetto(progetto, 'gioco.html', { mappa: '- gioco.js -> variabili: vita', memoria: 'Regola: la vita parte da 100' });
    check('il revisore riceve la mappa del codice', /MAPPA DEL CODICE[\s\S]*variabili: vita/.test(ctx2));
    check('e la memoria del progetto', /MEMORIA DEL PROGETTO[\s\S]*la vita parte da 100/.test(ctx2));
    check('mappa e memoria vengono prima del codice', ctx2.indexOf('MAPPA DEL CODICE') < ctx2.indexOf('=== gioco.js ==='));
    const prompt = c.promptRevisore('gioco.html', 'la navicella non muore mai', ctx);
    check('il prompt porta pagina e richiesta', /gioco\.html/.test(prompt) && /la navicella non muore mai/.test(prompt));

    console.log('\n=== Chiamata al modello (server finto in stile Ollama) ===');
    const ricevute = [];
    let modo = 'ok';
    const risposta = JSON.stringify({ collaudi: [collaudo('Il gioco parte'), collaudo('Passo strano', { passi: ['boh'] })] });
    const rispostaGiudizio = JSON.stringify({ giudizi: [
      { nome: 'il contatore e\' un numero', verdetto: 'collaudo sbagliato', motivo: 'la descrizione promette "N articoli da comprare", non un numero' },
      { nome: 'Invio aggiunge la voce', verdetto: 'difetto', motivo: 'dopo Invio la lista resta vuota' },
      { nome: 'Collaudo inventato', verdetto: 'difetto', motivo: 'non era tra quelli da giudicare' },
      { nome: 'Spunta col mouse', verdetto: 'forse', motivo: 'verdetto non ammesso' }
    ] });
    const server = http.createServer(function (req, res) {
      let corpo = '';
      req.on('data', function (x) { corpo += x; });
      req.on('end', function () {
        const d = JSON.parse(corpo);
        ricevute.push(d);
        // Il giudizio chiede un'altra forma di risposta: la si riconosce dallo schema.
        const perGiudizio = d.format && d.format.required && d.format.required[0] === 'giudizi';
        if (modo === 'pensiero' && d.think === false) {
          res.writeHead(400, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ error: 'model does not support thinking (think)' }));
        }
        if (modo === 'rotto') {
          res.writeHead(500);
          return res.end('boom');
        }
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        // Il JSON arriva spezzato su piu' righe e piu' pacchetti, come dal vivo.
        const pezzi = (perGiudizio ? rispostaGiudizio : risposta).match(/.{1,17}/g);
        let i = 0;
        const invia = function () {
          if (i < pezzi.length) {
            const riga = JSON.stringify({ message: { role: 'assistant', content: pezzi[i++] }, done: false }) + '\n';
            res.write(riga.slice(0, 10));
            res.write(riga.slice(10));
            setTimeout(invia, 1);
          } else {
            res.end(JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, eval_count: 42 }) + '\n');
          }
        };
        invia();
      });
    });
    await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
    const base = 'http://127.0.0.1:' + server.address().port;
    const avanzamenti = [];
    try {
      const r = await c.scriviCollaudi({ dir: progetto, pagina: 'gioco.html', richiesta: 'non muore mai', baseUrl: base, modello: 'finto', progresso: function (t) { avanzamenti.push(t); } });
      check('ricompone lo streaming e restituisce i collaudi validi', !r.errore && r.collaudi.length === 1 && r.collaudi[0].nome === 'Il gioco parte', JSON.stringify(r));
      check('e dice quali ha scartato', r.scartati.length === 1 && r.scartati[0].nome === 'Passo strano');
      check('ragionamento spento e formato JSON imposto', ricevute[0].think === false && ricevute[0].format && ricevute[0].format.required[0] === 'collaudi');
      check('nessuno strumento passato al modello', ricevute[0].tools === undefined);
      check('racconta a che punto e\'', avanzamenti.some(function (t) { return /scrive i collaudi: \d+ caratteri/.test(t); }), avanzamenti.slice(-2).join(' | '));
      check('conta i token', r.token === 42);

      ricevute.length = 0;
      const corr = await c.correggiCollaudi({
        dir: progetto, pagina: 'gioco.html', baseUrl: base, modello: 'finto',
        daCorreggere: [{ collaudo: collaudo('Selettore sbagliato', { passi: ['clic #via'] }), motivo: 'l\'elemento "#via" non esiste' }]
      });
      const chiesto = (ricevute[0] && ricevute[0].messages[0].content) || '';
      check('la correzione porta al revisore il motivo misurato', /MOTIVO: l'elemento "#via" non esiste/.test(chiesto), chiesto.slice(0, 300));
      check('e il collaudo da correggere', /Selettore sbagliato/.test(chiesto) && /clic #via/.test(chiesto));
      check('una correzione non aggiunge collaudi nuovi', !corr.errore && corr.collaudi.length === 1, JSON.stringify(corr));
      check('niente da correggere = niente chiamata', (await c.correggiCollaudi({ daCorreggere: [], modello: 'finto' })).collaudi.length === 0);

      ricevute.length = 0;
      const giud = await c.giudicaCollaudi({
        dir: progetto, pagina: 'gioco.html', richiesta: 'la lista non funziona', baseUrl: base, modello: 'finto',
        falliti: [
          { collaudo: collaudo('Il contatore e\' un numero', { verifica: '!isNaN(conta.textContent)' }), esito: { misure: { 'conta.textContent': '"0 articoli da comprare"' } } },
          { collaudo: collaudo('Invio aggiunge la voce'), esito: { misure: { 'voci.length': '0' } } },
          { collaudo: collaudo('Spunta col mouse', { passi: ['mouse 100 20'] }), esito: { misure: {} } }
        ]
      });
      const chiestoG = (ricevute[0] && ricevute[0].messages[0].content) || '';
      check('il giudizio porta al revisore passi, verifica e misure', /PASSI: mouse 100 20/.test(chiestoG) &&
        /MISURATO: conta\.textContent = "0 articoli da comprare"/.test(chiestoG), chiestoG.slice(0, 400));
      check('la regola e\' la descrizione, non il codice di oggi', /La regola e' la DESCRIZIONE/.test(chiestoG));
      check('spiega che "mouse" non clicca', /"mouse x y" sposta soltanto il puntatore e non clicca/.test(chiestoG));
      check('verdetto "collaudo sbagliato" riconosciuto dal nome anche con maiuscole diverse',
        giud.giudizi['Il contatore e\' un numero'] && giud.giudizi['Il contatore e\' un numero'].verdetto === 'collaudo sbagliato', JSON.stringify(giud));
      check('verdetto "difetto" con il suo motivo', giud.giudizi['Invio aggiunge la voce'] && /lista resta vuota/.test(giud.giudizi['Invio aggiunge la voce'].motivo));
      check('giudizi su collaudi inesistenti o verdetti non ammessi si ignorano',
        !giud.giudizi['Collaudo inventato'] && !giud.giudizi['Spunta col mouse'], JSON.stringify(Object.keys(giud.giudizi)));
      check('il fatto per Adam avverte di non piegare il progetto a un collaudo sbagliato',
        /non modificare il progetto per soddisfarlo/.test(c.testoFatto('fallito', { nome: 'x', misure: {} }, collaudo('x'))));

      modo = 'pensiero';
      ricevute.length = 0;
      const r2 = await c.scriviCollaudi({ dir: progetto, pagina: 'gioco.html', baseUrl: base, modello: 'finto' });
      check('se "think" non e\' supportato riprova senza', !r2.errore && ricevute.length === 2 && ricevute[1].think === undefined, JSON.stringify(r2));

      modo = 'rotto';
      const r3 = await c.scriviCollaudi({ dir: progetto, pagina: 'gioco.html', baseUrl: base, modello: 'finto' });
      check('un errore del modello torna come errore, senza collaudi', r3.errore && /500/.test(r3.errore) && r3.collaudi.length === 0, JSON.stringify(r3));
      const r4 = await c.scriviCollaudi({ dir: progetto, pagina: 'gioco.html', baseUrl: 'http://127.0.0.1:1', modello: 'finto' });
      check('modello irraggiungibile = errore, non eccezione', !!r4.errore && r4.collaudi.length === 0);
    } finally {
      server.close();
    }
  } catch (e) {
    check('la prova si esegue', false, e.stack);
  } finally {
    fs.rmSync(progetto, { recursive: true, force: true });
  }

  console.log('\n' + '='.repeat(50));
  console.log('REVISORE: ' + pass + ' passati, ' + fail + ' falliti');
  process.exit(fail ? 1 : 0);
})();
