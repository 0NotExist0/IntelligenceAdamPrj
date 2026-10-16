import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// --- Canvas & Renderer ---
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// --- Scene & Fog ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7dc3e8);
scene.fog = new THREE.FogExp2(0x7dc3e8, 0.010);

// --- Camera ---
const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 800);

// --- Lighting ---
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x3b6e22, 0.9);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xfffaed, 1.4);
dirLight.position.set(45, 80, 40);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 250;
const d = 60;
dirLight.shadow.camera.left = -d;
dirLight.shadow.camera.right = d;
dirLight.shadow.camera.top = d;
dirLight.shadow.camera.bottom = -d;
dirLight.shadow.bias = -0.0005;
scene.add(dirLight);

// --- Web Audio SFX ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playBeep(freq, duration, type = 'sine') {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
  gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}

// --- Combat & Zombie Sound Effects ---
function playPunchWhoosh() {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(340, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(65, audioCtx.currentTime + 0.15);
  gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.15);
}

function playPunchImpact() {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(160, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(30, audioCtx.currentTime + 0.18);
  gain.gain.setValueAtTime(0.40, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.18);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.18);
}

function playZombieHurt() {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(110, audioCtx.currentTime);
  osc.frequency.linearRampToValueAtTime(55, audioCtx.currentTime + 0.24);
  gain.gain.setValueAtTime(0.22, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.24);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.24);
}

function playZombieDeath() {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(85, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(22, audioCtx.currentTime + 0.65);
  gain.gain.setValueAtTime(0.32, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.65);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.65);
}

function playZombieGrab() {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(75, audioCtx.currentTime);
  osc.frequency.linearRampToValueAtTime(140, audioCtx.currentTime + 0.20);
  gain.gain.setValueAtTime(0.26, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.25);
}

function playZombieBite() {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  // Low crunchy bite
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(120, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(45, audioCtx.currentTime + 0.12);
  gain.gain.setValueAtTime(0.18, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.12);
}

function playZombieBreakOff() {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  // Heavy push impact + whoosh
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(220, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(35, audioCtx.currentTime + 0.30);
  gain.gain.setValueAtTime(0.45, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.30);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.30);
}

// --- Weapon & Gunfire Sound Effects ---
function playGunshot() {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const t = audioCtx.currentTime;

  // 1. Low transient bass punch
  const osc = audioCtx.createOscillator();
  const oscGain = audioCtx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(280, t);
  osc.frequency.exponentialRampToValueAtTime(36, t + 0.22);
  oscGain.gain.setValueAtTime(0.65, t);
  oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  osc.connect(oscGain);
  oscGain.connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + 0.22);

  // 2. High explosive crack (filtered white noise burst)
  const bufferSize = Math.floor(audioCtx.sampleRate * 0.16);
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (audioCtx.sampleRate * 0.038));
  }
  const noise = audioCtx.createBufferSource();
  noise.buffer = buffer;

  const filter = audioCtx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(1800, t);
  filter.frequency.exponentialRampToValueAtTime(450, t + 0.16);
  filter.Q.setValueAtTime(1.1, t);

  const noiseGain = audioCtx.createGain();
  noiseGain.gain.setValueAtTime(0.75, t);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);

  noise.connect(filter);
  filter.connect(noiseGain);
  noiseGain.connect(audioCtx.destination);
  noise.start(t);
}

function playReload() {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const t = audioCtx.currentTime;

  // 1. Mag release / eject click
  const osc1 = audioCtx.createOscillator();
  const gain1 = audioCtx.createGain();
  osc1.type = 'sawtooth';
  osc1.frequency.setValueAtTime(580, t);
  osc1.frequency.exponentialRampToValueAtTime(160, t + 0.09);
  gain1.gain.setValueAtTime(0.28, t);
  gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
  osc1.connect(gain1);
  gain1.connect(audioCtx.destination);
  osc1.start(t);
  osc1.stop(t + 0.09);

  // 2. Fresh mag insert click (after 0.38s)
  const osc2 = audioCtx.createOscillator();
  const gain2 = audioCtx.createGain();
  osc2.type = 'square';
  osc2.frequency.setValueAtTime(420, t + 0.38);
  osc2.frequency.exponentialRampToValueAtTime(840, t + 0.46);
  gain2.gain.setValueAtTime(0.32, t + 0.38);
  gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.48);
  osc2.connect(gain2);
  gain2.connect(audioCtx.destination);
  osc2.start(t + 0.38);
  osc2.stop(t + 0.48);

  // 3. Slide chambering rack (after 0.78s)
  const osc3 = audioCtx.createOscillator();
  const gain3 = audioCtx.createGain();
  osc3.type = 'sawtooth';
  osc3.frequency.setValueAtTime(880, t + 0.78);
  osc3.frequency.exponentialRampToValueAtTime(220, t + 0.94);
  gain3.gain.setValueAtTime(0.38, t + 0.78);
  gain3.gain.exponentialRampToValueAtTime(0.001, t + 0.94);
  osc3.connect(gain3);
  gain3.connect(audioCtx.destination);
  osc3.start(t + 0.78);
  osc3.stop(t + 0.94);
}

function playDryFire() {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(950, t);
  osc.frequency.exponentialRampToValueAtTime(320, t + 0.05);
  gain.gain.setValueAtTime(0.22, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + 0.05);
}

// --- Procedural Low-Poly Terrain ---
const terrainSize = 300;
const terrainSegments = 80;
const terrainGeo = new THREE.PlaneGeometry(terrainSize, terrainSize, terrainSegments, terrainSegments);
terrainGeo.rotateX(-Math.PI / 2);

function smoothstep(min, max, value) {
  const x = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return x * x * (3 - 2 * x);
}

// Continuous procedural height function with smooth spawn blend (no cliffs or steps)
function getProceduralHeight(x, z) {
  const dist = Math.sqrt(x * x + z * z);
  // Smoothly blend from 0 at spawn (dist <= 8) to 1 at dist >= 24
  const spawnBlend = smoothstep(8, 24, dist);

  // Natural undulating hills
  const hills = Math.sin(x * 0.035) * Math.cos(z * 0.035) * 3.8 +
                Math.sin(x * 0.09 + z * 0.07) * 1.6;

  // Boundary perimeter mountains to keep player on map
  const edgeWalls = dist > 90 ? Math.pow((dist - 90) * 0.12, 1.6) : 0;

  return (hills * spawnBlend) + edgeWalls;
}

const posAttr = terrainGeo.attributes.position;
for (let i = 0; i < posAttr.count; i++) {
  const x = posAttr.getX(i);
  const z = posAttr.getZ(i);
  posAttr.setY(i, getProceduralHeight(x, z));
}
terrainGeo.computeVertexNormals();

const terrainMat = new THREE.MeshStandardMaterial({
  color: 0x4fb03d,
  roughness: 0.85,
  metalness: 0.05,
  flatShading: true
});
const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
terrainMesh.receiveShadow = true;
scene.add(terrainMesh);

// --- EXACT MESH SURFACE COLLIDER (100% matches rendered 3D polygons) ---
const segs = terrainSegments;
const halfSize = terrainSize / 2;
const cellSize = terrainSize / segs;
const stride = segs + 1;

function getTerrainHeight(x, z) {
  if (x < -halfSize || x > halfSize || z < -halfSize || z > halfSize) {
    return 0;
  }

  const gx = (x + halfSize) / cellSize;
  const gz = (z + halfSize) / cellSize;

  const col = Math.floor(gx);
  const row = Math.floor(gz);

  if (col < 0 || col >= segs || row < 0 || row >= segs) {
    return 0;
  }

  const fx = gx - col;
  const fz = gz - row;

  // 4 corner vertex indices of the quad cell
  const idxTL = row * stride + col;
  const idxTR = idxTL + 1;
  const idxBL = (row + 1) * stride + col;
  const idxBR = idxBL + 1;

  const hTL = posAttr.getY(idxTL);
  const hTR = posAttr.getY(idxTR);
  const hBL = posAttr.getY(idxBL);
  const hBR = posAttr.getY(idxBR);

  // Exact planar equation of the specific triangle face in PlaneGeometry
  if (fx + fz < 1.0) {
    return hTL + (hTR - hTL) * fx + (hBL - hTL) * fz;
  } else {
    return hBR + (hBL - hBR) * (1 - fx) + (hTR - hBR) * (1 - fz);
  }
}

// --- Environment: Trees & Rocks with Obstacle Collision ---
const obstacles = [];

function createTree(x, z) {
  const y = getTerrainHeight(x, z);
  const group = new THREE.Group();
  group.position.set(x, y, z);

  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.4, 2.2, 5);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6e4726, flatShading: true });
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = 1.1;
  trunk.castShadow = true;
  group.add(trunk);

  const foliageMat = new THREE.MeshStandardMaterial({ 
    color: Math.random() > 0.4 ? 0x2e8b57 : 0x3cb371, 
    flatShading: true 
  });
  const f1 = new THREE.Mesh(new THREE.ConeGeometry(2.0, 2.4, 5), foliageMat);
  f1.position.y = 2.6;
  f1.castShadow = true;
  group.add(f1);

  const f2 = new THREE.Mesh(new THREE.ConeGeometry(1.5, 2.0, 5), foliageMat);
  f2.position.y = 3.7;
  f2.castShadow = true;
  group.add(f2);

  scene.add(group);
  obstacles.push({ x, z, radius: 0.65 });
}

function createRock(x, z) {
  const y = getTerrainHeight(x, z);
  const rockGeo = new THREE.DodecahedronGeometry(0.8 + Math.random() * 0.8, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x7a8288, roughness: 0.9, flatShading: true });
  const rock = new THREE.Mesh(rockGeo, rockMat);
  rock.position.set(x, y + 0.3, z);
  rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
  rock.castShadow = true;
  scene.add(rock);
  obstacles.push({ x, z, radius: 0.95 });
}

for (let i = 0; i < 70; i++) {
  const ang = Math.random() * Math.PI * 2;
  const dist = 16 + Math.random() * 95;
  createTree(Math.cos(ang) * dist, Math.sin(ang) * dist);
}
for (let i = 0; i < 45; i++) {
  const ang = Math.random() * Math.PI * 2;
  const dist = 14 + Math.random() * 100;
  createRock(Math.cos(ang) * dist, Math.sin(ang) * dist);
}

// --- Collectible Gems ---
const gems = [];
let gemsCollected = 0;
const totalGems = 10;
const gemGeo = new THREE.OctahedronGeometry(0.5, 0);
const gemMat = new THREE.MeshStandardMaterial({
  color: 0x00f5d4,
  emissive: 0x00b4d8,
  emissiveIntensity: 0.6,
  roughness: 0.1,
  metalness: 0.8,
  flatShading: true
});

for (let i = 0; i < totalGems; i++) {
  const ang = (i / totalGems) * Math.PI * 2 + Math.random() * 0.3;
  const dist = 18 + Math.random() * 50;
  const gx = Math.cos(ang) * dist;
  const gz = Math.sin(ang) * dist;
  const gy = getTerrainHeight(gx, gz) + 1.2;

  const gem = new THREE.Mesh(gemGeo, gemMat.clone());
  gem.position.set(gx, gy, gz);
  gem.castShadow = true;
  gem.userData = { baseY: gy, collected: false, offset: Math.random() * Math.PI };
  scene.add(gem);
  gems.push(gem);
}

// --- Shared 2-Bone Analytical Inverse Kinematics (IK) Engine ---
const LEG_L1 = 0.33734; // Thigh segment (hip to knee)
const LEG_L2 = 0.35128; // Shin segment (knee to ankle)
const REST_ANKLE_Y = 0.22; // Ground sole neutral ankle level
const REST_ANKLE_Z = 0.04; // Resting forward offset
const REST_HIP_Y = 0.90;   // Rest pelvis height

const D_REST = Math.sqrt(Math.pow(REST_ANKLE_Y - REST_HIP_Y, 2) + Math.pow(REST_ANKLE_Z, 2));
const GAMMA_REST = Math.atan2(REST_ANKLE_Z, REST_HIP_Y - REST_ANKLE_Y);
const COS_ALPHA1_REST = (LEG_L1 * LEG_L1 + D_REST * D_REST - LEG_L2 * LEG_L2) / (2 * LEG_L1 * D_REST);
const ALPHA1_REST = Math.acos(Math.max(-1, Math.min(1, COS_ALPHA1_REST)));
const THETA1_REST = GAMMA_REST + ALPHA1_REST;
const COS_ALPHA2_REST = (LEG_L1 * LEG_L1 + LEG_L2 * LEG_L2 - D_REST * D_REST) / (2 * LEG_L1 * LEG_L2);
const THETA_KNEE_REST = Math.PI - Math.acos(Math.max(-1, Math.min(1, COS_ALPHA2_REST)));

function solveLegIK(hipY, hipZ, targetY, targetZ, restThighX, restShinX) {
  const dy = targetY - hipY; // dy is negative
  const dz = targetZ - hipZ;
  const dist = Math.sqrt(dy * dy + dz * dz);
  const d = Math.max(Math.abs(LEG_L1 - LEG_L2) + 0.005, Math.min((LEG_L1 + LEG_L2) * 0.996, dist));

  const gamma = Math.atan2(dz, -dy);
  const cosAlpha1 = Math.max(-1, Math.min(1, (LEG_L1 * LEG_L1 + d * d - LEG_L2 * LEG_L2) / (2 * LEG_L1 * d)));
  const alpha1 = Math.acos(cosAlpha1);
  const theta1 = gamma + alpha1;

  const cosAlpha2 = Math.max(-1, Math.min(1, (LEG_L1 * LEG_L1 + LEG_L2 * LEG_L2 - d * d) / (2 * LEG_L1 * LEG_L2)));
  const thetaKnee = Math.PI - Math.acos(cosAlpha2);

  return {
    thighX: restThighX - (theta1 - THETA1_REST),
    shinX: restShinX + (thetaKnee - THETA_KNEE_REST)
  };
}

