import * as THREE from 'three';
import { FIELD } from './config.js';
import { createSky } from './sky.js';
import { FIELDING_RUN_SPEED } from './fielding.js';

const BATTER_POS = new THREE.Vector3(1.45, 0, -0.15);
// Local +Z points toward the pitcher; this yaw turns the batter toward screen-right.
const BATTER_STANCE_YAW = -Math.PI / 4;
const BATTER_BAT_OFFSET = new THREE.Vector3(-0.38, 1, 0.4);
const PITCHER_RELEASE = new THREE.Vector3(0, 1.78, FIELD.moundZ);
let uniformFabricTexture = null;

export function createBaseballWorld(scene) {
  const sky = createSky(THREE, scene);
  const ambientLight = new THREE.HemisphereLight(0xe9f4ff, 0x554938, 1.25);
  scene.add(ambientLight);
  const sun = new THREE.DirectionalLight(0xfff0d5, 2.65);
  sun.position.set(-40, 28, 87);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -72;
  sun.shadow.camera.right = 72;
  sun.shadow.camera.top = 92;
  sun.shadow.camera.bottom = -24;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 180;
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.00012;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 3;
  scene.add(sun);
  let windStrength = 0.45;

  function setEnvironment(options = {}) {
    const sunlight = Math.max(0.45, Math.min(1.25, (Number(options.sunlight) || 100) / 100));
    const time = sky.setTimeOfDay(options.timeOfDay || 'day');
    sun.position.copy(time.direction).multiplyScalar(100);
    sun.intensity = time.daylight * sunlight;
    ambientLight.intensity = time.ambient * (0.84 + sunlight * 0.16);
    windStrength = Math.max(0, Math.min(1, (Number(options.wind) || 0) / 100));
  }

  const grassCanvas = makeGroundTextureCanvas(THREE, 'grass');
  const gravelCanvas = makeGroundTextureCanvas(THREE, 'gravel');
  const turfMaterial = makeTexturedGroundMaterial(THREE, grassCanvas, 24, 24, 0.035);
  const turf = new THREE.Mesh(new THREE.PlaneGeometry(230, 230), turfMaterial);
  turf.rotation.x = -Math.PI / 2;
  turf.position.set(0, -0.08, 32);
  turf.receiveShadow = true;
  scene.add(turf);
  createGrassBlades(THREE, scene);
  const stadium = createStadium(THREE, scene);

  const dirtMaterial = makeTexturedGroundMaterial(THREE, gravelCanvas, 7, 10, 0.035);
  const dirtShape = new THREE.Shape();
  dirtShape.moveTo(0, 0.5);
  // The batting camera looks down +Z; negative world-X is screen-right.
  // Put first base on screen-right so the visible base path is counterclockwise.
  dirtShape.lineTo(-22.2, 19.4);
  dirtShape.lineTo(0, 41.6);
  dirtShape.lineTo(22.2, 19.4);
  dirtShape.closePath();
  const dirt = new THREE.Mesh(new THREE.ShapeGeometry(dirtShape), dirtMaterial);
  dirt.rotation.x = Math.PI / 2;
  dirt.position.y = 0.015;
  dirt.receiveShadow = true;
  scene.add(dirt);

  const foulMaterial = makeTexturedGroundMaterial(THREE, gravelCanvas, 4, 4, 0.03);
  const plateDirt = new THREE.Mesh(new THREE.CircleGeometry(5.4, 40), foulMaterial);
  plateDirt.rotation.x = -Math.PI / 2;
  plateDirt.scale.set(1.25, 0.84, 1);
  plateDirt.position.set(0, 0.02, -0.1);
  plateDirt.receiveShadow = true;
  scene.add(plateDirt);
  const moundDirt = new THREE.Mesh(new THREE.CircleGeometry(2.85, 40), makeTexturedGroundMaterial(THREE, gravelCanvas, 3, 3, 0.025));
  moundDirt.rotation.x = -Math.PI / 2;
  moundDirt.position.set(0, 0.055, FIELD.moundZ);
  moundDirt.receiveShadow = true;
  scene.add(moundDirt);
  const mound = new THREE.Mesh(new THREE.CylinderGeometry(2.45, 2.75, 0.34, 40), makeTexturedGroundMaterial(THREE, gravelCanvas, 3, 3, 0.025));
  mound.position.set(0, 0.12, FIELD.moundZ);
  mound.castShadow = true;
  mound.receiveShadow = true;
  scene.add(mound);

  const baselinePoints = [
    new THREE.Vector3(0, 0.045, 0.25),
    new THREE.Vector3(-FIELD.baseLeg, 0.045, FIELD.baseLeg),
    new THREE.Vector3(0, 0.045, FIELD.baseLeg * 2),
    new THREE.Vector3(FIELD.baseLeg, 0.045, FIELD.baseLeg),
  ];
  addLine(scene, [baselinePoints[0], baselinePoints[1]], 0xf4edcc, 0.12);
  addLine(scene, [baselinePoints[1], baselinePoints[2]], 0xf4edcc, 0.08);
  addLine(scene, [baselinePoints[2], baselinePoints[3]], 0xf4edcc, 0.08);
  addLine(scene, [baselinePoints[3], baselinePoints[0]], 0xf4edcc, 0.12);
  const baseLocations = [
    new THREE.Vector3(-FIELD.baseLeg, 0.06, FIELD.baseLeg),
    new THREE.Vector3(0, 0.06, FIELD.baseLeg * 2),
    new THREE.Vector3(FIELD.baseLeg, 0.06, FIELD.baseLeg),
  ];
  baseLocations.forEach((p) => addBase(scene, p));
  addHomePlate(scene);
  addBatterBoxes(scene);
  addPitchingRubber(scene);

  const playerAway = createPlayer(0x2b6eaa, 0xf4d35e, 0.98);
  const playerHome = createPlayer(0xb94730, 0xffd089, 0.98);
  playerAway.group.position.copy(BATTER_POS);
  playerHome.group.position.copy(BATTER_POS);
  playerAway.group.rotation.y = BATTER_STANCE_YAW;
  playerHome.group.rotation.y = BATTER_STANCE_YAW;
  scene.add(playerAway.group, playerHome.group);
  playerAway.group.visible = true;
  playerHome.group.visible = false;

  const pitcher = createPlayer(0xb94730, 0xffd089, 0.92);
  pitcher.group.position.set(0, 0.24, FIELD.moundZ + 0.1);
  pitcher.group.rotation.y = Math.PI;
  scene.add(pitcher.group);

  const fielderSpecs = [
    // Keep one infielder assigned directly beside each base; the shortstop
    // stays in the gap between second and third.
    { id: 'first', label: '1B', group: 'infield', x: -FIELD.baseLeg - 0.7, z: FIELD.baseLeg },
    { id: 'second', label: '2B', group: 'infield', x: -0.7, z: FIELD.baseLeg * 2 },
    { id: 'shortstop', label: 'SS', group: 'infield', x: 4.8, z: FIELD.baseLeg * 1.48 },
    { id: 'third', label: '3B', group: 'infield', x: FIELD.baseLeg + 0.7, z: FIELD.baseLeg },
    { id: 'left', label: 'LF', group: 'outfield', x: 32, z: 48 },
    { id: 'center', label: 'CF', group: 'outfield', x: 0, z: 56 },
    { id: 'right', label: 'RF', group: 'outfield', x: -32, z: 48 },
  ];
  const fielders = [{
    ...pitcher, id: 'pitcher', label: 'P', fieldingGroup: 'infield',
    speed: FIELDING_RUN_SPEED,
    position: pitcher.group.position,
    homePosition: pitcher.group.position.clone(),
  }];
  fielders.push(...fielderSpecs.map((spec) => {
    const player = createPlayer(0xb94730, 0xffd089, spec.group === 'infield' ? 0.82 : 0.86);
    player.group.position.set(spec.x, 0, spec.z);
    player.group.rotation.y = Math.PI;
    scene.add(player.group);
    return {
      ...spec, ...player, fieldingGroup: spec.group, speed: FIELDING_RUN_SPEED,
      position: player.group.position, homePosition: new THREE.Vector3(spec.x, 0, spec.z),
    };
  }));
  pitcher.setGlove(true);
  fielders.forEach((fielder) => fielder.setGlove(true));
  const baseRunners = baseLocations.map(() => {
    const runner = createPlayer(0x2b6eaa, 0xf4d35e, 0.78);
    runner.group.visible = false;
    scene.add(runner.group);
    return runner;
  });
  const batterRunner = createPlayer(0x2b6eaa, 0xf4d35e, 0.78);
  batterRunner.group.visible = false;
  scene.add(batterRunner.group);

  const zone = createStrikeZone(scene);
  const ball = createBaseball(scene);
  const trail = createTrail(scene);
  const impact = createImpact(scene);
  const cameras = {
    batting: new THREE.PerspectiveCamera(48, 1, 0.1, 240),
    pitching: new THREE.PerspectiveCamera(58, 1, 0.1, 240),
  };
  cameras.batting.fov = 50;
  cameras.batting.position.set(0, 2.1, -5.2);
  cameras.batting.lookAt(0, 1.45, FIELD.moundZ);
  cameras.pitching.position.set(0, 2.12, FIELD.moundZ + 0.34);
  cameras.pitching.lookAt(0, 1.18, FIELD.zone.z);

  const pitcherAim = createPitchAim(scene);
  const pitcherFirstPerson = new THREE.Group();
  const fpGlove = createBaseballGlove(createGloveMaterials());
  fpGlove.position.set(-0.39, -0.58, -1.48);
  fpGlove.rotation.set(-0.12, Math.PI, -0.08);
  fpGlove.scale.multiplyScalar(1.12);
  pitcherFirstPerson.add(fpGlove);
  const heldBall = ball.clone();
  heldBall.visible = true;
  heldBall.scale.setScalar(0.82);
  heldBall.position.set(-0.39, -0.56, -1.55);
  pitcherFirstPerson.add(heldBall);
  cameras.pitching.add(pitcherFirstPerson);

  const batPivot = new THREE.Group();
  const batMaterial = new THREE.MeshStandardMaterial({ color: 0xd2a16a, roughness: 0.58, metalness: 0.02 });
  const bat = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.06, 1.9, 12), batMaterial);
  bat.position.y = 0.95;
  bat.castShadow = true;
  batPivot.add(bat);
  batPivot.position.copy(BATTER_BAT_OFFSET.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -BATTER_STANCE_YAW));
  const restDirection = new THREE.Vector3(-Math.cos(0.35), 0, Math.sin(0.35));
  const restOrientation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), restDirection);
  batPivot.quaternion.copy(playerAway.group.quaternion.clone().invert().multiply(restOrientation));
  playerAway.group.add(batPivot);
  posePlayerBatGrip(playerAway, batPivot);

  return {
    scene, cameras, ball, trail, impact, zone, batPivot, playerAway, playerHome, pitcher,
    batterStanceYaw: BATTER_STANCE_YAW, batterBatOffset: BATTER_BAT_OFFSET.clone(),
    poseBatHoldingArms: (player) => posePlayerBatGrip(player, batPivot),
    fielders, baseRunners, batterRunner,
    setEnvironment,
    updateSky: (time, camera) => sky.update(time, camera, windStrength),
    updateCrowd: (time) => stadium.update(time),
    stadiumWallRadius: (height) => stadium.wallRadiusAt(height),
    release: PITCHER_RELEASE,
    pitcherAim,
    setPitcherFirstPerson({ active = false, throwing = 0, holdingBall = true } = {}) {
      pitcherFirstPerson.visible = active;
      heldBall.visible = active && holdingBall;
      pitcherAim.visible = active && holdingBall;
      const progress = Math.max(0, Math.min(1, throwing));
      const followThrough = Math.sin(progress * Math.PI);
      fpGlove.position.set(-0.39 + followThrough * 0.48, -0.58 + followThrough * 0.28, -1.48 + followThrough * 0.12);
      fpGlove.rotation.set(-0.12 + followThrough * 0.28, Math.PI, -0.08 - followThrough * 0.72);
    },
    setPitchAim(position) {
      pitcherAim.position.copy(position);
    },
    plate: new THREE.Vector3(0, 1.12, FIELD.zone.z),
    baseLocations,
    homeLocation: new THREE.Vector3(0, 0.02, 0.25),
    syncBaseRunners(bases) {
      baseRunners.forEach((runner, index) => {
        runner.group.visible = Boolean(bases[index]);
        runner.group.position.copy(baseLocations[index]);
        runner.group.rotation.y = Math.PI;
      });
      batterRunner.group.visible = false;
    },
    updateFielders(dt, plan) {
      for (const fielder of fielders) {
        let target = fielder.homePosition;
        if (plan?.throwing && plan.throwTargetId === fielder.id) target = plan.throwTarget;
        else if (plan?.fielderId === fielder.id) target = plan.target;
        else if (plan?.coverage?.[fielder.id]) target = plan.coverage[fielder.id];
        const dx = target.x - fielder.position.x;
        const dz = target.z - fielder.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance > 0.025) {
          const step = Math.min(distance, fielder.speed * dt);
          fielder.position.x += (dx / distance) * step;
          fielder.position.z += (dz / distance) * step;
          fielder.group.rotation.y = Math.atan2(-dx, -dz);
        }
        animateFielder(fielder, dt, distance > 0.025);
      }
    },
    startPitcherThrow(time) {
      pitcher.throwStartedAt = time;
    },
    updatePitcherThrow(time) {
      if (!Number.isFinite(pitcher.throwStartedAt)) return;
      const elapsed = time - pitcher.throwStartedAt;
      if (elapsed < 0) return;
      const phase = Math.min(1, elapsed / 0.82);
      const shoulder = pitcher.arms[0].userData.shoulder;
      let hand;
      if (phase < 0.35) {
        const t = phase / 0.35;
        hand = new THREE.Vector3(-0.52, 0.96 + 0.9 * t, 0.02 - 0.5 * t);
      } else if (phase < 0.58) {
        const t = (phase - 0.35) / 0.23;
        const eased = t * t * (3 - 2 * t);
        hand = new THREE.Vector3(-0.52, 1.86 - 0.26 * eased, -0.48 + 0.92 * eased);
      } else {
        const t = (phase - 0.58) / 0.42;
        hand = new THREE.Vector3(-0.52, 1.6 - 0.5 * t, 0.44 - 0.36 * t);
      }
      poseLimb(pitcher.arms[0], pitcher.hands[0], shoulder, hand);
      pitcher.group.rotation.z = Math.sin(Math.min(phase / 0.58, 1) * Math.PI) * -0.09;
      if (phase >= 1) {
        poseLimb(pitcher.arms[0], pitcher.hands[0], shoulder, new THREE.Vector3(-0.48, 0.96, 0.02));
        pitcher.group.rotation.z = 0;
        pitcher.throwStartedAt = -Infinity;
      }
    },
    setRoles(battingSide, battingColor, battingAccent, pitchingColor, pitchingAccent) {
      const batter = battingSide === 'away' ? playerAway : playerHome;
      const other = battingSide === 'away' ? playerHome : playerAway;
      batter.group.visible = true;
      other.group.visible = false;
      updatePlayerColors(batter, battingColor, battingAccent);
      updatePlayerColors(other, pitchingColor, pitchingAccent);
      updatePlayerColors(pitcher, pitchingColor, pitchingAccent);
      fielders.forEach((fielder) => updatePlayerColors(fielder, pitchingColor, pitchingAccent));
      baseRunners.forEach((runner) => updatePlayerColors(runner, battingColor, battingAccent));
      updatePlayerColors(batterRunner, battingColor, battingAccent);
      batter.setGlove(false);
      other.setGlove(false);
      pitcher.setGlove(true);
      fielders.forEach((fielder) => fielder.setGlove(true));
      baseRunners.forEach((runner) => runner.setGlove(false));
      batterRunner.setGlove(false);
      const oldParent = batPivot.parent;
      oldParent?.remove(batPivot);
      batter.group.rotation.y = BATTER_STANCE_YAW;
      batter.group.add(batPivot);
      batPivot.position.copy(BATTER_BAT_OFFSET.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -BATTER_STANCE_YAW));
      batPivot.quaternion.copy(batter.group.quaternion.clone().invert().multiply(restOrientation));
      posePlayerBatGrip(batter, batPivot);
      batPivot.visible = true;
      return { batter, pitcher, fielders, baseRunners, batterRunner };
    },
  };
}

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.98;
  return renderer;
}

