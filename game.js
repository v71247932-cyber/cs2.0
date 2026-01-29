import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// --- Global Variables ---
let camera, scene, renderer, controls, weapon;
let currentWeaponType = 'pistol'; // pistol, ak47, knife

// --- Multiplayer / Networking ---
let peer;
let allConns = []; // Host: all connected clients. Client: only the host connection.
let myId;
let myTeamId = 0; // 0 = Team 1 (Teammate labeling), 1 = Team 2
let isHost = false;
let remotePlayers = {}; // Map of meshes keyed by Peer ID
let playerTeams = {};   // Map of team IDs keyed by Peer ID
let networkReady = false;
let syncTimer = 0;
const SYNC_RATE = 1000 / 30; // 30 updates per second
let isFiring = false;
let lastShotTime = 0;
let fireRate = 0; // ms between shots
let inspectTimer = 0;
const INSPECT_DURATION = 2.5; // seconds
let recoilCounter = 0; // Counts bullets for spray pattern
const objects = []; // For collision (optional/simple)
const objectBoxes = []; // Precomputed Bounding Boxes for optimization
const enemies = [];
const bullets = [];
const enemyBullets = [];
const impacts = [];
let raycaster;

let moveForward = false;
let moveBackward = false;
let moveLeft = false;
let moveRight = false;
let canJump = false;
let isCrouching = false;
const PLAYER_STAND_HEIGHT = 9.7;
const PLAYER_CROUCH_HEIGHT = 6.0;
const PLAYER_EYE_OFFSET = 4.2; // Offset from character center to eyes
const PLAYER_RADIUS = 2.5;

let prevTime = performance.now();
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();

// Game State
let health = 100;
let score = 0; // Kills? Or rounds?
let isGameOver = false;

// Round System
let playerWins = 0;
let enemyWins = 0;
let opponentWins = 0;
let roundActive = false;
const MAX_WINS = 10;
const enemiesPerRound = 5;

// AI Logic
const enemyFireRate = 600; // ms (Faster fire rate)
const aiVisionRange = 500;
const enemySpeed = 25; // Faster movement

// Weapon Configs (Ammo)
const weaponConfigs = {
    'ak47': { magSize: 30, reserve: 120, name: 'AK-47', fireRate: 100 },
    'pistol': { magSize: 12, reserve: 36, name: 'USP-S', fireRate: 200 },
    'knife': { magSize: Infinity, reserve: Infinity, name: 'Knife', fireRate: 500 }
};

let weaponAmmo = {
    'ak47': { mag: 30, reserve: 120 },
    'pistol': { mag: 12, reserve: 36 },
    'knife': { mag: Infinity, reserve: Infinity }
};

let isReloading = false;

// DOM Elements
const instructionScreen = document.getElementById('instructions');
const hud = document.getElementById('hud');
const gameOverScreen = document.getElementById('game-over');
const healthDisplay = document.getElementById('health');
const scoreDisplay = document.getElementById('score');
const winScreen = document.getElementById('win-screen');
const deathScreen = document.getElementById('death-screen');
const finalScoreDisplay = document.getElementById('final-score');

// Lobby Elements
const lobbyUI = document.getElementById('lobby-ui');
const navPlay = document.getElementById('nav-play');
const modeModal = document.getElementById('mode-selection-modal');
const closeModes = document.getElementById('close-modes');
const modeButtons = document.querySelectorAll('.mode-card');

// Matchmaking Elements
const matchmakingModal = document.getElementById('matchmaking-modal');
const matchmakingStatus = document.getElementById('matchmaking-status');
const foundCountDisplay = document.getElementById('found-count');
const requiredCountDisplay = document.getElementById('required-count');
const modeDisplay = document.getElementById('current-mode-display');
const cancelMatchmakingBtn = document.getElementById('cancel-matchmaking');

let requiredPlayers = 1;
let currentPlayers = 1;
let currentMode = '1vBot';


const ammoDisplay = document.createElement('div');
ammoDisplay.id = 'ammo';
ammoDisplay.style.position = 'absolute';
ammoDisplay.style.bottom = '20px';
ammoDisplay.style.right = '20px';
ammoDisplay.style.color = '#fff';
ammoDisplay.style.fontSize = '32px';
ammoDisplay.style.fontFamily = 'monospace';
ammoDisplay.style.textShadow = '2px 2px 4px #000';
hud.appendChild(ammoDisplay);

function init() {
    // 1. Setup Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB); // Sky Blue
    scene.fog = new THREE.Fog(0x87CEEB, 10, 1000);

    // 2. Setup Camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 1, 1000);
    camera.position.y = 10;

    // 3. Setup Lights
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.6); // Soft white overall
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8); // Sunlight
    dirLight.position.set(100, 200, 100);
    dirLight.castShadow = true;
    scene.add(dirLight);

    // 4. Setup Controls
    controls = new PointerLockControls(camera, document.body);

    // --- Weapon System ---
    switchWeapon('ak47'); // Start with AK-47 as requested

    // --- Networking Init ---
    // initMultiplayer(); // Called when mode is selected







    // --- UI & Controls Listeners ---
    instructionScreen.addEventListener('click', () => controls.lock());

    controls.addEventListener('lock', () => {
        lobbyUI.style.display = 'none';
        matchmakingModal.classList.remove('active');
        instructionScreen.style.display = 'none';
        hud.style.display = 'block';
    });

    controls.addEventListener('unlock', () => {
        if (!isGameOver) {
            if (roundActive) {
                instructionScreen.style.display = 'flex';
            } else {
                lobbyUI.style.display = 'flex';
            }
            hud.style.display = 'none';
        }
    });

    navPlay.addEventListener('click', () => modeModal.classList.add('active'));
    closeModes.addEventListener('click', () => modeModal.classList.remove('active'));

    modeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.mode;
            startMatchmaking(mode);
        });
    });

    cancelMatchmakingBtn.addEventListener('click', () => {
        if (peer) peer.destroy();
        matchmakingModal.classList.remove('active');
        modeModal.classList.add('active');
    });

    scene.add(controls.getObject());

    // 5. Input Listeners
    const onKeyDown = function (event) {
        switch (event.code) {
            case 'ArrowUp':
            case 'KeyW':
                moveForward = true;
                break;
            case 'ArrowLeft':
            case 'KeyA':
                moveLeft = true;
                break;
            case 'ArrowDown':
            case 'KeyS':
                moveBackward = true;
                break;
            case 'ArrowRight':
            case 'KeyD':
                moveRight = true;
                break;
            case 'Space':
                if (canJump === true) velocity.y += 200;
                canJump = false;
                break;
            case 'Digit1':
                switchWeapon('ak47');
                break;
            case 'Digit2':
                switchWeapon('pistol');
                break;
            case 'Digit3':
                switchWeapon('knife');
                break;
            case 'KeyF':
                if (!isFiring) {
                    inspectTimer = INSPECT_DURATION;
                }
                break;
            case 'KeyR':
                reload();
                break;
            case 'ShiftLeft':
            case 'ShiftRight':
            case 'ControlLeft':
            case 'ControlRight':
            case 'ShiftLeft':
            case 'ShiftRight':
            case 'ControlLeft':
            case 'ControlRight':
                isCrouching = true;
                break;
        }
    };

    const onKeyUp = function (event) {
        switch (event.code) {
            case 'ArrowUp':
            case 'KeyW':
                moveForward = false;
                break;
            case 'ArrowLeft':
            case 'KeyA':
                moveLeft = false;
                break;
            case 'ArrowDown':
            case 'KeyS':
                moveBackward = false;
                break;
            case 'ArrowRight':
            case 'KeyD':
                moveRight = false;
                break;
            case 'ShiftLeft':
            case 'ShiftRight':
            case 'ControlLeft':
            case 'ControlRight':
                isCrouching = false;
                break;
        }
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    // Shoot Listener (MouseDown)
    document.addEventListener('mousedown', function (event) {
        if (controls.isLocked) {
            isFiring = true;
            if (currentWeaponType !== 'ak47') {
                shoot(); // Fire once immediately for semi-auto / melee
            }
        }
    });

    document.addEventListener('mouseup', function (event) {
        isFiring = false;
        // Reset weapon kick rotation if held
        if (weapon) {
            // Let animate loop handle lerp
        }
    });

    // 6. World Objects (Mirage Theme)
    raycaster = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0), 0, 10);

    // Floor (Sandstone)
    let floorGeometry = new THREE.PlaneGeometry(4000, 4000, 100, 100);
    floorGeometry.rotateX(-Math.PI / 2);

    let floorMaterial = new THREE.MeshStandardMaterial({
        color: 0xdbc295, // Sandstone light
        roughness: 0.9
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    scene.add(floor);

    // Create Mirage-like Map (A Site Blockout)
    createMirageMap();

    // 7. Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    window.addEventListener('resize', onWindowResize);

    // Start Logic
    // startRound(); // Only called after a game mode is selected
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function switchWeapon(type) {
    inspectTimer = 0; // Cancel inspect if active
    if (weapon) {
        camera.remove(weapon);
    }
    weapon = new THREE.Group();
    camera.add(weapon);
    currentWeaponType = type;

    // Reset offset
    weapon.position.set(1.2, -1.8, -2.0);

    if (type === 'pistol') {
        createPistol(weapon);
        fireRate = weaponConfigs['pistol'].fireRate;
    } else if (type === 'ak47') {
        createAK47(weapon);
        fireRate = weaponConfigs['ak47'].fireRate;
    } else if (type === 'knife') {
        createKnife(weapon);
        fireRate = weaponConfigs['knife'].fireRate;
    }

    // Update UI
    updateAmmoDisplay();

    // EQUIP ANIMATION (Initial State)
    weapon.rotation.x = -Math.PI / 2; // Point down
    weapon.position.y = -3.0; // Start lower

}

function createPistol(group) {
    const silkWhiteMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.2,
        metalness: 0.1
    });

    const matteBlackMat = new THREE.MeshStandardMaterial({
        color: 0x1a1a1a,
        roughness: 0.8
    });

    const gunMetalMat = new THREE.MeshStandardMaterial({
        color: 0x333333,
        roughness: 0.5,
        metalness: 0.5
    });

    // 1. Silencer (Suppressor) - Iconic CS2 USP-S look
    const silencerGeo = new THREE.CylinderGeometry(0.14, 0.14, 1.8, 32);
    silencerGeo.rotateX(-Math.PI / 2);
    const silencer = new THREE.Mesh(silencerGeo, matteBlackMat);
    silencer.position.set(0, 0.2, -1.8);
    group.add(silencer);

    // 2. Slide (Top Body)
    const slideGeo = new THREE.BoxGeometry(0.3, 0.35, 1.5);
    const slide = new THREE.Mesh(slideGeo, silkWhiteMat); // White slide for Printstream style
    slide.position.set(0, 0.22, -0.1);
    group.add(slide);

    // 3. Lower Body (Frame)
    const frameGeo = new THREE.BoxGeometry(0.28, 0.25, 1.2);
    const frame = new THREE.Mesh(frameGeo, matteBlackMat);
    frame.position.set(0, -0.05, -0.1);
    group.add(frame);

    // 4. Handle (Grip)
    const handleGeo = new THREE.BoxGeometry(0.32, 1.1, 0.55);
    const handle = new THREE.Mesh(handleGeo, matteBlackMat);
    handle.position.set(0, -0.65, 0.35);
    handle.rotation.x = 0.22;
    group.add(handle);

    // 5. Suppressor Connector (Threaded part)
    const connGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.2, 16);
    connGeo.rotateX(-Math.PI / 2);
    const connector = new THREE.Mesh(connGeo, gunMetalMat);
    connector.position.set(0, 0.2, -0.85);
    group.add(connector);

    // 6. Hammer & Sights
    const sightGeo = new THREE.BoxGeometry(0.06, 0.08, 0.15);
    const frontSight = new THREE.Mesh(sightGeo, matteBlackMat);
    frontSight.position.set(0, 0.4, -0.75);
    group.add(frontSight);

    const backSight = new THREE.Mesh(sightGeo, matteBlackMat);
    backSight.position.set(0, 0.4, 0.5);
    group.add(backSight);

    const hammerGeo = new THREE.BoxGeometry(0.1, 0.2, 0.1);
    const hammer = new THREE.Mesh(hammerGeo, gunMetalMat);
    hammer.position.set(0, 0.2, 0.65);
    hammer.rotation.x = 0.5;
    group.add(hammer);
}

