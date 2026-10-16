// NotExist Intelligience Studio - Frontend Controller
// (c) 0Not_Exist0 - interfaccia grafica per Claude Code

let term = null;
let fitAddon = null;
let ws = null;
let currentFontSize = 14;
let currentWorkingDir = '';
let currentView = 'chat';
let currentExplorerDir = '';
let selectedFilePath = '';

// DOM Elements (assigned in DOMContentLoaded)
let currentDirDisplay = null;
let statusBadge = null;
let statusLabel = null;
let statusDot = null;
let quickInput = null;
let btnSendInput = null;

// In modalita' remota il token viene passato una sola volta come ?token=... .
// Lo conserviamo soltanto nella sessione del browser, lo togliamo subito dalla
// barra degli indirizzi e lo aggiungiamo alle richieste verso questo server.
const studioTokenParams = new URLSearchParams(window.location.search);
const studioTokenFromUrl = studioTokenParams.get('token');
if (studioTokenFromUrl) {
  sessionStorage.setItem('studio-access-token', studioTokenFromUrl);
  studioTokenParams.delete('token');
  const cleanQuery = studioTokenParams.toString();
  history.replaceState(null, '', window.location.pathname + (cleanQuery ? '?' + cleanQuery : '') + window.location.hash);
}
const studioAccessToken = sessionStorage.getItem('studio-access-token') || '';
const nativeFetch = window.fetch.bind(window);
window.fetch = function (input, init) {
  const requestUrl = typeof input === 'string' ? input : input.url;
  const target = new URL(requestUrl, window.location.href);
  if (!studioAccessToken || target.origin !== window.location.origin) return nativeFetch(input, init);
  const options = Object.assign({}, init || {});
  options.headers = new Headers((init && init.headers) || (typeof input !== 'string' && input.headers) || undefined);
  options.headers.set('X-Studio-Token', studioAccessToken);
  return nativeFetch(input, options);
};

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  // Assign DOM element references safely after DOM is ready
  currentDirDisplay = document.getElementById('current-dir-display');
  statusBadge = document.getElementById('claude-status-badge');
  statusLabel = document.getElementById('status-label');
  statusDot = statusBadge.querySelector('.status-dot');
  quickInput = document.getElementById('quick-input');
  btnSendInput = document.getElementById('btn-send-input');

  initTerminal();
  initWebSocket();
  initTabs();
  initSidebarResizer();
  initProjectsSection();
  initNeuralBrain();
  initMemoryTab();
  initNetworkModal();
  initActionDeck();
  initTopActions();
  initModals();
  initWebSearch();
  initDocumentazione();
  initMcp();
  initChat();
  initWhatsAppNav();
  initViewSwitch();
  initDiagnostics();
  initScan();
  initCodeMap();
  initRuntime();
  initPreview();
  initBoot();
  fetchInitialStatus();
  loadLocalModelOptions();
});

// 1. Terminal Initialization (xterm.js)
function initTerminal() {
  const container = document.getElementById('terminal-container');
  
  term = new Terminal({
    cursorBlink: true,
    cursorStyle: 'block',
    fontSize: currentFontSize,
    fontFamily: "'Fira Code', 'Cascadia Code', Consolas, monospace",
    lineHeight: 1.25,
    theme: {
      background: '#0b0c0e',
      foreground: '#e2e8f0',
      cursor: '#e07a5f',
      cursorAccent: '#0b0c0e',
      selectionBackground: 'rgba(224, 122, 95, 0.35)',
      selectionInactiveBackground: 'rgba(224, 122, 95, 0.2)',
      black: '#1a1c23',
      red: '#f87171',
      green: '#4ade80',
      yellow: '#fbbf24',
      blue: '#60a5fa',
      magenta: '#c084fc',
      cyan: '#38bdf8',
      white: '#f1f5f9',
      brightBlack: '#475569',
      brightRed: '#ef4444',
      brightGreen: '#22c55e',
      brightYellow: '#f59e0b',
      brightBlue: '#3b82f6',
      brightMagenta: '#a855f7',
      brightCyan: '#06b6d4',
      brightWhite: '#ffffff'
    },
    allowTransparency: true,
    scrollback: 5000
  });

  fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);

  if (window.WebLinksAddon) {
    term.loadAddon(new WebLinksAddon.WebLinksAddon());
  }

  term.open(container);
  safeFit();

  // Il pannello del terminale parte NASCOSTO (la vista predefinita e' la chat), quindi
  // al primo fit il contenitore ha dimensione zero e xterm si assesta su 2x1. Un
  // ResizeObserver rifa il calcolo appena il pannello diventa visibile o cambia
  // dimensione: e' l'unico modo affidabile, i timeout fissi sbagliano di continuo.
  if (window.ResizeObserver) {
    const osservatore = new ResizeObserver(() => safeFit());
    osservatore.observe(container);
  }

  // Forward user keyboard input to WebSocket
  term.onData((data) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data: data }));
    }
  });

  // Handle window resize
  window.addEventListener('resize', () => safeFit());

  // Re-fit once font is loaded
  if (document.fonts) {
    document.fonts.ready.then(() => safeFit());
  }
}

// Ridimensiona solo quando il contenitore ha davvero una dimensione utile. Inviare
// al server dimensioni assurde (2x1) fa disegnare a Claude Code un terminale
// inutilizzabile, ed e' esattamente cio' che accadeva partendo dal pannello nascosto.
function safeFit() {
  if (!term || !fitAddon) return;
  const container = document.getElementById('terminal-container');
  if (!container || container.clientWidth < 50 || container.clientHeight < 30) return;
  try {
    fitAddon.fit();
  } catch (e) {
    return;
  }
  if (term.cols >= 20 && term.rows >= 5) sendResize();
}

function sendResize() {
  if (term && ws && ws.readyState === WebSocket.OPEN) {
    const cols = term.cols;
    const rows = term.rows;
    ws.send(JSON.stringify({ type: 'resize', cols, rows }));
  }
}

// 2. WebSocket Connection
function initWebSocket() {
  // Clean up existing WebSocket to prevent leaks during reconnection
  if (ws) {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
    ws = null;
  }

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const tokenQuery = studioAccessToken ? `?token=${encodeURIComponent(studioAccessToken)}` : '';
  const wsUrl = `${protocol}//${location.host}${tokenQuery}`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('[WS] Connesso al server NotExist Intelligience Studio');
    setTimeout(() => {
      sendResize();
    }, 200);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      
      if (msg.type === 'init') {
        term.reset();
        if (msg.buffer) term.write(msg.buffer);
        updateStatus(msg.running);
        if (msg.cwd) setWorkingDir(msg.cwd);
        if (msg.config) applyConfigState(msg.config);
        if (msg.chat) ChatUI.applySnapshot(msg.chat);
      } else if (msg.type === 'output') {
        term.write(msg.data);
      } else if (msg.type === 'chat') {
        ChatUI.handleEvent(msg);
      } else if (msg.type === 'whatsapp:alarm') {
        const badge = document.getElementById('wa-badge-alert');
        if (badge) {
          const count = (parseInt(badge.textContent || '0', 10) || 0) + 1;
          badge.textContent = count;
          badge.style.display = 'inline-block';
        }
      } else if (msg.type === 'status') {
        updateStatus(msg.running);
        if (msg.cwd) setWorkingDir(msg.cwd);
      }
    } catch (err) {
      // Raw string
      term.write(event.data);
    }
  };

  ws.onclose = () => {
    updateStatus(false);
    console.warn('[WS] Connessione chiusa. Tentativo di riconnessione tra 2 secondi...');
    setTimeout(initWebSocket, 2000);
  };

  ws.onerror = (err) => {
    console.error('[WS] Errore WebSocket:', err);
  };
}

function updateStatus(isRunning) {
  if (isRunning) {
    statusDot.className = 'status-dot online';
    statusLabel.textContent = 'Adam Attivo';
    statusBadge.title = 'Processo Claude Code in esecuzione';
  } else {
    statusDot.className = 'status-dot offline';
    statusLabel.textContent = 'Fermo';
    statusBadge.title = 'Processo Claude Code non attivo. Clicca Riavvia per farlo ripartire.';
  }
}

function setWorkingDir(dir) {
  if (!dir) return;
  const dirCambiata = currentWorkingDir !== dir;
  currentWorkingDir = dir;
  currentDirDisplay.textContent = dir;
  currentDirDisplay.title = dir;

  // Update projects tab displays
  const activePathDisplay = document.getElementById('active-project-path-display');
  if (activePathDisplay) {
    activePathDisplay.textContent = dir;
    activePathDisplay.title = dir;
  }

  const inputWorkDir = document.getElementById('input-work-dir');
  if (inputWorkDir && document.activeElement !== inputWorkDir) {
    inputWorkDir.value = dir;
  }

  const activeName = document.getElementById('active-project-name');
  if (activeName) {
    const parts = dir.split(/[\\/]/).filter(Boolean);
    activeName.textContent = parts.length > 0 ? parts[parts.length - 1] : dir;
  }

  // Update active state on project cards
  updateActiveProjectCards(dir);

  // Se la cartella di lavoro è cambiata, aggiorna subito la memoria indipendente di questo progetto
  if (dirCambiata) {
    refreshMemoryData(true);
  }

  // If explorer not yet loaded, load files
  if (!currentExplorerDir) {
    currentExplorerDir = dir;
    loadFileExplorer(dir);
  }
}

function sendToTerminal(text, appendEnter = true) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    alert('Connessione al server non attiva. Riprova tra qualche istante.');
    return;
  }
  const payload = appendEnter ? text + '\r' : text;
  ws.send(JSON.stringify({ type: 'input', data: payload }));
  
  // Aggiungi alla cronologia locale per feedback visivo immediato se è un comando completo
  if (appendEnter && text.trim().length > 0) {
    addToPromptHistory(text.trim());
  }
  
  term.focus();
}

// La pagina aperta nell'Anteprima: se un messaggio segnala un bug, il server misura quella.
function paginaAnteprimaCorrente() {
  const selettore = document.getElementById('preview-page');
  return selettore && selettore.value ? selettore.value : undefined;
}

// Instrada un prompt verso la vista attiva. Prima tutto finiva nel terminale
// anche quando l'utente stava guardando la chat, e le azioni sembravano non fare nulla.
function sendPrompt(text) {
  if (!text || !text.trim()) return;
  if (!navigator.onLine) {
    alert('Connessione Internet assente (Offline): il modello non può ricevere la richiesta. Verifica la connessione e riprova.');
    return;
  }
  if (currentView === 'chat') {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      alert('Connessione al server non attiva. Riprova tra qualche istante.');
      return;
    }
    ws.send(JSON.stringify({ type: 'chat-send', text: text.trim(), pagina: paginaAnteprimaCorrente() }));
    ChatUI.focus();
    return;
  }
  sendToTerminal(text, true);
}

// Prompt History Logic
function addToPromptHistory(text) {
  const container = document.getElementById('input-history-container');
  if (!container) return;
  
  container.style.display = 'flex';
  
  const bubble = document.createElement('div');
  bubble.className = 'history-bubble';
  
  const icon = document.createElement('div');
  icon.className = 'history-icon';
  icon.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"></path><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`;
  
  const textEl = document.createElement('div');
  textEl.className = 'history-text';
  textEl.textContent = text;
  
  bubble.appendChild(icon);
  bubble.appendChild(textEl);
  
  // Aggiungi in alto (il più recente in basso se usiamo flex-direction column)
  container.appendChild(bubble);
  
  // Limita a 5 messaggi
  while (container.children.length > 5) {
    container.removeChild(container.firstChild);
  }
  
  // Fai scorrere automaticamente in basso
  container.scrollTop = container.scrollHeight;
}

// 3. Tab Switching in Sidebar
function initTabs() {
  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    sidebar.scrollLeft = 0;
    sidebar.addEventListener('scroll', () => {
      if (sidebar.scrollLeft !== 0) sidebar.scrollLeft = 0;
    });
  }

  const tabsContainer = document.querySelector('.sidebar-tabs');
  if (tabsContainer) {
    tabsContainer.addEventListener('wheel', (e) => {
      if (e.deltaY !== 0) {
        tabsContainer.scrollLeft += e.deltaY * 0.8;
        e.preventDefault();
      }
    }, { passive: false });
  }

  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

      tab.classList.add('active');
      const content = document.getElementById(target);
      if (content) {
        content.classList.add('active');
        content.scrollTop = 0;
      }

      if (sidebar) sidebar.scrollLeft = 0;
      if (typeof tab.scrollIntoView === 'function') {
        tab.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
      }

      if (target === 'tab-projects') {
        loadProjectsData();
      } else if (target === 'tab-memory') {
        refreshMemoryData();
      } else if (target === 'tab-files') {
        loadFileExplorer(currentExplorerDir || currentWorkingDir);
      } else if (target === 'tab-web-search') {
        if (typeof caricaSitiConsigliati === 'function') caricaSitiConsigliati();
      } else if (target === 'tab-documentazione') {
        if (typeof caricaDocumentazione === 'function') caricaDocumentazione();
      }
    });
  });
}

// 3b. Maniglia di ridimensionamento della Sidebar (Drag to Resize)
function initSidebarResizer() {
  const sidebar = document.getElementById('sidebar');
  const resizer = document.getElementById('sidebar-resizer');
  if (!sidebar || !resizer) return;

  const salvata = localStorage.getItem('sidebar_width');
  if (salvata && !isNaN(Number(salvata))) {
    const w = Math.max(280, Math.min(700, parseInt(salvata, 10)));
    sidebar.style.width = w + 'px';
  }

  let dragging = false;

  resizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = true;
    resizer.classList.add('attiva');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const nuovaLarghezza = Math.max(280, Math.min(700, e.clientX));
    sidebar.style.width = nuovaLarghezza + 'px';
    if (typeof fitAddon !== 'undefined' && fitAddon && typeof fitAddon.fit === 'function') {
      fitAddon.fit();
    }
  });

  window.addEventListener('mouseup', () => {
    if (dragging) {
      dragging = false;
      resizer.classList.remove('attiva');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem('sidebar_width', String(parseInt(sidebar.style.width, 10)));
      if (typeof sendResize === 'function') sendResize();
    }
  });
}

// 4. Action Deck (Keys, Slash commands, Prompts)
function initActionDeck() {
  // Key Approvals
  document.getElementById('key-yes').addEventListener('click', () => sendToTerminal('y', true));
  document.getElementById('key-no').addEventListener('click', () => sendToTerminal('n', true));
  document.getElementById('key-ctrl-c').addEventListener('click', () => sendToTerminal('\x03', false));
  document.getElementById('key-esc').addEventListener('click', () => sendToTerminal('\x1b', false));
  document.getElementById('key-enter').addEventListener('click', () => sendToTerminal('\r', false));

  // Slash commands
  document.querySelectorAll('.chip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cmd = btn.dataset.cmd;
      if (cmd) sendPrompt(cmd);
    });
  });

  // Prompt templates
  document.querySelectorAll('.prompt-item').forEach(item => {
    item.addEventListener('click', () => {
      const promptText = item.dataset.prompt;
      if (!promptText) return;
      if (currentView === 'chat') {
        const chatInput = document.getElementById('chat-input');
        chatInput.value = promptText;
        chatInput.dispatchEvent(new Event('input'));
        chatInput.focus();
      } else {
        quickInput.value = promptText;
        quickInput.focus();
      }
    });
  });

  // Quick Input bar
  btnSendInput.addEventListener('click', submitQuickInput);
  quickInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      submitQuickInput();
    }
  });
}

function submitQuickInput() {
  const text = quickInput.value.trim();
  if (!text) return;
  sendToTerminal(text, true);
  quickInput.value = '';
}

// 5. Top Controls
function initTopActions() {
  // Riavvio della sessione
  document.getElementById('btn-restart-claude').addEventListener('click', async () => {
    if (confirm('Vuoi riavviare la sessione di Adam?')) {
      try {
        const res = await fetch('/api/restart', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          term.focus();
        }
      } catch (e) {
        alert('Errore durante il riavvio: ' + e.message);
      }
    }
  });

  // Clear Terminal
  document.getElementById('btn-clear-term').addEventListener('click', () => {
    if (term) term.clear();
  });

  // Toggle Sidebar
  const sidebar = document.getElementById('sidebar');
  const toggleBtn = document.getElementById('btn-toggle-sidebar');
  const mobileSidebar = window.matchMedia && window.matchMedia('(max-width: 600px)').matches;
  if (sidebar && (mobileSidebar || localStorage.getItem('sidebar_collapsed') === 'true')) {
    sidebar.classList.add('collapsed');
  }
  if (toggleBtn && sidebar) {
    toggleBtn.setAttribute('aria-controls', 'sidebar');
    toggleBtn.setAttribute('aria-expanded', sidebar.classList.contains('collapsed') ? 'false' : 'true');
  }
  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      const isCollapsed = sidebar.classList.contains('collapsed');
      toggleBtn.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
      localStorage.setItem('sidebar_collapsed', isCollapsed ? 'true' : 'false');
      setTimeout(() => {
        if (typeof fitAddon !== 'undefined' && fitAddon && typeof fitAddon.fit === 'function') {
          fitAddon.fit();
        }
        if (typeof sendResize === 'function') sendResize();
      }, 220);
    });
  }

  // Font size adjustments
  document.getElementById('btn-font-decrease').addEventListener('click', () => {
    if (currentFontSize > 10) {
      currentFontSize -= 1;
      updateFontSize(currentFontSize);
    }
  });

  document.getElementById('btn-font-increase').addEventListener('click', () => {
    if (currentFontSize < 24) {
      currentFontSize += 1;
      updateFontSize(currentFontSize);
    }
  });

  // Copy selection
  document.getElementById('btn-copy-term').addEventListener('click', () => {
    if (term.hasSelection()) {
      const text = term.getSelection();
      navigator.clipboard.writeText(text);
      const btn = document.getElementById('btn-copy-term');
      btn.textContent = 'Copiato!';
      setTimeout(() => btn.textContent = 'Copia', 1200);
    } else {
      alert('Seleziona prima del testo nel terminale con il mouse per copiarlo.');
    }
  });

  // Fullscreen terminal toggle
  document.getElementById('btn-fullscreen-term').addEventListener('click', () => {
    // .terminal-wrapper e' diventato #view-terminal con l'aggiunta della vista chat.
    const termWrapper = document.getElementById('view-terminal');
    if (!termWrapper) return;
    if (!document.fullscreenElement) {
      termWrapper.requestFullscreen().then(() => {
        setTimeout(() => { try { fitAddon.fit(); sendResize(); } catch (e) {} }, 80);
      }).catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });
}

function updateFontSize(size) {
  term.options.fontSize = size;
  fitAddon.fit();
  sendResize();
}

// 6. File Explorer
async function loadFileExplorer(dir) {
  const container = document.getElementById('file-tree-container');
  const pathDisplay = document.getElementById('file-explorer-current');
  
  container.innerHTML = '<div class="loading-spinner" style="padding: 10px; color: #888;">Caricamento file...</div>';

  try {
    const res = await fetch(`/api/files?dir=${encodeURIComponent(dir)}`);
    const data = await res.json();

    if (data.error) {
      container.innerHTML = `<div style="color: #ef4444; padding: 8px;">Errore: ${data.error}</div>`;
      return;
    }

    currentExplorerDir = data.currentDir;
    pathDisplay.textContent = data.currentDir;
    pathDisplay.title = data.currentDir;

    // Parent folder button
    const btnParent = document.getElementById('btn-file-parent');
    btnParent.onclick = () => {
      if (data.parentDir && data.parentDir !== data.currentDir) {
        loadFileExplorer(data.parentDir);
      }
    };

    // Refresh button
    const btnRefresh = document.getElementById('btn-file-refresh');
    btnRefresh.onclick = () => loadFileExplorer(currentExplorerDir);

    renderFileItems(data.items, container);
  } catch (err) {
    container.innerHTML = `<div style="color: #ef4444; padding: 8px;">Errore di caricamento: ${err.message}</div>`;
  }
}

