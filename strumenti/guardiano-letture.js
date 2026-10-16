// NotExist Intelligience Studio - Il guardiano delle letture.
//
// Visto dal vivo (17/9/2026, ore 18:23). L'utente: "sistema il css che il sito fa schifo". Adam
// legge style.css, poi legge `bootstrap.css`: 8975 righe, 178 KB, circa 49.000 token. La sua
// memoria ne tiene 32.768 IN TUTTO. Il contesto e' schizzato a 41.781 token, la compattazione ha
// riassunto via il compito, e nel turno dopo Adam si e' ripresentato ("Ciao! Sono Adam... cosa
// posso aiutarti a fare?") senza toccare un file. Dell'incarico non restava niente.
//
// Non e' colpa del modello: nessuno gli aveva detto che quel file non ci sta. Un 9B non conosce
// la propria finestra e non sa quanto pesa un file prima di aprirlo; lo Studio si', tutti e due.
// Questo e' un hook PreToolUse: prima che Read parta, si guarda quanto pesa il file. Se non ci
// sta, la lettura viene rifiutata con scritto COSA fare invece (Grep, oppure Read con offset e
// limit) - un no che insegna, non un no e basta.
//
// Regola: si dice no solo quando si e' sicuri. Un file che ci sta si legge, sempre.

const fs = require('fs');
const path = require('path');

// Tetti predefiniti, pensati su una finestra da 32k: oltre questi, un solo Read si mangia un
// terzo della memoria di Adam. Lo Studio li ricalcola sulla finestra vera del modello.
const MAX_CARATTERI = 24000;
const MAX_RIGHE = 700;
// Una lettura mirata (Read con offset e limit) resta sempre permessa fino a questo numero di righe.
const RIGHE_MIRATE = 400;
const CARATTERI_PER_TOKEN = 3.6;

function leggiStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (e) {
    return '';
  }
}

function misuraFile(percorso) {
  try {
    const st = fs.statSync(percorso);
    if (!st.isFile()) return null;
    let righe = null;
    if (st.size < 8 * 1024 * 1024) {
      try { righe = fs.readFileSync(percorso, 'utf8').split(/\r?\n/).length; } catch (e) { righe = null; }
    }
    return { byte: st.size, righe: righe, token: Math.round(st.size / CARATTERI_PER_TOKEN) };
  } catch (e) {
    return null;
  }
}

// Una schermata: si guarda la copia leggera, non l'originale. Se la copia non c'e' passa
// l'originale (mai lasciare Adam senza vedere la pagina), tranne quando e' davvero enorme.
function giudicaImmagine(percorso, limiti) {
  const l = limiti || {};
  const leggera = require('./schermata-leggera');
  const massimo = l.immagine || leggera.BYTE_PESANTE;
  let byte = 0;
  try { byte = fs.statSync(percorso).size; } catch (e) { return { permessa: true }; }
  if (byte <= massimo) return { permessa: true };
  const piccola = leggera.migliore(percorso);
  const nome = path.basename(percorso);
  if (piccola !== percorso) {
    return {
      permessa: false,
      motivo: 'NON aprire ' + nome + ' (' + Math.round(byte / 1024) + ' KB): a piena risoluzione una ' +
        'schermata si mangia mezza memoria. Della stessa schermata c\'e\' la copia leggera, che mostra ' +
        'le stesse cose: apri questa invece\n' + piccola.split('\\').join('/')
    };
  }
  if (byte <= (l.immagineMassima || 250 * 1024)) return { permessa: true };
  return {
    permessa: false,
    motivo: 'NON aprire ' + nome + ': e\' un\'immagine da ' + Math.round(byte / 1024) + ' KB e nel tuo ' +
      'contesto vale decine di migliaia di token, cioe' + '\'' + ' quasi tutta la memoria che hai. Le schermate ' +
      'che servono te le allega lo Studio da solo quando l\'utente segnala un problema; se ti serve ' +
      'guardare una pagina, lancia la verifica e leggi la schermata leggera che ti indica.'
  };
}

