// NotExist Intelligience Studio - Personaggi riggati: da Unity (FBX) a gioco e pannello 3D, con Blender.
//
// Richiesta dell'utente (18/9/2026): "usa il personaggio riggato che ho su Unity, connettilo a
// Blender con il rendering 3D in un pannello accanto a quello del file dal vivo".
// Il personaggio (Robott: 25.412 triangoli, 65 ossa Mixamo) non si puo' disegnare cosi' com'e' in un
// gioco pygame: il motore fatto a mano regge ~200 poligoni a 60 fotogrammi al secondo. Lo converte
// Blender, in sottofondo:
//   --prepara  GLB per il pannello 3D (riposo e camminata dentro) + immagini da 8 direzioni per il gioco
//   --rendi    un'immagine di qualita' dallo stesso punto di vista del pannello
// Il lavoro vero lo fa strumenti/personaggio-blender.py dentro Blender; qui si lancia e si legge l'esito.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const SCRIPT = path.join(__dirname, 'personaggio-blender.py');
const COMANDO = 'node "' + path.join(__dirname, 'personaggio.js').split(path.sep).join('/') + '"';

function trovaBlender() {
  return require('./verifica').trovaBlender();
}

function slash(p) { return String(p).split('\\').join('/'); }

// Lancia Blender con un comando dello script e restituisce l'oggetto della riga "RISULTATO".
function blender(comando, opzioni, attesaMs) {
  return new Promise(function (risolvi) {
    const eseguibile = trovaBlender();
    if (!eseguibile) return risolvi({ ok: false, errore: 'Blender non trovato su questo computer' });
    const fileOpzioni = path.join(os.tmpdir(), 'personaggio-' + process.pid + '-' + Date.now() + '.json');
    fs.writeFileSync(fileOpzioni, JSON.stringify(opzioni));
    const processo = spawn(eseguibile, ['-b', '--factory-startup', '--python', SCRIPT, '--', comando, fileOpzioni], { windowsHide: true });
    let uscita = '';
    processo.stdout.on('data', function (d) { if (uscita.length < 200000) uscita += d; });
    processo.stderr.on('data', function (d) { if (uscita.length < 200000) uscita += d; });
    const timer = setTimeout(function () { try { processo.kill(); } catch (e) {} }, attesaMs || 300000);
    processo.on('close', function () {
      clearTimeout(timer);
      try { fs.unlinkSync(fileOpzioni); } catch (e) {}
      const riga = uscita.split(/\r?\n/).filter(function (r) { return r.indexOf('RISULTATO ') === 0; }).pop();
      if (!riga) return risolvi({ ok: false, errore: 'Blender non ha risposto', coda: uscita.slice(-1500) });
      try { risolvi(JSON.parse(riga.slice('RISULTATO '.length))); } catch (e) { risolvi({ ok: false, errore: 'risposta illeggibile: ' + riga.slice(0, 200) }); }
    });
    processo.on('error', function (e) { clearTimeout(timer); risolvi({ ok: false, errore: e.message }); });
  });
}

// La cartella dove finisce il personaggio convertito: il gioco sul cubo (scheletro personaggio-cubo-python)
// cerca le sue immagini proprio qui. Non "personaggio": accanto a personaggio.py confonderebbe.
const CARTELLA_USCITA = 'personaggio-3d';

// Dal FBX di Unity: <uscita>/<nome>.glb e <uscita>/sprite/*.png
function prepara(modello, uscita, opzioni) {
  opzioni = opzioni || {};
  if (!modello || !fs.existsSync(modello)) return Promise.resolve({ ok: false, errore: 'modello non trovato: ' + modello });
  return blender('prepara', {
    modello: path.resolve(modello),
    uscita: path.resolve(uscita || path.join(process.cwd(), CARTELLA_USCITA)),
    nome: opzioni.nome || null,
    altezza: opzioni.altezza || 1.8,
    sprite: opzioni.sprite !== false
  }, opzioni.attesaMs || 600000);
}

