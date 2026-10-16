// NotExist Intelligience Studio - Schermate leggere: far VEDERE la pagina ad Adam senza
// sfondargli la memoria.
//
// Misurato il 17/9/2026 sulle sessioni vere dell'utente. Nei test fatti a mano Adam lavora con
// 3.500-5.000 token in pancia; nello Studio la stessa sessione arrivava a 43.287 e perfino
// 87.963 token di input, con la finestra che ne tiene 32.768 - da cui "Autocompact is thrashing",
// compattazioni ogni due turni e compito perso. I due pezzi piu' grossi del contesto erano due
// `Read` di schermate PNG: 302.752 e 329.384 caratteri di base64 l'uno.
//
// Una schermata serve per vedere il layout, i colori, se la pagina e' bianca o se un pulsante e'
// coperto: per questo non serve la piena risoluzione. La stessa schermata a 640px in JPEG passa
// da 235.000 a 21.000 caratteri - undici volte meno - e si vede benissimo lo stesso.
//
// Il ridimensionamento lo fa Chrome (canvas), che c'e' gia': nessuna libreria in piu' da installare.

const fs = require('fs');
const path = require('path');

const LARGHEZZA = 640;
const QUALITA = 0.6;
// Sopra questa dimensione una schermata costa piu' di quanto valga: si usa la copia leggera.
const BYTE_PESANTE = 80 * 1024;

function percorsoLeggero(file) {
  const p = String(file || '');
  return p.replace(/\.(png|jpe?g|webp)$/i, '') + '-piccola.jpg';
}

// La versione da dare ad Adam: quella leggera se esiste, altrimenti l'originale.
function migliore(file) {
  const leggera = percorsoLeggero(file);
  try {
    if (fs.existsSync(leggera) && fs.statSync(leggera).size > 0) return leggera;
  } catch (e) { /* si usa l'originale */ }
  return file;
}

function pesante(file) {
  try {
    return fs.existsSync(file) && fs.statSync(file).size > BYTE_PESANTE;
  } catch (e) {
    return false;
  }
}

// Fa la copia leggera con una pagina del browser gia' aperto. Restituisce il percorso della
// copia, o null se non si e' potuta fare (e allora resta l'originale: mai perdere la schermata).
async function riduci(browser, file, opzioni) {
  opzioni = opzioni || {};
  if (!browser || !file || !fs.existsSync(file)) return null;
  const destinazione = opzioni.destinazione || percorsoLeggero(file);
  let pagina = null;
  try {
    const dati = fs.readFileSync(file).toString('base64');
    pagina = await browser.newPage();
    const url = await pagina.evaluate(async function (b64, larghezza, qualita) {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const scala = Math.min(1, larghezza / img.naturalWidth);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * scala));
      c.height = Math.max(1, Math.round(img.naturalHeight * scala));
      const g = c.getContext('2d');
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, c.width, c.height);      // il JPEG non ha trasparenza: meglio bianco che nero
      g.drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', qualita);
    }, dati, opzioni.larghezza || LARGHEZZA, opzioni.qualita || QUALITA);
    const base64 = String(url || '').split(',')[1];
    if (!base64) return null;
    fs.writeFileSync(destinazione, Buffer.from(base64, 'base64'));
    return destinazione;
  } catch (e) {
    return null;
  } finally {
    try { if (pagina) await pagina.close(); } catch (e) { /* la pagina si chiude da sola col browser */ }
  }
}

// Le copie leggere delle schermate di una misura: solo le ultime, perche' sono quelle che
// finiscono davanti ad Adam, e ognuna costa un secondo di browser.
async function riduciSchermate(browser, schermate, opzioni) {
  opzioni = opzioni || {};
  const voci = Array.isArray(schermate) ? schermate : [];
  const quante = opzioni.quante || 4;
  const daRidurre = voci.slice(-quante);
  for (const s of daRidurre) {
    if (!s || !s.file) continue;
    const leggera = await riduci(browser, s.file, opzioni);
    if (leggera) s.leggera = leggera;
  }
  return voci;
}

module.exports = {
  riduci: riduci,
  riduciSchermate: riduciSchermate,
  percorsoLeggero: percorsoLeggero,
  migliore: migliore,
  pesante: pesante,
  LARGHEZZA: LARGHEZZA,
  QUALITA: QUALITA,
  BYTE_PESANTE: BYTE_PESANTE
};
