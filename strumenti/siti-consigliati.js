// NotExist Intelligience Studio - Siti e fonti web consigliati per Adam.
//
// L'utente indica i siti o la documentazione da consultare quando Adam deve
// creare componenti o affrontare argomenti su cui non ha addestramento sufficiente.
// I siti vengono conservati su disco e iniettati nel prompt di sistema.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE_PREDEFINITO = path.join(__dirname, '..', 'dati', 'siti-consigliati.json');
const MAX_SITI = 50;

function normalizzaUrl(raw) {
  let u = String(raw || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) {
    u = 'https://' + u;
  }
  try {
    const parsed = new URL(u);
    if (!parsed.hostname) return '';
    if (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') return '';
    return parsed.href;
  } catch (e) {
    return '';
  }
}

function validaSito(dati) {
  if (!dati || typeof dati !== 'object') return { errore: 'dati sito non validi' };
  const url = normalizzaUrl(dati.url);
  if (!url) return { errore: 'URL non valido (es. https://developer.mozilla.org)' };
  
  const descrizione = String(dati.descrizione || dati.note || dati.titolo || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const tag = Array.isArray(dati.tag) ? dati.tag.map(t => String(t).trim()).filter(Boolean).slice(0, 10) : [];
  
  return {
    sito: {
      id: dati.id || ('site_' + crypto.randomBytes(4).toString('hex')),
      url: url,
      descrizione: descrizione,
      tag: tag,
      aggiuntoIl: dati.aggiuntoIl || Date.now()
    }
  };
}

function carica(file) {
  const f = file || FILE_PREDEFINITO;
  try {
    if (!fs.existsSync(f)) return { siti: [] };
    const dati = JSON.parse(fs.readFileSync(f, 'utf8'));
    return {
      siti: Array.isArray(dati.siti) ? dati.siti : []
    };
  } catch (e) {
    return { siti: [] };
  }
}

function salva(stato, file) {
  const f = file || FILE_PREDEFINITO;
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(stato, null, 2), 'utf8');
  return stato;
}

function aggiungi(dati, file) {
  const v = validaSito(dati);
  if (v.errore) return { errore: v.errore };

  const stato = carica(file);
  const siti = stato.siti || [];
  if (siti.length >= MAX_SITI) {
    return { errore: 'Raggiunto il limite massimo di ' + MAX_SITI + ' siti consigliati' };
  }

  // Se esiste già lo stesso URL, aggiorniamo la descrizione
  const idx = siti.findIndex(s => s.url.toLowerCase() === v.sito.url.toLowerCase());
  if (idx !== -1) {
    siti[idx].descrizione = v.sito.descrizione || siti[idx].descrizione;
    siti[idx].aggiornatoIl = Date.now();
  } else {
    siti.unshift(v.sito);
  }

  salva({ siti: siti }, file);
  return { ok: true, sito: idx !== -1 ? siti[idx] : v.sito, totale: siti.length };
}

function rimuovi(id, file) {
  if (!id) return { errore: 'ID sito mancante' };
  const stato = carica(file);
  const prima = (stato.siti || []).length;
  const puliti = (stato.siti || []).filter(s => s.id !== id && s.url !== id);
  if (puliti.length === prima) {
    return { errore: 'Sito non trovato' };
  }
  salva({ siti: puliti }, file);
  return { ok: true, rimosso: id, totale: puliti.length };
}

// Genera la sezione di testo formattata per il prompt di sistema di Adam
function testoPerPrompt(file) {
  const stato = carica(file);
  const siti = (stato.siti || []).filter(s => s && s.url);
  if (!siti.length) return '';

  const righe = siti.map(function (s, i) {
    const desc = s.descrizione ? ' - ' + s.descrizione : '';
    return (i + 1) + '. ' + s.url + desc;
  });

  return 'SITI E FONTI WEB CONSIGLIATI DALL\'UTENTE:\n' +
    'L\'utente ti raccomanda di consultare prioritariamente questi siti/documentazioni quando cerchi risposte, esempi, librerie o il componente che manca:\n' +
    righe.join('\n') + '\n' +
    'Puoi consultare queste fonti o cercare sul web con lo strumento Bash eseguendo il comando di ricerca e visita web.';
}

module.exports = {
  FILE_PREDEFINITO,
  MAX_SITI,
  normalizzaUrl,
  validaSito,
  carica,
  salva,
  aggiungi,
  rimuovi,
  testoPerPrompt
};
