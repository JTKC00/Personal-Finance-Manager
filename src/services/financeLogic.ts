import {roundMoney, sumMoney} from './money';
import type {Account, Budget, Goal, Subscription, Transaction, Transfer} from '../types/finance';

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

export type CurrencySummary = {
  currency: string;
  income: number;
  expense: number;
  balance: number;
  count: number;
};

export function normalizeCurrency(currency: string): string {
  return currency.trim().toUpperCase() || 'HKD';
}

/** Keeps monetary totals isolated by currency; no FX conversion is implied. */
export function summarizeTransactionsByCurrency(transactions: Transaction[]): CurrencySummary[] {
  const groups = new Map<string, Transaction[]>();
  for (const transaction of transactions) {
    const currency = normalizeCurrency(transaction.currency);
    groups.set(currency, [...(groups.get(currency) || []), transaction]);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, items]) => {
      const income = sumMoney(items.filter(item => item.type === 'income').map(item => item.amount));
      const expense = sumMoney(items.filter(item => item.type === 'expense').map(item => item.amount));
      return {currency, income, expense, balance: roundMoney(income - expense), count: items.length};
    });
}

export function normalizeGoal(goal: Goal): Goal {
  const deposits = (goal.deposits || []).map(entry => ({
    id: entry.id || `${goal.id}-${entry.date}-${entry.amount}-${entry.type || 'deposit'}`,
    amount: Math.abs(entry.amount),
    date: entry.date,
    type: entry.type || (entry.amount >= 0 ? 'deposit' : 'withdraw'),
    note: entry.note,
    linkedTransactionId: entry.linkedTransactionId
  }));

  // Legacy standalone goals stored only savedAmount. Materialize that value as
  // a deterministic opening ledger entry so deposits[] becomes canonical.
  if (!goal.accountId && deposits.length === 0 && goal.savedAmount > 0) {
    deposits.push({
      id: `${goal.id}-legacy-opening-balance`,
      amount: roundMoney(goal.savedAmount),
      date: '1970-01-01',
      type: 'deposit',
      note: '舊資料期初存款',
      linkedTransactionId: undefined
    });
  }

  return {
    ...goal,
    deposits
  };
}

export function getGoalSavedAmount(goal: Goal): number {
  const deposits = normalizeGoal(goal).deposits || [];

  return roundMoney(deposits.reduce((sum, entry) => (
    entry.type === 'deposit' ? sum + entry.amount : Math.max(0, sum - entry.amount)
  ), 0));
}

export function calculateAccountBalance(account: Account, transfers: Transfer[]): number {
  const inflow = sumMoney(
    transfers.filter(item => item.toAccountId === account.id).map(item => item.amount)
  );
  const outflow = sumMoney(
    transfers.filter(item => item.fromAccountId === account.id).map(item => item.amount)
  );
  return roundMoney(account.initialBalance + inflow - outflow);
}

export function getGoalWithSavedAmount(goal: Goal, accountBalance?: number): Goal {
  const normalizedGoal = normalizeGoal(goal);
  const savedAmount = normalizedGoal.accountId
    ? roundMoney(Math.max(0, accountBalance ?? normalizedGoal.savedAmount))
    : getGoalSavedAmount(normalizedGoal);
  return {
    ...normalizedGoal,
    savedAmount
  };
}

/** Shared core: group amounts by category, then sum each group at cent precision. */
function sumAmountsByCategory<T>(
  items: T[],
  getCategory: (item: T) => string,
  getAmount: (item: T) => number
): Record<string, number> {
  const amountsByCategory = new Map<string, number[]>();
  for (const item of items) {
    const category = getCategory(item);
    const amounts = amountsByCategory.get(category) || [];
    amounts.push(getAmount(item));
    amountsByCategory.set(category, amounts);
  }
  const breakdown: Record<string, number> = {};
  for (const [category, amounts] of amountsByCategory) {
    breakdown[category] = sumMoney(amounts);
  }
  return breakdown;
}

/**
 * Sums expense transactions by category using integer-cent math (via sumMoney)
 * so category totals do not accumulate binary floating-point drift. Income
 * transactions are ignored. Returns the same shape as storage.getCategoryBreakdown.
 */
export function sumExpensesByCategory(transactions: Transaction[]): Record<string, number> {
  return sumAmountsByCategory(
    transactions.filter(transaction => transaction.type === 'expense'),
    transaction => transaction.category,
    transaction => transaction.amount
  );
}

/**
 * Sums subscription charges by category using integer-cent math (via sumMoney)
 * so reserved-budget totals do not accumulate binary floating-point drift.
 * Reads the amount from the charge itself (it may differ from subscription.amount).
 */
export function sumSubscriptionChargesByCategory(charges: SubscriptionCharge[]): Record<string, number> {
  return sumAmountsByCategory(
    charges,
    charge => charge.subscription.category,
    charge => charge.amount
  );
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

/**
 * Synthesises Budget rows from a stored month record (extracted from the old
 * storage.loadBudgetRows inline logic so the shape stays testable).
 */
export function buildBudgetRows(record: Record<string, number>, month: string): Budget[] {
  return Object.entries(record).map(([category, amount]) => ({
    id: `${month}-${category}`,
    category,
    month,
    amount,
    warnThreshold: 0.7,
    dangerThreshold: 0.9
  }));
}

/**
 * Decides which budget record applies to a month. The current month always
 * reads the legacy meta/budgets record — it is the one both old and new app
 * versions keep writing to, so it is guaranteed to reflect the latest edit
 * regardless of which device/version made it. (saveCurrentMonthBudgets also
 * copies it into budgetMonths/{currentMonth} on every save, but that copy is
 * only an archival snapshot for once the month becomes a past month — reading
 * it back for the *current* month would let a stale snapshot silently
 * overwrite a newer legacy edit made from an old-version device on next save.)
 * Any other month reads its own stored document, or has no history record if
 * none was ever saved.
 */
export function resolveBudgetMonth(
  monthDoc: Record<string, number> | null,
  legacyBudgets: Record<string, number>,
  month: string,
  currentMonth: string
): Record<string, number> | null {
  if (month === currentMonth) return legacyBudgets;
  return monthDoc;
}

export type BudgetComparison = {
  totalBudget: number;
  totalSpent: number;
  /** totalBudget − totalSpent：正＝省下、負＝超支 */
  delta: number;
  overCategories: {category: string; budget: number; spent: number; over: number}[];
};

/**
 * Budget vs actual for one month. totalSpent covers every expense category
 * (budgeted or not); overCategories lists budgeted categories that went over,
 * biggest overrun first. All sums at cent precision.
 */
export function compareBudgetToActual(
  rows: Budget[],
  spentByCategory: Record<string, number>
): BudgetComparison {
  const totalBudget = sumMoney(rows.map(row => row.amount));
  const totalSpent = sumMoney(Object.values(spentByCategory));
  const overCategories = rows
    .map(row => {
      const spent = spentByCategory[row.category] || 0;
      return {category: row.category, budget: row.amount, spent, over: roundMoney(spent - row.amount)};
    })
    .filter(item => item.over > 0)
    .sort((a, b) => b.over - a.over);

  return {
    totalBudget,
    totalSpent,
    delta: roundMoney(totalBudget - totalSpent),
    overCategories
  };
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