// Decide se la lettura puo' passare. Restituisce { permessa, motivo }.
function giudica(input, limiti) {
  const l = limiti || {};
  const maxCaratteri = l.caratteri || MAX_CARATTERI;
  const maxRighe = l.righe || MAX_RIGHE;
  const righeMirate = l.mirate || RIGHE_MIRATE;
  const percorso = String((input && input.file_path) || '');
  if (!percorso) return { permessa: true };
  // Le immagini non si contano a righe, ma pesano piu' di tutto il resto: nelle sessioni vere
  // dell'utente due Read di schermate PNG valevano 302.752 e 329.384 caratteri di contesto, e da
  // soli mandavano la memoria di Adam a 87.963 token su 32.768. Della stessa schermata c'e' una
  // copia leggera (strumenti/schermata-leggera.js): undici volte piu' piccola e si vede uguale.
  if (/\.(png|jpe?g|gif|webp|bmp)$/i.test(percorso)) return giudicaImmagine(percorso, l);
  if (/\.(ico|pdf|mp3|mp4|wav|zip|glb|fbx|blend)$/i.test(percorso)) return { permessa: true };
  const misura = misuraFile(percorso);
  if (!misura) return { permessa: true };                       // file inesistente: risponde Claude Code

  const limite = Number(input.limit) || 0;
  if (limite > 0 && limite <= righeMirate) return { permessa: true };   // lettura mirata: sempre permessa
  if (misura.byte <= maxCaratteri && (misura.righe === null || misura.righe <= maxRighe)) return { permessa: true };

  const nome = path.basename(percorso);
  const quanto = (misura.righe !== null ? misura.righe + ' righe, ' : '') +
    Math.round(misura.byte / 1024) + ' KB, circa ' + misura.token.toLocaleString('it-IT') + ' token';
  const finestra = l.finestra ? ' La tua memoria ne tiene ' + Number(l.finestra).toLocaleString('it-IT') + ' in tutto.' : '';
  return {
    permessa: false,
    motivo: 'NON leggere tutto ' + nome + ': e\' troppo grande (' + quanto + ').' + finestra +
      ' Leggendolo perderesti il filo del lavoro e dovresti ricominciare da capo (e\' gia\' successo). ' +
      'Fai cosi\' invece:\n' +
      '- per trovare una cosa dentro: Grep con il testo che cerchi e path ' + nome + ';\n' +
      '- per vedere un punto preciso: Read con offset e limit (massimo ' + righeMirate + ' righe per volta);\n' +
      '- per sapere solo com\'e\' fatto: chiedilo al cervello del progetto invece di aprirlo.\n' +
      'Se e\' una libreria gia\' pronta (bootstrap, three.js, jquery...) non serve leggerla: usala e basta.'
  };
}

// ------------------------------------------------------------------ le scritture
//
// Richiesta dell'utente (18/9/2026): "mi sembra che sta rovinando il codice degli esempi: dovrebbe
// solo prenderlo in lettura, non toccare quel codice". Gli esempi dello Studio erano intatti, ma
// nella stessa sessione Adam aveva riscritto da zero con Write il game.js dell'utente: da 127 a 472
// righe, e del file di prima restava il 28% (sparite ADBController, startApp e altre tre funzioni).
// Due regole, controllate PRIMA che lo strumento parta:
//  1. la cartella dello Studio (scheletri, strumenti, esempi) si legge soltanto;
//  2. un file dell'utente non si sostituisce in blocco: si cambia con Edit, un pezzo alla volta,
//     a meno che l'utente non abbia chiesto di rifarlo da zero.

