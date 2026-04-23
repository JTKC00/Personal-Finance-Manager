import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Card} from '../components/Card';
import {Screen} from '../components/Screen';
import {expenseCategories, incomeCategories, paymentMethods} from '../constants/categories';
import {scanReceipt} from '../services/ocr';
import {loadGeminiApiKey} from '../services/secrets';
import {
  deleteTransactionWithGoalLink,
  getCurrentMonthKey,
  loadGoals,
  saveTransactionWithGoalLink,
  getTransactionsByMonth,
  trackEvent,
  upsertReceipt,
} from '../services/storage';

function shiftMonth(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split('-').map(Number);
  const d = new Date(year, month - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return `${year} 年 ${month} 月`;
}
import {Goal, OcrResult, Transaction} from '../types/finance';
import styles from './TransactionScreen.module.css';

type Draft = {
  type: 'income' | 'expense';
  amount: string;
  category: string;
  note: string;
  date: string;
  paymentMethod: string;
  goalId: string;
};

const formatDate = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};
const today = () => formatDate(new Date());
const formatMoney = (value: number) => `$${Math.round(value).toLocaleString()}`;
const emptyDraft = (): Draft => ({
  type: 'expense',
  amount: '',
  category: expenseCategories[0],
  note: '',
  date: today(),
  paymentMethod: paymentMethods[0],
  goalId: ''
});

