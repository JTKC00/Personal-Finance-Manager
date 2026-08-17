import {COMPARISON_MODE_LABELS, type CategoryContribution, type ComparisonMode, type KpiComparison} from './comparisonEngine';
import type {BudgetPace} from './budgetPace';

export type InsightTone = 'danger' | 'warning' | 'safe' | 'info';

export type AnalysisInsight = {
  id: string;
  title: string;
  detail: string;
  tone: InsightTone;
  rank: number;
};

const money = (value: number) => `$${Math.abs(value).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
const pct = (ratio: number) => `${Math.abs(ratio * 100).toFixed(1)}%`;
const points = (ratio: number) => `${Math.abs(ratio * 100).toFixed(1)} 個百分點`;

export function buildAnalysisInsights(options: {
  mode: ComparisonMode;
  hasComparisonData: boolean;
  coverageLabel?: string;
  expense: KpiComparison;
  savingsRate: KpiComparison;
  contributions: CategoryContribution[];
  budgetPaces: BudgetPace[];
  transactionCount: number;
}): AnalysisInsight[] {
  const insights: AnalysisInsight[] = [];
  const vsLabel = COMPARISON_MODE_LABELS[options.mode];

  if (options.transactionCount === 0) {
    return [{
      id: 'empty-month',
      title: '這個月還沒有交易',
      detail: '累積記錄後，這裡會顯示支出變化與主要來源。',
      tone: 'info',
      rank: 100,
    }];
  }

  if (options.mode !== 'none' && !options.hasComparisonData) {
    insights.push({
      id: 'missing-comparison',
      title: '暫無足夠歷史資料可比較',
      detail: `目前沒有足夠資料計算「${vsLabel}」。KPI 仍顯示本月數字，但不做比較，也不會把缺資料的月份當成 $0。`,
      tone: 'info',
      rank: 10,
    });
  } else if (options.coverageLabel) {
    insights.push({
      id: 'partial-coverage',
      title: '比較期覆蓋不完整',
      detail: options.coverageLabel,
      tone: 'info',
      rank: 8,
    });
  }

  const expense = options.expense;
  if (options.mode !== 'none' && expense.absoluteDelta !== null && expense.direction !== 'flat') {
    const increased = (expense.absoluteDelta || 0) > 0;
    insights.push({
      id: 'expense-change',
      title: increased ? '本月總支出上升' : '本月總支出下降',
      detail: expense.percentageDelta === null
        ? `較${vsLabel}${increased ? '增加' : '減少'} ${money(expense.absoluteDelta || 0)}。比較期支出為 0，因此不計算百分比。`
        : `較${vsLabel}${increased ? '增加' : '減少'} ${money(expense.absoluteDelta || 0)}（${increased ? '+' : '-'}${pct(expense.percentageDelta)}）。`,
      tone: increased ? 'warning' : 'safe',
      rank: Math.abs(expense.percentageDelta || 1) >= 0.1 ? 1 : 4,
    });
  }

  const topDriver = options.contributions.find(item => item.role === 'driver' && item.delta !== 0);
  if (topDriver && options.mode !== 'none' && expense.absoluteDelta) {
    const share = Math.abs(topDriver.contribution);
    insights.push({
      id: 'top-contribution',
      title: `${Math.round(share * 100)}% 的${expense.absoluteDelta > 0 ? '增幅' : '減幅'}來自${topDriver.category}`,
      detail: `${topDriver.category} ${topDriver.delta >= 0 ? '增加' : '減少'} ${money(topDriver.delta)}，是總支出變化的主要來源。`,
      tone: expense.absoluteDelta > 0 ? 'warning' : 'info',
      rank: 2,
    });
  }

  const topIncrease = options.contributions.find(item => item.delta > 0);
  if (topIncrease && options.mode !== 'none' && topIncrease.category !== topDriver?.category) {
    insights.push({
      id: 'category-increase',
      title: `${topIncrease.category} 支出較比較期增加 ${money(topIncrease.delta)}`,
      detail: topIncrease.comparisonAmount > 0
        ? `由 ${money(topIncrease.comparisonAmount)} 升至 ${money(topIncrease.currentAmount)}。`
        : `比較期沒有此分類，本月已花 ${money(topIncrease.currentAmount)}。`,
      tone: 'warning',
      rank: 5,
    });
  }

  const savings = options.savingsRate;
  if (options.mode !== 'none' && savings.absoluteDelta !== null && Math.abs(savings.absoluteDelta) >= 0.02) {
    const dropped = savings.absoluteDelta < 0;
    insights.push({
      id: 'savings-rate',
      title: dropped ? '儲蓄率下降' : '儲蓄率上升',
      detail: `儲蓄率${dropped ? '下降' : '上升'} ${points(savings.absoluteDelta)}（不是百分比增長）。`,
      tone: dropped ? 'warning' : 'safe',
      rank: Math.abs(savings.absoluteDelta) >= 0.05 ? 3 : 6,
    });
  }

  const shareJump = options.contributions
    .filter(item => Math.abs(item.shareChange) >= 0.05)
    .sort((left, right) => Math.abs(right.shareChange) - Math.abs(left.shareChange))[0];
  if (shareJump && options.mode !== 'none') {
    insights.push({
      id: 'share-jump',
      title: `${shareJump.category} 佔總支出比重${shareJump.shareChange > 0 ? '上升' : '下降'}`,
      detail: `由 ${pct(shareJump.comparisonShare)} 變為 ${pct(shareJump.currentShare)}。`,
      tone: shareJump.shareChange > 0 ? 'warning' : 'info',
      rank: 7,
    });
  }

  const hottestBudget = options.budgetPaces.find(item => item.status === 'over' || item.status === 'ahead');
  if (hottestBudget) {
    insights.push({
      id: 'budget-pace',
      title: hottestBudget.status === 'over'
        ? `${hottestBudget.category} 已超出預算`
        : `${hottestBudget.category} 支出速度偏快`,
      detail: hottestBudget.isCurrentMonth
        ? `已使用 ${hottestBudget.usedPercentage}%，月份進度 ${hottestBudget.monthProgressPercentage}%。按目前速度月底約 ${money(hottestBudget.projectedSpend)}。`
        : `實際 ${money(hottestBudget.spent)} / 預算 ${money(hottestBudget.budgetAmount)}。`,
      tone: 'danger',
      rank: hottestBudget.status === 'over' ? 1 : 3,
    });
  }

  if (!options.budgetPaces.length) {
    insights.push({
      id: 'no-budget',
      title: '這個月沒有預算資料',
      detail: '沒有設定預算時，仍可看支出比較與分類貢獻，但沒有進度與安全日額。',
      tone: 'info',
      rank: 20,
    });
  }

  if (!insights.length) {
    insights.push({
      id: 'stable',
      title: '本月暫時平穩',
      detail: '目前未看到明顯超支或分類急升，繼續保持記錄。',
      tone: 'safe',
      rank: 50,
    });
  }

  return insights
    .sort((left, right) => left.rank - right.rank)
    .slice(0, 5);
}