const CARTELLA_STUDIO = path.resolve(__dirname, '..');
// Sotto queste righe significative un file e' un abbozzo: riscriverlo tutto e' normale.
const RIGHE_MINIME_PROTETTE = 40;
// Del file di prima deve restare almeno questa parte, altrimenti e' una sostituzione.
const SOPRAVVIVENZA_MINIMA = 0.4;
// Parole con cui l'utente chiede davvero di ripartire da capo.
const CHIEDE_DA_ZERO = /\bda\s+(zero|capo)\b|\briscriv\w*|\brifai\b|\brifallo\b|\brifalla\b|\bricominc\w*|\bbutta\s+via\b|\bcancella\s+tutto\b/i;

function normale(p) {
  return path.resolve(String(p || '')).toLowerCase();
}

function dentro(cartella, file) {
  const c = normale(cartella);
  const f = normale(file);
  return f === c || f.indexOf(c + path.sep) === 0;
}

function percorsoEsistentePiuVicino(percorso) {
  let corrente = path.resolve(percorso);
  while (!fs.existsSync(corrente)) {
    const padre = path.dirname(corrente);
    if (padre === corrente) break;
    corrente = padre;
  }
  return corrente;
}

// Controllo sia lessicale sia reale: un link simbolico dentro il progetto non deve
// diventare una scorciatoia per scrivere in .ssh, Desktop o in un altro progetto.
function dentroProgetto(cwd, file) {
  if (!cwd || !file) return false;
  try {
    const root = fs.realpathSync(path.resolve(cwd));
    const target = path.resolve(file);
    if (!dentro(root, target)) return false;
    const vicino = fs.realpathSync(percorsoEsistentePiuVicino(target));
    return dentro(root, vicino);
  } catch (e) {
    return false;
  }
}

// Il progetto dell'utente e' la cartella della sessione. Se l'utente sta lavorando sullo Studio
// stesso, le regole sulla cartella dello Studio non valgono.
function fuoriDalloStudio(cwd) {
  return !cwd || !dentro(CARTELLA_STUDIO, cwd);
}

function relativaStudio(file) {
  return path.relative(CARTELLA_STUDIO, path.resolve(file)).split(path.sep).join('/');
}

function motivoStudio(file, comeCopia, cwd) {
  const rel = relativaStudio(file);
  const scheletro = /^scheletri\/([^/]+)/.exec(rel);
  try {
    const scheletriMod = require('./scheletri');
    if (scheletriMod.eProgettoUnity && scheletriMod.eProgettoUnity(cwd || process.cwd())) {
      return 'NON modificare ' + rel + ': e\' un file dello Studio. Inoltre la cartella corrente e\' un progetto UNITY (C#): gli scheletri dello Studio sono scritti per Web/Python e NON vanno usati su Unity. Sviluppa creando script C# (.cs) dentro Assets/.';
    }
  } catch (e) {}
  return 'NON modificare ' + rel + ': e\' un file dello Studio, non del progetto dell\'utente. Gli esempi ' +
    'e gli scheletri si LEGGONO soltanto. ' +
    (scheletro
      ? 'Per usare questo scheletro copialo nel progetto con: node "' + path.join(CARTELLA_STUDIO, 'strumenti', 'scheletri.js').split(path.sep).join('/') +
        '" --usa ' + scheletro[1] + ' e modifica la copia.'
      : (comeCopia || 'Leggilo, e scrivi il tuo codice nei file del progetto.'));
}

// L'ultima richiesta dell'utente la scrive lo Studio a ogni messaggio (server.js).
function ultimaRichiesta(cwd, base) {
  if (!cwd) return '';
  try {
    const cartella = require('./cervello-comandi').cartellaProgetto(cwd, base);
    return fs.readFileSync(path.join(cartella, 'ultima-richiesta.txt'), 'utf8');
  } catch (e) {
    return '';
  }
}

