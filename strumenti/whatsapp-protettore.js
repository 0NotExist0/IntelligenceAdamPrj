'use strict';

// ============================================================
// WHATSAPP PROTETTORE — Modulo di Analisi Relazionale e Antifrode
//
// Analizza i messaggi in arrivo nel loro contesto di conversazione:
// 1. Intenzione reale: cosa intende davvero dire la persona tra le righe.
// 2. Rilevatore truffe: individua tentativi di frode, phishing, finti parenti,
//    richieste di codici OTP, bonifici urgenti, link pericolosi.
// 3. Rilevatore emotivo: misura se la persona è arrabbiata, aggressiva,
//    passivo-aggressiva o manipolativa.
// 4. Riconoscimento schemi: pattern noti di manipolazione o deviazione
//    dallo stile normale del contatto.
// 5. Scudo protettivo: consigli pratici su cosa fare e risposte suggerite.
// ============================================================

const http  = require('http');
const https = require('https');
const path  = require('path');
const fs    = require('fs');

// ────────────────────────────────────────────────────────────
// 1. PATTERN EURISTICI RAPIDI (Latenza 0)
// ────────────────────────────────────────────────────────────

const PATTERNS_TRUFFA = [
  {
    id: 'finto_figlio_parente',
    nome: 'Truffa del Finto Figlio / Parente ("Ho perso il telefono")',
    regex: /(ciao\s+(mamma|pap[aà]|nonn[ao])|ho\s+perso\s+il\s+(telefono|cellulare|cell)|questo\s+[eè]\s+il\s+mio\s+nuovo\s+numero|scrivimi\s+(qui|su\s+questo)|si\s+[eè]\s+rotto\s+il\s+telefono|ho\s+dovuto\s+cambiare\s+numero)/i,
    gravita: 'critico',
    punti: 95,
    spiegazione: 'Tipica truffa del finto figlio/parente: il malintenzionato finge di aver perso il telefono per instaurare un canale falso e chiedere denaro o bonifici urgenti poco dopo.'
  },
  {
    id: 'richiesta_otp_codice',
    nome: 'Richiesta Codice di Verifica / OTP',
    regex: /(codice\s+a\s+6\s+cifre|codice\s+di\s+(conferma|verifica|sicurezza)|inviami\s+il\s+codice|mandami\s+il\s+codice|ti\s+[eè]\s+arrivato\s+un\s+sms|dimmi\s+il\s+pin)/i,
    gravita: 'critico',
    punti: 98,
    spiegazione: 'Tentativo di furto account o autorizzazione bonifico: MAI condividere codici di verifica o OTP ricevuti via SMS.'
  },
  {
    id: 'finta_banca_poste',
    nome: 'Phishing Bancario / Postale',
    regex: /(postepay|bancoposta|intesa|unicredit|conto\s+sospeso|accesso\s+anomalo|conto\s+bloccato|storno\s+urgente|bonifico\s+non\s+autorizzato|aggiorna\s+i\s+tuoi\s+dati)/i,
    gravita: 'alto',
    punti: 90,
    spiegazione: 'Falso allarme di sicurezza per indurre al panico e spingere a cliccare su siti clone o fornire credenziali bancarie.'
  },
  {
    id: 'falso_pacco_dogana',
    nome: 'Truffa del Falso Pacco / Spedizione Sospesa',
    regex: /(pacco\s+(in\s+attesa|sospeso|bloccato|trattenuto)|mancata\s+consegna|spese\s+di\s+spedizione|tassa\s+doganale|svincola\s+il\s+pacco)/i,
    gravita: 'alto',
    punti: 85,
    spiegazione: 'Tentativo di sottrarre dati della carta di credito con il pretesto di piccole commissioni per sbloccare una spedizione mai ordinata.'
  },
  {
    id: 'lavoro_facile_crypto',
    nome: 'Falsa Offerta di Lavoro / Rendita Facile',
    regex: /(lavoro\s+(da\s+casa|online)|guadagn[ao]\s+\d+\s*(€|euro)|compiti\s+semplici|mettere\s+like|recensioni\s+google|investimento\s+(sicuro|garantito|crypto)|rendita\s+giornaliera)/i,
    gravita: 'medio',
    punti: 75,
    spiegazione: 'Schema piramidale o truffa delle recensioni: promette facili guadagni per poi chiedere depositi cauzionali o denaro.'
  },
  {
    id: 'estorsione_webcam',
    nome: 'Tentativo di Ricatto o Minaccia',
    regex: /(ho\s+(le\s+tue\s+foto|registrato\s+la\s+tua\s+webcam)|invio\s+ai\s+tuoi\s+contatti|hai\s+\d+\s+ore|paga\s+in\s+bitcoin|non\s+avvisare\s+la\s+polizia)/i,
    gravita: 'critico',
    punti: 100,
    spiegazione: 'Tentativo di estorsione/sextortion basato su bluff e intimidazione psicologica.'
  }
];

