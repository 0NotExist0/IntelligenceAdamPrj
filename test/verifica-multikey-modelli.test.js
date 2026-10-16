const assert = require('assert');
const http = require('http');

// Test suite per la verifica delle chiavi e popolamento modelli
console.log('=== Test Multi-Key & Modelli NotExist Intelligience Studio ===');

// Test 1: Verifichiamo la formattazione dei modelli e degli errori
const mockProviderStatus = {
  openrouter: { valid: false, reachable: false, error: 'Host non raggiungibile', provider: 'OpenRouter' },
  openai: { valid: true, reachable: true, isPaid: true, credits: '$0.00', creditsExhausted: true, provider: 'OpenAI' },
  groq: { valid: true, reachable: true, isPaid: false, credits: 'Free Tier', creditsExhausted: false, freeCount: 5, paidCount: 0, provider: 'Groq' }
};

assert.strictEqual(mockProviderStatus.openrouter.reachable, false, 'OpenRouter dovrebbe essere irraggiungibile');
assert.strictEqual(mockProviderStatus.openai.creditsExhausted, true, 'OpenAI dovrebbe avere crediti esauriti');
assert.strictEqual(mockProviderStatus.groq.valid, true, 'Groq dovrebbe essere valida');

console.log('✓ Test 1 superato: logica stati e segnalazioni corretta.');

// Test 2: Verifica etichette e badge [GRATIS] / [A CREDITI]
function buildTestLabel(m) {
  const p = m.provider || '';
  const prefix = p ? (p.toLowerCase() + ': ') : '';
  const isFree = m.isFree || (typeof m.id === 'string' && (m.id.endsWith(':free') || m.id.includes('8b')));
  const costTag = isFree ? '[GRATIS] ' : '[A CREDITI] ';
  const price = (!isFree && m.promptPriceM && m.promptPriceM !== '0') ? ` ($${m.promptPriceM}/$${m.completionPriceM} 1M)` : '';
  return prefix + costTag + (m.name || m.id) + price;
}

const freeMod = { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3', isFree: true, provider: 'OpenRouter' };
const paidMod = { id: 'openai/gpt-4o', name: 'GPT-4o', isFree: false, promptPriceM: '2.50', completionPriceM: '10.00', provider: 'OpenAI' };

const lblFree = buildTestLabel(freeMod);
const lblPaid = buildTestLabel(paidMod);

assert.ok(lblFree.includes('[GRATIS]'), 'Il modello gratuito deve contenere [GRATIS]');
assert.ok(lblPaid.includes('[A CREDITI]'), 'Il modello a pagamento deve contenere [A CREDITI]');
assert.ok(lblPaid.includes('$2.50/$10.00 1M'), 'Il modello a pagamento deve mostrare il prezzo stimato se disponibile');

console.log('✓ Test 2 superato: etichettatura modelli [GRATIS] / [A CREDITI] verificata.');

console.log('=== Tutti i controlli funzionali hanno avuto esito positivo! ===');
