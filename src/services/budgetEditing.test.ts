import {describe, expect, it} from 'vitest';
import {budgetDraft, isBudgetMonth, parseBudgetDraft, sameBudgetRecord, validateBudgetRecord} from './budgetEditing';
import {shiftMonthKey} from './comparisonEngine';

describe('monthly budget editing', () => {
  it('keeps existing nonstandard categories when opening or copying a budget', () => {
    const draft = budgetDraft({餐飲: 100, 舊分類: 25}, ['餐飲', '交通']);
    expect(draft).toEqual({餐飲: '100', 交通: '', 舊分類: '25'});
    expect(parseBudgetDraft(draft).budgets).toEqual({餐飲: 100, 舊分類: 25});
  });
  it('treats blank and zero as no limit and totals decimal amounts in cents', () => {
    expect(parseBudgetDraft({餐飲: '0.10', 交通: '.20', 娛樂: '0', 其他: ' '})).toEqual({budgets: {餐飲: .1, 交通: .2}, errors: {}, total: .3});
  });
  it.each(['-1', '1.234', 'NaN', 'Infinity', '1e3', '10abc', '9007199254740992'])('rejects invalid input without silently dropping it: %s', value => {
    expect(parseBudgetDraft({餐飲: value}).errors.餐飲).toBeTruthy();
  });
  it('validates dates and resolves copying across a year boundary', () => {
    expect(isBudgetMonth('2026-01')).toBe(true);
    expect(shiftMonthKey('2026-01', -1)).toBe('2025-12');
    for (const month of ['2026-00', '2026-13', '2026-1', '1899-12', '2026-01/other']) expect(isBudgetMonth(month)).toBe(false);
  });
  it('distinguishes a missing record from an explicitly empty record', () => {
    expect(sameBudgetRecord(null, {})).toBe(false);
    expect(sameBudgetRecord({}, {})).toBe(true);
    expect(sameBudgetRecord({餐飲: 100, 交通: 20}, {交通: 20, 餐飲: 100})).toBe(true);
    expect(sameBudgetRecord({餐飲: 100}, {餐飲: 101})).toBe(false);
  });
  it('validates direct save input and the safe total, including legacy category names', () => {
    expect(() => validateBudgetRecord({舊分類: .3, 交通: 0})).not.toThrow();
    for (const value of [-1, Infinity, NaN, 0.001, Number.MAX_SAFE_INTEGER]) expect(() => validateBudgetRecord({餐飲: value})).toThrow();
    const large = 80000000000000;
    expect(parseBudgetDraft({餐飲: String(large), 交通: String(large)}).errors.total).toBeTruthy();
    expect(() => validateBudgetRecord({餐飲: large, 交通: large})).toThrow();
  });
});
