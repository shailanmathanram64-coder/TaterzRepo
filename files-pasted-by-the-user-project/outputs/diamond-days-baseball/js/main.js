import * as THREE from 'three';
import { createBaseballWorld, createRenderer, distanceToSegment, batWorldSegment } from './field.js';
import { TEAMS, FIELD, loadSettings, saveSettings } from './config.js';
import { BaseballGameState, fairBallAt } from './rules.js';
import { planFieldingPlay, decideGroundPlay, BASE_RUN_SPEED } from './fielding.js';
import { PhoneBridge, PHONE_EDGE_TARGET as EDGE_UP_PHONE_ORIENTATION } from './phone.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game-canvas');
const NEXT_PITCH_READY_SECONDS = 3.5;
const NEXT_BATTER_READY_SECONDS = 6.1;
const BAT_CONTACT_TOLERANCE = 1.05;
const scene = new THREE.Scene();
let renderer;
let world;
let phonePreview = null;
const PHONE_EDGE_TARGET = new THREE.Quaternion(
  EDGE_UP_PHONE_ORIENTATION.x,
  EDGE_UP_PHONE_ORIENTATION.y,
  EDGE_UP_PHONE_ORIENTATION.z,
  EDGE_UP_PHONE_ORIENTATION.w,
);
let state = null;
const humanTeam = TEAMS[0];
const cpuTeam = TEAMS[1];
let settings = { ...loadSettings(), motion: true };
let phoneBridge;
let phonePose = null;
let activePlayers = null;
let gameMode = 'menu';
let currentPitch = null;
let battedBall = null;
let runnerPlay = null;
let pendingRoleChange = false;
let presentationCameraMode = 'batting';
let cameraLookTarget = new THREE.Vector3(0, 1.45, FIELD.moundZ);
const cameraDesiredPosition = new THREE.Vector3();
const cameraDesiredLook = new THREE.Vector3();
const cameraDirection = new THREE.Vector3();
const cameraSide = new THREE.Vector3();
let swing = null;
let nextActionAt = 0;
let playResultAt = 0;
let calloutTimer = 0;
let clock = 0;
let lastFrame = performance.now();
let aimPoint = { x: 0, y: 1.15 };
let reticleVisible = false;
let ballTrail = [];
let shake = 0;
let gamePaused = false;
let persistentCallout = false;
let lastBallPosition = null;
let batterReady = false;
let pitchNumber = 0;
let aiDecision = null;
let lastPitchCall = null;
let repeatedPitchCalls = 0;
let homeRunCount = 0;
let homeRunOverlayTimer = 0;
let selectedDifficulty = 'medium';
let impactAudioContext = null;
let pitcherThrowStartedAt = -Infinity;
let pitchAimReference = null;
let lastPitchAimPose = null;
let pitchAimLastMotionAt = -Infinity;
let pitchAimEnteredAt = 0;
let pitchAimMovementSeen = false;

const PITCH_TYPES = [
  { id: 'fastball', name: 'Fastball', flightTime: 0.82, lateBreakStart: 0.2, breakX: 0.045, breakY: -0.025, trail: 0xf2f2e8 },
  { id: 'curveball', name: 'Curveball', flightTime: 1.12, lateBreakStart: 0.32, breakX: 0.075, breakY: -0.4, trail: 0xc8c8ff },
  { id: 'slider', name: 'Slider', flightTime: 0.89, lateBreakStart: 0.7, breakX: 0.32, breakY: -0.025, trail: 0xe8f1ff },
  { id: 'cir-change', name: 'CIR Change', flightTime: 0.94, lateBreakStart: 0.76, breakX: 0.075, breakY: -0.11, circleRadius: 0.12, trail: 0xd3f3e7 },
];

const DIFFICULTY_SETTINGS = {
  easy: {
    strikeChance: 0.9,
    maxPitchCallStreak: 5,
    pitchFlightTimeScale: 1.28,
    weakContactFoulChance: 0.18,
    weakContactGroundChance: 0.58,
    contactAssist: 0.18,
    goodContactPower: 1.22,
  },
  medium: {
    strikeChance: 0.76,
    maxPitchCallStreak: 3,
    pitchFlightTimeScale: 1,
    weakContactFoulChance: 0.28,
    weakContactGroundChance: 0.52,
    contactAssist: 0.1,
    goodContactPower: 1.12,
  },
  hard: {
    strikeChance: 0.72,
    maxPitchCallStreak: 2,
    pitchFlightTimeScale: 1,
    weakContactFoulChance: 0.42,
    weakContactGroundChance: 0.42,
    contactAssist: 0,
    goodContactPower: 1,
  },
};

try {
  renderer = createRenderer(canvas);
  world = createBaseballWorld(scene);
  world.setEnvironment(settings);
} catch (error) {
  document.body.innerHTML = `<div style="padding:40px;color:white;font:16px sans-serif">This browser could not start WebGL. Try updating your browser or enabling hardware acceleration.<br><small>${String(error)}</small></div>`;
  throw error;
}

const ui = {
  main: $('main-menu'),
  difficulty: $('difficulty-panel'), phone: $('phone-panel'), settings: $('settings-panel'), pause: $('pause-panel'), gameover: $('gameover-panel'), hud: $('hud'),
  callout: $('callout'), aim: $('aim-reticle'),
  hint: $('bottom-hint'), homeRun: $('home-run-overlay'),
};

try { phonePreview = createComputerPhonePreview(); } catch { phonePreview = null; }
updateComputerPhonePreview({ quaternion: PHONE_EDGE_TARGET, yaw: 0, pitch: 0, roll: 0, referenceLabel: 'PHONE NEUTRAL · WAITING FOR MOTION' });
configurePhoneBridge();
bindUI();
resize();
renderLoop();

function bindUI() {
  $('play-button').addEventListener('click', openDifficultyPanel);
  document.querySelectorAll('[data-difficulty]').forEach((button) => {
    button.addEventListener('click', () => selectDifficulty(button.dataset.difficulty));
  });
  $('difficulty-continue').addEventListener('click', openPhonePanel);
  $('pair-continue-button').addEventListener('click', continueFromPhonePanel);
  $('settings-button').addEventListener('click', openSettingsPanel);
  bindEnvironmentSettings();
  $('phone-status').addEventListener('click', openPhonePanel);
  $('pause-button').addEventListener('click', pauseGame);
  $('resume-button').addEventListener('click', resumeGame);
  $('return-menu-button').addEventListener('click', returnToMenu);
  $('rematch-button').addEventListener('click', startMatch);
  $('gameover-menu-button').addEventListener('click', returnToMenu);
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => hidePanels()));
  window.addEventListener('keydown', (event) => {
    if (event.code === 'Escape') window.dispatchEvent(new CustomEvent('game-pause'));
  });
  window.addEventListener('game-pause', () => gameMode === 'menu' ? null : pauseGame());
  window.addEventListener('resize', resize);
}

function bindEnvironmentSettings() {
  const timeSelect = $('setting-time-of-day');
  const sunlightSlider = $('setting-sunlight');
  const windSlider = $('setting-wind');
  if (!timeSelect || !sunlightSlider || !windSlider) return;

  timeSelect.value = ['morning', 'day', 'sunset', 'night'].includes(settings.timeOfDay) ? settings.timeOfDay : 'day';
  sunlightSlider.value = String(clamp(Number(settings.sunlight) || 100, 45, 125));
  windSlider.value = String(clamp(Number(settings.wind) || 0, 0, 100));

  const apply = () => {
    settings.timeOfDay = timeSelect.value;
    settings.sunlight = Number(sunlightSlider.value);
    settings.wind = Number(windSlider.value);
    $('setting-sunlight-value').value = `${settings.sunlight}%`;
    $('setting-sunlight-value').textContent = `${settings.sunlight}%`;
    $('setting-wind-value').value = `${settings.wind}%`;
    $('setting-wind-value').textContent = `${settings.wind}%`;
    world.setEnvironment(settings);
    try { saveSettings(settings); } catch { /* settings storage is optional */ }
  };
  timeSelect.addEventListener('change', apply);
  sunlightSlider.addEventListener('input', apply);
  windSlider.addEventListener('input', apply);
  apply();
}

function configurePhoneBridge() {
  phoneBridge?.close();
  phoneBridge = new PhoneBridge({
    enabled: settings.motion,
    onSwing: (data) => {
      if (gameMode !== 'pitching') startSwing(data);
    },
    onPose: (pose) => {
      phonePose = pose;
      trackPitchAimPose(pose);
    },
    onStatus: (status) => {
      if (status !== 'connected') phonePose = null;
      const node = $('phone-status');
      if (!node) return;
      node.classList.toggle('offline', status !== 'connected');
      if (status === 'connected') node.innerHTML = '<i></i><span>PHONE CONNECTED</span>';
      else if (status === 'disabled') node.innerHTML = '<i></i><span>PHONE CONTROLS OFF</span>';
      else node.innerHTML = '<i></i><span>PHONE NOT CONNECTED</span>';
      updatePairingAction();
      if (!ui.phone.classList.contains('hidden')) {
        $('pair-status').textContent = status === 'connected'
          ? 'Phone connected. Continue to the game when you are ready.'
          : 'Waiting for your phone to scan the QR code.';
      }
      if (!state) updatePhoneStatus();
    },
    onMotionState: (motionState) => {
      if (!motionState.sensorEnabled) {
        phonePose = null;
        pitchAimReference = null;
        lastPitchAimPose = null;
        pitchAimMovementSeen = false;
      }
      if (gameMode === 'pitching' && !currentPitch) {
        setHint(motionState.sensorEnabled
          ? 'Point your phone where you want the pitch · hold it steady briefly to throw'
          : 'Enable phone motion sensors · point toward your target, then hold steady to pitch');
      }
    },
    onOrientation: (orientation) => updateComputerPhonePreview(orientation),
  });
}

function createComputerPhonePreview() {
  const canvas = $('computer-phone-canvas');
  const previewScene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 20);
  camera.position.set(0, 0, 4.1);
  camera.lookAt(0, 0, 0);
  previewScene.add(new THREE.HemisphereLight(0xffffff, 0x48545a, 2.2));
  const light = new THREE.DirectionalLight(0xffffff, 2.1);
  light.position.set(2, 4, 3);
  previewScene.add(light);

  const phone = new THREE.Group();
  const caseMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.76, 1.48, 0.11),
    new THREE.MeshStandardMaterial({ color: 0x2b6eaa, roughness: 0.52, metalness: 0.18 }),
  );
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.68, 1.38),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.04, emissive: 0x202a30 }),
  );
  screen.position.z = 0.057;
  const topMarker = new THREE.Mesh(
    new THREE.ConeGeometry(0.075, 0.15, 3),
    new THREE.MeshBasicMaterial({ color: 0x2b6eaa }),
  );
  topMarker.position.set(0, 0.46, 0.068);
  const backTopMarker = topMarker.clone();
  backTopMarker.position.z = -0.068;
  const lens = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0x2b6eaa }),
  );
  lens.position.set(-0.23, 0.61, -0.07);
  phone.add(caseMesh, screen, topMarker, backTopMarker, lens);
  previewScene.add(phone);

  const previewRenderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  previewRenderer.setClearColor(0x000000, 0);
  return { canvas, renderer: previewRenderer, scene: previewScene, camera, phone };
}