// --- Player State & Bone Hierarchy ---
const player = {
  group: new THREE.Group(),
  model: null,
  bones: {},
  restRotations: {},
  restPositions: {},
  headParts: [],
  position: new THREE.Vector3(0, 0, 0),
  velocity: new THREE.Vector3(),
  isGrounded: true,
  moveSpeed: 7.0,
  sprintMultiplier: 1.6,
  jumpStrength: 9.8,
  facingAngle: 0,
  walkCycle: 0,
  // Health & Grab status
  hp: 100,
  maxHp: 100,
  isGrabbed: false,
  grabbedBy: null,
  // Combat stats & state
  isAttacking: false,
  attackTimer: 0,
  attackDuration: 0.24,
  attackSide: 0,
  attackCooldown: 0,
  attackRange: 2.7,
  attackDamage: 35
};
scene.add(player.group);

// Load Character GLB
const loader = new GLTFLoader();
loader.load('/character.glb', (gltf) => {
  player.model = gltf.scene;

  player.model.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      if (child.material) {
        child.material.flatShading = true;
        child.material.needsUpdate = true;
      }
      if (['Head', 'Hair', 'Hair_Tuft1', 'Hair_Tuft2', 'Eye_R', 'Eye_L'].includes(child.name)) {
        player.headParts.push(child);
      }
    }

    // Capture all Bone nodes and their rest transforms (both original and sanitized names)
    if (child.name) {
      const name = child.name;
      const stripped = name.replace(/\./g, '');
      player.bones[name] = child;
      player.bones[stripped] = child;
      player.restRotations[name] = child.rotation.clone();
      player.restRotations[stripped] = child.rotation.clone();
      player.restPositions[name] = child.position.clone();
      player.restPositions[stripped] = child.position.clone();
    }
  });

  player.group.add(player.model);
  attachPistolToHand();
  console.log('🎮 Low-Poly Adventure — Not Exist Game Productions');
  console.log('👤 Developed by: 0Not_Exist0');
  console.log('🦴 Character and IK bones loaded successfully:', Object.keys(player.bones));
});

// --- 3D Pistol State & Weapons System ---
const pistolState = {
  model: null,
  thirdPerson: null,
  fpsGun: null,
  fpsHand: null,
  fpsGroup: new THREE.Group(),
  ammo: 12,
  maxAmmo: 12,
  isReloading: false,
  reloadTimer: 0,
  reloadDuration: 1.1,
  fireCooldown: 0,
  fireRate: 0.18,
  damage: 50,
  recoilZ: 0,
  recoilRotX: 0,
  aimTimer: 0,
  recoilKick: 0,
  flashTimer: 0,
  triggerPull: 0
};

// Add camera to scene and FPS viewmodel to camera
scene.add(camera);
camera.add(pistolState.fpsGroup);
pistolState.fpsGroup.position.set(0.14, -0.105, -0.27);
pistolState.fpsGroup.rotation.set(0.03, -0.05, 0.02);
pistolState.fpsGroup.visible = false;

// --- Procedural Low-Poly FPS Right Hand & Forearm (held by player) ---
function createFPSRightHand() {
  const handGroup = new THREE.Group();
  handGroup.name = 'FPS_Right_Hand_Group';

  // Exact skin and clothing materials matching character.glb
  const skinMat = new THREE.MeshStandardMaterial({
    color: 0xf2c7a5,
    roughness: 0.72,
    metalness: 0.04,
    flatShading: true
  });

  const shirtMat = new THREE.MeshStandardMaterial({
    color: 0x1f8cd9,
    roughness: 0.75,
    metalness: 0.05,
    flatShading: true
  });

  const cuffMat = new THREE.MeshStandardMaterial({
    color: 0x145a8a,
    roughness: 0.80,
    metalness: 0.05,
    flatShading: true
  });

  const makeBox = (w, h, d, mat, pos, rot) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (pos) mesh.position.set(pos[0], pos[1], pos[2]);
    if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
    handGroup.add(mesh);
    return mesh;
  };

  // 1. Palm & back of hand (wrapping right and rear of the pistol grip)
  makeBox(0.024, 0.056, 0.046, skinMat, [0.017, -0.040, 0.024], [0.10, -0.10, 0.06]);

  // 2. Thumb base & tip (resting along the left side of the grip below slide)
  makeBox(0.016, 0.022, 0.026, skinMat, [-0.014, -0.018, 0.022], [-0.15, 0.20, -0.10]);
  makeBox(0.014, 0.018, 0.022, skinMat, [-0.016, -0.009, 0.004], [0.12, 0.35, -0.22]);

  // 3. Trigger / Index finger (reaching into trigger guard and pulling trigger)
  makeBox(0.013, 0.015, 0.024, skinMat, [0.017, -0.008, 0.006], [0.05, 0.0, -0.15]);
  const indexTip = makeBox(0.011, 0.013, 0.026, skinMat, [0.011, -0.007, -0.016], [0.10, 0.08, -0.32]);
  handGroup.userData.indexTip = indexTip;

  // 4. Middle, Ring, and Pinky fingers wrapping around the front face of the grip
  const fingerConfigs = [
    { y: -0.023, z: 0.017 },
    { y: -0.040, z: 0.015 },
    { y: -0.057, z: 0.013 }
  ];
  fingerConfigs.forEach(cfg => {
    // Right side knuckle
    makeBox(0.018, 0.014, 0.016, skinMat, [0.018, cfg.y, cfg.z], [0.05, -0.05, 0.0]);
    // Front grip face wrap
    makeBox(0.030, 0.013, 0.014, skinMat, [0.003, cfg.y, cfg.z - 0.014], [0.05, -0.05, 0.0]);
    // Left side curling tip
    makeBox(0.012, 0.013, 0.014, skinMat, [-0.013, cfg.y, cfg.z - 0.006], [0.05, -0.05, 0.15]);
  });

  // 5. Wrist (connects hand base back and down-right)
  makeBox(0.038, 0.042, 0.044, skinMat, [0.032, -0.062, 0.058], [0.20, -0.22, 0.25]);

  // 6. Shirt Cuff ring (wrist junction)
  makeBox(0.050, 0.030, 0.052, cuffMat, [0.046, -0.085, 0.082], [0.38, -0.42, 0.28]);

  // 7. Forearm Sleeve (blue shirt extending down, right, and back into lower corner)
  makeBox(0.058, 0.26, 0.054, shirtMat, [0.10, -0.18, 0.17], [0.48, -0.45, 0.28]);

  return handGroup;
}

// Instantiate FPS right hand and add to fpsGroup
pistolState.fpsHand = createFPSRightHand();
pistolState.fpsGroup.add(pistolState.fpsHand);

function attachPistolToHand() {
  const hand = player.bones['Hand_R'] || player.bones['hand.R'] || player.bones['handR'];
  if (hand && pistolState.thirdPerson && !hand.children.includes(pistolState.thirdPerson)) {
    hand.add(pistolState.thirdPerson);
    pistolState.thirdPerson.position.set(0, -0.012, 0.025);
    pistolState.thirdPerson.rotation.set(0, Math.PI, 0);
    pistolState.thirdPerson.scale.set(0.92, 0.92, 0.92);
    pistolState.thirdPerson.visible = !isFirstPerson;
    console.log('🔫 Pistola 3D agganciata con successo alla mano del personaggio!');
  }
}

// Load Pistol GLB
loader.load('/pistol.glb', (gltf) => {
  pistolState.model = gltf.scene;

  gltf.scene.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      if (child.material) {
        child.material.flatShading = true;
        child.material.needsUpdate = true;
      }
    }
  });

  // 1. Third-Person Pistol (pointing forward along +Z in right hand)
  pistolState.thirdPerson = gltf.scene.clone();
  attachPistolToHand();

  // 2. First-Person Viewmodel Pistol (pointing forward along -Z into screen, held by FPS hand)
  pistolState.fpsGun = gltf.scene.clone();
  pistolState.fpsGun.position.set(0, 0, 0);
  pistolState.fpsGun.rotation.set(0, 0, 0);
  pistolState.fpsGun.scale.set(0.80, 0.80, 0.80);
  pistolState.fpsGroup.add(pistolState.fpsGun);
  pistolState.fpsGroup.visible = isFirstPerson;

  console.log('🔫 Pistola 3D caricata e agganciata alla mano destra in 1ª e 3ª persona!');
});

// Muzzle Flash VFX
const muzzleFlash = new THREE.Group();
const flashCone1 = new THREE.Mesh(
  new THREE.ConeGeometry(0.045, 0.15, 5),
  new THREE.MeshBasicMaterial({ color: 0xffea00 })
);
flashCone1.rotateX(Math.PI / 2);
muzzleFlash.add(flashCone1);

const flashCone2 = new THREE.Mesh(
  new THREE.ConeGeometry(0.03, 0.11, 4),
  new THREE.MeshBasicMaterial({ color: 0xff9f1c })
);
flashCone2.rotateZ(Math.PI / 4);
flashCone2.rotateX(Math.PI / 2);
muzzleFlash.add(flashCone2);

const flashLight = new THREE.PointLight(0xffb703, 6.0, 8.0);
muzzleFlash.add(flashLight);
muzzleFlash.visible = false;
scene.add(muzzleFlash);

function triggerMuzzleFlash(pos, dir) {
  muzzleFlash.position.copy(pos);
  if (dir) {
    muzzleFlash.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  }
  muzzleFlash.visible = true;
  pistolState.flashTimer = 0.05;
}

// Bullet Tracers VFX
const activeTracers = [];
const tracerGeo = new THREE.CylinderGeometry(0.015, 0.015, 1.0, 4);
tracerGeo.rotateX(Math.PI / 2);
const tracerMat = new THREE.MeshBasicMaterial({
  color: 0xffe066,
  transparent: true,
  opacity: 0.95
});

function spawnBulletTracer(startPos, endPos) {
  const dist = startPos.distanceTo(endPos);
  if (dist < 0.1) return;

  const mesh = new THREE.Mesh(tracerGeo, tracerMat.clone());
  mesh.position.copy(startPos).lerp(endPos, 0.5);
  mesh.scale.set(1, 1, dist);
  mesh.lookAt(endPos);
  scene.add(mesh);

  activeTracers.push({
    mesh,
    life: 0.08,
    maxLife: 0.08
  });
}

function updateTracers(dt) {
  for (let i = activeTracers.length - 1; i >= 0; i--) {
    const t = activeTracers[i];
    t.life -= dt;
    if (t.life <= 0) {
      scene.remove(t.mesh);
      activeTracers.splice(i, 1);
    } else {
      t.mesh.material.opacity = (t.life / t.maxLife) * 0.95;
    }
  }
}

// Terrain impact spark particles
function spawnTerrainImpactParticles(x, y, z) {
  for (let i = 0; i < 7; i++) {
    const pMat = new THREE.MeshBasicMaterial({
      color: Math.random() > 0.4 ? 0xffd166 : 0xcccccc
    });
    const pMesh = new THREE.Mesh(hitParticleGeo, pMat);
    pMesh.position.set(x, y, z);
    const speed = 2.0 + Math.random() * 3.0;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 0.5;
    scene.add(pMesh);
    hitParticles.push({
      mesh: pMesh,
      vx: Math.cos(theta) * Math.cos(phi) * speed,
      vy: Math.sin(phi) * speed + 0.8,
      vz: Math.sin(theta) * Math.cos(phi) * speed,
      life: 0.25,
      maxLife: 0.25
    });
  }
}

// --- Combat Hit Particles ---
const hitParticles = [];
const hitParticleGeo = new THREE.BoxGeometry(0.08, 0.08, 0.08);

function spawnHitParticles(x, y, z) {
  for (let i = 0; i < 9; i++) {
    const pMat = new THREE.MeshBasicMaterial({
      color: Math.random() > 0.4 ? 0xff3b30 : 0xffcc00
    });
    const pMesh = new THREE.Mesh(hitParticleGeo, pMat);
    pMesh.position.set(x, y, z);
    const speed = 2.0 + Math.random() * 3.5;
    const theta = Math.random() * Math.PI * 2;
    const phi = (Math.random() - 0.5) * Math.PI;
    const vx = Math.cos(theta) * Math.cos(phi) * speed;
    const vy = Math.abs(Math.sin(phi)) * speed + 1.2;
    const vz = Math.sin(theta) * Math.cos(phi) * speed;
    scene.add(pMesh);
    hitParticles.push({
      mesh: pMesh,
      vx,
      vy,
      vz,
      life: 0.32,
      maxLife: 0.32
    });
  }
}

function updateParticles(dt) {
  for (let i = hitParticles.length - 1; i >= 0; i--) {
    const p = hitParticles[i];
    p.life -= dt;
    if (p.life <= 0) {
      scene.remove(p.mesh);
      hitParticles.splice(i, 1);
      continue;
    }
    p.vy -= 18.0 * dt;
    p.mesh.position.x += p.vx * dt;
    p.mesh.position.y += p.vy * dt;
    p.mesh.position.z += p.vz * dt;
    p.mesh.rotation.x += 12 * dt;
    p.mesh.rotation.y += 12 * dt;
    const s = Math.max(0, p.life / p.maxLife);
    p.mesh.scale.set(s, s, s);
  }
}

// --- Zombie Management & AI ---
const zombies = [];
let zombiesDefeated = 0;
const totalZombies = 8;
let zombieTemplate = null;

function createZombieHealthBar() {
  const barGroup = new THREE.Group();
  
  // Background
  const bgGeo = new THREE.PlaneGeometry(0.72, 0.08);
  const bgMat = new THREE.MeshBasicMaterial({ color: 0x1a1a24, side: THREE.DoubleSide });
  const bgMesh = new THREE.Mesh(bgGeo, bgMat);
  barGroup.add(bgMesh);

  // Fill
  const fgGeo = new THREE.PlaneGeometry(0.70, 0.06);
  fgGeo.translate(0.35, 0, 0); // anchor at left
  const fgMat = new THREE.MeshBasicMaterial({ color: 0x06d6a0, side: THREE.DoubleSide });
  const fgMesh = new THREE.Mesh(fgGeo, fgMat);
  fgMesh.position.set(-0.35, 0, 0.005);
  barGroup.add(fgMesh);

  barGroup.position.y = 2.15;
  return { barGroup, fgMesh, fgMat };
}

