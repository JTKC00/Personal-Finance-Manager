import {compareSpendGroups, type SpendGroupComparison} from './comparisonEngine';
import type {Account, PaymentInstrument, PaymentInstrumentType, Transaction} from '../types/finance';

export const PAYMENT_INSTRUMENT_TYPES: PaymentInstrumentType[] = [
  'credit_card', 'debit_card', 'e_wallet', 'cash', 'bank', 'other',
];

export const PAYMENT_INSTRUMENT_TYPE_LABELS: Record<PaymentInstrumentType, string> = {
  credit_card: '信用卡',
  debit_card: '扣帳卡',
  e_wallet: '電子錢包',
  cash: '現金',
  bank: '銀行',
  other: '其他',
};

export const PAYMENT_TYPES_NEEDING_INSTRUMENT: PaymentInstrumentType[] = [
  'credit_card', 'debit_card', 'e_wallet', 'bank',
];

const LEGACY_METHOD_TO_TYPE: Record<string, PaymentInstrumentType> = {
  信用卡: 'credit_card',
  扣帳卡: 'debit_card',
  電子錢包: 'e_wallet',
  現金: 'cash',
  銀行: 'bank',
  其他: 'other',
};

export type Last4Validation =
  | {ok: true; last4?: string}
  | {ok: false; error: string};

export function paymentMethodFromType(type: PaymentInstrumentType): string {
  return PAYMENT_INSTRUMENT_TYPE_LABELS[type];
}

export function paymentTypeFromMethod(method: string | undefined): PaymentInstrumentType | null {
  if (!method) return null;
  return LEGACY_METHOD_TO_TYPE[method] || 'other';
}

export function instrumentNeedsSecondLayer(type: PaymentInstrumentType): boolean {
  return PAYMENT_TYPES_NEEDING_INSTRUMENT.includes(type);
}

export function validateLast4(value: string | undefined): Last4Validation {
  const trimmed = (value || '').trim();
  if (!trimmed) return {ok: true};
  if (/\s/.test(trimmed)) return {ok: false, error: '只可填最後 4 位數字'};
  if (!/^\d{4}$/.test(trimmed)) return {ok: false, error: '只可填最後 4 位數字，不可輸入完整卡號'};
  return {ok: true, last4: trimmed};
}

export function formatInstrumentLabel(instrument: PaymentInstrument): string {
  return instrument.last4 ? `${instrument.name} ••••${instrument.last4}` : instrument.name;
}

export function resolveTransactionInstrument(
  transaction: Transaction,
  instruments: PaymentInstrument[]
): PaymentInstrument | undefined {
  if (!transaction.paymentInstrumentId) return undefined;
  return instruments.find(item => item.id === transaction.paymentInstrumentId);
}

export function resolveTransactionPaymentType(
  transaction: Transaction,
  instruments: PaymentInstrument[]
): PaymentInstrumentType | null {
  const linked = resolveTransactionInstrument(transaction, instruments);
  if (linked) return linked.type;
  return paymentTypeFromMethod(transaction.paymentMethod);
}

export function comparePaymentTypes(
  currentTransactions: Transaction[],
  comparisonTransactions: Transaction[],
  instruments: PaymentInstrument[]
): SpendGroupComparison[] {
  return compareSpendGroups(currentTransactions, comparisonTransactions, transaction => {
    const type = resolveTransactionPaymentType(transaction, instruments);
    if (!type) return {key: 'unspecified', label: '未指定', linked: false};
    return {key: type, label: PAYMENT_INSTRUMENT_TYPE_LABELS[type], linked: true};
  });
}

export function comparePaymentInstruments(
  currentTransactions: Transaction[],
  comparisonTransactions: Transaction[],
  instruments: PaymentInstrument[]
): {linked: SpendGroupComparison[]; unlinked: SpendGroupComparison[]} {
  const rows = compareSpendGroups(currentTransactions, comparisonTransactions, transaction => {
    const linked = resolveTransactionInstrument(transaction, instruments);
    if (linked) {
      return {key: `id:${linked.id}`, label: formatInstrumentLabel(linked), linked: true};
    }
    const type = paymentTypeFromMethod(transaction.paymentMethod);
    if (!type) return {key: 'unspecified', label: '未指定付款工具', linked: false};
    return {
      key: `legacy:${type}`,
      label: `${PAYMENT_INSTRUMENT_TYPE_LABELS[type]}（未指定具體工具）`,
      linked: false,
    };
  });
  return {
    linked: rows.filter(item => item.linked),
    unlinked: rows.filter(item => !item.linked),
  };
}

export function compareAccounts(
  currentTransactions: Transaction[],
  comparisonTransactions: Transaction[],
  accounts: Account[]
): SpendGroupComparison[] {
  return compareSpendGroups(currentTransactions, comparisonTransactions, transaction => {
    if (!transaction.accountId) return {key: 'unspecified', label: '未指定帳戶', linked: false};
    const account = accounts.find(item => item.id === transaction.accountId);
    return {
      key: `id:${transaction.accountId}`,
      label: account?.name || '已刪除帳戶',
      linked: Boolean(account),
    };
  });
}

export function compareSubscriptions(
  currentTransactions: Transaction[],
  comparisonTransactions: Transaction[],
  names: Record<string, string>
): SpendGroupComparison[] {
  return compareSpendGroups(currentTransactions, comparisonTransactions, transaction => {
    if (!transaction.subscriptionId) return null;
    return {
      key: `id:${transaction.subscriptionId}`,
      label: names[transaction.subscriptionId] || '已刪除訂閱',
      linked: Boolean(names[transaction.subscriptionId]),
    };
  });
}
