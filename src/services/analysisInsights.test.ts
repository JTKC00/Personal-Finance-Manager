import {describe, expect, it} from 'vitest';
import {buildAnalysisInsights} from './analysisInsights';
import {analyzeCategoryContribution, buildPeriodTotals, compareKpis} from './comparisonEngine';
import type {Transaction} from '../types/finance';
const t: Transaction = {id: 'a', type: 'expense', amount: 100, currency: 'HKD', date: '2026-09-01', category: '餐飲', createdAt: ''};
const totals = buildPeriodTotals([t], {month: '2026-09', currentMonth: ''});
const kpis = compareKpis(totals, null);
const options = {mode: 'previous_month' as const, hasComparisonData: false, expense: kpis.expense, savingsRate: kpis.savingsRate, contributions: [], budgetPaces: [], transactionCount: 1};
describe('analysis insight wording', () => {
  it('does not claim no budget when the budget is unavailable', () => {
    expect(buildAnalysisInsights({...options, budgetAvailable: false}).some(i => i.id === 'no-budget')).toBe(false);
    expect(buildAnalysisInsights(options).some(i => i.id === 'no-budget')).toBe(true);
  });
  it('uses selected-period language and explicit comparison labels', () => {
    const compared = compareKpis(totals, {...totals, expense: 0});
    const insights = buildAnalysisInsights({...options, expense: compared.expense, savingsRate: compared.savingsRate, hasComparisonData: true, comparisonLabel: '前一等長期間', periodLabel: '所選期間'});
    expect(insights.find(i => i.id === 'expense-change')?.title).toBe('所選期間總支出上升');
    expect(insights.find(i => i.id === 'expense-change')?.detail).toContain('前一等長期間');
    expect(insights.find(i => i.id === 'expense-change')?.detail).toContain('比較期支出為 0');
  });
  it('gives an empty-period message instead of asserting financial stability', () => {
    expect(buildAnalysisInsights({...options, transactionCount: 0, periodLabel: '所選期間'})).toMatchObject([{id: 'empty-month', title: '所選期間還沒有交易', tone: 'info'}]);
  });
  it('explains contributions above 100 percent caused by offsets', () => {
    const current = [t, {...t, id: 'b', amount: 10, category: '交通'}];
    const previous = [{...t, amount: 10}, {...t, id: 'b', amount: 50, category: '交通'}];
    const next = compareKpis(buildPeriodTotals(current, {month: '2026-09', currentMonth: ''}), buildPeriodTotals(previous, {month: '2026-08', currentMonth: ''}));
    const insights = buildAnalysisInsights({...options, expense: next.expense, hasComparisonData: true, contributions: analyzeCategoryContribution(current, previous)});
    expect(insights.find(i => i.id === 'top-contribution')?.detail).toContain('其他分類抵銷');
  });
});
