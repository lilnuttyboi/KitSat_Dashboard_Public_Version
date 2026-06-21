import { useCallback, useEffect, useRef, useState } from 'react';
import { loadCesium } from '../lib/loadCesium';

// "Kartta"-pohja: teemoitetut CARTO-tiilet. Cesium ei tue {r}-merkintää.
const CARTO_URLS = {
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
  light: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
};

// "Satelliitti"-pohja: Esri World Imagery (tokeniton) + ohut paikannimikerros.
const SATELLITE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SATELLITE_LABELS_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
const ESRI_CREDIT = 'Esri, Maxar, Earthstar Geographics, and the GIS User Community';

const ROUTE_COLOR = '#fbbf24'; // sama keltainen kuin 2D-reitti / korkeuskäyrä
const CRAFT_COLOR = '#35d6e6'; // satelliittipisteen syaani

const GROUND_CLAMP_LIMIT = 150; // m — tämän alapuolella dotti naulataan maahan

// Kamerakulmat asteina (Cesium.Math ei ole käytettävissä moduulin latautuessa).
const VIEW_HEADING_DEG = 35;   // Sivu-tilan sivukulma
const VIEW_PITCH_DEG = -4;     // Sivu-tilan loiva alaspäin
const VIEW_BASE_RANGE = 4000;  // m, vähimmäisetäisyys kohteeseen
const ORBIT_PITCH_DEG = -20;   // Kierto: katsekulma
const ORBIT_DEG_PER_SEC = 8;   // Kierto: täysi kierros ~45 s
const TOP_PITCH_DEG = -89;     // Ylhäältä: lähes suoraan alas (ei tasan -90)
const TOP_HEADING_DEG = 0;     // Ylhäältä: pohjoinen ylös
const TOP_RANGE_FACTOR = 1.5;  // Ylhäältä istuu hieman lähempänä kuin sivu (2.2)
const FLYOVER_DURATION = 4.0;  // Lento-animaation kesto sekunteina

// Sivu/Kierto: etäisyys kasvaa korkeuden mukana, jotta korkeusverho pysyy kuvassa.
function viewRange(altMeters) {
  return VIEW_BASE_RANGE + (Number.isFinite(altMeters) ? altMeters : 0) * 2.2;
}

// Kameran asento valitulle tilalle (kohde = satelliitti).
function poseForMode(Cesium, mode, altMeters) {
  const alt = Number.isFinite(altMeters) ? altMeters : 0;
  if (mode === 'kierto') {
    return new Cesium.HeadingPitchRange(
      Cesium.Math.toRadians(VIEW_HEADING_DEG),
      Cesium.Math.toRadians(ORBIT_PITCH_DEG),
      viewRange(alt)
    );
  }
  if (mode === 'ylha') {
    return new Cesium.HeadingPitchRange(
      Cesium.Math.toRadians(TOP_HEADING_DEG),
      Cesium.Math.toRadians(TOP_PITCH_DEG),
      VIEW_BASE_RANGE + alt * TOP_RANGE_FACTOR
    );
  }
  return new Cesium.HeadingPitchRange(
    Cesium.Math.toRadians(VIEW_HEADING_DEG),
    Cesium.Math.toRadians(VIEW_PITCH_DEG),
    viewRange(alt)
  );
}

// Rakentaa valitun pohjakartan kuvakerrokset. Satelliitti = kuva + nimikerros
// (ei kirkastusta, oikea valotus); kartta = teemoitettu CARTO (tumma kirkastetaan).
function buildBasemapLayers(Cesium, basemap, theme) {
  if (basemap === 'satellite') {
    const imagery = new Cesium.ImageryLayer(
      new Cesium.UrlTemplateImageryProvider({
        url: SATELLITE_URL,
        maximumLevel: 19,
        credit: ESRI_CREDIT,
      })
    );
    const labels = new Cesium.ImageryLayer(
      new Cesium.UrlTemplateImageryProvider({
        url: SATELLITE_LABELS_URL,
        maximumLevel: 19,
      })
    );
    return [imagery, labels];
  }
  const layer = new Cesium.ImageryLayer(
    new Cesium.UrlTemplateImageryProvider({
      url: CARTO_URLS[theme] ?? CARTO_URLS.dark,
      subdomains: 'abcd',
      credit: '© CARTO © OpenStreetMap contributors',
      maximumLevel: 19,
    })
  );
  if (theme === 'dark') {
    layer.brightness = 2.0;
    layer.contrast = 1.1;
    layer.saturation = 1.3;
  }
  return [layer];
}

