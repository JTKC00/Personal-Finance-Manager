import {useCallback, useEffect, useRef, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {Card} from '../components/Card';
import {Screen} from '../components/Screen';
import {useAuth} from '../contexts/AuthContext';
import {expenseCategories} from '../constants/categories';
import {isAuthFlowCancelled, translateFirebaseAuthError} from '../services/authErrors';
import {ThemeMode, applyThemeMode, getStoredThemeMode} from '../services/appearance';
import {daysSinceBackup, getLastBackupAt, markBackupDone} from '../services/backupReminder';
import {getCurrentMonthKey, loadAccounts, loadAllBudgetMonths, loadBudgetMonth, loadBudgets, loadGoals, loadReceipts, loadSubscriptions, loadTransactions, loadTransfers, saveCurrentMonthBudgets} from '../services/storage';
import {Receipt} from '../types/finance';
import styles from './ProfileScreen.module.css';

function validatePasswordStrength(pw: string): string {
  if (pw.length < 8) return '密碼最少 8 個字元';
  if (!/[A-Z]/.test(pw)) return '密碼須包含至少一個大寫英文字母';
  if (!/[a-z]/.test(pw)) return '密碼須包含至少一個小寫英文字母';
  if (!/[0-9]/.test(pw)) return '密碼須包含至少一個數字';
  return '';
}

export function ProfileScreen() {
  const navigate = useNavigate();
  const {user, signOut, linkGoogle, changePassword, authError, clearAuthError} = useAuth();
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getStoredThemeMode());
  const [budgetEdits, setBudgetEdits] = useState<Record<string, string>>(() =>
    Object.fromEntries(expenseCategories.map(c => [c, '']))
  );
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [receiptsOpen, setReceiptsOpen] = useState(false);
  const [linkingGoogle, setLinkingGoogle] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [toast, setToast] = useState('');
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(() => getLastBackupAt());
  const handledAuthErrorRef = useRef('');

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }

  const refreshBudgets = useCallback(async () => {
    const data = (await loadBudgetMonth(getCurrentMonthKey())) ?? {};
    setBudgetEdits(Object.fromEntries(
      expenseCategories.map(c => [c, data[c] ? String(data[c]) : ''])
    ));
  }, []);

  useEffect(() => { refreshBudgets(); }, [refreshBudgets]);

  useEffect(() => {
    if (!authError || authError === handledAuthErrorRef.current) return;

    handledAuthErrorRef.current = authError;

    if (!isAuthFlowCancelled(authError)) {
      showToast(translateFirebaseAuthError(authError));
    }

    clearAuthError();
  }, [authError, clearAuthError]);

  async function loadReceiptHistory() {
    const data = await loadReceipts();
    setReceipts(data.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }

  async function handleSignOut() {
    if (!window.confirm('確定要登出嗎？')) return;
    await signOut();
  }

  function changeThemeMode(mode: ThemeMode) {
    applyThemeMode(mode);
    setThemeMode(mode);
    showToast(mode === 'dark' ? '已切換至黑色模式。' : '已切換至白色模式。');
  }

  async function saveBudgets() {
    setBudgetSaving(true);
    try {
      const data: Record<string, number> = {};
      for (const cat of expenseCategories) {
        const val = Number(budgetEdits[cat]);
        if (val > 0) data[cat] = val;
      }
      await saveCurrentMonthBudgets(data);
      showToast('月預算已儲存。');
    } catch {
      showToast('儲存失敗，請檢查網路後再試一次。');
    } finally {
      setBudgetSaving(false);
    }
  }

  async function exportCsv() {
    const [all, subscriptions] = await Promise.all([loadTransactions(), loadSubscriptions()]);
    const subscriptionMap = Object.fromEntries(subscriptions.map(item => [item.id, item.name]));
    all.sort((a, b) => a.date.localeCompare(b.date));
    const header = ['日期', '類型', '金額', '分類', '備註', '付款方式', '訂閱'];
    const rows = all.map(t => [
      t.date,
      t.type === 'income' ? '收入' : '支出',
      t.amount,
      t.category,
      t.note || '',
      t.paymentMethod || '',
      t.subscriptionId ? (subscriptionMap[t.subscriptionId] || t.subscriptionId) : '',
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

  async function exportJsonBackup() {
    const [transactions, goals, budgets, receiptHistory, subscriptions, accounts, transfers, budgetMonths] = await Promise.all([
      loadTransactions(),
      loadGoals(),
      loadBudgets(),
      loadReceipts(),
      loadSubscriptions(),
      loadAccounts(),
      loadTransfers(),
      loadAllBudgetMonths()
    ]);
    const exportedAt = new Date().toISOString();
    const backup = {
      version: 4,
      exportedAt,
      userEmail: user?.email || '',
      transactions: [...transactions].sort((a, b) => a.date.localeCompare(b.date)),
      goals: [...goals].sort((a, b) => a.name.localeCompare(b.name)),
      subscriptions: [...subscriptions].sort((a, b) => a.name.localeCompare(b.name)),
      budgets,
      budgetMonths,
      receipts: [...receiptHistory].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      accounts: [...accounts].sort((a, b) => a.name.localeCompare(b.name)),
      transfers: [...transfers].sort((a, b) => a.date.localeCompare(b.date))
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], {type: 'application/json;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `finance-backup-${exportedAt.slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    markBackupDone(exportedAt);
    setLastBackupAt(exportedAt);
    showToast('完整 JSON 備份已匯出。');
  }

  const hasGoogleLinked = user?.providerData.some(p => p.providerId === 'google.com') ?? false;
  const isEmailUser = user?.providerData.some(p => p.providerId === 'password') ?? false;
  const backupDays = daysSinceBackup(lastBackupAt);
  const backupStatusText = backupDays === null ? '從未備份' : backupDays === 0 ? '今天' : `${backupDays} 天前`;

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError('請填寫目前密碼、新密碼和確認密碼。');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('兩次輸入的新密碼不一致。');
      return;
    }
    if (currentPassword === newPassword) {
      setPasswordError('新密碼不能與目前密碼相同。');
      return;
    }

    const pwErr = validatePasswordStrength(newPassword);
    if (pwErr) {
      setPasswordError(pwErr);
      return;
    }

    setPasswordSaving(true);
    setPasswordError('');
    clearAuthError();
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      showToast('密碼已更新。');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setPasswordError(translateFirebaseAuthError(msg));
    } finally {
      setPasswordSaving(false);
    }
  }

  async function handleLinkGoogle() {
    setLinkingGoogle(true);
    clearAuthError();
    try {
      const method = await linkGoogle();
      if (method === 'popup') {
        showToast('Google 帳號已成功綁定。');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isAuthFlowCancelled(msg)) {
        // user cancelled, do nothing
      } else {
        showToast(translateFirebaseAuthError(msg));
      }
    } finally {
      setLinkingGoogle(false);
    }
  }

  return (
    <Screen title="我的帳戶" subtitle="帳號、密碼與設定">
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

      <Card title="快速導航">
        <button className={styles.navLinkBtn} onClick={() => navigate('/analysis')}>
          <span>📊 分析報表</span>
          <span className={styles.navLinkArrow}>›</span>
        </button>
        <button className={styles.navLinkBtn} onClick={() => navigate('/subscriptions')}>
          <span>🔄 訂閱管理</span>
          <span className={styles.navLinkArrow}>›</span>
        </button>
      </Card>

      <Card title="外觀">
        <p className={styles.body}>切換頁面黑白模式，設定會保存在這部裝置。</p>
        <div className={styles.themeToggle} role="group" aria-label="頁面黑白模式">
          <button
            type="button"
            className={[styles.themeOption, themeMode === 'light' ? styles.themeOptionActive : ''].join(' ')}
            onClick={() => changeThemeMode('light')}
          >
            白色
          </button>
          <button
            type="button"
            className={[styles.themeOption, themeMode === 'dark' ? styles.themeOptionActive : ''].join(' ')}
            onClick={() => changeThemeMode('dark')}
          >
            黑色
          </button>
        </div>
      </Card>

      {isEmailUser ? (
        <Card title="更改密碼">
          <form onSubmit={handleChangePassword}>
            <label className={styles.fieldLabel} htmlFor="current-password">目前密碼</label>
            <input
              id="current-password"
              autoComplete="current-password"
              type="password"
              className={styles.input}
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
            />
            <label className={styles.fieldLabel} htmlFor="new-password">新密碼</label>
            <input
              id="new-password"
              autoComplete="new-password"
              type="password"
              placeholder="最少 8 位，含大小寫及數字"
              className={styles.input}
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
            />
            <label className={styles.fieldLabel} htmlFor="confirm-password">確認新密碼</label>
            <input
              id="confirm-password"
              autoComplete="new-password"
              type="password"
              className={styles.input}
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
            />
            {passwordError ? <p className={styles.error}>{passwordError}</p> : null}
            <button
              type="submit"
              className={[styles.primaryBtn, passwordSaving ? styles.disabledBtn : ''].join(' ')}
              disabled={passwordSaving}
            >
              {passwordSaving ? '更新中…' : '更新密碼'}
            </button>
          </form>
        </Card>
      ) : (
        <Card title="密碼">
          <p className={styles.body}>此帳戶目前使用 Google 登入，密碼需在 Google 帳戶中管理。</p>
        </Card>
      )}

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
                  {r.amount ? <span className={styles.receiptAmt}>${r.amount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} · {r.category}</span> : null}
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

      <Card title="資料備份">
        <p className={styles.body}>匯出完整 JSON 備份，包含交易、目標、預算和 OCR 收據記錄。此功能只負責備份，不會匯入或覆蓋資料。</p>
        <p className={styles.status}>上次完整備份（此裝置）：{backupStatusText}</p>
        <button className={styles.primaryBtn} onClick={exportJsonBackup}>匯出完整 JSON 備份</button>
      </Card>

      <Card title="資料與報表">
        <p className={styles.body}>匯出全部交易成 CSV 檔案，可用 Excel 或 Google Sheets 開啟。</p>
        <button className={styles.primaryBtn} onClick={exportCsv}>匯出全部交易 CSV</button>
      </Card>

      {toast ? <div className={styles.toast}>{toast}</div> : null}
    </Screen>
  );
}
