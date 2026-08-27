import type {TooltipValueType} from 'recharts';

export function formatMoney(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `$${value.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
}

function formatChartScalar(value: number | string): string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? formatMoney(value) : null;

  const normalized = value.trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? formatMoney(parsed) : null;
}

export function formatChartMoney(value: TooltipValueType | undefined): string {
  if (value === undefined) return '—';
  if (typeof value === 'number' || typeof value === 'string') return formatChartScalar(value) ?? '—';

  const formattedValues = value
    .map(formatChartScalar)
    .filter((item): item is string => item !== null);
  return formattedValues.length ? formattedValues.join(' ~ ') : '—';
}
