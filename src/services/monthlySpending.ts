import {
  getMonthDateRange,
  getSubscriptionChargesForMonth,
  normalizeCurrency,
  sumExpensesByCategory,
  sumSubscriptionChargesByCategory,
  summarizeTransactionsByCurrency,
  type CurrencySummary,
  type SubscriptionCharge,
} from './financeLogic';
import {roundMoney, sumMoney} from './money';
import type {Budget, Subscription, Transaction} from '../types/finance';

export type MonthlyCurrencySpending = {
  currency: string;
  actual: CurrencySummary;
  future: CurrencySummary;
  actualSubscriptionExpense: number;
  futureSubscriptionExpense: number;
  pendingSubscriptionExpense: number | null;
  knownExpense: number | null;
  knownSubscriptionExpense: number | null;
  spentByCategory: Record<string, number>;
  futureByCategory: Record<string, number>;
  pendingByCategory: Record<string, number> | null;
};

/** Read-only projection: future-dated records never become actual spending early. */
export function buildMonthlySpending(options: {
  month: string;
  today: string;
  transactions: Transaction[];
  /** null means unavailable, not an empty subscription directory. */
  subscriptions: Subscription[] | null;
}) {
  const {month, today, subscriptions} = options;
  const {start, endExclusive} = getMonthDateRange(month);
  const transactions = options.transactions.filter(t => t.date >= start && t.date < endExclusive);
  const actualTransactions = transactions.filter(t => t.date <= today);
  const futureTransactions = transactions.filter(t => t.date > today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  // A recorded expense represents that occurrence even when future-dated or its
  // amount/currency differs from the current subscription. Count the record once.
  const recordedCharges = new Set(transactions.filter(t => t.type === 'expense' && t.subscriptionId)
    .map(t => `${t.subscriptionId}:${t.date}`));
  const pendingCharges: SubscriptionCharge[] | null = subscriptions === null ? null
    : getSubscriptionChargesForMonth(subscriptions, month, [], today)
      .filter(charge => !recordedCharges.has(`${charge.subscription.id}:${charge.date}`));
  const actualSummaries = summarizeTransactionsByCurrency(actualTransactions);
  const futureSummaries = summarizeTransactionsByCurrency(futureTransactions);
  const currencies = new Set(['HKD', ...transactions.map(t => normalizeCurrency(t.currency)),
    ...(pendingCharges || []).map(c => normalizeCurrency(c.subscription.currency))]);
  const empty = (currency: string): CurrencySummary => ({currency, income: 0, expense: 0, balance: 0, count: 0});
  const byCurrency: MonthlyCurrencySpending[] = [...currencies].sort().map(currency => {
    const actualItems = actualTransactions.filter(t => normalizeCurrency(t.currency) === currency);
    const futureItems = futureTransactions.filter(t => normalizeCurrency(t.currency) === currency);
    const charges = pendingCharges?.filter(c => normalizeCurrency(c.subscription.currency) === currency) ?? null;
    const actual = actualSummaries.find(s => s.currency === currency) || empty(currency);
    const future = futureSummaries.find(s => s.currency === currency) || empty(currency);
    const actualSubscriptionExpense = sumMoney(actualItems.filter(t => t.type === 'expense' && t.subscriptionId).map(t => t.amount));
    const futureSubscriptionExpense = sumMoney(futureItems.filter(t => t.type === 'expense' && t.subscriptionId).map(t => t.amount));
    const pendingSubscriptionExpense = charges === null ? null : sumMoney(charges.map(c => c.amount));
    return {
      currency, actual, future, actualSubscriptionExpense, futureSubscriptionExpense, pendingSubscriptionExpense,
      knownExpense: pendingSubscriptionExpense === null ? null : sumMoney([actual.expense, future.expense, pendingSubscriptionExpense]),
      knownSubscriptionExpense: pendingSubscriptionExpense === null ? null : sumMoney([actualSubscriptionExpense, futureSubscriptionExpense, pendingSubscriptionExpense]),
      spentByCategory: sumExpensesByCategory(actualItems),
      futureByCategory: sumExpensesByCategory(futureItems),
      pendingByCategory: charges === null ? null : sumSubscriptionChargesByCategory(charges),
    };
  });
  return {month, today, actualTransactions, futureTransactions, pendingCharges, byCurrency, base: byCurrency.find(c => c.currency === 'HKD')!};
}
export type MonthlySpending = ReturnType<typeof buildMonthlySpending>;

export function buildSpendingBudget(amount: number, spent: number, future: number, pending: number | null) {
  const budgetAmount = roundMoney(amount);
  const knownExpense = pending === null ? null : sumMoney([spent, future, pending]);
  return {
    budgetAmount, spent, future, pending, knownExpense,
    remaining: roundMoney(budgetAmount - spent),
    projectedRemaining: knownExpense === null ? null : roundMoney(budgetAmount - knownExpense),
    usedRatio: budgetAmount > 0 ? spent / budgetAmount : 0,
    usedPercentage: budgetAmount > 0 ? Math.round(spent / budgetAmount * 100) : 0,
  };
}

/** Category budgets are HKD; foreign spending must not consume them. */
export function buildMonthlyBudgetRows(budgets: Budget[], spending: MonthlySpending) {
  const {spentByCategory, futureByCategory, pendingByCategory} = spending.base;
  return budgets.filter(b => b.month === spending.month && b.amount > 0).map(b => ({
    category: b.category,
    ...buildSpendingBudget(b.amount, spentByCategory[b.category] || 0, futureByCategory[b.category] || 0,
      pendingByCategory === null ? null : pendingByCategory[b.category] || 0),
  }));
}

export function buildMonthlyBudgetTotal(budgets: Budget[], spending: MonthlySpending) {
  return buildSpendingBudget(sumMoney(budgets.filter(b => b.month === spending.month && b.amount > 0).map(b => b.amount)),
    spending.base.actual.expense, spending.base.future.expense, spending.base.pendingSubscriptionExpense);
}
