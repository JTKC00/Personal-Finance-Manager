import type {
  OcrPaymentEvidence,
  OcrResult,
  OcrReviewValues,
  ReceiptDuplicateCandidate,
  Transaction,
} from '../types/finance';

export const paymentEvidenceLabels: Record<OcrPaymentEvidence, string> = {
  card: '一般信用卡字樣',
  visa: 'Visa',
  mastercard: 'Mastercard',
  unionpay: '銀聯',
  cash: '現金字樣',
  octopus: '八達通',
  fps: '轉數快 FPS',
  payme: 'PayMe',
  alipayhk: 'AlipayHK',
  wechat_pay_hk: 'WeChat Pay HK',
  apple_pay: 'Apple Pay',
  google_pay: 'Google Pay',
  other_wallet: '其他電子錢包',
};

export const confidenceLabels = {high: '高', medium: '中', low: '低'} as const;

export function normalizeMerchant(value: string | null | undefined): string {
  return (value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-HK')
    .replace(/有限公司|limited|\bltd\.?\b/g, '')
    .replace(/[\p{P}\p{S}\s]/gu, '');
}

function dayNumber(dateKey: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return Math.floor(date.getTime() / 86_400_000);
}

export function findReceiptDuplicates(
  values: Pick<OcrReviewValues, 'amount' | 'date' | 'merchant'>,
  transactions: Transaction[],
): ReceiptDuplicateCandidate[] {
  if (!(values.amount > 0) || !values.date) return [];
  const targetDay = dayNumber(values.date);
  if (targetDay === null) return [];
  const targetMerchant = normalizeMerchant(values.merchant);

  const matches: ReceiptDuplicateCandidate[] = [];
  transactions.forEach(transaction => {
    if (transaction.type !== 'expense' || Math.round(transaction.amount * 100) !== Math.round(values.amount * 100)) return;
    const transactionDay = dayNumber(transaction.date);
    if (transactionDay === null) return;
    const dayDifference = Math.abs(targetDay - transactionDay);
    if (dayDifference > 1) return;
    const transactionMerchant = normalizeMerchant(transaction.merchant || transaction.note);
    const merchantMatches = Boolean(targetMerchant && transactionMerchant && targetMerchant === transactionMerchant);

    if (dayDifference === 0 && merchantMatches) {
      matches.push({transactionId: transaction.id, risk: 'high', reasons: ['同日', '同金額', '商戶相同']});
    } else if (dayDifference === 0 && (!targetMerchant || !transactionMerchant)) {
      matches.push({transactionId: transaction.id, risk: 'possible', reasons: ['同日', '同金額', '商戶資料不足']});
    } else if (dayDifference === 1 && merchantMatches) {
      matches.push({transactionId: transaction.id, risk: 'possible', reasons: ['日期相差一天', '同金額', '商戶相同']});
    }
  });
  return matches.sort((a, b) => (a.risk === b.risk ? 0 : a.risk === 'high' ? -1 : 1));
}

export function getHighConfidencePaymentMethod(result: OcrResult): string {
  return result.paymentMethodCandidates.find(candidate => candidate.modelConfidence === 'high')?.method || '';
}

export function getReviewRequiredFields(result: OcrResult): string[] {
  const fields: string[] = [];
  if (result.amount === null || result.modelConfidence.amount !== 'high') fields.push('amount');
  if (result.merchant === null || result.modelConfidence.merchant !== 'high') fields.push('merchant');
  if (result.date === null || result.modelConfidence.date !== 'high') fields.push('date');
  if (result.modelConfidence.category !== 'high') fields.push('category');
  if (!getHighConfidencePaymentMethod(result) || result.modelConfidence.paymentMethod !== 'high') fields.push('paymentMethod');
  return fields;
}

export function buildOcrChangedFields(result: OcrResult, final: OcrReviewValues): Array<keyof OcrReviewValues> {
  const original: OcrReviewValues = {
    amount: result.amount ?? 0,
    merchant: result.merchant || '',
    category: result.category,
    note: result.note,
    date: result.date || '',
    paymentMethod: getHighConfidencePaymentMethod(result),
  };
  return (Object.keys(original) as Array<keyof OcrReviewValues>).filter(key => original[key] !== final[key]);
}

export function normalizeLegacyOcrResult(value: unknown): OcrResult {
  const raw = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  const amount = typeof raw.amount === 'number' && Number.isFinite(raw.amount) && raw.amount > 0 ? raw.amount : null;
  const merchant = typeof raw.merchant === 'string' && raw.merchant.trim() ? raw.merchant.trim() : null;
  const category = typeof raw.category === 'string' ? raw.category : '其他';
  const note = typeof raw.note === 'string' ? raw.note : '';
  const date = typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : null;
  const candidates = Array.isArray(raw.paymentMethodCandidates) ? raw.paymentMethodCandidates : [];
  const confidence = typeof raw.modelConfidence === 'object' && raw.modelConfidence !== null
    ? raw.modelConfidence as Record<string, unknown>
    : {};
  const level = (field: string) => ['high', 'medium', 'low'].includes(String(confidence[field]))
    ? confidence[field] as 'high' | 'medium' | 'low'
    : 'low';

  return {
    amount,
    merchant,
    category,
    note,
    date,
    paymentMethodCandidates: candidates as OcrResult['paymentMethodCandidates'],
    modelConfidence: {
      amount: level('amount'),
      merchant: level('merchant'),
      date: level('date'),
      category: level('category'),
      paymentMethod: level('paymentMethod'),
    },
  };
}
