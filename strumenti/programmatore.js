'use strict';

// ============================================================
// PROGRAMMATORE — sub-agente specializzato nella scrittura di codice
//
// Viene invocato DOPO la verifica automatica, quando autoVerify ha trovato errori
// in file scritti da Adam (qwen3.5-studio:9b). Riceve il contenuto attuale del file
// + il testo del turno di Adam come istruzioni, e riscrive il file con un modello
// coding-ottimizzato (tipicamente qwen2.5-coder:7b).
//
// Non usa Claude Code né strumenti: fa una singola chiamata HTTP diretta a Ollama
// (/api/chat), aspetta il testo completo del file, lo scrive su disco.
//
// Architettura identica a collaudatore.js per semplicità e coerenza.
// ============================================================

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const childProcess = require('child_process');
const cambiamenti = require('./cambiamenti');

// Estensioni considerate "codice sorgente" (il Coder non tocca binari o asset).
const ESTENSIONI_CODICE = /\.(js|mjs|cjs|ts|tsx|jsx|py|html|htm|css|scss|sass|json|yaml|yml|md|sh|bat|ps1|php|rb|go|rs|java|c|cpp|h|hpp)$/i;

function èFileDiCodice(filePath) {
  return ESTENSIONI_CODICE.test(path.extname(filePath));
}

// ────────────────────────────────────────────────────────────
// PROMPT
// ────────────────────────────────────────────────────────────

function buildPrompt(nomeFile, contenutoAttuale, istruzioni, errori) {
  const parti = [
    'Sei un programmatore esperto e preciso.',
    'Il tuo compito è correggere il file qui sotto seguendo le istruzioni.',
    '',
    '⚠ REGOLE TASSATIVE:',
    '- Rispondi con IL SOLO CONTENUTO COMPLETO DEL FILE CORRETTO.',
    '- NON aggiungere spiegazioni, commenti introduttivi o markdown.',
    '- NON usare blocchi ```codice``` attorno alla risposta.',
    '- NON troncare il file: il file deve essere completo dalla prima all\'ultima riga.',
    '- Se il file non necessita modifiche, restituiscilo identico.',
    ''
  ];

  parti.push('=== FILE DA CORREGGERE: ' + nomeFile + ' ===');
  parti.push(contenutoAttuale || '(file vuoto)');
  parti.push('');

  if (errori && errori.length) {
    parti.push('=== ERRORI TROVATI DALLA VERIFICA AUTOMATICA ===');
    errori.forEach(function (e) {
      parti.push('• ' + (e.file ? path.basename(e.file) + ': ' : '') + e.error);
    });
    parti.push('');
  }

  parti.push('=== ISTRUZIONI (dal piano di Adam) ===');
  parti.push(String(istruzioni || '').slice(0, 4000)); // tronca se Adam ha scritto tanto
  parti.push('');
  parti.push('Restituisci solo il contenuto corretto del file ' + nomeFile + ':');

  return parti.join('\n');
}

// ────────────────────────────────────────────────────────────
// Identificazione modelli cloud vs locali
// ────────────────────────────────────────────────────────────

function isModelloCloud(modello) {
  const m = String(modello || '').toLowerCase();
  return m.startsWith('claude-') || m.startsWith('gpt-') || m.startsWith('o1-') || m.startsWith('o3-') || m.startsWith('deepseek-') ||
    m.includes('/') || m.includes('cerebras') || m.includes('70b') || m.includes('qwen-2.5-coder-32b');
}

// ────────────────────────────────────────────────────────────
// CHIAMATA AL CODER: Modelli Cloud (Anthropic/OpenAI) o Ollama locale
// ────────────────────────────────────────────────────────────

