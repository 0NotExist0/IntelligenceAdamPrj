// NotExist Intelligience Studio - Le competenze di Adam, scelte guardando il progetto.
//
// Un modello da 9 miliardi di parametri non sa di Unity, Blender o Android quanto un modello grande.
// Ma gli errori che contano davvero si evitano con poche regole precise, date al momento giusto, e la
// documentazione ufficiale della versione INSTALLATA si puo' leggere con ricerca-web.js invece di
// ricordarla male. Qui si riconosce che tipo di progetto e' e si danno solo le regole che servono:
// un gioco web non deve pagare nel prompt le regole di Blender.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CARTELLE_IGNORATE = new Set(['.git', 'node_modules', '__pycache__', 'venv', '.venv', 'env', 'site-packages', 'Library',
  'Temp', 'Logs', 'obj', 'dist', 'build', 'dati']);
const COMANDO_CERVELLO = 'node "' + path.join(__dirname, 'cervello.js').split(path.sep).join('/') + '"';
const COMANDO_VERIFICA = 'node "' + path.join(__dirname, 'verifica.js').split(path.sep).join('/') + '"';
const COMANDO_WEB = 'node "' + path.join(__dirname, 'ricerca-web.js').split(path.sep).join('/') + '"';

// Elenco dei file fino a una certa profondita', senza dipendenze e cartelle generate.
function campione(dir, profonditaMassima, massimoFile) {
  const trovati = [];
  function scendi(cartella, profondita) {
    if (profondita > profonditaMassima || trovati.length >= massimoFile) return;
    let voci;
    try { voci = fs.readdirSync(cartella, { withFileTypes: true }); } catch (e) { return; }
    for (const v of voci) {
      if (trovati.length >= massimoFile) return;
      const completo = path.join(cartella, v.name);
      if (v.isDirectory()) {
        if (!CARTELLE_IGNORATE.has(v.name) && !v.name.startsWith('.')) scendi(completo, profondita + 1);
      } else {
        trovati.push(completo);
      }
    }
  }
  scendi(path.resolve(dir), 0);
  return trovati;
}

function contiene(file, espressione, byte) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(Math.min(fs.statSync(file).size, byte || 20000));
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    return espressione.test(buf.toString('utf8'));
  } catch (e) {
    return false;
  }
}

