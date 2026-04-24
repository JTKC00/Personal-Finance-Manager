import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useLocation, useNavigate} from 'react-router-dom';
import {Card} from '../components/Card';
import {Screen} from '../components/Screen';
import {expenseCategories, incomeCategories, paymentMethods} from '../constants/categories';
import {OcrUsageStatus, loadOcrUsageStatus, scanReceipt} from '../services/ocr';
import {loadGeminiApiKey} from '../services/secrets';
import {
  loadGoals,
  saveTransactionWithGoalLink,
  trackEvent,
  upsertReceipt,
} from '../services/storage';
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

type PrefillTransaction = Pick<Transaction, 'type' | 'amount' | 'category' | 'note' | 'paymentMethod' | 'goalId'>;

type TransactionLocationState = {
  prefillTransaction?: PrefillTransaction;
};

const formatDate = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const today = () => formatDate(new Date());

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
  const location = useLocation();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [scanning, setScanning] = useState(false);
  const [ocrPreview, setOcrPreview] = useState<OcrResult | null>(null);
  const [ocrUsage, setOcrUsage] = useState<OcrUsageStatus | null>(null);
  const [toast, setToast] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canSave = useMemo(() => Number(draft.amount) > 0 && Boolean(draft.date), [draft.amount, draft.date]);

  const refreshGoals = useCallback(async () => {
    setGoals(await loadGoals());
  }, []);

  useEffect(() => { refreshGoals(); }, [refreshGoals]);

  const refreshOcrUsage = useCallback(async () => {
    try {
      setOcrUsage(await loadOcrUsageStatus());
    } catch {
      setOcrUsage(null);
    }
  }, []);

  useEffect(() => { refreshOcrUsage(); }, [refreshOcrUsage]);

  useEffect(() => {
    const state = location.state as TransactionLocationState | null;
    const prefillTransaction = state?.prefillTransaction;
    if (!prefillTransaction) return;

    setDraft({
      type: prefillTransaction.type,
      amount: String(prefillTransaction.amount),
      category: prefillTransaction.category,
      note: prefillTransaction.note || '',
      date: today(),
      paymentMethod: prefillTransaction.paymentMethod || paymentMethods[0],
      goalId: prefillTransaction.type === 'expense' ? (prefillTransaction.goalId || '') : ''
    });
    setOcrPreview(null);
    navigate(location.pathname, {replace: true, state: null});
  }, [location.pathname, location.state, navigate]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }

  function updateDraft(patch: Partial<Draft>) {
    setDraft(current => ({...current, ...patch}));
  }

  function resetForm() {
    setDraft(emptyDraft());
    setOcrPreview(null);
  }

  async function save() {
    const value = Number(draft.amount);
    if (!value || !draft.date) {
      showToast('金額與日期為必填。');
      return;
    }

    const transaction: Transaction = {
      id: Date.now().toString(),
      type: draft.type,
      amount: value,
      currency: 'HKD',
      date: draft.date,
      category: draft.category,
      goalId: draft.type === 'expense' ? (draft.goalId || undefined) : undefined,
      paymentMethod: draft.paymentMethod,
      note: draft.note,
      createdAt: new Date().toISOString()
    };

    const syncedTransaction = await saveTransactionWithGoalLink(transaction);
    await trackEvent('save_transaction_success', {
      source: ocrPreview ? 'ocr' : 'manual',
      category: draft.category,
      goalId: syncedTransaction.goalId || null
    });
    await refreshGoals();
    resetForm();
    showToast('交易已儲存。');
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
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
      setOcrPreview(result);
      await upsertReceipt({
        id, imageUri: filename, status: 'done', amount: result.amount,
        category: result.category, note: result.note, date: result.date,
        lowFields, needsConfirm: true, createdAt: new Date().toISOString()
      });
      await refreshOcrUsage();
      await trackEvent(lowFields.length ? 'ocr_scan_fail' : 'ocr_scan_success', {lowFields});
    } catch (error) {
      await upsertReceipt({
        id, imageUri: filename, status: 'failed',
        lowFields: ['amount', 'category', 'date'], needsConfirm: true, createdAt: new Date().toISOString()
      });
      const errMsg = error instanceof Error ? error.message : 'unknown';
      await trackEvent('ocr_scan_fail', {reason: errMsg});
      const needsKey = /key is required|api key/i.test(errMsg);
      await refreshOcrUsage();
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
    <Screen title="記帳" subtitle="拍照 OCR 或快速新增一筆交易">
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
            disabled={scanning || ocrUsage?.remaining === 0}
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
            disabled={scanning || ocrUsage?.remaining === 0}
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
        {ocrUsage ? (
          <p className={styles.hint}>
            今日 OCR 剩餘 {ocrUsage.remaining} 次（個人 {ocrUsage.userRemaining}/{ocrUsage.userLimit}，全站 {ocrUsage.globalRemaining}/{ocrUsage.globalLimit}）。
          </p>
        ) : null}
        {ocrPreview ? <p className={styles.hint}>已預填 OCR 結果，請確認後儲存。</p> : null}
      </Card>

      <Card title="快速新增">
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

        {goals.length > 0 && draft.type === 'expense' ? (
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
            新增
          </button>
        </div>
      </Card>

      {toast ? <div className={styles.toast}>{toast}</div> : null}
    </Screen>
  );
}
