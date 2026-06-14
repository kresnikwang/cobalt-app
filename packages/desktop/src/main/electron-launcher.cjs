/**
 * Thin CJS launcher for Electron main process.
 *
 * Electron's built-in `electron` module cannot be imported from ESM on
 * Node.js >= v20.18 due to a CJS-to-ESM interop regression.
 *
 * This file:
 *   1. require()s electron & stores APIs on globalThis.__electron
 *   2. Installs EnvHttpProxyAgent (reads proxyUrl from settings, falls back to
 *      http://127.0.0.1:7897 aka Clash Verge mixed port)
 *   3. dynamic-import()s the ESM application entry point
 */

'use strict';

const path = require('path');
const electron = require('electron');
const fs = require('fs');

// ---- expose Electron APIs for the ESM entry --------------------------------
globalThis.__electron = electron;

// ---- proxy setup -----------------------------------------------------------
// Hard-code the default proxy URL.  The settings file may not exist on first
// launch, so we use a try/catch.
const SETTINGS_FILE = path.join(
  electron.app.getPath('userData'),
  'settings.json'
);

let proxyUrl = 'http://127.0.0.1:7897';   // Clash Verge default
try {
  if (fs.existsSync(SETTINGS_FILE)) {
    const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    if (data.proxyUrl && typeof data.proxyUrl === 'string') {
      proxyUrl = data.proxyUrl;
    }
  }
} catch (_) { /* keep default */ }

process.env.HTTP_PROXY = proxyUrl;
process.env.HTTPS_PROXY = proxyUrl;
process.env.NO_PROXY = 'localhost,127.0.0.1,::1';

try {
  const undici = require('undici');
  if (typeof undici.EnvHttpProxyAgent === 'function' &&
      typeof undici.setGlobalDispatcher === 'function') {
    undici.setGlobalDispatcher(new undici.EnvHttpProxyAgent());
  }
} catch (e) {
  // undici may not be resolvable from the launcher's CJS scope inside asar.
  // The ESM entry (index.js) also sets up the proxy agent as a fallback.
}

// ---- launch ESM entry ------------------------------------------------------
const entry = path.join(electron.app.getAppPath(), 'dist-electron', 'main', 'index.js');

import(entry).catch((err) => {
  console.error('[launcher] failed to load ESM entry:', err);
  try {
    fs.appendFileSync(
      path.join(electron.app.getPath('userData'), 'cobalt-error.log'),
      `${new Date().toISOString()} — ${err && err.stack || err}\n`
    );
  } catch (_) {}
  electron.app.quit();
});
