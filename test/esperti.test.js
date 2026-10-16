// Prova che lo Studio riconosca il tipo di progetto e dia ad Adam le regole giuste, e solo quelle:
// un gioco web non deve pagare nel prompt le regole di Blender, un progetto Unity non quelle di Python.
const fs = require('fs');
const os = require('os');
const path = require('path');
const esperti = require('../strumenti/esperti');

let pass = 0;
let fail = 0;
function check(nome, condizione, dettaglio) {
  if (condizione) { pass++; console.log('  ok   ' + nome); }
  else { fail++; console.log('  FAIL ' + nome + (dettaglio !== undefined ? '  -> ' + dettaglio : '')); }
}

const cartelle = [];
function progetto(file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prova-esperti-'));
  cartelle.push(dir);
  Object.keys(file).forEach(function (nome) {
    const completo = path.join(dir, nome);
    fs.mkdirSync(path.dirname(completo), { recursive: true });
    fs.writeFileSync(completo, file[nome]);
  });
  return dir;
}

console.log('\n=== App web per telefono (manifest) ===');
let dir = progetto({ 'index.html': '<meta name="viewport" content="width=device-width, initial-scale=1"><p>ciao</p>', 'manifest.json': '{"name":"App"}' });
let tipi = esperti.tipiDelProgetto(dir);
let testo = esperti.testoPerPrompt(dir);
check('riconosciuta come app web per telefono', tipi.web && tipi.telefonoWeb, JSON.stringify(tipi));
check('regole per telefono con il comando --telefono', testo.indexOf('SITO O APP WEB PER TELEFONO') !== -1 && testo.indexOf('--telefono') !== -1, testo);
check('niente regole di Unity, Blender o Python', testo.indexOf('UNITY') === -1 && testo.indexOf('BLENDER') === -1 && testo.indexOf('PYTHON') === -1, testo);

console.log('\n=== Pagina con il solo meta viewport (il gioco di Adam) ===');
dir = progetto({ 'index.html': '<meta name="viewport" content="width=device-width, initial-scale=1"><canvas></canvas>', 'js/main.js': 'console.log(1)' });
check('il meta viewport da solo non vuol dire app per telefono', esperti.tipiDelProgetto(dir).telefonoWeb === false);
check('riceve il workflow web ma non quello mobile', /INTERFACCIA WEB/.test(esperti.testoPerPrompt(dir)) &&
  !/SITO O APP WEB PER TELEFONO/.test(esperti.testoPerPrompt(dir)), esperti.testoPerPrompt(dir));

console.log('\n=== Python ===');
dir = progetto({ 'main.py': 'print("ciao")\n' });
testo = esperti.testoPerPrompt(dir);
check('regole di Python con la documentazione ufficiale', /PYTHON/.test(testo) && testo.indexOf('https://docs.python.org/') !== -1, testo);
check('niente regole di Blender', testo.indexOf('BLENDER') === -1, testo);

console.log('\n=== Python con interfaccia desktop ===');
dir = progetto({ 'main.py': 'from PySide6.QtWidgets import QApplication, QMainWindow\napp = QApplication([])\n' });
tipi = esperti.tipiDelProgetto(dir);
testo = esperti.testoPerPrompt(dir);
check('riconosce una GUI desktop dal toolkit', tipi.haInterfaccia && tipi.tipoInterfaccia === 'desktop', JSON.stringify(tipi));
check('chiede anteprima della finestra reale, non HTML', /INTERFACCIA DESKTOP NATIVA/.test(testo) && /non convertirla in HTML/.test(testo), testo);

console.log('\n=== Java backend senza GUI ===');
dir = progetto({ 'pom.xml': '<project></project>', 'src/Main.java': 'class Main { public static void main(String[] x) {} }' });
tipi = esperti.tipiDelProgetto(dir);
testo = esperti.testoPerPrompt(dir);
check('riconosce Java senza inventare una interfaccia', tipi.java && !tipi.haInterfaccia, JSON.stringify(tipi));
check('applica il workflow senza UI', /SENZA INTERFACCIA RILEVATA/.test(testo) && /Non inventare una GUI/.test(testo), testo);

