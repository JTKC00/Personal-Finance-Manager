import {afterAll, beforeEach, describe, expect, it} from 'vitest';
import {signInAnonymously, signOut} from 'firebase/auth';
import {doc, getDoc, setDoc} from 'firebase/firestore';
import {auth, db} from '../services/firebase';
import {financeBackupDataFingerprint, type FinanceBackup} from '../services/financeBackup';
import {
  createFinanceBackup,
  appendGoalEntry,
  deleteTransactionWithGoalLink,
  getAccountBalance,
  getCurrentMonthKey,
  getMonthlySummary,
  loadAllBudgetMonths,
  loadBudgetMonth,
  loadGoals,
  loadSubscriptions,
  loadTransactions,
  loadTransfers,
  processDueSubscriptions,
  removeGoalEntry,
  restoreFinanceBackup,
  saveCurrentMonthBudgets,
  saveTransactionWithGoalLink,
  syncTransactionTransfer,
  upsertAccount,
  upsertGoal,
  upsertMerchant,
  upsertPaymentInstrument,
  upsertSubscription,
  upsertTransaction,
  loadMerchants,
  loadPaymentInstruments,
  mergeMerchants,
} from '../services/storage';
import type {Account, Goal, Merchant, PaymentInstrument, Receipt, Subscription, Transaction} from '../types/finance';

const projectId = 'demo-personal-finance-manager';

function userDoc(...segments: string[]) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Integration test user is not authenticated');
  return doc(db, 'users', uid, ...segments);
}

function makeTransaction(patch: Partial<Transaction> = {}): Transaction {
  return {
    id: 'txn-1',
    type: 'expense',
    amount: 125.5,
    currency: 'HKD',
    date: '2026-08-07',
    category: '飲食',
    note: 'Integration transaction',
    createdAt: '2026-08-07T10:00:00.000Z',
    ...patch,
  };
}

beforeEach(async () => {
  if (auth.currentUser) await signOut(auth);
  const credential = await signInAnonymously(auth);
  expect(credential.user.uid).toBeTruthy();
});

afterAll(async () => {
  if (auth.currentUser) await signOut(auth);
});

