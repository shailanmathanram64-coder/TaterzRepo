// Preview target: phone's long axis points up and its screen faces away (-Z).
export const PHONE_EDGE_TARGET = Object.freeze({ x: 0, y: 1, z: 0, w: 0 });
const MAX_SENSOR_STEP = 0.55; // Ignore impossible one-sample jumps (>31°).
const MOTION_SWING_THRESHOLD = 90; // degrees/second; tuned for a deliberate phone swing.
const MOTION_SWING_RELEASE = 48; // Hysteresis prevents repeated swings from sensor noise.

export class PhoneBridge {
  constructor({ enabled, onSwing, onPose, onStatus, onMotionState, onOrientation }) {
    this.enabled = enabled;
    this.onSwing = onSwing;
    this.onPose = onPose;
    this.onStatus = onStatus;
    this.onMotionState = onMotionState;
    this.onOrientation = onOrientation;
    this.socket = null;
    this.lastSwingAt = 0;
    this.lastMotionSwingAt = 0;
    this.motionActive = false;
    this.filteredMotionRate = 0;
    this.previousSensorRotation = { x: 0, y: 0, z: 0, w: 1 };
    this.lastMotionAt = 0;
    this.connected = false;
    this.sensorEnabled = false;
    this.previewReference = null;
    this.filteredPreviewQuaternion = null;
    this.lastPreviewTargetQuaternion = null;
    this.lastPreviewAt = 0;
    this.shouldReconnect = true;
    this.reconnectTimer = 0;
    this.connect();
  }

  connect() {
    if (!this.shouldReconnect) return;
    const secure = location.protocol === 'https:';
    const scheme = secure ? 'wss' : 'ws';
    const host = location.host || 'localhost:8765';
    try {
      this.socket = new WebSocket(`${scheme}://${host}/ws`);
      this.socket.addEventListener('open', () => {
        this.connected = false;
        this.onStatus('disconnected');
        this.socket?.send(JSON.stringify({ type: 'hello', role: 'game' }));
      });
      this.socket.addEventListener('close', () => {
        this.connected = false;
        this.sensorEnabled = false;
        this.resetTracking();
        if (!this.shouldReconnect) return;
        this.onStatus('disconnected');
        this.reconnectTimer = setTimeout(() => this.connect(), 1800);
      });
      this.socket.addEventListener('error', () => {
        this.connected = false;
        if (this.shouldReconnect) this.onStatus('disconnected');
      });
      this.socket.addEventListener('message', (event) => {
        try { this.handleMessage(JSON.parse(event.data)); } catch { /* ignore stray text */ }
      });
    } catch {
      this.onStatus('disconnected');
    }
  }

  handleMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'hello' && message.role === 'phone') {
      this.connected = true;
      this.onStatus('connected');
      this.notifyMotionState();
      return;
    }
    if (message.type === 'peer-left' && message.role === 'phone') {
      this.connected = false;
      this.sensorEnabled = false;
      this.resetTracking();
      this.onStatus('disconnected');
      return;
    }
    if (message.type === 'sensor-status') {
      this.sensorEnabled = Boolean(message.enabled);
      this.resetTracking();
      this.notifyMotionState(this.sensorEnabled
        ? 'Motion is active. The first phone reading becomes its neutral position.'
        : 'Enable motion sensors on the phone to begin.');
      return;
    }
    if (message.type === 'sensor-sample') this.consumeSensorSample(message);
    if (message.type === 'swing') {
      const now = performance.now();
      if (now - this.lastSwingAt < 250) return;
      this.lastSwingAt = now;
      this.onSwing({ speed: clamp(Number(message.speed) || 7.5, 4, 12), angle: Number(message.angle) || 0, source: 'phone' });
    }
  }

  vibrate(durationMs = 1000) {
    const socket = this.socket;
    if (!this.connected || !socket || socket.readyState !== WebSocket.OPEN) return false;
    const duration = clamp(Number(durationMs) || 1000, 1, 1000);
    try {
      socket.send(JSON.stringify({ type: 'haptic', durationMs: duration }));
      return true;
    } catch {
      return false;
    }
  }

  getMotionState() {
    return {
      phoneConnected: this.connected,
      sensorEnabled: this.sensorEnabled,
      sampleReady: Boolean(this.previewReference),
    };
  }

  resetTracking() {
    this.previewReference = null;
    this.filteredPreviewQuaternion = null;
    this.lastPreviewTargetQuaternion = null;
    this.lastPreviewAt = 0;
    this.resetMotionState();
    this.onOrientation?.({ quaternion: PHONE_EDGE_TARGET, yaw: 0, pitch: 0, roll: 0, referenceLabel: 'WAITING FOR PHONE MOTION' });
  }

  resetMotionState() {
    this.motionActive = false;
    this.filteredMotionRate = 0;
    this.previousSensorRotation = { x: 0, y: 0, z: 0, w: 1 };
    this.lastMotionAt = 0;
  }

  consumeSensorSample(data) {
    if (!this.sensorEnabled || data.hasOrientation === false) return;
    const sample = {
      alpha: finite(data.alpha), beta: finite(data.beta), gamma: finite(data.gamma),
      alphaRate: finite(data.alphaRate), betaRate: finite(data.betaRate), gammaRate: finite(data.gammaRate),
      accelerationX: finite(data.accelerationX), accelerationY: finite(data.accelerationY), accelerationZ: finite(data.accelerationZ),
    };
    const firstSample = !this.previewReference;
    if (firstSample) this.previewReference = sample;
    this.notifyOrientation(sample);
    if (firstSample) this.notifyMotionState('Neutral position set automatically. The bat now follows the live phone preview.');
    if (this.enabled) this.consumePhoneMotion(sample);
  }

  notifyOrientation(sample) {
    if (!sample) return;
    const visualReference = this.previewReference || sample;
    const visualDelta = relativeQuaternion(visualReference, sample);
    const target = normalizeQuaternion(quaternionMultiply(PHONE_EDGE_TARGET, visualDelta));
    const now = performance.now();
    const dt = this.lastPreviewAt ? clamp((now - this.lastPreviewAt) / 1000, 0.015, 0.08) : 0.035;
    this.lastPreviewAt = now;
    const previewStep = this.lastPreviewTargetQuaternion ? quaternionDistance(this.lastPreviewTargetQuaternion, target) : 0;
    if (previewStep <= MAX_SENSOR_STEP) {
      this.lastPreviewTargetQuaternion = target;
      this.filteredPreviewQuaternion = this.filteredPreviewQuaternion
        ? slerpQuaternion(this.filteredPreviewQuaternion, target, 1 - Math.exp(-dt * 8))
        : target;
    }
    const motion = previewMotionQuaternion(this.filteredPreviewQuaternion || target);
    const angles = quaternionRotationVector(motion);
    this.onOrientation?.({
      quaternion: this.filteredPreviewQuaternion,
      yaw: angles.y * 180 / Math.PI,
      pitch: angles.x * 180 / Math.PI,
      roll: angles.z * 180 / Math.PI,
      referenceLabel: 'LIVE PHONE MOTION · INCREASING ROLL TURNS BAT CLOCKWISE',
    });
  }

  notifyMotionState(message) {
    this.onMotionState?.({ ...this.getMotionState(), message });
  }

  consumePhoneMotion(data) {
    const reference = this.previewReference || data;
    const rawDelta = relativeQuaternion(reference, data);
    const rawPreview = normalizeQuaternion(quaternionMultiply(PHONE_EDGE_TARGET, rawDelta));
    const rawMotion = previewMotionQuaternion(rawPreview);
    const displayedMotion = previewMotionQuaternion(this.filteredPreviewQuaternion || rawPreview);
    // Keep the preview's roll sign. From the batter camera, positive/increasing
    // roll then turns the bat clockwise, while decreasing roll turns it back.
    const rawBatMotion = rawMotion;
    const orientation = displayedMotion;
    const now = performance.now();
    const dt = this.lastMotionAt ? clamp((now - this.lastMotionAt) / 1000, 0.015, 0.08) : 0.035;
    this.lastMotionAt = now;
    const orientationStep = quaternionDistance(this.previousSensorRotation, rawBatMotion);
    this.previousSensorRotation = rawBatMotion;
    const rotationRate = orientationStep / dt * 180 / Math.PI;
    // iPhone Safari supplies gyroscope rates separately from orientation. Use
    // both signals: deriving rate from orientation alone can miss a quick swing
    // when Safari coalesces sensor events before sending them over the socket.
    const reportedRotationRate = Math.hypot(data.alphaRate, data.betaRate, data.gammaRate);
    const accelerationMagnitude = Math.hypot(data.accelerationX, data.accelerationY, data.accelerationZ);
    const rate = Math.max(rotationRate, reportedRotationRate, accelerationMagnitude * 24);
    this.filteredMotionRate += (rate - this.filteredMotionRate) * (rate > this.filteredMotionRate ? 0.72 : 0.28);
    const swingSignal = Math.max(rate, this.filteredMotionRate);
    // The preview already filters sensor noise. Reuse its exact pose for the bat.
    const poseRotation = quaternionRotationVector(orientation);
    const readyYaw = 0.35;
    const readyDirection = { x: -Math.cos(readyYaw), y: 0, z: Math.sin(readyYaw) };
    const pointerDirection = rotateVector(orientation, readyDirection);
    const heading = Math.atan2(pointerDirection.z, -pointerDirection.x);
    const tilt = Math.atan2(pointerDirection.y, Math.hypot(pointerDirection.x, pointerDirection.z));
    const stableHeading = deadZone(wrapAngle(heading - readyYaw) * 180 / Math.PI, 1.5);
    const stableTilt = deadZone(tilt * 180 / Math.PI, 1.5);
    const stableRoll = deadZone(poseRotation.z * 180 / Math.PI, 1.5);
    this.onPose?.({
      x: clamp(stableHeading / 120, -0.35, 0.35),
      y: clamp(stableTilt / 160, -0.28, 0.28),
      yaw: clamp(0.35 + stableHeading * 0.012, -1.2, 1.5),
      elevation: clamp(stableTilt * 0.01, -0.48, 0.48),
      rotation: orientation,
      rate: this.filteredMotionRate,
    });
    if (swingSignal > MOTION_SWING_THRESHOLD && !this.motionActive && now - this.lastMotionSwingAt > 700) {
      this.motionActive = true;
      this.lastMotionSwingAt = now;
      const speed = clamp(5.5 + swingSignal / 78, 5.5, 12);
      this.onSwing({ speed, angle: clamp(stableRoll / 90, -1, 1), source: 'motion' });
    } else if (this.filteredMotionRate < MOTION_SWING_RELEASE) this.motionActive = false;
  }

  close() {
    this.shouldReconnect = false;
    clearTimeout(this.reconnectTimer);
    this.socket?.close();
  }
}

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function finite(value) { const number = Number(value); return Number.isFinite(number) ? number : 0; }
function deadZone(value, threshold) { return Math.sign(value) * Math.max(0, Math.abs(value) - threshold); }
function relativeQuaternion(reference, sample) {
  const base = orientationQuaternion(reference);
  const current = orientationQuaternion(sample);
  return normalizeQuaternion(quaternionMultiply({ x: -base.x, y: -base.y, z: -base.z, w: base.w }, current));
}
function invertQuaternion(value) {
  const rotation = normalizeQuaternion(value);
  return { x: -rotation.x, y: -rotation.y, z: -rotation.z, w: rotation.w };
}
function rotateVector(rotation, vector) {
  const q = normalizeQuaternion(rotation);
  const u = { x: q.x, y: q.y, z: q.z };
  const cross = (a, b) => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  });
  const first = cross(u, vector);
  const second = cross(u, first);
  return {
    x: vector.x + 2 * (q.w * first.x + second.x),
    y: vector.y + 2 * (q.w * first.y + second.y),
    z: vector.z + 2 * (q.w * first.z + second.z),
  };
}
function wrapAngle(value) { return ((value + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; }
function orientationQuaternion(sample) {
  if (sample.quaternion) return normalizeQuaternion(sample.quaternion);
  const alpha = sample.alpha * Math.PI / 360;
  const beta = sample.beta * Math.PI / 360;
  const gamma = sample.gamma * Math.PI / 360;
  const cX = Math.cos(beta), cY = Math.cos(gamma), cZ = Math.cos(alpha);
  const sX = Math.sin(beta), sY = Math.sin(gamma), sZ = Math.sin(alpha);
  // W3C's quaternion form for DeviceOrientationEvent's intrinsic Z-X'-Y'' angles.
  return normalizeQuaternion({
    w: cX * cY * cZ - sX * sY * sZ,
    x: sX * cY * cZ - cX * sY * sZ,
    y: cX * sY * cZ + sX * cY * sZ,
    z: cX * cY * sZ + sX * sY * cZ,
  });
}
function quaternionMultiply(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}
function normalizeQuaternion(value) {
  const length = Math.hypot(value.x, value.y, value.z, value.w) || 1;
  return { x: value.x / length, y: value.y / length, z: value.z / length, w: value.w / length };
}
function quaternionDistance(a, b) {
  const cosine = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
  return 2 * Math.acos(clamp(cosine, -1, 1));
}
function slerpQuaternion(from, to, amount) {
  let target = to;
  let cosine = from.x * target.x + from.y * target.y + from.z * target.z + from.w * target.w;
  if (cosine < 0) {
    target = { x: -target.x, y: -target.y, z: -target.z, w: -target.w };
    cosine = -cosine;
  }
  if (cosine > 0.9995) {
    return normalizeQuaternion({
      x: from.x + (target.x - from.x) * amount,
      y: from.y + (target.y - from.y) * amount,
      z: from.z + (target.z - from.z) * amount,
      w: from.w + (target.w - from.w) * amount,
    });
  }
  const angle = Math.acos(clamp(cosine, -1, 1));
  const sine = Math.sin(angle);
  const fromWeight = Math.sin((1 - amount) * angle) / sine;
  const toWeight = Math.sin(amount * angle) / sine;
  return normalizeQuaternion({
    x: from.x * fromWeight + target.x * toWeight,
    y: from.y * fromWeight + target.y * toWeight,
    z: from.z * fromWeight + target.z * toWeight,
    w: from.w * fromWeight + target.w * toWeight,
  });
}
function quaternionRotationVector(value) {
  const q = normalizeQuaternion(value);
  if (q.w < 0) {
    q.x = -q.x; q.y = -q.y; q.z = -q.z; q.w = -q.w;
  }
  const vectorLength = Math.hypot(q.x, q.y, q.z);
  if (vectorLength < 1e-8) return { x: 0, y: 0, z: 0 };
  const angle = 2 * Math.atan2(vectorLength, clamp(q.w, -1, 1));
  const scale = angle / vectorLength;
  return { x: q.x * scale, y: q.y * scale, z: q.z * scale };
}
function previewMotionQuaternion(displayOrientation) {
  return normalizeQuaternion(quaternionMultiply(displayOrientation, invertQuaternion(PHONE_EDGE_TARGET)));
}

