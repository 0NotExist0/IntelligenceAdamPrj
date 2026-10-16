const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const apprendimento = require('../strumenti/apprendimento-memoria');

console.log('=== TEST APPRENDIMENTO MEMORIA & NEURONI PROGETTO ===');

// 1. Riconoscimento file di codice
console.log('\n--- Riconoscimento File di Codice ---');
assert.strictEqual(apprendimento.eFileDiCodiceRilevante('Assets/Scripts/Player.cs'), true, 'Script C# deve essere rilevato');
assert.strictEqual(apprendimento.eFileDiCodiceRilevante('Assets/Scripts/Player.cs.meta'), false, 'File .meta Unity deve essere ignorato');
assert.strictEqual(apprendimento.eFileDiCodiceRilevante('js/game.js'), true, 'File JS deve essere rilevato');
assert.strictEqual(apprendimento.eFileDiCodiceRilevante('node_modules/express/index.js'), false, 'node_modules deve essere escluso');
assert.strictEqual(apprendimento.eFileDiCodiceRilevante('Library/PackageCache/file.cs'), false, 'Unity Library deve essere esclusa');
assert.strictEqual(apprendimento.eFileDiCodiceRilevante('main.py'), true, 'Python deve essere rilevato');
console.log('  ok   filtro file ed estensioni');

// 2. Analisi contenuto C# Unity
console.log('\n--- Analisi C# Unity MonoBehaviour ---');
const csharpCode = `
using System.Collections;
using UnityEngine;

namespace MyGame.Player
{
    public class PlayerController : MonoBehaviour
    {
        [SerializeField] private float speed = 5.0f;
        public int health = 100;

        void Start()
        {
            Debug.Log("Player ready");
        }

        void Update()
        {
            Move();
        }

        public void TakeDamage(int dmg)
        {
            health -= dmg;
        }
    }
}
`;

const infoCs = apprendimento.analizzaContenutoCodice('Assets/Scripts/PlayerController.cs', csharpCode);
assert.strictEqual(infoCs.eMonoBehaviour, true, 'Deve identificare MonoBehaviour');
assert.ok(infoCs.label.includes('PlayerController'), 'Label deve contenere il nome della classe');
assert.ok(infoCs.tags.includes('unity'), 'Tag unity deve essere presente');
assert.ok(infoCs.metodi.includes('Start'), 'Metodo Start deve essere estratto');
assert.ok(infoCs.metodi.includes('Update'), 'Metodo Update deve essere estratto');
assert.ok(infoCs.metodi.includes('TakeDamage'), 'Metodo personalizzato TakeDamage deve essere estratto');
assert.ok(infoCs.campi.includes('speed'), 'Campo serializzato speed deve essere estratto');
console.log('  ok   analisi accurata C# MonoBehaviour');

// 3. Analisi contenuto JS
console.log('\n--- Analisi JavaScript ---');
const jsCode = `
const path = require('path');

class GameEngine {
    constructor() {
        this.running = false;
    }
    
    start() {
        this.running = true;
    }
}

function calcolaPunteggio(punti) {
    return punti * 2;
}

module.exports = { GameEngine, calcolaPunteggio };
`;

const infoJs = apprendimento.analizzaContenutoCodice('js/engine.js', jsCode);
assert.ok(infoJs.classi.includes('GameEngine'), 'Classe JS identificata');
assert.ok(infoJs.metodi.includes('calcolaPunteggio'), 'Funzione JS identificata');
assert.ok(infoJs.tags.includes('js'), 'Tag js presente');
console.log('  ok   analisi accurata JS');

// 4. Creazione, Aggiornamento e Incremento Neuroni nel Progetto
console.log('\n--- Generazione e Incremento Dinamico Neuroni ---');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adam-test-mem-'));
try {
  // Scrivi due file fittizi nella cartella temporanea
  const scriptPath = path.join(tmpDir, 'Assets', 'Scripts');
  fs.mkdirSync(scriptPath, { recursive: true });
  fs.writeFileSync(path.join(scriptPath, 'Player.cs'), csharpCode, 'utf8');
  fs.writeFileSync(path.join(tmpDir, 'server.js'), jsCode, 'utf8');

  // Prima chiamata: aggiorna neuroni con Player.cs
  const ris1 = apprendimento.aggiornaNeuroniDaFileModificati(tmpDir, ['Assets/Scripts/Player.cs'], { passo: 'Creazione PlayerController' });
  assert.ok(ris1.modificati >= 1, 'Almeno 1 neurone modificato');
  const mem1 = apprendimento.caricaMemoriaProgettoLocale(tmpDir);
  const nodiIniziali = mem1.nodes.length;
  assert.ok(nodiIniziali >= 4, 'Ci devono essere i nodi iniziali + Player.cs + step');
  const nodoPlayer = mem1.nodes.find(n => n.label.includes('PlayerController'));
  assert.ok(nodoPlayer, 'Nodo PlayerController deve esistere');
  assert.strictEqual(nodoPlayer.scope, 'project', 'Scope deve essere rigorosamente project');

  // Seconda chiamata: Adam programma e aggiunge server.js -> I NEURONI DEVONO SALIRE!
  const ris2 = apprendimento.aggiornaNeuroniDaFileModificati(tmpDir, ['server.js'], { passo: 'Aggiunto server.js' });
  const mem2 = apprendimento.caricaMemoriaProgettoLocale(tmpDir);
  assert.ok(mem2.nodes.length > nodiIniziali, `Il conteggio neuroni deve salire! (Prima: ${nodiIniziali}, Ora: ${mem2.nodes.length})`);
  const nodoServer = mem2.nodes.find(n => n.id.includes('server_js'));
  assert.ok(nodoServer, 'Nodo server.js deve esistere');

  // Modifica dello stesso file: non deve duplicare, ma aggiornare
  const ris3 = apprendimento.aggiornaNeuroniDaFileModificati(tmpDir, ['server.js']);
  const mem3 = apprendimento.caricaMemoriaProgettoLocale(tmpDir);
  const nodiServerCount = mem3.nodes.filter(n => n.id.includes('server_js')).length;
  assert.strictEqual(nodiServerCount, 1, 'Non devono crearsi nodi duplicati per lo stesso file');

  console.log('  ok   neuroni salgono dinamicamente all\'aggiunta di file');
  console.log('  ok   nessuna duplicazione su file modificati');
  console.log('  ok   scope rigorosamente project');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log('\n==================================================');
console.log('TEST APPRENDIMENTO MEMORIA: TUTTI I TEST SUPERATI!');
