'use strict';

const {
  app,
  dialog,
  Notification,
} = require('electron');
const { autoUpdater } = require('electron-updater');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const FIRST_CHECK_DELAY_MS = 15_000;
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
const MANIFEST_TIMEOUT_MS = 25_000;
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_PORTABLE_SIZE = 1024 * 1024 * 1024;

const GITHUB_OWNER = 'mediadesign853-cpu';
const GITHUB_REPO = 'quran-lite';
const GITHUB_BASE = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`;
const PORTABLE_MANIFEST_URL = `${GITHUB_BASE}/releases/latest/download/latest-portable.json`;
const EXPECTED_APP_ID = 'com.quranreader.lite';
const EXPECTED_PRODUCT_NAME = 'Quran Reader Lite';

let updaterStarted = false;

function updaterLog(level, message, details = undefined) {
  try {
    const directory = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(directory, { recursive: true });
    const suffix = details ? ` ${JSON.stringify(details)}` : '';
    fs.appendFileSync(
      path.join(directory, 'updater.log'),
      `${new Date().toISOString()} [${level}] ${message}${suffix}\r\n`,
      'utf8'
    );
  } catch {
    // Logging must never prevent normal app use.
  }
}

function getMainWindow(getWindow) {
  const window = typeof getWindow === 'function' ? getWindow() : null;
  return window && !window.isDestroyed() ? window : null;
}

function showMessage(getWindow, options) {
  const window = getMainWindow(getWindow);
  return window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options);
}

function notify(title, body) {
  try {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
    }
  } catch {
    // Notifications are optional.
  }
}

function compareStableVersions(left, right) {
  const parse = (value) => {
    if (typeof value !== 'string' || !/^\d+\.\d+\.\d+$/.test(value)) return null;
    return value.split('.').map((part) => Number.parseInt(part, 10));
  };
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] > b[index]) return 1;
    if (a[index] < b[index]) return -1;
  }
  return 0;
}

function getWindowsPowerShellPath() {
  const windowsRoot = process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows';
  const candidates = [
    path.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    path.join(windowsRoot, 'Sysnative', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || 'powershell.exe';
}

function getPortableExecutablePath() {
  const rawPath = process.env.PORTABLE_EXECUTABLE_FILE;
  if (!rawPath) return null;
  const executablePath = path.resolve(rawPath);
  if (path.extname(executablePath).toLowerCase() !== '.exe') return null;
  return executablePath;
}

async function fetchText(url, timeoutMs) {
  const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`, {
    method: 'GET',
    redirect: 'follow',
    cache: 'no-store',
    headers: {
      Accept: 'application/octet-stream, application/json, text/plain;q=0.9, */*;q=0.8',
      'Cache-Control': 'no-cache, no-store',
      Pragma: 'no-cache',
      'User-Agent': 'Quran-Reader-Lite-Updater',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} while requesting update metadata`);
  return response.text();
}

function validatePortableManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Update manifest is not a JSON object.');
  }
  if (manifest.schemaVersion !== 1) throw new Error('Unsupported portable update manifest schema.');
  if (manifest.appId !== EXPECTED_APP_ID) throw new Error('Update manifest belongs to another application.');
  if (manifest.productName !== EXPECTED_PRODUCT_NAME) throw new Error('Unexpected product name in update manifest.');
  if (manifest.platform !== 'win32' || manifest.arch !== 'x64') {
    throw new Error('This portable update is not a Windows x64 build.');
  }
  if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    throw new Error('Invalid version in portable update manifest.');
  }
  if (manifest.tag !== `v${manifest.version}`) throw new Error('Release tag and version do not match.');
  if (
    typeof manifest.fileName !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9 ._-]*\.exe$/i.test(manifest.fileName) ||
    path.basename(manifest.fileName) !== manifest.fileName
  ) {
    throw new Error('Invalid portable executable file name.');
  }
  if (!Number.isSafeInteger(manifest.size) || manifest.size < 1_000_000 || manifest.size > MAX_PORTABLE_SIZE) {
    throw new Error('Invalid portable update file size.');
  }
  if (typeof manifest.sha512 !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(manifest.sha512)) {
    throw new Error('Invalid SHA-512 value in portable update manifest.');
  }

  const expectedDownloadUrl = `${GITHUB_BASE}/releases/download/${manifest.tag}/${encodeURIComponent(manifest.fileName)}`;
  if (manifest.downloadUrl !== expectedDownloadUrl) {
    throw new Error('Portable update URL does not match the configured GitHub repository.');
  }
}

async function getVerifiedPortableManifest() {
  const publicKeyPath = path.join(__dirname, 'portable-update-public.pem');
  if (!fs.existsSync(publicKeyPath)) {
    throw new Error('Portable update public key is missing from the application package.');
  }

  const envelopeText = await fetchText(PORTABLE_MANIFEST_URL, MANIFEST_TIMEOUT_MS);
  let envelope;
  try {
    envelope = JSON.parse(envelopeText);
  } catch {
    throw new Error('Portable update envelope contains invalid JSON.');
  }

  if (
    !envelope ||
    typeof envelope !== 'object' ||
    typeof envelope.signedPayload !== 'string' ||
    typeof envelope.signature !== 'string'
  ) {
    throw new Error('Portable update signature envelope is invalid.');
  }

  const payloadBytes = Buffer.from(envelope.signedPayload, 'base64');
  const signature = Buffer.from(envelope.signature, 'base64');
  if (
    payloadBytes.length === 0 ||
    payloadBytes.toString('base64') !== envelope.signedPayload ||
    signature.length !== 64 ||
    signature.toString('base64') !== envelope.signature
  ) {
    throw new Error('Portable update signature encoding is invalid.');
  }

  const publicKey = crypto.createPublicKey(fs.readFileSync(publicKeyPath, 'utf8'));
  const signatureIsValid = crypto.verify(null, payloadBytes, publicKey, signature);
  if (!signatureIsValid) throw new Error('Portable update manifest signature is invalid.');

  let manifest;
  try {
    manifest = JSON.parse(payloadBytes.toString('utf8'));
  } catch {
    throw new Error('Signed portable update manifest contains invalid JSON.');
  }

  validatePortableManifest(manifest);
  return manifest;
}

function assertPortableDirectoryWritable(executablePath) {
  const directory = path.dirname(executablePath);
  const probe = path.join(directory, `.quran-update-write-test-${process.pid}-${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(probe, 'write-test', { flag: 'wx' });
    fs.rmSync(probe, { force: true });
  } catch (error) {
    try { fs.rmSync(probe, { force: true }); } catch { /* best effort */ }
    throw new Error(`The portable folder is not writable: ${error?.message || String(error)}`, { cause: error });
  }
}

