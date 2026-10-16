// NotExist Intelligience Studio - Il capo progetto: il filo del lavoro, tenuto dallo Studio.
//
// Richiesta dell'utente (17/9/2026): "manca un contestualizzatore, una guida che racconta ad Adam
// cosa deve fare, che vede dall'esterno".
//
// Il motivo e' nei numeri. Adam ha 32.768 token di memoria e la conversazione si compatta ogni due
// o tre turni: il compito che gli hai dato vive SOLO li' dentro, e quando sparisce lui non ha piu'
// niente a cui aggrapparsi. Visto dal vivo alle 18:26: dopo una compattazione si e' ripresentato
// ("Ciao! Sono Adam... cosa posso aiutarti a fare?") mentre stava sistemando il CSS.
//
// Qui il piano non sta nella sua testa: sta su disco. Lo Studio lo scrive dalla richiesta
// dell'utente, lo tiene, e lo rimette in testa a OGNI messaggio in cinque righe fisse - compito,
// passo di adesso, passi gia' fatti. Un passo alla volta, e si avanza solo quando quel passo e'
// stato fatto davvero. Se Adam ha in mente un piano migliore puo' riscriverlo lui (--piano), ma
// da quel momento e' lo Studio a ricordarselo.
//
// Corto di proposito: sono ~100 token per turno. Una guida lunga si mangerebbe la memoria che
// stiamo cercando di proteggere.

const fs = require('fs');
const path = require('path');

const MAX_PASSI = 6;
const MAX_CARATTERI_PASSO = 120;
const MAX_RICHIESTA = 4000;
const MAX_STORIA = 3;
// Da quanti turni sullo stesso passo si comincia a dirlo: girare in tondo va visto subito.
const TURNI_PER_AVVISO = 3;

function fileDelPiano(dir, base) {
  return path.join(require('./cervello-comandi').cartellaProgetto(dir, base), 'piano.json');
}

function leggi(dir, base) {
  try {
    const d = JSON.parse(fs.readFileSync(fileDelPiano(dir, base), 'utf8'));
    if (!d || !Array.isArray(d.passi) || !d.passi.length) return null;
    return normalizzaPiano(d);
  } catch (e) {
    return null;
  }
}

function salva(dir, piano, base) {
  try {
    const file = fileDelPiano(dir, base);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(piano, null, 1));
    return piano;
  } catch (e) {
    return piano;
  }
}

function accorcia(testo, quanto) {
  const t = String(testo || '').replace(/\s+/g, ' ').trim();
  const max = quanto || MAX_CARATTERI_PASSO;
  return t.length > max ? t.slice(0, max - 1).trim() + '...' : t;
}

// Il compito, come lo direbbe l'utente: tutta la sua richiesta, non soltanto la
// prima frase. Separare su ? faceva sparire proprio la seconda meta' dei bug composti.
function compitoDa(richiesta) {
  return accorcia(String(richiesta || '').replace(/\s+/g, ' ').trim(), 180);
}

function tipoPasso(testo) {
  const t = String(testo || '').toLowerCase();
  if (/\b(verific|prova|test|controll|collaud|misur)/.test(t)) return 'verifica';
  if (/\b(capi|individu|analizz|diagnostic|trova|cerc|leggi|esamin)/.test(t)) return 'analisi';
  return 'modifica';
}

function passo(testo, opzioni) {
  opzioni = opzioni || {};
  return {
    testo: accorcia(testo),
    tipo: opzioni.tipo || tipoPasso(testo),
    stato: 'da fare',
    quando: null,
    verificato: false,
    evidenze: [],
    nota: ''
  };
}

