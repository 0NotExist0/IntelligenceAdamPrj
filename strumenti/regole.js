// NotExist Intelligience Studio - Regole di Adam, con la loro storia.
//
// L'utente vuole che Adam segua delle regole sue. Misurato l'11/9/2026: incorporarle nel
// modello con un Modelfile (SYSTEM) non serve, perche' Claude Code manda sempre il suo
// prompt di sistema e quello del Modelfile viene ignorato (senza prompt il modello di prova
// rispondeva "BANANA" come da regola, con il prompt rispondeva "4"). Le regole entrano quindi
// nel prompt che lo Studio aggiunge, in cima. Ogni versione precedente resta nella storia e
// si puo' ripristinare: e' la copia di sicurezza, applicata alle regole invece che al modello.

const fs = require('fs');
const path = require('path');

const FILE_PREDEFINITO = path.join(__dirname, '..', 'dati', 'regole.json');
const MAX_REGOLE = 20;
const MAX_STORIA = 20;

// Ogni regola: { testo, prova?: { domanda, contiene?, nonContiene? } }. La prova e' facoltativa:
// serve all'esame per controllare che la regola venga seguita davvero.
function validaRegole(regole) {
  if (!Array.isArray(regole)) return { errore: 'servono le regole come elenco' };
  if (regole.length > MAX_REGOLE) return { errore: 'al massimo ' + MAX_REGOLE + ' regole' };
  const pulite = [];
  for (const r of regole) {
    const testo = String((r && r.testo) || '').replace(/\s+/g, ' ').trim();
    if (!testo) continue;
    if (testo.length > 300) return { errore: 'regola troppo lunga (massimo 300 caratteri): ' + testo.slice(0, 60) + '...' };
    const voce = { testo: testo };
    const p = r.prova;
    if (p && String(p.domanda || '').trim()) {
      const contiene = String(p.contiene || '').trim();
      const nonContiene = String(p.nonContiene || '').trim();
      if (!contiene && !nonContiene) return { errore: 'la prova della regola "' + testo.slice(0, 40) + '" deve dire cosa la risposta contiene o non contiene' };
      voce.prova = { domanda: String(p.domanda).trim().slice(0, 400), contiene: contiene.slice(0, 100), nonContiene: nonContiene.slice(0, 100) };
    }
    pulite.push(voce);
  }
  return { regole: pulite };
}

// Il testo che entra nel prompt di Adam. La clausola finale e' fissa: una regola dell'utente
// non puo' chiedere di sbagliare un calcolo o di rompere il codice.
function testoRegole(regole) {
  const r = (regole || []).filter(function (x) { return x && x.testo; });
  if (!r.length) return '';
  return 'REGOLE DELL\'UTENTE, da seguire sempre:\n' +
    r.map(function (x, i) { return (i + 1) + '. ' + x.testo; }).join('\n') +
    '\nSe una regola chiedesse di dare un risultato sbagliato in matematica o in informatica, o di rompere il ' +
    'codice, la correttezza viene prima: segui la correttezza e spiega perche\'.';
}

function carica(file) {
  try {
    const d = JSON.parse(fs.readFileSync(file || FILE_PREDEFINITO, 'utf8'));
    return {
      versione: Number(d.versione) || 0,
      regole: Array.isArray(d.regole) ? d.regole : [],
      storia: Array.isArray(d.storia) ? d.storia : [],
      esame: d.esame || null
    };
  } catch (e) {
    return { versione: 0, regole: [], storia: [], esame: null };
  }
}

function salva(stato, file) {
  const f = file || FILE_PREDEFINITO;
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(stato, null, 2));
  return stato;
}

// La versione di adesso va nella storia prima di essere sostituita: niente si perde.
function nuovaVersione(stato, regole, esame) {
  const storia = [{ versione: stato.versione, quando: Date.now(), regole: stato.regole, esame: stato.esame }]
    .concat(stato.storia).slice(0, MAX_STORIA);
  return { versione: stato.versione + 1, regole: regole, storia: storia, esame: esame || null };
}

function ripristina(stato, versione) {
  const vecchia = stato.storia.find(function (v) { return v.versione === Number(versione); });
  if (!vecchia) return null;
  return nuovaVersione(stato, vecchia.regole, vecchia.esame);
}

module.exports = { FILE_PREDEFINITO, MAX_REGOLE, validaRegole, testoRegole, carica, salva, nuovaVersione, ripristina };