function chiediAlCoder(o) {
  return new Promise(function (resolve) {
    const inizio = Date.now();
    let finito = false;
    let timer = null;
    let req = null;

    const fine = function (esito) {
      if (finito) return;
      finito = true;
      clearTimeout(timer);
      resolve(Object.assign({ testo: '', durataMs: Date.now() - inizio }, esito || {}));
    };

    timer = setTimeout(function () {
      if (req && typeof req.destroy === 'function') req.destroy();
      else if (req && typeof req.kill === 'function') req.kill();
      fine({ errore: 'timeout: il Coder non ha finito entro ' + Math.round((o.timeoutMs || 300000) / 1000) + ' s' });
    }, o.timeoutMs || 300000);

    if (o.segnale) {
      o.segnale.annulla = function () {
        if (req && typeof req.destroy === 'function') req.destroy();
        else if (req && typeof req.kill === 'function') req.kill();
        fine({ errore: 'annullato' });
      };
    }

    const modello = String(o.modello || '').trim();

    // 0. CATALOGO FCC — usa il transport fcc-claude, non prova a dedurre un
    // endpoint HTTP dalla slash nello slug (es. tokenrouter/anthropic/...).
    // spawn riceve argomenti separati e il prompt via stdin: nessuna shell e
    // nessuna possibilita' di injection o limite della command line di Windows.
    if (String(o.provider || '').toLowerCase() === 'fcc') {
      const executable = String(o.executable || (process.platform === 'win32' ? 'fcc-claude.exe' : 'fcc-claude'));
      const args = ['--print', '--output-format', 'text', '--model', modello, '--permission-mode', 'plan'];
      let stdout = '';
      let stderr = '';
      try {
        req = childProcess.spawn(executable, args, {
          cwd: o.dir || process.cwd(),
          env: Object.assign({}, process.env),
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
          shell: false
        });
      } catch (error) {
        return fine({ errore: 'impossibile avviare fcc-claude: ' + error.message });
      }
      req.stdout.setEncoding('utf8');
      req.stderr.setEncoding('utf8');
      req.stdout.on('data', function (chunk) {
        stdout += chunk;
        if (o.progresso) o.progresso(stdout.length);
      });
      req.stderr.on('data', function (chunk) { stderr += chunk; });
      req.on('error', function (error) { fine({ errore: 'fcc-claude: ' + error.message }); });
      req.on('close', function (code) {
        if (code !== 0) return fine({ errore: 'fcc-claude terminato con codice ' + code + ': ' + stderr.trim().slice(0, 500) });
        fine({ testo: stdout });
      });
      req.stdin.on('error', function () {});
      req.stdin.end(String(o.prompt || ''));
      return;
    }

    // 1. MODELLI ANTHROPIC CLAUDE DIRETTI (senza proxy OpenRouter/Cerebras)
    if (modello.toLowerCase().startsWith('claude-') && !modello.includes('/') && !(o.baseUrl && (o.baseUrl.includes('openrouter') || o.baseUrl.includes('cerebras')))) {
      const apiKey = o.apiKey || process.env.ANTHROPIC_API_KEY || '';
      let urlEndpoint = 'https://api.anthropic.com/v1/messages';
      if (o.baseUrl && !o.baseUrl.includes(':11434')) {
        const cleanBase = o.baseUrl.replace(/\/+$/, '');
        urlEndpoint = cleanBase.endsWith('/v1') ? cleanBase + '/messages' : cleanBase + '/v1/messages';
      }

      let parsedUrl;
      try { parsedUrl = new URL(urlEndpoint); } catch (e) {
        return fine({ errore: 'URL endpoint Anthropic non valido: ' + e.message });
      }

      const bodyData = JSON.stringify({
        model: modello,
        max_tokens: 8192,
        temperature: 0.1,
        messages: [{ role: 'user', content: o.prompt }]
      });

      const headers = {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(bodyData),
        'anthropic-version': '2023-06-01'
      };
      if (apiKey) headers['x-api-key'] = apiKey;
      if (o.authToken && !apiKey) headers['authorization'] = 'Bearer ' + o.authToken;

      const lib = parsedUrl.protocol === 'https:' ? https : http;
      req = lib.request(parsedUrl, {
        method: 'POST',
        headers: headers
      }, function (res) {
        let respText = '';
        res.setEncoding('utf8');
        res.on('data', function (c) { respText += c; });
        res.on('end', function () {
          if (res.statusCode !== 200) {
            let errMsg = respText.slice(0, 300);
            try {
              const j = JSON.parse(respText);
              if (j.error && j.error.message) errMsg = j.error.message;
            } catch (e) {}
            return fine({ errore: 'Anthropic API error (' + res.statusCode + '): ' + errMsg });
          }
          try {
            const j = JSON.parse(respText);
            const text = (j.content || []).map(function (b) { return b.text || ''; }).join('');
            const tokens = (j.usage && j.usage.output_tokens) || 0;
            fine({ testo: text, token: tokens });
          } catch (e) {
            fine({ errore: 'Risposta Anthropic non valida: ' + e.message });
          }
        });
      });

      req.on('error', function (e) { fine({ errore: e.message }); });
      req.write(bodyData);
      req.end();
      return;
    }

    // 2. MODELLI OPENAI / DEEPSEEK / OPENROUTER / CEREBRAS / CLOUD COMPATIBILI
    if (modello.toLowerCase().startsWith('gpt-') || modello.toLowerCase().startsWith('o1-') || modello.toLowerCase().startsWith('o3-') || modello.toLowerCase().startsWith('deepseek-') || modello.includes('/') || (o.baseUrl && (o.baseUrl.includes('openrouter') || o.baseUrl.includes('cerebras')))) {
      const apiKey = o.apiKey || (o.authToken && o.authToken !== 'ollama' ? o.authToken : '') || process.env.OPENAI_API_KEY || (modello.toLowerCase().startsWith('deepseek-') ? process.env.DEEPSEEK_API_KEY : '') || process.env.ANTHROPIC_AUTH_TOKEN || '';
      let urlEndpoint = 'https://api.openai.com/v1/chat/completions';
      if (modello.toLowerCase().startsWith('deepseek-')) {
        urlEndpoint = 'https://api.deepseek.com/chat/completions';
      }
      if (o.baseUrl && (o.baseUrl.includes('openrouter') || o.baseUrl.includes('cerebras'))) {
        const cleanBase = o.baseUrl.replace(/\/+$/, '');
        urlEndpoint = cleanBase.endsWith('/v1') ? cleanBase + '/chat/completions' : cleanBase + '/v1/chat/completions';
      } else if (modello.includes('/') || (apiKey && apiKey.startsWith('sk-or-'))) {
        urlEndpoint = 'https://openrouter.ai/api/v1/chat/completions';
      } else if (apiKey && apiKey.startsWith('csk-')) {
        urlEndpoint = 'https://api.cerebras.ai/v1/chat/completions';
      } else if (o.baseUrl && !o.baseUrl.includes(':11434')) {
        const cleanBase = o.baseUrl.replace(/\/+$/, '');
        urlEndpoint = cleanBase.endsWith('/v1') ? cleanBase + '/chat/completions' : cleanBase + '/v1/chat/completions';
      }

      let parsedUrl;
      try { parsedUrl = new URL(urlEndpoint); } catch (e) {
        return fine({ errore: 'URL endpoint cloud non valido: ' + e.message });
      }

      const bodyData = JSON.stringify({
        model: modello,
        max_tokens: 8192,
        temperature: 0.1,
        messages: [{ role: 'user', content: o.prompt }]
      });

      const headers = {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(bodyData)
      };
      if (apiKey) headers['authorization'] = 'Bearer ' + apiKey;

      const lib = parsedUrl.protocol === 'https:' ? https : http;
      req = lib.request(parsedUrl, {
        method: 'POST',
        headers: headers
      }, function (res) {
        let respText = '';
        res.setEncoding('utf8');
        res.on('data', function (c) { respText += c; });
        res.on('end', function () {
          if (res.statusCode !== 200) {
            return fine({ errore: 'Cloud API error (' + res.statusCode + '): ' + respText.slice(0, 300) });
          }
          try {
            const j = JSON.parse(respText);
            const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
            const tokens = (j.usage && j.usage.completion_tokens) || 0;
            fine({ testo: text, token: tokens });
          } catch (e) {
            fine({ errore: 'Risposta Cloud non valida: ' + e.message });
          }
        });
      });

      req.on('error', function (e) { fine({ errore: e.message }); });
      req.write(bodyData);
      req.end();
      return;
    }

    // 3. MODELLI LOCALI (OLLAMA / MOCK)
    let url;
    try {
      url = new URL(String(o.baseUrl || 'http://localhost:11434').replace(/\/+$/, '') + '/api/chat');
    } catch (e) {
      return fine({ errore: 'indirizzo del modello non valido: ' + e.message });
    }

    const richiesta = {
      model: modello,
      stream: true,
      think: false,
      options: {
        temperature: 0.1,
        num_ctx: 16384,
        num_predict: 8000
      },
      messages: [{ role: 'user', content: o.prompt }]
    };

    const corpo = JSON.stringify(richiesta);
    const lib = url.protocol === 'https:' ? https : http;
    let testo = '';
    let resto = '';

    req = lib.request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(corpo)
      }
    }, function (res) {
      res.setEncoding('utf8');
      if (res.statusCode !== 200) {
        let err = '';
        res.on('data', function (c) { err += c; });
        res.on('end', function () {
          fine({ errore: 'il Coder ha risposto ' + res.statusCode + ': ' + err.slice(0, 200) });
        });
        return;
      }
      res.on('data', function (pezzo) {
        resto += pezzo;
        let i;
        while ((i = resto.indexOf('\n')) !== -1) {
          const riga = resto.slice(0, i).trim();
          resto = resto.slice(i + 1);
          if (!riga) continue;
          let d;
          try { d = JSON.parse(riga); } catch (e) { continue; }
          if (d.error) return fine({ errore: String(d.error) });
          if (d.message && d.message.content) {
            testo += d.message.content;
            if (o.progresso) o.progresso(testo.length);
          }
          if (d.done) return fine({ testo: testo, token: d.eval_count || 0 });
        }
      });
      res.on('end', function () { fine({ testo: testo }); });
      res.on('error', function (e) { fine({ errore: e.message }); });
    });

    req.on('error', function (e) { fine({ errore: e.message }); });
    req.write(corpo);
    req.end();
  });
}

