// NotExist Intelligience Studio - Scheletri di partenza.
//
// Perche' esistono: un modello piccolo (Adam e' un 9B) MODIFICA bene e PROGETTA male. Chiedergli
// "fai un FPS multiplayer in stile Minecraft" vuol dire chiedergli di inventare l'architettura di
// venti file con dentro un motore 3D e una rete: il 15-16/9/2026 ne e' uscito un gioco 2D visto
// dall'alto, senza rete, e un "Fatto!". Se invece parte da un gioco che GIA' funziona, il suo
// lavoro diventa quello in cui e' bravo: aggiungere un pezzo per volta e farlo verificare.
//
// Ogni scheletro e' un progetto vero, provato dai test dello Studio (test/scheletri.test.js):
// si copia nella cartella dell'utente e parte con un doppio clic, senza installare niente.
//
// Uso:
//   node scheletri.js --elenco
//   node scheletri.js --usa fps-3d-web            copia lo scheletro nella cartella di lavoro
//   node scheletri.js --usa fps-3d-python --dir C:\...\gioco

const fs = require('fs');
const path = require('path');

const CARTELLA = path.join(__dirname, '..', 'scheletri');
const COMANDO = 'node "' + path.join(__dirname, 'scheletri.js').split(path.sep).join('/') + '"';

function slash(p) { return String(p).split('\\').join('/'); }

function deduceLinguaggio(cartella, scheda) {
  if (scheda && scheda.linguaggio) return scheda.linguaggio;
  if (fs.existsSync(path.join(cartella, 'main.py')) || fs.existsSync(path.join(cartella, 'server.py'))) {
    return 'Python (Pygame)';
  }
  if (fs.existsSync(path.join(cartella, 'package.json')) || fs.existsSync(path.join(cartella, 'index.html')) || fs.existsSync(path.join(cartella, 'gioco.js'))) {
    return 'JavaScript / Web (Three.js)';
  }
  return 'Non specificato';
}

function eProgettoUnity(dir) {
  if (!dir) return false;
  try {
    let cartella = path.resolve(dir);
    for (let i = 0; i < 8; i++) {
      if (fs.existsSync(path.join(cartella, 'Assets')) &&
         (fs.existsSync(path.join(cartella, 'ProjectSettings')) || fs.existsSync(path.join(cartella, 'ProjectSettings', 'ProjectVersion.txt')))) {
        return true;
      }
      const su = path.dirname(cartella);
      if (su === cartella) break;
      cartella = su;
    }
  } catch (e) { return false; }
  return false;
}

function schedaDi(nome) {
  const cartella = path.join(CARTELLA, nome);
  let scheda = {};
  try { scheda = JSON.parse(fs.readFileSync(path.join(cartella, 'scheletro.json'), 'utf8')); } catch (e) { scheda = {}; }
  const linguaggio = deduceLinguaggio(cartella, scheda);
  return Object.assign({ nome: nome, cartella: cartella, titolo: nome, linguaggio: linguaggio }, scheda, { linguaggio: linguaggio });
}

function elenco() {
  let voci;
  try { voci = fs.readdirSync(CARTELLA, { withFileTypes: true }); } catch (e) { return []; }
  return voci.filter(function (v) { return v.isDirectory(); }).map(function (v) { return schedaDi(v.name); });
}

// Tutti i file dello scheletro, percorsi relativi.
function fileDello(cartella) {
  const trovati = [];
  (function scendi(dentro, rel) {
    fs.readdirSync(dentro, { withFileTypes: true }).forEach(function (v) {
      const completo = path.join(dentro, v.name);
      const relativo = rel ? rel + '/' + v.name : v.name;
      // __pycache__ e i .pyc li crea Python da solo quando lo scheletro viene provato: nel progetto
      // dell'utente non servono (li rifa' lui) e farebbero solo confusione.
      if (v.isDirectory()) { if (v.name !== '__pycache__') scendi(completo, relativo); }
      else if (v.name !== 'scheletro.json' && !/\.pyc$/i.test(v.name)) trovati.push(relativo);
    });
  })(cartella, '');
  return trovati;
}

const MEDIA = /\.(png|jpe?g|gif|webp|bmp|glb|gltf|fbx|blend|wav|ogg|mp3)$/i;

// Una sottocartella che non c'e' ancora: <progetto>/<nome>, poi <nome>-2, <nome>-3...
function sottocartellaLibera(radice, nome) {
  let prova = path.join(radice, nome);
  for (let i = 2; fs.existsSync(prova) && i < 50; i++) prova = path.join(radice, nome + '-' + i);
  return prova;
}