function updateComputerPhonePreview(orientation) {
  if (!orientation) return;
  if (phonePreview) {
    const { x, y, z, w } = orientation.quaternion;
    phonePreview.phone.quaternion.set(x, y, z, w).normalize();
    resizeComputerPhonePreview();
    phonePreview.renderer.render(phonePreview.scene, phonePreview.camera);
  }
  $('computer-angle-yaw').textContent = `${Math.round(orientation.yaw)}°`;
  $('computer-angle-pitch').textContent = `${Math.round(orientation.pitch)}°`;
  $('computer-angle-roll').textContent = `${Math.round(orientation.roll)}°`;
  $('computer-orientation-reference').textContent = orientation.referenceLabel;
}

function updatePhoneStatus() {
  const node = $('phone-status');
  if (!node) return;
  if (phoneBridge?.connected) {
    node.classList.remove('offline'); node.innerHTML = '<i></i><span>PHONE CONNECTED</span>';
  } else if (settings.motion) {
    node.classList.add('offline'); node.innerHTML = '<i></i><span>PHONE NOT CONNECTED</span>';
  } else {
    node.classList.add('offline'); node.innerHTML = '<i></i><span>PHONE CONTROLS OFF</span>';
  }
}

function hidePanels() {
  [ui.difficulty, ui.phone, ui.settings, ui.pause, ui.gameover].forEach((panel) => panel.classList.add('hidden'));
}

function openDifficultyPanel() {
  hidePanels();
  ui.difficulty.classList.remove('hidden');
}

function selectDifficulty(difficulty) {
  if (!DIFFICULTY_SETTINGS[difficulty]) return;
  selectedDifficulty = difficulty;
  document.querySelectorAll('[data-difficulty]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.difficulty === selectedDifficulty));
  });
}

function updatePairingAction() {
  const button = $('pair-continue-button');
  if (!button) return;
  const connected = Boolean(phoneBridge?.connected);
  button.disabled = !connected;
  button.innerHTML = connected
    ? `<span>${state ? 'RETURN TO GAME' : 'CONTINUE TO GAME'}</span><b aria-hidden="true">→</b>`
    : '<span>WAITING FOR PHONE…</span><b aria-hidden="true">→</b>';
}

function continueFromPhonePanel() {
  if (!phoneBridge?.connected) return;
  if (state) {
    if (gamePaused) resumeGame();
    else hidePanels();
    return;
  }
  startMatch();
}

