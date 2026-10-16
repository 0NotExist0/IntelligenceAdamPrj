const path = require('path');

const COMANDO = 'python "' + path.join(__dirname, 'pdf-agent.py').split(path.sep).join('/') + '"';

function isNemotronNvidia(provider, model) {
  return String(provider || '').trim().toLowerCase() === 'nvidia' &&
    /(?:^|[\/:._-])nemotron(?:[\/:._-]|$)/i.test(String(model || '').trim());
}

function testoPerPrompt(provider, model) {
  const righe = [
    'MOTORE PDF LOCALE E APDF:',
    'Per leggere, creare o modificare PDF usa ' + COMANDO + '. Esegui prima `capabilities`.',
    'Priorita: PyMuPDF per testo, immagini, annotazioni e rendering; pypdf per pagine, cifratura e moduli; qpdf per controllo/riparazione; pdftk-java solo come fallback AcroForm.',
    'Usa APDF solo quando servono OCR cloud, analytics, link tracciati, webhook o quando l\'utente lo richiede. Il token deve provenire da APDF_API_TOKEN: non scriverlo nei file o nei messaggi.',
    'Comandi: inspect FILE; text FILE; merge OUTPUT INPUT...; split INPUT CARTELLA; rotate INPUT OUTPUT; annotate INPUT OUTPUT TESTO; encrypt INPUT OUTPUT PASSWORD; fill-form-json INPUT VALORI_JSON OUTPUT; qpdf check|repair|linearize INPUT [OUTPUT]; fill-form INPUT DATI_FDF OUTPUT; apdf ENDPOINT --data JSON.',
    'Dopo ogni PDF modificato passa --render-dir a merge/rotate/annotate/qpdf/fill-form, riapri il risultato e controlla visivamente i PNG. Un exit code 0 da solo non prova che il layout sia corretto.',
    'Conserva l\'originale, non appiattire moduli o firme senza richiesta esplicita e non inviare documenti a servizi cloud senza una necessita coerente con la richiesta.'
  ];
  if (isNemotronNvidia(provider, model)) {
    righe.push(
      'PROTOCOLLO PDF SPECIFICO NVIDIA NEMOTRON (OBBLIGATORIO):',
      '1. BERSAGLIO ESATTO: se l\'utente indica un PDF per nome o per una parola del nome (per esempio "quello con original"), lavora su quel file. Non sostituirlo con un PDF simile, piu recente o gia rigenerato.',
      '2. RIFERIMENTI SPAZIALI: parole come sotto, sopra, a destra, a sinistra, vicino e ultima riga descrivono la posizione sulla pagina. "La scritta sotto DigComp 2.0" indica la scritta geometricamente sotto DigComp 2.0, NON la voce DigComp 2.0.',
      '3. PRIMA GUARDA: prima di cercare o modificare il sorgente, renderizza la pagina del PDF bersaglio in PNG e apri il PNG con Read. Usa anche `text` soltanto come supporto: il testo estratto non dimostra posizione, sovrapposizioni o impaginazione.',
      '4. COLLEGA AL SORGENTE: identificato visivamente il testo bersaglio, cercane nel progetto le parole esatte e quelle immediatamente vicine. Modifica la struttura che genera QUEL testo, non la prima occorrenza dell\'ancora nominata dall\'utente.',
      '5. MODIFICA MINIMA: conserva stile, contenuti e impaginazione del PDF indicato. Non ridisegnare o rigenerare l\'intero documento se l\'utente chiede una correzione locale.',
      '6. AMBIGUITA: se e chiaro quale elemento correggere ma non quale nuovo testo inserire, non inventarlo e non modificare altro; emetti il chiarimento strutturato adam-envelope nel testo finale.',
      '7. PROVA PRIMA/DOPO: rigenera o modifica, renderizza la stessa pagina, apri il PNG finale e confronta il punto richiesto con l\'originale. Dichiara completato solo se il difetto indicato e corretto e il resto non e cambiato inutilmente.'
    );
  }
  return righe.join('\n');
}

module.exports = { COMANDO, testoPerPrompt, isNemotronNvidia };
