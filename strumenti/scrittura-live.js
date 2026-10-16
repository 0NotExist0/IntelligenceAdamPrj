// NotExist Intelligience Studio - Il file che si scrive sotto gli occhi.
//
// Richiesta dell'utente (17/9/2026): "devo vedere il live del file mentre lo sta lavorando, se no
// non so come viene scritto o come viene modificato".
//
// Si puo' fare, e senza aspettare che il file finisca su disco: Claude Code e' avviato con
// --include-partial-messages, quindi mentre Adam scrive un file lo Studio riceve gia' i pezzi
// dell'input dello strumento (`content_block_delta` con `partial_json`). Finora quei pezzi
// servivano solo a contare i caratteri.
//
// Il problema e' che arrivano come JSON A META': {"file_path":"...","content":"body {\n  col
// Non si puo' fare JSON.parse finche' non e' completo. Qui il valore si estrae a mano, pezzo per
// pezzo, fermandosi all'ultimo escape completo: cosi' l'utente vede il testo crescere riga per
// riga invece di aspettare la fine.
//
// Vale per Write (campo "content"), per Edit ("old_string" e "new_string") e per MultiEdit.

// Il campo che contiene il testo da mostrare, per ogni strumento.
const CAMPO = {
  Write: 'content',
  Edit: 'new_string',
  MultiEdit: 'new_string',
  NotebookEdit: 'new_source'
};

function nuovaScrittura(strumento) {
  return {
    strumento: String(strumento || ''),
    campo: CAMPO[strumento] || 'content',
    grezzo: '',
    file: '',
    testo: '',
    vecchio: '',
    completa: false
  };
}

// Dove comincia il valore di una chiave dentro un JSON (anche a meta'): l'indice del primo
// carattere DOPO la virgoletta di apertura, o -1 se la chiave non c'e' ancora.
function inizioValore(grezzo, chiave) {
  const marca = '"' + chiave + '"';
  let i = grezzo.indexOf(marca);
  if (i === -1) return -1;
  i += marca.length;
  while (i < grezzo.length && /\s/.test(grezzo[i])) i++;
  if (grezzo[i] !== ':') return -1;
  i++;
  while (i < grezzo.length && /\s/.test(grezzo[i])) i++;
  if (grezzo[i] !== '"') return -1;
  return i + 1;
}

// Legge una stringa JSON a partire da `da`, fino alla virgoletta di chiusura o alla fine di
// quello che e' arrivato. Restituisce { testo, chiusa }.
function leggiStringa(grezzo, da) {
  let out = '';
  let i = da;
  while (i < grezzo.length) {
    const c = grezzo[i];
    if (c === '"') return { testo: out, chiusa: true };
    if (c !== '\\') { out += c; i++; continue; }
    // Un escape a meta' (l'ultimo carattere e' la barra): si aspetta il pezzo dopo.
    if (i + 1 >= grezzo.length) return { testo: out, chiusa: false };
    const d = grezzo[i + 1];
    if (d === 'n') { out += '\n'; i += 2; continue; }
    if (d === 't') { out += '\t'; i += 2; continue; }
    if (d === 'r') { out += '\r'; i += 2; continue; }
    if (d === 'b') { out += '\b'; i += 2; continue; }
    if (d === 'f') { out += '\f'; i += 2; continue; }
    if (d === '"' || d === '\\' || d === '/') { out += d; i += 2; continue; }
    if (d === 'u') {
      if (i + 5 >= grezzo.length) return { testo: out, chiusa: false };   // \uXX ancora incompleto
      const esa = grezzo.slice(i + 2, i + 6);
      if (/^[0-9a-fA-F]{4}$/.test(esa)) { out += String.fromCharCode(parseInt(esa, 16)); i += 6; continue; }
      out += d; i += 2; continue;
    }
    out += d; i += 2;
  }
  return { testo: out, chiusa: false };
}

function valoreDi(grezzo, chiave) {
  const da = inizioValore(grezzo, chiave);
  if (da === -1) return null;
  return leggiStringa(grezzo, da);
}

// Un pezzo di JSON in arrivo. Restituisce true se c'e' qualcosa di nuovo da mostrare.
function aggiungi(stato, pezzo) {
  if (!stato) return false;
  stato.grezzo += String(pezzo || '');
  const primaFile = stato.file;
  const primaTesto = stato.testo;
  const file = valoreDi(stato.grezzo, 'file_path') || valoreDi(stato.grezzo, 'notebook_path');
  if (file && file.chiusa) stato.file = file.testo;
  const testo = valoreDi(stato.grezzo, stato.campo);
  if (testo) stato.testo = testo.testo;
  // Per Edit serve anche il pezzo che verra' sostituito: e' quello che sparisce dal file.
  if (stato.strumento === 'Edit' || stato.strumento === 'MultiEdit') {
    const vecchio = valoreDi(stato.grezzo, 'old_string');
    if (vecchio) stato.vecchio = vecchio.testo;
  }
  return stato.file !== primaFile || stato.testo !== primaTesto;
}

function chiudi(stato) {
  if (!stato) return null;
  stato.completa = true;
  // A fine blocco il JSON e' intero: se si riesce a leggerlo, si prendono i valori veri.
  try {
    const dati = JSON.parse(stato.grezzo);
    if (dati && typeof dati === 'object') {
      if (typeof dati.file_path === 'string') stato.file = dati.file_path;
      if (typeof dati.notebook_path === 'string') stato.file = dati.notebook_path;
      if (typeof dati[stato.campo] === 'string') stato.testo = dati[stato.campo];
      if (typeof dati.old_string === 'string') stato.vecchio = dati.old_string;
    }
  } catch (e) { /* JSON incompleto: restano i valori letti pezzo per pezzo */ }
  return stato;
}

// Cosa mandare al pannello dell'utente: poche righe di stato piu' il testo.
function istantanea(stato, opzioni) {
  opzioni = opzioni || {};
  if (!stato) return null;
  const testo = String(stato.testo || '');
  const massimo = opzioni.massimo || 120000;    // oltre, si manda la coda: e' li' che si sta scrivendo
  return {
    strumento: stato.strumento,
    file: stato.file || '',
    campo: stato.campo,
    testo: testo.length > massimo ? testo.slice(testo.length - massimo) : testo,
    tagliato: testo.length > massimo,
    caratteri: testo.length,
    righe: testo ? testo.split('\n').length : 0,
    vecchio: String(stato.vecchio || '').slice(0, 4000),
    completa: !!stato.completa
  };
}

module.exports = {
  nuovaScrittura: nuovaScrittura,
  aggiungi: aggiungi,
  chiudi: chiudi,
  istantanea: istantanea,
  valoreDi: valoreDi,
  leggiStringa: leggiStringa,
  inizioValore: inizioValore,
  CAMPO: CAMPO
};
