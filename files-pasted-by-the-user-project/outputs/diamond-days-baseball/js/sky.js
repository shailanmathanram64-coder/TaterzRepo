import { createWindEffects } from './wind.js';

const SUN_DIRECTION = [-0.4, 0.28, 0.87];
const HORIZON_HEX = 0xf0d7ba;
const TIME_OF_DAY = {
  morning: {
    horizon: 0xf0b995, low: 0xd8e0d8, mid: 0x79b4d2, high: 0x3b7fa9, zenith: 0x285884,
    sun: 0xffefd1, glow: 0xff9362, direction: [-0.74, 0.14, 0.66], daylight: 1.9, ambient: 1.18,
  },
  day: {
    horizon: HORIZON_HEX, low: 0xc4e1df, mid: 0x68b2d3, high: 0x327bb0, zenith: 0x24558f,
    sun: 0xffffe0, glow: 0xffc478, direction: SUN_DIRECTION, daylight: 2.65, ambient: 1.25,
  },
  sunset: {
    horizon: 0xe86751, low: 0xf89959, mid: 0xffd47d, high: 0xe98a77, zenith: 0x765d83,
    sun: 0xffedbd, glow: 0xff9856, direction: [0.57, 0.12, 0.81], daylight: 1.72, ambient: 1.02,
  },
  night: {
    horizon: 0x172237, low: 0x1c2d49, mid: 0x263e60, high: 0x1e3153, zenith: 0x121f3a,
    sun: 0xd8e5ff, glow: 0x819fd7, direction: [-0.25, -0.36, 0.9], daylight: 0.48, ambient: 0.62,
  },
};

