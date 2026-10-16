const path = require('path');
const { execFile } = require('child_process');

const TIMEOUT_GIT = 30000;

function richiestaDiPush(testo) {
  const t = String(testo || '').trim().toLowerCase();
  if (!t) return false;

  // Domande didattiche e richieste che parlano della regola in astratto non
  // autorizzano un'operazione sul remoto.
  if (/\b(?:non|evita\s+di|senza)\s+(?:(?:fare|eseguire|lanciare)\s+)?(?:il\s+)?(?:git\s+)?push\b/i.test(t)) return false;
  if (/\b(?:spiegami|descrivi|cos['’]?e|cosa\s+significa|come\s+funziona|esempio\s+di)\b.{0,60}\bgit\s+push\b/i.test(t)) return false;
  if (/\bfai\s+in\s+modo\s+che\b|\bquando\s+(?:ti\s+)?(?:dico|chiedo)\b|\bdovrebb(?:e|ero)\b/i.test(t)) return false;

  if (/^\s*(?:per\s+favore\s+)?git\s+push(?:\s|$)/i.test(t)) return true;
  if (/\b(?:fai|esegui|lancia|avvia|prova|rifai|completa)\b.{0,45}\bgit\s+push\b/i.test(t)) return true;
  if (/\b(?:puoi|potresti|devi)\b.{0,35}\b(?:fare|eseguire|lanciare)?\s*(?:il\s+)?git\s+push\b/i.test(t)) return true;
  if (/\b(?:pusha|pushare|pushalo|pushali|pushatele|pushate)\b/i.test(t)) return true;
  if (/\b(?:pubblica|carica|manda|invia|sincronizza)\w*\b.{0,80}\b(?:github|gitlab|bitbucket|repository|repo|remot[oa])\b/i.test(t)) return true;
  if (/\bpush\b.{0,45}\b(?:changes|files|commit|github|gitlab|remote|repo)\b/i.test(t)) return true;
  return false;
}

function contieneComandoPush(comando) {
  const c = String(comando || '');
  return /(?:^|[;&|]\s*)git(?:\.exe)?(?:\s+-C\s+(?:"[^"]+"|'[^']+'|\S+))?\s+push(?:\s|$)/im.test(c);
}

function pulisciArgomento(valore) {
  const v = String(valore || '').trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function cartellaDelPush(comando, cartellaBase) {
  const base = path.resolve(cartellaBase || process.cwd());
  const c = String(comando || '');
  const conC = c.match(/\bgit(?:\.exe)?\s+-C\s+("[^"]+"|'[^']+'|[^\s;&|]+)\s+push\b/i);
  if (conC) {
    const scelta = pulisciArgomento(conC[1]);
    return path.isAbsolute(scelta) ? path.resolve(scelta) : path.resolve(base, scelta);
  }

  // Caso comune prodotto dai modelli: cd cartella && git push.
  const conCd = c.match(/(?:^|[;&|]\s*)cd\s+("[^"]+"|'[^']+'|[^\s;&|]+)\s*(?:&&|;)\s*git(?:\.exe)?\s+push\b/i);
  if (conCd) {
    const scelta = pulisciArgomento(conCd[1]);
    return path.isAbsolute(scelta) ? path.resolve(scelta) : path.resolve(base, scelta);
  }
  return base;
}

function eseguiGit(cwd, args, opzioni) {
  const opts = opzioni || {};
  return new Promise(function (resolve, reject) {
    execFile('git', args, {
      cwd: cwd,
      timeout: opts.timeout || TIMEOUT_GIT,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
      env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0' })
    }, function (errore, stdout, stderr) {
      if (errore) {
        const dettaglio = (String(stderr || '') + '\n' + String(stdout || '')).trim();
        const e = new Error(dettaglio || errore.message);
        e.code = errore.code;
        return reject(e);
      }
      resolve(String(stdout || '').trim());
    });
  });
}

async function verificaPushRemoto(cartella) {
  const cwd = path.resolve(cartella || process.cwd());
  const esito = {
    ok: false,
    remotoAllineato: false,
    cartella: cwd,
    radice: '',
    branch: '',
    upstream: '',
    remote: '',
    remoteBranch: '',
    headLocale: '',
    headRemoto: '',
    fileNelCommit: 0,
    modificheLocali: [],
    pulito: false,
    errore: ''
  };

  try {
    esito.radice = await eseguiGit(cwd, ['rev-parse', '--show-toplevel']);
    esito.headLocale = await eseguiGit(esito.radice, ['rev-parse', 'HEAD']);
    esito.branch = await eseguiGit(esito.radice, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    esito.upstream = await eseguiGit(esito.radice, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
    esito.remote = await eseguiGit(esito.radice, ['config', '--get', 'branch.' + esito.branch + '.remote']);
    const mergeRef = await eseguiGit(esito.radice, ['config', '--get', 'branch.' + esito.branch + '.merge']);
    esito.remoteBranch = mergeRef.replace(/^refs\/heads\//, '');
    if (!esito.remote || !esito.remoteBranch) throw new Error('il branch corrente non ha un upstream remoto completo');

    const remoto = await eseguiGit(esito.radice, [
      'ls-remote', '--heads', esito.remote, 'refs/heads/' + esito.remoteBranch
    ]);
    const primaRiga = remoto.split(/\r?\n/).find(Boolean) || '';
    esito.headRemoto = (primaRiga.match(/^([0-9a-f]{40,64})\s/i) || [])[1] || '';
    if (!esito.headRemoto) throw new Error('il branch non risulta presente sul remoto');

    esito.remotoAllineato = esito.headLocale.toLowerCase() === esito.headRemoto.toLowerCase();
    const elencoFile = await eseguiGit(esito.radice, ['ls-tree', '-r', '--name-only', 'HEAD']);
    esito.fileNelCommit = elencoFile ? elencoFile.split(/\r?\n/).filter(Boolean).length : 0;
    const stato = await eseguiGit(esito.radice, ['status', '--porcelain', '--untracked-files=all']);
    esito.modificheLocali = stato ? stato.split(/\r?\n/).filter(Boolean) : [];
    esito.pulito = esito.modificheLocali.length === 0;
    esito.ok = esito.remotoAllineato;
    if (!esito.remotoAllineato) {
      esito.errore = 'il commit remoto non coincide con HEAD locale';
    }
  } catch (errore) {
    esito.errore = String((errore && errore.message) || errore || 'verifica Git non riuscita').slice(0, 1200);
  }
  return esito;
}

function creaStato(testo, cartella) {
  if (!richiestaDiPush(testo)) return null;
  return {
    richiesto: true,
    testo: String(testo || ''),
    cartella: path.resolve(cartella || process.cwd()),
    eseguito: false,
    comandoFallito: false,
    erroreComando: '',
    verificaInCorso: false,
    verifica: null,
    tentativoVerifica: 0,
    finalizzato: false
  };
}

function motivoNonCompletato(stato) {
  if (!stato || !stato.richiesto) return null;
  if (!stato.eseguito) return 'git push richiesto ma non eseguito realmente';
  if (stato.verificaInCorso) return null;
  if (stato.comandoFallito) return 'git push eseguito ma fallito' + (stato.erroreComando ? ': ' + stato.erroreComando : '');
  if (!stato.verifica) return 'git push eseguito ma non verificato sul remoto';
  if (!stato.verifica.remotoAllineato) {
    return 'push non verificato sul remoto: ' + (stato.verifica.errore || 'SHA remoto diverso da HEAD locale');
  }
  return null;
}

function istruzioniPerIlModello() {
  return [
    'VINCOLO GIT PUSH RICHIESTO DALL\'UTENTE:',
    '1. Non limitarti a descrivere i comandi: usa Bash ed esegui davvero il push in questo turno.',
    '2. Prima controlla `git status --short` e il branch. Includi nel commit soltanto i file pertinenti al lavoro richiesto; non includere segreti o modifiche estranee.',
    '3. Se le modifiche pertinenti non sono ancora in un commit, aggiungile e crea un commit chiaro, poi esegui `git push` (con `-u` quando manca l\'upstream).',
    '4. Dopo il push verifica il remoto. Lo Studio confrontera\' indipendentemente `git rev-parse HEAD` con `git ls-remote` e conterà i file contenuti nel commit.',
    '5. Non dire mai che i file sono stati caricati se il push non e\' riuscito o se gli SHA non coincidono. In caso di autenticazione, rete o remote mancante, riporta l\'errore esatto.'
  ].join('\n');
}

module.exports = {
  richiestaDiPush,
  contieneComandoPush,
  cartellaDelPush,
  verificaPushRemoto,
  creaStato,
  motivoNonCompletato,
  istruzioniPerIlModello
};
