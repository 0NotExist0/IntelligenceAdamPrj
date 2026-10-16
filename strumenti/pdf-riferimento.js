'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const SCRIPT = path.join(__dirname, 'pdf-riferimento.py');
const SPAZIALE = /\b(?:sotto|sopra|accanto|vicino|a destra|a sinistra)\s+(?:a|al|alla|ad)?\s*["“”']?([^\n,;!?]+)/i;

function richiestaSpaziale(testo) { return SPAZIALE.test(String(testo || '')) && /\bpdf\b/i.test(String(testo || '')); }

function scegliPdf(cwd, testo) {
  const files = fs.readdirSync(cwd, { withFileTypes: true }).filter(e => e.isFile() && /\.pdf$/i.test(e.name)).map(e => e.name);
  if (!files.length) return null;
  const t = String(testo || '').toLowerCase();
  const citati = files.filter(name => {
    const tokens = path.basename(name, path.extname(name)).toLowerCase().split(/[^a-z0-9à-ÿ]+/).filter(x => x.length >= 4);
    return tokens.some(token => t.includes(token));
  });
  const original = files.find(name => /original/i.test(name) && /original/i.test(t));
  return path.join(cwd, original || citati[0] || (files.length === 1 ? files[0] : '')) || null;
}

function prepara(cwd, testo) {
  return new Promise((resolve, reject) => {
    const match = String(testo || '').match(SPAZIALE);
    const pdf = scegliPdf(cwd, testo);
    if (!match || !pdf || !fs.existsSync(pdf)) return reject(new Error('PDF o riferimento spaziale non individuato'));
    const dir = path.join(os.tmpdir(), 'studio-pdf-riferimenti');
    fs.mkdirSync(dir, { recursive: true });
    const output = path.join(dir, 'riferimento-' + Date.now() + '.png');
    execFile('python', [SCRIPT, pdf, match[1].trim(), output], { timeout: 30000, windowsHide: true }, (err, stdout) => {
      let data;
      try { data = JSON.parse(String(stdout || '').trim()); } catch (_) {}
      if (err || !data || !data.ok) return reject(new Error((data && data.error) || (err && err.message) || 'localizzazione PDF fallita'));
      resolve(data);
    });
  });
}

function testoPerModello(originale, data) {
  const vicini = (data.nearby || []).map(x => '- [' + x.relation + '] ' + x.text).join('\n');
  return String(originale).trim() + '\n\n---\nRIFERIMENTO PDF LOCALIZZATO AUTOMATICAMENTE DALLO STUDIO:\n' +
    'File esatto: ' + data.pdf + '\nPagina: ' + data.page + '\nAncora rossa: "' + data.anchor + '"\n' +
    'Il riquadro blu tratteggiato e la zona geometricamente SOTTO l\'ancora. Il ritaglio allegato e autorevole per posizione e impaginazione.\n' +
    'Testi rilevati nella zona:\n' + vicini + '\n\nLavora soltanto sull\'elemento indicato dalla relazione spaziale dell\'utente. Non confondere l\'ancora con il bersaglio e non ridisegnare l\'intero PDF.';
}

module.exports = { richiestaSpaziale, scegliPdf, prepara, testoPerModello };
