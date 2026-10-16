// NotExist Intelligience Studio - test dell'intero flusso.
// Copre: file statici, contratti di ogni endpoint, configurazione, memoria,
// verifica automatica, problemi, ricerca web, e coerenza fra config/status/prompt.
// Non richiede il modello: i test che dipendono da Adam stanno in flusso-live.test.js

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE = 'http://localhost:3456';
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    pass++;
    console.log('  PASS  ' + name);
  } else {
    fail++;
    failures.push(name + (detail ? '  -> ' + detail : ''));
    console.log('! FAIL  ' + name + (detail ? '  -> ' + detail : ''));
  }
}

function section(title) {
  console.log('\n=== ' + title + ' ===');
}

// Una POST /api/config riavvia le sessioni Claude e lo spawn puo' bloccare per un
// istante il ciclo di eventi: senza ritentare, la richiesta subito successiva fallisce
// e il test riporterebbe un guasto che non c'e'.
async function request(method, urlPath, body, tentativi) {
  const max = tentativi === undefined ? 3 : tentativi;
  for (let i = 0; i < max; i++) {
    const r = await requestOnce(method, urlPath, body);
    if (r.status !== 0) return r;
    await new Promise((res) => setTimeout(res, 700));
  }
  return await requestOnce(method, urlPath, body);
}

