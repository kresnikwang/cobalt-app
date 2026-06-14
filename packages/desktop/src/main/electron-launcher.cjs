/**
 * CJS launcher for Electron main process.
 *
 * WHY: Electron 31.3.0 uses Node.js v20.18.0 which has a regression where
 * `import { app } from 'electron'` fails with:
 *   TypeError: Cannot read properties of undefined (reading 'exports')
 *
 * This CJS file runs first, require()s the electron module (which works fine
 * from CJS context), sets up proxy/fetch globals, then dynamic-import()s
 * the ESM main process bundle.
 */

'use strict';

const path = require('path');
const fs = require('fs');

// ── Debug: inspect what require('electron') returns ──
let electron;
try {
  electron = require('electron');
  console.log('[launcher] typeof electron:', typeof electron);
  console.log('[launcher] electron keys:', Object.keys(electron).join(', '));
  console.log('[launcher] electron.app:', typeof electron.app);
  if (electron.app) {
    console.log('[launcher] electron.app is ready:', electron.app.isReady());
  }
} catch(e) {
  console.error('[launcher] require("electron") failed:', e.message);
}

// Expose electron APIs globally so the ESM entry can access them
globalThis.__electron = electron;

// ── 1. Proxy setup — must happen BEFORE any fetch() calls ────────────────
const proxyUrl = 'http://127.0.0.1:7897'; // default: Clash Verge mixed proxy

process.env.HTTP_PROXY  = proxyUrl;
process.env.HTTPS_PROXY = proxyUrl;
process.env.NO_PROXY    = 'localhost,127.0.0.1,::1';

try {
  const undici = require('undici');
  if (undici.EnvHttpProxyAgent && undici.setGlobalDispatcher) {
    undici.setGlobalDispatcher(new undici.EnvHttpProxyAgent());
    console.log(`[launcher] EnvHttpProxyAgent installed → ${proxyUrl}`);
  }
} catch (e) {
  console.warn('[launcher] Failed to install EnvHttpProxyAgent:', e.message);
}

// ── 2. Override globalThis.fetch with undici ─────────────────────────────
try {
  const undici = require('undici');
  globalThis.fetch = undici.fetch;
  globalThis.Headers = undici.Headers;
  globalThis.Request = undici.Request;
  globalThis.Response = undici.Response;
  console.log('[launcher] globalThis.fetch overridden with undici');
} catch (e) {
  console.warn('[launcher] Failed to override fetch:', e.message);
}

// ── 3. Load the ESM main process bundle ──────────────────────────────────
// Use __dirname to find the ESM entry relative to this CJS file
const mainEntry = path.join(__dirname, 'index.js');

import(mainEntry).catch(err => {
  console.error('[launcher] Failed to load main entry:', err);
  process.exit(1);
});
