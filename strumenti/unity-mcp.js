// NotExist Intelligience Studio - collega un progetto Unity a MCP for Unity.
// Il package Editor viene caricato da Unity; OpenCode usa l'endpoint HTTP locale dell'Editor.

const fs = require('fs');
const os = require('os');
const path = require('path');
const unity = require('./cervello-unity');

const PACKAGE_ID = 'com.coplaydev.unity-mcp';
const PACKAGE_URL = 'https://github.com/CoplayDev/unity-mcp.git?path=/MCPForUnity#v10.0.0';
const SERVER_BASE_NAME = 'unityMCP';
const UNITY_HTTP_URL = 'http://127.0.0.1:8080/mcp';

function endpointUnity(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname) && u.port === '8080' && u.pathname.replace(/\/$/, '') === '/mcp';
  } catch (e) { return false; }
}

function radiceProgetto(dir) {
  return unity.trovaProgettoUnity(dir || process.cwd());
}

function versioneUnity(radice) {
  try {
    const testo = fs.readFileSync(path.join(radice, 'ProjectSettings', 'ProjectVersion.txt'), 'utf8');
    const match = /m_EditorVersion:\s*(\S+)/.exec(testo);
    return match ? match[1] : null;
  } catch (e) {
    return null;
  }
}

function leggiJson(file, predefinito) {
  if (!fs.existsSync(file)) return { dati: predefinito, esiste: false };
  try {
    return { dati: JSON.parse(fs.readFileSync(file, 'utf8')), esiste: true };
  } catch (e) {
    return { errore: 'JSON non valido in ' + file + ': ' + e.message, esiste: true };
  }
}

function scriviJson(file, dati) {
  const temporaneo = file + '.tmp-' + process.pid;
  fs.writeFileSync(temporaneo, JSON.stringify(dati, null, 2) + '\n', 'utf8');
  try {
    fs.renameSync(temporaneo, file);
  } catch (e) {
    try { fs.rmSync(temporaneo, { force: true }); } catch (ignora) {}
    throw e;
  }
}

function trovaUvx() {
  const nomi = process.platform === 'win32' ? ['uvx.exe', 'uvx.cmd', 'uvx.bat', 'uvx'] : ['uvx'];
  const cartelle = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const locale = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  cartelle.push(path.join(locale, 'hermes', 'bin'));
  cartelle.push(path.join(locale, 'Microsoft', 'WinGet', 'Links'));
  cartelle.push(path.join(os.homedir(), '.local', 'bin'));
  for (const cartella of cartelle) {
    for (const nome of nomi) {
      const candidato = path.resolve(cartella, nome);
      try { if (fs.statSync(candidato).isFile()) return candidato; } catch (e) {}
    }
  }
  return null;
}

function fileManifest(radice) { return path.join(radice, 'Packages', 'manifest.json'); }
function fileLock(radice) { return path.join(radice, 'Packages', 'packages-lock.json'); }
function fileOpenCode(radice) { return path.join(radice, 'opencode.json'); }
function fileClaude(radice) { return path.join(radice, 'claude_mcp.json'); }

function aggiungiPackage(radice) {
  const file = fileManifest(radice);
  const letto = leggiJson(file, null);
  if (letto.errore) return { ok: false, errore: letto.errore };
  if (!letto.esiste || !letto.dati || typeof letto.dati !== 'object') {
    return { ok: false, errore: 'Manca Packages/manifest.json: non posso registrare MCP for Unity.' };
  }
  const manifest = letto.dati;
  if (!manifest.dependencies || typeof manifest.dependencies !== 'object' || Array.isArray(manifest.dependencies)) {
    manifest.dependencies = {};
  }
  const valore = manifest.dependencies[PACKAGE_ID];
  if (valore) return { ok: true, aggiunto: false, presente: true, versione: valore, file: file };
  manifest.dependencies[PACKAGE_ID] = PACKAGE_URL;
  try { scriviJson(file, manifest); } catch (e) { return { ok: false, errore: e.message }; }
  return { ok: true, aggiunto: true, presente: true, versione: PACKAGE_URL, file: file };
}

function serverUnityHttp() {
  return {
    type: 'remote',
    url: UNITY_HTTP_URL,
    oauth: false,
    codemode: false,
    timeout: { startup: 45000, catalog: 45000, execution: 120000 }
  };
}