function renderFileItems(items, container) {
  container.innerHTML = '';

  if (!items || items.length === 0) {
    container.innerHTML = '<div style="color: #71717a; padding: 8px; font-size: 11px;">Cartella vuota</div>';
    return;
  }

  items.forEach(item => {
    const el = document.createElement('div');
    el.className = `file-tree-item ${item.isDirectory ? 'is-dir' : ''}`;
    
    // Icon
    let iconSvg = '';
    if (item.isDirectory) {
      iconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" opacity="0.85"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
    } else {
      iconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`;
    }

    const sizeStr = item.isDirectory ? '' : formatBytes(item.size);

    el.innerHTML = `
      ${iconSvg}
      <span class="file-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
      <span class="file-size">${sizeStr}</span>
    `;

    el.addEventListener('click', () => {
      if (item.isDirectory) {
        loadFileExplorer(item.path);
      } else {
        openFileViewer(item.path);
      }
    });

    container.appendChild(el);
  });
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// 7. Modals: Settings, Change Directory, File Viewer
function initModals() {
  // Settings Modal
  const modalSettings = document.getElementById('modal-settings');
  document.getElementById('btn-open-settings').addEventListener('click', openSettingsModal);
  document.getElementById('btn-close-settings').addEventListener('click', () => closeModal(modalSettings));
  document.getElementById('btn-cancel-settings').addEventListener('click', () => closeModal(modalSettings));
  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);

  // Add custom endpoint button
  document.getElementById('btn-add-custom-endpoint')?.addEventListener('click', () => {
    const container = document.getElementById('custom-endpoints-container');
    if (!container) return;
    
    const index = container.querySelectorAll('.custom-endpoint-row').length;
    const endpointId = 'endpoint_' + Date.now() + '_' + index;
    const endpointDiv = document.createElement('div');
    endpointDiv.className = 'custom-endpoint-row';
    endpointDiv.style.display = 'flex';
    endpointDiv.style.flexDirection = 'column';
    endpointDiv.style.gap = '6px';
    endpointDiv.style.padding = '10px';
    endpointDiv.style.border = '1px solid var(--border-color, #444)';
    endpointDiv.style.borderRadius = '6px';
    endpointDiv.style.background = 'var(--card-bg, #1e1e1e)';
    endpointDiv.dataset.endpointId = endpointId;
    
    endpointDiv.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-weight: 500; color: var(--text-muted, #aaa);">Endpoint ${index + 1}</span>
        <button type="button" class="btn-remove-endpoint" title="Rimuovi endpoint" style="background: none; border: none; color: var(--text-muted, #aaa); cursor: pointer; padding: 4px; font-size: 18px; line-height: 1;">×</button>
      </div>
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <input type="text" class="endpoint-name" placeholder="Nome (es. Mio Server Ollama)" value="" style="flex: 1; min-width: 150px;" />
          <input type="text" class="endpoint-base-url" placeholder="Base URL: es. https://api.openai.com/v1 oppure http://localhost:11434/v1" value="" style="flex: 2; min-width: 200px;" />
        </div>
        <div class="api-key-input-row" style="display: flex; gap: 6px; flex-wrap: wrap;">
          <input type="password" class="endpoint-api-key" placeholder="API Key / Token (opzionale per server locali)" value="" style="flex: 1; min-width: 150px;" />
          <button type="button" class="btn-toggle-key-visibility" title="Mostra/Nascondi" style="padding: 0 12px;">👁️</button>
          <button type="button" class="btn-verify-single-key" data-provider="custom" data-endpoint-id="${endpointId}" title="Verifica endpoint" style="padding: 0 12px;">Verifica</button>
        </div>
      </div>
    `;
    
    container.appendChild(endpointDiv);
    
    // Add event listeners for toggle visibility
    const toggleBtn = endpointDiv.querySelector('.btn-toggle-key-visibility');
    const apiKeyInput = endpointDiv.querySelector('.endpoint-api-key');
    if (toggleBtn && apiKeyInput) {
      toggleBtn.addEventListener('click', () => {
        apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
      });
    }
    
    // Add event listener for remove button
    const removeBtn = endpointDiv.querySelector('.btn-remove-endpoint');
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        endpointDiv.remove();
        updateCustomEndpointFeedback();
      });
    }
    
    updateCustomEndpointFeedback();
  });

  // Directory Pill click -> Switch to Progetti tab and focus input
  const modalDir = document.getElementById('modal-dir');
  document.getElementById('btn-open-dir-modal').addEventListener('click', () => {
    const projTabBtn = document.querySelector('.tab-btn[data-tab="tab-projects"]');
    if (projTabBtn) projTabBtn.click();
    const sidebar = document.getElementById('sidebar');
    if (sidebar && sidebar.classList.contains('collapsed')) {
      sidebar.classList.remove('collapsed');
      if (fitAddon) fitAddon.fit();
      sendResize();
    }
    const input = document.getElementById('input-work-dir');
    if (input) {
      input.focus();
      input.select();
    }
  });
  document.getElementById('btn-close-dir').addEventListener('click', () => closeModal(modalDir));
  document.getElementById('btn-cancel-dir').addEventListener('click', () => closeModal(modalDir));
  document.getElementById('btn-save-dir').addEventListener('click', saveDirChange);

  // File Viewer Modal
  const modalViewer = document.getElementById('modal-file-viewer');
  document.getElementById('btn-close-viewer').addEventListener('click', () => closeModal(modalViewer));
  document.getElementById('btn-copy-path').addEventListener('click', () => {
    if (selectedFilePath) {
      navigator.clipboard.writeText(selectedFilePath);
      const btn = document.getElementById('btn-copy-path');
      btn.textContent = 'Percorso Copiato!';
      setTimeout(() => btn.textContent = 'Copia Percorso', 1500);
    }
  });

  document.getElementById('btn-ask-claude-file').addEventListener('click', () => {
    if (selectedFilePath) {
      closeModal(modalViewer);
      const prompt = `Analizza e descrivi il file ${selectedFilePath}`;
      quickInput.value = prompt;
      quickInput.focus();
    }
  });

  // Close modal when clicking backdrop
  document.querySelectorAll('.modal-backdrop').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeModal(modal);
      }
    });
  });
}

function openModal(el) {
  el.classList.add('show');
}

function closeModal(el) {
  el.classList.remove('show');
}

function renderCustomEndpoints(endpoints) {
  const container = document.getElementById('custom-endpoints-container');
  if (!container) return;
  
  container.innerHTML = '';
  
  endpoints.forEach((endpoint, index) => {
    const endpointId = endpoint.id || 'endpoint_' + Date.now() + '_' + index;
    const endpointDiv = document.createElement('div');
    endpointDiv.className = 'custom-endpoint-row';
    endpointDiv.style.display = 'flex';
    endpointDiv.style.flexDirection = 'column';
    endpointDiv.style.gap = '6px';
    endpointDiv.style.padding = '10px';
    endpointDiv.style.border = '1px solid var(--border-color, #444)';
    endpointDiv.style.borderRadius = '6px';
    endpointDiv.style.background = 'var(--card-bg, #1e1e1e)';
    endpointDiv.dataset.endpointId = endpointId;
    
    endpointDiv.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-weight: 500; color: var(--text-muted, #aaa);">Endpoint ${index + 1}</span>
        <button type="button" class="btn-remove-endpoint" title="Rimuovi endpoint" style="background: none; border: none; color: var(--text-muted, #aaa); cursor: pointer; padding: 4px; font-size: 18px; line-height: 1;">×</button>
      </div>
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <input type="text" class="endpoint-name" placeholder="Nome (es. Mio Server Ollama)" value="${escapeHtml(endpoint.name || '')}" style="flex: 1; min-width: 150px;" />
          <input type="text" class="endpoint-base-url" placeholder="Base URL: es. https://api.openai.com/v1 oppure http://localhost:11434/v1" value="${escapeHtml(endpoint.baseUrl || '')}" style="flex: 2; min-width: 200px;" />
        </div>
        <div class="api-key-input-row" style="display: flex; gap: 6px; flex-wrap: wrap;">
          <input type="password" class="endpoint-api-key" placeholder="${endpoint.hasApiKey ? 'Chiave configurata — lascia vuoto per mantenerla' : 'API Key / Token (opzionale per server locali)'}" value="" style="flex: 1; min-width: 150px;" />
          <button type="button" class="btn-toggle-key-visibility" title="Mostra/Nascondi" style="padding: 0 12px;">👁️</button>
          <button type="button" class="btn-verify-single-key" data-provider="custom" data-endpoint-id="${endpointId}" title="Verifica endpoint" style="padding: 0 12px;">Verifica</button>
        </div>
      </div>
    `;
    
    container.appendChild(endpointDiv);
    
    // Add event listeners for toggle visibility
    const toggleBtn = endpointDiv.querySelector('.btn-toggle-key-visibility');
    const apiKeyInput = endpointDiv.querySelector('.endpoint-api-key');
    if (toggleBtn && apiKeyInput) {
      toggleBtn.addEventListener('click', () => {
        apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
      });
    }
    
    // Add event listener for remove button
    const removeBtn = endpointDiv.querySelector('.btn-remove-endpoint');
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        endpointDiv.remove();
        updateCustomEndpointFeedback();
      });
    }
  });
  
  updateCustomEndpointFeedback();
}

function updateCustomEndpointFeedback() {
  const container = document.getElementById('custom-endpoints-container');
  const feedback = document.getElementById('key-feedback-custom');
  if (!container || !feedback) return;
  
  const count = container.querySelectorAll('.custom-endpoint-row').length;
  if (count === 0) {
    feedback.textContent = 'Nessun endpoint configurato';
    feedback.className = 'key-status-feedback idle';
  } else {
    feedback.textContent = `${count} endpoint${count > 1 ? 'i' : ''} configurato${count > 1 ? 'i' : ''}`;
    feedback.className = 'key-status-feedback valid';
  }
}

async function openSettingsModal() {
  const modal = document.getElementById('modal-settings');
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    document.getElementById('check-dangerously-skip-permissions').checked = false;
    document.getElementById('input-model').value = data.model || '';
    const elInputVision = document.getElementById('input-vision-model');
    if (elInputVision) elInputVision.value = data.visionModel ||
      (data.provider === 'openrouter' ? 'openrouter:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free'
        : data.provider === 'nvidia' ? 'nvidia:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning'
          : (data.model || ''));
    const elInputCoder = document.getElementById('input-coder-model');
    if (elInputCoder) elInputCoder.value = data.coderModel || '';
    document.getElementById('input-base-url').value = data.baseUrl || '';
    const eff = data.effort || 'high';
    document.getElementById('select-effort').value = eff;
    const elChatEffort = document.getElementById('chat-effort-select');
    if (elChatEffort) elChatEffort.value = eff;
    document.getElementById('select-provider').value = data.provider || 'anthropic';
    const elEngine = document.getElementById('select-engine');
    if (elEngine) elEngine.value = data.engine || 'claude';
    loadLocalModelOptions();

    // Carica campi separati chiavi API
    const provKeys = ['openrouter', 'nvidia', 'ashna', 'cerebras', 'openai', 'deepseek', 'gemini', 'groq', 'mistral', 'anthropic', 'custom'];
    provKeys.forEach(p => {
      const inp = document.getElementById(`input-key-${p}`);
      if (inp) {
        inp.value = '';
        inp.placeholder = data.configuredProviders && data.configuredProviders[p]
          ? 'Chiave configurata — lascia vuoto per mantenerla'
          : 'API Key';
      }
    });
    const elCustomBase = document.getElementById('input-base-url-custom');
    if (elCustomBase) {
      elCustomBase.value = data.customBaseUrl || data.baseUrl || '';
    }
    // Render custom endpoints
    renderCustomEndpoints(data.customEndpoints || []);

    // Campi legacy per retrocompatibilita'
    const elLegacyAuth = document.getElementById('input-auth-token');
    if (elLegacyAuth) {
      elLegacyAuth.value = '';
      elLegacyAuth.placeholder = data.hasAuthToken ? 'Token configurato' : 'Token';
    }
    const elLegacyApi = document.getElementById('input-api-key');
    if (elLegacyApi) {
      elLegacyApi.value = '';
      elLegacyApi.placeholder = data.configuredProviders && data.configuredProviders.anthropic
        ? 'Chiave configurata'
        : 'API Key';
    }

    updateProviderHint();

    // Recupera lo stato attuale dei provider e modelli per aggiornare badge di feedback
    fetch('/api/available-models')
      .then(r => r.json())
      .then(modelData => {
        if (modelData && modelData.providerStatus) {
          updateAllKeyFeedbacks(modelData.providerStatus);
        }
      })
      .catch(() => {});

    document.getElementById('check-auto-accept-folder').checked = !!data.autoAcceptFolder;
    document.getElementById('check-flat-ui-mode').checked = !!data.flatUiMode;
    document.getElementById('check-auto-continue').checked = data.autoContinue !== false;
    document.getElementById('check-auto-verify').checked = data.autoVerify !== false;
    document.getElementById('input-test-command').value = data.projectTestCommand || '';
  } catch (e) {}
  openModal(modal);
}

async function saveSettings() {
  const skipPerms = false;
  const fontSize = document.getElementById('select-font-size').value;
  const model = document.getElementById('input-model').value;
  const elInputVision = document.getElementById('input-vision-model');
  const visionModel = elInputVision ? elInputVision.value.trim() : '';
  const elInputCoder = document.getElementById('input-coder-model');
  const coderModel = elInputCoder ? elInputCoder.value : '';
  const baseUrl = document.getElementById('input-base-url').value;
  const provider = document.getElementById('select-provider').value;
  const elSelectEngine = document.getElementById('select-engine');
  const engine = elSelectEngine ? elSelectEngine.value : 'claude';
  const effort = document.getElementById('select-effort').value;
  const autoAcceptFolder = document.getElementById('check-auto-accept-folder').checked;
  const flatUiMode = document.getElementById('check-flat-ui-mode').checked;
  const autoContinue = document.getElementById('check-auto-continue').checked;
  const autoVerify = document.getElementById('check-auto-verify').checked;
  const projectTestCommand = document.getElementById('input-test-command').value;

  // Raccogli tutte le chiavi separate
  const apiKeys = {
    openrouter: (document.getElementById('input-key-openrouter')?.value || '').trim(),
    nvidia: (document.getElementById('input-key-nvidia')?.value || '').trim(),
    ashna: (document.getElementById('input-key-ashna')?.value || '').trim(),
    cerebras: (document.getElementById('input-key-cerebras')?.value || '').trim(),
    openai: (document.getElementById('input-key-openai')?.value || '').trim(),
    deepseek: (document.getElementById('input-key-deepseek')?.value || '').trim(),
    gemini: (document.getElementById('input-key-gemini')?.value || '').trim(),
    groq: (document.getElementById('input-key-groq')?.value || '').trim(),
    mistral: (document.getElementById('input-key-mistral')?.value || '').trim(),
    anthropic: (document.getElementById('input-key-anthropic')?.value || '').trim(),
    custom: (document.getElementById('input-key-custom')?.value || '').trim()
  };
  
  // Collect custom endpoints
  const customEndpoints = [];
  const container = document.getElementById('custom-endpoints-container');
  if (container) {
    container.querySelectorAll('.custom-endpoint-row').forEach((row, index) => {
      const name = row.querySelector('.endpoint-name')?.value?.trim() || `Endpoint ${index + 1}`;
      const baseUrl = row.querySelector('.endpoint-base-url')?.value?.trim() || '';
      const apiKey = row.querySelector('.endpoint-api-key')?.value?.trim() || '';
      if (baseUrl) {
        customEndpoints.push({
          id: row.dataset.endpointId || 'endpoint_' + Date.now() + '_' + index,
          name: name,
          baseUrl: baseUrl,
          apiKey: apiKey
        });
      }
    });
  }
  
  const customBaseUrl = (document.getElementById('input-base-url-custom')?.value || '').trim();

  // Campi legacy di compatibilita'
  const legacyAuth = apiKeys.openrouter || apiKeys.cerebras || apiKeys.nvidia || apiKeys.ashna || apiKeys.openai || apiKeys.deepseek || apiKeys.gemini || apiKeys.groq || apiKeys.mistral || apiKeys.custom || '';
  const elAuthTok = document.getElementById('input-auth-token');
  if (elAuthTok) elAuthTok.value = legacyAuth;
  const elApiKey = document.getElementById('input-api-key');
  if (elApiKey) elApiKey.value = apiKeys.anthropic;

  try {
    const payload = {
      dangerouslySkipPermissions: skipPerms,
      fontSize: Number(fontSize),
      model: model.trim(),
      visionModel: visionModel,
      coderModel: coderModel.trim(),
      baseUrl: baseUrl.trim(),
      provider: provider,
      engine: engine,
      effort: effort,
      authToken: legacyAuth,
      apiKeys: apiKeys,
      customBaseUrl: customBaseUrl,
      customEndpoints: customEndpoints,
      autoAcceptFolder: autoAcceptFolder,
      flatUiMode: flatUiMode,
      autoContinue: autoContinue,
      autoVerify: autoVerify,
      projectTestCommand: projectTestCommand.trim()
    };
    if (apiKeys.anthropic) {
      payload.apiKey = apiKeys.anthropic;
    }

    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data.success) {
      currentFontSize = Number(fontSize);
      updateFontSize(currentFontSize);
      const elChatEffort = document.getElementById('chat-effort-select');
      if (elChatEffort) elChatEffort.value = effort;
      if (window.ChatUI && typeof window.ChatUI.refreshModels === 'function') {
        window.ChatUI.refreshModels();
      }
      closeModal(document.getElementById('modal-settings'));
    }
  } catch (err) {
    alert('Errore salvataggio impostazioni: ' + err.message);
  }
}

async function openDirModal() {
  const modal = document.getElementById('modal-dir');
  document.getElementById('input-target-dir').value = currentWorkingDir;

  // Load shortcuts
  const shortcutsContainer = document.getElementById('shortcut-chips-container');
  shortcutsContainer.innerHTML = '';
  try {
    const res = await fetch('/api/shortcuts');
    const shortcuts = await res.json();
    shortcuts.forEach(s => {
      const chip = document.createElement('button');
      chip.className = 'shortcut-chip';
      chip.textContent = `${s.name}`;
      chip.title = s.path;
      chip.onclick = () => {
        document.getElementById('input-target-dir').value = s.path;
      };
      shortcutsContainer.appendChild(chip);
    });
  } catch (e) {}

  openModal(modal);
}

async function saveDirChange() {
  const targetDir = document.getElementById('input-target-dir').value.trim();
  if (!targetDir) {
    alert('Inserisci un percorso valido.');
    return;
  }

  try {
    const res = await fetch('/api/change-dir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir: targetDir })
    });
    const data = await res.json();
    if (data.success) {
      setWorkingDir(data.cwd);
      currentExplorerDir = data.cwd;
      loadFileExplorer(data.cwd);
      closeModal(document.getElementById('modal-dir'));
    } else {
      alert('Errore: ' + (data.error || 'Cartella non valida'));
    }
  } catch (err) {
    alert('Errore connessione: ' + err.message);
  }
}

async function openFileViewer(filePath) {
  selectedFilePath = filePath;
  const modal = document.getElementById('modal-file-viewer');
  const filenameEl = document.getElementById('viewer-filename');
  const filesizeEl = document.getElementById('viewer-filesize');
  const pathEl = document.getElementById('viewer-filepath');
  const codeEl = document.getElementById('viewer-code-content');

  filenameEl.textContent = filePath.split(/[\\/]/).pop();
  pathEl.textContent = filePath;
  codeEl.textContent = 'Caricamento in corso...';
  openModal(modal);

  try {
    const res = await fetch(`/api/file-content?path=${encodeURIComponent(filePath)}`);
    const data = await res.json();

    if (data.error) {
      codeEl.textContent = `Impossibile caricare il file:\n${data.error}`;
      return;
    }

    filesizeEl.textContent = formatBytes(data.size);
    codeEl.textContent = data.content;
  } catch (err) {
    codeEl.textContent = `Errore di rete:\n${err.message}`;
  }
}

function applyConfigState(config) {
  if (config.fontSize) {
    currentFontSize = config.fontSize;
    document.getElementById('select-font-size').value = String(config.fontSize);
    updateFontSize(currentFontSize);
  }
}

async function fetchInitialStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    updateStatus(data.running);
    if (data.cwd) setWorkingDir(data.cwd);
  } catch (e) {}
}

// 8. Projects & Working Directory Management
function initProjectsSection() {
  const inputWorkDir = document.getElementById('input-work-dir');
  const btnBrowseFolder = document.getElementById('btn-browse-folder');
  const btnApplyWorkDir = document.getElementById('btn-apply-work-dir');
  const btnSaveCurrentAsProject = document.getElementById('btn-save-current-as-project');

  const btnToggleNewProject = document.getElementById('btn-toggle-new-project');
  const newProjectForm = document.getElementById('new-project-form');
  const newProjName = document.getElementById('new-proj-name');
  const newProjPath = document.getElementById('new-proj-path');
  const btnBrowseNewProj = document.getElementById('btn-browse-new-proj');
  const btnCancelNewProj = document.getElementById('btn-cancel-new-proj');
  const btnConfirmAddProj = document.getElementById('btn-confirm-add-proj');

  // Apply working directory
  if (btnApplyWorkDir && inputWorkDir) {
    btnApplyWorkDir.addEventListener('click', () => {
      applyNewWorkDir(inputWorkDir.value.trim());
    });

    inputWorkDir.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        applyNewWorkDir(inputWorkDir.value.trim());
      }
    });
  }

  // Browse folder using native Windows dialog
  if (btnBrowseFolder && inputWorkDir) {
    btnBrowseFolder.addEventListener('click', () => {
      browseFolderForInput(inputWorkDir, btnBrowseFolder);
    });
  }

  // Save current directory as a project
  if (btnSaveCurrentAsProject) {
    btnSaveCurrentAsProject.addEventListener('click', () => {
      saveCurrentDirAsProject();
    });
  }

  // New project form toggle
  if (btnToggleNewProject && newProjectForm) {
    btnToggleNewProject.addEventListener('click', () => {
      newProjectForm.classList.toggle('hidden');
      if (!newProjectForm.classList.contains('hidden')) {
        newProjName.focus();
        if (!newProjPath.value) {
          newProjPath.value = currentWorkingDir || '';
        }
      }
    });
  }

  if (btnCancelNewProj && newProjectForm) {
    btnCancelNewProj.addEventListener('click', () => {
      newProjectForm.classList.add('hidden');
      newProjName.value = '';
      newProjPath.value = '';
    });
  }

  if (btnBrowseNewProj && newProjPath) {
    btnBrowseNewProj.addEventListener('click', () => {
      browseFolderForInput(newProjPath, btnBrowseNewProj);
    });
  }

  if (btnConfirmAddProj) {
    btnConfirmAddProj.addEventListener('click', () => {
      confirmAddNewProject();
    });
  }

  // Initial load
  loadProjectsData();
  loadShortcutsData();
}

async function loadProjectsData() {
  const container = document.getElementById('saved-projects-list');
  const recentContainer = document.getElementById('recent-dirs-list');

  try {
    const res = await fetch('/api/projects');
    const data = await res.json();

    if (data.currentDir && !currentWorkingDir) {
      setWorkingDir(data.currentDir);
    }

    renderSavedProjects(data.projects || [], container);
    renderRecentDirs(data.recentDirs || [], recentContainer);
  } catch (err) {
    if (container) {
      container.innerHTML = `<div style="color: #ef4444; font-size: 11px;">Errore caricamento progetti</div>`;
    }
  }
}

function updateActiveProjectCards(activeDir) {
  const cards = document.querySelectorAll('.project-card');
  const normalizedActive = (activeDir || '').toLowerCase().replace(/\\/g, '/');

  cards.forEach(card => {
    const cardPath = (card.dataset.path || '').toLowerCase().replace(/\\/g, '/');
    if (cardPath === normalizedActive) {
      card.classList.add('is-active');
      const badge = card.querySelector('.badge-active');
      if (!badge) {
        const header = card.querySelector('.project-card-header');
        const newBadge = document.createElement('span');
        newBadge.className = 'badge-active';
        newBadge.textContent = 'In Uso';
        if (header) header.appendChild(newBadge);
      }
    } else {
      card.classList.remove('is-active');
      const badge = card.querySelector('.badge-active');
      if (badge) badge.remove();
    }
  });
}

function renderSavedProjects(projects, container) {
  if (!container) return;
  container.innerHTML = '';

  if (!projects || projects.length === 0) {
    container.innerHTML = '<div style="color: #6b7280; font-size: 11px; padding: 4px;">Nessun progetto salvato. Aggiungine uno con il pulsante sopra!</div>';
    return;
  }

  const normalizedActive = (currentWorkingDir || '').toLowerCase().replace(/\\/g, '/');

  projects.forEach(p => {
    const card = document.createElement('div');
    const normalizedProjPath = (p.path || '').toLowerCase().replace(/\\/g, '/');
    const isActive = normalizedProjPath === normalizedActive;

    card.className = `project-card ${isActive ? 'is-active' : ''}`;
    card.dataset.path = p.path;
    card.dataset.id = p.id;

    card.innerHTML = `
      <div class="project-card-header">
        <div class="project-card-title" title="${escapeHtml(p.name)}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
          <span>${escapeHtml(p.name)}</span>
        </div>
        ${isActive ? '<span class="badge-active">In Uso</span>' : ''}
      </div>
      <div class="project-card-path" title="${escapeHtml(p.path)}">${escapeHtml(p.path)}</div>
      <div class="project-card-actions">
        <button class="btn-action-xs btn-open-proj" title="Imposta come cartella di lavoro e riavvia Adam">Apri</button>
        <button class="btn-action-xs btn-explore-proj" title="Esplora file di questa cartella">File</button>
        <button class="btn-action-xs btn-danger-xs btn-delete-proj" title="Rimuovi progetto dall'elenco">✕</button>
      </div>
    `;

    card.querySelector('.btn-open-proj').addEventListener('click', (e) => {
      e.stopPropagation();
      applyNewWorkDir(p.path);
    });

    card.querySelector('.btn-explore-proj').addEventListener('click', (e) => {
      e.stopPropagation();
      const tabFilesBtn = document.querySelector('.tab-btn[data-tab="tab-files"]');
      if (tabFilesBtn) tabFilesBtn.click();
      loadFileExplorer(p.path);
    });

    card.querySelector('.btn-delete-proj').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`Rimuovere il progetto "${p.name}" dall'elenco salvato?`)) {
        try {
          const res = await fetch(`/api/projects/${encodeURIComponent(p.id)}`, { method: 'DELETE' });
          const data = await res.json();
          if (data.success) {
            renderSavedProjects(data.projects, container);
          }
        } catch (err) {
          alert('Errore durante la cancellazione: ' + err.message);
        }
      }
    });

    card.addEventListener('click', () => {
      const inputWorkDir = document.getElementById('input-work-dir');
      if (inputWorkDir) {
        inputWorkDir.value = p.path;
      }
    });

    container.appendChild(card);
  });
}

