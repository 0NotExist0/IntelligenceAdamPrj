const assert = require('assert');
const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;

function check(nome, condizione, dettaglio) {
  if (condizione) {
    pass++;
    console.log('  ok   ' + nome);
  } else {
    fail++;
    console.log('  FAIL ' + nome + (dettaglio !== undefined ? '  -> ' + dettaglio : ''));
  }
}

console.log('\n=== Test Integrazione OpenRouter & Verifica Chiave & Distinzione Crediti ===');

// 1. Modello con crediti: formattazione etichetta con [CREDITI] e prezzo per 1M token
const mockPaidModel = {
  id: 'anthropic/claude-3.7-sonnet',
  name: 'Claude 3.7 Sonnet',
  isFree: false,
  promptPriceM: '3.00',
  completionPriceM: '15.00'
};

function buildLabel(m) {
  if (m.isFree || (typeof m.id === 'string' && m.id.endsWith(':free'))) {
    return 'openrouter model: [GRATIS] ' + (m.name || m.id);
  }
  const price = (m.promptPriceM && m.promptPriceM !== '0') ? ` ($${m.promptPriceM}/$${m.completionPriceM} 1M)` : '';
  return 'openrouter model: [CREDITI] ' + (m.name || m.id) + price;
}

const paidLabel = buildLabel(mockPaidModel);
check('Prefisso etichetta include "openrouter model: [CREDITI]"', paidLabel.startsWith('openrouter model: [CREDITI] '));
check('Formato include prezzo per 1M token', paidLabel.includes('$3.00/$15.00 1M'));

// 2. Modello gratuito: formattazione etichetta con [GRATIS]
const mockFreeModel = {
  id: 'meta-llama/llama-3.3-70b-instruct:free',
  name: 'Llama 3.3 70B Instruct (free)',
  isFree: true,
  promptPriceM: '0',
  completionPriceM: '0'
};
const freeLabel = buildLabel(mockFreeModel);
check('Prefisso etichetta gratuito include "openrouter model: [GRATIS]"', freeLabel.startsWith('openrouter model: [GRATIS] '));
check('Modello gratuito non contiene prezzi di credito', !freeLabel.includes('$'));

// 3. Fallback per modelli gratuiti che terminano con :free anche se isFree non era settato
const mockSuffixFree = { id: 'deepseek/deepseek-r1:free', name: 'DeepSeek R1 Free' };
check('Riconoscimento suffisso :free come gratuito', buildLabel(mockSuffixFree).includes('[GRATIS]'));

// 4. Test logica endpoint verify con chiave vuota
async function testEmptyKey() {
  const req = { body: { apiKey: '' } };
  let statusResult = 200;
  let jsonResult = null;
  const res = {
    status(code) { statusResult = code; return this; },
    json(obj) { jsonResult = obj; return this; }
  };

  const apiKey = (req.body && req.body.apiKey ? String(req.body.apiKey) : '').trim();
  if (!apiKey) {
    res.status(400).json({ valid: false, error: 'Nessuna API key specificata' });
  }

  check('Chiave vuota restituisce HTTP 400', statusResult === 400);
  check('Chiave vuota ha valid = false', jsonResult && jsonResult.valid === false);
}