function createAK47(group) {
    // Materials
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.8 }); // Brown wood
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5, metalness: 0.6 }); // Black metal
    const darkMetalMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.7 });

    // 1. Barrel (Long thin cylinder)
    const barrelGeo = new THREE.CylinderGeometry(0.08, 0.08, 2.5, 16);
    barrelGeo.rotateX(-Math.PI / 2);
    const barrel = new THREE.Mesh(barrelGeo, metalMat);
    barrel.position.set(0, 0.2, -1.8);
    group.add(barrel);

    // 2. Gas Tube (Top of barrel)
    const gasTubeGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.5, 16);
    gasTubeGeo.rotateX(-Math.PI / 2);
    const gasTube = new THREE.Mesh(gasTubeGeo, metalMat);
    gasTube.position.set(0, 0.32, -1.5);
    group.add(gasTube);

    // 3. Handguard (Wood) - Lower part
    const handguardGeo = new THREE.BoxGeometry(0.25, 0.3, 1.2);
    const handguard = new THREE.Mesh(handguardGeo, woodMat);
    handguard.position.set(0, 0.15, -1.2);
    group.add(handguard);

    // 4. Receiver (Main Body) - Metal
    const receiverGeo = new THREE.BoxGeometry(0.3, 0.4, 1.2);
    const receiver = new THREE.Mesh(receiverGeo, darkMetalMat);
    receiver.position.set(0, 0.2, 0.1);
    group.add(receiver);

    // 5. Stock (Wood) - Back part
    const stockGeo = new THREE.BoxGeometry(0.25, 0.5, 1.0);
    const stock = new THREE.Mesh(stockGeo, woodMat);
    stock.position.set(0, 0.0, 1.2);
    stock.rotation.x = 0.1; // Angled down slightly
    group.add(stock);

    // 6. Pistol Grip (Wood/Plastic)
    const gripGeo = new THREE.BoxGeometry(0.25, 0.6, 0.4);
    const grip = new THREE.Mesh(gripGeo, woodMat);
    grip.position.set(0, -0.4, 0.2);
    grip.rotation.x = 0.2;
    group.add(grip);

    // 7. Magazine (Signature Curve)
    const magGeo = new THREE.BoxGeometry(0.28, 1.2, 0.4);
    const mag = new THREE.Mesh(magGeo, metalMat); // Usually metal (orange for bakelite?) lets stick to metal
    mag.position.set(0, -0.6, -0.3);
    mag.rotation.x = 0.4; // Curve forward
    group.add(mag);

    // 8. Sight (Front & Rear)
    const frontSightGeo = new THREE.BoxGeometry(0.05, 0.2, 0.05);
    const frontSight = new THREE.Mesh(frontSightGeo, metalMat);
    frontSight.position.set(0, 0.35, -2.8);
    group.add(frontSight);
}

function createKnife(group) {
    const handleMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5, metalness: 0.4 });
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, metalness: 0.95, roughness: 0.05 });
    const pivotMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.9, roughness: 0.2 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0xff6600, metalness: 0.7, roughness: 0.3 });

    // Create butterfly knife container - positioned to be visible in first person
    const butterflyKnife = new THREE.Group();
    butterflyKnife.position.set(0.3, -0.2, -0.8);
    butterflyKnife.rotation.y = Math.PI / 8;
    butterflyKnife.rotation.x = Math.PI / 12;
    butterflyKnife.rotation.z = -Math.PI / 16;

    // Blade (center) - longer and more visible
    const bladeGeo = new THREE.BoxGeometry(0.04, 0.15, 1.3);
    const blade = new THREE.Mesh(bladeGeo, bladeMat);
    blade.position.set(0, 0, -0.35);
    butterflyKnife.add(blade);

    // Blade tip (pointed)
    const tipGeo = new THREE.ConeGeometry(0.08, 0.25, 4);
    tipGeo.rotateX(Math.PI / 2);
    const tip = new THREE.Mesh(tipGeo, bladeMat);
    tip.position.set(0, 0, -1.1);
    butterflyKnife.add(tip);

    // Pivot points (small cylinders where handles rotate)
    const pivotGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.18, 12);
    pivotGeo.rotateZ(Math.PI / 2);

    const pivotTop = new THREE.Mesh(pivotGeo, pivotMat);
    pivotTop.position.set(0, 0.09, 0.25);
    butterflyKnife.add(pivotTop);

    const pivotBottom = new THREE.Mesh(pivotGeo, pivotMat);
    pivotBottom.position.set(0, -0.09, 0.25);
    butterflyKnife.add(pivotBottom);

    // Handle 1 (top) - rotates around pivot
    const handle1Group = new THREE.Group();
    handle1Group.position.set(0, 0.09, 0.25);

    const handleGeo1 = new THREE.BoxGeometry(0.09, 0.15, 1.2);
    const handle1 = new THREE.Mesh(handleGeo1, handleMat);
    handle1.position.set(0, 0, 0.6);
    handle1Group.add(handle1);

    // Orange accent stripe
    const accent1Geo = new THREE.BoxGeometry(0.095, 0.05, 0.18);
    const accent1 = new THREE.Mesh(accent1Geo, accentMat);
    accent1.position.set(0, 0, 0.9);
    handle1Group.add(accent1);

    butterflyKnife.add(handle1Group);

    // Handle 2 (bottom) - rotates around pivot
    const handle2Group = new THREE.Group();
    handle2Group.position.set(0, -0.09, 0.25);

    const handleGeo2 = new THREE.BoxGeometry(0.09, 0.15, 1.2);
    const handle2 = new THREE.Mesh(handleGeo2, handleMat);
    handle2.position.set(0, 0, 0.6);
    handle2Group.add(handle2);

    // Orange accent stripe
    const accent2Geo = new THREE.BoxGeometry(0.095, 0.05, 0.18);
    const accent2 = new THREE.Mesh(accent2Geo, accentMat);
    accent2.position.set(0, 0, 0.9);
    handle2Group.add(accent2);

    butterflyKnife.add(handle2Group);

    // Store references for animation
    group.userData.butterflyHandles = {
        handle1: handle1Group,
        handle2: handle2Group
    };

    group.add(butterflyKnife);
}