function updateZombieHealthBar(z) {
  if (!z.healthBar) return;
  const ratio = Math.max(0, Math.min(1, z.hp / z.maxHp));
  z.healthBar.fgMesh.scale.x = ratio;
  if (ratio > 0.5) {
    z.healthBar.fgMat.color.setHex(0x06d6a0);
  } else if (ratio > 0.25) {
    z.healthBar.fgMat.color.setHex(0xffd166);
  } else {
    z.healthBar.fgMat.color.setHex(0xef476f);
  }
}

// --- Player Health UI & Visual Feedback ---
const playerHealthBar = document.getElementById('player-health-bar');
const playerHealthText = document.getElementById('player-health-text');
const damageOverlay = document.getElementById('damage-overlay');
const grabAlert = document.getElementById('grab-alert');
const struggleTimerElem = document.getElementById('struggle-timer');

function updatePlayerHealthUI(dt) {
  // Slow passive regeneration when not under attack
  if (!player.isGrabbed && player.hp < player.maxHp) {
    player.hp = Math.min(player.maxHp, player.hp + 2.0 * dt);
  }

  if (playerHealthBar && playerHealthText) {
    const pct = Math.max(0, Math.min(100, Math.round((player.hp / player.maxHp) * 100)));
    playerHealthBar.style.width = pct + '%';
    playerHealthText.innerText = pct + '%';

    if (pct > 50) {
      playerHealthBar.style.background = 'linear-gradient(90deg, #06d6a0, #48cae4)';
      playerHealthText.style.color = '#06d6a0';
    } else if (pct > 25) {
      playerHealthBar.style.background = 'linear-gradient(90deg, #ffd166, #f77f00)';
      playerHealthText.style.color = '#ffd166';
    } else {
      playerHealthBar.style.background = 'linear-gradient(90deg, #d90429, #ef476f)';
      playerHealthText.style.color = '#ef476f';
    }
  }

  if (player.isGrabbed && player.grabbedBy) {
    if (grabAlert) {
      grabAlert.style.display = 'block';
      const remaining = Math.max(0, 2.0 - player.grabbedBy.struggleTimer).toFixed(1);
      if (struggleTimerElem) struggleTimerElem.innerText = remaining + 's';
    }
    if (damageOverlay) {
      const pulse = 65 + Math.sin(clock.getElapsedTime() * 14) * 25;
      damageOverlay.style.boxShadow = `inset 0 0 ${pulse}px rgba(217, 4, 41, 0.78)`;
    }
  } else {
    if (grabAlert) grabAlert.style.display = 'none';
    if (damageOverlay) {
      damageOverlay.style.boxShadow = 'inset 0 0 0px rgba(217, 4, 41, 0)';
    }
  }
}

function spawnZombies() {
  if (!zombieTemplate) return;

  for (let i = 0; i < totalZombies; i++) {
    const ang = (i / totalZombies) * Math.PI * 2 + (Math.random() * 0.4 - 0.2);
    const dist = 24 + Math.random() * 42;
    const zx = Math.cos(ang) * dist;
    const zz = Math.sin(ang) * dist;
    const zy = getTerrainHeight(zx, zz);

    const zGroup = new THREE.Group();
    zGroup.position.set(zx, zy, zz);

    const modelClone = zombieTemplate.clone(true);
    const bones = {};
    const restRotations = {};
    const materials = [];

    modelClone.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material) {
          child.material = child.material.clone();
          child.material.flatShading = true;
          materials.push({
            mat: child.material,
            origColor: child.material.color ? child.material.color.clone() : new THREE.Color(0xffffff)
          });
        }
      }
      if (child.name) {
        const name = child.name;
        const stripped = name.replace(/\./g, '');
        bones[name] = child;
        bones[stripped] = child;
        restRotations[name] = child.rotation.clone();
        restRotations[stripped] = child.rotation.clone();
      }
    });

    zGroup.add(modelClone);

    const healthBar = createZombieHealthBar();
    zGroup.add(healthBar.barGroup);

    scene.add(zGroup);

    zombies.push({
      group: zGroup,
      model: modelClone,
      bones,
      restRotations,
      materials,
      healthBar,
      position: zGroup.position,
      velocity: new THREE.Vector3(),
      hp: 100,
      maxHp: 100,
      isDead: false,
      hitFlashTime: 0,
      deathTimer: 0,
      facingAngle: Math.random() * Math.PI * 2,
      walkCycle: Math.random() * Math.PI * 2,
      wanderTimer: Math.random() * 3,
      wanderAngle: Math.random() * Math.PI * 2,
      speed: 3.6, // FAST CHASE SPEED!
      state: 'wander',
      grabCooldown: 0,
      struggleTimer: 0,
      biteTimer: 0,
      ragdoll: null
    });
  }
}

// Load Zombies GLB
loader.load('/zombies.glb', (gltf) => {
  zombieTemplate = gltf.scene;
  console.log('🧟 Zombies GLB loaded successfully!');
  spawnZombies();
});

// --- Punch Attack Mechanics ---
function punchAttack() {
  if (player.attackCooldown > 0) return;
  player.isAttacking = true;
  player.attackTimer = player.attackDuration;
  player.attackCooldown = 0.28;
  player.attackSide = 1 - player.attackSide;
  playPunchWhoosh();
  checkPunchHits();
}

function checkPunchHits() {
  const punchReach = player.attackRange;
  const angle = isFirstPerson ? cameraYaw : player.facingAngle;
  const fwdX = Math.sin(angle);
  const fwdZ = Math.cos(angle);

  let hitAny = false;

  for (let i = 0; i < zombies.length; i++) {
    const z = zombies[i];
    if (z.isDead) continue;

    const dx = z.position.x - player.position.x;
    const dz = z.position.z - player.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist <= punchReach) {
      const nx = dx / (dist || 1);
      const nz = dz / (dist || 1);
      const dot = fwdX * nx + fwdZ * nz;

      if (dot > 0.40) {
        hitAny = true;
        damageZombie(z, player.attackDamage, nx, nz);
      }
    }
  }

  if (hitAny) {
    playPunchImpact();
  }
}

function damageZombie(z, damage, dirX, dirZ) {
  z.hp = Math.max(0, z.hp - damage);
  z.hitFlashTime = 0.22;

  // Knockback impulse
  z.velocity.x = dirX * 6.5;
  z.velocity.z = dirZ * 6.5;

  playZombieHurt();
  spawnHitParticles(z.position.x, z.position.y + 1.25, z.position.z);
  updateZombieHealthBar(z);

  // Punching a grabbing zombie helps struggle free faster
  if (player.grabbedBy === z) {
    z.struggleTimer += 0.65;
  }

  if (z.hp <= 0 && !z.isDead) {
    z.isDead = true;
    z.deathTimer = 0;
    z.state = 'dead';

    // Hide health bar immediately
    if (z.healthBar && z.healthBar.barGroup) {
      z.healthBar.barGroup.visible = false;
    }

    // Release player immediately if attached
    if (player.grabbedBy === z) {
      player.isGrabbed = false;
      player.grabbedBy = null;
    }

    // Kinetic impact from punch direction
    let kx = dirX || 0;
    let kz = dirZ || 0;
    if (Math.hypot(kx, kz) < 0.01) {
      kx = -Math.sin(z.facingAngle);
      kz = -Math.cos(z.facingAngle);
    }
    const punchImpulse = 9.5 + Math.random() * 3.0;
    initZombieVerletRagdoll(z, kx, kz, punchImpulse);

    zombiesDefeated++;
    const countElem = document.getElementById('zombies-count');
    if (countElem) countElem.innerText = zombiesDefeated;
    playZombieDeath();
  }
}

// --- 3D Pistol Combat Mechanics ---
const ammoDisplayElem = document.getElementById('ammo-display');
const reloadStatusElem = document.getElementById('reload-status');

function updateAmmoUI() {
  if (ammoDisplayElem) {
    ammoDisplayElem.innerText = `${pistolState.ammo} / ${pistolState.maxAmmo}`;
    if (pistolState.ammo === 0) {
      ammoDisplayElem.style.color = '#ff595e';
    } else if (pistolState.ammo <= 4) {
      ammoDisplayElem.style.color = '#ffd166';
    } else {
      ammoDisplayElem.style.color = '#06d6a0';
    }
  }
  if (reloadStatusElem) {
    reloadStatusElem.style.display = pistolState.isReloading ? 'inline-block' : 'none';
  }
}

function reloadGun() {
  if (pistolState.isReloading || pistolState.ammo === pistolState.maxAmmo) return;
  pistolState.isReloading = true;
  pistolState.reloadTimer = pistolState.reloadDuration;
  playReload();
  updateAmmoUI();
}

function shootGun() {
  if (!gameStarted) return;
  if (player.hp <= 0) return;
  if (pistolState.fireCooldown > 0) return;
  if (pistolState.isReloading) return;

  if (pistolState.ammo <= 0) {
    playDryFire();
    reloadGun();
    return;
  }

  pistolState.ammo--;
  pistolState.fireCooldown = pistolState.fireRate;
  pistolState.aimTimer = 0.85;
  pistolState.recoilKick = 1.0;
  pistolState.triggerPull = 1.0;
  updateAmmoUI();

  playGunshot();

  // Point-blank shot while grabbed by zombie
  if (player.isGrabbed && player.grabbedBy) {
    damageZombie(player.grabbedBy, pistolState.damage * 1.5, 0, 0);
  }

  // Camera recoil kick
  if (isFirstPerson) {
    pistolState.recoilZ = 0.07;
    pistolState.recoilRotX = 0.16;
    cameraPitch += 0.018;
  }

  // Determine muzzle point in world space
  const muzzlePos = new THREE.Vector3();
  let activeMuzzle = null;
  if (isFirstPerson && pistolState.fpsGun) {
    activeMuzzle = pistolState.fpsGun.getObjectByName('Muzzle_Point') || pistolState.fpsGun;
  } else if (pistolState.thirdPerson) {
    activeMuzzle = pistolState.thirdPerson.getObjectByName('Muzzle_Point') || pistolState.thirdPerson;
  }

  if (activeMuzzle) {
    activeMuzzle.getWorldPosition(muzzlePos);
  } else {
    muzzlePos.copy(camera.position);
  }

  // Raycast from camera center through crosshair
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const ray = raycaster.ray;

  // 1. Ray-Capsule intersection with all alive zombies
  let closestHitZ = null;
  let minZombieDist = 150.0;
  let zombieHitPos = new THREE.Vector3();

  for (let i = 0; i < zombies.length; i++) {
    const z = zombies[i];
    if (z.isDead) continue;

    const base = new THREE.Vector3(z.position.x, z.position.y + 0.2, z.position.z);
    const w0 = ray.origin.clone().sub(base);
    const v = new THREE.Vector3(0, 1, 0);
    const u = ray.direction;

    const a = u.dot(u);
    const b = u.dot(v);
    const c = v.dot(v);
    const d = u.dot(w0);
    const e = v.dot(w0);

    const denom = a * c - b * b;
    if (Math.abs(denom) > 1e-6) {
      const s = (b * e - c * d) / denom;
      const t = (a * e - b * d) / denom;

      if (s > 0.5 && s < minZombieDist && t >= -0.2 && t <= 1.85) {
        const pRay = ray.origin.clone().addScaledVector(u, s);
        const pZ = base.clone().addScaledVector(v, Math.max(0, Math.min(1.65, t)));
        const distToAxis = pRay.distanceTo(pZ);

        if (distToAxis <= 0.85) {
          minZombieDist = s;
          closestHitZ = z;
          zombieHitPos.copy(pRay);
        }
      }
    }
  }

  // 2. Terrain collision intersection
  let terrainHitPos = null;
  let terrainDist = 150.0;
  const terrainIntersects = raycaster.intersectObject(terrainMesh);
  if (terrainIntersects.length > 0) {
    terrainHitPos = terrainIntersects[0].point;
    terrainDist = terrainIntersects[0].distance;
  }

  let finalHitPos = new THREE.Vector3();
  if (closestHitZ && minZombieDist < terrainDist) {
    finalHitPos.copy(zombieHitPos);
    damageZombie(closestHitZ, pistolState.damage, ray.direction.x, ray.direction.z);
  } else if (terrainHitPos) {
    finalHitPos.copy(terrainHitPos);
    spawnTerrainImpactParticles(finalHitPos.x, finalHitPos.y, finalHitPos.z);
  } else {
    finalHitPos.copy(ray.origin).addScaledVector(ray.direction, 80.0);
  }

  // 3. Glowing high-speed bullet tracer
  spawnBulletTracer(muzzlePos, finalHitPos);

  // 4. Muzzle flash VFX
  const flashDir = finalHitPos.clone().sub(muzzlePos).normalize();
  triggerMuzzleFlash(muzzlePos, flashDir);

  // Auto-reload after last bullet
  if (pistolState.ammo === 0) {
    setTimeout(() => {
      if (pistolState.ammo === 0 && !pistolState.isReloading) {
        reloadGun();
      }
    }, 350);
  }
}

