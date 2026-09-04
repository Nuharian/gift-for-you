// Auto-start on Windows login.
//
// On Windows the Run key is written directly rather than through
// app.setLoginItemSettings. Two reasons: Electron writes the value
// asynchronously, so anything done immediately afterwards gets overwritten;
// and it does not quote the executable path. The install path contains spaces
// ("Gift For You.exe"), so an unquoted value leaves Windows guessing where the
// path ends and the arguments begin — it normally guesses right, but a stray
// Gift.exe beside it would be launched instead.
const { app } = require('electron');
const { execFileSync } = require('child_process');

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
// Same key in the PSDrive form PowerShell expects.
const RUN_KEY_PS = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

// One fixed entry name. Electron derives its own from app.getName(), which
// resolves to the package name in some builds and the product name in others —
// which had left two Run entries behind, launching the app twice at login.
const ENTRY_NAME = 'GiftForYou';

// Names earlier versions may have registered, cleared on every start so an
// upgrade converges on a single entry.
function legacyEntryNames() {
  const names = ['electron.app.Gift For You', 'electron.app.gift-for-you'];
  try {
    const current = 'electron.app.' + app.getName();
    if (!names.includes(current)) names.push(current);
  } catch (e) {
    // app not ready; the fixed list still covers the shipped builds.
  }
  return names;
}

function entryName() {
  return ENTRY_NAME;
}

function reg(args) {
  return execFileSync('reg', args, {
    encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
  });
}

// reg.exe strips the double quotes out of a /d value while parsing its own
// command line, so the quoted path never survives. PowerShell via
// -EncodedCommand takes a base64 UTF-16LE script, which has no command-line
// escaping at all, and writes the value through verbatim.
function powershell(script) {
  // Suppress the progress stream, which PowerShell otherwise emits as CLIXML
  // on stderr and which would leak into the app's console output.
  const full = "$ProgressPreference = 'SilentlyContinue';" + script;
  const encoded = Buffer.from(full, 'utf16le').toString('base64');
  return execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
  );
}

function psLiteral(value) {
  // Single-quoted PowerShell strings are literal; only ' needs doubling.
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function readRunEntry() {
  try {
    const out = reg(['query', RUN_KEY, '/v', entryName()]);
    // "    <name>    REG_SZ    <value>"
    const match = out.match(/REG_SZ\s+(.*)/);
    return match ? match[1].trim() : null;
  } catch (e) {
    return null; // not present
  }
}

function writeRunEntry(value) {
  powershell(
    'Set-ItemProperty -Path ' + psLiteral(RUN_KEY_PS) +
    ' -Name ' + psLiteral(entryName()) +
    ' -Value ' + psLiteral(value) + ' -Force'
  );
}

function removeRunEntry(name) {
  try {
    reg(['delete', RUN_KEY, '/v', name || entryName(), '/f']);
  } catch (e) {
    // Already absent.
  }
}

function purgeLegacyEntries() {
  for (const name of legacyEntryNames()) removeRunEntry(name);
}

// Registers the app to launch at login, hidden in the tray. Called on every
// boot so that an update (which changes the install path) re-points the entry
// instead of leaving a dead one behind.
function setupAutoStart(store) {
  const startMinimized = !store || store.get('startMinimized') !== false;

  // In development app.getPath('exe') is electron.exe, so registering would
  // leave a broken login item on the developer's machine.
  if (!app.isPackaged) {
    console.log('🚀 Auto-start skipped (development build)');
    return;
  }

  const exePath = app.getPath('exe');

  if (process.platform !== 'win32') {
    try {
      app.setLoginItemSettings({ openAtLogin: true, openAsHidden: startMinimized, path: exePath });
      if (store) store.set('autoStart', true);
    } catch (e) {
      console.warn('Auto-start could not be configured:', e.message);
    }
    return;
  }

  const value = '"' + exePath + '"' + (startMinimized ? ' --hidden' : '');

  try {
    purgeLegacyEntries();
    if (readRunEntry() !== value) {
      writeRunEntry(value);
    }
    if (store) store.set('autoStart', true);
    console.log('🚀 Auto-start configured -> ' + value);
  } catch (e) {
    console.warn('Auto-start could not be configured:', e.message);
  }
}

function disableAutoStart(store) {
  if (process.platform === 'win32') {
    removeRunEntry();
    purgeLegacyEntries();
  } else {
    try {
      app.setLoginItemSettings({ openAtLogin: false });
    } catch (e) {
      console.warn('Auto-start could not be disabled:', e.message);
    }
  }
  if (store) store.set('autoStart', false);
  console.log('🚀 Auto-start disabled');
}

function isAutoStartEnabled() {
  if (process.platform === 'win32') {
    return readRunEntry() !== null;
  }
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch (e) {
    return false;
  }
}

module.exports = {
  setupAutoStart,
  disableAutoStart,
  isAutoStartEnabled,
};