function normalizzaPiano(piano) {
  piano.richiestaCompleta = accorcia(piano.richiestaCompleta || piano.richiesta || piano.compito, MAX_RICHIESTA);
  piano.richiesta = piano.richiestaCompleta;
  piano.criteri = Array.isArray(piano.criteri) ? piano.criteri : criteriDa(piano.richiestaCompleta);
  piano.vincoli = Array.isArray(piano.vincoli) ? piano.vincoli : vincoliDa(piano.richiestaCompleta);
  piano.verifiche = Array.isArray(piano.verifiche) ? piano.verifiche : piano.criteri.map(function (criterio) {
    return { criterio: criterio.testo, stato: 'non verificato', evidenza: '' };
  });
  piano.passi = (piano.passi || []).map(function (p) {
    if (typeof p === 'string') return passo(p);
    p.tipo = p.tipo || tipoPasso(p.testo);
    p.evidenze = Array.isArray(p.evidenze) ? p.evidenze : [];
    p.verificato = p.verificato === true;
    return p;
  });
  return piano;
}

function segmentiRichiesta(richiesta) {
  return String(richiesta || '')
    .replace(/\r/g, '')
    .split(/\n+|[;!?]+|\.(?:\s+|$)/)
    .map(function (pezzo) { return pezzo.replace(/^\s*(?:e|poi|inoltre)\s+/i, '').trim(); })
    .filter(function (pezzo) { return pezzo.length >= 4; });
}

function criteriDa(richiesta) {
  const visti = new Set();
  return segmentiRichiesta(richiesta).filter(function (testo) {
    const chiave = normalizzaTesto(testo);
    if (!chiave || visti.has(chiave)) return false;
    visti.add(chiave);
    return true;
  }).slice(0, 8).map(function (testo, index) {
    return { id: 'criterio-' + (index + 1), testo: accorcia(testo, 240), stato: 'da verificare' };
  });
}

function vincoliDa(richiesta) {
  return segmentiRichiesta(richiesta).filter(function (testo) {
    return /\b(senza|solo|mai|sempre|non deve|deve|obbligatori|vietat|al massimo|almeno)\b/i.test(testo);
  }).slice(0, 6).map(function (testo) { return accorcia(testo, 240); });
}

// I passi scritti dall'utente: elenchi ("1.", "-", "•") o frasi legate da "e poi", "dopo",
// "inoltre". Se l'utente ha gia' detto cosa vuole, punto per punto, quello e' il piano migliore
// che ci sia: nessuno lo sa meglio di lui.
function passiEspliciti(richiesta) {
  const testo = String(richiesta || '');
  const righe = testo.split(/\r?\n/).map(function (r) { return r.trim(); }).filter(Boolean);
  const elenco = righe.filter(function (r) { return /^([-*•]|\d+[.)])\s+/.test(r); })
    .map(function (r) { return r.replace(/^([-*•]|\d+[.)])\s+/, '').trim(); })
    .filter(function (r) { return r.length > 3; });
  if (elenco.length >= 2) return elenco.slice(0, MAX_PASSI);
  // Elenco scritto tutto su una riga: "fammi il sito: 1) le foto 2) i contatti 3) mettilo online".
  // Quello che viene prima del primo numero e' l'introduzione, non un passo.
  if ((testo.match(/\d+[.)]\s+/g) || []).length >= 2) {
    const pezzi = testo.split(/\s*\d+[.)]\s+/).map(function (p) { return p.trim().replace(/[;,]$/, ''); });
    const inizia = /^\s*\d+[.)]\s+/.test(testo);
    const voci = (inizia ? pezzi : pezzi.slice(1)).filter(function (p) { return p.length > 3; });
    if (voci.length >= 2) return voci.slice(0, MAX_PASSI);
  }
  const pezzi = testo.split(/\s*(?:;|,?\s*(?:e\s+poi|poi|dopodich[eé]|inoltre|successivamente)\s+)\s*/i)
    .map(function (p) { return p.trim(); })
    .filter(function (p) { return p.length > 8; });
  return pezzi.length >= 2 ? pezzi.slice(0, MAX_PASSI) : [];
}