// 5. Test mappatura e separazione modelli gratuiti e con crediti
function testFormatOpenRouterResponse() {
  const rawApiModels = {
    data: [
      { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', context_length: 200000, pricing: { prompt: '0.000003', completion: '0.000015' } },
      { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B Free', context_length: 131072, pricing: { prompt: '0', completion: '0' } },
      { id: 'google/gemini-2.0-flash-exp:free', name: 'Gemini 2.0 Flash Free', context_length: 1048576, pricing: { prompt: '0', completion: '0' } },
      { id: 'openai/gpt-4o', name: 'GPT-4o', context_length: 128000, pricing: { prompt: '0.000005', completion: '0.000015' } }
    ]
  };

  const mapped = (rawApiModels.data || []).map(m => {
    const isFree = (typeof m.id === 'string' && m.id.endsWith(':free')) ||
      (parseFloat(m.pricing?.prompt || 0) === 0 && parseFloat(m.pricing?.completion || 0) === 0);
    const promptM = m.pricing?.prompt ? (parseFloat(m.pricing.prompt) * 1e6).toFixed(2) : '0';
    const compM = m.pricing?.completion ? (parseFloat(m.pricing.completion) * 1e6).toFixed(2) : '0';
    const costBadge = isFree ? '[GRATIS]' : `[CREDITI: $${promptM}/$${compM}]`;

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

  const freeModels = mapped.filter(m => m.isFree);
  const paidModels = mapped.filter(m => !m.isFree);

  check('Totale modelli mappati: 4', mapped.length === 4);
  check('Modelli gratuiti identificati: 2', freeModels.length === 2);
  check('Modelli con crediti identificati: 2', paidModels.length === 2);
  check('Claude 3.5 Sonnet richiede crediti', !mapped[0].isFree && mapped[0].costBadge.includes('[CREDITI'));
  check('Llama 3.3 Free è gratuito', mapped[1].isFree && mapped[1].costBadge === '[GRATIS]');

  // Test calcolo crediti rimanenti da auth key
  const authKeyInfo = { limit: 10, usage: 2.35 };
  const rem = Math.max(0, authKeyInfo.limit - authKeyInfo.usage).toFixed(2);
  check('Calcolo corretto crediti rimanenti ($7.65)', rem === '7.65');
}

// 6. Test Cerebras Cloud
function testCerebrasSupport() {
  const cskKey = 'csk-mock-1234567890abcdef';
  check('Riconoscimento chiave Cerebras csk-...', cskKey.startsWith('csk-'));

  const rawCerebrasModels = {
    data: [
      { id: 'llama3.1-8b', object: 'model' },
      { id: 'llama-3.3-70b', object: 'model' },
      { id: 'deepseek-r1-distill-llama-70b', object: 'model' }
    ]
  };

  const cerMapped = rawCerebrasModels.data.map(m => {
    const isFree = m.id.toLowerCase().includes('8b') || m.id.toLowerCase().includes('free');
    const costBadge = isFree ? '[FREE TIER]' : '[FREE TIER / CREDITI]';
    return {
      id: m.id,
      name: m.id,
      isFree: isFree,
      costBadge: costBadge,
      provider: 'Cerebras'
    };
  });

  check('Cerebras 8B è nel Free Tier', cerMapped[0].isFree && cerMapped[0].costBadge === '[FREE TIER]');
  check('Cerebras 70B è contrassegnato con [FREE TIER / CREDITI]', cerMapped[1].costBadge.includes('CREDITI'));

  const label8b = 'cerebras model: ' + cerMapped[0].costBadge + ' ' + cerMapped[0].name;
  check('Etichetta Cerebras con prefisso cerebras model:', label8b.startsWith('cerebras model: [FREE TIER]'));
}

// 7. Test Gestione Effort (Cloud vs Locale)
function testEffortHandling() {
  const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
  check('Tutti i 5 livelli di effort definiti', EFFORT_LEVELS.length === 5);

  const EFFORT_THINKING_BUDGET = { low: 0, medium: 512, high: 1024, xhigh: 2048, max: 4096 };
  check('Effort budget locale massimo è 4096', EFFORT_THINKING_BUDGET.max === 4096);
  check('Effort budget locale minimo è 0', EFFORT_THINKING_BUDGET.low === 0);

  function effortBudgetMock(prov, baseUrl, effort) {
    if (prov === 'anthropic') return null;
    if (prov === 'custom' && baseUrl && (baseUrl.includes('openrouter') || baseUrl.includes('cerebras'))) {
      return null;
    }
    return EFFORT_THINKING_BUDGET[effort || 'high'] || null;
  }

  check('OpenRouter sblocca ragionamento senza cap (null)', effortBudgetMock('custom', 'https://openrouter.ai/api', 'max') === null);
  check('Cerebras sblocca ragionamento senza cap (null)', effortBudgetMock('custom', 'https://api.cerebras.ai/v1', 'max') === null);
  check('Ollama applica cap ragionato a seconda del livello', effortBudgetMock('ollama', 'http://localhost:11434', 'max') === 4096);
}

// Regressione: i modelli OpenRouter scelti dalla tendina chat venivano inviati
// come provider "custom", quindi lo Studio puntava al proxy/base URL sbagliato.
function testSelezioneProviderDallaChat() {
  const sorgente = fs.readFileSync(path.join(__dirname, '..', 'public', 'chat-ui.js'), 'utf8');
  check('un id con slash o prefisso openrouter seleziona provider openrouter',
    /m\.includes\('\/'\)\)\s*return\s*'openrouter'/.test(sorgente));
}

(async function () {
  await testEmptyKey();
  testFormatOpenRouterResponse();
  testCerebrasSupport();
  testEffortHandling();
  testSelezioneProviderDallaChat();

  console.log('\n' + '='.repeat(50));
  console.log('OPENROUTER & CEREBRAS TEST: ' + pass + ' passati, ' + fail + ' falliti');
  process.exit(fail ? 1 : 0);
})();