function makeGroundTextureCanvas(THREE, kind) {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  const image = context.createImageData(size, size);
  const seed = kind === 'grass' ? 84031 : 197411;
  const random = makeSeededRandom(seed);
  const base = kind === 'grass' ? [79, 124, 59] : [155, 108, 76];
  const strength = kind === 'grass' ? [24, 28, 17] : [27, 25, 20];
  const fields = [];
  for (let octave = 0; octave < 6; octave += 1) {
    const cells = 4 * (2 ** octave);
    const values = new Float32Array(cells * cells);
    for (let index = 0; index < values.length; index += 1) values[index] = random() * 2 - 1;
    fields.push({ cells, values, weight: 0.58 ** octave });
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let noise = 0;
      let totalWeight = 0;
      for (const field of fields) {
        const { cells, values, weight } = field;
        const fx = (x / size) * cells;
        const fy = (y / size) * cells;
        const x0 = Math.floor(fx) % cells;
        const y0 = Math.floor(fy) % cells;
        const x1 = (x0 + 1) % cells;
        const y1 = (y0 + 1) % cells;
        const tx0 = fx - Math.floor(fx);
        const ty0 = fy - Math.floor(fy);
        const tx = tx0 * tx0 * (3 - 2 * tx0);
        const ty = ty0 * ty0 * (3 - 2 * ty0);
        const a = values[y0 * cells + x0] * (1 - tx) + values[y0 * cells + x1] * tx;
        const b = values[y1 * cells + x0] * (1 - tx) + values[y1 * cells + x1] * tx;
        noise += (a * (1 - ty) + b * ty) * weight;
        totalWeight += weight;
      }
      const grain = noise / totalWeight;
      const pixel = (y * size + x) * 4;
      const fineNoise = (random() - 0.5) * 8;
      image.data[pixel] = THREE.MathUtils.clamp(base[0] + grain * strength[0] + fineNoise, 0, 255);
      image.data[pixel + 1] = THREE.MathUtils.clamp(base[1] + grain * strength[1] + fineNoise, 0, 255);
      image.data[pixel + 2] = THREE.MathUtils.clamp(base[2] + grain * strength[2] + fineNoise, 0, 255);
      image.data[pixel + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);

  if (kind === 'gravel') {
    for (let index = 0; index < 2600; index += 1) {
      const x = random() * size;
      const y = random() * size;
      const rx = 0.7 + random() * 2.7;
      const ry = 0.55 + random() * 1.8;
      const rotation = random() * Math.PI;
      const tone = Math.floor(random() * 36) - 18;
      const color = `rgb(${Math.min(220, 156 + tone)},${Math.min(185, 108 + tone)},${Math.min(150, 76 + tone)})`;
      for (const ox of [-size, 0, size]) {
        for (const oy of [-size, 0, size]) {
          if (ox < 0 && x < size - rx || ox > 0 && x > rx || oy < 0 && y < size - ry || oy > 0 && y > ry) continue;
          context.save();
          context.translate(x + ox, y + oy);
          context.rotate(rotation);
          context.fillStyle = 'rgba(61,42,32,0.23)';
          context.beginPath();
          context.ellipse(0.45, 0.65, rx * 1.12, ry * 1.12, 0, 0, Math.PI * 2);
          context.fill();
          context.fillStyle = color;
          context.beginPath();
          context.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
          context.fill();
          context.strokeStyle = 'rgba(244,207,163,0.28)';
          context.lineWidth = 0.55;
          context.beginPath();
          context.arc(-0.2, -0.2, rx * 0.58, Math.PI * 1.05, Math.PI * 1.72);
          context.stroke();
          context.restore();
        }
      }
    }
  }
  return canvas;
}

function makeTexturedGroundMaterial(THREE, canvas, repeatX, repeatY, bumpScale) {
  const map = makeCanvasTexture(THREE, canvas, repeatX, repeatY, true);
  const bumpMap = makeCanvasTexture(THREE, canvas, repeatX, repeatY, false);
  return new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map,
    bumpMap,
    bumpScale,
    roughness: 0.96,
    metalness: 0,
  });
}

