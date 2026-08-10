import {getApps, initializeApp} from 'firebase/app';
import {browserLocalPersistence, connectAuthEmulator, getAuth, setPersistence} from 'firebase/auth';
import {connectFirestoreEmulator, initializeFirestore, memoryLocalCache, persistentLocalCache} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '',
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const useFirebaseEmulators = import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true';
const appCheckSiteKey = import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY;
let appCheckPromise: Promise<import('firebase/app-check').AppCheck | null> | null = null;

export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence);

export const db = initializeFirestore(app, {
  localCache: useFirebaseEmulators ? memoryLocalCache() : persistentLocalCache()
});

if (useFirebaseEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9199', {disableWarnings: true});
  connectFirestoreEmulator(db, '127.0.0.1', 8180);
}

async function loadAppCheck(): Promise<import('firebase/app-check').AppCheck | null> {
  if (!appCheckSiteKey) return null;
  if (appCheckPromise) return appCheckPromise;

  appCheckPromise = import('firebase/app-check').then(({initializeAppCheck, ReCaptchaEnterpriseProvider}) => {
    if (import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN) {
      (globalThis as typeof globalThis & {FIREBASE_APPCHECK_DEBUG_TOKEN?: string}).FIREBASE_APPCHECK_DEBUG_TOKEN =
        import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN;
    }

    return initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  });

  return appCheckPromise;
}

export async function getAppCheckHeaders(): Promise<Record<string, string>> {
  const appCheck = await loadAppCheck();
  if (!appCheck) return {};

  try {
    const {getToken} = await import('firebase/app-check');
    const {token} = await getToken(appCheck);
    return token ? {'X-Firebase-AppCheck': token} : {};
  } catch (error) {
    console.warn('Unable to get App Check token', error);
    return {};
  }
}

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