function renderRecentDirs(dirs, container) {
  if (!container) return;
  container.innerHTML = '';

  const validDirs = (dirs || []).filter(d => d && d.toLowerCase() !== (currentWorkingDir || '').toLowerCase());
  if (validDirs.length === 0) {
    container.innerHTML = '<div style="color: #6b7280; font-size: 11px; padding: 4px;">Nessuna cartella recente alternativa</div>';
    return;
  }

  validDirs.forEach(dir => {
    const item = document.createElement('div');
    item.className = 'recent-dir-item';
    item.title = dir;
    item.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
      </svg>
      <span class="recent-dir-path">${escapeHtml(dir)}</span>
    `;

    item.addEventListener('click', () => {
      const inputWorkDir = document.getElementById('input-work-dir');
      if (inputWorkDir) inputWorkDir.value = dir;
      applyNewWorkDir(dir);
    });

    container.appendChild(item);
  });
}

async function loadShortcutsData() {
  const container = document.getElementById('quick-shortcuts-list');
  if (!container) return;

  try {
    const res = await fetch('/api/shortcuts');
    const shortcuts = await res.json();
    container.innerHTML = '';

    shortcuts.forEach(s => {
      const chip = document.createElement('button');
      chip.className = 'shortcut-chip';
      chip.type = 'button';
      chip.textContent = s.name;
      chip.title = s.path;
      chip.addEventListener('click', () => {
        const inputWorkDir = document.getElementById('input-work-dir');
        if (inputWorkDir) inputWorkDir.value = s.path;
      });
      container.appendChild(chip);
    });
  } catch (e) {}
}

async function applyNewWorkDir(newDir) {
  if (!newDir) {
    alert('Inserisci un percorso cartella valido.');
    return;
  }

  const btnApply = document.getElementById('btn-apply-work-dir');
  const originalText = btnApply ? btnApply.innerHTML : '';
  if (btnApply) {
    btnApply.disabled = true;
    btnApply.innerHTML = '<span>Avvio in corso...</span>';
  }

  try {
    const res = await fetch('/api/change-dir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir: newDir })
    });
    const data = await res.json();

    if (data.success) {
      setWorkingDir(data.cwd);
      currentExplorerDir = data.cwd;
      loadFileExplorer(data.cwd);
      loadProjectsData();
      refreshMemoryData();
      if (term) term.focus();
    } else {
      alert('Errore: ' + (data.error || 'Cartella non trovata o non accessibile'));
    }
  } catch (err) {
    alert('Errore di connessione al server: ' + err.message);
  } finally {
    if (btnApply) {
      btnApply.disabled = false;
      btnApply.innerHTML = originalText;
    }
  }
}

async function browseFolderForInput(targetInput, triggerBtn) {
  const originalHtml = triggerBtn ? triggerBtn.innerHTML : '';
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.innerHTML = '<span>Sfoglia...</span>';
  }

  try {
    const res = await fetch('/api/browse-folder', { method: 'POST' });
    const data = await res.json();

    if (data.success && data.path) {
      targetInput.value = data.path;
      targetInput.focus();
    }
  } catch (err) {
    console.error('Browse folder error:', err);
  } finally {
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.innerHTML = originalHtml;
    }
  }
}

async function saveCurrentDirAsProject() {
  const defaultName = currentWorkingDir ? currentWorkingDir.split(/[\\/]/).filter(Boolean).pop() : 'Mio Progetto';
  const name = prompt('Inserisci il nome per questo progetto:', defaultName);
  if (!name) return;

  try {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), path: currentWorkingDir })
    });
    const data = await res.json();

    if (data.success) {
      loadProjectsData();
    } else {
      alert('Errore: ' + (data.error || 'Impossibile salvare il progetto'));
    }
  } catch (err) {
    alert('Errore salvataggio progetto: ' + err.message);
  }
}

async function confirmAddNewProject() {
  const nameInput = document.getElementById('new-proj-name');
  const pathInput = document.getElementById('new-proj-path');
  const name = nameInput.value.trim();
  const projPath = pathInput.value.trim();

  if (!projPath) {
    alert('Inserisci il percorso della cartella.');
    pathInput.focus();
    return;
  }

  try {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name || projPath, path: projPath })
    });
    const data = await res.json();

    if (data.success) {
      nameInput.value = '';
      pathInput.value = '';
      document.getElementById('new-project-form').classList.add('hidden');
      loadProjectsData();
    } else {
      alert('Errore: ' + (data.error || 'Cartella non valida o inesistente'));
    }
  } catch (err) {
    alert('Errore: ' + err.message);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, function (m) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[m];
  });
}

// ============================================================
// 9. Neural Brain Visualizer & Memory Management
// ============================================================
let neuralVisualizer = null;
let currentMemoryGraph = null;
let activeSelectedNeuron = null;

function initNeuralBrain() {
  const container = document.getElementById('neural-canvas-container');
  if (container && window.NeuralBrainVisualizer) {
    neuralVisualizer = new NeuralBrainVisualizer('neural-canvas-container', {
      onNodeSelect: handleNeuronSelect
    });
  }

  // Open Full-Screen Brain View button (topbar & memory tab)
  const btnOpenBrain = document.getElementById('btn-open-brain-view');
  const btnOpenBrainFull = document.getElementById('btn-open-brain-full');
  const brainModal = document.getElementById('brain-view-modal');
  const btnCloseBrain = document.getElementById('btn-close-brain-view');

  const openBrainView = () => {
    if (brainModal) {
      brainModal.classList.add('show');
      refreshMemoryData();
      setTimeout(() => {
        if (neuralVisualizer) {
          neuralVisualizer.initCanvasSize();
          neuralVisualizer.resetView();
        }
      }, 100);
    }
  };

  if (btnOpenBrain) btnOpenBrain.addEventListener('click', openBrainView);
  if (btnOpenBrainFull) btnOpenBrainFull.addEventListener('click', openBrainView);
  if (btnCloseBrain) {
    btnCloseBrain.addEventListener('click', () => {
      if (brainModal) brainModal.classList.remove('show');
    });
  }

  // Scope filter pills in Brain View
  document.querySelectorAll('.scope-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.scope-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const scope = btn.dataset.scope;
      if (neuralVisualizer) neuralVisualizer.setFilters({ scopeFilter: scope });
    });
  });

  // Type filter chips in Brain View
  document.querySelectorAll('.type-filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.type-filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const type = chip.dataset.type;
      if (neuralVisualizer) neuralVisualizer.setFilters({ typeFilter: type });
    });
  });

  // Search input in Brain View
  const searchInput = document.getElementById('brain-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      if (neuralVisualizer) neuralVisualizer.setFilters({ searchQuery: e.target.value });
    });
  }

  // Center button
  const btnCenter = document.getElementById('btn-brain-center');
  if (btnCenter) {
    btnCenter.addEventListener('click', () => {
      if (neuralVisualizer) neuralVisualizer.resetView();
    });
  }

  // Add Node button in Brain View
  const btnAddNode = document.getElementById('btn-brain-add-node');
  if (btnAddNode) {
    btnAddNode.addEventListener('click', () => {
      const label = prompt('Titolo o Nome del nuovo neurone:');
      if (!label || !label.trim()) return;
      const type = prompt('Tipo (variable, step, data, rule, goal):', 'variable');
      const isProject = confirm('Salvare nella Memoria di Progetto?\n[OK = Progetto, ANNULLA = Memoria Globale]');
      const value = prompt('Valore o contenuto:', '');

      createNeuronNode({
        scope: isProject ? 'project' : 'global',
        type: type || 'data',
        label: label.trim(),
        value: value || '',
        tags: []
      });
    });
  }

  // Inspector Drawer controls
  const btnCloseInsp = document.getElementById('btn-close-inspector');
  const inspDrawer = document.getElementById('neuron-inspector');
  if (btnCloseInsp && inspDrawer) {
    btnCloseInsp.addEventListener('click', () => {
      inspDrawer.classList.add('hidden');
    });
  }

  // Save inspector changes
  const btnSaveInsp = document.getElementById('btn-save-inspector');
  if (btnSaveInsp) {
    btnSaveInsp.addEventListener('click', saveInspectorChanges);
  }

  // Delete neuron
  const btnDeleteNeuron = document.getElementById('btn-delete-neuron');
  if (btnDeleteNeuron) {
    btnDeleteNeuron.addEventListener('click', deleteActiveNeuron);
  }

  // Add Synapse toggle
  const btnToggleSyn = document.getElementById('btn-toggle-add-synapse');
  const addSynBox = document.getElementById('add-synapse-box');
  const btnCancelSyn = document.getElementById('btn-cancel-synapse');
  const btnConfirmSyn = document.getElementById('btn-confirm-add-synapse');

  if (btnToggleSyn && addSynBox) {
    btnToggleSyn.addEventListener('click', () => {
      addSynBox.classList.toggle('hidden');
    });
  }
  if (btnCancelSyn && addSynBox) {
    btnCancelSyn.addEventListener('click', () => {
      addSynBox.classList.add('hidden');
    });
  }
  if (btnConfirmSyn) {
    btnConfirmSyn.addEventListener('click', confirmAddSynapse);
  }

  // Initial load
  refreshMemoryData();
}

async function refreshMemoryData(animare = false) {
  try {
    const res = await fetch('/api/memory');
    const data = await res.json();
    if (!data.success) return;

    currentMemoryGraph = data;

    if (neuralVisualizer) {
      neuralVisualizer.setData(data);
    }

    // Update counters
    const totalNodes = (data.nodes || []).length;
    const totalEdges = (data.edges || []).length;
    const projNodes = (data.project?.nodes || []).length;
    const globNodes = (data.global?.nodes || []).length;

    const countBadge = document.getElementById('header-neuron-count');
    if (countBadge) {
      const prevTotal = parseInt(countBadge.textContent || '0', 10);
      countBadge.textContent = String(totalNodes);
      if (animare || totalNodes > prevTotal) {
        countBadge.classList.remove('badge-pulse');
        void countBadge.offsetWidth;
        countBadge.classList.add('badge-pulse');
      }
    }

    const statTotal = document.getElementById('stat-total-neurons');
    if (statTotal) statTotal.textContent = String(totalNodes);

    const statSyn = document.getElementById('stat-total-synapses');
    if (statSyn) statSyn.textContent = String(totalEdges);

    const statProj = document.getElementById('stat-proj-neurons');
    if (statProj) {
      const prevProj = parseInt(statProj.textContent || '0', 10);
      statProj.textContent = String(projNodes);
      if (animare || projNodes > prevProj) {
        statProj.style.transition = 'color 0.3s ease';
        statProj.style.color = '#10b981';
        setTimeout(() => { statProj.style.color = ''; }, 1200);
      }
    }

    const statGlob = document.getElementById('stat-glob-neurons');
    if (statGlob) statGlob.textContent = String(globNodes);

    const projLabel = document.getElementById('brain-project-label');
    if (projLabel && data.project?.projectName) {
      projLabel.textContent = `Progetto: ${data.project.projectName}`;
    }

    // Render sidebar lists in Tab Memoria
    renderSidebarNeuronsList(data.project?.nodes || [], document.getElementById('sidebar-project-neurons-list'));
    renderSidebarNeuronsList(data.global?.nodes || [], document.getElementById('sidebar-global-neurons-list'));
  } catch (err) {
    console.error('Error refreshing memory:', err);
  }
}

function renderSidebarNeuronsList(nodes, container) {
  if (!container) return;
  container.innerHTML = '';

  if (!nodes || nodes.length === 0) {
    container.innerHTML = '<div style="color: #6b7280; font-size: 11px; padding: 4px;">Nessun neurone memorizzato</div>';
    return;
  }

  const categoryColors = {
    variable: '#10b981',
    step: '#06b6d4',
    data: '#f59e0b',
    rule: '#a855f7',
    goal: '#e07a5f'
  };

  nodes.forEach(node => {
    const item = document.createElement('div');
    item.className = 'neuron-sidebar-item';
    item.title = `${node.label} (${node.value || ''})`;

    const color = categoryColors[node.type] || '#9ca3af';

    item.innerHTML = `
      <div class="neuron-item-info">
        <span class="neuron-item-dot" style="background-color: ${color}; box-shadow: 0 0 6px ${color};"></span>
        <span class="neuron-item-label">${escapeHtml(node.label)}</span>
      </div>
      <span class="neuron-item-type-badge">${escapeHtml(node.type)}</span>
    `;

    item.addEventListener('click', () => {
      const btnOpenBrain = document.getElementById('btn-open-brain-view');
      if (btnOpenBrain) btnOpenBrain.click();
      setTimeout(() => {
        if (neuralVisualizer) {
          neuralVisualizer.focusNode(node.id);
        }
      }, 150);
    });

    container.appendChild(item);
  });
}

function handleNeuronSelect(node) {
  activeSelectedNeuron = node;
  const insp = document.getElementById('neuron-inspector');
  if (!insp) return;

  insp.classList.remove('hidden');

  // Badge scope
  const badgeScope = document.getElementById('insp-scope-badge');
  badgeScope.textContent = (node.scope || 'project').toUpperCase();
  badgeScope.className = `inspector-badge-scope ${node.scope === 'global' ? 'global' : ''}`;

  // Badge type
  const badgeType = document.getElementById('insp-type-badge');
  badgeType.textContent = (node.type || 'data').toUpperCase();

  // Inputs
  document.getElementById('insp-input-label').value = node.label || '';
  document.getElementById('insp-input-value').value = node.value || '';
  document.getElementById('insp-input-tags').value = (node.tags || []).join(', ');

  // Synapses list
  renderInspectorSynapses(node);
  populateSynapseTargetSelect(node);
}

function renderInspectorSynapses(node) {
  const container = document.getElementById('insp-synapses-list');
  const countEl = document.getElementById('insp-synapses-count');
  if (!container) return;

  container.innerHTML = '';
  const synapses = node.synapses || [];
  if (countEl) countEl.textContent = String(synapses.length);

  if (synapses.length === 0) {
    container.innerHTML = '<div style="color: #6b7280; font-size: 11px; padding: 4px;">Nessun collegamento sinaptico attivo</div>';
    return;
  }

  synapses.forEach(syn => {
    const targetNode = currentMemoryGraph?.nodes?.find(n => n.id === syn.targetId);
    const targetLabel = targetNode ? targetNode.label : syn.targetId;

    const chip = document.createElement('div');
    chip.className = 'synapse-chip';
    chip.innerHTML = `
      <div style="display: flex; align-items: center; gap: 4px; overflow: hidden;">
        <span style="color: #e07a5f;">➜</span>
        <span class="synapse-chip-label" title="${escapeHtml(targetLabel)}">${escapeHtml(targetLabel)}</span>
        <span class="synapse-chip-rel">(${escapeHtml(syn.label || 'collegato')})</span>
      </div>
      <button class="synapse-del-btn" title="Rimuovi sinapsi">&times;</button>
    `;

    chip.addEventListener('click', (e) => {
      if (e.target.closest('.synapse-del-btn')) {
        e.stopPropagation();
        removeSynapse(node.id, syn.targetId);
      } else {
        if (neuralVisualizer) neuralVisualizer.focusNode(syn.targetId);
      }
    });

    container.appendChild(chip);
  });
}

function populateSynapseTargetSelect(currentNode) {
  const select = document.getElementById('select-synapse-target');
  if (!select || !currentMemoryGraph) return;

  select.innerHTML = '<option value="">-- Seleziona neurone da collegare --</option>';
  const existingTargets = new Set((currentNode.synapses || []).map(s => s.targetId));

  (currentMemoryGraph.nodes || []).forEach(n => {
    if (n.id !== currentNode.id && !existingTargets.has(n.id)) {
      const opt = document.createElement('option');
      opt.value = n.id;
      opt.textContent = `[${n.scope.toUpperCase()}] ${n.label} (${n.type})`;
      select.appendChild(opt);
    }
  });
}

async function saveInspectorChanges() {
  if (!activeSelectedNeuron) return;

  const label = document.getElementById('insp-input-label').value.trim();
  const value = document.getElementById('insp-input-value').value;
  const tagsStr = document.getElementById('insp-input-tags').value;

  if (!label) {
    alert('Il titolo del neurone è obbligatorio.');
    return;
  }

  const tags = tagsStr.split(',').map(t => t.trim()).filter(Boolean);

  try {
    const res = await fetch('/api/memory/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: activeSelectedNeuron.id,
        scope: activeSelectedNeuron.scope,
        type: activeSelectedNeuron.type,
        label,
        value,
        tags,
        synapses: activeSelectedNeuron.synapses || []
      })
    });
    const data = await res.json();
    if (data.success) {
      activeSelectedNeuron.label = label;
      activeSelectedNeuron.value = value;
      activeSelectedNeuron.tags = tags;
      refreshMemoryData();
      alert('Neurone aggiornato con successo!');
    }
  } catch (err) {
    alert('Errore salvataggio neurone: ' + err.message);
  }
}

async function deleteActiveNeuron() {
  if (!activeSelectedNeuron) return;
  if (!confirm(`Vuoi davvero eliminare il neurone "${activeSelectedNeuron.label}" e tutte le sue sinapsi?`)) return;

  try {
    const res = await fetch(`/api/memory/node/${encodeURIComponent(activeSelectedNeuron.id)}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.success) {
      document.getElementById('neuron-inspector').classList.add('hidden');
      activeSelectedNeuron = null;
      refreshMemoryData();
    }
  } catch (err) {
    alert('Errore eliminazione neurone: ' + err.message);
  }
}

