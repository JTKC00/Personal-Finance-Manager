import {describe, expect, it, vi} from 'vitest';
import {buildMonthlyBudgetRows, buildMonthlyBudgetTotal, buildMonthlySpending} from './monthlySpending';
import {buildBudgetRows, formatDateKey, getSubscriptionChargesForMonth, sumExpensesByCategory, summarizeTransactionsByCurrency} from './financeLogic';
import {resolveAnalysisPeriod, type AnalysisSelection} from './analysisPeriod';
import {buildAnalysisReport} from './analysisReport';
import {createAnalysisLoader, type AnalysisSource} from './analysisLoader';
import {buildBudgetPaces} from './budgetPace';
import {sumMoney} from './money';
import type {Subscription, Transaction} from '../types/finance';

const month = '2026-09';
const today = '2026-09-12';
const tx = (id: string, patch: Partial<Transaction> = {}): Transaction => ({id, type: 'expense', date: today, category: '餐飲', amount: 100, currency: 'HKD', createdAt: `${today}T00:00:00Z`, ...patch});
const sub = (id: string, patch: Partial<Subscription> = {}): Subscription => ({id, name: id, amount: 80, currency: 'HKD', category: '餐飲', paymentMethod: '信用卡', frequency: 'monthly', nextBillingDate: '2026-09-20', reminderDays: 7, active: true, createdAt: `${month}-01T00:00:00Z`, ...patch});
const budgets = buildBudgetRows({餐飲: 500, 交通: 100}, month);
const selection: AnalysisSelection = {view: 'month', month, year: 2026, start: `${month}-01`, end: today, mode: 'previous_month', basis: 'aligned'};

