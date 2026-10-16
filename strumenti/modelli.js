// NotExist Intelligience Studio - Modelli 3D fatti con Blender e messi nel gioco.
//
// Domanda dell'utente (16/9/2026): "e' capace di creare modelli con Blender per aggiungerli al
// gioco, in Python, in Unity o sul web?". Si': Blender si comanda con Python, e lo Studio sa gia'
// eseguirlo senza finestre. Quello che mancava e' la parte che conta - la PROVA che il modello sia
// venuto fuori davvero: "esportato senza errori" non vuol dire che dentro al file ci sia qualcosa.
// Qui il modello viene creato, esportato nel formato giusto per il gioco, fotografato (anteprima da
// guardare con Read) e poi CONTROLLATO: il file si apre, ha dei triangoli, ha dei materiali.
//
// Dove finisce il modello:
//   .glb  -> web (Three.js) e Unity          .fbx -> Unity          .obj -> quasi tutto
//   sprite PNG su sfondo trasparente -> giochi in pygame (anche il motore a raggi dello scheletro)
//
// Uso:
//   node modelli.js --script crea_zombie.py --uscita modelli/zombie.glb --anteprima img/zombie.png
//   node modelli.js --script crea_zombie.py --sprite img/zombie.png --angoli 4

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const SCRIPT = path.join(__dirname, 'blender-modello.py');
const COMANDO = 'node "' + path.join(__dirname, 'modelli.js').split(path.sep).join('/') + '"';

function slash(p) { return String(p).split('\\').join('/'); }

function trovaBlender() {
  return require('./verifica').trovaBlender();
}

// Un .glb e' un file preciso: firma "glTF", versione 2, e dentro un pezzo JSON con mesh e
// materiali. Se non c'e' nessuna mesh, il modello e' vuoto anche se il file esiste.
function leggiGlb(file) {
  let b;
  try { b = fs.readFileSync(file); } catch (e) { return { ok: false, motivo: 'file non creato' }; }
  if (b.length < 20 || b.toString('ascii', 0, 4) !== 'glTF') return { ok: false, motivo: 'non e\' un file glTF' };
  const versione = b.readUInt32LE(4);
  let posizione = 12;
  let contenuto = null;
  while (posizione + 8 <= b.length) {
    const lunghezza = b.readUInt32LE(posizione);
    const tipo = b.readUInt32LE(posizione + 4);
    if (tipo === 0x4E4F534A) {                       // "JSON"
      try { contenuto = JSON.parse(b.toString('utf8', posizione + 8, posizione + 8 + lunghezza)); } catch (e) { contenuto = null; }
    }
    posizione += 8 + lunghezza;
  }
  if (!contenuto) return { ok: false, motivo: 'il file non contiene la descrizione della scena' };
  const mesh = (contenuto.meshes || []).length;
  return {
    ok: mesh > 0, versione: versione, mesh: mesh,
    nodi: (contenuto.nodes || []).length,
    materiali: (contenuto.materials || []).length,
    immagini: (contenuto.images || []).length,
    motivo: mesh > 0 ? null : 'il file non contiene nessuna mesh: il modello e\' vuoto'
  };
}

function controllaUscita(file) {
  const estensione = path.extname(file).toLowerCase();
  let byte = 0;
  try { byte = fs.statSync(file).size; } catch (e) { return { ok: false, motivo: 'file non creato' }; }
  if (!byte) return { ok: false, motivo: 'file vuoto' };
  if (estensione === '.glb') return Object.assign({ byte: byte }, leggiGlb(file));
  if (estensione === '.fbx') {
    const testa = fs.readFileSync(file).toString('ascii', 0, 64);
    return { ok: /Kaydara FBX Binary|FBX/.test(testa), byte: byte, motivo: /Kaydara FBX Binary|FBX/.test(testa) ? null : 'non sembra un FBX' };
  }
  if (estensione === '.obj') {
    const testo = fs.readFileSync(file, 'utf8');
    const vertici = (testo.match(/^v\s/gm) || []).length;
    const facce = (testo.match(/^f\s/gm) || []).length;
    return { ok: vertici > 0 && facce > 0, byte: byte, vertici: vertici, facce: facce, motivo: facce ? null : 'nessuna faccia nel file' };
  }
  if (estensione === '.blend') {
    const testa = fs.readFileSync(file).toString('ascii', 0, 7);
    return { ok: testa === 'BLENDER', byte: byte, motivo: testa === 'BLENDER' ? null : 'non sembra un file di Blender' };
  }
  return { ok: byte > 0, byte: byte };
}

