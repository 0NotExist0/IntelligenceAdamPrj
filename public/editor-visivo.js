// NotExist Intelligience Studio - Editor visivo dell'Anteprima.
//
// Si sceglie un elemento della pagina con un clic e se ne cambiano colori, sfondo,
// dimensioni e posizione a vista (trascinandolo o con le frecce). "Applica al codice" porta
// le modifiche in studio-modifiche.css passando per i controlli dello Studio: se rompono
// la pagina vengono annullate da sole. Il resto del codice del progetto non si tocca.

const EditorVisivo = (() => {
  let attivo = false;
  let frame = null;
  let doc = null;
  let finestra = null;
  let selezionato = null;
  let trascina = null;
  let pannello = null;
  let occupato = false;
  const modifiche = new Map();   // elemento -> { selettore, proprieta }
  const ASCOLTATORI = ['mouseover', 'mouseout', 'mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'contextmenu', 'keydown', 'keyup'];

  const STILE_EDITOR =
    '[data-studio-sopra]{outline:2px dashed rgba(224,122,95,.9)!important;outline-offset:2px!important}' +
    '[data-studio-scelto]{outline:2px solid #e07a5f!important;outline-offset:2px!important;cursor:move!important}';

  function paginaCorrente() {
    const s = document.getElementById('preview-page');
    return s ? s.value : '';
  }

  // ------------------------------------------------------------- selettori

  const NOME_SICURO = /^[A-Za-z][\w-]*$/;

  // Un selettore stabile per l'elemento: l'id se c'e' ed e' unico, altrimenti il percorso
  // dal genitore con un id (o dal body), con classi e posizione fra fratelli dello stesso tipo.
  function selettoreDi(el) {
    if (el === doc.body) return 'body';
    if (el.id && NOME_SICURO.test(el.id) && doc.querySelectorAll('#' + el.id).length === 1) return '#' + el.id;
    const parti = [];
    let cur = el;
    while (cur && cur !== doc.body && cur.nodeType === 1 && parti.length < 6) {
      if (cur !== el && cur.id && NOME_SICURO.test(cur.id)) {
        parti.unshift('#' + cur.id);
        break;
      }
      let p = cur.tagName.toLowerCase();
      const classi = Array.from(cur.classList).filter(function (c) { return NOME_SICURO.test(c); }).slice(0, 2);
      if (classi.length) p += '.' + classi.join('.');
      const fratelli = cur.parentElement
        ? Array.from(cur.parentElement.children).filter(function (x) { return x.tagName === cur.tagName; })
        : [];
      if (fratelli.length > 1) p += ':nth-of-type(' + (fratelli.indexOf(cur) + 1) + ')';
      parti.unshift(p);
      cur = cur.parentElement;
    }
    return parti.join(' > ');
  }

  function descrivi(el) {
    if (!el) return '';
    if (el === doc.body) return 'la pagina (body)';
    const testo = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30);
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
      (el.classList.length ? '.' + Array.from(el.classList).slice(0, 2).join('.') : '') + (testo ? ' "' + testo + '"' : '');
  }

  function inEsadecimale(colore) {
    const m = String(colore).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
    if (!m || (m[4] !== undefined && Number(m[4]) === 0)) return null;
    return '#' + [m[1], m[2], m[3]].map(function (x) { return Number(x).toString(16).padStart(2, '0'); }).join('');
  }

  // ------------------------------------------------------------- modifiche

  // In anteprima la modifica si vede subito (stile in linea); nel codice andra' come regola.
  function registra(el, prop, valore) {
    let voce = modifiche.get(el);
    if (!voce) {
      voce = { selettore: selettoreDi(el), proprieta: {} };
      modifiche.set(el, voce);
    }
    if (valore === null) {
      delete voce.proprieta[prop];
      el.style.removeProperty(prop);
    } else {
      voce.proprieta[prop] = valore;
      el.style.setProperty(prop, valore, 'important');
    }
    if (!Object.keys(voce.proprieta).length) modifiche.delete(el);
    aggiornaPiede();
  }

  // Spostare = la proprieta' translate. Si somma al transform gia' presente (per esempio il
  // translateX(-50%) dei pulsanti centrati), vale per qualunque elemento e non dipende dalla
  // larghezza della finestra. Visto dal vivo: con left/top in pixel un pulsante centrato con
  // "left: 50%" veniva bloccato alla larghezza dell'anteprima, e sulla pagina vera, a
  // finestra larga, finiva a sinistra.
  function traslazione(el) {
    const v = finestra.getComputedStyle(el).translate;
    if (!v || v === 'none') return [0, 0];
    const parti = v.split(/\s+/).map(parseFloat);
    return [parti[0] || 0, parti[1] || 0];
  }

  function sposta(dx, dy) {
    if (!selezionato || selezionato === doc.body) return;
    const t = traslazione(selezionato);
    registra(selezionato, 'translate', Math.round(t[0] + dx) + 'px ' + Math.round(t[1] + dy) + 'px');
  }

  // Uno sfondo a tinta unita toglie gradienti e immagini (background, non background-color).
  function sfondoPieno(colore) {
    if (!selezionato) return;
    const voce = modifiche.get(selezionato);
    ['background-color', 'background-image', 'background-size'].forEach(function (q) {
      if (voce && voce.proprieta[q] !== undefined) registra(selezionato, q, null);
    });
    registra(selezionato, 'background', colore);
  }

  function rimettiAPosto() {
    if (!selezionato) return;
    ['translate', 'left', 'top', 'position'].forEach(function (p) {
      const voce = modifiche.get(selezionato);
      if (voce && voce.proprieta[p] !== undefined) registra(selezionato, p, null);
    });
  }

  // ------------------------------------------------------------- eventi nella pagina

  function bersaglio(t) {
    if (!t || t.nodeType !== 1) return null;
    if (t === doc.documentElement) return doc.body;
    return t;
  }

  function pulisciSopra() {
    doc.querySelectorAll('[data-studio-sopra]').forEach(function (x) { x.removeAttribute('data-studio-sopra'); });
  }

  function seleziona(el) {
    if (selezionato) selezionato.removeAttribute('data-studio-scelto');
    selezionato = el;
    if (el) {
      el.removeAttribute('data-studio-sopra');
      el.setAttribute('data-studio-scelto', '');
    }
    mostraValori();
  }

  // Durante la modifica la pagina non deve reagire: niente clic che avviano il gioco, niente
  // tasti. Gli ascoltatori stanno sulla finestra in fase di cattura, cioe' prima di tutti.
  function suEvento(e) {
    const tipo = e.type;
    if (tipo === 'mouseover') {
      if (trascina) return;
      pulisciSopra();
      const el = bersaglio(e.target);
      if (el && el !== selezionato) el.setAttribute('data-studio-sopra', '');
      return;
    }
    if (tipo === 'mouseout') return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (tipo === 'mousedown' && e.button === 0) {
      const el = bersaglio(e.target);
      if (!el) return;
      if (el !== selezionato) {
        seleziona(el);
        return;
      }
      if (el === doc.body) return;
      trascina = { x: e.clientX, y: e.clientY, t: traslazione(el) };
    } else if (tipo === 'mousemove' && trascina && selezionato) {
      registra(selezionato, 'translate', Math.round(trascina.t[0] + e.clientX - trascina.x) + 'px ' +
        Math.round(trascina.t[1] + e.clientY - trascina.y) + 'px');
    } else if (tipo === 'mouseup') {
      if (trascina) mostraValori();
      trascina = null;
    } else if (tipo === 'keydown') {
      if (e.key === 'Escape') { seleziona(null); return; }
      const passo = e.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-passo, 0], ArrowRight: [passo, 0], ArrowUp: [0, -passo], ArrowDown: [0, passo] }[e.key];
      if (d) {
        sposta(d[0], d[1]);
        mostraValori();
      }
    }
  }

  function aggancia() {
    try {
      doc = frame.contentDocument;
      finestra = frame.contentWindow;
    } catch (e) {
      doc = null;
    }
    modifiche.clear();
    selezionato = null;
    trascina = null;
    if (!doc || !doc.body) {
      stato('La pagina non e\' ancora pronta: riprova tra un istante.', 'err');
      return;
    }
    const s = doc.createElement('style');
    s.id = 'studio-editor-stile';
    s.textContent = STILE_EDITOR;
    doc.head ? doc.head.appendChild(s) : doc.body.appendChild(s);
    ASCOLTATORI.forEach(function (t) { finestra.addEventListener(t, suEvento, true); });
    mostraValori();
    aggiornaPiede();
    aggiornaStatoServer();
  }

  function sgancia() {
    if (finestra && doc) {
      ASCOLTATORI.forEach(function (t) { try { finestra.removeEventListener(t, suEvento, true); } catch (e) {} });
      try {
        const s = doc.getElementById('studio-editor-stile');
        if (s) s.remove();
        doc.querySelectorAll('[data-studio-sopra],[data-studio-scelto]').forEach(function (x) {
          x.removeAttribute('data-studio-sopra');
          x.removeAttribute('data-studio-scelto');
        });
      } catch (e) {}
    }
    selezionato = null;
    trascina = null;
  }

  // ------------------------------------------------------------- pannello

  function creaPannello() {
    pannello = document.createElement('aside');
    pannello.className = 'editor-pannello';
    pannello.setAttribute('aria-label', 'Editor visivo');
    pannello.innerHTML =
      '<div class="ev-testa"><strong>Editor visivo</strong><button type="button" class="ev-chiudi" aria-label="Chiudi l\'editor">×</button></div>' +
      '<p class="ev-aiuto">Clicca un elemento della pagina per sceglierlo, poi trascinalo per spostarlo ' +
        '(frecce: 1 px, Maiusc+frecce: 10 px). Durante la modifica la pagina non reagisce ai clic.</p>' +
      '<div class="ev-scelto">Nessun elemento scelto</div>' +
      '<div class="ev-campi" hidden>' +
        '<label>Colore del testo <input type="color" data-p="color"></label>' +
        '<label>Sfondo <span class="ev-riga"><input type="color" data-p="background-color">' +
          '<button type="button" class="ev-mini" data-azione="trasparente">nessuno</button></span></label>' +
        '<label>Immagine di sfondo <input type="text" data-p="background-image" placeholder="es. img/sfondo.png (file del progetto)"></label>' +
        '<label>Testo <span class="ev-riga"><input type="number" data-p="font-size" min="6" max="200"> px</span></label>' +
        '<label>Angoli <span class="ev-riga"><input type="number" data-p="border-radius" min="0" max="400"> px</span></label>' +
        '<label>Opacità <input type="range" data-p="opacity" min="10" max="100"></label>' +
        '<div class="ev-posizione"><span>Posizione</span>' +
          '<button type="button" class="ev-mini" data-sposta="0,-10" aria-label="Su">↑</button>' +
          '<button type="button" class="ev-mini" data-sposta="0,10" aria-label="Giù">↓</button>' +
          '<button type="button" class="ev-mini" data-sposta="-10,0" aria-label="Sinistra">←</button>' +
          '<button type="button" class="ev-mini" data-sposta="10,0" aria-label="Destra">→</button>' +
          '<button type="button" class="ev-mini" data-azione="riposiziona">rimetti a posto</button></div>' +
      '</div>' +
      '<button type="button" class="ev-mini ev-pagina" data-azione="pagina">Scegli la pagina intera (sfondo)</button>' +
      '<div class="ev-piede"><span class="ev-conteggio">Nessuna modifica</span>' +
        '<div class="ev-bottoni">' +
          '<button type="button" class="btn-term-tool" data-azione="scarta">Scarta</button>' +
          '<button type="button" class="btn-term-tool" data-azione="annulla" disabled>Annulla l\'ultima</button>' +
          '<button type="button" class="btn btn-primary btn-sm" data-azione="applica" disabled>Applica al codice</button>' +
        '</div></div>' +
      '<div class="ev-stato" hidden></div>';
    document.getElementById('preview-stage').appendChild(pannello);

    pannello.querySelector('.ev-chiudi').addEventListener('click', disattiva);
    pannello.querySelectorAll('[data-p]').forEach(function (campo) {
      const evento = campo.type === 'text' ? 'change' : 'input';
      campo.addEventListener(evento, function () {
        if (!selezionato) return;
        let p = campo.dataset.p;
        let v = campo.value;
        if (p === 'background-color') {
          // Il colore di sfondo sostituisce lo sfondo intero. Visto dal vivo: il pulsante del
          // gioco ha un gradiente, che si dipinge SOPRA background-color, e il verde scelto
          // restava invisibile pur risultando "applicato".
          sfondoPieno(v);
          return;
        }
        if (p === 'font-size' || p === 'border-radius') v = v === '' ? null : Math.max(0, Number(v)) + 'px';
        else if (p === 'opacity') v = String(Number(v) / 100);
        else if (p === 'background-image') {
          const pulito = v.trim().replace(/["'()\\]/g, '');
          v = pulito ? 'url("' + pulito + '")' : null;
          registra(selezionato, 'background-size', pulito ? 'cover' : null);
        }
        registra(selezionato, p, v);
      });
    });
    pannello.addEventListener('click', function (e) {
      const b = e.target.closest('button');
      if (!b || !pannello.contains(b)) return;
      if (b.dataset.sposta) {
        const d = b.dataset.sposta.split(',').map(Number);
        sposta(d[0], d[1]);
        mostraValori();
        return;
      }
      const azione = b.dataset.azione;
      if (azione === 'trasparente' && selezionato) sfondoPieno('transparent');
      else if (azione === 'riposiziona') rimettiAPosto();
      else if (azione === 'pagina' && doc) seleziona(doc.body);
      else if (azione === 'scarta') ricarica();
      else if (azione === 'annulla') annullaUltima();
      else if (azione === 'applica') applica(false);
      else if (azione === 'forza') applica(true);
    });
  }

  function mostraValori() {
    if (!pannello) return;
    const scelto = pannello.querySelector('.ev-scelto');
    const campi = pannello.querySelector('.ev-campi');
    if (!selezionato || !doc) {
      scelto.textContent = 'Nessun elemento scelto';
      campi.hidden = true;
      return;
    }
    scelto.textContent = descrivi(selezionato);
    campi.hidden = false;
    const cs = finestra.getComputedStyle(selezionato);
    const imposta = function (p, v) {
      const c = campi.querySelector('[data-p="' + p + '"]');
      if (c && v !== null && v !== undefined) c.value = v;
    };
    imposta('color', inEsadecimale(cs.color) || '#000000');
    imposta('background-color', inEsadecimale(cs.backgroundColor) || '#ffffff');
    imposta('font-size', Math.round(parseFloat(cs.fontSize) || 16));
    imposta('border-radius', Math.round(parseFloat(cs.borderTopLeftRadius) || 0));
    imposta('opacity', Math.round((parseFloat(cs.opacity) || 1) * 100));
    const img = cs.backgroundImage.match(/url\("?(.*?)"?\)/);
    imposta('background-image', img ? img[1].replace(location.origin + '/preview/', '') : '');
  }

  function aggiornaPiede() {
    if (!pannello) return;
    const n = modifiche.size;
    pannello.querySelector('.ev-conteggio').textContent = n
      ? n + (n === 1 ? ' elemento modificato' : ' elementi modificati') + ' (non ancora nel codice)'
      : 'Nessuna modifica';
    pannello.querySelector('[data-azione="applica"]').disabled = !n || occupato;
  }

  function stato(testo, tipo, dettagli) {
    if (!pannello) return;
    const box = pannello.querySelector('.ev-stato');
    box.hidden = !testo;
    box.className = 'ev-stato' + (tipo ? ' ' + tipo : '');
    box.innerHTML = '';
    const p = document.createElement('p');
    p.textContent = testo || '';
    box.appendChild(p);
    if (dettagli && dettagli.length) {
      const ul = document.createElement('ul');
      dettagli.forEach(function (d) {
        const li = document.createElement('li');
        li.textContent = String(d).slice(0, 220);
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }
    return box;
  }

  async function aggiornaStatoServer() {
    try {
      const d = await (await fetch('/api/editor/stato?pagina=' + encodeURIComponent(paginaCorrente()))).json();
      if (pannello) pannello.querySelector('[data-azione="annulla"]').disabled = !d.annullabili || occupato;
    } catch (e) { /* senza stato si puo' comunque lavorare */ }
  }

  function ricarica() {
    if (typeof caricaPaginaAnteprima === 'function') caricaPaginaAnteprima(paginaCorrente(), true);
  }

  function blocca(si) {
    occupato = si;
    if (!pannello) return;
    pannello.classList.toggle('occupato', si);
    aggiornaPiede();
    pannello.querySelector('[data-azione="annulla"]').disabled = si;
  }

  async function applica(forza) {
    const regole = Array.from(modifiche.values()).map(function (v) {
      return { selettore: v.selettore, proprieta: Object.assign({}, v.proprieta) };
    });
    if (!regole.length || occupato) return;
    blocca(true);
    stato('Applico e controllo che non si rompa niente: provo la pagina prima e dopo in un browser e rieseguo i ' +
      'collaudi. Ci vuole circa mezzo minuto; l\'avanzamento e\' anche nella chat.', 'corso');
    try {
      const r = await fetch('/api/editor/applica', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pagina: paginaCorrente(), regole: regole, forza: !!forza })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'errore sconosciuto');
      if (d.annullata) {
        const box = stato('Non applicate: la modifica avrebbe rotto la pagina, quindi il codice e\' rimasto com\'era. Motivi:', 'err', d.motivi);
        const forzaBtn = document.createElement('button');
        forzaBtn.type = 'button';
        forzaBtn.className = 'btn-term-tool';
        forzaBtn.dataset.azione = 'forza';
        forzaBtn.textContent = 'Applica comunque';
        box.appendChild(forzaBtn);
        return;
      }
      const note = [];
      if ((d.senzaEffetto || []).length) note.push('Senza effetto al caricamento (forse l\'elemento compare dopo): ' + d.senzaEffetto.join(', '));
      (d.avvisi || []).forEach(function (a) { note.push('Attenzione: ' + a); });
      stato('Fatto: le modifiche sono in ' + d.file + ' e la pagina e\' stata verificata. Adam lo sa (e\' nella sua memoria).',
        (d.avvisi || []).length ? 'err' : 'ok', note);
      modifiche.clear();
      ricarica();
    } catch (e) {
      stato('Non applicate: ' + e.message, 'err');
    } finally {
      blocca(false);
      aggiornaStatoServer();
    }
  }

  async function annullaUltima() {
    if (occupato) return;
    blocca(true);
    try {
      const r = await fetch('/api/editor/annulla', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pagina: paginaCorrente() })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'errore sconosciuto');
      stato('Ultima modifica annullata: il codice e\' tornato com\'era prima.', 'ok');
      ricarica();
    } catch (e) {
      stato('Non annullata: ' + e.message, 'err');
    } finally {
      blocca(false);
      aggiornaStatoServer();
    }
  }

  // ------------------------------------------------------------- accensione

  function suCaricamento() {
    if (attivo) aggancia();
  }

  function attiva() {
    frame = document.getElementById('preview-frame');
    if (!frame) return;
    if (!pannello) creaPannello();
    attivo = true;
    pannello.hidden = false;
    stato('');
    const bottone = document.getElementById('btn-preview-editor');
    if (bottone) bottone.classList.add('active');
    frame.removeEventListener('load', suCaricamento);
    frame.addEventListener('load', suCaricamento);
    try {
      if (frame.contentDocument && frame.contentDocument.readyState === 'complete' &&
          /\/preview\//.test(frame.contentWindow.location.pathname)) aggancia();
    } catch (e) { /* la pagina si sta caricando: ci pensa suCaricamento */ }
  }

  function disattiva() {
    if (modifiche.size && !confirm('Ci sono modifiche non applicate al codice: le scarto?')) return;
    const aveva = modifiche.size;
    attivo = false;
    sgancia();
    modifiche.clear();
    if (pannello) pannello.hidden = true;
    const bottone = document.getElementById('btn-preview-editor');
    if (bottone) bottone.classList.remove('active');
    if (aveva) ricarica();
  }

  function init() {
    const bottone = document.getElementById('btn-preview-editor');
    if (bottone) bottone.addEventListener('click', function () { attivo ? disattiva() : attiva(); });
    // Dalla chat: apre l'Anteprima e accende l'editor.
    const dallaChat = document.getElementById('btn-chat-editor');
    if (dallaChat) {
      dallaChat.addEventListener('click', function () {
        const vista = document.getElementById('btn-view-preview');
        if (vista) vista.click();
        attiva();
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);

  return { attiva, disattiva, attivo: function () { return attivo; } };
})();
