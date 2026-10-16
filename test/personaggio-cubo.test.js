// Prova lo scheletro "personaggio-cubo-python": un personaggio su un cubo con fisica vera, in Python.
// Richiesta dell'utente (18/9/2026). La fisica si prova da sola (fisica.py non usa pygame), con le
// situazioni che contano davvero: atterrare, saltare, frenare, cadere dal bordo e ripartire,
// sbattere contro un muro, salire su un gradino. Poi il gioco vero si lancia senza finestre con lo
// stesso strumento che lo Studio usa per i giochi di Adam, e si guarda che disegni qualcosa.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const scheletri = require('../strumenti/scheletri');

let pass = 0;
let fail = 0;
function check(nome, condizione, dettaglio) {
  if (condizione) { pass++; console.log('  ok   ' + nome); }
  else { fail++; console.log('  FAIL ' + nome + (dettaglio !== undefined ? '  -> ' + dettaglio : '')); }
}

const CARTELLA = path.join(__dirname, '..', 'scheletri', 'personaggio-cubo-python');

// Le sei situazioni, in un solo processo Python.
const PROVE_FISICA = [
  'import json, math, sys',
  'sys.path.insert(0, sys.argv[1])',
  'import fisica, mondo',
  'from personaggio import Personaggio',
  'r = {}',
  'P = 120',
  'def secondi(p, s, avanti=0, destra=0, angolo=0.0):',
  '    for _ in range(int(s * P)):',
  '        p.aggiorna(avanti, destra, False, angolo)',
  'p = Personaggio(); secondi(p, 2)',
  "r['atterra'] = [p.corpo.piedi(), p.corpo.a_terra, p.corpo.vel[1]]",
  'base = p.corpo.piedi(); alto = base',
  'p.aggiorna(0, 0, True, 0.0)',
  'for _ in range(P):',
  '    p.aggiorna(0, 0, False, 0.0); alto = max(alto, p.corpo.piedi())',
  "r['salto'] = [alto - base, p.corpo.a_terra]",
  'p = Personaggio(); p.corpo.pos = [0.0, 0.8001, -3.0]; secondi(p, 0.1); secondi(p, 0.8, avanti=1)',
  'vmax = p.corpo.velocita_orizzontale(); secondi(p, 0.5)',
  "r['corsa'] = [vmax, p.corpo.velocita_orizzontale(), p.corpo.a_terra]",
  'p = Personaggio(); p.corpo.pos = [0.0, 0.8001, 3.0]; minimo = 99.0',
  'for _ in range(4 * P):',
  '    p.aggiorna(1, 0, False, 0.0); minimo = min(minimo, p.corpo.pos[1])',
  "r['caduta'] = [minimo, p.cadute]",
  'p = Personaggio(); p.corpo.pos = [0.0, 0.8001, -2.2]; secondi(p, 1.5, avanti=1, angolo=-math.pi / 2)',
  "r['muro'] = [p.corpo.pos[0], p.corpo.piedi()]",
  'p = Personaggio(); p.corpo.pos = [0.9, 0.8001, -2.2]; secondi(p, 0.1)',
  'p.aggiorna(0, 0, True, math.pi / 2)',
  'for _ in range(int(1.5 * P)):',
  '    spingi = 1 if (p.corpo.piedi() > 0.85 and p.corpo.pos[0] < 1.7) else 0',
  '    p.aggiorna(spingi, 0, False, math.pi / 2)',
  "r['gradino'] = [p.corpo.pos[0], p.corpo.piedi(), p.corpo.a_terra]",
  'print(json.dumps(r))'
].join('\n');

