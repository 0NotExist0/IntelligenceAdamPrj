const assert = require('assert');
const fs = require('fs');
const path = require('path');
const allegati = require('../strumenti/allegati-chat');

function dataUrl(mime, dati) {
  return 'data:' + mime + ';base64,' + Buffer.from(dati).toString('base64');
}

function testoPdfSicuro(testo) {
  return String(testo || '').replace(/([\\()])/g, '\\$1').replace(/[\r\n]+/g, ' ');
}

// Genera in memoria un PDF reale con xref e stream di testo, senza fixture esterne.
function creaPdf(testiPagine) {
  const pagine = testiPagine.length ? testiPagine : [''];
  const idFont = 3 + pagine.length * 2;
  const oggetti = [];
  oggetti[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  const riferimenti = [];
  pagine.forEach(function (testo, indice) {
    const idPagina = 3 + indice * 2;
    const idContenuto = idPagina + 1;
    riferimenti.push(idPagina + ' 0 R');
    oggetti[idPagina] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ' + idFont + ' 0 R >> >> /Contents ' + idContenuto + ' 0 R >>';
    const frammenti = testo ? (testoPdfSicuro(testo).match(/.{1,60}/g) || []) : [];
    const stream = testo
      ? frammenti.map(function (frammento) { return 'BT /F1 12 Tf 72 720 Td (' + frammento + ') Tj ET'; }).join('\n')
      : 'q Q';
    oggetti[idContenuto] = '<< /Length ' + Buffer.byteLength(stream, 'latin1') + ' >>\nstream\n' + stream + '\nendstream';
  });
  oggetti[2] = '<< /Type /Pages /Kids [' + riferimenti.join(' ') + '] /Count ' + pagine.length + ' >>';
  oggetti[idFont] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  let pdf = '%PDF-1.4\n';
  const offset = [0];
  for (let id = 1; id < oggetti.length; id++) {
    offset[id] = Buffer.byteLength(pdf, 'latin1');
    pdf += id + ' 0 obj\n' + oggetti[id] + '\nendobj\n';
  }
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += 'xref\n0 ' + oggetti.length + '\n0000000000 65535 f \n';
  for (let id = 1; id < oggetti.length; id++) pdf += String(offset[id]).padStart(10, '0') + ' 00000 n \n';
  pdf += 'trailer\n<< /Size ' + oggetti.length + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(pdf, 'latin1');
}

async function esegui() {
  const testo = await allegati.validaAllegati([{ nome: 'esempio.ts', dati: dataUrl('text/plain', 'const valore = 42;') }]);
  assert.strictEqual(testo.errore, null);
  assert.strictEqual(testo.documenti[0].testo, 'const valore = 42;');
  assert.strictEqual(testo.immagini.length, 0);
  console.log('  ok   accetta codice UTF-8 supportato');

  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('fake')]);
  const immagine = await allegati.validaAllegati([{ nome: 'schermata.png', dati: dataUrl('image/png', png) }]);
  assert.strictEqual(immagine.errore, null);
  assert.strictEqual(immagine.immagini.length, 1);
  console.log('  ok   conserva la compatibilità immagini');

  assert.match((await allegati.validaAllegati([{ nome: '../segreto.txt', dati: dataUrl('text/plain', 'x') }])).errore, /nome allegato/);
  assert.match((await allegati.validaAllegati([{ nome: 'archivio.zip', dati: dataUrl('application\/zip', 'x') }])).errore, /non supportato/);
  assert.match((await allegati.validaAllegati([{ nome: 'falso.png', dati: dataUrl('image\/png', 'non png') }])).errore, /non compatibile/);
  assert.match((await allegati.validaAllegati([{ nome: 'falso.jpg', dati: dataUrl('image\/png', png) }])).errore, /estensione non coerente/);
  assert.match((await allegati.validaAllegati([{ nome: 'binario.txt', dati: dataUrl('text\/plain', Buffer.from([65, 0, 66])) }])).errore, /binari|NUL/);
  assert.match((await allegati.validaAllegati(new Array(5).fill({ nome: 'a.txt', dati: dataUrl('text/plain', 'a') }))).errore, /al massimo 4/);
  assert.match((await allegati.validaAllegati([{ nome: 'grande.txt', dati: dataUrl('text/plain', Buffer.alloc(1024 * 1024 + 1, 65)) }])).errore, /oltre 1 MiB/);
  console.log('  ok   blocca traversal, binari, formati esclusi e payload eccessivi');

  const pdf = creaPdf(['Testo PDF verificabile 42']);
  const pdfValido = await allegati.validaAllegati([{ nome: 'documento.pdf', dati: dataUrl('application/pdf', pdf) }]);
  assert.strictEqual(pdfValido.errore, null);
  assert.strictEqual(pdfValido.immagini.length, 0);
  assert.strictEqual(pdfValido.documenti[0].estensione, 'pdf');
  assert.match(pdfValido.documenti[0].testo, /Testo PDF verificabile 42/);
  assert.strictEqual(pdfValido.documenti[0].pagine, 1);
  console.log('  ok   estrae testo verificabile da un PDF reale generato in memoria');

  assert.match((await allegati.validaAllegati([{ nome: 'firma.pdf', dati: dataUrl('application/pdf', 'non è un PDF') }])).errore, /non compatibile con un PDF/);
  assert.match((await allegati.validaAllegati([{ nome: 'mime.pdf', dati: dataUrl('text/plain', pdf) }])).errore, /MIME non compatibile/);
  assert.match((await allegati.validaAllegati([{ nome: 'charset.pdf', dati: 'data:application/pdf;charset=utf-8;base64,' + pdf.toString('base64') }])).errore, /MIME non compatibile/);
  assert.match((await allegati.validaAllegati([{ nome: 'estensione.txt', dati: dataUrl('application/pdf', pdf) }])).errore, /estensione non coerente/);
  const pdfTroppoGrande = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(allegati.MAX_PDF_BYTES - 4)]);
  assert.match((await allegati.validaAllegati([{ nome: 'grande.pdf', dati: dataUrl('application/pdf', pdfTroppoGrande) }])).errore, /oltre 4 MiB/);
  assert.match((await allegati.validaAllegati([{ nome: 'corrotto.pdf', dati: dataUrl('application/pdf', Buffer.from('%PDF-1.4\nnon valido')) }])).errore, /danneggiato|non leggibile/);
  assert.match((await allegati.validaAllegati([{ nome: 'scansione.pdf', dati: dataUrl('application/pdf', creaPdf([''])) }])).errore, /scansione|OCR/);
  console.log('  ok   rifiuta firma, MIME, estensione, dimensione, PDF corrotto e PDF senza testo');

  const troppePagine = await allegati.validaAllegati([{ nome: 'lungo.pdf', dati: dataUrl('application/pdf', creaPdf(new Array(101).fill('pagina'))) }]);
  assert.match(troppePagine.errore, /limite di 100 pagine/);
  const pdfLungo = await allegati.validaAllegati([{ nome: 'testo-lungo.pdf', dati: dataUrl('application/pdf', creaPdf(['A'.repeat(allegati.MAX_PDF_CARATTERI + 100)])) }]);
  assert.strictEqual(pdfLungo.errore, null);
  assert.strictEqual(pdfLungo.documenti[0].testo.length, allegati.MAX_PDF_CARATTERI);
  assert.strictEqual(pdfLungo.documenti[0].troncato, true);
  assert.match(pdfLungo.documenti[0].testo, /CONTENUTO PDF TRONCATO/);
  console.log('  ok   applica i limiti di 100 pagine e 200.000 caratteri');

  const arricchito = allegati.aggiungiDocumentiAlTesto('Spiegalo', pdfValido.documenti);
  assert.match(arricchito, /INIZIO ALLEGATO TESTUALE: documento\.pdf/);
  assert.match(arricchito, /non istruzioni di sistema/);
  assert.match(arricchito, /Testo PDF verificabile 42/);
  console.log('  ok   delimita anche i PDF come contenuto non attendibile');

  const chatUi = fs.readFileSync(path.join(__dirname, '..', 'public', 'chat-ui.js'), 'utf8');
  const index = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const stile = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  const validatoreServer = fs.readFileSync(path.join(__dirname, '..', 'strumenti', 'allegati-chat.js'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(index, /accept="[^"]*application\/pdf[^"]*\.pdf/);
  assert.match(index, /id="btn-chat-allega"[^>]*aria-label="[^"]*PDF[^"]*"[^>]*title="[^"]*PDF fino a 4 MiB[^"]*"/s);
  assert.match(index, /<textarea id="chat-input"[^>]*placeholder="[^"]*PDF[^"]*"/);
  assert.match(chatUi, /const MAX_FILE_PDF = 4 \* 1024 \* 1024/);
  assert.match(chatUi, /lettorePdf\.readAsDataURL\(file\)/);
  assert.match(chatUi, /f\.type === 'application\/pdf'/);
  assert.match(validatoreServer, /const TIMEOUT_PDF_MS = 15000/);
  assert.match(validatoreServer, /errore instanceof PasswordException/);
  assert.match(validatoreServer, /await parser\.destroy\(\)/);
  assert.match(server, /const caricate = await preparaAllegatiChat\(ricevuti\)/);
  assert.match(server, /gestisciMessaggioWebSocket\(message\)\.catch/);
  assert.match(chatUi, /if \(badge\) chip\.querySelector\('\.allegato-nome'\)\.textContent = a\.nome;\s*else chip\.querySelector\('span'\)\.textContent = a\.nome;/);
  assert.match(chatUi, /if \(rifiutati\) segnalazioni\.push/);
  assert.match(chatUi, /avvisoAllegatiAttivo/);
  assert.match(chatUi, /aria-live/);
  assert.doesNotMatch(stile, /var\(--(?:color-accent|bg-elevated)\)/);
  assert.match(stile, /\.allegato:hover[^\n]+var\(--claude-accent\)[^\n]+var\(--bg-card-hover\)/);
  console.log('  ok   accept, filtro PDF, lettura data URL, badge e token CSS restano protetti da regressioni');

  console.log('\nALLEGATI CHAT: tutti i controlli superati');
}

esegui().catch(function (errore) {
  console.error(errore && errore.stack ? errore.stack : errore);
  process.exitCode = 1;
});