function createMirageMap() {
    // Materials
    const sandstoneMain = new THREE.MeshStandardMaterial({ color: 0xe6c29a, roughness: 0.9, side: THREE.DoubleSide }); // Light beige walls
    const sandstoneDark = new THREE.MeshStandardMaterial({ color: 0xd2b48c, roughness: 0.9, side: THREE.DoubleSide }); // Darker trim
    const woodNew = new THREE.MeshStandardMaterial({ color: 0x8f6a4e, roughness: 0.8, side: THREE.DoubleSide }); // Clean wood (crates)
    const woodOld = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 1.0, side: THREE.DoubleSide }); // Dark scaffolding wood
    const floorTile = new THREE.MeshStandardMaterial({ color: 0xdcbfa6, roughness: 0.8, side: THREE.DoubleSide }); // Floor
    const darkSpace = new THREE.MeshBasicMaterial({ color: 0x111111, side: THREE.DoubleSide }); // For "inside" doorways

    // Helper to add box
    function addBox(x, y, z, w, h, d, mat, rotY = 0, collidable = true) {
        const geo = new THREE.BoxGeometry(w, h, d);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y + h / 2, z);
        mesh.rotation.y = rotY;
        scene.add(mesh);
        if (collidable) {
            objects.push(mesh);
            const box = new THREE.Box3().setFromObject(mesh);
            objectBoxes.push(box);
        }
        return mesh;
    }

    const scale = 4.0; // Increased scale for full map layout

    // Helper: Material aliases for cleaner map code
    const walls = sandstoneMain;
    const trim = sandstoneDark;
    const crates = woodNew;
    const oldWood = woodOld;

    // --- 1. T-SPAWN AREA (Z+ direction) ---
    addBox(0, 0, 450, 100, 40, 50, walls); // Back wall
    addBox(-60, 0, 400, 20, 40, 150, walls); // Left wall
    addBox(60, 0, 400, 20, 40, 150, walls); // Right wall

    // --- 2. T-RAMP & A-ENTRANCE ---
    addBox(50 * scale, 0, 20 * scale, 15 * scale, 25 * scale, 40 * scale, walls); // Ramp Left Wall
    addBox(85 * scale, 0, 20 * scale, 15 * scale, 30 * scale, 40 * scale, walls); // Ramp Right Wall
    addBox(70 * scale, 25 * scale, 20 * scale, 30 * scale, 5 * scale, 40 * scale, walls); // Roof over Ramp

    // --- 3. A-SITE landmark structures ---
    addBox(20 * scale, 0, -30 * scale, 12 * scale, 12 * scale, 12 * scale, crates); // Triple box
    addBox(24 * scale, 12 * scale, -30 * scale, 6 * scale, 6 * scale, 6 * scale, crates); // Top of Triple
    addBox(40 * scale, 0, -40 * scale, 10 * scale, 12 * scale, 10 * scale, crates); // Firebox
    addBox(30 * scale, 0, 0, 15 * scale, 20 * scale, 30 * scale, walls); // Sandwich wall

    // --- 4. PALACE ---
    addBox(80 * scale, 0, -10 * scale, 25 * scale, 40 * scale, 40 * scale, walls); // Palace Main room
    addBox(70 * scale, 15 * scale, -25 * scale, 30 * scale, 2 * scale, 20 * scale, oldWood); // Balcony
    addBox(60 * scale, 0, -25 * scale, 2 * scale, 15 * scale, 2 * scale, trim); // Pillar 1
    addBox(60 * scale, 0, -15 * scale, 2 * scale, 15 * scale, 2 * scale, trim); // Pillar 2

    // --- 5. JUNGLE / CONNECTOR / STAIRS ---
    addBox(-15 * scale, 0, -35 * scale, 25 * scale, 35 * scale, 40 * scale, walls); // Connector/Jungle mass
    addBox(-10 * scale, 20 * scale, -15 * scale, 15 * scale, 2 * scale, 10 * scale, walls); // Window frame
    for (let i = 0; i < 10; i++) {
        addBox(-5 * scale, 0 + (i * 2), -25 * scale + (i * 3), 15 * scale, 3 * scale, 3 * scale, trim); // Stairs
    }

    // --- 6. MID AREA ---
    addBox(0, 0, 0, 20 * scale, 2 * scale, 100 * scale, floorTile, 0, false); // Mid Lane
    addBox(-30 * scale, 0, 0, 5 * scale, 40 * scale, 80 * scale, walls); // Mid Left wall (Catwalk)
    addBox(30 * scale, 0, 0, 5 * scale, 40 * scale, 80 * scale, walls); // Mid Right wall
    addBox(-35 * scale, 15 * scale, 0, 10 * scale, 2 * scale, 40 * scale, walls); // Catwalk path

    // --- 7. B-SITE AREA (Z- direction) ---
    addBox(-100 * scale, 0, -40 * scale, 40 * scale, 10 * scale, 40 * scale, trim); // B-Default platform
    addBox(-105 * scale, 0, -25 * scale, 15 * scale, 12 * scale, 15 * scale, crates); // Van area
    addBox(-80 * scale, 0, -60 * scale, 10 * scale, 12 * scale, 25 * scale, trim); // Bench
    addBox(-120 * scale, 0, -20 * scale, 30 * scale, 50 * scale, 60 * scale, walls); // Market building

    // --- 8. APARTMENTS ---
    addBox(-80 * scale, 20 * scale, 50 * scale, 25 * scale, 30 * scale, 100 * scale, walls); // Apps building
    addBox(-75 * scale, 35 * scale, 80 * scale, 15 * scale, 5 * scale, 15 * scale, oldWood); // Apps window

    // --- 9. CT-SPAWN & TICKET ---
    addBox(0, 0, -450, 100, 40, 50, walls); // CT Back wall
    addBox(20 * scale, 0, -60 * scale, 15 * scale, 15 * scale, 15 * scale, walls); // Ticket booth
    addBox(15 * scale, 15 * scale, -60 * scale, 25 * scale, 2 * scale, 20 * scale, trim); // Ticket Roof

    // --- 10. Surroundings (Boundary) ---
    addBox(0, 0, 600, 1200, 150, 20, walls); // Far T wall
    addBox(0, 0, -600, 1200, 150, 20, walls); // Far CT wall
    addBox(600, 0, 0, 20, 150, 1200, walls); // Far Right
    addBox(-600, 0, 0, 20, 150, 1200, walls); // Far Left

    // Floor override (since we passed in materials)
    // We already have a floor in init(), but let's place some "paving" stones for detail
    // Random flat stones on the ground
    for (let i = 0; i < 20; i++) {
        const sX = (Math.random() - 0.5) * 100;
        const sZ = (Math.random() - 0.5) * 100;
        addBox(sX, -0.4, sZ, 8, 0.5, 8, floorTile, 0, false);
    }
}

// --- Game Logic ---

