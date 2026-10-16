'use strict';

const MOTIVO_NESSUNA_AZIONE = 'GPT-OSS ha descritto il lavoro senza eseguirlo';

function isGptOssModel(model) {
  return /(?:^|[\/:])(?:openai[\/])?gpt[-_.]?oss(?:[-_.:/]|$)/i.test(String(model || '').trim());
}

function richiedeProxyStrumenti(provider, model) {
  return String(provider || '').toLowerCase() === 'openrouter' && isGptOssModel(model);
}

function richiestaOperativa(testo) {
  const richiesta = String(testo || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!richiesta) return false;
  if (/\b(?:non|senza)\s+(?:modificare|cambiare|toccare|scrivere|eseguire)\b/.test(richiesta)) return false;
  if (/\b(?:solo\s+(?:analisi|diagnosi|review|revisione)|dimmi\s+come|spiegami\s+come|fammi\s+un\s+piano|crea\s+un\s+piano|write\s+a\s+plan|review\s+only|do\s+not\s+(?:edit|change|modify))\b/.test(richiesta)) return false;
  return /\b(?:crea|aggiungi|modifica|cambia|correggi|sistema|risolvi|implementa|integra|rimuovi|elimina|installa|aggiorna|rifattorizza|costruisci|genera|scrivi|sposta|rinomina|converti|configura|collega|avvia|esegui|pubblica|adatta|create|add|edit|change|fix|implement|integrate|remove|delete|install|update|refactor|build|generate|write|move|rename|convert|configure|connect|run|deploy)\b/.test(richiesta);
}

function motivoSenzaAzione(options) {
  const opts = options || {};
  if (!isGptOssModel(opts.model) || !richiestaOperativa(opts.request)) return null;
  const evidence = opts.evidence || {};
  if (Number(evidence.azioni || 0) > 0 || Number(evidence.scritture || 0) > 0) return null;
  return MOTIVO_NESSUNA_AZIONE;
}

function istruzioniPrompt(model) {
  if (!isGptOssModel(model)) return '';
  return [
    'MODALITA GPT-OSS OPERATIVA (OBBLIGATORIA):',
    'Se l\'utente chiede di creare, modificare, correggere, installare o eseguire qualcosa, non limitarti a individuare il punto o a spiegare come dovrebbe farlo.',
    'Usa gli strumenti nello stesso turno e porta a termine concretamente il lavoro. Una diagnosi o una lista di istruzioni non e\' una risposta finale.',
    'Puoi concludere solo dopo avere eseguito almeno un\'azione reale pertinente e, quando possibile, averne verificato il risultato.'
  ].join('\n');
}

module.exports = {
  MOTIVO_NESSUNA_AZIONE,
  isGptOssModel,
  richiedeProxyStrumenti,
  richiestaOperativa,
  motivoSenzaAzione,
  istruzioniPrompt
};