let versionePython;
function pythonInstallato() {
  if (versionePython !== undefined) return versionePython;
  versionePython = null;
  for (const comando of ['python', 'py']) {
    try {
      const uscita = execFileSync(comando, ['--version'], { encoding: 'utf8', timeout: 15000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const m = /Python\s+(\d+\.\d+)/.exec(uscita);
      if (m) { versionePython = m[1]; break; }
    } catch (e) { /* il prossimo */ }
  }
  return versionePython;
}

function blenderInstallato() {
  try {
    const api = JSON.parse(fs.readFileSync(path.join(__dirname, 'vendor', 'blender-api.json'), 'utf8'));
    const m = /^(\d+\.\d+)/.exec(api.versione || '');
    if (m) return m[1];
  } catch (e) { /* elenco non generato */ }
  return null;
}

function tipiDelProgetto(dir) {
  const tipi = {
    web: false, telefonoWeb: false, node: false, python: false, blender: false, unity: false, android: false,
    java: false, dotnet: false, nativo: false, documento: false, haInterfaccia: false, tipoInterfaccia: '', versioni: {}
  };
  if (!dir || !fs.existsSync(dir)) return tipi;
  let unity = null;
  try { unity = require('./cervello-unity'); } catch (e) { unity = null; }
  const radiceUnity = unity ? unity.trovaProgettoUnity(dir) : null;
  if (radiceUnity) {
    tipi.unity = true;
    try {
      const m = /m_EditorVersion:\s*(\S+)/.exec(fs.readFileSync(path.join(radiceUnity, 'ProjectSettings', 'ProjectVersion.txt'), 'utf8'));
      if (m) tipi.versioni.unity = m[1];
    } catch (e) { /* versione sconosciuta */ }
    tipi.android = !!unity.controlliAndroid(radiceUnity).android;
    return tipi;   // in un progetto Unity il resto (Library, pacchetti) confonderebbe
  }
  const file = campione(dir, 4, 1500);
  const py = file.filter(function (f) { return /\.py$/i.test(f); });
  tipi.python = py.length > 0;
  tipi.blender = file.some(function (f) { return /\.blend$/i.test(f) || /blender_manifest\.toml$/i.test(f); }) ||
    py.slice(0, 200).some(function (f) { return contiene(f, /^\s*(import bpy|from bpy)/m); });
  const html = file.filter(function (f) { return /\.html?$/i.test(f); });
  tipi.web = html.length > 0;
  // Il meta viewport ce l'hanno quasi tutte le pagine: da solo non vuol dire "app per telefono".
  // Visto dal vivo: con le regole per telefono nel prompt Adam provava a larghezza 390 un FPS da PC.
  tipi.telefonoWeb = file.some(function (f) { return /(manifest\.json|\.webmanifest|capacitor\.config\.(json|ts|js)|cordova[\\/]config\.xml|ionic\.config\.json)$/i.test(f); });
  tipi.node = file.some(function (f) { return path.basename(f) === 'package.json'; });
  tipi.java = file.some(function (f) { return /\.java$/i.test(f) || /(^|[\\/])(pom\.xml|build\.gradle(?:\.kts)?)$/i.test(f); });
  tipi.dotnet = file.some(function (f) { return /\.(csproj|fsproj|vbproj)$/i.test(f); });
  tipi.nativo = file.some(function (f) { return /\.(c|cc|cpp|cxx)$/i.test(f); }) ||
    file.some(function (f) { return /(^|[\\/])(CMakeLists\.txt|meson\.build)$/i.test(f); });
  tipi.documento = file.some(function (f) { return /\.(pdf|docx?|odt|rtf|tex)$/i.test(f); });

  const sorgentiUi = file.filter(function (f) { return /\.(py|java|cs|fs|vb|c|cc|cpp|cxx)$/i.test(f); }).slice(0, 300);
  const uiDesktop = sorgentiUi.some(function (f) {
    return contiene(f, /(tkinter|PySide\d*|PyQt\d*|kivy|customtkinter|javafx\.|javax\.swing|java\.awt|System\.Windows\.Forms|System\.Windows\.Controls|Avalonia|QApplication|QMainWindow|GtkApplication|SDL_CreateWindow|glfwCreateWindow)/i);
  });
  if (tipi.web) {
    tipi.haInterfaccia = true;
    tipi.tipoInterfaccia = tipi.telefonoWeb ? 'web-mobile' : 'web';
  } else if (uiDesktop) {
    tipi.haInterfaccia = true;
    tipi.tipoInterfaccia = 'desktop';
  } else if (tipi.documento) {
    tipi.haInterfaccia = true;
    tipi.tipoInterfaccia = 'documento';
  }
  if (tipi.python) tipi.versioni.python = pythonInstallato();
  if (tipi.blender) tipi.versioni.blender = blenderInstallato();
  return tipi;
}

function unitaDocumentazione(versione) {
  const m = /^(\d+)\.(\d+)/.exec(versione || '');
  if (!m) return 'https://docs.unity3d.com/Manual/';
  // Unity 6 usa "6000.2" negli indirizzi della documentazione, le versioni vecchie "2022.3".
  return 'https://docs.unity3d.com/' + m[1] + '.' + m[2] + '/Documentation/';
}

function regoleUnity(versione) {
  const doc = unitaDocumentazione(versione);
  return [
    'UNITY' + (versione ? ' ' + versione : '') + ' (C#):',
    '- FONTE: Usa https://learn.unity.com/ e la documentazione ufficiale della versione del progetto (' + doc + ').',
    '- TRASPARENZA: Se Learn o i documenti non bastano, avvisa l\'utente prima di iniziare una ricerca autonoma.',
    '- Ogni componente e\' una classe che eredita da MonoBehaviour, con lo STESSO nome del file .cs. I messaggi di Unity hanno le maiuscole esatte: Awake, Start, Update, FixedUpdate (fisica), LateUpdate (camera), OnCollisionEnter(Collision), OnTriggerEnter(Collider).',
    '- Riferimenti: [SerializeField] private assegnati nell\'Inspector, oppure GetComponent in Awake salvato in un campo. Mai GetComponent o Find dentro Update.',
    '- MCP for Unity (se configurato): ispeziona scena e asset, modificali con gli strumenti Editor, poi compila, controlla la Console ed esegui test e catture pertinenti.',
    '- ASPETTO: cura UI, scena, luci e camera; verifica in Game View/Play Mode con una cattura reale, non come sito web.',
    '- Movimento: in Update moltiplica per Time.deltaTime; con un Rigidbody muovi in FixedUpdate (velocity o MovePosition), non con transform.position.',
    '- Un campo non assegnato nell\'Inspector da\' NullReferenceException in Play: controllalo in Awake con un Debug.LogError chiaro.',
    '- Dopo ogni tua modifica a un .cs il cervello compila con il compilatore di Unity e ti da\' gli errori con file e riga; gli errori avvenuti in Play (Console di Unity) li vedi con ' + COMANDO_CERVELLO + ' --controlla.',
    '- API incerte: verifica la ScriptReference della versione del progetto con ' + COMANDO_WEB + ' --visita "' + doc + 'ScriptReference/NomeClasse.html".'
  ].join('\n');
}

function regoleAndroidUnity() {
  return [
    'APP PER TELEFONO (Android con Unity):',
    '- Sul telefono non ci sono mouse e tastiera: usa il tocco (Input.touches o il nuovo Input System) e pulsanti UI grandi (almeno 48 dp), mai solo tasti.',
    '- UI: Canvas Scaler "Scale With Screen Size" e Screen.safeArea per notch e barre di sistema; prova piu\' proporzioni nella Game view.',
    '- Prestazioni: niente allocazioni a ogni fotogramma (new, LINQ, stringhe in Update), riusa gli oggetti (pool), Application.targetFrameRate = 60.',
    '- Pubblicazione sul Play Store: IL2CPP con ARM64, identificativo unico (com.nome.gioco), keystore tuo; il cervello ti segnala le impostazioni sbagliate.',
    '- Sul telefono vero: build con il telefono collegato via USB e log con: adb logcat -s Unity'
  ].join('\n');
}

function regoleBlender(versione, python) {
  const v = versione || '4.4';
  return [
    'BLENDER ' + v + ' (Python ' + (python || '3.11') + ' dentro Blender):',
    '- Usa l\'API di QUESTA versione: https://docs.blender.org/api/' + v + '/ . Il cervello controlla i nomi di bpy.ops, bpy.types e bpy.data e ti dice se non esistono.',
    '- Preferisci bpy.data e le proprieta\' degli oggetti agli operatori bpy.ops: gli operatori dipendono dal contesto (area, modalita\' Object/Edit) e negli script spesso falliscono.',
    '- Mesh nuove: bpy.data.meshes.new + mesh.from_pydata(vertici, spigoli, facce) oppure bmesh; poi collection.objects.link(oggetto).',
    '- Add-on: bl_info (o blender_manifest.toml), ogni classe registrata in register() e tolta in unregister(); bl_idname "categoria.nome" minuscolo; i pannelli vogliono bl_space_type e bl_region_type.',
    '- ASPETTO: valuta geometria, materiali, luci, inquadratura e scala nella viewport o in un render reale; per un add-on valuta invece il pannello dentro Blender. Non applicare convenzioni da pagina web.',
    '- Per vedere il risultato: ' + COMANDO_VERIFICA + ' --blender script.py esegue lo script in Blender senza finestra e salva un\'anteprima da guardare con Read.'
  ].join('\n');
}

function regolePython(versione) {
  return [
    'PYTHON' + (versione ? ' ' + versione : '') + ':',
    '- Prima di usare una libreria controlla che sia installata (il cervello te lo dice) e scrivi all\'utente il comando pip giusto.',
    '- Percorsi relativi al file (Path(__file__).parent), non alla cartella da cui si lancia il programma.',
    '- Interfacce (tkinter, PyQt): il ciclo principale (mainloop, app.exec) si avvia una volta sola, alla fine.',
    '- Gli errori veri si vedono eseguendo: python file.py, oppure python -m pytest se ci sono test. ' + COMANDO_VERIFICA + ' lo fa per te dove puo\'.',
    '- Documentazione: https://docs.python.org/' + (versione || '3') + '/'
  ].join('\n');
}

function regoleInterfacciaDesktop() {
  return [
    'INTERFACCIA DESKTOP NATIVA:',
    '- Rispetta il toolkit gia\' usato e i modelli dell\'app; non convertirla in HTML e non cambiare framework senza una ragione tecnica.',
    '- Prima di rifinire definisci gerarchia, spaziatura, tipografia, colori, stati vuoto/errore/caricamento e navigazione da tastiera. Evita l\'aspetto predefinito del toolkit quando il progetto richiede una UI curata.',
    '- Avvia l\'app senza bloccare la chat, osserva la finestra reale e controlla almeno schermata iniziale, ridimensionamento e interazione principale. Una build riuscita non dimostra che l\'interfaccia sia buona.'
  ].join('\n');
}

function regoleWeb() {
  return [
    'INTERFACCIA WEB:',
    '- Ricava dal prodotto una direzione visiva coerente; cura gerarchia, tipografia, spaziatura, colori, stati e responsive. Evita template generici e componenti lasciati con lo stile predefinito.',
    '- Avvia l\'anteprima senza bloccare la chat, aprila nel browser reale e controlla visivamente le schermate e le interazioni principali. Prova anche una larghezza diversa da quella iniziale.'
  ].join('\n');
}

function regoleDocumento() {
  return [
    'DOCUMENTO O PDF:',
    '- Tratta il risultato come progetto editoriale: formato, griglia, margini, gerarchia, font, ritmo, contrasto e leggibilita\' dipendono dallo scopo (CV, relazione, modulo, brochure), non da una UI web.',
    '- Conserva l\'originale. Genera o modifica il file, renderizza tutte le pagine in immagini e guardale davvero; controlla tagli, sovrapposizioni, pagine vuote e coerenza prima di consegnare.'
  ].join('\n');
}

function regoleCodiceSenzaUi(tipi) {
  const linguaggi = [tipi.java && 'Java', tipi.dotnet && '.NET', tipi.nativo && 'C/C++', tipi.node && 'Node.js'].filter(Boolean).join(', ');
  return [
    'PROGETTO ' + (linguaggi || 'SOFTWARE') + ' SENZA INTERFACCIA RILEVATA:',
    '- Non inventare una GUI e non applicare regole di design web. Verifica prima se il prodotto e\' CLI, libreria, servizio o backend e segui convenzioni, build e test del progetto.',
    '- Se la richiesta introduce davvero un\'interfaccia, scegli il toolkit coerente con piattaforma e requisiti, poi applica il relativo workflow visuale.'
  ].join('\n');
}

function regoleTelefonoWeb() {
  return [
    'SITO O APP WEB PER TELEFONO:',
    '- <meta name="viewport" content="width=device-width, initial-scale=1">, layout che si adatta (flex/grid, unita\' relative), niente larghezze fisse in pixel.',
    '- Pulsanti e link di almeno 44px, niente azioni che funzionano solo con hover o tasto destro.',
    '- Prova la pagina larga come un telefono: ' + COMANDO_VERIFICA + ' pagina.html --telefono'
  ].join('\n');
}

function testoPerPrompt(dir) {
  const tipi = tipiDelProgetto(dir);
  const blocchi = [];
  if (tipi.unity) {
    blocchi.push(regoleUnity(tipi.versioni.unity));
    if (tipi.android) blocchi.push(regoleAndroidUnity());
  }
  if (tipi.blender) blocchi.push(regoleBlender(tipi.versioni.blender, tipi.versioni.python));
  if (tipi.python && !tipi.blender) blocchi.push(regolePython(tipi.versioni.python));
  if (tipi.tipoInterfaccia === 'desktop') blocchi.push(regoleInterfacciaDesktop());
  if (tipi.tipoInterfaccia === 'web') blocchi.push(regoleWeb());
  if (tipi.telefonoWeb) blocchi.push(regoleTelefonoWeb());
  if (tipi.tipoInterfaccia === 'documento') blocchi.push(regoleDocumento());
  if (!tipi.haInterfaccia && (tipi.java || tipi.dotnet || tipi.nativo || tipi.node)) blocchi.push(regoleCodiceSenzaUi(tipi));
  if (!blocchi.length) return '';
  return 'COMPETENZE PER QUESTO PROGETTO (scelte dallo Studio guardando i file: seguile, valgono piu\' dei tuoi ricordi):\n' + blocchi.join('\n\n');
}

module.exports = {
  tipiDelProgetto: tipiDelProgetto,
  testoPerPrompt: testoPerPrompt,
  regoleUnity: regoleUnity,
  regoleBlender: regoleBlender,
  regoleInterfacciaDesktop: regoleInterfacciaDesktop,
  regoleWeb: regoleWeb,
  regoleDocumento: regoleDocumento,
  regoleCodiceSenzaUi: regoleCodiceSenzaUi
};
