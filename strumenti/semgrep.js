// Integrazione locale e facoltativa con Semgrep Community Edition.
// Non installa software e non usa una shell: se Semgrep manca, le altre verifiche restano attive.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const TIMEOUT_MS = 60000;
const MAX_BUFFER = 12 * 1024 * 1024;
const INSTALL_HELP = process.platform === 'win32'
  ? "Installa Semgrep in un ambiente isolato da PowerShell: `$target = Join-Path $env:LOCALAPPDATA 'IntelligienceStudio/tools/semgrep'; py -m venv $target; & (Join-Path $target 'Scripts/python.exe') -m pip install semgrep`, poi ripeti la verifica."
  : 'Installa Semgrep con `python3 -m pip install semgrep`, poi ripeti la verifica.';

function slash(value) {
  return String(value || '').replace(/\\/g, '/');
}

function withinRoot(root, file) {
  const relative = path.relative(root, file);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && relative.indexOf('..' + path.sep) !== 0);
}

function targetsFor(root, files) {
  if (!Array.isArray(files)) return ['.'];
  const seen = new Set();
  const targets = [];
  files.forEach(function (file) {
    if (typeof file !== 'string' || !file.trim()) return;
    const absolute = path.resolve(root, file);
    if (!withinRoot(root, absolute)) return;
    let stat;
    try { stat = fs.statSync(absolute); } catch (e) { return; }
    if (!stat.isFile()) return;
    const relative = slash(path.relative(root, absolute));
    const key = process.platform === 'win32' ? relative.toLowerCase() : relative;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push(relative);
  });
  return targets;
}

function candidates(options) {
  options = options || {};
  const found = [];
  function add(file, prefix) {
    if (!file || found.some(function (c) { return c.file === file && c.prefix.join('\0') === (prefix || []).join('\0'); })) return;
    found.push({ file: file, prefix: prefix || [] });
  }

  if (options.bin) add(options.bin, options.argsPrefix || []);
  if (process.env.SEMGREP_BIN) add(process.env.SEMGREP_BIN, []);
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    add(path.join(process.env.LOCALAPPDATA, 'IntelligienceStudio', 'tools', 'semgrep', 'Scripts', 'semgrep.exe'), []);
  }
  add('semgrep', []);
  if (process.platform === 'win32') add('py', ['-m', 'semgrep']);
  add('python', ['-m', 'semgrep']);
  add('python3', ['-m', 'semgrep']);
  return found;
}

function parseJson(output) {
  const text = String(output || '').trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) {
    // Alcune versioni o wrapper scrivono un avviso prima del JSON; accetta solo
    // l'oggetto JSON completo, senza interpretare testo della console come risultato.
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first < 0 || last <= first) return null;
    try {
      const parsed = JSON.parse(text.slice(first, last + 1));
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (ignored) { return null; }
  }
}

function mapFinding(root, item) {
  if (!item || !item.path) return null;
  const absolute = path.resolve(root, item.path);
  if (!withinRoot(root, absolute)) return null;
  const extra = item.extra || {};
  const metadata = extra.metadata || {};
  const originalSeverity = String(extra.severity || 'WARNING').toUpperCase();
  const severity = /^(ERROR|WARNING|INFO)$/.test(originalSeverity) ? originalSeverity : 'WARNING';
  const relative = slash(path.relative(root, absolute));
  const ruleId = String(item.check_id || item.rule_id || 'regola-sconosciuta');
  const message = String(extra.message || item.message || 'Semgrep ha trovato un pattern da controllare.').trim();
  return {
    file: absolute,
    relative: relative,
    line: item.start && Number(item.start.line) > 0 ? Number(item.start.line) : 1,
    endLine: item.end && Number(item.end.line) > 0 ? Number(item.end.line) : null,
    ruleId: ruleId,
    severity: severity,
    message: message,
    confidence: metadata.confidence || null,
    references: Array.isArray(metadata.references) ? metadata.references.slice(0, 3) : []
  };
}

