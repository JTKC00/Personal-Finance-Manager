import {useCallback, useEffect, useMemo, useState} from 'react';
import {Pencil, Trash2, Pause, Play} from 'lucide-react';
import {Card} from '../components/Card';
import {Screen} from '../components/Screen';
import {expenseCategories, paymentMethods} from '../constants/categories';
import {
  deleteSubscription,
  getCurrentMonthKey,
  getSubscriptionChargesForMonth,
  getTransactionsByMonth,
  loadBudgetRows,
  loadSubscriptions,
  processDueSubscriptions,
  trackEvent,
  upsertSubscription,
} from '../services/storage';
import {Budget, Subscription, SubscriptionFrequency, Transaction} from '../types/finance';
import styles from './TransactionScreen.module.css';

type Draft = {
  name: string;
  amount: string;
  category: string;
  paymentMethod: string;
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

const formatMoney = (value: number) => `$${Math.round(value).toLocaleString()}`;
const today = () => new Date().toISOString().slice(0, 10);

function emptyDraft(): Draft {
  return {
    name: '',
    amount: '',
    category: expenseCategories[0],
    paymentMethod: paymentMethods[0],
    frequency: 'monthly',
    nextBillingDate: today(),
    trialEndDate: '',
    reminderDays: '7',
    note: '',
  };
}

function getDaysUntil(dateKey: string): number {
  const start = new Date(today());
  const end = new Date(dateKey);
  return Math.ceil((end.getTime() - start.getTime()) / 86400000);
}

export function SubscriptionsScreen() {
  const month = getCurrentMonthKey();
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const created = await processDueSubscriptions();
    const [nextSubscriptions, nextTransactions, nextBudgets] = await Promise.all([
      loadSubscriptions(),
      getTransactionsByMonth(month),
      loadBudgetRows(),
    ]);
    setSubscriptions(nextSubscriptions.sort((a, b) => a.nextBillingDate.localeCompare(b.nextBillingDate)));
    setTransactions(nextTransactions);
    setBudgets(nextBudgets);
    if (created > 0) showToast(`已自動補記 ${created} 筆訂閱支出。`);
  }, [month]);

  useEffect(() => { refresh(); }, [refresh]);

  const canSave = useMemo(
    () => Boolean(draft.name.trim()) && Number(draft.amount) > 0 && Boolean(draft.nextBillingDate),
    [draft.amount, draft.name, draft.nextBillingDate]
  );

  const activeSubscriptions = subscriptions.filter(item => item.active);
  const postedSubscriptionTotal = transactions
    .filter(item => item.subscriptionId && item.type === 'expense')
    .reduce((sum, item) => sum + item.amount, 0);
  const upcomingCharges = getSubscriptionChargesForMonth(
    subscriptions,
    month,
    transactions,
    today(),
    true
  );
  const monthlySubscriptionTotal = postedSubscriptionTotal + upcomingCharges.reduce((sum, item) => sum + item.amount, 0);
  const trialAlerts = activeSubscriptions
    .filter(item => item.trialEndDate)
    .map(item => ({subscription: item, days: getDaysUntil(item.trialEndDate as string)}))
    .filter(item => item.days >= 0 && item.days <= item.subscription.reminderDays)
    .sort((a, b) => a.days - b.days);

  const categoryReserved = upcomingCharges.reduce<Record<string, number>>((map, item) => {
    map[item.subscription.category] = (map[item.subscription.category] || 0) + item.amount;
    return map;
  }, {});
  const categorySpent = transactions
    .filter(item => item.type === 'expense')
    .reduce<Record<string, number>>((map, item) => {
      map[item.category] = (map[item.category] || 0) + item.amount;
      return map;
    }, {});

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
      showToast('名稱、金額與下次扣款日為必填。');
      return;
    }
    const existing = editingId ? subscriptions.find(item => item.id === editingId) : undefined;
    const subscription: Subscription = {
      id: editingId || Date.now().toString(),
      name: draft.name.trim(),
      amount: Number(draft.amount),
      currency: existing?.currency || 'HKD',
      category: draft.category,
      paymentMethod: draft.paymentMethod,
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
      paymentMethod: subscription.paymentMethod,
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

  return (
    <Screen title="訂閱" subtitle="定期支出、試用提醒與本月預留">
      <div className={styles.summaryGrid}>
        <div className={styles.summaryBox}>
          <span className={styles.summaryLabel}>本月訂閱</span>
          <span className={styles.summaryValue}>{formatMoney(monthlySubscriptionTotal)}</span>
        </div>
        <div className={styles.summaryBox}>
          <span className={styles.summaryLabel}>啟用項目</span>
          <span className={styles.summaryValue}>{activeSubscriptions.length}</span>
        </div>
      </div>

      <Card title={editingId ? '編輯訂閱' : '新增訂閱'}>
        <input
          autoFocus
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
        <div className={styles.chips}>
          {paymentMethods.map(item => (
            <button
              key={item}
              type="button"
              onClick={() => updateDraft({paymentMethod: item})}
              className={[styles.chip, draft.paymentMethod === item ? styles.activeChip : ''].join(' ')}
            >
              {item}
            </button>
          ))}
        </div>

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

      <Card title="即將扣款">
        {upcomingCharges.length ? upcomingCharges.slice(0, 6).map(item => (
          <div key={`${item.subscription.id}-${item.date}`} className={styles.txRow}>
            <div className={styles.txMain}>
              <span className={styles.txTitle}>{item.subscription.name}</span>
              <span className={styles.txMeta}>{item.date} · {item.subscription.category} · {item.subscription.paymentMethod}</span>
            </div>
            <span className={styles.expenseText}>-{formatMoney(item.amount)}</span>
          </div>
        )) : (
          <p className={styles.hint}>本月沒有尚未扣款的訂閱。</p>
        )}
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

      <Card title="分類預算佔用">
        {budgets.length ? budgets.map(budget => {
          const spent = categorySpent[budget.category] || 0;
          const reserved = categoryReserved[budget.category] || 0;
          const projected = spent + reserved;
          const ratio = budget.amount > 0 ? Math.min(projected / budget.amount, 1) : 0;
          return (
            <div key={budget.category} className={styles.budgetRow}>
              <div className={styles.budgetHeader}>
                <span className={styles.txTitle}>{budget.category}</span>
                <span className={styles.txMeta}>
                  已用 {formatMoney(spent)} · 預留 {formatMoney(reserved)} / {formatMoney(budget.amount)}
                </span>
              </div>
              <div className={styles.progressTrackThin}>
                <div className={styles.progressFill} style={{width: `${ratio * 100}%`}} />
              </div>
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
                {frequencyLabels[subscription.frequency]} · 下次 {subscription.nextBillingDate} · {subscription.category}
              </span>
              {subscription.note ? <span className={styles.goalMeta}>{subscription.note}</span> : null}
            </div>
              <div className={styles.txActions}>
              <span className={styles.expenseText}>-{formatMoney(subscription.amount)}</span>
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
