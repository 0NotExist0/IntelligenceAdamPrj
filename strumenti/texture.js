// NotExist Intelligience Studio - Texture per i giochi, fatte in casa e controllate.
//
// L'utente (16/9/2026) ha chiesto "un modello che crea foto per le texture". Un modello che genera
// immagini (Stable Diffusion e simili) si puo' installare, ma sono diversi GB da scaricare e una
// decisione sua. Intanto queste servono davvero e non costano niente: nascono da rumore periodico,
// quindi si ripetono senza cuciture - che e' l'unica cosa che conta per i muri e il terreno di un
// gioco a blocchi.
//
// Come sempre nello Studio, non ci si fida "a occhio": la texture viene misurata (quanti colori,
// quanto e' visibile la cucitura, quanto domina un colore solo) e se e' un quadrato piatto lo dice.
//
// Uso:
//   node texture.js --tipo pietra --uscita immagini/pietra.png [--dimensione 256] [--seme 7]
//   node texture.js --elenco

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const SCRIPT = path.join(__dirname, 'texture-procedurale.py');
const SCRIPT_AI = path.join(__dirname, 'texture-ai.py');
const COMANDO = 'node "' + path.join(__dirname, 'texture.js').split(path.sep).join('/') + '"';
const TIPI = ['pietra', 'erba', 'terra', 'legno', 'mattoni', 'sabbia', 'metallo', 'foglie'];
const MODELLI_FOTO = ['foto', 'sdxl'];

// Perche' una texture sia utilizzabile: deve avere del disegno dentro e non deve mostrare la
// giunzione quando viene ripetuta. Numeri, non impressioni.
const MINIMO_COLORI = 24;
const MASSIMO_DOMINANTE = 0.6;

function slash(p) { return String(p).split('\\').join('/'); }

// Le stesse regole per tutte le texture, disegnate a mano o generate dal modello: chi le ha fatte
// non conta, contano le misure.
function giudica(misure, uscita) {
  const problemi = [];
  if (misure.colori < MINIMO_COLORI) {
    problemi.push('ha solo ' + misure.colori + ' colori: sullo schermo sembrera\' un quadrato piatto');
  }
  if (misure.dominante > MASSIMO_DOMINANTE) {
    problemi.push('un colore solo copre il ' + Math.round(misure.dominante * 100) + '% dell\'immagine');
  }
  // La giunzione si giudica confrontandola con i salti che esistono GIA' dentro la texture:
  // una parete di mattoni ha righe di malta nette anche in mezzo, quindi una riga netta al
  // bordo non e' un difetto; lo diventa se il bordo e' piu' netto di qualsiasi altro punto.
  const limite = Math.max(misure.saltoNormale * 3 + 2, (misure.saltoMassimo || 0) * 1.15);
  if (misure.cucitura > limite) {
    problemi.push('la giunzione si vede: ripetendola si notera\' una riga (' + misure.cucitura + ' contro ' + limite.toFixed(1) + ')');
  }
  let byte = 0;
  try { byte = fs.statSync(uscita).size; } catch (e) { byte = 0; }
  if (!byte) problemi.push('il file non e\' stato scritto');
  return { problemi: problemi, byte: byte };
}

function eseguiPython(python, argomenti, timeout) {
  return new Promise(function (risolvi) {
    execFile(python, argomenti, { timeout: timeout, maxBuffer: 20 * 1024 * 1024, windowsHide: true }, function (err, stdout, stderr) {
      const testo = String(stdout || '') + String(stderr || '');
      const riga = testo.split(/\r?\n/).find(function (l) { return l.indexOf('TEXTURE=') === 0; });
      if (!riga) {
        return risolvi({ errore: (err && err.killed) ? 'ci ha messo troppo ed e\' stato fermato' : (testo.trim().split('\n').pop() || 'nessuna risposta') });
      }
      try { risolvi({ misure: JSON.parse(riga.slice('TEXTURE='.length)) }); } catch (e) { risolvi({ errore: 'risposta non leggibile' }); }
    });
  });
}

function crea(opzioni) {
  const o = opzioni || {};
  // Con una descrizione si passa al modello che genera immagini (in locale, sulla scheda video).
  if (o.foto) return creaFoto(o);
  const tipo = String(o.tipo || '').toLowerCase();
  return new Promise(function (risolvi) {
    if (TIPI.indexOf(tipo) === -1) {
      return risolvi({ ok: false, errore: 'tipo sconosciuto: "' + (o.tipo || '') + '". Tipi: ' + TIPI.join(', ') + '. Per una texture fotografica: --foto "muro di pietra antica"' });
    }
    const python = o.python || require('./cervello-python').trovaPython();
    if (!python) return risolvi({ ok: false, errore: 'Python non e\' installato' });
    const uscita = path.resolve(o.uscita || (tipo + '.png'));
    try { fs.mkdirSync(path.dirname(uscita), { recursive: true }); } catch (e) { /* c'e' gia' */ }
    eseguiPython(python, [SCRIPT, tipo, uscita, String(o.dimensione || 256), String(o.seme === undefined ? 7 : o.seme)], 120000)
      .then(function (r) {
        if (r.errore) return risolvi({ ok: false, errore: 'la texture non e\' stata creata: ' + r.errore });
        const g = giudica(r.misure, uscita);
        risolvi({ ok: g.problemi.length === 0, file: slash(uscita), tipo: tipo, misure: r.misure, byte: g.byte, problemi: g.problemi });
      });
  });
}