async function confirmAddSynapse() {
  if (!activeSelectedNeuron) return;
  const select = document.getElementById('select-synapse-target');
  const targetId = select.value;
  const labelInput = document.getElementById('input-synapse-label');
  const label = labelInput.value.trim() || 'collegato';

  if (!targetId) {
    alert('Seleziona un neurone di destinazione.');
    return;
  }

  try {
    const res = await fetch('/api/memory/synapse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceId: activeSelectedNeuron.id,
        targetId,
        label,
        strength: 1.0
      })
    });
    const data = await res.json();
    if (data.success) {
      document.getElementById('add-synapse-box').classList.add('hidden');
      labelInput.value = '';
      refreshMemoryData();
      setTimeout(() => {
        const updated = currentMemoryGraph?.nodes?.find(n => n.id === activeSelectedNeuron.id);
        if (updated) handleNeuronSelect(updated);
      }, 100);
    }
  } catch (err) {
    alert('Errore creazione sinapsi: ' + err.message);
  }
}

async function removeSynapse(sourceId, targetId) {
  try {
    const res = await fetch('/api/memory/synapse', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId, targetId })
    });
    const data = await res.json();
    if (data.success) {
      refreshMemoryData();
      setTimeout(() => {
        const updated = currentMemoryGraph?.nodes?.find(n => n.id === sourceId);
        if (updated) handleNeuronSelect(updated);
      }, 100);
    }
  } catch (err) {
    alert('Errore rimozione sinapsi: ' + err.message);
  }
}

async function createNeuronNode({ scope, type, label, value, tags }) {
  try {
    const res = await fetch('/api/memory/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope, type, label, value, tags })
    });
    const data = await res.json();
    if (data.success) {
      refreshMemoryData();
      return data.node;
    }
  } catch (err) {
    alert('Errore creazione neurone: ' + err.message);
  }
  return null;
}

// ============================================================
// 10. Memory Sidebar Tab Form Management
// ============================================================
function initMemoryTab() {
  const btnToggleForm = document.getElementById('btn-toggle-add-memory');
  const form = document.getElementById('quick-memory-form');
  const btnCancel = document.getElementById('btn-cancel-memory-form');
  const btnSave = document.getElementById('btn-save-memory-item');

  if (btnToggleForm && form) {
    btnToggleForm.addEventListener('click', () => {
      form.classList.toggle('hidden');
      btnToggleForm.textContent = form.classList.contains('hidden') ? 'Apri Form' : 'Chiudi Form';
    });
  }

  if (btnCancel && form) {
    btnCancel.addEventListener('click', () => {
      form.classList.add('hidden');
      if (btnToggleForm) btnToggleForm.textContent = 'Apri Form';
    });
  }

  if (btnSave) {
    btnSave.addEventListener('click', async () => {
      const scope = document.getElementById('mem-input-scope').value;
      const type = document.getElementById('mem-input-type').value;
      const label = document.getElementById('mem-input-label').value.trim();
      const value = document.getElementById('mem-input-value').value.trim();
      const tags = document.getElementById('mem-input-tags').value.split(',').map(t => t.trim()).filter(Boolean);

      if (!label) {
        alert('Inserisci un titolo o identificatore per questo elemento di memoria.');
        return;
      }

      btnSave.disabled = true;
      btnSave.textContent = 'Salvataggio...';

      const node = await createNeuronNode({ scope, type, label, value, tags });
      btnSave.disabled = false;
      btnSave.textContent = 'Crea Neurone';

      if (node) {
        document.getElementById('mem-input-label').value = '';
        document.getElementById('mem-input-value').value = '';
        document.getElementById('mem-input-tags').value = '';
        form.classList.add('hidden');
        if (btnToggleForm) btnToggleForm.textContent = 'Apri Form';
        alert(`Neurone "${label}" memorizzato con successo nella memoria ${scope === 'global' ? 'Globale' : 'di Progetto'}!`);
      }
    });
  }
}

// ============================================================
// 11. Web & Network Access Modal Management
// ============================================================
function initNetworkModal() {
  const btnOpen = document.getElementById('btn-open-network');
  const modal = document.getElementById('modal-network');
  const btnClose = document.getElementById('btn-close-network');
  const btnDismiss = document.getElementById('btn-dismiss-network');
  const container = document.getElementById('network-links-container');
  const qrContainer = document.getElementById('qr-code-container');
  const qrHint = document.getElementById('qr-url-hint');
  const btnCopyCf = document.getElementById('btn-copy-cf-cmd');

  const openModal = async () => {
    if (modal) modal.classList.add('show');
    try {
      const res = await fetch('/api/network-info');
      const data = await res.json();
      renderNetworkLinks(data, container, qrContainer, qrHint);
    } catch (e) {
      if (container) container.innerHTML = '<div style="color: #ef4444;">Errore rilevamento rete</div>';
    }
  };

  if (btnOpen) btnOpen.addEventListener('click', openModal);
  if (btnClose && modal) btnClose.addEventListener('click', () => modal.classList.remove('show'));
  if (btnDismiss && modal) btnDismiss.addEventListener('click', () => modal.classList.remove('show'));

  if (btnCopyCf) {
    btnCopyCf.addEventListener('click', () => {
      const cmd = document.getElementById('cf-tunnel-cmd')?.textContent || 'cloudflared tunnel --url http://localhost:3456';
      navigator.clipboard.writeText(cmd);
      btnCopyCf.textContent = 'Copiato!';
      setTimeout(() => btnCopyCf.textContent = 'Copia', 1500);
    });
  }
}

function renderNetworkLinks(data, container, qrContainer, qrHint) {
  if (!container) return;
  container.innerHTML = '';

  const links = [
    { name: 'Accesso Locale (Questo Computer)', url: data.localUrl, isLocal: true },
    ...(data.networkUrls || []).map(n => ({
      name: `Rete Wi-Fi / LAN (${n.interface})`,
      url: n.url,
      isLocal: false
    }))
  ];

  links.forEach(l => {
    const card = document.createElement('div');
    card.className = 'network-link-card';
    card.innerHTML = `
      <div class="network-link-info">
        <span class="network-link-name">${escapeHtml(l.name)}</span>
        <span class="network-link-url">${escapeHtml(l.url)}</span>
      </div>
      <div class="network-link-actions">
        <button class="btn btn-secondary btn-sm btn-copy-url">Copia Link</button>
        <a href="${l.url}" target="_blank" class="btn btn-primary btn-sm" style="text-decoration: none;">Apri</a>
      </div>
    `;

    card.querySelector('.btn-copy-url').addEventListener('click', (e) => {
      navigator.clipboard.writeText(l.url);
      e.target.textContent = 'Copiato!';
      setTimeout(() => e.target.textContent = 'Copia Link', 1500);
    });

    container.appendChild(card);
  });

  const targetQrUrl = data.primaryUrl || data.localUrl;
  if (qrHint) qrHint.textContent = `Scansiona per collegarti a: ${targetQrUrl}`;

  if (qrContainer) {
    qrContainer.innerHTML = `
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(targetQrUrl)}" 
           alt="QR Code per ${targetQrUrl}" 
           style="width: 140px; height: 140px; display: block;" 
           onerror="this.alt='QR non disponibile offline. Usa l\\'URL sopra.'" />
    `;
  }
}


// ============================================================
// 12. Web Search & Siti Consigliati
// ============================================================
function initWebSearch() {
  const searchInput = document.getElementById('web-search-input');
  const btnSearch = document.getElementById('btn-web-search');
  const btnDeep = document.getElementById('btn-deep-search');

  if (btnSearch) btnSearch.addEventListener('click', () => performWebSearch(false));
  if (btnDeep) btnDeep.addEventListener('click', () => performWebSearch(true));

  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        performWebSearch(e.shiftKey); // Shift+Enter = Deep Search
      }
    });
  }

  // Gestione subtab (Ricerca Web vs Siti Consigliati)
  const btnSubtabSearch = document.getElementById('btn-subtab-search');
  const btnSubtabSiti = document.getElementById('btn-subtab-siti');
  const viewWebSearch = document.getElementById('view-web-search');
  const viewWebSiti = document.getElementById('view-web-siti');

  function impostaSubtab(nome) {
    if (nome === 'siti') {
      if (btnSubtabSearch) btnSubtabSearch.classList.remove('active');
      if (btnSubtabSiti) btnSubtabSiti.classList.add('active');
      if (viewWebSearch) viewWebSearch.style.display = 'none';
      if (viewWebSiti) viewWebSiti.style.display = 'block';
      caricaSitiConsigliati();
    } else {
      if (btnSubtabSiti) btnSubtabSiti.classList.remove('active');
      if (btnSubtabSearch) btnSubtabSearch.classList.add('active');
      if (viewWebSiti) viewWebSiti.style.display = 'none';
      if (viewWebSearch) viewWebSearch.style.display = 'block';
    }
  }

  if (btnSubtabSearch) btnSubtabSearch.addEventListener('click', () => impostaSubtab('search'));
  if (btnSubtabSiti) btnSubtabSiti.addEventListener('click', () => impostaSubtab('siti'));

  // Gestione inserimento sito consigliato
  const btnAggiungiSito = document.getElementById('btn-aggiungi-sito');
  const inputSitoUrl = document.getElementById('input-sito-url');
  const inputSitoDesc = document.getElementById('input-sito-desc');

  if (btnAggiungiSito) {
    btnAggiungiSito.addEventListener('click', aggiungiSitoConsigliato);
  }
  if (inputSitoUrl) {
    inputSitoUrl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        aggiungiSitoConsigliato();
      }
    });
  }

  // Caricamento iniziale siti
  caricaSitiConsigliati();

  // Esporta funzione globale per aprire i siti consigliati dalla chat o altrove
  window.apriSitiConsigliati = function () {
    const tabWebBtn = document.querySelector('.tab-btn[data-tab="tab-web-search"]');
    if (tabWebBtn) tabWebBtn.click();
    const sidebar = document.getElementById('sidebar');
    if (sidebar && sidebar.classList.contains('collapsed')) {
      sidebar.classList.remove('collapsed');
      if (typeof fitAddon !== 'undefined' && fitAddon) fitAddon.fit();
      if (typeof sendResize === 'function') sendResize();
    }
    impostaSubtab('siti');
    setTimeout(() => {
      if (inputSitoUrl) inputSitoUrl.focus();
    }, 150);
  };
}

async function performWebSearch(isDeep) {
  const input = document.getElementById('web-search-input');
  const query = input ? input.value.trim() : '';
  if (!query) {
    alert('Inserisci una query di ricerca.');
    if (input) input.focus();
    return;
  }

  const container = document.getElementById('web-search-results');
  const statusCard = document.getElementById('web-search-status-card');
  const statusEl = document.getElementById('web-search-status');
  const btnSearch = document.getElementById('btn-web-search');
  const btnDeep = document.getElementById('btn-deep-search');

  // Disable buttons during search
  if (btnSearch) btnSearch.disabled = true;
  if (btnDeep) btnDeep.disabled = true;

  if (statusCard) statusCard.style.display = 'block';
  if (statusEl) {
    statusEl.innerHTML = `<div class="search-loading">
      <span class="search-spinner"></span>
      <span>${isDeep ? '🔬 Deep Search in corso... Analisi delle pagine web...' : '🔍 Ricerca in corso...'}</span>
    </div>`;
  }
  if (container) container.innerHTML = '';

  try {
    const endpoint = isDeep ? '/api/deep-search' : '/api/web-search';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });
    const data = await res.json();

    if (data.error) {
      if (statusEl) statusEl.innerHTML = `<div class="search-error">❌ ${escapeHtml(data.error)}</div>`;
      return;
    }

    if (!data.results || data.results.length === 0) {
      if (statusEl) statusEl.innerHTML = '<div class="search-empty">Nessun risultato trovato per questa ricerca.</div>';
      return;
    }

    const modeLabel = isDeep ? '🔬 Deep Search' : '🔍 Ricerca';
    const deepInfo = isDeep && data.deepFetchedCount ? ` · ${data.deepFetchedCount} pagine analizzate` : '';
    if (statusEl) {
      statusEl.innerHTML = `<div class="search-success">${modeLabel}: ${data.resultCount} risultati${deepInfo}</div>`;
    }

    renderSearchResults(data.results, isDeep, container);
  } catch (err) {
    if (statusEl) statusEl.innerHTML = `<div class="search-error">❌ Errore di connessione: ${escapeHtml(err.message)}</div>`;
  } finally {
    if (btnSearch) btnSearch.disabled = false;
    if (btnDeep) btnDeep.disabled = false;
  }
}

