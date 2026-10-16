'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const STATUS_URL = 'http://127.0.0.1:8082/admin/api/status';

function candidati() {
  const home = os.homedir();
  const appData = process.env.APPDATA || '';
  return process.platform === 'win32'
    ? [
        path.join(home, '.local', 'bin', 'fcc-server.exe'),
        path.join(home, '.local', 'bin', 'fcc-server.cmd'),
        path.join(appData, 'npm', 'fcc-server.cmd')
      ]
    : [
        path.join(home, '.local', 'bin', 'fcc-server'),
        path.join(home, 'bin', 'fcc-server'),
        '/usr/local/bin/fcc-server'
      ];
}

function trova(esiste) {
  const controlla = esiste || fs.existsSync;
  return candidati().find(function (file) {
    try { return !!file && controlla(file); } catch (_) { return false; }
  }) || '';
}

function disponibile(opzioni) {
  const opts = opzioni || {};
  const url = opts.url || STATUS_URL;
  const timeoutMs = Number(opts.timeoutMs) || 1200;
  return new Promise(function (resolve) {
    let conclusa = false;
    function fine(valore) {
      if (conclusa) return;
      conclusa = true;
      resolve(!!valore);
    }
    let req;
    try {
      req = http.get(url, function (res) {
        res.resume();
        fine(res.statusCode >= 200 && res.statusCode < 500);
      });
    } catch (_) {
      fine(false);
      return;
    }
    req.setTimeout(timeoutMs, function () {
      req.destroy();
      fine(false);
    });
    req.on('error', function () { fine(false); });
  });
}

function attendi(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function avviaSeNecessario(opzioni) {
  const opts = opzioni || {};
  const verifica = opts.verifica || disponibile;
  if (await verifica()) return { ok: true, giaAttivo: true, avviato: false };

  const eseguibile = opts.eseguibile || trova(opts.esiste);
  if (!eseguibile) {
    return { ok: false, avviato: false, errore: 'fcc-server non trovato' };
  }

  const avvia = opts.avvia || function (file) {
    const figlio = spawn(file, [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    figlio.unref();
    return figlio;
  };

  try {
    avvia(eseguibile);
  } catch (errore) {
    return { ok: false, avviato: false, errore: errore.message };
  }

  const tentativi = Math.max(1, Number(opts.tentativi) || 24);
  const pausaMs = Math.max(0, Number(opts.pausaMs) || 250);
  for (let i = 0; i < tentativi; i++) {
    if (pausaMs) await attendi(pausaMs);
    if (await verifica()) {
      return { ok: true, giaAttivo: false, avviato: true, eseguibile };
    }
  }
  return { ok: false, avviato: true, eseguibile, errore: 'fcc-server non risponde sulla porta 8082' };
}

module.exports = { STATUS_URL, candidati, trova, disponibile, avviaSeNecessario };
