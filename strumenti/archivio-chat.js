// NotExist Intelligience Studio - Chat salvate, memoria esplorabile.
//
// Con un modello locale il contesto e' piccolo (49152 token) e quando si riempie lo Studio
// deve aprire una sessione nuova: finora le passava un riassunto di poche righe e tutto il
// resto della conversazione andava perso per Adam. Qui ogni conversazione diventa un file di
// testo, aggiornato a fine turno. Le chat "collegate" sono elencate nel prompt di Adam con il
// loro percorso: non gliele si passa intere (riempirebbero di nuovo il contesto), le esplora
// lui con Grep e Read quando gli serve sapere cosa e' stato chiesto, fatto o deciso.
//
// Una conversazione = cio' che l'utente vede nella chat, anche attraverso i rinnovi di
// sessione: finisce in un file solo.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CARTELLA_DATI = path.join(__dirname, '..', 'dati', 'chat');
const NOME_VALIDO = /^[\w-]+\.md$/;
const MAX_NEL_PROMPT = 10;

function cartellaProgetto(dir, base) {
  const chiave = crypto.createHash('sha1').update(path.resolve(dir).toLowerCase()).digest('hex').slice(0, 16);
  return path.join(base || CARTELLA_DATI, chiave);
}

function due(n) { return (n < 10 ? '0' : '') + n; }

function dataOra(ts) {
  const d = new Date(ts || Date.now());
  return d.getFullYear() + '-' + due(d.getMonth() + 1) + '-' + due(d.getDate()) + ' ' + due(d.getHours()) + ':' + due(d.getMinutes());
}

function nuovoId() {
  const d = new Date();
  return d.getFullYear() + '-' + due(d.getMonth() + 1) + '-' + due(d.getDate()) + '_' +
    due(d.getHours()) + '-' + due(d.getMinutes()) + '-' + due(d.getSeconds()) + '_' +
    crypto.randomBytes(2).toString('hex');
}

function testoDi(m) {
  return (m.blocks || [])
    .filter(function (b) { return b.kind === 'text' && b.text; })
    .map(function (b) { return b.text; })
    .join('\n').trim();
}

// Il primo messaggio scritto davvero dall'utente: e' l'argomento della conversazione.
function titoloDa(messaggi) {
  const primo = (messaggi || []).find(function (m) { return m.role === 'user' && !m.auto && testoDi(m); });
  const t = primo ? testoDi(primo).replace(/\s+/g, ' ') : '';
  return t ? (t.length > 80 ? t.slice(0, 79) + '…' : t) : 'Conversazione';
}

function riassuntoStrumento(b) {
  const i = b.input || {};
  const chiave = ['file_path', 'path', 'command', 'pattern', 'query', 'url'].find(function (k) { return i[k]; });
  const dettaglio = chiave ? String(i[chiave]).split('\n')[0].slice(0, 140) : '';
  return '- strumento ' + b.name + (dettaglio ? ': ' + dettaglio : '') + (b.isError ? ' (errore)' : '');
}

// Testo leggibile e cercabile con Grep: chi ha detto cosa, quando, quali file ha toccato.
// Il ragionamento interno si omette (lungo e poco utile da ritrovare); i messaggi che lo
// Studio manda ad Adam (misure, collaudi) si accorciano.
function inMarkdown(messaggi, info) {
  const o = info || {};
  const righe = ['# ' + titoloDa(messaggi), ''];
  if (o.progetto) righe.push('Progetto: ' + o.progetto);
  if (o.modello) righe.push('Modello: ' + o.modello);
  righe.push('');
  (messaggi || []).forEach(function (m) {
    const ora = dataOra(m.ts).slice(11);
    if (m.role === 'user') {
      const t = testoDi(m);
      if (!t) return;
      if (m.auto) {
        righe.push('### Studio -> Adam, ' + ora + (m.reason ? ' (' + m.reason + ')' : ''));
        righe.push(t.length > 2000 ? t.slice(0, 2000) + '\n[...accorciato]' : t);
      } else {
        righe.push('### Utente, ' + ora);
        righe.push(t);
      }
      righe.push('');
    } else if (m.role === 'assistant') {
      const parti = [];
      (m.blocks || []).forEach(function (b) {
        if (b.kind === 'text' && b.text && b.text.trim()) parti.push(b.text.trim());
        else if (b.kind === 'tool') parti.push(riassuntoStrumento(b));
      });
      if (!parti.length) return;
      righe.push('### Adam, ' + ora);
      righe.push(parti.join('\n'));
      righe.push('');
    } else if (m.role === 'system') {
      const t = testoDi(m);
      if (t) righe.push('> Sistema, ' + ora + ': ' + t.replace(/\n/g, ' ').slice(0, 600), '');
    } else if (m.role === 'progress') {
      righe.push('> Verifica, ' + ora + ': ' + (m.titolo || '') + (m.riassunto ? ' - ' + m.riassunto : '') +
        (m.focus ? ' Focus: ' + m.focus : ''), '');
    }
  });
  return righe.join('\n');
}

