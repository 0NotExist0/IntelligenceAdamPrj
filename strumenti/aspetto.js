// NotExist Intelligience Studio - L'aspetto di una pagina, misurato e confrontato con l'ultima volta.
//
// 17/9/2026: la pagina del curriculum perde tutto il CSS e diventa bianca. L'utente lo vede subito
// ("il css e' rotto, non e' piu' lo stile di prima"); lo Studio invece ha risposto tre volte
// "Nessun difetto misurato", perche' la sonda cerca errori JavaScript, console e schermo vuoto -
// e li' non c'era niente di tutto questo: una pagina senza stile e' una pagina che funziona.
// Adam, letto quel "nessun difetto", si e' convinto che il problema fosse altrove.
//
// Manca il confronto con com'era PRIMA. Qui si misurano quattro cose banali (quante regole di
// stile sono davvero applicate, quanti fogli, che sfondo e che colore di testo ha il corpo della
// pagina) e si tengono da parte: alla misura dopo, se le regole crollano o un foglio sparisce, e'
// un fatto, con i numeri, non un'impressione.
//
// Prudenza: uno stile rifatto apposta fa calare i numeri in modo legittimo. Per questo la nota dice
// cosa e' cambiato e da quando, senza dare del rotto a nessuno: e' Adam che deve guardare
// cambiamenti.js e decidere. Meglio una frase in piu' che un falso "GRAVE" su codice giusto.

const fs = require('fs');
const path = require('path');

const MAX_PER_PAGINA = 5;

// Crollo dello stile: soglie alte di proposito. Sotto le 30 regole non si dice niente
// (una paginetta con dieci regole ne perde tre per un nulla).
const REGOLE_MINIME = 30;
const QUOTA_CROLLO = 0.35;

// Gira DENTRO la pagina (page.evaluate). Niente parametri: deve poter essere passata cosi' com'e'.
function misuraNellaPagina() {
  let regole = 0;
  let fogli = 0;
  let esterni = 0;
  const lista = document.styleSheets || [];
  for (let i = 0; i < lista.length; i++) {
    const ss = lista[i];
    fogli++;
    if (ss.href) esterni++;
    try { regole += ss.cssRules ? ss.cssRules.length : 0; } catch (e) { /* foglio di un altro dominio */ }
  }
  const corpo = document.body ? getComputedStyle(document.body) : null;
  const radice = document.documentElement ? getComputedStyle(document.documentElement) : null;
  return {
    regole: regole,
    fogli: fogli,
    esterni: esterni,
    sfondo: corpo ? corpo.backgroundColor : '',
    sfondoRadice: radice ? radice.backgroundColor : '',
    colore: corpo ? corpo.color : '',
    font: corpo ? String(corpo.fontFamily || '').split(',')[0].replace(/["']/g, '').trim() : '',
    elementi: document.querySelectorAll('*').length
  };
}

function fileAspetto(dir, base) {
  return path.join(require('./cervello-comandi').cartellaProgetto(dir, base), 'aspetto.json');
}

function leggiTutto(dir, base) {
  try {
    const d = JSON.parse(fs.readFileSync(fileAspetto(dir, base), 'utf8'));
    return d && typeof d.pagine === 'object' && d.pagine ? d.pagine : {};
  } catch (e) {
    return {};
  }
}

function chiavePagina(pagina) {
  return String(pagina || '').split('\\').join('/').replace(/^\/+/, '').toLowerCase();
}

// L'ultima misura salvata di questa pagina, o null.
// La stessa pagina aperta dall'Anteprima dello Studio e da un server temporaneo puo' caricare
// fogli diversi: si confronta solo con una misura presa nello stesso modo, altrimenti il
// cambio di contesto sembrerebbe una perdita di stile.
function ultima(dir, pagina, base, contesto) {
  const storia = leggiTutto(dir, base)[chiavePagina(pagina)] || [];
  const buone = contesto ? storia.filter(function (v) { return (v.contesto || '') === contesto; }) : storia;
  return buone.length ? buone[buone.length - 1] : null;
}

function salva(dir, pagina, aspetto, base) {
  if (!aspetto) return null;
  try {
    const pagine = leggiTutto(dir, base);
    const chiave = chiavePagina(pagina);
    const voce = Object.assign({ quando: new Date().toISOString() }, aspetto);
    pagine[chiave] = (pagine[chiave] || []).concat([voce]).slice(-MAX_PER_PAGINA);
    const file = fileAspetto(dir, base);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ progetto: path.resolve(dir), aggiornato: new Date().toISOString(), pagine: pagine }, null, 1));
    return voce;
  } catch (e) {
    return null;
  }
}

