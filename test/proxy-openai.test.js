// Regressione del traduttore Anthropic -> OpenAI: endpoint custom legacy,
// immagini allegate, Authorization in ingresso e chiusura corretta dello streaming.
const assert = require('assert');
const http = require('http');
const proxy = require('../strumenti/anthropic-openai-proxy');

let pass = 0;
let fail = 0;
function check(nome, condizione, dettaglio) {
  if (condizione) {
    pass++;
    console.log('  ok   ' + nome);
  } else {
    fail++;
    console.log('  FAIL ' + nome + (dettaglio !== undefined ? '  -> ' + dettaglio : ''));
  }
}

function avviaUpstream(gestore) {
  const server = http.createServer(gestore);
  return new Promise(function (resolve, reject) {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', function () {
      resolve({ server: server, base: 'http://127.0.0.1:' + server.address().port });
    });
  });
}

function rispostaJsonFinta() {
  const finta = {
    statusCode: 200,
    payload: null,
    status: function (code) { this.statusCode = code; return this; },
    json: function (obj) { this.payload = obj; if (this._fine) this._fine(obj); return this; }
  };
  finta.done = new Promise(function (resolve) { finta._fine = resolve; });
  return finta;
}

function rispostaStreamFinta() {
  const finta = {
    headers: {},
    testo: '',
    setHeader: function (k, v) { this.headers[k.toLowerCase()] = v; },
    flushHeaders: function () {},
    write: function (parte) { this.testo += parte; },
    end: function () { if (this._fine) this._fine(this.testo); }
  };
  finta.done = new Promise(function (resolve) { finta._fine = resolve; });
  return finta;
}

