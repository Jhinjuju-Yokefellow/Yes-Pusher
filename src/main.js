import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './styles.css';
import { CONFIG, TOWER_LAYOUT, TOWER_STACK_OFFSETS, COLORS as colors } from './config/machine-config.js';
import { getCoinSkin } from './config/skin-catalog.js';
import { createStartingBedPlan } from './game/initial-layout.js';
import { makeRandomSlotPlan } from './game/drop-plan.js';
import { createTurnController, TURN_STATES } from './game/turn-controller.js';
import { createConfirmedWorldSnapshot, normalizeWorldSnapshot } from './game/world-snapshot.js';
import { clearConfirmedWorld, loadConfirmedWorld, saveConfirmedWorld } from './game/world-storage.js';
import { createSceneHelpers } from './machine/scene-helpers.js';
import { createCabinet } from './machine/cabinet.js';
import { createPegBoard } from './machine/peg-board.js';
import { createPusher as buildPusher } from './machine/pusher.js';
import { SharedWorldClient } from './network/shared-world-client.js';
import { SharedWorldView } from './network/shared-world-view.js';
import { WalletAuthClient } from './network/wallet-auth-client.js';
import { formatTurnSeconds } from './ui/turn-timer.js';
import { WORLD_SERVER_IS_REMOTE, WORLD_SERVER_ORIGIN } from './network/world-server-url.js';


const canvas = document.querySelector('#game');
const scoreEl = document.querySelector('#score');
const turnScoreEl = document.querySelector('#turnScore');
const coinCountEl = document.querySelector('#coinCount');
const dropCountEl = document.querySelector('#dropCount');
const statusText = document.querySelector('#statusText');
const loading = document.querySelector('#loading');
const dropButton = document.querySelector('#drop');
const minusButton = document.querySelector('#minus');
const plusButton = document.querySelector('#plus');
const turnTimerEl = document.querySelector('#turnTimer');
const turnNumberEl = document.querySelector('#turnNumber');
const skinProgressEl = document.querySelector('#skinProgress');
const turnResultEl = document.querySelector('#turnResult');
const resultWonEl = document.querySelector('#resultWon');
const resultDroppedEl = document.querySelector('#resultDropped');
const resultLifetimeEl = document.querySelector('#resultLifetime');
const resultMilestoneEl = document.querySelector('#resultMilestone');
const activePlayerNameEl = document.querySelector('#activePlayerName');
const queueStatusEl = document.querySelector('#queueStatus');
const queueButton = document.querySelector('#queueButton');
const statusDot = document.querySelector('#statusDot');
const resetMachineButton = document.querySelector('#resetMachine');
const walletStatusEl = document.querySelector('#walletStatus');
const walletButton = document.querySelector('#walletButton');
const resultCreditEl = document.querySelector('#resultCredit');
const resultSkinEl = document.querySelector('#resultSkin');
const resultSkinImageEl = document.querySelector('#resultSkinImage');
const resultSkinNameEl = document.querySelector('#resultSkinName');
const resultSkinStatusEl = document.querySelector('#resultSkinStatus');


let selectedCount = 5;
let dropping = false;
let pusherTime = 0;
let lastDroppedCoin = null;
let batchFinishedSpawning = false;
let dropSequenceToken = 0;
const slotIndicators = [];
let lastTime = performance.now();
const dynamicObjects = [];
const coinObjects = [];
const towerObjects = [];
let nextCoinId = 1;
let confirmedAutosaveSeconds = 0;
let saveTimer = null;
let saveGeneration = 0;
let sharedMode = false;
let sharedClient = null;
let sharedView = null;
let sharedSnapshot = null;
let lastSharedResultId = null;
let sharedCommandPending = false;
let walletAuth = null;
let walletCommandPending = false;
let sharedInitialReconnectTimer = null;
const hostedFrontend = /(^|\.)vercel\.app$/i.test(globalThis.location?.hostname ?? '');
const HOSTED_PERFORMANCE_MODE = WORLD_SERVER_IS_REMOTE || hostedFrontend;

const turnController = createTurnController({
  activeDurationSeconds: 30,
  settleQuietSeconds: 1.25,
  settleMaximumSeconds: 3.5,
  milestoneEvery: 50,
  onChange: renderTurnSnapshot,
});

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x040710);
scene.fog = new THREE.FogExp2(0x060913, 0.018);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 10.65, 18.35);
const defaultCamera = { position: camera.position.clone(), target: new THREE.Vector3(0, 4.28, -0.72) };

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: !HOSTED_PERFORMANCE_MODE,
  alpha: false,
  powerPreference: 'high-performance',
});
const MAX_RENDER_PIXEL_RATIO = HOSTED_PERFORMANCE_MODE ? 0.86 : 1.1;
const MIN_RENDER_PIXEL_RATIO = HOSTED_PERFORMANCE_MODE ? 0.52 : 0.72;
let renderPixelRatio = Math.min(devicePixelRatio || 1, MAX_RENDER_PIXEL_RATIO);
let qualitySampleSeconds = 0;
let qualitySampleFrames = 0;
renderer.setPixelRatio(renderPixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = !HOSTED_PERFORMANCE_MODE;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.22;

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(defaultCamera.target);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.minDistance = 11;
controls.maxDistance = 24;
controls.minPolarAngle = Math.PI * 0.20;
controls.maxPolarAngle = Math.PI * 0.47;
controls.minAzimuthAngle = -0.34;
controls.maxAzimuthAngle = 0.34;

const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0), allowSleep: true });
world.broadphase = new CANNON.SAPBroadphase(world);
world.solver.iterations = 6;
world.solver.tolerance = 0.002;
world.defaultContactMaterial.friction = 0.25;
world.defaultContactMaterial.restitution = 0.02;

const MAT = {
  coin: new CANNON.Material('coin'),
  board: new CANNON.Material('board'),
  peg: new CANNON.Material('peg'),
  pusher: new CANNON.Material('pusher'),
};
world.addContactMaterial(new CANNON.ContactMaterial(MAT.coin, MAT.coin, { friction: 0.28, restitution: 0.002 }));
world.addContactMaterial(new CANNON.ContactMaterial(MAT.coin, MAT.board, { friction: 0.38, restitution: 0.002 }));
world.addContactMaterial(new CANNON.ContactMaterial(MAT.coin, MAT.pusher, { friction: 0.52, restitution: 0.0 }));
world.addContactMaterial(new CANNON.ContactMaterial(MAT.coin, MAT.peg, { friction: 0.015, restitution: 0.28 }));
const { addLightRig, addStaticBox, neonStrip, addVisualBox } = createSceneHelpers({
  scene,
  world,
  materials: MAT,
  performanceMode: HOSTED_PERFORMANCE_MODE,
});


const PEG_BASE_QUATERNION = new CANNON.Quaternion();
PEG_BASE_QUATERNION.setFromEuler(Math.PI/2,0,0);
const PEG_SPIN_QUATERNION = new CANNON.Quaternion();
const PEG_SPIN_AXIS = new CANNON.Vec3(0,0,1);

function setPegCoinOrientation(body, angle) {
  PEG_SPIN_QUATERNION.setFromAxisAngle(PEG_SPIN_AXIS,angle);
  PEG_SPIN_QUATERNION.mult(PEG_BASE_QUATERNION,body.quaternion);
}

