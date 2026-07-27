// Firebase Listener — Replaces Socket.io for real-time teacher messages
// Uses Firestore onSnapshot to listen for new messages
const { getDb } = require('../firebase');

let unsubscribeMessages = null;
let lastMessageTimestamp = null;

async function setupFirebaseListeners(studentId, mainWindow) {
  const db = getDb();
  if (!db || !studentId) {
    console.warn('Firebase not ready for listeners');
    return;
  }

  const {
    collection, query, where, orderBy, onSnapshot, limit,
  } = require('firebase/firestore');

  // Listen for new messages from teacher
  const messagesQuery = query(
    collection(db, 'gfy_messages'),
    where('studentId', '==', studentId),
    where('isRead', '==', false),
    orderBy('sentAt', 'desc'),
    limit(10)
  );

  unsubscribeMessages = onSnapshot(messagesQuery, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        const message = { id: change.doc.id, ...change.doc.data() };

        // Only show popup for genuinely new messages (after init)
        if (lastMessageTimestamp && message.sentAt > lastMessageTimestamp) {
          console.log('💬 New teacher message:', message.title);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('message:new', message);

            // For urgent messages, bring window to front
            if (message.priority === 'urgent') {
              mainWindow.show();
              mainWindow.focus();
            }
          }
        }
      }
    });

    // Update the timestamp after processing
    if (!snapshot.empty) {
      const latest = snapshot.docs[0].data();
      lastMessageTimestamp = latest.sentAt;
    } else if (!lastMessageTimestamp) {
      lastMessageTimestamp = new Date().toISOString();
    }
  }, (error) => {
    console.error('Message listener error:', error);
  });

  // Set initial timestamp
  lastMessageTimestamp = new Date().toISOString();

  // Notify renderer that we're connected
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('connection:status', { connected: true });
  }

  console.log('🔌 Firebase real-time listeners active');
}

function stopFirebaseListeners() {
  if (unsubscribeMessages) {
    unsubscribeMessages();
    unsubscribeMessages = null;
  }
}

module.exports = { setupFirebaseListeners, stopFirebaseListeners };