console.log('\n=== Documento PDF ===');
dir = progetto({ 'curriculum.pdf': '%PDF-finto' });
tipi = esperti.tipiDelProgetto(dir);
testo = esperti.testoPerPrompt(dir);
check('riconosce un progetto editoriale', tipi.documento && tipi.tipoInterfaccia === 'documento', JSON.stringify(tipi));
check('richiede il rendering di tutte le pagine', /DOCUMENTO O PDF/.test(testo) && /renderizza tutte le pagine/.test(testo), testo);

console.log('\n=== Blender ===');
dir = progetto({ 'genera.py': 'import bpy\nbpy.ops.mesh.primitive_cube_add()\n' });
tipi = esperti.tipiDelProgetto(dir);
testo = esperti.testoPerPrompt(dir);
check('script con import bpy: progetto Blender', tipi.blender && tipi.python, JSON.stringify(tipi));
check('regole di Blender con la documentazione della versione e --blender', /BLENDER \d/.test(testo) && /https:\/\/docs\.blender\.org\/api\/\d+\.\d+\//.test(testo) && testo.indexOf('--blender') !== -1, testo);
check('le regole di Python generiche non si ripetono', testo.indexOf('\nPYTHON') === -1, testo);
dir = progetto({ 'modelli/casa.blend': 'finto' });
check('un file .blend basta a riconoscere Blender', esperti.tipiDelProgetto(dir).blender === true);

console.log('\n=== Unity con Android ===');
dir = progetto({
  'ProjectSettings/ProjectVersion.txt': 'm_EditorVersion: 6000.2.2f1\n',
  'ProjectSettings/ProjectSettings.asset': 'PlayerSettings:\n  applicationIdentifier:\n    Android: com.nome.gioco\n  AndroidMinSdkVersion: 23\n',
  'Assets/Scripts/Giocatore.cs': 'using UnityEngine;\npublic class Giocatore : MonoBehaviour {}\n',
  'Assets/Strumenti/converti.py': 'print(1)\n'
});
tipi = esperti.tipiDelProgetto(dir);
testo = esperti.testoPerPrompt(dir);
check('riconosciuto Unity con Android e versione', tipi.unity && tipi.android && tipi.versioni.unity === '6000.2.2f1', JSON.stringify(tipi));
check('regole di Unity con la documentazione della versione 6000.2', testo.indexOf('UNITY 6000.2.2f1') !== -1 &&
  testo.indexOf('https://docs.unity3d.com/6000.2/Documentation/ScriptReference/') !== -1, testo);
check('regole per le app Android', testo.indexOf('APP PER TELEFONO (Android con Unity)') !== -1 && testo.indexOf('adb logcat') !== -1, testo);
check('un .py dentro Assets non aggiunge le regole di Python', testo.indexOf('PYTHON') === -1, testo);
check('prompt contenuto (sotto i 2600 caratteri)', testo.length < 2600, testo.length);

console.log('\n=== Unity senza Android e cartella vuota ===');
dir = progetto({ 'ProjectSettings/ProjectVersion.txt': 'm_EditorVersion: 2022.3.10f1\n', 'Assets/a.cs': 'class A {}' });
testo = esperti.testoPerPrompt(dir);
check('versione 2022.3 nell\'indirizzo della documentazione', testo.indexOf('https://docs.unity3d.com/2022.3/Documentation/') !== -1, testo);
check('niente regole Android senza impostazioni Android', testo.indexOf('APP PER TELEFONO') === -1, testo);
dir = progetto({});
check('cartella vuota: nessuna regola', esperti.testoPerPrompt(dir) === '');

cartelle.forEach(function (d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} });
console.log('\n' + '='.repeat(50));
console.log('COMPETENZE: ' + pass + ' passati, ' + fail + ' falliti');
process.exit(fail ? 1 : 0);
