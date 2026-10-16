// Il gioco: mondo a blocchi, vista in prima persona, sparo, zombie, altri giocatori.
//
// Questo file e' fatto per essere MODIFICATO un pezzo alla volta. Ogni parte e' separata e
// segnata qui sotto: mondo, giocatore, comandi, altri giocatori, sparo, zombie, schermo.
// Se aggiungi qualcosa, aggiungila nella sua parte e riprova subito il gioco con la verifica
// dello Studio: cosi' si sa sempre quale modifica ha rotto cosa.

import * as THREE from './vendor/three.module.js';
import { collega } from './rete.js';

const LARGHEZZA_MONDO = 32;     // il mondo e' una griglia di 32 x 32 colonne di cubi
const ALTEZZA_OCCHI = 1.7;
const VELOCITA = 6;             // passi al secondo
const GRAVITA = 22;
const FORZA_SALTO = 8;
const PORTATA_SPARO = 40;
const MUNIZIONI_PIENE = 30;

// ------------------------------------------------------------------ il mondo

// Stessa formula per tutti i giocatori: cosi' vedono lo stesso mondo senza scambiarselo in rete.
function altezzaColonna(x, z) {
  if (x < 0 || z < 0 || x >= LARGHEZZA_MONDO || z >= LARGHEZZA_MONDO) return 99;   // muro invisibile ai bordi
  return Math.max(1, Math.round(4 + 2 * Math.sin(x * 0.35) + 2 * Math.cos(z * 0.3)));
}

const scena = new THREE.Scene();
scena.background = new THREE.Color(0x87ceeb);
scena.fog = new THREE.Fog(0x87ceeb, 30, 80);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 200);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

scena.add(new THREE.AmbientLight(0xffffff, 1.4));
const sole = new THREE.DirectionalLight(0xffffff, 2.2);
sole.position.set(25, 45, 15);
scena.add(sole);

// Tutti i cubi del terreno sono un oggetto solo (InstancedMesh): migliaia di cubi senza rallentare.
function costruisciMondo() {
  let quanti = 0;
  for (let x = 0; x < LARGHEZZA_MONDO; x++) {
    for (let z = 0; z < LARGHEZZA_MONDO; z++) quanti += altezzaColonna(x, z);
  }
  const cubi = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), quanti);
  const posizione = new THREE.Matrix4();
  const colore = new THREE.Color();
  let indice = 0;
  for (let x = 0; x < LARGHEZZA_MONDO; x++) {
    for (let z = 0; z < LARGHEZZA_MONDO; z++) {
      const altezza = altezzaColonna(x, z);
      for (let y = 0; y < altezza; y++) {
        posizione.setPosition(x + 0.5, y + 0.5, z + 0.5);
        cubi.setMatrixAt(indice, posizione);
        colore.setHex(y === altezza - 1 ? 0x5bb450 : (y >= altezza - 3 ? 0x8d6e4a : 0x777777));
        // Una sfumatura diversa per ogni cubo: senza, il mondo sembra una parete di un colore solo.
        colore.multiplyScalar(0.86 + ((x * 7 + z * 13 + y * 3) % 10) * 0.028);
        cubi.setColorAt(indice, colore);
        indice++;
      }
    }
  }
  cubi.instanceMatrix.needsUpdate = true;
  if (cubi.instanceColor) cubi.instanceColor.needsUpdate = true;
  return cubi;
}
scena.add(costruisciMondo());

// ------------------------------------------------------------------ il giocatore e i comandi

const giocatore = {
  x: 8.5, z: 8.5, y: altezzaColonna(8, 8) + ALTEZZA_OCCHI,
  vy: 0, ry: 0, rx: 0, aTerra: true,
  vita: 100, munizioni: MUNIZIONI_PIENE, punti: 0
};
const tasti = {};
let inPartita = false;

