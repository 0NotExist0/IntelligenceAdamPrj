// NotExist Intelligience Studio - Il cervello del progetto.
//
// Un modello piccolo non riesce a tenere a mente tutto il codice, e non deve: lo fa lo
// Studio. Il cervello legge TUTTI i file con un analizzatore vero del JavaScript (acorn,
// lo stesso che usa Node) e segna ogni variabile, funzione, parametro, id e classe: dove
// nasce, cosa riceve, dove viene usato. Poi cerca gli errori che un modello piccolo fa
// piu' spesso: nomi che non esistono o scritti male, chiavi di oggetti inesistenti, id
// che nessun HTML dichiara, variabili dichiarate due volte in due script della stessa pagina.
//
// Prima la mappa entrava nel prompt tagliata (12 funzioni per file, 6000 caratteri in
// tutto) e si aggiornava solo a fine verifica: su un progetto nuovo Adam lavorava senza
// sapere nulla. Ora non si taglia niente, perche' Adam chiede al cervello solo quello che
// gli serve, e Claude Code lo esegue da solo dopo ogni modifica (hook PostToolUse):
// l'errore si scopre subito, non a fine turno.
//
// Uso:
//   node cervello.js --cerca <nome>       dove e' dichiarato, cosa riceve, dove e' usato
//   node cervello.js --file <percorso>    tutto quello che contiene un file
//   node cervello.js --controlla [file]   i problemi del progetto (o di un solo file)
//   node cervello.js --mappa              panoramica compatta del progetto
//   node cervello.js --errori             errori gia' trovati e corretti in questo progetto
//   node cervello.js --hook               lo usa Claude Code dopo ogni Edit/Write
//   opzioni: --dir <cartella del progetto> (predefinita: la cartella corrente), --json

const fs = require('fs');
const path = require('path');
const acorn = require('./vendor/acorn');
const { elencaFile } = require('../analisi-progetto');

function caricaGlobali(nome) {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'vendor', nome), 'utf8')).nomi || [];
  } catch (e) {
    return [];
  }
}

// Nomi che il browser e Node forniscono da soli, letti da un Chrome e da un Node veri
// (strumenti/vendor/globali-*.json): senza, requestAnimationFrame sembrerebbe un errore.
const GLOBALI_BROWSER = new Set(caricaGlobali('globali-browser.json').concat(
  ['importScripts', 'WorkerGlobalScope', 'DedicatedWorkerGlobalScope', 'SharedWorkerGlobalScope']));
const GLOBALI_NODE = new Set(caricaGlobali('globali-node.json'));
// Senza gli elenchi non si distingue un errore da un nome del browser: meglio tacere
// che riempire Adam di falsi allarmi (li correggerebbe, rompendo codice giusto).
const GLOBALI_AFFIDABILI = GLOBALI_BROWSER.size > 500 && GLOBALI_NODE.size > 50;
const PROTOTIPO_OGGETTO = new Set(Object.getOwnPropertyNames(Object.prototype));

function leggi(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (e) { return ''; }
}

function relativo(radice, file) {
  return path.relative(radice, file).split(path.sep).join('/');
}

function indiceRighe(testo) {
  const inizi = [0];
  for (let i = 0; i < testo.length; i++) if (testo.charCodeAt(i) === 10) inizi.push(i + 1);
  return inizi;
}

function rigaDa(inizi, pos) {
  let basso = 0;
  let alto = inizi.length - 1;
  while (basso < alto) {
    const meta = (basso + alto + 1) >> 1;
    if (inizi[meta] <= pos) basso = meta; else alto = meta - 1;
  }
  return basso + 1;
}

// Distanza fra due nomi (lettere cambiate, aggiunte, tolte o scambiate): serve a
// suggerire "forse volevi spawnZombies" invece di un semplice "non esiste".
function distanza(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = [];
  for (let i = 0; i <= a.length; i++) d[i] = [i];
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + costo);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

function nomiSimili(nome, candidati, max) {
  const minuscolo = nome.toLowerCase();
  const soglia = nome.length <= 4 ? 1 : 2;
  const trovati = [];
  const visti = new Set();
  candidati.forEach(function (c) {
    if (!c || c === nome || visti.has(c)) return;
    visti.add(c);
    const dist = c.toLowerCase() === minuscolo ? 0 : distanza(nome, c);
    if (dist <= soglia) trovati.push({ nome: c, dist: dist });
  });
  trovati.sort(function (x, y) { return x.dist - y.dist; });
  return trovati.slice(0, max || 3).map(function (t) { return t.nome; });
}

// Sostituisce un pezzo di testo con spazi mantenendo gli a capo: le righe restano giuste.
function sbianca(testo) {
  return testo.replace(/[^\n]/g, ' ');
}

// ------------------------------------------------------------------- HTML

function attributo(attr, nome) {
  const m = new RegExp('(?:^|\\s)' + nome + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i').exec(attr || '');
  if (!m) return null;
  return m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3]);
}

function decodificaEntita(testo) {
  return testo.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function esterno(rif) {
  return /^(https?:)?\/\//i.test(rif) || /^(data|blob|mailto|javascript|tel):/i.test(rif);
}

function pulisciRif(rif) {
  return rif.trim().split('?')[0].split('#')[0];
}

function analizzaHtml(file, testo) {
  const inizi = indiceRighe(testo);
  const pulito = testo.replace(/<!--[\s\S]*?-->/g, sbianca);
  const scheda = { file: file, tipo: 'html', id: [], classi: [], script: [], risorse: [], gestori: [], stili: [] };
  let m;

  const reScript = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  while ((m = reScript.exec(pulito)) !== null) {
    const tipo = (attributo(m[1], 'type') || '').trim().toLowerCase();
    const src = attributo(m[1], 'src');
    const inizioCodice = m.index + m[0].indexOf('>') + 1;
    scheda.script.push({
      src: src ? src.trim() : null,
      modulo: tipo === 'module',
      // JSON, template e simili stanno in <script> ma non sono JavaScript da eseguire
      ignorato: !!tipo && ['module', 'text/javascript', 'application/javascript'].indexOf(tipo) === -1,
      codice: src ? '' : m[2],
      riga: rigaDa(inizi, inizioCodice),
      rigaTag: rigaDa(inizi, m.index)
    });
    if (src && !esterno(src.trim())) scheda.risorse.push({ rif: pulisciRif(src), riga: rigaDa(inizi, m.index) });
  }

  const reStile = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
  while ((m = reStile.exec(pulito)) !== null) {
    const inizio = m.index + m[0].indexOf('>') + 1;
    scheda.stili.push(analizzaCss(file, '\n'.repeat(rigaDa(inizi, inizio) - 1) + m[1]));
  }

  // Id, classi e gestori si leggono fuori da script e stili: quelli li' dentro sono codice.
  const corpo = pulito.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, sbianca)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, sbianca);

  const reId = /\sid\s*=\s*["']([^"']+)["']/gi;
  while ((m = reId.exec(corpo)) !== null) scheda.id.push({ nome: m[1].trim(), riga: rigaDa(inizi, m.index) });

  const reClasse = /\sclass\s*=\s*["']([^"']*)["']/gi;
  while ((m = reClasse.exec(corpo)) !== null) {
    const riga = rigaDa(inizi, m.index);
    m[1].split(/\s+/).filter(Boolean).forEach(function (c) { scheda.classi.push({ nome: c, riga: riga }); });
  }

  const reGestore = /\s(on[a-z]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  while ((m = reGestore.exec(corpo)) !== null) {
    scheda.gestori.push({
      evento: m[1].toLowerCase(),
      codice: decodificaEntita(m[2] !== undefined ? m[2] : m[3]),
      riga: rigaDa(inizi, m.index)
    });
  }

  const reRisorsa = /<(link|img|audio|video|source)\b([^>]*)>/gi;
  while ((m = reRisorsa.exec(corpo)) !== null) {
    const rif = attributo(m[2], m[1].toLowerCase() === 'link' ? 'href' : 'src');
    if (!rif || !rif.trim() || esterno(rif.trim()) || rif.trim().startsWith('#')) continue;
    scheda.risorse.push({ rif: pulisciRif(rif), riga: rigaDa(inizi, m.index) });
  }
  return scheda;
}

