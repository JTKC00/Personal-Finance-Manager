import {useEffect, useState} from 'react';
import {Card} from '../components/Card';
import {Screen} from '../components/Screen';
import {getCurrentMonthKey, getMonthlySummary, getTransactionsByMonth, loadBudgetRows, loadGoals} from '../services/storage';
import {Budget, Goal, Transaction} from '../types/finance';
import styles from './DashboardScreen.module.css';

type Summary = {
  income: number;
  expense: number;
  balance: number;
  count: number;
};

const emptySummary: Summary = {income: 0, expense: 0, balance: 0, count: 0};
const formatMoney = (value: number) => `$${Math.round(value).toLocaleString()}`;
const formatPercent = (value: number) => `${Math.round(value * 100)}%`;
const clampPercent = (value: number) => Math.min(Math.max(value, 0), 1);

export function DashboardScreen() {
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const month = getCurrentMonthKey();

  useEffect(() => {
    let active = true;
    async function load() {
      const [nextSummary, nextTransactions, nextBudgets, nextGoals] = await Promise.all([
        getMonthlySummary(month),
        getTransactionsByMonth(month),
        loadBudgetRows(),
        loadGoals()
      ]);
      if (!active) return;
      setSummary(nextSummary);
      setTransactions(nextTransactions);
      setBudgets(nextBudgets);
      setGoals(nextGoals);
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
  const monthlyBudget = budgets.reduce((sum, item) => sum + item.amount, 0);
  const budgetProgress = monthlyBudget > 0 ? summary.expense / monthlyBudget : 0;
  const budgetRemaining = monthlyBudget - summary.expense;
  const expenseTransactions = transactions.filter(item => item.type === 'expense');
  const averageExpense = expenseTransactions.length ? summary.expense / expenseTransactions.length : 0;
  const unusualTransactions = expenseTransactions
    .filter(item => averageExpense > 0 && item.amount >= averageExpense * 1.8)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 2);
  const largestExpense = [...expenseTransactions].sort((a, b) => b.amount - a.amount)[0];
  const totalGoalTarget = goals.reduce((sum, item) => sum + item.targetAmount, 0);
  const totalGoalSaved = goals.reduce((sum, item) => sum + item.savedAmount, 0);
  const goalProgress = totalGoalTarget > 0 ? totalGoalSaved / totalGoalTarget : 0;
  const focusGoal = [...goals]
    .filter(item => item.targetAmount > 0)
    .sort((a, b) => (b.savedAmount / b.targetAmount) - (a.savedAmount / a.targetAmount))[0];

  const pillClass = (p: number) =>
    p >= 0.9 ? styles.dangerPill : p >= 0.7 ? styles.warningPill : styles.safePill;
  const fillClass = (p: number) =>
    p >= 0.9 ? styles.dangerFill : p >= 0.7 ? styles.warningFill : styles.safeFill;

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
          </>
        ) : (
          <p className={styles.empty}>尚未設定月預算。設定後，這裡會顯示本月支出進度。</p>
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

      <Card title="最近 3 筆交易">
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
