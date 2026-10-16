// NotExist Intelligience Studio - test dei flussi che richiedono il modello.
// LENTO: ogni turno su modello locale dura minuti. Richiede il server avviato.
//   node test/flusso-live.test.js

const http = require('http');
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const failures = [];

function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; failures.push(name + (detail ? ' -> ' + detail : '')); console.log('! FAIL  ' + name + (detail ? ' -> ' + detail : '')); }
}

function req(method, p, body) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;
    const r = http.request({
      hostname: 'localhost', port: 3456, path: p, method, timeout: 120000,
      headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}
    }, (rs) => {
      let d = '';
      rs.on('data', (c) => { d += c; });
      rs.on('end', () => { let j = null; try { j = JSON.parse(d); } catch (e) {} resolve({ s: rs.statusCode, j }); });
    });
    r.on('error', () => resolve({ s: 0, j: null }));
    r.on('timeout', () => { r.destroy(); resolve({ s: 0, j: null }); });
    if (payload) r.write(payload);
    r.end();
  });
}

const attesa = (ms) => new Promise((r) => setTimeout(r, ms));

// Aspetta la fine del turno. Limite generoso: a ~6 token/s un turno con strumenti
// puo' durare parecchio, e un timeout troppo stretto darebbe falsi fallimenti.
async function attendiTurno(limiteMs) {
  const scadenza = Date.now() + (limiteMs || 900000);
  await attesa(3000);
  while (Date.now() < scadenza) {
    const c = await req('GET', '/api/chat');
    if (c.j && c.j.busy === false) return c.j;
    await attesa(5000);
  }
  return null;
}

function testoAssistente(chat) {
  return (chat.messages || [])
    .filter((m) => m.role === 'assistant')
    .map((m) => (m.blocks || []).filter((b) => b.kind === 'text').map((b) => b.text).join(' '))
    .join('\n');
}

// Testo del solo turno corrente. Necessario quando piu' domande condividono la
// sessione: altrimenti si valida la risposta a una domanda precedente.
function testoUltimoTurno(chat) {
  const messaggi = chat.messages || [];
  let inizio = 0;
  for (let i = messaggi.length - 1; i >= 0; i--) {
    if (messaggi[i].role === 'user') { inizio = i + 1; break; }
  }
  return messaggi.slice(inizio)
    .filter((m) => m.role === 'assistant')
    .map((m) => (m.blocks || []).filter((b) => b.kind === 'text').map((b) => b.text).join(' '))
    .join('\n');
}

function strumentiUsati(chat) {
  const out = [];
  (chat.messages || []).forEach((m) => (m.blocks || []).forEach((b) => {
    if (b.kind === 'tool') out.push({ nome: b.name, risultato: b.result, errore: b.isError });
  }));
  return out;
}

