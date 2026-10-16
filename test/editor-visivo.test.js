// Prova la parte dell'editor visivo che trasforma le modifiche fatte a vista in CSS:
// cosa si accetta, cosa no, e che il file resti leggibile e annullabile.
const e = require('../strumenti/editor-visivo');

let pass = 0;
let fail = 0;
function check(nome, condizione, dettaglio) {
  if (condizione) { pass++; console.log('  ok   ' + nome); }
  else { fail++; console.log('  FAIL ' + nome + (dettaglio !== undefined ? '  -> ' + dettaglio : '')); }
}

console.log('\n=== Cosa si accetta ===');
const ok = e.validaRegole([
  { selettore: '#start-btn', proprieta: { 'background-color': '#16a34a', left: '612px', position: 'absolute' } },
  { selettore: 'div#ui > button:nth-of-type(2)', proprieta: { color: 'rgb(255, 0, 0)', 'font-size': '18px' } },
  { selettore: 'body', proprieta: { background: 'linear-gradient(180deg, #000 0%, #123 100%)' } },
  { selettore: '#logo', proprieta: { 'background-image': 'url("img/sfondo.png")' } }
]);
check('regole normali accettate', ok.regole && ok.regole.length === 4, JSON.stringify(ok));
check('lo spostamento con translate e\' ammesso', !!(e.validaRegole([{ selettore: '#start-btn', proprieta: { translate: '0px 40px' } }]).regole));
check('i nomi delle proprieta\' diventano minuscoli', e.validaRegole([{ selettore: '#a', proprieta: { COLOR: 'red' } }]).regole[0].proprieta.color === 'red');

console.log('\n=== Cosa si rifiuta ===');
const rifiuta = function (nome, r) { check(nome, !!e.validaRegole([r]).errore, JSON.stringify(e.validaRegole([r]))); };
rifiuta('valore che chiude la dichiarazione', { selettore: '#a', proprieta: { color: 'red; } body { display: none' } });
rifiuta('proprieta\' che nasconde la pagina', { selettore: '#a', proprieta: { display: 'none' } });
rifiuta('proprieta\' con contenuto', { selettore: '#a', proprieta: { content: '"x"' } });
rifiuta('selettore con virgola (piu\' elementi)', { selettore: '#a, body', proprieta: { color: 'red' } });
rifiuta('selettore che apre un blocco', { selettore: '#a { } body', proprieta: { color: 'red' } });
rifiuta('immagine da internet', { selettore: '#a', proprieta: { 'background-image': 'url(https://esempio.it/x.png)' } });
rifiuta('immagine fuori dal progetto', { selettore: '#a', proprieta: { 'background-image': 'url(../../segreto.png)' } });
rifiuta('@import', { selettore: '#a', proprieta: { background: '@import "x.css"' } });
rifiuta('javascript:', { selettore: '#a', proprieta: { background: 'url(javascript:alert(1))' } });
check('nessuna regola = errore', !!e.validaRegole([]).errore);
check('troppe regole = errore', !!e.validaRegole(new Array(61).fill({ selettore: '#a', proprieta: { color: 'red' } })).errore);
check('immagine incorporata rifiutata: solo file del progetto', e.valoreSicuro('url(data:image/png;base64,AAAA)') === null);
check('immagine del progetto in una sottocartella ammessa', e.valoreSicuro('url("img/sfondi/cielo.jpg")') !== null);

console.log('\n=== File delle modifiche ===');
const css = e.scriviCss(ok.regole, 'alien-space.html');
check('spiega nel file come tornare indietro', /per tornare indietro basta cancellare questo file/.test(css));
const riletto = e.leggiRegole(css);
check('si rilegge uguale', JSON.stringify(riletto) === JSON.stringify(ok.regole), JSON.stringify(riletto));
const unito = e.unisciRegole(riletto, [{ selettore: '#start-btn', proprieta: { 'background-color': '#dc2626' } }, { selettore: '#nuovo', proprieta: { color: 'red' } }]);
const btn = unito.find(function (r) { return r.selettore === '#start-btn'; });
check('la modifica nuova sostituisce quella vecchia della stessa proprieta\'', btn.proprieta['background-color'] === '#dc2626');
check('e lascia le altre proprieta\' dello stesso elemento', btn.proprieta.left === '612px');
check('un elemento nuovo si aggiunge', unito.length === 5);

console.log('\n=== Specificita\' ===');
check('si alza una volta', e.piuSpecifico('#start-btn') === '#start-btn:not(#studio-x)');
check('e una seconda', e.piuSpecifico('#start-btn:not(#studio-x)') === '#start-btn:not(#studio-x):not(#studio-y)');
check('non oltre', e.piuSpecifico('#a:not(#studio-x):not(#studio-y)') === null);
const rialzato = e.unisciRegole([{ selettore: '#a:not(#studio-x)', proprieta: { color: 'red' } }], [{ selettore: '#a', proprieta: { left: '3px' } }]);
check('una modifica nuova su un elemento rialzato resta nella stessa regola rialzata',
  rialzato.length === 1 && rialzato[0].selettore === '#a:not(#studio-x)' && rialzato[0].proprieta.left === '3px', JSON.stringify(rialzato));

console.log('\n=== Collegamento nella pagina ===');
const html = '<html><head>\n<link rel="stylesheet" href="styles.css">\n</head><body></body></html>';
const l1 = e.conLink(html);
check('aggiunge il link dopo gli altri fogli di stile', l1.cambiato && l1.html.indexOf('studio-modifiche.css') > l1.html.indexOf('styles.css'));
check('una volta sola', e.conLink(l1.html).cambiato === false);
check('senza </head> va prima del body', /studio-modifiche\.css[\s\S]*<body/.test(e.conLink('<body><p>x</p></body>').html));

console.log('\n' + '='.repeat(50));
console.log('EDITOR VISIVO: ' + pass + ' passati, ' + fail + ' falliti');
process.exit(fail ? 1 : 0);
