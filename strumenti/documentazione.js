// NotExist Intelligience Studio - Gestione Documentazione e Fonti per Adam.
//
// Permette all'utente di fornire link web, PDF, immagini e file locali ad Adam.
// Per Unity, la fonte primaria e' https://learn.unity.com/ con verifica dell'ultima versione.
// Se le informazioni non bastano, Adam DEVE avvisare l'utente prima di cercare da solo.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE_PREDEFINITO = path.join(__dirname, '..', 'dati', 'documentazione.json');
const CARTELLA_FILE = path.join(__dirname, '..', 'dati', 'documenti');
const FONTE_PRIMARIA_UNITY = 'https://learn.unity.com/';
const MAX_DOCUMENTI = 100;

function assicuraCartelle() {
  fs.mkdirSync(path.dirname(FILE_PREDEFINITO), { recursive: true });
  fs.mkdirSync(CARTELLA_FILE, { recursive: true });
}

function normalizzaUrl(raw) {
  let u = String(raw || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try {
    const parsed = new URL(u);
    if (!parsed.hostname) return '';
    return parsed.href;
  } catch (e) {
    return '';
  }
}

function rilevaTipo(nomeOUrl) {
  const str = String(nomeOUrl || '').toLowerCase();
  if (/^https?:\/\//i.test(str)) return 'url';
  if (/\.pdf$/i.test(str)) return 'pdf';
  if (/\.(png|jpe?g|webp|gif|svg|bmp)$/i.test(str)) return 'immagine';
  if (/\.(cs|js|ts|py|json|md|txt|html|css|yaml|yml)$/i.test(str)) return 'testo';
  return 'file';
}

function carica(file) {
  const f = file || FILE_PREDEFINITO;
  try {
    if (!fs.existsSync(f)) {
      // Inizializza con fonte primaria Unity predefinita
      const iniziale = {
        fontePrimariaUnity: FONTE_PRIMARIA_UNITY,
        documenti: [
          {
            id: 'unity_learn_official',
            tipo: 'url',
            nome: 'Unity Learn (Ufficiale)',
            origine: FONTE_PRIMARIA_UNITY,
            descrizione: 'Fonte primaria ufficiale per tutorial, architetture, corsi e API per Unity.',
            primario: true,
            ambito: 'unity',
            aggiuntoIl: Date.now()
          }
        ]
      };
      salva(iniziale, f);
      return iniziale;
    }
    const dati = JSON.parse(fs.readFileSync(f, 'utf8'));
    return {
      fontePrimariaUnity: dati.fontePrimariaUnity || FONTE_PRIMARIA_UNITY,
      documenti: Array.isArray(dati.documenti) ? dati.documenti : []
    };
  } catch (e) {
    return { fontePrimariaUnity: FONTE_PRIMARIA_UNITY, documenti: [] };
  }
}

function salva(stato, file) {
  const f = file || FILE_PREDEFINITO;
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(stato, null, 2), 'utf8');
  return stato;
}

function aggiungiUrl(dati, file) {
  const url = normalizzaUrl(dati && dati.url);
  if (!url) return { errore: 'URL non valido' };

  const stato = carica(file);
  const documenti = stato.documenti || [];
  if (documenti.length >= MAX_DOCUMENTI) {
    return { errore: 'Raggiunto il limite massimo di ' + MAX_DOCUMENTI + ' documenti' };
  }

  const nome = String(dati.nome || dati.titolo || url).trim().slice(0, 150);
  const descrizione = String(dati.descrizione || dati.note || '').trim().slice(0, 500);
  const ambito = dati.ambito || (/unity/i.test(url + ' ' + nome + ' ' + descrizione) ? 'unity' : 'generale');

  // Aggiorna se esiste gia'
  const idx = documenti.findIndex(d => d.tipo === 'url' && d.origine.toLowerCase() === url.toLowerCase());
  const nuovo = {
    id: idx !== -1 ? documenti[idx].id : ('doc_' + crypto.randomBytes(4).toString('hex')),
    tipo: 'url',
    nome: nome,
    origine: url,
    descrizione: descrizione,
    ambito: ambito,
    primario: !!dati.primario,
    aggiuntoIl: idx !== -1 ? documenti[idx].aggiuntoIl : Date.now(),
    aggiornatoIl: Date.now()
  };

  if (idx !== -1) documenti[idx] = nuovo;
  else documenti.unshift(nuovo);

  salva({ fontePrimariaUnity: stato.fontePrimariaUnity || FONTE_PRIMARIA_UNITY, documenti: documenti }, file);
  return { ok: true, documento: nuovo, totale: documenti.length };
}

function aggiungiFile(nomeOriginale, buffer, note, file) {
  if (!nomeOriginale || !buffer) return { errore: 'File o contenuto mancante' };

  assicuraCartelle();
  const stato = carica(file);
  const documenti = stato.documenti || [];
  if (documenti.length >= MAX_DOCUMENTI) {
    return { errore: 'Raggiunto il limite massimo di ' + MAX_DOCUMENTI + ' documenti' };
  }

  const id = 'doc_' + crypto.randomBytes(4).toString('hex');
  const estensione = path.extname(nomeOriginale) || '';
  const nomeSicuro = path.basename(nomeOriginale, estensione).replace(/[^a-zA-Z0-9_\-\.]/g, '_') + estensione;
  const destinazioneDisco = path.join(CARTELLA_FILE, id + '_' + nomeSicuro);

  try {
    fs.writeFileSync(destinazioneDisco, buffer);
  } catch (e) {
    return { errore: 'Impossibile salvare il file su disco: ' + e.message };
  }

  const tipo = rilevaTipo(nomeOriginale);
  const ambito = /unity/i.test(nomeOriginale + ' ' + (note || '')) ? 'unity' : 'generale';

  const doc = {
    id: id,
    tipo: tipo,
    nome: nomeOriginale,
    origine: destinazioneDisco,
    percorsoRelativo: path.relative(path.join(__dirname, '..'), destinazioneDisco).split(path.sep).join('/'),
    dimensione: buffer.length,
    descrizione: String(note || '').trim().slice(0, 500),
    ambito: ambito,
    aggiuntoIl: Date.now()
  };

  documenti.unshift(doc);
  salva({ fontePrimariaUnity: stato.fontePrimariaUnity || FONTE_PRIMARIA_UNITY, documenti: documenti }, file);
  return { ok: true, documento: doc, totale: documenti.length };
}

function rimuovi(id, file) {
  if (!id) return { errore: 'ID documento mancante' };
  const stato = carica(file);
  const doc = (stato.documenti || []).find(d => d.id === id);
  if (!doc) return { errore: 'Documento non trovato' };

  // Se e' un file salvato in dati/documenti, rimuovilo dal disco
  if (doc.tipo !== 'url' && doc.origine && fs.existsSync(doc.origine)) {
    try { fs.unlinkSync(doc.origine); } catch (e) {}
  }

  const puliti = (stato.documenti || []).filter(d => d.id !== id);
  salva({ fontePrimariaUnity: stato.fontePrimariaUnity || FONTE_PRIMARIA_UNITY, documenti: puliti }, file);
  return { ok: true, rimosso: id, totale: puliti.length };
}

// Istruzioni e documentazione per il prompt di sistema di Adam
function testoPerPrompt(dir, file) {
  const stato = carica(file);
  const doc = stato.documenti || [];
  let eUnity = false;
  try {
    const radice = dir ? path.resolve(dir) : process.cwd();
    eUnity = fs.existsSync(path.join(radice, 'Assets')) &&
      (fs.existsSync(path.join(radice, 'ProjectSettings')) || fs.existsSync(path.join(radice, 'ProjectSettings', 'ProjectVersion.txt')));
  } catch (e) { eUnity = false; }

  const righe = [];
  righe.push('PANNELLO DOCUMENTAZIONE E FONTI DI RIFERIMENTO PER ADAM:');

  if (eUnity) {
    righe.push('=== REGOLE TASSATIVE PER LO SVILUPPO SU UNITY ===');
    righe.push('1. FONTE PRIMARIA OBBLIGATORIA: https://learn.unity.com/ (e documentazione ufficiale Unity 6).');
    righe.push('   - Prima di scrivere componenti o logiche, consulta https://learn.unity.com/ per pattern, architetture e buone pratiche.');
    righe.push('   - VERIFICA ULTIMA VERSIONE: Assicurati sempre che le classi e le API C# siano aggiornate all\'ultima versione di Unity (Unity 6).');
    righe.push('     Evita metodi deprecati (es. usa FindFirstObjectByType invece di FindObjectOfType, usa il New Input System invece del vecchio Input Manager).');
    righe.push('2. TRASPARENZA E RICERCA AUTONOMA (REGOLA OBBLIGATORIA DELL\'UTENTE):');
    righe.push('   - Se le informazioni che cerchi NON sono presenti o non bastano su https://learn.unity.com/ o nei documenti forniti:');
    righe.push('     DEVI COMUNICARLO ESPLICITAMENTE ALL\'UTENTE prima di procedere, dicendo:');
    righe.push('     "Le informazioni necessarie per [argomento/funzionalità] non sono state trovate su https://learn.unity.com/. Procedo con una ricerca autonoma approfondita (deep search) per individuare la soluzione corretta per Unity."');
    righe.push('   - Dopo aver avvisato l\'utente, esegui una ricerca mirata con: node strumenti/ricerca-web.js --deep "Unity 6 <argomento>"');
  }

  if (doc.length) {
    righe.push('FONTI E DOCUMENTI CONFIGURATI DALL\'UTENTE NEL PANNELLO:');
    doc.forEach(function (d, i) {
      const badge = '[' + d.tipo.toUpperCase() + ']';
      const desc = d.descrizione ? ' (' + d.descrizione + ')' : '';
      const rif = d.tipo === 'url' ? d.origine : (d.nome + ' -> ' + (d.percorsoRelativo || d.origine));
      righe.push((i + 1) + '. ' + badge + ' ' + d.nome + ': ' + rif + desc);
    });
    righe.push('Puoi consultare queste risorse in qualsiasi momento con: node strumenti/ricerca-web.js --visita "<url o percorso file>"');
  }

  return righe.join('\n');
}

function aggiungiDaPayload(payload, file) {
  if (!payload || typeof payload !== 'object') return { errore: 'Payload non valido' };
  if (payload.url) {
    return aggiungiUrl(payload, file);
  }
  let buffer = null;
  let nome = payload.nome || 'documento';
  if (payload.base64) {
    try {
      const b64 = String(payload.base64).replace(/^data:[^;]+;base64,/, '');
      buffer = Buffer.from(b64, 'base64');
    } catch (e) {
      return { errore: 'Contenuto base64 non valido: ' + e.message };
    }
  } else if (payload.percorso && fs.existsSync(payload.percorso)) {
    try {
      buffer = fs.readFileSync(payload.percorso);
      if (!payload.nome) nome = path.basename(payload.percorso);
    } catch (e) {
      return { errore: 'Impossibile leggere il file specificato: ' + e.message };
    }
  } else {
    return { errore: 'Fornisci un URL, un file (base64) o un percorso valido' };
  }
  return aggiungiFile(nome, buffer, payload.note || payload.descrizione, file);
}

module.exports = {
  FILE_PREDEFINITO,
  CARTELLA_FILE,
  FONTE_PRIMARIA_UNITY,
  carica,
  salva,
  aggiungiUrl,
  aggiungiFile,
  aggiungiDaPayload,
  rimuovi,
  rilevaTipo,
  testoPerPrompt
};