function shoot() {
    if (isReloading) return;
    const ammo = weaponAmmo[currentWeaponType];
    if (currentWeaponType !== 'knife' && ammo.mag <= 0) {
        // Empty click? (Maybe add sound later)
        return;
    }

    inspectTimer = 0; // Cancel inspect
    if (currentWeaponType === 'knife') {
        meleeAttack();
        return;
    }

    const time = performance.now();
    if (time - lastShotTime < fireRate) return;
    lastShotTime = time;

    // Consume Ammo
    if (currentWeaponType !== 'knife') {
        ammo.mag--;
        updateAmmoDisplay();
    }

    // Create a bullet (Ultra-Visible Tracer)
    const bulletGeo = new THREE.CylinderGeometry(0.4, 0.4, 6.0, 8);
    bulletGeo.rotateX(-Math.PI / 2);
    const bulletMat = new THREE.MeshStandardMaterial({
        color: 0xffff00,
        emissive: 0xffff00,
        emissiveIntensity: 2.0
    });
    const bullet = new THREE.Mesh(bulletGeo, bulletMat);

    // Start position: player position (0 offset to prevent wall clipping)
    bullet.position.copy(controls.getObject().position);
    const direction = new THREE.Vector3();
    controls.getDirection(direction);

    // Bullet Spread & Delayed Recoil (Even higher moving inaccuracy)
    const horizontalSpeed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
    const movingInaccuracy = horizontalSpeed * 0.002;
    let spreadAmount = (isCrouching ? 0.005 : 0.01) + movingInaccuracy;
    let upwardRecoil = 0;

    if (currentWeaponType === 'ak47') {
        let effectiveRecoilCounter = recoilCounter;
        if (!canJump) {
            effectiveRecoilCounter = 10;
        }

        if (effectiveRecoilCounter > 0) {
            // Smaller vertical jump and spread
            const recoilJump = (effectiveRecoilCounter === 1) ? 0.08 : 0.02;
            upwardRecoil = effectiveRecoilCounter * (isCrouching ? 0.015 : recoilJump);
            spreadAmount = (isCrouching ? 0.015 : 0.025) + (effectiveRecoilCounter * 0.01);
        } else {
            upwardRecoil = 0;
            spreadAmount = 0.005; // First shot is very precise
        }
        recoilCounter++;
    } else {
        recoilCounter = 0;
    }

    // Apply Random Spread + Vertical Recoil
    const spreadX = (Math.random() - 0.5) * spreadAmount;
    const spreadY = (Math.random() - 0.5) * spreadAmount + upwardRecoil;
    const spreadZ = (Math.random() - 0.5) * spreadAmount;

    direction.y += spreadY;
    direction.x += spreadX;
    direction.z += spreadZ;
    direction.normalize();

    // Bullet lookAt
    bullet.lookAt(bullet.position.clone().add(direction));

    bullet.userData.velocity = direction.multiplyScalar(15);
    bullet.userData.weaponType = currentWeaponType;

    scene.add(bullet);
    bullets.push(bullet);

    // Visual Weapon Kick
    if (weapon) {
        weapon.position.z += 0.5;
        weapon.rotation.x += 0.1;
    }

    // Networking: Notify peer that we shot
    if (networkReady && conn && conn.open) {
        conn.send({
            type: 'shoot',
            pos: bullet.position,
            dir: direction
        });
    }
}

function meleeAttack() {
    const time = performance.now();
    if (time - lastShotTime < fireRate) return;
    lastShotTime = time;

    if (weapon) {
        // Butterfly knife flip animation
        if (currentWeaponType === 'knife' && weapon.userData.butterflyHandles) {
            const handles = weapon.userData.butterflyHandles;
            const duration = 400;
            const startTime = performance.now();

            const animateFlip = () => {
                const elapsed = performance.now() - startTime;
                const progress = Math.min(elapsed / duration, 1);

                if (progress < 0.5) {
                    // Open handles
                    const angle = (progress * 2) * Math.PI;
                    handles.handle1.rotation.x = angle;
                    handles.handle2.rotation.x = -angle;
                } else {
                    // Close handles
                    const angle = (2 - progress * 2) * Math.PI;
                    handles.handle1.rotation.x = angle;
                    handles.handle2.rotation.x = -angle;
                }

                if (progress < 1) {
                    requestAnimationFrame(animateFlip);
                } else {
                    handles.handle1.rotation.x = 0;
                    handles.handle2.rotation.x = 0;
                }
            };

            animateFlip();
        }

        // Slash animation
        weapon.rotation.z = -1.0;
        weapon.rotation.x = -0.5;
        setTimeout(() => {
            if (weapon) {
                weapon.rotation.z = 0;
                weapon.rotation.x = 0;
            }
        }, 200);
    }

    const raycasterMelee = new THREE.Raycaster();
    raycasterMelee.set(controls.getObject().position, new THREE.Vector3().copy(controls.getDirection(new THREE.Vector3())));
    raycasterMelee.far = 10.0; // Slightly longer range for ease

    const targets = [...enemies];
    for (const id in remotePlayers) {
        if (playerTeams[id] !== myTeamId) {
            targets.push(remotePlayers[id]);
        }
    }

    const intersects = raycasterMelee.intersectObjects(targets);
    if (intersects.length > 0) {
        const e = intersects[0].object;

        let hitPeerId = null;
        for (const id in remotePlayers) {
            if (remotePlayers[id] === e) {
                hitPeerId = id;
                break;
            }
        }

        if (hitPeerId) {
            const data = { type: "hit", targetId: hitPeerId, damage: 50 };
            if (isHost) {
                broadcast(data);
            } else if (allConns[0]) {
                allConns[0].send(data);
            }
        } else {
            e.userData.health -= 50;
            if (e.userData.health <= 0) {
                e.userData.isDead = true;
                const idx = enemies.indexOf(e);
                if (idx > -1) {
                    enemies.splice(idx, 1);
                    if (enemies.length === 0) endRound(true);
                    setTimeout(() => scene.remove(e), 3000);
                }
            }
        }
    }
}

const textureLoader = new THREE.TextureLoader();
const targetTexture = textureLoader.load('character.png');

function startRound() {
    if (playerWins >= MAX_WINS || enemyWins >= MAX_WINS) {
        endGame(playerWins >= MAX_WINS);
        return;
    }

    roundActive = true;
    health = 100;
    healthDisplay.textContent = "Health: " + health;
    recoilCounter = 0;

    // Reset Ammo for all weapons
    for (const type in weaponAmmo) {
        if (weaponConfigs[type]) {
            weaponAmmo[type].mag = weaponConfigs[type].magSize;
            weaponAmmo[type].reserve = weaponConfigs[type].reserve;
        }
    }
    updateAmmoDisplay();

    // Hide round overlays
    if (winScreen) winScreen.style.display = 'none';
    if (deathScreen) deathScreen.style.display = 'none';

    // Clear old stuff
    for (const e of enemies) scene.remove(e);
    enemies.length = 0;
    for (const b of bullets) scene.remove(b);
    bullets.length = 0;
    for (const b of enemyBullets) scene.remove(b);
    enemyBullets.length = 0;
    for (const i of impacts) scene.remove(i);
    impacts.length = 0;

    // Reset Player
    if (networkReady) {
        // Player 1 (Host) and Player 2 positions
        if (isHost) {
            controls.getObject().position.set(20, 10, -420); // CT Spawn near back wall
            controls.getObject().rotation.set(0, 0, 0); // Look towards Mid (-Z)
        } else {
            controls.getObject().position.set(0, 10, 420); // T Spawn near back wall
            controls.getObject().rotation.set(0, Math.PI, 0); // Look towards Mid (+Z)
        }
    } else {
        controls.getObject().position.set(20, 10, -420); // Start at CT Spawn for practice
        controls.getObject().rotation.set(0, 0, 0);
        spawnEnemies(enemiesPerRound);
    }

    scoreDisplay.textContent = networkReady ? `Match: ${playerWins} - ${opponentWins}` : `Match: ${playerWins} - ${enemyWins}`;
}

function spawnEnemies(count) {
    for (let i = 0; i < count; i++) {
        // Narrower plane (5 vs 8) for tighter hitbox as requested
        const enemy = create3DCharacterModel(0xff3333); // Red bots for enemies

        enemy.position.x = (Math.random() - 0.5) * 150;
        enemy.position.z = (Math.random() - 0.5) * 100 - 20;
        enemy.position.y = 5.5; // Feet on ground (stand height - eyes) 

        enemy.userData = {
            health: 100,
            lastShot: 0,
            mag: 30, // Bots have magazine now
            isReloading: false,
            reloadTimer: 0
        };
        enemies.push(enemy);
        scene.add(enemy);
    }
}

function updateEnemies(delta) {
    if (!roundActive) return;
    const playerPos = controls.getObject().position;
    const time = performance.now();

    for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        const data = e.userData;

        e.lookAt(playerPos.x, e.position.y, playerPos.z);

        // AI Reload Logic
        if (data.isReloading) {
            data.reloadTimer -= delta;
            if (data.reloadTimer <= 0) {
                data.isReloading = false;
                data.mag = 30; // Refill
            }
            // Move while reloading but don't shoot
        }

        const toPlayer = new THREE.Vector3().subVectors(playerPos, e.position);
        const dist = toPlayer.length();
        const dir = toPlayer.normalize();

        // LOS check
        const aiRay = new THREE.Raycaster(e.position, dir, 0, dist);
        const intersects = aiRay.intersectObjects(objects);
        const canSee = intersects.length === 0;

        if (canSee && dist < aiVisionRange && !data.isReloading) {
            if (time - data.lastShot > enemyFireRate) {
                enemyShoot(e);
                data.lastShot = time + Math.random() * 500;

                // Consume bot ammo
                data.mag--;
                if (data.mag <= 0) {
                    data.isReloading = true;
                    data.reloadTimer = 2.0; // 2s reload for bots
                }
            }
        }

        // Bot Walking Animation (Swaying while moving)
        if (!canSee || dist > 60) {
            // Collision check for enemy movement
            const nextPos = e.position.clone().add(dir.clone().multiplyScalar(enemySpeed * delta));

            // Bot sway animation
            e.rotation.z = Math.sin(time * 0.01) * 0.1;
            e.position.y = 7.5 + Math.abs(Math.sin(time * 0.01)) * 0.5;

            // Check if next position would be inside a precomputed wall box
            const enemyBox = new THREE.Box3().setFromCenterAndSize(nextPos, new THREE.Vector3(4, 15, 4));
            let collision = false;
            for (let j = 0; j < objectBoxes.length; j++) {
                if (objectBoxes[j].intersectsBox(enemyBox)) {
                    collision = true;
                    break;
                }
            }
            if (!collision) {
                e.position.x = nextPos.x;
                e.position.z = nextPos.z;
            }
        } else {
            // Reset bot pose if standing still
            e.rotation.z = THREE.MathUtils.lerp(e.rotation.z, 0, 5 * delta);
            e.position.y = THREE.MathUtils.lerp(e.position.y, 7.5, 5 * delta);
        }
    }
}

