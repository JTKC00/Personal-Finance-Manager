import {
  buildBudgetRows,
  calculateAccountBalance,
  formatDateKey,
  getCurrentMonthKey,
  getGoalWithSavedAmount,
  getNextMonthKey,
  getNextSubscriptionBillingDate,
  normalizeGoal,
  normalizeCurrency,
  resolveBudgetMonth,
  sumExpensesByCategory,
} from './financeLogic';
import {roundMoney, sumMoney} from './money';
import {FINANCE_BACKUP_VERSION, type FinanceBackup} from './financeBackup';
export {
  getCurrentMonthKey,
  getNextSubscriptionBillingDate,
  getSubscriptionChargesForMonth,
  type SubscriptionCharge,
} from './financeLogic';
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
  writeBatch,
} from 'firebase/firestore';
import type {DocumentData, DocumentReference} from 'firebase/firestore';
import {Account, AnalyticsEvent, Budget, Goal, Merchant, PaymentInstrument, Receipt, Subscription, Transaction, Transfer} from '../types/finance';
import {mergeMerchantRecords} from './merchantIdentity';
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

export async function loadTransactions(): Promise<Transaction[]> {
  return loadCollection<Transaction>(getUid(), 'transactions');
}

export async function getEarliestTransactionMonth(): Promise<string | null> {
  const dates = (await loadTransactions()).map(item => item.date).filter(Boolean).sort();
  return dates[0] ? dates[0].slice(0, 7) : null;
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

function assertAccountCurrency(transaction: Transaction, account: Account | undefined): asserts account is Account {
  if (!account) throw new Error('找不到交易所連結的帳戶。');
  const transactionCurrency = normalizeCurrency(transaction.currency);
  const accountCurrency = normalizeCurrency(account.currency);
  if (transactionCurrency !== accountCurrency) {
    throw new Error(`交易幣別 ${transactionCurrency} 與帳戶基準幣別 ${accountCurrency} 不一致。`);
  }
}

export async function saveTransactionWithGoalLink(
  transaction: Transaction,
  previous?: Transaction,
  confirmedReceipt?: Receipt,
): Promise<Transaction> {
  const uid = getUid();
  let savedTransaction: Transaction = {...transaction};
  const accountGoalIdsToSync = new Set<string>();

  await runTransaction(db, async firestoreTransaction => {
    let nextTransaction: Transaction = {...transaction};
    let goalAfterPreviousRemoval: Goal | undefined;
    const previousGoalRef = previous?.goalId ? docRef(uid, 'goals', previous.goalId) : null;
    const nextGoalRef = transaction.goalId && transaction.type === 'expense'
      ? docRef(uid, 'goals', transaction.goalId)
      : null;
    const previousGoalSnap = previousGoalRef ? await firestoreTransaction.get(previousGoalRef) : null;
    const nextGoalSnap = nextGoalRef ? await firestoreTransaction.get(nextGoalRef) : null;
    const previousGoal = previousGoalSnap?.exists() ? normalizeGoal(previousGoalSnap.data() as Goal) : undefined;
    const requestedGoal = nextGoalSnap?.exists() ? normalizeGoal(nextGoalSnap.data() as Goal) : undefined;
    const targetAccountId = requestedGoal?.accountId || transaction.accountId;
    const accountRef = targetAccountId ? docRef(uid, 'accounts', targetAccountId) : null;
    const accountSnap = accountRef ? await firestoreTransaction.get(accountRef) : null;

    const persistTransactionAndReceipt = () => {
      if (confirmedReceipt) {
        nextTransaction.receiptId = confirmedReceipt.id;
        firestoreTransaction.set(docRef(uid, 'receipts', confirmedReceipt.id), clean({
          ...confirmedReceipt,
          transactionId: transaction.id,
          needsConfirm: false,
        }));
      }
      firestoreTransaction.set(docRef(uid, 'transactions', transaction.id), clean(nextTransaction));
      savedTransaction = nextTransaction;
    };

    if (accountRef) {
      assertAccountCurrency(transaction, accountSnap?.exists() ? accountSnap.data() as Account : undefined);
    }
    if (requestedGoal?.accountId && transaction.accountId && transaction.accountId !== requestedGoal.accountId) {
      throw new Error('交易帳戶與儲蓄目標連結的帳戶不一致。');
    }

    const setAccountTransfer = (goalId?: string) => {
      if (!targetAccountId) return;
      const transferId = previous?.linkedTransferId || transaction.linkedTransferId || `txn-${transaction.id}`;
      const transfer: Transfer = {
        id: transferId,
        fromAccountId: transaction.type === 'expense' ? targetAccountId : null,
        toAccountId: transaction.type === 'income' ? targetAccountId : null,
        amount: Math.abs(transaction.amount),
        date: transaction.date,
        note: transaction.note || transaction.category,
        transactionId: transaction.id,
        goalId,
        createdAt: previous?.createdAt || new Date().toISOString(),
      };
      nextTransaction = {...nextTransaction, accountId: targetAccountId, linkedTransferId: transferId};
      firestoreTransaction.set(docRef(uid, 'transfers', transferId), clean(transfer));
    };

    if (previousGoalRef && previousGoal && previous?.linkedGoalEntryId) {
      if (previousGoal.accountId) {
        const previousTransferId = previous.linkedTransferId || previous.linkedGoalEntryId;
        const nextTransferId = previous.linkedTransferId || transaction.linkedTransferId || `txn-${transaction.id}`;
        const reusingTransfer = targetAccountId && previousTransferId === nextTransferId;
        if (!reusingTransfer) firestoreTransaction.delete(docRef(uid, 'transfers', previousTransferId));
        accountGoalIdsToSync.add(previousGoal.id);
      } else {
        const previousDeposits = (previousGoal.deposits || []).filter(
          item => item.id !== previous.linkedGoalEntryId
        );
        goalAfterPreviousRemoval = getGoalWithSavedAmount({...previousGoal, deposits: previousDeposits, savedAmount: 0});
        firestoreTransaction.set(previousGoalRef, clean(goalAfterPreviousRemoval));
      }
      nextTransaction.linkedGoalEntryId = undefined;
    }

    if (!nextGoalRef || !requestedGoal) {
      nextTransaction.goalId = undefined;
      nextTransaction.linkedGoalEntryId = undefined;
      if (targetAccountId) setAccountTransfer();
      else nextTransaction.linkedTransferId = undefined;
      persistTransactionAndReceipt();
      return;
    }

    const nextGoal = previous?.goalId === transaction.goalId && goalAfterPreviousRemoval
      ? goalAfterPreviousRemoval
      : requestedGoal;

    if (nextGoal.accountId) {
      setAccountTransfer(nextGoal.id);
      nextTransaction.linkedGoalEntryId = nextTransaction.linkedTransferId;
      persistTransactionAndReceipt();
      accountGoalIdsToSync.add(nextGoal.id);
      return;
    }

    const room = nextGoal.savedAmount;
    const appliedAmount = Math.min(Math.abs(transaction.amount), room);
    if (!appliedAmount) {
      nextTransaction.goalId = undefined;
      nextTransaction.linkedGoalEntryId = undefined;
      persistTransactionAndReceipt();
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
      deposits: [...(nextGoal.deposits || []), nextEntry]
    })));
    if (targetAccountId) setAccountTransfer();
    persistTransactionAndReceipt();
  });

  for (const goalId of accountGoalIdsToSync) await syncGoalSavedAmount(goalId);

  return savedTransaction;
}

