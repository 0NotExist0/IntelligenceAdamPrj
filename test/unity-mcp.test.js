const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const integrazione = require('../strumenti/unity-mcp');

const progetti = [];
function progettoUnity(files) {
  const radice = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-unity-mcp-'));
  progetti.push(radice);
  const iniziali = Object.assign({
    'ProjectSettings/ProjectVersion.txt': 'm_EditorVersion: 6000.2.2f1\n',
    'Packages/manifest.json': JSON.stringify({ dependencies: { 'com.unity.test-framework': '1.5.1' } }, null, 2)
  }, files || {});
  Object.keys(iniziali).forEach(function (nome) {
    const file = path.join(radice, nome);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, iniziali[nome], 'utf8');
  });
  fs.mkdirSync(path.join(radice, 'Assets'), { recursive: true });
  return radice;
}

try {
  const root = progettoUnity({
    'opencode.json': JSON.stringify({
      '$schema': 'https://opencode.ai/config.json',
      model: 'provider/model',
      provider: { example: { models: {} } },
      mcp: { servers: { docs: { type: 'remote', url: 'http://127.0.0.1:1/mcp' } } }
    }, null, 2)
  });
  const primo = integrazione.setup(root, { engine: 'opencode' });
  assert.strictEqual(primo.ok, true, primo.errore);
  assert.strictEqual(primo.packageAdded, true);
  assert.strictEqual(primo.mcpAdded, true);
  assert.strictEqual(primo.version, '6000.2.2f1');

  let manifest = JSON.parse(fs.readFileSync(path.join(root, 'Packages', 'manifest.json'), 'utf8'));
  assert.strictEqual(manifest.dependencies['com.unity.test-framework'], '1.5.1');
  assert.strictEqual(manifest.dependencies[integrazione.PACKAGE_ID], integrazione.PACKAGE_URL);

  let config = JSON.parse(fs.readFileSync(path.join(root, 'opencode.json'), 'utf8'));
  assert.strictEqual(config.model, 'provider/model');
  assert.ok(config.provider.example);
  assert.ok(config.mcp.servers.docs);
  const mcp = config.mcp.servers[integrazione.SERVER_BASE_NAME];
  assert.strictEqual(mcp.type, 'remote');
  assert.strictEqual(mcp.url, integrazione.UNITY_HTTP_URL);
  assert.strictEqual(mcp.oauth, false);
  assert.strictEqual(mcp.command, undefined);
  assert.strictEqual(mcp.codemode, false);
  const chatConfig = JSON.parse(fs.readFileSync(path.join(root, 'claude_mcp.json'), 'utf8'));
  assert.deepStrictEqual(chatConfig.mcpServers[primo.chatMcpServerName], { type: 'http', url: integrazione.UNITY_HTTP_URL });
  assert.strictEqual(integrazione.stato(root, 'opencode').chatMcpConfigured, true);

  const secondo = integrazione.setup(root, { engine: 'opencode' });
  assert.strictEqual(secondo.ok, true, secondo.errore);
  assert.strictEqual(secondo.packageAdded, false);
  assert.strictEqual(secondo.mcpAdded, false);

  const servers = integrazione.leggiServer(root, 'opencode');
  assert.ok(servers.docs);
  assert.ok(servers[integrazione.SERVER_BASE_NAME]);
  const salva = integrazione.salvaServerOpenCode(root, Object.assign({}, servers, {
    extra: { type: 'local', command: ['node', 'server.js'] }
  }));
  assert.strictEqual(salva.ok, true, salva.errore);
  config = JSON.parse(fs.readFileSync(path.join(root, 'opencode.json'), 'utf8'));
  assert.strictEqual(config.mcp.servers.extra.command[0], 'node');
  assert.ok(config.mcp.servers.docs);
  assert.ok(config.mcp.servers[integrazione.SERVER_BASE_NAME]);

  const rootMigrazione = progettoUnity({
    'opencode.json': JSON.stringify({
      mcp: { servers: { 'unity-mcp': { type: 'local', command: ['uvx', '--from', 'mcpforunityserver', 'mcp-for-unity', '--transport', 'stdio'] } } }
    }, null, 2)
  });
  const migrazione = integrazione.setup(rootMigrazione, { engine: 'opencode' });
  assert.strictEqual(migrazione.ok, true, migrazione.errore);
  const configMigrata = JSON.parse(fs.readFileSync(path.join(rootMigrazione, 'opencode.json'), 'utf8'));
  assert.deepStrictEqual(Object.keys(configMigrata.mcp.servers), [integrazione.SERVER_BASE_NAME]);
  assert.strictEqual(configMigrata.mcp.servers[integrazione.SERVER_BASE_NAME].type, 'remote');
  assert.strictEqual(configMigrata.mcp.servers[integrazione.SERVER_BASE_NAME].url, integrazione.UNITY_HTTP_URL);
  assert.strictEqual(configMigrata.mcp.servers[integrazione.SERVER_BASE_NAME].command, undefined);

  const rootClaude = progettoUnity({
    '.mcp.json': JSON.stringify({ mcpServers: { UnityMCP: { type: 'http', url: integrazione.UNITY_HTTP_URL } } }),
    'claude_mcp.json': JSON.stringify({ mcpServers: { unityMCP: { type: 'http', url: 'http://localhost:8080/mcp' }, docs: { type: 'http', url: 'http://127.0.0.1:1234/mcp' } } })
  });
  const claude = integrazione.setup(rootClaude, { engine: 'claude', uvxPath: 'uvx-prova' });
  assert.strictEqual(claude.ok, true, claude.errore);
  const claudeConfig = JSON.parse(fs.readFileSync(path.join(rootClaude, 'claude_mcp.json'), 'utf8'));
  assert.strictEqual(claudeConfig.mcpServers.UnityMCP.type, 'http');
  assert.strictEqual(claudeConfig.mcpServers.UnityMCP.url, integrazione.UNITY_HTTP_URL);
  assert.strictEqual(claudeConfig.mcpServers.unityMCP, undefined);
  assert.ok(claudeConfig.mcpServers.docs);

  const nonUnity = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-unity-mcp-nonunity-'));
  progetti.push(nonUnity);
  assert.strictEqual(integrazione.stato(nonUnity, 'opencode').isUnity, false);
  assert.strictEqual(integrazione.setup(nonUnity, { engine: 'opencode', uvxPath: 'uvx-prova' }).ok, false);

  console.log('UNITY MCP: configurazione OpenCode/Claude, aggiornamenti idempotenti e rilevamento progetto OK');
} finally {
  progetti.forEach(function (dir) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  });
}
