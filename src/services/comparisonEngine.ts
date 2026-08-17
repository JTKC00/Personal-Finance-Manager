import {roundMoney, sumMoney} from './money';
import {normalizeCurrency, sumExpensesByCategory, summarizeTransactionsByCurrency} from './financeLogic';
import type {Transaction} from '../types/finance';

export const ANALYSIS_BASE_CURRENCY = 'HKD';

export type ComparisonMode =
  | 'none'
  | 'previous_month'
  | 'same_month_last_year'
  | 'avg_3m'
  | 'avg_6m'
  | 'avg_12m';

export const COMPARISON_MODE_LABELS: Record<ComparisonMode, string> = {
  none: '不比較',
  previous_month: '上月',
  same_month_last_year: '去年同月',
  avg_3m: '過去 3 個月平均',
  avg_6m: '過去 6 個月平均',
  avg_12m: '過去 12 個月平均',
};

export type KpiKey =
  | 'income'
  | 'expense'
  | 'balance'
  | 'savingsRate'
  | 'dailyExpense'
  | 'transactionCount'
  | 'averageExpense';

export type KpiDirection = 'up' | 'down' | 'flat' | 'none';
export type KpiDeltaKind = 'relative' | 'percentage_points';

export type KpiComparison = {
  key: KpiKey;
  current: number | null;
  comparison: number | null;
  absoluteDelta: number | null;
  percentageDelta: number | null;
  direction: KpiDirection;
  deltaKind: KpiDeltaKind;
};

export type PeriodTotals = {
  income: number;
  expense: number;
  balance: number;
  savingsRate: number | null;
  dailyExpense: number;
  transactionCount: number;
  expenseTransactionCount: number;
  averageExpense: number | null;
};

export type CategoryContribution = {
  category: string;
  currentAmount: number;
  comparisonAmount: number;
  delta: number;
  percentageDelta: number | null;
  currentShare: number;
  comparisonShare: number;
  shareChange: number;
  contribution: number;
  role: 'driver' | 'offset' | 'neutral';
};

export type SpendGroupComparison = {
  key: string;
  label: string;
  linked: boolean;
  currentAmount: number;
  comparisonAmount: number;
  delta: number;
  percentageDelta: number | null;
  currentCount: number;
  comparisonCount: number;
  currentAverage: number | null;
  comparisonAverage: number | null;
};

export type ComparisonCoverage = {
  requestedPeriods: number;
  availablePeriods: number;
  coverageRatio: number;
  requestedMonths: string[];
  availableMonths: string[];
};

export type ComparisonResult = {
  totals: PeriodTotals | null;
  coverage: ComparisonCoverage;
};

export type SpendGroupResolver = (transaction: Transaction) => {key: string; label: string; linked: boolean} | null;

const KPI_KEYS: KpiKey[] = [
  'income', 'expense', 'balance', 'savingsRate', 'dailyExpense', 'transactionCount', 'averageExpense',
];

export function roundRatio(value: number, digits = 4): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function shiftMonthKey(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function getMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return `${year} 年 ${month} 月`;
}

export function getShortMonthLabel(monthKey: string): string {
  const [, month] = monthKey.split('-').map(Number);
  return `${month}月`;
}

export function daysInMonthKey(monthKey: string): number {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(year, month, 0).getDate();
}

export function listMonthRange(endMonth: string, count: number): string[] {
  return Array.from({length: count}, (_, index) => shiftMonthKey(endMonth, index - count + 1));
}

export function listPriorMonths(selectedMonth: string, count: number): string[] {
  return Array.from({length: count}, (_, index) => shiftMonthKey(selectedMonth, -(index + 1)));
}

export function resolveComparisonMonths(selectedMonth: string, mode: ComparisonMode): string[] {
  if (mode === 'none') return [];
  if (mode === 'previous_month') return [shiftMonthKey(selectedMonth, -1)];
  if (mode === 'same_month_last_year') return [shiftMonthKey(selectedMonth, -12)];
  if (mode === 'avg_3m') return listPriorMonths(selectedMonth, 3);
  if (mode === 'avg_6m') return listPriorMonths(selectedMonth, 6);
  return listPriorMonths(selectedMonth, 12);
}