function leggiIndice(cartella) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(cartella, 'indice.json'), 'utf8'));
    return d && Array.isArray(d.chat) ? d : { chat: [] };
  } catch (e) {
    return { chat: [] };
  }
}

function scriviIndice(cartella, indice) {
  fs.mkdirSync(cartella, { recursive: true });
  fs.writeFileSync(path.join(cartella, 'indice.json'), JSON.stringify(indice, null, 2));
}

// Salva (o aggiorna) la conversazione id. Senza nulla detto dall'utente o da Adam non si
// scrive niente: una chat vuota non e' memoria.
function salva(dir, id, messaggi, info, base) {
  const utili = (messaggi || []).filter(function (m) {
    return (m.role === 'user' || m.role === 'assistant') && (testoDi(m) || (m.blocks || []).some(function (b) { return b.kind === 'tool'; }));
  });
  if (!utili.length) return null;
  const cartella = cartellaProgetto(dir, base);
  fs.mkdirSync(cartella, { recursive: true });
  const file = id + '.md';
  const percorso = path.join(cartella, file);
  fs.writeFileSync(percorso, inMarkdown(messaggi, info));
  const indice = leggiIndice(cartella);
  const esistente = indice.chat.find(function (c) { return c.file === file; });
  const voce = {
    file: file,
    titolo: titoloDa(messaggi),
    inizio: (messaggi[0] && messaggi[0].ts) || Date.now(),
    fine: Date.now(),
    messaggi: utili.length,
    collegata: esistente ? esistente.collegata !== false : true
  };
  if (esistente) Object.assign(esistente, voce);
  else indice.chat.push(voce);
  scriviIndice(cartella, indice);
  return { file: file, percorso: percorso };
}

// Le piu' recenti per prime, con il percorso completo.
function elenco(dir, base) {
  const cartella = cartellaProgetto(dir, base);
  return leggiIndice(cartella).chat
    .filter(function (c) { return NOME_VALIDO.test(c.file) && fs.existsSync(path.join(cartella, c.file)); })
    .sort(function (a, b) { return (b.fine || 0) - (a.fine || 0); })
    .map(function (c) { return Object.assign({}, c, { percorso: path.join(cartella, c.file) }); });
}

function collega(dir, file, collegata, base) {
  const cartella = cartellaProgetto(dir, base);
  const indice = leggiIndice(cartella);
  const voce = indice.chat.find(function (c) { return c.file === file; });
  if (!voce) return false;
  voce.collegata = !!collegata;
  scriviIndice(cartella, indice);
  return true;
}

// Solo file dell'indice di questo progetto: niente percorsi costruiti dalla richiesta.
function leggi(dir, file, base) {
  if (!NOME_VALIDO.test(String(file || ''))) return null;
  const cartella = cartellaProgetto(dir, base);
  if (!leggiIndice(cartella).chat.some(function (c) { return c.file === file; })) return null;
  try { return fs.readFileSync(path.join(cartella, file), 'utf8'); } catch (e) { return null; }
}

// La sezione del prompt di Adam: dove sono le chat collegate e come usarle.
function testoPerPrompt(dir, idCorrente, base) {
  const collegate = elenco(dir, base).filter(function (c) { return c.collegata !== false; }).slice(0, MAX_NEL_PROMPT);
  if (!collegate.length) return '';
  const slash = function (p) { return String(p).split(path.sep).join('/'); };
  const corrente = idCorrente ? idCorrente + '.md' : '';
  return [
    'CONVERSAZIONI PRECEDENTI (memoria che puoi esplorare): le chat di questo progetto sono salvate come file di ' +
      'testo in ' + slash(cartellaProgetto(dir, base)) + '.',
    collegate.map(function (c) {
      return '- ' + dataOra(c.inizio) + ', ' + c.messaggi + ' messaggi' + (c.file === corrente ? ' (questa conversazione, prima del rinnovo)' : '') +
        ': "' + c.titolo + '" -> ' + slash(c.percorso);
    }).join('\n'),
    'Se ti serve sapere cosa e\' stato chiesto, fatto o deciso prima, cercalo con Grep in quella cartella (per esempio il ' +
      'nome di un file o di una funzione) e leggi solo le righe che servono con Read, offset e limit. Non leggere i file interi.'
  ].join('\n');
}

module.exports = {
  CARTELLA_DATI,
  cartellaProgetto,
  nuovoId,
  titoloDa,
  inMarkdown,
  salva,
  elenco,
  collega,
  leggi,
  testoPerPrompt,
  dataOra
};
