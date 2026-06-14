// Electron APIs are exposed by CJS launcher (electron-launcher.cjs) as
// globalThis.__electron — avoids ESM/CJS interop regression on Node.js v20.18+
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = (globalThis as any).__electron;
import path from 'path';
import fs from 'fs';
import Module from 'module';

// Redirect isolated-vm and ffmpeg-static to app.asar.unpacked in production
const originalResolve = (Module as any)._resolveFilename;
try {
(Module as any)._resolveFilename = function (
  request: string,
  parent: any,
  isMain: boolean,
  options: any
) {
  if (request === 'isolated-vm' || request === 'ffmpeg-static') {
    const appPath = app.getAppPath();
    if (appPath.endsWith('app.asar')) {
      const entryFile = request === 'isolated-vm' ? 'isolated-vm.js' : 'index.js';
      const unpackedPath = path.join(
        appPath.replace('app.asar', 'app.asar.unpacked'),
        `node_modules/${request}/${entryFile}`
      );
      if (fs.existsSync(unpackedPath)) {
        return unpackedPath;
      }
    }
  }
  return originalResolve.call(this, request, parent, isMain, options);
};
} catch(e) {
  console.error('Failed to install Module._resolveFilename patch:', e);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
const COBALT_PORT = 47301;
const COBALT_URL = `http://127.0.0.1:${COBALT_PORT}`;

// -----------------------------------------------------------
// Settings
// -----------------------------------------------------------
interface Settings {
  savePath: string;
  downloadMode: 'video' | 'audio';
  videoQuality: string;
  audioFormat: string;
  clipboardMonitoring: boolean;
  maxParallelDownloads: number;
  proxyEnabled: boolean;
  proxyUrl: string;
}

const defaultSettings: Settings = {
  savePath: app.getPath('downloads'),
  downloadMode: 'video',
  videoQuality: '720',
  audioFormat: 'best',
  clipboardMonitoring: true,
  maxParallelDownloads: 3,
  proxyEnabled: true,
  proxyUrl: 'http://127.0.0.1:7897',
};

const settingsPath = path.join(app.getPath('userData'), 'settings.json');

function loadSettings(): Settings {
  try {
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf-8');
      return { ...defaultSettings, ...JSON.parse(data) };
    }
  } catch (e) {
    console.error('Failed to load settings', e);
  }
  return { ...defaultSettings };
}

function persistSettings(settings: Settings) {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to save settings', e);
  }
}

let currentSettings = loadSettings();

// -----------------------------------------------------------
// Download Task types
// -----------------------------------------------------------
interface DownloadTask {
  id: string;
  url: string;
  title: string;
  status: 'queued' | 'analyzing' | 'downloading' | 'merging' | 'completed' | 'failed' | 'cancelled';
  progress: number;       // 0–1
  speed: string;          // e.g. "4.5 MB/s"
  downloadedBytes: number;
  totalBytes: number;
  eta: string;
  error?: string;
  outputPath?: string;
}

const activeTasks   = new Map<string, DownloadTask>();
const abortControllers = new Map<string, AbortController>();

// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
function formatBytes(bytes: number, decimals = 2): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const dm = Math.max(0, decimals);
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Safely wait for WriteStream to finish
function streamClose(ws: fs.WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.on('finish', resolve);
    ws.on('error', reject);
    ws.end();
  });
}

function isYouTubeUrl(rawUrl: string): boolean {
  try {
    const { hostname } = new URL(rawUrl);
    return hostname === 'youtu.be' || hostname.endsWith('.youtube.com') || hostname === 'youtube.com';
  } catch {
    return false;
  }
}

async function requestCobalt(payload: Record<string, any>, signal: AbortSignal) {
  const apiRes = await fetch(COBALT_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });

  const result = await apiRes.json().catch(() => ({}));
  return { apiRes, result };
}

function getCobaltError(result: any, status: number): string {
  const errCode = result?.error?.code ?? '';
  const errText = result?.text ?? '';
  return errText || errCode || `HTTP ${status}`;
}

