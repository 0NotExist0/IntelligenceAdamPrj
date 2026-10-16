// NotExist Intelligience Studio - Il cervello per i progetti Unity (C#) e le app Android fatte con Unity.
//
// Come verifico io uno script Unity: lo compilo con lo stesso compilatore e le stesse opzioni di
// Unity, leggo gli errori con file e riga, e guardo la Console (Editor.log) per gli errori a runtime.
// Unity salva in Library/Bee/artifacts/<dag>/<Assembly>.rsp il comando esatto con cui compila ogni
// assembly: lo si riusa scrivendo l'uscita in una cartella temporanea, senza toccare niente del
// progetto e senza aprire Unity. Misurato su FpsFire (15/9/2026): NotExist.Runtime, 26 file, 10 s la
// prima volta e 0,7 s le successive; un "transfrom" inserito apposta esce come CS0103 alla riga giusta.
//
// Poi i controlli che il compilatore non fa, ma che in Unity si sbagliano spesso:
//  - messaggi di MonoBehaviour scritti male (update, Updte): Unity non li chiama mai, in silenzio;
//  - OnTriggerEnter(Collision) e simili: tipo del parametro sbagliato;
//  - classe MonoBehaviour con nome diverso dal file: non si puo' aggiungere come componente;
//  - GetComponent/Find dentro Update: su telefono pesa a ogni fotogramma;
//  - app Android: identificativo del pacchetto di esempio, firma di debug, 64 bit per il Play Store.
//
// Uso: node cervello-unity.js <cartella> [--file Assets/Script.cs] [--senza-compilare] [--tutti]

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const MAX_FILE_CS = 3000;

function slash(p) { return String(p).split('\\').join('/'); }

// ------------------------------------------------------------ il progetto

function trovaProgettoUnity(dir) {
  let cartella = path.resolve(dir || '.');
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(cartella, 'Assets')) && fs.existsSync(path.join(cartella, 'ProjectSettings', 'ProjectVersion.txt'))) {
      return cartella;
    }
    const su = path.dirname(cartella);
    if (su === cartella) break;
    cartella = su;
  }
  return null;
}

function versioneEditor(radice) {
  try {
    const m = /m_EditorVersion:\s*(\S+)/.exec(fs.readFileSync(path.join(radice, 'ProjectSettings', 'ProjectVersion.txt'), 'utf8'));
    return m ? m[1] : null;
  } catch (e) {
    return null;
  }
}

