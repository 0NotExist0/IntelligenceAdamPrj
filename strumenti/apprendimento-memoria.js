// NotExist Intelligience Studio - Apprendimento Incrementale & Generazione Neuroni
//
// Questo modulo gestisce la crescita dinamica della memoria neurale di progetto:
// ogni volta che Adam programma (crea file, scrive script, aggiunge funzioni o classi),
// i file toccati vengono analizzati e trasformati in neuroni e sinapsi nella memoria
// INDIPENDENTE del progetto attivo (<projectDir>/.claude_memory.json).
// La memoria globale resta separata e dedicata alle regole generali e all'autonomia.

const fs = require('fs');
const path = require('path');

const ESTENSIONI_CODICE = new Set([
  '.cs', '.js', '.mjs', '.cjs', '.ts', '.py', '.html', '.htm', '.css', '.json', '.shader', '.hlsl'
]);

const CARTELLE_ESCLUSE = new Set([
  'node_modules', '.git', 'library', 'temp', 'obj', 'build', 'builds',
  'logs', 'usersettings', '__pycache__', '.venv', 'venv', 'dist', 'coverage'
]);

function eProgettoUnity(projectDir) {
  if (!projectDir) return false;
  return fs.existsSync(path.join(projectDir, 'Assets')) && fs.existsSync(path.join(projectDir, 'ProjectSettings'));
}

function eFileDiCodiceRilevante(filePath, isUnity = false) {
  if (!filePath || typeof filePath !== 'string') return false;
  if (filePath.endsWith('.meta')) return false; // File di metadati Unity

  const normalized = filePath.replace(/\\/g, '/');
  const parti = normalized.toLowerCase().split('/');
  for (const escl of CARTELLE_ESCLUSE) {
    if (parti.includes(escl)) return false;
  }

  const ext = path.extname(filePath).toLowerCase();

  // In un progetto Unity: consideriamo rilevanti SOLO gli script e file in Assets/ (es. .cs, .shader, .hlsl, .inputactions)
  // MAI file .js, .html, o package.json di Node!
  if (isUnity) {
    if (!normalized.startsWith('Assets/') && !normalized.includes('/Assets/')) return false;
    return ['.cs', '.shader', '.hlsl', '.compute', '.inputactions'].includes(ext);
  }

  return ESTENSIONI_CODICE.has(ext);
}

function sanitizeId(relPath) {
  return relPath.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
}

/**
 * Analizza il contenuto di un file di codice ed estrae classi, metodi, variabili e ruolo.
 */
