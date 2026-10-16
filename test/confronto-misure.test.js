// Prova le funzioni che decidono quando misurare una pagina prima di passare un
// messaggio ad Adam, e come confrontare le misure prima e dopo una sua correzione.
const fs = require('fs');
const os = require('os');
const path = require('path');
const m = require('../strumenti/confronto-misure');

let pass = 0;
let fail = 0;
function check(nome, condizione, dettaglio) {
  if (condizione) { pass++; console.log('  ok   ' + nome); }
  else { fail++; console.log('  FAIL ' + nome + (dettaglio ? '  -> ' + dettaglio : '')); }
}

console.log('\n=== Segnalazioni di bug ===');
[
  'i nemici sono velocissimi e la navicella è sparita',   // il caso reale
  'il gioco non parte',
  'quando clicco non succede nulla',
  "c'è un bug nel menu",
  'mi da errore alla riga 40',
  'la pagina si blocca dopo un minuto',
  "the start button doesn't work",
  'il pulsante non funziona più'
].forEach(function (t) { check('bug: ' + t, m.sembraUnBug(t)); });

// Compresi i messaggi della suite live: non devono far partire una misura.
[
  'Rispondi solo con la parola VIVO, nientaltro.',
  'Come ti chiami? Rispondi solo con il nome.',
  'Usa lo strumento Write per creare il file __live_test__.txt con dentro esattamente la parola CIAOMONDO. Poi conferma.',
  'Nella tua memoria persistente c e la voce "Codice di collaudo". Riportane il valore esatto.',
  'Rispondi solo con la parola PRESENTE.',
  'aggiungi un pulsante pausa',
  'crea una pagina con un form di contatto',
  'non vado di fretta, fai con calma'
].forEach(function (t) { check('non bug: ' + t, !m.sembraUnBug(t)); });

console.log('\n=== Stesso fatto, numeri diversi ===');
const raddoppio = (a, b) => 'Dopo il secondo clic su "Riprova!" le callback di animazione passano da ' +
  a + ' a ' + b + ' al secondo: ogni riavvio aggiunge un ciclo invece di sostituirlo.';
check('misure diverse dello stesso fatto hanno la stessa chiave',
  m.chiaveFatto(raddoppio(61, 122)) === m.chiaveFatto(raddoppio(60, 121)));
check('un errore la cui riga si sposta resta lo stesso errore',
  m.chiaveFatto('Errore JavaScript: type is not defined [game.js:245]') ===
  m.chiaveFatto('Errore JavaScript: type is not defined [game.js:251]'));
check('fatti diversi hanno chiavi diverse',
  m.chiaveFatto(raddoppio(61, 122)) !== m.chiaveFatto('Il mouse sopra canvas#c arriva a div#ui in 5 punti su 5'));

console.log('\n=== Fatti della sonda ===');
const fatti = m.fattiDellaSonda({
  note: [
    'Nessun pulsante visibile: mi limito a osservare la pagina nel tempo.',
    'Il mouse sopra canvas#c arriva a div#ui in 5 punti su 5: in quelle zone il canvas non riceve ne\' movimenti ne\' clic.',
    'Passo 1: clic su #a -> ricevuto da button#a',
    'Il pulsante principale non e\' riapparso entro 15 secondi: il riavvio non e\' stato provato.'
  ],
  errori: ['x is not defined [a.js:3]']
});
check('scarta le note informative e tiene i difetti', fatti.length === 2, JSON.stringify(fatti));
check('gli errori JavaScript diventano fatti', fatti[1] === 'Errore JavaScript: x is not defined [a.js:3]', fatti[1]);
check('una sonda fallita non produce fatti', m.fattiDellaSonda({ errore: 'boom', note: ['x'] }).length === 0);

console.log('\n=== Confronto prima / dopo ===');
const A1 = raddoppio(61, 122);
const A2 = raddoppio(60, 121);
const B = 'Il mouse sopra canvas#c arriva a div#ui in 5 punti su 5: in quelle zone il canvas non riceve ne\' movimenti ne\' clic.';
const C = 'Dopo movimenti reali del mouse, mouseX e mouseY valgono ancora 0: gli eventi del mouse non raggiungono il codice che li ascolta.';
const D = 'Errore JavaScript: player is not defined [game.js:12]';
const esito = m.confrontaFatti([A1, B, C], [A2, D]);
check('resta il fatto non corretto, con i numeri nuovi', esito.restano.length === 1 && esito.restano[0] === A2,
  JSON.stringify(esito.restano));
