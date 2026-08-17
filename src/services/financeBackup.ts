import type {
  Account, Goal, Merchant, PaymentInstrument, PaymentInstrumentType, Receipt, Subscription, Transaction, Transfer,
} from '../types/finance';

export const FINANCE_BACKUP_VERSION = 6;

export type BudgetMonthBackup = {
  month: string;
  budgets: Record<string, number>;
};

export type FinanceBackup = {
  version: typeof FINANCE_BACKUP_VERSION;
  exportedAt: string;
  userEmail: string;
  transactions: Transaction[];
  goals: Goal[];
  subscriptions: Subscription[];
  budgets: Record<string, number>;
  budgetMonths: BudgetMonthBackup[];
  receipts: Receipt[];
  accounts: Account[];
  transfers: Transfer[];
  merchants: Merchant[];
  paymentInstruments: PaymentInstrument[];
};

export type BackupValidationResult =
  | {ok: true; backup: FinanceBackup}
  | {ok: false; errors: string[]};

export type BackupDiffRow = {
  key: keyof Pick<FinanceBackup, 'transactions' | 'goals' | 'subscriptions' | 'budgets' | 'budgetMonths' | 'receipts' | 'accounts' | 'transfers' | 'merchants' | 'paymentInstruments'>;
  label: string;
  backupCount: number;
  currentCount: number;
  added: number;
  updated: number;
  removed: number;
};

const PAYMENT_INSTRUMENT_TYPES: PaymentInstrumentType[] = [
  'credit_card', 'debit_card', 'e_wallet', 'cash', 'bank', 'other',
];

const dateKeyPattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const monthKeyPattern = /^(\d{4})-(\d{2})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], path: string, errors: string[]) {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) errors.push(`${path}.${key} 是不受支援的欄位`);
  }
}

function requireString(value: Record<string, unknown>, key: string, path: string, errors: string[], allowEmpty = false) {
  const item = value[key];
  if (typeof item !== 'string' || (!allowEmpty && !item.trim())) errors.push(`${path}.${key} 必須是${allowEmpty ? '' : '非空白'}文字`);
}

function optionalString(value: Record<string, unknown>, key: string, path: string, errors: string[]) {
  if (value[key] !== undefined && typeof value[key] !== 'string') errors.push(`${path}.${key} 必須是文字`);
}

function requireNumber(value: Record<string, unknown>, key: string, path: string, errors: string[], minimum = 0) {
  const item = value[key];
  if (typeof item !== 'number' || !Number.isFinite(item) || item < minimum) {
    errors.push(`${path}.${key} 必須是大於或等於 ${minimum} 的有限數字`);
  }
}

function requireFiniteNumber(value: Record<string, unknown>, key: string, path: string, errors: string[]) {
  if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) errors.push(`${path}.${key} 必須是有限數字`);
}

function optionalNumber(value: Record<string, unknown>, key: string, path: string, errors: string[], minimum = 0) {
  if (value[key] !== undefined) requireNumber(value, key, path, errors, minimum);
}

function requireDateKey(value: Record<string, unknown>, key: string, path: string, errors: string[]) {
  requireString(value, key, path, errors);
  if (typeof value[key] !== 'string') return;
  const match = dateKeyPattern.exec(value[key]);
  if (!match) {
    errors.push(`${path}.${key} 必須是有效的 YYYY-MM-DD`);
    return;
  }
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    errors.push(`${path}.${key} 必須是有效的 YYYY-MM-DD`);
  }
}

function optionalDateKey(value: Record<string, unknown>, key: string, path: string, errors: string[]) {
  if (value[key] === undefined) return;
  requireDateKey(value, key, path, errors);
}

function requireIsoDate(value: Record<string, unknown>, key: string, path: string, errors: string[]) {
  requireString(value, key, path, errors);
  if (typeof value[key] === 'string' && Number.isNaN(Date.parse(value[key]))) errors.push(`${path}.${key} 必須是有效日期時間`);
}

function validateId(value: Record<string, unknown>, path: string, errors: string[]) {
  requireString(value, 'id', path, errors);
  if (typeof value.id === 'string' && value.id.includes('/')) errors.push(`${path}.id 不可包含 /`);
}

