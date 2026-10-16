// Prova la sonda su due pagine costruite apposta. La prima riproduce i difetti del
// caso reale (livello dell'interfaccia sopra il canvas, ciclo di animazione che si
// moltiplica a ogni avvio, errore che compare solo usando la pagina); la seconda e'
// sana e non deve generare falsi allarmi: una sonda che grida "al lupo" spingerebbe
// Adam a correggere cose che funzionano.
const fs = require('fs');
const os = require('os');
const path = require('path');
const runtime = require('../analisi-runtime');
const { sondaPagina, eseguiCollaudi, verificaStili } = require('../strumenti/sonda');

// Le misure dell'aspetto delle pagine finiscono qui e non in dati/cervello dello Studio.
const DATI = fs.mkdtempSync(path.join(os.tmpdir(), 'sonda-dati-'));
process.on('exit', function () { try { fs.rmSync(DATI, { recursive: true, force: true }); } catch (e) {} });
const { fattiDellaSonda } = require('../strumenti/confronto-misure');

let pass = 0;
let fail = 0;
function check(nome, condizione, dettaglio) {
  if (condizione) { pass++; console.log('  ok   ' + nome); }
  else { fail++; console.log('  FAIL ' + nome + (dettaglio !== undefined ? '  -> ' + dettaglio : '')); }
}

const ROTTA = `<!DOCTYPE html>
<html><head><title>Gioco rotto</title>
<style>
  body { margin: 0; }
  canvas { display: block; }
  #ui { position: absolute; top: 0; left: 0; right: 0; bottom: 0; z-index: 10; }
  #start { position: absolute; top: 45%; left: 45%; padding: 12px 30px; }
</style></head>
<body>
  <canvas id="c" width="1280" height="800"></canvas>
  <div id="ui"><button id="start">Gioca</button></div>
  <script>
    let mouseX = 0;
    let mouseY = 0;
    let punti = 0;
    const canvas = document.getElementById('c');
    canvas.addEventListener('mousemove', function (e) { mouseX = e.offsetX; mouseY = e.offsetY; });
    function ciclo() { punti++; requestAnimationFrame(ciclo); }
    function aggiorna() { nemico.x += 1; }
    document.getElementById('start').addEventListener('click', function () {
      ciclo();
      setTimeout(aggiorna, 200);
    });
  </script>
</body></html>`;

// La partita finisce solo dopo 5 secondi: prima la sonda aspettava 3 secondi e il
// riavvio restava non provato, proprio il caso in cui il ciclo raddoppia.
const PARTITA = `<!DOCTYPE html>
<html><head><title>Partita a tempo</title>
<style>
  body { margin: 0; }
  #start { position: absolute; top: 40%; left: 40%; padding: 12px 30px; }
</style></head>
<body>
  <button id="start">Gioca</button>
  <script>
    let partite = 0;
    function ciclo() { requestAnimationFrame(ciclo); }
    document.getElementById('start').addEventListener('click', function () {
      const b = this;
      partite++;
      b.style.display = 'none';
      ciclo();
      setTimeout(function () { b.textContent = 'Riprova!'; b.style.display = 'block'; }, 5000);
    });
  </script>
</body></html>`;

// Script esterno con un ramo che non viene mai eseguito: la copertura deve saperlo.
const COPERTURA_HTML = `<!DOCTYPE html>
<html><head><title>Copertura</title></head>
<body><button id="start">Gioca</button><script src="copertura.js"></script></body></html>`;
const COPERTURA_JS = [
  'let colpi = 0;',
  'function colpisci(nemico) {',
  '  if (nemico.vita <= 0) {',
  '    esplodi(tipo.colore);',
  '  }',
  '}',
  "document.getElementById('start').addEventListener('click', function () {",
  '  colpi++;',
  '  colpisci({ vita: 3 });',
  '});'
].join('\n');

// Il pulsante non avvia piu' niente: come il gioco dopo una "correzione" sbagliata.
const MORTA = `<!DOCTYPE html>
<html><head><title>Non parte</title></head>
<body>
  <button id="start">Gioca</button>
  <script>
    let pronto = false;
    let inGioco = false;
    let punti = 0;
    function avvia() { if (pronto) { inGioco = true; } }
    document.getElementById('start').addEventListener('click', avvia);
  </script>
</body></html>`;