export function monthsNeededForAnalysis(selectedMonth: string, mode: ComparisonMode, trendMonths = 6): string[] {
  const months = new Set([
    ...listMonthRange(selectedMonth, trendMonths),
    selectedMonth,
    ...resolveComparisonMonths(selectedMonth, mode),
  ]);
  return [...months].sort();
}

export function filterTransactionsByCurrency(
  transactions: Transaction[],
  currency = ANALYSIS_BASE_CURRENCY
): Transaction[] {
  const base = normalizeCurrency(currency);
  return transactions.filter(item => normalizeCurrency(item.currency) === base);
}

export function historyStartMonthFromTransactions(transactions: Transaction[]): string | null {
  const dates = transactions.map(item => item.date).filter(Boolean).sort();
  return dates[0] ? dates[0].slice(0, 7) : null;
}

export function inferHistoryStartMonth(monthlyTransactions: Record<string, Transaction[]>): string | null {
  return historyStartMonthFromTransactions(Object.values(monthlyTransactions).flat());
}

export function resolveAvailableComparisonMonths(
  requestedMonths: string[],
  historyStartMonth: string | null
): string[] {
  if (!historyStartMonth) return [];
  return requestedMonths.filter(month => month >= historyStartMonth);
}

export function resolveComparisonCoverage(
  selectedMonth: string,
  mode: ComparisonMode,
  historyStartMonth: string | null
): ComparisonCoverage {
  const requestedMonths = resolveComparisonMonths(selectedMonth, mode);
  const availableMonths = resolveAvailableComparisonMonths(requestedMonths, historyStartMonth);
  return {
    requestedPeriods: requestedMonths.length,
    availablePeriods: availableMonths.length,
    coverageRatio: requestedMonths.length ? roundRatio(availableMonths.length / requestedMonths.length) : 0,
    requestedMonths,
    availableMonths,
  };
}

export function otherCurrencySummaries(
  transactions: Transaction[],
  currency = ANALYSIS_BASE_CURRENCY
) {
  const base = normalizeCurrency(currency);
  return summarizeTransactionsByCurrency(transactions).filter(item => item.currency !== base);
}

export function activeDaysForMonth(monthKey: string, currentMonth: string, todayDay: number): number {
  if (monthKey === currentMonth) return Math.max(1, todayDay);
  return Math.max(1, daysInMonthKey(monthKey));
}

export function buildPeriodTotals(
  transactions: Transaction[],
  options: {month: string; currentMonth: string; today?: Date; currency?: string}
): PeriodTotals {
  const scoped = filterTransactionsByCurrency(transactions, options.currency);
  const today = options.today ?? new Date();
  const income = sumMoney(scoped.filter(item => item.type === 'income').map(item => item.amount));
  const expenses = scoped.filter(item => item.type === 'expense');
  const expense = sumMoney(expenses.map(item => item.amount));
  const balance = roundMoney(income - expense);
  const savingsRate = income > 0 ? roundRatio((income - expense) / income) : null;
  const dailyExpense = roundMoney(expense / activeDaysForMonth(options.month, options.currentMonth, today.getDate()));
  const averageExpense = expenses.length > 0 ? roundMoney(expense / expenses.length) : null;
  return {
    income,
    expense,
    balance,
    savingsRate,
    dailyExpense,
    transactionCount: scoped.length,
    expenseTransactionCount: expenses.length,
    averageExpense,
  };
}

export function averagePeriodTotals(periods: PeriodTotals[]): PeriodTotals | null {
  if (!periods.length) return null;
  const count = periods.length;
  const income = roundMoney(sumMoney(periods.map(item => item.income)) / count);
  const expense = roundMoney(sumMoney(periods.map(item => item.expense)) / count);
  const balance = roundMoney(income - expense);
  const savingsRate = income > 0 ? roundRatio((income - expense) / income) : null;
  const dailyExpense = roundMoney(sumMoney(periods.map(item => item.dailyExpense)) / count);
  const transactionCount = roundRatio(periods.reduce((total, item) => total + item.transactionCount, 0) / count, 1);
  const expenseTransactionCount = roundRatio(
    periods.reduce((total, item) => total + item.expenseTransactionCount, 0) / count,
    1
  );
  return {
    income,
    expense,
    balance,
    savingsRate,
    dailyExpense,
    transactionCount,
    expenseTransactionCount,
    averageExpense: expenseTransactionCount > 0 ? roundMoney(expense / expenseTransactionCount) : null,
  };
}

