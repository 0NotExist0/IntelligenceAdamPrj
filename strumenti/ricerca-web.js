// NotExist Intelligience Studio - Strumento di Ricerca e Visita Web per Adam.
//
// Permette ad Adam di cercare sul web, consultare i siti consigliati dall'utente
// e visitare URL/documentazione tecnica direttamente tramite lo strumento Bash.
//
// Uso:
//   node ricerca-web.js "query di ricerca"
//   node ricerca-web.js --cerca "query" [--max 5]
//   node ricerca-web.js --visita "https://..." [--max-len 3500]
//   node ricerca-web.js --deep "query"
//   node ricerca-web.js --siti

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const sitiConsigliati = require('./siti-consigliati');
const documentazione = require('./documentazione');

const PORTA = process.env.PORT || 3456;

function leggiArgomenti(argv) {
  const o = {
    cerca: '',
    visita: '',
    deep: '',
    siti: false,
    doc: false,
    max: 5,
    maxLen: 3500
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const succ = function () { return argv[++i]; };
    if (a === '--cerca' || a === '-c') o.cerca = succ() || '';
    else if (a === '--visita' || a === '--leggi' || a === '-v') o.visita = succ() || '';
    else if (a === '--deep' || a === '-d') o.deep = succ() || '';
    else if (a === '--siti' || a === '-s') o.siti = true;
    else if (a === '--doc' || a === '--documenti') o.doc = true;
    else if (a === '--max' || a === '-m') o.max = Math.max(1, Math.min(15, Number(succ()) || 5));
    else if (a === '--max-len') o.maxLen = Math.max(500, Math.min(20000, Number(succ()) || 3500));
    else if (!a.startsWith('-') && !o.cerca && !o.visita && !o.deep) {
      if (/^https?:\/\//i.test(a)) {
        o.visita = a;
      } else {
        o.cerca = a;
      }
    }
  }
  return o;
}

// Chiamata all'API locale dello Studio se attivo
function chiamaStudio(metodo, percorso, corpo) {
  return new Promise(function (resolve) {
    const dati = corpo ? JSON.stringify(corpo) : null;
    const req = http.request({
      host: '127.0.0.1',
      port: PORTA,
      path: percorso,
      method: metodo,
      timeout: 10000,
      headers: dati ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(dati) } : {}
    }, function (res) {
      let testo = '';
      res.setEncoding('utf8');
      res.on('data', function (c) { testo += c; });
      res.on('end', function () {
        let json = null;
        try { json = JSON.parse(testo); } catch (e) {}
        resolve({ status: res.statusCode, json: json, raw: testo });
      });
    });
    req.on('error', function (e) { resolve({ status: 0, errore: e.message }); });
    req.on('timeout', function () { req.destroy(); resolve({ status: 0, errore: 'timeout' }); });
    if (dati) req.write(dati);
    req.end();
  });
}

// Fallback autonomo per fetch HTTP/HTTPS diretto
function fetchUrlDiretto(url, opzioni = {}, _redirect = 0) {
  if (_redirect > 5) return Promise.reject(new Error('Troppi redirect'));
  return new Promise(function (resolve, reject) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      return reject(new Error('URL non valido: ' + url));
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: opzioni.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
        ...(opzioni.headers || {})
      },
      timeout: opzioni.timeout || 12000
    }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const dest = new URL(res.headers.location, url).toString();
        res.resume();
        return fetchUrlDiretto(dest, opzioni, _redirect + 1).then(resolve).catch(reject);
      }
      const parti = [];
      res.on('data', function (d) { parti.push(d); });
      res.on('end', function () {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(parti).toString('utf8')
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', function () { req.destroy(); reject(new Error('Timeout richiesta HTTP')); });
    if (opzioni.body) req.write(opzioni.body);
    req.end();
  });
}

function estraiTestoDaHtml(html, maxLen) {
  let text = String(html || '');
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, '');
  text = text.replace(/<header[\s\S]*?<\/header>/gi, '');
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  text = text.replace(/<[^>]*>/g, ' ');
  text = text.replace(/&nbsp;/gi, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&#x27;/g, "'");
  text = text.replace(/&#x2F;/g, '/');
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/(\s*\n\s*)+/g, '\n');
  text = text.trim();
  const limite = maxLen || 3500;
  if (text.length > limite) {
    text = text.slice(0, limite) + '\n... [Contenuto troncato a ' + limite + ' caratteri]';
  }
  return text;
}

