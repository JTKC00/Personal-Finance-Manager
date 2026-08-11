import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useLocation, useNavigate} from 'react-router-dom';
import {Card} from '../components/Card';
import {Screen} from '../components/Screen';
import {expenseCategories, incomeCategories, paymentMethods} from '../constants/categories';
import {OcrScanResult, OcrUsageStatus, loadOcrUsageStatus, scanReceipt} from '../services/ocr';
import {
  buildOcrChangedFields,
  confidenceLabels,
  findReceiptDuplicates,
  getHighConfidencePaymentMethod,
  getReviewRequiredFields,
  paymentEvidenceLabels,
} from '../services/ocrLogic';
import {
  loadGoals,
  loadTransactions,
  saveTransactionWithGoalLink,
  trackEvent,
  upsertReceipt,
} from '../services/storage';
import {Goal, OcrConfidence, Receipt, ReceiptDuplicateCandidate, Transaction} from '../types/finance';
import styles from './TransactionScreen.module.css';

type Draft = {
  type: 'income' | 'expense';
  amount: string;
  category: string;
  merchant: string;
  note: string;
  date: string;
  paymentMethod: string;
  goalId: string;
};

type PrefillTransaction = Pick<Transaction, 'type' | 'amount' | 'category' | 'merchant' | 'note' | 'paymentMethod' | 'goalId'>;

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
  merchant: '',
  note: '',
  date: today(),
  paymentMethod: '',
  goalId: ''
});

type OcrSession = {
  receipt: Receipt;
  scan: OcrScanResult;
  duplicates: ReceiptDuplicateCandidate[];
  duplicateApproved: boolean;
};

function ConfidenceBadge({value}: {value: OcrConfidence}) {
  return <span className={`${styles.confidenceBadge} ${styles[`confidence${value}`]}`}>AI 信心：{confidenceLabels[value]}</span>;
}

