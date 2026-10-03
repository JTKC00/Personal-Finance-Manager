import {createContext, useContext, useEffect, useMemo, useState} from 'react';
import {Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis} from 'recharts';
import {Card} from '../components/Card';
import {BudgetEditor} from '../components/BudgetEditor';
import {MonthlyCommitments} from '../components/MonthlyCommitments';
import {buildBudgetRows} from '../services/financeLogic';
import {buildMonthlyBudgetRows, buildMonthlySpending} from '../services/monthlySpending';
import {useLocalToday} from '../hooks/useLocalToday';
import {Screen} from '../components/Screen';
import {useTransactionWorkspace, type EditCallbacks} from '../contexts/TransactionWorkspace';
import {useAuth} from '../contexts/AuthContext';
import {buildAnalysisInsights, type AnalysisInsight} from '../services/analysisInsights';
import {buildBudgetPaces} from '../services/budgetPace';
import {COMPARISON_MODE_LABELS, daysInMonthKey, shiftMonthKey, type ComparisonMode, type KpiComparison} from '../services/comparisonEngine';
import {buildDailySpendChartData} from '../services/chartData';
import {formatChartMoney, formatMoney} from '../services/chartFormatters';
import {analysisKpiDelta, analysisKpiTone, buildAnalysisReport, DIMENSION_LABELS, type AnalysisDimension, type AnalysisReport} from '../services/analysisReport';
import {rangeDays, resolveAnalysisPeriod, type AnalysisPeriod, type AnalysisSelection} from '../services/analysisPeriod';
import {createAnalysisLoader, type AnalysisData} from '../services/analysisLoader';
import {getEarliestTransactionDate, getTransactionsByDateRange, loadAccounts, loadBudgetRowsForMonth, loadMerchants, loadPaymentInstruments, loadSubscriptions} from '../services/storage';
import {sumMoney} from '../services/money';
import type {Transaction} from '../types/finance';
import styles from './AnalysisScreen.module.css';

const AnalysisEdits = createContext<EditCallbacks | null>(null);

const COLORS = ['#4F46E5', '#7C3AED', '#0EA5E9', '#059669', '#D97706', '#DC2626', '#DB2777', '#0891B2'];
const MODES: ComparisonMode[] = ['previous_month', 'same_month_last_year', 'avg_3m', 'avg_6m', 'avg_12m', 'none'];
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const rangeLabel = (range: {start: string; end: string}) => `${range.start} 至 ${range.end}`;

function Metric({label, kpi}: {label: string; kpi: KpiComparison}) {
  const delta = analysisKpiDelta(kpi);
  return <div className={styles.metric}>
    <span className={styles.metricLabel}>{label}</span>
    <strong className={styles.metricValue}>{kpi.current === null ? '—' : kpi.key === 'savingsRate' ? pct(kpi.current) : kpi.key === 'transactionCount' ? `${kpi.current} 次` : formatMoney(kpi.current)}</strong>
    {delta && <span className={`${styles.metricDelta} ${styles[analysisKpiTone(kpi)]}`}>{delta}</span>}
  </div>;
}

function TransactionRows({rows, data, containsSaved}: {rows: Transaction[]; data: AnalysisData; containsSaved?: (t: Transaction) => boolean}) {
  const callbacks = useContext(AnalysisEdits);
  const {openEdit} = useTransactionWorkspace();
  const [limit, setLimit] = useState(25);
  return <>
    {rows.length === 0 ? <p className={styles.empty}>此期間沒有符合的支出。</p> : <ul className={styles.transactionList}>
      {rows.slice(0, limit).map(t => <li key={t.id} className={styles.transactionRow}>
        <div><strong>{data.directories.merchants.find(m => m.id === t.merchantId)?.name || t.merchantText || t.merchant || (t.merchantId ? data.errors.includes('商戶名稱') ? '商戶名稱未能載入' : '已刪除商戶' : '未指定商戶')}</strong>
          <span className={styles.changeMeta}>{t.date} · {t.category}</span>{t.note && <span className={styles.changeMeta}>{t.note}</span>}</div>
        <div className={styles.transactionActions}><strong>{formatMoney(t.amount)}</strong>{callbacks && <button className={styles.navBtn} aria-label={`編輯交易：${t.note || t.category}`} onClick={() => openEdit(t.id, {
          ...callbacks,
          onSaved: async next => { await callbacks.onSaved(next); return containsSaved && !containsSaved(next) ? '此筆已移出目前明細，分析已按新資料更新。' : ''; },
        })}>編輯</button>}</div>
      </li>)}
    </ul>}
    {rows.length > limit && <button className={styles.navBtn} onClick={() => setLimit(n => n + 25)}>再顯示 25 筆（共 {rows.length} 筆）</button>}
  </>;
}

