import { useState } from 'react';
import { useLatestImage } from '../hooks/useLatestImage';

export default function LatestImage() {
  const { url, loading } = useLatestImage();
  // Muistetaan mikä URL epäonnistui: kun kuva-URL vaihtuu, vertailu menee
  // automaattisesti epätodeksi eikä virhetilaa tarvitse erikseen nollata.
  const [brokenUrl, setBrokenUrl] = useState(null);

  if (loading) return <div className="image-empty">LADATAAN…</div>;
  // Jos kuva on poistettu/vanhentunut tai sen lataus epäonnistuu, näytetään
  // sama "EI KUVIA" -tila rikkinäisen kuvakkeen sijaan.
  if (!url || brokenUrl === url) return <div className="image-empty">EI KUVIA</div>;

  return (
    <div className="latest-image-wrapper">
      <img
        src={url}
        alt="Viimeisin KitSat-kuva"
        className="latest-image"
        onError={() => setBrokenUrl(url)}
      />
    </div>
  );
}
