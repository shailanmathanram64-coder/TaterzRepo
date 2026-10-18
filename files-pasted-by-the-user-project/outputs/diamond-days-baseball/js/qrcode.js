// Small dependency-free QR encoder for the LAN pairing link (QR versions 1–4, ECC-M/L).
// These versions cover up to 78 UTF-8 bytes, enough for the local controller URL.
(() => {
  const DATA_CODEWORDS = {
    M: [0, 16, 28, 44],
    L: [0, 19, 34, 55, 80],
  };
  const ECC_CODEWORDS = {
    M: [0, 10, 16, 26],
    L: [0, 7, 10, 15, 20],
  };
  const ALIGNMENT = { 2: [6, 18], 3: [6, 22], 4: [6, 26] };

  function encode(text, requestedLevel = 'M') {
    const bytes = [...new TextEncoder().encode(text)];
    const payloadSize = 4 + 8 + bytes.length * 8;
    let level = requestedLevel === 'L' ? 'L' : 'M';
    let version = DATA_CODEWORDS[level].findIndex((capacity, index) => index > 0 && payloadSize <= capacity * 8);
    if (!version && level === 'M') {
      level = 'L';
      version = DATA_CODEWORDS[level].findIndex((capacity, index) => index > 0 && payloadSize <= capacity * 8);
    }
    if (!version || bytes.length > 78) throw new Error('Pairing link is too long for this QR encoder.');

    const bits = [];
    appendBits(bits, 0b0100, 4);
    appendBits(bits, bytes.length, 8);
    bytes.forEach((byte) => appendBits(bits, byte, 8));
    const capacity = DATA_CODEWORDS[level][version] * 8;
    appendBits(bits, 0, Math.min(4, capacity - bits.length));
    while (bits.length % 8) bits.push(0);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((value, bit) => (value << 1) | bit, 0));
    for (let pad = 0; data.length < DATA_CODEWORDS[level][version]; pad++) data.push(pad % 2 ? 0x11 : 0xec);
    const formatLevel = level === 'M' ? 0b00 : 0b01;
    return { matrix: makeMatrix(version, data.concat(remainder(data, ECC_CODEWORDS[level][version])), formatLevel), level };
  }

  function appendBits(target, value, length) {
    for (let bit = length - 1; bit >= 0; bit--) target.push((value >>> bit) & 1);
  }

  function multiply(x, y) {
    let product = 0;
    for (let i = 7; i >= 0; i--) {
      product = (product << 1) ^ (((product >>> 7) & 1) * 0x11d);
      product ^= ((y >>> i) & 1) * x;
    }
    return product;
  }

  function remainder(data, degree) {
    const divisor = Array(degree).fill(0);
    divisor[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < degree; j++) {
        divisor[j] = multiply(divisor[j], root);
        if (j + 1 < degree) divisor[j] ^= divisor[j + 1];
      }
      root = multiply(root, 2);
    }
    const result = Array(degree).fill(0);
    for (const byte of data) {
      const factor = byte ^ result.shift();
      result.push(0);
      for (let i = 0; i < degree; i++) result[i] ^= multiply(divisor[i], factor);
    }
    return result;
  }

  function makeMatrix(version, codewords, formatLevel) {
    const size = version * 4 + 17;
    const modules = Array.from({ length: size }, () => Array(size).fill(false));
    const fixed = Array.from({ length: size }, () => Array(size).fill(false));
    const setFunction = (x, y, dark) => {
      if (x >= 0 && y >= 0 && x < size && y < size) {
        modules[y][x] = dark;
        fixed[y][x] = true;
      }
    };

    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        setFunction(cx + dx, cy + dy, distance !== 2 && distance <= 3);
      }
    }
    for (let i = 8; i < size - 8; i++) {
      setFunction(i, 6, i % 2 === 0);
      setFunction(6, i, i % 2 === 0);
    }
    for (const cx of ALIGNMENT[version] || []) for (const cy of ALIGNMENT[version] || []) {
      if (fixed[cy][cx]) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
    drawFormat(modules, fixed, 0, formatLevel);

    const payloadBits = [];
    codewords.forEach((byte) => appendBits(payloadBits, byte, 8));
    let bitIndex = 0;
    let upward = true;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vertical = 0; vertical < size; vertical++) {
        const y = upward ? size - 1 - vertical : vertical;
        for (let offset = 0; offset < 2; offset++) {
          const x = right - offset;
          if (fixed[y][x]) continue;
          modules[y][x] = bitIndex < payloadBits.length ? payloadBits[bitIndex++] === 1 : false;
        }
      }
      upward = !upward;
    }

    let best = null;
    let bestPenalty = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      const candidate = modules.map((row) => row.slice());
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        if (!fixed[y][x] && maskBit(mask, x, y)) candidate[y][x] = !candidate[y][x];
      }
      drawFormat(candidate, fixed, mask, formatLevel);
      const penalty = score(candidate);
      if (penalty < bestPenalty) { best = candidate; bestPenalty = penalty; }
    }
    return best;
  }

  function drawFormat(matrix, fixed, mask, formatLevel) {
    const size = matrix.length;
    const data = (formatLevel << 3) | mask;
    let remainder = data << 10;
    const polynomial = 0x537;
    for (let bit = 14; bit >= 10; bit--) if ((remainder >>> bit) & 1) remainder ^= polynomial << (bit - 10);
    const bits = ((data << 10) | remainder) ^ 0x5412;
    const set = (x, y, index) => {
      matrix[y][x] = ((bits >>> index) & 1) !== 0;
      fixed[y][x] = true;
    };
    for (let i = 0; i <= 5; i++) set(8, i, i);
    set(8, 7, 6); set(8, 8, 7); set(7, 8, 8);
    for (let i = 9; i < 15; i++) set(14 - i, 8, i);
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, i);
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, i);
    matrix[size - 8][8] = true;
    fixed[size - 8][8] = true;
  }

  function maskBit(mask, x, y) {
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
      case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    }
  }

  function score(matrix) {
    const size = matrix.length;
    let penalty = 0;
    const lines = [...matrix, ...matrix[0].map((_, x) => matrix.map((row) => row[x]))];
    for (const line of lines) {
      let run = 1;
      for (let i = 1; i < size; i++) {
        if (line[i] === line[i - 1]) run++;
        else { if (run >= 5) penalty += run - 2; run = 1; }
      }
      if (run >= 5) penalty += run - 2;
      const bits = line.map((value) => value ? '1' : '0').join('');
      for (let i = 0; i <= size - 11; i++) if (bits.slice(i, i + 11) === '00001011101' || bits.slice(i, i + 11) === '10111010000') penalty += 40;
    }
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const value = matrix[y][x];
      if (matrix[y][x + 1] === value && matrix[y + 1][x] === value && matrix[y + 1][x + 1] === value) penalty += 3;
    }
    const dark = matrix.flat().filter(Boolean).length;
    penalty += Math.floor(Math.abs((dark * 20) - (size * size * 10)) / (size * size)) * 10;
    return penalty;
  }

  async function toCanvas(canvas, text, options = {}) {
    const { matrix } = encode(text, options.errorCorrectionLevel || 'M');
    const width = options.width || 220;
    const margin = Math.max(4, options.margin ?? 4);
    const size = matrix.length + margin * 2;
    const scale = width / size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable.');
    canvas.width = width;
    canvas.height = width;
    context.fillStyle = options.color?.light || '#ffffff';
    context.fillRect(0, 0, width, width);
    context.fillStyle = options.color?.dark || '#000000';
    for (let y = 0; y < matrix.length; y++) for (let x = 0; x < matrix.length; x++) {
      if (matrix[y][x]) context.fillRect((x + margin) * scale, (y + margin) * scale, scale + 0.3, scale + 0.3);
    }
    return canvas;
  }

  window.QRCode = { toCanvas };
})();