function GroupDetail({dimension, groupKey, report, data, period}: {dimension: AnalysisDimension; groupKey: string; report: AnalysisReport; data: AnalysisData; period: AnalysisPeriod}) {
  const [side, setSide] = useState<'current' | 'comparison'>('current');
  const detail = report.details(dimension, groupKey, side);
  return <div className={styles.detailBody}>
    <div className={styles.tabs} aria-label="明細期間">
      <button className={styles.tab} aria-pressed={side === 'current'} onClick={() => setSide('current')}>本期</button>
      {report.comparisonTotals && <button className={styles.tab} aria-pressed={side === 'comparison'} onClick={() => setSide('comparison')}>比較期</button>}
    </div>
    <p className={styles.changeMeta}>{side === 'current' ? rangeLabel(period.current) : report.available.map(rangeLabel).join('；')}</p>
    <p className={styles.detailTotal}>原始交易合計 {formatMoney(detail.total)} · {detail.rows.length} 次
      {side === 'comparison' && period.monthlyAverage ? ` ÷ ${report.available.length} 個月 = 平均 ${formatMoney(detail.average)}` : ''}</p>
    <TransactionRows key={side} rows={detail.rows} data={data} containsSaved={t => buildAnalysisReport(period, [...data.transactions.filter(row => row.id !== t.id), t], data.earliest, data.directories).details(dimension, groupKey, side).rows.some(row => row.id === t.id)} />
  </div>;
}

function GroupRow({dimension, row, index, report, data, period}: {
  dimension: AnalysisDimension;
  row: AnalysisReport['groups']['category'][number];
  index: number;
  report: AnalysisReport;
  data: AnalysisData;
  period: AnalysisPeriod;
}) {
  const [open, setOpen] = useState(false);
  return <details className={styles.groupDetail} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className={styles.groupSummary}>
      <span className={styles.changeMain}><strong>{dimension === 'category' && <span className={styles.legendDot} style={{background: COLORS[index % COLORS.length], display: 'inline-block', marginRight: 6}} />}{row.label}</strong>
        <span className={styles.changeMeta}>本期 {formatMoney(row.currentAmount)} · {row.currentCount} 次{row.currentAverage !== null ? ` · 平均 ${formatMoney(row.currentAverage)}` : ''}
          {dimension === 'category' || dimension === 'structure' ? ` · 佔 ${pct(report.currentTotals.expense ? row.currentAmount / report.currentTotals.expense : 0)}` : ''}</span>
        {!row.linked && <span className={styles.changeMeta}>未連結或已刪除的身份資料</span>}
        {report.comparisonTotals && <span className={styles.changeMeta}>{period.comparisonLabel} {formatMoney(row.comparisonAmount)}</span>}
      </span>
      <span className={styles.groupAction}>{report.comparisonTotals && <span className={row.delta > 0 ? styles.warning : row.delta < 0 ? styles.safe : styles.info}>{row.delta > 0 ? '+' : row.delta < 0 ? '−' : ''}{formatMoney(Math.abs(row.delta))}</span>}<span className={styles.changeMeta}>{open ? '收起明細' : '查看明細'}</span></span>
    </summary>
    {open && <GroupDetail dimension={dimension} groupKey={row.key} report={report} data={data} period={period} />}
  </details>;
}

