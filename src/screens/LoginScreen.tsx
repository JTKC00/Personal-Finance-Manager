import {useState} from 'react';
import {useAuth} from '../contexts/AuthContext';
import styles from './LoginScreen.module.css';

function validatePasswordStrength(pw: string): string {
  if (pw.length < 8) return '密碼最少 8 個字元';
  if (!/[A-Z]/.test(pw)) return '密碼須包含至少一個大寫英文字母';
  if (!/[a-z]/.test(pw)) return '密碼須包含至少一個小寫英文字母';
  if (!/[0-9]/.test(pw)) return '密碼須包含至少一個數字';
  return '';
}

export function LoginScreen() {
  const {signIn, signUp, signInWithGoogle, sendPasswordReset} = useAuth();
  const [tab, setTab] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resetMode, setResetMode] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError('請填寫電郵和密碼');
      return;
    }
    if (tab === 'signUp') {
      const pwErr = validatePasswordStrength(password);
      if (pwErr) { setError(pwErr); return; }
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

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    if (!resetEmail.trim()) { setError('請輸入電郵地址'); return; }
    setLoading(true);
    setError('');
    try {
      await sendPasswordReset(resetEmail.trim());
      setResetSent(true);
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

        {resetMode ? (
          /* ── 忘記密碼面板 ── */
          <div className={styles.form}>
            {resetSent ? (
              <>
                <p className={styles.resetSuccess}>✅ 重設連結已發送至 {resetEmail}，請檢查收件箱（包括垃圾郵件）。</p>
                <button type="button" className={styles.button} onClick={() => { setResetMode(false); setResetSent(false); setResetEmail(''); setError(''); }}>返回登入</button>
              </>
            ) : (
              <form onSubmit={handleReset} className={styles.form}>
                <p className={styles.resetHint}>輸入你的電郵地址，我們會發送密碼重設連結。</p>
                <input
                  autoCapitalize="none"
                  autoComplete="email"
                  type="email"
                  placeholder="電郵地址"
                  className={styles.input}
                  value={resetEmail}
                  onChange={e => setResetEmail(e.target.value)}
                />
                {error ? <p className={styles.error}>{error}</p> : null}
                <button type="submit" disabled={loading} className={styles.button}>
                  {loading ? <span className={styles.spinner} /> : '發送重設連結'}
                </button>
                <button type="button" className={styles.linkBtn} onClick={() => { setResetMode(false); setError(''); }}>返回登入</button>
              </form>
            )}
          </div>
        ) : (
          /* ── 正常登入 / 註冊 ── */
          <>
            <div className={styles.tabs}>
              <button type="button" onClick={() => { setTab('signIn'); setError(''); }} className={[styles.tab, tab === 'signIn' ? styles.tabActive : ''].join(' ')}>登入</button>
              <button type="button" onClick={() => { setTab('signUp'); setError(''); }} className={[styles.tab, tab === 'signUp' ? styles.tabActive : ''].join(' ')}>建立帳號</button>
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
              <div>
                <input
                  autoCapitalize="none"
                  type="password"
                  placeholder={tab === 'signUp' ? '密碼（最少 8 位，含大小寫及數字）' : '密碼'}
                  autoComplete={tab === 'signIn' ? 'current-password' : 'new-password'}
                  className={styles.input}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                />
                {tab === 'signIn' ? (
                  <button type="button" className={styles.forgotBtn} onClick={() => { setResetMode(true); setResetEmail(email.trim()); setError(''); }}>忘記密碼？</button>
                ) : (
                  <p className={styles.pwHint}>需包含大寫、小寫英文字母及數字，最少 8 位。</p>
                )}
              </div>
              {error ? <p className={styles.error}>{error}</p> : null}
              <button type="submit" disabled={loading} className={styles.button}>
                {loading ? <span className={styles.spinner} /> : (tab === 'signIn' ? '登入' : '建立帳號')}
              </button>
            </form>

            {/* 分隔線 */}
            <div style={{display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0'}}>
              <div style={{flex: 1, height: 1, background: 'var(--color-border)'}} />
              <span style={{fontSize: 12, color: '#999'}}>或</span>
              <div style={{flex: 1, height: 1, background: 'var(--color-border)'}} />
            </div>

            {/* Google 登入按鈕 */}
            <button
              type="button"
              onClick={async () => {
                setLoading(true);
                setError('');
                try {
                  await signInWithGoogle();
                } catch (err: unknown) {
                  const msg = err instanceof Error ? err.message : String(err);
                  setError(translateFirebaseError(msg));
                } finally {
                  setLoading(false);
                }
              }}
              disabled={loading}
              style={{display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '12px', border: '1px solid var(--color-border)', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: 15, fontWeight: 500}}
            >
              <svg width="18" height="18" viewBox="0 0 48 48">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              </svg>
              以 Google 帳號繼續
            </button>
          </>
        )}

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
