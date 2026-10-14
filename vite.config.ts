import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// API keys live in localStorage, so the production build gets a strict CSP:
// only our own scripts run, while fetch() may reach any HTTPS API (plus a
// local server such as Ollama). Dev mode skips it because Vite's HMR uses
// inline scripts.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self' https: http://localhost:* http://127.0.0.1:*",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
  };
}

export default defineConfig({
  // Relative base so the build works at https://<user>.github.io/<repo>/ without configuration.
  base: './',
  plugins: [react(), cspPlugin()],
});