function updateWeapons(dt) {
  if (pistolState.fireCooldown > 0) {
    pistolState.fireCooldown -= dt;
  }
  if (pistolState.aimTimer > 0) {
    pistolState.aimTimer -= dt;
  }
  if (pistolState.recoilKick > 0) {
    pistolState.recoilKick = Math.max(0, pistolState.recoilKick - dt * 6.0);
  }
  if (pistolState.triggerPull > 0) {
    pistolState.triggerPull = Math.max(0, pistolState.triggerPull - dt * 14.0);
  }
  if (pistolState.isReloading) {
    pistolState.reloadTimer -= dt;
    if (pistolState.reloadTimer <= 0) {
      pistolState.ammo = pistolState.maxAmmo;
      pistolState.isReloading = false;
      updateAmmoUI();
    }
  }
  if (pistolState.flashTimer > 0) {
    pistolState.flashTimer -= dt;
    if (pistolState.flashTimer <= 0 && muzzleFlash) {
      muzzleFlash.visible = false;
    }
  }

  // Ensure third person pistol is safely attached to player's right hand if loaded
  if (pistolState.thirdPerson && (!pistolState.thirdPerson.parent || !player.bones['Hand_R']?.children.includes(pistolState.thirdPerson))) {
    attachPistolToHand();
  }

  updateTracers(dt);

  // FPS Viewmodel Sway & Recoil with visible right hand & arm
  if (isFirstPerson && pistolState.fpsGroup) {
    const isMoving = keys['KeyW'] || keys['KeyS'] || keys['KeyA'] || keys['KeyD'] || Math.hypot(joystickVector.x, joystickVector.y) > 0.1;
    const swayAmp = isMoving ? 0.008 : 0.002;
    const swaySpeed = isMoving ? (keys['ShiftLeft'] ? 13 : 8.5) : 3;
    const time = clock.getElapsedTime();

    const targetX = 0.14 + Math.sin(time * swaySpeed) * swayAmp;
    const targetY = -0.105 + Math.abs(Math.cos(time * swaySpeed)) * (swayAmp * 0.75) - (pistolState.isReloading ? 0.07 : 0);
    const targetZ = -0.27 + pistolState.recoilZ;

    pistolState.fpsGroup.position.x += (targetX - pistolState.fpsGroup.position.x) * Math.min(1.0, 16 * dt);
    pistolState.fpsGroup.position.y += (targetY - pistolState.fpsGroup.position.y) * Math.min(1.0, 16 * dt);
    pistolState.fpsGroup.position.z += (targetZ - pistolState.fpsGroup.position.z) * Math.min(1.0, 20 * dt);

    const targetRotX = 0.03 + pistolState.recoilRotX + (pistolState.isReloading ? 0.22 : 0);
    const targetRotY = -0.05;
    const targetRotZ = 0.02 + (pistolState.isReloading ? -0.32 : 0);
    pistolState.fpsGroup.rotation.x += (targetRotX - pistolState.fpsGroup.rotation.x) * Math.min(1.0, 18 * dt);
    pistolState.fpsGroup.rotation.y += (targetRotY - pistolState.fpsGroup.rotation.y) * Math.min(1.0, 18 * dt);
    pistolState.fpsGroup.rotation.z += (targetRotZ - pistolState.fpsGroup.rotation.z) * Math.min(1.0, 12 * dt);

    // Trigger finger reactive pull animation
    if (pistolState.fpsHand && pistolState.fpsHand.userData.indexTip) {
      const pull = pistolState.triggerPull;
      pistolState.fpsHand.userData.indexTip.position.z = -0.016 + pull * 0.005;
      pistolState.fpsHand.userData.indexTip.rotation.x = 0.10 + pull * 0.20;
    }

    pistolState.recoilZ = Math.max(0, pistolState.recoilZ - dt * 0.55);
    pistolState.recoilRotX = Math.max(0, pistolState.recoilRotX - dt * 1.4);
  }
}

// -------------------------------------------------------------
// VERLET MULTI-BODY RAGDOLL PHYSICS SIMULATOR
// -------------------------------------------------------------
const VEC_UP_Y = new THREE.Vector3(0, 1, 0);

function initZombieVerletRagdoll(z, dirX, dirZ, punchForce) {
  const cosF = Math.cos(z.facingAngle);
  const sinF = Math.sin(z.facingAngle);

  const toWorld = (lx, ly, lz) => new THREE.Vector3(
    z.position.x + cosF * lx + sinF * lz,
    z.position.y + ly,
    z.position.z - sinF * lx + cosF * lz
  );

  const particles = {
    hips: { pos: toWorld(0, 0.90, 0), oldPos: toWorld(0, 0.90, 0), mass: 2.2, radius: 0.18 },
    chest: { pos: toWorld(0, 1.20, 0), oldPos: toWorld(0, 1.20, 0), mass: 2.0, radius: 0.18 },
    head: { pos: toWorld(0, 1.55, 0.05), oldPos: toWorld(0, 1.55, 0.05), mass: 1.2, radius: 0.15 },

    shoulderR: { pos: toWorld(0.26, 1.35, 0.02), oldPos: toWorld(0.26, 1.35, 0.02), mass: 0.7, radius: 0.10 },
    elbowR: { pos: toWorld(0.32, 1.12, 0.10), oldPos: toWorld(0.32, 1.12, 0.10), mass: 0.6, radius: 0.09 },
    handR: { pos: toWorld(0.34, 0.92, 0.20), oldPos: toWorld(0.34, 0.92, 0.20), mass: 0.5, radius: 0.08 },

    shoulderL: { pos: toWorld(-0.26, 1.35, 0.02), oldPos: toWorld(-0.26, 1.35, 0.02), mass: 0.7, radius: 0.10 },
    elbowL: { pos: toWorld(-0.32, 1.12, 0.10), oldPos: toWorld(-0.32, 1.12, 0.10), mass: 0.6, radius: 0.09 },
    handL: { pos: toWorld(-0.34, 0.92, 0.20), oldPos: toWorld(-0.34, 0.92, 0.20), mass: 0.5, radius: 0.08 },

    hipR: { pos: toWorld(0.14, 0.90, 0), oldPos: toWorld(0.14, 0.90, 0), mass: 1.1, radius: 0.12 },
    kneeR: { pos: toWorld(0.14, 0.56, 0.07), oldPos: toWorld(0.14, 0.56, 0.07), mass: 0.9, radius: 0.10 },
    footR: { pos: toWorld(0.14, 0.20, 0.04), oldPos: toWorld(0.14, 0.20, 0.04), mass: 0.8, radius: 0.10 },

    hipL: { pos: toWorld(-0.14, 0.90, 0), oldPos: toWorld(-0.14, 0.90, 0), mass: 1.1, radius: 0.12 },
    kneeL: { pos: toWorld(-0.14, 0.56, 0.07), oldPos: toWorld(-0.14, 0.56, 0.07), mass: 0.9, radius: 0.10 },
    footL: { pos: toWorld(-0.14, 0.20, 0.04), oldPos: toWorld(-0.14, 0.20, 0.04), mass: 0.8, radius: 0.10 }
  };

  // Kinetic Impulse applied directly to impact points (Head & Chest)
  const dtSim = 1 / 60;
  const kHead = punchForce * 1.35;
  particles.head.oldPos.x -= dirX * kHead * dtSim;
  particles.head.oldPos.z -= dirZ * kHead * dtSim;
  particles.head.oldPos.y -= 0.18; // upward head snap

  const kChest = punchForce * 1.10;
  particles.chest.oldPos.x -= dirX * kChest * dtSim;
  particles.chest.oldPos.z -= dirZ * kChest * dtSim;
  particles.chest.oldPos.y -= 0.14;

  const kHips = punchForce * 0.70;
  particles.hips.oldPos.x -= dirX * kHips * dtSim;
  particles.hips.oldPos.z -= dirZ * kHips * dtSim;
  particles.hips.oldPos.y -= 0.06;

  // Wild asymmetric limb flail momentum
  const flailR = (Math.random() - 0.5) * 4.0;
  const flailL = (Math.random() - 0.5) * 4.0;
  particles.handR.oldPos.x -= (dirX * punchForce * 0.8 + flailR) * dtSim;
  particles.handR.oldPos.y -= (2.5 + Math.random() * 2.0) * dtSim;
  particles.handR.oldPos.z -= (dirZ * punchForce * 0.8 - flailR) * dtSim;

  particles.handL.oldPos.x -= (dirX * punchForce * 0.8 + flailL) * dtSim;
  particles.handL.oldPos.y -= (2.5 + Math.random() * 2.0) * dtSim;
  particles.handL.oldPos.z -= (dirZ * punchForce * 0.8 - flailL) * dtSim;

  const dist = (p1, p2) => p1.pos.distanceTo(p2.pos);
  const constraints = [
    // Spine
    ['hips', 'chest', dist(particles.hips, particles.chest)],
    ['chest', 'head', dist(particles.chest, particles.head)],
    ['hips', 'head', dist(particles.hips, particles.head)],

    // Right Arm
    ['chest', 'shoulderR', dist(particles.chest, particles.shoulderR)],
    ['shoulderR', 'elbowR', dist(particles.shoulderR, particles.elbowR)],
    ['elbowR', 'handR', dist(particles.elbowR, particles.handR)],

    // Left Arm
    ['chest', 'shoulderL', dist(particles.chest, particles.shoulderL)],
    ['shoulderL', 'elbowL', dist(particles.shoulderL, particles.elbowL)],
    ['elbowL', 'handL', dist(particles.elbowL, particles.handL)],

    // Shoulder bridge
    ['shoulderR', 'shoulderL', dist(particles.shoulderR, particles.shoulderL)],

    // Pelvis
    ['hips', 'hipR', dist(particles.hips, particles.hipR)],
    ['hips', 'hipL', dist(particles.hips, particles.hipL)],
    ['hipR', 'hipL', dist(particles.hipR, particles.hipL)],

    // Legs
    ['hipR', 'kneeR', dist(particles.hipR, particles.kneeR)],
    ['kneeR', 'footR', dist(particles.kneeR, particles.footR)],
    ['hipL', 'kneeL', dist(particles.hipL, particles.kneeL)],
    ['kneeL', 'footL', dist(particles.kneeL, particles.footL)],

    // Structural Cross Bracing (prevents origami inversion)
    ['kneeR', 'kneeL', dist(particles.kneeR, particles.kneeL)],
    ['chest', 'hipR', dist(particles.chest, particles.hipR)],
    ['chest', 'hipL', dist(particles.chest, particles.hipL)]
  ];

  z.verletRagdoll = {
    particles,
    constraints,
    settled: false,
    time: 0
  };
}

function updateZombieVerletPhysics(z, dt) {
  const rag = z.verletRagdoll;
  if (!rag) return;
  rag.time += dt;

  const gravity = -22.0;
  const damping = 0.985;
  const subSteps = 2;
  const sdt = dt / subSteps;

  if (!rag.settled) {
    for (let step = 0; step < subSteps; step++) {
      // 1. Verlet particle integration
      for (const name in rag.particles) {
        const p = rag.particles[name];
        const vx = (p.pos.x - p.oldPos.x) * damping;
        let vy = (p.pos.y - p.oldPos.y) * damping + gravity * sdt * sdt;
        const vz = (p.pos.z - p.oldPos.z) * damping;

        p.oldPos.copy(p.pos);

        p.pos.x += vx;
        p.pos.y += vy;
        p.pos.z += vz;

        // 3D Terrain Collision per particle
        const gY = getTerrainHeight(p.pos.x, p.pos.z);
        const floorY = gY + p.radius;
        if (p.pos.y < floorY) {
          p.pos.y = floorY;
          // Ground friction & slide
          p.oldPos.x += (p.pos.x - p.oldPos.x) * 0.55;
          p.oldPos.z += (p.pos.z - p.oldPos.z) * 0.55;
          // Inelastic bounce
          if (p.pos.y - p.oldPos.y < -0.04) {
            p.oldPos.y = p.pos.y + (p.pos.y - p.oldPos.y) * 0.22;
          }
        }
      }

      // 2. Distance constraint relaxation
      for (let iter = 0; iter < 8; iter++) {
        for (let c = 0; c < rag.constraints.length; c++) {
          const [n1, n2, targetDist] = rag.constraints[c];
          const p1 = rag.particles[n1];
          const p2 = rag.particles[n2];

          const dx = p2.pos.x - p1.pos.x;
          const dy = p2.pos.y - p1.pos.y;
          const dz = p2.pos.z - p1.pos.z;
          const curDist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (curDist > 0.0001) {
            const diff = (curDist - targetDist) / curDist;
            const w1 = 1.0 / p1.mass;
            const w2 = 1.0 / p2.mass;
            const invTotal = 1.0 / (w1 + w2);

            p1.pos.x += dx * diff * w1 * invTotal;
            p1.pos.y += dy * diff * w1 * invTotal;
            p1.pos.z += dz * diff * w1 * invTotal;

            p2.pos.x -= dx * diff * w2 * invTotal;
            p2.pos.y -= dy * diff * w2 * invTotal;
            p2.pos.z -= dz * diff * w2 * invTotal;

            const f1 = getTerrainHeight(p1.pos.x, p1.pos.z) + p1.radius;
            if (p1.pos.y < f1) p1.pos.y = f1;
            const f2 = getTerrainHeight(p2.pos.x, p2.pos.z) + p2.radius;
            if (p2.pos.y < f2) p2.pos.y = f2;
          }
        }
      }
    }

    if (rag.time > 2.5) {
      let maxVelSq = 0;
      for (const name in rag.particles) {
        const p = rag.particles[name];
        const vSq = p.pos.distanceToSquared(p.oldPos);
        if (vSq > maxVelSq) maxVelSq = vSq;
      }
      if (maxVelSq < 0.0004) {
        rag.settled = true;
      }
    }
  }

  // 3. Update 3D Armature Bones from Physical Particles
  const pts = rag.particles;
  const bones = z.bones;
  const getZB = (name) => bones[name] || bones[name.replace(/\./g, '')];

  z.group.position.set(0, 0, 0);
  z.group.rotation.set(0, 0, 0);
  z.model.position.set(0, 0, 0);
  z.model.rotation.set(0, 0, 0);

  const hips = getZB('hips');
  const chest = getZB('chest');
  const head = getZB('head');
  const thighR = getZB('thighR');
  const thighL = getZB('thighL');
  const shinR = getZB('shinR');
  const shinL = getZB('shinL');
  const armR = getZB('upper_armR');
  const armL = getZB('upper_armL');
  const foreR = getZB('forearmR');
  const foreL = getZB('forearmL');

  if (hips) {
    hips.position.copy(pts.hips.pos);

    // Hips basis: Up points towards chest, Right points towards hipR - hipL
    const upH = pts.chest.pos.clone().sub(pts.hips.pos).normalize();
    const rightH = pts.hipR.pos.clone().sub(pts.hipL.pos).normalize();
    const fwdH = new THREE.Vector3().crossVectors(rightH, upH).normalize();
    rightH.crossVectors(upH, fwdH).normalize();
    const mHips = new THREE.Matrix4().makeBasis(rightH, upH, fwdH);
    hips.quaternion.setFromRotationMatrix(mHips);

    // Chest: oriented towards head
    if (chest) {
      const upC = pts.head.pos.clone().sub(pts.chest.pos).normalize();
      const rightC = pts.shoulderR.pos.clone().sub(pts.shoulderL.pos).normalize();
      const fwdC = new THREE.Vector3().crossVectors(rightC, upC).normalize();
      rightC.crossVectors(upC, fwdC).normalize();
      const mChest = new THREE.Matrix4().makeBasis(rightC, upC, fwdC);
      const qChestWorld = new THREE.Quaternion().setFromRotationMatrix(mChest);
      chest.quaternion.copy(hips.quaternion.clone().invert().multiply(qChestWorld));
    }

    if (head) {
      head.quaternion.identity();
    }

    // Legs: Thigh.R points from hipR to kneeR
    if (thighR) {
      const vThighR = pts.kneeR.pos.clone().sub(pts.hipR.pos).normalize();
      const qThighRWorld = new THREE.Quaternion().setFromUnitVectors(VEC_UP_Y, vThighR);
      thighR.quaternion.copy(hips.quaternion.clone().invert().multiply(qThighRWorld));

      if (shinR) {
        const vShinR = pts.footR.pos.clone().sub(pts.kneeR.pos).normalize();
        const qShinRWorld = new THREE.Quaternion().setFromUnitVectors(VEC_UP_Y, vShinR);
        shinR.quaternion.copy(qThighRWorld.clone().invert().multiply(qShinRWorld));
      }
    }

    // Thigh.L points from hipL to kneeL
    if (thighL) {
      const vThighL = pts.kneeL.pos.clone().sub(pts.hipL.pos).normalize();
      const qThighLWorld = new THREE.Quaternion().setFromUnitVectors(VEC_UP_Y, vThighL);
      thighL.quaternion.copy(hips.quaternion.clone().invert().multiply(qThighLWorld));

      if (shinL) {
        const vShinL = pts.footL.pos.clone().sub(pts.kneeL.pos).normalize();
        const qShinLWorld = new THREE.Quaternion().setFromUnitVectors(VEC_UP_Y, vShinL);
        shinL.quaternion.copy(qThighLWorld.clone().invert().multiply(qShinLWorld));
      }
    }

    // Arms: Upper Arm R points from shoulderR to elbowR
    if (armR && chest) {
      const vArmR = pts.elbowR.pos.clone().sub(pts.shoulderR.pos).normalize();
      const qArmRWorld = new THREE.Quaternion().setFromUnitVectors(VEC_UP_Y, vArmR);
      const qChestWorld = hips.quaternion.clone().multiply(chest.quaternion);
      armR.quaternion.copy(qChestWorld.clone().invert().multiply(qArmRWorld));

      if (foreR) {
        const vForeR = pts.handR.pos.clone().sub(pts.elbowR.pos).normalize();
        const qForeRWorld = new THREE.Quaternion().setFromUnitVectors(VEC_UP_Y, vForeR);
        foreR.quaternion.copy(qArmRWorld.clone().invert().multiply(qForeRWorld));
      }
    }

    // Upper Arm L points from shoulderL to elbowL
    if (armL && chest) {
      const vArmL = pts.elbowL.pos.clone().sub(pts.shoulderL.pos).normalize();
      const qArmLWorld = new THREE.Quaternion().setFromUnitVectors(VEC_UP_Y, vArmL);
      const qChestWorld = hips.quaternion.clone().multiply(chest.quaternion);
      armL.quaternion.copy(qChestWorld.clone().invert().multiply(qArmLWorld));

      if (foreL) {
        const vForeL = pts.handL.pos.clone().sub(pts.elbowL.pos).normalize();
        const qForeLWorld = new THREE.Quaternion().setFromUnitVectors(VEC_UP_Y, vForeL);
        foreL.quaternion.copy(qArmLWorld.clone().invert().multiply(qForeLWorld));
      }
    }
  }

  // After 3.5 seconds corpse sinks into the ground
  if (z.deathTimer > 3.5) {
    for (const name in pts) {
      pts[name].pos.y -= 0.35 * dt;
    }
    if (z.deathTimer > 5.5 && z.group.parent) {
      scene.remove(z.group);
    }
  }
}

