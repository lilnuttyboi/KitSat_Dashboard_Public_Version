// Huoltoruutu: peittää koko julkisen näkymän kun huoltotila on päällä.
// Kolme tekstiä on eristetty vakioiksi, jotta niitä on helppo muokata.
const LOGO = 'PORI SPACE LAB';
const STATUS = 'Huoltotauko käynnissä';
const FUNNY = 'Ruuvataan vielä pari pulttia kiinni — palaamme pian.';

export default function MaintenanceOverlay() {
  return (
    <div className="maintenance-overlay" role="status" aria-live="polite">
      <div className="maintenance-inner">
        <div className="maintenance-gear" aria-hidden="true">⚙</div>
        <h1 className="maintenance-logo">{LOGO}</h1>
        <p className="maintenance-status">{STATUS}</p>
        <p className="maintenance-funny">{FUNNY}</p>
      </div>
    </div>
  );
}
