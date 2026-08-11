export const OCR_SCHEMA_VERSION = 3;
export const OCR_PROMPT_VERSION = 'hk-receipt-v2.1';

export const EXPENSE_CATEGORIES = [
  '餐飲', '交通', '購物', '娛樂', '醫療', '居住', '金融支出',
  '學習', '禮物', '旅遊', '保險', '家庭', '其他',
] as const;

export const PAYMENT_METHODS = ['信用卡', '現金', '電子錢包'] as const;
export const PAYMENT_EVIDENCE = [
  'card', 'visa', 'mastercard', 'unionpay', 'cash', 'octopus', 'fps', 'payme',
  'alipayhk', 'wechat_pay_hk', 'apple_pay', 'google_pay', 'other_wallet',
] as const;
export const OCR_CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;

export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number];
export type OcrConfidence = typeof OCR_CONFIDENCE_LEVELS[number];
export type PaymentMethod = typeof PAYMENT_METHODS[number];
export type PaymentEvidence = typeof PAYMENT_EVIDENCE[number];

export type PaymentMethodCandidate = {
  method: PaymentMethod;
  evidence: PaymentEvidence;
  modelConfidence: OcrConfidence;
};

export type OcrExtraction = {
  amount: number | null;
  merchant: string | null;
  category: ExpenseCategory;
  note: string;
  date: string | null;
  paymentMethodCandidates: PaymentMethodCandidate[];
  modelConfidence: {
    amount: OcrConfidence;
    merchant: OcrConfidence;
    date: OcrConfidence;
    category: OcrConfidence;
    paymentMethod: OcrConfidence;
  };
};

export type GeminiPayload = {
  contents: Array<{
    parts: Array<
      {inlineData: {mimeType: string; data: string}} |
      {text: string}
    >;
  }>;
  generationConfig: Record<string, unknown>;
};

const confidenceSchema = {type: 'string', enum: OCR_CONFIDENCE_LEVELS};

export const OCR_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    amount: {
      type: ['number', 'null'],
      minimum: 0.01,
      description: '收據最終應付總額；無法確定時必須為 null，不可猜測。',
    },
    merchant: {
      type: ['string', 'null'],
      description: '收據上顯示的商戶名稱；無法確定時為 null。',
    },
    category: {
      type: 'string',
      enum: EXPENSE_CATEGORIES,
      description: '按收據內容分類的支出類別。',
    },
    note: {
      type: 'string',
      description: '不重複商戶名稱的簡短交易描述；沒有補充資料時用空字串。',
    },
    date: {
      type: ['string', 'null'],
      format: 'date',
      description: '收據交易日期 YYYY-MM-DD；無法確定時必須為 null，不可使用今天代替。',
    },
    paymentMethodCandidates: {
      type: 'array',
      maxItems: 3,
      description: '只在收據有明確付款證據時提供候選；沒有證據時回傳空陣列。',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          method: {type: 'string', enum: PAYMENT_METHODS},
          evidence: {type: 'string', enum: PAYMENT_EVIDENCE},
          modelConfidence: confidenceSchema,
        },
        required: ['method', 'evidence', 'modelConfidence'],
      },
    },
    modelConfidence: {
      type: 'object',
      additionalProperties: false,
      properties: {
        amount: confidenceSchema,
        merchant: confidenceSchema,
        date: confidenceSchema,
        category: confidenceSchema,
        paymentMethod: confidenceSchema,
      },
      required: ['amount', 'merchant', 'date', 'category', 'paymentMethod'],
    },
  },
  required: [
    'amount', 'merchant', 'category', 'note', 'date',
    'paymentMethodCandidates', 'modelConfidence',
  ],
} as const;