function validateBudgetRecord(value: unknown, path: string, errors: string[]): value is Record<string, number> {
  if (!isRecord(value)) {
    errors.push(`${path} 必須是預算物件`);
    return false;
  }
  for (const [category, amount] of Object.entries(value)) {
    if (!category.trim()) errors.push(`${path} 不可包含空白分類`);
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
      errors.push(`${path}.${category} 必須是大於或等於 0 的有限數字`);
    }
  }
  return true;
}

function validateTransactions(value: unknown, errors: string[], version = FINANCE_BACKUP_VERSION): value is Transaction[] {
  if (!Array.isArray(value)) {
    errors.push('transactions 必須是陣列');
    return false;
  }
  const ids = new Set<string>();
  value.forEach((item, index) => {
    const path = `transactions[${index}]`;
    if (!isRecord(item)) return errors.push(`${path} 必須是物件`);
    hasOnlyKeys(item, [
      'id', 'type', 'amount', 'currency', 'date', 'category', 'goalId', 'linkedGoalEntryId',
      'accountId', 'linkedTransferId', 'merchant', 'paymentMethod', 'subscriptionId', 'note',
      'receiptUrl', ...(version >= 5 ? ['receiptId'] : []),
      ...(version >= 6 ? ['merchantId', 'merchantText', 'paymentInstrumentId'] : []),
      'createdAt',
    ], path, errors);
    validateId(item, path, errors);
    if (item.type !== 'income' && item.type !== 'expense') errors.push(`${path}.type 必須是 income 或 expense`);
    requireNumber(item, 'amount', path, errors);
    requireString(item, 'currency', path, errors);
    requireDateKey(item, 'date', path, errors);
    requireString(item, 'category', path, errors);
    [
      'goalId', 'linkedGoalEntryId', 'accountId', 'linkedTransferId', 'merchant', 'paymentMethod', 'subscriptionId', 'note', 'receiptUrl',
      ...(version >= 5 ? ['receiptId'] : []),
      ...(version >= 6 ? ['merchantId', 'merchantText', 'paymentInstrumentId'] : []),
    ].forEach(key => optionalString(item, key, path, errors));
    requireIsoDate(item, 'createdAt', path, errors);
    if (typeof item.id === 'string') {
      if (ids.has(item.id)) errors.push(`${path}.id 重複`);
      ids.add(item.id);
    }
  });
  return true;
}

function validateGoals(value: unknown, errors: string[]): value is Goal[] {
  if (!Array.isArray(value)) {
    errors.push('goals 必須是陣列');
    return false;
  }
  const ids = new Set<string>();
  value.forEach((item, index) => {
    const path = `goals[${index}]`;
    if (!isRecord(item)) return errors.push(`${path} 必須是物件`);
    hasOnlyKeys(item, ['id', 'name', 'targetAmount', 'targetDate', 'savedAmount', 'deposits', 'accountId'], path, errors);
    validateId(item, path, errors);
    requireString(item, 'name', path, errors);
    requireNumber(item, 'targetAmount', path, errors);
    optionalDateKey(item, 'targetDate', path, errors);
    requireNumber(item, 'savedAmount', path, errors);
    optionalString(item, 'accountId', path, errors);
    if (item.deposits !== undefined) {
      if (!Array.isArray(item.deposits)) {
        errors.push(`${path}.deposits 必須是陣列`);
      } else {
        const depositIds = new Set<string>();
        item.deposits.forEach((entry, entryIndex) => {
          const entryPath = `${path}.deposits[${entryIndex}]`;
          if (!isRecord(entry)) return errors.push(`${entryPath} 必須是物件`);
          hasOnlyKeys(entry, ['id', 'amount', 'date', 'type', 'note', 'linkedTransactionId'], entryPath, errors);
          validateId(entry, entryPath, errors);
          requireNumber(entry, 'amount', entryPath, errors);
          requireDateKey(entry, 'date', entryPath, errors);
          if (entry.type !== 'deposit' && entry.type !== 'withdraw') errors.push(`${entryPath}.type 必須是 deposit 或 withdraw`);
          optionalString(entry, 'note', entryPath, errors);
          optionalString(entry, 'linkedTransactionId', entryPath, errors);
          if (typeof entry.id === 'string') {
            if (depositIds.has(entry.id)) errors.push(`${entryPath}.id 重複`);
            depositIds.add(entry.id);
          }
        });
      }
    }
    if (typeof item.id === 'string') {
      if (ids.has(item.id)) errors.push(`${path}.id 重複`);
      ids.add(item.id);
    }
  });
  return true;
}

