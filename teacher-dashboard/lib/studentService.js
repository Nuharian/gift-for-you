// Student service — Firestore operations for student data
import { db } from './firebase';
import {
  collection, doc, getDocs, getDoc, setDoc, updateDoc,
  onSnapshot, query, orderBy, where, serverTimestamp,
} from 'firebase/firestore';

const STUDENTS_COLLECTION = 'gfy_students';

// Get all students
export async function getAllStudents() {
  if (!db) return [];
  try {
    const snapshot = await getDocs(
      query(collection(db, STUDENTS_COLLECTION), orderBy('registeredAt', 'desc'))
    );
    return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (error) {
    console.error('Error fetching students:', error);
    return [];
  }
}

// Subscribe to students in real-time
export function subscribeToStudents(callback) {
  if (!db) return () => {};
  const q = query(collection(db, STUDENTS_COLLECTION), orderBy('registeredAt', 'desc'));
  return onSnapshot(q, (snapshot) => {
    const students = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(students);
  });
}

// Get a single student
export async function getStudent(studentId) {
  if (!db) return null;
  try {
    const docRef = doc(db, STUDENTS_COLLECTION, studentId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) return { id: docSnap.id, ...docSnap.data() };
    return null;
  } catch (error) {
    console.error('Error fetching student:', error);
    return null;
  }
}

// Subscribe to a single student's live data
export function subscribeToStudent(studentId, callback) {
  if (!db) return () => {};
  return onSnapshot(doc(db, STUDENTS_COLLECTION, studentId), (docSnap) => {
    if (docSnap.exists()) {
      callback({ id: docSnap.id, ...docSnap.data() });
    }
  });
}