export async function deleteTransactionWithGoalLink(transaction: Transaction): Promise<void> {
  const uid = getUid();
  let accountGoalId: string | undefined;
  await runTransaction(db, async firestoreTransaction => {
    if (transaction.goalId && transaction.linkedGoalEntryId) {
      const goalRef = docRef(uid, 'goals', transaction.goalId);
      const goalSnap = await firestoreTransaction.get(goalRef);
      if (goalSnap.exists()) {
        const goal = normalizeGoal(goalSnap.data() as Goal);
        if (goal.accountId) {
          firestoreTransaction.delete(docRef(uid, 'transfers', transaction.linkedTransferId || transaction.linkedGoalEntryId));
          accountGoalId = goal.id;
        } else {
          firestoreTransaction.set(goalRef, clean(getGoalWithSavedAmount({
            ...goal,
            savedAmount: 0,
            deposits: (goal.deposits || []).filter(item => item.id !== transaction.linkedGoalEntryId)
          })));
        }
      }
    }
    firestoreTransaction.delete(docRef(uid, 'transactions', transaction.id));
  });
  if (accountGoalId) await syncGoalSavedAmount(accountGoalId);
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

const BUDGET_MONTHS = 'budgetMonths';

/**
 * Budget record for one month. The current month always reads legacy
 * meta/budgets (the field both old and new app versions keep in sync, so it
 * can't go stale across devices); any other month reads its own
 * budgetMonths/{month} snapshot, or null if none was ever saved.
 */
export async function loadBudgetMonth(month: string): Promise<Record<string, number> | null> {
  const uid = getUid();
  const snap = await getDoc(docRef(uid, BUDGET_MONTHS, month));
  const monthDoc = snap.exists() ? (snap.data() as Record<string, number>) : null;
  const legacy = await loadBudgets();
  return resolveBudgetMonth(monthDoc, legacy, month, getCurrentMonthKey());
}

/**
 * Saves the current month's budgets, atomically dual-writing the legacy
 * meta/budgets document (kept in sync so older app versions on the other
 * device keep working) and budgetMonths/{currentMonth}.
 */
export async function saveCurrentMonthBudgets(data: Record<string, number>): Promise<void> {
  const uid = getUid();
  const month = getCurrentMonthKey();
  const batch = writeBatch(db);
  batch.set(metaRef(uid, 'budgets'), clean(data));
  batch.set(docRef(uid, BUDGET_MONTHS, month), clean(data));
  await batch.commit();
}

export async function loadBudgetRowsForMonth(month: string): Promise<Budget[] | null> {
  const record = await loadBudgetMonth(month);
  return record === null ? null : buildBudgetRows(record, month);
}

export async function loadBudgetRows(): Promise<Budget[]> {
  return (await loadBudgetRowsForMonth(getCurrentMonthKey())) ?? [];
}

export async function loadAllBudgetMonths(): Promise<{month: string; budgets: Record<string, number>}[]> {
  const uid = getUid();
  const snap = await getDocs(col(uid, BUDGET_MONTHS));
  return snap.docs
    .map(item => ({month: item.id, budgets: item.data() as Record<string, number>}))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export async function loadReceipts(): Promise<Receipt[]> {
  return loadCollection<Receipt>(getUid(), 'receipts');
}

export async function upsertReceipt(receipt: Receipt): Promise<void> {
  const uid = getUid();
  await setDoc(docRef(uid, 'receipts', receipt.id), clean(receipt));
}

export async function loadGoals(): Promise<Goal[]> {
  const uid = getUid();
  const [goals, accounts, transfers] = await Promise.all([
    loadCollection<Goal>(uid, 'goals'),
    loadCollection<Account>(uid, 'accounts'),
    loadCollection<Transfer>(uid, 'transfers'),
  ]);
  const accountsById = new Map(accounts.map(account => [account.id, account]));

  return goals.map(rawGoal => {
    const goal = normalizeGoal(rawGoal);
    if (!goal.accountId) return getGoalWithSavedAmount(goal);

    const account = accountsById.get(goal.accountId);
    const accountBalance = account ? calculateAccountBalance(account, transfers) : 0;
    const transferEntries = transfers
      .filter(transfer => transfer.goalId === goal.id && (
        transfer.fromAccountId === goal.accountId || transfer.toAccountId === goal.accountId
      ))
      .map(transfer => ({
        id: transfer.id,
        amount: transfer.amount,
        date: transfer.date,
        type: transfer.toAccountId === goal.accountId ? 'deposit' as const : 'withdraw' as const,
        note: transfer.note,
        linkedTransactionId: transfer.transactionId,
      }));
    return getGoalWithSavedAmount({...goal, deposits: transferEntries}, accountBalance);
  });
}

export async function upsertGoal(goal: Goal): Promise<void> {
  const uid = getUid();
  let nextGoal = getGoalWithSavedAmount(goal);
  if (goal.accountId) {
    const [accounts, transfers, existingSnap] = await Promise.all([
      loadAccounts(),
      loadTransfers(),
      getDoc(docRef(uid, 'goals', goal.id)),
    ]);
    const account = accounts.find(item => item.id === goal.accountId);
    if (!account) throw new Error('找不到儲蓄目標連結的帳戶。');
    const rawDeposits = existingSnap.exists() ? (existingSnap.data() as Goal).deposits : goal.deposits;
    nextGoal = getGoalWithSavedAmount(
      {...goal, deposits: rawDeposits},
      calculateAccountBalance(account, transfers)
    );
  }
  await setDoc(docRef(uid, 'goals', goal.id), clean(nextGoal));
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

  if (goal.accountId) {
    const room = entry.type === 'deposit'
      ? Math.max(0, goal.targetAmount - goal.savedAmount)
      : goal.savedAmount;
    const appliedAmount = Math.min(Math.abs(entry.amount), room);
    if (!appliedAmount) return {goal};
    const transfer: Transfer = {
      id: `goal-${goalId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      fromAccountId: entry.type === 'withdraw' ? goal.accountId : null,
      toAccountId: entry.type === 'deposit' ? goal.accountId : null,
      amount: appliedAmount,
      date: entry.date,
      note: entry.note,
      transactionId: entry.linkedTransactionId,
      goalId,
      createdAt: new Date().toISOString(),
    };
    await upsertTransfer(transfer);
    const nextGoal = await syncGoalSavedAmount(goalId);
    return {goal: nextGoal, entryId: transfer.id};
  }

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
  const nextGoal = getGoalWithSavedAmount({
    ...goal,
    deposits: [...(goal.deposits || []), nextEntry]
  });

  await upsertGoal(nextGoal);
  return {goal: nextGoal, entryId: nextEntry.id};
}

export async function removeGoalEntry(goalId: string, entryId: string): Promise<Goal | undefined> {
  const goals = await loadGoals();
  const goal = goals.find(item => item.id === goalId);
  if (!goal) return goal;

  if (goal.accountId) {
    const transfer = (await loadTransfers()).find(item => item.id === entryId && item.goalId === goalId);
    if (!transfer) return goal;
    await deleteTransfer(transfer.id);
    return syncGoalSavedAmount(goalId);
  }

  const targetEntry = (goal.deposits || []).find(item => item.id === entryId);
  if (!targetEntry) return goal;

  const nextGoal = getGoalWithSavedAmount({
    ...goal,
    savedAmount: 0,
    deposits: (goal.deposits || []).filter(item => item.id !== entryId)
  });
  await upsertGoal(nextGoal);
  return nextGoal;
}

export async function loadMerchants(): Promise<Merchant[]> {
  return loadCollection<Merchant>(getUid(), 'merchants');
}

export async function upsertMerchant(merchant: Merchant): Promise<void> {
  const uid = getUid();
  await setDoc(docRef(uid, 'merchants', merchant.id), clean(merchant));
}

export async function deleteMerchant(id: string): Promise<void> {
  const uid = getUid();
  await deleteDoc(docRef(uid, 'merchants', id));
}

export async function mergeMerchants(sourceId: string, targetId: string): Promise<Merchant> {
  if (sourceId === targetId) throw new Error('不能把商戶合併到自己。');
  const uid = getUid();
  const [sourceSnap, targetSnap, transactions] = await Promise.all([
    getDoc(docRef(uid, 'merchants', sourceId)),
    getDoc(docRef(uid, 'merchants', targetId)),
    loadTransactions(),
  ]);
  if (!sourceSnap.exists() || !targetSnap.exists()) throw new Error('找不到要合併的商戶。');
  const merged = mergeMerchantRecords(targetSnap.data() as Merchant, sourceSnap.data() as Merchant);
  const writes: RestoreWrite[] = [
    {kind: 'set', ref: docRef(uid, 'merchants', targetId), data: clean(merged)},
    {kind: 'delete', ref: docRef(uid, 'merchants', sourceId)},
  ];
  transactions
    .filter(item => item.merchantId === sourceId)
    .forEach(item => {
      writes.push({
        kind: 'set',
        ref: docRef(uid, 'transactions', item.id),
        data: clean({...item, merchantId: targetId}),
      });
    });
  await commitRestoreWrites(writes);
  return merged;
}

export async function loadPaymentInstruments(): Promise<PaymentInstrument[]> {
  return loadCollection<PaymentInstrument>(getUid(), 'paymentInstruments');
}

export async function upsertPaymentInstrument(instrument: PaymentInstrument): Promise<void> {
  const uid = getUid();
  await setDoc(docRef(uid, 'paymentInstruments', instrument.id), clean(instrument));
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

  return calculateAccountBalance(account, transfers);
}

export async function syncGoalSavedAmount(goalId: string): Promise<Goal | undefined> {
  const uid = getUid();
  const goalSnap = await getDoc(docRef(uid, 'goals', goalId));
  if (!goalSnap.exists()) return undefined;
  const rawGoal = normalizeGoal(goalSnap.data() as Goal);
  if (!rawGoal.accountId) return getGoalWithSavedAmount(rawGoal);

  const balance = await getAccountBalance(rawGoal.accountId);
  const nextGoal = getGoalWithSavedAmount(rawGoal, balance);
  if (nextGoal.savedAmount !== rawGoal.savedAmount) {
    await setDoc(docRef(uid, 'goals', rawGoal.id), clean(nextGoal));
  }

  return (await loadGoals()).find(item => item.id === goalId) || nextGoal;
}

export async function syncGoalsForAccount(accountId: string): Promise<void> {
  const goals = await loadCollection<Goal>(getUid(), 'goals');
  const linkedGoals = goals.filter(item => item.accountId === accountId);
  for (const goal of linkedGoals) {
    await syncGoalSavedAmount(goal.id);
  }
}

export async function syncAllGoalsFromAccounts(): Promise<void> {
  const goals = await loadCollection<Goal>(getUid(), 'goals');
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
  const accounts = await loadAccounts();
  assertAccountCurrency(transaction, accounts.find(item => item.id === accountId));
  const transfer: Transfer = {
    id: previousTransferId || transaction.linkedTransferId || `txn-${transaction.id}`,
    fromAccountId: transaction.type === 'expense' ? accountId : null,
    toAccountId: transaction.type === 'income' ? accountId : null,
    amount: transaction.amount,
    date: transaction.date,
    note: transaction.note || transaction.category,
    transactionId: transaction.id,
    goalId: transaction.goalId,
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

export async function createFinanceBackup(userEmail: string): Promise<FinanceBackup> {
  const uid = getUid();
  const [transactions, goals, budgets, receipts, subscriptions, accounts, transfers, budgetMonths, merchants, paymentInstruments] = await Promise.all([
    loadTransactions(),
    loadCollection<Goal>(uid, 'goals'),
    loadBudgets(),
    loadReceipts(),
    loadSubscriptions(),
    loadAccounts(),
    loadTransfers(),
    loadAllBudgetMonths(),
    loadMerchants(),
    loadPaymentInstruments(),
  ]);

  return {
    version: FINANCE_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    userEmail,
    transactions: [...transactions].sort((a, b) => a.date.localeCompare(b.date)),
    goals: goals
      .map(goal => goal.accountId ? normalizeGoal(goal) : getGoalWithSavedAmount(goal))
      .sort((a, b) => a.name.localeCompare(b.name)),
    subscriptions: [...subscriptions].sort((a, b) => a.name.localeCompare(b.name)),
    budgets,
    budgetMonths,
    receipts: [...receipts].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    accounts: [...accounts].sort((a, b) => a.name.localeCompare(b.name)),
    transfers: [...transfers].sort((a, b) => a.date.localeCompare(b.date)),
    merchants: [...merchants].sort((a, b) => a.name.localeCompare(b.name)),
    paymentInstruments: [...paymentInstruments].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

type RestoreWrite =
  | {kind: 'delete'; ref: DocumentReference<DocumentData>}
  | {kind: 'set'; ref: DocumentReference<DocumentData>; data: DocumentData};

async function appendCollectionRestoreWrites<T extends {id: string}>(
  writes: RestoreWrite[],
  uid: string,
  name: string,
  items: T[]
) {
  const current = await getDocs(col(uid, name));
  const targetIds = new Set(items.map(item => item.id));
  for (const currentDoc of current.docs) {
    if (!targetIds.has(currentDoc.id)) writes.push({kind: 'delete', ref: currentDoc.ref});
  }
  for (const item of items) {
    writes.push({kind: 'set', ref: docRef(uid, name, item.id), data: clean(item) as DocumentData});
  }
}

async function commitRestoreWrites(writes: RestoreWrite[]): Promise<void> {
  const chunkSize = 400;
  for (let start = 0; start < writes.length; start += chunkSize) {
    const batch = writeBatch(db);
    for (const write of writes.slice(start, start + chunkSize)) {
      if (write.kind === 'delete') batch.delete(write.ref);
      else batch.set(write.ref, write.data);
    }
    await batch.commit();
  }
}

export async function restoreFinanceBackup(backup: FinanceBackup): Promise<void> {
  const uid = getUid();
  const writes: RestoreWrite[] = [];

  await Promise.all([
    appendCollectionRestoreWrites(writes, uid, 'transactions', backup.transactions),
    appendCollectionRestoreWrites(writes, uid, 'goals', backup.goals),
    appendCollectionRestoreWrites(writes, uid, 'subscriptions', backup.subscriptions),
    appendCollectionRestoreWrites(writes, uid, 'receipts', backup.receipts),
    appendCollectionRestoreWrites(writes, uid, 'accounts', backup.accounts),
    appendCollectionRestoreWrites(writes, uid, 'transfers', backup.transfers),
    appendCollectionRestoreWrites(writes, uid, 'merchants', backup.merchants),
    appendCollectionRestoreWrites(writes, uid, 'paymentInstruments', backup.paymentInstruments),
  ]);

  const currentBudgetMonths = await getDocs(col(uid, BUDGET_MONTHS));
  const targetMonths = new Set(backup.budgetMonths.map(item => item.month));
  for (const currentDoc of currentBudgetMonths.docs) {
    if (!targetMonths.has(currentDoc.id)) writes.push({kind: 'delete', ref: currentDoc.ref});
  }
  for (const item of backup.budgetMonths) {
    writes.push({kind: 'set', ref: docRef(uid, BUDGET_MONTHS, item.month), data: clean(item.budgets)});
  }
  writes.push({kind: 'set', ref: metaRef(uid, 'budgets'), data: clean(backup.budgets)});

  await commitRestoreWrites(writes);
}

export async function clearSensitiveCache(): Promise<void> {
  // With Firestore as the data store, calling this function is a no-op.
  // Data lives in the cloud under the user's account.
  // To wipe all data, sign out or delete the account from Firebase Console.
}

export async function getMonthlySummary(month = getCurrentMonthKey(), currency = 'HKD') {
  const transactions = await getTransactionsByMonth(month);
  const baseCurrency = normalizeCurrency(currency);
  const matchingTransactions = transactions.filter(item => normalizeCurrency(item.currency) === baseCurrency);
  const income = sumMoney(matchingTransactions.filter(item => item.type === 'income').map(item => item.amount));
  const expense = sumMoney(matchingTransactions.filter(item => item.type === 'expense').map(item => item.amount));
  return {
    income,
    expense,
    balance: roundMoney(income - expense),
    count: matchingTransactions.length
  };
}

export async function getCategoryBreakdown(month = getCurrentMonthKey()): Promise<Record<string, number>> {
  const transactions = await getTransactionsByMonth(month);
  return sumExpensesByCategory(transactions);
}
