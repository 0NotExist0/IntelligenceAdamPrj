// Prova le sveglie di Adam: durate, limiti contro i risvegli infiniti, conservazione, testo.
const fs = require('fs');
const os = require('os');
const path = require('path');
const s = require('../strumenti/sveglie');

let pass = 0;
let fail = 0;
function check(nome, condizione, dettaglio) {
  if (condizione) { pass++; console.log('  ok   ' + nome); }
  else { fail++; console.log('  FAIL ' + nome + (dettaglio !== undefined ? '  -> ' + dettaglio : '')); }
}

console.log('\n=== Durate ===');
[['300', 300], ['90s', 90], ['5m', 300], ['5 min', 300], ['1h', 3600], ['1h30m', 5400], ['2 ore', 7200], ['10 minuti', 600]]
  .forEach(function (c) { check(c[0] + ' = ' + c[1] + ' s', s.leggiDurata(c[0]) === c[1], s.leggiDurata(c[0])); });
check('parole senza numeri = non valida', s.leggiDurata('tra poco') === null);
check('pezzi sconosciuti = non valida', s.leggiDurata('5m poi') === null);

console.log('\n=== Nuova sveglia ===');
const ora = new Date(2026, 8, 11, 1, 20).getTime();
const buona = s.nuovaSveglia({ tra: '10m', motivo: 'controlla che il contatore regga', pagina: 'index.html', guarda: true }, ora);
check('sveglia valida', buona.sveglia && buona.sveglia.quando === ora + 600000 && buona.sveglia.stato === 'in attesa', JSON.stringify(buona));
check('con --guarda porta la pagina da riprovare', buona.sveglia.guarda === true && buona.sveglia.pagina === 'index.html');
check('troppo presto', /troppo presto/.test(s.nuovaSveglia({ tra: '5s', motivo: 'x controlla' }, ora).errore));
check('troppo tardi', /troppo tardi/.test(s.nuovaSveglia({ tra: '25h', motivo: 'x controlla' }, ora).errore));
check('serve il motivo', /serve il motivo/.test(s.nuovaSveglia({ tra: '5m', motivo: '' }, ora).errore));
check('pagina che risale rifiutata', /pagina non valida/.test(s.nuovaSveglia({ tra: '5m', motivo: 'controlla', pagina: '../x.html' }, ora).errore));
check('guarda senza pagina = niente da guardare', s.nuovaSveglia({ tra: '5m', motivo: 'controlla', guarda: true }, ora).sveglia.guarda === false);

console.log('\n=== Limiti contro i risvegli infiniti ===');
const cinque = [1, 2, 3, 4, 5].map(function (i) { return { id: 'a' + i, creata: ora - i * 1000, quando: ora + i * 60000, stato: 'in attesa' }; });
check('al massimo ' + s.MAX_IN_ATTESA + ' in attesa', /gia' 5 sveglie in attesa/.test(s.oltreILimite(cinque, ora)));
const sei = [1, 2, 3, 4, 5, 6].map(function (i) { return { id: 'b' + i, creata: ora - i * 60000, quando: ora - 1000, stato: 'suonata' }; });
check('al massimo ' + s.MAX_PER_ORA + ' nell\'ultima ora', /troppe sveglie nell'ultima ora/.test(s.oltreILimite(sei, ora)));
check('quelle di ieri non contano', s.oltreILimite(sei.map(function (x) { return Object.assign({}, x, { creata: ora - 86400000 }); }), ora) === null);
check('in attesa, dalla piu\' vicina', s.inAttesa(cinque)[0].id === 'a1');

console.log('\n=== Conservazione ===');
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'prova-sveglie-')), 'sveglie.json');
check('senza file, nessuna sveglia', s.carica(file).length === 0);
s.salva([buona.sveglia], file);
check('salva e rilegge', s.carica(file).length === 1 && s.carica(file)[0].motivo === 'controlla che il contatore regga');
fs.rmSync(path.dirname(file), { recursive: true, force: true });

console.log('\n=== Risveglio ===');
const testo = s.testoRisveglio(buona.sveglia, ora + 600000, 'SONDA - index.html ...');
check('ricorda quando e perche\'', /te l'eri programmata alle 01:20 \(10 minuti fa\)/.test(testo) && /controlla che il contatore regga/.test(testo), testo);
check('con le misure della pagina, se c\'erano', /ha riprovato index\.html/.test(testo) && /SONDA - index\.html/.test(testo));
check('chiede di controllare davvero, non di dare per scontato', /non dare per scontato/.test(testo));
check('senza misure non parla di schermate', !/schermata/.test(s.testoRisveglio(buona.sveglia, ora + 600000, '')));

console.log('\n' + '='.repeat(50));
console.log('SVEGLIE: ' + pass + ' passati, ' + fail + ' falliti');
process.exit(fail ? 1 : 0);
