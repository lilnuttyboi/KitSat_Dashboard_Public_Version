// Huoltoruutu: peittää koko julkisen näkymän kun huoltotila on päällä.
// Pelkkä brändiruutu: PORI SPACE LAB -sanamerkki + valinnainen iskulause.
const LOGO = 'PORI SPACE LAB';

// Valinnainen iskulause — tyhjä = ei näytetä. Täytä myöhemmin, näkyy automaattisesti.
const TAGLINE = '';

export default function MaintenanceOverlay() {
  return (
    <div className="maintenance-overlay" role="status" aria-live="polite">
      <div className="maintenance-inner">
        <h1 className="maintenance-logo">{LOGO}</h1>
        {TAGLINE && <p className="maintenance-tagline">{TAGLINE}</p>}
      </div>
    </div>
  );
}
