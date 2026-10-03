import {useEffect, useMemo, useRef, useState} from 'react';
import {Plus, ChartNoAxesCombined} from 'lucide-react';
import {useNavigate} from 'react-router-dom';
import {Card} from '../components/Card';
import {BudgetEditor} from '../components/BudgetEditor';
import {MonthlyCommitments} from '../components/MonthlyCommitments';
import {Screen} from '../components/Screen';
import {useLocalToday} from '../hooks/useLocalToday';
import {useSubscriptionProcessing} from '../contexts/SubscriptionProcessingContext';
import {
  getTransactionsByMonth,
  loadBudgetRowsForMonth,
  loadGoals,
  loadSubscriptions,
} from '../services/storage';
import {
  buildBudgetRows,
  normalizeCurrency,
} from '../services/financeLogic';
import {buildMonthlyBudgetRows, buildMonthlyBudgetTotal, buildMonthlySpending} from '../services/monthlySpending';
import {getLastBackupAt, isBackupOverdue} from '../services/backupReminder';
import {roundMoney, sumMoney} from '../services/money';
import {Budget, Goal, Subscription, Transaction} from '../types/finance';
import styles from './DashboardScreen.module.css';

const dashboardBaseCurrency = 'HKD';
const formatMoney = (value: number, currency = dashboardBaseCurrency) =>
  `${currency} ${value.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
const formatPercent = (value: number) => `${Math.round(value * 100)}%`;
const clampPercent = (value: number) => Math.min(Math.max(value, 0), 1);

export function DashboardScreen() {
  const navigate = useNavigate();
  const {error: subscriptionProcessingError, processing: subscriptionsProcessing, retry, revision} = useSubscriptionProcessing();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loadedMonth, setLoadedMonth] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [budgetMonth, setBudgetMonth] = useState<string | null>(null);
  const [budgetNotice, setBudgetNotice] = useState('');
  const budgetRevision = useRef(0);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const today = useLocalToday();
  const month = today.slice(0, 7);

  useEffect(() => {
    let active = true;
    const budgetVersion = budgetRevision.current;
    setLoading(true);
    setLoadError('');
    async function load() {
      const [nextTransactions, nextBudgets, nextGoals, nextSubscriptions] = await Promise.all([
        getTransactionsByMonth(month),
        loadBudgetRowsForMonth(month),
        loadGoals(),
        loadSubscriptions()
      ]);
      if (!active) return;
      setTransactions(nextTransactions);
      if (budgetVersion === budgetRevision.current) setBudgets(nextBudgets || []);
      setGoals(nextGoals);
      setSubscriptions(nextSubscriptions);
      setLoadedMonth(month);
    }
    void load().catch(() => { if (active) setLoadError('本月收支未能更新，請重試。已有資料會保留。'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [month, revision, loadAttempt]);

  const spending = useMemo(() => buildMonthlySpending({month, today, transactions, subscriptions}), [month, today, transactions, subscriptions]);
  const summary = spending.base.actual;
  const recentTransactions = [...spending.actualTransactions].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 3);
  const currencySummaries = spending.byCurrency.map(c => c.actual).filter(c => c.count > 0);
  const foreignCurrencySummaries = currencySummaries.filter(item => item.currency !== dashboardBaseCurrency);
  const totalBudget = buildMonthlyBudgetTotal(budgets, spending);
  const categoryBudgets = buildMonthlyBudgetRows(budgets, spending);
  const monthlyBudget = totalBudget.budgetAmount;
  const baseTransactions = spending.actualTransactions.filter(item => normalizeCurrency(item.currency) === dashboardBaseCurrency);
  const expenseTransactions = baseTransactions.filter(item => item.type === 'expense');
  const budgetProgress = totalBudget.usedRatio;
  const budgetRemaining = totalBudget.remaining;
  const averageExpense = expenseTransactions.length ? roundMoney(summary.expense / expenseTransactions.length) : 0;
  const unusualTransactions = expenseTransactions
    .filter(item => averageExpense > 0 && item.amount >= averageExpense * 1.8)
    .sort((a, b) => b.amount - a.amount);
  const largestExpense = [...expenseTransactions].sort((a, b) => b.amount - a.amount)[0];
  const totalGoalTarget = sumMoney(goals.map(item => item.targetAmount));
  const totalGoalSaved = sumMoney(goals.map(item => item.savedAmount));
  const goalProgress = totalGoalTarget > 0 ? totalGoalSaved / totalGoalTarget : 0;
  const focusGoal = [...goals]
    .filter(item => item.targetAmount > 0)
    .sort((a, b) => (b.savedAmount / b.targetAmount) - (a.savedAmount / a.targetAmount))[0];

  const categoryAlerts = categoryBudgets
    .map(b => ({...b, ratio: (b.knownExpense ?? b.spent) / b.budgetAmount}))
    .filter(alert => alert.ratio >= 0.75)
    .sort((a, b) => b.ratio - a.ratio);

  const alertLabel = (ratio: number) =>
    ratio >= 1 ? '⚠️ 已知支出達到或超出預算' : ratio >= 0.9 ? '⚠️ 已知支出達 90%' : '⚠️ 已知支出達 75%';

  const pillClass = (p: number) =>
    p >= 0.9 ? styles.dangerPill : p >= 0.7 ? styles.warningPill : styles.safePill;
  const fillClass = (p: number) =>
    p >= 0.9 ? styles.dangerFill : p >= 0.7 ? styles.warningFill : styles.safeFill;

  const backupOverdue = isBackupOverdue(getLastBackupAt());

  if (loadedMonth !== month) return <Screen title="總覽" subtitle={`${month} · 本月收支`}>
    <p role={loadError ? 'alert' : 'status'}>{loadError || '正在載入本月收支…'}</p>
    {loadError && <button className={styles.retryButton} onClick={() => setLoadAttempt(n => n + 1)}>重試載入</button>}
  </Screen>;

  return (
    <Screen wide title="總覽" subtitle={`${month.replace('-', ' 年 ')} 月 · 你的收支近況`}>
      <div className={styles.desktopGrid}>
      <div className={styles.summaryArea}>
      {loadError && <div className={styles.subscriptionError} role="alert">{loadError}<button className={styles.retryButton} disabled={loading} onClick={() => setLoadAttempt(n => n + 1)}>重試載入</button></div>}
      <section className={styles.balanceCard} aria-label="本月收支摘要">
        <span className={styles.balanceLabel}>本月結餘 <span className={styles.currencyTag}>{dashboardBaseCurrency}</span></span>
        <strong className={styles.balanceValue}>{summary.balance.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</strong>
        <p className={styles.balanceHint}>截至 {today} 的實際收入減支出 · {summary.count} 筆交易</p>
        <div className={styles.cashFlow}>
          <div><span>收入</span><strong>{formatMoney(summary.income)}</strong></div>
          <div><span>支出</span><strong>{formatMoney(summary.expense)}</strong></div>
        </div>
      </section>
      <div className={styles.quickActions}>
        <button type="button" onClick={() => navigate('/transaction')}><Plus size={18} aria-hidden="true" />記一筆</button>
        <button type="button" onClick={() => navigate('/analysis')}><ChartNoAxesCombined size={18} aria-hidden="true" />收支分析</button>
      </div>
      <p className={styles.currencyScope}>統計僅含 {dashboardBaseCurrency}，其他幣別分開列示，不作匯率換算。</p>

      {foreignCurrencySummaries.length ? (
        <div className={styles.foreignCurrencyNotice} role="status">
          <strong>其他幣別未計入上述統計</strong>
          {foreignCurrencySummaries.map(item => (
            <span key={item.currency}>
              {item.currency}：收入 {formatMoney(item.income, item.currency)}、支出 {formatMoney(item.expense, item.currency)}、{item.count} 筆
            </span>
          ))}
        </div>
      ) : null}

      {subscriptionProcessingError ? (
        <div className={styles.subscriptionError} role="alert" aria-live="polite">
          <div>
            <p className={styles.subscriptionErrorTitle}>部分訂閱未能自動入帳</p>
            <p className={styles.subscriptionErrorReason}>原因：{subscriptionProcessingError}</p>
          </div>
          <button
            className={styles.retryButton}
            type="button"
            disabled={subscriptionsProcessing}
            onClick={() => void retry().catch(() => undefined)}
          >
            {subscriptionsProcessing ? '重試中…' : '安全重試'}
          </button>
        </div>
      ) : null}

      </div>
      <div className={styles.budgetArea}>
      {budgetNotice && <p className={styles.helperText} role="status">{budgetNotice}</p>}
      <Card title="月預算進度" action={{label: monthlyBudget > 0 ? '調整預算' : '設定預算', onClick: () => setBudgetMonth(month)}}>
        {monthlyBudget > 0 ? (
          <>
            <div className={styles.cardHeaderRow}>
              <span className={styles.cardHeadline}>{formatMoney(summary.expense)}</span>
              <span className={[styles.statusPill, pillClass(budgetProgress)].join(' ')}>
                {formatPercent(budgetProgress)}
              </span>
            </div>
            <div className={styles.progressTrack}>
              <div className={[styles.progressFill, fillClass(budgetProgress)].join(' ')}
                style={{width: `${clampPercent(budgetProgress) * 100}%`}} />
            </div>
            <p className={styles.helperText}>
              本月預算 {formatMoney(monthlyBudget)}，
              已花費 {formatMoney(summary.expense)}，{budgetRemaining >= 0 ? `剩餘 ${formatMoney(budgetRemaining)}` : `已超支 ${formatMoney(Math.abs(budgetRemaining))}`}
            </p>
            {categoryBudgets.length > 0 && (
              <details className={styles.categoryBudgetList}>
                <summary>查看 {categoryBudgets.length} 個分類預算</summary>
                {categoryBudgets.map(b => {
                  return (
                    <div key={b.category} className={styles.categoryBudgetRow}>
                      <div className={styles.categoryBudgetHeader}>
                        <span className={styles.categoryBudgetName}>{b.category}</span>
                        <span className={styles.categoryBudgetMeta}>
                          已花費 {formatMoney(b.spent)} / {formatMoney(b.budgetAmount)}
                        </span>
                        <span className={[styles.statusPill, pillClass(b.usedRatio)].join(' ')}>
                          已用 {b.usedPercentage}%
                        </span>
                      </div>
                      <div className={styles.progressTrackThin} role="progressbar" aria-label={`${b.category}預算使用率 ${b.usedPercentage}%`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(b.usedPercentage, 100)}>
                        <div className={[styles.progressFill, fillClass(b.usedRatio)].join(' ')}
                          style={{width: `${clampPercent(b.usedRatio) * 100}%`}} />
                      </div>
                      <p className={styles.helperText}>未來交易 {formatMoney(b.future)} · 待扣訂閱 {formatMoney(b.pending ?? 0)} · {b.projectedRemaining !== null && (b.projectedRemaining >= 0 ? `預計剩餘 ${formatMoney(b.projectedRemaining)}` : `預計超支 ${formatMoney(Math.abs(b.projectedRemaining))}`)}</p>
                    </div>
                  );
                })}
              </details>
            )}
          </>
        ) : (
          <p className={styles.empty}>尚未設定月預算。設定後，這裡會顯示本月支出進度。</p>
        )}
      </Card>

      </div>
      <div className={styles.commitmentsArea}><MonthlyCommitments spending={spending} budgets={budgets} /></div>
      <div className={styles.recentArea}>
      <Card title="最近 3 筆已發生交易" action={{label: '全部 ›', onClick: () => navigate('/transactions')}}>
        {recentTransactions.length ? recentTransactions.map(t => (
          <div key={t.id} className={styles.row}>
            <div className={styles.rowText}>
              <span className={styles.rowTitle}>{t.note || t.category}</span>
              <span className={styles.rowMeta}>{t.date} · {t.paymentMethod || '未指定付款方式'}</span>
            </div>
            <span className={[styles.amount, t.type === 'income' ? styles.income : styles.expense].join(' ')}>
              {t.type === 'income' ? '+' : '-'}{formatMoney(t.amount, normalizeCurrency(t.currency))}
            </span>
          </div>
        )) : (
          <p className={styles.empty}>尚未新增交易。新增第一筆後，這裡會顯示最近紀錄。</p>
        )}
      </Card>

      </div>
      {categoryAlerts.length > 0 ? <div className={styles.alertArea}><Card title="分類預算提醒">
        {categoryAlerts.length > 0 ? categoryAlerts.map(alert => (
          <div key={alert.category} className={styles.row}>
            <div className={styles.rowText}>
              <span className={styles.rowTitle}>{alert.category}</span>
              <span className={styles.rowMeta}>
                {alertLabel(alert.ratio)} · 已花費 {formatMoney(alert.spent)}
                {alert.future ? ` + 未來交易 ${formatMoney(alert.future)}` : ''}
                {alert.pending ? ` + 待扣訂閱 ${formatMoney(alert.pending)}` : ''} / {formatMoney(alert.budgetAmount)}
              </span>
            </div>
            <span className={[styles.statusPill, pillClass(alert.ratio)].join(' ')}>
              {formatPercent(alert.ratio)}
            </span>
          </div>
        )) : (
          <p className={styles.empty}>所有分類支出均在安全範圍內。</p>
        )}
      </Card></div> : null}

      <div className={styles.spendingArea}><Card title="大額支出留意">
        {unusualTransactions.length ? unusualTransactions.map(t => (
          <div key={t.id} className={styles.row}>
            <div className={styles.rowText}>
              <span className={styles.rowTitle}>{t.note || t.category}</span>
              <span className={styles.rowMeta}>{t.date} · 高於平均單筆支出</span>
            </div>
            <span className={[styles.amount, styles.expense].join(' ')}>-{formatMoney(t.amount, normalizeCurrency(t.currency))}</span>
          </div>
        )) : largestExpense ? (
          <div className={styles.row}>
            <div className={styles.rowText}>
              <span className={styles.rowTitle}>暫無明顯異常</span>
              <span className={styles.rowMeta}>本月最高單筆：{largestExpense.note || largestExpense.category}</span>
            </div>
            <span className={[styles.amount, styles.expense].join(' ')}>-{formatMoney(largestExpense.amount)}</span>
          </div>
        ) : (
          <p className={styles.empty}>本月還沒有支出資料，新增交易後會自動提示大額消費。</p>
        )}
      </Card>

      </div>
      <div className={styles.goalsArea}><Card title="儲蓄目標進度">
        {totalGoalTarget > 0 ? (
          <>
            <div className={styles.cardHeaderRow}>
              <span className={styles.cardHeadline}>{formatMoney(totalGoalSaved)}</span>
              <span className={[styles.statusPill, styles.safePill].join(' ')}>{formatPercent(goalProgress)}</span>
            </div>
            <div className={styles.progressTrack}>
              <div className={[styles.progressFill, styles.safeFill].join(' ')}
                style={{width: `${clampPercent(goalProgress) * 100}%`}} />
            </div>
            <p className={styles.helperText}>
              目標總額 {formatMoney(totalGoalTarget)}
              {focusGoal ? ` · 最接近完成：${focusGoal.name}` : ''}
            </p>
          </>
        ) : (
          <p className={styles.empty}>尚未建立儲蓄目標。新增目標後，首頁會追蹤完成進度。</p>
        )}
      </Card>


      </div>
      {backupOverdue ? (
        <div className={styles.backupArea}>
        <Card title="資料備份提醒" action={{label: '去備份 ›', onClick: () => navigate('/profile')}}>
          <p className={styles.helperText}>此裝置已超過 30 天沒有匯出完整 JSON 備份。花 30 秒到個人頁按一下，資料多一份保障。</p>
        </Card>
        </div>
      ) : null}
      </div>
      {budgetMonth && <BudgetEditor initialMonth={budgetMonth} onClose={() => setBudgetMonth(null)} onSaved={result => {
        budgetRevision.current++;
        if (result.month === month) setBudgets(buildBudgetRows(result.budgets, result.month));
        setBudgetNotice(`${result.month} 預算已儲存。`);
      }} />}
    </Screen>
  );
}
