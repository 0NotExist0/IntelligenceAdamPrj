// Prova la sonda dei flussi senza il modello vero. La pagina e' una lista della spesa in cui
// Invio non aggiunge. Si controlla che le prove meccaniche misurino cio' che succede davvero,
// che l'oracolo veda lo stato PRIMA ma non il DOPO, con le prove in un ordine diverso a ogni
// voto, che lo Studio faccia il consenso campo per campo e confronti con le misure, e che i
// collaudi siano coerenti: violazioni che falliscono sulla pagina rotta e passano su quella
// corretta, guardie solo dove qualcosa e' comparso davvero.
const fs = require('fs');
const os = require('os');
const path = require('path');
const runtime = require('../analisi-runtime');
const esp = require('../strumenti/esploratrice');
const { eseguiCollaudi } = require('../strumenti/sonda');

let pass = 0;
let fail = 0;
function check(nome, condizione, dettaglio) {
  if (condizione) { pass++; console.log('  ok   ' + nome); }
  else { fail++; console.log('  FAIL ' + nome + (dettaglio !== undefined ? '  -> ' + dettaglio : '')); }
}

function lista(invioGiusto) {
  return `<!DOCTYPE html>
<html><head><title>Lista</title></head>
<body>
  <input id="nome" placeholder="Cosa comprare?">
  <button id="aggiungi">Aggiungi</button>
  <ul id="lista"></ul>
  <span id="conta">0 da comprare</span>
  <script>
    let voci = [];
    const campo = document.getElementById('nome');
    function disegna() {
      document.getElementById('lista').innerHTML = voci.map(function (v, i) {
        return '<li><label><input type="checkbox"' + (v.fatto ? ' checked' : '') + ' onchange="voci[' + i + '].fatto = this.checked; disegna()"> ' + v.nome + '</label></li>';
      }).join('');
      document.getElementById('conta').textContent = voci.filter(function (v) { return !v.fatto; }).length + ' da comprare';
    }
    function aggiungi() { if (!campo.value.trim()) return; voci.push({ nome: campo.value.trim(), fatto: false }); campo.value = ''; disegna(); }
    document.getElementById('aggiungi').addEventListener('click', aggiungi);
    campo.addEventListener('keydown', function (e) { if (e.key === '${invioGiusto ? 'Enter' : 'enter'}') aggiungi(); });
  </script>
</body></html>`;
}

const README = '# Lista\nScrivi e premi Aggiungi, oppure Invio. Una voce vuota non viene aggiunta. Spunta le voci comprate. Il contatore mostra quante restano da comprare.';

// Un oracolo finto: legge le righe "N. racconto" del prompt (nell'ordine del voto) e risponde
// per ognuna con l'attesa scelta da "come", in base al racconto e al numero del voto.
function oracolo(come) {
  const f = function (q) {
    f.chiamate++;
    f.prompts.push(q.prompt);
    f.schema = q.schema;
    const righe = q.prompt.split('\n').filter(function (r) { return /^\d+\. /.test(r); });
    const risposta = {};
    righe.forEach(function (r, i) {
      risposta['prova' + (i + 1)] = come(r, f.chiamate) || { promessa: '', elenchi: [], numeri: [] };
    });
    return Promise.resolve({ testo: JSON.stringify(risposta) });
  };
  f.chiamate = 0;
  f.prompts = [];
  return f;
}
const att = function (voci, numero, promessa) {
  return { promessa: promessa || 'dalla descrizione', elenchi: [{ selettore: '#lista', voci: voci }], numeri: [{ selettore: '#conta', numero: numero }] };
};
// La descrizione letta bene.
function giusto(r) {
  if (/premo Invio/.test(r)) return att(['uno'], 1, 'oppure Invio');
  if (/clicco il pulsante "Aggiungi"/.test(r)) return att(['due'], 1);
  if (/aggiungo "uno" e poi "due"/.test(r)) return att(['uno', 'due'], 2);
  if (/voce vuota/.test(r)) return att([], 0);
  if (/spunto la casella/.test(r)) return att(['uno', 'due'], 1);
  return null;
}