async function loadTextures() {
  const loader = new THREE.TextureLoader();
  const [cabinet, pegboard, coinFront, coinBack] = await Promise.all([
    loader.loadAsync('/assets/cabinet-art.svg'),
    loader.loadAsync('/assets/pegboard-art.svg'),
    loader.loadAsync('/assets/coin-face.svg'),
    loader.loadAsync('/assets/coin-back.svg'),
  ]);
  for (const texture of [cabinet, pegboard, coinFront, coinBack]) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(HOSTED_PERFORMANCE_MODE ? 2 : 8, renderer.capabilities.getMaxAnisotropy());
  }
  return { cabinet, pegboard, coinFront, coinBack };
}

let textures;

let pusher;

const coinGeometry = new THREE.CylinderGeometry(
  CONFIG.coin.radius,
  CONFIG.coin.radius,
  CONFIG.coin.thickness,
  HOSTED_PERFORMANCE_MODE ? 14 : 24,
);
const boardTopY = CONFIG.board.y + .42/2;
const coinRestY = boardTopY + CONFIG.coin.thickness/2 + .004;
const pusherTopY = CONFIG.pusher.y + CONFIG.pusher.shelfThickness/2;
const pusherCoinRestY = pusherTopY + CONFIG.coin.thickness/2 + .004;
let coinMats;

function createCoin({x=0,y=5,z=0,flat=true,rotationY=0,tower=false,startAsleep=false,phase='board',id=null}={}) {
  const mesh = new THREE.Mesh(coinGeometry,coinMats);
  // Hundreds of individually shadow-casting coins were the largest render cost.
  // They still receive cabinet lighting, but no longer trigger a shadow pass each.
  mesh.castShadow=false; mesh.receiveShadow=true; mesh.position.set(x,y,z); scene.add(mesh);
  const inPegField = phase === 'peg';
  const body = new CANNON.Body({
    mass:CONFIG.coin.mass,
    material:MAT.coin,
    linearDamping:inPegField ? .018 : .12,
    angularDamping:inPegField ? .035 : .26,
    allowSleep:!inPegField,
    sleepSpeedLimit:.07,
    sleepTimeLimit:.55,
    collisionFilterGroup:1,
    collisionFilterMask:2|4|1,
  });
  // Twelve sides are visually indistinguishable in collision but far cheaper
  // than the old 24-sided convex body once the jackpot pile wakes up.
  const shape = new CANNON.Cylinder(CONFIG.coin.radius,CONFIG.coin.radius,CONFIG.coin.thickness,12);
  body.addShape(shape);
  body.position.set(x,y,z);
  if(flat) body.quaternion.setFromEuler(0,rotationY,0); else setPegCoinOrientation(body,rotationY);
  if(phase==='peg') {
    body.linearFactor.set(1,1,0);
    body.angularFactor.set(0,0,1);
  } else {
    // Board coins may spin and wobble, but large X/Z rotations are limited so a
    // compressed pile slides forward instead of erupting upward.
    body.angularFactor.set(.22,1,.22);
  }
  world.addBody(body);
  if(startAsleep) body.sleep();
  const item={id:id ?? `coin-${nextCoinId++}`,mesh,body,type:'coin',tower,phase,pegAngle:rotationY,hasReachedPusher:false,pegStallSeconds:0,pegNudgeDirection:Math.random()<.5?-1:1,transfer:null,feedSeconds:0,scored:false};
  dynamicObjects.push(item); coinObjects.push(item); if(tower)towerObjects.push(item); return item;
}

function seedCoinBed() {
  const verticalStep=CONFIG.coin.thickness+.006;
  for(const seed of createStartingBedPlan(Math.random)) {
    createCoin({
      x:seed.x,
      y:coinRestY+seed.layer*verticalStep,
      z:seed.z,
      flat:true,
      rotationY:seed.rotationY,
      startAsleep:true,
    });
  }
}

function createCoinStack(x,z,height) {
  const step=CONFIG.coin.thickness+.006;
  for(let layer=0;layer<height;layer++) {
    createCoin({
      x,
      y:coinRestY+layer*step,
      z,
      flat:true,
      rotationY:(layer%2)*Math.PI/6,
      tower:true,
      startAsleep:true,
    });
  }
}

// Broad stepped towers remain asleep and stable until the shared pile physically
// reaches them. Their outer stacks create a large jackpot without relying on an
// impossible single needle stack.
function createTower(cx,cz,height=18) {
  const spacing=CONFIG.coin.radius*2+.045;
  const heights=[height,height-4,height-5,8,7,5,5,4,4];
  TOWER_STACK_OFFSETS.forEach(([sx,sz],i)=>{
    createCoinStack(cx+sx*spacing,cz+sz*spacing,Math.max(3,heights[i]));
  });
}

function updateCoinCount(){ coinCountEl.textContent=coinObjects.filter(o=>o.body.world).length.toString(); }

function serializeCoin(item) {
  const b=item.body;
  return {
    id:item.id,
    tower:item.tower,
    phase:item.phase,
    scored:item.scored,
    hasReachedPusher:item.hasReachedPusher,
    pegAngle:item.pegAngle,
    pegNudgeDirection:item.pegNudgeDirection,
    pegStallSeconds:item.pegStallSeconds,
    slotIndex:Number.isInteger(item.slotIndex)?item.slotIndex:null,
    position:[b.position.x,b.position.y,b.position.z],
    quaternion:[b.quaternion.x,b.quaternion.y,b.quaternion.z,b.quaternion.w],
    velocity:[b.velocity.x,b.velocity.y,b.velocity.z],
    angularVelocity:[b.angularVelocity.x,b.angularVelocity.y,b.angularVelocity.z],
    sleeping:b.sleepState===CANNON.Body.SLEEPING,
    transfer:item.transfer?{...item.transfer}:null,
  };
}

function buildConfirmedWorldSnapshot() {
  const turn=turnController.getSnapshot();
  return createConfirmedWorldSnapshot({
    pusherTime,
    pusherZ:pusher?.z ?? CONFIG.pusher.rearZ,
    selectedCount,
    nextCoinId,
    turnProgress:{
      lifetime:turn.lifetimeCoinsWon,
      pendingMilestones:turn.pendingSkinMilestones,
      resolvedMilestones:turn.resolvedSkinMilestones,
      turnNumber:turn.nextTurnNumber,
    },
    coins:coinObjects.filter(item=>item.body.world).map(serializeCoin),
  });
}

async function persistConfirmedWorld(reason='autosave') {
  const turn=turnController.getSnapshot();
  if(!pusher || dropping || turn.state!==TURN_STATES.READY) return false;
  const generation=++saveGeneration;
  const snapshot=buildConfirmedWorldSnapshot();
  const saved=await saveConfirmedWorld(snapshot);
  if(generation===saveGeneration && saved && reason==='turn-finalized') {
    statusText.textContent=`TURN ${turn.nextTurnNumber-1} SAVED — READY FOR TURN ${turn.nextTurnNumber}`;
  }
  return saved;
}

function scheduleConfirmedWorldSave(reason='autosave',delay=120) {
  if(saveTimer) clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{
    saveTimer=null;
    void persistConfirmedWorld(reason);
  },delay);
}

