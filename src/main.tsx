import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { isNativeApp } from './lib/native';
import { session } from './lib/session';
import '@fontsource-variable/nunito';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

void session.restore();

// The Android app ships its files inside the APK, so it needs no offline cache.
if ('serviceWorker' in navigator && import.meta.env.PROD && !isNativeApp) {
  void navigator.serviceWorker.register('./sw.js');
}
