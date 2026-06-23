import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({ iconRetinaUrl, iconUrl, shadowUrl });

const BALLOON_SVG = `
<svg viewBox="0 0 32 44" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="16" cy="15" rx="13" ry="14" fill="#fbbf24" stroke="#0b0f1a" stroke-width="1.5"/>
  <path d="M14 28 L13 32 M18 28 L19 32" stroke="#0b0f1a" stroke-width="1.5" fill="none" stroke-linecap="round"/>
  <line x1="16" y1="29" x2="16" y2="34" stroke="#0b0f1a" stroke-width="1.5"/>
  <rect x="11" y="34" width="10" height="7" fill="#0b0f1a" stroke="#fbbf24" stroke-width="1" rx="1"/>
</svg>
`;

const balloonIcon = L.divIcon({
  className: 'balloon-marker',
  html: BALLOON_SVG,
  iconSize: [32, 44],
  iconAnchor: [16, 41],
  popupAnchor: [0, -36],
});

const DEFAULT_CENTER = [60.1695, 24.9354];

// Karttapohja teeman mukaan: dark-tilassa CARTOn tumma tyyli (kirkastetaan
// CSS:llä App.css:ssä), light-tilassa värillinen Voyager sellaisenaan.
const TILE_URLS = {
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  light: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
};

// Satelliittipohjakartta: Esri World Imagery (ei vaadi API-avainta) +
// nimistökerros päälle luettavuuden vuoksi.
const ESRI_SATELLITE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_LABELS_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

// Lähin sallittu zoom-taso automaattisovituksessa: estää liiallisen
// lähentymisen kun reitti on vasta muutaman metrin mittainen.
const FOLLOW_MAX_ZOOM = 15;

function MapEffects({ lat, lng, route, recenterNonce, onFollowingChange }) {
  const map = useMap();
  // Tuoreimmat arvot refeissä, jotta kerran rekisteröidyt käsittelijät lukevat
  // aina viimeisimmän kohteen ilman uudelleenrekisteröintiä.
  const targetRef = useRef({ lat, lng, route });
  const followingRef = useRef(true); // seurataanko satelliittia juuri nyt
  const selfMoveRef = useRef(false); // tosi kun me siirrämme karttaa ohjelmallisesti

  useEffect(() => {
    targetRef.current = { lat, lng, route };
  }, [lat, lng, route]);

  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 0);
    return () => clearTimeout(t);
  }, [map]);

  // Asettaa seurantatilan ja ilmoittaa siitä yläkomponentille (napin näkyvyys).
  const setFollowing = useCallback(
    (value) => {
      followingRef.current = value;
      onFollowingChange?.(value);
    },
    [onFollowingChange]
  );

  // Sovittaa näkymän satelliittiin + koko reittiin. Näkymä levenee itsestään kun
  // pallo nousee ja ajautuu kauas; maxZoom estää liiallisen lähentymisen alussa.
  const fitToTarget = useCallback(() => {
    const { lat: tLat, lng: tLng, route: tRoute } = targetRef.current;
    if (tLat == null || tLng == null) return;
    const points = [];
    if (Array.isArray(tRoute)) {
      for (const p of tRoute) {
        if (Array.isArray(p) && p[0] != null && p[1] != null) points.push(p);
      }
    }
    points.push([tLat, tLng]);
    selfMoveRef.current = true; // merkitse oma siirto, jottei sitä lueta käyttäjän eleeksi
    if (points.length >= 2) {
      map.fitBounds(L.latLngBounds(points), {
        padding: [48, 48],
        maxZoom: FOLLOW_MAX_ZOOM,
        animate: true,
        duration: 0.5,
      });
    } else {
      map.setView([tLat, tLng], Math.min(map.getZoom(), FOLLOW_MAX_ZOOM), {
        animate: true,
        duration: 0.5,
      });
    }
  }, [map]);

  // Käyttäjän ele keskeyttää seurannan. Seuranta pysyy poissa kunnes käyttäjä
  // painaa "Keskitä satelliittiin" -nappia (ainoa manuaalinen palautus).
  const pauseFollow = useCallback(() => {
    if (followingRef.current) setFollowing(false);
  }, [setFollowing]);

  // Seuraa satelliittia: joka päivityksellä sovita näkymä, jos seuranta on päällä.
  useEffect(() => {
    if (lat == null || lng == null) return;
    if (followingRef.current) fitToTarget();
  }, [lat, lng, route, fitToTarget]);

  // "Keskitä satelliittiin" -nappi: jatka seurantaa ja sovita näkymä heti.
  useEffect(() => {
    if (recenterNonce === 0) return; // ei laukaista ensirenderissä
    setFollowing(true);
    fitToTarget();
  }, [recenterNonce, setFollowing, fitToTarget]);

  // Erota käyttäjän eleet omista ohjelmallisista siirroista: ohjelmalliset
  // merkitään selfMoveRefillä ja nollataan moveend-tapahtumassa. Raahaus on aina
  // käyttäjän ele (ei laukea ohjelmallisesti), zoom vain kun selfMove ei ole päällä.
  useEffect(() => {
    const onMoveEnd = () => {
      selfMoveRef.current = false;
    };
    const onDragStart = () => pauseFollow();
    const onZoomStart = () => {
      if (!selfMoveRef.current) pauseFollow();
    };
    map.on('moveend', onMoveEnd);
    map.on('dragstart', onDragStart);
    map.on('zoomstart', onZoomStart);
    return () => {
      map.off('moveend', onMoveEnd);
      map.off('dragstart', onDragStart);
      map.off('zoomstart', onZoomStart);
    };
  }, [map, pauseFollow]);

  return null;
}

