// NotExist Intelligience Studio - I comandi del cervello.
//
// cervello.js legge il progetto; qui c'e' come lo si usa:
//  - le domande di Adam (--cerca, --file, --controlla, --mappa, --errori): risposte brevi e
//    precise, con file, riga, cosa riceve una funzione e dove viene usata. Brevi sul serio:
//    ogni riga finisce nella memoria di lavoro di Adam, che e' piccola;
//  - il controllo dopo ogni modifica (--hook), chiamato da Claude Code;
//  - la memoria degli errori: cosa e' stato trovato e cosa e' stato corretto, per progetto.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cervello = require('./cervello');

const CARTELLA_DATI = path.join(__dirname, '..', 'dati', 'cervello');

function slash(p) { return String(p).split('\\').join('/'); }
function unici(lista) { return Array.from(new Set(lista)); }
function plurale(n, uno, tanti) { return n + ' ' + (n === 1 ? uno : tanti); }

function descriviScope(d) {
  if (!d.scope) return '';
  if (d.scope.tipo === 'globale') return 'globale';
  if (d.scope.tipo === 'modulo') return 'del modulo';
  return 'locale';
}

function firma(d) {
  switch (d.tipo) {
    case 'function': return 'funzione ' + d.nome + '(' + (d.parametri || '') + ')' + (d.asincrona ? ' [async]' : '');
    case 'class': return 'classe ' + d.nome + (d.metodi && d.metodi.length
      ? ' con metodi ' + d.metodi.slice(0, 12).join(', ') + (d.metodi.length > 12 ? ', ...' : '') : '');
    case 'param': return 'parametro ' + d.nome;
    case 'catch': return 'errore catturato ' + d.nome;
    case 'import': return 'import ' + d.nome + ' da "' + d.da + '"' +
      (d.importato && d.importato !== d.nome ? ' (li\' si chiama ' + d.importato + ')' : '');
    default:
      if (d.funzione) return d.tipo + ' ' + d.nome + ' = funzione(' + (d.parametri || '') + ')';
      return d.tipo + ' ' + d.nome + (d.valore ? ' = ' + d.valore : '');
  }
}

function tutteLeDichiarazioni(progetto) {
  const out = [];
  progetto.js.forEach(function (a) { a.dichiarazioni.forEach(function (d) { out.push(d); }); });
  return out;
}

function usiDi(progetto, dichiarazioni) {
  const insieme = new Set(dichiarazioni);
  const usi = [];
  progetto.js.forEach(function (a) {
    a.riferimenti.forEach(function (r) {
      if (r.dichiarazioni && r.dichiarazioni.some(function (d) { return insieme.has(d); })) usi.push(r);
    });
  });
  return usi;
}

function fogliDiStile(progetto) {
  return progetto.css.concat([].concat.apply([], progetto.html.map(function (h) { return h.stili; })));
}

// Dove compare un id o una classe: nell'HTML, nel CSS, nel codice.
function occorrenzeHtmlCss(progetto, nome, cosa) {
  const righe = [];
  const trova = function (liste) { return unici(liste); };
  if (cosa !== 'classe') {
    const html = [], css = [], js = [];
    progetto.html.forEach(function (h) { h.id.forEach(function (i) { if (i.nome === nome) html.push(h.file + ':' + i.riga); }); });
    fogliDiStile(progetto).forEach(function (c) { c.id.forEach(function (i) { if (i.nome === nome) css.push(c.file + ':' + i.riga); }); });
    progetto.js.forEach(function (a) { a.idCercati.forEach(function (i) { if (i.nome === nome) js.push(a.file + ':' + i.riga); }); });
    if (html.length || css.length || js.length) {
      righe.push('id "' + nome + '": ' + [
        html.length ? 'nell\'HTML ' + trova(html).join(', ') : 'NON e\' in nessun HTML',
        css.length ? 'stile in ' + trova(css).slice(0, 6).join(', ') : '',
        js.length ? 'cercato dal codice in ' + trova(js).slice(0, 8).join(', ') : ''
      ].filter(Boolean).join('; '));
    }
  }
  if (cosa !== 'id') {
    const html = [], css = [], js = [];
    progetto.html.forEach(function (h) { h.classi.forEach(function (k) { if (k.nome === nome) html.push(h.file + ':' + k.riga); }); });
    fogliDiStile(progetto).forEach(function (c) { c.classi.forEach(function (k) { if (k.nome === nome) css.push(c.file + ':' + k.riga); }); });
    progetto.js.forEach(function (a) { a.classiUsate.forEach(function (k) { if (k.nome === nome) js.push(a.file + ':' + k.riga); }); });
    if (html.length || css.length || js.length) {
      righe.push('classe "' + nome + '": ' + [
        html.length ? 'nell\'HTML ' + trova(html).slice(0, 8).join(', ') : '',
        css.length ? 'stile in ' + trova(css).slice(0, 6).join(', ') : 'nessuno stile CSS',
        js.length ? 'usata dal codice in ' + trova(js).slice(0, 8).join(', ') : ''
      ].filter(Boolean).join('; '));
    }
  }
  return righe;
}

function nomiDelProgetto(progetto) {
  const nomi = tutteLeDichiarazioni(progetto).map(function (d) { return d.nome; });
  progetto.html.forEach(function (h) {
    h.id.forEach(function (i) { nomi.push(i.nome); });
    h.classi.forEach(function (k) { nomi.push(k.nome); });
  });
  fogliDiStile(progetto).forEach(function (c) { c.classi.forEach(function (k) { nomi.push(k.nome); }); });
  return nomi;
}

function nonTrovato(progetto, nome, righe) {
  righe.push('Nel progetto non esiste nessun nome "' + nome + '".');
  const simili = cervello.nomiSimili(nome, nomiDelProgetto(progetto), 5);
  if (simili.length) righe.push('Nomi simili che esistono: ' + simili.join(', ') + ' (cercali con --cerca).');
  else if (cervello.GLOBALI_BROWSER.has(nome)) righe.push('"' + nome + '" e\' fornito dal browser: esiste gia\', non va dichiarato.');
  else if (cervello.GLOBALI_NODE.has(nome)) righe.push('"' + nome + '" e\' fornito da Node: esiste gia\', non va dichiarato.');
  return righe.join('\n');
}

