import {monthEnd, type AnalysisPeriod, type DateRange} from './analysisPeriod';
import type {AnalysisDirectories} from './analysisReport';
import type {Budget, Transaction} from '../types/finance';

export type AnalysisSource = {
  transactions: (start: string, end: string) => Promise<Transaction[]>;
  earliest: () => Promise<string | null>;
  budgets: (month: string) => Promise<Budget[] | null>;
  merchants: () => Promise<AnalysisDirectories['merchants']>;
  instruments: () => Promise<AnalysisDirectories['instruments']>;
  accounts: () => Promise<AnalysisDirectories['accounts']>;
  subscriptions: () => Promise<AnalysisDirectories['subscriptions']>;
};
export type AnalysisData = {
  transactions: Transaction[];
  earliest: string | null;
  directories: AnalysisDirectories;
  budgets: Record<string, Budget[] | null>;
  errors: string[];
};

/** Merge overlapping requests only, so a distant YoY comparison does not load the intervening year. */
export function analysisQueryRanges(period: AnalysisPeriod): DateRange[] {
  // Load future records for the current month's commitment panel. Actual KPI,
  // comparisons and charts still use period.current, whose end is today.
  const commitments = period.isCurrentMonth ? [{start: period.current.start, end: monthEnd(period.current.start.slice(0, 7))}] : [];
  const ranges = [period.current, period.trend, period.baseline, ...period.comparisons, ...commitments].sort((a, b) => a.start.localeCompare(b.start));
  return ranges.reduce<DateRange[]>((merged, range) => {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) last.end = last.end > range.end ? last.end : range.end;
    else merged.push({...range});
    return merged;
  }, []);
}

/** Instance belongs to one mounted screen. Account switches/retry clear it, failures never enter the cache. */
export function createAnalysisLoader(source: AnalysisSource) {
  let owner: string | null = null;
  let generation = 0;
  const cache = new Map<string, unknown>();
  function clear() { generation++; owner = null; cache.clear(); }
  async function load(uid: string, period: AnalysisPeriod): Promise<AnalysisData> {
    if (owner !== uid) { clear(); owner = uid; }
    const version = generation;
    async function cached<T>(key: string, request: () => Promise<T>): Promise<T> {
      if (cache.has(key)) return cache.get(key) as T;
      const result = await request();
      if (generation === version) cache.set(key, result);
      return result;
    }
    const ranges = analysisQueryRanges(period);
    const [transactions, earliest, auxiliary] = await Promise.all([
      Promise.all(ranges.map(r => cached(`tx:${r.start}:${r.end}`, () => source.transactions(r.start, r.end)))),
      cached('earliest', source.earliest),
      Promise.allSettled([
        cached('merchants', source.merchants), cached('instruments', source.instruments),
        cached('accounts', source.accounts), cached('subscriptions', source.subscriptions),
        ...period.budgetMonths.map(month => cached(`budget:${month}`, () => source.budgets(month))),
      ]),
    ]);
    const errors: string[] = [];
    const labels = ['商戶名稱', '付款工具', '帳戶名稱', '訂閱名稱', ...period.budgetMonths.map(m => `${m} 預算`)];
    auxiliary.forEach((result, i) => { if (result.status === 'rejected') errors.push(labels[i]); });
    const value = <T>(index: number, fallback: T): T => auxiliary[index].status === 'fulfilled' ? auxiliary[index].value as T : fallback;
    const budgets: AnalysisData['budgets'] = {};
    period.budgetMonths.forEach((month, i) => { if (auxiliary[i + 4].status === 'fulfilled') budgets[month] = value<Budget[] | null>(i + 4, null); });
    return {
      transactions: [...new Map(transactions.flat().map(t => [t.id, t])).values()], earliest, errors, budgets,
      directories: {merchants: value(0, []), instruments: value(1, []), accounts: value(2, []), subscriptions: value(3, [])},
    };
  }
  return {load, clear};
}
