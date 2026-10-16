// Prova la gestione della documentazione e fonti per Adam (URL, PDF, immagini, file locali)
// e le regole specifiche per Unity (learn.unity.com, Unity 6, avviso prima di ricerca autonoma).

const fs = require('fs');
const os = require('os');
const path = require('path');
const doc = require('../strumenti/documentazione');
const rw = require('../strumenti/ricerca-web');

let pass = 0;
let fail = 0;
function check(nome, condizione, dettaglio) {
  if (condizione) {
    pass++;
    console.log('  ok   ' + nome);
  } else {
    fail++;
    console.log('  FAIL ' + nome + (dettaglio !== undefined ? '  -> ' + dettaglio : ''));
  }
}

console.log('\n=== Rilevamento Tipi e Normalizzazione ===');
check('rileva url http', doc.rilevaTipo('http://example.com') === 'url');
check('rileva url https', doc.rilevaTipo('https://learn.unity.com') === 'url');
check('rileva pdf', doc.rilevaTipo('specifiche_gioco.pdf') === 'pdf');
check('rileva immagine png', doc.rilevaTipo('screenshot.png') === 'immagine');
check('rileva immagine jpg', doc.rilevaTipo('design.jpg') === 'immagine');
check('rileva file csharp', doc.rilevaTipo('PlayerController.cs') === 'testo');
check('rileva file testo', doc.rilevaTipo('appunti.txt') === 'testo');
check('rileva file generico', doc.rilevaTipo('archivio.bin') === 'file');

console.log('\n=== Inizializzazione e Fonte Primaria Unity ===');
const dirTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'prova-doc-'));
const fileTemp = path.join(dirTemp, 'documentazione.json');

const init = doc.carica(fileTemp);
check('file creato automaticamente', fs.existsSync(fileTemp));
check('fonte primaria Unity impostata', init.fontePrimariaUnity === 'https://learn.unity.com/');
check('documento iniziale Unity Learn presente', init.documenti.length === 1 && init.documenti[0].primario === true);
check('origine iniziale learn.unity.com', init.documenti[0].origine === 'https://learn.unity.com/');

console.log('\n=== Aggiunta e Aggiornamento URL ===');
const resUrl1 = doc.aggiungiUrl({
  url: 'https://docs.unity.com/6000.0/Documentation/Manual/',
  nome: 'Unity 6 Manual',
  descrizione: 'Manuale ufficiale Unity 6'
}, fileTemp);
check('aggiunta url valida', resUrl1.ok === true && resUrl1.totale === 2);
check('ambito dedotto come unity', resUrl1.documento.ambito === 'unity');

const resUrlDup = doc.aggiungiUrl({
  url: 'https://docs.unity.com/6000.0/Documentation/Manual/',
  nome: 'Unity 6 Manual Aggiornato',
  descrizione: 'Nuove note Unity 6'
}, fileTemp);
check('stesso url aggiorna senza duplicare', resUrlDup.ok === true && resUrlDup.totale === 2);
check('nome aggiornato', doc.carica(fileTemp).documenti.find(d => d.origine.includes('6000.0')).nome === 'Unity 6 Manual Aggiornato');

console.log('\n=== Aggiunta File (buffer / payload) ===');
const fileTestoContenuto = 'Specifiche di Gioco Unity: Movimento con New Input System.';
const bufferFile = Buffer.from(fileTestoContenuto, 'utf8');

const resFile1 = doc.aggiungiFile('specifiche_unity.txt', bufferFile, 'Documento requisiti movimento', fileTemp);
check('aggiunta file riuscita', resFile1.ok === true && resFile1.totale === 3);
check('tipo riconosciuto testo', resFile1.documento.tipo === 'testo');
check('file scritto su disco', fs.existsSync(resFile1.documento.origine));

const resPayloadBase64 = doc.aggiungiDaPayload({
  nome: 'schema_architettura.png',
  base64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  descrizione: 'Diagramma UML classi di gioco'
}, fileTemp);
check('aggiunta da payload base64 riuscita', resPayloadBase64.ok === true && resPayloadBase64.totale === 4);
check('tipo immagine riconosciuto', resPayloadBase64.documento.tipo === 'immagine');

