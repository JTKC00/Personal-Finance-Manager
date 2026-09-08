import {useCallback, useEffect, useMemo, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {Copy, Pencil, Trash2, Search} from 'lucide-react';
import {Card} from '../components/Card';
import {Screen} from '../components/Screen';
import {MerchantField} from '../components/MerchantField';
import {PaymentInstrumentField} from '../components/PaymentInstrumentField';
import {expenseCategories, incomeCategories} from '../constants/categories';
import {planMerchantSave, resolveTransactionMerchantDisplay} from '../services/merchantIdentity';
import {formatInstrumentLabel, paymentMethodFromType, paymentTypeFromMethod, resolveInstrumentAccount} from '../services/paymentInstrument';
import {
  deleteTransactionWithGoalLink,
  getCurrentMonthKey,
  getTransactionsByMonth,
  loadAccounts,
  loadGoals,
  loadMerchants,
  loadPaymentInstruments,
  loadSubscriptions,
  saveTransactionWithGoalLink,
  trackEvent,
  upsertMerchant,
  upsertPaymentInstrument,
} from '../services/storage';
import {Account, Goal, Merchant, PaymentInstrument, PaymentInstrumentType, Subscription, Transaction} from '../types/finance';
import styles from './TransactionScreen.module.css';

type Draft = {
  type: 'income' | 'expense';
  amount: string;
  category: string;
  merchant: string;
  merchantId?: string;
  createNewMerchant: boolean;
  note: string;
  date: string;
  paymentType: PaymentInstrumentType | '';
  paymentInstrumentId?: string;
  accountLinkChoice?: 'instrument' | 'keep';
  goalId: string;
};

type TransactionTypeFilter = 'all' | 'expense' | 'income';

function shiftMonth(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split('-').map(Number);
  const d = new Date(year, month - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return `${year} 年 ${month} 月`;
}

const formatMoney = (value: number) => `$${value.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

export function TransactionListScreen() {
  const navigate = useNavigate();
  const currentMonth = getCurrentMonthKey();
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [instruments, setInstruments] = useState<PaymentInstrument[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [searchText, setSearchText] = useState('');
  const [typeFilter, setTypeFilter] = useState<TransactionTypeFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [toast, setToast] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const canSave = useMemo(() => {
    return draft ? Number(draft.amount) > 0 && Boolean(draft.date) : false;
  }, [draft]);

  const refreshScreen = useCallback(async () => {
    const [next, nextGoals, nextSubscriptions, nextMerchants, nextInstruments, nextAccounts] = await Promise.all([
      getTransactionsByMonth(selectedMonth),
      loadGoals(),
      loadSubscriptions(),
      loadMerchants(),
      loadPaymentInstruments(),
      loadAccounts(),
    ]);
    setTransactions(
      [...next].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    );
    setGoals(nextGoals);
    setSubscriptions(nextSubscriptions);
    setMerchants(nextMerchants);
    setInstruments(nextInstruments);
    setAccounts(nextAccounts);
  }, [selectedMonth]);

  useEffect(() => { refreshScreen(); }, [refreshScreen]);

  const categoryOptions = useMemo(() => {
    const categorySet = new Set(transactions.map(item => item.category));
    const knownCategories = [...expenseCategories, ...incomeCategories];
    const orderedKnown = knownCategories.filter(item => categorySet.has(item));
    const customCategories = [...categorySet]
      .filter(item => !knownCategories.includes(item))
      .sort((a, b) => a.localeCompare(b));
    return [...orderedKnown, ...customCategories];
  }, [transactions]);

  useEffect(() => {
    if (categoryFilter !== 'all' && !categoryOptions.includes(categoryFilter)) {
      setCategoryFilter('all');
    }
  }, [categoryFilter, categoryOptions]);

  const filteredTransactions = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    return transactions.filter(item => {
      if (typeFilter !== 'all' && item.type !== typeFilter) return false;
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
      if (!query) return true;

      const searchableText = [
        item.merchant || '',
        item.merchantText || '',
        item.note || '',
        item.category,
        item.paymentMethod || '',
        String(item.amount),
        formatMoney(item.amount)
      ].join(' ').toLowerCase();
      return searchableText.includes(query);
    });
  }, [categoryFilter, searchText, transactions, typeFilter]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }

  function updateDraft(patch: Partial<Draft>) {
    setDraft(current => current ? ({...current, ...patch}) : current);
  }

  function resetEdit() {
    setDraft(null);
    setEditingTransaction(null);
  }

  function startEdit(transaction: Transaction) {
    setEditingTransaction(transaction);
    setDraft({
      type: transaction.type,
      amount: String(transaction.amount),
      category: transaction.category,
      merchant: transaction.merchantText || transaction.merchant || '',
      merchantId: transaction.merchantId,
      createNewMerchant: false,
      note: transaction.note || '',
      date: transaction.date,
      paymentType: instruments.find(item => item.id === transaction.paymentInstrumentId)?.type
        || paymentTypeFromMethod(transaction.paymentMethod)
        || '',
      paymentInstrumentId: transaction.paymentInstrumentId,
      goalId: transaction.goalId || ''
    });
  }

  function copyTransaction(transaction: Transaction) {
    navigate('/transaction', {
      state: {
        prefillTransaction: {
          type: transaction.type,
          amount: transaction.amount,
          category: transaction.category,
          merchant: transaction.merchantText || transaction.merchant || '',
          merchantId: transaction.merchantId,
          merchantText: transaction.merchantText,
          note: transaction.note || '',
          paymentMethod: transaction.paymentMethod || '',
          paymentInstrumentId: transaction.paymentInstrumentId,
          goalId: transaction.goalId || ''
        }
      }
    });
  }

  async function saveEdit() {
    if (!draft || !editingTransaction) return;

    const value = Number(draft.amount);
    if (!value || !draft.date) {
      showToast('金額與日期為必填。');
      return;
    }

    const plannedMerchant = planMerchantSave(draft.merchant, draft.merchantId, draft.createNewMerchant, merchants);
    if (!plannedMerchant.ok) {
      showToast(`請先確認商戶：這可能是「${plannedMerchant.suggestion.merchant.name}」。`);
      return;
    }
    if (plannedMerchant.upsert) {
      await upsertMerchant(plannedMerchant.upsert);
      setMerchants(current => [...current.filter(item => item.id !== plannedMerchant.upsert?.id), plannedMerchant.upsert!]);
    }

    const selectedInstrument = instruments.find(item => item.id === draft.paymentInstrumentId);
    const previousInstrument = instruments.find(item => item.id === editingTransaction.paymentInstrumentId);
    const accountLink = resolveInstrumentAccount({
      instrument: selectedInstrument,
      explicitAccountId: editingTransaction.accountId,
      previousInstrumentAccountId: previousInstrument?.accountId,
      choice: draft.accountLinkChoice,
    });
    if (!accountLink.ok) {
      showToast('請先處理付款工具與帳戶的連結衝突。');
      return;
    }

    const transaction: Transaction = {
      id: editingTransaction.id,
      type: draft.type,
      amount: value,
      currency: editingTransaction.currency || 'HKD',
      date: draft.date,
      category: draft.category,
      goalId: draft.type === 'expense' ? (draft.goalId || undefined) : undefined,
      linkedGoalEntryId: draft.type === 'expense' ? editingTransaction.linkedGoalEntryId : undefined,
      accountId: accountLink.accountId,
      linkedTransferId: editingTransaction.linkedTransferId,
      merchant: plannedMerchant.merchant,
      merchantId: plannedMerchant.merchantId,
      merchantText: plannedMerchant.merchantText,
      paymentMethod: draft.paymentType ? paymentMethodFromType(draft.paymentType) : undefined,
      paymentInstrumentId: draft.paymentInstrumentId,
      subscriptionId: editingTransaction.subscriptionId,
      note: draft.note,
      receiptUrl: editingTransaction.receiptUrl,
      receiptId: editingTransaction.receiptId,
      createdAt: editingTransaction.createdAt
    };

    const syncedTransaction = await saveTransactionWithGoalLink(transaction, editingTransaction);
    await trackEvent('edit_transaction_success', {
      category: draft.category,
      goalId: syncedTransaction.goalId || null
    });
    await refreshScreen();
    resetEdit();
    showToast('交易已更新。');
  }

  async function confirmDelete(transaction: Transaction) {
    await deleteTransactionWithGoalLink(transaction);
    await trackEvent('delete_transaction_success', {category: transaction.category});
    if (editingTransaction?.id === transaction.id) resetEdit();
    setConfirmDeleteId(null);
    await refreshScreen();
    showToast('已刪除。');
  }

  return (
    <Screen wide title="交易" subtitle="每一筆收支，都有跡可循">
      {draft ? (
        <Card title="編輯交易">
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
          <MerchantField
            merchants={merchants}
            text={draft.merchant}
            merchantId={draft.merchantId}
            createNew={draft.createNewMerchant}
            onChange={next => updateDraft({
              merchant: next.text,
              merchantId: next.merchantId,
              createNewMerchant: next.createNew,
            })}
          />
          <input
            type="text"
            placeholder="備註（選填）"
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
          <PaymentInstrumentField
            instruments={instruments}
            accounts={accounts}
            type={draft.paymentType}
            instrumentId={draft.paymentInstrumentId}
            onChange={next => updateDraft({
              paymentType: next.type,
              paymentInstrumentId: next.instrumentId,
              accountLinkChoice: undefined,
            })}
            onCreate={async instrument => {
              await upsertPaymentInstrument(instrument);
              setInstruments(current => [...current.filter(item => item.id !== instrument.id), instrument]);
            }}
          />
          {(() => {
            if (!draft || !editingTransaction) return null;
            const selectedInstrument = instruments.find(item => item.id === draft.paymentInstrumentId);
            const previousInstrument = instruments.find(item => item.id === editingTransaction.paymentInstrumentId);
            const accountLink = resolveInstrumentAccount({
              instrument: selectedInstrument,
              explicitAccountId: editingTransaction.accountId,
              previousInstrumentAccountId: previousInstrument?.accountId,
              choice: draft.accountLinkChoice,
            });
            if (accountLink.ok) return null;
            const instrumentAccount = accounts.find(item => item.id === accountLink.instrumentAccountId);
            const currentAccount = accounts.find(item => item.id === accountLink.transactionAccountId);
            return (
              <div className={styles.hint}>
                <p>此付款工具連結「{instrumentAccount?.name || '另一個帳戶'}」，但這筆交易目前連結「{currentAccount?.name || '現有帳戶'}」。請選擇要使用哪一個，系統不會自動覆寫。</p>
                <div className={styles.actionRow}>
                  <button className={styles.secondaryBtn} onClick={() => updateDraft({accountLinkChoice: 'instrument'})}>
                    改用付款工具的帳戶
                  </button>
                  <button className={styles.secondaryBtn} onClick={() => updateDraft({accountLinkChoice: 'keep'})}>
                    保留現有帳戶
                  </button>
                </div>
              </div>
            );
          })()}

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
              onClick={saveEdit}
            >
              儲存變更
            </button>
            <button className={styles.secondaryBtn} onClick={resetEdit}>取消</button>
          </div>
        </Card>
      ) : null}

      <Card title="交易記錄">
        <div className={styles.listToolbar}>
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
        <div className={styles.searchField}>
          <Search size={18} aria-hidden="true" />
          <input type="search" aria-label="搜尋交易" placeholder="搜尋商戶、備註或金額" className={styles.input} value={searchText} onChange={e => setSearchText(e.target.value)} />
        </div>
        <div className={styles.segmented} role="group" aria-label="交易類型">
          {([
            ['all', '全部'],
            ['expense', '支出'],
            ['income', '收入']
          ] as [TransactionTypeFilter, string][]).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={typeFilter === value}
              onClick={() => setTypeFilter(value)}
              className={[styles.chip, typeFilter === value ? styles.activeChip : ''].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>
        </div>
        <div className={styles.filterBar}>
          <span role="status">{filteredTransactions.length} 筆交易</span>
          <select aria-label="篩選交易分類" className={styles.categorySelect} value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
            <option value="all">全部分類</option>
            {categoryOptions.map(category => <option key={category} value={category}>{category}</option>)}
          </select>
        </div>
        {filteredTransactions.length > 0 ? (
          <div className={styles.desktopTable}>
            <table>
              <caption className={styles.hidden}>交易記錄</caption>
              <thead><tr><th scope="col">日期</th><th scope="col">商戶／備註</th><th scope="col">分類</th><th scope="col">付款方式</th><th scope="col" className={styles.numericCell}>金額</th><th scope="col">操作</th></tr></thead>
              <tbody>{filteredTransactions.map(t => (
                <tr key={t.id}>
                  <td className={styles.dateCell}>{t.date}</td>
                  <td className={styles.merchantCell}><strong>{resolveTransactionMerchantDisplay(t, merchants) || t.note || t.category}</strong>
                    {t.goalId ? <small>儲蓄目標：{goals.find(g => g.id === t.goalId)?.name || '已刪除目標'}</small> : null}
                    {t.subscriptionId ? <small>訂閱：{subscriptions.find(item => item.id === t.subscriptionId)?.name || '已刪除訂閱'}</small> : null}
                  </td>
                  <td>{t.category}</td>
                  <td>{t.paymentInstrumentId ? formatInstrumentLabel(instruments.find(item => item.id === t.paymentInstrumentId) || {id: '', name: t.paymentMethod || '付款工具', type: 'other', active: true, createdAt: ''}) : (t.paymentMethod || '未指定')}</td>
                  <td className={styles.numericCell}><span className={t.type === 'income' ? styles.incomeText : styles.expenseText}>{t.type === 'income' ? '+' : '-'}{t.currency || 'HKD'} {formatMoney(t.amount).slice(1)}</span></td>
                  <td>
                    {confirmDeleteId === t.id ? <div className={styles.tableConfirm}><span>確定刪除？</span><button className={styles.confirmYes} onClick={() => confirmDelete(t)}>確定</button><button className={styles.confirmNo} onClick={() => setConfirmDeleteId(null)}>取消</button></div> :
                    <div className={styles.tableActions}>
                      <button className={styles.iconBtn} aria-label={`複製交易：${t.note || t.category}`} title="複製" onClick={() => copyTransaction(t)}><Copy size={17} /></button>
                      <button className={styles.iconBtn} aria-label={`編輯交易：${t.note || t.category}`} title="編輯" onClick={() => startEdit(t)}><Pencil size={17} /></button>
                      <button className={styles.iconBtnDanger} aria-label={`刪除交易：${t.note || t.category}`} title="刪除" onClick={() => setConfirmDeleteId(t.id)}><Trash2 size={17} /></button>
                    </div>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : null}
        {transactions.length ? filteredTransactions.length ? <div className={styles.mobileRows}>{filteredTransactions.map(t => (
          <div key={t.id} className={styles.txRow}>
            <div className={styles.txMain}>
              <span className={styles.txTitle}>{resolveTransactionMerchantDisplay(t, merchants) || t.note || t.category}</span>
              <span className={styles.txMeta}>
                {t.date} · {t.category} · {t.paymentInstrumentId
                  ? formatInstrumentLabel(instruments.find(item => item.id === t.paymentInstrumentId) || {id: '', name: t.paymentMethod || '付款工具', type: 'other', active: true, createdAt: ''})
                  : (t.paymentMethod || '未填付款方式')}
              </span>
              {t.goalId && t.type === 'expense' ? (
                <span className={styles.goalMeta}>
                  由 Goal 支付：{goals.find(g => g.id === t.goalId)?.name || '已刪除目標'}
                </span>
              ) : null}
              {t.subscriptionId && t.type === 'expense' ? (
                <span className={styles.goalMeta}>
                  訂閱：{subscriptions.find(item => item.id === t.subscriptionId)?.name || t.note || '已刪除訂閱'}
                </span>
              ) : null}
            </div>
              <div className={styles.txActions}>
              <span className={t.type === 'income' ? styles.incomeText : styles.expenseText}>
                {t.type === 'income' ? '+' : '-'}{t.currency || 'HKD'} {formatMoney(t.amount).slice(1)}
              </span>
              {confirmDeleteId === t.id ? (
                <div className={styles.confirmRow}>
                  <span className={styles.confirmText}>確定刪除？</span>
                  <button className={styles.confirmYes} onClick={() => confirmDelete(t)}>確定</button>
                  <button className={styles.confirmNo} onClick={() => setConfirmDeleteId(null)}>取消</button>
                </div>
              ) : (
                <details className={styles.transactionOptions}>
                  <summary aria-label={`操作交易：${t.note || t.category}`}>操作</summary>
                  <div className={styles.actionRow}>
                  <button className={styles.iconBtn} aria-label="複製交易" title="複製" onClick={() => copyTransaction(t)}><Copy size={15} /></button>
                  <button className={styles.iconBtn} aria-label="編輯交易" title="編輯" onClick={() => startEdit(t)}><Pencil size={15} /></button>
                  <button className={styles.iconBtnDanger} aria-label="刪除交易" title="刪除" onClick={() => setConfirmDeleteId(t.id)}><Trash2 size={15} /></button>
                  </div>
                </details>
              )}
            </div>
          </div>
        ))}</div> : (
          <div className={styles.emptyState}><p className={styles.emptyTitle}>找不到符合條件的交易</p><p className={styles.hint}>試試其他關鍵字，或清除篩選。</p><button className={styles.secondaryBtn} onClick={() => {setSearchText(''); setTypeFilter('all'); setCategoryFilter('all');}}>清除篩選</button></div>
        ) : (
          <div className={styles.emptyState}><p className={styles.emptyTitle}>這個月，從第一筆開始</p><button className={styles.primaryBtn} onClick={() => navigate('/transaction')}>新增交易</button></div>
        )}
      </Card>

      {toast ? <div className={styles.toast}>{toast}</div> : null}
    </Screen>
  );
}