// ────────────────────────────────────────────────────────────
// PULIZIA RISPOSTA
// Il modello a volte avvolge il codice in ``` anche se glielo
// vietiamo: rimuoviamo la fence esterna se presente.
// ────────────────────────────────────────────────────────────

function pulisciRisposta(testo, nomeFile) {
  const t = testo.trim();
  // Rimuovi eventuale ```lang...``` in testa e ``` in coda
  const m = t.match(/^```[\w]*\r?\n([\s\S]*?)```\s*$/);
  if (m) return m[1];
  // Se inizia con ``` senza chiusura, rimuovi solo la prima riga
  if (t.startsWith('```')) {
    const primaNewline = t.indexOf('\n');
    if (primaNewline !== -1) return t.slice(primaNewline + 1);
  }
  return t;
}

// ────────────────────────────────────────────────────────────
// SCRITTURA TRANSAZIONALE
// Il Coder non scrive mai direttamente sul file vero. Prima produce un candidato
// nella stessa cartella, lo valida e controlla che non abbia cancellato la struttura
// del file. Solo dopo lo sostituisce, conservando una copia per il rollback.
// ────────────────────────────────────────────────────────────

function percorsoDentro(radice, filePath) {
  try {
    const root = fs.realpathSync(path.resolve(radice));
    const pieno = path.resolve(filePath);
    const genitore = fs.realpathSync(path.dirname(pieno));
    const candidato = path.join(genitore, path.basename(pieno));
    const relativo = path.relative(root, candidato);
    if (relativo === '' || (!relativo.startsWith('..' + path.sep) && relativo !== '..' && !path.isAbsolute(relativo))) {
      if (!fs.existsSync(pieno)) return true;
      const reale = fs.realpathSync(pieno);
      const relativoReale = path.relative(root, reale);
      return relativoReale === '' || (!relativoReale.startsWith('..' + path.sep) && relativoReale !== '..' && !path.isAbsolute(relativoReale));
    }
  } catch (e) {}
  return false;
}

