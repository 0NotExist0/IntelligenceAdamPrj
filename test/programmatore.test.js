// Test per strumenti/programmatore.js
// Verifica: identificazione estensioni, pulizia risposta, logica correggiFile
// Non fa chiamate HTTP reali: il layer HTTP viene simulato.
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const prog = require('../strumenti/programmatore');

let pass = 0;
let fail = 0;
function check(nome, condizione, dettaglio) {
  if (condizione) { pass++; console.log('  ok   ' + nome); }
  else { fail++; console.log('  FAIL ' + nome + (dettaglio ? '  -> ' + dettaglio : '')); }
}

// ─────────────────────────────────────────────
console.log('\n=== Identificazione file di codice ===');
// ─────────────────────────────────────────────

[
  'script.js', 'modulo.mjs', 'common.cjs',
  'app.ts', 'component.tsx', 'view.jsx',
  'main.py', 'index.html', 'style.css',
  'reset.scss', 'vars.sass', 'config.json',
  'deploy.yaml', 'notes.md', 'build.sh',
  'run.bat', 'task.ps1'
].forEach(function (f) {
  check('codice: ' + f, prog.èFileDiCodice(f));
});

[
  'immagine.png', 'foto.jpg', 'logo.svg',
  'font.woff2', 'video.mp4', 'archive.zip',
  'dati.bin', 'suono.mp3'
].forEach(function (f) {
  check('non-codice: ' + f, !prog.èFileDiCodice(f));
});

// Percorsi completi
check('percorso completo .js', prog.èFileDiCodice('C:\\Users\\pippo\\progetto\\index.js'));
check('percorso completo .png escluso', !prog.èFileDiCodice('C:\\Users\\pippo\\progetto\\logo.png'));

// ─────────────────────────────────────────────
console.log('\n=== Scrittura transazionale e confinamento ===');
// ─────────────────────────────────────────────

const dirTransazione = fs.mkdtempSync(path.join(os.tmpdir(), 'test-prog-transazione-'));
const fileTransazione = path.join(dirTransazione, 'modulo.js');
const fileFuori = path.join(os.tmpdir(), 'test-prog-fuori-' + Date.now() + '.js');
const originaleTransazione = 'function integra() { return 42; }\n';
fs.writeFileSync(fileTransazione, originaleTransazione);
fs.writeFileSync(fileFuori, originaleTransazione);

const sintassiRotta = prog.applicaCandidato(fileTransazione, 'function rotta( {\n', dirTransazione);
check('sintassi non valida rifiutata prima della sostituzione', !sintassiRotta.ok, sintassiRotta.errore);
check('dopo il rifiuto il file originale e\' intatto', fs.readFileSync(fileTransazione, 'utf8') === originaleTransazione);

const fuoriProgetto = prog.applicaCandidato(fileFuori, 'function intrusa() {}\n', dirTransazione);
check('file fuori progetto rifiutato', !fuoriProgetto.ok && /fuori/.test(fuoriProgetto.errore), fuoriProgetto.errore);
check('il file fuori progetto non viene modificato', fs.readFileSync(fileFuori, 'utf8') === originaleTransazione);

const lungoPrima = Array.from({ length: 24 }, function (_, i) {
  return 'function funzioneImportante' + i + '() { return ' + i + '; }';
}).join('\n');
fs.writeFileSync(fileTransazione, lungoPrima);
const troncato = prog.applicaCandidato(fileTransazione, 'function unica() { return true; }\n', dirTransazione);
check('riscrittura che cancella quasi tutta la struttura rifiutata', !troncato.ok && /conserva|simboli/.test(troncato.errore), troncato.errore);
check('anche dopo il troncamento rifiutato il file resta intatto', fs.readFileSync(fileTransazione, 'utf8') === lungoPrima);

const validoTransazione = prog.applicaCandidato(fileTransazione, lungoPrima + '\nfunction aggiunta() { return true; }\n', dirTransazione);
check('candidato valido applicato', validoTransazione.ok, validoTransazione.errore);
check('la sostituzione valida arriva sul file vero', fs.readFileSync(fileTransazione, 'utf8').includes('function aggiunta()'));
check('non restano candidati o backup intermedi', fs.readdirSync(dirTransazione).every(function (nome) {
  return nome.indexOf('.candidate.') === -1 && nome.indexOf('.backup') === -1;
}));
fs.rmSync(dirTransazione, { recursive: true, force: true });
fs.rmSync(fileFuori, { force: true });

// ─────────────────────────────────────────────
console.log('\n=== Identificazione modelli Cloud vs Locali ===');
// ─────────────────────────────────────────────

