// Prova il personaggio riggato collegato a Blender e il pannello 3D dello Studio.
// Richiesta dell'utente (18/9/2026): "usa il personaggio riggato che ho su Unity, poi connettilo a
// Blender con il rendering 3D, sulla destra, come pannello secondario accanto al file dal vivo".
// Cosa si prova:
//   - strumenti/personaggio.js: Blender converte il personaggio (GLB con riposo e camminata, 72 foto
//     per il gioco) e fa un'immagine di qualita' da un punto di vista dato;
//   - i modelli 3D di un progetto si trovano (e non si esce dal progetto);
//   - server.js ha le rotte del pannello, e la pagina del pannello trova three.js in locale;
//   - la colonna di destra ha le due schede e i bottoni in alto seguono la scheda mostrata.
// Blender si usa davvero se c'e'; se manca, quella parte si salta (il resto si prova lo stesso).
const fs = require('fs');
const os = require('os');
const path = require('path');
const personaggio = require('../strumenti/personaggio');

let pass = 0;
let fail = 0;
function check(nome, condizione, dettaglio) {
  if (condizione) { pass++; console.log('  ok   ' + nome); }
  else { fail++; console.log('  FAIL ' + nome + (dettaglio !== undefined ? '  -> ' + dettaglio : '')); }
}

const RADICE = path.join(__dirname, '..');
const ROBOTT = path.join(RADICE, 'scheletri', 'personaggio-cubo-python', 'personaggio-3d', 'robott.glb');

// Il JSON dentro un file GLB: 12 byte di intestazione, poi il primo pezzo (JSON).
function jsonDelGlb(file) {
  const dati = fs.readFileSync(file);
  if (dati.readUInt32LE(0) !== 0x46546C67) return null;          // "glTF"
  const lunghezza = dati.readUInt32LE(12);
  if (dati.readUInt32LE(16) !== 0x4E4F534A) return null;         // "JSON"
  return JSON.parse(dati.slice(20, 20 + lunghezza).toString('utf8'));
}

function leggi(rel) { return fs.readFileSync(path.join(RADICE, rel), 'utf8'); }

