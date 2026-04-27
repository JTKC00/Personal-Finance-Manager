import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  setDoc,
  where,
} from 'firebase/firestore';
import {Account, AnalyticsEvent, Budget, Goal, Receipt, Subscription, Transaction, Transfer} from '../types/finance';
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

async function loadEventItems(uid: string): Promise<AnalyticsEvent[]> {
  const data = await loadMetaDoc<{items?: AnalyticsEvent[]} | AnalyticsEvent[]>(uid, 'events', []);
  return Array.isArray(data) ? data : data.items ?? [];
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

function getGoalWithSavedAmount(goal: Goal): Goal {
  const normalizedGoal = normalizeGoal(goal);
  return {
    ...normalizedGoal,
    savedAmount: Math.min(normalizedGoal.targetAmount, getGoalSavedAmount(normalizedGoal))
  };
}

export function getCurrentMonthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function getNextMonthKey(month: string): string {
  const [year, monthIndex] = month.split('-').map(Number);
  return getCurrentMonthKey(new Date(year, monthIndex, 1));
}

function parseDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function addMonthsClamped(dateKey: string, months: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const target = new Date(year, month - 1 + months, 1);
  const lastDay = daysInMonth(target.getFullYear(), target.getMonth());
  target.setDate(Math.min(day, lastDay));
  return formatDateKey(target);
}

export function getNextSubscriptionBillingDate(subscription: Subscription, fromDate = subscription.nextBillingDate): string {
  const date = parseDateKey(fromDate);
  if (subscription.frequency === 'weekly') {
    date.setDate(date.getDate() + 7);
    return formatDateKey(date);
  }
  if (subscription.frequency === 'quarterly') return addMonthsClamped(fromDate, 3);
  if (subscription.frequency === 'yearly') return addMonthsClamped(fromDate, 12);
  return addMonthsClamped(fromDate, 1);
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

export async function saveTransactionWithGoalLink(
  transaction: Transaction,
  previous?: Transaction
): Promise<Transaction> {
  const uid = getUid();
  let savedTransaction: Transaction = {...transaction};

  await runTransaction(db, async firestoreTransaction => {
    let nextTransaction: Transaction = {...transaction};
    let goalAfterPreviousRemoval: Goal | undefined;
    const previousGoalRef = previous?.goalId ? docRef(uid, 'goals', previous.goalId) : null;
    const nextGoalRef = transaction.goalId && transaction.type === 'expense'
      ? docRef(uid, 'goals', transaction.goalId)
      : null;

    const previousGoalSnap = previousGoalRef ? await firestoreTransaction.get(previousGoalRef) : null;
    const nextGoalSnap = nextGoalRef ? await firestoreTransaction.get(nextGoalRef) : null;

    if (previousGoalRef && previousGoalSnap?.exists() && previous?.linkedGoalEntryId) {
      const previousGoal = normalizeGoal(previousGoalSnap.data() as Goal);
      const previousDeposits = (previousGoal.deposits || []).filter(
        item => item.id !== previous.linkedGoalEntryId
      );
      goalAfterPreviousRemoval = getGoalWithSavedAmount({
        ...previousGoal,
        deposits: previousDeposits
      });
      firestoreTransaction.set(previousGoalRef, clean(goalAfterPreviousRemoval));
      nextTransaction.linkedGoalEntryId = undefined;
    }

    if (!nextGoalRef || !nextGoalSnap?.exists()) {
      nextTransaction.goalId = undefined;
      nextTransaction.linkedGoalEntryId = undefined;
      firestoreTransaction.set(docRef(uid, 'transactions', transaction.id), clean(nextTransaction));
      savedTransaction = nextTransaction;
      return;
    }

    const nextGoal = previous?.goalId === transaction.goalId && goalAfterPreviousRemoval
      ? goalAfterPreviousRemoval
      : normalizeGoal(nextGoalSnap.data() as Goal);
    const room = nextGoal.savedAmount;
    const appliedAmount = Math.min(Math.abs(transaction.amount), room);
    if (!appliedAmount) {
      nextTransaction.goalId = undefined;
      nextTransaction.linkedGoalEntryId = undefined;
      firestoreTransaction.set(docRef(uid, 'transactions', transaction.id), clean(nextTransaction));
      savedTransaction = nextTransaction;
      return;
    }

    const nextEntry = {
      id: `${nextGoal.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      amount: appliedAmount,
      date: transaction.date,
      type: 'withdraw' as const,
      note: transaction.note || transaction.category,
      linkedTransactionId: transaction.id
    };
    nextTransaction.linkedGoalEntryId = nextEntry.id;

    firestoreTransaction.set(nextGoalRef, clean(getGoalWithSavedAmount({
      ...nextGoal,
      deposits: [...(nextGoal.deposits || []), nextEntry],
      savedAmount: Math.max(0, nextGoal.savedAmount - appliedAmount)
    })));
    firestoreTransaction.set(docRef(uid, 'transactions', transaction.id), clean(nextTransaction));
    savedTransaction = nextTransaction;
  });

  return savedTransaction;
}

export async function deleteTransactionWithGoalLink(transaction: Transaction): Promise<void> {
  const uid = getUid();
  await runTransaction(db, async firestoreTransaction => {
    if (transaction.goalId && transaction.linkedGoalEntryId) {
      const goalRef = docRef(uid, 'goals', transaction.goalId);
      const goalSnap = await firestoreTransaction.get(goalRef);
      if (goalSnap.exists()) {
        const goal = normalizeGoal(goalSnap.data() as Goal);
        firestoreTransaction.set(goalRef, clean(getGoalWithSavedAmount({
          ...goal,
          deposits: (goal.deposits || []).filter(item => item.id !== transaction.linkedGoalEntryId)
        })));
      }
    }
    firestoreTransaction.delete(docRef(uid, 'transactions', transaction.id));
  });
}

export async function loadSubscriptions(): Promise<Subscription[]> {
  return loadCollection<Subscription>(getUid(), 'subscriptions');
}

export async function upsertSubscription(subscription: Subscription): Promise<void> {
  const uid = getUid();
  await setDoc(docRef(uid, 'subscriptions', subscription.id), clean(subscription));
}

export async function deleteSubscription(id: string): Promise<void> {
  const uid = getUid();
  await deleteDoc(docRef(uid, 'subscriptions', id));
}

export type SubscriptionCharge = {
  subscription: Subscription;
  date: string;
  amount: number;
};

export function getSubscriptionChargesForMonth(
  subscriptions: Subscription[],
  month = getCurrentMonthKey(),
  transactions: Transaction[] = [],
  today = formatDateKey(new Date()),
  upcomingOnly = false
): SubscriptionCharge[] {
  const monthStart = `${month}-01`;
  const monthEnd = `${getNextMonthKey(month)}-01`;
  const postedKeys = new Set(
    transactions
      .filter(item => item.subscriptionId)
      .map(item => `${item.subscriptionId}:${item.date}`)
  );

  const charges: SubscriptionCharge[] = [];
  subscriptions
    .filter(item => item.active && item.nextBillingDate)
    .forEach(subscription => {
      let date = subscription.nextBillingDate;
      let guard = 0;
      while (date < monthStart && guard < 120) {
        date = getNextSubscriptionBillingDate(subscription, date);
        guard += 1;
      }
      while (date < monthEnd && guard < 120) {
        const key = `${subscription.id}:${date}`;
        const isUpcoming = date >= today && !postedKeys.has(key);
        if (!upcomingOnly || isUpcoming) {
          charges.push({subscription, date, amount: subscription.amount});
        }
        date = getNextSubscriptionBillingDate(subscription, date);
        guard += 1;
      }
    });

  return charges.sort((a, b) => a.date.localeCompare(b.date) || a.subscription.name.localeCompare(b.subscription.name));
}

export async function processDueSubscriptions(today = formatDateKey(new Date())): Promise<number> {
  const [subscriptions, transactions] = await Promise.all([loadSubscriptions(), loadTransactions()]);
  const postedKeys = new Set(
    transactions
      .filter(item => item.subscriptionId)
      .map(item => `${item.subscriptionId}:${item.date}`)
  );
  let created = 0;

  for (const subscription of subscriptions.filter(item => item.active && item.nextBillingDate)) {
    let dueDate = subscription.nextBillingDate;
    let lastPostedDate = subscription.lastPostedDate;
    let guard = 0;

    while (dueDate <= today && guard < 36) {
      const key = `${subscription.id}:${dueDate}`;
      if (!postedKeys.has(key)) {
        const transaction: Transaction = {
          id: `sub-${subscription.id}-${dueDate}`,
          type: 'expense',
          amount: subscription.amount,
          currency: subscription.currency || 'HKD',
          date: dueDate,
          category: subscription.category,
          paymentMethod: subscription.paymentMethod,
          subscriptionId: subscription.id,
          note: subscription.name,
          createdAt: new Date().toISOString()
        };
        await upsertTransaction(transaction);
        postedKeys.add(key);
        created += 1;
      }
      lastPostedDate = dueDate;
      dueDate = getNextSubscriptionBillingDate(subscription, dueDate);
      guard += 1;
    }

    if (dueDate !== subscription.nextBillingDate || lastPostedDate !== subscription.lastPostedDate) {
      await upsertSubscription({
        ...subscription,
        nextBillingDate: dueDate,
        lastPostedDate
      });
    }
  }

  return created;
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

export async function saveAllBudgets(data: Record<string, number>): Promise<void> {
  const uid = getUid();
  await saveMetaDoc(uid, 'budgets', data);
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
  await setDoc(docRef(uid, 'goals', goal.id), clean(getGoalWithSavedAmount(goal)));
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
  const events = await loadEventItems(uid);
  const next = [...events, {name, props, at: new Date().toISOString()}].slice(-500);
  await saveMetaDoc(uid, 'events', {items: next});
  return next;
}

export async function loadEvents(): Promise<AnalyticsEvent[]> {
  return loadEventItems(getUid());
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
