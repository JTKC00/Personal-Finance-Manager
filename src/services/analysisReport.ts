import type {Account, Merchant, PaymentInstrument, Subscription, Transaction} from '../types/finance';
import {analyzeCategoryContributionAcrossMonths, averagePeriodTotals, buildPeriodTotals, compareKpis, compareSpendGroupsAcrossMonths, filterTransactionsByCurrency, otherCurrencySummaries, type KpiComparison, type SpendGroupResolver} from './comparisonEngine';
import {resolveMerchantGroup} from './merchantIdentity';
import {resolveAccountGroup, resolvePaymentInstrumentGroup, resolvePaymentTypeGroup, resolveSubscriptionGroup} from './paymentInstrument';
import {addDays, inRange, monthEnd, monthsInRange, rangeDays, type AnalysisPeriod, type DateRange} from './analysisPeriod';
import {roundMoney, sumMoney} from './money';
import {formatMoney} from './chartFormatters';

export type AnalysisDirectories = {merchants: Merchant[]; instruments: PaymentInstrument[]; accounts: Account[]; subscriptions: Subscription[]};
export type AnalysisDimension = 'category' | 'merchant' | 'payment' | 'instrument' | 'account' | 'subscription' | 'structure';
export const DIMENSION_LABELS: Record<AnalysisDimension, string> = {category: '分類', merchant: '商戶', payment: '付款類型', instrument: '付款工具', account: '帳戶', subscription: '訂閱', structure: '支出結構'};

export function analysisGroupResolver(dimension: AnalysisDimension, directories: AnalysisDirectories): SpendGroupResolver {
  switch (dimension) {
    case 'category': return t => ({key: t.category, label: t.category, linked: true});
    case 'merchant': return t => resolveMerchantGroup(t, directories.merchants) ?? {key: 'unspecified', label: '未指定商戶', linked: false};
    case 'payment': return t => resolvePaymentTypeGroup(t, directories.instruments);
    case 'instrument': return t => resolvePaymentInstrumentGroup(t, directories.instruments);
    case 'account': return t => resolveAccountGroup(t, directories.accounts);
    case 'subscription': {
      const names = Object.fromEntries(directories.subscriptions.map(s => [s.id, s.name]));
      return t => resolveSubscriptionGroup(t, names);
    }
    case 'structure': return t => ({key: t.subscriptionId ? 'subscription' : 'other', label: t.subscriptionId ? '訂閱連結支出' : '其他支出', linked: true});
  }
}
export function totalsForRange(transactions: Transaction[], range: DateRange) {
  const totals = buildPeriodTotals(transactions.filter(t => inRange(t.date, range)), {month: range.start.slice(0, 7), currentMonth: ''});
  return {...totals, dailyExpense: roundMoney(totals.expense / rangeDays(range))};
}
export type AnalysisAnomaly = {transaction: Transaction; median: number; sampleCount: number};
export function detectAnalysisAnomalies(current: Transaction[], baseline: Transaction[]): AnalysisAnomaly[] {
  const samples = new Map<string, number[]>();
  filterTransactionsByCurrency(baseline).filter(t => t.type === 'expense').forEach(t => {
    const amounts = samples.get(t.category) || [];
    amounts.push(t.amount);
    samples.set(t.category, amounts);
  });
  const stats = new Map([...samples].filter(([, values]) => values.length >= 5).map(([category, values]) => {
    values.sort((a, b) => a - b);
    const half = Math.floor(values.length / 2);
    return [category, {median: values.length % 2 ? values[half] : (values[half - 1] + values[half]) / 2, sampleCount: values.length}] as const;
  }));
  return filterTransactionsByCurrency(current).flatMap(transaction => {
    const stat = stats.get(transaction.category);
    return transaction.type === 'expense' && stat && transaction.amount > stat.median * 3 && roundMoney(transaction.amount - stat.median) > 500
      ? [{transaction, ...stat}] : [];
  }).sort((a, b) => b.transaction.amount - a.transaction.amount);
}