function validateSubscriptions(value: unknown, errors: string[]): value is Subscription[] {
  if (!Array.isArray(value)) {
    errors.push('subscriptions 必須是陣列');
    return false;
  }
  const ids = new Set<string>();
  value.forEach((item, index) => {
    const path = `subscriptions[${index}]`;
    if (!isRecord(item)) return errors.push(`${path} 必須是物件`);
    hasOnlyKeys(item, ['id', 'name', 'amount', 'currency', 'category', 'paymentMethod', 'frequency', 'nextBillingDate', 'trialEndDate', 'reminderDays', 'active', 'lastPostedDate', 'note', 'createdAt'], path, errors);
    validateId(item, path, errors);
    requireString(item, 'name', path, errors);
    requireNumber(item, 'amount', path, errors);
    requireString(item, 'currency', path, errors);
    requireString(item, 'category', path, errors);
    requireString(item, 'paymentMethod', path, errors);
    if (!['weekly', 'monthly', 'quarterly', 'yearly'].includes(String(item.frequency))) errors.push(`${path}.frequency 無效`);
    requireDateKey(item, 'nextBillingDate', path, errors);
    optionalDateKey(item, 'trialEndDate', path, errors);
    requireNumber(item, 'reminderDays', path, errors);
    if (typeof item.active !== 'boolean') errors.push(`${path}.active 必須是 true 或 false`);
    optionalDateKey(item, 'lastPostedDate', path, errors);
    optionalString(item, 'note', path, errors);
    requireIsoDate(item, 'createdAt', path, errors);
    if (typeof item.id === 'string') {
      if (ids.has(item.id)) errors.push(`${path}.id 重複`);
      ids.add(item.id);
    }
  });
  return true;
}

const ocrConfidenceLevels = ['high', 'medium', 'low'];
const ocrPaymentMethods = ['信用卡', '現金', '電子錢包'];
const ocrPaymentEvidence = [
  'card', 'visa', 'mastercard', 'unionpay', 'cash', 'octopus', 'fps', 'payme', 'alipayhk',
  'wechat_pay_hk', 'apple_pay', 'google_pay', 'other_wallet',
];
const ocrReviewFields = ['amount', 'merchant', 'category', 'note', 'date', 'paymentMethod'];

function validateOcrConfidence(value: unknown, path: string, errors: string[]) {
  if (!isRecord(value)) return errors.push(`${path} 必須是物件`);
  const keys = ['amount', 'merchant', 'date', 'category', 'paymentMethod'];
  hasOnlyKeys(value, keys, path, errors);
  keys.forEach(key => {
    if (!ocrConfidenceLevels.includes(String(value[key]))) errors.push(`${path}.${key} 無效`);
  });
}

function validateOcrParsed(value: unknown, path: string, errors: string[]) {
  if (!isRecord(value)) return errors.push(`${path} 必須是物件`);
  hasOnlyKeys(value, ['amount', 'merchant', 'category', 'note', 'date', 'paymentMethodCandidates', 'modelConfidence'], path, errors);
  if (value.amount !== null) requireNumber(value, 'amount', path, errors, 0.01);
  if (value.merchant !== null) requireString(value, 'merchant', path, errors);
  requireString(value, 'category', path, errors);
  requireString(value, 'note', path, errors, true);
  if (value.date !== null) requireDateKey(value, 'date', path, errors);
  if (!Array.isArray(value.paymentMethodCandidates) || value.paymentMethodCandidates.length > 3) {
    errors.push(`${path}.paymentMethodCandidates 必須是最多三項的陣列`);
  } else {
    value.paymentMethodCandidates.forEach((candidate, index) => {
      const candidatePath = `${path}.paymentMethodCandidates[${index}]`;
      if (!isRecord(candidate)) return errors.push(`${candidatePath} 必須是物件`);
      hasOnlyKeys(candidate, ['method', 'evidence', 'modelConfidence'], candidatePath, errors);
      if (!ocrPaymentMethods.includes(String(candidate.method))) errors.push(`${candidatePath}.method 無效`);
      if (!ocrPaymentEvidence.includes(String(candidate.evidence))) errors.push(`${candidatePath}.evidence 無效`);
      if (!ocrConfidenceLevels.includes(String(candidate.modelConfidence))) errors.push(`${candidatePath}.modelConfidence 無效`);
    });
  }
  validateOcrConfidence(value.modelConfidence, `${path}.modelConfidence`, errors);
}

