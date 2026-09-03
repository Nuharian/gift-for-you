// Firebase client initialization for the Teacher Dashboard.
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

// A Firebase web config is not a secret (access is governed by security rules),
// and the same values are already compiled into the student app. Keeping a
// fallback here means a deploy that is missing its env vars still works instead
// of rendering an empty dashboard with no explanation.
const FALLBACK_CONFIG = {
  apiKey: 'AIzaSyA4DGA-jHP-OF-TAHKxjsvP5kHxqIu8dPY',
  authDomain: 'zahra-s-space.firebaseapp.com',
  projectId: 'zahra-s-space',
  storageBucket: 'zahra-s-space.firebasestorage.app',
  messagingSenderId: '1086414376413',
  appId: '1:1086414376413:web:32b5cdd29a87cad39d3a34',
};

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || FALLBACK_CONFIG.apiKey,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || FALLBACK_CONFIG.authDomain,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || FALLBACK_CONFIG.projectId,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || FALLBACK_CONFIG.storageBucket,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || FALLBACK_CONFIG.messagingSenderId,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || FALLBACK_CONFIG.appId,
};

export const isFirebaseConfigured = () => !!(firebaseConfig.apiKey && firebaseConfig.projectId);

let app;
let db;

if (isFirebaseConfigured()) {
  try {
    app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    db = getFirestore(app);
  } catch (error) {
    console.error('Firebase initialization failed:', error);
  }
} else {
  console.warn('Firebase not configured. Set NEXT_PUBLIC_FIREBASE_* env vars.');
}

export { app, db };
