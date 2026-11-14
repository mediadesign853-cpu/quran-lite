'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  CONTENT_SECURITY_POLICY,
  isAllowedPageResourceOrigin,
  isInternalAppUrl,
  isInternalPageResourceUrl,
  allowPermissionRequest,
  allowPermissionCheck,
} = require('../electron/security.cjs');
const { createAppProtocolHandler, createPageProtocolHandler } = require('../electron/protocol-handlers.cjs');

function parseCsp(policy) {
  return Object.fromEntries(
    policy.split(';').map((directive) => {
      const [name, ...sources] = directive.trim().split(/\s+/u);
      return [name, sources];
    })
  );
}

test('app protocol accepts only the exact trusted origin', () => {
  assert.equal(isInternalAppUrl('app://quran/index.html'), true);
  assert.equal(isInternalAppUrl('app://quran/data/surah_001.json'), true);
  assert.equal(isInternalAppUrl('app://quran.evil.example/index.html'), false);
  assert.equal(isInternalAppUrl('app://evil@quran/index.html'), false);
  assert.equal(isInternalAppUrl('app://quran:444/index.html'), false);
  assert.equal(isInternalAppUrl('https://quran/index.html'), false);
  assert.equal(isInternalAppUrl('not a url'), false);
});

test('qpage CORS is allowed only from the internal app origin', () => {
  assert.equal(isAllowedPageResourceOrigin('app://quran'), true);
  assert.equal(isAllowedPageResourceOrigin(null), true);
  assert.equal(isAllowedPageResourceOrigin(''), true);
  assert.equal(isAllowedPageResourceOrigin('https://attacker.example'), false);
  assert.equal(isAllowedPageResourceOrigin('app://quran.evil.example'), false);
});

test('qpage protocol accepts only the page host and the expected resources', () => {
  assert.equal(isInternalPageResourceUrl('qpage://pages/1'), true);
  assert.equal(isInternalPageResourceUrl('qpage://pages/604'), true);
  assert.equal(isInternalPageResourceUrl('qpage://pages/boxes.json'), true);
  assert.equal(isInternalPageResourceUrl('qpage://pages/0'), false);
  assert.equal(isInternalPageResourceUrl('qpage://pages/605'), false);
  assert.equal(isInternalPageResourceUrl('qpage://attacker/1'), false);
  assert.equal(isInternalPageResourceUrl('qpage://pages/1?download=1'), false);
  assert.equal(isInternalPageResourceUrl('qpage://pages/../main.cjs'), false);
  assert.equal(isInternalPageResourceUrl('qpage://user@pages/1'), false);
  assert.equal(isInternalPageResourceUrl('qpage://pages:444/1'), false);
});

test('CSP allows only app assets and the custom page resource host', () => {
  const csp = parseCsp(CONTENT_SECURITY_POLICY);
  assert.deepEqual(csp['default-src'], ["'none'"]);
  assert.deepEqual(csp['script-src'], ["'self'"]);
  assert.deepEqual(csp['img-src'], ["'self'", 'qpage://pages']);
  assert.deepEqual(csp['connect-src'], ["'self'", 'qpage://pages']);
  assert.deepEqual(csp['font-src'], ["'self'"]);
  assert.deepEqual(csp['worker-src'], ["'none'"]);
  assert.deepEqual(csp['manifest-src'], ["'self'"]);
  assert.deepEqual(csp['style-src'], ["'self'"]);
  assert.deepEqual(csp['style-src-elem'], ["'self'"]);
  assert.ok(csp['style-src-attr'].includes("'unsafe-inline'"));
  for (const directive of ['object-src', 'frame-src', 'frame-ancestors', 'form-action', 'media-src']) {
    assert.deepEqual(csp[directive], ["'none'"]);
  }
  const hostedHeaders = fs.readFileSync(path.join(__dirname, '..', 'public', '_headers'), 'utf8');
  assert.match(hostedHeaders, /worker-src 'self'/u);
  assert.doesNotMatch(hostedHeaders, /qpage:\/\/pages/u);
  assert.ok(!CONTENT_SECURITY_POLICY.includes('https:'));
  assert.ok(!CONTENT_SECURITY_POLICY.includes('unsafe-eval'));
  assert.ok(!CONTENT_SECURITY_POLICY.includes('data:'));
});

