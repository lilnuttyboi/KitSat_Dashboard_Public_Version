import { Component } from 'react';

// Virheraja: yksittäinen render-virhe (esim. kirjasto, odottamaton datamuoto tai
// epäonnistunut lazy-chunkin lataus) ei saa kaataa koko sivua valkoiseksi.
// Näytetään suomenkielinen varailmoitus ja tarjotaan sivun uudelleenlataus.
export default class ErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // Lokitetaan diagnosointia varten; katsojalle näytetään vain varailmoitus.
    console.error('Render-virhe:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="loading">
          <p>Jokin meni pieleen.</p>
          <button
            className="open-control-btn"
            style={{ marginTop: '1rem' }}
            onClick={() => window.location.reload()}
          >
            Päivitä sivu
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
