import {describe, expect, it, vi} from 'vitest';
import {analysisQueryRanges, createAnalysisLoader, type AnalysisSource} from './analysisLoader';
import {resolveAnalysisPeriod, type AnalysisSelection} from './analysisPeriod';
const selection: AnalysisSelection = {view: 'month', month: '2026-09', year: 2026, start: '2026-09-01', end: '2026-09-12', mode: 'previous_month', basis: 'aligned'};
const period = resolveAnalysisPeriod(selection, '2026-09-12');
function source(): AnalysisSource {
  return {transactions: vi.fn(async () => []), earliest: vi.fn(async () => null), budgets: vi.fn(async () => []), merchants: vi.fn(async () => []), instruments: vi.fn(async () => []), accounts: vi.fn(async () => []), subscriptions: vi.fn(async () => [])};
}
describe('analysis loading boundaries', () => {
  it('merges overlapping ranges without filling a distant YoY gap', () => {
    const ranges = analysisQueryRanges(resolveAnalysisPeriod({...selection, mode: 'same_month_last_year'}, '2026-09-12'));
    expect(ranges).toEqual([{start: '2025-09-01', end: '2025-09-12'}, {start: '2026-04-01', end: '2026-09-30'}]);
  });
  it('reuses successful requests per user and clears on user switch/retry', async () => {
    const src = source(); const loader = createAnalysisLoader(src);
    await loader.load('user-a', period); await loader.load('user-a', period);
    expect(src.transactions).toHaveBeenCalledTimes(1);
    await loader.load('user-b', period);
    expect(src.transactions).toHaveBeenCalledTimes(2);
    loader.clear(); await loader.load('user-b', period);
    expect(src.transactions).toHaveBeenCalledTimes(3);
  });
  it('rejects main transaction failures instead of returning zero totals and permits retry', async () => {
    const src = source(); vi.mocked(src.transactions).mockRejectedValueOnce(new Error('offline'));
    const loader = createAnalysisLoader(src);
    await expect(loader.load('user-a', period)).rejects.toThrow('offline');
    expect((await loader.load('user-a', period)).transactions).toEqual([]);
  });
  it('does not mistake an earliest-date failure for no history', async () => {
    const src = source(); vi.mocked(src.earliest).mockRejectedValueOnce(new Error('permission-denied'));
    await expect(createAnalysisLoader(src).load('a', period)).rejects.toThrow('permission-denied');
  });
  it('isolates auxiliary failures without inventing empty budgets', async () => {
    const src = source(); vi.mocked(src.budgets).mockRejectedValueOnce(new Error('offline')); vi.mocked(src.merchants).mockRejectedValueOnce(new Error('offline'));
    const loader = createAnalysisLoader(src); const result = await loader.load('a', period);
    expect(result.errors).toEqual(['商戶名稱', '2026-09 預算']);
    expect(result.budgets).toEqual({});
    expect(result.directories.accounts).toEqual([]);
    expect((await loader.load('a', period)).errors).toEqual([]);
  });
  it('never caches late responses belonging to a cleared session', async () => {
    const src = source(); let finish!: (value: string | null) => void;
    vi.mocked(src.earliest).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const loader = createAnalysisLoader(src); const old = loader.load('old-user', period);
    await loader.load('new-user', period); finish('2020-01-01'); await old;
    expect((await loader.load('new-user', period)).earliest).toBeNull();
  });
});
