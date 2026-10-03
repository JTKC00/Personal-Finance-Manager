import {describe, expect, it} from 'vitest';
import {analysisKpiDelta, analysisKpiTone, buildAnalysisReport, detectAnalysisAnomalies, type AnalysisDirectories} from './analysisReport';
import {resolveAnalysisPeriod, type AnalysisSelection} from './analysisPeriod';
import type {Transaction} from '../types/finance';
const directories: AnalysisDirectories = {accounts: [], merchants: [], subscriptions: [], instruments: []};
const base: AnalysisSelection = {view: 'month', month: '2026-09', year: 2026, start: '2026-09-01', end: '2026-09-12', mode: 'previous_month', basis: 'aligned'};
function tx(id: string, date: string, amount: number, patch: Partial<Transaction> = {}): Transaction {
  return {id, date, amount, type: 'expense', currency: 'HKD', category: '餐飲', createdAt: `${date}T10:00:00Z`, ...patch};
}
const period = resolveAnalysisPeriod(base, '2026-09-12');
describe('shared analysis report', () => {
  it('uses the same date/currency scope for KPIs, groups and details', () => {
    const r = buildAnalysisReport(period, [tx('a', '2026-09-12', 120), tx('future', '2026-09-13', 999), tx('b', '2026-08-12', 60), tx('later', '2026-08-13', 999), tx('foreign', '2026-09-10', 77, {currency: 'USD'}), tx('income', '2026-09-01', 1000, {type: 'income'})], '2026-08-01', directories);
    expect(r.currentTotals).toMatchObject({expense: 120, income: 1000, dailyExpense: 10, transactionCount: 2});
    expect(r.comparisonTotals?.expense).toBe(60);
    expect(r.groups.category[0]).toMatchObject({currentAmount: 120, comparisonAmount: 60});
    expect(r.details('category', '餐飲', 'current').total).toBe(120);
    expect(r.details('category', '餐飲', 'comparison').rows.map(t => t.id)).toEqual(['b']);
    expect(r.foreign[0].expense).toBe(77);
    expect(r.projection).toBe(300);
  });
  it('reconstructs monthly averages from raw detail including covered empty months', () => {
    const r = buildAnalysisReport(resolveAnalysisPeriod({...base, mode: 'avg_3m'}, '2026-09-12'), [tx('a', '2026-09-10', 90), tx('b', '2026-08-10', 120), tx('c', '2026-07-10', 180)], '2026-06-01', directories);
    expect(r.available).toHaveLength(3);
    expect(r.comparisonTotals?.expense).toBe(100);
    expect(r.details('category', '餐飲', 'comparison')).toMatchObject({total: 300, average: 100});
    expect(r.groups.category[0].comparisonAmount).toBe(100);
  });
  it('computes average transaction size from raw counts, never rounded monthly counts', () => {
    const r = buildAnalysisReport(resolveAnalysisPeriod({...base, mode: 'avg_3m'}, '2026-09-12'), [tx('a', '2026-08-01', 100), tx('b', '2026-07-01', 200)], '2026-06-01', directories);
    expect(r.comparisonTotals?.expenseTransactionCount).toBe(0.7);
    expect(r.comparisonTotals?.averageExpense).toBe(150);
    expect(r.groups.category[0].comparisonAverage).toBe(150);
  });
  it('marks unknown history separately from a covered zero', () => {
    const unavailable = buildAnalysisReport(period, [tx('a', '2026-09-10', 90)], '2026-09-10', directories);
    expect(unavailable.comparisonTotals).toBeNull();
    expect(unavailable.trend[0].expense).toBeNull();
    const covered = buildAnalysisReport(period, [], '2026-07-01', directories);
    expect(covered.comparisonTotals?.expense).toBe(0);
    expect(covered.kpis.savingsRate.current).toBeNull();
    expect(buildAnalysisReport(period, [], null, directories).comparisonTotals).toBeNull();
  });
  it('flags partially recorded first intervals and retains cent precision in charts', () => {
    const r = buildAnalysisReport(period, [tx('a', '2026-08-10', 0.55)], '2026-08-10', directories);
    expect(r.coveragePartial).toBe(true);
    expect(r.trend.find(t => t.label === '2026-08')?.expense).toBe(0.55);
  });
  it('preserves deleted subscriptions and never classifies other spending as variable', () => {
    const r = buildAnalysisReport(period, [tx('a', '2026-09-10', 50, {subscriptionId: 'deleted'}), tx('b', '2026-09-10', 100)], '2026-08-01', directories);
    expect(r.groups.structure.map(g => g.currentAmount).reduce((a, b) => a + b)).toBe(r.currentTotals.expense);
    expect(r.details('subscription', 'id:deleted', 'current').total).toBe(50);
    expect(r.groups.structure.map(g => g.label)).toEqual(['其他支出', '訂閱連結支出']);
  });
  it('keeps linked and raw merchants separate and group filters identical to details', () => {
    const r = buildAnalysisReport(period, [tx('a', '2026-09-10', 20, {merchantId: 'm', merchantText: 'Cafe'}), tx('b', '2026-09-10', 30, {merchantText: 'Cafe'})], '2026-08-01', {...directories, merchants: [{id: 'm', name: 'Cafe', aliases: [], createdAt: ''}]});
    expect(r.groups.merchant).toHaveLength(2);
    for (const dimension of ['merchant', 'payment', 'instrument', 'account'] as const) {
      for (const row of r.groups[dimension]) expect(r.details(dimension, row.key, 'current').total).toBe(row.currentAmount);
    }
  });
  it('uses equal custom ranges and daily buckets, annual views have no monthly projection', () => {
    const p = resolveAnalysisPeriod({...base, view: 'custom', start: '2026-08-30', end: '2026-09-02'}, '2026-09-12');
    const r = buildAnalysisReport(p, [tx('a', '2026-08-29', 100), tx('b', '2026-09-01', 200)], '2026-01-01', directories);
    expect(r.currentTotals.dailyExpense).toBe(50);
    expect(r.comparisonTotals?.dailyExpense).toBe(25);
    expect(r.trend).toHaveLength(4);
    const annual = buildAnalysisReport(resolveAnalysisPeriod({...base, view: 'year'}, '2026-09-12'), [], null, directories);
    expect(annual.trend).toHaveLength(9);
    expect(annual.projection).toBeNull();
  });
  it('formats count deltas without dollars and uses metric-specific direction colors', () => {
    const r = buildAnalysisReport(period, [tx('a', '2026-09-10', 100, {type: 'income'})], '2026-08-01', directories);
    expect(analysisKpiDelta(r.kpis.transactionCount)).toContain('1 次');
    expect(analysisKpiDelta(r.kpis.transactionCount)).not.toContain('$');
    expect(analysisKpiTone(r.kpis.transactionCount)).toBe('info');
    expect(analysisKpiTone(r.kpis.income)).toBe('safe');
    expect(analysisKpiTone({...r.kpis.expense, absoluteDelta: 1})).toBe('warning');
    expect(analysisKpiDelta({...r.kpis.savingsRate, absoluteDelta: 0.05})).toContain('5.0 個百分點');
  });
});
describe('large expense evidence', () => {
  const samples = Array.from({length: 5}, (_, i) => tx(`s${i}`, '2026-08-01', 100));
  it('requires five same-category HKD expenses and both strict thresholds', () => {
    expect(detectAnalysisAnomalies([tx('a', '2026-09-01', 601)], samples)).toHaveLength(1);
    expect(detectAnalysisAnomalies([tx('a', '2026-09-01', 600)], samples)).toHaveLength(0);
    expect(detectAnalysisAnomalies([tx('a', '2026-09-01', 999)], samples.slice(1))).toHaveLength(0);
    expect(detectAnalysisAnomalies([tx('a', '2026-09-01', 999, {category: '交通'})], samples)).toHaveLength(0);
    expect(detectAnalysisAnomalies([tx('a', '2026-09-01', 999, {currency: 'USD'})], samples)).toHaveLength(0);
    expect(detectAnalysisAnomalies([tx('a', '2026-09-01', 900)], samples.map(t => ({...t, amount: 300})))).toHaveLength(0);
  });
  it('excludes samples outside the prior 90-day window and shows the median', () => {
    const r = buildAnalysisReport(period, [...samples, tx('old', '2026-01-01', 99999), tx('a', '2026-09-01', 601)], '2026-01-01', directories);
    expect(r.anomalies[0]).toMatchObject({median: 100, sampleCount: 5});
  });
});