function updateZombies(dt) {
  for (let i = 0; i < zombies.length; i++) {
    const z = zombies[i];

    // Orient health bar towards current camera (if visible)
    if (z.healthBar && z.healthBar.barGroup && z.healthBar.barGroup.visible) {
      z.healthBar.barGroup.quaternion.copy(camera.quaternion);
    }

    // -------------------------------------------------------------
    // 1. DEAD ZOMBIE REAL VERLET RAGDOLL PHYSICS SIMULATION
    // -------------------------------------------------------------
    if (z.isDead) {
      z.deathTimer += dt;
      if (!z.verletRagdoll) {
        initZombieVerletRagdoll(z, -Math.sin(z.facingAngle), -Math.cos(z.facingAngle), 8.0);
      }
      updateZombieVerletPhysics(z, dt);
      continue;
    }

    // -------------------------------------------------------------
    // 2. ALIVE ZOMBIE: TIMERS & HIT FLASH
    // -------------------------------------------------------------
    if (z.grabCooldown > 0) {
      z.grabCooldown -= dt;
    }

    if (z.hitFlashTime > 0) {
      z.hitFlashTime -= dt;
      const flash = z.hitFlashTime > 0;
      z.materials.forEach(({ mat, origColor }) => {
        if (flash) {
          mat.color.setHex(0xff3333);
        } else {
          mat.color.copy(origColor);
        }
      });
    }

    // Knockback dampening
    z.velocity.x *= Math.pow(0.005, dt);
    z.velocity.z *= Math.pow(0.005, dt);

    const dx = player.position.x - z.position.x;
    const dz = player.position.z - z.position.z;
    const distToPlayer = Math.sqrt(dx * dx + dz * dz);

    // -------------------------------------------------------------
    // 3. GRAB ATTACK: ACTIVE RAGDOLL TETHER + 2-BONE IK LEGS
    // -------------------------------------------------------------
    if (z.state === 'grab') {
      if (!z.grabRagdoll) {
        z.grabRagdoll = {
          swayX: 0,
          swayZ: 0
        };
      }
      const gr = z.grabRagdoll;

      // 1. Elastic Physical Anchor in front of player
      const pFwdX = Math.sin(player.facingAngle);
      const pFwdZ = Math.cos(player.facingAngle);
      const anchorDist = 0.90;
      const targetX = player.position.x + pFwdX * anchorDist;
      const targetZ = player.position.z + pFwdZ * anchorDist;

      // Spring-damper physics pulling zombie toward anchor
      const springK = 85.0;
      const damping = 14.0;
      const errX = targetX - z.position.x;
      const errZ = targetZ - z.position.z;

      z.velocity.x += (errX * springK - z.velocity.x * damping) * dt;
      z.velocity.z += (errZ * springK - z.velocity.z * damping) * dt;

      z.position.x += z.velocity.x * dt;
      z.position.z += z.velocity.z * dt;

      // Hard tether clamp
      const curDist = Math.sqrt((z.position.x - player.position.x) ** 2 + (z.position.z - player.position.z) ** 2);
      if (curDist > 1.30) {
        const clampRatio = 1.30 / curDist;
        z.position.x = player.position.x + (z.position.x - player.position.x) * clampRatio;
        z.position.z = player.position.z + (z.position.z - player.position.z) * clampRatio;
      }
      z.position.y = getTerrainHeight(z.position.x, z.position.z);

      // Face towards player
      const toPlayerX = player.position.x - z.position.x;
      const toPlayerZ = player.position.z - z.position.z;
      z.facingAngle = Math.atan2(toPlayerX, toPlayerZ);

      z.group.position.copy(z.position);
      z.group.rotation.y = z.facingAngle;

      // 2. Continuous player health drain & bite sounds
      player.hp = Math.max(0, player.hp - 11.0 * dt);
      z.biteTimer += dt;
      if (z.biteTimer >= 0.42) {
        z.biteTimer = 0;
        playZombieBite();
      }

      // 3. Struggle detection: player moving actively for 2 seconds
      const playerIsMoving = (Math.abs(touchInputFwd) > 0.05 || Math.abs(touchInputRight) > 0.05 ||
        keys['KeyW'] || keys['KeyS'] || keys['KeyA'] || keys['KeyD'] ||
        keys['ArrowUp'] || keys['ArrowDown'] || keys['ArrowLeft'] || keys['ArrowRight'] ||
        !player.isGrounded);

      if (playerIsMoving) {
        z.struggleTimer += dt;
      }

      if (z.struggleTimer >= 2.0) {
        // BREAK OFF!
        z.state = 'chase';
        player.isGrabbed = false;
        player.grabbedBy = null;
        z.grabCooldown = 3.2; // Grace period
        z.struggleTimer = 0;
        z.grabRagdoll = null;
        z.model.rotation.set(0, 0, 0);

        // Push zombie away violently
        z.velocity.x = pFwdX * 9.5;
        z.velocity.z = pFwdZ * 9.5;
        playZombieBreakOff();
        continue;
      }

      // 4. "FISICA ATTIVA": Active Ragdoll Body Sway & Limb Inertia (Calibrata: meno inclinata)
      const cosF = Math.cos(z.facingAngle);
      const sinF = Math.sin(z.facingAngle);
      // Local lateral and forward velocities
      const localVelX = cosF * z.velocity.x - sinF * z.velocity.z;
      const localVelZ = sinF * z.velocity.x + cosF * z.velocity.z;

      // Active torso tilt & swing from drag forces - ridotta per postura più naturale e controllata
      const targetSwayX = Math.max(-0.15, Math.min(0.15, -localVelX * 0.045));
      const targetSwayZ = Math.max(-0.12, Math.min(0.12, localVelZ * 0.035));
      gr.swayX += (targetSwayX - gr.swayX) * Math.min(1.0, 10.0 * dt);
      gr.swayZ += (targetSwayZ - gr.swayZ) * Math.min(1.0, 10.0 * dt);

      z.model.rotation.z = gr.swayX * 0.6; // Inclinazione laterale leggera
      z.model.rotation.x = gr.swayZ * 0.5; // Inclinazione frontale contenuta

      const bones = z.bones;
      const rest = z.restRotations;
      const getZB = (name) => bones[name] || bones[name.replace(/\./g, '')];
      const getZR = (name) => rest[name] || rest[name.replace(/\./g, '')];

      const chest = getZB('chest');
      const head = getZB('head');
      const armR = getZB('upper_armR');
      const armL = getZB('upper_armL');
      const foreR = getZB('forearmR');
      const foreL = getZB('forearmL');
      const thighR = getZB('thighR');
      const thighL = getZB('thighL');
      const shinR = getZB('shinR');
      const shinL = getZB('shinL');
      const footR = getZB('footR');
      const footL = getZB('footL');

      const time = clock.getElapsedTime();
      const tremble = Math.sin(time * 24.0) * 0.035;
      const tension = Math.max(-0.15, Math.min(0.20, (curDist - 0.90) * 0.7));

      // Spine & Head dynamic reactive ragdoll (inclinazione frontale dolce, zombie più eretto):
      if (chest && getZR('chest')) {
        chest.rotation.x = (getZR('chest').x || 0) - 0.08 + gr.swayZ * 0.25;
        chest.rotation.y = (getZR('chest').y || 0) + gr.swayX * 0.35 + Math.sin(time * 16.0) * 0.04;
        chest.rotation.z = (getZR('chest').z || 0) - gr.swayX * 0.2;
      }
      if (head && getZR('head')) {
        head.rotation.x = (getZR('head').x || 0) + 0.10 - gr.swayZ * 0.3 + Math.sin(time * 20.0) * 0.08;
        head.rotation.y = (getZR('head').y || 0) - gr.swayX * 0.35;
        head.rotation.z = (getZR('head').z || 0) + gr.swayX * 0.25 + Math.sin(time * 18.0) * 0.04;
      }

      // RAGDOLL ARMS: Wrap around player's shoulders
      // Right arm: reaches forward and clasp left shoulder
      if (armR && getZR('upper_armR')) {
        armR.rotation.x = getZR('upper_armR').x + 0.06 + tremble;
        armR.rotation.y = getZR('upper_armR').y - 1.45 - tension * 0.25 + gr.swayX * 0.15;
        armR.rotation.z = (getZR('upper_armR').z || 0) + 0.08;
      }
      if (foreR && getZR('forearmR')) {
        foreR.rotation.x = getZR('forearmR').x + 0.35 - tension + tremble;
        foreR.rotation.y = getZR('forearmR').y;
        foreR.rotation.z = getZR('forearmR').z;
      }

      // Left arm: reaches forward and clasp right shoulder (proper mirrored signs!)
      if (armL && getZR('upper_armL')) {
        armL.rotation.x = getZR('upper_armL').x - 0.06 - tremble;
        armL.rotation.y = getZR('upper_armL').y + 1.45 + tension * 0.25 + gr.swayX * 0.15;
        armL.rotation.z = (getZR('upper_armL').z || 0) - 0.08;
      }
      if (foreL && getZR('forearmL')) {
        foreL.rotation.x = getZR('forearmL').x + 0.35 - tension - tremble;
        foreL.rotation.y = getZR('forearmL').y;
        foreL.rotation.z = getZR('forearmL').z;
      }

      // 5. 2-BONE IK LEGS: Adapt to terrain slope & dragging shuffle
      const sideR = 0.14;
      const footXR = z.position.x + cosF * sideR;
      const footZR = z.position.z - sinF * sideR;
      const footXL = z.position.x - cosF * sideR;
      const footZL = z.position.z + sinF * sideR;

      const gYR = getTerrainHeight(footXR, footZR);
      const gYL = getTerrainHeight(footXL, footZL);

      const shuffle = playerIsMoving ? Math.sin(time * 12.0) : 0;
      const deltaYR = Math.max(-0.35, Math.min(0.35, (gYR - z.position.y) + Math.max(0, shuffle) * 0.08));
      const deltaYL = Math.max(-0.35, Math.min(0.35, (gYL - z.position.y) + Math.max(0, -shuffle) * 0.08));

      const ikR = solveLegIK(REST_HIP_Y, 0.0, REST_ANKLE_Y + deltaYR, 0.04 + shuffle * 0.06, getZR('thighR').x, getZR('shinR').x);
      const ikL = solveLegIK(REST_HIP_Y, 0.0, REST_ANKLE_Y + deltaYL, -0.04 - shuffle * 0.06, getZR('thighL').x, getZR('shinL').x);

      if (thighR && getZR('thighR')) {
        thighR.rotation.x = ikR.thighX;
        thighR.rotation.z = (getZR('thighR').z || 0) + 0.06;
      }
      if (shinR && getZR('shinR')) shinR.rotation.x = ikR.shinX;
      if (footR && getZR('footR')) footR.rotation.x = getZR('footR').x + deltaYR * 1.2;

      if (thighL && getZR('thighL')) {
        thighL.rotation.x = ikL.thighX;
        thighL.rotation.z = (getZR('thighL').z || 0) - 0.06;
      }
      if (shinL && getZR('shinL')) shinL.rotation.x = ikL.shinX;
      if (footL && getZR('footL')) footL.rotation.x = getZR('footL').x + deltaYL * 1.2;

      continue; // Skip normal wander/chase while grabbing
    }

    // -------------------------------------------------------------
    // 4. ALIVE ZOMBIE: CHASE, SPEED-UP & GRAB INITIATION
    // -------------------------------------------------------------
    // Check if close enough to initiate GRAB attack
    if (distToPlayer < 1.45 && z.grabCooldown <= 0 && !player.isGrabbed) {
      z.state = 'grab';
      player.isGrabbed = true;
      player.grabbedBy = z;
      z.struggleTimer = 0;
      z.biteTimer = 0;
      playZombieGrab();
      continue;
    }

    let moveSpeed = 0;
    let targetAngle = z.facingAngle;

    if (distToPlayer < 24.0) {
      // Fast, aggressive chase!
      z.state = 'chase';
      targetAngle = Math.atan2(dx, dz);
      moveSpeed = z.speed; // 3.6 m/s
    } else {
      // Wander / Patrol
      z.state = 'wander';
      z.wanderTimer -= dt;
      if (z.wanderTimer <= 0) {
        z.wanderTimer = 3.0 + Math.random() * 3.5;
        z.wanderAngle += (Math.random() - 0.5) * 2.2;
      }
      targetAngle = z.wanderAngle;
      moveSpeed = 1.0;
    }

    // Smooth rapid turn towards targetAngle
    let diff = targetAngle - z.facingAngle;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    z.facingAngle += diff * 7.5 * dt;

    // Movement integration
    const fwdX = Math.sin(z.facingAngle) * moveSpeed;
    const fwdZ = Math.cos(z.facingAngle) * moveSpeed;

    let nextX = z.position.x + (fwdX + z.velocity.x) * dt;
    let nextZ = z.position.z + (fwdZ + z.velocity.z) * dt;

    // Terrain boundaries
    const maxBound = halfSize - 4;
    nextX = Math.max(-maxBound, Math.min(maxBound, nextX));
    nextZ = Math.max(-maxBound, Math.min(maxBound, nextZ));

    // Obstacle collision avoidance
    for (let o = 0; o < obstacles.length; o++) {
      const obs = obstacles[o];
      const ox = nextX - obs.x;
      const oz = nextZ - obs.z;
      const dSq = ox * ox + oz * oz;
      const minD = obs.radius + 0.45;
      if (dSq < minD * minD && dSq > 0.0001) {
        const d = Math.sqrt(dSq);
        const push = (minD - d) / d;
        nextX += ox * push;
        nextZ += oz * push;
      }
    }

    z.position.x = nextX;
    z.position.z = nextZ;
    z.position.y = getTerrainHeight(nextX, nextZ);

    z.group.position.copy(z.position);
    z.group.rotation.y = z.facingAngle;

    // Fast and energetic procedural shambler animation
    const isWalking = moveSpeed > 0.05;
    if (isWalking) {
      z.walkCycle += dt * (z.state === 'chase' ? 7.8 : 3.8); // Much faster!
    }
    const cycle = z.walkCycle;

    const bones = z.bones;
    const rest = z.restRotations;
    const getZB = (name) => bones[name] || bones[name.replace(/\./g, '')];
    const getZR = (name) => rest[name] || rest[name.replace(/\./g, '')];

    const thighR = getZB('thighR');
    const thighL = getZB('thighL');
    const shinR = getZB('shinR');
    const shinL = getZB('shinL');
    const armR = getZB('upper_armR');
    const armL = getZB('upper_armL');
    const foreR = getZB('forearmR');
    const foreL = getZB('forearmL');
    const chest = getZB('chest');
    const head = getZB('head');

    // Rapid limping legs
    if (thighR && getZR('thighR')) {
      const legR = Math.sin(cycle);
      const legL = -Math.sin(cycle);
      thighR.rotation.x = getZR('thighR').x + legR * 0.44;
      thighL.rotation.x = getZR('thighL').x + legL * 0.38;
      if (shinR && getZR('shinR')) shinR.rotation.x = getZR('shinR').x + Math.max(0, -legR) * 0.52;
      if (shinL && getZR('shinL')) shinL.rotation.x = getZR('shinL').x + Math.max(0, -legL) * 0.45;
    }

    // Outstretched zombie arms with fast bobbing
    z.model.rotation.set(0, 0, 0);
    if (armR && getZR('upper_armR')) {
      armR.rotation.x = getZR('upper_armR').x + Math.sin(cycle + 0.3) * 0.16;
      armR.rotation.y = getZR('upper_armR').y - 1.40 + Math.sin(cycle * 0.9) * 0.12;
      armR.rotation.z = (getZR('upper_armR').z || 0);
    }
    if (armL && getZR('upper_armL')) {
      armL.rotation.x = getZR('upper_armL').x - Math.sin(cycle - 0.3) * 0.16;
      armL.rotation.y = getZR('upper_armL').y + 1.40 + Math.sin(cycle * 0.9) * 0.12;
      armL.rotation.z = (getZR('upper_armL').z || 0);
    }
    if (foreR && getZR('forearmR')) {
      foreR.rotation.x = getZR('forearmR').x + 0.20 + Math.cos(cycle) * 0.10;
      foreR.rotation.y = getZR('forearmR').y;
      foreR.rotation.z = getZR('forearmR').z;
    }
    if (foreL && getZR('forearmL')) {
      foreL.rotation.x = getZR('forearmL').x + 0.20 - Math.cos(cycle) * 0.10;
      foreL.rotation.y = getZR('forearmL').y;
      foreL.rotation.z = getZR('forearmL').z;
    }

    // Torso stagger & hunch
    if (chest && getZR('chest')) {
      chest.rotation.x = (getZR('chest').x || 0) - 0.20 + (z.hitFlashTime > 0 ? 0.32 : 0);
      chest.rotation.z = (getZR('chest').z || 0) + Math.sin(cycle * 0.6) * 0.14;
    }
    if (head && getZR('head')) {
      head.rotation.z = (getZR('head').z || 0) + 0.16 + Math.sin(cycle * 0.9) * 0.10;
      head.rotation.x = (getZR('head').x || 0) + 0.12;
    }
  }
}

