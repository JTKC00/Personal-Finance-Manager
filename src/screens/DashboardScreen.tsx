import {useEffect, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {Card} from '../components/Card';
import {Screen} from '../components/Screen';
import {
  getCurrentMonthKey,
  getMonthlySummary,
  getSubscriptionChargesForMonth,
  getTransactionsByMonth,
  loadBudgetRows,
  loadGoals,
  loadSubscriptions,
} from '../services/storage';
import {sumExpensesByCategory, sumSubscriptionChargesByCategory} from '../services/financeLogic';
import {getLastBackupAt, isBackupOverdue} from '../services/backupReminder';
import {roundMoney, sumMoney} from '../services/money';
import {Budget, Goal, Subscription, Transaction} from '../types/finance';
import styles from './DashboardScreen.module.css';

type Summary = {
  income: number;
  expense: number;
  balance: number;
  count: number;
};

const emptySummary: Summary = {income: 0, expense: 0, balance: 0, count: 0};
const formatMoney = (value: number) => `$${value.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
const formatPercent = (value: number) => `${Math.round(value * 100)}%`;
const clampPercent = (value: number) => Math.min(Math.max(value, 0), 1);

export function DashboardScreen() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const month = getCurrentMonthKey();

  useEffect(() => {
    let active = true;
    async function load() {
      const [nextSummary, nextTransactions, nextBudgets, nextGoals, nextSubscriptions] = await Promise.all([
        getMonthlySummary(month),
        getTransactionsByMonth(month),
        loadBudgetRows(),
        loadGoals(),
        loadSubscriptions()
      ]);
      if (!active) return;
      setSummary(nextSummary);
      setTransactions(nextTransactions);
      setBudgets(nextBudgets);
      setGoals(nextGoals);
      setSubscriptions(nextSubscriptions);
      setRecentTransactions(
        [...nextTransactions]
          .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
          .slice(0, 3)
      );
    }
    load();
    return () => { active = false; };
  }, [month]);

  const metrics: [string, string][] = [
    ['本月收入', formatMoney(summary.income)],
    ['本月支出', formatMoney(summary.expense)],
    ['結餘', formatMoney(summary.balance)],
    ['交易筆數', String(summary.count)]
  ];
  const monthlyBudget = sumMoney(budgets.map(item => item.amount));
  const expenseTransactions = transactions.filter(item => item.type === 'expense');
  const upcomingSubscriptionCharges = getSubscriptionChargesForMonth(
    subscriptions,
    month,
    transactions,
    new Date().toISOString().slice(0, 10),
    true
  );
  const reservedSubscriptionTotal = sumMoney(upcomingSubscriptionCharges.map(item => item.amount));
  const projectedExpense = roundMoney(summary.expense + reservedSubscriptionTotal);
  const budgetProgress = monthlyBudget > 0 ? summary.expense / monthlyBudget : 0;
  const projectedBudgetProgress = monthlyBudget > 0 ? projectedExpense / monthlyBudget : 0;
  const budgetRemaining = roundMoney(monthlyBudget - summary.expense);
  const projectedBudgetRemaining = roundMoney(monthlyBudget - projectedExpense);
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

  const categorySpending = sumExpensesByCategory(transactions);
  const categoryReserved = sumSubscriptionChargesByCategory(upcomingSubscriptionCharges);

  const categoryAlerts = budgets
    .filter(b => b.amount > 0)
    .map(b => {
      const spent = categorySpending[b.category] || 0;
      const reserved = categoryReserved[b.category] || 0;
      return {...b, spent, reserved, ratio: roundMoney(spent + reserved) / b.amount};
    })
    .filter(alert => alert.ratio >= 0.75)
    .sort((a, b) => b.ratio - a.ratio);

  const alertLabel = (ratio: number) =>
    ratio >= 1 ? '⚠️ 已超出預算' : ratio >= 0.9 ? '⚠️ 已達 90%' : '⚠️ 已達 75%';

  const pillClass = (p: number) =>
    p >= 0.9 ? styles.dangerPill : p >= 0.7 ? styles.warningPill : styles.safePill;
  const fillClass = (p: number) =>
    p >= 0.9 ? styles.dangerFill : p >= 0.7 ? styles.warningFill : styles.safeFill;

  const backupOverdue = isBackupOverdue(getLastBackupAt());

  return (
    <Screen title="首頁" subtitle={`${month} 月現金流與重點提醒`}>
      <div className={styles.grid}>
        {metrics.map(([label, value]) => (
          <div key={label} className={styles.metric}>
            <span className={styles.label}>{label}</span>
            <span className={styles.value}>{value}</span>
          </div>
        ))}
      </div>

      {backupOverdue ? (
        <Card title="🛡️ 該做備份了" action={{label: '去備份 ›', onClick: () => navigate('/profile')}}>
          <p className={styles.helperText}>此裝置已超過 30 天沒有匯出完整 JSON 備份。花 30 秒到個人頁按一下，資料多一份保障。</p>
        </Card>
      ) : null}

      <Card title="月預算進度">
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
              {budgetRemaining >= 0 ? `剩餘 ${formatMoney(budgetRemaining)}` : `已超支 ${formatMoney(Math.abs(budgetRemaining))}`}
            </p>
            {reservedSubscriptionTotal > 0 ? (
              <div className={styles.reserveBox}>
                <div className={styles.cardHeaderRow}>
                  <span className={styles.reserveTitle}>本月固定開支預留</span>
                  <span className={[styles.statusPill, pillClass(projectedBudgetProgress)].join(' ')}>
                    {formatPercent(clampPercent(projectedBudgetProgress))}
                  </span>
                </div>
                <p className={styles.helperText}>
                  尚未扣款訂閱 {formatMoney(reservedSubscriptionTotal)}，
                  預計本月支出 {formatMoney(projectedExpense)}，
                  {projectedBudgetRemaining >= 0
                    ? `預計剩餘 ${formatMoney(projectedBudgetRemaining)}`
                    : `預計超支 ${formatMoney(Math.abs(projectedBudgetRemaining))}`}
                </p>
              </div>
            ) : null}
            {budgets.length > 0 && (
              <div className={styles.categoryBudgetList}>
                {budgets.map(b => {
                  const spent = categorySpending[b.category] || 0;
                  const reserved = categoryReserved[b.category] || 0;
                  const projected = roundMoney(spent + reserved);
                  const ratio = b.amount > 0 ? projected / b.amount : 0;
                  return (
                    <div key={b.category} className={styles.categoryBudgetRow}>
                      <div className={styles.categoryBudgetHeader}>
                        <span className={styles.categoryBudgetName}>{b.category}</span>
                        <span className={styles.categoryBudgetMeta}>
                          {formatMoney(spent)}{reserved ? ` + ${formatMoney(reserved)}` : ''} / {formatMoney(b.amount)}
                        </span>
                        <span className={[styles.statusPill, pillClass(ratio)].join(' ')}>
                          {formatPercent(clampPercent(ratio))}
                        </span>
                      </div>
                      <div className={styles.progressTrackThin}>
                        <div className={[styles.progressFill, fillClass(ratio)].join(' ')}
                          style={{width: `${clampPercent(ratio) * 100}%`}} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <p className={styles.empty}>尚未設定月預算。設定後，這裡會顯示本月支出進度。</p>
        )}
      </Card>

      <Card title="分類預算提醒">
        {categoryAlerts.length > 0 ? categoryAlerts.map(alert => (
          <div key={alert.category} className={styles.row}>
            <div className={styles.rowText}>
              <span className={styles.rowTitle}>{alert.category}</span>
              <span className={styles.rowMeta}>
                {alertLabel(alert.ratio)}&ensp;{formatMoney(alert.spent)}
                {alert.reserved ? ` + 預留 ${formatMoney(alert.reserved)}` : ''} / {formatMoney(alert.amount)}
              </span>
            </div>
            <span className={[styles.statusPill, pillClass(alert.ratio)].join(' ')}>
              {formatPercent(clampPercent(alert.ratio))}
            </span>
          </div>
        )) : (
          <p className={styles.empty}>所有分類支出均在安全範圍內。</p>
        )}
      </Card>

      <Card title="異常消費提醒">
        {unusualTransactions.length ? unusualTransactions.map(t => (
          <div key={t.id} className={styles.row}>
            <div className={styles.rowText}>
              <span className={styles.rowTitle}>{t.note || t.category}</span>
              <span className={styles.rowMeta}>{t.date} · 高於平均單筆支出</span>
            </div>
            <span className={[styles.amount, styles.expense].join(' ')}>-{formatMoney(t.amount)}</span>
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

      <Card title="儲蓄目標進度">
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

      <Card title="最近 3 筆交易" action={{label: '全部 ›', onClick: () => navigate('/transactions')}}>
        {recentTransactions.length ? recentTransactions.map(t => (
          <div key={t.id} className={styles.row}>
            <div className={styles.rowText}>
              <span className={styles.rowTitle}>{t.note || t.category}</span>
              <span className={styles.rowMeta}>{t.date} · {t.paymentMethod || '未指定付款方式'}</span>
            </div>
            <span className={[styles.amount, t.type === 'income' ? styles.income : styles.expense].join(' ')}>
              {t.type === 'income' ? '+' : '-'}{formatMoney(t.amount)}
            </span>
          </div>
        )) : (
          <p className={styles.empty}>尚未新增交易。新增第一筆後，這裡會顯示最近紀錄。</p>
        )}
      </Card>
    </Screen>
  );
}
