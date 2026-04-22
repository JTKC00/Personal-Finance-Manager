import {useCallback, useMemo, useState} from 'react';
import {Dimensions, Pressable, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {BarChart, PieChart} from 'react-native-chart-kit';
import {Card} from '../components/Card';
import {Screen} from '../components/Screen';
import {getCurrentMonthKey, getTransactionsByMonth} from '../services/storage';
import {colors, spacing} from '../theme';
import {Transaction} from '../types/finance';

const SCREEN_WIDTH = Dimensions.get('window').width;
const CHART_WIDTH = SCREEN_WIDTH - spacing.lg * 4;

const CATEGORY_COLORS = [
  '#3b6d11', '#a32d2d', '#854f0b', '#1a6d6d',
  '#4a4a8f', '#6d6d1a', '#8f4a4a', '#6d3b6d'
];

const formatMoney = (v: number) => `$${Math.round(v).toLocaleString()}`;
const formatPercent = (v: number) => `${Math.round(v * 100)}%`;

function shiftMonth(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split('-').map(Number);
  const d = new Date(year, month - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return `${year} 年 ${month} 月`;
}

function getDaysInMonth(monthKey: string): number {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(year, month, 0).getDate();
}

const chartConfig = {
  backgroundColor: colors.surface,
  backgroundGradientFrom: colors.surface,
  backgroundGradientTo: colors.surface,
  decimalPlaces: 0,
  color: (opacity = 1) => `rgba(163, 45, 45, ${opacity})`,
  labelColor: () => colors.textMuted,
  barPercentage: 0.55,
  propsForLabels: {fontSize: 10}
};

export function AnalysisScreen() {
  const currentMonth = getCurrentMonthKey();
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      getTransactionsByMonth(selectedMonth).then(data => {
        if (active) setTransactions(data);
      });
      return () => {
        active = false;
      };
    }, [selectedMonth])
  );

  const income = useMemo(
    () => transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0),
    [transactions]
  );
  const expense = useMemo(
    () => transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0),
    [transactions]
  );
  const savingsRate = income > 0 ? Math.max(0, (income - expense) / income) : 0;
  const daysInMonth = getDaysInMonth(selectedMonth);
  const activeDays = selectedMonth === currentMonth ? new Date().getDate() : daysInMonth;
  const avgDailyExpense = expense / (activeDays || 1);

  const categoryMap = useMemo(() => {
    const map: Record<string, number> = {};
    transactions
      .filter(t => t.type === 'expense')
      .forEach(t => {
        map[t.category] = (map[t.category] || 0) + t.amount;
      });
    return map;
  }, [transactions]);

  const pieData = useMemo(
    () =>
      Object.entries(categoryMap)
        .sort((a, b) => b[1] - a[1])
        .map(([name, amount], i) => ({
          name,
          population: amount,
          color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
          legendFontColor: colors.textMuted,
          legendFontSize: 12
        })),
    [categoryMap]
  );

  const barDays = selectedMonth === currentMonth ? new Date().getDate() : daysInMonth;
  const dailyExpense = useMemo(() => {
    const arr = Array(barDays).fill(0);
    transactions
      .filter(t => t.type === 'expense')
      .forEach(t => {
        const day = parseInt(t.date.split('-')[2], 10) - 1;
        if (day >= 0 && day < barDays) arr[day] += t.amount;
      });
    return arr as number[];
  }, [transactions, barDays]);

  const barLabels = Array.from({length: barDays}, (_, i) =>
    (i + 1) % 5 === 1 ? String(i + 1) : ''
  );
  const hasBarData = dailyExpense.some(v => v > 0);

  return (
    <Screen title="分析" subtitle={getMonthLabel(selectedMonth)}>
      <View style={styles.monthNav}>
        <Pressable onPress={() => setSelectedMonth(m => shiftMonth(m, -1))} style={styles.navButton}>
          <Text style={styles.navButtonText}>‹ 上月</Text>
        </Pressable>
        <Text style={styles.monthLabel}>{getMonthLabel(selectedMonth)}</Text>
        <Pressable
          disabled={selectedMonth >= currentMonth}
          onPress={() => setSelectedMonth(m => shiftMonth(m, 1))}
          style={[styles.navButton, selectedMonth >= currentMonth && styles.navButtonDisabled]}
        >
          <Text style={styles.navButtonText}>下月 ›</Text>
        </Pressable>
      </View>

      <View style={styles.grid}>
        {([
          ['總收入', formatMoney(income), colors.success],
          ['總支出', formatMoney(expense), colors.danger],
          ['儲蓄率', formatPercent(savingsRate), colors.text],
          ['日均支出', formatMoney(avgDailyExpense), colors.text]
        ] as [string, string, string][]).map(([label, value, color]) => (
          <View key={label} style={styles.metric}>
            <Text style={styles.metricLabel}>{label}</Text>
            <Text style={[styles.metricValue, {color}]}>{value}</Text>
          </View>
        ))}
      </View>

      <Card title="支出分類分佈">
        {pieData.length > 0 ? (
          <>
            <PieChart
              data={pieData}
              width={CHART_WIDTH}
              height={180}
              chartConfig={chartConfig}
              accessor="population"
              backgroundColor="transparent"
              paddingLeft="8"
              hasLegend={false}
              absolute
            />
            <View style={styles.legend}>
              {pieData.map(item => (
                <View key={item.name} style={styles.legendRow}>
                  <View style={[styles.legendDot, {backgroundColor: item.color}]} />
                  <Text style={styles.legendLabel}>{item.name}</Text>
                  <Text style={styles.legendValue}>{formatMoney(item.population)}</Text>
                  <Text style={styles.legendPct}>
                    {expense > 0 ? `${Math.round((item.population / expense) * 100)}%` : ''}
                  </Text>
                </View>
              ))}
            </View>
          </>
        ) : (
          <Text style={styles.empty}>本月尚無支出資料。</Text>
        )}
      </Card>

      <Card title="每日支出趨勢">
        {hasBarData ? (
          <BarChart
            data={{labels: barLabels, datasets: [{data: dailyExpense}]}}
            width={CHART_WIDTH}
            height={160}
            chartConfig={chartConfig}
            showValuesOnTopOfBars={false}
            withInnerLines={false}
            fromZero
            yAxisLabel=""
            yAxisSuffix=""
          />
        ) : (
          <Text style={styles.empty}>本月尚無支出資料。</Text>
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  monthNav: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md
  },
  navButton: {
    padding: spacing.sm
  },
  navButtonDisabled: {
    opacity: 0.3
  },
  navButtonText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600'
  },
  monthLabel: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600'
  },
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
  metricLabel: {
    color: colors.textMuted,
    fontSize: 12
  },
  metricValue: {
    fontSize: 20,
    fontWeight: '600',
    marginTop: 4
  },
  legend: {
    marginTop: spacing.md
  },
  legendRow: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingVertical: 4
  },
  legendDot: {
    borderRadius: 3,
    height: 10,
    marginRight: spacing.sm,
    width: 10
  },
  legendLabel: {
    color: colors.text,
    flex: 1,
    fontSize: 13
  },
  legendValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    marginRight: spacing.sm
  },
  legendPct: {
    color: colors.textMuted,
    fontSize: 12,
    width: 38,
    textAlign: 'right'
  },
  empty: {
    color: colors.textMuted,
    lineHeight: 20
  }
});
