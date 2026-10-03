import {expect, it, vi} from 'vitest';
import {completeTransactionSave, sameTransaction} from './transactionEditing';
import type {Transaction} from '../types/finance';
const t: Transaction = {id: 'one', type: 'expense', amount: 10, currency: 'HKD', date: '2026-09-12', category: '飲食', createdAt: ''};
it('compares persisted snapshots independent of object key order and absent optional fields', () => {
  expect(sameTransaction(t, {...Object.fromEntries(Object.entries(t).reverse()), merchant: undefined} as Transaction)).toBe(true);
  expect(sameTransaction(t, {...t, amount: 11})).toBe(false);
  expect(sameTransaction(t, {...t, accountId: 'bank'})).toBe(false);
});
it('returns committed data and warnings even when multiple follow-ups fail', async () => {
  const run = vi.fn().mockRejectedValue(new Error('offline'));
  const result = await completeTransactionSave(t, [{label: '目標餘額', run}, {label: '分析更新', run: () => { throw new Error('sync failure'); }}]);
  expect(result).toEqual({transaction: t, warnings: ['目標餘額', '分析更新']});
  expect(run).toHaveBeenCalledTimes(1);
});

it('does not trap a committed edit behind a follow-up that never settles', async () => {
  vi.useFakeTimers();
  try {
    const run = vi.fn(() => new Promise(() => {}));
    const result = completeTransactionSave(t, [{label: '更新逾時', run}], 5000);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(result).resolves.toEqual({transaction: t, warnings: ['更新逾時']});
    expect(run).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});