function tipoDiRichiesta(richiesta) {
  const t = String(richiesta || '').toLowerCase();
  try {
    if (require('./confronto-misure').sembraUnBug(t)) return 'bug';
  } catch (e) { /* senza il modulo si tira avanti */ }
  if (sembraUnProblemaOperativo(t)) return 'bug';
  if (/\b(crea|genera|fai|scrivi|realizza|costruisci)\b.{0,30}\b(sito|gioco|app|pagina|programma|script|curriculum)\b/.test(t)) return 'creazione';
  // "scrivi il file x.css", "creami un file nuovo": e' roba da fare da zero, non da cercare in giro.
  // Visto dal vivo il 17/9/2026: con il piano da "modifica" Adam perdeva il primo turno a cercare
  // con Grep un file che ancora non esisteva.
  if (/\b(crea|creami|genera|fai|fammi|scrivi|scrivimi|aggiungi)\b[^.\n]{0,40}\b(file|foglio|modulo|classe|funzione|componente)\b/.test(t)) return 'creazione';
  return 'modifica';
}

// Quando la richiesta e' una frase sola ("sistema il css che fa schifo") i passi non ci sono:
// ci si mette il metodo, che e' sempre lo stesso e che un modello piccolo da solo salta.
function passiStandard(richiesta, tipo) {
  const cosa = compitoDa(richiesta);
  if (tipo === 'bug') {
    return [
      'capire DA COSA dipende: guarda le misure e cosa e\' cambiato sul disco, non il codice a caso',
      'fare UNA modifica sola, quella che toglie la causa',
      'verificare che sia risolto davvero e che il resto funzioni ancora'
    ];
  }
  if (tipo === 'creazione') {
    return [
      'fare lo scheletro minimo che si apre e si vede (poche righe, non tutto il progetto)',
      'aggiungere quello che ha chiesto l\'utente: ' + cosa,
      'provarlo dal vivo e sistemare quello che non si vede o non funziona'
    ];
  }
  return [
    'trovare il punto giusto da cambiare (Grep, non leggere file interi)',
    'fare la modifica: ' + cosa,
    'verificare che la pagina o il programma facciano quello che l\'utente ha chiesto'
  ];
}

function nuovoPiano(dir, richiesta, opzioni) {
  opzioni = opzioni || {};
  const espliciti = passiEspliciti(richiesta);
  const tipo = tipoDiRichiesta(richiesta);
  const testi = espliciti.length ? espliciti : passiStandard(richiesta, tipo);
  const vecchio = leggi(dir, opzioni.base);
  const piano = {
    progetto: path.resolve(dir),
    compito: compitoDa(richiesta),
    richiesta: accorcia(richiesta, MAX_RICHIESTA),
    richiestaCompleta: accorcia(richiesta, MAX_RICHIESTA),
    criteri: criteriDa(richiesta),
    vincoli: vincoliDa(richiesta),
    verifiche: criteriDa(richiesta).map(function (criterio) {
      return { criterio: criterio.testo, stato: 'non verificato', evidenza: '' };
    }),
    tipo: tipo,
    quando: new Date().toISOString(),
    corrente: 0,
    turniSulPasso: 0,
    passi: testi.map(function (testo) { return passo(testo); }),
    storia: ((vecchio && vecchio.storia) || []).concat(vecchio ? [{
      quando: vecchio.quando, compito: vecchio.compito,
      fatti: vecchio.passi.filter(function (p) { return p.stato === 'fatto'; }).length,
      totale: vecchio.passi.length
    }] : []).slice(-MAX_STORIA)
  };
  piano.passi[0].stato = 'in corso';
  return salva(dir, piano, opzioni.base);
}

// Una richiesta nuova mentre un piano e' aperto. Se parla d'altro si ricomincia; se e' un
// "non funziona" o una correzione, diventa il passo di adesso: comanda sempre l'utente, ma il
// lavoro gia' fatto non si butta via.
function stessoArgomento(piano, richiesta) {
  const vecchie = paroleSignificative(piano.compito + ' ' + (piano.richiestaCompleta || piano.richiesta));
  const nuove = paroleSignificative(richiesta);
  if (!nuove.size) return true;
  let comuni = 0;
  nuove.forEach(function (p) { if (vecchie.has(p)) comuni++; });
  const contenimento = comuni / Math.min(nuove.size, Math.max(1, vecchie.size));
  const jaccard = comuni / Math.max(1, nuove.size + vecchie.size - comuni);
  return contenimento >= 0.45 || jaccard >= 0.25;
}