function estraiTitoloDaHtml(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html || '');
  if (!m) return 'Senza titolo';
  return m[1].replace(/<[^>]*>/g, '').trim();
}

async function eseguiCerca(query, maxResults) {
  // Prova prima tramite lo Studio
  const r = await chiamaStudio('POST', '/api/web-search', { query: query, maxResults: maxResults });
  if (r.json && Array.isArray(r.json.results)) {
    return r.json.results;
  }

  // Fallback autonomo su DuckDuckGo lite
  const formData = new URLSearchParams({ q: query }).toString();
  const resp = await fetchUrlDiretto('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': String(Buffer.byteLength(formData))
    },
    body: formData,
    timeout: 12000
  });

  const linkPattern = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetPattern = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  const links = [];
  let match;
  while ((match = linkPattern.exec(resp.body)) !== null) {
    let url = match[1];
    if (url.includes('duckduckgo.com/l/?uddg=')) {
      try {
        const p = new URL(url.startsWith('//') ? 'https:' + url : url);
        url = decodeURIComponent(p.searchParams.get('uddg') || url);
      } catch (e) {}
    }
    links.push({
      url: url,
      title: match[2].replace(/<[^>]*>/g, '').trim()
    });
  }

  const snippets = [];
  while ((match = snippetPattern.exec(resp.body)) !== null) {
    snippets.push(match[1].replace(/<[^>]*>/g, '').trim());
  }

  const results = [];
  for (let i = 0; i < Math.min(links.length, maxResults || 5); i++) {
    results.push({
      title: links[i].title || 'Senza titolo',
      url: links[i].url,
      snippet: snippets[i] || ''
    });
  }
  return results;
}

async function eseguiVisita(url, maxLen) {
  const fs = require('fs');
  // Se e' un percorso file locale esistente
  if (fs.existsSync(url)) {
    const stat = fs.statSync(url);
    const est = path.extname(url).toLowerCase();
    if (/\.(png|jpe?g|webp|gif|svg|bmp)$/i.test(est)) {
      return {
        titolo: path.basename(url),
        url: url,
        testo: '[IMMAGINE: ' + path.basename(url) + ' (' + (stat.size / 1024).toFixed(1) + ' KB)] - Percorso locale: ' + url
      };
    }
    if (/\.pdf$/i.test(est)) {
      const buf = fs.readFileSync(url);
      const text = buf.toString('latin1').replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s{2,}/g, ' ');
      return {
        titolo: path.basename(url),
        url: url,
        testo: text.slice(0, maxLen || 3500)
      };
    }
    const testo = fs.readFileSync(url, 'utf8').slice(0, maxLen || 3500);
    return {
      titolo: path.basename(url),
      url: url,
      testo: testo
    };
  }

  // Prova prima tramite lo Studio
  const r = await chiamaStudio('POST', '/api/visita-pagina', { url: url, maxLength: maxLen });
  if (r.json && r.json.testo) {
    return {
      titolo: r.json.titolo || '',
      url: r.json.url || url,
      testo: r.json.testo
    };
  }

  // Fallback diretto
  const resp = await fetchUrlDiretto(url, { timeout: 12000 });
  const titolo = estraiTitoloDaHtml(resp.body);
  const testo = estraiTestoDaHtml(resp.body, maxLen);
  return { titolo: titolo, url: url, testo: testo };
}

async function eseguiDeep(query, maxResults, maxLen) {
  const r = await chiamaStudio('POST', '/api/deep-search', { query: query, maxResults: maxResults, maxPageContent: maxLen });
  if (r.json && Array.isArray(r.json.results)) {
    return r.json.results;
  }
  // Se non c'e' lo studio, cerca e poi scarica le prime 2
  const results = await eseguiCerca(query, maxResults);
  for (let i = 0; i < Math.min(2, results.length); i++) {
    try {
      const v = await eseguiVisita(results[i].url, maxLen || 2500);
      results[i].pageContent = v.testo;
    } catch (e) {
      results[i].pageContent = '(impossibile scaricare contenuto)';
    }
  }
  return results;
}

