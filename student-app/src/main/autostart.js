// Auto-start on Windows login.
const { app } = require('electron');

// Registers the app to launch at login, hidden in the tray. Called on every
// boot so that an update (which changes the install path) re-points the
// registry entry instead of leaving a dead shortcut behind.
function setupAutoStart(store) {
  const startMinimized = !store || store.get('startMinimized') !== false;

  // In development app.getPath('exe') is electron.exe, so registering would
  // leave a broken login item on the developer's machine.
  if (!app.isPackaged) {
    console.log('🚀 Auto-start skipped (development build)');
    return;
  }

  try {
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: startMinimized,
      path: app.getPath('exe'),
      args: startMinimized ? ['--hidden'] : [],
    });
    if (store) store.set('autoStart', true);
    console.log('🚀 Auto-start configured' + (startMinimized ? ' (hidden)' : ''));
  } catch (e) {
    console.warn('Auto-start could not be configured:', e.message);
  }
}

function disableAutoStart(store) {
  try {
    app.setLoginItemSettings({ openAtLogin: false });
    if (store) store.set('autoStart', false);
    console.log('🚀 Auto-start disabled');
  } catch (e) {
    console.warn('Auto-start could not be disabled:', e.message);
  }
}

function isAutoStartEnabled() {
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
