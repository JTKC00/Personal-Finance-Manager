import {useCallback, useEffect, useState} from 'react';
import {Card} from '../components/Card';
import {Screen} from '../components/Screen';
import {useAuth} from '../contexts/AuthContext';
import {clearGeminiApiKey, loadGeminiApiKey, saveGeminiApiKey} from '../services/secrets';
import styles from './ProfileScreen.module.css';

const STEPS = [
  {num: '1', title: '打開 Google AI Studio', desc: '點下方按鈕，或在瀏覽器輸入 aistudio.google.com'},
  {num: '2', title: '登入 Google 帳號', desc: '用平時用的 Gmail 帳號登入即可，不需要信用卡。'},
  {num: '3', title: '點「Get API key」', desc: '在頁面左側邊欄或首頁找到「Get API key」按鈕，點進去。'},
  {num: '4', title: '建立新 Key', desc: '點「Create API key」，選擇任意 Google Cloud 專案（或讓系統自動建立一個），再點「Create」。'},
  {num: '5', title: '複製 Key', desc: '畫面會顯示一串以「AIza」開頭的金鑰，點「複製」圖示。'},
  {num: '6', title: '貼到下方輸入欄', desc: '回到這個 App，把剛才複製的 Key 貼到「Gemini API Key」欄位，按「儲存 Key」。'},
];

export function ProfileScreen() {
  const {user, signOut} = useAuth();
  const [keyInput, setKeyInput] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [toast, setToast] = useState('');

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }

  const refreshKeyState = useCallback(async () => {
    const key = await loadGeminiApiKey();
    setHasKey(Boolean(key));
    setKeyInput('');
  }, []);

  useEffect(() => { refreshKeyState(); }, [refreshKeyState]);

  async function handleSignOut() {
    if (!window.confirm('確定要登出嗎？')) return;
    await signOut();
  }

  async function saveKey() {
    const key = keyInput.trim();
    if (!key) {
      showToast('請輸入 Gemini API Key');
      return;
    }
    await saveGeminiApiKey(key);
    setHasKey(true);
    setKeyInput('');
    showToast('Gemini API Key 已安全儲存在本機。');
  }

  async function clearKey() {
    await clearGeminiApiKey();
    setHasKey(false);
    setKeyInput('');
    showToast('本機 Gemini API Key 已清除。');
  }

  return (
    <Screen title="我的帳戶" subtitle="帳號、Gemini Key 與設定">
      <Card title="帳號">
        <p className={styles.body}>目前登入：{user?.email}</p>
        <button className={styles.dangerBtn} onClick={handleSignOut}>登出</button>
      </Card>

      <Card title="如何取得免費 Gemini API Key？">
        <p className={styles.body}>
          OCR 功能使用 Google Gemini AI，需要一個免費的 API Key。申請只需 2 分鐘，完全免費，有免費使用額度。
        </p>
        <button className={styles.tutorialToggle} onClick={() => setTutorialOpen(v => !v)}>
          {tutorialOpen ? '▲ 收起教學' : '▼ 展開步驟教學'}
        </button>
        {tutorialOpen ? (
          <div className={styles.steps}>
            {STEPS.map(step => (
              <div key={step.num} className={styles.stepRow}>
                <span className={styles.stepBadge}>{step.num}</span>
                <div className={styles.stepContent}>
                  <strong className={styles.stepTitle}>{step.title}</strong>
                  <p className={styles.stepDesc}>{step.desc}</p>
                </div>
              </div>
            ))}
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.linkBtn}
            >
              🔗 前往 Google AI Studio 申請 Key
            </a>
            <p className={styles.freeNote}>
              ✅ 免費方案每天可使用 1,500 次 Gemini Flash 請求，個人日常記帳完全夠用。
            </p>
          </div>
        ) : null}
      </Card>

      <Card title="Gemini API Key">
        <p className={styles.body}>
          取得 Key 後，貼到下方儲存。Key 會存在你的瀏覽器本機；掃描收據時，App 會把 Key 傳到你設定的 OCR 代理服務用來呼叫 Gemini。
        </p>
        <p className={styles.status}>{hasKey ? '狀態：已設定本機 Key ✓' : '狀態：尚未設定本機 Key'}</p>
        <input
          autoCapitalize="none"
          autoCorrect="off"
          type="password"
          onChange={e => setKeyInput(e.target.value)}
          placeholder="貼上自己的 Gemini API Key"
          className={styles.input}
          value={keyInput}
        />
        <div className={styles.actionRow}>
          <button className={styles.primaryBtn} onClick={saveKey}>儲存 Key</button>
          <button className={styles.secondaryBtn} onClick={clearKey}>清除 Key</button>
        </div>
      </Card>

      <Card title="資料與報表">
        <p className={styles.body}>MVP 會先提供本月 CSV 匯出、每日記帳次數、OCR 成功率與人工修正率。</p>
      </Card>

      {toast ? <div className={styles.toast}>{toast}</div> : null}
    </Screen>
  );
}