export function buildComparisonResult(
  selectedMonth: string,
  mode: ComparisonMode,
  monthlyTransactions: Record<string, Transaction[]>,
  options: {currentMonth: string; today?: Date; currency?: string; historyStartMonth?: string | null}
): ComparisonResult {
  const historyStartMonth = options.historyStartMonth === undefined
    ? inferHistoryStartMonth(monthlyTransactions)
    : options.historyStartMonth;
  const coverage = resolveComparisonCoverage(selectedMonth, mode, historyStartMonth);
  if (!coverage.availableMonths.length) return {totals: null, coverage};
  const periods = coverage.availableMonths.map(month => buildPeriodTotals(monthlyTransactions[month] || [], {
    month,
    currentMonth: options.currentMonth,
    today: options.today,
    currency: options.currency,
  }));
  return {
    totals: coverage.availableMonths.length === 1 ? periods[0] : averagePeriodTotals(periods),
    coverage,
  };
}

export function buildComparisonTotals(
  selectedMonth: string,
  mode: ComparisonMode,
  monthlyTransactions: Record<string, Transaction[]>,
  options: {currentMonth: string; today?: Date; currency?: string; historyStartMonth?: string | null}
): PeriodTotals | null {
  return buildComparisonResult(selectedMonth, mode, monthlyTransactions, options).totals;
}

function relativeDelta(current: number, comparison: number): number | null {
  if (comparison === 0) return current === 0 ? 0 : null;
  return roundRatio((current - comparison) / Math.abs(comparison));
}

function directionOf(delta: number | null): KpiDirection {
  if (delta === null) return 'none';
  if (delta > 0) return 'up';
  if (delta < 0) return 'down';
  return 'flat';
}

function compareNumber(
  key: KpiKey,
  current: number | null,
  comparison: number | null,
  deltaKind: KpiDeltaKind
): KpiComparison {
  if (current === null || comparison === null) {
    return {
      key,
      current,
      comparison,
      absoluteDelta: null,
      percentageDelta: null,
      direction: 'none',
      deltaKind,
    };
  }

  if (deltaKind === 'percentage_points') {
    const absoluteDelta = roundRatio(current - comparison);
    return {
      key,
      current,
      comparison,
      absoluteDelta,
      percentageDelta: absoluteDelta,
      direction: directionOf(absoluteDelta),
      deltaKind,
    };
  }

  const absoluteDelta = key === 'transactionCount' ? roundRatio(current - comparison, 1) : roundMoney(current - comparison);
  return {
    key,
    current,
    comparison,
    absoluteDelta,
    percentageDelta: relativeDelta(current, comparison),
    direction: directionOf(absoluteDelta),
    deltaKind,
  };
}

export function compareKpis(current: PeriodTotals, comparison: PeriodTotals | null): Record<KpiKey, KpiComparison> {
  const entries = KPI_KEYS.map(key => {
    if (key === 'savingsRate') {
      return [key, compareNumber(key, current.savingsRate, comparison?.savingsRate ?? null, 'percentage_points')] as const;
    }
    if (key === 'averageExpense') {
      return [key, compareNumber(key, current.averageExpense, comparison?.averageExpense ?? null, 'relative')] as const;
    }
    return [key, compareNumber(key, current[key], comparison ? comparison[key] : null, 'relative')] as const;
  });
  return Object.fromEntries(entries) as Record<KpiKey, KpiComparison>;
}

function shareOf(amount: number, total: number): number {
  if (total <= 0 || amount <= 0) return 0;
  return roundRatio(amount / total);
}