function makeCanvasTexture(THREE, canvas, repeatX, repeatY, isColor) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function makeSeededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function createGrassBlades(THREE, scene) {
  const positions = [];
  const indices = [];
  const addBlade = (angle) => {
    const first = positions.length / 3;
    const sideX = Math.cos(angle);
    const sideZ = Math.sin(angle);
    const addVertex = (across, height, depth) => {
      positions.push(sideX * across, height, sideZ * across + depth);
    };
    addVertex(-0.009, 0, 0);
    addVertex(0.009, 0, 0);
    addVertex(-0.0055, 0.045, 0.003);
    addVertex(0.0055, 0.045, 0.003);
    addVertex(0, 0.095, 0.008);
    indices.push(first, first + 1, first + 2, first + 1, first + 3, first + 2, first + 2, first + 3, first + 4);
  };
  addBlade(0);
  addBlade(Math.PI / 2);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const count = 24000;
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.92,
    side: THREE.DoubleSide,
  });
  const blades = new THREE.InstancedMesh(geometry, material, count);
  blades.castShadow = false;
  blades.receiveShadow = false;
  blades.frustumCulled = false;
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  let index = 0;
  let attempts = 0;
  while (index < count && attempts < count * 3) {
    attempts += 1;
    const x = -50 + Math.random() * 100;
    const z = -8 + Math.random() * 82;
    if (insideDirtDiamond(x, z)) continue;
    if ((x / 7.0) ** 2 + ((z + 0.1) / 4.65) ** 2 < 1.05) continue;
    if (x ** 2 + (z - FIELD.moundZ) ** 2 < 3.0 ** 2) continue;
    dummy.position.set(x, -0.069, z);
    dummy.rotation.set(0, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.12);
    const height = 0.68 + Math.random() * 1.0;
    const width = 0.75 + Math.random() * 0.65;
    dummy.scale.set(width, height, width);
    dummy.updateMatrix();
    blades.setMatrixAt(index, dummy.matrix);
    const hue = 0.22 + Math.random() * 0.035;
    const saturation = 0.48 + Math.random() * 0.24;
    const lightness = 0.24 + Math.random() * 0.21;
    tint.setHSL(hue, saturation, lightness);
    blades.setColorAt(index, tint);
    index += 1;
  }
  blades.count = index;
  blades.instanceMatrix.needsUpdate = true;
  if (blades.instanceColor) blades.instanceColor.needsUpdate = true;
  scene.add(blades);
}

