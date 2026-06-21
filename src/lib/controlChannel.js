// Ohjausikkunan ja koontinäytön välinen viestikanava (sama kone, sama origin).
// Käärii yhden BroadcastChannelin + localStorage-pysyvyyden. Tämä on ainoa
// paikka joka tuntee viestiformaatin. Ei React-riippuvuutta → testattavissa.

const CHANNEL_NAME = 'kitsat-control';
const STATE_KEY = 'kitsatControlState';

// Oletustila — samat alkuarvot kuin koontinäytöllä (App.jsx).
const DEFAULT_STATE = {
  mapMode: '3d',        // '2d' | '3d'
  basemap: 'satellite', // 'satellite' | 'kartta'
  cameraMode: 'sivu',   // 'sivu' | 'kierto' | 'ylha'
  maintenance: false,
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

// Luo viestikanava. Palauttaa pienen rajapinnan, joka piilottaa BroadcastChannelin.
export function createControlChannel() {
  const ch = new BroadcastChannel(CHANNEL_NAME);
  return {
    post(msg) {
      ch.postMessage(msg);
    },
    subscribe(handler) {
      const listener = (e) => handler(e.data);
      ch.addEventListener('message', listener);
      return () => ch.removeEventListener('message', listener);
    },
    close() {
      ch.close();
    },
  };
}