function contributeFromCategoryMaps(
  currentMap: Record<string, number>,
  comparisonMap: Record<string, number>
): CategoryContribution[] {
  const currentTotal = sumMoney(Object.values(currentMap));
  const comparisonTotal = sumMoney(Object.values(comparisonMap));
  const totalDelta = roundMoney(currentTotal - comparisonTotal);
  const categories = new Set([...Object.keys(currentMap), ...Object.keys(comparisonMap)]);
  const grossMovement = sumMoney([...categories].map(category => (
    Math.abs(roundMoney((currentMap[category] || 0) - (comparisonMap[category] || 0)))
  )));
  const denominator = totalDelta !== 0 ? Math.abs(totalDelta) : grossMovement;

  return [...categories]
    .map(category => {
      const currentAmount = currentMap[category] || 0;
      const comparisonAmount = comparisonMap[category] || 0;
      const delta = roundMoney(currentAmount - comparisonAmount);
      const contribution = denominator > 0 ? roundRatio(delta / denominator) : 0;
      const role: CategoryContribution['role'] =
        contribution === 0 || totalDelta === 0 && delta === 0
          ? 'neutral'
          : totalDelta === 0
            ? (delta > 0 ? 'driver' : 'offset')
            : Math.sign(delta) === Math.sign(totalDelta)
              ? 'driver'
              : 'offset';
      return {
        category,
        currentAmount,
        comparisonAmount,
        delta,
        percentageDelta: relativeDelta(currentAmount, comparisonAmount),
        currentShare: shareOf(currentAmount, currentTotal),
        comparisonShare: shareOf(comparisonAmount, comparisonTotal),
        shareChange: roundRatio(shareOf(currentAmount, currentTotal) - shareOf(comparisonAmount, comparisonTotal)),
        contribution,
        role,
      };
    })
    .filter(item => item.currentAmount > 0 || item.comparisonAmount > 0)
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta) || right.currentAmount - left.currentAmount);
}

export function analyzeCategoryContribution(
  currentTransactions: Transaction[],
  comparisonTransactions: Transaction[],
  currency = ANALYSIS_BASE_CURRENCY
): CategoryContribution[] {
  return contributeFromCategoryMaps(
    sumExpensesByCategory(filterTransactionsByCurrency(currentTransactions, currency)),
    sumExpensesByCategory(filterTransactionsByCurrency(comparisonTransactions, currency))
  );
}

export function analyzeCategoryContributionAcrossMonths(
  currentTransactions: Transaction[],
  monthlyComparison: Record<string, Transaction[]>,
  availableMonths: string[],
  currency = ANALYSIS_BASE_CURRENCY
): CategoryContribution[] {
  const currentMap = sumExpensesByCategory(filterTransactionsByCurrency(currentTransactions, currency));
  if (!availableMonths.length) return contributeFromCategoryMaps(currentMap, {});

  const monthlyMaps = availableMonths.map(month => (
    sumExpensesByCategory(filterTransactionsByCurrency(monthlyComparison[month] || [], currency))
  ));
  const categories = new Set([
    ...Object.keys(currentMap),
    ...monthlyMaps.flatMap(item => Object.keys(item)),
  ]);
  const comparisonMap: Record<string, number> = {};
  categories.forEach(category => {
    comparisonMap[category] = roundMoney(
      sumMoney(monthlyMaps.map(item => item[category] || 0)) / availableMonths.length
    );
  });
  return contributeFromCategoryMaps(currentMap, comparisonMap);
}

export function compareSpendGroups(
  currentTransactions: Transaction[],
  comparisonTransactions: Transaction[],
  resolveGroup: SpendGroupResolver,
  currency = ANALYSIS_BASE_CURRENCY
): SpendGroupComparison[] {
  const build = (transactions: Transaction[]) => {
    const groups = new Map<string, {label: string; linked: boolean; amounts: number[]; count: number}>();
    filterTransactionsByCurrency(transactions, currency).filter(item => item.type === 'expense').forEach(transaction => {
      const resolved = resolveGroup(transaction);
      if (!resolved) return;
      const existing = groups.get(resolved.key);
      if (existing) {
        existing.amounts.push(transaction.amount);
        existing.count += 1;
        return;
      }
      groups.set(resolved.key, {
        label: resolved.label,
        linked: resolved.linked,
        amounts: [transaction.amount],
        count: 1,
      });
    });
    return groups;
  };

  const currentGroups = build(currentTransactions);
  const comparisonGroups = build(comparisonTransactions);
  const keys = new Set([...currentGroups.keys(), ...comparisonGroups.keys()]);

  return [...keys]
    .map(key => {
      const current = currentGroups.get(key);
      const comparison = comparisonGroups.get(key);
      const currentAmount = current ? sumMoney(current.amounts) : 0;
      const comparisonAmount = comparison ? sumMoney(comparison.amounts) : 0;
      const currentCount = current?.count || 0;
      const comparisonCount = comparison?.count || 0;
      return {
        key,
        label: current?.label || comparison?.label || key,
        linked: current?.linked ?? comparison?.linked ?? false,
        currentAmount,
        comparisonAmount,
        delta: roundMoney(currentAmount - comparisonAmount),
        percentageDelta: relativeDelta(currentAmount, comparisonAmount),
        currentCount,
        comparisonCount,
        currentAverage: currentCount > 0 ? roundMoney(currentAmount / currentCount) : null,
        comparisonAverage: comparisonCount > 0 ? roundMoney(comparisonAmount / comparisonCount) : null,
      };
    })
    .filter(item => item.currentAmount > 0 || item.comparisonAmount > 0)
    .sort((left, right) => right.currentAmount - left.currentAmount || Math.abs(right.delta) - Math.abs(left.delta));
}

