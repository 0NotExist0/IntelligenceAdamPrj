// Prova i modelli 3D fatti con Blender: devono finire nel gioco, non solo "essere esportati".
// Domanda dell'utente (16/9/2026): "e' capace di creare modelli con Blender per il gioco, in
// Python, Unity o web?". Si', ma solo se qualcuno controlla il risultato: un file .glb puo' esistere
// ed essere vuoto. Qui si crea un modello vero, si apre il file esportato e si contano le mesh.
const fs = require('fs');
const os = require('os');
const path = require('path');
const modelli = require('../strumenti/modelli');

let pass = 0;
let fail = 0;
function check(nome, condizione, dettaglio) {
  if (condizione) { pass++; console.log('  ok   ' + nome); }
  else { fail++; console.log('  FAIL ' + nome + (dettaglio !== undefined ? '  -> ' + dettaglio : '')); }
}

const cartella = fs.mkdtempSync(path.join(os.tmpdir(), 'prova-modelli-'));
function fine() {
  try { fs.rmSync(cartella, { recursive: true, force: true }); } catch (e) {}
  console.log('\n' + '='.repeat(50));
  console.log('MODELLI 3D: ' + pass + ' passati, ' + fail + ' falliti');
  process.exit(fail ? 1 : 0);
}
function scrivi(nome, testo) {
  const f = path.join(cartella, nome);
  fs.writeFileSync(f, testo);
  return f;
}

console.log('\n=== Controlli sui file, senza Blender ===');
check('un .glb finto viene bocciato', !modelli.leggiGlb(scrivi('finto.glb', 'non sono un modello')).ok);
check('un file che non esiste viene bocciato', !modelli.controllaUscita(path.join(cartella, 'niente.glb')).ok);
check('le istruzioni per Adam dicono i formati e lo sprite',
  /\.glb/.test(modelli.testoPerPrompt()) && /--sprite/.test(modelli.testoPerPrompt()), modelli.testoPerPrompt());

(async function () {
  const conBlender = require('../strumenti/verifica').trovaBlender();
  if (!conBlender) {
    console.log('\n  (Blender non installato: salto le prove vere)');
    return fine();
  }

  console.log('\n=== Uno script che non crea niente: lo dice, non esporta un file vuoto ===');
  const vuoto = await modelli.crea({ script: scrivi('vuoto.py', 'import bpy\nprint("non creo niente")\n'), uscita: path.join(cartella, 'vuoto.glb') });
  check('dice che non c\'e\' niente da esportare', !vuoto.ok && /nessun oggetto/.test(vuoto.errore || ''), JSON.stringify(vuoto).slice(0, 200));
  check('e infatti il file non lo scrive', !fs.existsSync(path.join(cartella, 'vuoto.glb')));

  console.log('\n=== Uno script sbagliato: errore con il numero di riga ===');
  const rotto = await modelli.crea({ script: scrivi('rotto.py', 'import bpy\n\nbpy.ops.mesh.cubo_magico_add()\n'), uscita: path.join(cartella, 'rotto.glb') });
  check('errore riportato con la riga dello script', !rotto.ok && /riga 3/.test(rotto.errore || ''), rotto.errore);

  console.log('\n=== Lo zombie a blocchi: modello vero, file vero, immagini vere ===');
  const r = await modelli.crea({
    script: path.join(__dirname, '..', 'strumenti', 'modelli-esempi', 'zombie.py'),
    uscita: path.join(cartella, 'zombie.glb'),
    anteprima: path.join(cartella, 'zombie.png'),
    sprite: path.join(cartella, 'sprite.png'),
    angoli: 2,
    dimensione: 128
  });
  check('creato senza problemi', r.ok, JSON.stringify(r.problemi || r.errore));
  check('ha oggetti, triangoli e materiali', r.esito && r.esito.oggetti === 8 && r.esito.triangoli >= 90 && r.esito.materiali === 3,
    JSON.stringify(r.esito && { oggetti: r.esito.oggetti, triangoli: r.esito.triangoli, materiali: r.esito.materiali }));
  const glb = modelli.leggiGlb(path.join(cartella, 'zombie.glb'));
  check('il .glb si apre davvero e dentro ha le mesh', glb.ok && glb.versione === 2 && glb.mesh === 8 && glb.materiali === 3, JSON.stringify(glb));
  check('anteprima da guardare, della misura giusta', fs.existsSync(path.join(cartella, 'zombie.png')) &&
    fs.readFileSync(path.join(cartella, 'zombie.png')).readUInt32BE(16) === 128);
  check('due sprite su sfondo trasparente per i giochi 2D', fs.existsSync(path.join(cartella, 'sprite-0.png')) &&
    fs.existsSync(path.join(cartella, 'sprite-1.png')));
  check('la descrizione dice dove guardare le immagini', /da guardare con Read/.test(modelli.descrizione(r)), modelli.descrizione(r));

  fine();
})().catch(function (e) {
  fail++;
  console.log('  FAIL eccezione: ' + (e && e.stack || e));
  fine();
});
