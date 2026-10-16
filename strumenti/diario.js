// NotExist Intelligience Studio - Il diario di bordo del lavoro.
//
// Adam dimentica: quando la memoria si compatta (visto dal vivo: da 24.423 a 853 token) o si apre
// una sessione nuova, di quello che ha fatto nell'ultima ora non gli resta niente, e ricomincia a
// indovinare. Il diario e' la memoria dello STUDIO, non sua: a ogni turno si scrive cosa e' stato
// toccato, cosa ha detto Adam e cosa hanno misurato i controlli. Non e' un riassunto scritto da un
// modello (quelli inventano): sono fatti, e restano anche dopo compattazioni e riavvii.
//
// Serve a due cose: ricostruire il "quadro della situazione" (quadro.js) e accorgersi che si sta
// girando in tondo - lo stesso errore che tre volte di fila sopravvive alle correzioni.

const fs = require('fs');
const path = require('path');

const MAX_TURNI = 14;
const TURNI_PER_I_SEGNALI = 6;

function fileDelDiario(dir) {
  return path.join(require('./cervello-comandi').cartellaProgetto(dir), 'stato-lavoro.json');
}

function leggi(dir) {
  try {
    const d = JSON.parse(fs.readFileSync(fileDelDiario(dir), 'utf8'));
    return {
      progetto: d.progetto || dir,
      turni: Array.isArray(d.turni) ? d.turni : [],
      quadri: Array.isArray(d.quadri) ? d.quadri : []
    };
  } catch (e) {
    return { progetto: dir, turni: [], quadri: [] };
  }
}

function scrivi(dir, diario) {
  const file = fileDelDiario(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    progetto: dir,
    aggiornato: new Date().toISOString(),
    turni: diario.turni.slice(-MAX_TURNI),
    quadri: diario.quadri.slice(-6)
  }, null, 1));
}

// Lo stesso problema misurato due volte ha numeri diversi ("47 zombie", "52 zombie") ma e' lo
// stesso problema: per contare le ripetizioni i numeri si tolgono.
function chiaveProblema(testo) {
  return String(testo || '').toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function registraTurno(dir, voce) {
  const diario = leggi(dir);
  diario.turni.push({
    quando: new Date().toISOString(),
    file: (voce.file || []).slice(0, 12).map(function (f) { return path.basename(String(f)); }),
    esito: voce.esito || 'sconosciuto',
    problemi: (voce.problemi || []).slice(0, 6).map(function (p) { return String(p).slice(0, 220); }),
    testo: String(voce.testo || '').replace(/\s+/g, ' ').slice(0, 200)
  });
  scrivi(dir, diario);
  return diario;
}

function registraQuadro(dir, motivo) {
  const diario = leggi(dir);
  diario.quadri.push({ quando: new Date().toISOString(), motivo: motivo, turno: diario.turni.length });
  scrivi(dir, diario);
  return diario;
}

// Cosa dicono i fatti sul come sta andando il lavoro.
function segnali(dir) {
  const diario = leggi(dir);
  const ultimi = diario.turni.slice(-TURNI_PER_I_SEGNALI);
  const conta = {};
  ultimi.forEach(function (t) {
    const visti = new Set();
    (t.problemi || []).forEach(function (p) {
      const chiave = chiaveProblema(p);
      if (!chiave || visti.has(chiave)) return;      // due volte nello stesso turno = una volta
      visti.add(chiave);
      if (!conta[chiave]) conta[chiave] = { volte: 0, testo: p };
      conta[chiave].volte += 1;
    });
  });
  const ripetuti = Object.keys(conta).map(function (k) { return { chiave: k, volte: conta[k].volte, testo: conta[k].testo }; })
    .filter(function (p) { return p.volte >= 2; })
    .sort(function (a, b) { return b.volte - a.volte; });

  let senzaProgresso = 0;
  for (let i = diario.turni.length - 1; i >= 0; i--) {
    if (diario.turni[i].esito === 'errori') senzaProgresso++;
    else break;
  }
  const ultimoQuadro = diario.quadri.length ? diario.quadri[diario.quadri.length - 1] : null;
  return {
    turni: diario.turni.length,
    ripetuti: ripetuti,
    senzaProgresso: senzaProgresso,
    fileToccatiDiRecente: ultimi.reduce(function (t, x) { return t.concat(x.file || []); }, []),
    turniDallUltimoQuadro: ultimoQuadro ? diario.turni.length - ultimoQuadro.turno : null,
    ultimoQuadro: ultimoQuadro
  };
}

function azzera(dir) {
  try { fs.unlinkSync(fileDelDiario(dir)); } catch (e) { /* non c'era */ }
}

module.exports = {
  leggi: leggi,
  registraTurno: registraTurno,
  registraQuadro: registraQuadro,
  segnali: segnali,
  azzera: azzera,
  chiaveProblema: chiaveProblema,
  fileDelDiario: fileDelDiario
};
