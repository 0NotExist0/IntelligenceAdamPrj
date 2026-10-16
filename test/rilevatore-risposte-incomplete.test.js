// Estrae detectIncompleteTurn da server.js e la prova su casi reali,
// inclusi quelli osservati dal vivo durante lo sviluppo.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');

const start = src.indexOf('function assistantText(message)');
const end = src.indexOf('function cancelAutoContinue()');
let chatMessages = [];           // la funzione legge questa variabile
eval(src.slice(start, end));

function turn(assistantTexts, userText) {
  // Un turno = messaggio utente + uno o piu' messaggi assistente. Un messaggio e' un testo oppure,
  // quando servono blocchi diversi dal testo (ragionamento, strumenti), la lista dei suoi blocchi.
  chatMessages = [{ role: 'user', blocks: [{ kind: 'text', text: userText || 'domanda' }] }]
    .concat(assistantTexts.map(t => ({ role: 'assistant', blocks: Array.isArray(t) ? t : [{ kind: 'text', text: t }] })));
}

const cases = [
  ['risposta breve legittima', { stop_reason: 'end_turn', usage: { output_tokens: 5 } },
    ['TUTTO OK'], false],

  ['risposta normale con punto finale', { stop_reason: 'end_turn', usage: { output_tokens: 300 } },
    ['Ho creato il file come richiesto e verificato che funzioni.'], false],

  ['CASO REALE 1: lista frutta troncata al 24', { stop_reason: 'end_turn', terminal_reason: 'completed', is_error: false, usage: { output_tokens: 120 } },
    ['1. Mela\n2. Pera\n3. Banana\n21. Mango\n22. Litchi\n23. Durian\n24. Rambutan'], true],

  ['CASO REALE 2: 40 frutti su 60, spezzati su piu messaggi (ultimo corto)',
    { stop_reason: 'end_turn', terminal_reason: 'completed', is_error: false, usage: { output_tokens: 60 } },
    ['Ecco un elenco:\n1. Mela\n2. Banana\n3. Arancia\n4. Lime\n5. Pesca\n6. Albicocca',
     'Continuo dal 18:\n18. Cedro\n19. Nespola\n20. Cachi',
     'Let me continue.',
     '\n37. Clementina\n38. Satsuma\n39. Pompelmo\n40. Carambola'], true],

  ['blocco di codice aperto', { stop_reason: 'end_turn', usage: { output_tokens: 400 } },
    ['Ecco il codice:\n\n```python\nimport pygame\npygame.init()'], true],

  ['blocco di codice chiuso', { stop_reason: 'end_turn', usage: { output_tokens: 400 } },
    ['Ecco il codice:\n\n```python\nimport pygame\n```'], false],

  ['blocco aperto in un messaggio, chiuso in quello dopo',
    { stop_reason: 'end_turn', usage: { output_tokens: 400 } },
    ['Ecco:\n```python\nimport pygame', 'pygame.init()\n```\nFatto.'], false],

  ['turno che chiama uno strumento', { stop_reason: 'tool_use', usage: { output_tokens: 60 } },
    ['Scrivo il file.'], false],

  ['errore API', { is_error: true, terminal_reason: 'api_error', usage: {} },
    ['API Error: The response stopped arriving'], true],

  ['chiave API non valida: errore permanente, niente retry',
    { is_error: true, terminal_reason: 'api_error', result: '401 Unauthorized: invalid API key', usage: {} },
    ['API Error: 401 Unauthorized: invalid API key'], false],

  ['quota esaurita: errore permanente, niente retry',
    { is_error: true, terminal_reason: 'api_error', result: '429 quota exceeded: insufficient credits', usage: {} },
    ['API Error: quota exceeded'], false],

  ['429 Too Many Requests: rate limit temporaneo con retry',
    { is_error: true, terminal_reason: 'api_error', result: '429 Too Many Requests', usage: {} },
    ['API Error: 429 Too Many Requests'], true],

  ['modello inesistente: niente ciclo di retry',
    { is_error: true, terminal_reason: 'api_error', result: '404 model not found', usage: {} },
    ['API Error: model not found'], false],

  ['servizio 503 temporaneamente indisponibile: retry consentito',
    { is_error: true, terminal_reason: 'api_error', result: '503 Service Unavailable', usage: {} },
    ['API Error: 503 Service Unavailable'], true],

  ['errore API sconosciuto: fail closed, niente martellamento',
    { is_error: true, terminal_reason: 'api_error', result: 'provider exploded unexpectedly', usage: {} },
    ['API Error: provider exploded unexpectedly'], false],

  ['tetto di token esplicito', { stop_reason: 'max_tokens', usage: { output_tokens: 4096 } },
    ['testo lungo'], true],

  ['frase tagliata a meta parola', { stop_reason: 'end_turn', usage: { output_tokens: 250 } },
    ['Il gioco usa pygame per disegnare la nave e gli alieni, e la collisione viene calcolata confront'], true],

  ['elenco puntato completo', { stop_reason: 'end_turn', usage: { output_tokens: 200 } },
    ['Ho fatto queste cose:\n- creato il file\n- verificato la sintassi\n- eseguito il test.'], false],

  ['messaggio vuoto', { stop_reason: 'end_turn', usage: { output_tokens: 0 } }, [''], false],

  ['risposta media che finisce con parentesi', { stop_reason: 'end_turn', usage: { output_tokens: 150 } },
    ['Il file e pronto (265 righe)'], false],

  ['CASO REALE 3: lista di 50 COMPLETATA (era un falso positivo)',
    { stop_reason: 'end_turn', terminal_reason: 'completed', usage: { output_tokens: 300 } },
    ['1. Mela\n2. Pera\n3. Banana\n47. Lychee\n48. Pomegranate\n49. Dragon Fruit\n50. Starfruit'],
    false,
    'Scrivi un elenco numerato di 50 nomi di frutta, uno per riga, dal numero 1 al numero 50.'],

  ['lista di 60 ferma a 40: incompleta',
    { stop_reason: 'end_turn', terminal_reason: 'completed', usage: { output_tokens: 300 } },
    ['1. Mela\n2. Pera\n38. Satsuma\n39. Pompelmo\n40. Carambola'],
    true,
    'Scrivi un elenco numerato di 60 nomi di frutta dal numero 1 al numero 60.'],

  ['CASO REALE 4: finisce con emoji razzo (era un falso positivo)',
    { stop_reason: 'end_turn', usage: { output_tokens: 300 } },
    ['Ho corretto entrambe le cose. '.repeat(12) + 'Riprova ora il gioco! ' + String.fromCodePoint(0x1F680)], false],

  ['finisce con emoji spunta verde',
    { stop_reason: 'end_turn', usage: { output_tokens: 300 } },
    ['Ho corretto entrambe le cose. '.repeat(12) + 'Tutto sistemato ' + String.fromCodePoint(0x2705)], false],

  ['emoji in mezzo ma frase tagliata alla fine',
    { stop_reason: 'end_turn', usage: { output_tokens: 300 } },
    ['Ecco ' + String.fromCodePoint(0x1F680) + ' la correzione. '.repeat(12) + 'e la collisione viene calcolata confront'], true],

  ['CASO REALE 5: contesto del modello pieno (riprendere non serve)',
    { is_error: true, terminal_reason: 'api_error', usage: {},
      result: 'API Error: 400 {"error":{"code":400,"message":"request (50191 tokens) exceeds the available context size (49152 tokens), try increasing it","type":"exceed_context_size_error"}}' },
    ['API Error: 400 {"error":{"code":400,"message":"request (50191 tokens) exceeds the available context size (49152 tokens), try increasing it","type":"exceed_context_size_error"}}'], false],

  ['CASO REALE 6: riepilogo che finisce con un elenco puntato (era un falso positivo)',
    { stop_reason: 'end_turn', usage: { output_tokens: 400 } },
    ['Ho trovato e corretto tutti e tre i problemi segnalati.\n\nLe modifiche garantiscono ora che:\n' +
     '- Il gioco funzioni fluentemente senza accumulo di cicli\n- La navicella appaia immediatamente quando si ricomincia\n' +
     '- Tutti i controlli del mouse e delle tastiera funzionino correttamente'], false],

  ['una frase tagliata con un solo trattino resta interrotta',
    { stop_reason: 'end_turn', usage: { output_tokens: 250 } },
    ['Ecco cosa ho cambiato nel gioco per sistemare il ciclo di animazione e la navicella che spariva:\n' +
     '- la navicella adesso parte in basso e il ciclo precedente viene fermato prima di avviar'], true],

  ['CASO REALE 7: "output token maximum" con Ollama e\' contesto pieno travestito',
    { is_error: true, terminal_reason: 'api_error', usage: {},
      result: "API Error: Claude's response exceeded the 32000 output token maximum. To configure this behavior, set the CLAUDE_CODE_MAX_OUTPUT_TOKENS environment variable." },
    ["API Error: Claude's response exceeded the 32000 output token maximum. To configure this behavior, set the CLAUDE_CODE_MAX_OUTPUT_TOKENS environment variable."], false],

  ['una risposta normale che parla di contesto pieno non e\' un errore',
    { stop_reason: 'end_turn', usage: { output_tokens: 300 } },
    ['Il messaggio "prompt is too long" compare quando il contesto e\' pieno: basta leggere meno file.'], false],

  // Il sesto elemento e' l'usage dell'ultima risposta del modello (message_delta): lo Studio lo passa
  // insieme al result, che invece somma tutte le chiamate del turno.
  ['CASO REALE 8: Write da 603 token e poi "FATTO" (era un falso positivo)',
    { stop_reason: 'end_turn', usage: { output_tokens: 660 } },
    ['FATTO'], false, undefined, { output_tokens: 25 }],

  ['testo lungo prima degli strumenti, conclusione breve senza punto',
    { stop_reason: 'end_turn', usage: { output_tokens: 1200 } },
    ['Leggo il file per capire la struttura del progetto e poi applico le modifiche necessarie. '.repeat(6),
     'Collegamento ADB completato'], false, undefined, { output_tokens: 30 }],

  ['ultima risposta lunga tagliata a meta resta interrotta',
    { stop_reason: 'end_turn', usage: { output_tokens: 900 } },
    ['Ho letto il file.',
     'Il gioco usa pygame per disegnare la nave e gli alieni, e la collisione viene calcolata confront'],
    true, undefined, { output_tokens: 250 }],

  // Il modello ha solo ragionato e ha chiuso il turno: niente testo per l'utente, nessuno strumento.
  ['CASO REALE 9: solo <think> dopo il passaggio di sessione, nessuna azione',
    { stop_reason: 'end_turn', terminal_reason: 'completed', is_error: false, usage: { output_tokens: 41 } },
    ['<think> Il report dice che esiste `index.html` con 1.3 KB. Leggo solo le ultime 20 righe per vedere dove mi fermo e riprendo. </think>'],
    true, undefined, { output_tokens: 41 }],

  ['solo blocco di ragionamento nativo, senza testo ne strumenti',
    { stop_reason: 'end_turn', usage: { output_tokens: 60 } },
    [[{ kind: 'thinking', text: 'Devo creare style.css con lo scheletro.' }]], true, undefined, { output_tokens: 60 }],

  ['strumenti eseguiti, poi solo ragionamento finale',
    { stop_reason: 'end_turn', usage: { output_tokens: 700 } },
    [[{ kind: 'tool', toolId: 't1', name: 'Write', input: {} }], '<think>Ora aggiungo il CSS al file.</think>'],
    true, undefined, { output_tokens: 20 }],

  ['ragionamento rimasto aperto (risposta tagliata)',
    { stop_reason: 'end_turn', usage: { output_tokens: 90 } },
    ['<think>Devo creare il file principale e poi'], true, undefined, { output_tokens: 90 }],

  ['ragionamento seguito da una risposta visibile completa',
    { stop_reason: 'end_turn', usage: { output_tokens: 80 } },
    ['<think>Controllo il file.</think>\n\nHo creato il file index.html.'], false, undefined, { output_tokens: 80 }],

  ['solo </think> finale seguito da una risposta completa',
    { stop_reason: 'end_turn', usage: { output_tokens: 80 } },
    ['controllo il file</think>\n\nTutto pronto.'], false, undefined, { output_tokens: 80 }],

  ['ragionamento e strumento nello stesso messaggio: non e\' solo ragionamento',
    { stop_reason: 'end_turn', usage: { output_tokens: 300 } },
    [[{ kind: 'text', text: '<think>Scrivo il file.</think>' }, { kind: 'tool', toolId: 't2', name: 'Write', input: {} }]],
    false, undefined, { output_tokens: 300 }],

  ['testo normale senza ragionamento resta completo',
    { stop_reason: 'end_turn', usage: { output_tokens: 10 } },
    ['Fatto.'], false, undefined, { output_tokens: 10 }],

  ['turno completato vuoto viene ripreso automaticamente',
    { stop_reason: 'end_turn', terminal_reason: 'completed', usage: { output_tokens: 0 } },
    [''], true, undefined, { output_tokens: 0 }],

  ['strumenti eseguiti ma nessun testo finale viene ripreso',
    { stop_reason: 'end_turn', terminal_reason: 'completed', usage: { output_tokens: 80 } },
    [[{ kind: 'tool', toolId: 't3', name: 'Edit', input: { file_path: 'index.html' } }]],
    true, undefined, { output_tokens: 80 }],

  ['tool_use dichiarato completed senza testo viene ripreso',
    { stop_reason: 'tool_use', terminal_reason: 'completed', usage: { output_tokens: 80 } },
    [[{ kind: 'tool', toolId: 't4', name: 'Edit', input: { file_path: 'generate_cv.py' } }]],
    true, undefined, { output_tokens: 80 }],
];

