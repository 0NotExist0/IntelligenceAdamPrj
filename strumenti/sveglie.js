// NotExist Intelligience Studio - Sveglie di Adam.
//
// Adam a volte deve aspettare (un'operazione lunga, un effetto che si vede solo dopo un
// po') o vuole ricontrollare piu' tardi. Un modello non ha un orologio e non puo' "tornare"
// da solo: invece di restare in attesa, si programma una sveglia con Bash (strumenti/
// sveglia.js). Lo Studio la conserva su disco e all'ora giusta lo risveglia con la domanda
// che si era lasciato; se la sveglia chiede di guardare una pagina, prima la riprova nel
// browser e gli allega la schermata, cosi' il controllo e' anche visivo.
//
// Questo modulo non tiene timer e non parla col modello: valida, conserva e scrive testi.
// I limiti esistono perche' un modello piccolo potrebbe risvegliarsi all'infinito.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIN_SECONDI = 30;
const MAX_SECONDI = 24 * 3600;
const MAX_IN_ATTESA = 5;
const MAX_PER_ORA = 6;
const FILE_PREDEFINITO = path.join(__dirname, '..', 'dati', 'sveglie.json');

// "300", "90s", "5m", "5 min", "1h", "1h30m", "2 ore" -> secondi; null se non si capisce.
function leggiDurata(testo) {
  const t = String(testo === undefined || testo === null ? '' : testo).trim().toLowerCase().replace(/\s+/g, '');
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  const re = /(\d+)(secondi|secondo|sec|s|minuti|minuto|min|m|ore|ora|h)/g;
  let totale = 0;
  let consumato = '';
  let m;
  while ((m = re.exec(t)) !== null) {
    const n = Number(m[1]);
    const u = m[2];
    totale += /^(ore|ora|h)$/.test(u) ? n * 3600 : /^(minuti|minuto|min|m)$/.test(u) ? n * 60 : n;
    consumato += m[0];
  }
  return consumato === t && totale > 0 ? totale : null;
}

// opzioni: { tra, motivo, pagina, guarda }. ora: millisecondi (per i test).
function nuovaSveglia(opzioni, ora) {
  const o = opzioni || {};
  const adesso = ora || Date.now();
  const secondi = leggiDurata(o.tra);
  if (secondi === null) return { errore: 'durata non valida: usa per esempio 90s, 5m, 1h30m' };
  if (secondi < MIN_SECONDI) return { errore: 'troppo presto: almeno ' + MIN_SECONDI + ' secondi' };
  if (secondi > MAX_SECONDI) return { errore: 'troppo tardi: al massimo 24 ore' };
  const motivo = String(o.motivo || '').replace(/\s+/g, ' ').trim();
  if (motivo.length < 3) return { errore: 'serve il motivo: cosa dovrai controllare al risveglio' };
  const pagina = o.pagina ? String(o.pagina).trim().replace(/\\/g, '/') : '';
  if (pagina && (!/^[\w.\- /]+\.html?$/i.test(pagina) || /\.\./.test(pagina))) return { errore: 'pagina non valida: ' + pagina };
  return {
    sveglia: {
      id: 'sv' + crypto.randomBytes(3).toString('hex'),
      creata: adesso,
      quando: adesso + secondi * 1000,
      motivo: motivo.slice(0, 500),
      pagina: pagina,
      guarda: !!(o.guarda && pagina),
      stato: 'in attesa'
    }
  };
}

function inAttesa(elenco) {
  return (elenco || []).filter(function (s) { return s.stato === 'in attesa'; })
    .sort(function (a, b) { return a.quando - b.quando; });
}

// Si puo' aggiungere questa sveglia? null se si', altrimenti il motivo del no.
function oltreILimite(elenco, ora) {
  const adesso = ora || Date.now();
  if (inAttesa(elenco).length >= MAX_IN_ATTESA) return 'ci sono gia\' ' + MAX_IN_ATTESA + ' sveglie in attesa';
  const ultimaOra = (elenco || []).filter(function (s) { return s.creata > adesso - 3600 * 1000; }).length;
  if (ultimaOra >= MAX_PER_ORA) return 'troppe sveglie nell\'ultima ora (massimo ' + MAX_PER_ORA + ')';
  return null;
}

function carica(file) {
  try {
    const d = JSON.parse(fs.readFileSync(file || FILE_PREDEFINITO, 'utf8'));
    return Array.isArray(d) ? d : [];
  } catch (e) {
    return [];
  }
}

// Si conservano le ultime 50: le vecchie servono solo come storia.
function salva(elenco, file) {
  const f = file || FILE_PREDEFINITO;
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tenute = (elenco || []).slice().sort(function (a, b) { return b.creata - a.creata; }).slice(0, 50);
  fs.writeFileSync(f, JSON.stringify(tenute, null, 2));
  return tenute;
}

function oraLeggibile(ms) {
  const d = new Date(ms);
  return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
}

// Il messaggio con cui Adam si risveglia: la sua domanda, quanto tempo e' passato, e le
// misure prese dallo Studio se la sveglia chiedeva di guardare una pagina.
function testoRisveglio(s, ora, rapporto) {
  const adesso = ora || Date.now();
  const minuti = Math.max(1, Math.round((adesso - s.creata) / 60000));
  return [
    'SVEGLIA: te l\'eri programmata alle ' + oraLeggibile(s.creata) + ' (' + minuti + (minuti === 1 ? ' minuto' : ' minuti') +
      ' fa) con questo motivo: "' + s.motivo + '".',
    rapporto
      ? 'Prima di svegliarti lo Studio ha riprovato ' + s.pagina + ' in un browser: ti allega la schermata, e qui sotto ci ' +
        'sono le misure.\n\n' + rapporto
      : '',
    'Adesso controlla davvero se e\' tutto a posto (non dare per scontato che lo sia): se serve guardalo o misuralo, ' +
      'e se trovi un problema correggilo. Se e\' a posto dillo in una riga. Se ti serve ricontrollare ancora piu\' ' +
      'tardi, programma un\'altra sveglia.'
  ].filter(Boolean).join('\n\n');
}

module.exports = {
  MIN_SECONDI,
  MAX_SECONDI,
  MAX_IN_ATTESA,
  MAX_PER_ORA,
  FILE_PREDEFINITO,
  leggiDurata,
  nuovaSveglia,
  inAttesa,
  oltreILimite,
  carica,
  salva,
  oraLeggibile,
  testoRisveglio
};
