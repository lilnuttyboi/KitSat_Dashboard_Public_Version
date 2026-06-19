import { useCallback, useEffect, useRef, useState } from 'react';
import { loadCesium } from '../lib/loadCesium';

// CARTO-karttapohja teeman mukaan — sama lähde kuin 2D-kartalla. Cesium ei tue
// {r}-retina-merkintää, joten se jätetään pois.
const CARTO_URLS = {
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
  light: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
};

const ROUTE_COLOR = '#fbbf24'; // sama keltainen kuin 2D-reitti / korkeuskäyrä
const CRAFT_COLOR = '#35d6e6'; // satelliittipisteen syaani

const GROUND_CLAMP_LIMIT = 150; // m — tämän alapuolella dotti naulataan maahan

// Kamerakulmat asteina (Cesium.Math ei ole käytettävissä moduulin latautuessa,
// joten muunnos radiaaneiksi tehdään vasta käyttökohdassa). Säädä makuun.
const VIEW_HEADING_DEG = 35;   // sivukulma
const VIEW_PITCH_DEG = -12;    // hieman alaspäin
const VIEW_BASE_RANGE = 4000;  // m, vähimmäisetäisyys kohteeseen

// Kameran etäisyys kasvaa korkeuden mukana, jotta koko korkeusverho pysyy kuvassa.
function viewRange(altMeters) {
  return VIEW_BASE_RANGE + (Number.isFinite(altMeters) ? altMeters : 0) * 2.2;
}

// Rakentaa teeman mukaisen CARTO-kuvakerroksen.
function cartoLayer(Cesium, theme) {
  const provider = new Cesium.UrlTemplateImageryProvider({
    url: CARTO_URLS[theme] ?? CARTO_URLS.dark,
    subdomains: 'abcd',
    credit: '© CARTO © OpenStreetMap contributors',
    maximumLevel: 19,
  });
  const layer = new Cesium.ImageryLayer(provider);
  // Tumma CARTO on lähes musta — kirkastetaan kuten 2D-kartalla CSS:llä.
  if (theme === 'dark') {
    layer.brightness = 2.0;
    layer.contrast = 1.1;
    layer.saturation = 1.3;
  }
  return layer;
}

// Muuntaa reittipisteet Cartesian3-taulukoksi.
function toCartesians(Cesium, route3d) {
  return route3d
    .filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon))
    .map((p) =>
      Cesium.Cartesian3.fromDegrees(p.lon, p.lat, Number.isFinite(p.alt) ? p.alt : 0)
    );
}