function restoreCoin(saved) {
  const item=createCoin({
    x:saved.position[0],
    y:saved.position[1],
    z:saved.position[2],
    flat:saved.phase!=='peg',
    rotationY:saved.pegAngle,
    tower:saved.tower,
    startAsleep:false,
    phase:saved.phase,
    id:saved.id,
  });
  const b=item.body;
  item.scored=saved.scored;
  item.hasReachedPusher=saved.hasReachedPusher;
  item.pegAngle=saved.pegAngle;
  item.pegNudgeDirection=saved.pegNudgeDirection;
  item.pegStallSeconds=saved.pegStallSeconds;
  item.slotIndex=saved.slotIndex;
  item.transfer=saved.transfer?{...saved.transfer}:null;

  b.position.set(...saved.position);
  b.quaternion.set(...saved.quaternion);
  b.velocity.set(...saved.velocity);
  b.angularVelocity.set(...saved.angularVelocity);

  if(saved.phase==='peg') {
    b.allowSleep=false;
    b.collisionResponse=true;
    b.linearFactor.set(1,1,0);
    b.angularFactor.set(0,0,1);
  } else if(saved.phase==='transfer') {
    b.allowSleep=false;
    b.collisionResponse=false;
    b.linearFactor.set(1,1,1);
    b.angularFactor.set(.22,1,.22);
  } else {
    b.allowSleep=true;
    b.collisionResponse=true;
    b.linearFactor.set(1,1,1);
    b.angularFactor.set(.22,1,.22);
  }

  b.aabbNeedsUpdate=true;
  if(saved.sleeping && saved.phase==='board') b.sleep();
  else b.wakeUp();
  return item;
}

function clearDynamicMachine() {
  [...dynamicObjects].forEach(removeDynamic);
  towerObjects.length=0;
}

function restoreMachineSnapshot(snapshot) {
  clearDynamicMachine();
  dropSequenceToken+=1;
  dropping=false;
  lastDroppedCoin=null;
  batchFinishedSpawning=false;
  confirmedAutosaveSeconds=0;
  hideTurnResult();
  showActiveChute(-1);

  selectedCount=snapshot.selectedCount;
  dropCountEl.textContent=String(selectedCount);
  nextCoinId=1;
  snapshot.coins.forEach(restoreCoin);
  nextCoinId=Math.max(snapshot.nextCoinId,nextCoinId);

  pusherTime=snapshot.pusherTime;
  const restoredZ=Number.isFinite(snapshot.pusherZ)?snapshot.pusherZ:CONFIG.pusher.rearZ;
  pusher.z=restoredZ;
  pusher.lastZ=restoredZ;
  pusher.velocity=0;
  pusher.pushing=false;
  pusher.body.velocity.set(0,0,0);
  pusher.body.position.set(0,CONFIG.pusher.y,restoredZ);
  pusher.body.collisionResponse=true;
  pusher.body.collisionFilterMask=1;
  pusher.body.aabbNeedsUpdate=true;
  pusher.mesh.position.z=restoredZ;

  turnController.reset();
  turnController.restoreProgress(snapshot.turnProgress);
  updateCoinCount();
  syncObjects();
  statusText.textContent=`WORLD RESTORED — READY FOR TURN ${snapshot.turnProgress.turnNumber}`;
}

async function restoreOrSeedMachine() {
  const stored=normalizeWorldSnapshot(await loadConfirmedWorld());
  if(stored) {
    restoreMachineSnapshot(stored);
    return true;
  }

  await clearConfirmedWorld();
  await resetMachine({persist:false});
  await persistConfirmedWorld('initial-world');
  return false;
}

function updateConfirmedAutosave(dt) {
  const turn=turnController.getSnapshot();
  if(turn.state!==TURN_STATES.READY || dropping) {
    confirmedAutosaveSeconds=0;
    return;
  }
  confirmedAutosaveSeconds+=dt;
  if(confirmedAutosaveSeconds>=4) {
    confirmedAutosaveSeconds=0;
    scheduleConfirmedWorldSave('idle-autosave',0);
  }
}


function hideTurnResult() {
  turnResultEl.classList.add('hidden');
}

function formatYesRaw(value) {
  try {
    const raw=BigInt(String(value ?? '0'));
    const base=10n**18n;
    const whole=raw/base;
    const fraction=(raw%base).toString().padStart(18,'0').slice(0,3).replace(/0+$/,'');
    return fraction ? `${whole}.${fraction}` : String(whole);
  } catch {
    return '0';
  }
}

function applyResultCredit(record=null,integration=null) {
  resultCreditEl.classList.remove('confirmed','pending','failed');
  if(!record) {
    resultCreditEl.textContent='YES CREDIT RECORD PENDING';
    resultCreditEl.classList.add('pending');
    return;
  }
  const amount=`${formatYesRaw(record.amountYesRaw)} YES`;
  if(record.creditStatus==='confirmed') {
    resultCreditEl.textContent=`${amount} CREDIT CONFIRMED`;
    resultCreditEl.classList.add('confirmed');
  } else if(record.creditStatus==='pending') {
    resultCreditEl.textContent=`${amount} CREDIT SUBMITTING`;
    resultCreditEl.classList.add('pending');
  } else if(record.creditStatus==='failed') {
    resultCreditEl.textContent=`${amount} CREDIT RETRYING`;
    resultCreditEl.classList.add('failed');
  } else if(record.creditStatus==='recorded') {
    resultCreditEl.textContent=integration?.creditSubmissionConfigured
      ? `${amount} CREDIT RECORDED`
      : `${amount} OWED • ENDPOINT NOT CONFIGURED`;
    resultCreditEl.classList.add('pending');
  } else if(record.creditStatus==='no_payout') {
    resultCreditEl.textContent='NO YES WON THIS TURN';
  } else if(record.creditStatus==='wallet_required') {
    resultCreditEl.textContent='CONNECT WALLET FOR YES CREDIT';
    resultCreditEl.classList.add('failed');
  } else if(record.creditStatus==='local_only') {
    resultCreditEl.textContent='LOCAL FALLBACK • NO YES SETTLEMENT';
  } else {
    resultCreditEl.textContent='YES CREDIT STATUS UNAVAILABLE';
  }
}

function applyResultSkin(record=null,result=null,integration=null) {
  const earned=Boolean(result?.skinDropEarned || record?.skinDropEarned);
  if(!earned) {
    resultSkinEl.classList.add('hidden');
    resultSkinImageEl.removeAttribute('src');
    resultSkinImageEl.alt='';
    return;
  }

  const selection=record?.skinDropSelection ?? null;
  const skin=getCoinSkin(selection?.outputKey ?? selection?.selectedOutputId);
  resultSkinEl.classList.remove('hidden','pending','failed','resolved');
  resultSkinEl.classList.add(record?.skinDropStatus==='failed' ? 'failed' : record?.skinDropStatus==='submitted' ? 'resolved' : 'pending');

  const resolvedName=skin?.name ?? selection?.displayName ?? null;
  const resolvedImage=skin?.imageUrl ?? selection?.imageUrl ?? null;
  if(resolvedImage) {
    resultSkinImageEl.src=resolvedImage;
    resultSkinImageEl.alt=`${resolvedName ?? 'Random'} coin skin`;
    resultSkinImageEl.hidden=false;
  } else {
    resultSkinImageEl.removeAttribute('src');
    resultSkinImageEl.alt='';
    resultSkinImageEl.hidden=true;
  }
  resultSkinNameEl.textContent=resolvedName ? resolvedName.toUpperCase() : 'RANDOM COIN SKIN';

  if(record?.skinDropStatus==='submitted') {
    if(selection?.mintJobId) resultSkinStatusEl.textContent='NFT MINT QUEUED';
    else if(selection?.mintId) resultSkinStatusEl.textContent='NFT ISSUED';
    else if(selection?.duplicate) resultSkinStatusEl.textContent='DROP ALREADY RECORDED';
    else if(selection?.resultType==='random_resolved') resultSkinStatusEl.textContent='RANDOM OUTPUT RESOLVED';
    else resultSkinStatusEl.textContent='YOKEFELLOW DROP RECORDED';
  } else if(record?.skinDropStatus==='pending') {
    resultSkinStatusEl.textContent='YOKEFELLOW IS RESOLVING THE DROP';
  } else if(record?.skinDropStatus==='failed') {
    resultSkinStatusEl.textContent='DROP SUBMISSION RETRYING';
  } else if(record?.skinDropStatus==='disabled') {
    resultSkinStatusEl.textContent=integration?.eventSubmissionConfigured
      ? 'DROP WAITING FOR SUBMISSION'
      : 'YOKEFELLOW EVENT INTEGRATION NOT CONFIGURED';
  } else if(record?.skinDropStatus==='wallet_required') {
    resultSkinStatusEl.textContent='WALLET REQUIRED FOR NFT DROP';
  } else if(record?.skinDropStatus==='local_only') {
    resultSkinStatusEl.textContent='LOCAL MILESTONE • NFT NOT SUBMITTED';
  } else {
    resultSkinStatusEl.textContent='DROP RECORD PENDING';
  }
}

