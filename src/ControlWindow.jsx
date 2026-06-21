import { useEffect, useRef, useState } from 'react';
import ControlPanel from './components/ControlPanel';
import { createControlChannel, readPersistedState } from './lib/controlChannel';
import './App.css';

// Erillinen ohjausikkuna (#ohjaus). Kevyt: ei karttoja eikä telemetriaa, vain
// napit ja viestikanava. Lähettää komennot koontinäytölle ja heijastaa sen
// tilan (nappien korostukset) takaisin tulevista tila-viesteistä.
export default function ControlWindow() {
  const [state, setState] = useState(readPersistedState);
  const channelRef = useRef(null);

  useEffect(() => {
    const channel = createControlChannel();
    channelRef.current = channel;

    const unsubscribe = channel.subscribe((msg) => {
      if (msg?.type === 'state' && msg.state) setState(msg.state);
    });

    // Ilmoittaudu: koontinäyttö vastaa tilalla ja piilottaa omat säätimensä.
    channel.post({ type: 'hello' });
    const sayBye = () => channel.post({ type: 'bye' });
    window.addEventListener('beforeunload', sayBye);

    return () => {
      sayBye();
      window.removeEventListener('beforeunload', sayBye);
      unsubscribe();
      channel.close();
      channelRef.current = null;
    };
  }, []);

  const command = (name, value) =>
    channelRef.current?.post({ type: 'command', name, value });

  return (
    <div className="control-window-page">
      <header className="control-window-header">OHJAUS</header>
      <ControlPanel
        mapMode={state.mapMode}
        onMapModeChange={(v) => command('setMapMode', v)}
        basemap={state.basemap}
        onBasemapChange={(v) => command('setBasemap', v)}
        cameraMode={state.cameraMode}
        onCameraModeChange={(v) => command('setCameraMode', v)}
        onReset={() => command('reset')}
        onFlyover={() => command('lento')}
        maintenance={state.maintenance}
        onMaintenanceToggle={() => command('setMaintenance', !state.maintenance)}
      />
    </div>
  );
}
