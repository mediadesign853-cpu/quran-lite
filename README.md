# Quran Reader Lite

**Languages:** **English** | [فارسی](README.fa.md) | [العربية](README.ar.md)

Quran Reader Lite is a Windows desktop application for reading and searching the Arabic Quran offline. It is built with **Electron, React, and TypeScript**. The Lite edition contains the Arabic Quran text; translations and tafsir are not included.

Quran text source: [Tanzil](https://tanzil.net) — CC BY 3.0.

## Main Features

- Read and search the 114 surahs and their ayahs.
- View the 604 Mushaf page images included with the current project build.
- Save bookmarks, search history, and the last reading position.
- Use the Arabic or Persian interface, light or dark theme, and adjust text size.
- Copy ayahs with configurable ayah numbers, Quranic brackets, and references.
- Insert real footnotes into Microsoft Word or Adobe InDesign on Windows.
- Read and search offline; an internet connection is needed for updates.
- Choose between a Windows installer (NSIS) and a Portable version.
- Receive automatic updates, with a signed update process for the Portable version.

## Installation & Setup

1. Open the [GitHub Releases page](https://github.com/mediadesign853-cpu/quran-lite/releases/latest).
2. Download one of these files:
   - **Quran Reader Lite Setup** — installs the application and creates shortcuts.
   - **Quran Reader Lite Portable** — runs without installation.
3. For the Portable version, keep the `Quran Reader Lite Data` folder beside the EXE. This folder contains the Portable version's settings, bookmarks, and history. Keep the folder writable so updates can replace the EXE safely.

**Word and InDesign:** Real footnote insertion is available in the Windows desktop application. It requires the target application (Word or InDesign) to be installed and Windows PowerShell 5.1. If insertion does not work, open the target application and try again.

## Building & Releasing

### Requirements and local build

Use **Node.js 22.13 or later** and npm 10 or later. Python 3 is also required for the Quran text regression tests. On Windows, run these commands from the project folder:

```powershell
npm run refresh:dependencies
# After the lockfile has been regenerated and committed, future clean installs use:
npm ci
npm run check
npm run dist:win
```

`npm run check` verifies the Quran data, TypeScript types, lint rules, and web build. `npm run dist:win` prepares the Electron app and creates both Windows x64 packages in `release/`:

- `Quran Reader Lite Setup <version>.exe`
- `Quran Reader Lite Portable <version>.exe`

### Portable update keys and scripts

The project uses three scripts for Portable updates:

| Command | Purpose |
| --- | --- |
| `npm run generate:portable-keys` | Creates an Ed25519 key pair. Run it once when setting up the update system, not for every release. |
| `npm run verify:portable-key` | Checks that the public key exists and is a valid Ed25519 key. |
| `npm run create:portable-manifest` | Calculates the Portable EXE's SHA-512 hash and creates the signed `latest-portable.json` manifest. |

The exact key-generation command in this project is **`generate:portable-keys`**; there is no `generate:portable` script in `package.json`.

Key files:

- `electron/portable-update-public.pem` — public key; commit this file to the repository.
- `.secrets/portable-update-private.pem` — private key; never commit or share this file.

Add the complete private key as a GitHub Actions repository secret named `PORTABLE_UPDATE_PRIVATE_KEY`. Keep a secure offline backup. Do not generate a new key for each release; existing installations trust the public key already included in the app.

The manifest script uses `PORTABLE_UPDATE_PRIVATE_KEY` and `GITHUB_REF_NAME`. The release workflow supplies these values automatically and runs the manifest script after the Portable EXE has been built.

### GitHub Actions release

The workflow is at `.github/workflows/release-windows.yml`. It runs **only when a version tag beginning with `v` is pushed**, for example `v1.0.1`.

For each release:

1. Change the version in `package.json` to the new release number (for example, `1.0.1`).
2. Update the lockfile and run the checks:

```powershell
npm install --package-lock-only
npm run check
```

3. Commit and push the release changes to `main`, then create and push a tag with the exact same version:

```powershell
git add package.json package-lock.json
git commit -m "Release v1.0.1"
git push origin main
git tag v1.0.1
git push origin v1.0.1
```

GitHub Actions uses Windows, sets up Node.js 22, installs dependencies with `npm ci`, runs `npm run check`, and builds both NSIS and Portable packages. It then creates and uploads the signed Portable manifest. The Release is published only after the required files have been uploaded.

Required repository secret: `PORTABLE_UPDATE_PRIVATE_KEY`. The workflow uses GitHub's `GITHUB_TOKEN` to upload release files.

## Auto-Update Behavior

- The packaged Windows app checks for updates about 15 seconds after launch, then every 12 hours.
- The app asks before downloading an update. It does not install an update without user approval.
- **NSIS installation:** uses `electron-updater` and the `latest.yml` file published with the GitHub Release.
- **Portable version:** downloads `latest-portable.json`, verifies its Ed25519 signature, then checks the downloaded EXE with SHA-512. A PowerShell helper replaces the EXE after the app closes. The previous EXE is kept until the new version starts successfully.
- Updates need an internet connection. Portable updates also need write permission in the folder containing the EXE. If an update fails, the existing version is kept.

## Security Note

Ed25519 signature verification and SHA-512 checks protect the **Portable update process**. They are not the same as a Windows Authenticode publisher signature. The current Windows EXE files are not signed with an Authenticode certificate, so Windows SmartScreen may show an “Unknown publisher” warning. Download the application only from the official GitHub Releases page linked above.


## Electron security and permissions
- Browser permissions are denied by default. Only sanitized clipboard writes from the trusted top-level `app://quran` renderer are allowed for the copy feature.
- Clipboard reads, browser notifications, geolocation, camera, microphone, display capture, USB and HID permissions are denied. Update notifications use Electron's native main-process API.
- The desktop CSP is scoped to `app://quran` and the `qpage://pages` resource host. Page images and `boxes.json` are served only from that internal host.
- The hosted PWA uses a separate CSP that permits its same-origin service worker.

## Refreshing dependencies
Direct dependencies have been moved to maintained stable release lines. TypeScript is kept on 6.0.x because the current stable `typescript-eslint` release supports TypeScript `<6.1.0`; Vite 8 and ESLint 10 require a modern Node runtime. On Windows, run this once from PowerShell in the project folder to regenerate `package-lock.json`, install the packages, run the audit and tests, and rebuild the Electron assets:

```powershell
npm run refresh:dependencies
```

Do not run `npm ci` until this refresh has completed successfully; the included lockfile could not be regenerated in this network-restricted build environment.