// --- Camera & View State ---
let isFirstPerson = false;
let invertX = true;       // Inverted horizontal rotation as requested
let invertY = false;      // Toggle invert Y (Normal: mouse up looks UP)
let cameraYaw = 0;       // Horizontal look angle in radians
let cameraPitch = 0.15;  // Vertical look angle in radians
const camDistance = 4.8;
const camHeightOffset = 1.35;

const camToggleBtn = document.getElementById('cam-toggle-btn');
const camModeText = document.getElementById('camera-mode-text');
const invertXToggleBtn = document.getElementById('invert-x-btn');
const invertXModeText = document.getElementById('invert-x-text');
const invertToggleBtn = document.getElementById('invert-toggle-btn');
const invertModeText = document.getElementById('invert-mode-text');
const crosshair = document.getElementById('crosshair');

function toggleCameraMode() {
  isFirstPerson = !isFirstPerson;
  camModeText.innerText = isFirstPerson ? '1ª PERSONA' : '3ª PERSONA';
  camToggleBtn.style.background = isFirstPerson ? '#ffd166' : '#06d6a0';
  camToggleBtn.style.color = isFirstPerson ? '#3d2e00' : '#0b3c31';
  crosshair.style.display = 'block';

  // Toggle pistol models between 1st and 3rd person
  if (pistolState.fpsGroup) {
    pistolState.fpsGroup.visible = isFirstPerson;
  }
  if (pistolState.thirdPerson) {
    pistolState.thirdPerson.visible = !isFirstPerson;
  }

  // In 1st person, hide head & hair so they don't clip the camera view
  player.headParts.forEach(p => p.visible = !isFirstPerson);
  playBeep(isFirstPerson ? 660 : 440, 0.08);
}

function toggleInvertX() {
  invertX = !invertX;
  if (invertXModeText) invertXModeText.innerText = invertX ? 'INVERTITO' : 'NORMALE';
  if (invertXToggleBtn) {
    invertXToggleBtn.style.background = invertX ? '#e76f51' : 'rgba(255,255,255,0.18)';
  }
  playBeep(invertX ? 520 : 380, 0.08);
}

function toggleInvertY() {
  invertY = !invertY;
  if (invertModeText) invertModeText.innerText = invertY ? 'INVERTITO' : 'NORMALE';
  if (invertToggleBtn) {
    invertToggleBtn.style.background = invertY ? '#e76f51' : 'rgba(255,255,255,0.18)';
  }
  playBeep(invertY ? 520 : 380, 0.08);
}

camToggleBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleCameraMode();
});

if (invertXToggleBtn) {
  invertXToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleInvertX();
  });
}

if (invertToggleBtn) {
  invertToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleInvertY();
  });
}

// Click / tap on ammo card to reload
if (ammoDisplayElem) {
  ammoDisplayElem.parentElement.style.cursor = 'pointer';
  ammoDisplayElem.parentElement.addEventListener('click', (e) => {
    e.stopPropagation();
    reloadGun();
  });
}

// --- Controls (Keyboard & Mouse) ---
const keys = {};
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'KeyV') {
    toggleCameraMode();
  }
  if (e.code === 'KeyX') {
    toggleInvertX();
  }
  if (e.code === 'KeyI') {
    toggleInvertY();
  }
  if (e.code === 'KeyF') {
    shootGun();
  }
  if (e.code === 'KeyR') {
    reloadGun();
  }
  if (e.code === 'KeyE') {
    punchAttack();
  }
});
window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
});

// Pointer Lock & Touch Detection
const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || window.matchMedia('(pointer: coarse)').matches;
const touchControlsElem = document.getElementById('touch-controls');

let gameStarted = false;

const overlay = document.getElementById('instructions-overlay');
const startBtn = document.getElementById('start-btn');

function startGame(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  if (!isTouchDevice && document.body.requestPointerLock) {
    document.body.requestPointerLock();
  }
  gameStarted = true;
  if (isTouchDevice && touchControlsElem) {
    touchControlsElem.style.display = 'block';
  }
  overlay.style.opacity = '0';
  overlay.style.pointerEvents = 'none';
  setTimeout(() => {
    overlay.style.display = 'none';
  }, 250);
  playBeep(520, 0.1, 'sine');
}

startBtn.addEventListener('click', startGame);
startBtn.addEventListener('touchend', startGame);
startBtn.addEventListener('pointerdown', startGame);

overlay.addEventListener('click', (e) => {
  if (e.target === overlay) startGame(e);
});
overlay.addEventListener('touchend', (e) => {
  if (e.target === overlay) startGame(e);
});

// Canvas click to focus and re-lock cursor seamlessly
canvas.addEventListener('click', (e) => {
  if (!gameStarted) {
    startGame(e);
  } else if (!isTouchDevice && document.pointerLockElement !== document.body) {
    document.body.requestPointerLock?.();
  }
});

// Pointer lock change: maintain gameplay and hide overlay
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === document.body) {
    gameStarted = true;
    overlay.style.display = 'none';
  }
});

// Unified Mouse Controls: Supports both Pointer Lock and Click & Drag
let isMouseDown = false;
let lastMouseX = 0;
let lastMouseY = 0;

window.addEventListener('mousedown', (e) => {
  if (e.target.closest('#instructions-overlay') || e.target.closest('.hud-card')) return;

  isMouseDown = true;
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;

  if (gameStarted && !isTouchDevice && document.pointerLockElement !== document.body) {
    document.body.requestPointerLock?.();
  }

  if (e.button === 0 && gameStarted) {
    shootGun();
  } else if (e.button === 2 && gameStarted) {
    pistolState.aimTimer = 1.6;
  }
});

window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
});

window.addEventListener('mouseup', () => {
  isMouseDown = false;
});

// Mouse Look - Standard FPS/TPS conventions (works smoothly when moving AND when stationary!)
window.addEventListener('mousemove', (e) => {
  if (!gameStarted) return;

  let moveX = 0;
  let moveY = 0;

  if (document.pointerLockElement === document.body) {
    moveX = e.movementX || 0;
    moveY = e.movementY || 0;
  } else if (isMouseDown || isFirstPerson) {
    if (e.movementX !== undefined && (Math.abs(e.movementX) > 0 || Math.abs(e.movementY) > 0)) {
      moveX = e.movementX;
      moveY = e.movementY;
    } else {
      moveX = e.clientX - lastMouseX;
      moveY = e.clientY - lastMouseY;
    }
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  } else {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    return;
  }

  // Filter out any coordinate jumps when re-locking pointer
  if (Math.abs(moveX) > 250 || Math.abs(moveY) > 250) return;

  const sensitivity = 0.0024;
  const yawDelta = (invertX ? -moveX : moveX) * sensitivity;
  cameraYaw += yawDelta;

  const pitchDelta = (invertY ? moveY : -moveY) * sensitivity;
  cameraPitch += pitchDelta;

  if (isFirstPerson) {
    cameraPitch = Math.max(-1.45, Math.min(1.45, cameraPitch));
  } else {
    cameraPitch = Math.max(-0.65, Math.min(0.70, cameraPitch));
  }
});

// --- SMARTPHONE / TOUCH CONTROLS LOGIC ---
let touchInputFwd = 0;
let touchInputRight = 0;
let touchSprinting = false;

// 1. Virtual Joystick (Move)
const joystickZone = document.getElementById('touch-joystick-zone');
const joystickKnob = document.getElementById('joystick-knob');
let joystickTouchId = null;
let joystickCenter = { x: 0, y: 0 };
const maxJoystickRadius = 45;

