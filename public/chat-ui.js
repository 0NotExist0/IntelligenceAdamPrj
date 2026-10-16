// NotExist Intelligience Studio - Vista Chat
// Rende gli eventi stream-json del server come una conversazione vera:
// messaggi, ragionamento collassabile, chiamate a strumenti con input e risultato.

const ChatUI = (() => {
  let elScroll = null;
  let elMessages = null;
  let elEmpty = null;
  let elActivity = null;
  let elActivityText = null;
  let elActivityTimer = null;
  let elActivityStream = null;
  let activityStartTime = 0;
  let activityTimerInterval = null;
  let turnTokens = 0;             // token generati da Adam nel turno in corso (evento 'progresso')
  let estimatedDeltaChars = 0;    // caratteri parziali per stima live dei token emessi
  let elInput = null;
  let elSend = null;
  let elStop = null;
  let elModelPill = null;
  let elModelSelect = null;
  let elCoderSelect = null;
  let elVisionSelect = null;
  let elFilterInput = null;
  let elBtnRefreshModels = null;
  let elModelPickerRoot = null;
  let elModelPickerPanel = null;
  let elModelPickerTitle = null;
  let elModelPickerEyebrow = null;
  let elModelPickerClose = null;
  let elProviderDock = null;
  let elProviderSummary = null;
  let elModelPickerList = null;
  let elModelPickerFeedback = null;
  let elDirectorTrigger = null;
  let elCoderTrigger = null;
  let elDirectorModelLabel = null;
  let elDirectorProviderLabel = null;
  let elCoderModelLabel = null;
  let elCoderProviderLabel = null;
  let elProviderPill = null;
  let elEffortPill = null;
  let elEffortSelect = null;
  let elPermissionSelect = null;

  let elPromptActionsBar = null;  // Barra dei prossimi passi ottimizzati (sopra il composer)
  let elPromptActionsList = null; // Contenitore dei pulsanti con prompt ottimizzati
  let btnClosePromptActions = null;// Pulsante per nascondere la barra
  let ultimeAzioni = [];          // Cache delle azioni ricevute dal server

  let sendFn = null;              // iniettata da app.js: invia sul websocket
  let choiceFn = null;            // risposta a un chiarimento bloccante
  let opts_onFilesChanged = null; // richiamata quando Adam crea o modifica un file
  let opts_onFileLive = null;     // il file che Adam sta scrivendo, pezzo per pezzo
  let opts_onFileSalvato = null;  // lo stesso file quando e' finito su disco
  let opts_onMemoryUpdated = null;// richiamata quando la memoria neurale viene aggiornata o cresce
  let busy = false;
  let modelProviderGroups = [];
  let activeModelRole = 'director';
  let activeProviderGroup = '';
  let modelPickerOpen = false;
  let modelSelections = {
    director: { model: '', transport: '', group: '' },
    coder: { model: '', transport: '', group: '' }
  };
  let allegati = [];              // immagini pronte da inviare con il prossimo messaggio
  let allegatiInPreparazione = 0; // riserva gli slot mentre FileReader/canvas stanno lavorando
  let avvisoAllegatiAttivo = '';
  let timerAvvisoAllegati = null;
  const messageNodes = new Map(); // messageId -> elemento DOM

  // ---------------------------------------------------------------- utils

  function escapeHtml(str) {
    return String(str === null || str === undefined ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Markdown minimo: blocchi di codice, codice inline, grassetto.
  // Volutamente conservativo: l'input viene sempre prima passato da escapeHtml.
  function renderMarkdown(text) {
    const escaped = escapeHtml(text);
    const parts = escaped.split(/```/);
    let out = '';
    parts.forEach((part, i) => {
      if (i % 2 === 1) {
        const newline = part.indexOf('\n');
        const body = newline === -1 ? part : part.slice(newline + 1);
        out += '<pre>' + body.replace(/\n+$/, '') + '</pre>';
      } else {
        out += part
          .replace(/`([^`\n]+)`/g, '<code class="inline">$1</code>')
          .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
      }
    });
    return out;
  }

  function isNearBottom() {
    if (!elScroll) return true;
    return elScroll.scrollHeight - elScroll.scrollTop - elScroll.clientHeight < 140;
  }

  function scrollToBottom(force) {
    if (!elScroll) return;
    if (force || isNearBottom()) {
      requestAnimationFrame(() => { elScroll.scrollTop = elScroll.scrollHeight; });
    }
  }

  function toolSummary(name, input) {
    if (!input || typeof input !== 'object') return '';
    const preferred = ['file_path', 'path', 'command', 'pattern', 'query', 'url', 'prompt', 'description'];
    for (const key of preferred) {
      if (input[key]) return String(input[key]).split('\n')[0].slice(0, 120);
    }
    const first = Object.keys(input)[0];
    if (!first) return '';
    return (first + ': ' + String(input[first])).split('\n')[0].slice(0, 120);
  }

  function formatDuration(ms) {
    if (!ms && ms !== 0) return null;
    if (ms < 1000) return ms + ' ms';
    return (ms / 1000).toFixed(1) + ' s';
  }

  // ------------------------------------------------------------- rendering

  function blockElement(block) {
    if (block.kind === 'vision') {
      const wrap = document.createElement('div');
      wrap.className = 'block-vision';
      wrap.dataset.kind = 'vision';
      wrap.innerHTML =
        '<div class="vision-head"><span class="vision-label">Analisi Vision</span>' +
        '<span class="vision-model"></span><span class="vision-status"></span></div>' +
        '<div class="vision-text"></div>';
      wrap.querySelector('.vision-model').textContent = block.model || '';
      wrap.querySelector('.vision-status').textContent = block.status || '';
      const target = wrap.querySelector('.vision-text');
      target.dataset.raw = block.text || '';
      target.innerHTML = renderMarkdown(block.text || '');
      return wrap;
    }

    if (block.kind === 'thinking') {
      const wrap = document.createElement('div');
      wrap.className = 'block-thinking';
      wrap.dataset.kind = 'thinking';
      wrap.innerHTML =
        '<button class="thinking-toggle" type="button">' +
        '<svg class="caret" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="9 18 15 12 9 6"></polyline></svg>' +
        '<span>Ragionamento</span></button>' +
        '<div class="thinking-text"></div>';
      wrap.querySelector('.thinking-toggle').addEventListener('click', () => wrap.classList.toggle('open'));
      wrap.querySelector('.thinking-text').textContent = block.text || '';
      return wrap;
    }

    if (block.kind === 'tool') {
      const wrap = document.createElement('div');
      wrap.className = 'block-tool';
      wrap.dataset.kind = 'tool';
      wrap.innerHTML =
        '<div class="tool-head">' +
        '<span class="tool-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg></span>' +
        '<span class="tool-name"></span>' +
        '<span class="tool-summary"></span>' +
        '<span class="tool-status"></span>' +
        '</div>' +
        '<div class="tool-body">' +
        '<div class="tool-section"><div class="tool-section-label">Input</div><pre class="tool-input"></pre></div>' +
        '<div class="tool-section tool-result-section" hidden><div class="tool-section-label">Risultato</div><pre class="tool-result"></pre></div>' +
        '</div>';
      wrap.querySelector('.tool-head').addEventListener('click', () => wrap.classList.toggle('open'));
      updateToolBlock(wrap, block);
      return wrap;
    }

    const wrap = document.createElement('div');
    wrap.className = 'block-text';
    wrap.dataset.kind = 'text';
    wrap.dataset.raw = block.text || '';
    wrap.innerHTML = renderMarkdown(block.text || '');
    return wrap;
  }

  function updateToolBlock(el, block) {
    el.querySelector('.tool-name').textContent = block.name || 'Strumento';
    el.querySelector('.tool-summary').textContent = toolSummary(block.name, block.input);

    // Quando Adam apre da solo una schermata con Read, la si vede: prima nella chat non
    // c'era traccia del fatto che stesse guardando un'immagine.
    const percorso = String((block.input && block.input.file_path) || '');
    const schermata = block.name === 'Read' && percorso.match(/studio-screenshot[\\/]([^\\/]+\.(?:png|jpe?g|webp|gif))$/i);
    if (schermata && !el.querySelector('.tool-anteprima')) {
      const anteprima = document.createElement('div');
      anteprima.className = 'tool-anteprima';
      anteprima.innerHTML = '<span>Adam guarda la schermata</span>';
      anteprima.appendChild(miniatura('/api/screenshot/' + encodeURIComponent(schermata[1]), 'Schermata aperta da Adam'));
      el.querySelector('.tool-head').insertAdjacentElement('afterend', anteprima);
    }

    let inputText;
    try {
      inputText = JSON.stringify(block.input || {}, null, 2);
    } catch (e) {
      inputText = String(block.input);
    }
    el.querySelector('.tool-input').textContent = inputText;

    const status = el.querySelector('.tool-status');
    const section = el.querySelector('.tool-result-section');

    if (block.result === undefined) {
      el.classList.add('is-pending');
      el.classList.remove('is-error');
      status.className = 'tool-status pending';
      status.textContent = 'in corso';
      section.hidden = true;

      // Aggiorna l'indicatore di attività per mostrare lo strumento in corso
      if (busy) {
        // summ era usato senza essere mai dichiarato: "summ is not defined" a ogni strumento in corso.
        const summ = toolSummary(block.name, block.input);
        const toolLabel = 'Uso strumento: ' + (block.name || 'Strumento') + (summ ? ' (' + summ + ')' : '');
        if (elActivityText) elActivityText.textContent = toolLabel;
        if (elActivityStream) {
          elActivityStream.hidden = false;
          elActivityStream.textContent = '⚙️ ' + (summ || (block.name + ' in esecuzione...'));
        }
      }
      return;
    }

    el.classList.remove('is-pending');
    el.classList.toggle('is-error', !!block.isError);
    status.className = 'tool-status ' + (block.isError ? 'err' : 'ok');
    status.textContent = block.isError ? 'errore' : 'ok';
    section.hidden = false;
    el.querySelector('.tool-result').textContent = String(block.result).slice(0, 20000);
  }

  function messageElement(message) {
    if (message.role === 'progress') return progressElement(message);
    if (message.hidden) {
      const hidden = document.createElement('div');
      hidden.hidden = true;
      hidden.dataset.messageId = message.id;
      return hidden;
    }
    // Una ripresa automatica non l'ha scritta l'utente: mostrarla come bolla utente
    // farebbe credere di aver mandato un messaggio che non ha mandato.
    if (message.auto) {
      const note = document.createElement('div');
      note.className = 'msg-auto';
      note.dataset.messageId = message.id;
      note.innerHTML =
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<polyline points="23 4 23 10 17 10"></polyline>' +
        '<path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>' +
        '<span>Ripresa automatica ' + (message.attempt || '?') + '/' + (message.max || '?') +
        (message.reason ? ' — ' + escapeHtml(message.reason) : '') + '</span>';
      renderImmagini(note, message);
      return note;
    }

    const el = document.createElement('div');
    el.className = 'msg msg-' + message.role;
    if (message.level) el.classList.add('level-' + message.level);
    el.dataset.messageId = message.id;

    const label = message.phase === 'vision' ? 'Vision'
      : message.role === 'user' ? 'Tu'
      : message.role === 'assistant' ? 'Adam'
      : 'Sistema';
    const initial = message.phase === 'vision' ? 'V'
      : message.role === 'user' ? 'T' : message.role === 'assistant' ? 'A' : '!';

    const role = document.createElement('div');
    role.className = 'msg-role';
    role.innerHTML = '<span class="msg-avatar">' + initial + '</span><span>' + escapeHtml(label) + '</span>';
    el._message = message;
    if (message.role === 'assistant' && message.phase !== 'vision') {
      // "Ricorda": salva il messaggio nella memoria del progetto. Crea sempre una voce nuova,
      // non sovrascrive niente; Adam la ritrova nelle conversazioni successive.
      const ricorda = document.createElement('button');
      ricorda.type = 'button';
      ricorda.className = 'msg-remember';
      ricorda.textContent = 'Ricorda';
      ricorda.title = 'Salva questo messaggio nella memoria del progetto: Adam lo ritroverà nelle prossime conversazioni';
      ricorda.addEventListener('click', function () { ricordaMessaggio(el, ricorda); });
      role.appendChild(ricorda);
    }

    const body = document.createElement('div');
    body.className = 'msg-body';

    el.appendChild(role);
    el.appendChild(body);
    renderBlocks(el, message);
    renderImmagini(el, message);
    return el;
  }

  function renderBlocks(el, message) {
    const body = el.querySelector('.msg-body');
    body.innerHTML = '';
    (message.blocks || []).forEach(block => body.appendChild(blockElement(block)));
    if (message.actions && Array.isArray(message.actions) && message.actions.length > 0) {
      body.appendChild(creaElementoAzioniInline(message.actions));
    }
    if (message.interaction) body.appendChild(creaElementoInterazione(message.interaction));
  }

  function creaElementoInterazione(interaction) {
    const wrap = document.createElement('section');
    wrap.className = 'guided-choice' + (interaction.status === 'resolved' ? ' is-resolved' : '');
    wrap.dataset.interactionId = interaction.id || '';
    wrap.setAttribute('aria-labelledby', 'choice-question-' + interaction.id);

    const head = document.createElement('div');
    head.className = 'guided-choice-head';
    const eyebrow = document.createElement('span');
    eyebrow.className = 'guided-choice-eyebrow';
    eyebrow.textContent = interaction.status === 'resolved' ? '✓ Scelta confermata' : 'Adam ha bisogno di una scelta';
    const step = document.createElement('span');
    step.className = 'guided-choice-step';
    step.textContent = 'Passo ' + interaction.step.current + ' di ' + interaction.step.total;
    head.append(eyebrow, step);

    const question = document.createElement('h3');
    question.id = 'choice-question-' + interaction.id;
    question.textContent = interaction.question || '';
    const options = document.createElement('div');
    options.className = 'guided-choice-options';
    const resolved = interaction.status === 'resolved';

    function submitChoice(answer, selectedButton, answerLabel) {
      if (interaction.status !== 'pending' || !choiceFn) return;
      wrap.classList.remove('has-validation-error', 'has-error');
      wrap.querySelectorAll('[aria-invalid="true"]').forEach(function (node) {
        node.removeAttribute('aria-invalid');
      });
      interaction.status = 'resolved';
      interaction.answer = answer.optionId
        ? { optionId: answer.optionId, label: answerLabel }
        : { custom: answer.custom };
      wrap.classList.add('is-resolved');
      wrap.querySelectorAll('button, input').forEach(function (node) { node.disabled = true; });
      selectedButton.classList.add('is-selected');
      eyebrow.textContent = '✓ Scelta inviata';
      status.textContent = 'Scelta inviata: ' + (answer.custom || answerLabel);
      choiceFn(interaction.id, answer);
    }

    (interaction.options || []).forEach(function (option) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'guided-choice-option';
      button.disabled = resolved;
      const label = document.createElement('span');
      label.className = 'guided-choice-label';
      label.textContent = option.label;
      button.appendChild(label);
      if (option.description) {
        const description = document.createElement('span');
        description.className = 'guided-choice-description';
        description.textContent = option.description;
        button.appendChild(description);
      }
      if (interaction.answer && interaction.answer.optionId === option.id) button.classList.add('is-selected');
      button.addEventListener('click', function () { submitChoice({ optionId: option.id }, button, option.label); });
      options.appendChild(button);
    });

    if (interaction.allowCustom) {
      const custom = document.createElement('div');
      custom.className = 'guided-choice-custom';
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 1000;
      input.disabled = resolved;
      input.placeholder = 'Oppure scrivi una risposta…';
      input.setAttribute('aria-label', 'Risposta personalizzata');
      input.setAttribute('aria-describedby', 'choice-status-' + interaction.id);
      const send = document.createElement('button');
      send.type = 'button';
      send.textContent = 'Invia';
      send.disabled = resolved;
      send.addEventListener('click', function () {
        const value = input.value.trim();
        if (!value) {
          input.setAttribute('aria-invalid', 'true');
          wrap.classList.add('has-validation-error');
          status.textContent = 'Scrivi una risposta oppure scegli una delle opzioni.';
          input.focus();
          return;
        }
        submitChoice({ custom: value }, send, value);
      });
      input.addEventListener('input', function () {
        if (!input.value.trim()) return;
        input.removeAttribute('aria-invalid');
        wrap.classList.remove('has-validation-error');
        status.textContent = 'Scegli una risposta per continuare.';
      });
      input.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') { event.preventDefault(); send.click(); }
      });
      custom.append(input, send);
      options.appendChild(custom);
    }

    const status = document.createElement('p');
    status.className = 'guided-choice-status';
    status.id = 'choice-status-' + interaction.id;
    status.setAttribute('aria-live', 'polite');
    status.textContent = resolved ? 'Scelta inviata: ' + ((interaction.answer && (interaction.answer.label || interaction.answer.custom)) || '') : 'Scegli una risposta per continuare.';
    wrap.append(head, question, options, status);
    return wrap;
  }

  function creaElementoAzioniInline(actions) {
    const wrap = document.createElement('div');
    wrap.className = 'msg-actions-inline';

    actions.forEach(action => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'inline-action-chip tipo-' + (action.tipo || 'secondary');
      chip.title = action.prompt ? ('Invia subito ad Adam:\n' + action.prompt) : '';

      let icon = '▶';
      if (action.tipo === 'accent') icon = '⚡';
      else if (action.tipo === 'danger') icon = '🔧';
      else if (action.tipo === 'success') icon = '✔';
      else if (action.icona === 'book-open') icon = '📚';
      else if (action.icona === 'check-square') icon = '🔍';

      chip.innerHTML = '<span class="chip-icon">' + icon + '</span><span class="chip-text">' + escapeHtml(action.titolo || '') + '</span>';
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        sendPromptDirectly(action.prompt);
      });
      wrap.appendChild(chip);
    });

    return wrap;
  }

  function upsertMessage(message) {
    hideEmpty();
    let el = messageNodes.get(message.id);
    if (!el) {
      el = messageElement(message);
      messageNodes.set(message.id, el);
      elMessages.appendChild(el);
      scrollToBottom(message.role === 'user');
      return el;
    }
    if (message.role === 'progress') {
      updateProgress(el, message);
      return el;
    }
    if (message.auto) {
      renderImmagini(el, message);
      return el;
    }
    el._message = message;
    renderBlocks(el, message);
    renderImmagini(el, message);
    if (message.meta) {
      appendResult({ messageId: message.id, meta: message.meta });
    }
    scrollToBottom();
    return el;
  }

  // Applica un delta di streaming senza ricostruire il messaggio: molto piu' fluido.
  function applyDelta(payload) {
    let el = messageNodes.get(payload.messageId);
    if (!el) {
      // Il delta e' arrivato prima del messaggio completo: creiamo un contenitore al volo
      // cosi' il testo non viene perso silenziosamente.
      const stub = { id: payload.messageId, role: 'assistant', blocks: [] };
      el = messageElement(stub);
      messageNodes.set(payload.messageId, el);
      elMessages.appendChild(el);
      hideEmpty();
    }
    const body = el.querySelector('.msg-body');

    while (body.children.length <= payload.index) {
      body.appendChild(blockElement({ kind: payload.kind, text: '' }));
    }

    let block = body.children[payload.index];
    if (block.dataset.kind !== payload.kind) {
      const replacement = blockElement({ kind: payload.kind, text: '' });
      body.replaceChild(replacement, block);
      block = replacement;
    }

    // Incremento token dal vivo su ogni frammento di testo/pensiero che arriva
    if (payload.text) {
      estimatedDeltaChars += payload.text.length;
      if (estimatedDeltaChars >= 3.2) {
        const toAdd = Math.floor(estimatedDeltaChars / 3.2);
        estimatedDeltaChars %= 3.2;
        turnTokens += toAdd;
        updateActivityTimer();
      }
    }

    if (payload.kind === 'thinking') {
      const target = block.querySelector('.thinking-text');
      target.textContent += payload.text;

      // Aggiorna l'indicatore di attività con il pensiero in streaming dal vivo
      if (elActivityText) {
        elActivityText.textContent = 'Adam sta pensando...';
      }
      if (elActivityStream) {
        elActivityStream.hidden = false;
        const raw = (target.textContent || '').replace(/\s+/g, ' ').trim();
        const snippet = raw.length > 150 ? '...' + raw.slice(-150) : raw;
        elActivityStream.textContent = '💭 Pensiero: ' + (snippet || 'elaborazione del ragionamento in corso...');
      }
    } else if (payload.kind === 'vision') {
      const target = block.querySelector('.vision-text');
      target.dataset.raw = (target.dataset.raw || '') + payload.text;
      target.innerHTML = renderMarkdown(target.dataset.raw);
      const status = block.querySelector('.vision-status');
      if (status && !status.textContent) status.textContent = 'Analisi in diretta';
      if (elActivityText) elActivityText.textContent = 'Vision sta analizzando le immagini...';
      if (elActivityStream) {
        elActivityStream.hidden = false;
        const raw = (target.textContent || '').replace(/\s+/g, ' ').trim();
        const snippet = raw.length > 150 ? '...' + raw.slice(-150) : raw;
        elActivityStream.textContent = '👁️ Vision: ' + (snippet || 'analisi in corso...');
      }
    } else {
      block.dataset.raw = (block.dataset.raw || '') + payload.text;
      block.innerHTML = renderMarkdown(block.dataset.raw);

      // Aggiorna l'indicatore di attività quando Adam genera testo/codice
      if (elActivityText && (!elActivityText.textContent.includes('Uso strumento'))) {
        elActivityText.textContent = 'Adam sta elaborando la risposta...';
      }
      if (elActivityStream) {
        elActivityStream.hidden = false;
        const lines = (block.dataset.raw || '').trim().split('\n');
        const lastLine = (lines[lines.length - 1] || '').trim();
        const snippet = lastLine.length > 130 ? '...' + lastLine.slice(-130) : (lastLine || 'scrittura...');
        elActivityStream.textContent = '✍️ ' + snippet;
      }
    }
    scrollToBottom();
  }

  function appendResult(payload) {
    const el = payload.messageId ? messageNodes.get(payload.messageId) : null;
    if (!el || !payload.meta) return;
    const existing = el.querySelector('.msg-result');
    if (existing) existing.remove();

    const meta = payload.meta;
    const bits = [];
    const duration = formatDuration(meta.durationMs);
    if (duration) bits.push('⏱ ' + duration);

    // Token generati: dal campo usage, oppure stimati dal testo se il modello non li riporta.
    const usage = meta.usage || {};
    let outTok = usage.output_tokens || 0;
    const inTok = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) +
      (usage.cache_creation_input_tokens || 0);

    if (inTok) bits.push('📥 ' + inTok.toLocaleString() + ' in');

    if (outTok) {
      bits.push('📤 ' + outTok.toLocaleString() + ' out');
    } else {
      // Stima per i modelli locali che non riportano i token: ~3.2 char/token.
      const msg = el._message;
      if (msg && msg.blocks) {
        var chars = 0;
        msg.blocks.forEach(function (b) { if (b.text) chars += b.text.length; });
        if (chars > 20) {
          outTok = Math.round(chars / 3.2);
          bits.push('📤 ~' + outTok + ' out');
        }
      }
    }

    // Velocità di generazione (tokens al secondo)
    if (outTok && meta.durationMs && meta.durationMs >= 250) {
      const speed = Math.round(outTok / (meta.durationMs / 1000));
      if (speed > 0) bits.push('⚡ ' + speed + ' tok/s');
    }

    // Totale token del turno
    const totalTurn = (inTok || 0) + (outTok || 0);
    if (totalTurn > 0) {
      bits.push('Σ ' + totalTurn.toLocaleString() + ' token');
    }

    // Con un modello locale il costo riportato e' una stima teorica: non mostrarlo.
    if (meta.provider !== 'ollama' && meta.costUsd) bits.push('$ ' + Number(meta.costUsd).toFixed(4));
    if (!bits.length) return;

    const box = document.createElement('div');
    box.className = 'msg-result';
    box.innerHTML = bits.map(b => '<span>' + escapeHtml(b) + '</span>').join('');
    el.appendChild(box);
  }

  function hideEmpty() {
    if (elEmpty) elEmpty.classList.add('hidden');
  }

  function showEmptyIfNeeded() {
    if (elEmpty && elMessages && elMessages.children.length === 0) {
      elEmpty.classList.remove('hidden');
    }
  }

  // --------------------------------------------------------------- stato

  function mostraAvvisoRete(msg) {
    const banner = document.getElementById('chat-network-alert');
    const testo = (msg && msg.messaggio) || (msg && msg.stato === 'offline' ? 'Connessione Internet assente: il modello fa fatica a ricevere o inviare i dati.' : 'Connessione Internet debole o instabile: il modello sta faticando a comunicare.');
    if (banner) {
      banner.textContent = '⚠️ ' + testo;
      banner.style.display = 'flex';
      if (msg && msg.stato === 'offline') {
        banner.style.background = 'rgba(248, 81, 73, 0.18)';
        banner.style.borderColor = 'rgba(248, 81, 73, 0.5)';
      } else {
        banner.style.background = 'rgba(210, 153, 34, 0.15)';
        banner.style.borderColor = 'rgba(210, 153, 34, 0.4)';
      }
      setTimeout(() => {
        if (banner && navigator.onLine && (!msg || msg.stato !== 'offline')) {
          banner.style.display = 'none';
        }
      }, 9000);
    }
  }

  function updateActivityTimer() {
    if (!elActivityTimer) return;
    if (!busy || !activityStartTime) {
      elActivityTimer.hidden = true;
      elActivityTimer.textContent = '';
      return;
    }
    const elapsedSec = Math.floor((Date.now() - activityStartTime) / 1000);
    const tempo = elapsedSec >= 60 ? Math.floor(elapsedSec / 60) + 'm ' + (elapsedSec % 60) + 's' : elapsedSec + 's';
    elActivityTimer.hidden = false;

    let extraRete = '';
    if (!navigator.onLine) {
      extraRete = ' · ⚠️ Disconnesso (Offline)';
    } else if (elapsedSec > 8 && turnTokens === 0) {
      extraRete = ' · ⚠️ Connessione lenta o attesa modello...';
    }

    // Token emessi e velocità di generazione
    let tokenStr = '';
    if (turnTokens > 0) {
      tokenStr = ' · ↓ ' + formatTokens(turnTokens) + ' token';
      if (elapsedSec >= 1) {
        const speed = Math.round(turnTokens / elapsedSec);
        if (speed > 0) tokenStr += ' · ⚡ ' + speed + ' tok/s';
      }
    } else {
      tokenStr = ' · 0 token';
    }

    elActivityTimer.textContent = tempo + tokenStr + extraRete;
  }

  function setBusy(value, activity) {
    busy = !!value;
    if (busy) {
      if (!activityStartTime) {
        activityStartTime = Date.now();
      }
      if (!activityTimerInterval) {
        activityTimerInterval = setInterval(updateActivityTimer, 1000);
      }
      updateActivityTimer();
      if (elActivityStream && !elActivityStream.textContent) {
        elActivityStream.hidden = false;
        elActivityStream.textContent = '💭 In attesa di avvio elaborazione...';
      }
    } else {
      activityStartTime = 0;
      turnTokens = 0;
      estimatedDeltaChars = 0;
      if (activityTimerInterval) {
        clearInterval(activityTimerInterval);
        activityTimerInterval = null;
      }
      if (elActivityTimer) {
        elActivityTimer.hidden = true;
        elActivityTimer.textContent = '';
      }
      if (elActivityStream) {
        elActivityStream.hidden = true;
        elActivityStream.textContent = '';
      }
    }

    if (elActivity) {
      elActivity.hidden = !busy;
      if (elActivityText) elActivityText.textContent = activity || 'Adam sta pensando...';
    }
    if (elStop) elStop.hidden = !busy;
    if (elSend) elSend.disabled = busy;

    if (busy) {
      if (elPromptActionsBar) elPromptActionsBar.hidden = true;
      scrollToBottom();
    } else {
      if (ultimeAzioni && ultimeAzioni.length > 0) {
        if (elPromptActionsBar) elPromptActionsBar.hidden = false;
      } else {
        aggiornaAzioniDaServer();
      }
    }
  }

  // Token del turno in corso, inviati dal server al massimo ogni 250 ms.
  function setTurnTokens(n) {
    if (!busy) return;
    turnTokens = Math.max(turnTokens, Number(n) || 0);
    updateActivityTimer();
  }

  function scomponiRiferimentoModello(riferimento) {
    const valore = String(riferimento || '').trim();
    const separatoreUi = valore.indexOf('::');
    if (separatoreUi > 0) {
      return { provider: valore.slice(0, separatoreUi).toLowerCase(), model: valore.slice(separatoreUi + 2) };
    }
    const separatore = valore.indexOf(':');
    const prefisso = separatore > 0 ? valore.slice(0, separatore).toLowerCase() : '';
    const providers = ['anthropic', 'ollama', 'custom', 'nvidia', 'ashna', 'openrouter', 'cerebras', 'openai', 'deepseek', 'gemini', 'groq', 'mistral'];
    if (providers.includes(prefisso)) return { provider: prefisso, model: valore.slice(separatore + 1) };
    if (/^(?:meta|nvidia)\//i.test(valore)) return { provider: 'nvidia', model: valore };
    if (valore.includes('/')) return { provider: 'openrouter', model: valore };
    return { provider: '', model: valore };
  }

  function impostaVisioneSelezionata(riferimento, modelloAutomatico) {
    if (!elVisionSelect) return;
    const automatico = elVisionSelect.querySelector('option[value=""]');
    if (automatico) {
      const breve = String(modelloAutomatico || '').replace(/^[a-z]+:/i, '');
      automatico.textContent = 'Vision: Automatico' + (breve ? ' · ' + breve : '');
    }
    const parsed = scomponiRiferimentoModello(riferimento);
    if (!parsed.model) {
      elVisionSelect.value = '';
      elVisionSelect.classList.remove('vision-active');
      return;
    }
    let target = Array.from(elVisionSelect.options).find(function (option) {
      return option.dataset && option.dataset.model === parsed.model &&
        (!parsed.provider || option.dataset.provider === parsed.provider);
    });
    if (!target) {
      target = document.createElement('option');
      target.value = parsed.provider ? (parsed.provider + '::' + parsed.model) : parsed.model;
      target.dataset.model = parsed.model;
      if (parsed.provider) target.dataset.provider = parsed.provider;
      target.textContent = 'Vision: ' + (parsed.provider ? parsed.provider + ': ' : '') + parsed.model;
      elVisionSelect.appendChild(target);
    }
    target.selected = true;
    elVisionSelect.classList.add('vision-active');
  }

  function setSession(info) {
    if (!info) return;
    if (info.model !== undefined) {
      modelSelections.director = {
        model: String(info.model || '').trim(),
        transport: String(info.modelTransport || info.provider || '').toLowerCase(),
        group: String(info.modelGroup || '').toLowerCase()
      };
      syncHiddenModelSelect('director');
    }
    if (info.coderModel !== undefined) {
      modelSelections.coder = {
        model: String(info.coderModel || '').trim(),
        transport: String(info.coderProvider || '').toLowerCase(),
        group: String(info.coderGroup || '').toLowerCase()
      };
      syncHiddenModelSelect('coder');
    }
    updateModelRoleButtons();
    if (info.visionModel !== undefined) {
      impostaVisioneSelezionata(info.visionModel, info.resolvedVisionModel);
    }
    if (elModelPill) elModelPill.textContent = info.model || 'modello sconosciuto';
    if (elProviderPill) {
      const provider = info.provider || 'anthropic';
      const labels = { anthropic: 'Anthropic', ollama: 'Ollama locale', custom: 'Proxy custom' };
      elProviderPill.textContent = labels[provider] || provider;
      elProviderPill.className = 'meta-pill ' + (provider === 'ollama' ? 'local' : 'official');
    }
    if (elEffortPill && info.effort) {
      const labels = { low: 'bassa', medium: 'media', high: 'alta', xhigh: 'molto alta', max: 'massima' };
      elEffortPill.textContent = 'intelligenza: ' + (labels[info.effort] || info.effort);
    }
  }

  function reset() {
    messageNodes.clear();
    if (elMessages) elMessages.innerHTML = '';
    showEmptyIfNeeded();
    ultimeAzioni = [];
    if (elPromptActionsBar) elPromptActionsBar.hidden = true;
    setBusy(false);
  }

  function renderPromptActions(actions) {
    if (!actions || !Array.isArray(actions) || actions.length === 0) {
      if (elPromptActionsBar) elPromptActionsBar.hidden = true;
      ultimeAzioni = [];
      return;
    }
    ultimeAzioni = actions;
    if (!elPromptActionsList || !elPromptActionsBar) return;
    elPromptActionsList.innerHTML = '';

    actions.forEach(action => {
      const card = document.createElement('div');
      card.className = 'action-prompt-card tipo-' + (action.tipo || 'secondary');
      card.title = action.prompt ? ('Prompt da inviare ad Adam:\n' + action.prompt) : '';

      const btnSend = document.createElement('button');
      btnSend.type = 'button';
      btnSend.className = 'btn-action-send';

      let iconSvg = '';
      if (action.tipo === 'primary' || action.icona === 'play') {
        iconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
      } else if (action.tipo === 'accent' || action.icona === 'zap') {
        iconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>';
      } else if (action.tipo === 'danger' || action.icona === 'wrench') {
        iconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>';
      } else if (action.icona === 'book-open') {
        iconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>';
      } else if (action.icona === 'check' || action.icona === 'check-circle' || action.icona === 'check-square') {
        iconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
      } else {
        iconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="13 17 18 12 13 7"></polyline><polyline points="6 17 11 12 6 7"></polyline></svg>';
      }

      const badgeHtml = action.badge ? '<span class="action-prompt-badge">' + escapeHtml(action.badge) + '</span>' : '';
      btnSend.innerHTML = iconSvg + '<span class="action-prompt-text">' + escapeHtml(action.titolo || '') + '</span>' + badgeHtml;
      btnSend.addEventListener('click', (e) => {
        e.preventDefault();
        sendPromptDirectly(action.prompt);
      });

      const btnEdit = document.createElement('button');
      btnEdit.type = 'button';
      btnEdit.className = 'btn-action-edit';
      btnEdit.title = 'Modifica questo prompt nel campo di testo prima di inviarlo';
      btnEdit.setAttribute('aria-label', 'Modifica prompt');
      btnEdit.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
      btnEdit.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        fillComposerWithPrompt(action.prompt);
      });

      card.appendChild(btnSend);
      card.appendChild(btnEdit);
      elPromptActionsList.appendChild(card);
    });

    if (!busy) {
      elPromptActionsBar.hidden = false;
    }
  }

  function sendPromptDirectly(promptText) {
    if (!promptText || busy) return;
    if (elInput) elInput.value = promptText;
    if (elPromptActionsBar) elPromptActionsBar.hidden = true;
    submit();
  }

  function fillComposerWithPrompt(promptText) {
    if (!promptText || !elInput) return;
    elInput.value = promptText;
    autoGrow();
    elInput.focus();
    try {
      elInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) {}
  }

  async function aggiornaAzioniDaServer() {
    try {
      const res = await fetch('/api/suggerimenti-azioni');
      const data = await res.json();
      if (data && data.success && Array.isArray(data.actions) && data.actions.length > 0) {
        renderPromptActions(data.actions);
      }
    } catch (e) {}
  }

  function applySnapshot(snapshot) {
    if (!snapshot) return;
    reset();
    (snapshot.messages || []).forEach(upsertMessage);
    setSession(snapshot.info);
    setBusy(snapshot.busy, snapshot.activity);
    setTurnTokens(snapshot.token);
    setContesto(snapshot.contesto);
    scrollToBottom(true);
  }

  function handleEvent(msg) {
    switch (msg.event) {
      case 'message':
      case 'message-update':
        upsertMessage(msg.message);
        break;
      case 'delta':
        applyDelta(msg);
        break;
      case 'busy':
        setBusy(msg.busy, msg.activity);
        break;
      case 'progresso':
        setTurnTokens(msg.token);
        break;
      case 'session':
        setSession(msg.info);
        break;
      case 'result':
        appendResult(msg);
        setBusy(false);
        break;
      case 'reset':
        reset();
        break;
      case 'contesto':
        setContesto(msg.contesto);
        break;
      case 'verify':
        handleVerifyEvent(msg);
        break;
      case 'files-changed':
        if (opts_onFilesChanged) opts_onFilesChanged(msg.file);
        break;
      // Il file mentre viene scritto, e poi com'e' rimasto su disco: pannello "File dal vivo".
      case 'file-live':
        if (opts_onFileLive) opts_onFileLive(msg);
        break;
      case 'file-salvato':
        if (opts_onFileSalvato) opts_onFileSalvato(msg);
        break;
      case 'memory-updated':
        if (opts_onMemoryUpdated) opts_onMemoryUpdated(msg);
        break;
      case 'auto-continue':
        if (msg.active) {
          setBusy(true, 'Risposta incompleta (' + (msg.reason || '') + '): riprendo da solo ' +
            msg.attempt + '/' + msg.max + '...');
        }
        break;
      case 'network-warning':
        mostraAvvisoRete(msg);
        break;
      case 'suggerimenti-azioni':
        if (msg && Array.isArray(msg.actions)) {
          renderPromptActions(msg.actions);
        }
        break;
      case 'choice-error': {
        const card = elMessages && elMessages.querySelector('[data-interaction-id="' + String(msg.interactionId || '').replace(/[^a-zA-Z0-9_-]/g, '') + '"]');
        if (card) {
          card.classList.add('has-error');
          if (msg.recoverable) {
            card.classList.remove('is-resolved');
            card.querySelectorAll('button, input').forEach(function (node) { node.disabled = false; });
            card.querySelectorAll('.is-selected').forEach(function (node) { node.classList.remove('is-selected'); });
            const eyebrow = card.querySelector('.guided-choice-eyebrow');
            if (eyebrow) eyebrow.textContent = 'Adam ha bisogno di una scelta';
            const messageRoot = card.closest('.msg');
            if (messageRoot && messageRoot._message && messageRoot._message.interaction) {
              messageRoot._message.interaction.status = 'pending';
              messageRoot._message.interaction.answer = null;
            }
          }
          const status = card.querySelector('.guided-choice-status');
          if (status) status.textContent = msg.text || 'La scelta non è stata accettata.';
        }
        break;
      }
      case 'error':
        upsertMessage({
          id: 'err' + Date.now(),
          role: 'system',
          level: 'error',
          blocks: [{ kind: 'text', text: msg.text || 'Errore sconosciuto' }]
        });
        setBusy(false);
        break;
      default:
        break;
    }
  }

  // Mostra a che punto e' la verifica automatica dei file appena scritti.
  function handleVerifyEvent(msg) {
    if (msg.collaudi) return handleCollaudiEvent(msg);
    if (msg.sonda) return handleSondaEvent(msg);
    if (msg.state === 'running') {
      setBusy(true, 'Verifico ' + (msg.files || []).length + ' file appena scritti...');
      return;
    }
    if (msg.state === 'ok') {
      const notaSAST = semgrepStatusNote(msg.semgrep);
      addVerifyNote('ok', 'Verifica superata: ' + msg.checked + ' controlli senza errori' +
        (notaSAST && notaSAST.kind === 'ok' ? ' — ' + notaSAST.text : ''));
      if (notaSAST && notaSAST.kind === 'warn') addVerifyNote('warn', notaSAST.text, notaSAST.findings);
      setBusy(false);
      return;
    }
    if (msg.state === 'failed') {
      const n = (msg.failures || []).length;
      addVerifyNote('err',
        'Verifica fallita: ' + n + (n === 1 ? ' errore' : ' errori') +
        ' — correggo (' + msg.attempt + '/' + msg.max + ')',
        msg.failures);
      const notaSAST = semgrepStatusNote(msg.semgrep);
      if (notaSAST && notaSAST.kind === 'warn') addVerifyNote('warn', notaSAST.text, notaSAST.findings);
    }
  }

  function semgrepStatusNote(status) {
    if (!status || status.skipped) return null;
    if (status.available === false) {
      return { kind: 'warn', text: 'Semgrep non installato: analisi SAST aggiuntiva saltata. ' +
        (status.reason || 'Installa Semgrep in un ambiente Python isolato e riavvia lo Studio.') };
    }
    if (!status.executed) {
      return { kind: 'warn', text: 'Semgrep non ha completato la scansione: ' +
        (status.error || 'controllo SAST non disponibile.') };
    }
    const advisories = status.advisories || [];
    if (advisories.length || (status.scannerErrors || []).length) {
      return {
        kind: 'warn',
        text: advisories.length ? 'Semgrep ha rilevato ' + advisories.length +
          ' avvisi da controllare (non bloccano la correzione automatica).' :
          'Semgrep ha completato con ' + status.scannerErrors.length + ' avvisi dello scanner.',
        findings: advisories.slice(0, 12)
      };
    }
    if (status.findingsCount > 0) return null;
    return { kind: 'ok', text: 'Semgrep: nessun risultato su ' + status.scannedFiles + ' file.' };
  }

  // Stessa idea per le pagine: dopo le modifiche di Adam lo Studio le riprova e
  // confronta le misure con quelle di prima.
  function handleSondaEvent(msg) {
    if (msg.state === 'running') {
      setBusy(true, 'Riprovo ' + ((msg.files || [])[0] || 'la pagina') + ' e confronto le misure...');
      return;
    }
    if (msg.state === 'ok') {
      const n = msg.checked || 0;
      const daProvare = (msg.nonVerificati || []).length;
      addVerifyNote('ok', 'Misure confermate su ' + msg.pagina + ': ' +
        (n === 0 ? 'nessun problema ancora presente' :
          n === 1 ? 'il problema misurato prima non c\'è più' : 'i ' + n + ' problemi misurati prima non ci sono più') +
        (daProvare ? ' (' + daProvare + ' non ' + (daProvare === 1 ? 'provato' : 'provati') + ' in questa misura)' : ''),
        msg.risolti);
      setBusy(false);
      return;
    }
    if (msg.state === 'failed') {
      const n = (msg.failures || []).length;
      addVerifyNote('err', 'Le misure su ' + msg.pagina + ' mostrano ancora ' + n +
        (n === 1 ? ' problema' : ' problemi') + ' — correggo (' + msg.attempt + '/' + msg.max + ')',
        msg.failures);
    }
  }

  function addVerifyNote(kind, text, failures) {
    hideEmpty();
    const note = document.createElement('div');
    note.className = 'msg-verify verify-' + kind;

    const icon = kind === 'ok'
      ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>'
      : kind === 'warn'
        ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>'
        : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';

    let html = '<div class="verify-head">' + icon + '<span>' + escapeHtml(text) + '</span></div>';
    if (failures && failures.length) {
      html += '<ul class="verify-list">' + failures.map(function (f) {
        return '<li><code>' + escapeHtml(f.relative || f.file.split(/[\\/]/).pop()) + '</code>: ' +
          escapeHtml((f.error || '').split('\n')[0].slice(0, 160)) + '</li>';
      }).join('') + '</ul>';
    }
    note.innerHTML = html;
    elMessages.appendChild(note);
    scrollToBottom();
    return note;
  }

  // Dopo un turno normale una capacita' protetta dai collaudi non funziona piu'. Decide
  // l'utente: forse era proprio il cambiamento richiesto.
  // --------------------------------------------------------------- contesto e chat salvate

  function formatTokens(n) {
    if (n === null || n === undefined) return '0';
    return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n);
  }

  // Quanta memoria di lavoro del modello occupa la conversazione (stile Claude Code).
  function setContesto(c) {
    const pill = document.getElementById('chat-context-pill');
    if (!pill) return;
    if (!c || (!c.limite && (c.percento === null || c.percento === undefined))) {
      pill.hidden = true;
      return;
    }
    pill.hidden = false;
    const usati = c.usati || 0;
    const limite = c.limite || 0;
    const pct = c.percento !== null && c.percento !== undefined ? c.percento : (limite ? Math.round(usati * 100 / limite) : 0);

    pill.textContent = '🪙 ' + formatTokens(usati) + ' / ' + formatTokens(limite) + ' (' + pct + '%)';
    pill.title = 'Contesto: ' + usati.toLocaleString() + ' / ' + (limite ? limite.toLocaleString() : '?') +
      ' token usati (' + pct + '%). Oltre l\'80% lo Studio apre una nuova sessione salvando la precedente.';
    pill.classList.toggle('ctx-medio', pct >= 60 && pct < 80);
    pill.classList.toggle('ctx-alto', pct >= 80);
  }

  // Elenco delle chat salvate: quelle spuntate sono memoria che Adam puo' esplorare.
  function apriArchivio() {
    const vecchio = document.querySelector('.archivio-overlay');
    if (vecchio) vecchio.remove();
    const overlay = document.createElement('div');
    overlay.className = 'archivio-overlay';
    overlay.innerHTML =
      '<div class="archivio-box" role="dialog" aria-modal="true" aria-label="Chat salvate">' +
        '<div class="archivio-head"><div><strong>Chat salvate</strong>' +
          '<p>Le chat spuntate sono memoria che Adam può esplorare con Grep e Read quando gli serve: ' +
          'non entrano intere nel contesto.</p></div>' +
          '<button type="button" class="archivio-chiudi" aria-label="Chiudi">×</button></div>' +
        '<div class="archivio-corpo"><ul class="archivio-lista"><li class="archivio-vuoto">Carico...</li></ul>' +
          '<pre class="archivio-testo" hidden></pre></div>' +
      '</div>';
    document.body.appendChild(overlay);
    const suEsc = function (e) { if (e.key === 'Escape') chiudi(); };
    const chiudi = function () {
      overlay.remove();
      document.removeEventListener('keydown', suEsc);
    };
    document.addEventListener('keydown', suEsc);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) chiudi(); });
    overlay.querySelector('.archivio-chiudi').addEventListener('click', chiudi);
    const lista = overlay.querySelector('.archivio-lista');
    const testo = overlay.querySelector('.archivio-testo');

    fetch('/api/chat-archivio').then(function (r) { return r.json(); }).then(function (d) {
      const chat = (d && d.chat) || [];
      lista.innerHTML = '';
      if (!chat.length) {
        lista.innerHTML = '<li class="archivio-vuoto">Nessuna chat salvata per questo progetto: si salvano da sole a fine turno.</li>';
        return;
      }
      chat.forEach(function (c) {
        const li = document.createElement('li');
        li.className = 'archivio-voce';
        li.innerHTML =
          '<label class="archivio-collega" title="Usa come memoria"><input type="checkbox"><span>memoria</span></label>' +
          '<div class="archivio-info"><span class="archivio-titolo"></span><span class="archivio-meta"></span></div>' +
          '<button type="button" class="btn-note">Apri</button>';
        const quando = new Date(c.inizio).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        li.querySelector('.archivio-titolo').textContent = c.titolo + (d.corrente === c.file ? ' (questa)' : '');
        li.querySelector('.archivio-meta').textContent = quando + ' · ' + c.messaggi + ' messaggi';
        const casella = li.querySelector('input');
        casella.checked = c.collegata !== false;
        casella.addEventListener('change', function () {
          casella.disabled = true;
          fetch('/api/chat-archivio/collega', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ file: c.file, collegata: casella.checked })
          }).then(function (r) { return r.json(); }).then(function (x) {
            if (!x || !x.success) throw new Error((x && x.error) || 'errore');
          }).catch(function () {
            casella.checked = !casella.checked;
          }).finally(function () {
            casella.disabled = false;
          });
        });
        li.querySelector('button').addEventListener('click', function () {
          fetch('/api/chat-archivio/leggi?file=' + encodeURIComponent(c.file))
            .then(function (r) { return r.json(); })
            .then(function (x) {
              testo.hidden = false;
              testo.textContent = (x && (x.testo || x.error)) || 'Non leggibile';
              testo.scrollTop = 0;
            });
        });
        lista.appendChild(li);
      });
    }).catch(function (e) {
      lista.innerHTML = '<li class="archivio-vuoto"></li>';
      lista.firstChild.textContent = 'Errore: ' + e.message;
    });
  }

  // --------------------------------------------------------------- regole di Adam

  // Regole che Adam segue sempre. Prima di adottarle lo Studio fa un esame: se una regola
  // peggiora matematica, codice o uso degli strumenti, o non viene seguita, non passa.
  function apriRegole() {
    const vecchio = document.querySelector('.archivio-overlay');
    if (vecchio) vecchio.remove();
    const overlay = document.createElement('div');
    overlay.className = 'archivio-overlay';
    overlay.innerHTML =
      '<div class="archivio-box regole-box" role="dialog" aria-modal="true" aria-label="Regole di Adam">' +
        '<div class="archivio-head"><div><strong>Regole di Adam</strong>' +
          '<p>Regole che Adam segue sempre. Prima di adottarle lo Studio fa un esame (matematica, codice, uso degli ' +
          'strumenti, e le prove che scrivi tu): se qualcosa peggiora non vengono adottate. Una regola non puo\' mai ' +
          'chiedere di sbagliare un calcolo o di rompere il codice. Ogni versione resta nella storia.</p></div>' +
          '<button type="button" class="archivio-chiudi" aria-label="Chiudi">×</button></div>' +
        '<div class="archivio-corpo">' +
          '<div class="regole-elenco"></div>' +
          '<button type="button" class="btn-note regole-aggiungi">+ Aggiungi una regola</button>' +
          '<div class="regole-azioni"><span class="regole-versione"></span>' +
            '<button type="button" class="btn btn-primary btn-sm regole-prova">Esamina e adotta</button></div>' +
          '<div class="ev-stato regole-esito" hidden></div>' +
          '<div class="regole-storia"></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    const suEsc = function (e) { if (e.key === 'Escape') chiudi(); };
    const chiudi = function () {
      overlay.remove();
      document.removeEventListener('keydown', suEsc);
    };
    document.addEventListener('keydown', suEsc);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) chiudi(); });
    overlay.querySelector('.archivio-chiudi').addEventListener('click', chiudi);
    const elenco = overlay.querySelector('.regole-elenco');
    const esito = overlay.querySelector('.regole-esito');

    function riga(r) {
      const div = document.createElement('div');
      div.className = 'regola-riga';
      div.innerHTML =
        '<input type="text" class="regola-testo" maxlength="300" placeholder="es. Commenta sempre il codice in italiano">' +
        '<button type="button" class="archivio-chiudi regola-togli" aria-label="Togli la regola">×</button>' +
        '<input type="text" class="regola-domanda" maxlength="400" placeholder="Prova (facoltativa): una domanda per verificarla">' +
        '<input type="text" class="regola-contiene" maxlength="100" placeholder="la risposta deve contenere...">';
      div.querySelector('.regola-testo').value = (r && r.testo) || '';
      div.querySelector('.regola-domanda').value = (r && r.prova && r.prova.domanda) || '';
      div.querySelector('.regola-contiene').value = (r && r.prova && r.prova.contiene) || '';
      div.querySelector('.regola-togli').addEventListener('click', function () { div.remove(); });
      elenco.appendChild(div);
    }

    function leggiRighe() {
      return Array.from(elenco.querySelectorAll('.regola-riga')).map(function (div) {
        const testo = div.querySelector('.regola-testo').value.trim();
        const domanda = div.querySelector('.regola-domanda').value.trim();
        const contiene = div.querySelector('.regola-contiene').value.trim();
        return domanda ? { testo: testo, prova: { domanda: domanda, contiene: contiene } } : { testo: testo };
      }).filter(function (r) { return r.testo; });
    }

    function mostraEsito(testo, tipo, dettagli, conForza) {
      esito.hidden = false;
      esito.className = 'ev-stato regole-esito' + (tipo ? ' ' + tipo : '');
      esito.innerHTML = '';
      const p = document.createElement('p');
      p.textContent = testo;
      esito.appendChild(p);
      if (dettagli && dettagli.length) {
        const ul = document.createElement('ul');
        dettagli.forEach(function (d) {
          const li = document.createElement('li');
          li.textContent = d;
          ul.appendChild(li);
        });
        esito.appendChild(ul);
      }
      if (conForza) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn-term-tool';
        b.textContent = 'Adotta comunque';
        b.addEventListener('click', function () { esamina(true); });
        esito.appendChild(b);
      }
    }

    function mostraStato(s) {
      elenco.innerHTML = '';
      (s.regole || []).forEach(riga);
      if (!(s.regole || []).length) riga(null);
      overlay.querySelector('.regole-versione').textContent = s.versione
        ? 'In vigore: versione ' + s.versione + (s.esame ? ' (esame ' + s.esame.punti + '/' + s.esame.totale + ')' : '')
        : 'Nessuna regola in vigore';
      const storia = overlay.querySelector('.regole-storia');
      storia.innerHTML = '';
      if ((s.storia || []).length) {
        const titolo = document.createElement('p');
        titolo.className = 'regole-storia-titolo';
        titolo.textContent = 'Versioni precedenti (copia di sicurezza)';
        storia.appendChild(titolo);
        s.storia.forEach(function (v) {
          const d = document.createElement('div');
          d.className = 'regole-versione-riga';
          const t = document.createElement('span');
          t.textContent = 'v' + v.versione + ' · ' + (v.regole || []).length + ' regole' + (v.punti ? ' · esame ' + v.punti : '') +
            (v.regole && v.regole.length ? ' · "' + v.regole[0].testo.slice(0, 50) + (v.regole.length > 1 ? '"…' : '"') : '');
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'btn-note';
          b.textContent = 'Ripristina';
          b.addEventListener('click', function () {
            fetch('/api/regole/ripristina', { method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ versione: v.versione }) })
              .then(function (r) { return r.json(); })
              .then(function (x) {
                if (!x.success) throw new Error(x.error || 'errore');
                mostraStato(x.stato);
                mostraEsito('Ripristinata la versione ' + v.versione + '.', 'ok');
              })
              .catch(function (e) { mostraEsito('Non ripristinata: ' + e.message, 'err'); });
          });
          d.appendChild(t);
          d.appendChild(b);
          storia.appendChild(d);
        });
      }
    }

    function esamina(forza) {
      const bottone = overlay.querySelector('.regole-prova');
      bottone.disabled = true;
      mostraEsito('Esame in corso: rispondo alle stesse domande con le regole di adesso e con quelle nuove. ' +
        'Ci vuole circa un minuto; l\'avanzamento e\' anche nella chat.', 'corso');
      fetch('/api/regole/prova', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ regole: leggiRighe(), forza: !!forza }) })
        .then(function (r) { return r.json().then(function (x) { if (!r.ok) throw new Error(x.error || 'errore'); return x; }); })
        .then(function (x) {
          mostraStato(x.stato);
          const punteggi = 'Prima ' + x.prima.punti + '/' + x.prima.totale + ', dopo ' + x.dopo.punti + '/' + x.dopo.totale + '.';
          if (x.adottate && !x.forzate) mostraEsito('Regole adottate: nessun peggioramento. ' + punteggi, 'ok');
          else if (x.forzate) mostraEsito('Regole adottate comunque, su tua richiesta. ' + punteggi, 'err', x.motivi);
          else mostraEsito('Regole NON adottate: le regole in vigore restano quelle di prima. ' + punteggi, 'err', x.motivi, true);
        })
        .catch(function (e) { mostraEsito('Esame non riuscito: ' + e.message, 'err'); })
        .finally(function () { bottone.disabled = false; });
    }

    overlay.querySelector('.regole-aggiungi').addEventListener('click', function () { riga(null); });
    overlay.querySelector('.regole-prova').addEventListener('click', function () { esamina(false); });
    fetch('/api/regole').then(function (r) { return r.json(); }).then(mostraStato)
      .catch(function (e) { mostraEsito('Regole non leggibili: ' + e.message, 'err'); });
  }

  function ricordaMessaggio(el, bottone) {
    const m = el._message || {};
    const testo = (m.blocks || [])
      .filter(function (b) { return b.kind === 'text' && b.text; })
      .map(function (b) { return b.text; })
      .join('\n').trim();
    if (!testo) {
      bottone.textContent = 'Niente da ricordare';
      return;
    }
    bottone.disabled = true;
    bottone.textContent = 'Salvo...';
    fetch('/api/memory/node', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: 'project',
        type: 'data',
        label: 'Da Adam: ' + testo.replace(/\s+/g, ' ').slice(0, 60),
        value: testo.slice(0, 1500),
        tags: ['salvato-a-mano']
      })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.success) throw new Error((d && d.error) || 'errore sconosciuto');
      bottone.textContent = 'Ricordato';
      bottone.classList.add('fatto');
    }).catch(function (e) {
      bottone.disabled = false;
      bottone.textContent = 'Riprova';
      bottone.title = 'Non salvato: ' + e.message;
    });
  }

  function ritiraCollaudi(pagina, nomi) {
    return fetch('/api/collaudi/ritira', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pagina: pagina, nomi: nomi })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.success) throw new Error((d && d.error) || 'errore sconosciuto');
      return d;
    });
  }

  // Collaudi che falliscono alla prima misura: li ha scritti un modello, e l'utente puo'
  // ritirare quelli che non descrivono davvero il gioco prima che Adam ci lavori sopra.
  function handleCollaudiFalliti(msg) {
    const nomi = msg.nomi || [];
    if (!nomi.length) return;
    const note = addVerifyNote('err', nomi.length + (nomi.length === 1 ? ' collaudo del revisore fallisce' : ' collaudi del revisore falliscono') +
      ' su ' + msg.pagina + '. Li scrive un modello e possono essere sbagliati: ritira quelli che non descrivono davvero il gioco.');
    const lista = document.createElement('div');
    lista.className = 'collaudi-falliti';
    nomi.forEach(function (nome, i) {
      const riga = document.createElement('div');
      riga.className = 'collaudo-riga';
      const testo = document.createElement('span');
      testo.className = 'collaudo-testo';
      const dettaglio = ((msg.failures || [])[i] || {}).error || '';
      testo.textContent = dettaglio.replace(/^Collaudo fallito /, '').split(' Dalla descrizione:')[0].slice(0, 260);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn-note';
      b.textContent = 'Ritira';
      b.addEventListener('click', function () {
        b.disabled = true;
        ritiraCollaudi(msg.pagina, [nome]).then(function () {
          riga.classList.add('ritirato');
          b.replaceWith(Object.assign(document.createElement('span'), { className: 'note-done', textContent: 'ritirato' }));
        }).catch(function (e) {
          b.disabled = false;
          b.title = 'Non riuscito: ' + e.message;
        });
      });
      riga.appendChild(testo);
      riga.appendChild(b);
      lista.appendChild(riga);
    });
    note.appendChild(lista);
    scrollToBottom();
  }

  // Collaudi che il revisore stesso ha giudicato sbagliati e ritirato: non arrivano ad Adam.
  // Anche il giudice e' un modello: l'utente puo' rimetterli.
  function handleCollaudiGiudicati(msg) {
    const giudicati = msg.giudicati || [];
    if (!giudicati.length) return;
    const note = addVerifyNote('ok', giudicati.length + (giudicati.length === 1
      ? ' collaudo giudicato sbagliato dal revisore e ritirato'
      : ' collaudi giudicati sbagliati dal revisore e ritirati') +
      ' su ' + msg.pagina + ': non li passo ad Adam. Se invece descrivono un difetto vero, rimettili.');
    const lista = document.createElement('div');
    lista.className = 'collaudi-falliti';
    giudicati.forEach(function (g) {
      const riga = document.createElement('div');
      riga.className = 'collaudo-riga';
      const testo = document.createElement('span');
      testo.className = 'collaudo-testo';
      testo.textContent = '«' + g.nome + '»: ' + g.motivo;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn-note';
      b.textContent = 'Rimettilo';
      b.addEventListener('click', function () {
        b.disabled = true;
        fetch('/api/collaudi/rimetti', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pagina: msg.pagina, nomi: [g.nome] })
        }).then(function (r) { return r.json(); }).then(function (d) {
          if (!d || !d.success) throw new Error((d && d.error) || 'errore');
          b.replaceWith(Object.assign(document.createElement('span'), { className: 'note-done', textContent: 'rimesso' }));
        }).catch(function (e) {
          b.disabled = false;
          b.title = 'Non riuscito: ' + e.message;
        });
      });
      riga.appendChild(testo);
      riga.appendChild(b);
      lista.appendChild(riga);
    });
    note.appendChild(lista);
    scrollToBottom();
  }

  function handleCollaudiEvent(msg) {
    if (msg.state === 'giudicati') return handleCollaudiGiudicati(msg);
    if (msg.state === 'falliti') return handleCollaudiFalliti(msg);
    if (msg.state !== 'regressioni') return;
    const nomi = msg.nomi || [];
    const n = nomi.length;
    const note = addVerifyNote('err', 'Dopo le ultime modifiche su ' + msg.pagina + ' ' +
      (n === 1 ? 'una cosa che funzionava non funziona più' : n + ' cose che funzionavano non funzionano più'),
      msg.failures);
    const azioni = document.createElement('div');
    azioni.className = 'verify-actions';
    const ripristina = document.createElement('button');
    ripristina.type = 'button';
    ripristina.className = 'btn-note';
    ripristina.textContent = 'Chiedi ad Adam di ripristinare';
    const voluto = document.createElement('button');
    voluto.type = 'button';
    voluto.className = 'btn-note';
    voluto.textContent = 'È voluto: ritira ' + (n === 1 ? 'il collaudo' : 'i collaudi');
    const chiudi = function (testo) {
      azioni.innerHTML = '<span class="note-done">' + escapeHtml(testo) + '</span>';
    };
    ripristina.addEventListener('click', function () {
      if (busy || !sendFn) return;
      sendFn('Dopo le ultime modifiche su ' + msg.pagina + ' non funziona più: ' +
        nomi.map(function (x) { return '«' + x + '»'; }).join(', ') +
        '. Lo misurano i collaudi del revisore. Ripristina questi comportamenti senza togliere quello che hai appena aggiunto.');
      chiudi('Richiesta inviata ad Adam.');
    });
    voluto.addEventListener('click', function () {
      voluto.disabled = true;
      ripristina.disabled = true;
      ritiraCollaudi(msg.pagina, nomi).then(function () {
        chiudi(n === 1 ? 'Collaudo ritirato: non verrà più eseguito.' : 'Collaudi ritirati: non verranno più eseguiti.');
      }).catch(function (e) { chiudi('Non sono riuscito a ritirarli: ' + e.message); });
    });
    azioni.appendChild(ripristina);
    azioni.appendChild(voluto);
    note.appendChild(azioni);
    scrollToBottom();
  }

  // --------------------------------------------------------------- avanzamento

  // Scheda delle verifiche lunghe (browser, revisore, collaudi): le fasi con il loro stato,
  // cosa sta succedendo adesso, il tempo trascorso e il focus scelto per Adam.
  const ICONE_FASE = {
    ok: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2"><polyline points="20 6 9 17 4 12"></polyline></svg>',
    warn: '!',
    err: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
    saltata: '–',
    attesa: '',
    corso: '<span class="prog-spin"></span>'
  };

  function formatElapsed(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    return s < 60 ? s + ' s' : Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function progressElement(message) {
    const el = document.createElement('div');
    el.className = 'msg-progress';
    el.dataset.messageId = message.id;
    el.setAttribute('role', 'status');
    el.innerHTML =
      '<div class="prog-head"><span class="prog-state"></span><span class="prog-title"></span><span class="prog-time"></span></div>' +
      '<div class="prog-bar"><div class="prog-fill"></div></div>' +
      '<div class="prog-focus" hidden><span class="prog-focus-label">Focus</span><span class="prog-focus-text"></span></div>' +
      '<ol class="prog-steps"></ol>' +
      '<div class="prog-summary" hidden></div>';
    updateProgress(el, message);
    return el;
  }

  function newStep() {
    const li = document.createElement('li');
    li.innerHTML = '<span class="step-icon"></span><span class="step-body"><span class="step-name"></span>' +
      '<span class="step-detail"></span></span><span class="step-time"></span>';
    return li;
  }

  // Aggiorna la scheda sul posto, senza ricostruirla: le animazioni non ripartono da capo.
  function updateProgress(el, m) {
    el._progress = m;
    el._offset = (m.ora || Date.now()) - Date.now();   // orologio del server rispetto al nostro
    const fasi = m.fasi || [];
    const concluse = fasi.filter(function (f) { return /^(ok|warn|err|saltata)$/.test(f.stato); }).length;
    const running = !m.fine;
    el.classList.toggle('running', running);
    el.classList.toggle('done', !running);
    ['ok', 'warn', 'err'].forEach(function (e) { el.classList.toggle('esito-' + e, !running && m.esito === e); });
    el.querySelector('.prog-state').innerHTML = running ? ICONE_FASE.corso : (ICONE_FASE[m.esito] || ICONE_FASE.ok);
    el.querySelector('.prog-title').textContent = m.titolo || 'Verifica';
    el.querySelector('.prog-fill').style.width =
      (running ? Math.max(4, Math.round(concluse * 100 / (fasi.length || 1))) : 100) + '%';
    el.querySelector('.prog-focus').hidden = !m.focus;
    el.querySelector('.prog-focus-text').textContent = m.focus || '';
    const lista = el.querySelector('.prog-steps');
    while (lista.children.length < fasi.length) lista.appendChild(newStep());
    fasi.forEach(function (f, i) {
      const li = lista.children[i];
      if (li.dataset.stato !== f.stato) {
        li.dataset.stato = f.stato;
        li.className = 'prog-step s-' + f.stato;
        li.querySelector('.step-icon').innerHTML = ICONE_FASE[f.stato] || '';
      }
      li.querySelector('.step-name').textContent = f.nome;
      li.querySelector('.step-detail').textContent = f.dettaglio || '';
      li.querySelector('.step-time').textContent = f.inizio && f.fine ? formatElapsed(f.fine - f.inizio) : '';
    });
    const summary = el.querySelector('.prog-summary');
    summary.hidden = !m.riassunto;
    summary.textContent = m.riassunto || '';
    tickProgressElement(el);
  }

  function tickProgressElement(el) {
    const m = el._progress;
    if (!m) return;
    const adesso = Date.now() + (el._offset || 0);
    el.querySelector('.prog-time').textContent = formatElapsed((m.fine || adesso) - m.inizio);
    const lista = el.querySelector('.prog-steps');
    (m.fasi || []).forEach(function (f, i) {
      if (f.stato === 'corso' && f.inizio && lista.children[i]) {
        lista.children[i].querySelector('.step-time').textContent = formatElapsed(adesso - f.inizio);
      }
    });
  }

  function tickProgress() {
    if (!elMessages) return;
    elMessages.querySelectorAll('.msg-progress.running').forEach(tickProgressElement);
  }

  // --------------------------------------------------------------- allegati

  const MAX_ALLEGATI = 4;
  const LATO_MAX = 1568;             // oltre questo lato il modello non vede piu' dettagli
  const MAX_DATI = 5 * 1024 * 1024;  // caratteri del data URL, circa 4 MB di immagine
  const MAX_FILE_TESTO = 1024 * 1024;
  const MAX_FILE_PDF = 4 * 1024 * 1024;
  const ESTENSIONI_TESTO = /\.(?:txt|md|json|jsonc|csv|tsv|xml|yaml|yml|html|css|js|mjs|cjs|ts|tsx|jsx|py|cs|java|c|h|cpp|hpp|go|rs|php|rb|sh|ps1|sql|toml|ini|cfg|log)$/i;
  const ESTENSIONE_PDF = /\.pdf$/i;

  // Riduce le immagini troppo grandi prima di inviarle: su un modello locale ogni pixel in
  // piu' si paga in tempo, a ogni turno successivo. PNG per le schermate (testo nitido),
  // JPEG per le foto o quando il PNG pesa troppo.
  function preparaImmagine(file) {
    return new Promise(function (resolve, reject) {
      const lettore = new FileReader();
      lettore.onerror = function () { reject(new Error('file non leggibile')); };
      lettore.onload = function () {
        const img = new Image();
        img.onerror = function () { reject(new Error('non è un\'immagine valida')); };
        img.onload = function () {
          const scala = Math.min(1, LATO_MAX / Math.max(img.width, img.height));
          const originale = String(lettore.result);
          if (scala === 1 && originale.length < MAX_DATI && /^data:image\/(png|jpeg|webp|gif);/.test(originale)) {
            resolve({ nome: file.name || 'immagine', dati: originale, tipo: 'immagine' });
            return;
          }
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.width * scala));
          c.height = Math.max(1, Math.round(img.height * scala));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          let uscita = file.type === 'image/png' ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.88);
          if (uscita.length >= MAX_DATI) uscita = c.toDataURL('image/jpeg', 0.8);
          if (uscita.length >= MAX_DATI) { reject(new Error('troppo grande anche ridotta')); return; }
          resolve({ nome: file.name || 'immagine', dati: uscita, tipo: 'immagine' });
        };
        img.src = String(lettore.result);
      };
      lettore.readAsDataURL(file);
    });
  }

  function preparaDocumento(file) {
    return new Promise(function (resolve, reject) {
      const nome = file.name || (file.type === 'application/pdf' ? 'allegato.pdf' : 'allegato.txt');
      if (ESTENSIONE_PDF.test(nome)) {
        if (file.type && file.type !== 'application/pdf') { reject(new Error('tipo MIME non compatibile con un PDF')); return; }
        if (file.size > MAX_FILE_PDF) { reject(new Error('supera il limite di 4 MiB')); return; }
        const lettorePdf = new FileReader();
        lettorePdf.onerror = function () { reject(new Error('file non leggibile')); };
        lettorePdf.onload = function () {
          const risultato = String(lettorePdf.result || '');
          const base64 = risultato.match(/^data:[^;,]*;base64,([A-Za-z0-9+/=]+)$/i);
          if (!base64) { reject(new Error('contenuto PDF non leggibile')); return; }
          resolve({ nome, dati: 'data:application/pdf;base64,' + base64[1], tipo: 'documento' });
        };
        lettorePdf.readAsDataURL(file);
        return;
      }
      if (!ESTENSIONI_TESTO.test(file.name || '')) { reject(new Error('tipo di file non supportato')); return; }
      if (file.size > MAX_FILE_TESTO) { reject(new Error('supera il limite di 1 MiB')); return; }
      const lettoreTesto = new FileReader();
      lettoreTesto.onerror = function () { reject(new Error('file non leggibile')); };
      lettoreTesto.onload = function () {
        const contenuto = String(lettoreTesto.result || '');
        if (contenuto.indexOf('\u0000') !== -1) { reject(new Error('sembra un file binario')); return; }
        const bytes = new TextEncoder().encode(contenuto);
        if (bytes.length > MAX_FILE_TESTO) { reject(new Error('supera il limite di 1 MiB')); return; }
        let binario = '';
        bytes.forEach(function (byte) { binario += String.fromCharCode(byte); });
        const mime = file.type && /^(?:text\/|application\/(?:json|xml|javascript|sql|toml|yaml|x-yaml))$/i.test(file.type)
          ? file.type : 'text/plain';
        resolve({ nome: file.name, dati: 'data:' + mime + ';charset=utf-8;base64,' + btoa(binario), tipo: 'documento' });
      };
      lettoreTesto.readAsText(file, 'utf-8');
    });
  }

  function avvisoAllegati(testo) {
    avvisoAllegatiAttivo = testo;
    if (timerAvvisoAllegati) clearTimeout(timerAvvisoAllegati);
    renderAllegati();
    timerAvvisoAllegati = setTimeout(function () {
      avvisoAllegatiAttivo = '';
      timerAvvisoAllegati = null;
      renderAllegati();
    }, 5000);
  }

  function aggiungiAllegati(files) {
    const candidati = Array.from(files || []).filter(function (f) {
      return /^image\/(png|jpeg|webp|gif)$/.test(f.type) || f.type === 'application/pdf' || ESTENSIONE_PDF.test(f.name || '') || ESTENSIONI_TESTO.test(f.name || '');
    });
    const rifiutati = Array.from(files || []).length - candidati.length;
    if (!candidati.length) { if (rifiutati) avvisoAllegati('Tipo di file non supportato. Usa immagini, PDF o file testuali/codice.'); return; }
    const posto = MAX_ALLEGATI - allegati.length - allegatiInPreparazione;
    if (posto <= 0) {
      avvisoAllegati('Al massimo ' + MAX_ALLEGATI + ' allegati per messaggio.');
      return;
    }
    const eccesso = candidati.length > posto;
    const daPreparare = candidati.slice(0, posto);
    allegatiInPreparazione += daPreparare.length;
    renderAllegati();
    const segnalazioni = [];
    if (rifiutati) segnalazioni.push(rifiutati + (rifiutati === 1 ? ' file escluso: tipo non supportato' : ' file esclusi: tipi non supportati'));
    if (eccesso) segnalazioni.push('aggiunti solo ' + posto + ' allegati per il limite massimo di ' + MAX_ALLEGATI);
    if (segnalazioni.length) avvisoAllegati(segnalazioni.join('. ') + '.');
    daPreparare.forEach(function (f) {
      let errorePreparazione = '';
      const prepara = /^image\/(png|jpeg|webp|gif)$/.test(f.type) ? preparaImmagine(f) : preparaDocumento(f);
      prepara.then(function (a) {
        allegati.push(a);
      }).catch(function (e) {
        errorePreparazione = (f.name || 'immagine') + ': ' + e.message;
      }).finally(function () {
        allegatiInPreparazione = Math.max(0, allegatiInPreparazione - 1);
        renderAllegati();
        if (errorePreparazione) avvisoAllegati(errorePreparazione);
      });
    });
  }

  function renderAllegati() {
    const box = document.getElementById('chat-allegati');
    if (!box) return;
    box.innerHTML = '';
    box.hidden = !allegati.length && !allegatiInPreparazione && !avvisoAllegatiAttivo;
    allegati.forEach(function (a, i) {
      const chip = document.createElement('div');
      chip.className = 'allegato allegato-' + a.tipo;
      chip.innerHTML = a.tipo === 'immagine'
        ? '<img alt=""><span></span><button type="button">×</button>'
        : '<span class="allegato-estensione"></span><span class="allegato-nome"></span><button type="button">×</button>';
      const img = chip.querySelector('img');
      if (img) img.src = a.dati;
      const estensione = (a.nome.split('.').pop() || 'TXT').toUpperCase();
      const badge = chip.querySelector('.allegato-estensione');
      if (badge) badge.textContent = estensione.slice(0, 5);
      if (badge) chip.querySelector('.allegato-nome').textContent = a.nome;
      else chip.querySelector('span').textContent = a.nome;
      const rimuovi = chip.querySelector('button');
      rimuovi.setAttribute('aria-label', 'Rimuovi allegato ' + a.nome);
      rimuovi.title = 'Rimuovi allegato';
      rimuovi.addEventListener('click', function () {
        allegati.splice(i, 1);
        renderAllegati();
      });
      box.appendChild(chip);
    });
    if (allegatiInPreparazione) {
      const stato = document.createElement('span');
      stato.className = 'allegati-attesa';
      stato.textContent = 'Preparo ' + allegatiInPreparazione + (allegatiInPreparazione === 1 ? ' allegato…' : ' allegati…');
      box.appendChild(stato);
    }
    if (avvisoAllegatiAttivo) {
      const avviso = document.createElement('span');
      avviso.className = 'allegati-avviso';
      avviso.setAttribute('role', 'status');
      avviso.setAttribute('aria-live', 'polite');
      avviso.textContent = avvisoAllegatiAttivo;
      box.appendChild(avviso);
    }
  }

  function apriImmagine(src) {
    const overlay = document.createElement('div');
    overlay.className = 'img-lightbox';
    overlay.innerHTML = '<img alt="">';
    overlay.querySelector('img').src = src;
    const suEsc = function (e) { if (e.key === 'Escape') chiudi(); };
    const chiudi = function () {
      overlay.remove();
      document.removeEventListener('keydown', suEsc);
    };
    overlay.addEventListener('click', chiudi);
    document.addEventListener('keydown', suEsc);
    document.body.appendChild(overlay);
  }

  function miniatura(src, alt) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = alt;
    img.loading = 'lazy';
    img.addEventListener('click', function () { apriImmagine(src); });
    return img;
  }

  // Le immagini che Adam riceve si vedono nella chat: quelle allegate dall'utente e le
  // schermate che lo Studio gli manda dopo aver provato la pagina.
  function renderImmagini(el, message) {
    const vecchia = el.querySelector(':scope > .msg-immagini');
    if (vecchia) vecchia.remove();
    const nomi = message.immagini || [];
    if (!nomi.length) return;
    const striscia = document.createElement('div');
    striscia.className = 'msg-immagini';
    if (message.auto) {
      const etichetta = document.createElement('span');
      etichetta.className = 'msg-immagini-etichetta';
      etichetta.textContent = 'Adam guarda:';
      striscia.appendChild(etichetta);
    }
    nomi.forEach(function (nome) {
      striscia.appendChild(miniatura('/api/screenshot/' + encodeURIComponent(nome), 'Immagine inviata ad Adam'));
    });
    el.appendChild(striscia);
  }

  // --------------------------------------------------------------- input

  function autoGrow() {
    if (!elInput) return;
    elInput.style.height = 'auto';
    elInput.style.height = Math.min(elInput.scrollHeight, 220) + 'px';
  }

  function submit() {
    if (!elInput) return;
    const text = elInput.value.trim();
    if (busy) return;
    if (allegatiInPreparazione) {
      avvisoAllegati('Attendi: sto preparando gli allegati. Poi premi di nuovo Invio.');
      return;
    }
    if (!text && !allegati.length) return;
    if (!navigator.onLine) {
      mostraAvvisoRete({
        stato: 'offline',
        messaggio: 'Sei offline: la connessione Internet è assente. Il modello non può ricevere o inviare finché la connessione non torna.'
      });
      return;
    }
    if (!sendFn) return;
    sendFn(text, allegati.map(function (a) { return { nome: a.nome, dati: a.dati }; }));
    elInput.value = '';
    allegati = [];
    renderAllegati();
    autoGrow();
    elInput.focus();
  }

  async function popolaSelettoreModelliLegacy(force) {
    if (!elModelSelect && !elCoderSelect && !elVisionSelect) return;
    // Salva la selezione corrente per ripristinarla dopo il rebuild
    const currentModelValue = elModelSelect ? elModelSelect.value : '';
    const currentCoderValue = elCoderSelect ? elCoderSelect.value : '';
    const currentVisionValue = elVisionSelect ? elVisionSelect.value : '';
    try {
      let data = null;
      try {
        const url = force ? '/api/available-models?force=1' : '/api/available-models';
        const res = await fetch(url);
        data = await res.json();
      } catch (e) {
        const res = await fetch('/api/local-models');
        const localData = await res.json();
        data = {
          success: true,
          cloudModels: [],
          localModels: (localData.models || []).map(m => ({ id: m.name, name: m.name, sizeGb: m.sizeGb })),
          currentModel: '',
          currentCoderModel: '',
          currentVisionModel: '',
          resolvedVisionModel: ''
        };
      }

      if (!data) return;

      const cloudModels = Array.isArray(data.cloudModels) ? data.cloudModels : [];
      const localModels = Array.isArray(data.localModels) ? data.localModels : [];
      const openrouterModels = Array.isArray(data.openrouterModels) ? data.openrouterModels : [];
      const cerebrasModels = Array.isArray(data.cerebrasModels) ? data.cerebrasModels : [];
      const ashnaModels = Array.isArray(data.ashnaModels) ? data.ashnaModels : [];
      const nvidiaModels = Array.isArray(data.nvidiaModels) ? data.nvidiaModels : [];
      const openaiModels = Array.isArray(data.openaiModels) ? data.openaiModels : [];
      const deepseekModels = Array.isArray(data.deepseekModels) ? data.deepseekModels : [];
      const geminiModels = Array.isArray(data.geminiModels) ? data.geminiModels : [];
      const groqModels = Array.isArray(data.groqModels) ? data.groqModels : [];
      const mistralModels = Array.isArray(data.mistralModels) ? data.mistralModels : [];
      const anthropicModels = Array.isArray(data.anthropicModels) ? data.anthropicModels : [];
      const customModels = Array.isArray(data.customModels) ? data.customModels : [];
      const providerStatus = data.providerStatus || {};

      function buildExtOptionLabel(m) {
        const p = m.provider || '';
        let prefix = '';
        if (p === 'Ashna') prefix = 'ashna: ';
        else if (p === 'NVIDIA') prefix = 'nvidia: ';
        else if (p === 'Cerebras') prefix = 'cerebras: ';
        else if (p === 'OpenRouter') prefix = 'openrouter: ';
        else if (p === 'OpenAI') prefix = 'openai: ';
        else if (p === 'DeepSeek') prefix = 'deepseek: ';
        else if (p === 'Gemini') prefix = 'gemini: ';
        else if (p === 'Groq') prefix = 'groq: ';
        else if (p === 'Mistral') prefix = 'mistral: ';
        else if (p === 'Anthropic') prefix = 'anthropic: ';
        else if (p === 'Custom') prefix = 'custom: ';

        const isFree = m.isFree || (typeof m.id === 'string' && (m.id.endsWith(':free') || m.id.includes('8b')));
        const costTag = isFree
          ? ((p === 'Cerebras' || p === 'Groq' || p === 'Gemini' || p === 'NVIDIA') ? '[FREE TIER] ' : '[GRATIS] ')
          : '[A CREDITI] ';
        const price = (!isFree && m.promptPriceM && m.promptPriceM !== '0')
          ? ` ($${m.promptPriceM}/$${m.completionPriceM} 1M)`
          : '';
        return prefix + costTag + (m.name || m.id) + price;
      }

      function appendModelGroups(selectEl, models, providerKey, freeLabel, paidLabel, freeAttr, paidAttr) {
        const free = models.filter(m => m.isFree || (typeof m.id === 'string' && (m.id.endsWith(':free') || m.id.includes('8b'))));
        const paid = models.filter(m => !free.includes(m));

        function buildOpt(m) {
          const opt = document.createElement('option');
          // Valore composito "provider::modello": lo stesso modello può esistere su più
          // provider (es. "nvidia/llama-3.1-nemotron-70b-instruct" su NVIDIA E su
          // OpenRouter) e con valori duplicati il <select> HTML diventa ambiguo (selezioni
          // il secondo ma ti risolve il primo). Così ogni opzione è univoca.
          opt.value = providerKey ? (providerKey + '::' + m.id) : m.id;
          opt.dataset.ext = '1';
          opt.dataset.model = m.id;
          if (providerKey) opt.dataset.provider = providerKey;
          opt.textContent = buildExtOptionLabel(m);
          return opt;
        }

        if (free.length) {
          const g = document.createElement('optgroup');
          g.label = freeLabel;
          g.dataset[freeAttr] = '1';
          free.forEach(m => g.appendChild(buildOpt(m)));
          selectEl.appendChild(g);
        }

        if (paid.length) {
          const g = document.createElement('optgroup');
          g.label = paidLabel;
          g.dataset[paidAttr] = '1';
          paid.forEach(m => g.appendChild(buildOpt(m)));
          selectEl.appendChild(g);
        }
      }

      const allProvidersList = groupsFromModelPayload(data).map(function (group) {
        return {
          key: group.id,
          name: group.name,
          models: group.models,
          freeLbl: group.name + ' — gratuiti / free tier',
          paidLbl: group.name + ' — a crediti'
        };
      });

      function renderProviderStatusWarnings(selectEl) {
        allProvidersList.forEach(p => {
          const st = providerStatus[p.key];
          if (!st) return;
          if (st.reachable === false) {
            const grpErr = document.createElement('optgroup');
            grpErr.label = `⚠️ ${p.name} — NON RAGGIUNGIBILE`;
            const optErr = document.createElement('option');
            optErr.disabled = true;
            optErr.value = '';
            optErr.textContent = `✗ Server o API non raggiungibile (${st.error || 'Offline o errore rete'})`;
            grpErr.appendChild(optErr);
            selectEl.appendChild(grpErr);
          } else if (st.creditsExhausted === true) {
            const grpWarn = document.createElement('optgroup');
            grpWarn.label = `⚠️ ${p.name} — CREDITI ESAURITI`;
            const optWarn = document.createElement('option');
            optWarn.disabled = true;
            optWarn.value = '';
            optWarn.textContent = `⚠️ Saldo esaurito (Richiede ricarica crediti sul fornitore)`;
            grpWarn.appendChild(optWarn);
            selectEl.appendChild(grpWarn);
          }
        });
      }

      // 1. Popola selettore Direttore (elModelSelect)
      if (elModelSelect) {
        elModelSelect.innerHTML = '';

        // Mostra avvisi di irraggiungibilità o crediti esauriti in cima alla tendina
        renderProviderStatusWarnings(elModelSelect);

        // Popola i modelli di tutti i provider configurati
        allProvidersList.forEach(p => {
          if (p.models && p.models.length > 0) {
            appendModelGroups(elModelSelect, p.models, p.key, p.freeLbl, p.paidLbl, p.key + 'Free', p.key + 'Paid');
          }
        });

        if (cloudModels.length) {
          const groupCloud = document.createElement('optgroup');
          groupCloud.label = 'Modelli Cloud';
          cloudModels.forEach(m => {
            const opt = document.createElement('option');
            const provKey = m.provider ? String(m.provider).toLowerCase() : '';
            opt.value = provKey ? (provKey + '::' + m.id) : m.id;
            opt.dataset.model = m.id;
            if (provKey) opt.dataset.provider = provKey;
            opt.textContent = 'Direttore: ' + m.name + (m.provider ? ' (' + m.provider + ')' : '');
            groupCloud.appendChild(opt);
          });
          elModelSelect.appendChild(groupCloud);
        }

        if (localModels.length) {
          const groupLocal = document.createElement('optgroup');
          groupLocal.label = 'Modelli Locali (Ollama)';
          localModels.forEach(m => {
            const opt = document.createElement('option');
            opt.value = 'ollama::' + m.id;
            opt.dataset.model = m.id;
            opt.dataset.provider = 'ollama';
            opt.textContent = 'Direttore: ' + m.name + (m.sizeGb ? ' (' + m.sizeGb + ' GB)' : '');
            groupLocal.appendChild(opt);
          });
          elModelSelect.appendChild(groupLocal);
        }

        const currentProviderKey = (data.provider || '').toLowerCase();
        function selezionaModello(val) {
          // Il valore può essere "provider::modello" oppure il solo nome del modello.
          const sepIdx = val.indexOf('::');
          const modelId = sepIdx === -1 ? val : val.slice(sepIdx + 2);
          // Preferisce l'opzione che combacia sia come modello sia come provider corrente
          // (così un "nemotron" selezionato da NVIDIA non finisce sull'occorrenza OpenRouter).
          let target = Array.from(elModelSelect.options).find(function (o) {
            return o.dataset && o.dataset.model === modelId && o.dataset.provider === currentProviderKey;
          });
          if (!target) {
            target = Array.from(elModelSelect.options).find(function (o) {
              return o.dataset && o.dataset.model === modelId;
            });
          }
          if (!target) {
            const opt = document.createElement('option');
            opt.value = modelId;
            opt.dataset.model = modelId;
            if (currentProviderKey) opt.dataset.provider = currentProviderKey;
            const prefix = (modelId === 'auto' || modelId.startsWith('ashna')) ? 'ashna: [ASHNA AI] ' :
              (modelId.startsWith('meta/') || modelId.startsWith('deepseek') || modelId.startsWith('nvidia/')) ? 'nvidia: [NVIDIA NIM] ' :
              (modelId.includes('/') ? 'openrouter model: ' : (modelId.startsWith('llama3') ? 'cerebras model: ' : 'Direttore: '));
            opt.textContent = prefix + modelId;
            elModelSelect.insertBefore(opt, elModelSelect.firstChild);
            target = opt;
          }
          target.selected = true;
        }
        if (currentModelValue) {
          selezionaModello(currentModelValue);
        } else if (data.currentModel) {
          selezionaModello(data.currentModel.trim());
        }
      }

      // 2. Popola selettore Coder (elCoderSelect)
      if (elCoderSelect) {
        const currentCoder = (data.currentCoderModel !== undefined ? data.currentCoderModel : elCoderSelect.value || '').trim();
        elCoderSelect.innerHTML = '';

        const optOff = document.createElement('option');
        optOff.value = '';
        optOff.textContent = 'Coder: Disattivato';
        elCoderSelect.appendChild(optOff);

        // Mostra avvisi di irraggiungibilità o crediti esauriti
        renderProviderStatusWarnings(elCoderSelect);

        // Popola modelli di tutti i provider configurati
        allProvidersList.forEach(p => {
          if (p.models && p.models.length > 0) {
            appendModelGroups(elCoderSelect, p.models, p.key, p.freeLbl, p.paidLbl, p.key + 'Free', p.key + 'Paid');
          }
        });

        if (cloudModels.length) {
          const groupCloud = document.createElement('optgroup');
          groupCloud.label = 'Modelli Cloud (consigliati per Coder)';
          cloudModels.forEach(m => {
            const opt = document.createElement('option');
            const provKey = m.provider ? String(m.provider).toLowerCase() : '';
            opt.value = provKey ? (provKey + '::' + m.id) : m.id;
            opt.dataset.model = m.id;
            if (provKey) opt.dataset.provider = provKey;
            opt.textContent = 'Coder: ' + m.name + (m.provider ? ' (' + m.provider + ')' : '');
            groupCloud.appendChild(opt);
          });
          elCoderSelect.appendChild(groupCloud);
        }

        if (localModels.length) {
          const groupLocal = document.createElement('optgroup');
          groupLocal.label = 'Modelli Locali (Ollama)';
          localModels.forEach(m => {
            const opt = document.createElement('option');
            opt.value = 'ollama::' + m.id;
            opt.dataset.model = m.id;
            opt.dataset.provider = 'ollama';
            opt.textContent = 'Coder: ' + m.name + (m.sizeGb ? ' (' + m.sizeGb + ' GB)' : '');
            groupLocal.appendChild(opt);
          });
          elCoderSelect.appendChild(groupLocal);
        }

        if (currentCoder) {
          let target = Array.from(elCoderSelect.options).find(o => o.dataset && o.dataset.model === currentCoder);
          if (!target) {
            const opt = document.createElement('option');
            opt.value = currentCoder;
            opt.dataset.model = currentCoder;
            const prefix = currentCoder.startsWith('ashna') ? 'ashna: [ASHNA AI] ' :
              (currentCoder.startsWith('meta/') || currentCoder.startsWith('deepseek') || currentCoder.startsWith('nvidia/')) ? 'nvidia: [NVIDIA NIM] ' :
              (currentCoder.includes('/') ? 'openrouter model: ' : 'Coder: ');
            opt.textContent = prefix + currentCoder;
            elCoderSelect.appendChild(opt);
            target = opt;
          }
          target.selected = true;
          elCoderSelect.classList.add('coder-active');
        } else {
          elCoderSelect.value = '';
          elCoderSelect.classList.remove('coder-active');
        }
      }

      // 3. Popola Vision solo con modelli che dichiarano o indicano supporto immagini.
      if (elVisionSelect) {
        elVisionSelect.innerHTML = '';
        const optAutomatico = document.createElement('option');
        optAutomatico.value = '';
        optAutomatico.textContent = 'Vision: Automatico';
        elVisionSelect.appendChild(optAutomatico);

        function supportaImmagini(m) {
          const modalita = [m.input_modalities, m.inputModalities, m.modalities,
            m.architecture && (m.architecture.input_modalities || m.architecture.modality)];
          const dichiaratePresenti = modalita.some(function (value) {
            return (Array.isArray(value) && value.length > 0) || (typeof value === 'string' && value.trim());
          });
          const dichiarate = modalita.filter(Boolean).map(function (value) {
            return Array.isArray(value) ? value.join(' ') : String(value);
          }).join(' ').toLowerCase();
          if (dichiaratePresenti) return /\b(?:image|images|vision|visual)\b/.test(dichiarate);
          const nome = String((m.id || '') + ' ' + (m.name || '')).toLowerCase();
          if (/(?:tts|transcrib|transcription|audio|speech|embed|search-preview|moderation|content-safety)/i.test(nome)) return false;
          return /(vision|omni|(?:^|[\s/_-])vl(?:[\s/:._-]|$)|gpt-4o|gpt-4\.1|gpt-5|gemini|claude|pixtral|llava|moondream|bakllava|qwen[^\s]*[- ](?:vl|omni)|internvl|minicpm[^\s]*v|phi-3-vision|molmo|idefics)/i.test(nome);
        }

        const visti = new Set();
        function appendVisionModels(gruppoNome, providerKey, models) {
          const disponibili = (models || []).filter(supportaImmagini);
          if (!disponibili.length) return;
          const gruppo = document.createElement('optgroup');
          gruppo.label = gruppoNome;
          disponibili.forEach(function (m) {
            const id = String(m.id || '').trim();
            if (!id) return;
            const providerEffettivo = providerKey || String(m.provider || '').toLowerCase();
            const chiave = providerEffettivo ? (providerEffettivo + '::' + id) : id;
            if (visti.has(chiave)) return;
            visti.add(chiave);
            const opt = document.createElement('option');
            opt.value = chiave;
            opt.dataset.model = id;
            if (providerEffettivo) opt.dataset.provider = providerEffettivo;
            opt.textContent = 'Vision: ' + (m.name || id);
            gruppo.appendChild(opt);
          });
          if (gruppo.children.length) elVisionSelect.appendChild(gruppo);
        }

        allProvidersList.forEach(function (p) {
          appendVisionModels(p.name, p.key, p.models);
        });
        appendVisionModels('Modelli Cloud', '', cloudModels);
        appendVisionModels('Modelli locali (Ollama)', 'ollama', localModels);

        const modelloAutomatico = scomponiRiferimentoModello(data.resolvedVisionModel || '');
        if (modelloAutomatico.model) {
          const chiave = modelloAutomatico.provider ? (modelloAutomatico.provider + '::' + modelloAutomatico.model) : modelloAutomatico.model;
          if (!visti.has(chiave)) {
            const gruppo = document.createElement('optgroup');
            gruppo.label = 'Modello Vision predefinito';
            const opt = document.createElement('option');
            opt.value = chiave;
            opt.dataset.model = modelloAutomatico.model;
            if (modelloAutomatico.provider) opt.dataset.provider = modelloAutomatico.provider;
            opt.textContent = 'Vision: ' + modelloAutomatico.model;
            gruppo.appendChild(opt);
            elVisionSelect.appendChild(gruppo);
            visti.add(chiave);
          }
        }

        const currentVision = currentVisionValue || String(data.currentVisionModel || '').trim();
        impostaVisioneSelezionata(currentVision, data.resolvedVisionModel);
      }

      if (data.effort) {
        if (elEffortSelect) elEffortSelect.value = data.effort;
        if (elEffortPill) elEffortPill.textContent = 'Effort: ' + data.effort;
      }
      if (elProviderPill) {
        let pLabel = data.provider || 'anthropic';
        if (pLabel === 'anthropic') pLabel = 'Anthropic';
        else if (pLabel === 'ollama') pLabel = 'Ollama';
        else if (pLabel === 'custom') {
          if (cerebrasModels.length > 0) pLabel = 'Cerebras';
          else if (openrouterModels.length > 0) pLabel = 'OpenRouter';
          else pLabel = 'Custom';
        }
        elProviderPill.textContent = 'Provider: ' + pLabel;
      }

      if (elFilterInput && elFilterInput.value) {
        filterModelOptions(elFilterInput.value);
      }
    } catch (e) {
      console.warn('[ChatUI] Popolamento selettori modelli fallito:', e.message);
    }
  }

  function filterModelOptions(query) {
    const q = (query || '').toLowerCase().trim();
    const selects = [elModelSelect, elCoderSelect, elVisionSelect].filter(Boolean);

    selects.forEach(sel => {
      const optgroups = sel.querySelectorAll('optgroup');
      const directOptions = Array.from(sel.childNodes).filter(n => n.tagName === 'OPTION');

      if (!q) {
        optgroups.forEach(og => { og.hidden = false; og.style.display = ''; });
        sel.querySelectorAll('option').forEach(opt => { opt.hidden = false; opt.style.display = ''; });
        return;
      }

      directOptions.forEach(opt => {
        const match = (opt.textContent || '').toLowerCase().includes(q) || (opt.value || '').toLowerCase().includes(q);
        opt.hidden = !match;
        opt.style.display = match ? '' : 'none';
      });

      optgroups.forEach(og => {
        let visibleCount = 0;
        og.querySelectorAll('option').forEach(opt => {
          const match = (opt.textContent || '').toLowerCase().includes(q) || (opt.value || '').toLowerCase().includes(q);
          opt.hidden = !match;
          opt.style.display = match ? '' : 'none';
          if (match) visibleCount++;
        });
        og.hidden = (visibleCount === 0);
        og.style.display = (visibleCount === 0) ? 'none' : '';
      });
    });
  }

  function groupsFromModelPayload(data) {
    if (Array.isArray(data.providerGroups)) {
      return data.providerGroups.map(function (group) {
        const id = String(group.id || '').trim().toLowerCase();
        const transport = String(group.transport || id).trim().toLowerCase();
        return {
          id: id,
          name: String(group.name || id),
          source: String(group.source || 'remote'),
          transport: transport,
          status: group.status || null,
          models: (Array.isArray(group.models) ? group.models : []).map(function (model) {
            return Object.assign({}, model, {
              id: String(model.id || '').trim(),
              name: String(model.name || model.id || '').trim(),
              transport: String(model.transport || transport).toLowerCase()
            });
          }).filter(function (model) { return !!model.id; })
        };
      }).filter(function (group) { return group.id && group.models.length; });
    }

    // Compatibilita' con server precedenti: scopre i campi *Models senza una
    // lista provider hard-coded. Il payload normalizzato resta la via primaria.
    const groups = new Map();
    Object.keys(data || {}).filter(function (key) {
      return /Models$/.test(key) && Array.isArray(data[key]);
    }).forEach(function (key) {
      if (key === 'cloudModels') {
        data[key].forEach(function (model) {
          const raw = String(model.provider || 'cloud').toLowerCase();
          const id = raw.replace(/[^a-z0-9_-]/g, '-');
          if (!groups.has(id)) groups.set(id, { id: id, name: model.provider || 'Cloud', transport: id, source: 'legacy', status: null, models: [] });
          groups.get(id).models.push(model);
        });
        return;
      }
      const id = key === 'localModels' ? 'ollama' : key.replace(/Models$/, '').toLowerCase();
      const transport = id;
      const name = id === 'ollama' ? 'Ollama locale' : id.replace(/(^|[-_])([a-z])/g, function (_, p, c) { return (p ? ' ' : '') + c.toUpperCase(); });
      groups.set(id, { id: id, name: name, transport: transport, source: 'legacy', status: (data.providerStatus || {})[id] || null, models: data[key] });
    });
    return Array.from(groups.values()).map(function (group) {
      group.models = group.models.map(function (model) {
        return Object.assign({}, model, { id: String(model.id || model.name || ''), name: String(model.name || model.id || ''), transport: group.transport });
      }).filter(function (model) { return !!model.id; });
      return group;
    }).filter(function (group) { return group.models.length; });
  }

  function findProviderGroup(selection) {
    const selected = selection || {};
    let group = selected.group && modelProviderGroups.find(function (candidate) { return candidate.id === selected.group; });
    if (!group && selected.model) {
      group = modelProviderGroups.find(function (candidate) {
        return (!selected.transport || candidate.transport === selected.transport) &&
          candidate.models.some(function (model) { return model.id === selected.model; });
      });
    }
    if (!group && selected.model) {
      group = modelProviderGroups.find(function (candidate) {
        return candidate.models.some(function (model) { return model.id === selected.model; });
      });
    }
    return group || null;
  }

  function findSelectedModel(selection) {
    const group = findProviderGroup(selection);
    if (!group) return { group: null, model: null };
    return {
      group: group,
      model: group.models.find(function (model) { return model.id === selection.model; }) || null
    };
  }

  function syncHiddenModelSelect(role) {
    const select = role === 'coder' ? elCoderSelect : elModelSelect;
    if (!select) return;
    const selection = modelSelections[role];
    if (!selection.model) {
      select.value = '';
      select.classList.remove('coder-active');
      return;
    }
    const composite = (selection.transport || '') + '::' + selection.model;
    let option = Array.from(select.options).find(function (candidate) {
      return candidate.dataset && candidate.dataset.model === selection.model &&
        (!selection.group || candidate.dataset.group === selection.group);
    });
    if (!option) {
      option = document.createElement('option');
      option.value = composite;
      option.dataset.model = selection.model;
      option.dataset.provider = selection.transport;
      option.dataset.group = selection.group;
      option.textContent = selection.model;
      select.appendChild(option);
    }
    option.selected = true;
    if (role === 'coder') select.classList.add('coder-active');
  }

  function populateHiddenModelSelects() {
    [
      { role: 'director', select: elModelSelect, off: false },
      { role: 'coder', select: elCoderSelect, off: true }
    ].forEach(function (entry) {
      if (!entry.select) return;
      entry.select.innerHTML = '';
      if (entry.off) {
        const off = document.createElement('option');
        off.value = '';
        off.textContent = 'Coder: Disattivato';
        entry.select.appendChild(off);
      }
      modelProviderGroups.forEach(function (group) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = group.name;
        group.models.forEach(function (model) {
          const option = document.createElement('option');
          option.value = model.transport + '::' + model.id;
          option.dataset.model = model.id;
          option.dataset.provider = model.transport;
          option.dataset.group = group.id;
          option.textContent = model.name || model.id;
          optgroup.appendChild(option);
        });
        entry.select.appendChild(optgroup);
      });
      syncHiddenModelSelect(entry.role);
    });
  }

  function shortModelName(model) {
    const value = String(model || '').trim();
    if (!value) return '';
    const parts = value.split('/');
    return parts[parts.length - 1] || value;
  }

  function updateModelRoleButtons() {
    const director = findSelectedModel(modelSelections.director);
    const coder = findSelectedModel(modelSelections.coder);
    if (elDirectorModelLabel) {
      elDirectorModelLabel.textContent = (director.model && director.model.name) || shortModelName(modelSelections.director.model) || 'Seleziona modello';
      elDirectorModelLabel.title = modelSelections.director.model || '';
    }
    if (elDirectorProviderLabel) elDirectorProviderLabel.textContent = (director.group && director.group.name) || modelSelections.director.transport || '—';
    if (elCoderModelLabel) {
      elCoderModelLabel.textContent = modelSelections.coder.model
        ? ((coder.model && coder.model.name) || shortModelName(modelSelections.coder.model))
        : 'Disattivato';
      elCoderModelLabel.title = modelSelections.coder.model || '';
    }
    if (elCoderProviderLabel) elCoderProviderLabel.textContent = modelSelections.coder.model
      ? ((coder.group && coder.group.name) || modelSelections.coder.transport || '—')
      : 'Nessun modello';
    if (elCoderTrigger) elCoderTrigger.classList.toggle('has-model', !!modelSelections.coder.model);
  }

  function providerState(group) {
    const status = group && group.status;
    if (!status) return { kind: 'unknown', label: 'Stato non verificato' };
    if (status.creditsExhausted) return { kind: 'warning', label: 'Crediti esauriti' };
    if (status.reachable === false) return { kind: 'offline', label: status.error || 'Non raggiungibile' };
    if (status.reachable === true) return { kind: 'online', label: group.source === 'local' ? 'Locale e disponibile' : 'Disponibile' };
    if (status.configured === false) return { kind: 'idle', label: 'Chiave non configurata' };
    return { kind: 'unknown', label: 'Stato non verificato' };
  }

  function renderProviderDock() {
    if (!elProviderDock) return;
    elProviderDock.innerHTML = '';
    modelProviderGroups.forEach(function (group) {
      const state = providerState(group);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'model-provider-button state-' + state.kind;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(group.id === activeProviderGroup));
      button.dataset.providerGroup = group.id;
      button.title = state.label;

      const dot = document.createElement('span');
      dot.className = 'model-provider-status';
      dot.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.className = 'model-provider-name';
      label.textContent = group.name;
      const count = document.createElement('span');
      count.className = 'model-provider-count';
      count.textContent = String(group.models.length);
      button.append(dot, label, count);
      button.addEventListener('click', function () {
        activeProviderGroup = group.id;
        renderProviderDock();
        renderModelPickerList();
      });
      elProviderDock.appendChild(button);
    });
  }

  function modelBadge(model) {
    if (model.costBadge) return String(model.costBadge).replace(/^\[|\]$/g, '');
    if (model.isFree) return 'GRATIS';
    if (model.promptPriceM || model.completionPriceM) return 'A CREDITI';
    return '';
  }

  function renderModelPickerList() {
    if (!elModelPickerList) return;
    const group = modelProviderGroups.find(function (candidate) { return candidate.id === activeProviderGroup; });
    const query = String(elFilterInput && elFilterInput.value || '').trim().toLowerCase();
    elModelPickerList.innerHTML = '';

    if (activeModelRole === 'coder') {
      const off = document.createElement('button');
      off.type = 'button';
      off.className = 'model-option model-option-off' + (!modelSelections.coder.model ? ' is-selected' : '');
      off.setAttribute('role', 'option');
      off.setAttribute('aria-selected', String(!modelSelections.coder.model));
      const offTitle = document.createElement('span');
      offTitle.className = 'model-option-name';
      offTitle.textContent = 'Disattiva Coder';
      const offMeta = document.createElement('span');
      offMeta.className = 'model-option-id';
      offMeta.textContent = 'Le correzioni automatiche restano al Direttore';
      off.append(offTitle, offMeta);
      off.addEventListener('click', function () { chooseModelForRole(null, null); });
      elModelPickerList.appendChild(off);
    }

    if (!group) {
      const empty = document.createElement('p');
      empty.className = 'model-picker-empty';
      empty.textContent = 'Nessun provider disponibile.';
      elModelPickerList.appendChild(empty);
      if (elProviderSummary) elProviderSummary.textContent = 'Nessun catalogo modelli caricato';
      return;
    }

    const state = providerState(group);
    if (elProviderSummary) {
      elProviderSummary.className = 'model-provider-summary state-' + state.kind;
      elProviderSummary.textContent = group.name + ' · ' + group.models.length + ' modelli · ' + state.label;
    }
    const models = group.models.filter(function (model) {
      return !query || (String(model.name || '') + ' ' + String(model.id || '') + ' ' + String(model.description || '')).toLowerCase().includes(query);
    });

    models.forEach(function (model) {
      const current = modelSelections[activeModelRole];
      const selected = current.model === model.id && (!current.group || current.group === group.id);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'model-option' + (selected ? ' is-selected' : '');
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(selected));
      button.dataset.modelId = model.id;

      const copy = document.createElement('span');
      copy.className = 'model-option-copy';
      const name = document.createElement('span');
      name.className = 'model-option-name';
      name.textContent = model.name || model.id;
      const id = document.createElement('span');
      id.className = 'model-option-id';
      id.textContent = model.id;
      copy.append(name, id);
      button.appendChild(copy);

      const badgeText = modelBadge(model);
      if (badgeText) {
        const badge = document.createElement('span');
        badge.className = 'model-option-badge' + (model.isFree ? ' is-free' : '');
        badge.textContent = badgeText;
        button.appendChild(badge);
      }
      const check = document.createElement('span');
      check.className = 'model-option-check';
      check.setAttribute('aria-hidden', 'true');
      check.textContent = selected ? '✓' : '›';
      button.appendChild(check);
      button.addEventListener('click', function () { chooseModelForRole(group, model); });
      elModelPickerList.appendChild(button);
    });

    if (!models.length) {
      const empty = document.createElement('p');
      empty.className = 'model-picker-empty';
      empty.textContent = query ? 'Nessun modello di questo provider corrisponde alla ricerca.' : 'Questo provider non ha modelli disponibili.';
      elModelPickerList.appendChild(empty);
    }
  }

  async function chooseModelForRole(group, model) {
    if (elModelPickerPanel && elModelPickerPanel.classList.contains('is-saving')) return;
    if (elModelPickerPanel) elModelPickerPanel.classList.add('is-saving');
    if (elModelPickerFeedback) elModelPickerFeedback.textContent = 'Salvataggio selezione…';
    const role = activeModelRole;
    const selection = model ? { model: model.id, transport: model.transport || group.transport, group: group.id } : { model: '', transport: '', group: '' };
    const payload = role === 'director'
      ? { model: selection.model, provider: selection.transport, modelTransport: selection.transport, modelGroup: selection.group }
      : { coderModel: selection.model, coderProvider: selection.transport, coderGroup: selection.group };
    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(function () { return {}; });
      if (!response.ok || data.success === false) throw new Error(data.error || ('HTTP ' + response.status));
      modelSelections[role] = selection;
      syncHiddenModelSelect(role);
      updateModelRoleButtons();
      closeModelPicker(true);
    } catch (error) {
      if (elModelPickerFeedback) elModelPickerFeedback.textContent = 'Selezione non salvata: ' + error.message;
    } finally {
      if (elModelPickerPanel) elModelPickerPanel.classList.remove('is-saving');
    }
  }

  function openModelPicker(role) {
    if (!modelProviderGroups.length || !elModelPickerPanel) return;
    activeModelRole = role === 'coder' ? 'coder' : 'director';
    const selectedGroup = findProviderGroup(modelSelections[activeModelRole]);
    activeProviderGroup = selectedGroup ? selectedGroup.id : (modelProviderGroups[0] && modelProviderGroups[0].id || '');
    if (elModelPickerTitle) elModelPickerTitle.textContent = activeModelRole === 'coder' ? 'Scegli il Coder' : 'Scegli il Direttore';
    if (elModelPickerEyebrow) elModelPickerEyebrow.textContent = activeModelRole === 'coder' ? 'Correzioni automatiche' : 'Modello principale';
    if (elFilterInput) elFilterInput.value = '';
    if (elModelPickerFeedback) elModelPickerFeedback.textContent = '';
    renderProviderDock();
    renderModelPickerList();
    elModelPickerPanel.hidden = false;
    modelPickerOpen = true;
    if (elDirectorTrigger) elDirectorTrigger.setAttribute('aria-expanded', String(activeModelRole === 'director'));
    if (elCoderTrigger) elCoderTrigger.setAttribute('aria-expanded', String(activeModelRole === 'coder'));
    requestAnimationFrame(function () { if (elFilterInput) elFilterInput.focus(); });
  }

  function closeModelPicker(returnFocus) {
    if (!elModelPickerPanel || !modelPickerOpen) return;
    elModelPickerPanel.hidden = true;
    modelPickerOpen = false;
    if (elDirectorTrigger) elDirectorTrigger.setAttribute('aria-expanded', 'false');
    if (elCoderTrigger) elCoderTrigger.setAttribute('aria-expanded', 'false');
    if (returnFocus) {
      const trigger = activeModelRole === 'coder' ? elCoderTrigger : elDirectorTrigger;
      if (trigger) trigger.focus();
    }
  }

  function populateVisionModels(data) {
    if (!elVisionSelect) return;
    const previous = elVisionSelect.value;
    elVisionSelect.innerHTML = '';
    const automatic = document.createElement('option');
    automatic.value = '';
    automatic.textContent = 'Vision: Automatico';
    elVisionSelect.appendChild(automatic);
    const visionPattern = /(vision|omni|(?:^|[\s/_-])vl(?:[\s/:._-]|$)|gpt-4o|gpt-4\.1|gpt-5|gemini|claude|pixtral|llava|moondream|bakllava|internvl|minicpm|idefics)/i;
    modelProviderGroups.filter(function (group) { return group.transport !== 'fcc'; }).forEach(function (group) {
      const models = group.models.filter(function (model) {
        const declared = Array.isArray(model.inputModalities) ? model.inputModalities.join(' ') : '';
        return /image|vision/i.test(declared) || visionPattern.test(String(model.id || '') + ' ' + String(model.name || ''));
      });
      if (!models.length) return;
      const optgroup = document.createElement('optgroup');
      optgroup.label = group.name;
      models.forEach(function (model) {
        const option = document.createElement('option');
        option.value = group.transport + '::' + model.id;
        option.dataset.model = model.id;
        option.dataset.provider = group.transport;
        option.textContent = 'Vision: ' + (model.name || model.id);
        optgroup.appendChild(option);
      });
      elVisionSelect.appendChild(optgroup);
    });
    impostaVisioneSelezionata(previous || data.currentVisionModel || '', data.resolvedVisionModel || '');
  }

  async function popolaSelettoreModelli(force) {
    try {
      const url = force ? '/api/available-models?force=1' : '/api/available-models';
      let response = await fetch(url);
      let data = await response.json();
      if (!response.ok) throw new Error(data.error || ('HTTP ' + response.status));
      modelProviderGroups = groupsFromModelPayload(data);
      modelSelections.director = {
        model: String(data.currentModel || modelSelections.director.model || '').trim(),
        transport: String(data.currentModelTransport || data.provider || modelSelections.director.transport || '').toLowerCase(),
        group: String(data.currentProviderGroup || modelSelections.director.group || '').toLowerCase()
      };
      modelSelections.coder = {
        model: String(data.currentCoderModel !== undefined ? data.currentCoderModel : modelSelections.coder.model || '').trim(),
        transport: String(data.currentCoderProvider || modelSelections.coder.transport || '').toLowerCase(),
        group: String(data.currentCoderGroup || modelSelections.coder.group || '').toLowerCase()
      };
      populateHiddenModelSelects();
      populateVisionModels(data);
      updateModelRoleButtons();
      if (data.effort) {
        if (elEffortSelect) elEffortSelect.value = data.effort;
        if (elEffortPill) elEffortPill.textContent = 'Effort: ' + data.effort;
      }
      if (elProviderPill) {
        const selected = findProviderGroup(modelSelections.director);
        elProviderPill.textContent = 'Provider: ' + (selected ? selected.name : (data.provider || 'anthropic'));
      }
      if (modelPickerOpen) {
        if (!modelProviderGroups.some(function (group) { return group.id === activeProviderGroup; })) {
          activeProviderGroup = modelProviderGroups[0] ? modelProviderGroups[0].id : '';
        }
        renderProviderDock();
        renderModelPickerList();
      }
      if (force && elModelPickerFeedback) elModelPickerFeedback.textContent = modelProviderGroups.length + ' provider aggiornati';
      return data;
    } catch (error) {
      if (elModelPickerFeedback) elModelPickerFeedback.textContent = 'Catalogo non disponibile: ' + error.message;
      console.warn('[ChatUI] Popolamento selettori modelli fallito:', error.message);
      throw error;
    }
  }

  async function init(options) {
    const opts = options || {};
    sendFn = opts.onSend;
    choiceFn = opts.onChoice;
    opts_onFilesChanged = opts.onFilesChanged;
    opts_onFileLive = opts.onFileLive;
    opts_onFileSalvato = opts.onFileSalvato;
    opts_onMemoryUpdated = opts.onMemoryUpdated;

    elScroll = document.getElementById('chat-scroll');
    elMessages = document.getElementById('chat-messages');
    elEmpty = document.getElementById('chat-empty');
    elActivity = document.getElementById('chat-activity');
    elActivityText = document.getElementById('chat-activity-text');
    elActivityTimer = document.getElementById('chat-activity-timer');
    elActivityStream = document.getElementById('chat-activity-stream');
    elInput = document.getElementById('chat-input');
    elSend = document.getElementById('btn-chat-send');
    elStop = document.getElementById('btn-chat-stop');
    elModelPill = document.getElementById('chat-model-pill');
    elModelSelect = document.getElementById('chat-model-select');
    elCoderSelect = document.getElementById('chat-coder-select');
    elVisionSelect = document.getElementById('chat-vision-select');
    elFilterInput = document.getElementById('model-filter-input');
    elBtnRefreshModels = document.getElementById('btn-refresh-models');
    elModelPickerRoot = document.getElementById('model-picker-root');
    elModelPickerPanel = document.getElementById('model-picker-panel');
    elModelPickerTitle = document.getElementById('model-picker-title');
    elModelPickerEyebrow = document.getElementById('model-picker-eyebrow');
    elModelPickerClose = document.getElementById('model-picker-close');
    elProviderDock = document.getElementById('model-provider-dock');
    elProviderSummary = document.getElementById('model-provider-summary');
    elModelPickerList = document.getElementById('model-picker-list');
    elModelPickerFeedback = document.getElementById('model-picker-feedback');
    elDirectorTrigger = document.getElementById('director-model-trigger');
    elCoderTrigger = document.getElementById('coder-model-trigger');
    elDirectorModelLabel = document.getElementById('director-model-label');
    elDirectorProviderLabel = document.getElementById('director-provider-label');
    elCoderModelLabel = document.getElementById('coder-model-label');
    elCoderProviderLabel = document.getElementById('coder-provider-label');

    if (elFilterInput) {
      elFilterInput.addEventListener('input', function () {
        renderModelPickerList();
      });
      elFilterInput.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeModelPicker(true);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          const first = elModelPickerList && elModelPickerList.querySelector('.model-option');
          if (first) first.focus();
        }
      });
    }

    [elDirectorTrigger, elCoderTrigger].filter(Boolean).forEach(function (trigger) {
      trigger.addEventListener('click', function () {
        const role = trigger.dataset.modelRole || 'director';
        if (modelPickerOpen && activeModelRole === role) closeModelPicker(false);
        else openModelPicker(role);
      });
    });
    if (elModelPickerClose) elModelPickerClose.addEventListener('click', function () { closeModelPicker(true); });
    document.addEventListener('pointerdown', function (event) {
      if (modelPickerOpen && elModelPickerRoot && !elModelPickerRoot.contains(event.target)) closeModelPicker(false);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && modelPickerOpen) {
        event.preventDefault();
        closeModelPicker(true);
      }
    });

    if (elBtnRefreshModels) {
      elBtnRefreshModels.addEventListener('click', async function () {
        if (elBtnRefreshModels.classList.contains('spinning')) return;
        elBtnRefreshModels.classList.add('spinning');
        elBtnRefreshModels.disabled = true;
        elBtnRefreshModels.setAttribute('aria-busy', 'true');
        elBtnRefreshModels.title = 'Aggiornamento modelli da tutti i provider...';
        try {
          await popolaSelettoreModelli(true);
        } catch (err) {
          console.error('[ChatUI] Errore refresh modelli:', err);
        } finally {
          elBtnRefreshModels.classList.remove('spinning');
          elBtnRefreshModels.disabled = false;
          elBtnRefreshModels.removeAttribute('aria-busy');
          elBtnRefreshModels.title = 'Aggiorna lista modelli da tutti i provider';
        }
      });
    }

    elPromptActionsBar = document.getElementById('chat-prompt-actions-bar');
    elPromptActionsList = document.getElementById('chat-prompt-actions-list');
    btnClosePromptActions = document.getElementById('btn-close-prompt-actions');
    if (btnClosePromptActions) {
      btnClosePromptActions.addEventListener('click', () => {
        if (elPromptActionsBar) elPromptActionsBar.hidden = true;
      });
    }
    function deduceProviderFromModel(m) {
      if (!m) return null;
      if (m.startsWith('openai:') || m.startsWith('gpt-') || m.startsWith('o1') || m.startsWith('o3')) return 'openai';
      if (m.startsWith('deepseek:') || m.startsWith('deepseek')) return 'deepseek';
      if (m.startsWith('gemini:') || m.startsWith('gemini-')) return 'gemini';
      if (m.startsWith('groq:')) return 'groq';
      if (m.startsWith('mistral:') || m.startsWith('codestral') || m.startsWith('mistral-')) return 'mistral';
      if (m.startsWith('fcc-claude') || m.startsWith('claude-') || m.startsWith('anthropic:')) return 'anthropic';
      if (m.startsWith('nvidia:') || m.startsWith('meta/') || m.startsWith('nvidia/')) return 'nvidia';
      if (m.startsWith('ashna:') || m === 'auto') return 'ashna';
      if (m.startsWith('cerebras:') || m.startsWith('llama3')) return 'cerebras';
      if (m.startsWith('openrouter:') || m.includes('/')) return 'openrouter';
      return null;
    }

    if (elModelSelect) {
      elModelSelect.addEventListener('change', async function () {
        const chosen = elModelSelect.value;
        if (!chosen) return;
        try {
          // Il valore può essere "provider::modello" (opzioni dei gruppi) oppure il solo
          // modello (opzioni di ripiego iniettate quando il modello non è in elenco).
          const sepIdx = chosen.indexOf('::');
          const model = sepIdx === -1 ? chosen : chosen.slice(sepIdx + 2);
          const provFromVal = sepIdx === -1 ? '' : chosen.slice(0, sepIdx);
          const selectedOpt = elModelSelect.selectedOptions && elModelSelect.selectedOptions[0];
          const payload = { model: model };
          // Provider: dall'opzione selezionata (o dal valore composito); deduzione dal nome
          // solo come ultimo ripiego.
          const p = (selectedOpt && selectedOpt.dataset && selectedOpt.dataset.provider) ||
            provFromVal ||
            deduceProviderFromModel(model);
          if (p) payload.provider = p;
          await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
        } catch (e) {
          console.error('[ChatUI] Errore cambio modello:', e.message);
        }
      });
      elModelSelect.addEventListener('focus', function () {
        if (elModelSelect.options.length <= 1) popolaSelettoreModelli();
      });
      elModelSelect.addEventListener('mousedown', function () {
        if (elModelSelect.options.length <= 1) popolaSelettoreModelli();
      });
    }
    if (elCoderSelect) {
      elCoderSelect.addEventListener('focus', function () {
        if (elCoderSelect.options.length <= 1) popolaSelettoreModelli();
      });
      elCoderSelect.addEventListener('mousedown', function () {
        if (elCoderSelect.options.length <= 1) popolaSelettoreModelli();
      });
      elCoderSelect.addEventListener('change', async function () {
        const chosen = elCoderSelect.value;
        // Valore composito "provider::modello": al server serve solo il nome del modello.
        const sepIdx = chosen.indexOf('::');
        const model = sepIdx === -1 ? chosen : chosen.slice(sepIdx + 2);
        if (chosen) {
          elCoderSelect.classList.add('coder-active');
        } else {
          elCoderSelect.classList.remove('coder-active');
        }
        try {
          await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ coderModel: model })
          });
        } catch (e) {
          console.error('[ChatUI] Errore cambio coder model:', e.message);
        }
      });
    }
    if (elVisionSelect) {
      elVisionSelect.addEventListener('focus', function () {
        if (elVisionSelect.options.length <= 1) popolaSelettoreModelli();
      });
      elVisionSelect.addEventListener('mousedown', function () {
        if (elVisionSelect.options.length <= 1) popolaSelettoreModelli();
      });
      elVisionSelect.addEventListener('change', async function () {
        const option = elVisionSelect.selectedOptions && elVisionSelect.selectedOptions[0];
        const selectedValue = elVisionSelect.value;
        const model = option && option.dataset ? option.dataset.model || '' : '';
        const provider = option && option.dataset ? option.dataset.provider || '' : '';
        const visionModel = model ? (provider ? provider + ':' + model : model) : '';
        elVisionSelect.classList.toggle('vision-active', !!visionModel);
        try {
          const response = await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ visionModel: visionModel })
          });
          if (!response.ok) throw new Error('HTTP ' + response.status);
          const data = await response.json();
          impostaVisioneSelezionata(visionModel, (data.config && data.config.visionModel) || '');
        } catch (e) {
          console.error('[ChatUI] Errore cambio modello Vision:', e.message);
          impostaVisioneSelezionata(selectedValue, '');
        }
      });
    }
    elProviderPill = document.getElementById('chat-provider-pill');
    elEffortPill = document.getElementById('chat-effort-pill');
    elEffortSelect = document.getElementById('chat-effort-select');
    if (elEffortSelect) {
      elEffortSelect.addEventListener('change', async function () {
        const chosen = elEffortSelect.value;
        if (!chosen) return;
        try {
          await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ effort: chosen })
          });
          const modalSelect = document.getElementById('select-effort');
          if (modalSelect) modalSelect.value = chosen;
        } catch (e) {
          console.error('[ChatUI] Errore cambio effort:', e.message);
        }
      });
    }
    elPermissionSelect = document.getElementById('chat-permission-select');
    if (elPermissionSelect) {
      // Carica il valore corrente dal server
      try {
        const statusRes = await fetch('/api/status');
        const statusData = await statusRes.json();
        if (statusData.permissionMode) {
          elPermissionSelect.value = statusData.permissionMode;
        }
      } catch (e) {}
      elPermissionSelect.addEventListener('change', async function () {
        const chosen = elPermissionSelect.value;
        if (!chosen) return;
        // Chiedi conferma per bypassPermissions — è pericoloso
        if (chosen === 'bypassPermissions') {
          const ok = confirm(
            '⚠️ Attenzione: la modalità Bypass rimuove TUTTI i controlli di autorizzazione.\n' +
            'Adam potrà eseguire file, cancellare, modificare e fare qualsiasi cosa senza chiedere conferma.\n\n' +
            'Sei sicuro di voler continuare?'
          );
          if (!ok) {
            elPermissionSelect.value = 'acceptEdits';
            return;
          }
        }
        try {
          await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ permissionMode: chosen })
          });
          // Feedback visivo: colore del select in base alla modalità
          elPermissionSelect.className = 'meta-pill select-pill perm-mode-' + chosen;
        } catch (e) {
          console.error('[ChatUI] Errore cambio permissionMode:', e.message);
        }
      });
      // Applica classe colore iniziale
      elPermissionSelect.className = 'meta-pill select-pill perm-mode-' + (elPermissionSelect.value || 'acceptEdits');
    }
    popolaSelettoreModelli();
    // Load disable coder setting
    try {
      const res = await fetch("/api/config");
      const config = await res.json();
      const disableCoderCheckbox = document.getElementById("check-disable-coder");
      if (disableCoderCheckbox) {
        disableCoderCheckbox.checked = config.disableCoder || false;
        // If disabled, set coder select to empty and disable it
        if (elCoderSelect) {
          if (disableCoderCheckbox.checked) {
            elCoderSelect.value = "";
            elCoderSelect.disabled = true;
          } else {
            elCoderSelect.disabled = false;
          }
        }
        if (elCoderTrigger) elCoderTrigger.disabled = !!disableCoderCheckbox.checked;
        // Add event listener to save setting when changed
        disableCoderCheckbox.addEventListener("change", async function () {
          const disabled = this.checked;
          try {
            await fetch("/api/config", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ disableCoder: disabled })
            });
            // Update coder select state
            if (elCoderSelect) {
              if (disabled) {
                elCoderSelect.value = "";
                elCoderSelect.disabled = true;
              } else {
                elCoderSelect.disabled = false;
              }
            }
            if (elCoderTrigger) elCoderTrigger.disabled = disabled;
            if (disabled) {
              modelSelections.coder = { model: '', transport: '', group: '' };
              updateModelRoleButtons();
              if (activeModelRole === 'coder') closeModelPicker(false);
            }
          } catch (e) {
            console.error("[ChatUI] Errore salvataggio impostazione disattiva coder:", e.message);
          }
        });
      }
    } catch (e) {
      console.error("[ChatUI] Errore caricamento impostazione disattiva coder:", e.message);
    }
    setInterval(tickProgress, 1000);

    if (!elMessages || !elInput) {
      console.error('[ChatUI] Elementi della chat non trovati nel DOM.');
      return;
    }

    elSend.addEventListener('click', submit);

    elInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    });
    elInput.addEventListener('input', autoGrow);

    elStop.addEventListener('click', () => {
      if (opts.onStop) opts.onStop();
      setBusy(false);
    });

    const btnNew = document.getElementById('btn-chat-new');
    if (btnNew) {
      btnNew.addEventListener('click', () => {
        if (opts.onNew) opts.onNew();
      });
    }
    const btnArchivio = document.getElementById('btn-chat-archivio');
    if (btnArchivio) btnArchivio.addEventListener('click', apriArchivio);
    const btnRegole = document.getElementById('btn-chat-regole');
    if (btnRegole) btnRegole.addEventListener('click', apriRegole);
    const btnSiti = document.getElementById('btn-chat-siti');
    if (btnSiti) {
      btnSiti.addEventListener('click', function () {
        if (typeof window.apriSitiConsigliati === 'function') {
          window.apriSitiConsigliati();
        }
      });
    }

    // Allegati: graffetta, incolla e trascina seguono le stesse regole.
    const btnAllega = document.getElementById('btn-chat-allega');
    const inputFile = document.getElementById('chat-file');
    if (btnAllega && inputFile) {
      btnAllega.addEventListener('click', function () { inputFile.click(); });
      inputFile.addEventListener('change', function () {
        aggiungiAllegati(inputFile.files);
        inputFile.value = '';
      });
    }
    elInput.addEventListener('paste', function (e) {
      const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
      if (files.some(function (f) { return /^image\//.test(f.type) || f.type === 'application/pdf' || ESTENSIONE_PDF.test(f.name || '') || ESTENSIONI_TESTO.test(f.name || ''); })) {
        e.preventDefault();
        aggiungiAllegati(files);
      }
    });
    [elScroll, elInput].forEach(function (zona) {
      if (!zona) return;
      zona.addEventListener('dragover', function (e) {
        if (e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') !== -1) e.preventDefault();
      });
      zona.addEventListener('drop', function (e) {
        const files = e.dataTransfer && e.dataTransfer.files;
        if (files && files.length) {
          e.preventDefault();
          aggiungiAllegati(files);
        }
      });
    });

    document.querySelectorAll('.chat-suggestions .suggestion').forEach(btn => {
      btn.addEventListener('click', () => {
        if (elInput) {
          elInput.value = btn.dataset.prompt || btn.textContent;
          autoGrow();
          elInput.focus();
        }
      });
    });

    window.addEventListener('offline', () => {
      mostraAvvisoRete({
        stato: 'offline',
        messaggio: 'Connessione Internet persa (Offline). Il modello non potrà ricevere o inviare finché non torni online.'
      });
    });

    window.addEventListener('online', () => {
      const banner = document.getElementById('chat-network-alert');
      if (banner) {
        banner.textContent = '✅ Connessione Internet ripristinata.';
        banner.style.display = 'flex';
        banner.style.background = 'rgba(46, 160, 67, 0.15)';
        banner.style.borderColor = 'rgba(46, 160, 67, 0.4)';
        banner.style.color = '#3fb950';
        setTimeout(() => { if (banner) banner.style.display = 'none'; }, 4000);
      }
      upsertMessage({
        id: 'net-online-' + Date.now(),
        role: 'system',
        level: 'info',
        blocks: [{ kind: 'text', text: '✅ Connessione Internet ripristinata: il modello è di nuovo raggiungibile.' }]
      });
    });

    setBusy(false);
    aggiornaAzioniDaServer();
  }

  const api = {
    init,
    handleEvent,
    applySnapshot,
    refreshModels: popolaSelettoreModelli,
    focus: () => { if (elInput) elInput.focus(); },
    isBusy: () => busy
  };
  window.ChatUI = api;
  return api;
})();
