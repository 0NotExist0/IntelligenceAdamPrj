// Prova il "fermati un momento": il diario di bordo dello Studio e il quadro della situazione.
// Richiesta dell'utente (16/9/2026): quando Adam perde il filo deve fermarsi, guardare dove si
// trova e accorgersi da solo che sta sbagliando strada. Da solo non ci riesce: glielo fa fare lo
// Studio, con i fatti (richiesta dell'utente, file veri, misure, cosa ha gia' provato).
const fs = require('fs');
const os = require('os');
const path = require('path');
const archivio = require('../strumenti/archivio-chat');
const diario = require('../strumenti/diario');
const quadro = require('../strumenti/quadro');

let pass = 0;
let fail = 0;
function check(nome, condizione, dettaglio) {
  if (condizione) { pass++; console.log('  ok   ' + nome); }
  else { fail++; console.log('  FAIL ' + nome + (dettaglio !== undefined ? '  -> ' + dettaglio : '')); }
}

const cartelle = [];
function progetto(file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prova-quadro-'));
  cartelle.push(dir);
  Object.keys(file || {}).forEach(function (nome) {
    const completo = path.join(dir, nome);
    fs.mkdirSync(path.dirname(completo), { recursive: true });
    fs.writeFileSync(completo, file[nome]);
  });
  return dir;
}

console.log('\n=== Il diario di bordo: cosa e\' successo davvero, turno per turno ===');
let dir = progetto({ 'main.py': 'import pygame\n' + 'x = 1\n'.repeat(120) });
diario.azzera(dir);
diario.registraTurno(dir, { file: ['main.py'], esito: 'errori', problemi: ['main.py:227 TypeError: center argument (47 zombie in gioco)'], testo: 'Ho corretto i proiettili' });
diario.registraTurno(dir, { file: ['main.py'], esito: 'errori', problemi: ['main.py:227 TypeError: center argument (52 zombie in gioco)'], testo: 'Ora sistemo il disegno' });
let s = diario.segnali(dir);
check('due turni scritti', s.turni === 2, JSON.stringify(s.turni));
check('lo stesso errore con numeri diversi conta come uno solo, visto 2 volte',
  s.ripetuti.length === 1 && s.ripetuti[0].volte === 2, JSON.stringify(s.ripetuti));
check('due turni di fila finiti con errori', s.senzaProgresso === 2, String(s.senzaProgresso));
diario.registraTurno(dir, { file: ['main.py'], esito: 'ok', problemi: [], testo: 'Adesso parte' });
check('un turno andato bene azzera il conto dei turni senza progresso', diario.segnali(dir).senzaProgresso === 0);

console.log('\n=== Quando ci si ferma (e quando no) ===');
check('memoria compattata: ci si ferma sempre', quadro.serveIlQuadro('compattazione', { turniDallUltimoQuadro: null }).serve);
check('sessione nuova: ci si ferma', quadro.serveIlQuadro('sessione-nuova', {}).serve);
check('"e\' fatto" ma i controlli dicono di no: ci si ferma', quadro.serveIlQuadro('fatto-non-vero', {}).serve);
check('stesso problema 2 volte: ancora presto', !quadro.serveIlQuadro('errori-ripetuti', { ripetuti: [{ volte: 2 }] }).serve);
check('stesso problema 3 volte: ci si ferma', quadro.serveIlQuadro('errori-ripetuti', { ripetuti: [{ volte: 3 }] }).serve);
check('3 turni con errori: si aspetta ancora', !quadro.serveIlQuadro('nessun-progresso', { senzaProgresso: 3 }).serve);
check('4 turni con errori: ci si ferma', quadro.serveIlQuadro('nessun-progresso', { senzaProgresso: 4 }).serve);
check('quadro fatto un turno fa: non si ripete (sarebbe rumore)',
  !quadro.serveIlQuadro('compattazione', { turniDallUltimoQuadro: 1 }).serve);
check('ma se lo chiede l\'utente si fa lo stesso', quadro.serveIlQuadro('richiesto', { turniDallUltimoQuadro: 0 }).serve);

console.log('\n=== Il quadro vero: il caso del gioco dell\'utente ===');
const baseChat = fs.mkdtempSync(path.join(os.tmpdir(), 'prova-quadro-chat-'));
cartelle.push(baseChat);
dir = progetto({
  'main.py': 'import pygame, socket\n' + 'schermo = pygame.display.set_mode((1024, 768))\n'.repeat(1) + 'x = 1\n'.repeat(250),
  'vecchio/roba.txt': 'niente'
});
archivio.salva(dir, archivio.nuovoId(), [
  { role: 'user', ts: Date.now() - 60000, blocks: [{ kind: 'text', text: 'scrivi un gioco multiplayer in stile minecraft, un fps dove ci spariamo e spariamo agli zombie' }] },
  { role: 'assistant', ts: Date.now() - 50000, blocks: [{ kind: 'text', text: 'Fatto!' }] },
  { role: 'user', ts: Date.now() - 40000, blocks: [{ kind: 'text', text: 'rimuovi il gioco in html css e js, fallo in python' }] }
], {}, baseChat);