async function openPhonePanel() {
  hidePanels();
  ui.phone.classList.remove('hidden');
  updatePairingAction();
  resizeComputerPhonePreview();
  if (phonePreview) phonePreview.renderer.render(phonePreview.scene, phonePreview.camera);
  const qrWrap = document.querySelector('.qr-wrap');
  qrWrap.classList.remove('ready', 'no-qr');
  $('qr-fallback').textContent = 'Finding this computer…';
  $('pair-status').textContent = phoneBridge?.connected
    ? 'Phone connected. Continue to the game when you are ready.'
    : 'Preparing your link';
  let url = '';
  let localAddresses = [];
  try {
    const response = await fetch('./connect-info', { cache: 'no-store' });
    if (response.ok) {
      const info = await response.json();
      localAddresses = info.addresses || [];
      const scheme = info.phoneScheme || info.scheme || location.protocol.replace(':', '');
      const port = info.phonePort || info.port || location.port || 8765;
      const address = localAddresses[0] || (!['localhost', '127.0.0.1', '::1'].includes(location.hostname) ? location.hostname : '');
      if (address) url = `${scheme}://${address}:${port}/phone.html`;
    }
  } catch { /* use the current host as a fallback */ }
  if (!url && !['localhost', '127.0.0.1', '::1'].includes(location.hostname)) url = `${location.origin}/phone.html`;
  if (url) {
    if (window.QRCode?.toCanvas) {
      try {
        await window.QRCode.toCanvas($('phone-qr'), url, { width: 240, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#2b6eaa', light: '#ffffff' } });
        qrWrap.classList.add('ready');
      } catch {
        qrWrap.classList.add('no-qr');
        $('qr-fallback').textContent = 'Could not draw the QR code. Restart the game server and try again.';
      }
    } else {
      qrWrap.classList.add('no-qr');
      $('qr-fallback').textContent = 'QR support is unavailable. Restart the game server and try again.';
    }
    if (!localAddresses.length && ['localhost', '127.0.0.1', '::1'].includes(location.hostname)) {
      $('pair-status').textContent = 'No local network address was found';
      $('qr-fallback').textContent = 'No phone address found. Check Wi-Fi and restart the game server.';
      qrWrap.classList.add('no-qr');
    }
  } else {
    qrWrap.classList.add('no-qr');
    $('qr-fallback').textContent = 'No phone address is available yet.';
    $('pair-status').textContent = 'Start the local game server on this computer';
  }
  if (phoneBridge?.connected) {
    $('pair-status').textContent = 'Phone connected. Continue to the game when you are ready.';
  } else if (url) {
    $('pair-status').textContent = 'Waiting for your phone to scan the QR code.';
  }
  updatePairingAction();
}

function openSettingsPanel() {
  hidePanels();
  ui.settings.classList.remove('hidden');
}

function startMatch() {
  if (!phoneBridge?.connected) {
    openPhonePanel();
    return;
  }
  prepareImpactAudio();
  hidePanels();
  clearTimeout(homeRunOverlayTimer);
  ui.homeRun.classList.add('hidden');
  homeRunCount = 0;
  state = new BaseballGameState({ away: humanTeam, home: cpuTeam, innings: 3 });
  currentPitch = null;
  battedBall = null;
  runnerPlay = null;
  pendingRoleChange = false;
  swing = null;
  nextActionAt = clock + 1.1;
  playResultAt = 0;
  gamePaused = false;
  pitchNumber = 0;
  pitcherThrowStartedAt = -Infinity;
  lastPitchCall = null;
  repeatedPitchCalls = 0;
  aimPoint = { x: 0, y: 1.15 };
  ui.main.classList.add('hidden');
  ui.hud.classList.remove('hidden');
  ui.aim.classList.remove('hidden');
  $('pause-button').classList.remove('hidden');
  gameMode = 'batting';
  updateRole();
  world.syncBaseRunners(state.bases);
  updateHud();
  setHint('Computer pitches automatically · move your phone to position the bat, then swing');
  showCallout('PLAY BALL!', 'good', 1350);
  updatePhoneStatus();
}

function updateRole() {
  if (!state) return;
  const battingTeam = state.teams[state.batting];
  const pitchingTeam = state.teams[state.pitching];
  activePlayers = world.setRoles(state.batting, battingTeam.colors[0], battingTeam.colors[1], pitchingTeam.colors[0], pitchingTeam.colors[1]);
  gameMode = state.batting === 'away' ? 'batting' : 'pitching';
  setPresentationCameraMode(gameMode === 'pitching' ? 'pitching' : 'batting', true);
  world.zone.aim.visible = false;
  world.pitcherAim.visible = false;
  reticleVisible = false;
  currentPitch = null;
  swing = null;
  pitcherThrowStartedAt = -Infinity;
  if (gameMode === 'pitching') {
    pitchAimReference = phonePose ? pitchAimPoseSnapshot(phonePose) : null;
    lastPitchAimPose = phonePose ? pitchAimPoseSnapshot(phonePose) : null;
    pitchAimLastMotionAt = clock;
    pitchAimEnteredAt = clock;
    pitchAimMovementSeen = false;
    setHint(phoneBridge?.sensorEnabled
      ? 'Your turn to pitch · point your phone where you want the pitch and hold steady briefly'
      : 'Your turn to pitch · enable motion, point at your target, then hold steady to throw');
    world.setPitcherFirstPerson({ active: true, holdingBall: true });
    updatePitchAim();
    nextActionAt = Infinity;
  } else {
    world.setPitcherFirstPerson({ active: false, holdingBall: false });
    setHint('Computer pitches automatically · move your phone to position the bat, then swing');
    nextActionAt = clock + 1.15;
  }
  updateHud();
}

function pauseGame() {
  if (!state || gamePaused || state.gameOver) return;
  gamePaused = true;
  hidePanels();
  ui.pause.classList.remove('hidden');
}

function resumeGame() {
  gamePaused = false;
  hidePanels();
  lastFrame = performance.now();
}

function returnToMenu() {
  state = null;
  currentPitch = null;
  battedBall = null;
  runnerPlay = null;
  pendingRoleChange = false;
  swing = null;
  gamePaused = false;
  gameMode = 'menu';
  clearTimeout(homeRunOverlayTimer);
  ui.homeRun.classList.add('hidden');
  hidePanels();
  ui.main.classList.remove('hidden');
  ui.hud.classList.add('hidden');
  ui.aim.classList.add('hidden');
  ui.hint.classList.add('hidden');
  world.ball.visible = false;
  world.trail.visible = false;
  world.zone.aim.visible = false;
  world.pitcherAim.visible = false;
  world.setPitcherFirstPerson({ active: false, holdingBall: false });
  world.playerAway.group.visible = true;
  world.playerHome.group.visible = false;
  world.syncBaseRunners([false, false, false]);
  setPresentationCameraMode('batting', true);
  updatePhoneStatus();
}

function startPitch() {
  if (!state || state.gameOver || currentPitch || battedBall || swing) return;
  if (runnerPlay) {
    const remainingRun = Math.max(0, runnerPlay.started + runnerPlay.duration - clock);
    nextActionAt = clock + remainingRun + NEXT_BATTER_READY_SECONDS;
    return;
  }
  setPresentationCameraMode('batting');
  pitchNumber += 1;
  world.startPitcherThrow(clock);
  const start = world.release.clone();
  const difficulty = DIFFICULTY_SETTINGS[selectedDifficulty];
  const pitchType = choosePitchType();
  const pitchCall = choosePitchCall();
  const finalTarget = choosePitchTarget(pitchCall, pitchType);
  const flightTime = (pitchType.flightTime + (Math.random() - 0.5) * 0.025) * difficulty.pitchFlightTimeScale;
  const breakDirection = Math.random() < 0.5 ? -1 : 1;
  const breakOffset = new THREE.Vector3(pitchType.breakX * breakDirection, pitchType.breakY, 0);
  const compensatedTarget = finalTarget.clone().sub(breakOffset);
  const velocity = new THREE.Vector3(
    (compensatedTarget.x - start.x) / flightTime,
    (compensatedTarget.y - start.y + 0.5 * FIELD.pitch.gravity * flightTime * flightTime) / flightTime,
    (compensatedTarget.z - start.z) / flightTime,
  );
  const targetInZone = finalTarget.x >= FIELD.zone.minX && finalTarget.x <= FIELD.zone.maxX && finalTarget.y >= FIELD.zone.minY && finalTarget.y <= FIELD.zone.maxY;
  currentPitch = {
    position: start.clone(), start, velocity, target: finalTarget, elapsed: 0, flightTime,
    type: pitchType.id, call: pitchCall, gravity: FIELD.pitch.gravity,
    breakOffset, lateBreakStart: pitchType.lateBreakStart, circleRadius: pitchType.circleRadius || 0,
    crossedPlate: false, swingAttempted: false, targetInZone, maxHeight: start.y,
  };
  world.ball.visible = true;
  world.ball.position.copy(start);
  world.trail.visible = true;
  world.trail.material.color.setHex(pitchType.trail);
  ballTrail = [];
  nextActionAt = Infinity;
  setHint('Track it in · the moving bat must meet the ball · quick swing as it reaches you');
}

function releasePlayerPitch(data) {
  if (!state || gamePaused || state.gameOver || gameMode !== 'pitching' || currentPitch || battedBall || swing) return;
  if (runnerPlay || (Number.isFinite(nextActionAt) && clock < nextActionAt)) {
    showCallout('LET THE PLAY FINISH', '', 1000);
    setHint('Wait for the runners to finish and the next pitch to be ready');
    return;
  }
  if (data?.source !== 'aim-stable' || !phoneBridge?.sensorEnabled || !phonePose) {
    showCallout('ENABLE PHONE MOTION', 'bad', 1200);
    setHint('Enable phone motion sensors to aim your pitch');
    return;
  }

  const start = world.release.clone();
  const speed = 24;
  const flightTime = (start.z - FIELD.zone.z) / speed;
  const zoneCenterY = (FIELD.zone.minY + FIELD.zone.maxY) * 0.5;
  const gravity = FIELD.pitch.gravity;
  const centerReleaseTilt = Math.asin(clamp(
    (zoneCenterY - start.y + 0.5 * gravity * flightTime * flightTime) / (speed * flightTime),
    -0.18,
    0.18,
  ));
  const phoneTilt = clamp(phonePose.elevation * settings.sensitivity, -0.48, 0.48) * 0.1;
  const rollAngle = phoneRollControl(phonePose);
  const releaseTilt = clamp(centerReleaseTilt + phoneTilt, -0.18, 0.18);
  const releaseYaw = clamp((phonePose.yaw - 0.35) * 0.08 + rollAngle * 0.08, -0.12, 0.12);
  const velocity = new THREE.Vector3(
    speed * Math.sin(releaseYaw) * Math.cos(releaseTilt),
    speed * Math.sin(releaseTilt),
    -speed * Math.cos(releaseYaw) * Math.cos(releaseTilt),
  );
  const actualFlightTime = (FIELD.zone.z - start.z) / velocity.z;
  const target = new THREE.Vector3(
    start.x + velocity.x * actualFlightTime,
    start.y + velocity.y * actualFlightTime - 0.5 * gravity * actualFlightTime * actualFlightTime,
    FIELD.zone.z,
  );
  pitchNumber += 1;
  world.startPitcherThrow(clock);
  pitcherThrowStartedAt = clock;
  currentPitch = {
    position: start.clone(), start, velocity, target, elapsed: 0, flightTime: actualFlightTime,
    type: 'player-release', call: null, gravity, breakOffset: new THREE.Vector3(),
    lateBreakStart: 1, circleRadius: 0, crossedPlate: false, swingAttempted: false,
    targetInZone: target.x >= FIELD.zone.minX && target.x <= FIELD.zone.maxX
      && target.y >= FIELD.zone.minY && target.y <= FIELD.zone.maxY,
    maxHeight: start.y,
    cpuSwingAt: actualFlightTime * (0.66 + Math.random() * 0.12),
    cpuWillSwing: Math.random() < (target.y >= FIELD.zone.minY - 0.32 && target.y <= FIELD.zone.maxY + 0.32
      && Math.abs(target.x) <= FIELD.zone.maxX + 0.25 ? 0.72 : 0.28),
  };
  world.ball.visible = true;
  world.ball.position.copy(start);
  world.ball.scale.setScalar(1);
  world.trail.visible = true;
  world.trail.material.color.setHex(FIELD.pitch.trail);
  ballTrail = [];
  world.pitcherAim.visible = false;
  nextActionAt = Infinity;
  setHint('Pitch released · the computer is at bat');
  showCallout('PITCH!', '', 520);
}

function trackPitchAimPose(pose) {
  if (!pose || gameMode !== 'pitching' || !phoneBridge?.sensorEnabled) return;
  const sample = pitchAimPoseSnapshot(pose);
  if (!pitchAimReference || !lastPitchAimPose) {
    pitchAimReference = sample;
    lastPitchAimPose = sample;
    pitchAimLastMotionAt = clock;
    return;
  }

  const ready = !gamePaused && !state?.gameOver && !currentPitch && !battedBall && !swing
    && !runnerPlay && presentationCameraMode === 'pitching'
    && (!Number.isFinite(nextActionAt) || clock >= nextActionAt);
  if (!ready) {
    pitchAimReference = sample;
    lastPitchAimPose = sample;
    pitchAimLastMotionAt = clock;
    pitchAimMovementSeen = false;
    return;
  }

  const step = Math.hypot(pose.x - lastPitchAimPose.x,
    pose.elevation - lastPitchAimPose.elevation,
    (pose.yaw - lastPitchAimPose.yaw) * 0.45,
    (sample.roll - lastPitchAimPose.roll) * 0.45);
  if (step > 0.0015) pitchAimLastMotionAt = clock;
  const fromStart = Math.hypot(pose.x - pitchAimReference.x,
    pose.elevation - pitchAimReference.elevation,
    (pose.yaw - pitchAimReference.yaw) * 0.45,
    (sample.roll - pitchAimReference.roll) * 0.45);
  if (fromStart > 0.014) pitchAimMovementSeen = true;

  if (pitchAimMovementSeen && Number(pose.rate) < 18
    && clock - pitchAimLastMotionAt > 0.62 && clock - pitchAimEnteredAt > 0.8) {
    pitchAimMovementSeen = false;
    pitchAimReference = sample;
    lastPitchAimPose = sample;
    releasePlayerPitch({ source: 'aim-stable' });
    return;
  }
  lastPitchAimPose = sample;
}

function phoneRollControl(pose) {
  const rotation = pose?.rotation;
  if (!rotation) return 0;
  const { x, y, z, w } = rotation;
  const roll = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  return clamp(roll / 0.75, -1, 1);
}

function pitchAimPoseSnapshot(pose) {
  return { x: pose.x, elevation: pose.elevation, yaw: pose.yaw, roll: phoneRollControl(pose) };
}

function updatePitchAim() {
  if (gameMode !== 'pitching' || !world?.pitcherAim) return;
  const start = world.release;
  const speed = 24;
  const flightTime = (start.z - FIELD.zone.z) / speed;
  const gravity = FIELD.pitch.gravity;
  const centerY = (FIELD.zone.minY + FIELD.zone.maxY) * 0.5;
  const centerTilt = Math.asin(clamp(
    (centerY - start.y + 0.5 * gravity * flightTime * flightTime) / (speed * flightTime),
    -0.18,
    0.18,
  ));
  const elevation = phoneBridge?.sensorEnabled && phonePose ? phonePose.elevation : 0;
  const heading = phoneBridge?.sensorEnabled && phonePose ? phonePose.yaw : 0.35;
  const tilt = clamp(centerTilt + clamp(elevation * settings.sensitivity, -0.48, 0.48) * 0.1, -0.18, 0.18);
  const roll = phoneBridge?.sensorEnabled && phonePose ? phoneRollControl(phonePose) : 0;
  const yaw = clamp((heading - 0.35) * 0.08 + roll * 0.08, -0.12, 0.12);
  const speedZ = -speed * Math.cos(yaw) * Math.cos(tilt);
  const time = (FIELD.zone.z - start.z) / speedZ;
  const targetX = start.x + speed * Math.sin(yaw) * Math.cos(tilt) * time;
  const targetY = start.y + speed * Math.sin(tilt) * time - 0.5 * gravity * time * time;
  world.setPitchAim(new THREE.Vector3(targetX, targetY, FIELD.zone.z + 0.04));
}

function startCpuSwing(pitch) {
  if (!pitch || pitch.swingAttempted || swing || gameMode !== 'pitching') return;
  pitch.swingAttempted = true;
  swing = {
    start: clock,
    duration: 0.66,
    speed: 7.2 + Math.random() * 2.1,
    angle: -0.18 + Math.random() * 0.48,
    progress: 0.52,
    hit: false,
    source: 'motion',
  };
}

function startSwing(data) {
  if (!state || gamePaused || state.gameOver || !currentPitch || currentPitch.crossedPlate || currentPitch.swingAttempted || swing || battedBall) return;
  if (state.batting !== 'away') return;
  currentPitch.swingAttempted = true;
  swing = {
    start: clock,
    duration: data.source === 'motion' ? 0.66 : 0.48,
    speed: clamp((data.speed || 6.8) * (data.source === 'phone' || data.source === 'motion' ? settings.sensitivity : 1), 3.8, 12),
    angle: clamp(data.angle || 0, -1.1, 1.1),
    progress: data.source === 'motion' ? 0.52 : 0,
    hit: false,
    source: data.source || 'phone',
  };
  showCallout('SWING!', '', 430);
  if (settings.effects) animateImpact(world.impact, world.plate, 0.15, 0.25, 'swing');
}

function renderLoop(now = performance.now()) {
  requestAnimationFrame(renderLoop);
  const dt = Math.min(0.045, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  clock += dt;
  if (!gamePaused) updateGame(dt);
  updatePresentationCamera(dt);
  updateVisuals(dt);
  const camera = currentCamera();
  if (shake > 0 && camera) {
    shake = Math.max(0, shake - dt * 4.3);
    camera.position.x += (Math.random() - 0.5) * shake * 0.22;
    camera.position.y += (Math.random() - 0.5) * shake * 0.16;
  }
  if (camera) world.updateSky(clock, camera);
  world.updateCrowd(clock);
  renderer.render(scene, camera);
}

function updateGame(dt) {
  if (!state || state.gameOver) return;
  world.updateFielders(dt, battedBall?.fieldingPlan || null);
  world.updatePitcherThrow(clock);
  updateRunnerPlay(dt);
  if (gameMode === 'pitching') {
    updatePitchAim();
    const pitch = currentPitch;
    if (pitch?.cpuWillSwing && !pitch.swingAttempted && pitch.elapsed + dt >= pitch.cpuSwingAt) startCpuSwing(pitch);
    const throwProgress = Number.isFinite(pitcherThrowStartedAt)
      ? clamp((clock - pitcherThrowStartedAt) / 0.62, 0, 1)
      : 0;
    world.setPitcherFirstPerson({
      active: presentationCameraMode === 'pitching',
      throwing: throwProgress,
      holdingBall: !pitch,
    });
  }
  if (nextActionAt <= clock && Number.isFinite(nextActionAt)) {
    nextActionAt = Infinity;
    if (gameMode === 'batting') {
      if (swing) nextActionAt = clock + 0.1;
      else startPitch();
    } else if (gameMode === 'pitching') {
      setPresentationCameraMode('pitching', true);
      world.setPitcherFirstPerson({ active: true, holdingBall: true });
      updatePitchAim();
      pitchAimReference = phonePose ? pitchAimPoseSnapshot(phonePose) : null;
      lastPitchAimPose = pitchAimReference ? { ...pitchAimReference } : null;
      pitchAimEnteredAt = clock;
      pitchAimLastMotionAt = clock;
      pitchAimMovementSeen = false;
      setHint('Point your phone where you want the pitch · hold it steady briefly to throw');
    }
  }

  if (gameMode === 'batting') updateReticle();
  if (gameMode === 'batting' || gameMode === 'pitching') updateBatPose(dt);

  if (currentPitch) updatePitch(dt);
  if (battedBall) updateBattedBall(dt);
  if (playResultAt && clock >= playResultAt) {
    playResultAt = 0;
    resetAfterPlay();
  }
}

function updatePitch(dt) {
  const pitch = currentPitch;
  const previousBallPosition = pitch.position.clone();
  pitch.elapsed += dt;
  samplePitchPosition(pitch, pitch.elapsed);
  pitch.maxHeight = Math.max(pitch.maxHeight, pitch.position.y);
  world.ball.position.copy(pitch.position);
  world.ball.rotation.x += dt * 7;
  world.ball.rotation.z += dt * 4;
  addToTrail(pitch.position);

  if (swing && !swing.hit && (swing.source === 'motion' || swing.progress > 0.08)) {
    const segment = batWorldSegment(world.batPivot);
    const previousSegment = world.batPivot.userData.previousWorldSegment || segment;
    const contact = sweptBatContact(previousBallPosition, pitch.position, previousSegment, segment);
    const distance = contact.distance;
    // Give the batter a little more room on both sides of the plate so a
    // slightly early or late swing can still meet the ball.
    const inContactWindow = contact.position.z < 3.05 && contact.position.z > -1.9;
    const tolerance = BAT_CONTACT_TOLERANCE;
    if (distance <= tolerance && inContactWindow) {
      world.batPivot.userData.previousWorldSegment = cloneBatSegment(segment);
      makeContact(distance, tolerance, contact.segment, contact.position);
      return;
    }
    world.batPivot.userData.previousWorldSegment = cloneBatSegment(segment);
  } else {
    world.batPivot.userData.previousWorldSegment = cloneBatSegment(batWorldSegment(world.batPivot));
  }

  if (!pitch.crossedPlate && pitch.position.z <= -1.85) {
    pitch.crossedPlate = true;
    world.ball.visible = false;
    world.trail.visible = false;
    const isStrike = pitch.swingAttempted || pitch.targetInZone;
    recordPitchCall(isStrike ? 'strike' : 'ball');
    if (isStrike) {
      const result = state.strike();
      showCallout(result.type === 'side-change' ? 'STRIKEOUT!' : result.type === 'out' ? 'STRIKE' : 'STRIKE', 'bad', 850);
      resolveCountResult(result);
    } else {
      const result = state.ball();
      showCallout(result.type === 'walk' ? 'WALK!' : 'BALL', result.type === 'walk' ? 'good' : '', 900);
      resolveCountResult(result);
    }
  }
  if (pitch.elapsed > pitch.flightTime + 0.55 && !pitch.crossedPlate) {
    pitch.crossedPlate = true;
    recordPitchCall('ball');
    world.ball.visible = false;
    world.trail.visible = false;
    const result = state.ball();
    showCallout('BALL', '', 900);
    resolveCountResult(result);
  }
}

function updateBatPose(dt) {
  if (!world?.batPivot || !state) return;
  const humanBatting = state.batting === 'away';
  const batterRoot = humanBatting ? world.playerAway.group : world.playerHome.group;
  if (world.batPivot.parent !== batterRoot) batterRoot.add(world.batPivot);
  // Sensor samples are event-driven. Keep using the last pose between events so
  // the bat does not snap back whenever the phone is held still.
  const phoneControls = humanBatting && settings.motion && phonePose;
  const phoneSensitivity = settings.sensitivity;
  const phoneAim = phoneControls ? phoneBatAim() : null;
  const aimDx = phoneControls ? phoneAim.x : humanBatting ? aimPoint.x : 0;
  const aimDy = phoneControls ? 1.15 + phoneAim.y : humanBatting ? aimPoint.y : 1.15;
  const stanceOffset = world.batterBatOffset.clone();
  stanceOffset.x += aimDx * 0.43;
  stanceOffset.y += (aimDy - 1.15) * 0.38;
  stanceOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), -world.batterStanceYaw);
  world.batPivot.position.copy(stanceOffset);
  let progress = 0;
  let swingAngle = 0;
  let swingElevation = 0;
  let swingEnvelope = 0;
  if (swing) {
    const elapsed = clock - swing.start;
    swing.progress = swing.source === 'motion'
      ? clamp(0.52 + (elapsed / swing.duration) * 0.48, 0, 1)
      : clamp(elapsed / swing.duration, 0, 1);
    progress = swing.progress;
    swingAngle = swing.angle;
    swingElevation = Math.sin(swing.angle) * 0.16;
    const animationProgress = swing.source === 'motion'
      ? clamp(elapsed / swing.duration, 0, 1)
      : progress;
    // One complete stroke: move through the hitting zone, then return smoothly
    // to the ready pose instead of snapping back at the end of the swing.
    swingEnvelope = Math.sin(animationProgress * Math.PI);
    if (progress >= 1) swing = null;
  }
  const restingYaw = 0.35;
  const yaw = phoneControls
    ? clamp(restingYaw + (phonePose.yaw + 0.5) * phoneSensitivity, -1.4, 1.5)
    : restingYaw + swingEnvelope * (1.62 + swingAngle * 0.24);
  const elevation = phoneControls
    ? clamp(phonePose.elevation * phoneSensitivity, -0.7, 0.7)
    : (aimDy - 1.15) * 0.08 + swingEnvelope * ((aimDy - 1.15) * 0.04 + swingElevation);
  const direction = new THREE.Vector3(-Math.cos(yaw) * Math.cos(elevation), Math.sin(elevation), Math.sin(yaw) * Math.cos(elevation)).normalize();
  const phoneRotation = phoneControls && phonePose.rotation
    ? new THREE.Quaternion(phonePose.rotation.x, phonePose.rotation.y, phonePose.rotation.z, phonePose.rotation.w)
    : null;
  let desiredWorldOrientation;
  if (phoneRotation) {
    const readyDirection = new THREE.Vector3(-Math.cos(restingYaw), 0, Math.sin(restingYaw)).normalize();
    const readyOrientation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), readyDirection);
    const phoneTilt = limitQuaternionAngle(phoneRotation, 0.66);
    // PhoneBridge maps motion from the same reference and axes as the live preview.
    // Apply that movement in world space before the bat's ready orientation.
    const controlledOrientation = phoneTilt.multiply(readyOrientation);
    // The phone pose tracks preparation; this short sweep carries the bat
    // through the hitting zone once a motion swing is detected.
    if (swingEnvelope > 0) {
      const swingArc = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), swingEnvelope * 1.12);
      controlledOrientation.premultiply(swingArc);
    }
    desiredWorldOrientation = controlledOrientation;
  } else {
    desiredWorldOrientation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  }
  const batter = humanBatting ? world.playerAway : world.playerHome;
  const parentWorldInverse = batterRoot.getWorldQuaternion(new THREE.Quaternion()).invert();
  world.batPivot.quaternion.copy(parentWorldInverse.multiply(desiredWorldOrientation)).normalize();
  world.poseBatHoldingArms(batter);
  world.batPivot.userData.swingDirection = batWorldSegment(world.batPivot).direction;
  if (!currentPitch) world.batPivot.userData.previousWorldSegment = cloneBatSegment(batWorldSegment(world.batPivot));
  world.playerAway.group.rotation.z = humanBatting && swing ? -Math.sin(progress * Math.PI) * 0.16 : 0;
  world.playerHome.group.rotation.z = !humanBatting && swing ? -Math.sin(progress * Math.PI) * 0.16 : 0;
}

