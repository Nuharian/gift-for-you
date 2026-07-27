// Messaging service — Firestore operations for teacher ↔ student messages
import { db } from './firebase';
import {
  collection, doc, getDocs, getDoc, setDoc, deleteDoc,
  onSnapshot, query, orderBy, where, updateDoc,
} from 'firebase/firestore';

const MESSAGES_COLLECTION = 'gfy_messages';

function generateId() {
  return 'msg_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

// Send a message to a student
export async function sendMessage(studentId, message) {
  if (!db) return null;
  try {
    const id = generateId();
    const newMsg = {
      id,
      studentId,
      title: message.title || '',
      body: message.body || '',
      emoji: message.emoji || '💛',
      color: message.color || '#FFE5D9',
      priority: message.priority || 'normal',
      sentAt: new Date().toISOString(),
      readAt: null,
      isRead: false,
    };
    await setDoc(doc(db, MESSAGES_COLLECTION, id), newMsg);
    return newMsg;
  } catch (error) {
    console.error('Error sending message:', error);
    return null;
  }
}

// Send a message to ALL students
export async function broadcastMessage(studentIds, message) {
  if (!db) return 0;
  try {
    let count = 0;
    for (const studentId of studentIds) {
      await sendMessage(studentId, message);
      count++;
    }
    return count;
  } catch (error) {
    console.error('Error broadcasting:', error);
    return 0;
  }
}

// Get messages for a student
export async function getMessages(studentId) {
  if (!db) return [];
  try {
    const q = query(
      collection(db, MESSAGES_COLLECTION),
      where('studentId', '==', studentId),
      orderBy('sentAt', 'desc')
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (error) {
    console.error('Error fetching messages:', error);
    return [];
  }
}

// Subscribe to messages for a student (real-time)
export function subscribeToMessages(studentId, callback) {
  if (!db) return () => {};
  const q = query(
    collection(db, MESSAGES_COLLECTION),
    where('studentId', '==', studentId),
    orderBy('sentAt', 'desc')
  );
  return onSnapshot(q, (snapshot) => {
    const messages = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(messages);
  });
}

// Mark message as read
export async function markAsRead(messageId) {
  if (!db) return;
  try {
    await updateDoc(doc(db, MESSAGES_COLLECTION, messageId), {
      isRead: true,
      readAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error marking message as read:', error);
  }
}

// Delete a message
export async function deleteMessage(messageId) {
  if (!db) return;
  try {
    await deleteDoc(doc(db, MESSAGES_COLLECTION, messageId));
  } catch (error) {
    console.error('Error deleting message:', error);
  }
}

// Get all messages (for teacher view)
export async function getAllMessages() {
  if (!db) return [];
  try {
    const q = query(
      collection(db, MESSAGES_COLLECTION),
      orderBy('sentAt', 'desc')
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (error) {
    console.error('Error fetching all messages:', error);
    return [];
  }
}

// Get unread count for a student
export async function getUnreadCount(studentId) {
  if (!db) return 0;
  try {
    const q = query(
      collection(db, MESSAGES_COLLECTION),
      where('studentId', '==', studentId),
      where('isRead', '==', false)
    );
    const snapshot = await getDocs(q);
    return snapshot.size;
  } catch (error) {
    return 0;
  }
}