function stessoServerUnity(server) {
  if (!server) return false;
  if (['remote', 'http'].includes(server.type) && endpointUnity(server.url)) return true;
  return /mcpforunityserver|mcp-for-unity/i.test(JSON.stringify([server.command, server.args]));
}

function configuraOpenCode(radice) {
  const file = fileOpenCode(radice);
  const letto = leggiJson(file, {});
  if (letto.errore) return { ok: false, errore: letto.errore };
  const config = letto.dati && typeof letto.dati === 'object' && !Array.isArray(letto.dati) ? letto.dati : {};
  if (!config.mcp || typeof config.mcp !== 'object' || Array.isArray(config.mcp)) config.mcp = {};
  if (!config.mcp.servers || typeof config.mcp.servers !== 'object' || Array.isArray(config.mcp.servers)) config.mcp.servers = {};

  let nome = SERVER_BASE_NAME;
  let suffisso = 2;
  while (config.mcp.servers[nome] && !stessoServerUnity(config.mcp.servers[nome])) {
    nome = SERVER_BASE_NAME + '-' + suffisso++;
  }
  const precedente = config.mcp.servers[nome] || {};
  const giaHttp = precedente.type === 'remote' && precedente.url === UNITY_HTTP_URL;
  const server = Object.assign({}, precedente);
  delete server.command;
  delete server.args;
  delete server.cwd;
  Object.assign(server, serverUnityHttp());
  config.mcp.servers[nome] = server;
  // Nome ufficiale condiviso con la configurazione globale del plugin: evita un
  // catalogo duplicato. Migra soltanto il vecchio nome creato dallo Studio.
  if (nome !== 'unity-mcp' && stessoServerUnity(config.mcp.servers['unity-mcp'])) delete config.mcp.servers['unity-mcp'];
  if (!config.$schema) config.$schema = 'https://opencode.ai/config.json';
  try { scriviJson(file, config); } catch (e) { return { ok: false, errore: e.message }; }
  return { ok: true, aggiunto: !giaHttp, configurato: true, nome: nome, file: file, server: server };
}

function configuraClaude(radice) {
  const file = fileClaude(radice);
  const letto = leggiJson(file, { mcpServers: {} });
  if (letto.errore) return { ok: false, errore: letto.errore };
  const config = letto.dati && typeof letto.dati === 'object' && !Array.isArray(letto.dati) ? letto.dati : { mcpServers: {} };
  if (!config.mcpServers || typeof config.mcpServers !== 'object' || Array.isArray(config.mcpServers)) config.mcpServers = {};
  const globale = leggiJson(path.join(os.homedir(), '.claude.json'), {}).dati || {};
  const chiaveProgetto = Object.keys(globale.projects || {}).find(p => path.resolve(p).toLowerCase() === path.resolve(radice).toLowerCase());
  const sorgenti = [
    (leggiJson(path.join(radice, '.mcp.json'), {}).dati || {}).mcpServers,
    chiaveProgetto && globale.projects[chiaveProgetto].mcpServers,
    globale.mcpServers
  ];
  let base = 'unityMCP';
  for (const servers of sorgenti) {
    const esistente = Object.keys(servers || {}).find(n => stessoServerUnity(servers[n]));
    if (esistente) { base = esistente; break; }
  }
  let nome = base;
  let suffisso = 2;
  while (config.mcpServers[nome] && !stessoServerUnity(config.mcpServers[nome]) &&
    !(config.mcpServers[nome].type === 'http' && config.mcpServers[nome].url === UNITY_HTTP_URL) &&
    !/mcpforunityserver|mcp-for-unity/i.test(JSON.stringify(config.mcpServers[nome].args || []))) {
    nome = base + suffisso++;
  }
  const precedente = config.mcpServers[nome] || {};
  const giaHttp = precedente.type === 'http' && precedente.url === UNITY_HTTP_URL;
  const server = Object.assign({}, precedente, { type: 'http', url: UNITY_HTTP_URL });
  delete server.command;
  delete server.args;
  delete server.env;
  config.mcpServers[nome] = server;
  for (const altro of Object.keys(config.mcpServers)) {
    if (altro !== nome && altro.toLowerCase() === nome.toLowerCase() && stessoServerUnity(config.mcpServers[altro])) delete config.mcpServers[altro];
  }
  try { scriviJson(file, config); } catch (e) { return { ok: false, errore: e.message }; }
  return { ok: true, aggiunto: !giaHttp, configurato: true, nome: nome, file: file, server: server };
}