// -----------------------------------------------------------
// Start local Cobalt API server
// -----------------------------------------------------------
async function startCobaltServer() {
  console.log('Starting local Cobalt server in main process...');

  try {
    const undici = await import('undici');
    globalThis.fetch = undici.fetch as any;
    globalThis.Headers = undici.Headers as any;
    globalThis.Request = undici.Request as any;
    globalThis.Response = undici.Response as any;
    console.log('Successfully overrode globalThis.fetch with undici in Electron main process.');
  } catch (e) {
    console.warn('Failed to override globalThis.fetch with undici:', e);
  }

  process.env.API_URL = COBALT_URL;
  process.env.API_PORT = COBALT_PORT.toString();
  process.env.API_LISTEN_ADDRESS = '127.0.0.1';
  process.env.YOUTUBE_ALLOW_BETTER_AUDIO = '1';
  process.env.FORCE_LOCAL_PROCESSING = 'never';
  process.env.ENABLE_DEPRECATED_YOUTUBE_HLS = 'always';

  // ── Proxy configuration ──
  // Set HTTP_PROXY / HTTPS_PROXY so the Cobalt API (undici EnvHttpProxyAgent)
  // routes outbound requests through the user's local proxy (e.g. Clash Verge).
  // We also explicitly create an EnvHttpProxyAgent and set it as the global
  // dispatcher to ensure ALL undici requests go through the proxy.
  const proxyUrl = currentSettings.proxyUrl?.trim();
  if (currentSettings.proxyEnabled && proxyUrl) {
    process.env.HTTP_PROXY  = proxyUrl;
    process.env.HTTPS_PROXY = proxyUrl;
    // Don't proxy localhost connections (API server, tunnel, etc.)
    process.env.NO_PROXY = 'localhost,127.0.0.1,::1';
    console.log(`Proxy enabled: ${proxyUrl}`);

    // Explicitly install EnvHttpProxyAgent as the global dispatcher
    try {
      const undici = await import('undici');
      if (undici.EnvHttpProxyAgent && undici.setGlobalDispatcher) {
        const proxyAgent = new undici.EnvHttpProxyAgent();
        undici.setGlobalDispatcher(proxyAgent);
        console.log('EnvHttpProxyAgent set as global dispatcher for undici.');
      }
    } catch (e) {
      console.warn('Failed to set EnvHttpProxyAgent as global dispatcher:', e);
    }
  } else {
    // Clear proxy env vars if disabled
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.NO_PROXY;
    console.log('Proxy disabled — direct connections only.');
  }

  const appPath = app.getAppPath();
  if (app.isPackaged && appPath.endsWith('app.asar')) {
    const ffmpegPath = path.join(
      appPath.replace('app.asar', 'app.asar.unpacked'),
      'node_modules/ffmpeg-static/ffmpeg'
    );
    if (fs.existsSync(ffmpegPath)) {
      try {
        fs.chmodSync(ffmpegPath, 0o755);
        if (process.platform === 'darwin') {
          try {
            const { execSync } = await import('child_process');
            execSync(`xattr -d com.apple.quarantine "${ffmpegPath}"`, { stdio: 'ignore' });
            console.log('Successfully removed quarantine flag from ffmpeg.');
          } catch (e) {
            // Ignore error if flag was not present
          }
        }
      } catch (e) {
        console.warn('Failed to adjust permissions on ffmpeg (e.g. read-only volume):', e);
      }
      process.env.FFMPEG_PATH = ffmpegPath;
      console.log(`Setting FFMPEG_PATH to: ${ffmpegPath}`);
    } else {
      console.error(`FFmpeg binary not found at: ${ffmpegPath}`);
    }
  }

  try {
    // @ts-ignore
    await import('../../../../api/src/cobalt.js');
    console.log('Local Cobalt server started successfully in main process.');
  } catch (error) {
    console.error('Failed to start local Cobalt server in main process:', error);
    // Write error to userData (always writable in Electron)
    try {
      const errStr = `${new Date().toISOString()} — ${(error instanceof Error ? error.stack : String(error))}\n`;
      fs.appendFileSync(path.join(app.getPath('userData'), 'cobalt-error.log'), errStr);
    } catch (e2) {
      // Console is our only hope now
      console.error('Error logging failed:', e2);
    }
  }
}