function validateReceiptAi(value: unknown, path: string, errors: string[]) {
  if (!isRecord(value)) return errors.push(`${path} 必須是物件`);
  hasOnlyKeys(value, ['rawJson', 'parsed', 'model', 'promptVersion', 'schemaVersion', 'completedAt'], path, errors);
  requireString(value, 'rawJson', path, errors);
  validateOcrParsed(value.parsed, `${path}.parsed`, errors);
  requireString(value, 'model', path, errors);
  requireString(value, 'promptVersion', path, errors);
  requireNumber(value, 'schemaVersion', path, errors, 1);
  requireIsoDate(value, 'completedAt', path, errors);
}

function validateReceiptReview(value: unknown, path: string, errors: string[]) {
  if (!isRecord(value)) return errors.push(`${path} 必須是物件`);
  hasOnlyKeys(value, ['final', 'changedFields', 'confirmedAt', 'duplicateDecision', 'duplicateTransactionIds'], path, errors);
  if (!isRecord(value.final)) {
    errors.push(`${path}.final 必須是物件`);
  } else {
    hasOnlyKeys(value.final, ocrReviewFields, `${path}.final`, errors);
    requireNumber(value.final, 'amount', `${path}.final`, errors, 0.01);
    requireString(value.final, 'merchant', `${path}.final`, errors, true);
    requireString(value.final, 'category', `${path}.final`, errors);
    requireString(value.final, 'note', `${path}.final`, errors, true);
    requireDateKey(value.final, 'date', `${path}.final`, errors);
    requireString(value.final, 'paymentMethod', `${path}.final`, errors, true);
  }
  if (!Array.isArray(value.changedFields) || value.changedFields.some(field => !ocrReviewFields.includes(String(field)))) {
    errors.push(`${path}.changedFields 無效`);
  }
  requireIsoDate(value, 'confirmedAt', path, errors);
  if (!['none', 'proceeded'].includes(String(value.duplicateDecision))) errors.push(`${path}.duplicateDecision 無效`);
  if (!Array.isArray(value.duplicateTransactionIds) || value.duplicateTransactionIds.some(id => typeof id !== 'string')) {
    errors.push(`${path}.duplicateTransactionIds 必須是文字陣列`);
  }
}

function validateDuplicateCandidates(value: unknown, path: string, errors: string[]) {
  if (!Array.isArray(value)) return errors.push(`${path} 必須是陣列`);
  value.forEach((candidate, index) => {
    const candidatePath = `${path}[${index}]`;
    if (!isRecord(candidate)) return errors.push(`${candidatePath} 必須是物件`);
    hasOnlyKeys(candidate, ['transactionId', 'risk', 'reasons'], candidatePath, errors);
    requireString(candidate, 'transactionId', candidatePath, errors);
    if (!['high', 'possible'].includes(String(candidate.risk))) errors.push(`${candidatePath}.risk 無效`);
    if (!Array.isArray(candidate.reasons) || candidate.reasons.some(reason => typeof reason !== 'string')) {
      errors.push(`${candidatePath}.reasons 必須是文字陣列`);
    }
  });
}