function leggiServer(radice, engine) {
  if (!radice) return {};
  const openCode = String(engine || '').toLowerCase() === 'opencode';
  const letto = leggiJson(openCode ? fileOpenCode(radice) : fileClaude(radice), {});
  if (letto.errore || !letto.dati) return {};
  if (openCode) {
    const mcp = letto.dati.mcp || {};
    return mcp.servers && typeof mcp.servers === 'object' ? mcp.servers : {};
  }
  return letto.dati.mcpServers && typeof letto.dati.mcpServers === 'object' ? letto.dati.mcpServers : {};
}

function salvaServerOpenCode(radice, serversDaInterfaccia) {
  const file = fileOpenCode(radice);
  const letto = leggiJson(file, {});
  if (letto.errore) return { ok: false, errore: letto.errore };
  const config = letto.dati && typeof letto.dati === 'object' && !Array.isArray(letto.dati) ? letto.dati : {};
  if (!config.mcp || typeof config.mcp !== 'object' || Array.isArray(config.mcp)) config.mcp = {};
  const precedenti = config.mcp.servers && typeof config.mcp.servers === 'object' ? config.mcp.servers : {};
  const prossimi = {};
  const ricevuti = serversDaInterfaccia && typeof serversDaInterfaccia === 'object' ? serversDaInterfaccia : {};
  Object.keys(ricevuti).forEach(function (nome) {
    const inArrivo = ricevuti[nome] && typeof ricevuti[nome] === 'object' ? ricevuti[nome] : {};
    const server = Object.assign({}, precedenti[nome] || {}, inArrivo);
    if (typeof inArrivo.command === 'string') {
      server.command = [inArrivo.command].concat(Array.isArray(inArrivo.args) ? inArrivo.args : []);
      server.type = 'local';
      delete server.args;
    } else if (Array.isArray(inArrivo.command)) {
      server.type = server.type || 'local';
    }
    prossimi[nome] = server;
  });
  config.mcp.servers = prossimi;
  if (!config.$schema) config.$schema = 'https://opencode.ai/config.json';
  try { scriviJson(file, config); } catch (e) { return { ok: false, errore: e.message }; }
  return { ok: true, file: file };
}

function salvaServerClaude(radice, servers) {
  const file = fileClaude(radice);
  const letto = leggiJson(file, { mcpServers: {} });
  if (letto.errore) return { ok: false, errore: letto.errore };
  const config = letto.dati && typeof letto.dati === 'object' && !Array.isArray(letto.dati) ? letto.dati : {};
  config.mcpServers = servers && typeof servers === 'object' && !Array.isArray(servers) ? servers : {};
  try { scriviJson(file, config); } catch (e) { return { ok: false, errore: e.message }; }
  return { ok: true, file: file };
}

function stato(dir, engine) {
  const radice = radiceProgetto(dir);
  if (!radice) return { isUnity: false, engine: engine || 'claude' };
  const manifest = leggiJson(fileManifest(radice), {});
  const lock = leggiJson(fileLock(radice), {});
  const dipendenze = manifest.dati && manifest.dati.dependencies || {};
  const dipendenzeLock = lock.dati && lock.dati.dependencies || {};
  const servers = leggiServer(radice, engine);
  const server = Object.keys(servers).map(function (nome) { return { nome: nome, valore: servers[nome] }; })
    .find(function (r) {
      const cmd = r.valore && r.valore.command;
      const testo = (Array.isArray(cmd) ? cmd.join(' ') : String(cmd || '')) + ' ' + String(r.valore && r.valore.args || '');
      return (r.valore && ['remote', 'http'].includes(r.valore.type) && endpointUnity(r.valore.url)) || /mcpforunityserver|mcp-for-unity/i.test(testo);
    });
  return {
    isUnity: true,
    projectRoot: radice,
    version: versioneUnity(radice),
    engine: engine || 'claude',
    packageDependency: dipendenze[PACKAGE_ID] || null,
    packageResolved: !!dipendenzeLock[PACKAGE_ID] || fs.existsSync(path.join(radice, 'Library', 'PackageCache', PACKAGE_ID)),
    manifestValid: !manifest.errore,
    mcpConfigured: !!server,
    mcpServerName: server && server.nome,
    chatMcpConfigured: Object.values(leggiServer(radice, 'claude')).some(function (s) {
      return s && s.type === 'http' && endpointUnity(s.url);
    }),
    uvxAvailable: !!trovaUvx()
  };
}

