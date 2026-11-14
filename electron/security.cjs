// Security policy shared by the Electron main process and its automated tests.
'use strict';

const INTERNAL_APP_ORIGIN = 'app://quran';

const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "style-src-elem 'self'",
  // React uses style attributes for a small number of dynamic layout values.
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' qpage://pages",
  "font-src 'self'",
  // The Quran text and app assets are served by app://quran; page images and
  // their geometry metadata are served by qpage://pages.
  "connect-src 'self' qpage://pages",
  // The desktop renderer does not register a service worker or create workers.
  "worker-src 'none'",
  "manifest-src 'self'",
  "media-src 'none'",
].join('; ');

function parseUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) return null;
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

function isInternalAppUrl(rawUrl) {
  const url = parseUrl(rawUrl);
  return Boolean(
    url &&
    url.protocol === 'app:' &&
    url.hostname === 'quran' &&
    !url.username &&
    !url.password &&
    !url.port
  );
}

function isAllowedPageResourceOrigin(origin) {
  return origin === null || origin === undefined || origin === '' || origin === INTERNAL_APP_ORIGIN;
}

function isInternalPageResourceUrl(rawUrl) {
  const url = parseUrl(rawUrl);
  if (
    !url ||
    url.protocol !== 'qpage:' ||
    url.hostname !== 'pages' ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    return false;
  }

  if (url.pathname === '/boxes.json') return true;
  if (!/^\/(?:[1-9]\d{0,2}|[1-5]\d{2}|60[0-4])$/u.test(url.pathname)) return false;
  const page = Number(url.pathname.slice(1));
  return Number.isInteger(page) && page >= 1 && page <= 604;
}

function isTrustedMainFrame(webContents, mainWebContents, isMainFrame, requestingUrl) {
  return Boolean(
    webContents &&
    mainWebContents &&
    webContents === mainWebContents &&
    isMainFrame === true &&
    isInternalAppUrl(requestingUrl)
  );
}

function allowPermissionRequest({ webContents, mainWebContents, permission, details }) {
  // The renderer only needs sanitized clipboard writes for the ayah-copy UI.
  // Clipboard reads, notifications, media, geolocation, fullscreen, USB/HID,
  // screen capture and every other permission remain denied by default.
  return (
    permission === 'clipboard-sanitized-write' &&
    isTrustedMainFrame(
      webContents,
      mainWebContents,
      details?.isMainFrame,
      details?.requestingUrl || webContents?.getURL?.()
    )
  );
}

function allowPermissionCheck({ webContents, mainWebContents, permission, requestingOrigin, details }) {
  return (
    permission === 'clipboard-sanitized-write' &&
    isTrustedMainFrame(
      webContents,
      mainWebContents,
      details?.isMainFrame,
      requestingOrigin
    )
  );
}

module.exports = {
  CONTENT_SECURITY_POLICY,
  INTERNAL_APP_ORIGIN,
  isAllowedPageResourceOrigin,
  isInternalAppUrl,
  isInternalPageResourceUrl,
  allowPermissionRequest,
  allowPermissionCheck,
};
