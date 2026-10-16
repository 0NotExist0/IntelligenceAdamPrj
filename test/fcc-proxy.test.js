'use strict';

const assert = require('assert');
const fcc = require('../strumenti/fcc-proxy');

let passati = 0;
function check(nome, funzione) {
  return Promise.resolve().then(funzione).then(function () {
    passati++;
    console.log('  ok   ' + nome);
  });
}

(async function () {
  await check('non avvia un secondo proxy quando la porta risponde', async function () {
    let avvii = 0;
    const esito = await fcc.avviaSeNecessario({
      verifica: async function () { return true; },
      avvia: function () { avvii++; }
    });
    assert.equal(esito.ok, true);
    assert.equal(esito.giaAttivo, true);
    assert.equal(avvii, 0);
  });

  await check('avvia il proxy installato e attende che sia pronto', async function () {
    let controlli = 0;
    let eseguibileAvviato = '';
    const esito = await fcc.avviaSeNecessario({
      eseguibile: 'C:/fcc-server.exe',
      pausaMs: 1,
      tentativi: 3,
      verifica: async function () { controlli++; return controlli >= 2; },
      avvia: function (file) { eseguibileAvviato = file; }
    });
    assert.equal(esito.ok, true);
    assert.equal(esito.avviato, true);
    assert.equal(eseguibileAvviato, 'C:/fcc-server.exe');
  });

  await check('spiega quando fcc-server non e installato', async function () {
    const esito = await fcc.avviaSeNecessario({
      verifica: async function () { return false; },
      esiste: function () { return false; }
    });
    assert.equal(esito.ok, false);
    assert.match(esito.errore, /non trovato/);
  });

  console.log('\nFCC PROXY: ' + passati + ' controlli superati');
})().catch(function (errore) {
  console.error(errore.stack || errore);
  process.exitCode = 1;
});
