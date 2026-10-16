// Prova la verifica completa: il testo per Adam, gli argomenti, e una verifica vera in Chrome
// su due progetti finti, uno rotto come il gioco di Adam (una chiave mai creata blocca tutto
// il file) e uno sano.
const fs = require('fs');
const os = require('os');
const path = require('path');
const verifica = require('../strumenti/verifica');
const runtime = require('../analisi-runtime');

let pass = 0;
let fail = 0;
function check(nome, condizione, dettaglio) {
  if (condizione) { pass++; console.log('  ok   ' + nome); }
  else { fail++; console.log('  FAIL ' + nome + (dettaglio !== undefined ? '  -> ' + dettaglio : '')); }
}

const cartelle = [];
function progetto(file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prova-verifica-'));
  cartelle.push(dir);
  Object.keys(file).forEach(function (nome) {
    const completo = path.join(dir, nome);
    fs.mkdirSync(path.dirname(completo), { recursive: true });
    fs.writeFileSync(completo, file[nome]);
  });
  return dir;
}
const baseDati = fs.mkdtempSync(path.join(os.tmpdir(), 'prova-verifica-dati-'));
cartelle.push(baseDati);

function fine() {
  cartelle.forEach(function (d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} });
  console.log('\n' + '='.repeat(50));
  console.log('VERIFICA: ' + pass + ' passati, ' + fail + ' falliti');
  process.exit(fail ? 1 : 0);
}

console.log('\n=== Argomenti e istruzioni per Adam ===');
const o = verifica.leggiArgomenti(['gioco.html', '--passi', 'clic #start; attendi 500', '--osserva', 'punti;vite']);
check('pagina letta', o.pagine.length === 1 && o.pagine[0] === 'gioco.html');
check('passi divisi sul ";"', o.passi.length === 2 && o.passi[1] === 'attendi 500', JSON.stringify(o.passi));
check('valori da osservare divisi', o.osserva.length === 2 && o.osserva[0] === 'punti');

const conPagine = progetto({ 'index.html': '<p>ciao</p>' });
const soloNode = progetto({ 'server.js': "require('http').createServer().listen(0);" });
const testoPagine = verifica.testoPerPrompt(conPagine);
check('prompt con pagine: comando, passi e schermate', testoPagine.indexOf('verifica.js') !== -1 && testoPagine.indexOf('--passi') !== -1 &&
  testoPagine.indexOf('Read') !== -1, testoPagine);
check('prompt senza pagine: eseguire davvero il programma', verifica.testoPerPrompt(soloNode).indexOf('esegui davvero il programma') !== -1);
check('prompt compatto (sotto i 1350 caratteri)', testoPagine.length < 1350, testoPagine.length);

