import {describe, expect, it} from 'vitest';
import type {Transaction} from '../types/finance';
import {
  analyzeCategoryContribution,
  analyzeCategoryContributionAcrossMonths,
  averagePeriodTotals,
  buildComparisonResult,
  buildComparisonTotals,
  buildPeriodTotals,
  compareKpis,
  compareSpendGroups,
  compareSpendGroupsAcrossMonths,
  resolveComparisonCoverage,
  resolveComparisonMonths,
  shiftMonthKey,
} from './comparisonEngine';

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

const currentOptions = {month: '2026-08', currentMonth: '2026-08', today: new Date(2026, 7, 16)};

describe('resolveComparisonMonths', () => {
  it('resolves previous month, YoY, rolling averages, and none', () => {
    expect(resolveComparisonMonths('2026-08', 'none')).toEqual([]);
    expect(resolveComparisonMonths('2026-08', 'previous_month')).toEqual(['2026-07']);
    expect(resolveComparisonMonths('2026-01', 'previous_month')).toEqual(['2025-12']);
    expect(resolveComparisonMonths('2026-08', 'same_month_last_year')).toEqual(['2025-08']);
    expect(resolveComparisonMonths('2026-08', 'avg_3m')).toEqual(['2026-07', '2026-06', '2026-05']);
    expect(resolveComparisonMonths('2026-08', 'avg_6m')).toHaveLength(6);
    expect(resolveComparisonMonths('2026-08', 'avg_12m')).toEqual([
      '2026-07', '2026-06', '2026-05', '2026-04', '2026-03', '2026-02',
      '2026-01', '2025-12', '2025-11', '2025-10', '2025-09', '2025-08',
    ]);
    expect(shiftMonthKey('2026-03', -1)).toBe('2026-02');
  });
});

describe('buildPeriodTotals', () => {
  it('computes income, expense, balance, savings rate, daily spend, and averages', () => {
    const totals = buildPeriodTotals([
      tx({id: 'i1', type: 'income', amount: 10000, category: '薪資'}),
      tx({id: 'e1', amount: 1200, category: '餐飲'}),
      tx({id: 'e2', amount: 800, category: '交通'}),
    ], currentOptions);

    expect(totals).toMatchObject({
      income: 10000,
      expense: 2000,
      balance: 8000,
      savingsRate: 0.8,
      transactionCount: 3,
      expenseTransactionCount: 2,
      averageExpense: 1000,
    });
    expect(totals.dailyExpense).toBe(125);
  });

  it('treats a month with no transactions as zeros and a null savings rate', () => {
    const totals = buildPeriodTotals([], {month: '2026-07', currentMonth: '2026-08'});
    expect(totals).toEqual({
      income: 0,
      expense: 0,
      balance: 0,
      savingsRate: null,
      dailyExpense: 0,
      transactionCount: 0,
      expenseTransactionCount: 0,
      averageExpense: null,
    });
  });

  it('uses the full month length for historical daily spend', () => {
    const totals = buildPeriodTotals([tx({amount: 310})], {month: '2026-07', currentMonth: '2026-08'});
    expect(totals.dailyExpense).toBe(10);
  });
});