const PATTERNS_RABBIA = [
  {
    id: 'insulti_espliciti',
    tipo: 'aggressivo',
    regex: /(idiota|cretin[ao]|stupid[ao]|imbecille|vaffanculo|stronz[ao]|incompetente|fai\s+schifo|maledett[ao])/i,
    intensita: 'molto alta'
  },
  {
    id: 'rimprovero_esasperato',
    tipo: 'arrabbiato',
    regex: /(vergognati|[eè]\s+l'ultima\s+volta|non\s+voglio\s+pi[uù]\s+sentirti|basta\s+ora|hai\s+rotto|mi\s+hai\s+stancato|fai\s+ridere|pretendo\s+spiegazioni)/i,
    intensita: 'alta'
  },
  {
    id: 'urgenza_pressante',
    tipo: 'pressante',
    regex: /(rispondi\s+subito|immediatamente|ora\s+stesso|rispondi\s+al\s+telefono|chiamami\s+subito|non\s+farmi\s+aspettare)/i,
    intensita: 'media'
  },
  {
    id: 'passivo_aggressivo',
    tipo: 'passivo-aggressivo',
    regex: /(fai\s+come\s+ti\s+pare|tanto\s+non\s+ti\s+importa|non\s+fa\s+niente\s+lascia\s+stare|dopo\s+tutto\s+quello\s+che\s+ho\s+fatto|grazie\s+per\s+il\s+nulla|nessun\s+problema\s*\.\.\.)/i,
    intensita: 'media'
  }
];

// Rileva link sospetti (es. IP nudi, domini insoliti, shortener mascherati)
function rilevaLinkSospetti(testo) {
  const urlRegex = /(https?:\/\/[^\s]+)/gi;
  const match = testo.match(urlRegex) || [];
  const sospetti = [];

  match.forEach(function (u) {
    try {
      const parsed = new URL(u);
      const host = parsed.hostname.toLowerCase();
      // IP nudo (es. http://192.168.1.1 o http://45.33...)
      if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) {
        sospetti.push({ url: u, motivo: 'L\'indirizzo usa un IP numerico diretto invece di un nome di dominio verificato.' });
      }
      // Domini ad alto rischio truffa comune
      if (/\.(xyz|top|work|click|buzz|loan|fit|gq|cf|tk|ml)$/i.test(host)) {
        sospetti.push({ url: u, motivo: 'Estensione di dominio insolita (' + host + ') comunemente usata per phishing temporaneo.' });
      }
      // Falsificazione marchi (typosquatting banche / poste)
      if (/(poste|banca|inps|agenziaentr|amazon|whatsapp|apple|google).*\.(?!it|com|org|net)[a-z]{2,}/i.test(host)) {
        sospetti.push({ url: u, motivo: 'Possibile dominio clone che imita un marchio noto.' });
      }
    } catch (e) {
      sospetti.push({ url: u, motivo: 'URL malformato o offuscato.' });
    }
  });

  return sospetti;
}

