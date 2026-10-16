'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const agent = require('../strumenti/gpt-oss-agent');

assert.strictEqual(agent.isGptOssModel('openai/gpt-oss-120b'), true);
assert.strictEqual(agent.isGptOssModel('gpt-oss-20b'), true);
assert.strictEqual(agent.isGptOssModel('openrouter:openai/gpt-oss-120b'), true);
assert.strictEqual(agent.isGptOssModel('nvidia/nemotron-3-ultra-550b-a55b'), false);
assert.strictEqual(agent.isGptOssModel('nemotron'), false);
assert.strictEqual(agent.richiedeProxyStrumenti('openrouter', 'openai/gpt-oss-120b'), true);
assert.strictEqual(agent.richiedeProxyStrumenti('nvidia', 'nvidia/nemotron-3-ultra-550b-a55b'), false);
assert.strictEqual(agent.richiedeProxyStrumenti('openrouter', 'anthropic/claude-sonnet-4'), false);
assert.strictEqual(agent.richiestaOperativa('Sistema il problema e modifica il file'), true);
assert.strictEqual(agent.richiestaOperativa('Spiegami come modificare il file'), false);
assert.strictEqual(agent.richiestaOperativa('Analizza il bug senza modificare nulla'), false);
assert.strictEqual(agent.richiestaOperativa('Create the feature and run its tests'), true);

assert.strictEqual(agent.motivoSenzaAzione({
  model: 'openai/gpt-oss-120b', request: 'Correggi il bug nel server',
  evidence: { letture: 3, ricerche: 2, scritture: 0, azioni: 0 }
}), agent.MOTIVO_NESSUNA_AZIONE);
assert.strictEqual(agent.motivoSenzaAzione({
  model: 'openai/gpt-oss-120b', request: 'Correggi il bug nel server', evidence: { scritture: 1, azioni: 1 }
}), null);
assert.strictEqual(agent.motivoSenzaAzione({
  model: 'nvidia/nemotron-3-ultra-550b-a55b', request: 'Correggi il bug nel server', evidence: { scritture: 0, azioni: 0 }
}), null);
assert.strictEqual(agent.istruzioniPrompt('nvidia/nemotron-3-ultra-550b-a55b'), '');
assert.match(agent.istruzioniPrompt('openai/gpt-oss-120b'), /non limitarti/i);

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
assert.match(serverSource, /--permission-mode', config\.permissionMode/,
  'le autorizzazioni devono essere applicate a ogni provider');
assert.match(serverSource, /gptOssAgent\.richiedeProxyStrumenti\(currentProvider, config\.model\)/,
  'la route deve intercettare GPT-OSS');
assert.match(serverSource, /gptOssAgent\.richiedeProxyStrumenti\(provider, model\)[\s\S]{0,120}http:\/\/localhost:/,
  'GPT-OSS deve puntare al proxy locale degli strumenti');

console.log('OK - guardiano operativo GPT-OSS e isolamento Nemotron');
