import {describe, expect, it} from 'vitest';
import {countFinanceBackupItems, diffFinanceBackups, financeBackupDataFingerprint, type FinanceBackup, validateFinanceBackup} from './financeBackup';

function makeBackup(patch: Partial<FinanceBackup> = {}): FinanceBackup {
  return {
    version: 5,
    exportedAt: '2026-08-07T12:00:00.000Z',
    userEmail: 'owner@example.com',
    transactions: [],
    goals: [],
    subscriptions: [],
    budgets: {},
    budgetMonths: [],
    receipts: [],
    accounts: [],
    transfers: [],
    ...patch,
  };
}

const transaction = {
  id: 'txn-1', type: 'expense' as const, amount: 20, currency: 'HKD', date: '2026-08-07',
  category: '飲食', createdAt: '2026-08-07T12:00:00.000Z'
};

describe('finance backup validation', () => {
  it('accepts a valid version 5 backup', () => {
    const result = validateFinanceBackup(makeBackup({
      transactions: [{...transaction, accountId: 'account-1', linkedTransferId: 'transfer-1'}],
      goals: [{
        id: 'goal-1', name: '緊急基金', targetAmount: 10000, savedAmount: 500,
        deposits: [{id: 'deposit-1', amount: 500, date: '2026-08-01', type: 'deposit'}],
        accountId: 'account-1'
      }],
      subscriptions: [{
        id: 'subscription-1', name: '雲端服務', amount: 68, currency: 'HKD', category: '工具',
        paymentMethod: '信用卡', frequency: 'monthly', nextBillingDate: '2026-09-01',
        reminderDays: 7, active: true, createdAt: '2026-08-01T00:00:00.000Z'
      }],
      budgets: {'飲食': 3000},
      budgetMonths: [{month: '2026-08', budgets: {'飲食': 3000}}],
      receipts: [{id: 'receipt-1', status: 'done', amount: 20, createdAt: '2026-08-07T12:00:00.000Z'}],
      accounts: [{id: 'account-1', name: '銀行', type: 'bank', initialBalance: 500, currency: 'HKD', createdAt: '2026-08-01T00:00:00.000Z'}],
      transfers: [{
        id: 'transfer-1', fromAccountId: 'account-1', toAccountId: null, amount: 20,
        date: '2026-08-07', transactionId: 'txn-1', createdAt: '2026-08-07T12:00:00.000Z'
      }],
    }));
    expect(result.ok).toBe(true);
  });

  it('rejects unsupported versions, malformed items, duplicate ids, and unknown fields', () => {
    const invalid = {
      ...makeBackup(),
      version: 3,
      unexpected: true,
      transactions: [transaction, {...transaction, amount: '20'}],
    };
    const result = validateFinanceBackup(invalid);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join('\n')).toContain('只支援 version 4 或 5');
    expect(result.errors.join('\n')).toContain('不受支援的欄位');
    expect(result.errors.join('\n')).toContain('transactions[1].amount');
    expect(result.errors.join('\n')).toContain('transactions[1].id 重複');
  });

  it('validates and migrates a version 4 backup to version 5', () => {
    const legacy = {...makeBackup(), version: 4};
    const result = validateFinanceBackup(legacy);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.backup.version).toBe(5);
  });

  it('round-trips OCR audit and transaction receipt links in version 5', () => {
    const audited = makeBackup({
      transactions: [{...transaction, receiptId: 'receipt-1'}],
      receipts: [{
        id: 'receipt-1', status: 'done', amount: 20, needsConfirm: false,
        createdAt: '2026-08-07T12:00:00.000Z', transactionId: 'txn-1',
        ai: {
          rawJson: '{"amount":20}',
          parsed: {
            amount: 20, merchant: '商戶', category: '購物', note: '', date: '2026-08-07',
            paymentMethodCandidates: [{method: '信用卡', evidence: 'visa', modelConfidence: 'high'}],
            modelConfidence: {amount: 'high', merchant: 'high', date: 'high', category: 'medium', paymentMethod: 'high'},
          },
          model: 'gemini-test', promptVersion: 'hk-receipt-v2', schemaVersion: 2,
          completedAt: '2026-08-07T12:00:01.000Z',
        },
        review: {
          final: {amount: 20, merchant: '商戶', category: '購物', note: '', date: '2026-08-07', paymentMethod: '信用卡'},
          changedFields: [], confirmedAt: '2026-08-07T12:01:00.000Z',
          duplicateDecision: 'none', duplicateTransactionIds: [],
        },
        duplicateCandidates: [],
      }],
    });
    const result = validateFinanceBackup(audited);
    expect(result).toEqual({ok: true, backup: audited});
  });

  it('rejects calendar dates that only resemble date keys', () => {
    const result = validateFinanceBackup(makeBackup({transactions: [{...transaction, date: '2026-02-31'}]}));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('\n')).toContain('有效的 YYYY-MM-DD');
  });
});

describe('finance backup preview', () => {
  it('reports additions, updates, and removals by stable item id', () => {
    const current = makeBackup({
      transactions: [transaction, {...transaction, id: 'txn-remove'}],
      budgets: {'飲食': 1000},
    });
    const incoming = makeBackup({
      transactions: [{...transaction, amount: 25}, {...transaction, id: 'txn-add'}],
      budgets: {'飲食': 1200, '交通': 500},
    });
    const diff = diffFinanceBackups(current, incoming);

    expect(diff.find(row => row.key === 'transactions')).toMatchObject({added: 1, updated: 1, removed: 1});
    expect(diff.find(row => row.key === 'budgets')).toMatchObject({added: 1, updated: 1, removed: 0});
    expect(countFinanceBackupItems(incoming)).toBe(4);
  });

  it('ignores export metadata and collection ordering when detecting current-data changes', () => {
    const first = makeBackup({transactions: [transaction, {...transaction, id: 'txn-2'}]});
    const second = makeBackup({
      exportedAt: '2026-08-08T12:00:00.000Z',
      transactions: [...first.transactions].reverse(),
    });
    expect(financeBackupDataFingerprint(first)).toBe(financeBackupDataFingerprint(second));
  });
});