(async function () {
  const temporanea = fs.mkdtempSync(path.join(os.tmpdir(), 'prova-personaggio-3d-'));
  try {
    console.log('\n=== Robott, come viaggia con il gioco sul cubo ===');
    const robott = fs.existsSync(ROBOTT) ? jsonDelGlb(ROBOTT) : null;
    const animazioni = robott && (robott.animations || []).map(function (a) { return a.name; });
    check('e\' un GLB vero, con lo scheletro', !!robott && (robott.skins || []).length >= 1, robott ? 'skins: ' + (robott.skins || []).length : 'illeggibile');
    check('con i due movimenti: Riposo e Camminata', !!animazioni && animazioni.indexOf('Riposo') !== -1 && animazioni.indexOf('Camminata') !== -1,
      JSON.stringify(animazioni));
    check('la cartella del personaggio convertito e\' personaggio-3d (quella che cerca il gioco)', personaggio.CARTELLA_USCITA === 'personaggio-3d');

    console.log('\n=== I modelli 3D di un progetto ===');
    const progetto = path.join(temporanea, 'progetto');
    fs.mkdirSync(path.join(progetto, 'gioco', 'personaggio-3d'), { recursive: true });
    fs.mkdirSync(path.join(progetto, 'node_modules', 'pacchetto'), { recursive: true });
    fs.mkdirSync(path.join(progetto, '.nascosta'), { recursive: true });
    fs.writeFileSync(path.join(progetto, 'gioco', 'personaggio-3d', 'vecchio.glb'), 'x');
    fs.writeFileSync(path.join(progetto, 'nuovo.gltf'), '{}');
    fs.writeFileSync(path.join(progetto, 'node_modules', 'pacchetto', 'esempio.glb'), 'x');
    fs.writeFileSync(path.join(progetto, '.nascosta', 'segreto.glb'), 'x');
    fs.writeFileSync(path.join(progetto, 'immagine.png'), 'x');
    const passato = new Date(Date.now() - 60000);
    fs.utimesSync(path.join(progetto, 'gioco', 'personaggio-3d', 'vecchio.glb'), passato, passato);
    const trovati = personaggio.modelliDelProgetto(progetto).map(function (m) { return m.nome; });
    check('trova i .glb e i .gltf anche nelle sottocartelle, il piu\' nuovo per primo',
      JSON.stringify(trovati) === JSON.stringify(['nuovo.gltf', 'gioco/personaggio-3d/vecchio.glb']), JSON.stringify(trovati));

    console.log('\n=== Il server: le rotte del pannello 3D ===');
    const server = leggi('server.js');
    ['/api/vista3d/modelli', '/api/vista3d/file', '/api/vista3d/rendi', '/api/vista3d/prepara'].forEach(function (rotta) {
      check('c\'e\' la rotta ' + rotta, server.indexOf("'" + rotta + "'") !== -1);
    });
    check('i file si danno solo se sono DENTRO il progetto e sono modelli 3D',
      /app\.get\('\/api\/vista3d\/file'[\s\S]{0,200}\.\(glb\|gltf\)\$\/i\.test\(percorso\) \|\| !dentroAlProgetto\(percorso\)/.test(server));
    check('Blender lavora uno alla volta (si contende la scheda video con Adam)', (server.match(/blenderOccupato = true/g) || []).length === 2 &&
      (server.match(/blenderOccupato = false;/g) || []).length >= 2);
    check('la conversione finisce in personaggio-3d del progetto', /personaggio3d\.prepara\(modello, path\.join\(config\.cwd, personaggio3d\.CARTELLA_USCITA\)\)/.test(server));
    check('un modello 3D cambiato nel turno fa ricaricare il pannello', /\\\.\(glb\|gltf\)\$\/i\.test\(v\.rel\)[\s\S]{0,200}chatBroadcast\('files-changed'/.test(server));

    console.log('\n=== La pagina del pannello e la colonna di destra ===');
    const vista = leggi(path.join('public', 'vista-3d.html'));
    const mappa = JSON.parse((vista.match(/<script type="importmap">([\s\S]*?)<\/script>/) || [])[1] || '{}');
    const tre = mappa.imports && mappa.imports.three;
    check('three.js viene dallo Studio, non da internet', !!tre && tre.indexOf('/vendor-3d/') === 0 && fs.existsSync(path.join(RADICE, 'public', tre)), tre);
    const importati = (vista.match(/from '(\/vendor-3d\/[^']+)'/g) || []).map(function (r) { return r.slice(6, -1); });
    check('e i suoi pezzi (caricatore GLTF, controlli) ci sono tutti', importati.length >= 2 && importati.every(function (p) {
      return fs.existsSync(path.join(RADICE, 'public', p));
    }), JSON.stringify(importati));
    const caricatore = fs.readFileSync(path.join(RADICE, 'public', 'vendor-3d', 'addons', 'loaders', 'GLTFLoader.js'), 'utf8');
    const relativi = (caricatore.match(/from '(\.\.?\/[^']+)'/g) || []).map(function (r) { return r.slice(6, -1); });
    check('anche quello che il caricatore GLTF importa a sua volta', relativi.every(function (p) {
      return fs.existsSync(path.join(RADICE, 'public', 'vendor-3d', 'addons', 'loaders', p));
    }), JSON.stringify(relativi));
    check('senza modelli restano solo la casella per convertire e la ricarica', /body\.senza-modello #rendi/.test(vista) &&
      /classList\.toggle\('senza-modello', !modelli\.length\)/.test(vista));
    check('"Rendi con Blender" manda il punto di vista del pannello', /camera: camera\.position\.toArray\(\), bersaglio: controlli\.target\.toArray\(\)/.test(vista));

    const indice = leggi(path.join('public', 'index.html'));
    check('la colonna di destra ha le schede "File dal vivo" e "3D"', /id="scheda-btn-file"/.test(indice) && /id="scheda-btn-3d"/.test(indice) &&
      /id="scheda-file"/.test(indice) && /id="scheda-3d"/.test(indice));
    check('il visore si carica solo quando si apre la scheda (data-src, non src)', /<iframe id="vista3d-frame"[^>]*data-src="\/vista-3d\.html"/.test(indice) &&
      !/<iframe id="vista3d-frame"[^>]* src=/.test(indice));
    check('c\'e\' il bottone 3D in alto', /id="btn-view-3d"/.test(indice));
    const app = leggi(path.join('public', 'app.js'));
    check('i bottoni in alto seguono la scheda mostrata', /btn\.classList\.toggle\('pannello-aperto', aperto && scheda === 'file'\)/.test(app) &&
      /bottone3d\.classList\.toggle\('pannello-aperto', aperto && scheda === '3d'\)/.test(app));
    check('"File dal vivo" col pannello sul 3D passa al file invece di chiudere', /btn\.addEventListener\('click', \(\) => bottoneScheda\('file'\)\)/.test(app) &&
      /schedaMostrata\(\) === nome\) \{ chiudiPannello\(\); return; \}/.test(app));
    const lettura = app.indexOf("eraAperto = localStorage.getItem('fileLiveAperto') === '1'");
    const primaScheda = app.indexOf('mostraScheda(schedaSalvata);');
    check('all\'avvio si legge se il pannello era aperto PRIMA di mostrare la scheda', lettura !== -1 && primaScheda !== -1 && lettura < primaScheda);
    check('quando un modello 3D cambia, il visore viene avvisato', /window\.avvisaVista3d\(file\)/.test(app) && /tipo: 'ricarica'/.test(app));

    console.log('\n=== Blender, davvero ===');
    const blender = personaggio.trovaBlender();
    if (!blender) {
      console.log('  (Blender non installato: salto la conversione e il rendering)');
    } else {
      const uscita = path.join(temporanea, 'personaggio-3d');
      const p = await personaggio.prepara(ROBOTT, uscita);
      check('converte il personaggio', p.ok === true, JSON.stringify(p.errore || p.coda));
      if (p.ok) {
        const glb = jsonDelGlb(p.glb);
        const nomi = glb && (glb.animations || []).map(function (a) { return a.name; });
        check('il GLB per il pannello ha riposo e camminata', !!nomi && nomi.indexOf('Riposo') !== -1 && nomi.indexOf('Camminata') !== -1, JSON.stringify(nomi));
        check('e le 72 foto per il gioco', p.sprite === 72 && fs.readdirSync(path.join(uscita, 'sprite')).filter(function (f) { return /\.png$/.test(f); }).length === 72,
          String(p.sprite));
        const scheda = JSON.parse(fs.readFileSync(path.join(uscita, 'sprite', 'sprite.json'), 'utf8'));
        check('con misura dei pixel e posizione dei piedi (il gioco li usa per metterlo a terra)',
          scheda.metri_per_pixel > 0 && scheda.piedi_px > scheda.altezza * 0.8 && scheda.piedi_px < scheda.altezza, JSON.stringify(scheda));
        const r = await personaggio.rendi(p.glb, {
          camera: [0, 1.4, 3.2], bersaglio: [0, 0.9, 0], fov: 40, animazione: 'Camminata', tempo: 0.25, larghezza: 240, altezza: 180,
          uscita: path.join(temporanea, 'rendering.png')
        });
        check('fa l\'immagine di qualita\' dal punto di vista dato', r.ok === true && fs.existsSync(r.png) && fs.statSync(r.png).size > 2000,
          JSON.stringify(r.errore || r.coda));
        if (r.ok) check('in pochi secondi (' + r.secondi + ' s dentro Blender)', r.secondi < 60, String(r.secondi));
      }
      const sbagliato = await personaggio.prepara(path.join(temporanea, 'non-esiste.fbx'), uscita);
      check('un file che non c\'e\' si dice subito, senza lanciare Blender', sbagliato.ok === false && /non trovato/.test(sbagliato.errore), JSON.stringify(sbagliato));
    }
  } catch (e) {
    check('la prova si esegue', false, e.stack);
  } finally {
    fs.rmSync(temporanea, { recursive: true, force: true });
  }
  console.log('\n' + '='.repeat(50));
  console.log('PERSONAGGIO 3D E BLENDER: ' + pass + ' passati, ' + fail + ' falliti');
  process.exit(fail ? 1 : 0);
})();
