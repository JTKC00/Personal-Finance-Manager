import {daysInMonthKey, listMonthRange, resolveComparisonMonths, shiftMonthKey, type ComparisonMode} from './comparisonEngine';

export type DateRange = {start: string; end: string};
export type AnalysisSelection = {
  view: 'month' | 'year' | 'custom';
  month: string;
  year: number;
  start: string;
  end: string;
  mode: ComparisonMode;
  basis: 'aligned' | 'full';
};
export type AnalysisPeriod = {
  current: DateRange;
  comparisons: DateRange[];
  comparisonLabel: string;
  trend: DateRange;
  baseline: DateRange;
  budgetMonths: string[];
  isCurrentMonth: boolean;
  partial: boolean;
  monthlyAverage: boolean;
  view: AnalysisSelection['view'];
};
const DAY = 86400000;
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function addDays(date: string, amount: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + amount * DAY).toISOString().slice(0, 10);
}
export function rangeDays(range: DateRange): number {
  return Math.round((Date.parse(range.end) - Date.parse(range.start)) / DAY) + 1;
}
export function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function monthEnd(month: string): string {
  return `${month}-${daysInMonthKey(month)}`;
}
export function monthsInRange(range: DateRange): string[] {
  const [sy, sm] = range.start.split('-').map(Number);
  const [ey, em] = range.end.split('-').map(Number);
  return listMonthRange(range.end.slice(0, 7), (ey - sy) * 12 + em - sm + 1);
}
function priorYear(date: string): string {
  const month = `${Number(date.slice(0, 4)) - 1}${date.slice(4, 7)}`;
  return `${month}-${String(Math.min(Number(date.slice(8)), daysInMonthKey(month))).padStart(2, '0')}`;
}
export function resolveAnalysisPeriod(selection: AnalysisSelection, today: string): AnalysisPeriod {
  let current: DateRange;
  let comparisons: DateRange[] = [];
  let comparisonLabel = '不比較';
  let trend: DateRange;
  const currentMonth = today.slice(0, 7);
  const isCurrentMonth = selection.view === 'month' && selection.month === currentMonth;
  if (selection.view === 'month') {
    if (!isValidDate(`${selection.month}-01`) || selection.month < '1900-01' || selection.month > currentMonth) throw new Error('請選擇本月或之前的月份。');
    current = {start: `${selection.month}-01`, end: isCurrentMonth ? today : monthEnd(selection.month)};
    comparisons = resolveComparisonMonths(selection.month, selection.mode).map(month => ({
      start: `${month}-01`,
      end: isCurrentMonth && selection.basis === 'aligned'
        ? `${month}-${String(Math.min(Number(today.slice(8)), daysInMonthKey(month))).padStart(2, '0')}`
        : monthEnd(month),
    }));
    comparisonLabel = selection.mode === 'none' ? '不比較'
      : selection.mode === 'previous_month' ? '上月' : selection.mode === 'same_month_last_year' ? '去年同月'
        : `過去 ${comparisons.length} 個月平均`;
    if (isCurrentMonth && comparisons.length) comparisonLabel += selection.basis === 'aligned' ? '（同期）' : '（整月）';
    trend = {start: `${shiftMonthKey(selection.month, -5)}-01`, end: current.end};
  } else if (selection.view === 'year') {
    if (!Number.isInteger(selection.year) || selection.year < 1900 || selection.year > Number(today.slice(0, 4))) throw new Error('請選擇有效年份。');
    current = {start: `${selection.year}-01-01`, end: selection.year === Number(today.slice(0, 4)) ? today : `${selection.year}-12-31`};
    if (selection.mode !== 'none') {
      comparisons = [{start: priorYear(current.start), end: priorYear(current.end)}];
      comparisonLabel = '去年同期';
    }
    trend = current;
  } else {
    current = {start: selection.start, end: selection.end};
    if (!isValidDate(current.start) || !isValidDate(current.end) || current.start > current.end || current.end > today || current.start < '1900-01-01') throw new Error('請選擇有效起訖日期，截止日不得超過今天。');
    if (selection.mode !== 'none') {
      comparisons = [{start: addDays(current.start, -rangeDays(current)), end: addDays(current.start, -1)}];
      comparisonLabel = '前一等長期間';
    }
    trend = current;
  }
  return {
    current, comparisons, comparisonLabel, trend, view: selection.view,
    baseline: {start: addDays(current.start, -90), end: addDays(current.start, -1)},
    budgetMonths: selection.view === 'custom' ? [] : monthsInRange(current),
    isCurrentMonth,
    partial: current.end === today && (selection.view === 'month' ? today !== monthEnd(currentMonth) : selection.view === 'year' && today.slice(5) !== '12-31'),
    monthlyAverage: selection.view === 'month' && selection.mode.startsWith('avg_'),
  };
}
export function inRange(date: string, range: DateRange): boolean {
  return date >= range.start && date <= range.end;
}
