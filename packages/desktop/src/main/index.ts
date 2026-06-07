import { app, BrowserWindow, ipcMain, dialog, shell, clipboard } from 'electron';
import { fork, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let cobaltProcess: ChildProcess | null = null;
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
}

const defaultSettings: Settings = {
  savePath: app.getPath('downloads'),
  downloadMode: 'video',
  videoQuality: '1080',
  audioFormat: 'best',
  clipboardMonitoring: true,
  maxParallelDownloads: 3
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

// -----------------------------------------------------------
// Start local Cobalt API server
// -----------------------------------------------------------
function startCobaltServer() {
  const isDev = !app.isPackaged;
  const apiPath = isDev
    ? path.resolve(app.getAppPath(), '../../api/src/cobalt.js')
    : path.resolve(process.resourcesPath, 'api/src/cobalt.js');

  console.log(`Starting local Cobalt server from: ${apiPath}`);

  if (!fs.existsSync(apiPath)) {
    console.error(`Cobalt API not found at: ${apiPath}`);
    return;
  }

  cobaltProcess = fork(apiPath, [], {
    execPath: isDev ? 'node' : undefined,
    env: {
      ...process.env,
      API_URL: COBALT_URL,
      API_PORT: COBALT_PORT.toString(),
      API_LISTEN_ADDRESS: '127.0.0.1',
      YOUTUBE_ALLOW_BETTER_AUDIO: '1',
      FORCE_LOCAL_PROCESSING: 'never',
      ENABLE_DEPRECATED_YOUTUBE_HLS: 'never',
    },
    stdio: 'pipe'
  });

  cobaltProcess.stdout?.on('data', (d) => console.log(`[Cobalt]: ${d.toString().trim()}`));
  cobaltProcess.stderr?.on('data', (d) => console.error(`[Cobalt Error]: ${d.toString().trim()}`));
  cobaltProcess.on('close',  (code) => console.log(`Cobalt exited with code ${code}`));
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
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
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
// App lifecycle
// -----------------------------------------------------------
app.whenReady().then(() => {
  startCobaltServer();
  createWindow();
  setupClipboardMonitor();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  cobaltProcess?.kill();
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
    title: url,            // will be replaced by the actual filename once API responds
    status: 'analyzing',
    progress: 0,
    speed: '0 B/s',
    downloadedBytes: 0,
    totalBytes: 0,
    eta: '--:--',
  };

  activeTasks.set(id, task);
  notifyTaskUpdate(task);
  runDownloadTask(task, taskSettings); // intentionally fire-and-forget
  return task;
});

// -----------------------------------------------------------
// Notify renderer
// -----------------------------------------------------------
function notifyTaskUpdate(task: DownloadTask) {
  mainWindow?.webContents.send('task-updated', { ...task });
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
      downloadMode: settings.downloadMode,
      audioFormat: settings.audioFormat,
      filenameStyle: 'pretty',
      youtubeVideoCodec: 'h264',
      youtubeBetterAudio: true,
    };

    const apiRes = await fetch(COBALT_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(cobaltPayload),
      signal: controller.signal,
    });

    // Parse response body regardless of status
    const result = await apiRes.json().catch(() => ({}));

    if (!apiRes.ok || result.status === 'error') {
      // Bug fix #6: proper error path from Cobalt schema
      const errCode  = result?.error?.code  ?? '';
      const errText  = result?.text         ?? '';
      throw new Error(errText || errCode || `HTTP ${apiRes.status}`);
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
    let outputPath  = path.join(settings.savePath, filename);
    const ext       = path.extname(filename);
    const base      = path.basename(filename, ext);
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
  }
}