function Globe3D({ lat, lng, alt, route3d = [], theme = 'dark' }) {
  const containerRef = useRef(null);
  const cesiumRef = useRef(null);       // window.Cesium
  const viewerRef = useRef(null);
  const craftEntityRef = useRef(null);
  const positionsRef = useRef([]);      // Cesium.Cartesian3[]
  const craftPosRef = useRef(null);     // Cesium.Cartesian3 | null
  const altRef = useRef(0);             // viimeisin korkeus kameran etäisyyttä varten
  const autoTrackRef = useRef(false);   // seuraako kamera satelliittia
  const didFirstFlyRef = useRef(false);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'

  // Lentää oletussivunäkymään ja kytkee seurannan päälle lennon päätyttyä.
  // Käytetään sekä ensimmäisellä fixillä että "Palauta näkymä" -napilla.
  const flyToSidePose = useCallback(() => {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer || viewer.isDestroyed() || !craftPosRef.current) return;
    // Vapauta mahdollinen lookAt-transform lennon ajaksi.
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    autoTrackRef.current = false;
    viewer.camera.flyToBoundingSphere(
      new Cesium.BoundingSphere(craftPosRef.current, 1),
      {
        offset: new Cesium.HeadingPitchRange(
          Cesium.Math.toRadians(VIEW_HEADING_DEG),
          Cesium.Math.toRadians(VIEW_PITCH_DEG),
          viewRange(altRef.current)
        ),
        duration: 1.5,
        complete: () => {
          autoTrackRef.current = true;
        },
      }
    );
  }, []);

  // Alusta Cesium-viewer kerran.
  useEffect(() => {
    let cancelled = false;

    loadCesium()
      .then((Cesium) => {
        if (cancelled || !containerRef.current) return;
        cesiumRef.current = Cesium;

        const viewer = new Cesium.Viewer(containerRef.current, {
          // Tokeniton: oma CARTO-kuvakerros, ei Ion-maailmankuvaa eikä maastoa.
          baseLayer: cartoLayer(Cesium, theme),
          baseLayerPicker: false,
          geocoder: false,
          homeButton: false,
          timeline: false,
          animation: false,
          navigationHelpButton: false,
          sceneModePicker: false,
          fullscreenButton: false,
          infoBox: false,
          selectionIndicator: false,
        });
        viewerRef.current = viewer;

        viewer.scene.globe.depthTestAgainstTerrain = false;
        viewer.cesiumWidget.creditContainer.style.display = 'none';

        // Pehmeämpi zoom/pyöritys, ei inertiaa.
        const sscc = viewer.scene.screenSpaceCameraController;
        sscc.enableCollisionDetection = false;
        sscc.inertiaSpin = 0;
        sscc.inertiaTranslate = 0;
        sscc.minimumZoomDistance = 30;
        sscc.maximumZoomDistance = 4.0e7;

        // Lentorata (keltainen viiva).
        viewer.entities.add({
          polyline: {
            positions: new Cesium.CallbackProperty(() => positionsRef.current, false),
            width: 3,
            arcType: Cesium.ArcType.GEODESIC,
            material: Cesium.Color.fromCssColorString(ROUTE_COLOR),
          },
        });
        // Korkeusverho (flightradar-tyyli).
        viewer.entities.add({
          wall: {
            positions: new Cesium.CallbackProperty(() => positionsRef.current, false),
            material: Cesium.Color.fromCssColorString(ROUTE_COLOR).withAlpha(0.12),
          },
        });
        // Satelliittipiste.
        craftEntityRef.current = viewer.entities.add({
          position: new Cesium.CallbackProperty(() => craftPosRef.current, false),
          point: {
            pixelSize: 12,
            color: Cesium.Color.fromCssColorString(CRAFT_COLOR),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          },
        });

        // Sivunäkymän seuranta: joka ruudulla kamera asetetaan kiinteään
        // sivukulmaan satelliitin ympärille (ei pyöri → "drone" seuraa sivusta).
        viewer.scene.preRender.addEventListener(() => {
          if (!autoTrackRef.current || !craftPosRef.current) return;
          viewer.camera.lookAt(
            craftPosRef.current,
            new Cesium.HeadingPitchRange(
              Cesium.Math.toRadians(VIEW_HEADING_DEG),
              Cesium.Math.toRadians(VIEW_PITCH_DEG),
              viewRange(altRef.current)
            )
          );
        });

        // Kun käyttäjä koskee karttaan, seuranta lopetetaan (ei taistella vastaan).
        const stopTracking = () => {
          if (!autoTrackRef.current) return;
          autoTrackRef.current = false;
          viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
        };
        viewer.scene.canvas.addEventListener('pointerdown', stopTracking);
        viewer.scene.canvas.addEventListener('wheel', stopTracking, { passive: true });

        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });

    return () => {
      cancelled = true;
      const viewer = viewerRef.current;
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
      viewerRef.current = null;
    };
    // theme luetaan tarkoituksella vain alustuksessa; teemavaihto hoidetaan
    // erillisessä efektissä alla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Päivitä lentorata kun route3d muuttuu (vasta kun viewer on valmis).
  useEffect(() => {
    const Cesium = cesiumRef.current;
    if (!Cesium || status !== 'ready') return;
    positionsRef.current = toCartesians(Cesium, route3d);
  }, [route3d, status]);

  // Päivitä satelliitin sijainti + korkeusviittaus kun lat/lng/alt muuttuu.
  useEffect(() => {
    const Cesium = cesiumRef.current;
    if (!Cesium || status !== 'ready') return;
    if (lat == null || lng == null) {
      craftPosRef.current = null;
      return;
    }
    const h = Number.isFinite(alt) ? alt : 0;
    altRef.current = h;
    craftPosRef.current = Cesium.Cartesian3.fromDegrees(lng, lat, h);
    if (craftEntityRef.current) {
      craftEntityRef.current.point.heightReference =
        h > GROUND_CLAMP_LIMIT
          ? Cesium.HeightReference.NONE
          : Cesium.HeightReference.CLAMP_TO_GROUND;
    }
    // Ensimmäisellä fixillä lennetään sivunäkymään ja kytketään seuranta.
    if (!didFirstFlyRef.current) {
      didFirstFlyRef.current = true;
      flyToSidePose();
    }
  }, [lat, lng, alt, status, flyToSidePose]);

  // Vaihda karttapohja teeman mukaan.
  useEffect(() => {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer || viewer.isDestroyed() || status !== 'ready') return;
    viewer.imageryLayers.removeAll(true);
    viewer.imageryLayers.add(cartoLayer(Cesium, theme));
  }, [theme, status]);

  return (
    <div className="globe-wrapper">
      <div ref={containerRef} className="globe-canvas" />
      {status === 'loading' && (
        <div className="globe-overlay">LADATAAN 3D-KARTTAA…</div>
      )}
      {status === 'error' && (
        <div className="globe-overlay">
          3D-KARTAN LATAUS EPÄONNISTUI.
          <br />
          KÄYTÄ 2D-KARTTAA.
        </div>
      )}
      {status === 'ready' && (
        <button
          className="range-btn globe-reset-btn"
          onClick={flyToSidePose}
          title="Palauta seuraava sivunäkymä"
        >
          Palauta näkymä
        </button>
      )}
    </div>
  );
}

export default Globe3D;