function messaggioProcesso(esito) {
  return String((esito && (esito.stderr || esito.stdout || (esito.error && esito.error.message))) || '').trim().slice(0, 1000);
}

function validaCandidato(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  let testo;
  try { testo = fs.readFileSync(filePath, 'utf8'); } catch (e) {
    return { ok: false, errore: 'candidato non leggibile: ' + e.message };
  }
  if (testo.indexOf('\0') !== -1) return { ok: false, errore: 'il candidato contiene byte NUL' };

  if (ext === '.json') {
    try { JSON.parse(testo); } catch (e) { return { ok: false, errore: 'JSON non valido: ' + e.message }; }
  }

  if (/^\.(js|mjs|cjs)$/.test(ext)) {
    const esitoJs = childProcess.spawnSync(process.execPath, ['--check', filePath], {
      encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024
    });
    if (esitoJs.error || esitoJs.status !== 0) {
      return { ok: false, errore: 'sintassi JavaScript non valida: ' + messaggioProcesso(esitoJs) };
    }
  }

  if (ext === '.py') {
    const script = 'import ast, pathlib, sys; ast.parse(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"), filename=sys.argv[1])';
    const tentativi = process.platform === 'win32'
      ? [['python', ['-c', script, filePath]], ['py', ['-3', '-c', script, filePath]]]
      : [['python3', ['-c', script, filePath]], ['python', ['-c', script, filePath]]];
    let ultimo = null;
    let eseguito = false;
    for (const tentativo of tentativi) {
      const esitoPy = childProcess.spawnSync(tentativo[0], tentativo[1], {
        encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024
      });
      ultimo = esitoPy;
      if (esitoPy.error && esitoPy.error.code === 'ENOENT') continue;
      eseguito = true;
      if (esitoPy.error || esitoPy.status !== 0) {
        return { ok: false, errore: 'sintassi Python non valida: ' + messaggioProcesso(esitoPy) };
      }
      break;
    }
    if (!eseguito) return { ok: false, errore: 'validatore Python non disponibile: ' + messaggioProcesso(ultimo) };
  }

  return { ok: true };
}

