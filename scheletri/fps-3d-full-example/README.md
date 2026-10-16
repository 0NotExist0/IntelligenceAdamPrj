# Low-Poly Adventure 🎮

**Azienda**: **Not Exist Game Productions**  
**Sviluppatore**: **0Not_Exist0**  

Un gioco d'avventura 3D in terza e prima persona sviluppato con **Three.js**, **Vite** e modelli 3D creati e riggati in **Blender**.

## ✨ Caratteristiche Principali

- **Sistema Cinematica Inversa (2-Bone IK) alle Gambe**:
  - Calcolo analitico in tempo reale della cinematica inversa per coscia, ginocchio e caviglia basato sulla Legge dei Coseni.
  - **Fase di Appoggio (Stance Phase)**: Il piede si ancora solidamente alla superficie del terreno con contatto realistico, assorbimento del peso e rollio della caviglia (heel-strike -> appoggio piatto -> push-off con la punta).
  - **Fase di Slancio (Swing Phase)**: Il piede si solleva dal terreno seguendo una traiettoria ad arco parabolico, scavalcando gli ostacoli ed estendendosi in avanti per l'appoggio successivo.
  - **Dinamica del Bacino (Pelvic Bobbing & Sway)**: Il bacino oscilla verticalmente a doppia frequenza, si inclina lateralmente per sostenere il peso della gamba portante e ruota in imbardata seguendo la falcata.
  - **Adattamento alle Pendenze del Terreno**: Le quote dei piedi interrogano l'altezza esatta della mesh procedurale sottostante, permettendo al personaggio di salire e scendere dossi e colline piegando le ginocchia in modo naturale senza sprofondare né fluttuare.
- **Rig dell'Armature con Controlli IK in Blender**:
  - Scheletro potenziato nei file `character.blend` e `game.blend` con controller `ik_foot.L`, `ik_foot.R` e pole targets per le ginocchia `pole_knee.L`, `pole_knee.R`.
  - Vincoli IK a catena a 2 segmenti configurati con pole angle allineato al grado di riposo per animazione e posa professionale.
- **Pistola 3D e Sistema Balistico**:
  - Modello 3D low-poly creato e texturizzato in **Blender** (`pistol.blend` & `public/pistol.glb`) con fusto metallico, carrello sagomato con intagli posteriori, canna, guardamano con grilletto dorato, impugnatura ergonomica in polimero scuro, mire metalliche con fosfori verdi luminescenti e camera di scoppio in ottone.
  - Doppia integrazione: agganciata alla mano destra (`hand.R`) del personaggio in 3ª persona (con posa di mira e contraccolpo d'arma) e viewmodel dedicato in 1ª persona con oscillazione naturale (bobbing & sway) e rinculo balistico reattivo.
  - Balistica & Raycasting: colpi precisi verso il reticolo di mira con traccianti visivi proiettile ad alta velocità (`spawnBulletTracer`), scintille d'impatto sul terreno e impatto sui corpi degli zombie (danno elevato di 50 HP per eliminare i non-morti a distanza).
  - Muzzle Flash dinamico all'estremità della canna con flash poligonale e luce puntiforme luminosa.
  - Sistema munizioni: caricatore da 12 colpi, ricarica con tasto `R` (o automatica all'esaurimento) e indicatore munizioni in tempo reale nell'HUD.
  - Effetti sonori completi Web Audio per le armi da fuoco: sparo corposo con transient bass punch e crack esplosivo (`playGunshot`), ricarica metallica a tre tempi con sgancio caricatore e scarrellamento (`playReload`) e clic a secco (`playDryFire`).
- **Zombie e Sistema di Combattimento coi Pugni**:
  - Modello Zombie 3D creato in Blender (`zombies.blend` & `zombies.glb`) derivato dalla base del personaggio con pelle putrefatta verde, occhi luminescenti rossi, mascella spalancata con zanne, squarcio sul petto con costole esposte e abiti lacerati.
  - IA Zombie autonoma: vagamento procedurale e inseguimento del giocatore a vista con andatura zoppicante e braccia tese in avanti.
  - Combattimento corpo a corpo: sferra pugni veloci e potenti (sinistro e destro alternati) con tasto `E` o pulsante touch `PUGNO 🥊`.
  - Reazioni d'impatto con particelle di sangue/scintille, knockback, flash di danno sui materiali e barre della salute sospese sopra la testa dei non-morti.
  - Effetti sonori completi Web Audio: fendente del pugno nell'aria, impatto del colpo sul bersaglio, grugnito di dolore e verso di morte degli zombie.
- **Doppia Visuale**: Alterna tra 3ª persona (orbital camera) e 1ª persona (vista occhi) con il tasto `V`.
- **Controlli Completi per Smartphone & Tablet**:
  - Joystick analogico virtuale a 360°.
  - Swipe con tocco per rotazione libera della telecamera.
  - Pulsanti touch dedicati per Spara (`🔫`), Pugno (`🥊`), Salto e Corsa.
- **Personalizzazione Mouse**: Toggle rapidi per Inversione Asse X (`X`) e Asse Y (`I`).
- **Mondo Procedurale Low-Poly**: Terreno deformato proceduralmente con alberi, rocce e gemme collezionabili con effetti sonori Web Audio.

---

## 🚀 Avvio Rapido (Windows)

Fai doppio clic su:
- **`start.bat`** (oppure `star.bat`)

Lo script verifica automaticamente Node.js, installa le dipendenze se mancanti e apre il browser all'indirizzo `http://localhost:3000/`.

---

## 💻 Installazione Manuale

```bash
# Installa le dipendenze
npm install

# Avvia il server di sviluppo (accessibile anche da smartphone nella stessa rete Wi-Fi)
npm run dev

# Compila per la produzione
npm run build
```

---

## 📱 Giocare da Smartphone

1. Connetti lo smartphone alla stessa rete Wi-Fi del computer.
2. Apri il browser dello smartphone all'indirizzo IP locale mostrato nel terminale Vite (es. `http://<IP-LOCALE>:3000/`).
3. Tocca lo schermo per giocare utilizzando il joystick e i pulsanti touch!

---

## 🕹️ Controlli

| Azione | PC (Tastiera e Mouse) | Smartphone / Touch |
|---|---|---|
| **Movimento** | `W, A, S, D` o Frecce | Joystick virtuale (Basso a sinistra) |
| **Spara con la Pistola** | `Click Sinistro` o `F` | Pulsante `SPARA 🔫` (Basso a destra) |
| **Ricarica Pistola** | `R` o Clic su Munizioni | Tocco sull'indicatore munizioni |
| **Pugno Corpo a Corpo** | `E` | Pulsante `PUGNO 🥊` (Basso a destra) |
| **Salto** | `SPAZIO` | Pulsante `SALTA` |
| **Scatto / Corsa** | `SHIFT` (Tieni premuto) | Pulsante `CORSA` (Toggle) |
| **Cambia Visuale (1ª/3ª)** | `V` | Badge `Visuale` in alto a sinistra |
| **Inverti Asse X** | `X` | Badge `Mouse X` |
| **Inverti Asse Y** | `I` | Badge `Mouse Y` |
| **Ruota Visuale** | Movimento del Mouse | Swipe touch sulla metà destra |
