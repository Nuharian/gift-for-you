// Prepares electron-builder's code-signing cache before a Windows build.
//
// electron-builder ships its signing tools for all three platforms in one
// archive. Extracting it on Windows fails unless the shell is elevated or
// Developer Mode is on, because the macOS portion contains symlinks:
//
//   ERROR: Cannot create symbolic link : A required privilege is not held
//
// The build then stops before the NSIS step, producing win-unpacked but no
// installer and no latest.yml — so nothing can auto-update.
//
// We only ever ship Windows, so this pre-populates the cache with the macOS
// files skipped. Runs automatically via the `prebuild` npm hook and is a no-op
// when the cache is already good, on non-Windows hosts, or if anything fails —
// electron-builder then behaves exactly as it would have without this script.
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

// Pinned to what electron-builder 24.x requests. If it ever asks for a
// different version it will download that itself; should extraction fail
// again, bump this to match the version named in the build output.
const VERSION = 'winCodeSign-2.6.0';
const URL = `https://github.com/electron-userland/electron-builder-binaries/releases/download/${VERSION}/${VERSION}.7z`;

function cacheRoot() {
  const base = process.env.ELECTRON_BUILDER_CACHE
    || path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache');
  return path.join(base, 'winCodeSign');
}

function sevenZipPath() {
  const p = path.join(__dirname, '..', 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
  return fs.existsSync(p) ? p : null;
}

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('too many redirects'));
    https.get(url, { headers: { 'User-Agent': 'gift-for-you-build' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(download(res.headers.location, dest, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  if (process.platform !== 'win32') return;

  const root = cacheRoot();
  const target = path.join(root, VERSION);

  // signtool.exe is the file the build actually needs; its presence means the
  // cache is usable and there is nothing to do.
  if (fs.existsSync(path.join(target, 'windows-10', 'x64', 'signtool.exe'))) return;

  const zip = sevenZipPath();
  if (!zip) return; // 7zip-bin not installed yet; let electron-builder try.

  console.log(`Preparing ${VERSION} cache (skipping macOS files)…`);
  fs.mkdirSync(root, { recursive: true });

  const archive = path.join(root, `${VERSION}.7z`);
  if (!fs.existsSync(archive) || fs.statSync(archive).size < 1024 * 1024) {
    await download(URL, archive);
  }

  // Extract to a temporary directory first so an interrupted run cannot leave
  // a half-populated cache that later looks complete.
  const staging = path.join(root, `.staging-${process.pid}`);
  fs.rmSync(staging, { recursive: true, force: true });

  execFileSync(zip, ['x', '-bd', '-bso0', archive, `-o${staging}`, '-xr!darwin', '-y'], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(staging, target);
  console.log(`Cache ready at ${target}`);
}

main().catch((e) => {
  // Never block the build: if this fails, electron-builder falls back to its
  // own download and the README documents the manual fix.
  console.warn(`Could not prepare build cache (${e.message}); continuing.`);
});
