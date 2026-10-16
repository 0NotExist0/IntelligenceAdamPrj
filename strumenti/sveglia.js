// NotExist Intelligience Studio - Sveglia da riga di comando, per Adam.
//
//   node sveglia.js --tra 5m --motivo "controlla che il punteggio si aggiorni" [--guarda index.html]
//   node sveglia.js --elenco
//   node sveglia.js --annulla <id>
//
// La sveglia la tiene lo Studio (strumenti/sveglie.js): all'ora giusta risveglia Adam con il
// motivo scritto qui. Con --guarda lo Studio prima riprova quella pagina nel browser e gli
// allega la schermata, per un controllo anche visivo.

const http = require('http');

const PORTA = process.env.PORT || 3456;

function leggiArgomenti(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const valore = function () { return argv[++i]; };
    if (a === '--tra') o.tra = valore();
    else if (a === '--motivo') o.motivo = valore();
    else if (a === '--guarda') { o.pagina = valore(); o.guarda = true; }
    else if (a === '--pagina') o.pagina = valore();
    else if (a === '--elenco') o.elenco = true;
    else if (a === '--annulla') o.annulla = valore();
  }
  return o;
}

function chiama(metodo, percorso, corpo) {
  return new Promise(function (resolve) {
    const dati = corpo ? JSON.stringify(corpo) : null;
    const req = http.request({
      host: '127.0.0.1', port: PORTA, path: percorso, method: metodo, timeout: 5000,
      headers: dati ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(dati) } : {}
    }, function (res) {
      let testo = '';
      res.setEncoding('utf8');
      res.on('data', function (c) { testo += c; });
      res.on('end', function () {
        let json = null;
        try { json = JSON.parse(testo); } catch (e) { /* risposta non JSON */ }
        resolve({ status: res.statusCode, json: json });
      });
    });
    req.on('error', function (e) { resolve({ status: 0, errore: e.message }); });
    req.on('timeout', function () { req.destroy(); resolve({ status: 0, errore: 'lo Studio non risponde' }); });
    if (dati) req.write(dati);
    req.end();
  });
}

async function principale() {
  const o = leggiArgomenti(process.argv.slice(2));
  if (o.elenco) {
    const r = await chiama('GET', '/api/sveglie');
    if (!r.json) return console.log('Errore: ' + (r.errore || 'risposta non valida')), 1;
    const attesa = r.json.sveglie.filter(function (s) { return s.stato === 'in attesa'; });
    console.log(attesa.length ? attesa.map(function (s) {
      return s.id + '  alle ' + s.ora + '  "' + s.motivo + '"' + (s.guarda ? '  (guarda ' + s.pagina + ')' : '');
    }).join('\n') : 'Nessuna sveglia in attesa.');
    return 0;
  }
  if (o.annulla) {
    const r = await chiama('DELETE', '/api/sveglie/' + encodeURIComponent(o.annulla));
    console.log(r.status === 200 ? 'Sveglia ' + o.annulla + ' annullata.' : 'Errore: ' + ((r.json && r.json.error) || r.errore || r.status));
    return r.status === 200 ? 0 : 1;
  }
  if (!o.tra || !o.motivo) {
    console.log('Uso: node sveglia.js --tra 5m --motivo "cosa controllare" [--guarda pagina.html]\n' +
      '     node sveglia.js --elenco | --annulla <id>');
    return 2;
  }
  const r = await chiama('POST', '/api/sveglie', { tra: o.tra, motivo: o.motivo, pagina: o.pagina, guarda: o.guarda });
  if (r.status !== 200 || !r.json) {
    console.log('Sveglia NON programmata: ' + ((r.json && r.json.error) || r.errore || ('stato ' + r.status)));
    return 1;
  }
  console.log('Sveglia ' + r.json.sveglia.id + ' programmata per le ' + r.json.sveglia.ora + ': "' + r.json.sveglia.motivo + '".' +
    (r.json.sveglia.guarda ? ' Prima di svegliarti lo Studio riprovera\' ' + r.json.sveglia.pagina + ' e ti allegera\' la schermata.' : '') +
    ' Adesso puoi chiudere il turno: sara\' lo Studio a risvegliarti.');
  return 0;
}

principale().then(function (codice) { process.exit(codice || 0); });
