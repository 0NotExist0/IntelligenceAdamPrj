// Client HTTP MCP per diagnosticare il bridge locale senza invocare il modello.
function leggiContenuto(result) {
  if (result.structuredContent) return result.structuredContent;
  const blocks = result.contents || result.content || [];
  const text = blocks.filter(b => typeof b.text === 'string').map(b => b.text).join('\n');
  try { return JSON.parse(text); } catch (e) { return { text }; }
}

function creaClient(url, options) {
  const timeout = options && options.timeout || 6000;
  const clientId = options && options.clientId || 'intelligience-studio-diagnostics';
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  let sequence = 0;
  async function request(method, params, notification) {
    const id = ++sequence;
    // FastMCP HTTP può essere stateless: senza client_id la selezione del progetto
    // finirebbe nello stato globale, condiviso con la chat di Adam.
    const body = { jsonrpc: '2.0', method, params: Object.assign({}, params, { _meta: Object.assign({}, params && params._meta, { client_id: clientId }) }) };
    if (!notification) body.id = id;
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
    const session = response.headers.get('mcp-session-id');
    if (session) headers['Mcp-Session-Id'] = session;
    const raw = await response.text();
    if (!response.ok) throw new Error('MCP HTTP ' + response.status);
    if (notification) return;
    const messages = raw.trim().startsWith('{') ? [JSON.parse(raw)] : raw.split(/\r?\n/)
      .filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5).trim()));
    const message = messages.find(m => m.id === id);
    if (!message) throw new Error('Il server MCP non ha restituito la risposta richiesta.');
    if (message.error) throw new Error(message.error.message || 'Errore MCP');
    if (message.result && message.result.isError) throw new Error(leggiContenuto(message.result).text || 'Strumento MCP fallito');
    return message.result;
  }
  return {
    request,
    async initialize() {
      const result = await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'Intelligience-Studio', version: '1.0' } });
      headers['MCP-Protocol-Version'] = result.protocolVersion;
      await request('notifications/initialized', {}, true);
      return result;
    },
    async close() {
      if (!headers['Mcp-Session-Id']) return;
      try { await fetch(url, { method: 'DELETE', headers, signal: AbortSignal.timeout(2000) }); } catch (e) {}
    }
  };
}

module.exports = { creaClient, leggiContenuto };