// ────────────────────────────────────────────────────────────
// 2. ANALISI EURISTICA IMMEDIATA
// ────────────────────────────────────────────────────────────

function analizzaEuristica(messaggio, contesto) {
  const testo = String(messaggio || '').trim();
  if (!testo) {
    return {
      rischio: 'basso',
      punteggioRischio: 0,
      truffa: { rilevata: false, tipi: [] },
      emozione: { arrabbiata: false, tipo: 'neutro', intensita: 'nessuna' },
      schemi: [],
      linkSospetti: []
    };
  }

  // 1. Truffe
  const truffeTrovate = [];
  let maxPuntiTruffa = 0;
  PATTERNS_TRUFFA.forEach(function (p) {
    if (p.regex.test(testo)) {
      truffeTrovate.push({
        id: p.id,
        nome: p.nome,
        gravita: p.gravita,
        spiegazione: p.spiegazione
      });
      if (p.punti > maxPuntiTruffa) maxPuntiTruffa = p.punti;
    }
  });

  // Link sospetti
  const linkSospetti = rilevaLinkSospetti(testo);
  if (linkSospetti.length > 0 && maxPuntiTruffa < 80) {
    maxPuntiTruffa = 80;
  }

  // 2. Emozioni / Rabbia
  let emozioneRilevata = { arrabbiata: false, tipo: 'calmo', intensita: 'bassa' };
  for (let i = 0; i < PATTERNS_RABBIA.length; i++) {
    const p = PATTERNS_RABBIA[i];
    if (p.regex.test(testo)) {
      emozioneRilevata = {
        arrabbiata: p.tipo === 'arrabbiato' || p.tipo === 'aggressivo',
        tipo: p.tipo,
        intensita: p.intensita
      };
      break;
    }
  }

  // Se testo tutto in maiuscolo (almeno 15 caratteri)
  const soloLettere = testo.replace(/[^a-zA-Z]/g, '');
  if (soloLettere.length >= 12 && soloLettere === soloLettere.toUpperCase()) {
    emozioneRilevata.arrabbiata = true;
    emozioneRilevata.tipo = emozioneRilevata.tipo === 'calmo' ? 'urla / irritato' : emozioneRilevata.tipo;
    emozioneRilevata.intensita = 'alta';
  }

  // Punteggiatura multipla allarmata (es. ??? o !!!)
  if (/([?!]{3,})/.test(testo)) {
    if (emozioneRilevata.tipo === 'calmo') emozioneRilevata.tipo = 'agitato / insistente';
  }

  // 3. Schemi rilevati
  const schemi = [];
  if (truffeTrovate.length > 0) {
    schemi.push('Schema di ingegneria sociale con esca per creare urgenza o preoccupazione.');
  }
  if (testo.toLowerCase().includes('urgente') || testo.toLowerCase().includes('subito')) {
    schemi.push('Pattern di finta urgenza per impedire un ragionamento lucido.');
  }
  if (testo.toLowerCase().includes('non dire a') || testo.toLowerCase().includes('tra noi')) {
    schemi.push('Tentativo di isolamento: chiede di non verificare con terzi.');
  }

  let livelloRischio = 'basso';
  if (maxPuntiTruffa >= 85) livelloRischio = 'critico';
  else if (maxPuntiTruffa >= 60 || emozioneRilevata.arrabbiata) livelloRischio = 'alto';
  else if (maxPuntiTruffa >= 30 || linkSospetti.length > 0) livelloRischio = 'medio';

  return {
    rischio: livelloRischio,
    punteggioRischio: maxPuntiTruffa,
    truffa: {
      rilevata: truffeTrovate.length > 0 || linkSospetti.length > 0,
      tipi: truffeTrovate
    },
    emozione: emozioneRilevata,
    schemi: schemi,
    linkSospetti: linkSospetti
  };
}