export function createSky(THREE, scene) {
  const sunDirection = new THREE.Vector3(...SUN_DIRECTION).normalize();
  scene.background = new THREE.Color(0x77b6d2);

  const uniforms = {
    uHorizon: { value: new THREE.Color(HORIZON_HEX) },
    uLowSky: { value: new THREE.Color(0xc4e1df) },
    uMidSky: { value: new THREE.Color(0x68b2d3) },
    uHighSky: { value: new THREE.Color(0x327bb0) },
    uZenith: { value: new THREE.Color(0x24558f) },
    uSunDirection: { value: sunDirection },
    uSunColor: { value: new THREE.Color(0xffffe0) },
    uGlowColor: { value: new THREE.Color(0xffc478) },
  };
  const domeMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
    uniforms,
    vertexShader: `
      varying vec3 vSkyDirection;
      void main() {
        vSkyDirection = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uHorizon, uLowSky, uMidSky, uHighSky, uZenith;
      uniform vec3 uSunDirection, uSunColor, uGlowColor;
      varying vec3 vSkyDirection;
      void main() {
        vec3 direction = normalize(vSkyDirection);
        float elevation = degrees(asin(clamp(direction.y, -1.0, 1.0)));
        vec3 sky = mix(uHorizon, uLowSky, smoothstep(-5.0, 4.0, elevation));
        sky = mix(sky, uMidSky, smoothstep(2.0, 25.0, elevation));
        sky = mix(sky, uHighSky, smoothstep(22.0, 53.0, elevation));
        sky = mix(sky, uZenith, smoothstep(48.0, 86.0, elevation));
        float sunDot = max(dot(direction, normalize(uSunDirection)), 0.0);
        float halo = exp(-(1.0 - sunDot) * 150.0) * 0.52
          + exp(-(1.0 - sunDot) * 18.0) * 0.16;
        float disc = smoothstep(0.99993, 0.999985, sunDot);
        sky += uGlowColor * halo * 1.25;
        sky = mix(sky, uSunColor * 1.18, disc);
        gl_FragColor = vec4(sky, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(220, 40, 24), domeMaterial);
  dome.renderOrder = -1000;
  dome.frustumCulled = false;
  scene.add(dome);

  const starPositions = [];
  for (let index = 0; index < 360; index += 1) {
    const azimuth = Math.random() * Math.PI * 2;
    const elevation = THREE.MathUtils.degToRad(9 + Math.random() * 79);
    const radius = 208 + Math.random() * 3;
    const horizontal = Math.cos(elevation) * radius;
    starPositions.push(Math.sin(azimuth) * horizontal, Math.sin(elevation) * radius, Math.cos(azimuth) * horizontal);
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
  const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({
    color: 0xffffff,
    size: 1.05,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.82,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
  }));
  stars.renderOrder = -850;
  stars.frustumCulled = false;
  stars.visible = false;
  scene.add(stars);

  const horizon = new THREE.Group();
  horizon.renderOrder = -900;
  horizon.add(makeRidge(THREE, 174, 9.5, 0.3, 0x92b4ad));
  horizon.add(makeRidge(THREE, 202, 17, 1.7, 0x7898a2));
  horizon.traverse((object) => { object.frustumCulled = false; });
  scene.add(horizon);

  const wind = createWindEffects(THREE, scene);

  function setTimeOfDay(timeOfDay = 'day') {
    const preset = TIME_OF_DAY[timeOfDay] || TIME_OF_DAY.day;
    stars.visible = timeOfDay === 'night';
    uniforms.uHorizon.value.setHex(preset.horizon);
    uniforms.uLowSky.value.setHex(preset.low);
    uniforms.uMidSky.value.setHex(preset.mid);
    uniforms.uHighSky.value.setHex(preset.high);
    uniforms.uZenith.value.setHex(preset.zenith);
    uniforms.uSunColor.value.setHex(preset.sun);
    uniforms.uGlowColor.value.setHex(preset.glow);
    uniforms.uSunDirection.value.set(...preset.direction).normalize();
    scene.background.setHex(preset.mid);
    return {
      direction: uniforms.uSunDirection.value.clone(),
      daylight: preset.daylight,
      ambient: preset.ambient,
    };
  }

  return {
    setTimeOfDay,
    update(time, camera, windStrength = 0.45) {
      dome.position.copy(camera.position);
      stars.position.copy(camera.position);
      stars.material.opacity = 0.72 + (Math.sin(time * 0.9) * 0.5 + 0.5) * 0.15;
      wind.update(time, windStrength);
    },
  };
}

function makeRidge(THREE, z, amplitude, phase, crestHex) {
  const segments = 96;
  const positions = [];
  const colors = [];
  const indices = [];
  const base = -7;
  const crest = new THREE.Color(crestHex);
  const mid = new THREE.Color(HORIZON_HEX).lerp(crest, 0.62);
  const rows = [
    { fraction: 0, color: new THREE.Color(HORIZON_HEX) },
    { fraction: 0.58, color: mid },
    { fraction: 1, color: crest },
  ];

  for (let i = 0; i <= segments; i += 1) {
    const x = -280 + (560 * i) / segments;
    const broad = Math.sin(x * 0.018 + phase) * 0.5 + 0.5;
    const detail = Math.sin(x * 0.047 + phase * 1.9) * 0.5 + Math.sin(x * 0.031 - phase) * 0.5;
    const peak = Math.max(0, 1 - Math.abs(x + (phase - 1) * 52) / 78);
    const height = amplitude * (0.45 + broad * 0.38 + detail * 0.1 + peak * 0.42);
    for (const row of rows) {
      positions.push(x, base + (height - base) * row.fraction, z);
      colors.push(row.color.r, row.color.g, row.color.b);
    }
  }

  for (let i = 0; i < segments; i += 1) {
    const current = i * rows.length;
    const next = current + rows.length;
    for (let row = 0; row < rows.length - 1; row += 1) {
      const a = current + row;
      const b = next + row;
      const c = next + row + 1;
      const d = current + row + 1;
      indices.push(a, b, c, a, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
  }));
  mesh.frustumCulled = false;
  return mesh;
}