function enemyShoot(enemy) {
    const bulletGeo = new THREE.SphereGeometry(2.5, 8, 8);
    const bulletMat = new THREE.MeshStandardMaterial({
        color: 0xff3300,
        emissive: 0xff3300,
        emissiveIntensity: 2.0
    });
    const bullet = new THREE.Mesh(bulletGeo, bulletMat);
    bullet.position.copy(enemy.position).y += 2;

    const playerPos = controls.getObject().position.clone();
    // Reduced spread for better accuracy
    playerPos.x += (Math.random() - 0.5) * 3;
    playerPos.y += (Math.random() - 0.5) * 3;
    playerPos.z += (Math.random() - 0.5) * 3;

    const dir = new THREE.Vector3().subVectors(playerPos, bullet.position).normalize();
    bullet.userData.velocity = dir.multiplyScalar(15.0); // Matched to player speed
    scene.add(bullet);
    enemyBullets.push(bullet);
}

function updateBullets() {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        const velocityVec = b.userData.velocity;
        const distPerFrame = velocityVec.length() + 0.5; // Slight look-ahead
        const directionVec = velocityVec.clone().normalize();

        const bulletRay = new THREE.Raycaster(b.position, directionVec, 0, distPerFrame);
        bulletRay.firstHitOnly = true; // Optimization if available in version

        // Check both Enemies and Objects
        const enemyHits = bulletRay.intersectObjects(enemies);
        const wallHits = bulletRay.intersectObjects(objects);

        let closestHit = null;
        let isEnemy = false;
        let isRemote = false;

        if (enemyHits.length > 0) {
            closestHit = enemyHits[0];
            isEnemy = true;
        }
        if (wallHits.length > 0) {
            if (!closestHit || wallHits[0].distance < closestHit.distance) {
                closestHit = wallHits[0];
                isEnemy = false;
                isRemote = false;
            }
        }

        // Multiplayer: Check hit on all remote players
        if (networkReady) {
            for (const id in remotePlayers) {
                const rp = remotePlayers[id];
                // FRIENDLY FIRE: Skip if same team
                if (playerTeams[id] === myTeamId) continue;

                const remoteHits = bulletRay.intersectObject(rp);
                if (remoteHits.length > 0) {
                    if (!closestHit || remoteHits[0].distance < closestHit.distance) {
                        closestHit = remoteHits[0];
                        closestHit.targetPeerId = id; // Store who we hit
                        isEnemy = true;
                        isRemote = true;
                    }
                }
            }
        }

        if (closestHit) {
            if (!isEnemy) {
                // WALL IMPACT
                const impactGeo = new THREE.CircleGeometry(0.15, 8);
                const impactMat = new THREE.MeshBasicMaterial({ color: 0x222222, side: THREE.DoubleSide });
                const impact = new THREE.Mesh(impactGeo, impactMat);
                impact.position.copy(closestHit.point).add(closestHit.face.normal.multiplyScalar(0.02));
                impact.lookAt(closestHit.point.clone().add(closestHit.face.normal));
                scene.add(impact);
                impacts.push(impact);
                if (impacts.length > 100) scene.remove(impacts.shift());
            } else {
                // ENEMY HIT
                const enemy = closestHit.object;
                const relativeY = closestHit.point.y - enemy.position.y;
                let dmg = 20;
                const weaponType = b.userData.weaponType;

                if (relativeY > 3.5) { // Headshot
                    dmg = (weaponType === 'ak47') ? 80 : 50; // Less damage
                    console.log("HEADSHOT!");
                } else {
                    dmg = (weaponType === 'ak47') ? 22 : 15; // Less damage
                }

                enemy.userData.health -= dmg;
                if (enemy.userData.health <= 0) {
                    enemy.userData.isDead = true;

                    // If it was a bot, remove from enemies array
                    const botIdx = enemies.indexOf(enemy);
                    if (botIdx > -1) {
                        enemies.splice(botIdx, 1);
                        setTimeout(() => scene.remove(enemy), 3000); // Wait for death animation

                        // Check if all bots/enemies are dead (for single player or mixed)
                        if (checkTeamWipe(1)) { // Team 1 is enemies
                            endRound(true);
                        }
                    }

                    // If it was a remote player, broadcast their death
                    if (isRemote && networkReady) {
                        const deathMsg = { type: 'player-dead', deadId: closestHit.targetPeerId };
                        if (isHost) broadcast(deathMsg);
                        else if (allConns[0]) allConns[0].send(deathMsg);

                        // Check if all enemies are dead
                        if (checkTeamWipe(playerTeams[closestHit.targetPeerId])) {
                            const myTeam = myTeamId;
                            const enemyTeam = playerTeams[closestHit.targetPeerId];
                            if (myTeam !== enemyTeam) {
                                endRound(true);
                            }
                        }

                        setTimeout(() => scene.remove(enemy), 3000);
                    }
                }

                if (isRemote && networkReady) {
                    const data = { type: "hit", targetId: closestHit.targetPeerId, damage: dmg };
                    if (isHost) {
                        broadcast(data);
                    } else if (allConns[0]) {
                        allConns[0].send(data);
                    }
                    console.log(`Bullet hit player ${closestHit.targetPeerId} for ${dmg}`);
                }
            }
            scene.remove(b);
            bullets.splice(i, 1);
            continue;
        }

        b.position.add(velocityVec);
        if (b.position.distanceTo(controls.getObject().position) > 1000) {
            scene.remove(b);
            bullets.splice(i, 1);
        }
    }
}

function updateEnemyBullets() {
    const playerPos = controls.getObject().position;
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
        const b = enemyBullets[i];
        const vel = b.userData.velocity;
        const dist = vel.length() + 0.5;
        const dir = vel.clone().normalize();

        // Raycast against Walls
        const ray = new THREE.Raycaster(b.position, dir, 0, dist);
        const wallHits = ray.intersectObjects(objects);

        if (wallHits.length > 0) {
            scene.remove(b);
            enemyBullets.splice(i, 1);
            continue;
        }

        b.position.add(vel);

        if (b.position.distanceTo(playerPos) < 4) {
            takeDamage(10);
            scene.remove(b);
            enemyBullets.splice(i, 1);
            continue;
        }

        if (b.position.distanceTo(playerPos) > 1000) {
            scene.remove(b);
            enemyBullets.splice(i, 1);
        }
    }
}

function takeDamage(amount) {
    if (!roundActive) return;
    health -= amount;
    healthDisplay.textContent = "Health: " + Math.floor(health);
    document.body.style.backgroundColor = '#550000';
    setTimeout(() => { document.body.style.backgroundColor = 'transparent'; }, 50);

    if (health <= 0) endRound(false);
}

function endRound(playerWon) {
    if (!roundActive) return;
    roundActive = false;

    // Broadcast end to all if host
    if (isHost && networkReady) {
        broadcast({ type: 'round-ended', winnerTeam: playerWon ? myTeamId : (myTeamId === 0 ? 1 : 0) });
    }

    if (playerWon) {
        playerWins++;
    } else {
        if (networkReady) opponentWins++;
        else enemyWins++;
    }

    const currentScore = networkReady ? `${playerWins} - ${opponentWins}` : `${playerWins} - ${enemyWins}`;
    scoreDisplay.textContent = `Scoru: ${currentScore} (${playerWon ? "WON" : "LOST"} ROUND)`;

    // Show round overlays
    if (playerWon) {
        if (winScreen) winScreen.style.display = 'block';
    } else {
        if (deathScreen) deathScreen.style.display = 'block';
    }

    if (playerWins >= MAX_WINS || enemyWins >= MAX_WINS) {
        setTimeout(() => endGame(playerWins >= MAX_WINS), 2000);
    } else {
        setTimeout(startRound, 3000); // Wait 3s as requested
    }

    // Multiplayer Sync: If we lost, tell others who won
    if (!playerWon && networkReady) {
        const winnerTeam = (myTeamId === 0) ? 1 : 0;
        const msg = { type: 'round-ended', winnerTeam: winnerTeam };
        if (isHost) broadcast(msg);
        else if (allConns[0] && allConns[0].open) allConns[0].send(msg);
    }
}

