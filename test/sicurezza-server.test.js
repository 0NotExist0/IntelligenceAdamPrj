// Regressioni di sicurezza: segreti fuori dal repository, server locale per
// impostazione predefinita, autenticazione remota e percorsi confinati.
const fs = require('fs');
const os = require('os');
const path = require('path');
const segreti = require('../strumenti/segreti');

let pass = 0;
let fail = 0;
function check(nome, condizione) {
  if (condizione) { pass++; console.log('  ok   ' + nome); }
  else { fail++; console.log('  FAIL ' + nome); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-sicurezza-'));
try {
  console.log('\n=== Deposito privato dei segreti ===');
  const fileConfig = path.join(dir, 'config.json');
  const fileSegreti = path.join(dir, 'privato', 'secrets.json');
  const env = { STUDIO_SECRETS_FILE: fileSegreti };
  const config = {
    provider: 'anthropic',
    apiKey: 'chiave-finta-antropica',
    authToken: 'token-finto',
    apiKeys: { anthropic: 'chiave-finta-antropica', openrouter: 'chiave-finta-openrouter' },
    customEndpoints: [{ id: 'privato-1', name: 'Privato', baseUrl: 'https://example.invalid/v1', apiKey: 'chiave-finta-custom' }],
    dangerouslySkipPermissions: true
  };
  let store = segreti.persist(fileConfig, config, null, env);
  const pubblico = JSON.parse(fs.readFileSync(fileConfig, 'utf8'));
  const privato = JSON.parse(fs.readFileSync(fileSegreti, 'utf8'));
  check('il file pubblico non contiene apiKey, authToken o apiKeys',
    !Object.prototype.hasOwnProperty.call(pubblico, 'apiKey') &&
    !Object.prototype.hasOwnProperty.call(pubblico, 'authToken') &&
    !Object.prototype.hasOwnProperty.call(pubblico, 'apiKeys'));
  check('le chiavi degli endpoint non finiscono nel file pubblico',
    pubblico.customEndpoints.length === 1 && !Object.prototype.hasOwnProperty.call(pubblico.customEndpoints[0], 'apiKey'));
  check('il bypass permessi viene sempre serializzato come disattivato', pubblico.dangerouslySkipPermissions === false);
  check('il deposito privato conserva le credenziali necessarie',
    !!privato.apiKeys.anthropic && !!privato.apiKeys.openrouter && !!privato.customEndpointKeys['privato-1']);

  const idratata = segreti.hydrateConfig(JSON.parse(fs.readFileSync(fileConfig, 'utf8')), segreti.load(env));
  check('all\'avvio le credenziali vengono reidratate solo in memoria',
    !!idratata.apiKeys.anthropic && !!idratata.apiKeys.openrouter && !!idratata.customEndpoints[0].apiKey);
  const legacy = segreti.hydrateConfig({ provider: 'mistral', apiKeys: [], customEndpoints: [] }, {
    apiKey: '', authToken: 'token-legacy-finto', apiKeys: {}, customEndpointKeys: {}, accessToken: 'accesso-finto'
  });
  check('un vecchio authToken viene associato al provider attivo', legacy.apiKeys.mistral === 'token-legacy-finto');

  idratata.apiKey = '';
  idratata.authToken = '';
  idratata.apiKeys.anthropic = '';
  idratata.apiKeys.openrouter = '';
  idratata.customEndpoints = [];
  store = segreti.persist(fileConfig, idratata, store, env);
  const cancellate = segreti.load(env);
  check('cancellare le chiavi dalla UI le elimina davvero dal deposito',
    !cancellate.apiKey && !cancellate.authToken && !cancellate.apiKeys.anthropic && !cancellate.apiKeys.openrouter);
  check('rimuovere un endpoint elimina anche la sua chiave orfana', !cancellate.customEndpointKeys['privato-1']);

  console.log('\n=== Configurazione OpenCode sanificata ===');
  const fileOpenCode = path.join(dir, 'opencode.json');
  fs.writeFileSync(fileOpenCode, JSON.stringify({
    provider: {
      openrouter: { options: { apiKey: 'chiave-inline-finta' } },
      nvidia: { options: { apiKey: 'altra-inline-finta' } }
    }
  }));
  const importata = { apiKeys: {} };
  const sanificata = segreti.sanitizeOpenCode(fileOpenCode, importata);
  const openCode = JSON.parse(fs.readFileSync(fileOpenCode, 'utf8'));
  check('le vecchie chiavi inline vengono importate prima della pulizia', sanificata.imported && !!importata.apiKeys.openrouter);
  check('OpenCode usa soltanto riferimenti a variabili d\'ambiente',
    /^\{env:/.test(openCode.provider.openrouter.options.apiKey) && /^\{env:/.test(openCode.provider.nvidia.options.apiKey));

  console.log('\n=== Guard rail del server ===');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  check('il bind predefinito e\' solo loopback',
    /const LAN_ENABLED = LAN_REQUESTED && !!String\(process\.env\.STUDIO_API_TOKEN/.test(server) &&
    /const LISTEN_HOST = LAN_ENABLED \? \(process\.env\.STUDIO_HOST \|\| '0\.0\.0\.0'\) : '127\.0\.0\.1'/.test(server));
  check('la modalita\' LAN richiede un token esplicito',
    /richiede sia STUDIO_ALLOW_LAN=1 sia un STUDIO_API_TOKEN esplicito/.test(server));
  check('API e WebSocket condividono il controllo di accesso',
    /function richiestaDiReteAutorizzata/.test(server) && /verifyClient: function/.test(server));
  check('le richieste cross-origin vengono respinte', /Origine non autorizzata/.test(server) && /origineConsentita/.test(server));
  check('in modalita\' locale anche il DNS rebinding viene respinto',
    /!LAN_ENABLED && !indirizzoLoopback\(parsed\.hostname\)/.test(server) && /replace\(\/\^\\\[\|\\\]\$\/g, ''\)/.test(server));
  check('letture e scritture API passano dal confinamento del progetto',
    /function percorsoDentro/.test(server) && /percorsoDentro\(config\.cwd/.test(server));
  check('la modalita\' dangerouslySkipPermissions viene forzata a false',
    /config\.dangerouslySkipPermissions = false/.test(server) && !/--dangerously-skip-permissions/.test(server));
  check('lo status espone solo quali provider sono configurati',
    /configuredProviders: segreti\.configuredProviders\(config\)/.test(server) && /customEndpoints: segreti\.publicCustomEndpoints\(config\)/.test(server));
  const inizioModelli = server.indexOf('const MODELLO_NON_CHAT');
  const fineModelli = server.indexOf('// Initial configuration', inizioModelli);
  const funzioniModello = new Function(server.slice(inizioModelli, fineModelli) +
    '; return { compatibile: modelloChatCompatibile, filtra: filtraModelliChat };')();
  check('OCR, embedding, reranker e audio non possono diventare il modello principale',
    !funzioniModello.compatibile('mistral-ocr-latest') &&
    !funzioniModello.compatibile('text-embedding-3-large') &&
    !funzioniModello.compatibile('bge-reranker-v2') &&
    !funzioniModello.compatibile('whisper-large-v3'));
  check('i modelli chat restano disponibili dopo il filtro',
    JSON.stringify(funzioniModello.filtra(['mistral-ocr-latest', 'gpt-5', { id: 'qwen3-coder' }])) ===
    JSON.stringify(['gpt-5', { id: 'qwen3-coder' }]));

  console.log('\n=== File reali del workspace ===');
  const configReale = path.join(__dirname, '..', 'claude_ui_config.json');
  if (fs.existsSync(configReale)) {
    const reale = JSON.parse(fs.readFileSync(configReale, 'utf8'));
    check('la configurazione reale non contiene piu\' credenziali inline',
      !Object.prototype.hasOwnProperty.call(reale, 'apiKey') &&
      !Object.prototype.hasOwnProperty.call(reale, 'authToken') &&
      !Object.prototype.hasOwnProperty.call(reale, 'apiKeys') &&
      (reale.customEndpoints || []).every(function (e) { return !Object.prototype.hasOwnProperty.call(e, 'apiKey'); }));
  } else {
    check('la configurazione reale assente non espone credenziali', true);
  }
} catch (e) {
  check('la prova si esegue senza eccezioni', false);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n' + '='.repeat(50));
console.log('SICUREZZA SERVER: ' + pass + ' passati, ' + fail + ' falliti');
process.exit(fail ? 1 : 0);