export function TransactionScreen() {
  const location = useLocation();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [scanning, setScanning] = useState(false);
  const [ocrPreview, setOcrPreview] = useState<OcrSession | null>(null);
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
      merchant: prefillTransaction.merchant || '',
      note: prefillTransaction.note || '',
      date: today(),
      paymentMethod: prefillTransaction.paymentMethod || '',
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
    if (ocrPreview?.duplicates.length && !ocrPreview.duplicateApproved) {
      showToast('請先處理可能重複交易的提示。');
      return;
    }

    const transaction: Transaction = {
      id: Date.now().toString(),
      type: draft.type,
      amount: value,
      currency: 'HKD',
      date: draft.date,
      category: draft.category,
      merchant: draft.merchant.trim() || undefined,
      goalId: draft.type === 'expense' ? (draft.goalId || undefined) : undefined,
      paymentMethod: draft.paymentMethod || undefined,
      note: draft.note,
      receiptId: ocrPreview?.receipt.id,
      createdAt: new Date().toISOString()
    };

    const finalValues = {
      amount: value,
      merchant: draft.merchant.trim(),
      category: draft.category,
      note: draft.note,
      date: draft.date,
      paymentMethod: draft.paymentMethod,
    };
    const confirmedReceipt = ocrPreview ? {
      ...ocrPreview.receipt,
      review: {
        final: finalValues,
        changedFields: buildOcrChangedFields(ocrPreview.scan.result, finalValues),
        confirmedAt: new Date().toISOString(),
        duplicateDecision: ocrPreview.duplicates.length ? 'proceeded' as const : 'none' as const,
        duplicateTransactionIds: ocrPreview.duplicates.map(item => item.transactionId),
      },
    } : undefined;
    const syncedTransaction = await saveTransactionWithGoalLink(transaction, undefined, confirmedReceipt);
    await trackEvent('save_transaction_success', {
      source: ocrPreview ? 'ocr' : 'manual',
      category: draft.category,
      goalId: syncedTransaction.goalId || null,
      ocrChangedFieldCount: confirmedReceipt?.review?.changedFields.length || 0,
      duplicateOverride: confirmedReceipt?.review?.duplicateDecision === 'proceeded',
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
    const createdAt = new Date().toISOString();
    setScanning(true);
    await trackEvent('ocr_scan_start', {mimeType});
    await upsertReceipt({id, imageUri: filename, status: 'processing', createdAt});

    try {
      const scan = await scanReceipt(imageBase64, mimeType);
      const result = scan.result;
      const lowFields = getReviewRequiredFields(result);
      const suggestedPaymentMethod = getHighConfidencePaymentMethod(result);
      const duplicates = await findReceiptDuplicates(
        {amount: result.amount || 0, date: result.date || '', merchant: result.merchant || ''},
        await loadTransactions(),
      );

      updateDraft({
        type: 'expense',
        amount: result.amount ? String(result.amount) : '',
        category: expenseCategories.includes(result.category) ? result.category : '其他',
        merchant: result.merchant || '',
        note: result.note || '',
        date: result.date && /^\d{4}-\d{2}-\d{2}$/.test(result.date) ? result.date : '',
        paymentMethod: suggestedPaymentMethod,
      });
      const receipt: Receipt = {
        id, imageUri: filename, status: 'done', amount: result.amount ?? undefined,
        category: result.category, note: result.note, date: result.date || undefined,
        lowFields, needsConfirm: true, createdAt,
        ai: {
          rawJson: scan.rawJson,
          parsed: result,
          model: scan.model,
          promptVersion: scan.promptVersion,
          schemaVersion: scan.schemaVersion,
          completedAt: new Date().toISOString(),
        },
        duplicateCandidates: duplicates,
      };
      await upsertReceipt(receipt);
      setOcrPreview({receipt, scan, duplicates, duplicateApproved: false});
      await refreshOcrUsage();
      await trackEvent(lowFields.length ? 'ocr_scan_fail' : 'ocr_scan_success', {lowFields});
    } catch (error) {
      await upsertReceipt({
        id, imageUri: filename, status: 'failed',
        lowFields: ['amount', 'merchant', 'category', 'date', 'paymentMethod'], needsConfirm: true, createdAt
      });
      const errMsg = error instanceof Error ? error.message : 'unknown';
      await trackEvent('ocr_scan_fail', {reason: errMsg});
      await refreshOcrUsage();
      showToast(`OCR 服務連線失敗，請手動輸入（${errMsg}）`);
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
        {ocrPreview ? (
          <div className={styles.ocrPreview}>
            <strong>AI 初步結果（儲存前請確認）</strong>
            <div className={styles.ocrPreviewRow}>
              <span>金額：{ocrPreview.scan.result.amount ?? '未能辨識'}</span>
              <ConfidenceBadge value={ocrPreview.scan.result.modelConfidence.amount} />
            </div>
            <div className={styles.ocrPreviewRow}>
              <span>商戶：{ocrPreview.scan.result.merchant || '未能辨識'}</span>
              <ConfidenceBadge value={ocrPreview.scan.result.modelConfidence.merchant} />
            </div>
            <div className={styles.ocrPreviewRow}>
              <span>日期：{ocrPreview.scan.result.date || '未能辨識'}</span>
              <ConfidenceBadge value={ocrPreview.scan.result.modelConfidence.date} />
            </div>
            <div className={styles.ocrPreviewRow}>
              <span>分類：{ocrPreview.scan.result.category}</span>
              <ConfidenceBadge value={ocrPreview.scan.result.modelConfidence.category} />
            </div>
            {ocrPreview.scan.result.paymentMethodCandidates.length ? (
              <div className={styles.candidateList}>
                付款候選：{ocrPreview.scan.result.paymentMethodCandidates.map(candidate => (
                  <span key={candidate.method} className={styles.candidateChip}>
                    {candidate.method}（{paymentEvidenceLabels[candidate.evidence]}／{confidenceLabels[candidate.modelConfidence]}）
                  </span>
                ))}
              </div>
            ) : <span className={styles.hint}>未發現明確付款方式證據。</span>}
          </div>
        ) : null}
        {ocrPreview?.duplicates.length ? (
          <div className={styles.duplicateWarning}>
            <strong>可能重複交易</strong>
            <p>{ocrPreview.duplicates.map(item => `${item.risk === 'high' ? '高風險' : '可能'}：${item.reasons.join('、')}`).join('；')}</p>
            <div className={styles.actionRow}>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => window.open('/transactions', '_blank', 'noopener,noreferrer')}
              >查看原交易</button>
              <button type="button" className={styles.secondaryBtn} onClick={resetForm}>取消</button>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={() => setOcrPreview(current => current ? {...current, duplicateApproved: true} : current)}
              >仍然新增</button>
            </div>
            {ocrPreview.duplicateApproved ? <p className={styles.hint}>已確認仍然新增；系統會保留這次決定。</p> : null}
          </div>
        ) : null}
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
          placeholder="商戶名稱"
          className={styles.input}
          value={draft.merchant}
          onChange={e => updateDraft({merchant: e.target.value})}
        />
        <input
          type="text"
          placeholder="備註"
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
          <button
            type="button"
            onClick={() => updateDraft({paymentMethod: ''})}
            className={[styles.chip, !draft.paymentMethod ? styles.activeChip : ''].join(' ')}
          >未指定</button>
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
