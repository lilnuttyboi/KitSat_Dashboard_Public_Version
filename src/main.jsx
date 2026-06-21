import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ControlWindow from './ControlWindow.jsx'

// #ohjaus → erillinen kevyt ohjausikkuna; muuten varsinainen koontinäyttö.
const isControl = window.location.hash === '#ohjaus';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isControl ? <ControlWindow /> : <App />}
  </StrictMode>,
)
