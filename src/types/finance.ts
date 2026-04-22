export type TransactionType = 'income' | 'expense';

export type Transaction = {
  id: string;
  type: TransactionType;
  amount: number;
  currency: string;
  date: string;
  category: string;
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
};

export type OcrResult = {
  amount: number;
  category: string;
  note: string;
  date: string;
};

export type Receipt = {
  id: string;
  imageBase64?: string;
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
  amount: number;
  date: string;
};

export type AnalyticsEvent = {
  name: string;
  props?: Record<string, unknown>;
  at: string;
};