function Groups({dimension, report, data, period}: {dimension: AnalysisDimension; report: AnalysisReport; data: AnalysisData; period: AnalysisPeriod}) {
  const requiredDirectory: Partial<Record<AnalysisDimension, string>> = {merchant: '商戶名稱', payment: '付款工具', instrument: '付款工具', account: '帳戶名稱', subscription: '訂閱名稱'};
  const missing = requiredDirectory[dimension];
  if (missing && data.errors.includes(missing)) return <p className={styles.empty}>{missing}未能載入，請使用上方重試。其他分析仍可使用。</p>;
  const rows = report.groups[dimension];
  return <div className={styles.changeList}>
    {rows.length === 0 && <p className={styles.empty}>此期間沒有{DIMENSION_LABELS[dimension]}支出資料。</p>}
    {rows.map((row, index) => <GroupRow key={row.key} dimension={dimension} row={row} index={index} report={report} data={data} period={period} />)}
  </div>;
}

function Report({period, data, mode, retry, editBudget}: {period: AnalysisPeriod; data: AnalysisData; mode: ComparisonMode; retry: () => void; editBudget: (month: string) => void}) {
  const [dimension, setDimension] = useState<AnalysisDimension>('category');
  const [showAllInsights, setShowAllInsights] = useState(false);
  const report = useMemo(() => buildAnalysisReport(period, data.transactions, data.earliest, data.directories), [data, period]);
  const month = period.current.start.slice(0, 7);
  const monthlySpending = useMemo(() => period.view === 'month' ? buildMonthlySpending({
    month, today: period.current.end, transactions: data.transactions,
    subscriptions: period.isCurrentMonth ? data.errors.includes('訂閱名稱') ? null : data.directories.subscriptions : [],
  }) : null, [month, period, data]);
  const categorySpend = monthlySpending?.base.spentByCategory || Object.fromEntries(report.groups.category.map(row => [row.key, row.currentAmount]));
  const monthlyBudgets = data.budgets[month];
  const monthlyBudgetRows = monthlySpending && monthlyBudgets ? buildMonthlyBudgetRows(monthlyBudgets, monthlySpending) : [];
  const budgetPaces = period.view === 'month' && monthlyBudgets ? buildBudgetPaces(monthlyBudgets, categorySpend, {
    daysInMonth: daysInMonthKey(month), elapsedDays: rangeDays(period.current), isCurrentMonth: period.isCurrentMonth,
  }) : [];
  const budgetKnown = period.view === 'month' && monthlyBudgets !== undefined;
  const baseInsights = buildAnalysisInsights({mode, comparisonLabel: period.comparisonLabel, periodLabel: '所選期間',
    hasComparisonData: report.comparisonTotals !== null, expense: report.kpis.expense, savingsRate: report.kpis.savingsRate,
    contributions: report.contributions, budgetPaces, transactionCount: report.currentTotals.transactionCount, budgetAvailable: budgetKnown,
  }).filter(i => !['missing-comparison', 'partial-coverage'].includes(i.id));
  const anomalyInsights: AnalysisInsight[] = report.anomalies.length ? [{id: 'anomaly-summary', title: `${report.anomalies.length} 筆大額支出值得留意`,
    detail: '高於所選期間之前 90 日同分類中位數三倍，且高出超過 HKD 500。下方可查看交易與樣本依據。', tone: 'warning', rank: 1.5}] : [];
  const insights = [...baseInsights.filter(i => !(i.id === 'stable' && (anomalyInsights.length || data.errors.length))), ...anomalyInsights].sort((a, b) => a.rank - b.rank);
  if (!insights.length) insights.push({id: 'recorded-summary', title: `所選期間已記錄 ${report.currentTotals.transactionCount} 筆交易`, detail: '可展開下方分類或商戶查看支出依據；目前可用資料不足以判斷是否平穩。', tone: 'info', rank: 50});
  const daily = period.view === 'month' ? buildDailySpendChartData(report.current, rangeDays(period.current)) : [];
  const coveredBudgetMonths = period.budgetMonths.filter(m => data.budgets[m] !== undefined && data.budgets[m] !== null);
  const annualBudgets = new Map<string, number[]>();
  coveredBudgetMonths.flatMap(m => data.budgets[m] || []).forEach(b => annualBudgets.set(b.category, [...(annualBudgets.get(b.category) || []), b.amount]));
  const chartColors = new Map(report.groups.category.map((row, i) => [row.key, COLORS[i % COLORS.length]]));
  return <>
    {data.errors.length > 0 && <div className={styles.notice} role="status">部分資料載入失敗：{data.errors.join('、')}。相關分析可能不完整；預算會保留最近已確認的資料。<button className={styles.navBtn} onClick={retry}>重試</button></div>}
    <div className={styles.currencyNote}><strong>主要分析：HKD</strong>
      {report.foreign.map(f => <p key={f.currency}>{f.currency}：收入 {f.income.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} · 支出 {f.expense.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}（分開列示，未換匯）</p>)}
    </div>
    {period.comparisons.length > 0 && <div className={styles.notice}>
      <strong>{report.comparisonTotals ? `比較：${period.comparisonLabel}` : '暫無足夠歷史資料可比較'}</strong>
      {report.available.map(r => <p key={r.start}>{rangeLabel(r)}</p>)}
      {report.coveragePartial && <p>歷史覆蓋不完整：可用 {report.available.length} / {period.comparisons.length} 個{period.view === 'month' ? '月' : '期間'}{report.earliest ? `；首筆記帳日期 ${report.earliest}` : ''}。首筆記帳前的資料未知，不應解讀為零支出。</p>}
      {period.monthlyAverage && report.available.length > 0 && <p>比較金額為 {report.available.length} 個可用月份的平均。</p>}
    </div>}
    {report.earliest && report.earliest > period.current.start && <p className={styles.notice}>所選期間的記帳覆蓋不完整，首筆記帳日期為 {report.earliest}；日均及預估仍按所選期間天數計算，可能偏低。</p>}
    <div className={styles.grid}>
      <Metric label="總收入" kpi={report.kpis.income} /><Metric label="總支出" kpi={report.kpis.expense} />
      <Metric label="結餘" kpi={report.kpis.balance} /><Metric label="儲蓄率" kpi={report.kpis.savingsRate} />
    </div>
    <details className={styles.secondary}><summary>更多指標：日均、筆數、平均每筆</summary><div className={styles.grid}>
      <Metric label="日均支出" kpi={report.kpis.dailyExpense} /><Metric label="交易次數" kpi={report.kpis.transactionCount} /><Metric label="平均每筆支出" kpi={report.kpis.averageExpense} />
    </div></details>
    <Card title="發生了甚麼？">
      <div className={styles.insightList}>{(showAllInsights ? insights : insights.slice(0, 3)).map(i => <div key={i.id} className={`${styles.insightRow} ${styles[i.tone]}`}><strong className={styles.insightTitle}>{i.title}</strong><span className={styles.insightDetail}>{i.detail}</span></div>)}</div>
      {insights.length > 3 && <button className={styles.navBtn} aria-expanded={showAllInsights} onClick={() => setShowAllInsights(v => !v)}>{showAllInsights ? '收起' : `查看其餘 ${insights.length - 3} 則`}</button>}
      {report.anomalies.length > 0 && <details className={styles.secondary}><summary>查看大額支出依據</summary>
        <p className={styles.changeMeta}>基準：{rangeLabel(period.baseline)} · 同分類 HKD 支出，至少五筆樣本。這是統計提示，並非錯帳判定。</p>
        {report.anomalies.map(a => <div key={a.transaction.id}><p className={styles.changeMeta}>{a.transaction.category}：樣本 {a.sampleCount} 筆 · 中位數 {formatMoney(a.median)}</p><TransactionRows rows={[a.transaction]} data={data} /></div>)}
      </details>}
    </Card>
    <Card title={period.view === 'month' ? '近六個月收支趨勢' : period.view === 'year' ? '年度收支趨勢' : '所選期間收支趨勢'}>
      <p className={styles.changeMeta}>{rangeLabel(period.trend)} · HKD · 空白表示尚無記帳覆蓋。</p>
      <p className={styles.chartLegend}><span><i style={{background: 'var(--color-success)'}} />收入</span><span><i style={{background: 'var(--color-danger)'}} />支出</span></p>
      {report.trend.some(t => t.income !== null) ? <>
        <div className={styles.chartWrap}><ResponsiveContainer width="100%" height={230}>
          <BarChart data={report.trend} margin={{left: 0, right: 12, top: 12}}><XAxis dataKey="label" tick={{fontSize: 11}} minTickGap={20} /><YAxis width={65} tick={{fontSize: 11}} />
            <Tooltip formatter={formatChartMoney} /><Bar dataKey="income" name="收入" fill="var(--color-success)" radius={[3, 3, 0, 0]} /><Bar dataKey="expense" name="支出" fill="var(--color-danger)" radius={[3, 3, 0, 0]} /></BarChart>
        </ResponsiveContainer></div>
        <details className={styles.secondary}><summary>查看趨勢數據</summary><ul className={styles.transactionList}>{report.trend.map(t => <li key={t.start} className={styles.transactionRow}><span>{t.label}</span><span>{t.income === null ? '尚無記帳覆蓋' : `收入 ${formatMoney(t.income)} · 支出 ${formatMoney(t.expense ?? 0)}`}</span></li>)}</ul></details>
      </> : <p className={styles.empty}>暫無趨勢資料。</p>}
    </Card>
    <Card title="支出分佈">
      {report.currentTotals.expense > 0 ? <>
        <div className={styles.chartWrap}><ResponsiveContainer width="100%" height={190}><PieChart><Pie data={report.groups.category.filter(r => r.currentAmount > 0)} dataKey="currentAmount" nameKey="label" innerRadius={48} outerRadius={78}>
          {report.groups.category.filter(r => r.currentAmount > 0).map(r => <Cell key={r.key} fill={chartColors.get(r.key)} />)}
        </Pie><Tooltip formatter={formatChartMoney} /></PieChart></ResponsiveContainer></div>
        <Groups dimension="category" report={report} data={data} period={period} />
      </> : <p className={styles.empty}>所選期間沒有 HKD 支出。</p>}
      <h3 className={styles.sectionLabel}>訂閱／其他支出</h3><p className={styles.changeMeta}>依交易的訂閱連結分類；其他支出可能包含房租等固定支出。</p>
      <Groups dimension="structure" report={report} data={data} period={period} />
    </Card>
    {period.view === 'month' && <Card title="每日支出"><p className={styles.changeMeta}>{rangeLabel(period.current)} · HKD</p>
      {report.currentTotals.expense > 0 ? <><div className={styles.chartWrap}><ResponsiveContainer width="100%" height={180}><BarChart data={daily}><XAxis dataKey="day" minTickGap={14} /><YAxis width={65} tick={{fontSize: 11}} /><Tooltip formatter={formatChartMoney} labelFormatter={label => `${month}-${String(label).padStart(2, '0')}`} /><Bar dataKey="amount" name="支出" fill="var(--color-primary)" /></BarChart></ResponsiveContainer></div>
        <details className={styles.secondary}><summary>查看每日數據</summary><ul className={styles.transactionList}>{daily.map(d => <li className={styles.transactionRow} key={d.day}><span>{month}-{d.day.padStart(2, '0')}</span><span>{formatMoney(d.amount)}</span></li>)}</ul></details></> : <p className={styles.empty}>所選月份沒有 HKD 支出。</p>}
    </Card>}
    {period.isCurrentMonth && monthlySpending && <MonthlyCommitments spending={monthlySpending} budgets={monthlyBudgets} />}
    {period.isCurrentMonth && <Card title="按目前速度估算月底支出"><strong className={styles.metricValue}>{formatMoney(report.projection ?? 0)}</strong><p className={styles.changeMeta}>截至 {period.current.end} 的支出 ÷ {rangeDays(period.current)} 天 × {daysInMonthKey(month)} 天。這是消費速度估算，與上方「已知支出合計」分開；不再疊加未來交易或訂閱。</p>{rangeDays(period.current) < 7 && <p className={styles.notice}>月初樣本較少，預估可能有較大變動。</p>}</Card>}
    {period.view !== 'custom' && <Card title="預算 vs 實際" action={period.view === 'month' ? {label: '調整預算', onClick: () => editBudget(month)} : undefined}>
      {period.view === 'year' ? <>
        <details className={styles.secondary}><summary>調整各月份預算</summary><div className={styles.tabs}>{period.budgetMonths.map(m => <button key={m} className={styles.navBtn} onClick={() => editBudget(m)}>{m}</button>)}</div></details>
        <p className={styles.changeMeta}>有紀錄的月份：{coveredBudgetMonths.length} / {period.budgetMonths.length}；{coveredBudgetMonths.join('、') || '暫無'}。{period.partial ? '本月預算採整月金額，實際支出只計至今日。' : ''}</p>
        <p className={styles.changeMeta}>只比較有預算紀錄月份的實際支出；未設定分類的支出仍包含在上方總支出。</p>
        {[...annualBudgets].map(([category, amounts]) => {
          const amount = sumMoney(amounts);
          const spent = sumMoney(report.current.filter(t => t.type === 'expense' && t.category === category && (data.budgets[t.date.slice(0, 7)] || []).some(b => b.category === category)).map(t => t.amount));
          return <div className={styles.changeRow} key={category}><span>{category}</span><span>{formatMoney(spent)} / {formatMoney(amount)}{spent > amount ? ` · 超支 ${formatMoney(spent - amount)}` : ''}</span></div>;
        })}
        {!annualBudgets.size && <p className={styles.empty}>沒有可用的年度預算金額。</p>}
      </> : monthlyBudgets === undefined ? <p className={styles.empty}>預算未能載入，請使用上方重試。</p> : !budgetPaces.length ? <p className={styles.empty}>{monthlyBudgets === null ? '該月無歷史預算紀錄。' : '該月未設定預算。'}</p> : budgetPaces.map(b => {
        const commitments = monthlyBudgetRows.find(row => row.category === b.category);
        return <div key={b.category} className={styles.budgetBlock}>
        <div className={styles.changeRow}><strong>{b.category}</strong><span>{formatMoney(b.spent)} / {formatMoney(b.budgetAmount)} · 已用 {b.usedPercentage}%</span></div>
        <progress className={styles.progress} value={Math.min(b.usedRatio, 1)} max={1} aria-label={`${b.category}預算使用率 ${b.usedPercentage}%`} />
        <p className={styles.budgetDetail}>{b.isCurrentMonth ? `月份已過 ${b.monthProgressPercentage}%，按目前速度月底約 ${formatMoney(b.projectedSpend)}。` : b.remainingBudget >= 0 ? `預算尚餘 ${formatMoney(b.remainingBudget)}。` : `已超支 ${formatMoney(-b.remainingBudget)}。`}
          {b.isCurrentMonth && b.remainingBudget < 0 ? `已超支 ${formatMoney(-b.remainingBudget)}，剩餘預算為 0。` : b.safeDailySpend !== null ? ` 按已花費計，剩餘每日可用 ${formatMoney(Math.max(0, b.safeDailySpend))}。` : ''}</p>
        {period.isCurrentMonth && commitments && <p className={styles.budgetDetail}>未來交易 {formatMoney(commitments.future)} · 待扣訂閱 {commitments.pending === null ? '未能載入' : formatMoney(commitments.pending)} · {commitments.projectedRemaining === null ? '暫不可計算預計剩餘' : commitments.projectedRemaining >= 0 ? `預計剩餘 ${formatMoney(commitments.projectedRemaining)}` : `預計超支 ${formatMoney(Math.abs(commitments.projectedRemaining))}`}</p>}
      </div>; })}
    </Card>}
    {period.view === 'custom' && <p className={styles.notice}>自訂日期不攤分月預算；如需預算進度或月底預估，請切換至月度。</p>}
    <Card title="深入分析"><div className={styles.tabs} aria-label="分析維度">{(Object.keys(DIMENSION_LABELS) as AnalysisDimension[]).filter(d => d !== 'structure').map(d => <button key={d} className={styles.tab} aria-pressed={dimension === d} onClick={() => setDimension(d)}>{DIMENSION_LABELS[d]}</button>)}</div>
      {dimension === 'merchant' && <p className={styles.changeMeta}>未歸戶的原始文字分開列示，不代表已確認的獨立商戶。</p>}
      <Groups key={dimension} dimension={dimension} report={report} data={data} period={period} />
    </Card>
  </>;
}