describe('compareKpis', () => {
  it('compares previous month values with relative and percentage-point deltas', () => {
    const current = buildPeriodTotals([
      tx({id: 'i1', type: 'income', amount: 20000, category: '薪資'}),
      tx({id: 'e1', amount: 12300, category: '餐飲'}),
    ], currentOptions);
    const previous = buildPeriodTotals([
      tx({id: 'i1', type: 'income', amount: 20000, date: '2026-07-10', category: '薪資'}),
      tx({id: 'e1', amount: 10200, date: '2026-07-10', category: '餐飲'}),
    ], {month: '2026-07', currentMonth: '2026-08'});

    const kpis = compareKpis(current, previous);
    expect(kpis.expense.current).toBe(12300);
    expect(kpis.expense.comparison).toBe(10200);
    expect(kpis.expense.absoluteDelta).toBe(2100);
    expect(kpis.expense.percentageDelta).toBe(0.2059);
    expect(kpis.expense.direction).toBe('up');
    expect(kpis.expense.deltaKind).toBe('relative');
    expect(kpis.savingsRate.deltaKind).toBe('percentage_points');
    expect(kpis.savingsRate.absoluteDelta).toBe(-0.105);
    expect(kpis.savingsRate.percentageDelta).toBe(-0.105);
    expect(kpis.savingsRate.direction).toBe('down');
    expect(kpis.balance.direction).toBe('down');
  });

  it('handles a zero baseline without dividing by zero', () => {
    const current = buildPeriodTotals([tx({amount: 80})], currentOptions);
    const empty = buildPeriodTotals([], {month: '2026-07', currentMonth: '2026-08'});
    const kpis = compareKpis(current, empty);
    expect(kpis.expense.absoluteDelta).toBe(80);
    expect(kpis.expense.percentageDelta).toBeNull();
    expect(kpis.expense.direction).toBe('up');
    expect(kpis.income.percentageDelta).toBe(0);
    expect(kpis.income.direction).toBe('flat');
  });

  it('returns no comparison when the mode is none', () => {
    const current = buildPeriodTotals([tx({amount: 80})], currentOptions);
    const kpis = compareKpis(current, null);
    expect(kpis.expense.comparison).toBeNull();
    expect(kpis.expense.absoluteDelta).toBeNull();
    expect(kpis.expense.percentageDelta).toBeNull();
    expect(kpis.expense.direction).toBe('none');
  });

  it('averages 3 / 6 / 12 prior months and reports a negative change', () => {
    const monthly: Record<string, Transaction[]> = {
      '2026-08': [tx({id: 'e1', amount: 900})],
      '2026-07': [tx({id: 'e2', amount: 1200, date: '2026-07-02'})],
      '2026-06': [tx({id: 'e3', amount: 1500, date: '2026-06-02'})],
      '2026-05': [tx({id: 'e4', amount: 1800, date: '2026-05-02'})],
    };
    const comparison = buildComparisonTotals('2026-08', 'avg_3m', monthly, {
      currentMonth: '2026-08',
      today: new Date(2026, 7, 16),
    });
    expect(comparison?.expense).toBe(1500);
    const current = buildPeriodTotals(monthly['2026-08'], currentOptions);
    const kpis = compareKpis(current, comparison);
    expect(kpis.expense.absoluteDelta).toBe(-600);
    expect(kpis.expense.percentageDelta).toBe(-0.4);
    expect(kpis.expense.direction).toBe('down');
    expect(averagePeriodTotals([
      buildPeriodTotals(monthly['2026-07'], {month: '2026-07', currentMonth: '2026-08'}),
      buildPeriodTotals(monthly['2026-06'], {month: '2026-06', currentMonth: '2026-08'}),
    ])?.expense).toBe(1350);
  });
});

describe('analyzeCategoryContribution', () => {
  const current = [
    tx({id: 'food', amount: 2200, category: '餐飲'}),
    tx({id: 'shop', amount: 1700, category: '購物'}),
    tx({id: 'transit', amount: 850, category: '交通'}),
    tx({id: 'fun', amount: 350, category: '娛樂'}),
  ];
  const previous = [
    tx({id: 'food', amount: 1000, category: '餐飲'}),
    tx({id: 'shop', amount: 1000, category: '購物'}),
    tx({id: 'transit', amount: 500, category: '交通'}),
    tx({id: 'fun', amount: 500, category: '娛樂'}),
  ];

  it('explains a spending increase by category contribution', () => {
    const rows = analyzeCategoryContribution(current, previous);
    expect(rows.find(item => item.category === '餐飲')).toMatchObject({
      currentAmount: 2200,
      comparisonAmount: 1000,
      delta: 1200,
      contribution: 0.5714,
      role: 'driver',
    });
    expect(rows.find(item => item.category === '購物')?.contribution).toBe(0.3333);
    expect(rows.find(item => item.category === '交通')?.contribution).toBe(0.1667);
    expect(rows.find(item => item.category === '娛樂')).toMatchObject({
      delta: -150,
      contribution: -0.0714,
      role: 'offset',
    });
  });

  it('treats a spending decrease as contributions to the drop', () => {
    const rows = analyzeCategoryContribution(previous, current);
    const food = rows.find(item => item.category === '餐飲');
    expect(food?.delta).toBe(-1200);
    expect(food?.role).toBe('driver');
    expect(food?.contribution).toBe(-0.5714);
    expect(rows.find(item => item.category === '娛樂')?.role).toBe('offset');
  });

  it('includes a new category and a disappeared category', () => {
    const rows = analyzeCategoryContribution(
      [tx({id: 'new', amount: 400, category: '醫療'})],
      [tx({id: 'old', amount: 250, category: '保險'})]
    );
    expect(rows.find(item => item.category === '醫療')).toMatchObject({
      comparisonAmount: 0,
      percentageDelta: null,
      currentShare: 1,
      comparisonShare: 0,
    });
    expect(rows.find(item => item.category === '保險')).toMatchObject({
      currentAmount: 0,
      comparisonShare: 1,
      currentShare: 0,
    });
  });
});