function insideDirtDiamond(x, z) {
  const vertices = [[0, 0.5], [-22.2, 19.4], [0, 41.6], [22.2, 19.4]];
  let inside = false;
  for (let index = 0, previous = vertices.length - 1; index < vertices.length; previous = index, index += 1) {
    const [xi, zi] = vertices[index];
    const [xj, zj] = vertices[previous];
    const crosses = (zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function createStadium(THREE, scene) {
  const arcStart = -Math.PI;
  const arcLength = Math.PI * 2;
  const tiers = [
    { inner: 61, outer: 77, bottom: 0.8, height: 14.5, rows: 8, color: 0x68717b },
    { inner: 79, outer: 95, bottom: 16.2, height: 16.8, rows: 9, color: 0x505d6a },
  ];
  for (const tier of tiers) {
    const shell = new THREE.Mesh(
      new THREE.CylinderGeometry(tier.outer, tier.inner, tier.height, 112, 1, true, arcStart, arcLength),
      new THREE.MeshStandardMaterial({ color: tier.color, roughness: 0.94, side: THREE.DoubleSide, flatShading: true }),
    );
    shell.position.y = tier.bottom + tier.height / 2;
    shell.receiveShadow = true;
    scene.add(shell);
    addStadiumBand(THREE, scene, tier, tier.bottom + tier.height * 0.27, 1.05, 0x0878d1, 0x062c64, arcStart, arcLength);
    addStadiumBand(THREE, scene, tier, tier.bottom + tier.height * 0.72, 1.05, 0xe33d45, 0x63171e, arcStart, arcLength);
    addStadiumRail(THREE, scene, tier.outer, tier.bottom + tier.height, arcStart, arcLength, 0xd5c8a8);
  }
  const crowd = createPlayerCrowd(THREE, scene, tiers);
  // The live score is shown in the on-screen GUI, so the outfield stays clear.
  return {
    update: crowd.update,
    wallRadiusAt(height) {
      for (let index = 0; index < tiers.length; index += 1) {
        const tier = tiers[index];
        const top = tier.bottom + tier.height;
        if (height <= top) {
          const fraction = THREE.MathUtils.clamp((height - tier.bottom) / tier.height, 0, 1);
          return tier.inner + (tier.outer - tier.inner) * fraction;
        }
        const next = tiers[index + 1];
        if (next && height < next.bottom) {
          const gapProgress = (height - top) / (next.bottom - top);
          return tier.outer + (next.inner - tier.outer) * gapProgress;
        }
      }
      return tiers[tiers.length - 1].outer;
    },
  };
}

function createPlayerCrowd(THREE, scene, tiers) {
  const shirtColors = [0x8e50bd, 0x2bad62, 0xf08332, 0xf3ca42, 0x3583d4, 0xd84b4b, 0x262a31, 0xf3f0e8];
  const skinColors = [0xd69b76, 0xb87a5c, 0x8d5e4a, 0xf0c9a2, 0x614333];
  const shoeColors = [0x282b30, 0xede8df, 0x3e5b82, 0x84552f];
  const rows = [];
  const seatSpacing = 1.48;
  for (const tier of tiers) {
    for (let row = 0; row < tier.rows; row += 1) {
      const baseY = tier.bottom + 0.85 + row * 1.45;
      const torsoY = baseY + 1.08 * 0.52;
      const wallRadius = tier.inner + (tier.outer - tier.inner) * ((torsoY - tier.bottom) / tier.height);
      const radius = wallRadius - 0.45;
      const count = Math.max(48, Math.floor((radius * Math.PI * 2) / seatSpacing));
      rows.push({
        radius,
        count,
        baseY,
        phaseOffset: Math.random() * Math.PI * 2,
      });
    }
  }
  const fanCount = rows.reduce((sum, row) => sum + row.count, 0);
  const shirtMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.98, bumpMap: getUniformFabricTexture(), bumpScale: 0.012,
  });
  const skinMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88 });
  const shoeMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82 });
  const torso = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.42, 0.32, 4, 10), shirtMaterial, fanCount);
  const head = new THREE.InstancedMesh(createFaceGeometry(), skinMaterial, fanCount);
  const arms = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.135, 0.46, 2, 6), shirtMaterial, fanCount * 2);
  const hands = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 9, 6), skinMaterial, fanCount * 2);
  const shoes = new THREE.InstancedMesh(new THREE.SphereGeometry(0.19, 9, 6), shoeMaterial, fanCount * 2);
  const playerMeshes = [torso, head, arms, hands, shoes];
  playerMeshes.forEach((mesh) => {
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  });

  const fans = [];
  const color = new THREE.Color();
  let index = 0;
  for (const row of rows) {
    for (let seat = 0; seat < row.count; seat += 1) {
      const angle = -Math.PI + (seat + (row.count % 2 ? 0 : 0.5)) / row.count * Math.PI * 2;
      const scale = 0.49 + Math.random() * 0.055;
      const shirtColor = shirtColors[Math.floor(Math.random() * shirtColors.length)];
      const skinColor = skinColors[Math.floor(Math.random() * skinColors.length)];
      const shoeColor = shoeColors[Math.floor(Math.random() * shoeColors.length)];
      color.setHex(shirtColor);
      torso.setColorAt(index, color);
      arms.setColorAt(index * 2, color);
      arms.setColorAt(index * 2 + 1, color);
      color.setHex(skinColor);
      head.setColorAt(index, color);
      hands.setColorAt(index * 2, color);
      hands.setColorAt(index * 2 + 1, color);
      color.setHex(shoeColor);
      shoes.setColorAt(index * 2, color);
      shoes.setColorAt(index * 2 + 1, color);
      fans.push({
        angle, radius: row.radius + (Math.random() - 0.5) * 0.18, baseY: row.baseY,
        scale, phase: row.phaseOffset + Math.random() * Math.PI * 2,
      });
      index += 1;
    }
  }
  playerMeshes.forEach((mesh) => {
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });
  scene.add(...playerMeshes);

  const dummy = new THREE.Object3D();
  const facingAxis = new THREE.Vector3(0, 1, 0);
  const armAxis = new THREE.Vector3(0, 0, 1);
  const facing = new THREE.Quaternion();
  const localRotation = new THREE.Quaternion();
  const matrixPosition = new THREE.Vector3();
  const meshScale = new THREE.Vector3();
  const center = new THREE.Vector3();
  const unitScale = [1, 1, 1];
  const shoeScale = [1.05, 0.62, 1.36];

  function setPart(mesh, instance, fan, localX, localY, localZ, partScale, rotation = 0) {
    matrixPosition.set(localX, localY, localZ).multiplyScalar(fan.scale).applyQuaternion(facing);
    dummy.position.copy(center).add(matrixPosition);
    if (rotation) {
      localRotation.setFromAxisAngle(armAxis, rotation);
      dummy.quaternion.copy(facing).multiply(localRotation);
    } else dummy.quaternion.copy(facing);
    meshScale.set(partScale[0] * fan.scale, partScale[1] * fan.scale, partScale[2] * fan.scale);
    dummy.scale.copy(meshScale);
    dummy.updateMatrix();
    mesh.setMatrixAt(instance, dummy.matrix);
  }

  function update(time) {
    for (let fanIndex = 0; fanIndex < fans.length; fanIndex += 1) {
      const fan = fans[fanIndex];
      const jump = Math.max(0, Math.sin(time * 3.6 + fan.phase)) * 0.34;
      facing.setFromAxisAngle(facingAxis, fan.angle + Math.PI);
      center.set(Math.sin(fan.angle) * fan.radius, fan.baseY + jump, Math.cos(fan.angle) * fan.radius);
      setPart(torso, fanIndex, fan, 0, 1.08, 0, unitScale);
      setPart(head, fanIndex, fan, 0, 2.38, -0.02, unitScale);
      for (let sideIndex = 0; sideIndex < 2; sideIndex += 1) {
        const side = sideIndex === 0 ? -1 : 1;
        const instance = fanIndex * 2 + sideIndex;
        setPart(arms, instance, fan, side * 0.4, 1.24, 0.01, unitScale, side * -0.18);
        setPart(hands, instance, fan, side * 0.48, 0.96, 0.02, unitScale);
        setPart(shoes, instance, fan, side * 0.2, 0.14, 0.035, shoeScale);
      }
    }
    playerMeshes.forEach((mesh) => { mesh.instanceMatrix.needsUpdate = true; });
  }

  update(0);
  return { update };
}

