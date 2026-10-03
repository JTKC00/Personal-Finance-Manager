import {describe, expect, it} from 'vitest';
import {addDays, rangeDays, resolveAnalysisPeriod, type AnalysisSelection} from './analysisPeriod';
const base: AnalysisSelection = {view: 'month', month: '2026-09', year: 2026, start: '2026-09-01', end: '2026-09-12', mode: 'previous_month', basis: 'aligned'};

describe('analysis periods', () => {
  it('aligns month-to-date and keeps full-month comparison explicit', () => {
    const aligned = resolveAnalysisPeriod(base, '2026-09-12');
    expect(aligned.current).toEqual({start: '2026-09-01', end: '2026-09-12'});
    expect(aligned.comparisons).toEqual([{start: '2026-08-01', end: '2026-08-12'}]);
    expect(resolveAnalysisPeriod({...base, basis: 'full'}, '2026-09-12').comparisons[0].end).toBe('2026-08-31');
    expect(aligned.trend.start).toBe('2026-04-01');
  });
  it('clamps short comparison months and treats historical months as complete', () => {
    const p = resolveAnalysisPeriod({...base, month: '2024-03'}, '2024-03-31');
    expect(p.comparisons[0].end).toBe('2024-02-29');
    expect(rangeDays(p.comparisons[0])).toBe(29);
    expect(resolveAnalysisPeriod({...base, month: '2026-08'}, '2026-09-12').comparisons[0].end).toBe('2026-07-31');
  });
  it('supports all rolling averages, YoY, and no comparison', () => {
    for (const [mode, count] of [['avg_3m', 3], ['avg_6m', 6], ['avg_12m', 12]] as const) {
      const p = resolveAnalysisPeriod({...base, mode}, '2026-09-12');
      expect(p.comparisons).toHaveLength(count);
      expect(p.comparisons.every(r => r.end.endsWith('-12'))).toBe(true);
    }
    expect(resolveAnalysisPeriod({...base, mode: 'same_month_last_year'}, '2026-09-12').comparisons[0].start).toBe('2025-09-01');
    expect(resolveAnalysisPeriod({...base, mode: 'none'}, '2026-09-12').comparisons).toEqual([]);
  });
  it('compares YTD, leap-day and completed years using calendar boundaries', () => {
    const p = resolveAnalysisPeriod({...base, view: 'year', year: 2024}, '2024-02-29');
    expect(p.comparisons[0]).toEqual({start: '2023-01-01', end: '2023-02-28'});
    expect(p.budgetMonths).toEqual(['2024-01', '2024-02']);
    expect(resolveAnalysisPeriod({...base, view: 'year', year: 2025}, '2026-09-12').current.end).toBe('2025-12-31');
  });
  it('uses inclusive equal-length custom windows across years and DST', () => {
    const p = resolveAnalysisPeriod({...base, view: 'custom', start: '2026-01-01', end: '2026-01-03'}, '2026-09-12');
    expect(p.comparisons[0]).toEqual({start: '2025-12-29', end: '2025-12-31'});
    expect(p.budgetMonths).toEqual([]);
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(rangeDays({start: '2026-03-07', end: '2026-03-09'})).toBe(3);
  });
  it('rejects invalid, reversed and future ranges', () => {
    for (const patch of [{start: '2026-02-30'}, {start: '2026-09-13'}, {end: '2027-01-01'}, {start: ''}]) {
      expect(() => resolveAnalysisPeriod({...base, view: 'custom', ...patch}, '2026-09-12')).toThrow();
    }
    expect(() => resolveAnalysisPeriod({...base, year: 2027, view: 'year'}, '2026-09-12')).toThrow();
  });
});
