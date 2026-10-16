// Prova le chat salvate: file leggibile, indice, collegamento come memoria, e sicurezza
// della lettura (solo file dell'indice, niente percorsi inventati).
const fs = require('fs');
const os = require('os');
const path = require('path');
const a = require('../strumenti/archivio-chat');

let pass = 0;
let fail = 0;
function check(nome, condizione, dettaglio) {
  if (condizione) { pass++; console.log('  ok   ' + nome); }
  else { fail++; console.log('  FAIL ' + nome + (dettaglio !== undefined ? '  -> ' + dettaglio : '')); }
}

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'prova-archivio-'));
const progetto = path.join(os.tmpdir(), 'progetto-finto-chat');
const ts = new Date(2026, 8, 10, 23, 51).getTime();
const messaggi = [
  { role: 'user', ts: ts, blocks: [{ kind: 'text', text: 'il gioco alien-space.html non funziona bene: controllalo' }] },
  { role: 'progress', ts: ts + 1000, titolo: 'Prima di passare la segnalazione ad Adam', riassunto: '6 problemi misurati', focus: 'Oggetti eliminati' },
  { role: 'user', auto: true, reason: 'misure', ts: ts + 2000, blocks: [{ kind: 'text', text: 'MISURE DELLO STUDIO ' + 'x'.repeat(3000) }] },
  { role: 'assistant', ts: ts + 3000, blocks: [
    { kind: 'thinking', text: 'ragionamento lungo che non serve ritrovare' },
    { kind: 'text', text: 'Ho trovato il problema: il nemico distrutto non viene tolto.' },
    { kind: 'tool', name: 'Edit', input: { file_path: 'C:/Prova/game.js', old_string: 'a', new_string: 'b' } }
  ] },
  { role: 'system', ts: ts + 4000, blocks: [{ kind: 'text', text: 'Verifica superata' }] }
];

try {
  console.log('\n=== Salvataggio ===');
  const id = a.nuovoId();
  check('id adatto a un nome di file', /^[\w-]+$/.test(id), id);
  const r = a.salva(progetto, id, messaggi, { modello: 'qwen3.5-studio:9b', progetto: progetto }, base);
  check('scrive il file', r && fs.existsSync(r.percorso), JSON.stringify(r));
  const md = fs.readFileSync(r.percorso, 'utf8');
  check('titolo = prima richiesta dell\'utente', /^# il gioco alien-space\.html non funziona bene/.test(md), md.slice(0, 80));
  check('chi ha detto cosa, con l\'ora', /### Utente, 23:51/.test(md) && /### Adam, 23:51/.test(md));
  check('i messaggi dello Studio si distinguono e si accorciano', /### Studio -> Adam, 23:51 \(misure\)/.test(md) && /\[\.\.\.accorciato\]/.test(md));
  check('gli strumenti usati, con il file', /- strumento Edit: C:\/Prova\/game\.js/.test(md));
  check('il ragionamento interno non si salva', md.indexOf('ragionamento lungo') === -1);
  check('le verifiche restano, con il focus', /> Verifica, 23:51: Prima di passare la segnalazione ad Adam - 6 problemi misurati Focus: Oggetti eliminati/.test(md));
  check('una chat vuota non si salva', a.salva(progetto, 'vuota', [{ role: 'system', blocks: [{ kind: 'text', text: 'x' }] }], {}, base) === null);

  console.log('\n=== Indice e aggiornamento ===');
  messaggi.push({ role: 'user', ts: ts + 60000, blocks: [{ kind: 'text', text: 'grazie' }] });
  a.salva(progetto, id, messaggi, {}, base);
  const lista = a.elenco(progetto, base);
  check('la stessa conversazione resta una voce sola', lista.length === 1, JSON.stringify(lista));
  check('conta i messaggi utili', lista[0].messaggi === 4, lista[0].messaggi);
  check('collegata come memoria di default', lista[0].collegata === true);
  const id2 = a.nuovoId() + 'b';
  a.salva(progetto, id2, [{ role: 'user', ts: ts, blocks: [{ kind: 'text', text: 'seconda chat' }] }], {}, base);
  check('le piu\' recenti per prime', a.elenco(progetto, base)[0].file === id2 + '.md');

  console.log('\n=== Memoria esplorabile ===');
  const prompt = a.testoPerPrompt(progetto, id, base);
  check('il prompt dice dove sono le chat', prompt.indexOf(a.cartellaProgetto(progetto, base).split(path.sep).join('/')) !== -1);
  check('elenca le chat con il titolo', /"seconda chat"/.test(prompt) && /"il gioco alien-space/.test(prompt));
  check('segna la conversazione corrente', /\(questa conversazione, prima del rinnovo\)/.test(prompt));
  check('spiega di cercarle con Grep invece di leggerle intere', /Grep/.test(prompt) && /Non leggere i file interi/.test(prompt));
  check('scollegare una chat', a.collega(progetto, id2 + '.md', false, base) === true);
  check('una chat scollegata non va nel prompt', !/"seconda chat"/.test(a.testoPerPrompt(progetto, id, base)));
  check('scollegate tutte: niente sezione', a.collega(progetto, id + '.md', false, base) && a.testoPerPrompt(progetto, id, base) === '');
  check('collegare una chat inesistente fallisce', a.collega(progetto, 'nessuna.md', true, base) === false);

  console.log('\n=== Lettura sicura ===');
  check('legge una chat dell\'indice', /seconda chat/.test(a.leggi(progetto, id2 + '.md', base) || ''));
  check('rifiuta i percorsi che risalgono', a.leggi(progetto, '../../segreti.md', base) === null);
  check('rifiuta i file fuori dall\'indice', a.leggi(progetto, 'indice.json', base) === null && a.leggi(progetto, 'altro.md', base) === null);
  check('progetti diversi, cartelle diverse', a.cartellaProgetto('C:/a', base) !== a.cartellaProgetto('C:/b', base));
} catch (e) {
  check('la prova si esegue', false, e.stack);
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}

console.log('\n' + '='.repeat(50));
console.log('CHAT SALVATE: ' + pass + ' passati, ' + fail + ' falliti');
process.exit(fail ? 1 : 0);
