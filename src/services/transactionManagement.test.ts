import {describe, expect, it} from 'vitest';
import {cleanupReasons, EMPTY_TRANSACTION_FILTERS, filterTransactions, resolveTransactionPeriod, transactionCurrencyTotals, type TransactionDirectories, type TransactionPeriod} from './transactionManagement';
import type {Transaction} from '../types/finance';
const tx = (patch: Partial<Transaction> = {}): Transaction => ({id: 'one', type: 'expense', amount: 100, currency: 'HKD', date: '2026-09-12', category: '飲食', createdAt: '2026-09-12T00:00:00Z', ...patch});
const dirs: TransactionDirectories = {
  merchants: [{id: 'cafe', name: '好日咖啡', aliases: ['Good Day', '好日'], createdAt: ''}],
  instruments: [{id: 'card', name: '日常卡', type: 'credit_card', active: false, createdAt: ''}],
  accounts: [{id: 'bank', name: '日常戶口', currency: 'HKD', type: 'bank', initialBalance: 0, createdAt: ''}], goals: [], subscriptions: [],
};
const selection: TransactionPeriod = {preset: 'month', month: '2026-09', start: '2026-08-31', end: '2026-10-01'};
const range = {start: '2026-09-01', end: '2026-09-30'};
describe('transaction management', () => {
  it('keeps the complete current month including future entries', () => {
    expect(resolveTransactionPeriod(selection, '2026-09-12')).toEqual(range);
    expect(filterTransactions([tx({date: '2026-09-30'}), tx({id: 'tomorrow', date: '2026-10-01'})], range, EMPTY_TRANSACTION_FILTERS, dirs).map(t => t.id)).toEqual(['one']);
  });
  it('resolves exactly 90 days over year and leap boundaries', () => {
    expect(resolveTransactionPeriod({...selection, preset: 'recent90'}, '2024-03-01')).toEqual({start: '2023-12-03', end: '2024-03-01'});
    expect(resolveTransactionPeriod({...selection, month: '2024-02'}, '2024-03-01').end).toBe('2024-02-29');
  });
  it('resolves year-to-date and inclusive custom ranges including future dates', () => {
    expect(resolveTransactionPeriod({...selection, preset: 'year'}, '2026-09-12')).toEqual({start: '2026-01-01', end: '2026-09-12'});
    const custom = resolveTransactionPeriod({...selection, preset: 'custom'}, '2026-09-12');
    expect(filterTransactions([tx({id: 'start', date: custom.start}), tx({id: 'end', date: custom.end}), tx({id: 'after', date: '2026-10-02'})], custom, EMPTY_TRANSACTION_FILTERS, dirs).map(t => t.id)).toEqual(['end', 'start']);
  });
  it.each([{start: '2026-02-30', end: '2026-03-01'}, {start: '2026-09-12', end: '2026-09-01'}, {start: '', end: '2026-09-12'}])('rejects invalid custom dates %j', custom => {
    expect(() => resolveTransactionPeriod({...selection, preset: 'custom', ...custom}, '2026-09-12')).toThrow();
  });
  it('ANDs every identity, category, type, currency, and alias filter', () => {
    const good = tx({merchantId: 'cafe', accountId: 'bank', paymentInstrumentId: 'card'});
    const rows = [good, ...Object.entries({merchantId: 'other', accountId: 'other', paymentInstrumentId: 'other', category: '交通', currency: 'USD', type: 'income'}).map(([k, v]) => tx({...good, id: k, [k]: v}))];
    expect(filterTransactions(rows, range, {...EMPTY_TRANSACTION_FILTERS, query: 'GOOD DAY', merchant: 'id:cafe', account: 'id:bank', instrument: 'id:card', category: '飲食', type: 'expense', currency: 'HKD'}, dirs)).toEqual([good]);
  });
  it.each(['好日咖啡', '好日', 'Good Day', 'Receipt raw', '午餐', '1,234.50', '1234.5'])('searches names, aliases, raw receipt text, notes and amounts: %s', query => {
    expect(filterTransactions([tx({merchantId: 'cafe', merchantText: 'Receipt raw', note: '午餐', amount: 1234.5})], range, {...EMPTY_TRANSACTION_FILTERS, query}, dirs)).toHaveLength(1);
  });
  it('distinguishes absent IDs, deleted references and inactive but valid tools', () => {
    expect(cleanupReasons(tx(), dirs)).toEqual(['merchant', 'instrument']);
    expect(cleanupReasons(tx({merchantId: 'cafe', paymentInstrumentId: 'card'}), dirs)).toEqual([]);
    expect(cleanupReasons(tx({merchantId: 'deleted', paymentInstrumentId: 'deleted'}), dirs)).toEqual(['deleted']);
    expect(cleanupReasons(tx({type: 'income'}), dirs)).toEqual([]);
    for (const key of ['accountId', 'goalId', 'subscriptionId']) expect(cleanupReasons(tx({merchantId: 'cafe', paymentInstrumentId: 'card', [key]: 'deleted'}), dirs)).toEqual(['deleted']);
  });
  it('does not label failed directories as deleted', () => {
    expect(cleanupReasons(tx({merchantId: 'unknown', paymentInstrumentId: 'unknown', goalId: 'unknown'}), {})).toEqual([]);
    expect(filterTransactions([tx({merchantId: 'unknown'})], range, {...EMPTY_TRANSACTION_FILTERS, merchant: 'deleted'}, {})).toEqual([]);
  });
  it('filters unspecified and deleted identities separately', () => {
    const rows = [tx(), tx({id: 'deleted', merchantId: 'gone'}), tx({id: 'linked', merchantId: 'cafe'})];
    expect(filterTransactions(rows, range, {...EMPTY_TRANSACTION_FILTERS, merchant: 'deleted'}, dirs).map(t => t.id)).toEqual(['deleted']);
    expect(filterTransactions(rows, range, {...EMPTY_TRANSACTION_FILTERS, merchant: 'unspecified'}, dirs).map(t => t.id)).toEqual(['one']);
  });
  it('sorts the cleanup queue deterministically by date and creation time', () => {
    expect(filterTransactions([tx({id: 'old', date: '2026-09-01'}), tx({id: 'second'}), tx({id: 'first', createdAt: '2026-09-12T01:00:00Z'}), tx({id: 'done', merchantId: 'cafe', paymentInstrumentId: 'card'})], range, {...EMPTY_TRANSACTION_FILTERS, cleanup: 'any'}, dirs).map(t => t.id)).toEqual(['first', 'second', 'old']);
  });
  it('keeps currencies separate and totals cents correctly', () => {
    expect(transactionCurrencyTotals([tx({amount: .1}), tx({amount: .2}), tx({type: 'income', amount: 1}), tx({currency: 'usd', amount: 20})])).toEqual([
      {currency: 'HKD', income: 1, expense: .3, balance: .7}, {currency: 'USD', income: 0, expense: 20, balance: -20},
    ]);
  });
});