function giudicaScrittura(strumento, input, contesto) {
  contesto = contesto || {};
  const file = String((input && (input.file_path || input.notebook_path)) || '');
  if (!file) return { permessa: true };
  const cwd = contesto.cwd || '';
  const assoluto = path.isAbsolute(file) ? file : path.resolve(cwd || '.', file);

  // Regola 2: lo Studio si legge soltanto.
  if (fuoriDalloStudio(cwd) && dentro(CARTELLA_STUDIO, assoluto)) {
    return { permessa: false, motivo: motivoStudio(assoluto, null, cwd) };
  }

  // Prima regola assoluta: ogni scrittura resta nella cartella di lavoro attiva.
  if (!dentroProgetto(cwd, assoluto)) {
    return {
      permessa: false,
      motivo: 'NON scrivere fuori dal progetto attivo (' + path.resolve(cwd || '.') + '). Il percorso richiesto e\' ' +
        assoluto + '. Se serve lavorare su un altro progetto, l\'utente deve prima selezionarlo come cartella di lavoro.'
    };
  }

  // Regola 3: niente sostituzioni in blocco di un file che c'e' gia'.
  if (strumento !== 'Write') return { permessa: true };
  let prima = null;
  try {
    const st = fs.statSync(assoluto);
    if (!st.isFile() || st.size > 2 * 1024 * 1024) return { permessa: true };
    prima = fs.readFileSync(assoluto, 'utf8');
  } catch (e) {
    return { permessa: true };                       // file nuovo: si crea liberamente
  }
  const cambiamenti = require('./cambiamenti');
  const dopo = String((input && input.content) || '');
  const significative = prima.split(/\r?\n/).filter(function (r) { return r.trim().length >= 4; }).length;
  if (significative < RIGHE_MINIME_PROTETTE) return { permessa: true };
  const resta = cambiamenti.sopravvivenza(prima, dopo);
  if (resta >= SOPRAVVIVENZA_MINIMA) return { permessa: true };
  const richiesta = contesto.ultimaRichiesta !== undefined ? contesto.ultimaRichiesta : ultimaRichiesta(cwd, contesto.base);
  if (CHIEDE_DA_ZERO.test(String(richiesta || ''))) return { permessa: true };

  const nome = path.basename(assoluto);
  const persi = cambiamenti.persi(nome, prima, dopo).slice(0, 5);
  const righe = prima.split(/\r?\n/).length;
  return {
    permessa: false,
    motivo: 'NON sostituire tutto ' + nome + ': ha ' + righe + ' righe e del file di adesso ne resterebbe solo il ' +
      Math.round(resta * 100) + '%' + (persi.length ? ' (sparirebbero ' + persi.join(', ') + ')' : '') + '. ' +
      'E\' codice dell\'utente: cambialo con Edit, un pezzo alla volta, solo dove serve. Se l\'utente ti ha chiesto ' +
      'di rifarlo da zero, diglielo e chiedigli di scriverti "rifallo da zero": solo allora si puo\' riscrivere tutto.'
  };
}

// I comandi che scrivono (>, cp, mv, del, sed -i...) con la destinazione dentro lo Studio.
// Il 17/9/2026 un `cp` aveva coperto lo style.css dell'utente: i comandi vanno guardati come Write.
function destinazioniDelComando(comando) {
  const destinazioni = [];
  String(comando || '').split(/&&|\|\||;|\|/).forEach(function (pezzo) {
    const s = pezzo.trim();
    if (!s) return;
    const percorsi = [];
    const re = /"([^"]+)"|'([^']+)'|(\S+)/g;
    let m;
    while ((m = re.exec(s)) !== null) percorsi.push(m[1] || m[2] || m[3]);
    const verbo = (percorsi[0] || '').toLowerCase();
    const argomenti = percorsi.slice(1).filter(function (a) { return a.charAt(0) !== '-' && !/^\/[a-z]$/i.test(a); });
    // redirezioni: tutto quello che segue > o >>
    const redirezione = /(?:^|[^0-9&>])>>?\s*("([^"]+)"|'([^']+)'|(\S+))/g;
    let r;
    while ((r = redirezione.exec(s)) !== null) destinazioni.push(r[2] || r[3] || r[4]);
    if (/^(cp|copy|copy-item|mv|move|move-item|xcopy|robocopy)$/.test(verbo) && argomenti.length >= 2) {
      destinazioni.push(argomenti[argomenti.length - 1]);
    } else if (/^(rm|del|erase|rmdir|rd|remove-item|set-content|out-file|add-content|clear-content|truncate)$/.test(verbo)) {
      argomenti.forEach(function (a) { destinazioni.push(a); });
    } else if (verbo === 'sed' && /\s-i\b/.test(s) && argomenti.length) {
      destinazioni.push(argomenti[argomenti.length - 1]);
    }
  });
  return destinazioni.filter(Boolean);
}

