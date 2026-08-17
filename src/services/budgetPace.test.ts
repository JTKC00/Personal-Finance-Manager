import {describe, expect, it} from 'vitest';
import {buildAnalysisInsights} from './analysisInsights';
import {compareKpis, type PeriodTotals} from './comparisonEngine';
import {buildBudgetPace} from './budgetPace';

const currentTotals: PeriodTotals = {
  income: 20000,
  expense: 12300,
  balance: 7700,
  savingsRate: 0.385,
  dailyExpense: 768.75,
  transactionCount: 20,
  expenseTransactionCount: 18,
  averageExpense: 683.33,
};

const previousTotals: PeriodTotals = {
  income: 20000,
  expense: 10200,
  balance: 9800,
  savingsRate: 0.49,
  dailyExpense: 329.03,
  transactionCount: 16,
  expenseTransactionCount: 14,
  averageExpense: 728.57,
};

describe('budget pace', () => {
  it('projects overspend for the current month when spending is ahead of time', () => {
    const pace = buildBudgetPace({
      category: '餐飲',
      budgetAmount: 5000,
      spent: 3800,
      daysInMonth: 31,
      elapsedDays: 15,
      isCurrentMonth: true,
    });
    expect(pace.usedPercentage).toBe(76);
    expect(pace.monthProgressPercentage).toBe(48);
    expect(pace.status).toBe('ahead');
    expect(pace.projectedSpend).toBe(7853.33);
    expect(pace.projectedDelta).toBe(2853.33);
    expect(pace.remainingBudget).toBe(1200);
    expect(pace.remainingDays).toBe(16);
    expect(pace.safeDailySpend).toBe(75);
    expect(pace.currentDailySpend).toBe(253.33);
  });

  it('does not project remaining days for a historical month', () => {
    const pace = buildBudgetPace({
      category: '餐飲',
      budgetAmount: 5000,
      spent: 4200,
      daysInMonth: 31,
      elapsedDays: 31,
      isCurrentMonth: false,
    });
    expect(pace.remainingDays).toBe(0);
    expect(pace.safeDailySpend).toBeNull();
    expect(pace.projectedSpend).toBe(4200);
    expect(pace.status).toBe('on_track');
  });

  it('marks a month with no budget as none', () => {
    expect(buildBudgetPace({
      category: '餐飲',
      budgetAmount: 0,
      spent: 100,
      daysInMonth: 31,
      elapsedDays: 10,
      isCurrentMonth: true,
    }).status).toBe('none');
  });
});

describe('analysis insights', () => {
  it('builds deterministic insights from comparison, contribution, and budget pace', () => {
    const kpis = compareKpis(currentTotals, previousTotals);
    const insights = buildAnalysisInsights({
      mode: 'previous_month',
      hasComparisonData: true,
      expense: kpis.expense,
      savingsRate: kpis.savingsRate,
      contributions: [{
        category: '餐飲',
        currentAmount: 2200,
        comparisonAmount: 1000,
        delta: 1200,
        percentageDelta: 1.2,
        currentShare: 0.21,
        comparisonShare: 0.12,
        shareChange: 0.09,
        contribution: 0.5714,
        role: 'driver',
      }],
      budgetPaces: [],
      transactionCount: 20,
    });
    expect(insights.some(item => item.title.includes('總支出上升'))).toBe(true);
    expect(insights.some(item => item.detail.includes('個百分點'))).toBe(true);
    expect(insights.some(item => item.title.includes('餐飲'))).toBe(true);
    expect(insights.length).toBeGreaterThan(0);
    expect(insights.length).toBeLessThanOrEqual(5);
  });

  it('explains insufficient history, no budget, and an empty month', () => {
    const empty = compareKpis(currentTotals, null);
    expect(buildAnalysisInsights({
      mode: 'avg_12m',
      hasComparisonData: false,
      expense: empty.expense,
      savingsRate: empty.savingsRate,
      contributions: [],
      budgetPaces: [],
      transactionCount: 4,
    }).some(item => item.id === 'missing-comparison')).toBe(true);

    expect(buildAnalysisInsights({
      mode: 'none',
      hasComparisonData: false,
      expense: empty.expense,
      savingsRate: empty.savingsRate,
      contributions: [],
      budgetPaces: [],
      transactionCount: 0,
    })[0].id).toBe('empty-month');
  });

  const fakeComparativeContributions = [{
    category: '餐飲',
    currentAmount: 800,
    comparisonAmount: 0,
    delta: 800,
    percentageDelta: null,
    currentShare: 0.8,
    comparisonShare: 0,
    shareChange: 0.8,
    contribution: 1,
    role: 'driver' as const,
  }, {
    category: '購物',
    currentAmount: 200,
    comparisonAmount: 0,
    delta: 200,
    percentageDelta: null,
    currentShare: 0.2,
    comparisonShare: 0,
    shareChange: 0.2,
    contribution: 0,
    role: 'driver' as const,
  }];

  it('does not emit comparison insights when comparison data is unavailable', () => {
    const ids = buildAnalysisInsights({
      mode: 'avg_12m',
      hasComparisonData: false,
      expense: compareKpis(currentTotals, previousTotals).expense,
      savingsRate: compareKpis(currentTotals, previousTotals).savingsRate,
      contributions: fakeComparativeContributions,
      budgetPaces: [],
      transactionCount: 4,
    }).map(item => item.id);
    expect(ids).toContain('missing-comparison');
    expect(ids).not.toContain('expense-change');
    expect(ids).not.toContain('top-contribution');
    expect(ids).not.toContain('category-increase');
    expect(ids).not.toContain('share-jump');
    expect(ids).not.toContain('savings-rate');
  });

  it('does not emit comparison insights when the mode is none', () => {
    const ids = buildAnalysisInsights({
      mode: 'none',
      hasComparisonData: false,
      expense: compareKpis(currentTotals, previousTotals).expense,
      savingsRate: compareKpis(currentTotals, previousTotals).savingsRate,
      contributions: fakeComparativeContributions,
      budgetPaces: [],
      transactionCount: 4,
    }).map(item => item.id);
    expect(ids).not.toContain('missing-comparison');
    expect(ids).not.toContain('expense-change');
    expect(ids).not.toContain('top-contribution');
    expect(ids).not.toContain('category-increase');
    expect(ids).not.toContain('share-jump');
    expect(ids).not.toContain('savings-rate');
  });

  it('still emits comparative insights and a coverage warning for partial history', () => {
    const ids = buildAnalysisInsights({
      mode: 'avg_12m',
      hasComparisonData: true,
      coverageLabel: '此比較只根據 2 / 12 個月歷史資料。',
      expense: compareKpis(currentTotals, previousTotals).expense,
      savingsRate: compareKpis(currentTotals, previousTotals).savingsRate,
      contributions: [{
        category: '餐飲',
        currentAmount: 2200,
        comparisonAmount: 1000,
        delta: 1200,
        percentageDelta: 1.2,
        currentShare: 0.21,
        comparisonShare: 0.12,
        shareChange: 0.09,
        contribution: 0.5714,
        role: 'driver',
      }],
      budgetPaces: [],
      transactionCount: 20,
    }).map(item => item.id);
    expect(ids).toContain('partial-coverage');
    expect(ids).toContain('expense-change');
    expect(ids).not.toContain('missing-comparison');
  });
});