function cloneBatSegment(segment) {
  return { a: segment.a.clone(), b: segment.b.clone(), direction: segment.direction.clone() };
}

function phoneBatAim() {
  return {
    x: clamp(phonePose.x * settings.sensitivity, -1.2, 1.2),
    y: clamp(phonePose.y * settings.sensitivity, -0.68, 0.68),
  };
}

function limitQuaternionAngle(rotation, maxAngle) {
  const limited = rotation.clone().normalize();
  // q and -q describe the same pose. Use the shorter path from the neutral pose.
  if (limited.w < 0) limited.set(-limited.x, -limited.y, -limited.z, -limited.w);
  const angle = 2 * Math.acos(clamp(limited.w, -1, 1));
  if (angle <= maxAngle || angle < 1e-6) return limited;
  return new THREE.Quaternion().slerpQuaternions(new THREE.Quaternion(), limited, maxAngle / angle);
}

function sweptBatContact(ballFrom, ballTo, from, to) {
  let best = { distance: Infinity, segment: to, position: ballTo };
  const samples = 12;
  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    const position = ballFrom.clone().lerp(ballTo, t);
    const a = from.a.clone().lerp(to.a, t);
    const b = from.b.clone().lerp(to.b, t);
    const segment = { a, b, direction: b.clone().sub(a).normalize() };
    const distance = distanceToSegment(position, a, b);
    if (distance < best.distance) best = { distance, segment, position };
  }
  return best;
}

