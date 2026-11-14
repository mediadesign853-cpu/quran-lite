// Desktop shell (Electron). The web app (electron/dist, made by `npm run prepare:electron`) is served
// through the private address app://quran/, so it runs from files, without a server and without internet.
const { app, BrowserWindow, Menu, shell, protocol, ipcMain, clipboard, session } = require('electron');
const { isInternalAppUrl, allowPermissionRequest, allowPermissionCheck } = require('./security.cjs');
const { createAppProtocolHandler, createPageProtocolHandler } = require('./protocol-handlers.cjs');

// Only the primary process may initialize storage, protocols, windows, or IPC.
// Returning here is important: app.quit() alone does not stop module execution.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const crypto = require('crypto');
const { startAutoUpdates } = require('./auto-updater.bundle.cjs');

// electron-builder's portable target sets PORTABLE_EXECUTABLE_DIR. Keep localStorage,
// bookmarks, history and settings beside the portable EXE; installed builds use normal userData.
if (process.env.PORTABLE_EXECUTABLE_DIR) {
  const portableData = path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'Quran Reader Lite Data');
  const portableSession = path.join(portableData, 'Session');
  fs.mkdirSync(portableSession, { recursive: true });
  app.setPath('userData', portableData);
  app.setPath('sessionData', portableSession);
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: 'qpage', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);


// The web app: next to this file, both when running from the project and inside the installed app.asar.
const ROOT = path.resolve(__dirname, 'dist');
// Page images (1.webp ... 604.webp and boxes.json): in the project folder electron/pages while developing,
// and in the "pages" folder next to the app files once installed (electron-builder "extraResources").
const PAGES_DIR = app.isPackaged ? path.join(process.resourcesPath, 'pages') : path.join(__dirname, 'pages');
const FOOTNOTE_SCRIPT = app.isPackaged
  ? path.join(process.resourcesPath, 'integrations', 'insert-footnote.ps1')
  : path.join(__dirname, 'integrations', 'insert-footnote.ps1');

const FOOTNOTE_TIMEOUT_MS = 90_000;

