// Auto-start on Windows boot
const { app } = require('electron');

function setupAutoStart() {
  // Set the app to auto-launch on Windows startup
  app.setLoginItemSettings({
    openAtLogin: true,
    openAsHidden: true, // Start minimized to tray
    path: app.getPath('exe'),
    args: ['--hidden'],
  });

  console.log('🚀 Auto-start configured');
}

function disableAutoStart() {
  app.setLoginItemSettings({
    openAtLogin: false,
  });
  console.log('🚀 Auto-start disabled');
}

function isAutoStartEnabled() {
  return app.getLoginItemSettings().openAtLogin;
}

module.exports = {
  setupAutoStart,
  disableAutoStart,
  isAutoStartEnabled,
};