describe('Firestore storage integration', () => {
  it('persists a new account transaction and its linked transfer', async () => {
    const account: Account = {
      id: 'account-1',
      name: '日常戶口',
      type: 'bank',
      initialBalance: 1000,
      currency: 'HKD',
      createdAt: '2026-08-01T00:00:00.000Z',
    };
    await upsertAccount(account);

    const goalLinkedTransaction = await saveTransactionWithGoalLink(makeTransaction({accountId: account.id}));
    const accountLinkedTransaction = await syncTransactionTransfer(goalLinkedTransaction);
    await upsertTransaction(accountLinkedTransaction);
    await upsertTransaction(makeTransaction({id: 'usd-transaction', currency: 'USD', amount: 100}));

    const [transactionDoc, transferDoc, transfers, balance, hkdSummary] = await Promise.all([
      getDoc(userDoc('transactions', 'txn-1')),
      getDoc(userDoc('transfers', 'txn-txn-1')),
      loadTransfers(),
      getAccountBalance(account.id),
      getMonthlySummary('2026-08', 'HKD'),
    ]);
    expect(transactionDoc.data()).toMatchObject({accountId: account.id, linkedTransferId: 'txn-txn-1'});
    expect(transferDoc.data()).toMatchObject({fromAccountId: account.id, amount: 125.5, transactionId: 'txn-1'});
    expect(transfers).toHaveLength(1);
    expect(balance).toBe(874.5);
    expect(hkdSummary).toEqual({income: 0, expense: 125.5, balance: -125.5, count: 1});
  });

  it('rejects a transaction whose currency differs from its account base currency', async () => {
    await upsertAccount({
      id: 'hkd-account',
      name: '港幣戶口',
      type: 'bank',
      initialBalance: 500,
      currency: 'HKD',
      createdAt: '2026-08-01T00:00:00.000Z',
    });
    const mismatched = makeTransaction({id: 'usd-on-hkd', accountId: 'hkd-account', currency: 'USD'});

    await expect(saveTransactionWithGoalLink(mismatched))
      .rejects.toThrow('交易幣別 USD 與帳戶基準幣別 HKD 不一致。');
    expect((await getDoc(userDoc('transactions', mismatched.id))).exists()).toBe(false);
  });

  it('atomically links an OCR transaction and its immutable review audit', async () => {
    const receipt: Receipt = {
      id: 'receipt-atomic',
      imageUri: 'private-receipt.jpg',
      status: 'done',
      needsConfirm: true,
      createdAt: '2026-08-10T12:00:00.000Z',
      ai: {
        rawJson: '{"amount":88}',
        parsed: {
          amount: 88,
          merchant: '茶記',
          category: '餐飲',
          note: '午餐',
          date: '2026-08-10',
          paymentMethodCandidates: [],
          modelConfidence: {amount: 'high', merchant: 'high', date: 'high', category: 'high', paymentMethod: 'low'},
        },
        model: 'gemini-test',
        promptVersion: 'hk-receipt-v2',
        schemaVersion: 2,
        completedAt: '2026-08-10T12:00:01.000Z',
      },
      review: {
        final: {amount: 90, merchant: '茶記', category: '餐飲', note: '午餐', date: '2026-08-10', paymentMethod: ''},
        changedFields: ['amount'],
        confirmedAt: '2026-08-10T12:01:00.000Z',
        duplicateDecision: 'none',
        duplicateTransactionIds: [],
      },
    };
    const saved = await saveTransactionWithGoalLink(
      makeTransaction({id: 'ocr-transaction', amount: 90, merchant: '茶記'}),
      undefined,
      receipt,
    );

    const [transactionDoc, receiptDoc] = await Promise.all([
      getDoc(userDoc('transactions', 'ocr-transaction')),
      getDoc(userDoc('receipts', receipt.id)),
    ]);
    expect(saved.receiptId).toBe(receipt.id);
    expect(transactionDoc.data()).toMatchObject({receiptId: receipt.id, amount: 90});
    expect(receiptDoc.data()).toMatchObject({transactionId: 'ocr-transaction', needsConfirm: false});
    expect(receiptDoc.data()?.ai.rawJson).toBe('{"amount":88}');
    expect(receiptDoc.data()?.review.changedFields).toEqual(['amount']);
  });

  it('derives a linked goal from its account ledger across deposits and transactions', async () => {
    const account: Account = {
      id: 'goal-account', name: '旅行戶口', type: 'bank', initialBalance: 4500,
      currency: 'HKD', createdAt: '2026-08-01T00:00:00.000Z',
    };
    const staleGoal: Goal = {
      id: 'trip-goal', name: '旅行基金', targetAmount: 10000, savedAmount: 5000,
      deposits: [{id: 'stale-deposit', amount: 5000, date: '2026-01-01', type: 'deposit'}],
      accountId: account.id,
    };
    await upsertAccount(account);
    await upsertGoal(staleGoal);

    let goal = (await loadGoals())[0];
    expect(goal).toMatchObject({savedAmount: 4500, deposits: []});

    const deposit = await appendGoalEntry(goal.id, {
      amount: 300, date: '2026-08-08', type: 'deposit', note: '每月儲蓄',
    });
    goal = (await loadGoals())[0];
    expect(goal.savedAmount).toBe(4800);
    expect(goal.deposits).toEqual([expect.objectContaining({id: deposit.entryId, amount: 300, type: 'deposit'})]);

    const expense = await saveTransactionWithGoalLink(makeTransaction({
      id: 'trip-expense', goalId: goal.id, amount: 200,
    }));
    goal = (await loadGoals())[0];
    expect(expense).toMatchObject({accountId: account.id, linkedTransferId: 'txn-trip-expense'});
    expect(goal.savedAmount).toBe(4600);
    expect(goal.deposits).toEqual(expect.arrayContaining([
      expect.objectContaining({id: 'txn-trip-expense', amount: 200, type: 'withdraw'}),
    ]));

    await deleteTransactionWithGoalLink(expense);
    await removeGoalEntry(goal.id, deposit.entryId as string);
    goal = (await loadGoals())[0];
    expect(goal).toMatchObject({savedAmount: 4500, deposits: []});
    expect((await getDoc(userDoc('goals', goal.id))).data()?.savedAmount).toBe(4500);
  });

  it('migrates a legacy standalone savedAmount to a removable opening ledger entry', async () => {
    await setDoc(userDoc('goals', 'legacy-goal'), {
      id: 'legacy-goal', name: '舊目標', targetAmount: 1000, savedAmount: 450,
    });

    let goal = (await loadGoals())[0];
    expect(goal).toMatchObject({savedAmount: 450});
    expect(goal.deposits).toEqual([expect.objectContaining({
      id: 'legacy-goal-legacy-opening-balance', amount: 450,
    })]);

    await removeGoalEntry(goal.id, 'legacy-goal-legacy-opening-balance');
    goal = (await loadGoals())[0];
    expect(goal).toMatchObject({savedAmount: 0, deposits: []});
  });

  it('auto-posts due subscriptions once and advances their billing state', async () => {
    const subscription: Subscription = {
      id: 'cloud-plan',
      name: '雲端方案',
      amount: 68,
      currency: 'HKD',
      category: '工具',
      paymentMethod: '信用卡',
      frequency: 'monthly',
      nextBillingDate: '2026-01-31',
      reminderDays: 7,
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    await upsertSubscription(subscription);

    await expect(processDueSubscriptions('2026-03-01')).resolves.toBe(2);
    await expect(processDueSubscriptions('2026-03-01')).resolves.toBe(0);

    const [transactions, subscriptions] = await Promise.all([loadTransactions(), loadSubscriptions()]);
    expect(transactions.map(item => item.id).sort()).toEqual([
      'sub-cloud-plan-2026-01-31',
      'sub-cloud-plan-2026-02-28',
    ]);
    expect(subscriptions[0]).toMatchObject({nextBillingDate: '2026-03-28', lastPostedDate: '2026-02-28'});
  });

  it('atomically dual-writes and reads the current monthly budget', async () => {
    const month = getCurrentMonthKey();
    const budgets = {'飲食': 3000, '交通': 800};
    await saveCurrentMonthBudgets(budgets);

    const [legacyDoc, monthDoc, loadedMonth, allMonths] = await Promise.all([
      getDoc(userDoc('meta', 'budgets')),
      getDoc(userDoc('budgetMonths', month)),
      loadBudgetMonth(month),
      loadAllBudgetMonths(),
    ]);
    expect(legacyDoc.data()).toEqual(budgets);
    expect(monthDoc.data()).toEqual(budgets);
    expect(loadedMonth).toEqual(budgets);
    expect(allMonths).toEqual([{month, budgets}]);
  });

  it('replaces Firestore data from a backup and removes records absent from it', async () => {
    await upsertTransaction(makeTransaction({id: 'old-transaction'}));
    await saveCurrentMonthBudgets({'飲食': 1000});
    const before = await createFinanceBackup('integration@example.com');
    const restoredTransaction = makeTransaction({id: 'restored-transaction', amount: 42});
    const target: FinanceBackup = {
      ...before,
      exportedAt: '2026-08-08T00:00:00.000Z',
      transactions: [restoredTransaction],
      budgets: {'交通': 600},
      budgetMonths: [{month: '2025-12', budgets: {'交通': 600}}],
    };

    await restoreFinanceBackup(target);

    const [oldDoc, restoredDoc, transactions, budgetMonths, current] = await Promise.all([
      getDoc(userDoc('transactions', 'old-transaction')),
      getDoc(userDoc('transactions', 'restored-transaction')),
      loadTransactions(),
      loadAllBudgetMonths(),
      createFinanceBackup('integration@example.com'),
    ]);
    expect(oldDoc.exists()).toBe(false);
    expect(restoredDoc.data()).toMatchObject({amount: 42, category: '飲食'});
    expect(transactions).toEqual([restoredTransaction]);
    expect(budgetMonths).toEqual([{month: '2025-12', budgets: {'交通': 600}}]);
    expect(financeBackupDataFingerprint(current)).toBe(financeBackupDataFingerprint(target));
  });

  it('merges merchants, relinks transactions, and preserves merchantText', async () => {
    const target: Merchant = {
      id: 'merch-target', name: '麥當勞', aliases: ["McDonald's"], createdAt: '2026-08-01T00:00:00.000Z',
    };
    const source: Merchant = {
      id: 'merch-source', name: 'M記', aliases: ['麥記'], createdAt: '2026-08-02T00:00:00.000Z',
    };
    await upsertMerchant(target);
    await upsertMerchant(source);
    await upsertTransaction(makeTransaction({
      id: 'linked-source',
      merchant: 'M記',
      merchantId: 'merch-source',
      merchantText: 'M記',
    }));

    const merged = await mergeMerchants('merch-source', 'merch-target');
    const [merchants, transaction] = await Promise.all([
      loadMerchants(),
      getDoc(userDoc('transactions', 'linked-source')),
    ]);

    expect(merged.aliases).toEqual(["McDonald's", '麥記', 'M記']);
    expect(merchants.map(item => item.id)).toEqual(['merch-target']);
    expect(transaction.data()).toMatchObject({
      merchantId: 'merch-target',
      merchantText: 'M記',
      merchant: 'M記',
    });
  });

  it('stores a payment instrument without a full card number and restores identity collections', async () => {
    const instrument: PaymentInstrument = {
      id: 'pay-1',
      name: 'HSBC Red Card',
      type: 'credit_card',
      last4: '1234',
      accountId: 'account-1',
      active: true,
      createdAt: '2026-08-01T00:00:00.000Z',
    };
    await upsertAccount({
      id: 'account-1', name: 'HSBC', type: 'credit', initialBalance: 0,
      currency: 'HKD', createdAt: '2026-08-01T00:00:00.000Z',
    });
    await upsertMerchant({
      id: 'merch-1', name: '茶記', aliases: [], createdAt: '2026-08-01T00:00:00.000Z',
    });
    await upsertPaymentInstrument(instrument);
    await upsertTransaction(makeTransaction({
      merchantId: 'merch-1',
      merchantText: '茶記',
      paymentInstrumentId: 'pay-1',
      paymentMethod: '信用卡',
    }));

    const backup = await createFinanceBackup('integration@example.com');
    expect(backup.version).toBe(6);
    expect(backup.paymentInstruments[0].last4).toBe('1234');
    expect(JSON.stringify(backup)).not.toContain('1234567890123456');

    await restoreFinanceBackup({
      ...backup,
      merchants: [],
      paymentInstruments: [{...instrument, active: false, name: '舊卡'}],
    });
    const [merchants, instruments] = await Promise.all([loadMerchants(), loadPaymentInstruments()]);
    expect(merchants).toEqual([]);
    expect(instruments).toMatchObject([{id: 'pay-1', name: '舊卡', active: false, last4: '1234'}]);
  });
});

describe('emulator isolation', () => {
  it('uses a demo project and enforces per-user Firestore rules', async () => {
    expect(projectId).toMatch(/^demo-/);
    expect(auth.app.options.projectId).toBe(projectId);

    const ownerUid = auth.currentUser?.uid;
    if (!ownerUid) throw new Error('Owner test user is not authenticated');
    await upsertTransaction(makeTransaction({id: 'private-transaction'}));
    await signOut(auth);
    await signInAnonymously(auth);

    await expect(getDoc(doc(db, 'users', ownerUid, 'transactions', 'private-transaction')))
      .rejects.toMatchObject({code: 'permission-denied'});
  });
});