// Copia lo scheletro nella cartella del progetto. Non sovrascrive niente senza dirlo: i file che
// esistono gia' restano dove sono e vengono elencati (cancellare il lavoro dell'utente e' il modo
// piu' veloce per fare danni).
function copia(nome, destinazione, opzioni) {
  opzioni = opzioni || {};
  const radice = path.resolve(destinazione || process.cwd());
  // Se la destinazione e' un progetto Unity, blocca tassativamente la copia per evitare danni
  if (eProgettoUnity(radice)) {
    return {
      ok: false,
      errore: 'la destinazione e\' un progetto Unity (C#). Gli scheletri dello Studio sono scritti per Web (JavaScript) o Python e NON devono essere copiati in un progetto Unity. In Unity il motore 3D c\'e\' gia\' e si creano script C# (.cs) dentro Assets/.'
    };
  }
  const scheda = schedaDi(nome);
  if (!fs.existsSync(scheda.cartella)) {
    return { ok: false, errore: 'non esiste nessuno scheletro "' + nome + '". Quelli che ci sono: ' + elenco().map(function (s) { return s.nome; }).join(', ') };
  }
  const file = fileDello(scheda.cartella);
  const esistenti = file.filter(function (f) { return fs.existsSync(path.join(radice, f)); });
  if (esistenti.length && !opzioni.sostituisci) {
    // Visto dal vivo il 18/9/2026: il messaggio offriva solo "sposta i file o cancellali"; Adam,
    // giustamente, non ha voluto buttare il gioco dell'utente, si e' bloccato e ha cominciato a
    // chiedere. La strada che non distrugge niente va detta per prima.
    const libera = sottocartellaLibera(radice, nome);
    return {
      ok: false, esistenti: esistenti, sottocartella: libera,
      errore: 'nella cartella ci sono gia\' ' + esistenti.slice(0, 6).join(', ') + (esistenti.length > 6 ? ' e altri' : '') +
        '. Non tocco niente. Copialo accanto, in una sottocartella, senza toccare i file dell\'utente: ' +
        '--usa ' + nome + ' --dir "' + slash(libera) + '". Solo se l\'utente ti ha detto che quei file vanno buttati: --sostituisci.'
    };
  }
  file.forEach(function (f) {
    const arrivo = path.join(radice, f);
    fs.mkdirSync(path.dirname(arrivo), { recursive: true });
    fs.copyFileSync(path.join(scheda.cartella, f), arrivo);
  });
  return { ok: true, nome: nome, cartella: radice, copiati: file.length, file: file, scheda: scheda };
}

function descrizione(scheda) {
  return [
    '- ' + scheda.nome + ' [Linguaggio: ' + (scheda.linguaggio || 'Non specificato') + ']: ' + scheda.titolo,
    scheda.cosaFaGia ? '  fa gia\': ' + scheda.cosaFaGia.join('; ') : '',
    scheda.come ? '  si prova cosi\': ' + scheda.come : '',
    scheda.serve ? '  serve: ' + scheda.serve : ''
  ].filter(Boolean).join('\n');
}

// Le istruzioni per Adam, nel prompt di sistema.
function testoPerPrompt(dir) {
  if (dir && eProgettoUnity(dir)) {
    return [
      'PROGETTO UNITY (C#):',
      '- ATTENZIONE: NON USARE GLI SCHELETRI DELLO STUDIO! Tutti gli scheletri sono per Web (JavaScript) o Python.',
      '- Su Unity NON vanno usati Three.js, WebGL o file Python: Unity e\' gia\' un motore 3D completo.',
      '- Sviluppa creando script C# (.cs) che estendono MonoBehaviour dentro la cartella Assets/ (es. Assets/Scripts/).'
    ].join('\n');
  }
  const tutti = elenco();
  if (!tutti.length) return '';
  return [
    'SCHELETRI DI PARTENZA (usali invece di scrivere un gioco 3D o multiplayer da zero): lo Studio ha progetti gia\'' +
      ' funzionanti e gia\' verificati:',
    tutti.map(function (s) {
      const ling = s.linguaggio ? ' [Linguaggio: ' + s.linguaggio + ']' : '';
      return '- ' + s.nome + ling + ': ' + s.titolo + (s.cosaFaGia ? ' (' + s.cosaFaGia.slice(0, 4).join(', ') + ')' : '');
    }).join('\n'),
    'QUANDO USARLI E REGOLE FONDAMENTALI:',
    '1. Rispetta SEMPRE il linguaggio del progetto: usa scheletri JavaScript SOLO per progetti Web/HTML, e scheletri Python SOLO per Python.',
    '2. Se il progetto e\' Unity (C#), NON USARE NESSUNO SCHELETRO: Unity ha la sua architettura in C# e copiare file JS/HTML danneggia il progetto.',
    '3. Per partire su Web o Python: ' + COMANDO + ' --usa <nome> (copia i file nella cartella di lavoro senza sovrascrivere niente).',
    '4. Gli scheletri originali si LEGGONO soltanto: non modificarli mai. Lavori sempre sulla copia nel progetto.',
    '5. Poi verifica che giri, e solo dopo aggiungi UN pezzo per volta, verificando ogni volta. Scrivere da zero un motore' +
      ' 3D o una rete porta a un gioco che non parte: questi partono gia\'.'
  ].join('\n');
}