export function buildAnalysisReport(period: AnalysisPeriod, allTransactions: Transaction[], earliest: string | null, directories: AnalysisDirectories) {
  const currentAll = allTransactions.filter(t => inRange(t.date, period.current));
  const current = filterTransactionsByCurrency(currentAll);
  // A loaded empty interval within recorded history is a real zero; time before history is unavailable.
  const available = period.comparisons.filter(range => earliest !== null && range.end >= earliest);
  const comparisonTransactions = available.map(range => filterTransactionsByCurrency(allTransactions.filter(t => inRange(t.date, range))));
  const monthlyComparison = Object.fromEntries(comparisonTransactions.map((items, index) => [String(index), items]));
  const keys = Object.keys(monthlyComparison);
  const currentTotals = totalsForRange(current, period.current);
  const comparisonTotals = averagePeriodTotals(available.map((range, index) => totalsForRange(comparisonTransactions[index], range)));
  const comparisonFlat = comparisonTransactions.flat();
  const comparisonExpenses = comparisonFlat.filter(t => t.type === 'expense');
  if (comparisonTotals) comparisonTotals.averageExpense = comparisonExpenses.length
    ? roundMoney(sumMoney(comparisonExpenses.map(t => t.amount)) / comparisonExpenses.length) : null;
  const resolvers = Object.fromEntries((Object.keys(DIMENSION_LABELS) as AnalysisDimension[]).map(d => [d, analysisGroupResolver(d, directories)])) as Record<AnalysisDimension, SpendGroupResolver>;
  const resolve = (dimension: AnalysisDimension) => resolvers[dimension];
  const groups = Object.fromEntries((Object.keys(DIMENSION_LABELS) as AnalysisDimension[]).map(dimension => {
    const rawGroups = new Map<string, number[]>();
    comparisonExpenses.forEach(t => {
      const key = resolve(dimension)(t)?.key;
      if (key !== undefined) {
        const amounts = rawGroups.get(key) || [];
        amounts.push(t.amount);
        rawGroups.set(key, amounts);
      }
    });
    const rows = compareSpendGroupsAcrossMonths(current, monthlyComparison, keys, resolve(dimension)).map(row => {
      const amounts = rawGroups.get(row.key) || [];
      return {...row, comparisonAverage: amounts.length ? roundMoney(sumMoney(amounts) / amounts.length) : null};
    });
    return [dimension, rows];
  })) as Record<AnalysisDimension, ReturnType<typeof compareSpendGroupsAcrossMonths>>;
  const details = (dimension: AnalysisDimension, key: string, side: 'current' | 'comparison') => {
    const rows = (side === 'current' ? current : comparisonFlat).filter(t => t.type === 'expense' && resolve(dimension)(t)?.key === key)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    const total = sumMoney(rows.map(t => t.amount));
    return {rows, total, average: side === 'comparison' && available.length ? roundMoney(total / available.length) : total};
  };
  const dailyTrend = period.view === 'custom' && rangeDays(period.current) <= 62;
  const trendRanges: DateRange[] = dailyTrend
    ? Array.from({length: rangeDays(period.current)}, (_, index) => ({start: addDays(period.current.start, index), end: addDays(period.current.start, index)}))
    : monthsInRange(period.trend).map(month => ({start: `${month}-01`, end: monthEnd(month) < period.trend.end ? monthEnd(month) : period.trend.end}))
      .map(range => ({...range, start: range.start < period.trend.start ? period.trend.start : range.start}));
  const trend = trendRanges.map(range => {
    const covered = earliest !== null && range.end >= earliest;
    const totals = totalsForRange(allTransactions, range);
    return {label: dailyTrend ? range.start.slice(5) : range.start.slice(0, 7), ...range,
      income: covered ? totals.income : null, expense: covered ? totals.expense : null};
  });
  const coveragePartial = available.length < period.comparisons.length || available.some(range => earliest !== null && earliest > range.start);
  return {
    current, currentTotals, comparisonTotals, groups, details, available,
    kpis: compareKpis(currentTotals, comparisonTotals),
    contributions: analyzeCategoryContributionAcrossMonths(current, monthlyComparison, keys),
    foreign: otherCurrencySummaries(currentAll),
    anomalies: detectAnalysisAnomalies(current, allTransactions.filter(t => inRange(t.date, period.baseline))),
    trend, coveragePartial,
    earliest,
    projection: period.isCurrentMonth ? roundMoney(currentTotals.expense / rangeDays(period.current) * Number(monthEnd(period.current.start.slice(0, 7)).slice(8))) : null,
  };
}
export type AnalysisReport = ReturnType<typeof buildAnalysisReport>;
export function analysisKpiDelta(kpi: KpiComparison): string | null {
  if (kpi.absoluteDelta === null) return null;
  const delta = kpi.absoluteDelta;
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  const value = kpi.key === 'transactionCount' ? `${Math.abs(delta)} 次`
    : kpi.deltaKind === 'percentage_points' ? `${Math.abs(delta * 100).toFixed(1)} 個百分點` : formatMoney(Math.abs(delta));
  const percent = kpi.deltaKind === 'relative' && kpi.percentageDelta !== null ? `（${kpi.percentageDelta > 0 ? '+' : ''}${(kpi.percentageDelta * 100).toFixed(1)}%）`
    : kpi.comparison === 0 && delta !== 0 ? '（比較期為 0）' : '';
  return `${delta > 0 ? '↑' : delta < 0 ? '↓' : '→'} ${sign}${value}${percent}`;
}
export function analysisKpiTone(kpi: KpiComparison): 'safe' | 'warning' | 'info' {
  if (kpi.key === 'transactionCount' || kpi.absoluteDelta === null || kpi.absoluteDelta === 0) return 'info';
  const higherBetter = ['income', 'balance', 'savingsRate'].includes(kpi.key);
  return (kpi.absoluteDelta > 0) === higherBetter ? 'safe' : 'warning';
}