function makeContact(distance, tolerance, segment, ballPosition) {
  if (!currentPitch || !swing) return;
  const humanBatting = state.batting === 'away';
  if (humanBatting) phoneBridge?.vibrate(1000);
  const pitch = currentPitch;
  const phoneControls = humanBatting && settings.motion && phonePose;
  const phoneAim = phoneControls ? phoneBatAim() : null;
  const contactAimX = phoneControls ? phoneAim.x : aimPoint.x;
  const contactAimY = phoneControls ? 1.15 + phoneAim.y : aimPoint.y;
  const difficulty = DIFFICULTY_SETTINGS[selectedDifficulty];
  const accuracy = clamp(1 - distance / (tolerance * 1.15), 0.12, 1);
  const timing = clamp(1 - Math.abs(swing.progress - 0.58) / 1.3, 0.72, 1);
  const quality = clamp(accuracy * 0.5 + timing * 0.5 + difficulty.contactAssist, 0.3, 1);
  const weakContact = quality <= 0.68;
  const weakContactFoul = weakContact && Math.random() < difficulty.weakContactFoulChance;
  if (weakContactFoul) {
    finishWeakContactFoul(ballPosition, quality);
    return;
  }
  const weakContactGrounder = weakContact && Math.random() < difficulty.weakContactGroundChance;

  const speedFactor = clamp(swing.speed / 7.2, 0.55, 1.52);
  const batDirection = segment.direction;
  const sweetSpot = 0.78 + quality * 0.62;
  const forwardSpeed = (10 + swing.speed * 2.2) * speedFactor * sweetSpot;
  const sideAim = clamp((contactAimX * 0.28) + Math.sin(swing.angle) * 0.24 + batDirection.x * 0.2, -0.72, 0.72);
  const launchX = sideAim * forwardSpeed;
  const liftInput = clamp((contactAimY - 1.05) / 0.8, -0.5, 1.1) + Math.max(0, Math.sin(swing.angle)) * 0.48 + Math.max(0, batDirection.y) * 0.65;
  // Strong contact drives the ball faster on a lower line; weaker or
  // deliberately lifted contact gets a little more height instead.
  const launchY = clamp((7.8 + swing.speed * 0.55 + liftInput * 4.2) * (1.08 - quality * 0.22), 3.2, 17);
  const launchZ = forwardSpeed;
  const resultVelocity = new THREE.Vector3(launchX, launchY, launchZ);
  const scriptedGrounder = weakContactGrounder ? makeWeakContactGrounder(sideAim, swing.speed) : null;
  const scriptedFlyout = weakContact && !weakContactGrounder ? makeWeakContactFlyout(ballPosition) : null;
  if (scriptedGrounder) resultVelocity.copy(scriptedGrounder.velocity);
  else if (scriptedFlyout) resultVelocity.copy(scriptedFlyout.velocity);
  else if (quality > 0.68) resultVelocity.multiplyScalar(difficulty.goodContactPower);
  const projectedHomeRun = scriptedFlyout || scriptedGrounder ? false : willClearHomeRunFence(ballPosition, resultVelocity);
  const powerHit = quality > 0.68 && (resultVelocity.length() >= 24 || projectedHomeRun);
  const goodContactBases = quality > 0.68 && !projectedHomeRun ? chooseGoodContactBases() : null;
  battedBall = {
    position: ballPosition.clone(), velocity: resultVelocity, hitBases: goodContactBases,
    elapsed: 0, maxHeight: ballPosition.y, start: ballPosition.clone(), quality,
    swingSpeed: swing.speed, fairChecked: false, homeRun: false,
  };
  battedBall.projectedHomeRun = projectedHomeRun;
  battedBall.powerHit = powerHit;
  battedBall.fieldingPlan = projectedHomeRun ? null : planFieldingPlay({
    start: battedBall.start,
    velocity: battedBall.velocity,
    gravity: FIELD.gravity,
    contactQuality: quality,
    fielders: world.fielders.map((fielder) => ({
      id: fielder.id, fieldingGroup: fielder.fieldingGroup,
      position: fielder.position, homePosition: fielder.homePosition,
    })),
    baseLocations: world.baseLocations,
    homeLocation: world.homeLocation,
    grounderOnly: Boolean(scriptedGrounder),
  });
  if (projectedHomeRun || (battedBall.fieldingPlan?.type === 'ground' && fairBallAt(battedBall.fieldingPlan.landing.x, battedBall.fieldingPlan.landing.z))) {
    beginRunnerPlay();
  }
  currentPitch = null;
  swing.hit = true;
  swing = null;
  world.ball.visible = true;
  world.ball.position.copy(battedBall.position);
  world.trail.visible = true;
  world.trail.material.color.setHex(projectedHomeRun ? 0xff312f : powerHit ? 0xff9639 : FIELD.pitch.trail);
  world.ball.scale.setScalar(1.03 + quality * 0.24);
  ballTrail = [];
  setPresentationCameraMode('ball');
  const label = scriptedGrounder ? 'GROUND BALL' : quality > 0.86 && swingSpeedStrong(battedBall.swingSpeed) ? 'PERFECT CONTACT' : quality > 0.68 ? 'GOOD CONTACT' : quality > 0.44 ? 'WEAK CONTACT' : 'OFF THE HANDLE';
  showCallout(label, scriptedGrounder || quality > 0.65 ? 'good' : 'bad', 1100);
  if (settings.effects) {
    animateImpact(world.impact, ballPosition, 0.5 + quality * (powerHit ? 1.1 : 0.65), powerHit ? 1.28 : quality, 'contact');
    shake = quality * (powerHit ? 1.12 : 0.85);
  }
  playImpactSound(quality);
}

function finishWeakContactFoul(ballPosition, quality) {
  const side = Math.random() < 0.5 ? -1 : 1;
  const velocity = new THREE.Vector3(side * 9.5, 5.6, 2.8);
  battedBall = {
    position: ballPosition.clone(), velocity, elapsed: 0, maxHeight: ballPosition.y,
    start: ballPosition.clone(), quality, fieldingPlan: null, projectedHomeRun: false,
  };
  currentPitch = null;
  if (swing) swing.hit = true;
  swing = null;
  world.ball.visible = true;
  world.ball.position.copy(ballPosition);
  world.trail.visible = true;
  ballTrail = [];
  showCallout('FOUL BALL', '', 1100);
  if (settings.effects) animateImpact(world.impact, ballPosition, 0.42, quality, 'contact');
  playImpactSound(quality);
}

function makeWeakContactGrounder(sideAim, swingSpeed) {
  return {
    velocity: new THREE.Vector3(
      clamp(sideAim * 5.2, -3.5, 3.5),
      0.65,
      18.5 + clamp(swingSpeed, 4, 12) * 0.15,
    ),
  };
}

function makeWeakContactFlyout(start) {
  const catchTime = 2.35;
  const catchPoint = { x: 0, y: 2.55, z: FIELD.moundZ };
  const velocity = new THREE.Vector3(
    (catchPoint.x - start.x) / catchTime,
    (catchPoint.y - start.y + 0.5 * FIELD.gravity * catchTime * catchTime) / catchTime,
    (catchPoint.z - start.z) / catchTime,
  );
  return { velocity };
}

function updateBattedBall(dt) {
  const hit = battedBall;
  if (hit.throwPlay) {
    hit.throwElapsed += dt;
    const progress = clamp(hit.throwElapsed / hit.throwDuration, 0, 1);
    const start = hit.throwStart;
    const target = hit.throwPlay.throwTarget;
    hit.position.set(
      start.x + (target.x - start.x) * progress,
      0.12 + Math.sin(progress * Math.PI) * 0.95,
      start.z + (target.z - start.z) * progress,
    );
    world.ball.position.copy(hit.position);
    world.ball.rotation.x += dt * 16;
    world.ball.rotation.z += dt * 11;
    addToTrail(hit.position);
    if (progress >= 1) finishGroundBall(hit.fieldingPlan, hit.throwPlay);
    return;
  }

  const previousPosition = hit.position.clone();
  hit.elapsed += dt;
  if (hit.groundContact) {
    advanceGroundBounce(hit, dt);
  } else {
    hit.position.addScaledVector(hit.velocity, dt);
    hit.velocity.y -= FIELD.gravity * dt;
  }
  hit.maxHeight = Math.max(hit.maxHeight, hit.position.y);

  const distance = Math.hypot(hit.position.x, hit.position.z);
  if (!hit.homeRun && distance > FIELD.homeRunRadius && hit.position.y > 4.0) {
    hit.homeRun = fairBallAt(hit.position.x, hit.position.z);
    if (hit.homeRun) {
      hit.projectedHomeRun = true;
      hit.powerHit = true;
      hit.fieldingPlan = null;
      world.trail.material.color.setHex(0xff312f);
      if (!runnerPlay) beginRunnerPlay();
    } else {
      finishBattedBall({ landing: hit.position.clone() });
      return;
    }
  }

  if (hit.homeRun) {
    const stadiumContact = findStadiumContact(previousPosition, hit.position);
    if (stadiumContact) {
      hit.position.copy(stadiumContact);
      world.ball.position.copy(hit.position);
      finishBattedBall({ homeRun: true, landing: hit.position.clone() });
      return;
    }
  }

  if (hit.homeRun && (hit.position.y <= 0.12 || hit.elapsed > 9)) {
    hit.position.y = 0.12;
    world.ball.position.copy(hit.position);
    finishBattedBall({ homeRun: true, landing: hit.position.clone() });
    return;
  }

  const plan = hit.homeRun ? null : hit.fieldingPlan;
  if (plan?.type === 'catch' && hit.elapsed >= plan.time) {
    hit.position.set(plan.target.x, plan.target.y, plan.target.z);
    world.ball.position.copy(hit.position);
    finishCaughtBall(plan);
    return;
  }

  if (plan?.type === 'ground' && hit.elapsed >= plan.landingTime) {
    if (!hit.groundContact) {
      hit.position.set(plan.landing.x, 0.12, plan.landing.z);
      beginGroundBounce(hit);
    }
    if (!fairBallAt(plan.landing.x, plan.landing.z)) {
      finishBattedBall({ landing: hit.position.clone() });
      return;
    }
    if (hit.elapsed >= plan.pickupTime && hit.bounceSettled) {
      const basesEarned = hit.hitBases ?? basesForLanding(plan.landing);
      hit.throwPlay = decideGroundPlay({
        plan,
        bases: state.bases,
        outs: state.outs,
        baseLocations: world.baseLocations.map((position) => ({ x: position.x, z: position.z })),
        home: { x: world.homeLocation.x, z: world.homeLocation.z },
        batterBases: basesEarned,
        runnersAdvance: Math.min(1, basesEarned),
      });
      plan.throwing = true;
      plan.throwTargetId = hit.throwPlay.throwTargetId;
      plan.throwTarget = hit.throwPlay.throwTarget;
      hit.throwStart = { x: hit.position.x, z: hit.position.z };
      hit.throwElapsed = 0;
      hit.throwDuration = Math.max(0.18, hit.throwPlay.throwTime);
    }
  }

  if (!plan && hit.position.y <= 0.12 && hit.elapsed > 0.2) {
    if (!hit.groundContact) beginGroundBounce(hit);
    if (hit.bounceSettled && hit.elapsed > 1.25) {
      finishBattedBall({ landing: hit.position.clone() });
      return;
    }
  }
  if (!plan && hit.elapsed > 7.5) {
    hit.position.y = Math.max(hit.position.y, 0.12);
    finishBattedBall({ landing: hit.position.clone() });
    return;
  }
  world.ball.position.copy(hit.position);
  world.ball.rotation.x += dt * (hit.groundContact ? 8 : 16);
  world.ball.rotation.z += dt * (hit.groundContact ? 5 : 11);
  addToTrail(hit.position);
}

