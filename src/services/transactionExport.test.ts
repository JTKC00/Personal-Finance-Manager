import {describe, expect, it} from 'vitest';
import type {Subscription, Transaction} from '../types/finance';
import {buildTransactionsCsv} from './transactionExport';

function transaction(patch: Partial<Transaction> = {}): Transaction {
  return {
    id: 'txn-1',
    type: 'expense',
    amount: 12.5,
    currency: 'HKD',
    date: '2026-10-03',
    category: '飲食',
    createdAt: '2026-10-03T00:00:00.000Z',
    ...patch,
  };
}

describe('transaction CSV export', () => {
  it('exports an explicit currency column and keeps currencies separated', () => {
    const csv = buildTransactionsCsv([
      transaction({id: 'usd', currency: 'usd', amount: 10, date: '2026-10-02'}),
      transaction({id: 'hkd', currency: 'HKD', amount: 20, date: '2026-10-03'}),
    ], []);

    expect(csv.split('\n')[0]).toBe(
      '"日期","類型","金額","幣別","分類","商戶","備註","付款方式","訂閱"'
    );
    expect(csv).toContain('"10","USD"');
    expect(csv).toContain('"20","HKD"');
  });

  it('falls back legacy blank currency to HKD and preserves CSV escaping', () => {
    const legacy = transaction({
      currency: '',
      merchantText: 'Cafe "A"',
      subscriptionId: 'sub-1',
    });
    const subscriptions: Pick<Subscription, 'id' | 'name'>[] = [
      {id: 'sub-1', name: 'Cloud, Plus'},
    ];

    const csv = buildTransactionsCsv([legacy], subscriptions);

    expect(csv).toContain('"12.5","HKD"');
    expect(csv).toContain('"Cafe ""A"""');
    expect(csv).toContain('"Cloud, Plus"');
  });
});
