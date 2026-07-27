// Data Sync — Writes activity data directly to Firebase Firestore
const { getDb } = require('../firebase');
const { getCurrentActivity, getAppUsageSummary } = require('../monitor/windowMonitor');

let syncInterval = null;
let snapshotCollectInterval = null;
let studentId = null;
let pendingSnapshots = [];

// Firestore imports (loaded dynamically)
let firestoreModule = null;

async function getFirestore() {
  if (!firestoreModule) {
    firestoreModule = require('firebase/firestore');
  }
  return firestoreModule;
}

function setupDataSync(store) {
  studentId = store.get('studentId');
  const intervalMin = store.get('syncInterval') || 5;

  // Sync to Firebase every N minutes
  syncInterval = setInterval(() => {
    syncToFirebase(store);
  }, intervalMin * 60 * 1000);

  // Collect snapshots every 30 seconds
  snapshotCollectInterval = setInterval(() => {
    collectSnapshot(store);
  }, 30000);

  console.log(`🔄 Data sync started (Firebase, every ${intervalMin} min)`);
}

function collectSnapshot(store) {
  const activity = getCurrentActivity();
  if (!activity || !activity.timestamp) return;

  const studyState = store.get('studyState') || {};

  pendingSnapshots.push({
    timestamp: activity.timestamp,
    activeApp: activity.activeApp,
    activeTitle: activity.activeTitle,
    openWindows: JSON.stringify(activity.openWindows || []),
    totalWindows: activity.totalWindows,
    totalTabs: activity.totalTabs,
    isStudying: studyState.isStudying || false,
    isIdle: studyState.isIdle || false,
  });

  // Keep max 100 pending
  if (pendingSnapshots.length > 100) {
    pendingSnapshots = pendingSnapshots.slice(-100);
  }
}

async function syncToFirebase(store) {
  const db = getDb();
  if (!db || !studentId || pendingSnapshots.length === 0) return;

  try {
    const { collection, doc, setDoc, updateDoc } = await getFirestore();
    const snapshotsToSend = [...pendingSnapshots];

    // Write each snapshot to Firestore
    for (const snap of snapshotsToSend) {
      const snapId = `${studentId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await setDoc(doc(db, 'gfy_activity', snapId), {
        studentId,
        ...snap,
      });
    }

    // Update student document with latest state
    await updateDoc(doc(db, 'gfy_students', studentId), {
      lastSeen: new Date().toISOString(),
      isOnline: true,
      status: store.get('studyState')?.isStudying ? 'studying' : 'online',
    }).catch(() => {
      // Student doc might not exist yet in update mode, use setDoc merge
      setDoc(doc(db, 'gfy_students', studentId), {
        lastSeen: new Date().toISOString(),
        isOnline: true,
      }, { merge: true });
    });

    // Update app usage aggregations
    const appUsage = getAppUsageSummary();
    const today = new Date().toISOString().split('T')[0];

    for (const usage of appUsage) {
      if (usage.openSeconds > 0 || usage.activeSeconds > 0) {
        const usageId = `${studentId}_${today}_${usage.appName.replace(/[^a-zA-Z0-9]/g, '_')}`;
        await setDoc(doc(db, 'gfy_app_usage', usageId), {
          studentId,
          date: today,
          appName: usage.appName,
          windowTitle: usage.windowTitle || '',
          totalOpenSeconds: usage.openSeconds,
          totalActiveSeconds: usage.activeSeconds,
          lastSeen: new Date().toISOString(),
        }, { merge: true });
      }
    }

    // Clear sent snapshots
    pendingSnapshots = pendingSnapshots.slice(snapshotsToSend.length);
    console.log(`📤 Synced ${snapshotsToSend.length} snapshots to Firebase`);
  } catch (error) {
    console.error('Firebase sync error:', error.message);
    // Keep snapshots for retry
  }
}

function stopDataSync() {
  if (syncInterval) { clearInterval(syncInterval); syncInterval = null; }
  if (snapshotCollectInterval) { clearInterval(snapshotCollectInterval); snapshotCollectInterval = null; }
}

async function forceSyncNow(store) {
  collectSnapshot(store);
  await syncToFirebase(store);
}

module.exports = { setupDataSync, stopDataSync, forceSyncNow };
