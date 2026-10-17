import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { session } from './lib/session';
import '@fontsource-variable/nunito';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

void session.restore();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register('./sw.js');
}