// ────────────────────────────────────────────────────────────
// 3. ANALISI SEMANTICA PROFONDA CON LLM (Ollama o Cloud)
// ────────────────────────────────────────────────────────────

function buildPromptAnalisi(contatto, messaggio, contestoPrecedente) {
  const parti = [
    'Sei il "Protettore Personale" dell\'utente: un consulente di sicurezza digitale, psicologia relazionale e antifrode.',
    'Il tuo compito è proteggere l\'utente analizzando con estrema lucidità e attenzione un messaggio ricevuto su WhatsApp.',
    '',
    'Devi rispondere ESCLUSIVAMENTE con un oggetto JSON valido (senza testo prima né dopo, nessun markdown ```json```).',
    '',
    'FORMATO JSON RICHIESTO:',
    '{',
    '  "intenzione": "Spiegazione chiara di cosa intende VERAMENTE chi ha scritto (cosa vuole ottenere, sia in modo esplicito che sottinteso).",',
    '  "livelloRischio": "basso" | "medio" | "alto" | "critico",',
    '  "punteggioRischio": numero da 0 a 100,',
    '  "truffa": {',
    '    "rilevata": true | false,',
    '    "tipo": "Nome della tipologia (es. Finto parente, Phishing bancario, Furto OTP, Rendita crypto, Nessuna)",',
    '    "motivo": "Perché è o non è una truffa, dettagli e bandiere rosse."',
    '  },',
    '  "emozione": {',
    '    "arrabbiata": true | false,',
    '    "tono": "es. Arrabbiata, Calma, Manipolativa, Ansiosa, Fredda, Cordiale, Affettuosa",',
    '    "segnali": ["indizi nel testo su come si sente"]',
    '  },',
    '  "schemi": [',
    '    "Eventuali schemi comportamentali noti: es. love bombing, finta emergenza, gaslighting, pressione psicologica, fretta immotivata, etc."',
    '  ],',
    '  "consiglio": "Cosa deve fare ORA l\'utente per tutelarsi al meglio (es. cosa NON fare, verifiche da compiere).",',
    '  "rispostaSuggerita": "Frase di risposta diplomatica e sicura da inviare, che non cede alla trappola ma protegge l\'utente."',
    '}',
    ''
  ];

  if (contatto) {
    parti.push('MITTENTE / CONTATTO: ' + contatto);
  }

  if (contestoPrecedente && Array.isArray(contestoPrecedente) && contestoPrecedente.length) {
    parti.push('CONTESTO CHAT PRECEDENTE:');
    contestoPrecedente.slice(-8).forEach(function (m) {
      const chi = m.daMe ? 'Io' : (m.mittente || 'Interlocutore');
      parti.push('[' + chi + ']: ' + m.testo);
    });
    parti.push('');
  }

  parti.push('ULTIMO MESSAGGIO DA ANALIZZARE:');
  parti.push('"' + messaggio + '"');
  parti.push('');
  parti.push('Restituisci solo l\'oggetto JSON:');

  return parti.join('\n');
}

