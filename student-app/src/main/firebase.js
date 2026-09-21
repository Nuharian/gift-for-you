// Firebase client for the Electron student app (CommonJS)
const { initializeApp, getApps, getApp, deleteApp } = require('firebase/app');
const { getFirestore, terminate } = require('firebase/firestore');

let firebaseConfig = null;
let app = null;
let db = null;
// Firestore refuses to reuse the name of an app that was torn down, so each
// rebuild gets a fresh one.
let instanceCount = 0;
// Set by the service layer so a rebuilt client can re-attach its listeners.
let onReinit = null;

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

// Rebuilds the Firestore client from scratch.
//
// The Web SDK keeps its own stream to the backend and normally reconnects on
// its own, but a stream can wedge in a way it never recovers from: writes are
// accepted into the local queue and their promises simply never settle, so the
// app looks healthy while the teacher stops seeing the student entirely. The
// sync watchdog calls this once writes have been failing long enough that a
// wedged connection is the likeliest explanation.
async function reinitFirebase() {
  if (!firebaseConfig || !firebaseConfig.apiKey) return false;

  const previousApp = app;
  const previousDb = db;
  db = null;
  app = null;

  // Tear the old client down before building the new one, so the dead stream
  // and its queued writes cannot linger.
  try { if (previousDb) await terminate(previousDb); } catch (e) { /* already gone */ }
  try { if (previousApp) await deleteApp(previousApp); } catch (e) { /* already gone */ }

  try {
    instanceCount += 1;
    app = initializeApp(firebaseConfig, 'gfy-retry-' + instanceCount);
    db = getFirestore(app);
    console.log('🔁 Firebase client rebuilt after a stalled connection');
    if (onReinit) {
      try { onReinit(); } catch (e) { console.error('Re-attach after rebuild failed:', e.message); }
    }
    return true;
  } catch (error) {
    console.error('Firebase rebuild failed:', error.message);
    return false;
  }
}

// The listener layer registers here so it can resubscribe against the new db.
function setOnReinit(handler) {
  onReinit = handler;
}

function getDb() {
  return db;
}

function isConfigured() {
  return !!db;
}

module.exports = { initFirebase, reinitFirebase, setOnReinit, getDb, isConfigured };
