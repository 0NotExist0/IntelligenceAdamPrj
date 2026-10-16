// NotExist Intelligience Studio - Editor visivo: dalle modifiche fatte a vista al codice.
//
// L'utente seleziona un elemento nell'Anteprima e ne cambia colori, sfondo, dimensioni o
// posizione. Riportare quelle modifiche dentro il CSS scritto da Adam vorrebbe dire
// riscrivere regole altrui, con il rischio di romperne altre. Qui invece vanno TUTTE in un
// file a parte, studio-modifiche.css, caricato dalla pagina dopo gli altri fogli di stile:
// e' leggibile, si annulla cancellandolo, e il resto del codice non si tocca (l'unica
// modifica all'HTML e' la riga <link>).
//
// Questo modulo non tocca il disco: valida, legge, unisce e scrive testo. Lo usa server.js.

const FILE_MODIFICHE = 'studio-modifiche.css';

// Solo proprieta' visive: niente display, niente content, niente che nasconda o cambi il
// comportamento della pagina.
const PROPRIETA = ['color', 'background', 'background-color', 'background-image', 'background-size', 'font-size', 'font-weight',
  'border-radius', 'border-color', 'opacity', 'translate', 'left', 'top', 'position', 'padding', 'margin', 'width', 'height',
  'text-align'];

const SELETTORE_VALIDO = /^[A-Za-z0-9_#.\-\s>:()+~\[\]="'*]+$/;
const RIALZO = /(:not\(#studio-[xy]\))+$/;

// Un valore CSS che non puo' uscire dalla sua dichiarazione ne' caricare niente da fuori.
function valoreSicuro(v) {
  const t = String(v === undefined || v === null ? '' : v).trim();
  if (!t || t.length > 300) return null;
  if (/[;{}<>\\]/.test(t) || /expression\s*\(|javascript:|@import/i.test(t)) return null;
  const urls = t.match(/url\([^)]*\)/gi) || [];
  for (const u of urls) {
    const dentro = u.replace(/^url\(\s*['"]?/i, '').replace(/['"]?\s*\)$/, '');
    // Solo file del progetto: niente indirizzi esterni, niente dati incorporati, niente
    // percorsi che risalgono. L'editor sceglie le immagini fra i file del progetto.
    if (/^[a-z][a-z0-9+.-]*:/i.test(dentro) || /^(\/|\.\.)/.test(dentro)) return null;
  }
  return t;
}

// Un solo selettore, senza virgole ne' commenti: e' quello che l'editor genera.
function selettoreSicuro(s) {
  const t = String(s || '').trim().replace(/\s+/g, ' ');
  if (!t || t.length > 300 || !SELETTORE_VALIDO.test(t) || t.indexOf(',') !== -1) return null;
  return t;
}

function validaRegole(regole) {
  if (!Array.isArray(regole) || !regole.length) return { errore: 'nessuna modifica da applicare' };
  if (regole.length > 60) return { errore: 'troppe regole in una volta (massimo 60)' };
  const pulite = [];
  for (const r of regole) {
    const sel = selettoreSicuro(r && r.selettore);
    if (!sel) return { errore: 'selettore non valido: ' + String(r && r.selettore).slice(0, 80) };
    const prop = {};
    for (const k of Object.keys((r && r.proprieta) || {})) {
      const nome = String(k).toLowerCase();
      if (PROPRIETA.indexOf(nome) === -1) return { errore: 'proprieta\' non ammessa: ' + nome };
      const v = valoreSicuro(r.proprieta[k]);
      if (v === null) return { errore: 'valore non ammesso per ' + nome + ': ' + String(r.proprieta[k]).slice(0, 80) };
      prop[nome] = v;
    }
    if (Object.keys(prop).length) pulite.push({ selettore: sel, proprieta: prop });
  }
  if (!pulite.length) return { errore: 'nessuna modifica da applicare' };
  return { regole: pulite };
}

// Il file lo scrive solo lo Studio, quindi basta leggere il suo formato: selettore { p: v; }
function leggiRegole(css) {
  const regole = [];
  const testo = String(css || '').replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(testo)) !== null) {
    const sel = m[1].trim();
    const prop = {};
    m[2].split(';').forEach(function (d) {
      const i = d.indexOf(':');
      if (i === -1) return;
      const k = d.slice(0, i).trim().toLowerCase();
      const v = d.slice(i + 1).trim();
      if (k && v) prop[k] = v;
    });
    if (sel && Object.keys(prop).length) regole.push({ selettore: sel, proprieta: prop });
  }
  return regole;
}

function baseDel(selettore) {
  return String(selettore).replace(RIALZO, '');
}

// Le modifiche nuove sullo stesso elemento prendono il posto delle vecchie, proprieta' per
// proprieta'. Un selettore gia' "rialzato" (vedi piuSpecifico) resta rialzato.
function unisciRegole(esistenti, nuove) {
  const per = new Map();
  const metti = function (r) {
    const chiave = baseDel(r.selettore);
    const prima = per.get(chiave);
    const selettore = prima && prima.selettore.length > r.selettore.length ? prima.selettore : r.selettore;
    per.set(chiave, { selettore: selettore, proprieta: Object.assign({}, prima ? prima.proprieta : {}, r.proprieta) });
  };
  (esistenti || []).forEach(metti);
  (nuove || []).forEach(metti);
  return Array.from(per.values());
}

function scriviCss(regole, pagina) {
  const testa = [
    '/* Modifiche fatte con l\'editor visivo dello Studio' + (pagina ? ' su ' + pagina : '') + '.',
    '   Stanno qui, e non nei fogli di stile del progetto, per non toccare il resto del codice:',
    '   per tornare indietro basta cancellare questo file o la riga <link> che lo carica. */',
    ''
  ];
  return testa.concat((regole || []).map(function (r) {
    return r.selettore + ' {\n' + Object.keys(r.proprieta).map(function (k) {
      return '  ' + k + ': ' + r.proprieta[k] + ';';
    }).join('\n') + '\n}\n';
  })).join('\n');
}

// La riga che carica il file va DOPO gli altri fogli di stile: a parita' di specificita'
// vince l'ultimo. Una sola volta.
function conLink(html) {
  const h = String(html || '');
  if (h.indexOf(FILE_MODIFICHE) !== -1) return { html: h, cambiato: false };
  const riga = '<link rel="stylesheet" href="' + FILE_MODIFICHE + '">';
  if (/<\/head>/i.test(h)) return { html: h.replace(/<\/head>/i, '    ' + riga + '\n</head>'), cambiato: true };
  if (/<body[^>]*>/i.test(h)) return { html: h.replace(/<body[^>]*>/i, function (m) { return riga + '\n' + m; }), cambiato: true };
  return { html: riga + '\n' + h, cambiato: true };
}

// Se una regola del progetto e' piu' specifica, la modifica non si vede. Si alza la
// specificita' di un id con :not(#studio-x), che non cambia quali elementi vengono scelti.
// Al massimo due volte.
function piuSpecifico(selettore) {
  const s = String(selettore);
  if (/:not\(#studio-y\)$/.test(s)) return null;
  return s + (/:not\(#studio-x\)$/.test(s) ? ':not(#studio-y)' : ':not(#studio-x)');
}

module.exports = {
  FILE_MODIFICHE,
  PROPRIETA,
  valoreSicuro,
  selettoreSicuro,
  validaRegole,
  leggiRegole,
  unisciRegole,
  scriviCss,
  conLink,
  piuSpecifico,
  baseDel
};