const SANA = `<!DOCTYPE html>
<html><head><title>Gioco sano</title>
<style>
  body { margin: 0; }
  canvas { display: block; }
  #start { position: absolute; top: 20px; left: 20px; padding: 12px 30px; }
</style></head>
<body>
  <canvas id="c" width="1000" height="600"></canvas>
  <button id="start">Gioca</button>
  <script>
    let mouseX = 0;
    let mouseY = 0;
    let giro = null;
    const canvas = document.getElementById('c');
    canvas.addEventListener('mousemove', function (e) { mouseX = e.offsetX; mouseY = e.offsetY; });
    function ciclo() { giro = requestAnimationFrame(ciclo); }
    document.getElementById('start').addEventListener('click', function () {
      if (giro) cancelAnimationFrame(giro);
      ciclo();
    });
  </script>
</body></html>`;

// I difetti che la sonda non vedeva (gioco reale del 10/9/2026): nemici distrutti che
// restano nell'elenco con vita <= 0, e ne nascono 30 al secondo.
const ACCUMULO = `<!DOCTYPE html>
<html><head><title>Accumulo</title>
<style> body { margin: 0; } canvas { display: block; } #start { position: absolute; top: 20px; left: 20px; } </style></head>
<body>
  <canvas id="c" width="800" height="600"></canvas>
  <button id="start">Gioca</button>
  <script>
    let nemici = [];
    let punti = 0;
    function ciclo() {
      if (Math.random() < 0.5) nemici.push({ x: Math.random() * 800, y: 0, health: 1 });
      nemici.forEach(function (n) { n.y += 1; });
      if (nemici.length) { nemici[Math.floor(Math.random() * nemici.length)].health--; punti += 100; }
      requestAnimationFrame(ciclo);
    }
    document.getElementById('start').addEventListener('click', function () { this.style.display = 'none'; ciclo(); });
  </script>
</body></html>`;

// Sana ma "difficile": nemici che nascono e muoiono di continuo, una riserva di proiettili
// che restano nell'elenco spenti (active: false), nemici che restano mezzo secondo dopo la
// morte per l'esplosione. Nessuno di questi e' un difetto.
const SANA_OGGETTI = `<!DOCTYPE html>
<html><head><title>Sana con oggetti</title>
<style> body { margin: 0; } canvas { display: block; } #start { position: absolute; top: 20px; left: 20px; } </style></head>
<body>
  <canvas id="c" width="800" height="600"></canvas>
  <button id="start">Gioca</button>
  <script>
    let nemici = [];
    const colpi = [];
    for (let i = 0; i < 20; i++) colpi.push({ x: 0, y: 0, vita: 0, active: false });
    let giro = null;
    function ciclo() {
      const ora = performance.now();
      if (Math.random() < 0.05) nemici.push({ x: Math.random() * 800, y: 0, health: 1, morto: 0 });
      nemici.forEach(function (n) {
        n.y += 2;
        if (n.health > 0 && Math.random() < 0.01) { n.health = 0; n.morto = ora; }
      });
      nemici = nemici.filter(function (n) { return n.y < 600 && !(n.health <= 0 && ora - n.morto > 500); });
      const libero = colpi.find(function (c) { return !c.active; });
      if (libero && Math.random() < 0.2) { libero.active = true; libero.vita = 1; }
      colpi.forEach(function (c) { if (c.active && Math.random() < 0.1) { c.vita = 0; c.active = false; } });
      giro = requestAnimationFrame(ciclo);
    }
    document.getElementById('start').addEventListener('click', function () {
      this.style.display = 'none';
      if (giro) cancelAnimationFrame(giro);
      ciclo();
    });
  </script>
</body></html>`;

// Per i collaudi: una navicella invulnerabile (come nel gioco reale, "if (vita > 80) return").
const COLLAUDABILE = `<!DOCTYPE html>
<html><head><title>Collaudi</title></head>
<body>
  <button id="start">Gioca</button>
  <script>
    let inGioco = false;
    let vita = 100;
    let nemici = [];
    const nave = { x: 100, y: 100 };
    function ciclo() {
      nemici.forEach(function (n) {
        if (Math.abs(n.x - nave.x) < 20 && Math.abs(n.y - nave.y) < 20) {
          if (vita > 80) return;
          vita -= 20;
        }
      });
      requestAnimationFrame(ciclo);
    }
    document.getElementById('start').addEventListener('click', function () { inGioco = true; ciclo(); });
  </script>
</body></html>`;

// Un menu iniziale: il pulsante sta al centro, sopra il canvas. E' voluto, non un difetto.
const MENU = `<!DOCTYPE html>
<html><head><title>Menu</title>
<style> body { margin: 0; } canvas { display: block; }
  #start { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); padding: 40px 120px; } </style></head>
<body>
  <canvas id="c" width="1280" height="800"></canvas>
  <button id="start">Gioca</button>
  <script>
    let giro = null;
    document.getElementById('start').addEventListener('click', function () {
      this.style.display = 'none';
      function ciclo() { giro = requestAnimationFrame(ciclo); }
      ciclo();
    });
  </script>
</body></html>`;