function addStadiumBand(THREE, scene, tier, centerY, bandHeight, color, emissive, arcStart, arcLength) {
  const radiusAt = (y) => tier.inner + (tier.outer - tier.inner) * ((y - tier.bottom) / tier.height) - 0.62;
  const bottomRadius = radiusAt(centerY - bandHeight / 2);
  const topRadius = radiusAt(centerY + bandHeight / 2);
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(topRadius, bottomRadius, bandHeight, 112, 1, true, arcStart, arcLength),
    new THREE.MeshStandardMaterial({
      color,
      emissive,
      emissiveIntensity: 0.24,
      roughness: 0.72,
      side: THREE.DoubleSide,
      flatShading: true,
    }),
  );
  band.position.y = centerY;
  band.receiveShadow = true;
  scene.add(band);
}

function addStadiumRail(THREE, scene, radius, y, arcStart, arcLength, color) {
  const points = [];
  for (let index = 0; index <= 72; index += 1) {
    const angle = arcStart + arcLength * (index / 72);
    points.push(new THREE.Vector3(Math.sin(angle) * radius, y, Math.cos(angle) * radius));
  }
  const curve = new THREE.CatmullRomCurve3(points);
  const rail = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 144, 0.28, 5, false),
    new THREE.MeshStandardMaterial({ color, roughness: 0.82, flatShading: true }),
  );
  rail.castShadow = true;
  scene.add(rail);
}

export function updateBallStitches(ballGroup, rotation) {
  ballGroup.rotation.copy(rotation);
}