function analizzaContenutoCodice(relPath, contenuto) {
  const ext = path.extname(relPath).toLowerCase();
  const righe = contenuto.split('\n');
  const numRighe = righe.length;

  const classi = [];
  const metodi = [];
  const campi = [];
  const importati = [];
  let eMonoBehaviour = false;
  let ruolo = 'Modulo di codice';

  if (ext === '.cs') {
    ruolo = 'Script C# Unity';
    for (const riga of righe) {
      const trim = riga.trim();
      if (trim.startsWith('//') || trim.startsWith('/*')) continue;

      // Classi C#
      const matchClasse = trim.match(/\bpublic\s+(?:abstract\s+|sealed\s+)?class\s+([A-Za-z0-9_]+)(?:\s*:\s*([A-Za-z0-9_,\s]+))?/);
      if (matchClasse) {
        const nomeCls = matchClasse[1];
        const ereditarieta = matchClasse[2] || '';
        if (ereditarieta.includes('MonoBehaviour')) eMonoBehaviour = true;
        classi.push(nomeCls + (ereditarieta ? ` : ${ereditarieta.trim()}` : ''));
      }

      // Metodi Unity o C#
      const matchMetodo = trim.match(/(?:public|private|protected|internal)?\s*(?:override|virtual|static|async)?\s*(?:void|int|float|bool|string|IEnumerator|Task|Vector3|Vector2|Transform|GameObject)\s+([A-Za-z0-9_]+)\s*\(/);
      if (matchMetodo) {
        const nomeMetodo = matchMetodo[1];
        if (!['if', 'for', 'while', 'switch', 'catch'].includes(nomeMetodo)) {
          metodi.push(nomeMetodo);
        }
      }

      // Campi serializzati o variabili pubbliche
      if (trim.includes('[SerializeField]') || /^(?:public|private)\s+(?:float|int|bool|string|Transform|GameObject|Rigidbody|Collider)\s+([A-Za-z0-9_]+)/.test(trim)) {
        const matchCampo = trim.match(/(?:float|int|bool|string|Transform|GameObject|Rigidbody|Collider)\s+([A-Za-z0-9_]+)/);
        if (matchCampo && !trim.includes('(')) {
          campi.push(matchCampo[1]);
        }
      }

      // Using
      const matchUsing = trim.match(/^using\s+([A-Za-z0-9_.]+);/);
      if (matchUsing) {
        importati.push(matchUsing[1]);
      }
    }
  } else if (['.js', '.mjs', '.cjs', '.ts'].includes(ext)) {
    ruolo = 'Script JavaScript/TypeScript';
    for (const riga of righe) {
      const trim = riga.trim();
      if (trim.startsWith('//') || trim.startsWith('/*')) continue;

      // Classi JS
      const matchClasse = trim.match(/\bclass\s+([A-Za-z0-9_]+)/);
      if (matchClasse) classi.push(matchClasse[1]);

      // Funzioni
      const matchFn = trim.match(/(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(|(?:const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s+)?\(/);
      if (matchFn) {
        const nome = matchFn[1] || matchFn[2];
        if (nome) metodi.push(nome);
      }

      // Import / Require
      const matchImp = trim.match(/(?:require\(['"]([^'"]+)['"]\)|import.*from\s+['"]([^'"]+)['"])/);
      if (matchImp) {
        importati.push(matchImp[1] || matchImp[2]);
      }
    }
  } else if (ext === '.py') {
    ruolo = 'Script Python';
    for (const riga of righe) {
      const trim = riga.trim();
      if (trim.startsWith('#')) continue;

      const matchCls = trim.match(/^class\s+([A-Za-z0-9_]+)/);
      if (matchCls) classi.push(matchCls[1]);

      const matchFn = trim.match(/^def\s+([A-Za-z0-9_]+)\s*\(/);
      if (matchFn) metodi.push(matchFn[1]);

      const matchImp = trim.match(/^(?:from|import)\s+([A-Za-z0-9_.]+)/);
      if (matchImp) importati.push(matchImp[1]);
    }
  } else if (['.html', '.htm'].includes(ext)) {
    ruolo = 'Interfaccia HTML';
    const ids = Array.from(new Set((contenuto.match(/id=["']([A-Za-z0-9_-]+)["']/g) || []).map(s => s.replace(/id=["']|["']/g, ''))));
    campi.push(...ids.slice(0, 10));
  } else if (ext === '.css') {
    ruolo = 'Fogli di stile CSS';
  }

  const classePrincipale = classi.length > 0 ? classi[0].split(':')[0].trim() : path.basename(relPath);
  const etichetta = eMonoBehaviour ? `${classePrincipale} (MonoBehaviour)` : (classi.length ? classePrincipale : path.basename(relPath));

  const tags = ['codice', ext.replace('.', ''), 'progetto'];
  if (eMonoBehaviour) tags.push('monobehaviour', 'unity');
  if (classi.length) tags.push('classe');
  if (metodi.length) tags.push('funzioni');

  const dettagli = [];
  dettagli.push(`${ruolo}: ${numRighe} righe.`);
  if (classi.length) dettagli.push(`Classi: ${classi.join(', ')}.`);
  if (metodi.length) dettagli.push(`Metodi (${metodi.length}): ${metodi.slice(0, 10).join(', ')}${metodi.length > 10 ? '...' : ''}.`);
  if (campi.length) dettagli.push(`Campi/ID: ${campi.slice(0, 8).join(', ')}.`);
  if (importati.length) dettagli.push(`Riferimenti: ${importati.slice(0, 6).join(', ')}.`);

  return {
    label: etichetta,
    tipo: 'data',
    value: dettagli.join(' '),
    tags: Array.from(new Set(tags)),
    classi,
    metodi,
    campi,
    importati,
    eMonoBehaviour,
    numRighe
  };
}

/**
 * Carica o crea la memoria specifica del progetto.
 */
function caricaMemoriaProgettoLocale(projectDir) {
  const memFile = path.join(projectDir, '.claude_memory.json');
  if (fs.existsSync(memFile)) {
    try {
      return JSON.parse(fs.readFileSync(memFile, 'utf8'));
    } catch (e) {
      console.error('[MemoriaProgetto] Errore lettura:', e.message);
    }
  }

  const folderName = path.basename(projectDir) || 'Progetto';
  return {
    projectName: folderName,
    projectPath: projectDir,
    updatedAt: new Date().toISOString(),
    nodes: [
      {
        id: 'proj_node_root',
        scope: 'project',
        type: 'data',
        label: `Progetto: ${folderName}`,
        value: `Cartella radice attiva: ${projectDir}`,
        tags: ['progetto', 'root'],
        synapses: [
          { targetId: 'proj_node_var_cwd', label: 'percorso', strength: 1.0 }
        ]
      },
      {
        id: 'proj_node_var_cwd',
        scope: 'project',
        type: 'variable',
        label: 'CWD: ' + folderName,
        value: projectDir,
        tags: ['variabile', 'path'],
        synapses: []
      },
      {
        id: 'proj_node_step_init',
        scope: 'project',
        type: 'step',
        label: 'Sessione Inizializzata',
        value: `Memoria di progetto attiva in ${projectDir}.`,
        tags: ['passaggio', 'avvio'],
        synapses: [
          { targetId: 'proj_node_root', label: 'associato a', strength: 0.9 }
        ]
      }
    ]
  };
}

/**
 * Salva la memoria del progetto garantendo timestamp aggiornato.
 */
function salvaMemoriaProgettoLocale(projectDir, data) {
  const memFile = path.join(projectDir, '.claude_memory.json');
  try {
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(memFile, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('[MemoriaProgetto] Errore salvataggio:', e.message);
    return false;
  }
}

/**
 * Apprende dai file modificati o creati da Adam e genera neuroni nel progetto.
 */
function aggiornaNeuroniDaFileModificati(projectDir, fileList = [], opzioni = {}) {
  if (!projectDir || !fs.existsSync(projectDir)) return { modificati: 0, nodiTotali: 0 };
  const safeList = Array.isArray(fileList) ? fileList : [];

  const mem = caricaMemoriaProgettoLocale(projectDir);
  if (!Array.isArray(mem.nodes)) mem.nodes = [];

  // Assicura radice
  let rootNode = mem.nodes.find(n => n.id === 'proj_node_root');
  if (!rootNode) {
    rootNode = {
      id: 'proj_node_root',
      scope: 'project',
      type: 'data',
      label: `Progetto: ${path.basename(projectDir)}`,
      value: `Cartella radice attiva: ${projectDir}`,
      tags: ['progetto', 'root'],
      synapses: []
    };
    mem.nodes.unshift(rootNode);
  }

  const isUnity = eProgettoUnity(projectDir);
  let neuroniAggiornati = 0;

  // Per Unity: ripulisci eventuali vecchi nodi web/non-Assets rimasti per errore
  if (isUnity && Array.isArray(mem.nodes)) {
    const prima = mem.nodes.length;
    mem.nodes = mem.nodes.filter(n => {
      if (!n.id || !n.id.startsWith('proj_code_')) return true;
      const id = n.id.toLowerCase();
      // Su Unity i codici del progetto DEVONO trovarsi in Assets/
      if (!id.includes('assets_')) return false;
      if (id.includes('_html') || id.includes('_main_js') || id.includes('_package_')) return false;
      return true;
    });
    if (mem.nodes.length < prima) {
      neuroniAggiornati++;
    }
  }

  // Prune dead synapses from rootNode
  if (rootNode && Array.isArray(rootNode.synapses)) {
    const validIds = new Set(mem.nodes.map(n => n.id));
    rootNode.synapses = rootNode.synapses.filter(s => validIds.has(s.targetId));
  }

  const neuroniCreatiNelTurno = [];

  for (const rawFile of safeList) {
    if (!rawFile) continue;
    const absPath = path.isAbsolute(rawFile) ? rawFile : path.join(projectDir, rawFile);
    const relPath = path.relative(projectDir, absPath).replace(/\\/g, '/');

    if (!eFileDiCodiceRilevante(relPath, isUnity)) continue;

    // Se il file non esiste più (eliminato da Adam)
    if (!fs.existsSync(absPath)) {
      const nodeId = `proj_code_${sanitizeId(relPath)}`;
      const idx = mem.nodes.findIndex(n => n.id === nodeId);
      if (idx >= 0) {
        mem.nodes.splice(idx, 1);
        neuroniAggiornati++;
      }
      continue;
    }

    let contenuto = '';
    try {
      contenuto = fs.readFileSync(absPath, 'utf8');
    } catch (e) {
      continue;
    }

    const info = analizzaContenutoCodice(relPath, contenuto);
    const nodeId = `proj_code_${sanitizeId(relPath)}`;

    const nodoEsistente = mem.nodes.find(n => n.id === nodeId);
    if (nodoEsistente) {
      nodoEsistente.label = info.label;
      nodoEsistente.value = `[${relPath}] ${info.value} Ultima modifica: ${new Date().toLocaleTimeString()}`;
      nodoEsistente.tags = info.tags;
      nodoEsistente.updatedAt = new Date().toISOString();
      neuroniCreatiNelTurno.push(nodoEsistente.id);
      neuroniAggiornati++;
    } else {
      const nuovoNodo = {
        id: nodeId,
        scope: 'project',
        type: 'data',
        label: info.label,
        value: `[${relPath}] ${info.value}`,
        tags: info.tags,
        synapses: [
          { targetId: 'proj_node_root', label: 'script di', strength: 0.9 }
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      mem.nodes.push(nuovoNodo);
      neuroniCreatiNelTurno.push(nuovoNodo.id);
      neuroniAggiornati++;

      // Connetti la root a questo nuovo file
      if (!rootNode.synapses) rootNode.synapses = [];
      if (!rootNode.synapses.some(s => s.targetId === nodeId)) {
        rootNode.synapses.push({ targetId: nodeId, label: 'include', strength: 0.8 });
      }
    }
  }

  // Se è stato specificato un passo completato o una feature creata, aggiungi o aggiorna un neurone 'step'
  if (opzioni.passo && typeof opzioni.passo === 'string' && opzioni.passo.trim()) {
    const stepId = 'proj_step_' + Date.now();
    const synapses = neuroniCreatiNelTurno.map(id => ({ targetId: id, label: 'ha modificato', strength: 0.85 }));
    synapses.push({ targetId: 'proj_node_root', label: 'avanzamento', strength: 0.7 });

    mem.nodes.unshift({
      id: stepId,
      scope: 'project',
      type: 'step',
      label: `Passo: ${opzioni.passo.trim().slice(0, 40)}`,
      value: `Eseguito: ${opzioni.passo.trim()}. File coinvolti: ${fileList.map(f => path.basename(f)).join(', ')}`,
      tags: ['passaggio', 'sviluppo', 'progresso'],
      synapses: synapses,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    neuroniAggiornati++;
  }

  if (neuroniAggiornati > 0) {
    salvaMemoriaProgettoLocale(projectDir, mem);
    console.log(`[MemoriaProgetto] Aggiornati ${neuroniAggiornati} neuroni per ${path.basename(projectDir)} (Totali: ${mem.nodes.length})`);
  }

  return {
    modificati: neuroniAggiornati,
    nodiTotali: mem.nodes.length,
    graphNodes: mem.nodes
  };
}

/**
 * Scansiona la cartella del progetto e popola i neuroni iniziali se la memoria è vuota o minimale.
 */
function scansionaEInizializzaNeuroniProgetto(projectDir) {
  if (!projectDir || !fs.existsSync(projectDir)) return { scansionati: 0 };

  const mem = caricaMemoriaProgettoLocale(projectDir);
  const nodiEsistenti = (mem.nodes || []).filter(n => n.id.startsWith('proj_code_'));

  // Se ci sono già neuroni di codice, non forzare la scansione completa per non appesantire
  if (nodiEsistenti.length >= 5) {
    return { scansionati: nodiEsistenti.length, totale: mem.nodes.length };
  }

  const isUnity = eProgettoUnity(projectDir);
  const startDir = isUnity ? path.join(projectDir, 'Assets') : projectDir;
  if (!fs.existsSync(startDir)) return { scansionati: 0, nodiTotali: (mem.nodes || []).length };

  const fileTrovati = [];
  function esplora(dir, prof = 0) {
    if (prof > 6 || fileTrovati.length >= 60) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }

    for (const ent of entries) {
      if (fileTrovati.length >= 60) break;
      const nome = ent.name;
      if (nome.startsWith('.') || CARTELLE_ESCLUSE.has(nome.toLowerCase())) continue;

      const full = path.join(dir, nome);
      if (ent.isDirectory()) {
        esplora(full, prof + 1);
      } else if (ent.isFile() && eFileDiCodiceRilevante(full, isUnity)) {
        fileTrovati.push(full);
      }
    }
  }

  esplora(startDir);

  if (fileTrovati.length > 0) {
    const res = aggiornaNeuroniDaFileModificati(projectDir, fileTrovati);
    return { scansionati: fileTrovati.length, nodiTotali: res.nodiTotali };
  }

  return { scansionati: 0, nodiTotali: (mem.nodes || []).length };
}

module.exports = {
  eProgettoUnity,
  eFileDiCodiceRilevante,
  analizzaContenutoCodice,
  caricaMemoriaProgettoLocale,
  salvaMemoriaProgettoLocale,
  aggiornaNeuroniDaFileModificati,
  scansionaEInizializzaNeuroniProgetto
};