if (joystickZone && joystickKnob) {
  joystickZone.addEventListener('touchstart', (e) => {
    if (!gameStarted) return;
    e.preventDefault();
    if (joystickTouchId !== null) return;
    const touch = e.changedTouches[0];
    joystickTouchId = touch.identifier;
    const rect = joystickZone.getBoundingClientRect();
    joystickCenter = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
    updateJoystick(touch.clientX, touch.clientY);
  }, { passive: false });

  function updateJoystick(clientX, clientY) {
    let dx = clientX - joystickCenter.x;
    let dy = clientY - joystickCenter.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > maxJoystickRadius) {
      dx = (dx / dist) * maxJoystickRadius;
      dy = (dy / dist) * maxJoystickRadius;
    }
    joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;

    const normX = dx / maxJoystickRadius;
    const normY = dy / maxJoystickRadius;

    // Screen Up (-dy) moves Forward (+1), Screen Down (+dy) moves Backward (-1)
    touchInputFwd = -normY;
    // Inverted right/left mapping to match A/D inversion
    touchInputRight = -normX;
  }

  window.addEventListener('touchmove', (e) => {
    if (joystickTouchId === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === joystickTouchId) {
        updateJoystick(touch.clientX, touch.clientY);
        break;
      }
    }
  }, { passive: true });

  const resetJoystick = (e) => {
    if (joystickTouchId === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === joystickTouchId) {
        joystickTouchId = null;
        joystickKnob.style.transform = 'translate(0px, 0px)';
        touchInputFwd = 0;
        touchInputRight = 0;
        break;
      }
    }
  };

  window.addEventListener('touchend', resetJoystick, { passive: true });
  window.addEventListener('touchcancel', resetJoystick, { passive: true });
}

// 2. Touch Camera Look Zone (Right screen drag)
const touchLookZone = document.getElementById('touch-look-zone');
let lookTouchId = null;
let lastLookX = 0;
let lastLookY = 0;

if (touchLookZone) {
  touchLookZone.addEventListener('touchstart', (e) => {
    if (!gameStarted) return;
    e.preventDefault();
    if (lookTouchId !== null) return;
    const touch = e.changedTouches[0];
    lookTouchId = touch.identifier;
    lastLookX = touch.clientX;
    lastLookY = touch.clientY;
  }, { passive: false });

  window.addEventListener('touchmove', (e) => {
    if (lookTouchId === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === lookTouchId) {
        const deltaX = touch.clientX - lastLookX;
        const deltaY = touch.clientY - lastLookY;
        lastLookX = touch.clientX;
        lastLookY = touch.clientY;

        const touchSensitivity = 0.0045;
        const yawDelta = (invertX ? -deltaX : deltaX) * touchSensitivity;
        cameraYaw += yawDelta;

        const pitchDelta = (invertY ? deltaY : -deltaY) * touchSensitivity;
        cameraPitch += pitchDelta;

        if (isFirstPerson) {
          cameraPitch = Math.max(-1.45, Math.min(1.45, cameraPitch));
        } else {
          cameraPitch = Math.max(-0.65, Math.min(0.70, cameraPitch));
        }
        break;
      }
    }
  }, { passive: true });

  const resetLook = (e) => {
    if (lookTouchId === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === lookTouchId) {
        lookTouchId = null;
        break;
      }
    }
  };

  window.addEventListener('touchend', resetLook, { passive: true });
  window.addEventListener('touchcancel', resetLook, { passive: true });
}

// 3. Touch Buttons (Shoot, Punch, Jump & Sprint)
const touchBtnShoot = document.getElementById('touch-btn-shoot');
if (touchBtnShoot) {
  touchBtnShoot.addEventListener('touchstart', (e) => {
    if (!gameStarted) return;
    e.preventDefault();
    e.stopPropagation();
    shootGun();
  }, { passive: false });
}

const touchBtnPunch = document.getElementById('touch-btn-punch');
if (touchBtnPunch) {
  touchBtnPunch.addEventListener('touchstart', (e) => {
    if (!gameStarted) return;
    e.preventDefault();
    e.stopPropagation();
    punchAttack();
  }, { passive: false });
}

const touchBtnJump = document.getElementById('touch-btn-jump');
if (touchBtnJump) {
  touchBtnJump.addEventListener('touchstart', (e) => {
    if (!gameStarted) return;
    e.preventDefault();
    e.stopPropagation();
    if (player.isGrounded) {
      player.velocity.y = player.jumpStrength;
      player.isGrounded = false;
      playBeep(420, 0.12, 'triangle');
    }
  }, { passive: false });
}

const touchBtnSprint = document.getElementById('touch-btn-sprint');
if (touchBtnSprint) {
  touchBtnSprint.addEventListener('touchstart', (e) => {
    if (!gameStarted) return;
    e.preventDefault();
    e.stopPropagation();
    touchSprinting = !touchSprinting;
    touchBtnSprint.classList.toggle('active', touchSprinting);
    playBeep(touchSprinting ? 580 : 360, 0.08);
  }, { passive: false });
}

// --- Game Logic & Physics Loop ---
const clock = new THREE.Clock();
const gravity = -24.0;

