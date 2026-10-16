const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const pdfAgent = require('../strumenti/pdf-agent');

const script = path.join(__dirname, '..', 'strumenti', 'pdf-agent.py');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-agent-'));
const a = path.join(temp, 'a.pdf');
const b = path.join(temp, 'b.pdf');
const merged = path.join(temp, 'merged.pdf');
const rotated = path.join(temp, 'rotated.pdf');
const rendered = path.join(temp, 'rendered');
const form = path.join(temp, 'form.pdf');
const filled = path.join(temp, 'filled.pdf');

function run(args) {
  return JSON.parse(execFileSync('python', [script].concat(args), { encoding: 'utf8' }));
}

try {
  execFileSync('python', ['-c', [
    'import pymupdf,sys',
    'd=pymupdf.open()',
    'p=d.new_page(width=300,height=200)',
    'p.insert_text((30,60),sys.argv[2])',
    'd.save(sys.argv[1])'
  ].join(';'), a, 'Primo PDF'], { stdio: 'pipe' });
  fs.copyFileSync(a, b);
  execFileSync('python', ['-c', [
    'import pymupdf,sys',
    'd=pymupdf.open()',
    'p=d.new_page(width=300,height=200)',
    'w=pymupdf.Widget()',
    'w.field_name="nome"',
    'w.field_type=pymupdf.PDF_WIDGET_TYPE_TEXT',
    'w.rect=pymupdf.Rect(30,40,220,70)',
    'p.add_widget(w)',
    'd.save(sys.argv[1])'
  ].join(';'), form], { stdio: 'pipe' });

  const caps = run(['capabilities']);
  assert.strictEqual(caps.pymupdf, true);
  assert.strictEqual(caps.pypdf, true);
  const info = run(['inspect', a]);
  assert.strictEqual(info.pages, 1);
  const text = run(['text', a]);
  assert.match(text.pages[0].text, /Primo PDF/);
  const merge = run(['merge', merged, a, b, '--render-dir', rendered]);
  assert.strictEqual(merge.pages, 2);
  assert.strictEqual(merge.rendered.length, 2);
  const rotate = run(['rotate', merged, rotated, '--degrees', '90']);
  assert.strictEqual(rotate.pages, 2);
  assert.ok(fs.statSync(rotated).size > 100);
  if (caps.qpdf) {
    const checked = run(['qpdf', 'check', rotated]);
    assert.strictEqual(checked.ok, true);
  }
  const formResult = run(['fill-form-json', form, '{"nome":"Ada"}', filled]);
  assert.deepStrictEqual(formResult.form_fields_updated, ['nome']);
  const formInfo = run(['inspect', filled]);
  assert.deepStrictEqual(formInfo.form_fields, ['nome']);
  assert.match(pdfAgent.testoPerPrompt(), /PyMuPDF/);
  assert.match(pdfAgent.testoPerPrompt(), /APDF_API_TOKEN/);
  assert.strictEqual(pdfAgent.isNemotronNvidia('nvidia', 'nvidia/nemotron-3-ultra-550b-a55b'), true);
  assert.strictEqual(pdfAgent.isNemotronNvidia('openrouter', 'nvidia/nemotron-3-ultra-550b-a55b'), false);
  assert.strictEqual(pdfAgent.isNemotronNvidia('nvidia', 'meta/llama-3.3-70b-instruct'), false);
  const promptNemotron = pdfAgent.testoPerPrompt('nvidia', 'nvidia/nemotron-3-ultra-550b-a55b');
  assert.match(promptNemotron, /RIFERIMENTI SPAZIALI/);
  assert.match(promptNemotron, /geometricamente sotto DigComp 2\.0, NON la voce DigComp 2\.0/);
  assert.match(promptNemotron, /MODIFICA MINIMA/);
  assert.doesNotMatch(pdfAgent.testoPerPrompt('openrouter', 'openai/gpt-oss-120b'), /PROTOCOLLO PDF SPECIFICO NVIDIA NEMOTRON/);
  console.log('PDF AGENT: tutti i test sono passati');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