(async function () {
  console.log('\n=== Endpoint e conversione dei messaggi ===');

  check('OpenRouter ha un endpoint OpenAI compatibile',
    proxy.resolveTargetUrl('openrouter', {}) === 'https://openrouter.ai/api/v1/chat/completions',
    proxy.resolveTargetUrl('openrouter', {}));
  check('custom usa il baseUrl legacy se customBaseUrl manca',
    proxy.resolveTargetUrl('custom', { baseUrl: 'http://127.0.0.1:9999/v1' }) === 'http://127.0.0.1:9999/v1/chat/completions');
  check('custom non duplica un endpoint gia completo',
    proxy.resolveTargetUrl('custom', { customBaseUrl: 'http://host/v1/chat/completions' }) === 'http://host/v1/chat/completions');
  check('prefisso openrouter: vince sul provider custom corrente',
    proxy.deduceProvider('openrouter:meta-llama/llama-3.3-70b-instruct:free', 'custom', {}) === 'openrouter');

  const compatNvidia = proxy.applyProviderCompatibilityOptions({}, 'nvidia', { thinking: { type: 'enabled' } });
  check('NVIDIA riceve force_nonempty_content per evitare risposte vuote negli agenti',
    compatNvidia.chat_template_kwargs.force_nonempty_content === true);
  check('NVIDIA mantiene il ragionamento attivo quando la richiesta lo abilita',
    compatNvidia.chat_template_kwargs.enable_thinking === true);
  const compatNvidiaNoThinking = proxy.applyProviderCompatibilityOptions({}, 'nvidia', { thinking: { type: 'disabled' } });
  check('NVIDIA rispetta il ragionamento disattivato esplicitamente',
    compatNvidiaNoThinking.chat_template_kwargs.enable_thinking === false);
  const compatOpenRouter = proxy.applyProviderCompatibilityOptions({}, 'openrouter', {});
  check('gli altri provider non ricevono opzioni specifiche NVIDIA',
    compatOpenRouter.chat_template_kwargs === undefined);

  const convertiti = proxy.convertAnthropicToOpenAIMessages([
    { role: 'user', content: [
      { type: 'text', text: 'Guarda questa schermata' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } }
    ] },
    { role: 'assistant', content: [
      { type: 'text', text: 'Leggo il file' },
      { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'app.js' } }
    ] },
    { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'toolu_1', content: 'contenuto file' }
    ] }
  ], [{ type: 'text', text: 'Sei Adam' }]);

  check('system Anthropic diventa system OpenAI',
    convertiti[0].role === 'system' && convertiti[0].content === 'Sei Adam');
  check('l immagine non viene scartata',
    Array.isArray(convertiti[1].content) && convertiti[1].content.some(function (p) {
      return p.type === 'image_url' && p.image_url.url === 'data:image/png;base64,aGVsbG8=';
    }), JSON.stringify(convertiti[1]));
  check('tool_use diventa tool_calls OpenAI',
    Array.isArray(convertiti[2].tool_calls) && convertiti[2].tool_calls[0].function.name === 'Read' &&
    convertiti[2].tool_calls[0].function.arguments === '{"file_path":"app.js"}',
    JSON.stringify(convertiti[2]));
  check('tool_result diventa messaggio role=tool',
    convertiti[3].role === 'tool' && convertiti[3].tool_call_id === 'toolu_1');

  console.log('\n=== Immagini restituite dagli strumenti ===');
  const deltaVisione = [];
  let richiesteVisione = 0;
  const messaggiConVisione = await proxy.analizzaImmaginiMessaggi([
    { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_img', name: 'Read', input: { file_path: 'schermata.png' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_img', content: [
      { type: 'text', text: 'Risultato della lettura' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } }
    ] }] }
  ], {
    config: { provider: 'nvidia', model: 'nvidia/nemotron-3-ultra', visionModel: 'nvidia:nvidia/vision-test' },
    getApiKey: function () { return 'chiave-vision'; },
    chatApiKey: 'chiave-direttore',
    chatProvider: 'nvidia',
    getProviderOptions: function () { return {}; },
    onVisionStart: function (info) {
      check('il modello Vision indipendente viene selezionato per il risultato immagine',
        info.provider === 'nvidia' && info.model === 'nvidia:nvidia/vision-test');
      return { onDelta: function (parte) { deltaVisione.push(parte); }, onDone: function () {} };
    },
    analizzaImmagini: async function (opts) {
      richiesteVisione++;
      check('Vision riceve la chiave e il contenuto immagine', opts.apiKey === 'chiave-vision' &&
        opts.images[0].data === 'aGVsbG8=');
      opts.onDelta('Vedo una finestra.');
      return 'Vedo una finestra.';
    }
  });
  const messaggiInoltrati = proxy.convertAnthropicToOpenAIMessages(messaggiConVisione);
  check('un risultato immagine diventa descrizione testuale prima del Direttore',
    richiesteVisione === 1 && deltaVisione.join('') === 'Vedo una finestra.' &&
    messaggiInoltrati[1].role === 'tool' && typeof messaggiInoltrati[1].content === 'string' &&
    messaggiInoltrati[1].content.includes('Vedo una finestra.') && !JSON.stringify(messaggiInoltrati).includes('image_url'));

  console.log('\n=== Handler con provider custom legacy ===');
  let vista = null;
  let viste = [];
  let upstream = await avviaUpstream(function (req, res) {
    let corpo = '';
    req.on('data', function (c) { corpo += c; });
    req.on('end', function () {
      vista = { path: req.url, auth: req.headers.authorization, body: JSON.parse(corpo) };
      viste.push(vista);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        id: 'chatcmpl-test',
        choices: [{ message: { content: 'Fatto', tool_calls: [
          { id: 'call_1', function: { name: 'Read', arguments: '{"file_path":"app.js"}' } }
        ] }, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 12, completion_tokens: 5 }
      }));
    });
  });

  try {
    const handler = proxy.createAnthropicProxyHandler({
      provider: 'custom',
      model: 'custom:modello-locale',
      visionModel: 'custom:vision-test',
      baseUrl: upstream.base + '/v1',
      apiKeys: {}
    }, function () { return ''; });
    const res = rispostaJsonFinta();
    handler({
      headers: { authorization: 'Bearer chiave-in-ingresso' },
      body: {
        model: 'custom:modello-locale',
        max_tokens: 100,
        messages: [{ role: 'user', content: [
          { type: 'text', text: 'controlla' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } }
        ] }]
      }
    }, res);
    await res.done;

    check('usa baseUrl legacy e percorso /v1/chat/completions', vista.path === '/v1/chat/completions', vista.path);
    check('Authorization della richiesta viene propagata come fallback', vista.auth === 'Bearer chiave-in-ingresso', vista.auth);
    check('prefisso custom: tolto dal modello', vista.body.model === 'modello-locale', vista.body.model);
    check('il modello Vision riceve l immagine prima del modello principale', viste.some(function (richiesta) {
      return richiesta.body.model === 'vision-test' && Array.isArray(richiesta.body.messages[0].content) &&
        richiesta.body.messages[0].content.some(function (p) { return p.type === 'image_url'; });
    }));
    check('il modello principale riceve la descrizione Vision come testo senza il file immagine',
      typeof vista.body.messages[0].content === 'string' && vista.body.messages[0].content.includes('Descrizione prodotta dal modello Vision') &&
      !JSON.stringify(vista.body.messages[0]).includes('image_url'), JSON.stringify(vista.body.messages[0]));
    check('risposta OpenAI riconvertita in formato Anthropic', res.payload && res.payload.type === 'message' &&
      res.payload.content.some(function (b) { return b.type === 'tool_use' && b.name === 'Read'; }) &&
      res.payload.stop_reason === 'tool_use', JSON.stringify(res.payload));
  } finally {
    await new Promise(function (resolve) { upstream.server.close(resolve); });
  }

  console.log('\n=== Streaming senza finish_reason esplicito ===');
  upstream = await avviaUpstream(function (req, res) {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"Ciao"}}]}\n\n');
    res.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"Read","arguments":"{\\"file\\":"}}]}}]}\n\n');
    res.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"app.js\\"}"}}]}}]}\n\n');
    res.end('data: [DONE]\n\n');
  });

  try {
    const handler = proxy.createAnthropicProxyHandler({
      provider: 'custom',
      model: 'custom:modello-stream',
      baseUrl: upstream.base,
      apiKeys: { custom: 'chiave' }
    });
    const res = rispostaStreamFinta();
    handler({
      headers: {},
      body: { model: 'custom:modello-stream', stream: true, messages: [{ role: 'user', content: 'ciao' }] }
    }, res);
    const testo = await res.done;

    check('stream espone SSE Anthropic', res.headers['content-type'] === 'text/event-stream; charset=utf-8');
    check('testo e tool call arrivano come blocchi Anthropic', testo.indexOf('"type":"text_delta"') !== -1 &&
      testo.indexOf('"type":"tool_use"') !== -1 && testo.indexOf('"name":"Read"') !== -1);
    check('i due blocchi aperti vengono chiusi', (testo.match(/event: content_block_stop/g) || []).length === 2,
      String((testo.match(/event: content_block_stop/g) || []).length));
    check('senza finish_reason una chiamata conserva tool_use',
      testo.indexOf('event: message_delta') !== -1 && testo.indexOf('"stop_reason":"tool_use"') !== -1);
    check('message_delta precede message_stop', testo.indexOf('event: message_delta') < testo.indexOf('event: message_stop'));
  } finally {
    await new Promise(function (resolve) { upstream.server.close(resolve); });
  }

  console.log('\n=== Chiamata MCP Unity: una sola chiusura tool_use ===');
  upstream = await avviaUpstream(function (req, res) {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'unity_1', function: { name: 'mcp__UnityMCP__manage_scene', arguments: '{"action":"get_active"}' } }] } }] }) + '\n\n');
    // SSE valido anche senza spazio dopo data: e senza newline finale.
    res.end('data:' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }));
  });
  try {
    const handler = proxy.createAnthropicProxyHandler({ provider: 'custom', model: 'custom:test', baseUrl: upstream.base });
    const res = rispostaStreamFinta();
    handler({ headers: {}, body: { stream: true, messages: [{ role: 'user', content: 'Leggi la scena' }] } }, res);
    const testo = await res.done;
    check('una sola chiusura della risposta', (testo.match(/event: message_stop/g) || []).length === 1);
    check('tool_use non viene sostituito da end_turn', testo.includes('"stop_reason":"tool_use"') && !testo.includes('"stop_reason":"end_turn"'));
    check('nome e argomenti MCP preservati', testo.includes('mcp__UnityMCP__manage_scene') && testo.includes('get_active'));
    check('un solo blocco strumento chiuso', (testo.match(/event: content_block_stop/g) || []).length === 1);
  } finally { await new Promise(resolve => upstream.server.close(resolve)); }

  console.log('\nPROXY OPENAI: ' + pass + ' passati, ' + fail + ' falliti');
  process.exit(fail ? 1 : 0);
})().catch(function (err) {
  console.error(err && err.stack || err);
  process.exit(1);
});