type GroupMonth = {label: string; linked: boolean; amount: number; count: number};

function aggregateExpenseGroups(
  transactions: Transaction[],
  resolveGroup: SpendGroupResolver,
  currency = ANALYSIS_BASE_CURRENCY
): Map<string, GroupMonth> {
  const groups = new Map<string, {label: string; linked: boolean; amounts: number[]; count: number}>();
  filterTransactionsByCurrency(transactions, currency).filter(item => item.type === 'expense').forEach(transaction => {
    const resolved = resolveGroup(transaction);
    if (!resolved) return;
    const existing = groups.get(resolved.key);
    if (existing) {
      existing.amounts.push(transaction.amount);
      existing.count += 1;
      return;
    }
    groups.set(resolved.key, {
      label: resolved.label,
      linked: resolved.linked,
      amounts: [transaction.amount],
      count: 1,
    });
  });
  return new Map([...groups.entries()].map(([key, item]) => [key, {
    label: item.label,
    linked: item.linked,
    amount: sumMoney(item.amounts),
    count: item.count,
  }]));
}

export function compareSpendGroupsAcrossMonths(
  currentTransactions: Transaction[],
  monthlyComparison: Record<string, Transaction[]>,
  availableMonths: string[],
  resolveGroup: SpendGroupResolver,
  currency = ANALYSIS_BASE_CURRENCY
): SpendGroupComparison[] {
  const currentGroups = aggregateExpenseGroups(currentTransactions, resolveGroup, currency);
  const monthlyGroups = availableMonths.map(month => (
    aggregateExpenseGroups(monthlyComparison[month] || [], resolveGroup, currency)
  ));
  const keys = new Set([
    ...currentGroups.keys(),
    ...monthlyGroups.flatMap(item => [...item.keys()]),
  ]);
  const monthCount = availableMonths.length;

  return [...keys]
    .map(key => {
      const current = currentGroups.get(key);
      const currentAmount = current?.amount || 0;
      const currentCount = current?.count || 0;
      const comparisonAmount = monthCount
        ? roundMoney(sumMoney(monthlyGroups.map(item => item.get(key)?.amount || 0)) / monthCount)
        : 0;
      const comparisonCount = monthCount
        ? roundRatio(monthlyGroups.reduce((total, item) => total + (item.get(key)?.count || 0), 0) / monthCount, 1)
        : 0;
      const sample = monthlyGroups.find(item => item.has(key));
      return {
        key,
        label: current?.label || sample?.get(key)?.label || key,
        linked: current?.linked ?? sample?.get(key)?.linked ?? false,
        currentAmount,
        comparisonAmount,
        delta: roundMoney(currentAmount - comparisonAmount),
        percentageDelta: relativeDelta(currentAmount, comparisonAmount),
        currentCount,
        comparisonCount,
        currentAverage: currentCount > 0 ? roundMoney(currentAmount / currentCount) : null,
        comparisonAverage: comparisonCount > 0 ? roundMoney(comparisonAmount / comparisonCount) : null,
      };
    })
    .filter(item => item.currentAmount > 0 || item.comparisonAmount > 0)
    .sort((left, right) => right.currentAmount - left.currentAmount || Math.abs(right.delta) - Math.abs(left.delta));
}
