import {describe, expect, it} from 'vitest';
import type {OcrResult, OcrReviewValues, Transaction} from '../types/finance';
import {
  buildOcrChangedFields,
  findReceiptDuplicates,
  getHighConfidencePaymentMethod,
  getReviewRequiredFields,
  normalizeLegacyOcrResult,
  normalizeMerchant,
} from './ocrLogic';

const extraction: OcrResult = {
  amount: 88,
  merchant: '茶記有限公司',
  category: '餐飲',
  note: '晚餐',
  date: '2026-08-10',
  paymentMethodCandidates: [{method: '電子錢包', evidence: 'octopus', modelConfidence: 'high'}],
  modelConfidence: {amount: 'high', merchant: 'high', date: 'high', category: 'medium', paymentMethod: 'high'},
};

const transaction = (patch: Partial<Transaction> = {}): Transaction => ({
  id: 'txn-1', type: 'expense', amount: 88, currency: 'HKD', date: '2026-08-10',
  category: '餐飲', merchant: '茶記 Ltd.', createdAt: '2026-08-10T12:00:00.000Z', ...patch,
});

describe('OCR review logic', () => {
  it('normalizes merchant names without confusing the original audit value', () => {
    expect(normalizeMerchant(' 茶記有限公司 ')).toBe(normalizeMerchant('茶記 Ltd.'));
  });

  it('detects deterministic high and possible duplicate candidates', () => {
    const matches = findReceiptDuplicates(
      {amount: 88, date: '2026-08-10', merchant: '茶記有限公司'},
      [transaction(), transaction({id: 'next-day', date: '2026-08-11'}), transaction({id: 'other', amount: 89})],
    );
    expect(matches).toEqual([
      expect.objectContaining({transactionId: 'txn-1', risk: 'high'}),
      expect.objectContaining({transactionId: 'next-day', risk: 'possible'}),
    ]);
  });

  it('does not warn when only the amount matches outside the date window', () => {
    expect(findReceiptDuplicates(
      {amount: 88, date: '2026-08-10', merchant: '茶記'},
      [transaction({date: '2026-08-12'})],
    )).toEqual([]);
  });

  it('selects only high-confidence payment suggestions and identifies review fields', () => {
    expect(getHighConfidencePaymentMethod(extraction)).toBe('電子錢包');
    expect(getReviewRequiredFields(extraction)).toEqual(['category']);
    expect(getHighConfidencePaymentMethod({
      ...extraction,
      paymentMethodCandidates: [{method: '現金', evidence: 'cash', modelConfidence: 'medium'}],
    })).toBe('');
  });

  it('records only fields changed during first confirmation', () => {
    const final: OcrReviewValues = {
      amount: 90, merchant: '茶記有限公司', category: '餐飲', note: '晚餐',
      date: '2026-08-10', paymentMethod: '電子錢包',
    };
    expect(buildOcrChangedFields(extraction, final)).toEqual(['amount']);
  });

  it('normalizes legacy four-field results as low-confidence compatible data', () => {
    const result = normalizeLegacyOcrResult({amount: 20, category: '餐飲', note: '舊收據', date: '2026-08-01'});
    expect(result).toMatchObject({amount: 20, merchant: null, paymentMethodCandidates: []});
    expect(result.modelConfidence.amount).toBe('low');
  });
});

