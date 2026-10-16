// NotExist Intelligience Studio - Il pannello "File dal vivo".
//
// Richiesta dell'utente (17/9/2026): "devo vedere il live del file mentre lo sta lavorando, se no
// non so come viene scritto o come viene modificato".
//
// Qui arrivano due cose diverse:
//  - 'file-live': il testo che Adam sta generando, pezzo per pezzo, PRIMA che il file esista su
//    disco (lo Studio lo ricompone dallo streaming, strumenti/scrittura-live.js);
//  - 'file-salvato': lo strumento ha finito, il file e' su disco davvero. Allora si rilegge dal
//    disco e si mostra cosa e' cambiato rispetto a com'era un attimo prima.
//
// Niente librerie: numeri di riga, evidenziazione delle righe nuove e basta. Deve restare leggero,
// perche' gira mentre il modello lavora.

const FileLive = (function () {
  const MAX_RIGHE_MOSTRATE = 4000;      // oltre, si mostra la coda: e' li' che si scrive
  const MAX_RIGHE_CONFRONTO = 6000;

  let elStato = null;
  let elNome = null;
  let elMisure = null;
  let elCodice = null;
  let elSegui = null;
  let elPallino = null;
  let elTab = null;

  let fileCorrente = '';
  let contenutoPrima = null;      // com'era il file prima di questa scrittura
  let righeAttese = null;         // righe che Adam sta scrivendo, per evidenziarle dopo il salvataggio
  let mostraQuesto = null;        // callback per portare l'utente sulla vista

  function iniziali(opzioni) {
    opzioni = opzioni || {};
    elStato = document.getElementById('file-live-stato');
    elNome = document.getElementById('file-live-nome');
    elMisure = document.getElementById('file-live-misure');
    elCodice = document.getElementById('file-live-codice');
    elSegui = document.getElementById('file-live-segui');
    elPallino = document.getElementById('file-live-pallino');
    elTab = document.getElementById('btn-view-file');
    mostraQuesto = opzioni.mostra || null;
    return !!elCodice;
  }

  function nomeCorto(percorso) {
    const p = String(percorso || '').split('\\').join('/');
    const pezzi = p.split('/').filter(Boolean);
    return pezzi.length <= 2 ? p : pezzi.slice(-2).join('/');
  }

  function segnalaAttivita(attiva) {
    if (elPallino) elPallino.classList.toggle('acceso', !!attiva);
    if (elTab) elTab.classList.toggle('lavora', !!attiva);
  }

  // Le righe che prima non c'erano: e' quello che l'utente vuole vedere colorato.
  function righeNuove(prima, dopo) {
    if (prima === null || prima === undefined) return null;
    const vecchie = new Map();
    const righePrima = String(prima).split('\n');
    if (righePrima.length > MAX_RIGHE_CONFRONTO) return null;
    righePrima.forEach(function (r) {
      const k = r.trim();
      vecchie.set(k, (vecchie.get(k) || 0) + 1);
    });
    return String(dopo).split('\n').map(function (r) {
      const k = r.trim();
      const quante = vecchie.get(k) || 0;
      if (k === '') return false;
      if (quante > 0) { vecchie.set(k, quante - 1); return false; }
      return true;
    });
  }

  function disegna(testo, opzioni) {
    opzioni = opzioni || {};
    if (!elCodice) return;
    const tutte = String(testo === null || testo === undefined ? '' : testo).split('\n');
    const tagliate = tutte.length > MAX_RIGHE_MOSTRATE;
    const righe = tagliate ? tutte.slice(tutte.length - MAX_RIGHE_MOSTRATE) : tutte;
    const primoNumero = tagliate ? tutte.length - MAX_RIGHE_MOSTRATE + 1 : 1;
    const nuove = opzioni.nuove || null;
    const scarto = tagliate ? tutte.length - MAX_RIGHE_MOSTRATE : 0;

    const pezzi = [];
    if (tagliate) pezzi.push('<div class="fl-taglio">… le prime ' + scarto + ' righe non sono mostrate …</div>');
    righe.forEach(function (riga, i) {
      const numero = primoNumero + i;
      const nuova = nuove && nuove[scarto + i];
      const ultima = opzioni.inCorso && i === righe.length - 1;
      pezzi.push('<div class="fl-riga' + (nuova ? ' fl-nuova' : '') + (ultima ? ' fl-cursore' : '') + '">' +
        '<span class="fl-num">' + numero + '</span>' +
        '<span class="fl-testo">' + esc(riga) + (ultima ? '<span class="fl-caret"></span>' : '') + '</span></div>');
    });
    elCodice.innerHTML = pezzi.join('');
    if (opzioni.inCorso !== false) elCodice.scrollTop = elCodice.scrollHeight;
  }

  function esc(t) {
    return String(t)
      .split('&').join('&amp;')
      .split('<').join('&lt;')
      .split('>').join('&gt;');
  }

  function misure(dati) {
    const pezzi = [];
    if (dati.righe) pezzi.push(dati.righe + (dati.righe === 1 ? ' riga' : ' righe'));
    if (dati.caratteri) pezzi.push(dati.caratteri.toLocaleString('it-IT') + ' caratteri');
    return pezzi.join(' · ');
  }

  // Adam sta scrivendo: arriva un pezzo alla volta.
  function inCorso(dati) {
    if (!elCodice || !dati) return;
    const file = dati.file || '';
    if (file && file !== fileCorrente) {
      fileCorrente = file;
      contenutoPrima = null;
      chiediContenuto(file, function (testo) { contenutoPrima = testo; });
    }
    righeAttese = dati.testo;
    if (elNome) {
      elNome.textContent = nomeCorto(file) || '(file non ancora indicato)';
      elNome.title = file;
    }
    if (elStato) {
      elStato.textContent = dati.completa
        ? (dati.strumento === 'Edit' ? 'modifica pronta, la sta applicando…' : 'scrittura finita, sta salvando…')
        : (dati.strumento === 'Edit' ? 'Adam sta preparando una modifica…' : 'Adam sta scrivendo questo file…');
      elStato.className = 'file-live-stato ' + (dati.completa ? 'attesa' : 'scrive');
    }
    if (elMisure) elMisure.textContent = misure(dati);
    segnalaAttivita(!dati.completa);
    disegna(dati.testo, { inCorso: !dati.completa });
    if (elSegui && elSegui.checked && mostraQuesto) mostraQuesto();
  }

  // Lo strumento ha finito: adesso il file su disco e' quello vero.
  function salvato(dati) {
    if (!elCodice || !dati || !dati.file) return;
    fileCorrente = dati.file;
    if (elNome) {
      elNome.textContent = nomeCorto(dati.file);
      elNome.title = dati.file;
    }
    segnalaAttivita(false);
    chiediContenuto(dati.file, function (testo) {
      if (testo === null) {
        if (elStato) elStato.textContent = 'salvato (non riesco a rileggerlo)';
        return;
      }
      const nuove = righeNuove(contenutoPrima, testo);
      const quante = nuove ? nuove.filter(Boolean).length : 0;
      if (elStato) {
        elStato.textContent = quante
          ? 'salvato: ' + quante + (quante === 1 ? ' riga nuova' : ' righe nuove')
          : 'salvato';
        elStato.className = 'file-live-stato salvato';
      }
      if (elMisure) {
        const righe = testo.split('\n').length;
        elMisure.textContent = righe + ' righe · ' + testo.length.toLocaleString('it-IT') + ' caratteri';
      }
      disegna(testo, { nuove: nuove, inCorso: false });
      // Da adesso il "prima" e' questo: la prossima modifica si confronta con quello che c'e' ora.
      contenutoPrima = testo;
      righeAttese = null;
      // Ci si ferma sulla prima riga nuova, cosi' si vede subito cosa e' cambiato.
      const prima = elCodice.querySelector('.fl-nuova');
      if (prima && prima.scrollIntoView) prima.scrollIntoView({ block: 'center' });
    });
  }

  function chiediContenuto(percorso, quando) {
    fetch('/api/file-content?path=' + encodeURIComponent(percorso))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { quando(d && typeof d.content === 'string' ? d.content : null); })
      .catch(function () { quando(null); });
  }

  // Un file scelto a mano dall'esploratore.
  function apri(percorso) {
    if (!elCodice || !percorso) return;
    fileCorrente = percorso;
    if (elNome) {
      elNome.textContent = nomeCorto(percorso);
      elNome.title = percorso;
    }
    chiediContenuto(percorso, function (testo) {
      contenutoPrima = testo;
      if (elStato) {
        elStato.textContent = testo === null ? 'non riesco ad aprirlo' : 'aperto da te';
        elStato.className = 'file-live-stato';
      }
      disegna(testo || '', { inCorso: false });
    });
  }

  return {
    iniziali: iniziali,
    inCorso: inCorso,
    salvato: salvato,
    apri: apri,
    righeNuove: righeNuove,
    nomeCorto: nomeCorto
  };
})();

if (typeof window !== 'undefined') window.FileLive = FileLive;
if (typeof module !== 'undefined' && module.exports) module.exports = FileLive;
