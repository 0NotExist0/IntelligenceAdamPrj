// NotExist Intelligience Studio - Controller per Pagina Standalone WhatsApp Protettore
// Gestisce la connessione WebSocket autonoma e gli eventi in tempo reale per whatsapp.html

(function () {
  'use strict';

  let ws = null;
  let riconnessioneTimer = null;
  let allarmiTotali = 0;
  const originalTitle = document.title;

  function connettiWebSocket() {
    if (ws) {
      try {
        ws.close();
      } catch (e) {}
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}`;

    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      pianificaRiconnessione();
      return;
    }

    ws.onopen = () => {
      console.log('[WhatsApp Protettore] Connesso al canale real-time');
      if (riconnessioneTimer) {
        clearTimeout(riconnessioneTimer);
        riconnessioneTimer = null;
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        // Se arriva lo snapshot iniziale del server con lo stato di WhatsApp
        if (msg.type === 'init' && msg.whatsapp && window.WhatsAppUI) {
          WhatsAppUI.handleEvent({ type: 'whatsapp:status', stato: msg.whatsapp });
        }
        // Se arriva qualsiasi evento whatsapp:* dal bridge
        else if (msg.type && msg.type.startsWith('whatsapp:') && window.WhatsAppUI) {
          WhatsAppUI.handleEvent(msg);

          if (msg.type === 'whatsapp:alarm') {
            allarmiTotali += 1;
            document.title = `(${allarmiTotali} ALLARMI) ${originalTitle}`;
          }
        }
      } catch (err) {
        // Ignora messaggi non JSON (es. frammenti terminale grezzi)
      }
    };

    ws.onclose = () => {
      pianificaRiconnessione();
    };

    ws.onerror = () => {
      pianificaRiconnessione();
    };
  }

  function pianificaRiconnessione() {
    if (riconnessioneTimer) return;
    riconnessioneTimer = setTimeout(() => {
      riconnessioneTimer = null;
      connettiWebSocket();
    }, 2500);
  }

  // Al caricamento della pagina autonoma
  window.addEventListener('DOMContentLoaded', () => {
    if (window.WhatsAppUI && typeof WhatsAppUI.init === 'function') {
      WhatsAppUI.init();
    }
    connettiWebSocket();

    // Reset allarmi nel titolo al click in pagina
    window.addEventListener('click', () => {
      if (allarmiTotali > 0) {
        allarmiTotali = 0;
        document.title = originalTitle;
      }
    });
  });
})();