// Un'immagine praticamente vuota pesa pochissimo: e' il segno che il modello non e' stato inquadrato.
function controllaImmagine(file) {
  let byte = 0;
  try { byte = fs.statSync(file).size; } catch (e) { return { ok: false, motivo: 'immagine non creata' }; }
  const b = fs.readFileSync(file);
  const png = b.length > 24 && b.toString('ascii', 1, 4) === 'PNG';
  return {
    ok: png && byte > 1800, byte: byte, png: png,
    larghezza: png ? b.readUInt32BE(16) : 0, altezza: png ? b.readUInt32BE(20) : 0,
    motivo: !png ? 'non e\' un PNG' : (byte > 1800 ? null : 'l\'immagine sembra vuota (' + byte + ' byte): il modello non e\' stato inquadrato')
  };
}

function crea(opzioni) {
  const o = opzioni || {};
  return new Promise(function (risolvi) {
    const blender = trovaBlender();
    if (!blender) {
      return risolvi({ ok: false, errore: 'Blender non e\' installato (o non e\' in Program Files\\Blender Foundation)' });
    }
    if (!o.script && !o.tieniScena) {
      return risolvi({ ok: false, errore: 'indica lo script Blender che costruisce il modello: --script crea_modello.py' });
    }
    if (o.script && !fs.existsSync(path.resolve(o.script))) {
      return risolvi({ ok: false, errore: 'lo script non esiste: ' + slash(path.resolve(o.script)) });
    }
    const opzioniBlender = {
      script: o.script ? path.resolve(o.script) : null,
      uscita: o.uscita ? path.resolve(o.uscita) : null,
      anteprima: o.anteprima ? path.resolve(o.anteprima) : null,
      sprite: o.sprite ? path.resolve(o.sprite) : null,
      angoli: o.angoli || 1,
      dimensione: o.dimensione || 512,
      tieniScena: !!o.tieniScena
    };
    const argomenti = ['-b', '--factory-startup', '--python', SCRIPT, '--', JSON.stringify(opzioniBlender)];
    execFile(blender, argomenti, { timeout: o.timeout || 240000, maxBuffer: 20 * 1024 * 1024, windowsHide: true }, function (err, stdout, stderr) {
      const testo = String(stdout || '') + String(stderr || '');
      const riga = testo.split(/\r?\n/).find(function (l) { return l.indexOf('MODELLO_BLENDER=') === 0; });
      if (!riga) {
        return risolvi({
          ok: false,
          errore: (err && err.killed) ? 'Blender ci ha messo troppo ed e\' stato fermato' : 'Blender non ha risposto: ' + testo.slice(-300).trim()
        });
      }
      let esito;
      try { esito = JSON.parse(riga.slice('MODELLO_BLENDER='.length)); } catch (e) { esito = null; }
      if (!esito) return risolvi({ ok: false, errore: 'risposta di Blender non leggibile' });
      if (!esito.ok) {
        return risolvi({
          ok: false, esito: esito,
          errore: esito.errore + (esito.riga ? ' (riga ' + esito.riga + ' dello script)' : '')
        });
      }

      const problemi = [];
      const controlli = {};
      (esito.file || []).forEach(function (f) {
        const c = controllaUscita(f);
        controlli[f] = c;
        if (!c.ok) problemi.push(path.basename(f) + ': ' + (c.motivo || 'non valido'));
      });
      (esito.immagini || []).forEach(function (f) {
        const c = controllaImmagine(f);
        controlli[f] = c;
        if (!c.ok) problemi.push(path.basename(f) + ': ' + (c.motivo || 'non valida'));
      });
      if (!esito.triangoli) problemi.push('il modello non ha nemmeno un triangolo: e\' vuoto');
      if (!esito.materiali) problemi.push('nessun materiale: nel gioco si vedra\' tutto di un colore piatto');
      risolvi({ ok: problemi.length === 0, esito: esito, controlli: controlli, problemi: problemi });
    });
  });
}

