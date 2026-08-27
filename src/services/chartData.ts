import {buildPeriodTotals, getShortMonthLabel, listMonthRange} from './comparisonEngine';
import {roundMoney, sumMoney} from './money';
import type {Transaction} from '../types/finance';

export type TrendChartDatum = {
  month: string;
  label: string;
  income: number;
  expense: number;
  balance: number;
};

export type DailySpendChartDatum = {
  day: string;
  amount: number;
};

export function buildTrendChartData(
  monthlyTransactions: Record<string, Transaction[]>,
  options: {selectedMonth: string; currentMonth: string; today: Date; monthCount?: number}
): TrendChartDatum[] {
  const monthCount = options.monthCount ?? 6;
  return listMonthRange(options.selectedMonth, monthCount).map(month => {
    const totals = buildPeriodTotals(monthlyTransactions[month] || [], {
      month,
      currentMonth: options.currentMonth,
      today: options.today,
    });
    return {
      month,
      label: getShortMonthLabel(month),
      income: Math.round(totals.income),
      expense: Math.round(totals.expense),
      balance: Math.round(totals.balance),
    };
  });
}

export function buildDailySpendChartData(
  transactions: Transaction[],
  dayCount: number
): DailySpendChartDatum[] {
  const amounts = Array.from({length: dayCount}, () => 0);
  transactions.filter(item => item.type === 'expense').forEach(item => {
    const day = parseInt(item.date.split('-')[2], 10) - 1;
    if (day >= 0 && day < dayCount) amounts[day] = sumMoney([amounts[day], item.amount]);
  });
  return amounts.map((amount, index) => ({day: String(index + 1), amount: roundMoney(amount)}));
}