check('i fatti spariti sono risolti', esito.risolti.length === 2 && esito.risolti.indexOf(B) !== -1 && esito.risolti.indexOf(C) !== -1);
check('un fatto comparso dopo la modifica e\' nuovo', esito.nuovi.length === 1 && esito.nuovi[0] === D);
const tutto = m.confrontaFatti([A1, B], []);
check('nessun fatto dopo = tutto risolto', tutto.restano.length === 0 && tutto.nuovi.length === 0 && tutto.risolti.length === 2);

console.log('\n=== Un fatto non provato non e\' un fatto risolto ===');
const senzaRiavvio = m.confrontaFatti([A1, B], [], { canvas: true, riavvio: false, errori: true });
check('il fatto del canvas, riprovato, e\' risolto', senzaRiavvio.risolti.length === 1 && senzaRiavvio.risolti[0] === B,
  JSON.stringify(senzaRiavvio.risolti));
check('il riavvio non provato resta da verificare', senzaRiavvio.nonVerificati.length === 1 && senzaRiavvio.nonVerificati[0] === A1,
  JSON.stringify(senzaRiavvio.nonVerificati));
check('senza informazioni su cosa e\' stato provato vale il confronto semplice',
  m.confrontaFatti([A1], []).risolti.length === 1 && m.confrontaFatti([A1], []).nonVerificati.length === 0);
check('categorie dei fatti', m.categoriaFatto(A1) === 'riavvio' && m.categoriaFatto(B) === 'canvas' &&
  m.categoriaFatto(C) === 'mouse' && m.categoriaFatto(D) === 'errori' && m.categoriaFatto('altro testo') === 'altro');

console.log('\n=== Un errore la cui riga non e\' stata eseguita non e\' risolto ===');
const E1 = 'Errore JavaScript: Uncaught ReferenceError: type is not defined [game.js:359]';
const E2 = 'Errore JavaScript: type is not defined\nhttp://127.0.0.1:3456/preview/game.js:359:55\nArray.forEach (<anonymous>)';
check('riga dell\'errore dalla pagina', JSON.stringify(m.rigaDellErrore(E1)) === '{"file":"game.js","riga":359}', JSON.stringify(m.rigaDellErrore(E1)));
check('riga dell\'errore dallo stack', JSON.stringify(m.rigaDellErrore(E2)) === '{"file":"game.js","riga":359}', JSON.stringify(m.rigaDellErrore(E2)));
const mai = { 'game.js': [[1, 350], [372, 400]] };
const eseguita = { 'game.js': [[1, 400]] };
check('riga mai eseguita dopo: non provato', m.confrontaFatti([E1, E2], [], null, mai).nonVerificati.length === 2);
check('riga eseguita dopo senza errore: risolto', m.confrontaFatti([E1], [], null, eseguita).risolti.length === 1);
check('file non coperto: vale il confronto semplice', m.confrontaFatti([E1], [], null, { 'altro.js': [[1, 9]] }).risolti.length === 1);

console.log('\n=== Schermate da allegare ===');
const scatti = [
  { momento: 'caricamento', file: 'a.png' },
  { momento: '+1s dal clic', file: 'b.png' },
  { momento: '+3s dal clic', file: 'c.png' },
  { momento: '+1s dal secondo clic', file: 'd.png' }
];
check('dopo il clic e l\'ultima', JSON.stringify(m.scegliSchermate({ schermate: scatti })) === '["b.png","d.png"]');
check('una sola schermata', JSON.stringify(m.scegliSchermate({ schermate: [scatti[0]] })) === '["a.png"]');
check('nessuna schermata', m.scegliSchermate({}).length === 0);

console.log('\n=== Scelta della pagina ===');
const pagine = ['index.html', 'about.html', 'gioco.html'];
check('la pagina citata nel messaggio', m.scegliPagina(pagine, null, 'il menu di about.html non va') === 'about.html');
check('la citata vince su quella aperta', m.scegliPagina(pagine, 'gioco.html', 'in about.html non va') === 'about.html');
check('altrimenti quella aperta in Anteprima', m.scegliPagina(pagine, 'gioco.html', 'non funziona') === 'gioco.html');
check('una pagina inesistente non viene usata', m.scegliPagina(pagine, 'nonc.html', 'non va') === 'index.html');
check('senza pagine niente misura', m.scegliPagina([], 'a.html', 'non va') === null);

