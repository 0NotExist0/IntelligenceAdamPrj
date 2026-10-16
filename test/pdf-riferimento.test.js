const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ref = require('../strumenti/pdf-riferimento');

(async function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-ref-'));
  try {
    const pdf = path.join(dir, 'documento-original.pdf');
    execFileSync('python', ['-c', 'import pymupdf,sys;d=pymupdf.open();p=d.new_page();p.insert_text((80,100),"DigComp 2.0");p.insert_text((80,125),"Testo da correggere");d.save(sys.argv[1])', pdf]);
    assert.strictEqual(ref.richiestaSpaziale('Nel PDF original correggi la scritta sotto a DigComp 2.0'), true);
    assert.match(ref.scegliPdf(dir, 'nel PDF original'), /documento-original\.pdf$/);
    const result = await ref.prepara(dir, 'Nel PDF original correggi la scritta sotto a DigComp 2.0');
    assert.strictEqual(result.page, 1);
    assert.match(result.anchor, /DigComp 2\.0/i);
    assert.ok(fs.existsSync(result.crop));
    assert.match(ref.testoPerModello('Correggi', result), /zona geometricamente SOTTO/);
    console.log('PDF RIFERIMENTO: tutti i test sono passati');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exit(1); });
