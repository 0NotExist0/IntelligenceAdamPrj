// La sonda deve accorgersi di una pagina che "funziona" ma non mostra niente. Caso vero
// (15/9/2026): il gioco di Adam partiva, gli zombie nascevano, nessun errore JavaScript, e la
// riprova dello Studio diceva "nessun difetto misurato"; a schermo pero' c'era solo lo sfondo.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sondaPagina } = require('../strumenti/sonda');
const runtime = require('../analisi-runtime');
const misure = require('../strumenti/confronto-misure');

let pass = 0;
let fail = 0;
function check(nome, condizione, dettaglio) {
  if (condizione) { pass++; console.log('  ok   ' + nome); }
  else { fail++; console.log('  FAIL ' + nome + (dettaglio !== undefined ? '  -> ' + dettaglio : '')); }
}

const cartelle = [];
function progetto(html) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prova-schermo-'));
  cartelle.push(dir);
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  return dir;
}
function fine() {
  cartelle.forEach(function (d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} });
  console.log('\n' + '='.repeat(50));
  console.log('SCHERMO VUOTO: ' + pass + ' passati, ' + fail + ' falliti');
  process.exit(fail ? 1 : 0);
}

const MENU = '<div id="menu" style="color:#fff;font:20px sans-serif"><h1>Gioco degli zombie</h1>' +
  '<button id="via">Inizia Gioco</button></div>';

(async function () {
  if (!runtime.disponibile()) {
    console.log('  (browser non disponibile: prova saltata)');
    return fine();
  }

  console.log('\n=== Il gioco gira ma non disegna niente (il caso vero) ===');
  const vuoto = progetto('<!doctype html><html><body style="margin:0;background:#1b1b2e">' + MENU +
    '<script>let stato = "menu"; let nemici = [];\n' +
    'document.getElementById("via").addEventListener("click", function () {\n' +
    '  document.getElementById("menu").style.display = "none"; stato = "gioco";\n' +
    '  setInterval(function () { nemici.push({ x: Math.random() }); }, 500);\n' +
    '  requestAnimationFrame(function ciclo() { requestAnimationFrame(ciclo); });\n' +
    '});</script></body></html>');
  let r = await sondaPagina({ dir: vuoto, pagina: 'index.html', osserva: ['stato', 'nemici.length'] });
  const nota = (r.note || []).find(function (n) { return /lo schermo resta quasi vuoto/.test(n); });
  check('segnalato: lo schermo resta quasi vuoto', !!nota, JSON.stringify(r.note));
  check('per lo Studio e\' un difetto da correggere (categoria schermo)', !!nota && misure.categoriaFatto(nota) === 'schermo' &&
    misure.fattiDellaSonda(r).indexOf(nota) !== -1, nota && misure.categoriaFatto(nota));
  check('il colore dominante e\' quello dello sfondo', !!(r.schermoVuoto && /^#1[89a-c]1[89a-c]2[c-f]$/i.test(r.schermoVuoto.colore)), JSON.stringify(r.schermoVuoto));
  check('le variabili cambiano davvero: non e\' una pagina ferma', (r.momenti || []).some(function (m) { return m.valori.stato === '"gioco"'; }),
    JSON.stringify((r.momenti || []).map(function (m) { return m.valori; })));
  check('lo schermo risulta provato', !!(r.provati && r.provati.schermo));

  console.log('\n=== Il gioco disegna davvero ===');
  const disegna = progetto('<!doctype html><html><body style="margin:0;background:#1b1b2e">' + MENU +
    '<div id="punti" style="position:fixed;top:8px;left:8px;color:#fff;font:24px sans-serif"></div>\n' +
    '<script>let stato = "menu"; let nemici = [];\n' +
    'document.getElementById("via").addEventListener("click", function () {\n' +
    '  document.getElementById("menu").style.display = "none"; stato = "gioco";\n' +
    '  const c = document.createElement("canvas"); c.width = innerWidth; c.height = innerHeight; document.body.appendChild(c);\n' +
    '  const g = c.getContext("2d");\n' +
    '  setInterval(function () { nemici.push({ x: Math.random() * innerWidth, y: Math.random() * innerHeight }); }, 300);\n' +
    '  requestAnimationFrame(function ciclo() {\n' +
    '    g.fillStyle = "#2e7d32"; g.fillRect(0, innerHeight * 0.7, innerWidth, innerHeight * 0.3);\n' +
    '    g.fillStyle = "#c62828"; nemici.forEach(function (n) { g.fillRect(n.x, n.y, 60, 90); });\n' +
    '    document.getElementById("punti").textContent = "Zombie: " + nemici.length + "  Vita: 100";\n' +
    '    requestAnimationFrame(ciclo);\n' +
    '  });\n' +
    '});</script></body></html>');
  r = await sondaPagina({ dir: disegna, pagina: 'index.html', osserva: ['stato', 'nemici.length'] });
  check('nessuna segnalazione di schermo vuoto', !(r.note || []).some(function (n) { return /schermo resta quasi vuoto/.test(n); }),
    JSON.stringify(r.note));
  check('nessun errore JavaScript', !(r.errori || []).length, JSON.stringify(r.errori));
  fine();
})().catch(function (e) {
  fail++;
  console.log('  FAIL eccezione: ' + (e && e.stack || e));
  fine();
});