const q = quadro.costruisci(dir, {
  motivo: 'compattazione',
  perche: quadro.MOTIVI.compattazione,
  baseChat: baseChat,
  problemi: ['main.py:1 la finestra si apre ma lo schermo non viene MAI aggiornato: manca pygame.display.flip()'],
  segnali: { ripetuti: [{ volte: 3, testo: 'main.py:227 TypeError: center argument must be a pair of numbers' }] }
});
check('dice perche\' lo sta fermando', /memoria si e' appena compattata/.test(q.testo), q.testo.slice(0, 200));
check('rimette davanti la richiesta dell\'utente, punto per punto', /PUNTI CONTROLLABILI DELLA RICHIESTA/.test(q.testo) &&
  /MANCA: FPS in prima persona/.test(q.testo) && /MANCA: multiplayer/.test(q.testo), q.testo);
// I punti controllabili sono pochi e fissi: senza le parole dell'utente, di "in stile minecraft"
// o "sono un raver che suona acid tekno" non resterebbe niente dopo una compattazione.
check('riporta anche le parole dell\'utente', /COSA HA CHIESTO L'UTENTE \(parole sue/.test(q.testo) &&
  /stile minecraft/.test(q.testo), q.testo);
check('tiene sia la prima richiesta sia l\'ultima', /spariamo agli zombie/.test(q.testo) &&
  /fallo in python/.test(q.testo), q.testo);
check('mostra i file veri con quante righe hanno', /main\.py \(\d+ righe\)/.test(q.testo), q.testo);
check('mostra cosa succede provandolo davvero', /non viene MAI aggiornato/.test(q.testo), q.testo);
check('ricorda cosa ha gia\' provato senza risolvere', /GIA' PROVATO SENZA RISOLVERE/.test(q.testo) &&
  /in 3 turni resta/.test(q.testo), q.testo);
check('obbliga alle 5 domande prima di toccare i file', /PRIMA DI TOCCARE UN FILE/.test(q.testo) &&
  /UN solo prossimo passo/.test(q.testo) && /con quale comando lo verifico/.test(q.testo), q.testo);
check('dice di parlare chiaro invece di girare in tondo', /scrivilo chiaramente all'utente/.test(q.testo), q.testo);
check('sta in poco spazio (sotto i 2500 caratteri)', q.testo.length < 2500, String(q.testo.length));
check('non elenca file che non sono codice', !/roba\.txt/.test(q.testo), q.testo);

console.log('\n=== Senza misure recenti lo dice, non se le inventa ===');
const q2 = quadro.costruisci(dir, { motivo: 'richiesto', baseChat: baseChat });
check('dice che non ci sono misure recenti', /nessuna misura recente/.test(q2.testo), q2.testo);

console.log('\n=== E cosa e\' cambiato sul disco negli ultimi turni ===');
// Il caso del 17/9/2026: il file che l'utente vede rotto era stato sostituito due turni prima.
const baseDati = fs.mkdtempSync(path.join(os.tmpdir(), 'prova-quadro-dati-'));
cartelle.push(baseDati);
require('../strumenti/cambiamenti').registra(dir, {
  voci: [
    { rel: 'curriculum/style.css', tipo: 'modificato', righePrima: 425, righeDopo: 242, sostituito: true, accorciato: true, persi: ['@keyframes glitch'] },
    { rel: 'main.py', tipo: 'modificato', righePrima: 250, righeDopo: 252, sostituito: false, accorciato: false, persi: [] }
  ]
}, { base: baseDati, chiave: 'turno-x' });
const q3 = quadro.costruisci(dir, { motivo: 'sessione-nuova', baseChat: baseChat, baseDati: baseDati });
check('il quadro dice quali file hanno perso roba', /SOSTITUITO curriculum\/style\.css: 425 -> 242 righe/.test(q3.testo), q3.testo);
check('e non elenca i file solo modificati', !/main\.py: 250/.test(q3.testo), q3.testo);
check('senza cambiamenti registrati non aggiunge la sezione',
  !/HANNO PERSO ROBA/.test(quadro.costruisci(dir, { motivo: 'richiesto', baseChat: baseChat, baseDati: fs.mkdtempSync(path.join(os.tmpdir(), 'prova-quadro-vuoto-')) }).testo));
check('resta comunque compatto', q3.testo.length < 2500, String(q3.testo.length));

cartelle.forEach(function (d) {
  try { fs.rmSync(path.dirname(diario.fileDelDiario(d)), { recursive: true, force: true }); } catch (e) {}
  try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {}
});
console.log('\n' + '='.repeat(50));
console.log('QUADRO DELLA SITUAZIONE: ' + pass + ' passati, ' + fail + ' falliti');
process.exit(fail ? 1 : 0);