function setup(dir, options) {
  options = options || {};
  const radice = radiceProgetto(dir);
  if (!radice) return { ok: false, errore: 'La cartella attiva non e\' un progetto Unity (mancano Assets e ProjectSettings/ProjectVersion.txt).' };
  const engine = String(options.engine || 'claude').toLowerCase();
  const uvx = options.uvxPath || trovaUvx();

  const aggiunto = aggiungiPackage(radice);
  if (!aggiunto.ok) return aggiunto;
  // La chat usa sempre Claude Code; engine seleziona solo il terminale.
  // Entrambi devono parlare allo stesso bridge HTTP dell'Editor.
  const chat = configuraClaude(radice);
  if (!chat.ok) return Object.assign({ packageAdded: aggiunto.aggiunto, projectRoot: radice }, chat);
  const client = engine === 'opencode' ? configuraOpenCode(radice) : chat;
  if (!client.ok) return Object.assign({ packageAdded: aggiunto.aggiunto, projectRoot: radice }, client);
  return {
    ok: true,
    projectRoot: radice,
    version: versioneUnity(radice),
    packageAdded: aggiunto.aggiunto,
    packageVersion: aggiunto.versione,
    packageFile: aggiunto.file,
    client: engine,
    mcpAdded: client.aggiunto,
    mcpServerName: client.nome,
    mcpConfigFile: client.file,
    chatMcpConfigFile: chat.file,
    chatMcpServerName: chat.nome,
    chatMcpConfigured: true,
    uvx: uvx,
    requiresEditorRefresh: true,
    requiresClientRestart: true,
    assetGenerationNeedsProviderKey: true
  };
}

async function diagnostica(dir, engine, options) {
  const risultato = stato(dir, engine);
  if (!risultato.isUnity) return risultato;
  const { creaClient, leggiContenuto } = require('./unity-mcp-client');
  const clientId = 'intelligience-studio-diagnostics-' + require('crypto').createHash('sha256').update(risultato.projectRoot.toLowerCase()).digest('hex').slice(0, 16);
  const client = creaClient(options && options.url || UNITY_HTTP_URL, Object.assign({ clientId }, options));
  risultato.serverReachable = false;
  risultato.projectConnected = false;
  risultato.toolCount = 0;
  risultato.tools = [];
  try {
    await client.initialize();
    risultato.serverReachable = true;
    const elenco = leggiContenuto(await client.request('resources/read', { uri: 'mcpforunity://instances' }));
    const istanze = elenco.instances || [];
    const normalizza = p => path.resolve(p).replace(/\\/g, '/').toLowerCase();
    // Controlla la radice, non soltanto il nome: due progetti possono chiamarsi uguale.
    for (const istanza of istanze) {
      await client.request('tools/call', { name: 'set_active_instance', arguments: { instance: istanza.id } });
      const progetto = leggiContenuto(await client.request('resources/read', { uri: 'mcpforunity://project/info' }));
      if (progetto.success && progetto.data && normalizza(progetto.data.projectRoot) === normalizza(risultato.projectRoot)) {
        risultato.projectConnected = true;
        risultato.instanceId = istanza.id;
        break;
      }
    }
    if (risultato.projectConnected) {
      let cursor;
      do {
        const catalogo = await client.request('tools/list', cursor ? { cursor } : {});
        risultato.tools.push(...(catalogo.tools || []).map(t => t.name));
        cursor = catalogo.nextCursor;
      } while (cursor);
      risultato.toolCount = risultato.tools.length;
    } else {
      risultato.connectionError = 'Il server risponde, ma questo progetto Unity non è collegato.';
    }
  } catch (e) {
    risultato.connectionError = risultato.serverReachable ? e.message : 'Server Unity non raggiungibile. Apri il progetto e avvia Start Server nella finestra MCP for Unity.';
  } finally {
    await client.close();
  }
  return risultato;
}

module.exports = {
  PACKAGE_ID,
  PACKAGE_URL,
  SERVER_BASE_NAME,
  UNITY_HTTP_URL,
  radiceProgetto,
  trovaUvx,
  leggiServer,
  salvaServerOpenCode,
  salvaServerClaude,
  stato,
  diagnostica,
  setup
};
