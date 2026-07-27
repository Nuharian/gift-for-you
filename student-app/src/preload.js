// Preload script — bridges main and renderer processes
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Registration
  register: (name) => ipcRenderer.invoke('register', name),
  getProfile: () => ipcRenderer.invoke('getProfile'),
  isRegistered: () => ipcRenderer.invoke('isRegistered'),

  // Server config
  getServerUrl: () => ipcRenderer.invoke('getServerUrl'),
  setServerUrl: (url) => ipcRenderer.invoke('setServerUrl', url),

  // Study tracker
  startStudying: () => ipcRenderer.invoke('startStudying'),
  stopStudying: () => ipcRenderer.invoke('stopStudying'),
  startBreak: () => ipcRenderer.invoke('startBreak'),
  resumeStudying: () => ipcRenderer.invoke('resumeStudying'),
  getStudyState: () => ipcRenderer.invoke('getStudyState'),

  // Idle check response
  respondToIdleCheck: (isHere) => ipcRenderer.invoke('respondToIdleCheck', isHere),

  // Messages
  getMessages: () => ipcRenderer.invoke('getMessages'),
  markMessageRead: (id) => ipcRenderer.invoke('markMessageRead', id),

  // Activity (for display in student UI)
  getCurrentActivity: () => ipcRenderer.invoke('getCurrentActivity'),

  // Window controls (frameless window)
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  closeWindow: () => ipcRenderer.send('window:close'),

  // Events from main process
  onMessage: (callback) => {
    ipcRenderer.on('message:new', (event, data) => callback(data));
  },
  onIdleCheck: (callback) => {
    ipcRenderer.on('idle:check', (event, data) => callback(data));
  },
  onStudyUpdate: (callback) => {
    ipcRenderer.on('study:update', (event, data) => callback(data));
  },
  onActivityUpdate: (callback) => {
    ipcRenderer.on('activity:update', (event, data) => callback(data));
  },
  onConnectionStatus: (callback) => {
    ipcRenderer.on('connection:status', (event, data) => callback(data));
  },

  // Remove listeners
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },
});
