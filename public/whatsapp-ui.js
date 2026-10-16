// NotExist Intelligience Studio - WhatsApp Protettore Frontend
// Gestione interattiva: connessione WhatsApp Web, visualizzazione chat,
// decifrazione intenzioni, allarmi truffe, radar rabbia e risposte sicure.

const WhatsAppUI = (() => {
  let elBtnConnect = null;
  let elBtnDisconnect = null;
  let elBtnScenari = null;
  let elMenuScenari = null;
  let elBtnClear = null;
  let elContactsList = null;
  let elContactsCount = null;
  let elQrOverlay = null;
  let elQrImg = null;
  let elBtnCloseQr = null;
  let elBtnSync = null;
  let elSearchContacts = null;
  let elMessagesStream = null;
  let elInputSender = null;
  let elInputText = null;
  let elBtnAnalyze = null;
  let elBtnQuickDemo = null;

  let elStatusDot = null;
  let elStatusText = null;
  let elBadgeAlert = null;
  let elCurrentAvatar = null;
  let elCurrentContact = null;
  let elCurrentThreat = null;

  let elDetailRiskBadge = null;
  let elDetailIntenzione = null;
  let elDetailTruffa = null;
  let elDetailEmozione = null;
  let elDetailSchemi = null;
  let elDetailConsiglio = null;
  let elDetailRisposta = null;
  let elBtnCopyReply = null;

  let contatti = [];
  let messaggi = [];
  let contattoSelezionato = null;
  let allarmiNonLetti = 0;
  let filtroRicerca = '';
  let filtroTipo = 'tutti'; // 'tutti' | 'pericolo' | 'non_letti'

  // Riproduce un suono acustico di allarme discreto usando Web Audio API
  function suonaAllarmeSicurezza() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5

      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } catch (e) {}
  }

  function formatTime(isoStr) {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  }

  function escapeHtml(str) {
    return String(str === null || str === undefined ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function aggiornaStatoConnessione(stato, qr) {
    if (!elStatusDot || !elStatusText) return;

    elStatusDot.className = 'status-dot';
    if (stato === 'connesso') {
      elStatusDot.classList.add('wa-dot-connected');
      elStatusText.textContent = 'Connesso';
      if (elBtnConnect) elBtnConnect.style.display = 'none';
      if (elBtnDisconnect) elBtnDisconnect.style.display = 'inline-flex';
      if (elQrOverlay) elQrOverlay.hidden = true;
    } else if (stato === 'qr_pronto') {
      elStatusDot.classList.add('wa-dot-qr');
      elStatusText.textContent = 'Scansiona QR';
      if (elBtnConnect) elBtnConnect.style.display = 'none';
      if (elBtnDisconnect) elBtnDisconnect.style.display = 'inline-flex';
      if (qr && elQrImg && elQrOverlay) {
        elQrImg.src = qr;
        elQrOverlay.hidden = false;
      }
    } else if (stato === 'in_avvio') {
      elStatusDot.classList.add('wa-dot-qr');
      elStatusText.textContent = 'Avvio browser...';
    } else if (stato === 'errore') {
      elStatusDot.classList.add('wa-dot-error');
      elStatusText.textContent = 'Errore connessione';
      if (elBtnConnect) elBtnConnect.style.display = 'inline-flex';
      if (elBtnDisconnect) elBtnDisconnect.style.display = 'none';
    } else {
      elStatusDot.classList.add('wa-dot-disconnected');
      elStatusText.textContent = 'Disconnesso';
      if (elBtnConnect) elBtnConnect.style.display = 'inline-flex';
      if (elBtnDisconnect) elBtnDisconnect.style.display = 'none';
      if (elQrOverlay) elQrOverlay.hidden = true;
    }
  }

  function renderContatti() {
    if (!elContactsList) return;

    let visualizzati = contatti.slice();
    if (filtroRicerca) {
      const q = filtroRicerca.toLowerCase();
      visualizzati = visualizzati.filter(c => 
        (c.nome && c.nome.toLowerCase().includes(q)) || 
        (c.ultimoMessaggio && c.ultimoMessaggio.toLowerCase().includes(q))
      );
    }
    if (filtroTipo === 'pericolo') {
      visualizzati = visualizzati.filter(c => c.livelloRischio === 'critico' || c.livelloRischio === 'alto' || c.livelloRischio === 'medio');
    } else if (filtroTipo === 'non_letti') {
      visualizzati = visualizzati.filter(c => c.nonLetti > 0);
    }

    if (elContactsCount) elContactsCount.textContent = visualizzati.length;

    if (!visualizzati.length) {
      elContactsList.innerHTML = '<div class="wa-empty-contacts">Nessuna chat corrisponde ai filtri impostati.</div>';
      return;
    }

    elContactsList.innerHTML = '';
    visualizzati.forEach(function (c) {
      const item = document.createElement('div');
      item.className = 'wa-contact-item' + (contattoSelezionato === c.nome ? ' active' : '');
      item.onclick = () => selezionaContatto(c.nome);

      const avatarChar = (c.nome || '?').replace(/[^a-zA-Z0-9]/g, '').slice(0, 1).toUpperCase() || '👤';
      const rischio = c.livelloRischio || 'basso';

      item.innerHTML = `
        <div class="wa-contact-avatar">${avatarChar}</div>
        <div class="wa-contact-meta">
          <div class="wa-contact-name-row">
            <span class="wa-contact-name" title="${escapeHtml(c.nome)}">${escapeHtml(c.nome)}</span>
            <span class="wa-risk-badge badge-${rischio}">${rischio}</span>
          </div>
          <div class="wa-contact-preview">${escapeHtml(c.ultimoMessaggio || '')}</div>
        </div>
      `;
      elContactsList.appendChild(item);
    });
  }

  function renderMessaggi() {
    if (!elMessagesStream) return;

    const filtrati = contattoSelezionato
      ? messaggi.filter(m => m.contatto === contattoSelezionato)
      : messaggi;

    if (!filtrati.length) {
      elMessagesStream.innerHTML = `
        <div class="wa-welcome-box">
          <div class="wa-welcome-shield">🛡️</div>
          <h3>Nessun messaggio per questo contatto</h3>
          <p>Usa il campo in basso per esaminare un messaggio o simula uno scenario di prova.</p>
        </div>
      `;
      return;
    }

    elMessagesStream.innerHTML = '';
    filtrati.forEach(function (m) {
      const bubble = document.createElement('div');
      bubble.className = 'wa-msg-bubble wa-msg-in';

      const a = m.analisi || {};
      const rischio = a.livelloRischio || 'basso';

      let pilloleHtml = '';
      if (a.truffa && a.truffa.rilevata) {
        pilloleHtml += `<div class="wa-msg-scam-pill">🚨 TRUFFA RILEVATA: ${escapeHtml(a.truffa.tipo || 'Pericolo')} - ${escapeHtml(a.truffa.motivo || '')}</div>`;
      }
      if (a.emozione && a.emozione.arrabbiata) {
        pilloleHtml += `<div class="wa-msg-anger-pill">💢 RABBIA / AGGRESSIVITÀ: ${escapeHtml(a.emozione.tono || 'Tono duro')} (Intensità: ${escapeHtml(a.emozione.intensita || 'alta')})</div>`;
      }
      if (a.intenzione && rischio !== 'basso') {
        pilloleHtml += `<div class="wa-msg-analysis-pill">🎯 <strong>Intenzione Reale:</strong> ${escapeHtml(a.intenzione)}</div>`;
      }

      bubble.innerHTML = `
        <div class="wa-msg-author">${escapeHtml(m.contatto || 'Mittente')}</div>
        <div class="wa-msg-body">${escapeHtml(m.messaggio || '')}</div>
        <div class="wa-msg-footer">
          <span class="wa-msg-alert-badge badge-${rischio}">${rischio}</span>
          <span class="wa-msg-time">${formatTime(m.dataOra)}</span>
        </div>
        ${pilloleHtml}
      `;

      bubble.onclick = () => mostraDettaglioAnalisi(m);
      elMessagesStream.appendChild(bubble);

      // Se c'è una risposta suggerita per una truffa o emergenza, mostrala come bolla successiva
      if (a.rispostaSuggerita && rischio !== 'basso') {
        const outBubble = document.createElement('div');
        outBubble.className = 'wa-msg-bubble wa-msg-out';
        outBubble.innerHTML = `
          <div class="wa-msg-author" style="color:#a6e3a1">🛡️ Risposta Protetta Suggerita</div>
          <div class="wa-msg-body">${escapeHtml(a.rispostaSuggerita)}</div>
          <div class="wa-msg-footer">
            <span style="color:#8696a0">Consiglio del Protettore (pronta da inviare)</span>
          </div>
        `;
        elMessagesStream.appendChild(outBubble);
      }
    });

    elMessagesStream.scrollTop = elMessagesStream.scrollHeight;
  }

  function mostraDettaglioAnalisi(item) {
    if (!item) return;
    const a = item.analisi || {};
    const rischio = a.livelloRischio || 'basso';

    if (elCurrentContact) elCurrentContact.textContent = item.contatto || 'Mittente sconosciuto';
    if (elCurrentThreat) {
      if (a.truffa && a.truffa.rilevata) {
        elCurrentThreat.textContent = '🚨 Possibile truffa: ' + (a.truffa.tipo || 'Attenzione richiesta');
        elCurrentThreat.style.color = '#ef4444';
      } else if (a.emozione && a.emozione.arrabbiata) {
        elCurrentThreat.textContent = '💢 Tono arrabbiato o pressante rilevato';
        elCurrentThreat.style.color = '#f97316';
      } else {
        elCurrentThreat.textContent = '🟢 Conversazione considerata sicura';
        elCurrentThreat.style.color = '#22c55e';
      }
    }

    if (elDetailRiskBadge) {
      elDetailRiskBadge.className = 'wa-risk-badge badge-' + rischio;
      elDetailRiskBadge.textContent = rischio + ' (' + (a.punteggioRischio || 0) + '%)';
    }

    if (elDetailIntenzione) {
      elDetailIntenzione.textContent = a.intenzione || 'Nessuna intenzione particolare rilevata.';
    }

    if (elDetailTruffa) {
      if (a.truffa && a.truffa.rilevata) {
        let text = '⚠️ TIPO: ' + (a.truffa.tipo || 'Truffa') + '\n\n' + (a.truffa.motivo || '');
        if (a.truffa.linkSospetti && a.truffa.linkSospetti.length) {
          text += '\n\n🔗 Link sospetti: ' + a.truffa.linkSospetti.map(l => l.url + ' (' + l.motivo + ')').join('\n');
        }
        elDetailTruffa.textContent = text;
        elDetailTruffa.style.borderColor = 'rgba(239, 68, 68, 0.4)';
        elDetailTruffa.style.background = 'rgba(239, 68, 68, 0.08)';
      } else {
        elDetailTruffa.textContent = 'Nessun pattern di truffa o richiesta illecita individuato.';
        elDetailTruffa.style.borderColor = '';
        elDetailTruffa.style.background = '';
      }
    }

    if (elDetailEmozione) {
      const em = a.emozione || {};
      let desc = 'Tono: ' + (em.tono || 'neutro') + ' (intensità ' + (em.intensita || 'normale') + ')';
      if (em.arrabbiata) desc = '💢 Persona arrabbiata / aggressiva. ' + desc;
      elDetailEmozione.textContent = desc;
    }

    if (elDetailSchemi) {
      if (a.schemi && a.schemi.length) {
        elDetailSchemi.innerHTML = a.schemi.map(s => '• ' + escapeHtml(s)).join('<br>');
      } else {
        elDetailSchemi.textContent = 'Nessuno schema anomalo rilevato.';
      }
    }

    if (elDetailConsiglio) {
      elDetailConsiglio.textContent = a.consiglio || 'Comportati normalmente.';
    }

    if (elDetailRisposta) {
      elDetailRisposta.textContent = a.rispostaSuggerita || '(Nessuna risposta suggerita necessaria)';
    }
  }

  async function selezionaContatto(nome) {
    contattoSelezionato = nome;
    renderContatti();

    // Se connessi al bridge, sincronizza la chat remota e i suoi messaggi
    try {
      const res = await fetch('/api/whatsapp/apri-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contatto: nome })
      });
      const data = await res.json();
      if (data && data.success && Array.isArray(data.messaggi) && data.messaggi.length) {
        data.messaggi.forEach(m => {
          const testo = m.testo;
          const esiste = messaggi.find(x => x.contatto === nome && x.messaggio === testo);
          if (!esiste) {
            messaggi.push({
              id: nome + '_' + Date.now() + '_' + Math.random(),
              contatto: nome,
              messaggio: testo,
              daMe: m.tipo === 'out',
              dataOra: m.meta || new Date().toISOString(),
              analisi: (data.ultimoAnalizzato && data.ultimoAnalizzato.messaggio === testo)
                ? data.ultimoAnalizzato.analisi
                : { livelloRischio: 'basso', punteggioRischio: 0, intenzione: 'Messaggio sincronizzato' }
            });
          }
        });
        if (data.ultimoAnalizzato) {
          mostraDettaglioAnalisi(data.ultimoAnalizzato);
        }
      }
    } catch (e) {}

    renderMessaggi();

    // Mostra l'analisi dell'ultimo messaggio di questo contatto affiancata
    const ultimi = messaggi.filter(m => m.contatto === nome);
    if (ultimi.length) {
      mostraDettaglioAnalisi(ultimi[ultimi.length - 1]);
    }
  }

  async function caricaStatoIniziale() {
    try {
      const res = await fetch('/api/whatsapp/status');
      const data = await res.json();
      if (!data) return;

      contatti = data.contatti || [];
      messaggi = data.messaggiRecenti || [];
      aggiornaStatoConnessione(data.stato, data.qrCodeDataUrl);

      renderContatti();
      if (contatti.length) {
        selezionaContatto(contatti[0].nome);
      }
    } catch (e) {
      console.warn('[WhatsAppUI] Errore caricamento stato:', e.message);
    }
  }

  async function eseguiAnalisiManuale(contatto, testo) {
    const txt = (testo || (elInputText ? elInputText.value : '')).trim();
    if (!txt) return;

    const mittente = (contatto || (elInputSender ? elInputSender.value : '') || 'Chat Esaminata').trim();

    if (elBtnAnalyze) {
      elBtnAnalyze.disabled = true;
      elBtnAnalyze.textContent = 'Analisi...';
    }

    try {
      const res = await fetch('/api/whatsapp/analizza', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contatto: mittente, messaggio: txt })
      });
      const data = await res.json();

      if (data.success && data.elemento) {
        messaggi.push(data.elemento);

        // Aggiorna contatti
        const esistente = contatti.find(c => c.nome === mittente);
        if (esistente) {
          esistente.ultimoMessaggio = txt;
          esistente.livelloRischio = data.elemento.analisi.livelloRischio;
          esistente.dataOra = data.elemento.dataOra;
        } else {
          contatti.unshift({
            nome: mittente,
            ultimoMessaggio: txt,
            livelloRischio: data.elemento.analisi.livelloRischio,
            punteggioRischio: data.elemento.analisi.punteggioRischio,
            dataOra: data.elemento.dataOra
          });
        }

        if (elInputText) elInputText.value = '';
        selezionaContatto(mittente);
        mostraDettaglioAnalisi(data.elemento);

        if (data.elemento.analisi.livelloRischio === 'critico' || data.elemento.analisi.livelloRischio === 'alto') {
          suonaAllarmeSicurezza();
        }
      }
    } catch (e) {
      alert('Errore durante l\'analisi del messaggio: ' + e.message);
    } finally {
      if (elBtnAnalyze) {
        elBtnAnalyze.disabled = false;
        elBtnAnalyze.innerHTML = '<span>Esamina 🛡️</span>';
      }
    }
  }

  async function popolaMenuScenari() {
    if (!elMenuScenari) return;
    try {
      const res = await fetch('/api/whatsapp/scenari');
      const data = await res.json();
      if (!data || !Array.isArray(data.scenari)) return;

      elMenuScenari.innerHTML = '';
      data.scenari.forEach(function (sc) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = sc.titolo;
        btn.onclick = () => {
          elMenuScenari.hidden = true;
          eseguiAnalisiManuale(sc.contatto, sc.messaggio);
        };
        elMenuScenari.appendChild(btn);
      });
    } catch (e) {}
  }

  function handleEvent(data) {
    if (!data) return;

    if (data.type === 'whatsapp:status') {
      const s = data.stato || {};
      aggiornaStatoConnessione(s.stato, s.qrCodeDataUrl);
      if (Array.isArray(s.contatti)) {
        contatti = s.contatti;
        renderContatti();
      }
    } else if (data.type === 'whatsapp:qr') {
      aggiornaStatoConnessione('qr_pronto', data.qr);
    } else if (data.type === 'whatsapp:message') {
      const m = data.messaggio;
      if (!m) return;

      messaggi.push(m);
      const esistente = contatti.find(c => c.nome === m.contatto);
      if (esistente) {
        esistente.ultimoMessaggio = m.messaggio;
        esistente.livelloRischio = m.analisi.livelloRischio;
      } else {
        contatti.unshift({
          nome: m.contatto,
          ultimoMessaggio: m.messaggio,
          livelloRischio: m.analisi.livelloRischio,
          punteggioRischio: m.analisi.punteggioRischio,
          dataOra: m.dataOra
        });
      }

      renderContatti();
      if (!contattoSelezionato || contattoSelezionato === m.contatto) {
        selezionaContatto(m.contatto);
      }
    } else if (data.type === 'whatsapp:chat_list') {
      if (Array.isArray(data.contatti)) {
        data.contatti.forEach(nc => {
          const idx = contatti.findIndex(c => c.nome === nc.nome);
          if (idx >= 0) {
            contatti[idx] = Object.assign(contatti[idx], nc);
          } else {
            contatti.push(nc);
          }
        });
        renderContatti();
      }
    } else if (data.type === 'whatsapp:alarm') {
      allarmiNonLetti += 1;
      if (elBadgeAlert) {
        elBadgeAlert.textContent = allarmiNonLetti;
        elBadgeAlert.style.display = 'inline-block';
      }
      suonaAllarmeSicurezza();
    }
  }

  function init() {
    elBtnConnect = document.getElementById('btn-wa-connect');
    elBtnDisconnect = document.getElementById('btn-wa-disconnect');
    elBtnSync = document.getElementById('btn-wa-sync');
    elSearchContacts = document.getElementById('wa-search-contacts');
    elBtnScenari = document.getElementById('btn-wa-scenari');
    elMenuScenari = document.getElementById('wa-scenari-menu');
    elBtnClear = document.getElementById('btn-wa-clear');
    elContactsList = document.getElementById('wa-contacts-list');
    elContactsCount = document.getElementById('wa-contacts-count');
    elQrOverlay = document.getElementById('wa-qr-overlay');
    elQrImg = document.getElementById('wa-qr-img');
    elBtnCloseQr = document.getElementById('btn-close-qr');
    elMessagesStream = document.getElementById('wa-messages-stream');
    elInputSender = document.getElementById('wa-input-sender');
    elInputText = document.getElementById('wa-input-text');
    elBtnAnalyze = document.getElementById('btn-wa-analyze-manual');
    elBtnQuickDemo = document.getElementById('btn-wa-quick-demo');

    elStatusDot = document.getElementById('wa-status-dot');
    elStatusText = document.getElementById('wa-status-text');
    elBadgeAlert = document.getElementById('wa-badge-alert');
    elCurrentAvatar = document.getElementById('wa-current-avatar');
    elCurrentContact = document.getElementById('wa-current-contact');
    elCurrentThreat = document.getElementById('wa-current-threat');

    elDetailRiskBadge = document.getElementById('wa-detail-risk-badge');
    elDetailIntenzione = document.getElementById('wa-detail-intenzione');
    elDetailTruffa = document.getElementById('wa-detail-truffa');
    elDetailEmozione = document.getElementById('wa-detail-emozione');
    elDetailSchemi = document.getElementById('wa-detail-schemi');
    elDetailConsiglio = document.getElementById('wa-detail-consiglio');
    elDetailRisposta = document.getElementById('wa-detail-risposta');
    elBtnCopyReply = document.getElementById('btn-copy-wa-reply');

    // Ricerca chat in tempo reale
    if (elSearchContacts) {
      elSearchContacts.addEventListener('input', (e) => {
        filtroRicerca = (e.target.value || '').trim();
        renderContatti();
      });
    }

    // Filtri per categoria (Tutte, Pericolo, Non lette)
    const filterChips = document.querySelectorAll('.wa-filter-chip');
    filterChips.forEach(chip => {
      chip.addEventListener('click', () => {
        filterChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        filtroTipo = chip.getAttribute('data-filter') || 'tutti';
        renderContatti();
      });
    });

    // Sincronizza chat da WhatsApp Web
    if (elBtnSync) {
      elBtnSync.addEventListener('click', async () => {
        elBtnSync.disabled = true;
        elBtnSync.textContent = 'Aggiornamento...';
        try {
          const res = await fetch('/api/whatsapp/sincronizza', { method: 'POST' });
          const d = await res.json();
          if (d && Array.isArray(d.contatti)) {
            contatti = d.contatti;
            renderContatti();
          }
        } catch (e) {}
        finally {
          elBtnSync.disabled = false;
          elBtnSync.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg> <span>Sincronizza</span>';
        }
      });
    }

    // Connetti Live WhatsApp Web
    if (elBtnConnect) {
      elBtnConnect.addEventListener('click', async () => {
        aggiornaStatoConnessione('in_avvio');
        try {
          await fetch('/api/whatsapp/start', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        } catch (e) {
          aggiornaStatoConnessione('errore');
        }
      });
    }

    // Disconnetti Live
    if (elBtnDisconnect) {
      elBtnDisconnect.addEventListener('click', async () => {
        try {
          await fetch('/api/whatsapp/stop', { method: 'POST' });
          aggiornaStatoConnessione('disconnesso');
        } catch (e) {}
      });
    }

    // Toggle menu scenari
    if (elBtnScenari && elMenuScenari) {
      elBtnScenari.addEventListener('click', (e) => {
        e.stopPropagation();
        elMenuScenari.hidden = !elMenuScenari.hidden;
        if (!elMenuScenari.hidden) popolaMenuScenari();
      });
      document.addEventListener('click', () => {
        if (elMenuScenari) elMenuScenari.hidden = true;
      });
    }

    // Chiudi QR overlay
    if (elBtnCloseQr && elQrOverlay) {
      elBtnCloseQr.addEventListener('click', () => {
        elQrOverlay.hidden = true;
      });
    }

    // Quick demo button
    if (elBtnQuickDemo) {
      elBtnQuickDemo.addEventListener('click', () => {
        eseguiAnalisiManuale(
          '+39 347 9812345 (Sconosciuto)',
          'Ciao mamma, mi è caduto il telefono nell\'acqua e si è rotto. Questo è il mio numero provvisorio, salvatelo subito e scrivimi qui su WhatsApp per favore!'
        );
      });
    }

    // Analisi manuale
    if (elBtnAnalyze) {
      elBtnAnalyze.addEventListener('click', () => eseguiAnalisiManuale());
    }
    if (elInputText) {
      elInputText.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          eseguiAnalisiManuale();
        }
      });
    }

    // Copia risposta suggerita
    if (elBtnCopyReply && elDetailRisposta) {
      elBtnCopyReply.addEventListener('click', async () => {
        const text = elDetailRisposta.textContent.trim();
        if (!text || text.includes('Nessuna risposta')) return;
        try {
          await navigator.clipboard.writeText(text);
          const old = elBtnCopyReply.textContent;
          elBtnCopyReply.textContent = 'Copiato! ✓';
          setTimeout(() => { elBtnCopyReply.textContent = old; }, 2000);
        } catch (e) {}
      });
    }

    // Pulisci cronologia
    if (elBtnClear) {
      elBtnClear.addEventListener('click', async () => {
        if (!confirm('Vuoi davvero cancellare la cronologia delle chat analizzate?')) return;
        try {
          await fetch('/api/whatsapp/pulisci', { method: 'POST' });
          contatti = [];
          messaggi = [];
          contattoSelezionato = null;
          renderContatti();
          renderMessaggi();
        } catch (e) {}
      });
    }

    // Reset badge allarmi quando si apre la scheda
    const tabBtn = document.getElementById('btn-view-whatsapp');
    if (tabBtn) {
      tabBtn.addEventListener('click', () => {
        allarmiNonLetti = 0;
        if (elBadgeAlert) elBadgeAlert.style.display = 'none';
      });
    }

    caricaStatoIniziale();
  }

  const api = {
    init,
    handleEvent,
    selezionaContatto,
    eseguiAnalisiManuale
  };

  window.WhatsAppUI = api;
  return api;
})();