function validateReceipts(value: unknown, errors: string[], version = FINANCE_BACKUP_VERSION): value is Receipt[] {
  if (!Array.isArray(value)) {
    errors.push('receipts 必須是陣列');
    return false;
  }
  const ids = new Set<string>();
  value.forEach((item, index) => {
    const path = `receipts[${index}]`;
    if (!isRecord(item)) return errors.push(`${path} 必須是物件`);
    hasOnlyKeys(item, [
      'id', 'imageUri', 'status', 'amount', 'category', 'note', 'date', 'lowFields', 'needsConfirm',
      ...(version >= 5 ? ['ai', 'review', 'duplicateCandidates', 'transactionId'] : []),
      'createdAt',
    ], path, errors);
    validateId(item, path, errors);
    optionalString(item, 'imageUri', path, errors);
    if (!['processing', 'done', 'failed'].includes(String(item.status))) errors.push(`${path}.status 無效`);
    optionalNumber(item, 'amount', path, errors);
    optionalString(item, 'category', path, errors);
    optionalString(item, 'note', path, errors);
    optionalDateKey(item, 'date', path, errors);
    if (item.lowFields !== undefined && (!Array.isArray(item.lowFields) || item.lowFields.some(field => typeof field !== 'string'))) errors.push(`${path}.lowFields 必須是文字陣列`);
    if (item.needsConfirm !== undefined && typeof item.needsConfirm !== 'boolean') errors.push(`${path}.needsConfirm 必須是 true 或 false`);
    if (version >= 5) {
      if (item.ai !== undefined) validateReceiptAi(item.ai, `${path}.ai`, errors);
      if (item.review !== undefined) validateReceiptReview(item.review, `${path}.review`, errors);
      if (item.duplicateCandidates !== undefined) validateDuplicateCandidates(item.duplicateCandidates, `${path}.duplicateCandidates`, errors);
      optionalString(item, 'transactionId', path, errors);
    }
    requireIsoDate(item, 'createdAt', path, errors);
    if (typeof item.id === 'string') {
      if (ids.has(item.id)) errors.push(`${path}.id 重複`);
      ids.add(item.id);
    }
  });
  return true;
}

function validateAccounts(value: unknown, errors: string[]): value is Account[] {
  if (!Array.isArray(value)) {
    errors.push('accounts 必須是陣列');
    return false;
  }
  const ids = new Set<string>();
  value.forEach((item, index) => {
    const path = `accounts[${index}]`;
    if (!isRecord(item)) return errors.push(`${path} 必須是物件`);
    hasOnlyKeys(item, ['id', 'name', 'type', 'initialBalance', 'currency', 'createdAt'], path, errors);
    validateId(item, path, errors);
    requireString(item, 'name', path, errors);
    if (!['cash', 'bank', 'wallet', 'credit'].includes(String(item.type))) errors.push(`${path}.type 無效`);
    requireFiniteNumber(item, 'initialBalance', path, errors);
    requireString(item, 'currency', path, errors);
    requireIsoDate(item, 'createdAt', path, errors);
    if (typeof item.id === 'string') {
      if (ids.has(item.id)) errors.push(`${path}.id 重複`);
      ids.add(item.id);
    }
  });
  return true;
}

function validateTransfers(value: unknown, errors: string[]): value is Transfer[] {
  if (!Array.isArray(value)) {
    errors.push('transfers 必須是陣列');
    return false;
  }
  const ids = new Set<string>();
  value.forEach((item, index) => {
    const path = `transfers[${index}]`;
    if (!isRecord(item)) return errors.push(`${path} 必須是物件`);
    hasOnlyKeys(item, ['id', 'fromAccountId', 'toAccountId', 'amount', 'date', 'note', 'transactionId', 'goalId', 'createdAt'], path, errors);
    validateId(item, path, errors);
    for (const key of ['fromAccountId', 'toAccountId']) {
      if (item[key] !== null && typeof item[key] !== 'string') errors.push(`${path}.${key} 必須是文字或 null`);
    }
    requireNumber(item, 'amount', path, errors);
    requireDateKey(item, 'date', path, errors);
    optionalString(item, 'note', path, errors);
    optionalString(item, 'transactionId', path, errors);
    optionalString(item, 'goalId', path, errors);
    requireIsoDate(item, 'createdAt', path, errors);
    if (typeof item.id === 'string') {
      if (ids.has(item.id)) errors.push(`${path}.id 重複`);
      ids.add(item.id);
    }
  });
  return true;
}

function validateBudgetMonths(value: unknown, errors: string[]): value is BudgetMonthBackup[] {
  if (!Array.isArray(value)) {
    errors.push('budgetMonths 必須是陣列');
    return false;
  }
  const months = new Set<string>();
  value.forEach((item, index) => {
    const path = `budgetMonths[${index}]`;
    if (!isRecord(item)) return errors.push(`${path} 必須是物件`);
    hasOnlyKeys(item, ['month', 'budgets'], path, errors);
    requireString(item, 'month', path, errors);
    if (typeof item.month === 'string') {
      const match = monthKeyPattern.exec(item.month);
      if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) errors.push(`${path}.month 必須是有效的 YYYY-MM`);
    }
    validateBudgetRecord(item.budgets, `${path}.budgets`, errors);
    if (typeof item.month === 'string') {
      if (months.has(item.month)) errors.push(`${path}.month 重複`);
      months.add(item.month);
    }
  });
  return true;
}

