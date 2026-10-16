// Prova gli scheletri di partenza: devono FUNZIONARE, non solo esistere.
// Sono la risposta al fatto che un modello da 9B non sa progettare da zero un gioco 3D
// multiplayer: parte da qui, che gira gia', e aggiunge un pezzo alla volta.
// Qui si prova sul serio: si avvia il server del gioco, si collegano due giocatori veri,
// uno spara all'altro e si controlla che la vita scenda. Se questo test passa, lo scheletro
// consegnato all'utente e' un gioco che parte.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const CARTELLA = path.join(__dirname, '..', 'scheletri');
const PORTA = 8757;

let pass = 0;
let fail = 0;
function check(nome, condizione, dettaglio) {
  if (condizione) { pass++; console.log('  ok   ' + nome); }
  else { fail++; console.log('  FAIL ' + nome + (dettaglio !== undefined ? '  -> ' + dettaglio : '')); }
}
function attesa(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function apriGiocatore(indirizzo) {
  return new Promise(function (risolvi, rifiuta) {
    const presa = new WebSocket(indirizzo);
    const ricevuti = [];
    presa.on('message', function (dati) {
      try { ricevuti.push(JSON.parse(String(dati))); } catch (e) { /* non JSON */ }
    });
    presa.on('open', function () { risolvi({ presa: presa, ricevuti: ricevuti, manda: function (m) { presa.send(JSON.stringify(m)); } }); });
    presa.on('error', rifiuta);
    setTimeout(function () { rifiuta(new Error('il server non risponde')); }, 8000);
  });
}
function ultimo(ricevuti, tipo) {
  return ricevuti.filter(function (m) { return m.tipo === tipo; }).pop();
}

(async function () {
  console.log('\n=== Lo scheletro FPS 3D per il web: i file ci sono ===');
  const web = path.join(CARTELLA, 'fps-3d-web');
  ['index.html', 'gioco.js', 'rete.js', 'server.js', 'avvia.bat', 'vendor/three.module.js'].forEach(function (f) {
    check('c\'e\' ' + f, fs.existsSync(path.join(web, f)));
  });
  const html = fs.readFileSync(path.join(web, 'index.html'), 'utf8');
  check('la pagina carica il gioco come modulo', /<script type="module" src="gioco\.js">/.test(html));
  const gioco = fs.readFileSync(path.join(web, 'gioco.js'), 'utf8');
  check('vista in prima persona: blocco del mouse', /requestPointerLock/.test(gioco));
  check('3D vero: Three.js e telecamera prospettica', /three\.module\.js/.test(gioco) && /PerspectiveCamera/.test(gioco));

  console.log('\n=== Il server del gioco parte e serve la pagina ===');
  const server = spawn(process.execPath, ['server.js'], {
    cwd: web, env: Object.assign({}, process.env, { PORTA: String(PORTA) }), windowsHide: true
  });
  let uscitaServer = '';
  server.stdout.on('data', function (d) { uscitaServer += d; });
  server.stderr.on('data', function (d) { uscitaServer += d; });
  const fine = function () {
    try { server.kill(); } catch (e) {}
    console.log('\n' + '='.repeat(50));
    console.log('SCHELETRI: ' + pass + ' passati, ' + fail + ' falliti');
    process.exit(fail ? 1 : 0);
  };

  let pronto = false;
  for (let i = 0; i < 40 && !pronto; i++) {
    await attesa(150);
    pronto = /Gioco pronto/.test(uscitaServer);
  }
  check('il server dice che il gioco e\' pronto', pronto, uscitaServer.slice(0, 300));
  if (!pronto) return fine();

  const risposta = await fetch('http://127.0.0.1:' + PORTA + '/').then(function (r) { return r.text(); }, function (e) { return 'errore: ' + e.message; });
  check('http://localhost serve la pagina del gioco', /FPS a blocchi/.test(risposta), risposta.slice(0, 120));
  // I ".." scritti cosi' arrivano al server senza essere raddrizzati dal browser: e' il modo
  // vero in cui si prova a leggere i file fuori dalla cartella del gioco.
  const fuori = await fetch('http://127.0.0.1:' + PORTA + '/%2e%2e%2fserver.js').then(function (r) { return r.status; }, function () { return 0; });
  check('non si esce dalla cartella del gioco', fuori === 403 || fuori === 404, String(fuori));

  console.log('\n=== Due giocatori veri, collegati insieme ===');
  let anna;
  let bruno;
  try {
    anna = await apriGiocatore('ws://127.0.0.1:' + PORTA);
    bruno = await apriGiocatore('ws://127.0.0.1:' + PORTA);
  } catch (e) {
    check('i due giocatori si collegano', false, e.message);
    return fine();
  }
  await attesa(300);
  const benvenutoAnna = ultimo(anna.ricevuti, 'benvenuto');
  const benvenutoBruno = ultimo(bruno.ricevuti, 'benvenuto');
  check('ognuno riceve il suo numero di giocatore', !!benvenutoAnna && !!benvenutoBruno && benvenutoAnna.id !== benvenutoBruno.id,
    JSON.stringify([benvenutoAnna && benvenutoAnna.id, benvenutoBruno && benvenutoBruno.id]));

  bruno.manda({ tipo: 'stato', x: 21.5, y: 6, z: 25.5, ry: 1.2, nome: 'Bruno' });
  await attesa(400);
  const mondoDiAnna = ultimo(anna.ricevuti, 'mondo');
  const brunoVistoDaAnna = mondoDiAnna && mondoDiAnna.giocatori.find(function (g) { return g.id === benvenutoBruno.id; });
  check('Anna vede Bruno dove Bruno si e\' mosso', !!brunoVistoDaAnna && brunoVistoDaAnna.x === 21.5 && brunoVistoDaAnna.z === 25.5,
    JSON.stringify(brunoVistoDaAnna));

  console.log('\n=== Uno spara, all\'altro scende la vita ===');
  anna.manda({ tipo: 'sparo', bersaglio: 'giocatore', id: benvenutoBruno.id });
  await attesa(300);
  const vita = ultimo(bruno.ricevuti, 'vita');
  check('un colpo toglie vita a Bruno', !!vita && vita.id === benvenutoBruno.id && vita.vita === 75, JSON.stringify(vita));
  for (let i = 0; i < 3; i++) {
    anna.manda({ tipo: 'sparo', bersaglio: 'giocatore', id: benvenutoBruno.id });
    await attesa(120);
  }
  await attesa(300);
  check('quattro colpi: Bruno muore e Anna fa punto', !!ultimo(bruno.ricevuti, 'morto'),
    JSON.stringify(bruno.ricevuti.slice(-3)));
  const mondoDopo = ultimo(anna.ricevuti, 'mondo');
  const annaDopo = mondoDopo && mondoDopo.giocatori.find(function (g) { return g.id === benvenutoAnna.id; });
  check('il punto e\' segnato sul server', !!annaDopo && annaDopo.punti === 1, JSON.stringify(annaDopo));

  console.log('\n=== Chi esce sparisce dalla partita ===');
  bruno.presa.close();
  await attesa(500);
  const mondoFinale = ultimo(anna.ricevuti, 'mondo');
  check('Bruno non e\' piu\' in partita', !!mondoFinale && !mondoFinale.giocatori.some(function (g) { return g.id === benvenutoBruno.id; }),
    JSON.stringify(mondoFinale && mondoFinale.giocatori));
  anna.presa.close();
  await attesa(200);
  try { server.kill(); } catch (e) {}

  console.log('\n=== Lo scheletro FPS 3D in Python: i file ci sono ===');
  const py = path.join(CARTELLA, 'fps-3d-python');
  ['main.py', 'mondo.py', 'server.py', 'avvia.bat', 'LEGGIMI.md'].forEach(function (f) {
    check('c\'e\' ' + f, fs.existsSync(path.join(py, f)));
  });
  const gpy = fs.readFileSync(path.join(py, 'main.py'), 'utf8');
  check('la riga che mostra lo schermo c\'e\'', /pygame\.display\.flip\(\)/.test(gpy));
  check('motore 3D a raggi (non un gioco 2D visto dall\'alto)', /MOTORE 3D/.test(gpy) && /def lancia_raggio/.test(gpy));

  const python = require('../strumenti/cervello-python').trovaPython();
  if (!python) {
    console.log('  (Python non installato: salto la partita in Python)');
  } else {
    console.log('\n=== Due giocatori veri sul server Python ===');
    const portaPython = 50117;
    const serverPy = spawn(python, ['server.py'], {
      cwd: py, windowsHide: true,
      env: Object.assign({}, process.env, { PORTA_GIOCO: String(portaPython), PYTHONUNBUFFERED: '1' })
    });
    let uscitaPy = '';
    serverPy.stdout.on('data', function (d) { uscitaPy += d; });
    serverPy.stderr.on('data', function (d) { uscitaPy += d; });
    let prontoPy = false;
    for (let i = 0; i < 40 && !prontoPy; i++) {
      await attesa(150);
      prontoPy = /Server pronto/.test(uscitaPy);
    }
    check('il server Python parte', prontoPy, uscitaPy.slice(0, 300));
    if (prontoPy) {
      const dgram = require('dgram');
      const apriUdp = function () {
        const presa = dgram.createSocket('udp4');
        const ricevuti = [];
        presa.on('message', function (d) {
          try { ricevuti.push(JSON.parse(String(d))); } catch (e) { /* non JSON */ }
        });
        presa.bind();
        return {
          presa: presa, ricevuti: ricevuti,
          manda: function (m) { presa.send(Buffer.from(JSON.stringify(m)), portaPython, '127.0.0.1'); }
        };
      };
      const carla = apriUdp();
      const dario = apriUdp();
      carla.manda({ tipo: 'entro' });
      await attesa(200);
      dario.manda({ tipo: 'entro' });
      await attesa(400);
      const benvenutoCarla = ultimo(carla.ricevuti, 'benvenuto');
      const benvenutoDario = ultimo(dario.ricevuti, 'benvenuto');
      check('ognuno riceve il suo numero di giocatore', !!benvenutoCarla && !!benvenutoDario && benvenutoCarla.id !== benvenutoDario.id,
        JSON.stringify([benvenutoCarla && benvenutoCarla.id, benvenutoDario && benvenutoDario.id]));

      dario.manda({ tipo: 'stato', x: 7.25, y: 9.5, ang: 1.5 });
      await attesa(400);
      const mondoDiCarla = ultimo(carla.ricevuti, 'mondo');
      const darioVisto = mondoDiCarla && mondoDiCarla.giocatori.find(function (g) { return g.id === benvenutoDario.id; });
      check('Carla vede Dario dove Dario si e\' mosso', !!darioVisto && darioVisto.x === 7.25 && darioVisto.y === 9.5, JSON.stringify(darioVisto));

      for (let i = 0; i < 4; i++) {
        carla.manda({ tipo: 'sparo', bersaglio: 'giocatore', id: benvenutoDario.id });
        await attesa(120);
      }
      await attesa(400);
      const mondoDopo = ultimo(carla.ricevuti, 'mondo');
      const carlaDopo = mondoDopo && mondoDopo.giocatori.find(function (g) { return g.id === benvenutoCarla.id; });
      check('quattro colpi: Carla fa punto e Dario rinasce con 100 di vita', !!carlaDopo && carlaDopo.punti === 1 &&
        mondoDopo.giocatori.find(function (g) { return g.id === benvenutoDario.id; }).vita === 100, JSON.stringify(mondoDopo && mondoDopo.giocatori));
      check('gli zombie li mette il server', Array.isArray(mondoDopo && mondoDopo.zombie), JSON.stringify(mondoDopo && mondoDopo.zombie));
      carla.presa.close();
      dario.presa.close();
    }
    try { serverPy.kill(); } catch (e) {}
    await attesa(200);
  }

  console.log('\n=== Consegnare uno scheletro ad Adam ===');
  const scheletri = require('../strumenti/scheletri');
  const nomi = scheletri.elenco().map(function (s) { return s.nome; });
  check('l\'elenco contiene i due scheletri con il loro titolo', nomi.indexOf('fps-3d-web') !== -1 && nomi.indexOf('fps-3d-python') !== -1 &&
    /Three\.js/.test(scheletri.schedaDi('fps-3d-web').titolo), JSON.stringify(nomi));
  const destinazione = fs.mkdtempSync(path.join(os.tmpdir(), 'prova-scheletro-'));
  const copiato = scheletri.copia('fps-3d-python', destinazione);
  check('copia lo scheletro nella cartella del progetto', copiato.ok && fs.existsSync(path.join(destinazione, 'main.py')) &&
    fs.existsSync(path.join(destinazione, 'server.py')), JSON.stringify(copiato.errore || copiato.copiati));
  check('scheletro.json non finisce nel progetto dell\'utente', !fs.existsSync(path.join(destinazione, 'scheletro.json')));
  const secondo = scheletri.copia('fps-3d-python', destinazione);
  check('non sovrascrive quello che c\'e\' gia\'', !secondo.ok && /gia'/.test(secondo.errore) && secondo.esistenti.indexOf('main.py') !== -1, JSON.stringify(secondo));
  const inesistente = scheletri.copia('gioco-di-carte', destinazione);
  check('uno scheletro che non esiste: lo dice e elenca quelli veri', !inesistente.ok && /fps-3d-web/.test(inesistente.errore), JSON.stringify(inesistente));
  const prompt = scheletri.testoPerPrompt();
  check('le istruzioni per Adam nominano gli scheletri e il comando', /fps-3d-web/.test(prompt) && /fps-3d-python/.test(prompt) && /--usa/.test(prompt), prompt);
  check('le istruzioni specificano i linguaggi', /Linguaggio:/.test(prompt) && /JavaScript/.test(prompt) && /Python/.test(prompt), prompt);

  // Progetto Unity: non deve permettere la copia di scheletri web/python
  const dirUnity = fs.mkdtempSync(path.join(os.tmpdir(), 'prova-unity-'));
  fs.mkdirSync(path.join(dirUnity, 'Assets'));
  fs.mkdirSync(path.join(dirUnity, 'ProjectSettings'));
  fs.writeFileSync(path.join(dirUnity, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 6000.2.2f1');
  const copiaUnity = scheletri.copia('fps-3d-web', dirUnity);
  check('blocca la copia su un progetto Unity con errore chiaro', !copiaUnity.ok && /progetto Unity/i.test(copiaUnity.errore), JSON.stringify(copiaUnity));
  const promptUnity = scheletri.testoPerPrompt(dirUnity);
  check('su Unity le istruzioni dicono di NON usare scheletri e scrivere C#', /PROGETTO UNITY/i.test(promptUnity) && /NON USARE GLI SCHELETRI/i.test(promptUnity) && /Assets\//.test(promptUnity), promptUnity);
  try { fs.rmSync(dirUnity, { recursive: true, force: true }); } catch (e) {}

  try { fs.rmSync(destinazione, { recursive: true, force: true }); } catch (e) {}

  fine();
})().catch(function (e) {
  fail++;
  console.log('  FAIL eccezione: ' + (e && e.stack || e));
  console.log('\nSCHELETRI: ' + pass + ' passati, ' + fail + ' falliti');
  process.exit(1);
});