// Un'app che non e' un gioco: un campo, un pulsante che (giustamente) ignora il campo vuoto,
// Invio che aggiunge, un menu. Serve a provare la compilazione della sonda e i passi di flusso.
const MODULO = `<!DOCTYPE html>
<html><head><title>Modulo</title></head>
<body>
  <input id="campo" placeholder="Cosa comprare">
  <select id="cat"><option value="frutta">Frutta</option><option value="pane">Pane</option></select>
  <button id="aggiungi" style="padding: 20px 60px">Aggiungi</button>
  <button id="svuota">Svuota</button>
  <ul id="elenco"></ul>
  <script>
    let voci = [];
    function aggiungi() {
      const c = document.getElementById('campo');
      if (!c.value.trim()) return;
      voci.push(c.value.trim() + ':' + document.getElementById('cat').value);
      c.value = '';
      document.getElementById('elenco').innerHTML = voci.map(function (v) { return '<li>' + v + '</li>'; }).join('');
    }
    document.getElementById('aggiungi').addEventListener('click', aggiungi);
    document.getElementById('campo').addEventListener('keydown', function (e) { if (e.key === 'Enter') aggiungi(); });
  </script>
</body></html>`;

// Per la verifica degli stili dell'editor visivo: una regola del progetto piu' specifica
// copre quella dello Studio.
const STILI_HTML = `<!DOCTYPE html>
<html><head><link rel="stylesheet" href="stile.css"><link rel="stylesheet" href="studio-modifiche.css"></head>
<body><div id="box" class="forte">ciao</div><p id="libero">testo</p><button id="grad">Gioca</button></body></html>`;
const STILI_PROGETTO = 'div#box.forte { color: blue; } #grad { background: linear-gradient(45deg, #ff6b35, #f7931e); }';

