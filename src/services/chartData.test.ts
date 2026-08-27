import {describe, expect, it} from 'vitest';
import type {Transaction} from '../types/finance';
import {buildDailySpendChartData, buildTrendChartData} from './chartData';

function tx(patch: Partial<Transaction> = {}): Transaction {
  return {
    id: patch.id || 'tx-1',
    type: patch.type || 'expense',
    amount: patch.amount ?? 100,
    currency: 'HKD',
    date: patch.date || '2026-08-10',
    category: patch.category || '餐飲',
    createdAt: '2026-08-10T00:00:00.000Z',
    ...patch,
  };
}

describe('buildTrendChartData', () => {
  it('keeps the six-month range, rounds plotted totals, and fills empty months', () => {
    const data = buildTrendChartData({
      '2026-07': [tx({id: 'july-expense', date: '2026-07-10', amount: 200})],
      '2026-08': [
        tx({id: 'august-income', type: 'income', amount: 1000.4}),
        tx({id: 'august-expense', amount: 250.6}),
      ],
    }, {
      selectedMonth: '2026-08',
      currentMonth: '2026-08',
      today: new Date(2026, 7, 16),
    });

    expect(data).toHaveLength(6);
    expect(data.map(item => item.month)).toEqual([
      '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08',
    ]);
    expect(data[0]).toEqual({month: '2026-03', label: '3月', income: 0, expense: 0, balance: 0});
    expect(data[4]).toEqual({month: '2026-07', label: '7月', income: 0, expense: 200, balance: -200});
    expect(data[5]).toEqual({month: '2026-08', label: '8月', income: 1000, expense: 251, balance: 750});
  });

  it('keeps trend totals isolated to the base currency', () => {
    const data = buildTrendChartData({
      '2026-08': [
        tx({id: 'hkd', amount: 100}),
        tx({id: 'usd', amount: 999, currency: 'USD'}),
      ],
    }, {
      selectedMonth: '2026-08',
      currentMonth: '2026-08',
      today: new Date(2026, 7, 16),
    });

    expect(data[5].expense).toBe(100);
  });
});

describe('buildDailySpendChartData', () => {
  it('aggregates expenses by day, keeps zero days, and ignores income or out-of-range dates', () => {
    expect(buildDailySpendChartData([
      tx({id: 'day-one-a', amount: 10.1, date: '2026-08-01'}),
      tx({id: 'day-one-b', amount: 0.2, date: '2026-08-01'}),
      tx({id: 'income', type: 'income', amount: 500, date: '2026-08-02'}),
      tx({id: 'day-four', amount: 3.333, date: '2026-08-04'}),
      tx({id: 'out-of-range', amount: 20, date: '2026-08-05'}),
    ], 4)).toEqual([
      {day: '1', amount: 10.3},
      {day: '2', amount: 0},
      {day: '3', amount: 0},
      {day: '4', amount: 3.33},
    ]);
  });
});