const PAROLE_VUOTE = new Set([
  'adesso', 'allora', 'anche', 'ancora', 'come', 'cosa', 'con', 'dal', 'dall', 'dalla', 'dell',
  'delle', 'della', 'degli', 'dello', 'dentro', 'deve', 'devi', 'fare', 'fatto', 'famm', 'mentre',
  'nel', 'nell', 'nella', 'nello', 'non', 'perche', 'pero', 'questa', 'questo', 'sono', 'stesso',
  'sull', 'tutto', 'utente', 'voglio'
]);

function radiceParola(parola) {
  let p = String(parola || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (p.length > 6) p = p.replace(/(amente|mente|azioni|azione|izioni|izione)$/i, '');
  if (p.length > 5) p = p.replace(/(ando|endo|are|ere|ire|ato|ata|ati|ate|uto|uta|uti|ute|ano|ono)$/i, '');
  if (p.length > 4) p = p.replace(/(i|o|a|e)$/i, '');
  return p;
}

function paroleSignificative(testo) {
  const set = new Set();
  const parole = normalizzaTesto(testo).match(/[a-z0-9]{3,}/g) || [];
  parole.forEach(function (parola) {
    const radice = radiceParola(parola);
    if (radice.length >= 3 && !PAROLE_VUOTE.has(radice) && !PAROLE_VUOTE.has(parola)) set.add(radice);
  });
  return set;
}

function normalizzaTesto(testo) {
  return String(testo || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function similaritaArgomento(piano, richiesta) {
  const vecchie = paroleSignificative((piano && piano.richiestaCompleta) || (piano && piano.richiesta) || '');
  const nuove = paroleSignificative(richiesta);
  if (!nuove.size) return 1;
  let comuni = 0;
  nuove.forEach(function (p) { if (vecchie.has(p)) comuni++; });
  return comuni / nuove.size;
}

function aggiornaContratto(piano, richiesta) {
  const testo = String(richiesta || '').replace(/\s+/g, ' ').trim();
  if (!testo) return piano;
  const esistente = normalizzaTesto(piano.richiestaCompleta || piano.richiesta);
  if (!esistente.includes(normalizzaTesto(testo))) {
    piano.richiestaCompleta = accorcia((piano.richiestaCompleta || piano.richiesta || '') + '\n' + testo, MAX_RICHIESTA);
    piano.richiesta = piano.richiestaCompleta;
  }
  const criteriEsistenti = new Set((piano.criteri || []).map(function (c) { return normalizzaTesto(c.testo); }));
  criteriDa(testo).forEach(function (criterio) {
    const chiave = normalizzaTesto(criterio.testo);
    if (!criteriEsistenti.has(chiave)) {
      criterio.id = 'criterio-' + ((piano.criteri || []).length + 1);
      piano.criteri.push(criterio);
      piano.verifiche.push({ criterio: criterio.testo, stato: 'non verificato', evidenza: '' });
      criteriEsistenti.add(chiave);
    }
  });
  piano.vincoli = Array.from(new Set((piano.vincoli || []).concat(vincoliDa(testo))));
  return piano;
}

// Adam dichiara di aver finito il passo? Restituisce la sua nota, o null.
// Tollera il markdown: visto dal vivo il 18/9/2026, Adam ha scritto
// "**PASSO FATTO: Gioco FPS Zombie Multiplayer ora funziona...**" in grassetto, la vecchia
// ricerca voleva la riga che cominciasse con PASSO FATTO, non la trovava, e lo Studio diceva
// all'utente "non dichiarato da Adam". Era falso.
function dichiarazioneDiPasso(testo) {
  const pulito = String(testo || '').replace(/[*_`#>]/g, '');
  const m = /(^|\n)\s*[-•]?\s*PASSO FATTO\s*:?\s*([^\n]*)/i.exec(pulito);
  return m ? m[2].trim().slice(0, 160) : null;
}

// Il passo che Adam si e' dato da solo rispondendo al quadro della situazione ("4) UN solo
// prossimo passo: ..." e "5) con quale comando lo verifico: ..."). Restituisce
// { passo, verifica } o null se nella risposta non c'e'.
function prossimoPassoDichiarato(testo) {
  const pulito = String(testo || '').replace(/[*_#>]/g, '');
  const riga = function (n) {
    const m = new RegExp('(^|\\n)\\s*' + n + '\\)\\s*([^\\n]*)').exec(pulito);
    if (!m) return '';
    // "UN solo prossimo passo: Creare un file..." -> si toglie l'etichetta prima dei due punti
    const dopo = m[2].replace(/^[^:\n]{0,45}:\s*/, '').trim();
    return accorcia(dopo || m[2], 220);
  };
  const passoDopo = riga(4);
  if (!passoDopo || passoDopo.length < 6) return null;
  return { passo: passoDopo, verifica: riga(5) };
}

function aggiungiPassoUrgente(dir, testo, opzioni) {
  opzioni = opzioni || {};
  const piano = leggi(dir, opzioni.base);
  if (!piano) return null;
  // Lo stesso messaggio puo' arrivare due volte (uno rimesso in coda, un rinvio): il passo c'e'
  // gia', non se ne fa un altro uguale.
  const corrente = passoCorrente(piano);
  if (corrente && corrente.testo === accorcia(testo)) return piano;
  const nuovo = passo(testo);
  nuovo.stato = 'in corso';
  // Urgente = chiesto a voce dall'utente: avanza solo se Adam lo dichiara. Un passo che Adam si
  // e' dato da solo (opzioni.urgente === false) segue le regole normali.
  nuovo.urgente = opzioni.urgente !== false;
  piano.passi.forEach(function (p) { if (p.stato === 'in corso') p.stato = 'da fare'; });
  piano.passi.splice(piano.corrente, 0, nuovo);
  piano.turniSulPasso = 0;
  return salva(dir, piano, opzioni.base);
}

// Una domanda non e' un lavoro da fare: "come si chiama il file?", "quanto pesa?", "che modello
// usi?". Aprire un piano a passi per una domanda sarebbe solo rumore - e se un piano e' gia'
// aperto, una domanda non deve spostarlo.
function sembraUnaDomanda(testo) {
  const t = String(testo || '').trim();
  // I verbi che chiedono un lavoro vincono sempre, anche dentro una frase che sembra una domanda
  // ("come mai non lo aggiusti? aggiustalo"). Con \w* passano anche le forme con il pronome
  // attaccato, che in italiano sono la norma: aggiustalo, sistemalo, rifallo.
  if (/\b(fai|fammi|fallo|crea\w*|gener\w*|scriv\w*|aggiung\w*|mett\w*|togli\w*|sistem\w*|corregg\w*|cambi\w*|modific\w*|rimuov\w*|aggiust\w*|install\w*|rifa\w*|continua)\w*\b/i.test(t)) return false;
  return /\?\s*$/.test(t) || /^(come|cosa|che\b|quanto|quanti|quale|quali|dove|perch[eé]|chi|quando|mi spieghi|puoi dirmi|sai)\b/i.test(t);
}

// Una segnalazione di guasto puo' essere formulata come domanda ("perche' non
// gira? e perche' e' invisibile?"). Non va scambiata per una domanda informativa:
// contiene lavoro concreto e spesso piu' criteri da non perdere.
function sembraUnProblemaOperativo(testo) {
  return /\b(?:non\s+(?:funzion\w*|gira\w*|parte\w*|apre\w*|carica\w*|risponde\w*|compare\w*|si\s+vede)|invisibil\w*|sparit\w*|rotta?\w*|blocc\w*|errore\w*|bug|crash\w*)\b/i.test(String(testo || ''));
}

// Il punto d'ingresso usato dallo Studio a ogni messaggio dell'utente.
function aggiornaDallaRichiesta(dir, richiesta, opzioni) {
  opzioni = opzioni || {};
  const testo = String(richiesta || '').trim();
  if (!dir || testo.length < 4) return leggi(dir, opzioni.base);
  // Risposte di continuazione o recupero (anche dopo un riavvio) non sono mai un
  // nuovo compito. "riprova" prima cancellava il piano e diventava il compito stesso.
  if (/^(si|s[iì]|ok|okay|va bene|vai(?: pure)?|continua|continua da dove|procedi|dai|fallo|finisci|termina|avanti|riprova|riprendi|prosegui|grazie|perfetto|no)\b/i.test(testo) && testo.length < 60) {
    return leggi(dir, opzioni.base);
  }
  if (sembraUnaDomanda(testo) && !sembraUnProblemaOperativo(testo)) return leggi(dir, opzioni.base);
  const piano = leggi(dir, opzioni.base);
  if (!piano) return nuovoPiano(dir, testo, opzioni);
  if (!stessoArgomento(piano, testo)) return nuovoPiano(dir, testo, opzioni);
  const similarita = similaritaArgomento(piano, testo);
  aggiornaContratto(piano, testo);
  salva(dir, piano, opzioni.base);
  // Una semplice riformulazione non crea un passo duplicato; un dettaglio nuovo
  // sullo stesso lavoro diventa invece il requisito urgente corrente.
  if (similarita >= 0.72) return piano;
  return aggiungiPassoUrgente(dir, 'l\'utente adesso chiede: ' + testo, opzioni) || piano;
}

function passoCorrente(piano) {
  if (!piano || !piano.passi.length) return null;
  const i = Math.min(piano.corrente, piano.passi.length - 1);
  return piano.passi[i];
}

// Un turno in piu' sullo stesso passo. Serve a dire "sei qui da tre turni": e' il primo segnale
// che si sta girando in tondo.
function contaTurno(dir, opzioni) {
  opzioni = opzioni || {};
  const piano = leggi(dir, opzioni.base);
  if (!piano) return null;
  piano.turniSulPasso = (piano.turniSulPasso || 0) + 1;
  return salva(dir, piano, opzioni.base);
}

// Adam dice di aver finito il passo. Si segna fatto solo se i controlli del turno non hanno
// trovato problemi: "fatto" senza prova e' esattamente l'abitudine che stiamo correggendo.
function segnaPassoFatto(dir, opzioni) {
  opzioni = opzioni || {};
  const piano = leggi(dir, opzioni.base);
  if (!piano) return null;
  const corrente = passoCorrente(piano);
  if (!corrente) return piano;
  if (opzioni.verificato !== true) {
    corrente.nota = accorcia(opzioni.nota || 'manca una verifica positiva del passo', 160);
    corrente.stato = 'in corso';
    return salva(dir, piano, opzioni.base);
  }
  corrente.stato = 'fatto';
  corrente.verificato = true;
  corrente.quando = new Date().toISOString();
  corrente.nota = accorcia(opzioni.nota || '', 160);
  piano.turniSulPasso = 0;
  const prossimo = piano.passi.findIndex(function (p) { return p.stato !== 'fatto' && p.stato !== 'saltato'; });
  piano.corrente = prossimo === -1 ? piano.passi.length - 1 : prossimo;
  if (prossimo !== -1) piano.passi[prossimo].stato = 'in corso';
  piano.finito = prossimo === -1;
  return salva(dir, piano, opzioni.base);
}

function saltaPasso(dir, motivo, opzioni) {
  opzioni = opzioni || {};
  const piano = leggi(dir, opzioni.base);
  if (!piano) return null;
  const corrente = passoCorrente(piano);
  if (!corrente) return piano;
  corrente.stato = 'saltato';
  corrente.verificato = false;
  corrente.quando = new Date().toISOString();
  corrente.nota = accorcia(motivo || '', 160);
  piano.turniSulPasso = 0;
  const prossimo = piano.passi.findIndex(function (p) { return p.stato !== 'fatto' && p.stato !== 'saltato'; });
  piano.corrente = prossimo === -1 ? piano.passi.length - 1 : prossimo;
  if (prossimo !== -1) piano.passi[prossimo].stato = 'in corso';
  piano.finito = prossimo === -1;
  return salva(dir, piano, opzioni.base);
}

// Adam propone un piano suo: "1) ... 2) ...". Da quel momento se lo ricorda lo Studio.
function riscriviPassi(dir, testo, opzioni) {
  opzioni = opzioni || {};
  const piano = leggi(dir, opzioni.base);
  const testi = String(testo || '').split(/\r?\n|(?=\s\d+[.)]\s)/)
    .map(function (r) { return r.replace(/^\s*([-*•]|\d+[.)])\s*/, '').trim(); })
    .filter(function (r) { return r.length > 3; })
    .slice(0, MAX_PASSI);
  if (testi.length < 2) return { ok: false, errore: 'servono almeno due passi, uno per riga' };
  const nuovo = piano || nuovoPiano(dir, testi.join('. '), opzioni);
  nuovo.passi = testi.map(passo);
  nuovo.passi[0].stato = 'in corso';
  nuovo.corrente = 0;
  nuovo.turniSulPasso = 0;
  nuovo.finito = false;
  salva(dir, nuovo, opzioni.base);
  return { ok: true, piano: nuovo };
}

function azzera(dir, base) {
  try { fs.unlinkSync(fileDelPiano(dir, base)); } catch (e) { /* non c'era */ }
}

// ------------------------------------------------------------------ i testi

// Il blocco che Adam si trova in testa a ogni messaggio. Cinque righe, sempre le stesse:
// deve poterlo leggere in un secondo anche quando non ricorda piu' niente.
function testoPerAdam(dir, opzioni) {
  opzioni = opzioni || {};
  const piano = opzioni.piano || leggi(dir, opzioni.base);
  if (!piano) return '';
  const corrente = passoCorrente(piano);
  if (!corrente) return '';
  const numero = piano.corrente + 1;
  const fatti = piano.passi.filter(function (p) { return p.stato === 'fatto'; });
  if (piano.finito) {
    return ['CAPO PROGETTO (lo Studio): "' + piano.compito + '" - tutti i ' + piano.passi.length +
      ' passi risultano fatti. Se l\'utente dice che manca ancora qualcosa, quello e\' il passo nuovo: ' +
      'fallo e basta, senza ricominciare tutto da capo.'].join('\n');
  }
  const righe = [
    'CAPO PROGETTO (te lo tiene lo Studio: anche se la tua memoria si svuota, il filo resta qui)',
    'COMPITO: ' + piano.compito,
    'RICHIESTA COMPLETA: ' + accorcia(piano.richiestaCompleta || piano.richiesta || piano.compito, 900),
    'PASSO ' + numero + ' di ' + piano.passi.length + ' - FALLO ADESSO: ' + corrente.testo
  ];
  if ((piano.criteri || []).length) {
    righe.push('CRITERI DA NON PERDERE: ' + piano.criteri.slice(0, 8).map(function (c) {
      return c.testo;
    }).join(' | '));
  }
  if ((piano.vincoli || []).length) righe.push('VINCOLI: ' + piano.vincoli.join(' | '));
  if (fatti.length) {
    righe.push('GIA\' FATTI: ' + fatti.map(function (p, i) { return (i + 1) + ') ' + p.testo; }).join('; '));
  }
  if (corrente.nota) righe.push('DA SISTEMARE IN QUESTO PASSO: ' + corrente.nota);
  if ((piano.turniSulPasso || 0) >= TURNI_PER_AVVISO) {
    righe.push('ATTENZIONE: sei su questo passo da ' + piano.turniSulPasso + ' turni. Se non ci riesci, ' +
      'dillo chiaro all\'utente invece di riprovare la stessa cosa.');
  }
  righe.push('QUANDO HAI FINITO QUESTO PASSO scrivi come ultima riga: PASSO FATTO: <cosa hai fatto>. ' +
    'Un passo alla volta: non saltare avanti.');
  return righe.join('\n');
}

// Per la chat: l'utente deve vedere il piano e capire a che punto e'.
function testoPerUtente(piano) {
  if (!piano) return '';
  return ['Piano di lavoro per "' + piano.compito + '":', 'Richiesta completa: ' + (piano.richiestaCompleta || piano.richiesta || piano.compito)]
    .concat(piano.passi.map(function (p, i) {
      const segno = p.stato === 'fatto' ? '[fatto]' : (p.stato === 'saltato' ? '[saltato]' : (p.stato === 'in corso' ? '[adesso]' : '[dopo]'));
      return '  ' + (i + 1) + '. ' + segno + ' ' + p.testo;
    })).join('\n');
}

// ------------------------------------------------------------------ riga di comando
if (require.main === module) {
  const argv = process.argv.slice(2);
  const valore = function (nome) {
    const i = argv.indexOf(nome);
    return i !== -1 && argv[i + 1] ? argv[i + 1] : null;
  };
  const dir = valore('--progetto') || process.cwd();
  const piani = valore('--piano');
  if (argv.indexOf('--aiuto') !== -1 || argv.indexOf('-h') !== -1) {
    console.log('Uso:');
    console.log('  node capo-progetto.js --stato                 a che punto siamo');
    console.log('  node capo-progetto.js --piano "1) ... 2) ..." riscrivi i passi (se ne sai uno migliore)');
    console.log('  node capo-progetto.js --fatto "cosa ho fatto" segna fatto il passo di adesso');
    console.log('  node capo-progetto.js --salta "perche\'"       salta il passo di adesso');
    process.exit(0);
  }
  if (piani) {
    const esito = riscriviPassi(dir, piani);
    console.log(esito.ok ? testoPerUtente(esito.piano) : 'Piano non cambiato: ' + esito.errore);
    process.exit(esito.ok ? 0 : 1);
  }
  if (argv.indexOf('--fatto') !== -1) {
    const p = segnaPassoFatto(dir, { nota: valore('--fatto') || '' });
    console.log(p ? testoPerUtente(p) : 'Nessun piano aperto per questo progetto.');
    process.exit(0);
  }
  if (argv.indexOf('--salta') !== -1) {
    const p = saltaPasso(dir, valore('--salta') || '');
    console.log(p ? testoPerUtente(p) : 'Nessun piano aperto per questo progetto.');
    process.exit(0);
  }
  if (argv.indexOf('--azzera') !== -1) {
    azzera(dir);
    console.log('Piano azzerato.');
    process.exit(0);
  }
  const piano = leggi(dir);
  console.log(piano ? testoPerUtente(piano) + '\n\n' + testoPerAdam(dir, { piano: piano })
    : 'Nessun piano aperto per questo progetto.');
}

module.exports = {
  leggi: leggi,
  salva: salva,
  nuovoPiano: nuovoPiano,
  aggiornaDallaRichiesta: aggiornaDallaRichiesta,
  aggiungiPassoUrgente: aggiungiPassoUrgente,
  passoCorrente: passoCorrente,
  contaTurno: contaTurno,
  segnaPassoFatto: segnaPassoFatto,
  saltaPasso: saltaPasso,
  riscriviPassi: riscriviPassi,
  azzera: azzera,
  testoPerAdam: testoPerAdam,
  testoPerUtente: testoPerUtente,
  passiEspliciti: passiEspliciti,
  passiStandard: passiStandard,
  tipoDiRichiesta: tipoDiRichiesta,
  tipoPasso: tipoPasso,
  criteriDa: criteriDa,
  vincoliDa: vincoliDa,
  stessoArgomento: stessoArgomento,
  similaritaArgomento: similaritaArgomento,
  sembraUnaDomanda: sembraUnaDomanda,
  sembraUnProblemaOperativo: sembraUnProblemaOperativo,
  dichiarazioneDiPasso: dichiarazioneDiPasso,
  prossimoPassoDichiarato: prossimoPassoDichiarato,
  compitoDa: compitoDa,
  fileDelPiano: fileDelPiano,
  TURNI_PER_AVVISO: TURNI_PER_AVVISO
};
