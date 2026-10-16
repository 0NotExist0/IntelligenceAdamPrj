'use strict';

// ============================================================
// WHATSAPP BRIDGE — Gestore Connessione WhatsApp Web & Live Interception
//
// 1. Gestisce la sessione browser persistente di WhatsApp Web (via puppeteer-core).
// 2. Estrae il QR code e lo invia al frontend per l'accoppiamento rapido.
// 3. Monitora in tempo reale i messaggi in arrivo (message-in).
// 4. Passa ogni messaggio al modulo 'whatsapp-protettore' per analisi antifrode
//    e decifrazione intenzioni / rabbia / schemi relazionali.
// 5. Salva la cronologia locale sicura in un file JSON persistente.
// 6. Include simulatore di scenari reali per test immediati.
// ============================================================

const fs = require('fs');
const path = require('path');
const os = require('os');
const EventEmitter = require('events');
const protettore = require('./whatsapp-protettore');

let puppeteer = null;
try {
  puppeteer = require('puppeteer-core');
} catch (e) {
  puppeteer = null;
}

const runtime = require('../analisi-runtime');

class WhatsAppBridge extends EventEmitter {
  constructor(options) {
    super();
    this.options = options || {};
    this.browser = null;
    this.page = null;
    this.stato = 'disconnesso'; // 'disconnesso' | 'in_avvio' | 'qr_pronto' | 'connesso' | 'errore'
    this.qrCodeDataUrl = null;
    this.ultimoErrore = null;
    this.messaggiAnalizzati = [];
    this.contatti = new Map(); // idContatto -> { nome, ultimoMessaggio, livelloRischio, dataOra }
    this.sessionDir = path.join(os.homedir(), '.notexist_intelligience_whatsapp');
    this.storageFile = path.join(os.homedir(), '.notexist_intelligience_whatsapp_history.json');
    this.pollInterval = null;
    this.messaggiVisti = new Set();

    this.caricaCronologia();
  }

