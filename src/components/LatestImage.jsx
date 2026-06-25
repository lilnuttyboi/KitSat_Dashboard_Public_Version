import { useState } from 'react';

// Kuva tulee nyt /api/latest-pollauksen mukana (useTelemetry); ei omaa hookia.
export default function LatestImage({ imageUrl, loading }) {
  // Muistetaan mikä URL epäonnistui: kun kuva-URL vaihtuu, vertailu menee
  // automaattisesti epätodeksi eikä virhetilaa tarvitse erikseen nollata.
  const [brokenUrl, setBrokenUrl] = useState(null);

  if (loading && !imageUrl) return <div className="image-empty">LADATAAN…</div>;
  // Jos kuva on poistettu/vanhentunut tai sen lataus epäonnistuu, näytetään
  // sama "EI KUVIA" -tila rikkinäisen kuvakkeen sijaan.
  if (!imageUrl || brokenUrl === imageUrl) return <div className="image-empty">EI KUVIA</div>;

  return (
    <div className="latest-image-wrapper">
      <img
        src={imageUrl}
        alt="Viimeisin KitSat-kuva"
        className="latest-image"
        onError={() => setBrokenUrl(imageUrl)}
      />
    </div>
  );
}
