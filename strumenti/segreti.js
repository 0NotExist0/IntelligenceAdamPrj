'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROVIDERS = [
  'anthropic', 'openrouter', 'nvidia', 'ashna', 'cerebras',
  'openai', 'deepseek', 'gemini', 'groq', 'mistral', 'custom'
];

const ENV_BY_PROVIDER = {
  anthropic: 'ANTHROPIC_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  nvidia: 'NVIDIA_API_KEY',
  ashna: 'ASHNA_API_KEY',
  cerebras: 'CEREBRAS_API_KEY',
  openai: 'OPENAI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  gemini: 'GEMINI_API_KEY',
  groq: 'GROQ_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  custom: 'CUSTOM_API_KEY'
};

function secretFilePath(env) {
  const source = env || process.env;
  if (source.STUDIO_SECRETS_FILE) return path.resolve(source.STUDIO_SECRETS_FILE);
  const base = source.LOCALAPPDATA || path.join(os.homedir(), '.config');
  return path.join(base, 'NotExist-Intelligience-Studio', 'secrets.json');
}

function readJson(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    console.error('[Segreti] File non leggibile:', error.message);
  }
  return fallback;
}

function load(env) {
  const data = readJson(secretFilePath(env), {});
  return {
    version: 1,
    apiKey: typeof data.apiKey === 'string' ? data.apiKey : '',
    authToken: typeof data.authToken === 'string' ? data.authToken : '',
    apiKeys: data.apiKeys && typeof data.apiKeys === 'object' ? data.apiKeys : {},
    customEndpointKeys: data.customEndpointKeys && typeof data.customEndpointKeys === 'object'
      ? data.customEndpointKeys
      : {},
    accessToken: typeof data.accessToken === 'string' && data.accessToken
      ? data.accessToken
      : crypto.randomBytes(32).toString('hex')
  };
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function isEnvPlaceholder(value) {
  return /^\{env:[A-Z0-9_]+\}$/i.test(String(value || '').trim());
}

function hydrateConfig(config, secrets) {
  const hydrated = config;
  const stored = secrets || load();
  const inlineKeys = hydrated.apiKeys && typeof hydrated.apiKeys === 'object' ? hydrated.apiKeys : {};
  hydrated.apiKeys = Object.assign({}, stored.apiKeys || {}, inlineKeys);

  const inlineApiKey = nonEmpty(hydrated.apiKey);
  const inlineAuthToken = nonEmpty(hydrated.authToken);
  hydrated.apiKey = inlineApiKey || nonEmpty(stored.apiKey) || nonEmpty(hydrated.apiKeys.anthropic);
  hydrated.authToken = inlineAuthToken || nonEmpty(stored.authToken);
  if (hydrated.apiKey && !hydrated.apiKeys.anthropic) hydrated.apiKeys.anthropic = hydrated.apiKey;
  // Le versioni precedenti salvavano spesso una sola credenziale generica in
  // authToken. Dopo averla spostata nel deposito privato, associamola al provider
  // attivo: altrimenti il proxy continuerebbe a usarla ma diagnostica, elenco
  // modelli e stato la considererebbero assente.
  const providerAttivo = String(hydrated.provider || '').toLowerCase();
  if (hydrated.authToken && hydrated.authToken !== 'ollama' && PROVIDERS.includes(providerAttivo) &&
      !nonEmpty(hydrated.apiKeys[providerAttivo])) {
    hydrated.apiKeys[providerAttivo] = hydrated.authToken;
  }

  const endpointKeys = stored.customEndpointKeys || {};
  hydrated.customEndpoints = Array.isArray(hydrated.customEndpoints)
    ? hydrated.customEndpoints.map(function (endpoint) {
      const copy = Object.assign({}, endpoint);
      const id = String(copy.id || '');
      copy.apiKey = nonEmpty(copy.apiKey) || nonEmpty(endpointKeys[id]);
      delete copy.hasApiKey;
      return copy;
    })
    : [];

  return hydrated;
}

function capture(config, previous) {
  const current = previous || load();
  const apiKeys = Object.assign({}, current.apiKeys || {});
  PROVIDERS.forEach(function (provider) {
    if (!config.apiKeys || !Object.prototype.hasOwnProperty.call(config.apiKeys, provider)) return;
    const value = nonEmpty(config.apiKeys[provider]);
    if (value && !isEnvPlaceholder(value)) apiKeys[provider] = value;
    else if (!value) delete apiKeys[provider];
  });

  // Gli endpoint rimossi dalla configurazione non devono lasciare credenziali
  // orfane nel deposito privato. Un campo vuoto su un endpoint esistente, invece,
  // significa "mantieni" perche' il browser non riceve mai il valore segreto.
  const customEndpointKeys = {};
  (config.customEndpoints || []).forEach(function (endpoint) {
    const id = String(endpoint && endpoint.id || '');
    const value = nonEmpty(endpoint && endpoint.apiKey);
    const precedente = nonEmpty(current.customEndpointKeys && current.customEndpointKeys[id]);
    if (id && value && !isEnvPlaceholder(value)) customEndpointKeys[id] = value;
    else if (id && precedente) customEndpointKeys[id] = precedente;
  });

  const haApiKey = Object.prototype.hasOwnProperty.call(config, 'apiKey');
  const haAuthToken = Object.prototype.hasOwnProperty.call(config, 'authToken');
  const apiKey = haApiKey
    ? (nonEmpty(config.apiKey) || nonEmpty(apiKeys.anthropic))
    : (nonEmpty(current.apiKey) || nonEmpty(apiKeys.anthropic));
  const authToken = haAuthToken ? nonEmpty(config.authToken) : nonEmpty(current.authToken);

  return {
    version: 1,
    apiKey,
    authToken,
    apiKeys,
    customEndpointKeys,
    accessToken: nonEmpty(current.accessToken) || crypto.randomBytes(32).toString('hex')
  };
}

function publicConfig(config) {
  const safe = JSON.parse(JSON.stringify(config));
  delete safe.apiKey;
  delete safe.authToken;
  delete safe.apiKeys;
  safe.dangerouslySkipPermissions = false;
  safe.customEndpoints = (safe.customEndpoints || []).map(function (endpoint) {
    const copy = Object.assign({}, endpoint);
    delete copy.apiKey;
    delete copy.hasApiKey;
    return copy;
  });
  return safe;
}

function publicCustomEndpoints(config) {
  return (config.customEndpoints || []).map(function (endpoint) {
    return {
      id: endpoint.id,
      name: endpoint.name,
      baseUrl: endpoint.baseUrl,
      hasApiKey: !!nonEmpty(endpoint.apiKey)
    };
  });
}

function writeJsonPrivate(file, value) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temp = path.join(dir, '.' + path.basename(file) + '.' + process.pid + '.tmp');
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(temp, 0o600); } catch (error) {}
  try {
    fs.renameSync(temp, file);
  } catch (error) {
    fs.copyFileSync(temp, file);
    fs.unlinkSync(temp);
  }
  try { fs.chmodSync(file, 0o600); } catch (error) {}
}