window.addEventListener('keydown', function (e) {
  tasti[e.code] = true;
  if (e.code === 'KeyR') giocatore.munizioni = MUNIZIONI_PIENE;
  if (e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', function (e) { tasti[e.code] = false; });

window.addEventListener('mousemove', function (e) {
  if (document.pointerLockElement !== renderer.domElement) return;
  giocatore.ry -= e.movementX * 0.0025;
  giocatore.rx -= e.movementY * 0.0025;
  giocatore.rx = Math.max(-1.5, Math.min(1.5, giocatore.rx));   // non si guarda oltre lo zenit
});

renderer.domElement.addEventListener('mousedown', function (e) {
  if (e.button === 0 && inPartita) spara();
});

document.getElementById('gioca').addEventListener('click', function () {
  inPartita = true;
  document.getElementById('inizio').hidden = true;
  ['hud', 'rete', 'mirino'].forEach(function (id) { document.getElementById(id).hidden = false; });
  // Il blocco del mouse e' quello che rende la vista "in prima persona": il mouse gira la testa
  // invece di muovere la freccia. Puo' essere rifiutato dal browser: il gioco continua lo stesso.
  const richiesta = renderer.domElement.requestPointerLock();
  if (richiesta && typeof richiesta.catch === 'function') richiesta.catch(function () {});
});

function muoviGiocatore(dt) {
  const avanti = (tasti.KeyW ? 1 : 0) - (tasti.KeyS ? 1 : 0);
  const lato = (tasti.KeyD ? 1 : 0) - (tasti.KeyA ? 1 : 0);
  const sin = Math.sin(giocatore.ry);
  const cos = Math.cos(giocatore.ry);
  const dx = (-sin * avanti + cos * lato) * VELOCITA * dt;
  const dz = (-cos * avanti - sin * lato) * VELOCITA * dt;

  // Un blocco alto piu' di mezzo passo ferma: sopra i gradini bassi si sale camminando.
  const piedi = giocatore.y - ALTEZZA_OCCHI;
  if (altezzaColonna(Math.floor(giocatore.x + dx), Math.floor(giocatore.z)) <= piedi + 0.6) giocatore.x += dx;
  if (altezzaColonna(Math.floor(giocatore.x), Math.floor(giocatore.z + dz)) <= piedi + 0.6) giocatore.z += dz;

  if (tasti.Space && giocatore.aTerra) {
    giocatore.vy = FORZA_SALTO;
    giocatore.aTerra = false;
  }
  giocatore.vy -= GRAVITA * dt;
  giocatore.y += giocatore.vy * dt;

  const terreno = altezzaColonna(Math.floor(giocatore.x), Math.floor(giocatore.z));
  if (giocatore.y - ALTEZZA_OCCHI <= terreno) {
    giocatore.y = terreno + ALTEZZA_OCCHI;
    giocatore.vy = 0;
    giocatore.aTerra = true;
  }

  camera.rotation.order = 'YXZ';
  camera.rotation.set(giocatore.rx, giocatore.ry, 0);
  camera.position.set(giocatore.x, giocatore.y, giocatore.z);
}

// ------------------------------------------------------------------ altri giocatori e zombie

const altri = new Map();     // id -> { mesh, dati }
const zombie = new Map();    // id -> { mesh, dati }

function corpo(colore, larghezza) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(larghezza, 1.8, larghezza),
    new THREE.MeshLambertMaterial({ color: colore })
  );
  scena.add(mesh);
  return mesh;
}

function aggiornaElenco(mappa, elenco, tipo, colore, larghezza) {
  const visti = new Set();
  (elenco || []).forEach(function (dati) {
    if (tipo === 'giocatore' && dati.id === rete.id) return;    // se stessi non ci si disegna
    visti.add(dati.id);
    let voce = mappa.get(dati.id);
    if (!voce) {
      voce = { mesh: corpo(typeof colore === 'function' ? colore(dati.id) : colore, larghezza), dati: dati };
      voce.mesh.userData = { tipo: tipo, id: dati.id };
      mappa.set(dati.id, voce);
    }
    voce.dati = dati;
    voce.mesh.position.set(dati.x, (dati.y - ALTEZZA_OCCHI) + 0.9, dati.z);
    if (dati.ry !== undefined) voce.mesh.rotation.y = dati.ry;
  });
  mappa.forEach(function (voce, id) {
    if (visti.has(id)) return;
    scena.remove(voce.mesh);
    mappa.delete(id);
  });
}

function coloreDelGiocatore(id) {
  return new THREE.Color().setHSL(((id * 0.17) % 1), 0.7, 0.55);
}

// ------------------------------------------------------------------ lo sparo

const raggio = new THREE.Raycaster();
const centro = new THREE.Vector2(0, 0);
const lampi = [];

function spara() {
  if (giocatore.munizioni <= 0) return;
  giocatore.munizioni--;
  raggio.setFromCamera(centro, camera);
  const bersagli = [];
  altri.forEach(function (v) { bersagli.push(v.mesh); });
  zombie.forEach(function (v) { bersagli.push(v.mesh); });
  const colpi = raggio.intersectObjects(bersagli, false);
  const colpito = colpi.length && colpi[0].distance <= PORTATA_SPARO ? colpi[0] : null;
  if (colpito) {
    const dati = colpito.object.userData;
    if (rete.manda) rete.manda({ tipo: 'sparo', bersaglio: dati.tipo, id: dati.id });
    if (dati.tipo === 'zombie' && !rete.collegato) zombieColpitoDaSoli(dati.id);
  }
  disegnaLampo(colpito ? colpito.point : raggio.ray.at(PORTATA_SPARO, new THREE.Vector3()));
}

function disegnaLampo(fine) {
  const linea = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([raggio.ray.origin.clone(), fine.clone()]),
    new THREE.LineBasicMaterial({ color: 0xffee55 })
  );
  scena.add(linea);
  lampi.push({ linea: linea, fino: performance.now() + 70 });
}

function pulisciLampi(ora) {
  while (lampi.length && lampi[0].fino < ora) {
    scena.remove(lampi.shift().linea);
  }
}

// ------------------------------------------------------------------ rete (e zombie da soli)

const statoRete = document.getElementById('statoRete');
const avvisoRete = document.getElementById('avvisoRete');

