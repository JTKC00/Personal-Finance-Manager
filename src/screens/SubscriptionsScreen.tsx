import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Pencil, Trash2, Pause, Play} from 'lucide-react';
import {Card} from '../components/Card';
import {Screen} from '../components/Screen';
import {PaymentInstrumentField} from '../components/PaymentInstrumentField';
import {MonthlyCommitments} from '../components/MonthlyCommitments';
import {useLocalToday} from '../hooks/useLocalToday';
import {expenseCategories} from '../constants/categories';
import {useSubscriptionProcessing} from '../contexts/SubscriptionProcessingContext';
import {paymentTypeFromMethod, subscriptionPaymentFromDraft, subscriptionPaymentLabel} from '../services/paymentInstrument';
import {
  deleteSubscription,
  getTransactionsByMonth,
  loadAccounts,
  loadBudgetRowsForMonth,
  loadPaymentInstruments,
  loadSubscriptions,
  trackEvent,
  upsertPaymentInstrument,
  upsertSubscription,
} from '../services/storage';
import {formatDateKey, normalizeCurrency} from '../services/financeLogic';
import {buildMonthlyBudgetRows, buildMonthlySpending} from '../services/monthlySpending';
import {
  Account, Budget, PaymentInstrument, PaymentInstrumentType, Subscription, SubscriptionFrequency, Transaction,
} from '../types/finance';
import styles from './TransactionScreen.module.css';

type Draft = {
  name: string;
  amount: string;
  category: string;
  paymentType: PaymentInstrumentType | '';
  paymentInstrumentId?: string;
  frequency: SubscriptionFrequency;
  nextBillingDate: string;
  trialEndDate: string;
  reminderDays: string;
  note: string;
};

const frequencyLabels: Record<SubscriptionFrequency, string> = {
  weekly: '每週',
  monthly: '每月',
  quarterly: '每季',
  yearly: '每年',
};

