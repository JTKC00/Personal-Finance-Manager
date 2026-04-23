import {getApps, initializeApp} from 'firebase/app';
import {browserLocalPersistence, getAuth, setPersistence} from 'firebase/auth';
import {initializeFirestore, persistentLocalCache} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '',
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence);

export const db = initializeFirestore(app, {
  localCache: persistentLocalCache()
});

/** Returns the current user's uid, or throws if not authenticated. */
export function getUid(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not authenticated');
  return uid;
}

/** Strip undefined/function fields before writing to Firestore. */
export function clean<T extends object>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}
