import {describe, expect, it} from 'vitest';
import {formatChartMoney, formatMoney} from './chartFormatters';

describe('chart money formatters', () => {
  it('formats valid numeric values using the app currency display', () => {
    expect(formatMoney(1234.5)).toBe('$1,234.50');
    expect(formatChartMoney(1234.5)).toBe('$1,234.50');
    expect(formatChartMoney('1234.5')).toBe('$1,234.50');
    expect(formatChartMoney(0)).toBe('$0.00');
  });

  it('returns a safe placeholder for missing or non-numeric tooltip values', () => {
    expect(formatChartMoney(undefined)).toBe('—');
    expect(formatChartMoney(Number.NaN)).toBe('—');
    expect(formatChartMoney(Number.POSITIVE_INFINITY)).toBe('—');
    expect(formatChartMoney('not-a-number')).toBe('—');
    expect(formatChartMoney([1234.5, '678.9'])).toBe('$1,234.50 ~ $678.90');
    expect(formatChartMoney([])).toBe('—');
  });
});