function cercaNome(progetto, nome) {
  const righe = [];
  const dich = tutteLeDichiarazioni(progetto).filter(function (d) { return d.nome === nome; });
  if (dich.length) {
    righe.push('"' + nome + '" e\' dichiarato in ' + plurale(dich.length, 'punto', 'punti') + ':');
    dich.slice(0, 15).forEach(function (d) {
      righe.push('  ' + d.file + ':' + d.riga + '  ' + firma(d) + '  [' + descriviScope(d) + ']');
    });
    if (dich.length > 15) righe.push('  ... altri ' + (dich.length - 15));
    const usi = usiDi(progetto, dich);
    if (usi.length) {
      righe.push('Usato ' + plurale(usi.length, 'volta', 'volte') + ':');
      usi.slice(0, 25).forEach(function (r) { righe.push('  ' + r.file + ':' + r.riga + '  ' + r.testo); });
      if (usi.length > 25) righe.push('  ... altri ' + (usi.length - 25) + ' usi');
    } else {
      righe.push('Non e\' usato da nessuna parte.');
    }
  }
  const senza = [];
  progetto.js.forEach(function (a) {
    a.riferimenti.forEach(function (r) { if (r.nome === nome && r.esito && r.esito.mancante) senza.push(r); });
  });
  if (senza.length) {
    righe.push('Usato SENZA che esista una dichiarazione in:');
    senza.slice(0, 10).forEach(function (r) { righe.push('  ' + r.file + ':' + r.riga + '  ' + r.testo); });
  }
  occorrenzeHtmlCss(progetto, nome).forEach(function (x) { righe.push(x); });
  if (!righe.length) return nonTrovato(progetto, nome, righe);
  return righe.join('\n');
}

function cercaChiave(progetto, nomeOggetto, chiave) {
  const dich = tutteLeDichiarazioni(progetto).filter(function (d) { return d.nome === nomeOggetto; });
  if (!dich.length) return cercaNome(progetto, nomeOggetto);
  const righe = [];
  dich.slice(0, 5).forEach(function (d) { righe.push(d.file + ':' + d.riga + '  ' + firma(d)); });
  const chiaviNote = new Set();
  let letterale = false;
  progetto.js.forEach(function (a) {
    a.oggetti.forEach(function (o) {
      if (dich.indexOf(o.dichiarazione) === -1) return;
      letterale = true;
      o.chiavi.forEach(function (k) { chiaviNote.add(k); });
    });
  });
  const tuttiGliUsi = usiDi(progetto, dich);
  const usi = tuttiGliUsi.filter(function (r) { return r.chiave === chiave; });
  const aggiunte = tuttiGliUsi.filter(function (r) { return r.scritturaChiave && r.chiave; });
  aggiunte.forEach(function (r) { chiaviNote.add(r.chiave); });
  if (letterale) {
    if (chiaviNote.has(chiave)) {
      righe.push(nomeOggetto + '.' + chiave + ' ESISTE.');
    } else {
      const simili = cervello.nomiSimili(chiave, Array.from(chiaviNote), 2);
      righe.push(nomeOggetto + '.' + chiave + ' NON ESISTE. Chiavi di ' + nomeOggetto + ': ' + (Array.from(chiaviNote).join(', ') || 'nessuna') +
        (simili.length ? '. Forse volevi ' + nomeOggetto + '.' + simili[0] : '') + '.');
    }
  }
  if (usi.length) {
    righe.push(nomeOggetto + '.' + chiave + ' e\' usato ' + plurale(usi.length, 'volta', 'volte') + ':');
    usi.slice(0, 20).forEach(function (r) { righe.push('  ' + r.file + ':' + r.riga + '  ' + r.testo); });
  } else {
    righe.push('Nessun uso di ' + nomeOggetto + '.' + chiave + ' nel progetto.');
  }
  return righe.join('\n');
}

function cercaIdOClasse(progetto, nome, cosa) {
  const righe = occorrenzeHtmlCss(progetto, nome, cosa);
  if (righe.length) return righe.join('\n');
  const candidati = [];
  progetto.html.forEach(function (h) { (cosa === 'id' ? h.id : h.classi).forEach(function (x) { candidati.push(x.nome); }); });
  fogliDiStile(progetto).forEach(function (c) { (cosa === 'id' ? c.id : c.classi).forEach(function (x) { candidati.push(x.nome); }); });
  const simili = cervello.nomiSimili(nome, candidati, 5);
  return 'Nessun' + (cosa === 'id' ? ' id "' : 'a classe "') + nome + '" nel progetto.' +
    (simili.length ? ' Simili: ' + simili.join(', ') + '.' : '');
}

// --cerca nome | oggetto.chiave | #id | .classe
function cerca(progetto, domanda) {
  const q = String(domanda || '').trim();
  if (!q) return 'Scrivi cosa cercare: --cerca nomeFunzione, --cerca oggetto.chiave, --cerca #id, --cerca .classe';
  if (q[0] === '#') return cercaIdOClasse(progetto, q.slice(1), 'id');
  if (q[0] === '.' && q.length > 1) return cercaIdOClasse(progetto, q.slice(1), 'classe');
  const punto = q.indexOf('.');
  if (punto > 0) return cercaChiave(progetto, q.slice(0, punto), q.slice(punto + 1).split('.')[0]);
  return cercaNome(progetto, q);
}

