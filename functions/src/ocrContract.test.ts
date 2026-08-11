import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OcrSchemaError,
  createOcrV2Payload,
  parseGeminiOcrResponse,
  validateOcrExtraction,
} from './ocrContract.js';

const validResult = {
  amount: 48.5,
  merchant: '茶餐廳',
  category: '餐飲',
  note: '午餐',
  date: '2026-08-10',
  paymentMethodCandidates: [{method: '電子錢包', evidence: 'octopus', modelConfidence: 'high'}],
  modelConfidence: {
    amount: 'high', merchant: 'high', date: 'medium', category: 'high', paymentMethod: 'high',
  },
};

test('validates and parses the current OCR contract while retaining raw JSON', () => {
  const rawJson = JSON.stringify(validResult);
  const parsed = parseGeminiOcrResponse({
    candidates: [{content: {parts: [{text: rawJson}]}}],
  });
  assert.equal(parsed.rawJson, rawJson);
  assert.deepEqual(parsed.result, validResult);
});

test('allows unknown amount, merchant and date without inventing fallback values', () => {
  const result = validateOcrExtraction({...validResult, amount: null, merchant: null, date: null});
  assert.equal(result.ok, true);
});

test('allows explicit generic card evidence without inventing a card network', () => {
  const result = validateOcrExtraction({
    ...validResult,
    paymentMethodCandidates: [{method: '信用卡', evidence: 'card', modelConfidence: 'high'}],
  });
  assert.equal(result.ok, true);
});

test('rejects invalid dates, extra fields and mismatched payment evidence', () => {
  const result = validateOcrExtraction({
    ...validResult,
    date: '2026-02-31',
    unexpected: true,
    paymentMethodCandidates: [{method: '現金', evidence: 'visa', modelConfidence: 'high'}],
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some(error => error.includes('date')));
    assert.ok(result.errors.some(error => error.includes('未支援')));
    assert.ok(result.errors.some(error => error.includes('不一致')));
  }
});

test('rejects non-JSON model output with a classified schema error', () => {
  assert.throws(
    () => parseGeminiOcrResponse({candidates: [{content: {parts: [{text: 'not json'}]}}]}),
    OcrSchemaError,
  );
});

test('builds a schema-constrained payload without a today fallback or card data fields', () => {
  const payload = createOcrV2Payload('base64-data', 'image/jpeg');
  const serialized = JSON.stringify(payload);
  assert.match(serialized, /responseFormat/);
  assert.match(serialized, /paymentMethodCandidates/);
  assert.doesNotMatch(serialized, /若看不出則用今天/);
  const responseFormat = payload.generationConfig.responseFormat as {
    text: {mimeType: string; schema: {properties: Record<string, unknown>}};
  };
  assert.equal(responseFormat.text.mimeType, 'APPLICATION_JSON');
  const schema = responseFormat.text.schema;
  assert.equal('cardNumber' in schema.properties, false);
});
