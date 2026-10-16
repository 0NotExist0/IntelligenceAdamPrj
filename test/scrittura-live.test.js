// Prova il file che si scrive sotto gli occhi. Richiesta dell'utente (17/9/2026): "devo vedere il
// live del file mentre lo sta lavorando". Il contenuto arriva dallo streaming di Claude Code come
// JSON A META' ({"file_path":"...","content":"body {\n  col), quindi non si puo' fare JSON.parse
// finche' non e' completo: qui si controlla che il testo si ricomponga pezzo per pezzo e che alla
// fine sia identico a quello che Adam ha scritto davvero.
const fs = require('fs');
const path = require('path');
const live = require('../strumenti/scrittura-live');

let pass = 0;
let fail = 0;
function check(nome, condizione, dettaglio) {
  if (condizione) { pass++; console.log('  ok   ' + nome); }
  else { fail++; console.log('  FAIL ' + nome + (dettaglio !== undefined ? '  -> ' + dettaglio : '')); }
}

// Manda un JSON a pezzi come fa il modello, e restituisce gli stati visti.
function aPezzi(strumento, oggetto, quanto) {
  const grezzo = JSON.stringify(oggetto);
  const stato = live.nuovaScrittura(strumento);
  const viste = [];
  for (let i = 0; i < grezzo.length; i += (quanto || 5)) {
    if (live.aggiungi(stato, grezzo.slice(i, i + (quanto || 5)))) viste.push(live.istantanea(stato));
  }
  live.chiudi(stato);
  return { stato: stato, fine: live.istantanea(stato), viste: viste };
}

