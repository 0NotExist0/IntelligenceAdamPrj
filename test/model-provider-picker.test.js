'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const chatUi = fs.readFileSync(path.join(root, 'public', 'chat-ui.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'style.css'), 'utf8');
const programmer = fs.readFileSync(path.join(root, 'strumenti', 'programmatore.js'), 'utf8');

let passed = 0;
function check(label, condition) {
  assert.ok(condition, label);
  passed++;
  console.log('  ok   ' + label);
}

console.log('\n=== Provider registry, FCC catalog e model picker ===');

check('API espone providerGroups normalizzato', /providerGroups:\s*providerGroups/.test(server));
check('provider registry server-side unico', /const MODEL_PROVIDER_REGISTRY\s*=\s*\[/.test(server));
check('catalogo FCC risolto in modo portabile da os.homedir()', /path\.join\(os\.homedir\(\),\s*'\.fcc',\s*'codex-model-catalog\.json'\)/.test(server));
check('fcc-claude cercato anche in ~/.local/bin', /path\.join\(home,\s*'\.local',\s*'bin',\s*'fcc-claude\.exe'\)/.test(server));
check('gruppi FCC conservano transport fcc', /source:\s*'fcc-catalog'[\s\S]{0,120}transport:\s*'fcc'/.test(server));

const nvidiaStart = server.indexOf("if (prov === 'nvidia')");
const nvidiaEnd = server.indexOf("if (prov === 'ashna')", nvidiaStart);
const nvidiaBlock = server.slice(nvidiaStart, nvidiaEnd);
check('NVIDIA conserva tutti i modelli chat compatibili', /rawModels[\s\S]*\.filter\(modelloChatCompatibile\)/.test(nvidiaBlock));
check('NVIDIA non usa più whitelist coder/llama/vision', !/&&\s*\/coder\|llama\|vision/.test(nvidiaBlock));

check('Direttore usa un trigger esplicito', /id="director-model-trigger"[\s\S]*data-model-role="director"/.test(html));
check('Coder usa un trigger esplicito', /id="coder-model-trigger"[\s\S]*data-model-role="coder"/.test(html));
check('refresh ha etichetta testuale stabile', /id="btn-refresh-models"[\s\S]{0,500}class="refresh-models-label">Aggiorna modelli/.test(html));
check('picker espone ricerca, provider dock e lista modelli', /id="model-filter-input"/.test(html) && /id="model-provider-dock"/.test(html) && /id="model-picker-list"/.test(html));

check('frontend genera provider da providerGroups senza elenco fisso', /Array\.isArray\(data\.providerGroups\)/.test(chatUi) && /modelProviderGroups\.forEach/.test(chatUi));
check('selezione Direttore conserva transport e group', /modelTransport:\s*selection\.transport/.test(chatUi) && /modelGroup:\s*selection\.group/.test(chatUi));
check('selezione Coder conserva provider e group', /coderProvider:\s*selection\.transport/.test(chatUi) && /coderGroup:\s*selection\.group/.test(chatUi));
check('Escape e click esterno chiudono il picker', /event\.key === 'Escape'/.test(chatUi) && /!elModelPickerRoot\.contains\(event\.target\)/.test(chatUi));

check('toolbar usa wrapping e griglia responsive', /\.view-meta\s*\{[\s\S]{0,180}flex-wrap:\s*wrap/.test(css) && /\.model-role-actions\s*\{[\s\S]{0,180}grid-template-columns/.test(css));
check('popover mobile resta dentro il viewport', /@media \(max-width: 720px\)[\s\S]*\.model-picker-panel\s*\{[\s\S]{0,180}position:\s*fixed/.test(css));
check('loading refresh anima solo icona senza cambiare geometria', /\.btn-refresh-models\.spinning\s*\{[\s\S]{0,80}animation:\s*none/.test(css) && /\.refresh-models-icon/.test(css));

check('Coder FCC viene avviato senza shell', /provider \|\| ''\)\.toLowerCase\(\) === 'fcc'/.test(programmer) && /shell:\s*false/.test(programmer));

const catalogPath = path.join(os.homedir(), '.fcc', 'codex-model-catalog.json');
if (fs.existsSync(catalogPath)) {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const slugs = (catalog.models || []).map(function (model) { return model.slug; });
  check('catalogo locale contiene claude-fable-5.1 sotto TokenRouter', slugs.includes('tokenrouter/anthropic/claude-fable-5.1'));
  check('catalogo locale non inventa claude-opus-5.1', !slugs.includes('tokenrouter/anthropic/claude-opus-5.1'));
}

console.log('\nRisultato: ' + passed + ' controlli passati');
