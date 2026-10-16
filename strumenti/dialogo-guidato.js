// Protocollo strutturato fra Adam e lo Studio per chiarimenti bloccanti e piani.
// Gli envelope restano fuori dal testo mostrato all'utente.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VERSIONE = 1;
const MAX_DOMANDA = 500;
const MAX_OPZIONI = 4;
const MAX_ETICHETTA = 100;
const MAX_DESCRIZIONE = 240;
const MAX_CUSTOM = 1000;
const DURATA_MS = 24 * 60 * 60 * 1000;

function testo(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function idSicuro(value) {
  const id = testo(value, 80);
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,79}$/.test(id) ? id : '';
}

function validaChiarimento(payload) {
  if (!payload || payload.version !== VERSIONE || payload.type !== 'clarification') {
    return { ok: false, error: 'Envelope di chiarimento non valido' };
  }
  const domanda = testo(payload.question, MAX_DOMANDA);
  const raw = Array.isArray(payload.options) ? payload.options : [];
  if (!domanda || raw.length < 2 || raw.length > MAX_OPZIONI) {
    return { ok: false, error: 'Servono una domanda e da 2 a 4 opzioni' };
  }
  const ids = new Set();
  const options = [];
  for (const item of raw) {
    const id = idSicuro(item && item.id);
    const label = testo(item && item.label, MAX_ETICHETTA);
    if (!id || !label || ids.has(id)) return { ok: false, error: 'Opzioni non valide o duplicate' };
    ids.add(id);
    options.push({ id, label, description: testo(item.description, MAX_DESCRIZIONE) });
  }
  const current = Math.max(1, Math.min(99, Number(payload.step && payload.step.current) || 1));
  const total = Math.max(current, Math.min(99, Number(payload.step && payload.step.total) || current));
  return { ok: true, value: {
    version: VERSIONE, type: 'clarification', question: domanda, options,
    allowCustom: payload.allowCustom === true, step: { current, total }
  } };
}

function validaPiano(payload) {
  if (!payload || payload.version !== VERSIONE || payload.type !== 'plan') {
    return { ok: false, error: 'Envelope piano non valido' };
  }
  const title = testo(payload.title, 180);
  const steps = (Array.isArray(payload.steps) ? payload.steps : [])
    .map(function (step) { return testo(typeof step === 'string' ? step : step && step.text, 300); })
    .filter(Boolean).slice(0, 12);
  if (!title || steps.length < 2) return { ok: false, error: 'Il piano richiede un titolo e almeno due passi' };
  return { ok: true, value: { version: VERSIONE, type: 'plan', title, steps } };
}

// Formato deliberatamente unico e facile da rimuovere dal testo visibile.
function estraiEnvelope(input) {
  let testoVisibile = String(input || '');
  const envelopes = [];
  const re = /```adam-envelope\s*\r?\n([\s\S]*?)```/gi;
  testoVisibile = testoVisibile.replace(re, function (_, json) {
    try {
      const parsed = JSON.parse(json);
      const result = parsed && parsed.type === 'clarification' ? validaChiarimento(parsed) : validaPiano(parsed);
      if (result.ok) envelopes.push(result.value);
    } catch (_) {}
    return '';
  });
  return { text: testoVisibile.replace(/\n{3,}/g, '\n\n').trim(), envelopes };
}

function nuovoId() { return 'choice_' + crypto.randomBytes(10).toString('hex'); }

function creaInterazione(payload, now) {
  const check = validaChiarimento(payload);
  if (!check.ok) return check;
  const createdAt = Number(now) || Date.now();
  return { ok: true, value: Object.assign({}, check.value, {
    id: nuovoId(), status: 'pending', createdAt, expiresAt: createdAt + DURATA_MS,
    resolvedAt: null, answer: null
  }) };
}

function risolvi(interaction, answer, now) {
  const quando = Number(now) || Date.now();
  if (!interaction || !idSicuro(interaction.id)) return { ok: false, error: 'Scelta non riconosciuta' };
  if (interaction.status !== 'pending') return { ok: false, error: 'Questa scelta è già stata inviata' };
  if (interaction.expiresAt <= quando) return { ok: false, error: 'Questa scelta è scaduta' };
  const optionId = idSicuro(answer && answer.optionId);
  const custom = testo(answer && answer.custom, MAX_CUSTOM);
  const option = interaction.options.find(function (item) { return item.id === optionId; });
  if (!option && !(interaction.allowCustom && custom)) return { ok: false, error: 'Risposta non valida' };
  interaction.status = 'resolved';
  interaction.resolvedAt = quando;
  interaction.answer = option ? { optionId: option.id, label: option.label } : { custom };
  return { ok: true, value: interaction.answer };
}

function fileStato(projectDir, conversationId) {
  const hash = crypto.createHash('sha1').update(path.resolve(projectDir).toLowerCase()).digest('hex').slice(0, 16);
  return path.join(__dirname, '..', 'dati', 'dialoghi', hash, String(conversationId || 'corrente') + '.json');
}

function salva(projectDir, conversationId, interactions) {
  const file = fileStato(projectDir, conversationId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: VERSIONE, interactions: interactions || [] }, null, 2));
  return file;
}

function carica(projectDir, conversationId) {
  try {
    const data = JSON.parse(fs.readFileSync(fileStato(projectDir, conversationId), 'utf8'));
    return data.version === VERSIONE && Array.isArray(data.interactions) ? data.interactions : [];
  } catch (_) { return []; }
}

function isNemotronNvidia(provider, model) {
  return String(provider || '').trim().toLowerCase() === 'nvidia' &&
    /(?:^|[\/:._-])nemotron(?:[\/:._-]|$)/i.test(String(model || '').trim());
}

function istruzioniPrompt(provider, model) {
  const istruzioni = [
    'DIALOGO GUIDATO DELLO STUDIO:',
    'Se una scelta materialmente rilevante non e deducibile, fermati e fai UNA domanda. Non farlo per letture o tool innocui.',
    'Alla fine della risposta emetti un blocco ```adam-envelope con JSON: {"version":1,"type":"clarification","question":"...","options":[{"id":"...","label":"...","description":"..."}],"allowCustom":false,"step":{"current":1,"total":1}}.',
    'Usa 2-4 opzioni. Puoi concatenare chiarimenti: dopo la scelta riceverai la risposta e potrai emettere il passo successivo.',
    'Dopo i chiarimenti, prima di lavorare emetti il piano: {"version":1,"type":"plan","title":"...","steps":["...","..."]} nello stesso tipo di blocco.',
    'Il JSON e solo per lo Studio: accompagna il chiarimento con una frase breve, senza mostrare o spiegare il protocollo.'
  ];
  if (isNemotronNvidia(provider, model)) {
    istruzioni.push(
      'REGOLA SPECIFICA NVIDIA NEMOTRON: quando serve un chiarimento, il blocco ```adam-envelope deve comparire LETTERALMENTE nel testo della tua risposta finale.',
      'NON usare Bash, echo, Write, Skill o altri strumenti per creare, stampare o salvare l\'envelope: lo Studio legge esclusivamente il testo restituito all\'utente.',
      'Dopo il blocco envelope termina la risposta. Non chiamare strumenti e non dichiarare di avere emesso il chiarimento se il blocco non e presente nel testo finale.'
    );
  }
  return istruzioni.join('\n');
}

module.exports = {
  VERSIONE, validaChiarimento, validaPiano, estraiEnvelope, creaInterazione, risolvi,
  salva, carica, istruzioniPrompt, isNemotronNvidia
};
