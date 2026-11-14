// Request handlers for the app://quran document origin and qpage://pages assets.
// Kept separate from Electron startup so response headers, CORS and resource paths can be tested.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  CONTENT_SECURITY_POLICY,
  INTERNAL_APP_ORIGIN,
  isAllowedPageResourceOrigin,
  isInternalAppUrl,
  isInternalPageResourceUrl,
} = require('./security.cjs');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.otf': 'font/otf',
  '.gz': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
};

async function readFileResponse(file, fallbackType, extraHeaders = {}) {
  try {
    const body = await fs.promises.readFile(file);
    const headers = new Headers({
      'content-type': MIME[path.extname(file).toLowerCase()] || fallbackType,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    });
    for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
    return new Response(body, { headers });
  } catch {
    return new Response('not found', { status: 404 });
  }
}

function createAppProtocolHandler({ root }) {
  const appRoot = path.resolve(root);
  return async function handleAppRequest(request) {
    if (request.method !== 'GET') {
      return new Response('method not allowed', { status: 405 });
    }

    let pathname;
    try {
      const parsedUrl = new URL(request.url);
      if (!isInternalAppUrl(parsedUrl.href)) {
        return new Response('forbidden', { status: 403 });
      }
      pathname = decodeURIComponent(parsedUrl.pathname);
    } catch {
      return new Response('bad request', { status: 400 });
    }

    if (pathname === '/') pathname = '/index.html';
    const relativePath = pathname.replace(/^\/+/, '');
    const file = path.resolve(appRoot, relativePath);
    const fromRoot = path.relative(appRoot, file);
    if (fromRoot === '..' || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) {
      return new Response('forbidden', { status: 403 });
    }

    const headers = path.extname(file).toLowerCase() === '.html'
      ? { 'content-security-policy': CONTENT_SECURITY_POLICY }
      : {};
    return readFileResponse(file, 'application/octet-stream', headers);
  };
}

function createPageProtocolHandler({ pagesDir }) {
  const pageRoot = path.resolve(pagesDir);
  return async function handlePageRequest(request) {
    if (request.method !== 'GET' || !isInternalPageResourceUrl(request.url)) {
      return new Response('forbidden', { status: 403 });
    }

    const origin = request.headers.get('origin');
    if (!isAllowedPageResourceOrigin(origin)) {
      return new Response('forbidden', { status: 403 });
    }

    const pathname = new URL(request.url).pathname;
    const headers = {
      'access-control-allow-origin': INTERNAL_APP_ORIGIN,
      'vary': 'Origin',
    };
    if (pathname === '/boxes.json') {
      return readFileResponse(path.join(pageRoot, 'boxes.json'), 'application/json', headers);
    }

    const page = Number(pathname.slice(1));
    return readFileResponse(path.join(pageRoot, `${page}.webp`), 'image/webp', headers);
  };
}

module.exports = {
  createAppProtocolHandler,
  createPageProtocolHandler,
  readFileResponse,
};
