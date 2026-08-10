import assert from 'node:assert/strict';
import test from 'node:test';
import {evaluateAppCheckToken} from './appCheckPolicy.js';

test('observe mode records missing tokens without blocking', async () => {
  const result = await evaluateAppCheckToken(undefined, false, async () => undefined);
  assert.deepEqual(result, {status: 'missing', allowed: true});
});

test('observe mode records invalid tokens without blocking', async () => {
  const result = await evaluateAppCheckToken('bad-token', false, async () => {
    throw new Error('invalid token');
  });
  assert.deepEqual(result, {status: 'invalid', allowed: true, reason: 'invalid token'});
});

test('enforce mode rejects missing and invalid tokens', async () => {
  const missing = await evaluateAppCheckToken(undefined, true, async () => undefined);
  const invalid = await evaluateAppCheckToken('bad-token', true, async () => {
    throw new Error('invalid token');
  });
  assert.equal(missing.allowed, false);
  assert.equal(invalid.allowed, false);
});

test('valid tokens pass in both modes', async () => {
  for (const enforce of [false, true]) {
    const result = await evaluateAppCheckToken('valid-token', enforce, async () => undefined);
    assert.deepEqual(result, {status: 'valid', allowed: true});
  }
});