const MapComponent = memo(({ lat, lng, route = [], theme = 'dark', basemap = 'satellite' }) => {
  const hasValidCoords = lat != null && lng != null;
  // Keskipiste kiinnitetään mount-hetkellä: MapContainer ei seuraa center-propin
  // muutoksia, vaan näkymää siirtää MapEffects.
  const [initialCenter] = useState(() => (hasValidCoords ? [lat, lng] : DEFAULT_CENTER));
  const markerPosition = useMemo(() => [lat ?? 0, lng ?? 0], [lat, lng]);
  const showRoute = route.length >= 2;
  // Seurantatila nostettu tänne napin näkyvyyttä varten; nappi pyytää
  // uudelleenkeskityksen nostamalla noncea, jonka MapEffects havaitsee.
  const [following, setFollowing] = useState(true);
  const [recenterNonce, setRecenterNonce] = useState(0);

  return (
    <div className={`map-wrapper${basemap === 'satellite' ? ' map-wrapper--satellite' : ''}`}>
      <MapContainer
        center={initialCenter}
        zoom={13}
        scrollWheelZoom={true}
        style={{ height: '100%', width: '100%' }}
      >
        {basemap === 'satellite' ? (
          <>
            {/* Esri World Imagery — ei vaadi API-avainta */}
            <TileLayer
              key="satellite"
              attribution='Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
              url={ESRI_SATELLITE_URL}
              maxZoom={19}
            />
            {/* Nimistö ja rajat satelliitin päälle */}
            <TileLayer
              key="satellite-labels"
              attribution=''
              url={ESRI_LABELS_URL}
              maxZoom={19}
              opacity={0.8}
            />
          </>
        ) : (
          <TileLayer
            key={theme}
            attribution='&copy; <a href="https://carto.com/attributions">CARTO</a> &copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url={TILE_URLS[theme] ?? TILE_URLS.dark}
            subdomains="abcd"
          />
        )}
        {showRoute && (
          <Polyline
            positions={route}
            pathOptions={{ color: '#fbbf24', weight: 3, opacity: 0.9 }}
          />
        )}
        {hasValidCoords && (
          <Marker position={markerPosition} icon={balloonIcon}>
            <Popup>
              KitSatin nykyinen sijainti <br />
              {lat.toFixed(4)}, {lng.toFixed(4)}
            </Popup>
          </Marker>
        )}
        <MapEffects
          lat={lat}
          lng={lng}
          route={route}
          recenterNonce={recenterNonce}
          onFollowingChange={setFollowing}
        />
      </MapContainer>
      {/* Ainoa manuaalinen säädin: näkyy vain kun käyttäjä on siirtänyt karttaa
          pois seurannasta. Palauttaa seurannan ja keskittää satelliittiin. */}
      {!following && hasValidCoords && (
        <button
          type="button"
          className="map-recenter-btn"
          onClick={() => setRecenterNonce((n) => n + 1)}
        >
          Keskitä satelliittiin
        </button>
      )}
    </div>
  );
});

export default MapComponent;
