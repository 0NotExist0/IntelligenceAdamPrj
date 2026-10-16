const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const unity = require('../strumenti/unity-mcp');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-mcp-runtime-'));
  fs.mkdirSync(path.join(root, 'Assets'));
  fs.mkdirSync(path.join(root, 'ProjectSettings'));
  fs.writeFileSync(path.join(root, 'ProjectSettings/ProjectVersion.txt'), 'm_EditorVersion: 6000.2.2f1');
  let connectedRoot = root;
  let instances = [{ id: 'AdamGame@test' }];
  let closed = 0;
  const server = http.createServer(async (req, res) => {
    if (req.method === 'DELETE') { closed++; res.writeHead(200); return res.end(); }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const message = JSON.parse(raw);
    assert.ok(message.params._meta.client_id.startsWith('intelligience-studio-diagnostics-'), 'Diagnostica isolata dalle sessioni di Adam');
    if (message.method === 'notifications/initialized') { res.writeHead(202); return res.end(); }
    let result;
    if (message.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fixture', version: '1' } };
    if (message.method === 'tools/call') result = { content: [{ type: 'text', text: '{"success":true}' }] };
    if (message.method === 'tools/list') result = { tools: [{ name: 'manage_scene' }, { name: 'create_script' }] };
    if (message.method === 'resources/read') {
      const data = message.params.uri.endsWith('/instances') ? { success: true, instances } : { success: true, data: { projectRoot: connectedRoot } };
      result = { contents: [{ text: JSON.stringify(data) }] };
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Mcp-Session-Id': 'fixture-session' });
    res.end('event: message\ndata: ' + JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port + '/mcp';
  try {
    const ready = await unity.diagnostica(root, 'opencode', { url });
    assert.strictEqual(ready.projectConnected, true);
    assert.strictEqual(ready.toolCount, 2);
    assert.strictEqual(ready.chatMcpConfigured, false, 'Un server vivo non significa chat configurata');
    connectedRoot = path.join(root, 'altro-progetto');
    const wrong = await unity.diagnostica(root, 'opencode', { url });
    assert.strictEqual(wrong.serverReachable, true);
    assert.strictEqual(wrong.projectConnected, false, 'Non deve confermare un altro progetto');
    assert.strictEqual(wrong.toolCount, 0);
    instances = [];
    const empty = await unity.diagnostica(root, 'opencode', { url });
    assert.strictEqual(empty.projectConnected, false, 'Server acceso senza Editor non è una connessione');
    assert.strictEqual(closed, 3, 'Le sessioni di diagnostica vanno chiuse');
    await new Promise(resolve => server.close(resolve));
    const offline = await unity.diagnostica(root, 'opencode', { url, timeout: 500 });
    assert.strictEqual(offline.serverReachable, false);
    assert.strictEqual(offline.projectConnected, false);
    console.log('UNITY MCP RUNTIME: progetto corretto, altro progetto, Editor assente e server offline OK');
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
