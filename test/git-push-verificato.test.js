const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const gitPush = require('../strumenti/git-push-verificato');

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd: cwd,
    encoding: 'utf8',
    windowsHide: true,
    env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0' })
  }).trim();
}

async function run() {
  assert.strictEqual(gitPush.richiestaDiPush('fai git push e controlla GitHub'), true);
  assert.strictEqual(gitPush.richiestaDiPush('Puoi pubblicare questi file sul repository remoto?'), true);
  assert.strictEqual(gitPush.richiestaDiPush('git push'), true);
  assert.strictEqual(gitPush.richiestaDiPush('spiegami come funziona git push'), false);
  assert.strictEqual(gitPush.richiestaDiPush('non fare git push'), false);
  assert.strictEqual(gitPush.richiestaDiPush('fai in modo che quando dico git push venga eseguito'), false);

  assert.strictEqual(gitPush.contieneComandoPush('git push origin main'), true);
  assert.strictEqual(gitPush.contieneComandoPush('git -C "C:/progetto" push -u origin main'), true);
  assert.strictEqual(gitPush.contieneComandoPush('git status && git push'), true);
  assert.strictEqual(gitPush.contieneComandoPush('echo git push'), false);
  assert.strictEqual(gitPush.contieneComandoPush('git status'), false);

  const stato = gitPush.creaStato('esegui git push', process.cwd());
  assert.ok(stato && stato.richiesto);
  assert.match(gitPush.motivoNonCompletato(stato), /non eseguito realmente/);
  stato.eseguito = true;
  stato.verifica = { remotoAllineato: true };
  assert.strictEqual(gitPush.motivoNonCompletato(stato), null);
  assert.match(gitPush.istruzioniPerIlModello(), /git ls-remote/i);

  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-git-push-'));
  const remoto = path.join(base, 'remote.git');
  const lavoro = path.join(base, 'lavoro');
  fs.mkdirSync(lavoro);
  try {
    git(base, ['init', '--bare', remoto]);
    git(lavoro, ['init']);
    git(lavoro, ['config', 'user.name', 'Studio Test']);
    git(lavoro, ['config', 'user.email', 'studio-test@example.invalid']);
    fs.writeFileSync(path.join(lavoro, 'uno.txt'), 'prima versione\n', 'utf8');
    git(lavoro, ['add', 'uno.txt']);
    git(lavoro, ['commit', '-m', 'Primo commit']);
    git(lavoro, ['branch', '-M', 'main']);
    git(lavoro, ['remote', 'add', 'origin', remoto]);
    git(lavoro, ['push', '-u', 'origin', 'main']);

    const pubblicato = await gitPush.verificaPushRemoto(lavoro);
    assert.strictEqual(pubblicato.ok, true, pubblicato.errore);
    assert.strictEqual(pubblicato.remotoAllineato, true);
    assert.strictEqual(pubblicato.pulito, true);
    assert.strictEqual(pubblicato.fileNelCommit, 1);
    assert.strictEqual(pubblicato.headLocale, pubblicato.headRemoto);

    fs.writeFileSync(path.join(lavoro, 'due.txt'), 'non ancora pubblicato\n', 'utf8');
    const conFileLocale = await gitPush.verificaPushRemoto(lavoro);
    assert.strictEqual(conFileLocale.remotoAllineato, true);
    assert.strictEqual(conFileLocale.pulito, false);
    assert.ok(conFileLocale.modificheLocali.some(function (riga) { return riga.includes('due.txt'); }));

    git(lavoro, ['add', 'due.txt']);
    git(lavoro, ['commit', '-m', 'Commit soltanto locale']);
    const nonPubblicato = await gitPush.verificaPushRemoto(lavoro);
    assert.strictEqual(nonPubblicato.ok, false);
    assert.strictEqual(nonPubblicato.remotoAllineato, false);
    assert.match(nonPubblicato.errore, /non coincide/i);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }

  console.log('OK git push reale e verifica remota');
}

run().catch(function (errore) {
  console.error(errore);
  process.exitCode = 1;
});
