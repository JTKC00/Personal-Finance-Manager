import {useCallback, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {Card} from '../components/Card';
import {Screen} from '../components/Screen';
import {getCurrentMonthKey, getMonthlySummary, getTransactionsByMonth, loadBudgetRows, loadGoals} from '../services/storage';
import {colors, spacing} from '../theme';
import {Budget, Goal, Transaction} from '../types/finance';

type Summary = {
  income: number;
  expense: number;
  balance: number;
  count: number;
};

const emptySummary: Summary = {
  income: 0,
  expense: 0,
  balance: 0,
  count: 0
};

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

  useFocusEffect(
    useCallback(() => {
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
      return () => {
        active = false;
      };
    }, [month])
  );

  const metrics = [
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

  return (
    <Screen title="首頁" subtitle={`${month} 月現金流與重點提醒`}>
      <View style={styles.grid}>
        {metrics.map(([label, value]) => (
          <View key={label} style={styles.metric}>
            <Text style={styles.label}>{label}</Text>
            <Text style={styles.value}>{value}</Text>
          </View>
        ))}
      </View>

      <Card title="月預算進度">
        {monthlyBudget > 0 ? (
          <>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardHeadline}>{formatMoney(summary.expense)}</Text>
              <Text style={[styles.statusPill, budgetProgress >= 0.9 ? styles.dangerPill : budgetProgress >= 0.7 ? styles.warningPill : styles.safePill]}>
                {formatPercent(budgetProgress)}
              </Text>
            </View>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  budgetProgress >= 0.9 ? styles.dangerFill : budgetProgress >= 0.7 ? styles.warningFill : styles.safeFill,
                  {width: `${clampPercent(budgetProgress) * 100}%`}
                ]}
              />
            </View>
            <Text style={styles.helperText}>
              本月預算 {formatMoney(monthlyBudget)}，{budgetRemaining >= 0 ? `剩餘 ${formatMoney(budgetRemaining)}` : `已超支 ${formatMoney(Math.abs(budgetRemaining))}`}
            </Text>
          </>
        ) : (
          <Text style={styles.empty}>尚未設定月預算。設定後，這裡會顯示本月支出進度。</Text>
        )}
      </Card>

      <Card title="異常消費提醒">
        {unusualTransactions.length ? unusualTransactions.map(transaction => (
          <View key={transaction.id} style={styles.alertRow}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{transaction.note || transaction.category}</Text>
              <Text style={styles.rowMeta}>{transaction.date} · 高於平均單筆支出</Text>
            </View>
            <Text style={[styles.amount, styles.expense]}>-{formatMoney(transaction.amount)}</Text>
          </View>
        )) : largestExpense ? (
          <View style={styles.alertRow}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>暫無明顯異常</Text>
              <Text style={styles.rowMeta}>本月最高單筆：{largestExpense.note || largestExpense.category}</Text>
            </View>
            <Text style={[styles.amount, styles.expense]}>-{formatMoney(largestExpense.amount)}</Text>
          </View>
        ) : (
          <Text style={styles.empty}>本月還沒有支出資料，新增交易後會自動提示大額消費。</Text>
        )}
      </Card>

      <Card title="儲蓄目標進度">
        {totalGoalTarget > 0 ? (
          <>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardHeadline}>{formatMoney(totalGoalSaved)}</Text>
              <Text style={[styles.statusPill, styles.safePill]}>{formatPercent(goalProgress)}</Text>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, styles.safeFill, {width: `${clampPercent(goalProgress) * 100}%`}]} />
            </View>
            <Text style={styles.helperText}>
              目標總額 {formatMoney(totalGoalTarget)}
              {focusGoal ? ` · 最接近完成：${focusGoal.name}` : ''}
            </Text>
          </>
        ) : (
          <Text style={styles.empty}>尚未建立儲蓄目標。新增目標後，首頁會追蹤完成進度。</Text>
        )}
      </Card>

      <Card title="最近 3 筆交易">
        {recentTransactions.length ? recentTransactions.map(transaction => (
          <View key={transaction.id} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{transaction.note || transaction.category}</Text>
              <Text style={styles.rowMeta}>{transaction.date} · {transaction.paymentMethod || '未指定付款方式'}</Text>
            </View>
            <Text style={[styles.amount, transaction.type === 'income' ? styles.income : styles.expense]}>
              {transaction.type === 'income' ? '+' : '-'}{formatMoney(transaction.amount)}
            </Text>
          </View>
        )) : (
          <Text style={styles.empty}>尚未新增交易。新增第一筆後，這裡會顯示最近紀錄。</Text>
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md
  },
  metric: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 8,
    padding: spacing.md,
    width: '48%'
  },
  label: {
    color: colors.textMuted,
    fontSize: 12
  },
  value: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '600',
    marginTop: 4
  },
  cardHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md
  },
  cardHeadline: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700'
  },
  statusPill: {
    borderRadius: 8,
    fontSize: 13,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4
  },
  safePill: {
    backgroundColor: 'rgba(59,109,17,0.12)',
    color: colors.success
  },
  warningPill: {
    backgroundColor: 'rgba(133,79,11,0.14)',
    color: colors.warning
  },
  dangerPill: {
    backgroundColor: 'rgba(163,45,45,0.12)',
    color: colors.danger
  },
  progressTrack: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 8,
    height: 12,
    overflow: 'hidden'
  },
  progressFill: {
    borderRadius: 8,
    height: '100%'
  },
  safeFill: {
    backgroundColor: colors.success
  },
  warningFill: {
    backgroundColor: colors.warning
  },
  dangerFill: {
    backgroundColor: colors.danger
  },
  helperText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: spacing.sm
  },
  alertRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm
  },
  row: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm
  },
  rowText: {
    flex: 1,
    paddingRight: spacing.md
  },
  rowTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600'
  },
  rowMeta: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2
  },
  amount: {
    fontSize: 14,
    fontWeight: '600'
  },
  income: {
    color: colors.success
  },
  expense: {
    color: colors.danger
  },
  empty: {
    color: colors.textMuted,
    lineHeight: 20
  }
});