function missingModule(output) {
  return /No module named ['"]?semgrep|No module named semgrep/i.test(String(output || ''));
}

function runCandidate(candidate, args, root, options) {
  const launch = options.execFile || execFile;
  return new Promise(function (resolve) {
    launch(candidate.file, candidate.prefix.concat(args), {
      cwd: root,
      timeout: Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
      env: Object.assign({}, process.env, { SEMGREP_SEND_METRICS: 'off' })
    }, function (error, stdout, stderr) {
      resolve({ error: error || null, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

async function scanProjectInternal(projectDir, options) {
  options = options || {};
  const root = path.resolve(projectDir || process.cwd());
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return { available: false, executed: false, findings: [], errors: [], error: 'La cartella da analizzare non esiste.' };
  }

  const targets = targetsFor(root, options.files);
  if (!targets.length) {
    return { available: false, executed: false, skipped: true, reason: 'Nessun file sorgente modificato da passare a Semgrep.', findings: [], errors: [] };
  }

  const config = String(options.config || process.env.SEMGREP_CONFIG || 'p/security-audit').trim() || 'p/security-audit';
  const args = ['scan', '--config', config, '--json', '--metrics', 'off', '--jobs', '2'].concat(targets);
  const list = candidates(options);
  let installOutput = '';

  for (let i = 0; i < list.length; i++) {
    const result = await runCandidate(list[i], args, root, options);
    const combined = result.stderr + '\n' + result.stdout;
    const data = parseJson(result.stdout);

    if (!data && result.error && (result.error.code === 'ENOENT' || missingModule(combined))) {
      installOutput = combined.slice(0, 1200);
      continue;
    }
    if (!data) {
      const detail = combined.trim().slice(-1600) || (result.error && result.error.message) || 'Risposta JSON di Semgrep non valida.';
      return { available: true, executed: false, config: config, findings: [], errors: [], error: detail };
    }

    const findings = (Array.isArray(data.results) ? data.results : [])
      .map(function (item) { return mapFinding(root, item); })
      .filter(Boolean);
    const scannerErrors = Array.isArray(data.errors) ? data.errors.slice(0, 20).map(function (item) {
      return String(item && (item.message || item.type) || item || 'Errore Semgrep').slice(0, 500);
    }) : [];
    const scannedPaths = data.paths && data.paths.scanned;
    return {
      available: true,
      executed: true,
      config: config,
      version: data.version || null,
      scannedFiles: Array.isArray(scannedPaths) ? scannedPaths.length : targets.length,
      findings: findings,
      errors: scannerErrors,
      error: null
    };
  }

  return {
    available: false,
    executed: false,
    findings: [],
    errors: [],
    error: null,
    reason: INSTALL_HELP + (installOutput ? ' Dettaglio: ' + installOutput.trim().split(/\r?\n/).slice(-1)[0].slice(0, 240) : '')
  };
}

async function scanProject(projectDir, options) {
  try {
    return await scanProjectInternal(projectDir, options);
  } catch (error) {
    // Un crash del processo o del wrapper non deve annullare gli altri controlli.
    return {
      available: true,
      executed: false,
      findings: [],
      errors: [],
      error: String(error && error.message || error).slice(0, 1600)
    };
  }
}

function isLikelySourceFile(file) {
  const name = path.basename(String(file || ''));
  return /\.(?:apex|bash|c|cc|cpp|cs|cjs|dart|ex|exs|go|h|hpp|html?|java|js|jsx|json|kt|kts|lua|mjs|php|py|rb|rs|scala|sh|sol|swift|tf|ts|tsx|vue|xml|yaml|yml)$/i.test(name) ||
    /^(?:Dockerfile|Jenkinsfile|Makefile)$/i.test(name);
}

module.exports = {
  scanProject: scanProject,
  isLikelySourceFile: isLikelySourceFile,
  targetsFor: targetsFor,
  mapFinding: mapFinding,
  installHelp: INSTALL_HELP
};
