import { useEffect, useRef, useState } from 'react';

// Huoltoruutu: peittää koko julkisen näkymän kun huoltotila on päällä.
// Tekstit on eristetty vakioiksi, jotta niitä on helppo muokata.
const LOGO = 'PORI SPACE LAB';
const STATUS = 'Huoltotoimet käynnissä';
const FUNNY = 'Ruuvataan vielä pari pulttia kiinni palaamme pian...';

// Kirjoituskoneanimaation ajat (ms).
const TYPE_MS = 55;   // merkin kirjoitusväli
const ERASE_MS = 30;  // merkin pyyhkimisväli
const HOLD_MS = 2200; // tauko kun teksti on valmis
const GAP_MS = 600;   // tauko ennen uutta kirjoituskierrosta

function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {
    void e;
    return false;
  }
}

// Looppaava kirjoituskone: kirjoittaa → pitää tauon → pyyhkii → toistaa.
// Liikettä vältettäessä näytetään koko teksti staattisena. Alkuarvo asetetaan
// lazy-initializerillä, joten efektin sisällä ei tehdä synkronista setStatea
// (kaikki päivitykset tulevat ajastimelta).
function useTypewriter(text) {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? text : ''));
  const timerRef = useRef(null);

  useEffect(() => {
    if (prefersReducedMotion()) return undefined; // staattinen teksti, ei animaatiota
    let i = 0;
    let erasing = false;
    const tick = () => {
      if (!erasing) {
        i += 1;
        setShown(text.slice(0, i));
        if (i >= text.length) {
          erasing = true;
          timerRef.current = setTimeout(tick, HOLD_MS);
          return;
        }
        timerRef.current = setTimeout(tick, TYPE_MS);
      } else {
        i -= 1;
        setShown(text.slice(0, i));
        if (i <= 0) {
          erasing = false;
          timerRef.current = setTimeout(tick, GAP_MS);
          return;
        }
        timerRef.current = setTimeout(tick, ERASE_MS);
      }
    };
    timerRef.current = setTimeout(tick, TYPE_MS);
    return () => clearTimeout(timerRef.current);
  }, [text]);

  return shown;
}

export default function MaintenanceOverlay() {
  const typed = useTypewriter(FUNNY);
  const animated = !prefersReducedMotion();

  return (
    <div className="maintenance-overlay" role="status" aria-live="polite">
      <div className="maintenance-inner">
        <h1 className="maintenance-logo">{LOGO}</h1>
        <p className="maintenance-status">{STATUS}</p>
        {/* Animoitu rivi piilotetaan ruudunlukijalta (näppäinkohina); staattinen
            (reduced-motion) versio luetaan normaalisti. */}
        <p className="maintenance-funny" aria-hidden={animated ? 'true' : undefined}>
          {typed}
          {animated && <span className="maintenance-caret" aria-hidden="true">|</span>}
        </p>
      </div>
    </div>
  );
}
