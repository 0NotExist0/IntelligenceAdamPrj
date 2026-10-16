const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'style.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const video = path.join(root, 'Media', 'bootapp.mp4');

const checks = [
  ['il video di boot esiste ed e valorizzato', fs.existsSync(video) && fs.statSync(video).size > 100000],
  ['la pagina carica il video servito da /media', /<source src="\/media\/bootapp\.mp4\?v=3" type="video\/mp4">/.test(html)],
  ['autoplay resta compatibile con i browser', /muted playsinline autoplay preload="auto"/.test(html)],
  ['il video si adatta senza deformarsi', /#boot-video[\s\S]*object-fit:\s*contain/.test(css)],
  ['la fine del video chiude il boot', /addEventListener\('ended',[\s\S]*chiudiBoot\('fine video'\)/.test(app)],
  ['il boot ha un timeout di sicurezza', /chiudiBoot\('timeout di sicurezza'\)[\s\S]*12000/.test(app)],
  ['il pulsante Salta chiude il boot', /skip\.addEventListener\('click'[\s\S]*chiudiBoot\('salta'\)/.test(app)],
  ['il controllo audio cambia lo stato muted', /video\.muted = !video\.muted/.test(app)],
  ['il boot rispetta il movimento ridotto', /prefers-reduced-motion: reduce/.test(app) && /prefers-reduced-motion: reduce/.test(css)]
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log((ok ? '  ok   ' : '  FAIL ') + name);
  if (!ok) failed++;
}

if (failed) process.exit(1);
console.log('\nBOOT VIDEO: tutti i controlli sono passati');
