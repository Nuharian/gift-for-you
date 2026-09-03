// Preload script — the only bridge between main and renderer.
const { contextBridge, ipcRenderer } = require('electron');

// Wraps an event subscription so the renderer can unsubscribe, and so a
// re-render never stacks duplicate listeners on the same channel.
function on(channel) {
  return (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };
}

contextBridge.exposeInMainWorld('api', {
  // Registration
  register: (name) => ipcRenderer.invoke('register', name),
  getProfile: () => ipcRenderer.invoke('getProfile'),
  isRegistered: () => ipcRenderer.invoke('isRegistered'),

  // Study tracker
  startStudying: () => ipcRenderer.invoke('startStudying'),
  stopStudying: () => ipcRenderer.invoke('stopStudying'),
  startBreak: () => ipcRenderer.invoke('startBreak'),
  resumeStudying: () => ipcRenderer.invoke('resumeStudying'),
  getStudyState: () => ipcRenderer.invoke('getStudyState'),
  getStats: () => ipcRenderer.invoke('getStats'),

  // Idle check
  respondToIdleCheck: (isHere) => ipcRenderer.invoke('respondToIdleCheck', isHere),
  getIdleState: () => ipcRenderer.invoke('getIdleState'),

  // Messages
  getMessages: () => ipcRenderer.invoke('getMessages'),
  markMessageRead: (id) => ipcRenderer.invoke('markMessageRead', id),
  replyToTeacher: (text) => ipcRenderer.invoke('replyToTeacher', text),

  // Activity
  getCurrentActivity: () => ipcRenderer.invoke('getCurrentActivity'),
  getAppUsage: () => ipcRenderer.invoke('getAppUsage'),
  getTitleUsage: () => ipcRenderer.invoke('getTitleUsage'),
  syncNow: () => ipcRenderer.invoke('syncNow'),

  // Settings
  getSettings: () => ipcRenderer.invoke('getSettings'),
  setSetting: (key, value) => ipcRenderer.invoke('setSetting', key, value),

  // Updates
  getUpdateStatus: () => ipcRenderer.invoke('getUpdateStatus'),
  checkForUpdates: () => ipcRenderer.invoke('checkForUpdates'),
  installUpdate: () => ipcRenderer.invoke('installUpdate'),

  openExternal: (url) => ipcRenderer.invoke('openExternal', url),

  // Window controls (frameless window)
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  closeWindow: () => ipcRenderer.send('window:close'),

  // Events from the main process — each returns an unsubscribe function.
  onMessage: on('message:new'),
  onMessagesSync: on('messages:sync'),
  onIdleCheck: on('idle:check'),
  onIdleDetected: on('idle:detected'),
  onIdleResolved: on('idle:resolved'),
  onStudyUpdate: on('study:update'),
  onActivityUpdate: on('activity:update'),
  onConnectionStatus: on('connection:status'),
  onUpdateStatus: on('update:status'),

  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
});
