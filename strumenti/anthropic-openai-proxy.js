// Proxy Anthropic /v1/messages → OpenAI Chat Completions
// Per provider che usano formato OpenAI-compatible: Groq, Cerebras, NVIDIA, Gemini, DeepSeek, Mistral, OpenAI, Ashna, Custom
const crypto = require('crypto');

const PROVIDER_ENDPOINTS = {
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  nvidia: 'https://integrate.api.nvidia.com/v1/chat/completions',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  cerebras: 'https://api.cerebras.ai/v1/chat/completions',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  deepseek: 'https://api.deepseek.com/v1/chat/completions',
  mistral: 'https://api.mistral.ai/v1/chat/completions',
  openai: 'https://api.openai.com/v1/chat/completions',
  ashna: 'https://api.ashna.ai/v1/chat/completions'
};

const cacheDescrizioniVisione = new Map();

function resolveTargetUrl(provider, options) {
  const opts = options || {};
  // L'endpoint personalizzato vale SOLO per il provider "custom". Per tutti gli altri
  // l'URL giusto e' quello noto del provider: usare qui il baseUrl storico (che puo'
  // essere quello di Ollama) dirotterebbe NVIDIA/Mistral/ecc. verso l'endpoint sbagliato.
  if (provider === 'custom') {
    const customBase = String(opts.customBaseUrl || opts.baseUrl || '').trim().replace(/\/+$/, '');
    if (customBase) {
      return customBase.endsWith('/chat/completions') ? customBase : customBase + '/chat/completions';
    }
  }
  return PROVIDER_ENDPOINTS[provider] || PROVIDER_ENDPOINTS.openai;
}

function deduceProvider(input, currentProvider, options) {
  if (!input) return currentProvider || 'custom';
  const m = String(input).trim().toLowerCase();
  if (m.startsWith('openrouter:')) return 'openrouter';
  if (m.startsWith('nvidia:') || m.startsWith('nvidia/')) return 'nvidia';
  if (m.startsWith('groq:')) return 'groq';
  if (m.startsWith('cerebras:')) return 'cerebras';
  if (m.startsWith('gemini:')) return 'gemini';
  if (m.startsWith('deepseek:')) return 'deepseek';
  if (m.startsWith('mistral:') || m.startsWith('codestral') || m.startsWith('mistral-')) return 'mistral';
  if (m.startsWith('openai:') || m.startsWith('gpt-') || m.startsWith('o1') || m.startsWith('o3')) return 'openai';
  if (m.startsWith('ashna:')) return 'ashna';
  // Qualsiasi altro caso (modelli "org/nome" come meta/llama..., claude-*, ecc.) resta
  // sul provider configurato: è l'utente a sceglierlo dalla tendina, non va indovinato
  // dalla stringa del modello (m.includes('/') dirottava "meta/llama..." su OpenRouter
  // anche quando l'utente aveva scelto NVIDIA).
  return currentProvider || 'custom';
}

// Converte il contenuto di un tool_result in testo per il modello principale. Le immagini
// sono già passate da Vision prima della conversione: inviarle qui come array OpenAI causa
// un 400 su NVIDIA nei messaggi role=tool.
function convertToolResultContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    // NVIDIA e alcuni endpoint OpenAI-compatible accettano solo stringhe nei messaggi
    // role=tool. Le immagini vengono prima descritte da Vision; qui passano solo testo.
    return content.filter(Boolean).map(function (part) {
      if (part.type === 'text') return String(part.text || '');
      if (part.type === 'image') return '[Immagine non inoltrata: serve prima l’analisi Vision]';
      return '';
    }).filter(Boolean).join('\n');
  }
  return String(content || '');
}

