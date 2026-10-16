const express = require('express');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const pty = require('node-pty');
const cors = require('cors');
const { analizzaProgetto, mappaCodice } = require('./analisi-progetto');
const analisiRuntime = require('./analisi-runtime');
const { sondaPagina, eseguiCollaudi, verificaStili } = require('./strumenti/sonda');
const editorVisivo = require('./strumenti/editor-visivo');
const collaudatore = require('./strumenti/collaudatore');
const programmatore = require('./strumenti/programmatore');
const istantanee = require('./strumenti/istantanee');
const cambiamenti = require('./strumenti/cambiamenti');
const guardianoLetture = require('./strumenti/guardiano-letture');
const segreti = require('./strumenti/segreti');
const schermataLeggera = require('./strumenti/schermata-leggera');
const capoProgetto = require('./strumenti/capo-progetto');
const capoFile = require('./strumenti/capo-file');
const arsenaleTest = require('./strumenti/arsenale-test');
const semgrep = require('./strumenti/semgrep');
const pertinenza = require('./strumenti/pertinenza');
const scritturaLive = require('./strumenti/scrittura-live');
const personaggio3d = require('./strumenti/personaggio');
const ripristino = require('./strumenti/ripristina');
const archivioChat = require('./strumenti/archivio-chat');
const sveglie = require('./strumenti/sveglie');
const regoleAdam = require('./strumenti/regole');
const sitiConsigliati = require('./strumenti/siti-consigliati');
const pdfAgent = require('./strumenti/pdf-agent');
const pdfRiferimento = require('./strumenti/pdf-riferimento');
const documentazione = require('./strumenti/documentazione');
const esameModello = require('./strumenti/esame');
const esploratrice = require('./strumenti/esploratrice');
const misure = require('./strumenti/confronto-misure');
const provaProgrammaPython = require('./strumenti/prova-python');
const scheletri = require('./strumenti/scheletri');
const diarioDiBordo = require('./strumenti/diario');
const modelli3d = require('./strumenti/modelli');
const textureGioco = require('./strumenti/texture');
const quadroSituazione = require('./strumenti/quadro');
const whatsappBridgeMod = require('./strumenti/whatsapp-bridge');
const cervelloComandi = require('./strumenti/cervello-comandi');
const verificaCompleta = require('./strumenti/verifica');
const esperti = require('./strumenti/esperti');
const cervelloPython = require('./strumenti/cervello-python');
const cervelloUnity = require('./strumenti/cervello-unity');
const unityMcp = require('./strumenti/unity-mcp');
const apprendimentoMemoria = require('./strumenti/apprendimento-memoria');
const suggerimentiPassi = require('./strumenti/suggerimenti-prossimi-passi');
const dialogoGuidato = require('./strumenti/dialogo-guidato');
const gptOssAgent = require('./strumenti/gpt-oss-agent');
const { createAnthropicProxyHandler, deduceProvider: proxyDeduceProvider, PROVIDER_ENDPOINTS: PROXY_ENDPOINTS } = require('./strumenti/anthropic-openai-proxy');
const routerVisione = require('./strumenti/vision-router');
const allegatiChat = require('./strumenti/allegati-chat');
const fccProxy = require('./strumenti/fcc-proxy');
const gitPushVerificato = require('./strumenti/git-push-verificato');
const { exec, execFile, spawn } = require('child_process');
require('dotenv').config();

const PORT = process.env.PORT || 3456;
const CONFIG_FILE = path.join(__dirname, 'claude_ui_config.json');
const OPENCODE_CONFIG_FILE = path.join(__dirname, 'opencode.json');
let secretStore = segreti.load();

const LAN_REQUESTED = /^(1|true|yes)$/i.test(String(process.env.STUDIO_ALLOW_LAN || ''));
const LAN_ENABLED = LAN_REQUESTED && !!String(process.env.STUDIO_API_TOKEN || '').trim();
const LISTEN_HOST = LAN_ENABLED ? (process.env.STUDIO_HOST || '0.0.0.0') : '127.0.0.1';
const STUDIO_API_TOKEN = String(process.env.STUDIO_API_TOKEN || secretStore.accessToken || '').trim();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({
  server,
  maxPayload: 24 * 1024 * 1024,
  verifyClient: function (info, done) {
    const req = info.req;
    const allowed = richiestaDiReteAutorizzata(req) && origineConsentita(req);
    done(allowed, allowed ? 101 : 403, allowed ? undefined : 'Accesso non autorizzato');
  }
});

function indirizzoLoopback(value) {
  const address = String(value || '').toLowerCase().replace(/^::ffff:/, '').replace(/^\[|\]$/g, '');
  return address === '127.0.0.1' || address === '::1' || address === 'localhost';
}

function tokenRichiesta(req) {
  const auth = String(req.headers && req.headers.authorization || '');
  if (/^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, '').trim();
  const header = String(req.headers && req.headers['x-studio-token'] || '').trim();
  if (header) return header;
  try {
    const parsed = new URL(req.url || '/', 'http://localhost');
    return String(parsed.searchParams.get('token') || '').trim();
  } catch (error) {
    return '';
  }
}

function tokenUguali(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

function richiestaInoltrataDaProxy(req) {
  const headers = req.headers || {};
  return !!(
    headers['cf-connecting-ip'] ||
    headers['cf-ray'] ||
    headers['x-forwarded-for'] ||
    headers['x-real-ip']
  );
}

function richiestaLocaleDiretta(req) {
  const remote = req.socket && req.socket.remoteAddress;
  return indirizzoLoopback(remote) && !richiestaInoltrataDaProxy(req);
}

function richiestaDiReteAutorizzata(req) {
  if (richiestaLocaleDiretta(req)) return true;
  if (!LAN_ENABLED) return false;
  return tokenUguali(tokenRichiesta(req), STUDIO_API_TOKEN);
}

function origineConsentita(req) {
  const origin = String(req.headers && req.headers.origin || '').trim();
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const requestedHost = String(req.headers.host || '').toLowerCase();
    if (!/^https?:$/.test(parsed.protocol)) return false;
    // In modalita' locale accettiamo soltanto origini che dichiarano davvero un
    // host loopback. Questo chiude il caso DNS-rebinding: un dominio esterno che
    // risolve a 127.0.0.1 non diventa automaticamente un'origine fidata.
    if (!LAN_ENABLED && !indirizzoLoopback(parsed.hostname)) return false;
    return parsed.host.toLowerCase() === requestedHost;
  } catch (error) {
    return false;
  }
}

function percorsoDentro(radice, candidato) {
  try {
    const root = fs.realpathSync(path.resolve(radice));
    const target = fs.realpathSync(path.resolve(candidato));
    const relative = path.relative(root, target);
    return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
  } catch (error) {
    return false;
  }
}

const MODELLO_NON_CHAT = /(?:^|[-_/.\s])(embed(?:ding)?|rerank(?:er)?|ranker|ocr|moderation|guard|whisper|transcri\w*|speech|tts|text-to-speech|audio|image-generation|stable-diffusion|flux)(?:$|[-_/.\s])/i;

function modelloChatCompatibile(modello) {
  const id = typeof modello === 'string' ? modello : ((modello && (modello.id || modello.name)) || '');
  return !!String(id).trim() && !MODELLO_NON_CHAT.test(String(id));
}

function filtraModelliChat(modelli) {
  return (Array.isArray(modelli) ? modelli : []).filter(modelloChatCompatibile);
}

// Initial configuration
let config = {
  apiKey: '',
  authToken: '',
  apiKeys: {
    anthropic: '',
    openrouter: '',
    nvidia: '',
    ashna: '',
    cerebras: '',
    openai: '',
    deepseek: '',
    gemini: '',
    groq: '',
    mistral: '',
    custom: ''
  },
  customBaseUrl: '',
  customEndpoints: [],
  // 'anthropic' = account/API key ufficiale, 'ollama' = modello locale, 'custom' = proxy generico
  provider: 'anthropic',
  model: '',
  visionModel: '',           // modello multimodale: descrive le immagini prima di passarle ad Adam
  baseUrl: '',
  apiTimeoutMs: 0,
  autoContinue: true,
  autoContinueMax: 8,
  // Compattazione nativa: con un modello locale Claude Code riassume la conversazione e
  // PROSEGUE nella stessa sessione invece di fermarsi quando il contesto si riempie. Verificato
  // sul campo in modalita' --print. false = torna al solo rinnovo di sessione (comportamento vecchio).
  autoCompatta: true,
  // Tetto ai token di UNA risposta. 0 = derivato dalla finestra del modello. Serve perche' Claude
  // Code riserva questo spazio dentro la finestra: senza tetto riservava 32000 token e la finestra
  // "sforava" prima ancora di generare (errore "Prompt is too long" gia' al primo turno).
  maxOutputTokens: 0,
  effort: 'high',            // quanta "intelligenza": low | medium | high | xhigh | max
  autoVerify: true,          // controlla i file toccati dopo ogni turno
  autoFixMax: 3,             // tentativi di correzione automatica per turno
  projectTestCommand: '',    // es. "npm test"; vuoto = nessun comando eseguito
  cervelloDopoOgniModifica: true, // il cervello del progetto ricontrolla tutto dopo ogni Edit/Write di Adam
  revisore: false,           // disattivato di default per evitare sovraccarico su modelli locali
  revisoreModel: '',         // vuoto = lo stesso modello di Adam, gia' in memoria
  esploratrice: false,       // disattivato di default per evitare sovraccarico su modelli locali
  coderModel: '',            // se non vuoto, attiva il router bimodale: Adam pianifica, il Coder scrive
  coderProvider: '',         // transport del Coder: evita di instradare un modello NVIDIA su OpenRouter
  coderGroup: '',            // gruppo UI di origine (es. fcc-tokenrouter), distinto dal transport
  modelTransport: '',        // transport del Direttore, mantenuto anche per i cataloghi FCC
  modelGroup: '',            // gruppo UI del Direttore
  disableCoder: false,
  permissionMode: 'acceptEdits',
  dangerouslySkipPermissions: false,
  autoAcceptFolder: true,
  flatUiMode: true,
  cwd: process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'OneDrive', 'Desktop') : process.cwd(),
  fontSize: 14,
  theme: 'dark',
  projects: [],
  recentDirs: []
};

function getKeyForProvider(prov) {
  if (!config.apiKeys) config.apiKeys = {};
  const k = config.apiKeys[prov];
  if (k && typeof k === 'string' && k.trim()) return k.trim();
  if (prov === 'anthropic' && config.apiKey && config.apiKey.trim()) return config.apiKey.trim();
  if (prov === 'nvidia' && config.authToken && config.authToken.startsWith('nvapi-')) return config.authToken.trim();
  if (prov === 'openrouter' && config.authToken && config.authToken.startsWith('sk-or-')) return config.authToken.trim();
  if (prov === 'cerebras' && config.authToken && config.authToken.startsWith('csk-')) return config.authToken.trim();
  if (prov === 'ashna' && config.authToken && (config.authToken.startsWith('cwAK') || config.provider === 'ashna')) return config.authToken.trim();
  if (prov === 'custom' && config.authToken && config.authToken !== 'ollama') return config.authToken.trim();
  if (prov === config.provider && config.authToken && config.authToken !== 'ollama') return config.authToken.trim();
  const envMap = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
    nvidia: process.env.NVIDIA_API_KEY,
    ashna: process.env.ASHNA_API_KEY,
    cerebras: process.env.CEREBRAS_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    deepseek: process.env.DEEPSEEK_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
    groq: process.env.GROQ_API_KEY,
    mistral: process.env.MISTRAL_API_KEY
  };
  return (envMap[prov] && typeof envMap[prov] === 'string') ? envMap[prov].trim() : '';
}

function modelloVisioneConfigurato() {
  return routerVisione.risolviModelloVisione(config.visionModel, config.provider, config.model);
}

function modelloCoderConfigurato() {
  return config.disableCoder ? '' : String(config.coderModel || '').trim();
}

function massimoTentativiVerifica() {
  const valore = Number(config.autoFixMax);
  return Number.isFinite(valore) && valore >= 0 ? Math.min(20, valore) : 3;
}

function addToRecentDirs(dir) {
  if (!dir) return;
  try {
    const resolved = path.resolve(dir);
    if (!Array.isArray(config.recentDirs)) {
      config.recentDirs = [];
    }
    config.recentDirs = [resolved, ...config.recentDirs.filter(d => d.toLowerCase() !== resolved.toLowerCase())].slice(0, 8);
  } catch (e) {}
}

// Load saved config if exists
if (fs.existsSync(CONFIG_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    config = { ...config, ...saved };
    if (!config.apiKeys || typeof config.apiKeys !== 'object') {
      config.apiKeys = {};
    }
    // Ensure customEndpoints is an array
    if (!Array.isArray(config.customEndpoints)) {
      config.customEndpoints = [];
    }
    // Auto-migrazione trasparente delle chiavi esistenti
    if (config.apiKey && !config.apiKeys.anthropic) config.apiKeys.anthropic = config.apiKey;
    if (config.authToken) {
      if (config.authToken.startsWith('nvapi-') && !config.apiKeys.nvidia) config.apiKeys.nvidia = config.authToken;
      else if (config.authToken.startsWith('sk-or-') && !config.apiKeys.openrouter) config.apiKeys.openrouter = config.authToken;
      else if (config.authToken.startsWith('csk-') && !config.apiKeys.cerebras) config.apiKeys.cerebras = config.authToken;
      else if ((config.authToken.startsWith('cwAK') || config.provider === 'ashna') && !config.apiKeys.ashna) config.apiKeys.ashna = config.authToken;
      else if (config.authToken !== 'ollama' && !config.apiKeys.custom) config.apiKeys.custom = config.authToken;
    }
    if (config.customBaseUrl && !config.baseUrl && config.provider === 'custom') {
      config.baseUrl = config.customBaseUrl;
    }
    // Migrazione da customBaseUrl a customEndpoints
    if (config.customBaseUrl && config.customEndpoints.length === 0) {
      config.customEndpoints.push({
        id: 'endpoint_' + Date.now(),
        name: 'Endpoint Principale',
        baseUrl: config.customBaseUrl,
        apiKey: config.apiKeys.custom || ''
      });
    }
  } catch (e) {
    console.error('Error reading config file:', e);
  }
}

// Le credenziali vengono tenute solo in memoria e nel deposito privato sotto
// LocalAppData. I vecchi file con chiavi inline vengono migrati e ripuliti al primo avvio.
config = segreti.hydrateConfig(config, secretStore);
// La modalita' bypass aggira anche i controlli nativi del motore: le vecchie
// configurazioni che la avevano attiva vengono riportate automaticamente in sicurezza.
config.dangerouslySkipPermissions = false;
if (config.model && !modelloChatCompatibile(config.model)) {
  console.warn('[Config] Modello non adatto alla chat rimosso dalla configurazione: ' + config.model);
  config.model = '';
}
normalizzaProviderConfig();
saveConfig();

// Ensure projects list is initialized with sensible defaults if empty
if (!Array.isArray(config.projects) || config.projects.length === 0) {
  const home = os.homedir();
  const desktop = path.join(home, 'OneDrive', 'Desktop');
  const desktopAlt = path.join(home, 'Desktop');
  const actualDesktop = fs.existsSync(desktop) ? desktop : (fs.existsSync(desktopAlt) ? desktopAlt : home);
  config.projects = [
    {
      id: 'proj_intelligience',
      name: 'Intelligience Studio',
      path: __dirname,
      createdAt: new Date().toISOString()
    },
    {
      id: 'proj_desktop',
      name: 'Desktop',
      path: actualDesktop,
      createdAt: new Date().toISOString()
    }
  ];
}

// Ensure CWD exists, otherwise fallback to current directory
if (!fs.existsSync(config.cwd)) {
  config.cwd = process.cwd();
}
addToRecentDirs(config.cwd);

app.use(function (req, res, next) {
  if (!origineConsentita(req)) {
    return res.status(403).json({ error: 'Origine non autorizzata' });
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use(cors({
  origin: function (origin, callback) {
    // L'origine e' gia' stata confrontata con Host dal middleware precedente.
    callback(null, origin || false);
  },
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Studio-Token']
}));
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ limit: '25mb', extended: true }));
app.get('/health', function (_req, res) {
  res.json({ ok: true, service: 'notexist-intelligience-studio' });
});
app.use('/api', function (req, res, next) {
  if (richiestaDiReteAutorizzata(req)) return next();
  res.status(401).json({ error: 'Accesso locale richiesto o token LAN non valido' });
});
app.use('/preview', function (req, res, next) {
  if (richiestaDiReteAutorizzata(req)) return next();
  res.status(401).send('Accesso locale richiesto o token LAN non valido');
});

// ==========================================
// Proxy Anthropic → OpenAI per provider non-Anthropic
// Claude Code CLI supporta solo il formato /v1/messages di Anthropic.
// Quando il provider corrente usa un formato OpenAI-compatible (Groq, Cerebras,
// NVIDIA, Gemini, DeepSeek, Mistral, OpenAI, Ashna, Custom), impostiamo
// ANTHROPIC_BASE_URL = http://localhost:PORT in modo che Claude Code invii le sue
// richieste qui. Questo handler intercetta, traduce in formato OpenAI Chat
// Completions, inoltra al provider reale, e ritraduce la risposta in formato
// Anthropic così che Claude Code la capisca.
// ==========================================
const PROXY_PROVIDERS = new Set(['groq', 'cerebras', 'nvidia', 'gemini', 'deepseek', 'mistral', 'openai', 'ashna', 'custom']);
const anthropicProxyHandler = createAnthropicProxyHandler(
  function getConfigForProxy() { return config; },
  getKeyForProvider,
  {
    getProviderOptions: function (provider) {
      return {
        baseUrl: baseUrlForProvider(provider),
        customBaseUrl: config.customBaseUrl || config.baseUrl || ''
      };
    },
    onVisionStart: avviaMessaggioVisioneDaProxy
  }
);
app.post('/v1/messages', function (req, res, next) {
  if (!richiestaLocaleDiretta(req)) {
    return res.status(403).json({ error: { type: 'forbidden', message: 'Il proxy modelli accetta solo processi locali.' } });
  }
  const currentProvider = config.provider || 'anthropic';
  if (PROXY_PROVIDERS.has(currentProvider) || gptOssAgent.richiedeProxyStrumenti(currentProvider, config.model)) {
    console.log('[AnthropicProxy] Intercettata richiesta /v1/messages → traduzione per provider:', currentProvider);
    return anthropicProxyHandler(req, res);
  }
  // Gli altri modelli OpenRouter mantengono il trasporto nativo.
  next();
});

// I file della UI cambiano ad ogni aggiornamento dello Studio: senza questo il
// browser continua a servire un app.js vecchio e le correzioni sembrano non applicate.
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  maxAge: 0,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache')
}));
app.use('/vendor', express.static(path.join(__dirname, 'node_modules')));

// Video di avvio e animazioni stanno in Media/, fuori da public/: si servono a parte.
// Cache lunga: sono file grandi che non cambiano, ricaricarli a ogni visita sarebbe
// uno spreco (il GIF pesa da solo piu' di 2 MB).
app.use('/media', express.static(path.join(__dirname, 'Media'), {
  maxAge: '7d',
  setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=604800')
}));

// Locate claude executable.
// Preferiamo il vero .exe: puo' essere lanciato con spawn/pipe senza passare da una shell
// (un .cmd richiederebbe shell:true, che rompe il quoting degli argomenti su Windows).
function fccExecutableCandidates() {
  const appData = process.env.APPDATA || '';
  const home = os.homedir();
  return process.platform === 'win32'
    ? [
        path.join(home, '.local', 'bin', 'fcc-claude.exe'),
        path.join(home, '.local', 'bin', 'fcc-claude.cmd'),
        path.join(appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'fcc-claude.exe'),
        path.join(appData, 'npm', 'fcc-claude.cmd')
      ]
    : [
        path.join(home, '.local', 'bin', 'fcc-claude'),
        path.join(home, 'bin', 'fcc-claude'),
        '/usr/local/bin/fcc-claude'
      ];
}

function findFccExecutable() {
  return fccExecutableCandidates().find(function (candidate) {
    try { return !!candidate && fs.existsSync(candidate); } catch (_) { return false; }
  }) || '';
}

function getClaudeExecutable() {
  const appData = process.env.APPDATA || '';
  const candidates = fccExecutableCandidates().concat([
    path.join(appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
    path.join(appData, 'npm', 'claude.cmd')
  ]);
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return process.platform === 'win32' ? 'fcc-claude.cmd' : 'fcc-claude';
}

function getOpencodeExecutable() {
  const appData = process.env.APPDATA || '';
  const candidates = [
    path.join(appData, 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'),
    path.join(appData, 'npm', 'opencode.cmd')
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return process.platform === 'win32' ? 'opencode.cmd' : 'opencode';
}

// Un base URL che punta alla porta di questa stessa UI e' un errore di configurazione
// classico: Claude manderebbe le richieste API al server Express, che risponde HTML.
// In quel caso lo scartiamo invece di avviare una sessione che non rispondera' mai.
function sanitizeBaseUrl(raw) {
  if (!raw || !String(raw).trim()) return '';
  const value = String(raw).trim().replace(/\/+$/, '');
  let parsed;
  try {
    parsed = new URL(value);
  } catch (e) {
    console.warn(`[Config] Base URL non valido, ignorato: ${value}`);
    return '';
  }
  const isLoopback = ['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(parsed.hostname);
  if (isLoopback && Number(parsed.port || 80) === Number(PORT)) {
    console.warn(`[Config] Base URL "${value}" punta alla porta di questa UI (${PORT}): ignorato.`);
    return '';
  }
  return value;
}

function providerDaBaseUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (host === 'openrouter.ai' || host.endsWith('.openrouter.ai')) return 'openrouter';
    if (host === 'integrate.api.nvidia.com' || host.endsWith('.nvidia.com')) return 'nvidia';
    if (host === 'api.groq.com') return 'groq';
    if (host === 'api.cerebras.ai') return 'cerebras';
    if (host === 'generativelanguage.googleapis.com') return 'gemini';
    if (host === 'api.deepseek.com') return 'deepseek';
    if (host === 'api.mistral.ai') return 'mistral';
    if (host === 'api.openai.com') return 'openai';
    if (host === 'api.ashna.ai') return 'ashna';
  } catch (e) {}
  return '';
}

// Il campo baseUrl e' storico e viene riusato da provider diversi. Non deve
// "trascinarsi" da NVIDIA/Ollama a OpenRouter o Anthropic quando l'utente cambia
// modello dalla tendina: ogni provider prende solo l'URL che gli appartiene.
function baseUrlForProvider(provider) {
  const legacy = sanitizeBaseUrl(config.baseUrl);
  const custom = sanitizeBaseUrl(config.customBaseUrl);
  // Use first custom endpoint if available
  const firstCustomEndpoint = (config.customEndpoints && config.customEndpoints.length > 0) 
    ? sanitizeBaseUrl(config.customEndpoints[0].baseUrl) 
    : '';

  if (provider === 'custom') return firstCustomEndpoint || custom || legacy;
  if (provider === 'openrouter') {
    return providerDaBaseUrl(legacy) === 'openrouter' ? legacy : 'https://openrouter.ai/api';
  }
  if (provider === 'fcc') {
    // fcc-claude risolve autonomamente TokenRouter/NVIDIA NIM/Groq dal proprio
    // catalogo. Credenziali Anthropic ereditate lo farebbero ricadere sul servizio
    // ufficiale, quindi per questo transport non impostiamo alcun endpoint proxy.
    delete env.ANTHROPIC_BASE_URL;
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_MODEL;
  } else if (provider === 'ollama') {
    if (!legacy) return 'http://localhost:11434';
    try {
      const u = new URL(legacy);
      const locale = ['localhost', '127.0.0.1', '::1'].includes(u.hostname) || u.port === '11434';
      return (config.provider === 'ollama' || locale) ? legacy : 'http://localhost:11434';
    } catch (e) {
      return 'http://localhost:11434';
    }
  }
  return legacy;
}

// Ripara configurazioni gia' rotte: provider Anthropic con un modello non Claude e
// un endpoint cloud noto portava Claude Code a chiamare l'API ufficiale con un
// modello inesistente ("unrecognized_model") e poi ad auto-continuare a vuoto.
function normalizzaProviderConfig() {
  const provider = config.provider || 'anthropic';
  const model = String(config.model || '').trim();
  if (!model) return false;

  // Gli slug del catalogo FCC portano il transport nel primo segmento. Non vanno
  // dedotti come OpenRouter solo perche' contengono una slash: li esegue fcc-claude.
  const fccMatch = /^(groq|nvidia_nim|tokenrouter)\//i.exec(model);
  if (fccMatch) {
    const catalogGroup = 'fcc-' + fccMatch[1].toLowerCase().replace(/_/g, '-');
    const changed = provider !== 'fcc' || config.modelTransport !== 'fcc' || config.modelGroup !== catalogGroup;
    config.provider = 'fcc';
    config.modelTransport = 'fcc';
    config.modelGroup = catalogGroup;
    if (changed) console.warn('[Config] Modello del catalogo FCC instradato tramite fcc-claude: ' + model);
    return changed;
  }

  if (provider !== 'anthropic') return false;
  if (/^(anthropic:)?claude-/i.test(model)) return false;

  const dedotto = providerDaBaseUrl(config.customBaseUrl || config.baseUrl);
  if (!dedotto || dedotto === provider) return false;
  config.provider = dedotto;
  console.warn('[Config] Provider corretto automaticamente da anthropic a ' + dedotto +
    ' per il modello "' + model + '".');
  return true;
}

// Costruisce l'ambiente della sessione Claude.
// Le variabili ANTHROPIC_* ereditate (da settings.json globale o dalla shell) vengono
// azzerate di proposito: altrimenti un valore vecchio sopravvive al cambio di provider
// e la sessione fallisce in modo silenzioso.
// Variabili che una sessione Claude Code passa ai propri processi figli: identita' della
// sessione, socket dei messaggi, strumenti e sforzo del programma che la ospita. Se lo
// Studio viene avviato da dentro Claude Code, Adam le ereditava tutte (verificato):
// strumenti in piu' che occupano contesto e impostazioni di un'altra sessione.
const VARIABILI_DI_SESSIONE = /^(CLAUDECODE|CLAUDE_CODE_(ENTRYPOINT|SESSION_ID|CHILD_SESSION|HOST_SESSION_ID|MESSAGING_\w+|OAUTH_SCOPES|SDK_\w+|EXECPATH|ENABLE_ASK_USER_QUESTION_TOOL|ENABLE_SDK_FILE_CHECKPOINTING|REPORT_FINDINGS|EMIT_TOOL_USE_SUMMARIES|DISABLE_CRON|EAGER_FLUSH|DISABLE_TERMINAL_TITLE)|CLAUDE_AGENT_SDK_\w+|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_PREVIEW_\w+)$/;

// Con un modello locale ogni definizione di strumento occupa contesto a ogni richiesta,
// e la finestra e' piccola (49152 token). Questi bastano per leggere, cercare, scrivere
// ed eseguire la sonda; ricerca web e sotto-agenti con Ollama non servono.
const STRUMENTI_LOCALI = 'Bash,Read,Edit,Write,Glob,Grep';

function resolveClaudeEnv() {
  const env = Object.assign({}, process.env, {
    FORCE_COLOR: '1',
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor'
  });

  delete env.ANTHROPIC_BASE_URL;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_MODEL;
  delete env.MAX_THINKING_TOKENS;
  Object.keys(env).forEach(function (k) {
    if (VARIABILI_DI_SESSIONE.test(k)) delete env[k];
  });

  // Su Windows assicuriamo che Git Bash e PowerShell siano all'inizio del PATH.
  // Senza questo, WindowsApps/bash.exe (stub WSL) intercetta le chiamate allo
  // strumento Bash provocando blocchi o fallimenti silenziosi dei comandi CLI.
  if (process.platform === 'win32') {
    const gitDirs = [
      'C:\\Program Files\\Git\\bin',
      'C:\\Program Files\\Git\\usr\\bin',
      'C:\\Program Files (x86)\\Git\\bin',
      'C:\\Program Files (x86)\\Git\\usr\\bin',
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'usr', 'bin')
    ].filter(function (d) { try { return fs.existsSync(d); } catch (e) { return false; } });

    const psDirs = [
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0',
      'C:\\Program Files\\PowerShell\\7'
    ].filter(function (d) { try { return fs.existsSync(d); } catch (e) { return false; } });

    const extra = [...gitDirs, ...psDirs];
    if (extra.length) {
      env.PATH = extra.join(';') + ';' + (env.PATH || process.env.PATH || '');
    }
  }

  const provider = config.provider || 'anthropic';
  const model = (config.model || '').trim();
  const baseUrl = baseUrlForProvider(provider);
  const apiKey = (config.apiKey || '').trim();
  const authToken = (config.authToken || '').trim();

  // Pulizia: senza questo, un valore vecchio rimasto nell'ambiente sopravvive quando si passa
  // a un modello/provider dove la compattazione nativa non va impostata.
  delete env.CLAUDE_CODE_MAX_CONTEXT_TOKENS;
  delete env.CLAUDE_CODE_MAX_OUTPUT_TOKENS;
  delete env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE;

  const budgetRagionamento = effortThinkingBudget();
  if (budgetRagionamento !== null) {
    env.MAX_THINKING_TOKENS = String(budgetRagionamento);
  }

  // Popola tutte le API key per tutti i provider registrati
  const anthropicKey = getKeyForProvider('anthropic');
  const openrouterKey = getKeyForProvider('openrouter');
  const nvidiaKey = getKeyForProvider('nvidia');
  const ashnaKey = getKeyForProvider('ashna');
  const cerebrasKey = getKeyForProvider('cerebras');
  const openaiKey = getKeyForProvider('openai');
  const deepseekKey = getKeyForProvider('deepseek');
  const geminiKey = getKeyForProvider('gemini');
  const groqKey = getKeyForProvider('groq');
  const mistralKey = getKeyForProvider('mistral');
  const customKey = getKeyForProvider('custom');

  if (anthropicKey) env.ANTHROPIC_API_KEY = anthropicKey;
  if (openrouterKey) env.OPENROUTER_API_KEY = openrouterKey;
  if (nvidiaKey) env.NVIDIA_API_KEY = nvidiaKey;
  if (ashnaKey) env.ASHNA_API_KEY = ashnaKey;
  if (cerebrasKey) env.CEREBRAS_API_KEY = cerebrasKey;
  if (openaiKey) env.OPENAI_API_KEY = openaiKey;
  if (deepseekKey) env.DEEPSEEK_API_KEY = deepseekKey;
  if (geminiKey) env.GEMINI_API_KEY = geminiKey;
  if (groqKey) env.GROQ_API_KEY = groqKey;
  if (mistralKey) env.MISTRAL_API_KEY = mistralKey;

  if (provider === 'ollama') {
    env.ANTHROPIC_BASE_URL = baseUrl || 'http://localhost:11434';
    // Ollama non verifica il token ma Claude Code ne pretende uno non vuoto.
    env.ANTHROPIC_AUTH_TOKEN = authToken || 'ollama';
    if (model) env.ANTHROPIC_MODEL = model;
    // Un modello locale genera molto piu' lentamente dell'API: col timeout di default
    // una risposta lunga viene troncata a meta' con "The response stopped arriving".
    env.API_TIMEOUT_MS = String(config.apiTimeoutMs || DEFAULT_LOCAL_TIMEOUT_MS);
  } else if (provider === 'openrouter') {
    // GPT-OSS usa in modo piu' affidabile le chiamate funzione OpenAI. Solo questa
    // famiglia passa dal proxy locale che preserva tools/tool_choice e tool_use.
    // Gli altri modelli OpenRouter continuano a usare il trasporto nativo.
    env.ANTHROPIC_BASE_URL = gptOssAgent.richiedeProxyStrumenti(provider, model)
      ? 'http://localhost:' + PORT
      : (baseUrl || 'https://openrouter.ai/api');
    const activeKey = openrouterKey || authToken;
    if (activeKey) {
      env.ANTHROPIC_AUTH_TOKEN = activeKey;
      env.OPENROUTER_API_KEY = activeKey;
    }
    if (anthropicKey) env.ANTHROPIC_API_KEY = anthropicKey;
    if (model) env.ANTHROPIC_MODEL = model;
    env.API_TIMEOUT_MS = String(config.apiTimeoutMs || DEFAULT_LOCAL_TIMEOUT_MS);
  } else if (provider === 'groq' || provider === 'cerebras' || provider === 'nvidia' ||
             provider === 'gemini' || provider === 'deepseek' || provider === 'mistral' ||
             provider === 'openai' || provider === 'ashna' || provider === 'custom') {
    // ────────────────────────────────────────────────────────────────────
    // Provider con formato OpenAI-compatible: Claude Code punta al PROXY LOCALE.
    // Il proxy (montato su POST /v1/messages di questo stesso server) traduce
    // le richieste Anthropic in formato OpenAI Chat Completions e le inoltra
    // al provider reale, poi ritraduce la risposta.
    // ────────────────────────────────────────────────────────────────────
    env.ANTHROPIC_BASE_URL = 'http://localhost:' + PORT;

    // Claude Code vuole un auth token non vuoto — usiamo la key del provider
    let activeKey = authToken;
    if (provider === 'nvidia') activeKey = nvidiaKey || authToken;
    else if (provider === 'ashna') activeKey = ashnaKey || authToken;
    else if (provider === 'cerebras') activeKey = cerebrasKey || authToken;
    else if (provider === 'groq') activeKey = groqKey || authToken;
    else if (provider === 'openai') activeKey = openaiKey || authToken;
    else if (provider === 'deepseek') activeKey = deepseekKey || authToken;
    else if (provider === 'gemini') activeKey = geminiKey || authToken;
    else if (provider === 'mistral') activeKey = mistralKey || authToken;
    else if (provider === 'custom') activeKey = customKey || authToken;

    if (activeKey) {
      env.ANTHROPIC_AUTH_TOKEN = activeKey;
      // Per sicurezza, il proxy legge anche x-api-key come fallback
      env.ANTHROPIC_API_KEY = activeKey;
    } else {
      // Claude Code rifiuta di partire senza token: dummy placeholder
      env.ANTHROPIC_AUTH_TOKEN = 'proxy-passthrough';
    }

    if (anthropicKey) env.ANTHROPIC_API_KEY = anthropicKey;
    // Imposta sempre il modello scelto: se lo omettiamo per i modelli non-Claude,
    // Claude Code usa il suo default e gli errori mostrano il nome sbagliato.
    if (model) env.ANTHROPIC_MODEL = model;
    env.API_TIMEOUT_MS = String(config.apiTimeoutMs || DEFAULT_LOCAL_TIMEOUT_MS);
  } else {
    // anthropic: login dell'account (OAuth) oppure API key esplicita.
    // Nessun override di base URL, altrimenti si perde l'endpoint ufficiale.
    if (anthropicKey) env.ANTHROPIC_API_KEY = anthropicKey;
    if (model) env.ANTHROPIC_MODEL = model;
  }

  // MISURATO: a ogni sessione nuova Claude Code chiede al modello anche un titolo, con
  // max_tokens 32000. Con Ollama quella richiesta andava avanti a vuoto (4.228 token in 165
  // secondi, un'altra oltre 11.000) e, visto che Ollama serve una richiesta alla volta, la
  // risposta vera restava in coda: un "OK" arrivava dopo 180 secondi invece che dopo 14.
  // Con questa variabile la richiesta del titolo non parte piu' (verificato con un proxy).
  if (provider !== 'anthropic') {
    env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  }

  // Compattazione nativa: diciamo a Claude Code la finestra VERA del modello locale e mettiamo un
  // tetto di output, cosi' riassume la conversazione e prosegue nella stessa sessione (verificato:
  // scatta in anticipo, non perde le richieste e Ollama non tronca mai). Solo quando la finestra e'
  // nota: se Ollama non ha ancora risposto, non impostiamo nulla e vale il comportamento di prima.
  if (provider !== 'anthropic' && config.autoCompatta !== false) {
    const p = parametriCompattazione(finestraModelloToken[model]);
    if (p) {
      env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(p.maxContext);
      env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(p.output);
      env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = String(p.pct);
    }
  }

  return env;
}

// Finestra reale (num_ctx) rilevata da Ollama, per modello. Serve a impostare la compattazione
// nativa sul valore giusto gia' al primo avvio, prima ancora della prima risposta.
const finestraModelloToken = {};

// Dai tre parametri che fanno compattare Claude Code IN TEMPO, lasciando spazio sia al prompt sia
// alla risposta. MISURATO (Ollama 0.34, Claude Code 2.1.267): senza tetto di output Claude Code
// riserva 32000 token e la finestra "sfora" prima ancora di generare (errore "Prompt is too long"
// gia' al primo turno). Con la soglia calcolata qui la compattazione scatta con margine e, su piu'
// turni, Ollama non ha mai troncato. La soglia (%) e' calcolata cosi': prompt-al-momento-del-taglio
// + output <= finestra - cuscinetto, perche' i conteggi di Claude Code e di Ollama differiscono un po'.
function parametriCompattazione(finestra) {
  finestra = Number(finestra) || 0;
  if (finestra < 2000) return null;
  const tettoConfig = Number(config.maxOutputTokens) || 0;
  const output = tettoConfig > 0
    ? Math.min(tettoConfig, Math.floor(finestra / 3))
    : Math.min(4096, Math.floor(finestra / 4));
  const margine = 1024;
  const sogliaToken = Math.max(1000, finestra - output - margine);
  const pct = Math.max(40, Math.min(80, Math.floor(sogliaToken * 100 / finestra)));
  return { maxContext: finestra, output: output, pct: pct };
}

// Limiti che Claude Code applica DA SOLO, letti nel suo codice (versione 2.1.267):
//  - soglia di compattazione = min(pct% di (finestra - output), finestra - output - 13000)
//  - blocco = finestra - output - 3000: oltre, la richiesta non parte nemmeno e la risposta e'
//    "Prompt is too long", anche se il contesto sembra pieno solo a meta'.
// VISTO DAL VIVO (15/09/2026): con 16384 token la compattazione scatta a -712 (cioe' sempre, e
// senza poter liberare nulla) e il blocco a 9288, ma prompt di sistema e strumenti di Adam ne
// occupano gia' ~8600. Risultato: una sola risposta per sessione, poi passaggio di sessione.
function limitiClaudeCode(finestra) {
  const p = parametriCompattazione(finestra);
  if (!p) return null;
  const effettiva = p.maxContext - Math.min(p.output, 20000);
  return {
    compattazione: Math.min(Math.floor(effettiva * p.pct / 100), effettiva - 13000),
    blocco: effettiva - 3000
  };
}

// Spazio minimo per lavorare davvero: leggere un file o scriverne uno medio occupa 1500-3000 token.
const SPAZIO_MINIMO_LAVORO = 3000;

// Vero se una sessione appena aperta (base = token occupati alla prima risposta) arriva al blocco
// di Claude Code prima di aver potuto fare qualcosa di utile.
function sessioneSenzaSpazio(base, finestra) {
  const lim = limitiClaudeCode(finestra);
  return !!lim && base + SPAZIO_MINIMO_LAVORO >= lim.blocco;
}

// PERCHE' LA MEMORIA E' SALVATA COME TESTO E NON COME TOKEN
// Misurato su questa macchina: 753 caratteri di memoria = 232 token (3,2 char/token).
// Salvare gli ID dei token invece del testo sarebbe un peggioramento netto:
//  - non risparmia calcolo: il modello riceve comunque quei token, e tokenizzare
//    il testo costa microsecondi contro i ~6 token/s della generazione;
//  - non risparmia spazio: un ID serializzato in JSON occupa piu' del testo che
//    rappresenta (~6 caratteri contro ~3,2);
//  - non e' portabile: gli ID dipendono dal tokenizer. Gli stessi numeri con
//    llama3.2 significano parole diverse che con qwen3.5, quindi cambiando modello
//    la memoria diventerebbe spazzatura;
//  - non e' leggibile ne' modificabile a mano nella UI.
// Cio' che risparmia davvero calcolo e' iniettare MENO testo, non codificarlo
// diversamente: per questo c'e' MEMORY_CHAR_BUDGET.
const ASSISTANT_NAME = 'Adam';

// Budget di caratteri per la memoria iniettata. Misurato su questa macchina:
// ~3,2 caratteri per token, quindi 6000 caratteri valgono circa 1900 token.
// Serve un tetto: la memoria entra nel prompt di OGNI turno, e ogni turno la
// rielabora da capo. Senza limite, crescendo, rallenterebbe tutto.
const MEMORY_CHAR_BUDGET = 6000;

// Trasforma i "neuroni" salvati in testo per il prompt di sistema.
// Volutamente testo semplice e non token pre-calcolati: vedi nota in cima al file.
function buildMemoryPrompt(projectDir) {
  let nodes = [];
  let noteDiAdam = [];
  try {
    const graph = getCombinedGraph(projectDir);
    nodes = graph.nodes || [];
    noteDiAdam = graph.project && Array.isArray(graph.project.memories) ? graph.project.memories : [];
  } catch (e) {
    return '';
  }
  if (!nodes.length && !noteDiAdam.length) return '';

  const byScope = { global: [], project: [] };
  // La mappa del codice non entra piu' nel prompt: il cervello del progetto la sa tutta e sempre
  // aggiornata, mentre qui arrivava tagliata (12 nomi per file) e riempiva da sola il budget.
  nodes = nodes.filter(function (n) {
    return n.label !== 'Mappa del codice' && (n.tags || []).indexOf('mappa-codice') === -1;
  });
  nodes.forEach(function (n) {
    const line = '- [' + (n.type || 'nota') + '] ' + (n.label || '') +
      (n.value ? ': ' + n.value : '') +
      (n.tags && n.tags.length ? '  (tag: ' + n.tags.join(', ') + ')' : '');
    (byScope[n.scope] || byScope.project).push(line);
  });
  // Voci scritte da Adam da solo nel file di progetto, nel formato "memories": prima
  // restavano su disco senza mai tornare nel prompt, cioe' una memoria salvata e mai usata.
  noteDiAdam.slice(0, 10).forEach(function (m) {
    const titolo = [m && m.title, m && m.description].filter(Boolean).join(': ');
    const corpo = m && m.memory ? String(m.memory).replace(/\s+/g, ' ').slice(0, 400) : '';
    if (titolo || corpo) byScope.project.push('- [nota di Adam] ' + titolo + (corpo ? ' - ' + corpo : ''));
  });

  const sections = [];
  if (byScope.global.length) {
    sections.push('Regole e dati validi per tutti i progetti:\n' + byScope.global.join('\n'));
  }
  if (byScope.project.length) {
    sections.push('Memoria di questo progetto:\n' + byScope.project.join('\n'));
  }

  let text = sections.join('\n\n');
  if (text.length > MEMORY_CHAR_BUDGET) {
    text = text.slice(0, MEMORY_CHAR_BUDGET) +
      '\n[...memoria troncata: supera il budget di ' + MEMORY_CHAR_BUDGET + ' caratteri]';
  }
  return text;
}

// Metodo di debug. Caso reale: davanti a "i nemici sono velocissimi" Adam leggeva i
// file, abbassava le velocita' e dichiarava risolto senza eseguire nulla; la causa (un
// ciclo di animazione che si moltiplicava) si vedeva solo eseguendo la pagina e
// misurando. Con un modello piccolo il metodo va detto passo per passo.
const COMANDO_SONDA = 'node "' + path.join(__dirname, 'strumenti', 'sonda.js').split(path.sep).join('/') + '"';
const COMANDO_SVEGLIA = 'node "' + path.join(__dirname, 'strumenti', 'sveglia.js').split(path.sep).join('/') + '"';
const COMANDO_CONSOLE = 'node "' + path.join(__dirname, 'strumenti', 'console-utente.js').split(path.sep).join('/') + '"';
const COMANDO_CAPO = 'node "' + path.join(__dirname, 'strumenti', 'capo-progetto.js').split(path.sep).join('/') + '"';
const COMANDO_GUARDIANO = 'node "' + path.join(__dirname, 'strumenti', 'guardiano-letture.js').split(path.sep).join('/') + '"';
const COMANDO_CAMBIAMENTI = 'node "' + path.join(__dirname, 'strumenti', 'cambiamenti.js').split(path.sep).join('/') + '"';
const COMANDO_RIPRISTINA = 'node "' + path.join(__dirname, 'strumenti', 'ripristina.js').split(path.sep).join('/') + '"';
const COMANDO_RICERCA_WEB = 'node "' + path.join(__dirname, 'strumenti', 'ricerca-web.js').split(path.sep).join('/') + '"';

function metodoDiDebug() {
  return [
    'DEBUG: Quando qualcosa non funziona, individua la causa reale nel codice (citando file e riga) prima di modificare.',
    'Se lo Studio fornisce misure della pagina o errori JavaScript, usali come riferimento utile per orientarti.',
    'CONSOLE DEL BROWSER: non chiederla mai all\'utente. Della pagina aperta nella sua Anteprima la leggi con ' +
      COMANDO_CONSOLE + '; di una pagina che provi tu te la riporta la verifica.',
    'PROVA UI WEB: usa ' + verificaCompleta.COMANDO + ' pagina.html --passi "clic #start; trascina #slider | 75%; attendi 200" per inviare click e trascinamenti reali al browser e leggere errori, console e risorse mancanti.',
    'BUILD E TEST WINDOWS: quando servono, lancia i comandi di build o i test del progetto da PowerShell (`powershell.exe -NoProfile -Command ...`) e controlla stdout, stderr e codice d\'uscita.',
    "PRIMA FUNZIONAVA E ADESSO NO: guarda cosa e' cambiato sul disco con " + COMANDO_CAMBIAMENTI + " (righe prima e dopo, file sostituiti o cancellati, anche da un comando Bash). Un file che cambia tutto insieme non e' troncato: qualcosa gli e' passato sopra. La versione di prima e' salvata: " + COMANDO_RIPRISTINA + " --elenco, poi --file <nome>. Rimettila invece di riscriverla a memoria.",
    "CAPO PROGETTO: in testa a ogni messaggio trovi compito e passo di adesso, tenuti dallo Studio. Fai SOLO quel passo e " +
      "chiudi la risposta con la riga PASSO FATTO: <cosa hai fatto>. Se il piano e' sbagliato riscrivilo: " + COMANDO_CAPO + " --piano \"1) ... 2) ...\"",
    'Per risparmiare contesto: usa Grep e Read con offset/limit sulle righe che servono, non rileggere file interi.'
  ].join('\n');
}

// Metodo di scrittura codice incrementale e non-distruttiva.
// Evita il troncamento del payload JSON di Write e i loop di rigenerazione infinita su modelli locali.
function metodoDiScritturaCodice() {
  return [
    'SCRITTURA CODICE INCREMENTALE E NON-DISTRUTTIVA (OBBLIGATORIO PER SCRIPT COMPLESSI):',
    '1. MAI generare script lunghi o complessi (oltre 60-80 righe) in una sola chiamata: porta a troncamenti, timeout e loop.',
    '2. SCHEMA SCAFFOLDING CON WRITE (MASSIMO 15-20 RIGHE): Per QUALSIASI nuovo file (CSS, JS, HTML), la prima chiamata Write DEVE contenere solo uno scheletro brevissimo di 10-20 righe (es. per CSS solo selettori di base/root; per JS solo costanti iniziali; per HTML solo struttura vuota). MAI scrivere un file intero con Write: se il testo supera poche righe la chiamata viene troncata a metà per limite token, il file non viene salvato e si entra in loop! Salva SUBITO lo scheletro minimale con Write, e poi aggiungi tutto il resto a piccoli blocchi con Edit.',
    '3. IMPLEMENTAZIONE A BLOCCHI CON EDIT: Aggiungi e completa le funzioni o classi un blocco alla volta usando Edit. Non riscrivere mai l\'intero file da zero con Write.',
    '4. RILEGGI PER CONTINUARE (READ): Tra un blocco e il successivo usa Read con offset e limit sulle ultime righe per verificare firme, variabili ed elementi gia\' definiti prima di aggiungere nuovo codice.',
    '5. MAI REGREDIRE O DISTRUGGERE: Non cancellare o sovrascrivere mai codice gia\' scritto e funzionante. Procedi sempre per accumulo e rifinitura progressiva.',
    '6. GESTIONE INTERRUZIONI: Se ti interrompi o scatta un auto-continue, NON ripartire da zero e non rifare preamboli. Leggi lo stato del file su disco con Read e riprendi dall\'ultimo blocco scritto.',
    '7. AZIONI IMMEDIATE SENZA CHIACCHIERE: Non annunciare MAI cosa farai dopo a parole (es. VIETATO dire "Ora aggiungo...", "Procedo a modificare:"). Quando decidi di fare un\'azione, invoca SUBITO lo strumento (Edit, Read, Write o Bash) nello stesso turno. Se annunci un\'azione e finisci il turno senza invocare lo strumento, l\'utente non vede alcun progresso.'
  ].join('\n');
}

// Prompt di sistema aggiuntivo: identita' + memoria salvata dall'utente.
// Senza questo la mappa neurale resta puramente decorativa - i "neuroni" venivano
// salvati su disco ma non raggiungevano mai il modello.
function buildAppendedSystemPrompt() {
  const parts = ['Ti chiami ' + ASSISTANT_NAME + '. Quando ti presenti usa questo nome.'];
  parts.push(dialogoGuidato.istruzioniPrompt(config.provider, config.model));
  const istruzioniGptOss = gptOssAgent.istruzioniPrompt(config.model);
  if (istruzioniGptOss) parts.push(istruzioniGptOss);
  // Le regole dell'utente, in cima: sono passate dall'esame (strumenti/esame.js). Incorporarle
  // nel Modelfile non servirebbe: il prompt di Claude Code sostituisce quello del modello.
  const testoRegole = regoleAdam.testoRegole(regoleAdam.carica().regole);
  if (testoRegole) parts.push(testoRegole);

  const effortText = effortInstruction();
  if (effortText) parts.push(effortText);
  parts.push(metodoDiScritturaCodice());
  if (misure.pagineDelProgetto(config.cwd).length) parts.push(metodoDiDebug());
  // Il cervello del progetto: variabili, funzioni, id e collegamenti di tutti i file, e gli errori
  // gia' fatti. Adam lo interroga con Bash; con l'hook lo riceve anche dopo ogni modifica.
  try {
    const cervello = cervelloComandi.testoPerPrompt(config.cwd, { dopoOgniModifica: config.cervelloDopoOgniModifica !== false });
    if (cervello) parts.push(cervello);
  } catch (e) {
    console.error('[Cervello] Blocco del prompt non disponibile:', e.message);
  }
  // Capo file: guida a sezioni per file grossi (>300 righe) per non rompere il codice
  try {
    const capoFileTesto = capoFile.testoPerPrompt(config.cwd);
    if (capoFileTesto) parts.push(capoFileTesto);
  } catch (e) {
    console.error('[Capo file] Blocco del prompt non disponibile:', e.message);
  }
  // Come verifica un programmatore esperto: esegue la pagina e guarda, prima di dire "fatto".
  try {
    const verificaTesto = verificaCompleta.testoPerPrompt(config.cwd);
    if (verificaTesto) parts.push(verificaTesto);
  } catch (e) {
    console.error('[Verifica] Blocco del prompt non disponibile:', e.message);
  }
  // Arsenale completo di verifica, analisi statica e sicurezza
  try {
    const arsenaleTesto = arsenaleTest.testoPerPrompt(config.cwd);
    if (arsenaleTesto) parts.push(arsenaleTesto);
  } catch (e) {
    console.error('[Arsenale] Blocco del prompt non disponibile:', e.message);
  }
  // Le regole che servono per QUESTO progetto (Unity, Android, Blender, Python, web per telefono),
  // con la documentazione ufficiale della versione installata.
  try {
    const competenze = esperti.testoPerPrompt(config.cwd);
    if (competenze) parts.push(competenze);
  } catch (e) {
    console.error('[Competenze] Blocco del prompt non disponibile:', e.message);
  }
  // Documentazione, PDF, immagini e fonti configurate dall'utente (con learn.unity.com primaria per Unity)
  try {
    const docPrompt = documentazione.testoPerPrompt(config.cwd);
    if (docPrompt) parts.push(docPrompt);
  } catch (e) {
    console.error('[Documentazione] Blocco del prompt non disponibile:', e.message);
  }
  // Scheletri di partenza (un modello piccolo MODIFICA bene e PROGETTA male, quindi per un gioco 3D
  // parte da uno che gia' funziona), texture e modelli 3D. Sono 598 token che viaggiano in OGNI
  // richiesta: in un sito curriculum non servono a niente e rubano memoria. Ci vanno solo se questo
  // progetto ne ha bisogno; altrimenti resta una riga con cui Adam se li chiama quando servono.
  try {
    const gioco = pertinenza.serveRobaDaGioco(config.cwd);
    if (gioco.serve) {
      const partenza = scheletri.testoPerPrompt(config.cwd);
      if (partenza) parts.push(partenza);
      const risorse = [textureGioco.testoPerPrompt(), modelli3d.testoPerPrompt()].filter(Boolean).join('\n');
      if (risorse) parts.push(risorse);
      console.log('[Prompt] Risorse di gioco incluse: ' + gioco.perche + '.');
    } else {
      const riserva = pertinenza.rigaDiRiserva({
        scheletri: scheletri.COMANDO, texture: textureGioco.COMANDO, modelli: modelli3d.COMANDO
      });
      if (riserva) parts.push(riserva);
      console.log('[Prompt] Risorse di gioco lasciate fuori (' + gioco.perche + '): Adam se le chiama se servono.');
    }
  } catch (e) {
    console.error('[Risorse] Blocco del prompt non disponibile:', e.message);
  }
  const memory = buildMemoryPrompt(config.cwd);
  if (memory) {
    parts.push(
      'Quanto segue e\' la memoria persistente del progetto: regole, note e problemi noti ' +
      'salvati. USALA insieme al CERVELLO DEL PROGETTO (qui sopra), che sa tutte le variabili, ' +
      'le funzioni, gli id e i collegamenti fra file: prima di modificare un file controlla chi ' +
      'dipende da esso e quali nomi sono gia\' in uso, per non romperli e per non reinventare ' +
      'cio\' che esiste gia\'. Non citarla esplicitamente se non serve.' +
      '\n\n' + memory);
  }
  // Le chat salvate e collegate: memoria che Adam esplora con Grep e Read, senza riceverla intera.
  // Nemotron tende a usare le vecchie chat come istruzioni correnti e a riaprire
  // interpretazioni gia' scartate. Per questa famiglia la memoria storica resta
  // disponibile nella UI e su disco, ma non viene pubblicizzata nel prompt.
  const chatSalvate = dialogoGuidato.isNemotronNvidia(config.provider, config.model)
    ? ''
    : archivioChat.testoPerPrompt(config.cwd, conversazioneId);
  if (chatSalvate) parts.push(chatSalvate);
  parts.push('SVEGLIE: se devi attendere un\'operazione lunga o ricontrollare più tardi, puoi programmare una sveglia con Bash: ' +
    COMANDO_SVEGLIA + ' --tra 5m --motivo "controllo" e poi chiudere il turno.');
  parts.push('TERMINALE E COMANDI (Bash): Hai accesso alla riga di comando tramite lo strumento Bash. ' +
    'Puoi eseguire qualsiasi comando Windows, Git, npm o PowerShell (es. powershell.exe -Command "..."). ' +
    'Quando l\'utente ti chiede di collegare o sincronizzare Git, installare pacchetti o eseguire verifiche, ' +
    'ESEGUI subito i comandi con lo strumento Bash invece di limitarti a spiegare a parole come fare.');
  parts.push([
    'GIT PUSH REALE E VERIFICATO (DIRETTIVA OBBLIGATORIA):',
    'Esegui un push soltanto quando l\'utente lo chiede esplicitamente. In quel caso non basta mostrare o descrivere il comando:',
    'controlla lo stato, includi nel commit soltanto i file pertinenti alla richiesta, esegui davvero `git push` e controlla il remoto.',
    'Un push e\' riuscito solo se il comando termina correttamente e lo SHA restituito da `git ls-remote` coincide con `git rev-parse HEAD`.',
    'Se restano modifiche locali, dichiarale: quei file non sono stati caricati. Se manca autenticazione, rete, upstream o remote, mostra l\'errore reale e non dichiarare il lavoro pubblicato.'
  ].join('\n'));

  // Gestione blocchi, componenti senza addestramento, domande all'utente e ricerca web
  parts.push([
    'GESTIONE BLOCCHI, INCERTEZZE E CONOSCENZE MANCANTI (DIRETTIVA OBBLIGATORIA):',
    'Se non sai come andare avanti, o non sai come creare un pezzo/componente perché non hai l\'addestramento o le informazioni necessarie:',
    '1. NON tirare a indovinare, non allucinare e non inventare codice, firme di funzioni, librerie o API fittizie.',
    '2. CERCA SUL WEB E CONSULTA I SITI CONSIGLIATI: Usa lo strumento Bash con il comando di ricerca e visita web:',
    '   - Ricerca veloce sul web: ' + COMANDO_RICERCA_WEB + ' --cerca "argomento o errore o libreria"',
    '   - Visita e leggi documentazione o URL: ' + COMANDO_RICERCA_WEB + ' --visita "https://..."',
    '   - Elenco dei siti consigliati dall\'utente: ' + COMANDO_RICERCA_WEB + ' --siti',
    '3. FAI DOMANDE ALL\'UTENTE: Se ti mancano specifiche, se ci sono scelte architetturali o se dopo aver cercato hai ancora dubbi su come l\'utente desideri implementare il pezzo, FERMATI e fai domande chiare, dirette e puntuali all\'utente, spiegando le opzioni disponibili prima di procedere.',
    // Visto dal vivo il 18/9/2026: l'utente aveva chiesto un "fps deathmatch", il gioco era 2D, e
    // Adam ha chiesto tre volte di fila "lo converto in 3D o miglioro il 2D?" invece di lavorare.
    '4. MA NON CHIEDERE QUELLO CHE L\'UTENTE HA GIA\' DETTO: prima di una domanda rileggi le sue richieste (sono nel capo progetto e nel quadro). Se la risposta c\'e\' gia\' - per esempio ha chiesto un FPS, che e\' in prima persona e quindi 3D - non chiedere: fallo. ' +
    (scheletri.eProgettoUnity && scheletri.eProgettoUnity(config.cwd)
      ? 'ATTENZIONE AMBIENTE UNITY: questo è un progetto Unity (C#). NON USARE e NON COPIARE MAI scheletri dello Studio, NON usare Three.js o JavaScript o Python. Sviluppa creando script C# (.cs) che estendono MonoBehaviour dentro Assets/ (es. Assets/Scripts/) consultando https://learn.unity.com/.'
      : 'Un lavoro grosso si fa partendo da uno scheletro dello Studio o un pezzo alla volta, non si rimanda.')
  ].join('\n'));

  // Regola trasparenza connessione Internet (richiesta esplicita dell'utente)
  parts.push([
    'CONNESSIONE INTERNET E TRASMISSIONE DATI (DIRETTIVA OBBLIGATORIA):',
    'Se noti che la connessione Internet è debole, assente, instabile o lenta, oppure se riscontri timeout o errori nelle chiamate di rete o a strumenti web, o se fai fatica a ricevere istruzioni o a trasmettere le tue risposte:',
    'DEVI COMUNICARLO SUBITO ALL\'UTENTE IN MODO CHIARO ED ESPLICITO, dicendogli che c\'è poco internet o la linea è instabile e che stai facendo fatica a ricevere o inviare i dati.'
  ].join('\n'));

  const testoSiti = sitiConsigliati.testoPerPrompt();
  if (testoSiti) parts.push(testoSiti);
  parts.push(pdfAgent.testoPerPrompt(config.provider, config.model));

  const testo = parts.join('\n\n');
  // Quanto pesa quello che Adam si porta dietro a ogni richiesta: e' la prima cosa da guardare
  // quando il contesto finisce troppo presto (misurato: 3.739 token il 17/9/2026).
  console.log('[Prompt] Istruzioni di Adam: ' + testo.length + ' caratteri, circa ' +
    Math.round(testo.length / 3.6) + ' token su ' + (finestraModelloToken[(config.model || '').trim()] || '?') + '.');
  return testo;
}

const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

// MISURATO: con Ollama il flag --effort non produce alcuna differenza (stesso prompt a
// low e a max: ragionamento 158 vs 163 caratteri, cioe' rumore, e max addirittura piu'
// veloce). Il livello di compatibilita' /v1/messages ignora il budget di ragionamento.
// Su un provider locale, quindi, il livello va tradotto in istruzioni nel prompt, che
// invece il modello segue. Con il provider Anthropic --effort funziona da solo e queste
// istruzioni non servono.
// Ogni istruzione porta la clausola sulle richieste semplici. Senza, il modello
// applicava lo stesso sforzo anche a "dimmi VIVO": misurati 28 secondi di
// ragionamento e NESSUNA risposta, perche' il budget finiva prima di rispondere.
const RICHIESTE_SEMPLICI = ' Se la richiesta e\' banale o la risposta e\' ovvia, rispondi subito senza ragionamento.';

const EFFORT_INSTRUCTIONS = {
  low: 'Rispondi in modo diretto e sintetico. Non dilungarti nel ragionamento: vai al punto.',
  medium: 'Ragiona quanto basta prima di rispondere, senza dilungarti.' + RICHIESTE_SEMPLICI,
  high: 'Per le richieste che lo meritano ragiona passo per passo e verifica i punti principali.' + RICHIESTE_SEMPLICI,
  xhigh: 'Per le richieste complesse ragiona a fondo passo per passo, esaminandole da piu\' angolazioni e verificando i calcoli prima della risposta finale.' + RICHIESTE_SEMPLICI,
  max: 'Per le richieste complesse ragiona in modo molto approfondito, passo per passo: esaminale da piu\' angolazioni, verifica ogni calcolo, considera i casi limite e controlla la conclusione prima di darla.' + RICHIESTE_SEMPLICI
};

// MISURATO: MAX_THINKING_TOKENS attraversa Claude Code e arriva a Ollama. Con 0 il
// ragionamento sparisce (da ~1480 token a 50 caratteri, con la risposta comunque
// corretta). E' la leva reale sulla velocita' con un modello di ragionamento come
// qwen3.5, che altrimenti pensa a lungo perfino su "dimmi VIVO".
const EFFORT_THINKING_BUDGET = {
  low: 0,
  medium: 512,
  high: 1024,
  xhigh: 2048,
  max: 4096
};

function effortThinkingBudget() {
  if ((config.provider || 'anthropic') === 'anthropic') return null; // ci pensa --effort
  if (config.provider === 'custom' && config.baseUrl && (config.baseUrl.includes('openrouter') || config.baseUrl.includes('cerebras'))) {
    return null; // I modelli cloud gestiscono nativamente --effort senza limiti artificiali
  }
  const level = (config.effort || 'high').trim();
  const budget = EFFORT_THINKING_BUDGET[level];
  return budget === undefined ? null : budget;
}

function effortInstruction() {
  const provider = config.provider || 'anthropic';
  if (provider === 'anthropic') return '';   // --effort agisce gia' da solo
  const level = (config.effort || 'high').trim();
  return EFFORT_INSTRUCTIONS[level] || '';
}

// Argomenti condivisi fra sessione terminale e sessione chat.
function buildCommonArgs() {
  const args = [];

  // Quanto "sforzo di ragionamento" concedere al modello. Piu' alto = risposte
  // piu' ragionate ma piu' lente: su hardware locale la differenza si sente molto.
  const effort = (config.effort || '').trim();
  if (EFFORT_LEVELS.indexOf(effort) !== -1) {
    args.push('--effort', effort);
  }
  if (config.model && config.model.trim()) {
    // Il modello va SEMPRE passato a Claude Code. Anche con un provider esterno il
    // proxy locale inoltra il modello scelto dall'utente; se lo omettiamo, Claude Code
    // usa il proprio default ("claude-opus-5[1m]") e tutti gli errori riportano quel
    // nome invece del modello che l'utente ha davvero selezionato.
    args.push('--model', config.model.trim());
  }
  if ((config.provider || 'anthropic') === 'ollama') {
    args.push('--tools', String(config.toolsLocali || STRUMENTI_LOCALI));
  }
  const mcpRoot = unityMcp.radiceProgetto(config.cwd) || config.cwd;
  const mcpFile = path.join(mcpRoot, 'claude_mcp.json');
  const unityStatus = unityMcp.stato(mcpRoot, config.engine || 'claude');
  if (unityStatus.isUnity && unityStatus.packageDependency && unityStatus.mcpConfigured && !fs.existsSync(mcpFile)) {
    const repaired = unityMcp.setup(mcpRoot, { engine: config.engine || 'claude' });
    if (!repaired.ok) console.error('[Unity MCP] Configurazione chat:', repaired.errore);
  }
  if (fs.existsSync(mcpFile)) {
    args.push('--mcp-config', mcpFile);
  }

  // Il prompt contiene a capo. Passarlo come argomento diretto rompe la riga di
  // comando che node-pty costruisce su Windows e la sessione terminale muore
  // all'avvio. Con il file non c'e' alcun problema di quoting.
  const appended = buildAppendedSystemPrompt();
  if (appended) {
    try {
      const promptFile = path.join(os.tmpdir(), 'adam-system-prompt-' + process.pid + '.txt');
      fs.writeFileSync(promptFile, appended, 'utf8');
      args.push('--append-system-prompt-file', promptFile);
    } catch (e) {
      console.error('[Prompt] Impossibile scrivere il file di sistema:', e.message);
    }
  }
  return args;
}

// Active PTY process and state
let ptyProcess = null;
let ptyBuffer = '';
const MAX_BUFFER = 100000; // 100 KB recent history for new connections
const clients = new Set();

function broadcast(msg) {
  const payload = typeof msg === 'string' ? msg : JSON.stringify(msg);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

let whatsappBridge = null;
function getAppWhatsAppBridge() {
  if (!whatsappBridge) {
    whatsappBridge = whatsappBridgeMod.getWhatsAppBridge({
      modello: config.model || 'qwen3.5-studio:9b',
      baseUrl: baseUrlForProvider('ollama'),
      apiKey: config.apiKey || '',
      authToken: config.authToken || ''
    });

    whatsappBridge.on('stato', (s) => {
      broadcast({ type: 'whatsapp:status', stato: s });
    });
    whatsappBridge.on('qr', (d) => {
      broadcast({ type: 'whatsapp:qr', qr: d.qr });
    });
    whatsappBridge.on('messaggio', (m) => {
      broadcast({ type: 'whatsapp:message', messaggio: m });
    });
    whatsappBridge.on('allarme', (a) => {
      broadcast({ type: 'whatsapp:alarm', allarme: a });
    });
    whatsappBridge.on('chat_list', (c) => {
      broadcast({ type: 'whatsapp:chat_list', contatti: c.contatti });
    });
  }
  return whatsappBridge;
}

// Testo dei prompt di fiducia cartella cosi' come li stampa Claude Code 2.1.x,
// sia nel rendering normale sia con --ax-screen-reader.
const TRUST_PROMPT_PATTERNS = [
  /enter\s+y\s*\/\s*n\s*:/i,
  /y\.\s*yes,\s*i trust this folder/i,
  /do you trust the files in this folder/i,
  /trust this (directory|folder)/i,
  /yes,\s*proceed/i,
  /proceed with/i
];
const MAX_AUTO_ACCEPT_ATTEMPTS = 5;

// 15 minuti: abbondante per una generazione lunga su GPU consumer, ma non infinito,
// cosi' una richiesta davvero bloccata prima o poi fallisce invece di restare appesa.
const DEFAULT_LOCAL_TIMEOUT_MS = 900000;

function stripAnsi(input) {
  return String(input)
    .replace(/\x1B\][\s\S]*?(?:\x07|\x1B\x5C)/g, '')
    .replace(/\x1B[[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PR-TZcf-nqry=><]/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

function startClaudeProcess() {
  if (ptyProcess) {
    try {
      ptyProcess.kill();
    } catch (e) {
      console.error('Error killing old process:', e);
    }
    ptyProcess = null;
  }

  // Supporto OpenCode come motore alternativo nel terminale
  if ((config.engine || 'claude') === 'opencode') {
    const opencodeExe = getOpencodeExecutable();
    const opencodeArgs = ['--auto'];
    if (config.model) {
      let mName = config.model;
      if (config.provider === 'ashna' || mName.startsWith('ashna/')) {
        mName = mName.startsWith('ashna/') ? mName : ('ashna/' + mName);
      } else if (config.provider === 'nvidia' || mName.startsWith('nvidia/')) {
        mName = mName.startsWith('nvidia/') ? mName : ('nvidia/' + mName);
      } else if (config.provider === 'custom' || mName.startsWith('openrouter/')) {
        mName = mName.startsWith('openrouter/') ? mName : ('openrouter/' + mName);
      }
      opencodeArgs.push('-m', mName);
    }
    const env = Object.assign({}, process.env, {
      FORCE_COLOR: '1',
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      OPENROUTER_API_KEY: getKeyForProvider('openrouter'),
      NVIDIA_API_KEY: getKeyForProvider('nvidia'),
      ASHNA_API_KEY: getKeyForProvider('ashna'),
      CEREBRAS_API_KEY: getKeyForProvider('cerebras'),
      OPENAI_API_KEY: getKeyForProvider('openai'),
      DEEPSEEK_API_KEY: getKeyForProvider('deepseek'),
      GEMINI_API_KEY: getKeyForProvider('gemini'),
      GROQ_API_KEY: getKeyForProvider('groq'),
      MISTRAL_API_KEY: getKeyForProvider('mistral'),
      ANTHROPIC_API_KEY: getKeyForProvider('anthropic')
    });

    console.log(`Starting OpenCode in ${config.cwd} with args:`, opencodeArgs);
    try {
      ptyProcess = pty.spawn(opencodeExe, opencodeArgs, {
        name: 'xterm-256color',
        cols: 100,
        rows: 30,
        cwd: config.cwd,
        env: env
      });

      const provLabel = config.provider === 'ashna' ? 'Ashna AI' : (config.provider === 'nvidia' ? 'NVIDIA NIM' : (config.provider === 'custom' ? 'OpenRouter' : 'Multi-Provider'));
      ptyBuffer = `\x1b[36m[NotExist Intelligience Studio]\x1b[0m Avvio sessione \x1b[32mOpenCode (${provLabel})\x1b[0m in: \x1b[33m${config.cwd}\x1b[0m\r\n\r\n`;
      broadcast({ type: 'output', data: ptyBuffer });
      broadcast({ type: 'status', running: true, cwd: config.cwd, engine: 'opencode' });

      ptyProcess.onData((data) => {
        ptyBuffer = (ptyBuffer + data).slice(-MAX_BUFFER);
        broadcast({ type: 'output', data });
      });

      ptyProcess.onExit(({ exitCode, signal }) => {
        console.log(`OpenCode process exited with code ${exitCode}, signal ${signal}`);
        ptyProcess = null;
        broadcast({ type: 'status', running: false });
        broadcast({ type: 'output', data: `\r\n\x1b[31m[Processo OpenCode terminato]\x1b[0m\r\n` });
      });
      return;
    } catch (err) {
      console.error('Failed to spawn OpenCode:', err);
      ptyBuffer += `\r\n\x1b[31mErrore avvio OpenCode: ${err.message}\x1b[0m\r\n`;
      broadcast({ type: 'output', data: ptyBuffer });
      broadcast({ type: 'status', running: false });
      return;
    }
  }

  const claudeExe = getClaudeExecutable();
  const args = [];

  args.push(...buildCommonArgs());

  // Flat UI Mode (Screen Reader mode) per una chat lineare
  if (config.flatUiMode) {
    args.push('--ax-screen-reader');
  }

  const env = resolveClaudeEnv();

  // Stesso isolamento della sessione chat: i settings di sessione hanno la precedenza
  // sui settings utente, cosi' un ANTHROPIC_* globale non dirotta il terminale.
  const settingsFile = writeSessionSettings(env);
  if (settingsFile) args.push('--settings', settingsFile);
  if ((config.provider || 'anthropic') === 'anthropic') {
    args.push('--setting-sources', 'project,local');
  }

  console.log(`Starting Claude in ${config.cwd} with args:`, args);
  console.log(`  provider=${config.provider || 'anthropic'} baseUrl=${env.ANTHROPIC_BASE_URL || '(ufficiale)'} model=${env.ANTHROPIC_MODEL || '(default)'} effort=${config.effort || 'high'} ragionamento=${env.MAX_THINKING_TOKENS !== undefined ? env.MAX_THINKING_TOKENS : '(default)'} timeout=${env.API_TIMEOUT_MS || '(default)'}`);

  try {
    ptyProcess = pty.spawn(claudeExe, args, {
      name: 'xterm-256color',
      cols: 100,
      rows: 30,
      cwd: config.cwd,
      env: env
    });

    ptyBuffer = `\x1b[36m[NotExist Intelligience Studio]\x1b[0m Avvio sessione in: \x1b[33m${config.cwd}\x1b[0m\r\n\r\n`;
    broadcast({ type: 'output', data: ptyBuffer });
    broadcast({ type: 'status', running: true, cwd: config.cwd });

    // Il prompt di fiducia arriva spezzato su piu' chunk, quindi il match va fatto su una
    // coda scorrevole e non sul singolo chunk. E non va "latchato" al primo match: la prima
    // scrittura puo' arrivare prima che il prompt sia pronto a leggere, quindi si ritenta.
    let acceptTail = '';
    let acceptAttempts = 0;
    let lastAcceptAt = 0;
    const trustSession = ptyProcess;

    ptyProcess.onData((data) => {
      if (config.autoAcceptFolder && acceptAttempts < MAX_AUTO_ACCEPT_ATTEMPTS) {
        acceptTail = (acceptTail + stripAnsi(data)).slice(-4000);
        const now = Date.now();
        if (TRUST_PROMPT_PATTERNS.some(re => re.test(acceptTail)) && now - lastAcceptAt > 1200) {
          lastAcceptAt = now;
          acceptAttempts += 1;
          console.log(`[Auto-Accept] Prompt di fiducia rilevato: rispondo "y" (tentativo ${acceptAttempts}).`);
          try {
            trustSession.write('y');
            // Alcuni prompt leggono il carattere e attendono la conferma separata.
            setTimeout(() => {
              try { if (ptyProcess === trustSession) trustSession.write('\r'); } catch (e) {}
            }, 120);
          } catch (e) {
            console.error('[Auto-Accept] Scrittura fallita:', e.message);
          }
          // Svuota la coda: accettato il prompt, non deve rimatchare sul testo vecchio.
          acceptTail = '';
        }
      }

      ptyBuffer += data;
      if (ptyBuffer.length > MAX_BUFFER) {
        ptyBuffer = ptyBuffer.slice(ptyBuffer.length - MAX_BUFFER);
      }
      broadcast({ type: 'output', data });
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      // Al riavvio il processo vecchio esce DOPO che quello nuovo e' stato assegnato:
      // senza questa guardia il gestore del vecchio azzerava il riferimento al nuovo,
      // e lo Studio dava per morta una sessione perfettamente viva.
      if (ptyProcess !== trustSession) return;

      const exitMsg = `\r\n\x1b[31m[Claude Code]\x1b[0m Sessione terminata (Codice: ${exitCode}, Segnale: ${signal}).\r\n\x1b[90mPremi il pulsante 'Riavvia Adam' per aprire una nuova sessione.\x1b[0m\r\n`;
      ptyBuffer += exitMsg;
      broadcast({ type: 'output', data: exitMsg });
      broadcast({ type: 'status', running: false, cwd: config.cwd });
      ptyProcess = null;
    });
  } catch (err) {
    const errorMsg = `\r\n\x1b[31m[Errore Avvio Claude]\x1b[0m ${err.message}\r\nVerifica che Claude Code sia installato correttamente (\`npm install -g @anthropic-ai/claude-code\`).\r\n`;
    ptyBuffer += errorMsg;
    broadcast({ type: 'output', data: errorMsg });
    broadcast({ type: 'status', running: false, cwd: config.cwd });
    ptyProcess = null;
  }
}


// ============================================================
// CHAT ENGINE
// Sessione headless `--print --output-format stream-json`: invece di scrapare il
// terminale riceviamo eventi JSON strutturati (testo, ragionamento, chiamate a
// strumenti, costi). E' questo che permette una vera UI a messaggi.
// ============================================================

let chatProc = null;
let chatStdoutTail = '';
let chatMessages = [];      // stato canonico della conversazione
let chatBusy = false;
let chatActivity = '';

// Sonda nel ciclo di chat (vedi "SONDA NEL CICLO DI CHAT").
let sondaDaRipetere = null;   // pagina misurata e fatti da ricontrollare dopo le modifiche
let sondaPreliminare = false; // true mentre si misura una pagina prima di rispondere
let messaggiInCoda = [];      // messaggi arrivati durante quella misura
let sondaInvioTimer = null;   // richiesta ad Adam in attesa che la chat si liberi
let revisoreInCorso = null;   // richiesta al revisore in corso, con il suo annulla()
let guardiaInCorso = false;   // collaudi rieseguiti dopo un turno normale
let istantaneaTurno = null;   // copia del progetto fatta all'inizio dell'ultimo turno di Adam
let avvisoIstantanea = '';     // non ripetere lo stesso avviso a ogni turno di un progetto grande
let conversazioneId = archivioChat.nuovoId();  // la conversazione visibile, anche attraverso i rinnovi
let conversazioneDir = config.cwd;              // il progetto a cui appartiene, per salvarla nel posto giusto
let interazioniGuidate = dialogoGuidato.carica(config.cwd, conversazioneId);
// base: contesto occupato alla prima risposta di una sessione nuova (prompt di sistema, strumenti,
// eventuale report di passaggio). Dice se aprire una sessione nuova libera davvero spazio.
const contestoChat = { usati: null, limite: null, modello: null, base: null, avvisoPiccolo: false };
const SOGLIA_RINNOVO = 70;    // % di contesto oltre cui, a fine turno, si riparte da una sessione nuova
// Se una sessione appena aperta supera gia' SOGLIA_RINNOVO - MARGINE_RINNOVO, rinnovare non serve:
// Adam ricomincerebbe da capo all'infinito (visti 9 passaggi in due ore con una finestra da 16k).
const MARGINE_RINNOVO = 15;
// Con la compattazione nativa attiva, il rinnovo di sessione diventa solo una rete di sicurezza: la
// sua soglia va alzata sopra il punto in cui scatta la compattazione (~68%), altrimenti lo Studio
// ucciderebbe la sessione proprio quando Claude Code sta per riassumere e proseguire.
const SOGLIA_RINNOVO_CON_COMPATTAZIONE = 90;

// La compattazione nativa e' attiva quando: provider locale, opzione accesa, e finestra del modello
// nota (senza la finestra non impostiamo i parametri, quindi Claude Code non compatta in tempo).
function compattazioneAttiva() {
  return (config.provider || 'anthropic') !== 'anthropic'
    && config.autoCompatta !== false
    && !!finestraModelloToken[(config.model || '').trim()];
}

function sogliaRinnovo() {
  return compattazioneAttiva() ? SOGLIA_RINNOVO_CON_COMPATTAZIONE : SOGLIA_RINNOVO;
}
// Token generati nel turno in corso, per il contatore dal vivo accanto a "Adam sta ...".
// Durante lo streaming sono stimati dai caratteri; message_delta porta poi quelli veri.
const progressoTurno = { reali: 0, caratteri: 0, caratteriMessaggio: 0, blocco: null, inviato: 0, timer: null, silenzio: null };
let riassuntoDaInviare = '';  // riassunto per la sessione aperta dopo un contesto pieno
let recuperiContesto = 0;     // sessioni riaperte per contesto pieno nella stessa richiesta
let chatSessionInfo = null;
let chatSessionId = null;
let chatMsgSeq = 0;
let autoContinueCount = 0;   // riprese gia' fatte per il turno utente corrente
let autoContinueTimer = null;
const MAX_CHAT_MESSAGES = 300;

function chatBroadcast(event, payload) {
  broadcast(Object.assign({ type: 'chat', event: event }, payload || {}));
}

function newMessage(role, blocks) {
  chatMsgSeq += 1;
  return {
    id: 'm' + Date.now() + '_' + chatMsgSeq,
    role: role,
    ts: Date.now(),
    blocks: blocks || []
  };
}

function pushChatMessage(message) {
  chatMessages.push(message);
  if (chatMessages.length > MAX_CHAT_MESSAGES) {
    chatMessages = chatMessages.slice(-MAX_CHAT_MESSAGES);
  }
  chatBroadcast('message', { message: message });
  return message;
}

let ultimaMisuraInternet = { quando: 0, stato: 'ok', latenza: 0, errore: null };
let turnoAvvisoReteInviato = false;
let timerControlloRete = null;

const RETE_ERR_PATTERNS = [
  /fetch failed/i,
  /ENOTFOUND/i,
  /ETIMEDOUT/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /EAI_AGAIN/i,
  /socket hang up/i,
  /network error/i,
  /api connection error/i,
  /connect ETIMEDOUT/i,
  /getaddrinfo/i,
  /connection reset/i,
  /overloaded_error/i,
  /slow network/i,
  /request timed out/i,
  /gateway timeout/i
];

function rilevaErroreDiRete(testo) {
  const t = String(testo || '');
  // Gli errori di quota/crediti e modello non disponibile NON sono errori di rete
  if (rilevaErroreQuota(t)) return false;
  if (rilevaErroreModello(t)) return false;
  return RETE_ERR_PATTERNS.some(function (re) { return re.test(t); });
}

function estraiDettaglioRete(testo) {
  const t = String(testo || '').replace(/\s+/g, ' ').trim();
  for (const re of RETE_ERR_PATTERNS) {
    const m = t.match(re);
    if (m) return m[0];
  }
  return 'problema di rete';
}

// ── Rilevamento errori di quota / crediti esauriti ──────────────────────────
const QUOTA_ERR_PATTERNS = [
  /exceeded.*quota/i,
  /rate.?limit/i,
  /429/,
  /quota exceeded/i,
  /billing/i,
  /insufficient.?(?:credits?|funds?|balance)/i,
  /free.?tier.*(?:limit|exceeded|count)/i,
  /too many requests/i,
  /plan.*(?:limit|exceeded)/i,
  /usage.*(?:limit|exceeded)/i,
  /credit/i
];

function rilevaErroreQuota(testo) {
  const t = String(testo || '');
  return QUOTA_ERR_PATTERNS.some(function (re) { return re.test(t); });
}

function estraiDettaglioQuota(testo) {
  const t = String(testo || '').replace(/\s+/g, ' ').trim();
  if (/exceeded.*quota|quota exceeded/i.test(t)) return 'quota esaurita';
  if (/rate.?limit|429|too many requests/i.test(t)) return 'limite di richieste raggiunto';
  if (/insufficient.?credits?|insufficient.?funds?|insufficient.?balance/i.test(t)) return 'crediti insufficienti';
  if (/free.?tier/i.test(t)) return 'limite piano gratuito raggiunto';
  if (/billing/i.test(t)) return 'problema di fatturazione';
  return 'quota o crediti esauriti';
}

// ── Rilevamento errori modello non disponibile / ritirato ───────────────────
const MODELLO_ERR_PATTERNS = [
  /no longer available/i,
  /end of life/i,
  /model.*not.?(?:found|exist|available|supported)/i,
  /issue with the selected model/i,
  /does not exist/i,
  /not have access/i,
  /has been (?:retired|deprecated|removed|discontinued)/i,
  /410/,
  /Gone/,
  /unknown model/i,
  /invalid model/i,
  /model.*(?:decommissioned|sunset|unavailable)/i
];

function rilevaErroreModello(testo) {
  const t = String(testo || '');
  return MODELLO_ERR_PATTERNS.some(function (re) { return re.test(t); });
}

function estraiNomeModello(testo) {
  const t = String(testo || '');
  // Cerca pattern come 'model (nome)' o 'model "nome"' o 'model 'nome''
  const m = t.match(/model\s*[\('"]([^)'"]+)[\)'"]/i) ||
            t.match(/model\s+'([^']+)'/i) ||
            t.match(/model\s+"([^"]+)"/i);
  return m ? m[1] : null;
}

function estraiDettaglioModello(testo) {
  const t = String(testo || '').replace(/\s+/g, ' ').trim();
  const nome = estraiNomeModello(t);
  const prefisso = nome ? ('Il modello "' + nome + '"') : 'Il modello selezionato';
  if (/no longer available|end of life|retired|deprecated|discontinued|sunset/i.test(t)) {
    return prefisso + ' è stato ritirato e non è più disponibile';
  }
  if (/not.?found|does not exist|unknown model|invalid model/i.test(t)) {
    return prefisso + ' non esiste su questo provider';
  }
  if (/not have access/i.test(t)) {
    return prefisso + ' non è accessibile con la tua chiave API';
  }
  return prefisso + ' non è disponibile';
}
async function misuraSaluteInternet(forza) {
  const ora = Date.now();
  if (!forza && (ora - ultimaMisuraInternet.quando < 6000)) {
    return ultimaMisuraInternet;
  }

  let targetUrl = 'https://api.anthropic.com';
  if ((config.provider || 'anthropic') === 'custom' && config.baseUrl) {
    try {
      const u = new URL(config.baseUrl);
      targetUrl = u.origin;
    } catch (e) {
      targetUrl = 'https://api.anthropic.com';
    }
  }

  const t0 = Date.now();
  try {
    const res = await checkUrl(targetUrl, 3500);
    const latenza = Date.now() - t0;
    if (res.ok) {
      const stato = latenza > 1300 ? 'lenta' : 'ok';
      ultimaMisuraInternet = { quando: Date.now(), stato: stato, latenza: latenza, errore: null };
      return ultimaMisuraInternet;
    }

    // Prova di riserva su https://www.google.com per verificare connettivita' internet generale
    const tBackup = Date.now();
    const backup = await checkUrl('https://www.google.com', 2500);
    const latenzaBackup = Date.now() - tBackup;
    if (backup.ok) {
      const stato = latenzaBackup > 1300 ? 'lenta' : 'ok';
      ultimaMisuraInternet = { quando: Date.now(), stato: stato, latenza: latenzaBackup, errore: null };
      return ultimaMisuraInternet;
    }

    ultimaMisuraInternet = {
      quando: Date.now(),
      stato: 'offline',
      latenza: latenza,
      errore: res.error || backup.error || 'timeout'
    };
    return ultimaMisuraInternet;
  } catch (err) {
    ultimaMisuraInternet = {
      quando: Date.now(),
      stato: 'offline',
      latenza: Date.now() - t0,
      errore: err.message
    };
    return ultimaMisuraInternet;
  }
}

function avviaControlloReteTurno() {
  fermaControlloReteTurno();
  turnoAvvisoReteInviato = false;
  // Se dopo 7 secondi il modello e' ancora occupato e non risponde,
  // verifichiamo la linea per capire se sta faticando a ricevere o inviare i dati.
  timerControlloRete = setTimeout(async function () {
    timerControlloRete = null;
    if (!chatBusy) return;
    try {
      const salute = await misuraSaluteInternet(true);
      if (!chatBusy) return;
      if (salute.stato === 'offline') {
        setChatBusy(true, '⚠️ Rete assente: il modello fa fatica a ricevere o inviare...');
        if (!turnoAvvisoReteInviato) {
          turnoAvvisoReteInviato = true;
          chatSystemMessage('⚠️ Connessione Internet assente: il modello non riesce a ricevere o inviare i dati. Verifica la tua connessione di rete.', 'warn');
          chatBroadcast('chat', { event: 'network-warning', stato: 'offline', messaggio: 'Connessione Internet assente: il modello fa fatica a comunicare.' });
        }
      } else if (salute.stato === 'lenta') {
        setChatBusy(true, '⚠️ Connessione debole (' + salute.latenza + ' ms): il modello sta faticando...');
        if (!turnoAvvisoReteInviato) {
          turnoAvvisoReteInviato = true;
          chatSystemMessage('⚠️ Connessione Internet debole o instabile (' + salute.latenza + ' ms): il modello sta riscontrando lentezza nel ricevere la richiesta o inviare la risposta.', 'warn');
          chatBroadcast('chat', { event: 'network-warning', stato: 'lenta', latenza: salute.latenza, messaggio: 'Connessione Internet debole o instabile: il modello sta faticando.' });
        }
      }
    } catch (e) {
      console.error('[Rete] Controllo salute fallito:', e.message);
    }
  }, 7000);
}

function fermaControlloReteTurno() {
  if (timerControlloRete) {
    clearTimeout(timerControlloRete);
    timerControlloRete = null;
  }
}

function rilevaErroreDiReteStderr(text) {
  if (!text) return;
  // Priorità: se è un errore di quota/crediti, segnalalo come tale
  if (rilevaErroreQuota(text)) {
    if (!turnoAvvisoReteInviato) {
      turnoAvvisoReteInviato = true;
      const prov = (config.provider || 'anthropic').toUpperCase();
      const dettaglio = estraiDettaglioQuota(text);
      chatSystemMessage(
        '⚠️ ' + prov + ': ' + dettaglio +
        '. Puoi attendere il reset della quota, cambiare provider o aggiornare il piano.',
        'error'
      );
      chatBroadcast('chat', {
        event: 'network-warning',
        stato: 'quota',
        messaggio: prov + ': ' + dettaglio
      });
      setChatBusy(true, '⚠️ Quota esaurita...');
    }
    return;
  }
  // Se è un errore di modello non disponibile/ritirato
  if (rilevaErroreModello(text)) {
    if (!turnoAvvisoReteInviato) {
      turnoAvvisoReteInviato = true;
      const prov = (config.provider || 'anthropic').toUpperCase();
      const dettaglio = estraiDettaglioModello(text);
      chatSystemMessage(
        '🚫 ' + prov + ': ' + dettaglio +
        '. Seleziona un modello diverso dalla tendina.',
        'error'
      );
      chatBroadcast('chat', {
        event: 'network-warning',
        stato: 'model-error',
        messaggio: prov + ': ' + dettaglio
      });
      setChatBusy(true, '🚫 Modello non disponibile...');
    }
    return;
  }
  if (rilevaErroreDiRete(text)) {
    if (!turnoAvvisoReteInviato) {
      turnoAvvisoReteInviato = true;
      const dettaglio = estraiDettaglioRete(text);
      chatSystemMessage(
        '⚠️ Difficoltà di connessione Internet: il modello fa fatica a ricevere o inviare i dati (' + dettaglio + '). Verifica la connessione di rete.',
        'error'
      );
      chatBroadcast('chat', {
        event: 'network-warning',
        stato: 'offline',
        messaggio: 'Errore di rete del modello: ' + dettaglio
      });
      setChatBusy(true, '⚠️ Errore di connessione di rete...');
    }
  }
}

function setChatBusy(value, activity) {
  const nextActivity = value ? (activity || chatActivity || '') : '';
  if (chatBusy === value && chatActivity === nextActivity) return;
  // Il contatore dei token riparte a ogni turno e si ferma quando il turno finisce.
  if (value !== chatBusy) {
    azzeraProgressoTurno();
    if (value) {
      avviaControlloReteTurno();
    } else {
      fermaControlloReteTurno();
    }
  }
  chatBusy = value;
  chatActivity = nextActivity;
  chatBroadcast('busy', { busy: chatBusy, activity: chatActivity });
}

// Circa 3,2 caratteri per token: il rapporto misurato su questa macchina (vedi la memoria).
const CARATTERI_PER_TOKEN = 3.2;

function tokenDelTurno() {
  return progressoTurno.reali + Math.round(progressoTurno.caratteri / CARATTERI_PER_TOKEN);
}

function azzeraProgressoTurno() {
  if (progressoTurno.timer) clearTimeout(progressoTurno.timer);
  progressoTurno.timer = null;
  if (progressoTurno.silenzio) clearTimeout(progressoTurno.silenzio);
  progressoTurno.silenzio = null;
  progressoTurno.reali = 0;
  progressoTurno.caratteri = 0;
  progressoTurno.caratteriMessaggio = 0;
  progressoTurno.blocco = null;
}

// Un evento per ogni delta intaserebbe il websocket: al massimo uno ogni 250 ms.
function inviaProgressoTurno() {
  if (progressoTurno.timer) return;
  const attesa = Math.max(0, 250 - (Date.now() - progressoTurno.inviato));
  progressoTurno.timer = setTimeout(function () {
    progressoTurno.timer = null;
    progressoTurno.inviato = Date.now();
    chatBroadcast('progresso', { token: tokenDelTurno() });
  }, attesa);
}

// MISURATO: Ollama non trasmette l'input di uno strumento mentre il modello lo scrive. Lo manda
// tutto insieme alla fine, e solo allora chiude anche il blocco di ragionamento: nella prova dal
// vivo 23 secondi senza alcun evento prima di una Write di 150 righe, con la chat ferma su
// "ragionando" e il contatore immobile. Se un blocco di ragionamento o di testo resta muto per
// qualche secondo, il modello sta quasi certamente scrivendo l'input di uno strumento.
const ETICHETTA_SILENZIO = 'Adam sta preparando il prossimo passo...';
// Con il contesto quasi pieno, un silenzio prolungato e' quasi sempre la compattazione nativa in
// corso (Claude Code riassume la conversazione con una chiamata a parte, che non emette eventi).
const ETICHETTA_RIASSUNTO = 'Adam sta riassumendo la memoria per non fermarsi...';
const ETICHETTE_SILENZIO = [ETICHETTA_SILENZIO, ETICHETTA_RIASSUNTO];
const SILENZIO_MS = 4000;

function programmaAvvisoSilenzio() {
  if (progressoTurno.silenzio) clearTimeout(progressoTurno.silenzio);
  progressoTurno.silenzio = null;
  if (progressoTurno.blocco !== 'thinking' && progressoTurno.blocco !== 'text') return;
  progressoTurno.silenzio = setTimeout(function () {
    progressoTurno.silenzio = null;
    if (chatBusy && (progressoTurno.blocco === 'thinking' || progressoTurno.blocco === 'text')) {
      misuraSaluteInternet().then(function (salute) {
        if (!chatBusy) return;
        if (salute.stato === 'offline') {
          setChatBusy(true, '⚠️ Connessione assente: il modello non riesce a comunicare');
          if (!turnoAvvisoReteInviato) {
            turnoAvvisoReteInviato = true;
            chatSystemMessage('⚠️ Connessione Internet assente: il modello fa fatica a ricevere o inviare i dati.', 'warn');
          }
          return;
        }
        if (salute.stato === 'lenta') {
          setChatBusy(true, '⚠️ Connessione lenta (' + salute.latenza + ' ms): il modello sta faticando...');
          if (!turnoAvvisoReteInviato) {
            turnoAvvisoReteInviato = true;
            chatSystemMessage('⚠️ Connessione Internet debole o instabile: il modello fa fatica a ricevere o inviare.', 'warn');
          }
          return;
        }
        const st = statoContesto();
        setChatBusy(true, (st.percento !== null && st.percento >= 55) ? ETICHETTA_RIASSUNTO : ETICHETTA_SILENZIO);
      }).catch(function () {
        const st = statoContesto();
        setChatBusy(true, (st.percento !== null && st.percento >= 55) ? ETICHETTA_RIASSUNTO : ETICHETTA_SILENZIO);
      });
    }
  }, SILENZIO_MS);
}

function generaSuggerimentiCorrenti(opzioni = {}) {
  if (!config.cwd) return [];
  let piano = null;
  try {
    piano = opzioni.piano || capoProgetto.leggi(config.cwd);
  } catch (e) {}

  const ultimoTesto = currentTurnText();
  return suggerimentiPassi.generaAzioniRapide({
    projectDir: config.cwd,
    lastTurnText: ultimoTesto,
    piano: piano,
    lastSystemMessage: opzioni.lastSystemMessage || '',
    failures: opzioni.failures || []
  });
}

function chatSystemMessage(text, level, actions) {
  const message = newMessage('system', [{ kind: 'text', text: text }]);
  message.level = level || 'info';
  if (actions && Array.isArray(actions) && actions.length > 0) {
    message.actions = actions;
  }
  return pushChatMessage(message);
}

// ============================================================
// AVANZAMENTO
// Le verifiche durano decine di secondi (browser, collaudi, revisore): una scheda nella
// chat mostra le fasi, quale e' in corso e cosa sta facendo, invece di un'attesa muta.
// E' un messaggio della chat come gli altri, cosi' sopravvive a un ricaricamento della
// pagina; Adam non lo riceve mai.
// ============================================================

const timerAvanzamento = new Map();

function nuovoAvanzamento(titolo, fasi) {
  const m = newMessage('progress', []);
  m.titolo = titolo;
  m.fasi = fasi.map(function (f) {
    return { id: f[0], nome: f[1], stato: 'attesa', dettaglio: '', inizio: null, fine: null };
  });
  m.inizio = Date.now();
  m.fine = null;
  m.esito = null;
  m.focus = '';
  m.riassunto = '';
  m.ora = Date.now();
  return pushChatMessage(m);
}

// I dettagli (secondi, caratteri scritti) arrivano fitti: al massimo due invii al secondo.
// Un cambio di fase parte subito.
function inviaAvanzamento(m, subito) {
  if (!m) return;
  if (subito) {
    clearTimeout(timerAvanzamento.get(m.id));
    timerAvanzamento.delete(m.id);
    m.ora = Date.now();
    chatBroadcast('message-update', { message: m });
    return;
  }
  if (timerAvanzamento.has(m.id)) return;
  timerAvanzamento.set(m.id, setTimeout(function () {
    timerAvanzamento.delete(m.id);
    m.ora = Date.now();
    chatBroadcast('message-update', { message: m });
  }, 500));
}

// stato: 'attesa' | 'corso' | 'ok' | 'warn' | 'err' | 'saltata'; null lascia lo stato e
// cambia solo il dettaglio.
function fase(m, id, stato, dettaglio) {
  if (!m) return;
  const f = m.fasi.find(function (x) { return x.id === id; });
  if (!f) return;
  const cambia = !!stato && stato !== f.stato;
  if (stato) {
    if (stato === 'corso' && !f.inizio) f.inizio = Date.now();
    if (stato !== 'corso' && stato !== 'attesa' && !f.fine) f.fine = Date.now();
    f.stato = stato;
  }
  if (dettaglio !== undefined && dettaglio !== null) f.dettaglio = String(dettaglio).slice(0, 220);
  inviaAvanzamento(m, cambia);
}

function chiudiAvanzamento(m, esito, riassunto) {
  if (!m || m.fine) return;
  m.fasi.forEach(function (f) {
    if (f.stato === 'attesa') f.stato = 'saltata';
    if (f.stato === 'corso') {
      f.stato = esito === 'err' ? 'err' : 'ok';
      f.fine = Date.now();
    }
  });
  m.fine = Date.now();
  m.esito = esito || 'ok';
  if (riassunto) m.riassunto = String(riassunto).slice(0, 400);
  inviaAvanzamento(m, true);
}

function accorciaTesto(testo, max) {
  const t = String(testo || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

// ============================================================
// REVISORE E COLLAUDI (strumenti/collaudatore.js)
// Un secondo modello scrive prove di cio' che la pagina promette; lo Studio le esegue in
// un browser isolato. Quelle che falliscono sono difetti da passare ad Adam; quelle che
// passano sono capacita' da proteggere: se dopo una modifica non passano piu', e' una
// regressione. Il revisore non ha strumenti: non puo' modificare nulla.
// ============================================================

function revisoreDisponibile() {
  if (config.revisore === false) return { ok: false, motivo: 'revisore spento nelle impostazioni' };
  if ((config.provider || 'anthropic') !== 'ollama') return { ok: false, motivo: 'per ora disponibile solo con Ollama' };
  if (!(config.revisoreModel || config.model)) return { ok: false, motivo: 'nessun modello configurato' };
  return { ok: true };
}

function riassuntoMisura(r) {
  if (!r || r.errore) return 'non riuscita' + (r && r.errore ? ': ' + r.errore : '');
  const n = misure.fattiDellaSonda(r).length;
  return n === 0 ? 'nessun difetto misurato' : n + (n === 1 ? ' problema misurato' : ' problemi misurati');
}

// La sonda dei flussi serve dove ci sono flussi da percorrere (campi, caselle, liste): sui giochi
// la sonda generica copre gia' clic, mouse e riavvio.
function esploratriceAdatta(dir, pagina, misura, revisore) {
  if (config.esploratrice === false) return { ok: false, motivo: 'spenta nelle impostazioni' };
  if (!revisore || !revisore.ok) return { ok: false, motivo: (revisore && revisore.motivo) || 'modello non disponibile' };
  let html = '';
  try { html = fs.readFileSync(path.join(dir, pagina), 'utf8'); } catch (e) { /* pagina illeggibile */ }
  const haCampi = (misura && misura.compilati && misura.compilati.length) || /<(input|textarea|select)\b/i.test(html);
  return haCampi ? { ok: true } : { ok: false, motivo: 'nessun campo da compilare: la sonda generica basta' };
}

// Un collaudo dell'esploratrice con lo stesso nome di uno del revisore non lo sostituisce.
function nomiDistinti(collaudi, altri) {
  const presi = new Set((altri || []).map(function (c) { return c.nome.toLowerCase(); }));
  return (collaudi || []).map(function (c) {
    let nome = c.nome;
    if (presi.has(nome.toLowerCase())) nome = (nome + ' (percorso reale)').slice(0, 90);
    presi.add(nome.toLowerCase());
    return Object.assign({}, c, { nome: nome, origine: 'esploratrice' });
  });
}

// Esegue i collaudi aggiornando la fase idFase della scheda. precedenti = esiti di
// riferimento { nome: 'superato' | 'fallito' }: servono a riconoscere le regressioni.
async function provaCollaudi(av, idFase, dir, pagina, collaudi, precedenti) {
  if (!collaudi || !collaudi.length) {
    fase(av, idFase, 'saltata', 'nessun collaudo');
    return null;
  }
  fase(av, idFase, 'corso', collaudi.length + ' collaudi da eseguire');
  let ec;
  try {
    ec = await eseguiCollaudi({
      pagina: pagina, dir: dir, collaudi: collaudi,
      // Chi non e' ancora una guardia deve passare due volte per diventarlo.
      confermaSuperati: collaudi
        .filter(function (c) { return (precedenti || {})[c.nome] !== 'superato'; })
        .map(function (c) { return c.nome; }),
      progresso: function (t) { fase(av, idFase, null, t); }
    });
  } catch (e) {
    ec = { errore: e.message, esiti: [] };
  }
  if (ec.errore) {
    fase(av, idFase, 'err', 'non riuscita: ' + ec.errore);
    return null;
  }
  const fc = collaudatore.fattiDaiCollaudi(ec.esiti, precedenti || {}, collaudi);
  // Il motivo di ogni scarto si registra: visto dal vivo, 4 collaudi su 6 scartati senza
  // sapere perche' non si potevano correggere ne' capire cosa restava da provare.
  fc.scartati.forEach(function (x) { console.log('[Collaudi] Scartato «' + x.nome + '»: ' + x.motivo); });
  const problemi = fc.falliti.length + fc.regressioni.length;
  fase(av, idFase, problemi ? 'warn' : 'ok',
    fc.superati.length + '/' + ec.esiti.length + ' superati' +
    (fc.falliti.length ? ', ' + fc.falliti.length + ' falliti' : '') +
    (fc.regressioni.length ? ', ' + fc.regressioni.length + (fc.regressioni.length === 1 ? ' regressione' : ' regressioni') : '') +
    (fc.nonProvati.length ? ', ' + fc.nonProvati.length + ' non provati' : '') +
    (fc.scartati.length ? ', ' + fc.scartati.length + ' scartati perche\' sbagliati' : ''));
  console.log('[Collaudi] ' + pagina + ': ' + fc.superati.length + ' superati, ' + fc.falliti.length + ' falliti, ' +
    fc.regressioni.length + ' regressioni, ' + fc.nonProvati.length + ' non provati, ' + fc.scartati.length + ' scartati.');
  return { esiti: ec.esiti, fatti: fc };
}

// Nel messaggio ad Adam i collaudi falliti compaiono per nome: il testo completo arriva
// quando diventano il focus, per non riempire il contesto di un modello piccolo.
function sezioneCollaudi(prova, nonVerificati, richiesta) {
  if (!prova) return '';
  const fc = prova.fatti;
  const nome = function (f) { return (String(f).match(/«([^»]*)»/) || [])[1] || f; };
  const pertinenti = function (elenco) {
    return richiesta === undefined ? (elenco || []) : misure.fattiPertinenti(elenco || [], richiesta);
  };
  const dubbi = pertinenti(nonVerificati || []);
  const superati = pertinenti(fc.superati);
  const regressioni = pertinenti(fc.regressioni);
  const falliti = pertinenti(fc.falliti).filter(function (f) { return dubbi.indexOf(f) === -1; });
  const nonProvati = pertinenti(fc.nonProvati);
  if (!superati.length && !regressioni.length && !falliti.length && !dubbi.length && !nonProvati.length) return '';
  const righe = ['COLLAUDI: prove eseguite dallo Studio in un browser. Quelli che iniziano con "Come promesso" o ' +
    '"Funziona" vengono dalla sonda dei flussi: lo Studio ha usato la pagina, ha confrontato le misure con la ' +
    'descrizione e li ha verificati. Gli altri li ha scritti un revisore a partire dalla descrizione.'];
  if (superati.length) righe.push('SUPERATI - funzionano e devono continuare a funzionare:\n' + elencoPuntato(superati));
  if (regressioni.length) righe.push('REGRESSIONI - funzionavano e ora no:\n' + elencoPuntato(regressioni.map(nome)));
  if (falliti.length) righe.push('FALLITI:\n' + elencoPuntato(falliti.map(nome)));
  if (dubbi.length) {
    righe.push('NON VERIFICATI - collaudi del revisore che falliscono ma che la sonda dei flussi non conferma: un ' +
      'modello puo\' averli scritti male. NON modificare il codice solo per farli passare; se la descrizione non ' +
      'chiede chiaramente quella cosa, lasciali stare:\n' + elencoPuntato(dubbi.map(nome)));
  }
  if (nonProvati.length) righe.push('NON ESEGUIBILI in questa prova: ' + nonProvati.join(', '));
  return righe.join('\n');
}

// FOCUS: un problema alla volta, per intero; gli altri in breve, perche' Adam sappia che
// esistono ma non ci si butti sopra.
function sezioneFocus(focus, fatti) {
  if (!focus) return '';
  const altri = (fatti || []).filter(function (f) { return f !== focus; });
  return [
    'DIAGNOSTICA DELLO STUDIO (rilevamento automatico sulla pagina):',
    focus,
    'Nota: la priorità principale è la richiesta dell\'utente sopra. Usa questa diagnostica come supporto per comprendere lo stato ed evitare regressioni.',
    altri.length
      ? 'Altri elementi rilevati sulla pagina:\n' + elencoPuntato(altri.map(function (f) { return accorciaTesto(f, 150); }))
      : ''
  ].filter(Boolean).join('\n');
}

// ============================================================
// PRIMA/DOPO E MEMORIA AUTOMATICA
// ============================================================

// Copia del progetto all'inizio di un turno di Adam: e' il "prima" con cui si decide se un
// collaudo che ora fallisce l'ha rotto quel turno (strumenti/istantanee.js), e con cui si vede
// cosa e' cambiato sul disco durante il turno (registraCambiamentiDelTurno). Si fa anche con la
// verifica automatica spenta: costa pochi KB in una cartella temporanea ed e' l'unica copia da
// cui si puo' rimettere un file com'era. Solo a inizio turno vero: una ripresa automatica arriva
// quando Adam puo' aver gia' cambiato dei file.
function fotografaPrimaDelTurno() {
  if (!config.cwd) return;
  try {
    const esito = istantanee.scattaConEsito(config.cwd);
    const foto = esito.foto;
    istantaneaTurno = foto ? Object.assign({ progetto: path.resolve(config.cwd).toLowerCase() }, foto) : null;
    if (!esito.ok && esito.motivo !== 'progetto-vuoto') {
      const chiave = path.resolve(config.cwd).toLowerCase() + ':' + esito.motivo;
      console.warn('[Istantanea] Non disponibile: ' + esito.motivo +
        (esito.file ? ' (' + esito.file + ' file, ' + esito.byte + ' byte)' : ''));
      if (avvisoIstantanea !== chiave) {
        avvisoIstantanea = chiave;
        chatSystemMessage('Avviso di sicurezza: non posso creare la copia di ripristino prima del turno (' +
          esito.motivo + '). Le modifiche restano confinate e verificate, ma per questo progetto non posso ' +
          'attribuire o ripristinare automaticamente una regressione.', 'warn');
      }
    } else if (esito.ok) {
      avvisoIstantanea = '';
    }
  } catch (e) {
    istantaneaTurno = null;
    console.error('[Istantanea] Non riuscita:', e.message);
  }
}

// Cosa e' cambiato sul disco durante il turno: la copia di inizio turno contro i file di adesso
// (strumenti/cambiamenti.js). Serve perche' il diario registra solo i file toccati con Edit e
// Write: un cp, un unzip o una cancellazione da Bash non comparivano da nessuna parte. E' cosi'
// che il 17/9/2026 uno style.css di 425 righe e' stato coperto da quello di uno zip senza che
// nessuno se ne accorgesse, e Adam - che non aveva piu' in memoria il comando dato undici minuti
// prima - ha spiegato all'utente che il file "si era troncato" e l'ha riscritto a memoria.
// Di ogni file toccato si mette da parte la versione di prima: il cestino di strumenti/ripristina.js.
let avvisoCambiamentiFatto = null;   // chiave dell'istantanea gia' segnalata: non si ripete a ogni ripresa

function fileToccatoAMano(rel) {
  const pieno = path.resolve(config.cwd || '.', rel).toLowerCase();
  return Array.from(turnTouchedFiles).some(function (f) {
    try { return path.resolve(config.cwd || '.', String(f)).toLowerCase() === pieno; } catch (e) { return false; }
  });
}

function registraCambiamentiDelTurno() {
  // Tutto dentro un try: se il confronto dei file dovesse fallire, il turno di Adam continua.
  try {
    const foto = istantaneaTurno;
    if (!config.cwd || !foto || !foto.dir) return null;
    if (foto.progetto !== path.resolve(config.cwd).toLowerCase()) return null;
    let r = null;
    try {
      r = cambiamenti.confronta(foto.dir, config.cwd);
    } catch (e) {
      console.error('[Cambiamenti] Confronto non riuscito:', e.message);
      return null;
    }
    if (!r || !r.voci.length) return null;
    // Comprende anche cp, unzip e generatori lanciati da Bash: questi file devono
    // entrare nella stessa verifica di Edit/Write, non restare invisibili.
    r.voci.forEach(function (voce) {
      if (voce.tipo !== 'sparito') turnTouchedFiles.add(path.join(config.cwd, voce.rel));
    });
    const chiave = String(foto.quando || '');
    try { ripristino.mettiDalConfronto(config.cwd, r, {}); } catch (e) { console.error('[Cestino] Copia non riuscita:', e.message); }
    try { cambiamenti.registra(config.cwd, r, { chiave: chiave }); } catch (e) { /* lo storico non e' indispensabile */ }
    // Un modello 3D cambiato nel turno (anche da Blender lanciato da Adam): il pannello 3D si ricarica.
    const modello3d = r.voci.find(function (v) { return v.tipo !== 'sparito' && /\.(glb|gltf)$/i.test(v.rel); });
    if (modello3d) chatBroadcast('files-changed', { file: path.join(config.cwd, modello3d.rel) });
    const perdite = cambiamenti.perdite(r);
    console.log('[Cambiamenti] ' + r.voci.length + ' file cambiati' +
      (perdite.length ? ', di cui ' + perdite.length + ' con perdite: ' + perdite.map(function (v) { return cambiamenti.descriviVoce(v); }).join(' | ') : ''));
    if (!perdite.length || avvisoCambiamentiFatto === chiave) return r;
    avvisoCambiamentiFatto = chiave;
    chatSystemMessage('In questo turno dei file hanno perso quello che contenevano:\n' +
      elencoPuntato(perdite.slice(0, 4).map(function (v) { return cambiamenti.descriviVoce(v); })) +
      '\nLa versione di prima ce l\'ho da parte: se non era voluto scrivimi "rimetti ' +
      (perdite[0] ? perdite[0].rel : 'il file') + ' com\'era".', 'warn');
    // Perdite su file che Adam NON ha toccato con Edit o Write: gliele ha fatte un comando (cp,
    // copy, del, unzip) e quasi sicuramente non se n'e' accorto. E' l'unico caso in cui conviene
    // spendere un turno per dirglielo subito: se lo scopre due turni dopo si inventa una causa.
    // Se e' gia' in arrivo il quadro della situazione si sta zitti: le perdite recenti ci sono dentro.
    const inconsapevoli = perdite.filter(function (v) { return !fileToccatoAMano(v.rel); });
    if (!inconsapevoli.length || quadroInSospeso) return r;
    const avviso = [
      'ATTENZIONE: lo Studio ha confrontato il disco prima e dopo il tuo turno. Questi file hanno perso ' +
        'quello che contenevano e NON li hai modificati con Edit o Write: li ha cambiati un comando (cp, copy, del, unzip...).',
      cambiamenti.testo({ voci: inconsapevoli }, {
        titolo: 'FILE CAMBIATI SENZA Edit/Write:',
        cartellaStrumenti: path.join(__dirname, 'strumenti')
      }),
      'Se era quello che volevi, tira dritto. Se no, NON riscrivere il file a memoria e non dire che si e\' ' +
        'troncato: la versione di prima e\' salvata, rimettila con ' + COMANDO_RIPRISTINA + ' --elenco e poi --file <nome>.'
    ].join('\n');
    console.log('[Cambiamenti] Avviso ad Adam: ' + inconsapevoli.length + ' file cambiati senza Edit/Write.');
    quandoLaChatELibera(function () {
      sendChatPrompt(avviso, { auto: true, attempt: 1, max: 1, reason: 'file cambiati senza Edit/Write' });
    });
    return r;
  } catch (e) {
    console.error('[Cambiamenti] Non riuscito:', e.message);
    return null;
  }
}

// Quando l'utente dice "non funziona piu'", la causa piu' probabile e' l'ultima cosa che e'
// cambiata: si passa ad Adam insieme alle misure, cosi' non deve indovinarla.
function testoPerditeRecenti() {
  if (!config.cwd) return '';
  try {
    const testo = cambiamenti.testoPerditeRecenti(config.cwd, { turni: 3, quante: 4 });
    if (!testo) return '';
    return testo + '\nSe il difetto riguarda uno di questi file, guarda prima qui: la versione di prima e\' salvata (' +
      COMANDO_RIPRISTINA + ' --elenco).';
  } catch (e) {
    return '';
  }
}

// ── CAPO PROGETTO ────────────────────────────────────────────
// Il filo del lavoro non puo' stare nella memoria di Adam: si compatta ogni due o tre turni e il
// compito sparisce (17/9/2026, ore 18:26: dopo una compattazione si e' ripresentato chiedendo
// "cosa posso aiutarti a fare?" mentre stava sistemando il CSS). Il piano lo tiene lo Studio, su
// disco, e glielo rimette in testa a ogni messaggio: cinque righe, un passo alla volta.
// strumenti/capo-progetto.js.

// Il piano cambia quando l'utente scrive qualcosa: o e' un compito nuovo, o e' il passo di adesso.
function aggiornaCapoProgetto(richiesta) {
  if (config.capoProgetto === false || !config.cwd) return null;
  try {
    const prima = capoProgetto.leggi(config.cwd);
    const piano = capoProgetto.aggiornaDallaRichiesta(config.cwd, richiesta);
    if (!piano) return null;
    const nuovoCompito = !prima || prima.quando !== piano.quando;
    const passiCambiati = prima && piano && prima.passi.length !== piano.passi.length;
    if (nuovoCompito || passiCambiati) {
      chatSystemMessage(capoProgetto.testoPerUtente(piano) +
        '\nLo tengo io: Adam lo rivede a ogni messaggio, anche dopo una compattazione. ' +
        'Se il piano non ti va bene dimmelo e lo cambiamo.', 'info');
    }
    return { piano: piano, nuovoCompito: nuovoCompito, passiCambiati: !!passiCambiati };
  } catch (e) {
    console.error('[Capo progetto] Non aggiornato:', e.message);
    return null;
  }
}

// A fine turno: un turno in piu' su questo passo e, se Adam ha scritto "PASSO FATTO", si avanza -
// ma solo se i controlli del turno sono andati bene. "Fatto" senza prova e' l'abitudine che
// stiamo correggendo, non una cosa da premiare.
function chiudiPassoDelTurno(verificaOk, problemi, fileToccati, mancanti, statoFunzionale) {
  if (config.capoProgetto === false || !config.cwd) return;
  try {
    const piano = capoProgetto.leggi(config.cwd);
    if (!piano || piano.finito) return;
    // Alla richiesta dell'utente manca ancora qualcosa: il passo NON si chiude, ne' per
    // dichiarazione ne' per la rete di sicurezza. Lo spiega il quadro della situazione che parte
    // subito dopo; un "Passo fatto" qui sarebbe solo una contraddizione (visto dal vivo il
    // 18/9/2026: "Passo fatto" e, un secondo dopo, "i controlli dicono di no").
    if (mancanti && mancanti.length) {
      capoProgetto.segnaPassoFatto(config.cwd, { verificato: false, nota: String(mancanti[0]).replace(/^MANCA\s+/, 'manca ') });
      return;
    }
    const testo = currentTurnText();
    // "PASSO FATTO" anche in grassetto o dentro un elenco (strumenti/capo-progetto.js).
    const notaDichiarata = capoProgetto.dichiarazioneDiPasso(testo);
    const dichiarato = notaDichiarata !== null;
    const corrente = capoProgetto.passoCorrente(piano) || {};
    if (!dichiarato) {
      capoProgetto.contaTurno(config.cwd);
      return;
    }
    const tipo = corrente.tipo || capoProgetto.tipoPasso(corrente.testo);
    let provato = false;
    let motivoMancante = '';
    if (tipo === 'analisi') {
      provato = (turnEvidence.letture + turnEvidence.ricerche) > 0;
      motivoMancante = 'ha dichiarato conclusa l\'analisi, ma in questo turno non risulta alcuna lettura o ricerca';
    } else if (tipo === 'verifica') {
      provato = verificaOk === true && !!(statoFunzionale && statoFunzionale.verificato);
      motivoMancante = verificaOk !== true
        ? 'manca una verifica tecnica positiva'
        : 'i criteri funzionali della richiesta non sono stati provati; zero controlli non equivale a successo';
    } else {
      provato = verificaOk === true && (fileToccati || 0) > 0;
      motivoMancante = (fileToccati || 0) <= 0
        ? 'non risulta alcun file modificato per questo passo'
        : 'le modifiche non hanno una verifica tecnica positiva';
    }
    const nota = String(notaDichiarata || '').trim().slice(0, 160);
    if (!provato) {
      capoProgetto.segnaPassoFatto(config.cwd, { verificato: false, nota: motivoMancante });
      const azioniBlocco = generaSuggerimentiCorrenti({ failures: problemi || [{ error: motivoMancante }] });
      chatSystemMessage('Il passo resta aperto: ' + motivoMancante + '.', 'warn', azioniBlocco);
      return;
    }
    const dopo = capoProgetto.segnaPassoFatto(config.cwd, { verificato: true, nota: nota });
    if (!dopo) return;
    const prossimo = capoProgetto.passoCorrente(dopo);
    const testoMsg = dopo.finito
      ? 'Tutti i passi di "' + dopo.compito + '" risultano fatti.'
      : 'Passo fatto' + (nota ? ': ' + nota : '') + '. Adesso il passo ' + (dopo.corrente + 1) + ' di ' +
        dopo.passi.length + ': ' + (prossimo ? prossimo.testo : '');
    const azioni = generaSuggerimentiCorrenti({ lastSystemMessage: testoMsg, piano: dopo });
    chatSystemMessage(testoMsg, 'info', azioni);
    chatBroadcast('suggerimenti-azioni', { actions: azioni });
  } catch (e) {
    console.error('[Capo progetto] Passo non aggiornato:', e.message);
  }
}

// ── IL FILE CHE SI SCRIVE SOTTO GLI OCCHI ─────────────────
// Richiesta dell'utente (17/9/2026): "devo vedere il live del file mentre lo sta lavorando, se
// no non so come viene scritto o come viene modificato". Claude Code gira con
// --include-partial-messages, quindi il contenuto di un Write arriva a pezzi mentre il modello
// lo genera: si ricompone (strumenti/scrittura-live.js) e si manda al pannello.
const scrittureInCorso = new Map();      // indice del blocco -> scrittura in corso
let ultimoInvioLive = 0;
let liveDaMandare = null;
let timerLive = null;

// Non a ogni pezzo: il modello ne manda decine al secondo e il pannello non deve ingolfarsi.
function mandaFileLive(istantanea, subito) {
  liveDaMandare = istantanea;
  const adesso = Date.now();
  const manda = function () {
    if (!liveDaMandare) return;
    ultimoInvioLive = Date.now();
    chatBroadcast('file-live', liveDaMandare);
    liveDaMandare = null;
  };
  if (timerLive) { clearTimeout(timerLive); timerLive = null; }
  if (subito || adesso - ultimoInvioLive > 200) manda();
  else timerLive = setTimeout(manda, 200);
}

function iniziaScritturaLive(indice, nome) {
  if (!scritturaLive.CAMPO[nome]) return;
  scrittureInCorso.set(indice, scritturaLive.nuovaScrittura(nome));
}

function pezzoScritturaLive(indice, pezzo) {
  const stato = scrittureInCorso.get(indice);
  if (!stato || !pezzo) return;
  if (scritturaLive.aggiungi(stato, pezzo)) mandaFileLive(scritturaLive.istantanea(stato));
}

function fineScritturaLive(indice) {
  const stato = scrittureInCorso.get(indice);
  if (!stato) return;
  scrittureInCorso.delete(indice);
  scritturaLive.chiudi(stato);
  mandaFileLive(scritturaLive.istantanea(stato), true);
}

function nomeDelFatto(f) {
  return (String(f).match(/«([^»]*)»/) || [])[1] || '';
}

// Chi ha rotto una guardia? Si riesegue il collaudo sulla copia di prima dell'ultimo turno.
// Passa li' = l'ha rotto quel turno, ed e' la leva migliore per Adam ("guarda la tua ultima
// modifica") e per l'utente. Fallisce anche li' = l'ha rotto una modifica precedente: la
// regressione resta comunque, cambia solo a chi si attribuisce.
async function attribuisciRegressioni(av, idFase, pagina, collaudi, fc) {
  if (!fc || !fc.regressioni.length) return fc;
  const foto = istantaneaTurno;
  if (!foto || foto.progetto !== path.resolve(config.cwd).toLowerCase() ||
      !fs.existsSync(path.join(foto.dir, pagina))) return fc;
  const nomi = fc.regressioni.map(nomeDelFatto);
  fase(av, idFase, null, 'Riprovo ' + (nomi.length === 1 ? 'la regressione' : 'le ' + nomi.length + ' regressioni') +
    ' sulla copia di prima dell\'ultimo turno');
  let ec = null;
  try {
    ec = await eseguiCollaudi({
      pagina: pagina, dir: foto.dir,
      collaudi: collaudi.filter(function (c) { return nomi.indexOf(c.nome) !== -1; })
    });
  } catch (e) {
    ec = null;
  }
  if (!ec || ec.errore) return fc;
  const prima = {};
  ec.esiti.forEach(function (e) { prima[e.nome] = e.esito; });
  console.log('[Collaudi] Regressioni riprovate sulla copia di prima: ' + JSON.stringify(prima));
  return Object.assign({}, fc, {
    regressioni: fc.regressioni.map(function (f) {
      const esito = prima[nomeDelFatto(f)];
      if (esito === 'superato') return f + ' Verificato sulla copia di prima dell\'ultimo turno: li\' passa, quindi l\'ha rotto l\'ultima modifica.';
      if (esito === 'fallito') return f + ' Falliva gia\' sulla copia di prima dell\'ultimo turno: l\'ha rotto una modifica precedente.';
      return f;
    })
  });
}

// Mappa del codice per il revisore: nomi esatti di funzioni, variabili e id, meno testo del
// codice intero e meno nomi inventati.
function mappaPerIlRevisore(dir) {
  try { return riassumiMappa(mappaCodice(dir)); } catch (e) { return ''; }
}

// Evita di riscrivere la memoria e il diagramma quando file e collegamenti sono uguali.
let ultimaFirmaMappa = '';
let ultimaCartellaMappa = '';
function aggiornaMappaInMemoria(mappaCorrente) {
  const mappa = mappaCorrente || mappaCodice(config.cwd);
  const testo = riassumiMappa(mappa);
  const firma = JSON.stringify({
    schede: mappa.schede.map(function (sc) {
      return [sc.nome, sc.tipo, sc.righe, sc.variabili, sc.funzioni, sc.importa, sc.usaId, sc.dichiaraId, sc.chiama];
    }),
    collegamenti: mappa.collegamenti
  });
  let cartella = path.resolve(config.cwd);
  if (process.platform === 'win32') cartella = cartella.toLowerCase();
  const vecchia = (loadProjectMemory(config.cwd).nodes || []).find(function (n) { return n.label === 'Mappa del codice'; });
  if (vecchia && vecchia.value === testo && ultimaFirmaMappa === firma && ultimaCartellaMappa === cartella) return false;
  salvaNodoProgetto('Mappa del codice', 'data', testo, ['analisi', 'mappa']);
  mappaVersoMemoriaVisiva(mappa);
  ultimaFirmaMappa = firma;
  ultimaCartellaMappa = cartella;
  return true;
}

// Accorpa le scritture ravvicinate: la mappa segue il lavoro mentre Adam modifica
// i file, senza rifare l'intera scansione dopo ogni singolo strumento.
let aggiornamentoMappaTimer = null;
function programmaAggiornamentoMappa() {
  if (!config.cwd) return;
  if (aggiornamentoMappaTimer) clearTimeout(aggiornamentoMappaTimer);
  aggiornamentoMappaTimer = setTimeout(function () {
    aggiornamentoMappaTimer = null;
    try {
      const aggiornata = aggiornaMappaInMemoria();
      if (aggiornata) {
        chatBroadcast('memory-updated', { projectDir: config.cwd });
        console.log('[Mappa] Aggiornata dopo le modifiche ai file.');
      }
    } catch (e) {
      console.error('[Mappa] Aggiornamento automatico non riuscito:', e.message);
    }
  }, 600);
}

function primaFrase(testo) {
  const t = String(testo || '').split(' Esempio: ')[0];
  const i = t.indexOf('. ');
  return i > 20 ? t.slice(0, i) : t;
}

// A fine ciclo lo Studio ricorda da solo cosa e' stato corretto e verificato, e cosa resta
// aperto: in una conversazione futura Adam sapra' quali difetti ha gia' avuto la pagina.
// Solo voci proprie dello Studio ("Correzioni verificate: ...", "Problemi aperti: ..."), a
// cui si aggiungono righe (le 8 piu' recenti): le voci scritte dall'utente non si toccano.
function ricordaEsitoDelCiclo(s, rimasti) {
  try {
    const data = new Date().toISOString().slice(0, 10);
    const risolti = s.risoltiTutti || [];
    if (risolti.length) {
      const etichetta = 'Correzioni verificate: ' + s.pagina;
      const vecchio = (loadProjectMemory(config.cwd).nodes || []).find(function (n) { return n.label === etichetta; });
      const righe = vecchio && vecchio.value ? String(vecchio.value).split('\n').filter(Boolean) : [];
      const nuove = risolti.map(function (f) { return '- ' + data + ' risolto: ' + accorciaTesto(primaFrase(f), 170); });
      const file = Array.from(new Set(modificheDelTurno().map(function (m) { return path.basename(m.file); })));
      if (file.length) nuove.push('- ' + data + ' file corretti: ' + file.join(', '));
      const tutte = nuove.concat(righe.filter(function (r) { return nuove.indexOf(r) === -1; })).slice(0, 8);
      salvaNodoProgetto(etichetta, 'rule', tutte.join('\n'), ['verifica', 'correzioni']);
    }
    // Vuota = nulla di aperto: salvaNodoProgetto toglie la voce se c'era.
    salvaNodoProgetto('Problemi aperti: ' + s.pagina, 'rule',
      (rimasti || []).slice(0, 6).map(function (f) { return '- ' + accorciaTesto(primaFrase(f), 170); }).join('\n'),
      ['verifica', 'aperti']);
    aggiornaMappaInMemoria();
    restartSessionsForMemory();
    console.log('[Memoria] Esito del ciclo su ' + s.pagina + ': ' + risolti.length + ' correzioni verificate, ' +
      (rimasti || []).length + ' problemi aperti.');
  } catch (e) {
    console.error('[Memoria] Esito del ciclo non salvato:', e.message);
  }
}

// ============================================================
// CONTESTO MISURATO E CHAT SALVATE (strumenti/archivio-chat.js)
// Claude Code non conosce il contesto dei modelli Ollama e non compatta in tempo: finora
// la sessione si riempiva a meta' lavoro e lo Studio se ne accorgeva solo dall'errore. Ora
// lo misura a ogni risposta e, oltre SOGLIA_RINNOVO, apre una sessione nuova a fine turno.
// Cio' che la sessione nuova non ha piu' in contesto resta nella chat salvata, che Adam
// puo' esplorare con Grep e Read.
// ============================================================

function chiediJson(url, corpo, timeoutMs) {
  return new Promise(function (resolve) {
    let u;
    try { u = new URL(url); } catch (e) { return resolve(null); }
    const dati = corpo ? JSON.stringify(corpo) : null;
    const req = (u.protocol === 'https:' ? https : http).request(u, {
      method: dati ? 'POST' : 'GET',
      timeout: timeoutMs || 4000,
      headers: dati ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(dati) } : {}
    }, function (res) {
      let testo = '';
      res.setEncoding('utf8');
      res.on('data', function (c) { testo += c; });
      res.on('end', function () { try { resolve(JSON.parse(testo)); } catch (e) { resolve(null); } });
    });
    req.on('error', function () { resolve(null); });
    req.on('timeout', function () { req.destroy(); resolve(null); });
    if (dati) req.write(dati);
    req.end();
  });
}

// Quanto contesto ha il modello: con Ollama il context_length del modello caricato
// (qui 49152), altrimenti num_ctx dai parametri del Modelfile.
async function aggiornaLimiteContesto() {
  const modello = (config.model || '').trim();
  const provider = config.provider || 'anthropic';
  if (provider !== 'ollama') {
    contestoChat.limite = provider === 'anthropic' ? 200000 : null;
  } else if (contestoChat.modello !== modello || !contestoChat.limite) {
    const base = baseUrlForProvider('ollama');
    let limite = null;
    try {
      const ps = await chiediJson(base + '/api/ps');
      const caricato = ps && (ps.models || []).find(function (m) { return m.name === modello || m.model === modello; });
      if (caricato && caricato.context_length) limite = caricato.context_length;
    } catch (e) {
      console.error('[Contesto] Errore durante la chiamata a /api/ps:', e.message);
    }
    if (!limite) {
      try {
        const info = await chiediJson(base + '/api/show', { model: modello });
        const p = info && String(info.parameters || '').match(/num_ctx\s+(\d+)/);
        if (p) limite = Number(p[1]);
        else if (info && info.model_info) {
          const k = Object.keys(info.model_info).find(function (x) { return /context_length$/.test(x); });
          if (k) limite = Number(info.model_info[k]);
        }
      } catch (e) {
        console.error('[Contesto] Errore durante la chiamata a /api/show:', e.message);
      }
    }
    // Fallback: if we still don't have a limit, use a default or the previous limit for this model
    if (!limite) {
      limite = finestraModelloToken[modello] || 200000; // default to 200000 if unknown
    }
    contestoChat.limite = limite;
    // La finestra vera del modello serve alla compattazione nativa (parametriCompattazione).
    if (limite) finestraModelloToken[modello] = limite;
  }
  contestoChat.modello = modello;
  inviaContesto();
}

function statoContesto() {
  const l = contestoChat.limite;
  const u = contestoChat.usati !== null ? contestoChat.usati : 0;
  return {
    usati: u,
    limite: l,
    percento: l ? Math.min(100, Math.round(u * 100 / l)) : 0
  };
}

function inviaContesto() {
  chatBroadcast('contesto', { contesto: statoContesto() });
}

// Il prompt di ogni chiamata al modello e' tutta la conversazione: i token in ingresso
// dell'ultima risposta, piu' quelli generati, sono il contesto occupato adesso.
// Va chiamata con l'usage di UNA chiamata, mai con quello del result finale, che somma tutte
// le chiamate del turno: da li' veniva il "78710 / 16384 token" del report di passaggio.
// MISURATO (Ollama 0.34, Claude Code 2.1.267): prompt di sistema e strumenti sono gia' dentro
// input_tokens (7293 token per un semplice "OK"). La maggiorazione di 3500 token che si
// aggiungeva qui gonfiava la misura di oltre 20 punti su 16k e anticipava i rinnovi.
// esatta: true per l'usage di message_delta; quello del messaggio assistente e' una stima.
function misuraContesto(usage, esatta) {
  if (!usage) return;
  const usati = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) +
    (usage.cache_creation_input_tokens || 0) + (usage.output_tokens || 0);
  if (!usati) return;
  if (esatta && contestoChat.base === null) contestoChat.base = usati;
  contestoChat.usati = usati;
  inviaContesto();
}

function archiviaChatOra() {
  try {
    const dir = conversazioneDir || config.cwd;
    const r = archivioChat.salva(dir, conversazioneId, chatMessages, { modello: config.model || '', progetto: dir });
    return r ? r.percorso : null;
  } catch (e) {
    console.error('[Archivio] Chat non salvata:', e.message);
    return null;
  }
}

// Oltre la soglia di rinnovo (SOGLIA_RINNOVO), a fine turno, si riparte da una sessione nuova
// PRIMA che si riempia: viene generato il report dettagliato (REPORT-PASSAGGIO-SESSIONE.md)
// e il compito riprende in automatico. Implementazione unificata con recuperaContestoPieno piu' in basso.

// Il file di settings di sessione ha la precedenza sui settings utente: e' l'unico modo
// affidabile per impedire che un ANTHROPIC_* globale (per esempio un vecchio proxy
// Ollama in ~/.claude/settings.json) dirotti in silenzio la sessione avviata dalla UI.
// Dopo ogni Edit/Write Claude Code esegue il cervello del progetto: se Adam usa un nome che non
// esiste o rompe un collegamento fra file lo scopre subito, non a fine turno.
function hookDelCervello() {
  if (config.cervelloDopoOgniModifica === false) return null;
  return {
    PostToolUse: [{
      matcher: 'Edit|Write|MultiEdit|NotebookEdit',
      // la prima compilazione di un assembly Unity dopo l'avvio del computer puo' superare i 10 secondi
      hooks: [{ type: 'command', command: cervelloComandi.COMANDO + ' --hook', timeout: 120 }]
    }]
  };
}

// I tetti per le letture di Adam. Il conto giusto non e' sulla finestra intera ma sullo SPAZIO DI
// LAVORO: la soglia di compattazione meno le istruzioni fisse che ogni turno si porta dietro
// (misurate il 18/9/2026: 7.430-9.737 token). Con 32k la soglia e' 15.672, quindi restano ~7.000
// token per tutto quello che Adam legge e scrive in un turno. Il limite di prima (un quinto della
// finestra, ~6.500 token) lasciava passare una lettura grande QUANTO tutto lo spazio di lavoro:
// un game.js da 472 righe letto per intero, e subito dopo la compattazione. Una lettura adesso
// vale al massimo un terzo dello spazio di lavoro: ~240 righe, il resto si legge a finestre.
const ISTRUZIONI_FISSE_STIMATE = 8500;
function limitiLettura() {
  const finestra = Number(finestraModelloToken[(config.model || '').trim()]) || 0;
  if (!finestra) return null;
  const lim = limitiClaudeCode(finestra);
  const lavoro = lim ? Math.max(SPAZIO_MINIMO_LAVORO, lim.compattazione - ISTRUZIONI_FISSE_STIMATE) : finestra * 0.2;
  const caratteri = Math.max(6000, Math.round((lavoro / 3) * guardianoLetture.CARATTERI_PER_TOKEN));
  const righe = Math.max(150, Math.round(caratteri / 36));
  return { finestra: finestra, caratteri: caratteri, righe: righe, mirate: Math.min(400, righe) };
}

// Prima di ogni Read, il guardiano controlla che il file ci stia nella memoria di Adam
// (strumenti/guardiano-letture.js). Visto dal vivo il 17/9/2026: un bootstrap.css da 8975 righe
// (49.000 token su una finestra da 32.768) letto per intero, contesto pieno, compattazione, e
// nel turno dopo Adam si presenta da capo senza piu' sapere cosa doveva fare.
function hookDelGuardiano() {
  if (config.guardianoLetture === false) return null;
  const l = limitiLettura();
  const argomenti = l ? ' --finestra ' + l.finestra + ' --caratteri ' + l.caratteri + ' --righe ' + l.righe + ' --mirate ' + l.mirate : '';
  // Anche scritture e comandi: gli esempi dello Studio si leggono soltanto, e un file dell'utente
  // non si riscrive da zero (visto dal vivo il 18/9/2026: game.js da 127 righe coperto da un Write,
  // ne era rimasto il 28%).
  return {
    matcher: 'Read|Write|Edit|MultiEdit|NotebookEdit|Bash|Grep|Glob',
    hooks: [{ type: 'command', command: COMANDO_GUARDIANO + ' --hook' + argomenti, timeout: 15 }]
  };
}

function hookDiSessione() {
  const hooks = {};
  const cervello = hookDelCervello();
  if (cervello) hooks.PostToolUse = cervello.PostToolUse;
  const guardiano = hookDelGuardiano();
  if (guardiano) hooks.PreToolUse = [guardiano];
  return Object.keys(hooks).length ? hooks : null;
}

// Il messaggio che il cervello ha dato ad Adam dopo una modifica, mostrato anche nella chat:
// senza, l'utente vedrebbe Adam correggere errori senza sapere chi glieli ha segnalati.
let ultimoAvvisoMostrato = '';
function mostraAvvisoDelCervello() {
  if (config.cervelloDopoOgniModifica === false || !config.cwd) return;
  // L'hook scrive il suo messaggio un attimo dopo la fine dello strumento: si guarda due volte.
  [800, 3000].forEach(function (ritardo) {
    setTimeout(function () {
      let avviso = null;
      try {
        avviso = JSON.parse(fs.readFileSync(path.join(cervelloComandi.cartellaProgetto(config.cwd), 'ultimo-avviso.json'), 'utf8'));
      } catch (e) {
        return;
      }
      if (!avviso || !avviso.quando || avviso.quando === ultimoAvvisoMostrato) return;
      if (Date.now() - new Date(avviso.quando).getTime() > 60000) return;
      ultimoAvvisoMostrato = avviso.quando;
      const righe = String(avviso.testo || '').split('\n').filter(function (r) { return /^- /.test(r); });
      chatSystemMessage('Cervello del progetto, dopo la modifica a ' + avviso.file + ': ' +
        (avviso.gravi ? avviso.gravi + (avviso.gravi === 1 ? ' errore grave' : ' errori gravi') + ', Adam li deve correggere subito.'
          : 'niente di bloccante, solo avvisi da controllare.') +
        '\n' + righe.slice(0, 5).join('\n'), avviso.gravi ? 'warn' : 'info');
    }, ritardo);
  });
}

function writeSessionSettings(env) {
  const settings = { env: {} };
  const hooks = hookDiSessione();
  if (hooks) settings.hooks = hooks;
  ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'API_TIMEOUT_MS', 'MAX_THINKING_TOKENS',
   // La compattazione nativa va messa anche qui, non solo nell'ambiente: il file di settings ha la
   // precedenza sui settings utente, cosi' un eventuale valore in ~/.claude/settings.json non vince.
   'CLAUDE_CODE_MAX_CONTEXT_TOKENS', 'CLAUDE_CODE_MAX_OUTPUT_TOKENS', 'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE'].forEach(function (key) {
    if (env[key]) settings.env[key] = env[key];
  });
  if (Object.keys(settings.env).length === 0 && !settings.hooks) return null;
  try {
    const file = path.join(os.tmpdir(), 'claude-studio-settings-' + process.pid + '.json');
    fs.writeFileSync(file, JSON.stringify(settings), 'utf8');
    return file;
  } catch (e) {
    console.error('[Chat] Impossibile scrivere i settings di sessione:', e.message);
    return null;
  }
}

function buildChatArgs(resumeId) {
  const env = resolveClaudeEnv();
  const args = [
    '--print',
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--permission-mode', config.permissionMode || 'acceptEdits'
  ];

  args.push.apply(args, buildCommonArgs());

  const settingsFile = writeSessionSettings(env);
  if (settingsFile) args.push('--settings', settingsFile);

  // Con il provider ufficiale scartiamo i settings utente: se contengono
  // ANTHROPIC_BASE_URL/AUTH_TOKEN di un provider locale la sessione fallisce con 401.
  if ((config.provider || 'anthropic') === 'anthropic') {
    args.push('--setting-sources', 'project,local');
  }

  if (resumeId) args.push('--resume', resumeId);
  return { args: args, env: env };
}

function startChatProcess(options) {
  const opts = options || {};
  stopChatProcess({ silent: true });
  if (opts.resume && chatSessionInfo) chatSessionInfo = Object.assign({}, chatSessionInfo, { pending: true });
  // Una sessione nuova (non ripresa) parte con il contesto vuoto: la misura arriva alla prima risposta.
  if (!opts.resume) {
    contestoChat.usati = null;
    contestoChat.base = null;
    contestoChat.avvisoPiccolo = false;
    chatSessionId = null;
    chatSessionInfo = null;
  }

  if (!opts.keepHistory) {
    // Prima di azzerare la chat la si salva: diventa memoria esplorabile, non si perde.
    archiviaChatOra();
    conversazioneId = archivioChat.nuovoId();
    conversazioneDir = config.cwd;
    interazioniGuidate = [];
    cancelPendingFix('conversazione azzerata');
    annullaSonda('conversazione azzerata');
    riassuntoDaInviare = '';
    recuperiContesto = 0;
    autoFixCount = 0;
    turnTouchedFiles = new Set();
    chatMessages = [];
    chatSessionId = null;
    chatSessionInfo = null;
    chatBroadcast('reset', {});
  }

  const claudeExe = getClaudeExecutable();
  const built = buildChatArgs(opts.resume);

  console.log('[Chat] Avvio sessione:', claudeExe, built.args.join(' '));

  try {
    chatProc = spawn(claudeExe, built.args, {
      cwd: config.cwd,
      env: built.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
  } catch (err) {
    chatProc = null;
    chatSystemMessage('Impossibile avviare Claude: ' + err.message, 'error');
    chatBroadcast('status', { running: false });
    return;
  }

  const proc = chatProc;
  chatStdoutTail = '';
  aggiornaLimiteContesto().catch(function () {});
  warnedAboutToolCalls = false;
  setChatBusy(false);

  // I flussi di un processo figlio emettono 'error' in modo ASINCRONO: un write che
  // fallisce (EAGAIN, EPIPE durante un riavvio) diventa un evento non gestito e Node
  // termina l'intero server. Un try/catch attorno a write() non basta.
  ['stdin', 'stdout', 'stderr'].forEach(function (flusso) {
    if (proc[flusso]) {
      proc[flusso].on('error', function (err) {
        console.error('[Chat ' + flusso + '] errore ignorato:', err.code || err.message);
      });
    }
  });

  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', function (chunk) {
    if (proc !== chatProc) return;
    chatStdoutTail += chunk;
    let index;
    while ((index = chatStdoutTail.indexOf('\n')) !== -1) {
      const line = chatStdoutTail.slice(0, index).trim();
      chatStdoutTail = chatStdoutTail.slice(index + 1);
      if (line) handleChatLine(line);
    }
    // Una riga enorme senza newline vuol dire output non-JSON: non lasciamola crescere.
    if (chatStdoutTail.length > 2000000) chatStdoutTail = '';
  });

  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', function (chunk) {
    if (proc !== chatProc) return;
    const text = String(chunk).trim();
    if (text) {
      console.error('[Chat stderr]', text.slice(0, 500));
      rilevaErroreDiReteStderr(text);
    }
  });

  proc.on('error', function (err) {
    if (proc !== chatProc) return;
    chatProc = null;
    setChatBusy(false);
    chatSystemMessage('Errore del processo Claude: ' + err.message, 'error');
    chatBroadcast('status', { running: false });
  });

  proc.on('exit', function (code, signal) {
    if (proc !== chatProc) return;
    chatProc = null;
    setChatBusy(false);
    chatSystemMessage('Sessione chat terminata (codice ' + code + (signal ? ', segnale ' + signal : '') + ').', 'warn');
    chatBroadcast('status', { running: false });
  });

  // L'evento `init` reale arriva solo col primo prompt: intanto mostriamo in UI
  // la configurazione richiesta, cosi' l'utente vede subito con cosa sta parlando.
  chatSessionInfo = {
    model: (config.model || '').trim() || '(predefinito)',
    modelTransport: config.modelTransport || config.provider || 'anthropic',
    modelGroup: config.modelGroup || '',
    coderModel: modelloCoderConfigurato(),
    coderProvider: config.coderProvider || '',
    coderGroup: config.coderGroup || '',
    visionModel: config.visionModel || '',
    resolvedVisionModel: modelloVisioneConfigurato(),
    cwd: config.cwd,
    provider: config.provider || 'anthropic',
    effort: config.effort || 'high',
    pending: true
  };
  chatBroadcast('session', { info: chatSessionInfo });

  chatBroadcast('status', { running: true, cwd: config.cwd });
}

function stopChatProcess(options) {
  const opts = options || {};
  cancelAutoContinue();
  autoContinueCount = 0;
  if (!chatProc) return;
  const proc = chatProc;
  chatProc = null;
  try { proc.stdin.end(); } catch (e) {}
  try { proc.kill(); } catch (e) {}
  setChatBusy(false);
  if (!opts.silent) chatBroadcast('status', { running: false });
}

// Blocchi immagine + testo nel formato dei messaggi stream-json.
// Il tipo vero dell'immagine dai primi byte: una foto caricata dall'utente e' spesso JPEG, e
// dichiararla PNG (come si faceva per le schermate della sonda) la farebbe leggere male.
function tipoImmagine(dati) {
  if (dati.length > 3 && dati[0] === 0xFF && dati[1] === 0xD8 && dati[2] === 0xFF) return 'image/jpeg';
  if (dati.length > 3 && dati[0] === 0x47 && dati[1] === 0x49 && dati[2] === 0x46) return 'image/gif';
  if (dati.length > 11 && dati.toString('ascii', 0, 4) === 'RIFF' && dati.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return 'image/png';
}

const CARTELLA_IMMAGINI = path.join(os.tmpdir(), 'studio-screenshot');
const MAX_IMMAGINI_CARICATE = 4;

// Immagini caricate dall'utente nella chat (una foto, la schermata di un'interfaccia):
// arrivano come data URL e si salvano accanto alle schermate della sonda, cosi' la chat le
// mostra con lo stesso indirizzo (/api/screenshot) e Adam le riceve come le altre.
function salvaImmaginiCaricate(lista) {
  const esito = { percorsi: [], errore: null };
  const voci = Array.isArray(lista) ? lista : [];
  if (voci.length > MAX_IMMAGINI_CARICATE) {
    esito.errore = 'al massimo ' + MAX_IMMAGINI_CARICATE + ' immagini per messaggio';
    return esito;
  }
  const validate = [];
  for (let i = 0; i < voci.length; i++) {
    const v = voci[i];
    const m = String((v && v.dati) || '').match(/^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/);
    if (!m) {
      esito.errore = 'formato non supportato (servono PNG, JPEG, WEBP o GIF)';
      return esito;
    }
    const dati = Buffer.from(m[2], 'base64');
    if (dati.length > 4 * 1024 * 1024) {
      esito.errore = 'immagine oltre 4 MB';
      return esito;
    }
    validate.push({ indice: i, estensione: m[1] === 'jpeg' ? 'jpg' : m[1], dati: dati });
  }
  try {
    fs.mkdirSync(CARTELLA_IMMAGINI, { recursive: true });
    validate.forEach(function (v) {
      const file = path.join(CARTELLA_IMMAGINI, 'caricata-' + Date.now() + '-' + v.indice + '-' + Math.random().toString(36).slice(2, 7) + '.' + v.estensione);
      fs.writeFileSync(file, v.dati);
      esito.percorsi.push(file);
    });
  } catch (e) {
    esito.percorsi.forEach(function (file) { try { fs.unlinkSync(file); } catch (_) {} });
    esito.percorsi = [];
    esito.errore = e.message;
  }
  return esito;
}

async function preparaAllegatiChat(lista) {
  const validati = await allegatiChat.validaAllegati(lista);
  if (validati.errore) return { percorsi: [], documenti: [], errore: validati.errore };
  const esito = { percorsi: [], documenti: validati.documenti, errore: null };
  try {
    if (validati.immagini.length) fs.mkdirSync(CARTELLA_IMMAGINI, { recursive: true });
    validati.immagini.forEach(function (v, indice) {
      const file = path.join(CARTELLA_IMMAGINI, 'caricata-' + Date.now() + '-' + indice + '-' + Math.random().toString(36).slice(2, 7) + '.' + v.estensione);
      fs.writeFileSync(file, v.dati);
      esito.percorsi.push(file);
    });
  } catch (e) {
    esito.percorsi.forEach(function (file) { try { fs.unlinkSync(file); } catch (_) {} });
    return { percorsi: [], documenti: [], errore: 'impossibile salvare gli allegati: ' + e.message };
  }
  return esito;
}

async function contenutoConImmagini(testo, immagini, opzioni) {
  const allegate = [];
  const immaginiAnalisi = [];
  const voci = Array.isArray(immagini) ? immagini : [];
  if (voci.length > routerVisione.MAX_IMMAGINI_ANALISI) throw new Error('al massimo ' + routerVisione.MAX_IMMAGINI_ANALISI + ' immagini per richiesta');
  if (!voci.length) return { contenuto: [{ type: 'text', text: String(testo || '') }], allegate: [] };
  for (const originale of voci) {
    // Se c'e' la copia leggera si usa quella: una schermata piena gonfierebbe ogni turno
    // successivo, mentre la copia compressa mantiene il dettaglio utile alla diagnosi.
    const percorso = schermataLeggera.migliore(originale);
    let dati;
    try { dati = fs.readFileSync(percorso); }
    catch (e) { throw new Error('non riesco a leggere l’immagine ' + path.basename(originale) + ': ' + e.message); }
    if (dati.length > 4 * 1024 * 1024) throw new Error('l’immagine ' + path.basename(percorso) + ' supera 4 MB anche dopo la riduzione');
    immaginiAnalisi.push({ mediaType: tipoImmagine(dati), data: dati.toString('base64') });
    allegate.push(path.basename(percorso));
  }

  const modelloVisione = modelloVisioneConfigurato();
  if (!modelloVisione) throw new Error('scegli un modello di visione nelle Impostazioni per inviare immagini');
  const providerVisione = routerVisione.separaModello(modelloVisione, config.provider || 'openrouter').provider;
  let descrizione;
  try {
    descrizione = await routerVisione.analizzaImmagini({
      provider: config.provider || 'openrouter',
      model: modelloVisione,
      apiKey: getKeyForProvider(providerVisione),
      baseUrl: config.baseUrl || '',
      customBaseUrl: config.customBaseUrl || config.baseUrl || '',
      images: immaginiAnalisi,
      userText: testo,
      onDelta: opzioni && opzioni.onVisionDelta
    });
  } catch (err) {
    // Una verifica produce anche misure, console e risultati dei collaudi: se il VLM e'
    // temporaneamente saturo non bisogna perdere tutte queste informazioni. Gli allegati
    // espliciti dell'utente mantengono invece il comportamento rigoroso di prima.
    if (!(opzioni && opzioni.continuaSenzaVisione)) throw err;
    const dettaglio = String(err && err.message || err).slice(0, 500);
    console.warn('[Vision] Analisi non disponibile; proseguo con i dati testuali della verifica:', dettaglio);
    const testoFallback = [
      String(testo || '').trim(),
      'NOTA SULLE IMMAGINI DELLA VERIFICA: il modello Vision non ha potuto descriverle (' + dettaglio + ').',
      'Continua usando misure, console e risultati testuali riportati sopra; non presumere di aver visto le immagini.'
    ].filter(Boolean).join('\n\n');
    return { contenuto: [{ type: 'text', text: testoFallback }], allegate: [], erroreVisione: dettaglio };
  }
  const testoArricchito = [
    String(testo || '').trim(),
    'ANALISI DELLE IMMAGINI (prodotta dal modello visivo; Adam non riceve i file originali):',
    descrizione
  ].filter(Boolean).join('\n\n');
  return { contenuto: [{ type: 'text', text: testoArricchito }], allegate: allegate };
}

// Le immagini generate da strumenti (per esempio Read su una schermata durante una
// verifica) passano dallo stesso modello Vision degli allegati e si vedono in streaming.
function avviaMessaggioVisioneDaProxy(info) {
  const messaggio = newMessage('assistant', [{
    kind: 'vision',
    model: info && info.model || modelloVisioneConfigurato(),
    status: 'Analisi in corso · immagine restituita da uno strumento',
    text: ''
  }]);
  messaggio.phase = 'vision';
  pushChatMessage(messaggio);
  const blocco = messaggio.blocks[0];
  return {
    onDelta: function (parte) {
      blocco.text = (blocco.text || '') + parte;
      chatBroadcast('delta', { messageId: messaggio.id, index: 0, kind: 'vision', text: parte });
    },
    onDone: function () {
      blocco.status = 'Analisi completata · risultato passato al Direttore';
      chatBroadcast('message-update', { message: messaggio });
    },
    onError: function () {
      blocco.status = 'Analisi non riuscita';
      chatBroadcast('message-update', { message: messaggio });
    }
  };
}

// Le immagini passano prima da un modello multimodale; al modello principale arriva
// la descrizione. Lo stesso percorso viene usato per allegati, schermate e verifiche.
function sendChatPromptConImmagini(text, immagini, options) {
  const opts = options || {};
  const trimmed = String(text || '').trim();
  if (!trimmed) return { ok: false, error: 'Messaggio vuoto' };
  const percorsiImmagini = Array.isArray(immagini) ? immagini : [];
  if (!percorsiImmagini.length) return sendChatPrompt(trimmed, opts);

  if (!chatProc) {
    startChatProcess({ resume: chatSessionId, keepHistory: !!chatSessionId });
  }
  if (!chatProc) return { ok: false, error: 'Sessione Claude non avviabile' };

  if (!opts.auto) {
    // Come in sendChatPrompt: un messaggio scritto dall'utente (qui con immagini) apre un turno nuovo.
    autoContinueCount = 0;
    autoFixCount = 0;
    turnTouchedFiles = new Set();
    cancelAutoContinue();
    if (sondaDaRipetere) sondaDaRipetere.attesaRisposta = false;
    recuperiContesto = 0;
  } else if (vincoloGitPushCorrente) {
    vincoloGitPushCorrente.finalizzato = false;
    vincoloGitPushCorrente.avvisoMancanzaMostrato = false;
  }

  const messaggio = newMessage('user', [{ kind: 'text', text: trimmed }]);
  if (opts.auto) {
    messaggio.auto = true;
    messaggio.attempt = opts.attempt;
    messaggio.max = opts.max;
    messaggio.reason = opts.reason;
  }
  messaggio.immagini = percorsiImmagini.map(function (file) { return path.basename(file); });
  if (!opts.auto || opts.istantanea) fotografaPrimaDelTurno();
  pushChatMessage(messaggio);
  const proc = chatProc;
  const modelloVisione = modelloVisioneConfigurato();
  const messaggioVisione = newMessage('assistant', [{
    kind: 'vision',
    model: modelloVisione,
    status: 'Analisi in corso',
    text: ''
  }]);
  messaggioVisione.phase = 'vision';
  pushChatMessage(messaggioVisione);
  setChatBusy(true, opts.auto
    ? 'Sto analizzando le schermate con ' + modelloVisione + '...'
    : 'Sto analizzando le immagini con ' + modelloVisione + '...');

  (async function () {
    try {
      const pronto = await contenutoConImmagini(testoPerIlModello(trimmed), percorsiImmagini, {
        onVisionDelta: function (parte) {
          const blocco = messaggioVisione.blocks[0];
          blocco.text = (blocco.text || '') + parte;
          chatBroadcast('delta', { messageId: messaggioVisione.id, index: 0, kind: 'vision', text: parte });
        }
      });
      if (!chatProc || chatProc !== proc) throw new Error('la sessione chat è cambiata durante l’analisi');
      messaggioVisione.blocks[0].status = 'Analisi completata · inoltro al Direttore';
      chatBroadcast('message-update', { message: messaggioVisione });
      messaggio.immagini = pronto.allegate;
      chatBroadcast('message-update', { message: messaggio });
      if (!proc.stdin || !proc.stdin.writable) throw new Error('canale della sessione chat non disponibile');
      const riga = JSON.stringify({ type: 'user', message: { role: 'user', content: pronto.contenuto } }) + '\n';
      proc.stdin.write(riga, function (err) {
        if (err) {
          console.error('[Vision] Scrittura fallita:', err.code || err.message);
          messaggioVisione.blocks[0].status = 'Analisi completata · invio al Direttore non riuscito';
          chatBroadcast('message-update', { message: messaggioVisione });
          setChatBusy(false);
          chatSystemMessage('La descrizione delle immagini è pronta, ma non è arrivata alla sessione chat. Riprova.', 'error');
        }
      });
      console.log('[Vision] Analizzate ' + pronto.allegate.length + ' immagini; inviata la descrizione ad Adam.');
    } catch (err) {
      messaggioVisione.blocks[0].status = 'Analisi non riuscita';
      chatBroadcast('message-update', { message: messaggioVisione });
      setChatBusy(false);
      chatSystemMessage('Non sono riuscito ad analizzare le immagini: ' + err.message + '. Nessuna immagine è stata inoltrata al modello principale.', 'error');
      console.error('[Vision] Analisi immagini fallita:', err.message);
    }
  })();
  return { ok: true, immagini: percorsiImmagini.length, analisiInCorso: true };
}

function sendChatPrompt(text, options) {
  const opts = options || {};
  const trimmed = String(text || '').trim();
  if (!trimmed) return { ok: false, error: 'Messaggio vuoto' };

  if (!chatProc) {
    // Riprendiamo la sessione precedente cosi' il contesto non va perso dopo uno stop.
    startChatProcess({ resume: chatSessionId, keepHistory: !!chatSessionId });
  }
  if (!chatProc) return { ok: false, error: 'Sessione Claude non avviabile' };

  if (!opts.auto) {
    // Un messaggio scritto davvero dall'utente apre un turno nuovo: azzera le riprese.
    autoContinueCount = 0;
    autoFixCount = 0;
    turnTouchedFiles = new Set();
    cancelAutoContinue();
    // La risposta che arrivera' e' per l'utente, non per le misure: niente solleciti.
    if (sondaDaRipetere) sondaDaRipetere.attesaRisposta = false;
    recuperiContesto = 0;
  } else if (vincoloGitPushCorrente) {
    vincoloGitPushCorrente.finalizzato = false;
    vincoloGitPushCorrente.avvisoMancanzaMostrato = false;
  }

  const userMessage = newMessage('user', [{ kind: 'text', text: trimmed }]);
  if (opts.hidden) userMessage.hidden = true;
  if (opts.auto) {
    userMessage.auto = true;
    userMessage.attempt = opts.attempt;
    userMessage.max = opts.max;
    userMessage.reason = opts.reason;
  }
  if (!opts.auto || opts.istantanea) fotografaPrimaDelTurno();
  pushChatMessage(userMessage);
  setChatBusy(true, opts.auto
    ? 'Ripresa automatica ' + opts.attempt + '/' + opts.max + '...'
    : 'Adam sta pensando...');

  const line = JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: testoPerIlModello(trimmed) }] }
  }) + '\n';

  if (!chatProc.stdin || !chatProc.stdin.writable) {
    setChatBusy(false);
    chatSystemMessage('La sessione si e\' chiusa mentre inviavo il messaggio. Riprova.', 'warn');
    return { ok: false, error: 'stdin non disponibile' };
  }

  try {
    chatProc.stdin.write(line, function (err) {
      // Callback: qui arriva l'errore asincrono, che altrimenti diventerebbe fatale.
      if (err) {
        console.error('[Chat] Scrittura fallita:', err.code || err.message);
        setChatBusy(false);
      }
    });
  } catch (err) {
    setChatBusy(false);
    chatSystemMessage('Invio fallito: ' + err.message, 'error');
    return { ok: false, error: err.message };
  }
  return { ok: true };
}

// --- parsing degli eventi stream-json ---

function currentAssistantMessage(create) {
  for (let i = chatMessages.length - 1; i >= 0; i--) {
    const m = chatMessages[i];
    if (m.role === 'assistant' && !m.closed) return m;
    if (m.role === 'user') break;
  }
  return create ? pushChatMessage(newMessage('assistant', [])) : null;
}

// L'ultimo messaggio assistente del turno, anche se gia' chiuso. currentAssistantMessage(false)
// restituisce null appena arriva il messaggio con il testo finale (viene chiuso subito), cioe'
// proprio quando arrivano message_delta e result: i token dell'ultima risposta andavano persi.
function ultimoMessaggioAssistente() {
  for (let i = chatMessages.length - 1; i >= 0; i--) {
    const m = chatMessages[i];
    if (m.role === 'assistant') return m;
    if (m.role === 'user') break;
  }
  return null;
}

function ensureBlock(message, index, kind) {
  while (message.blocks.length <= index) {
    message.blocks.push({ kind: 'text', text: '' });
  }
  const block = message.blocks[index];
  if (kind && block.kind !== kind && !block.text) block.kind = kind;
  return block;
}

function handleChatLine(line) {
  let data;
  try {
    data = JSON.parse(line);
  } catch (e) {
    // Righe non-JSON: diagnostica della CLI. Vale la pena loggarla, non e' un crash.
    if (line.length < 500) console.log('[Chat non-json]', line.slice(0, 200));
    rilevaErroreDiReteStderr(line);
    return;
  }

  if (data.session_id) chatSessionId = data.session_id;

  switch (data.type) {
    case 'system':
      handleSystemEvent(data);
      break;
    case 'stream_event':
      handleStreamEvent(data.event || {});
      break;
    case 'assistant':
      applyAssistantMessage(data);
      break;
    case 'user':
      applyToolResults(data);
      break;
    case 'result':
      finalizeResult(data);
      break;
    default:
      break;
  }
}

function handleSystemEvent(data) {
  if (data.subtype === 'init') {
    chatSessionInfo = {
      model: data.model,
      modelTransport: config.modelTransport || config.provider || 'anthropic',
      modelGroup: config.modelGroup || '',
      coderModel: modelloCoderConfigurato(),
      coderProvider: config.coderProvider || '',
      coderGroup: config.coderGroup || '',
      visionModel: config.visionModel || '',
      resolvedVisionModel: modelloVisioneConfigurato(),
      sessionId: data.session_id,
      cwd: data.cwd,
      tools: data.tools || [],
      mcpServers: data.mcp_servers || [],
      permissionMode: data.permissionMode,
      version: data.claude_code_version,
      apiKeySource: data.apiKeySource,
      provider: config.provider || 'anthropic',
      effort: config.effort || 'high',
      pending: false
    };
    chatBroadcast('session', { info: chatSessionInfo });
    return;
  }
  // Compattazione nativa avvenuta: Claude Code ha riassunto i turni piu' vecchi e prosegue nella
  // STESSA sessione. E' la sostituzione, meno distruttiva, del vecchio rinnovo di sessione: niente
  // report, niente ripartenza da zero. Lo comunichiamo cosi' non sembra un blocco, e aggiorniamo la
  // misura del contesto al valore dopo il riassunto.
  if (data.subtype === 'compact_boundary') {
    const meta = data.compact_metadata || {};
    const pre = Number(meta.pre_tokens) || 0;
    const post = Number(meta.post_tokens) || 0;
    if (post > 0) {
      contestoChat.usati = post;
      contestoChat.base = post;   // e' il nuovo "pavimento" del contesto dopo il riassunto
      inviaContesto();
    }
    recuperiContesto = 0;         // la compattazione ha liberato spazio: azzera il conto dei rinnovi
    // Dopo una compattazione Adam ha perso i turni vecchi: a fine turno va fermato e rimesso a fuoco.
    quadroInSospeso = 'compattazione';
    // E rileggere un file che non ricorda piu' e' giusto: il guardiano riazzera il conto delle
    // chiamate uguali (strumenti/guardiano-letture.js, giri a vuoto).
    try {
      fs.mkdirSync(guardianoLetture.CARTELLA_STATO, { recursive: true });
      fs.writeFileSync(path.join(guardianoLetture.CARTELLA_STATO, 'compattazione.txt'), String(Date.now()));
    } catch (e) { /* senza, il guardiano e' solo un po' piu' severo */ }
    chatSystemMessage(
      'Memoria compattata: ho riassunto automaticamente i turni piu\' vecchi per non fermarmi e ' +
      'proseguo con la stessa conversazione' +
      (pre && post ? ' (da ' + pre.toLocaleString('it-IT') + ' a ' + post.toLocaleString('it-IT') + ' token).' : '.'),
      'info');
    return;
  }
  // Etichette di stato utili in UI ("Reading nota.txt", "requesting", ...).
  if (data.subtype === 'task_summary' && data.detail) {
    setChatBusy(true, String(data.detail));
    return;
  }
  if (data.subtype === 'status' && data.status === 'requesting') {
    setChatBusy(true, 'Adam sta pensando...');
  }
}

function handleStreamEvent(evt) {
  if (evt.type === 'message_start') {
    const model = evt.message && evt.message.model;
    if (model && chatSessionInfo && chatSessionInfo.model !== model) {
      chatSessionInfo.model = model;
      chatBroadcast('session', { info: chatSessionInfo });
    }
    // Ogni message_start e' un messaggio assistente distinto: chiudiamo il precedente
    // cosi' i suoi blocchi (incluse le chiamate a strumenti) non vengono sovrascritti.
    const open = currentAssistantMessage(false);
    if (open) {
      open.closed = true;
      chatBroadcast('message-update', { message: open });
    }
    currentAssistantMessage(true);
    progressoTurno.caratteriMessaggio = 0;
    return;
  }

  if (evt.type === 'content_block_start') {
    const message = currentAssistantMessage(true);
    const cb = evt.content_block || {};
    const kind = cb.type === 'thinking' ? 'thinking' : (cb.type === 'tool_use' ? 'tool' : 'text');
    const block = ensureBlock(message, evt.index || 0, kind);
    block.kind = kind;
    progressoTurno.blocco = kind;
    programmaAvvisoSilenzio();
    if (kind === 'tool') {
      block.toolId = cb.id;
      block.name = cb.name;
      block.input = cb.input || {};
      iniziaScritturaLive(evt.index || 0, cb.name);
      chatBroadcast('message-update', { message: message });
      setChatBusy(true, 'Uso strumento: ' + (cb.name || 'Strumento') + '...');
    } else if (kind === 'thinking') {
      setChatBusy(true, 'Adam sta pensando...');
    } else if (kind === 'text') {
      setChatBusy(true, 'Adam sta elaborando la risposta...');
    }
    return;
  }

  if (evt.type === 'content_block_stop') {
    fineScritturaLive(evt.index || 0);
    // Segnala al client che il blocco corrente (thinking o testo) e' finito: senza
    // questo il client non riceve un aggiornamento tra la fine del ragionamento e
    // l'inizio del testo, e la chat sembra bloccarsi finche' non si apre/chiude
    // il pannello del pensiero a mano.
    const message = currentAssistantMessage(false);
    if (message) {
      chatBroadcast('message-update', { message: message });
    }
    progressoTurno.blocco = null;
    programmaAvvisoSilenzio();
    return;
  }

  if (evt.type === 'content_block_delta') {
    const message = currentAssistantMessage(true);
    const delta = evt.delta || {};
    // Conta anche l'input degli strumenti (partial_json: per esempio il contenuto di un file
    // scritto con Write): lo genera il modello, anche se in chat non appare come testo.
    const pezzo = delta.text || delta.thinking || delta.partial_json || '';
    if (delta.partial_json) pezzoScritturaLive(evt.index || 0, delta.partial_json);
    if (pezzo) {
      progressoTurno.caratteri += pezzo.length;
      progressoTurno.caratteriMessaggio += pezzo.length;
      inviaProgressoTurno();
    }
    // Il modello ha ripreso a trasmettere: se era comparso l'avviso di silenzio, via.
    if (ETICHETTE_SILENZIO.indexOf(chatActivity) !== -1) {
      setChatBusy(true, delta.type === 'thinking_delta' ? 'Adam sta pensando...' : 'Adam sta elaborando la risposta...');
    }
    programmaAvvisoSilenzio();
    let text = null;
    let kind = 'text';
    if (delta.type === 'text_delta') {
      text = delta.text;
      kind = 'text';
    } else if (delta.type === 'thinking_delta') {
      text = delta.thinking;
      kind = 'thinking';
    }
    if (text === null || text === undefined) return;

    const index = evt.index || 0;
    const block = ensureBlock(message, index, kind);
    block.kind = kind;
    block.text = (block.text || '') + text;
    chatBroadcast('delta', { messageId: message.id, index: index, kind: kind, text: text });
  }

  // L'API emette message_delta con l'usage finale (output_tokens) poco prima di
  // message_stop. Catturarlo qui permette di mostrare i token generati anche quando
  // il result finale di Claude Code non li include (tipico con Ollama).
  if (evt.type === 'message_delta') {
    const usage = evt.usage || (evt.delta && evt.delta.usage);
    if (usage) {
      const message = currentAssistantMessage(false) || ultimoMessaggioAssistente();
      if (message) {
        message._streamUsage = usage;
      }
      // I token veri di questa risposta prendono il posto della stima fatta sui caratteri.
      if (usage.output_tokens) {
        progressoTurno.reali += usage.output_tokens;
        progressoTurno.caratteri = Math.max(0, progressoTurno.caratteri - progressoTurno.caratteriMessaggio);
        progressoTurno.caratteriMessaggio = 0;
        inviaProgressoTurno();
      }
      // MISURATO con Ollama: qui arriva il prompt reale di QUESTA chiamata, con la parte in
      // cache separata (input_tokens 84 + cache_read_input_tokens 7896). E' la misura piu'
      // precisa del contesto occupato. Se porta solo output_tokens (API Anthropic) vale
      // quella fatta sul messaggio assistente.
      if ((usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0) > 0) {
        misuraContesto(usage, true);
      }
    }
  }
}

// Alcuni modelli locali (verificato: qwen2.5-coder:7b) non sanno emettere una chiamata
// a strumento strutturata: stampano il JSON come testo normale. Claude Code non la esegue
// e in UI sembra che "non funzioni niente" senza alcun errore. Riconoscerlo e dirlo e'
// molto piu' utile che lasciare l'utente davanti a un oggetto JSON inspiegabile.
const FAKE_TOOL_CALL_PATTERNS = [
  /^\s*\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"(arguments|parameters|input)"\s*:/,
  /<tool_call>/i
];

function looksLikeUnexecutedToolCall(text) {
  const t = String(text || '').trim();
  if (t.length > 2000) return false;
  return FAKE_TOOL_CALL_PATTERNS.some(function (re) { return re.test(t); });
}

let warnedAboutToolCalls = false;

function warnUnexecutedToolCall() {
  if (warnedAboutToolCalls) return;
  warnedAboutToolCalls = true;
  const model = (config.model || '').trim() || 'questo modello';
  chatSystemMessage(
    'Il modello "' + model + '" ha SCRITTO la chiamata a uno strumento come testo invece di ' +
    'eseguirla, quindi nessun file viene letto o modificato. Non e\' un errore di ' +
    'configurazione: quel modello non sa produrre chiamate strutturate. ' +
    'Cambia modello nelle Impostazioni (qwen3.5-studio:9b funziona ed e\' anche piu\' veloce).',
    'error');
}

function applyAssistantMessage(data) {
  const content = (data.message && data.message.content) || [];
  const message = currentAssistantMessage(true);
  if (message && data.message && data.message.usage) {
    message._usage = data.message.usage;
  }
  misuraContesto(data.message && data.message.usage);

  // L'evento finale e' autorevole: rimpiazza i blocchi accumulati durante lo streaming.
  const blocks = [];
  content.forEach(function (part) {
    if (part.type === 'text') {
      // I blocchi vuoti comparivano in UI come righe fantasma.
      if (!part.text || !part.text.trim()) return;
      blocks.push({ kind: 'text', text: part.text });
    } else if (part.type === 'thinking') {
      if (!part.thinking || !part.thinking.trim()) return;
      blocks.push({ kind: 'thinking', text: part.thinking });
    } else if (part.type === 'tool_use') {
      blocks.push({ kind: 'tool', toolId: part.id, name: part.name, input: part.input || {} });
    }
  });

  // Conserva i risultati degli strumenti gia' agganciati a questo messaggio.
  const previous = {};
  message.blocks.forEach(function (b) {
    if (b.kind === 'tool' && b.toolId && b.result !== undefined) previous[b.toolId] = b;
  });
  blocks.forEach(function (b) {
    if (b.kind === 'tool' && previous[b.toolId]) {
      b.result = previous[b.toolId].result;
      b.isError = previous[b.toolId].isError;
    }
  });

  if (blocks.length) message.blocks = blocks;
  message.isError = !!data.is_api_error_message;

  // Se il turno non contiene chiamate vere ma il testo ne ha la forma, il modello
  // non e' in grado di eseguirle: avvisiamo una volta sola per sessione.
  const hasRealTool = blocks.some(function (b) { return b.kind === 'tool'; });
  if (!hasRealTool && blocks.some(function (b) {
    return b.kind === 'text' && looksLikeUnexecutedToolCall(b.text);
  })) {
    warnUnexecutedToolCall();
  }
  if (data.message && data.message.model) message.model = data.message.model;

  // Un messaggio con tool_use non chiude il turno: seguiranno risultati e altro testo.
  if (!blocks.some(function (b) { return b.kind === 'tool'; })) message.closed = true;

  chatBroadcast('message-update', { message: message });
}

function applyToolResults(data) {
  const content = (data.message && data.message.content) || [];
  const results = content.filter(function (p) { return p.type === 'tool_result'; });
  if (!results.length) return;

  results.forEach(function (result) {
    for (let i = chatMessages.length - 1; i >= 0; i--) {
      const message = chatMessages[i];
      const block = (message.blocks || []).find(function (b) {
        return b.kind === 'tool' && b.toolId === result.tool_use_id;
      });
      if (block) {
        block.result = flattenToolResult(result.content);
        block.isError = !!result.is_error;
        registraEvidenzaStrumento(block.name, block.input || {}, !!result.is_error);
        registraEsitoGitPush(block.name, block.input || {}, !!result.is_error, block.result);
        try {
          guardianoLetture.registraEsito(block.name, block.input || {}, chatSessionId,
            !!result.is_error, block.result);
        } catch (e) {
          console.error('[Guardiano] Esito strumento non registrato:', e.message);
        }

        // Uno strumento che tocca file ha appena finito: l'esploratore mostrerebbe
        // ancora la cartella com'era prima, e l'utente vedrebbe un elenco che non
        // corrisponde a quello che Adam ha appena creato.
        if (!result.is_error && FILE_TOOLS[block.name]) {
          const toccato = (block.input || {})[FILE_TOOLS[block.name]];
          recordTouchedFile(block.name, block.input);
          chatBroadcast('files-changed', { file: toccato });
          programmaAggiornamentoMappa();
          // Il file adesso e' su disco davvero: il pannello del file dal vivo passa da "lo sta
          // scrivendo" a "questo e' quello che c'e' scritto", e puo' mostrare cosa e' cambiato.
          chatBroadcast('file-salvato', { file: toccato, strumento: block.name, quando: Date.now() });
          mostraAvvisoDelCervello();

          // Incremento immediato dei neuroni mentre Adam programma:
          try {
            const esitoAppr = apprendimentoMemoria.aggiornaNeuroniDaFileModificati(config.cwd, [toccato]);
            if (esitoAppr.modificati > 0) {
              chatBroadcast('memory-updated', { projectDir: config.cwd, totalNodes: esitoAppr.nodiTotali });
            }
          } catch (e) {
            console.error('[Memoria] Errore aggiornamento neurone file salvato:', e.message);
          }
        }
        // Dopo i risultati il turno prosegue in un messaggio nuovo, non in questo.
        message.closed = true;
        chatBroadcast('message-update', { message: message });
        break;
      }
    }
  });
}

function flattenToolResult(content) {
  if (content === null || content === undefined) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(function (part) {
      if (typeof part === 'string') return part;
      if (part && part.type === 'text') return part.text || '';
      if (part && part.type === 'image') return '[immagine]';
      return '';
    }).join('\n');
  }
  try { return JSON.stringify(content); } catch (e) { return String(content); }
}

function finalizeResult(data) {
  const message = currentAssistantMessage(false) || ultimoMessaggioAssistente();
  let nuovaInterazione = false;

  const isError = !!data.is_error || data.terminal_reason === 'api_error' || data.subtype === 'error_during_execution';
  // Se il result finale non include usage (tipico con Ollama), usiamo quello catturato
  // durante lo streaming da message_delta o da applyAssistantMessage.
  const usage = data.usage || (message && (message._usage || message._streamUsage)) || null;
  const meta = {
    durationMs: data.duration_ms,
    costUsd: data.total_cost_usd,
    usage: usage,
    numTurns: data.num_turns,
    isError: isError,
    provider: config.provider || 'anthropic',
    terminalReason: data.terminal_reason
  };

  if (message) {
    message.closed = true;
    message.meta = meta;
  }
  if (message && !isError) {
    const estratto = dialogoGuidato.estraiEnvelope(assistantText(message));
    if (estratto.envelopes.length) {
      let assegnato = false;
      (message.blocks || []).forEach(function (block) {
        if (block.kind !== 'text') return;
        block.text = assegnato ? '' : estratto.text;
        assegnato = true;
      });
      estratto.envelopes.forEach(function (envelope) {
        if (envelope.type === 'clarification') {
          const creato = dialogoGuidato.creaInterazione(envelope);
          if (creato.ok) {
            interazioniGuidate.push(creato.value);
            message.interaction = creato.value;
            nuovaInterazione = true;
          }
        } else if (envelope.type === 'plan') {
          const aperta = interazioniGuidate.some(function (item) { return item.status === 'pending'; });
          if (!aperta && config.capoProgetto !== false && config.cwd) {
            const applicato = capoProgetto.riscriviPassi(config.cwd, envelope.steps.join('\n'));
            if (applicato && applicato.ok) message.plan = envelope;
          }
        }
      });
      dialogoGuidato.salva(config.cwd, conversazioneId, interazioniGuidate);
      chatBroadcast('message-update', { message: message });
    }
  }
  // Il contesto non si misura da qui: data.usage somma tutte le chiamate del turno.

  // L'errore arriva sia come testo dell'assistente sia nel result: mostrarlo due volte
  // (come faceva prima) fa sembrare che siano due problemi distinti.
  if (isError && data.result) {
    const text = String(data.result);
    const alreadyShown = message && (message.blocks || []).some(function (b) {
      return b.kind === 'text' && b.text && b.text.indexOf(text.slice(0, 60)) !== -1;
    });
    if (!alreadyShown) {
      if (rilevaErroreQuota(text)) {
        const prov = (config.provider || 'anthropic').toUpperCase();
        chatSystemMessage(
          '⚠️ ' + prov + ': ' + estraiDettaglioQuota(text) +
          '. Il piano gratuito di questo provider ha raggiunto il limite. ' +
          'Puoi attendere il reset della quota, passare a un altro provider gratuito ' +
          '(Groq, Cerebras, ecc.) oppure aggiornare il piano del provider.',
          'error'
        );
      } else if (rilevaErroreModello(text)) {
        const prov = (config.provider || 'anthropic').toUpperCase();
        chatSystemMessage(
          '🚫 ' + prov + ': ' + estraiDettaglioModello(text) +
          '. Seleziona un modello diverso dalla tendina in alto.',
          'error'
        );
      } else if (rilevaErroreDiRete(text) || data.terminal_reason === 'api_error') {
        chatSystemMessage(
          '⚠️ Il modello ha interrotto la risposta per un problema di connessione a Internet o timeout del server (' +
          estraiDettaglioRete(text) + '). Se c\'è poco internet o la linea è instabile, attendi che si stabilizzi e riprova.',
          'error'
        );
      } else {
        chatSystemMessage(text, 'error');
      }
    }
  } else if (turnoCompletatoSenzaTestoVisibile(data, currentTurnText())) {
    // Alcuni provider possono chiudere un turno dopo ragionamento/chiamate agli
    // strumenti senza produrre testo per l'utente. Non lasciare una bolla vuota:
    // distinguiamo chiaramente un turno completato da una risposta riuscita.
    const provider = String(config.provider || 'modello').toUpperCase();
    const modello = String(config.model || '').trim();
    chatSystemMessage(
      '⚠️ Il turno è terminato senza una risposta testuale da ' + provider +
      (modello ? ' (' + modello + ')' : '') +
      '. Sono arrivati passaggi di ragionamento o chiamate agli strumenti, ma nessun testo finale. ' +
      'Controlla i file eventualmente modificati e riprova oppure scegli un altro modello.',
      'warn'
    );
  }

  setChatBusy(false);
  chatBroadcast('result', { meta: meta, messageId: message ? message.id : null });
  try {
    const azioniFine = generaSuggerimentiCorrenti();
    if (azioniFine.length > 0) {
      chatBroadcast('suggerimenti-azioni', { actions: azioniFine });
    }
  } catch (e) {}
  // A ogni fine turno la conversazione va su disco: e' la memoria esplorabile delle sessioni dopo.
  archiviaChatOra();

  // Prima di qualsiasi altra cosa: cosa e' cambiato sul disco in questo turno (anche quello che
  // non passa da Edit e Write) e copia di sicurezza della versione di prima.
  registraCambiamentiDelTurno();

  // Un chiarimento e' deliberatamente bloccante: niente auto-continue, verifica o tool
  // finche' la persona non sceglie una delle opzioni della card.
  if (nuovaInterazione) return;

  if (vincoloGitPushCorrente) vincoloGitPushCorrente.finalizzato = true;

  const motivoGit = gitPushVerificato.motivoNonCompletato(vincoloGitPushCorrente);
  if (motivoGit) {
    if (!vincoloGitPushCorrente.avvisoMancanzaMostrato) {
      vincoloGitPushCorrente.avvisoMancanzaMostrato = true;
      chatSystemMessage('⚠️ Non considero completata la richiesta Git: ' + motivoGit + '.', 'warn');
    }
    if (config.autoContinue) {
      scheduleAutoContinue(motivoGit);
      return;
    }
  }

  if (config.autoContinue) {
    const reason = detectIncompleteTurn(data, message || ultimoMessaggioAssistente()) ||
      gptOssAgent.motivoSenzaAzione({
        model: config.model,
        request: lastUserRequestText(),
        response: currentTurnText(),
        evidence: turnEvidence
      });
    if (reason) {
      scheduleAutoContinue(reason);
      return; // risposta incompleta: prima si completa, poi si verifica
    }
    // Se la verifica di rete del push e' ancora in corso, conserva il numero di
    // tentativi: un eventuale fallimento verra' ripreso appena arriva l'esito.
    if (!(vincoloGitPushCorrente && vincoloGitPushCorrente.verificaInCorso)) {
      autoContinueCount = 0;
      pulisciBozzaAutoContinue();
    }
  }

  // Contesto pieno: la sessione non puo' piu' rispondere a nulla, nemmeno a "continua".
  if (contestoPieno(data)) {
    recuperaContestoPieno().catch(function (e) { console.error('[Contesto] Ripresa fallita:', e.message); });
    return;
  }

  // Turno concluso davvero: se il contesto e' oltre la soglia si riparte da una sessione nuova
  // prima del turno dopo, generando il report di passaggio e riprendendo il compito in automatico.
  const st = statoContesto();
  if (st.percento !== null && st.percento >= sogliaRinnovo() && rinnovoUtile()) {
    rinnovaSePieno().catch(function (e) { console.error('[Contesto] Rinnovo fallito:', e.message); });
    return;
  }
  verifyAndMaybeFix();

  // Un aggiornamento di memoria rimandato perche' il turno era in corso puo' essere
  // applicato ora. Il controllo su chatBusy si ripete perche' la verifica automatica
  // potrebbe aver appena avviato un turno di correzione.
  if (memoryRestartPending) {
    setTimeout(function () {
      if (!chatBusy && memoryRestartPending) applyMemoryRestart();
    }, 1500);
  }
}

// Un turno puo' finire senza che la risposta sia finita: il modello sbatte contro il
// tetto di token, la richiesta va in errore, oppure - tipico dei modelli locali - si
// ferma a meta' di un blocco di codice. In tutti questi casi la risposta va ripresa.
function assistantText(message) {
  if (!message) return '';
  return (message.blocks || [])
    .filter(function (b) { return b.kind === 'text'; })
    .map(function (b) { return b.text || ''; })
    .join('\n');
}

function classificaErroreTurno(data) {
  const d = data || {};
  const eErrore = !!(d.is_error || d.terminal_reason === 'api_error' || d.subtype === 'error_during_execution');
  if (!eErrore) return null;
  const testo = (String(d.result || '') + '\n' + currentTurnText()).toLowerCase();
  // Crediti/quota realmente esauriti non migliorano con un retry. Un semplice 429
  // "Too Many Requests", invece, e' normalmente un rate limit temporaneo e va
  // riprovato con backoff: NVIDIA lo restituisce spesso durante turni con molti tool.
  const limiteTemporaneo = /rate.?limit|too many requests|(?:^|\D)429(?:\D|$)/i;
  const quotaPermanente = /insufficient (?:credits|funds|balance)|quota (?:exceeded|exhausted)|exceeded.*quota|billing|free.?tier.*(?:exhausted|quota)/i;
  if (quotaPermanente.test(testo)) return { ripetibile: false, tipo: 'quota' };
  if (limiteTemporaneo.test(testo)) return { ripetibile: true, tipo: 'limite' };
  const permanente = /(?:invalid|incorrect|missing|revoked|expired)[-_ ]?(?:api[-_ ]?)?(?:key|token)|unauthori[sz]ed|forbidden|permission denied|authentication|model.{0,40}(?:not found|does not exist|not available|unsupported|invalid|retired|deprecated)|unknown model|no endpoints found|bad request|unsupported (?:operation|capability)|tool use is not supported|(?:^|\D)4(?:00|01|03|04|10|22)(?:\D|$)/i;
  if (permanente.test(testo)) return { ripetibile: false, tipo: 'permanente' };
  const rete = /response stopped arriving|fetch failed|enotfound|etimedout|econnreset|econnrefused|eai_again|socket hang up|network error|connection error|connection reset|timed? out|gateway timeout|overloaded|(?:^|\D)5(?:02|03|04)(?:\D|$)/i;
  if (rete.test(testo)) return { ripetibile: true, tipo: 'rete' };
  // Un errore API sconosciuto non va martellato automaticamente: potrebbe essere
  // una configurazione errata che nessun numero di retry puo' correggere.
  return { ripetibile: false, tipo: 'sconosciuto' };
}

// La risposta a un turno e' quasi sempre spezzata su piu' messaggi assistente
// (ragionamento, chiamate a strumenti, testo). Le euristiche vanno applicate al
// testo dell'INTERO turno: guardando solo l'ultimo messaggio - spesso corto - un
// troncamento evidente passava inosservato.
function currentTurnText() {
  const parts = [];
  for (let i = chatMessages.length - 1; i >= 0; i--) {
    const m = chatMessages[i];
    if (m.role === 'user') break;
    if (m.role === 'assistant') {
      const t = assistantText(m);
      if (t) parts.unshift(t);
    }
  }
  return parts.join('\n');
}

// Testo dell'ultima richiesta vera dell'utente (le riprese automatiche non contano).
function lastUserRequestText() {
  for (let i = chatMessages.length - 1; i >= 0; i--) {
    const m = chatMessages[i];
    if (m.role === 'user' && !m.auto) {
      return (m.blocks || []).map(function (b) { return b.text || ''; }).join(' ');
    }
  }
  return '';
}

// Se l'utente ha chiesto un numero preciso di elementi ("elenco di 50 nomi") e la lista
// ci e' arrivata, la risposta e' finita anche se l'ultima riga e' una voce di elenco.
// Senza questo controllo una lista completa faceva scattare una ripresa inutile.
function listReachedRequestedCount(text) {
  const numbers = (text.match(/^\s*(\d+)[.)]\s+\S/gm) || [])
    .map(function (line) { return parseInt(line.trim(), 10); })
    .filter(function (n) { return !isNaN(n); });
  if (!numbers.length) return false;

  const reached = Math.max.apply(null, numbers);
  const requested = (lastUserRequestText().match(/\b(\d{1,4})\b/g) || [])
    .map(Number)
    .filter(function (n) { return n >= 3 && n <= 2000; });
  if (!requested.length) return false;

  return reached >= Math.max.apply(null, requested);
}

// Contesto del modello pieno. Ripetere la stessa richiesta non puo' riuscire e anzi la
// allunga: visto dal vivo, 8 riprese in 5 secondi, tutte respinte con lo stesso errore.
// Con Ollama anche "exceeded the 32000 output token maximum" e' contesto pieno travestito:
// quando la finestra si esaurisce durante la risposta, Ollama si ferma per "lunghezza" e la
// CLI lo riporta come tetto di output. Visto dal vivo: tre riprese inutili in 3 minuti,
// risposte "da 32000 token" arrivate in pochi secondi, poi l'errore di contesto esplicito.
const CONTESTO_PIENO = /exceed(?:s|ed)? the (?:available )?context (?:size|window|length)|exceed_context_size_error|prompt is too long|context length exceeded|maximum context length|exceeded the \d+ output token maximum|autocompact is thrashing/i;
// Claude Code smette di compattare quando la memoria si riempie di nuovo entro 3 turni, 3 volte di
// fila. Visto dal vivo (15/9/2026): lo Studio rispondeva "Continua" nella stessa sessione e
// l'errore si ripeteva 7 volte. E' contesto pieno anche se non arriva come errore dell'API.
const COMPATTAZIONE_IN_TILT = /autocompact is thrashing/i;

function contestoPieno(data) {
  const testoTurno = currentTurnText();
  const errore = !!(data && (data.is_error || data.terminal_reason === 'api_error')) || /API Error/.test(testoTurno);
  const risultato = String((data && data.result) || '');
  if (COMPATTAZIONE_IN_TILT.test(risultato) || COMPATTAZIONE_IN_TILT.test(testoTurno)) return true;
  return errore && (CONTESTO_PIENO.test(risultato) || CONTESTO_PIENO.test(testoTurno));
}

// Testo che l'utente legge davvero: senza il ragionamento che alcuni modelli locali scrivono dentro la
// risposta tra <think> e </think> (anche rimasto aperto, o con il solo </think> finale).
function testoVisibile(testo) {
  let t = String(testo || '').replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '');
  const chiusura = t.lastIndexOf('</think>');
  if (chiusura !== -1) t = t.slice(chiusura + '</think>'.length);
  return t.trim();
}

function turnoCompletatoSenzaTestoVisibile(data, testo) {
  if (!data || data.is_error || data.terminal_reason === 'api_error' || data.subtype === 'error_during_execution') {
    return false;
  }
  return data.terminal_reason === 'completed' && !testoVisibile(testo);
}

// Vero se il messaggio contiene solo ragionamento: niente testo per l'utente e nessuno strumento.
function soloRagionamento(messaggio) {
  if (!messaggio) return false;
  const blocchi = messaggio.blocks || [];
  if (blocchi.some(function (b) { return b.kind === 'tool'; })) return false;
  const haRagionato = blocchi.some(function (b) {
    if (b.kind === 'thinking') return !!(b.text && b.text.trim());
    return b.kind === 'text' && /<\/?think>/i.test(b.text || '');
  });
  return haRagionato && !testoVisibile(assistantText(messaggio));
}

const MOTIVO_SOLO_RAGIONAMENTO = 'solo ragionamento, nessuna azione eseguita';
const MOTIVO_SENZA_TESTO_FINALE = 'turno completato senza risposta testuale finale';

// ATTENZIONE: verificato sul campo che una risposta troncata puo' arrivare con
// stop_reason "end_turn", terminal_reason "completed" e is_error false, cioe'
// indistinguibile da un successo guardando i soli campi di stato. Per questo
// oltre ai segnali espliciti servono euristiche sul testo prodotto.
function detectIncompleteTurn(data, ultimaRisposta) {
  // 0. Contesto pieno: non e' una risposta interrotta, e riprenderla non serve.
  if (contestoPieno(data)) return null;

  // 1. Segnali espliciti, quando ci sono.
  if (data.stop_reason === 'max_tokens') return 'tetto di token raggiunto';
  const errore = classificaErroreTurno(data);
  if (errore) {
    if (!errore.ripetibile) return null;
    return errore.tipo === 'limite' ? 'limite temporaneo del provider' : 'problema di rete temporaneo';
  }

  // Un turno che si chiude chiedendo uno strumento non e' incompleto: prosegue da solo.
  // Se il provider dichiara che l'INTERO turno e' completed ma non esiste testo
  // visibile, tool_use non e' piu' uno stato intermedio: Nemotron ha chiuso dopo
  // lo strumento e serve una ripresa per verificare e rispondere all'utente.
  if (turnoCompletatoSenzaTestoVisibile(data, currentTurnText())) {
    return MOTIVO_SENZA_TESTO_FINALE;
  }
  if (data.stop_reason === 'tool_use') return null;

  // Il turno si e' chiuso su un messaggio di solo ragionamento: il modello ha deciso cosa fare e si e'
  // fermato senza farlo. VISTO DAL VIVO dopo un passaggio di sessione: "<think> ... Leggo solo le ultime
  // 20 righe ... </think>" e poi nulla. Il testo finisce con '>', che conta come chiusura pulita, quindi
  // lo Studio credeva il turno finito e Adam restava fermo senza alcun avviso.
  if (soloRagionamento(ultimaRisposta)) return MOTIVO_SOLO_RAGIONAMENTO;

  // Un provider puo' chiudere regolarmente il turno dopo avere ragionato o usato
  // strumenti, ma senza consegnare alcuna risposta visibile. L'avviso da solo non
  // basta: questo e' un turno incompleto e deve entrare nella stessa procedura di
  // recupero automatico degli altri troncamenti. Il controllo sull'intero turno
  // copre anche il caso tool_use -> tool_result -> message_stop senza testo finale.
  const trimmed = currentTurnText().replace(/\s+$/, '');
  if (!trimmed) return null;

  // 2. Blocco di codice lasciato aperto: praticamente sempre un troncamento.
  if (((trimmed.match(/```/g) || []).length) % 2 === 1) {
    return 'blocco di codice lasciato aperto';
  }

  // Token dell'ULTIMA risposta del modello, se nota: data.usage somma l'intero turno, comprese le
  // chiamate agli strumenti. Visto dal vivo: una Write da 603 token seguita da "FATTO" veniva presa
  // per una risposta lunga interrotta, e Adam veniva rimandato a un lavoro gia' finito.
  const ultimoUsage = ultimaRisposta && ultimaRisposta._streamUsage;
  const outputTokens = ultimoUsage ? (ultimoUsage.output_tokens || 0) : ((data.usage && data.usage.output_tokens) || 0);
  // Una risposta che chiude con un'emoji (razzo, spunta verde) o punteggiatura conclusiva e' finita.
  // NOTA: i due punti ':' NON sono una chiusura pulita (introducono testo/codice mancante).
  const endsCleanly = /(?:[.!?;)\]}>"»…`*]|\p{Extended_Pictographic})[\uFE0F\u200D]*$/u.test(trimmed);
  if (endsCleanly) return null;

  // Due punti alla fine introducono codice o un'azione rimasti non scritti: mai risposta completa.
  if (/:\s*$/.test(trimmed)) {
    return 'annuncio o blocco non completato';
  }

  // Se termina con l'annuncio di un'azione a parole senza averla eseguita ("Ora aggiungo...", "Procedo a..."):
  if (/(?:ora|adesso|procedo a|vado a|passo a|iniziamo con)\s+[^.!?\n]{3,60}$/i.test(trimmed)) {
    return 'azione annunciata ma non eseguita';
  }

  const lines = trimmed.split('\n');
  const lastLine = (lines[lines.length - 1] || '').trim();
  const endsOnListItem = /^\d+[.)]\s+\S/.test(lastLine);

  // Un elenco puntato in fondo ("- fatto questo") chiude di solito un riepilogo. Trattarlo
  // come una frase interrotta faceva partire riprese inutili: viste dal vivo due di fila,
  // su riepiloghi gia' completi.
  const bulletLines = lines.filter(function (l) { return /^\s*[-*\u2022]\s+\S/.test(l); }).length;
  if (/^[-*\u2022]\s+\S/.test(lastLine) && bulletLines >= 2) return null;

  // 3. La risposta finisce su una voce di elenco. E' un troncamento solo se la lista
  //    non ha raggiunto il numero di elementi che l'utente aveva chiesto.
  if (endsOnListItem) {
    return listReachedRequestedCount(trimmed) ? null : 'elenco interrotto';
  }

  // 4. Risposta lunga che si ferma senza chiudere la frase. La soglia evita di far
  //    scattare la ripresa su risposte brevi legittime tipo "TUTTO OK".
  //    Come per i token, conta il testo dell'ultima risposta: le frasi scritte prima delle
  //    chiamate agli strumenti non dicono nulla su come e' finita quella conclusiva.
  const testoFinale = ultimaRisposta ? assistantText(ultimaRisposta).replace(/\s+$/, '') : trimmed;
  if (outputTokens >= 80 || testoFinale.length >= 400) {
    return 'risposta interrotta a meta';
  }

  return null;
}

function cancelAutoContinue() {
  if (autoContinueTimer) {
    clearTimeout(autoContinueTimer);
    autoContinueTimer = null;
    chatBroadcast('auto-continue', { active: false });
  }
  pulisciBozzaAutoContinue();
}

let autoContinueDraftFile = null;

function pulisciBozzaAutoContinue() {
  if (!autoContinueDraftFile) return;
  try {
    const base = path.join(os.tmpdir(), 'notexist-studio-bozze');
    if (path.resolve(autoContinueDraftFile).toLowerCase().indexOf(path.resolve(base).toLowerCase() + path.sep) === 0) {
      fs.unlinkSync(autoContinueDraftFile);
    }
  } catch (e) {}
  autoContinueDraftFile = null;
}

function scheduleAutoContinue(reason) {
  const configurato = Math.max(0, Number(config.autoContinueMax) || 0);
  const max = reason === gptOssAgent.MOTIVO_NESSUNA_AZIONE
    ? Math.min(2, configurato || 2)
    : reason === 'problema di rete temporaneo'
    ? Math.min(3, configurato || 3)
    : reason === 'limite temporaneo del provider'
    ? Math.min(8, configurato || 8)
    : Math.min(4, configurato || 4);
  if (autoContinueCount >= max) {
    chatSystemMessage(
      'Risposta ancora incompleta (' + reason + ') dopo ' + max + ' riprese automatiche. ' +
      'Scrivi "continua" per proseguire a mano.', 'warn');
    pulisciBozzaAutoContinue();
    return;
  }

  autoContinueCount += 1;
  const attempt = autoContinueCount;
  chatBroadcast('auto-continue', { active: true, attempt: attempt, max: max, reason: reason });

  // Sulla rete usiamo backoff esponenziale; sui troncamenti basta attendere la
  // chiusura del turno. In nessun caso si martella il provider in un loop rapido.
  const ritardo = reason === 'limite temporaneo del provider'
    ? Math.min(60000, 15000 * Math.pow(2, attempt - 1))
    : reason === 'problema di rete temporaneo'
    ? Math.min(8000, 1000 * Math.pow(2, attempt - 1))
    : 800;
  autoContinueTimer = setTimeout(function () {
    autoContinueTimer = null;
    if (!config.autoContinue) return;
    // Se nel frattempo e' partito un altro turno (l'utente ha scritto, o ha premuto
    // Interrompi e poi riprovato) la ripresa non deve accodarsi sopra.
    if (chatBusy) {
      console.log('[Auto-Continue] Annullata: un altro turno risulta gia in corso.');
      return;
    }
    console.log('[Auto-Continue] Ripresa ' + attempt + '/' + max + ' (' + reason + ')');

    // Checkpoint di sicurezza: salva il testo/codice parziale generato prima dell'interruzione
    // cosi' da non perderlo e consentire ad Adam di riprenderlo senza ripartire da zero.
    // Un turno di solo ragionamento non ha nulla da salvare: la "bozza" sarebbe il ragionamento stesso,
    // e Adam sprecherebbe contesto a rileggerla.
    const soloPensato = reason === MOTIVO_SOLO_RAGIONAMENTO;
    const senzaTestoFinale = reason === MOTIVO_SENZA_TESTO_FINALE;
    const testoTurno = currentTurnText().trim();
    let bozzaSalvata = false;
    let fileBozza = '';
    if (testoTurno.length > 50 && config.cwd && !soloPensato) {
      try {
        const dirBozze = path.join(os.tmpdir(), 'notexist-studio-bozze');
        fs.mkdirSync(dirBozze, { recursive: true, mode: 0o700 });
        const idBozza = crypto.createHash('sha256').update(String(config.cwd) + '|' + String(chatSessionId || ''))
          .digest('hex').slice(0, 16);
        fileBozza = path.join(dirBozze, 'turno-' + idBozza + '.txt');
        fs.writeFileSync(fileBozza, testoTurno, { encoding: 'utf8', mode: 0o600 });
        autoContinueDraftFile = fileBozza;
        bozzaSalvata = true;
        console.log('[Auto-Continue] Salvata bozza temporanea del turno interrotto.');
      } catch (e) {
        console.error('[Auto-Continue] Impossibile salvare la bozza:', e.message);
      }
    }

    const ripresaGit = /git push|push non verificato/i.test(reason);
    const ripresaGptOss = reason === gptOssAgent.MOTIVO_NESSUNA_AZIONE;
    let promptRipresa = ripresaGptOss
      ? 'La richiesta dell\'utente richiede un risultato concreto. Nel turno precedente hai soltanto analizzato o descritto il lavoro senza eseguire azioni reali. ' +
        'Non spiegare all\'utente come farlo: usa ORA gli strumenti necessari, applica davvero la modifica o il comando richiesto e verifica il risultato. ' +
        'Non chiudere il turno finche\' il task non e\' stato portato a termine oppure esiste un impedimento reale che richiede una scelta dell\'utente.'
      : ripresaGit
      ? 'La richiesta Git dell\'utente non e\' ancora completata: ' + reason + '. ' +
        'Esegui adesso con Bash il push reale e correggi l\'eventuale causa del fallimento. ' +
        'Non dichiarare successo finche\' il remoto non e\' verificato.'
      : soloPensato
      ? 'Hai solo ragionato su cosa fare, senza eseguirlo e senza scrivere nulla. Esegui adesso l\'azione ' +
        'che avevi deciso, usando gli strumenti.'
      : senzaTestoFinale
      ? 'Il turno precedente si e\' chiuso senza una risposta visibile per l\'utente. Controlla gli esiti ' +
        'degli strumenti gia\' eseguiti e i file eventualmente modificati. Se il lavoro non e\' completo, ' +
        'completalo e verificalo adesso; se e\' completo, scrivi una risposta finale chiara che descriva ' +
        'il risultato. Non limitarti al ragionamento e non chiudere di nuovo il turno senza testo.' +
        (dialogoGuidato.isNemotronNvidia(config.provider, config.model)
          ? ' Se invece sei bloccato perche\' manca una scelta dell\'utente, emetti il blocco ```adam-envelope ' +
            'LETTERALMENTE nel testo finale; non usare Bash, echo, Write, Skill o altri strumenti per emetterlo.'
          : '')
      : 'Continua esattamente da dove ti eri fermato. Non ripetere quanto hai gia\' scritto, ' +
        'non ripartire da capo e non aggiungere preamboli.';
    if (bozzaSalvata) {
      promptRipresa += ' Ho salvato il testo e il codice generato prima dell\'interruzione nel file temporaneo `' + fileBozza + '`: ' +
        'consultalo se ti serve recuperare parti non ancora salvate.';
    }
    promptRipresa += ' ISTRUZIONI DI SCRITTURA: Se devi creare un file NUOVO che NON esiste ancora su disco, ' +
      'crealo SUBITO con Write salvando SOLO uno scheletro minimale di 10-15 righe (MAI provare a scriverlo tutto in una volta). ' +
      'Se invece il file ESISTE già su disco, NON usare Write da zero: verificalo con Read e usa Edit per inserire i blocchi mancanti. ' +
      'Esegui SUBITO lo strumento nel turno attuale senza fermarti a parlare!';

    sendChatPrompt(promptRipresa, { auto: true, attempt: attempt, max: max, reason: reason });
  }, ritardo);
}

// Riavvia le sessioni per far entrare in vigore la memoria aggiornata, senza
// perdere la conversazione: la chat riprende con --resume.
let memoryRestartTimer = null;
let memoryRestartPending = false;

function restartSessionsForMemory() {
  if (memoryRestartTimer) clearTimeout(memoryRestartTimer);
  // Debounce: salvando piu' voci di fila non ha senso riavviare a ogni voce.
  memoryRestartTimer = setTimeout(function () {
    memoryRestartTimer = null;
    if (chatBusy) {
      // Un turno e' in corso. Riavviare adesso ucciderebbe il processo prima che
      // risponda, e il messaggio dell'utente sparirebbe senza alcun errore: si
      // vedrebbe solo la propria domanda restare li' senza risposta. Si rimanda.
      memoryRestartPending = true;
      console.log('[Memoria] Riavvio rimandato: turno in corso.');
      return;
    }
    applyMemoryRestart();
  }, 1500);
}

function applyMemoryRestart() {
  if (chatBusy) {
    memoryRestartPending = true;
    return;
  }
  memoryRestartPending = false;
  console.log('[Memoria] Aggiornata: riavvio delle sessioni per applicarla.');
  startClaudeProcess();
  startChatProcess({ resume: chatSessionId, keepHistory: true });
}

// ============================================================
// VERIFICA AUTOMATICA
// Un modello locale dichiara spesso "fatto" su codice che non compila. Invece di
// fidarci, controlliamo i file che ha toccato e gli rimandiamo gli errori esatti,
// finche' non sono risolti. E' il ciclo che un umano farebbe a mano.
// ============================================================

let turnTouchedFiles = new Set();
let turnEvidence = { letture: 0, ricerche: 0, scritture: 0, azioni: 0, test: 0, testFalliti: 0, testFunzionali: 0 };
let autoFixCount = 0;
let pendingFixTimer = null;   // correzione in attesa che la chat si liberi
let generazioneCorrezione = 0; // cresce a ogni annullamento: le catene vecchie si fermano da sole
let knownIssues = [];        // problemi visti, con lo stato di risoluzione
let quadroInSospeso = null;  // motivo per cui al prossimo turno Adam va fermato e rimesso a fuoco
let vincoloGitPushCorrente = null; // prova indipendente del push esplicitamente chiesto dall'utente

// Strumenti che modificano file, con il campo che contiene il percorso.
const FILE_TOOLS = { Write: 'file_path', Edit: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' };

function azzeraEvidenzeTurno() {
  turnEvidence = { letture: 0, ricerche: 0, scritture: 0, azioni: 0, test: 0, testFalliti: 0, testFunzionali: 0 };
}

function impostaVincoloGitPush(testo) {
  vincoloGitPushCorrente = gitPushVerificato.creaStato(testo, config.cwd || process.cwd());
}

function descriviEsitoGitPush(esito) {
  const destinazione = [esito.remote, esito.remoteBranch].filter(Boolean).join('/');
  const sha = String(esito.headRemoto || esito.headLocale || '').slice(0, 12);
  let testo = 'Push verificato direttamente sul remoto' + (destinazione ? ' ' + destinazione : '') +
    (sha ? ': commit ' + sha : '') + '. ' + esito.fileNelCommit +
    (esito.fileNelCommit === 1 ? ' file versionato presente nel commit.' : ' file versionati presenti nel commit.');
  if (!esito.pulito) {
    testo += ' Attenzione: restano ' + esito.modificheLocali.length +
      (esito.modificheLocali.length === 1 ? ' modifica locale non inclusa nel push.' : ' modifiche locali non incluse nel push.');
  }
  return testo;
}

function registraEsitoGitPush(nome, input, errore, risultato) {
  const stato = vincoloGitPushCorrente;
  if (!stato || nome !== 'Bash') return;
  const comando = String((input || {}).command || '');
  if (!gitPushVerificato.contieneComandoPush(comando)) return;

  stato.eseguito = true;
  stato.finalizzato = false;
  stato.avvisoMancanzaMostrato = false;
  stato.tentativoVerifica += 1;
  const tentativo = stato.tentativoVerifica;
  if (errore) {
    stato.comandoFallito = true;
    stato.erroreComando = String(risultato || '').trim().slice(0, 500);
    stato.verificaInCorso = false;
    stato.verifica = null;
    return;
  }

  stato.comandoFallito = false;
  stato.erroreComando = '';
  stato.verificaInCorso = true;
  stato.verifica = null;
  const cartella = gitPushVerificato.cartellaDelPush(comando, stato.cartella);
  gitPushVerificato.verificaPushRemoto(cartella).then(function (esito) {
    // Se nel frattempo e' arrivata una richiesta nuova o un secondo push, questo
    // risultato appartiene a uno stato vecchio e non deve certificare quello nuovo.
    if (vincoloGitPushCorrente !== stato || stato.tentativoVerifica !== tentativo) return;
    stato.verificaInCorso = false;
    stato.verifica = esito;
    if (esito.remotoAllineato) {
      chatSystemMessage('✅ ' + descriviEsitoGitPush(esito), esito.pulito ? 'info' : 'warn');
    } else {
      chatSystemMessage('⚠️ Il comando `git push` e\' stato eseguito, ma il controllo remoto non lo conferma: ' +
        (esito.errore || 'SHA remoto diverso dal commit locale') + '.', 'warn');
    }

    const motivo = gitPushVerificato.motivoNonCompletato(stato);
    if (motivo && stato.finalizzato && config.autoContinue && !chatBusy && !autoContinueTimer) {
      scheduleAutoContinue(motivo);
    }
  }).catch(function (erroreVerifica) {
    if (vincoloGitPushCorrente !== stato || stato.tentativoVerifica !== tentativo) return;
    stato.verificaInCorso = false;
    stato.verifica = { remotoAllineato: false, errore: erroreVerifica.message };
    chatSystemMessage('⚠️ Il push e\' partito, ma la verifica remota e\' fallita: ' + erroreVerifica.message + '.', 'warn');
    if (stato.finalizzato && config.autoContinue && !chatBusy && !autoContinueTimer) {
      scheduleAutoContinue(gitPushVerificato.motivoNonCompletato(stato));
    }
  });
}

function registraEvidenzaStrumento(nome, input, errore) {
  if (nome === 'Read') turnEvidence.letture += errore ? 0 : 1;
  if (nome === 'Grep' || nome === 'Glob') turnEvidence.ricerche += errore ? 0 : 1;
  if (FILE_TOOLS[nome]) turnEvidence.scritture += errore ? 0 : 1;
  if (!errore && nome !== 'Read' && nome !== 'Grep' && nome !== 'Glob') turnEvidence.azioni += 1;
  if (nome === 'Bash') {
    const command = String((input || {}).command || '');
    if (/\b(npm\s+(?:run\s+)?test|pytest|unittest|jest|vitest|mocha|cypress|playwright|node\s+--check|py_compile|verifica\.js|dotnet\s+test|cargo\s+test)\b/i.test(command)) {
      turnEvidence.test += 1;
      if (errore) turnEvidence.testFalliti += 1;
      if (/cypress|playwright|verifica\.js|e2e|integration/i.test(command) && !errore) turnEvidence.testFunzionali += 1;
    }
  }
}

function recordTouchedFile(toolName, input) {
  const field = FILE_TOOLS[toolName];
  if (!field || !input) return;
  const value = input[field];
  if (typeof value === 'string' && value.trim()) {
    turnTouchedFiles.add(path.isAbsolute(value.trim()) ? value.trim() : path.resolve(config.cwd || '.', value.trim()));
  }
}

// Controlli per estensione. Nessuno di questi ESEGUE il codice del progetto:
// verificano solo che sia sintatticamente valido.
function verifyOneFile(file) {
  return new Promise(function (resolve) {
    if (!fs.existsSync(file)) {
      return resolve({ file: file, ok: false, error: 'Il file non esiste.' });
    }
    const ext = path.extname(file).toLowerCase();

    if (ext === '.json') {
      try {
        JSON.parse(fs.readFileSync(file, 'utf8'));
        return resolve({ file: file, ok: true });
      } catch (e) {
        return resolve({ file: file, ok: false, error: 'JSON non valido: ' + e.message });
      }
    }

    if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
      // node --check analizza soltanto la sintassi. Non importiamo il modulo:
      // require(file) eseguiva top-level, server, cancellazioni e altri side effect.
      return execFile(process.execPath, ['--check', file], { timeout: 30000, cwd: config.cwd }, function (err, stdout, stderr) {
        if (!err) return resolve({ file: file, ok: true, skipped: false, verifica: 'sintassi JavaScript' });
        const output = (String(stderr || '') + String(stdout || '')).trim();
        resolve({ file: file, ok: false, error: output.slice(0, 1500) || err.message });
      });

    } else if (ext === '.py') {
      // ast.parse valida il sorgente senza importarlo e senza creare __pycache__.
      const scriptAst = 'import ast,pathlib,sys; p=pathlib.Path(sys.argv[1]); ast.parse(p.read_text(encoding="utf-8"), filename=str(p))';
      return execFile('python', ['-c', scriptAst, file], { timeout: 30000, cwd: config.cwd }, function (err, stdout, stderr) {
        if (!err) return resolve({ file: file, ok: true, skipped: false, verifica: 'AST Python' });
        const output = (String(stderr || '') + String(stdout || '')).trim();
        resolve({ file: file, ok: false, error: output.slice(0, 1500) || err.message });
      });

    } else {
      return resolve({ file: file, ok: true, skipped: true });
    }
  });
}

function runProjectTestCommand() {
  const command = (config.projectTestCommand || '').trim();
  if (!command) return Promise.resolve(null);
  const guard = guardianoLetture.giudicaComando(command, { cwd: config.cwd });
  if (!guard.permessa) {
    return Promise.resolve({ file: command, ok: false, error: 'Comando di test bloccato dal guard rail: ' + guard.motivo });
  }
  turnEvidence.test += 1;
  return new Promise(function (resolve) {
    exec(command, { cwd: config.cwd, timeout: 180000, windowsHide: true, maxBuffer: 5 * 1024 * 1024 }, function (err, stdout, stderr) {
      if (!err) {
        if (/cypress|playwright|verifica\.js|e2e|integration/i.test(command)) turnEvidence.testFunzionali += 1;
        return resolve({ file: command, ok: true });
      }
      turnEvidence.testFalliti += 1;
      const output = (String(stdout || '') + String(stderr || '')).trim();
      resolve({ file: command, ok: false, error: output.slice(0, 2500) || err.message });
    });
  });
}

async function runVerification() {
  const files = Array.from(turnTouchedFiles);
  const results = [];
  let semgrepStatus = null;
  for (const file of files) {
    results.push(await verifyOneFile(file));
  }
  const semgrepFiles = files.filter(semgrep.isLikelySourceFile);
  if (semgrepFiles.length) {
    const semgrepScan = await semgrep.scanProject(config.cwd, { files: semgrepFiles });
    semgrepStatus = {
      available: semgrepScan.available,
      executed: semgrepScan.executed,
      skipped: semgrepScan.skipped === true,
      reason: semgrepScan.reason || null,
      error: semgrepScan.error || null,
      scannedFiles: semgrepScan.scannedFiles || 0,
      findingsCount: (semgrepScan.findings || []).length,
      scannerErrors: semgrepScan.errors || [],
      advisories: []
    };
    if (semgrepScan.executed) {
      (semgrepScan.findings || []).forEach(function (finding) {
        const error = '[Semgrep ' + finding.severity + ' ' + finding.ruleId + '] Riga ' + finding.line + ': ' + finding.message;
        const bloccante = finding.severity === 'ERROR';
        const result = {
          file: finding.file,
          relative: finding.relative,
          ok: !bloccante,
          advisory: !bloccante,
          error: error,
          semgrep: true
        };
        results.push(result);
        if (!bloccante) semgrepStatus.advisories.push({ file: finding.relative, error: error });
      });
    } else if (semgrepScan.available === false && !semgrepScan.skipped) {
      console.log('[Semgrep] Non installato o non trovato. ' + (semgrepScan.reason || 'La scansione aggiuntiva e\' stata saltata.'));
    } else if (semgrepScan.error) {
      console.warn('[Semgrep] Scansione non completata:', semgrepScan.error.slice(0, 500));
    }
  } else if (files.length) {
    semgrepStatus = { skipped: true, reason: 'I file modificati non hanno estensioni analizzabili da Semgrep.', findingsCount: 0, advisories: [] };
  }
  // Il cervello del progetto: nomi inesistenti, chiavi mancanti, id che l'HTML non ha, import
  // sbagliati. Solo errori GRAVI, nei file toccati o legati a loro; la sintassi dei .js la
  // controlla gia' node --check qui sopra, quindi non la si ripete.
  const eUnity = scheletri.eProgettoUnity && scheletri.eProgettoUnity(config.cwd);
  if (!eUnity && files.some(function (f) { return /\.(m?js|cjs|html?|css)$/i.test(f); })) {
    try {
      const giaRotti = new Set(results.filter(function (r) { return !r.ok; })
        .map(function (r) { return path.resolve(r.file).toLowerCase(); }));
      const problemiWeb = cervelloComandi.erroriGraviPerVerifica(config.cwd, files);
      problemiWeb.forEach(function (p) {
        if (/\|sintassi$/.test(p.chiave) && giaRotti.has(path.resolve(p.percorso).toLowerCase())) return;
        results.push({ file: p.percorso, ok: false, error: 'Riga ' + p.riga + ': ' + p.messaggio + ' [cervello del progetto]' });
      });
      files.filter(function (f) { return /\.(m?js|cjs|html?|css)$/i.test(f); }).forEach(function (file) {
        const key = path.resolve(file).toLowerCase();
        const rotto = results.some(function (r) { return !r.ok && path.resolve(r.file).toLowerCase() === key; });
        if (!rotto && !results.some(function (r) { return r.ok && !r.skipped && path.resolve(r.file).toLowerCase() === key; })) {
          results.push({ file: file, ok: true, skipped: false, verifica: 'analisi statica del progetto' });
        }
      });
    } catch (e) {
      console.error('[Cervello] Controllo di fine turno non riuscito:', e.message);
    }
  }
  // Python e Unity: stessi errori GRAVI che Adam riceve dopo ogni modifica, come rete di sicurezza.
  const toccatiPy = files.filter(function (f) { return /\.py$/i.test(f); });
  const toccatiCs = files.filter(function (f) { return /\.cs$/i.test(f); });
  if (toccatiPy.length) {
    try {
      const giaRotti = new Set(results.filter(function (r) { return !r.ok; }).map(function (r) { return path.resolve(r.file).toLowerCase(); }));
      const toccati = new Set(toccatiPy.map(function (f) { return path.resolve(config.cwd, f).toLowerCase(); }));
      const esito = await cervelloPython.analizzaPython(config.cwd);
      esito.problemi.forEach(function (p) {
        const completo = path.resolve(config.cwd, p.file);
        if (!p.grave || !toccati.has(completo.toLowerCase())) return;
        if (/\|sintassi$/.test(p.chiave) && giaRotti.has(completo.toLowerCase())) return;
        results.push({ file: completo, ok: false, error: 'Riga ' + p.riga + ': ' + p.messaggio + ' [cervello del progetto]' });
      });
      toccatiPy.forEach(function (file) {
        const key = path.resolve(file).toLowerCase();
        const rotto = results.some(function (r) { return !r.ok && path.resolve(r.file).toLowerCase() === key; });
        if (!rotto && !results.some(function (r) { return r.ok && !r.skipped && path.resolve(r.file).toLowerCase() === key; })) {
          results.push({ file: file, ok: true, skipped: false, verifica: 'analisi statica Python' });
        }
      });
    } catch (e) {
      console.error('[Cervello] Controllo Python di fine turno non riuscito:', e.message);
    }
  }
  // Un gioco con finestra (pygame) si giudica solo eseguendolo: lo Studio lo lancia senza aprire
  // finestre sullo schermo, preme Spazio/Invio e un clic come una persona, e guarda se si ferma
  // con un errore o se lo schermo non viene mai aggiornato.
  if (toccatiPy.length && provaProgrammaPython.usaPygame(config.cwd)) {
    try {
      const esito = await provaProgrammaPython.provaPython(config.cwd, { secondi: 8 });
      const d = provaProgrammaPython.problemiDellaProva(esito);
      if (esito.provato) {
        turnEvidence.test += 1;
        if (d.problemi.some(function (p) { return p.grave; })) turnEvidence.testFalliti += 1;
        else turnEvidence.testFunzionali += 1;
        console.log('[Python] ' + d.righe.join(' | '));
      }
      d.problemi.filter(function (p) { return p.grave; }).forEach(function (p) {
        results.push({ file: path.resolve(config.cwd, p.file), ok: false, error: 'Riga ' + p.riga + ': ' + p.messaggio + ' [programma eseguito davvero]' });
      });
    } catch (e) {
      console.error('[Python] Prova del programma non riuscita:', e.message);
    }
  }
  if (toccatiCs.length) {
    try {
      const esito = await cervelloUnity.analizzaUnity(config.cwd, { file: toccatiCs, compila: true, console: false, android: false });
      if (esito) {
        esito.problemi.filter(function (p) { return p.grave; }).forEach(function (p) {
          results.push({ file: path.join(esito.radice, p.file), ok: false, error: 'Riga ' + p.riga + ': ' + p.messaggio + ' [cervello del progetto]' });
        });
        toccatiCs.forEach(function (file) {
          const key = path.resolve(file).toLowerCase();
          const rotto = results.some(function (r) { return !r.ok && path.resolve(r.file).toLowerCase() === key; });
          if (!rotto) results.push({ file: file, ok: true, skipped: false, verifica: 'compilazione/analisi Unity' });
        });
      }
    } catch (e) {
      console.error('[Cervello] Controllo Unity di fine turno non riuscito:', e.message);
    }
  }
  const testResult = await runProjectTestCommand();
  if (testResult) results.push(testResult);
  return { results: results, semgrep: semgrepStatus };
}

// Annulla una correzione che sta aspettando il proprio turno. Serve quando i
// problemi vengono azzerati o si apre una chat nuova: chiedere di correggere errori
// che non esistono piu' e' peggio che non chiedere affatto.
function cancelPendingFix(motivo) {
  // Anche senza handle: una catena rimasta orfana vede la generazione cambiata e si ferma.
  generazioneCorrezione += 1;
  if (!pendingFixTimer) return;
  clearTimeout(pendingFixTimer);
  pendingFixTimer = null;
  console.log('[Verifica] Correzione in attesa annullata: ' + motivo + '.');
}

function rememberIssue(entry) {
  const existing = knownIssues.find(function (i) {
    return i.file === entry.file && i.error === entry.error;
  });
  if (existing) {
    existing.seen += 1;
    existing.resolved = false;
    existing.lastSeen = Date.now();
    return existing;
  }
  const issue = {
    id: 'iss' + Date.now() + '_' + knownIssues.length,
    file: entry.file,
    error: entry.error,
    seen: 1,
    resolved: false,
    firstSeen: Date.now(),
    lastSeen: Date.now()
  };
  knownIssues.push(issue);
  if (knownIssues.length > 100) knownIssues = knownIssues.slice(-100);
  return issue;
}

function resolveIssuesFor(file) {
  knownIssues.forEach(function (i) {
    if (i.file === file && !i.resolved) {
      i.resolved = true;
      i.resolvedAt = Date.now();
    }
  });
}

// ────────────────────────────────────────────────────────────
// "FERMATI UN MOMENTO": IL QUADRO DELLA SITUAZIONE
//
// Una persona che perde il filo si ferma e fa il punto. Adam no: tira avanti sicuro di se'
// anche quando la memoria si e' appena compattata e di quello che ha fatto non gli resta
// niente (visto dal vivo: da 24.423 a 853 token, e subito dopo ha "corretto i proiettili" di
// un gioco che non disegnava nulla). Il punto della situazione lo fa quindi lo Studio, con i
// fatti che ha misurato, e lo mette davanti ad Adam obbligandolo a ripensare il passo dopo.
// ────────────────────────────────────────────────────────────

function quandoLaChatELibera(fn, attese) {
  const quante = attese || 0;
  if (!chatBusy) return fn();
  if (quante > 60) return;      // ~2 minuti: oltre, si lascia perdere invece di accodare all'infinito
  setTimeout(function () { quandoLaChatELibera(fn, quante + 1); }, 2000);
}

function registraTurnoNelDiario(esito, problemi) {
  if (!config.cwd) return;
  try {
    diarioDiBordo.registraTurno(config.cwd, {
      file: Array.from(turnTouchedFiles),
      esito: esito,
      problemi: problemi || [],
      testo: currentTurnText()
    });
  } catch (e) {
    console.error('[Diario] Turno non registrato:', e.message);
  }
}

// Stato funzionale a tre valori: verificato, fallito oppure sconosciuto. Zero
// requisiti riconosciuti non significa piu' "tutto passato".
function statoRequisiti() {
  try {
    const piano = capoProgetto.leggi(config.cwd);
    const richiesta = piano && (piano.richiestaCompleta || piano.richiesta);
    const esito = require('./strumenti/requisiti').controllaRequisiti(config.cwd, richiesta ? { richiesta: richiesta } : {});
    const punti = esito.punti || [];
    const mancanti = punti.filter(function (p) { return !p.ok; });
    const testFunzionale = turnEvidence.testFunzionali > 0 && turnEvidence.testFalliti === 0;
    return {
      verificato: (punti.length > 0 && mancanti.length === 0) || testFunzionale,
      controllati: punti.length,
      mancanti: mancanti,
      sconosciuto: punti.length === 0 && !testFunzionale,
      criteri: (piano && piano.criteri) || []
    };
  } catch (e) {
    return { verificato: false, controllati: 0, mancanti: [], sconosciuto: true, criteri: [] };
  }
}

function mandaQuadro(motivo, problemi) {
  if (!motivo || !config.cwd) return false;
  let segnali = {};
  try { segnali = diarioDiBordo.segnali(config.cwd); } catch (e) { segnali = {}; }
  const decisione = quadroSituazione.serveIlQuadro(motivo, segnali);
  if (!decisione.serve) return false;
  let q;
  try {
    q = quadroSituazione.costruisci(config.cwd, {
      motivo: motivo, perche: decisione.perche, problemi: problemi, segnali: segnali
    });
  } catch (e) {
    console.error('[Quadro] Non costruito:', e.message);
    return false;
  }
  try { diarioDiBordo.registraQuadro(config.cwd, motivo); } catch (e) { /* il diario non e' indispensabile */ }
  console.log('[Quadro] Fermo Adam: ' + decisione.perche);
  // Per il "fatto" che non e' fatto si dice all'utente COSA manca: "i controlli dicono di no"
  // non spiegava niente, e sembrava uno stop senza motivo.
  const mancano = motivo === 'fatto-non-vero'
    ? (problemi || []).slice(0, 3).map(function (p) { return String(p).replace(/^MANCA\s+/, ''); })
    : [];
  chatSystemMessage(mancano.length
    ? 'Mi sono fermato un momento: Adam ha detto che era fatto, ma nella tua richiesta c\'e\' un punto che nel ' +
      'progetto non risulta:\n' + elencoPuntato(mancano) + '\nGli ho rimesso davanti la tua richiesta punto per ' +
      'punto. Appena dice cosa fara\', lo faccio ripartire da solo.'
    : 'Mi sono fermato un momento: ' + decisione.perche + '. Ho rimesso davanti ad Adam il quadro ' +
      'della situazione (la tua richiesta punto per punto, i file veri, le ultime misure, cosa ha gia\' provato) e ' +
      'gli ho chiesto di ripensare il prossimo passo prima di toccare i file.', 'info');
  quandoLaChatELibera(function () {
    quadroInAttesa = { motivo: motivo, problemi: problemi || [], quando: Date.now() };
    sendChatPrompt(q.testo, { auto: true, attempt: 1, max: 1, reason: 'quadro della situazione' });
  });
  return true;
}

// ────────────────────────────────────────────────────────────
// ROUTER BIMODALE — il Coder come primo soccorso sugli errori
//
// Quando autoVerify trova errori nei file toccati da Adam, invece di mandare
// subito il prompt di correzione ad Adam (che ha gia' lavorato molto e potrebbe
// sbagliare di nuovo), proviamo a farli correggere al Coder specializzato.
// Se il Coder riesce, la verifica riparte: se ora passa, Adam non deve fare nulla.
// Se il Coder fallisce o non e' configurato, si passa al flusso normale con Adam.
//
// Ritorna: true  = il Coder ha corretto tutti gli errori, verifica ripetuta OK
//          false = il Coder non disponibile, fallito, o la reverifica ha trovato ancora errori
// ────────────────────────────────────────────────────────────

async function delegaAlCoderSuErrori(failures) {
  const modello = modelloCoderConfigurato();
  if (!modello) return false;               // coder disattivato
  if (!failures || !failures.length) return false;

  // Solo i file che il Coder sa gestire
  const filesDaCorr = failures
    .map(function (f) { return f.file; })
    .filter(function (f) { return f && programmatore.èFileDiCodice(f); });
  if (!filesDaCorr.length) return false;

  const istruzioniAdam = currentTurnText();  // piano testuale di Adam come contesto
  const coderProvider = String(config.coderProvider || '').trim() || (modello.includes(':') ? 'ollama' : config.provider || 'ollama');
  const baseUrl = baseUrlForProvider(coderProvider);

  console.log('[Coder] Tentativo di correzione automatica su ' + filesDaCorr.length + ' file...');
  chatBroadcast('coder', {
    state: 'corso',
    label: 'Il Coder sta correggendo ' + filesDaCorr.length + (filesDaCorr.length === 1 ? ' file' : ' file') + '…'
  });

  let risultati;
  try {
    risultati = await programmatore.correggiFiles({
      files: filesDaCorr,
      dir: config.cwd,
      istruzioni: istruzioniAdam,
      errori: failures,
      baseUrl: baseUrl,
      modello: modello,
      apiKey: coderProvider === 'fcc' ? '' : (getKeyForProvider(coderProvider) || config.apiKey || process.env.ANTHROPIC_API_KEY || ''),
      authToken: config.authToken || '',
      provider: coderProvider,
      executable: coderProvider === 'fcc' ? getClaudeExecutable() : '',
      timeoutMs: 300000
    });
  } catch (e) {
    console.error('[Coder] Errore interno:', e.message);
    chatBroadcast('coder', { state: 'err', label: 'Coder: errore interno' });
    return false;
  }

  const ok   = risultati.filter(function (r) { return r.ok; });
  const fail = risultati.filter(function (r) { return !r.ok; });

  if (ok.length) {
    ok.forEach(function (r) { chatBroadcast('files-changed', { file: r.file }); });
  }

  if (fail.length) {
    const msgFail = fail.map(function (r) { return path.basename(r.file) + ': ' + r.errore; }).join('; ');
    console.log('[Coder] Fallito su: ' + msgFail);
    chatBroadcast('coder', { state: 'err', label: 'Coder parzialmente fallito: ' + msgFail });
    return false; // anche un solo fallimento: lasciamo decidere ad Adam
  }

  // Tutti i file corretti: rieseguiamo la verifica per vedere se gli errori sono spariti
  console.log('[Coder] File corretti. Riverifica in corso...');
  let reverifica;
  try {
    reverifica = (await runVerification()).results;
  } catch (e) {
    console.error('[Coder] Errore riverifica:', e.message);
    return false;
  }

  const ancoraErrori = reverifica.filter(function (r) { return !r.ok; });
  if (ancoraErrori.length) {
    console.log('[Coder] Riverifica: restano ' + ancoraErrori.length + ' errori. Adam li correggerà.');
    chatBroadcast('coder', {
      state: 'warn',
      label: 'Coder ha corretto i file ma restano ' + ancoraErrori.length + ' errori: Adam interviene.'
    });
    return false;
  }

  const durate = risultati.map(function (r) { return Math.round((r.durataMs || 0) / 1000); });
  const durataMax = Math.max.apply(null, durate);
  chatBroadcast('coder', {
    state: 'ok',
    label: '✅ Coder ha corretto ' + ok.length + ' file in ' + durataMax + ' s — nessun errore residuo.'
  });
  chatSystemMessage(
    '✅ Il Coder (' + modello + ') ha corretto automaticamente: ' +
    ok.map(function (r) { return path.basename(r.file); }).join(', ') + '.',
    'info');
  reverifica.forEach(function (r) {
    if (r.ok && !r.skipped && !r.advisory) resolveIssuesFor(r.file);
  });
  return true; // segnala a verifyAndMaybeFix di non inviare il prompt ad Adam
}

function buildFixPrompt(failures) {

  const blocks = failures.map(function (f) {
    return 'FILE: ' + f.file + '\nERRORE:\n' + f.error;
  }).join('\n\n');
  return 'La verifica automatica ha trovato ' + failures.length +
    (failures.length === 1 ? ' errore' : ' errori') + ' in quello che hai appena scritto.\n\n' +
    blocks +
    '\n\nCorreggi TUTTI questi errori modificando i file con lo strumento Edit o Write. ' +
    'Non limitarti a spiegare: applica le correzioni. Non ripetere il codice in chat.';
}

// Un turno in cui Adam non ha toccato nessun file e' comunque un turno: va nel diario, e se era
// in sospeso un quadro della situazione va mandato adesso. Visto dal vivo (17/9/2026, 18:26):
// dopo una compattazione Adam si e' ripresentato senza fare niente, e siccome non aveva toccato
// file lo Studio usciva subito, lasciando il quadro in sospeso per sempre. Il turno a vuoto
// subito dopo una compattazione e' proprio il momento in cui serve rimettergli davanti il compito.
function chiudiTurnoSenzaModifiche() {
  registraTurnoNelDiario('nessuna modifica', []);
  const funzionale = statoRequisiti();
  const testOk = turnEvidence.test > 0 && turnEvidence.testFalliti === 0;
  chiudiPassoDelTurno(testOk ? true : null, null, 0, funzionale.mancanti, funzionale);
  // Se questo turno era la risposta al quadro della situazione, Adam ha detto cosa fara' ma non
  // l'ha ancora fatto: lo Studio lo fa ripartire dal passo che si e' dato da solo.
  if (rilanciaDopoIlQuadro()) {
    quadroInSospeso = null;
    return;
  }
  const inSospeso = quadroInSospeso;
  quadroInSospeso = null;
  if (inSospeso) mandaQuadro(inSospeso);
}

// ── DOPO IL QUADRO SI RIPARTE ─────────────────────────────
// Visto dal vivo (18/9/2026). Adam dice "il gioco e' completamente funzionante" ma il multiplayer
// chiesto dall'utente non c'e': lo Studio lo ferma e gli rimette davanti il quadro. Adam risponde
// benissimo - "manca il multiplayer reale, il prossimo passo e' un server.js" - e poi il turno
// finisce li'. Nessuno gli diceva di cominciare, e l'utente si ritrovava lo Studio fermo:
// "ma perche' si deve fermare?". Fermarsi a pensare serve; restare fermi no.
let quadroInAttesa = null;     // quadro mandato ad Adam: la sua prossima risposta dice cosa fara'
let rilanciDopoQuadro = 0;     // quante volte e' gia' ripartito da solo per questa richiesta
const MAX_RILANCI_DOPO_QUADRO = 2;

function rilanciaDopoIlQuadro() {
  const attesa = quadroInAttesa;
  quadroInAttesa = null;
  if (!attesa || !config.cwd) return false;
  const deciso = capoProgetto.prossimoPassoDichiarato(currentTurnText());
  // Non si e' dato un passo (per esempio ha scritto che non si puo' fare): decide l'utente.
  if (!deciso) return false;
  if (rilanciDopoQuadro >= MAX_RILANCI_DOPO_QUADRO) {
    chatSystemMessage('Adam ci ha gia\' provato ' + rilanciDopoQuadro + ' volte e alla tua richiesta manca ancora ' +
      'qualcosa. Non lo faccio ripartire da solo una terza volta: dimmi tu come preferisci procedere.', 'warn');
    return false;
  }
  rilanciDopoQuadro++;
  // "Esploro i file per capire la struttura" non e' un passo: non cambia niente, e rilanciarlo cosi'
  // ha prodotto tredici Grep identiche di fila (visto dal vivo il 18/9/2026). Il passo deve
  // cambiare un file; esplorare, Adam l'ha gia' fatto per rispondere al quadro.
  const soloGuardare = /^(esplor|analizz|legg|cerc|controll|capi|verific|guard|studi|esamin|ispezion|osserv|valut|approfond)/i
    .test(String(deciso.passo).trim());
  if (soloGuardare) {
    let compito = '';
    try { compito = (capoProgetto.leggi(config.cwd) || {}).compito || ''; } catch (e) { compito = ''; }
    deciso.passo = 'la PRIMA modifica concreta a un file' + (compito ? ' per: ' + compito : '') +
      ' (esplorare lo hai gia\' fatto: adesso si cambia qualcosa)';
  } else {
    try { capoProgetto.aggiungiPassoUrgente(config.cwd, deciso.passo, { urgente: false }); } catch (e) { /* il piano non e' indispensabile */ }
  }
  // Un gioco 3D o multiplayer non si scrive da zero: lo Studio ne ha gia' uno che funziona (MA NON su Unity).
  const eUnity = scheletri.eProgettoUnity && scheletri.eProgettoUnity(config.cwd);
  const perGioco = !eUnity && (attesa.problemi || []).some(function (p) { return /multiplayer|FPS|3D/i.test(String(p)); });
  const testo = [
    'Bene: adesso sai cosa manca. Fai il passo che ti sei dato tu, e solo quello:',
    '  ' + deciso.passo,
    deciso.verifica ? 'Poi verificalo come hai detto: ' + deciso.verifica : 'Poi verificalo davvero, non a parole.',
    eUnity ? 'Attenzione: questo e\' un progetto Unity (C#). NON guardare ne\' usare gli scheletri dello Studio (sono per Web/Python). Crea e modifica script C# in Assets/.' : '',
    perGioco ? 'Prima di scriverlo da zero: lo Studio ha gia\' un FPS multiplayer che funziona, con il server ' +
      'WebSocket fatto senza installare niente. Guardalo con ' + scheletri.COMANDO + ' --elenco. Lo scheletro si ' +
      'LEGGE soltanto: prendi le parti che ti servono e scrivile nei file del progetto, non modificare l\'originale.' : '',
    'Quando hai finito, chiudi con la riga PASSO FATTO: <cosa hai fatto>.'
  ].filter(Boolean).join('\n');
  console.log('[Quadro] Adam si e\' dato un passo, lo faccio ripartire: ' + deciso.passo);
  chatSystemMessage('Adam ha capito cosa manca e si e\' dato un passo: "' + deciso.passo + '". ' +
    'Lo faccio ripartire da solo, non serve che tu scriva niente.', 'info');
  quandoLaChatELibera(function () {
    sendChatPrompt(testo, { auto: true, attempt: rilanciDopoQuadro, max: MAX_RILANCI_DOPO_QUADRO, reason: 'riparte dal passo deciso' });
  });
  return true;
}

async function verifyAndMaybeFix() {
  if (!config.autoVerify) { chiudiTurnoSenzaModifiche(); return; }
  if (turnTouchedFiles.size === 0 && !(config.projectTestCommand || '').trim()) {
    chiudiTurnoSenzaModifiche();
    sondaDopoIlTurno([]);
    return;
  }

  const filesChecked = Array.from(turnTouchedFiles);
  chatBroadcast('verify', { state: 'running', files: filesChecked });

  let results;
  let semgrepStatus = null;
  try {
    const verifica = await runVerification();
    results = verifica.results;
    semgrepStatus = verifica.semgrep;
  } catch (e) {
    console.error('[Verifica] Errore interno:', e.message);
    return;
  }

  const failures = results.filter(function (r) { return !r.ok; });
  results.filter(function (r) { return r.ok && !r.skipped && !r.advisory; })
    .forEach(function (r) { resolveIssuesFor(r.file); });

  if (failures.length === 0) {
    const checked = results.filter(function (r) { return !r.skipped; }).length;
    console.log('[Verifica] ' + checked + ' controlli superati.');
    chatBroadcast('verify', { state: 'ok', checked: checked, issues: knownIssues, semgrep: semgrepStatus });
    registraTurnoNelDiario('ok', []);
    // I controlli passano, ma la richiesta dell'utente e' un'altra cosa: se dice "fatto" mentre
    // mancano ancora dei punti, ci si ferma e si guarda il quadro invece di chiudere.
    const dichiaraFatto = /\b(fatto|completat\w*|finit\w*|pronto|funziona)\b/i.test(currentTurnText());
    const funzionale = statoRequisiti();
    const mancanti = funzionale.mancanti;
    const testiMancanti = mancanti.map(function (p) { return 'MANCA ' + p.nome + ': ' + p.prova; });
    // Una verifica tecnica e' positiva soltanto se almeno un controllo e' stato
    // realmente eseguito. Tutti i file "skipped" producono stato sconosciuto.
    chiudiPassoDelTurno(checked > 0, null, filesChecked.length, testiMancanti, funzionale);
    quadroInAttesa = null;
    const inSospesoOk = quadroInSospeso;
    quadroInSospeso = null;
    if (mancanti.length && dichiaraFatto) {
      mandaQuadro('fatto-non-vero', testiMancanti);
    } else {
      mandaQuadro(inSospesoOk);
    }
    autoFixCount = 0;
    turnTouchedFiles = new Set();
    sondaDopoIlTurno(filesChecked);

    // Apprendimento incrementale della memoria di progetto a fine turno:
    try {
      const estratto = currentTurnText();
      const primoPasso = estratto ? estratto.split('\n')[0].replace(/^#+\s*/, '').trim() : '';
      const resAppr = apprendimentoMemoria.aggiornaNeuroniDaFileModificati(config.cwd, filesChecked, {
        passo: primoPasso || 'Modifica completata e verificata'
      });
      if (resAppr.modificati > 0) {
        chatBroadcast('memory-updated', { projectDir: config.cwd, totalNodes: resAppr.nodiTotali });
      }
    } catch (e) {
      console.error('[Memoria] Errore aggiornamento neuroni fine turno:', e.message);
    }

    try {
      const azOk = generaSuggerimentiCorrenti();
      if (azOk.length > 0) chatBroadcast('suggerimenti-azioni', { actions: azOk });
    } catch (e) {}

    return;
  }

  failures.forEach(rememberIssue);
  const problemiMisurati = failures.map(function (f) { return f.file + ': ' + String(f.error).split('\n')[0]; });
  registraTurnoNelDiario('errori', problemiMisurati);
  chiudiPassoDelTurno(false, problemiMisurati);
  quadroInAttesa = null;       // ha lavorato sui file: la risposta al quadro, se c'era, e' arrivata
  console.log('[Verifica] ' + failures.length + ' errori: ' +
    failures.map(function (f) { return f.file; }).join(', '));
  chatBroadcast('verify', {
    state: 'failed',
    failures: failures,
    semgrep: semgrepStatus,
    attempt: autoFixCount + 1,
    max: massimoTentativiVerifica(),
    issues: knownIssues
  });

  // ── ROUTER BIMODALE ──────────────────────────────────────────
  // Prima di coinvolgere Adam, proviamo a far correggere il Coder.
  // Vantaggio: il 9B non spende token su compiti che un modello coding fa meglio.
  // Se il Coder non è configurato o fallisce, si scende al flusso normale con Adam.
  const coderRisolto = await delegaAlCoderSuErrori(failures);
  if (coderRisolto) {
    // Il Coder ha corretto tutto: reset del contatore e sonda come se fosse un successo.
    const checked = filesChecked.length;
    chatBroadcast('verify', { state: 'ok', checked: checked, issues: knownIssues });
    try {
      const resAppr = apprendimentoMemoria.aggiornaNeuroniDaFileModificati(config.cwd, filesChecked, {
        passo: 'Correzione automatica Coder'
      });
      if (resAppr.modificati > 0) {
        chatBroadcast('memory-updated', { projectDir: config.cwd, totalNodes: resAppr.nodiTotali });
      }
    } catch (e) {
      console.error('[Memoria] Errore aggiornamento neuroni coder:', e.message);
    }
    try {
      const azCoder = generaSuggerimentiCorrenti();
      if (azCoder.length > 0) chatBroadcast('suggerimenti-azioni', { actions: azCoder });
    } catch (e) {}
    autoFixCount = 0;
    turnTouchedFiles = new Set();
    sondaDopoIlTurno(filesChecked);
    return;
  }
  // ─────────────────────────────────────────────────────────────

  // Prima di chiedere l'ennesima correzione: se la memoria si e' appena compattata, se lo stesso
  // problema sopravvive da piu' turni o se non si muove piu' niente, ci si ferma e si fa il punto.
  const inSospeso = quadroInSospeso;
  quadroInSospeso = null;
  if (mandaQuadro(inSospeso, problemiMisurati) ||
      mandaQuadro('errori-ripetuti', problemiMisurati) ||
      mandaQuadro('nessun-progresso', problemiMisurati)) {
    turnTouchedFiles = new Set();
    return;
  }

  const max = massimoTentativiVerifica();
  if (autoFixCount >= max) {
    chatSystemMessage(
      'Dopo ' + max + ' tentativi restano ' + failures.length + ' errori non risolti:\n' +
      failures.map(function (f) { return '- ' + f.file + ': ' + f.error.split('\n')[0]; }).join('\n') +
      '\nLi trovi nel pannello Verifica. Serve un intervento manuale.', 'error');
    autoFixCount = 0;
    turnTouchedFiles = new Set();
    return;
  }

  autoFixCount += 1;
  const attempt = autoFixCount;
  turnTouchedFiles = new Set();

  // La correzione va ATTESA, non abbandonata: se un turno e' in corso (tipicamente
  // perche' nel frattempo l'utente ha scritto qualcosa) si riprova, invece di lasciare
  // l'errore aperto senza dirlo a nessuno. Prima il messaggio diceva "rimandata" ma in
  // realta' la richiesta veniva persa.
  let attesePerCorreggere = 0;
  const MAX_ATTESE = 60;   // ~2 minuti di attesa complessiva

  // Una sola correzione in attesa per volta: questa sostituisce quella di prima, se c'era.
  if (pendingFixTimer) clearTimeout(pendingFixTimer);
  generazioneCorrezione += 1;
  const miaGenerazione = generazioneCorrezione;

  const provaACorreggere = function () {
    if (miaGenerazione !== generazioneCorrezione) return;   // annullata o sostituita nel frattempo
    pendingFixTimer = null;
    if (!config.autoVerify) return;
    if (chatBusy) {
      attesePerCorreggere += 1;
      if (attesePerCorreggere === 1) {
        console.log('[Verifica] Un turno e\' in corso: attendo per chiedere la correzione.');
      }
      if (attesePerCorreggere > MAX_ATTESE) {
        console.log('[Verifica] Correzione non richiesta: turno ancora in corso dopo l\'attesa massima.');
        chatSystemMessage(
          'La verifica ha trovato ' + failures.length +
          (failures.length === 1 ? ' errore' : ' errori') +
          ' ma non ho potuto chiedere la correzione: la conversazione era occupata. ' +
          'I dettagli restano nel pannello Verifica.', 'warn');
        // Reset state because we are giving up
        autoFixCount = 0;
        turnTouchedFiles = new Set();
        return;
      }
      pendingFixTimer = setTimeout(provaACorreggere, 2000);
      return;
    }
    console.log('[Verifica] Chiedo la correzione ' + attempt + '/' + max);
    sendChatPrompt(buildFixPrompt(failures), {
      auto: true,
      attempt: attempt,
      max: max,
      reason: 'correzione errori di verifica'
    });
  };

  pendingFixTimer = setTimeout(provaACorreggere, 800);
}

// ============================================================
// SONDA NEL CICLO DI CHAT
// Da solo Adam non esegue la pagina: legge il codice, ipotizza e dichiara risolto.
// Lo Studio fa qui cio' che farebbe una persona esperta: davanti a una segnalazione
// di bug esegue la pagina e misura PRIMA di passare la domanda ad Adam, e dopo ogni
// sua modifica riesegue la stessa misura e confronta. "Risolto" lo dicono le misure,
// non Adam: e' lo stesso principio della verifica dei file, che l'app impone.
// ============================================================

function baseAnteprima() {
  return 'http://127.0.0.1:' + PORT + '/preview';
}

function annullaSonda(motivo) {
  if (revisoreInCorso && revisoreInCorso.annulla) {
    revisoreInCorso.annulla();
    revisoreInCorso = null;
  }
  if (sondaInvioTimer) {
    clearTimeout(sondaInvioTimer);
    sondaInvioTimer = null;
  }
  if (!sondaDaRipetere) return;
  sondaDaRipetere = null;
  console.log('[Sonda] Confronto annullato: ' + motivo + '.');
}

// Nel registro dei problemi lo stesso fatto misurato piu' volte e' UNA voce anche se i
// numeri cambiano, altrimenti ogni misura ne aggiungerebbe una copia.
function stessoFatto(issue, file, chiave) {
  return issue.file === file && issue.error.indexOf('[sonda] ') === 0 &&
    misure.chiaveFatto(issue.error.slice(8)) === chiave;
}

function registraFatto(file, fatto) {
  const chiave = misure.chiaveFatto(fatto);
  const esistente = knownIssues.find(function (i) { return stessoFatto(i, file, chiave); });
  if (!esistente) return rememberIssue({ file: file, error: '[sonda] ' + fatto });
  esistente.error = '[sonda] ' + fatto;
  esistente.seen += 1;
  esistente.resolved = false;
  esistente.lastSeen = Date.now();
  return esistente;
}

function risolviFatto(file, fatto) {
  const chiave = misure.chiaveFatto(fatto);
  knownIssues.forEach(function (i) {
    if (!i.resolved && stessoFatto(i, file, chiave)) {
      i.resolved = true;
      i.resolvedAt = Date.now();
    }
  });
}

function elencoPuntato(fatti) {
  return fatti.map(function (f) { return '- ' + f; }).join('\n');
}

// Il metodo che accompagna ogni misura passata ad Adam.
function comeProcedere(pagina) {
  return [
    'LINEE GUIDA:',
    '1. Rispondi prima di tutto all\'intento e alla richiesta espressa dall\'utente.',
    '2. Se la diagnostica automatica della pagina è rilevante per la richiesta, individua la causa nel codice prima di modificare.',
    '3. Fai modifiche mirate e pulite senza rileggere file interi.',
    '4. Se la richiesta riguarda un altro file o una sottocartella, lavora direttamente sul file appropriato.'
  ].join('\n');
}

// Scrive un messaggio alla sessione senza aggiungerlo di nuovo alla chat.
function scriviAlModello(contenuto) {
  if (!chatProc || !chatProc.stdin || !chatProc.stdin.writable) return false;
  const riga = JSON.stringify({ type: 'user', message: { role: 'user', content: contenuto } }) + '\n';
  try {
    chatProc.stdin.write(riga, function (err) {
      if (err) {
        console.error('[Sonda] Scrittura fallita:', err.code || err.message);
        setChatBusy(false);
      }
    });
    return true;
  } catch (e) {
    console.error('[Sonda] Scrittura fallita:', e.message);
    return false;
  }
}

// Punto d'ingresso dei messaggi scritti dall'utente, dalla chat e dall'API.
function inviaMessaggioUtente(text, pagina, opzioni) {
  const opts = opzioni || {};
  const immagini = Array.isArray(opts.immagini) ? opts.immagini : [];
  let trimmed = String(text || '').trim();
  // Un'immagine senza parole e' comunque una domanda: "guarda questa".
  if (!trimmed && immagini.length) {
    trimmed = immagini.length === 1 ? 'Guarda l\'immagine allegata.' : 'Guarda le immagini allegate.';
  }
  if (!trimmed) return { ok: false, error: 'Messaggio vuoto' };

  // Durante una misura i messaggi aspettano: arriverebbero ad Adam prima della domanda.
  if (sondaPreliminare) {
    messaggiInCoda.push({ text: trimmed, pagina: pagina, opzioni: opts });
    return { ok: true, inCoda: true };
  }

  // Il vincolo nasce soltanto da una richiesta esplicita dell'utente. Le riprese
  // automatiche conserveranno questo stesso stato fino alla prova sul remoto.
  impostaVincoloGitPush(trimmed);

  // Una richiesta nuova dell'utente: i rilanci dopo il quadro ripartono da zero.
  rilanciDopoQuadro = 0;
  quadroInAttesa = null;
  azzeraEvidenzeTurno();
  try { guardianoLetture.azzeraFallimenti(chatSessionId); } catch (e) { /* stato opzionale */ }
  // Il guardiano la legge per sapere se l'utente ha chiesto di rifare un file da zero: solo in
  // quel caso un Write puo' sostituire in blocco un file che c'e' gia' (strumenti/guardiano-letture.js).
  try {
    const cartellaDati = cervelloComandi.cartellaProgetto(config.cwd);
    fs.mkdirSync(cartellaDati, { recursive: true });
    fs.writeFileSync(path.join(cartellaDati, 'ultima-richiesta.txt'), trimmed.slice(0, 2000));
  } catch (e) { /* senza, il guardiano e' solo piu' prudente */ }

  // Il filo del lavoro: o e' un compito nuovo, o e' il passo di adesso (strumenti/capo-progetto.js).
  // Dopo la coda, non prima: un messaggio rimesso in coda ripassa di qui e conterebbe due volte.
  const aggiornamentoPiano = aggiornaCapoProgetto(trimmed);

  // MODALITA FUOCO NEMOTRON: un nuovo compito non eredita il ragionamento e le
  // ipotesi della sessione precedente. La chat resta visibile e archiviata, ma il
  // processo parte senza --resume e riceve dal Capo Progetto la sola richiesta attuale.
  if (aggiornamentoPiano && aggiornamentoPiano.nuovoCompito && chatSessionId &&
      dialogoGuidato.isNemotronNvidia(config.provider, config.model)) {
    startChatProcess({ keepHistory: true });
    chatSystemMessage('Modalità fuoco Nemotron: nuovo compito isolato dalle interpretazioni delle chat precedenti.', 'info');
  }

  // Nemotron tende a perdere la geometria leggendo soltanto il testo estratto dai PDF.
  // Per richieste come "sotto DigComp" lo Studio localizza l'ancora, crea un ritaglio
  // annotato e lo fa descrivere a Vision prima di consegnare il compito al modello.
  if (dialogoGuidato.isNemotronNvidia(config.provider, config.model) && pdfRiferimento.richiestaSpaziale(trimmed)) {
    setChatBusy(true, 'Localizzo il punto indicato nel PDF...');
    pdfRiferimento.prepara(config.cwd, trimmed).then(function (riferimento) {
      sendChatPromptConImmagini(pdfRiferimento.testoPerModello(trimmed, riferimento), [riferimento.crop], {});
    }).catch(function (e) {
      console.warn('[PDF] Riferimento grafico non disponibile:', e.message);
      chatSystemMessage('Non sono riuscito a localizzare automaticamente il riferimento nel PDF; proseguo con la richiesta originale.', 'warn');
      sendChatPrompt(trimmed);
    });
    return { ok: true, riferimentoPdf: true };
  }

  const scelta = opts.sonda !== false && config.autoVerify !== false &&
    misure.sembraUnBug(trimmed) && analisiRuntime.disponibile()
    ? misure.scegliPagina(misure.pagineDelProgetto(config.cwd), pagina, trimmed)
    : null;
  if (!scelta) {
    // Nessuna pagina web da provare, ma il progetto e' un programma con finestra e l'utente sta
    // segnalando un problema: si lancia il programma e si guarda, prima di rispondere.
    if (opts.sonda !== false && config.autoVerify !== false && misure.sembraUnBug(trimmed) &&
        provaProgrammaPython.usaPygame(config.cwd)) {
      provaProgrammaPrimaDiRispondere(trimmed, immagini).catch(function (e) {
        sondaPreliminare = false;
        setChatBusy(false);
        console.error('[Python] Prova preliminare fallita:', e.message);
      });
      return { ok: true, provaPython: true };
    }
    return immagini.length ? sendChatPromptConImmagini(trimmed, immagini, {}) : sendChatPrompt(trimmed);
  }

  misuraPrimaDiRispondere(trimmed, scelta, immagini).catch(function (e) {
    sondaPreliminare = false;
    console.error('[Sonda] Misura preliminare fallita:', e.message);
  });
  return { ok: true, sonda: scelta };
}

// Il programma Python lanciato davvero prima di passare la segnalazione ad Adam: cosa fa la
// finestra, se lo schermo viene aggiornato, dove si ferma, e una schermata da guardare.
async function provaProgrammaPrimaDiRispondere(testo, immaginiUtente) {
  if (!chatProc) startChatProcess({ resume: chatSessionId, keepHistory: !!chatSessionId });
  if (!chatProc) {
    chatSystemMessage('Sessione Claude non avviabile.', 'error');
    return;
  }
  autoContinueCount = 0;
  autoFixCount = 0;
  turnTouchedFiles = new Set();
  cancelAutoContinue();
  annullaSonda('nuova segnalazione');
  recuperiContesto = 0;

  sondaPreliminare = true;
  const nuovo = newMessage('user', [{ kind: 'text', text: testo }]);
  if (immaginiUtente && immaginiUtente.length) nuovo.immagini = immaginiUtente.map(function (p) { return path.basename(p); });
  const messaggio = pushChatMessage(nuovo);
  const dirMisura = config.cwd;
  setChatBusy(true, 'Lancio il programma e lo guardo, prima di passarlo ad Adam...');
  console.log('[Python] Segnalazione di bug: lancio il programma prima di passarlo ad Adam.');

  let testoPerAdam = testo;
  let immagini = (immaginiUtente || []).slice();
  try {
    const esito = await provaProgrammaPython.provaPython(dirMisura, { secondi: 8 });
    const d = provaProgrammaPython.problemiDellaProva(esito);
    const gravi = d.problemi.filter(function (p) { return p.grave; });
    const schermata = ((esito.finestra || {}).schermate || []).filter(function (s) { return s.file; }).pop();
    if (schermata) immagini = immagini.concat([schermata.file]);
    if (esito.provato) {
      testoPerAdam = testo + '\n\n' + [
        '---',
        'MISURE DELLO STUDIO, prese prima di passarti la domanda: ho lanciato il programma senza aprire ' +
          'finestre sullo schermo, ho premuto Spazio, Invio e cliccato come farebbe una persona, e ho guardato ' +
          'cosa succede' + (schermata ? '. Ti allego la schermata del programma.' : '.'),
        '',
        d.righe.map(function (x) { return '- ' + x; }).join('\n'),
        d.problemi.length ? '\nPROBLEMI MISURATI:\n' + d.problemi.map(function (p) {
          return '- ' + (p.grave ? 'GRAVE ' : '') + p.file + ':' + p.riga + ' ' + p.messaggio;
        }).join('\n') : '\nNessun problema misurato mentre girava.',
        '',
        'Parti da qui: correggi la causa nel codice, non indovinare. Quando hai finito rilancia la verifica ' +
          '(' + verificaCompleta.COMANDO + ') e guarda la schermata prima di dire che e\' fatto.'
      ].join('\n');
      chatSystemMessage(gravi.length
        ? 'Ho lanciato il programma prima di passarlo ad Adam: ' + gravi.length +
          (gravi.length === 1 ? ' problema grave' : ' problemi gravi') + '.\n' +
          elencoPuntato(gravi.map(function (p) { return accorciaTesto(p.file + ':' + p.riga + ' ' + p.messaggio, 220); }))
        : 'Ho lanciato il programma prima di passarlo ad Adam: ' + d.righe.join(' | '), 'info');
    } else {
      console.log('[Python] Programma non provato: ' + esito.motivo);
    }
  } catch (e) {
    console.error('[Python] Prova del programma non riuscita:', e.message);
  } finally {
    sondaPreliminare = false;
  }

  try {
    if (chatMessages.indexOf(messaggio) === -1 || !chatProc) {
      chatSystemMessage('Conversazione azzerata durante la prova del programma: il messaggio non e\' arrivato ad Adam.', 'warn');
      return;
    }
    fotografaPrimaDelTurno();
    const pronto = await contenutoConImmagini(testoPerIlModello(testoPerAdam), immagini, { continuaSenzaVisione: true });
    if (pronto.erroreVisione) {
      chatSystemMessage('Vision non era disponibile durante la verifica: passo comunque ad Adam misure e risultati testuali.', 'warn');
    }
    if (pronto.allegate.length) {
      messaggio.immagini = pronto.allegate;
      chatBroadcast('message-update', { message: messaggio });
    }
    setChatBusy(true, pronto.allegate.length ? 'Adam sta guardando il programma...' : 'In attesa di Adam...');
    if (!scriviAlModello(pronto.contenuto)) {
      setChatBusy(false);
      chatSystemMessage('La sessione si e\' chiusa mentre inviavo il messaggio. Riprova.', 'warn');
    }
  } catch (e) {
    setChatBusy(false);
    chatSystemMessage('Non sono riuscito a preparare le immagini della verifica: ' + e.message + '. Adam non le ha ricevute.', 'error');
  } finally {
    const coda = messaggiInCoda;
    messaggiInCoda = [];
    coda.forEach(function (m) { inviaMessaggioUtente(m.text, m.pagina, m.opzioni); });
  }
}

async function misuraPrimaDiRispondere(testo, pagina, immaginiUtente) {
  if (!chatProc) startChatProcess({ resume: chatSessionId, keepHistory: !!chatSessionId });
  if (!chatProc) {
    chatSystemMessage('Sessione Claude non avviabile.', 'error');
    return;
  }

  // Come per ogni messaggio scritto dall'utente: turno nuovo, contatori azzerati.
  autoContinueCount = 0;
  autoFixCount = 0;
  turnTouchedFiles = new Set();
  cancelAutoContinue();
  annullaSonda('nuova segnalazione');
  recuperiContesto = 0;

  sondaPreliminare = true;
  const nuovo = newMessage('user', [{ kind: 'text', text: testo }]);
  // Le immagini allegate si vedono subito nel messaggio, prima ancora della misura.
  if (immaginiUtente && immaginiUtente.length) nuovo.immagini = immaginiUtente.map(function (p) { return path.basename(p); });
  const messaggio = pushChatMessage(nuovo);
  setChatBusy(true, 'Provo ' + pagina + ' in un browser prima di passarla ad Adam...');
  console.log('[Sonda] Segnalazione di bug: misuro ' + pagina + ' prima di passarla ad Adam.');

  const revisore = revisoreDisponibile();
  const dirMisura = config.cwd;   // la cartella di QUESTA misura, anche se nel frattempo cambia
  const av = nuovoAvanzamento('Prima di passare la segnalazione ad Adam: ' + pagina, [
    ['sonda', 'Provo la pagina in un browser, come una persona'],
    ['revisore', 'Il revisore scrive i collaudi (in parallelo)'],
    ['esploratrice', 'Provo i flussi della pagina e li confronto con cio\' che promette la descrizione'],
    ['collaudi', 'Eseguo i collaudi in un browser isolato'],
    ['correzione', 'Il revisore corregge i collaudi che non si potevano eseguire'],
    ['giudizio', 'Il revisore giudica i collaudi falliti: difetto vero o collaudo sbagliato?'],
    ['adam', 'Scelgo il focus e passo il lavoro ad Adam']
  ]);

  // Sonda (browser, CPU) e revisore (modello, GPU) lavorano insieme: non si contendono
  // niente, e Adam in questo momento non sta generando.
  fase(av, 'sonda', 'corso');
  const lavoroSonda = sondaPagina({
    pagina: pagina, dir: config.cwd, base: baseAnteprima(),
    progresso: function (t) { fase(av, 'sonda', null, t); }
  }).catch(function (e) { return { errore: e.message }; }).then(function (esito) {
    fase(av, 'sonda', esito.errore ? 'err' : (misure.fattiDellaSonda(esito).length ? 'warn' : 'ok'), riassuntoMisura(esito));
    return esito;
  });

  let lavoroRevisore = Promise.resolve(null);
  if (revisore.ok) {
    fase(av, 'revisore', 'corso', 'Preparo descrizione e codice');
    const segnale = {};
    revisoreInCorso = segnale;
    lavoroRevisore = collaudatore.scriviCollaudi({
      dir: config.cwd, pagina: pagina, richiesta: testo,
      baseUrl: baseUrlForProvider('ollama'),
      modello: config.revisoreModel || config.model,
      mappa: mappaPerIlRevisore(config.cwd),
      memoria: buildMemoryPrompt(config.cwd),
      segnale: segnale,
      progresso: function (t) { fase(av, 'revisore', null, t); }
    }).catch(function (e) {
      return { collaudi: [], scartati: [], errore: e.message };
    }).then(function (s) {
      if (revisoreInCorso === segnale) revisoreInCorso = null;
      fase(av, 'revisore', s.errore ? 'err' : 'ok', s.errore
        ? 'non riuscito: ' + s.errore
        : s.collaudi.length + ' collaudi scritti in ' + Math.round((s.durataMs || 0) / 1000) + ' s' +
          (s.scartati.length ? ' (' + s.scartati.length + ' scartati perche\' malformati)' : ''));
      return s;
    });
  } else {
    fase(av, 'revisore', 'saltata', revisore.motivo);
  }

  const risultati = await Promise.all([lavoroSonda, lavoroRevisore]);
  const r = risultati[0];
  const scritti = risultati[1];

  // Se nel frattempo l'utente ha cambiato cartella, questa misura non vale piu': i collaudi
  // finirebbero nel progetto sbagliato (visto dal vivo cambiando cartella durante la misura).
  if (path.resolve(config.cwd).toLowerCase() !== path.resolve(dirMisura).toLowerCase()) {
    sondaPreliminare = false;
    chiudiAvanzamento(av, 'err', 'Cartella di lavoro cambiata durante la prova: misura annullata.');
    return;
  }

  // Sonda dei flussi: per le pagine con campi (moduli, liste) lo Studio prova la pagina in modo
  // sistematico e misura cosa cambia; il modello, alla cieca, dice cosa promette la descrizione
  // (a maggioranza di voti), lo Studio confronta, e le violazioni confermate diventano
  // collaudi. Viene dopo il revisore perche' l'oracolo usa la stessa GPU.
  let esplorati = [];
  let flussiAttendibili = false;   // la sonda dei flussi ha dato verdetti veri su questa pagina
  const perEsplorare = esploratriceAdatta(dirMisura, pagina, r, revisore);
  if (perEsplorare.ok) {
    fase(av, 'esploratrice', 'corso');
    const segnale = {};
    revisoreInCorso = segnale;
    const ex = await esploratrice.esplora({
      dir: dirMisura, pagina: pagina, descrizione: esploratrice.descrizioneDelProgetto(dirMisura), richiesta: testo,
      baseUrl: baseUrlForProvider('ollama'),
      modello: config.revisoreModel || config.model, segnale: segnale,
      progresso: function (t) { fase(av, 'esploratrice', null, t); }
    }).catch(function (e) { return { errore: e.message, collaudi: [], percorso: [], difetti: [] }; });
    if (revisoreInCorso === segnale) revisoreInCorso = null;
    esplorati = nomiDistinti(ex.collaudi || [], scritti && scritti.collaudi);
    flussiAttendibili = (ex.verdetti || []).some(function (v) { return v.verdetto === 'viola' || v.verdetto === 'rispetta'; });
    (ex.difetti || []).forEach(function (d) { console.log('[Esploratrice] Difetto notato: ' + d.descrizione); });
    fase(av, 'esploratrice', ex.errore && !esplorati.length ? 'warn' : 'ok',
      (ex.percorso || []).length + ' prove misurate, ' + (ex.difetti || []).length + ' contro la descrizione, ' +
      esplorati.length + ' collaudi' + (ex.errore ? ' (' + ex.errore + ')' : ''));
  } else {
    fase(av, 'esploratrice', 'saltata', perEsplorare.motivo);
  }

  // I collaudi nuovi del revisore e dell'esploratrice, piu' le guardie delle volte precedenti.
  let statoCollaudi = collaudatore.caricaCollaudi(dirMisura, pagina);
  const nuoviCollaudi = ((scritti && scritti.collaudi) || []).concat(esplorati);
  if (nuoviCollaudi.length) {
    statoCollaudi = collaudatore.unisciCollaudi(statoCollaudi, nuoviCollaudi);
  }
  let prova = await provaCollaudi(av, 'collaudi', dirMisura, pagina,
    collaudatore.attivi(statoCollaudi), Object.assign({}, statoCollaudi.esiti));

  // Un collaudo che non si puo' eseguire torna al revisore con il motivo MISURATO (un
  // selettore che non esiste, una variabile inventata, una verifica vera anche a vuoto).
  // Una sola correzione: quello che resta inutilizzabile si scarta davvero.
  const perNome = {};
  collaudatore.attivi(statoCollaudi).forEach(function (c) { perNome[c.nome] = c; });
  const daCorreggere = prova && revisore.ok && ((scritti && !scritti.errore) || esplorati.length)
    ? prova.fatti.scartati.filter(function (x) { return perNome[x.nome]; })
      .map(function (x) { return { collaudo: perNome[x.nome], motivo: x.motivo }; })
    : [];
  if (daCorreggere.length) {
    fase(av, 'correzione', 'corso', daCorreggere.length + (daCorreggere.length === 1 ? ' collaudo da correggere' : ' collaudi da correggere'));
    const segnale = {};
    revisoreInCorso = segnale;
    const corretti = await collaudatore.correggiCollaudi({
      dir: dirMisura, pagina: pagina, daCorreggere: daCorreggere,
      baseUrl: baseUrlForProvider('ollama'),
      modello: config.revisoreModel || config.model,
      mappa: mappaPerIlRevisore(dirMisura), memoria: buildMemoryPrompt(dirMisura),
      segnale: segnale,
      progresso: function (t) { fase(av, 'correzione', null, t); }
    }).catch(function (e) { return { collaudi: [], scartati: [], errore: e.message }; });
    if (revisoreInCorso === segnale) revisoreInCorso = null;
    if (corretti.errore || !corretti.collaudi.length) {
      fase(av, 'correzione', 'warn', corretti.errore ? 'non riuscita: ' + corretti.errore : 'nessun collaudo recuperabile');
    } else {
      const seconda = await provaCollaudi(av, 'correzione', dirMisura, pagina, corretti.collaudi, {});
      if (seconda) {
        // Via i vecchi scartati, dentro i corretti; i fatti e gli esiti si sommano.
        const via = new Set(daCorreggere.map(function (d) { return d.collaudo.nome; }));
        statoCollaudi.collaudi = statoCollaudi.collaudi.filter(function (c) { return !via.has(c.nome); })
          .concat(corretti.collaudi.filter(function (c) { return !statoCollaudi.collaudi.some(function (x) { return x.nome === c.nome && !via.has(x.nome); }); }));
        prova = {
          esiti: prova.esiti.filter(function (e) { return !via.has(e.nome); }).concat(seconda.esiti),
          fatti: {
            falliti: prova.fatti.falliti.concat(seconda.fatti.falliti),
            regressioni: prova.fatti.regressioni.concat(seconda.fatti.regressioni),
            superati: prova.fatti.superati.concat(seconda.fatti.superati),
            nonProvati: prova.fatti.nonProvati.concat(seconda.fatti.nonProvati),
            scartati: seconda.fatti.scartati
          }
        };
      }
    }
  } else {
    fase(av, 'correzione', 'saltata', 'nessun collaudo da correggere');
  }

  // Giudizio: un collaudo fallito e' un difetto vero o un collaudo sbagliato? Quelli giudicati
  // sbagliati si ritirano e NON arrivano ad Adam: visto dal vivo, per accontentare un collaudo
  // sbagliato Adam ha rovinato una funzione giusta e lasciato i difetti veri. Le regressioni
  // (collaudi che passavano) non si giudicano: sono gia' la prova piu' forte.
  // I collaudi della sonda dei flussi non si giudicano: lo Studio li ha gia' verificati (voti
  // concordi dell'oracolo, fallimento misurato sulla pagina), e il giudice e' lo stesso modello
  // piccolo. Visto dal vivo: ha ritirato i 4 collaudi giusti dei flussi e tenuto due collaudi
  // sbagliati del revisore (un contatore che doveva contenere "mela").
  const daiFlussi = new Set(statoCollaudi.collaudi.filter(function (c) { return c.origine === 'esploratrice'; }).map(function (c) { return c.nome; }));
  let giudicatiSbagliati = [];
  const daGiudicare = prova && revisore.ok && ((scritti && !scritti.errore) || esplorati.length)
    ? prova.esiti.filter(function (e) { return e.esito === 'fallito' && statoCollaudi.esiti[e.nome] !== 'superato' && !daiFlussi.has(e.nome); })
    : [];
  if (daGiudicare.length) {
    fase(av, 'giudizio', 'corso', daGiudicare.length + (daGiudicare.length === 1 ? ' collaudo da giudicare' : ' collaudi da giudicare'));
    const definizioni = {};
    statoCollaudi.collaudi.forEach(function (c) { definizioni[c.nome] = c; });
    const segnale = {};
    revisoreInCorso = segnale;
    const g = await collaudatore.giudicaCollaudi({
      dir: dirMisura, pagina: pagina, richiesta: testo,
      falliti: daGiudicare.map(function (e) { return { collaudo: definizioni[e.nome] || { nome: e.nome }, esito: e }; }),
      baseUrl: baseUrlForProvider('ollama'),
      modello: config.revisoreModel || config.model,
      mappa: mappaPerIlRevisore(dirMisura), memoria: buildMemoryPrompt(dirMisura),
      segnale: segnale,
      progresso: function (t) { fase(av, 'giudizio', null, t); }
    }).catch(function (e) { return { giudizi: {}, errore: e.message }; });
    if (revisoreInCorso === segnale) revisoreInCorso = null;
    if (g.errore) {
      fase(av, 'giudizio', 'warn', 'non riuscito (' + g.errore + '): passo i collaudi falliti cosi\' come sono');
    } else {
      giudicatiSbagliati = daGiudicare
        .filter(function (e) { return g.giudizi[e.nome] && g.giudizi[e.nome].verdetto === 'collaudo sbagliato'; })
        .map(function (e) { return { nome: e.nome, motivo: g.giudizi[e.nome].motivo }; });
      const via = new Set(giudicatiSbagliati.map(function (x) { return x.nome; }));
      prova.fatti.falliti = prova.fatti.falliti
        .filter(function (f) { return !via.has(nomeDelFatto(f)); })
        .map(function (f) {
          const gz = g.giudizi[nomeDelFatto(f)];
          return gz && gz.verdetto === 'difetto' && gz.motivo ? f + ' Giudizio del revisore: ' + gz.motivo : f;
        });
      giudicatiSbagliati.forEach(function (x) {
        collaudatore.ritira(statoCollaudi, x.nome);
        console.log('[Collaudi] Giudicato sbagliato e ritirato «' + x.nome + '»: ' + x.motivo);
      });
      fase(av, 'giudizio', giudicatiSbagliati.length ? 'warn' : 'ok',
        (daGiudicare.length - giudicatiSbagliati.length) + ' difetti veri, ' + giudicatiSbagliati.length +
        (giudicatiSbagliati.length === 1 ? ' collaudo sbagliato (ritirato)' : ' collaudi sbagliati (ritirati)'));
    }
  } else {
    fase(av, 'giudizio', 'saltata', 'nessun collaudo fallito da giudicare');
  }
  if (prova) {
    collaudatore.registraEsiti(statoCollaudi, prova.esiti);
    try { collaudatore.salvaCollaudi(statoCollaudi); } catch (e) { console.error('[Collaudi] Salvataggio fallito:', e.message); }
  }
  sondaPreliminare = false;

  try {
    // Nel frattempo la chat puo' essere stata azzerata o fermata.
    if (chatMessages.indexOf(messaggio) === -1) {
      chiudiAvanzamento(av, 'err', 'Conversazione azzerata durante la prova.');
      return;
    }
    if (!chatProc) {
      chiudiAvanzamento(av, 'err', 'Sessione fermata durante la prova.');
      chatSystemMessage('Sessione fermata durante la prova della pagina: il messaggio non e\' arrivato ad Adam.', 'warn');
      return;
    }

    fase(av, 'adam', 'corso');
    if (r.errore) {
      chatSystemMessage('Non sono riuscito a provare ' + pagina + ' nel browser (' + r.errore + ')' +
        (prova ? ': passo ad Adam solo i collaudi.' : ': passo la domanda ad Adam senza misure.'), 'warn');
    }
    const fattiSonda = r.errore ? [] : misure.fattiDellaSonda(r);
    // Ordine di affidabilita': se la sonda dei flussi ha funzionato, i collaudi del revisore che
    // falliscono senza conferma dei flussi arrivano ad Adam come NON VERIFICATI, fuori dal focus
    // e dal ciclo di correzione (visto dal vivo: il focus era un collaudo sbagliato del revisore).
    const nonVerificati = flussiAttendibili && prova
      ? prova.fatti.falliti.filter(function (f) { return !daiFlussi.has(nomeDelFatto(f)); })
      : [];
    const fallitiVerificati = prova ? prova.fatti.falliti.filter(function (f) { return nonVerificati.indexOf(f) === -1; }) : [];
    const fattiMisurati = fattiSonda.concat(prova ? prova.fatti.regressioni.concat(fallitiVerificati) : []);
    // Tutti i fatti restano registrati per l'utente; solo quelli collegati alla richiesta
    // possono guidare il lavoro di Adam o attivare il ciclo automatico di correzione.
    const fatti = misure.fattiPertinenti(fattiMisurati, testo);
    const fattiNonPertinenti = fattiMisurati.filter(function (f) { return fatti.indexOf(f) === -1; });
    const nonVerificatiPertinenti = misure.fattiPertinenti(nonVerificati, testo);
    const testoNonVerificati = nonVerificatiPertinenti.length
      ? '\nNon verificati (collaudi del revisore che la sonda dei flussi non conferma, fuori dal focus): ' +
        nonVerificatiPertinenti.map(nomeDelFatto).join('; ') + '.'
      : '';
    const file = path.join(config.cwd, pagina);
    fattiMisurati.forEach(function (f) { registraFatto(file, f); });
    const focus = misure.scegliFocus(fatti, null, testo);
    av.focus = focus ? accorciaTesto(focus, 180) : '';
    if (fatti.length) {
      sondaDaRipetere = {
        pagina: pagina, dir: config.cwd, fatti: fatti, tentativi: 0, giri: 0,
        attesaRisposta: true, sollecitato: false, inCorso: false,
        richiesta: testo,
        focus: misure.chiaveFatto(focus), focusTesto: focus,
        // Esiti di riferimento dei collaudi: chi passa qui deve continuare a passare.
        riferimentoCollaudi: Object.assign({}, statoCollaudi.esiti),
        // Collaudi del revisore non confermati dai flussi: si rieseguono, ma non tengono vivo il ciclo.
        nonVerificati: nonVerificatiPertinenti.map(nomeDelFatto)
      };
    }

    let testoPerAdam = testo;
    // Una schermata sola: resta nel contesto di tutti i turni successivi.
    // Prima le immagini allegate dall'utente, poi la schermata della sonda.
    // Se il clic automatico ha trovato solo un rilievo estraneo, usa la schermata iniziale
    // della pagina e non quella successiva all'interazione fuori tema.
    const schermataIniziale = !r.errore && r.schermate
      ? r.schermate.find(function (x) { return /caricamento/i.test(x.momento); })
      : null;
    const schermateSonda = !r.errore
      ? (fatti.length ? misure.scegliSchermate(r).slice(0, 1) :
        (schermataIniziale ? [schermataIniziale.leggera || schermataIniziale.file] : []))
      : [];
    const immagini = (immaginiUtente || []).concat(schermateSonda);
    if (!r.errore || prova) {
      testoPerAdam = testo + '\n\n' + [
        '---',
        (immaginiUtente || []).length ? 'L\'utente ha allegato ' + immaginiUtente.length +
          (immaginiUtente.length === 1 ? ' immagine: e\' la prima' : ' immagini: sono le prime') +
          ' allegate a questo messaggio. Guardale.' : '',
        r.errore ? '' : 'MISURE DELLO STUDIO, prese prima di passarti la domanda: ho aperto ' + pagina +
          ' in un browser e ho misurato lo stato della pagina. ' + (schermateSonda.length
            ? 'Ti allego ' + (schermateSonda.length === 1 ? 'la schermata' : 'le schermate') + '.'
            : ''),
        testoConsoleUtente(false) ? '\n' + testoConsoleUtente(false) : '',
        testoPerditeRecenti() ? '\n' + testoPerditeRecenti() : '',
        sezioneCollaudi(prova, nonVerificati, testo) ? '\n' + sezioneCollaudi(prova, nonVerificati, testo) : '',
        focus ? '\n' + sezioneFocus(focus, fatti) : (fattiMisurati.length
          ? '\nVERIFICA AUTOMATICA: ha rilevato ' + fattiMisurati.length +
            (fattiMisurati.length === 1 ? ' rilievo' : ' rilievi') +
            ', ma nessuno e\' collegato chiaramente alla richiesta. Continua dal compito chiesto dall\'utente; ' +
            'non correggere i rilievi fuori tema, che restano nel pannello Verifica.'
          : ''),
        '',
        comeProcedere(pagina)
      ].filter(function (x) { return x !== ''; }).join('\n');
      chatSystemMessage(focus
        ? 'Ho provato ' + pagina + ' prima di passarla ad Adam: ' + fattiMisurati.length +
          (fattiMisurati.length === 1 ? ' rilievo misurato' : ' rilievi misurati') +
          (fattiNonPertinenti.length ? ', ' + fattiNonPertinenti.length + ' non collegati alla richiesta' : '') +
          (prova ? ' (compresi i collaudi del revisore)' : '') + '.\n' +
          elencoPuntato(fatti.map(function (f) { return accorciaTesto(f, 220); })) +
          '\nFocus sulla richiesta: ' + accorciaTesto(focus, 160) + testoNonVerificati +
          '\nAdam parte dal problema segnalato; dopo la modifica riprovo la pagina e i controlli pertinenti.'
        : fattiMisurati.length
          ? 'Ho provato ' + pagina + ': ho rilevato ' + fattiMisurati.length +
            (fattiMisurati.length === 1 ? ' elemento non collegato' : ' elementi non collegati') +
            ' alla richiesta. Restano nel pannello Verifica; Adam mantiene il focus sul problema che hai segnalato.'
          : 'Ho provato ' + pagina + ': le misure automatiche non mostrano difetti verificati.' +
            testoNonVerificati + ' Adam mantiene il focus sul problema che hai segnalato.', 'info');
    }

    fotografaPrimaDelTurno();
    const pronto = await contenutoConImmagini(testoPerIlModello(testoPerAdam), immagini, { continuaSenzaVisione: true });
    if (pronto.erroreVisione) {
      chatSystemMessage('Vision non era disponibile durante la verifica: passo comunque ad Adam misure e risultati testuali.', 'warn');
    }
    if (pronto.allegate.length) {
      messaggio.immagini = pronto.allegate;
      chatBroadcast('message-update', { message: messaggio });
    }
    setChatBusy(true, pronto.allegate.length ? 'Adam sta guardando la pagina...' : 'In attesa di Adam...');
    if (!scriviAlModello(pronto.contenuto)) {
      setChatBusy(false);
      chiudiAvanzamento(av, 'err', 'La sessione si e\' chiusa mentre inviavo il messaggio.');
      chatSystemMessage('La sessione si e\' chiusa mentre inviavo il messaggio. Riprova.', 'warn');
    } else {
      fase(av, 'adam', 'ok', focus ? 'focus sulla richiesta: ' + accorciaTesto(focus, 90) :
        (fattiMisurati.length ? 'rilievi fuori tema lasciati in Verifica' : 'nessun problema misurato'));
      chiudiAvanzamento(av, fatti.length ? 'warn' : 'ok', fatti.length
        ? fatti.length + (fatti.length === 1 ? ' riscontro pertinente' : ' riscontri pertinenti') + ': Adam parte dal problema richiesto'
        : (fattiMisurati.length
          ? fattiMisurati.length + (fattiMisurati.length === 1 ? ' rilievo fuori tema' : ' rilievi fuori tema') +
            '; Adam continua dalla richiesta originale'
          : 'Nessun difetto misurato'));
      // Un collaudo scritto da un modello puo' essere sbagliato (visto dal vivo: "health = 0"
      // messo a mano e punti attesi, su un gioco che li da' solo nella collisione). A decidere
      // e' l'utente, non Adam: Adam aveva gia' liquidato un difetto vero come "normale".
      if (prova && prova.fatti.falliti.length) {
        chatBroadcast('verify', {
          state: 'falliti', collaudi: true, pagina: pagina,
          nomi: prova.fatti.falliti.map(function (f) { return (f.match(/«([^»]*)»/) || [])[1]; }).filter(Boolean),
          failures: prova.fatti.falliti.map(function (f) { return { file: file, error: f }; })
        });
      }
      // Quelli ritirati dal giudizio si mostrano all'utente, con il motivo e la possibilita' di
      // rimetterli: anche il giudice e' un modello e puo' sbagliare.
      if (giudicatiSbagliati.length) {
        chatBroadcast('verify', { state: 'giudicati', collaudi: true, pagina: pagina, giudicati: giudicatiSbagliati });
      }
    }
  } catch (e) {
    setChatBusy(false);
    chatSystemMessage('Non sono riuscito a preparare le immagini della verifica: ' + e.message + '. Adam non le ha ricevute.', 'error');
  } finally {
    const coda = messaggiInCoda;
    messaggiInCoda = [];
    coda.forEach(function (m) { inviaMessaggioUtente(m.text, m.pagina, m.opzioni); });
  }
}

// Dopo un turno concluso. Se Adam ha toccato i file della pagina misurata, la si
// riprova e si confrontano le misure; se ha risposto alle misure senza toccare nulla,
// glielo si fa notare, una volta sola.
function sondaDopoIlTurno(fileToccati) {
  const s = sondaDaRipetere;
  if (!s) {
    guardiaDopoIlTurno(fileToccati);
    return;
  }
  if (s.inCorso) return;
  const pertinenti = (fileToccati || []).filter(function (f) { return misure.filePertinente(s.dir, f); });
  if (pertinenti.length) {
    ripetiSonda(s, fileToccati).catch(function (e) {
      s.inCorso = false;
      console.error('[Sonda] Nuova misura fallita:', e.message);
    });
    return;
  }
  if (!s.attesaRisposta) return;
  s.attesaRisposta = false;
  if (s.sollecitato) return;
  s.sollecitato = true;
  s.attesaRisposta = true;
  inviaQuandoLibero(s,
    'Hai risposto senza modificare alcun file, ma le misure su ' + s.pagina + ' mostrano ancora:\n' +
    elencoPuntato(s.fatti) + '\n\n' +
    'Se hai individuato la causa, correggila ora con Edit: lo Studio riprovera\' la pagina e confrontera\' ' +
    'le misure. Se pensi che una misura non indichi un problema reale, spiega quale e perche\'.',
    [], { auto: true, attempt: 1, max: 1, reason: 'misure non ancora affrontate' });
}

async function ripetiSonda(s, fileControllati) {
  s.inCorso = true;
  s.attesaRisposta = false;
  s.giri = (s.giri || 0) + 1;
  const attivita = 'Controllo le modifiche di Adam su ' + s.pagina + '...';
  const liberaSeMia = function () {
    if (chatBusy && chatActivity === attivita) setChatBusy(false);
  };
  setChatBusy(true, attivita);
  chatBroadcast('verify', { state: 'running', sonda: true, files: [s.pagina] });

  const statoCollaudi = collaudatore.caricaCollaudi(s.dir, s.pagina);
  const riferimento = s.riferimentoCollaudi || Object.assign({}, statoCollaudi.esiti);
  const av = nuovoAvanzamento('Controllo delle modifiche di Adam: ' + s.pagina + ' (giro ' + s.giri + ')', [
    ['sintassi', 'Sintassi dei file modificati'],
    ['sonda', 'Riprovo la pagina nel browser'],
    ['collaudi', 'Rieseguo i collaudi del revisore'],
    ['confronto', 'Confronto con prima e scelgo il focus']
  ]);
  av.focus = s.focusTesto ? accorciaTesto(s.focusTesto, 180) : '';
  const nFile = (fileControllati || []).length;
  fase(av, 'sintassi', 'ok', nFile ? nFile + ' file senza errori' : 'nessun file da controllare');
  fase(av, 'sonda', 'corso');

  // Sonda e collaudi in parallelo: due browser separati, nessun modello coinvolto.
  const risultati = await Promise.all([
    sondaPagina({
      pagina: s.pagina, dir: s.dir, base: baseAnteprima(),
      progresso: function (t) { fase(av, 'sonda', null, t); }
    }).catch(function (e) { return { errore: e.message }; }).then(function (esito) {
      fase(av, 'sonda', esito.errore ? 'err' : (misure.fattiDellaSonda(esito).length ? 'warn' : 'ok'), riassuntoMisura(esito));
      return esito;
    }),
    provaCollaudi(av, 'collaudi', s.dir, s.pagina, collaudatore.attivi(statoCollaudi), riferimento)
  ]);
  const r = risultati[0];
  const prova = risultati[1];
  s.inCorso = false;
  if (sondaDaRipetere !== s) {
    liberaSeMia();
    chiudiAvanzamento(av, 'err', 'Confronto annullato.');
    return;
  }
  if (r.errore) {
    liberaSeMia();
    chiudiAvanzamento(av, 'err', 'Non sono riuscito a riprovare la pagina.');
    chatSystemMessage('Non sono riuscito a riprovare ' + s.pagina + ': ' + r.errore, 'warn');
    return;
  }
  if (prova) {
    // Prima/dopo: chi ha rotto le guardie, e quali collaudi distinguono davvero rotto e corretto.
    prova.fatti = await attribuisciRegressioni(av, 'collaudi', s.pagina, collaudatore.attivi(statoCollaudi), prova.fatti);
    collaudatore.segnaValidati(statoCollaudi, riferimento, prova.esiti);
    collaudatore.registraEsiti(statoCollaudi, prova.esiti);
    try { collaudatore.salvaCollaudi(statoCollaudi); } catch (e) { console.error('[Collaudi] Salvataggio fallito:', e.message); }
    // Un collaudo che torna a passare diventa anch'esso una capacita' da proteggere.
    prova.fatti.superati.forEach(function (nome) { riferimento[nome] = 'superato'; });
    s.riferimentoCollaudi = riferimento;
  }

  fase(av, 'confronto', 'corso');
  const file = path.join(s.dir, s.pagina);
  const fc = prova ? prova.fatti : null;
  // I collaudi NON VERIFICATI della misura iniziale restano fuori dal ciclo (vedi misuraPrimaDiRispondere).
  const dubbi = new Set(s.nonVerificati || []);
  const fattiDopoMisurati = misure.fattiDellaSonda(r).concat(fc ? fc.regressioni.concat(fc.falliti.filter(function (f) { return !dubbi.has(nomeDelFatto(f)); })) : []);
  const dopo = misure.fattiPertinenti(fattiDopoMisurati, s.richiesta);
  const provati = Object.assign({}, r.provati, {
    collaudo: !!prova,
    regressione: !!prova,
    collaudiNonProvati: fc ? fc.nonProvati.concat(fc.scartati.map(function (x) { return x.nome; })) : []
  });
  const cmp = misure.confrontaFatti(s.fatti, dopo, provati, r.lineeEseguite);
  s.risoltiTutti = (s.risoltiTutti || []).concat(cmp.risolti);
  cmp.risolti.forEach(function (f) { risolviFatto(file, f); });
  cmp.restano.concat(cmp.nuovi).forEach(function (f) { registraFatto(file, f); });
  console.log('[Sonda] ' + s.pagina + ' dopo le modifiche (giro ' + s.giri + '): ' + cmp.risolti.length + ' risolti, ' +
    cmp.restano.length + ' ancora presenti, ' + cmp.nuovi.length + ' nuovi, ' +
    cmp.nonVerificati.length + ' non provati.');

  const rimasti = cmp.restano.concat(cmp.nuovi);
  const focusPrima = s.focusTesto || null;
  const focusRisolto = !!s.focus && cmp.risolti.some(function (f) { return misure.chiaveFatto(f) === s.focus; });
  const esitoConfronto = cmp.risolti.length + ' risolti, ' + rimasti.length + ' da risolvere' +
    (cmp.nonVerificati.length ? ', ' + cmp.nonVerificati.length + ' non provati' : '') +
    (focusRisolto ? ' - focus risolto' : '');

  if (!rimasti.length) {
    sondaDaRipetere = null;
    liberaSeMia();
    av.focus = '';
    fase(av, 'confronto', cmp.nonVerificati.length ? 'warn' : 'ok', esitoConfronto);
    chiudiAvanzamento(av, cmp.nonVerificati.length ? 'warn' : 'ok', cmp.nonVerificati.length
      ? 'Nessun problema ancora presente, ma ' + cmp.nonVerificati.length + ' non si sono potuti riprovare'
      : 'Tutti i problemi misurati sono risolti');
    ricordaEsitoDelCiclo(s, cmp.nonVerificati);
    chatBroadcast('verify', {
      state: 'ok', sonda: true, pagina: s.pagina, checked: cmp.risolti.length,
      risolti: cmp.risolti.map(function (f) { return { file: file, error: f }; }),
      nonVerificati: cmp.nonVerificati.map(function (f) { return { file: file, error: f }; }),
      issues: knownIssues
    });
    // Onesta' prima di tutto: cio' che questa misura non ha potuto provare non e' risolto.
    if (cmp.nonVerificati.length) {
      chatSystemMessage('Su ' + s.pagina + ' questa misura non ha potuto riprovare:\n' +
        elencoPuntato(cmp.nonVerificati) + '\nNon li considero risolti: provali a mano o rilancia "Prova dal vivo".', 'warn');
    }
    return;
  }

  const max = massimoTentativiVerifica();
  // A vuoto conta solo un giro che non risolve niente: finche' Adam avanza, un problema alla
  // volta, il ciclo continua, con un tetto complessivo di giri.
  s.tentativi = cmp.risolti.length ? 0 : (s.tentativi || 0) + 1;
  const focus = misure.scegliFocus(rimasti, s.focus, s.richiesta);
  s.focus = misure.chiaveFatto(focus);
  s.focusTesto = focus;
  av.focus = accorciaTesto(focus, 180);
  if (s.tentativi > max || s.giri > max * 3) {
    sondaDaRipetere = null;
    liberaSeMia();
    fase(av, 'confronto', 'err', esitoConfronto);
    chiudiAvanzamento(av, 'err', 'Mi fermo: serve un intervento manuale');
    ricordaEsitoDelCiclo(s, rimasti);
    chatSystemMessage((s.tentativi > max ? 'Dopo ' + max + ' giri senza progressi' : 'Dopo ' + s.giri + ' giri') +
      ' le misure su ' + s.pagina + ' mostrano ancora:\n' +
      elencoPuntato(rimasti.map(function (f) { return accorciaTesto(f, 220); })) +
      '\nLi trovi nel pannello Verifica. Serve un intervento manuale.', 'error');
    return;
  }

  fase(av, 'confronto', 'warn', esitoConfronto);
  chatBroadcast('verify', {
    state: 'failed', sonda: true, pagina: s.pagina,
    failures: rimasti.map(function (f) { return { file: file, error: f }; }),
    attempt: s.giri, max: max * 3, issues: knownIssues
  });
  s.fatti = rimasti.concat(cmp.nonVerificati);
  s.attesaRisposta = true;
  liberaSeMia();
  chiudiAvanzamento(av, 'warn', (focusRisolto ? 'Focus risolto. ' : '') + 'Nuovo giro per Adam: ' + rimasti.length +
    (rimasti.length === 1 ? ' problema.' : ' problemi, uno alla volta.'));

  const altri = rimasti.filter(function (f) { return f !== focus; });
  const stessoFocus = !!focusPrima && misure.chiaveFatto(focusPrima) === s.focus;
  const testo = [
    s.richiesta ? 'RICHIESTA ORIGINALE DA COMPLETARE PER PRIMA:\n' + s.richiesta : '',
    'Ho riprovato ' + s.pagina + ' nel browser' + (prova ? ' e rieseguito i collaudi' : '') + ' dopo le tue modifiche, e ho confrontato le misure con quelle di prima.',
    cmp.risolti.length ? 'RISOLTI, non compaiono piu\':\n' + elencoPuntato(cmp.risolti.map(function (f) { return accorciaTesto(f, 160); })) : '',
    focusRisolto ? 'Il riscontro di prima e\' risolto.' : '',
    stessoFocus ? 'Nota: il riscontro su ' + s.pagina + ' non e\' cambiato con le ultime modifiche. Se il tuo intervento riguarda un altro file o risponde a una diversa richiesta dell\'utente, specifica cosa hai fatto o chiedi chiarimenti.' : '',
    cmp.nuovi.length ? 'NUOVI comparsi sulla pagina:\n' + elencoPuntato(cmp.nuovi.map(function (f) { return accorciaTesto(f, 200); })) : '',
    cmp.nonVerificati.length ? 'NON PROVATI in questa misura:\n' +
      elencoPuntato(cmp.nonVerificati.map(function (f) { return accorciaTesto(f, 160); })) : '',
    'ELEMENTO PRINCIPALE DA VERIFICARE:\n' + focus,
    altri.length ? 'Altri riscontri:\n' + elencoPuntato(altri.map(function (f) { return accorciaTesto(f, 150); })) : '',
    'Verifica nel codice la causa del problema ed effettua modifiche mirate solo se pertinenti.'
  ].filter(Boolean).join('\n\n');
  // Nei giri successivi non alleghiamo continuamente screenshot per non saturare il contesto di modelli locali
  inviaQuandoLibero(s, testo, [], {
    auto: true, attempt: s.giri, max: max * 2, istantanea: true,
    reason: focusRisolto ? 'focus risolto, passo al prossimo problema' : 'le misure mostrano problemi ancora presenti'
  });
}

// Dopo un turno normale (non un giro di correzione guidato dalle misure) che ha toccato file
// web: si rieseguono le guardie, cioe' i collaudi che passavano. Se una non passa piu' lo si
// dice all'UTENTE, non ad Adam: forse la modifica era proprio quella richiesta ("togli lo
// sparo automatico"), e decidere se e' un danno o una scelta spetta a chi l'ha chiesta.
function guardiaDopoIlTurno(fileToccati) {
  if (!config.autoVerify || guardiaInCorso) return;
  const dir = config.cwd;
  if (!(fileToccati || []).some(function (f) { return misure.filePertinente(dir, f); })) return;
  if (!analisiRuntime.disponibile()) return;
  const pagine = misure.pagineDelProgetto(dir).filter(function (p) {
    return collaudatore.guardie(collaudatore.caricaCollaudi(dir, p)).length > 0;
  });
  if (!pagine.length) return;
  guardiaInCorso = true;
  (async function () {
    for (const pagina of pagine) {
      const stato = collaudatore.caricaCollaudi(dir, pagina);
      const guardie = collaudatore.guardie(stato);
      const av = nuovoAvanzamento('Controllo che non si sia rotto niente: ' + pagina, [
        ['guardie', 'Rieseguo i ' + guardie.length + ' collaudi che passavano']
      ]);
      const prova = await provaCollaudi(av, 'guardie', dir, pagina, guardie, Object.assign({}, stato.esiti));
      if (!prova) {
        chiudiAvanzamento(av, 'err', 'Collaudi non eseguiti.');
        continue;
      }
      prova.fatti = await attribuisciRegressioni(av, 'guardie', pagina, guardie, prova.fatti);
      collaudatore.registraEsiti(stato, prova.esiti);
      try { collaudatore.salvaCollaudi(stato); } catch (e) { console.error('[Collaudi] Salvataggio fallito:', e.message); }
      const file = path.join(dir, pagina);
      prova.fatti.superati.forEach(function (nome) { risolviFatto(file, 'Regressione «' + nome + '»'); });
      const regressioni = prova.fatti.regressioni;
      if (!regressioni.length) {
        chiudiAvanzamento(av, 'ok', 'Le capacita\' protette funzionano ancora.');
        continue;
      }
      regressioni.forEach(function (f) { registraFatto(file, f); });
      const nomi = regressioni.map(function (f) { return (f.match(/«([^»]*)»/) || [])[1]; }).filter(Boolean);
      chiudiAvanzamento(av, 'warn', regressioni.length === 1
        ? 'Una cosa che funzionava ora non funziona piu\'.'
        : regressioni.length + ' cose che funzionavano ora non funzionano piu\'.');
      chatBroadcast('verify', {
        state: 'regressioni', collaudi: true, pagina: pagina, nomi: nomi,
        failures: regressioni.map(function (f) { return { file: file, error: f }; }),
        issues: knownIssues
      });
      console.log('[Collaudi] ' + pagina + ': ' + regressioni.length + ' regressioni dopo il turno.');
    }
  })().catch(function (e) {
    console.error('[Collaudi] Controllo dopo il turno fallito:', e.message);
  }).finally(function () {
    guardiaInCorso = false;
  });
}

// Come per le correzioni della verifica: si aspetta che la chat sia libera senza perdere
// la richiesta, e se nel frattempo il confronto viene annullato non si invia nulla.
function inviaQuandoLibero(s, testo, immagini, opzioni) {
  let attese = 0;
  const prova = function () {
    sondaInvioTimer = null;
    if (sondaDaRipetere !== s || !config.autoVerify) return;
    if (chatBusy) {
      attese += 1;
      if (attese > 60) {
        chatSystemMessage('Le misure su ' + s.pagina + ' mostrano ancora dei problemi, ma la conversazione ' +
          'era occupata: li trovi nel pannello Verifica.', 'warn');
        return;
      }
      sondaInvioTimer = setTimeout(prova, 2000);
      return;
    }
    sendChatPromptConImmagini(testo, immagini, opzioni);
  };
  if (sondaInvioTimer) clearTimeout(sondaInvioTimer);
  sondaInvioTimer = setTimeout(prova, 800);
}

// ============================================================
// CONTESTO PIENO
// Con un modello locale la memoria di lavoro e' piccola, e buona parte e' gia' occupata
// da istruzioni e strumenti. Quando si riempie, la sessione non puo' piu' rispondere a
// nulla: visto dal vivo a meta' di un debug. Si apre una sessione nuova e le si passa un
// riassunto meccanico di dove eravamo, senza chiederlo al modello: quella richiesta non
// entrerebbe nel contesto nemmeno lei.
// ============================================================

const MAX_RECUPERI_CONTESTO = 2;

// File modificati con successo dall'ultimo messaggio scritto dall'utente.
function modificheDelTurno() {
  let inizio = 0;
  for (let i = chatMessages.length - 1; i >= 0; i--) {
    if (chatMessages[i].role === 'user' && !chatMessages[i].auto) { inizio = i; break; }
  }
  const conteggio = {};
  chatMessages.slice(inizio).forEach(function (m) {
    (m.blocks || []).forEach(function (b) {
      if (b.kind !== 'tool' || !FILE_TOOLS[b.name] || b.isError) return;
      const file = (b.input || {})[FILE_TOOLS[b.name]];
      if (file) conteggio[file] = (conteggio[file] || 0) + 1;
    });
  });
  return Object.keys(conteggio).map(function (f) { return { file: f, volte: conteggio[f] }; });
}

function ultimoTestoDiAdam() {
  for (let i = chatMessages.length - 1; i >= 0; i--) {
    const m = chatMessages[i];
    if (m.role !== 'assistant') continue;
    const testo = (m.blocks || []).filter(function (b) { return b.kind === 'text' && b.text; })
      .map(function (b) { return b.text; }).join('\n').trim();
    if (testo && !/^API Error/.test(testo)) return testo.length > 1200 ? testo.slice(0, 1200) + ' [...]' : testo;
  }
  return '';
}

// Il riassunto viaggia una volta sola, in testa al primo messaggio della sessione nuova.
// Tutto quello che arriva ad Adam passa di qui: il riassunto di passaggio sessione, quando c'e', e
// il capo progetto, che sta in testa SEMPRE. E' l'unico pezzo di contesto che sopravvive a una
// compattazione, perche' non vive nella conversazione: viene riscritto a ogni messaggio.
function aggiungiMappaPrimaDelTask(testo) {
  // Come premere "Mappa codice" in automatico prima di ogni task: la scansione
  // aggiorna anche il diagramma e il prompt riceve subito simboli e file correnti.
  // Un errore della mappa non deve impedire l'invio della richiesta.
  if (!config.cwd) return testo;
  try {
    const mappa = mappaCodice(config.cwd);
    const riepilogo = riassumiMappa(mappa);
    if (!riepilogo) return testo;
    if (aggiornaMappaInMemoria(mappa)) {
      chatBroadcast('memory-updated', { projectDir: config.cwd });
    }
    return 'MAPPA DEL CODICE (riletta dal disco subito prima di questo task):\n' + riepilogo +
      '\n\nUsa i percorsi e i collegamenti per trovare i file interessati; controlla il file indicato prima di modificarlo e conserva le dipendenze esistenti.\n\n---\n\n' +
      testo;
  } catch (e) {
    console.error('[Mappa] Scansione prima del task non riuscita:', e.message);
    return testo;
  }
}

function testoPerIlModello(testo) {
  let completo = String(testo);
  if (riassuntoDaInviare) {
    completo = riassuntoDaInviare + '\n\n---\n\n' + completo;
    riassuntoDaInviare = '';
  }
  if (config.capoProgetto !== false && config.cwd) {
    try {
      const capo = capoProgetto.testoPerAdam(config.cwd);
      if (capo && completo.indexOf('CAPO PROGETTO') === -1) completo = capo + '\n\n---\n\n' + completo;
    } catch (e) { /* senza capo progetto si lavora lo stesso */ }
  }

  completo = aggiungiMappaPrimaDelTask(completo);
  if (vincoloGitPushCorrente) {
    completo += '\n\n---\n\n' + gitPushVerificato.istruzioniPerIlModello();
  }
  return completo;
}

// ============================================================
// REPORT PASSAGGIO SESSIONE E RINNOVO AUTOMATICO
// Quando la memoria di lavoro del modello raggiunge la soglia (SOGLIA_RINNOVO)
// o si esaurisce (100% / errore contesto), prima di aprire la nuova sessione
// viene generato un report strutturato (REPORT-PASSAGGIO-SESSIONE.md):
// 1. Scopo dell'applicazione (richiesta iniziale e direttive utente)
// 2. Diario di bordo (cosa e' successo turno per turno)
// 3. Cosa e' stato fatto / modificato / aggiunto (file e comandi)
// 4. Errori e log riscontrati
// 5. Tesi architetturale e regole di continuita'
// 6. Prossimo passo immediato per la nuova sessione
// Il report viene salvato su disco, impostato come riassunto da inviare,
// e la nuova sessione riprende automaticamente il compito.
// ============================================================

function salvaReportPassaggioFile(reportMd) {
  const dir = config.cwd || process.cwd();
  const fileReport = path.join(dir, 'REPORT-PASSAGGIO-SESSIONE.md');
  try {
    fs.writeFileSync(fileReport, reportMd, 'utf8');
    console.log('[Report] Salvato report passaggio sessione in:', fileReport);
    chatBroadcast('files-changed', { file: 'REPORT-PASSAGGIO-SESSIONE.md' });
  } catch (e) {
    console.error('[Report] Impossibile salvare report passaggio sessione:', e.message);
  }
  return fileReport;
}

function generaReportPassaggioSessione(motivo, fileArchivioChat) {
  const dir = config.cwd || process.cwd();
  const st = statoContesto();
  const archivioRel = fileArchivioChat ? path.relative(dir, fileArchivioChat).split(path.sep).join('/') : null;

  // 1. Scopo dell'Applicazione (richieste utente)
  const messaggiUtente = chatMessages.filter(function (m) {
    return m.role === 'user' && !m.auto;
  });

  const testiUtente = messaggiUtente.map(function (m) {
    return (m.blocks || []).map(function (b) { return b.text || ''; }).join(' ').trim();
  }).filter(Boolean);

  const scopoIniziale = testiUtente.length > 0 ? testiUtente[0] : (lastUserRequestText() || 'Sviluppo dell\'applicazione secondo le specifiche richieste.');
  const ultimaRichiesta = testiUtente.length > 0 ? testiUtente[testiUtente.length - 1] : scopoIniziale;

  // 2. Diario di bordo: cosa e' successo
  const diario = [];
  let turnoIndex = 0;
  chatMessages.forEach(function (m) {
    if (m.role === 'user') {
      turnoIndex++;
      const txt = (m.blocks || []).map(function (b) { return b.text || ''; }).join(' ').trim();
      const label = m.auto ? ('Turno ' + turnoIndex + ' [Sistema / Auto-ripresa]') : ('Turno ' + turnoIndex + ' [Utente]');
      diario.push('**' + label + '**:\n> ' + accorciaTesto(txt || '(nessun testo)', 300));
    } else if (m.role === 'assistant') {
      const passi = [];
      (m.blocks || []).forEach(function (b) {
        if (b.kind === 'tool') {
          const param = (b.input && (b.input.file_path || b.input.command || b.input.pattern || b.input.path)) || '';
          const esito = b.isError ? '❌ Fallito' : '✅ Eseguito';
          passi.push('- Strumento `' + b.name + '` (' + (param ? '`' + param + '`' : 'senza argomenti') + '): ' + esito);
        } else if (b.kind === 'text' && b.text) {
          const estratto = b.text.replace(/[\r\n]+/g, ' ').trim();
          if (estratto && !/^API Error/.test(estratto)) {
            passi.push('- Nota Adam: "' + accorciaTesto(estratto, 180) + '"');
          }
        }
      });
      if (m.isError) passi.push('- ⚠️ *Turno interrotto da errore API o esaurimento contesto*');
      if (passi.length) diario.push(passi.join('\n'));
    }
  });

  // 3. Cosa e' stato fatto / modificato / aggiunto
  const fileCreati = new Set();
  const fileModificati = {};
  const fileLetti = new Set();
  const comandiBash = [];

  chatMessages.forEach(function (m) {
    (m.blocks || []).forEach(function (b) {
      if (b.kind !== 'tool') return;
      const inp = b.input || {};
      if (b.name === 'Write' && inp.file_path) {
        if (!b.isError) fileCreati.add(inp.file_path);
      } else if (b.name === 'Edit' && inp.file_path) {
        if (!b.isError) fileModificati[inp.file_path] = (fileModificati[inp.file_path] || 0) + 1;
      } else if (b.name === 'Read' && inp.file_path) {
        fileLetti.add(inp.file_path);
      } else if (b.name === 'Bash' && inp.command) {
        comandiBash.push({
          cmd: inp.command,
          err: b.isError,
          res: accorciaTesto(String(b.result || ''), 150)
        });
      }
    });
  });

  // Stato reale dei file su disco
  const fileSuDisco = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    entries.forEach(function (e) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '.backup-originali') return;
      const full = path.join(dir, e.name);
      if (e.isFile()) {
        try {
          const stF = fs.statSync(full);
          const kb = (stF.size / 1024).toFixed(1);
          fileSuDisco.push({ nome: e.name, dim: kb + ' KB (' + stF.size + ' B)', size: stF.size, isDir: false });
        } catch (_) {}
      } else if (e.isDirectory()) {
        fileSuDisco.push({ nome: e.name + '/', dim: 'Cartella', isDir: true });
      }
    });
  } catch (err) {
    console.error('[Report] Impossibile leggere directory progetto:', err.message);
  }

  // 4. Errori e log riscontrati
  const erroriLog = [];
  chatMessages.forEach(function (m) {
    (m.blocks || []).forEach(function (b) {
      if (b.kind === 'tool' && b.isError) {
        const param = (b.input && (b.input.file_path || b.input.command)) || '';
        erroriLog.push('Strumento `' + b.name + '` su `' + param + '`: ' + accorciaTesto(String(b.result || 'Errore'), 200));
      }
    });
    if (m.isError) {
      erroriLog.push('Interruzione turno assistente / Errore API.');
    }
  });

  const s = sondaDaRipetere;
  if (s && s.fatti && s.fatti.length) {
    s.fatti.forEach(function (f) {
      erroriLog.push('Sonda runtime (' + (s.pagina || 'pagina') + '): ' + accorciaTesto(f, 200));
    });
  }

  // 5. Tesi architetturale e prossimo passo
  const nomiPresenti = new Set(fileSuDisco.map(function (f) { return f.nome; }));
  let prossimoPasso = 'Proseguire l\'implementazione eseguendo il prossimo blocco di codice.';

  if (nomiPresenti.has('adb-remote.html') && !nomiPresenti.has('adb-remote.css')) {
    prossimoPasso = 'Creare `adb-remote.css`: iniziare con uno scheletro leggero di 10-15 righe con Write, poi arricchire gli stili a blocchi con Edit (non riscrivere tutto in un colpo).';
  } else if (nomiPresenti.has('adb-remote.html') && !nomiPresenti.has('adb-remote.js')) {
    prossimoPasso = 'Creare `adb-remote.js`: definire i gestori di invio comandi ADB per i pulsanti dell\'interfaccia.';
  } else if (erroriLog.length > 0) {
    prossimoPasso = 'Risolvere l\'errore riscontrato: ' + erroriLog[erroriLog.length - 1];
  } else if (ultimaRichiesta) {
    prossimoPasso = 'Completare la richiesta utente in corso: "' + accorciaTesto(ultimaRichiesta, 160) + '"';
  }

  // Formattazione sezioni Markdown
  const sezioni = [
    '# 📋 REPORT DI PASSAGGIO SESSIONE (NOTEXIST INTELLIGENCE STUDIO)',
    '> **Questo report e\' generato automaticamente prima di aprire una nuova sessione per esaurimento o rinnovo del contesto.**',
    '',
    '- **Data e Ora:** ' + new Date().toLocaleString('it-IT'),
    '- **Motivo del passaggio:** ' + motivo,
    '- **Utilizzo Contesto:** ' + (st.usati !== null ? st.usati : 'N/D') + ' / ' + (st.limite || 'N/D') + ' token (' + (st.percento !== null ? st.percento + '%' : '100%') + ')',
    '- **Modello attivo:** `' + (config.model || 'Non specificato') + '`',
    '- **Cartella di lavoro:** `' + dir + '`',
    archivioRel ? ('- **Archivio chat precedente:** `' + archivioRel + '` (consultabile con Grep o Read)') : '',
    '',
    '---',
    '',
    '## 🎯 1. SCOPO DELL\'APPLICAZIONE',
    '### Richiesta Iniziale Utente',
    '> ' + scopoIniziale,
    testiUtente.length > 1 ? ('\n### Istruzioni e Raffinamenti Utente Successivi\n' + testiUtente.slice(1).map(function (t, i) { return (i + 1) + '. ' + t; }).join('\n')) : '',
    '',
    '---',
    '',
    '## 📜 2. COSA E\' SUCCESSO (DIARIO DI BORDO)',
    diario.length ? diario.slice(-12).join('\n\n') : 'Nessuna attivita\' registrata.',
    '',
    '---',
    '',
    '## 🛠️ 3. COSA E\' STATO FATTO, MODIFICATO E AGGIUNTO',
    '### File Creati con Write:',
    fileCreati.size ? Array.from(fileCreati).map(function (f) { return '- `' + path.basename(f) + '`'; }).join('\n') : '- Nessun file creato in questa sessione.',
    '',
    '### File Modificati con Edit:',
    Object.keys(fileModificati).length ? Object.keys(fileModificati).map(function (f) { return '- `' + path.basename(f) + '` (' + fileModificati[f] + ' modifiche)'; }).join('\n') : '- Nessun file modificato in questa sessione.',
    '',
    '### File Letti / Esplorati:',
    fileLetti.size ? Array.from(fileLetti).map(function (f) { return '- `' + path.basename(f) + '`'; }).join('\n') : '- Nessun file letto singolarmente.',
    '',
    '### Comandi Bash Eseguiti:',
    comandiBash.length ? comandiBash.map(function (c) { return '- `' + c.cmd + '` -> ' + (c.err ? '❌ ' : '✅ ') + c.res; }).join('\n') : '- Nessun comando eseguito.',
    '',
    '### 📂 Stato Reale dei File su Disco (' + dir + '):',
    fileSuDisco.length ? fileSuDisco.map(function (f) { return '- `' + f.nome + '`: ' + f.dim; }).join('\n') : '- Cartella vuota o inaccessibile.',
    '',
    '---',
    '',
    '## ⚠️ 4. ERRORI E LOG RISCONTRATI',
    erroriLog.length ? erroriLog.map(function (e) { return '- ' + e; }).join('\n') : '- ✅ Nessun errore bloccante riscontrato durante la sessione.',
    '',
    '---',
    '',
    '## 🏗️ 5. TESI ARCHITETTURALE E REGOLE DI CONTINUITA\'',
    '### Architettura dell\'Applicazione',
    '1. **Frontend**: Interfaccia HTML semantica, layout CSS moderno e reattivo, JS client per gestione eventi e interazioni.',
    '2. **Backend & Integrazione**: Moduli server / script di comunicazione (ADB shell, WebSocket o chiamate HTTP).',
    '3. **Modularita\'**: Separazione rigorosa di HTML, CSS e JavaScript in file distinti.',
    '',
    '### Regole di Scrittura Obbligatorie per Adam (Continuous Execution Rules)',
    '1. **MAI riscrivere un intero file enorme in un colpo solo con Write**: se un file non esiste, crea prima uno scheletro leggero di 10-15 righe con `Write`, e poi usa `Edit` per implementare i blocchi progressivamente.',
    '2. **Controlla sempre lo stato reale del disco**: consulta la lista dei file su disco qui sopra prima di fare supposizioni su cio\' che esiste o manca.',
    '3. **Evita riletture complete inutili**: non leggere interi file da centinaia di righe consumando contesto; usa `Grep` per trovare i punti chiave o `Read` con offset e limit.',
    '',
    '---',
    '',
    '## 🚀 6. PROSSIMO PASSO IMMEDIATO PER LA NUOVA SESSIONE',
    '👉 **' + prossimoPasso + '**'
  ];

  return sezioni.filter(function (s) { return s !== null && s !== undefined; }).join('\n');
}

async function eseguiPassaggioSessione(motivo, opts) {
  const opzioni = opts || {};
  const st = statoContesto();
  console.log('[Contesto] Avvio passaggio sessione: ' + motivo);

  // 1. Archivia la chat corrente per conservare la memoria completa
  const fileArchivio = archiviaChatOra();

  // 2. Genera il report dettagliato
  const reportMd = generaReportPassaggioSessione(motivo, fileArchivio);

  // 3. Salva il report sul disco del progetto
  const fileReport = salvaReportPassaggioFile(reportMd);

  // 4. Imposta il riassunto da inviare al primo turno della nuova sessione
  riassuntoDaInviare = reportMd;

  // 5. Avvia la nuova sessione pulita (mantenendo la storia visibile in UI)
  startChatProcess({ keepHistory: true });

  // 6. Notifica l'utente in chat
  const nomeReport = path.basename(fileReport);
  chatSystemMessage(
    'Contesto del modello (' + (st.percento !== null ? st.percento + '%' : '100%') + '): ' +
    'generato report dettagliato in `' + nomeReport + '` e avviata una nuova sessione pulita. ' +
    'Adam sta riprendendo il compito in automatico...',
    'info'
  );

  // 7. Ripresa automatica del compito senza attesa manuale
  if (config.autoContinue) {
    await verifyAndMaybeFix();
    if (pendingFixTimer || sondaInvioTimer || (sondaDaRipetere && sondaDaRipetere.inCorso)) return true;
    // Sessione nuova: il report dice cosa e' successo, il quadro dice dove siamo ADESSO (la
    // richiesta punto per punto, i file veri, cosa e' gia' stato provato invano).
    let quadroDelPassaggio = '';
    try {
      quadroDelPassaggio = '\n\n' + quadroSituazione.costruisci(config.cwd, {
        motivo: 'sessione-nuova', perche: quadroSituazione.MOTIVI['sessione-nuova'],
        segnali: diarioDiBordo.segnali(config.cwd)
      }).testo;
      diarioDiBordo.registraQuadro(config.cwd, 'sessione-nuova');
    } catch (e) {
      quadroDelPassaggio = '';
    }
    sendChatPrompt(
      'Ho avviato la nuova sessione e letto il report di passaggio in `' + nomeReport + '`. ' +
      'Riprendo immediatamente il lavoro senza interruzioni eseguendo il prossimo passo indicato nel report.' +
      quadroDelPassaggio,
      {
        auto: true,
        attempt: opzioni.attempt || 1,
        max: opzioni.max || 1,
        reason: 'ripresa automatica dopo passaggio sessione'
      }
    );
  }

  return true;
}

async function rinnovaSePieno() {
  const st = statoContesto();
  if (st.percento === null || st.percento < sogliaRinnovo()) return false;
  recuperiContesto += 1;
  return await eseguiPassaggioSessione('Saturazione preventiva contesto (' + st.percento + '% >= ' + sogliaRinnovo() + '%)');
}

// Una sessione nuova che occupa gia' quasi la soglia non libera spazio: prompt di sistema,
// strumenti e report di passaggio riempiono da soli una finestra piccola. Con la compattazione
// nativa conta il blocco di Claude Code (vedi limitiClaudeCode): riassumere non accorcia prompt di
// sistema e strumenti, quindi se gia' a sessione appena aperta non resta spazio per lavorare,
// rinnovare e' solo un giro a vuoto. Prima qui si rispondeva sempre "no" con la compattazione
// attiva, e con 16384 token lo Studio apriva sessioni nuove che si fermavano dopo una risposta.
function contestoTroppoPiccolo() {
  const l = contestoChat.limite;
  if (!l || contestoChat.base === null) return false;
  if (compattazioneAttiva()) return sessioneSenzaSpazio(contestoChat.base, l);
  return contestoChat.base * 100 / l >= SOGLIA_RINNOVO - MARGINE_RINNOVO;
}

function avvisaContestoTroppoPiccolo() {
  if (contestoChat.avvisoPiccolo) return;
  contestoChat.avvisoPiccolo = true;
  const l = contestoChat.limite;
  const lim = compattazioneAttiva() ? limitiClaudeCode(l) : null;
  chatSystemMessage(
    'Il modello "' + (config.model || '') + '" ha una finestra di contesto troppo piccola: una sessione appena ' +
    'aperta occupa gia\' ' + contestoChat.base.toLocaleString('it-IT') + ' token su ' + l.toLocaleString('it-IT') +
    ' (' + Math.round(contestoChat.base * 100 / l) + '%)' +
    (lim ? ', e Claude Code si ferma da solo a ' + lim.blocco.toLocaleString('it-IT') + ' token perche\' tiene ' +
      'da parte lo spazio per la risposta' : '') +
    '. Aprirne un\'altra non libererebbe spazio e Adam ' +
    'ricomincerebbe da capo senza finire, quindi non la apro. Serve piu\' contesto: una variante del modello ' +
    'con "PARAMETER num_ctx 32768" (ollama create).', 'error');
}

// Decide a fine turno se aprire una sessione nuova. Senza questi controlli, con una finestra da
// 16k lo Studio rinnovava a ogni turno e riprendeva da solo il compito: un giro senza fine.
function rinnovoUtile() {
  if (contestoTroppoPiccolo()) {
    avvisaContestoTroppoPiccolo();
    return false;
  }
  if (recuperiContesto >= MAX_RECUPERI_CONTESTO) {
    if (recuperiContesto === MAX_RECUPERI_CONTESTO) {
      recuperiContesto += 1; // cosi' l'avviso compare una volta sola per richiesta
      chatSystemMessage('Per questa richiesta ho gia\' aperto ' + MAX_RECUPERI_CONTESTO + ' sessioni nuove e il ' +
        'contesto e\' di nuovo quasi pieno: mi fermo per non girare a vuoto. Scrivi "continua" per proseguire, ' +
        'oppure dividi il compito in passi piu\' piccoli.', 'warn');
    }
    return false;
  }
  return true;
}

async function recuperaContestoPieno() {
  if (contestoTroppoPiccolo()) {
    avvisaContestoTroppoPiccolo();
    return;
  }
  recuperiContesto += 1;
  if (recuperiContesto > MAX_RECUPERI_CONTESTO) {
    chatSystemMessage('Il contesto del modello si riempie anche ripartendo da una sessione nuova. ' +
      'Dividi la richiesta in passi piu\' piccoli, o usa un modello con piu\' contesto.', 'error');
    return;
  }
  return await eseguiPassaggioSessione('Esaurimento completo contesto (100% / errore contesto)', {
    attempt: recuperiContesto,
    max: MAX_RECUPERI_CONTESTO
  });
}

function chatSnapshot() {
  return {
    messages: chatMessages,
    busy: chatBusy,
    activity: chatActivity,
    token: chatBusy ? tokenDelTurno() : 0,
    running: chatProc !== null,
    info: chatSessionInfo,
    issues: knownIssues,
    contesto: statoContesto(),
    cwd: config.cwd,
    interactions: interazioniGuidate
  };
}

// WebSocket connection handling
wss.on('connection', (ws) => {
  clients.add(ws);

  // Send initial state & replay buffer
  ws.send(JSON.stringify({
    type: 'init',
    buffer: ptyBuffer,
    running: ptyProcess !== null,
    cwd: config.cwd,
    chat: chatSnapshot(),
    whatsapp: getAppWhatsAppBridge().getStato(),
    config: {
      dangerouslySkipPermissions: config.dangerouslySkipPermissions,
      fontSize: config.fontSize,
      theme: config.theme,
      provider: config.provider || 'anthropic',
      model: config.model || '',
      baseUrl: config.baseUrl || '',
      autoAcceptFolder: !!config.autoAcceptFolder,
      flatUiMode: !!config.flatUiMode,
      hasApiKey: !!(config.apiKey && config.apiKey.trim())
    }
  }));

  async function gestisciMessaggioWebSocket(message) {
    let parsed;
    try {
      parsed = JSON.parse(message);
    } catch (e) {
      // Compatibilità terminale: i messaggi non JSON restano input PTY.
      if (ptyProcess) {
        ptyProcess.write(message.toString());
      }
      return;
    }
    if (parsed.type === 'input' && ptyProcess) {
      ptyProcess.write(parsed.data);
    } else if (parsed.type === 'resize' && ptyProcess) {
      const cols = Math.max(20, Math.min(parsed.cols || 80, 300));
      const rows = Math.max(10, Math.min(parsed.rows || 24, 150));
      try {
        ptyProcess.resize(cols, rows);
      } catch (err) {
        // ignore resize errors
      }
    } else if (parsed.type === 'restart') {
      startClaudeProcess();
    } else if (parsed.type === 'chat-send') {
      // `immagini` resta supportato per i client precedenti; i client nuovi inviano allegati tipizzati.
      const ricevuti = Array.isArray(parsed.allegati) ? parsed.allegati : parsed.immagini;
      const caricate = await preparaAllegatiChat(ricevuti);
      if (caricate.errore && !caricate.percorsi.length) {
        ws.send(JSON.stringify({ type: 'chat', event: 'error', text: 'Allegato non inviato: ' + caricate.errore }));
        return;
      }
      const testo = allegatiChat.aggiungiDocumentiAlTesto(parsed.text, caricate.documenti);
      const result = inviaMessaggioUtente(testo, parsed.pagina, { immagini: caricate.percorsi });
      if (!result.ok) {
        ws.send(JSON.stringify({ type: 'chat', event: 'error', text: result.error }));
      }
    } else if (parsed.type === 'chat-choice') {
      const interactionId = String(parsed.interactionId || '');
      const interaction = interazioniGuidate.find(function (item) { return item.id === interactionId; });
      const resolved = dialogoGuidato.risolvi(interaction, {
        optionId: parsed.optionId,
        custom: parsed.custom
      });
      if (!resolved.ok) {
        const recoverable = !!(interaction && interaction.status === 'pending' && interaction.expiresAt > Date.now());
        ws.send(JSON.stringify({ type: 'chat', event: 'choice-error', interactionId: interactionId, text: resolved.error, recoverable: recoverable }));
        return;
      }
      dialogoGuidato.salva(config.cwd, conversazioneId, interazioniGuidate);
      const owner = chatMessages.find(function (item) {
        return item.interaction && item.interaction.id === interactionId;
      });
      if (owner) chatBroadcast('message-update', { message: owner });
      const risposta = resolved.value.label || resolved.value.custom;
      const seguito = 'Risposta al chiarimento "' + interaction.question + '": ' + risposta +
        '. Valuta se serve il prossimo chiarimento; altrimenti crea il piano strutturato e procedi.';
      const result = sendChatPrompt(seguito, { choice: true, hidden: true });
      if (!result.ok) {
        ws.send(JSON.stringify({ type: 'chat', event: 'choice-error', interactionId: interactionId, text: result.error }));
      }
    } else if (parsed.type === 'chat-stop') {
      // Fermare il processo non perde il contesto: al prossimo invio si fa --resume.
      stopChatProcess();
    } else if (parsed.type === 'chat-new') {
      startChatProcess({});
    }
  }

  ws.on('message', (message) => {
    gestisciMessaggioWebSocket(message).catch(function () {
      try {
        ws.send(JSON.stringify({ type: 'chat', event: 'error', text: 'Errore durante la preparazione del messaggio.' }));
      } catch (_) {}
    });
  });

  ws.on('close', () => {
    clients.delete(ws);
  });
});

// REST API Endpoints

// 1. App status
app.get('/api/status', (req, res) => {
  const claudeExe = getClaudeExecutable();
  const installed = fs.existsSync(claudeExe) || fs.existsSync(path.join(process.env.APPDATA || '', 'npm', 'fcc-claude.cmd')) || fs.existsSync(path.join(process.env.APPDATA || '', 'npm', 'claude.cmd'));

  res.json({
    installed,
    claudePath: claudeExe,
    running: ptyProcess !== null,
    cwd: config.cwd,
    hasApiKey: !!(config.apiKey && config.apiKey.trim()),
    hasAuthToken: !!(config.authToken && config.authToken.trim()),
    configuredProviders: segreti.configuredProviders(config),
    customBaseUrl: config.customBaseUrl || '',
    customEndpoints: segreti.publicCustomEndpoints(config),
    dangerouslySkipPermissions: false,
    provider: config.provider || 'anthropic',
    chatRunning: chatProc !== null,
    autoContinue: config.autoContinue !== false,
    autoContinueMax: config.autoContinueMax || 8,
    effort: config.effort || 'high',
    autoVerify: config.autoVerify !== false,
    autoFixMax: massimoTentativiVerifica(),
    revisore: config.revisore !== false,
    revisoreModel: config.revisoreModel || '',
    coderModel: modelloCoderConfigurato(),
    coderProvider: config.coderProvider || '',
    coderGroup: config.coderGroup || '',
    projectTestCommand: config.projectTestCommand || '',
    openIssues: knownIssues.filter(i => !i.resolved).length,
    model: config.model,
    visionModel: modelloVisioneConfigurato(),
    baseUrl: config.baseUrl,
    autoAcceptFolder: config.autoAcceptFolder,
    flatUiMode: config.flatUiMode,
    permissionMode: config.permissionMode || 'acceptEdits',
    engine: config.engine || 'claude',
    opencodeInstalled: fs.existsSync(getOpencodeExecutable()),
    platform: process.platform,
    hostname: os.hostname(),
    username: os.userInfo().username
  });
});

// 2. Shortcut system directories
app.get('/api/shortcuts', (req, res) => {
  const home = os.homedir();
  const desktop = path.join(home, 'OneDrive', 'Desktop');
  const desktopAlt = path.join(home, 'Desktop');
  const documents = path.join(home, 'Documents');

  const shortcuts = [
    { name: 'Cartella Corrente', path: config.cwd },
    { name: 'Desktop', path: fs.existsSync(desktop) ? desktop : desktopAlt },
    { name: 'Documenti', path: documents },
    { name: 'Home Utente', path: home },
    { name: 'Intelligience Project', path: __dirname }
  ];

  res.json(shortcuts.filter(s => fs.existsSync(s.path)));
});

// Suggerimenti e pulsanti per i prossimi passi ottimizzati
app.get('/api/suggerimenti-azioni', (req, res) => {
  try {
    const actions = generaSuggerimentiCorrenti();
    res.json({ success: true, actions });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, actions: [] });
  }
});

// 3. File Explorer in directory
app.get('/api/files', (req, res) => {
  const targetDir = req.query.dir ? path.resolve(req.query.dir) : config.cwd;

  if (!fs.existsSync(targetDir) || !percorsoDentro(config.cwd, targetDir)) {
    return res.status(404).json({ error: 'Directory non trovata' });
  }

  try {
    const entries = fs.readdirSync(targetDir, { withFileTypes: true });
    const items = [];

    for (const entry of entries) {
      // Filter out huge noise folders from deep inspection but show directory
      const isHidden = entry.name.startsWith('.') && entry.name !== '.env';
      const itemPath = path.join(targetDir, entry.name);
      let size = 0;
      let isDirectory = entry.isDirectory();

      if (!isDirectory) {
        try {
          size = fs.statSync(itemPath).size;
        } catch (e) {}
      }

      items.push({
        name: entry.name,
        path: itemPath,
        isDirectory,
        size,
        isHidden,
        ext: path.extname(entry.name).toLowerCase()
      });
    }

    // Sort: directories first, then alphabetical
    items.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    res.json({
      currentDir: targetDir,
      parentDir: percorsoDentro(config.cwd, path.dirname(targetDir)) ? path.dirname(targetDir) : targetDir,
      items
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. File Content preview
app.get('/api/file-content', (req, res) => {
  const filePath = req.query.path ? path.resolve(req.query.path) : '';
  if (!filePath || !fs.existsSync(filePath) || !percorsoDentro(config.cwd, filePath)) {
    return res.status(404).json({ error: 'File non trovato' });
  }

  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      return res.status(400).json({ error: 'Il percorso specificato è una cartella' });
    }

    if (stat.size > 1024 * 1024 * 2) {
      return res.status(400).json({ error: 'File troppo grande per l\'anteprima (limite 2MB)' });
    }

    const content = fs.readFileSync(filePath, 'utf8');
    res.json({
      name: path.basename(filePath),
      path: filePath,
      size: stat.size,
      content
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4b. File Sezioni (guida a sezioni per file grossi gestiti da capo-file.js)
app.get('/api/file-sezioni', (req, res) => {
  const filePath = req.query.path || (req.query.file ? path.resolve(config.cwd || process.cwd(), req.query.file) : null);
  if (!filePath || !fs.existsSync(filePath) || !percorsoDentro(config.cwd, filePath)) {
    return res.status(404).json({ error: 'File non trovato' });
  }

  try {
    const info = capoFile.analizzaFile(filePath);
    if (!info) {
      return res.status(400).json({ error: 'Impossibile analizzare il file' });
    }
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4c. Arsenale Diagnostica Completa
app.get('/api/arsenale-diagnosi', async (req, res) => {
  try {
    const dirTarget = req.query.dir ? path.resolve(config.cwd || process.cwd(), req.query.dir) : (config.cwd || process.cwd());
    if (!percorsoDentro(config.cwd, dirTarget)) {
      return res.status(403).json({ error: 'Il percorso deve restare nella cartella di lavoro attiva' });
    }
    const rep = await arsenaleTest.diagnosiCompleta(dirTarget);
    res.json(rep);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Change active directory and restart Claude
app.post('/api/change-dir', (req, res) => {
  const newDir = req.body.dir;
  if (!newDir || !fs.existsSync(newDir)) {
    return res.status(400).json({ error: 'Directory specificata non valida o inesistente' });
  }

  config.cwd = path.resolve(newDir);
  addToRecentDirs(config.cwd);
  saveConfig();

  // Inizializza o scansiona i neuroni per il progetto selezionato
  try {
    apprendimentoMemoria.scansionaEInizializzaNeuroniProgetto(config.cwd);
  } catch (e) {
    console.error('[Memoria] Errore scansione progetto al cambio cartella:', e.message);
  }

  startClaudeProcess();
  startChatProcess({});

  chatBroadcast('memory-updated', { projectDir: config.cwd });

  res.json({ success: true, cwd: config.cwd, recentDirs: config.recentDirs });
});

// 5b. Projects endpoints
app.get('/api/projects', (req, res) => {
  res.json({
    currentDir: config.cwd,
    projects: config.projects || [],
    recentDirs: config.recentDirs || []
  });
});

app.post('/api/projects', (req, res) => {
  const { name, path: projectPath } = req.body;
  if (!projectPath || !fs.existsSync(projectPath)) {
    return res.status(400).json({ error: 'Percorso cartella non valido o inesistente sul disco' });
  }

  const resolvedPath = path.resolve(projectPath);
  const projectName = (name && name.trim()) ? name.trim() : path.basename(resolvedPath) || resolvedPath;

  if (!Array.isArray(config.projects)) {
    config.projects = [];
  }

  const existingIndex = config.projects.findIndex(p => p.path && p.path.toLowerCase() === resolvedPath.toLowerCase());
  if (existingIndex >= 0) {
    config.projects[existingIndex].name = projectName;
  } else {
    config.projects.unshift({
      id: 'proj_' + Date.now(),
      name: projectName,
      path: resolvedPath,
      createdAt: new Date().toISOString()
    });
  }

  addToRecentDirs(resolvedPath);
  saveConfig();

  res.json({
    success: true,
    projects: config.projects,
    recentDirs: config.recentDirs
  });
});

app.delete('/api/projects/:id', (req, res) => {
  const { id } = req.params;
  if (!Array.isArray(config.projects)) {
    config.projects = [];
  }

  config.projects = config.projects.filter(p => p.id !== id && p.path !== id);
  saveConfig();

  res.json({
    success: true,
    projects: config.projects
  });
});

// 5c. Native Windows Folder Picker
app.post('/api/browse-folder', (req, res) => {
  if (process.platform !== 'win32') {
    return res.json({ success: true, path: config.cwd });
  }

  const psScript = `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Seleziona cartella di lavoro per Claude Code'; $f.ShowNewFolderButton = $true; if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($f.SelectedPath) }`;

  execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript], { timeout: 60000 }, (error, stdout) => {
    if (error) {
      return res.json({ success: false, path: null });
    }
    const selected = stdout ? stdout.trim() : '';
    if (selected && fs.existsSync(selected)) {
      res.json({ success: true, path: selected });
    } else {
      res.json({ success: false, path: null });
    }
  });
});

// 5d. Chat session endpoints
app.get('/api/chat', (req, res) => {
  res.json(chatSnapshot());
});

app.post('/api/chat/send', (req, res) => {
  const corpo = req.body || {};
  const result = inviaMessaggioUtente(corpo.text, corpo.pagina, { sonda: corpo.sonda });
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ success: true });
});

app.post('/api/chat/new', (req, res) => {
  startChatProcess({});
  res.json({ success: true });
});

app.post('/api/chat/stop', (req, res) => {
  stopChatProcess();
  res.json({ success: true });
});

// ============================================================
// DIAGNOSTICA
// Quando una sessione non risponde la causa e' quasi sempre di configurazione
// (endpoint sbagliato, modello assente, nessun login). Questo endpoint la nomina
// esplicitamente invece di lasciare la UI muta.
// ============================================================

function checkUrl(url, timeoutMs) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      return resolve({ ok: false, error: 'URL non valido' });
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname || '/',
      method: 'GET',
      timeout: timeoutMs || 3000
    }, (res) => {
      res.resume();
      resolve({ ok: true, status: res.statusCode });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.on('error', (err) => resolve({ ok: false, error: err.code || err.message }));
    req.end();
  });
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

// Sonda: chiede al modello di usare uno strumento fittizio e guarda se la risposta
// contiene una chiamata STRUTTURATA. E' lenta (e' una vera inferenza), quindi il
// risultato viene messo in cache per modello.
const toolProbeCache = new Map();

function probeToolSupport(base, model) {
  const key = base + '|' + model;
  if (toolProbeCache.has(key)) return Promise.resolve(toolProbeCache.get(key));

  const body = JSON.stringify({
    model: model,
    max_tokens: 200,
    tools: [{
      name: 'get_time',
      description: 'Restituisce l ora corrente di una citta',
      input_schema: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city']
      }
    }],
    messages: [{ role: 'user', content: 'Che ore sono a Roma? Usa lo strumento.' }]
  });

  return fetchUrl(base + '/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    body: body,
    timeout: 120000
  }).then(function (response) {
    const parsed = JSON.parse(response.body || response);
    const content = parsed.content || [];
    const structured = content.some(function (c) { return c.type === 'tool_use'; });
    const textual = content.some(function (c) {
      return c.type === 'text' && looksLikeUnexecutedToolCall(c.text);
    });
    const result = { ok: structured, wroteAsText: textual && !structured };
    toolProbeCache.set(key, result);
    return result;
  }).catch(function (err) {
    return { ok: null, error: err.message };
  });
}

app.get('/api/diagnostics', async (req, res) => {
  const checks = [];
  const provider = config.provider || 'anthropic';

  // 1. Eseguibile di Claude Code
  const exe = getClaudeExecutable();
  const exeFound = fs.existsSync(exe);
  checks.push({
    id: 'cli',
    label: 'Claude Code CLI',
    ok: exeFound,
    detail: exeFound ? exe : 'Non trovato',
    fix: exeFound ? null : 'Installa la CLI con: npm install -g @anthropic-ai/claude-code'
  });

  // 2. Cartella di lavoro
  const cwdOk = !!config.cwd && fs.existsSync(config.cwd);
  checks.push({
    id: 'cwd',
    label: 'Cartella di lavoro',
    ok: cwdOk,
    detail: config.cwd || '(non impostata)',
    fix: cwdOk ? null : 'Scegli una cartella esistente dal pannello Progetti.'
  });

  // 3. Provider e raggiungibilita' del modello
  if (provider === 'ollama') {
    const base = baseUrlForProvider('ollama');
    const reach = await checkUrl(base + '/api/tags', 3000);
    checks.push({
      id: 'provider',
      label: 'Server Ollama',
      ok: reach.ok,
      detail: reach.ok ? base + ' raggiungibile' : base + ' non raggiungibile (' + (reach.error || '') + ')',
      fix: reach.ok ? null : 'Avvia Ollama (comando: ollama serve) oppure cambia provider nelle Impostazioni.'
    });

    if (reach.ok) {
      const wanted = (config.model || '').trim();
      let models = [];
      try {
        const body = await fetchUrl(base + '/api/tags', { timeout: 4000 });
        const parsed = JSON.parse(body.body || body);
        models = (parsed.models || []).map(m => m.name);
      } catch (e) {
        models = [];
      }
      const present = !wanted || models.indexOf(wanted) !== -1;
      checks.push({
        id: 'model',
        label: 'Modello locale',
        ok: present,
        detail: present
          ? (wanted || '(predefinito)') + (models.length ? ' — disponibili: ' + models.join(', ') : '')
          : '"' + wanted + '" non e\' installato in Ollama',
        fix: present ? null : 'Scarica il modello con: ollama pull ' + wanted + (models.length ? ' — oppure scegli uno fra: ' + models.join(', ') : '')
      });

      // Quanto del modello sta davvero in VRAM. Se una parte finisce sulla CPU la
      // generazione crolla a pochi token/secondo e le risposte lunghe si troncano:
      // e' la causa piu' difficile da indovinare guardando solo la UI.
      try {
        const psBody = await fetchUrl(base + '/api/ps', { timeout: 4000 });
        const ps = JSON.parse(psBody.body || psBody);
        const loaded = (ps.models || [])[0];
        if (loaded) {
          const total = loaded.size || 0;
          const onGpu = loaded.size_vram || 0;
          const pct = total ? Math.round((onGpu / total) * 100) : 0;
          const ctx = loaded.context_length || 0;
          const fits = pct >= 90;
          checks.push({
            id: 'vram',
            label: 'Modello in VRAM',
            ok: fits,
            severity: fits ? 'ok' : 'warn',
            detail: loaded.name + ': ' + pct + '% su GPU ('
              + (onGpu / 1e9).toFixed(1) + ' di ' + (total / 1e9).toFixed(1) + ' GB), contesto ' + ctx,
            fix: fits ? null
              : 'La parte fuori dalla GPU gira sulla CPU e rallenta di circa 10 volte. '
                + 'Riduci il contesto del modello: crea un Modelfile con "FROM ' + loaded.name.split(':')[0]
                + '" e "PARAMETER num_ctx 32768", poi "ollama create <nome>-cc -f Modelfile". '
                + 'In alternativa usa un modello piu' + String.fromCharCode(39) + ' piccolo (es. qwen2.5-coder:7b).'
          });
        }
      } catch (e) {
        // /api/ps assente o modello non caricato: nessun controllo da riportare.
      }

      // Esecuzione strumenti: solo se gia' in cache, oppure se richiesta esplicitamente
      // con ?probe=1, perche' comporta una vera inferenza (decine di secondi).
      if (wanted && (req.query.probe === '1' || toolProbeCache.has(base + '|' + wanted))) {
        const probe = await probeToolSupport(base, wanted);
        if (probe.ok !== null) {
          checks.push({
            id: 'tools',
            label: 'Esecuzione degli strumenti',
            ok: probe.ok,
            detail: probe.ok
              ? wanted + ' produce chiamate strutturate: puo\' leggere e modificare file.'
              : (probe.wroteAsText
                  ? wanted + ' SCRIVE le chiamate come testo invece di eseguirle: non potra\' toccare alcun file.'
                  : wanted + ' non ha prodotto alcuna chiamata a strumento.'),
            fix: probe.ok ? null
              : 'Questo modello non sa usare gli strumenti. Cambia modello nelle Impostazioni: '
                + 'qwen3.5-studio:9b funziona ed e\' anche piu\' veloce su questa macchina.'
          });
        }
      }
    }
  } else if (provider === 'anthropic') {
    const hasKey = !!(config.apiKey && config.apiKey.trim());
    let loggedIn = false;
    const claudeJson = readJsonSafe(path.join(os.homedir(), '.claude.json'));
    if (claudeJson && claudeJson.oauthAccount) loggedIn = true;
    const credentials = readJsonSafe(path.join(os.homedir(), '.claude', '.credentials.json'));
    const hasAccountToken = !!(credentials && (credentials.claudeAiOauth || credentials.accessToken));

    const authOk = hasKey || hasAccountToken;
    checks.push({
      id: 'provider',
      label: 'Autenticazione Anthropic',
      ok: authOk,
      detail: hasKey
        ? 'API key impostata nelle Impostazioni'
        : (hasAccountToken
            ? 'Sessione account presente'
            : (loggedIn
                ? 'Account noto ma senza token valido per la CLI'
                : 'Nessuna API key e nessun login della CLI')),
      fix: authOk ? null : 'Apri un terminale ed esegui "claude login", oppure inserisci una API key nelle Impostazioni, oppure passa al provider Ollama.'
    });
  } else if (provider === 'custom') {
    const base = baseUrlForProvider('custom');
    checks.push({
      id: 'provider',
      label: 'Proxy personalizzato',
      ok: !!base,
      detail: base || 'Base URL mancante o non valido',
      fix: base ? null : 'Inserisci un Base URL valido nelle Impostazioni.'
    });
  } else if (provider === 'openrouter') {
    const hasKey = !!getKeyForProvider('openrouter');
    checks.push({
      id: 'provider',
      label: 'OpenRouter',
      ok: hasKey,
      detail: hasKey ? 'Endpoint OpenRouter configurato' : 'Chiave OpenRouter mancante',
      fix: hasKey ? null : 'Inserisci la chiave OpenRouter (sk-or-...) nella scheda Impostazioni.'
    });
  } else {
    const hasKey = !!getKeyForProvider(provider);
    checks.push({
      id: 'provider',
      label: 'Chiave ' + provider,
      ok: hasKey,
      detail: hasKey ? 'Chiave configurata per ' + provider : 'Nessuna chiave configurata per ' + provider,
      fix: hasKey ? null : 'Inserisci la chiave API di ' + provider + ' nella scheda Impostazioni.'
    });
  }

  // 4. Conflitto con i settings globali dell'utente
  const userSettings = readJsonSafe(path.join(os.homedir(), '.claude', 'settings.json'));
  const globalEnv = (userSettings && userSettings.env) || {};
  const globalKeys = Object.keys(globalEnv).filter(k => k.indexOf('ANTHROPIC_') === 0);
  checks.push({
    id: 'global-env',
    label: 'Impostazioni globali di Claude Code',
    ok: globalKeys.length === 0,
    severity: globalKeys.length ? 'warn' : 'ok',
    detail: globalKeys.length
      ? '~/.claude/settings.json forza ' + globalKeys.join(', ') + ' per tutte le sessioni. Lo Studio le sovrascrive per le proprie, ma le altre sessioni di Claude Code ne risentono.'
      : 'Nessuna variabile ANTHROPIC_* forzata globalmente',
    fix: globalKeys.length
      ? 'Se non usi piu\' un provider locale ovunque, rimuovi il blocco "env" da ~/.claude/settings.json (e da settings.local.json).'
      : null
  });

  // 5. Base URL che punta alla UI: errore classico e fatale
  const rawBase = (config.baseUrl || '').trim();
  const selfTargeted = rawBase && !sanitizeBaseUrl(rawBase);
  checks.push({
    id: 'baseurl',
    label: 'Base URL configurato',
    ok: !selfTargeted,
    detail: selfTargeted
      ? '"' + rawBase + '" non e\' un endpoint valido (punta alla UI stessa o e\' malformato): viene ignorato.'
      : (rawBase || '(non impostato)'),
    fix: selfTargeted ? 'Correggi il campo Base URL nelle Impostazioni (per Ollama: http://localhost:11434).' : null
  });

  // Peso della memoria iniettata nel prompt
  const memoryText = buildMemoryPrompt(config.cwd);
  const memChars = memoryText.length;
  const memTokens = Math.round(memChars / 3.2); // rapporto misurato su questa macchina
  checks.push({
    id: 'memory',
    label: 'Memoria nel prompt',
    ok: memChars <= MEMORY_CHAR_BUDGET,
    severity: memChars <= MEMORY_CHAR_BUDGET ? 'ok' : 'warn',
    detail: memChars === 0
      ? 'Nessuna voce salvata: il prompt non viene appesantito.'
      : memChars + ' caratteri (~' + memTokens + ' token) aggiunti al prompt di ogni turno.',
    fix: memChars <= MEMORY_CHAR_BUDGET ? null
      : 'La memoria supera il budget di ' + MEMORY_CHAR_BUDGET + ' caratteri e viene troncata. Elimina le voci meno utili dalla scheda Memoria.'
  });

  // Problemi aperti trovati dalla verifica automatica
  const openIssues = knownIssues.filter(i => !i.resolved);
  checks.push({
    id: 'issues',
    label: 'Problemi rilevati dalla verifica',
    ok: openIssues.length === 0,
    detail: openIssues.length === 0
      ? (knownIssues.length
          ? 'Nessun problema aperto (' + knownIssues.length + ' gia\' risolti).'
          : 'Nessun problema rilevato finora.')
      : openIssues.length + ' aperti: ' + openIssues.slice(0, 3)
          .map(i => path.basename(i.file) + ' (' + i.error.split('\n')[0].slice(0, 60) + ')')
          .join('; '),
    fix: openIssues.length === 0 ? null
      : 'Adam ha gia\' provato a correggerli automaticamente senza riuscirci. Aprili nel pannello e chiedi una correzione mirata.'
  });

  // 6. Sessioni attive
  checks.push({
    id: 'sessions',
    label: 'Sessioni attive',
    ok: chatProc !== null,
    detail: 'chat: ' + (chatProc ? 'attiva' : 'ferma') + ' · terminale: ' + (ptyProcess ? 'attivo' : 'fermo'),
    fix: chatProc ? null : 'Usa "Nuova chat" per riavviare la sessione.'
  });

  res.json({
    provider: provider,
    model: config.model || '',
    cwd: config.cwd,
    healthy: checks.every(c => c.ok || c.severity === 'warn'),
    checks: checks
  });
});

// 5e. Modelli disponibili sul provider locale
app.get('/api/local-models', async (req, res) => {
  const base = baseUrlForProvider('ollama');
  try {
    const response = await fetchUrl(base + '/api/tags', { timeout: 4000 });
    const parsed = JSON.parse(response.body || response);
    const models = (parsed.models || []).map(m => ({
      name: m.name,
      sizeGb: m.size ? Number((m.size / 1e9).toFixed(1)) : null,
      contextLength: (m.details && m.details.context_length) || null,
      capabilities: m.capabilities || []
    }));
    res.json({ available: true, models });
  } catch (err) {
    res.json({ available: false, models: [], error: err.message });
  }
});

const CLOUD_MODELS = [
  { id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet', provider: 'Anthropic' },
  { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider: 'Anthropic' },
  { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', provider: 'Anthropic' },
  { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', provider: 'Anthropic' },
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'OpenAI' },
  { id: 'gpt-4o-mini', name: 'GPT-4o mini', provider: 'OpenAI' },
  { id: 'o3-mini', name: 'o3-mini', provider: 'OpenAI' },
  { id: 'deepseek-chat', name: 'DeepSeek V3', provider: 'DeepSeek' },
  { id: 'deepseek-coder', name: 'DeepSeek Coder', provider: 'DeepSeek' }
];

let openrouterModelsCache = [];
let cerebrasModelsCache = [];
let nvidiaModelsCache = [
  { id: 'meta/llama-3.2-11b-vision-instruct', name: 'Llama 3.2 11B Vision', isFree: true, costBadge: '[NVIDIA NIM]', provider: 'NVIDIA' },
  { id: 'deepseek-ai/deepseek-v4-flash-0731', name: 'DeepSeek V4 Flash', isFree: true, costBadge: '[NVIDIA NIM]', provider: 'NVIDIA' },
  { id: 'meta/llama-3.2-90b-vision-instruct', name: 'Llama 3.2 90B Vision', isFree: true, costBadge: '[NVIDIA NIM]', provider: 'NVIDIA' },
  { id: 'nvidia/llama-3.1-nemotron-70b-instruct', name: 'Nemotron 70B Instruct', isFree: true, costBadge: '[NVIDIA NIM]', provider: 'NVIDIA' },
  { id: 'mistralai/codestral-22b-instruct-v0.1', name: 'Codestral 22B', isFree: true, costBadge: '[NVIDIA NIM]', provider: 'NVIDIA' },
  { id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B Instruct', isFree: true, costBadge: '[NVIDIA NIM]', provider: 'NVIDIA' },
  { id: 'qwen/qwen2.5-coder-32b-instruct', name: 'Qwen 2.5 Coder 32B', isFree: true, costBadge: '[NVIDIA NIM]', provider: 'NVIDIA' }
];
let ashnaModelsCache = [
  { id: 'auto', name: 'Auto (Dynamic Routing)', isFree: true, costBadge: '[ASHNA AI]', provider: 'Ashna' },
  { id: 'ashna-x1', name: 'Ashna-X1 (Agentic Model)', isFree: true, costBadge: '[ASHNA AI]', provider: 'Ashna' },
  { id: 'claude-3-7-sonnet', name: 'Claude 3.7 Sonnet', isFree: true, costBadge: '[ASHNA AI]', provider: 'Ashna' },
  { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', isFree: true, costBadge: '[ASHNA AI]', provider: 'Ashna' },
  { id: 'claude-3-5-haiku', name: 'Claude 3.5 Haiku', isFree: true, costBadge: '[ASHNA AI]', provider: 'Ashna' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', isFree: true, costBadge: '[ASHNA AI]', provider: 'Ashna' },
  { id: 'gemini-3-Pro', name: 'Gemini 3 Pro', isFree: true, costBadge: '[ASHNA AI]', provider: 'Ashna' },
  { id: 'glm-5.3', name: 'GLM 5.3', isFree: true, costBadge: '[ASHNA AI]', provider: 'Ashna' },
  { id: 'kimi-k3', name: 'Kimi K3', isFree: true, costBadge: '[ASHNA AI]', provider: 'Ashna' },
  { id: 'ashnaai', name: 'Ashna AI Native', isFree: true, costBadge: '[ASHNA AI]', provider: 'Ashna' }
];
let openaiModelsCache = [];
let deepseekModelsCache = [];
let geminiModelsCache = [];
let groqModelsCache = [];
let mistralModelsCache = [];
let anthropicModelsCache = [];
let customModelsCache = [];

let providerStatusCache = {
  openrouter: { configured: false, reachable: null, isPaid: true, credits: null, creditsExhausted: false, error: null, lastChecked: 0 },
  nvidia: { configured: false, reachable: null, isPaid: false, credits: null, creditsExhausted: false, error: null, lastChecked: 0 },
  ashna: { configured: false, reachable: null, isPaid: false, credits: null, creditsExhausted: false, error: null, lastChecked: 0 },
  cerebras: { configured: false, reachable: null, isPaid: false, credits: null, creditsExhausted: false, error: null, lastChecked: 0 },
  openai: { configured: false, reachable: null, isPaid: true, credits: null, creditsExhausted: false, error: null, lastChecked: 0 },
  deepseek: { configured: false, reachable: null, isPaid: true, credits: null, creditsExhausted: false, error: null, lastChecked: 0 },
  gemini: { configured: false, reachable: null, isPaid: false, credits: null, creditsExhausted: false, error: null, lastChecked: 0 },
  groq: { configured: false, reachable: null, isPaid: false, credits: null, creditsExhausted: false, error: null, lastChecked: 0 },
  mistral: { configured: false, reachable: null, isPaid: true, credits: null, creditsExhausted: false, error: null, lastChecked: 0 },
  anthropic: { configured: false, reachable: null, isPaid: true, credits: null, creditsExhausted: false, error: null, lastChecked: 0 },
  custom: { configured: false, reachable: null, isPaid: false, credits: null, creditsExhausted: false, error: null, lastChecked: 0 }
};

// Registro unico dei provider mostrati dal client. La UI consuma esclusivamente
// providerGroups: aggiungere una voce qui produce automaticamente un nuovo pulsante.
const MODEL_PROVIDER_REGISTRY = [
  { id: 'openrouter', name: 'OpenRouter', source: 'remote', transport: 'openrouter', getModels: function () { return openrouterModelsCache; } },
  { id: 'nvidia', name: 'NVIDIA NIM', source: 'remote', transport: 'nvidia', getModels: function () { return nvidiaModelsCache; } },
  { id: 'ashna', name: 'Ashna AI', source: 'remote', transport: 'ashna', getModels: function () { return ashnaModelsCache; } },
  { id: 'cerebras', name: 'Cerebras Cloud', source: 'remote', transport: 'cerebras', getModels: function () { return cerebrasModelsCache; } },
  { id: 'openai', name: 'OpenAI', source: 'remote', transport: 'openai', getModels: function () { return openaiModelsCache; }, fallbackProvider: 'OpenAI' },
  { id: 'deepseek', name: 'DeepSeek', source: 'remote', transport: 'deepseek', getModels: function () { return deepseekModelsCache; }, fallbackProvider: 'DeepSeek' },
  { id: 'gemini', name: 'Google Gemini', source: 'remote', transport: 'gemini', getModels: function () { return geminiModelsCache; } },
  { id: 'groq', name: 'Groq Cloud', source: 'remote', transport: 'groq', getModels: function () { return groqModelsCache; } },
  { id: 'mistral', name: 'Mistral AI', source: 'remote', transport: 'mistral', getModels: function () { return mistralModelsCache; } },
  { id: 'anthropic', name: 'Anthropic Claude', source: 'remote', transport: 'anthropic', getModels: function () { return anthropicModelsCache; }, fallbackProvider: 'Anthropic' },
  { id: 'custom', name: 'Personalizzato', source: 'remote', transport: 'custom', getModels: function () { return customModelsCache; } }
];

function uniqueChatModels(models) {
  const seen = new Set();
  return filtraModelliChat(models).filter(function (model) {
    const id = String(model && model.id || '').trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function fccCatalogProviderGroups() {
  const catalogPath = path.join(os.homedir(), '.fcc', 'codex-model-catalog.json');
  let catalog;
  try {
    catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  } catch (_) {
    return [];
  }

  const executable = findFccExecutable();
  const grouped = new Map();
  const labels = {
    nvidia_nim: 'NVIDIA NIM · FCC',
    tokenrouter: 'TokenRouter · FCC',
    groq: 'Groq · FCC'
  };

  (Array.isArray(catalog.models) ? catalog.models : []).forEach(function (entry) {
    const slug = String(entry && (entry.slug || entry.id) || '').trim();
    if (!slug || entry.visibility === 'hidden' || entry.supported_in_api === false || !modelloChatCompatibile(slug)) return;
    const catalogProvider = slug.split('/')[0].toLowerCase();
    if (!catalogProvider) return;
    if (!grouped.has(catalogProvider)) grouped.set(catalogProvider, []);
    grouped.get(catalogProvider).push({
      id: slug,
      name: String(entry.display_name || entry.name || slug),
      description: String(entry.description || ''),
      isFree: /\bfree\b/i.test(String(entry.description || '')),
      costBadge: '[FCC]',
      contextLength: Number(entry.context_window || entry.max_context_window) || null,
      inputModalities: Array.isArray(entry.input_modalities) ? entry.input_modalities : [],
      priority: Number.isFinite(Number(entry.priority)) ? Number(entry.priority) : Number.MAX_SAFE_INTEGER,
      provider: labels[catalogProvider] || (catalogProvider + ' · FCC')
    });
  });

  return Array.from(grouped.entries()).map(function (pair) {
    const catalogProvider = pair[0];
    const id = 'fcc-' + catalogProvider.replace(/_/g, '-').replace(/[^a-z0-9-]/g, '');
    const models = uniqueChatModels(pair[1]).sort(function (a, b) {
      return a.priority - b.priority || a.name.localeCompare(b.name);
    });
    return {
      id: id,
      name: labels[catalogProvider] || (catalogProvider.replace(/_/g, ' ') + ' · FCC'),
      source: 'fcc-catalog',
      transport: 'fcc',
      status: {
        configured: true,
        reachable: !!executable,
        isPaid: false,
        credits: null,
        creditsExhausted: false,
        error: executable ? null : 'fcc-claude non trovato in PATH o in ~/.local/bin',
        lastChecked: Date.now()
      },
      models: models
    };
  }).filter(function (group) { return group.models.length > 0; });
}

function buildProviderGroups(localModels) {
  const groups = MODEL_PROVIDER_REGISTRY.map(function (descriptor) {
    const fallback = descriptor.fallbackProvider
      ? CLOUD_MODELS.filter(function (model) { return model.provider === descriptor.fallbackProvider; })
      : [];
    const models = uniqueChatModels([].concat(descriptor.getModels() || [], fallback)).map(function (model) {
      return Object.assign({}, model, {
        transport: descriptor.transport,
        reference: descriptor.transport + '::' + model.id
      });
    });
    return {
      id: descriptor.id,
      name: descriptor.name,
      source: descriptor.source,
      transport: descriptor.transport,
      status: providerStatusCache[descriptor.id] || null,
      models: models
    };
  });

  if (Array.isArray(localModels) && localModels.length) {
    groups.push({
      id: 'ollama',
      name: 'Ollama locale',
      source: 'local',
      transport: 'ollama',
      status: { configured: true, reachable: true, isPaid: false, creditsExhausted: false, error: null, lastChecked: Date.now() },
      models: uniqueChatModels(localModels).map(function (model) {
        return Object.assign({}, model, { transport: 'ollama', reference: 'ollama::' + model.id });
      })
    });
  }

  groups.push.apply(groups, fccCatalogProviderGroups());
  return groups.filter(function (group) {
    return group.models.length > 0 || (group.status && group.status.configured);
  });
}

async function verifyAndLoadProvider(providerName, rawKey, customBaseUrl) {
  const prov = (providerName || '').toLowerCase().trim();
  const apiKey = (rawKey || '').trim();

  if (!apiKey && prov !== 'custom') {
    providerStatusCache[prov] = { configured: false, reachable: null, isPaid: false, credits: null, creditsExhausted: false, error: null, lastChecked: Date.now() };
    return { valid: false, configured: false, provider: prov, error: 'Nessuna API Key inserita' };
  }

  try {
    if (prov === 'openrouter') {
      const authRes = await fetch('https://openrouter.ai/api/v1/auth/key', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10000)
      });
      if (!authRes.ok) {
        let errMsg = 'Chiave OpenRouter non valida o non autorizzata';
        try {
          const ej = await authRes.json();
          if (ej && ej.error && ej.error.message) errMsg = ej.error.message;
        } catch (_) {}
        providerStatusCache.openrouter = { configured: true, reachable: false, isPaid: true, credits: null, creditsExhausted: false, error: errMsg, lastChecked: Date.now() };
        return { valid: false, reachable: false, provider: 'OpenRouter', error: errMsg, statusCode: authRes.status };
      }

      const authData = await authRes.json();
      const keyInfo = authData.data || authData;
      let isExhausted = false;
      let creditsStr = null;
      if (keyInfo && keyInfo.limit !== undefined && keyInfo.usage !== undefined) {
        if (keyInfo.limit === null) {
          creditsStr = 'Illimitati';
        } else {
          const rem = Math.max(0, keyInfo.limit - keyInfo.usage);
          if (rem <= 0) isExhausted = true;
          creditsStr = '$' + rem.toFixed(2);
        }
      }

      const modelsRes = await fetch('https://openrouter.ai/api/v1/models', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(12000)
      });

      let models = [];
      if (modelsRes.ok) {
        const mData = await modelsRes.json();
        models = (mData.data || []).filter(modelloChatCompatibile).map(m => {
          const isFree = (typeof m.id === 'string' && m.id.endsWith(':free')) ||
            (parseFloat(m.pricing?.prompt || 0) === 0 && parseFloat(m.pricing?.completion || 0) === 0);
          const promptM = m.pricing?.prompt ? (parseFloat(m.pricing.prompt) * 1e6).toFixed(2) : '0';
          const compM = m.pricing?.completion ? (parseFloat(m.pricing.completion) * 1e6).toFixed(2) : '0';
          const costBadge = isFree ? '[GRATIS]' : (isExhausted ? '[CREDITI ESAURITI]' : `[CREDITI: $${promptM}/$${compM}]`);
          return {
            id: m.id,
            name: m.name || m.id,
            isFree: isFree,
            costBadge: costBadge,
            promptPriceM: promptM,
            completionPriceM: compM,
            contextLength: m.context_length || null,
            pricing: m.pricing || null,
            description: m.description || '',
            provider: 'OpenRouter'
          };
        });
        if (models.length > 0) openrouterModelsCache = models;
      }

      providerStatusCache.openrouter = {
        configured: true,
        reachable: true,
        isPaid: true,
        credits: isExhausted ? 'Crediti Esauriti ($0.00)' : creditsStr,
        creditsExhausted: isExhausted,
        error: null,
        lastChecked: Date.now()
      };

      return {
        valid: true,
        reachable: true,
        success: true,
        provider: 'OpenRouter',
        isPaid: true,
        creditsRemaining: isExhausted ? '⚠️ Crediti Esauriti ($0.00)' : creditsStr,
        creditsExhausted: isExhausted,
        models: models.length > 0 ? models : openrouterModelsCache,
        freeCount: (models.length > 0 ? models : openrouterModelsCache).filter(m => m.isFree).length,
        paidCount: (models.length > 0 ? models : openrouterModelsCache).filter(m => !m.isFree).length
      };
    }

    if (prov === 'nvidia') {
      const nviRes = await fetch('https://integrate.api.nvidia.com/v1/models', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000)
      });
      if (!nviRes.ok) {
        let errMsg = 'Chiave NVIDIA NIM non valida o non autorizzata';
        try {
          const ej = await nviRes.json();
          if (ej && ej.detail) errMsg = ej.detail;
        } catch (_) {}
        providerStatusCache.nvidia = { configured: true, reachable: false, isPaid: false, credits: null, creditsExhausted: false, error: errMsg, lastChecked: Date.now() };
        return { valid: false, reachable: false, provider: 'NVIDIA', error: errMsg, statusCode: nviRes.status };
      }

      const nviData = await nviRes.json();
      const rawModels = nviData.data || [];
      const priorityIds = [
        'meta/llama-3.2-11b-vision-instruct',
        'deepseek-ai/deepseek-v4-flash-0731',
        'meta/llama-3.2-90b-vision-instruct',
        'nvidia/llama-3.1-nemotron-70b-instruct',
        'mistralai/codestral-22b-instruct-v0.1',
        'meta/llama-3.3-70b-instruct',
        'qwen/qwen2.5-coder-32b-instruct'
      ];
      const priorityRank = new Map(priorityIds.map(function (id, index) { return [id, index]; }));
      // NVIDIA restituisce anche modelli validi che non contengono "llama", "coder" o
      // "nemotron" nel nome. Il vecchio filtro regex li nascondeva arbitrariamente.
      // Manteniamo soltanto il filtro semantico comune (embedding/OCR/audio/etc.) e
      // ordiniamo gli ID preferiti in testa senza eliminare il resto del catalogo chat.
      const models = rawModels
        .filter(modelloChatCompatibile)
        .slice()
        .sort(function (a, b) {
          const ar = priorityRank.has(a.id) ? priorityRank.get(a.id) : Number.MAX_SAFE_INTEGER;
          const br = priorityRank.has(b.id) ? priorityRank.get(b.id) : Number.MAX_SAFE_INTEGER;
          return ar - br || String(a.id || '').localeCompare(String(b.id || ''));
        })
        .map(function (model) {
          return {
            id: model.id,
            name: model.display_name || model.name || String(model.id || '').split('/').pop(),
            isFree: true,
            costBadge: '[NVIDIA NIM]',
            provider: 'NVIDIA',
            description: model.description || '',
            inputModalities: model.input_modalities || model.modalities || []
          };
        });

      if (models.length > 0) nvidiaModelsCache = models;

      providerStatusCache.nvidia = {
        configured: true,
        reachable: true,
        isPaid: false,
        credits: 'Free Quota NIM (1000 crediti API)',
        creditsExhausted: false,
        error: null,
        lastChecked: Date.now()
      };

      return {
        valid: true,
        reachable: true,
        success: true,
        provider: 'NVIDIA',
        isPaid: false,
        creditsRemaining: 'Free Quota NIM (1000 crediti API)',
        creditsExhausted: false,
        models: models.length > 0 ? models : nvidiaModelsCache,
        freeCount: (models.length > 0 ? models : nvidiaModelsCache).length,
        paidCount: 0
      };
    }

    if (prov === 'ashna') {
      const ashnaRes = await fetch('https://api.ashna.ai/v1/models', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000)
      });
      if (!ashnaRes.ok) {
        let errMsg = 'Chiave Ashna AI non valida o non autorizzata';
        try {
          const ej = await ashnaRes.json();
          if (ej && ej.message) errMsg = ej.message;
        } catch (_) {}
        providerStatusCache.ashna = { configured: true, reachable: false, isPaid: false, credits: null, creditsExhausted: false, error: errMsg, lastChecked: Date.now() };
        return { valid: false, reachable: false, provider: 'Ashna', error: errMsg, statusCode: ashnaRes.status };
      }

      const ashnaData = await ashnaRes.json();
      const rawModels = ashnaData.data || [];
      const models = rawModels.filter(modelloChatCompatibile).map(m => ({
        id: m.id,
        name: m.display_name || m.id,
        isFree: true,
        costBadge: '[ASHNA AI]',
        provider: 'Ashna'
      }));
      if (models.length > 0) ashnaModelsCache = models;

      providerStatusCache.ashna = {
        configured: true,
        reachable: true,
        isPaid: false,
        credits: 'Ashna Dynamic Routing Attivo',
        creditsExhausted: false,
        error: null,
        lastChecked: Date.now()
      };

      return {
        valid: true,
        reachable: true,
        success: true,
        provider: 'Ashna',
        isPaid: false,
        creditsRemaining: 'Ashna Dynamic Routing Attivo',
        creditsExhausted: false,
        models: models.length > 0 ? models : ashnaModelsCache,
        freeCount: (models.length > 0 ? models : ashnaModelsCache).length,
        paidCount: 0
      };
    }

    if (prov === 'cerebras') {
      const cerRes = await fetch('https://api.cerebras.ai/v1/models', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000)
      });
      if (!cerRes.ok) {
        let errMsg = 'Chiave Cerebras Cloud non valida o non autorizzata';
        try {
          const ej = await cerRes.json();
          if (ej && ej.error && ej.error.message) errMsg = ej.error.message;
        } catch (_) {}
        providerStatusCache.cerebras = { configured: true, reachable: false, isPaid: false, credits: null, creditsExhausted: false, error: errMsg, lastChecked: Date.now() };
        return { valid: false, reachable: false, provider: 'Cerebras', error: errMsg, statusCode: cerRes.status };
      }

      const cerData = await cerRes.json();
      const models = (cerData.data || []).map(m => {
        const isFree = m.id.toLowerCase().includes('8b') || m.id.toLowerCase().includes('free');
        return {
          id: m.id,
          name: m.id,
          isFree: isFree,
          costBadge: isFree ? '[FREE TIER]' : '[A CREDITI]',
          promptPriceM: isFree ? '0' : '0.60',
          completionPriceM: isFree ? '0' : '0.60',
          provider: 'Cerebras'
        };
      });
      if (models.length > 0) cerebrasModelsCache = models;

      providerStatusCache.cerebras = {
        configured: true,
        reachable: true,
        isPaid: false,
        credits: 'Free Tier Attivo (1M tok/giorno)',
        creditsExhausted: false,
        error: null,
        lastChecked: Date.now()
      };

      return {
        valid: true,
        reachable: true,
        success: true,
        provider: 'Cerebras',
        isPaid: false,
        creditsRemaining: 'Free Tier Attivo (1M tok/giorno)',
        creditsExhausted: false,
        models: models.length > 0 ? models : cerebrasModelsCache,
        freeCount: models.filter(m => m.isFree).length,
        paidCount: models.filter(m => !m.isFree).length
      };
    }

    if (prov === 'openai') {
      const oaiRes = await fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000)
      });
      if (!oaiRes.ok) {
        let errMsg = 'Chiave OpenAI non valida o crediti non disponibili';
        try {
          const ej = await oaiRes.json();
          if (ej && ej.error && ej.error.message) errMsg = ej.error.message;
        } catch (_) {}
        providerStatusCache.openai = { configured: true, reachable: false, isPaid: true, credits: null, creditsExhausted: false, error: errMsg, lastChecked: Date.now() };
        return { valid: false, reachable: false, provider: 'OpenAI', error: errMsg, statusCode: oaiRes.status };
      }

      const oaiData = await oaiRes.json();
      const raw = oaiData.data || [];
      const priorityModels = ['gpt-4o', 'gpt-4o-mini', 'o1', 'o1-mini', 'o3-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'];
      const models = [];
      priorityModels.forEach(id => {
        if (raw.some(m => m.id === id)) {
          models.push({ id: id, name: id, isFree: false, costBadge: '[A CREDITI]', provider: 'OpenAI' });
        }
      });
      raw.forEach(m => {
        if (!models.some(x => x.id === m.id) && /^(gpt-4|gpt-3\.5|o1|o3|chatgpt)/i.test(m.id) && !/realtime|audio|transcription|embedding/i.test(m.id)) {
          models.push({ id: m.id, name: m.id, isFree: false, costBadge: '[A CREDITI]', provider: 'OpenAI' });
        }
      });
      if (models.length > 0) openaiModelsCache = models;

      providerStatusCache.openai = {
        configured: true,
        reachable: true,
        isPaid: true,
        credits: 'Pay-as-you-go (Richiede crediti)',
        creditsExhausted: false,
        error: null,
        lastChecked: Date.now()
      };

      return {
        valid: true,
        reachable: true,
        success: true,
        provider: 'OpenAI',
        isPaid: true,
        creditsRemaining: 'Pay-as-you-go (Richiede crediti)',
        creditsExhausted: false,
        models: models.length > 0 ? models : openaiModelsCache,
        freeCount: 0,
        paidCount: (models.length > 0 ? models : openaiModelsCache).length
      };
    }

    if (prov === 'deepseek') {
      const dsRes = await fetch('https://api.deepseek.com/models', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000)
      });
      if (!dsRes.ok) {
        let errMsg = 'Chiave DeepSeek non valida o non autorizzata';
        try {
          const ej = await dsRes.json();
          if (ej && ej.error && ej.error.message) errMsg = ej.error.message;
        } catch (_) {}
        providerStatusCache.deepseek = { configured: true, reachable: false, isPaid: true, credits: null, creditsExhausted: false, error: errMsg, lastChecked: Date.now() };
        return { valid: false, reachable: false, provider: 'DeepSeek', error: errMsg, statusCode: dsRes.status };
      }

      let balanceStr = 'Pay-as-you-go (A Crediti)';
      let isExhausted = false;
      try {
        const balRes = await fetch('https://api.deepseek.com/user/balance', {
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
          signal: AbortSignal.timeout(5000)
        });
        if (balRes.ok) {
          const bData = await balRes.json();
          if (bData && bData.is_available === false) {
            isExhausted = true;
            balanceStr = 'Crediti Esauriti ($0.00)';
          } else if (bData && Array.isArray(bData.balance_infos) && bData.balance_infos.length > 0) {
            const b = bData.balance_infos[0];
            const tot = parseFloat(b.total_balance || 0);
            if (tot <= 0) isExhausted = true;
            balanceStr = `Saldo: ${b.currency} ${b.total_balance}`;
          }
        }
      } catch (_) {}

      const dsData = await dsRes.json();
      const raw = dsData.data || [];
      const models = raw.map(m => ({
        id: m.id,
        name: m.id === 'deepseek-chat' ? 'DeepSeek V3 (chat)' : (m.id === 'deepseek-reasoner' ? 'DeepSeek R1 (reasoner)' : m.id),
        isFree: false,
        costBadge: isExhausted ? '[CREDITI ESAURITI]' : '[A CREDITI]',
        provider: 'DeepSeek'
      }));
      if (!models.some(m => m.id === 'deepseek-chat')) {
        models.unshift({ id: 'deepseek-chat', name: 'DeepSeek V3 (chat)', isFree: false, costBadge: isExhausted ? '[CREDITI ESAURITI]' : '[A CREDITI]', provider: 'DeepSeek' });
      }
      if (!models.some(m => m.id === 'deepseek-reasoner')) {
        models.push({ id: 'deepseek-reasoner', name: 'DeepSeek R1 (reasoner)', isFree: false, costBadge: isExhausted ? '[CREDITI ESAURITI]' : '[A CREDITI]', provider: 'DeepSeek' });
      }
      if (models.length > 0) deepseekModelsCache = models;

      providerStatusCache.deepseek = {
        configured: true,
        reachable: true,
        isPaid: true,
        credits: balanceStr,
        creditsExhausted: isExhausted,
        error: null,
        lastChecked: Date.now()
      };

      return {
        valid: true,
        reachable: true,
        success: true,
        provider: 'DeepSeek',
        isPaid: true,
        creditsRemaining: balanceStr,
        creditsExhausted: isExhausted,
        models: models,
        freeCount: 0,
        paidCount: models.length
      };
    }

    if (prov === 'gemini') {
      const gemRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, {
        method: 'GET',
        signal: AbortSignal.timeout(10000)
      });
      if (!gemRes.ok) {
        let errMsg = 'Chiave Google Gemini non valida o non autorizzata';
        try {
          const ej = await gemRes.json();
          if (ej && ej.error && ej.error.message) errMsg = ej.error.message;
        } catch (_) {}
        providerStatusCache.gemini = { configured: true, reachable: false, isPaid: false, credits: null, creditsExhausted: false, error: errMsg, lastChecked: Date.now() };
        return { valid: false, reachable: false, provider: 'Gemini', error: errMsg, statusCode: gemRes.status };
      }

      const gemData = await gemRes.json();
      const raw = gemData.models || [];
      const models = raw
        .filter(m => m.name && /gemini/i.test(m.name) && (m.supportedGenerationMethods || []).includes('generateContent'))
        .map(m => {
          const cleanId = m.name.replace(/^models\//, '');
          return {
            id: cleanId,
            name: m.displayName || cleanId,
            isFree: true,
            costBadge: '[GEMINI GRATIS]',
            provider: 'Gemini'
          };
        });
      if (models.length > 0) geminiModelsCache = models;

      providerStatusCache.gemini = {
        configured: true,
        reachable: true,
        isPaid: false,
        credits: 'Free Tier Google AI Studio Attivo',
        creditsExhausted: false,
        error: null,
        lastChecked: Date.now()
      };

      return {
        valid: true,
        reachable: true,
        success: true,
        provider: 'Gemini',
        isPaid: false,
        creditsRemaining: 'Free Tier Google AI Studio Attivo',
        creditsExhausted: false,
        models: models.length > 0 ? models : geminiModelsCache,
        freeCount: (models.length > 0 ? models : geminiModelsCache).length,
        paidCount: 0
      };
    }

    if (prov === 'groq') {
      const groqRes = await fetch('https://api.groq.com/openai/v1/models', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000)
      });
      if (!groqRes.ok) {
        let errMsg = 'Chiave Groq non valida o non autorizzata';
        try {
          const ej = await groqRes.json();
          if (ej && ej.error && ej.error.message) errMsg = ej.error.message;
        } catch (_) {}
        providerStatusCache.groq = { configured: true, reachable: false, isPaid: false, credits: null, creditsExhausted: false, error: errMsg, lastChecked: Date.now() };
        return { valid: false, reachable: false, provider: 'Groq', error: errMsg, statusCode: groqRes.status };
      }

      const groqData = await groqRes.json();
      const raw = groqData.data || [];
      const models = raw
        .filter(modelloChatCompatibile)
        .map(m => ({
          id: m.id,
          name: m.id,
          isFree: true,
          costBadge: '[GROQ GRATIS]',
          provider: 'Groq'
        }));
      if (models.length > 0) groqModelsCache = models;

      providerStatusCache.groq = {
        configured: true,
        reachable: true,
        isPaid: false,
        credits: 'Free Tier Groq Cloud (Ultra Veloce)',
        creditsExhausted: false,
        error: null,
        lastChecked: Date.now()
      };

      return {
        valid: true,
        reachable: true,
        success: true,
        provider: 'Groq',
        isPaid: false,
        creditsRemaining: 'Free Tier Groq Cloud (Ultra Veloce)',
        creditsExhausted: false,
        models: models.length > 0 ? models : groqModelsCache,
        freeCount: (models.length > 0 ? models : groqModelsCache).length,
        paidCount: 0
      };
    }

    if (prov === 'mistral') {
      const misRes = await fetch('https://api.mistral.ai/v1/models', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000)
      });
      if (!misRes.ok) {
        let errMsg = 'Chiave Mistral AI non valida o non autorizzata';
        try {
          const ej = await misRes.json();
          if (ej && ej.message) errMsg = ej.message;
        } catch (_) {}
        providerStatusCache.mistral = { configured: true, reachable: false, isPaid: true, credits: null, creditsExhausted: false, error: errMsg, lastChecked: Date.now() };
        return { valid: false, reachable: false, provider: 'Mistral', error: errMsg, statusCode: misRes.status };
      }

      const misData = await misRes.json();
      const raw = misData.data || [];
      const models = raw
        .filter(m => /mistral|codestral|ministral|pixtral/i.test(m.id) && modelloChatCompatibile(m))
        .map(m => ({
          id: m.id,
          name: m.id,
          isFree: false,
          costBadge: '[A CREDITI]',
          provider: 'Mistral'
        }));
      if (models.length > 0) mistralModelsCache = models;

      providerStatusCache.mistral = {
        configured: true,
        reachable: true,
        isPaid: true,
        credits: 'A Crediti (La Plateforme Mistral)',
        creditsExhausted: false,
        error: null,
        lastChecked: Date.now()
      };

      return {
        valid: true,
        reachable: true,
        success: true,
        provider: 'Mistral',
        isPaid: true,
        creditsRemaining: 'A Crediti (La Plateforme Mistral)',
        creditsExhausted: false,
        models: models.length > 0 ? models : mistralModelsCache,
        freeCount: 0,
        paidCount: (models.length > 0 ? models : mistralModelsCache).length
      };
    }

    if (prov === 'anthropic') {
      const antRes = await fetch('https://api.anthropic.com/v1/models', {
        method: 'GET',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        signal: AbortSignal.timeout(10000)
      });
      if (!antRes.ok) {
        let errMsg = 'Chiave Anthropic non valida o non autorizzata';
        try {
          const ej = await antRes.json();
          if (ej && ej.error && ej.error.message) errMsg = ej.error.message;
        } catch (_) {}
        providerStatusCache.anthropic = { configured: true, reachable: false, isPaid: true, credits: null, creditsExhausted: false, error: errMsg, lastChecked: Date.now() };
        return { valid: false, reachable: false, provider: 'Anthropic', error: errMsg, statusCode: antRes.status };
      }

      const antData = await antRes.json();
      const raw = antData.data || [];
      const models = raw.map(m => ({
        id: m.id,
        name: m.display_name || m.id,
        isFree: false,
        costBadge: '[A CREDITI]',
        provider: 'Anthropic'
      }));
      if (models.length > 0) anthropicModelsCache = models;

      providerStatusCache.anthropic = {
        configured: true,
        reachable: true,
        isPaid: true,
        credits: 'Account API Anthropic (A Crediti)',
        creditsExhausted: false,
        error: null,
        lastChecked: Date.now()
      };

      return {
        valid: true,
        reachable: true,
        success: true,
        provider: 'Anthropic',
        isPaid: true,
        creditsRemaining: 'Account API Anthropic (A Crediti)',
        creditsExhausted: false,
        models: models.length > 0 ? models : anthropicModelsCache,
        freeCount: 0,
        paidCount: (models.length > 0 ? models : anthropicModelsCache).length
      };
    }

    if (prov === 'custom') {
      // Use first custom endpoint from array, or fall back to customBaseUrl parameter or config
      const firstCustomEndpoint = (config.customEndpoints && config.customEndpoints.length > 0)
        ? config.customEndpoints[0].baseUrl
        : '';
      const targetBase = (customBaseUrl || firstCustomEndpoint || config.customBaseUrl || config.baseUrl || '').replace(/\/+$/, '');
      if (!targetBase) {
        return { valid: false, reachable: false, provider: 'Custom', error: 'Inserisci un Base URL per il provider personalizzato' };
      }
      let modelsRes = null;
      // Use API key from first custom endpoint if available
      const endpointApiKey = (config.customEndpoints && config.customEndpoints.length > 0)
        ? config.customEndpoints[0].apiKey
        : '';
      const apiKeyToUse = apiKey || endpointApiKey;
      try {
        modelsRes = await fetch(`${targetBase}/models`, {
          headers: apiKeyToUse ? { 'Authorization': `Bearer ${apiKeyToUse}` } : {},
          signal: AbortSignal.timeout(8000)
        });
      } catch (_) {
        try {
          modelsRes = await fetch(`${targetBase}/v1/models`, {
            headers: apiKeyToUse ? { 'Authorization': `Bearer ${apiKeyToUse}` } : {},
            signal: AbortSignal.timeout(8000)
          });
        } catch (_) {}
      }
      if (!modelsRes || !modelsRes.ok) {
        const errMsg = 'Impossibile raggiungere o leggere i modelli dall\'endpoint personalizzato';
        providerStatusCache.custom = { configured: true, reachable: false, isPaid: false, credits: null, creditsExhausted: false, error: errMsg, lastChecked: Date.now() };
        return { valid: false, reachable: false, provider: 'Custom', error: errMsg };
      }

      const cData = await modelsRes.json();
      const raw = cData.data || cData.models || [];
      const models = raw.map(m => {
        const id = typeof m === 'string' ? m : (m.id || m.name);
        return {
          id: id,
          name: id,
          isFree: true,
          costBadge: '[PERSONALIZZATO]',
          provider: 'Custom'
        };
      });
      if (models.length > 0) customModelsCache = models;

      providerStatusCache.custom = {
        configured: true,
        reachable: true,
        isPaid: false,
        credits: 'Endpoint Personalizzato Attivo',
        creditsExhausted: false,
        error: null,
        lastChecked: Date.now()
      };

      return {
        valid: true,
        reachable: true,
        success: true,
        provider: 'Custom',
        isPaid: false,
        creditsRemaining: 'Endpoint Personalizzato Attivo',
        creditsExhausted: false,
        models: models,
        freeCount: models.length,
        paidCount: 0
      };
    }

    return { valid: false, error: 'Provider non riconosciuto: ' + prov };
  } catch (err) {
    const isNetErr = rilevaErroreDiRete(err.message);
    const errMsg = isNetErr
      ? ('Connessione debole o assente — server non raggiungibile: ' + err.message)
      : ('Errore verifica / recupero modelli: ' + err.message);

    providerStatusCache[prov] = {
      configured: !!apiKey,
      reachable: false,
      isPaid: ['openai', 'deepseek', 'mistral', 'anthropic', 'openrouter'].includes(prov),
      credits: null,
      creditsExhausted: false,
      error: errMsg,
      lastChecked: Date.now()
    };

    return {
      valid: false,
      reachable: false,
      provider: prov,
      error: errMsg
    };
  }
}

// Timestamp dell'ultimo refresh per ogni provider — serve per la scadenza temporale
const modelsCacheTimestamp = {};
const MODELS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minuti

async function refreshRemoteModelsCache(forceAll) {
  const providersToRefresh = MODEL_PROVIDER_REGISTRY.map(function (provider) { return provider.id; });
  const now = Date.now();
  for (const p of providersToRefresh) {
    const k = getKeyForProvider(p);
    const hasCustomUrl = p === 'custom' && (config.customBaseUrl || config.baseUrl);
    if (k || hasCustomUrl) {
      const descriptor = MODEL_PROVIDER_REGISTRY.find(function (provider) { return provider.id === p; });
      const cachedModels = descriptor ? descriptor.getModels() : [];
      const cacheAge = now - (modelsCacheTimestamp[p] || 0);
      const isStale = cacheAge > MODELS_CACHE_TTL_MS;
      const isEmpty = !cachedModels || cachedModels.length === 0;
      if (forceAll || isEmpty || isStale) {
        try {
          await verifyAndLoadProvider(p, k, config.customBaseUrl);
          modelsCacheTimestamp[p] = Date.now();
        } catch (_) {}
      }
    }
  }
}

app.post('/api/keys/verify', async (req, res) => {
  const { provider, apiKey, baseUrl, verifyAll } = req.body || {};
  if (verifyAll) {
    const results = {};
    const providersToTest = MODEL_PROVIDER_REGISTRY.map(function (entry) { return entry.id; });
    for (const p of providersToTest) {
      const k = (req.body.apiKeys && req.body.apiKeys[p]) || getKeyForProvider(p);
      const bUrl = (p === 'custom' ? (req.body.customBaseUrl || baseUrl || config.customBaseUrl || config.baseUrl) : undefined);
      if (k || (p === 'custom' && bUrl)) {
        results[p] = await verifyAndLoadProvider(p, k, bUrl);
      }
    }
    return res.json({
      success: true,
      results: results,
      providerStatus: providerStatusCache
    });
  }

  let p = (provider || '').toLowerCase().trim();
  const k = apiKey || getKeyForProvider(p);
  if (!p && k) {
    if (k.startsWith('nvapi-')) p = 'nvidia';
    else if (k.startsWith('csk-')) p = 'cerebras';
    else if (k.startsWith('cwAK')) p = 'ashna';
    else if (k.startsWith('sk-or-')) p = 'openrouter';
    else if (k.startsWith('AIzaSy')) p = 'gemini';
    else if (k.startsWith('gsk_')) p = 'groq';
    else if (k.startsWith('sk-ant-')) p = 'anthropic';
    else if (k.startsWith('sk-')) p = 'openai';
    else p = 'openrouter';
  }
  const result = await verifyAndLoadProvider(p, k, baseUrl);
  return res.json(result);
});

app.post('/api/openrouter/verify', async (req, res) => {
  const apiKey = (req.body && req.body.apiKey ? String(req.body.apiKey) : '').trim();
  if (!apiKey) {
    return res.status(400).json({ valid: false, error: 'Nessuna API key specificata' });
  }
  let prov = (req.body.provider || '').toLowerCase().trim();
  if (!prov) {
    if (apiKey.startsWith('nvapi-')) prov = 'nvidia';
    else if (apiKey.startsWith('csk-')) prov = 'cerebras';
    else if (apiKey.startsWith('cwAK')) prov = 'ashna';
    else if (apiKey.startsWith('sk-or-')) prov = 'openrouter';
    else if (apiKey.startsWith('AIzaSy')) prov = 'gemini';
    else if (apiKey.startsWith('gsk_')) prov = 'groq';
    else if (apiKey.startsWith('sk-ant-')) prov = 'anthropic';
    else if (apiKey.startsWith('sk-')) prov = 'openai';
    else prov = 'openrouter';
  }
  const result = await verifyAndLoadProvider(prov, apiKey, req.body.baseUrl);
  return res.json(result);
});

app.get('/api/available-models', async (req, res) => {
  const base = baseUrlForProvider('ollama');
  let localModels = [];
  try {
    const response = await fetchUrl(base + '/api/tags', { timeout: 3000 });
    const parsed = JSON.parse(response.body || response);
    localModels = (parsed.models || []).filter(modelloChatCompatibile).map(m => ({
      id: m.name,
      name: m.name,
      sizeGb: m.size ? Number((m.size / 1e9).toFixed(1)) : null,
      contextLength: (m.details && m.details.context_length) || null,
      provider: 'Ollama'
    }));
  } catch (err) {}

  const force = req.query.force === '1' || req.query.force === 'true';
  await refreshRemoteModelsCache(force);

  const providerGroups = buildProviderGroups(localModels);
  function resolveCurrentGroup(savedGroup, transport, model) {
    const wantedGroup = String(savedGroup || '').trim();
    if (wantedGroup && providerGroups.some(function (group) { return group.id === wantedGroup; })) return wantedGroup;
    const wantedTransport = String(transport || '').trim();
    const wantedModel = String(model || '').trim();
    const match = providerGroups.find(function (group) {
      return (!wantedTransport || group.transport === wantedTransport) &&
        group.models.some(function (item) { return item.id === wantedModel; });
    });
    return match ? match.id : '';
  }
  const currentCoderModel = modelloCoderConfigurato();
  const currentProviderGroup = resolveCurrentGroup(config.modelGroup, config.modelTransport || config.provider, config.model);
  const currentCoderGroup = resolveCurrentGroup(config.coderGroup, config.coderProvider, currentCoderModel);

  res.json({
    success: true,
    providerGroups: providerGroups,
    cloudModels: filtraModelliChat(CLOUD_MODELS),
    localModels: localModels,
    openrouterModels: filtraModelliChat(openrouterModelsCache),
    cerebrasModels: filtraModelliChat(cerebrasModelsCache),
    nvidiaModels: filtraModelliChat(nvidiaModelsCache),
    ashnaModels: filtraModelliChat(ashnaModelsCache),
    openaiModels: filtraModelliChat(openaiModelsCache),
    deepseekModels: filtraModelliChat(deepseekModelsCache),
    geminiModels: filtraModelliChat(geminiModelsCache),
    groqModels: filtraModelliChat(groqModelsCache),
    mistralModels: filtraModelliChat(mistralModelsCache),
    anthropicModels: filtraModelliChat(anthropicModelsCache),
    customModels: filtraModelliChat(customModelsCache),
    providerStatus: providerStatusCache,
    currentModel: config.model || '',
    currentCoderModel: currentCoderModel,
    currentCoderProvider: config.coderProvider || '',
    currentCoderGroup: currentCoderGroup,
    currentVisionModel: config.visionModel || '',
    resolvedVisionModel: modelloVisioneConfigurato(),
    provider: config.provider || 'anthropic',
    currentModelTransport: config.modelTransport || config.provider || 'anthropic',
    currentProviderGroup: currentProviderGroup,
    effort: config.effort || 'high'
  });
});

app.post('/api/models/refresh', async (req, res) => {
  try {
    await refreshRemoteModelsCache(true);
    res.json({ success: true, message: 'Modelli aggiornati con successo da tutti i provider' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// 5e-bis. Analisi dell'INTERO progetto: sintassi di ogni file piu' i controlli
// incrociati fra file (riferimenti, id, import). La verifica automatica guarda solo
// i file toccati nel turno: questa guarda tutto, ed e' il modo per far trovare ad
// Adam i bug che nessuno gli ha segnalato.
// Scrive (o aggiorna) un nodo di memoria di progetto con una certa etichetta.
// Aggiornare invece di accumulare e' essenziale: la memoria entra nel prompt di OGNI
// turno, quindi duplicare la mappa a ogni analisi la farebbe crescere senza limite.
function salvaNodoProgetto(label, type, value, tags) {
  const memoria = loadProjectMemory(config.cwd);
  memoria.nodes = memoria.nodes || [];
  const esistente = memoria.nodes.find(function (n) { return n.label === label; });

  if (!value) {
    // Niente da ricordare: se il nodo c'era, va tolto invece di restare a mentire.
    if (esistente) {
      memoria.nodes = memoria.nodes.filter(function (n) { return n.label !== label; });
      saveProjectMemory(config.cwd, memoria);
    }
    return;
  }

  if (esistente) {
    esistente.value = value;
    esistente.type = type;
    esistente.tags = tags;
    esistente.updatedAt = new Date().toISOString();
  } else {
    memoria.nodes.push({
      id: 'scan_' + label.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      scope: 'project',
      type: type,
      label: label,
      value: value,
      tags: tags,
      synapses: [],
      updatedAt: new Date().toISOString()
    });
  }
  saveProjectMemory(config.cwd, memoria);
}

// Riassunto compatto di com'e' fatto il progetto. Compatto sul serio: finisce nel
// prompt di ogni turno, quindi conta ogni carattere.
function riassumiStruttura(esito, cartella) {
  const perTipo = {};
  (esito.elenco || []).forEach(function (f) {
    const ext = path.extname(f).toLowerCase() || '(senza estensione)';
    perTipo[ext] = (perTipo[ext] || 0) + 1;
  });
  const tipi = Object.keys(perTipo).sort().map(function (e) {
    return perTipo[e] + ' ' + e;
  }).join(', ');

  const principali = (esito.elenco || [])
    .map(function (f) { return path.relative(cartella, f); })
    .filter(function (f) { return f.split(/[\/]/).length <= 2; })
    .slice(0, 25);

  return 'Cartella ' + cartella + '. ' + esito.fileEsaminati + ' file (' + tipi + '). ' +
    'Principali: ' + principali.join(', ') + '.';
}

// Riassunto della mappa per la MEMORIA: deve stare nel prompt di ogni turno,
// quindi va tenuto stretto. Un file per riga, con solo cio' che serve a orientarsi.
function riassumiMappa(mappa) {
  const righe = [];

  mappa.schede
    .filter(function (sc) { return sc.tipo !== 'json'; })
    .slice(0, 30)
    .forEach(function (sc) {
      const parti = [];
      if (sc.funzioni.length) parti.push('funzioni: ' + sc.funzioni.slice(0, 12).join(', '));
      if (sc.variabili.length) parti.push('variabili: ' + sc.variabili.slice(0, 12).join(', '));
      if (sc.dichiaraId.length) parti.push('id: ' + sc.dichiaraId.slice(0, 12).join(', '));
      if (sc.usaId.length) parti.push('usa id: ' + sc.usaId.slice(0, 12).join(', '));
      righe.push('- ' + sc.nome + ' (' + sc.tipo + ', ' + sc.righe + ' righe)' +
        (parti.length ? ' -> ' + parti.join(' | ') : ''));
    });

  if (mappa.collegamenti.length) {
    righe.push('Collegamenti fra file:');
    mappa.collegamenti.slice().sort(function (a, b) {
      function priorita(c) {
        return /^usa (?:variabile|funzione) /.test(c.motivo) ? 0 :
          /^chiama /.test(c.motivo) || /^usa #/.test(c.motivo) ? 1 : 2;
      }
      return priorita(a) - priorita(b);
    }).slice(0, 40).forEach(function (c) {
      righe.push('  ' + c.da + ' --[' + c.motivo + ']--> ' + c.a);
    });
  }

  return righe.join('\n');
}

// Trasforma la mappa in nodi e sinapsi della Mappa Neurale: e' cosi' che l'utente
// la VEDE come diagramma invece di leggerla come elenco.
function mappaVersoMemoriaVisiva(mappa) {
  const memoria = loadProjectMemory(config.cwd);
  memoria.nodes = memoria.nodes || [];

  // Via i nodi della mappa precedente: altrimenti file rinominati o cancellati
  // resterebbero nel diagramma a indicare una struttura che non esiste piu'.
  memoria.nodes = memoria.nodes.filter(function (n) {
    return !(n.tags || []).includes('mappa-codice');
  });

  const idPerNome = {};
  mappa.schede
    .filter(function (sc) { return sc.tipo !== 'json'; })
    .slice(0, 40)
    .forEach(function (sc) {
      const id = 'mappa_' + sc.nome.replace(/[^A-Za-z0-9]+/g, '_');
      idPerNome[sc.nome] = id;
      const dettagli = [];
      if (sc.funzioni.length) dettagli.push('Funzioni: ' + sc.funzioni.slice(0, 15).join(', '));
      if (sc.variabili.length) dettagli.push('Variabili: ' + sc.variabili.slice(0, 15).join(', '));
      if (sc.dichiaraId.length) dettagli.push('Id dichiarati: ' + sc.dichiaraId.slice(0, 15).join(', '));
      if (sc.usaId.length) dettagli.push('Id usati: ' + sc.usaId.slice(0, 15).join(', '));
      memoria.nodes.push({
        id: id,
        scope: 'project',
        type: 'data',
        label: sc.nome,
        value: sc.tipo + ', ' + sc.righe + ' righe. ' + (dettagli.join('. ') || 'Nessun simbolo di primo livello.'),
        tags: ['mappa-codice', sc.tipo],
        synapses: [],
        updatedAt: new Date().toISOString()
      });
    });

  mappa.collegamenti.forEach(function (c) {
    const sorgente = memoria.nodes.find(function (n) { return n.id === idPerNome[c.da]; });
    if (!sorgente || !idPerNome[c.a]) return;
    if (sorgente.synapses.some(function (x) { return x.targetId === idPerNome[c.a] && x.label === c.motivo; })) return;
    sorgente.synapses.push({ targetId: idPerNome[c.a], label: c.motivo, strength: 0.8 });
  });

  saveProjectMemory(config.cwd, memoria);
  return Object.keys(idPerNome).length;
}

// 5e-ter. Mappa del codice: variabili, funzioni e collegamenti fra file.
// 5e-quater. Analisi a RUNTIME: apre davvero le pagine in un browser headless,
// raccoglie errori di console, verifica che i controlli siano cliccabili, e mostra
// ad Adam lo screenshot di cio' che ha prodotto.
app.post('/api/runtime', async (req, res) => {
  const cartella = (req.body && req.body.dir) || config.cwd;

  if (!analisiRuntime.disponibile()) {
    return res.json({
      disponibile: false,
      errore: 'Browser headless non disponibile. Installa con: npx puppeteer browsers install chrome'
    });
  }

  // Stessa origine dell'Anteprima: il browser di controllo apre esattamente la URL
  // che l'utente ha davanti, quindi lo screenshot che Adam guarda e' la pagina che
  // l'utente sta guardando, non una sua copia servita altrove.
  const baseUrl = 'http://127.0.0.1:' + PORT + '/preview';
  const paginaRichiesta = req.body && req.body.pagina;

  let esito;
  try {
    esito = await analisiRuntime.analizzaRuntime(cartella, {
      baseUrl: baseUrl,
      pagina: paginaRichiesta
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  const problemi = [];
  const scatti = [];
  (esito.pagine || []).forEach(function (pg) {
    if (pg.screenshot) scatti.push(pg.screenshot);
    (pg.problemi || []).forEach(function (x) {
      problemi.push({ file: path.join(cartella, pg.pagina), tipo: x.tipo, messaggio: x.messaggio });
      rememberIssue({ file: path.join(cartella, pg.pagina), error: '[' + x.tipo + '] ' + x.messaggio });
    });
  });

  // Poi la pagina viene USATA: clic vero sul pulsante principale, mouse e tasti, stato
  // misurato nel tempo. Il controllo al caricamento non vede i difetti di comportamento:
  // un gioco puo' caricarsi perfettamente e rompersi al primo clic (caso reale: livello
  // dell'interfaccia sopra il canvas e ciclo di animazione che raddoppiava a ogni partita).
  let sonda = null;
  const paginaSonda = paginaRichiesta || ((esito.pagine || [])[0] || {}).pagina;
  if (paginaSonda) {
    try {
      sonda = await sondaPagina({ pagina: paginaSonda, dir: cartella, base: baseUrl });
    } catch (e) {
      sonda = { errore: e.message, note: [], errori: [], schermate: [], momenti: [], osservate: [] };
    }
  }
  const fattiSonda = misure.fattiDellaSonda(sonda);
  if (paginaSonda) {
    const fileSonda = path.join(cartella, paginaSonda);
    const paginaEsito = (esito.pagine || []).find(function (pg) { return pg.pagina === paginaSonda; });
    fattiSonda.forEach(function (f) {
      registraFatto(fileSonda, f);
      // Un errore gia' visto al caricamento non va mostrato due volte. Vale anche per i
      // messaggi di console e per i file che non si caricano: il controllo al caricamento
      // (analisi-runtime) li racconta con parole diverse, ma sono la stessa cosa.
      const errore = f.indexOf('Errore JavaScript: ') === 0;
      const daConsole = f.match(/^Nella console del browser: "([^"]*)"/);
      const daRete = f.match(/^(?:Il file|La richiesta a) (\S+) non /);
      let radice = f;
      if (errore) radice = f.slice('Errore JavaScript: '.length).split(' [')[0].replace(/^Uncaught\s+/, '').replace(/^[A-Za-z]*Error:\s*/, '');
      else if (daConsole) radice = daConsole[1];
      else if (daRete) radice = daRete[1];
      if ((errore || daConsole || daRete) && problemi.some(function (x) { return x.messaggio.indexOf(radice) !== -1; })) return;
      const voce = { file: fileSonda, tipo: errore ? 'runtime' : 'comportamento', messaggio: f };
      problemi.push(voce);
      if (paginaEsito) (paginaEsito.problemi = paginaEsito.problemi || []).push({ tipo: voce.tipo, messaggio: f });
    });
    console.log('[Sonda] ' + paginaSonda + ': ' + fattiSonda.length + ' fatti' +
      (sonda && sonda.errore ? ' (sonda non riuscita: ' + sonda.errore + ')' : '') + '.');
  }

  console.log('[Runtime] ' + (esito.pagine || []).length + ' pagine, ' +
    problemi.length + ' problemi, ' + scatti.length + ' screenshot.');

  // Ad Adam non basta una foto al caricamento: servono le misure di cosa succede quando
  // la pagina viene usata, e il metodo con cui ragionarci. Senza, legge il codice,
  // ipotizza e corregge il sintomo.
  if (req.body && req.body.fix) {
    const riassunto = problemi.length === 0
      ? 'Nessun problema rilevato automaticamente.'
      : problemi.map(function (x) {
          return '- [' + x.tipo + '] ' + path.basename(x.file) + ': ' + x.messaggio;
        }).join('\n');
    const immagini = sonda && !sonda.errore && (sonda.schermate || []).length
      ? misure.scegliSchermate(sonda)
      : scatti.slice(0, 2);
    const focusSonda = misure.scegliFocus(fattiSonda, null);

    const testo = [
      'Ho eseguito ' + (paginaSonda || 'le pagine') + ' in un browser vero come farebbe una persona: l\'ho ' +
        'caricata, ho premuto il pulsante principale con un clic reale, ho mosso mouse e tasti e ho misurato ' +
        'lo stato nel tempo. Ti allego le schermate.',
      '',
      sonda && sonda.rapporto ? sonda.rapporto : '(sonda non disponibile)',
      '',
      'PROBLEMI RIASSUNTI',
      riassunto,
      '',
      sezioneFocus(focusSonda, fattiSonda),
      '',
      comeProcedere(paginaSonda || '<pagina.html>'),
      'Se invece tutto funziona come deve, dillo chiaramente.'
    ].join('\n');

    annullaSonda('nuova prova dal vivo');
    if (paginaSonda && fattiSonda.length) {
      sondaDaRipetere = {
        pagina: paginaSonda, dir: cartella, fatti: fattiSonda, tentativi: 0, giri: 0,
        attesaRisposta: true, sollecitato: false, inCorso: false,
        focus: misure.chiaveFatto(focusSonda), focusTesto: focusSonda
      };
    }
    autoFixCount = 0;
    sendChatPromptConImmagini(testo, immagini,
      { auto: true, attempt: 1, max: massimoTentativiVerifica(), reason: 'prova della pagina in un browser', istantanea: true });
  }

  res.json({
    disponibile: true,
    pagine: (esito.pagine || []).map(function (pg) {
      return {
        pagina: pg.pagina, titolo: pg.titolo, errore: pg.errore,
        screenshot: pg.screenshot ? path.basename(pg.screenshot) : null,
        problemi: pg.problemi || []
      };
    }),
    sonda: sonda ? {
      pagina: paginaSonda,
      url: sonda.url || '',
      hz: sonda.hz || null,
      azione: sonda.azione || null,
      errore: sonda.errore || null,
      note: sonda.note || [],
      errori: sonda.errori || [],
      osservate: sonda.osservate || [],
      momenti: sonda.momenti || [],
      schermate: (sonda.schermate || []).map(function (x) { return { momento: x.momento, nome: path.basename(x.file) }; }),
      rapporto: sonda.rapporto || ''
    } : null,
    problemi: problemi,
    issues: knownIssues
  });
});

// ============================================================
// EDITOR VISIVO (strumenti/editor-visivo.js, public/editor-visivo.js)
// L'utente cambia a vista colori, sfondo, dimensioni e posizione degli elementi
// nell'Anteprima. Lo Studio scrive le regole in studio-modifiche.css e poi controlla: che
// si vedano davvero (alzando la specificita' se il progetto le copre), che la pagina
// funzioni come prima (sonda sulla copia di prima e su quella di ora) e che le guardie
// passino. Se qualcosa si rompe la modifica si annulla da sola, salvo che l'utente
// chieda di applicarla comunque.
// ============================================================

const annullabiliEditor = [];   // stato prima di ogni applicazione, per "Annulla"
let editorInCorso = false;
// Solo i difetti che una modifica di stile puo' introdurre (un elemento che copre il gioco
// o il pulsante, un clic che non arriva, un errore): crescita e cicli dipendono dal caso
// della partita e renderebbero rumoroso il confronto prima/dopo.
const CATEGORIE_EDITOR = ['canvas', 'clic', 'mouse', 'errori'];

function fileEditor(dir, pagina) {
  return { css: path.join(dir, editorVisivo.FILE_MODIFICHE), html: path.join(dir, pagina) };
}

function leggiSeEsiste(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (e) { return null; }
}

// Riporta il file delle modifiche com'era. Non sovrascrive mai lavoro altrui: se il file e'
// cambiato dopo (per esempio l'ha toccato Adam) si ferma; e dell'HTML toglie solo la riga
// <link> aggiunta dallo Studio, senza riscrivere la pagina.
function ripristinaEditor(voce) {
  const f = fileEditor(voce.dir, voce.pagina);
  if (leggiSeEsiste(f.css) !== voce.cssDopo) {
    throw new Error(editorVisivo.FILE_MODIFICHE + ' e\' cambiato dopo questa modifica: non lo sovrascrivo');
  }
  if (voce.css === null) {
    try { fs.unlinkSync(f.css); } catch (e) { /* gia' assente */ }
    if (voce.linkAggiunto) {
      const html = leggiSeEsiste(f.html);
      if (html !== null) {
        fs.writeFileSync(f.html, html.replace(/[ \t]*<link rel="stylesheet" href="studio-modifiche\.css">\r?\n?/, ''));
      }
    }
  } else {
    fs.writeFileSync(f.css, voce.css);
  }
}

// Adam deve sapere che quelle regole esistono: altrimenti, cambiando lo stile nel CSS
// principale, non vedrebbe effetto e non capirebbe perche'.
function ricordaEditor(dir, pagina) {
  const regole = editorVisivo.leggiRegole(leggiSeEsiste(path.join(dir, editorVisivo.FILE_MODIFICHE)) || '');
  salvaNodoProgetto('Editor visivo: ' + pagina, 'rule', regole.length
    ? 'L\'utente ha cambiato l\'aspetto di ' + pagina + ' con l\'editor visivo dello Studio: le regole stanno in ' +
      editorVisivo.FILE_MODIFICHE + ', caricato dalla pagina dopo gli altri fogli di stile. Non duplicarle nel CSS ' +
      'principale e non toglierle senza chiederlo all\'utente.\n' + regole.slice(0, 12).map(function (r) {
        return r.selettore + ' { ' + Object.keys(r.proprieta).map(function (k) { return k + ': ' + r.proprieta[k]; }).join('; ') + ' }';
      }).join('\n')
    : '', ['editor', 'css']);
  restartSessionsForMemory();
}

app.get('/api/editor/stato', (req, res) => {
  const pagina = String(req.query.pagina || '');
  const f = fileEditor(config.cwd, pagina);
  res.json({
    file: editorVisivo.FILE_MODIFICHE,
    regole: editorVisivo.leggiRegole(leggiSeEsiste(f.css) || ''),
    collegato: !!pagina && (leggiSeEsiste(f.html) || '').indexOf(editorVisivo.FILE_MODIFICHE) !== -1,
    annullabili: annullabiliEditor.filter(function (v) { return v.pagina === pagina && v.dir === config.cwd; }).length
  });
});

app.post('/api/editor/applica', async (req, res) => {
  const dir = config.cwd;
  const pagina = String((req.body && req.body.pagina) || '');
  const forza = !!(req.body && req.body.forza);
  if (misure.pagineDelProgetto(dir).indexOf(pagina) === -1) return res.status(404).json({ error: 'Pagina non trovata nel progetto' });
  const valide = editorVisivo.validaRegole(req.body && req.body.regole);
  if (valide.errore) return res.status(400).json({ error: valide.errore });
  if (editorInCorso) return res.status(409).json({ error: 'Sto gia\' applicando delle modifiche: aspetta qualche secondo.' });
  if (!analisiRuntime.disponibile()) return res.status(503).json({ error: 'Serve il browser di controllo per verificare le modifiche.' });

  editorInCorso = true;
  const f = fileEditor(dir, pagina);
  const voce = { pagina: pagina, dir: dir, css: leggiSeEsiste(f.css), cssDopo: null, linkAggiunto: false, quando: Date.now() };
  const av = nuovoAvanzamento('Editor visivo: ' + valide.regole.length + (valide.regole.length === 1 ? ' modifica' : ' modifiche') + ' a ' + pagina, [
    ['scrivo', 'Scrivo le modifiche in ' + editorVisivo.FILE_MODIFICHE],
    ['stili', 'Controllo che si vedano davvero'],
    ['pagina', 'Controllo che la pagina funzioni come prima'],
    ['guardie', 'Rieseguo i collaudi che passavano']
  ]);
  try {
    // La copia di prima serve al confronto della sonda: stessa pagina, senza le modifiche.
    const prima = istantanee.scatta(dir, { base: path.join(os.tmpdir(), 'studio-editor-prima') });
    fase(av, 'scrivo', 'corso');
    let regole = editorVisivo.unisciRegole(editorVisivo.leggiRegole(voce.css || ''), valide.regole);
    const scrivi = function () {
      voce.cssDopo = editorVisivo.scriviCss(regole, pagina);
      fs.writeFileSync(f.css, voce.cssDopo);
      const l = editorVisivo.conLink(leggiSeEsiste(f.html) || '');
      if (l.cambiato) {
        fs.writeFileSync(f.html, l.html);
        voce.linkAggiunto = true;
      }
    };
    scrivi();
    fase(av, 'scrivo', 'ok', regole.length + (regole.length === 1 ? ' regola' : ' regole') + ' nel file');

    // 1. Le modifiche si vedono? Una regola del progetto piu' specifica le coprirebbe senza
    //    alcun errore visibile: in quel caso si alza la specificita' e si riprova.
    fase(av, 'stili', 'corso');
    let senzaEffetto = [];
    for (let giro = 0; giro < 3; giro++) {
      const vs = await verificaStili({ dir: dir, pagina: pagina, regole: regole });
      if (vs.errore) {
        fase(av, 'stili', 'warn', 'non verificabile: ' + vs.errore);
        break;
      }
      const coperte = vs.risultati.filter(function (x) { return x.trovati && x.diversi.length; }).map(function (x) { return x.selettore; });
      senzaEffetto = vs.risultati.filter(function (x) { return !x.trovati; }).map(function (x) { return x.selettore; })
        // Coperta da un gradiente o da un'immagine: alzare la specificita' non servirebbe.
        .concat(vs.risultati.filter(function (x) { return x.trovati && x.coperto; }).map(function (x) { return x.selettore + ' (' + x.coperto + ')'; }));
      if (!coperte.length) break;
      let alzate = 0;
      regole = regole.map(function (r) {
        if (coperte.indexOf(r.selettore) === -1) return r;
        const s = editorVisivo.piuSpecifico(r.selettore);
        if (!s) return r;
        alzate++;
        return { selettore: s, proprieta: r.proprieta };
      });
      if (!alzate) {
        senzaEffetto = senzaEffetto.concat(coperte);
        break;
      }
      fase(av, 'stili', null, 'Il progetto copriva ' + coperte.length + (coperte.length === 1 ? ' modifica' : ' modifiche') + ': alzo la specificita\'');
      scrivi();
    }
    if (av.fasi[1].stato === 'corso') {
      fase(av, 'stili', senzaEffetto.length ? 'warn' : 'ok', senzaEffetto.length
        ? senzaEffetto.length + ' senza effetto al caricamento: ' + senzaEffetto.slice(0, 3).join(', ')
        : 'tutte le modifiche si vedono');
    }

    // 2. La pagina funziona come prima? Sonda sulla copia di prima e su quella di ora, insieme.
    fase(av, 'pagina', 'corso');
    const misurePrimaDopo = await Promise.all([
      prima
        ? sondaPagina({ pagina: pagina, dir: prima.dir, base: 'http://127.0.0.1:1/preview' }).catch(function (e) { return { errore: e.message }; })
        : Promise.resolve({ errore: 'copia di prima non disponibile' }),
      sondaPagina({ pagina: pagina, dir: dir, base: baseAnteprima(), progresso: function (t) { fase(av, 'pagina', null, t); } })
        .catch(function (e) { return { errore: e.message }; })
    ]);
    const rilevanti = function (r) {
      return misure.fattiDellaSonda(r).filter(function (x) { return CATEGORIE_EDITOR.indexOf(misure.categoriaFatto(x)) !== -1; });
    };
    const chiaviPrima = new Set(rilevanti(misurePrimaDopo[0]).map(misure.chiaveFatto));
    const dopo = misurePrimaDopo[1];
    const nuovi = dopo.errore ? [] : rilevanti(dopo).filter(function (x) { return !chiaviPrima.has(misure.chiaveFatto(x)); });
    fase(av, 'pagina', dopo.errore ? 'warn' : (nuovi.length ? 'err' : 'ok'), dopo.errore
      ? 'non verificabile: ' + dopo.errore
      : (nuovi.length ? nuovi.length + (nuovi.length === 1 ? ' problema nuovo' : ' problemi nuovi') : 'funziona come prima'));

    // 3. Le capacita' protette dai collaudi.
    const statoC = collaudatore.caricaCollaudi(dir, pagina);
    const prova = await provaCollaudi(av, 'guardie', dir, pagina, collaudatore.guardie(statoC), Object.assign({}, statoC.esiti));
    const danni = nuovi.concat(prova ? prova.fatti.regressioni : []);

    if (danni.length && !forza) {
      ripristinaEditor(voce);
      chiudiAvanzamento(av, 'err', 'Modifica annullata: avrebbe rotto la pagina.');
      console.log('[Editor] ' + pagina + ': modifica annullata, ' + danni.length + ' problemi.');
      return res.json({ success: false, annullata: true, motivi: danni });
    }

    annullabiliEditor.push(voce);
    if (annullabiliEditor.length > 20) annullabiliEditor.shift();
    ricordaEditor(dir, pagina);
    chiudiAvanzamento(av, danni.length ? 'warn' : 'ok', danni.length
      ? 'Applicata comunque, su richiesta, con ' + danni.length + (danni.length === 1 ? ' problema' : ' problemi')
      : 'Modifiche applicate e verificate');
    console.log('[Editor] ' + pagina + ': ' + regole.length + ' regole applicate' + (danni.length ? ' (forzate, ' + danni.length + ' problemi)' : '') + '.');
    res.json({ success: true, regole: regole, senzaEffetto: senzaEffetto, avvisi: danni, file: editorVisivo.FILE_MODIFICHE });
  } catch (e) {
    try { if (voce.cssDopo !== null) ripristinaEditor(voce); } catch (x) { /* resta com'e': meglio che sovrascrivere */ }
    chiudiAvanzamento(av, 'err', 'Errore: ' + e.message);
    res.status(500).json({ error: e.message });
  } finally {
    editorInCorso = false;
  }
});

app.post('/api/editor/annulla', (req, res) => {
  const pagina = String((req.body && req.body.pagina) || '');
  for (let i = annullabiliEditor.length - 1; i >= 0; i--) {
    const v = annullabiliEditor[i];
    if (v.pagina !== pagina || v.dir !== config.cwd) continue;
    try {
      ripristinaEditor(v);
    } catch (e) {
      return res.status(409).json({ error: e.message });
    }
    annullabiliEditor.splice(i, 1);
    ricordaEditor(v.dir, pagina);
    console.log('[Editor] ' + pagina + ': ultima modifica annullata.');
    return res.json({ success: true, annullabili: annullabiliEditor.filter(function (x) { return x.pagina === pagina && x.dir === config.cwd; }).length });
  }
  res.status(404).json({ error: 'Niente da annullare per questa pagina' });
});

// ============================================================
// REGOLE DI ADAM ED ESAME (strumenti/regole.js, strumenti/esame.js)
// Le regole dell'utente entrano nel prompt solo dopo un esame con correzione automatica,
// fatto con le regole di adesso e con quelle nuove: se una risposta giusta diventa
// sbagliata, o una regola non viene seguita, non si adottano (salvo "adotta comunque").
// Ogni versione resta nella storia e si ripristina con un clic.
// ============================================================

let esameInCorso = false;

function riassuntoStatoRegole() {
  const s = regoleAdam.carica();
  return {
    versione: s.versione,
    regole: s.regole,
    esame: s.esame,
    storia: s.storia.map(function (v) {
      return { versione: v.versione, quando: v.quando, regole: v.regole, punti: v.esame ? v.esame.punti + '/' + v.esame.totale : null };
    }),
    inCorso: esameInCorso
  };
}

app.get('/api/regole', (req, res) => {
  res.json(riassuntoStatoRegole());
});

app.post('/api/regole/prova', async (req, res) => {
  const v = regoleAdam.validaRegole(req.body && req.body.regole);
  if (v.errore) return res.status(400).json({ error: v.errore });
  if (esameInCorso) return res.status(409).json({ error: 'C\'e\' gia\' un esame in corso.' });
  // L'esame usa lo stesso modello e la stessa GPU di Adam: mentre lavora i tempi si
  // allungherebbero per entrambi.
  if (chatBusy || sondaPreliminare) return res.status(409).json({ error: 'Adam sta lavorando: riprova quando ha finito.' });
  if ((config.provider || 'anthropic') !== 'ollama') return res.status(400).json({ error: 'Per ora l\'esame funziona con Ollama.' });
  esameInCorso = true;
  const forza = !!(req.body && req.body.forza);
  const stato = regoleAdam.carica();
  const av = nuovoAvanzamento('Esame delle regole di Adam (' + v.regole.length + (v.regole.length === 1 ? ' regola' : ' regole') + ')', [
    ['prima', 'Esame con le regole di adesso'],
    ['dopo', 'Esame con le regole nuove'],
    ['decisione', 'Confronto e decisione']
  ]);
  const comune = { baseUrl: baseUrlForProvider('ollama'), modello: config.model };
  try {
    fase(av, 'prima', 'corso');
    const prima = await esameModello.faiEsame(Object.assign({}, comune, { regole: stato.regole, prove: [],
      progresso: function (t) { fase(av, 'prima', null, t); } }));
    fase(av, 'prima', 'ok', prima.punti + '/' + prima.totale + ' giuste');
    fase(av, 'dopo', 'corso');
    const dopo = await esameModello.faiEsame(Object.assign({}, comune, { regole: v.regole, prove: v.regole,
      progresso: function (t) { fase(av, 'dopo', null, t); } }));
    fase(av, 'dopo', 'ok', dopo.punti + '/' + dopo.totale + ' giuste');
    const decisione = esameModello.decidi(prima, dopo);
    const adotta = decisione.adotta || forza;
    if (adotta) {
      regoleAdam.salva(regoleAdam.nuovaVersione(stato, v.regole, { punti: dopo.punti, totale: dopo.totale, quando: Date.now() }));
      // Il prompt di sistema cambia: la sessione riparte con --resume, come per la memoria.
      restartSessionsForMemory();
    }
    fase(av, 'decisione', decisione.adotta ? 'ok' : (adotta ? 'warn' : 'err'), decisione.adotta
      ? 'nessun peggioramento: regole adottate'
      : (adotta ? 'adottate comunque, su richiesta' : decisione.motivi.length + (decisione.motivi.length === 1 ? ' problema' : ' problemi') + ': non adottate'));
    chiudiAvanzamento(av, decisione.adotta ? 'ok' : (adotta ? 'warn' : 'err'),
      adotta ? 'Regole in vigore (versione ' + (stato.versione + 1) + ')' : 'Regole non adottate: la versione in vigore resta la ' + stato.versione);
    console.log('[Regole] Esame: prima ' + prima.punti + '/' + prima.totale + ', dopo ' + dopo.punti + '/' + dopo.totale +
      ' -> ' + (adotta ? 'adottate' : 'non adottate'));
    res.json({ success: true, adottate: adotta, forzate: adotta && !decisione.adotta, prima: prima, dopo: dopo,
      motivi: decisione.motivi, stato: riassuntoStatoRegole() });
  } catch (e) {
    chiudiAvanzamento(av, 'err', 'Esame non riuscito: ' + e.message);
    res.status(500).json({ error: e.message });
  } finally {
    esameInCorso = false;
  }
});

app.post('/api/regole/ripristina', (req, res) => {
  const stato = regoleAdam.carica();
  const nuovo = regoleAdam.ripristina(stato, req.body && req.body.versione);
  if (!nuovo) return res.status(404).json({ error: 'Versione non trovata' });
  regoleAdam.salva(nuovo);
  restartSessionsForMemory();
  console.log('[Regole] Ripristinata la versione ' + req.body.versione + ' come ' + nuovo.versione + '.');
  res.json({ success: true, stato: riassuntoStatoRegole() });
});

// ============================================================
// SVEGLIE DI ADAM (strumenti/sveglie.js, strumenti/sveglia.js)
// Adam si programma una sveglia con Bash quando deve aspettare o vuole ricontrollare piu'
// tardi. Lo Studio la conserva su disco (sopravvive ai riavvii) e all'ora giusta, se
// richiesto, riprova la pagina e prende una schermata; poi, appena la chat e' libera, gli
// manda la sua domanda.
// ============================================================

const timerSveglie = new Map();

function descriviSveglia(s) {
  return Object.assign({}, s, { ora: sveglie.oraLeggibile(s.quando) });
}

function programmaSveglia(s) {
  clearTimeout(timerSveglie.get(s.id));
  // Una sveglia scaduta mentre lo Studio era spento suona poco dopo l'avvio.
  const ritardo = Math.max(5000, s.quando - Date.now());
  timerSveglie.set(s.id, setTimeout(function () {
    timerSveglie.delete(s.id);
    suonaSveglia(s.id).catch(function (e) { console.error('[Sveglia] Non suonata:', e.message); });
  }, ritardo));
}

async function suonaSveglia(id) {
  const elenco = sveglie.carica();
  const s = elenco.find(function (x) { return x.id === id; });
  if (!s || s.stato !== 'in attesa') return;
  // La sveglia e' di un progetto: se nel frattempo si lavora su un altro, non lo si mescola.
  if (s.dir && path.resolve(s.dir).toLowerCase() !== path.resolve(config.cwd).toLowerCase()) {
    s.stato = 'saltata';
    sveglie.salva(elenco);
    chatSystemMessage('La sveglia di Adam delle ' + sveglie.oraLeggibile(s.quando) + ' ("' + s.motivo + '") era per un altro ' +
      'progetto (' + s.dir + '): non l\'ho fatta suonare qui.', 'warn');
    return;
  }
  s.stato = 'suonata';
  s.suonata = Date.now();
  sveglie.salva(elenco);
  console.log('[Sveglia] ' + s.id + ': "' + s.motivo + '"');

  const av = nuovoAvanzamento('Sveglia di Adam: ' + accorciaTesto(s.motivo, 70), [
    ['pagina', s.guarda ? 'Riprovo ' + s.pagina + ' e prendo una schermata' : 'Nessuna pagina da riprovare'],
    ['attesa', 'Aspetto che la chat sia libera'],
    ['adam', 'Sveglio Adam con la sua domanda']
  ]);
  let rapporto = '';
  let immagini = [];
  if (s.guarda && misure.pagineDelProgetto(config.cwd).indexOf(s.pagina) !== -1 && analisiRuntime.disponibile()) {
    fase(av, 'pagina', 'corso');
    const r = await sondaPagina({ pagina: s.pagina, dir: config.cwd, base: baseAnteprima(),
      progresso: function (t) { fase(av, 'pagina', null, t); } }).catch(function (e) { return { errore: e.message }; });
    if (r.errore) fase(av, 'pagina', 'warn', 'non riuscita: ' + r.errore);
    else {
      rapporto = r.rapporto;
      immagini = misure.scegliSchermate(r).slice(0, 1);
      fase(av, 'pagina', misure.fattiDellaSonda(r).length ? 'warn' : 'ok', riassuntoMisura(r));
    }
  } else {
    fase(av, 'pagina', 'saltata', s.guarda ? 'pagina non disponibile' : 'solo la domanda');
  }

  // Si aspetta che la chat sia libera, fino a mezz'ora: la sveglia non interrompe nessuno.
  fase(av, 'attesa', 'corso');
  const limite = Date.now() + 30 * 60 * 1000;
  while ((chatBusy || sondaPreliminare) && Date.now() < limite) {
    await new Promise(function (r) { setTimeout(r, 2000); });
  }
  if (chatBusy || sondaPreliminare) {
    fase(av, 'attesa', 'err', 'la chat e\' rimasta occupata');
    chiudiAvanzamento(av, 'err', 'Sveglia non consegnata: la chat e\' rimasta occupata per mezz\'ora.');
    return;
  }
  fase(av, 'attesa', 'ok');
  fase(av, 'adam', 'corso');
  const esito = sendChatPromptConImmagini(sveglie.testoRisveglio(s, Date.now(), rapporto), immagini,
    { auto: true, attempt: 1, max: 1, reason: 'sveglia di Adam', istantanea: true });
  fase(av, 'adam', esito.ok ? 'ok' : 'err', esito.ok ? 'domanda consegnata' : esito.error);
  chiudiAvanzamento(av, esito.ok ? 'ok' : 'err', esito.ok ? 'Adam si e\' svegliato e controlla' : 'Sveglia non consegnata');
}

function ripristinaSveglie() {
  sveglie.inAttesa(sveglie.carica()).forEach(programmaSveglia);
}

app.get('/api/sveglie', (req, res) => {
  res.json({ sveglie: sveglie.carica().map(descriviSveglia) });
});

app.post('/api/sveglie', (req, res) => {
  const corpo = req.body || {};
  const elenco = sveglie.carica();
  const limite = sveglie.oltreILimite(elenco);
  if (limite) return res.status(429).json({ error: limite });
  const n = sveglie.nuovaSveglia({ tra: corpo.tra, motivo: corpo.motivo, pagina: corpo.pagina, guarda: corpo.guarda });
  if (n.errore) return res.status(400).json({ error: n.errore });
  if (n.sveglia.pagina && misure.pagineDelProgetto(config.cwd).indexOf(n.sveglia.pagina) === -1) {
    return res.status(400).json({ error: 'la pagina ' + n.sveglia.pagina + ' non c\'e\' nel progetto' });
  }
  n.sveglia.dir = config.cwd;
  elenco.push(n.sveglia);
  sveglie.salva(elenco);
  programmaSveglia(n.sveglia);
  chatSystemMessage('Adam si e\' programmato una sveglia per le ' + sveglie.oraLeggibile(n.sveglia.quando) + ': "' +
    n.sveglia.motivo + '"' + (n.sveglia.guarda ? ' (prima riprovero\' ' + n.sveglia.pagina + ')' : '') + '.', 'info');
  console.log('[Sveglia] Programmata ' + n.sveglia.id + ' per le ' + sveglie.oraLeggibile(n.sveglia.quando) + '.');
  res.json({ success: true, sveglia: descriviSveglia(n.sveglia) });
});

app.delete('/api/sveglie/:id', (req, res) => {
  const elenco = sveglie.carica();
  const s = elenco.find(function (x) { return x.id === req.params.id; });
  if (!s || s.stato !== 'in attesa') return res.status(404).json({ error: 'Nessuna sveglia in attesa con questo id' });
  s.stato = 'annullata';
  sveglie.salva(elenco);
  clearTimeout(timerSveglie.get(s.id));
  timerSveglie.delete(s.id);
  res.json({ success: true });
});

ripristinaSveglie();

// Chat salvate del progetto aperto: memoria che Adam puo' esplorare (strumenti/archivio-chat.js).
app.get('/api/chat-archivio', (req, res) => {
  archiviaChatOra();
  res.json({
    cartella: archivioChat.cartellaProgetto(config.cwd),
    corrente: conversazioneId + '.md',
    contesto: statoContesto(),
    chat: archivioChat.elenco(config.cwd)
  });
});

app.get('/api/chat-archivio/leggi', (req, res) => {
  const file = String(req.query.file || '');
  const testo = archivioChat.leggi(config.cwd, file);
  if (testo === null) return res.status(404).json({ error: 'Chat non trovata' });
  res.json({ file: file, testo: testo });
});

app.post('/api/chat-archivio/collega', (req, res) => {
  const file = String((req.body && req.body.file) || '');
  if (!archivioChat.collega(config.cwd, file, !!(req.body && req.body.collegata))) {
    return res.status(404).json({ error: 'Chat non trovata' });
  }
  // Il prompt di sistema elenca le chat collegate: vale dalla sessione successiva, che si
  // riavvia con --resume come per ogni aggiornamento della memoria.
  restartSessionsForMemory();
  res.json({ success: true, chat: archivioChat.elenco(config.cwd) });
});

// Collaudi del revisore per le pagine del progetto aperto, con il loro ultimo esito.
app.get('/api/collaudi', (req, res) => {
  const dir = config.cwd;
  const pagine = misure.pagineDelProgetto(dir).map(function (pagina) {
    const stato = collaudatore.caricaCollaudi(dir, pagina);
    const ritirati = stato.ritirati.map(function (n) { return n.toLowerCase(); });
    return {
      pagina: pagina,
      aggiornato: stato.aggiornato,
      collaudi: stato.collaudi.map(function (c) {
        return Object.assign({}, c, {
          esito: stato.esiti[c.nome] || null,
          validato: !!(stato.validati || {})[c.nome],
          ritirato: ritirati.indexOf(c.nome.toLowerCase()) !== -1
        });
      })
    };
  }).filter(function (p) { return p.collaudi.length > 0; });
  res.json({ revisore: revisoreDisponibile(), pagine: pagine });
});

// Sonda dei flussi a mano (pulsante "Esplora" nell'Anteprima): lo Studio prova la pagina, il
// modello dice alla cieca cosa promette la descrizione, lo Studio confronta, e le prove
// diventano collaudi rieseguibili senza modello. Qui il giudice e' l'utente: i falliti gli compaiono con il pulsante "Ritira",
// e niente va ad Adam da solo.
let esploraInCorso = false;
app.post('/api/esplora', async (req, res) => {
  const dir = config.cwd;
  const pagina = String((req.body && req.body.pagina) || '');
  if (misure.pagineDelProgetto(dir).indexOf(pagina) === -1) return res.status(404).json({ error: 'Pagina non trovata nel progetto' });
  const revisore = revisoreDisponibile();
  if (!revisore.ok) return res.status(400).json({ error: 'Esploratrice non disponibile: ' + revisore.motivo });
  if (esploraInCorso) return res.status(409).json({ error: 'C\'e\' gia\' un\'esplorazione in corso.' });
  if (chatBusy || sondaPreliminare || esameInCorso) return res.status(409).json({ error: 'Il modello e\' occupato (Adam o un esame): riprova quando ha finito.' });
  if (!analisiRuntime.disponibile()) return res.status(503).json({ error: 'Serve il browser di controllo.' });
  esploraInCorso = true;
  const av = nuovoAvanzamento('Sonda dei flussi: ' + pagina, [
    ['esplora', 'Provo i flussi e li confronto con cio\' che promette la descrizione'],
    ['collaudi', 'Rieseguo le prove come collaudi, senza modello']
  ]);
  try {
    fase(av, 'esplora', 'corso');
    const ex = await esploratrice.esplora({
      dir: dir, pagina: pagina, descrizione: esploratrice.descrizioneDelProgetto(dir),
      richiesta: String((req.body && req.body.richiesta) || ''),
      baseUrl: baseUrlForProvider('ollama'),
      modello: config.revisoreModel || config.model,
      progresso: function (t) { fase(av, 'esplora', null, t); }
    });
    fase(av, 'esplora', ex.errore && !ex.collaudi.length ? 'err' : 'ok',
      ex.percorso.length + ' prove misurate, ' + ex.difetti.length + ' contro la descrizione' + (ex.errore ? ' (' + ex.errore + ')' : ''));
    let stato = collaudatore.caricaCollaudi(dir, pagina);
    const nuovi = nomiDistinti(ex.collaudi, stato.collaudi);
    const prova = await provaCollaudi(av, 'collaudi', dir, pagina, nuovi, {});
    if (prova) {
      stato = collaudatore.unisciCollaudi(stato, nuovi);
      collaudatore.registraEsiti(stato, prova.esiti);
      collaudatore.salvaCollaudi(stato);
    }
    chiudiAvanzamento(av, prova && prova.fatti.falliti.length ? 'warn' : (prova ? 'ok' : 'err'),
      prova ? prova.fatti.superati.length + ' funzioni confermate, ' + prova.fatti.falliti.length + ' collaudi falliti' : 'Collaudi non eseguiti');
    chatSystemMessage('La sonda dei flussi ha provato ' + pagina + ' ' + ex.percorso.length + ' volte, ogni volta da capo:\n' +
      elencoPuntato(ex.percorso.map(function (s) { return s.passo + ' → ' + s.dopo; }).slice(0, 10)) +
      (ex.difetti.length ? '\nContro la descrizione:\n' + elencoPuntato(ex.difetti.map(function (d) { return d.descrizione + (d.promessa ? ' (promessa: "' + d.promessa + '")' : ''); })) : '\nNiente contro la descrizione.') +
      (prova ? '\nCollaudi dal percorso: ' + prova.fatti.superati.length + ' superati, ' + prova.fatti.falliti.length + ' falliti.' : ''), 'info');
    if (prova && prova.fatti.falliti.length) {
      const file = path.join(dir, pagina);
      chatBroadcast('verify', {
        state: 'falliti', collaudi: true, pagina: pagina,
        nomi: prova.fatti.falliti.map(nomeDelFatto).filter(Boolean),
        failures: prova.fatti.falliti.map(function (f) { return { file: file, error: f }; })
      });
    }
    console.log('[Esploratrice] ' + pagina + ': ' + ex.percorso.length + ' prove, ' + ex.difetti.length + ' difetti, ' + nuovi.length + ' collaudi.');
    res.json({ success: true, percorso: ex.percorso, difetti: ex.difetti, collaudi: nuovi,
      esiti: prova ? prova.esiti.map(function (e) { return { nome: e.nome, esito: e.esito }; }) : [], errore: ex.errore || null });
  } catch (e) {
    chiudiAvanzamento(av, 'err', 'Esplorazione non riuscita: ' + e.message);
    res.status(500).json({ error: e.message });
  } finally {
    esploraInCorso = false;
  }
});

// Il contrario del ritiro: un collaudo ritirato (dall'utente o dal giudizio) torna attivo.
app.post('/api/collaudi/rimetti', (req, res) => {
  const pagina = String((req.body && req.body.pagina) || '');
  const nomi = [].concat((req.body && (req.body.nomi || req.body.nome)) || []).map(function (n) { return String(n).toLowerCase(); });
  if (!pagina || !nomi.length) return res.status(400).json({ error: 'Servono pagina e nomi dei collaudi' });
  if (misure.pagineDelProgetto(config.cwd).indexOf(pagina) === -1) return res.status(404).json({ error: 'Pagina non trovata nel progetto' });
  const stato = collaudatore.caricaCollaudi(config.cwd, pagina);
  const prima = stato.ritirati.length;
  stato.ritirati = stato.ritirati.filter(function (n) { return nomi.indexOf(n.toLowerCase()) === -1; });
  if (stato.ritirati.length === prima) return res.status(404).json({ error: 'Nessuno di questi collaudi era ritirato' });
  try { collaudatore.salvaCollaudi(stato); } catch (e) { return res.status(500).json({ error: e.message }); }
  console.log('[Collaudi] Rimessi su ' + pagina + ': ' + nomi.join(', '));
  res.json({ success: true, ritirati: stato.ritirati });
});

// "E' voluto": l'utente ha chiesto proprio quel cambiamento, il collaudo non va piu' eseguito.
app.post('/api/collaudi/ritira', (req, res) => {
  const pagina = String((req.body && req.body.pagina) || '');
  const nomi = [].concat((req.body && (req.body.nomi || req.body.nome)) || [])
    .map(function (n) { return String(n); }).filter(Boolean);
  if (!pagina || !nomi.length) return res.status(400).json({ error: 'Servono pagina e nomi dei collaudi' });
  if (misure.pagineDelProgetto(config.cwd).indexOf(pagina) === -1) return res.status(404).json({ error: 'Pagina non trovata nel progetto' });
  const stato = collaudatore.caricaCollaudi(config.cwd, pagina);
  nomi.forEach(function (n) { collaudatore.ritira(stato, n); });
  try {
    collaudatore.salvaCollaudi(stato);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
  const file = path.join(config.cwd, pagina);
  nomi.forEach(function (n) {
    risolviFatto(file, 'Regressione «' + n + '»');
    risolviFatto(file, 'Collaudo fallito «' + n + '»');
  });
  // Anche il ciclo di correzione in corso li dimentica: un collaudo ritirato non si esegue
  // piu', e senza toglierlo dai fatti la prossima misura lo darebbe per "risolto".
  const s = sondaDaRipetere;
  if (s && s.pagina === pagina && path.resolve(s.dir).toLowerCase() === path.resolve(config.cwd).toLowerCase()) {
    const via = new Set(nomi.map(function (n) { return n.toLowerCase(); }));
    s.fatti = s.fatti.filter(function (f) {
      const m = String(f).match(/^(?:Collaudo fallito|Regressione) «([^»]*)»/);
      return !(m && via.has(m[1].toLowerCase()));
    });
    if (s.focusTesto && s.fatti.indexOf(s.focusTesto) === -1) {
      const nuovo = misure.scegliFocus(s.fatti, null);
      s.focus = nuovo ? misure.chiaveFatto(nuovo) : null;
      s.focusTesto = nuovo;
    }
    if (!s.fatti.length && !s.inCorso) annullaSonda('collaudi ritirati: non resta niente da correggere');
  }
  console.log('[Collaudi] Ritirati su ' + pagina + ': ' + nomi.join(', '));
  res.json({ success: true, ritirati: stato.ritirati, issues: knownIssues });
});

// Serve gli screenshot catturati, perche' la UI possa mostrarli.
// ============================================================
// IL PANNELLO 3D (colonna di destra, scheda "3D" accanto a "File dal vivo")
// Richiesta dell'utente (18/9/2026): il personaggio riggato di Unity collegato a Blender, con il
// rendering 3D in un pannello accanto a quello del file dal vivo. Il visore (public/vista-3d.html)
// mostra i GLB del progetto; Blender (strumenti/personaggio.js) li prepara e fa le immagini di qualita'.
// ============================================================
let blenderOccupato = false;     // un lavoro di Blender alla volta: si contendono la scheda video con Adam

function dentroAlProgetto(percorso) {
  if (!config.cwd || !percorso) return false;
  const cartella = path.resolve(config.cwd).toLowerCase();
  const file = path.resolve(String(percorso)).toLowerCase();
  return file.indexOf(cartella + path.sep) === 0;
}

function numeri(lista, quanti) {
  if (!Array.isArray(lista) || lista.length !== quanti) return null;
  const n = lista.map(Number);
  return n.every(function (x) { return isFinite(x); }) ? n : null;
}

app.get('/api/vista3d/modelli', (req, res) => {
  if (!config.cwd) return res.json([]);
  try { res.json(personaggio3d.modelliDelProgetto(config.cwd)); } catch (e) { res.json([]); }
});

app.get('/api/vista3d/file', (req, res) => {
  const percorso = String(req.query.percorso || '');
  if (!/\.(glb|gltf)$/i.test(percorso) || !dentroAlProgetto(percorso)) return res.status(403).end();
  if (!fs.existsSync(percorso)) return res.status(404).end();
  res.setHeader('content-type', /\.glb$/i.test(percorso) ? 'model/gltf-binary' : 'model/gltf+json');
  res.setHeader('cache-control', 'no-cache');
  fs.createReadStream(percorso).pipe(res);
});

app.post('/api/vista3d/rendi', async (req, res) => {
  const corpo = req.body || {};
  const percorso = String(corpo.percorso || '');
  if (!/\.(glb|gltf)$/i.test(percorso) || !dentroAlProgetto(percorso) || !fs.existsSync(percorso)) {
    return res.status(400).json({ ok: false, errore: 'modello non trovato nel progetto' });
  }
  if (blenderOccupato) return res.status(409).json({ ok: false, errore: 'Blender sta gia\' lavorando: riprova tra poco' });
  blenderOccupato = true;
  try {
    const r = await personaggio3d.rendi(percorso, {
      camera: numeri(corpo.camera, 3), bersaglio: numeri(corpo.bersaglio, 3),
      fov: Math.max(10, Math.min(120, Number(corpo.fov) || 40)),
      animazione: typeof corpo.animazione === 'string' ? corpo.animazione.slice(0, 80) : null,
      tempo: Math.max(0, Math.min(1, Number(corpo.tempo) || 0)),
      larghezza: Math.max(64, Math.min(1280, Number(corpo.larghezza) || 640)),
      altezza: Math.max(64, Math.min(1280, Number(corpo.altezza) || 640))
    });
    if (r.ok) r.url = '/api/screenshot/' + path.basename(r.png);
    res.json(r);
  } catch (e) {
    res.json({ ok: false, errore: e.message });
  } finally {
    blenderOccupato = false;
  }
});

app.post('/api/vista3d/prepara', async (req, res) => {
  const modello = String((req.body && req.body.fbx) || '').trim();
  if (!config.cwd) return res.status(400).json({ ok: false, errore: 'nessuna cartella di lavoro' });
  if (!/\.(fbx|glb|gltf)$/i.test(modello) || !fs.existsSync(modello)) {
    return res.status(400).json({ ok: false, errore: 'file non trovato o non e\' un .fbx/.glb: ' + modello });
  }
  if (blenderOccupato) return res.status(409).json({ ok: false, errore: 'Blender sta gia\' lavorando: riprova tra poco' });
  blenderOccupato = true;
  try {
    const r = await personaggio3d.prepara(modello, path.join(config.cwd, personaggio3d.CARTELLA_USCITA));
    if (r.ok) chatBroadcast('files-changed', { file: r.glb });
    res.json(r);
  } catch (e) {
    res.json({ ok: false, errore: e.message });
  } finally {
    blenderOccupato = false;
  }
});

app.get('/api/screenshot/:nome', (req, res) => {
  const nome = path.basename(req.params.nome);
  const file = path.join(os.tmpdir(), 'studio-screenshot', nome);
  if (!fs.existsSync(file)) return res.status(404).end();
  res.setHeader('content-type', ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' })[
    path.extname(nome).toLowerCase()] || 'image/png');
  fs.createReadStream(file).pipe(res);
});

app.post('/api/code-map', async (req, res) => {
  const cartella = (req.body && req.body.dir) || config.cwd;
  let mappa;
  try {
    mappa = mappaCodice(cartella);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  let nodiCreati = 0;
  try {
    salvaNodoProgetto('Mappa del codice', 'data', riassumiMappa(mappa), ['analisi', 'mappa']);
    nodiCreati = mappaVersoMemoriaVisiva(mappa);
    restartSessionsForMemory();
    console.log('[Mappa] ' + mappa.schede.length + ' file, ' +
      mappa.collegamenti.length + ' collegamenti, ' + nodiCreati + ' nodi nel diagramma.');
  } catch (e) {
    console.error('[Mappa] Salvataggio non riuscito:', e.message);
  }

  res.json({
    success: true,
    schede: mappa.schede,
    collegamenti: mappa.collegamenti,
    nodiNelDiagramma: nodiCreati
  });
});

app.post('/api/scan', async (req, res) => {
  const cartella = (req.body && req.body.dir) || config.cwd;
  let esito;
  try {
    esito = await analizzaProgetto(cartella);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  console.log('[Analisi] ' + esito.fileEsaminati + ' file, ' +
    esito.problemi.length + ' problemi (' + esito.durataMs + ' ms)');

  esito.problemi.forEach(function (p) {
    rememberIssue({ file: p.file, error: '[' + p.tipo + '] ' + p.messaggio });
  });

  // Le scoperte vanno RICORDATE, non solo elencate: finiscono nella memoria di
  // progetto, quindi rientrano nel prompt di sistema dei turni successivi. Cosi'
  // Adam sa com'e' fatto il progetto e quali problemi restano aperti, anche in una
  // conversazione nuova.
  try {
    salvaNodoProgetto('Struttura del progetto', 'data',
      riassumiStruttura(esito, cartella), ['analisi', 'struttura']);

    const aperti = knownIssues.filter(function (i) { return !i.resolved; });
    const testoProblemi = aperti.length === 0 ? '' :
      aperti.slice(0, 15).map(function (i) {
        return path.basename(i.file) + ': ' + i.error.split('\n')[0].slice(0, 120);
      }).join(' | ');
    salvaNodoProgetto('Problemi noti del progetto', 'rule',
      testoProblemi, ['analisi', 'problemi']);

    console.log('[Analisi] Struttura e problemi salvati nella memoria di progetto.');
    // Senza questo la memoria appena scritta non entrerebbe nel prompt fino al
    // riavvio successivo: Adam la "ricorderebbe" solo la volta dopo.
    restartSessionsForMemory();
  } catch (e) {
    console.error('[Analisi] Salvataggio in memoria non riuscito:', e.message);
  }

  // Se richiesto, i problemi vengono passati ad Adam perche' li corregga, con lo
  // stesso ciclo della verifica automatica (bounded, annullabile, tracciato).
  if (req.body && req.body.fix && esito.problemi.length > 0) {
    const elenco = esito.problemi.map(function (p) {
      return 'FILE: ' + p.file + '\nPROBLEMA (' + p.tipo + '): ' + p.messaggio;
    }).join('\n\n');
    autoFixCount = 0;
    sendChatPrompt(
      'Ho analizzato tutto il progetto e ho trovato ' + esito.problemi.length +
      (esito.problemi.length === 1 ? ' problema' : ' problemi') + '.\n\n' + elenco +
      '\n\nCorreggili TUTTI modificando i file con Edit o Write. Non limitarti a ' +
      'spiegare: applica le correzioni. Se un problema non e\' reale, dillo e spiega perche\'.',
      { auto: true, attempt: 1, max: massimoTentativiVerifica(), reason: 'analisi del progetto' });
  }

  res.json({
    success: true,
    fileEsaminati: esito.fileEsaminati,
    troncato: esito.troncato,
    durataMs: esito.durataMs,
    problemi: esito.problemi,
    issues: knownIssues
  });
});

// ============================================================
// ANTEPRIMA
// Serve i file della cartella di lavoro sotto /preview, cosi' la pagina finisce in
// un iframe della STESSA origine dello Studio. E' la differenza che conta: essendo
// same-origin possiamo iniettare un piccolo script che rimanda errori e console al
// pannello, cosa impossibile con un file:// o un'origine diversa.
// ============================================================

const TIPI_MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.txt': 'text/plain; charset=utf-8'
};

// Ponte iniettato nella pagina: rimanda al pannello errori e messaggi di console.
// Serve a far vedere all'utente cosa NON va senza aprire gli strumenti di sviluppo.
const PONTE_ANTEPRIMA = `<script>
(function () {
  // Le righe vanno in due posti: al pannello dello Studio (lo legge l'utente) e allo
  // Studio stesso (lo legge Adam). Prima esisteva solo il pannello, e Adam era ridotto a
  // chiedere "cosa dice la console?" a chi non sa aprire gli strumenti di sviluppo.
  var sessione = String(Date.now()) + '-' + Math.random().toString(16).slice(2);
  var coda = [];
  var scartate = 0;
  var timer = null;
  function manda(tipo, testo) {
    var riga = String(testo).slice(0, 500);
    try {
      parent.postMessage({ __anteprima: true, tipo: tipo, testo: riga }, '*');
    } catch (e) {}
    try { accoda(tipo, riga); } catch (e) {}
  }
  // A gruppi, non una alla volta: un gioco puo' stampare sessanta righe al secondo.
  function accoda(tipo, testo) {
    if (coda.length >= 50) { scartate++; return; }
    coda.push({ tipo: tipo, testo: testo.slice(0, 300) });
    if (!timer) timer = setTimeout(spedisci, 700);
  }
  function spedisci() {
    timer = null;
    if (!coda.length) return;
    var corpo = JSON.stringify({ sessione: sessione, pagina: location.pathname, voci: coda, scartate: scartate });
    coda = [];
    scartate = 0;
    try {
      if (navigator.sendBeacon('/api/console-anteprima', new Blob([corpo], { type: 'application/json' }))) return;
    } catch (e) {}
    try {
      fetch('/api/console-anteprima', { method: 'POST', headers: { 'content-type': 'application/json' }, body: corpo, keepalive: true });
    } catch (e) {}
  }
  // Chiudendo o ricaricando la pagina, l'ultimo gruppo parte lo stesso: spesso e' quello
  // con l'errore che ha fatto smettere tutto.
  addEventListener('pagehide', function () { try { spedisci(); } catch (e) {} });
  addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') { try { spedisci(); } catch (e) {} } });
  ['error', 'warn', 'log'].forEach(function (livello) {
    var originale = console[livello];
    console[livello] = function () {
      try {
        manda(livello, Array.prototype.map.call(arguments, function (a) {
          if (a instanceof Error) return a.message;
          if (typeof a === 'object') { try { return JSON.stringify(a); } catch (e) { return String(a); } }
          return String(a);
        }).join(' '));
      } catch (e) {}
      return originale.apply(console, arguments);
    };
  });
  window.addEventListener('error', function (e) {
    manda('error', (e.message || 'errore') + (e.filename ? ' [' + e.filename.split('/').pop() + ':' + e.lineno + ']' : ''));
  });
  window.addEventListener('unhandledrejection', function (e) {
    manda('error', 'Promise non gestita: ' + (e.reason && e.reason.message ? e.reason.message : e.reason));
  });
  // Questo lo dice lo Studio, non la pagina: va al pannello dell'utente e basta, se no
  // Adam si ritroverebbe una riga inutile in mezzo alla console a ogni caricamento.
  try { parent.postMessage({ __anteprima: true, tipo: 'info', testo: 'Anteprima collegata.' }, '*'); } catch (e) {}
})();
<\/script>`;

app.get(/^\/preview(\/.*)?$/, (req, res) => {
  const radice = config.cwd;
  let rel = decodeURIComponent(req.path.replace(/^\/preview/, '')) || '/';
  if (rel === '/' || rel === '') rel = '/' + (req.query.pagina || 'index.html');

  const file = path.join(radice, rel);
  // Nessuna uscita dalla cartella di lavoro.
  if (!path.resolve(file).startsWith(path.resolve(radice))) {
    return res.status(403).send('Percorso fuori dalla cartella di lavoro.');
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return res.status(404).send('<pre style="font-family:monospace;padding:20px;color:#888">' +
      'File non trovato nell\'anteprima:\n' + rel + '</pre>');
  }

  const ext = path.extname(file).toLowerCase();
  res.setHeader('Cache-Control', 'no-store');

  if (ext === '.html' || ext === '.htm') {
    let html = fs.readFileSync(file, 'utf8');
    // Il ponte va per primo, cosi' cattura anche gli errori degli script successivi.
    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head[^>]*>/i, function (m) { return m + PONTE_ANTEPRIMA; });
    } else {
      html = PONTE_ANTEPRIMA + html;
    }
    res.setHeader('content-type', TIPI_MIME['.html']);
    return res.send(html);
  }

  res.setHeader('content-type', TIPI_MIME[ext] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

// ============================================================
// LA CONSOLE DELL'ANTEPRIMA, CIOE' QUELLA CHE VEDE L'UTENTE
//
// Il ponte qui sopra manda ogni riga anche allo Studio, che ne tiene le ultime: cosi'
// quando l'utente segnala un bug, Adam legge quello che la pagina ha stampato mentre la
// usava lui, invece di chiedergli di aprire gli strumenti di sviluppo e di copiarla.
// Messaggi uguali raggruppati (i numeri non contano: punteggio e tempo cambiano sempre).
const MAX_CONSOLE_UTENTE = 40;
const consoleUtente = { sessione: '', pagina: '', voci: [], indice: new Map(), scartate: 0, inizio: 0 };

function azzeraConsoleUtente(sessione, pagina) {
  consoleUtente.sessione = sessione || '';
  consoleUtente.pagina = pagina || '';
  consoleUtente.voci = [];
  consoleUtente.indice = new Map();
  consoleUtente.scartate = 0;
  consoleUtente.inizio = Date.now();
}

function aggiungiConsoleUtente(tipo, testo) {
  const t = String(testo === undefined || testo === null ? '' : testo).replace(/\s+/g, ' ').trim();
  if (!t) return;
  const genere = tipo === 'error' ? 'errore' : (tipo === 'warn' || tipo === 'warning' ? 'avviso' : 'log');
  const chiave = genere + '|' + t.replace(/\d+(?:[.,]\d+)?/g, '#').slice(0, 200);
  const vista = consoleUtente.indice.get(chiave);
  if (vista) {
    vista.volte++;
    vista.quando = Date.now();
    return;
  }
  if (consoleUtente.voci.length >= MAX_CONSOLE_UTENTE) {
    consoleUtente.scartate++;
    return;
  }
  const voce = { tipo: genere, testo: t.slice(0, 300), volte: 1, quando: Date.now() };
  consoleUtente.indice.set(chiave, voce);
  consoleUtente.voci.push(voce);
}

// Il blocco da mettere sotto gli occhi di Adam. Vuoto se la pagina non ha stampato niente:
// una sezione vuota nel prompt e' solo contesto sprecato.
function testoConsoleUtente(soloProblemi) {
  const voci = consoleUtente.voci.filter(function (v) { return soloProblemi ? v.tipo !== 'log' : true; });
  if (!voci.length) return '';
  const ordine = { errore: 0, avviso: 1, log: 2 };
  const peso = function (v) { return ordine[v.tipo] === undefined ? 2 : ordine[v.tipo]; };
  const righe = voci.slice().sort(function (a, b) { return peso(a) - peso(b); }).slice(0, 12)
    .map(function (v) { return '  [' + v.tipo + '] ' + v.testo + (v.volte > 1 ? '  (x' + v.volte + ')' : ''); });
  return 'LA CONSOLE DELLA PAGINA CHE L\'UTENTE HA APERTO NELL\'ANTEPRIMA (' +
    (consoleUtente.pagina || 'anteprima') + '), registrata dallo Studio mentre la usava:\n' + righe.join('\n');
}

// La riceve il ponte dell'Anteprima. Una pagina ricaricata e' una sessione nuova: le
// righe di prima non c'entrano piu' con quello che l'utente sta guardando adesso.
app.post('/api/console-anteprima', (req, res) => {
  const corpo = req.body || {};
  if (!corpo.sessione || corpo.sessione !== consoleUtente.sessione) azzeraConsoleUtente(corpo.sessione, corpo.pagina);
  (Array.isArray(corpo.voci) ? corpo.voci.slice(0, 50) : []).forEach(function (v) {
    aggiungiConsoleUtente(v && v.tipo, v && v.testo);
  });
  consoleUtente.scartate += Number(corpo.scartate) || 0;
  res.json({ ok: true, tenute: consoleUtente.voci.length });
});

// La legge Adam con Bash (strumenti/console-utente.js) e chiunque voglia guardarla.
app.get('/api/console-anteprima', (req, res) => {
  res.json({
    pagina: consoleUtente.pagina,
    da: consoleUtente.inizio ? new Date(consoleUtente.inizio).toISOString() : null,
    scartate: consoleUtente.scartate,
    voci: consoleUtente.voci
  });
});

// Elenco delle pagine apribili in anteprima.
app.get('/api/preview-pages', (req, res) => {
  const radice = config.cwd;
  res.json({ cwd: radice, pagine: misure.pagineDelProgetto(radice) });
});

// 5f. Problemi noti trovati dalla verifica automatica
app.get('/api/issues', (req, res) => {
  res.json({
    issues: knownIssues,
    open: knownIssues.filter(i => !i.resolved).length,
    autoVerify: config.autoVerify !== false,
    projectTestCommand: config.projectTestCommand || ''
  });
});

app.post('/api/issues/clear', (req, res) => {
  cancelPendingFix('registro dei problemi svuotato');
  annullaSonda('registro dei problemi svuotato');
  const before = knownIssues.length;
  knownIssues = req.body && req.body.all
    ? []
    : knownIssues.filter(i => !i.resolved);
  res.json({ success: true, removed: before - knownIssues.length, issues: knownIssues });
});

// Verifica su richiesta: utile per controllare un progetto senza aspettare un turno.
app.post('/api/verify', async (req, res) => {
  const files = Array.isArray(req.body && req.body.files) ? req.body.files : [];
  files.forEach(f => turnTouchedFiles.add(f));
  await verifyAndMaybeFix();
  res.json({ success: true, issues: knownIssues });
});

// 6. Restart Claude process
app.post('/api/restart', (req, res) => {
  startClaudeProcess();
  res.json({ success: true, running: true });
});

app.get('/api/config', (_req, res) => {
  // Il client legge solo questa preferenza qui; le chiavi non vengono mai restituite.
  res.json({ disableCoder: !!config.disableCoder });
});

app.post('/api/config', (req, res) => {
  const { apiKey, authToken, apiKeys, customBaseUrl, customEndpoints, provider, modelTransport, modelGroup, dangerouslySkipPermissions, fontSize, theme, model, baseUrl, autoAcceptFolder, flatUiMode } = req.body;

  if (model !== undefined && String(model).trim() && !modelloChatCompatibile(String(model).trim())) {
    return res.status(400).json({
      success: false,
      error: 'Il modello selezionato non e\' un modello chat/generativo (OCR, embedding, reranker, audio e moderazione non possono pilotare Adam).'
    });
  }
  if (req.body.coderModel !== undefined && String(req.body.coderModel).trim() &&
      !modelloChatCompatibile(String(req.body.coderModel).trim())) {
    return res.status(400).json({ success: false, error: 'Il modello Coder selezionato non supporta una chat di programmazione.' });
  }

  const oldApiKey = config.apiKey;
  const oldAuthToken = config.authToken;
  const oldProvider = config.provider;
  const oldModel = config.model;
  const oldBaseUrl = config.baseUrl;
  const oldSkip = config.dangerouslySkipPermissions;
  const oldAutoAccept = config.autoAcceptFolder;
  const oldFlatUi = config.flatUiMode;
  const oldEffort = config.effort;
  const oldEngine = config.engine || 'claude';
  const oldPermMode = config.permissionMode || 'acceptEdits';

  if (apiKeys && typeof apiKeys === 'object') {
    if (!config.apiKeys) config.apiKeys = {};
    Object.keys(apiKeys).forEach(function (key) {
      const value = typeof apiKeys[key] === 'string' ? apiKeys[key].trim() : '';
      // Un campo vuoto nella UI significa "non cambiare": le chiavi esistenti non
      // vengono piu' rimandate al browser. Per cancellare si usa clearApiKeys.
      if (value) config.apiKeys[key] = value;
    });
    if (apiKeys.anthropic && String(apiKeys.anthropic).trim()) config.apiKey = String(apiKeys.anthropic).trim();
  }
  if (Array.isArray(req.body.clearApiKeys)) {
    req.body.clearApiKeys.forEach(function (providerName) {
      if (config.apiKeys && Object.prototype.hasOwnProperty.call(config.apiKeys, providerName)) {
        config.apiKeys[providerName] = '';
      }
      if (providerName === 'anthropic') config.apiKey = '';
    });
  }
  if (customBaseUrl !== undefined) config.customBaseUrl = customBaseUrl;
  if (Array.isArray(customEndpoints)) {
    const oldEndpointKeys = new Map((config.customEndpoints || []).map(function (endpoint) {
      return [String(endpoint.id || ''), String(endpoint.apiKey || '')];
    }));
    config.customEndpoints = customEndpoints.map(ep => ({
      id: ep.id || 'endpoint_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      name: String(ep.name || 'Endpoint').trim(),
      baseUrl: String(ep.baseUrl || '').trim(),
      apiKey: String(ep.apiKey || '').trim() || oldEndpointKeys.get(String(ep.id || '')) || ''
    })).filter(ep => ep.baseUrl);
  }
  if (apiKey !== undefined && String(apiKey).trim()) {
    config.apiKey = String(apiKey).trim();
    if (!config.apiKeys) config.apiKeys = {};
    config.apiKeys.anthropic = config.apiKey;
  }
  if (authToken !== undefined && String(authToken).trim()) config.authToken = String(authToken).trim();
  if (req.body.clearAuthToken === true) config.authToken = '';
  let providerChanged = false;
  const validTransports = Array.from(new Set(
    MODEL_PROVIDER_REGISTRY.map(function (entry) { return entry.transport; }).concat(['ollama', 'fcc'])
  ));
  if (provider !== undefined && validTransports.includes(provider)) {
    providerChanged = (provider !== oldProvider);
    config.provider = provider;
  }
  if (modelTransport !== undefined && validTransports.includes(String(modelTransport))) {
    config.modelTransport = String(modelTransport);
  } else if (provider !== undefined && validTransports.includes(provider)) {
    config.modelTransport = provider;
  }
  if (modelGroup !== undefined && /^[a-z0-9][a-z0-9_-]*$/i.test(String(modelGroup))) {
    config.modelGroup = String(modelGroup).toLowerCase();
  }
  if (req.body.engine !== undefined && ['claude', 'opencode'].includes(req.body.engine)) {
    // Override manuale del motore dalla scheda Impostazioni.
    config.engine = req.body.engine;
  } else if (providerChanged) {
    // Motore automatico quando CAMBIA il provider: i modelli Claude/Anthropic e i
    // modelli locali girano su Claude Code (via proxy); i provider multi-modello che
    // OpenCode gestisce nativamente (OpenRouter, NVIDIA NIM, Ashna) girano su OpenCode.
    // Gli altri provider esterni (Mistral, Groq, DeepSeek, ...) restano su Claude Code,
    // perche' OpenCode non li ha nel proprio opencode.json.
    const OPencode_PROVIDERS = ['openrouter', 'nvidia', 'ashna'];
    config.engine = OPencode_PROVIDERS.indexOf(config.provider) !== -1 ? 'opencode' : 'claude';
  }
  if (req.body.autoContinue !== undefined) config.autoContinue = !!req.body.autoContinue;
  if (req.body.effort !== undefined && EFFORT_LEVELS.indexOf(req.body.effort) !== -1) {
    config.effort = req.body.effort;
  }
  if (req.body.autoVerify !== undefined) config.autoVerify = !!req.body.autoVerify;
  if (req.body.revisore !== undefined) config.revisore = !!req.body.revisore;
  if (req.body.revisoreModel !== undefined) config.revisoreModel = String(req.body.revisoreModel || '').trim();
  if (req.body.esploratrice !== undefined) config.esploratrice = !!req.body.esploratrice;
  if (req.body.projectTestCommand !== undefined) {
    config.projectTestCommand = String(req.body.projectTestCommand || '').trim();
  }
  if (req.body.autoFixMax !== undefined) {
    config.autoFixMax = Math.max(0, Math.min(20, Number(req.body.autoFixMax) || 0));
  }
  if (req.body.autoContinueMax !== undefined) {
    config.autoContinueMax = Math.max(0, Math.min(20, Number(req.body.autoContinueMax) || 0));
  }
  const oldAutoCompatta = config.autoCompatta;
  const oldMaxOutput = config.maxOutputTokens;
  if (req.body.autoCompatta !== undefined) config.autoCompatta = !!req.body.autoCompatta;
  if (req.body.maxOutputTokens !== undefined) {
    config.maxOutputTokens = Math.max(0, Math.min(32000, Number(req.body.maxOutputTokens) || 0));
  }
  // Non consentiamo piu' alla UI di disattivare i permessi nativi del motore.
  config.dangerouslySkipPermissions = false;
  // Modalità di autorizzazione: default=acceptEdits, bypassPermissions richiede conferma
  const validPermModes = ['default', 'acceptEdits', 'bypassPermissions'];
  if (req.body.permissionMode !== undefined && validPermModes.includes(req.body.permissionMode)) {
    config.permissionMode = req.body.permissionMode;
  }
  if (fontSize !== undefined) config.fontSize = Number(fontSize);
  if (theme !== undefined) config.theme = theme;
  if (req.body.coderModel !== undefined) config.coderModel = String(req.body.coderModel || '').trim();
  if (req.body.coderProvider !== undefined) {
    const coderProvider = String(req.body.coderProvider || '').trim().toLowerCase();
    config.coderProvider = !coderProvider || validTransports.includes(coderProvider) ? coderProvider : '';
  }
  if (req.body.coderGroup !== undefined) {
    const coderGroup = String(req.body.coderGroup || '').trim().toLowerCase();
    config.coderGroup = !coderGroup || /^[a-z0-9][a-z0-9_-]*$/.test(coderGroup) ? coderGroup : '';
  }
  if (req.body.disableCoder !== undefined) config.disableCoder = !!req.body.disableCoder;
  if (model !== undefined) config.model = model;
  if (req.body.visionModel !== undefined) config.visionModel = String(req.body.visionModel || '').trim();
  if (baseUrl !== undefined) config.baseUrl = baseUrl;
  if (autoAcceptFolder !== undefined) config.autoAcceptFolder = !!autoAcceptFolder;
  if (flatUiMode !== undefined) config.flatUiMode = !!flatUiMode;

  saveConfig();
  refreshRemoteModelsCache().catch(() => {});

  if (whatsappBridge) {
    whatsappBridge.options.modello = config.model || 'qwen3.5-studio:9b';
    whatsappBridge.options.baseUrl = baseUrlForProvider('ollama');
    whatsappBridge.options.apiKey = config.apiKey || '';
    whatsappBridge.options.authToken = config.authToken || '';
  }

  const needsRestart = config.apiKey !== oldApiKey ||
    config.authToken !== oldAuthToken ||
    (provider !== undefined && provider !== oldProvider) ||
    (model !== undefined && model !== oldModel) ||
    (baseUrl !== undefined && baseUrl !== oldBaseUrl) ||
    (req.body.engine !== undefined && req.body.engine !== oldEngine) ||
    (autoAcceptFolder !== undefined && !!autoAcceptFolder !== !!oldAutoAccept) ||
    (flatUiMode !== undefined && !!flatUiMode !== !!oldFlatUi) ||
    (req.body.effort !== undefined && req.body.effort !== oldEffort) ||
    (req.body.permissionMode !== undefined && req.body.permissionMode !== oldPermMode) ||
    // I parametri di compattazione vivono nell'ambiente della sessione: se cambiano, va riavviata.
    (req.body.autoCompatta !== undefined && !!config.autoCompatta !== !!oldAutoCompatta) ||
    (req.body.maxOutputTokens !== undefined && config.maxOutputTokens !== oldMaxOutput);

  if (needsRestart) {
    // Rileviamo la finestra del nuovo modello PRIMA di riavviare, cosi' la sessione nasce gia' con i
    // parametri di compattazione giusti (senza, li otterrebbe solo al riavvio successivo).
    aggiornaLimiteContesto().catch(function () {}).then(function () {
      startClaudeProcess();
      startChatProcess({ resume: chatSessionId, keepHistory: !!chatSessionId });
    });
  } else if (chatSessionInfo) {
    chatSessionInfo.coderModel = modelloCoderConfigurato();
    chatSessionInfo.coderProvider = config.coderProvider || '';
    chatSessionInfo.coderGroup = config.coderGroup || '';
    chatSessionInfo.visionModel = config.visionModel || '';
    chatSessionInfo.resolvedVisionModel = modelloVisioneConfigurato();
    chatBroadcast('session', { info: chatSessionInfo });
  }

  res.json({
    success: true,
    config: {
      dangerouslySkipPermissions: config.dangerouslySkipPermissions,
      fontSize: config.fontSize,
      theme: config.theme,
      provider: config.provider,
      modelTransport: config.modelTransport || config.provider,
      modelGroup: config.modelGroup || '',
      engine: config.engine || 'claude',
      effort: config.effort || 'high',
      autoVerify: config.autoVerify !== false,
      revisore: config.revisore !== false,
      autoContinue: config.autoContinue !== false,
      projectTestCommand: config.projectTestCommand || '',
      model: config.model,
      visionModel: modelloVisioneConfigurato(),
      coderModel: modelloCoderConfigurato(),
      coderProvider: config.coderProvider || '',
      coderGroup: config.coderGroup || '',
      disableCoder: !!config.disableCoder,
      baseUrl: config.baseUrl,
      customEndpoints: segreti.publicCustomEndpoints(config),
      autoAcceptFolder: config.autoAcceptFolder,
      flatUiMode: config.flatUiMode,
      hasApiKey: !!(config.apiKey && config.apiKey.trim())
    }
  });
});

// 8. MCP Server Configuration Management
app.get('/api/mcp', (req, res) => {
  // Il pannello gestisce gli strumenti di Adam. Il motore del terminale è distinto.
  const engine = req.query.scope === 'terminal' ? (config.engine || 'claude') : 'claude';
  if (!config.cwd) return res.json({ mcpServers: {}, engine });
  const radice = unityMcp.radiceProgetto(config.cwd) || config.cwd;
  const mcpFile = path.join(radice, engine === 'opencode' ? 'opencode.json' : 'claude_mcp.json');
  if (!fs.existsSync(mcpFile)) return res.json({ mcpServers: {}, engine: engine, configFile: mcpFile });
  try {
    const data = engine === 'opencode'
      ? unityMcp.leggiServer(radice, engine)
      : (JSON.parse(fs.readFileSync(mcpFile, 'utf8')).mcpServers || {});
    res.json({ mcpServers: data, engine: engine, configFile: mcpFile });
  } catch (e) {
    res.json({ mcpServers: {}, engine: engine, configFile: mcpFile, error: 'JSON MCP non valido: ' + e.message });
  }
});

app.post('/api/mcp', (req, res) => {
  if (!config.cwd) return res.status(400).json({ error: 'Nessuna cartella di lavoro attiva' });
  const engine = req.query.scope === 'terminal' ? (config.engine || 'claude') : 'claude';
  const radice = unityMcp.radiceProgetto(config.cwd) || config.cwd;
  const risultato = engine === 'opencode'
    ? unityMcp.salvaServerOpenCode(radice, req.body.mcpServers || {})
    : unityMcp.salvaServerClaude(radice, req.body.mcpServers || {});
  if (!risultato.ok) return res.status(500).json({ error: risultato.errore });
  applyMemoryRestart();
  res.json({ success: true, engine: engine, configFile: risultato.file });
});

app.get('/api/unity-mcp', async (req, res) => {
  try {
    const stato = await unityMcp.diagnostica(config.cwd, config.engine || 'claude');
    stato.chatCatalogKnown = !!chatSessionInfo && !chatSessionInfo.pending;
    stato.chatToolCount = (stato.chatCatalogKnown && chatSessionInfo.tools || []).filter(t => /^mcp__unity/i.test(t)).length;
    res.json(stato);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/unity-mcp/setup', (req, res) => {
  if (!config.cwd) return res.status(400).json({ error: 'Nessuna cartella di lavoro attiva' });
  const risultato = unityMcp.setup(config.cwd, { engine: config.engine || 'claude' });
  if (!risultato.ok) return res.status(400).json(risultato);
  risultato.restartDeferred = chatBusy;
  applyMemoryRestart();
  res.json(risultato);
});

// OpenCode legge la propria configurazione (opencode.json) con chiavi che, storicamente,
// erano DUPLICATE e diverse da quelle della UI (claude_ui_config.json). Risultato: la chat
// (Claude Code + proxy) e il terminale (OpenCode) parlavano a due account diversi. Qui
// teniamo sincronizzate le chiavi, così entrambi i motori usano lo stesso account.
function syncOpencodeConfig() {
  try {
    const result = segreti.sanitizeOpenCode(OPENCODE_CONFIG_FILE, config);
    if (result.changed) console.log('[Config] opencode.json ripulito: le chiavi arrivano dall\'ambiente del processo.');
  } catch (e) {
    console.error('[Config] Errore sync opencode.json:', e.message);
  }
}

function saveConfig() {
  try {
    syncOpencodeConfig();
    secretStore = segreti.persist(CONFIG_FILE, config, secretStore);
  } catch (e) {
    console.error('Error saving config:', e);
  }
}

// ============================================================
// MEMORY SYSTEM: Project Memory (.claude_memory.json) & Global Memory
// ============================================================
const GLOBAL_MEMORY_FILE = path.join(__dirname, 'claude_global_memory.json');

function loadGlobalMemory() {
  if (fs.existsSync(GLOBAL_MEMORY_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(GLOBAL_MEMORY_FILE, 'utf8'));
    } catch (e) {
      console.error('Error reading global memory:', e);
    }
  }

  const defaultGlobal = {
    updatedAt: new Date().toISOString(),
    nodes: [
      {
        id: 'glob_rule_project_isolation',
        scope: 'global',
        type: 'rule',
        label: 'ISOLAMENTO MEMORIE DI PROGETTO',
        value: 'Ogni progetto possiede la propria memoria (.claude_memory.json e MEMORY.md) in modo completamente INDIPENDENTE. Adam non deve mai confondere, copiare o applicare librerie, script, asset o convenzioni di un progetto su un altro.',
        tags: ['isolamento', 'memoria', 'progetti', 'indipendenza'],
        synapses: [
          { targetId: 'glob_projects_registry', label: 'gestisce', strength: 1.0 },
          { targetId: 'glob_rule_ambienti', label: 'garantisce', strength: 0.9 }
        ]
      },
      {
        id: 'glob_rule_autonomia',
        scope: 'global',
        type: 'rule',
        label: 'MASSIMA AUTONOMIA & STEP-BY-STEP',
        value: 'Adam opera in piena autonomia tecnica: pianifica il lavoro con una checklist progressiva, consulta la documentazione ufficiale pertinente, genera codice modulare e pulito, corregge errori di compilazione e sintassi autonomamente ed esegue verifiche reali prima di dichiarare un lavoro completato.',
        tags: ['autonomia', 'regole', 'apprendimento', 'workflow'],
        synapses: [
          { targetId: 'glob_rule_1', label: 'segue', strength: 0.85 }
        ]
      },
      {
        id: 'glob_rule_ambienti',
        scope: 'global',
        type: 'rule',
        label: 'DISTINZIONE AMBIENTI: UNITY VS WEB VS PYTHON',
        value: '1. UNITY: Solo C# moderno (Unity 6 URP) in Assets/Scripts/. Mai scheletri dello Studio, mai JS/HTML. Consulta learn.unity.com.\n2. WEB: HTML5, CSS3, JavaScript/TypeScript, Node, Three.js.\n3. PYTHON: Script puliti, librerie idonee (pygame, venv).\nOgni ambiente applica strumenti e verifiche indipendenti.',
        tags: ['ambienti', 'unity', 'web', 'python', 'separazione'],
        synapses: [
          { targetId: 'glob_rule_project_isolation', label: 'collegato a', strength: 0.95 }
        ]
      },
      {
        id: 'glob_projects_registry',
        scope: 'global',
        type: 'data',
        label: 'REGISTRO & CRESCITA NEURONI',
        value: 'I neuroni di codice, passaggi, variabili e regole di ciascun progetto vengono incrementati automaticamente man mano che Adam programma, restando isolati nel .claude_memory.json della cartella attiva.',
        tags: ['registro', 'neuroni', 'crescita', 'progetti'],
        synapses: []
      },
      {
        id: 'glob_rule_1',
        scope: 'global',
        type: 'rule',
        label: 'Stile Codice: Pulito & Modulare',
        value: 'Funzioni corte, codice leggibile, gestione errori chiara e architettura modulare.',
        tags: ['stile', 'best-practice'],
        synapses: []
      },
      {
        id: 'glob_var_port',
        scope: 'global',
        type: 'variable',
        label: 'PORTA_STUDIO: 3456',
        value: '3456',
        tags: ['rete', 'porta'],
        synapses: []
      },
      {
        id: 'glob_pattern_cli',
        scope: 'global',
        type: 'data',
        label: 'Comandi Claude Code',
        value: '/cost per calcolare i token, /compact per ottimizzare la memoria, /review per validare diff.',
        tags: ['claude', 'comandi'],
        synapses: []
      },
      {
        id: 'glob_sec_1',
        scope: 'global',
        type: 'rule',
        label: 'Sicurezza Rete & Web',
        value: 'Accessibile su rete locale 0.0.0.0. Usa Cloudflare Tunnel o SSH per accesso remoto protetto.',
        tags: ['sicurezza', 'rete'],
        synapses: []
      }
    ]
  };

  saveGlobalMemory(defaultGlobal);
  return defaultGlobal;
}

function saveGlobalMemory(data) {
  try {
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(GLOBAL_MEMORY_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving global memory:', e);
  }
}

function getProjectMemoryFilePath(projectDir) {
  return path.join(projectDir || config.cwd, '.claude_memory.json');
}

function loadProjectMemory(projectDir) {
  const dir = projectDir || config.cwd;
  const memFile = getProjectMemoryFilePath(dir);

  if (fs.existsSync(memFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(memFile, 'utf8'));
      // Se il progetto ha solo nodi base e nessun neurone di codice, scansiona per popolarli
      const hasCodeNodes = (data.nodes || []).some(n => n.id && n.id.startsWith('proj_code_'));
      if (!hasCodeNodes && fs.existsSync(dir)) {
        try {
          apprendimentoMemoria.scansionaEInizializzaNeuroniProgetto(dir);
          return JSON.parse(fs.readFileSync(memFile, 'utf8'));
        } catch (e) {}
      }
      return data;
    } catch (e) {
      console.error('Error reading project memory:', e);
    }
  }

  const folderName = path.basename(dir) || 'Progetto';
  const defaultProj = {
    projectName: folderName,
    projectPath: dir,
    updatedAt: new Date().toISOString(),
    nodes: [
      {
        id: 'proj_node_root',
        scope: 'project',
        type: 'data',
        label: `Progetto: ${folderName}`,
        value: `Cartella radice attiva: ${dir}`,
        tags: ['progetto', 'root'],
        synapses: [
          { targetId: 'glob_rule_1', label: 'segue', strength: 0.8 },
          { targetId: 'proj_node_var_cwd', label: 'percorso', strength: 1.0 }
        ]
      },
      {
        id: 'proj_node_var_cwd',
        scope: 'project',
        type: 'variable',
        label: 'CWD: ' + path.basename(dir),
        value: dir,
        tags: ['variabile', 'path'],
        synapses: []
      },
      {
        id: 'proj_node_step_init',
        scope: 'project',
        type: 'step',
        label: 'Sessione di Lavoro Inizializzata',
        value: `Sessione pronta in ${dir}. Pronto per generare codice, gestire passaggi e dati.`,
        tags: ['passaggio', 'avvio'],
        synapses: [
          { targetId: 'proj_node_root', label: 'associato a', strength: 0.9 }
        ]
      }
    ]
  };

  saveProjectMemory(dir, defaultProj);
  try {
    apprendimentoMemoria.scansionaEInizializzaNeuroniProgetto(dir);
    if (fs.existsSync(memFile)) {
      return JSON.parse(fs.readFileSync(memFile, 'utf8'));
    }
  } catch (e) {}
  return defaultProj;
}

function saveProjectMemory(projectDir, data) {
  const dir = projectDir || config.cwd;
  const memFile = getProjectMemoryFilePath(dir);
  try {
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(memFile, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving project memory:', e);
  }
}

function getCombinedGraph(projectDir) {
  const glob = loadGlobalMemory();
  const proj = loadProjectMemory(projectDir);

  const nodes = [];
  const nodeMap = new Map();

  (glob.nodes || []).forEach(n => {
    const nodeObj = { ...n, scope: 'global' };
    nodes.push(nodeObj);
    nodeMap.set(n.id, nodeObj);
  });

  (proj.nodes || []).forEach(n => {
    const nodeObj = { ...n, scope: 'project' };
    nodes.push(nodeObj);
    nodeMap.set(n.id, nodeObj);
  });

  const edges = [];
  nodes.forEach(sourceNode => {
    if (Array.isArray(sourceNode.synapses)) {
      sourceNode.synapses.forEach(syn => {
        if (nodeMap.has(syn.targetId)) {
          edges.push({
            id: `${sourceNode.id}->${syn.targetId}`,
            source: sourceNode.id,
            target: syn.targetId,
            label: syn.label || 'connesso',
            strength: syn.strength || 1.0
          });
        }
      });
    }
  });

  return {
    project: proj,
    global: glob,
    nodes,
    edges
  };
}

// Network Interfaces
function getNetworkAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push({
          interface: name,
          ip: iface.address,
          url: `http://${iface.address}:${PORT}`
        });
      }
    }
  }
  return addresses;
}

// ============================================================
// REST API: Network Info & Memory Endpoints
// ============================================================

// 8. Network Info Endpoint
app.get('/api/network-info', (req, res) => {
  const addresses = getNetworkAddresses();
  res.json({
    port: PORT,
    hostname: os.hostname(),
    localUrl: `http://localhost:${PORT}`,
    networkUrls: addresses,
    primaryUrl: addresses.length > 0 ? addresses[0].url : `http://localhost:${PORT}`,
    cwd: config.cwd
  });
});

// 8b. Network Health & Latency Endpoint
app.get('/api/network-health', async (req, res) => {
  try {
    const salute = await misuraSaluteInternet(req.query.force === 'true');
    res.json(salute);
  } catch (err) {
    res.status(500).json({ stato: 'offline', errore: err.message });
  }
});

// 9. Memory Graph Endpoint
app.get('/api/memory', (req, res) => {
  const graph = getCombinedGraph(config.cwd);
  res.json({
    success: true,
    currentDir: config.cwd,
    ...graph
  });
});

// 10. Add or Update Node (Neuron)
app.post('/api/memory/node', (req, res) => {
  const { id, scope, type, label, value, tags, synapses } = req.body;
  if (!label || !label.trim()) {
    return res.status(400).json({ error: 'Il titolo o label del neurone è obbligatorio' });
  }

  const isGlobal = scope === 'global';
  const targetScope = isGlobal ? 'global' : 'project';
  const mem = isGlobal ? loadGlobalMemory() : loadProjectMemory(config.cwd);

  const nodeId = id || (isGlobal ? 'glob_' : 'proj_') + Date.now();
  if (!Array.isArray(mem.nodes)) mem.nodes = [];
  const existingIdx = mem.nodes.findIndex(n => n.id === nodeId);

  const nodeData = {
    id: nodeId,
    scope: targetScope,
    type: type || 'data', // 'step', 'variable', 'data', 'rule', 'goal'
    label: label.trim(),
    value: value !== undefined ? value : '',
    tags: Array.isArray(tags) ? tags : (tags ? String(tags).split(',').map(t => t.trim()).filter(Boolean) : []),
    synapses: Array.isArray(synapses) ? synapses : [],
    updatedAt: new Date().toISOString()
  };

  if (existingIdx >= 0) {
    nodeData.createdAt = mem.nodes[existingIdx].createdAt || new Date().toISOString();
    if (!req.body.synapses) {
      nodeData.synapses = mem.nodes[existingIdx].synapses || [];
    }
    mem.nodes[existingIdx] = nodeData;
  } else {
    nodeData.createdAt = new Date().toISOString();
    mem.nodes.unshift(nodeData);
  }

  if (isGlobal) {
    saveGlobalMemory(mem);
  } else {
    saveProjectMemory(config.cwd, mem);
  }

  // Il prompt di sistema viene fissato all'avvio della sessione: senza riavvio la
  // memoria appena salvata non verrebbe vista fino al riavvio successivo.
  restartSessionsForMemory();

  res.json({ success: true, node: nodeData, graph: getCombinedGraph(config.cwd) });
});

// 11. Delete Node (Neuron)
app.delete('/api/memory/node/:id', (req, res) => {
  const { id } = req.params;
  const glob = loadGlobalMemory();
  const proj = loadProjectMemory(config.cwd);

  glob.nodes = (glob.nodes || []).filter(n => n.id !== id);
  glob.nodes.forEach(n => {
    if (Array.isArray(n.synapses)) {
      n.synapses = n.synapses.filter(s => s.targetId !== id);
    }
  });

  proj.nodes = (proj.nodes || []).filter(n => n.id !== id);
  proj.nodes.forEach(n => {
    if (Array.isArray(n.synapses)) {
      n.synapses = n.synapses.filter(s => s.targetId !== id);
    }
  });

  saveGlobalMemory(glob);
  saveProjectMemory(config.cwd, proj);

  res.json({ success: true, graph: getCombinedGraph(config.cwd) });
});

// 12. Create Synapse (Connection)
app.post('/api/memory/synapse', (req, res) => {
  const { sourceId, targetId, label, strength } = req.body;
  if (!sourceId || !targetId) {
    return res.status(400).json({ error: 'sourceId e targetId sono obbligatori' });
  }

  const glob = loadGlobalMemory();
  const proj = loadProjectMemory(config.cwd);

  let foundSource = false;
  const synData = {
    targetId,
    label: label || 'collegato',
    strength: strength ? Number(strength) : 1.0
  };

  const updateSynapse = (nodes) => {
    for (const n of nodes) {
      if (n.id === sourceId) {
        if (!Array.isArray(n.synapses)) n.synapses = [];
        const existingSynIdx = n.synapses.findIndex(s => s.targetId === targetId);
        if (existingSynIdx >= 0) {
          n.synapses[existingSynIdx] = synData;
        } else {
          n.synapses.push(synData);
        }
        foundSource = true;
        break;
      }
    }
  };

  updateSynapse(glob.nodes || []);
  if (!foundSource) {
    updateSynapse(proj.nodes || []);
  }

  saveGlobalMemory(glob);
  saveProjectMemory(config.cwd, proj);

  res.json({ success: true, graph: getCombinedGraph(config.cwd) });
});

// 13. Delete Synapse
app.delete('/api/memory/synapse', (req, res) => {
  const { sourceId, targetId } = req.body;
  const glob = loadGlobalMemory();
  const proj = loadProjectMemory(config.cwd);

  const removeSynapse = (nodes) => {
    for (const n of nodes) {
      if (n.id === sourceId && Array.isArray(n.synapses)) {
        n.synapses = n.synapses.filter(s => s.targetId !== targetId);
      }
    }
  };

  removeSynapse(glob.nodes || []);
  removeSynapse(proj.nodes || []);

  saveGlobalMemory(glob);
  saveProjectMemory(config.cwd, proj);

  res.json({ success: true, graph: getCombinedGraph(config.cwd) });
});
// ============================================================
// WEB SEARCH: Search & Deep Search via DuckDuckGo (no API key)
// ============================================================

function fetchUrl(url, options = {}, _redirectCount = 0) {
  const MAX_REDIRECTS = 5;
  return new Promise((resolve, reject) => {
    if (_redirectCount > MAX_REDIRECTS) {
      return reject(new Error('Troppi redirect'));
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (e) {
      return reject(new Error('URL non valido: ' + url));
    }

    const protocol = parsedUrl.protocol === 'https:' ? https : http;
    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
        ...(options.headers || {})
      },
      timeout: options.timeout || 15000
    };

    const req = protocol.request(reqOptions, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, url).toString();
        res.resume();
        fetchUrl(redirectUrl, options, _redirectCount + 1).then(resolve).catch(reject);
        return;
      }

      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8')
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout richiesta')); });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

function parseDuckDuckGoResults(html, maxResults = 10) {
  const results = [];

  // DuckDuckGo HTML lite: <a rel="nofollow" class="result__a" href="URL">Title</a>
  const linkPattern = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetPattern = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

  const links = [];
  let match;
  while ((match = linkPattern.exec(html)) !== null) {
    links.push({
      url: match[1],
      title: match[2].replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim()
    });
  }

  const snippets = [];
  while ((match = snippetPattern.exec(html)) !== null) {
    snippets.push(
      match[1].replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim()
    );
  }

  for (let i = 0; i < Math.min(links.length, maxResults); i++) {
    let url = links[i].url;
    // DuckDuckGo wraps URLs in tracking redirects
    if (url.includes('duckduckgo.com/l/?uddg=')) {
      try {
        const parsed = new URL(url.startsWith('//') ? 'https:' + url : url);
        url = decodeURIComponent(parsed.searchParams.get('uddg') || url);
      } catch (e) { /* keep original */ }
    }

    results.push({
      title: links[i].title || 'Senza titolo',
      url: url,
      snippet: snippets[i] || ''
    });
  }

  return results;
}

function extractTextFromHtml(html, maxLength = 4000) {
  let text = html;
  // Remove script, style, nav, footer, header blocks
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, '');
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  // Remove all HTML tags
  text = text.replace(/<[^>]*>/g, ' ');
  // Decode common HTML entities
  text = text.replace(/&nbsp;/gi, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&#x27;/g, "'");
  text = text.replace(/&#x2F;/g, '/');
  // Collapse whitespace
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/(\s*\n\s*)+/g, '\n');
  text = text.trim();

  if (text.length > maxLength) {
    text = text.slice(0, maxLength) + '…';
  }
  return text;
}

// 14. Web Search — Quick search
app.post('/api/web-search', async (req, res) => {
  const { query, maxResults } = req.body;
  if (!query || !query.trim()) {
    return res.status(400).json({ error: 'Query di ricerca obbligatoria' });
  }

  try {
    const formData = new URLSearchParams({ q: query.trim() }).toString();
    const response = await fetchUrl('https://html.duckduckgo.com/html/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': String(Buffer.byteLength(formData))
      },
      body: formData,
      timeout: 15000
    });

    const results = parseDuckDuckGoResults(response.body, maxResults || 8);

    res.json({
      success: true,
      query: query.trim(),
      mode: 'search',
      results,
      resultCount: results.length
    });
  } catch (err) {
    console.error('Web search error:', err);
    res.status(500).json({ error: 'Errore durante la ricerca: ' + err.message });
  }
});

// 15. Deep Search — Search + fetch page content
app.post('/api/deep-search', async (req, res) => {
  const { query, maxResults, maxPageContent } = req.body;
  if (!query || !query.trim()) {
    return res.status(400).json({ error: 'Query di ricerca obbligatoria' });
  }

  try {
    const formData = new URLSearchParams({ q: query.trim() }).toString();
    const response = await fetchUrl('https://html.duckduckgo.com/html/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': String(Buffer.byteLength(formData))
      },
      body: formData,
      timeout: 15000
    });

    const results = parseDuckDuckGoResults(response.body, maxResults || 5);
    const deepLimit = Math.min(3, results.length);
    const contentMaxLen = maxPageContent || 4000;

    // Fetch page content from top results in parallel
    const deepPromises = results.slice(0, deepLimit).map(async (result) => {
      try {
        const pageResponse = await fetchUrl(result.url, { timeout: 10000 });
        const pageText = extractTextFromHtml(pageResponse.body, contentMaxLen);
        return { ...result, pageContent: pageText, deepFetched: true };
      } catch (e) {
        return { ...result, pageContent: null, deepFetched: false, fetchError: e.message };
      }
    });

    const deepResults = await Promise.allSettled(deepPromises);
    const enrichedResults = deepResults.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      return { ...results[i], pageContent: null, deepFetched: false };
    });

    // Add remaining results without deep content
    const remaining = results.slice(deepLimit).map(r => ({ ...r, pageContent: null, deepFetched: false }));

    res.json({
      success: true,
      query: query.trim(),
      mode: 'deep',
      results: [...enrichedResults, ...remaining],
      resultCount: results.length,
      deepFetchedCount: enrichedResults.filter(r => r.deepFetched).length
    });
  } catch (err) {
    console.error('Deep search error:', err);
    res.status(500).json({ error: 'Errore durante la ricerca profonda: ' + err.message });
  }
});

// 16. Siti Consigliati per Adam — Elenco, Aggiunta e Rimozione
app.get('/api/siti-consigliati', (req, res) => {
  try {
    const stato = sitiConsigliati.carica();
    res.json({ success: true, siti: stato.siti || [] });
  } catch (err) {
    res.status(500).json({ error: 'Impossibile caricare i siti: ' + err.message });
  }
});

app.post('/api/siti-consigliati', (req, res) => {
  try {
    const { url, descrizione, note } = req.body || {};
    const esito = sitiConsigliati.aggiungi({ url, descrizione: descrizione || note });
    if (esito.errore) {
      return res.status(400).json({ error: esito.errore });
    }
    const stato = sitiConsigliati.carica();
    res.json({ success: true, sito: esito.sito, siti: stato.siti });
  } catch (err) {
    res.status(500).json({ error: 'Errore durante il salvataggio del sito: ' + err.message });
  }
});

app.delete('/api/siti-consigliati/:id', (req, res) => {
  try {
    const id = req.params.id;
    const esito = sitiConsigliati.rimuovi(id);
    if (esito.errore) {
      return res.status(404).json({ error: esito.errore });
    }
    const stato = sitiConsigliati.carica();
    res.json({ success: true, rimosso: id, siti: stato.siti });
  } catch (err) {
    res.status(500).json({ error: 'Errore durante la rimozione del sito: ' + err.message });
  }
});

// 16b. Documentazione e Fonti per Adam (URL, PDF, Immagini, File)
app.get('/api/documentazione', (req, res) => {
  try {
    const stato = documentazione.carica();
    res.json({ success: true, documenti: stato.documenti || [], fontePrimariaUnity: stato.fontePrimariaUnity });
  } catch (err) {
    res.status(500).json({ error: 'Impossibile caricare la documentazione: ' + err.message });
  }
});

app.post('/api/documentazione/url', (req, res) => {
  try {
    const { url, nome, descrizione, ambito, primario } = req.body || {};
    const esito = documentazione.aggiungiUrl({ url, nome, descrizione, ambito, primario });
    if (esito.errore) return res.status(400).json({ error: esito.errore });
    const stato = documentazione.carica();
    res.json({ success: true, documento: esito.documento, documenti: stato.documenti });
  } catch (err) {
    res.status(500).json({ error: 'Errore aggiunta URL: ' + err.message });
  }
});

app.post('/api/documentazione/file', (req, res) => {
  try {
    const esito = documentazione.aggiungiDaPayload(req.body);
    if (esito.errore) return res.status(400).json({ error: esito.errore });
    const stato = documentazione.carica();
    res.json({ success: true, documento: esito.documento, documenti: stato.documenti });
  } catch (err) {
    res.status(500).json({ error: 'Errore caricamento documento: ' + err.message });
  }
});

app.delete('/api/documentazione/:id', (req, res) => {
  try {
    const id = req.params.id;
    const esito = documentazione.rimuovi(id);
    if (esito.errore) return res.status(404).json({ error: esito.errore });
    const stato = documentazione.carica();
    res.json({ success: true, rimosso: id, documenti: stato.documenti });
  } catch (err) {
    res.status(500).json({ error: 'Errore rimozione documento: ' + err.message });
  }
});

// 17. Visita Pagina — Scarica e pulisce il testo di una pagina web per consultazione
app.post('/api/visita-pagina', async (req, res) => {
  const { url, maxLength } = req.body || {};
  if (!url || !String(url).trim()) {
    return res.status(400).json({ error: 'URL mancante' });
  }
  const pulitoUrl = String(url).trim();
  try {
    const response = await fetchUrl(pulitoUrl, { timeout: 15000 });
    const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(response.body);
    const titolo = match ? match[1].replace(/<[^>]*>/g, '').trim() : 'Senza titolo';
    const testo = extractTextFromHtml(response.body, maxLength || 4000);
    res.json({
      success: true,
      url: pulitoUrl,
      titolo: titolo,
      testo: testo,
      lunghezza: testo.length
    });
  } catch (err) {
    console.error('Errore visita pagina:', err);
    res.status(500).json({ error: 'Impossibile visitare la pagina: ' + err.message });
  }
});

// ============================================================
// WHATSAPP PROTETTORE API & PAGINA SEPARATA
// ============================================================

app.get('/whatsapp', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'whatsapp.html'));
});

app.get('/api/whatsapp/status', (req, res) => {
  const wb = getAppWhatsAppBridge();
  res.json({ success: true, ...wb.getStato() });
});

app.post('/api/whatsapp/start', async (req, res) => {
  const wb = getAppWhatsAppBridge();
  const esito = await wb.avviaLiveSession(req.body);
  res.json({ success: esito.ok, ...esito, stato: wb.getStato() });
});

app.post('/api/whatsapp/stop', async (req, res) => {
  const wb = getAppWhatsAppBridge();
  const esito = await wb.chiudiLiveSession();
  res.json({ success: esito.ok, stato: wb.getStato() });
});

app.get('/api/whatsapp/scenari', (req, res) => {
  const wb = getAppWhatsAppBridge();
  res.json({ success: true, scenari: wb.getScenariTest() });
});

app.post('/api/whatsapp/analizza', async (req, res) => {
  try {
    const wb = getAppWhatsAppBridge();
    const risultato = await wb.analizzaManuale({
      contatto: req.body.contatto,
      messaggio: req.body.messaggio,
      contesto: req.body.contesto,
      usaLlm: req.body.usaLlm !== false,
      modello: req.body.modello || config.model || 'qwen3.5-studio:9b',
      baseUrl: baseUrlForProvider('ollama'),
      apiKey: config.apiKey || '',
      authToken: config.authToken || ''
    });
    res.json({ success: true, elemento: risultato });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/whatsapp/apri-chat', async (req, res) => {
  try {
    const wb = getAppWhatsAppBridge();
    const esito = await wb.apriChat(req.body.contatto);
    res.json({ success: esito.ok, ...esito });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/whatsapp/sincronizza', async (req, res) => {
  try {
    const wb = getAppWhatsAppBridge();
    const esito = await wb.sincronizzaChat();
    res.json({ success: esito.ok, ...esito });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/whatsapp/pulisci', (req, res) => {
  const wb = getAppWhatsAppBridge();
  wb.messaggiAnalizzati = [];
  wb.contatti.clear();
  wb.salvaCronologia();
  broadcast({ type: 'whatsapp:status', stato: wb.getStato() });
  res.json({ success: true });
});

// Per impostazione predefinita lo Studio ascolta solo sul PC locale. L'accesso LAN
// richiede sia STUDIO_ALLOW_LAN=1 sia un STUDIO_API_TOKEN esplicito.
server.listen(PORT, LISTEN_HOST, () => {
  const addrs = getNetworkAddresses();
  console.log(`====================================================`);
  console.log(` NotExist Intelligience Studio - avviato con successo`);
  console.log(` di 0Not_Exist0 · interfaccia grafica per Claude Code`);
  console.log(` URL Locale: http://localhost:${PORT}`);
  if (LAN_ENABLED) {
    addrs.forEach(a => console.log(` URL Rete protetta: ${a.url} (${a.interface})`));
  } else {
    console.log(' Rete: solo locale (LAN disattivata)');
    if (LAN_REQUESTED) console.warn(' STUDIO_ALLOW_LAN ignorato: manca STUDIO_API_TOKEN.');
  }
  console.log(` Cartella di lavoro: ${config.cwd}`);
  console.log(`====================================================`);

  console.log(` Provider: ${config.provider || 'anthropic'}`);
  console.log(`====================================================`);

  // Pre-caricamento immediato in background dei modelli — forceAll=true per avere
  // sempre la lista aggiornata dalle API ad ogni avvio dello Studio.
  refreshRemoteModelsCache(true).catch(() => {});

  // fcc-claude usa il ponte locale sulla porta 8082. Lo avviamo noi se e' installato ma
  // spento: il collegamento desktop e `npm start` devono comportarsi allo stesso modo.
  fccProxy.avviaSeNecessario().then(function (esito) {
    if (esito.avviato && esito.ok) console.log('[FCC] Proxy avviato automaticamente sulla porta 8082.');
    if (!esito.ok) console.warn('[FCC] Proxy non disponibile: ' + esito.errore);
  }).catch(function (errore) {
    console.warn('[FCC] Avvio automatico non riuscito: ' + errore.message);
  }).then(function () {
    // Rileviamo la finestra del modello PRIMA di avviare le sessioni, cosi' la compattazione nativa e'
    // gia' impostata al primo turno. Se Ollama non risponde (o e' un altro provider) si parte lo stesso.
    return aggiornaLimiteContesto().catch(function () {});
  }).then(function () {
    startClaudeProcess();
    startChatProcess({});
  });
});

// Rete di sicurezza. Perdere l'intera interfaccia per un singhiozzo su una pipe di un
// processo figlio non e' accettabile: registriamo e restiamo in piedi. Gli errori veri
// restano visibili nel log e nella Diagnostica.
// Errori di pipe attesi quando un processo figlio viene riavviato mentre una scrittura
// e' ancora in volo: benigni. Provengono anche da socket interne a node-pty, che non
// espone gestori propri, quindi si possono intercettare solo qui.
const ERRORI_PIPE_BENIGNI = ['EAGAIN', 'EPIPE', 'ECONNRESET', 'ERR_STREAM_DESTROYED', 'ERR_STREAM_WRITE_AFTER_END'];

process.on('uncaughtException', function (err) {
  const codice = err && (err.code || '');
  if (ERRORI_PIPE_BENIGNI.indexOf(codice) !== -1) {
    console.warn('[Pipe] ' + codice + ' durante un riavvio di sessione: ignorato.');
    return;
  }
  console.error('[Errore non gestito]', err && (err.stack || err.message || err));
  try {
    broadcast({ type: 'chat', event: 'error', text: 'Errore interno del server: ' + (err && err.message) });
  } catch (e) {}
});

process.on('unhandledRejection', function (reason) {
  console.error('[Promise non gestita]', reason && (reason.stack || reason.message || reason));
});

function shutdown() {
  stopChatProcess({ silent: true });
  if (ptyProcess) {
    try { ptyProcess.kill(); } catch (e) {}
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