// Un'immagine di qualita'. camera e bersaglio sono nelle coordinate di three.js (Y in alto).
function rendi(modello, opzioni) {
  opzioni = opzioni || {};
  if (!modello || !fs.existsSync(modello)) return Promise.resolve({ ok: false, errore: 'modello non trovato: ' + modello });
  const cartella = path.join(os.tmpdir(), 'studio-screenshot');
  fs.mkdirSync(cartella, { recursive: true });
  return blender('rendi', {
    modello: path.resolve(modello),
    uscita: opzioni.uscita || path.join(cartella, 'blender-' + Date.now() + '.png'),
    camera: opzioni.camera, bersaglio: opzioni.bersaglio, fov: opzioni.fov,
    animazione: opzioni.animazione || null, tempo: opzioni.tempo || 0,
    larghezza: opzioni.larghezza || 720, altezza_immagine: opzioni.altezza || 720,
    qualita: opzioni.qualita !== false
  }, opzioni.attesaMs || 180000);
}

// I modelli 3D di un progetto che il pannello puo' mostrare.
function modelliDelProgetto(dir, massimo) {
  const trovati = [];
  (function scendi(cartella, profondita) {
    if (profondita > 4 || trovati.length >= (massimo || 40)) return;
    let voci;
    try { voci = fs.readdirSync(cartella, { withFileTypes: true }); } catch (e) { return; }
    voci.forEach(function (v) {
      if (v.name.charAt(0) === '.' || /^(node_modules|Library|Temp|__pycache__|venv|\.venv)$/.test(v.name)) return;
      const pieno = path.join(cartella, v.name);
      if (v.isDirectory()) scendi(pieno, profondita + 1);
      else if (/\.(glb|gltf)$/i.test(v.name)) {
        let st = null;
        try { st = fs.statSync(pieno); } catch (e) { return; }
        trovati.push({ percorso: slash(pieno), nome: slash(path.relative(dir, pieno)), byte: st.size, quando: st.mtimeMs });
      }
    });
  })(path.resolve(dir), 0);
  return trovati.sort(function (a, b) { return b.quando - a.quando; });
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const valore = function (nome) {
    const i = argv.indexOf(nome);
    return i !== -1 && argv[i + 1] ? argv[i + 1] : null;
  };
  const daPreparare = valore('--prepara');
  const daRendere = valore('--rendi');
  if (!daPreparare && !daRendere) {
    console.log('Uso:');
    console.log('  node personaggio.js --prepara <personaggio.fbx> [--uscita <cartella>]   (di solito: ' + CARTELLA_USCITA + ')');
    console.log('      GLB per il pannello 3D + immagini da 8 direzioni per il gioco (in <cartella>/sprite)');
    console.log('  node personaggio.js --rendi <personaggio.glb> [--animazione Camminata]');
    console.log('      un\'immagine di qualita\' fatta da Blender');
    process.exit(0);
  }
  const lavoro = daPreparare
    ? prepara(daPreparare, valore('--uscita') || path.join(process.cwd(), CARTELLA_USCITA))
    : rendi(daRendere, { animazione: valore('--animazione'), tempo: Number(valore('--tempo')) || 0 });
  lavoro.then(function (r) {
    if (!r.ok) {
      console.log('Non riuscito: ' + r.errore + (r.coda ? '\n' + r.coda : ''));
      process.exit(1);
    }
    if (daPreparare) {
      console.log('Fatto in ' + r.secondi + ' s: ' + slash(r.glb) + ' (' + r.triangoli + ' triangoli, ' + r.ossa + ' ossa, animazioni: ' +
        (r.animazioni.join(', ') || 'nessuna') + '), ' + r.sprite + ' immagini per il gioco in ' + slash(path.join(path.dirname(r.glb), 'sprite')));
    } else {
      console.log('Immagine: ' + slash(r.png) + ' (' + r.motore + ', ' + r.secondi + ' s). Guardala con Read.');
    }
  });
}

module.exports = { prepara: prepara, rendi: rendi, modelliDelProgetto: modelliDelProgetto, trovaBlender: trovaBlender, COMANDO: COMANDO, CARTELLA_USCITA: CARTELLA_USCITA };