try {
  console.log('\n=== Write: il file cresce riga per riga ===');
  const contenuto = 'body {\n  background: #0a0a0a;\n  color: #39ff14;\n}\n.titolo { text-shadow: 0 0 12px "verde"; }\n';
  const w = aPezzi('Write', { file_path: 'C:\\prova\\stile.css', content: contenuto }, 5);
  check('ricostruisce il testo identico', w.fine.testo === contenuto, JSON.stringify(w.fine.testo.slice(0, 40)));
  check('trova il percorso del file', w.fine.file === 'C:\\prova\\stile.css', w.fine.file);
  check('conta righe e caratteri', w.fine.righe === contenuto.split('\n').length && w.fine.caratteri === contenuto.length,
    w.fine.righe + '/' + w.fine.caratteri);
  check('si vede crescere durante la scrittura', w.viste.length > 5, String(w.viste.length));
  const crescita = w.viste.map(function (v) { return v.caratteri; });
  check('e cresce sempre, non salta avanti e indietro',
    crescita.every(function (n, i) { return i === 0 || n >= crescita[i - 1]; }), crescita.join(','));
  check('a fine blocco e\' segnata come finita', w.fine.completa === true);

  console.log('\n=== Gli a capo e le virgolette non si rompono ===');
  const strano = 'riga1\n\ttabulata "con virgolette" e \\ barra\nriga3 con àccenti è\n';
  const s = aPezzi('Write', { file_path: 'x.txt', content: strano }, 3);
  check('testo con escape ricostruito esatto', s.fine.testo === strano, JSON.stringify(s.fine.testo));
  const unicode = aPezzi('Write', { file_path: 'x.txt', content: 'cuore \u2764 fine' }, 2);
  check('anche gli \\u sono gestiti', unicode.fine.testo === 'cuore \u2764 fine', unicode.fine.testo);

  console.log('\n=== Edit: si mostra quello che sostituisce ===');
  const e = aPezzi('Edit', {
    file_path: 'C:/prova/app.js',
    old_string: 'const vita = 100;',
    new_string: 'const vita = 250;\nconst scudo = 50;'
  }, 4);
  check('mostra il testo nuovo', e.fine.testo === 'const vita = 250;\nconst scudo = 50;', e.fine.testo);
  check('tiene anche quello vecchio', e.fine.vecchio === 'const vita = 100;', e.fine.vecchio);
  check('il campo giusto per Edit e\' new_string', e.fine.campo === 'new_string');

  console.log('\n=== Strumenti che non scrivono file ===');
  check('Bash non apre nessuna scrittura', live.CAMPO.Bash === undefined);
  check('Read nemmeno', live.CAMPO.Read === undefined);

  console.log('\n=== Robustezza ===');
  const mezzo = live.nuovaScrittura('Write');
  live.aggiungi(mezzo, '{"file_path":"a.css","content":"body {\\');   // troncato su un escape
  const parziale = live.istantanea(mezzo);
  check('un escape a meta\' non rompe niente', parziale.testo === 'body {', JSON.stringify(parziale.testo));
  live.aggiungi(mezzo, 'n  color: red;}"}');
  live.chiudi(mezzo);
  check('e quando arriva il resto si ricompone', live.istantanea(mezzo).testo === 'body {\n  color: red;}',
    JSON.stringify(live.istantanea(mezzo).testo));
  const vuoto = live.nuovaScrittura('Write');
  check('senza dati non inventa niente', live.istantanea(vuoto).testo === '' && live.istantanea(vuoto).file === '');
  check('aggiungi su stato nullo non esplode', live.aggiungi(null, 'x') === false);

  const lungo = 'x'.repeat(200000);
  const grosso = live.nuovaScrittura('Write');
  live.aggiungi(grosso, JSON.stringify({ file_path: 'g.txt', content: lungo }));
  const ist = live.istantanea(grosso, { massimo: 1000 });
  check('un file enorme si manda accorciato dalla coda', ist.testo.length === 1000 && ist.tagliato === true &&
    ist.caratteri === 200000, ist.testo.length + '/' + ist.caratteri);

  console.log('\n=== Agganci nello Studio ===');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  check('la scrittura comincia quando parte lo strumento', /iniziaScritturaLive\(evt\.index \|\| 0, cb\.name\)/.test(server));
  check('i pezzi arrivano dai delta dello streaming', /if \(delta\.partial_json\) pezzoScritturaLive/.test(server));
  check('e si chiude a fine blocco', /fineScritturaLive\(evt\.index \|\| 0\)/.test(server));
  check('il pannello riceve l\'evento file-live', /chatBroadcast\('file-live'/.test(server));
  check('e sa quando il file e\' davvero su disco', /chatBroadcast\('file-salvato'/.test(server));
  check('gli invii hanno un freno, non uno per ogni pezzo', /ultimoInvioLive/.test(server) && /200\)/.test(server));

  const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'file-live.js'), 'utf8');
  check('il pannello colora le righe nuove', /fl-nuova/.test(ui));
  check('e rilegge il file dal disco quando e\' salvato', /api\/file-content/.test(ui));
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  check('il pannello esiste nell\'interfaccia', /id="view-file"/.test(html) && /id="btn-view-file"/.test(html));
  // L'utente lo vuole ACCANTO alla chat, non al posto di essa: sta nella workspace, dopo la
  // colonna delle viste, ed e' apribile e ridimensionabile.
  const dentro = html.slice(html.indexOf('<section class="workspace">'), html.indexOf('</section>', html.indexOf('<section class="workspace">')));
  check('sta a destra, nella stessa schermata della chat',
    dentro.indexOf('workspace-viste') !== -1 && dentro.indexOf('workspace-viste') < dentro.indexOf('id="view-file"'));
  check('si puo\' chiudere e allargare', /id="btn-file-live-chiudi"/.test(dentro) && /id="file-live-maniglia"/.test(dentro));
  const appjs = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  check('il bottone apre e chiude il pannello invece di cambiare vista',
    /function initPannelloFile/.test(appjs) && /classList\.contains\('chiuso'\)/.test(appjs));
  check('la larghezza scelta resta salvata', /fileLiveLarghezza/.test(appjs));
  check('e lo script e\' incluso', /file-live\.js/.test(html));
} catch (e) {
  check('la prova si esegue', false, e.stack);
}

console.log('\n' + '='.repeat(50));
console.log('SCRITTURA DAL VIVO: ' + pass + ' passati, ' + fail + ' falliti');
process.exit(fail ? 1 : 0);
