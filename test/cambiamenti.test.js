// Prova il confronto "cosa e' cambiato sul disco": la copia di inizio turno contro i file di
// adesso. Il caso che ha fatto nascere lo strumento e' il primo: uno style.css di 425 righe
// coperto da un altro file da 242, che Adam ha poi spiegato all'utente come "file troncato".
const fs = require('fs');
const os = require('os');
const path = require('path');
const camb = require('../strumenti/cambiamenti');

let pass = 0;
let fail = 0;
function check(nome, condizione, dettaglio) {
  if (condizione) { pass++; console.log('  ok   ' + nome); }
  else { fail++; console.log('  FAIL ' + nome + (dettaglio !== undefined ? '  -> ' + dettaglio : '')); }
}

function righe(n, testo) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(testo + ' riga numero ' + i + ';');
  return out.join('\n');
}

const prima = fs.mkdtempSync(path.join(os.tmpdir(), 'camb-prima-'));
const dopo = fs.mkdtempSync(path.join(os.tmpdir(), 'camb-dopo-'));
const dati = fs.mkdtempSync(path.join(os.tmpdir(), 'camb-dati-'));
try {
  const scrivi = function (radice, rel, testo) {
    const f = path.join(radice, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, testo);
  };

  // Lo stesso caso del 17/9/2026: CSS rave sostituito dal CSS di uno zip.
  const rave = '@keyframes glitch { from { opacity: 1; } }\n@keyframes gridMove { to { top: 10px; } }\n' +
    ':root { --neon-green: #39ff14; --neon-magenta: #ff00ff; }\n' + righe(60, '.rave-blocco-a');
  const zip = '.container { width: 90%; }\n.navbar { color: #333; }\n' + righe(10, '.vecchio-stile');
  scrivi(prima, 'curriculum/style.css', rave);
  scrivi(dopo, 'curriculum/style.css', zip);
  // Un file solo ritoccato, uno nuovo, uno cancellato, uno identico, uno binario.
  scrivi(prima, 'curriculum/index.html', righe(40, '<p>testo</p><!--'));
  scrivi(dopo, 'curriculum/index.html', righe(40, '<p>testo</p><!--') + '\n<p>una riga in piu</p>');
  scrivi(prima, 'curriculum/app.js', 'function mostraFooter() { return 1; }\nfunction nascondi() { return 2; }');
  scrivi(dopo, 'curriculum/nuovo.js', 'console.log("nuovo");');
  scrivi(prima, 'curriculum/uguale.css', 'body { color: red; }');
  scrivi(dopo, 'curriculum/uguale.css', 'body { color: red; }');
  scrivi(prima, 'immagini/foto.png', 'PNGPNGPNG');
  scrivi(dopo, 'immagini/foto.png', 'PNGPNGPNG');
  scrivi(prima, 'node_modules/roba/index.js', 'enorme');
  scrivi(dopo, '.nascosto', 'x');

  console.log('\n=== Confronto ===');
  const r = camb.confronta(prima, dopo);
  const voce = function (rel) { return r.voci.find(function (v) { return v.rel === rel; }); };
  const css = voce('curriculum/style.css');
  check('vede il file sostituito', !!css && css.sostituito === true, JSON.stringify(css));
  check('conta le righe di prima e di adesso', !!css && css.righePrima === 63 && css.righeDopo === 12,
    css && css.righePrima + ' -> ' + css.righeDopo);
  check('dice quanto del vecchio file e\' sopravvissuto', !!css && css.sopravvivenza < 0.1, css && css.sopravvivenza);
  check('elenca cosa e\' sparito', !!css && css.persi.indexOf('@keyframes glitch') !== -1 &&
    css.persi.indexOf('--neon-green') !== -1, css && css.persi.join(', '));
  check('un file cancellato e\' un cambiamento', (voce('curriculum/app.js') || {}).tipo === 'sparito');
  check('un file nuovo e\' un cambiamento', (voce('curriculum/nuovo.js') || {}).tipo === 'nuovo');
  check('una riga in piu\' non e\' una sostituzione', !!voce('curriculum/index.html') &&
    voce('curriculum/index.html').sostituito === false && voce('curriculum/index.html').tipo === 'modificato');
  check('i file identici non compaiono', !voce('curriculum/uguale.css') && !voce('immagini/foto.png'));
  check('dipendenze e file nascosti restano fuori', !voce('node_modules/roba/index.js') && !voce('.nascosto'));
  check('conta le categorie', r.sostituiti === 1 && r.spariti === 1 && r.nuovi === 1, JSON.stringify({
    sostituiti: r.sostituiti, spariti: r.spariti, nuovi: r.nuovi, modificati: r.modificati
  }));
  check('le perdite vengono prima', r.voci[0].tipo === 'sparito' || r.voci[0].sostituito, r.voci[0].rel);

  console.log('\n=== Prudenza: cosa NON e\' una sostituzione ===');
  const p2 = fs.mkdtempSync(path.join(os.tmpdir(), 'camb-p2-'));
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'camb-d2-'));
  scrivi(p2, 'abbozzo.js', 'let a = 1;\nlet b = 2;');
  scrivi(d2, 'abbozzo.js', 'const gioco = {};\nfunction avvia() { return gioco; }\nconst altro = 3;');
  check('un file di poche righe riscritto non e\' "sostituito"', camb.confronta(p2, d2).voci[0].sostituito === false);
  scrivi(p2, 'grande.css', righe(100, '.blocco'));
  scrivi(d2, 'grande.css', righe(100, '.blocco') + '\n' + righe(20, '.aggiunta'));
  const cresciuto = camb.confronta(p2, d2).voci.find(function (v) { return v.rel === 'grande.css'; });
  check('un file che cresce non e\' ne\' sostituito ne\' accorciato',
    !!cresciuto && !cresciuto.sostituito && !cresciuto.accorciato);
  scrivi(d2, 'grande.css', righe(30, '.blocco'));
  const tagliato = camb.confronta(p2, d2).voci.find(function (v) { return v.rel === 'grande.css'; });
  check('un file dimezzato risulta accorciato', !!tagliato && tagliato.accorciato === true && tagliato.sostituito === false);
  fs.rmSync(p2, { recursive: true, force: true });
  fs.rmSync(d2, { recursive: true, force: true });

  console.log('\n=== Il testo per Adam ===');
  const testo = camb.testo(r);
  check('nomina il file sostituito con i numeri', /SOSTITUITO curriculum\/style\.css: 63 -> 12 righe/.test(testo), testo);
  check('smentisce il "file troncato"', /NON e' un file "troncato"/.test(testo), testo);
  check('indica come rimettere la versione di prima', /ripristina\.js --elenco/.test(testo));
  check('senza cambiamenti non dice niente', camb.testo({ voci: [] }) === '');
  check('le perdite si possono chiedere da sole', camb.perdite(r).length === 2, camb.perdite(r).length);

  console.log('\n=== Storico ===');
  camb.registra(dopo, r, { base: dati, chiave: 'turno-1' });
  check('scrive lo storico', fs.existsSync(camb.fileStorico(dopo, dati)));
  camb.registra(dopo, r, { base: dati, chiave: 'turno-1' });
  check('lo stesso turno non si conta due volte', camb.leggiStorico(dopo, dati).length === 1,
    camb.leggiStorico(dopo, dati).length);
  camb.registra(dopo, camb.confronta(prima, dopo), { base: dati, chiave: 'turno-2' });
  check('un turno nuovo si aggiunge', camb.leggiStorico(dopo, dati).length === 2);
  const storia = camb.testoStoria(dopo, { base: dati, file: 'style.css' });
  check('la storia di un file racconta cosa gli e\' successo', /SOSTITUITO curriculum\/style\.css/.test(storia), storia);
  check('anche riletta dal disco, la storia ha i numeri giusti (niente NaN)',
    /resta il \d+%/.test(storia) && storia.indexOf('NaN') === -1, storia);
  check('la storia di un file ignora gli altri', storia.indexOf('nuovo.js') === -1, storia);
  const recenti = camb.testoPerditeRecenti(dopo, { base: dati });
  check('le perdite recenti citano il file sostituito e quello cancellato',
    /style\.css/.test(recenti) && /app\.js/.test(recenti), recenti);
  check('le perdite recenti non citano i file solo modificati', recenti.indexOf('index.html') === -1, recenti);
  check('senza storico non si inventa niente', camb.testoPerditeRecenti(prima, { base: dati }) === '');

  console.log('\n=== Cartelle che non ci sono ===');
  check('istantanea mancante: nessun cambiamento', camb.confronta(path.join(prima, 'mai-esistita'), dopo).voci.length === 0);
  check('progetto mancante: nessun cambiamento', camb.confronta(prima, path.join(dopo, 'mai-esistito')).voci.length === 0);

  // Il confronto serve a poco se poi nessuno lo lancia: qui si controlla che lo Studio lo faccia
  // nei punti giusti. Se queste funzioni vengono spostate o rinominate, aggiorna anche queste prove.
  console.log('\n=== Agganci nello Studio (server.js) ===');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const funzione = (server.match(/function registraCambiamentiDelTurno\(\)[\s\S]*?\n}/) || [''])[0];
  check('il confronto si fa a ogni fine turno, subito dopo l\'archiviazione della chat',
    /archiviaChatOra\(\);[\s\S]{0,400}registraCambiamentiDelTurno\(\);/.test(server));
  check('confronta la copia di inizio turno con il progetto', /cambiamenti\.confronta\(foto\.dir, config\.cwd\)/.test(funzione));
  check('mette da parte la versione di prima', /ripristino\.mettiDalConfronto\(config\.cwd/.test(funzione));
  check('scrive lo storico con la chiave del turno', /cambiamenti\.registra\(config\.cwd, r, \{ chiave/.test(funzione));
  check('non riavvisa due volte per lo stesso turno', /avvisoCambiamentiFatto === chiave/.test(funzione));
  check('avvisa Adam solo dei file che non ha toccato con Edit o Write',
    /fileToccatoAMano\(v\.rel\)/.test(funzione) && /quadroInSospeso/.test(funzione));
  check('quando l\'utente segnala un bug, gli allega cosa e\' cambiato',
    /testoPerditeRecenti\(\) \? '\\n' \+ testoPerditeRecenti\(\)/.test(server));
  check('il prompt di Adam spiega dove guardare quando "prima funzionava"',
    /PRIMA FUNZIONAVA E ADESSO NO/.test(server) && /COMANDO_CAMBIAMENTI/.test(server) && /COMANDO_RIPRISTINA/.test(server));
} catch (e) {
  check('la prova si esegue', false, e.stack);
} finally {
  fs.rmSync(prima, { recursive: true, force: true });
  fs.rmSync(dopo, { recursive: true, force: true });
  fs.rmSync(dati, { recursive: true, force: true });
}

console.log('\n' + '='.repeat(50));
console.log('CAMBIAMENTI: ' + pass + ' passati, ' + fail + ' falliti');
process.exit(fail ? 1 : 0);
