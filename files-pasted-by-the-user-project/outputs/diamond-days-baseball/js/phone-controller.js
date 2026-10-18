const $ = (id) => document.getElementById(id);
const hostInput = $('host-input');
const stateLabel = $('connection-state');
const motionStatus = $('motion-status');
let socket = null;
let connectedToGame = false;
let motionReady = false;
let motionTimer = 0;
let lastOrientationAt = 0;
let sensorWarningTimer = 0;
let latestRawOrientation = null;
let latestRotationRate = { alpha: 0, beta: 0, gamma: 0 };
let latestAcceleration = { x: 0, y: 0, z: 0 };
let gravityEstimate = null;
let lastAccelerationAt = 0;
let previousOrientation = null;
let pointerStart = null;

const hostFromLink = new URLSearchParams(location.search).get('host');
hostInput.value = hostFromLink || location.host || 'localhost:8765';
$('connect-button').addEventListener('click', connect);
$('motion-button').addEventListener('click', enableMotion);
$('swing-pad').addEventListener('pointerdown', (event) => {
  event.preventDefault();
  pointerStart = { x: event.clientX, y: event.clientY, time: performance.now() };
  event.currentTarget.setPointerCapture?.(event.pointerId);
});
$('swing-pad').addEventListener('pointerup', (event) => {
  if (!pointerStart) return;
  event.preventDefault();
  const duration = Math.max(45, performance.now() - pointerStart.time);
  const dx = event.clientX - pointerStart.x;
  const dy = event.clientY - pointerStart.y;
  const velocity = Math.hypot(dx, dy) / duration;
  const speed = Math.max(4.8, Math.min(12, 5.8 + velocity * 4.1));
  send({ type: 'swing', speed, angle: Math.atan2(-dy, dx) });
  pointerStart = null;
});
$('swing-pad').addEventListener('pointercancel', () => { pointerStart = null; });

function connect() {
  socket?.close();
  const host = hostInput.value.trim().replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '').replace(/\/$/, '');
  if (!host) return;
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  try {
    const nextSocket = new WebSocket(`${scheme}://${host}/ws`);
    socket = nextSocket;
    setConnection('disconnected', 'CONNECTING…');
    nextSocket.addEventListener('open', () => {
      if (socket !== nextSocket) return;
      connectedToGame = false;
      setConnection('disconnected', 'WAITING FOR GAME…');
      nextSocket.send(JSON.stringify({ type: 'hello', role: 'phone' }));
      try { localStorage.setItem('diamond-days-host', host); } catch { /* storage can be disabled */ }
    });
    nextSocket.addEventListener('close', () => {
      if (socket !== nextSocket) return;
      connectedToGame = false;
      setConnection('disconnected', 'NOT CONNECTED');
    });
    nextSocket.addEventListener('error', () => {
      if (socket !== nextSocket) return;
      connectedToGame = false;
      setConnection('disconnected', 'COULD NOT CONNECT');
    });
    nextSocket.addEventListener('message', (event) => {
      if (socket !== nextSocket) return;
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'hello' && message.role === 'game') {
          connectedToGame = true;
          setConnection('connected', 'CONNECTED TO GAME');
          sendSensorStatus();
          queueMotionSample();
        } else if (message.type === 'peer-left' && message.role === 'game') {
          connectedToGame = false;
          setConnection('disconnected', 'GAME DISCONNECTED');
        } else if (message.type === 'haptic') {
          const duration = Math.max(1, Math.min(1000, Number(message.durationMs) || 1000));
          try { if (typeof navigator.vibrate === 'function') navigator.vibrate(duration); } catch { /* haptics are optional */ }
        }
      } catch { /* ignore non-JSON messages */ }
    });
  } catch {
    setConnection('disconnected', 'CHECK ADDRESS');
  }
}

async function enableMotion() {
  const MotionEvent = window.DeviceMotionEvent;
  const OrientationEvent = window.DeviceOrientationEvent;
  if (!window.isSecureContext) {
    motionStatus.textContent = 'This page is not trusted HTTPS, so iPhone hides its motion sensors. Open the secure phone link from the game QR code after installing the one-time iPhone profile.';
    return;
  }
  if (!MotionEvent && !OrientationEvent) {
    motionStatus.textContent = 'This device or browser does not provide motion sensor APIs. Touch batting controls still work, but phone aiming and pitching need motion sensors.';
    return;
  }
  try {
    const permissions = [];
    if (typeof MotionEvent?.requestPermission === 'function') permissions.push(MotionEvent.requestPermission());
    if (typeof OrientationEvent?.requestPermission === 'function') permissions.push(OrientationEvent.requestPermission());
    const results = await Promise.all(permissions);
    if (results.some((permission) => permission !== 'granted')) throw new Error('permission denied');

    motionReady = true;
    previousOrientation = null;
    gravityEstimate = null;
    lastAccelerationAt = 0;
    lastOrientationAt = 0;
    window.addEventListener('deviceorientation', handleOrientation, true);
    window.addEventListener('devicemotion', handleMotion, true);
    $('motion-button').textContent = 'MOTION SENSORS ENABLED';
    $('motion-button').disabled = true;
    motionStatus.textContent = 'Sensors enabled. Hold the phone in your normal playing grip; its first reading sets the neutral position automatically.';
    sendSensorStatus();
    clearTimeout(sensorWarningTimer);
    sensorWarningTimer = window.setTimeout(() => {
      if (!lastOrientationAt || Date.now() - lastOrientationAt > 1000) motionStatus.textContent = 'Permission was granted, but Safari is not sending orientation readings. Check Motion & Orientation Access in Settings, then reload this page.';
    }, 2500);
  } catch {
    motionStatus.textContent = 'iPhone did not grant motion permission. Allow it in the prompt, then tap Enable Motion Sensors again.';
  }
}

