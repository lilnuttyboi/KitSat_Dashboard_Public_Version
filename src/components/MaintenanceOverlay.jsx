// Tietoja-ruutu: peittää koko julkisen näkymän kun operaattori kytkee sen päältä
// ohjauspaneelista. Brändi- ja esittelysivu: PORI SPACE LAB -sanamerkki,
// valinnainen iskulause, esittelyteksti sekä valinnaiset kumppanilogot ja linkit.
//
// ── TÄYTÄ TÄHÄN ──────────────────────────────────────────────────────────────
// Kaikki sisältö tulee alla olevista vakioista — muuta vain näitä, ei JSX:ää.
//  • TAGLINE: jätä tyhjäksi ('') jos et halua iskulausetta.
//  • ABOUT: esittelytekstin kappaleet. Lisää/poista rivejä vapaasti.
//  • LOGOS: kumppani-/sponsorilogot. Pudota kuvatiedostot public-kansioon ja
//    viittaa niihin juuripolulla (esim. '/logo.png' → public/logo.png).
//    Tyhjä lista = ei logoriviä.
//  • LINKS: valinnaiset linkit (verkkosivu, some). Tyhjä lista = ei linkkejä.
// ─────────────────────────────────────────────────────────────────────────────

const LOGO = 'PORI SPACE LAB';

const TAGLINE = '';

// Esittelyteksti — mikä sivu on, miksi se on tehty ja kenen toimesta.
const ABOUT = [
  'Tämä on julkinen seurantasivu Pori Space Labin KitSat-satelliitin laukaisulle Suomi Areena 2026 -tapahtumassa Porissa. Täältä voit seurata satelliitin kulkua ja telemetriaa reaaliajassa.',
  'Laukaisu on samalla Pori Space Labin virallinen avaus.',
  'Sivuston ja satelliitin ovat toteuttaneet SAMKin opiskelijat yhteistyössä Turun yliopiston kanssa.',
];

// Kumppani-/sponsorilogot — esim. [{ src: '/logo.png', alt: 'Kumppani' }].
const LOGOS = [];

// Valinnaiset linkit — esim. [{ label: 'porispacelab.fi', href: 'https://...' }].
const LINKS = [];

export default function MaintenanceOverlay() {
  return (
    <div className="maintenance-overlay" role="status" aria-live="polite">
      <div className="maintenance-inner">
        <h1 className="maintenance-logo">{LOGO}</h1>
        {TAGLINE && <p className="maintenance-tagline">{TAGLINE}</p>}

        {LOGOS.length > 0 && (
          <div className="maintenance-logos">
            {LOGOS.map((l) => (
              <img key={l.src} className="maintenance-logo-img" src={l.src} alt={l.alt ?? ''} />
            ))}
          </div>
        )}

        {ABOUT.length > 0 && (
          <div className="maintenance-about">
            {ABOUT.map((p, i) => (
              <p key={i} className="maintenance-about-text">{p}</p>
            ))}
          </div>
        )}

        {LINKS.length > 0 && (
          <div className="maintenance-links">
            {LINKS.map((l) => (
              <a key={l.href} className="maintenance-link" href={l.href} target="_blank" rel="noreferrer">
                {l.label}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