let pass = 0, fail = 0;
cases.forEach(([name, data, texts, expected, userText, usageUltima]) => {
  turn(texts, userText);
  let ultima;
  if (usageUltima) {
    ultima = chatMessages[chatMessages.length - 1];
    ultima._streamUsage = usageUltima;
  }
  const reason = detectIncompleteTurn(data, ultima);
  const got = reason !== null;
  const ok = got === expected;
  ok ? pass++ : fail++;
  console.log((ok ? '  PASS  ' : '! FAIL  ') + name.padEnd(54) +
    ' atteso=' + (expected ? 'incompleto' : 'completo') +
    ' ottenuto=' + (got ? 'incompleto (' + reason + ')' : 'completo'));
});

const emptyTurnCases = [
  ['turno completato senza contenuto', { terminal_reason: 'completed' }, [''], true],
  ['ragionamento e strumenti senza testo finale', { terminal_reason: 'completed' },
    [[{ kind: 'thinking', text: 'Controllo il progetto.' }, { kind: 'tool', name: 'Read' }]], true],
  ['testo visibile dopo gli strumenti', { terminal_reason: 'completed' },
    [[{ kind: 'tool', name: 'Read' }], 'Ho controllato il progetto.'], false],
  ['errore API senza testo', { terminal_reason: 'api_error' }, [''], false]
];

emptyTurnCases.forEach(([name, data, texts, expected]) => {
  turn(texts);
  const got = turnoCompletatoSenzaTestoVisibile(data, currentTurnText());
  const ok = got === expected;
  ok ? pass++ : fail++;
  console.log((ok ? '  PASS  ' : '! FAIL  ') + name.padEnd(54) +
    ' atteso=' + (expected ? 'avviso' : 'nessun avviso') +
    ' ottenuto=' + (got ? 'avviso' : 'nessun avviso'));
});

console.log('\n' + pass + ' passati, ' + fail + ' falliti');
process.exit(fail ? 1 : 0);