async function main() {
  const st = (await req('GET', '/api/status')).j;
  if (!st) { console.log('Server non raggiungibile.'); process.exit(1); }
  console.log('Modello: ' + st.model + ' | provider: ' + st.provider + ' | effort: ' + st.effort + '\n');
  const cwd = st.cwd;

  // ---------------------------------------------------------- 1. risposta base
  console.log('=== 1. Risposta semplice ===');
  await req('POST', '/api/chat/new');
  await attesa(2500);
  // Primo turno: il modello puo' essere a freddo (caricamento) e il prompt di sistema
  // e' di ~25k token. Misurato 96 s per una richiesta banale, quindi il limite va largo.
  await req('POST', '/api/chat/send', { text: 'Rispondi solo con la parola VIVO, nientaltro.' });
  let chat = await attendiTurno(600000);
  check('il modello risponde', !!chat, 'timeout');
  if (chat) {
    check('la risposta contiene VIVO', /VIVO/i.test(testoUltimoTurno(chat)),
      testoUltimoTurno(chat).slice(0, 80));
  }

  // ---------------------------------------------------------- 2. uso strumenti
  console.log('\n=== 2. Uso di uno strumento (scrittura file) ===');
  const target = path.join(cwd, '__live_test__.txt');
  try { fs.unlinkSync(target); } catch (e) {}
  await req('POST', '/api/chat/new');
  await attesa(2500);
  await req('POST', '/api/chat/send', {
    text: 'Usa lo strumento Write per creare il file __live_test__.txt con dentro esattamente la parola CIAOMONDO. Poi conferma.'
  });
  chat = await attendiTurno(600000);
  check('il turno con strumento si conclude', !!chat, 'timeout');
  if (chat) {
    const strumenti = strumentiUsati(chat);
    check('e stato invocato uno strumento strutturato', strumenti.length > 0,
      'nessuno strumento: il modello potrebbe non saper eseguire chiamate');
    check('il file esiste davvero', fs.existsSync(target));
    if (fs.existsSync(target)) {
      const contenuto = fs.readFileSync(target, 'utf8');
      check('il contenuto e corretto', /CIAOMONDO/.test(contenuto), JSON.stringify(contenuto.slice(0, 40)));
      fs.unlinkSync(target);
    }
    check('nessuno strumento in errore', strumenti.every((t) => !t.errore));
  }

  // ---------------------------------------------------------- 3. memoria
  console.log('\n=== 3. Richiamo dalla memoria ===');
  const parola = 'CODICE-' + Math.floor(Math.random() * 9000 + 1000);
  const nodo = await req('POST', '/api/memory/node', {
    scope: 'project', type: 'data', label: 'Codice di collaudo',
    value: 'Il codice di collaudo del progetto e ' + parola + '.', tags: ['collaudo']
  });
  check('memoria salvata', nodo.s === 200);
  // Il salvataggio riavvia le sessioni per far entrare la memoria nel prompt: si
  // attende, poi si riparte da una chat pulita per non confondersi con i turni prima.
  await attesa(8000);
  await req('POST', '/api/chat/new');
  await attesa(3000);
  await req('POST', '/api/chat/send', {
    text: 'Nella tua memoria persistente c e la voce "Codice di collaudo". Riportane il valore esatto.'
  });
  chat = await attendiTurno(400000);
  check('il turno sulla memoria si conclude', !!chat, 'timeout');
  if (chat) {
    check('il modello richiama il valore dalla memoria',
      testoUltimoTurno(chat).indexOf(parola) !== -1,
      'atteso ' + parola + ' in: ' + testoUltimoTurno(chat).slice(0, 150));
  }
  const grafo = (await req('GET', '/api/memory')).j;
  const salvato = ((grafo.graph || grafo).nodes || []).find((n) => n.label === 'Codice di collaudo');
  if (salvato) await req('DELETE', '/api/memory/node/' + encodeURIComponent(salvato.id));

  // ---------------------------------------------------------- 3b. regressione
  // Bug reale: salvando in memoria e inviando SUBITO un messaggio, il riavvio delle
  // sessioni uccideva il processo prima della risposta e il messaggio spariva in
  // silenzio. Il riavvio ora si rimanda a fine turno.
  console.log('\n=== 3b. Messaggio inviato durante un aggiornamento di memoria ===');
  await req('POST', '/api/chat/new');
  await attesa(2500);
  const nodoRace = await req('POST', '/api/memory/node', {
    scope: 'project', type: 'data', label: 'Nodo race', value: 'x', tags: []
  });
  await req('POST', '/api/chat/send', { text: 'Rispondi solo con la parola PRESENTE.' });
  await attesa(6000);
  const durante = (await req('GET', '/api/chat')).j;
  check('il turno non viene interrotto dal riavvio per memoria', durante.busy === true,
    'busy=' + durante.busy + ' dopo 6s: il messaggio potrebbe essere stato perso');
  chat = await attendiTurno(400000);
  if (chat) {
    const risposte = (chat.messages || []).filter((m) => m.role === 'assistant');
    check('il messaggio riceve comunque una risposta', risposte.length > 0);
  } else {
    check('il messaggio riceve comunque una risposta', false, 'timeout');
  }
  const gRace = (await req('GET', '/api/memory')).j;
  const nRace = ((gRace.graph || gRace).nodes || []).find((n) => n.label === 'Nodo race');
  if (nRace) await req('DELETE', '/api/memory/node/' + encodeURIComponent(nRace.id));

  // ---------------------------------------------------------- 4. identita
  console.log('\n=== 4. Identita ===');
  await req('POST', '/api/chat/new');
  await attesa(2500);
  await req('POST', '/api/chat/send', { text: 'Come ti chiami? Rispondi solo con il nome.' });
  chat = await attendiTurno(500000);
  if (chat) {
    check('si presenta come Adam', /adam/i.test(testoUltimoTurno(chat)),
      testoUltimoTurno(chat).slice(0, 80));
  } else {
    check('si presenta come Adam', false, 'timeout');
  }

  // ---------------------------------------------------------- 5. verifica+fix
  console.log('\n=== 5. Ciclo verifica e correzione automatica ===');
  const rotto = path.join(cwd, '__live_rotto__.py');
  fs.writeFileSync(rotto, 'def saluta(nome)\n    return "ciao " + nome\n', 'utf8');
  await req('POST', '/api/issues/clear', { all: true });
  await req('POST', '/api/verify', { files: [rotto] });
  const problemi = (await req('GET', '/api/issues')).j;
  check('errore rilevato dalla verifica', problemi.open >= 1, 'aperti: ' + problemi.open);
  chat = await attendiTurno(700000);
  check('il ciclo di correzione si conclude', !!chat, 'timeout');
  if (fs.existsSync(rotto)) {
    const finale = fs.readFileSync(rotto, 'utf8');
    check('il file e stato corretto da Adam', finale.indexOf('def saluta(nome):') !== -1,
      JSON.stringify(finale.slice(0, 60)));
    fs.unlinkSync(rotto);
  }
  const dopo = (await req('GET', '/api/issues')).j;
  check('nessun problema resta aperto', dopo.open === 0, 'aperti: ' + dopo.open);
  try { fs.rmSync(path.join(cwd, '__pycache__'), { recursive: true, force: true }); } catch (e) {}
  await req('POST', '/api/issues/clear', { all: true });

  // ---------------------------------------------------------- esito
  console.log('\n' + '='.repeat(60));
  console.log('RISULTATO LIVE: ' + pass + ' passati, ' + fail + ' falliti');
  if (failures.length) { console.log('\nFalliti:'); failures.forEach((f) => console.log('  - ' + f)); }
  console.log('='.repeat(60));
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('Errore nella suite live:', e); process.exit(1); });