function requestOnce(method, urlPath, body) {
  return new Promise((resolve) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const url = new URL(BASE + urlPath);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      timeout: 60000,
      headers: payload
        ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
        : {}
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) {}
        resolve({ status: res.statusCode, json: json, raw: data });
      });
    });
    req.on('error', (e) => resolve({ status: 0, json: null, raw: String(e.message) }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, json: null, raw: 'timeout' }); });
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  // ---------------------------------------------------------------- statici
  section('File del progetto');
  ['server.js', 'package.json', 'Avvia-Studio.bat', 'Crea-Collegamento-Desktop.ps1',
   'public/index.html', 'public/app.js', 'public/chat-ui.js', 'public/neural-brain.js',
   'public/style.css'].forEach(function (f) {
    check('esiste ' + f, fs.existsSync(path.join(ROOT, f)));
  });

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  check('package.json: autore 0Not_Exist0', pkg.author === '0Not_Exist0', pkg.author);
  check('package.json: script di test presente', !!(pkg.scripts && pkg.scripts.test));

  section('Marchio');
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const appjs = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
  check('titolo pagina rinominato', html.indexOf('<title>NotExist Intelligience Studio</title>') !== -1);
  check('menzione azienda in pagina', html.indexOf('0Not_Exist0') !== -1);
  check('nessun residuo "Claude Code Graphic Studio"',
    html.indexOf('Claude Code Graphic Studio') === -1 && appjs.indexOf('Claude Code Graphic Studio') === -1);
  check('nessun residuo "Antigravity"', JSON.stringify(pkg).indexOf('Antigravity') === -1);
  // Interessa solo il testo VISIBILE: i nomi di funzione interni non li legge nessuno.
  const testoVisibile = html
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ');
  const claudeOrfani = testoVisibile.match(/Claude(?! Code)(?!-)/g) || [];
  check('nessun "Claude" isolato nel testo visibile', claudeOrfani.length === 0,
    claudeOrfani.length + ' occorrenze');
  check('nessun identificatore fuorviante sendToClaude',
    appjs.indexOf('sendToClaude') === -1);

  section('Funzioni del frontend definite');
  ['initChat', 'initViewSwitch', 'initMcp', 'initDiagnostics', 'sendPrompt',
   'loadLocalModelOptions', 'runDiagnostics'].forEach(function (fn) {
    check('app.js definisce ' + fn, new RegExp('function\\s+' + fn + '\\s*\\(').test(appjs));
  });
  const chatui = fs.readFileSync(path.join(ROOT, 'public/chat-ui.js'), 'utf8');
  check('chat-ui.js espone ChatUI', chatui.indexOf('const ChatUI') !== -1);
  check('chat-ui.js etichetta Adam', chatui.indexOf("'Adam'") !== -1);

  // ---------------------------------------------------------------- server
  section('Server raggiungibile');
  // Igiene: la suite deve partire da uno stato pulito. Problemi reali lasciati da
  // un'analisi precedente farebbero fallire il controllo sulla diagnostica, che
  // segnalerebbe correttamente qualcosa che pero' non riguarda questa esecuzione.
  await request('POST', '/api/issues/clear', { all: true });
  const status = await request('GET', '/api/status');
  check('GET /api/status risponde 200', status.status === 200, 'status ' + status.status);
  if (status.status !== 200) {
    console.log('\nServer non raggiungibile: avvialo con "node server.js" e riesegui.');
    process.exit(1);
  }
  // Il terminale puo' risultare momentaneamente spento subito dopo un riavvio di
  // configurazione: si attende qualche secondo prima di dichiararlo guasto.
  let st = status.json;
  for (let attesa = 0; attesa < 5 && (!st.running || !st.chatRunning); attesa++) {
    await new Promise((res) => setTimeout(res, 1000));
    const riprova = await request('GET', '/api/status');
    if (riprova.status === 200 && riprova.json) st = riprova.json;
  }
  check('status: CLI trovata', st.installed === true);
  check('status: cartella di lavoro presente', !!st.cwd);
  check('status: provider valido', ['anthropic', 'ollama', 'custom', 'nvidia', 'ashna', 'openrouter', 'cerebras', 'openai', 'deepseek', 'gemini', 'groq', 'mistral'].indexOf(st.provider) !== -1, st.provider);
  check('status: effort valido', ['low', 'medium', 'high', 'xhigh', 'max'].indexOf(st.effort) !== -1, st.effort);
  check('status: sessione chat attiva', st.chatRunning === true);
  check('status: sessione terminale attiva', st.running === true);
  check('status: ripresa automatica esposta', typeof st.autoContinue === 'boolean');
  check('status: verifica automatica esposta', typeof st.autoVerify === 'boolean');

  section('Endpoint di lettura');
  const letture = [
    ['/api/shortcuts', (j) => Array.isArray(j)],
    ['/api/projects', (j) => Array.isArray(j.projects) || Array.isArray(j)],
    ['/api/memory', (j) => !!j],
    ['/api/mcp', (j) => !!j && typeof j.mcpServers === 'object'],
    ['/api/network-info', (j) => !!j],
    ['/api/chat', (j) => Array.isArray(j.messages)],
    ['/api/issues', (j) => Array.isArray(j.issues)],
    ['/api/local-models', (j) => typeof j.available === 'boolean'],
    ['/api/diagnostics', (j) => Array.isArray(j.checks)]
  ];
  for (const [ep, valida] of letture) {
    const r = await request('GET', ep);
    check('GET ' + ep, r.status === 200 && r.json && valida(r.json),
      'status ' + r.status);
  }

  const files = await request('GET', '/api/files?dir=' + encodeURIComponent(st.cwd));
  check('GET /api/files elenca la cartella', files.status === 200 && !!files.json);

  section('Diagnostica');
  const diag = (await request('GET', '/api/diagnostics')).json;
  const attesi = ['cli', 'cwd', 'provider', 'baseurl', 'memory', 'issues', 'sessions'];
  attesi.forEach(function (id) {
    check('diagnostica contiene "' + id + '"', diag.checks.some((c) => c.id === id));
  });
  const rotti = diag.checks.filter((c) => !c.ok && c.severity !== 'warn');
  check('nessun controllo in errore', rotti.length === 0,
    rotti.map((c) => c.label).join(', '));
  check('ogni controllo fallito propone una soluzione',
    diag.checks.filter((c) => !c.ok).every((c) => !!c.fix));

  section('Configurazione: andata e ritorno');
  const originale = {
    effort: st.effort, provider: st.provider, model: st.model,
    baseUrl: st.baseUrl || '', customBaseUrl: st.customBaseUrl || '',
    autoContinue: st.autoContinue, autoVerify: st.autoVerify,
    projectTestCommand: st.projectTestCommand || ''
  };

  for (const livello of ['low', 'max', 'high']) {
    const r = await request('POST', '/api/config', { effort: livello });
    check('config: effort -> ' + livello,
      r.status === 200 && r.json.config.effort === livello,
      r.json && r.json.config && r.json.config.effort);
  }
  const rifiutato = await request('POST', '/api/config', { effort: 'inventato' });
  const dopo = (await request('GET', '/api/status')).json;
  check('config: effort non valido viene ignorato',
    rifiutato.status === 200 && dopo.effort === 'high', dopo.effort);

  const bad = await request('POST', '/api/config', { provider: 'inesistente' });
  const dopo2 = (await request('GET', '/api/status')).json;
  check('config: provider non valido viene ignorato',
    dopo2.provider === originale.provider, dopo2.provider);

  section('Base URL: protezione contro l\'auto-riferimento');
  await request('POST', '/api/config', { baseUrl: 'http://localhost:3456' });
  const autoRef = (await request('GET', '/api/diagnostics')).json;
  const checkBase = autoRef.checks.find((c) => c.id === 'baseurl');
  check('base URL che punta alla UI viene rifiutato', checkBase && checkBase.ok === false,
    checkBase && checkBase.detail);
  await request('POST', '/api/config', { baseUrl: 'http://localhost:11434' });
  const ripristino = (await request('GET', '/api/diagnostics')).json;
  check('base URL valido riaccettato',
    ripristino.checks.find((c) => c.id === 'baseurl').ok === true);

  section('Memoria');
  const etichetta = 'TEST-AUTO-' + Date.now();
  const salva = await request('POST', '/api/memory/node', {
    scope: 'project', type: 'data', label: etichetta,
    value: 'valore di prova', tags: ['test-automatico']
  });
  check('POST /api/memory/node salva', salva.status === 200 && salva.json.success === true);
  const grafo = (await request('GET', '/api/memory')).json;
  const nodi = (grafo.graph || grafo).nodes || [];
  const salvato = nodi.find((n) => n.label === etichetta);
  check('il nodo compare nel grafo', !!salvato);

  // Il prompt di sistema viene riscritto a ogni riavvio delle sessioni
  await new Promise((r) => setTimeout(r, 4000));
  const promptFiles = fs.readdirSync(os.tmpdir())
    .filter((f) => f.indexOf('adam-system-prompt-') === 0)
    .map((f) => path.join(os.tmpdir(), f));
  const contenutoPrompt = promptFiles.map((f) => {
    try { return fs.readFileSync(f, 'utf8'); } catch (e) { return ''; }
  }).join('\n');
  check('il prompt di sistema contiene l\'identita Adam',
    contenutoPrompt.indexOf('Ti chiami Adam') !== -1);
  check('il prompt di sistema contiene la memoria appena salvata',
    contenutoPrompt.indexOf(etichetta) !== -1);
  check('il prompt di sistema contiene l\'istruzione di effort',
    /ragiona|rispondi in modo diretto/i.test(contenutoPrompt));

  if (salvato) {
    const del = await request('DELETE', '/api/memory/node/' + encodeURIComponent(salvato.id));
    check('DELETE /api/memory/node rimuove il nodo', del.status === 200);
    const dopoDel = (await request('GET', '/api/memory')).json;
    const restano = ((dopoDel.graph || dopoDel).nodes || []).filter((n) => n.label === etichetta);
    check('il nodo e sparito dal grafo', restano.length === 0);
  }

  section('Verifica automatica');
  const fileRotto = path.join(st.cwd, '__test_rotto__.py');
  fs.writeFileSync(fileRotto, 'def x(\n  return 1\n', 'utf8');
  const ver = await request('POST', '/api/verify', { files: [fileRotto] });
  check('POST /api/verify risponde', ver.status === 200);
  const problema = (ver.json.issues || []).find((i) => i.file.indexOf('__test_rotto__') !== -1);
  check('errore di sintassi Python rilevato', !!problema,
    JSON.stringify((ver.json.issues || []).map((i) => i.file)));
  check('l\'errore riporta il messaggio del compilatore',
    problema && /SyntaxError|invalid syntax|was never closed/i.test(problema.error),
    problema && problema.error.slice(0, 80));
  check('il problema risulta aperto', problema && problema.resolved === false);

  // Ora lo correggo io e verifico che venga marcato risolto
  fs.writeFileSync(fileRotto, 'def x():\n    return 1\n', 'utf8');
  const ver2 = await request('POST', '/api/verify', { files: [fileRotto] });
  const risolto = (ver2.json.issues || []).find((i) => i.file.indexOf('__test_rotto__') !== -1);
  check('dopo la correzione il problema e marcato risolto',
    risolto && risolto.resolved === true);

  const fileJson = path.join(st.cwd, '__test_rotto__.json');
  fs.writeFileSync(fileJson, '{"a": 1,,}', 'utf8');
  const verJson = await request('POST', '/api/verify', { files: [fileJson] });
  check('JSON non valido rilevato',
    (verJson.json.issues || []).some((i) => i.file.indexOf('__test_rotto__.json') !== -1 && !i.resolved));

  const fileJs = path.join(st.cwd, '__test_rotto__.js');
  fs.writeFileSync(fileJs, 'function ( { rotto\n', 'utf8');
  const verJs = await request('POST', '/api/verify', { files: [fileJs] });
  check('JavaScript non valido rilevato',
    (verJs.json.issues || []).some((i) => i.file.indexOf('__test_rotto__.js') !== -1 && !i.resolved));

  [fileRotto, fileJson, fileJs].forEach(function (f) {
    try { fs.unlinkSync(f); } catch (e) {}
  });
  try { fs.rmSync(path.join(st.cwd, '__pycache__'), { recursive: true, force: true }); } catch (e) {}
  await request('POST', '/api/issues/clear', { all: true });
  const puliti = (await request('GET', '/api/issues')).json;
  check('registro problemi svuotabile', puliti.issues.length === 0);

  section('Progetti');
  const nomeProj = 'TEST-PROJ-' + Date.now();
  const creaProj = await request('POST', '/api/projects', { name: nomeProj, path: ROOT });
  check('POST /api/projects crea', creaProj.status === 200);
  const listaProj = (await request('GET', '/api/projects')).json;
  const arr = listaProj.projects || listaProj;
  const creato = arr.find((p) => p.name === nomeProj);
  check('il progetto compare in elenco', !!creato);
  if (creato) {
    const delProj = await request('DELETE', '/api/projects/' + encodeURIComponent(creato.id));
    check('DELETE /api/projects rimuove', delProj.status === 200);
  }

  section('MCP');
  const mcp = await request('GET', '/api/mcp');
  check('GET /api/mcp restituisce mcpServers', mcp.json && typeof mcp.json.mcpServers === 'object');

  section('Ricerca web');
  const cerca = await request('POST', '/api/web-search', { query: 'ollama' });
  check('POST /api/web-search trova risultati',
    cerca.status === 200 && Array.isArray(cerca.json.results) && cerca.json.results.length > 0,
    cerca.json && (cerca.json.error || (cerca.json.results || []).length));

  section('Revisore e collaudi');
  const collaudi = await request('GET', '/api/collaudi');
  check('GET /api/collaudi risponde', collaudi.status === 200 && Array.isArray(collaudi.json.pagine),
    'status ' + collaudi.status);
  check('dice se il revisore e\' disponibile e perche\'', collaudi.json.revisore && typeof collaudi.json.revisore.ok === 'boolean',
    JSON.stringify(collaudi.json.revisore));
  const ritiroVuoto = await request('POST', '/api/collaudi/ritira', {});
  check('ritiro senza pagina e nomi rifiutato', ritiroVuoto.status === 400, 'status ' + ritiroVuoto.status);
  const rimettiVuoto = await request('POST', '/api/collaudi/rimetti', {});
  check('rimettere senza pagina e nomi rifiutato', rimettiVuoto.status === 400, 'status ' + rimettiVuoto.status);
  const ritiroFuori = await request('POST', '/api/collaudi/ritira', { pagina: '../../fuori.html', nomi: ['x'] });
  check('ritiro su una pagina che non e\' del progetto rifiutato', ritiroFuori.status === 404, 'status ' + ritiroFuori.status);
  const statoRev = (await request('GET', '/api/status')).json;
  check('lo stato espone il revisore', typeof statoRev.revisore === 'boolean', JSON.stringify(statoRev.revisore));
  const revSpento = await request('POST', '/api/config', { revisore: false });
  check('il revisore si spegne dalla configurazione', revSpento.status === 200 && revSpento.json.config.revisore === false,
    JSON.stringify(revSpento.json && revSpento.json.config && revSpento.json.config.revisore));
  const spiegazione = (await request('GET', '/api/collaudi')).json.revisore;
  check('spento, dice perche\' non lavora', spiegazione && spiegazione.ok === false && /spento/.test(spiegazione.motivo),
    JSON.stringify(spiegazione));
  const revAcceso = await request('POST', '/api/config', { revisore: statoRev.revisore !== false });
  check('e torna come prima', revAcceso.status === 200 && revAcceso.json.config.revisore === (statoRev.revisore !== false));

  section('Editor visivo');
  const edStato = await request('GET', '/api/editor/stato?pagina=index.html');
  check('GET /api/editor/stato risponde', edStato.status === 200 && Array.isArray(edStato.json.regole) &&
    edStato.json.file === 'studio-modifiche.css', 'status ' + edStato.status);
  const edFuori = await request('POST', '/api/editor/applica', { pagina: '../fuori.html', regole: [{ selettore: '#a', proprieta: { color: 'red' } }] });
  check('applica su una pagina fuori dal progetto = 404', edFuori.status === 404, 'status ' + edFuori.status);
  const pagineEd = (await request('GET', '/api/preview-pages')).json.pagine || [];
  if (pagineEd.length) {
    const edMale = await request('POST', '/api/editor/applica', { pagina: pagineEd[0], regole: [{ selettore: '#a', proprieta: { display: 'none' } }] });
    check('proprieta\' non ammessa rifiutata prima di toccare i file', edMale.status === 400 && /non ammessa/.test(edMale.json.error),
      JSON.stringify(edMale.json));
    const edInietta = await request('POST', '/api/editor/applica', { pagina: pagineEd[0], regole: [{ selettore: '#a', proprieta: { color: 'red; } body { display:none' } }] });
    check('valore che esce dalla dichiarazione rifiutato', edInietta.status === 400, 'status ' + edInietta.status);
  }
  const edNiente = await request('POST', '/api/editor/annulla', { pagina: 'non-esiste.html' });
  check('annulla senza nulla da annullare = 404', edNiente.status === 404, 'status ' + edNiente.status);

  section('Sonda dei flussi');
  const exFuori = await request('POST', '/api/esplora', { pagina: '../fuori.html' });
  check('esplorare una pagina fuori dal progetto = 404', exFuori.status === 404, 'status ' + exFuori.status);

  section('Regole di Adam');
  const rgStato = await request('GET', '/api/regole');
  check('GET /api/regole risponde', rgStato.status === 200 && Array.isArray(rgStato.json.regole) &&
    Array.isArray(rgStato.json.storia) && typeof rgStato.json.versione === 'number', 'status ' + rgStato.status);
  const rgLunga = await request('POST', '/api/regole/prova', { regole: [{ testo: 'x'.repeat(301) }] });
  check('regola troppo lunga rifiutata prima dell\'esame', rgLunga.status === 400 && /troppo lunga/.test(rgLunga.json.error),
    JSON.stringify(rgLunga.json));
  const rgProvaVuota = await request('POST', '/api/regole/prova', { regole: [{ testo: 'Rispondi in italiano', prova: { domanda: 'Ciao?' } }] });
  check('una prova senza "deve contenere" rifiutata', rgProvaVuota.status === 400, 'status ' + rgProvaVuota.status);
  const rgRip = await request('POST', '/api/regole/ripristina', { versione: 9999 });
  check('ripristinare una versione che non esiste = 404', rgRip.status === 404, 'status ' + rgRip.status);

  section('Sveglie di Adam');
  const svElenco = await request('GET', '/api/sveglie');
  check('GET /api/sveglie risponde', svElenco.status === 200 && Array.isArray(svElenco.json.sveglie), 'status ' + svElenco.status);
  const svMale = await request('POST', '/api/sveglie', { tra: 'tra poco', motivo: 'controlla' });
  check('durata non valida rifiutata', svMale.status === 400 && /durata non valida/.test(svMale.json.error), JSON.stringify(svMale.json));
  const svPresto = await request('POST', '/api/sveglie', { tra: '5s', motivo: 'controlla' });
  check('sveglia troppo vicina rifiutata', svPresto.status === 400, 'status ' + svPresto.status);
  const svPagina = await request('POST', '/api/sveglie', { tra: '5m', motivo: 'controlla', pagina: 'non-esiste.html', guarda: true });
  check('pagina che non c\'e\' nel progetto rifiutata', svPagina.status === 400, JSON.stringify(svPagina.json));
  const svNiente = await request('DELETE', '/api/sveglie/sv-inesistente');
  check('annullare una sveglia che non c\'e\' = 404', svNiente.status === 404, 'status ' + svNiente.status);

  section('Contesto e chat salvate');
  const arch = await request('GET', '/api/chat-archivio');
  check('GET /api/chat-archivio risponde', arch.status === 200 && Array.isArray(arch.json.chat) &&
    typeof arch.json.corrente === 'string', 'status ' + arch.status);
  check('espone la misura del contesto', arch.json.contesto && 'percento' in arch.json.contesto,
    JSON.stringify(arch.json.contesto));
  const fuoriArch = await request('GET', '/api/chat-archivio/leggi?file=' + encodeURIComponent('../../claude_ui_config.json'));
  check('non legge file fuori dall\'archivio', fuoriArch.status === 404, 'status ' + fuoriArch.status);
  const nessuna = await request('POST', '/api/chat-archivio/collega', { file: 'non-esiste.md', collegata: false });
  check('collegare una chat inesistente = 404', nessuna.status === 404, 'status ' + nessuna.status);
  const snapCtx = (await request('GET', '/api/chat')).json;
  check('lo snapshot della chat porta il contesto', snapCtx && snapCtx.contesto && 'limite' in snapCtx.contesto,
    JSON.stringify(snapCtx && snapCtx.contesto));

  section('Chat: controllo dei comandi');
  const vuoto = await request('POST', '/api/chat/send', { text: '   ' });
  check('messaggio vuoto rifiutato', vuoto.status === 400, 'status ' + vuoto.status);
  const nuova = await request('POST', '/api/chat/new');
  check('POST /api/chat/new riavvia la sessione', nuova.status === 200);
  await new Promise((r) => setTimeout(r, 2500));
  const chatDopo = (await request('GET', '/api/chat')).json;
  check('la nuova chat parte vuota', chatDopo.messages.length === 0,
    chatDopo.messages.length + ' messaggi');
  check('la sessione risulta attiva', chatDopo.running === true);
  check('lo snapshot espone il modello', !!(chatDopo.info && chatDopo.info.model));

  // ---------------------------------------------------------------- ripristino
  section('Ripristino configurazione iniziale');
  const rip = await request('POST', '/api/config', originale);
  check('configurazione ripristinata', rip.status === 200 && rip.json.config.effort === originale.effort);

  // ---------------------------------------------------------------- esito
  console.log('\n' + '='.repeat(60));
  console.log('RISULTATO: ' + pass + ' passati, ' + fail + ' falliti');
  if (failures.length) {
    console.log('\nFalliti:');
    failures.forEach((f) => console.log('  - ' + f));
  }
  console.log('='.repeat(60));
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('Errore nella suite:', e);
  process.exit(1);
});