function controllaSopravvivenza(filePath, prima, dopo) {
  const righe = String(prima || '').split(/\r?\n/).length;
  if (righe < 20) return { ok: true };
  const viva = cambiamenti.sopravvivenza(prima, dopo);
  const persi = cambiamenti.persi(path.basename(filePath), prima, dopo);
  if (viva < 0.30 || (persi.length >= 3 && viva < 0.65)) {
    return {
      ok: false,
      errore: 'candidato rifiutato: conserva solo il ' + Math.round(viva * 100) +
        '% del file precedente' + (persi.length ? '; simboli scomparsi: ' + persi.slice(0, 6).join(', ') : '')
    };
  }
  return { ok: true };
}

function applicaCandidato(filePath, nuovoContenuto, radice) {
  const pieno = path.resolve(filePath);
  const root = path.resolve(radice || path.dirname(pieno));
  if (!percorsoDentro(root, pieno)) {
    return { ok: false, errore: 'scrittura rifiutata: il file e\' fuori dalla cartella del progetto' };
  }

  let prima = '';
  let modalita = 0o600;
  const esiste = fs.existsSync(pieno);
  try {
    if (esiste) {
      prima = fs.readFileSync(pieno, 'utf8');
      modalita = fs.statSync(pieno).mode;
    }
  } catch (e) {
    return { ok: false, errore: 'impossibile preparare il file: ' + e.message };
  }

  const struttura = controllaSopravvivenza(pieno, prima, nuovoContenuto);
  if (!struttura.ok) return struttura;

  const suffisso = '.' + process.pid + '.' + Date.now() + '.' + Math.random().toString(16).slice(2);
  const ext = path.extname(pieno);
  const base = path.basename(pieno, ext);
  const candidato = path.join(path.dirname(pieno), '.' + base + suffisso + '.candidate' + ext);
  const backup = path.join(path.dirname(pieno), '.' + path.basename(pieno) + suffisso + '.backup');
  let originaleSpostato = false;
  try {
    fs.writeFileSync(candidato, nuovoContenuto, { encoding: 'utf8', mode: modalita, flag: 'wx' });
    try { fs.chmodSync(candidato, modalita); } catch (e) {}
    const valido = validaCandidato(candidato);
    if (!valido.ok) return valido;

    if (esiste) {
      fs.renameSync(pieno, backup);
      originaleSpostato = true;
    }
    fs.renameSync(candidato, pieno);
    originaleSpostato = false;
    try { if (esiste) fs.unlinkSync(backup); } catch (e) {}
    return { ok: true };
  } catch (e) {
    if (originaleSpostato) {
      try {
        if (fs.existsSync(pieno)) fs.unlinkSync(pieno);
        fs.renameSync(backup, pieno);
        originaleSpostato = false;
      } catch (ripristino) {
        return { ok: false, errore: 'scrittura fallita e rollback non riuscito: ' + ripristino.message };
      }
    }
    return { ok: false, errore: 'scrittura transazionale fallita: ' + e.message };
  } finally {
    try { if (fs.existsSync(candidato)) fs.unlinkSync(candidato); } catch (e) {}
    if (originaleSpostato) {
      try { if (fs.existsSync(backup) && !fs.existsSync(pieno)) fs.renameSync(backup, pieno); } catch (e) {}
    }
  }
}

// ────────────────────────────────────────────────────────────
// FUNZIONE PRINCIPALE: correggiFile
// opts: { file, istruzioni, errori, baseUrl, modello, timeoutMs, segnale, progresso }
// Ritorna: { ok, file, durataMs, errore }
// ────────────────────────────────────────────────────────────

