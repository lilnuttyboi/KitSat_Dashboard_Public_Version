import { memo, useEffect, useMemo, useState } from 'react';
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

function MapEffects({ lat, lng }) {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 0);
    return () => clearTimeout(t);
  }, [map]);
  useEffect(() => {
    if (lat == null || lng == null) return;
    const c = map.getCenter();
    if (c.lat === lat && c.lng === lng) return;
    map.setView([lat, lng], map.getZoom());
  }, [lat, lng, map]);
  return null;
}

const MapComponent = memo(({ lat, lng, route = [], theme = 'dark', basemap = 'satellite' }) => {
  const hasValidCoords = lat != null && lng != null;
  // Keskipiste kiinnitetään mount-hetkellä: MapContainer ei seuraa center-propin
  // muutoksia, vaan näkymää siirtää MapEffects.
  const [initialCenter] = useState(() => (hasValidCoords ? [lat, lng] : DEFAULT_CENTER));
  const markerPosition = useMemo(() => [lat ?? 0, lng ?? 0], [lat, lng]);
  const showRoute = route.length >= 2;

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
        <MapEffects lat={lat} lng={lng} />
      </MapContainer>
    </div>
  );
});

export default MapComponent;