function findStadiumContact(start, end) {
  const contactOffset = 0.3;
  const point = new THREE.Vector3();
  const gapAt = (progress) => {
    point.lerpVectors(start, end, progress);
    return Math.hypot(point.x, point.z) - world.stadiumWallRadius(point.y) + contactOffset;
  };

  let previousProgress = 0;
  if (gapAt(previousProgress) >= 0) return start.clone();
  for (let sample = 1; sample <= 12; sample += 1) {
    const progress = sample / 12;
    const gap = gapAt(progress);
    if (gap >= 0) {
      let low = previousProgress;
      let high = progress;
      for (let step = 0; step < 10; step += 1) {
        const middle = (low + high) / 2;
        if (gapAt(middle) >= 0) high = middle;
        else low = middle;
      }
      return start.clone().lerp(end, high);
    }
    previousProgress = progress;
  }
  return null;
}

function beginGroundBounce(hit) {
  if (hit.groundContact) return;
  hit.groundContact = true;
  if (settings.effects) animateImpact(world.impact, hit.position, 0.52, 0.7, 'ground');
  hit.bounceCount = 1;
  hit.position.y = 0.12;
  hit.velocity.x *= 0.16;
  hit.velocity.z *= 0.16;
  hit.velocity.y = clamp(Math.abs(hit.velocity.y) * 0.28, 2.2, 3.6);
  hit.bounceSettled = false;
}

function advanceGroundBounce(hit, dt) {
  if (hit.bounceSettled) {
    hit.position.y = 0.12;
    hit.velocity.y = 0;
    hit.velocity.x *= Math.exp(-2.1 * dt);
    hit.velocity.z *= Math.exp(-2.1 * dt);
    hit.position.x += hit.velocity.x * dt;
    hit.position.z += hit.velocity.z * dt;
    return;
  }
  hit.velocity.y -= FIELD.gravity * dt;
  hit.position.y += hit.velocity.y * dt;
  hit.position.x += hit.velocity.x * dt;
  hit.position.z += hit.velocity.z * dt;
  if (hit.position.y > 0.12 || hit.velocity.y >= 0) return;
  hit.position.y = 0.12;
  if (hit.bounceCount < 2 && Math.abs(hit.velocity.y) > 0.7) {
    hit.bounceCount += 1;
    hit.velocity.y = Math.abs(hit.velocity.y) * 0.34;
  } else {
    hit.bounceSettled = true;
    hit.velocity.y = 0;
  }
}

function basesForLanding(landing) {
  const distance = Math.hypot(landing.x, landing.z);
  if (distance > 49) return 3;
  if (distance > 34) return 2;
  return 1;
}

function chooseGoodContactBases() {
  const roll = Math.random();
  if (roll < 0.7) return 1;
  if (roll < 0.9) return 2;
  return 3;
}

function willClearHomeRunFence(start, velocity) {
  for (let elapsed = 0.05; elapsed <= 5.5; elapsed += 0.05) {
    const x = start.x + velocity.x * elapsed;
    const y = start.y + velocity.y * elapsed - 0.5 * FIELD.gravity * elapsed * elapsed;
    const z = start.z + velocity.z * elapsed;
    if (Math.hypot(x, z) > FIELD.homeRunRadius) return y > 4 && fairBallAt(x, z);
    if (y <= 0.12) return false;
  }
  return false;
}

function beginRunnerPlay() {
  if (!state || runnerPlay) return;
  const paths = [];
  // The field stores bases in the batter's counterclockwise order:
  // first (screen-right), second, third (screen-left).
  const base = world.baseLocations.map((position) => ({ x: position.x, z: position.z }));
  const home = { x: world.homeLocation.x, z: world.homeLocation.z };
  const batterAdvancement = battedBall.projectedHomeRun ? 4 : (battedBall.hitBases ?? basesForLanding(battedBall.fieldingPlan.landing));
  const runnerAdvancement = battedBall.projectedHomeRun ? 4 : Math.min(1, batterAdvancement);
  const makeRoute = (sourceBase, from, model, advancement) => {
    const points = [from];
    for (let step = 1; step <= advancement; step += 1) {
      const destination = sourceBase + step;
      points.push(destination >= 3 ? home : base[destination]);
      if (destination >= 3) break;
    }
    const routeLength = points.slice(1).reduce((sum, point, index) => {
      const previous = points[index];
      return sum + Math.hypot(point.x - previous.x, point.z - previous.z);
    }, 0);
    model.group.visible = true;
    const endpoint = points[points.length - 1];
    const endsAtHome = endpoint.x === home.x && endpoint.z === home.z;
    paths.push({ sourceBase, model, points, routeLength, duration: routeLength / BASE_RUN_SPEED, start: clock, endsAtHome });
  };
  state.bases.forEach((occupied, index) => {
    if (!occupied) return;
    makeRoute(index, base[index], world.baseRunners[index], runnerAdvancement);
  });
  const batter = activePlayers?.batter;
  if (batter) batter.group.visible = false;
  world.batPivot.visible = false;
  makeRoute(-1, home, world.batterRunner, batterAdvancement);
  runnerPlay = { paths, started: clock, duration: Math.max(...paths.map((path) => path.duration), 0) + 0.24 };
}

function updateRunnerPlay(dt) {
  if (!runnerPlay) return;
  for (const path of runnerPlay.paths) {
    if (path.retired) {
      if (path.sourceBase === -1 && clock - path.retiredAt > 1.6) path.model.group.visible = false;
      continue;
    }
    const progress = clamp((clock - path.start) / path.duration, 0, 1);
    const stridePhase = (clock - path.start) * 9;
    animateRunner(path.model, stridePhase, progress < 1, dt);
    if (progress >= 1 && path.endsAtHome) path.model.group.visible = false;
    let remaining = path.routeLength * progress;
    let point = path.points[0];
    for (let index = 1; index < path.points.length; index += 1) {
      const next = path.points[index];
      const dx = next.x - point.x;
      const dz = next.z - point.z;
      const segmentLength = Math.hypot(dx, dz);
      if (remaining <= segmentLength || index === path.points.length - 1) {
        const segmentProgress = segmentLength ? Math.min(1, remaining / segmentLength) : 1;
        path.model.group.position.set(point.x + dx * segmentProgress, 0, point.z + dz * segmentProgress);
        path.model.group.position.y += (0.02 + (1 - Math.cos(stridePhase * 2)) * 0.012) * path.model.runBlend;
        path.model.group.rotation.y = Math.atan2(dx, dz);
        break;
      }
      remaining -= segmentLength;
      point = next;
    }
  }
  if (clock - runnerPlay.started >= runnerPlay.duration) {
    finalizeRunnerPlay();
    if (pendingRoleChange && state && !state.gameOver) {
      pendingRoleChange = false;
      updateRole();
      nextActionAt = clock + NEXT_BATTER_READY_SECONDS;
      showRoleChange();
      setHint(gameMode === 'pitching'
        ? 'Your turn to pitch · point your phone where you want the pitch and hold steady briefly'
        : 'Your turn to bat · get ready for the next pitch');
    }
  }
}

function finalizeRunnerPlay() {
  runnerPlay = null;
  for (const runner of [...world.baseRunners, world.batterRunner]) resetRunnerPose(runner);
  if (state) world.syncBaseRunners(state.bases);
  if (activePlayers?.batter) activePlayers.batter.group.visible = true;
  world.batPivot.visible = true;
  if (presentationCameraMode === 'batter') presentationCameraMode = 'return';
}

function animateRunner(player, phase, running, dt) {
  player?.animateRun(phase, running, dt);
}

function resetRunnerPose(player) {
  player?.resetRunPose();
}

function finishCaughtBall(plan) {
  if (!battedBall || playResultAt) return;
  const distance = Math.hypot(plan.landing.x, plan.landing.z);
  const sacrificeFly = state.outs < 2 && distance > 35;
  const result = state.resolveFieldingPlay({
    batterOut: true,
    batterBases: 0,
    runnersAdvance: sacrificeFly ? 1 : 0,
    reason: sacrificeFly ? 'sacrifice fly' : 'fly out',
  });
  if (sacrificeFly) showCallout('SACRIFICE FLY', 'good', 1300);
  else if (plan.weakContactFlyout) showCallout('WEAK FLY OUT', 'bad', 1100);
  else showCallout(result.type === 'side-change' ? 'THREE OUTS' : 'CAUGHT!', result.type === 'side-change' ? 'bad' : '', 1100);
  finishPlay(result, 1.45);
}

function finishGroundBall(plan, play) {
  if (!battedBall || playResultAt) return;
  const basesEarned = battedBall?.hitBases ?? basesForLanding(plan.landing);
  for (const sourceBase of play.runnerOuts) retireRunnerPath(sourceBase);
  if (play.batterOut) retireRunnerPath(-1);
  const result = state.resolveFieldingPlay(play);
  const labels = {
    'force out': 'FORCE OUT',
    'tag out': 'TAG OUT',
    'out at first': 'OUT AT FIRST',
  };
  if (result.type === 'side-change') showCallout('THREE OUTS', 'bad', 1300);
  else if (labels[play.reason]) showCallout(labels[play.reason], 'bad', 1300);
  else showCallout(basesEarned === 3 ? 'TRIPLE!' : basesEarned === 2 ? 'DOUBLE!' : 'SINGLE!', 'good', 1250);
  finishPlay(result, 1.5);
}

function retireRunnerPath(sourceBase) {
  const path = runnerPlay?.paths.find((candidate) => candidate.sourceBase === sourceBase);
  if (!path) return;
  path.retired = true;
  path.retiredAt = clock;
  path.model.group.visible = sourceBase === -1;
}

function finishBattedBall({ homeRun = false, landing }) {
  if (!battedBall || playResultAt) return;
  const hit = battedBall;
  if (homeRun) {
    const result = state.hit(4, { homeRun: true });
    showHomeRunPresentation(result.runs);
    finishPlay(result, 1.7);
    return;
  }
  if (!fairBallAt(landing.x, landing.z)) {
    const result = state.foul();
    showCallout('FOUL BALL', '', 1050);
    finishPlay(result, 1.25);
    return;
  }

  const basesEarned = hit?.hitBases ?? basesForLanding(landing);
  const result = state.hit(basesEarned, { runnerAdvance: 1 });
  const label = basesEarned === 3 ? 'TRIPLE!' : basesEarned === 2 ? 'DOUBLE!' : 'SINGLE!';
  showCallout(label, 'good', 1250);
  finishPlay(result, 1.45);
}

function resolveCountResult(result) {
  finishPlay(result, result.type === 'side-change' ? 1.5 : result.type === 'walk' ? 1.4 : 1.05);
}