function correggiFile(opts) {
  const filePath = String(opts.file || '');
  const nomeFile = path.basename(filePath);

  if (!filePath) {
    return Promise.resolve({ ok: false, file: filePath, errore: 'percorso file non specificato' });
  }
  if (!èFileDiCodice(filePath)) {
    return Promise.resolve({ ok: false, file: filePath, errore: 'estensione non supportata dal Coder' });
  }
  const radice = path.resolve(opts.dir || path.dirname(path.resolve(filePath)));
  if (!percorsoDentro(radice, filePath)) {
    return Promise.resolve({ ok: false, file: filePath, errore: 'file fuori dalla cartella del progetto' });
  }

  let contenutoAttuale = '';
  try {
    if (fs.existsSync(filePath)) {
      contenutoAttuale = fs.readFileSync(filePath, 'utf8');
    }
  } catch (e) {
    return Promise.resolve({ ok: false, file: filePath, errore: 'impossibile leggere il file: ' + e.message });
  }

  // Sicurezza: se il file è troppo lungo, la riscrittura integrale con un modello 7B
  // rischia di perdere pezzi o troncare funzioni. Lasciamo gestire ad Adam con modifiche mirate.
  const maxLunghezza = isModelloCloud(opts.modello) ? 35000 : 6000;
  if (contenutoAttuale.length > maxLunghezza) {
    return Promise.resolve({
      ok: false,
      file: filePath,
      durataMs: 0,
      errore: 'file troppo lungo (' + contenutoAttuale.length + ' caratteri) per la riscrittura integrale sicura da parte del Coder: Adam interverrà con modifiche mirate'
    });
  }

  const prompt = buildPrompt(nomeFile, contenutoAttuale, opts.istruzioni, opts.errori);

  console.log('[Coder] Riscrivendo ' + nomeFile + ' con ' + (opts.modello || '(modello non configurato)') + '...');

  return chiediAlCoder({
    baseUrl: opts.baseUrl,
    modello: opts.modello,
    apiKey: opts.apiKey,
    authToken: opts.authToken,
    provider: opts.provider,
    executable: opts.executable,
    dir: opts.dir,
    prompt: prompt,
    timeoutMs: opts.timeoutMs || 300000,
    segnale: opts.segnale,
    progresso: opts.progresso
  }).then(function (esito) {
    if (esito.errore) {
      console.error('[Coder] Errore su ' + nomeFile + ':', esito.errore);
      return { ok: false, file: filePath, durataMs: esito.durataMs, errore: esito.errore };
    }

    const nuovoContenuto = pulisciRisposta(esito.testo, nomeFile);
    if (!nuovoContenuto.trim()) {
      return {
        ok: false, file: filePath, durataMs: esito.durataMs,
        errore: 'il Coder ha restituito una risposta vuota'
      };
    }

    // Sicurezza: non sovrascrivere con qualcosa di sensibilmente più corto a meno che
    // il file originale non fosse già piccolo (il modello potrebbe aver troncato).
    const ratioLunghezza = nuovoContenuto.length / Math.max(contenutoAttuale.length, 1);
    if (contenutoAttuale.length > 200 && ratioLunghezza < 0.7) {
      return {
        ok: false, file: filePath, durataMs: esito.durataMs,
        errore: 'risposta troppo corta (' + nuovoContenuto.length + ' vs ' + contenutoAttuale.length + ' byte, rapporto ' + Math.round(ratioLunghezza * 100) + '%): probabile troncamento del Coder'
      };
    }

    const applicato = applicaCandidato(filePath, nuovoContenuto, radice);
    if (!applicato.ok) {
      return { ok: false, file: filePath, durataMs: esito.durataMs, errore: applicato.errore };
    }

    const durata = Math.round((esito.durataMs || 0) / 1000);
    console.log('[Coder] ✅ ' + nomeFile + ' riscritto in ' + durata + ' s (' + (esito.token || 0) + ' token).');
    return { ok: true, file: filePath, durataMs: esito.durataMs, token: esito.token };
  });
}

// ────────────────────────────────────────────────────────────
// Corregge più file in sequenza (non in parallelo: un modello alla volta su GPU)
// opts: { files, istruzioni, errori, baseUrl, modello, timeoutMs, segnale, progresso }
// Ritorna: Array di { ok, file, durataMs, errore }
// ────────────────────────────────────────────────────────────

async function correggiFiles(opts) {
  const files = Array.isArray(opts.files) ? opts.files : [];
  const risultati = [];
  for (const file of files) {
    const r = await correggiFile(Object.assign({}, opts, { file: file }));
    risultati.push(r);
  }
  return risultati;
}

module.exports = {
  correggiFile,
  correggiFiles,
  èFileDiCodice,
  isModelloCloud,
  chiediAlCoder,
  percorsoDentro,
  validaCandidato,
  controllaSopravvivenza,
  applicaCandidato
};
