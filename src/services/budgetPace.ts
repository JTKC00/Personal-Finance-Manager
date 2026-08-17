import {roundMoney} from './money';
import {roundRatio} from './comparisonEngine';
import type {Budget} from '../types/finance';

export type BudgetPaceStatus = 'none' | 'ahead' | 'on_track' | 'behind' | 'over';

export type BudgetPace = {
  category: string;
  budgetAmount: number;
  spent: number;
  usedRatio: number;
  usedPercentage: number;
  monthProgressRatio: number;
  monthProgressPercentage: number;
  remainingBudget: number;
  remainingDays: number;
  elapsedDays: number;
  daysInMonth: number;
  currentDailySpend: number;
  safeDailySpend: number | null;
  projectedSpend: number;
  projectedDelta: number;
  status: BudgetPaceStatus;
  isCurrentMonth: boolean;
};

export function buildBudgetPace(options: {
  category: string;
  budgetAmount: number;
  spent: number;
  daysInMonth: number;
  elapsedDays: number;
  isCurrentMonth: boolean;
}): BudgetPace {
  const budgetAmount = roundMoney(Math.max(0, options.budgetAmount));
  const spent = roundMoney(Math.max(0, options.spent));
  const daysInMonth = Math.max(1, options.daysInMonth);
  const elapsedDays = Math.min(daysInMonth, Math.max(1, options.elapsedDays));
  const remainingDays = options.isCurrentMonth ? Math.max(0, daysInMonth - elapsedDays) : 0;
  const remainingBudget = roundMoney(budgetAmount - spent);
  const usedRatio = budgetAmount > 0 ? spent / budgetAmount : 0;
  const monthProgressRatio = elapsedDays / daysInMonth;
  const currentDailySpend = roundMoney(spent / elapsedDays);
  const projectedSpend = options.isCurrentMonth
    ? roundMoney((spent * daysInMonth) / elapsedDays)
    : spent;
  const projectedDelta = budgetAmount > 0 ? roundMoney(projectedSpend - budgetAmount) : 0;
  const safeDailySpend = remainingDays > 0 ? roundMoney(remainingBudget / remainingDays) : null;

  let status: BudgetPaceStatus = 'none';
  if (budgetAmount > 0) {
    if (spent > budgetAmount) status = 'over';
    else if (!options.isCurrentMonth) status = remainingBudget >= 0 ? 'on_track' : 'over';
    else if (usedRatio > monthProgressRatio + 0.08) status = 'ahead';
    else if (usedRatio + 0.08 < monthProgressRatio) status = 'behind';
    else status = 'on_track';
  }

  return {
    category: options.category,
    budgetAmount,
    spent,
    usedRatio: roundRatio(usedRatio),
    usedPercentage: Math.round(Math.min(usedRatio, 9.99) * 100),
    monthProgressRatio: roundRatio(monthProgressRatio),
    monthProgressPercentage: Math.round(monthProgressRatio * 100),
    remainingBudget,
    remainingDays,
    elapsedDays,
    daysInMonth,
    currentDailySpend,
    safeDailySpend,
    projectedSpend,
    projectedDelta,
    status,
    isCurrentMonth: options.isCurrentMonth,
  };
}

export function buildBudgetPaces(
  rows: Budget[],
  spentByCategory: Record<string, number>,
  options: {daysInMonth: number; elapsedDays: number; isCurrentMonth: boolean}
): BudgetPace[] {
  return rows
    .filter(row => row.amount > 0)
    .map(row => buildBudgetPace({
      category: row.category,
      budgetAmount: row.amount,
      spent: spentByCategory[row.category] || 0,
      daysInMonth: options.daysInMonth,
      elapsedDays: options.elapsedDays,
      isCurrentMonth: options.isCurrentMonth,
    }))
    .sort((left, right) => right.usedRatio - left.usedRatio || right.spent - left.spent);
}