function endGame(playerWonGame) {
    isGameOver = true;
    controls.unlock();
    hud.style.display = 'none';
    gameOverScreen.style.display = 'flex';
    finalScoreDisplay.textContent = playerWonGame ? "VICTORY! Match Won." : "DEFEAT! Match Lost.";
}

function updateAmmoDisplay() {
    const config = weaponConfigs[currentWeaponType];
    const ammo = weaponAmmo[currentWeaponType];
    if (currentWeaponType === 'knife') {
        ammoDisplay.textContent = config.name;
    } else {
        ammoDisplay.textContent = `${config.name} | ${ammo.mag} / ${ammo.reserve}`;
    }
}

function reload() {
    if (isReloading || currentWeaponType === 'knife') return;
    const ammo = weaponAmmo[currentWeaponType];
    const config = weaponConfigs[currentWeaponType];

    if (ammo.mag === config.magSize || ammo.reserve <= 0) return;

    isReloading = true;
    ammoDisplay.textContent = "RELOADING...";

    // Weapon Animation (Simple visual feedback)
    if (weapon) {
        weapon.rotation.x = -0.5;
        weapon.position.y = -2.5;
    }

    setTimeout(() => {
        const needed = config.magSize - ammo.mag;
        const toLoad = Math.min(needed, ammo.reserve);
        ammo.mag += toLoad;
        ammo.reserve -= toLoad;
        isReloading = false;
        updateAmmoDisplay();
    }, 2000); // 2 second reload
}

function animate() {
    requestAnimationFrame(animate);

    if (isGameOver) return;

    const time = performance.now();
    const delta = (time - prevTime) / 1000;

    // Networking: Send state to peer
    if (networkReady && time - syncTimer > SYNC_RATE) {
        sendUpdate();
        syncTimer = time;
    }

    if (controls.isLocked === true) {

        // --- Movement Logic ---
        // Disable movement and rotation for dead players
        if (health <= 0 || isGameOver) {
            direction.set(0, 0, 0);
            if (controls.isLocked) controls.unlock();
        } else {
            // Only update movement if alive
            velocity.x -= velocity.x * 10.0 * delta;
            velocity.z -= velocity.z * 10.0 * delta;
            velocity.y -= 9.8 * 100.0 * delta; // 100.0 = mass

            direction.z = (Number(moveForward) - Number(moveBackward));
            direction.x = (Number(moveRight) - Number(moveLeft));
            direction.normalize();

            if (moveForward || moveBackward) {
                const accel = isCrouching ? 150.0 : 400.0;
                velocity.z -= direction.z * accel * delta;
            }
            if (moveLeft || moveRight) {
                const accel = isCrouching ? 150.0 : 400.0;
                velocity.x -= direction.x * accel * delta;
            }
        }

        if (moveLeft || moveRight) {
            const accel = isCrouching ? 150.0 : 400.0;
            velocity.x -= direction.x * accel * delta;
        }

        const currentTargetHeight = isCrouching ? PLAYER_CROUCH_HEIGHT : PLAYER_STAND_HEIGHT;
        const lerpSpeed = 10 * delta;
        const playerObj = controls.getObject();

        // 1. Horizontal Movement & Collision
        const oldPos = playerObj.position.clone();

        controls.moveRight(-velocity.x * delta);
        controls.moveForward(-velocity.z * delta);

        const horizPos = playerObj.position.clone();
        // lift the box slightly (0.1 epsilon) to avoid colliding with the floor we are standing on
        const playerBox = new THREE.Box3().setFromCenterAndSize(
            horizPos.clone().setY(horizPos.y - (currentTargetHeight / 2) + 0.1),
            new THREE.Vector3(PLAYER_RADIUS * 2, currentTargetHeight - 0.2, PLAYER_RADIUS * 2)
        );

        for (let i = 0; i < objectBoxes.length; i++) {
            if (playerBox.intersectsBox(objectBoxes[i])) {
                // Revert horizontal only
                playerObj.position.x = oldPos.x;
                playerObj.position.z = oldPos.z;
                velocity.x = 0;
                velocity.z = 0;
                break;
            }
        }

        // 2. Vertical Movement & Collision
        const yBefore = playerObj.position.y;
        playerObj.position.y += (velocity.y * delta);
        const yAfter = playerObj.position.y;

        // Crouch height lerp (smooth transition)
        // If standing on ground, we can lerp. If in air, we lerp too.
        // We use a separate target to avoid jitter during collision math.

        // Robust vertical check: check the volume covered by the move
        const yMin = Math.min(yBefore, yAfter) - currentTargetHeight;
        const yMax = Math.max(yBefore, yAfter);
        const verticalSpanBox = new THREE.Box3(
            new THREE.Vector3(playerObj.position.x - PLAYER_RADIUS, yMin, playerObj.position.z - PLAYER_RADIUS),
            new THREE.Vector3(playerObj.position.x + PLAYER_RADIUS, yMax, playerObj.position.z + PLAYER_RADIUS)
        );

        let landed = false;
        for (let i = 0; i < objectBoxes.length; i++) {
            const box = objectBoxes[i];
            if (verticalSpanBox.intersectsBox(box)) {
                if (velocity.y < 0) {
                    // Falling: Check if we hit the top of the box
                    if (yBefore - currentTargetHeight >= box.max.y - 1.0) {
                        velocity.y = 0;
                        playerObj.position.y = box.max.y + currentTargetHeight;
                        canJump = true;
                        landed = true;
                        break;
                    }
                } else if (velocity.y > 0) {
                    // Jumping: Check if we hit the bottom
                    if (yBefore <= box.min.y + 1.0) {
                        velocity.y = 0;
                        playerObj.position.y = box.min.y - 0.1;
                        break;
                    }
                }
            }
        }

        // Floor collision fallback
        if (!landed && playerObj.position.y < currentTargetHeight) {
            velocity.y = 0;
            playerObj.position.y = THREE.MathUtils.lerp(playerObj.position.y, currentTargetHeight, lerpSpeed);
            if (playerObj.position.y < currentTargetHeight + 0.1) {
                playerObj.position.y = currentTargetHeight;
            }
            canJump = true;
        } else if (!landed && !isCrouching && playerObj.position.y < PLAYER_STAND_HEIGHT) {
            // Smoothing when standing up from crouch
            playerObj.position.y = THREE.MathUtils.lerp(playerObj.position.y, PLAYER_STAND_HEIGHT, lerpSpeed);
        }

        // --- Game Logic Updates ---
        updateBullets();
        updateEnemyBullets();
        updateEnemies(delta);

    }

    // Weapon Recoil & Animation Logic
    if (weapon) {
        // VIEW BOBBING & SWAY
        const speed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
        const isMoving = speed > 0.1 && canJump;

        if (isMoving) {
            const bob = Math.sin(time * 0.01) * 0.15;
            const sway = Math.cos(time * 0.005) * 0.1;
            weapon.position.y += bob * 0.3;
            weapon.position.x += sway * 0.5;
            camera.position.y += bob * 0.1;

            // Side tilt while moving
            weapon.rotation.z = THREE.MathUtils.lerp(weapon.rotation.z, (Number(moveLeft) - Number(moveRight)) * 0.1, 5 * delta);
        } else {
            weapon.rotation.z = THREE.MathUtils.lerp(weapon.rotation.z, 0, 5 * delta);
        }

        // Recoil Reset Logic: reset spray if 1.5 seconds idle
        if (time - lastShotTime > 1500) {
            recoilCounter = 0;
        }

        if (isReloading) {
            // RELOAD ANIMATION (Enhanced)
            weapon.position.y = THREE.MathUtils.lerp(weapon.position.y, -3.5, 5 * delta);
            weapon.rotation.x = THREE.MathUtils.lerp(weapon.rotation.x, -0.8, 5 * delta);
            weapon.rotation.z = THREE.MathUtils.lerp(weapon.rotation.z, 0.5, 5 * delta);
        }
        else if (inspectTimer > 0) {
            // INSPECT ANIMATION
            inspectTimer -= delta;
            if (inspectTimer < 0) inspectTimer = 0;

            // Normalized Progress: 0 (start) -> 1 (mid) -> 0 (end)? 
            // Better: 0 to 1 based on remaining time.
            const t = 1.0 - (inspectTimer / INSPECT_DURATION);

            // Animation Curve: 
            // 0.0 - 0.2: Rotate to side
            // 0.2 - 0.8: Hold
            // 0.8 - 1.0: Return

            let targetRotY = 0;
            let targetRotZ = 0;
            let targetRotX = 0;
            let targetPosX = 1.2;

            if (t < 0.2) {
                // Entry
                const p = t / 0.2; // 0 to 1
                targetRotY = THREE.MathUtils.lerp(0, 0.5, p); // Turn side 45 deg
                targetRotZ = THREE.MathUtils.lerp(0, 0.5, p); // Tilt 45 deg
                targetRotX = THREE.MathUtils.lerp(0, 0.2, p); // Slight lift
                targetPosX = THREE.MathUtils.lerp(1.2, 0.8, p); // Move center
            } else if (t < 0.8) {
                // Hold
                targetRotY = 0.5 + Math.sin((t - 0.2) * 5) * 0.1; // Wiggle
                targetRotZ = 0.5 + Math.cos((t - 0.2) * 5) * 0.05;
                targetRotX = 0.2;
                targetPosX = 0.8;
            } else {
                // Exit
                const p = (t - 0.8) / 0.2; // 0 to 1
                targetRotY = THREE.MathUtils.lerp(0.5 + Math.sin((0.6) * 5) * 0.1, 0, p);
                targetRotZ = THREE.MathUtils.lerp(0.5 + Math.cos((0.6) * 5) * 0.05, 0, p);
                targetRotX = THREE.MathUtils.lerp(0.2, 0, p);
                targetPosX = THREE.MathUtils.lerp(0.8, 1.2, p);
            }

            // Apply directly or lerp? Direct is fine for calculated curve
            // But we need to account for existing rotation/pos if switching from recoil
            // Let's force set for now, as inspect overrides idle

            // However, we must respect the base Y/Z pos from recoil recovery logic if we want smooth transitions?
            // Actually, let's override recoil recovery.

            weapon.rotation.set(targetRotX, targetRotY, targetRotZ);
            // Keep Y and Z steady, modify X
            weapon.position.set(targetPosX, -1.8, -2.5);

        } else {
            // IDLE / RECOIL RECOVERY (Default Layout)
            // Lerp back to original position (-2.5) and rotation (0)
            weapon.position.z = THREE.MathUtils.lerp(weapon.position.z, -2.5, 10 * delta); // Recoil Z
            weapon.position.y = THREE.MathUtils.lerp(weapon.position.y, -1.8, 5 * delta); // Equip Y (-1.8 default)
            weapon.rotation.x = THREE.MathUtils.lerp(weapon.rotation.x, 0, 10 * delta); // Recoil/Equip Rotation X
            weapon.rotation.y = THREE.MathUtils.lerp(weapon.rotation.y, 0, 10 * delta);
            weapon.rotation.z = THREE.MathUtils.lerp(weapon.rotation.z, 0, 10 * delta);
            weapon.position.x = THREE.MathUtils.lerp(weapon.position.x, 1.2, 10 * delta);

            // Butterfly knife idle animation
            if (currentWeaponType === 'knife' && weapon.userData.butterflyHandles) {
                const handles = weapon.userData.butterflyHandles;
                const idleSpeed = 0.002;
                const idleAngle = Math.sin(time * idleSpeed) * 0.3; // Gentle opening/closing
                handles.handle1.rotation.x = idleAngle;
                handles.handle2.rotation.x = -idleAngle;
            }
        }
    }

    prevTime = time;

    // Weapon Auto-Fire Logic
    if (isFiring && currentWeaponType === 'ak47') {
        shoot();
    }

    // Death Animations
    for (const id in remotePlayers) {
        const rp = remotePlayers[id];
        if (rp.userData.isDead && rp.userData.deathRotate < Math.PI / 2) {
            const step = 5 * delta;
            rp.rotation.x += step;
            rp.userData.deathRotate += step;
            rp.position.y = Math.max(1, rp.position.y - 5 * delta);
        }
    }
    enemies.forEach(e => {
        if (e.userData.isDead && e.userData.deathRotate < Math.PI / 2) {
            const step = 5 * delta;
            e.rotation.x += step;
            e.userData.deathRotate += step;
            e.position.y = Math.max(1, e.position.y - 5 * delta);
        }
    });

    renderer.render(scene, camera);
}
init();
animate();

