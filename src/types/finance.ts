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
  merchantId?: string;
  merchantText?: string;
  paymentMethod?: string;
  paymentInstrumentId?: string;
  subscriptionId?: string;
  note?: string;
  receiptUrl?: string;
  receiptId?: string;
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
  /** Compatibility cache only; derive from deposits or the linked account ledger before use. */
  savedAmount: number;
  /** Canonical ledger only when accountId is absent. */
  deposits?: GoalDeposit[];
  /** When present, the account balance is canonical and deposits are not. */
  accountId?: string;
};

export type OcrConfidence = 'high' | 'medium' | 'low';
export type OcrPaymentMethod = '信用卡' | '現金' | '電子錢包';
export type OcrPaymentEvidence =
  | 'card' | 'visa' | 'mastercard' | 'unionpay' | 'cash' | 'octopus' | 'fps' | 'payme'
  | 'alipayhk' | 'wechat_pay_hk' | 'apple_pay' | 'google_pay' | 'other_wallet';

export type OcrPaymentMethodCandidate = {
  method: OcrPaymentMethod;
  evidence: OcrPaymentEvidence;
  modelConfidence: OcrConfidence;
};

export type OcrResult = {
  amount: number | null;
  merchant: string | null;
  category: string;
  note: string;
  date: string | null;
  paymentMethodCandidates: OcrPaymentMethodCandidate[];
  modelConfidence: {
    amount: OcrConfidence;
    merchant: OcrConfidence;
    date: OcrConfidence;
    category: OcrConfidence;
    paymentMethod: OcrConfidence;
  };
};

export type OcrReviewValues = {
  amount: number;
  merchant: string;
  category: string;
  note: string;
  date: string;
  paymentMethod: string;
};

export type ReceiptDuplicateCandidate = {
  transactionId: string;
  risk: 'high' | 'possible';
  reasons: string[];
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
  ai?: {
    rawJson: string;
    parsed: OcrResult;
    model: string;
    promptVersion: string;
    schemaVersion: number;
    completedAt: string;
  };
  review?: {
    final: OcrReviewValues;
    changedFields: Array<keyof OcrReviewValues>;
    confirmedAt: string;
    duplicateDecision: 'none' | 'proceeded';
    duplicateTransactionIds: string[];
  };
  duplicateCandidates?: ReceiptDuplicateCandidate[];
  transactionId?: string;
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

export type Merchant = {
  id: string;
  name: string;
  aliases: string[];
  createdAt: string;
};

export type PaymentInstrumentType =
  | 'credit_card'
  | 'debit_card'
  | 'e_wallet'
  | 'cash'
  | 'bank'
  | 'other';

export type PaymentInstrument = {
  id: string;
  name: string;
  type: PaymentInstrumentType;
  provider?: string;
  last4?: string;
  accountId?: string;
  active: boolean;
  createdAt: string;
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

export type SubscriptionFrequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export type Subscription = {
  id: string;
  name: string;
  amount: number;
  currency: string;
  category: string;
  paymentMethod: string;
  frequency: SubscriptionFrequency;
  nextBillingDate: string;
  trialEndDate?: string;
  reminderDays: number;
  active: boolean;
  lastPostedDate?: string;
  note?: string;
  createdAt: string;
};