const rete = collega({
  suApertura: function () { statoRete.textContent = 'collegato al server'; },
  suErrore: function (motivo) {
    statoRete.textContent = 'da solo';
    avvisoRete.textContent = motivo;
  },
  suChiusura: function () { statoRete.textContent = 'server chiuso: giochi da solo'; },
  suMessaggio: function (m) {
    if (m.tipo === 'benvenuto' || m.tipo === 'mondo') {
      aggiornaElenco(altri, m.giocatori, 'giocatore', coloreDelGiocatore, 0.8);
      aggiornaElenco(zombie, m.zombie, 'zombie', 0x2e7d32, 0.9);
      const mio = (m.giocatori || []).find(function (g) { return g.id === rete.id; });
      if (mio) {
        giocatore.vita = mio.vita;
        giocatore.punti = mio.punti;
      }
    } else if (m.tipo === 'vita' && m.id === rete.id) {
      giocatore.vita = m.vita;
    } else if (m.tipo === 'morto' && m.id === rete.id) {
      giocatore.x = 8.5; giocatore.z = 8.5; giocatore.y = altezzaColonna(8, 8) + ALTEZZA_OCCHI;
      giocatore.vita = 100;
    }
  }
});

// Senza server si gioca da soli: qualche zombie lo mette il gioco stesso, cosi' si prova comunque.
let prossimoZombieLocale = 1;
function zombieDaSoli(dt) {
  if (rete.collegato) return;
  if (zombie.size < 4 && Math.random() < dt * 0.35) {
    const angolo = Math.random() * Math.PI * 2;
    const x = Math.max(1, Math.min(LARGHEZZA_MONDO - 2, giocatore.x + Math.cos(angolo) * 9));
    const z = Math.max(1, Math.min(LARGHEZZA_MONDO - 2, giocatore.z + Math.sin(angolo) * 9));
    const id = prossimoZombieLocale++;
    const voce = { mesh: corpo(0x2e7d32, 0.9), dati: { id: id, x: x, z: z, y: altezzaColonna(Math.floor(x), Math.floor(z)) + ALTEZZA_OCCHI, vita: 100 } };
    voce.mesh.userData = { tipo: 'zombie', id: id };
    zombie.set(id, voce);
  }
  zombie.forEach(function (voce) {
    const d = voce.dati;
    const dx = giocatore.x - d.x;
    const dz = giocatore.z - d.z;
    const distanza = Math.sqrt(dx * dx + dz * dz) || 1;
    if (distanza > 1.2) {
      d.x += (dx / distanza) * 2.2 * dt;
      d.z += (dz / distanza) * 2.2 * dt;
    }
    d.y = altezzaColonna(Math.floor(d.x), Math.floor(d.z)) + ALTEZZA_OCCHI;
    voce.mesh.position.set(d.x, (d.y - ALTEZZA_OCCHI) + 0.9, d.z);
  });
}

function zombieColpitoDaSoli(id) {
  const voce = zombie.get(id);
  if (!voce) return;
  voce.dati.vita -= 34;
  if (voce.dati.vita > 0) return;
  scena.remove(voce.mesh);
  zombie.delete(id);
  giocatore.punti++;
}

let ultimoInvio = 0;
function mandaLaMiaPosizione(ora) {
  if (!rete.collegato || !rete.manda || ora - ultimoInvio < 66) return;
  ultimoInvio = ora;
  rete.manda({ tipo: 'stato', x: giocatore.x, y: giocatore.y, z: giocatore.z, ry: giocatore.ry });
}

// ------------------------------------------------------------------ schermo e ciclo del gioco

const campoVita = document.getElementById('vita');
const campoMunizioni = document.getElementById('munizioni');
const campoPunti = document.getElementById('punti');
const campoGiocatori = document.getElementById('elencoGiocatori');

function aggiornaHud() {
  campoVita.textContent = String(Math.max(0, Math.round(giocatore.vita)));
  campoMunizioni.textContent = String(giocatore.munizioni);
  campoPunti.textContent = String(giocatore.punti);
  campoGiocatori.textContent = (altri.size + 1) + (altri.size ? ' giocatori' : ' giocatore') +
    ', ' + zombie.size + (zombie.size === 1 ? ' zombie' : ' zombie');
}

window.addEventListener('resize', function () {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let ultimoIstante = performance.now();
function cicloDelGioco() {
  const ora = performance.now();
  const dt = Math.min(0.05, (ora - ultimoIstante) / 1000);
  ultimoIstante = ora;

  if (inPartita) muoviGiocatore(dt);
  zombieDaSoli(dt);
  mandaLaMiaPosizione(ora);
  pulisciLampi(ora);
  aggiornaHud();
  renderer.render(scena, camera);
}
renderer.setAnimationLoop(cicloDelGioco);

// Lo Studio (e chi vuole controllare il gioco da fuori) guarda qui dentro.
window.GIOCO = { giocatore: giocatore, altri: altri, zombie: zombie, rete: rete, altezzaColonna: altezzaColonna };