console.log('\n=== Rimozione Documenti e Pulizia Disco ===');
const discoPath = resFile1.documento.origine;
const idDaRimuovere = resFile1.documento.id;
const resRimozione = doc.rimuovi(idDaRimuovere, fileTemp);
check('rimozione eseguita', resRimozione.ok === true && resRimozione.totale === 3);
check('file eliminato fisicamente dal disco', !fs.existsSync(discoPath));

const resRimozioneInvalida = doc.rimuovi('id_inesistente', fileTemp);
check('id inesistente restituisce errore', !!resRimozioneInvalida.errore);

console.log('\n=== Generazione Testo per Prompt di Adam ===');
// 1. Progetto non-Unity
const dirNonUnity = path.join(dirTemp, 'progetto-web');
fs.mkdirSync(dirNonUnity, { recursive: true });
const promptNonUnity = doc.testoPerPrompt(dirNonUnity, fileTemp);
check('include intestazione fonti', promptNonUnity.includes('PANNELLO DOCUMENTAZIONE E FONTI'));
check('non include regole unity se non è unity', !promptNonUnity.includes('REGOLE TASSATIVE PER LO SVILUPPO SU UNITY'));
check('elenca documenti configurati', promptNonUnity.includes('Unity 6 Manual Aggiornato'));

// 2. Progetto Unity (Assets + ProjectSettings)
const dirUnity = path.join(dirTemp, 'progetto-unity');
fs.mkdirSync(path.join(dirUnity, 'Assets'), { recursive: true });
fs.mkdirSync(path.join(dirUnity, 'ProjectSettings'), { recursive: true });
fs.writeFileSync(path.join(dirUnity, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 6000.0.1f1');

const promptUnity = doc.testoPerPrompt(dirUnity, fileTemp);
check('include regole tassative Unity', promptUnity.includes('REGOLE TASSATIVE PER LO SVILUPPO SU UNITY'));
check('indica fonte primaria obbligatoria https://learn.unity.com/', promptUnity.includes('https://learn.unity.com/'));
check('menziona verifica Unity 6 e metodi deprecati', promptUnity.includes('Unity 6') && promptUnity.includes('FindFirstObjectByType'));
check('obbliga a comunicare trasparenza all\'utente prima di ricerca autonoma',
  promptUnity.includes('non sono state trovate su https://learn.unity.com/') &&
  promptUnity.includes('DEVI COMUNICARLO ESPLICITAMENTE ALL\'UTENTE prima di procedere')
);

console.log('\n=== Integrazione CLI Ricerca Web per Documentazione ===');
const argsDoc = rw.leggiArgomenti(['--doc']);
check('riconosce flag --doc', argsDoc.doc === true);

const fileLocale = path.join(dirTemp, 'guida.txt');
fs.writeFileSync(fileLocale, 'Questa è una guida locale di test per Adam.');

rw.eseguiVisita(fileLocale).then(function (resVisita) {
  check('eseguiVisita legge file locale', resVisita.titolo.includes('guida.txt') && resVisita.testo.includes('guida locale di test'));

  // Pulizia finale
  try {
    const statoRimanente = doc.carica(fileTemp);
    statoRimanente.documenti.forEach(d => {
      if (d.tipo !== 'url' && d.origine && fs.existsSync(d.origine)) {
        try { fs.unlinkSync(d.origine); } catch (e) {}
      }
    });
    fs.rmSync(dirTemp, { recursive: true, force: true });
  } catch (e) {}

  console.log('\n' + '='.repeat(50));
  console.log('TEST DOCUMENTAZIONE ADAM: ' + pass + ' passati, ' + fail + ' falliti');
  process.exit(fail ? 1 : 0);
}).catch(function (err) {
  console.error('Errore eseguiVisita file locale:', err);
  process.exit(1);
});