const USO = [
  'Scheletri di partenza dello Studio. Uso:',
  '  ' + COMANDO + ' --elenco',
  '  ' + COMANDO + ' --usa <nome> [--dir <cartella>] [--sostituisci]'
].join('\n');

if (require.main === module) {
  const argomenti = process.argv.slice(2);
  const valore = function (nome) {
    const i = argomenti.indexOf(nome);
    return i === -1 ? null : (argomenti[i + 1] || null);
  };
  if (argomenti.indexOf('--elenco') !== -1) {
    const tutti = elenco();
    console.log(tutti.length ? tutti.map(descrizione).join('\n\n') : 'nessuno scheletro disponibile');
    process.exit(0);
  }
  const nome = valore('--usa');
  if (!nome) {
    console.log(USO);
    process.exit(argomenti.length ? 1 : 0);
  }
  const sostituisci = argomenti.indexOf('--sostituisci') !== -1;
  let esito = copia(nome, valore('--dir') || process.cwd(), { sostituisci: sostituisci });
  let accanto = false;
  // Cartella gia' occupata e nessuna destinazione scelta: invece di fermarsi (e far fermare
  // Adam), lo scheletro va accanto, in una sottocartella nuova. I file dell'utente restano come sono.
  if (!esito.ok && esito.sottocartella && !valore('--dir') && !sostituisci) {
    esito = copia(nome, esito.sottocartella, {});
    accanto = esito.ok;
  }
  if (!esito.ok) {
    console.log(esito.errore);
    process.exit(1);
  }
  if (accanto) {
    console.log('Nella cartella c\'erano gia\' dei file dell\'utente: NON li ho toccati. Ho copiato lo scheletro accanto, in ' +
      slash(esito.cartella) + '/. Il gioco nuovo parte da li\': aggiungi quello che serve un pezzo alla volta, lavorando in quella cartella.');
  }
  console.log('Copiati ' + esito.copiati + ' file in ' + slash(esito.cartella) + ':');
  // Immagini e modelli 3D si contano soltanto: 72 righe di .png coprirebbero i file da leggere.
  const media = esito.file.filter(function (f) { return MEDIA.test(f); });
  const daLeggere = esito.file.filter(function (f) { return !MEDIA.test(f); });
  console.log(daLeggere.slice(0, 12).map(function (f) { return '  ' + f; }).join('\n'));
  if (daLeggere.length > 12) console.log('  ... e altri ' + (daLeggere.length - 12));
  if (media.length) {
    const cartelle = media.map(function (f) { return f.split('/')[0] + (f.indexOf('/') !== -1 ? '/' : ''); })
      .filter(function (c, i, tutte) { return tutte.indexOf(c) === i; });
    console.log('  + ' + media.length + ' immagini e modelli 3D in ' + cartelle.join(', ') + ' (non serve leggerli)');
  }
  if (esito.scheda.come) console.log('\nCome si prova: ' + esito.scheda.come);
  if (esito.scheda.daFarePoi) console.log('Da aggiungere poi, uno alla volta: ' + esito.scheda.daFarePoi.join('; '));
  console.log('\nLeggi LEGGIMI.md nella cartella, poi verifica subito che giri prima di cambiare qualcosa.');
  process.exit(0);
}

module.exports = { elenco: elenco, copia: copia, schedaDi: schedaDi, fileDello: fileDello, testoPerPrompt: testoPerPrompt, eProgettoUnity: eProgettoUnity, CARTELLA: CARTELLA, COMANDO: COMANDO };
