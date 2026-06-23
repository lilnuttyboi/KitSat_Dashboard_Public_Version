// Tietoja-ruutu: peittää koko julkisen näkymän kun operaattori kytkee sen päältä
// ohjauspaneelista. Brändi- ja tekijäsivu: PORI SPACE LAB -sanamerkki,
// valinnainen iskulause, tekijälista sekä valinnaiset kumppanilogot ja linkit.
//
// ── TÄYTÄ TÄHÄN ──────────────────────────────────────────────────────────────
// Kaikki sisältö tulee alla olevista vakioista — muuta vain näitä, ei JSX:ää.
//  • TAGLINE: jätä tyhjäksi ('') jos et halua iskulausetta.
//  • CREDITS: tekijät { name, role }. Lisää/poista rivejä vapaasti.
//  • LOGOS: kumppani-/sponsorilogot. Pudota kuvatiedostot public-kansioon ja
//    viittaa niihin juuripolulla (esim. '/logo.png' → public/logo.png).
//    Tyhjä lista = ei logoriviä.
//  • LINKS: valinnaiset linkit (verkkosivu, some). Tyhjä lista = ei linkkejä.
// ─────────────────────────────────────────────────────────────────────────────

const LOGO = 'PORI SPACE LAB';

const TAGLINE = '';

// Tekijät — korvaa esimerkkirivit oikeilla nimillä ja rooleilla.
const CREDITS = [
  { name: 'Nimi Nimetön', role: 'Projektin johto' },
  { name: 'Nimi Nimetön', role: 'Laitteisto' },
  { name: 'Nimi Nimetön', role: 'Ohjelmisto' },
  { name: 'Nimi Nimetön', role: 'Maa-asema' },
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

        {CREDITS.length > 0 && (
          <div className="maintenance-credits">
            <span className="maintenance-credits-title">Tekijät</span>
            <ul className="maintenance-credit-list">
              {CREDITS.map((c, i) => (
                <li key={`${c.name}-${i}`} className="maintenance-credit">
                  <span className="maintenance-credit-name">{c.name}</span>
                  <span className="maintenance-credit-role">{c.role}</span>
                </li>
              ))}
            </ul>
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
