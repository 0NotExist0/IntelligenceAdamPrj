// NotExist Intelligience Studio - Confronto delle misure della sonda.
//
// Funzioni che il server usa per decidere QUANDO misurare una pagina e per
// confrontare le misure prima e dopo una correzione. Stanno fuori da server.js per
// poterle provare da sole: test/confronto-misure.test.js.

const fs = require('fs');
const path = require('path');

// Frasi con cui di solito si segnala che qualcosa non va. Meglio misurare una volta di
// troppo (costa una decina di secondi) che lasciare Adam a indovinare dal codice: e'
// cosi' che aveva "corretto" le velocita' di un gioco il cui difetto vero era un ciclo
// di animazione che si moltiplicava a ogni partita.
const SEGNALAZIONE_BUG = /\b(non\s+(funziona\w*|va|vanno|parte|partono|risponde|carica|compare|appare|succede\s+nulla|si\s+(vede|vedono|muove|muovono|apre|carica|avvia|ferma|clicca))|bug|errore|errori|rott[oaie]|sparit[oaie]|scompar\w*|bloccat[oaie]|si\s+blocca\w*|velocissim[oaie]|lentissim[oaie]|troppo\s+(veloc|lent)\w*|crash\w*|problem[ai]|sbagliat[oaie]|glitch\w*|doesn'?t\s+work|not\s+working|broken|disappear\w*|freez\w*|too\s+(fast|slow))\b/i;

// Note della sonda che descrivono cosa ha fatto, non un difetto.
const FATTO_INFORMATIVO = /^(Nessun pulsante visibile|Passo \d+:|Il pulsante principale non e' riapparso|Ho compilato|La sonda ha aperto la pagina con un server statico)/;

function sembraUnBug(testo) {
  return SEGNALAZIONE_BUG.test(String(testo || ''));
}

const CARTELLE_IGNORATE = new Set([
  'node_modules', '.git', '.svn', 'dist', 'build', '__pycache__',
  '.venv', 'venv', '.next', 'coverage', '.backup-originali'
]);

// Pagine HTML nella radice e nelle sottocartelle del progetto (fino a 2 livelli).
// Root index.html resta sempre per prima.
function pagineDelProgetto(radice) {
  try {
    const radiceElenco = fs.readdirSync(radice, { withFileTypes: true })
      .filter(function (v) { return v.isFile() && /\.html?$/i.test(v.name); })
      .map(function (v) { return v.name; })
      .sort(function (a, b) {
        if (/^index\.html?$/i.test(a)) return -1;
        if (/^index\.html?$/i.test(b)) return 1;
        return a.localeCompare(b);
      });

    const sottoElenco = [];
    function cercaSotto(dir, rel, prof) {
      if (prof > 2) return;
      let voci;
      try {
        voci = fs.readdirSync(dir, { withFileTypes: true });
      } catch (e) {
        return;
      }
      for (const v of voci) {
        if (v.name.startsWith('.') || CARTELLE_IGNORATE.has(v.name.toLowerCase())) continue;
        const subRel = rel ? rel + '/' + v.name : v.name;
        if (v.isDirectory()) {
          cercaSotto(path.join(dir, v.name), subRel, prof + 1);
        } else if (prof > 1 && v.isFile() && /\.html?$/i.test(v.name)) {
          sottoElenco.push(subRel);
        }
      }
    }
    cercaSotto(radice, '', 1);
    sottoElenco.sort();

    return radiceElenco.concat(sottoElenco);
  } catch (e) {
    return [];
  }
}

// Quale pagina misurare: quella citata nel messaggio vince (e' la piu' specifica), poi
// quella aperta nell'Anteprima, poi la corrispondenza con la cartella citata, poi la prima del progetto.
// L'utente scrive in italiano, le cartelle hanno spesso nomi inglesi. Visto dal vivo il 18/9/2026:
// "puoi sistemare il gioco che non parte?" e il gioco stava in fps-game/; "gioco" non somiglia a
// "game", quindi veniva misurata curriculum/index.html (la prima in ordine alfabetico) e lo Studio
// diceva ad Adam e all'utente "nessun difetto misurato" - sulla pagina sbagliata.
const SINONIMI_PAGINA = [
  { re: /\bgioc(o|hi|are|atore|atori)\b|\bzombi|\bspar(a|are|ano|iamo)\b|\bfps\b|\bmultiplayer\b|\bdeathmatch\b|\bnemic/, parole: 'game gioco fps play' },
  { re: /\bsito\b|\bpagina\b|\bhome\b/, parole: 'site web home' },
  { re: /\bcurriculum\b|\bcv\b/, parole: 'curriculum cv resume' },
  { re: /\bnegozio\b|\bvendita\b|\bshop\b/, parole: 'shop store negozio' },
  { re: /\bmappa\b/, parole: 'map mappa' }
];

function testoConSinonimi(t) {
  const aggiunte = SINONIMI_PAGINA.filter(function (s) { return s.re.test(t); }).map(function (s) { return s.parole; });
  return aggiunte.length ? t + ' ' + aggiunte.join(' ') : t;
}

function scegliPagina(pagine, richiesta, testo) {
  if (!pagine || !pagine.length) return null;
  const originale = String(testo || '').toLowerCase();
  const citata = pagine.find(function (p) { return originale.indexOf(p.toLowerCase()) !== -1; });
  if (citata) return citata;
  const t = testoConSinonimi(originale);

  // Se l'utente cita una sottocartella (es. "zombie", "alien") presente nel percorso
  const perCartella = pagine.find(function (p) {
    const parti = p.toLowerCase().split('/');
    return parti.slice(0, -1).some(function (cartella) {
      if (cartella.length < 3) return false;
      if (t.indexOf(cartella) !== -1) return true;
      const tokens = cartella.split(/[-_\d]+/).filter(function (x) { return x.length >= 3; });
      tokens.push(cartella);
      return tokens.some(function (tok) {
        if (t.indexOf(tok) !== -1) return true;
        for (let l = Math.min(tok.length, 8); l >= 4; l--) {
          const pref = tok.slice(0, l);
          if (t.indexOf(pref) !== -1) return true;
        }
        return false;
      });
    });
  });
  if (perCartella) return perCartella;

  if (richiesta && pagine.indexOf(richiesta) !== -1) return richiesta;
  return pagine[0];
}

// Lo stesso fatto misurato due volte ha numeri diversi ("da 61 a 122" poi "da 60 a
// 121", o la riga di un errore che si sposta dopo una modifica): il confronto deve
// riconoscerlo come lo stesso, quindi i numeri non contano.
// Un collaudo si riconosce dal nome: i valori misurati possono cambiare anche nelle
// parti non numeriche. L'esempio in fondo ai fatti sugli oggetti e' diverso a ogni
// misura (un altro nemico) e non fa parte del fatto.
function chiaveFatto(testo) {
  const t = String(testo || '');
  const collaudo = t.match(/^(Collaudo fallito|Regressione) «([^»]*)»/);
  if (collaudo) return (collaudo[1] + ' ' + collaudo[2]).toLowerCase();
  return t.split(' Esempio: ')[0]
    .replace(/\d+(?:[.,]\d+)?/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// I difetti misurati: note della sonda (tranne quelle informative) ed errori JavaScript.
function fattiDellaSonda(r) {
  if (!r || r.errore) return [];
  return (r.note || [])
    .filter(function (n) { return !FATTO_INFORMATIVO.test(n); })
    .concat((r.errori || []).map(function (e) { return 'Errore JavaScript: ' + e; }));
}

// Che cosa serve provare per poter vedere un fatto: se nella misura DOPO quella cosa
// non e' stata provata, l'assenza del fatto non dimostra nulla.
function categoriaFatto(testo) {
  const t = String(testo || '');
  if (/^Il mouse sopra /.test(t)) return 'canvas';
  if (/^Dopo il secondo clic/.test(t)) return 'riavvio';
  if (/^Circa \d+ cicli/.test(t)) return 'cicli';
  if (/^Dopo movimenti reali del mouse/.test(t)) return 'mouse';
  if (/^Il clic sul pulsante/.test(t)) return 'clic';
  if (/^Dopo il clic su .+ lo schermo resta quasi vuoto/.test(t)) return 'schermo';
  if (/^Errore JavaScript/.test(t)) return 'errori';
  if (/^(Il file .+ non si carica|La richiesta a .+ non riesce)/.test(t)) return 'rete';
  if (/^Nella console del browser: /.test(t)) return 'console';
  if (/^La pagina ha perso gran parte dello stile/.test(t)) return 'aspetto';
  if (/^Oggetti eliminati che restano/.test(t)) return 'oggetti';
  if (/^L'elenco \S+ continua a crescere/.test(t)) return 'crescita';
  if (/^Regressione «/.test(t)) return 'regressione';
  if (/^Collaudo fallito «/.test(t)) return 'collaudo';
  return 'altro';
}

// FOCUS: un modello piccolo davanti a cinque problemi insieme ne corregge i sintomi e si
// perde (visto dal vivo: 50 minuti in un solo turno). Gli si da' un problema alla volta,
// nell'ordine in cui conviene affrontarli: un errore JavaScript o un pulsante che non fa
// nulla spesso SONO la causa degli altri; una regressione e' un danno appena fatto; i
// collaudi falliti vengono per ultimi perche' li ha scritti un modello e possono sbagliare.
// 'aspetto' (la pagina ha perso lo stile) sta in alto perche' e' quello che l'utente vede per
// primo e non lascia altre tracce: nessun errore, nessuna riga in console.
const PRIORITA_FOCUS = ['errori', 'rete', 'console', 'aspetto', 'clic', 'schermo', 'regressione', 'canvas', 'mouse', 'oggetti',
  'cicli', 'riavvio', 'crescita', 'collaudo', 'altro'];

function prioritaFatto(testo) {
  return PRIORITA_FOCUS.indexOf(categoriaFatto(testo));
}

function ordinaPerFocus(fatti) {
  return (fatti || [])
    .map(function (f, i) { return { f: f, i: i, p: prioritaFatto(f) }; })
    .sort(function (a, b) { return a.p - b.p || a.i - b.i; })
    .map(function (x) { return x.f; });
}

// Una verifica automatica puo' trovare problemi veri che non appartengono al lavoro chiesto.
// Confronta i termini significativi della richiesta con quelli del fatto; gli alias coprono
// i nomi piu' comuni tra UI italiana, UI inglese e codice del progetto.
const PAROLE_GENERiche_RICHIESTA = new Set((
  'a ad al allo alla ai agli alle da dal dalla dalle dei degli delle del di e ed il lo la i gli le un una uno ' +
  'che cosa cosa come con per su tra fra nel nella nei nelle nello mi ti gli vi si non no nulla niente ' +
  'funziona funzionare funzionamento cambia cambiare cambiato modificare modifica problema problemi errore errori ' +
  'bug sistemare sistema correggere correggi fai fare rendi deve dovrebbe possa puo questa questo quello quella ' +
  'qui li ci sia essere e ancora anche tutte tutti parte davvero task richiesta utente codice pagina file app ' +
  'pulsante bottone button click clic cliccare clicchi cliccato premere premi premuto sistemalo sistemala'
).split(/\s+/));

const ALIAS_RICHIESTA = {
  forma: 'shape', forme: 'shape', shape: 'shape', shapes: 'shape', figura: 'shape', figure: 'shape',
  anteprima: 'preview', anteprime: 'preview', preview: 'preview', previews: 'preview',
  esporta: 'export', esportare: 'export', esportazione: 'export', esportazioni: 'export', export: 'export', exports: 'export',
  editor: 'editor', editing: 'editor', editoriale: 'editor',
  modulo: 'form', moduli: 'form', form: 'form', forms: 'form'
};

function terminiRichiesta(testo) {
  const normalizzato = String(testo || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return new Set((normalizzato.match(/[a-z0-9]+/g) || [])
    .filter(function (p) { return p.length > 2 && !PAROLE_GENERiche_RICHIESTA.has(p); })
    .map(function (p) {
      if (ALIAS_RICHIESTA[p]) return ALIAS_RICHIESTA[p];
      // Normalizza solo le flessioni piu' prevedibili; evita prefissi generici come "pro" o "mod".
      if (/^(anteprim|preview)/.test(p)) return 'preview';
      if (/^(esport|export)/.test(p)) return 'export';
      if (/^shap/.test(p)) return 'shape';
      return p;
    }));
}

function fattiPertinenti(fatti, richiesta) {
  const elenco = fatti || [];
  const termini = terminiRichiesta(richiesta);
  // Se la richiesta non contiene parole tematiche (es. "sistemalo"), non inventare una
  // correlazione: mantieni l'ordinamento generale che lo Studio usava finora.
  if (!termini.size) return elenco.slice();
  return elenco.filter(function (f) {
    const paroleFatto = terminiRichiesta(f);
    return Array.from(termini).some(function (t) { return paroleFatto.has(t); });
  });
}

// Il focus resta lo stesso finche' c'e', a meno che non compaia qualcosa di piu' urgente
// (un errore nuovo, una regressione): cambiarlo a ogni giro disperderebbe il lavoro.
function scegliFocus(fatti, chiavePrecedente, richiesta) {
  const candidati = richiesta === undefined ? (fatti || []) : fattiPertinenti(fatti, richiesta);
  const ordinati = ordinaPerFocus(candidati);
  if (!ordinati.length) return null;
  const vecchio = chiavePrecedente
    ? candidati.find(function (f) { return chiaveFatto(f) === chiavePrecedente; })
    : null;
  if (vecchio && prioritaFatto(vecchio) <= prioritaFatto(ordinati[0])) return vecchio;
  return ordinati[0];
}

function mediana(valori) {
  const v = valori.slice().sort(function (a, b) { return a - b; });
  return v.length ? v[Math.floor(v.length / 2)] : 0;
}

// Elenchi che continuano a crescere. serie = [{ t: ms dal clic, elenchi: { nome: lunghezza } }].
// Prudente di proposito: un falso allarme spinge Adam a "correggere" un gioco sano. La prova
// si divide in tre terzi di tempo e si confrontano le mediane: la crescita deve continuare
// anche nell'ultimo terzo (un gioco sano sale all'inizio e poi si assesta), l'elenco deve
// essere grande e il ritmo alto. Piccoli cali non contano: nel caso reale i nemici uscivano
// dal fondo dello schermo (83 -> 197 -> 271 -> 312 -> 300), ma ne nascevano 30 al secondo
// e quelli distrutti non venivano mai tolti.
function analizzaCrescita(serie) {
  const campioni = (serie || []).filter(function (c) { return c && c.elenchi; });
  const nomi = {};
  campioni.forEach(function (c) { Object.keys(c.elenchi).forEach(function (n) { nomi[n] = true; }); });
  const esito = [];
  Object.keys(nomi).forEach(function (nome) {
    const punti = campioni
      .filter(function (c) { return typeof c.elenchi[nome] === 'number'; })
      .map(function (c) { return { t: c.t, n: c.elenchi[nome] }; });
    if (punti.length < 6) return;
    const primo = punti[0];
    const ultimo = punti[punti.length - 1];
    const durata = ultimo.t - primo.t;
    if (durata < 6000) return;
    const terzo = function (k) {
      const da = primo.t + durata * k / 3;
      const a = primo.t + durata * (k + 1) / 3;
      return mediana(punti.filter(function (p) { return p.t >= da && (k === 2 ? p.t <= a : p.t < a); })
        .map(function (p) { return p.n; }));
    };
    const inizio = terzo(0);
    const mezzo = terzo(1);
    const fine = terzo(2);
    const alSecondo = (fine - inizio) * 1000 / (durata * 2 / 3);
    if (fine < 100 || mezzo < inizio * 1.2 || fine < mezzo * 1.1 || alSecondo < 4) return;
    esito.push({
      nome: nome,
      valori: punti.map(function (p) { return p.n; }),
      mediane: [inizio, mezzo, fine],
      secondi: Math.round(durata / 1000),
      alSecondo: Math.round(alSecondo)
    });
  });
  return esito;
}

// Dove e' stato lanciato un errore: "[game.js:359]" dalla pagina, "game.js:359:55" nello
// stack che riporta puppeteer.
function rigaDellErrore(testo) {
  const t = String(testo || '');
  const m = t.match(/\[([^\]\s:]+\.m?js):(\d+)\]/) || t.match(/([\w.-]+\.m?js):(\d+):\d+/);
  return m ? { file: m[1], riga: Number(m[2]) } : null;
}

// true/false se la riga e' stata eseguita nella prova, null se non si sa (file non coperto).
// Approssimato: se le modifiche spostano il codice, la stessa riga indica altro codice.
function rigaEseguita(lineeEseguite, dove) {
  const intervalli = lineeEseguite && dove && lineeEseguite[dove.file];
  if (!intervalli) return null;
  return intervalli.some(function (i) { return dove.riga >= i[0] && dove.riga <= i[1]; });
}

// Prima e dopo una correzione. Per i fatti che restano si tiene il testo di DOPO,
// perche' porta i numeri attuali. Un fatto sparito conta come risolto solo se la misura
// dopo ha provato la cosa che lo faceva comparire: per un errore JavaScript, se la sua
// riga e' stata eseguita di nuovo. Altrimenti resta da verificare.
function confrontaFatti(prima, dopo, provati, lineeEseguite) {
  const chiaviPrima = new Set((prima || []).map(chiaveFatto));
  const chiaviDopo = new Set((dopo || []).map(chiaveFatto));
  // Collaudi che nella misura dopo non si sono potuti eseguire (codice cambiato sotto i
  // loro nomi, esito instabile): la loro assenza non dimostra nulla.
  const collaudiNonProvati = new Set(((provati && provati.collaudiNonProvati) || [])
    .map(function (n) { return String(n).toLowerCase(); }));
  const provato = function (f) {
    if (provati && provati[categoriaFatto(f)] === false) return false;
    const nome = String(f).match(/^(?:Collaudo fallito|Regressione) «([^»]*)»/);
    if (nome && collaudiNonProvati.has(nome[1].toLowerCase())) return false;
    if (categoriaFatto(f) === 'errori' && rigaEseguita(lineeEseguite, rigaDellErrore(f)) === false) return false;
    return true;
  };
  const spariti = (prima || []).filter(function (f) { return !chiaviDopo.has(chiaveFatto(f)); });
  return {
    restano: (dopo || []).filter(function (f) { return chiaviPrima.has(chiaveFatto(f)); }),
    risolti: spariti.filter(provato),
    nonVerificati: spariti.filter(function (f) { return !provato(f); }),
    nuovi: (dopo || []).filter(function (f) { return !chiaviPrima.has(chiaveFatto(f)); })
  };
}

// Due schermate al massimo, perche' pesano sul prompt di ogni turno successivo: quella
// subito dopo l'azione principale e l'ultima, che mostra dove si arriva.
function scegliSchermate(r) {
  const s = (r && r.schermate) || [];
  if (!s.length) return [];
  const principale = s.find(function (x) { return /\+1s dal clic/.test(x.momento); }) || s[0];
  const ultima = s[s.length - 1];
  // La copia leggera quando c'e': una schermata a piena risoluzione costa dieci volte tanto nel
  // contesto di Adam, e per vedere layout e colori non serve (strumenti/schermata-leggera.js).
  const scegli = function (x) { return x.leggera || x.file; };
  return ultima.file === principale.file ? [scegli(principale)] : [scegli(principale), scegli(ultima)];
}

// Una modifica riguarda la pagina se tocca un file web della stessa cartella di progetto.
function filePertinente(dir, file) {
  const base = path.resolve(dir).toLowerCase();
  const f = path.resolve(dir, String(file || '')).toLowerCase();
  return f.indexOf(base + path.sep) === 0 && /\.(html?|m?js|css)$/.test(f);
}

module.exports = {
  SEGNALAZIONE_BUG,
  sembraUnBug,
  pagineDelProgetto,
  scegliPagina,
  chiaveFatto,
  fattiDellaSonda,
  confrontaFatti,
  categoriaFatto,
  PRIORITA_FOCUS,
  prioritaFatto,
  ordinaPerFocus,
  fattiPertinenti,
  scegliFocus,
  analizzaCrescita,
  rigaDellErrore,
  rigaEseguita,
  scegliSchermate,
  filePertinente
};
