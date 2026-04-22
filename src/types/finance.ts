export type TransactionType = 'income' | 'expense';

export type Transaction = {
  id: string;
  type: TransactionType;
  amount: number;
  currency: string;
  date: string;
  category: string;
  goalId?: string;
  linkedGoalEntryId?: string;
  accountId?: string;
  linkedTransferId?: string;
  merchant?: string;
  paymentMethod?: string;
  note?: string;
  receiptUrl?: string;
  createdAt: string;
};

export type Budget = {
  id: string;
  category: string;
  month: string;
  amount: number;
  warnThreshold: number;
  dangerThreshold: number;
};

export type Goal = {
  id: string;
  name: string;
  targetAmount: number;
  targetDate?: string;
  savedAmount: number;
  deposits?: GoalDeposit[];
  accountId?: string;
};

export type OcrResult = {
  amount: number;
  category: string;
  note: string;
  date: string;
};

export type Receipt = {
  id: string;
  imageUri?: string;
  status: 'processing' | 'done' | 'failed';
  amount?: number;
  category?: string;
  note?: string;
  date?: string;
  lowFields?: string[];
  needsConfirm?: boolean;
  createdAt: string;
};

export type GoalDeposit = {
  id: string;
  amount: number;
  date: string;
  type: 'deposit' | 'withdraw';
  note?: string;
  linkedTransactionId?: string;
};

export type AccountType = 'cash' | 'bank' | 'wallet' | 'credit';

export type Account = {
  id: string;
  name: string;
  type: AccountType;
  initialBalance: number;
  currency: string;
  createdAt: string;
};

export type Transfer = {
  id: string;
  fromAccountId: string | null;
  toAccountId: string | null;
  amount: number;
  date: string;
  note?: string;
  transactionId?: string;
  goalId?: string;
  createdAt: string;
};

export type AnalyticsEvent = {
  name: string;
  props?: Record<string, unknown>;
  at: string;
};