check('cloud: claude-3-7-sonnet-20250219', prog.isModelloCloud('claude-3-7-sonnet-20250219'));
check('cloud: claude-3-5-sonnet-20241022', prog.isModelloCloud('claude-3-5-sonnet-20241022'));
check('cloud: claude-3-5-haiku-20241022', prog.isModelloCloud('claude-3-5-haiku-20241022'));
check('cloud: gpt-4o', prog.isModelloCloud('gpt-4o'));
check('cloud: gpt-4o-mini', prog.isModelloCloud('gpt-4o-mini'));
check('cloud: o3-mini', prog.isModelloCloud('o3-mini'));
check('cloud: o1-preview', prog.isModelloCloud('o1-preview'));
check('cloud: deepseek-chat', prog.isModelloCloud('deepseek-chat'));
check('cloud: deepseek-coder', prog.isModelloCloud('deepseek-coder'));

check('locale: qwen2.5-coder:7b', !prog.isModelloCloud('qwen2.5-coder:7b'));
check('locale: qwen3.5-studio:9b', !prog.isModelloCloud('qwen3.5-studio:9b'));
check('locale: llama3:8b', !prog.isModelloCloud('llama3:8b'));
check('locale: stringa vuota', !prog.isModelloCloud(''));
check('locale: null', !prog.isModelloCloud(null));

// ─────────────────────────────────────────────
console.log('\n=== correggiFile — file non di codice ===');
// ─────────────────────────────────────────────

const tmpDir = os.tmpdir();

// File non di codice: deve restituire errore senza chiamare Ollama
const pngFalso = path.join(tmpDir, 'test_prog_logo.png');
fs.writeFileSync(pngFalso, 'fake png data');
prog.correggiFile({
  file: pngFalso,
  istruzioni: 'correggi',
  baseUrl: 'http://localhost:11434',
  modello: 'qwen2.5-coder:7b'
}).then(function (r) {
  check('png rifiutato', !r.ok);
  check('png ha messaggio errore', r.errore && r.errore.length > 0, r.errore);
  fs.unlinkSync(pngFalso);
}).catch(function (e) {
  fail++; console.log('  FAIL png rifiutato (eccezione: ' + e.message + ')');
});

// ─────────────────────────────────────────────
console.log('\n=== correggiFile — file inesistente ===');
// ─────────────────────────────────────────────

const fileInesistente = path.join(tmpDir, 'NON_ESISTE_' + Date.now() + '.js');
prog.correggiFile({
  file: fileInesistente,
  istruzioni: 'correggi',
  baseUrl: 'http://127.0.0.1:1',
  modello: 'qwen2.5-coder:7b',
  timeoutMs: 1000
}).then(function (r) {
  // Il file non esiste ma non è un errore fatale: viene trattato come file vuoto
  // (il Coder può creare il contenuto da zero); l'errore viene dalla risposta vuota.
  // Questo test verifica solo che non esploda.
  check('file inesistente non crasha', r !== null && typeof r === 'object');
  try { fs.rmSync(fileInesistente, { force: true }); } catch (e) {}
}).catch(function (e) {
  fail++; console.log('  FAIL file inesistente non crasha (eccezione: ' + e.message + ')');
  try { fs.rmSync(fileInesistente, { force: true }); } catch (e2) {}
});

// ─────────────────────────────────────────────
console.log('\n=== correggiFile — percorso vuoto ===');
// ─────────────────────────────────────────────

prog.correggiFile({
  file: '',
  istruzioni: 'correggi',
  baseUrl: 'http://localhost:11434',
  modello: 'qwen2.5-coder:7b'
}).then(function (r) {
  check('percorso vuoto rifiutato', !r.ok);
  check('percorso vuoto ha errore', typeof r.errore === 'string' && r.errore.length > 0, r.errore);
}).catch(function (e) {
  fail++; console.log('  FAIL percorso vuoto rifiutato (eccezione: ' + e.message + ')');
});

// ─────────────────────────────────────────────
console.log('\n=== correggiFiles — lista mista ===');
// ─────────────────────────────────────────────

const jsTemp  = path.join(tmpDir, 'test_prog_' + Date.now() + '.js');
const pngTemp = path.join(tmpDir, 'test_prog_' + Date.now() + '.png');
fs.writeFileSync(jsTemp,  'function ok() {}');
fs.writeFileSync(pngTemp, 'fake png');

// Serve un server HTTP finto per non fare chiamate vere.
// Qui testiamo solo che la funzione rispetti l'ordine e non crashe.
// Con un baseUrl non raggiungibile, entrambi i file torneranno errore (timeout/connreset),
// ma la struttura della risposta deve essere corretta.
const http = require('http');
let mockServer = null;
let mockPort   = 0;