// La figura (le foto di Robott fatte da Blender): quale foto sceglie, e dove finisce sullo schermo.
// "Dove" si misura per differenza: la stessa scena fotografata con e senza la figura.
const PROVE_FIGURA = [
  'import json, math, os, sys',
  "os.environ['SDL_VIDEODRIVER'] = 'dummy'",
  "os.environ['PYGAME_HIDE_SUPPORT_PROMPT'] = '1'",
  'sys.path.insert(0, sys.argv[1])',
  'import pygame',
  'import disegno, figura, mondo',
  'from personaggio import Personaggio',
  'r = {}',
  "r['direzioni'] = [figura.direzione(0.0, 0.0), figura.direzione(math.pi / 2, 0.0), figura.direzione(math.pi, 0.0),",
  '                  figura.direzione(-math.pi / 2, 0.0), figura.direzione(1.0, 1.0), figura.direzione(0.3, 0.0),',
  '                  figura.direzione(math.pi / 2 + 2.0, 2.0)]',
  "r['pose'] = [figura.posa(0.0, 0.0, True), figura.posa(0.0, 6.0, True), figura.posa(0.8, 6.0, True),",
  '             figura.posa(1.6, 6.0, True), figura.posa(0.5, 6.0, False), figura.posa(0.5, 0.2, True)]',
  'pygame.init()',
  'schermo = pygame.display.set_mode((960, 600))',
  'fig = figura.del_gioco(disegno.CARTELLA)',
  "r['figura'] = [fig.nome, len(fig.foto)] if fig else None",
  'def foto(pos, angolo, senza):',
  '    eroe = Personaggio(); eroe.corpo.pos = list(pos); eroe.corpo.a_terra = True',
  '    camera = disegno.Camera(); camera.angolo = angolo',
  '    for _ in range(300): camera.segui(eroe.corpo.pos, 1 / 60.0)',
  '    vero = figura.posto',
  '    if senza: figura.posto = lambda *a: None',
  '    try: disegno.scena(schermo, camera, mondo, eroe)',
  '    finally: figura.posto = vero',
  '    piedi = disegno._Vista(camera, 960, 600).proietta((pos[0], eroe.corpo.piedi(), pos[2]))[0]',
  '    return schermo.copy(), piedi',
  'def dove(pos, angolo):',
  '    con, piedi = foto(pos, angolo, False)',
  '    senza, _ = foto(pos, angolo, True)',
  '    righe = []',
  '    for y in range(max(0, int(piedi[1]) - 220), min(600, int(piedi[1]) + 30)):',
  '        for x in range(max(0, int(piedi[0]) - 60), min(960, int(piedi[0]) + 60)):',
  '            if con.get_at((x, y)) != senza.get_at((x, y)): righe.append(y)',
  "    return {'pixel': len(righe), 'giu': max(righe) if righe else None, 'su': min(righe) if righe else None, 'piedi': piedi[1]}",
  "r['aperto'] = dove((0.0, 0.8, 0.0), 0.0)",
  "r['dietro'] = dove((-2.2, 0.8, -3.5), math.pi)",
  "r['davanti'] = dove((2.2, 0.8, -3.6), 0.0)",
  // la regola, provata direttamente: chi va disegnato prima della foto e chi dopo
  'foto_qui = pygame.Rect(100, 100, 50, 100)',
  'sotto = [(90, 180), (160, 180), (160, 220), (90, 220)]',
  "facce = [(10.0, sotto, 'pavimento sotto i piedi', None, True), (10.0, sotto, 'muro davanti', None, False),",
  "         (14.0, [(0, 0), (10, 0), (10, 10)], 'lontano', None, False),",
  "         (10.0, [(300, 300), (310, 300), (310, 310)], 'pavimento lontano dalla foto', None, True)]",
  'dietro, davanti = figura.dietro_e_davanti(facce, (12.0, None, foto_qui))',
  "r['divisione'] = [[f[2] for f in dietro], [f[2] for f in davanti]]",
  'print(json.dumps(r))'
].join('\n');

// Una scena qualsiasi da una cartella di gioco: quale figura usa, e se disegna qualcosa.
const SCENA_SEMPLICE = [
  'import json, os, sys',
  "os.environ['SDL_VIDEODRIVER'] = 'dummy'",
  "os.environ['PYGAME_HIDE_SUPPORT_PROMPT'] = '1'",
  'sys.path.insert(0, sys.argv[1])',
  'import pygame',
  'import disegno, figura, mondo',
  'from personaggio import Personaggio',
  'pygame.init()',
  'schermo = pygame.display.set_mode((960, 600))',
  'eroe = Personaggio(); eroe.corpo.pos = [0.0, 0.8, 0.0]; eroe.corpo.a_terra = True',
  'disegno.scena(schermo, disegno.Camera(), mondo, eroe)',
  'fig = figura.del_gioco(disegno.CARTELLA)',
  'colori = set(tuple(schermo.get_at((x, y))) for x in range(0, 960, 16) for y in range(0, 600, 16))',
  "print(json.dumps({'figura': fig.nome if fig else None, 'colori': len(colori)}))"
].join('\n');