(async function () {
  console.log('\n=== Misure, consenso e confronto puri ===');
  const vuota = { elenchi: { '#lista': { voci: 0, testi: [] } }, caselle: { totale: 0, spuntate: 0 }, testi: { '#conta': '0 da comprare' }, campi: {} };
  const una = { elenchi: { '#lista': { voci: 1, testi: ['pane'], spuntate: [false] } }, caselle: { totale: 1, spuntate: 0 }, testi: { '#conta': '1 da comprare' }, campi: {} };
  const d = esp.differenze(vuota, una);
  check('vede l\'elenco crescere, con le voci', d.cresciuto && d.righe.indexOf('#lista: da 0 a 1 voci ("pane")') !== -1, JSON.stringify(d.righe));
  check('vede il contatore cambiare', d.righe.indexOf('#conta: da "0 da comprare" a "1 da comprare"') !== -1);
  const niente = esp.differenze(vuota, vuota);
  check('nessun cambiamento, ma dice cosa resta', !niente.cambiato && niente.righe.indexOf('#conta: resta "0 da comprare"') !== -1, JSON.stringify(niente.righe));
  check('la guardia controlla solo le voci degli elenchi', esp.verificaDaStato(vuota, una) === "document.querySelectorAll('#lista > *').length === 1");

  const utile = function (a) { return esp.attesaUtile(a, vuota, una); };
  const a1 = utile(att(['Pane (spuntata)'], 1));
  check('l\'attesa si pulisce ("(spuntata)", maiuscole)', a1 && a1.elenchi[0].voci[0] === 'pane', JSON.stringify(a1));
  const aB = utile(att(['pane(barrata)'], 1));
  check('via ogni annotazione tra parentesi (visto dal vivo: "uno (barrato)")', aB && aB.elenchi[0].voci[0] === 'pane', JSON.stringify(aB));
  check('senza promessa non c\'e\' niente da confrontare', utile(att(['pane'], 1, ' ')) === null);
  const senzaCifre = { elenchi: una.elenchi, caselle: una.caselle, testi: { '#titolo': 'Lista' }, campi: {} };
  const a2 = esp.attesaUtile({ promessa: 'x', elenchi: [{ selettore: '#altro', voci: ['a'] }], numeri: [{ selettore: '#titolo', numero: 3 }] }, senzaCifre, senzaCifre);
  check('elenchi inesistenti e testi senza cifre si ignorano (un titolo non e\' un contatore)', a2 === null, JSON.stringify(a2));

  const c1 = esp.consenso([utile(att(['pane'], 1, 'a')), utile(att(['pane'], 1, 'b')), utile(att(['latte'], 1, 'c'))]);
  check('consenso: 2 voti su 3 decidono ogni campo, anche con promesse scritte diverse', c1 && c1.elenchi[0].voci[0] === 'pane' && c1.numeri[0].numero === 1, JSON.stringify(c1));
  const c2 = esp.consenso([utile(att(['pane'], 2)), utile(att(['pane'], 0)), utile(att(['pane'], 1))]);
  check('consenso: un campo senza maggioranza cade, gli altri restano', c2 && c2.elenchi.length === 1 && c2.numeri.length === 0, JSON.stringify(c2));
  check('consenso: 2 voti in disaccordo -> niente', esp.consenso([utile(att(['pane'], 1)), utile(att(['latte'], 0))]) === null);
  check('consenso: se la maggioranza non vede promesse -> niente', esp.consenso([null, null, utile(att(['pane'], 1))]) === null);
  check('consenso: l\'ordine delle voci non conta', !!esp.consenso([utile(att(['a', 'b'], 2)), utile(att(['b', 'a'], 2))]));

  check('confronto: coincide -> rispetta', esp.confronta(a1, una).verdetto === 'rispetta');
  const k2 = esp.confronta(utile(att(['pane'], 0)), una);
  check('confronto: numero diverso -> viola, con la differenza leggibile', k2.verdetto === 'viola' && k2.differenze[0] === '#conta: atteso 0, misurato "1 da comprare"', JSON.stringify(k2));
  const k3 = esp.confronta(utile(att(['latte'], 1)), una);
  check('confronto: voce diversa -> viola', k3.verdetto === 'viola' && /attese 1 voci \("latte"\), misurate 1 \("pane"\)/.test(k3.differenze[0]), JSON.stringify(k3));
  const vf = esp.verificaDaAttesa({ elenchi: [{ selettore: '#lista', voci: ['due'] }], numeri: [{ selettore: '#conta', numero: 1 }] });
  check('la verifica di una violazione sta nel limite dei collaudi', vf.length <= 400 && /length === 1/.test(vf) && /"due"/.test(vf) && /=== '1'/.test(vf), vf);
  const sch = esp.schemaAttese(3);
  check('lo schema obbliga una risposta per OGNI prova (visto dal vivo: si fermava alla prima)', JSON.stringify(sch.required) === '["prova1","prova2","prova3"]');

  if (!runtime.disponibile()) {
    console.log('Browser di controllo non disponibile: prove nel browser saltate.');
  } else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prova-flussi-'));
    const giusta = fs.mkdtempSync(path.join(os.tmpdir(), 'prova-flussi-giusta-'));
    fs.writeFileSync(path.join(dir, 'lista.html'), lista(false));
    fs.writeFileSync(path.join(giusta, 'lista.html'), lista(true));
    const e = function (ec, nome) { return ((ec.esiti || []).find(function (x) { return x.nome === nome; }) || {}).esito; };
    try {
      console.log('\n=== Prove meccaniche e oracolo che legge bene ===');
      const og = oracolo(giusto);
      const r = await esp.esplora({ dir: dir, pagina: 'lista.html', descrizione: README, chiedi: og });
      const per = function (re) { return r.prove.find(function (x) { return re.test(x.racconto); }) || { diff: { righe: [] } }; };
      check('l\'esplorazione termina senza errori', !r.errore, r.errore);
      check('Invio: misurato nessun cambiamento', !per(/premo Invio/).diff.cambiato, JSON.stringify(per(/premo Invio/).diff.righe));
      check('il pulsante Aggiungi: una voce in piu\'', per(/clicco il pulsante "Aggiungi"/).diff.cresciuto);
      check('trova da solo come si conferma (il pulsante)', JSON.stringify(r.conferma) === JSON.stringify(['clic #aggiungi']), JSON.stringify(r.conferma));
      check('due voci: da 0 a 2', per(/aggiungo "uno" e poi "due"/).diff.righe.some(function (x) { return /#lista: da 0 a 2 voci/.test(x); }));
      check('una voce vuota non viene aggiunta', !per(/voce vuota/).diff.cresciuto);
      const spunta = per(/spunto la casella/);
      check('spuntare: il contatore scende e la voce spuntata e\' segnata',
        spunta.diff.righe.indexOf('#lista: stesse 2 voci, ma ora "uno" (spuntata), "due"') !== -1 && spunta.diff.righe.some(function (x) { return /#conta: da "2 da comprare" a "1 da comprare"/.test(x); }),
        JSON.stringify(spunta.diff.righe));
      check('ogni prova riparte da una pagina nuova: i passi sono completi', spunta.passi[0] === 'scrivi #nome | uno');
      check('l\'oracolo vede lo stato PRIMA ma non il DOPO misurato', /PRIMA: #lista: 0 voci/.test(og.prompts[0]) &&
        og.prompts.every(function (p) { return !/DOPO:|MISURATO:/.test(p); }), og.prompts[0].slice(0, 400));
      const prima = function (p) { return (p.split('\n').find(function (x) { return /^1\. /.test(x); }) || '').slice(3); };
      check('l\'ordine delle prove cambia fra i voti (cio\' che si trascina diventa rumore)', og.prompts.length >= 2 && prima(og.prompts[0]) !== prima(og.prompts[1]),
        prima(og.prompts[0]) + ' / ' + prima(og.prompts[1] || ''));
      check('due voti identici bastano (niente terzo voto)', og.chiamate === 2, og.chiamate);
      check('il difetto di Invio e\' registrato, con la differenza misurata', r.difetti.length === 1 && /premo Invio/.test(r.difetti[0].descrizione) &&
        /#lista: attese 1 voci \("uno"\), misurate 0/.test(r.difetti[0].descrizione) && r.difetti[0].promessa === 'oppure Invio', JSON.stringify(r.difetti));
      const violazioni = r.collaudi.filter(function (c) { return c.tipo === 'violazione'; });
      const guardie = r.collaudi.filter(function (c) { return c.tipo === 'guardia'; });
      check('la violazione diventa un collaudo, prima delle guardie', violazioni.length === 1 && r.collaudi[0].tipo === 'violazione',
        JSON.stringify(r.collaudi.map(function (c) { return c.tipo + ' ' + c.nome; })));
      check('guardie solo dove l\'elenco e\' cresciuto (Aggiungi, due voci)', guardie.length === 2 &&
        !guardie.some(function (g) { return /vuota|spunto/.test(g.nome); }), JSON.stringify(guardie.map(function (g) { return g.nome; })));

      console.log('\n=== Coerenza: i collaudi dicono cio\' che dichiarano ===');
      const suRotta = await eseguiCollaudi({ dir: dir, pagina: 'lista.html', collaudi: r.collaudi });
      const suGiusta = await eseguiCollaudi({ dir: giusta, pagina: 'lista.html', collaudi: r.collaudi });
      check('la violazione fallisce sulla pagina rotta', e(suRotta, violazioni[0].nome) === 'fallito');
      check('e passa sulla pagina corretta', e(suGiusta, violazioni[0].nome) === 'superato', e(suGiusta, violazioni[0].nome));
      check('le guardie passano su entrambe', guardie.every(function (g) { return e(suRotta, g.nome) === 'superato' && e(suGiusta, g.nome) === 'superato'; }),
        JSON.stringify(guardie.map(function (g) { return g.nome + ': ' + e(suRotta, g.nome) + '/' + e(suGiusta, g.nome); })));

      console.log('\n=== Oracoli che sbagliano ===');
      // Legge la pagina com'e' (Invio non aggiunge): nessuna violazione, e soprattutto nessuna
      // guardia che asserisca "Invio non aggiunge niente" (visto dal vivo: proteggeva il difetto).
      const copione = oracolo(function (x) { return /premo Invio/.test(x) ? att([], 0) : giusto(x); });
      const rc = await esp.esplora({ dir: dir, pagina: 'lista.html', descrizione: README, chiedi: copione });
      check('un oracolo che accetta il difetto non crea una guardia che lo protegge',
        !rc.collaudi.some(function (c) { return /Invio/.test(c.nome); }) && rc.difetti.length === 0, JSON.stringify(rc.collaudi.map(function (c) { return c.nome; })));
      // Il primo voto vede il difetto, gli altri due no: si chiede il terzo, e vince la maggioranza.
      const incostante = oracolo(function (x, n) { return /premo Invio/.test(x) ? (n === 1 ? att(['uno'], 1) : att([], 0)) : giusto(x); });
      const ri = await esp.esplora({ dir: dir, pagina: 'lista.html', descrizione: README, chiedi: incostante });
      const vInvio = ri.verdetti.find(function (x) { return /premo Invio/.test(x.prova); }) || {};
      check('voti discordi: si chiede il terzo, e vince la maggioranza', incostante.chiamate === 3 && vInvio.verdetto === 'rispetta',
        incostante.chiamate + ' ' + JSON.stringify(vInvio));
      check('e senza maggioranza per la violazione non c\'e\' collaudo', !ri.collaudi.some(function (c) { return /Invio/.test(c.nome); }));
      // Un voto per ordine trascina un numero sbagliato su "voce vuota": il consenso lo scarta.
      const trascina = oracolo(function (x, n) { return /voce vuota/.test(x) ? att([], n + 1) : giusto(x); });
      const rt = await esp.esplora({ dir: dir, pagina: 'lista.html', descrizione: README, chiedi: trascina });
      check('numeri diversi a ogni voto: il campo cade e non nasce un collaudo sbagliato',
        !rt.collaudi.some(function (c) { return /vuota/.test(c.nome) && c.tipo === 'violazione'; }), JSON.stringify(rt.collaudi.map(function (c) { return c.tipo + ' ' + c.nome; })));
      const muto = await esp.esplora({ dir: dir, pagina: 'lista.html', descrizione: README, chiedi: function () { return Promise.resolve({ errore: 'modello spento' }); } });
      check('senza oracolo: le misure restano, ma nessun collaudo', muto.prove.length >= 5 && muto.collaudi.length === 0 && /giudizio non riuscito/.test(muto.errore || ''), muto.errore);
    } catch (err) {
      check('la prova si esegue', false, err.stack);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(giusta, { recursive: true, force: true });
    }
  }
  console.log('\n' + '='.repeat(50));
  console.log('SONDA DEI FLUSSI: ' + pass + ' passati, ' + fail + ' falliti');
  process.exit(fail ? 1 : 0);
})();