function showTurnResult(result,settlementRecord=null,integration=null) {
  resultWonEl.textContent=String(result.coinsWon);
  resultDroppedEl.textContent=String(result.coinsDropped);
  resultLifetimeEl.textContent=String(result.lifetimeCoinsWon);
  if(result.skinDropEarned) {
    resultMilestoneEl.textContent=result.pendingSkinMilestones
      ? `SKIN DROP EARNED • ${result.pendingSkinMilestones} PENDING`
      : 'SKIN DROP EARNED';
    resultMilestoneEl.classList.add('earned');
  } else if(result.pendingSkinMilestones) {
    resultMilestoneEl.textContent=`${result.pendingSkinMilestones} SKIN DROP${result.pendingSkinMilestones===1?'':'S'} PENDING`;
    resultMilestoneEl.classList.add('earned');
  } else {
    const remainder=result.lifetimeCoinsWon%50;
    resultMilestoneEl.textContent=`${50-remainder} COINS TO NEXT SKIN`;
    resultMilestoneEl.classList.remove('earned');
  }
  applyResultSkin(settlementRecord,result,integration);
  applyResultCredit(settlementRecord,integration);
  turnResultEl.classList.remove('hidden');
}

function renderWalletSession(session=walletAuth?.session ?? null) {
  const connected=Boolean(session?.authenticated && session?.wallet);
  walletStatusEl.textContent=connected
    ? `${session.wallet.slice(0,6)}…${session.wallet.slice(-4)}`
    : walletAuth?.available
      ? 'WALLET NOT CONNECTED'
      : 'NO BROWSER WALLET';
  walletStatusEl.classList.toggle('connected',connected);
  walletButton.textContent=connected ? 'DISCONNECT' : 'CONNECT';
  walletButton.classList.toggle('disconnect',connected);
  walletButton.disabled=walletCommandPending || (!connected && !walletAuth?.available);
}

function setConnectionState({ connected = false, reconnecting = false, mode = 'offline', error = null, url = '' } = {}) {
  statusDot.classList.toggle('connecting', !connected && reconnecting);
  statusDot.classList.toggle('offline', !connected && !reconnecting);
  statusDot.dataset.transport = connected ? mode : 'offline';
  statusText.title = error
    ? `${error instanceof Error ? error.message : String(error)}${url ? `
${url}` : ''}`
    : '';
  if (!connected && sharedMode) {
    queueButton.disabled = true;
    let failedPath = '';
    try { failedPath = url ? new URL(url, location.href).pathname.toUpperCase() : ''; } catch { failedPath = ''; }
    statusText.textContent = error
      ? `SHARED SERVER ERROR${failedPath ? ` — ${failedPath}` : ''}`
      : reconnecting
        ? 'RECONNECTING TO SHARED MACHINE'
        : 'SHARED MACHINE OFFLINE';
  }
}

function sharedDropRequestReady(snapshot = sharedSnapshot) {
  const walletRequired = Boolean(snapshot?.auth?.requireWallet);
  const walletAuthenticated = Boolean(snapshot?.self?.authenticated);
  return Boolean(
    sharedClient?.connected &&
    !sharedCommandPending &&
    !snapshot?.self?.queued &&
    (!walletRequired || walletAuthenticated)
  );
}

function renderSharedSnapshot(snapshot) {
  if (!sharedMode || !snapshot) return;
  sharedSnapshot = snapshot;
  sharedView?.applySnapshot(snapshot);

  const turn = snapshot.turn;
  const active = snapshot.queue?.[0] ?? null;
  const self = snapshot.self;
  const canRequestDrop = sharedDropRequestReady(snapshot);

  scoreEl.textContent = String(turn?.displayedLifetimeCoinsWon ?? 0);
  turnScoreEl.textContent = String(turn?.currentTurn?.coinsWon ?? 0);
  turnNumberEl.textContent = String(turn?.currentTurn?.number ?? turn?.nextTurnNumber ?? 1);
  skinProgressEl.textContent = turn?.pendingSkinMilestones
    ? `${turn.pendingSkinMilestones} PENDING`
    : `${turn?.milestoneProgress ?? 0} / ${turn?.milestoneEvery ?? 50}`;
  coinCountEl.textContent = String(snapshot.coinCount ?? snapshot.coins?.length ?? 0);

  if ([TURN_STATES.DROPPING, TURN_STATES.WAITING, TURN_STATES.ACTIVE].includes(turn?.state)) turnTimerEl.textContent = formatTurnSeconds(turn.activeSecondsRemaining);
  else if (turn?.state === TURN_STATES.FINISHING) turnTimerEl.textContent = 'CYCLE';
  else if (turn?.state === TURN_STATES.SETTLING) turnTimerEl.textContent = 'SETTLE';
  else turnTimerEl.textContent = '—';

  activePlayerNameEl.textContent = active?.label ?? 'NO PLAYER QUEUED';
  const walletRequired=Boolean(snapshot.auth?.requireWallet);
  const walletAuthenticated=Boolean(self?.authenticated);
  queueStatusEl.classList.toggle('active', Boolean(self?.isActive));
  if(walletRequired && !walletAuthenticated) queueStatusEl.textContent='CONNECT WALLET TO DROP';
  else if (self?.isActive) queueStatusEl.textContent = turn?.state === TURN_STATES.READY ? 'STARTING YOUR TURN' : 'YOUR TURN RUNNING';
  else if (self?.queued) queueStatusEl.textContent = `QUEUE POSITION ${self.queuePosition} • ${self.queuedCoins ?? 5} COINS`;
  else queueStatusEl.textContent = snapshot.queue?.length
    ? `PRESS DROP TO JOIN • ${snapshot.queue.length} WAITING`
    : 'PRESS DROP TO JOIN';

  queueButton.textContent = 'LEAVE QUEUE';
  queueButton.classList.toggle('leave', true);
  queueButton.hidden = !self?.queued || Boolean(self?.isActive);
  queueButton.disabled = sharedCommandPending || !sharedClient?.connected;
  dropButton.textContent = self?.queued ? 'QUEUED' : 'DROP COINS';
  dropButton.disabled = !canRequestDrop;
  minusButton.disabled = !canRequestDrop;
  plusButton.disabled = !canRequestDrop;
  resetMachineButton.disabled = true;
  showActiveChute(Number.isInteger(snapshot.activeSlotIndex) ? snapshot.activeSlotIndex : -1);
  const transportNote = sharedClient?.connectionMode === 'polling' ? ' — FALLBACK SYNC' : '';
  statusText.textContent = `${snapshot.status ?? 'SHARED MACHINE RUNNING'}${transportNote}`;

  const result = turn?.lastResult;
  const settlementRecord=snapshot.settlement?.last?.id===result?.id ? snapshot.settlement.last : null;
  const settlementIntegration=snapshot.settlement?.integration ?? null;
  if (result?.id && result.id !== lastSharedResultId) {
    lastSharedResultId = result.id;
    showTurnResult(result,settlementRecord,settlementIntegration);
  } else if(result?.id && result.id===lastSharedResultId) {
    applyResultSkin(settlementRecord,result,settlementIntegration);
    applyResultCredit(settlementRecord,settlementIntegration);
  }
  if (turn?.currentTurn?.id && turn.currentTurn.id !== lastSharedResultId) hideTurnResult();
}

