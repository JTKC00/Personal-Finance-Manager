import type {Subscription, Transaction} from '../types/finance';
import {normalizeCurrency} from './financeLogic';

function escapeCsvCell(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

export function buildTransactionsCsv(
  transactions: Transaction[],
  subscriptions: Pick<Subscription, 'id' | 'name'>[]
): string {
  const subscriptionMap = new Map(subscriptions.map(item => [item.id, item.name]));
  const header = ['日期', '類型', '金額', '幣別', '分類', '商戶', '備註', '付款方式', '訂閱'];
  const rows = [...transactions]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(transaction => [
      transaction.date,
      transaction.type === 'income' ? '收入' : '支出',
      transaction.amount,
      normalizeCurrency(transaction.currency || 'HKD'),
      transaction.category,
      transaction.merchantText || transaction.merchant || '',
      transaction.note || '',
      transaction.paymentMethod || '',
      transaction.subscriptionId
        ? (subscriptionMap.get(transaction.subscriptionId) || transaction.subscriptionId)
        : '',
    ]);

  return [header, ...rows]
    .map(row => row.map(escapeCsvCell).join(','))
    .join('\n');
}
