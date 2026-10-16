// NotExist Intelligience Studio - Cosa serve DAVVERO in questo progetto.
//
// Il prompt fisso di Adam pesa 3.739 token e viaggia in ogni singola richiesta. Misurato il
// 17/9/2026: 598 di quei token sono i blocchi su texture, modelli 3D e scheletri di gioco - roba
// preziosa per un FPS, inutile in un sito curriculum, dove restano li' a rubare memoria a un
// modello che ne ha 32.768 in tutto.
//
// La domanda dell'utente era: lo decide lo Studio analizzando il progetto, o lo facciamo decidere
// al Direttore (il modello)? Qui lo decide lo Studio, e per un motivo pratico: per scegliere, il
// modello dovrebbe prima LEGGERE quei blocchi - cioe' pagarli comunque - oppure servirebbe una
// domanda a parte, che su Ollama costa mezzo minuto di GPU a ogni avvio e puo' rispondere male.
// Guardare i file di un progetto, invece, e' un controllo di venti righe che non sbaglia e non
// costa niente.
//
// La parte di decisione che resta al Direttore e' quella giusta: quando i blocchi non ci sono,
// al loro posto va UNA riga che gli dice come chiamarli se gli servono. Cosi' la scelta e' sua,
// ma la paga solo quando serve davvero.

const fs = require('fs');
const path = require('path');

const CARTELLE_IGNORATE = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', 'venv', '.venv', 'Library', 'Temp', 'obj']);
const MAX_FILE = 400;
const MAX_BYTE_LETTURA = 400 * 1024;

