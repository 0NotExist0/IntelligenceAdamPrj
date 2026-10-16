// Prova il passaggio multimodale con un provider HTTP locale: nessuna immagine o chiave
// viene inviata a un servizio remoto.
const assert = require('assert');
const http = require('http');
const vision = require('../strumenti/vision-router');

function avviaProviderLocale(gestore) {
  const server = http.createServer(gestore);
  return new Promise(function (resolve, reject) {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', function () {
      resolve({ server: server, base: 'http://127.0.0.1:' + server.address().port });
    });
  });
}

(async function () {
  let ricevuto = null;
  const provider = await avviaProviderLocale(function (req, res) {
    let corpo = '';
    req.on('data', function (parte) { corpo += parte; });
    req.on('end', function () {
      ricevuto = { path: req.url, auth: req.headers.authorization || req.headers['x-api-key'], body: JSON.parse(corpo) };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: 'Vedo una finestra di prova.' } }] }));
    });
  });

  try {
    const descrizione = await vision.analizzaImmagini({
      provider: 'openrouter',
      model: 'custom:vision-test',
      apiKey: 'chiave-locale-finta',
      baseUrl: provider.base + '/v1',
      images: [{ mediaType: 'image/png', data: Buffer.from('immagine finta').toString('base64') }],
      userText: 'Che cosa si vede?',
      fetchImpl: fetch
    });
    assert.strictEqual(descrizione, 'Vedo una finestra di prova.');
    assert.strictEqual(ricevuto.path, '/v1/chat/completions');
    assert.strictEqual(ricevuto.auth, 'Bearer chiave-locale-finta');
    assert.strictEqual(ricevuto.body.model, 'vision-test');
    assert.strictEqual(ricevuto.body.stream, true);
    assert.ok(ricevuto.body.messages[0].content.some(function (parte) {
      return parte.type === 'image_url' && parte.image_url.url === 'data:image/png;base64,' + Buffer.from('immagine finta').toString('base64');
    }));
    assert.ok(ricevuto.body.messages[0].content[0].text.includes('Che cosa si vede?'));
    console.log('  ok   provider OpenAI-compatible riceve immagine e richiesta e restituisce testo');

    const partiRicevute = [];
    const providerStreaming = await avviaProviderLocale(function (_req, res) {
      res.setHeader('content-type', 'text/event-stream');
      res.write('data: {"choices":[{"delta":{"content":"Vedo "}}]}\n\n');
      setTimeout(function () {
        res.write('data: {"choices":[{"delta":{"content":"una bicicletta."}}]}\n\n');
        res.end('data: [DONE]\n\n');
      }, 10);
    });
    try {
      const descrizioneStreaming = await vision.analizzaImmagini({
        provider: 'openrouter', model: 'custom:vision-test', apiKey: 'chiave-locale-finta',
        baseUrl: providerStreaming.base + '/v1',
        images: [{ mediaType: 'image/png', data: 'ZmFrZQ==' }],
        onDelta: function (parte) { partiRicevute.push(parte); }, fetchImpl: fetch
      });
      assert.strictEqual(descrizioneStreaming, 'Vedo una bicicletta.');
      assert.deepStrictEqual(partiRicevute, ['Vedo ', 'una bicicletta.']);
    } finally {
      await new Promise(function (resolve) { providerStreaming.server.close(resolve); });
    }
    console.log('  ok   i delta SSE di Vision vengono mostrati progressivamente');

    let errorePresente = false;
    const erroreProvider = await avviaProviderLocale(function (_req, res) {
      res.statusCode = 429;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: { message: 'limite superato' } }));
    });
    try {
      await vision.analizzaImmagini({
        provider: 'custom', model: 'custom:vision-test', apiKey: 'chiave-locale-finta',
        baseUrl: erroreProvider.base + '/v1',
        images: [{ mediaType: 'image/jpeg', data: 'ZmFrZQ==' }], fetchImpl: fetch
      });
    } catch (err) {
      errorePresente = /limite superato/.test(err.message);
    } finally {
      await new Promise(function (resolve) { erroreProvider.server.close(resolve); });
    }
    assert.ok(errorePresente, 'l errore del provider deve risalire al chiamante');
    console.log('  ok   errori del provider non diventano invii testuali senza immagine');

    let chiamateTransitorie = 0;
    const providerTransitorio = await avviaProviderLocale(function (_req, res) {
      chiamateTransitorie++;
      res.setHeader('content-type', 'application/json');
      if (chiamateTransitorie === 1) {
        res.statusCode = 503;
        res.end(JSON.stringify({ error: { message: 'Worker local total request limit reached (16/16)' } }));
        return;
      }
      res.end(JSON.stringify({ choices: [{ message: { content: 'Analisi riuscita al secondo tentativo.' } }] }));
    });
    try {
      const dopoRetry = await vision.analizzaImmagini({
        provider: 'custom', model: 'custom:vision-test', apiKey: 'chiave-locale-finta',
        baseUrl: providerTransitorio.base + '/v1', images: [{ mediaType: 'image/png', data: 'ZmFrZQ==' }],
        fetchImpl: fetch
      });
      assert.strictEqual(dopoRetry, 'Analisi riuscita al secondo tentativo.');
      assert.strictEqual(chiamateTransitorie, 2);
    } finally {
      await new Promise(function (resolve) { providerTransitorio.server.close(resolve); });
    }
    console.log('  ok   gli errori transitori del worker Vision vengono ritentati una volta');

    assert.deepStrictEqual(
      vision.separaModello('openrouter:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', 'custom'),
      { provider: 'openrouter', model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free' }
    );
    console.log('  ok   il prefisso esplicito instrada il modello OpenRouter');

    assert.strictEqual(
      vision.modelloVisionePredefinito('nvidia'),
      'nvidia:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning'
    );
    assert.deepStrictEqual(
      vision.separaModello(vision.modelloVisionePredefinito('nvidia'), 'openrouter'),
      { provider: 'nvidia', model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning' }
    );
    assert.strictEqual(
      vision.risolviModelloVisione('', 'nvidia', 'nvidia/nemotron-3-ultra-550b-a55b'),
      vision.MODELLO_VISIONE_NVIDIA
    );
    assert.strictEqual(
      vision.risolviModelloVisione('nvidia:nvidia/nemotron-3-ultra-550b-a55b', 'nvidia', 'nvidia/nemotron-3-ultra-550b-a55b'),
      vision.MODELLO_VISIONE_NVIDIA
    );
    assert.strictEqual(
      vision.risolviModelloVisione('openai:gpt-4o', 'nvidia', 'nvidia/nemotron-3-ultra-550b-a55b'),
      'openai:gpt-4o'
    );
    assert.strictEqual(vision.risolviModelloVisione('', 'custom', 'custom:testo-only'), '');
    assert.strictEqual(vision.risolviModelloVisione('', 'openai', 'gpt-4o'), 'gpt-4o');
    console.log('  ok   i modelli testuali non vengono riutilizzati per errore e NVIDIA seleziona un VLM');
  } finally {
    await new Promise(function (resolve) { provider.server.close(resolve); });
  }
  console.log('\nVISION ROUTER: tutti i controlli superati');
})().catch(function (err) {
  console.error(err && err.stack || err);
  process.exit(1);
});