// -------------------------------------------------------------------- CSS

function analizzaCss(file, testo) {
  const inizi = indiceRighe(testo);
  const senzaCommenti = testo.replace(/\/\*[\s\S]*?\*\//g, sbianca);
  const scheda = { file: file, tipo: 'css', id: [], classi: [], variabili: [] };
  let inizioPrelude = 0;
  for (let i = 0; i < senzaCommenti.length; i++) {
    const c = senzaCommenti[i];
    if (c === '{') {
      const prelude = senzaCommenti.slice(inizioPrelude, i);
      // "@media ... {" non e' un selettore; "color: #fff" non arriva mai qui perche' finisce con ";".
      if (!/^\s*@/.test(prelude)) {
        const senzaStringhe = prelude.replace(/(["'])(?:\\.|(?!\1)[^\\])*\1/g, sbianca).replace(/\[[^\]]*\]/g, sbianca);
        let m;
        const reId = /#([A-Za-z_][\w-]*)/g;
        while ((m = reId.exec(senzaStringhe)) !== null) scheda.id.push({ nome: m[1], riga: rigaDa(inizi, inizioPrelude + m.index) });
        const reClasse = /\.([A-Za-z_][\w-]*)/g;
        while ((m = reClasse.exec(senzaStringhe)) !== null) scheda.classi.push({ nome: m[1], riga: rigaDa(inizi, inizioPrelude + m.index) });
      }
      inizioPrelude = i + 1;
    } else if (c === '}' || c === ';') {
      inizioPrelude = i + 1;
    }
  }
  let m;
  const reVar = /(--[A-Za-z_][\w-]*)\s*:/g;
  while ((m = reVar.exec(senzaCommenti)) !== null) scheda.variabili.push({ nome: m[1], riga: rigaDa(inizi, m.index) });
  return scheda;
}

// ------------------------------------------------------------- JavaScript
//
// Per ogni file (o script dentro l'HTML) si costruisce l'albero degli scope: globale o
// modulo, funzioni, blocchi. Ogni dichiarazione va nel suo scope (var nella funzione,
// let/const/class nel blocco) e ogni uso di un nome diventa un "riferimento". I
// riferimenti si risolvono DOPO aver letto tutto, cosi' una funzione usata prima di
// essere dichiarata (hoisting) non sembra un errore.

function nuovoScope(tipo, padre) {
  return { tipo: tipo, padre: padre, nomi: new Map() };
}

function scopeDiFunzione(scope) {
  let s = scope;
  while (s.tipo === 'blocco') s = s.padre;
  return s;
}

function analizzaJs(file, codice, opzioni) {
  opzioni = opzioni || {};
  const esito = {
    file: file, tipo: 'js', modulo: false, rigorosa: false, errore: null, jsx: false, conWith: false,
    scope: null, dichiarazioni: [], riferimenti: [], oggetti: [],
    idCercati: [], idCreati: [], idDinamici: false, classiUsate: [], importLocali: [], usaNode: false,
    metodiChiamati: new Set()
  };
  const sembraModulo = !!opzioni.modulo || /^\s*(import|export)\b/m.test(codice);
  const tentativi = opzioni.modulo ? ['module'] : (sembraModulo ? ['module', 'script'] : ['script', 'module']);
  let ast = null;
  let primoErrore = null;
  for (let i = 0; i < tentativi.length && !ast; i++) {
    try {
      ast = acorn.parse(codice, { ecmaVersion: 'latest', sourceType: tentativi[i], locations: true, allowHashBang: true });
      esito.modulo = tentativi[i] === 'module';
    } catch (e) {
      if (!primoErrore) primoErrore = e;
    }
  }
  if (!ast) {
    // JSX (React) non e' JavaScript puro: non e' un errore, e' codice che il cervello non legge.
    if (/return\s*\(?\s*<[A-Za-z]|=>\s*\(?\s*<[A-Za-z]/.test(codice)) { esito.jsx = true; return esito; }
    esito.errore = {
      messaggio: String(primoErrore.message).replace(/\s*\(\d+:\d+\)\s*$/, ''),
      riga: primoErrore.loc ? primoErrore.loc.line : 1,
      colonna: primoErrore.loc ? primoErrore.loc.column + 1 : 1
    };
    return esito;
  }
  esito.rigorosa = esito.modulo || !!(ast.body[0] && ast.body[0].directive === 'use strict');

  const righe = codice.split('\n');
  function testoRiga(n) { return (righe[n - 1] || '').trim().slice(0, 140); }
  function breve(nodo) {
    const t = codice.slice(nodo.start, nodo.end).replace(/\s+/g, ' ');
    return t.length > 30 ? t.slice(0, 27) + '...' : t;
  }

  function dichiara(scope, nome, tipo, nodo, extra) {
    const d = Object.assign({ nome: nome, tipo: tipo, file: file, riga: nodo.loc.start.line,
      testo: testoRiga(nodo.loc.start.line), scope: scope }, extra || {});
    if (!scope.nomi.has(nome)) scope.nomi.set(nome, []);
    scope.nomi.get(nome).push(d);
    if (!d.nascosta) esito.dichiarazioni.push(d);
    return d;
  }

  function riferimento(id, scope, info) {
    esito.riferimenti.push(Object.assign({ nome: id.name, file: file, riga: id.loc.start.line,
      testo: testoRiga(id.loc.start.line), scope: scope }, info || {}));
  }

  function parametroInTesto(p) {
    if (!p) return '';
    switch (p.type) {
      case 'Identifier': return p.name;
      case 'AssignmentPattern': return parametroInTesto(p.left) + ' = ' + breve(p.right);
      case 'RestElement': return '...' + parametroInTesto(p.argument);
      case 'ObjectPattern': return '{' + p.properties.map(function (pr) {
        return pr.type === 'RestElement' ? '...' + parametroInTesto(pr.argument) : parametroInTesto(pr.value);
      }).join(', ') + '}';
      case 'ArrayPattern': return '[' + p.elements.map(parametroInTesto).join(', ') + ']';
      default: return breve(p);
    }
  }
  function parametriDi(params) { return params.map(parametroInTesto).join(', '); }

  function chiaviOggetto(obj) {
    const chiavi = [];
    let dinamico = false;
    let conMetodi = false;
    obj.properties.forEach(function (p) {
      if (p.type === 'SpreadElement' || p.computed) { dinamico = true; return; }
      chiavi.push(p.key.type === 'Identifier' ? p.key.name : String(p.key.value));
      if (p.method || p.kind !== 'init' || (p.value && /Function/.test(p.value.type))) conMetodi = true;
    });
    return { chiavi: chiavi, dinamico: dinamico, conMetodi: conMetodi };
  }

  function descrivi(init) {
    if (!init) return { valore: 'senza valore iniziale' };
    switch (init.type) {
      case 'Literal':
        if (init.regex) return { valore: 'espressione regolare', letterale: true };
        if (init.value === null) return { valore: 'null', letterale: true };
        return { valore: (({ number: 'numero ', string: 'testo ' })[typeof init.value] || '') + breve(init), letterale: true };
      case 'TemplateLiteral': return { valore: 'testo', letterale: true };
      case 'ArrayExpression': return { valore: 'lista di ' + init.elements.length + ' elementi', letterale: true };
      case 'ObjectExpression': {
        const k = chiaviOggetto(init).chiavi;
        return { valore: 'oggetto {' + k.slice(0, 15).join(', ') + (k.length > 15 ? ', +' + (k.length - 15) : '') + '}', letterale: true };
      }
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        return { valore: 'funzione', funzione: true, parametri: parametriDi(init.params), asincrona: !!init.async };
      case 'ClassExpression': return { valore: 'classe', classe: true };
      case 'NewExpression': return { valore: 'new ' + breve(init.callee) + '(...)' };
      case 'CallExpression': return { valore: 'risultato di ' + breve(init.callee) + '(...)' };
      default: return { valore: breve(init) };
    }
  }

  function dichiaraPattern(p, scope, tipo, extra) {
    if (!p) return;
    switch (p.type) {
      case 'Identifier': dichiara(scope, p.name, tipo, p, extra); return;
      case 'ObjectPattern':
        p.properties.forEach(function (pr) {
          if (pr.type === 'RestElement') return dichiaraPattern(pr.argument, scope, tipo);
          if (pr.computed) visita(pr.key, scope);
          dichiaraPattern(pr.value, scope, tipo);
        });
        return;
      case 'ArrayPattern': p.elements.forEach(function (e) { dichiaraPattern(e, scope, tipo); }); return;
      case 'RestElement': dichiaraPattern(p.argument, scope, tipo); return;
      case 'AssignmentPattern': dichiaraPattern(p.left, scope, tipo, extra); visita(p.right, scope); return;
      default: visita(p, scope);
    }
  }

  function scriviPattern(p, scope) {
    if (!p) return;
    switch (p.type) {
      case 'Identifier': riferimento(p, scope, { scrittura: true }); return;
      case 'MemberExpression': membro(p, scope, { scrittura: true }); return;
      case 'ObjectPattern':
        p.properties.forEach(function (pr) {
          if (pr.type === 'RestElement') return scriviPattern(pr.argument, scope);
          if (pr.computed) visita(pr.key, scope);
          scriviPattern(pr.value, scope);
        });
        return;
      case 'ArrayPattern': p.elements.forEach(function (e) { scriviPattern(e, scope); }); return;
      case 'RestElement': scriviPattern(p.argument, scope); return;
      case 'AssignmentPattern': scriviPattern(p.left, scope); visita(p.right, scope); return;
      default: visita(p, scope);
    }
  }

  // obj.chiave: si ricorda quale chiave si legge e se il risultato viene chiamato o usato
  // ancora (obj.chiave.altro): se la chiave non esiste, li' il programma si rompe davvero.
  function membro(n, scope, ctx) {
    ctx = ctx || {};
    if (n.object.type === 'Identifier') {
      riferimento(n.object, scope, {
        chiave: n.computed ? null : n.property.name,
        calcolata: n.computed,
        scritturaChiave: !!ctx.scrittura,
        chiamataChiave: !!ctx.chiamata,
        catena: !!ctx.catena,
        guardia: !!(ctx.guardia || n.optional)
      });
    } else {
      visita(n.object, scope, { catena: true, guardia: !!(ctx.guardia || n.optional) });
    }
    if (n.computed) visita(n.property, scope);
  }

  function funzione(n, scope) {
    const s = nuovoScope('funzione', scope);
    if (n.type === 'FunctionExpression' && n.id) dichiara(s, n.id.name, 'function', n.id, { nascosta: true });
    if (n.type !== 'ArrowFunctionExpression') dichiara(s, 'arguments', 'param', n, { nascosta: true });
    n.params.forEach(function (p) { dichiaraPattern(p, s, 'param'); });
    if (n.body.type === 'BlockStatement') n.body.body.forEach(function (st) { visita(st, s); });
    else visita(n.body, s);
  }

  function classe(n, scope) {
    if (n.superClass) visita(n.superClass, scope);
    const s = nuovoScope('blocco', scope);
    if (n.type === 'ClassExpression' && n.id) dichiara(s, n.id.name, 'class', n.id, { nascosta: true });
    n.body.body.forEach(function (el) { visita(el, s); });
  }

  function metodiDi(n) {
    return n.body.body.filter(function (el) { return el.type === 'MethodDefinition' && !el.computed; })
      .map(function (el) { return (el.key.name || el.key.value) + '(' + parametriDi(el.value.params) + ')'; });
  }

  function stringa(nodo) {
    if (!nodo) return null;
    if (nodo.type === 'Literal' && typeof nodo.value === 'string') return nodo.value;
    if (nodo.type === 'TemplateLiteral' && nodo.expressions.length === 0) return nodo.quasis[0].value.cooked;
    return null;
  }

  function esaminaChiamata(n) {
    const c = n.callee;
    const metodo = c.type === 'MemberExpression' && !c.computed ? c.property.name : (c.type === 'Identifier' ? c.name : null);
    const primo = stringa(n.arguments[0]);
    const riga = n.loc.start.line;
    if (metodo) esito.metodiChiamati.add(metodo);
    if (c.type === 'Identifier' && metodo === 'require') {
      esito.usaNode = true;
      if (primo && /^\./.test(primo)) esito.importLocali.push({ rif: primo, riga: riga });
      return;
    }
    if (primo === null) return;
    if (metodo === 'getElementById') {
      esito.idCercati.push({ nome: primo, riga: riga, testo: testoRiga(riga) });
    } else if (metodo === 'querySelector' || metodo === 'querySelectorAll') {
      const id = /^#([A-Za-z_][\w-]*)$/.exec(primo.trim());
      if (id) esito.idCercati.push({ nome: id[1], riga: riga, testo: testoRiga(riga) });
      const cl = /^\.([A-Za-z_][\w-]*)$/.exec(primo.trim());
      if (cl) esito.classiUsate.push({ nome: cl[1], riga: riga });
    } else if (metodo === 'getElementsByClassName') {
      primo.split(/\s+/).filter(Boolean).forEach(function (k) { esito.classiUsate.push({ nome: k, riga: riga }); });
    } else if (metodo === 'setAttribute' && primo === 'id') {
      const v = stringa(n.arguments[1]);
      if (v) esito.idCreati.push(v); else esito.idDinamici = true;
    } else if (c.type === 'MemberExpression' && c.object.type === 'MemberExpression' && !c.object.computed &&
               c.object.property.name === 'classList') {
      n.arguments.forEach(function (a) { const k = stringa(a); if (k) esito.classiUsate.push({ nome: k, riga: riga }); });
    }
  }

  function esaminaAssegnazione(n) {
    if (n.left.type !== 'MemberExpression' || n.left.computed) return;
    const prop = n.left.property.name;
    const valore = stringa(n.right);
    if (prop === 'id') { if (valore) esito.idCreati.push(valore); else esito.idDinamici = true; }
    if (prop === 'className' && valore) {
      valore.split(/\s+/).filter(Boolean).forEach(function (k) { esito.classiUsate.push({ nome: k, riga: n.loc.start.line }); });
    }
  }

  function visita(n, scope, ctx) {
    if (!n || typeof n.type !== 'string') return;
    switch (n.type) {
      case 'Identifier':
        riferimento(n, scope, ctx ? { guardia: !!ctx.guardia, chiamata: !!ctx.chiamata, nuovo: !!ctx.nuovo } : null);
        return;
      case 'VariableDeclaration': {
        const dest = n.kind === 'var' ? scopeDiFunzione(scope) : scope;
        n.declarations.forEach(function (d) {
          if (d.id.type === 'Identifier') {
            const dich = dichiara(dest, d.id.name, n.kind, d.id, descrivi(d.init));
            if (d.init && d.init.type === 'ObjectExpression') {
              const info = chiaviOggetto(d.init);
              if (!info.dinamico && !info.conMetodi) esito.oggetti.push({ dichiarazione: dich, chiavi: info.chiavi });
            }
          } else {
            dichiaraPattern(d.id, dest, n.kind);
          }
          if (d.init) visita(d.init, scope);
        });
        return;
      }
      case 'FunctionDeclaration': {
        const extra = { parametri: parametriDi(n.params), asincrona: !!n.async, funzione: true };
        const dest = scopeDiFunzione(scope);
        if (n.id) {
          dichiara(scope, n.id.name, 'function', n.id, extra);
          // Fuori dai moduli una funzione dentro un blocco e' visibile anche fuori (regola storica dei browser).
          if (dest !== scope && !esito.rigorosa) dichiara(dest, n.id.name, 'function', n.id, Object.assign({ nascosta: true }, extra));
        }
        funzione(n, scope);
        return;
      }
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        funzione(n, scope);
        return;
      case 'ClassDeclaration':
        if (n.id) dichiara(scope, n.id.name, 'class', n.id, { classe: true, metodi: metodiDi(n) });
        classe(n, scope);
        return;
      case 'ClassExpression':
        classe(n, scope);
        return;
      case 'BlockStatement':
      case 'StaticBlock': {
        const s = nuovoScope(n.type === 'StaticBlock' ? 'funzione' : 'blocco', scope);
        n.body.forEach(function (st) { visita(st, s); });
        return;
      }
      case 'ForStatement': {
        const s = nuovoScope('blocco', scope);
        visita(n.init, s); visita(n.test, s); visita(n.update, s); visita(n.body, s);
        return;
      }
      case 'ForInStatement':
      case 'ForOfStatement': {
        const s = nuovoScope('blocco', scope);
        if (n.left.type === 'VariableDeclaration') {
          const dest = n.left.kind === 'var' ? scopeDiFunzione(scope) : s;
          n.left.declarations.forEach(function (d) { dichiaraPattern(d.id, dest, n.left.kind); });
        } else {
          scriviPattern(n.left, s);
        }
        visita(n.right, s);
        visita(n.body, s);
        return;
      }
      case 'CatchClause': {
        const s = nuovoScope('blocco', scope);
        if (n.param) dichiaraPattern(n.param, s, 'catch');
        n.body.body.forEach(function (st) { visita(st, s); });
        return;
      }
      case 'SwitchStatement': {
        visita(n.discriminant, scope);
        const s = nuovoScope('blocco', scope);
        n.cases.forEach(function (c) { visita(c.test, s); c.consequent.forEach(function (st) { visita(st, s); }); });
        return;
      }
      case 'WithStatement':
        esito.conWith = true;
        break;
      case 'MemberExpression':
        membro(n, scope, ctx);
        return;
      case 'ChainExpression':
        visita(n.expression, scope, Object.assign({}, ctx, { guardia: true }));
        return;
      case 'CallExpression':
      case 'NewExpression': {
        const guardia = !!(ctx && ctx.guardia);
        if (n.callee.type === 'MemberExpression') membro(n.callee, scope, { chiamata: true, guardia: guardia });
        else visita(n.callee, scope, { chiamata: true, nuovo: n.type === 'NewExpression', guardia: guardia });
        n.arguments.forEach(function (a) { visita(a, scope); });
        esaminaChiamata(n);
        return;
      }
      case 'UnaryExpression':
        if (n.operator === 'typeof') return visita(n.argument, scope, { guardia: true });
        if (n.operator === 'delete' && n.argument.type === 'MemberExpression') return membro(n.argument, scope, { scrittura: true });
        return visita(n.argument, scope);
      case 'BinaryExpression':
        // "chiave" in oggetto e' un controllo, non una lettura che si puo' rompere
        if (n.operator === 'in') { visita(n.left, scope); return visita(n.right, scope, { guardia: true }); }
        break;
      case 'AssignmentExpression':
        scriviPattern(n.left, scope);
        visita(n.right, scope);
        esaminaAssegnazione(n);
        return;
      case 'UpdateExpression':
        scriviPattern(n.argument, scope);
        return;
      case 'Property':
        if (n.computed) visita(n.key, scope);
        visita(n.value, scope);
        return;
      case 'MethodDefinition':
      case 'PropertyDefinition':
        if (n.computed) visita(n.key, scope);
        if (n.value) visita(n.value, scope);
        return;
      case 'LabeledStatement':
        visita(n.body, scope);
        return;
      case 'BreakStatement':
      case 'ContinueStatement':
      case 'MetaProperty':
        return;
      case 'ImportDeclaration':
        n.specifiers.forEach(function (sp) {
          const importato = sp.type === 'ImportSpecifier' ? (sp.imported.name || sp.imported.value)
            : (sp.type === 'ImportDefaultSpecifier' ? 'default' : '*');
          dichiara(scope, sp.local.name, 'import', sp.local, { da: n.source.value, importato: importato });
        });
        if (/^\./.test(n.source.value)) esito.importLocali.push({ rif: n.source.value, riga: n.loc.start.line });
        return;
      case 'ExportNamedDeclaration':
        esito.esportati = esito.esportati || [];
        if (n.declaration) {
          visita(n.declaration, scope);
          const d = n.declaration;
          if (d.type === 'VariableDeclaration') {
            d.declarations.forEach(function (x) {
              // export const {a, b} = ...: i nomi esportati non si leggono con certezza
              if (x.id.type === 'Identifier') esito.esportati.push(x.id.name); else esito.esportaTutto = true;
            });
          } else if (d.id) {
            esito.esportati.push(d.id.name);
          }
        }
        n.specifiers.forEach(function (sp) {
          esito.esportati.push(sp.exported.name || sp.exported.value);
          if (!n.source && sp.local.type === 'Identifier') riferimento(sp.local, scope);
        });
        if (n.source && /^\./.test(n.source.value)) esito.importLocali.push({ rif: n.source.value, riga: n.loc.start.line });
        return;
      case 'ExportDefaultDeclaration':
        esito.esportati = (esito.esportati || []).concat('default');
        visita(n.declaration, scope);
        return;
      case 'ExportAllDeclaration':
        if (n.exported) esito.esportati = (esito.esportati || []).concat(n.exported.name || n.exported.value);
        else esito.esportaTutto = true;
        if (/^\./.test(n.source.value)) esito.importLocali.push({ rif: n.source.value, riga: n.loc.start.line });
        return;
    }
    // Tutto il resto: si visitano i figli, e ogni Identifier li' dentro e' l'uso di un nome.
    for (const chiave in n) {
      if (chiave === 'type' || chiave === 'loc' || chiave === 'start' || chiave === 'end') continue;
      const v = n[chiave];
      if (Array.isArray(v)) v.forEach(function (x) { if (x && typeof x.type === 'string') visita(x, scope); });
      else if (v && typeof v.type === 'string') visita(v, scope);
    }
  }

  const radice = nuovoScope(esito.modulo ? 'modulo' : 'globale', null);
  esito.scope = radice;
  ast.body.forEach(function (st) { visita(st, radice); });

  // Id scritti dentro stringhe HTML (innerHTML, template): elementi creati dal codice.
  let m;
  const reIdStringa = /\bid\s*=\s*\\?["']([A-Za-z_][\w-]*)\\?["']/g;
  while ((m = reIdStringa.exec(codice)) !== null) esito.idCreati.push(m[1]);
  if (/\bid\s*=\s*\\?["'`][^"'`\n]*\$\{/.test(codice)) esito.idDinamici = true;

  const usati = new Set(esito.riferimenti.map(function (r) { return r.nome; }));
  if (['module', 'exports', '__dirname', '__filename'].some(function (x) { return usati.has(x) && !radice.nomi.has(x); })) {
    esito.usaNode = true;
  }
  return esito;
}

// ------------------------------------------------------------ Il progetto
//
// Le pagine HTML dicono quali script girano insieme: gli script classici della stessa
// pagina condividono i nomi globali (una funzione di a.js si chiama anche da b.js). I
// file che nessuna pagina carica e che usano require/module sono programmi Node.

// Nomi forniti dai programmi di test (jest, mocha, vitest) e dai service worker.
const GLOBALI_TEST = new Set(['describe', 'it', 'test', 'expect', 'beforeEach', 'afterEach', 'beforeAll',
  'afterAll', 'jest', 'vi', 'suite', 'setup', 'teardown', 'context', 'xit', 'xdescribe', 'fit', 'fdescribe']);
const GLOBALI_SERVICE_WORKER = new Set(['clients', 'registration', 'skipWaiting', 'serviceWorker']);

function risolviLocale(r) {
  let s = r.scope;
  while (s) {
    const ds = s.nomi.get(r.nome);
    if (ds) return ds;
    s = s.padre;
  }
  return null;
}

function risolviRisorsa(radice, daFile, rif) {
  let pulito = rif;
  try { pulito = decodeURIComponent(rif); } catch (e) {}
  if (pulito.startsWith('/')) return path.resolve(radice, pulito.replace(/^\/+/, ''));
  return path.resolve(path.dirname(path.join(radice, daFile)), pulito);
}

function sembraLibreria(file, testo) {
  if (/\.min\.js$/i.test(file)) return true;
  if (/define\.amd/.test(testo) && /typeof\s+exports/.test(testo)) return true;
  // codice minificato: poche righe lunghissime
  return testo.length > 20000 && testo.split('\n').length < testo.length / 400;
}

function analizzaProgettoCervello(dir) {
  const inizio = Date.now();
  const radice = path.resolve(dir);
  const elenco = elencaFile(radice);
  const progetto = {
    radice: radice, html: [], js: [], css: [], pagine: [], problemi: [], collegamenti: [],
    elenco: elenco.map(function (f) { return relativo(radice, f); }),
    troncato: elenco.length >= 400, durataMs: 0
  };
  const jsPerPercorso = new Map();
  const chiaviViste = new Set();

  function problema(file, riga, tipo, grave, messaggio) {
    const chiave = file + '|' + tipo;
    if (chiaviViste.has(chiave)) return;
    chiaviViste.add(chiave);
    progetto.problemi.push({ file: file, riga: riga, grave: !!grave, messaggio: messaggio, chiave: chiave });
  }

  elenco.forEach(function (f) {
    const ext = path.extname(f).toLowerCase();
    if (['.js', '.mjs', '.cjs', '.html', '.htm', '.css'].indexOf(ext) === -1) return;
    const rel = relativo(radice, f);
    const testo = leggi(f);
    if (ext === '.css') { progetto.css.push(analizzaCss(rel, testo)); return; }
    if (ext === '.html' || ext === '.htm') { progetto.html.push(analizzaHtml(rel, testo)); return; }
    const a = analizzaJs(rel, testo, { modulo: ext === '.mjs' });
    a.percorso = path.resolve(f);
    a.cjs = ext === '.cjs';
    a.libreria = sembraLibreria(rel, testo);
    a.righeTotali = testo.split('\n').length;
    a.pagine = [];
    progetto.js.push(a);
    jsPerPercorso.set(a.percorso.toLowerCase(), a);
  });

  progetto.html.forEach(function (h) {
    const pagina = { html: h, script: [], esterni: false, id: new Set() };
    h.id.forEach(function (i) { pagina.id.add(i.nome); });
    h.script.forEach(function (s) {
      if (s.ignorato) return;
      let a = null;
      if (s.src) {
        if (esterno(s.src)) { pagina.esterni = true; return; }
        const trovato = trovaRisorsa(h.file, pulisciRif(s.src));
        a = trovato ? jsPerPercorso.get(trovato.toLowerCase()) : null;
        if (!a) return;          // il file che manca lo segnala il controllo delle risorse
        if (s.modulo && a.scope) { a.modulo = true; a.rigorosa = true; a.scope.tipo = 'modulo'; }
      } else if (s.codice.trim()) {
        a = analizzaJs(h.file, '\n'.repeat(s.riga - 1) + s.codice, { modulo: s.modulo });
        a.inline = true;
        a.pagine = [];
        progetto.js.push(a);
      }
      if (!a) return;
      if (a.libreria) pagina.esterni = true;
      if (a.pagine.indexOf(pagina) === -1) a.pagine.push(pagina);
      pagina.script.push(a);
    });
    h.gestori.forEach(function (g) {
      const a = analizzaJs(h.file, '\n'.repeat(g.riga - 1) + '(function (event) {' + g.codice + '\n})');
      a.inline = true;
      a.gestore = g.evento;
      a.pagine = [pagina];
      progetto.js.push(a);
      pagina.script.push(a);
    });
    progetto.pagine.push(pagina);
  });

  // import e require fra file locali: chi usa chi. Un modulo importato da un modulo
  // della pagina gira nella stessa pagina.
  progetto.js.forEach(function (a) {
    const base = a.percorso ? path.dirname(a.percorso) : path.dirname(path.join(radice, a.file));
    a.importLocali.forEach(function (imp) {
      const candidati = [imp.rif, imp.rif + '.js', imp.rif + '.mjs', imp.rif + '.cjs', imp.rif + '.json', path.join(imp.rif, 'index.js')];
      for (let i = 0; i < candidati.length; i++) {
        const assoluto = path.resolve(base, candidati[i]);
        const bersaglio = jsPerPercorso.get(assoluto.toLowerCase());
        if (bersaglio) { progetto.collegamenti.push({ da: a, a: bersaglio, rif: imp.rif, riga: imp.riga }); return; }
        try { if (fs.statSync(assoluto).isFile()) return; } catch (e) {}
      }
      problema(a.file, imp.riga, 'import-mancante:' + imp.rif, true,
        'importa "' + imp.rif + '" ma quel file non esiste: il codice si ferma subito.');
    });
  });
  let propagato = true;
  while (propagato) {
    propagato = false;
    progetto.collegamenti.forEach(function (c) {
      c.da.pagine.forEach(function (p) {
        if (c.a.pagine.indexOf(p) === -1) { c.a.pagine.push(p); p.script.push(c.a); propagato = true; }
      });
    });
  }

  progetto.js.forEach(function (a) {
    if (a.pagine.length) a.ambiente = 'browser';
    else if (a.usaNode || a.cjs) a.ambiente = 'node';
    else a.ambiente = 'sconosciuto';
    a.test = /(^|\/)(tests?|spec|__tests__)\//i.test(a.file) || /\.(test|spec)\.[cm]?js$/i.test(a.file);
  });

  // I nomi globali di un gruppo di script: dichiarati al livello piu' alto degli script
  // classici, assegnati senza dichiarazione (x = 1), scritti su window, e gli id degli
  // elementi (il browser li espone come variabili: <canvas id="gioco"> diventa gioco).
  function nomiGlobaliDi(gruppo, id) {
    const dichiarati = new Map();
    const impliciti = new Set();
    gruppo.forEach(function (a) {
      if (!a.scope) return;
      if (a.scope.tipo === 'globale') {
        a.scope.nomi.forEach(function (ds, nome) {
          if (!dichiarati.has(nome)) dichiarati.set(nome, []);
          ds.forEach(function (d) { dichiarati.get(nome).push(d); });
        });
      }
      a.riferimenti.forEach(function (r) {
        if (r.scrittura && !a.rigorosa && !risolviLocale(r)) impliciti.add(r.nome);
        if (r.scritturaChiave && r.chiave && ['window', 'globalThis', 'self'].indexOf(r.nome) !== -1 && !risolviLocale(r)) {
          impliciti.add(r.chiave);
        }
      });
    });
    id.forEach(function (nome) { if (/^[A-Za-z_$][\w$]*$/.test(nome)) impliciti.add(nome); });
    return { dichiarati: dichiarati, impliciti: impliciti };
  }
  progetto.pagine.forEach(function (p) { p.nomi = nomiGlobaliDi(p.script, Array.from(p.id)); });
  const senzaPagina = nomiGlobaliDi(progetto.js.filter(function (a) { return a.ambiente === 'sconosciuto'; }), []);

  function cercaNelContesto(nome, a) {
    if (a.test && GLOBALI_TEST.has(nome)) return { sistema: true };
    if (a.ambiente === 'browser') {
      let prudente = false;
      for (let i = 0; i < a.pagine.length; i++) {
        const p = a.pagine[i];
        if (p.nomi.dichiarati.has(nome)) return { dichiarazioni: p.nomi.dichiarati.get(nome) };
        if (p.nomi.impliciti.has(nome)) return { implicito: true };
        if (p.esterni) prudente = true;
      }
      if (GLOBALI_BROWSER.has(nome)) return { sistema: true };
      return { mancante: true, prudente: prudente };
    }
    if (a.ambiente === 'node') {
      if (GLOBALI_NODE.has(nome)) return { sistema: true };
      if (!a.impliciti) a.impliciti = nomiGlobaliDi([a], []).impliciti;
      if (a.impliciti.has(nome)) return { implicito: true };
      return { mancante: true, prudente: false };
    }
    if (senzaPagina.dichiarati.has(nome)) return { dichiarazioni: senzaPagina.dichiarati.get(nome) };
    if (senzaPagina.impliciti.has(nome) || GLOBALI_BROWSER.has(nome) || GLOBALI_NODE.has(nome) ||
        GLOBALI_SERVICE_WORKER.has(nome)) return { sistema: true };
    return { mancante: true, prudente: false };
  }

  // Ogni uso di un nome viene collegato alla sua dichiarazione, anche se sta in un altro file.
  progetto.js.forEach(function (a) {
    if (!a.scope) return;
    a.riferimenti.forEach(function (r) {
      const locale = risolviLocale(r);
      if (locale) { r.dichiarazioni = locale; return; }
      const trovato = cercaNelContesto(r.nome, a);
      if (trovato.dichiarazioni) r.dichiarazioni = trovato.dichiarazioni;
      else r.esito = trovato;
    });
  });

  // ------------------------------------------------------------ I controlli
  //
  // Solo gli errori sicuri sono "gravi": quelli Adam li deve correggere, e un falso allarme
  // lo spingerebbe a rompere codice giusto. I dubbi restano "da controllare".

  function trovaRisorsa(daFile, rif) {
    const candidati = [risolviRisorsa(radice, daFile, rif)];
    if (rif.startsWith('/')) {
      // "/js/main.js" si legge dalla cartella del sito, che spesso e' quella dell'HTML e non la radice.
      let pulito = rif;
      try { pulito = decodeURIComponent(rif); } catch (e) {}
      candidati.push(path.resolve(path.dirname(path.join(radice, daFile)), pulito.replace(/^\/+/, '')));
    }
    for (let i = 0; i < candidati.length; i++) if (fs.existsSync(candidati[i])) return candidati[i];
    return null;
  }

  // Un server Node puo' servire file che non stanno dove l'HTML li cerca (es. /vendor preso da node_modules).
  const conServer = progetto.js.some(function (a) {
    return a.ambiente === 'node' && a.riferimenti.some(function (r) {
      return r.nome === 'express' || (r.nome === 'http' && r.chiave === 'createServer');
    });
  });

  // Una pagina con uno script locale che il cervello non ha letto porta nomi sconosciuti.
  progetto.pagine.forEach(function (p) {
    p.scriptSconosciuti = p.html.script.some(function (s) {
      if (!s.src || s.ignorato || esterno(s.src)) return false;
      const trovato = trovaRisorsa(p.html.file, pulisciRif(s.src));
      const a = trovato && jsPerPercorso.get(trovato.toLowerCase());
      return !a || p.script.indexOf(a) === -1;
    });
  });

  progetto.js.forEach(function (a) {
    if (!a.errore || a.libreria) return;
    problema(a.file, a.errore.riga, 'sintassi' + (a.inline ? ':' + a.errore.riga : ''), true,
      'errore di sintassi ' + (a.gestore ? 'nell\'attributo ' + a.gestore + ' ' : '') + 'alla riga ' + a.errore.riga +
      ', colonna ' + a.errore.colonna + ': ' + a.errore.messaggio + '. Finche\' non lo correggi ' +
      (a.inline ? 'questo script' : 'questo file') + ' non parte per niente.');
  });

  function nomiVicini(r, a) {
    const nomi = [];
    for (let s = r.scope; s; s = s.padre) s.nomi.forEach(function (ds, n) { if (!ds[0].nascosta) nomi.push(n); });
    a.pagine.forEach(function (p) {
      p.nomi.dichiarati.forEach(function (ds, n) { nomi.push(n); });
      p.nomi.impliciti.forEach(function (n) { nomi.push(n); });
    });
    if (a.ambiente === 'sconosciuto') senzaPagina.dichiarati.forEach(function (ds, n) { nomi.push(n); });
    (a.ambiente === 'node' ? GLOBALI_NODE : GLOBALI_BROWSER).forEach(function (n) { nomi.push(n); });
    return nomi;
  }

  function doveE(nome, r, a) {
    for (let s = r.scope; s; s = s.padre) {
      const ds = s.nomi.get(nome);
      if (ds && !ds[0].nascosta) return ' (' + ds[0].file + ':' + ds[0].riga + ')';
    }
    for (let i = 0; i < a.pagine.length; i++) {
      const ds = a.pagine[i].nomi.dichiarati.get(nome);
      if (ds) return ' (' + ds[0].file + ':' + ds[0].riga + ')';
    }
    return '';
  }

  // Nomi usati ma mai dichiarati.
  const METODI_BROWSER_REMOTO = new Set(['evaluate', 'evaluateHandle', 'evaluateOnNewDocument', '$eval', '$$eval',
    'waitForFunction', 'addInitScript', 'executeScript']);
  if (GLOBALI_AFFIDABILI) {
    const mancanti = new Map();
    progetto.js.forEach(function (a) {
      if (!a.scope || a.libreria || a.conWith) return;
      // eval e new Function creano nomi che nessuno puo' vedere leggendo il codice
      if (a.riferimenti.some(function (r) { return (r.nome === 'eval' && r.chiamata) || (r.nome === 'Function' && r.nuovo); })) return;
      // Codice che un file Node manda a eseguire dentro Chrome (puppeteer): li' document esiste davvero.
      const browserRemoto = a.ambiente !== 'browser' && Array.from(a.metodiChiamati).some(function (m) { return METODI_BROWSER_REMOTO.has(m); });
      // if (typeof x !== 'undefined') x(): chi controlla con typeof sa che il nome puo' mancare
      const protetti = new Set(a.riferimenti.filter(function (r) { return r.guardia && !r.chiave; }).map(function (r) { return r.nome; }));
      const paginaIncerta = a.pagine.some(function (p) { return p.scriptSconosciuti; });
      a.riferimenti.forEach(function (r) {
        if (!r.esito || !r.esito.mancante || r.guardia) return;
        if (r.scrittura && !a.rigorosa) return;   // fuori dai moduli "x = 1" crea una variabile globale
        if ((browserRemoto && GLOBALI_BROWSER.has(r.nome)) || protetti.has(r.nome)) return;
        const chiave = a.file + '|' + r.nome;
        let voce = mancanti.get(chiave);
        if (!voce) {
          voce = { a: a, r: r, righe: [], chiamata: false, scrittura: false, prudente: !!r.esito.prudente || paginaIncerta };
          mancanti.set(chiave, voce);
        }
        if (voce.righe.indexOf(r.riga) === -1) voce.righe.push(r.riga);
        if (r.chiamata) voce.chiamata = true;
        if (r.scrittura) voce.scrittura = true;
      });
    });
    // Con librerie che il cervello non legge (CDN, file serviti dal server) un nome sconosciuto puo'
    // venire da li'. Le librerie espongono di solito nomi come THREE, Phaser, $: quelli si lasciano
    // stare; un nome minuscolo e isolato resta un probabile errore, ma solo "da controllare".
    const prudentiPerFile = new Map();
    mancanti.forEach(function (v) {
      if (v.prudente) prudentiPerFile.set(v.a.file, (prudentiPerFile.get(v.a.file) || 0) + 1);
    });
    mancanti.forEach(function (v) {
      const nome = v.r.nome;
      let simili = nomiSimili(nome, nomiVicini(v.r, v.a), 2);
      if (v.prudente) {
        simili = simili.filter(function (s) { return s.toLowerCase() !== nome.toLowerCase(); });
        if (!simili.length && (/^[A-Z$_]/.test(nome) || prudentiPerFile.get(v.a.file) > 5)) return;
      }
      let testo;
      if (v.a.gestore) testo = 'l\'attributo ' + v.a.gestore + ' usa "' + nome + '" ma non esiste nessuna funzione o variabile con questo nome';
      else if (v.scrittura) testo = 'assegni un valore a "' + nome + '" senza averla dichiarata (manca let o const): in un modulo questo blocca lo script';
      else if (v.chiamata) testo = 'chiami ' + nome + '() ma nessuna funzione "' + nome + '" esiste: il programma si ferma con "' + nome + ' is not defined"';
      else testo = 'usi "' + nome + '" ma non e\' dichiarata da nessuna parte: il programma si ferma con "' + nome + ' is not defined"';
      if (simili.length) testo += '. Forse volevi ' + simili.map(function (s) { return '"' + s + '"' + doveE(s, v.r, v.a); }).join(' o ');
      if (v.righe.length > 1) testo += ' (righe ' + v.righe.slice(0, 6).join(', ') + (v.righe.length > 6 ? ', ...' : '') + ')';
      problema(v.a.file, v.righe[0], 'nome:' + nome, !v.prudente, testo + '.');
    });
  }

  // Lo stesso nome dichiarato in due script della stessa pagina, o una funzione definita piu' volte.
  function controllaDoppi(mappa) {
    mappa.forEach(function (ds, nome) {
      const visti = new Set();
      const visibili = ds.filter(function (d) {
        const k = d.file + ':' + d.riga;
        if (d.nascosta || visti.has(k)) return false;
        visti.add(k);
        return true;
      });
      if (visibili.length < 2) return;
      const lessicale = visibili.some(function (d) { return d.tipo === 'let' || d.tipo === 'const' || d.tipo === 'class'; });
      const altroScript = visibili.find(function (d) { return d.scope !== visibili[0].scope; });
      if (lessicale && altroScript) {
        problema(altroScript.file, altroScript.riga, 'doppia:' + nome, true,
          '"' + nome + '" e\' dichiarata anche in ' + visibili[0].file + ':' + visibili[0].riga +
          ' e i due script girano nella stessa pagina: il browser si ferma con "Identifier \'' + nome +
          '\' has already been declared" e questo script non parte. Tieni una sola dichiarazione.');
      }
      const funzioni = visibili.filter(function (d) { return d.tipo === 'function'; });
      if (funzioni.length > 1) {
        const ultima = funzioni[funzioni.length - 1];
        problema(ultima.file, ultima.riga, 'funzione-doppia:' + nome, false,
          'la funzione ' + nome + '() e\' definita ' + funzioni.length + ' volte (' +
          funzioni.map(function (d) { return d.file + ':' + d.riga; }).join(', ') +
          '): vale solo l\'ultima, le altre sono codice morto. Tienine una sola.');
      }
    });
  }
  progetto.pagine.forEach(function (p) {
    controllaDoppi(p.nomi.dichiarati);
    const caricati = new Set();
    p.html.script.forEach(function (s) {
      if (!s.src || esterno(s.src)) return;
      const k = pulisciRif(s.src).replace(/^\.?\//, '').toLowerCase();
      if (caricati.has(k)) {
        problema(p.html.file, s.rigaTag, 'script-doppio:' + k, false, 'carica due volte "' + s.src +
          '": il codice gira due volte (eventi doppi) e con let/const il secondo caricamento si blocca.');
      }
      caricati.add(k);
    });
  });
  progetto.js.forEach(function (a) { if (a.scope && !a.pagine.length && !a.libreria) controllaDoppi(a.scope.nomi); });

  // Oggetti letterali: chiavi lette ma mai create, valori chiamati come se fossero funzioni.
  const oggetti = new Map();
  progetto.js.forEach(function (a) {
    if (a.libreria) return;
    a.oggetti.forEach(function (o) {
      oggetti.set(o.dichiarazione, { chiavi: new Set(o.chiavi), aggiunte: new Set(), sfuggito: false, letture: [] });
    });
  });
  progetto.js.forEach(function (a) {
    if (!a.scope || a.libreria) return;
    a.riferimenti.forEach(function (r) {
      const ds = r.dichiarazioni;
      if (!ds || !ds.length) return;
      ds.forEach(function (d) {
        const info = oggetti.get(d);
        if (!info) return;
        // passato a una funzione, copiato, letto con [chiave]: puo' cambiare ovunque, non si giudica
        if (r.scrittura || (!r.chiave && !r.guardia)) info.sfuggito = true;
        else if (r.chiave && r.scritturaChiave) info.aggiunte.add(r.chiave);
        else if (r.chiave) info.letture.push({ r: r, a: a });
      });
      if (!r.chiamata || r.chiave) return;
      if (ds.every(function (d) { return d.tipo === 'const' && d.letterale; })) {
        problema(a.file, r.riga, 'non-funzione:' + r.nome, true,
          'chiami ' + r.nome + '() ma "' + r.nome + '" non e\' una funzione: e\' ' + ds[0].valore + ' (' + ds[0].file + ':' +
          ds[0].riga + '). Il programma si ferma con "' + r.nome + ' is not a function".');
      } else if (!r.nuovo && ds.every(function (d) { return d.classe; })) {
        problema(a.file, r.riga, 'classe-senza-new:' + r.nome, true,
          r.nome + ' e\' una classe (' + ds[0].file + ':' + ds[0].riga + '): va creata con new ' + r.nome +
          '(...). Senza new il programma si ferma.');
      }
    });
  });
  oggetti.forEach(function (info, d) {
    if (info.sfuggito) return;
    const perChiave = new Map();
    info.letture.forEach(function (l) {
      const k = l.r.chiave;
      if (info.chiavi.has(k) || info.aggiunte.has(k) || PROTOTIPO_OGGETTO.has(k)) return;
      const id = l.a.file + '|' + k;
      let v = perChiave.get(id);
      if (!v) { v = { a: l.a, k: k, righe: [], grave: false }; perChiave.set(id, v); }
      if (v.righe.indexOf(l.r.riga) === -1) v.righe.push(l.r.riga);
      if ((l.r.chiamataChiave || l.r.catena) && !l.r.guardia) v.grave = true;
    });
    perChiave.forEach(function (v) {
      const tutte = Array.from(info.chiavi).concat(Array.from(info.aggiunte));
      const simili = nomiSimili(v.k, tutte, 2);
      problema(v.a.file, v.righe[0], 'chiave:' + d.nome + '.' + v.k, v.grave,
        d.nome + '.' + v.k + ' non esiste: l\'oggetto ' + d.nome + ' (' + d.file + ':' + d.riga + ') ha solo ' +
        (tutte.slice(0, 12).join(', ') || 'nessuna chiave') + (tutte.length > 12 ? ', ...' : '') +
        (simili.length ? '. Forse volevi ' + d.nome + '.' + simili[0] : '') +
        (v.grave ? '. Usarlo cosi\' blocca il programma (TypeError)' : '. Vale undefined') +
        (v.righe.length > 1 ? ' (righe ' + v.righe.slice(0, 6).join(', ') + ')' : '') + '.');
    });
  });

  // Id cercati dal codice che nessun HTML contiene, e id doppi.
  if (progetto.html.length) {
    const idCreati = new Set();
    let idDinamici = false;
    progetto.js.forEach(function (a) {
      a.idCreati.forEach(function (i) { idCreati.add(i); });
      if (a.idDinamici) idDinamici = true;
    });
    const tuttiGliId = new Set();
    progetto.html.forEach(function (h) { h.id.forEach(function (i) { tuttiGliId.add(i.nome); }); });
    progetto.js.forEach(function (a) {
      // nei file Node il DOM e' quello di una pagina esterna (puppeteer): i suoi id non stanno nel progetto
      if (a.libreria || a.ambiente === 'node') return;
      const noti = a.pagine.length ? new Set([].concat.apply([], a.pagine.map(function (p) { return Array.from(p.id); }))) : tuttiGliId;
      a.idCercati.forEach(function (c) {
        if (noti.has(c.nome) || idCreati.has(c.nome)) return;
        const simili = nomiSimili(c.nome, Array.from(noti), 2);
        const dove = a.pagine.length ? a.pagine.map(function (p) { return p.html.file; }).join(', ') + ' non lo contiene'
          : 'nessun HTML del progetto lo contiene';
        problema(a.file, c.riga, 'id:' + c.nome, !idDinamici,
          'cerca l\'elemento con id "' + c.nome + '" ma ' + dove +
          (simili.length ? ': forse volevi "' + simili.join('" o "') + '"' : '') + '. getElementById restituira\' null.');
      });
    });
    progetto.html.forEach(function (h) {
      const visti = new Map();
      h.id.forEach(function (i) {
        if (visti.has(i.nome)) {
          problema(h.file, i.riga, 'id-doppio:' + i.nome, false, 'l\'id "' + i.nome + '" compare due volte (anche alla riga ' +
            visti.get(i.nome) + '): getElementById trova solo il primo.');
        } else {
          visti.set(i.nome, i.riga);
        }
      });
    });
  }

  // File che l'HTML carica ma che non esistono.
  // "/vendor" citato nel codice del server vuol dire che quel percorso lo fornisce il server.
  let testoServer = null;
  function servitoDalServer(rif) {
    if (!conServer || !rif.startsWith('/')) return false;
    if (testoServer === null) {
      testoServer = progetto.js.filter(function (a) { return a.ambiente === 'node' && a.percorso; })
        .map(function (a) { return leggi(a.percorso); }).join('\n');
    }
    const primo = '/' + rif.replace(/^\/+/, '').split('/')[0];
    return ["'", '"', '`'].some(function (q) {
      return testoServer.indexOf(q + primo + q) !== -1 || testoServer.indexOf(q + primo + '/') !== -1;
    });
  }
  progetto.html.forEach(function (h) {
    h.risorse.forEach(function (r) {
      if (trovaRisorsa(h.file, r.rif) || servitoDalServer(r.rif)) return;
      const nome = path.basename(r.rif).toLowerCase();
      const stesso = progetto.elenco.filter(function (f) { return path.basename(f).toLowerCase() === nome; });
      problema(h.file, r.riga, 'risorsa:' + r.rif, !conServer,
        'carica "' + r.rif + '" ma il file non esiste' +
        (stesso.length ? ' (esiste ' + stesso.slice(0, 2).join(', ') + ': correggi il percorso)' : '') +
        (conServer ? ' nella cartella: controlla che il server lo fornisca' : '') + '.');
    });
  });

  // import { nome } da un modulo che non lo esporta.
  progetto.collegamenti.forEach(function (c) {
    if (!c.da.modulo || !c.a.modulo || c.a.esportaTutto) return;
    const esportati = c.a.esportati || [];
    c.da.dichiarazioni.forEach(function (d) {
      if (d.tipo !== 'import' || d.da !== c.rif || !d.importato || d.importato === '*') return;
      if (esportati.indexOf(d.importato) !== -1) return;
      const simili = nomiSimili(d.importato, esportati, 2);
      problema(c.da.file, d.riga, 'import:' + d.importato + '@' + c.rif, true,
        'importa ' + (d.importato === 'default' ? 'il valore predefinito (default)' : '"' + d.importato + '"') +
        ' da "' + c.rif + '" ma ' + c.a.file + ' non lo esporta' +
        (simili.length ? ': forse volevi "' + simili.join('" o "') + '"' : ' (esporta: ' + (esportati.join(', ') || 'niente') + ')') +
        '. Il browser blocca tutto il modulo.');
    });
  });

  // File che nessuna pagina usa: il loro codice non gira mai.
  if (progetto.html.length) {
    const importati = new Set(progetto.collegamenti.map(function (c) { return c.a; }));
    const collegati = new Set();
    progetto.html.forEach(function (h) {
      h.risorse.forEach(function (r) { const t = trovaRisorsa(h.file, r.rif); if (t) collegati.add(t.toLowerCase()); });
    });
    const primaPagina = progetto.html[0].file;
    // Un file citato per nome altrove puo' essere caricato dal codice (script creato al volo, Worker, import dinamico).
    let testiProgetto = null;
    const citatoAltrove = function (file) {
      if (testiProgetto === null) {
        testiProgetto = progetto.elenco.filter(function (f) { return /\.(html?|[cm]?js)$/i.test(f); })
          .map(function (f) { return { file: f, testo: leggi(path.join(radice, f)) }; });
      }
      const nome = path.posix.basename(file);
      return testiProgetto.some(function (t) { return t.file !== file && t.testo.indexOf(nome) !== -1; });
    };
    progetto.js.forEach(function (a) {
      if (a.inline || a.libreria || a.test || a.ambiente !== 'sconosciuto' || importati.has(a)) return;
      if (!a.riferimenti.some(function (r) { return r.nome === 'document' || r.nome === 'window'; })) return;
      if (citatoAltrove(a.file)) return;
      problema(a.file, 1, 'non-caricato', false, 'nessuna pagina HTML carica questo file, quindi il suo codice non gira mai: ' +
        'aggiungi <script src="' + path.posix.relative(path.posix.dirname(primaPagina), a.file) + '"></script> nella pagina giusta.');
    });
    progetto.css.forEach(function (c) {
      if (collegati.has(path.resolve(radice, c.file).toLowerCase()) || citatoAltrove(c.file)) return;
      problema(c.file, 1, 'non-collegato', false, 'nessuna pagina HTML collega questo foglio di stile, quindi non si vede: aggiungi ' +
        '<link rel="stylesheet" href="' + path.posix.relative(path.posix.dirname(primaPagina), c.file) + '">.');
    });
  }

  progetto.problemi.sort(function (x, y) {
    return (y.grave - x.grave) || x.file.localeCompare(y.file) || (x.riga - y.riga);
  });
  progetto.durataMs = Date.now() - inizio;
  return progetto;
}

module.exports = {
  analizzaJs: analizzaJs,
  analizzaHtml: analizzaHtml,
  analizzaCss: analizzaCss,
  analizzaProgettoCervello: analizzaProgettoCervello,
  nomiSimili: nomiSimili,
  GLOBALI_BROWSER: GLOBALI_BROWSER,
  GLOBALI_NODE: GLOBALI_NODE
};

// Da riga di comando (Adam con Bash, Claude Code con l'hook) i comandi stanno in cervello-comandi.js.
if (require.main === module) {
  require('./cervello-comandi').principale(process.argv.slice(2)).then(function (codice) {
    process.exit(codice || 0);
  }, function (e) {
    console.error('Cervello: errore interno: ' + e.message);
    process.exit(0);
  });
}