function updatePlayer(dt) {
  // Update Attack Timers
  if (player.attackCooldown > 0) {
    player.attackCooldown -= dt;
  }
  if (player.isAttacking) {
    player.attackTimer -= dt;
    if (player.attackTimer <= 0) {
      player.isAttacking = false;
    }
  }

  // 1. Calculate camera-relative forward and right vectors on XZ plane
  // When cameraYaw = 0: looking along +Z.
  const fwdX = Math.sin(cameraYaw);
  const fwdZ = Math.cos(cameraYaw);
  const rightX = Math.cos(cameraYaw);
  const rightZ = -Math.sin(cameraYaw);

  // 2. Read directional inputs (Keyboard + Touch Joystick)
  let inputFwd = touchInputFwd;
  let inputRight = touchInputRight;

  if (keys['KeyW'] || keys['ArrowUp']) inputFwd += 1;
  if (keys['KeyS'] || keys['ArrowDown']) inputFwd -= 1;
  if (keys['KeyA'] || keys['ArrowLeft']) inputRight += 1;
  if (keys['KeyD'] || keys['ArrowRight']) inputRight -= 1;

  const isMoving = Math.abs(inputFwd) > 0.05 || Math.abs(inputRight) > 0.05;
  const isSprinting = !!keys['ShiftLeft'] || !!keys['ShiftRight'] || touchSprinting;
  const currentSpeed = player.moveSpeed * (isSprinting ? player.sprintMultiplier : 1.0) * (player.isGrabbed ? 0.65 : 1.0);

  if (isMoving) {
    // Combine into normalized move vector
    let moveDirX = fwdX * inputFwd + rightX * inputRight;
    let moveDirZ = fwdZ * inputFwd + rightZ * inputRight;
    const len = Math.sqrt(moveDirX * moveDirX + moveDirZ * moveDirZ);
    if (len > 0.0001) {
      moveDirX /= len;
      moveDirZ /= len;
    }

    player.velocity.x = moveDirX * currentSpeed;
    player.velocity.z = moveDirZ * currentSpeed;

    // In 3rd person: character faces movement direction (or camera yaw when aiming/shooting)
    // In 1st person: character faces camera direction
    const targetAngle = (isFirstPerson || pistolState.aimTimer > 0) ? cameraYaw : Math.atan2(moveDirX, moveDirZ);
    
    // Shortest angular interpolation
    let diff = targetAngle - player.facingAngle;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    player.facingAngle += diff * 16 * dt;
  } else {
    // Decelerate smoothly
    player.velocity.x *= Math.pow(0.001, dt);
    player.velocity.z *= Math.pow(0.001, dt);
    if (isFirstPerson || pistolState.aimTimer > 0) {
      let diff = cameraYaw - player.facingAngle;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      player.facingAngle += diff * 18 * dt;
    }
  }

  // Jump
  if (keys['Space'] && player.isGrounded) {
    player.velocity.y = player.jumpStrength;
    player.isGrounded = false;
    playBeep(420, 0.12, 'triangle');
  }

  // Gravity (when airborne)
  if (!player.isGrounded) {
    player.velocity.y += gravity * dt;
  }

  // Integrate horizontal position
  let nextX = player.position.x + player.velocity.x * dt;
  let nextZ = player.position.z + player.velocity.z * dt;

  // Stay within terrain map boundaries
  const maxBound = halfSize - 3;
  nextX = Math.max(-maxBound, Math.min(maxBound, nextX));
  nextZ = Math.max(-maxBound, Math.min(maxBound, nextZ));

  // Obstacle collision (trees and rocks)
  for (let i = 0; i < obstacles.length; i++) {
    const obs = obstacles[i];
    const dx = nextX - obs.x;
    const dz = nextZ - obs.z;
    const distSq = dx * dx + dz * dz;
    const minDist = obs.radius + 0.35;
    if (distSq < minDist * minDist && distSq > 0.0001) {
      const dist = Math.sqrt(distSq);
      const push = (minDist - dist) / dist;
      nextX += dx * push;
      nextZ += dz * push;
    }
  }

  player.position.x = nextX;
  player.position.z = nextZ;

  // Exact terrain surface height at current XZ
  const groundY = getTerrainHeight(player.position.x, player.position.z);

  if (player.isGrounded) {
    // While grounded, stick firmly to exact ground triangle (no walking in air or sinking into slopes)
    player.position.y = groundY;
    player.velocity.y = 0;
  } else {
    // While airborne (jumping or falling)
    player.position.y += player.velocity.y * dt;
    if (player.position.y <= groundY) {
      player.position.y = groundY;
      player.velocity.y = 0;
      player.isGrounded = true;
    }
  }

  // Update Three.js object group
  player.group.position.copy(player.position);
  player.group.rotation.y = player.facingAngle;

  // -------------------------------------------------------------------------
  // --- REAL SKELETAL 2-BONE INVERSE KINEMATICS (IK) & GAIT ENGINE ---
  // -------------------------------------------------------------------------
  const bones = player.bones;
  const rest = player.restRotations;
  const restPos = player.restPositions;

  // Safe helpers to retrieve bones and rest transforms with/without sanitization
  const getB = (name) => bones[name] || bones[name.replace(/\./g, '')];
  const getR = (name) => rest[name] || rest[name.replace(/\./g, '')];
  const getP = (name) => restPos[name] || restPos[name.replace(/\./g, '')];

  const thighR = getB('thighR');
  const thighL = getB('thighL');
  const shinR = getB('shinR');
  const shinL = getB('shinL');
  const footR = getB('footR');
  const footL = getB('footL');
  const armR = getB('upper_armR');
  const armL = getB('upper_armL');
  const foreR = getB('forearmR');
  const foreL = getB('forearmL');
  const handR = getB('handR') || getB('Hand_R');
  const chest = getB('chest');
  const hips = getB('hips');
  const head = getB('head');

  if (thighR && getR('thighR')) {
    if (!player.isGrounded) {
      // --- JUMP / AIRBORNE ATHLETIC POSE ---
      const jumpLerp = Math.min(1.0, 14.0 * dt);
      thighR.rotation.x += (getR('thighR').x - 0.38 - thighR.rotation.x) * jumpLerp;
      thighL.rotation.x += (getR('thighL').x - 0.28 - thighL.rotation.x) * jumpLerp;
      if (shinR) shinR.rotation.x += (getR('shinR').x + 0.65 - shinR.rotation.x) * jumpLerp;
      if (shinL) shinL.rotation.x += (getR('shinL').x + 0.52 - shinL.rotation.x) * jumpLerp;
      if (footR) footR.rotation.x += (getR('footR').x - 0.32 - footR.rotation.x) * jumpLerp;
      if (footL) footL.rotation.x += (getR('footL').x - 0.32 - footL.rotation.x) * jumpLerp;

      // Arms flare outward for aerial balance (or aim forward if shooting)
      if (armR) {
        if (pistolState.aimTimer > 0) {
          armR.rotation.y += (getR('upper_armR').y + 1.20 + cameraPitch * 0.65 - armR.rotation.y) * jumpLerp;
          armR.rotation.x += (getR('upper_armR').x - armR.rotation.x) * jumpLerp;
          armR.rotation.z += ((getR('upper_armR').z || 0) - (pistolState.recoilKick || 0) * 0.15 - armR.rotation.z) * jumpLerp;
          if (handR) handR.rotation.x += (getR('handR').x + 1.20 + cameraPitch * 0.40 - (pistolState.recoilKick || 0) * 0.35 - handR.rotation.x) * jumpLerp;
        } else {
          armR.rotation.y += (getR('upper_armR').y + 0.40 - armR.rotation.y) * jumpLerp;
          armR.rotation.x += (getR('upper_armR').x + 0.20 - armR.rotation.x) * jumpLerp;
          if (handR) handR.rotation.x += (getR('handR').x + 0.20 - handR.rotation.x) * jumpLerp;
        }
      }
      if (armL) {
        armL.rotation.y += (getR('upper_armL').y - 0.35 - armL.rotation.y) * jumpLerp;
        armL.rotation.x += (getR('upper_armL').x - 0.30 - armL.rotation.x) * jumpLerp;
      }
      if (chest && getR('chest')) chest.rotation.x += (getR('chest').x - 0.12 - chest.rotation.x) * jumpLerp;

    } else if (isMoving) {
      // --- NATURAL INVERSE KINEMATICS (IK) GAIT CYCLE ---
      const cycleSpeed = isSprinting ? 2.8 : 2.1;
      player.walkCycle += dt * currentSpeed * cycleSpeed;
      const cycle = player.walkCycle;

      // 1. Pelvis Dynamics: Vertical bounce, lateral sway, yaw twist
      const hipBob = (isSprinting ? 0.042 : 0.024) * Math.cos(cycle * 2) - (isSprinting ? 0.038 : 0.020);
      const currentHipY = (getP('hips')?.y || REST_HIP_Y) + hipBob;
      if (hips) {
        hips.position.y = currentHipY;
        hips.position.x = (getP('hips')?.x || 0) + Math.sin(cycle) * (isSprinting ? 0.022 : 0.014);
        hips.rotation.z = (getR('hips')?.z || 0) + Math.sin(cycle) * (isSprinting ? 0.055 : 0.035);
        hips.rotation.y = (getR('hips')?.y || 0) + Math.sin(cycle) * (isSprinting ? 0.08 : 0.05);
      }

      // 2. Stride and Step Parameters
      const strideZ = isSprinting ? 0.24 : 0.165;
      const stepLift = isSprinting ? 0.135 : 0.085;
      const stanceRatio = 0.58; // 58% stance, 42% swing (realistic biped gait)

      // Facing orientation vectors for terrain height probing
      const sinF = Math.sin(player.facingAngle);
      const cosF = Math.cos(player.facingAngle);

      // Helper function to solve leg targets and IK for a given leg
      function computeLegKinematics(phase, isRight, thighName, shinName, footName) {
        const tau = ((phase % (Math.PI * 2)) + (Math.PI * 2)) % (Math.PI * 2) / (Math.PI * 2);
        let targetZ, targetY, anklePitch;

        const legLocalX = isRight ? 0.14 : -0.14;

        if (tau < stanceRatio) {
          // --- STANCE PHASE (Foot planted, moving backward relative to body) ---
          const u = tau / stanceRatio;
          targetZ = strideZ * (1.0 - 2.0 * u);

          // Ankle articulation: Heel-strike -> Flat plant -> Toe push-off roll
          if (u < 0.15) {
            anklePitch = -0.26 * (1.0 - u / 0.15); // Heel strike (dorsiflexion)
          } else if (u < 0.70) {
            anklePitch = 0.0; // Flat foot on ground
          } else {
            const push = (u - 0.70) / 0.30;
            anklePitch = 0.36 * push; // Heel lifts, pushing with ball of foot
          }

          // Sample terrain slope at the foot's world position
          const wX = player.position.x + sinF * targetZ + cosF * legLocalX;
          const wZ = player.position.z + cosF * targetZ - sinF * legLocalX;
          const slopeDelta = Math.max(-0.35, Math.min(0.35, getTerrainHeight(wX, wZ) - groundY));
          targetY = REST_ANKLE_Y + slopeDelta;

        } else {
          // --- SWING PHASE (Foot lifts, arcs forward, prepares for touchdown) ---
          const s = (tau - stanceRatio) / (1.0 - stanceRatio);
          // Smooth forward travel
          targetZ = -strideZ + 2.0 * strideZ * (0.5 - 0.5 * Math.cos(Math.PI * s));

          // Parabolic clearance lift
          const swingArc = stepLift * Math.sin(Math.PI * s);

          // Ankle clearance articulation
          if (s < 0.22) {
            anklePitch = 0.36 * (1.0 - s / 0.22); // Liftoff point
          } else if (s < 0.75) {
            anklePitch = -0.06; // Ground clearance
          } else {
            const prep = (s - 0.75) / 0.25;
            anklePitch = -0.06 - 0.20 * prep; // Prepare for heel strike
          }

          const wX = player.position.x + sinF * targetZ + cosF * legLocalX;
          const wZ = player.position.z + cosF * targetZ - sinF * legLocalX;
          const slopeDelta = Math.max(-0.35, Math.min(0.35, getTerrainHeight(wX, wZ) - groundY));
          targetY = REST_ANKLE_Y + slopeDelta * (1.0 - Math.sin(Math.PI * s)) + swingArc;
        }

        // Solve 2-Bone IK
        const ik = solveLegIK(currentHipY, 0.0, targetY, targetZ, getR(thighName).x, getR(shinName).x);
        return { ik, anklePitch };
      }

      // Compute IK for Right Leg (phase = cycle) and Left Leg (phase = cycle + PI)
      const resR = computeLegKinematics(cycle, true, 'thighR', 'shinR', 'footR');
      const resL = computeLegKinematics(cycle + Math.PI, false, 'thighL', 'shinL', 'footL');

      thighR.rotation.x = resR.ik.thighX;
      shinR.rotation.x = resR.ik.shinX;
      if (footR) footR.rotation.x = getR('footR').x + resR.anklePitch;

      thighL.rotation.x = resL.ik.thighX;
      shinL.rotation.x = resL.ik.shinX;
      if (footL) footL.rotation.x = getR('footL').x + resL.anklePitch;

      // Punch attack animation helper
      const applyPunchAnimation = () => {
        const progress = 1.0 - Math.max(0, player.attackTimer / player.attackDuration);
        const strike = progress < 0.35 
          ? (progress / 0.35) 
          : Math.pow(1.0 - (progress - 0.35) / 0.65, 2.0);

        const isRight = player.attackSide === 0;

        if (isRight) {
          if (armR) {
            armR.rotation.y = getR('upper_armR').y - 1.48 * strike;
            armR.rotation.x = getR('upper_armR').x + 0.28 * strike;
            armR.rotation.z = (getR('upper_armR').z || 0) + 0.15 * strike;
          }
          if (foreR) {
            foreR.rotation.x = getR('forearmR').x - 0.55 * strike;
          }
          if (armL) {
            armL.rotation.y = getR('upper_armL').y - 0.65;
            armL.rotation.x = getR('upper_armL').x - 0.22;
          }
          if (foreL) {
            foreL.rotation.x = getR('forearmL').x - 0.85;
          }
          if (chest && getR('chest')) {
            chest.rotation.y = (getR('chest').y || 0) - 0.32 * strike;
            chest.rotation.x = (getR('chest').x || 0) - 0.14 * strike;
          }
        } else {
          if (armL) {
            armL.rotation.y = getR('upper_armL').y - 1.48 * strike;
            armL.rotation.x = getR('upper_armL').x - 0.28 * strike;
            armL.rotation.z = (getR('upper_armL').z || 0) - 0.15 * strike;
          }
          if (foreL) {
            foreL.rotation.x = getR('forearmL').x - 0.55 * strike;
          }
          if (armR) {
            armR.rotation.y = getR('upper_armR').y - 0.65;
            armR.rotation.x = getR('upper_armR').x + 0.22;
          }
          if (foreR) {
            foreR.rotation.x = getR('forearmR').x - 0.85;
          }
          if (chest && getR('chest')) {
            chest.rotation.y = (getR('chest').y || 0) + 0.32 * strike;
            chest.rotation.x = (getR('chest').x || 0) - 0.14 * strike;
          }
        }
      };

      // 3. Upper Body Natural Balance & Combat Strikes
      if (player.isAttacking) {
        applyPunchAnimation();
      } else {
        const armSwing = Math.sin(cycle);
        const armAmpY = isSprinting ? 0.68 : 0.44;
        const armAmpX = isSprinting ? 0.32 : 0.18;

        // Right arm holding / aiming pistol forward in front of head (walk/sprint)
        if (pistolState.aimTimer > 0) {
          if (armR) {
            armR.rotation.y = getR('upper_armR').y + 1.20 + cameraPitch * 0.65;
            armR.rotation.x = getR('upper_armR').x;
            armR.rotation.z = (getR('upper_armR').z || 0) - (pistolState.recoilKick || 0) * 0.15;
          }
          if (foreR) {
            foreR.rotation.x = getR('forearmR').x;
          }
          if (handR) {
            handR.rotation.x = getR('handR').x + 1.20 + cameraPitch * 0.40 - (pistolState.recoilKick || 0) * 0.35;
          }
        } else {
          if (armR) {
            armR.rotation.y = getR('upper_armR').y + 0.40;
            armR.rotation.x = getR('upper_armR').x + Math.sin(cycle) * 0.08;
          }
          if (foreR) {
            foreR.rotation.x = getR('forearmR').x + 0.20;
          }
          if (handR) {
            handR.rotation.x = getR('handR').x + 0.20;
          }
        }

        // Left arm natural balance swing
        if (armL) {
          armL.rotation.y = getR('upper_armL').y - armSwing * armAmpY;
          armL.rotation.x = getR('upper_armL').x - armSwing * armAmpX;
        }

        // Forearms (elbows) dynamic flexion on forward swing
        if (foreL) foreL.rotation.x = getR('forearmL').x - Math.max(0, armSwing) * (isSprinting ? 0.48 : 0.30);

        // Spine & Chest counter-rotation and forward tilt
        if (chest && getR('chest')) {
          chest.rotation.y = (getR('chest').y || 0) - Math.sin(cycle) * (isSprinting ? 0.075 : 0.045);
          chest.rotation.x = (getR('chest').x || 0) - (isSprinting ? 0.16 : 0.055);
          chest.rotation.z = (getR('chest').z || 0) - Math.sin(cycle) * 0.02;
        }
      }

    } else {
      // --- IDLE POSE & GENTLE ORGANIC BREATHING ---
      const lerpFactor = Math.min(1.0, 10.0 * dt);

      if (player.isAttacking) {
        applyPunchAnimation();
        const legBones = ['thighR', 'thighL', 'shinR', 'shinL', 'footR', 'footL'];
        legBones.forEach(name => {
          const b = getB(name);
          const r = getR(name);
          if (b && r) {
            b.rotation.x += (r.x - b.rotation.x) * lerpFactor;
            b.rotation.y += (r.y - b.rotation.y) * lerpFactor;
            b.rotation.z += (r.z - b.rotation.z) * lerpFactor;
          }
        });
      } else {
        const boneList = ['thighR', 'thighL', 'shinR', 'shinL', 'footR', 'footL', 'upper_armL', 'forearmL'];
        boneList.forEach(name => {
          const b = getB(name);
          const r = getR(name);
          if (b && r) {
            b.rotation.x += (r.x - b.rotation.x) * lerpFactor;
            b.rotation.y += (r.y - b.rotation.y) * lerpFactor;
            b.rotation.z += (r.z - b.rotation.z) * lerpFactor;
          }
        });

        // Right arm holding / aiming pistol forward in front of head (idle)
        if (pistolState.aimTimer > 0) {
          if (armR) {
            armR.rotation.y = getR('upper_armR').y + 1.20 + cameraPitch * 0.65;
            armR.rotation.x = getR('upper_armR').x;
            armR.rotation.z = (getR('upper_armR').z || 0) - (pistolState.recoilKick || 0) * 0.15;
          }
          if (foreR) {
            foreR.rotation.x = getR('forearmR').x;
          }
          if (handR) {
            handR.rotation.x = getR('handR').x + 1.20 + cameraPitch * 0.40 - (pistolState.recoilKick || 0) * 0.35;
          }
        } else {
          if (armR) {
            armR.rotation.y = getR('upper_armR').y + 0.40;
            armR.rotation.x = getR('upper_armR').x;
          }
          if (foreR) {
            foreR.rotation.x = getR('forearmR').x + 0.20;
          }
          if (handR) {
            handR.rotation.x = getR('handR').x + 0.20;
          }
        }
      }

      const t = clock.getElapsedTime();
      if (!player.isAttacking && chest && getR('chest')) {
        chest.rotation.x = getR('chest').x + Math.sin(t * 2.4) * 0.025;
        chest.rotation.y += ((getR('chest').y || 0) - chest.rotation.y) * lerpFactor;
        chest.rotation.z += ((getR('chest').z || 0) - chest.rotation.z) * lerpFactor;
      }
      if (hips && getP('hips')) {
        hips.position.y += (getP('hips').y + Math.sin(t * 2.4) * 0.012 - hips.position.y) * lerpFactor;
        hips.position.x += ((getP('hips').x || 0) - hips.position.x) * lerpFactor;
        hips.rotation.y += ((getR('hips')?.y || 0) - hips.rotation.y) * lerpFactor;
        hips.rotation.z += ((getR('hips')?.z || 0) - hips.rotation.z) * lerpFactor;
      }
      if (head && getR('head')) {
        head.rotation.x = (getR('head').x || 0) + Math.sin(t * 1.8) * 0.015;
      }
    }
  }
}

function updateCamera() {
  const headTarget = new THREE.Vector3(
    player.position.x,
    player.position.y + camHeightOffset,
    player.position.z
  );

  if (isFirstPerson) {
    // 1st Person: Camera directly at eye level looking in lookDir
    camera.position.set(headTarget.x, headTarget.y + 0.28, headTarget.z);

    const lookDir = new THREE.Vector3(
      Math.sin(cameraYaw) * Math.cos(cameraPitch),
      Math.sin(cameraPitch),
      Math.cos(cameraYaw) * Math.cos(cameraPitch)
    );
    camera.lookAt(camera.position.clone().add(lookDir));
  } else {
    // 3rd Person:
    // Natural non-inverted orientation:
    // When looking UP (cameraPitch > 0): camera lowers and tilts up toward sky.
    // When looking DOWN (cameraPitch < 0): camera raises and tilts down toward player/ground.
    const cosPitch = Math.cos(cameraPitch);
    const sinPitch = Math.sin(cameraPitch);

    const offsetX = Math.sin(cameraYaw) * cosPitch * camDistance;
    const offsetY = -sinPitch * camDistance + 0.6;
    const offsetZ = Math.cos(cameraYaw) * cosPitch * camDistance;

    const desiredCamPos = new THREE.Vector3(
      headTarget.x - offsetX,
      headTarget.y + offsetY,
      headTarget.z - offsetZ
    );

    // Prevent camera from clipping through terrain
    const groundUnderCam = getTerrainHeight(desiredCamPos.x, desiredCamPos.z) + 0.45;
    if (desiredCamPos.y < groundUnderCam) {
      desiredCamPos.y = groundUnderCam;
    }

    camera.position.copy(desiredCamPos);

    // Adjust look target with pitch for natural framing
    const lookTarget = new THREE.Vector3(
      headTarget.x,
      headTarget.y + sinPitch * 1.1,
      headTarget.z
    );
    camera.lookAt(lookTarget);
  }
}

function updateGems(dt) {
  const gemCountElem = document.getElementById('gems-count');
  const time = clock.getElapsedTime();

  gems.forEach((gem) => {
    if (gem.userData.collected) return;

    gem.rotation.y += 2.0 * dt;
    gem.position.y = gem.userData.baseY + Math.sin(time * 3 + gem.userData.offset) * 0.22;

    const dist = player.position.distanceTo(gem.position);
    if (dist < 1.7) {
      gem.userData.collected = true;
      scene.remove(gem);
      gemsCollected++;
      gemCountElem.innerText = gemsCollected;
      playBeep(880, 0.18, 'sine');
    }
  });
}

// --- Main Render Loop ---
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  updatePlayer(dt);
  updateWeapons(dt);
  updateZombies(dt);
  updatePlayerHealthUI(dt);
  updateParticles(dt);
  updateCamera();
  updateGems(dt);

  renderer.render(scene, camera);
}
animate();

// --- Responsive Resize ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});