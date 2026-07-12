import {roundMoney, sumMoney} from './money';
import type {Goal, Subscription, Transaction} from '../types/finance';

export type SubscriptionCharge = {
  subscription: Subscription;
  date: string;
  amount: number;
};

export type BudgetUsageStatus = 'none' | 'ok' | 'warning' | 'danger';

export type BudgetUsage = {
  spent: number;
  reserved: number;
  projected: number;
  budgetAmount: number;
  ratio: number;
  percentage: number;
  status: BudgetUsageStatus;
};

export function normalizeGoal(goal: Goal): Goal {
  return {
    ...goal,
    deposits: (goal.deposits || []).map(entry => ({
      id: entry.id || `${goal.id}-${entry.date}-${entry.amount}-${entry.type || 'deposit'}`,
      amount: Math.abs(entry.amount),
      date: entry.date,
      type: entry.type || (entry.amount >= 0 ? 'deposit' : 'withdraw'),
      note: entry.note,
      linkedTransactionId: entry.linkedTransactionId
    }))
  };
}

export function getGoalSavedAmount(goal: Goal): number {
  const deposits = goal.deposits || [];
  if (!deposits.length) return goal.savedAmount;

  return roundMoney(deposits.reduce((sum, entry) => (
    entry.type === 'deposit' ? sum + entry.amount : Math.max(0, sum - entry.amount)
  ), 0));
}

export function getGoalWithSavedAmount(goal: Goal): Goal {
  const normalizedGoal = normalizeGoal(goal);
  return {
    ...normalizedGoal,
    savedAmount: Math.min(normalizedGoal.targetAmount, getGoalSavedAmount(normalizedGoal))
  };
}

/**
 * Sums expense transactions by category using integer-cent math (via sumMoney)
 * so category totals do not accumulate binary floating-point drift. Income
 * transactions are ignored. Returns the same shape as storage.getCategoryBreakdown.
 */
export function sumExpensesByCategory(transactions: Transaction[]): Record<string, number> {
  const amountsByCategory = new Map<string, number[]>();
  for (const transaction of transactions) {
    if (transaction.type !== 'expense') continue;
    const amounts = amountsByCategory.get(transaction.category) || [];
    amounts.push(transaction.amount);
    amountsByCategory.set(transaction.category, amounts);
  }
  const breakdown: Record<string, number> = {};
  for (const [category, amounts] of amountsByCategory) {
    breakdown[category] = sumMoney(amounts);
  }
  return breakdown;
}

/**
 * Sums subscription charges by category using integer-cent math (via sumMoney)
 * so reserved-budget totals do not accumulate binary floating-point drift.
 * Mirrors sumExpensesByCategory for the SubscriptionCharge shape; reads the
 * amount from the charge itself (a charge may differ from subscription.amount).
 */
export function sumSubscriptionChargesByCategory(charges: SubscriptionCharge[]): Record<string, number> {
  const amountsByCategory = new Map<string, number[]>();
  for (const charge of charges) {
    const category = charge.subscription.category;
    const amounts = amountsByCategory.get(category) || [];
    amounts.push(charge.amount);
    amountsByCategory.set(category, amounts);
  }
  const breakdown: Record<string, number> = {};
  for (const [category, amounts] of amountsByCategory) {
    breakdown[category] = sumMoney(amounts);
  }
  return breakdown;
}

export function getCurrentMonthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function getNextMonthKey(month: string): string {
  const [year, monthIndex] = month.split('-').map(Number);
  return getCurrentMonthKey(new Date(year, monthIndex, 1));
}

export function getMonthDateRange(month: string): {start: string; endExclusive: string} {
  return {
    start: `${month}-01`,
    endExclusive: `${getNextMonthKey(month)}-01`
  };
}

function parseDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function addMonthsClamped(dateKey: string, months: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const target = new Date(year, month - 1 + months, 1);
  const lastDay = daysInMonth(target.getFullYear(), target.getMonth());
  target.setDate(Math.min(day, lastDay));
  return formatDateKey(target);
}

export function getNextSubscriptionBillingDate(subscription: Subscription, fromDate = subscription.nextBillingDate): string {
  const date = parseDateKey(fromDate);
  if (subscription.frequency === 'weekly') {
    date.setDate(date.getDate() + 7);
    return formatDateKey(date);
  }
  if (subscription.frequency === 'quarterly') return addMonthsClamped(fromDate, 3);
  if (subscription.frequency === 'yearly') return addMonthsClamped(fromDate, 12);
  return addMonthsClamped(fromDate, 1);
}

export function getSubscriptionChargesForMonth(
  subscriptions: Subscription[],
  month = getCurrentMonthKey(),
  transactions: Transaction[] = [],
  today = formatDateKey(new Date()),
  upcomingOnly = false
): SubscriptionCharge[] {
  const {start: monthStart, endExclusive: monthEnd} = getMonthDateRange(month);
  const postedKeys = new Set(
    transactions
      .filter(item => item.subscriptionId)
      .map(item => `${item.subscriptionId}:${item.date}`)
  );

  const charges: SubscriptionCharge[] = [];
  subscriptions
    .filter(item => item.active && item.nextBillingDate)
    .forEach(subscription => {
      let date = subscription.nextBillingDate;
      let guard = 0;
      while (date < monthStart && guard < 120) {
        date = getNextSubscriptionBillingDate(subscription, date);
        guard += 1;
      }
      while (date < monthEnd && guard < 120) {
        const key = `${subscription.id}:${date}`;
        const isUpcoming = date >= today && !postedKeys.has(key);
        if (!upcomingOnly || isUpcoming) {
          charges.push({subscription, date, amount: subscription.amount});
        }
        date = getNextSubscriptionBillingDate(subscription, date);
        guard += 1;
      }
    });

  return charges.sort((a, b) => a.date.localeCompare(b.date) || a.subscription.name.localeCompare(b.subscription.name));
}

export function calculateBudgetUsage(
  spent: number,
  reserved: number,
  budgetAmount: number,
  warnThreshold = 0.7,
  dangerThreshold = 0.9
): BudgetUsage {
  const projected = roundMoney(spent + reserved);
  const ratio = budgetAmount > 0 ? Math.min(projected / budgetAmount, 1) : 0;
  const percentage = Math.round(ratio * 100);
  const status: BudgetUsageStatus = budgetAmount <= 0
    ? 'none'
    : ratio >= dangerThreshold
      ? 'danger'
      : ratio >= warnThreshold
        ? 'warning'
        : 'ok';

  return {
    spent,
    reserved,
    projected,
    budgetAmount,
    ratio,
    percentage,
    status
  };
}