async function leaveSharedQueue() {
  if (!sharedMode || !sharedClient || sharedCommandPending || !sharedSnapshot?.self?.queued) return;
  sharedCommandPending = true;
  queueButton.disabled = true;
  try {
    await sharedClient.leaveQueue();
  } catch (error) {
    statusText.textContent = error instanceof Error ? error.message.toUpperCase() : 'QUEUE COMMAND FAILED';
  } finally {
    sharedCommandPending = false;
    renderSharedSnapshot(sharedClient.snapshot ?? sharedSnapshot);
  }
}

async function queueSharedTurn() {
  if (!sharedDropRequestReady()) return;
  sharedCommandPending = true;
  renderSharedSnapshot(sharedSnapshot);
  hideTurnResult();
  try {
    await sharedClient.joinQueue(selectedCount);
  } catch (error) {
    statusText.textContent = error instanceof Error ? error.message.toUpperCase() : 'DROP REQUEST COULD NOT BE QUEUED';
  } finally {
    sharedCommandPending = false;
    renderSharedSnapshot(sharedClient.snapshot ?? sharedSnapshot);
  }
}

async function toggleWalletConnection() {
  if(!walletAuth || walletCommandPending) return;
  walletCommandPending=true;
  renderWalletSession();
  try {
    const session=walletAuth.session
      ? await walletAuth.disconnect()
      : await walletAuth.connect();
    if(sharedMode && sharedClient) {
      setConnectionState({connected:false,reconnecting:true});
      await sharedClient.reconnectWithSession(session);
      setConnectionState({connected:true});
      renderSharedSnapshot(sharedClient.snapshot);
    }
  } catch(error) {
    statusText.textContent=error instanceof Error ? error.message.toUpperCase() : 'WALLET CONNECTION FAILED';
  } finally {
    walletCommandPending=false;
    renderWalletSession();
  }
}

function scheduleInitialSharedReconnect() {
  if (!sharedClient || sharedClient.connected || sharedInitialReconnectTimer) return;
  sharedInitialReconnectTimer = setTimeout(async () => {
    sharedInitialReconnectTimer = null;
    if (!sharedMode || !sharedClient || sharedClient.connected) return;
    setConnectionState({ connected: false, reconnecting: true });
    statusText.textContent = `WAITING FOR SHARED SERVER${WORLD_SERVER_ORIGIN ? ` — ${WORLD_SERVER_ORIGIN}` : ''}`;
    try {
      const snapshot = await sharedClient.resume();
      if (!snapshot || !sharedClient.connected) {
        throw sharedClient.lastError ?? new Error('The shared machine has not returned a world snapshot yet');
      }
      setConnectionState({ connected: true, mode: sharedClient.connectionMode });
      renderSharedSnapshot(snapshot);
    } catch (error) {
      console.error('Shared world reconnect failed', error);
      setConnectionState({
        connected: false,
        reconnecting: true,
        error,
        url: sharedClient.lastFailedUrl || `${WORLD_SERVER_ORIGIN}/api/world`,
      });
      scheduleInitialSharedReconnect();
    }
  }, 1_500);
}

async function initializeSharedWorld() {
  walletAuth = new WalletAuthClient({
    onChange: (session, reason) => {
      renderWalletSession(session);
      if(reason==='accounts-changed' && sharedMode && sharedClient && !walletCommandPending) {
        setConnectionState({connected:false,reconnecting:true});
        void sharedClient.reconnectWithSession(session)
          .then(()=>setConnectionState({connected:true}))
          .catch((error)=>{
            console.error('Could not refresh shared identity after wallet account change',error);
            setConnectionState({connected:false,reconnecting:false});
          });
      }
    },
  });
  const restoredWalletSession=await walletAuth.restore();
  renderWalletSession(restoredWalletSession);

  sharedView = new SharedWorldView({
    scene,
    coinGeometry,
    coinMaterials: coinMats,
    pusherMesh: pusher.mesh,
  });
  sharedClient = new SharedWorldClient({
    onSnapshot: renderSharedSnapshot,
    onConnection: setConnectionState,
    onError: (error, details = {}) => {
      console.error('Shared world client error', details.url ?? '', error);
      if (!sharedClient?.connected) {
        setConnectionState({ connected: false, reconnecting: true, error, url: details.url ?? '' });
      }
    },
  });
  sharedClient.useSession(restoredWalletSession);

  sharedMode = true;
  document.body.classList.add('shared-mode');
  resetMachineButton.title = 'The authoritative shared world can only be reset by the server operator.';
  setConnectionState({ connected: false, reconnecting: true });
  if (hostedFrontend && !WORLD_SERVER_IS_REMOTE) {
    statusText.textContent = 'VITE_WORLD_SERVER_URL IS MISSING FROM THIS VERCEL BUILD';
    activePlayerNameEl.textContent = 'SHARED MACHINE';
    queueStatusEl.textContent = 'SERVER URL NOT CONFIGURED';
    queueButton.hidden = false;
    walletButton.disabled = true;
    walletButton.title = 'Add VITE_WORLD_SERVER_URL in Vercel and redeploy.';
    resetMachineButton.disabled = true;
    return true;
  }
  try {
    await sharedClient.connect();
    setConnectionState({ connected: true });
    renderSharedSnapshot(sharedClient.snapshot);
    return true;
  } catch (error) {
    if (WORLD_SERVER_IS_REMOTE) {
      console.warn('Shared world is temporarily unavailable; staying in authoritative mode and retrying.', error);
      setConnectionState({ connected: false, reconnecting: true });
      statusText.textContent = `WAITING FOR SHARED SERVER — ${WORLD_SERVER_ORIGIN}`;
      activePlayerNameEl.textContent = 'SHARED MACHINE';
      queueStatusEl.textContent = 'SERVER RECONNECTING';
      queueButton.hidden = false;
      walletButton.title = '';
      resetMachineButton.disabled = true;
      scheduleInitialSharedReconnect();
      return true;
    }

    console.warn('No remote world server is configured; using confirmed local mode.', error);
    sharedClient.close();
    sharedClient = null;
    sharedView.clear();
    sharedView = null;
    sharedSnapshot = null;
    sharedMode = false;
    document.body.classList.remove('shared-mode');
    statusDot.classList.remove('connecting', 'offline');
    activePlayerNameEl.textContent = 'LOCAL PLAYER';
    queueStatusEl.textContent = 'LOCAL CONFIRMED WORLD';
    queueButton.hidden = true;
    walletButton.disabled = true;
    walletButton.title = 'Wallet identity requires the shared-world server.';
    walletStatusEl.textContent = 'LOCAL MODE';
    resetMachineButton.disabled = false;
    resetMachineButton.title = '';
    return false;
  }
}

