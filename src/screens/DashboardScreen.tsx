import {useCallback, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {Card} from '../components/Card';
import {Screen} from '../components/Screen';
import {getCurrentMonthKey, getMonthlySummary, getTransactionsByMonth} from '../services/storage';
import {colors, spacing} from '../theme';
import {Transaction} from '../types/finance';

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

export function DashboardScreen() {
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>([]);
  const month = getCurrentMonthKey();

  useFocusEffect(
    useCallback(() => {
      let active = true;

      async function load() {
        const [nextSummary, transactions] = await Promise.all([
          getMonthlySummary(month),
          getTransactionsByMonth(month)
        ]);

        if (!active) return;
        setSummary(nextSummary);
        setRecentTransactions(
          [...transactions]
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

  return (
    <Screen title="首頁" subtitle={`${month} 月預算、花費與最近交易`}>
      <View style={styles.grid}>
        {metrics.map(([label, value]) => (
          <View key={label} style={styles.metric}>
            <Text style={styles.label}>{label}</Text>
            <Text style={styles.value}>{value}</Text>
          </View>
        ))}
      </View>

      <Card title="最近 3 筆交易">
        {recentTransactions.length ? recentTransactions.map(transaction => (
          <View key={transaction.id} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{transaction.note || transaction.category}</Text>
              <Text style={styles.rowMeta}>{transaction.date} · {transaction.paymentMethod || '未填付款方式'}</Text>
            </View>
            <Text style={[styles.amount, transaction.type === 'income' ? styles.income : styles.expense]}>
              {transaction.type === 'income' ? '+' : '-'}{formatMoney(transaction.amount)}
            </Text>
          </View>
        )) : (
          <Text style={styles.empty}>尚無交易，先到「記帳」新增一筆。</Text>
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