function percorsiAssolutiNelComando(comando) {
  const trovati = [];
  const re = /(?:[A-Za-z]:[\\/][^\s"';&|]+|\\\\[^\s"';&|]+|\/(?:Users|home|etc|var|opt|root|tmp)\/[^\s"';&|]*)/g;
  let match;
  while ((match = re.exec(String(comando || ''))) !== null) trovati.push(match[0]);
  return trovati;
}

function comandoIrreversibile(comando) {
  const c = String(comando || '').trim();
  if (/\bgit\s+(?:-C\s+\S+\s+)?(?:reset\s+--hard|clean\s+-[^\s]*f|checkout\s+--|restore\b[^\r\n;&|]*--worktree)/i.test(c)) {
    return 'I comandi Git che scartano modifiche o puliscono file non tracciati sono bloccati: prima usa una copia recuperabile o un commit.';
  }
  if (/\b(?:format(?:\.com)?|diskpart|clear-disk|initialize-disk|mkfs(?:\.\w+)?|shutdown|stop-computer|restart-computer)\b/i.test(c)) {
    return 'Comando di sistema distruttivo bloccato.';
  }
  if (/\bdd\s+[^\r\n;&|]*\bof\s*=\s*(?:\\\\\.\\PhysicalDrive|\/dev\/)/i.test(c)) {
    return 'Scrittura diretta su disco bloccata.';
  }
  return '';
}