function convertAnthropicToOpenAIMessages(messages, system) {
  const openaiMessages = [];

  if (system && system.length) {
    const sysText = system.map(s => s.type === 'text' ? s.text : '').join('\n\n').trim();
    if (sysText) {
      openaiMessages.push({ role: 'system', content: sysText });
    }
  }

  for (const msg of messages) {
    const role = msg.role === 'assistant' ? 'assistant' : msg.role;

    if (msg.content && Array.isArray(msg.content)) {
      let textContent = '';
      const images = [];
      const toolCalls = [];
      let hasToolResult = false;

      for (const block of msg.content) {
        if (block.type === 'text') {
          textContent += block.text;
        } else if (block.type === 'image') {
          const mediaType = block.source?.media_type || 'image/png';
          const data = block.source?.data || '';
          images.push({
            type: 'image_url',
            image_url: { url: `data:${mediaType};base64,${data}` }
          });
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input || {})
            }
          });
        } else if (block.type === 'tool_result') {
          hasToolResult = true;
          openaiMessages.push({
            role: 'tool',
            tool_call_id: block.tool_use_id,
            content: convertToolResultContent(block.content)
          });
        }
      }

      if (role === 'assistant' && toolCalls.length) {
        openaiMessages.push({
          role: 'assistant',
          content: textContent || null,
          tool_calls: toolCalls
        });
      } else if (images.length) {
        const content = [];
        if (textContent) content.push({ type: 'text', text: textContent });
        images.forEach(img => content.push(img));
        openaiMessages.push({ role, content });
      } else if (hasToolResult) {
        // Messaggio composto solo da tool_result: è già stato emesso come messaggi
        // "tool" qui sopra; non va aggiunto un messaggio user/assistant vuoto.
      } else if (textContent || role === 'user') {
        openaiMessages.push({ role, content: textContent });
      }
    } else if (msg.content && typeof msg.content === 'string') {
      openaiMessages.push({ role, content: msg.content });
    }
  }

  return openaiMessages;
}

function applyProviderCompatibilityOptions(openaiBody, provider, anthropicBody) {
  const body = anthropicBody || {};

  // Nemotron 3 Ultra può concludere una chiamata a strumenti con content vuoto.
  // NVIDIA documenta force_nonempty_content per gli agenti di coding; senza il
  // parametro il client Anthropic può ricevere solo ragionamento/tool call e nessuna
  // risposta finale da mostrare.
  if (provider === 'nvidia') {
    const thinking = body.thinking;
    openaiBody.chat_template_kwargs = Object.assign({}, body.chat_template_kwargs || {}, {
      enable_thinking: !(thinking && thinking.type === 'disabled'),
      force_nonempty_content: true
    });
  }

  return openaiBody;
}

function clonaMessaggiESeparaImmagini(messages) {
  const riferimenti = [];
  function sostituisci(source) {
    const blocco = { type: 'text', text: '' };
    riferimenti.push({
      source: source || {},
      imposta: function (testo) { blocco.text = testo; }
    });
    return blocco;
  }

  const copiati = (Array.isArray(messages) ? messages : []).map(function (message) {
    if (!message || !Array.isArray(message.content)) return message;
    return Object.assign({}, message, {
      content: message.content.map(function (block) {
        if (!block) return block;
        if (block.type === 'image') return sostituisci(block.source);
        if (block.type !== 'tool_result') return block;

        if (Array.isArray(block.content)) {
          const content = block.content.map(function (part) {
            return part && part.type === 'image' ? sostituisci(part.source) : part;
          });
          return Object.assign({}, block, { content: content });
        }
        if (block.content && block.content.type === 'image') {
          const placeholder = sostituisci(block.content.source);
          return Object.assign({}, block, { content: [placeholder] });
        }
        return block;
      })
    });
  });
  return { messages: copiati, references: riferimenti };
}

function testoRichiestaVisione(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const message = list[i];
    if (!message || message.role !== 'user' || !Array.isArray(message.content)) continue;
    const testo = message.content.filter(function (block) { return block && block.type === 'text'; })
      .map(function (block) { return String(block.text || ''); }).join('\n').trim();
    if (testo) return testo.slice(0, 6000);
  }
  return 'Descrivi l’immagine restituita dalla conversazione e riporta dettagli utili alla richiesta in corso.';
}

