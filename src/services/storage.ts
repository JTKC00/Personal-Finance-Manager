import AsyncStorage from '@react-native-async-storage/async-storage';
import {Account, AnalyticsEvent, Budget, Goal, Receipt, Transaction, Transfer} from '../types/finance';

const KEYS = {
  transactions: 'fin_txns',
  budgets: 'fin_budgets',
  receipts: 'fin_receipts',
  goals: 'fin_goals',
  events: 'fin_events',
  accounts: 'fin_accounts',
  transfers: 'fin_transfers'
} as const;

async function loadJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await AsyncStorage.getItem(key);
  return raw ? JSON.parse(raw) as T : fallback;
}

async function saveJson<T>(key: string, value: T): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

function normalizeGoal(goal: Goal): Goal {
  return {
    ...goal,
    deposits: (goal.deposits || []).map(entry => ({
      id: entry.id || `${goal.id}-${entry.date}-${entry.amount}-${entry.type || 'deposit'}`,
      amount: Math.abs(entry.amount),
      date: entry.date,
      type: entry.type || (entry.amount >= 0 ? 'deposit' : 'withdraw'),
      note: entry.note,
      linkedTransactionId: entry.linkedTransactionId
    }))
  };
}

function getGoalSavedAmount(goal: Goal): number {
  const deposits = goal.deposits || [];
  if (!deposits.length) return goal.savedAmount;

  return deposits.reduce((sum, entry) => (
    entry.type === 'deposit' ? sum + entry.amount : Math.max(0, sum - entry.amount)
  ), 0);
}

export function getCurrentMonthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export async function loadTransactions(): Promise<Transaction[]> {
  return loadJson<Transaction[]>(KEYS.transactions, []);
}

export async function saveTransactions(transactions: Transaction[]): Promise<void> {
  await saveJson(KEYS.transactions, transactions);
}

export async function getTransactionsByMonth(month = getCurrentMonthKey()): Promise<Transaction[]> {
  const transactions = await loadTransactions();
  return transactions.filter(item => item.date.startsWith(month));
}

export async function upsertTransaction(transaction: Transaction): Promise<Transaction[]> {
  const transactions = await loadTransactions();
  const exists = transactions.some(item => item.id === transaction.id);
  const next = exists
    ? transactions.map(item => (item.id === transaction.id ? transaction : item))
    : [...transactions, transaction];
  await saveTransactions(next);
  return next;
}

export async function deleteTransaction(id: string): Promise<Transaction[]> {
  const transactions = await loadTransactions();
  const next = transactions.filter(item => item.id !== id);
  await saveTransactions(next);
  return next;
}

export async function loadBudgets(): Promise<Record<string, number>> {
  return loadJson<Record<string, number>>(KEYS.budgets, {});
}

export async function saveBudget(category: string, amount: number): Promise<Record<string, number>> {
  const budgets = await loadBudgets();
  const next = {...budgets, [category]: amount};
  await saveJson(KEYS.budgets, next);
  return next;
}

export async function loadBudgetRows(): Promise<Budget[]> {
  const budgets = await loadBudgets();
  const month = getCurrentMonthKey();
  return Object.entries(budgets).map(([category, amount]) => ({
    id: `${month}-${category}`,
    category,
    month,
    amount,
    warnThreshold: 0.7,
    dangerThreshold: 0.9
  }));
}

export async function loadReceipts(): Promise<Receipt[]> {
  return loadJson<Receipt[]>(KEYS.receipts, []);
}

export async function upsertReceipt(receipt: Receipt): Promise<Receipt[]> {
  const receipts = await loadReceipts();
  const exists = receipts.some(item => item.id === receipt.id);
  const next = exists
    ? receipts.map(item => (item.id === receipt.id ? receipt : item))
    : [...receipts, receipt];
  await saveJson(KEYS.receipts, next);
  return next;
}

export async function loadGoals(): Promise<Goal[]> {
  const goals = await loadJson<Goal[]>(KEYS.goals, []);
  return goals.map(normalizeGoal).map(goal => ({
    ...goal,
    savedAmount: getGoalSavedAmount(goal)
  }));
}

export async function upsertGoal(goal: Goal): Promise<Goal[]> {
  const goals = await loadGoals();
  const normalizedGoal = normalizeGoal(goal);
  const goalWithSavedAmount = {
    ...normalizedGoal,
    savedAmount: Math.min(normalizedGoal.targetAmount, getGoalSavedAmount(normalizedGoal))
  };
  const exists = goals.some(item => item.id === goal.id);
  const next = exists
    ? goals.map(item => (item.id === goal.id ? goalWithSavedAmount : item))
    : [...goals, goalWithSavedAmount];
  await saveJson(KEYS.goals, next);
  return next;
}

export async function deleteGoal(id: string): Promise<Goal[]> {
  const goals = await loadGoals();
  const next = goals.filter(item => item.id !== id);
  await saveJson(KEYS.goals, next);
  return next;
}