async function downloadAndVerifyPortable(manifest) {
  const response = await fetch(manifest.downloadUrl, {
    method: 'GET',
    redirect: 'follow',
    cache: 'no-store',
    headers: {
      Accept: 'application/octet-stream',
      'Cache-Control': 'no-cache, no-store',
      'User-Agent': 'Quran-Reader-Lite-Updater',
    },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Portable update download failed: HTTP ${response.status}.`);
  }

  const contentLength = Number.parseInt(response.headers.get('content-length') || '0', 10);
  if (contentLength > 0 && contentLength !== manifest.size) {
    throw new Error('The downloaded file size does not match the signed manifest.');
  }

  const temporaryPath = path.join(
    app.getPath('temp'),
    `quran-reader-lite-portable-${manifest.version}-${process.pid}-${crypto.randomUUID()}.exe`
  );
  const hash = crypto.createHash('sha512');
  let downloadedBytes = 0;
  const hashTransform = new Transform({
    transform(chunk, _encoding, callback) {
      downloadedBytes += chunk.length;
      if (downloadedBytes > manifest.size || downloadedBytes > MAX_PORTABLE_SIZE) {
        callback(new Error('Portable update exceeded the expected file size.'));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(response.body),
      hashTransform,
      fs.createWriteStream(temporaryPath, { flags: 'wx' })
    );

    const actualSha512 = hash.digest('base64');
    if (downloadedBytes !== manifest.size || actualSha512 !== manifest.sha512) {
      throw new Error('Portable update SHA-512 or file size verification failed.');
    }
    return temporaryPath;
  } catch (error) {
    try { fs.rmSync(temporaryPath, { force: true }); } catch { /* best effort */ }
    throw error;
  }
}

function launchPortableReplacement(executablePath, downloadedPath, manifest) {
  const helperPath = path.join(process.resourcesPath, 'portable-update-helper.ps1');
  if (!fs.existsSync(helperPath)) {
    throw new Error('Portable update helper is missing from the application package.');
  }

  const jobPath = path.join(
    app.getPath('temp'),
    `quran-portable-update-${process.pid}-${crypto.randomUUID()}.json`
  );
  const job = {
    parentPid: process.pid,
    sourcePath: downloadedPath,
    targetPath: executablePath,
    expectedSha512: manifest.sha512,
    version: manifest.version,
  };
  fs.writeFileSync(jobPath, JSON.stringify(job), { encoding: 'utf8', flag: 'wx' });

  return new Promise((resolve, reject) => {
    const child = spawn(
      getWindowsPowerShellPath(),
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-WindowStyle',
        'Hidden',
        '-File',
        helperPath,
        '-JobFile',
        jobPath,
      ],
      {
        detached: true,
        windowsHide: true,
        stdio: 'ignore',
      }
    );

    child.once('spawn', () => {
      child.unref();
      resolve(jobPath);
    });

    child.once('error', (error) => {
      try { fs.rmSync(jobPath, { force: true }); } catch { /* best effort */ }
      reject(new Error(`Could not start the Portable update helper: ${error?.message || String(error)}`));
    });
  });
}

async function askToUpdate(getWindow, version) {
  const { response } = await showMessage(getWindow, {
    type: 'info',
    title: 'Quran Reader Lite — به‌روزرسانی',
    message: `نسخهٔ جدید ${version} منتشر شده است.`,
    detail:
      'برای دریافت و نصب نسخهٔ جدید، «به‌روزرسانی» را انتخاب کنید. پس از دریافت فایل، برنامه بسته و با نسخهٔ جدید دوباره اجرا می‌شود.\n\nيتوفر إصدار جديد. اختر «به‌روزرسانی» لتنزيله وتثبيته.',
    buttons: ['به‌روزرسانی', 'بعداً'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  return response === 0;
}

function showAcceptedUpdateError(getWindow, error) {
  return showMessage(getWindow, {
    type: 'error',
    title: 'Quran Reader Lite — خطای به‌روزرسانی',
    message: 'دریافت یا نصب نسخهٔ جدید انجام نشد.',
    detail: String(error?.message || error || 'خطای ناشناخته'),
    buttons: ['متوجه شدم'],
    defaultId: 0,
    noLink: true,
  });
}

function startNsisUpdates(getWindow) {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;

  let declinedVersion = null;
  let promptOpen = false;
  let updateAccepted = false;
  let errorDialogOpen = false;
  let downloadInProgress = false;

  const showError = async (error) => {
    if (!updateAccepted || errorDialogOpen) return;
    errorDialogOpen = true;
    try {
      await showAcceptedUpdateError(getWindow, error);
    } finally {
      errorDialogOpen = false;
      updateAccepted = false;
      downloadInProgress = false;
    }
  };

  autoUpdater.on('error', (error) => {
    if (updateAccepted) void showError(error);
    else updaterLog('warning', 'NSIS update check failed; the app will continue offline.', { message: error?.message || String(error) });
  });

  autoUpdater.on('update-available', async (info) => {
    const version = String(info?.version || 'جدید');
    if (promptOpen || version === declinedVersion || downloadInProgress) return;

    promptOpen = true;
    try {
      const accepted = await askToUpdate(getWindow, version);
      if (!accepted) {
        declinedVersion = version;
        return;
      }

      updateAccepted = true;
      downloadInProgress = true;
      notify('Quran Reader Lite', `در حال دریافت نسخهٔ ${version}؛ پس از پایان، برنامه خودکار راه‌اندازی مجدد می‌شود.`);
      await autoUpdater.downloadUpdate();
    } catch (error) {
      await showError(error);
    } finally {
      promptOpen = false;
    }
  });

  autoUpdater.on('download-progress', (progress) => {
    if (!updateAccepted) return;
    const percent = Math.max(0, Math.min(100, Math.round(progress?.percent || 0)));
    if (percent === 100) notify('Quran Reader Lite', 'دریافت به‌روزرسانی کامل شد؛ نصب آغاز می‌شود.');
  });

  autoUpdater.on('update-downloaded', () => {
    if (!updateAccepted) return;
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 400);
  });

  const checkForUpdates = () => {
    if (downloadInProgress || promptOpen) return;
    autoUpdater.checkForUpdates().catch((error) => {
      updaterLog('warning', 'NSIS background update check failed.', { message: error?.message || String(error) });
    });
  };

  const firstCheck = setTimeout(checkForUpdates, FIRST_CHECK_DELAY_MS);
  const recurringCheck = setInterval(checkForUpdates, CHECK_INTERVAL_MS);
  app.once('before-quit', () => {
    clearTimeout(firstCheck);
    clearInterval(recurringCheck);
  });

  updaterLog('info', 'NSIS updater started.', { currentVersion: app.getVersion() });
}

function startPortableUpdates(getWindow) {
  const executablePath = getPortableExecutablePath();
  if (!executablePath || !fs.existsSync(executablePath)) {
    updaterLog('error', 'Portable mode detected but PORTABLE_EXECUTABLE_FILE is missing or invalid.');
    return;
  }

  let declinedVersion = null;
  let checkRunning = false;
  let promptOpen = false;
  let updateAccepted = false;
  let updateInProgress = false;

  const checkForUpdates = async () => {
    if (checkRunning || promptOpen || updateInProgress) return;
    checkRunning = true;
    let downloadedPath = null;

    try {
      const manifest = await getVerifiedPortableManifest();
      const comparison = compareStableVersions(manifest.version, app.getVersion());
      if (comparison === null) throw new Error('Could not compare current and remote versions.');
      if (comparison <= 0 || manifest.version === declinedVersion) return;

      promptOpen = true;
      const accepted = await askToUpdate(getWindow, manifest.version);
      if (!accepted) {
        declinedVersion = manifest.version;
        return;
      }

      updateAccepted = true;
      updateInProgress = true;
      assertPortableDirectoryWritable(executablePath);
      notify('Quran Reader Lite', `در حال دریافت نسخهٔ ${manifest.version}؛ پس از پایان، برنامه خودکار راه‌اندازی مجدد می‌شود.`);

      downloadedPath = await downloadAndVerifyPortable(manifest);
      await launchPortableReplacement(executablePath, downloadedPath, manifest);
      downloadedPath = null; // The helper now owns cleanup of this temporary file.
      updaterLog('info', 'Verified portable update was handed to the replacement helper.', {
        from: app.getVersion(),
        to: manifest.version,
        executablePath,
      });
      notify('Quran Reader Lite', 'دریافت و بررسی نسخهٔ جدید انجام شد؛ برنامه در حال راه‌اندازی مجدد است.');
      setTimeout(() => app.quit(), 500);
    } catch (error) {
      if (downloadedPath) {
        try { fs.rmSync(downloadedPath, { force: true }); } catch { /* best effort */ }
      }
      updaterLog('error', 'Portable update check or installation failed.', { message: error?.message || String(error) });
      if (updateAccepted) {
        try { await showAcceptedUpdateError(getWindow, error); } catch { /* app may be closing */ }
      }
      updateAccepted = false;
      updateInProgress = false;
    } finally {
      checkRunning = false;
      promptOpen = false;
    }
  };

  const firstCheck = setTimeout(() => { void checkForUpdates(); }, FIRST_CHECK_DELAY_MS);
  const recurringCheck = setInterval(() => { void checkForUpdates(); }, CHECK_INTERVAL_MS);
  app.once('before-quit', () => {
    clearTimeout(firstCheck);
    clearInterval(recurringCheck);
  });

  updaterLog('info', 'Portable updater started.', {
    currentVersion: app.getVersion(),
    executablePath,
  });
}

function startAutoUpdates(getWindow) {
  if (updaterStarted || !app.isPackaged || process.platform !== 'win32') return;
  updaterStarted = true;

  // Do not fall through to electron-updater if portable mode is detected but its
  // executable path is unavailable. electron-updater only installs NSIS updates.
  const portableMode = Boolean(
    process.env.PORTABLE_EXECUTABLE_FILE || process.env.PORTABLE_EXECUTABLE_DIR
  );

  if (portableMode) {
    startPortableUpdates(getWindow);
  } else {
    startNsisUpdates(getWindow);
  }
}

module.exports = { startAutoUpdates };