// Chiamata HTTP al modello (stessa architettura flessibile di programmatore.js)
function chiediAlModello(o) {
  return new Promise(function (resolve) {
    const inizio = Date.now();
    let finito = false;
    let timer = null;
    let req = null;

    const fine = function (res) {
      if (finito) return;
      finito = true;
      clearTimeout(timer);
      resolve(Object.assign({ testo: '', durataMs: Date.now() - inizio }, res || {}));
    };

    timer = setTimeout(function () {
      if (req) req.destroy();
      fine({ errore: 'timeout analisi LLM' });
    }, o.timeoutMs || 20000);

    const modello = String(o.modello || '').trim();

    // 1. Anthropic Claude
    if (modello.toLowerCase().startsWith('claude-')) {
      const apiKey = o.apiKey || process.env.ANTHROPIC_API_KEY || '';
      let urlEndpoint = 'https://api.anthropic.com/v1/messages';
      if (o.baseUrl && !o.baseUrl.includes(':11434')) {
        const cleanBase = o.baseUrl.replace(/\/+$/, '');
        urlEndpoint = cleanBase.endsWith('/v1') ? cleanBase + '/messages' : cleanBase + '/v1/messages';
      }

      let parsedUrl;
      try { parsedUrl = new URL(urlEndpoint); } catch (e) {
        return fine({ errore: 'URL Anthropic non valido: ' + e.message });
      }

      const bodyData = JSON.stringify({
        model: modello,
        max_tokens: 1500,
        temperature: 0.1,
        messages: [{ role: 'user', content: o.prompt }]
      });

      const headers = {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(bodyData),
        'anthropic-version': '2023-06-01'
      };
      if (apiKey) headers['x-api-key'] = apiKey;
      if (o.authToken && !apiKey) headers['authorization'] = 'Bearer ' + o.authToken;

      const lib = parsedUrl.protocol === 'https:' ? https : http;
      req = lib.request(parsedUrl, { method: 'POST', headers: headers }, function (res) {
        let respText = '';
        res.setEncoding('utf8');
        res.on('data', function (c) { respText += c; });
        res.on('end', function () {
          if (res.statusCode !== 200) return fine({ errore: 'Anthropic HTTP ' + res.statusCode });
          try {
            const j = JSON.parse(respText);
            const text = (j.content || []).map(function (b) { return b.text || ''; }).join('');
            fine({ testo: text });
          } catch (e) {
            fine({ errore: e.message });
          }
        });
      });
      req.on('error', function (e) { fine({ errore: e.message }); });
      req.write(bodyData);
      req.end();
      return;
    }

    // 2. OpenAI / DeepSeek
    if (modello.toLowerCase().startsWith('gpt-') || modello.toLowerCase().startsWith('o1-') || modello.toLowerCase().startsWith('o3-') || modello.toLowerCase().startsWith('deepseek-')) {
      const apiKey = o.apiKey || process.env.OPENAI_API_KEY || (modello.toLowerCase().startsWith('deepseek-') ? process.env.DEEPSEEK_API_KEY : '') || '';
      let urlEndpoint = 'https://api.openai.com/v1/chat/completions';
      if (modello.toLowerCase().startsWith('deepseek-')) urlEndpoint = 'https://api.deepseek.com/chat/completions';
      if (o.baseUrl && !o.baseUrl.includes(':11434')) {
        const cleanBase = o.baseUrl.replace(/\/+$/, '');
        urlEndpoint = cleanBase.endsWith('/v1') ? cleanBase + '/chat/completions' : cleanBase + '/v1/chat/completions';
      }

      let parsedUrl;
      try { parsedUrl = new URL(urlEndpoint); } catch (e) {
        return fine({ errore: 'URL Cloud non valido: ' + e.message });
      }

      const bodyData = JSON.stringify({
        model: modello,
        max_tokens: 1500,
        temperature: 0.1,
        messages: [{ role: 'user', content: o.prompt }]
      });

      const headers = {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(bodyData)
      };
      if (apiKey) headers['authorization'] = 'Bearer ' + apiKey;

      const lib = parsedUrl.protocol === 'https:' ? https : http;
      req = lib.request(parsedUrl, { method: 'POST', headers: headers }, function (res) {
        let respText = '';
        res.setEncoding('utf8');
        res.on('data', function (c) { respText += c; });
        res.on('end', function () {
          if (res.statusCode !== 200) return fine({ errore: 'Cloud HTTP ' + res.statusCode });
          try {
            const j = JSON.parse(respText);
            const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
            fine({ testo: text });
          } catch (e) {
            fine({ errore: e.message });
          }
        });
      });
      req.on('error', function (e) { fine({ errore: e.message }); });
      req.write(bodyData);
      req.end();
      return;
    }

    // 3. Ollama locale predefinito
    let url;
    try {
      url = new URL(String(o.baseUrl || 'http://localhost:11434').replace(/\/+$/, '') + '/api/chat');
    } catch (e) {
      return fine({ errore: 'URL Ollama non valido: ' + e.message });
    }

    const richiesta = {
      model: modello || 'qwen3.5-studio:9b',
      stream: false,
      options: { temperature: 0.1, num_ctx: 8192 },
      messages: [{ role: 'user', content: o.prompt }]
    };

    const corpo = JSON.stringify(richiesta);
    const lib = url.protocol === 'https:' ? https : http;
    req = lib.request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(corpo)
      }
    }, function (res) {
      let accumulo = '';
      res.setEncoding('utf8');
      res.on('data', function (c) { accumulo += c; });
      res.on('end', function () {
        if (res.statusCode !== 200) return fine({ errore: 'Ollama HTTP ' + res.statusCode });
        try {
          const j = JSON.parse(accumulo);
          const testo = (j.message && j.message.content) || '';
          fine({ testo: testo });
        } catch (e) {
          fine({ errore: e.message });
        }
      });
    });

    req.on('error', function (e) { fine({ errore: e.message }); });
    req.write(corpo);
    req.end();
  });
}

