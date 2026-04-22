import AsyncStorage from '@react-native-async-storage/async-storage';
import {AnalyticsEvent, Budget, Goal, Receipt, Transaction} from '../types/finance';

const KEYS = {
  transactions: 'fin_txns',
  budgets: 'fin_budgets',
  receipts: 'fin_receipts',
  goals: 'fin_goals',
  events: 'fin_events'
} as const;

async function loadJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await AsyncStorage.getItem(key);
  return raw ? JSON.parse(raw) as T : fallback;
}

async function saveJson<T>(key: string, value: T): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

export function getCurrentMonthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export async function loadTransactions(): Promise<Transaction[]> {
  return loadJson<Transaction[]>(KEYS.transactions, []);
}

export async function saveTransactions(transactions: Transaction[]): Promise<void> {
  await saveJson(KEYS.transactions, transactions);
}

export async function getTransactionsByMonth(month = getCurrentMonthKey()): Promise<Transaction[]> {
  const transactions = await loadTransactions();
  return transactions.filter(item => item.date.startsWith(month));
}

export async function upsertTransaction(transaction: Transaction): Promise<Transaction[]> {
  const transactions = await loadTransactions();
  const exists = transactions.some(item => item.id === transaction.id);
  const next = exists
    ? transactions.map(item => (item.id === transaction.id ? transaction : item))
    : [...transactions, transaction];
  await saveTransactions(next);
  return next;
}

export async function deleteTransaction(id: string): Promise<Transaction[]> {
  const transactions = await loadTransactions();
  const next = transactions.filter(item => item.id !== id);
  await saveTransactions(next);
  return next;
}

export async function loadBudgets(): Promise<Record<string, number>> {
  return loadJson<Record<string, number>>(KEYS.budgets, {});
}

export async function saveBudget(category: string, amount: number): Promise<Record<string, number>> {
  const budgets = await loadBudgets();
  const next = {...budgets, [category]: amount};
  await saveJson(KEYS.budgets, next);
  return next;
}

export async function loadBudgetRows(): Promise<Budget[]> {
  const budgets = await loadBudgets();
  const month = getCurrentMonthKey();
  return Object.entries(budgets).map(([category, amount]) => ({
    id: `${month}-${category}`,
    category,
    month,
    amount,
    warnThreshold: 0.7,
    dangerThreshold: 0.9
  }));
}

export async function loadReceipts(): Promise<Receipt[]> {
  return loadJson<Receipt[]>(KEYS.receipts, []);
}

export async function upsertReceipt(receipt: Receipt): Promise<Receipt[]> {
  const receipts = await loadReceipts();
  const exists = receipts.some(item => item.id === receipt.id);
  const next = exists
    ? receipts.map(item => (item.id === receipt.id ? receipt : item))
    : [...receipts, receipt];
  await saveJson(KEYS.receipts, next);
  return next;
}

export async function loadGoals(): Promise<Goal[]> {
  return loadJson<Goal[]>(KEYS.goals, []);
}

export async function upsertGoal(goal: Goal): Promise<Goal[]> {
  const goals = await loadGoals();
  const exists = goals.some(item => item.id === goal.id);
  const next = exists
    ? goals.map(item => (item.id === goal.id ? goal : item))
    : [...goals, goal];
  await saveJson(KEYS.goals, next);
  return next;
}

export async function deleteGoal(id: string): Promise<Goal[]> {
  const goals = await loadGoals();
  const next = goals.filter(item => item.id !== id);
  await saveJson(KEYS.goals, next);
  return next;
}

export async function trackEvent(name: string, props: Record<string, unknown> = {}): Promise<AnalyticsEvent[]> {
  const events = await loadJson<AnalyticsEvent[]>(KEYS.events, []);
  const next = [...events, {name, props, at: new Date().toISOString()}].slice(-500);
  await saveJson(KEYS.events, next);
  return next;
}

export async function loadEvents(): Promise<AnalyticsEvent[]> {
  return loadJson<AnalyticsEvent[]>(KEYS.events, []);
}

export async function clearSensitiveCache(): Promise<void> {
  await AsyncStorage.multiRemove([KEYS.transactions, KEYS.budgets, KEYS.receipts, KEYS.goals, KEYS.events]);
}

export async function getMonthlySummary(month = getCurrentMonthKey()) {
  const transactions = await getTransactionsByMonth(month);
  const income = transactions.filter(item => item.type === 'income').reduce((sum, item) => sum + item.amount, 0);
  const expense = transactions.filter(item => item.type === 'expense').reduce((sum, item) => sum + item.amount, 0);
  return {
    income,
    expense,
    balance: income - expense,
    count: transactions.length
  };
}

export async function getCategoryBreakdown(month = getCurrentMonthKey()): Promise<Record<string, number>> {
  const transactions = await getTransactionsByMonth(month);
  const map: Record<string, number> = {};
  transactions
    .filter(item => item.type === 'expense')
    .forEach(item => {
      map[item.category] = (map[item.category] || 0) + item.amount;
    });
  return map;
}
