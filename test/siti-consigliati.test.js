// Prova la gestione dei siti consigliati e lo strumento di ricerca web per Adam
const fs = require('fs');
const os = require('os');
const path = require('path');
const sc = require('../strumenti/siti-consigliati');
const rw = require('../strumenti/ricerca-web');

let pass = 0;
let fail = 0;
function check(nome, condizione, dettaglio) {
  if (condizione) { pass++; console.log('  ok   ' + nome); }
  else { fail++; console.log('  FAIL ' + nome + (dettaglio !== undefined ? '  -> ' + dettaglio : '')); }
}

console.log('\n=== Normalizzazione e validazione URL ===');
check('aggiunge https se manca', sc.normalizzaUrl('developer.mozilla.org').startsWith('https://developer.mozilla.org'));
check('mantiene http esistente', sc.normalizzaUrl('http://localhost:3000').startsWith('http://localhost:3000'));
check('url non valido scartato', sc.normalizzaUrl('ciao') === '');
check('stringa vuota scartata', sc.normalizzaUrl('') === '');

const vValido = sc.validaSito({ url: 'https://github.com/foo/bar', descrizione: 'Repository utile' });
check('sito valido accettato', !!(vValido.sito && vValido.sito.url === 'https://github.com/foo/bar' && vValido.sito.descrizione === 'Repository utile'));
check('assegnazione id univoco', typeof vValido.sito.id === 'string' && vValido.sito.id.startsWith('site_'));

const vNonValido = sc.validaSito({ url: 'invalido' });
check('url invalido rifiutato con errore', !!(vNonValido.errore && /non valido/i.test(vNonValido.errore)));

const descLunga = 'a'.repeat(400);
const vTroncato = sc.validaSito({ url: 'https://test.com', descrizione: descLunga });
check('descrizione troppo lunga viene troncata', vTroncato.sito.descrizione.length === 300);

console.log('\n=== Conservazione su disco (carica, salva, aggiungi, rimuovi) ===');
const dirTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'prova-siti-'));
const fileTemp = path.join(dirTemp, 'siti-consigliati.json');

check('file inesistente = lista vuota', sc.carica(fileTemp).siti.length === 0);

const agg1 = sc.aggiungi({ url: 'https://developer.mozilla.org', descrizione: 'Guida MDN Web Docs' }, fileTemp);
check('aggiungi primo sito', agg1.ok === true && agg1.totale === 1);
check('carica conferma il primo sito', sc.carica(fileTemp).siti.length === 1 && sc.carica(fileTemp).siti[0].descrizione === 'Guida MDN Web Docs');

const agg2 = sc.aggiungi({ url: 'https://nodejs.org/docs', descrizione: 'Doc Node.js' }, fileTemp);
check('aggiungi secondo sito', agg2.ok === true && agg2.totale === 2);

// Aggiornamento stesso URL (deduplicazione)
const aggDuplicato = sc.aggiungi({ url: 'https://developer.mozilla.org', descrizione: 'MDN Web Docs Aggiornato' }, fileTemp);
check('stesso URL aggiorna senza duplicare', aggDuplicato.ok === true && aggDuplicato.totale === 2);
check('descrizione aggiornata', sc.carica(fileTemp).siti.find(s => s.url.includes('mozilla')).descrizione === 'MDN Web Docs Aggiornato');

// Rimozione
const idDaRimuovere = agg2.sito.id;
const rim1 = sc.rimuovi(idDaRimuovere, fileTemp);
check('rimozione sito esistente', rim1.ok === true && rim1.totale === 1);
check('sito rimosso non piu presente', !sc.carica(fileTemp).siti.some(s => s.id === idDaRimuovere));

const rimInesistente = sc.rimuovi('id_falso', fileTemp);
check('rimozione id inesistente fallisce', !!(rimInesistente.errore));

console.log('\n=== Testo per il Prompt di Adam ===');
const promptVuoto = sc.testoPerPrompt(path.join(dirTemp, 'inesistente.json'));
check('nessun sito = prompt vuoto', promptVuoto === '');

const promptConSiti = sc.testoPerPrompt(fileTemp);
check('include intestazione fonti web', /SITI E FONTI WEB CONSIGLIATI DALL'UTENTE/.test(promptConSiti));
check('include url mdn', /developer\.mozilla\.org/.test(promptConSiti));
check('include spiegazione d\'uso', /cercare sul web con lo strumento Bash/.test(promptConSiti));

fs.rmSync(dirTemp, { recursive: true, force: true });

console.log('\n=== Strumento CLI ricerca-web.js ===');
const arg1 = rw.leggiArgomenti(['--cerca', 'three.js']);
check('argomento --cerca riconosciuto', arg1.cerca === 'three.js');

const arg2 = rw.leggiArgomenti(['https://threejs.org']);
check('url senza flag diventa --visita', arg2.visita === 'https://threejs.org');

const arg3 = rw.leggiArgomenti(['--siti']);
check('flag --siti riconosciuto', arg3.siti === true);

const arg4 = rw.leggiArgomenti(['--deep', 'react hooks', '--max', '8']);
check('flag --deep e --max', arg4.deep === 'react hooks' && arg4.max === 8);

const htmlEsempio = '<html><head><title>Esempio Pagina</title><style>body{color:red}</style></head><body><header>Nav</header><p>Testo &amp; contenuto <strong>importante</strong>.</p><script>console.log(1);</script></body></html>';
const testoEstratto = rw.estraiTestoDaHtml(htmlEsempio);
check('estrazione testo pulita', /Testo & contenuto importante/.test(testoEstratto));
check('script rimosso dal testo', !/console\.log/.test(testoEstratto));
check('style rimosso dal testo', !/color:red/.test(testoEstratto));

const titoloEstratto = rw.estraiTitoloDaHtml(htmlEsempio);
check('estrazione titolo corretta', titoloEstratto === 'Esempio Pagina');

console.log('\n' + '='.repeat(50));
console.log('SITI CONSIGLIATI E RICERCA WEB: ' + pass + ' passati, ' + fail + ' falliti');
process.exit(fail ? 1 : 0);