// -----------------------------------------------------------
// Window
// -----------------------------------------------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 700,
    height: 780,
    minWidth: 520,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
    }
  });

  const isDev = !app.isPackaged;
  if (isDev) {
    // Try common vite dev ports in order
    const tryLoad = (ports: number[]) => {
      const port = ports.shift();
      if (!port) { console.error('Could not connect to Vite dev server'); return; }
      mainWindow!.loadURL(`http://localhost:${port}`).catch(() => tryLoad(ports));
    };
    tryLoad([5173, 5174, 5175, 5176, 5177]);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

// -----------------------------------------------------------
// Clipboard Monitor
// -----------------------------------------------------------
let lastClipboardText = '';
function setupClipboardMonitor() {
  setInterval(() => {
    if (!currentSettings.clipboardMonitoring || !mainWindow) return;
    try {
      const text = clipboard.readText().trim();
      if (!text || text === lastClipboardText) return;
      if (/^https?:\/\//i.test(text)) {
        lastClipboardText = text;
        mainWindow.webContents.send('clipboard-detected', text);
      }
    } catch (e) {
      console.error('Clipboard error:', e);
    }
  }, 1200);
}

// -----------------------------------------------------------
// App lifecycle (with single instance lock)
// -----------------------------------------------------------
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Focus the existing window if user tries to open another instance
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    startCobaltServer();
    createWindow();
    setupClipboardMonitor();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  // Local server running in main process will naturally exit when app quits
});

// -----------------------------------------------------------
// IPC handlers
// -----------------------------------------------------------
ipcMain.handle('get-settings', () => currentSettings);

ipcMain.handle('save-settings', (_e, newSettings: Partial<Settings>) => {
  currentSettings = { ...currentSettings, ...newSettings };
  persistSettings(currentSettings);
  return currentSettings;
});

ipcMain.handle('restart-app', () => {
  app.relaunch();
  app.exit(0);
});

ipcMain.handle('select-directory', async () => {
  if (!mainWindow) return null;
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return canceled ? null : filePaths[0];
});

ipcMain.handle('reveal-in-finder', (_e, filePath: string) => {
  if (filePath && fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
    return true;
  }
  return false;
});

ipcMain.handle('open-file', (_e, filePath: string) => {
  if (filePath && fs.existsSync(filePath)) {
    shell.openPath(filePath);
    return true;
  }
  return false;
});

ipcMain.handle('get-tasks', () => Array.from(activeTasks.values()));

ipcMain.handle('cancel-task', (_e, taskId: string) => {
  const task = activeTasks.get(taskId);
  if (!task) return false;

  if (['downloading', 'analyzing', 'queued'].includes(task.status)) {
    abortControllers.get(taskId)?.abort();
    task.status    = 'cancelled';
    task.speed     = '0 B/s';
    task.progress  = 0;
    task.eta       = '--:--';

    // Try to delete partially-written file
    if (task.outputPath && fs.existsSync(task.outputPath)) {
      try { fs.unlinkSync(task.outputPath); } catch {}
    }
    notifyTaskUpdate(task);
    processQueue();
    return true;
  }
  return false;
});

ipcMain.handle('delete-task', (_e, taskId: string) => {
  const task = activeTasks.get(taskId);
  if (!task) return false;

  if (['downloading', 'analyzing', 'queued'].includes(task.status)) {
    abortControllers.get(taskId)?.abort();
  }
  activeTasks.delete(taskId);
  abortControllers.delete(taskId);
  processQueue();
  return true;
});

ipcMain.handle('clear-completed', () => {
  for (const [id, task] of activeTasks) {
    if (['completed', 'cancelled', 'failed'].includes(task.status)) {
      activeTasks.delete(id);
      abortControllers.delete(id);
    }
  }
  return Array.from(activeTasks.values());
});

ipcMain.handle('download-url', (_e, { url, options }: { url: string; options?: Partial<Settings> }) => {
  const id = Math.random().toString(36).substring(2, 9);
  const taskSettings: Settings = { ...currentSettings, ...options };

  const task: DownloadTask = {
    id,
    url,
    title: url,
    status: 'queued', // Queue the download
    progress: 0,
    speed: '0 B/s',
    downloadedBytes: 0,
    totalBytes: 0,
    eta: '--:--',
  };

  activeTasks.set(id, task);
  notifyTaskUpdate(task);
  processQueue(); // Start the queue processor
  return task;
});