export function distanceToSegment(point, start, end) {
  const segment = end.clone().sub(start);
  const lengthSq = segment.lengthSq();
  const t = lengthSq ? Math.max(0, Math.min(1, point.clone().sub(start).dot(segment) / lengthSq)) : 0;
  return point.distanceTo(start.clone().addScaledVector(segment, t));
}

export function batWorldSegment(batPivot) {
  batPivot.updateWorldMatrix(true, false);
  const a = new THREE.Vector3(0, 0.08, 0).applyMatrix4(batPivot.matrixWorld);
  const b = new THREE.Vector3(0, 1.89, 0).applyMatrix4(batPivot.matrixWorld);
  return { a, b, direction: b.clone().sub(a).normalize() };
}

function addLine(scene, points, color, radius) {
  const curve = new THREE.CatmullRomCurve3(points);
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, points.length * 8), radius / 2, 5, false), new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
  mesh.position.y = radius / 2;
  scene.add(mesh);
  return mesh;
}

function addBase(scene, position) {
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.15, 1.15), new THREE.MeshStandardMaterial({ color: 0xf8f2dd, roughness: 0.8 }));
  base.position.copy(position);
  base.rotation.y = Math.PI / 4;
  base.castShadow = true;
  scene.add(base);
}

function addHomePlate(scene) {
  const shape = new THREE.Shape();
  shape.moveTo(-0.52, 0.24); shape.lineTo(0.52, 0.24); shape.lineTo(0.52, -0.28); shape.lineTo(0, -0.75); shape.lineTo(-0.52, -0.28); shape.closePath();
  const plate = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color: 0xfff8e8, side: THREE.DoubleSide, roughness: 0.72 }));
  plate.rotation.x = Math.PI / 2;
  plate.position.set(0, 0.07, 0.05);
  plate.castShadow = true;
  scene.add(plate);
}

function addBatterBoxes(scene) {
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xf3ead0, roughness: 1 });
  for (const x of [-1.7, 1.7]) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.035, 2.35), lineMat);
    box.position.set(x, 0.055, -0.45);
    scene.add(box);
  }
  for (const x of [-1.15, 1.15]) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.035, 0.09), lineMat);
    box.position.set(x, 0.055, -1.58);
    scene.add(box);
  }
}

function addPitchingRubber(scene) {
  const rubber = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.08, 0.18), new THREE.MeshStandardMaterial({ color: 0xf7efda }));
  rubber.position.set(0, 0.35, FIELD.moundZ);
  scene.add(rubber);
}

function createPlayer(bodyColor, accentColor, scale = 1) {
  const group = new THREE.Group();
  group.scale.setScalar(scale);
  const fabric = getUniformFabricTexture();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: bodyColor, roughness: 0.98, bumpMap: fabric, bumpScale: 0.012,
  });
  const accentMat = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.8 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xd89a70, roughness: 0.88 });
  const helmetMat = new THREE.MeshStandardMaterial({
    color: bodyColor, roughness: 0.98, bumpMap: fabric, bumpScale: 0.008, side: THREE.DoubleSide,
  });
  const gloveMaterials = createGloveMaterials();
  const feet = [];
  const arms = [];
  const hands = [];
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.32, 4, 10), bodyMat);
  torso.position.set(0, 1.08, 0); torso.castShadow = true; group.add(torso);
  const head = createCharacterHead(skinMat, helmetMat);
  head.position.set(0, 2.38, -0.02);
  group.add(head);
  for (const side of [-1, 1]) {
    const shoe = new THREE.Mesh(new THREE.SphereGeometry(0.19, 9, 6), accentMat);
    shoe.position.set(side * 0.2, 0.14, 0.035);
    shoe.scale.set(1.05, 0.62, 1.36);
    shoe.castShadow = true;
    shoe.userData.restPosition = shoe.position.clone();
    group.add(shoe);
    feet.push(shoe);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.135, 0.46, 2, 6), bodyMat);
    arm.position.set(side * 0.4, 1.24, 0.01);
    arm.rotation.z = side * -0.18;
    arm.userData.restLength = 0.73;
    arm.userData.shoulder = new THREE.Vector3(side * 0.4, 1.36, 0.03);
    arm.castShadow = true;
    group.add(arm);
    arms.push(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.12, 9, 6), skinMat);
    hand.position.set(side * 0.48, 0.96, 0.02);
    hand.castShadow = true;
    group.add(hand);
    hands.push(hand);
  }
  const glove = createBaseballGlove(gloveMaterials);
  glove.visible = false;
  glove.position.set(0.48, 0.96, 0.04);
  group.add(glove);
  const gloveHand = hands[1];
  const player = {
    group, bodyMat, accentMat, helmetMat, feet, arms, hands,
    batArm: arms[0], batHand: hands[0], supportArm: arms[1], supportHand: hands[1],
    glove, throwStartedAt: -Infinity,
    animateRun(phase, moving, dt) { animatePlayerRun(this, phase, moving, dt); },
    resetRunPose() { resetPlayerRunPose(this); },
    setGlove(visible) {
      glove.visible = visible;
      gloveHand.visible = !visible;
    },
  };
  arms[1].userData.batShoulder = new THREE.Vector3(0.18, 1.32, 0.08);
  return player;
}