// Segnali forti: qui si sta facendo (o si fara') un gioco o roba 3D.
const CODICE_DA_GIOCO = [
  { re: /\bimport\s+pygame\b|\bfrom\s+pygame\b/, perche: 'usa pygame' },
  { re: /\bimport\s+ursina\b|\bfrom\s+ursina\b|\bimport\s+panda3d\b|\bimport\s+arcade\b/, perche: 'usa una libreria di gioco Python' },
  { re: /\bimport\s+bpy\b|\bfrom\s+bpy\b/, perche: 'e\' uno script Blender' },
  // Attenzione ai falsi allarmi: "Three." con la T maiuscola compare in qualsiasi testo inglese
  // (nel curriculum dell'utente c'era, e bastava a far passare il sito per un gioco 3D). Si
  // riconoscono i nomi dei file, gli import veri e le classi di three.js, non la parola.
  { re: /three\.(module|min)\.js|from\s+['"]three['"]|require\(\s*['"]three['"]\s*\)|babylonjs|\bphaser\b|playcanvas/i, perche: 'usa una libreria 3D per il web' },
  { re: /\bTHREE\.[A-Z]\w+/, perche: 'usa three.js' },
  { re: /getContext\(\s*['"]webgl2?['"]|requestPointerLock/i, perche: 'disegna in WebGL o blocca il puntatore' },
  { re: /UnityEngine|MonoBehaviour/, perche: 'e\' un progetto Unity' }
];

// Le parole con cui l'utente chiede un gioco. Valgono anche a progetto vuoto: e' il caso in cui
// i file non possono ancora dire niente.
const RICHIESTA_DA_GIOCO = /\b(gioco|giochi|game|fps|sparatutto|sparare|spariamo|zombie|nemic[oi]|minecraft|multiplayer|videogioc\w*|texture|sprite|modell[oi]\s*3d|blender|unity|personagg\w*|livell[oi]\s+(di\s+)?gioco|prima persona|3d)\b/i;

function fileDelProgetto(dir) {
  const trovati = [];
  (function scendi(cartella, profondita) {
    if (profondita > 4 || trovati.length > MAX_FILE) return;
    let voci;
    try { voci = fs.readdirSync(cartella, { withFileTypes: true }); } catch (e) { return; }
    for (const v of voci) {
      if (v.name.charAt(0) === '.' || CARTELLE_IGNORATE.has(v.name)) continue;
      const pieno = path.join(cartella, v.name);
      if (v.isDirectory()) scendi(pieno, profondita + 1);
      else if (v.isFile()) trovati.push(pieno);
    }
  })(path.resolve(dir), 0);
  return trovati;
}

// Il progetto e' (o sta per diventare) un gioco / roba 3D?
// Restituisce { serve, perche }: il perche' si scrive nel log, cosi' la scelta e' controllabile.
function serveRobaDaGioco(dir, opzioni) {
  opzioni = opzioni || {};
  if (opzioni.forza === true) return { serve: true, perche: 'impostato a mano' };
  if (opzioni.forza === false) return { serve: false, perche: 'disattivato a mano' };
  let file = [];
  try { file = fileDelProgetto(dir); } catch (e) { file = []; }

  // Unity e Blender si riconoscono dalla forma della cartella, senza aprire niente.
  const nomi = file.map(function (f) { return path.basename(f).toLowerCase(); });
  if (nomi.indexOf('projectsettings.asset') !== -1 || file.some(function (f) { return /[\\/]Assets[\\/]/.test(f) && /\.(cs|unity|prefab)$/i.test(f); })) {
    return { serve: true, perche: 'e\' un progetto Unity' };
  }
  if (nomi.some(function (n) { return /\.(blend|fbx|glb|gltf|obj)$/i.test(n); })) {
    return { serve: true, perche: 'contiene modelli 3D' };
  }

  for (const f of file) {
    if (!/\.(js|mjs|cjs|py|cs|html?)$/i.test(f)) continue;
    let testo = '';
    try {
      if (fs.statSync(f).size > MAX_BYTE_LETTURA) continue;
      testo = fs.readFileSync(f, 'utf8');
    } catch (e) { continue; }
    for (const segnale of CODICE_DA_GIOCO) {
      if (segnale.re.test(testo)) return { serve: true, perche: path.basename(f) + ' ' + segnale.perche };
    }
  }

  // Niente nei file: contano le parole dell'utente, che spesso arrivano prima del codice
  // ("fammi un fps multiplayer" in una cartella vuota).
  let richieste = [];
  try {
    richieste = require('./requisiti').caricaRichieste(dir, { base: opzioni.baseChat }).slice(-4);
  } catch (e) { richieste = []; }
  const chiesto = richieste.find(function (t) { return RICHIESTA_DA_GIOCO.test(String(t || '')); });
  if (chiesto) {
    const parola = (String(chiesto).match(RICHIESTA_DA_GIOCO) || [''])[0];
    return { serve: true, perche: 'l\'utente ha parlato di "' + parola + '"' };
  }
  return { serve: false, perche: 'nessun segnale di gioco o 3D nei file ne\' nelle richieste' };
}

// Quello che si mette al posto dei blocchi quando non servono: una riga, non seicento token.
// Da qui in poi decide il Direttore: se il lavoro diventa un gioco, se li va a prendere lui.
function rigaDiRiserva(comandi) {
  const c = comandi || {};
  const pezzi = [];
  if (c.scheletri) pezzi.push(c.scheletri + ' --elenco (giochi 3D e multiplayer gia\' funzionanti da cui partire)');
  if (c.texture) pezzi.push(c.texture + ' --aiuto (texture senza cuciture, anche fotografiche)');
  if (c.modelli) pezzi.push(c.modelli + ' --aiuto (modelli 3D con Blender)');
  if (!pezzi.length) return '';
  return 'SE IL LAVORO DIVENTA UN GIOCO O SERVE ROBA 3D: non partire da zero e non cercare file sul web, ' +
    'lo Studio ce li ha gia\' pronti. Chiedili cosi\': ' + pezzi.join('; ') + '.';
}

module.exports = {
  serveRobaDaGioco: serveRobaDaGioco,
  rigaDiRiserva: rigaDiRiserva,
  fileDelProgetto: fileDelProgetto,
  RICHIESTA_DA_GIOCO: RICHIESTA_DA_GIOCO,
  CODICE_DA_GIOCO: CODICE_DA_GIOCO
};
