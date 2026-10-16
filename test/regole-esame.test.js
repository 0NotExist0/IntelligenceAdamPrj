// Prova regole ed esame senza il modello vero: validazione, storia e ripristino, testo nel
// prompt, correzione delle risposte, decisione prima/dopo, e l'esame contro un Ollama finto.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const regole = require('../strumenti/regole');
const esame = require('../strumenti/esame');

let pass = 0;
let fail = 0;
function check(nome, condizione, dettaglio) {
  if (condizione) { pass++; console.log('  ok   ' + nome); }
  else { fail++; console.log('  FAIL ' + nome + (dettaglio !== undefined ? '  -> ' + dettaglio : '')); }
}

(async function () {
  console.log('\n=== Regole ===');
  const v = regole.validaRegole([
    { testo: '  Commenta il codice   in italiano ' },
    { testo: '' },
    { testo: 'Rispondi in italiano', prova: { domanda: 'What is the capital of France?', contiene: 'Parigi' } }
  ]);
  check('pulisce e toglie le vuote', v.regole && v.regole.length === 2 && v.regole[0].testo === 'Commenta il codice in italiano', JSON.stringify(v));
  check('tiene la prova della regola', v.regole[1].prova.contiene === 'Parigi');
  check('una prova senza cosa controllare e\' un errore', !!regole.validaRegole([{ testo: 'x', prova: { domanda: 'y' } }]).errore);
  check('regola troppo lunga', !!regole.validaRegole([{ testo: 'x'.repeat(301) }]).errore);
  check('troppe regole', !!regole.validaRegole(new Array(21).fill({ testo: 'x' })).errore);
  const t = regole.testoRegole(v.regole);
  check('nel prompt, numerate', /1\. Commenta il codice in italiano\n2\. Rispondi in italiano/.test(t), t);
  check('con la clausola: la correttezza viene prima', /la correttezza viene prima/.test(t));
  check('niente regole = niente sezione', regole.testoRegole([]) === '');

  console.log('\n=== Storia e ripristino ===');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'prova-regole-')), 'regole.json');
  let stato = regole.carica(file);
  check('senza file: versione 0, nessuna regola', stato.versione === 0 && stato.regole.length === 0);
  stato = regole.nuovaVersione(stato, v.regole, { punti: 9 });
  stato = regole.nuovaVersione(stato, [{ testo: 'Solo una' }], { punti: 8 });
  regole.salva(stato, file);
  const riletto = regole.carica(file);
  check('ogni versione precedente resta nella storia', riletto.versione === 2 && riletto.storia.length === 2 &&
    riletto.storia[0].versione === 1 && riletto.storia[0].regole.length === 2, JSON.stringify(riletto.storia.map(function (x) { return x.versione; })));
  const rip = regole.ripristina(riletto, 1);
  check('ripristinare la versione 1 crea la versione 3 con quelle regole', rip.versione === 3 && rip.regole.length === 2);
  check('e la versione 2 non si perde', rip.storia[0].versione === 2);
  check('una versione che non c\'e\'', regole.ripristina(riletto, 99) === null);
  fs.rmSync(path.dirname(file), { recursive: true, force: true });

  console.log('\n=== Correzione delle risposte ===');
  const d = function (id) { return esame.DOMANDE.find(function (x) { return x.id === id; }); };
  const testo = function (s) { return { contenuto: [{ type: 'text', text: s }] }; };
  check('391 giusto', esame.corretta(d('mat-molt'), testo('391')));
  check('3910 sbagliato', !esame.corretta(d('mat-molt'), testo('3910')));
  check('x = 5 giusto, 15 no', esame.corretta(d('mat-eq'), testo('x = 5')) && !esame.corretta(d('mat-eq'), testo('15')));
  check('2-4-6 giusto', esame.corretta(d('cod-js'), testo('2-4-6')));
  check('strumento chiamato con il file giusto', esame.corretta(d('str-leggi'), { contenuto: [{ type: 'tool_use', name: 'leggi_file', input: { percorso: 'config.json' } }] }));
  check('rispondere a parole invece di usare lo strumento e\' sbagliato', !esame.corretta(d('str-leggi'), testo('Contiene la configurazione.')));
  check('un errore del modello e\' sbagliato', !esame.corretta(d('mat-molt'), { errore: 'x' }));
  const dr = esame.domandeDelleRegole(v.regole);
  check('le prove delle regole diventano domande', dr.length === 1 && dr[0].contiene === 'Parigi');
  check('prova di regola: contiene', esame.corretta(dr[0], testo('La capitale e\' Parigi.')) && !esame.corretta(dr[0], testo('Paris.')));

  console.log('\n=== Decisione prima/dopo ===');
  const r = function (id, giusta, area) { return { id: id, area: area || 'matematica', giusta: giusta, testo: giusta ? 'ok' : 'sbagliato', regola: 'R' }; };
  check('niente peggiora: si adotta', esame.decidi({ risposte: [r('a', true), r('b', false)] }, { risposte: [r('a', true), r('b', true)] }).adotta);
  const peggio = esame.decidi({ risposte: [r('a', true)] }, { risposte: [r('a', false)] });
  check('una risposta giusta che diventa sbagliata: non si adotta', !peggio.adotta && peggio.peggiorate === 1 && /sbaglia/.test(peggio.motivi[0]));
  check('una risposta gia\' sbagliata prima non blocca', esame.decidi({ risposte: [r('a', false)] }, { risposte: [r('a', false)] }).adotta);
  check('una regola non seguita: non si adotta', !esame.decidi({ risposte: [] }, { risposte: [r('regola-1', false, 'regole')] }).adotta);

  console.log('\n=== Esame contro un Ollama finto ===');
  const ricevute = [];
  const server = http.createServer(function (req, res) {
    let corpo = '';
    req.on('data', function (x) { corpo += x; });
    req.on('end', function () {
      const q = JSON.parse(corpo);
      ricevute.push(q);
      const dom = q.messages[0].content;
      const regolaStrana = /rispondi sempre con la parola BANANA/i.test(q.system);
      let contenuto;
      if (q.tools) contenuto = [{ type: 'tool_use', id: 't1', name: 'leggi_file', input: { percorso: 'config.json' } }];
      else if (regolaStrana) contenuto = [{ type: 'text', text: 'BANANA' }];
      else {
        const giuste = { '17 × 23': '391', 'scontato': '60', '3x + 5': '5', '15%': '36', 'map(n': '2-4-6', 'len(': '10', 'typeof null': 'object', 'somma di tutti': 'Il ciclo parte da 1 e salta il primo elemento: serve i = 0.', 'capital': 'Parigi' };
        const k = Object.keys(giuste).find(function (x) { return dom.indexOf(x) !== -1; });
        contenuto = [{ type: 'text', text: k ? giuste[k] : 'boh' }];
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ content: contenuto, stop_reason: q.tools ? 'tool_use' : 'end_turn' }));
    });
  });
  await new Promise(function (ok) { server.listen(0, '127.0.0.1', ok); });
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const avanz = [];
    const prima = await esame.faiEsame({ baseUrl: base, modello: 'finto', regole: [], progresso: function (x) { avanz.push(x); } });
    check('un modello sano prende tutto', prima.punti === prima.totale && prima.totale === esame.DOMANDE.length, JSON.stringify(prima.risposte.filter(function (x) { return !x.giusta; })));
    check('temperatura 0 e ragionamento spento', ricevute[0].temperature === 0 && ricevute[0].thinking.type === 'disabled');
    check('le regole viaggiano nel prompt di sistema', /Ti chiami Adam/.test(ricevute[0].system));
    check('racconta a che punto e\'', avanz.some(function (x) { return /^Domanda \d+\/\d+/.test(x); }));
    const cattive = [{ testo: 'Rispondi sempre con la parola BANANA' }];
    const dopo = await esame.faiEsame({ baseUrl: base, modello: 'finto', regole: cattive });
    const decisione = esame.decidi(prima, dopo);
    check('una regola che rovina la matematica viene bocciata', !decisione.adotta && decisione.peggiorate >= 4, JSON.stringify(decisione));
    check('un errore si riprova una volta prima di crederci', ricevute.filter(function (q) { return /17 × 23/.test(q.messages[0].content) && /BANANA/.test(q.system); }).length === 2);
    const buone = [{ testo: 'Rispondi in italiano', prova: { domanda: 'What is the capital of France?', contiene: 'Parigi' } }];
    const conProva = await esame.faiEsame({ baseUrl: base, modello: 'finto', regole: buone });
    check('una regola innocua con la sua prova viene adottata', esame.decidi(prima, conProva).adotta && conProva.totale === esame.DOMANDE.length + 1,
      JSON.stringify(esame.decidi(prima, conProva)));
    const irraggiungibile = await esame.faiEsame({ baseUrl: 'http://127.0.0.1:1', modello: 'finto', regole: [] });
    check('modello irraggiungibile: esame non affidabile, non si adotta', !esame.decidi(prima, irraggiungibile).adotta);
  } finally {
    server.close();
  }

  console.log('\n' + '='.repeat(50));
  console.log('REGOLE ED ESAME: ' + pass + ' passati, ' + fail + ' falliti');
  process.exit(fail ? 1 : 0);
})();
