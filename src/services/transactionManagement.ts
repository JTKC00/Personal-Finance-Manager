import {addDays, inRange, isValidDate, monthEnd, type DateRange} from './analysisPeriod';
import {normalizeCurrency} from './financeLogic';
import {sumMoney} from './money';
import type {Account, Goal, Merchant, PaymentInstrument, Subscription, Transaction} from '../types/finance';

export type TransactionDirectories = {merchants: Merchant[]; instruments: PaymentInstrument[]; accounts: Account[]; goals: Goal[]; subscriptions: Subscription[]};
export type CleanupReason = 'merchant' | 'instrument' | 'deleted';
export const CLEANUP_LABELS: Record<CleanupReason, string> = {merchant: '商戶未歸戶', instrument: '未指定具體付款工具', deleted: '連結資料已刪除'};
export type TransactionFilters = {
  query: string; type: 'all' | 'income' | 'expense'; category: string; merchant: string;
  account: string; instrument: string; currency: string; cleanup: 'all' | 'any' | CleanupReason;
};
export const EMPTY_TRANSACTION_FILTERS: TransactionFilters = {query: '', type: 'all', category: 'all', merchant: 'all', account: 'all', instrument: 'all', currency: 'all', cleanup: 'all'};
export type TransactionPeriod = {preset: 'month' | 'recent90' | 'year' | 'custom'; month: string; start: string; end: string};
export function resolveTransactionPeriod(selection: TransactionPeriod, today: string): DateRange {
  const range = selection.preset === 'month' ? {start: `${selection.month}-01`, end: monthEnd(selection.month)}
    : selection.preset === 'recent90' ? {start: addDays(today, -89), end: today}
      : selection.preset === 'year' ? {start: `${today.slice(0, 4)}-01-01`, end: today}
        : {start: selection.start, end: selection.end};
  if (!isValidDate(range.start) || !isValidDate(range.end) || range.start > range.end || range.start < '1900-01-01') throw new Error('請選擇有效的開始與截止日期。');
  return range;
}
/** A directory that failed to load is unknown, never evidence of deletion. */
export function cleanupReasons(t: Transaction, dirs: Partial<TransactionDirectories>): CleanupReason[] {
  if (t.type !== 'expense') return [];
  const result: CleanupReason[] = [];
  if (!t.merchantId) result.push('merchant');
  if (!t.paymentInstrumentId) result.push('instrument');
  const references: Array<[string | undefined, Array<{id: string}> | undefined]> = [
    [t.merchantId, dirs.merchants], [t.paymentInstrumentId, dirs.instruments], [t.accountId, dirs.accounts], [t.goalId, dirs.goals], [t.subscriptionId, dirs.subscriptions],
  ];
  if (references.some(([id, items]) => id && items && !items.some(item => item.id === id))) result.push('deleted');
  return result;
}
function identityMatch(filter: string, id: string | undefined, items: Array<{id: string}> | undefined): boolean {
  return filter === 'all' || (filter === 'unspecified' ? !id : filter === 'deleted' ? Boolean(id && items && !items.some(item => item.id === id)) : id === filter.slice(3));
}
export function filterTransactions(rows: Transaction[], range: DateRange, filters: TransactionFilters, dirs: Partial<TransactionDirectories>): Transaction[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return rows.filter(t => {
    if (!inRange(t.date, range) || (filters.type !== 'all' && t.type !== filters.type) || (filters.category !== 'all' && t.category !== filters.category)) return false;
    if (filters.currency !== 'all' && normalizeCurrency(t.currency) !== filters.currency) return false;
    if (!identityMatch(filters.merchant, t.merchantId, dirs.merchants) || !identityMatch(filters.instrument, t.paymentInstrumentId, dirs.instruments) || !identityMatch(filters.account, t.accountId, dirs.accounts)) return false;
    const reasons = cleanupReasons(t, dirs);
    if (filters.cleanup !== 'all' && !(filters.cleanup === 'any' ? reasons.length : reasons.includes(filters.cleanup))) return false;
    const merchant = dirs.merchants?.find(m => m.id === t.merchantId);
    return !query || [merchant?.name, ...(merchant?.aliases || []), t.merchant, t.merchantText, t.note, t.category, t.paymentMethod, String(t.amount), t.amount.toFixed(2), t.amount.toLocaleString('en-US', {minimumFractionDigits: 2})].join(' ').toLocaleLowerCase().includes(query);
  }).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}
export function transactionCurrencyTotals(rows: Transaction[]) {
  return [...new Set(rows.map(t => normalizeCurrency(t.currency)))].sort().map(currency => {
    const same = rows.filter(t => normalizeCurrency(t.currency) === currency);
    const income = sumMoney(same.filter(t => t.type === 'income').map(t => t.amount));
    const expense = sumMoney(same.filter(t => t.type === 'expense').map(t => t.amount));
    return {currency, income, expense, balance: sumMoney([income, -expense])};
  });
}
