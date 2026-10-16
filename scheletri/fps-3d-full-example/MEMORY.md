# 🧠 MEMORIA DI GIOCO - ARCHITETTURA E STRUTTURA COMPLETA
**Not Exist Game Productions** | **Sviluppatore**: `0Not_Exist0`
*File di memoria permanente per la comprensione strutturale, tecnica e architetturale del gioco.*

---

## 🎮 "Low-Poly Adventure 3D" (`blendergame`)

### 1.1 Stack Tecnologico
- **Motore di Rendering**: Three.js (v0.170.0) con renderer WebGL, shadow map morbide `PCFSoftShadowMap` a 2048x2048, flat shading low-poly e nebbia esponenziale `FogExp2`.
- **Bundler / Server**: Vite (v6.x) con supporto hot-reload e binding host su rete locale (`--host --port 3000`).
- **Asset 3D & Rigging**: Modelli `.blend` e `.glb` creati in **Blender**:
  - `character.blend` / `public/character.glb`: Personaggio low-poly con armature e gerarchia ossa IK.
  - `pistol.blend` / `public/pistol.glb`: Pistola dettagliata low-poly (mire con fosfori, canna, carrello, grilletto).
  - `zombies.blend` / `public/zombies.glb`: Modello zombie con pelle putrefatta verde, occhi luminescenti, squarcio al petto.
- **Audio**: Web Audio API pura con oscillatori procedurali (`sine`, `triangle`, `sawtooth`, `square`) ed inviluppi esponenziali. Zero dipendenze da file audio esterni.

---

### 1.2 Architettura dei Sistemi (`main.js`)

#### A. Motore di Cinematica Inversa Gambe (2-Bone Analytical IK)
- **Matematica**: Risoluzione analitica basata sulla **Legge dei Coseni** applicata alla catena bicipite femorale/coscia (`thigh`), tibia/garretto (`shin`) e caviglia/piede (`foot`).
- **Parametri Segmenti**:
  - `LEG_L1 = 0.33734` (Coscia - Hip -> Knee)
  - `LEG_L2 = 0.35128` (Tibia - Knee -> Ankle)
  - `REST_HIP_Y = 0.90`, `REST_ANKLE_Y = 0.22`, `REST_ANKLE_Z = 0.04`
- **Funzione Core**: `solveLegIK(hipY, hipZ, targetY, targetZ, restThighX, restShinX)` calcola gli angoli `thighX` e `shinX`.
- **Ciclo di Passo Realistico (Gait Engine)**:
  - **Fase di Appoggio (Stance Phase)**: Il piede tocca il terreno, assorbe il peso del corpo, rulla dalla pianta alla punta e si spinge all'indietro.
  - **Fase di Slancio (Swing Phase)**: Il piede si stacca, compie un arco parabolico ascendente per superare il terreno e si estende per l'atterraggio successivo.
  - **Pelvic Bobbing & Sway**: Il bacino oscilla verticalmente (doppia frequenza) e si inclina lateralmente sostenendo il baricentro.

#### B. Terreno Procedurale e Collider a Superficie Esatta
- **Mesh Terreno**: Griglia procedurale a colline e dossi calcolati con funzioni sinusoidali/cosinusoidali modulate.
- **Exact Mesh Surface Collider**: `getTerrainHeight(x, z)` non si limita a una formula grezza: interpola le coordinate baricentriche dei vertici del triangolo esatto della mesh renderizzata.
- **Collisione Ostacoli**: Alberi e rocce modellati con raggio cilindrico `obstacles[i] = { x, z, radius }` con respinta elastica del giocatore.

#### C. Sistema di Combattimento: Pistola 3D & Balistica
- **Doppia Rappresentazione Visiva**:
  - **3ª Persona**: Mesh pistola agganciata all'osso della mano destra `hand.R` con compensazione angolare e posa di mira.
  - **1ª Persona (FPS Viewmodel)**: Gruppo dedicato legato alla telecamera (`pistolState.fpsGroup`) con braccio procedurale low-poly (mano, dita che avvolgono l'impugnatura, polsino e manica blu della camicia).
- **Balistica**:
  - Raycast dal centro dello schermo (mirino/crosshair).
  - Test di intersezione Raggio-Capsula con i corpi degli zombie.
  - Traccianti dei proiettili luminosi ad alta velocità (`spawnBulletTracer`).
  - Scintille ed effetti impatto sul terreno e sulle superfici.
  - Muzzle Flash geometrico con luce puntiforme dinamica.
  - Gestione munizioni (caricatore da 12 colpi, ricarica `R`, dry fire al termine).

#### D. Sistema di Combattimento Corpo a Corpo (Pugno Melee)
- Alternanza braccio sinistro e destro (`player.attackSide = 1 - player.attackSide`).
- Verifica impatto entro `attackRange = 2.7` e settore angolare frontale.
- Effetti sonori fendente (`playPunchWhoosh`) e impatto (`playPunchImpact`).
- Danno corpo a corpo (35 HP), knockback respingente e particelle sangue/scintille.

#### E. Intelligenza Artificiale Zombie
- **Comportamento**:
  - Stato `wander` (pattugliamento casuale con timer).
  - Stato `chase` (inseguimento attivo del giocatore quando entra nel raggio visivo a velocità 3.6).
  - Meccanica di presa e morso (`isGrabbed`): se lo zombie raggiunge il giocatore, lo afferra costringendolo a dimenarsi (`struggleTimer` da 2 secondi o sparo a bruciapelo).
- **HUD Zombie**: Barra della vita 3D (PlaneGeometry) sospesa sopra la testa (`y = 2.15`), orientata verso la camera, con cambio colore dinamico (Verde -> Giallo -> Rosso).

#### F. Telecamera & Doppia Visuale
- **1ª Persona (First Person)**: Posizionata all'altezza della testa del modello (`isFirstPerson = true`), nasconde la testa del modello per evitare clipping (`player.headParts`), attiva il viewmodel FPS con rinculo visivo.
- **3ª Persona (Third Person)**: Orbit camera con controllo smooth lerp su yaw e pitch, distanza dinamica che segue il giocatore.
- Toggle con il tasto `V`.

#### G. Controlli & Mobile Support
- **Desktop**:
  - Movimento: `W, A, S, D` o Frecce
  - Spara: `Click Sinistro` o `F`
  - Pugno: `E`
  - Ricarica: `R`
  - Salto: `Space`
  - Scatto: `Shift` (sprint multiplier 1.6x)
  - Inversione Mouse: `X` (Asse X), `I` (Asse Y)
- **Mobile / Touchscreen**:
  - Virtual Joystick analogico a 360° per movimento continuo.
  - Touch Look Drag Zone (metà destra dello schermo) per rotazione libera della telecamera.
  - Touch Buttons dedicati per Spara (`🔫`), Pugno (`🥊`), Salta, Corsa (Toggle).

---

## 🎯 Regole Fondamentali di Lavoro per l'Agente
1. **Modularità e Modifiche Incrementali**: Non riscrivere il file in un colpo solo. Usare `replace_file_content` o modifiche mirate preservando la continuità del loop di gioco.
2. **Controllo Rendering Continuo**: Assicurarsi sempre che `renderer.render(scene, camera)` e `requestAnimationFrame` non vengano mai interrotti.
3. **Sincronia Asset Blender e Web**: Qualsiasi modifica alle ossa o alle mesh in Blender deve rispettare la nomenclatura utilizzata nei mapping di `main.js` (`thighR`, `shinR`, `footR`, `handR`, `Muzzle_Point`).