function trovaFile(progetto, richiesta) {
  const cercato = slash(richiesta).replace(/^\.\//, '').toLowerCase();
  const assoluto = slash(path.resolve(progetto.radice, String(richiesta))).toLowerCase();
  const tutti = progetto.js.filter(function (a) { return !a.inline; }).map(function (a) { return { tipo: 'js', file: a.file, a: a }; })
    .concat(progetto.html.map(function (h) { return { tipo: 'html', file: h.file, h: h }; }))
    .concat(progetto.css.map(function (c) { return { tipo: 'css', file: c.file, c: c }; }));
  let trovati = tutti.filter(function (x) {
    return x.file.toLowerCase() === cercato || slash(path.resolve(progetto.radice, x.file)).toLowerCase() === assoluto;
  });
  if (!trovati.length) {
    trovati = tutti.filter(function (x) { return path.posix.basename(x.file).toLowerCase() === path.posix.basename(cercato); });
  }
  return trovati;
}

// Un elenco lungo diventa una riga compatta: server.js ha 182 funzioni, non possono
// diventare 182 righe nella memoria di lavoro di Adam.
function sezione(righe, titolo, voci, compatta) {
  if (!voci.length) return;
  if (!compatta) {
    righe.push(titolo + ' (' + voci.length + '):');
    voci.forEach(function (v) { righe.push('  ' + v.riga + '  ' + v.testo); });
    return;
  }
  let testo = titolo + ' (' + voci.length + '): ';
  let messi = 0;
  for (let i = 0; i < voci.length; i++) {
    const pezzo = (messi ? ', ' : '') + voci[i].breve + ' r.' + voci[i].riga;
    if (testo.length + pezzo.length > 900) break;
    testo += pezzo;
    messi++;
  }
  if (messi < voci.length) testo += ' ... altri ' + (voci.length - messi) + ' (usa --cerca nome)';
  righe.push(testo);
}

function problemiDelFile(progetto, file, righe) {
  const lista = progetto.problemi.filter(function (p) { return p.file === file; });
  if (!lista.length) return;
  righe.push('Problemi (' + lista.length + '):');
  lista.slice(0, 20).forEach(function (p) {
    righe.push('  ' + (p.grave ? 'GRAVE' : 'da controllare') + ' r.' + p.riga + ': ' + p.messaggio);
  });
}

function schedaJs(progetto, a) {
  const righe = [];
  const dove = a.ambiente === 'browser'
    ? 'browser, caricato da ' + unici(a.pagine.map(function (p) { return p.html.file; })).join(', ')
    : (a.ambiente === 'node' ? 'programma Node' : 'non caricato da nessuna pagina');
  righe.push(a.file + ' (' + (a.righeTotali || '?') + ' righe, ' + dove + (a.modulo ? ', modulo' : '') + ')');
  if (a.errore) righe.push('ERRORE DI SINTASSI alla riga ' + a.errore.riga + ': ' + a.errore.messaggio + ' (finche\' non lo correggi il resto non si legge)');
  if (a.libreria) { righe.push('E\' una libreria: non la analizzo nel dettaglio.'); return righe; }

  const inCima = a.dichiarazioni.filter(function (d) { return d.scope === a.scope; });
  const voce = function (d) { return { riga: d.riga, testo: firma(d), breve: d.nome + (d.tipo === 'function' || d.funzione ? '(' + (d.parametri || '') + ')' : '') }; };
  const importi = inCima.filter(function (d) { return d.tipo === 'import'; }).map(voce);
  const variabili = inCima.filter(function (d) { return ['const', 'let', 'var'].indexOf(d.tipo) !== -1 && !d.funzione && !d.classe; }).map(voce);
  const funzioni = inCima.filter(function (d) { return d.tipo === 'function' || d.funzione; }).map(voce);
  const classi = inCima.filter(function (d) { return d.tipo === 'class' || d.classe; }).map(voce);
  const interne = a.dichiarazioni.filter(function (d) { return d.scope !== a.scope && (d.tipo === 'function' || d.funzione); }).map(voce);
  const compatta = importi.length + variabili.length + funzioni.length + classi.length > 60;
  sezione(righe, 'Import', importi, compatta);
  sezione(righe, a.modulo ? 'Variabili del modulo' : 'Variabili globali', variabili, compatta);
  sezione(righe, 'Funzioni', funzioni, compatta);
  sezione(righe, 'Classi', classi, compatta);
  sezione(righe, 'Funzioni interne (dentro altre funzioni)', interne, true);

  const usaDa = new Map();
  a.riferimenti.forEach(function (r) {
    const d = r.dichiarazioni && r.dichiarazioni[0];
    if (!d || d.file === a.file) return;
    if (!usaDa.has(d.file)) usaDa.set(d.file, new Set());
    usaDa.get(d.file).add(d.nome);
  });
  usaDa.forEach(function (nomi, file) { righe.push('Usa da ' + file + ': ' + Array.from(nomi).slice(0, 25).join(', ')); });
  const mie = new Set(inCima);
  const usatoDa = new Map();
  progetto.js.forEach(function (b) {
    if (b.file === a.file) return;
    b.riferimenti.forEach(function (r) {
      if (!r.dichiarazioni || !r.dichiarazioni.some(function (d) { return mie.has(d); })) return;
      if (!usatoDa.has(b.file)) usatoDa.set(b.file, new Set());
      usatoDa.get(b.file).add(r.nome + (r.chiave ? '.' + r.chiave : ''));
    });
  });
  usatoDa.forEach(function (nomi, file) { righe.push('Usato da ' + file + ': ' + Array.from(nomi).slice(0, 25).join(', ')); });
  progetto.collegamenti.forEach(function (c) {
    if (c.da === a) righe.push('Importa ' + c.a.file + ' (riga ' + c.riga + ')');
    if (c.a === a) righe.push('Importato da ' + c.da.file + ' (riga ' + c.riga + ')');
  });
  if (a.idCercati.length) {
    righe.push('Elementi cercati per id: ' + unici(a.idCercati.map(function (i) { return '#' + i.nome; })).slice(0, 40).join(', '));
  }
  if (a.classiUsate.length) {
    righe.push('Classi usate: ' + unici(a.classiUsate.map(function (k) { return '.' + k.nome; })).slice(0, 40).join(', '));
  }
  problemiDelFile(progetto, a.file, righe);
  return righe;
}

function schedaHtml(progetto, h) {
  const righe = [h.file + ' (pagina HTML)'];
  const script = h.script.filter(function (s) { return !s.ignorato; }).map(function (s) {
    return (s.src || 'script dentro la pagina (r.' + s.riga + ')') + (s.modulo ? ' [modulo]' : '');
  });
  if (script.length) righe.push('Script, in ordine di caricamento: ' + script.join(', '));
  const altre = unici(h.risorse.filter(function (r) { return !/\.m?js$/i.test(r.rif); }).map(function (r) { return r.rif; }));
  if (altre.length) righe.push('Altri file caricati: ' + altre.slice(0, 20).join(', '));
  if (h.id.length) righe.push('Id (' + h.id.length + '): ' + h.id.map(function (i) { return i.nome + ' r.' + i.riga; }).slice(0, 60).join(', '));
  const classi = unici(h.classi.map(function (k) { return k.nome; }));
  if (classi.length) righe.push('Classi (' + classi.length + '): ' + classi.slice(0, 60).join(', '));
  if (h.gestori.length) {
    righe.push('Eventi negli attributi: ' + h.gestori.map(function (g) { return g.evento + '="' + g.codice.slice(0, 40) + '" r.' + g.riga; }).slice(0, 20).join(', '));
  }
  progetto.js.filter(function (a) { return a.inline && a.file === h.file && !a.gestore; }).forEach(function (a) {
    const funzioni = a.dichiarazioni.filter(function (d) { return d.scope === a.scope && (d.tipo === 'function' || d.funzione); });
    if (funzioni.length) righe.push('Funzioni negli script interni: ' + funzioni.map(function (d) { return d.nome + '(' + (d.parametri || '') + ') r.' + d.riga; }).join(', '));
  });
  problemiDelFile(progetto, h.file, righe);
  return righe;
}

function schedaCss(progetto, c) {
  const righe = [c.file + ' (foglio di stile)'];
  const primaRiga = function (lista) {
    const visti = new Map();
    lista.forEach(function (x) { if (!visti.has(x.nome)) visti.set(x.nome, x.riga); });
    return Array.from(visti).map(function (v) { return v[0] + ' r.' + v[1]; });
  };
  const id = primaRiga(c.id);
  const classi = primaRiga(c.classi);
  if (id.length) righe.push('Stili per id (' + id.length + '): ' + id.slice(0, 60).map(function (x) { return '#' + x; }).join(', '));
  if (classi.length) righe.push('Stili per classe (' + classi.length + '): ' + classi.slice(0, 80).map(function (x) { return '.' + x; }).join(', '));
  if (c.variabili.length) righe.push('Variabili CSS: ' + unici(c.variabili.map(function (v) { return v.nome; })).slice(0, 40).join(', '));
  problemiDelFile(progetto, c.file, righe);
  return righe;
}

// --file percorso
function scheda(progetto, richiesta) {
  if (!richiesta) return 'Scrivi quale file: --file js/main.js';
  const trovati = trovaFile(progetto, richiesta);
  if (!trovati.length) {
    const simili = cervello.nomiSimili(path.posix.basename(slash(richiesta)), progetto.elenco.map(function (f) { return path.posix.basename(f); }), 3);
    return 'Non trovo "' + richiesta + '" fra i file di codice del progetto.' + (simili.length ? ' Simili: ' + simili.join(', ') + '.' : '');
  }
  if (trovati.length > 1 && trovati[0].file.toLowerCase() !== slash(richiesta).toLowerCase()) {
    return 'Ci sono piu\' file con quel nome: ' + trovati.map(function (x) { return x.file; }).join(', ') + '. Scrivi il percorso completo.';
  }
  const x = trovati[0];
  const righe = x.tipo === 'js' ? schedaJs(progetto, x.a) : (x.tipo === 'html' ? schedaHtml(progetto, x.h) : schedaCss(progetto, x.c));
  return righe.join('\n');
}

// --controlla [file]
function controlla(progetto, richiesta) {
  let lista = progetto.problemi;
  let dove = 'nel progetto';
  if (richiesta) {
    const trovati = trovaFile(progetto, richiesta);
    if (!trovati.length) return 'Non trovo "' + richiesta + '" fra i file di codice del progetto.';
    const nomi = trovati.map(function (x) { return x.file; });
    lista = lista.filter(function (p) { return nomi.indexOf(p.file) !== -1; });
    dove = 'in ' + nomi.join(', ');
  }
  const controllati = progetto.js.filter(function (a) { return !a.inline; }).length + ' script, ' +
    plurale(progetto.html.length, 'pagina', 'pagine') + ', ' + progetto.css.length + ' fogli di stile';
  if (!lista.length) return 'Nessun problema ' + dove + ' (' + controllati + ' controllati in ' + progetto.durataMs + ' ms).';
  const gravi = lista.filter(function (p) { return p.grave; }).length;
  const righe = [plurale(lista.length, 'problema', 'problemi') + ' ' + dove + ': ' + gravi +
    ' GRAVI (bloccano il programma: vanno corretti), ' + (lista.length - gravi) + ' da controllare.'];
  lista.slice(0, 40).forEach(function (p) {
    righe.push((p.grave ? 'GRAVE  ' : 'DA CONTROLLARE  ') + p.file + ':' + p.riga + '  ' + p.messaggio);
  });
  if (lista.length > 40) righe.push('... altri ' + (lista.length - 40));
  return righe.join('\n');
}

// --mappa: il progetto in poche righe, entro un budget di caratteri.
function panoramica(progetto, budget) {
  budget = budget || 1800;
  const righe = [];
  progetto.pagine.forEach(function (p) {
    const carica = p.html.script.filter(function (s) { return !s.ignorato; }).map(function (s) { return s.src || '(script interno)'; })
      .concat(p.html.risorse.filter(function (r) { return /\.css$/i.test(r.rif); }).map(function (r) { return r.rif; }));
    righe.push('- ' + p.html.file + ' carica: ' + (unici(carica).join(', ') || 'niente'));
  });
  const js = progetto.js.filter(function (a) { return !a.inline && !a.libreria && !a.test; });
  const spazio = Math.max(90, Math.floor((budget - 250) / Math.max(1, js.length)));
  js.forEach(function (a) {
    const inCima = a.dichiarazioni.filter(function (d) { return d.scope === a.scope; });
    // Un nome dichiarato due volte si vede subito: initGame (x2!)
    const conConteggio = function (nomi) {
      const conta = new Map();
      nomi.forEach(function (n) { conta.set(n, (conta.get(n) || 0) + 1); });
      return Array.from(conta).map(function (c) { return c[1] > 1 ? c[0] + ' (x' + c[1] + '!)' : c[0]; });
    };
    const nomiF = conConteggio(inCima.filter(function (d) { return d.tipo === 'function' || d.funzione; }).map(function (d) { return d.nome; }));
    const nomiV = conConteggio(inCima.filter(function (d) { return ['const', 'let', 'var'].indexOf(d.tipo) !== -1 && !d.funzione; }).map(function (d) { return d.nome; }));
    let riga = '- ' + a.file + ' (' + a.righeTotali + ' righe' + (a.ambiente === 'node' ? ', Node' : '') + (a.errore ? ', ERRORE DI SINTASSI' : '') + ')';
    [['funzioni', nomiF], ['variabili', nomiV]].forEach(function (coppia) {
      if (!coppia[1].length) return;
      let pezzo = ' ' + coppia[0] + ': ';
      let messi = 0;
      for (let i = 0; i < coppia[1].length; i++) {
        const nome = (messi ? ', ' : '') + coppia[1][i];
        if ((riga + pezzo + nome).length > spazio) break;
        pezzo += nome;
        messi++;
      }
      if (messi < coppia[1].length) pezzo += (messi ? ' ' : '') + '+' + (coppia[1].length - messi);
      riga += pezzo + ';';
    });
    righe.push(riga);
  });
  const librerie = progetto.js.filter(function (a) { return a.libreria; }).map(function (a) { return a.file; });
  if (librerie.length) righe.push('- librerie: ' + librerie.join(', '));
  const altriCss = progetto.css.map(function (c) { return c.file; });
  if (altriCss.length) righe.push('- stili: ' + altriCss.slice(0, 10).join(', '));
  let testo = righe.join('\n');
  if (testo.length > budget) testo = testo.slice(0, budget) + '\n... (panoramica tagliata: per i dettagli usa --file o --cerca)';
  return testo;
}

// ------------------------------------------------- La memoria degli errori
//
// Per ogni progetto (dati/cervello/<impronta della cartella>/stato.json) il cervello ricorda
// i problemi aperti e la storia: quando un errore e' comparso e quando e' stato corretto.
// Serve a dire ad Adam solo le NOVITA' dopo una modifica, e a ricordargli nelle sessioni
// successive gli errori che ha gia' fatto.

const COMANDO = 'node "' + slash(path.join(__dirname, 'cervello.js')) + '"';
const MAX_STORIA = 200;

function cartellaProgetto(dir, base) {
  const chiave = crypto.createHash('sha1').update(path.resolve(dir).toLowerCase()).digest('hex').slice(0, 16);
  return path.join(base || CARTELLA_DATI, chiave);
}

function caricaStato(dir, base) {
  try {
    const stato = JSON.parse(fs.readFileSync(path.join(cartellaProgetto(dir, base), 'stato.json'), 'utf8'));
    stato.aperti = stato.aperti || {};
    stato.storia = stato.storia || [];
    return stato;
  } catch (e) {
    return { progetto: path.resolve(dir), aperti: {}, storia: [] };
  }
}

function salvaStato(dir, stato, base) {
  const cartella = cartellaProgetto(dir, base);
  fs.mkdirSync(cartella, { recursive: true });
  const file = path.join(cartella, 'stato.json');
  // scrittura in un file temporaneo e poi rinomina: due controlli insieme non lo corrompono
  const temporaneo = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(temporaneo, JSON.stringify(stato, null, 1));
  fs.renameSync(temporaneo, file);
}

function aggiornaMemoria(dir, progetto, fileToccato, base) {
  const stato = caricaStato(dir, base);
  const adesso = new Date().toISOString();
  const attuali = new Map(progetto.problemi.map(function (p) { return [p.chiave, p]; }));
  const nuovi = [];
  const risolti = [];
  attuali.forEach(function (p, k) {
    const prima = stato.aperti[k];
    if (!prima) {
      nuovi.push(p);
      stato.storia.push({ chiave: k, file: p.file, messaggio: p.messaggio, grave: p.grave, trovato: adesso, corretto: null });
    }
    stato.aperti[k] = { file: p.file, riga: p.riga, messaggio: p.messaggio, grave: p.grave, primaVolta: prima ? prima.primaVolta : adesso };
  });
  Object.keys(stato.aperti).forEach(function (k) {
    if (attuali.has(k)) return;
    risolti.push(stato.aperti[k]);
    delete stato.aperti[k];
    for (let i = stato.storia.length - 1; i >= 0; i--) {
      if (stato.storia[i].chiave === k && !stato.storia[i].corretto) {
        stato.storia[i].corretto = adesso;
        if (fileToccato) stato.storia[i].conLaModificaDi = fileToccato;
        break;
      }
    }
  });
  if (stato.storia.length > MAX_STORIA) stato.storia = stato.storia.slice(-MAX_STORIA);
  stato.progetto = path.resolve(dir);
  stato.aggiornato = adesso;
  salvaStato(dir, stato, base);
  return { nuovi: nuovi, risolti: risolti, stato: stato };
}

// --errori
function testoErrori(dir, base) {
  const stato = caricaStato(dir, base);
  const aperti = Object.keys(stato.aperti).map(function (k) { return stato.aperti[k]; })
    .sort(function (x, y) { return y.grave - x.grave; });
  const corretti = stato.storia.filter(function (s) { return s.corretto; }).slice(-15).reverse();
  if (!aperti.length && !corretti.length) return 'Nessun errore registrato finora in questo progetto.';
  const righe = [];
  if (aperti.length) {
    righe.push('Ancora aperti (' + aperti.length + '):');
    aperti.slice(0, 15).forEach(function (a) { righe.push('  ' + (a.grave ? 'GRAVE ' : '') + a.file + ':' + a.riga + ' ' + a.messaggio); });
  }
  if (corretti.length) {
    righe.push('Gia\' commessi e corretti (non ripeterli):');
    corretti.forEach(function (c) { righe.push('  ' + c.corretto.slice(0, 10) + ' ' + c.file + ': ' + c.messaggio.slice(0, 160)); });
  }
  return righe.join('\n');
}

// ------------------------------------------------ Dopo ogni modifica (hook)
//
// Claude Code, dopo ogni Edit o Write, passa qui il file toccato. Il cervello rilegge tutto il
// progetto (su un gioco pochi millisecondi, sullo Studio intero meno di mezzo secondo) e dice ad
// Adam i problemi del file appena modificato e quelli NUOVI altrove (una funzione rinominata che
// un altro file chiama ancora col nome vecchio). Gli errori gravi escono con codice 2: Claude Code
// li mostra ad Adam come errore da risolvere. I soli avvisi arrivano come contesto, senza bloccare.

function perHook(input, opzioni) {
  opzioni = opzioni || {};
  const dir = (input && input.cwd) || process.cwd();
  const ti = (input && input.tool_input) || {};
  const file = ti.file_path || ti.notebook_path || '';
  if (!file || !/\.(m?js|cjs|html?|css)$/i.test(file)) return { codice: 0, testo: '' };
  const radice = path.resolve(dir);
  const assoluto = path.resolve(radice, file);
  if (slash(path.relative(radice, assoluto)).startsWith('..')) return { codice: 0, testo: '' };   // fuori dal progetto
  const rel = slash(path.relative(radice, assoluto));

  const progetto = cervello.analizzaProgettoCervello(radice);
  const esito = aggiornaMemoria(radice, progetto, rel, opzioni.base);
  const nuovi = new Set(esito.nuovi.map(function (p) { return p.chiave; }));
  const daDire = progetto.problemi.filter(function (p) { return p.file === rel || nuovi.has(p.chiave); })
    .sort(function (x, y) { return (y.grave - x.grave) || ((y.file === rel) - (x.file === rel)); });
  if (!daDire.length) return { codice: 0, testo: '' };

  const gravi = daDire.filter(function (p) { return p.grave; }).length;
  const righe = ['CERVELLO DEL PROGETTO - dopo la tua modifica a ' + rel + ' ho ricontrollato tutto il progetto. ' +
    (gravi ? plurale(gravi, 'errore GRAVE', 'errori GRAVI') + ' (il programma si blocca): correggi SUBITO, prima di fare altro.'
      : 'Niente di bloccante, ma controlla:')];
  daDire.slice(0, 8).forEach(function (p) {
    righe.push((p.grave ? '- GRAVE ' : '- da controllare ') + p.file + ':' + p.riga + '  ' + p.messaggio);
  });
  if (daDire.length > 8) righe.push('- ... altri ' + (daDire.length - 8) + ': elenco completo con ' + COMANDO + ' --controlla');
  if (esito.risolti.length) {
    righe.push('Risolti con questa modifica: ' + esito.risolti.slice(0, 4).map(function (r) { return r.file + ':' + r.riga; }).join(', '));
  }
  righe.push('Se un nome non ti torna non indovinare, chiedi: ' + COMANDO + ' --cerca nome');
  const testo = righe.join('\n');
  // Lo Studio lo mostra anche nella chat: l'utente deve vedere chi ha segnalato l'errore ad Adam.
  try {
    fs.writeFileSync(path.join(cartellaProgetto(radice, opzioni.base), 'ultimo-avviso.json'),
      JSON.stringify({ quando: new Date().toISOString(), file: rel, gravi: gravi, testo: testo }));
  } catch (e) { /* serve solo alla chat */ }
  return { codice: gravi ? 2 : 0, testo: testo };
}

// Python, Blender e Unity: il cervello di quella lingua, e lo stesso modo di dirlo ad Adam.
async function perHookAltreLingue(dir, rel, assoluto, opzioni) {
  let problemi = [];
  let lingua = '';
  if (/\.py$/i.test(rel)) {
    const r = await require('./cervello-python').analizzaPython(dir, { solo: assoluto, timeout: 60000 });
    problemi = r.problemi.filter(function (p) { return p.file === rel; });
    lingua = 'Python';
  } else {
    const unity = require('./cervello-unity');
    const r = await unity.analizzaUnity(dir, { file: [assoluto], compila: true, console: false, android: false });
    if (!r) return { codice: 0, testo: '' };
    const relUnity = slash(path.relative(r.radice, assoluto));
    // gli errori di compilazione possono stare in altri file dello stesso assembly: si dicono tutti
    problemi = r.problemi.filter(function (p) { return p.grave || p.file === relUnity; });
    lingua = 'Unity';
  }
  if (!problemi.length) return { codice: 0, testo: '' };
  const gravi = problemi.filter(function (p) { return p.grave; }).length;
  const righe = ['CERVELLO DEL PROGETTO (' + lingua + ') - dopo la tua modifica a ' + rel + ': ' +
    (gravi ? plurale(gravi, 'errore GRAVE', 'errori GRAVI') + ' (il programma non parte o si blocca): correggi SUBITO, prima di fare altro.'
      : 'niente di bloccante, ma controlla:')];
  problemi.slice(0, 8).forEach(function (p) {
    righe.push((p.grave ? '- GRAVE ' : '- da controllare ') + p.file + ':' + p.riga + '  ' + p.messaggio);
  });
  if (problemi.length > 8) righe.push('- ... altri ' + (problemi.length - 8) + ': elenco completo con ' + COMANDO + ' --controlla');
  const testo = righe.join('\n');
  try {
    fs.mkdirSync(cartellaProgetto(dir, opzioni.base), { recursive: true });
    fs.writeFileSync(path.join(cartellaProgetto(dir, opzioni.base), 'ultimo-avviso.json'),
      JSON.stringify({ quando: new Date().toISOString(), file: rel, gravi: gravi, testo: testo }));
  } catch (e) { /* serve solo alla chat */ }
  return { codice: gravi ? 2 : 0, testo: testo };
}

// L'hook completo: JavaScript, HTML e CSS con il cervello di sempre; .py e .cs con il loro.
async function perHookCompleto(input, opzioni) {
  opzioni = opzioni || {};
  const dir = (input && input.cwd) || process.cwd();
  const ti = (input && input.tool_input) || {};
  const file = ti.file_path || ti.notebook_path || '';
  if (file && /\.(py|cs)$/i.test(file)) {
    const radice = path.resolve(dir);
    const assoluto = path.resolve(radice, file);
    const rel = slash(path.relative(radice, assoluto));
    if (rel.startsWith('..')) return { codice: 0, testo: '' };
    return perHookAltreLingue(radice, rel, assoluto, opzioni);
  }
  return perHook(input, opzioni);
}

// --controlla per Python/Blender e Unity: sezioni da aggiungere a quella di JavaScript.
async function controllaAltreLingue(dir) {
  const sezioni = [];
  const unity = require('./cervello-unity');
  if (unity.trovaProgettoUnity(dir)) {
    const r = await unity.analizzaUnity(dir, { compila: true, console: true });
    const righe = ['UNITY ' + (r.versione || '') + ': ' + r.fileCs + ' script C#' + (r.compilati.length ? ', compilati con il compilatore di Unity: ' +
      r.compilati.map(function (c) { return c.assembly + ' (' + c.errori + ' errori)'; }).join(', ') : '')];
    r.note.forEach(function (n) { righe.push('nota: ' + n); });
    if (!r.problemi.length) righe.push('nessun problema');
    r.problemi.slice(0, 30).forEach(function (p) { righe.push((p.grave ? 'GRAVE  ' : 'DA CONTROLLARE  ') + p.file + ':' + p.riga + '  ' + p.messaggio); });
    if (r.problemi.length > 30) righe.push('... altri ' + (r.problemi.length - 30));
    sezioni.push(righe.join('\n'));
    return sezioni;
  }
  const py = require('./cervello-python');
  if (py.haFilePython(dir)) {
    const r = await py.analizzaPython(dir);
    if (!r.disponibile) {
      sezioni.push('PYTHON: ' + (r.motivo || 'non disponibile'));
    } else {
      const gravi = r.problemi.filter(function (p) { return p.grave; }).length;
      const righe = ['PYTHON ' + (r.python || '') + ': ' + r.file.length + ' file .py' + (r.file.some(function (f) { return f.blender; }) ? ' (anche script di Blender)' : '') +
        ', ' + plurale(r.problemi.length, 'problema', 'problemi') + ' (' + gravi + ' gravi)'];
      if (r.errore) righe.push('nota: ' + r.errore);
      r.problemi.slice().sort(function (x, y) { return y.grave - x.grave; }).slice(0, 30).forEach(function (p) {
        righe.push((p.grave ? 'GRAVE  ' : 'DA CONTROLLARE  ') + p.file + ':' + p.riga + '  ' + p.messaggio);
      });
      if (r.problemi.length > 30) righe.push('... altri ' + (r.problemi.length - 30));
      sezioni.push(righe.join('\n'));
    }
  }
  return sezioni;
}

// ------------------------------------------------------ Per lo Studio

// Il blocco per il prompt di Adam, all'avvio della sessione.
function testoPerPrompt(dir, opzioni) {
  opzioni = opzioni || {};
  const righe = [
    'CERVELLO DEL PROGETTO: lo Studio tiene a mente per te ogni variabile, funzione, parametro, id e classe di tutti i file, sempre aggiornato. Non devi ricordarli e non devi indovinarli:',
    '- prima di usare un nome che non hai appena letto (funzione, variabile, chiave di un oggetto, id): ' + COMANDO + ' --cerca nome   (anche --cerca oggetto.chiave e --cerca #id)',
    '- per sapere cosa contiene un file senza rileggerlo tutto: ' + COMANDO + ' --file percorso',
    opzioni.dopoOgniModifica === false
      ? '- dopo le tue modifiche controlla tu il progetto con ' + COMANDO + ' --controlla: i problemi GRAVI bloccano il programma, correggili subito.'
      : '- dopo OGNI tua modifica il cervello ricontrolla da solo tutto il progetto e ti scrive i problemi: quelli GRAVI bloccano il programma, correggili subito prima di andare avanti.',
    '- controllo completo quando vuoi: ' + COMANDO + ' --controlla'
  ];
  let progetto = null;
  try { progetto = cervello.analizzaProgettoCervello(dir); } catch (e) { progetto = null; }
  if (progetto && (progetto.js.length || progetto.html.length)) {
    righe.push('Com\'e\' fatto il progetto all\'avvio della sessione (per lo stato aggiornato usa i comandi):');
    righe.push(panoramica(progetto, opzioni.budget || 1200));
    const gravi = progetto.problemi.filter(function (p) { return p.grave; });
    if (gravi.length) {
      righe.push('Errori GRAVI gia\' presenti adesso:');
      gravi.slice(0, 5).forEach(function (p) { righe.push('- ' + p.file + ':' + p.riga + ' ' + p.messaggio.slice(0, 220)); });
      if (gravi.length > 5) righe.push('- ... altri ' + (gravi.length - 5) + ' (' + COMANDO + ' --controlla)');
    }
    try { aggiornaMemoria(dir, progetto, null, opzioni.base); } catch (e) { /* la memoria non e' indispensabile per il prompt */ }
  }
  const corretti = caricaStato(dir, opzioni.base).storia.filter(function (s) { return s.corretto; }).slice(-5);
  if (corretti.length) {
    righe.push('Errori gia\' fatti e corretti in questo progetto (non ripeterli):');
    corretti.forEach(function (c) { righe.push('- ' + c.file + ': ' + c.messaggio.slice(0, 140)); });
  }
  return righe.join('\n');
}

// Per la verifica di fine turno: solo gli errori GRAVI dei file toccati e dei file legati a loro
// (script della stessa pagina, import). Sono quelli che lo Studio rimanda ad Adam da correggere:
// niente avvisi incerti, che lo spingerebbero a toccare codice giusto.
function erroriGraviPerVerifica(dir, fileToccati) {
  const radice = path.resolve(dir);
  const progetto = cervello.analizzaProgettoCervello(radice);
  const toccati = new Set((fileToccati || []).map(function (f) {
    return slash(path.relative(radice, path.resolve(radice, f))).toLowerCase();
  }));
  const vicini = new Set(toccati);
  progetto.pagine.forEach(function (p) {
    const nomi = [p.html.file].concat(p.script.map(function (a) { return a.file; })).map(function (f) { return f.toLowerCase(); });
    if (nomi.some(function (n) { return toccati.has(n); })) nomi.forEach(function (n) { vicini.add(n); });
  });
  progetto.collegamenti.forEach(function (c) {
    if (toccati.has(c.a.file.toLowerCase()) || toccati.has(c.da.file.toLowerCase())) {
      vicini.add(c.a.file.toLowerCase());
      vicini.add(c.da.file.toLowerCase());
    }
  });
  return progetto.problemi.filter(function (p) { return p.grave && vicini.has(p.file.toLowerCase()); })
    .map(function (p) { return Object.assign({ percorso: path.join(radice, p.file) }, p); });
}

// --------------------------------------------------------- Riga di comando

const USO = [
  'Cervello del progetto. Uso: ' + COMANDO + ' <comando>',
  '  --cerca nome            dove e\' dichiarato, cosa riceve, dove e\' usato (anche oggetto.chiave, #id, .classe)',
  '  --file percorso         cosa contiene un file: funzioni, variabili, id, collegamenti con gli altri file',
  '  --controlla [percorso]  i problemi di tutto il progetto o di un file',
  '  --mappa                 il progetto in poche righe',
  '  --errori                errori ancora aperti e errori gia\' corretti in questo progetto',
  '  --dir cartella          il progetto da esaminare (predefinita: la cartella corrente)'
].join('\n');

function leggiArgomenti(argv) {
  const o = { azione: null, valore: '', dir: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') {
      o.dir = argv[++i] || o.dir;
    } else if (['--cerca', '--file', '--controlla', '--mappa', '--errori', '--hook', '--aiuto'].indexOf(a) !== -1) {
      o.azione = a.slice(2);
      if (['cerca', 'file', 'controlla'].indexOf(o.azione) !== -1 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) {
        o.valore = argv[++i];
      }
    } else if (!o.azione && !a.startsWith('--')) {
      o.azione = 'cerca';
      o.valore = a;
    }
  }
  return o;
}