// --- Multiplayer Implementation ---

function startMatchmaking(mode) {
    currentMode = mode;
    modeDisplay.textContent = mode;
    modeModal.classList.remove('active');

    if (mode === '1vBot') {
        lobbyUI.style.display = 'none';
        networkReady = false;
        controls.lock();
        startRound();
        return;
    }

    const modeMap = {
        '1v1': 2,
        '2v2': 4,
        '3v3': 6
    };

    requiredPlayers = modeMap[mode] || 2;
    requiredCountDisplay.textContent = requiredPlayers;
    foundCountDisplay.textContent = '1';
    matchmakingStatus.textContent = 'Initializing...';
    matchmakingModal.classList.add('active');

    initMultiplayer(mode);
}

function initMultiplayer(mode) {
    const roomName = `FPS_MATCH_ROOM_${mode.toUpperCase()}`;

    // Clear existing connections if any
    allConns.forEach(c => c.close());
    allConns = [];
    if (peer) peer.destroy();

    // Google STUN servers for NAT traversal
    const config = {
        'iceServers': [
            { 'urls': 'stun:stun.l.google.com:19302' },
            { 'urls': 'stun:stun1.l.google.com:19302' },
            { 'urls': 'stun:stun2.l.google.com:19302' },
        ],
        'debug': 1
    };

    matchmakingStatus.textContent = 'Searching for room...';

    // Attempt to be the host of the room
    peer = new Peer(roomName, config);

    peer.on('open', (id) => {
        myId = id;
        myTeamId = 0; // Host is Team 1
        console.log('Acting as Host in room: ' + id);
        matchmakingStatus.textContent = "Waiting for players...";
        isHost = true;
        updateMatchmakingUI();
    });

    peer.on('error', (err) => {
        console.error('Peer error:', err);
        if (err.type === 'unavailable-id') {
            console.log('Room occupied, joining as client...');
            if (peer) peer.destroy();

            peer = new Peer(config);
            peer.on('open', (id) => {
                myId = id;
                const connection = peer.connect(roomName, { reliable: true });
                allConns.push(connection);
                setupConnection(connection);
                isHost = false;
                matchmakingStatus.textContent = "Joining match...";
            });
        } else {
            matchmakingStatus.textContent = "Error: " + err.type;
        }
    });

    peer.on('connection', (connection) => {
        if (allConns.length + 1 >= requiredPlayers) {
            console.log('Match full, ignoring connection.');
            connection.close();
            return;
        }
        allConns.push(connection);
        setupConnection(connection);
        updateMatchmakingUI();
        console.log('A player joined the match!');
    });

    peer.on('disconnected', () => {
        console.log('Peer disconnected from server.');
        peer.reconnect();
    });
}

function updateMatchmakingUI() {
    currentPlayers = allConns.length + 1;
    foundCountDisplay.textContent = currentPlayers;

    if (currentPlayers >= requiredPlayers) {
        matchmakingStatus.textContent = "MATCH FOUND!";

        // Hide lobby immediately as it covers the map
        setTimeout(() => {
            matchmakingModal.classList.remove('active');
            lobbyUI.style.display = 'none';

            // Show start prompt because auto-locking might fail
            instructionScreen.style.display = 'flex';
            instructionScreen.querySelector('h1').textContent = "MATCH READY";
            instructionScreen.querySelector('p').textContent = "Click to Enter Map";

            startRound();
        }, 1500);
    }
}


function updatePlayerCountUI() {
    const pCountDisplay = document.getElementById('player-count');
    if (pCountDisplay) {
        pCountDisplay.textContent = (allConns.length + 1) + "/4";
    }
}

function setupConnection(connection) {
    const lobbyStatus = document.getElementById('lobby-status');
    const lobby = document.getElementById('lobby');
    const bulb = document.getElementById('connection-bulb');

    connection.on('open', () => {
        networkReady = true;
        matchmakingStatus.textContent = "CONNECTED!";

        // Team assignment logic (Host assigns teams)
        if (isHost) {
            const idx = allConns.indexOf(connection);
            const team = (idx % 2 === 0) ? 1 : 0;
            playerTeams[connection.peer] = team;

            broadcast({
                type: 'init-team',
                assignments: playerTeams,
                hostTeam: myTeamId
            });
        }

        // Remove bots for multiplayer mode
        for (const e of enemies) scene.remove(e);
        enemies.length = 0;

        updateMatchmakingUI();
    });

    connection.on('data', (data) => {
        if (data.type === 'heartbeat') return;

        // Handle local update
        handleServerData(data, connection.peer);

        // Host relays data to other clients
        if (isHost) {
            allConns.forEach(c => {
                if (c.peer !== connection.peer && c.open) {
                    c.send(data);
                }
            });
        }
    });

    connection.on('close', () => {
        const idx = allConns.indexOf(connection);
        if (idx > -1) allConns.splice(idx, 1);

        const peerId = connection.peer;
        console.log(`Player ${peerId} left.`);

        if (remotePlayers[peerId]) {
            scene.remove(remotePlayers[peerId]);
            delete remotePlayers[peerId];
        }
        delete playerTeams[peerId];

        updatePlayerCountUI();
        networkReady = allConns.length > 0;

        // Host: Notify others
        if (isHost) {
            broadcast({ type: 'player-left', leftId: peerId });
        }
    });
}

