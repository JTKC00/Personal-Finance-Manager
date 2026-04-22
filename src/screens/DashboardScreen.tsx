import {Text, View, StyleSheet} from 'react-native';
import {Card} from '../components/Card';
import {Screen} from '../components/Screen';
import {colors, spacing} from '../theme';

const metrics = [
  ['本月收入', '$0'],
  ['本月支出', '$0'],
  ['結餘', '$0'],
  ['交易筆數', '0']
];

export function DashboardScreen() {
  return (
    <Screen title="首頁" subtitle="月預算、今日花費、目標與最近交易">
      <View style={styles.grid}>
        {metrics.map(([label, value]) => (
          <View key={label} style={styles.metric}>
            <Text style={styles.label}>{label}</Text>
            <Text style={styles.value}>{value}</Text>
          </View>
        ))}
      </View>
      <Card title="MVP 摘要">
        <Text style={styles.body}>下一步會把 HTML 原型的 localStorage 資料層搬到 AsyncStorage service，並接上首頁聚合查詢。</Text>
      </Card>
      <Card title="提醒">
        <Text style={styles.body}>70% App 內提示、90% 推送模擬、超支警示會共用 budget service。</Text>
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
  body: {
    color: colors.text,
    lineHeight: 20
  }
});