function finishPlay(result, delay) {
  const hitPresentation = Boolean(battedBall);
  if (hitPresentation) {
    const batterRoute = runnerPlay?.paths.find((path) => path.sourceBase === -1);
    const batterCanStillBeShown = batterRoute && (!batterRoute.retired || clock - batterRoute.retiredAt <= 1.6);
    setPresentationCameraMode(batterCanStillBeShown ? 'batter' : 'return');
  }
  currentPitch = null;
  battedBall = null;
  // Let the bat and batter finish a swing that was still animating when the
  // pitch result was decided. updateBatPose clears it at the end of its arc.
  if (swing && swing.progress >= 1) swing = null;
  world.ball.visible = false;
  world.trail.visible = false;
  world.batPivot.visible = true;
  world.ball.scale.setScalar(1);
  if (state?.gameOver) {
    finalizeRunnerPlay();
    pendingRoleChange = false;
  }
  else if (!runnerPlay && state) world.syncBaseRunners(state.bases);
  updateHud();
  if (state?.gameOver) {
    swing = null;
    state.gameOver = true;
    playResultAt = 0;
    gameMode = 'gameover';
    $('gameover-title').textContent = 'Practice complete';
    setTimeout(() => ui.gameover.classList.remove('hidden'), Math.min(delay * 650, 850));
    return;
  }
  if (result.type === 'side-change') {
    if (runnerPlay) {
      pendingRoleChange = true;
      nextActionAt = Infinity;
      setHint('Three outs · let the current runners finish before the next half-inning');
    } else {
      updateRole();
      nextActionAt = clock + Math.max(delay, NEXT_BATTER_READY_SECONDS);
      showRoleChange();
    }
  } else {
    const batterChanged = ['hit', 'home-run', 'walk', 'out', 'double-play'].includes(result?.type);
    const readyDelay = batterChanged ? NEXT_BATTER_READY_SECONDS : NEXT_PITCH_READY_SECONDS;
    const remainingRun = runnerPlay
      ? Math.max(0, runnerPlay.started + runnerPlay.duration - clock)
      : 0;
    const sequenceDelay = runnerPlay ? remainingRun + NEXT_PITCH_READY_SECONDS : readyDelay;
    nextActionAt = clock + Math.max(delay, sequenceDelay);
    if (gameMode === 'pitching') setHint('Wait for the runners to finish · then aim your next pitch with the phone');
    else setHint('Get your character ready · the next pitch starts in a few seconds');
  }
  updateHud();
}

function resetAfterPlay() {
  if (!state || state.gameOver) return;
  currentPitch = null;
  battedBall = null;
  swing = null;
  world.ball.visible = false;
  world.trail.visible = false;
  if (gameMode === 'pitching') {
    setPresentationCameraMode('pitching', true);
    world.setPitcherFirstPerson({ active: true, holdingBall: true });
    updatePitchAim();
  }
  updateHud();
  nextActionAt = clock + 0.25;
}

function showRoleChange() {
  showCallout('NEW INNING', 'good', 1400);
  setHint(gameMode === 'pitching'
    ? 'Your turn to pitch · point your phone where you want the pitch and hold steady briefly'
    : 'New inning · the computer is pitching · get ready to hit');
}

function showHomeRunPresentation(runs) {
  homeRunCount += 1;
  $('home-run-runs').textContent = runs === 1 ? 'SOLO' : `${runs}-RUN`;
  $('home-run-count').textContent = `${ordinalLabel(homeRunCount)} HOME RUN TODAY`;
  ui.callout.classList.add('hidden');
  clearTimeout(homeRunOverlayTimer);
  ui.homeRun.classList.remove('hidden');
  homeRunOverlayTimer = setTimeout(() => ui.homeRun.classList.add('hidden'), 3600);
}

function ordinalLabel(value) {
  const remainder = value % 100;
  if (remainder >= 11 && remainder <= 13) return `${value}TH`;
  if (value % 10 === 1) return `${value}ST`;
  if (value % 10 === 2) return `${value}ND`;
  if (value % 10 === 3) return `${value}RD`;
  return `${value}TH`;
}

function teamInitials(team) {
  return team.name.split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase();
}

function teamShortName(team) {
  return team.id.slice(0, 9).toUpperCase();
}

function updateHud() {
  if (!state) return;
  $('inning-display').textContent = `${state.half} OF THE ${ordinalLabel(state.inning)}`;
  $('count-display').textContent = `B ${state.balls}  ·  S ${state.strikes}`;
  $('inning-number').textContent = state.inning;
  $('inning-half').textContent = state.half;
  $('outs-display').textContent = `${state.outs} ${state.outs === 1 ? 'OUT' : 'OUTS'}`;
  const awayTeam = state.teams.away;
  const homeTeam = state.teams.home;
  $('away-logo').textContent = teamInitials(awayTeam);
  $('away-name').textContent = teamShortName(awayTeam);
  $('away-score').textContent = state.score.away;
  $('home-logo').textContent = teamInitials(homeTeam);
  $('home-name').textContent = teamShortName(homeTeam);
  $('home-score').textContent = state.score.home;
  const awayPanel = document.querySelector('.team-away');
  const homePanel = document.querySelector('.team-home');
  awayPanel.style.setProperty('--team-color', awayTeam.light);
  homePanel.style.setProperty('--team-color', homeTeam.light);
  awayPanel.dataset.watermark = teamInitials(awayTeam);
  homePanel.dataset.watermark = teamInitials(homeTeam);
  $('base-first').classList.toggle('occupied', Boolean(state.bases[0]));
  $('base-second').classList.toggle('occupied', Boolean(state.bases[1]));
  $('base-third').classList.toggle('occupied', Boolean(state.bases[2]));
  updatePhoneStatus();
}

function updateVisuals(dt) {
  if (world?.impact.visible) {
    const effect = world.impact.userData;
    const age = clamp((clock - effect.started) / effect.duration, 0, 1);
    const fade = 1 - age;
    effect.flash.visible = effect.mode !== 'ground';
    effect.flash.scale.setScalar(0.45 + age * (effect.mode === 'contact' ? 1.2 : 0.35));
    effect.flash.material.opacity = (effect.mode === 'contact' ? 0.88 : 0.28) * fade;
    effect.ring.scale.setScalar(0.22 + age * (effect.mode === 'ground' ? 2.2 : 4.1));
    effect.ring.material.opacity = (effect.mode === 'ground' ? 0.22 : 0.74) * fade;
    effect.light.intensity = effect.mode === 'contact' ? 22 * effect.power * fade * fade : 0;
    effect.particles.forEach((particle) => {
      if (!particle.visible) return;
      const isSpark = particle.userData.isSpark;
      particle.position.addScaledVector(particle.userData.velocity, dt);
      particle.userData.velocity.y -= (isSpark ? 5.8 : 2.4) * dt;
      particle.material.opacity = fade * (isSpark ? 0.95 : 0.42);
      particle.scale.setScalar(isSpark ? 0.68 + fade * 0.38 : 0.8 + age * 0.5);
    });
    if (age >= 1) world.impact.visible = false;
  }
  if (!state && ui.main.classList.contains('hidden') === false) {
    world.playerAway.group.position.y = Math.sin(clock * 2) * 0.035;
  } else if (world.playerAway.group.position.y !== 0) world.playerAway.group.position.y = 0;
  const hit = battedBall;
  const isHomeRunTrail = Boolean(hit?.homeRun || hit?.projectedHomeRun);
  const trailLifetime = isHomeRunTrail ? 4.5 : hit?.powerHit ? 0.76 : 0.23;
  const trailStart = ballTrail[0]?.time ?? clock;
  const effectFade = ballTrail.length ? clamp(1 - (clock - trailStart) / trailLifetime, 0, 1) : 0;
  world.trail.material.opacity = isHomeRunTrail
    ? 0.94 * Math.max(0.82, effectFade)
    : (hit?.powerHit ? 0.78 : 0.45) * effectFade;
}

function updateReticle() {
  if (!state || !reticleVisible || presentationCameraMode !== 'batting') {
    ui.aim.classList.add('hidden');
    return;
  }
  const camera = currentCamera();
  const projected = new THREE.Vector3(aimPoint.x, aimPoint.y, FIELD.zone.z).project(camera);
  ui.aim.style.left = `${(projected.x * 0.5 + 0.5) * window.innerWidth}px`;
  ui.aim.style.top = `${(-projected.y * 0.5 + 0.5) * window.innerHeight}px`;
  ui.aim.classList.remove('hidden');
  world.zone.aim.position.set(aimPoint.x, aimPoint.y, FIELD.zone.z - 0.018);
  world.zone.aim.visible = false;
}

function addToTrail(position) {
  const hit = battedBall;
  const extendedTrail = Boolean(hit?.powerHit || hit?.projectedHomeRun || hit?.homeRun);
  if (!settings.effects && !extendedTrail) return;
  const trailLifetime = hit?.homeRun || hit?.projectedHomeRun ? 4.5 : hit?.powerHit ? 0.76 : 0.23;
  ballTrail.push({ point: position.clone(), time: clock });
  ballTrail = ballTrail.filter((entry) => clock - entry.time < trailLifetime).slice(-256);
  if (ballTrail.length >= 2) {
    const attribute = world.trail.geometry.getAttribute('position');
    ballTrail.forEach((entry, index) => attribute.setXYZ(index, entry.point.x, entry.point.y, entry.point.z));
    attribute.needsUpdate = true;
    world.trail.geometry.setDrawRange(0, ballTrail.length);
  } else {
    world.trail.geometry.setDrawRange(0, 0);
  }
}

function choosePitchType() {
  const roll = Math.random();
  if (roll < 0.5) return PITCH_TYPES[0];
  if (roll < 0.7) return PITCH_TYPES[1];
  if (roll < 0.9) return PITCH_TYPES[2];
  return PITCH_TYPES[3];
}

function choosePitchCall() {
  const difficulty = DIFFICULTY_SETTINGS[selectedDifficulty];
  let call = Math.random() < difficulty.strikeChance ? 'strike' : 'ball';
  // Keep calls random while preventing long, frustrating runs of one result.
  if (lastPitchCall && repeatedPitchCalls >= difficulty.maxPitchCallStreak && call === lastPitchCall) {
    call = lastPitchCall === 'strike' ? 'ball' : 'strike';
  }
  return call;
}

function recordPitchCall(call) {
  repeatedPitchCalls = call === lastPitchCall ? repeatedPitchCalls + 1 : 1;
  lastPitchCall = call;
}