function colore(x) {
  const t = String(x || '').trim();
  return t && t !== 'rgba(0, 0, 0, 0)' ? t : '';
}

// Il confronto vero. Restituisce { regressione, motivi: [...], nota } - nota vuota se va tutto bene.
function confronta(prima, dopo, opzioni) {
  opzioni = opzioni || {};
  const vuoto = { regressione: false, motivi: [], nota: '' };
  if (!prima || !dopo) return vuoto;
  const motivi = [];
  const crollo = prima.regole >= REGOLE_MINIME && dopo.regole <= prima.regole * QUOTA_CROLLO;
  const foglioInMeno = prima.fogli > dopo.fogli && dopo.regole < prima.regole;
  if (crollo) motivi.push('le regole di stile applicate sono passate da ' + prima.regole + ' a ' + dopo.regole);
  if (foglioInMeno) motivi.push('i fogli di stile caricati sono passati da ' + prima.fogli + ' a ' + dopo.fogli);
  if (!motivi.length) return vuoto;
  // Cambiamenti che l'utente vede a occhio: aiutano a capire di che perdita si parla.
  if (colore(prima.sfondo) && colore(dopo.sfondo) && prima.sfondo !== dopo.sfondo) {
    motivi.push('lo sfondo della pagina e\' passato da ' + prima.sfondo + ' a ' + dopo.sfondo);
  }
  if (colore(prima.colore) && colore(dopo.colore) && prima.colore !== dopo.colore) {
    motivi.push('il colore del testo e\' passato da ' + prima.colore + ' a ' + dopo.colore);
  }
  const quando = prima.quando ? ' (misurata ' + require('./cambiamenti').quandoUmano(prima.quando) + ')' : '';
  const nota = 'La pagina ha perso gran parte dello stile rispetto all\'ultima misura' + quando + ': ' +
    motivi.join('; ') + '. Se il nuovo stile e\' quello che ti ha chiesto l\'utente va bene cosi\'; ' +
    'altrimenti guarda cosa e\' cambiato sul disco (node strumenti/cambiamenti.js) e rimetti il file ' +
    'com\'era (node strumenti/ripristina.js --elenco) invece di riscriverlo a memoria.';
  return { regressione: true, motivi: motivi, nota: nota };
}

// Misura + confronto + salvataggio in un colpo solo: e' come la usa la sonda.
// Restituisce { aspetto, prima, regressione, nota }.
function registra(dir, pagina, aspetto, opzioni) {
  opzioni = opzioni || {};
  if (!aspetto || !dir) return { aspetto: aspetto || null, prima: null, regressione: false, nota: '' };
  if (opzioni.contesto) aspetto = Object.assign({}, aspetto, { contesto: opzioni.contesto });
  const prima = ultima(dir, pagina, opzioni.base, opzioni.contesto);
  const esito = confronta(prima, aspetto, opzioni);
  salva(dir, pagina, aspetto, opzioni.base);
  return { aspetto: aspetto, prima: prima, regressione: esito.regressione, motivi: esito.motivi, nota: esito.nota };
}

module.exports = {
  misuraNellaPagina: misuraNellaPagina,
  confronta: confronta,
  registra: registra,
  salva: salva,
  ultima: ultima,
  leggiTutto: leggiTutto,
  fileAspetto: fileAspetto,
  chiavePagina: chiavePagina,
  REGOLE_MINIME: REGOLE_MINIME,
  QUOTA_CROLLO: QUOTA_CROLLO
};