// La console del browser: quello che una persona leggerebbe negli strumenti di sviluppo.
// Qui dentro c'e' tutto quello che alla sonda sfuggiva: un file che non si carica, un
// console.error preso da un try/catch (il programma non si ferma e nessun 'pageerror'
// scatta), un avviso, e un errore vero che invece si ferma.
const CONSOLE_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Console</title></head>
<body><h1>Gioco</h1><button id="via">Gioca</button>
<script src="manca.js"><\/script>
<script>
console.log('carico il mondo');
console.warn('texture del muro assente, uso il grigio');
try { JSON.parse('{rotto'); } catch (e) { console.error('livelli illeggibili'); }
document.getElementById('via').addEventListener('click', function () {
  console.error('il livello 1 non parte');
  console.error('il livello 1 non parte');
  pippo();
});
<\/script>
</body></html>`;

(async function () {
  if (!runtime.disponibile()) {
    console.log('Browser di controllo non disponibile: prova della sonda saltata.');
    process.exit(0);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prova-sonda-'));
  fs.writeFileSync(path.join(dir, 'rotta.html'), ROTTA);
  fs.writeFileSync(path.join(dir, 'sana.html'), SANA);
  fs.writeFileSync(path.join(dir, 'partita.html'), PARTITA);
  fs.writeFileSync(path.join(dir, 'copertura.html'), COPERTURA_HTML);
  fs.writeFileSync(path.join(dir, 'copertura.js'), COPERTURA_JS);
  fs.writeFileSync(path.join(dir, 'morta.html'), MORTA);
  fs.writeFileSync(path.join(dir, 'accumulo.html'), ACCUMULO);
  fs.writeFileSync(path.join(dir, 'sana-oggetti.html'), SANA_OGGETTI);
  fs.writeFileSync(path.join(dir, 'collaudabile.html'), COLLAUDABILE);
  fs.writeFileSync(path.join(dir, 'menu.html'), MENU);
  fs.writeFileSync(path.join(dir, 'modulo.html'), MODULO);
  fs.writeFileSync(path.join(dir, 'stili.html'), STILI_HTML);
  fs.writeFileSync(path.join(dir, 'console.html'), CONSOLE_HTML);
  fs.writeFileSync(path.join(dir, 'stile.css'), STILI_PROGETTO);

  try {
    console.log('\n=== Pagina con i difetti del caso reale ===');
    const r = await sondaPagina({ pagina: 'rotta.html', dir: dir, baseDati: DATI });
    const note = (r.note || []).join('\n');
    check('la sonda termina senza errori propri', !r.errore, r.errore);
    check('osserva le variabili degli script dentro la pagina', r.osservate.indexOf('mouseX') !== -1,
      JSON.stringify(r.osservate));
    check('trova il livello che copre il canvas', /canvas#c arriva a div#ui/.test(note), note);
    check('trova il ciclo che si moltiplica a ogni avvio', /passano da \d+ a \d+/.test(note), note);
    check('nota che il mouse non arriva al codice', /mouseX e mouseY valgono ancora 0/.test(note), note);
    check('dice come e\' fatto chi copre il canvas', /\(div#ui: position absolute, z-index 10, pointer-events auto/.test(note), note);
    check('dice quale funzione gira in piu\' cicli', /la funzione ciclo ora gira \d+ volte al secondo/.test(note), note);
    check('cattura l\'errore che compare usando la pagina, con file e riga',
      r.errori.some(function (e) { return /nemico is not defined \[rotta\.html:\d+\]/.test(e); }),
      JSON.stringify(r.errori));
    check('lo stesso errore compare una volta sola', r.errori.length === 1, JSON.stringify(r.errori));
    check('scatta le schermate', r.schermate.length >= 3 &&
      r.schermate.every(function (x) { return fs.existsSync(x.file); }), r.schermate.length);
    const larghezza = fs.readFileSync(r.schermate[0].file).readUInt32BE(16);
    check('schermate a meta\' risoluzione, per pesare meno nel contesto', larghezza === 640, larghezza);

    check('dichiara di aver provato il riavvio', r.provati && r.provati.riavvio === true, JSON.stringify(r.provati));

    console.log('\n=== Partita che finisce dopo 5 secondi: la sonda aspetta ===');
    const t = await sondaPagina({ pagina: 'partita.html', dir: dir, baseDati: DATI });
    const noteT = (t.note || []).join('\n');
    check('aspetta la fine della partita e prova il riavvio', t.provati && t.provati.riavvio === true,
      JSON.stringify(t.provati) + ' ' + noteT);
    check('vede il ciclo che raddoppia al riavvio', /Dopo il secondo clic su "Riprova!" le callback di animazione passano da \d+ a \d+/.test(noteT), noteT);
    check('vede che il ciclo girava gia\' prima del secondo clic', /gia' prima del secondo clic girava \d+ volte al secondo/.test(noteT), noteT);
    check('fotografa lo stato prima del secondo clic', t.momenti.some(function (m) { return m.momento === 'prima del secondo clic'; }),
      t.momenti.map(function (m) { return m.momento; }).join(', '));

    console.log('\n=== Copertura: quali righe sono state eseguite ===');
    const cov = await sondaPagina({ pagina: 'copertura.html', dir: dir, baseDati: DATI });
    const linee = (cov.lineeEseguite || {})['copertura.js'];
    const eseguita = (n) => !!linee && linee.some((i) => n >= i[0] && n <= i[1]);
    check('registra le righe del file .js', !!linee, JSON.stringify(cov.lineeEseguite));
    check('la riga del clic e\' stata eseguita', eseguita(8), JSON.stringify(linee));
    check('il ramo mai percorso non risulta eseguito', !eseguita(4), JSON.stringify(linee));
    const { confrontaFatti } = require('../strumenti/confronto-misure');
    const esitoCov = confrontaFatti(['Errore JavaScript: Uncaught ReferenceError: tipo is not defined [copertura.js:4]'], [], cov.provati, cov.lineeEseguite);
    check('un errore su una riga mai eseguita dopo resta da verificare', esitoCov.nonVerificati.length === 1, JSON.stringify(esitoCov));

    console.log('\n=== Pulsante che non avvia niente ===');
    const morta = await sondaPagina({ pagina: 'morta.html', dir: dir, baseDati: DATI });
    const noteMorta = (morta.note || []).join('\n');
    check('se il clic non fa nulla e\' un difetto', /Il clic sul pulsante "Gioca" non produce alcun effetto misurabile/.test(noteMorta), noteMorta);
    check('e riavvio e cicli non contano come provati', morta.provati && morta.provati.riavvio === false && morta.provati.cicli === false,
      JSON.stringify(morta.provati));

    console.log('\n=== Pagina sana: nessun falso allarme ===');
    const s = await sondaPagina({ pagina: 'sana.html', dir: dir, baseDati: DATI });
    check('la sonda termina senza errori propri', !s.errore, s.errore);
    const fatti = fattiDellaSonda(s);
    check('nessun difetto misurato', fatti.length === 0, JSON.stringify(fatti));
    const ultimo = s.momenti[s.momenti.length - 1] || { valori: {} };
    check('il mouse arriva al canvas', ultimo.valori.mouseX !== undefined && ultimo.valori.mouseX !== '0',
      JSON.stringify(ultimo.valori));

    console.log('\n=== La console del browser ===');
    const co = await sondaPagina({ pagina: 'console.html', dir: dir, baseDati: DATI });
    const messaggi = co.console || [];
    const vocePer = function (testo) { return messaggi.find(function (m) { return m.testo.indexOf(testo) !== -1; }); };
    check('la sonda termina senza errori propri', !co.errore, co.errore);
    check('vede il console.error preso da un try/catch', !!vocePer('livelli illeggibili') && vocePer('livelli illeggibili').tipo === 'errore',
      JSON.stringify(messaggi));
    check('con il file e la riga da cui esce', !!vocePer('livelli illeggibili') && /console\.html:\d+/.test(vocePer('livelli illeggibili').dove),
      vocePer('livelli illeggibili') && vocePer('livelli illeggibili').dove);
    check('vede il console.warn come avviso', !!vocePer('texture del muro') && vocePer('texture del muro').tipo === 'avviso',
      JSON.stringify(messaggi));
    check('vede anche il racconto normale (console.log)', !!vocePer('carico il mondo') && vocePer('carico il mondo').tipo === 'log',
      JSON.stringify(messaggi));
    check('i messaggi uguali si raggruppano con il conteggio', !!vocePer('il livello 1 non parte') && vocePer('il livello 1 non parte').volte >= 2,
      vocePer('il livello 1 non parte') && vocePer('il livello 1 non parte').volte);
    check('il file che manca finisce fra quelli che non si caricano',
      (co.rete || []).some(function (v) { return /manca\.js/.test(v.file); }), JSON.stringify(co.rete));
    const fattiCo = fattiDellaSonda(co);
    check('un console.error diventa un difetto misurato',
      fattiCo.some(function (f) { return /^Nella console del browser: "livelli illeggibili"/.test(f); }), JSON.stringify(fattiCo));
    check('e cosi\' il file che non si carica',
      fattiCo.some(function (f) { return /^Il file .*manca\.js non si carica/.test(f); }), JSON.stringify(fattiCo));
    check('l\'errore vero resta fra gli errori JavaScript', (co.errori || []).some(function (e) { return /pippo/.test(e); }),
      JSON.stringify(co.errori));
    check('e non viene raccontato una seconda volta come messaggio di console',
      !fattiCo.some(function (f) { return /^Nella console del browser: .*pippo/.test(f); }), JSON.stringify(fattiCo));
    check('il rapporto ha la sezione della console', /CONSOLE DEL BROWSER/.test(co.rapporto) &&
      /FILE CHE IL BROWSER NON RIESCE A CARICARE/.test(co.rapporto), co.rapporto.slice(0, 200));

    console.log('\n=== Oggetti eliminati che restano ed elenco che cresce ===');
    const passaggi = [];
    const acc = await sondaPagina({ pagina: 'accumulo.html', dir: dir, baseDati: DATI, progresso: function (t) { passaggi.push(t); } });
    const noteAcc = (acc.note || []).join('\n');
    check('vede i nemici eliminati rimasti nell\'elenco', /Oggetti eliminati che restano in gioco: in nemici \d+ element/.test(noteAcc), noteAcc);
    check('dice quale campo e\' a zero', /hanno health <= 0|ha health <= 0/.test(noteAcc), noteAcc);
    check('vede l\'elenco che cresce', /L'elenco nemici continua a crescere/.test(noteAcc), noteAcc);
    check('il rapporto mostra gli elenchi nel tempo', /ELENCHI NEL TEMPO[\s\S]*nemici: \d+ \(\ds\)/.test(acc.rapporto), acc.rapporto.slice(-900));
    check('dichiara provati oggetti e crescita', acc.provati && acc.provati.oggetti === true && acc.provati.crescita === true, JSON.stringify(acc.provati));
    check('racconta a che punto e\'', passaggi.some(function (t) { return /Aspetto la fine della partita/.test(t); }) &&
      passaggi.some(function (t) { return /^Clic vero su/.test(t); }), passaggi.join(' | '));

    console.log('\n=== Pagina sana con riserve di oggetti: nessun falso allarme ===');
    const so = await sondaPagina({ pagina: 'sana-oggetti.html', dir: dir, baseDati: DATI });
    const fattiSo = fattiDellaSonda(so);
    check('nessun difetto misurato', fattiSo.length === 0, JSON.stringify(fattiSo));
    check('ma gli elenchi li ha seguiti davvero', so.provati && so.provati.crescita === true && so.serie.length >= 6, JSON.stringify(so.provati));

    console.log('\n=== Menu con il pulsante sopra il canvas: non e\' un difetto ===');
    const menu = await sondaPagina({ pagina: 'menu.html', dir: dir, baseDati: DATI });
    const fattiMenu = fattiDellaSonda(menu);
    check('un pulsante sopra il canvas non e\' "canvas coperto"', !fattiMenu.some(function (f) { return /^Il mouse sopra/.test(f); }),
      JSON.stringify(fattiMenu));

    console.log('\n=== Un modulo si prova compilandolo ===');
    const mod = await sondaPagina({ pagina: 'modulo.html', dir: dir, baseDati: DATI });
    const noteMod = (mod.note || []).join('\n');
    check('compila il campo prima del clic', /Ho compilato 1 campo prima del clic: input#campo = "prova"/.test(noteMod), noteMod);
    check('e allora il pulsante non sembra rotto', !/non produce alcun effetto/.test(noteMod), noteMod);
    check('la compilazione e\' informativa, non un difetto', fattiDellaSonda(mod).length === 0, JSON.stringify(fattiDellaSonda(mod)));
    const flusso = await eseguiCollaudi({ pagina: 'modulo.html', dir: dir, collaudi: [
      { nome: 'Flusso: Invio, menu e pulsante', passi: ['scrivi #campo | pane', 'tasto Enter', 'seleziona #cat | pane', 'scrivi #campo | latte', 'clic #aggiungi', 'attendi 200'],
        verifica: "voci.length === 2 && voci[0] === 'pane:frutta' && voci[1] === 'latte:pane'", misura: ['voci.join()'] },
      { nome: 'Campo che non esiste', passi: ['scrivi #manca | x'], verifica: 'true', misura: [] },
      { nome: 'Voce di menu che non esiste', passi: ['seleziona #cat | carne'], verifica: 'true', misura: [] }
    ] });
    const ef = {};
    (flusso.esiti || []).forEach(function (x) { ef[x.nome] = x; });
    check('un flusso scritto tasto per tasto, con Invio e menu, passa', ef['Flusso: Invio, menu e pulsante'] &&
      ef['Flusso: Invio, menu e pulsante'].esito === 'superato', JSON.stringify(ef['Flusso: Invio, menu e pulsante']));
    check('scrivere in un campo inesistente = fallito per causa elemento', ef['Campo che non esiste'] &&
      ef['Campo che non esiste'].causa === 'elemento', JSON.stringify(ef['Campo che non esiste']));
    check('una voce di menu inesistente = fallito per causa elemento', ef['Voce di menu che non esiste'] &&
      ef['Voce di menu che non esiste'].causa === 'elemento', JSON.stringify(ef['Voce di menu che non esiste']));
    const aMano = await sondaPagina({ pagina: 'modulo.html', dir: dir, baseDati: DATI, osserva: ['voci.length', 'voci.join()'],
      passi: ['scrivi #campo | pane', 'tasto Enter', 'seleziona #cat | pane', 'scrivi #campo | latte', 'clic #aggiungi', 'attendi 200', 'osserva dopo'] });
    const dopoAMano = (aMano.momenti || []).find(function (m) { return m.momento === 'dopo'; });
    check('la sonda di Adam accetta i passi testuali, con scrivi e seleziona', dopoAMano && dopoAMano.valori['voci.length'] === '2' &&
      /latte:pane/.test(dopoAMano.valori['voci.join()']), JSON.stringify(dopoAMano && dopoAMano.valori) + ' ' + (aMano.note || []).join(' | '));

    fs.writeFileSync(path.join(dir, 'trascinamento.html'), `<!doctype html>
      <style>
        body { margin: 20px; }
        #barra { position: relative; width: 320px; height: 44px; background: #ddd; }
        #bersaglio { position: absolute; left: 276px; top: 0; width: 32px; height: 44px; background: #9f9; }
        #maniglia { position: absolute; left: 0; top: 0; width: 24px; height: 44px; background: #36c; }
        #volume { width: 260px; }
      </style>
      <input id="volume" type="range" min="0" max="100" value="10">
      <div id="valore">10</div>
      <div id="barra"><div id="bersaglio"></div><div id="maniglia"></div></div>
      <script>
        const volume = document.getElementById('volume');
        volume.addEventListener('input', () => { document.getElementById('valore').textContent = volume.value; });
        const barra = document.getElementById('barra');
        const maniglia = document.getElementById('maniglia');
        let trascinando = false;
        maniglia.addEventListener('mousedown', () => { trascinando = true; });
        document.addEventListener('mouseup', () => { trascinando = false; });
        document.addEventListener('mousemove', (e) => {
          if (!trascinando) return;
          const r = barra.getBoundingClientRect();
          maniglia.style.left = Math.max(0, Math.min(r.width - maniglia.offsetWidth,
            e.clientX - r.left - maniglia.offsetWidth / 2)) + 'px';
        });
      </script>`);
    const trascinamenti = await eseguiCollaudi({ pagina: 'trascinamento.html', dir: dir, collaudi: [
      { nome: 'Lo slider risponde al trascinamento', passi: ['trascina #volume | 75%'],
        verifica: 'Number(document.getElementById("volume").value) >= 70 && Number(document.getElementById("volume").value) <= 80',
        misura: ['document.getElementById("volume").value'] },
      { nome: 'La maniglia si sposta al bersaglio', passi: ['trascina #maniglia | #bersaglio'],
        verifica: 'parseFloat(document.getElementById("maniglia").style.left) >= 250',
        misura: ['document.getElementById("maniglia").style.left'] }
    ] });
    const perTrascinamento = {};
    (trascinamenti.esiti || []).forEach(function (x) { perTrascinamento[x.nome] = x; });
    check('il trascinamento aggiorna un input range vero', perTrascinamento['Lo slider risponde al trascinamento'] &&
      perTrascinamento['Lo slider risponde al trascinamento'].esito === 'superato', JSON.stringify(perTrascinamento['Lo slider risponde al trascinamento']));
    check('il trascinamento sposta una maniglia tra elementi', perTrascinamento['La maniglia si sposta al bersaglio'] &&
      perTrascinamento['La maniglia si sposta al bersaglio'].esito === 'superato', JSON.stringify(perTrascinamento['La maniglia si sposta al bersaglio']));
    const trascinamentoManuale = await sondaPagina({ pagina: 'trascinamento.html', dir: dir, baseDati: DATI,
      passi: ['trascina #maniglia | #bersaglio', 'osserva dopo'] });
    check('la sonda manuale riporta il trascinamento eseguito', (trascinamentoManuale.note || []).some(function (n) { return /trascinato #maniglia -> #bersaglio/.test(n); }),
      (trascinamentoManuale.note || []).join(' | '));

    console.log('\n=== Stili applicati (editor visivo) ===');
    fs.writeFileSync(path.join(dir, 'studio-modifiche.css'), '#box { color: #16a34a; } #libero { font-size: 22px; }');
    const st1 = await verificaStili({ pagina: 'stili.html', dir: dir, regole: [
      { selettore: '#box', proprieta: { color: '#16a34a' } },
      { selettore: '#libero', proprieta: { 'font-size': '22px' } },
      { selettore: '#manca', proprieta: { color: 'red' } }
    ] });
    const per = function (esito, sel) { return (esito.risultati || []).find(function (x) { return x.selettore === sel; }) || {}; };
    check('la verifica termina', !st1.errore, st1.errore);
    check('si accorge che una regola piu\' specifica copre la modifica', (per(st1, '#box').diversi || []).length === 1 &&
      per(st1, '#box').diversi[0].reale === 'rgb(0, 0, 255)', JSON.stringify(per(st1, '#box')));
    check('una modifica che si vede risulta a posto', per(st1, '#libero').trovati === 1 && per(st1, '#libero').diversi.length === 0,
      JSON.stringify(per(st1, '#libero')));
    check('un selettore che non trova niente lo dice', per(st1, '#manca').trovati === 0);
    fs.writeFileSync(path.join(dir, 'studio-modifiche.css'), '#box:not(#studio-x) { color: #16a34a; }');
    const st2 = await verificaStili({ pagina: 'stili.html', dir: dir, regole: [{ selettore: '#box:not(#studio-x)', proprieta: { color: '#16a34a' } }] });
    check('con la specificita\' alzata la modifica vince', per(st2, '#box:not(#studio-x)').diversi &&
      per(st2, '#box:not(#studio-x)').diversi.length === 0, JSON.stringify(st2));
    fs.writeFileSync(path.join(dir, 'studio-modifiche.css'), '#grad { background-color: #16a34a; }');
    const st3 = await verificaStili({ pagina: 'stili.html', dir: dir, regole: [{ selettore: '#grad', proprieta: { 'background-color': '#16a34a' } }] });
    check('un colore di sfondo coperto da un gradiente risulta senza effetto visibile', !!per(st3, '#grad').coperto,
      JSON.stringify(per(st3, '#grad')));
    fs.writeFileSync(path.join(dir, 'studio-modifiche.css'), '#grad { background: #16a34a; }');
    const st4 = await verificaStili({ pagina: 'stili.html', dir: dir, regole: [{ selettore: '#grad', proprieta: { background: '#16a34a' } }] });
    check('lo sfondo intero invece si vede', !per(st4, '#grad').coperto && per(st4, '#grad').diversi.length === 0,
      JSON.stringify(per(st4, '#grad')));

    console.log('\n=== Collaudi in gabbia ===');
    const esecuzione = await eseguiCollaudi({ pagina: 'collaudabile.html', dir: dir, confermaSuperati: ['Il pulsante avvia', 'Vuoto'], collaudi: [
      { nome: 'Il pulsante avvia', passi: ['clic #start', 'attendi 300'], verifica: 'inGioco === true', misura: ['inGioco'] },
      { nome: 'Vuoto', passi: ['clic #start', 'attendi 200'], verifica: 'vita === 100', misura: [] },
      { nome: 'Toccare un nemico toglie vita', passi: ['clic #start', 'js nemici = [{x: nave.x, y: nave.y}]', 'attendi 500'], verifica: 'vita < 100', misura: ['vita', 'nemici.length'] },
      { nome: 'Variabile inventata', passi: [], verifica: 'punti > 0', misura: [] },
      { nome: 'Pulsante inesistente', passi: ['clic #via'], verifica: 'true', misura: [] },
      { nome: 'La rete e\' chiusa', passi: [
        "js fetch('http://127.0.0.1:3456/api/status').then(function () { window.__r = 'raggiunta'; }, function () { window.__r = 'bloccata'; })",
        "js try { new WebSocket('ws://127.0.0.1:3456'); window.__w = 'aperta'; } catch (e) { window.__w = 'bloccata'; }",
        'attendi 800'], verifica: "window.__r === 'bloccata' && window.__w === 'bloccata'", misura: ['window.__r', 'window.__w'] },
      { nome: 'Ciclo infinito', passi: ['js while (true) {}'], verifica: 'true', misura: [] },
      { nome: 'Dopo il ciclo infinito si continua', passi: ['clic #start'], verifica: 'inGioco', misura: [] }
    ] });
    const esiti = {};
    (esecuzione.esiti || []).forEach(function (e) { esiti[e.nome] = e; });
    const di = function (nome) { return JSON.stringify(esiti[nome] || null); };
    check('l\'esecuzione termina senza errori propri', !esecuzione.errore, esecuzione.errore);
    check('superato, confermato e non vuoto', esiti['Il pulsante avvia'] && esiti['Il pulsante avvia'].esito === 'superato', di('Il pulsante avvia'));
    check('prova a vuoto: vera anche senza i passi = vuoto', esiti['Vuoto'] && esiti['Vuoto'].esito === 'vuoto', di('Vuoto'));
    check('fallito, confermato due volte, con le misure',
      esiti['Toccare un nemico toglie vita'] && esiti['Toccare un nemico toglie vita'].esito === 'fallito' &&
      esiti['Toccare un nemico toglie vita'].misure.vita === '100', di('Toccare un nemico toglie vita'));
    check('variabile inesistente = non valido', esiti['Variabile inventata'] && esiti['Variabile inventata'].esito === 'non valido' &&
      /punti is not defined/.test(esiti['Variabile inventata'].motivo), di('Variabile inventata'));
    check('elemento inesistente = fallito per causa elemento', esiti['Pulsante inesistente'] &&
      esiti['Pulsante inesistente'].esito === 'fallito' && esiti['Pulsante inesistente'].causa === 'elemento', di('Pulsante inesistente'));
    check('niente richieste verso lo Studio ne\' WebSocket', esiti['La rete e\' chiusa'] && esiti['La rete e\' chiusa'].esito === 'superato' &&
      esiti['La rete e\' chiusa'].bloccate.length >= 1, di('La rete e\' chiusa'));
    check('un ciclo infinito scade e non blocca', esiti['Ciclo infinito'] && esiti['Ciclo infinito'].esito === 'non valido' &&
      /oltre \d+ s/.test(esiti['Ciclo infinito'].motivo), di('Ciclo infinito'));
    check('dopo un collaudo bloccato gli altri girano', esiti['Dopo il ciclo infinito si continua'] &&
      esiti['Dopo il ciclo infinito si continua'].esito === 'superato', di('Dopo il ciclo infinito si continua'));
  } catch (e) {
    check('la prova si esegue', false, e.stack);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log('\n' + '='.repeat(50));
  console.log('SONDA: ' + pass + ' passati, ' + fail + ' falliti');
  process.exit(fail ? 1 : 0);
})();