describe('monthly spending scope', () => {
  it('includes today, separates both future income and expense, and excludes other months', () => {
    const data = buildMonthlySpending({month, today, subscriptions: [], transactions: [
      tx('prior', {date: '2026-08-31', amount: 999}), tx('first', {date: '2026-09-01', amount: 10}), tx('today', {amount: 20}),
      tx('future', {date: '2026-09-13', amount: 30}), tx('last', {date: '2026-09-30', amount: 40}),
      tx('next', {date: '2026-10-01', amount: 999}), tx('salary', {type: 'income', amount: 1000}),
      tx('future-salary', {type: 'income', date: '2026-09-30', amount: 2000}),
    ]});
    expect(data.base.actual).toMatchObject({income: 1000, expense: 30, balance: 970, count: 3});
    expect(data.base.future).toMatchObject({income: 2000, expense: 70, balance: 1930, count: 3});
    expect(data.base.knownExpense).toBe(100);
    expect(data.actualTransactions.map(t => t.id)).toEqual(['first', 'today', 'salary']);
    expect(data.futureTransactions.map(t => t.id)).toEqual(['future', 'future-salary', 'last']);
  });

  it('keeps every currency independent and only HKD consumes the category budget', () => {
    const data = buildMonthlySpending({month, today, transactions: [
      tx('hkd', {amount: 100, currency: ' hkd '}), tx('legacy', {amount: 0.3, currency: ''}),
      tx('usd', {amount: 70, currency: 'usd'}), tx('future-usd', {amount: 20, currency: ' USD ', date: '2026-09-25'}),
    ], subscriptions: [sub('usd-pending', {amount: 9.9, currency: 'USD'}), sub('jpy', {amount: 1000, currency: 'JPY'})]});
    expect(data.byCurrency.map(c => [c.currency, c.actual.expense, c.future.expense, c.pendingSubscriptionExpense, c.knownExpense]))
      .toEqual([['HKD', 100.3, 0, 0, 100.3], ['JPY', 0, 0, 1000, 1000], ['USD', 70, 20, 9.9, 99.9]]);
    expect(buildMonthlyBudgetRows(budgets, data)[0]).toMatchObject({spent: 100.3, future: 0, pending: 0, remaining: 399.7, projectedRemaining: 399.7});
    expect(buildMonthlyBudgetTotal(budgets, data).remaining).toBe(499.7);
  });

  it('counts a prefilled subscription once using its recorded amount and currency', () => {
    const data = buildMonthlySpending({month, today, subscriptions: [sub('prefilled')], transactions: [
      tx('future', {subscriptionId: 'prefilled', date: '2026-09-20', currency: 'USD', amount: 15}),
    ]});
    expect(data.pendingCharges).toEqual([]);
    expect(data.base.knownExpense).toBe(0);
    expect(data.byCurrency.find(c => c.currency === 'USD')).toMatchObject({actualSubscriptionExpense: 0, futureSubscriptionExpense: 15, knownSubscriptionExpense: 15});
  });

  it('does not suppress a pending expense using a linked income or a transaction outside this month', () => {
    const data = buildMonthlySpending({month, today, subscriptions: [sub('service')], transactions: [
      tx('income', {type: 'income', subscriptionId: 'service', date: '2026-09-20', amount: 10}),
      tx('prior', {subscriptionId: 'service', date: '2026-08-20'}),
    ]});
    expect(data.pendingCharges).toHaveLength(1);
    expect(data.base.knownExpense).toBe(80);
    expect(data.base.future.income).toBe(10);
  });

  it('keeps overdue and today unposted occurrences pending and never fabricates actual spending', () => {
    const data = buildMonthlySpending({month, today, transactions: [], subscriptions: [
      sub('overdue', {nextBillingDate: '2026-09-10'}), sub('today', {nextBillingDate: today, amount: 20}),
      sub('inactive', {active: false}),
    ]});
    expect(data.pendingCharges?.map(c => c.date)).toEqual(['2026-09-10', today]);
    expect(data.base.actual.expense).toBe(0);
    expect(data.base.pendingSubscriptionExpense).toBe(100);
  });

  it('retains recorded expenses linked to deleted or paused subscriptions', () => {
    const data = buildMonthlySpending({month, today, subscriptions: [sub('paused', {active: false})], transactions: [
      tx('deleted', {subscriptionId: 'deleted', amount: 25}),
      tx('paused', {subscriptionId: 'paused', date: '2026-09-20', amount: 30}),
    ]});
    expect(data.base).toMatchObject({actualSubscriptionExpense: 25, futureSubscriptionExpense: 30, pendingSubscriptionExpense: 0, knownSubscriptionExpense: 55});
  });

  it('handles weekly recurrence across year end, excluding the next month and existing occurrences', () => {
    const data = buildMonthlySpending({month: '2026-12', today: '2026-12-25',
      subscriptions: [sub('weekly', {frequency: 'weekly', nextBillingDate: '2026-12-17', amount: 0.1})],
      transactions: [tx('paid', {subscriptionId: 'weekly', date: '2026-12-24', amount: 0.1})]});
    expect(data.pendingCharges?.map(c => c.date)).toEqual(['2026-12-17', '2026-12-31']);
    expect(data.base.pendingSubscriptionExpense).toBe(0.2);
    expect(data.base.knownExpense).toBe(0.3);
  });

  it('handles leap day and moves a future record into actuals as the local date advances', () => {
    const transactions = [tx('leap', {date: '2024-02-29', amount: 25})];
    const before = buildMonthlySpending({month: '2024-02', today: formatDateKey(new Date(2024, 1, 28, 23, 59)), transactions, subscriptions: []});
    const after = buildMonthlySpending({month: '2024-02', today: formatDateKey(new Date(2024, 1, 29, 0, 1)), transactions, subscriptions: []});
    expect([before.base.actual.expense, before.base.future.expense]).toEqual([0, 25]);
    expect([after.base.actual.expense, after.base.future.expense]).toEqual([25, 0]);
    expect(after.base.knownExpense).toBe(before.base.knownExpense);
  });

  it('preserves actual amounts when subscription data is unavailable without assuming a zero reserve', () => {
    const data = buildMonthlySpending({month, today, transactions: [tx('actual')], subscriptions: null});
    expect(data.base.actual.expense).toBe(100);
    expect(data.pendingCharges).toBeNull();
    expect(data.base.knownExpense).toBeNull();
    expect(buildMonthlyBudgetRows(budgets, data)[0]).toMatchObject({spent: 100, pending: null, remaining: 400, projectedRemaining: null});
  });
});

