// Prova le texture fatte in casa: devono essere USABILI in un gioco, non solo esistere.
// L'utente (16/9/2026) ha chiesto un modo per avere le texture; queste non scaricano niente e si
// ripetono senza cuciture. Lo Studio le misura: se vengono piatte o con la riga di giunzione
// visibile lo deve dire, invece di consegnare un quadrato grigio.
const fs = require('fs');
const os = require('os');
const path = require('path');
const texture = require('../strumenti/texture');

let pass = 0;
let fail = 0;
function check(nome, condizione, dettaglio) {
  if (condizione) { pass++; console.log('  ok   ' + nome); }
  else { fail++; console.log('  FAIL ' + nome + (dettaglio !== undefined ? '  -> ' + dettaglio : '')); }
}

const cartella = fs.mkdtempSync(path.join(os.tmpdir(), 'prova-texture-'));
function fine() {
  try { fs.rmSync(cartella, { recursive: true, force: true }); } catch (e) {}
  console.log('\n' + '='.repeat(50));
  console.log('TEXTURE: ' + pass + ' passati, ' + fail + ' falliti');
  process.exit(fail ? 1 : 0);
}

(async function () {
  if (!require('../strumenti/cervello-python').trovaPython()) {
    console.log('  (Python non installato: prove saltate)');
    return fine();
  }

  console.log('\n=== Tutti i tipi vengono bene (e lo Studio lo misura) ===');
  for (const tipo of texture.TIPI) {
    const r = await texture.crea({ tipo: tipo, uscita: path.join(cartella, tipo + '.png'), dimensione: 128 });
    const m = r.misure || {};
    check(tipo + ': non e\' un quadrato piatto e non mostra la giunzione', r.ok,
      JSON.stringify(r.problemi || r.errore) + ' ' + JSON.stringify(m));
  }

  console.log('\n=== Il file e\' un PNG vero, della misura chiesta ===');
  const r = await texture.crea({ tipo: 'mattoni', uscita: path.join(cartella, 'muro.png'), dimensione: 64 });
  const dati = fs.readFileSync(r.file);
  check('intestazione PNG', dati.slice(1, 4).toString() === 'PNG', dati.slice(0, 8).toString('hex'));
  check('64x64 come chiesto', dati.readUInt32BE(16) === 64 && dati.readUInt32BE(20) === 64,
    dati.readUInt32BE(16) + 'x' + dati.readUInt32BE(20));
  check('la descrizione dice dove guardarla', /guardala con Read/.test(texture.descrizione(r)), texture.descrizione(r));

  console.log('\n=== Lo stesso seme da\' la stessa texture, un seme diverso la cambia ===');
  const a = await texture.crea({ tipo: 'pietra', uscita: path.join(cartella, 'a.png'), dimensione: 64, seme: 3 });
  const b = await texture.crea({ tipo: 'pietra', uscita: path.join(cartella, 'b.png'), dimensione: 64, seme: 3 });
  const c = await texture.crea({ tipo: 'pietra', uscita: path.join(cartella, 'c.png'), dimensione: 64, seme: 9 });
  check('stesso seme: file identico', fs.readFileSync(a.file).equals(fs.readFileSync(b.file)));
  check('seme diverso: texture diversa', !fs.readFileSync(a.file).equals(fs.readFileSync(c.file)));

  console.log('\n=== Errori detti chiaramente ===');
  const sbagliato = await texture.crea({ tipo: 'cioccolato', uscita: path.join(cartella, 'x.png') });
  check('tipo inventato: lo dice ed elenca quelli veri', !sbagliato.ok && /tipo sconosciuto/.test(sbagliato.errore) &&
    /pietra/.test(sbagliato.errore), JSON.stringify(sbagliato));
  check('le istruzioni per Adam dicono il comando e i tipi', /--tipo/.test(texture.testoPerPrompt()) &&
    /mattoni/.test(texture.testoPerPrompt()), texture.testoPerPrompt());
  check('le istruzioni dicono anche come farne una fotografica', /--foto/.test(texture.testoPerPrompt()), texture.testoPerPrompt());

  console.log('\n=== Texture fotografica, generata su questa scheda video ===');
  const python = require('../strumenti/cervello-python').trovaPython();
  let conModello = false;
  try {
    // Non basta importare il pacchetto diffusers: una combinazione incompatibile
    // diffusers/transformers puo' importare il modulo base ma fallire appena si carica
    // la pipeline vera. In quel caso la funzione opzionale non e' disponibile e la
    // prova GPU va saltata, non conteggiata come regressione del generatore procedurale.
    require('child_process').execFileSync(python, ['-c',
      'import torch; from diffusers import StableDiffusionPipeline, StableDiffusionXLPipeline; assert torch.cuda.is_available()'],
      { stdio: 'ignore', timeout: 120000 });
    conModello = true;
  } catch (e) {
    conModello = false;
  }
  if (!conModello) {
    console.log('  (modello per le immagini non disponibile su questo computer: prova saltata)');
    return fine();
  }
  const foto = await texture.crea({
    foto: 'muro di mattoni rossi consumati', uscita: path.join(cartella, 'foto.png'),
    dimensione: 512, passi: 8, seme: 3, timeout: 900000
  });
  check('generata e promossa dalle misure', foto.ok, JSON.stringify(foto.problemi || foto.errore));
  check('e\' una foto: tanti colori, nessuno dominante', foto.misure && foto.misure.colori > 150 && foto.misure.dominante < 0.4,
    JSON.stringify(foto.misure && { colori: foto.misure.colori, dominante: foto.misure.dominante }));
  check('i bordi sono stati resi circolari (quindi si ripete)', foto.misure && foto.misure.convoluzioniCircolari > 50,
    String(foto.misure && foto.misure.convoluzioniCircolari));
  check('c\'e\' la prova della ripetizione da guardare', !!foto.prova && fs.existsSync(foto.prova) &&
    fs.readFileSync(foto.prova).readUInt32BE(16) === 1024, String(foto.prova));
  check('descrizione con i secondi e dove guardare', /generata in/.test(texture.descrizione(foto)) &&
    /prova della ripetizione/.test(texture.descrizione(foto)), texture.descrizione(foto));
  const modelloSbagliato = await texture.crea({ foto: 'muro', modello: 'inventato', uscita: path.join(cartella, 'no.png') });
  check('un modello inventato viene detto subito', !modelloSbagliato.ok && /modello sconosciuto/.test(modelloSbagliato.errore), JSON.stringify(modelloSbagliato));

  fine();
})().catch(function (e) {
  fail++;
  console.log('  FAIL eccezione: ' + (e && e.stack || e));
  fine();
});
