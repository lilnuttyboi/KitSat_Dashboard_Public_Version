// Huoltoruutu: peittää koko julkisen näkymän kun huoltotila on päällä.
// Pelkkä brändiruutu: keskitetty logorivi + valinnainen iskulause.

// Logot renderöidään rivinä (nyt yksi). Lisää myöhemmin uusia { src, alt }
// -alkioita → rivi kasvaa ja kietoutuu ilman muutoksia merkkaukseen/tyyleihin.
// Tiedosto on public/-kansiossa, joten viitataan BASE_URL:n kautta.
const LOGOS = [
  { src: `${import.meta.env.BASE_URL}maintenance-logo.svg`, alt: 'Pori Space Lab' },
];

// Valinnainen iskulause — tyhjä = ei näytetä. Täytä myöhemmin, näkyy automaattisesti.
const TAGLINE = '';

export default function MaintenanceOverlay() {
  return (
    <div className="maintenance-overlay" role="status" aria-live="polite">
      <div className="maintenance-inner">
        <div className="maintenance-logos">
          {LOGOS.map((logo) => (
            <img key={logo.src} className="maintenance-logo-img" src={logo.src} alt={logo.alt} />
          ))}
        </div>
        {TAGLINE && <p className="maintenance-tagline">{TAGLINE}</p>}
      </div>
    </div>
  );
}