function renderTurnSnapshot(snapshot, reason) {
  if(sharedMode) return;
  scoreEl.textContent=String(snapshot.displayedLifetimeCoinsWon);
  turnScoreEl.textContent=String(snapshot.currentTurn?.coinsWon ?? 0);
  turnNumberEl.textContent=String(snapshot.currentTurn?.number ?? snapshot.nextTurnNumber);
  skinProgressEl.textContent=snapshot.pendingSkinMilestones
    ? `${snapshot.pendingSkinMilestones} PENDING`
    : `${snapshot.milestoneProgress} / ${snapshot.milestoneEvery}`;

  if([TURN_STATES.DROPPING,TURN_STATES.WAITING,TURN_STATES.ACTIVE].includes(snapshot.state)) turnTimerEl.textContent=formatTurnSeconds(snapshot.activeSecondsRemaining);
  else if(snapshot.state===TURN_STATES.FINISHING) turnTimerEl.textContent='CYCLE';
  else if(snapshot.state===TURN_STATES.SETTLING) turnTimerEl.textContent='SETTLE';
  else turnTimerEl.textContent='—';

  const ready=snapshot.state===TURN_STATES.READY;
  dropButton.disabled=!ready;
  minusButton.disabled=!ready;
  plusButton.disabled=!ready;

  if(reason==='turn-started') statusText.textContent=`TURN ${snapshot.currentTurn.number} — 30 SECOND TURN`;
  else if(reason==='active-window-ended') statusText.textContent='FINISHING CURRENT PUSHER CYCLE';
  else if(reason==='settling-started') statusText.textContent='SETTLING FINAL PAYOUTS';
  else if(reason==='turn-finalized') {
    statusText.textContent=`TURN ${snapshot.lastResult.number} COMPLETE — SAVING WORLD`;
    showTurnResult(snapshot.lastResult,{ creditStatus:'local_only', amountYesRaw:'0' },null);
    scheduleConfirmedWorldSave('turn-finalized',120);
  }
}

function showActiveChute(index) {
  slotIndicators.forEach((el,i)=>el.classList.toggle('active',i===index));
}

function wakeMachineCoins() {
  // Do not wake the whole bed for every drop. Contact from the pusher or a new
  // coin wakes only the part of the pile that is actually moving.
}

async function dropBatch() {
  const turnSnapshot=turnController.getSnapshot();
  if(dropping || turnSnapshot.state!==TURN_STATES.READY) return;

  const sequenceToken=++dropSequenceToken;
  const slotPlan=makeRandomSlotPlan(CONFIG.slots.length, selectedCount);
  hideTurnResult();
  turnController.startTurn({coinsDropped:selectedCount,slotPlan});

  dropping=true;
  batchFinishedSpawning=false;
  lastDroppedCoin=null;
  dropButton.disabled=true;
  wakeMachineCoins();

  for(let i=0;i<selectedCount;i++) {
    if(sequenceToken!==dropSequenceToken) return;
    const slotIndex=slotPlan[i];
    const x=CONFIG.slots[slotIndex];
    showActiveChute(slotIndex);
    statusText.textContent=`TURN ${turnController.getSnapshot().currentTurn.number} — INSERTING COIN ${i+1} OF ${selectedCount}`;

    const rollDirection=Math.random()<.5?-1:1;
    const coin=createCoin({
      // Each coin receives its own shuffled random lane and enters alone.
      x:x+(Math.random()-.5)*.10,
      y:10.72,
      z:CONFIG.peg.z,
      flat:false,
      rotationY:Math.random()*Math.PI*2,
      phase:'peg',
    });
    coin.slotIndex=slotIndex;
    coin.body.velocity.set(rollDirection*(.08+Math.random()*.10),-.20,0);
    coin.body.angularVelocity.set(0,0,rollDirection*(1.15+Math.random()*.45));
    lastDroppedCoin=coin;

    if(i<selectedCount-1) {
      await new Promise(r=>setTimeout(r,CONFIG.dropIntervalMs));
      if(sequenceToken!==dropSequenceToken) return;
    }
  }

  if(sequenceToken!==dropSequenceToken) return;
  batchFinishedSpawning=true;
  dropping=false;
  turnController.markBatchFinished();
  showActiveChute(-1);
  updateCoinCount();
  statusText.textContent='BATCH INSERTED — PUSHING';
}

function createUI() {
  const slots=document.querySelector('#slots');
  CONFIG.slots.forEach((_,i)=>{
    const indicator=document.createElement('span');
    indicator.className='slot-indicator';
    indicator.textContent=String(i+1);
    indicator.setAttribute('aria-label',`Random chute ${i+1}`);
    slots.appendChild(indicator);
    slotIndicators.push(indicator);
  });
  minusButton.onclick=()=>{
    if(sharedMode) {
      if(!sharedDropRequestReady()) return;
    } else if(turnController.getSnapshot().state!==TURN_STATES.READY) return;
    selectedCount=Math.max(1,selectedCount-1);
    dropCountEl.textContent=selectedCount;
  };
  plusButton.onclick=()=>{
    if(sharedMode) {
      if(!sharedDropRequestReady()) return;
    } else if(turnController.getSnapshot().state!==TURN_STATES.READY) return;
    selectedCount=Math.min(10,selectedCount+1);
    dropCountEl.textContent=selectedCount;
  };
  dropButton.onclick=()=>{ if(sharedMode) void queueSharedTurn(); else void dropBatch(); };
  queueButton.onclick=()=>{ void leaveSharedQueue(); };
  walletButton.onclick=()=>{ void toggleWalletConnection(); };
  document.querySelector('#resetCamera').onclick=()=>{camera.position.copy(defaultCamera.position);controls.target.copy(defaultCamera.target);controls.update();};
  resetMachineButton.onclick=()=>{ if(!sharedMode) void resetMachine(); };
}

function removeDynamic(item) {
  scene.remove(item.mesh); world.removeBody(item.body);
  const i=dynamicObjects.indexOf(item); if(i>=0)dynamicObjects.splice(i,1);
  const c=coinObjects.indexOf(item); if(c>=0)coinObjects.splice(c,1);
  const t=towerObjects.indexOf(item); if(t>=0)towerObjects.splice(t,1);
}

async function resetMachine({persist=true}={}) {
  saveGeneration+=1;
  if(saveTimer) { clearTimeout(saveTimer); saveTimer=null; }
  dropSequenceToken+=1;
  clearDynamicMachine();
  pusherTime=0;
  nextCoinId=1;
  confirmedAutosaveSeconds=0;
  dropping=false;
  lastDroppedCoin=null;
  batchFinishedSpawning=false;
  turnController.reset();
  pusher.z=CONFIG.pusher.rearZ; pusher.lastZ=CONFIG.pusher.rearZ; pusher.velocity=0; pusher.pushing=false;
  pusher.body.velocity.set(0,0,0);
  pusher.body.position.set(0,CONFIG.pusher.y,CONFIG.pusher.rearZ);
  pusher.body.collisionResponse=true;
  pusher.body.collisionFilterMask=1;
  pusher.body.aabbNeedsUpdate=true;
  pusher.mesh.position.z=CONFIG.pusher.rearZ;
  seedCoinBed();
  TOWER_LAYOUT.forEach(t=>createTower(t.x,t.z,t.height));
  updateCoinCount();
  dropButton.disabled=false;
  turnTimerEl.textContent='—';
  showActiveChute(-1);
  hideTurnResult();
  statusText.textContent='READY — CHOOSE 1–10 COINS';
  if(persist) {
    await clearConfirmedWorld();
    await persistConfirmedWorld('machine-reset');
  }
}

function markCoinReachedPusher(item) {
  if(item.hasReachedPusher) return;
  item.hasReachedPusher=true;
  if(item===lastDroppedCoin && batchFinishedSpawning) turnController.markFinalCoinReached();
}