export async function appendGoalEntry(
  goalId: string,
  entry: {
    amount: number;
    date: string;
    type: 'deposit' | 'withdraw';
    note?: string;
    linkedTransactionId?: string;
  }
): Promise<{goal?: Goal; entryId?: string}> {
  const goals = await loadGoals();
  const goal = goals.find(item => item.id === goalId);
  if (!goal) return {};

  const room = entry.type === 'deposit'
    ? Math.max(0, goal.targetAmount - goal.savedAmount)
    : goal.savedAmount;
  const appliedAmount = Math.min(Math.abs(entry.amount), room);
  if (!appliedAmount) return {goal};

  const nextEntry = {
    ...entry,
    id: `${goalId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    amount: appliedAmount
  };
  const nextGoal: Goal = {
    ...goal,
    deposits: [...(goal.deposits || []), nextEntry],
    savedAmount: entry.type === 'deposit'
      ? goal.savedAmount + appliedAmount
      : Math.max(0, goal.savedAmount - appliedAmount)
  };

  await upsertGoal(nextGoal);
  return {goal: nextGoal, entryId: nextEntry.id};
}

export async function removeGoalEntry(goalId: string, entryId: string): Promise<Goal | undefined> {
  const goals = await loadGoals();
  const goal = goals.find(item => item.id === goalId);
  if (!goal) return goal;

  const targetEntry = (goal.deposits || []).find(item => item.id === entryId);
  if (!targetEntry) return goal;

  const nextGoal: Goal = {
    ...goal,
    deposits: (goal.deposits || []).filter(item => item.id !== entryId),
    savedAmount: targetEntry.type === 'deposit'
      ? Math.max(0, goal.savedAmount - targetEntry.amount)
      : Math.min(goal.targetAmount, goal.savedAmount + targetEntry.amount)
  };
  await upsertGoal(nextGoal);
  return nextGoal;
}

export async function syncTransactionGoalLink(transaction: Transaction, previous?: Transaction): Promise<Transaction> {
  let nextTransaction: Transaction = {...transaction};

  if (previous?.goalId && previous.linkedGoalEntryId) {
    await removeGoalEntry(previous.goalId, previous.linkedGoalEntryId);
    nextTransaction.linkedGoalEntryId = undefined;
  }

  if (!transaction.goalId || transaction.type !== 'expense') {
    nextTransaction.goalId = undefined;
    nextTransaction.linkedGoalEntryId = undefined;
    return nextTransaction;
  }

  const result = await appendGoalEntry(transaction.goalId, {
    amount: transaction.amount,
    date: transaction.date,
    type: 'withdraw',
    note: transaction.note || transaction.category,
    linkedTransactionId: transaction.id
  });

  if (!result.entryId) {
    nextTransaction.goalId = undefined;
    nextTransaction.linkedGoalEntryId = undefined;
    return nextTransaction;
  }

  nextTransaction.linkedGoalEntryId = result.entryId;
  return nextTransaction;
}

export async function removeTransactionGoalLink(transaction: Transaction): Promise<void> {
  if (!transaction.goalId || !transaction.linkedGoalEntryId) return;
  await removeGoalEntry(transaction.goalId, transaction.linkedGoalEntryId);
}

export async function loadAccounts(): Promise<Account[]> {
  return loadJson<Account[]>(KEYS.accounts, []);
}

export async function upsertAccount(account: Account): Promise<Account[]> {
  const accounts = await loadAccounts();
  const exists = accounts.some(item => item.id === account.id);
  const next = exists
    ? accounts.map(item => (item.id === account.id ? account : item))
    : [...accounts, account];
  await saveJson(KEYS.accounts, next);
  return next;
}

export async function deleteAccount(id: string): Promise<Account[]> {
  const accounts = await loadAccounts();
  const next = accounts.filter(item => item.id !== id);
  await saveJson(KEYS.accounts, next);
  return next;
}

export async function loadTransfers(): Promise<Transfer[]> {
  return loadJson<Transfer[]>(KEYS.transfers, []);
}

export async function saveTransfers(transfers: Transfer[]): Promise<void> {
  await saveJson(KEYS.transfers, transfers);
}

export async function upsertTransfer(transfer: Transfer): Promise<Transfer[]> {
  const transfers = await loadTransfers();
  const exists = transfers.some(item => item.id === transfer.id);
  const next = exists
    ? transfers.map(item => (item.id === transfer.id ? transfer : item))
    : [...transfers, transfer];
  await saveTransfers(next);
  return next;
}

export async function deleteTransfer(id: string): Promise<Transfer[]> {
  const transfers = await loadTransfers();
  const next = transfers.filter(item => item.id !== id);
  await saveTransfers(next);
  return next;
}

export async function deleteTransfersByGoal(goalId: string): Promise<Transfer[]> {
  const transfers = await loadTransfers();
  const next = transfers.filter(item => item.goalId !== goalId);
  await saveTransfers(next);
  return next;
}

export async function getAccountBalance(accountId: string): Promise<number> {
  const [accounts, transfers] = await Promise.all([loadAccounts(), loadTransfers()]);
  const account = accounts.find(item => item.id === accountId);
  if (!account) return 0;

  const inflow = transfers
    .filter(item => item.toAccountId === accountId)
    .reduce((sum, item) => sum + item.amount, 0);
  const outflow = transfers
    .filter(item => item.fromAccountId === accountId)
    .reduce((sum, item) => sum + item.amount, 0);

  return account.initialBalance + inflow - outflow;
}

export async function syncGoalSavedAmount(goalId: string): Promise<Goal | undefined> {
  const goals = await loadGoals();
  const goal = goals.find(item => item.id === goalId);
  if (!goal || !goal.accountId) return goal;

  const balance = await getAccountBalance(goal.accountId);
  const nextSavedAmount = Math.max(0, Math.min(goal.targetAmount, balance));
  if (nextSavedAmount === goal.savedAmount) return goal;

  const nextGoal = {...goal, savedAmount: nextSavedAmount};
  await upsertGoal(nextGoal);
  return nextGoal;
}

export async function syncGoalsForAccount(accountId: string): Promise<void> {
  const goals = await loadGoals();
  const linkedGoals = goals.filter(item => item.accountId === accountId);
  for (const goal of linkedGoals) {
    await syncGoalSavedAmount(goal.id);
  }
}

export async function syncAllGoalsFromAccounts(): Promise<void> {
  const goals = await loadGoals();
  for (const goal of goals) {
    if (goal.accountId) {
      await syncGoalSavedAmount(goal.id);
    }
  }
}

export async function syncTransactionTransfer(transaction: Transaction, previous?: Transaction): Promise<Transaction> {
  const previousTransferId = previous?.linkedTransferId;
  const shouldLinkAccount = Boolean(transaction.accountId);

  if (!shouldLinkAccount) {
    if (previousTransferId) {
      await deleteTransfer(previousTransferId);
      await syncGoalsForAccount(previous.accountId as string);
    }
    if (transaction.linkedTransferId) {
      return {...transaction, linkedTransferId: undefined};
    }
    return transaction;
  }

  const accountId = transaction.accountId as string;
  const transfer: Transfer = {
    id: previousTransferId || transaction.linkedTransferId || `txn-${transaction.id}`,
    fromAccountId: transaction.type === 'expense' ? accountId : null,
    toAccountId: transaction.type === 'income' ? accountId : null,
    amount: transaction.amount,
    date: transaction.date,
    note: transaction.note || transaction.category,
    transactionId: transaction.id,
    createdAt: previous?.createdAt || new Date().toISOString()
  };

  await upsertTransfer(transfer);
  if (previous?.accountId && previous.accountId !== transaction.accountId) {
    await syncGoalsForAccount(previous.accountId);
  }
  await syncGoalsForAccount(accountId);
  return {...transaction, linkedTransferId: transfer.id};
}

export async function removeTransactionTransfer(transaction: Transaction): Promise<void> {
  if (!transaction.linkedTransferId) return;
  await deleteTransfer(transaction.linkedTransferId);
  if (transaction.accountId) {
    await syncGoalsForAccount(transaction.accountId);
  }
}

export async function trackEvent(name: string, props: Record<string, unknown> = {}): Promise<AnalyticsEvent[]> {
  const events = await loadJson<AnalyticsEvent[]>(KEYS.events, []);
  const next = [...events, {name, props, at: new Date().toISOString()}].slice(-500);
  await saveJson(KEYS.events, next);
  return next;
}

export async function loadEvents(): Promise<AnalyticsEvent[]> {
  return loadJson<AnalyticsEvent[]>(KEYS.events, []);
}

export async function clearSensitiveCache(): Promise<void> {
  await AsyncStorage.multiRemove([
    KEYS.transactions,
    KEYS.budgets,
    KEYS.receipts,
    KEYS.goals,
    KEYS.events,
    KEYS.accounts,
    KEYS.transfers
  ]);
}

export async function getMonthlySummary(month = getCurrentMonthKey()) {
  const transactions = await getTransactionsByMonth(month);
  const income = transactions.filter(item => item.type === 'income').reduce((sum, item) => sum + item.amount, 0);
  const expense = transactions.filter(item => item.type === 'expense').reduce((sum, item) => sum + item.amount, 0);
  return {
    income,
    expense,
    balance: income - expense,
    count: transactions.length
  };
}

export async function getCategoryBreakdown(month = getCurrentMonthKey()): Promise<Record<string, number>> {
  const transactions = await getTransactionsByMonth(month);
  const map: Record<string, number> = {};
  transactions
    .filter(item => item.type === 'expense')
    .forEach(item => {
      map[item.category] = (map[item.category] || 0) + item.amount;
    });
  return map;
}
