// NotExist Intelligience Studio - "Fermati un momento: quadro della situazione".
//
// Richiesta dell'utente (16/9/2026): quando Adam perde il filo non deve tirare avanti a indovinare,
// deve fare come una persona - fermarsi, guardare dove si trova, capire se sta sbagliando strada e
// correggersi. Un modello da 9B, da solo, non se ne accorge: la memoria si compatta (visto dal vivo:
// da 24.423 a 853 token) e lui continua sicuro di se', ma sta lavorando su un ricordo sbagliato.
//
// Qui il punto della situazione lo fa lo STUDIO, con i fatti che ha misurato:
//  - cosa aveva chiesto l'utente, punto per punto (requisiti.js, dalle chat salvate);
//  - com'e' fatto il progetto ADESSO (i file veri su disco);
//  - cosa succede provandolo davvero (le ultime misure);
//  - cosa e' gia' stato provato senza risolvere (il diario di bordo).
// E poi obbliga Adam a rispondere a cinque domande PRIMA di toccare un file: e' il "mi fermo e
// guardo" fatto a mano, perche' da solo non lo farebbe.

const fs = require('fs');
const path = require('path');

const CARTELLE_IGNORATE = /^(\.|node_modules$|__pycache__$|venv$|\.venv$|dist$|build$|vendor$|Library$)/i;

const MOTIVI = {
  compattazione: 'la tua memoria si e\' appena compattata: dei turni precedenti non ti resta quasi niente',
  'sessione-nuova': 'stiamo ripartendo da una sessione nuova: la conversazione di prima non ce l\'hai piu\'',
  'errori-ripetuti': 'lo stesso problema resta li\' dopo piu\' correzioni: stai girando in tondo',
  // Detto chiaro: non sono i controlli sui file a dire di no (quelli passano), e' la richiesta
  // dell'utente che ha ancora un punto scoperto. "I controlli dicono di no" confondeva tutti.
  'fatto-non-vero': 'hai detto che era fatto, ma nella richiesta dell\'utente c\'e\' ancora un punto che nel progetto non risulta',
  'nessun-progresso': 'sono passati piu\' turni senza che un solo controllo diventasse verde',
  richiesto: 'te l\'ha chiesto l\'utente'
};

// Quando serve fermarsi. Solo fatti misurati: mai "mi sembra che".
function serveIlQuadro(motivo, segnali) {
  const s = segnali || {};
  // Appena fatto: non si ripete a ogni turno, diventerebbe rumore.
  if (s.turniDallUltimoQuadro !== null && s.turniDallUltimoQuadro !== undefined && s.turniDallUltimoQuadro < 2 && motivo !== 'richiesto') {
    return { serve: false, motivo: motivo, perche: 'quadro gia\' fatto da meno di 2 turni' };
  }
  if (motivo === 'compattazione' || motivo === 'sessione-nuova' || motivo === 'fatto-non-vero' || motivo === 'richiesto') {
    return { serve: true, motivo: motivo, perche: MOTIVI[motivo] };
  }
  if (motivo === 'errori-ripetuti') {
    const peggiore = (s.ripetuti || [])[0];
    if (peggiore && peggiore.volte >= 3) {
      return { serve: true, motivo: motivo, perche: MOTIVI[motivo] + ' (' + peggiore.volte + ' turni con lo stesso problema)' };
    }
    return { serve: false, motivo: motivo, perche: 'il problema non si e\' ancora ripetuto abbastanza' };
  }
  if (motivo === 'nessun-progresso') {
    if ((s.senzaProgresso || 0) >= 4) return { serve: true, motivo: motivo, perche: MOTIVI[motivo] + ' (' + s.senzaProgresso + ' turni)' };
    return { serve: false, motivo: motivo, perche: 'ancora pochi turni con errori' };
  }
  return { serve: false, motivo: motivo, perche: 'motivo sconosciuto' };
}

// I file di codice veri, con quante righe hanno: e' il "dove mi trovo" piu' onesto che ci sia.
function fotoDelProgetto(dir, quanti) {
  const file = [];
  (function scendi(cartella, rel, profondita) {
    if (profondita > 3 || file.length > 200) return;
    let voci;
    try { voci = fs.readdirSync(cartella, { withFileTypes: true }); } catch (e) { return; }
    voci.forEach(function (v) {
      if (v.isDirectory()) {
        if (!CARTELLE_IGNORATE.test(v.name)) scendi(path.join(cartella, v.name), rel ? rel + '/' + v.name : v.name, profondita + 1);
        return;
      }
      if (!/\.(js|mjs|cjs|py|cs|html?|css)$/i.test(v.name)) return;
      let righe = 0;
      try {
        const testo = fs.readFileSync(path.join(cartella, v.name), 'utf8');
        righe = testo.split('\n').length;
      } catch (e) { righe = 0; }
      file.push({ file: rel ? rel + '/' + v.name : v.name, righe: righe });
    });
  })(path.resolve(dir), '', 0);
  return file.sort(function (a, b) { return b.righe - a.righe; }).slice(0, quanti || 8);
}

function elenco(righe, vuoto) {
  return righe.length ? righe.map(function (r) { return '  - ' + r; }).join('\n') : '  - ' + vuoto;
}