function leggiStdin() {
  return new Promise(function (resolve) {
    let dati = '';
    const timer = setTimeout(function () { resolve(dati); }, 5000);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', function (c) { dati += c; });
    process.stdin.on('end', function () { clearTimeout(timer); resolve(dati); });
    process.stdin.on('error', function () { clearTimeout(timer); resolve(dati); });
  });
}

function registraErroreInterno(e) {
  try {
    fs.mkdirSync(CARTELLA_DATI, { recursive: true });
    const file = path.join(CARTELLA_DATI, 'errori-interni.log');
    try { if (fs.statSync(file).size > 200000) fs.unlinkSync(file); } catch (x) {}
    fs.appendFileSync(file, new Date().toISOString() + ' ' + (e && e.stack || e) + '\n');
  } catch (x) { /* niente da fare */ }
}

async function principale(argv) {
  const o = leggiArgomenti(argv);
  if (o.azione === 'hook') {
    let input = {};
    try { input = JSON.parse(await leggiStdin() || '{}'); } catch (e) { input = {}; }
    try {
      const r = await perHookCompleto(input);
      if (r.codice === 2) { process.stderr.write(r.testo + '\n'); return 2; }
      if (r.testo) {
        process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: r.testo } }));
      }
      return 0;
    } catch (e) {
      registraErroreInterno(e);
      return 0;   // un guasto del cervello non deve mai fermare il lavoro di Adam
    }
  }
  if (!o.azione || o.azione === 'aiuto') { process.stdout.write(USO + '\n'); return 0; }
  if (o.azione === 'errori') { process.stdout.write(testoErrori(o.dir) + '\n'); return 0; }
  if (!fs.existsSync(o.dir)) { process.stdout.write('La cartella "' + o.dir + '" non esiste.\n'); return 1; }
  const progetto = cervello.analizzaProgettoCervello(o.dir);
  let testo;
  if (o.azione === 'cerca') testo = cerca(progetto, o.valore);
  else if (o.azione === 'file') testo = scheda(progetto, o.valore);
  else if (o.azione === 'mappa') testo = panoramica(progetto, 4000);
  else {
    const soloAltreLingue = !progetto.js.length && !progetto.html.length && !progetto.css.length;
    testo = soloAltreLingue ? '' : controlla(progetto, o.valore);
    try { aggiornaMemoria(o.dir, progetto, null); } catch (e) { registraErroreInterno(e); }
    if (!o.valore) {
      try {
        const altre = await controllaAltreLingue(o.dir);
        testo = [testo].concat(altre).filter(Boolean).join('\n\n');
      } catch (e) {
        registraErroreInterno(e);
      }
      if (!testo) testo = 'Nessun file di codice riconosciuto in questa cartella.';
    }
  }
  process.stdout.write(testo + '\n');
  return 0;
}

module.exports = {
  CARTELLA_DATI: CARTELLA_DATI,
  COMANDO: COMANDO,
  cerca: cerca,
  scheda: scheda,
  controlla: controlla,
  panoramica: panoramica,
  trovaFile: trovaFile,
  firma: firma,
  cartellaProgetto: cartellaProgetto,
  caricaStato: caricaStato,
  aggiornaMemoria: aggiornaMemoria,
  testoErrori: testoErrori,
  perHook: perHook,
  perHookCompleto: perHookCompleto,
  controllaAltreLingue: controllaAltreLingue,
  testoPerPrompt: testoPerPrompt,
  erroriGraviPerVerifica: erroriGraviPerVerifica,
  leggiArgomenti: leggiArgomenti,
  principale: principale
};