// Vaihtaa näkyvät kuvakerrokset valitun pohjakartan mukaan.
function applyBasemap(Cesium, viewer, basemap, theme) {
  viewer.imageryLayers.removeAll(true);
  for (const layer of buildBasemapLayers(Cesium, basemap, theme)) {
    viewer.imageryLayers.add(layer);
  }
}

// Muuntaa reittipisteet Cartesian3-taulukoksi.
function toCartesians(Cesium, route3d) {
  return route3d
    .filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon))
    .map((p) =>
      Cesium.Cartesian3.fromDegrees(p.lon, p.lat, Number.isFinite(p.alt) ? p.alt : 0)
    );
}

function Globe3D({
  lat,
  lng,
  alt,
  route3d = [],
  theme = 'dark',
  basemap = 'satellite',
  cameraMode = 'sivu',
  resetNonce = 0,
  flyoverNonce = 0,
}) {
  const containerRef = useRef(null);
  const cesiumRef = useRef(null);       // window.Cesium
  const viewerRef = useRef(null);
  const craftEntityRef = useRef(null);
  const positionsRef = useRef([]);      // Cesium.Cartesian3[]
  const craftPosRef = useRef(null);     // Cesium.Cartesian3 | null
  const altRef = useRef(0);             // viimeisin korkeus kameran etäisyyttä varten
  const basemapRef = useRef(basemap);   // tuorein pohjakartta async-alustusta varten
  const themeRef = useRef(theme);       // tuorein teema async-alustusta varten
  const autoTrackRef = useRef(false);   // seuraako kamera satelliittia
  const didFirstFlyRef = useRef(false);
  const cameraModeRef = useRef(cameraMode); // preRender lukee aina tuoreimman tilan
  const orbitStartRef = useRef(null);       // Cesium.JulianDate: kierron alkuhetki
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'

  // Lentää valitun kameratilan asentoon ja kytkee seurannan päälle.
  // Käytetään ensimmäisellä fixillä, "Palauta näkymä" -toiminnolla ja napilla.
  const flyToCurrentPose = useCallback(() => {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer || viewer.isDestroyed() || !craftPosRef.current) return;
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    autoTrackRef.current = false;
    if (cameraModeRef.current === 'kierto') {
      orbitStartRef.current = Cesium.JulianDate.clone(viewer.clock.currentTime);
    }
    viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(craftPosRef.current, 1), {
      offset: poseForMode(Cesium, cameraModeRef.current, altRef.current),
      duration: 1.5,
      complete: () => {
        autoTrackRef.current = true;
      },
    });
    // Tyhjä dep-taulukko on tarkoituksellinen: funktio lukee kameratilan ja
    // sijainnin refien kautta → vakaa identiteetti, ei vanhentunutta sulkeumaa.
    // Älä "korjaa" exhaustive-depsin mukaan, se rikkoisi palautus-/seurantalogiikan.
  }, []);

  // Alusta Cesium-viewer kerran.
  useEffect(() => {
    let cancelled = false;

    loadCesium()
      .then((Cesium) => {
        if (cancelled || !containerRef.current) return;
        cesiumRef.current = Cesium;

        const viewer = new Cesium.Viewer(containerRef.current, {
          // Tokeniton: oma kuvakerros (satelliitti tai CARTO), ei Ion-oletusta.
          baseLayer: false,
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

        applyBasemap(Cesium, viewer, basemapRef.current, themeRef.current);

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

        // Seuranta: joka ruudulla kamera asetetaan valitun tilan mukaan
        // satelliitin ympärille. HeadingPitchRange luodaan kerran ja sen arvot
        // päivittyvät tilan ja korkeuden mukana (vältetään GC-paine).
        const trackHpr = new Cesium.HeadingPitchRange(
          Cesium.Math.toRadians(VIEW_HEADING_DEG),
          Cesium.Math.toRadians(VIEW_PITCH_DEG),
          VIEW_BASE_RANGE
        );
        viewer.scene.preRender.addEventListener(() => {
          if (!autoTrackRef.current || !craftPosRef.current) return;
          const mode = cameraModeRef.current;
          const a = altRef.current;
          if (mode === 'kierto') {
            const elapsed = orbitStartRef.current
              ? Cesium.JulianDate.secondsDifference(viewer.clock.currentTime, orbitStartRef.current)
              : 0;
            trackHpr.heading = Cesium.Math.toRadians(VIEW_HEADING_DEG + ORBIT_DEG_PER_SEC * elapsed);
            trackHpr.pitch = Cesium.Math.toRadians(ORBIT_PITCH_DEG);
            trackHpr.range = viewRange(a);
          } else if (mode === 'ylha') {
            trackHpr.heading = Cesium.Math.toRadians(TOP_HEADING_DEG);
            trackHpr.pitch = Cesium.Math.toRadians(TOP_PITCH_DEG);
            trackHpr.range = VIEW_BASE_RANGE + (Number.isFinite(a) ? a : 0) * TOP_RANGE_FACTOR;
          } else {
            trackHpr.heading = Cesium.Math.toRadians(VIEW_HEADING_DEG);
            trackHpr.pitch = Cesium.Math.toRadians(VIEW_PITCH_DEG);
            trackHpr.range = viewRange(a);
          }
          viewer.camera.lookAt(craftPosRef.current, trackHpr);
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
    // Ensimmäisellä fixillä lennetään valitun tilan näkymään ja kytketään seuranta.
    if (!didFirstFlyRef.current) {
      didFirstFlyRef.current = true;
      flyToCurrentPose();
    }
  }, [lat, lng, alt, status, flyToCurrentPose]);

  // Pidä refit ajan tasalla, jotta Cesiumin async-alustus käyttää tuoreimpia arvoja.
  useEffect(() => {
    basemapRef.current = basemap;
    themeRef.current = theme;
  }, [basemap, theme]);

  // Vaihda pohjakartta tai teema.
  useEffect(() => {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer || viewer.isDestroyed() || status !== 'ready') return;
    applyBasemap(Cesium, viewer, basemap, theme);
  }, [basemap, theme, status]);

  // Pidä kameratila tuoreena preRenderille; kierto alkaa alusta tilaan tultaessa,
  // ja tilan valinta jatkaa seurantaa (käyttäjän tahto seurata).
  useEffect(() => {
    cameraModeRef.current = cameraMode;
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer || viewer.isDestroyed() || status !== 'ready') return;
    if (cameraMode === 'kierto') {
      orbitStartRef.current = Cesium.JulianDate.clone(viewer.clock.currentTime);
    }
    if (craftPosRef.current) autoTrackRef.current = true;
  }, [cameraMode, status]);

  // "Palauta näkymä": kehystä nykyinen kameratila uudelleen satelliittiin.
  useEffect(() => {
    if (resetNonce === 0) return; // ei laukaista ensirenderissä
    flyToCurrentPose();
  }, [resetNonce, flyToCurrentPose]);

  // "Lento": pyyhkäise koko reitin yli ja palaa seurantaan valittuun tilaan.
  useEffect(() => {
    if (flyoverNonce === 0) return;
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer || viewer.isDestroyed() || !craftPosRef.current) return;
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    autoTrackRef.current = false;
    const positions = positionsRef.current;
    const sphere =
      positions.length >= 2
        ? Cesium.BoundingSphere.fromPoints(positions)
        : new Cesium.BoundingSphere(craftPosRef.current, VIEW_BASE_RANGE);
    viewer.camera.flyToBoundingSphere(sphere, {
      offset: new Cesium.HeadingPitchRange(
        Cesium.Math.toRadians(VIEW_HEADING_DEG),
        Cesium.Math.toRadians(-30),
        sphere.radius * 2.5
      ),
      duration: FLYOVER_DURATION,
      complete: () => {
        if (cameraModeRef.current === 'kierto') {
          orbitStartRef.current = Cesium.JulianDate.clone(viewer.clock.currentTime);
        }
        autoTrackRef.current = true;
      },
    });
  }, [flyoverNonce]);

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
    </div>
  );
}

export default Globe3D;