describe('multi-currency isolation', () => {
  it('does not mix HKD and USD in KPI, comparison, category, or grouped analysis', () => {
    const current = [
      tx({id: 'hkd-1', amount: 1000, category: '餐飲'}),
      tx({id: 'usd-1', amount: 100, currency: 'USD', category: '餐飲'}),
    ];
    const previous = [
      tx({id: 'hkd-2', amount: 400, date: '2026-07-10', category: '餐飲'}),
      tx({id: 'usd-2', amount: 80, currency: 'USD', date: '2026-07-10', category: '餐飲'}),
    ];
    expect(buildPeriodTotals(current, currentOptions).expense).toBe(1000);
    expect(buildComparisonTotals('2026-08', 'previous_month', {
      '2026-08': current,
      '2026-07': previous,
    }, {currentMonth: '2026-08', today: new Date(2026, 7, 16), historyStartMonth: '2026-07'})?.expense).toBe(400);
    expect(analyzeCategoryContribution(current, previous).find(item => item.category === '餐飲')).toMatchObject({
      currentAmount: 1000,
      comparisonAmount: 400,
    });
    expect(compareSpendGroups(current, previous, () => ({key: 'food', label: '餐飲', linked: true}))[0]).toMatchObject({
      currentAmount: 1000,
      comparisonAmount: 400,
    });
  });

  it('keeps budget-facing category maps on the analysis currency', () => {
    const mixed = [
      tx({id: 'hkd', amount: 3800, category: '餐飲'}),
      tx({id: 'usd', amount: 900, currency: 'USD', category: '餐飲'}),
    ];
    expect(analyzeCategoryContribution(mixed, []).find(item => item.category === '餐飲')?.currentAmount).toBe(3800);
  });
});

describe('historical coverage', () => {
  it('does not treat months before the first recorded transaction as zero spend', () => {
    const coverage = resolveComparisonCoverage('2026-08', 'avg_12m', '2026-06');
    expect(coverage).toMatchObject({
      requestedPeriods: 12,
      availablePeriods: 2,
    });
    expect(coverage.availableMonths).toEqual(['2026-07', '2026-06']);

    const result = buildComparisonResult('2026-08', 'avg_12m', {
      '2026-08': [tx({id: 'now', amount: 900})],
      '2026-07': [tx({id: 'jul', amount: 300, date: '2026-07-02'})],
      '2026-06': [tx({id: 'jun', amount: 500, date: '2026-06-02'})],
    }, {currentMonth: '2026-08', today: new Date(2026, 7, 16), historyStartMonth: '2026-06'});
    expect(result.coverage.availablePeriods).toBe(2);
    expect(result.totals?.expense).toBe(400);
  });

  it('returns no comparison when there is no historical coverage', () => {
    const result = buildComparisonResult('2026-08', 'previous_month', {
      '2026-08': [tx({amount: 100})],
    }, {currentMonth: '2026-08', today: new Date(2026, 7, 16), historyStartMonth: '2026-08'});
    expect(result.totals).toBeNull();
    expect(result.coverage.availablePeriods).toBe(0);
  });
});