const formatMoney = (value: number, currency = 'HKD') => `${normalizeCurrency(currency)} ${value.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

function emptyDraft(): Draft {
  return {
    name: '',
    amount: '',
    category: expenseCategories[0],
    paymentType: 'credit_card',
    paymentInstrumentId: undefined,
    frequency: 'monthly',
    nextBillingDate: formatDateKey(new Date()),
    trialEndDate: '',
    reminderDays: '7',
    note: '',
  };
}

function getDaysUntil(dateKey: string, today: string): number {
  const start = new Date(today);
  const end = new Date(dateKey);
  return Math.ceil((end.getTime() - start.getTime()) / 86400000);
}

export function SubscriptionsScreen() {
  const today = useLocalToday();
  const month = today.slice(0, 7);
  const {retry: processSubscriptions} = useSubscriptionProcessing();
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [instruments, setInstruments] = useState<PaymentInstrument[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loadedMonth, setLoadedMonth] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const request = useRef(0);
  const nameInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const version = ++request.current;
    setLoading(true);
    setLoadError('');
    try {
      const created = await processSubscriptions().catch(() => 0);
      const [nextSubscriptions, nextTransactions, nextBudgets, nextInstruments, nextAccounts] = await Promise.all([
        loadSubscriptions(), getTransactionsByMonth(month), loadBudgetRowsForMonth(month), loadPaymentInstruments(), loadAccounts(),
      ]);
      if (request.current !== version) return;
      setSubscriptions(nextSubscriptions.sort((a, b) => a.nextBillingDate.localeCompare(b.nextBillingDate)));
      setTransactions(nextTransactions);
      setBudgets(nextBudgets || []);
      setInstruments(nextInstruments);
      setAccounts(nextAccounts);
      setLoadedMonth(month);
      if (created > 0) showToast(`已自動補記 ${created} 筆訂閱支出。`);
    } catch {
      if (request.current === version) setLoadError('訂閱及預算未能更新，請重試。已有資料會保留。');
    } finally {
      if (request.current === version) setLoading(false);
    }
  }, [month, processSubscriptions]);

  useEffect(() => { void refresh(); return () => { request.current++; }; }, [refresh]);
  useEffect(() => { if (editingId) nameInput.current?.focus(); }, [editingId]);

  const canSave = useMemo(
    () => Boolean(draft.name.trim()) && Number(draft.amount) > 0 && Boolean(draft.nextBillingDate) && Boolean(draft.paymentType),
    [draft.amount, draft.name, draft.nextBillingDate, draft.paymentType]
  );

  const activeSubscriptions = subscriptions.filter(item => item.active);
  const spending = useMemo(() => buildMonthlySpending({month, today, transactions, subscriptions}), [month, today, transactions, subscriptions]);
  const categoryBudgets = buildMonthlyBudgetRows(budgets, spending);
  const trialAlerts = activeSubscriptions
    .filter(item => item.trialEndDate)
    .map(item => ({subscription: item, days: getDaysUntil(item.trialEndDate as string, today)}))
    .filter(item => item.days >= 0 && item.days <= item.subscription.reminderDays)
    .sort((a, b) => a.days - b.days);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(''), 2500);
  }

  function updateDraft(patch: Partial<Draft>) {
    setDraft(current => ({...current, ...patch}));
  }

  function resetForm() {
    setDraft(emptyDraft());
    setEditingId(null);
  }

  async function save() {
    if (!canSave) {
      showToast('名稱、金額、付款方式與下次扣款日為必填。');
      return;
    }
    if (!draft.paymentType) {
      showToast('名稱、金額、付款方式與下次扣款日為必填。');
      return;
    }
    const payment = subscriptionPaymentFromDraft(draft.paymentType, draft.paymentInstrumentId);
    if (!payment) {
      showToast('名稱、金額、付款方式與下次扣款日為必填。');
      return;
    }
    const existing = editingId ? subscriptions.find(item => item.id === editingId) : undefined;
    const subscription: Subscription = {
      id: editingId || Date.now().toString(),
      name: draft.name.trim(),
      amount: Number(draft.amount),
      currency: existing?.currency || 'HKD',
      category: draft.category,
      paymentMethod: payment.paymentMethod,
      paymentInstrumentId: payment.paymentInstrumentId,
      frequency: draft.frequency,
      nextBillingDate: draft.nextBillingDate,
      trialEndDate: draft.trialEndDate || undefined,
      reminderDays: Math.max(0, Number(draft.reminderDays) || 0),
      active: existing?.active ?? true,
      lastPostedDate: existing?.lastPostedDate,
      note: draft.note.trim() || undefined,
      createdAt: existing?.createdAt || new Date().toISOString(),
    };
    await upsertSubscription(subscription);
    await trackEvent(editingId ? 'edit_subscription_success' : 'save_subscription_success', {
      category: subscription.category,
      frequency: subscription.frequency,
    });
    await refresh();
    resetForm();
    showToast(editingId ? '訂閱已更新。' : '訂閱已新增。');
  }

  function startEdit(subscription: Subscription) {
    setEditingId(subscription.id);
    setDraft({
      name: subscription.name,
      amount: String(subscription.amount),
      category: subscription.category,
      paymentType: instruments.find(item => item.id === subscription.paymentInstrumentId)?.type
        || paymentTypeFromMethod(subscription.paymentMethod)
        || '',
      paymentInstrumentId: subscription.paymentInstrumentId,
      frequency: subscription.frequency,
      nextBillingDate: subscription.nextBillingDate,
      trialEndDate: subscription.trialEndDate || '',
      reminderDays: String(subscription.reminderDays ?? 7),
      note: subscription.note || '',
    });
  }

  async function toggleActive(subscription: Subscription) {
    await upsertSubscription({...subscription, active: !subscription.active});
    await trackEvent(subscription.active ? 'pause_subscription_success' : 'resume_subscription_success', {
      subscriptionId: subscription.id,
    });
    await refresh();
    showToast(subscription.active ? '訂閱已停用。' : '訂閱已啟用。');
  }

  async function confirmDelete(subscription: Subscription) {
    await deleteSubscription(subscription.id);
    await trackEvent('delete_subscription_success', {subscriptionId: subscription.id});
    if (editingId === subscription.id) resetForm();
    setConfirmDeleteId(null);
    await refresh();
    showToast('訂閱已刪除。');
  }

  if (loadedMonth !== month) return <Screen title="訂閱" subtitle={`${month} · 訂閱與預算`}>
    <p role={loadError ? 'alert' : 'status'}>{loadError || '正在載入訂閱與本月收支…'}</p>
    {loadError && <button className={styles.secondaryBtn} onClick={() => void refresh()}>重試載入</button>}
  </Screen>;

  return (
    <Screen title="訂閱" subtitle={`${month} · 實際支出截至 ${today}`}>
      {loadError && <div role="alert"><p className={styles.warningText}>{loadError}</p><button className={styles.secondaryBtn} disabled={loading} onClick={() => void refresh()}>重試載入</button></div>}
      <p className={styles.hint}>啟用 {activeSubscriptions.length} 個訂閱。各幣別分開統計，不作匯率換算。</p>
      {spending.byCurrency.map(row => <Card key={row.currency} title={`本月訂閱 · ${row.currency}`}>
        <div className={styles.summaryGrid}>
          <div className={styles.summaryBox}><span className={styles.summaryLabel}>已花費</span><span className={styles.summaryValue}>{formatMoney(row.actualSubscriptionExpense, row.currency)}</span></div>
          <div className={styles.summaryBox}><span className={styles.summaryLabel}>已預填未來訂閱</span><span className={styles.summaryValue}>{formatMoney(row.futureSubscriptionExpense, row.currency)}</span></div>
          <div className={styles.summaryBox}><span className={styles.summaryLabel}>待扣訂閱</span><span className={styles.summaryValue}>{formatMoney(row.pendingSubscriptionExpense ?? 0, row.currency)}</span></div>
          <div className={styles.summaryBox}><span className={styles.summaryLabel}>已知訂閱支出合計</span><span className={styles.summaryValue}>{formatMoney(row.knownSubscriptionExpense ?? 0, row.currency)}</span></div>
        </div>
      </Card>)}
      <MonthlyCommitments spending={spending} budgets={budgets} />

      <Card title={editingId ? '編輯訂閱' : '新增訂閱'}>
        <p className={styles.hint}>金額幣別：{normalizeCurrency(subscriptions.find(s => s.id === editingId)?.currency || 'HKD')}</p>
        <input
          ref={nameInput}
          type="text"
          placeholder="訂閱名稱（如 Netflix）"
          className={styles.input}
          value={draft.name}
          onChange={e => updateDraft({name: e.target.value})}
        />
        <input
          type="number"
          inputMode="decimal"
          placeholder="金額"
          className={styles.input}
          value={draft.amount}
          onChange={e => updateDraft({amount: e.target.value})}
        />
        <input
          type="text"
          placeholder="備註（選填）"
          className={styles.input}
          value={draft.note}
          onChange={e => updateDraft({note: e.target.value})}
        />

        <p className={styles.sectionLabel}>週期</p>
        <div className={styles.chips}>
          {(Object.keys(frequencyLabels) as SubscriptionFrequency[]).map(item => (
            <button
              key={item}
              type="button"
              onClick={() => updateDraft({frequency: item})}
              className={[styles.chip, draft.frequency === item ? styles.activeChip : ''].join(' ')}
            >
              {frequencyLabels[item]}
            </button>
          ))}
        </div>

        <p className={styles.sectionLabel}>分類</p>
        <div className={styles.chips}>
          {expenseCategories.map(item => (
            <button
              key={item}
              type="button"
              onClick={() => updateDraft({category: item})}
              className={[styles.chip, draft.category === item ? styles.activeChip : ''].join(' ')}
            >
              {item}
            </button>
          ))}
        </div>

        <p className={styles.sectionLabel}>付款方式</p>
        <PaymentInstrumentField
          instruments={instruments}
          accounts={accounts}
          type={draft.paymentType}
          instrumentId={draft.paymentInstrumentId}
          onChange={next => updateDraft({paymentType: next.type, paymentInstrumentId: next.instrumentId})}
          onCreate={async instrument => {
            await upsertPaymentInstrument(instrument);
            setInstruments(current => [...current.filter(item => item.id !== instrument.id), instrument]);
          }}
        />

        <label className={styles.fieldLabel}>下次扣款日</label>
        <input
          type="date"
          className={styles.input}
          value={draft.nextBillingDate}
          onChange={e => updateDraft({nextBillingDate: e.target.value})}
        />
        <label className={styles.fieldLabel}>試用結束日（選填）</label>
        <input
          type="date"
          className={styles.input}
          value={draft.trialEndDate}
          onChange={e => updateDraft({trialEndDate: e.target.value})}
        />
        <input
          type="number"
          inputMode="numeric"
          placeholder="試用提醒天數"
          className={styles.input}
          value={draft.reminderDays}
          onChange={e => updateDraft({reminderDays: e.target.value})}
        />

        <div className={styles.actionRow}>
          <button
            disabled={!canSave}
            className={[styles.primaryBtn, !canSave ? styles.disabledBtn : ''].join(' ')}
            onClick={save}
          >
            {editingId ? '儲存變更' : '新增訂閱'}
          </button>
          {editingId ? <button className={styles.secondaryBtn} onClick={resetForm}>取消</button> : null}
        </div>
      </Card>

      <Card title="試用提醒">
        {trialAlerts.length ? trialAlerts.map(item => (
          <div key={item.subscription.id} className={styles.txRow}>
            <div className={styles.txMain}>
              <span className={styles.txTitle}>{item.subscription.name}</span>
              <span className={styles.txMeta}>
                {item.subscription.trialEndDate} 試用結束 · {item.days === 0 ? '今日到期' : `${item.days} 日後`}
              </span>
            </div>
            <span className={styles.warningText}>提醒</span>
          </div>
        )) : (
          <p className={styles.hint}>暫無即將結束的試用。</p>
        )}
      </Card>

      <Card title="分類預算 · HKD">
        <p className={styles.hint}>已花費包含本月截至今天的全部港幣支出，與總覽及月度分析一致。</p>
        {categoryBudgets.length ? categoryBudgets.map(budget => {
          return (
            <div key={budget.category} className={styles.budgetRow}>
              <div className={styles.budgetHeader}>
                <span className={styles.txTitle}>{budget.category}</span>
                <span className={styles.txMeta}>
                  已花費 {formatMoney(budget.spent)} / {formatMoney(budget.budgetAmount)} · 已用 {budget.usedPercentage}%
                </span>
              </div>
              <div className={styles.progressTrackThin} role="progressbar" aria-label={`${budget.category}預算使用率 ${budget.usedPercentage}%`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(budget.usedPercentage, 100)}>
                <div className={styles.progressFill} style={{width: `${Math.min(budget.usedRatio, 1) * 100}%`}} />
              </div>
              <p className={styles.hint}>未來交易 {formatMoney(budget.future)} · 待扣訂閱 {formatMoney(budget.pending ?? 0)} · {budget.projectedRemaining !== null && (budget.projectedRemaining >= 0 ? `預計剩餘 ${formatMoney(budget.projectedRemaining)}` : `預計超支 ${formatMoney(Math.abs(budget.projectedRemaining))}`)}</p>
            </div>
          );
        }) : (
          <p className={styles.hint}>尚未設定月預算。到「我的帳戶」設定後，這裡會顯示訂閱佔用比例。</p>
        )}
      </Card>

      <Card title="所有訂閱">
        {subscriptions.length ? subscriptions.map(subscription => (
          <div key={subscription.id} className={styles.txRow}>
            <div className={styles.txMain}>
              <span className={styles.txTitle}>
                {subscription.name} {!subscription.active ? '（已停用）' : ''}
              </span>
              <span className={styles.txMeta}>
                {frequencyLabels[subscription.frequency]} · 下次 {subscription.nextBillingDate} · {subscription.category} · {subscriptionPaymentLabel(subscription, instruments)}
              </span>
              {subscription.note ? <span className={styles.goalMeta}>{subscription.note}</span> : null}
            </div>
              <div className={styles.txActions}>
              <span className={styles.expenseText}>-{formatMoney(subscription.amount, subscription.currency)}</span>
              {confirmDeleteId === subscription.id ? (
                <div className={styles.confirmRow}>
                  <span className={styles.confirmText}>確定刪除？</span>
                  <button className={styles.confirmYes} onClick={() => confirmDelete(subscription)}>確定</button>
                  <button className={styles.confirmNo} onClick={() => setConfirmDeleteId(null)}>取消</button>
                </div>
              ) : (
                <div className={styles.actionRow}>
                  <button className={styles.iconBtn} title="編輯" onClick={() => startEdit(subscription)}><Pencil size={15} /></button>
                  <button className={styles.iconBtn} title={subscription.active ? '停用' : '啟用'} onClick={() => toggleActive(subscription)}>
                    {subscription.active ? <Pause size={15} /> : <Play size={15} />}
                  </button>
                  <button className={styles.iconBtnDanger} title="刪除" onClick={() => setConfirmDeleteId(subscription.id)}><Trash2 size={15} /></button>
                </div>
              )}
            </div>
          </div>
        )) : (
          <div className={styles.emptyState}>
            <span className={styles.emptyIcon}>🔄</span>
            <p className={styles.emptyTitle}>尚未新增訂閱</p>
            <p className={styles.hint}>在上方表單新增第一個定期支出，App 會自動追蹤每月扣款。</p>
          </div>
        )}
      </Card>

      {toast ? <div className={styles.toast}>{toast}</div> : null}
    </Screen>
  );
}