function python3(python, codice, argomenti) {
  const script = path.join(os.tmpdir(), 'prova-cubo-' + process.pid + '-' + Date.now() + '.py');
  fs.writeFileSync(script, codice);
  try {
    return JSON.parse(execFileSync(python, [script].concat(argomenti), {
      encoding: 'utf8', env: Object.assign({}, process.env, { PYTHONDONTWRITEBYTECODE: '1' })
    }));
  } finally {
    fs.rmSync(script, { force: true });
  }
}

(async function () {
  try {
    console.log('\n=== I file ci sono, ognuno con il suo compito ===');
    ['main.py', 'fisica.py', 'mondo.py', 'personaggio.py', 'disegno.py', 'figura.py', 'avvia.bat', 'LEGGIMI.md', 'scheletro.json'].forEach(function (f) {
      check('c\'e\' ' + f, fs.existsSync(path.join(CARTELLA, f)));
    });
    // Robott, convertito da Blender (strumenti/personaggio.js): il modello per il pannello 3D e le foto per il gioco
    const cartellaFoto = path.join(CARTELLA, 'personaggio-3d', 'sprite');
    let schedaFoto = null;
    try { schedaFoto = JSON.parse(fs.readFileSync(path.join(cartellaFoto, 'sprite.json'), 'utf8')); } catch (e) {}
    check('le foto di Robott ci sono: 8 direzioni, 8 passi, con misura e piedi', !!schedaFoto && schedaFoto.direzioni === 8 &&
      schedaFoto.fotogrammi_camminata === 8 && schedaFoto.metri_per_pixel > 0 && schedaFoto.piedi_px > 0, JSON.stringify(schedaFoto));
    const fotoMancanti = [];
    for (let d = 0; d < 8; d++) {
      if (!fs.existsSync(path.join(cartellaFoto, 'riposo_d' + d + '.png'))) fotoMancanti.push('riposo_d' + d);
      for (let f = 0; f < 8; f++) if (!fs.existsSync(path.join(cartellaFoto, 'cammina_d' + d + '_f' + f + '.png'))) fotoMancanti.push('cammina_d' + d + '_f' + f);
    }
    check('tutte e 72 le foto', fotoMancanti.length === 0, fotoMancanti.join(', '));
    check('e il modello 3D per il pannello', fs.existsSync(path.join(CARTELLA, 'personaggio-3d', 'robott.glb')));
    const main = fs.readFileSync(path.join(CARTELLA, 'main.py'), 'utf8');
    check('la riga che mostra lo schermo c\'e\'', /pygame\.display\.flip\(\)/.test(main));
    check('la fisica va a passi fissi', /while accumulato >= fisica\.PASSO/.test(main));
    const fisicaPy = fs.readFileSync(path.join(CARTELLA, 'fisica.py'), 'utf8');
    check('fisica.py non usa pygame: si prova da sola', !/import pygame/.test(fisicaPy));
    const righeMax = ['main.py', 'fisica.py', 'mondo.py', 'personaggio.py', 'disegno.py', 'figura.py'].map(function (f) {
      return fs.readFileSync(path.join(CARTELLA, f), 'utf8').split('\n').length;
    });
    check('ogni file resta corto (sotto le 300 righe): si legge tutto in una volta', Math.max.apply(null, righeMax) < 300, righeMax.join(', '));

    const python = require('../strumenti/cervello-python').trovaPython();
    if (!python) {
      console.log('  (Python non installato: salto la fisica e la prova del gioco)');
    } else {
      console.log('\n=== La fisica, nelle situazioni che contano ===');
      const script = path.join(os.tmpdir(), 'prova-fisica-cubo-' + process.pid + '.py');
      fs.writeFileSync(script, PROVE_FISICA);
      let r = {};
      try {
        r = JSON.parse(execFileSync(python, [script, CARTELLA], {
          encoding: 'utf8', env: Object.assign({}, process.env, { PYTHONDONTWRITEBYTECODE: '1' })
        }));
      } finally {
        fs.rmSync(script, { force: true });
      }
      check('cade dall\'alto e si ferma sopra il cubo', Math.abs(r.atterra[0]) < 0.01 && r.atterra[1] === true && r.atterra[2] === 0,
        JSON.stringify(r.atterra));
      check('il salto arriva a circa 1,6 m e torna a terra', r.salto[0] > 1.5 && r.salto[0] < 1.7 && r.salto[1] === true, JSON.stringify(r.salto));
      check('correndo arriva a 6 m/s e non oltre', Math.abs(r.corsa[0] - 6) < 1e-6, JSON.stringify(r.corsa));
      check('lasciati i tasti si ferma, senza scivolare via', r.corsa[1] === 0 && r.corsa[2] === true, JSON.stringify(r.corsa));
      check('uscendo dal bordo cade davvero e riparte', r.caduta[0] < -10 && r.caduta[1] >= 1, JSON.stringify(r.caduta));
      check('contro il gradino alto 1,5 m si ferma: non ci passa attraverso', Math.abs(r.muro[0] - (-1.1)) < 0.01 && Math.abs(r.muro[1]) < 0.01,
        JSON.stringify(r.muro));
      check('saltando sale sul gradino da 0,8 m e ci resta sopra', Math.abs(r.gradino[1] - 0.8) < 0.01 && r.gradino[2] === true &&
        r.gradino[0] > 1.1 && r.gradino[0] < 3.3, JSON.stringify(r.gradino));

      console.log('\n=== Robott: la foto giusta, al posto giusto ===');
      const fg = python3(python, PROVE_FIGURA, [CARTELLA]);
      check('la direzione dipende da dove guarda rispetto alla camera (0 spalle, 2 destra, 4 fronte, 6 sinistra)',
        JSON.stringify(fg.direzioni) === JSON.stringify([0, 2, 4, 6, 0, 0, 2]), JSON.stringify(fg.direzioni));
      check('la posa segue la strada fatta; fermo = riposo, in aria = gambe aperte',
        JSON.stringify(fg.pose) === JSON.stringify([null, 0, 4, 0, 2, null]), JSON.stringify(fg.pose));
      check('il gioco carica Robott (72 foto)', !!fg.figura && fg.figura[0] === 'robott' && fg.figura[1] === 72, JSON.stringify(fg.figura));
      check('in campo aperto si vede intero, con i piedi a terra', fg.aperto.pixel > 300 && Math.abs(fg.aperto.giu - fg.aperto.piedi) <= 4,
        JSON.stringify(fg.aperto));
      check('dietro il gradino alto 1,5 m si vede solo la parte di sopra', fg.dietro.pixel > 20 && fg.dietro.giu < fg.dietro.piedi - 15,
        JSON.stringify(fg.dietro));
      check('davanti al gradino si vede intero: il gradino non gli passa sopra', fg.davanti.pixel > 300 &&
        Math.abs(fg.davanti.giu - fg.davanti.piedi) <= 4, JSON.stringify(fg.davanti));
      check('il pavimento sotto i piedi va prima della foto anche se e\' piu\' vicino; un muro piu\' vicino dopo',
        JSON.stringify(fg.divisione) === JSON.stringify([['lontano', 'pavimento sotto i piedi'], ['muro davanti', 'pavimento lontano dalla foto']]),
        JSON.stringify(fg.divisione));

      console.log('\n=== Senza foto torna alle scatole; un personaggio convertito nel progetto vince ===');
      const progetto = fs.mkdtempSync(path.join(os.tmpdir(), 'prova-figura-'));
      try {
        const soloCodice = path.join(progetto, 'senza-foto');
        fs.mkdirSync(soloCodice);
        ['main.py', 'fisica.py', 'mondo.py', 'personaggio.py', 'disegno.py', 'figura.py'].forEach(function (f) {
          fs.copyFileSync(path.join(CARTELLA, f), path.join(soloCodice, f));
        });
        const senzaFoto = python3(python, SCENA_SEMPLICE, [soloCodice]);
        check('senza foto: nessun errore, il personaggio torna di scatole', senzaFoto.figura === null && senzaFoto.colori > 3, JSON.stringify(senzaFoto));
        const gioco = path.join(progetto, 'gioco');
        const copiatoNelProgetto = scheletri.copia('personaggio-cubo-python', gioco);
        fs.cpSync(path.join(CARTELLA, 'personaggio-3d', 'sprite'), path.join(progetto, 'personaggio-3d', 'sprite'), { recursive: true });
        const schedaAltro = path.join(progetto, 'personaggio-3d', 'sprite', 'sprite.json');
        const datiAltro = JSON.parse(fs.readFileSync(schedaAltro, 'utf8'));
        datiAltro.nome = 'altro';
        fs.writeFileSync(schedaAltro, JSON.stringify(datiAltro));
        const conAltro = python3(python, SCENA_SEMPLICE, [gioco]);
        check('il personaggio convertito nel progetto (../personaggio-3d) prende il posto di Robott',
          copiatoNelProgetto.ok && conAltro.figura === 'altro' && conAltro.colori > 3, JSON.stringify(conAltro));
      } finally {
        fs.rmSync(progetto, { recursive: true, force: true });
      }

      console.log('\n=== Il gioco vero, lanciato come fa lo Studio con i giochi di Adam ===');
      const prova = require('../strumenti/prova-python');
      const esito = await prova.provaPython(CARTELLA, { secondi: 5 });
      const problemi = prova.problemiDellaProva(esito);
      const f = esito.finestra || {};
      check('parte e resta aperto senza errori', esito.provato && esito.restaAperto && !esito.errore,
        JSON.stringify(esito.errore || esito.motivo || esito.uscita && esito.uscita.slice(-300)));
      check('apre la finestra 960x600', Array.isArray(f.finestra) && f.finestra[0] === 960 && f.finestra[1] === 600, JSON.stringify(f.finestra));
      check('aggiorna lo schermo di continuo', (f.aggiornamenti || 0) > 60, String(f.aggiornamenti));
      check('lo Studio non trova problemi', problemi.problemi.length === 0, JSON.stringify(problemi.problemi.map(function (p) { return p.messaggio; })));
      const schermata = (f.schermate || []).filter(function (s) { return s.quota !== undefined; }).pop();
      check('disegna davvero qualcosa (lo schermo non e\' di un colore solo)', !!schermata && schermata.quota < 0.9,
        schermata ? schermata.colore + ' su ' + Math.round(schermata.quota * 100) + '%' : 'nessuna schermata');
      // chi lo prova crea __pycache__: nello scheletro non deve restare
      fs.rmSync(path.join(CARTELLA, '__pycache__'), { recursive: true, force: true });
    }

    console.log('\n=== Lo Studio lo conosce e lo copia pulito ===');
    const scheda = scheletri.elenco().find(function (s) { return s.nome === 'personaggio-cubo-python'; });
    check('compare fra gli scheletri, con il suo titolo', !!scheda && /cubo/.test(scheda.titolo), JSON.stringify(scheda && scheda.titolo));
    check('e nelle istruzioni di Adam', /personaggio-cubo-python/.test(scheletri.testoPerPrompt()));
    fs.mkdirSync(path.join(CARTELLA, '__pycache__'), { recursive: true });
    fs.writeFileSync(path.join(CARTELLA, '__pycache__', 'finto.cpython-311.pyc'), 'x');
    const destinazione = fs.mkdtempSync(path.join(os.tmpdir(), 'prova-cubo-'));
    const copiato = scheletri.copia('personaggio-cubo-python', destinazione);
    check('si copia in un progetto nuovo', copiato.ok && fs.existsSync(path.join(destinazione, 'fisica.py')), JSON.stringify(copiato.errore));
    check('con Robott: le foto e il modello 3D viaggiano con il gioco', fs.existsSync(path.join(destinazione, 'personaggio-3d', 'sprite', 'sprite.json')) &&
      fs.existsSync(path.join(destinazione, 'personaggio-3d', 'robott.glb')));
    check('senza __pycache__ ne\' la scheda interna', !fs.existsSync(path.join(destinazione, '__pycache__')) &&
      !fs.existsSync(path.join(destinazione, 'scheletro.json')));
    fs.rmSync(path.join(CARTELLA, '__pycache__'), { recursive: true, force: true });
    fs.rmSync(destinazione, { recursive: true, force: true });
  } catch (e) {
    check('la prova si esegue', false, e.stack);
  }
  console.log('\n' + '='.repeat(50));
  console.log('PERSONAGGIO SUL CUBO: ' + pass + ' passati, ' + fail + ' falliti');
  process.exit(fail ? 1 : 0);
})();