// Il compilatore che Unity si porta dietro: stessa versione del progetto, altrimenti un'altra installata.
function trovaCompilatore(versione) {
  const basi = [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Unity', 'Hub', 'Editor')];
  const candidati = [];
  basi.forEach(function (base) {
    if (versione) candidati.push(path.join(base, versione, 'Editor'));
    try { fs.readdirSync(base).sort().reverse().forEach(function (v) { candidati.push(path.join(base, v, 'Editor')); }); } catch (e) {}
  });
  for (const editor of candidati) {
    const dotnet = path.join(editor, 'Data', 'NetCoreRuntime', 'dotnet.exe');
    const csc = path.join(editor, 'Data', 'DotNetSdkRoslyn', 'csc.dll');
    if (fs.existsSync(dotnet) && fs.existsSync(csc)) {
      return { editor: editor, dotnet: dotnet, csc: csc, versione: path.basename(path.dirname(editor)), stessaVersione: !versione || editor.indexOf(versione) !== -1 };
    }
  }
  return null;
}

function cartellaDag(radice) {
  const base = path.join(radice, 'Library', 'Bee', 'artifacts');
  let migliore = null;
  try {
    fs.readdirSync(base).filter(function (d) { return /\.dag$/.test(d); }).forEach(function (d) {
      const completo = path.join(base, d);
      const rsp = fs.readdirSync(completo).filter(function (f) { return /^Assembly-CSharp\.rsp$/.test(f) || /\.rsp$/.test(f); });
      if (!rsp.length) return;
      const recente = Math.max.apply(null, rsp.map(function (f) { return fs.statSync(path.join(completo, f)).mtimeMs; }));
      if (!migliore || recente > migliore.recente) migliore = { cartella: completo, recente: recente };
    });
  } catch (e) { /* progetto mai aperto in Unity */ }
  return migliore ? migliore.cartella : null;
}

function elencaCs(radice) {
  const trovati = [];
  function scendi(cartella) {
    let voci;
    try { voci = fs.readdirSync(cartella, { withFileTypes: true }); } catch (e) { return; }
    for (const v of voci) {
      if (trovati.length >= MAX_FILE_CS) return;
      const completo = path.join(cartella, v.name);
      if (v.isDirectory()) {
        if (v.name.startsWith('.') || /~$/.test(v.name)) continue;   // cartelle nascoste o ignorate da Unity
        scendi(completo);
      } else if (/\.cs$/i.test(v.name)) {
        trovati.push(slash(path.relative(radice, completo)));
      }
    }
  }
  scendi(path.join(radice, 'Assets'));
  return trovati;
}

// L'assembly che contiene un file: il primo .asmdef salendo, altrimenti le regole di Unity.
function assemblyDelFile(radice, fileRel) {
  let cartella = path.dirname(path.join(radice, fileRel));
  while (cartella.length >= radice.length) {
    let asmdef = null;
    try { asmdef = fs.readdirSync(cartella).find(function (f) { return /\.asmdef$/i.test(f); }); } catch (e) { asmdef = null; }
    if (asmdef) {
      try { return JSON.parse(fs.readFileSync(path.join(cartella, asmdef), 'utf8')).name; } catch (e) { return path.basename(asmdef, '.asmdef'); }
    }
    const su = path.dirname(cartella);
    if (su === cartella) break;
    cartella = su;
  }
  const rel = slash(fileRel);
  const firstpass = /^Assets\/(Plugins|Standard Assets|Pro Standard Assets)\//i.test(rel);
  const editor = rel.split('/').indexOf('Editor') !== -1;
  return 'Assembly-CSharp' + (firstpass ? '-firstpass' : '') + (editor ? '-Editor' : '');
}

// ------------------------------------------------------------ compilazione

function preparaRsp(radice, dag, assembly, cartellaTemp) {
  const originale = path.join(dag, assembly + '.rsp');
  if (!fs.existsSync(originale)) return null;
  const sorgenti = [];
  const opzioni = [];
  fs.readFileSync(originale, 'utf8').split(/\r?\n/).forEach(function (riga) {
    const r = riga.trim();
    if (!r || /^-refout:/.test(r)) return;
    if (/^-out:/.test(r)) { opzioni.push('-out:"' + slash(path.join(cartellaTemp, assembly + '.dll')) + '"'); return; }
    if (/^"[^"]+\.cs"$/i.test(r)) { sorgenti.push(r.slice(1, -1)); return; }
    opzioni.push(r);
  });
  // Il comando di Unity e' dell'ultima volta che Unity ha compilato: via i file cancellati, dentro i
  // file nuovi delle stesse cartelle (non delle sottocartelle, che possono avere un loro .asmdef).
  const attuali = sorgenti.filter(function (s) { return fs.existsSync(path.join(radice, s)); });
  const visti = new Set(attuali.map(function (s) { return s.toLowerCase(); }));
  new Set(attuali.map(function (s) { return path.posix.dirname(slash(s)); })).forEach(function (c) {
    try {
      fs.readdirSync(path.join(radice, c)).forEach(function (f) {
        const rel = c + '/' + f;
        if (/\.cs$/i.test(f) && !visti.has(rel.toLowerCase())) { attuali.push(rel); visti.add(rel.toLowerCase()); }
      });
    } catch (e) { /* cartella sparita */ }
  });
  const file = path.join(cartellaTemp, assembly + '.rsp');
  fs.writeFileSync(file, opzioni.concat(attuali.map(function (s) { return '"' + slash(s) + '"'; })).join('\n'));
  return { rsp: file, sorgenti: attuali };
}

function eseguiCompilatore(compilatore, radice, rsp) {
  return new Promise(function (risolvi) {
    const inizio = Date.now();
    execFile(compilatore.dotnet, ['exec', compilatore.csc, '@' + rsp], {
      cwd: radice, timeout: 240000, maxBuffer: 20 * 1024 * 1024, windowsHide: true
    }, function (err, stdout, stderr) {
      risolvi({ uscita: String(stdout || '') + String(stderr || ''), codice: err ? (err.code || 1) : 0, durataMs: Date.now() - inizio, scaduto: !!(err && err.killed) });
    });
  });
}

function leggiErroriCompilatore(radice, testo) {
  const errori = [];
  const visti = new Set();
  String(testo).split(/\r?\n/).forEach(function (riga) {
    const m = /^(.*?)\((\d+),(\d+)\):\s*(error|warning)\s+(CS\d+):\s*(.*)$/.exec(riga.trim());
    if (!m || m[4] !== 'error') return;
    let file = m[1];
    if (path.isAbsolute(file)) file = path.relative(radice, file);
    file = slash(file);
    const chiave = file + ':' + m[2] + ':' + m[5];
    if (visti.has(chiave)) return;
    visti.add(chiave);
    errori.push({ file: file, riga: Number(m[2]), colonna: Number(m[3]), codice: m[5], messaggio: m[6] });
  });
  return errori;
}

// Gli assembly da compilare: quelli dei file indicati, oppure quelli con script modificati dopo
// l'ultima compilazione di Unity (cosi' non si ricompila tutto ogni volta).
function assemblyDaCompilare(radice, dag, file, tutti) {
  const nomi = new Set();
  const elenco = file && file.length ? file.map(slash) : elencaCs(radice);
  elenco.forEach(function (f) {
    if (!/\.cs$/i.test(f)) return;
    const assembly = assemblyDelFile(radice, f);
    if (tutti || (file && file.length)) { nomi.add(assembly); return; }
    const dll = path.join(radice, 'Library', 'ScriptAssemblies', assembly + '.dll');
    try {
      if (!fs.existsSync(dll) || fs.statSync(path.join(radice, f)).mtimeMs > fs.statSync(dll).mtimeMs) nomi.add(assembly);
    } catch (e) { /* file sparito nel frattempo */ }
  });
  return Array.from(nomi).filter(function (a) { return fs.existsSync(path.join(dag, a + '.rsp')); });
}

// ------------------------------------------------------------ console di Unity

function leggiCoda(file, byte) {
  const st = fs.statSync(file);
  const quanti = Math.min(st.size, byte);
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(quanti);
    fs.readSync(fd, buf, 0, quanti, st.size - quanti);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function leggiInizio(file, byte) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(Math.min(fs.statSync(file).size, byte));
    fs.readSync(fd, buf, 0, buf.length, 0);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

// Una riga dello stack ("UnityEngine.Debug:LogException(Exception)", "Gioco:Update () (at ...)")
// contiene spesso la parola Exception ma non e' un errore: l'errore e' la riga che lo stack segue.
const RIGA_DI_STACK = /^[\w.<>+`$|\[\],]+:[^\s(]+\s*\(/;
const INTESTAZIONE_ERRORE = /^(?:[A-Za-z_][\w.]*?)?(?:Exception|Error)(?::\s|\s*$)/;

function erroriDellaConsole(radice, fileLog) {
  const log = fileLog || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Unity', 'Editor', 'Editor.log');
  if (!fs.existsSync(log)) return { disponibile: false };
  const st = fs.statSync(log);
  // Il percorso del progetto sta nella riga di comando, in cima al log di quella sessione dell'editor.
  const progetto = slash(radice).toLowerCase();
  if (slash(leggiInizio(log, 64000)).toLowerCase().indexOf(progetto) === -1) return { disponibile: true, altroProgetto: true, quando: st.mtime };
  const righe = leggiCoda(log, 3 * 1024 * 1024).split(/\r?\n/);
  const compilazione = [];
  const runtime = [];
  const visti = new Set();
  for (let i = 0; i < righe.length; i++) {
    const r = righe[i].trim();
    const c = /^(Assets\/[^(]+\.cs)\((\d+),(\d+)\):\s*error\s+(CS\d+):\s*(.+)$/.exec(r);
    if (c) {
      const k = 'c|' + c[1] + ':' + c[2] + ':' + c[4];
      if (!visti.has(k)) { visti.add(k); compilazione.push({ file: c[1], riga: Number(c[2]), codice: c[4], messaggio: c[5] }); }
      continue;
    }
    if (!INTESTAZIONE_ERRORE.test(r) || RIGA_DI_STACK.test(r)) continue;
    // Il file e la riga sono quelli del primo punto dello stack che sta negli Assets del progetto,
    // prima che cominci un altro messaggio.
    for (let k = i + 1; k < Math.min(righe.length, i + 25); k++) {
      const riga = righe[k].trim();
      if (!riga) break;
      if (INTESTAZIONE_ERRORE.test(riga) && !RIGA_DI_STACK.test(riga)) break;
      const s = /\(at (Assets\/[^:)]+):(\d+)\)/.exec(riga);
      if (s) {
        const chiave = 'r|' + r + '|' + s[1] + ':' + s[2];
        if (!visti.has(chiave)) { visti.add(chiave); runtime.push({ file: s[1], riga: Number(s[2]), messaggio: r.slice(0, 300) }); }
        break;
      }
    }
  }
  return { disponibile: true, quando: st.mtime, compilazione: compilazione.slice(-20), runtime: runtime.slice(-10) };
}

// ------------------------------------------------------------ controlli su C#

// Commenti e stringhe sostituiti da spazi (a capo compresi): le graffe dentro una stringa non
// devono confondere la struttura, e le righe restano giuste.
function togliCommentiEStringhe(codice) {
  let out = '';
  let i = 0;
  const n = codice.length;
  const sbianca = function (da, a) { out += codice.slice(da, a).replace(/[^\n]/g, ' '); };
  while (i < n) {
    const c = codice[i];
    const d = codice[i + 1];
    if (c === '/' && d === '/') { const f = codice.indexOf('\n', i); const a = f === -1 ? n : f; sbianca(i, a); i = a; continue; }
    if (c === '/' && d === '*') { const f = codice.indexOf('*/', i + 2); const a = f === -1 ? n : f + 2; sbianca(i, a); i = a; continue; }
    const verbatim = (c === '@' && d === '"') || ((c === '$' && d === '@') || (c === '@' && d === '$')) && codice[i + 2] === '"';
    if (verbatim) {
      let j = codice.indexOf('"', i) + 1;
      while (j < n) { if (codice[j] === '"') { if (codice[j + 1] === '"') { j += 2; continue; } j++; break; } j++; }
      sbianca(i, j); i = j; continue;
    }
    if (c === '"' || (c === '$' && d === '"')) {
      let j = codice.indexOf('"', i) + 1;
      while (j < n && codice[j] !== '"' && codice[j] !== '\n') { if (codice[j] === '\\') j++; j++; }
      j = Math.min(n, j + 1);
      sbianca(i, j); i = j; continue;
    }
    if (c === '\'') {
      let j = i + 1;
      while (j < n && codice[j] !== '\'' && codice[j] !== '\n') { if (codice[j] === '\\') j++; j++; }
      j = Math.min(n, j + 1);
      sbianca(i, j); i = j; continue;
    }
    out += c;
    i++;
  }
  return out;
}

function rigaDi(testo, pos) {
  let r = 1;
  for (let i = 0; i < pos && i < testo.length; i++) if (testo.charCodeAt(i) === 10) r++;
  return r;
}

function fineBlocco(testo, apertura) {
  let prof = 0;
  for (let j = apertura; j < testo.length; j++) {
    if (testo[j] === '{') prof++;
    else if (testo[j] === '}') { prof--; if (prof === 0) return j; }
  }
  return testo.length;
}

function classiDelFile(pulito) {
  const classi = [];
  const re = /\b(class|struct)\s+([A-Za-z_]\w*)\s*(?:<[^>{;]*>)?\s*(?::\s*([^{;]+?))?\s*(?:where\s+[^{;]+)?\{/g;
  let m;
  while ((m = re.exec(pulito)) !== null) {
    const apertura = m.index + m[0].length - 1;
    const basi = (m[3] || '').split(',').map(function (s) { return s.trim().replace(/<.*$/, '').split('.').pop(); }).filter(Boolean);
    classi.push({ tipo: m[1], nome: m[2], basi: basi, apertura: apertura, chiusura: fineBlocco(pulito, apertura), riga: rigaDi(pulito, m.index) });
  }
  return classi;
}

// Metodi dichiarati direttamente nella classe (non in classi annidate).
function metodiDellaClasse(pulito, classe) {
  const corpo = pulito.slice(classe.apertura + 1, classe.chiusura);
  let livello = '';
  let prof = 0;
  for (const ch of corpo) {
    // la graffa che apre un metodo resta: e' quella che dice "qui comincia un corpo"
    if (ch === '{') { livello += prof === 0 ? '{' : ' '; prof++; continue; }
    if (ch === '}') { prof--; livello += prof === 0 ? '}' : ' '; continue; }
    livello += (prof === 0 || ch === '\n') ? ch : ' ';
  }
  const metodi = [];
  const re = /((?:(?:public|private|protected|internal|static|virtual|override|sealed|async|new|unsafe)\s+)*)([A-Za-z_][\w<>\[\],.?]*)\s+([A-Za-z_]\w*)\s*\(([^()]*)\)\s*(?=\{|=>)/g;
  let m;
  while ((m = re.exec(livello)) !== null) {
    if (/^(if|for|foreach|while|switch|using|lock|return|new|else|catch)$/.test(m[2])) continue;
    const posizione = classe.apertura + 1 + m.index + m[1].length;
    const graffa = pulito.indexOf('{', classe.apertura + 1 + m.index + m[0].length - 1);
    metodi.push({
      nome: m[3], ritorno: m[2], parametri: m[4].trim(), riga: rigaDi(pulito, posizione),
      corpo: graffa !== -1 && graffa < classe.chiusura ? pulito.slice(graffa, fineBlocco(pulito, graffa) + 1) : ''
    });
  }
  return metodi;
}

// I messaggi che Unity chiama da solo, con i tipi dei parametri quando ci sono.
const MESSAGGI_UNITY = {
  Awake: [], Start: [], Update: [], FixedUpdate: [], LateUpdate: [], OnEnable: [], OnDisable: [], OnDestroy: [],
  OnValidate: [], Reset: [], OnGUI: [], OnApplicationQuit: [], OnApplicationPause: ['bool'], OnApplicationFocus: ['bool'],
  OnBecameVisible: [], OnBecameInvisible: [], OnDrawGizmos: [], OnDrawGizmosSelected: [],
  OnCollisionEnter: ['Collision'], OnCollisionStay: ['Collision'], OnCollisionExit: ['Collision'],
  OnTriggerEnter: ['Collider'], OnTriggerStay: ['Collider'], OnTriggerExit: ['Collider'],
  OnCollisionEnter2D: ['Collision2D'], OnCollisionStay2D: ['Collision2D'], OnCollisionExit2D: ['Collision2D'],
  OnTriggerEnter2D: ['Collider2D'], OnTriggerStay2D: ['Collider2D'], OnTriggerExit2D: ['Collider2D'],
  OnControllerColliderHit: ['ControllerColliderHit'], OnParticleCollision: ['GameObject'],
  OnMouseDown: [], OnMouseUp: [], OnMouseEnter: [], OnMouseExit: [], OnMouseOver: [], OnMouseDrag: [], OnMouseUpAsButton: [],
  OnAnimatorIK: ['int'], OnAnimatorMove: [], OnRenderObject: [], OnWillRenderObject: [], OnPreRender: [], OnPostRender: [],
  OnRenderImage: ['RenderTexture', 'RenderTexture'], OnTransformParentChanged: [], OnTransformChildrenChanged: [],
  OnRectTransformDimensionsChange: [], OnJointBreak: ['float'], OnJointBreak2D: ['Joint2D'], OnCanvasGroupChanged: []
};
const NOMI_MESSAGGI = Object.keys(MESSAGGI_UNITY);

function distanza(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = [];
  for (let i = 0; i <= a.length; i++) d[i] = [i];
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

function tipoDelParametro(parametro) {
  const parti = parametro.replace(/\b(in|ref|out|params|this)\s+/g, '').trim().split(/\s+/);
  return (parti[0] || '').replace(/^UnityEngine\./, '');
}

function controlliSulCodice(radice, fileDaGuardare) {
  const problemi = [];
  const tuttiICs = elencaCs(radice).filter(function (f) { return !/^Assets\/(Plugins|ThirdParty|TextMesh Pro)\//i.test(f); });
  const schede = [];
  tuttiICs.forEach(function (f) {
    let testo;
    try { testo = fs.readFileSync(path.join(radice, f), 'utf8'); } catch (e) { return; }
    const pulito = togliCommentiEStringhe(testo);
    schede.push({ file: f, pulito: pulito, classi: classiDelFile(pulito) });
  });
  // Quali classi sono MonoBehaviour, anche passando per classi del progetto.
  const basiDi = new Map();
  schede.forEach(function (s) { s.classi.forEach(function (c) { basiDi.set(c.nome, c.basi); }); });
  const comportamenti = new Set(['MonoBehaviour', 'NetworkBehaviour']);
  let cresciuto = true;
  while (cresciuto) {
    cresciuto = false;
    basiDi.forEach(function (basi, nome) {
      if (!comportamenti.has(nome) && basi.some(function (b) { return comportamenti.has(b); })) { comportamenti.add(nome); cresciuto = true; }
    });
  }
  const daGuardare = fileDaGuardare && fileDaGuardare.length ? new Set(fileDaGuardare.map(function (f) { return slash(f).toLowerCase(); })) : null;
  schede.forEach(function (s) {
    if (daGuardare && !daGuardare.has(s.file.toLowerCase())) return;
    const nomeFile = path.basename(s.file, '.cs');
    const monoDelFile = s.classi.filter(function (c) { return c.tipo === 'class' && comportamenti.has(c.nome) && c.nome !== 'MonoBehaviour'; });
    if (monoDelFile.length && !monoDelFile.some(function (c) { return c.nome === nomeFile; }) && monoDelFile.length === 1) {
      problemi.push({ file: s.file, riga: monoDelFile[0].riga, grave: false, chiave: s.file + '|nome-file',
        messaggio: 'la classe ' + monoDelFile[0].nome + ' e\' un MonoBehaviour ma il file si chiama ' + nomeFile + '.cs: Unity non la mostra fra i componenti da aggiungere. Il file deve chiamarsi ' + monoDelFile[0].nome + '.cs.' });
    }
    monoDelFile.forEach(function (classe) {
      metodiDellaClasse(s.pulito, classe).forEach(function (metodo) {
        const attesi = MESSAGGI_UNITY[metodo.nome];
        if (attesi) {
          if (attesi.length && metodo.parametri) {
            const tipi = metodo.parametri.split(',').map(tipoDelParametro);
            if (tipi[0] && attesi[0] && tipi[0] !== attesi[0]) {
              problemi.push({ file: s.file, riga: metodo.riga, grave: true, chiave: s.file + '|parametro:' + classe.nome + '.' + metodo.nome,
                messaggio: metodo.nome + '(' + tipi[0] + ') ha il parametro sbagliato: Unity vuole ' + metodo.nome + '(' + attesi.join(', ') +
                  ') e con un altro tipo segnala errore e non lo chiama.' + (/Collision/.test(tipi[0]) && /Trigger/.test(metodo.nome)
                  ? ' Per gli urti fisici (senza "Is Trigger") usa OnCollisionEnter(Collision).' : '') });
            }
          }
          if (/^(Update|FixedUpdate|LateUpdate)$/.test(metodo.nome) && /\b(GetComponent\s*[<(]|GameObject\.Find\s*\(|FindObjectOfType|FindObjectsOfType|FindFirstObjectByType|FindObjectsByType)/.test(metodo.corpo)) {
            problemi.push({ file: s.file, riga: metodo.riga, grave: false, chiave: s.file + '|cerca-in-update:' + classe.nome,
              messaggio: 'in ' + classe.nome + '.' + metodo.nome + '() c\'e\' GetComponent o Find: vengono eseguiti a ogni fotogramma e su telefono pesano. Cercalo una volta in Awake o Start e salvalo in una variabile.' });
          }
          return;
        }
        const chiamato = new RegExp('\\b' + metodo.nome + '\\s*\\(').test(s.pulito.slice(0, s.pulito.length).replace(new RegExp('\\b' + metodo.ritorno.replace(/[^\w]/g, '\\$&') + '\\s+' + metodo.nome + '\\s*\\('), ''));
        const stessoNome = NOMI_MESSAGGI.find(function (k) { return k.toLowerCase() === metodo.nome.toLowerCase(); });
        if (stessoNome && !chiamato) {
          problemi.push({ file: s.file, riga: metodo.riga, grave: true, chiave: s.file + '|maiuscole:' + classe.nome + '.' + metodo.nome,
            messaggio: metodo.nome + '() non viene mai chiamato da Unity: il nome giusto e\' ' + stessoNome + ' (maiuscole e minuscole contano).' });
          return;
        }
        const vicino = metodo.nome.length >= 5 && NOMI_MESSAGGI.find(function (k) { return k.length >= 5 && distanza(metodo.nome, k) <= 2 && k !== metodo.nome; });
        if (vicino && !chiamato && /^(void|IEnumerator)$/.test(metodo.ritorno)) {
          problemi.push({ file: s.file, riga: metodo.riga, grave: false, chiave: s.file + '|simile:' + classe.nome + '.' + metodo.nome,
            messaggio: metodo.nome + '() somiglia al messaggio di Unity ' + vicino + '() ma e\' scritto diverso: se doveva essere quello, Unity non lo chiamera\' mai.' });
        }
      });
    });
  });
  return { problemi: problemi, file: schede.length, comportamenti: comportamenti.size - 2 };
}

// ------------------------------------------------------------ app Android

function valoreImpostazione(testo, chiave) {
  const m = new RegExp('^\\s*' + chiave + ':\\s*(.*)$', 'm').exec(testo);
  return m ? m[1].trim() : null;
}

function valorePiattaforma(testo, chiave, piattaforma) {
  const m = new RegExp('^[ \\t]*' + chiave + ':[ \\t]*\\r?\\n((?:[ \\t]{4,}.*(?:\\r?\\n|$))+)', 'm').exec(testo);
  if (!m) return null;
  const riga = new RegExp('^\\s*' + piattaforma + ':\\s*(.*)$', 'm').exec(m[1]);
  return riga ? riga[1].trim() : null;
}

function controlliAndroid(radice) {
  const file = path.join(radice, 'ProjectSettings', 'ProjectSettings.asset');
  let testo;
  try { testo = fs.readFileSync(file, 'utf8'); } catch (e) { return { problemi: [], android: false }; }
  const rel = 'ProjectSettings/ProjectSettings.asset';
  const riga = function (chiave) {
    const i = testo.search(new RegExp('^\\s*' + chiave + ':', 'm'));
    return i === -1 ? 1 : rigaDi(testo, i);
  };
  const problemi = [];
  const avviso = function (chiave, messaggio) { problemi.push({ file: rel, riga: riga(chiave), grave: false, chiave: rel + '|android:' + chiave, messaggio: messaggio }); };
  const id = valorePiattaforma(testo, 'applicationIdentifier', 'Android');
  const azienda = valoreImpostazione(testo, 'companyName');
  const backend = valorePiattaforma(testo, 'scriptingBackend', 'Android');
  const architetture = Number(valoreImpostazione(testo, 'AndroidTargetArchitectures'));
  const minSdk = Number(valoreImpostazione(testo, 'AndroidMinSdkVersion'));
  const firma = valoreImpostazione(testo, 'androidUseCustomKeystore');
  const android = id !== null || !isNaN(minSdk);
  if (!android) return { problemi: problemi, android: false };
  if (id && /com\.(UnityTechnologies|Unity-Technologies|DefaultCompany)|template/i.test(id)) {
    avviso('applicationIdentifier', 'l\'identificativo Android e\' ancora quello del modello di Unity (' + id + '): per il Play Store deve essere unico e tuo (per esempio com.tuonome.nomegioco) e dopo la pubblicazione non si puo\' piu\' cambiare.');
  }
  if (azienda === 'DefaultCompany') avviso('companyName', 'il nome dell\'azienda e\' ancora DefaultCompany: finisce nel percorso dei salvataggi sul telefono e nelle informazioni dell\'app.');
  if (backend !== null && backend !== '1') avviso('scriptingBackend', 'il backend degli script per Android non e\' IL2CPP: il Play Store vuole app a 64 bit (ARM64), che richiedono IL2CPP.');
  if (!isNaN(architetture) && !(architetture & 2)) avviso('AndroidTargetArchitectures', 'l\'architettura ARM64 non e\' selezionata: il Play Store rifiuta le app senza 64 bit.');
  if (!isNaN(minSdk) && minSdk > 0 && minSdk < 23) avviso('AndroidMinSdkVersion', 'la versione minima di Android e\' ' + minSdk + ': Unity 6 richiede almeno 23 (Android 6).');
  if (firma === '0') avviso('androidUseCustomKeystore', 'l\'app e\' firmata con la chiave di debug: va bene per provarla sul telefono, ma per pubblicarla sul Play Store serve un keystore tuo (Player Settings > Publishing Settings), da conservare con cura.');
  return { problemi: problemi, android: true, id: id, minSdk: minSdk };
}

// ------------------------------------------------------------ tutto insieme

async function analizzaUnity(dir, opzioni) {
  opzioni = opzioni || {};
  const radice = trovaProgettoUnity(dir);
  if (!radice) return null;
  const inizio = Date.now();
  const esito = { radice: radice, versione: versioneEditor(radice), problemi: [], compilati: [], note: [], console: null, durataMs: 0 };
  const file = (opzioni.file || []).map(function (f) { return slash(path.isAbsolute(f) ? path.relative(radice, f) : f); })
    .filter(function (f) { return /\.cs$/i.test(f); });

  const codice = controlliSulCodice(radice, file.length ? file : null);
  codice.problemi.forEach(function (p) { esito.problemi.push(p); });
  esito.fileCs = codice.file;

  const android = controlliAndroid(radice);
  esito.android = android.android;
  if (opzioni.android !== false) android.problemi.forEach(function (p) { esito.problemi.push(p); });

  if (opzioni.compila !== false) {
    const compilatore = trovaCompilatore(esito.versione);
    const dag = cartellaDag(radice);
    if (!compilatore) {
      esito.note.push('Il compilatore di Unity non si trova: installa Unity ' + (esito.versione || '') + ' dall\'Hub per poter controllare gli script senza aprire l\'editor.');
    } else if (!dag) {
      esito.note.push('Unity non ha ancora compilato questo progetto su questo computer: aprilo una volta nell\'editor, poi i controlli funzionano anche senza.');
    } else {
      const assembly = assemblyDaCompilare(radice, dag, file, !!opzioni.tutti);
      if (!compilatore.stessaVersione) esito.note.push('Compilo con Unity ' + compilatore.versione + ' perche\' la ' + esito.versione + ' del progetto non e\' installata.');
      const cartellaTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'cervello-unity-'));
      try {
        for (const a of assembly) {
          const pronto = preparaRsp(radice, dag, a, cartellaTemp);
          if (!pronto) continue;
          const r = await eseguiCompilatore(compilatore, radice, pronto.rsp);
          const errori = leggiErroriCompilatore(radice, r.uscita);
          esito.compilati.push({ assembly: a, file: pronto.sorgenti.length, errori: errori.length, durataMs: r.durataMs, scaduto: r.scaduto });
          errori.forEach(function (e) {
            esito.problemi.push({ file: e.file, riga: e.riga, grave: true, chiave: e.file + '|' + e.codice + ':' + e.messaggio.replace(/\d+/g, '#'),
              messaggio: 'errore di compilazione ' + e.codice + ' (colonna ' + e.colonna + '): ' + e.messaggio + '. Finche\' c\'e\' questo errore Unity non esegue nessuno script del progetto.' });
          });
          if (r.scaduto) esito.note.push('La compilazione di ' + a + ' ci ha messo troppo ed e\' stata fermata.');
        }
      } finally {
        try { fs.rmSync(cartellaTemp, { recursive: true, force: true }); } catch (e) {}
      }
      if (!assembly.length) esito.note.push('Nessuno script cambiato dall\'ultima compilazione di Unity: niente da ricompilare.');
    }
  }

  if (opzioni.console !== false) {
    const console = erroriDellaConsole(radice);
    esito.console = console;
    if (console.disponibile && !console.altroProgetto) {
      const ora = new Date(console.quando);
      const quando = ora.toLocaleDateString('it-IT') + ' ' + ora.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
      (console.runtime || []).forEach(function (e) {
        esito.problemi.push({ file: e.file, riga: e.riga, grave: false, chiave: e.file + '|console:' + e.messaggio.replace(/\d+/g, '#').slice(0, 120),
          messaggio: 'nella Console di Unity (ultima sessione, ' + quando + '): ' + e.messaggio });
      });
    }
  }

  const visti = new Set();
  esito.problemi = esito.problemi.filter(function (p) { if (visti.has(p.chiave)) return false; visti.add(p.chiave); return true; })
    .sort(function (x, y) { return (y.grave - x.grave) || x.file.localeCompare(y.file) || (x.riga - y.riga); });
  esito.durataMs = Date.now() - inizio;
  return esito;
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const dir = argv.find(function (a) { return !a.startsWith('--'); }) || process.cwd();
  const file = [];
  argv.forEach(function (a, i) { if (a === '--file' && argv[i + 1]) file.push(argv[i + 1]); });
  analizzaUnity(dir, { file: file, compila: argv.indexOf('--senza-compilare') === -1, tutti: argv.indexOf('--tutti') !== -1 }).then(function (r) {
    if (!r) { console.log('Non e\' un progetto Unity (mancano Assets e ProjectSettings).'); return process.exit(0); }
    console.log('Progetto Unity ' + r.versione + ' - ' + r.fileCs + ' script C#, analizzati in ' + r.durataMs + ' ms');
    r.compilati.forEach(function (c) { console.log('  compilato ' + c.assembly + ': ' + c.file + ' file, ' + c.errori + ' errori, ' + c.durataMs + ' ms'); });
    r.note.forEach(function (n) { console.log('  nota: ' + n); });
    if (!r.problemi.length) console.log('Nessun problema.');
    r.problemi.slice(0, 40).forEach(function (p) { console.log((p.grave ? 'GRAVE  ' : 'DA CONTROLLARE  ') + p.file + ':' + p.riga + '  ' + p.messaggio); });
    process.exit(0);
  }, function (e) { console.log('Errore interno: ' + e.message); process.exit(1); });
}

module.exports = {
  trovaProgettoUnity: trovaProgettoUnity,
  analizzaUnity: analizzaUnity,
  assemblyDelFile: assemblyDelFile,
  togliCommentiEStringhe: togliCommentiEStringhe,
  classiDelFile: classiDelFile,
  metodiDellaClasse: metodiDellaClasse,
  controlliAndroid: controlliAndroid,
  erroriDellaConsole: erroriDellaConsole,
  leggiErroriCompilatore: leggiErroriCompilatore
};
