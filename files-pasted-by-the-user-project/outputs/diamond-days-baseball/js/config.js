export const TEAMS = [
  { id: 'comets', name: 'Comet City', colors: [0x2b6eaa, 0xf4d35e], light: '#2b6eaa', accent: '#f4d35e' },
  { id: 'foxes', name: 'Copper Foxes', colors: [0xb94730, 0xffd089], light: '#b94730', accent: '#ffd089' },
  { id: 'herons', name: 'Bay Herons', colors: [0x247e78, 0xe0f0cc], light: '#247e78', accent: '#e0f0cc' },
  { id: 'moons', name: 'Moon City', colors: [0x594c93, 0xc6d4ff], light: '#594c93', accent: '#c6d4ff' },
  { id: 'pines', name: 'Pine Ridge', colors: [0x456b43, 0xe5c77b], light: '#456b43', accent: '#e5c77b' },
  { id: 'suns', name: 'Sunset Suns', colors: [0xe17931, 0x2d4256], light: '#e17931', accent: '#2d4256' },
];

export const FIELD = {
  moundZ: 18.44,
  baseLeg: 19.4,
  homeRunRadius: 56,
  gravity: 9.81,
  zone: { minX: -0.54, maxX: 0.54, minY: 0.62, maxY: 1.76, z: 0.55 },
  pitch: { speed: 20, flightTime: 0.94, gravity: 3.4, type: 'four-seam fastball', trail: 0xf2f2e8 },
};

export const DEFAULT_SETTINGS = {
  motion: true,
  sensitivity: 1,
  effects: true,
  timeOfDay: 'day',
  sunlight: 100,
  wind: 45,
};

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('diamond-days-settings') || '{}');
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  localStorage.setItem('diamond-days-settings', JSON.stringify(settings));
}
