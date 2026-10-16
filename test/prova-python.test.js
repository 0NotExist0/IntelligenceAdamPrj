// Prova gli "occhi" per i programmi Python: lanciare davvero un gioco pygame senza aprire finestre,
// vedere se aggiorna lo schermo, premere Spazio come una persona e leggere l'errore con la riga.
// Casi veri del 15/9/2026: un gioco senza pygame.display.flip() dichiarato "completato con successo",
// e pygame.draw.circle con il centro sbagliato che ferma il gioco al primo zombie.
const fs = require('fs');
const os = require('os');
const path = require('path');
const prova = require('../strumenti/prova-python');
const py = require('../strumenti/cervello-python');

let pass = 0;
let fail = 0;
function check(nome, condizione, dettaglio) {
  if (condizione) { pass++; console.log('  ok   ' + nome); }
  else { fail++; console.log('  FAIL ' + nome + (dettaglio !== undefined ? '  -> ' + dettaglio : '')); }
}
const cartelle = [];
function progetto(file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prova-pygame-'));
  cartelle.push(dir);
  Object.keys(file).forEach(function (nome) { fs.writeFileSync(path.join(dir, nome), file[nome]); });
  return dir;
}
function fine() {
  cartelle.forEach(function (d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} });
  console.log('\n' + '='.repeat(50));
  console.log('PROVA PYTHON: ' + pass + ' passati, ' + fail + ' falliti');
  process.exit(fail ? 1 : 0);
}

console.log('\n=== Punto di avvio e traceback ===');
const dirAvvio = progetto({ 'utili.py': 'x = 1\n', 'gioco.py': 'print(1)\n' });
check('trova gioco.py come file da lanciare', path.basename(prova.trovaPuntoDiAvvio(dirAvvio) || '') === 'gioco.py');
const tb = prova.leggiTraceback([
  'Traceback (most recent call last):',
  '  File "' + path.join(dirAvvio, 'gioco.py') + '", line 12, in <module>',
  '  File "C:\\Python311\\Lib\\site-packages\\pygame\\x.py", line 3, in f',
  'TypeError: center argument must be a pair of numbers'
].join('\n'), dirAvvio);
check('traceback: riga del progetto, non della libreria', tb && tb.file === 'gioco.py' && tb.riga === 12 && /TypeError/.test(tb.messaggio), JSON.stringify(tb));

(async function () {
  if (!py.trovaPython()) { console.log('  (Python non installato: prove saltate)'); return fine(); }
  let haPygame = true;
  try { require('child_process').execFileSync(py.trovaPython(), ['-c', 'import pygame'], { stdio: 'ignore', env: Object.assign({}, process.env, { PYGAME_HIDE_SUPPORT_PROMPT: '1' }) }); } catch (e) { haPygame = false; }
  if (!haPygame) { console.log('  (pygame non installato: prove della finestra saltate)'); return fine(); }

  console.log('\n=== Gioco senza pygame.display.flip() (il caso di Adam) ===');
  let dir = progetto({ 'main.py': [
    'import pygame',
    'pygame.init()',
    'schermo = pygame.display.set_mode((640, 480))',
    'orologio = pygame.time.Clock()',
    'while True:',
    '    for e in pygame.event.get():',
    '        if e.type == pygame.QUIT:',
    '            raise SystemExit',
    '    schermo.fill((10, 10, 26))',
    '    pygame.draw.rect(schermo, (200, 0, 0), (100, 100, 50, 80))',
    '    orologio.tick(60)'
  ].join('\n') });
  let r = await prova.provaPython(dir, { secondi: 6 });
  let d = prova.problemiDellaProva(r);
  check('il programma resta aperto e viene fermato dallo Studio', r.restaAperto === true, JSON.stringify(r).slice(0, 300));
  check('finestra 640x480 vista da dentro', r.finestra && r.finestra.finestra && r.finestra.finestra[0] === 640, JSON.stringify(r.finestra));
  const maiAggiornato = d.problemi.find(function (p) { return /non viene MAI aggiornato/.test(p.messaggio); });
  check('GRAVE: lo schermo non viene mai aggiornato (manca flip)', !!maiAggiornato && maiAggiornato.grave, JSON.stringify(d));
  check('Spazio, Invio e clic inviati comunque', r.finestra && r.finestra.input && r.finestra.input.length === 4, JSON.stringify(r.finestra && r.finestra.input));

  console.log('\n=== Gioco che si rompe quando si preme Spazio ===');
  dir = progetto({ 'main.py': [
    'import pygame',
    'pygame.init()',
    'schermo = pygame.display.set_mode((640, 480))',
    'orologio = pygame.time.Clock()',
    'in_gioco = False',
    'while True:',
    '    for e in pygame.event.get():',
    '        if e.type == pygame.KEYDOWN and e.key == pygame.K_SPACE:',
    '            in_gioco = True',
    '    schermo.fill((30, 30, 60))',
    '    if in_gioco:',
    '        pygame.draw.circle(schermo, (255, 255, 0), 100, 100, 5)',
    '    pygame.display.flip()',
    '    orologio.tick(60)'
  ].join('\n') });
  r = await prova.provaPython(dir, { secondi: 6 });
  d = prova.problemiDellaProva(r);
  const crash = d.problemi.find(function (p) { return /si ferma con/.test(p.messaggio); });
  check('errore vero dopo Spazio, con la riga 12 del file', !!crash && crash.grave && crash.riga === 12 && crash.file === 'main.py', JSON.stringify(d.problemi) + ' ' + (r.uscita || '').slice(-300));
  check('il programma non e\' rimasto aperto: si e\' fermato da solo', r.restaAperto === false, String(r.restaAperto));

  console.log('\n=== Gioco sano che disegna ===');
  dir = progetto({ 'main.py': [
    'import pygame, random',
    'pygame.init()',
    'schermo = pygame.display.set_mode((640, 480))',
    'pygame.display.set_caption("Sano")',
    'orologio = pygame.time.Clock()',
    'quadrati = [(random.randint(0, 600), random.randint(0, 440)) for _ in range(40)]',
    'while True:',
    '    for e in pygame.event.get():',
    '        if e.type == pygame.QUIT:',
    '            raise SystemExit',
    '    schermo.fill((20, 20, 40))',
    '    for x, y in quadrati:',
    '        pygame.draw.rect(schermo, (0, 180, 90), (x, y, 60, 60))',
    '    pygame.draw.circle(schermo, (255, 255, 0), (320, 240), 40)',
    '    pygame.display.flip()',
    '    orologio.tick(60)'
  ].join('\n') });
  r = await prova.provaPython(dir, { secondi: 6 });
  d = prova.problemiDellaProva(r);
  check('nessun problema', d.problemi.length === 0, JSON.stringify(d.problemi));
  check('titolo della finestra letto', r.finestra && r.finestra.titolo === 'Sano', JSON.stringify(r.finestra));
  const schermate = (r.finestra && r.finestra.schermate) || [];
  check('due schermate salvate, con colore dominante sotto il 97%', schermate.length === 2 && schermate.every(function (s) { return s.file && fs.existsSync(s.file) && s.quota < 0.97; }), JSON.stringify(schermate));
  schermate.forEach(function (s) { try { fs.unlinkSync(s.file); } catch (e) {} });
  fine();
})().catch(function (e) {
  fail++;
  console.log('  FAIL eccezione: ' + (e && e.stack || e));
  fine();
});