async function analizzaImmaginiMessaggi(messages, options) {
  // Lazy require: vision-router uses this module for endpoint resolution, so loading
  // it at module scope would create a circular dependency with incomplete exports.
  const routerVisione = require('./vision-router');
  const opts = options || {};
  const separated = clonaMessaggiESeparaImmagini(messages);
  if (!separated.references.length) return separated.messages;

  const model = routerVisione.risolviModelloVisione(opts.config && opts.config.visionModel,
    opts.config && opts.config.provider, opts.config && opts.config.model);
  if (!model) throw new Error('modello Vision non configurato');
  const provider = routerVisione.separaModello(model, opts.config && opts.config.provider).provider;
  const keyDaConfig = typeof opts.getApiKey === 'function' ? String(opts.getApiKey(provider) || '').trim() : '';
  const apiKey = keyDaConfig || (provider === opts.chatProvider ? String(opts.chatApiKey || '').trim() : '');
  const providerOptions = typeof opts.getProviderOptions === 'function'
    ? opts.getProviderOptions(provider, opts.config) || {}
    : { baseUrl: opts.config && opts.config.baseUrl, customBaseUrl: opts.config && (opts.config.customBaseUrl || opts.config.baseUrl) };
  const context = testoRichiestaVisione(messages);
  const descrizioni = new Map();
  const riferimentiPerHash = new Map();

  separated.references.forEach(function (reference) {
    const source = reference.source || {};
    const data = String(source.data || '');
    const mediaType = String(source.media_type || 'image/png');
    if (!data || !/^image\/(?:png|jpeg|webp|gif)$/i.test(mediaType)) {
      throw new Error('Vision non ha ricevuto un’immagine base64 supportata dal risultato dello strumento');
    }
    const hash = crypto.createHash('sha256').update(provider).update('\0').update(model).update('\0').update(mediaType).update('\0').update(data).digest('hex');
    if (!riferimentiPerHash.has(hash)) riferimentiPerHash.set(hash, { mediaType: mediaType, data: data, references: [] });
    riferimentiPerHash.get(hash).references.push(reference);
  });

  let nuoveAnalisi = 0;
  for (const [hash, voce] of Array.from(riferimentiPerHash.entries()).reverse()) {
    let descrizione = cacheDescrizioniVisione.get(hash);
    if (!descrizione) {
      if (nuoveAnalisi >= routerVisione.MAX_IMMAGINI_ANALISI) {
        descrizioni.set(hash, 'Immagine precedente non ri-analizzata: limite di immagini per questa richiesta raggiunto.');
        continue;
      }
      nuoveAnalisi++;
      const live = typeof opts.onVisionStart === 'function'
        ? opts.onVisionStart({ model: model, provider: provider, mediaType: voce.mediaType })
        : null;
      try {
        descrizione = await (opts.analizzaImmagini || routerVisione.analizzaImmagini)({
          provider: provider,
          model: model,
          apiKey: apiKey,
          baseUrl: providerOptions.baseUrl || '',
          customBaseUrl: providerOptions.customBaseUrl || providerOptions.baseUrl || '',
          images: [{ mediaType: voce.mediaType, data: voce.data }],
          userText: context,
          onDelta: live && live.onDelta
        });
        cacheDescrizioniVisione.set(hash, descrizione);
        if (cacheDescrizioniVisione.size > 500) {
          cacheDescrizioniVisione.delete(cacheDescrizioniVisione.keys().next().value);
        }
        if (live && typeof live.onDone === 'function') live.onDone();
      } catch (err) {
        if (live && typeof live.onError === 'function') live.onError(err);
        throw err;
      }
    }
    descrizioni.set(hash, descrizione);
  }

  separated.references.forEach(function (reference) {
    const source = reference.source || {};
    const mediaType = String(source.media_type || 'image/png');
    const hash = crypto.createHash('sha256').update(provider).update('\0').update(model).update('\0').update(mediaType).update('\0').update(String(source.data || '')).digest('hex');
    reference.imposta('[Descrizione prodotta dal modello Vision (' + model + ') — l’immagine non viene inoltrata al Direttore]:\n' + (descrizioni.get(hash) || ''));
  });
  return separated.messages;
}

