import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import {Account, AnalyticsEvent, Budget, Goal, Receipt, Transaction, Transfer} from '../types/finance';
import {clean, db, getUid} from './firebase';

// ── Firestore path helpers ────────────────────────────────────────────────────

function col(uid: string, name: string) {
  return collection(db, 'users', uid, name);
}

function docRef(uid: string, name: string, id: string) {
  return doc(db, 'users', uid, name, id);
}

function metaRef(uid: string, name: string) {
  return doc(db, 'users', uid, 'meta', name);
}

async function loadCollection<T>(uid: string, name: string): Promise<T[]> {
  const snap = await getDocs(col(uid, name));
  return snap.docs.map(d => d.data() as T);
}

async function loadMetaDoc<T>(uid: string, name: string, fallback: T): Promise<T> {
  const snap = await getDoc(metaRef(uid, name));
  return snap.exists() ? (snap.data() as T) : fallback;
}

async function saveMetaDoc<T extends object>(uid: string, name: string, value: T): Promise<void> {
  await setDoc(metaRef(uid, name), clean(value));
}

// ── Goal helpers ──────────────────────────────────────────────────────────────

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

function getNextMonthKey(month: string): string {
  const [year, monthIndex] = month.split('-').map(Number);
  return getCurrentMonthKey(new Date(year, monthIndex, 1));
}

export async function loadTransactions(): Promise<Transaction[]> {
  return loadCollection<Transaction>(getUid(), 'transactions');
}

export async function saveTransactions(transactions: Transaction[]): Promise<void> {
  const uid = getUid();
  await Promise.all(
    transactions.map(t => setDoc(docRef(uid, 'transactions', t.id), clean(t)))
  );
}

export async function getTransactionsByMonth(month = getCurrentMonthKey()): Promise<Transaction[]> {
  const uid = getUid();
  const snap = await getDocs(query(
    col(uid, 'transactions'),
    where('date', '>=', `${month}-01`),
    where('date', '<', `${getNextMonthKey(month)}-01`)
  ));
  return snap.docs.map(d => d.data() as Transaction);
}

export async function upsertTransaction(transaction: Transaction): Promise<void> {
  const uid = getUid();
  await setDoc(docRef(uid, 'transactions', transaction.id), clean(transaction));
}

export async function deleteTransaction(id: string): Promise<void> {
  const uid = getUid();
  await deleteDoc(docRef(uid, 'transactions', id));
}

export async function loadBudgets(): Promise<Record<string, number>> {
  return loadMetaDoc<Record<string, number>>(getUid(), 'budgets', {});
}

export async function saveBudget(category: string, amount: number): Promise<Record<string, number>> {
  const uid = getUid();
  const budgets = await loadBudgets();
  const next = {...budgets, [category]: amount};
  await saveMetaDoc(uid, 'budgets', next);
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
  return loadCollection<Receipt>(getUid(), 'receipts');
}

export async function upsertReceipt(receipt: Receipt): Promise<void> {
  const uid = getUid();
  await setDoc(docRef(uid, 'receipts', receipt.id), clean(receipt));
}

export async function loadGoals(): Promise<Goal[]> {
  const goals = await loadCollection<Goal>(getUid(), 'goals');
  return goals.map(normalizeGoal).map(goal => ({
    ...goal,
    savedAmount: getGoalSavedAmount(goal)
  }));
}

export async function upsertGoal(goal: Goal): Promise<void> {
  const uid = getUid();
  const normalizedGoal = normalizeGoal(goal);
  const goalWithSavedAmount = {
    ...normalizedGoal,
    savedAmount: Math.min(normalizedGoal.targetAmount, getGoalSavedAmount(normalizedGoal))
  };
  await setDoc(docRef(uid, 'goals', goal.id), clean(goalWithSavedAmount));
}

export async function deleteGoal(id: string): Promise<void> {
  const uid = getUid();
  await deleteDoc(docRef(uid, 'goals', id));
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
  return loadCollection<Account>(getUid(), 'accounts');
}

export async function upsertAccount(account: Account): Promise<void> {
  const uid = getUid();
  await setDoc(docRef(uid, 'accounts', account.id), clean(account));
}

export async function deleteAccount(id: string): Promise<void> {
  const uid = getUid();
  await deleteDoc(docRef(uid, 'accounts', id));
}

export async function loadTransfers(): Promise<Transfer[]> {
  return loadCollection<Transfer>(getUid(), 'transfers');
}

export async function saveTransfers(transfers: Transfer[]): Promise<void> {
  const uid = getUid();
  await Promise.all(
    transfers.map(t => setDoc(docRef(uid, 'transfers', t.id), clean(t)))
  );
}

export async function upsertTransfer(transfer: Transfer): Promise<void> {
  const uid = getUid();
  await setDoc(docRef(uid, 'transfers', transfer.id), clean(transfer));
}

export async function deleteTransfer(id: string): Promise<void> {
  const uid = getUid();
  await deleteDoc(docRef(uid, 'transfers', id));
}

export async function deleteTransfersByGoal(goalId: string): Promise<Transfer[]> {
  const uid = getUid();
  const snap = await getDocs(query(col(uid, 'transfers'), where('goalId', '==', goalId)));
  await Promise.all(
    snap.docs.map(t => deleteDoc(docRef(uid, 'transfers', t.id)))
  );
  return loadTransfers();
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
  const uid = getUid();
  const events = await loadMetaDoc<AnalyticsEvent[]>(uid, 'events', []);
  const next = [...events, {name, props, at: new Date().toISOString()}].slice(-500);
  await saveMetaDoc(uid, 'events', {items: next});
  return next;
}

export async function loadEvents(): Promise<AnalyticsEvent[]> {
  const uid = getUid();
  const data = await loadMetaDoc<{items?: AnalyticsEvent[]}>(uid, 'events', {});
  return data.items ?? [];
}

export async function clearSensitiveCache(): Promise<void> {
  // With Firestore as the data store, calling this function is a no-op.
  // Data lives in the cloud under the user's account.
  // To wipe all data, sign out or delete the account from Firebase Console.
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