  caricaCronologia() {
    try {
      if (fs.existsSync(this.storageFile)) {
        const raw = fs.readFileSync(this.storageFile, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.messaggi)) {
          this.messaggiAnalizzati = parsed.messaggi.slice(-100);
          this.messaggiAnalizzati.forEach(m => {
            if (m.id) this.messaggiVisti.add(m.id);
            if (m.contatto) {
              this.contatti.set(m.contatto, {
                nome: m.contatto,
                ultimoMessaggio: m.messaggio,
                livelloRischio: m.analisi ? m.analisi.livelloRischio : 'basso',
                punteggioRischio: m.analisi ? m.analisi.punteggioRischio : 0,
                dataOra: m.dataOra || new Date().toISOString()
              });
            }
          });
        }
      }
      // Se non abbiamo ancora messaggi, precarica gli scenari realistici con analisi
      if (this.messaggiAnalizzati.length === 0) {
        this.inizializzaChatPredefinite();
      }
    } catch (e) {
      console.warn('[WhatsAppBridge] Impossibile caricare cronologia:', e.message);
      if (this.messaggiAnalizzati.length === 0) {
        this.inizializzaChatPredefinite();
      }
    }
  }

  inizializzaChatPredefinite() {
    const scenari = this.getScenariTest();
    scenari.forEach((sc, idx) => {
      const euristica = protettore.analizzaEuristica(sc.contatto, sc.messaggio);
      const elemento = {
        id: 'demo_' + sc.id,
        contatto: sc.contatto,
        messaggio: sc.messaggio,
        dataOra: new Date(Date.now() - (scenari.length - idx) * 3600000).toISOString(),
        analisi: {
          livelloRischio: euristica.livelloRischio,
          punteggioRischio: euristica.punteggioRischio,
          intenzione: euristica.truffa.rilevata
            ? 'Tentativo di estorsione, furto credenziali o induzione ad azione impulsiva tramite inganno.'
            : (euristica.emozione.arrabbiata
                ? 'Sfogare rabbia e fare pressione psicologica per intimorire o forzare una reazione immediata.'
                : 'Conversazione quotidiana e amichevole, nessun secondo fine rilevato.'),
          truffa: euristica.truffa,
          emozione: euristica.emozione,
          schemi: euristica.schemi,
          consiglio: euristica.truffa.rilevata
            ? 'NON inviare denaro né codici. Chiama direttamente la persona sul numero storico che conosci.'
            : (euristica.emozione.arrabbiata
                ? 'Non replicare d\'impulso. Mantieni calma professionale e riporta la discussione sui fatti oggettivi.'
                : 'Puoi rispondere normalmente.'),
          rispostaSuggerita: euristica.truffa.rilevata
            ? 'Ti chiamo subito al vecchio numero per verificare a voce la situazione.'
            : (euristica.emozione.arrabbiata
                ? 'Comprendo il tuo punto di vista, verifichiamo insieme con calma i dettagli.'
                : 'Certamente, ci sentiamo più tardi!')
        }
      };

      this.messaggiAnalizzati.push(elemento);
      this.messaggiVisti.add(elemento.id);
      this.contatti.set(sc.contatto, {
        nome: sc.contatto,
        ultimoMessaggio: sc.messaggio,
        livelloRischio: euristica.livelloRischio,
        punteggioRischio: euristica.punteggioRischio,
        dataOra: elemento.dataOra,
        nonLetti: euristica.truffa.rilevata ? 1 : 0
      });
    });
  }

  salvaCronologia() {
    try {
      const dati = {
        aggiornatoIl: new Date().toISOString(),
        messaggi: this.messaggiAnalizzati.slice(-150)
      };
      fs.writeFileSync(this.storageFile, JSON.stringify(dati, null, 2), 'utf8');
    } catch (e) {
      console.warn('[WhatsAppBridge] Impossibile salvare cronologia:', e.message);
    }
  }

  getStato() {
    return {
      stato: this.stato,
      qrCodeDataUrl: this.qrCodeDataUrl,
      ultimoErrore: this.ultimoErrore,
      totaleAnalizzati: this.messaggiAnalizzati.length,
      contatti: Array.from(this.contatti.values()),
      messaggiRecenti: this.messaggiAnalizzati.slice(-30)
    };
  }

  async avviaLiveSession(opzioni) {
    if (this.stato === 'connesso' || this.stato === 'in_avvio') {
      return { ok: true, stato: this.stato };
    }

    if (!puppeteer) {
      this.stato = 'errore';
      this.ultimoErrore = 'Modulo puppeteer-core non installato.';
      this.emit('stato', this.getStato());
      return { ok: false, errore: this.ultimoErrore };
    }

    const browserExe = (runtime.trovaBrowser && runtime.trovaBrowser()) || null;
    if (!browserExe) {
      this.stato = 'errore';
      this.ultimoErrore = 'Nessun browser compatibile (Chrome / Edge) trovato nel sistema.';
      this.emit('stato', this.getStato());
      return { ok: false, errore: this.ultimoErrore };
    }

    this.stato = 'in_avvio';
    this.ultimoErrore = null;
    this.qrCodeDataUrl = null;
    this.emit('stato', this.getStato());

    try {
      if (!fs.existsSync(this.sessionDir)) {
        fs.mkdirSync(this.sessionDir, { recursive: true });
      }

      const launchArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1200,900'
      ];

      this.browser = await puppeteer.launch({
        executablePath: browserExe,
        userDataDir: this.sessionDir,
        headless: !(opzioni && opzioni.mostraFinestra),
        args: launchArgs,
        defaultViewport: { width: 1200, height: 900 }
      });

      const pages = await this.browser.pages();
      this.page = pages.length ? pages[0] : await this.browser.newPage();

      await this.page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      );

      // Expose callback per ricevere nuovi messaggi dal DOM
      await this.page.exposeFunction('__notexist_nuovoMessaggio', async (payload) => {
        await this.elaboraMessaggioInEntrata(payload);
      });

      // Expose callback per ricevere l'elenco completo di tutte le chat
      await this.page.exposeFunction('__notexist_listaChatAggiornata', (lista) => {
        this.elaboraListaChat(lista);
      });

      await this.page.goto('https://web.whatsapp.com', {
        waitUntil: 'networkidle2',
        timeout: 60000
      });

      this.avviaMonitoraggioPagina();
      return { ok: true, stato: this.stato };
    } catch (e) {
      this.stato = 'errore';
      this.ultimoErrore = e.message;
      this.emit('stato', this.getStato());
      return { ok: false, errore: e.message };
    }
  }

  async avviaMonitoraggioPagina() {
    if (!this.page || this.page.isClosed()) return;

    if (this.pollInterval) clearInterval(this.pollInterval);

    this.pollInterval = setInterval(async () => {
      try {
        if (!this.page || this.page.isClosed()) {
          clearInterval(this.pollInterval);
          return;
        }

        // 1. Controlla se siamo già loggati
        const isLogged = await this.page.evaluate(() => {
          return !!(document.querySelector('#pane-side') || document.querySelector('[data-testid="chat-list"]'));
        });

        if (isLogged) {
          if (this.stato !== 'connesso') {
            this.stato = 'connesso';
            this.qrCodeDataUrl = null;
            this.emit('stato', this.getStato());
            await this.installaListenerMessaggi();
          }
          return;
        }

        // 2. Se non siamo loggati, cerca il canvas del QR code
        const qrCanvasData = await this.page.evaluate(() => {
          const canvas = document.querySelector('canvas');
          if (canvas && canvas.width > 100) {
            try { return canvas.toDataURL('image/png'); } catch (e) { return null; }
          }
          return null;
        });

        if (qrCanvasData) {
          if (this.qrCodeDataUrl !== qrCanvasData || this.stato !== 'qr_pronto') {
            this.stato = 'qr_pronto';
            this.qrCodeDataUrl = qrCanvasData;
            this.emit('stato', this.getStato());
            this.emit('qr', { qr: qrCanvasData });
          }
        }
      } catch (err) {
        // silenzia errori minori durante la navigazione
      }
    }, 2000);
  }

  async installaListenerMessaggi() {
    try {
      await this.page.evaluate(() => {
        if (window.__notexist_listener_attivo) return;
        window.__notexist_listener_attivo = true;

        const messaggiVistiLocal = new Set();

        // 1. Scansiona tutte le chat dalla sidebar di WhatsApp Web
        function scansionaListaChat() {
          const pane = document.querySelector('#pane-side');
          if (!pane) return;
          const rows = pane.querySelectorAll('div[role="listitem"], div[role="row"], div._ak8q, div._ak72, div[data-testid="cell-frame-container"]');
          const lista = [];
          rows.forEach((row, idx) => {
            const titleEl = row.querySelector('span[title]') || row.querySelector('div[data-testid="cell-frame-title"] span') || row.querySelector('span._ao3e');
            const nome = titleEl ? (titleEl.getAttribute('title') || titleEl.textContent.trim()) : '';
            if (!nome) return;

            const previewEl = row.querySelector('div[data-testid="cell-frame-secondary"] span') || row.querySelector('span._ak8k') || row.querySelector('.copyable-text');
            const preview = previewEl ? (previewEl.getAttribute('title') || previewEl.textContent.trim()) : '';

            const timeEl = row.querySelector('div[data-testid="cell-frame-meta"] span') || row.querySelector('div[data-testid="cell-frame-meta"]') || row.querySelector('span._ak8i');
            const time = timeEl ? timeEl.textContent.trim() : '';

            const badgeEl = row.querySelector('span[data-testid="icon-unread-count"]') || row.querySelector('span[aria-label*="non letto"]');
            const unread = badgeEl ? parseInt(badgeEl.textContent.trim() || '1', 10) : 0;

            lista.push({
              indice: idx,
              nome: nome,
              ultimoMessaggio: preview,
              dataOra: time,
              nonLetti: unread
            });
          });

          if (lista.length && window.__notexist_listaChatAggiornata) {
            window.__notexist_listaChatAggiornata(lista);
          }
        }

        // 2. Scansiona i messaggi della chat aperta
        function scansionaMessaggi() {
          let contattoCorrente = 'Chat WhatsApp';
          const headerTitle = document.querySelector('header [title]') || document.querySelector('header span[dir="auto"]');
          if (headerTitle) {
            contattoCorrente = headerTitle.getAttribute('title') || headerTitle.textContent || contattoCorrente;
          }

          const nodi = document.querySelectorAll('.message-in');
          nodi.forEach((nodo) => {
            const id = nodo.getAttribute('data-id') || (nodo.textContent.slice(0, 40) + '_' + nodo.offsetTop);
            if (messaggiVistiLocal.has(id)) return;
            messaggiVistiLocal.add(id);

            const copyable = nodo.querySelector('.copyable-text');
            const testoNodo = nodo.querySelector('span.selectable-text') || copyable;
            const testo = testoNodo ? testoNodo.textContent.trim() : '';
            if (!testo) return;

            let dataOra = '';
            if (copyable) {
              dataOra = copyable.getAttribute('data-pre-plain-text') || '';
            }

            window.__notexist_nuovoMessaggio({
              id: id,
              contatto: contattoCorrente,
              testo: testo,
              meta: dataOra,
              timestamp: Date.now()
            });
          });
        }

        // Avvia scansioni periodiche e listener mutazioni
        scansionaListaChat();
        setInterval(scansionaListaChat, 2500);

        const paneSide = document.querySelector('#pane-side');
        if (paneSide) {
          const obsPane = new MutationObserver(() => {
            scansionaListaChat();
          });
          obsPane.observe(paneSide, { childList: true, subtree: true });
        }

        const observer = new MutationObserver(() => {
          scansionaMessaggi();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        scansionaMessaggi();
      });
    } catch (e) {
      console.warn('[WhatsAppBridge] Errore installazione listener:', e.message);
    }
  }

  async elaboraMessaggioInEntrata(payload) {
    if (!payload || !payload.testo) return;
    const msgId = payload.id || (payload.contatto + '_' + Date.now());
    if (this.messaggiVisti.has(msgId)) return;
    this.messaggiVisti.add(msgId);

    const contatto = payload.contatto || 'Mittente sconosciuto';
    const testo = payload.testo;

    // Recupera il contesto recente con questo contatto
    const contesto = this.messaggiAnalizzati
      .filter(m => m.contatto === contatto)
      .slice(-6)
      .map(m => ({ daMe: false, mittente: m.contatto, testo: m.messaggio }));

    // Analisi con il Protettore
    const analisi = await protettore.analizzaMessaggio({
      contatto: contatto,
      messaggio: testo,
      contesto: contesto,
      modello: this.options.modello || 'qwen3.5-studio:9b',
      baseUrl: this.options.baseUrl || 'http://localhost:11434',
      apiKey: this.options.apiKey || '',
      authToken: this.options.authToken || ''
    });

    const elemento = {
      id: msgId,
      contatto: contatto,
      messaggio: testo,
      dataOra: new Date().toISOString(),
      analisi: analisi
    };

    this.messaggiAnalizzati.push(elemento);
    this.contatti.set(contatto, {
      nome: contatto,
      ultimoMessaggio: testo,
      livelloRischio: analisi.livelloRischio,
      punteggioRischio: analisi.punteggioRischio,
      dataOra: elemento.dataOra
    });

    this.salvaCronologia();

    // Emette l'evento per la UI via WebSocket
    this.emit('messaggio', elemento);
    if (analisi.livelloRischio === 'critico' || analisi.livelloRischio === 'alto') {
      this.emit('allarme', {
        tipo: 'pericolo_sicurezza',
        contatto: contatto,
        livello: analisi.livelloRischio,
        messaggio: testo,
        motivo: analisi.truffa.rilevata ? analisi.truffa.motivo : analisi.consiglio
      });
    }

    return elemento;
  }

  elaboraListaChat(lista) {
    if (!Array.isArray(lista)) return;
    let cambiati = false;
    for (const c of lista) {
      if (!c.nome) continue;
      const esistente = this.contatti.get(c.nome);
      if (!esistente) {
        let rischio = 'basso';
        let punteggio = 0;
        if (c.ultimoMessaggio) {
          const eur = protettore.analizzaEuristica(c.nome, c.ultimoMessaggio);
          rischio = eur.livelloRischio;
          punteggio = eur.punteggioRischio;
        }

        this.contatti.set(c.nome, {
          nome: c.nome,
          ultimoMessaggio: c.ultimoMessaggio || '',
          livelloRischio: rischio,
          punteggioRischio: punteggio,
          dataOra: c.dataOra || '',
          nonLetti: c.nonLetti || 0
        });
        cambiati = true;
      } else {
        let agg = false;
        if (c.ultimoMessaggio && c.ultimoMessaggio !== esistente.ultimoMessaggio) {
          esistente.ultimoMessaggio = c.ultimoMessaggio;
          const eur = protettore.analizzaEuristica(c.nome, c.ultimoMessaggio);
          esistente.livelloRischio = eur.livelloRischio;
          esistente.punteggioRischio = eur.punteggioRischio;
          agg = true;
        }
        if (c.dataOra && c.dataOra !== esistente.dataOra) {
          esistente.dataOra = c.dataOra;
          agg = true;
        }
        if (c.nonLetti !== undefined && c.nonLetti !== esistente.nonLetti) {
          esistente.nonLetti = c.nonLetti;
          agg = true;
        }
        if (agg) cambiati = true;
      }
    }

    if (cambiati) {
      this.salvaCronologia();
      this.emit('stato', this.getStato());
      this.emit('chat_list', { contatti: Array.from(this.contatti.values()) });
    }
  }

  async apriChat(nomeContatto) {
    if (!nomeContatto) return { ok: false, error: 'Nome contatto mancante' };

    // Se offline o non connesso, recupera la cronologia salvata
    if (!this.page || this.page.isClosed() || this.stato !== 'connesso') {
      const salvati = this.messaggiAnalizzati.filter(m => m.contatto === nomeContatto);
      const ultimo = salvati.length ? salvati[salvati.length - 1] : null;
      return { ok: true, offline: true, contatto: nomeContatto, messaggi: salvati, ultimoAnalizzato: ultimo };
    }

    try {
      const trovato = await this.page.evaluate((targetName) => {
        const pane = document.querySelector('#pane-side');
        if (!pane) return false;
        const rows = pane.querySelectorAll('div[role="listitem"], div[role="row"], div[data-testid="cell-frame-container"]');
        for (const row of rows) {
          const titleEl = row.querySelector('span[title]') || row.querySelector('div[data-testid="cell-frame-title"] span') || row.querySelector('span._ao3e');
          const n = titleEl ? (titleEl.getAttribute('title') || titleEl.textContent.trim()) : '';
          if (n && (n.toLowerCase() === targetName.toLowerCase() || n.toLowerCase().includes(targetName.toLowerCase()))) {
            row.click();
            return true;
          }
        }
        return false;
      }, nomeContatto);

      await new Promise(r => setTimeout(r, 600));

      const messaggiEstratti = await this.page.evaluate(() => {
        const nodes = document.querySelectorAll('#main .message-in, #main .message-out');
        const list = [];
        nodes.forEach((n) => {
          const isIn = n.classList.contains('message-in');
          const copyable = n.querySelector('.copyable-text');
          const textEl = n.querySelector('span.selectable-text') || copyable;
          const text = textEl ? textEl.textContent.trim() : '';
          if (!text) return;
          const meta = copyable ? copyable.getAttribute('data-pre-plain-text') : '';
          list.push({
            tipo: isIn ? 'in' : 'out',
            testo: text,
            meta: meta || ''
          });
        });
        return list;
      });

      let ultimoAnalizzato = null;
      const ultimiIn = messaggiEstratti.filter(m => m.tipo === 'in');
      if (ultimiIn.length) {
        const ultimo = ultimiIn[ultimiIn.length - 1];
        const trovatoInMem = this.messaggiAnalizzati.find(m => m.contatto === nomeContatto && m.messaggio === ultimo.testo);
        if (trovatoInMem) {
          ultimoAnalizzato = trovatoInMem;
        } else {
          ultimoAnalizzato = await this.elaboraMessaggioInEntrata({
            id: nomeContatto + '_' + Date.now(),
            contatto: nomeContatto,
            testo: ultimo.testo,
            meta: ultimo.meta,
            timestamp: Date.now()
          });
        }
      }

      return {
        ok: true,
        contatto: nomeContatto,
        trovato: trovato,
        messaggi: messaggiEstratti,
        ultimoAnalizzato: ultimoAnalizzato
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async sincronizzaChat() {
    if (!this.page || this.page.isClosed() || this.stato !== 'connesso') {
      return { ok: true, contatti: Array.from(this.contatti.values()) };
    }
    try {
      const lista = await this.page.evaluate(() => {
        const pane = document.querySelector('#pane-side');
        if (!pane) return [];
        const rows = pane.querySelectorAll('div[role="listitem"], div[role="row"], div[data-testid="cell-frame-container"]');
        const res = [];
        rows.forEach((row, idx) => {
          const titleEl = row.querySelector('span[title]') || row.querySelector('div[data-testid="cell-frame-title"] span');
          const nome = titleEl ? (titleEl.getAttribute('title') || titleEl.textContent.trim()) : '';
          if (!nome) return;
          const previewEl = row.querySelector('div[data-testid="cell-frame-secondary"] span') || row.querySelector('.copyable-text');
          const preview = previewEl ? (previewEl.getAttribute('title') || previewEl.textContent.trim()) : '';
          const timeEl = row.querySelector('div[data-testid="cell-frame-meta"] span');
          const time = timeEl ? timeEl.textContent.trim() : '';
          res.push({ indice: idx, nome: nome, ultimoMessaggio: preview, dataOra: time });
        });
        return res;
      });
      if (Array.isArray(lista) && lista.length) {
        this.elaboraListaChat(lista);
      }
      return { ok: true, contatti: Array.from(this.contatti.values()) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // Metodo per analizzare un testo inserito manualmente dall'utente
  async analizzaManuale(opzioni) {
    const contatto = String(opzioni.contatto || 'Chat importata / Test').trim();
    const testo = String(opzioni.messaggio || '').trim();
    if (!testo) throw new Error('Testo del messaggio vuoto');

    const contesto = Array.isArray(opzioni.contesto) ? opzioni.contesto : [];

    const analisi = await protettore.analizzaMessaggio({
      contatto: contatto,
      messaggio: testo,
      contesto: contesto,
      usaLlm: opzioni.usaLlm !== false,
      modello: opzioni.modello || this.options.modello || 'qwen3.5-studio:9b',
      baseUrl: opzioni.baseUrl || this.options.baseUrl || 'http://localhost:11434',
      apiKey: opzioni.apiKey || this.options.apiKey || '',
      authToken: opzioni.authToken || this.options.authToken || ''
    });

    const msgId = 'manuale_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const elemento = {
      id: msgId,
      contatto: contatto,
      messaggio: testo,
      dataOra: new Date().toISOString(),
      analisi: analisi
    };

    this.messaggiAnalizzati.push(elemento);
    this.contatti.set(contatto, {
      nome: contatto,
      ultimoMessaggio: testo,
      livelloRischio: analisi.livelloRischio,
      punteggioRischio: analisi.punteggioRischio,
      dataOra: elemento.dataOra
    });

    this.salvaCronologia();
    this.emit('messaggio', elemento);
    return elemento;
  }

  // Scenari di prova reali per simulare il Protettore
  getScenariTest() {
    return [
      {
        id: 'truffa_figlio',
        titolo: 'Truffa Finto Figlio ("Ho perso il telefono")',
        contatto: '+39 347 9812345 (Sconosciuto)',
        messaggio: 'Ciao mamma, mi è caduto il telefono nell\'acqua e si è rotto. Questo è il mio numero provvisorio, salvatelo subito e scrivimi qui su WhatsApp per favore!'
      },
      {
        id: 'phishing_banca',
        titolo: 'Phishing Postepay / Banca (Accesso anomalo)',
        contatto: 'PosteInfo (+39 333 1122334)',
        messaggio: 'Gentile cliente, abbiamo rilevato un accesso anomalo sul tuo conto BancoPosta/Postepay. Per evitare il blocco temporaneo dei fondi verifica ora la tua identità: http://194.26.29.112/accesso'
      },
      {
        id: 'richiesta_otp',
        titolo: 'Furto Account WhatsApp (Richiesta codice OTP)',
        contatto: '+39 349 0011223 (Amico hackerato)',
        messaggio: 'Ciao scusa ho fatto un errore e ti ho mandato per sbaglio un codice a 6 cifre via SMS sul tuo numero. Me lo puoi girare subito qui che mi serve urgente?'
      },
      {
        id: 'capo_arrabbiato',
        titolo: 'Messaggio Arrabbiato / Pressione Lavorativa',
        contatto: 'Direttore Vendite',
        messaggio: 'È la terza volta che te lo chiedo ed è inaccettabile che tu non abbia ancora risposto. Pretendo spiegazioni immediate oggi stesso, vergognati!'
      },
      {
        id: 'normale_amico',
        titolo: 'Messaggio Normale & Sicuro',
        contatto: 'Sara (Amica)',
        messaggio: 'Ciao! Hai poi finito quel lavoro per domani? Se ti va stasera ci prendiamo una pizza insieme verso le otto.'
      }
    ];
  }

  async chiudiLiveSession() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    if (this.browser) {
      try {
        await this.browser.close();
      } catch (e) {}
      this.browser = null;
      this.page = null;
    }

    this.stato = 'disconnesso';
    this.qrCodeDataUrl = null;
    this.emit('stato', this.getStato());
    return { ok: true };
  }
}

// Istanza singleton per l'applicazione
let istanzaBridge = null;
function getWhatsAppBridge(options) {
  if (!istanzaBridge) {
    istanzaBridge = new WhatsAppBridge(options);
  } else if (options) {
    istanzaBridge.options = Object.assign(istanzaBridge.options, options);
  }
  return istanzaBridge;
}

module.exports = {
  WhatsAppBridge,
  getWhatsAppBridge
};