export function TransactionScreen() {
  const currentMonth = getCurrentMonthKey();
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [ocrPreview, setOcrPreview] = useState<OcrResult | null>(null);
  const [toast, setToast] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canSave = useMemo(() => Number(draft.amount) > 0 && Boolean(draft.date), [draft.amount, draft.date]);

  const refreshScreen = useCallback(async () => {
    const [next, nextGoals] = await Promise.all([getTransactionsByMonth(selectedMonth), loadGoals()]);
    setTransactions(
      [...next].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    );
    setGoals(nextGoals);
  }, [selectedMonth]);

  useEffect(() => { refreshScreen(); }, [refreshScreen]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }

  function updateDraft(patch: Partial<Draft>) {
    setDraft(current => ({...current, ...patch}));
  }

  function resetForm() {
    setDraft(emptyDraft());
    setEditingId(null);
    setOcrPreview(null);
  }

  async function save() {
    const value = Number(draft.amount);
    if (!value || !draft.date) {
      showToast('金額與日期為必填。');
      return;
    }

    const existing = editingId ? transactions.find(item => item.id === editingId) : undefined;
    const transaction: Transaction = {
      id: editingId || Date.now().toString(),
      type: draft.type,
      amount: value,
      currency: existing?.currency || 'HKD',
      date: draft.date,
      category: draft.category,
      goalId: draft.type === 'expense' ? (draft.goalId || undefined) : undefined,
      linkedGoalEntryId: draft.type === 'expense' ? existing?.linkedGoalEntryId : undefined,
      paymentMethod: draft.paymentMethod,
      note: draft.note,
      createdAt: existing?.createdAt || new Date().toISOString()
    };

    const syncedTransaction = await saveTransactionWithGoalLink(transaction, existing);
    await trackEvent(editingId ? 'edit_transaction_success' : 'save_transaction_success', {
      source: ocrPreview ? 'ocr' : 'manual',
      category: draft.category,
      goalId: syncedTransaction.goalId || null
    });
    await refreshScreen();
    resetForm();
    showToast(editingId ? '交易已更新。' : '交易已儲存。');
  }

  function startEdit(transaction: Transaction) {
    setEditingId(transaction.id);
    setDraft({
      type: transaction.type,
      amount: String(transaction.amount),
      category: transaction.category,
      note: transaction.note || '',
      date: transaction.date,
      paymentMethod: transaction.paymentMethod || paymentMethods[0],
      goalId: transaction.goalId || ''
    });
    setOcrPreview(null);
  }

  async function confirmDelete(transaction: Transaction) {
    if (!window.confirm(`確定刪除「${transaction.note || transaction.category}」？`)) return;
    await deleteTransactionWithGoalLink(transaction);
    await trackEvent('delete_transaction_success', {category: transaction.category});
    if (editingId === transaction.id) resetForm();
    await refreshScreen();
    showToast('已刪除。');
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // reset input so same file can be re-selected
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const dataUrl = evt.target?.result as string;
      const base64 = dataUrl.split(',')[1];
      await runOcr(base64, file.type || 'image/jpeg', file.name);
    };
    reader.readAsDataURL(file);
  }

  async function runOcr(imageBase64: string, mimeType: string, filename: string) {
    const id = Date.now().toString();
    setScanning(true);
    await trackEvent('ocr_scan_start', {mimeType});
    await upsertReceipt({id, imageUri: filename, status: 'processing', createdAt: new Date().toISOString()});

    try {
      const geminiApiKey = await loadGeminiApiKey();
      const result = await scanReceipt(imageBase64, mimeType, geminiApiKey);
      const lowFields = [
        !result.amount ? 'amount' : '',
        !expenseCategories.includes(result.category) ? 'category' : '',
        !/^\d{4}-\d{2}-\d{2}$/.test(result.date) ? 'date' : ''
      ].filter(Boolean);

      updateDraft({
        type: 'expense',
        amount: result.amount ? String(result.amount) : '',
        category: expenseCategories.includes(result.category) ? result.category : '其他',
        note: result.note || '',
        date: /^\d{4}-\d{2}-\d{2}$/.test(result.date) ? result.date : today()
      });
      setEditingId(null);
      setOcrPreview(result);
      await upsertReceipt({
        id, imageUri: filename, status: 'done', amount: result.amount,
        category: result.category, note: result.note, date: result.date,
        lowFields, needsConfirm: true, createdAt: new Date().toISOString()
      });
      await trackEvent(lowFields.length ? 'ocr_scan_fail' : 'ocr_scan_success', {lowFields});
    } catch (error) {
      await upsertReceipt({
        id, imageUri: filename, status: 'failed',
        lowFields: ['amount', 'category', 'date'], needsConfirm: true, createdAt: new Date().toISOString()
      });
      const errMsg = error instanceof Error ? error.message : 'unknown';
      await trackEvent('ocr_scan_fail', {reason: errMsg});
      // 區分「需要輸入 Key」與其他連線/服務錯誤
      const needsKey = /key is required|api key/i.test(errMsg);
      showToast(
        needsKey
          ? '請先到「我的帳戶」輸入 Gemini API Key 後再試'
          : `OCR 服務連線失敗，請手動輸入（${errMsg}）`
      );
    } finally {
      setScanning(false);
    }
  }

  return (
    <Screen title="記帳" subtitle="快速新增、拍照 OCR、交易列表">
      <Card title="收據 OCR">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className={styles.hidden}
        />
        <div className={styles.actionRow}>
          <button
            disabled={scanning}
            className={styles.secondaryBtn}
            onClick={() => {
              if (fileInputRef.current) {
                fileInputRef.current.setAttribute('capture', 'environment');
                fileInputRef.current.click();
              }
            }}
          >
            拍照掃描
          </button>
          <button
            disabled={scanning}
            className={styles.secondaryBtn}
            onClick={() => {
              if (fileInputRef.current) {
                fileInputRef.current.removeAttribute('capture');
                fileInputRef.current.click();
              }
            }}
          >
            相簿選取
          </button>
        </div>
        {scanning ? <div className={styles.spinner} /> : null}
        {ocrPreview ? <p className={styles.hint}>已預填 OCR 結果，請確認後儲存。</p> : null}
      </Card>

      <Card title={editingId ? '編輯交易' : '快速新增'}>
        <p className={styles.sectionLabel}>類型</p>
        <div className={styles.chips}>
          <button
            type="button"
            onClick={() => updateDraft({type: 'expense', category: expenseCategories[0], goalId: ''})}
            className={[styles.chip, draft.type === 'expense' ? styles.activeChip : ''].join(' ')}
          >支出</button>
          <button
            type="button"
            onClick={() => updateDraft({type: 'income', category: incomeCategories[0], goalId: ''})}
            className={[styles.chip, draft.type === 'income' ? styles.activeChip : ''].join(' ')}
          >收入</button>
        </div>
        <input
          autoFocus
          type="number"
          inputMode="decimal"
          placeholder="金額"
          className={styles.input}
          value={draft.amount}
          onChange={e => updateDraft({amount: e.target.value})}
        />
        <input
          type="text"
          placeholder="備註或商戶"
          className={styles.input}
          value={draft.note}
          onChange={e => updateDraft({note: e.target.value})}
        />
        <input
          type="date"
          className={styles.input}
          value={draft.date}
          onChange={e => updateDraft({date: e.target.value})}
        />

        <p className={styles.sectionLabel}>分類</p>
        <div className={styles.chips}>
          {(draft.type === 'income' ? incomeCategories : expenseCategories).map(item => (
            <button
              key={item}
              type="button"
              onClick={() => updateDraft({category: item})}
              className={[styles.chip, item === draft.category ? styles.activeChip : ''].join(' ')}
            >
              {item}
            </button>
          ))}
        </div>

        <p className={styles.sectionLabel}>付款方式</p>
        <div className={styles.chips}>
          {paymentMethods.map(item => (
            <button
              key={item}
              type="button"
              onClick={() => updateDraft({paymentMethod: item})}
              className={[styles.chip, item === draft.paymentMethod ? styles.activeChip : ''].join(' ')}
            >
              {item}
            </button>
          ))}
        </div>

        {goals.length && draft.type === 'expense' ? (
          <>
            <p className={styles.sectionLabel}>由哪個 Goal 支付（選填）</p>
            <div className={styles.chips}>
              <button
                type="button"
                onClick={() => updateDraft({goalId: ''})}
                className={[styles.chip, !draft.goalId ? styles.activeChip : ''].join(' ')}
              >
                不指定
              </button>
              {goals.map(goal => (
                <button
                  key={goal.id}
                  type="button"
                  onClick={() => updateDraft({goalId: goal.id})}
                  className={[styles.chip, goal.id === draft.goalId ? styles.activeChip : ''].join(' ')}
                >
                  {goal.name}
                </button>
              ))}
            </div>
            <p className={styles.helperText}>如果指定 Goal，這筆支出會自動從該目標提取相同金額。</p>
          </>
        ) : null}

        <div className={styles.actionRow}>
          <button
            disabled={!canSave}
            className={[styles.primaryBtn, !canSave ? styles.disabledBtn : ''].join(' ')}
            onClick={save}
          >
            {editingId ? '儲存變更' : '新增'}
          </button>
          {editingId ? (
            <button className={styles.secondaryBtn} onClick={resetForm}>取消</button>
          ) : null}
        </div>
      </Card>

      <Card title="交易記錄">
        <div className={styles.monthNav}>
          <button
            className={styles.navBtn}
            onClick={() => setSelectedMonth(m => shiftMonth(m, -1))}
          >‹ 上月</button>
          <span className={styles.monthLabel}>{getMonthLabel(selectedMonth)}</span>
          <button
            className={styles.navBtn}
            disabled={selectedMonth >= currentMonth}
            onClick={() => setSelectedMonth(m => shiftMonth(m, 1))}
          >下月 ›</button>
        </div>
        {transactions.length ? transactions.map(t => (
          <div key={t.id} className={styles.txRow}>
            <div className={styles.txMain}>
              <span className={styles.txTitle}>{t.note || t.category}</span>
              <span className={styles.txMeta}>
                {t.date} · {t.category} · {t.paymentMethod || '未填付款方式'}
              </span>
              {t.goalId && t.type === 'expense' ? (
                <span className={styles.goalMeta}>
                  由 Goal 支付：{goals.find(g => g.id === t.goalId)?.name || '已刪除目標'}
                </span>
              ) : null}
            </div>
            <div className={styles.txActions}>
              <span className={t.type === 'income' ? styles.incomeText : styles.expenseText}>
                {t.type === 'income' ? '+' : '-'}{formatMoney(t.amount)}
              </span>
              <div className={styles.actionRow}>
                <button className={styles.textBtn} onClick={() => startEdit(t)}>編輯</button>
                <button className={[styles.textBtn, styles.deleteBtn].join(' ')} onClick={() => confirmDelete(t)}>刪除</button>
              </div>
            </div>
          </div>
        )) : (
          <p className={styles.hint}>本月尚無交易。</p>
        )}
      </Card>

      {toast ? <div className={styles.toast}>{toast}</div> : null}
    </Screen>
  );
}