function validateMerchants(value: unknown, errors: string[]): value is Merchant[] {
  if (!Array.isArray(value)) {
    errors.push('merchants 必須是陣列');
    return false;
  }
  const ids = new Set<string>();
  value.forEach((item, index) => {
    const path = `merchants[${index}]`;
    if (!isRecord(item)) return errors.push(`${path} 必須是物件`);
    hasOnlyKeys(item, ['id', 'name', 'aliases', 'createdAt'], path, errors);
    validateId(item, path, errors);
    requireString(item, 'name', path, errors);
    requireIsoDate(item, 'createdAt', path, errors);
    if (!Array.isArray(item.aliases) || item.aliases.some(alias => typeof alias !== 'string')) {
      errors.push(`${path}.aliases 必須是文字陣列`);
    }
    if (typeof item.id === 'string') {
      if (ids.has(item.id)) errors.push(`${path}.id 重複`);
      ids.add(item.id);
    }
  });
  return true;
}

function validatePaymentInstruments(value: unknown, errors: string[]): value is PaymentInstrument[] {
  if (!Array.isArray(value)) {
    errors.push('paymentInstruments 必須是陣列');
    return false;
  }
  const ids = new Set<string>();
  value.forEach((item, index) => {
    const path = `paymentInstruments[${index}]`;
    if (!isRecord(item)) return errors.push(`${path} 必須是物件`);
    hasOnlyKeys(item, ['id', 'name', 'type', 'provider', 'last4', 'accountId', 'active', 'createdAt'], path, errors);
    validateId(item, path, errors);
    requireString(item, 'name', path, errors);
    if (!PAYMENT_INSTRUMENT_TYPES.includes(item.type as PaymentInstrumentType)) {
      errors.push(`${path}.type 無效`);
    }
    optionalString(item, 'provider', path, errors);
    optionalString(item, 'last4', path, errors);
    if (typeof item.last4 === 'string' && !/^\d{4}$/.test(item.last4)) {
      errors.push(`${path}.last4 只能是 4 位數字`);
    }
    optionalString(item, 'accountId', path, errors);
    if (typeof item.active !== 'boolean') errors.push(`${path}.active 必須是 true 或 false`);
    requireIsoDate(item, 'createdAt', path, errors);
    if (typeof item.id === 'string') {
      if (ids.has(item.id)) errors.push(`${path}.id 重複`);
      ids.add(item.id);
    }
  });
  return true;
}