const pagineConSub = ['index.html', 'zombie-game-new/index.html', 'aliengame/index.html'];
check('sceglie la pagina dalla sottocartella citata nel messaggio',
  m.scegliPagina(pagineConSub, null, 'il gioco degli zombie non parte') === 'zombie-game-new/index.html');
check('sceglie la pagina alien dalla parola alien',
  m.scegliPagina(pagineConSub, null, 'gli alieni non si muovono') === 'aliengame/index.html');
// Caso vero del 18/9/2026: "gioco" non somiglia a "game", e veniva misurato il curriculum
// (la prima pagina in ordine alfabetico) con il risultato "nessun difetto" sulla pagina sbagliata.
const pagineUtente = ['curriculum/index.html', 'fps-game/index.html'];
check('"il gioco non parte" trova la cartella fps-game',
  m.scegliPagina(pagineUtente, null, 'puoi sistemare il gioco che non parte? dovrebbeessere un multiplayer deathmatch con gli zombie') === 'fps-game/index.html');
check('e le parole sul curriculum restano sul curriculum',
  m.scegliPagina(pagineUtente, null, 'il css del curriculum e\' rotto') === 'curriculum/index.html');
check('anche "gli zombie non si muovono" porta al gioco',
  m.scegliPagina(pagineUtente, null, 'gli zombie non si muovono') === 'fps-game/index.html');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'confronto-misure-'));
['b.html', 'index.html', 'x.js', 'nota.htm'].forEach(function (f) { fs.writeFileSync(path.join(tmp, f), ''); });
fs.mkdirSync(path.join(tmp, 'subgame'));
fs.writeFileSync(path.join(tmp, 'subgame', 'play.html'), '');
const elenco = m.pagineDelProgetto(tmp);
check('pagine del progetto, index per prima e poi sottocartelle',
  JSON.stringify(elenco) === '["index.html","b.html","nota.htm","subgame/play.html"]', JSON.stringify(elenco));
check('cartella inesistente = nessuna pagina', m.pagineDelProgetto(path.join(tmp, 'non-esiste')).length === 0);
fs.rmSync(tmp, { recursive: true, force: true });

console.log('\n=== File che riguardano la pagina ===');
const dir = path.join(os.tmpdir(), 'progetto-finto');
check('script del progetto', m.filePertinente(dir, path.join(dir, 'game.js')));
check('foglio di stile in una sottocartella', m.filePertinente(dir, path.join(dir, 'css', 'a.css')));
check('percorso relativo', m.filePertinente(dir, 'index.html'));
check('non un file web', !m.filePertinente(dir, path.join(dir, 'README.md')));
check('fuori dal progetto', !m.filePertinente(dir, path.join(os.tmpdir(), 'altro', 'game.js')));

console.log('\n=== Oggetti eliminati e crescita ===');
const morti = (n, esempio) => 'Oggetti eliminati che restano in gioco: in enemies ' + n + ' elementi hanno health <= 0 ' +
  'da oltre 1,5 secondi ma sono ancora nell\'elenco (300 elementi in tutto). Va tolto dall\'elenco. Esempio: ' + esempio;
check('categoria oggetti', m.categoriaFatto(morti(9, '{x:1}')) === 'oggetti');
check('l\'esempio (un altro nemico a ogni misura) non conta nel confronto',
  m.chiaveFatto(morti(9, '{x:1, color:"#ff4444"}')) === m.chiaveFatto(morti(11, '{x:474, color:"#88ff44"}')));
const crescita = 'L\'elenco player.bullets continua a crescere: in media 10 elementi nel primo terzo della prova, 90 nel secondo e 200 nell\'ultimo.';
check('categoria crescita, anche con il punto nel nome', m.categoriaFatto(crescita) === 'crescita');