function renderSearchResults(results, isDeep, container) {
  if (!container) return;
  container.innerHTML = '';

  if (!results || results.length === 0) return;

  // Pulsante "invia tutti i risultati"
  const sendAllBtn = document.createElement('button');
  sendAllBtn.className = 'btn btn-primary btn-block btn-send-all-results';
  sendAllBtn.type = 'button';
  sendAllBtn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="22" y1="2" x2="11" y2="13"></line>
      <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
    </svg>
    <span>Invia tutti i risultati ad Adam</span>
  `;
  sendAllBtn.addEventListener('click', () => sendSearchResultsToAdam(results, isDeep));
  container.appendChild(sendAllBtn);

  results.forEach((result, idx) => {
    const card = document.createElement('div');
    card.className = `search-result-card ${result.deepFetched ? 'has-deep-content' : ''}`;

    const deepBadge = result.deepFetched ? '<span class="deep-badge">📄 Contenuto Scaricato</span>' : '';

    const pagePreview = result.pageContent ? `
      <div class="deep-content-preview">
        <button class="btn-text-action btn-toggle-deep" type="button">▶ Mostra contenuto pagina estratto</button>
        <div class="deep-content-text hidden">${escapeHtml(result.pageContent)}</div>
      </div>
    ` : '';

    card.innerHTML = `
      <div class="search-result-header">
        <span class="search-result-num">${idx + 1}</span>
        <div class="search-result-title-area">
          <a href="${escapeHtml(result.url)}" target="_blank" rel="noopener" class="search-result-title">${escapeHtml(result.title)}</a>
          <span class="search-result-url" title="${escapeHtml(result.url)}">${escapeHtml(truncateUrl(result.url))}</span>
        </div>
        ${deepBadge}
      </div>
      ${result.snippet ? `<div class="search-result-snippet">${escapeHtml(result.snippet)}</div>` : ''}
      ${pagePreview}
      <div class="search-result-actions">
        <button class="btn-action-xs btn-send-one" type="button" title="Invia questo risultato ad Adam">📋 Invia ad Adam</button>
        <a href="${escapeHtml(result.url)}" target="_blank" rel="noopener" class="btn-action-xs">Apri ↗</a>
      </div>
    `;

    // Toggle deep content expand/collapse
    const toggleBtn = card.querySelector('.btn-toggle-deep');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        const content = card.querySelector('.deep-content-text');
        if (content) {
          content.classList.toggle('hidden');
          toggleBtn.textContent = content.classList.contains('hidden')
            ? '▶ Mostra contenuto pagina estratto'
            : '▼ Nascondi contenuto pagina';
        }
      });
    }

    // Invio di un singolo risultato
    const sendOneBtn = card.querySelector('.btn-send-one');
    if (sendOneBtn) {
      sendOneBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        sendSearchResultsToAdam([result], isDeep);
        sendOneBtn.textContent = '✅ Inviato!';
        setTimeout(() => { sendOneBtn.textContent = '📋 Invia ad Adam'; }, 1500);
      });
    }

    container.appendChild(card);
  });
}

function truncateUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.length > 30 ? parsed.pathname.slice(0, 27) + '...' : parsed.pathname;
    return parsed.hostname + path;
  } catch (e) {
    return url.length > 60 ? url.slice(0, 57) + '...' : url;
  }
}

function sendSearchResultsToAdam(results, isDeep) {
  if (!results || results.length === 0) return;

  let text = '';
  if (results.length === 1) {
    const r = results[0];
    text = `Ho trovato questo risultato dalla ricerca web${isDeep ? ' (Deep Search)' : ''}:\n\n`;
    text += `Titolo: ${r.title}\nURL: ${r.url}\n`;
    if (r.snippet) text += `Snippet: ${r.snippet}\n`;
    if (r.pageContent) text += `\nContenuto della pagina:\n${r.pageContent.slice(0, 3000)}\n`;
    text += '\nAnalizza questo risultato e forniscimi informazioni utili.';
  } else {
    text = `Ho trovato ${results.length} risultati dalla ricerca web${isDeep ? ' (Deep Search con contenuto pagine)' : ''}:\n\n`;
    results.forEach((r, i) => {
      text += `[${i + 1}] ${r.title}\nURL: ${r.url}\n`;
      if (r.snippet) text += `Snippet: ${r.snippet}\n`;
      if (r.pageContent) text += `Contenuto: ${r.pageContent.slice(0, 1500)}\n`;
      text += '\n';
    });
    text += '\nAnalizza questi risultati e forniscimi un riepilogo utile.';
  }

  sendPrompt(text);

  // Feedback visivo
  const sendAllBtn = document.querySelector('.btn-send-all-results');
  if (sendAllBtn && results.length > 1) {
    const origHtml = sendAllBtn.innerHTML;
    sendAllBtn.innerHTML = '<span>✅ Inviato ad Adam!</span>';
    setTimeout(() => { sendAllBtn.innerHTML = origHtml; }, 2000);
  }
}

// ============================================================
// 12b. Siti Consigliati per Adam (Fonti Web e Documentazione)
// ============================================================

async function caricaSitiConsigliati() {
  try {
    const res = await fetch('/api/siti-consigliati');
    const data = await res.json();
    if (data.success && Array.isArray(data.siti)) {
      renderSitiConsigliati(data.siti);
      const countEl = document.getElementById('badge-siti-count');
      if (countEl) countEl.textContent = String(data.siti.length);
      const labelTotale = document.getElementById('label-totale-siti');
      if (labelTotale) labelTotale.textContent = data.siti.length + ' ' + (data.siti.length === 1 ? 'sito' : 'siti');
    }
  } catch (err) {
    console.error('Errore caricamento siti consigliati:', err);
  }
}

function renderSitiConsigliati(siti) {
  const container = document.getElementById('siti-consigliati-list');
  if (!container) return;
  container.innerHTML = '';

  if (!siti || siti.length === 0) {
    container.innerHTML = `
      <div class="search-empty" style="text-align: center; padding: 24px 10px;">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" style="opacity: 0.3; margin-bottom: 6px;">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
        </svg>
        <p style="font-size: 11.5px; color: var(--text-muted); margin: 0;">Nessun sito consigliato inserito.</p>
        <p class="hint-small" style="margin-top: 4px;">Aggiungi siti o documentazione: Adam li consulterà se non sa creare un componente o gli manca l'addestramento.</p>
      </div>
    `;
    return;
  }

  siti.forEach((sito) => {
    const card = document.createElement('div');
    card.className = 'sito-consigliato-card';

    let displayHost = sito.url;
    try {
      displayHost = new URL(sito.url).hostname;
    } catch (e) {}

    card.innerHTML = `
      <div class="sito-consigliato-header">
        <div class="sito-consigliato-main">
          <a href="${escapeHtml(sito.url)}" target="_blank" rel="noopener" class="sito-consigliato-url" title="${escapeHtml(sito.url)}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="2" y1="12" x2="22" y2="12"></line>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
            </svg>
            <span>${escapeHtml(displayHost)}</span>
          </a>
          ${sito.descrizione ? `<div class="sito-consigliato-desc">${escapeHtml(sito.descrizione)}</div>` : ''}
          <div class="sito-consigliato-meta">${escapeHtml(truncateUrl(sito.url))}</div>
        </div>
      </div>
      <div class="sito-consigliato-actions">
        <button class="btn-sito-action btn-sito-search" type="button" title="Cerca argomenti all'interno di questo sito">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <span>Cerca nel sito</span>
        </button>
        <button class="btn-sito-action btn-sito-preview" type="button" title="Scarica ed estrai il testo da questa pagina">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
          <span>Leggi testo</span>
        </button>
        <button class="btn-sito-action btn-sito-delete" type="button" title="Rimuovi questo sito dai consigliati">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
          <span>Rimuovi</span>
        </button>
      </div>
    `;

    card.querySelector('.btn-sito-search').addEventListener('click', () => {
      cercaInSito(sito.url);
    });

    card.querySelector('.btn-sito-preview').addEventListener('click', () => {
      anteprimaSito(sito.url);
    });

    card.querySelector('.btn-sito-delete').addEventListener('click', () => {
      eliminaSitoConsigliato(sito.id);
    });

    container.appendChild(card);
  });
}

async function aggiungiSitoConsigliato() {
  const urlInput = document.getElementById('input-sito-url');
  const descInput = document.getElementById('input-sito-desc');
  const url = urlInput ? urlInput.value.trim() : '';
  const descrizione = descInput ? descInput.value.trim() : '';

  if (!url) {
    alert('Inserisci l\'URL del sito o documentazione (es. https://developer.mozilla.org)');
    if (urlInput) urlInput.focus();
    return;
  }

  try {
    const res = await fetch('/api/siti-consigliati', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, descrizione })
    });
    const data = await res.json();
    if (data.error) {
      alert('Errore: ' + data.error);
      return;
    }
    if (urlInput) urlInput.value = '';
    if (descInput) descInput.value = '';
    await caricaSitiConsigliati();
  } catch (err) {
    alert('Errore durante il salvataggio: ' + err.message);
  }
}

async function eliminaSitoConsigliato(id) {
  if (!confirm('Rimuovere questo sito dai consigliati per Adam?')) return;
  try {
    const res = await fetch('/api/siti-consigliati/' + encodeURIComponent(id), {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.error) {
      alert('Errore: ' + data.error);
      return;
    }
    await caricaSitiConsigliati();
  } catch (err) {
    alert('Errore durante la rimozione: ' + err.message);
  }
}

function cercaInSito(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const btnSubtabSearch = document.getElementById('btn-subtab-search');
    if (btnSubtabSearch) btnSubtabSearch.click();
    const searchInput = document.getElementById('web-search-input');
    if (searchInput) {
      searchInput.value = 'site:' + host + ' ';
      searchInput.focus();
    }
  } catch (e) {
    alert('URL non valido');
  }
}

async function anteprimaSito(url) {
  const vecchio = document.querySelector('.anteprima-sito-overlay');
  if (vecchio) vecchio.remove();

  const overlay = document.createElement('div');
  overlay.className = 'anteprima-sito-overlay';
  overlay.innerHTML = `
    <div class="anteprima-sito-box">
      <div class="anteprima-sito-head">
        <strong>Lettura: ${escapeHtml(url)}</strong>
        <div style="display: flex; gap: 8px; align-items: center;">
          <button class="btn btn-primary btn-sm btn-invia-testo-adam" type="button" style="display: none;">📋 Invia ad Adam</button>
          <button class="btn btn-secondary btn-sm btn-chiudi-anteprima" type="button">✕</button>
        </div>
      </div>
      <div class="anteprima-sito-corpo">Caricamento ed estrazione testo in corso...</div>
    </div>
  `;
  document.body.appendChild(overlay);

  const chiudi = () => overlay.remove();
  overlay.querySelector('.btn-chiudi-anteprima').addEventListener('click', chiudi);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) chiudi(); });

  try {
    const res = await fetch('/api/visita-pagina', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, maxLength: 6000 })
    });
    const data = await res.json();
    if (data.error) {
      overlay.querySelector('.anteprima-sito-corpo').textContent = 'Errore: ' + data.error;
      return;
    }
    const corpo = overlay.querySelector('.anteprima-sito-corpo');
    corpo.textContent = data.testo || 'Nessun testo estratto.';
    const btnInvia = overlay.querySelector('.btn-invia-testo-adam');
    if (btnInvia) {
      btnInvia.style.display = 'inline-block';
      btnInvia.addEventListener('click', () => {
        sendPrompt(`Ecco il testo estratto dalla documentazione di ${url} ("${data.titolo}"):\n\n${data.testo.slice(0, 1500)}\n\nUsalo per implementare il pezzo mancante o spiegami come procedere.`);
        chiudi();
      });
    }
  } catch (err) {
    overlay.querySelector('.anteprima-sito-corpo').textContent = 'Errore di connessione: ' + err.message;
  }
}

// ============================================================
// 12c. Documentazione e Fonti Configurate per Adam
// ============================================================

function initDocumentazione() {
  const btnSubtabLink = document.getElementById('btn-subtab-doc-link');
  const btnSubtabFile = document.getElementById('btn-subtab-doc-file');
  const formLink = document.getElementById('form-doc-link');
  const formFile = document.getElementById('form-doc-file');

  if (btnSubtabLink && btnSubtabFile && formLink && formFile) {
    btnSubtabLink.addEventListener('click', () => {
      btnSubtabLink.classList.add('active');
      btnSubtabFile.classList.remove('active');
      formLink.style.display = 'block';
      formFile.style.display = 'none';
    });

    btnSubtabFile.addEventListener('click', () => {
      btnSubtabFile.classList.add('active');
      btnSubtabLink.classList.remove('active');
      formFile.style.display = 'block';
      formLink.style.display = 'none';
    });
  }

  const btnAddUrl = document.getElementById('btn-aggiungi-doc-url');
  if (btnAddUrl) {
    btnAddUrl.addEventListener('click', aggiungiDocUrl);
  }

  const btnAddFile = document.getElementById('btn-aggiungi-doc-file');
  if (btnAddFile) {
    btnAddFile.addEventListener('click', aggiungiDocFile);
  }
}

async function caricaDocumentazione() {
  try {
    const res = await fetch('/api/documentazione');
    const data = await res.json();
    if (data.success && Array.isArray(data.documenti)) {
      renderDocumentazione(data.documenti);
      const labelTotale = document.getElementById('label-totale-documenti');
      if (labelTotale) {
        labelTotale.textContent = data.documenti.length + ' ' + (data.documenti.length === 1 ? 'documento' : 'documenti');
      }
    }
  } catch (err) {
    console.error('Errore caricamento documentazione:', err);
  }
}

function renderDocumentazione(documenti) {
  const container = document.getElementById('documentazione-list');
  if (!container) return;
  container.innerHTML = '';

  if (!documenti || documenti.length === 0) {
    container.innerHTML = '<div class="search-empty">Nessun documento configurato.</div>';
    return;
  }

  documenti.forEach(doc => {
    const card = document.createElement('div');
    card.className = 'doc-card' + (doc.primaria ? ' doc-primary' : '');

    let badgeTipo = '';
    if (doc.primaria) {
      badgeTipo = '<span class="badge-doc-type badge-primaria">Fonte Primaria</span>';
    } else if (doc.tipo === 'url') {
      badgeTipo = '<span class="badge-doc-type badge-url">Sito Web</span>';
    } else if (doc.tipo === 'pdf') {
      badgeTipo = '<span class="badge-doc-type badge-pdf">PDF</span>';
    } else if (doc.tipo === 'immagine') {
      badgeTipo = '<span class="badge-doc-type badge-immagine">Immagine</span>';
    } else {
      badgeTipo = '<span class="badge-doc-type badge-testo">' + escapeHtml((doc.tipo || 'file').toUpperCase()) + '</span>';
    }

    let linkHtml = '';
    if (doc.url) {
      linkHtml = `<a href="${escapeHtml(doc.url)}" target="_blank" rel="noopener" class="doc-card-link">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line>
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
        </svg>
        <span>${escapeHtml(doc.url)}</span>
      </a>`;
    } else if (doc.file) {
      linkHtml = `<div class="doc-card-link" style="color: var(--text-secondary); cursor: default;">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
        </svg>
        <span>${escapeHtml(doc.file)}</span>
      </div>`;
    }

    card.innerHTML = `
      <div class="doc-card-header">
        <div class="doc-card-title-group">
          ${badgeTipo}
          <div class="doc-card-name" title="${escapeHtml(doc.nome || doc.url || doc.file || '')}">${escapeHtml(doc.nome || doc.url || doc.file || '')}</div>
        </div>
        ${!doc.primaria ? `
          <button class="btn-doc-delete" type="button" title="Elimina questo documento">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            <span>Rimuovi</span>
          </button>
        ` : ''}
      </div>
      ${linkHtml}
      ${doc.descrizione ? `<div class="doc-card-desc">${escapeHtml(doc.descrizione)}</div>` : ''}
      <div class="doc-card-footer">
        <span>${escapeHtml(doc.dataCreazione ? new Date(doc.dataCreazione).toLocaleDateString() : '')}</span>
      </div>
    `;

    const btnDelete = card.querySelector('.btn-doc-delete');
    if (btnDelete) {
      btnDelete.addEventListener('click', () => eliminaDocumento(doc.id));
    }

    container.appendChild(card);
  });
}

async function aggiungiDocUrl() {
  const inputUrl = document.getElementById('input-doc-url');
  const inputName = document.getElementById('input-doc-url-name');
  const inputDesc = document.getElementById('input-doc-url-desc');

  const url = inputUrl ? inputUrl.value.trim() : '';
  const nome = inputName ? inputName.value.trim() : '';
  const descrizione = inputDesc ? inputDesc.value.trim() : '';

  if (!url) {
    alert('Inserisci l\'URL del sito o documentazione (es. https://learn.unity.com/tutorial/...)');
    if (inputUrl) inputUrl.focus();
    return;
  }

  try {
    const res = await fetch('/api/documentazione/url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, nome, descrizione })
    });
    const data = await res.json();
    if (data.error) {
      alert('Errore: ' + data.error);
      return;
    }
    if (inputUrl) inputUrl.value = '';
    if (inputName) inputName.value = '';
    if (inputDesc) inputDesc.value = '';
    await caricaDocumentazione();
  } catch (err) {
    alert('Errore durante il salvataggio: ' + err.message);
  }
}

async function aggiungiDocFile() {
  const fileInput = document.getElementById('input-doc-file-upload');
  const descInput = document.getElementById('input-doc-file-desc');

  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    alert('Seleziona un file (PDF, PNG, JPG, TXT, ecc.) da caricare');
    return;
  }

  const file = fileInput.files[0];
  const descrizione = descInput ? descInput.value.trim() : '';

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const base64 = reader.result;
      const res = await fetch('/api/documentazione/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: file.name,
          descrizione,
          base64,
          mimeType: file.type
        })
      });
      const data = await res.json();
      if (data.error) {
        alert('Errore caricamento: ' + data.error);
        return;
      }
      fileInput.value = '';
      if (descInput) descInput.value = '';
      await caricaDocumentazione();
    } catch (err) {
      alert('Errore caricamento file: ' + err.message);
    }
  };
  reader.readAsDataURL(file);
}

async function eliminaDocumento(id) {
  if (!confirm('Rimuovere questo documento dalle fonti di Adam?')) return;
  try {
    const res = await fetch('/api/documentazione/' + encodeURIComponent(id), {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.error) {
      alert('Errore eliminazione: ' + data.error);
      return;
    }
    await caricaDocumentazione();
  } catch (err) {
    alert('Errore eliminazione documento: ' + err.message);
  }
}

// ============================================================
// 20. VISTA CHAT + SELETTORE VISTA
// ============================================================

function initChat() {
  ChatUI.init({
    onSend: (text, immagini) => {
      if (!navigator.onLine) {
        alert('Connessione Internet assente (Offline): il modello non può ricevere o inviare finché la connessione non torna.');
        return;
      }
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        alert('Connessione al server non attiva. Riprova tra qualche istante.');
        return;
      }
      const allegati = immagini || [];
      ws.send(JSON.stringify({ type: 'chat-send', text, pagina: paginaAnteprimaCorrente(), allegati, immagini: allegati.filter(a => /^data:image\//.test(a.dati || '')) }));
    },
    onChoice: (interactionId, answer) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({
        type: 'chat-choice',
        interactionId,
        optionId: answer.optionId || '',
        custom: answer.custom || ''
      }));
    },
    onStop: () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'chat-stop' }));
      }
    },
    onNew: () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'chat-new' }));
      }
    },
    onFileLive: (dati) => {
      if (window.FileLive) FileLive.inCorso(dati);
    },
    onFileSalvato: (dati) => {
      if (window.FileLive) FileLive.salvato(dati);
    },
    onMemoryUpdated: (msg) => {
      refreshMemoryData(true);
    },
    onFilesChanged: (file) => {
      if (window.avvisaVista3d) window.avvisaVista3d(file);
      // Ricarica solo se l'esploratore e' davvero visibile: inutile interrogare il
      // server per una scheda che l'utente non sta guardando.
      const scheda = document.getElementById('tab-files');
      if (scheda && scheda.classList.contains('active')) {
        loadFileExplorer(currentExplorerDir || currentWorkingDir);
      }
    }
  });
}

function initViewSwitch() {
  const btnChat = document.getElementById('btn-view-chat');
  const btnTerm = document.getElementById('btn-view-terminal');
  const panelChat = document.getElementById('view-chat');
  const panelTerm = document.getElementById('view-terminal');
  if (!btnChat || !btnTerm) return;

  const btnPrev = document.getElementById('btn-view-preview');
  const panelPrev = document.getElementById('view-preview');

  function show(view) {
    const isChat = view === 'chat';
    const isPrev = view === 'preview';
    // La vista anteprima non e' ne' chat ne' terminale: currentView guida dove finiscono i prompt
    currentView = isChat ? 'chat' : (isPrev ? 'preview' : 'terminal');

    panelChat.classList.toggle('hidden', !isChat);
    panelTerm.classList.toggle('hidden', view !== 'terminal');
    if (panelPrev) panelPrev.classList.toggle('hidden', !isPrev);

    btnChat.classList.toggle('active', isChat);
    btnTerm.classList.toggle('active', view === 'terminal');
    if (btnPrev) btnPrev.classList.toggle('active', isPrev);

    if (isPrev) {
      aggiornaAnteprima();
      return;
    }

    if (isChat) {
      ChatUI.focus();
    } else if (fitAddon) {
      // Il ResizeObserver reagisce da solo, ma un fit esplicito evita di mostrare
      // per un istante il terminale con le dimensioni vecchie.
      requestAnimationFrame(() => {
        safeFit();
        term.focus();
      });
    }
  }

  btnChat.addEventListener('click', () => show('chat'));
  btnTerm.addEventListener('click', () => show('terminal'));
  if (btnPrev) btnPrev.addEventListener('click', () => show('preview'));
  show('chat');
  initPannelloFile();
}

// ============================================================
// PANNELLO "FILE DAL VIVO" (colonna di destra)
// Richiesta dell'utente: vedere il file mentre Adam lo scrive, accanto alla chat e non al posto
// di essa. Il bottone nella barra lo apre e lo chiude; la larghezza si trascina e resta salvata.
// ============================================================
function initPannelloFile() {
  const pannello = document.getElementById('view-file');
  const btn = document.getElementById('btn-view-file');
  const chiudi = document.getElementById('btn-file-live-chiudi');
  const maniglia = document.getElementById('file-live-maniglia');
  if (!pannello) return;

  // La scheda mostrata nella colonna: 'file' (File dal vivo) o '3d'.
  function schedaMostrata() {
    const corpo3d = document.getElementById('scheda-3d');
    return corpo3d && !corpo3d.classList.contains('nascosta') ? '3d' : 'file';
  }

  // Si accende solo il bottone in alto della scheda che si vede davvero.
  function aggiornaBottone() {
    const aperto = !pannello.classList.contains('chiuso');
    const scheda = schedaMostrata();
    if (btn) btn.classList.toggle('pannello-aperto', aperto && scheda === 'file');
    const bottone3d = document.getElementById('btn-view-3d');
    if (bottone3d) bottone3d.classList.toggle('pannello-aperto', aperto && scheda === '3d');
    try { localStorage.setItem('fileLiveAperto', aperto ? '1' : '0'); } catch (e) {}
  }

  function apri() {
    pannello.classList.remove('chiuso');
    aggiornaBottone();
  }

  // Le due schede della colonna: "File dal vivo" e "3D". Il visore 3D si carica solo alla prima
  // apertura (three.js e il modello pesano: inutile caricarli se nessuno li guarda).
  const cornice3d = document.getElementById('vista3d-frame');
  function mostraScheda(nome) {
    ['file', '3d'].forEach((s) => {
      const corpo = document.getElementById('scheda-' + s);
      const bottone = document.getElementById('scheda-btn-' + s);
      if (corpo) corpo.classList.toggle('nascosta', s !== nome);
      if (bottone) bottone.classList.toggle('attiva', s === nome);
    });
    if (nome === '3d' && cornice3d && !cornice3d.getAttribute('src')) cornice3d.setAttribute('src', cornice3d.dataset.src);
    aggiornaBottone();
    try { localStorage.setItem('pannelloScheda', nome); } catch (e) {}
  }
  document.querySelectorAll('.pannello-scheda').forEach((b) => b.addEventListener('click', () => mostraScheda(b.dataset.scheda)));
  // Ogni bottone in alto: se la sua scheda si vede gia', chiude il pannello; altrimenti la mostra.
  function bottoneScheda(nome) {
    if (!pannello.classList.contains('chiuso') && schedaMostrata() === nome) { chiudiPannello(); return; }
    apri();
    mostraScheda(nome);
  }
  const bottone3d = document.getElementById('btn-view-3d');
  if (bottone3d) bottone3d.addEventListener('click', () => bottoneScheda('3d'));
  // Quando un modello 3D cambia sul disco il visore si ricarica da solo, tenendo il punto di vista.
  window.avvisaVista3d = function (file) {
    if (!cornice3d || !cornice3d.getAttribute('src') || !cornice3d.contentWindow) return;
    if (file && !/\.(glb|gltf|fbx|blend)$/i.test(String(file))) return;
    cornice3d.contentWindow.postMessage({ tipo: 'ricarica', file: file || null }, '*');
  };

  function chiudiPannello() {
    pannello.classList.add('chiuso');
    aggiornaBottone();
  }

  if (btn) btn.addEventListener('click', () => bottoneScheda('file'));
  if (chiudi) chiudi.addEventListener('click', chiudiPannello);

  // Larghezza: si trascina la maniglia, e la misura resta per la prossima volta.
  try {
    const salvata = parseInt(localStorage.getItem('fileLiveLarghezza') || '0', 10);
    if (salvata >= 300) pannello.style.width = salvata + 'px';
  } catch (e) {}

  if (maniglia) {
    let trascino = false;
    maniglia.addEventListener('mousedown', (e) => {
      trascino = true;
      maniglia.classList.add('attiva');
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!trascino) return;
      const larghezza = Math.max(300, Math.min(window.innerWidth - 420, window.innerWidth - e.clientX));
      pannello.style.width = larghezza + 'px';
    });
    window.addEventListener('mouseup', () => {
      if (!trascino) return;
      trascino = false;
      maniglia.classList.remove('attiva');
      document.body.style.userSelect = '';
      try { localStorage.setItem('fileLiveLarghezza', String(parseInt(pannello.style.width, 10) || 480)); } catch (e) {}
    });
  }

  // Il pannello si apre da solo quando Adam comincia a scrivere un file, se "segui" e' acceso,
  // e passa alla scheda del file.
  if (window.FileLive) FileLive.iniziali({ mostra: () => { apri(); mostraScheda('file'); } });
  // Com'era rimasto: si legge tutto PRIMA di toccare qualcosa (mostraScheda salva lo stato).
  let schedaSalvata = 'file';
  let eraAperto = false;
  try {
    schedaSalvata = localStorage.getItem('pannelloScheda') === '3d' ? '3d' : 'file';
    eraAperto = localStorage.getItem('fileLiveAperto') === '1';
  } catch (e) {}
  mostraScheda(schedaSalvata);
  if (eraAperto) apri(); else chiudiPannello();
}

function initWhatsAppNav() {
  const btn = document.getElementById('btn-open-whatsapp');
  const badge = document.getElementById('wa-badge-alert');
  if (btn && badge) {
    btn.addEventListener('click', () => {
      badge.textContent = '0';
      badge.style.display = 'none';
    });
  }
}

// ============================================================
// 21. SERVER MCP (mancava del tutto: la sua assenza interrompeva
//     tutto l'avvio della UI con un ReferenceError)
// ============================================================

let mcpEngineAttivo = 'claude';

function initMcp() {
  const btnAdd = document.getElementById('btn-add-mcp');
  if (!btnAdd) return;

  btnAdd.addEventListener('click', addMcpServer);
  const btnUnity = document.getElementById('btn-unity-mcp-setup');
  if (btnUnity) btnUnity.addEventListener('click', configuraMcpUnity);
  const btnUnityCheck = document.getElementById('btn-unity-mcp-check');
  if (btnUnityCheck) btnUnityCheck.addEventListener('click', loadUnityMcpStatus);
  loadMcpServers();
}

async function loadMcpServers() {
  const container = document.getElementById('mcp-servers-list');
  if (!container) return;

  try {
    const res = await fetch('/api/mcp');
    const data = await res.json();
    mcpEngineAttivo = data.engine || 'claude';
    renderMcpServers(data.mcpServers || {}, container);
    return await loadUnityMcpStatus();
  } catch (err) {
    container.innerHTML = '<div class="search-empty" style="text-align:center; padding:20px 0;">Impossibile leggere la configurazione MCP.</div>';
  }
}

function renderMcpServers(servers, container) {
  const names = Object.keys(servers);
  container.innerHTML = '';

  if (names.length === 0) {
    container.innerHTML = '<div class="search-empty" style="text-align:center; padding:20px 0;">Nessun server MCP configurato per questo progetto.</div>';
    return;
  }

  names.forEach(name => {
    const server = servers[name] || {};
    const card = document.createElement('div');
    card.className = 'project-card';

    const comandoCompleto = Array.isArray(server.command)
      ? server.command.join(' ')
      : [server.command || '', Array.isArray(server.args) ? server.args.join(' ') : ''].filter(Boolean).join(' ');
    const comandoVisibile = server.url || comandoCompleto;
    card.innerHTML =
      '<div class="project-card-header">' +
        '<div class="project-name">' + escapeHtml(name) + '</div>' +
      '</div>' +
      '<div class="project-path" title="' + escapeHtml(comandoVisibile) + '">' +
        escapeHtml(comandoVisibile) +
      '</div>';

    const actions = document.createElement('div');
    actions.className = 'project-card-actions';
    const btnDelete = document.createElement('button');
    btnDelete.className = 'btn-mini btn-mini-danger';
    btnDelete.type = 'button';
    btnDelete.textContent = 'Rimuovi';
    btnDelete.addEventListener('click', () => removeMcpServer(name));
    actions.appendChild(btnDelete);
    card.appendChild(actions);

    container.appendChild(card);
  });
}

async function loadUnityMcpStatus() {
  const card = document.getElementById('unity-mcp-setup');
  const status = document.getElementById('unity-mcp-status');
  const button = document.getElementById('btn-unity-mcp-setup');
  if (!card || !status || !button) return;
  try {
    const res = await fetch('/api/unity-mcp');
    const data = await res.json();
    card.hidden = !data.isUnity;
    if (!data.isUnity) return;

    const packageText = !data.packageDependency
      ? 'Il pacchetto MCP for Unity va aggiunto al progetto.'
      : (data.packageResolved ? 'Pacchetto MCP for Unity installato.' : 'Pacchetto registrato: Unity deve ancora risolverlo.');
    const clientText = data.chatMcpConfigured ? 'Chat Adam configurata.' : 'Alla chat Adam manca la configurazione MCP.';
    const runtimeText = data.projectConnected
      ? 'Editor collegato: ' + data.toolCount + ' strumenti disponibili. ' + (data.chatCatalogKnown ? 'Strumenti caricati nella chat: ' + data.chatToolCount + '.' : 'Il catalogo della chat sarà verificabile dal primo messaggio.')
      : (data.connectionError || 'Editor non collegato.');
    status.textContent = 'Unity ' + (data.version || '') + '. ' + packageText + ' ' + clientText + ' ' + runtimeText;
    button.disabled = false;
    button.textContent = data.packageDependency && data.chatMcpConfigured ? 'Ricollega e ricarica strumenti' : 'Configura Unity e Adam';
    return data;
  } catch (err) {
    card.hidden = true;
  }
}

async function configuraMcpUnity() {
  const button = document.getElementById('btn-unity-mcp-setup');
  const testoOriginale = button ? button.textContent : '';
  if (button) {
    button.disabled = true;
    button.textContent = 'Configuro il collegamento...';
  }
  try {
    const res = await fetch('/api/unity-mcp/setup', { method: 'POST' });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || data.errore || 'Configurazione Unity non riuscita.');
    const runtime = await loadMcpServers();
    const nota = data.packageAdded
      ? ' Unity importerà il pacchetto quando aprirai o ricaricherai il progetto.'
      : ' Il pacchetto è già nel progetto.';
    alert('MCP for Unity è configurato per la chat Adam e il terminale.' + nota +
      (data.restartDeferred ? ' Gli strumenti saranno ricaricati alla fine del turno in corso.' : ' Le sessioni sono state ricaricate.') +
      (runtime && runtime.projectConnected
        ? ' Unity è collegato: ' + runtime.toolCount + ' strumenti disponibili.'
        : ' In Unity apri Window > MCP for Unity > Toggle MCP Window, poi Start Server. In Advanced puoi attivare Auto-Start Server on Editor Load. Usa Verifica collegamento per controllare il risultato.'));
  } catch (err) {
    alert('Errore nel collegamento a Unity: ' + err.message);
  } finally {
    if (button) {
      button.textContent = testoOriginale || 'Connetti Unity Editor';
      await loadUnityMcpStatus();
    }
  }
}

async function addMcpServer() {
  const nameEl = document.getElementById('mcp-input-name');
  const cmdEl = document.getElementById('mcp-input-command');
  const argsEl = document.getElementById('mcp-input-args');

  const name = nameEl.value.trim();
  const command = cmdEl.value.trim();
  if (!name || !command) {
    alert('Servono almeno un nome e un comando per aggiungere il server MCP.');
    return;
  }

  const args = argsEl.value.trim() ? argsEl.value.trim().split(/\s+/) : [];

  try {
    const current = await (await fetch('/api/mcp')).json();
    const servers = current.mcpServers || {};
    servers[name] = mcpEngineAttivo === 'opencode'
      ? { type: 'local', command: [command].concat(args) }
      : { command, args };

    const res = await fetch('/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mcpServers: servers })
    });
    if (!res.ok) throw new Error('Salvataggio fallito');

    nameEl.value = '';
    cmdEl.value = '';
    argsEl.value = '';
    await loadMcpServers();
    // Il server ricarica chat e terminale dopo il salvataggio.
  } catch (err) {
    alert('Errore aggiunta server MCP: ' + err.message);
  }
}

async function removeMcpServer(name) {
  if (!confirm('Rimuovere il server MCP "' + name + '"?')) return;
  try {
    const current = await (await fetch('/api/mcp')).json();
    const servers = current.mcpServers || {};
    delete servers[name];
    const res = await fetch('/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mcpServers: servers })
    });
    if (!res.ok) throw new Error('Salvataggio fallito');
    await loadMcpServers();
  } catch (err) {
    alert('Errore rimozione server MCP: ' + err.message);
  }
}

// Spiega a parole quale combinazione di variabili verra' usata.
function updateProviderHint() {
  const select = document.getElementById('select-provider');
  const hint = document.getElementById('provider-hint');
  const baseUrl = document.getElementById('input-base-url');
  const authToken = document.getElementById('input-auth-token');
  if (!select || !hint) return;

  const hints = {
    anthropic: 'Usa l\'endpoint ufficiale api.anthropic.com. Serve un account Claude Code (comando "claude login" in un terminale) oppure una API key qui sotto. Base URL e Auth Token vengono ignorati.',
    ashna: 'Ashna AI (Routing Dinamico & Multi-LLM): Base URL https://api.ashna.ai con chiave API cwAK... (Claude 3.7/3.5, Gemini 2.0/3, Ashna-X1, GLM, Kimi). Risparmio e velocita ottimali.',
    nvidia: 'NVIDIA NIM (Cloud API): Base URL https://integrate.api.nvidia.com/v1 con chiave nvapi-... (Llama 3.2 Vision, DeepSeek V4 Flash, Nemotron 70B, Codestral).',
    ollama: 'Usa un server Ollama locale. Base URL predefinito http://localhost:11434, Auth Token qualsiasi valore (es. "ollama"). Nessun costo, ma i modelli locali piccoli seguono le istruzioni molto meno bene.',
    custom: 'Proxy compatibile con l\'API Anthropic (es. OpenRouter: Base URL https://openrouter.ai/api con Auth Token sk-or-v1-...).'
  };
  hint.textContent = hints[select.value] || '';

  const isAnthropic = select.value === 'anthropic';
  if (baseUrl) baseUrl.disabled = isAnthropic;
  if (authToken) authToken.disabled = isAnthropic;

  if (select.value === 'ollama') {
    if (baseUrl && !baseUrl.value.trim()) baseUrl.value = 'http://localhost:11434';
    if (authToken && !authToken.value.trim()) authToken.value = 'ollama';
  } else if (select.value === 'ashna') {
    if (baseUrl && (!baseUrl.value.trim() || baseUrl.value === 'http://localhost:11434' || baseUrl.value.includes('openrouter') || baseUrl.value.includes('nvidia'))) {
      baseUrl.value = 'https://api.ashna.ai';
    }
    if (authToken && (authToken.value === 'ollama' || !authToken.value.trim())) {
      authToken.value = '';
      authToken.placeholder = 'cwAK...';
    }
  } else if (select.value === 'nvidia') {
    if (baseUrl && (!baseUrl.value.trim() || baseUrl.value === 'http://localhost:11434' || baseUrl.value.includes('openrouter') || baseUrl.value.includes('ashna'))) {
      baseUrl.value = 'https://integrate.api.nvidia.com/v1';
    }
    if (authToken && (authToken.value === 'ollama' || !authToken.value.trim())) {
      authToken.value = '';
      authToken.placeholder = 'nvapi-...';
    }
  } else if (select.value === 'custom') {
    if (baseUrl && (!baseUrl.value.trim() || baseUrl.value === 'http://localhost:11434')) {
      baseUrl.placeholder = 'https://openrouter.ai/api';
    }
    if (authToken && authToken.value === 'ollama') {
      authToken.value = '';
    }
    if (authToken) {
      authToken.placeholder = 'sk-or-v1-...';
    }
  }
}

// ============================================================
// GESTIONE MULTI-CHIAVE API (OpenRouter, NVIDIA, Ashna, Cerebras, OpenAI, DeepSeek, Gemini, Groq, Mistral, Anthropic, Custom)
// Verifica automatica, stato di raggiungibilità, crediti & scaricamento modelli
// ============================================================

const ALL_STUDIO_PROVIDERS = [
  { id: 'openrouter', name: 'OpenRouter', prefix: 'openrouter: ' },
  { id: 'nvidia', name: 'NVIDIA NIM', prefix: 'nvidia: ' },
  { id: 'ashna', name: 'Ashna AI', prefix: 'ashna: ' },
  { id: 'cerebras', name: 'Cerebras Cloud', prefix: 'cerebras: ' },
  { id: 'openai', name: 'OpenAI', prefix: 'openai: ' },
  { id: 'deepseek', name: 'DeepSeek', prefix: 'deepseek: ' },
  { id: 'gemini', name: 'Google Gemini', prefix: 'gemini: ' },
  { id: 'groq', name: 'Groq Cloud', prefix: 'groq: ' },
  { id: 'mistral', name: 'Mistral AI', prefix: 'mistral: ' },
  { id: 'anthropic', name: 'Anthropic Claude', prefix: 'anthropic: ' },
  { id: 'custom', name: 'Personalizzato', prefix: 'custom: ' }
];

function updateSingleKeyFeedback(prov, status) {
  const el = document.getElementById(`key-feedback-${prov}`);
  if (!el) return;

  el.className = 'key-status-feedback';
  if (!status) {
    el.classList.add('idle');
    el.textContent = 'Nessuna chiave inserita';
    return;
  }

  if (status.reachable === false) {
    el.classList.add('err');
    el.textContent = `✗ Server o API non raggiungibile: ${status.error || 'Offline o timeout'}`;
    return;
  }

  if (status.error && !status.valid) {
    el.classList.add('err');
    el.textContent = `✗ ${status.error}`;
    return;
  }

  if (status.valid) {
    if (status.creditsExhausted) {
      el.classList.add('warn');
      el.textContent = `⚠️ Chiave verificata ma CREDITI ESAURITI (Saldo insufficiente sul fornitore)`;
      return;
    }

    const count = (Array.isArray(status.models) ? status.models.length : 0) || ((status.freeCount || 0) + (status.paidCount || 0));
    const creditInfo = status.credits ? ` · Saldo/Crediti: ${status.credits}` : '';
    const costTier = status.isPaid ? '[A CREDITI]' : '[FREE TIER / GRATUITO]';

    el.classList.add('ok');
    el.textContent = `✓ Verificata con successo ${costTier} (${count} modelli caricati)${creditInfo}`;
    return;
  }

  el.classList.add('idle');
  el.textContent = 'Stato non verificato';
}

function updateAllKeyFeedbacks(providerStatus) {
  if (!providerStatus) return;
  ALL_STUDIO_PROVIDERS.forEach(p => {
    const inp = document.getElementById(`input-key-${p.id}`);
    const keyVal = inp ? inp.value.trim() : '';
    if (!keyVal && p.id !== 'custom') {
      updateSingleKeyFeedback(p.id, null);
    } else if (providerStatus[p.id]) {
      updateSingleKeyFeedback(p.id, providerStatus[p.id]);
    }
  });
}

function buildModelBadgeLabel(m) {
  const p = m.provider || '';
  let prefix = '';
  if (p === 'Ashna') prefix = 'ashna: ';
  else if (p === 'NVIDIA') prefix = 'nvidia: ';
  else if (p === 'Cerebras') prefix = 'cerebras: ';
  else if (p === 'OpenRouter') prefix = 'openrouter: ';
  else if (p === 'OpenAI') prefix = 'openai: ';
  else if (p === 'DeepSeek') prefix = 'deepseek: ';
  else if (p === 'Gemini') prefix = 'gemini: ';
  else if (p === 'Groq') prefix = 'groq: ';
  else if (p === 'Mistral') prefix = 'mistral: ';
  else if (p === 'Anthropic') prefix = 'anthropic: ';
  else if (p === 'Custom') prefix = 'custom: ';

  const isFree = m.isFree || (typeof m.id === 'string' && (m.id.endsWith(':free') || m.id.includes('8b')));
  const costTag = isFree
    ? ((p === 'Cerebras' || p === 'Groq' || p === 'Gemini' || p === 'NVIDIA') ? '[FREE TIER] ' : '[GRATIS] ')
    : '[A CREDITI] ';
  const price = (!isFree && m.promptPriceM && m.promptPriceM !== '0')
    ? ` ($${m.promptPriceM}/$${m.completionPriceM} 1M)`
    : '';
  return prefix + costTag + (m.name || m.id) + price;
}

function populateModelsInUI(models, providerStatus) {
  const modelList = document.getElementById('model-list');
  const coderList = document.getElementById('coder-model-list');

  // Popola datalist Settings modal
  [modelList, coderList].forEach(dl => {
    if (!dl) return;
    dl.querySelectorAll('option[data-dyn-model]').forEach(o => o.remove());

    // Se ci sono provider con problemi di raggiungibilità o crediti esauriti, segnala
    if (providerStatus) {
      ALL_STUDIO_PROVIDERS.forEach(p => {
        const st = providerStatus[p.id];
        if (!st) return;
        if (st.reachable === false) {
          const opt = document.createElement('option');
          opt.value = `⚠️ ${p.name}: NON RAGGIUNGIBILE`;
          opt.label = `⚠️ ${p.name} — NON RAGGIUNGIBILE (${st.error || 'Server offline o errore rete'})`;
          opt.dataset.dynModel = '1';
          opt.disabled = true;
          dl.appendChild(opt);
        } else if (st.creditsExhausted === true) {
          const opt = document.createElement('option');
          opt.value = `⚠️ ${p.name}: CREDITI ESAURITI`;
          opt.label = `⚠️ ${p.name} — CREDITI ESAURITI (Saldo insufficiente)`;
          opt.dataset.dynModel = '1';
          opt.disabled = true;
          dl.appendChild(opt);
        }
      });
    }

    if (Array.isArray(models)) {
      models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.dataset.dynModel = '1';
        opt.dataset.free = m.isFree ? '1' : '0';
        const label = buildModelBadgeLabel(m);
        opt.label = label;
        opt.textContent = label;
        dl.appendChild(opt);
      });
    }
  });

  // Aggiorna anche le tendine attive della chat
  if (window.ChatUI && typeof window.ChatUI.refreshModels === 'function') {
    window.ChatUI.refreshModels();
  }
}

// Alias retrocompatibile
function populateOpenRouterModelsInUI(models) {
  populateModelsInUI(models);
}

async function verifySingleKeyUI(prov) {
  const inp = document.getElementById(`input-key-${prov}`);
  const feedback = document.getElementById(`key-feedback-${prov}`);
  const customBase = document.getElementById('input-base-url-custom')?.value.trim() || '';
  const keyVal = inp ? inp.value.trim() : '';

  if (!keyVal && prov !== 'custom') {
    updateSingleKeyFeedback(prov, null);
    return;
  }

  if (feedback) {
    feedback.className = 'key-status-feedback loading';
    feedback.textContent = '⏳ Verifica in corso e scaricamento modelli...';
  }

  try {
    const res = await fetch('/api/keys/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: prov,
        apiKey: keyVal,
        customBaseUrl: customBase
      })
    });
    const data = await res.json();
    updateSingleKeyFeedback(prov, data);

    if (data.valid && Array.isArray(data.models)) {
      populateModelsInUI(data.models, { [prov]: data });
    }
  } catch (err) {
    if (feedback) {
      feedback.className = 'key-status-feedback err';
      feedback.textContent = `✗ Errore di connessione: ${err.message}`;
    }
  }
}

async function verifyAllKeysUI() {
  const btn = document.getElementById('btn-verify-all-keys');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Verifica in corso...';
  }

  const apiKeys = {};
  ALL_STUDIO_PROVIDERS.forEach(p => {
    const inp = document.getElementById(`input-key-${p.id}`);
    const v = inp ? inp.value.trim() : '';
    if (v) {
      apiKeys[p.id] = v;
      const fb = document.getElementById(`key-feedback-${p.id}`);
      if (fb) {
        fb.className = 'key-status-feedback loading';
        fb.textContent = '⏳ Verifica...';
      }
    }
  });
  const customBase = document.getElementById('input-base-url-custom')?.value.trim() || '';

  try {
    const res = await fetch('/api/keys/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        verifyAll: true,
        apiKeys: apiKeys,
        customBaseUrl: customBase
      })
    });
    const data = await res.json();

    if (data.providerStatus) {
      updateAllKeyFeedbacks(data.providerStatus);
    }
    if (Array.isArray(data.models)) {
      populateModelsInUI(data.models, data.providerStatus);
    }
  } catch (err) {
    alert('Errore durante la verifica delle chiavi: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🔍 Verifica Tutte le Chiavi Inserite';
    }
  }
}

function initMultiKeyManager() {
  // 1. Toggle visibilita' password
  document.querySelectorAll('.btn-toggle-key-visibility').forEach(btn => {
    btn.onclick = () => {
      const card = btn.closest('.api-key-card');
      const input = card ? card.querySelector('input[type="password"], input[type="text"]') : null;
      if (!input) return;
      if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🙈';
      } else {
        input.type = 'password';
        btn.textContent = '👁️';
      }
    };
  });

  // 2. Pulsanti di verifica singola
  document.querySelectorAll('.btn-verify-single-key').forEach(btn => {
    btn.onclick = () => {
      const prov = btn.getAttribute('data-provider');
      if (prov) verifySingleKeyUI(prov);
    };
  });

  // 3. Pulsante master verifica totale
  const btnAll = document.getElementById('btn-verify-all-keys');
  if (btnAll) {
    btnAll.onclick = verifyAllKeysUI;
  }

  // 4. Verifica debounced alla digitazione e immediata su incolla
  ALL_STUDIO_PROVIDERS.forEach(p => {
    const inp = document.getElementById(`input-key-${p.id}`);
    if (!inp) return;
    let timer = null;

    inp.addEventListener('input', () => {
      clearTimeout(timer);
      const val = inp.value.trim();
      if (!val) {
        updateSingleKeyFeedback(p.id, null);
        return;
      }
      if (val.length >= 12 || p.id === 'custom') {
        timer = setTimeout(() => {
          verifySingleKeyUI(p.id);
        }, 800);
      }
    });

    inp.addEventListener('paste', () => {
      setTimeout(() => verifySingleKeyUI(p.id), 100);
    });
  });
}

// Retrocompatibilita' per eventuale vecchio timer
let openRouterVerifyTimer = null;
async function testAndLoadOpenRouterKey(rawKey) {
  const token = (rawKey || '').trim();
  if (token.startsWith('nvapi-')) verifySingleKeyUI('nvidia');
  else if (token.startsWith('csk-')) verifySingleKeyUI('cerebras');
  else if (token.startsWith('cwAK')) verifySingleKeyUI('ashna');
  else if (token.startsWith('sk-or-')) verifySingleKeyUI('openrouter');
}

document.addEventListener('DOMContentLoaded', () => {
  const select = document.getElementById('select-provider');
  if (select) select.addEventListener('change', updateProviderHint);
  initMultiKeyManager();
});


// ============================================================
// 22. DIAGNOSTICA
// Trasforma un fallimento silenzioso ("non risponde") in una causa leggibile.
// ============================================================

function initDiagnostics() {
  const modal = document.getElementById('modal-diagnostics');
  const btnOpen = document.getElementById('btn-diagnostics');
  if (!modal || !btnOpen) return;

  btnOpen.addEventListener('click', () => {
    openModal(modal);
    runDiagnostics();
  });

  ['btn-close-diagnostics', 'btn-cancel-diagnostics'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', () => closeModal(modal));
  });

  const btnRefresh = document.getElementById('btn-refresh-diagnostics');
  if (btnRefresh) btnRefresh.addEventListener('click', runDiagnostics);

  const btnDetails = document.getElementById('btn-banner-details');
  if (btnDetails) {
    btnDetails.addEventListener('click', () => {
      openModal(modal);
      runDiagnostics();
    });
  }

  // Controllo silenzioso all'avvio: se qualcosa non va lo diciamo subito.
  runDiagnostics(true);
}

async function runDiagnostics(silent) {
  const list = document.getElementById('diag-list');
  if (list && !silent) list.innerHTML = '<div class="diag-loading">Controllo in corso...</div>';

  try {
    const res = await fetch('/api/diagnostics');
    const data = await res.json();
    if (list) renderDiagnostics(data, list);
    updateDiagnosticsBanner(data);
  } catch (err) {
    if (list) list.innerHTML = '<div class="diag-loading">Diagnostica non disponibile: ' + escapeHtml(err.message) + '</div>';
  }
}

function renderDiagnostics(data, list) {
  list.innerHTML = '';

  (data.checks || []).forEach(check => {
    const state = check.ok ? 'ok' : (check.severity === 'warn' ? 'warn' : 'err');
    const row = document.createElement('div');
    row.className = 'diag-row diag-' + state;

    const mark = state === 'ok' ? '✓' : state === 'warn' ? '!' : '✕';
    let html =
      '<div class="diag-mark">' + mark + '</div>' +
      '<div class="diag-content">' +
        '<div class="diag-label">' + escapeHtml(check.label) + '</div>' +
        '<div class="diag-detail">' + escapeHtml(check.detail || '') + '</div>';
    if (check.fix) {
      html += '<div class="diag-fix">' + escapeHtml(check.fix) + '</div>';
    }
    html += '</div>';

    row.innerHTML = html;
    list.appendChild(row);
  });
}

function updateDiagnosticsBanner(data) {
  const banner = document.getElementById('chat-banner');
  const text = document.getElementById('chat-banner-text');
  const badge = document.getElementById('diag-badge');
  if (!banner || !text) return;

  const problems = (data.checks || []).filter(c => !c.ok && c.severity !== 'warn');
  const warnings = (data.checks || []).filter(c => !c.ok && c.severity === 'warn');

  if (badge) {
    const count = problems.length;
    badge.hidden = count === 0;
    badge.textContent = String(count);
  }

  if (problems.length === 0) {
    banner.hidden = true;
    return;
  }

  const first = problems[0];
  text.textContent = first.label + ': ' + (first.detail || '') +
    (problems.length > 1 ? '  (+' + (problems.length - 1) + ' altri problemi)' : '') +
    (warnings.length ? '' : '');
  banner.hidden = false;
}

// Aggiunge al datalist i modelli disponibili (Cloud e Ollama locale)
async function loadLocalModelOptions() {
  const list = document.getElementById('model-list');
  const coderList = document.getElementById('coder-model-list');
  if (!list && !coderList) return;
  try {
    let data = null;
    try {
      const res = await fetch('/api/available-models');
      data = await res.json();
    } catch (e) {
      const res = await fetch('/api/local-models');
      const localData = await res.json();
      data = {
        cloudModels: [],
        localModels: (localData.models || []).map(m => ({ id: m.name, name: m.name, sizeGb: m.sizeGb }))
      };
    }
    if (!data) return;

    if (list && Array.isArray(data.localModels)) {
      list.querySelectorAll('option[data-local]').forEach(o => o.remove());
      data.localModels.forEach(model => {
        const option = document.createElement('option');
        option.value = model.name;
        option.dataset.local = '1';
        const bits = [];
        if (model.sizeGb) bits.push(model.sizeGb + ' GB');
        option.label = bits.length ? model.name + ' — ' + bits.join(', ') : model.name;
        list.appendChild(option);
      });
    }

    if (coderList) {
      coderList.querySelectorAll('option[data-dyn]').forEach(o => o.remove());
      // Aggiungi modelli cloud
      (data.cloudModels || []).forEach(model => {
        const option = document.createElement('option');
        option.value = model.id;
        option.dataset.dyn = '1';
        option.label = model.name + (model.provider ? ' (' + model.provider + ')' : '');
        coderList.appendChild(option);
      });
      // Aggiungi modelli locali
      (data.localModels || []).forEach(model => {
        const option = document.createElement('option');
        option.value = model.name;
        option.dataset.dyn = '1';
        option.label = model.name + (model.provider ? ' (' + model.provider + ')' : '');
        coderList.appendChild(option);
      });
    }

    // Popola datalist con modelli remoti disponibili (OpenRouter, Ashna, NVIDIA, Cerebras)
    if (list) {
      list.querySelectorAll('option[data-openrouter], option[data-remote]').forEach(o => o.remove());
      if (coderList) coderList.querySelectorAll('option[data-openrouter], option[data-remote]').forEach(o => o.remove());

      const appendDatalistOption = (targetList, m) => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.dataset.remote = '1';
        if (m.provider === 'OpenRouter') {
          opt.dataset.openrouter = '1';
          opt.dataset.free = m.isFree ? '1' : '0';
          const price = (m.promptPriceM && m.promptPriceM !== '0') ? ` ($${m.promptPriceM}/$${m.completionPriceM} 1M)` : '';
          const tag = (m.isFree || (typeof m.id === 'string' && m.id.endsWith(':free'))) ? '[GRATIS] ' : '[CREDITI] ';
          const lbl = 'openrouter model: ' + tag + (m.name || m.id) + price;
          opt.label = lbl;
          opt.textContent = lbl;
        } else if (m.provider === 'Ashna') {
          const lbl = 'ashna: [ASHNA AI] ' + (m.name || m.id);
          opt.label = lbl;
          opt.textContent = lbl;
        } else if (m.provider === 'NVIDIA') {
          const lbl = 'nvidia: [NVIDIA NIM] ' + (m.name || m.id);
          opt.label = lbl;
          opt.textContent = lbl;
        } else if (m.provider === 'Cerebras') {
          const lbl = 'cerebras model: ' + (m.isFree ? '[FREE TIER] ' : '[CREDITI] ') + (m.name || m.id);
          opt.label = lbl;
          opt.textContent = lbl;
        }
        targetList.appendChild(opt);
      };

      const allRemote = [
        ...(Array.isArray(data.openrouterModels) ? data.openrouterModels : []),
        ...(Array.isArray(data.ashnaModels) ? data.ashnaModels : []),
        ...(Array.isArray(data.nvidiaModels) ? data.nvidiaModels : []),
        ...(Array.isArray(data.cerebrasModels) ? data.cerebrasModels : [])
      ];

      allRemote.forEach(m => {
        appendDatalistOption(list, m);
        if (coderList) appendDatalistOption(coderList, m);
      });
    }

    if (window.ChatUI && typeof window.ChatUI.refreshModels === 'function') {
      window.ChatUI.refreshModels();
    }
  } catch (e) {
    // API o Ollama non raggiungibile: il campo resta a testo libero.
  }
}

// ============================================================
// 23. ANALISI DELL'INTERO PROGETTO
// La verifica automatica guarda solo i file toccati nel turno. Questa guarda tutti
// i file e i loro riferimenti incrociati: e' cosi' che si trovano i bug che nessuno
// ha segnalato, invece di aspettare che si manifestino.
// ============================================================

function initScan() {
  const btn = document.getElementById('btn-scan');
  if (!btn) return;
  btn.addEventListener('click', () => eseguiAnalisi(true));
}

async function eseguiAnalisi(chiediCorrezione) {
  const btn = document.getElementById('btn-scan');
  const badge = document.getElementById('scan-badge');
  const testoOriginale = btn ? btn.querySelector('span').textContent : '';
  if (btn) { btn.disabled = true; btn.querySelector('span').textContent = 'Analizzo...'; }

  try {
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fix: !!chiediCorrezione })
    });
    const data = await res.json();

    if (badge) {
      badge.hidden = !data.problemi || data.problemi.length === 0;
      badge.textContent = String((data.problemi || []).length);
    }

    mostraEsitoAnalisi(data);
  } catch (err) {
    alert('Analisi non riuscita: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.querySelector('span').textContent = testoOriginale || 'Analizza'; }
  }
}

function mostraEsitoAnalisi(data) {
  const modal = document.getElementById('modal-diagnostics');
  const list = document.getElementById('diag-list');
  if (!modal || !list) return;

  const problemi = data.problemi || [];
  list.innerHTML = '';

  const intestazione = document.createElement('div');
  intestazione.className = 'diag-row ' + (problemi.length === 0 ? 'diag-ok' : 'diag-err');
  intestazione.innerHTML =
    '<div class="diag-mark">' + (problemi.length === 0 ? '✓' : String(problemi.length)) + '</div>' +
    '<div class="diag-content"><div class="diag-label">Analisi del progetto</div>' +
    '<div class="diag-detail">' + data.fileEsaminati + ' file esaminati in ' +
    Math.round((data.durataMs || 0) / 10) / 100 + ' s. ' +
    (problemi.length === 0
      ? 'Nessun problema trovato.'
      : problemi.length + (problemi.length === 1 ? ' problema trovato' : ' problemi trovati') +
        '. Li ho passati ad Adam perche\' li corregga.') +
    (data.troncato ? ' (analisi limitata ai primi file per dimensione del progetto)' : '') +
    '</div></div>';
  list.appendChild(intestazione);

  problemi.forEach(p => {
    const riga = document.createElement('div');
    riga.className = 'diag-row diag-err';
    riga.innerHTML =
      '<div class="diag-mark">✕</div>' +
      '<div class="diag-content">' +
        '<div class="diag-label">' + escapeHtml(p.file.split(/[\/]/).pop()) +
          ' <span style="color:var(--text-muted);font-weight:400">(' + escapeHtml(p.tipo) + ')</span></div>' +
        '<div class="diag-detail">' + escapeHtml(p.messaggio.split('\n')[0]) + '</div>' +
      '</div>';
    list.appendChild(riga);
  });

  openModal(modal);
}

// ============================================================
// 24. MAPPA DEL CODICE
// Estrae variabili, funzioni e collegamenti fra i file, li salva nella memoria di
// Adam (che li usa per non rompere dipendenze esistenti) e li disegna nella Mappa
// Neurale, dove diventano un diagramma navigabile.
// ============================================================

function initCodeMap() {
  const btn = document.getElementById('btn-code-map');
  if (!btn) return;
  btn.addEventListener('click', generaMappaCodice);
}

async function generaMappaCodice() {
  const btn = document.getElementById('btn-code-map');
  const etichetta = btn ? btn.querySelector('span') : null;
  const originale = etichetta ? etichetta.textContent : '';
  if (btn) { btn.disabled = true; if (etichetta) etichetta.textContent = 'Analizzo...'; }

  try {
    const res = await fetch('/api/code-map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    mostraMappaCodice(data);
    // La Mappa Neurale ora contiene i nodi dei file: la ricarichiamo perche' il
    // diagramma mostri subito la struttura appena estratta.
    if (typeof refreshMemoryData === 'function') refreshMemoryData();
  } catch (err) {
    alert('Mappa del codice non riuscita: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; if (etichetta) etichetta.textContent = originale || 'Mappa codice'; }
  }
}

function mostraMappaCodice(data) {
  const modal = document.getElementById('modal-diagnostics');
  const list = document.getElementById('diag-list');
  if (!modal || !list) return;

  list.innerHTML = '';

  const testa = document.createElement('div');
  testa.className = 'diag-row diag-ok';
  testa.innerHTML =
    '<div class="diag-mark">🗺</div><div class="diag-content">' +
    '<div class="diag-label">Mappa del codice</div>' +
    '<div class="diag-detail">' + data.schede.length + ' file, ' +
    data.collegamenti.length + ' collegamenti. Salvata nella memoria di Adam e disegnata ' +
    'nella Mappa Neurale (' + data.nodiNelDiagramma + ' nodi).</div></div>';
  list.appendChild(testa);

  data.schede.forEach(sc => {
    if (sc.tipo === 'json') return;
    const righe = [];
    if (sc.funzioni.length) righe.push('<strong>funzioni</strong>: ' + escapeHtml(sc.funzioni.join(', ')));
    if (sc.variabili.length) righe.push('<strong>variabili</strong>: ' + escapeHtml(sc.variabili.join(', ')));
    if (sc.dichiaraId.length) righe.push('<strong>id dichiarati</strong>: ' + escapeHtml(sc.dichiaraId.join(', ')));
    if (sc.usaId.length) righe.push('<strong>id usati</strong>: ' + escapeHtml(sc.usaId.join(', ')));

    const uscenti = data.collegamenti.filter(c => c.da === sc.nome);
    if (uscenti.length) {
      righe.push('<strong>dipende da</strong>: ' + uscenti
        .map(c => escapeHtml(c.a) + ' <em>(' + escapeHtml(c.motivo) + ')</em>').join(', '));
    }
    const entranti = data.collegamenti.filter(c => c.a === sc.nome);
    if (entranti.length) {
      righe.push('<strong>usato da</strong>: ' + Array.from(new Set(entranti.map(c => c.da)))
        .map(escapeHtml).join(', '));
    }

    const riga = document.createElement('div');
    riga.className = 'diag-row';
    riga.innerHTML =
      '<div class="diag-mark" style="background:var(--claude-accent-dim);color:var(--claude-accent)">' +
        escapeHtml(sc.tipo.slice(0, 3)) + '</div>' +
      '<div class="diag-content">' +
        '<div class="diag-label">' + escapeHtml(sc.nome) +
          ' <span style="color:var(--text-muted);font-weight:400">(' + sc.righe + ' righe)</span></div>' +
        '<div class="diag-detail">' + (righe.join('<br>') || 'Nessun simbolo di primo livello.') + '</div>' +
      '</div>';
    list.appendChild(riga);
  });

  openModal(modal);
}

// ============================================================
// 25. PROVA DAL VIVO
// Apre le pagine del progetto in un browser vero, raccoglie errori di console,
// verifica che i comandi siano davvero cliccabili a piu' dimensioni di finestra e
// cattura uno screenshot. Lo screenshot viene passato ad Adam come immagine: il
// modello ha capacita' vision, quindi guarda la pagina invece di leggerne una
// descrizione, e le correzioni diventano molto piu' mirate.
// ============================================================

function initRuntime() {
  const btn = document.getElementById('btn-runtime');
  if (!btn) return;
  btn.addEventListener('click', () => eseguiProvaDalVivo(true));
}

async function eseguiProvaDalVivo(chiediCorrezione) {
  const btn = document.getElementById('btn-runtime');
  const etichetta = btn ? btn.querySelector('span') : null;
  const originale = etichetta ? etichetta.textContent : '';
  if (btn) { btn.disabled = true; if (etichetta) etichetta.textContent = 'Apro il browser...'; }

  try {
    const res = await fetch('/api/runtime', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fix: !!chiediCorrezione })
    });
    const data = await res.json();

    if (!data.disponibile) {
      alert('Prova dal vivo non disponibile.\n\n' + (data.errore || ''));
      return;
    }

    const badge = document.getElementById('runtime-badge');
    if (badge) {
      badge.hidden = !data.problemi || data.problemi.length === 0;
      badge.textContent = String((data.problemi || []).length);
    }

    mostraProvaDalVivo(data);
  } catch (err) {
    alert('Prova dal vivo non riuscita: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; if (etichetta) etichetta.textContent = originale || 'Prova dal vivo'; }
  }
}

function mostraProvaDalVivo(data) {
  const modal = document.getElementById('modal-diagnostics');
  const list = document.getElementById('diag-list');
  if (!modal || !list) return;

  list.innerHTML = '';
  const pagine = data.pagine || [];
  const totale = (data.problemi || []).length;

  const testa = document.createElement('div');
  testa.className = 'diag-row ' + (totale === 0 ? 'diag-ok' : 'diag-err');
  testa.innerHTML =
    '<div class="diag-mark">' + (totale === 0 ? '✓' : String(totale)) + '</div>' +
    '<div class="diag-content"><div class="diag-label">Prova dal vivo</div>' +
    '<div class="diag-detail">' + pagine.length +
    (pagine.length === 1 ? ' pagina aperta' : ' pagine aperte') + ' in un browser vero. ' +
    (totale === 0
      ? 'Nessun errore rilevato.'
      : totale + (totale === 1 ? ' problema trovato' : ' problemi trovati') +
        '. Screenshot e problemi passati ad Adam, che li guarda.') +
    '</div></div>';
  list.appendChild(testa);

  pagine.forEach(pg => {
    const riga = document.createElement('div');
    riga.className = 'diag-row' + ((pg.problemi || []).length ? ' diag-err' : ' diag-ok');
    let html =
      '<div class="diag-mark">' + ((pg.problemi || []).length ? '✕' : '✓') + '</div>' +
      '<div class="diag-content">' +
      '<div class="diag-label">' + escapeHtml(pg.pagina) +
      (pg.titolo ? ' <span style="color:var(--text-muted);font-weight:400">— ' + escapeHtml(pg.titolo) + '</span>' : '') +
      '</div>';
    if (pg.errore) {
      html += '<div class="diag-detail">Errore di apertura: ' + escapeHtml(pg.errore) + '</div>';
    } else if ((pg.problemi || []).length === 0) {
      html += '<div class="diag-detail">Nessun errore, nessun comando coperto.</div>';
    } else {
      html += '<div class="diag-detail">' + pg.problemi.map(x =>
        '<strong>' + escapeHtml(x.tipo) + '</strong>: ' + escapeHtml(x.messaggio)).join('<br>') + '</div>';
    }
    if (pg.screenshot) {
      html += '<img src="/api/screenshot/' + encodeURIComponent(pg.screenshot) +
        '" alt="schermata di ' + escapeHtml(pg.pagina) + '" ' +
        'style="margin-top:10px;width:100%;border-radius:var(--radius-sm);border:1px solid var(--border-subtle)">';
    }
    if (data.sonda && data.sonda.pagina === pg.pagina) html += htmlSonda(data.sonda);
    html += '</div>';
    riga.innerHTML = html;
    list.appendChild(riga);
  });

  openModal(modal);
}


// ============================================================
// 26. ANTEPRIMA
// Mostra la pagina in lavorazione dentro lo Studio, servita da /preview cosi' che
// l'iframe sia della stessa origine: e' quello che permette di leggerne la console
// invece di limitarsi a guardarla.
// ============================================================

let messaggiAnteprima = [];
let erroriAnteprima = 0;

function initPreview() {
  const selettore = document.getElementById('preview-page');
  const ricarica = document.getElementById('btn-preview-reload');
  const console_ = document.getElementById('btn-preview-console');
  const pulisci = document.getElementById('btn-preview-console-clear');
  if (!selettore) return;

  selettore.addEventListener('change', () => caricaPaginaAnteprima(selettore.value));
  if (ricarica) ricarica.addEventListener('click', () => caricaPaginaAnteprima(selettore.value, true));

  if (console_) {
    console_.addEventListener('click', () => {
      const pannello = document.getElementById('preview-console');
      if (pannello) pannello.classList.toggle('hidden');
    });
  }
  if (pulisci) pulisci.addEventListener('click', svuotaConsoleAnteprima);

  const controlla = document.getElementById('btn-preview-check');
  if (controlla) controlla.addEventListener('click', controllaPaginaAnteprima);

  // Sonda dei flussi: lo Studio prova la pagina e la confronta con cio' che promette la
  // descrizione; l'avanzamento e il risultato compaiono nella chat.
  const esplora = document.getElementById('btn-preview-esplora');
  if (esplora) {
    esplora.addEventListener('click', async () => {
      if (esplora.disabled) return;
      esplora.disabled = true;
      const testo = esplora.textContent;
      esplora.textContent = 'Esploro...';
      esplora.title = 'Provo i flussi della pagina: l\'avanzamento e\' nella chat.';
      try {
        const r = await fetch('/api/esplora', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pagina: selettore.value })
        });
        const d = await r.json();
        esplora.title = r.ok ? 'Ultima esplorazione: ' + (d.percorso || []).length + ' prove misurate, ' + (d.difetti || []).length + ' contro la descrizione (dettagli nella chat)'
          : 'Non riuscita: ' + (d.error || r.status);
        if (!r.ok) alert('Esplorazione non riuscita: ' + (d.error || r.status));
      } catch (e) {
        esplora.title = 'Non riuscita: ' + e.message;
      } finally {
        esplora.disabled = false;
        esplora.textContent = testo;
      }
    });
  }
  const chiudiCheck = document.getElementById('btn-preview-check-close');
  if (chiudiCheck) {
    chiudiCheck.addEventListener('click', () => {
      document.getElementById('preview-check').classList.add('hidden');
    });
  }

  document.querySelectorAll('.preview-size').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.preview-size').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applicaDimensioneAnteprima(Number(btn.dataset.w), Number(btn.dataset.h));
    });
  });

  // Il ponte iniettato nella pagina parla con noi da qui.
  window.addEventListener('message', (e) => {
    if (!e.data || !e.data.__anteprima) return;
    aggiungiRigaConsole(e.data.tipo, e.data.testo);
  });
}

async function aggiornaAnteprima() {
  const selettore = document.getElementById('preview-page');
  const vuoto = document.getElementById('preview-empty');
  const frame = document.getElementById('preview-frame');
  if (!selettore) return;

  try {
    const res = await fetch('/api/preview-pages');
    const data = await res.json();
    const pagine = data.pagine || [];

    const precedente = selettore.value;
    selettore.innerHTML = '';
    pagine.forEach(nome => {
      const opt = document.createElement('option');
      opt.value = nome;
      opt.textContent = nome;
      selettore.appendChild(opt);
    });

    if (pagine.length === 0) {
      if (vuoto) vuoto.classList.remove('hidden');
      if (frame) frame.style.display = 'none';
      const url = document.getElementById('preview-url');
      if (url) url.textContent = '';
      return;
    }

    if (vuoto) vuoto.classList.add('hidden');
    if (frame) frame.style.display = '';
    const scelta = pagine.indexOf(precedente) !== -1 ? precedente : pagine[0];
    selettore.value = scelta;
    caricaPaginaAnteprima(scelta);
  } catch (e) {
    // Server non raggiungibile: l'anteprima resta com'e', senza rumore.
  }
}

function caricaPaginaAnteprima(pagina, forzaRicarica) {
  const frame = document.getElementById('preview-frame');
  const url = document.getElementById('preview-url');
  if (!frame || !pagina) return;
  svuotaConsoleAnteprima();
  // Il parametro anti-cache evita di rivedere la versione precedente dopo una modifica.
  const indirizzo = '/preview/' + encodeURIComponent(pagina) + '?t=' + Date.now();
  frame.src = indirizzo;
  if (url) url.textContent = indirizzo.split('?')[0];
}

function applicaDimensioneAnteprima(larghezza, altezza) {
  const frame = document.getElementById('preview-frame');
  if (!frame) return;
  if (!larghezza) {
    frame.classList.remove('dimensione-fissa');
    frame.style.width = '100%';
    frame.style.height = '100%';
    return;
  }
  frame.classList.add('dimensione-fissa');
  frame.style.width = larghezza + 'px';
  frame.style.height = altezza + 'px';
}

function aggiungiRigaConsole(livello, testo) {
  const corpo = document.getElementById('preview-console-body');
  const contatore = document.getElementById('preview-console-count');
  if (!corpo) return;

  messaggiAnteprima.push({ livello, testo });
  if (livello === 'error') erroriAnteprima++;

  const riga = document.createElement('div');
  riga.className = 'preview-riga ' + livello;
  riga.innerHTML = '<span class="livello">' + escapeHtml(livello) + '</span>' +
    '<span class="testo">' + escapeHtml(testo) + '</span>';
  corpo.appendChild(riga);
  corpo.scrollTop = corpo.scrollHeight;

  if (contatore) {
    contatore.textContent = String(messaggiAnteprima.length);
    contatore.classList.toggle('errori', erroriAnteprima > 0);
  }

  // Un errore vero merita di essere visto subito, senza dover aprire il pannello.
  if (livello === 'error') {
    const pannello = document.getElementById('preview-console');
    if (pannello) pannello.classList.remove('hidden');
  }
}

function svuotaConsoleAnteprima() {
  messaggiAnteprima = [];
  erroriAnteprima = 0;
  const corpo = document.getElementById('preview-console-body');
  const contatore = document.getElementById('preview-console-count');
  if (corpo) corpo.innerHTML = '';
  if (contatore) { contatore.textContent = '0'; contatore.classList.remove('errori'); }
}

// ============================================================
// 27. SCHERMATA DI AVVIO
// Il video dura una decina di secondi: non deve mai diventare un ostacolo, quindi
// e' saltabile con un clic o con Esc, e sparisce da solo se non parte (autoplay
// bloccato, file mancante, formato non supportato).
// ============================================================

function initBoot() {
  const overlay = document.getElementById('boot-overlay');
  const video = document.getElementById('boot-video');
  const skip = document.getElementById('boot-skip');
  const audio = document.getElementById('boot-audio');
  const progress = document.getElementById('boot-progress-bar');
  if (!overlay || !video) return;

  let chiuso = false;
  let timeoutSicurezza = null;

  function chiudiBoot(motivo) {
    if (chiuso) return;
    chiuso = true;
    if (timeoutSicurezza) clearTimeout(timeoutSicurezza);
    document.removeEventListener('keydown', tastoBoot);
    overlay.classList.add('uscita');
    video.pause();
    console.log('[Boot Video] Chiuso:', motivo);
    setTimeout(function () {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }, 600);
  }

  function tastoBoot(event) {
    if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      chiudiBoot('tastiera');
    }
  }

  function segnaPronto() {
    overlay.classList.add('pronto');
  }

  video.addEventListener('loadeddata', segnaPronto, { once: true });
  video.addEventListener('canplay', segnaPronto, { once: true });
  video.addEventListener('ended', function () { chiudiBoot('fine video'); }, { once: true });
  video.addEventListener('error', function () { chiudiBoot('video non disponibile'); }, { once: true });
  video.addEventListener('timeupdate', function () {
    if (!progress || !Number.isFinite(video.duration) || video.duration <= 0) return;
    progress.style.width = Math.min(100, (video.currentTime / video.duration) * 100) + '%';
  });

  if (skip) skip.addEventListener('click', function () { chiudiBoot('salta'); });
  if (audio) {
    audio.addEventListener('click', function () {
      video.muted = !video.muted;
      audio.setAttribute('aria-pressed', String(!video.muted));
      audio.textContent = video.muted ? 'Audio' : 'Audio attivo';
      if (video.paused) video.play().catch(function () {});
    });
  }
  document.addEventListener('keydown', tastoBoot);

  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    chiudiBoot('movimento ridotto');
    return;
  }

  if (video.readyState >= 2) segnaPronto();
  const riproduzione = video.play();
  if (riproduzione && typeof riproduzione.catch === 'function') {
    riproduzione.catch(function () { chiudiBoot('autoplay non disponibile'); });
  }
  timeoutSicurezza = setTimeout(function () { chiudiBoot('timeout di sicurezza'); }, 12000);
}

// ============================================================
// 28. "COSA VEDE ADAM"
// Controlla in un browser la STESSA pagina aperta nell'Anteprima, servita dalla
// stessa URL /preview. Prima erano due sorgenti diverse: si controllava una pagina
// e se ne mostrava un'altra, e bastava una piccola differenza perche' il giudizio
// di Adam non descrivesse piu' quello che l'utente aveva davanti.
// ============================================================

async function controllaPaginaAnteprima() {
  const btn = document.getElementById('btn-preview-check');
  const pannello = document.getElementById('preview-check');
  const corpo = document.getElementById('preview-check-body');
  const titolo = document.getElementById('preview-check-titolo');
  const pagina = document.getElementById('preview-page').value;
  if (!pannello || !corpo || !pagina) return;

  const originale = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Controllo...'; }
  pannello.classList.remove('hidden');
  corpo.innerHTML = '<div style="color:var(--text-muted)">Apro la pagina in un browser, la uso come una persona e misuro cosa succede...</div>';

  try {
    const res = await fetch('/api/runtime', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pagina: pagina, fix: false })
    });
    const data = await res.json();

    if (!data.disponibile) {
      corpo.innerHTML = '<div class="check-esito ko">Browser di controllo non disponibile</div>' +
        '<div style="color:var(--text-secondary)">' + escapeHtml(data.errore || '') + '</div>';
      return;
    }

    const pg = (data.pagine || [])[0];
    if (!pg) { corpo.innerHTML = '<div class="check-esito ko">Nessun esito.</div>'; return; }

    if (titolo) titolo.textContent = 'Cosa vede Adam — ' + pagina;
    const problemi = pg.problemi || [];

    let html = '<div class="check-esito ' + (problemi.length === 0 ? 'ok' : 'ko') + '">' +
      (problemi.length === 0
        ? '✓ Nessun problema: pagina caricata, nessun errore, comandi tutti cliccabili' +
          ((data.sonda && (data.sonda.note || []).some(n => /^Il pulsante principale non e' riapparso/.test(n)))
            ? ' (riavvio non provato)' : '')
        : '✕ ' + problemi.length + (problemi.length === 1 ? ' problema' : ' problemi')) +
      '</div>';

    if (pg.errore) {
      html += '<div style="color:#fca5a5">Errore di apertura: ' + escapeHtml(pg.errore) + '</div>';
    }
    if (problemi.length) {
      html += '<ul class="check-elenco">' + problemi.map(x =>
        '<li><span class="tipo">' + escapeHtml(x.tipo) + '</span>' + escapeHtml(x.messaggio) + '</li>'
      ).join('') + '</ul>';
    }
    if (data.sonda && data.sonda.pagina === pagina) html += htmlSonda(data.sonda);
    if (pg.screenshot) {
      html += '<div style="margin-top:10px;color:var(--text-muted);font-size:11px">' +
        'Questa e&#768; l&rsquo;immagine che riceve Adam:</div>' +
        '<img src="/api/screenshot/' + encodeURIComponent(pg.screenshot) + '" alt="pagina vista dal controllo">';
      html += '<div style="margin-top:10px"><button class="btn btn-secondary btn-sm" ' +
        'onclick="chiediAdAdamDiGuardare()">Chiedi ad Adam di guardarla</button></div>';
    }

    corpo.innerHTML = html;
  } catch (err) {
    corpo.innerHTML = '<div class="check-esito ko">Controllo non riuscito</div>' +
      '<div style="color:var(--text-secondary)">' + escapeHtml(err.message) + '</div>';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = originale || 'Cosa vede Adam'; }
  }
}

// Rimanda lo stesso controllo ad Adam, stavolta con l'immagine allegata.
async function chiediAdAdamDiGuardare() {
  const pagina = document.getElementById('preview-page').value;
  try {
    await fetch('/api/runtime', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pagina: pagina, fix: true })
    });
    const btnChat = document.getElementById('btn-view-chat');
    if (btnChat) btnChat.click();
  } catch (err) {
    alert('Invio ad Adam non riuscito: ' + err.message);
  }
}

// ============================================================
// 29. RAPPORTO DELLA SONDA
// Cosa succede quando la pagina viene USATA: l'azione compiuta, le variabili che
// cambiano nel tempo, i cicli di animazione al secondo e le schermate in sequenza.
// E' la stessa informazione che riceve Adam, cosi' si puo' giudicare il suo ragionamento.
// ============================================================

function htmlSonda(sonda) {
  if (!sonda) return '';
  if (sonda.errore) {
    return '<div style="margin-top:10px;color:#fca5a5">Sonda non riuscita: ' + escapeHtml(sonda.errore) + '</div>';
  }

  let html = '<div class="sonda-blocco"><div class="sonda-titolo">Cosa succede quando la usi</div>';

  if (sonda.azione) {
    const deviato = sonda.azione.ricevente && sonda.azione.ricevente !== sonda.azione.descr;
    html += '<div class="sonda-riga">Ho premuto <strong>' +
      escapeHtml(sonda.azione.testo || sonda.azione.descr) + '</strong> con un clic vero' +
      (deviato ? ', ma il clic &egrave; arrivato a <code>' + escapeHtml(sonda.azione.ricevente) + '</code>' : '') +
      ', poi ho mosso mouse e tasti.</div>';
  }

  // Cio' che la sonda non ha potuto provare va detto: una spunta verde senza questa riga
  // farebbe credere provato anche il riavvio (visto dal vivo: la navicella sopravviveva
  // e la partita non e' finita in tempo per ripremere "Riprova").
  (sonda.note || []).filter(n => /^(Il pulsante principale non e' riapparso|Nessun pulsante visibile)/.test(n))
    .forEach(n => { html += '<div class="sonda-riga sonda-nonprovato">Non provato: ' + escapeHtml(n) + '</div>'; });

  const momenti = sonda.momenti || [];
  const cambi = [];
  (sonda.osservate || []).forEach(k => {
    const seq = momenti.map(m => String(m.valori[k]));
    if (seq.length > 1 && seq.some(v => v !== seq[0])) cambi.push({ k, seq });
  });

  if (cambi.length) {
    html += '<div class="sonda-tabella-box"><table class="sonda-tabella"><thead><tr><th>variabile</th>' +
      momenti.map(m => '<th>' + escapeHtml(m.momento) + '</th>').join('') + '</tr></thead><tbody>' +
      cambi.map(c => '<tr><td><code>' + escapeHtml(c.k) + '</code></td>' +
        c.seq.map(v => '<td>' + escapeHtml(v.length > 48 ? v.slice(0, 46) + '...' : v) + '</td>').join('') +
        '</tr>').join('') +
      '</tbody></table></div>';
  } else if (momenti.length) {
    html += '<div class="sonda-riga">Nessuna delle variabili osservate cambia nel tempo.</div>';
  }

  if (momenti.some(m => m.rafAlSecondo !== null)) {
    html += '<div class="sonda-riga">Cicli di animazione al secondo: ' +
      momenti.map(m => escapeHtml(m.momento) + ' <strong>' +
        (m.rafAlSecondo === null ? '-' : m.rafAlSecondo) + '</strong>').join(' &middot; ') + '</div>';
  }

  if ((sonda.schermate || []).length) {
    html += '<div class="sonda-scatti">' + sonda.schermate.map(x =>
      '<figure><img src="/api/screenshot/' + encodeURIComponent(x.nome) + '" alt="' + escapeHtml(x.momento) +
      '"><figcaption>' + escapeHtml(x.momento) + '</figcaption></figure>').join('') + '</div>';
  }

  html += '</div>';
  return html;
}


