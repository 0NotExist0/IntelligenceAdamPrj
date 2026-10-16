const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const dialogo = require('../strumenti/dialogo-guidato');

function clarification(overrides) {
  return Object.assign({
    version: 1, type: 'clarification', question: 'Quale destinazione preferisci?',
    options: [
      { id: 'locale', label: 'Solo locale', description: 'I dati restano sul computer.' },
      { id: 'cloud', label: 'Servizio cloud', description: 'Consente la condivisione.' }
    ], allowCustom: false, step: { current: 1, total: 2 }
  }, overrides || {});
}

assert.equal(dialogo.validaChiarimento(clarification()).ok, true);
assert.equal(dialogo.validaChiarimento(clarification({ options: [{ id: 'uno', label: 'Uno' }] })).ok, false);
assert.equal(dialogo.validaChiarimento(clarification({ options: [
  { id: 'same', label: 'Uno' }, { id: 'same', label: 'Due' }
] })).ok, false, 'rifiuta ID duplicati');
assert.equal(dialogo.validaChiarimento(clarification({ options: new Array(5).fill(0).map((_, i) => ({ id: 'id' + i, label: 'x' })) })).ok, false);

const raw = 'Dimmi la destinazione.\n```adam-envelope\n' + JSON.stringify(clarification()) + '\n```';
const parsed = dialogo.estraiEnvelope(raw);
assert.equal(parsed.text, 'Dimmi la destinazione.');
assert.equal(parsed.envelopes.length, 1);

const created = dialogo.creaInterazione(clarification(), 1000).value;
assert.equal(dialogo.risolvi(created, { optionId: 'falso' }, 1100).ok, false, 'rifiuta scelta contraffatta');
assert.equal(dialogo.risolvi(created, { optionId: 'locale' }, 1100).ok, true);
assert.equal(dialogo.risolvi(created, { optionId: 'cloud' }, 1200).ok, false, 'risoluzione singola');
const expired = dialogo.creaInterazione(clarification(), 1000).value;
assert.equal(dialogo.risolvi(expired, { optionId: 'locale' }, expired.expiresAt + 1).ok, false, 'rifiuta scaduta');

const custom = dialogo.creaInterazione(clarification({ allowCustom: true }), 1000).value;
assert.equal(dialogo.risolvi(custom, { custom: 'Un server privato' }, 1200).ok, true);
const step2 = dialogo.creaInterazione(clarification({ question: 'Quale formato?', step: { current: 2, total: 2 } })).value;
assert.equal(step2.step.current, 2, 'supporta chiarimenti consecutivi');
assert.equal(dialogo.validaPiano({ version: 1, type: 'plan', title: 'Consegna PDF', steps: ['Prepara', 'Verifica'] }).ok, true);

assert.equal(dialogo.isNemotronNvidia('nvidia', 'nvidia/nemotron-3-ultra-550b-a55b'), true,
  'riconosce Nemotron servito direttamente da NVIDIA');
assert.equal(dialogo.isNemotronNvidia('openrouter', 'nvidia/nemotron-3-ultra-550b-a55b'), false,
  'non applica la regola speciale a provider diversi');
assert.equal(dialogo.isNemotronNvidia('nvidia', 'meta/llama-3.3-70b-instruct'), false,
  'non applica la regola speciale agli altri modelli NVIDIA');
const promptNemotron = dialogo.istruzioniPrompt('nvidia', 'nvidia/nemotron-3-ultra-550b-a55b');
assert.match(promptNemotron, /LETTERALMENTE/);
assert.match(promptNemotron, /NON usare Bash, echo, Write, Skill/);
assert.doesNotMatch(dialogo.istruzioniPrompt('openrouter', 'openai/gpt-oss-120b'), /REGOLA SPECIFICA NVIDIA NEMOTRON/,
  'GPT-OSS e gli altri modelli restano invariati');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dialogo-guidato-'));
const file = dialogo.salva(temp, 'conv-test', [created, step2]);
assert.equal(fs.existsSync(file), true);
assert.equal(dialogo.carica(temp, 'conv-test').length, 2, 'persistenza conversazione/progetto');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'chat-ui.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
assert(server.includes("parsed.type === 'chat-choice'"));
assert(server.includes("item.status === 'pending'"), 'un piano non passa con chiarimenti aperti');
assert(server.includes('MODALITA FUOCO NEMOTRON'), 'un nuovo compito Nemotron apre una sessione pulita');
assert(server.includes("? ''\n    : archivioChat.testoPerPrompt"), 'Nemotron non riceve l indice delle vecchie chat');
assert(ui.includes('creaElementoInterazione'));
assert(ui.includes('node.disabled = true'), 'la UI disabilita dopo la scelta');
assert(ui.includes("case 'choice-error'"));
assert(ui.includes("aria-describedby"), 'l errore custom e associato al campo');
assert(ui.includes("msg.recoverable"), 'un rifiuto recuperabile riattiva la scelta');
assert(ui.includes("option.label"), 'la conferma usa la sola etichetta');
assert(css.includes('@media (max-width: 600px)'));
assert(css.includes('transform: translateX(-105%)'), 'la sidebar mobile diventa un drawer chiuso');

console.log('dialogo-guidato.test.js: tutti i test superati');