test('only the trusted main frame may request sanitized clipboard writes', () => {
  const mainWebContents = { getURL: () => 'app://quran/index.html' };
  const accepted = {
    webContents: mainWebContents,
    mainWebContents,
    permission: 'clipboard-sanitized-write',
    details: { isMainFrame: true, requestingUrl: 'app://quran/index.html' },
  };
  assert.equal(allowPermissionRequest(accepted), true);
  assert.equal(allowPermissionCheck({
    webContents: mainWebContents,
    mainWebContents,
    permission: 'clipboard-sanitized-write',
    requestingOrigin: 'app://quran',
    details: { isMainFrame: true },
  }), true);

  for (const permission of ['notifications', 'geolocation', 'media', 'display-capture', 'clipboard-read', 'fullscreen', 'serial', 'usb', 'hid', 'local-fonts', 'local-network', 'persistent-storage', 'screen-wake-lock', 'midi', 'nfc', 'pointerLock', 'automatic-fullscreen', 'openExternal']) {
    assert.equal(allowPermissionRequest({ ...accepted, permission }), false);
  }
  assert.equal(allowPermissionRequest({
    ...accepted,
    details: { isMainFrame: false, requestingUrl: 'app://quran/index.html' },
  }), false);
  assert.equal(allowPermissionRequest({
    ...accepted,
    webContents: { getURL: () => 'https://untrusted.example' },
    details: { isMainFrame: true, requestingUrl: 'https://untrusted.example/' },
  }), false);
  assert.equal(allowPermissionCheck({
    ...accepted,
    requestingOrigin: 'app://quran.evil.example',
    details: { isMainFrame: true },
  }), false);
});


test('Electron builder packages the security module imported by main.cjs', () => {
  const builderConfig = fs.readFileSync(path.join(__dirname, '..', 'electron-builder.yml'), 'utf8');
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(mainSource, /require\(['"]\.\/security\.cjs['"]\)/u);
  assert.match(mainSource, /require\(['"]\.\/protocol-handlers\.cjs['"]\)/u);
  assert.match(builderConfig, /^\s*- electron\/security\.cjs\s*$/mu);
  assert.match(builderConfig, /^\s*- electron\/protocol-handlers\.cjs\s*$/mu);
});

test('TypeScript 6 config does not rely on deprecated baseUrl', () => {
  const appConfig = fs.readFileSync(path.join(__dirname, '..', 'tsconfig.app.json'), 'utf8');
  const nodeConfig = fs.readFileSync(path.join(__dirname, '..', 'tsconfig.node.json'), 'utf8');
  assert.equal(appConfig.includes('"baseUrl"'), false);
  assert.ok(appConfig.includes('"@/*": ["./src/*"]'));
  assert.ok(appConfig.includes('"types": ["vite/client"]'));
  assert.ok(nodeConfig.includes('"types": ["node"]'));
});


test('app protocol serves the built HTML with CSP and same-origin assets', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quran-app-protocol-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>Quran</title>');
  fs.mkdirSync(path.join(root, 'assets'));
  fs.writeFileSync(path.join(root, 'assets', 'main.js'), 'export {};');
  fs.writeFileSync(path.join(root, 'assets', 'font.woff2'), Buffer.from([1, 2, 3]));

  const handle = createAppProtocolHandler({ root });
  const html = await handle({ method: 'GET', url: 'app://quran/', headers: new Headers() });
  assert.equal(html.status, 200);
  assert.match(html.headers.get('content-type'), /text\/html/u);
  assert.equal(html.headers.get('content-security-policy'), CONTENT_SECURITY_POLICY);
  assert.equal(html.headers.get('x-content-type-options'), 'nosniff');

  const script = await handle({ method: 'GET', url: 'app://quran/assets/main.js', headers: new Headers() });
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /javascript/u);
  const font = await handle({ method: 'GET', url: 'app://quran/assets/font.woff2', headers: new Headers() });
  assert.equal(font.status, 200);
  assert.equal(font.headers.get('content-type'), 'font/woff2');
  const missing = await handle({ method: 'GET', url: 'app://quran/not-found.js', headers: new Headers() });
  assert.equal(missing.status, 404);
  const post = await handle({ method: 'POST', url: 'app://quran/', headers: new Headers() });
  assert.equal(post.status, 405);
});

test('qpage protocol serves images and boxes only to the application origin', async (t) => {
  const pagesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quran-page-protocol-'));
  t.after(() => fs.rmSync(pagesDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(pagesDir, '1.webp'), Buffer.from([82, 73, 70, 70]));
  fs.writeFileSync(path.join(pagesDir, 'boxes.json'), '{"v":1,"p":{}}');

  const handle = createPageProtocolHandler({ pagesDir });
  const image = await handle({
    method: 'GET',
    url: 'qpage://pages/1',
    headers: new Headers({ origin: 'app://quran' }),
  });
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/webp');
  assert.equal(image.headers.get('access-control-allow-origin'), 'app://quran');
  assert.equal(image.headers.get('vary'), 'Origin');

  const boxes = await handle({
    method: 'GET',
    url: 'qpage://pages/boxes.json',
    headers: new Headers({ origin: 'app://quran' }),
  });
  assert.equal(boxes.status, 200);
  assert.equal(boxes.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(await boxes.text(), '{"v":1,"p":{}}');

  const denied = await handle({
    method: 'GET',
    url: 'qpage://pages/1',
    headers: new Headers({ origin: 'https://attacker.example' }),
  });
  assert.equal(denied.status, 403);
  const invalid = await handle({
    method: 'GET',
    url: 'qpage://pages/605',
    headers: new Headers({ origin: 'app://quran' }),
  });
  assert.equal(invalid.status, 403);
});