function bersaglioTroppoAmpio(destinazione, cwd) {
  const d = String(destinazione || '').replace(/^['"]|['"]$/g, '').trim();
  if (!d || /^(?:\.|\.\/|\.\\|\*|\.\*|\.\.)(?:[\\/])?$/.test(d)) return true;
  try {
    const resolved = path.isAbsolute(d) ? path.resolve(d) : path.resolve(cwd || '.', d);
    const root = path.parse(resolved).root;
    return normale(resolved) === normale(cwd) || normale(resolved) === normale(root);
  } catch (e) {
    return true;
  }
}

function giudicaComando(comando, contesto) {
  contesto = contesto || {};
  const cwd = contesto.cwd || '';
  const testo = String(comando || '');
  if (!testo.trim()) return { permessa: true };
  if (!cwd || !fs.existsSync(cwd)) {
    return { permessa: false, motivo: 'Comando bloccato: la cartella di lavoro non e\' valida.' };
  }

  const irreversibile = comandoIrreversibile(testo);
  if (irreversibile) return { permessa: false, motivo: irreversibile };

  const destinazioni = destinazioniDelComando(testo);
  const fuori = destinazioni.find(function (d) {
    const assoluto = path.isAbsolute(d) ? d : path.resolve(cwd || '.', d);
    return !dentroProgetto(cwd, assoluto);
  });
  if (fuori) {
    const assoluto = path.isAbsolute(fuori) ? fuori : path.resolve(cwd || '.', fuori);
    if (fuoriDalloStudio(cwd) && dentro(CARTELLA_STUDIO, assoluto)) {
      return { permessa: false, motivo: motivoStudio(assoluto, 'Se ti serve un file dello Studio, copialo DAL Studio NEL progetto, mai il contrario.', cwd) };
    }
    return { permessa: false, motivo: 'Comando bloccato: tenterebbe di scrivere o cancellare fuori dal progetto attivo: ' + assoluto };
  }

  const cancella = /(^|[;&|]\s*)(?:rm|del|erase|rmdir|rd|remove-item|clear-content)\b/i.test(testo);
  if (cancella && (!destinazioni.length || destinazioni.some(function (d) { return bersaglioTroppoAmpio(d, cwd); }))) {
    return { permessa: false, motivo: 'Cancellazione troppo ampia bloccata: indica un file o una sottocartella precisa, mai il progetto intero, "." o "*".' };
  }

  // PowerShell/cmd annidati possono nascondere la destinazione al parser principale.
  const scrive = /\b(set-content|out-file|add-content|clear-content|remove-item|move-item|copy-item|del|erase|rmdir|rm|mv|cp)\b|>>?/i.test(testo);
  const shellAnnidata = /^\s*(?:powershell(?:\.exe)?|pwsh(?:\.exe)?|cmd(?:\.exe)?|bash|sh)\b/i.test(testo);
  if (scrive && shellAnnidata) {
    const assolutiFuori = percorsiAssolutiNelComando(testo).find(function (p) {
      return !dentroProgetto(cwd, p);
    });
    if (assolutiFuori) {
      return { permessa: false, motivo: 'Comando bloccato: contiene una destinazione fuori dal progetto attivo: ' + assolutiFuori };
    }
  }
  return { permessa: true };
}

// ------------------------------------------------------------------ i giri a vuoto
//
// Visto dal vivo (18/9/2026, 12:37): la stessa identica Grep, tredici volte di fila, una ogni sei
// secondi, senza cambiare niente in mezzo. Il risultato era sempre lo stesso e Adam non se ne
// accorgeva. Qui si contano le chiamate uguali fatte DOPO l'ultima modifica a un file: la terza
// viene fermata. Dopo una modifica il conto riparte (rileggere un file appena cambiato e' giusto),
// e anche dopo una compattazione, perche' li' la memoria di Adam si e' svuotata davvero.

const CARTELLA_STATO = path.join(require('os').tmpdir(), 'studio-guardiano');
const MAX_UGUALI = 2;                 // la terza chiamata identica si ferma
const MAX_FALLIMENTI = 3;             // il quarto tentativo fallito sullo stesso bersaglio si ferma
const STRUMENTI_CHE_MODIFICANO = /^(Write|Edit|MultiEdit|NotebookEdit)$/;

function fileStato(sessione) {
  return path.join(CARTELLA_STATO, String(sessione || 'senza-sessione').replace(/[^\w-]/g, '_') + '.json');
}

function leggiStato(sessione) {
  try { return JSON.parse(fs.readFileSync(fileStato(sessione), 'utf8')); } catch (e) { return { chiamate: [], ultimaModifica: 0, fallimenti: {} }; }
}

function scriviStato(sessione, stato) {
  try {
    fs.mkdirSync(CARTELLA_STATO, { recursive: true });
    // Una sessione nuova: si butta lo stato di quelle vecchie di piu' di due giorni.
    if (!fs.existsSync(fileStato(sessione))) {
      const limite = Date.now() - 2 * 24 * 3600 * 1000;
      fs.readdirSync(CARTELLA_STATO).forEach(function (n) {
        if (!/\.json$/.test(n)) return;
        const f = path.join(CARTELLA_STATO, n);
        try { if (fs.statSync(f).mtimeMs < limite) fs.unlinkSync(f); } catch (e) { /* gia' sparito */ }
      });
    }
    stato.chiamate = (stato.chiamate || []).slice(-40);
    fs.writeFileSync(fileStato(sessione), JSON.stringify(stato));
  } catch (e) { /* senza stato il guardiano non ferma i giri a vuoto, tutto qui */ }
}

// Lo Studio segna qui l'ora dell'ultima compattazione (server.js).
function ultimaCompattazione() {
  try { return Number(fs.readFileSync(path.join(CARTELLA_STATO, 'compattazione.txt'), 'utf8')) || 0; } catch (e) { return 0; }
}

function chiaveChiamata(strumento, input) {
  const i = input || {};
  const campi = {};
  Object.keys(i).sort().forEach(function (k) { campi[k] = i[k]; });
  return strumento + ' ' + JSON.stringify(campi);
}

function bersaglioOperazione(strumento, input) {
  const i = input || {};
  const file = i.file_path || i.notebook_path || i.path;
  if (file) {
    try { return path.resolve(String(file)).toLowerCase(); } catch (e) { return String(file).toLowerCase(); }
  }
  if (strumento === 'Bash') return String(i.command || '').replace(/\s+/g, ' ').trim().toLowerCase();
  return JSON.stringify(i);
}

function chiaveFallimento(strumento, input) {
  return String(strumento || '') + '|' + bersaglioOperazione(strumento, input);
}

function registraEsito(strumento, input, sessione, errore, dettaglio) {
  if (!sessione || !strumento) return;
  const stato = leggiStato(sessione);
  stato.fallimenti = stato.fallimenti || {};
  const chiave = chiaveFallimento(strumento, input);
  if (errore) {
    const prima = stato.fallimenti[chiave] || { conteggio: 0 };
    stato.fallimenti[chiave] = {
      conteggio: Number(prima.conteggio || 0) + 1,
      ultimo: Date.now(),
      dettaglio: String(dettaglio || '').slice(0, 500)
    };
  } else {
    delete stato.fallimenti[chiave];
    // Rileggere con successo il file e' il modo corretto per uscire da una serie di
    // Edit fallite per contenuto non piu' aggiornato.
    if (strumento === 'Read') {
      const target = bersaglioOperazione(strumento, input);
      Object.keys(stato.fallimenti).forEach(function (k) {
        if (k.endsWith('|' + target)) delete stato.fallimenti[k];
      });
    }
  }
  scriviStato(sessione, stato);
}

function giudicaFallimenti(strumento, input, sessione) {
  if (!sessione || !strumento) return { permessa: true };
  const stato = leggiStato(sessione);
  const fallimento = (stato.fallimenti || {})[chiaveFallimento(strumento, input)];
  if (!fallimento || Number(fallimento.conteggio || 0) < MAX_FALLIMENTI) return { permessa: true };
  return {
    permessa: false,
    motivo: 'Circuit breaker: questo stesso tentativo e\' gia\' fallito ' + fallimento.conteggio +
      ' volte. Non ripeterlo con piccole varianti. Rileggi il file o l\'errore corrente, cambia strategia e poi riprova. ' +
      (fallimento.dettaglio ? 'Ultimo errore: ' + fallimento.dettaglio : '')
  };
}

function azzeraFallimenti(sessione) {
  if (!sessione) return;
  const stato = leggiStato(sessione);
  stato.fallimenti = {};
  scriviStato(sessione, stato);
}

function giudicaGiroAVuoto(strumento, input, sessione, adesso) {
  // Solo per le sessioni vere di Adam: senza sessione (una prova a mano, un input rotto) le
  // chiamate di persone e momenti diversi finirebbero nello stesso conto.
  if (!sessione || !strumento) return { permessa: true };
  const quando = adesso || Date.now();
  const stato = leggiStato(sessione);
  if (STRUMENTI_CHE_MODIFICANO.test(strumento)) {
    stato.ultimaModifica = quando;
    scriviStato(sessione, stato);
    return { permessa: true };
  }
  const chiave = chiaveChiamata(strumento, input);
  const da = Math.max(stato.ultimaModifica || 0, ultimaCompattazione());
  const gia = (stato.chiamate || []).filter(function (c) { return c.k === chiave && c.t > da; }).length;
  if (gia >= MAX_UGUALI) {
    return {
      permessa: false,
      motivo: 'Questa stessa ' + (strumento === 'Bash' ? 'istruzione' : 'ricerca') + ' l\'hai gia\' fatta ' + gia +
        ' volte e da allora non hai cambiato niente: il risultato e\' identico. Non ripeterla. Usa quello che hai ' +
        'gia\' trovato e fai il prossimo passo, oppure cerca una cosa DIVERSA. Se sei bloccato, dillo chiaro all\'utente.'
    };
  }
  stato.chiamate = (stato.chiamate || []).concat([{ k: chiave, t: quando }]);
  scriviStato(sessione, stato);
  return { permessa: true };
}

function rispostaHook(giudizio) {
  if (giudizio.permessa) return JSON.stringify({});
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: giudizio.motivo
    }
  });
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const valore = function (nome) {
    const i = argv.indexOf(nome);
    return i !== -1 && argv[i + 1] ? argv[i + 1] : null;
  };
  const limiti = {
    caratteri: Number(valore('--caratteri')) || 0,
    righe: Number(valore('--righe')) || 0,
    mirate: Number(valore('--mirate')) || 0,
    finestra: Number(valore('--finestra')) || 0
  };
  // Prova da riga di comando: node guardiano-letture.js --prova <file>
  const prova = valore('--prova');
  if (prova) {
    const g = giudica({ file_path: prova }, limiti);
    console.log(g.permessa ? 'lettura permessa' : g.motivo);
    process.exit(0);
  }
  let dati = {};
  let inputValido = true;
  try { dati = JSON.parse(leggiStdin() || '{}'); } catch (e) { dati = {}; inputValido = false; }
  let giudizio = { permessa: true };
  let strumento = '';
  try {
    strumento = String(dati.tool_name || '');
    const contesto = { cwd: dati.cwd || process.cwd() };
    if (strumento === 'Read') giudizio = giudica(dati.tool_input || {}, limiti);
    else if (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(strumento)) giudizio = giudicaScrittura(strumento, dati.tool_input || {}, contesto);
    else if (strumento === 'Bash') giudizio = giudicaComando(String((dati.tool_input || {}).command || ''), contesto);
    if (giudizio.permessa) giudizio = giudicaFallimenti(strumento, dati.tool_input || {}, dati.session_id);
    // Per ultimo il giro a vuoto: una chiamata gia' fermata per un altro motivo non conta.
    if (giudizio.permessa) giudizio = giudicaGiroAVuoto(strumento, dati.tool_input || {}, dati.session_id);
  } catch (e) {
    // Letture/ricerche restano fail-open; scritture e shell sono fail-closed.
    giudizio = /^(Write|Edit|MultiEdit|NotebookEdit|Bash)$/.test(strumento)
      ? { permessa: false, motivo: 'Guard rail non riuscito: operazione con effetti bloccata per sicurezza (' + e.message + ').' }
      : { permessa: true };
  }
  if (!inputValido) giudizio = { permessa: true };
  process.stdout.write(rispostaHook(giudizio));
  process.exit(0);
}

module.exports = {
  giudica: giudica,
  giudicaImmagine: giudicaImmagine,
  giudicaScrittura: giudicaScrittura,
  giudicaComando: giudicaComando,
  dentroProgetto: dentroProgetto,
  giudicaGiroAVuoto: giudicaGiroAVuoto,
  giudicaFallimenti: giudicaFallimenti,
  registraEsito: registraEsito,
  azzeraFallimenti: azzeraFallimenti,
  CARTELLA_STATO: CARTELLA_STATO,
  destinazioniDelComando: destinazioniDelComando,
  CARTELLA_STUDIO: CARTELLA_STUDIO,
  misuraFile: misuraFile,
  rispostaHook: rispostaHook,
  MAX_CARATTERI: MAX_CARATTERI,
  MAX_RIGHE: MAX_RIGHE,
  RIGHE_MIRATE: RIGHE_MIRATE,
  CARATTERI_PER_TOKEN: CARATTERI_PER_TOKEN
};