const serie = (valori, passo) => valori.map((n, i) => ({ t: 1000 + i * (passo || 1000), elenchi: { enemies: n } }));
const reale = m.analizzaCrescita(serie([83, 150, 197, 220, 239, 255, 271, 290, 300, 312, 300]));
check('il caso reale: cresce anche se alla fine cala un po\'', reale.length === 1, JSON.stringify(reale));
check('dice le mediane dei tre terzi e il ritmo', reale.length === 1 && reale[0].mediane.length === 3 && reale[0].alSecondo >= 4, JSON.stringify(reale));
check('un gioco che sale e poi si assesta non e\' crescita', m.analizzaCrescita(serie([50, 300, 300, 302, 298, 300, 301, 299, 300, 300])).length === 0);
check('un elenco piccolo non allarma', m.analizzaCrescita(serie([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).length === 0);
check('una prova troppo corta non basta', m.analizzaCrescita(serie([80, 150, 220, 290, 360, 430], 500)).length === 0);
check('un elenco che oscilla non cresce', m.analizzaCrescita(serie([100, 150, 90, 160, 80, 170, 95, 150, 100, 160])).length === 0);
check('non provato se la misura dopo non ha seguito la crescita',
  m.confrontaFatti([crescita], [], { crescita: false }).nonVerificati.length === 1);

console.log('\n=== Focus: un problema alla volta ===');
const fErrore = 'Errore JavaScript: Uncaught ReferenceError: x is not defined [game.js:3]';
const fClic = 'Il clic sul pulsante "Gioca" non produce alcun effetto misurabile.';
const fRegr = 'Regressione «Il gioco parte»: prima delle ultime modifiche questo collaudo passava, ora no.';
const fCollA = 'Collaudo fallito «La vita scende»: atteso che vita < 100, ma e\' falso.';
const fCollB = 'Collaudo fallito «I punti salgono»: atteso che score > 0, ma e\' falso.';
const fCanvas = 'Il mouse sopra canvas#c arriva a div#ui in 5 punti su 5.';
const fEsporta = 'Il clic sul pulsante "Esporta" e\' arrivato a nulla, non al pulsante.';
const fAnteprima = 'Nell\'anteprima le forme modificate nell\'editor non vengono aggiornate.';
const fMorti = morti(3, '{}');
const ord = m.ordinaPerFocus([fCollA, crescita, fMorti, fCanvas, fRegr, fClic, fErrore]);
check('prima gli errori JavaScript, poi il pulsante, poi le regressioni', ord[0] === fErrore && ord[1] === fClic && ord[2] === fRegr, JSON.stringify(ord));
check('i collaudi falliti per ultimi', ord[ord.length - 1] === fCollA);
check('oggetti eliminati prima della crescita (spesso ne sono la causa)', ord.indexOf(fMorti) < ord.indexOf(crescita));
check('senza fatti nessun focus', m.scegliFocus([], null) === null);
check('il focus resta finche\' c\'e\', fra problemi dello stesso tipo', m.scegliFocus([fCollA, fCollB], m.chiaveFatto(fCollB)) === fCollB);
check('un problema piu\' urgente prende il focus', m.scegliFocus([fCollA, fErrore], m.chiaveFatto(fCollA)) === fErrore);
check('risolto il focus si passa al successivo', m.scegliFocus([crescita, fCollA], m.chiaveFatto(fMorti)) === crescita);
const richiestaEditorForme = 'Il problema e\' nell\'editor forme: non cambia nulla nell\'anteprima.';
check('una verifica sul pulsante Esporta non e\' pertinente all\'editor delle forme',
  m.fattiPertinenti([fEsporta], richiestaEditorForme).length === 0 &&
  m.scegliFocus([fEsporta], null, richiestaEditorForme) === null);
check('la verifica collegata ad anteprima e forme resta pertinente',
  m.fattiPertinenti([fEsporta, fAnteprima], richiestaEditorForme).length === 1 &&
  m.scegliFocus([fEsporta, fAnteprima], null, richiestaEditorForme) === fAnteprima);
check('una richiesta sul pulsante Esporta mantiene il relativo rilievo',
  m.scegliFocus([fEsporta], null, 'Il pulsante Esporta non funziona') === fEsporta);
check('senza termini tematici il filtro conserva il comportamento generale',
  m.fattiPertinenti([fEsporta], 'Sistemalo').length === 1);

console.log('\n' + '='.repeat(50));
console.log('CONFRONTO MISURE: ' + pass + ' passati, ' + fail + ' falliti');
process.exit(fail ? 1 : 0);