function beginReceivingTransfer(item) {
  if(item.phase!=='peg') return;
  const b=item.body;
  // Side containment is physical now. Preserve the coin's actual X position;
  // the transition only changes its orientation and depth, never teleports it sideways.
  const targetX=b.position.x;
  item.phase='transfer';
  item.transfer={
    elapsed:0,
    duration:.48,
    fromX:b.position.x,
    fromY:b.position.y,
    fromZ:b.position.z,
    targetX,
    targetY:pusherCoinRestY+.14,
    targetZ:CONFIG.pusher.wallZ+.78,
    yaw:Math.random()*Math.PI*2,
  };
  b.allowSleep=false;
  b.wakeUp();
  b.collisionResponse=false;
  b.velocity.set(0,0,0);
  b.angularVelocity.set(0,0,0);
}

function updatePegCoins(dt) {
  for(const item of coinObjects) {
    const b=item.body;
    if(item.phase==='peg') {
      // The glass channel keeps the coin face-flat. It can roll and spin in the X/Y
      // plane, but it cannot tumble forward or backward out of the Plinko board.
      b.position.z=CONFIG.peg.z;
      b.velocity.z=0;
      b.angularVelocity.x=0;
      b.angularVelocity.y=0;
      item.pegAngle += b.angularVelocity.z*dt;
      setPegCoinOrientation(b,item.pegAngle);

      // A perfectly balanced coin can sit on a single peg in a simplified physics
      // engine. Do not let it sleep in the peg field; after a brief true stall, give
      // it the smallest sideways roll needed to continue naturally through the gaps.
      const pegSpeed=Math.hypot(b.velocity.x,b.velocity.y);
      if(pegSpeed<.12 && b.position.y>CONFIG.peg.exitY) {
        item.pegStallSeconds+=dt;
        if(item.pegStallSeconds>.24) {
          b.velocity.x+=item.pegNudgeDirection*(.26+Math.random()*.08);
          b.velocity.y-=.085;
          b.angularVelocity.z+=item.pegNudgeDirection*.35;
          item.pegNudgeDirection*=-1;
          item.pegStallSeconds=0;
        }
      } else {
        item.pegStallSeconds=0;
      }

      // After the final peg row, use the enclosed curved throat only to rotate
      // the face-flat Plinko coin onto the horizontal shelf. Side-to-side motion
      // remains physical and is never rewritten.
      if(b.position.y<CONFIG.peg.exitY) {
        const receivingHalfWidth=CONFIG.pusher.width/2-CONFIG.coin.radius-.12;
        if(Math.abs(b.position.x)<=receivingHalfWidth) {
          beginReceivingTransfer(item);
        } else {
          // Stay in real physics until the angled glass rail guides the coin into
          // the open throat. This is an inward roll, not a position correction.
          b.velocity.x += -Math.sign(b.position.x)*1.15*dt;
          b.velocity.y = Math.min(b.velocity.y,-.18);
          b.wakeUp();
        }
      }
    }

    if(item.phase==='transfer' && item.transfer) {
      const tr=item.transfer;
      tr.elapsed=Math.min(tr.duration,tr.elapsed+dt);
      const raw=tr.elapsed/tr.duration;
      const eased=raw*raw*(3-2*raw);
      const arc=Math.sin(raw*Math.PI)*.12;
      b.position.set(
        THREE.MathUtils.lerp(tr.fromX,tr.targetX,eased),
        THREE.MathUtils.lerp(tr.fromY,tr.targetY,eased)-arc,
        THREE.MathUtils.lerp(tr.fromZ,tr.targetZ,eased),
      );
      b.quaternion.setFromEuler((1-eased)*Math.PI/2,tr.yaw*eased,0);
      b.velocity.set(0,0,0);
      b.angularVelocity.set(0,0,0);
      if(raw>=1) {
        // Release immediately from the enclosed chute. If the moving shelf is
        // underneath, the coin lands on it. If it is retracted, the coin falls
        // onto the receiving floor and waits there physically for the next push.
        // Nothing hovers or waits for the pusher to arrive.
        item.transfer=null;
        item.phase='board';
        b.collisionResponse=true;
        b.allowSleep=true;
        b.linearDamping=.11;
        b.angularDamping=.25;
        b.linearFactor.set(1,1,1);
        b.angularFactor.set(.22,1,.22);
        b.position.set(tr.targetX,tr.targetY,tr.targetZ);
        b.quaternion.setFromEuler(0,tr.yaw,0);
        b.velocity.set(0,-.10,Math.max(.06,pusher.velocity));
        b.angularVelocity.set(0,(Math.random()-.5)*.18,0);
        b.wakeUp();
        markCoinReachedPusher(item);
      }
    }
  }
}

function updateTurn(dt) {
  turnController.update(dt,{
    pusherTime,
    pusherPeriod:CONFIG.pusher.period,
  });
}

function updatePusher(dt) {
  // The shared machine always cycles. The moving body is the complete flat upper
  // shelf: coins may ride on top, while its thick normal front face pushes coins
  // already resting on the lower fixed board.
  let nextTime=pusherTime+dt;
  nextTime=turnController.limitPusherTime(nextTime);
  pusherTime=nextTime;
  const t=(pusherTime%CONFIG.pusher.period)/CONFIG.pusher.period;

  // Shorter forward stroke, small pressure hold, then a controlled retraction.
  // The shelf's depth is longer than the travel, keeping the mechanism visually
  // continuous while the scraper leaves coins on the fixed board.
  let progress;
  if(t<.43) {
    progress=t/.43;
  } else if(t<.52) {
    progress=1;
  } else if(t<.92) {
    const u=(t-.52)/.40;
    progress=1-u*u*(3-2*u);
  } else {
    progress=0;
  }

  const z=THREE.MathUtils.lerp(CONFIG.pusher.rearZ,CONFIG.pusher.frontZ,progress);
  pusher.velocity=(z-pusher.z)/Math.max(dt,.0001);
  pusher.lastZ=pusher.z;
  pusher.z=z;
  pusher.pushing=pusher.velocity>.002 || (progress>.998 && t<.52);

  pusher.body.collisionResponse=true;
  pusher.body.collisionFilterMask=1;
  pusher.body.velocity.set(0,0,pusher.velocity);
  pusher.body.position.set(0,CONFIG.pusher.y,z);
  pusher.body.aabbNeedsUpdate=true;
  pusher.body.wakeUp();
  pusher.mesh.position.z=z;

  // Wake only coins physically over or just ahead of the moving shelf. Sleeping
  // towers and distant payout coins remain cheap until pressure reaches them.
  const rearEdge=z-CONFIG.pusher.depth/2;
  const frontEdge=z+CONFIG.pusher.depth/2;
  for(const item of coinObjects) {
    if(item.phase!=='board' || !item.body.world) continue;
    const b=item.body;
    if(Math.abs(b.position.x)<CONFIG.pusher.width/2+CONFIG.coin.radius &&
       b.position.z>rearEdge-.20 && b.position.z<frontEdge+1.05) {
      b.wakeUp();
    }
  }

  turnController.notifyPusherTime(pusherTime);
}

function assistForwardPressure(dt) {
  if(pusher.velocity<=.05) return;
  const frontEdge=pusher.z+CONFIG.pusher.depth/2;
  for(const item of coinObjects) {
    if(item.phase!=='board' || !item.body.world) continue;
    const b=item.body;

    if(Math.abs(b.position.x)>=CONFIG.pusher.width/2+CONFIG.coin.radius ||
       b.position.y>=boardTopY+.34 || b.position.y<=boardTopY-.12 ||
       b.position.z<=frontEdge-CONFIG.coin.radius*.85 || b.position.z>=frontEdge+1.05) continue;

    const distance=Math.max(0,b.position.z-frontEdge);
    const pressure=Math.max(.20,1-distance/1.05);
    const targetForwardSpeed=Math.min(.44,.20+pusher.velocity*.24);
    if(b.velocity.z<targetForwardSpeed) {
      b.velocity.z=Math.min(targetForwardSpeed,b.velocity.z+.95*pressure*dt);
      b.wakeUp();
    }
  }
}