function getWindowsPowerShellPath() {
  const windowsRoot = process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows';
  const candidates = [
    path.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    path.join(windowsRoot, 'Sysnative', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || 'powershell.exe';
}

function writeFootnoteLog(level, details) {
  try {
    const logDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(
      path.join(logDir, 'footnote-integration.log'),
      `${new Date().toISOString()} [${level}] ${JSON.stringify(details)}\r\n`,
      'utf8'
    );
  } catch {
    // Logging must never block copying or inserting a footnote.
  }
}

/** Insert an ayah and its address as a native Word/InDesign footnote (Windows desktop only). */
async function insertNativeFootnote(target, payload) {
  if (process.platform !== 'win32') {
    return Promise.resolve({ ok: false, message: 'درج خودکار پاورقی فقط در نسخه دسکتاپ ویندوز پشتیبانی می‌شود.' });
  }

  if (!fs.existsSync(FOOTNOTE_SCRIPT)) {
    writeFootnoteLog('error', { target, reason: 'script-not-found', script: FOOTNOTE_SCRIPT, resourcesPath: process.resourcesPath });
    return Promise.resolve({ ok: false, message: 'فایل داخلی درج پاورقی در بسته برنامه پیدا نشد. احتمالاً فایل Portable ناقص ساخته شده است.' });
  }

  const fallbackText = payload.reference ? `${payload.text} ${payload.reference}` : payload.text;
  try {
    await clipboard.writeText(fallbackText);
  } catch (error) {
    // Native footnote insertion can still succeed even if the clipboard is unavailable.
    writeFootnoteLog('warning', {
      target,
      reason: 'clipboard-write-failed',
      message: error?.message || String(error),
    });
  }

  let payloadPath;
  try {
    payloadPath = path.join(app.getPath('temp'), `quran-footnote-${process.pid}-${crypto.randomUUID()}.json`);
    fs.writeFileSync(payloadPath, JSON.stringify(payload), 'utf8');
  } catch (error) {
    writeFootnoteLog('error', { target, reason: 'payload-write-failed', message: error?.message || String(error) });
    return Promise.resolve({ ok: false, message: 'فایل موقت پاورقی ساخته نشد. فضای دیسک و مجوز پوشه Temp ویندوز را بررسی کنید.' });
  }

  const powershellPath = getWindowsPowerShellPath();
  const childEnv = { ...process.env };
  // Do not pass Windows compatibility shims to the Office COM automation process.
  delete childEnv.__COMPAT_LAYER;

  writeFootnoteLog('info', {
    target,
    script: FOOTNOTE_SCRIPT,
    scriptExists: true,
    powershell: powershellPath,
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    timeoutMs: FOOTNOTE_TIMEOUT_MS,
  });

  return new Promise((resolve) => {
    execFile(
      powershellPath,
      ['-NoLogo', '-NoProfile', '-STA', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', FOOTNOTE_SCRIPT, '-Target', target, '-PayloadPath', payloadPath],
      { windowsHide: true, timeout: FOOTNOTE_TIMEOUT_MS, maxBuffer: 1024 * 1024, encoding: 'utf8', env: childEnv },
      (error, stdout, stderr) => {
        try { fs.rmSync(payloadPath, { force: true }); } catch { /* best-effort cleanup */ }

        const resultLine = String(stdout || '').split(/\r?\n/u).find((line) => line.startsWith('QURAN_RESULT:'));
        if (resultLine) {
          try {
            const result = JSON.parse(resultLine.slice('QURAN_RESULT:'.length));
            writeFootnoteLog(result.ok ? 'success' : 'warning', {
              target,
              message: result.message,
              processError: error?.message || null,
              stderr: String(stderr || '').trim().slice(0, 4000),
            });
            resolve(result);
            return;
          } catch (parseError) {
            writeFootnoteLog('error', { target, reason: 'invalid-result-json', message: parseError?.message || String(parseError) });
          }
        }

        const details = String(stderr || '').trim();
        const stdoutText = String(stdout || '').trim();
        const timedOut = error?.killed || error?.code === 'ETIMEDOUT';
        const message = timedOut
          ? 'اجرای ارتباط با Word یا InDesign بیش از ۹۰ ثانیه طول کشید. مطمئن شوید برنامه مقصد باز و آماده است.'
          : error?.code === 'ENOENT'
            ? 'Windows PowerShell در ویندوز پیدا نشد؛ قابلیت پاورقی به Windows PowerShell 5.1 نیاز دارد.'
            : details || stdoutText || error?.message || 'درج پاورقی انجام نشد.';

        writeFootnoteLog('error', {
          target,
          reason: 'powershell-process-failed',
          code: error?.code || null,
          message: error?.message || null,
          stderr: details.slice(0, 4000),
          stdout: stdoutText.slice(0, 4000),
        });
        resolve({ ok: false, message });
      }
    );
  });
}

/** True only when page images really exist, so the app shows the page button's feature only then. */
function pageImagesExist() {
  try {
    const names = new Set(fs.readdirSync(PAGES_DIR));
    if (!names.has('boxes.json')) return false;
    for (let page = 1; page <= 604; page += 1) {
      if (!names.has(`${page}.webp`)) return false;
    }
    return true;
  } catch {
    return false; // no complete pages folder: the app works without the page-image feature
  }
}


let win;
let secondInstancePendingFocus = false;

function focusMainWindow() {
  if (!win || win.isDestroyed()) {
    secondInstancePendingFocus = true;
    return;
  }
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}

// Register before app.whenReady so a second launch during startup is not lost.
app.on('second-instance', focusMainWindow);

function isTrustedRenderer(event) {
  if (!win || win.isDestroyed()) return false;

  const frame = event.senderFrame;
  if (
    event.sender !== win.webContents ||
    !frame ||
    frame !== win.webContents.mainFrame
  ) {
    return false;
  }

  try {
    const url = new URL(frame.url);
    return (
      url.protocol === 'app:' &&
      url.hostname === 'quran' &&
      !url.username &&
      !url.password &&
      !url.port
    );
  } catch {
    return false;
  }
}

function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 520,
    minHeight: 400,
    backgroundColor: '#f8f6f1',
    title: 'القرآن الكريم',
    icon: path.join(ROOT, 'icons', 'icon-512.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.loadURL('app://quran/index.html');
  if (secondInstancePendingFocus) {
    secondInstancePendingFocus = false;
    focusMainWindow();
  }

  // Electron has no right-click menu of its own: give text fields Cut / Copy / Paste.
  win.webContents.on('context-menu', (_event, params) => {
    if (!params.isEditable) return;
    Menu.buildFromTemplate([
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' }, { role: 'selectAll' },
    ]).popup({ window: win });
  });

  // links open in the normal browser, never inside the app
  const openExternalHttp = (url) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') shell.openExternal(url);
    } catch {
      // Ignore malformed and non-web external URLs.
    }
  };
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalHttp(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isInternalAppUrl(url)) {
      event.preventDefault();
      openExternalHttp(url);
    }
  });

  // Ctrl + / Ctrl - / Ctrl 0: zoom the whole app
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type !== 'keyDown' || !input.control || input.shift) return;
    const wc = win.webContents;
    if (input.key === '=' || input.key === '+') wc.setZoomLevel(wc.getZoomLevel() + 0.5);
    else if (input.key === '-') wc.setZoomLevel(wc.getZoomLevel() - 0.5);
    else if (input.key === '0') wc.setZoomLevel(0);
  });
}

