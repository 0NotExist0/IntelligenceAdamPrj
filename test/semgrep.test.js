// Test deterministici per il collegamento a Semgrep; non richiedono Semgrep o rete.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const semgrep = require('../strumenti/semgrep');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'semgrep-studio-'));
  try {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'app.js'), 'const value = 1;\n');
    const fixture = {
      version: 'test-semgrep',
      paths: { scanned: ['src/app.js'] },
      results: [
        {
          check_id: 'javascript.lang.security.test-rule',
          path: 'src/app.js',
          start: { line: 1 },
          end: { line: 1 },
          extra: { severity: 'ERROR', message: 'Pattern pericoloso di prova.', metadata: { confidence: 'HIGH' } }
        },
        {
          check_id: 'javascript.lang.best-practice.test-rule',
          path: 'src/app.js',
          start: { line: 2 },
          extra: { severity: 'WARNING', message: 'Avviso di prova.' }
        }
      ],
      errors: []
    };
    const fixtureText = JSON.stringify(fixture);
    const scan = await semgrep.scanProject(root, {
      files: ['src/app.js', '../outside.js'],
      bin: process.execPath,
      argsPrefix: ['-e', 'process.stdout.write(' + JSON.stringify(fixtureText) + ')']
    });

    assert.strictEqual(scan.available, true, 'il wrapper finto risulta disponibile');
    assert.strictEqual(scan.executed, true, 'la scansione finta risulta eseguita');
    assert.strictEqual(scan.scannedFiles, 1, 'la scansione è limitata al file valido nel progetto');
    assert.strictEqual(scan.findings.length, 2, 'entrambi i risultati vengono mantenuti');
    assert.strictEqual(scan.findings[0].relative, 'src/app.js', 'il risultato conserva il percorso relativo completo');
    assert.strictEqual(scan.findings[0].severity, 'ERROR', 'la severità bloccante viene mantenuta');
    assert.strictEqual(scan.findings[0].ruleId, 'javascript.lang.security.test-rule', 'l’ID della regola viene mantenuto');

    const missing = await semgrep.scanProject(root, {
      files: ['src/app.js'],
      execFile: function (file, args, options, callback) {
        const error = new Error('comando non trovato');
        error.code = 'ENOENT';
        callback(error, '', '');
      }
    });
    assert.strictEqual(missing.available, false, 'un Semgrep mancante non viene confuso con un esito pulito');
    assert.ok(/pip install semgrep/.test(missing.reason), 'viene indicato come installare Semgrep');

    const crashed = await semgrep.scanProject(root, {
      files: ['src/app.js'],
      bin: process.execPath,
      execFile: function () { throw new Error('errore di avvio finto'); }
    });
    assert.strictEqual(crashed.executed, false, 'un errore di avvio non propaga un crash nella verifica chiamante');
    assert.ok(/errore di avvio finto/.test(crashed.error), 'l’errore del wrapper resta visibile');

    const empty = await semgrep.scanProject(root, { files: [] });
    assert.strictEqual(empty.skipped, true, 'nessun file target salta la scansione senza errore');
    assert.strictEqual(semgrep.isLikelySourceFile('src/app.tsx'), true, 'i file TypeScript React vengono riconosciuti');
    assert.strictEqual(semgrep.isLikelySourceFile('assets/logo.png'), false, 'le immagini non vengono inviate allo scanner');

    console.log('Semgrep adapter: tutti i controlli superati.');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