function descrizione(r) {
  if (r.errore) return 'modello non creato: ' + r.errore;
  const e = r.esito || {};
  const righe = ['modello creato in Blender ' + e.versione + ': ' + e.oggetti + (e.oggetti === 1 ? ' oggetto' : ' oggetti') +
    ' (' + (e.nomi || []).slice(0, 6).join(', ') + '), ' + e.triangoli + ' triangoli, ' + e.materiali + ' materiali'];
  (e.file || []).forEach(function (f) {
    const c = (r.controlli || {})[f] || {};
    righe.push('   esportato: ' + slash(f) + ' (' + Math.round((c.byte || 0) / 1024) + ' KB' +
      (c.mesh !== undefined ? ', ' + c.mesh + ' mesh, ' + c.materiali + ' materiali dentro al file' : '') +
      (c.facce !== undefined ? ', ' + c.vertici + ' vertici e ' + c.facce + ' facce' : '') + ')');
  });
  (e.immagini || []).forEach(function (f) {
    const c = (r.controlli || {})[f] || {};
    righe.push('   immagine, da guardare con Read: ' + slash(f) + (c.larghezza ? ' (' + c.larghezza + 'x' + c.altezza + ')' : ''));
  });
  if (e.avviso) righe.push('   nota: ' + e.avviso);
  if (r.problemi && r.problemi.length) righe.push('   DA CONTROLLARE: ' + r.problemi.join('; '));
  return righe.join('\n');
}

// Le istruzioni per Adam, nel prompt di sistema.
function testoPerPrompt() {
  return 'MODELLI 3D (Blender e\' installato): scrivi uno script Python che costruisce il modello (bpy) e poi ' +
    COMANDO + ' --script crea_modello.py --uscita modelli/nome.glb --anteprima img/nome.png ' +
    '(.glb per web e Unity, .fbx per Unity, --sprite img/nome.png --angoli 4 per i giochi pygame). ' +
    'Lo Studio apre il file esportato e controlla che dentro ci siano davvero mesh e materiali, e ti da\' ' +
    'un\'immagine da guardare con Read: guardala sempre prima di dire che il modello e\' pronto.';
}

const USO = [
  'Modelli 3D con Blender, per il gioco. Uso:',
  '  ' + COMANDO + ' --script crea_modello.py [--uscita modelli/nome.glb] [--anteprima img/nome.png]',
  '                 [--sprite img/nome.png --angoli 4] [--dimensione 512]',
  '  formati: .glb (web e Unity), .fbx (Unity), .obj, .blend'
].join('\n');

if (require.main === module) {
  const argomenti = process.argv.slice(2);
  const valore = function (nome) {
    const i = argomenti.indexOf(nome);
    return i === -1 ? null : (argomenti[i + 1] || null);
  };
  if (!argomenti.length || argomenti.indexOf('--aiuto') !== -1 || argomenti.indexOf('--help') !== -1) {
    console.log(USO);
    process.exit(0);
  }
  crea({
    script: valore('--script'),
    uscita: valore('--uscita'),
    anteprima: valore('--anteprima'),
    sprite: valore('--sprite'),
    angoli: Number(valore('--angoli')) || 1,
    dimensione: Number(valore('--dimensione')) || 512
  }).then(function (r) {
    console.log(descrizione(r));
    process.exit(r.ok ? 0 : 1);
  });
}

module.exports = { crea: crea, descrizione: descrizione, testoPerPrompt: testoPerPrompt, leggiGlb: leggiGlb, controllaUscita: controllaUscita, COMANDO: COMANDO };