function broadcast(data) {
    allConns.forEach(c => {
        if (c.open) c.send(data);
    });
}

function handleServerData(data, senderPeerId) {
    if (data.type === 'init-team') {
        playerTeams = data.assignments;
        myTeamId = isHost ? 0 : (playerTeams[myId] !== undefined ? playerTeams[myId] : 1);
    } else if (data.type === 'move') {
        const rp = remotePlayers[senderPeerId];
        if (!rp) {
            createRemotePlayer(senderPeerId);
            return; // Skip this move update while creating
        }
        if (rp) {
            rp.position.set(data.pos.x, data.pos.y, data.pos.z);
            rp.rotation.y = data.rotY;
        }
    } else if (data.type === 'shoot') {
        createOpponentBullet(data.pos, data.dir, senderPeerId);
    } else if (data.type === 'hit') {
        if (data.targetId === myId) {
            takeDamage(data.damage);
        }
    } else if (data.type === 'round-ended') {
        // If our team won according to the message, and we haven't ended yet
        if (data.winnerTeam === myTeamId && roundActive) {
            endRound(true);
        } else if (data.winnerTeam !== myTeamId && roundActive) {
            endRound(false);
        }
    } else if (data.type === 'player-dead') {
        const rp = remotePlayers[data.deadId];
        if (rp) {
            rp.userData.isDead = true;
            setTimeout(() => scene.remove(rp), 3000);

            // Re-check wipe on death message
            if (checkTeamWipe(playerTeams[data.deadId])) {
                if (playerTeams[data.deadId] !== myTeamId) {
                    endRound(true);
                } else {
                    // Our team might be wiped, check if we (local) are dead
                    if (health <= 0) endRound(false);
                }
            }
        }
    }
}

function checkTeamWipe(teamId) {
    // Check local player first
    if (myTeamId === teamId && health > 0) return false;

    // Check remote players
    for (const id in remotePlayers) {
        if (playerTeams[id] === teamId && !remotePlayers[id].userData.isDead) {
            return false;
        }
    }

    // Check bots
    for (const enemy of enemies) {
        // Bots are always team 1 (enemies) for now
        if (teamId === 1 && !enemy.userData.isDead) return false;
    }

    return true;
}

function create3DCharacterModel(color = 0x3366ff) {
    const group = new THREE.Group();
    const isCT = (color === 0x3366ff); // Simple heuristic for now

    // Standard Scale (Smaller than before - roughly 12 units total)
    const s = 0.8;

    // Materials
    const bodyMat = new THREE.MeshStandardMaterial({ color: isCT ? 0x2e3a4e : 0x5c5c5c }); // Navy for CT, Grey for T
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xffdbac });
    const clothingMat = new THREE.MeshStandardMaterial({ color: isCT ? 0x1c2533 : 0x3d3d3d });
    const gearMat = new THREE.MeshStandardMaterial({ color: 0x111111 }); // Dark gear

    // Torso (Vaguely rounded body)
    const torsoGeo = new THREE.CylinderGeometry(1.8 * s, 1.5 * s, 6 * s, 8);
    const torso = new THREE.Mesh(torsoGeo, bodyMat);
    torso.position.y = 1.0 * s;
    group.add(torso);

    // Tactical Vest (Rounded gear)
    const vestGeo = new THREE.CylinderGeometry(2.0 * s, 1.8 * s, 4.5 * s, 8);
    const vest = new THREE.Mesh(vestGeo, gearMat);
    vest.position.y = 1.0 * s;
    group.add(vest);

    // Head (Slightly rounded)
    const headGeo = new THREE.CylinderGeometry(1.2 * s, 1.2 * s, 2.2 * s, 8);
    const head = new THREE.Mesh(headGeo, skinMat);
    head.position.y = 5.2 * s;
    group.add(head);

    // Helmet / Mask
    const helmetGeo = new THREE.CylinderGeometry(1.4 * s, 1.2 * s, 1.4 * s, 8);
    const helmet = new THREE.Mesh(helmetGeo, gearMat);
    helmet.position.y = 5.8 * s;
    group.add(helmet);

    if (isCT) {
        // SAS Visor
        const visorGeo = new THREE.CylinderGeometry(0.9 * s, 0.9 * s, 0.5 * s, 8);
        visorGeo.rotateX(Math.PI / 2);
        const visor = new THREE.Mesh(visorGeo, new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00ffff, emissiveIntensity: 0.5 }));
        visor.position.set(0, 5.2 * s, -1.0 * s);
        group.add(visor);
    } else {
        head.material = new THREE.MeshStandardMaterial({ color: 0x222222 });
    }

    // Arms (Cylindrical)
    const armGeo = new THREE.CylinderGeometry(0.5 * s, 0.5 * s, 6.0 * s, 8);
    const leftArm = new THREE.Mesh(armGeo, bodyMat);
    leftArm.position.set(-2.2 * s, 1.2 * s, 0);
    group.add(leftArm);

    const rightArm = new THREE.Mesh(armGeo, bodyMat);
    rightArm.position.set(2.2 * s, 1.2 * s, 0);
    group.add(rightArm);

    // Legs (Cylindrical)
    const legGeo = new THREE.CylinderGeometry(0.7 * s, 0.6 * s, 5.5 * s, 8);
    const leftLeg = new THREE.Mesh(legGeo, clothingMat);
    leftLeg.position.set(-1.0 * s, -4.0 * s, 0);
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeo, clothingMat);
    rightLeg.position.set(1.0 * s, -4.0 * s, 0);
    group.add(rightLeg);

    // Boots (Slightly rounded)
    const bootGeo = new THREE.CylinderGeometry(0.9 * s, 0.9 * s, 0.8 * s, 8);
    const leftBoot = new THREE.Mesh(bootGeo, gearMat);
    leftBoot.position.set(-1.0 * s, -6.5 * s, 0.2 * s);
    group.add(leftBoot);

    const rightBoot = new THREE.Mesh(bootGeo, gearMat);
    rightBoot.position.set(1.0 * s, -6.5 * s, 0.2 * s);
    group.add(rightBoot);

    group.traverse(child => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
        }
    });

    group.userData.isDead = false;
    group.userData.deathRotate = 0;

    return group;
}

function createRemotePlayer(id) {
    if (remotePlayers[id]) return;

    // Team-based colors
    const team = playerTeams[id];
    const color = (team === myTeamId) ? 0x3366ff : 0xff3333; // Blue for teammates, Red for enemies

    const mesh = create3DCharacterModel(color);
    mesh.position.set(0, 7.5, -50);
    mesh.userData.health = 100; // Initialize health for local hit tracking
    scene.add(mesh);
    remotePlayers[id] = mesh;

    // Add "coleguț" tag if on same team
    setTimeout(() => {
        const team = playerTeams[id];
        if (team === myTeamId) {
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 64;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#00ff00';
            ctx.font = 'Bold 40px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('coleguț', 128, 45);

            const txtTexture = new THREE.CanvasTexture(canvas);
            const spriteMat = new THREE.SpriteMaterial({ map: txtTexture });
            const sprite = new THREE.Sprite(spriteMat);
            sprite.scale.set(10, 2.5, 1);
            sprite.position.y = 10;
            mesh.add(sprite);
        }
    }, 1000);
}

function sendUpdate() {
    if (!networkReady || allConns.length === 0) return;

    const data = {
        type: 'move',
        pos: {
            x: controls.getObject().position.x,
            y: controls.getObject().position.y,
            z: controls.getObject().position.z
        },
        rotY: controls.getObject().rotation.y
    };

    if (isHost) {
        broadcast(data);
    } else if (allConns[0] && allConns[0].open) {
        allConns[0].send(data);
    }
}

function createOpponentBullet(pos, dir, senderPeerId) {
    const bulletGeo = new THREE.SphereGeometry(2.5, 8, 8);
    const bulletMat = new THREE.MeshStandardMaterial({
        color: 0xff3300,
        emissive: 0xff3300,
        emissiveIntensity: 2.0
    });
    const bullet = new THREE.Mesh(bulletGeo, bulletMat);
    bullet.position.copy(pos);

    const velocity = new THREE.Vector3(dir.x, dir.y, dir.z).multiplyScalar(15.0);
    bullet.userData.velocity = velocity;
    scene.add(bullet);
    enemyBullets.push(bullet);
}
