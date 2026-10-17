import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json' with { type: 'json' };

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

// Each build gets an id; the running app polls version.json and offers a reload when it changes.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const BUILD = env.GITHUB_SHA?.slice(0, 7) ?? Date.now().toString(36);

function versionPlugin(): Plugin {
  return {
    name: 'emit-version',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD }) });
    },
  };
}

export default defineConfig({
  // Relative base so the build works at https://<user>.github.io/<repo>/ without configuration.
  base: './',
  plugins: [react(), cspPlugin(), versionPlugin()],
  define: { __BUILD__: JSON.stringify(BUILD), __APP_VERSION__: JSON.stringify(pkg.version) },
});