// Texture fotografica generata dal modello che gira su questo computer: niente internet, niente
// account. Le convoluzioni vengono messe a bordo "circolare", quindi l'immagine nasce gia' ripetibile.
function creaFoto(opzioni) {
  const o = opzioni || {};
  return new Promise(function (risolvi) {
    const python = o.python || require('./cervello-python').trovaPython();
    if (!python) return risolvi({ ok: false, errore: 'Python non e\' installato' });
    const modello = String(o.modello || 'foto').toLowerCase();
    if (MODELLI_FOTO.indexOf(modello) === -1) {
      return risolvi({ ok: false, errore: 'modello sconosciuto: "' + modello + '" (modelli: ' + MODELLI_FOTO.join(', ') + ')' });
    }
    const uscita = path.resolve(o.uscita || 'texture.png');
    try { fs.mkdirSync(path.dirname(uscita), { recursive: true }); } catch (e) { /* c'e' gia' */ }
    const opzioniPython = {
      descrizione: String(o.foto), uscita: uscita, dimensione: o.dimensione || 512,
      passi: o.passi || 22, modello: modello, seme: o.seme === undefined ? 7 : o.seme,
      prova: o.prova !== false
    };
    eseguiPython(python, [SCRIPT_AI, JSON.stringify(opzioniPython)], o.timeout || 900000).then(function (r) {
      if (r.errore) return risolvi({ ok: false, errore: 'la texture non e\' stata generata: ' + r.errore });
      const g = giudica(r.misure, uscita);
      risolvi({
        ok: g.problemi.length === 0, file: slash(uscita), tipo: 'foto (' + modello + ')',
        misure: r.misure, byte: g.byte, problemi: g.problemi, prova: r.misure.prova ? slash(r.misure.prova) : null
      });
    });
  });
}

function descrizione(r) {
  if (!r.ok && r.errore) return 'texture non creata: ' + r.errore;
  const m = r.misure || {};
  return [
    (r.ok ? 'texture pronta: ' : 'texture creata ma da controllare: ') + r.file +
      ' (' + m.larghezza + 'x' + m.altezza + ', ' + Math.round(r.byte / 1024) + ' KB)',
    '   ' + m.colori + ' colori, colore dominante ' + Math.round((m.dominante || 0) * 100) +
      '%, giunzione ' + m.cucitura + ' (salto normale fra colonne vicine ' + m.saltoNormale + '): si ripete senza righe visibili' +
      (r.problemi.length ? '' : '.'),
    r.problemi.length ? '   DA CONTROLLARE: ' + r.problemi.join('; ') : '',
    m.secondiDisegno ? '   generata in ' + m.secondiDisegno + ' s sulla scheda video di questo computer' : '',
    r.prova ? '   prova della ripetizione (la stessa texture quattro volte), da guardare con Read: ' + r.prova : '',
    '   guardala con Read: ' + r.file
  ].filter(Boolean).join('\n');
}

// Le istruzioni per Adam, nel prompt di sistema (solo per i progetti che disegnano qualcosa).
function testoPerPrompt() {
  return 'TEXTURE: per muri, terreno e oggetti non cercare immagini sul web e non lasciare colori piatti. ' +
    'Disegnate a mano: ' + COMANDO + ' --tipo <' + TIPI.join('|') + '> --uscita immagini/muro.png [--dimensione 256]. ' +
    'Fotografiche (modello che gira su questa scheda video, circa 6 s): ' + COMANDO + ' --foto "muro di pietra antica" ' +
    '--uscita immagini/muro.png [--dimensione 512]. Si ripetono senza cuciture, lo Studio le misura e ti dice se sono ' +
    'venute piatte o con la giunzione visibile; guarda sempre il risultato con Read prima di usarlo.';
}

const USO = [
  'Texture per i giochi, tutte in locale. Uso:',
  '  ' + COMANDO + ' --tipo <' + TIPI.join('|') + '> --uscita immagini/muro.png [--dimensione 256] [--seme 7]',
  '  ' + COMANDO + ' --foto "muro di pietra antica" --uscita immagini/muro.png [--dimensione 512] [--passi 22] [--modello foto|sdxl]',
  '  ' + COMANDO + ' --elenco',
  '  --tipo: disegnata coi numeri, immediata. --foto: generata dal modello sulla scheda video (qualche secondo).'
].join('\n');

if (require.main === module) {
  const argomenti = process.argv.slice(2);
  const valore = function (nome) {
    const i = argomenti.indexOf(nome);
    return i === -1 ? null : (argomenti[i + 1] || null);
  };
  if (argomenti.indexOf('--elenco') !== -1) {
    console.log('Tipi di texture: ' + TIPI.join(', '));
    process.exit(0);
  }
  const tipo = valore('--tipo');
  const foto = valore('--foto');
  const uscita = valore('--uscita');
  if ((!tipo && !foto) || !uscita) {
    console.log(USO);
    process.exit(argomenti.length ? 1 : 0);
  }
  crea({
    tipo: tipo, foto: foto, uscita: uscita,
    modello: valore('--modello') || 'foto',
    passi: Number(valore('--passi')) || 22,
    dimensione: Number(valore('--dimensione')) || (foto ? 512 : 256),
    seme: valore('--seme') === null ? 7 : Number(valore('--seme'))
  }).then(function (r) {
    console.log(descrizione(r));
    process.exit(r.ok ? 0 : 1);
  });
}

module.exports = { crea: crea, descrizione: descrizione, testoPerPrompt: testoPerPrompt, TIPI: TIPI, COMANDO: COMANDO };