function convertOpenAIToAnthropicStream(openaiChunk, state) {
  const lines = [];
  if (state.finished) return lines;
  const choice = openaiChunk.choices?.[0];
  if (!choice) return lines;

  const delta = choice.delta || {};
  const finishReason = choice.finish_reason;

  // Ragionamento: i modelli "reasoning" (es. nemotron-*-reasoning) mettono il pensiero
  // in `reasoning_content`/`reasoning`, non in `content`. Se lo ignoriamo la risposta
  // arriva vuota (o ridotta a un frammento come "Ricorda"). Lo traduciamo nei blocchi
  // "thinking" che lo Studio sa già mostrare a tendina.
  const reasoning = delta.reasoning_content || delta.reasoning || '';
  if (reasoning) {
    if (!state.thinkingStarted) {
      state.thinkingIndex = state.blockIndex++;
      state.thinkingStarted = true;
      lines.push({ type: 'content_block_start', index: state.thinkingIndex, content_block: { type: 'thinking', thinking: '' } });
    }
    lines.push({ type: 'content_block_delta', index: state.thinkingIndex, delta: { type: 'thinking_delta', thinking: reasoning } });
  }

  if (delta.content) {
    if (!state.textStarted) {
      state.textIndex = state.blockIndex++;
      state.textStarted = true;
      lines.push({ type: 'content_block_start', index: state.textIndex, content_block: { type: 'text', text: '' } });
    }
    lines.push({ type: 'content_block_delta', index: state.textIndex, delta: { type: 'text_delta', text: delta.content } });
  }

  if (delta.tool_calls && delta.tool_calls.length) {
    state.sawToolCalls = true;
    for (const tc of delta.tool_calls) {
      const idx = tc.index ?? 0;
      if (!state.toolBlocks[idx]) {
        state.toolBlocks[idx] = { id: tc.id, name: tc.function?.name, args: '', blockIdx: state.blockIndex++ };
        lines.push({ type: 'content_block_start', index: state.toolBlocks[idx].blockIdx, content_block: { type: 'tool_use', id: tc.id, name: tc.function?.name, input: {} } });
      }
      if (tc.function?.arguments) {
        state.toolBlocks[idx].args += tc.function.arguments;
        lines.push({ type: 'content_block_delta', index: state.toolBlocks[idx].blockIdx, delta: { type: 'input_json_delta', partial_json: tc.function.arguments } });
      }
    }
  }

  if (finishReason) {
    if (state.thinkingStarted) {
      lines.push({ type: 'content_block_stop', index: state.thinkingIndex });
      state.thinkingStarted = false;
    }
    if (state.textStarted) {
      lines.push({ type: 'content_block_stop', index: state.textIndex });
      state.textStarted = false;
    }
    for (let i = 0; i < state.toolBlocks.length; i++) {
      const tb = state.toolBlocks[i];
      if (tb) {
        if (tb.args) {
          try { tb.input = JSON.parse(tb.args); } catch (e) {}
        }
        lines.push({ type: 'content_block_stop', index: tb.blockIdx });
      }
    }
    state.toolBlocks = [];
    const stopReason = finishReason === 'length' ? 'max_tokens' :
      (finishReason === 'tool_calls' || state.sawToolCalls ? 'tool_use' : 'end_turn');
    lines.push({ type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null } });
    lines.push({ type: 'message_stop' });
    state.finished = true;
  }

  return lines;
}

