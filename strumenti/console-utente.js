// NotExist Intelligience Studio - La console della pagina che l'utente ha davanti.
//
// Nasce da una frase dell'utente: "Adam non riesce a vedere la console del browser".
// Era vero due volte. Le pagine che apre la sonda: nessuno leggeva console.log, warn ed
// error (ora li legge, vedi sonda.js). E la pagina aperta nell'Anteprima dello Studio:
// le sue righe finivano solo nel pannello che guarda l'utente, quindi Adam poteva solo
// chiedere "cosa dice la console?" a una persona che non sa aprire gli strumenti di
// sviluppo. Ora lo Studio le tiene, e questo comando gliele mostra.
//
// Uso:
//   node console-utente.js                 le ultime righe stampate dalla pagina
//   node console-utente.js --solo-problemi solo errori e avvisi
//   node console-utente.js --json          le stesse righe da leggere con un programma

const http = require('http');

const PORTA = Number(process.env.PORT) || 3456;

function leggi(porta) {
  return new Promise(function (risolvi, rifiuta) {
    const richiesta = http.get({ host: '127.0.0.1', port: porta, path: '/api/console-anteprima', timeout: 4000 }, function (res) {
      let dati = '';
      res.setEncoding('utf8');
      res.on('data', function (p) { dati += p; });
      res.on('end', function () {
        if (res.statusCode !== 200) return rifiuta(new Error('lo Studio ha risposto ' + res.statusCode));
        try { risolvi(JSON.parse(dati)); } catch (e) { rifiuta(new Error('risposta non leggibile: ' + e.message)); }
      });
    });
    richiesta.on('timeout', function () { richiesta.destroy(new Error('lo Studio non risponde')); });
    richiesta.on('error', rifiuta);
  });
}

function ora(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('it-IT');
}

// Prima gli errori: se l'elenco si taglia, si taglia dalla parte che conta meno.
const ORDINE = { errore: 0, avviso: 1, log: 2 };
function peso(v) { return ORDINE[v.tipo] === undefined ? 2 : ORDINE[v.tipo]; }

function rapporto(dati, soloProblemi) {
  const voci = (dati.voci || []).filter(function (v) { return soloProblemi ? v.tipo !== 'log' : true; });
  if (!voci.length) {
    return 'La pagina aperta nell\'Anteprima non ha stampato niente' +
      (soloProblemi ? ' di problematico' : '') + '.\n' +
      'Se l\'Anteprima non e\' aperta, la console non esiste: aprila (o chiedi all\'utente di aprirla) e riprova.\n' +
      'Per provare una pagina da solo, senza l\'utente, usa la verifica: apre un Chrome vero e ti riporta la sua console.';
  }
  const righe = [];
  righe.push('CONSOLE DELLA PAGINA APERTA NELL\'ANTEPRIMA' +
    (dati.pagina ? ' (' + dati.pagina + ')' : '') +
    (ora(dati.da) ? ', dalle ' + ora(dati.da) : '') + ':');
  voci.slice().sort(function (a, b) { return peso(a) - peso(b); }).forEach(function (v) {
    righe.push('  [' + v.tipo + '] ' + v.testo + (v.volte > 1 ? '  (x' + v.volte + ')' : ''));
  });
  if (dati.scartate) righe.push('  ... piu\' ' + dati.scartate + ' messaggi non tenuti (troppi).');
  const errori = voci.filter(function (v) { return v.tipo === 'errore'; }).length;
  righe.push(errori
    ? '\nQuesto lo ha stampato la pagina mentre la usava l\'utente: gli errori qui sopra dicono dove ha smesso di funzionare.'
    : '\nNessun errore: quello che c\'e\' qui e\' il racconto che la pagina fa di se\' stessa.');
  return righe.join('\n');
}

async function principale(argv) {
  const soloProblemi = argv.indexOf('--solo-problemi') !== -1 || argv.indexOf('--solo-errori') !== -1;
  const json = argv.indexOf('--json') !== -1;
  let dati;
  try {
    dati = await leggi(PORTA);
  } catch (e) {
    console.log('Non riesco a leggere la console dell\'Anteprima: ' + e.message + '.');
    // 404 = lo Studio risponde ma non conosce questa strada: e' rimasto acceso da prima
    // che esistesse, e basta riavviarlo.
    console.log(/ha risposto 404/.test(e.message)
      ? 'Lo Studio e\' acceso ma e\' una versione precedente: va riavviato una volta, poi questa console c\'e\'.'
      : 'Questa console la tiene lo Studio (porta ' + PORTA + '): se lo Studio non e\' acceso non c\'e\'.');
    console.log('Per provare una pagina per conto tuo usa la verifica: apre un Chrome vero e ti riporta la sua console.');
    return 2;
  }
  if (json) {
    console.log(JSON.stringify(dati, null, 2));
    return 0;
  }
  console.log(rapporto(dati, soloProblemi));
  return 0;
}

if (require.main === module) {
  principale(process.argv.slice(2)).then(function (codice) { process.exit(codice); });
}

module.exports = { rapporto: rapporto };