function estraiJson(testo) {
  if (!testo) return null;
  // Rimuovi eventuali blocchi ```json ... ```
  let pulito = testo.trim();
  pulito = pulito.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  try {
    return JSON.parse(pulito);
  } catch (e) {
    // Cerca la prima { e l'ultima }
    const prima = pulito.indexOf('{');
    const ultima = pulito.lastIndexOf('}');
    if (prima !== -1 && ultima !== -1 && ultima > prima) {
      try {
        return JSON.parse(pulito.slice(prima, ultima + 1));
      } catch (err2) {}
    }
  }
  return null;
}

// ────────────────────────────────────────────────────────────
// 4. METODO PRINCIPALE DI ANALISI COMPLETA
// ────────────────────────────────────────────────────────────

async function analizzaMessaggio(opzioni) {
  const opt = opzioni || {};
  const messaggio = String(opt.messaggio || '').trim();
  const contatto = String(opt.contatto || 'Mittente sconosciuto').trim();
  const contesto = Array.isArray(opt.contesto) ? opt.contesto : [];

  // Passo 1: Analisi euristica istantanea (sempre disponibile, senza ritardo)
  const euristica = analizzaEuristica(messaggio, contesto);

  // Risultato predefinito basato sull'euristica
  let risultato = {
    contatto: contatto,
    messaggio: messaggio,
    dataOra: new Date().toISOString(),
    intenzione: 'Messaggio diretto dall\'interlocutore.',
    livelloRischio: euristica.rischio,
    punteggioRischio: euristica.punteggioRischio,
    truffa: {
      rilevata: euristica.truffa.rilevata,
      tipo: euristica.truffa.tipi.length ? euristica.truffa.tipi[0].nome : 'Nessuna',
      motivo: euristica.truffa.tipi.length ? euristica.truffa.tipi[0].spiegazione : 'Nessun pattern di truffa evidente rilevato.',
      linkSospetti: euristica.linkSospetti
    },
    emozione: {
      arrabbiata: euristica.emozione.arrabbiata,
      tono: euristica.emozione.tipo,
      intensita: euristica.emozione.intensita,
      segnali: []
    },
    schemi: euristica.schemi,
    consiglio: euristica.truffa.rilevata
      ? 'ATTENZIONE: non inviare codici, non effettuare bonifici e verifica l\'identità della persona chiamandola al suo solito numero.'
      : (euristica.emozione.arrabbiata
        ? 'L\'interlocutore appare irritato o pressante. Rispondi con calma, prenditi del tempo prima di reagire e non lasciarti trascinare nel conflitto.'
        : 'Conversazione ordinaria. Nessun segnale di pericolo immediato.'),
    rispostaSuggerita: euristica.truffa.rilevata
      ? 'Ti chiamo subito al tuo numero ufficiale per verificare.'
      : (euristica.emozione.arrabbiata ? 'Ho letto il tuo messaggio, ci rifletto un attimo e ti rispondo con calma.' : ''),
    motore: 'euristico'
  };

  // Passo 2: Se è richiesto o se abbiamo un modello configurato, esegui l'approfondimento LLM
  if (opt.usaLlm !== false && messaggio.length > 3) {
    try {
      const prompt = buildPromptAnalisi(contatto, messaggio, contesto);
      const resLlm = await chiediAlModello({
        prompt: prompt,
        modello: opt.modello || 'qwen3.5-studio:9b',
        baseUrl: opt.baseUrl || 'http://localhost:11434',
        apiKey: opt.apiKey || '',
        authToken: opt.authToken || '',
        timeoutMs: opt.timeoutMs || 15000
      });

      if (resLlm.testo) {
        const parsed = estraiJson(resLlm.testo);
        if (parsed && typeof parsed === 'object') {
          // Fusione intelligente: non abbassare la guardia se l'euristica aveva trovato una truffa certa (es. OTP o link malevoli)
          const rischioFinale = (euristica.punteggioRischio >= 90)
            ? 'critico'
            : (parsed.livelloRischio || euristica.rischio);

          const punteggioFinale = Math.max(euristica.punteggioRischio, Number(parsed.punteggioRischio) || 0);

          risultato = {
            contatto: contatto,
            messaggio: messaggio,
            dataOra: new Date().toISOString(),
            intenzione: parsed.intenzione || risultato.intenzione,
            livelloRischio: rischioFinale,
            punteggioRischio: punteggioFinale,
            truffa: {
              rilevata: euristica.truffa.rilevata || !!(parsed.truffa && parsed.truffa.rilevata),
              tipo: (parsed.truffa && parsed.truffa.tipo && parsed.truffa.tipo !== 'Nessuna')
                ? parsed.truffa.tipo
                : (euristica.truffa.tipi.length ? euristica.truffa.tipi[0].nome : 'Nessuna'),
              motivo: (parsed.truffa && parsed.truffa.motivo)
                ? parsed.truffa.motivo
                : (euristica.truffa.tipi.length ? euristica.truffa.tipi[0].spiegazione : 'Nessun pattern critico.'),
              linkSospetti: euristica.linkSospetti
            },
            emozione: {
              arrabbiata: euristica.emozione.arrabbiata || !!(parsed.emozione && parsed.emozione.arrabbiata),
              tono: (parsed.emozione && parsed.emozione.tono) || euristica.emozione.tipo,
              intensita: (parsed.emozione && parsed.emozione.intensita) || euristica.emozione.intensita,
              segnali: (parsed.emozione && Array.isArray(parsed.emozione.segnali)) ? parsed.emozione.segnali : []
            },
            schemi: Array.from(new Set([
              ...euristica.schemi,
              ...((parsed.schemi && Array.isArray(parsed.schemi)) ? parsed.schemi : [])
            ])),
            consiglio: parsed.consiglio || risultato.consiglio,
            rispostaSuggerita: parsed.rispostaSuggerita || risultato.rispostaSuggerita,
            motore: 'llm_euristico'
          };
        }
      }
    } catch (e) {
      console.warn('[WhatsAppProtettore] Analisi LLM non riuscita, usato fallback euristico:', e.message);
    }
  }

  return risultato;
}

module.exports = {
  analizzaMessaggio,
  analizzaEuristica,
  rilevaLinkSospetti,
  buildPromptAnalisi,
  chiediAlModello,
  estraiJson,
  PATTERNS_TRUFFA,
  PATTERNS_RABBIA
};