app.whenReady().then(() => {
  // Deny every browser/device permission by default. The only exception is the
  // clipboard write required by the trusted, top-level app://quran renderer.
  // Electron needs both handlers for complete permission enforcement.
  const appSession = session.defaultSession;
  appSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(allowPermissionRequest({
      webContents,
      mainWebContents: win?.webContents,
      permission,
      details,
    }));
  });
  appSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) =>
    allowPermissionCheck({
      webContents,
      mainWebContents: win?.webContents,
      permission,
      requestingOrigin,
      details,
    })
  );
  appSession.setDevicePermissionHandler(() => false);

  ipcMain.on('pages:available', (event) => {
    if (!isTrustedRenderer(event)) {
      event.returnValue = false;
      return;
    }
    event.returnValue = pageImagesExist();
  });

  ipcMain.handle('footnote:insert', async (event, payload) => {
    if (!isTrustedRenderer(event)) {
      return { ok: false, message: 'درخواست نامعتبر است' };
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, message: 'اطلاعات درج پاورقی معتبر نیست' };
    }

    const target = payload.target;
    const text = typeof payload.text === 'string' ? payload.text : '';
    const reference = typeof payload.reference === 'string' ? payload.reference : '';
    if (
      !['word', 'indesign'].includes(target) ||
      !text.trim() ||
      !reference.trim() ||
      text.length > 100000 ||
      reference.length > 2000
    ) {
      return { ok: false, message: 'متن آیه یا نشانی آن معتبر نیست' };
    }

    return insertNativeFootnote(target, { text, reference });
  });


  protocol.handle('app', createAppProtocolHandler({ root: ROOT }));

  // qpage://pages/<n> serves one of the 604 page images; boxes.json supplies highlight rectangles.
  protocol.handle('qpage', createPageProtocolHandler({ pagesDir: PAGES_DIR }));

  createWindow();
  startAutoUpdates(() => win);

  // Keep the old Portable executable until the new application has loaded successfully.
  if (process.env.PORTABLE_EXECUTABLE_FILE) {
    const previousExecutable = `${path.resolve(process.env.PORTABLE_EXECUTABLE_FILE)}.previous`;

    win.webContents.once('did-finish-load', () => {
      const cleanupTimer = setTimeout(() => {
        try {
          fs.rmSync(previousExecutable, { force: true });
        } catch (error) {
          writeFootnoteLog('warning', {
            reason: 'portable-update-backup-cleanup-failed',
            message: error?.message || String(error),
          });
        }
      }, 120_000);
      cleanupTimer.unref?.();
    });
  }
});

app.on('window-all-closed', () => app.quit());
