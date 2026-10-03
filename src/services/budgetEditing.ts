import {roundMoney, sumMoney} from './money';

export type BudgetRecord = Record<string, number>;
export type BudgetMonthSnapshot = {
  uid: string;
  month: string;
  currentMonth: string;
  budgets: BudgetRecord | null;
  monthRecord: BudgetRecord | null;
  legacyRecord: BudgetRecord | null;
};

export class BudgetEditConflict extends Error {
  constructor(message = '這個月份的預算已在其他地方修改，草稿已保留。請載入最新版再編輯。') {
    super(message);
    this.name = 'BudgetEditConflict';
  }
}

export function isBudgetMonth(month: string): boolean {
  return /^(19|[2-9]\d)\d{2}-(0[1-9]|1[0-2])$/.test(month);
}

export function sameBudgetRecord(left: BudgetRecord | null, right: BudgetRecord | null): boolean {
  if (left === null || right === null) return left === right;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && left[key] === right[key]);
}

export function budgetDraft(record: BudgetRecord | null, categories: readonly string[]): Record<string, string> {
  return Object.fromEntries([...new Set([...categories, ...Object.keys(record || {})])].map(category => [category, record?.[category] ? String(record[category]) : '']));
}

/** Empty and zero mean no category limit; invalid input must never silently erase a limit. */
export function parseBudgetDraft(draft: Record<string, string>): {budgets: BudgetRecord; errors: Record<string, string>; total: number} {
  const entries: Array<[string, number]> = [];
  const errors: Record<string, string> = {};
  for (const [category, input] of Object.entries(draft)) {
    const value = input.trim();
    if (!value) continue;
    const amount = Number(value);
    if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(value) || !Number.isFinite(amount) || !Number.isSafeInteger(Math.round(amount * 100))) {
      errors[category] = '請輸入 0 或以上、最多兩位小數的金額。';
    } else if (amount > 0) entries.push([category, roundMoney(amount)]);
  }
  const budgets = Object.fromEntries(entries);
  const total = sumMoney(entries.map(([, amount]) => amount));
  if (!Number.isSafeInteger(Math.round(total * 100))) errors.total = '預算總額太大，請減少金額。';
  return {budgets, errors, total};
}

export function validateBudgetRecord(record: BudgetRecord): void {
  for (const [category, amount] of Object.entries(record)) {
    if (!category.trim() || !Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(Math.round(amount * 100)) || roundMoney(amount) !== amount) {
      throw new Error('預算分類或金額不正確，請檢查後再儲存。');
    }
  }
  if (!Number.isSafeInteger(Math.round(sumMoney(Object.values(record)) * 100))) throw new Error('預算總額太大。');
}