function choosePitchTarget(call, pitchType) {
  const zone = FIELD.zone;
  const insideX = () => zone.minX + 0.09 + Math.random() * (zone.maxX - zone.minX - 0.18);
  const insideY = (low = zone.minY + 0.1, high = zone.maxY - 0.1) => low + Math.random() * (high - low);

  if (call === 'strike') {
    const curveLow = pitchType.id === 'curveball' ? zone.minY + 0.32 : zone.minY + 0.1;
    const curveHigh = pitchType.id === 'curveball' ? zone.maxY - 0.14 : zone.maxY - 0.1;
    return new THREE.Vector3(insideX(), insideY(curveLow, curveHigh), zone.z);
  }

  // Miss by a small, readable amount. Curveballs and changeups tend to fall
  // below the zone; sliders and fastballs miss just beyond a side edge.
  if (pitchType.id === 'curveball' || (pitchType.id === 'cir-change' && Math.random() < 0.65)) {
    return new THREE.Vector3(insideX(), zone.minY - (0.08 + Math.random() * 0.16), zone.z);
  }
  const side = Math.random() < 0.5 ? -1 : 1;
  const edge = side < 0 ? zone.minX : zone.maxX;
  const miss = 0.08 + Math.random() * 0.15;
  return new THREE.Vector3(edge + side * miss, insideY(zone.minY + 0.2, zone.maxY - 0.28), zone.z);
}

function samplePitchPosition(pitch, elapsed) {
  const flightTime = pitch.flightTime;
  if (elapsed >= flightTime) {
    const postFlight = elapsed - flightTime;
    pitch.position.copy(pitch.target);
    pitch.position.x += pitch.velocity.x * postFlight;
    pitch.position.y += (pitch.velocity.y - pitch.gravity * flightTime) * postFlight - 0.5 * pitch.gravity * postFlight * postFlight;
    pitch.position.z += pitch.velocity.z * postFlight;
    return;
  }

  const progress = clamp(elapsed / flightTime, 0, 1);
  const lateProgress = clamp((progress - pitch.lateBreakStart) / (1 - pitch.lateBreakStart), 0, 1);
  const easedBreak = lateProgress * lateProgress * (3 - 2 * lateProgress);
  pitch.position.x = pitch.start.x + pitch.velocity.x * elapsed + pitch.breakOffset.x * easedBreak;
  pitch.position.y = pitch.start.y + pitch.velocity.y * elapsed - 0.5 * pitch.gravity * elapsed * elapsed + pitch.breakOffset.y * easedBreak;
  pitch.position.z = pitch.start.z + pitch.velocity.z * elapsed;

  if (pitch.circleRadius) {
    const circleProgress = lateProgress * lateProgress * (3 - 2 * lateProgress);
    const angle = circleProgress * Math.PI * 2;
    pitch.position.x += pitch.circleRadius * Math.sin(angle);
    pitch.position.y += pitch.circleRadius * 0.5 * (1 - Math.cos(angle));
  }
}

function showCallout(text, tone = '', duration = 900) {
  if (!text) return;
  ui.callout.textContent = text;
  ui.callout.className = `callout ${tone}`;
  persistentCallout = false;
  if (calloutTimer) clearTimeout(calloutTimer);
  calloutTimer = setTimeout(() => {
    if (!persistentCallout) ui.callout.classList.add('hidden');
  }, duration);
}

function setHint(html) {
  ui.hint.innerHTML = html;
  ui.hint.classList.toggle('hidden', gameMode === 'menu' || gameMode === 'gameover');
}

function animateImpact(group, position, duration, power = 1, mode = 'contact') {
  if (!settings.effects) return;
  group.position.copy(position);
  group.visible = true;
  const effect = group.userData;
  effect.started = clock;
  effect.duration = Math.max(0.18, duration * (mode === 'ground' ? 0.64 : 0.42));
  effect.power = clamp(power, 0.2, 1.4);
  effect.mode = mode;
  effect.flash.visible = mode !== 'ground';
  effect.flash.scale.setScalar(0.45);
  effect.flash.material.opacity = mode === 'contact' ? 0.9 : 0.3;
  effect.ring.scale.setScalar(0.22);
  effect.ring.material.opacity = mode === 'ground' ? 0.24 : 0.75;
  effect.light.intensity = 0;
  effect.particles.forEach((particle) => {
    const isSpark = particle.userData.isSpark;
    const visible = mode === 'contact' ? isSpark : mode === 'ground' ? !isSpark : false;
    particle.visible = visible;
    particle.position.set(0, 0, 0);
    particle.scale.setScalar(1);
    particle.material.opacity = visible ? 0.9 : 0;
    const horizontal = (Math.random() - 0.5) * (isSpark ? 5.2 : 3.4) * effect.power;
    const vertical = (isSpark ? 1.1 + Math.random() * 3.6 : 0.3 + Math.random() * 1.1) * effect.power;
    const forward = (Math.random() - 0.5) * (isSpark ? 4.2 : 2.5) * effect.power;
    particle.userData.velocity.set(horizontal, vertical, forward);
    if (isSpark) {
      const direction = particle.userData.velocity.clone().normalize();
      particle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    }
  });
}

function prepareImpactAudio() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    impactAudioContext ||= new AudioContextClass();
    if (impactAudioContext.state === 'suspended') impactAudioContext.resume().catch(() => {});
  } catch { /* audio is optional */ }
}

function playImpactSound(quality) {
  try {
    prepareImpactAudio();
    const context = impactAudioContext;
    if (!context) return;
    if (context.state === 'suspended') {
      context.resume().then(() => scheduleImpactSound(context, quality)).catch(() => {});
      return;
    }
    scheduleImpactSound(context, quality);
  } catch { /* audio is optional */ }
}

function scheduleImpactSound(context, quality) {
  try {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const snap = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const snapGain = context.createGain();
    const noiseBuffer = context.createBuffer(1, Math.ceil(context.sampleRate * 0.055), context.sampleRate);
    const noise = noiseBuffer.getChannelData(0);
    for (let index = 0; index < noise.length; index += 1) {
      const fade = 1 - index / noise.length;
      noise[index] = (Math.random() * 2 - 1) * fade * fade;
    }
    snap.buffer = noiseBuffer;
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1450 + quality * 700, context.currentTime);
    filter.Q.value = 0.8;
    snapGain.gain.setValueAtTime(0.055 + quality * 0.055, context.currentTime);
    snapGain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.055);
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(170 + quality * 180, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(70, context.currentTime + 0.12);
    gain.gain.setValueAtTime(0.07 + quality * 0.08, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.16);
    oscillator.connect(gain); gain.connect(context.destination);
    snap.connect(filter); filter.connect(snapGain); snapGain.connect(context.destination);
    snap.start(); snap.stop(context.currentTime + 0.06);
    oscillator.start(); oscillator.stop(context.currentTime + 0.17);
  } catch { /* audio is optional */ }
}

function currentCamera() {
  return gameMode === 'pitching' && presentationCameraMode === 'pitching'
    ? world.cameras.pitching
    : world.cameras.batting;
}

function setPresentationCameraMode(mode, snap = false) {
  presentationCameraMode = mode;
  const camera = world?.cameras?.batting;
  if (!camera) return;
  if (snap) {
    camera.position.set(0, 2.1, -5.2);
    cameraLookTarget.set(0, 1.45, FIELD.moundZ);
    camera.fov = 50;
    camera.updateProjectionMatrix();
    camera.lookAt(cameraLookTarget);
  }
  if (mode === 'pitching' && world.cameras.pitching) {
    world.cameras.pitching.position.set(0, 2.12, FIELD.moundZ + 0.34);
    world.cameras.pitching.lookAt(0, 1.18, FIELD.zone.z);
  }
}

function updatePresentationCamera(dt) {
  const camera = world.cameras.batting;
  let targetFov = 50;
  cameraDesiredPosition.set(0, 2.1, -5.2);
  cameraDesiredLook.set(0, 1.45, FIELD.moundZ);

  if (presentationCameraMode === 'ball' && battedBall) {
    const hit = battedBall;
    if (hit.throwPlay) {
      cameraDirection.set(hit.throwPlay.throwTarget.x - hit.throwStart.x, 0, hit.throwPlay.throwTarget.z - hit.throwStart.z);
    } else {
      cameraDirection.set(hit.velocity.x, 0, hit.velocity.z);
    }
    if (cameraDirection.lengthSq() < 0.01) cameraDirection.set(0, 0, 1);
    cameraDirection.normalize();
    cameraSide.set(cameraDirection.z, 0, -cameraDirection.x).normalize();
    cameraDesiredPosition.copy(hit.position)
      .addScaledVector(cameraDirection, -7.5)
      .addScaledVector(cameraSide, 3.4);
    cameraDesiredPosition.y = Math.max(3.8, hit.position.y + 3.4);
    cameraDesiredLook.copy(hit.position).addScaledVector(cameraDirection, 2.6);
    cameraDesiredLook.y = Math.max(0.8, hit.position.y * 0.82);
    targetFov = hit.homeRun || hit.projectedHomeRun ? 62 : 58;
  } else if (presentationCameraMode === 'batter') {
    const batterPath = runnerPlay?.paths.find((path) => path.sourceBase === -1);
    const batterVisible = batterPath && (!batterPath.retired || clock - batterPath.retiredAt <= 1.6);
    if (batterVisible) {
      const player = batterPath.model;
      const yaw = player.group.rotation.y;
      cameraDirection.set(Math.sin(yaw), 0, Math.cos(yaw)).normalize();
      cameraSide.set(cameraDirection.z, 0, -cameraDirection.x).normalize();
      cameraDesiredPosition.copy(player.group.position)
        .addScaledVector(cameraDirection, -5.6)
        .addScaledVector(cameraSide, 1.6);
      cameraDesiredPosition.y += 2.5;
      cameraDesiredLook.copy(player.group.position).addScaledVector(cameraDirection, 3.2);
      cameraDesiredLook.y += 0.9;
      targetFov = 54;
    } else {
      presentationCameraMode = 'return';
    }
  }

  const speed = presentationCameraMode === 'ball' ? 4.6 : presentationCameraMode === 'batter' ? 3.3 : 2.7;
  const blend = 1 - Math.exp(-dt * speed);
  camera.position.lerp(cameraDesiredPosition, blend);
  cameraLookTarget.lerp(cameraDesiredLook, blend);
  camera.fov += (targetFov - camera.fov) * blend;
  if (Math.abs(camera.fov - targetFov) > 0.08) camera.updateProjectionMatrix();
  else if (camera.fov !== targetFov) {
    camera.fov = targetFov;
    camera.updateProjectionMatrix();
  }
  camera.lookAt(cameraLookTarget);
}

function resize() {
  if (!renderer || !world) return;
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height, false);
  for (const camera of Object.values(world.cameras)) {
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
  }
  resizeComputerPhonePreview();
}

function resizeComputerPhonePreview() {
  if (!phonePreview) return;
  const { canvas, renderer: previewRenderer, camera } = phonePreview;
  const bounds = canvas.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  previewRenderer.setSize(bounds.width, bounds.height, false);
  camera.aspect = bounds.width / bounds.height;
  camera.updateProjectionMatrix();
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function swingSpeedStrong(speed) { return speed >= 8.2; }
