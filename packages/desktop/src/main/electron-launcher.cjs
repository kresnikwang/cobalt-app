/**
 * Thin CJS launcher for Electron main process.
 *
 * Electron's built-in `electron` module cannot be imported from ESM on
 * Node.js ≥ v20.18 due to a CJS‑to‑ESM interop regression. This file
 * loads all Electron APIs via classic `require()`, stores them on
 * `globalThis.__electron`, applies global patches (proxy agent, fetch
 * override), then dynamically imports the ESM application entry point.
 */

const path = require('path');
const electron = require('electron');
const fs = require('fs');

// Debug: check what electron module looks like
console.log('[launcher] electron keys:', Object.keys(electron).join(', ') || '(none)');
console.log('[launcher] electron.app:', typeof electron.app);

if (!electron.app) {
  console.error('[launcher] FATAL: electron.app is not available. This likely means');
  console.error('[launcher] the Electron process is not fully initialized.');
  console.error('[launcher] Make sure you are running this via the Electron binary,');
  console.error('[launcher] not via Node.js.');
  process.exit(1);
}

// Expose electron APIs globally so the ESM entry can access them
globalThis.__electron = electron;

// ── 1. Proxy — install EnvHttpProxyAgent BEFORE any fetch() happens ──────
const settingsPath = path.join(electron.app.getPath('userData'), 'settings.json');
let proxyUrl = 'http://127.0.0.1:7897'; // default Clash Verge
try {
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  if (settings.proxyUrl) proxyUrl = settings.proxyUrl;
} catch {}

process.env.HTTP_PROXY  = proxyUrl;
process.env.HTTPS_PROXY = proxyUrl;
process.env.NO_PROXY    = 'localhost,127.0.0.1,::1';

try {
  const undici = require('undici');
  if (undici.EnvHttpProxyAgent && undici.setGlobalDispatcher) {
    undici.setGlobalDispatcher(new undici.EnvHttpProxyAgent());
    console.log(`[launcher] EnvHttpProxyAgent installed (${proxyUrl})`);
  }
} catch(e) {
  console.warn('[launcher] Failed to install EnvHttpProxyAgent:', e.message);
}

// ── 2. Launch the actual application entry point ─────────────────────────
const appDir = electron.app.getAppPath();
const entry = path.join(appDir, 'dist-electron', 'main', 'index.js');

import(entry).catch(err => {
  console.error('[launcher] Failed to load main entry:', err);
  try {
    fs.appendFileSync(
      path.join(electron.app.getPath('userData'), 'cobalt-error.log'),
      `${new Date().toISOString()} — ${err.stack || err}\n`
    );
  } catch {}
  process.exit(1);
});