// -----------------------------------------------------------
// Notify renderer
// -----------------------------------------------------------
function notifyTaskUpdate(task: DownloadTask) {
  mainWindow?.webContents.send('task-updated', { ...task });
}

// -----------------------------------------------------------
// Parallel Download Queue Scheduler
// -----------------------------------------------------------
function processQueue() {
  const runningStatuses = ['analyzing', 'downloading', 'merging'];
  const runningCount = Array.from(activeTasks.values()).filter(t => runningStatuses.includes(t.status)).length;
  
  const limit = currentSettings.maxParallelDownloads || 3;
  if (runningCount >= limit) {
    return; // Limit reached, wait for slots
  }

  // Find next in queue
  const nextTask = Array.from(activeTasks.values()).find(t => t.status === 'queued');
  if (nextTask) {
    nextTask.status = 'analyzing';
    notifyTaskUpdate(nextTask);

    runDownloadTask(nextTask, currentSettings).catch(() => {});
    
    // Check if another slot is free
    processQueue();
  }
}

// -----------------------------------------------------------
// Core download logic
// -----------------------------------------------------------
async function runDownloadTask(task: DownloadTask, settings: Settings) {
  const controller = new AbortController();
  abortControllers.set(task.id, controller);
  let fileStream: fs.WriteStream | null = null;

  try {
    // ── 1. Query Cobalt API ────────────────────────────────
    const cobaltPayload = {
      url: task.url,
      videoQuality: settings.videoQuality,
      downloadMode: settings.downloadMode === 'video' ? 'auto' : 'audio',
      audioFormat: settings.audioFormat,
      filenameStyle: 'pretty',
      youtubeVideoCodec: 'h264',
      youtubeHLS: true,
      youtubeBetterAudio: true,
    };

    let { apiRes, result } = await requestCobalt(cobaltPayload, controller.signal);

    if ((!apiRes.ok || result.status === 'error') && isYouTubeUrl(task.url) && cobaltPayload.youtubeHLS) {
      const hlsError = getCobaltError(result, apiRes.status);
      console.warn(`YouTube HLS request failed (${hlsError}); retrying without HLS using WEB_EMBEDDED client.`);

      const fallbackPayload = {
        ...cobaltPayload,
        youtubeHLS: false,
        innertubeClient: 'WEB_EMBEDDED',
      };
      ({ apiRes, result } = await requestCobalt(fallbackPayload, controller.signal));

      if (!apiRes.ok || result.status === 'error') {
        const fallbackError = getCobaltError(result, apiRes.status);
        console.warn(`YouTube non-HLS fallback failed (${fallbackError}).`);
      }
    }

    if (!apiRes.ok || result.status === 'error') {
      // Bug fix #6: proper error path from Cobalt schema
      throw new Error(getCobaltError(result, apiRes.status));
    }

    // ── 2. Resolve download URL + filename ────────────────
    let downloadUrl = '';
    let filename    = result.filename || `cobalt_${task.id}`;

    if (result.status === 'redirect' || result.status === 'tunnel') {
      downloadUrl = result.url;
      if (!result.url.startsWith('http')) {
        downloadUrl = `${COBALT_URL}${result.url}`;
      }
    } else if (result.status === 'picker') {
      const items = result.picker ?? [];
      if (items.length === 0) throw new Error('Picker response returned no items');
      // Pick the first video/photo item; prefer "video" type
      const chosen = items.find((i: any) => i.type === 'video') ?? items[0];
      downloadUrl  = chosen.url;
      // use ext from url if we have no proper filename
      if (!result.filename) {
        const ext = chosen.type === 'photo' ? 'jpg' : 'mp4';
        filename  = `cobalt_${task.id}.${ext}`;
      }
    } else {
      throw new Error(`Unsupported Cobalt response status: ${result.status}`);
    }

    // Update title to resolved filename (before downloading)
    task.title = filename;
    notifyTaskUpdate(task);

    // Ensure save directory exists
    if (!fs.existsSync(settings.savePath)) {
      fs.mkdirSync(settings.savePath, { recursive: true });
    }

    // Avoid overwriting existing files: add numeric suffix
    // Sanitize filename to prevent path traversal (strip any directory components)
    const safeFilename = path.basename(filename);
    let outputPath  = path.join(settings.savePath, safeFilename);
    const ext       = path.extname(safeFilename);
    const base      = path.basename(safeFilename, ext);
    let   dupIndex  = 1;
    while (fs.existsSync(outputPath)) {
      outputPath = path.join(settings.savePath, `${base} (${dupIndex++})${ext}`);
    }

    task.outputPath = outputPath;
    task.status     = 'downloading';
    notifyTaskUpdate(task);

    // ── 3. Stream download to disk ────────────────────────
    const dlRes = await fetch(downloadUrl, { signal: controller.signal });

    if (!dlRes.ok) {
      throw new Error(`Media server error: ${dlRes.status} ${dlRes.statusText}`);
    }

    const totalBytes = parseInt(
      dlRes.headers.get('content-length') ??
      dlRes.headers.get('estimated-content-length') ?? '0',
      10
    );
    task.totalBytes = totalBytes;

    fileStream = fs.createWriteStream(outputPath);

    // Bug fix #4: propagate file-write errors
    fileStream.on('error', (err) => {
      controller.abort();
      task.status = 'failed';
      task.error  = `Disk write error: ${err.message}`;
      notifyTaskUpdate(task);
    });

    const reader = dlRes.body?.getReader();
    if (!reader) throw new Error('Response body is not readable');

    let downloadedBytes = 0;
    let lastSpeedTime   = Date.now();
    let lastSpeedBytes  = 0;
    let lastUiUpdate    = Date.now();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      fileStream.write(Buffer.from(value));
      downloadedBytes         += value.length;
      task.downloadedBytes     = downloadedBytes;

      // Progress
      if (totalBytes > 0) {
        task.progress = Math.min(downloadedBytes / totalBytes, 0.99);
      }
      // Bug fix #5: for unknown size, use indeterminate (keep at 0 → CSS animation)

      const now      = Date.now();
      const timeDiff = now - lastSpeedTime;
      if (timeDiff >= 1000) {
        const speedBps = ((downloadedBytes - lastSpeedBytes) / timeDiff) * 1000;
        task.speed     = `${formatBytes(speedBps)}/s`;
        if (totalBytes > 0 && speedBps > 0) {
          const etaSecs = Math.round((totalBytes - downloadedBytes) / speedBps);
          task.eta = `${Math.floor(etaSecs / 60)}:${String(etaSecs % 60).padStart(2, '0')}`;
        } else {
          task.eta = '--:--';
        }
        lastSpeedTime  = now;
        lastSpeedBytes = downloadedBytes;
      }

      if (now - lastUiUpdate >= 120) {
        notifyTaskUpdate(task);
        lastUiUpdate = now;
      }
    }

    // Bug fix #3: wait for file to fully flush to disk before marking complete
    await streamClose(fileStream);
    fileStream = null;

    if (downloadedBytes === 0) {
      throw new Error('No data received from media server (0-byte file)');
    }

    task.status          = 'completed';
    task.progress        = 1.0;
    task.downloadedBytes = downloadedBytes;
    task.speed           = '0 B/s';
    task.eta             = 'Done';
    notifyTaskUpdate(task);
    console.log(`✅ Download complete: ${outputPath}`);

  } catch (err: any) {
    if (err?.name === 'AbortError') {
      console.log(`Task ${task.id} aborted.`);
      // Status already set to 'cancelled' by cancel-task handler, don't overwrite
    } else {
      console.error(`Download failed [${task.id}]:`, err);
      if (task.status !== 'cancelled') {
        task.status = 'failed';
        task.error  = err?.message || 'Unknown error';
        notifyTaskUpdate(task);
      }
    }

    // Cleanup partial file on failure
    if (task.outputPath && task.status !== 'completed') {
      try {
        if (fileStream) { fileStream.destroy(); fileStream = null; }
        if (fs.existsSync(task.outputPath)) fs.unlinkSync(task.outputPath);
      } catch {}
    }
  } finally {
    abortControllers.delete(task.id);
    processQueue(); // Always prompt the queue to run next items
  }
}