function handleOrientation(event) {
  if (!motionReady || !Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) return;
  const sample = {
    alpha: Number.isFinite(event.alpha) ? event.alpha : latestRawOrientation?.alpha ?? 0,
    beta: event.beta,
    gamma: event.gamma,
  };
  const now = performance.now();
  lastOrientationAt = Date.now();
  if (previousOrientation) {
    const elapsed = Math.max(0.01, (now - previousOrientation.time) / 1000);
    latestRotationRate = {
      alpha: angleDelta(sample.alpha, previousOrientation.sample.alpha) / elapsed,
      beta: angleDelta(sample.beta, previousOrientation.sample.beta) / elapsed,
      gamma: angleDelta(sample.gamma, previousOrientation.sample.gamma) / elapsed,
    };
  }
  previousOrientation = { sample, time: now };
  latestRawOrientation = sample;
  queueMotionSample();
}

function handleMotion(event) {
  if (!motionReady) return;
  if (event.rotationRate && [event.rotationRate.alpha, event.rotationRate.beta, event.rotationRate.gamma].some((value) => value != null)) {
    latestRotationRate = {
      alpha: event.rotationRate.alpha == null ? latestRotationRate.alpha : finiteNumber(event.rotationRate.alpha),
      beta: event.rotationRate.beta == null ? latestRotationRate.beta : finiteNumber(event.rotationRate.beta),
      gamma: event.rotationRate.gamma == null ? latestRotationRate.gamma : finiteNumber(event.rotationRate.gamma),
    };
  }
  updateAcceleration(event);
  queueMotionSample();
}

function updateAcceleration(event) {
  const now = performance.now();
  const direct = event.acceleration;
  const directValues = direct && [direct.x, direct.y, direct.z];
  if (directValues?.some((value) => typeof value === 'number' && Number.isFinite(value))) {
    latestAcceleration = {
      x: Number.isFinite(direct.x) ? direct.x : 0,
      y: Number.isFinite(direct.y) ? direct.y : 0,
      z: Number.isFinite(direct.z) ? direct.z : 0,
    };
    gravityEstimate = null;
    lastAccelerationAt = now;
    return;
  }

  const includingGravity = event.accelerationIncludingGravity;
  const values = includingGravity && [includingGravity.x, includingGravity.y, includingGravity.z];
  if (!values?.some((value) => typeof value === 'number' && Number.isFinite(value))) {
    latestAcceleration = { x: 0, y: 0, z: 0 };
    lastAccelerationAt = now;
    return;
  }
  const raw = {
    x: Number.isFinite(includingGravity.x) ? includingGravity.x : 0,
    y: Number.isFinite(includingGravity.y) ? includingGravity.y : 0,
    z: Number.isFinite(includingGravity.z) ? includingGravity.z : 0,
  };
  if (!gravityEstimate) gravityEstimate = { ...raw };
  const elapsed = lastAccelerationAt ? Math.max(0.005, Math.min(0.1, (now - lastAccelerationAt) / 1000)) : 0.02;
  const gravityBlend = 1 - Math.exp(-elapsed * 2.4);
  for (const axis of ['x', 'y', 'z']) {
    gravityEstimate[axis] += (raw[axis] - gravityEstimate[axis]) * gravityBlend;
    latestAcceleration[axis] = raw[axis] - gravityEstimate[axis];
  }
  lastAccelerationAt = now;
}

function queueMotionSample() {
  if (!motionReady || motionTimer) return;
  motionTimer = window.setTimeout(() => {
    motionTimer = 0;
    sendMotionSample();
  }, 35);
}

function sendMotionSample() {
  if (!motionReady || !connectedToGame || !socket || socket.readyState !== WebSocket.OPEN) return;
  send({
    type: 'sensor-sample',
    alpha: latestRawOrientation?.alpha ?? 0,
    beta: latestRawOrientation?.beta ?? 0,
    gamma: latestRawOrientation?.gamma ?? 0,
    alphaRate: latestRotationRate.alpha || 0,
    betaRate: latestRotationRate.beta || 0,
    gammaRate: latestRotationRate.gamma || 0,
    accelerationX: latestAcceleration.x || 0,
    accelerationY: latestAcceleration.y || 0,
    accelerationZ: latestAcceleration.z || 0,
    hasOrientation: Boolean(latestRawOrientation),
  });
}

function sendSensorStatus() {
  send({ type: 'sensor-status', enabled: motionReady });
}

function send(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN || !connectedToGame) return false;
  socket.send(JSON.stringify(message));
  return true;
}

function setConnection(className, text) {
  stateLabel.className = `connection ${className}`;
  stateLabel.querySelector('span').textContent = text;
}

function angleDelta(value, reference) { return ((value - reference + 540) % 360) - 180; }
function finiteNumber(value) { const number = Number(value); return Number.isFinite(number) ? number : 0; }

try { if (!location.host) hostInput.value = localStorage.getItem('diamond-days-host') || hostInput.value; } catch { /* storage can be disabled */ }
connect();
