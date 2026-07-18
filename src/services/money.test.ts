import {describe, expect, it} from 'vitest';
import {roundMoney, sumMoney} from './money';

describe('roundMoney', () => {
  it('rounds to two decimal places', () => {
    expect(roundMoney(1.234)).toBe(1.23);
    expect(roundMoney(1.236)).toBe(1.24);
    expect(roundMoney(10)).toBe(10);
  });

  it('clears binary floating-point noise', () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
  });

  it('returns 0 for non-finite input', () => {
    expect(roundMoney(Number.NaN)).toBe(0);
    expect(roundMoney(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('sumMoney', () => {
  it('sums without floating-point drift', () => {
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(sumMoney([0.1, 0.2, 0.3])).toBe(0.6);
  });

  it('sums a realistic list of amounts', () => {
    expect(sumMoney([19.99, 5.01, 100])).toBe(125);
  });

  it('returns 0 for an empty list', () => {
    expect(sumMoney([])).toBe(0);
  });

  it('skips non-finite entries', () => {
    expect(sumMoney([10, Number.NaN, 5])).toBe(15);
  });

  it('handles negative amounts', () => {
    expect(sumMoney([100, -30.5, -0.5])).toBe(69);
  });
});
