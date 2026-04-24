import {useCallback, useEffect, useMemo, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {Card} from '../components/Card';
import {Screen} from '../components/Screen';
import {expenseCategories, incomeCategories, paymentMethods} from '../constants/categories';
import {
  deleteTransactionWithGoalLink,
  getCurrentMonthKey,
  getTransactionsByMonth,
  loadGoals,
  saveTransactionWithGoalLink,
  trackEvent,
} from '../services/storage';
import {Goal, Transaction} from '../types/finance';
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

const formatMoney = (value: number) => `$${Math.round(value).toLocaleString()}`;

export function TransactionListScreen() {
  const navigate = useNavigate();
  const currentMonth = getCurrentMonthKey();
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [searchText, setSearchText] = useState('');
  const [typeFilter, setTypeFilter] = useState<TransactionTypeFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [toast, setToast] = useState('');

  const canSave = useMemo(() => {
    return draft ? Number(draft.amount) > 0 && Boolean(draft.date) : false;
  }, [draft]);

  const refreshScreen = useCallback(async () => {
    const [next, nextGoals] = await Promise.all([getTransactionsByMonth(selectedMonth), loadGoals()]);
    setTransactions(
      [...next].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    );
    setGoals(nextGoals);
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
      note: transaction.note || '',
      date: transaction.date,
      paymentMethod: transaction.paymentMethod || paymentMethods[0],
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
          note: transaction.note || '',
          paymentMethod: transaction.paymentMethod || paymentMethods[0],
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

    const transaction: Transaction = {
      id: editingTransaction.id,
      type: draft.type,
      amount: value,
      currency: editingTransaction.currency || 'HKD',
      date: draft.date,
      category: draft.category,
      goalId: draft.type === 'expense' ? (draft.goalId || undefined) : undefined,
      linkedGoalEntryId: draft.type === 'expense' ? editingTransaction.linkedGoalEntryId : undefined,
      paymentMethod: draft.paymentMethod,
      note: draft.note,
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
    if (!window.confirm(`確定刪除「${transaction.note || transaction.category}」？`)) return;
    await deleteTransactionWithGoalLink(transaction);
    await trackEvent('delete_transaction_success', {category: transaction.category});
    if (editingTransaction?.id === transaction.id) resetEdit();
    await refreshScreen();
    showToast('已刪除。');
  }

  return (
    <Screen title="交易列表" subtitle="按月份瀏覽、編輯與刪除交易">
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
              onClick={saveEdit}
            >
              儲存變更
            </button>
            <button className={styles.secondaryBtn} onClick={resetEdit}>取消</button>
          </div>
        </Card>
      ) : null}

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
        <input
          type="search"
          placeholder="搜尋備註、分類、付款方式或金額"
          className={styles.input}
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
        />
        <p className={styles.sectionLabel}>類型</p>
        <div className={styles.chips}>
          {([
            ['all', '全部'],
            ['expense', '支出'],
            ['income', '收入']
          ] as [TransactionTypeFilter, string][]).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTypeFilter(value)}
              className={[styles.chip, typeFilter === value ? styles.activeChip : ''].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>
        {categoryOptions.length > 0 ? (
          <>
            <p className={styles.sectionLabel}>分類</p>
            <div className={styles.chips}>
              <button
                type="button"
                onClick={() => setCategoryFilter('all')}
                className={[styles.chip, categoryFilter === 'all' ? styles.activeChip : ''].join(' ')}
              >
                全部分類
              </button>
              {categoryOptions.map(category => (
                <button
                  key={category}
                  type="button"
                  onClick={() => setCategoryFilter(category)}
                  className={[styles.chip, categoryFilter === category ? styles.activeChip : ''].join(' ')}
                >
                  {category}
                </button>
              ))}
            </div>
          </>
        ) : null}
        {transactions.length ? filteredTransactions.length ? filteredTransactions.map(t => (
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
                <button className={styles.textBtn} onClick={() => copyTransaction(t)}>複製</button>
                <button className={styles.textBtn} onClick={() => startEdit(t)}>編輯</button>
                <button className={[styles.textBtn, styles.deleteBtn].join(' ')} onClick={() => confirmDelete(t)}>刪除</button>
              </div>
            </div>
          </div>
        )) : (
          <p className={styles.hint}>找不到符合條件的交易。</p>
        ) : (
          <p className={styles.hint}>本月尚無交易。</p>
        )}
      </Card>

      {toast ? <div className={styles.toast}>{toast}</div> : null}
    </Screen>
  );
}
