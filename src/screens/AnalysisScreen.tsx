import {useEffect, useMemo, useState} from 'react';
import {
  Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts';
import {Card} from '../components/Card';
import {Screen} from '../components/Screen';
import {buildAnalysisInsights} from '../services/analysisInsights';
import {buildBudgetPaces} from '../services/budgetPace';
import {
  ANALYSIS_BASE_CURRENCY,
  COMPARISON_MODE_LABELS,
  analyzeCategoryContributionAcrossMonths,
  buildComparisonResult,
  buildPeriodTotals,
  compareKpis,
  daysInMonthKey,
  filterTransactionsByCurrency,
  getMonthLabel,
  getShortMonthLabel,
  listMonthRange,
  monthsNeededForAnalysis,
  otherCurrencySummaries,
  shiftMonthKey,
  type ComparisonMode,
  type KpiComparison,
  type SpendGroupComparison,
} from '../services/comparisonEngine';
import {sumExpensesByCategory} from '../services/financeLogic';
import {compareMerchantsAcrossMonths} from '../services/merchantIdentity';
import {roundMoney, sumMoney} from '../services/money';
import {
  compareAccountsAcrossMonths,
  comparePaymentInstrumentsAcrossMonths,
  comparePaymentTypesAcrossMonths,
  compareSubscriptionsAcrossMonths,
} from '../services/paymentInstrument';
import {
  getCurrentMonthKey,
  getEarliestTransactionMonth,
  getTransactionsByMonth,
  loadAccounts,
  loadBudgetRowsForMonth,
  loadMerchants,
  loadPaymentInstruments,
  loadSubscriptions,
} from '../services/storage';
import type {Account, Budget, Merchant, PaymentInstrument, Subscription, Transaction} from '../types/finance';
import styles from './AnalysisScreen.module.css';

const CATEGORY_COLORS = [
  '#4F46E5', '#7C3AED', '#0EA5E9', '#059669',
  '#D97706', '#DC2626', '#DB2777', '#0891B2'
];

const COMPARISON_OPTIONS: ComparisonMode[] = [
  'previous_month', 'same_month_last_year', 'avg_3m', 'avg_6m', 'avg_12m', 'none',
];

type DeepTab = 'category' | 'merchant' | 'payment' | 'account' | 'subscription';

const formatMoney = (value: number) => `$${value.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;
const formatSignedMoney = (value: number) => `${value >= 0 ? '+' : '-'}${formatMoney(Math.abs(value))}`;

function kpiDeltaText(kpi: KpiComparison, mode: ComparisonMode) {
  if (mode === 'none' || kpi.absoluteDelta === null) return null;
  const amount = kpi.deltaKind === 'percentage_points'
    ? `${kpi.absoluteDelta >= 0 ? '+' : '-'}${Math.abs(kpi.absoluteDelta * 100).toFixed(1)} 個百分點`
    : `${kpi.direction === 'up' ? '↑' : kpi.direction === 'down' ? '↓' : '→'} ${formatSignedMoney(kpi.absoluteDelta)}`;
  const percent = kpi.deltaKind === 'relative' && kpi.percentageDelta !== null
    ? ` / ${kpi.percentageDelta >= 0 ? '+' : '-'}${formatPercent(Math.abs(kpi.percentageDelta))}`
    : kpi.deltaKind === 'relative' && kpi.comparison === 0 && (kpi.current || 0) > 0
      ? ' / 比較期為 0'
      : '';
  return `${amount}${percent}`;
}

function GroupList({rows, empty, vsLabel, showComparison}: {rows: SpendGroupComparison[]; empty: string; vsLabel: string; showComparison: boolean}) {
  if (!rows.length) return <p className={styles.empty}>{empty}</p>;
  return (
    <div className={styles.changeList}>
      {rows.map(item => (
        <div key={item.key} className={styles.changeRow}>
          <div className={styles.changeMain}>
            <span className={styles.changeTitle}>{item.label}</span>
            <span className={styles.changeMeta}>
              本月 {formatMoney(item.currentAmount)} · {item.currentCount} 次
              {item.currentAverage !== null ? ` · 平均 ${formatMoney(item.currentAverage)}` : ''}
              {showComparison && (item.comparisonAmount > 0 || item.comparisonCount > 0) ? ` · ${vsLabel} ${formatMoney(item.comparisonAmount)}` : ''}
            </span>
          </div>
          {showComparison ? (
            <span className={[styles.changeDelta, item.delta >= 0 ? styles.deltaUp : styles.deltaDown].join(' ')}>
              {formatSignedMoney(item.delta)}
              {item.percentageDelta !== null ? ` · ${item.percentageDelta >= 0 ? '+' : '-'}${formatPercent(Math.abs(item.percentageDelta))}` : ''}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function AnalysisScreen() {
  const currentMonth = getCurrentMonthKey();
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [mode, setMode] = useState<ComparisonMode>('previous_month');
  const [deepTab, setDeepTab] = useState<DeepTab>('category');
  const [monthlyTransactions, setMonthlyTransactions] = useState<Record<string, Transaction[]>>({});
  const [budgets, setBudgets] = useState<Budget[] | null | undefined>(undefined);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [instruments, setInstruments] = useState<PaymentInstrument[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [historyStartMonth, setHistoryStartMonth] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setBudgets(undefined);
    Promise.all([
      loadBudgetRowsForMonth(selectedMonth),
      loadMerchants(),
      loadPaymentInstruments(),
      loadAccounts(),
      loadSubscriptions(),
      getEarliestTransactionMonth(),
    ]).then(([nextBudgets, nextMerchants, nextInstruments, nextAccounts, nextSubscriptions, earliestMonth]) => {
      if (!active) return;
      setBudgets(nextBudgets);
      setMerchants(nextMerchants);
      setInstruments(nextInstruments);
      setAccounts(nextAccounts);
      setSubscriptions(nextSubscriptions);
      setHistoryStartMonth(earliestMonth);
    });
    return () => { active = false; };
  }, [selectedMonth]);

  useEffect(() => {
    let active = true;
    const months = monthsNeededForAnalysis(selectedMonth, mode, 6);
    Promise.all(months.map(month => getTransactionsByMonth(month))).then(results => {
      if (!active) return;
      setMonthlyTransactions(Object.fromEntries(months.map((month, index) => [month, results[index]])));
    });
    return () => { active = false; };
  }, [mode, selectedMonth]);

  const transactions = monthlyTransactions[selectedMonth] || [];
  const scopedTransactions = useMemo(
    () => filterTransactionsByCurrency(transactions, ANALYSIS_BASE_CURRENCY),
    [transactions]
  );
  const foreignSummaries = useMemo(() => otherCurrencySummaries(transactions, ANALYSIS_BASE_CURRENCY), [transactions]);
  const today = useMemo(() => new Date(), []);
  const comparison = useMemo(
    () => buildComparisonResult(selectedMonth, mode, monthlyTransactions, {
      currentMonth,
      today,
      currency: ANALYSIS_BASE_CURRENCY,
      historyStartMonth,
    }),
    [currentMonth, historyStartMonth, mode, monthlyTransactions, selectedMonth, today]
  );
  const currentTotals = useMemo(
    () => buildPeriodTotals(scopedTransactions, {month: selectedMonth, currentMonth, today, currency: ANALYSIS_BASE_CURRENCY}),
    [currentMonth, scopedTransactions, selectedMonth, today]
  );
  const comparisonTotals = comparison.totals;
  const coverage = comparison.coverage;
  const hasComparisonData = mode !== 'none' && coverage.availablePeriods > 0;
  const kpis = useMemo(
    () => compareKpis(currentTotals, hasComparisonData ? comparisonTotals : null),
    [comparisonTotals, currentTotals, hasComparisonData]
  );
  const categoryMap = useMemo(() => sumExpensesByCategory(scopedTransactions), [scopedTransactions]);
  const availableMonths = coverage.availableMonths;
  const contributions = useMemo(
    () => analyzeCategoryContributionAcrossMonths(
      scopedTransactions,
      monthlyTransactions,
      hasComparisonData ? availableMonths : [],
      ANALYSIS_BASE_CURRENCY
    ),
    [availableMonths, hasComparisonData, monthlyTransactions, scopedTransactions]
  );
  const merchantRows = useMemo(
    () => compareMerchantsAcrossMonths(scopedTransactions, monthlyTransactions, availableMonths, merchants),
    [availableMonths, merchants, monthlyTransactions, scopedTransactions]
  );
  const paymentTypes = useMemo(
    () => comparePaymentTypesAcrossMonths(scopedTransactions, monthlyTransactions, availableMonths, instruments),
    [availableMonths, instruments, monthlyTransactions, scopedTransactions]
  );
  const paymentInstruments = useMemo(
    () => comparePaymentInstrumentsAcrossMonths(scopedTransactions, monthlyTransactions, availableMonths, instruments),
    [availableMonths, instruments, monthlyTransactions, scopedTransactions]
  );
  const accountRows = useMemo(
    () => compareAccountsAcrossMonths(scopedTransactions, monthlyTransactions, availableMonths, accounts),
    [accounts, availableMonths, monthlyTransactions, scopedTransactions]
  );
  const subscriptionRows = useMemo(
    () => compareSubscriptionsAcrossMonths(
      scopedTransactions,
      monthlyTransactions,
      availableMonths,
      Object.fromEntries(subscriptions.map(item => [item.id, item.name]))
    ),
    [availableMonths, monthlyTransactions, scopedTransactions, subscriptions]
  );

  const daysInMonth = daysInMonthKey(selectedMonth);
  const elapsedDays = selectedMonth === currentMonth ? today.getDate() : daysInMonth;
  const budgetPaces = useMemo(
    () => (budgets && budgets.length
      ? buildBudgetPaces(budgets, categoryMap, {
        daysInMonth,
        elapsedDays,
        isCurrentMonth: selectedMonth === currentMonth,
      })
      : []),
    [budgets, categoryMap, currentMonth, daysInMonth, elapsedDays, selectedMonth]
  );
  const insights = useMemo(() => buildAnalysisInsights({
    mode,
    hasComparisonData,
    coverageLabel: coverage.requestedPeriods > 0 && coverage.availablePeriods > 0 && coverage.availablePeriods < coverage.requestedPeriods
      ? `此比較只根據 ${coverage.availablePeriods} / ${coverage.requestedPeriods} 個月歷史資料。`
      : undefined,
    expense: kpis.expense,
    savingsRate: kpis.savingsRate,
    contributions,
    budgetPaces,
    transactionCount: currentTotals.transactionCount,
  }), [
    coverage.availablePeriods,
    coverage.requestedPeriods,
    contributions,
    currentTotals.transactionCount,
    budgetPaces,
    hasComparisonData,
    kpis.expense,
    kpis.savingsRate,
    mode,
  ]);

  const pieData = useMemo(
    () => Object.entries(categoryMap)
      .sort((left, right) => right[1] - left[1])
      .map(([name, value], index) => ({name, value, color: CATEGORY_COLORS[index % CATEGORY_COLORS.length]})),
    [categoryMap]
  );
  const trendData = useMemo(() => listMonthRange(selectedMonth, 6).map(month => {
    const totals = buildPeriodTotals(monthlyTransactions[month] || [], {month, currentMonth, today});
    return {
      month,
      label: getShortMonthLabel(month),
      income: Math.round(totals.income),
      expense: Math.round(totals.expense),
      balance: Math.round(totals.balance),
    };
  }), [currentMonth, monthlyTransactions, selectedMonth, today]);
  const barDays = selectedMonth === currentMonth ? today.getDate() : daysInMonth;
  const barData = useMemo(() => {
    const amounts = Array.from({length: barDays}, () => 0);
    scopedTransactions.filter(item => item.type === 'expense').forEach(item => {
      const day = parseInt(item.date.split('-')[2], 10) - 1;
      if (day >= 0 && day < barDays) amounts[day] = sumMoney([amounts[day], item.amount]);
    });
    return amounts.map((amount, index) => ({day: String(index + 1), amount: roundMoney(amount)}));
  }, [barDays, scopedTransactions]);

  const vsLabel = COMPARISON_MODE_LABELS[mode];
  const kpiCards: Array<{label: string; kpi: KpiComparison; color: string; format: (value: number | null) => string}> = [
    {label: '總收入', kpi: kpis.income, color: 'var(--color-success)', format: value => formatMoney(value || 0)},
    {label: '總支出', kpi: kpis.expense, color: 'var(--color-danger)', format: value => formatMoney(value || 0)},
    {label: '結餘', kpi: kpis.balance, color: 'var(--color-text)', format: value => formatMoney(value || 0)},
    {label: '儲蓄率', kpi: kpis.savingsRate, color: 'var(--color-text)', format: value => value === null ? '—' : formatPercent(value)},
    {label: '日均支出', kpi: kpis.dailyExpense, color: 'var(--color-text)', format: value => formatMoney(value || 0)},
    {label: '交易次數', kpi: kpis.transactionCount, color: 'var(--color-text)', format: value => String(value ?? 0)},
    {label: '平均每筆支出', kpi: kpis.averageExpense, color: 'var(--color-text)', format: value => value === null ? '—' : formatMoney(value)},
  ];

  return (
    <Screen title="分析" subtitle={getMonthLabel(selectedMonth)}>
      <div className={styles.periodCard}>
        <div className={styles.periodBlock}>
          <span className={styles.periodLabel}>分析期間</span>
          <div className={styles.monthNav}>
            <button className={styles.navBtn} onClick={() => setSelectedMonth(month => shiftMonthKey(month, -1))}>‹ 上月</button>
            <span className={styles.monthLabel}>{getMonthLabel(selectedMonth)}</span>
            <button
              className={styles.navBtn}
              disabled={selectedMonth >= currentMonth}
              onClick={() => setSelectedMonth(month => shiftMonthKey(month, 1))}
            >
              下月 ›
            </button>
          </div>
        </div>
        <label className={styles.periodBlock}>
          <span className={styles.periodLabel}>比較</span>
          <select className={styles.select} value={mode} onChange={event => setMode(event.target.value as ComparisonMode)}>
            {COMPARISON_OPTIONS.map(option => (
              <option key={option} value={option}>{COMPARISON_MODE_LABELS[option]}</option>
            ))}
          </select>
          {mode !== 'none' && coverage.requestedPeriods > 0 && coverage.availablePeriods === 0 ? (
            <span className={styles.coverageNote}>暫無足夠歷史資料可比較</span>
          ) : null}
          {mode !== 'none' && coverage.availablePeriods > 0 && coverage.availablePeriods < coverage.requestedPeriods ? (
            <span className={styles.coverageNote}>
              {COMPARISON_MODE_LABELS[mode]} · 可用資料：{coverage.availablePeriods} / {coverage.requestedPeriods} 個月
            </span>
          ) : null}
        </label>
      </div>

      <div className={styles.currencyNote}>
        <p>主要分析：{ANALYSIS_BASE_CURRENCY}</p>
        {foreignSummaries.length ? (
          <p>
            其他幣別交易：{foreignSummaries.map(item => (
              `${item.currency} ${item.expense || item.income ? (item.expense || item.income).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '0.00'}`
            )).join(' · ')}
          </p>
        ) : null}
      </div>

      <div className={styles.grid}>
        {kpiCards.map(card => {
          const delta = kpiDeltaText(card.kpi, mode);
          return (
            <div key={card.label} className={styles.metric}>
              <span className={styles.metricLabel}>{card.label}</span>
              <span className={styles.metricValue} style={{color: card.color}}>{card.format(card.kpi.current)}</span>
              {delta ? <span className={[styles.metricDelta, card.kpi.direction === 'up' ? styles.deltaUp : card.kpi.direction === 'down' ? styles.deltaDown : ''].join(' ')}>{delta}</span> : null}
              {mode !== 'none' && hasComparisonData ? <span className={styles.metricVs}>vs {vsLabel}</span> : null}
            </div>
          );
        })}
      </div>

      <Card title="發生了甚麼？">
        {insights.length ? (
          <div className={styles.insightList}>
            {insights.map(item => (
              <div key={item.id} className={[styles.insightRow, styles[item.tone] || ''].join(' ')}>
                <span className={styles.insightTitle}>{item.title}</span>
                <span className={styles.insightDetail}>{item.detail}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className={styles.empty}>累積更多交易後會產生洞察。</p>
        )}
      </Card>

      <Card title="預算 vs 實際">
        {budgets === undefined ? (
          <p className={styles.empty}>載入中…</p>
        ) : budgets === null ? (
          <p className={styles.empty}>該月無預算紀錄（歷史從啟用月度預算後開始累積）。</p>
        ) : !budgetPaces.length ? (
          <p className={styles.empty}>該月未設定預算。</p>
        ) : (
          <div className={styles.changeList}>
            {budgetPaces.map(item => (
              <div key={item.category} className={styles.budgetBlock}>
                <div className={styles.changeRow}>
                  <div className={styles.changeMain}>
                    <span className={styles.changeTitle}>{item.category}預算</span>
                    <span className={styles.changeMeta}>
                      {formatMoney(item.spent)} / {formatMoney(item.budgetAmount)} · 已使用 {item.usedPercentage}%
                    </span>
                  </div>
                  <span className={styles.changeMeta}>月份已過 {item.monthProgressPercentage}%</span>
                </div>
                {item.isCurrentMonth ? (
                  <p className={styles.budgetDetail}>
                    {item.status === 'ahead' || item.status === 'over' ? '目前支出速度偏快。' : item.status === 'behind' ? '目前進度較預算慢。' : '支出速度大致跟月份進度一致。'}
                    按目前速度月底約 {formatMoney(item.projectedSpend)}
                    {item.projectedDelta > 0 ? `，預計超支 ${formatMoney(item.projectedDelta)}` : item.projectedDelta < 0 ? `，預計尚餘 ${formatMoney(Math.abs(item.projectedDelta))}` : ''}。
                    {item.safeDailySpend !== null ? ` 剩餘每日建議：≤ ${formatMoney(item.safeDailySpend)}` : ''}
                  </p>
                ) : (
                  <p className={styles.budgetDetail}>
                    {item.remainingBudget >= 0 ? `該月省下 ${formatMoney(item.remainingBudget)}` : `該月超支 ${formatMoney(Math.abs(item.remainingBudget))}`}。
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="概覽">
        {trendData.some(item => item.income || item.expense) ? (
          <div className={styles.chartWrap}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={trendData} margin={{top: 8, right: 0, left: -20, bottom: 0}}>
                <XAxis dataKey="label" tick={{fontSize: 10}} />
                <YAxis tick={{fontSize: 10}} />
                <Tooltip formatter={(value: number) => formatMoney(value)} labelFormatter={(_, payload) => (
                  payload?.[0]?.payload?.month ? getMonthLabel(payload[0].payload.month) : ''
                )} />
                <Bar dataKey="income" name="收入" fill="var(--color-success)" radius={[2, 2, 0, 0]} />
                <Bar dataKey="expense" name="支出" fill="var(--color-danger)" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className={styles.empty}>暫無跨月交易資料。</p>
        )}
        {pieData.length ? (
          <>
            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70}>
                    {pieData.map(entry => <Cell key={entry.name} fill={entry.color} />)}
                  </Pie>
                  <Tooltip formatter={(value: number) => formatMoney(value)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className={styles.legend}>
              {pieData.map(item => (
                <div key={item.name} className={styles.legendRow}>
                  <span className={styles.legendDot} style={{background: item.color}} />
                  <span className={styles.legendLabel}>{item.name}</span>
                  <span className={styles.legendValue}>{formatMoney(item.value)}</span>
                  <span className={styles.legendPct}>
                    {currentTotals.expense > 0 ? `${Math.round((item.value / currentTotals.expense) * 100)}%` : ''}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : null}
        {barData.some(item => item.amount > 0) ? (
          <div className={styles.chartWrap}>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={barData} margin={{top: 4, right: 0, left: -20, bottom: 0}}>
                <XAxis dataKey="day" tick={{fontSize: 10}} interval={4} />
                <YAxis tick={{fontSize: 10}} />
                <Tooltip formatter={(value: number) => formatMoney(value)} />
                <Bar dataKey="amount" fill="var(--color-danger)" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : null}
      </Card>

      <Card title="深入分析">
        <div className={styles.tabs}>
          {([
            ['category', '分類'],
            ['merchant', '商戶'],
            ['payment', '付款方式'],
            ['account', '帳戶'],
            ['subscription', '訂閱'],
          ] as [DeepTab, string][]).map(([value, label]) => (
            <button
              key={value}
              className={[styles.tab, deepTab === value ? styles.activeTab : ''].join(' ')}
              onClick={() => setDeepTab(value)}
            >
              {label}
            </button>
          ))}
        </div>

        {deepTab === 'category' ? (
          contributions.length ? (
            <div className={styles.changeList}>
              {contributions.map(item => (
                <div key={item.category} className={styles.changeRow}>
                  <div className={styles.changeMain}>
                    <span className={styles.changeTitle}>{item.category}</span>
                    <span className={styles.changeMeta}>
                      本月 {formatMoney(item.currentAmount)} · 佔 {formatPercent(item.currentShare)}
                      {hasComparisonData ? ` · ${vsLabel} ${formatMoney(item.comparisonAmount)}` : ''}
                    </span>
                  </div>
                  {hasComparisonData ? (
                    <span className={[styles.changeDelta, item.delta >= 0 ? styles.deltaUp : styles.deltaDown].join(' ')}>
                      {formatSignedMoney(item.delta)}
                      {item.role !== 'neutral' ? ` · ${item.role === 'offset' ? '抵銷' : '貢獻'} ${formatPercent(Math.abs(item.contribution))}` : ''}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.empty}>本月尚無分類支出。</p>
          )
        ) : null}

        {deepTab === 'merchant' ? (
          <>
            <GroupList rows={merchantRows.linked} empty="還沒有已歸戶的商戶分析。記帳時確認商戶身份後才會出現在這裡。" vsLabel={vsLabel} showComparison={hasComparisonData} />
            {merchantRows.unlinked.length ? (
              <>
                <p className={styles.unlinkedNote}>以下是尚未歸戶的原始商戶文字，不應視為精確的獨立商戶。</p>
                <GroupList rows={merchantRows.unlinked} empty="" vsLabel={vsLabel} showComparison={hasComparisonData} />
              </>
            ) : null}
          </>
        ) : null}

        {deepTab === 'payment' ? (
          <>
            <p className={styles.sectionLabel}>付款類型</p>
            <GroupList rows={paymentTypes} empty="本月沒有付款資料。" vsLabel={vsLabel} showComparison={hasComparisonData} />
            <p className={styles.sectionLabel}>具體付款工具</p>
            <GroupList rows={paymentInstruments.linked} empty="還沒有具體付款工具。新增信用卡或電子錢包後才會出現在這裡。" vsLabel={vsLabel} showComparison={hasComparisonData} />
            {paymentInstruments.unlinked.length ? (
              <>
                <p className={styles.unlinkedNote}>只有大類、尚未指定具體工具的交易：</p>
                <GroupList rows={paymentInstruments.unlinked} empty="" vsLabel={vsLabel} showComparison={hasComparisonData} />
              </>
            ) : null}
          </>
        ) : null}

        {deepTab === 'account' ? (
          <GroupList rows={accountRows} empty="本月沒有帳戶連結交易。" vsLabel={vsLabel} showComparison={hasComparisonData} />
        ) : null}

        {deepTab === 'subscription' ? (
          <GroupList rows={subscriptionRows} empty="本月沒有訂閱入帳。" vsLabel={vsLabel} showComparison={hasComparisonData} />
        ) : null}
      </Card>
    </Screen>
  );
}


