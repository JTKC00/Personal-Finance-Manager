import {useState} from 'react';
import {useAuth} from '../contexts/AuthContext';
import styles from './LoginScreen.module.css';

export function LoginScreen() {
  const {signIn, signUp} = useAuth();
  const [tab, setTab] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError('請填寫電郵和密碼');
      return;
    }
    setLoading(true);
    setError('');
    try {
      if (tab === 'signIn') {
        await signIn(email.trim(), password);
      } else {
        await signUp(email.trim(), password);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(translateFirebaseError(msg));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.inner}>
        <h1 className={styles.title}>個人財務管家</h1>
        <p className={styles.subtitle}>安全記錄每一筆收支{'\n'}財務自由從這裡開始</p>

        <div className={styles.tabs}>
          <button
            type="button"
            onClick={() => setTab('signIn')}
            className={[styles.tab, tab === 'signIn' ? styles.tabActive : ''].join(' ')}
          >
            登入
          </button>
          <button
            type="button"
            onClick={() => setTab('signUp')}
            className={[styles.tab, tab === 'signUp' ? styles.tabActive : ''].join(' ')}
          >
            建立帳號
          </button>
        </div>

        <form onSubmit={submit} className={styles.form}>
          <input
            autoCapitalize="none"
            autoComplete="email"
            type="email"
            placeholder="電郵地址"
            className={styles.input}
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
          <input
            autoCapitalize="none"
            type="password"
            placeholder="密碼（最少 6 位）"
            autoComplete={tab === 'signIn' ? 'current-password' : 'new-password'}
            className={styles.input}
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
          {error ? <p className={styles.error}>{error}</p> : null}
          <button type="submit" disabled={loading} className={styles.button}>
            {loading ? <span className={styles.spinner} /> : (tab === 'signIn' ? '登入' : '建立帳號')}
          </button>
        </form>

        <p className={styles.note}>你的記帳數據屬於你自己，{'\n'}不會與其他人共享。</p>
      </div>
    </div>
  );
}

function translateFirebaseError(msg: string): string {
  if (
    msg.includes('user-not-found') ||
    msg.includes('wrong-password') ||
    msg.includes('invalid-credential')
  ) {
    return '電郵或密碼不正確，請再試。';
  }
  if (msg.includes('email-already-in-use')) return '此電郵已被使用，請直接登入。';
  if (msg.includes('weak-password')) return '密碼太弱，請使用至少 6 個字元。';
  if (msg.includes('invalid-email')) return '電郵格式不正確。';
  if (msg.includes('network-request-failed')) return '網絡連線失敗，請檢查網絡。';
  return msg;
}