function persist(configFile, config, previous, env) {
  const secrets = capture(config, previous);
  writeJsonPrivate(secretFilePath(env), secrets);
  writeJsonPrivate(configFile, publicConfig(config));
  return secrets;
}

function sanitizeOpenCode(file, config) {
  if (!fs.existsSync(file)) return { changed: false, imported: false };
  const data = readJson(file, null);
  if (!data || !data.provider || typeof data.provider !== 'object') {
    return { changed: false, imported: false };
  }

  let changed = false;
  let imported = false;
  Object.keys(data.provider).forEach(function (provider) {
    const options = data.provider[provider] && data.provider[provider].options;
    if (!options || typeof options !== 'object') return;
    const current = nonEmpty(options.apiKey);
    if (current && !isEnvPlaceholder(current) && PROVIDERS.includes(provider)) {
      if (!config.apiKeys) config.apiKeys = {};
      if (!nonEmpty(config.apiKeys[provider])) config.apiKeys[provider] = current;
      imported = true;
    }
    const envName = ENV_BY_PROVIDER[provider];
    if (envName) {
      const placeholder = '{env:' + envName + '}';
      if (options.apiKey !== placeholder) {
        options.apiKey = placeholder;
        changed = true;
      }
    } else if (Object.prototype.hasOwnProperty.call(options, 'apiKey')) {
      delete options.apiKey;
      changed = true;
    }
  });

  if (changed) writeJsonPrivate(file, data);
  return { changed, imported };
}

function configuredProviders(config) {
  const result = {};
  PROVIDERS.forEach(function (provider) {
    result[provider] = !!nonEmpty(config.apiKeys && config.apiKeys[provider]);
  });
  return result;
}

module.exports = {
  PROVIDERS,
  configuredProviders,
  hydrateConfig,
  load,
  persist,
  publicConfig,
  publicCustomEndpoints,
  sanitizeOpenCode,
  secretFilePath
};
