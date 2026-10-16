// Prova il guardiano delle letture: quello che impedisce ad Adam di bruciarsi la memoria
// aprendo un file enorme. Caso vero del 17/9/2026: Read su bootstrap.css (8975 righe, ~49.000
// token su una finestra da 32.768), contesto pieno, compattazione, compito perso.
// La prova dal vivo con Claude Code su Ollama e' stata fatta a mano: Adam viene fermato e passa
// da solo a Grep. Qui si controlla il giudizio, il formato dell'hook e gli agganci nello Studio.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const guardiano = require('../strumenti/guardiano-letture');

let pass = 0;
let fail = 0;
function check(nome, condizione, dettaglio) {
  if (condizione) { pass++; console.log('  ok   ' + nome); }
  else { fail++; console.log('  FAIL ' + nome + (dettaglio !== undefined ? '  -> ' + dettaglio : '')); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardiano-'));
try {
  const scrivi = function (nome, righe, testo) {
    const out = [];
    for (let i = 0; i < righe; i++) out.push((testo || '.classe-' + i + ' { margin: ' + i + 'px; color: #333; }'));
    const f = path.join(dir, nome);
    fs.writeFileSync(f, out.join('\n'));
    return f;
  };
  const enorme = scrivi('bootstrap.css', 9000);
  const normale = scrivi('style.css', 200);
  const medio = scrivi('gioco.js', 900);

  console.log('\n=== Cosa passa e cosa no ===');
  const no = guardiano.giudica({ file_path: enorme }, { finestra: 32768 });
  check('un file enorme non si legge tutto', no.permessa === false);
  check('dice quanto pesa davvero', /9000 righe/.test(no.motivo) && /token/.test(no.motivo), no.motivo);
  check('ricorda quanta memoria ha Adam', /32\.768/.test(no.motivo), no.motivo);
  check('spiega cosa fare invece: Grep', /Grep/.test(no.motivo), no.motivo);
  check('spiega cosa fare invece: Read con offset e limit', /offset e limit/.test(no.motivo), no.motivo);
  check('dice che una libreria pronta non si legge', /bootstrap, three\.js, jquery/.test(no.motivo), no.motivo);
  check('un file normale si legge', guardiano.giudica({ file_path: normale }, {}).permessa === true);
  check('anche un file medio-grande, se sta nei limiti',
    guardiano.giudica({ file_path: medio }, { caratteri: 200000, righe: 5000 }).permessa === true);
  check('una lettura mirata con limit e\' sempre permessa',
    guardiano.giudica({ file_path: enorme, offset: 200, limit: 120 }, {}).permessa === true);
  check('ma un limit enorme no', guardiano.giudica({ file_path: enorme, limit: 5000 }, {}).permessa === false);

  console.log('\n=== Prudenza: mai bloccare per sbaglio ===');
  check('file che non esiste: passa (risponde Claude Code)',
    guardiano.giudica({ file_path: path.join(dir, 'mai-visto.css') }, {}).permessa === true);
  check('senza percorso: passa', guardiano.giudica({}, {}).permessa === true);
  const png = path.join(dir, 'icona.png');
  fs.writeFileSync(png, Buffer.alloc(30000));
  check('le immagini non si contano a righe: una piccola passa', guardiano.giudica({ file_path: png }, {}).permessa === true);
  check('la finestra piccola stringe i limiti',
    guardiano.giudica({ file_path: medio }, { caratteri: 8000, righe: 235 }).permessa === false);

  console.log('\n=== Le schermate: si guarda la copia leggera ===');
  // Il pezzo piu' grosso del contesto nelle sessioni vere dell'utente: due Read di PNG da
  // 302.752 e 329.384 caratteri, su una finestra che tiene 32.768 token in tutto.
  const leggera = require('../strumenti/schermata-leggera');
  const scatto = path.join(dir, 'schermata.png');
  fs.writeFileSync(scatto, Buffer.alloc(300 * 1024));
  const senzaCopia = guardiano.giudica({ file_path: scatto }, {});
  check('una schermata enorme senza copia leggera viene fermata', senzaCopia.permessa === false, senzaCopia.motivo);
  check('e spiega che le schermate le allega lo Studio', /le allega lo Studio/.test(senzaCopia.motivo || ''), senzaCopia.motivo);
  fs.writeFileSync(leggera.percorsoLeggero(scatto), Buffer.alloc(20 * 1024));
  const conCopia = guardiano.giudica({ file_path: scatto }, {});
  check('con la copia leggera accanto, manda a quella', conCopia.permessa === false &&
    /piccola\.jpg/.test(conCopia.motivo), conCopia.motivo);
  fs.writeFileSync(path.join(dir, 'media.png'), Buffer.alloc(40 * 1024));
  check('una schermata sotto la soglia passa senza storie',
    guardiano.giudica({ file_path: path.join(dir, 'media.png') }, {}).permessa === true);
  check('la copia leggera stessa si apre sempre',
    guardiano.giudica({ file_path: leggera.percorsoLeggero(scatto) }, {}).permessa === true);

  console.log('\n=== Gli esempi dello Studio si leggono soltanto (18/9/2026) ===');
  const studio = guardiano.CARTELLA_STUDIO;
  const progettoUtente = fs.mkdtempSync(path.join(os.tmpdir(), 'guardiano-progetto-'));
  const ctx = { cwd: progettoUtente };
  const scheletro = path.join(studio, 'scheletri', 'fps-3d-web', 'gioco.js');
  const bloccoEdit = guardiano.giudicaScrittura('Edit', { file_path: scheletro }, ctx);
  check('Edit su uno scheletro: fermato', bloccoEdit.permessa === false, bloccoEdit.motivo);
  check('e spiega come si usa davvero: --usa e poi la copia', /--usa fps-3d-web/.test(bloccoEdit.motivo || ''), bloccoEdit.motivo);
  check('anche Write e MultiEdit dentro lo Studio', guardiano.giudicaScrittura('Write', { file_path: path.join(studio, 'strumenti', 'x.js'), content: 'x' }, ctx).permessa === false &&
    guardiano.giudicaScrittura('MultiEdit', { file_path: scheletro }, ctx).permessa === false);
  check('un file del progetto si modifica liberamente', guardiano.giudicaScrittura('Edit', { file_path: path.join(progettoUtente, 'game.js') }, ctx).permessa === true);
  check('se si lavora sullo Studio stesso, lo Studio si puo\' modificare',
    guardiano.giudicaScrittura('Edit', { file_path: scheletro }, { cwd: studio }).permessa === true);

  console.log('\n=== I file dell\'utente non si riscrivono da zero ===');
  // Il caso vero: game.js da 127 righe coperto da un Write, ne restava il 28%.
  const originale = [];
  ['ADBController', 'createCanvasElement', 'createDeviceList', 'createCommandOutput', 'startApp'].forEach(function (f, i) {
    originale.push('function ' + f + '() {');
    for (let k = 0; k < 20; k++) originale.push('  const valore' + i + '_' + k + ' = leggi("' + f + k + '");');
    originale.push('}');
  });
  const gioco = path.join(progettoUtente, 'game.js');
  fs.writeFileSync(gioco, originale.join('\n'));
  const nuovo = [];
  for (let k = 0; k < 150; k++) nuovo.push('const giocatore' + k + ' = creaGiocatore(' + k + ');');
  const blocco = guardiano.giudicaScrittura('Write', { file_path: gioco, content: nuovo.join('\n') }, { cwd: progettoUtente, ultimaRichiesta: 'aggiungi il multiplayer' });
  check('un Write che cancella quasi tutto un file dell\'utente: fermato', blocco.permessa === false, blocco.motivo);
  check('dice quanto ne resterebbe', /ne resterebbe solo il \d+%/.test(blocco.motivo || ''), blocco.motivo);
  check('e quali funzioni sparirebbero', /ADBController/.test(blocco.motivo || '') && /startApp/.test(blocco.motivo || ''), blocco.motivo);
  check('e dice di usare Edit', /cambialo con Edit/.test(blocco.motivo || ''));
  check('se l\'utente ha chiesto "rifallo da zero", si puo\'',
    guardiano.giudicaScrittura('Write', { file_path: gioco, content: nuovo.join('\n') }, { cwd: progettoUtente, ultimaRichiesta: 'ok rifallo da zero in multiplayer' }).permessa === true);
  check('un file nuovo si crea sempre', guardiano.giudicaScrittura('Write', { file_path: path.join(progettoUtente, 'server.js'), content: 'x' }, ctx).permessa === true);
  const piccolo = path.join(progettoUtente, 'appunti.js');
  fs.writeFileSync(piccolo, 'let a = 1;\nlet b = 2;');
  check('un abbozzo di poche righe si puo\' riscrivere', guardiano.giudicaScrittura('Write', { file_path: piccolo, content: 'const x = 3;' }, ctx).permessa === true);
  check('un Write che tiene quasi tutto (una grossa modifica) passa',
    guardiano.giudicaScrittura('Write', { file_path: gioco, content: originale.join('\n') + '\n// aggiunta in fondo\nfunction nuova() {}' }, { cwd: progettoUtente, ultimaRichiesta: '' }).permessa === true);
  fs.mkdirSync(path.dirname(require('../strumenti/cervello-comandi').cartellaProgetto(progettoUtente)), { recursive: true });
  const cartellaDati = require('../strumenti/cervello-comandi').cartellaProgetto(progettoUtente);
  fs.mkdirSync(cartellaDati, { recursive: true });
  fs.writeFileSync(path.join(cartellaDati, 'ultima-richiesta.txt'), 'riscrivi tutto il gioco da capo');
  check('la richiesta la legge da sola dal file che scrive lo Studio',
    guardiano.giudicaScrittura('Write', { file_path: gioco, content: nuovo.join('\n') }, ctx).permessa === true);
  fs.rmSync(cartellaDati, { recursive: true, force: true });

  console.log('\n=== I comandi che scrivono dentro lo Studio ===');
  const s = studio.split(path.sep).join('/');
  check('cp DENTRO uno scheletro: fermato', guardiano.giudicaComando('cp game.js "' + s + '/scheletri/fps-3d-web/gioco.js"', ctx).permessa === false);
  check('cp DA uno scheletro al progetto: permesso', guardiano.giudicaComando('cp "' + s + '/scheletri/fps-3d-web/rete.js" rete.js', ctx).permessa === true);
  check('scheletri.js --usa: permesso', guardiano.giudicaComando('node "' + s + '/strumenti/scheletri.js" --usa fps-3d-web', ctx).permessa === true);
  check('la verifica dello Studio: permessa', guardiano.giudicaComando('node "' + s + '/strumenti/verifica.js" index.html', ctx).permessa === true);
  check('> dentro lo Studio: fermato', guardiano.giudicaComando('echo ciao > "' + s + '/scheletri/fps-3d-web/nota.txt"', ctx).permessa === false);
  check('del dentro lo Studio: fermato', guardiano.giudicaComando('del "' + s + '/scheletri/fps-3d-web/server.js"', ctx).permessa === false);
  check('sed -i dentro lo Studio: fermato', guardiano.giudicaComando('sed -i "s/a/b/" "' + s + '/scheletri/fps-3d-web/gioco.js"', ctx).permessa === false);
  check('comandi nel progetto: liberi', guardiano.giudicaComando('cp vecchio.js nuovo.js && node server.js', ctx).permessa === true);
  check('git reset --hard e\' sempre fermato', guardiano.giudicaComando('git reset --hard HEAD~1', ctx).permessa === false);
  check('git clean distruttivo e\' sempre fermato', guardiano.giudicaComando('git clean -fdx', ctx).permessa === false);
  check('Remove-Item sul progetto intero e\' fermato',
    guardiano.giudicaComando('Remove-Item -Recurse -Force .', ctx).permessa === false);
  check('un comando di sistema distruttivo e\' fermato', guardiano.giudicaComando('shutdown /s /t 0', ctx).permessa === false);
  check('una scrittura diretta fuori progetto e\' fermata',
    guardiano.giudicaScrittura('Edit', { file_path: path.join(os.homedir(), '.ssh', 'config') }, ctx).permessa === false);

  console.log('\n=== Circuit breaker sugli errori ripetuti ===');
  const sessioneErrori = 'prova-errori-' + Date.now();
  const editFallita = { file_path: path.join(progettoUtente, 'game.js'), old_string: 'inesistente', new_string: 'x' };
  guardiano.registraEsito('Edit', editFallita, sessioneErrori, true, 'old_string non trovato');
  guardiano.registraEsito('Edit', editFallita, sessioneErrori, true, 'old_string non trovato');
  check('due errori uguali non bloccano ancora una strategia corretta',
    guardiano.giudicaFallimenti('Edit', editFallita, sessioneErrori).permessa === true);
  guardiano.registraEsito('Edit', editFallita, sessioneErrori, true, 'old_string non trovato');
  const circuito = guardiano.giudicaFallimenti('Edit', editFallita, sessioneErrori);
  check('dopo tre fallimenti identici il quarto tentativo viene fermato', !circuito.permessa && /Circuit breaker/.test(circuito.motivo), circuito.motivo);
  check('un bersaglio o una strategia diversa resta disponibile',
    guardiano.giudicaFallimenti('Edit', { file_path: path.join(progettoUtente, 'altro.js') }, sessioneErrori).permessa === true);
  guardiano.registraEsito('Read', { file_path: path.join(progettoUtente, 'game.js') }, sessioneErrori, false, 'letto');
  check('rileggere il file con successo riapre la strada',
    guardiano.giudicaFallimenti('Edit', editFallita, sessioneErrori).permessa === true);
  guardiano.azzeraFallimenti(sessioneErrori);
  fs.rmSync(path.join(guardiano.CARTELLA_STATO, sessioneErrori + '.json'), { force: true });
  fs.rmSync(progettoUtente, { recursive: true, force: true });

  console.log('\n=== I giri a vuoto (18/9/2026: la stessa Grep tredici volte di fila) ===');
  const sessione = 'prova-giri-' + Date.now();
  const grepUguale = { pattern: 'canvas\\.addEventListener.*mouse|PointerLock', path: 'C:/gioco/game.js' };
  const volte = [1, 2, 3].map(function () { return guardiano.giudicaGiroAVuoto('Grep', grepUguale, sessione).permessa; });
  check('la stessa ricerca passa due volte e la terza si ferma', volte[0] && volte[1] && !volte[2], JSON.stringify(volte));
  const fermata = guardiano.giudicaGiroAVuoto('Grep', grepUguale, sessione);
  check('e il motivo dice di usare quello che ha gia\' trovato', /Usa quello che hai/.test(fermata.motivo || ''), fermata.motivo);
  check('una ricerca diversa passa', guardiano.giudicaGiroAVuoto('Grep', { pattern: 'zombie', path: 'C:/gioco/game.js' }, sessione).permessa === true);
  guardiano.giudicaGiroAVuoto('Edit', { file_path: 'C:/gioco/game.js' }, sessione);
  check('dopo una modifica al file la stessa ricerca torna libera', guardiano.giudicaGiroAVuoto('Grep', grepUguale, sessione).permessa === true);
  const altra = 'prova-giri-altra-' + Date.now();
  check('le sessioni non si mischiano', guardiano.giudicaGiroAVuoto('Grep', grepUguale, altra).permessa === true);
  // dopo una compattazione rileggere e' giusto: la memoria di Adam si e' svuotata davvero
  const s3 = 'prova-giri-comp-' + Date.now();
  const lettura = { file_path: 'C:/gioco/game.js' };
  guardiano.giudicaGiroAVuoto('Read', lettura, s3, Date.now() - 5000);
  guardiano.giudicaGiroAVuoto('Read', lettura, s3, Date.now() - 4000);
  const marca = path.join(guardiano.CARTELLA_STATO, 'compattazione.txt');
  let marcaPrima = null;
  try { marcaPrima = fs.readFileSync(marca, 'utf8'); } catch (e) { marcaPrima = null; }
  fs.mkdirSync(guardiano.CARTELLA_STATO, { recursive: true });
  fs.writeFileSync(marca, String(Date.now() - 1000));
  check('dopo una compattazione la stessa lettura torna libera', guardiano.giudicaGiroAVuoto('Read', lettura, s3).permessa === true);
  if (marcaPrima === null) fs.rmSync(marca, { force: true }); else fs.writeFileSync(marca, marcaPrima);
  [sessione, altra, s3].forEach(function (s) { fs.rmSync(path.join(guardiano.CARTELLA_STATO, s + '.json'), { force: true }); });

  console.log('\n=== Il formato che Claude Code si aspetta ===');
  const risposta = JSON.parse(guardiano.rispostaHook(no));
  check('e\' un rifiuto PreToolUse', risposta.hookSpecificOutput.hookEventName === 'PreToolUse' &&
    risposta.hookSpecificOutput.permissionDecision === 'deny', JSON.stringify(risposta));
  check('il motivo arriva al modello', /NON leggere tutto bootstrap\.css/.test(risposta.hookSpecificOutput.permissionDecisionReason));
  check('quando passa non dice niente', guardiano.rispostaHook({ permessa: true }) === '{}');

  console.log('\n=== Come lo chiama Claude Code (stdin) ===');
  const chiama = function (dati, argomenti) {
    return execFileSync(process.execPath,
      [path.join(__dirname, '..', 'strumenti', 'guardiano-letture.js')].concat(argomenti || []),
      { input: JSON.stringify(dati), encoding: 'utf8' });
  };
  const uscita = JSON.parse(chiama({ tool_name: 'Read', tool_input: { file_path: enorme } }, ['--hook', '--finestra', '32768']) || '{}');
  check('da riga di comando rifiuta il file enorme',
    uscita.hookSpecificOutput && uscita.hookSpecificOutput.permissionDecision === 'deny', JSON.stringify(uscita));
  check('un altro strumento non lo tocca',
    chiama({ tool_name: 'Bash', tool_input: { command: 'dir' } }, ['--hook']).trim() === '{}');
  check('input rotto: lascia passare invece di bloccare tutto',
    execFileSync(process.execPath, [path.join(__dirname, '..', 'strumenti', 'guardiano-letture.js'), '--hook'],
      { input: 'non-e-json', encoding: 'utf8' }).trim() === '{}');

  console.log('\n=== Agganci nello Studio (server.js) ===');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  check('l\'hook e\' registrato prima di ogni Read',
    /matcher: 'Read\|/.test(server) && /COMANDO_GUARDIANO \+ ' --hook'/.test(server), 'manca hookDelGuardiano');
  check('i limiti seguono la finestra vera del modello',
    /finestraModelloToken\[\(config\.model \|\| ''\)\.trim\(\)\]/.test(server));
  // 18/9/2026: il limite di prima (un quinto della finestra, ~6.550 token) era grande quanto TUTTO lo
  // spazio di lavoro di Adam: una sola lettura permessa bastava a far scattare la compattazione.
  check('una lettura vale al massimo un terzo dello spazio di lavoro, non della finestra',
    /lim\.compattazione - ISTRUZIONI_FISSE_STIMATE/.test(server) && /\(lavoro \/ 3\) \* guardianoLetture\.CARATTERI_PER_TOKEN/.test(server));
  check('e anche le letture mirate seguono quel limite', /' --mirate ' \+ l\.mirate/.test(server));
  check('gli hook del cervello e del guardiano viaggiano insieme',
    /function hookDiSessione\(\)/.test(server) && /const hooks = hookDiSessione\(\);/.test(server));
  check('si puo\' spegnere dalla configurazione', /config\.guardianoLetture === false/.test(server));
  check('controlla anche scritture, comandi e ricerche', /matcher: 'Read\|Write\|Edit\|MultiEdit\|NotebookEdit\|Bash\|Grep\|Glob'/.test(server));
  check('lo Studio segna le compattazioni per il conto dei giri a vuoto', /'compattazione\.txt'/.test(server));
  check('il rilancio dopo il quadro non accetta "esplorare" come passo', /const soloGuardare = /.test(server) &&
    /la PRIMA modifica concreta a un file/.test(server));
  check('Adam non chiede quello che l\'utente ha gia\' detto', /MA NON CHIEDERE QUELLO CHE L\\'UTENTE HA GIA\\' DETTO/.test(server));
  check('lo Studio gli lascia l\'ultima richiesta dell\'utente', /'ultima-richiesta\.txt'/.test(server));
  const testoScheletri = require('../strumenti/scheletri').testoPerPrompt();
  check('e Adam sa dal prompt che gli scheletri si leggono soltanto', /si LEGGONO soltanto/.test(testoScheletri), testoScheletri.slice(0, 120));

  // Il secondo difetto visto il 17/9/2026 alle 18:26: turno senza modifiche dopo una
  // compattazione, e il quadro della situazione restava in sospeso per sempre.
  console.log('\n=== Il turno in cui Adam non tocca niente ===');
  check('esiste la chiusura del turno a vuoto', /function chiudiTurnoSenzaModifiche\(\)/.test(server));
  check('anche quel turno finisce nel diario',
    /function chiudiTurnoSenzaModifiche\(\)[\s\S]{0,400}registraTurnoNelDiario\('nessuna modifica'/.test(server));
  check('e il quadro in sospeso parte comunque',
    /function chiudiTurnoSenzaModifiche\(\)[\s\S]{0,800}mandaQuadro\(inSospeso\)/.test(server));
  check('vale anche con la verifica automatica spenta',
    /if \(!config\.autoVerify\) \{ chiudiTurnoSenzaModifiche\(\); return; \}/.test(server));
} catch (e) {
  check('la prova si esegue', false, e.stack);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n' + '='.repeat(50));
console.log('GUARDIANO DELLE LETTURE: ' + pass + ' passati, ' + fail + ' falliti');
process.exit(fail ? 1 : 0);