// Avvia un server mock che risponde sempre con il contenuto del file invariato
function avviaMockOllama(callback) {
  mockServer = http.createServer(function (req, res) {
    let body = '';
    req.on('data', function (c) { body += c; });
    req.on('end', function () {
      let parsed;
      try { parsed = JSON.parse(body); } catch (e) { parsed = {}; }
      const messages = parsed.messages || [];
      const userMsg  = (messages.find(function (m) { return m.role === 'user'; }) || {}).content || '';
      // Estrai il contenuto del file dal prompt (tutto tra "attuale:" e "ISTRUZIONI:")
      const match = userMsg.match(/CONTENUTO ATTUALE:\r?\n([\s\S]*?)\r?\n=== ISTRUZIONI/);
      const risposta = match ? match[1] : 'function corretto() {}';

      res.writeHead(200, { 'content-type': 'application/json' });
      // Ollama usa NDJSON: ogni JSON object deve essere terminato da \n
      res.end(JSON.stringify({ message: { content: risposta }, done: true }) + '\n');
    });
  });
  mockServer.listen(0, '127.0.0.1', function () {
    mockPort = mockServer.address().port;
    callback();
  });
}

avviaMockOllama(function () {
  const baseUrlMock = 'http://127.0.0.1:' + mockPort;

  console.log('\n=== correggiFile — mock Ollama (risposta valida) ===');

  prog.correggiFile({
    file: jsTemp,
    istruzioni: 'lascia tutto com\'è per questo test',
    baseUrl: baseUrlMock,
    modello: 'mock'
  }).then(function (r) {
    check('correggiFile mock ok', r.ok, r.errore);
    check('correggiFile mock file esiste', fs.existsSync(r.file));
    check('correggiFile mock ha durataMs', typeof r.durataMs === 'number');

    console.log('\n=== correggiFiles — mock Ollama sequenziale ===');
    return prog.correggiFiles({
      files: [jsTemp],
      istruzioni: 'test sequenziale',
      baseUrl: baseUrlMock,
      modello: 'mock'
    });
  }).then(function (risultati) {
    check('correggiFiles ritorna array', Array.isArray(risultati));
    check('correggiFiles 1 elemento', risultati.length === 1);
    check('correggiFiles elemento ok', risultati[0] && risultati[0].ok, risultati[0] && risultati[0].errore);

    // png nella lista deve essere rifiutato senza crashare il ciclo
    return prog.correggiFiles({
      files: [pngTemp, jsTemp],
      istruzioni: 'misto',
      baseUrl: baseUrlMock,
      modello: 'mock'
    });
  }).then(function (risultati) {
    check('correggiFiles misto 2 elementi', risultati.length === 2);
    check('correggiFiles png rifiutato', !risultati[0].ok, risultati[0] && risultati[0].errore);
    check('correggiFiles js accettato', risultati[1].ok, risultati[1] && risultati[1].errore);

    // Cleanup
    try { fs.unlinkSync(jsTemp);  } catch (e) {}
    try { fs.unlinkSync(pngTemp); } catch (e) {}
    mockServer.close();

    // ──────────────────────────────────────────────
    console.log('\n=== Risposta con fence ``` — pulizia ===');
    // Il modulo non espone pulisciRisposta direttamente; la testiamo tramite
    // un mock che restituisce una risposta con fence.
    // ──────────────────────────────────────────────
    const jsTemp2 = path.join(tmpDir, 'test_prog_fence_' + Date.now() + '.js');
    fs.writeFileSync(jsTemp2, 'function old() {}');

    const serverFence = http.createServer(function (req, res) {
      let body = '';
      req.on('data', function (c) { body += c; });
      req.on('end', function () {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          message: { content: '```javascript\nfunction nuovo() {}\n```' },
          done: true
        }) + '\n');
      });
    });
    serverFence.listen(0, '127.0.0.1', function () {
      const porteFence = serverFence.address().port;
      prog.correggiFile({
        file: jsTemp2,
        istruzioni: 'test fence removal',
        baseUrl: 'http://127.0.0.1:' + porteFence,
        modello: 'mock'
      }).then(function (r) {
        check('fence rimossa: ok', r.ok, r.errore);
        if (r.ok) {
          const contenuto = fs.readFileSync(jsTemp2, 'utf8').trim();
          check('fence rimossa: contenuto senza backtick', !contenuto.includes('```'), contenuto);
          check('fence rimossa: funzione presente', contenuto.includes('function nuovo()'), contenuto);
        }
        try { fs.unlinkSync(jsTemp2); } catch (e) {}
        serverFence.close();

        // ──────────────────────────────────────────────
        console.log('\n=== chiediAlCoder — Mock Cloud Anthropic (Claude 3.7) ===');
        // ──────────────────────────────────────────────
        let riceveAnthropicHeaders = false;
        let riceveAnthropicBody = false;

        const serverAnthropic = http.createServer(function (req, res) {
          if (req.headers['x-api-key'] === 'ant-test-key' && req.headers['anthropic-version'] === '2023-06-01') {
            riceveAnthropicHeaders = true;
          }
          let body = '';
          req.on('data', function (c) { body += c; });
          req.on('end', function () {
            try {
              const j = JSON.parse(body);
              if (j.model === 'claude-3-7-sonnet-20250219' && Array.isArray(j.messages)) {
                riceveAnthropicBody = true;
              }
            } catch (e) {}

            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              id: 'msg_123',
              type: 'message',
              role: 'assistant',
              content: [{ type: 'text', text: 'function claudeFixed() { return true; }' }],
              usage: { input_tokens: 50, output_tokens: 20 }
            }));
          });
        });

        serverAnthropic.listen(0, '127.0.0.1', function () {
          const portAnt = serverAnthropic.address().port;
          prog.chiediAlCoder({
            modello: 'claude-3-7-sonnet-20250219',
            prompt: 'scrivi funzione claudeFixed',
            apiKey: 'ant-test-key',
            baseUrl: 'http://127.0.0.1:' + portAnt
          }).then(function (resAnt) {
            check('mock Anthropic: headers corretti (x-api-key, anthropic-version)', riceveAnthropicHeaders);
            check('mock Anthropic: body corretto (model, messages)', riceveAnthropicBody);
            check('mock Anthropic: testo estratto', resAnt.testo && resAnt.testo.includes('claudeFixed'));
            check('mock Anthropic: token conteggiati', resAnt.token === 20);
            serverAnthropic.close();

            // ──────────────────────────────────────────────
            console.log('\n=== chiediAlCoder — Mock Cloud OpenAI/DeepSeek (gpt-4o) ===');
            // ──────────────────────────────────────────────
            let riceveOpenAiHeaders = false;
            let riceveOpenAiBody = false;

            const serverOpenAi = http.createServer(function (req, res) {
              if (req.headers['authorization'] === 'Bearer openai-test-key') {
                riceveOpenAiHeaders = true;
              }
              let body = '';
              req.on('data', function (c) { body += c; });
              req.on('end', function () {
                try {
                  const j = JSON.parse(body);
                  if (j.model === 'gpt-4o' && Array.isArray(j.messages)) {
                    riceveOpenAiBody = true;
                  }
                } catch (e) {}

                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({
                  choices: [{
                    message: { role: 'assistant', content: 'function openAiFixed() { return true; }' }
                  }],
                  usage: { completion_tokens: 25 }
                }));
              });
            });

            serverOpenAi.listen(0, '127.0.0.1', function () {
              const portOai = serverOpenAi.address().port;
              prog.chiediAlCoder({
                modello: 'gpt-4o',
                prompt: 'scrivi funzione openAiFixed',
                apiKey: 'openai-test-key',
                baseUrl: 'http://127.0.0.1:' + portOai
              }).then(function (resOai) {
                check('mock OpenAI: header authorization corretto', riceveOpenAiHeaders);
                check('mock OpenAI: body corretto (model, messages)', riceveOpenAiBody);
                check('mock OpenAI: testo estratto', resOai.testo && resOai.testo.includes('openAiFixed'));
                check('mock OpenAI: token conteggiati', resOai.token === 25);
                serverOpenAi.close();

                // ──────────────── RIEPILOGO ────────────────
                setTimeout(function () {
                  console.log('\n──────────────────────────────────────────');
                  console.log('Risultato: ' + pass + ' ok, ' + fail + ' falliti');
                  if (fail > 0) process.exit(1);
                }, 100);
              });
            });
          });
        });
      });
    });
  }).catch(function (e) {
    fail++;
    console.log('  FAIL (eccezione inattesa): ' + e.message);
    try { fs.unlinkSync(jsTemp);  } catch (e2) {}
    try { fs.unlinkSync(pngTemp); } catch (e2) {}
    if (mockServer) mockServer.close();
    setTimeout(function () {
      console.log('\nRisultato: ' + pass + ' ok, ' + fail + ' falliti');
      process.exit(1);
    }, 100);
  });
});
