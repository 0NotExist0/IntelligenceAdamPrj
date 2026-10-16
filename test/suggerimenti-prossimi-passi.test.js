const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const suggerimenti = require('../strumenti/suggerimenti-prossimi-passi');

console.log('=== TEST SUGGERIMENTI E AZIONI RAPIDE FLUSSO ===');

// 1. Estrazione punti numerati
console.log('\n--- Estrazione Punti Numerati ---');
const testoAdamScreenshot = `
Ho completato il PASSO 1 usando Grep senza leggere file interi.

Risultati:
- Non esiste ancora un componente FPS o multiplayer nel progetto.
- Packages/manifest.json:8 contiene solo com.unity.multiplayer.center; manca com.unity.netcode.gameobjects.
- La scena attiva è Assets/Scenes/SampleScene.unity
- Il punto giusto da modificare è quindi:
1. aggiungere Netcode for GameObjects al manifest;
2. creare gli script del player FPS e del manager di rete;
3. creare il prefab player con NetworkObject;
4. collegare il prefab al NetworkManager nella scena.

PASSO FATTO: individuato il punto di ingresso per aggiungere Netcode e il player FPS multiplayer.
`;

const punti = suggerimenti.estraiPuntiNumerati(testoAdamScreenshot);
assert.strictEqual(punti.length, 4, 'Deve estrarre esattamente 4 punti numerati');
assert.strictEqual(punti[0].num, 1);
assert.ok(punti[0].testo.includes('Netcode for GameObjects'));
assert.strictEqual(punti[1].num, 2);
assert.ok(punti[1].testo.includes('script del player FPS'));
console.log('  ok   estrazione accurata dei 4 punti da testo reale');

// 2. Generazione azioni nello scenario dello screenshot dell'utente
console.log('\n--- Generazione Azioni da Scenario Reale ---');
const tmpUnityDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-test-actions-'));
try {
  fs.mkdirSync(path.join(tmpUnityDir, 'Assets'));
  fs.mkdirSync(path.join(tmpUnityDir, 'ProjectSettings'));

  const pianoMock = {
    compito: "creami un fps multiplayer con netcode semplicissimo",
    corrente: 1,
    finito: false,
    passi: [
      { testo: "individuare il punto di ingresso", stato: "fatto" },
      { testo: "fare la modifica: creami un fps multiplayer con netcode semplicissimo", stato: "in corso" },
      { testo: "verificare il gioco", stato: "da fare" }
    ]
  };

  const azioni = suggerimenti.generaAzioniRapide({
    projectDir: tmpUnityDir,
    lastTurnText: testoAdamScreenshot,
    piano: pianoMock,
    lastSystemMessage: "Passo fatto: individuato il punto... Adesso il passo 2 di 3"
  });

  assert.ok(azioni.length >= 4, 'Devono essere generate almeno 4 azioni');

  // Azione primaria: Passo 2
  const actPasso2 = azioni.find(a => a.id === 'act_prossimo_passo');
  assert.ok(actPasso2, 'Azione passo 2 deve esistere');
  assert.ok(actPasso2.titolo.includes('Passo 2/3'));
  assert.ok(actPasso2.prompt.includes('Unity 6 URP'));
  assert.strictEqual(actPasso2.tipo, 'primary');

  // Azione gruppo: Esegui tutti i 4 punti
  const actTutti = azioni.find(a => a.id === 'act_esegui_tutti_punti');
  assert.ok(actTutti, 'Azione esegui tutti i punti deve esistere');
  assert.ok(actTutti.titolo.includes('tutti i 4 punti'));
  assert.ok(actTutti.prompt.includes('1. aggiungere Netcode'));
  assert.ok(actTutti.prompt.includes('2. creare gli script'));

  // Singoli punti proposti
  const actPunto1 = azioni.find(a => a.id === 'act_punto_1');
  assert.ok(actPunto1, 'Azione punto 1 deve esistere');
  assert.ok(actPunto1.prompt.includes('Netcode for GameObjects'));

  // Documentazione Unity Netcode
  const actDoc = azioni.find(a => a.id === 'act_doc_netcode');
  assert.ok(actDoc, 'Azione documentazione Netcode deve essere inclusa per Unity');
  assert.ok(actDoc.prompt.includes('learn.unity.com'));

  console.log('  ok   azione passo 2 generata');
  console.log('  ok   azione esegui tutti i punti generata');
  console.log('  ok   sottopunti estratti e inclusi');
  console.log('  ok   riferimento Unity Learn incluso');
} finally {
  fs.rmSync(tmpUnityDir, { recursive: true, force: true });
}

// 3. Scenario Errori di Verifica
console.log('\n--- Scenario Errori di Verifica ---');
const azioniErr = suggerimenti.generaAzioniRapide({
  failures: [{ file: 'Assets/Scripts/Player.cs', error: 'Sintassi errata riga 12' }]
});
assert.strictEqual(azioniErr[0].id, 'act_fix_errors');
assert.ok(azioniErr[0].titolo.includes('Correggi 1 errore'));
console.log('  ok   priorità data a correzione errori se presenti');

console.log('\n==================================================');
console.log('TEST SUGGERIMENTI E AZIONI RAPIDE: TUTTI I TEST PASSATI!');
