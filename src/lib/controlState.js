// Säätötilan pysyvyys (localStorage). Ainoa paikka joka tuntee tallennus-
// formaatin. Ei React-riippuvuutta → testattavissa.

const STATE_KEY = 'kitsatControlState';

// Oletustila — samat alkuarvot kuin koontinäytöllä (App.jsx).
const DEFAULT_STATE = {
  mapMode: '3d',        // '2d' | '3d'
  basemap: 'satellite', // 'satellite' | 'kartta'
  cameraMode: 'sivu',   // 'sivu' | 'kierto' | 'ylha'
  maintenance: false,
  theme: 'dark',        // 'dark' | 'light'
  range: 60000,         // kaavioiden aikaväli ms; null = MAX
  axisUnits: false,     // näytä kaavioiden Y-akselin asteikko (arvot oikealla); oletus pois
};

// Lue pysyvä tila; palauta oletukset jos puuttuu tai viallinen.
export function readPersistedState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    const s = raw ? JSON.parse(raw) : null;
    if (s && typeof s === 'object') return { ...DEFAULT_STATE, ...s };
  } catch (e) {
    void e; // estetty/viallinen tallennus — käytä oletuksia
  }
  return { ...DEFAULT_STATE };
}

// Säilö tila (lohkeaa hiljaa jos tallennus on estetty, esim. yksityinen tila).
export function writePersistedState(state) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch (e) {
    void e; // ei kriittistä
  }
}