function getUniformFabricTexture() {
  if (uniformFabricTexture) return uniformFabricTexture;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  const image = context.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const weaveA = Math.sin(((x + y) / 4) * Math.PI * 2) * 8;
      const weaveB = Math.sin(((x - y) / 4) * Math.PI * 2) * 7;
      const fiber = Math.sin((x * 13 + y * 7) * (Math.PI * 2 / size)) * 3;
      const value = Math.max(0, Math.min(255, 150 + weaveA + weaveB + fiber));
      const index = (y * size + x) * 4;
      image.data[index] = value;
      image.data[index + 1] = value;
      image.data[index + 2] = value;
      image.data[index + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  uniformFabricTexture = new THREE.CanvasTexture(canvas);
  uniformFabricTexture.wrapS = THREE.RepeatWrapping;
  uniformFabricTexture.wrapT = THREE.RepeatWrapping;
  uniformFabricTexture.repeat.set(3, 3);
  uniformFabricTexture.colorSpace = THREE.NoColorSpace;
  uniformFabricTexture.anisotropy = 4;
  uniformFabricTexture.needsUpdate = true;
  return uniformFabricTexture;
}

function createCharacterHead(skinMat, helmetMat) {
  const head = new THREE.Group();
  const face = new THREE.Mesh(createFaceGeometry(), skinMat);
  face.castShadow = true;
  head.add(face);

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.54, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), helmetMat);
  helmet.position.set(0, 0.105, -0.02);
  helmet.castShadow = true;
  head.add(helmet);
  const brimShape = new THREE.Shape();
  brimShape.moveTo(-0.31, 0.17);
  brimShape.quadraticCurveTo(0, 0.31, 0.31, 0.17);
  brimShape.quadraticCurveTo(0.47, 0.42, 0.31, 0.56);
  brimShape.quadraticCurveTo(0, 0.64, -0.31, 0.56);
  brimShape.quadraticCurveTo(-0.47, 0.42, -0.31, 0.17);
  const brim = new THREE.Mesh(new THREE.ExtrudeGeometry(brimShape, {
    depth: 0.055, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.018, bevelThickness: 0.012,
  }), helmetMat);
  brim.rotation.x = Math.PI / 2;
  brim.position.set(0, 0.16, 0.01);
  brim.castShadow = true;
  head.add(brim);

  const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xfffaf1, roughness: 0.68 });
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x211d21, roughness: 0.55 });
  const browMat = new THREE.MeshStandardMaterial({ color: 0x392821, roughness: 0.9 });
  const noseMat = skinMat;
  const smileMat = new THREE.MeshStandardMaterial({ color: 0x75473d, roughness: 0.9 });

  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.105, 9, 7), skinMat);
    ear.position.set(side * 0.445, 0.005, 0.005);
    ear.scale.set(0.72, 0.88, 0.48);
    head.add(ear);

    const white = new THREE.Mesh(new THREE.SphereGeometry(0.061, 10, 8), eyeWhite);
    white.position.set(side * 0.145, 0.065, 0.432);
    head.add(white);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.029, 9, 7), pupilMat);
    pupil.position.set(side * 0.145, 0.063, 0.481);
    head.add(pupil);

    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.145, 0.026, 0.025), browMat);
    brow.position.set(side * 0.145, 0.17, 0.426);
    brow.rotation.z = side * -0.06;
    head.add(brow);
  }

  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.055, 9, 7), noseMat);
  nose.position.set(0, -0.025, 0.477);
  head.add(nose);
  const smileCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.105, -0.15, 0.432),
    new THREE.Vector3(0, -0.18, 0.456),
    new THREE.Vector3(0.105, -0.15, 0.432),
  ]);
  const smile = new THREE.Mesh(new THREE.TubeGeometry(smileCurve, 8, 0.009, 4, false), smileMat);
  head.add(smile);
  return head;
}

function createFaceGeometry() {
  const faceGeometry = new THREE.SphereGeometry(0.48, 16, 12);
  const facePositions = faceGeometry.attributes.position;
  for (let index = 0; index < facePositions.count; index += 1) {
    const y = facePositions.getY(index);
    const z = facePositions.getZ(index);
    const lowerFace = Math.max(0, Math.min(1, (-y - 0.2) / 0.28));
    const frontFace = Math.max(0, Math.min(1, (z + 0.04) / 0.46));
    const chin = lowerFace * frontFace;
    facePositions.setY(index, y - 0.035 * chin);
    facePositions.setZ(index, z + 0.045 * chin);
  }
  faceGeometry.computeVertexNormals();
  return faceGeometry;
}

function createGloveMaterials() {
  return {
    leather: new THREE.MeshStandardMaterial({ color: 0x92502c, roughness: 0.78 }),
    darkLeather: new THREE.MeshStandardMaterial({ color: 0x5b3021, roughness: 0.86 }),
    pocket: new THREE.MeshStandardMaterial({ color: 0x3f241c, roughness: 0.92 }),
    piping: new THREE.MeshStandardMaterial({ color: 0xc58a52, roughness: 0.72 }),
  };
}

function createBaseballGlove(materials) {
  const glove = new THREE.Group();
  const palm = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 9), materials.leather);
  palm.scale.set(0.92, 1.17, 0.52);
  palm.position.z = 0.035;
  glove.add(palm);
  const pocket = new THREE.Mesh(new THREE.SphereGeometry(0.145, 12, 9), materials.pocket);
  pocket.scale.set(0.95, 1.12, 0.22);
  pocket.position.set(0, 0.015, 0.132);
  glove.add(pocket);
  const cuff = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 0.16, 2, 7), materials.darkLeather);
  cuff.rotation.z = Math.PI / 2;
  cuff.position.set(0, -0.25, 0.02);
  glove.add(cuff);

  for (let finger = 0; finger < 4; finger += 1) {
    const offset = finger - 1.5;
    const segment = new THREE.Mesh(new THREE.CapsuleGeometry(0.052, 0.14, 2, 6), materials.leather);
    segment.position.set(offset * 0.095, 0.25 - Math.abs(offset) * 0.023, 0.025);
    segment.rotation.z = -offset * 0.075;
    glove.add(segment);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.056, 9, 6), materials.leather);
    tip.position.set(offset * 0.095, 0.36 - Math.abs(offset) * 0.025, 0.025);
    glove.add(tip);
  }
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.067, 0.17, 2, 7), materials.darkLeather);
  thumb.position.set(0.24, 0.015, 0.015);
  thumb.rotation.z = -0.78;
  glove.add(thumb);
  const thumbTip = new THREE.Mesh(new THREE.SphereGeometry(0.069, 9, 6), materials.leather);
  thumbTip.position.set(0.33, 0.15, 0.02);
  glove.add(thumbTip);

  for (const x of [-0.19, -0.095, 0, 0.095, 0.19]) {
    const seamPoints = [
      new THREE.Vector3(x, -0.1, 0.14),
      new THREE.Vector3(x * 0.94, 0.08, 0.145),
      new THREE.Vector3(x * 0.78, 0.25, 0.11),
    ];
    const seam = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(seamPoints), 6, 0.009, 4, false), materials.piping);
    glove.add(seam);
  }
  glove.scale.set(0.82, 0.82, 0.82);
  glove.rotation.x = -0.12;
  return glove;
}

function poseLimb(arm, hand, shoulder, endpoint) {
  const direction = endpoint.clone().sub(shoulder);
  const length = direction.length();
  arm.position.copy(shoulder).add(endpoint).multiplyScalar(0.5);
  arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  arm.scale.y = length / arm.userData.restLength;
  hand.position.copy(endpoint);
}

function posePlayerBatGrip(player, batPivot) {
  const grips = [
    { arm: player?.batArm, hand: player?.batHand, alongBat: 0.12 },
    { arm: player?.supportArm, hand: player?.supportHand, alongBat: 0.34 },
  ];
  for (const grip of grips) {
    if (!grip.arm || !grip.hand) continue;
    const endpoint = new THREE.Vector3(0, grip.alongBat, 0)
      .applyQuaternion(batPivot.quaternion)
      .add(batPivot.position);
    poseLimb(grip.arm, grip.hand, grip.arm.userData.batShoulder || grip.arm.userData.shoulder, endpoint);
  }
}