describe('compareSpendGroups', () => {
  it('aggregates amount, count, and average for a group key', () => {
    const rows = compareSpendGroups(
      [tx({id: 'a1', amount: 40}), tx({id: 'a2', amount: 60})],
      [tx({id: 'b1', amount: 20})],
      () => ({key: 'm1', label: '麥當勞', linked: true})
    );
    expect(rows[0]).toMatchObject({
      label: '麥當勞',
      currentAmount: 100,
      comparisonAmount: 20,
      delta: 80,
      percentageDelta: 4,
      currentCount: 2,
      currentAverage: 50,
    });
  });

  it('averages monthly merchant aggregates instead of scaling raw transactions', () => {
    const current = [tx({id: 'aug-1', amount: 200}), tx({id: 'aug-2', amount: 200})];
    const monthly = {
      '2026-07': Array.from({length: 6}, (_, index) => tx({id: `jul-${index}`, amount: 50, date: '2026-07-02'})),
      '2026-06': Array.from({length: 10}, (_, index) => tx({id: `jun-${index}`, amount: 50, date: '2026-06-02'})),
      '2026-05': Array.from({length: 8}, (_, index) => tx({id: `may-${index}`, amount: 50, date: '2026-05-02'})),
    };
    const rows = compareSpendGroupsAcrossMonths(
      current,
      monthly,
      ['2026-07', '2026-06', '2026-05'],
      () => ({key: 'mcd', label: '麥當勞', linked: true})
    );
    expect(rows[0]).toMatchObject({
      comparisonAmount: 400,
      comparisonCount: 8,
      comparisonAverage: 50,
    });
  });

  it('includes in-coverage months that lack the group as true zeros and supports 6M / 12M / new / disappeared groups', () => {
    const current = [tx({id: 'new', amount: 90, category: '醫療'})];
    const monthly: Record<string, Transaction[]> = {
      '2026-07': [tx({id: 'old', amount: 120, date: '2026-07-02', category: '保險'})],
      '2026-06': [],
      '2026-05': [tx({id: 'old-2', amount: 180, date: '2026-05-02', category: '保險'})],
    };
    const rows = compareSpendGroupsAcrossMonths(
      current,
      monthly,
      ['2026-07', '2026-06', '2026-05'],
      transaction => ({key: transaction.category, label: transaction.category, linked: true})
    );
    expect(rows.find(item => item.key === '醫療')).toMatchObject({
      currentAmount: 90,
      comparisonAmount: 0,
      comparisonCount: 0,
    });
    expect(rows.find(item => item.key === '保險')).toMatchObject({
      currentAmount: 0,
      comparisonAmount: 100,
      comparisonCount: 0.7,
    });

    const byCategory = (transaction: Transaction) => ({key: transaction.category, label: transaction.category, linked: true});
    const six = compareSpendGroupsAcrossMonths(current, monthly, ['2026-07', '2026-06', '2026-05', '2026-04', '2026-03', '2026-02'], byCategory);
    expect(six.find(item => item.key === '醫療')?.comparisonAmount).toBe(0);
    const twelveMonths = Array.from({length: 12}, (_, index) => shiftMonthKey('2026-08', -(index + 1)));
    const twelve = compareSpendGroupsAcrossMonths(current, monthly, twelveMonths, byCategory);
    expect(twelve.find(item => item.key === '醫療')?.comparisonCount).toBe(0);
  });

  it('averages category contribution from monthly totals, not scaled transaction rows', () => {
    const rows = analyzeCategoryContributionAcrossMonths(
      [tx({id: 'now', amount: 900, category: '餐飲'})],
      {
        '2026-07': [tx({id: 'j1', amount: 300, date: '2026-07-02', category: '餐飲'})],
        '2026-06': [tx({id: 'n1', amount: 500, date: '2026-06-02', category: '餐飲'})],
        '2026-05': [tx({id: 'm1', amount: 400, date: '2026-05-02', category: '餐飲'})],
      },
      ['2026-07', '2026-06', '2026-05']
    );
    expect(rows[0]).toMatchObject({
      currentAmount: 900,
      comparisonAmount: 400,
      delta: 500,
    });
  });
});
