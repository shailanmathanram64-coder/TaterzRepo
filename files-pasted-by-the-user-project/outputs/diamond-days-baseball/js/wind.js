const TAU = Math.PI * 2;

export function createWindEffects(THREE, scene) {
  const breeze = createBreeze(THREE, scene);
  const birds = createBirds(THREE, scene);

  return {
    update(time, strength = 0.45) {
      breeze.update(time, strength);
      birds.update(time);
    },
  };
}

function createBreeze(THREE, scene) {
  const count = 6;
  const segments = 28;
  const vertexCount = count * (segments + 1) * 2;
  const positions = new Float32Array(vertexCount * 3);
  const opacity = new Float32Array(vertexCount);
  const indices = [];

  for (let ribbon = 0; ribbon < count; ribbon += 1) {
    const start = ribbon * (segments + 1) * 2;
    for (let segment = 0; segment < segments; segment += 1) {
      const a = start + segment * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aOpacity', new THREE.BufferAttribute(opacity, 1));
  geometry.setIndex(indices);
  geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
  geometry.attributes.aOpacity.setUsage(THREE.DynamicDrawUsage);

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    uniforms: { uColor: { value: new THREE.Color(0xfff0d4) } },
    vertexShader: `
      attribute float aOpacity;
      varying float vOpacity;
      void main() {
        vOpacity = aOpacity;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vOpacity;
      void main() {
        gl_FragColor = vec4(uColor, vOpacity);
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  scene.add(mesh);

  const sampleBefore = new THREE.Vector3();
  const sampleAfter = new THREE.Vector3();
  const center = new THREE.Vector3();

  function centerAt(ribbon, u, time, progress, target) {
    const side = ribbon % 2 === 0 ? -1 : 1;
    const layer = Math.floor(ribbon / 2);
    const baseX = 18 + layer * 5;
    const baseY = 5.4 + layer * 2.3;
    const baseZ = 24 + layer * 19;
    const length = 14 + layer * 1.7;
    const loop = Math.exp(-Math.pow((u - 0.68) / 0.13, 2));
    const curl = TAU * (u - 0.68) * 1.45 + time * 0.55 + ribbon * 1.7;
    const drift = progress * 4.2;

    target.set(
      side * (baseX + drift + length * u + loop * Math.cos(curl) * 0.72),
      baseY + 0.22 * u + loop * Math.sin(curl) * 0.82 + 0.1 * Math.sin(time * 0.8 + ribbon),
      baseZ + 0.2 * Math.sin(u * TAU + ribbon) + loop * Math.cos(curl) * 0.38,
    );
    return target;
  }

  function update(time, strength = 0.45) {
    const windTime = time * (0.3 + Math.max(0, Math.min(1, strength)) * 1.2);
    const visibility = Math.max(0, Math.min(1, strength));
    for (let ribbon = 0; ribbon < count; ribbon += 1) {
      const progress = ((windTime + ribbon * 1.35) % 8.4) / 8.4;
      const life = Math.sin(Math.PI * progress);
      const head = progress * 1.28;
      const firstVertex = ribbon * (segments + 1) * 2;

      for (let segment = 0; segment <= segments; segment += 1) {
        const u = segment / segments;
        const beforeU = Math.max(0, u - 1 / segments);
        const afterU = Math.min(1, u + 1 / segments);
        centerAt(ribbon, u, windTime, progress, center);
        centerAt(ribbon, beforeU, windTime, progress, sampleBefore);
        centerAt(ribbon, afterU, windTime, progress, sampleAfter);

        const dx = sampleAfter.x - sampleBefore.x;
        const dy = sampleAfter.y - sampleBefore.y;
        const tangentLength = Math.max(0.001, Math.hypot(dx, dy));
        const sideX = -dy / tangentLength;
        const sideY = dx / tangentLength;
        const tip = Math.max(0, Math.min(1, Math.min(u / 0.09, (1 - u) / 0.09)));
        const reveal = smoothstep(0, 0.16, head - u);
        const loopBulge = 0.55 + 0.45 * Math.exp(-Math.pow((u - 0.68) / 0.18, 2));
        const width = 0.075 * tip * loopBulge;
        const alpha = 0.5 * life * reveal * smoothstep(0, 0.15, tip);
        const left = firstVertex + segment * 2;
        const right = left + 1;
        const leftOffset = left * 3;
        const rightOffset = right * 3;
        positions[leftOffset] = center.x - sideX * width;
        positions[leftOffset + 1] = center.y - sideY * width;
        positions[leftOffset + 2] = center.z;
        positions[rightOffset] = center.x + sideX * width;
        positions[rightOffset + 1] = center.y + sideY * width;
        positions[rightOffset + 2] = center.z;
        opacity[left] = alpha * visibility;
        opacity[right] = alpha * visibility;
      }
    }

    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.aOpacity.needsUpdate = true;
  }

  update(0);
  return { update };
}

function createBirds(THREE, scene) {
  const specs = [
    { x: -54, y: 29, z: 132, phase: 0.2, size: 0.96 },
    { x: -78, y: 35, z: 166, phase: 1.8, size: 0.84 },
    { x: 52, y: 31, z: 142, phase: 2.9, size: 0.92 },
    { x: 76, y: 37, z: 171, phase: 4.1, size: 0.86 },
    { x: 108, y: 41, z: 159, phase: 5.3, size: 0.8 },
  ];
  const local = [];
  const birds = [];
  const addTriangle = (points, wing) => {
    for (const [x, y] of points) local.push({ x, y, wing });
  };
  for (const spec of specs) {
    const start = local.length;
    for (const side of [-1, 1]) {
      const root = [0, 0.02];
      const shoulder = [side * 0.6, 0.16];
      const tip = [side * 1.12, 0.06];
      const trailing = [side * 0.82, -0.09];
      const inner = [side * 0.26, -0.05];
      addTriangle([root, shoulder, tip], true);
      addTriangle([root, tip, trailing], true);
      addTriangle([root, trailing, inner], true);
    }
    addTriangle([[-0.2, 0.01], [0.24, 0.05], [0.02, -0.07]], false);
    addTriangle([[0.24, 0.05], [0.38, 0.01], [0.02, -0.07]], false);
    birds.push({ ...spec, start, end: local.length });
  }

  const positions = new Float32Array(local.length * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
  const material = new THREE.MeshBasicMaterial({
    color: 0x526c76,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  scene.add(mesh);

  function update(time) {
    for (const bird of birds) {
      const drift = time * 0.055 + bird.phase;
      const centerX = bird.x + 3.2 * Math.sin(drift);
      const centerY = bird.y + 0.75 * Math.sin(drift * 1.7);
      const centerZ = bird.z + 2.5 * Math.cos(drift * 0.7);
      const bank = 0.16 * Math.sin(drift * 1.2);
      const flap = 0.14 * Math.sin(time * 3.2 + bird.phase);
      const cosBank = Math.cos(bank);
      const sinBank = Math.sin(bank);

      for (let vertex = bird.start; vertex < bird.end; vertex += 1) {
        const point = local[vertex];
        const localX = point.x * bird.size;
        const localY = point.y * bird.size + (point.wing ? flap * Math.abs(point.x) : 0);
        positions[vertex * 3] = centerX + localX * cosBank;
        positions[vertex * 3 + 1] = centerY + localY;
        positions[vertex * 3 + 2] = centerZ + localX * sinBank;
      }
    }
    geometry.attributes.position.needsUpdate = true;
  }

  update(0);
  return { update };
}

function smoothstep(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