function createAnthropicProxyHandler(options, fallbackApiKeyFn, hooks) {
  // `options` può essere un oggetto statico oppure una funzione che restituisce la
  // configurazione VIVA (provider, model, baseUrl, apiKeys) a ogni richiesta. Il proxy
  // DEVE leggere la config a runtime: modello e provider cambiano dalla UI senza riavviare
  // il server, e catturarli una volta sola (o, peggio, passare qui una funzione scambiata
  // per l'oggetto config) faceva fallire ogni provider con "fetch failed".
  const getConfig = (typeof options === 'function') ? options : (() => options || {});
  const callbacks = hooks || {};

  return async function(req, res) {
    try {
      const cfg = getConfig() || {};
      const authHeader = req.headers.authorization || '';
      const incomingKey = authHeader.replace(/^Bearer\s+/i, '');

      const anthropicBody = req.body || {};

      // Modello: quello scelto dall'utente (config.model) è autorevole. Con un provider
      // esterno Claude Code non riceve --model e manda il proprio default (es.
      // "claude-opus-5"): senza questo override il provider riceverebbe un modello che
      // non possiede (ed è esattamente l'errore "Invalid model" visto nei log).
      const model = String(cfg.model || anthropicBody.model || '').trim();

      // Provider: parte da quello configurato; un prefisso esplicito nel modello può
      // sovrascriverlo solo se punta a un provider OpenAI-compatible noto.
      const configuredProvider = (cfg.provider || 'custom').toLowerCase();
      const deduced = deduceProvider(model, configuredProvider, {});
      const provider = PROVIDER_ENDPOINTS[deduced] ? deduced : configuredProvider;

      // Chiave API: prima quella inviata da Claude Code, poi quella registrata per il provider.
      let apiKey = incomingKey;
      if (!apiKey && typeof fallbackApiKeyFn === 'function') {
        apiKey = String(fallbackApiKeyFn(provider) || '').trim();
      }
      if (!apiKey && cfg.apiKeys && cfg.apiKeys[provider]) {
        apiKey = cfg.apiKeys[provider];
      }

      let targetUrl = resolveTargetUrl(provider, {
        baseUrl: cfg.baseUrl,
        customBaseUrl: cfg.customBaseUrl
      });

      const isStream = anthropicBody.stream === true;

      const messaggiConVisione = await analizzaImmaginiMessaggi(anthropicBody.messages || [], {
        config: cfg,
        getApiKey: fallbackApiKeyFn,
        chatApiKey: apiKey,
        chatProvider: provider,
        getProviderOptions: callbacks.getProviderOptions,
        onVisionStart: callbacks.onVisionStart,
        analizzaImmagini: callbacks.analizzaImmagini
      });
      const openaiMessages = convertAnthropicToOpenAIMessages(
        messaggiConVisione,
        anthropicBody.system || []
      );

      let openaiModel = model.replace(/^(openrouter:|nvidia:|groq:|cerebras:|gemini:|deepseek:|mistral:|openai:|ashna:|custom:)/, '');
      // Il suffisso ":free" è la convenzione di OpenRouter per i modelli gratuiti. NVIDIA NIM
      // e gli altri provider OpenAI-compatible non lo riconoscono (404 "Function not found").
      // Lo togliamo per tutti tranne OpenRouter/Custom, che invece lo usano davvero.
      if (provider !== 'openrouter' && provider !== 'custom') {
        openaiModel = openaiModel.replace(/:free$/, '');
      }

      const openaiBody = {
        model: openaiModel,
        messages: openaiMessages,
        max_tokens: anthropicBody.max_tokens || 4096,
        temperature: anthropicBody.temperature ?? 0.7,
        top_p: anthropicBody.top_p ?? 1,
        stream: isStream
      };

      applyProviderCompatibilityOptions(openaiBody, provider, anthropicBody);

      if (anthropicBody.tools && anthropicBody.tools.length) {
        openaiBody.tools = anthropicBody.tools.map(t => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.input_schema
          }
        }));
        openaiBody.tool_choice = anthropicBody.tool_choice || 'auto';
      }

      const headers = {
        'Content-Type': 'application/json'
      };

      if (provider === 'gemini') {
        const url = new URL(targetUrl);
        url.searchParams.set('key', apiKey);
        targetUrl = url.toString();
      } else if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const upstreamRes = await fetch(targetUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(openaiBody),
        signal: AbortSignal.timeout(900000)
      });

      if (!upstreamRes.ok) {
        const errText = await upstreamRes.text();
        console.error('[AnthropicProxy] Upstream error (' + provider + ', ' + openaiModel + '):', upstreamRes.status, errText);
        // Formato errore in stile Anthropic: così Claude Code mostra il messaggio reale
        // (provider e modello tentato) invece di un errore generico sul proprio default.
        return res.status(upstreamRes.status).json({
          type: 'error',
          error: {
            type: 'api_error',
            message: 'Errore dal provider ' + provider + ' per il modello "' + openaiModel + '": ' + errText
          }
        });
      }

      if (isStream) {
        if (typeof res.writeHead === 'function') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          });
        } else {
          res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
        }

        const state = { blockIndex: 0, thinkingStarted: false, textStarted: false, toolBlocks: [] };
        const reader = upstreamRes.body.getReader();
        const decoder = new TextDecoder();

        res.write('event: message_start\n');
        res.write('data: ' + JSON.stringify({
          type: 'message_start',
          message: { id: 'msg_' + Date.now(), type: 'message', role: 'assistant', model: model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } }
        }) + '\n\n');

        let buffer = '';
        function emitLine(line) {
          if (!line.startsWith('data:')) return;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') return;
          let chunk;
          try { chunk = JSON.parse(data); } catch (e) { return; }
          for (const evt of convertOpenAIToAnthropicStream(chunk, state)) {
            res.write('event: ' + evt.type + '\n');
            res.write('data: ' + JSON.stringify(evt) + '\n\n');
          }
        }
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) emitLine(line);
          }
          buffer += decoder.decode();
          if (buffer.trim()) emitLine(buffer);
        } finally {
            reader.releaseLock();
          }

        // Un solo finale. Un secondo end_turn cancellava il precedente tool_use:
        // Claude Code vedeva gli strumenti ma non eseguiva la chiamata del modello.
        if (!state.finished) {
          const finale = convertOpenAIToAnthropicStream({ choices: [{ delta: {}, finish_reason: state.sawToolCalls ? 'tool_calls' : 'stop' }] }, state);
          for (const evt of finale) {
            res.write('event: ' + evt.type + '\n');
            res.write('data: ' + JSON.stringify(evt) + '\n\n');
          }
        }
        res.end();
      } else {
        const upstreamData = await upstreamRes.json();
        const choice = upstreamData.choices?.[0];
        const message = choice?.message || {};

        const content = [];
        if (message.content) content.push({ type: 'text', text: message.content });
        if (message.tool_calls) {
          for (const tc of message.tool_calls) {
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.function.name,
              input: JSON.parse(tc.function.arguments || '{}')
            });
          }
        }

        const stopReason = choice?.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn';

        res.json({
          id: 'msg_' + Date.now(),
          type: 'message',
          role: 'assistant',
          model: model,
          content: content,
          stop_reason: stopReason,
          stop_sequence: null,
          usage: upstreamData.usage || { input_tokens: 0, output_tokens: 0 }
        });
      }
    } catch (err) {
      console.error('[AnthropicProxy] Error:', err.message);
      if (!res.headersSent && typeof res.status === 'function') {
        res.status(500).json({ error: 'Errore proxy: ' + err.message });
      } else if (typeof res.write === 'function') {
        res.write('event: error\n');
        res.write('data: ' + JSON.stringify({ error: 'Errore proxy: ' + err.message }) + '\n\n');
        res.end();
      }
    }
  };
}

exports.resolveTargetUrl = resolveTargetUrl;
exports.deduceProvider = deduceProvider;
exports.convertAnthropicToOpenAIMessages = convertAnthropicToOpenAIMessages;
exports.analizzaImmaginiMessaggi = analizzaImmaginiMessaggi;
exports.convertOpenAIToAnthropicStream = convertOpenAIToAnthropicStream;
exports.createAnthropicProxyHandler = createAnthropicProxyHandler;
exports.applyProviderCompatibilityOptions = applyProviderCompatibilityOptions;
exports.PROVIDER_ENDPOINTS = PROVIDER_ENDPOINTS;
