// Firebase client for the Electron student app (CommonJS)
const { initializeApp, getApps, getApp } = require('firebase/app');
const { getFirestore } = require('firebase/firestore');

let firebaseConfig = null;
let app = null;
let db = null;

function initFirebase(config) {
  firebaseConfig = config;
  if (!config || !config.apiKey || !config.projectId) {
    console.warn('Firebase not configured in student app.');
    return false;
  }

  try {
    app = getApps().length === 0 ? initializeApp(config) : getApp();
    db = getFirestore(app);
    console.log('🔥 Firebase initialized for student app');
    return true;
  } catch (error) {
    console.error('Firebase initialization failed:', error);
    return false;
  }
}

function getDb() {
  return db;
}

function isConfigured() {
  return !!db;
}

module.exports = { initFirebase, getDb, isConfigured };