(async function () {
  console.log('\n=== Passi scritti male ===');
  const r0 = await verifica.verifica({ dir: conPagine, passi: ['salta sul tavolo'], base: baseDati });
  check('passo sconosciuto: dice quali passi esistono, senza aprire il browser', r0.testo.indexOf('passo non riconosciuto') !== -1 &&
    r0.testo.indexOf('clic #id') !== -1, r0.testo);

  console.log('\n=== Progetto senza pagine ===');
  const rn = await verifica.verifica({ dir: soloNode, base: baseDati });
  check('niente browser, consiglio di eseguire il programma', rn.testo.indexOf('NESSUNA PAGINA HTML') !== -1 && rn.conta.pagine === 0, rn.testo);

  console.log('\n=== Opzioni nuove: telefono e Blender ===');
  const o2 = verifica.leggiArgomenti(['index.html', '--telefono', '--blender', 'scena.py']);
  check('--telefono e --blender letti', o2.telefono === true && o2.blender === 'scena.py' && o2.pagine[0] === 'index.html', JSON.stringify(o2));

  console.log('\n=== Progetto Python ===');
  const soloPython = progetto({ 'app.py': 'def saluta(nome):\n    return "ciao " + nome\nprint(saluta(nomee))\n' });
  const rp = await verifica.verifica({ dir: soloPython, base: baseDati });
  check('sezione Python con il NameError come errore grave', rp.testo.indexOf('IL CODICE PYTHON') !== -1 && /NameError/.test(rp.testo) && rp.conta.gravi >= 1, rp.testo);
  check('niente sezione pagine per un progetto solo Python', rp.testo.indexOf('LA PAGINA') === -1 && rp.conta.pagine === 0, rp.testo);

  console.log('\n=== Progetto Unity ===');
  const soloUnity = progetto({
    'ProjectSettings/ProjectVersion.txt': 'm_EditorVersion: 6000.2.2f1\n',
    'Assets/Scripts/Nave.cs': 'using UnityEngine;\npublic class Nave : MonoBehaviour {\n  void update() { }\n}\n'
  });
  const ru = await verifica.verifica({ dir: soloUnity, base: baseDati });
  check('sezione Unity con update() minuscolo grave', ru.testo.indexOf('IL PROGETTO UNITY 6000.2.2f1') !== -1 && ru.testo.indexOf('update() non viene mai chiamato') !== -1 && ru.conta.gravi === 1, ru.testo);
  check('spiega che senza una prima compilazione di Unity non compila', /Unity non ha ancora compilato|compilatore di Unity non si trova/.test(ru.testo), ru.testo);

  if (verifica.trovaBlender()) {
    console.log('\n=== Script di Blender eseguito davvero, con anteprima ===');
    const scena = progetto({ 'scena.py': 'import bpy\nbpy.ops.mesh.primitive_uv_sphere_add(radius=1, location=(0, 0, 1))\n' });
    const rb = await verifica.verifica({ dir: scena, blender: 'scena.py', base: baseDati });
    check('eseguito fino in fondo, con l\'oggetto creato e l\'anteprima', rb.testo.indexOf('eseguito fino in fondo') !== -1 && rb.testo.indexOf('Sphere') !== -1 &&
      rb.testo.indexOf('anteprima, da guardare con Read') !== -1, rb.testo);
    const rotto = progetto({ 'rotto.py': 'import bpy\n\nbpy.ops.mesh.add_cube()\n' });
    const rr = await verifica.verifica({ dir: rotto, blender: 'rotto.py', base: baseDati });
    check('script con operatore inesistente: errore in Blender con la riga', rr.conta.blender === 1 && rr.testo.indexOf('alla riga 3') !== -1, rr.testo);
  } else {
    console.log('\n  (Blender non installato: prova degli script saltata)');
  }

  if (!runtime.disponibile()) {
    console.log('\n  (browser non disponibile: salto le prove in Chrome)');
    return fine();
  }

  console.log('\n=== Verifica vera in Chrome: progetto rotto come il gioco di Adam ===');
  const rotto = progetto({
    'index.html': '<button id="start">Via</button>\n<div id="punti">0</div>\n<script src="gioco.js"></script>',
    'gioco.js': "const ui = { punti: document.getElementById('punti') };\n" +
      "ui.start.addEventListener('click', function () { ui.punti.textContent = '1'; });"
  });
  let r = await verifica.verifica({ dir: rotto, base: baseDati });
  check('il cervello trova ui.start: GRAVE gioco.js:2', r.testo.indexOf('GRAVE gioco.js:2') !== -1 && r.conta.gravi === 1, r.testo);
  check('la pagina vera da\' l\'errore JavaScript', r.conta.erroriPagina >= 1 && /addEventListener/.test(r.testo), r.testo);
  check('riepilogo: NON e\' ancora a posto, con cosa fare', r.testo.indexOf('NON e\' ancora a posto') !== -1 && r.testo.indexOf('COSA FARE ADESSO') !== -1, r.testo);

  console.log('\n=== Verifica vera in Chrome: progetto sano, con passi precisi ===');
  const sano = progetto({
    'index.html': '<button id="start">Via</button>\n<div id="punti">0</div>\n<script src="gioco.js"></script>',
    'gioco.js': "const ui = { start: document.getElementById('start'), punti: document.getElementById('punti') };\n" +
      "ui.start.addEventListener('click', function () { ui.punti.textContent = String(Number(ui.punti.textContent) + 1); });"
  });
  r = await verifica.verifica({ dir: sano, pagine: ['index.html'], passi: ['clic #start', 'attendi 300'], base: baseDati });
  check('nessun errore nel codice ne\' nella pagina', r.conta.gravi === 0 && r.conta.erroriPagina === 0 && r.conta.pagine === 1, r.testo);
  check('indica le schermate da guardare con Read', r.testo.indexOf('schermate, da guardare con Read') !== -1, r.testo);
  fine();
})().catch(function (e) {
  fail++;
  console.log('  FAIL eccezione: ' + (e && e.stack || e));
  fine();
});
