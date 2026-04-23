import {useCallback, useEffect, useState} from 'react';
import {Card} from '../components/Card';
import {Screen} from '../components/Screen';
import {useAuth} from '../contexts/AuthContext';
import {expenseCategories} from '../constants/categories';
import {clearGeminiApiKey, loadGeminiApiKey, saveGeminiApiKey} from '../services/secrets';
import {loadBudgets, loadReceipts, loadTransactions, saveAllBudgets} from '../services/storage';
import {Receipt} from '../types/finance';
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
  const {user, signOut, linkGoogle} = useAuth();
  const [keyInput, setKeyInput] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [budgetEdits, setBudgetEdits] = useState<Record<string, string>>(() =>
    Object.fromEntries(expenseCategories.map(c => [c, '']))
  );
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [receiptsOpen, setReceiptsOpen] = useState(false);
  const [linkingGoogle, setLinkingGoogle] = useState(false);
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

  const refreshBudgets = useCallback(async () => {
    const data = await loadBudgets();
    setBudgetEdits(Object.fromEntries(
      expenseCategories.map(c => [c, data[c] ? String(data[c]) : ''])
    ));
  }, []);

  useEffect(() => { refreshKeyState(); refreshBudgets(); }, [refreshKeyState, refreshBudgets]);

  async function loadReceiptHistory() {
    const data = await loadReceipts();
    setReceipts(data.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }

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

  async function saveBudgets() {
    setBudgetSaving(true);
    try {
      const data: Record<string, number> = {};
      for (const cat of expenseCategories) {
        const val = Number(budgetEdits[cat]);
        if (val > 0) data[cat] = val;
      }
      await saveAllBudgets(data);
      showToast('月預算已儲存。');
    } finally {
      setBudgetSaving(false);
    }
  }

  async function exportCsv() {
    const all = await loadTransactions();
    all.sort((a, b) => a.date.localeCompare(b.date));
    const header = ['日期', '類型', '金額', '分類', '備註', '付款方式'];
    const rows = all.map(t => [
      t.date,
      t.type === 'income' ? '收入' : '支出',
      t.amount,
      t.category,
      t.note || '',
      t.paymentMethod || '',
    ]);
    const csv = [header, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['\uFEFF' + csv], {type: 'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `finance-export-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`已匯出 ${all.length} 筆交易。`);
  }

  const hasGoogleLinked = user?.providerData.some(p => p.providerId === 'google.com') ?? false;
  const isEmailUser = user?.providerData.some(p => p.providerId === 'password') ?? false;

  async function handleLinkGoogle() {
    setLinkingGoogle(true);
    try {
      await linkGoogle();
      showToast('Google 帳號已成功綁定！');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('credential-already-in-use') || msg.includes('already-in-use')) {
        showToast('此 Google 帳號已被其他帳戶使用。');
      } else if (msg.includes('popup-closed-by-user') || msg.includes('cancelled-popup-request')) {
        // user cancelled, do nothing
      } else {
        showToast('綁定失敗：' + msg);
      }
    } finally {
      setLinkingGoogle(false);
    }
  }

  return (
    <Screen title="我的帳戶" subtitle="帳號、Gemini Key 與設定">
      <Card title="帳號">
        <p className={styles.body}>目前登入：{user?.email}</p>
        {isEmailUser && !hasGoogleLinked ? (
          <>
            <p className={styles.body} style={{marginBottom: 8}}>綁定 Google 帳號後，可以同時用 Google 或電郵密碼登入，不怕忘記密碼。</p>
            <button
              className={styles.secondaryBtn}
              disabled={linkingGoogle}
              onClick={handleLinkGoogle}
            >{linkingGoogle ? '綁定中…' : '綁定 Google 帳號'}</button>
          </>
        ) : hasGoogleLinked ? (
          <p className={styles.body} style={{color: 'var(--color-success)', marginBottom: 8}}>✓ 已綁定 Google 帳號</p>
        ) : null}
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

      <Card title="月預算設定">
        <p className={styles.body}>設定每月各分類的預算，Dashboard 會顯示實際支出與預算的對比進度。</p>
        <div className={styles.budgetGrid}>
          {expenseCategories.map(cat => (
            <div key={cat} className={styles.budgetRow}>
              <label className={styles.budgetLabel}>{cat}</label>
              <input
                type="number"
                inputMode="decimal"
                placeholder="不限制"
                className={styles.budgetInput}
                value={budgetEdits[cat] ?? ''}
                onChange={e => setBudgetEdits(prev => ({...prev, [cat]: e.target.value}))}
              />
            </div>
          ))}
        </div>
        <button
          className={[styles.primaryBtn, budgetSaving ? styles.disabledBtn : ''].join(' ')}
          disabled={budgetSaving}
          onClick={saveBudgets}
        >{budgetSaving ? '儲存中…' : '儲存預算'}</button>
      </Card>

      <Card title="掃描收據記錄">
        <p className={styles.body}>所有 OCR 掃描收據的記錄，包含成功與失敗。</p>
        <button
          className={styles.secondaryBtn}
          onClick={async () => {
            if (!receiptsOpen) await loadReceiptHistory();
            setReceiptsOpen(v => !v);
          }}
        >{receiptsOpen ? '收起記錄' : '查看記錄'}</button>
        {receiptsOpen ? (
          <div className={styles.receiptList}>
            {receipts.length === 0 ? (
              <p className={styles.receiptEmpty}>尚無扫描記錄。</p>
            ) : receipts.map(r => (
              <div key={r.id} className={styles.receiptRow}>
                <div className={styles.receiptInfo}>
                  <span className={[
                    styles.receiptStatus,
                    r.status === 'done' ? styles.statusDone
                    : r.status === 'failed' ? styles.statusFailed
                    : styles.statusProcessing
                  ].join(' ')}>
                    {r.status === 'done' ? '成功' : r.status === 'failed' ? '失敗' : '處理中'}
                  </span>
                  <span className={styles.receiptName}>{r.imageUri || '未知檔案'}</span>
                  {r.amount ? <span className={styles.receiptAmt}>${r.amount.toLocaleString()} · {r.category}</span> : null}
                  <span className={styles.receiptDate}>{r.createdAt.slice(0, 10)}</span>
                </div>
                {(r.lowFields || []).length > 0 ? (
                  <span className={styles.lowFieldsBadge}>低信心：{(r.lowFields || []).join('、')}</span>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      <Card title="資料與報表">
        <p className={styles.body}>匯出全部交易成 CSV 檔案，可用 Excel 或 Google Sheets 開啟。</p>
        <button className={styles.primaryBtn} onClick={exportCsv}>匯出全部交易 CSV</button>
      </Card>

      {toast ? <div className={styles.toast}>{toast}</div> : null}
    </Screen>
  );
}