async function principale() {
  const opz = leggiArgomenti(process.argv.slice(2));

  // 0. Mostra documentazione e fonti configurate
  if (opz.doc) {
    console.log(documentazione.testoPerPrompt(process.cwd()));
    return 0;
  }

  // 1. Mostra i siti consigliati dall'utente
  if (opz.siti) {
    const stato = sitiConsigliati.carica();
    const lista = stato.siti || [];
    if (!lista.length) {
      console.log('Nessun sito consigliato configurato dall\'utente.');
      console.log('Puoi aggiungerne dall\'interfaccia grafica o digitare una ricerca con: node ricerca-web.js --cerca "query"');
      return 0;
    }
    console.log('=== SITI E DOCUMENTAZIONE CONSIGLIATI DALL\'UTENTE (' + lista.length + ') ===');
    lista.forEach(function (s, i) {
      console.log('[' + (i + 1) + '] ' + s.url + (s.descrizione ? ' (' + s.descrizione + ')' : ''));
    });
    console.log('\nPer visitare uno di questi siti: node strumenti/ricerca-web.js --visita "<URL>"');
    return 0;
  }

  // 2. Visita / Leggi un URL specifico
  if (opz.visita) {
    console.log('Lettura pagina: ' + opz.visita + ' ...\n');
    try {
      const res = await eseguiVisita(opz.visita, opz.maxLen);
      console.log('TITOLO: ' + res.titolo);
      console.log('URL: ' + res.url);
      console.log('--- CONTENUTO ESTRATTO ---');
      console.log(res.testo);
      return 0;
    } catch (e) {
      console.error('Errore durante la visita di ' + opz.visita + ': ' + e.message);
      return 1;
    }
  }

  // 3. Deep search
  if (opz.deep) {
    console.log('Ricerca profonda per: "' + opz.deep + '" ...\n');
    try {
      const results = await eseguiDeep(opz.deep, opz.max, opz.maxLen);
      if (!results.length) {
        console.log('Nessun risultato trovato.');
        return 0;
      }
      results.forEach(function (r, i) {
        console.log('──────────────────────────────────────────────────');
        console.log('[' + (i + 1) + '] ' + r.title);
        console.log('URL: ' + r.url);
        if (r.snippet) console.log('Snippet: ' + r.snippet);
        if (r.pageContent) {
          console.log('--- Contenuto scaricato:');
          console.log(r.pageContent.slice(0, 1000) + '...');
        }
      });
      return 0;
    } catch (e) {
      console.error('Errore nella ricerca profonda: ' + e.message);
      return 1;
    }
  }

  // 4. Ricerca normale
  if (opz.cerca) {
    console.log('Ricerca web per: "' + opz.cerca + '" ...\n');
    try {
      const results = await eseguiCerca(opz.cerca, opz.max);
      if (!results.length) {
        console.log('Nessun risultato trovato.');
        return 0;
      }
      console.log('Risultati trovati (' + results.length + '):');
      results.forEach(function (r, i) {
        console.log('[' + (i + 1) + '] ' + r.title);
        console.log('    URL: ' + r.url);
        if (r.snippet) console.log('    ' + r.snippet);
      });
      console.log('\nPer leggere il contenuto di una pagina trovata:');
      console.log('  node strumenti/ricerca-web.js --visita "<URL>"');
      return 0;
    } catch (e) {
      console.error('Errore nella ricerca: ' + e.message);
      return 1;
    }
  }

  // Nessun argomento
  console.log('Uso:');
  console.log('  node strumenti/ricerca-web.js --doc');
  console.log('  node strumenti/ricerca-web.js --cerca "query di ricerca"');
  console.log('  node strumenti/ricerca-web.js --visita "https://..." o "<file locale>"');
  console.log('  node strumenti/ricerca-web.js --deep "query"');
  console.log('  node strumenti/ricerca-web.js --siti');
  return 0;
}

if (require.main === module) {
  principale().then(function (codice) {
    process.exit(codice || 0);
  });
}

module.exports = {
  leggiArgomenti,
  estraiTestoDaHtml,
  estraiTitoloDaHtml,
  eseguiCerca,
  eseguiVisita,
  eseguiDeep
};