describe('budget and screen consistency', () => {
  it('keeps actual usage distinct from commitments, including unbudgeted categories and future income', () => {
    const data = buildMonthlySpending({month, today, subscriptions: [sub('pending', {amount: 80})], transactions: [
      tx('spent', {amount: 100}), tx('future', {date: '2026-09-25', amount: 50}),
      tx('unbudgeted', {category: '其他', amount: 25}), tx('income', {type: 'income', date: '2026-09-25', amount: 900}),
    ]});
    expect(buildMonthlyBudgetRows(budgets, data)[0]).toMatchObject({spent: 100, future: 50, pending: 80, usedPercentage: 20, remaining: 400, knownExpense: 230, projectedRemaining: 270});
    expect(buildMonthlyBudgetTotal(budgets, data)).toMatchObject({spent: 125, knownExpense: 255, remaining: 475, projectedRemaining: 345});
  });

  it('shows overruns above 100% consistently while zero-budget categories are not progress rows', () => {
    const data = buildMonthlySpending({month, today, subscriptions: [], transactions: [tx('large', {amount: 1500})]});
    const rows = buildBudgetRows({餐飲: 100, 未設定: 0}, month);
    const actual = buildMonthlyBudgetRows(rows, data);
    const analysis = buildBudgetPaces(rows, data.base.spentByCategory, {elapsedDays: 12, daysInMonth: 30, isCurrentMonth: true});
    expect(actual).toHaveLength(1);
    expect(actual[0]).toMatchObject({usedPercentage: 1500, remaining: -1400, projectedRemaining: -1400});
    expect(analysis[0].usedPercentage).toBe(actual[0].usedPercentage);
  });

  it('matches previous totals for already-occurred HKD data, and explains every changed amount', () => {
    const actual = [tx('first', {amount: 0.1}), tx('second', {amount: 0.2}), tx('salary', {type: 'income', amount: 1000})];
    const subscriptions = [sub('pending')];
    const baseline = buildMonthlySpending({month, today, transactions: actual, subscriptions});
    expect(baseline.base.actual).toEqual(summarizeTransactionsByCurrency(actual)[0]);
    expect(baseline.base.spentByCategory).toEqual(sumExpensesByCategory(actual));
    expect(baseline.base.knownExpense).toBe(sumMoney([0.3, ...getSubscriptionChargesForMonth(subscriptions, month, actual, today, true).map(c => c.amount)]));
    const mixed = [...actual, tx('future', {date: '2026-09-25', amount: 40}), tx('foreign', {currency: 'USD', amount: 70})];
    const corrected = buildMonthlySpending({month, today, transactions: mixed, subscriptions});
    expect(corrected.base.actual.expense).toBe(0.3);
    expect(summarizeTransactionsByCurrency(mixed).find(c => c.currency === 'HKD')?.expense).toBe(40.3);
    expect(corrected.base.future.expense).toBe(40);
    expect(corrected.byCurrency.find(c => c.currency === 'USD')?.actual.expense).toBe(70);
  });

  it('loads the full current month for commitments without leaking future records into analysis KPIs or charts', async () => {
    const transactions = [tx('actual', {amount: 100}), tx('future', {date: '2026-09-25', amount: 9999}), tx('foreign', {currency: 'USD', amount: 10})];
    const source: AnalysisSource = {
      transactions: vi.fn(async (start, end) => transactions.filter(t => t.date >= start && t.date <= end)),
      earliest: async () => `${month}-01`, budgets: async () => budgets,
      merchants: async () => [], instruments: async () => [], accounts: async () => [], subscriptions: async () => [],
    };
    const period = resolveAnalysisPeriod(selection, today);
    const loaded = await createAnalysisLoader(source).load('synthetic-user', period);
    const report = buildAnalysisReport(period, loaded.transactions, loaded.earliest, loaded.directories);
    const overview = buildMonthlySpending({month, today, transactions, subscriptions: []});
    expect(loaded.transactions).toHaveLength(3);
    expect(report.currentTotals.expense).toBe(overview.base.actual.expense);
    expect(report.currentTotals.income).toBe(overview.base.actual.income);
    expect(report.foreign[0].expense).toBe(10);
    expect(report.trend.at(-1)?.expense).toBe(100);
    expect(report.projection).toBe(250);
    expect(buildMonthlyBudgetRows(budgets, overview)[0].spent).toBe(report.groups.category[0].currentAmount);
  });
});