const evidenceMethod: Record<PaymentEvidence, PaymentMethod> = {
  card: '信用卡',
  visa: '信用卡',
  mastercard: '信用卡',
  unionpay: '信用卡',
  cash: '現金',
  octopus: '電子錢包',
  fps: '電子錢包',
  payme: '電子錢包',
  alipayhk: '電子錢包',
  wechat_pay_hk: '電子錢包',
  apple_pay: '電子錢包',
  google_pay: '電子錢包',
  other_wallet: '電子錢包',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDateKey(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every(key => allowed.has(key));
}

function isConfidence(value: unknown): value is OcrConfidence {
  return OCR_CONFIDENCE_LEVELS.includes(value as OcrConfidence);
}

export function validateOcrExtraction(value: unknown): {ok: true; value: OcrExtraction} | {ok: false; errors: string[]} {
  const errors: string[] = [];
  if (!isRecord(value)) return {ok: false, errors: ['result 必須是物件']};

  const rootKeys = ['amount', 'merchant', 'category', 'note', 'date', 'paymentMethodCandidates', 'modelConfidence'];
  if (!hasOnlyKeys(value, rootKeys)) errors.push('result 包含未支援欄位');
  if (value.amount !== null && (typeof value.amount !== 'number' || !Number.isFinite(value.amount) || value.amount <= 0)) {
    errors.push('amount 必須是正數或 null');
  }
  if (value.merchant !== null && (typeof value.merchant !== 'string' || !value.merchant.trim() || value.merchant.length > 120)) {
    errors.push('merchant 必須是 1 至 120 字的文字或 null');
  }
  if (!EXPENSE_CATEGORIES.includes(value.category as ExpenseCategory)) errors.push('category 無效');
  if (typeof value.note !== 'string' || value.note.length > 240) errors.push('note 必須是最多 240 字的文字');
  if (value.date !== null && (typeof value.date !== 'string' || !isDateKey(value.date))) errors.push('date 必須是有效 YYYY-MM-DD 或 null');

  if (!Array.isArray(value.paymentMethodCandidates) || value.paymentMethodCandidates.length > 3) {
    errors.push('paymentMethodCandidates 必須是最多三項的陣列');
  } else {
    const methods = new Set<string>();
    value.paymentMethodCandidates.forEach((candidate, index) => {
      if (!isRecord(candidate)) {
        errors.push(`paymentMethodCandidates[${index}] 必須是物件`);
        return;
      }
      if (!hasOnlyKeys(candidate, ['method', 'evidence', 'modelConfidence'])) {
        errors.push(`paymentMethodCandidates[${index}] 包含未支援欄位`);
      }
      if (!PAYMENT_METHODS.includes(candidate.method as PaymentMethod)) errors.push(`paymentMethodCandidates[${index}].method 無效`);
      if (!PAYMENT_EVIDENCE.includes(candidate.evidence as PaymentEvidence)) errors.push(`paymentMethodCandidates[${index}].evidence 無效`);
      if (!isConfidence(candidate.modelConfidence)) errors.push(`paymentMethodCandidates[${index}].modelConfidence 無效`);
      if (typeof candidate.method === 'string') {
        if (methods.has(candidate.method)) errors.push(`paymentMethodCandidates[${index}].method 重複`);
        methods.add(candidate.method);
      }
      if (
        PAYMENT_EVIDENCE.includes(candidate.evidence as PaymentEvidence) &&
        PAYMENT_METHODS.includes(candidate.method as PaymentMethod) &&
        evidenceMethod[candidate.evidence as PaymentEvidence] !== candidate.method
      ) {
        errors.push(`paymentMethodCandidates[${index}] 證據與付款分類不一致`);
      }
    });
  }

  const modelConfidence = value.modelConfidence;
  if (!isRecord(modelConfidence)) {
    errors.push('modelConfidence 必須是物件');
  } else {
    const confidenceKeys = ['amount', 'merchant', 'date', 'category', 'paymentMethod'];
    if (!hasOnlyKeys(modelConfidence, confidenceKeys)) errors.push('modelConfidence 包含未支援欄位');
    confidenceKeys.forEach(key => {
      if (!isConfidence(modelConfidence[key])) errors.push(`modelConfidence.${key} 無效`);
    });
  }

  return errors.length ? {ok: false, errors} : {ok: true, value: value as OcrExtraction};
}

export class OcrSchemaError extends Error {
  constructor(public readonly issues: string[]) {
    super('Gemini response did not match the OCR schema');
    this.name = 'OcrSchemaError';
  }
}

export function extractGeminiText(data: Record<string, unknown>): string {
  const candidates = data.candidates as Array<{content?: {parts?: Array<{text?: string}>}}> || [];
  const text = candidates
    .flatMap(candidate => candidate.content?.parts || [])
    .map(part => part.text || '')
    .join('')
    .trim()
    .replace(/^```json\s*|\s*```$/g, '')
    .trim();
  if (!text) throw new OcrSchemaError(['Gemini response did not include text']);
  return text;
}

export function parseGeminiOcrResponse(data: Record<string, unknown>): {rawJson: string; result: OcrExtraction} {
  const rawJson = extractGeminiText(data);
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new OcrSchemaError(['Gemini response was not valid JSON']);
  }
  const validation = validateOcrExtraction(parsed);
  if (!validation.ok) throw new OcrSchemaError(validation.errors);
  return {rawJson, result: validation.value};
}

export function createOcrV2Payload(imageBase64: string, mimeType: string): GeminiPayload {
  return {
    contents: [{
      parts: [
        {inlineData: {mimeType, data: imageBase64}},
        {text: [
          '分析這張香港收據或付款憑證，僅按 schema 回傳 JSON。',
          'amount 是折扣、服務費及小費後的最終應付總額，不可使用小計、找續或信用卡批核金額。',
          '看不清 amount、merchant 或 date 時必須回傳 null，不可猜測，也不可用今天代替。',
          'note 只寫不重複商戶名稱的簡短描述。',
          '付款候選只可根據明確字樣或標誌；不得輸出卡號、交易編號、QR code 內容或自由文字證據。',
          '如只見 CARD、Cardholder Copy 或批核資料但看不到卡組織，信用卡證據使用 card；不可猜 Visa、Mastercard 或銀聯。',
          'confidence 是模型自評 high、medium 或 low，不代表經校準的實際準確率。',
        ].join('\n')},
      ],
    }],
    generationConfig: {
      responseFormat: {
        text: {
          mimeType: 'APPLICATION_JSON',
          schema: OCR_RESPONSE_JSON_SCHEMA,
        },
      },
    },
  };
}