function stabilizeBoardCoins(dt) {
  const damping=Math.exp(-5.2*dt);
  for(const item of coinObjects) {
    if(item.phase!=='board') continue;
    const b=item.body;
    // Only tame upward impulses while a coin is still in the machine. Falling
    // through a scoring edge remains untouched.
    if(b.position.y<boardTopY+.70 && b.position.y>boardTopY-.18) {
      if(b.velocity.y>.42) b.velocity.y=.42;
      b.angularVelocity.x*=damping;
      b.angularVelocity.z*=damping;
    }
  }
}

function checkScoring() {
  // Register a payout when a coin has actually begun falling across the front
  // edge. The previous trigger sat half a unit beyond the board and below the
  // cabinet, so coins could visibly fall into the gap without ever being counted.
  const frontReleaseZ=CONFIG.board.front-.025;
  const frontDropStartZ=CONFIG.board.front-CONFIG.coin.radius*.55;
  const frontDropY=coinRestY-.035;
  const frontSpan=CONFIG.board.width/2+CONFIG.coin.radius*.20;

  let removedAny=false;
  for(const item of [...coinObjects]) {
    const p=item.body.position;
    const crossedFrontEdge=item.phase==='board' &&
      Math.abs(p.x)<=frontSpan &&
      (p.z>=frontReleaseZ || (p.z>frontDropStartZ && p.y<frontDropY));

    if(!item.scored && crossedFrontEdge) {
      item.scored=true;
      turnController.recordPayout(1);

      // Do not remove the coin at the scoring line. Let it remain visible as it
      // falls over the front artwork, then collect it below the cabinet.
      item.body.linearDamping=.035;
      item.body.angularDamping=.10;
      item.body.wakeUp();
    }

    if(item.scored) {
      if(p.y<-2.7 || p.z>CONFIG.board.front+3.0) { removeDynamic(item); removedAny=true; }
      continue;
    }

    // Side drains and escaped rear objects are losses, not front payouts.
    if((Math.abs(p.x)>6.2 || p.y<-3 || p.z<-9) && p.y<.2) {
      turnController.recordLoss(1);
      removeDynamic(item);
      removedAny=true;
    }
  }
  if(removedAny) updateCoinCount();
}

function syncObjects() {
  for(const {mesh,body} of dynamicObjects) { mesh.position.copy(body.position); mesh.quaternion.copy(body.quaternion); }
}

function applyRenderSize() {
  renderer.setPixelRatio(renderPixelRatio);
  renderer.setSize(innerWidth, innerHeight, false);
}

function updateAdaptiveRenderQuality(dt) {
  if (document.visibilityState === 'hidden' || dt <= 0) return;
  qualitySampleSeconds += dt;
  qualitySampleFrames += 1;
  if (qualitySampleSeconds < 2.5) return;

  const averageFrameSeconds = qualitySampleSeconds / Math.max(1, qualitySampleFrames);
  const maximum = Math.min(devicePixelRatio || 1, MAX_RENDER_PIXEL_RATIO);
  let next = renderPixelRatio;
  if (averageFrameSeconds > 0.024 && renderPixelRatio > MIN_RENDER_PIXEL_RATIO) {
    next = Math.max(MIN_RENDER_PIXEL_RATIO, renderPixelRatio - 0.1);
  } else if (averageFrameSeconds < 0.0175 && renderPixelRatio < maximum) {
    next = Math.min(maximum, renderPixelRatio + 0.05);
  }

  if (Math.abs(next - renderPixelRatio) > 0.001) {
    renderPixelRatio = next;
    applyRenderSize();
  }
  qualitySampleSeconds = 0;
  qualitySampleFrames = 0;
}

async function init() {
  textures = await loadTextures();
  coinMats = [
    new THREE.MeshStandardMaterial({color:0xd6941b,metalness:.9,roughness:.2,emissive:0x4a2600,emissiveIntensity:.16}),
    new THREE.MeshStandardMaterial({map:textures.coinFront,metalness:.65,roughness:.24,emissive:0x221500,emissiveIntensity:.20}),
    new THREE.MeshStandardMaterial({map:textures.coinBack,metalness:.65,roughness:.24,emissive:0x221500,emissiveIntensity:.20}),
  ];
  addLightRig(colors);
  createCabinet({
    scene,
    textures,
    config: CONFIG,
    colors,
    boardTopY,
    addStaticBox,
    neonStrip,
    performanceMode: HOSTED_PERFORMANCE_MODE,
  });
  createPegBoard({
    scene,
    world,
    textures,
    config: CONFIG,
    colors,
    materials: MAT,
    addStaticBox,
    addVisualBox,
    neonStrip,
    performanceMode: HOSTED_PERFORMANCE_MODE,
  });
  pusher = buildPusher({
    scene,
    world,
    config: CONFIG,
    materials: MAT,
    colors,
    pusherTopY,
    addStaticBox,
  });
  createUI();
  const connectedToSharedWorld=await initializeSharedWorld();
  if(!connectedToSharedWorld) await restoreOrSeedMachine();
  lastTime=performance.now();
  loading.classList.add('hidden');
  animate();
}

function animate(now=performance.now()) {
  requestAnimationFrame(animate);
  const dt=Math.min((now-lastTime)/1000,.033); lastTime=now;
  if(sharedMode) {
    sharedView?.update(dt);
  } else {
    updatePusher(dt);
    world.step(1/60,dt,2);
    assistForwardPressure(dt);
    updatePegCoins(dt);
    stabilizeBoardCoins(dt);
    syncObjects();
    // Count a front exit before the final settle frame can close the turn.
    checkScoring();
    updateTurn(dt);
    updateConfirmedAutosave(dt);
  }
  controls.update();
  updateAdaptiveRenderQuality(dt);
  renderer.render(scene,camera);
}

addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderPixelRatio=Math.min(renderPixelRatio,Math.min(devicePixelRatio||1,MAX_RENDER_PIXEL_RATIO));applyRenderSize();});
addEventListener('pagehide',(event)=>{
  if(event.persisted) return;
  if(sharedMode) sharedClient?.close();
  else void persistConfirmedWorld('page-hide');
  walletAuth?.destroy();
});

async function resumeSharedWorldNow() {
  if(!sharedMode || !sharedClient) return;
  setConnectionState({ connected: sharedClient.connected, reconnecting: !sharedClient.connected, mode: sharedClient.connectionMode });
  try {
    await sharedClient.resume();
    if(sharedClient.snapshot) renderSharedSnapshot(sharedClient.snapshot);
  } catch(error) {
    console.error('Shared world resume failed',error);
    setConnectionState({
      connected:false,
      reconnecting:true,
      error,
      url: sharedClient.lastFailedUrl,
    });
  }
}

document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='hidden' && !sharedMode) {
    void persistConfirmedWorld('visibility-hidden');
    return;
  }
  if(document.visibilityState==='visible' && sharedMode) void resumeSharedWorldNow();
});
addEventListener('pageshow',()=>{ if(sharedMode) void resumeSharedWorldNow(); });
addEventListener('online',()=>{ if(sharedMode) void resumeSharedWorldNow(); });
init();
