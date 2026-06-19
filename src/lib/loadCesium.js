// Lataa CesiumJS:n CDN-niput pyynnöstä (vasta kun 3D-karttaa tarvitaan).
// Pidetään promise välimuistissa, jotta skripti injektoidaan vain kerran.
// Versio on lukittu, jotta build ei yllättäen muutu.
const CESIUM_VERSION = '1.124';
const BASE_URL = `https://cesium.com/downloads/cesiumjs/releases/${CESIUM_VERSION}/Build/Cesium/`;

let cesiumPromise = null;

export function loadCesium() {
  if (cesiumPromise) return cesiumPromise;

  cesiumPromise = new Promise((resolve, reject) => {
    // Jo ladattu (esim. takaisin 3D-tilaan vaihdettaessa).
    if (window.Cesium) {
      resolve(window.Cesium);
      return;
    }

    // Cesium tarvitsee tämän löytääkseen omat työntekijä-/asset-tiedostonsa.
    window.CESIUM_BASE_URL = BASE_URL;

    // Widgets-tyylit (vain kerran).
    if (!document.querySelector('link[data-cesium]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `${BASE_URL}Widgets/widgets.css`;
      link.dataset.cesium = 'true';
      document.head.appendChild(link);
    }

    const script = document.createElement('script');
    script.src = `${BASE_URL}Cesium.js`;
    script.async = true;
    script.dataset.cesium = 'true';
    script.onload = () => {
      if (window.Cesium) {
        resolve(window.Cesium);
      } else {
        cesiumPromise = null; // Salli uudelleenyritys jos Cesium puuttuu latauksen jälkeen.
        reject(new Error('Cesium latautui mutta window.Cesium puuttuu'));
      }
    };
    script.onerror = () => {
      cesiumPromise = null; // Salli uudelleenyritys CDN-virheen jälkeen.
      reject(new Error('Cesiumin lataus epäonnistui'));
    };
    document.head.appendChild(script);
  });

  return cesiumPromise;
}