function animateFielder(fielder, dt, moving) {
  if (moving) fielder.runPhase = (fielder.runPhase || 0) + dt * 9;
  fielder.animateRun(fielder.runPhase || 0, moving, dt);
  const bounce = 0.02 + (1 - Math.cos((fielder.runPhase || 0) * 2)) * 0.012;
  fielder.group.position.y = fielder.homePosition.y + bounce * fielder.runBlend;
}

function animatePlayerRun(player, phase, moving, dt = 1 / 60) {
  const target = moving ? 1 : 0;
  const blend = player.runBlend ?? 0;
  player.runBlend = blend + (target - blend) * (1 - Math.exp(-Math.max(0, dt) * 12));
  const runBlend = player.runBlend;
  player.feet.forEach((foot, index) => {
    const footPhase = phase + index * Math.PI;
    const stride = Math.sin(footPhase);
    const rest = foot.userData.restPosition;
    foot.position.x = rest.x;
    foot.position.y = rest.y + Math.pow(Math.max(0, stride), 1.5) * 0.13 * runBlend;
    foot.position.z = rest.z + stride * 0.15 * runBlend;
    foot.rotation.x = -stride * 0.12 * runBlend;
  });
  player.arms[0].rotation.x = -Math.sin(phase) * 0.36 * runBlend;
  player.arms[1].rotation.x = Math.sin(phase) * 0.36 * runBlend;
}

function resetPlayerRunPose(player) {
  player.runBlend = 0;
  player.feet.forEach((foot) => {
    foot.position.copy(foot.userData.restPosition);
    foot.rotation.set(0, 0, 0);
  });
  player.arms.forEach((arm) => { arm.rotation.x = 0; });
}

function updatePlayerColors(player, bodyColor, accentColor) {
  player.bodyMat.color.setHex(bodyColor);
  player.accentMat.color.setHex(accentColor);
  player.helmetMat.color.setHex(bodyColor);
}

function createStrikeZone(scene) {
  const group = new THREE.Group();
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(FIELD.zone.maxX - FIELD.zone.minX, FIELD.zone.maxY - FIELD.zone.minY), new THREE.MeshBasicMaterial({ color: 0xd9f6da, transparent: true, opacity: 0.065, side: THREE.DoubleSide, depthWrite: false }));
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(FIELD.zone.maxX - FIELD.zone.minX, FIELD.zone.maxY - FIELD.zone.minY, 0.075)), new THREE.LineBasicMaterial({ color: 0xf6ffd8, transparent: true, opacity: 0.9 }));
  group.position.set(0, (FIELD.zone.maxY + FIELD.zone.minY) / 2, FIELD.zone.z);
  group.add(plane, edges);
  const plateFrame = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.055, 0.06), new THREE.MeshStandardMaterial({ color: 0xf0ecd7, roughness: 0.8 }));
  plateFrame.position.set(0, 0.08, FIELD.zone.z - 0.36);
  scene.add(plateFrame, group);
  const aim = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.018, 5, 18), new THREE.MeshBasicMaterial({ color: 0xffe784 }));
  aim.rotation.x = Math.PI / 2;
  aim.position.set(0, 1.15, FIELD.zone.z - 0.015);
  aim.visible = false;
  scene.add(aim);
  return { group, aim, plane, edges };
}

function createPitchAim(scene) {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ color: 0xffe784, transparent: true, opacity: 0.94, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.018, 5, 24), material);
  group.add(ring);
  const tickMaterial = new THREE.LineBasicMaterial({ color: 0xfff3c0, transparent: true, opacity: 0.9 });
  const ticks = [
    [[-0.25, 0, 0], [-0.19, 0, 0]], [[0.19, 0, 0], [0.25, 0, 0]],
    [[0, -0.25, 0], [0, -0.19, 0]], [[0, 0.19, 0], [0, 0.25, 0]],
  ];
  for (const [start, end] of ticks) {
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(...start), new THREE.Vector3(...end),
    ]), tickMaterial);
    group.add(line);
  }
  group.position.set(0, 1.19, FIELD.zone.z + 0.04);
  group.visible = false;
  scene.add(group);
  return group;
}

function createBaseball(scene) {
  const group = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.115, 18, 14), new THREE.MeshStandardMaterial({ color: 0xf6f3e7, roughness: 0.54 }));
  ball.castShadow = true; group.add(ball);
  const stitchMat = new THREE.LineBasicMaterial({ color: 0xc8463c });
  for (const side of [-1, 1]) {
    const points = [];
    for (let i = 0; i <= 28; i += 1) {
      const t = (i / 28 - 0.5) * Math.PI * 1.3;
      points.push(new THREE.Vector3(side * (0.063 + 0.028 * Math.cos(t)), 0.025 + 0.067 * Math.sin(t), 0.089 * Math.cos(t)));
    }
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), stitchMat));
  }
  group.visible = false;
  scene.add(group);
  return group;
}

function createTrail(scene) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(256 * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setDrawRange(0, 0);
  const material = new THREE.LineBasicMaterial({ color: FIELD.pitch.trail, transparent: true, opacity: 0.5 });
  const line = new THREE.Line(geometry, material);
  line.frustumCulled = false;
  line.visible = false;
  scene.add(line);
  return line;
}

function createImpact(scene) {
  const group = new THREE.Group();
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff0b5, transparent: true, opacity: 0.9, depthWrite: false }));
  group.add(flash);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.025, 6, 28), new THREE.MeshBasicMaterial({ color: 0xffaa54, transparent: true, opacity: 0.82, depthWrite: false }));
  group.add(ring);
  const light = new THREE.PointLight(0xffc978, 0, 7, 2);
  group.add(light);
  const particles = [];
  for (let index = 0; index < 24; index += 1) {
    const isSpark = index < 14;
    const geometry = isSpark
      ? new THREE.CylinderGeometry(0.004, 0.018, 0.18, 5)
      : new THREE.SphereGeometry(0.055, 7, 5);
    const material = new THREE.MeshBasicMaterial({
      color: isSpark ? (index % 3 === 0 ? 0xfff2a6 : 0xff9d44) : 0xb87b52,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const particle = new THREE.Mesh(geometry, material);
    particle.visible = false;
    particle.userData = { isSpark, velocity: new THREE.Vector3() };
    particles.push(particle);
    group.add(particle);
  }
  group.userData = { flash, ring, light, particles, started: 0, duration: 0.28, power: 1, mode: 'contact' };
  group.visible = false;
  scene.add(group);
  return group;
}