function AnalysisSession({uid}: {uid: string}) {
  const today = useLocalToday();
  const [selection, setSelection] = useState<AnalysisSelection>(() => ({view: 'month', month: today.slice(0, 7), year: Number(today.slice(0, 4)), start: `${today.slice(0, 7)}-01`, end: today, mode: 'previous_month', basis: 'aligned'}));
  const [retryCount, setRetryCount] = useState(0);
  const [pending, setPending] = useState(true);
  const [loaded, setLoaded] = useState<{key: string; data?: AnalysisData; error?: string} | null>(null);
  const [budgetMonth, setBudgetMonth] = useState<string | null>(null);
  const [budgetNotice, setBudgetNotice] = useState('');
  const [loader] = useState(() => createAnalysisLoader({transactions: getTransactionsByDateRange, earliest: getEarliestTransactionDate, budgets: loadBudgetRowsForMonth, merchants: loadMerchants, instruments: loadPaymentInstruments, accounts: loadAccounts, subscriptions: loadSubscriptions}));
  useEffect(() => () => loader.clear(), [loader]);
  const resolved = useMemo(() => {
    try { return {period: resolveAnalysisPeriod(selection, today), error: ''}; }
    catch (error) { return {period: null, error: error instanceof Error ? error.message : '無效的日期範圍。'}; }
  }, [selection, today]);
  useEffect(() => { loader.clear(); }, [loader, today]);
  const requestKey = JSON.stringify([uid, resolved.period]);
  useEffect(() => {
    if (!resolved.period) return;
    let active = true;
    setPending(true);
    void loader.load(uid, resolved.period).then(data => { if (active) setLoaded(current => ({key: requestKey, data: {...data, budgets: {...(current?.key === requestKey ? current.data?.budgets : {}), ...data.budgets}}})); }).catch(() => {
      if (active) setLoaded(current => ({key: requestKey, data: current?.key === requestKey ? current.data : undefined, error: '分析重新整理失敗，已保留可用資料；已儲存的內容毋須再次提交。'}));
    }).finally(() => { if (active) setPending(false); });
    return () => { active = false; };
  }, [loader, uid, resolved.period, requestKey, retryCount]);
  function update(patch: Partial<AnalysisSelection>) { setSelection(s => ({...s, ...patch})); }
  function retry() { loader.clear(); setRetryCount(n => n + 1); }
  const data = loaded?.key === requestKey ? loaded.data : undefined;
  const error = loaded?.key === requestKey ? loaded.error : undefined;
  const period = resolved.period;
  const callbacks: EditCallbacks = {
    onSaved: transaction => {
      setLoaded(current => current?.data ? {...current, data: {...current.data, transactions: [...current.data.transactions.filter(t => t.id !== transaction.id), transaction]}} : current);
      retry();
    },
    onMissing: id => { setLoaded(current => current?.data ? {...current, data: {...current.data, transactions: current.data.transactions.filter(t => t.id !== id)}} : current); retry(); },
  };
  return <AnalysisEdits.Provider value={callbacks}><Screen title="分析" subtitle={period ? rangeLabel(period.current) : '選擇分析期間'}>
    <div className={styles.periodCard}>
      <div className={styles.tabs} aria-label="分析期間類型">{(['month', 'year', 'custom'] as const).map(view => <button key={view} className={styles.tab} aria-pressed={selection.view === view} onClick={() => update({view})}>{view === 'month' ? '月度' : view === 'year' ? '年度' : '自訂日期'}</button>)}</div>
      {selection.view === 'month' ? <div className={styles.monthNav}>
        <button className={styles.navBtn} disabled={!selection.month || selection.month <= '1900-01'} onClick={() => update({month: shiftMonthKey(selection.month, -1)})}>‹ 上月</button>
        <label className={styles.periodBlock}><span className={styles.periodLabel}>分析月份</span><input className={styles.select} type="month" min="1900-01" max={today.slice(0, 7)} value={selection.month} onChange={e => update({month: e.target.value})} /></label>
        <button className={styles.navBtn} disabled={!selection.month || selection.month >= today.slice(0, 7)} onClick={() => update({month: shiftMonthKey(selection.month, 1)})}>下月 ›</button>
      </div> : selection.view === 'year' ? <label className={styles.periodBlock}>分析年份<input className={styles.select} type="number" min={1900} max={Number(today.slice(0, 4))} value={selection.year || ''} onChange={e => update({year: Number(e.target.value)})} /></label> : <div className={styles.dateInputs}>
        <label className={styles.periodBlock}>開始日期<input className={styles.select} type="date" min="1900-01-01" max={today} value={selection.start} onChange={e => update({start: e.target.value})} /></label>
        <label className={styles.periodBlock}>截止日期<input className={styles.select} type="date" min={selection.start} max={today} value={selection.end} onChange={e => update({end: e.target.value})} /></label>
      </div>}
      <label className={styles.periodBlock}><span className={styles.periodLabel}>比較</span><select className={styles.select} value={selection.view === 'month' ? selection.mode : selection.mode === 'none' ? 'none' : 'previous_month'} onChange={e => update({mode: e.target.value as ComparisonMode})}>
        {selection.view === 'month' ? MODES.map(mode => <option key={mode} value={mode}>{COMPARISON_MODE_LABELS[mode]}</option>) : <><option value="previous_month">{selection.view === 'year' ? '去年同期' : '前一等長期間'}</option><option value="none">不比較</option></>}
      </select></label>
      {period?.isCurrentMonth && selection.mode !== 'none' && <div className={styles.tabs} aria-label="比較基準"><button className={styles.tab} aria-pressed={selection.basis === 'aligned'} onClick={() => update({basis: 'aligned'})}>同期比較</button><button className={styles.tab} aria-pressed={selection.basis === 'full'} onClick={() => update({basis: 'full'})}>整月比較</button></div>}
      <button className={styles.navBtn} onClick={retry}>重新整理</button>
      {period?.partial && <p className={styles.coverageNote}>此期間尚未結束，實際收支只計至 {today}。{period.isCurrentMonth && selection.basis === 'full' && selection.mode !== 'none' ? '目前比較過去整月，支出較低可能只是月份尚未結束。' : ''}</p>}
    </div>
    {budgetNotice && <p className={styles.notice} role="status">{budgetNotice}</p>}
    {resolved.error && <p className={styles.notice} role="alert">{resolved.error}</p>}
    {error && <div role="alert" className={styles.notice}>{error}<button className={styles.navBtn} onClick={retry}>重試</button></div>}
    {pending && !resolved.error && <p className={styles.empty} role="status">{data ? '正在更新分析…' : '正在載入分析資料…'}</p>}
    {data && period && <Report key={requestKey} period={period} mode={selection.mode} data={data} retry={retry} editBudget={setBudgetMonth} />}
    {budgetMonth && <BudgetEditor initialMonth={budgetMonth} onClose={() => setBudgetMonth(null)} onSaved={result => {
      setLoaded(current => current?.data ? {...current, data: {...current.data, budgets: {...current.data.budgets, [result.month]: buildBudgetRows(result.budgets, result.month)}}} : current);
      setBudgetNotice(`${result.month} 預算已儲存，分析已更新。`);
      retry();
    }} />}
  </Screen></AnalysisEdits.Provider>;
}

export function AnalysisScreen() {
  const {user} = useAuth();
  return user ? <AnalysisSession key={user.uid} uid={user.uid} /> : null;
}
