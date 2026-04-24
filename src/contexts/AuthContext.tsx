import {createContext, useCallback, useContext, useEffect, useState} from 'react';
import {
  User,
  EmailAuthProvider,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getRedirectResult,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  linkWithPopup,
  linkWithRedirect,
  signOut as firebaseSignOut,
  updatePassword,
} from 'firebase/auth';
import {auth} from '../services/firebase';

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  authError: string;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  linkGoogle: () => Promise<'popup' | 'redirect'>;
  signOut: () => Promise<void>;
  clearAuthError: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function buildGoogleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({prompt: 'select_account'});
  return provider;
}

function prefersRedirectAuth(): boolean {
  if (typeof window === 'undefined') return false;

  const inStandaloneMode =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: minimal-ui)').matches ||
    ((window.navigator as Navigator & {standalone?: boolean}).standalone === true);

  const hasTouchScreen = navigator.maxTouchPoints > 0;
  const isSmallViewport = window.innerWidth <= 900;

  return inStandaloneMode || (hasTouchScreen && isSmallViewport);
}

function shouldFallbackToRedirect(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);

  return (
    msg.includes('popup-blocked') ||
    msg.includes('operation-not-supported-in-this-environment') ||
    msg.includes('web-storage-unsupported')
  );
}

export function AuthProvider({children}: {children: React.ReactNode}) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, u => {
      setUser(u);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    async function resumeRedirectAuth() {
      try {
        const result = await getRedirectResult(auth);
        if (result?.user) {
          setUser(result.user);
        }
        setAuthError('');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setAuthError(msg);
      } finally {
        setLoading(false);
      }
    }

    void resumeRedirectAuth();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    setAuthError('');
    await signInWithEmailAndPassword(auth, email, password);
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    setAuthError('');
    await createUserWithEmailAndPassword(auth, email, password);
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setAuthError('');
    const provider = buildGoogleProvider();

    if (prefersRedirectAuth()) {
      await signInWithRedirect(auth, provider);
      return;
    }

    try {
      await signInWithPopup(auth, provider);
    } catch (err: unknown) {
      if (!shouldFallbackToRedirect(err)) throw err;
      await signInWithRedirect(auth, provider);
    }
  }, []);

  const sendPasswordReset = useCallback(async (email: string) => {
    setAuthError('');
    await sendPasswordResetEmail(auth, email);
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const currentUser = auth.currentUser;
    if (!currentUser?.email) throw new Error('Not authenticated');

    setAuthError('');
    const credential = EmailAuthProvider.credential(currentUser.email, currentPassword);
    await reauthenticateWithCredential(currentUser, credential);
    await updatePassword(currentUser, newPassword);
  }, []);

  const linkGoogle = useCallback(async () => {
    if (!auth.currentUser) throw new Error('Not authenticated');
    setAuthError('');
    const provider = buildGoogleProvider();

    if (prefersRedirectAuth()) {
      await linkWithRedirect(auth.currentUser, provider);
      return 'redirect';
    }

    try {
      await linkWithPopup(auth.currentUser, provider);
      setUser(auth.currentUser);
      return 'popup';
    } catch (err: unknown) {
      if (!shouldFallbackToRedirect(err)) throw err;
      await linkWithRedirect(auth.currentUser, provider);
      return 'redirect';
    }
  }, []);

  const signOut = useCallback(async () => {
    setAuthError('');
    await firebaseSignOut(auth);
  }, []);

  const clearAuthError = useCallback(() => {
    setAuthError('');
  }, []);

  return (
    <AuthContext.Provider value={{user, loading, authError, signIn, signUp, signInWithGoogle, sendPasswordReset, changePassword, linkGoogle, signOut, clearAuthError}}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