export function validateFinanceBackup(value: unknown): BackupValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return {ok: false, errors: ['備份檔案頂層必須是物件']};

  const sourceVersion = value.version === 4 ? 4 : value.version === 5 ? 5 : value.version === 6 ? 6 : null;
  hasOnlyKeys(value, [
    'version', 'exportedAt', 'userEmail', 'transactions', 'goals', 'subscriptions', 'budgets', 'budgetMonths',
    'receipts', 'accounts', 'transfers',
    ...(sourceVersion === 6 ? ['merchants', 'paymentInstruments'] : []),
  ], 'backup', errors);
  if (sourceVersion === null) errors.push('只支援 version 4、5 或 6 備份');
  const validationVersion = sourceVersion || FINANCE_BACKUP_VERSION;
  requireIsoDate(value, 'exportedAt', 'backup', errors);
  requireString(value, 'userEmail', 'backup', errors, true);
  validateTransactions(value.transactions, errors, validationVersion);
  validateGoals(value.goals, errors);
  validateSubscriptions(value.subscriptions, errors);
  validateBudgetRecord(value.budgets, 'budgets', errors);
  validateBudgetMonths(value.budgetMonths, errors);
  validateReceipts(value.receipts, errors, validationVersion);
  validateAccounts(value.accounts, errors);
  validateTransfers(value.transfers, errors);
  const merchants = sourceVersion === 6 ? value.merchants : [];
  const paymentInstruments = sourceVersion === 6 ? value.paymentInstruments : [];
  if (sourceVersion === 6 || merchants !== undefined) validateMerchants(merchants, errors);
  if (sourceVersion === 6 || paymentInstruments !== undefined) validatePaymentInstruments(paymentInstruments, errors);

  if (errors.length) return {ok: false, errors};
  return {
    ok: true,
    backup: {
      ...value,
      version: FINANCE_BACKUP_VERSION,
      merchants: Array.isArray(merchants) ? merchants : [],
      paymentInstruments: Array.isArray(paymentInstruments) ? paymentInstruments : [],
    } as FinanceBackup,
  };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function keyedDiff<T>(current: T[], backup: T[], getKey: (item: T) => string) {
  const currentMap = new Map(current.map(item => [getKey(item), item]));
  const backupMap = new Map(backup.map(item => [getKey(item), item]));
  let added = 0;
  let updated = 0;
  let removed = 0;
  for (const [key, item] of backupMap) {
    if (!currentMap.has(key)) added += 1;
    else if (stableStringify(currentMap.get(key)) !== stableStringify(item)) updated += 1;
  }
  for (const key of currentMap.keys()) if (!backupMap.has(key)) removed += 1;
  return {currentCount: currentMap.size, backupCount: backupMap.size, added, updated, removed};
}

export function diffFinanceBackups(current: FinanceBackup, backup: FinanceBackup): BackupDiffRow[] {
  const rows: BackupDiffRow[] = [
    {key: 'transactions', label: '交易', ...keyedDiff(current.transactions, backup.transactions, item => item.id)},
    {key: 'goals', label: '目標', ...keyedDiff(current.goals, backup.goals, item => item.id)},
    {key: 'subscriptions', label: '訂閱', ...keyedDiff(current.subscriptions, backup.subscriptions, item => item.id)},
    {key: 'budgets', label: '目前預算', ...keyedDiff(Object.entries(current.budgets), Object.entries(backup.budgets), item => item[0])},
    {key: 'budgetMonths', label: '每月預算', ...keyedDiff(current.budgetMonths, backup.budgetMonths, item => item.month)},
    {key: 'receipts', label: '收據', ...keyedDiff(current.receipts, backup.receipts, item => item.id)},
    {key: 'accounts', label: '帳戶', ...keyedDiff(current.accounts, backup.accounts, item => item.id)},
    {key: 'transfers', label: '轉帳', ...keyedDiff(current.transfers, backup.transfers, item => item.id)},
    {key: 'merchants', label: '商戶', ...keyedDiff(current.merchants, backup.merchants, item => item.id)},
    {key: 'paymentInstruments', label: '付款工具', ...keyedDiff(current.paymentInstruments, backup.paymentInstruments, item => item.id)},
  ];
  return rows;
}

export function countFinanceBackupItems(backup: FinanceBackup): number {
  return backup.transactions.length + backup.goals.length + backup.subscriptions.length +
    Object.keys(backup.budgets).length + backup.budgetMonths.length + backup.receipts.length +
    backup.accounts.length + backup.transfers.length +
    backup.merchants.length + backup.paymentInstruments.length;
}

export function financeBackupDataFingerprint(backup: FinanceBackup): string {
  return stableStringify({
    transactions: [...backup.transactions].sort((a, b) => a.id.localeCompare(b.id)),
    goals: [...backup.goals].sort((a, b) => a.id.localeCompare(b.id)),
    subscriptions: [...backup.subscriptions].sort((a, b) => a.id.localeCompare(b.id)),
    budgets: backup.budgets,
    budgetMonths: [...backup.budgetMonths].sort((a, b) => a.month.localeCompare(b.month)),
    receipts: [...backup.receipts].sort((a, b) => a.id.localeCompare(b.id)),
    accounts: [...backup.accounts].sort((a, b) => a.id.localeCompare(b.id)),
    transfers: [...backup.transfers].sort((a, b) => a.id.localeCompare(b.id)),
    merchants: [...backup.merchants].sort((a, b) => a.id.localeCompare(b.id)),
    paymentInstruments: [...backup.paymentInstruments].sort((a, b) => a.id.localeCompare(b.id)),
  });
}