// Il messaggio da mandare ad Adam. Compatto: deve stare nel contesto senza mangiarselo.
function costruisci(dir, opzioni) {
  opzioni = opzioni || {};
  const motivo = opzioni.motivo || 'richiesto';
  const perche = opzioni.perche || MOTIVI[motivo] || '';
  const righe = ['FERMATI UN MOMENTO: QUADRO DELLA SITUAZIONE.',
    'Te lo do io (lo Studio) con i fatti misurati, non con quello che ricordi. Perche\' ti fermo: ' + perche + '.'];

  // 1. Cosa aveva chiesto l'utente: prima con le sue parole, poi punto per punto.
  // Le parole servono perche' i punti controllabili sono pochi e fissi (piattaforma, 3D,
  // multiplayer, localhost, telefono): di "sono un raver che suona acid tekno, i colori devono
  // essere quelli" non resta traccia, e dopo una compattazione Adam non ce l'ha piu' da nessuna
  // parte. Visto dal vivo il 17/9/2026: il quadro diceva solo "c'e': in HTML, CSS e JavaScript".
  let richieste = [];
  if (opzioni.richiesta) {
    richieste = [{ quando: '', testo: String(opzioni.richiesta).replace(/\s+/g, ' ').slice(0, 200) }];
  } else {
    try { richieste = require('./requisiti').richiesteDaRicordare(dir, { base: opzioni.baseChat, quante: 3, caratteri: 160 }); } catch (e) { richieste = []; }
  }
  if (richieste.length) {
    righe.push('', 'COSA HA CHIESTO L\'UTENTE (parole sue, dalle vostre chat):');
    righe.push(elenco(richieste.map(function (r) { return (r.quando ? r.quando + ' ' : '') + '"' + r.testo + '"'; }), ''));
  }
  let requisiti = null;
  try {
    requisiti = require('./requisiti').controllaRequisiti(dir, { base: opzioni.baseChat, richiesta: opzioni.richiesta });
  } catch (e) { requisiti = null; }
  if (requisiti && requisiti.punti.length) {
    righe.push('', 'PUNTI CONTROLLABILI DELLA RICHIESTA (misurati sui file):');
    righe.push(requisiti.punti.map(function (p) {
      return '  - ' + (p.ok ? 'c\'e\': ' : 'MANCA: ') + p.nome + (p.ok ? '' : ' - ' + p.prova);
    }).join('\n'));
  }

  // 2. Com'e' il progetto adesso, sul serio.
  const foto = fotoDelProgetto(dir, 8);
  righe.push('', 'COM\'E\' IL PROGETTO ADESSO (file veri su disco):');
  righe.push(elenco(foto.map(function (f) { return f.file + ' (' + f.righe + ' righe)'; }), 'nessun file di codice'));

  // 2-bis. Cosa e' cambiato sul disco negli ultimi turni. Un file sostituito o cancellato e' la
  // spiegazione piu' frequente di "prima funzionava e adesso no", ed e' l'unica che Adam da solo
  // non puo' ricostruire: se l'ha fatto lui, l'ha gia' dimenticato.
  try {
    const perdite = require('./cambiamenti').testoPerditeRecenti(dir, { base: opzioni.baseDati, turni: 3, quante: 4 });
    if (perdite) righe.push('', perdite);
  } catch (e) { /* lo storico dei cambiamenti non e' indispensabile */ }

  // 3. Cosa succede provandolo davvero.
  const misure = (opzioni.problemi || []).slice(0, 4).map(function (p) { return String(p).replace(/\s+/g, ' ').slice(0, 200); });
  righe.push('', 'COSA SUCCEDE PROVANDOLO DAVVERO:');
  righe.push(elenco(misure, opzioni.senzaMisure || 'nessuna misura recente: lancia la verifica prima di decidere'));

  // 4. Cosa e' gia' stato provato e non ha funzionato.
  const ripetuti = (opzioni.segnali && opzioni.segnali.ripetuti) || [];
  if (ripetuti.length) {
    righe.push('', 'GIA\' PROVATO SENZA RISOLVERE (non rifarlo uguale):');
    righe.push(elenco(ripetuti.slice(0, 3).map(function (p) {
      return 'in ' + p.volte + ' turni resta: ' + String(p.testo).replace(/\s+/g, ' ').slice(0, 160);
    }), ''));
  }

  // 5. Le cinque domande: e' il "fermarsi a pensare" fatto a mano.
  righe.push('', 'PRIMA DI TOCCARE UN FILE, rispondi in 5 righe corte:',
    '  1) a che punto sono, in una riga;',
    '  2) cosa manca davvero rispetto alla richiesta;',
    '  3) qual e\' la causa piu\' probabile di cio\' che non va (non l\'effetto);',
    '  4) UN solo prossimo passo, piccolo;',
    '  5) con quale comando lo verifico.',
    'Poi fai SOLO quel passo e verificalo. Se una cosa chiesta non la sai fare o non e\' possibile, scrivilo ' +
    'chiaramente all\'utente: e\' molto meglio che girare in tondo o dire "fatto" quando non lo e\'.');

  return { testo: righe.join('\n'), motivo: motivo, requisiti: requisiti, file: foto };
}

module.exports = { costruisci: costruisci, serveIlQuadro: serveIlQuadro, fotoDelProgetto: fotoDelProgetto, MOTIVI: MOTIVI };
