import { useState, useEffect } from 'react';

// Seuraa media query -ehtoa ja päivittyy kun ikkunan koko/asento ylittää rajan.
// Alkuarvo luetaan heti renderissä; muutokset tulevat matchMedia-kuuntelijalta
// (setState vain callbackissa -> ei "setState in effect" -varoitusta).
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = (e) => setMatches(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
