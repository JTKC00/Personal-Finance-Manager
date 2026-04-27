import {useEffect, useMemo, useState} from 'react';
import {
  Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts';
import {Card} from '../components/Card';
import {Screen} from '../components/Screen';
import {getCurrentMonthKey, getTransactionsByMonth, loadBudgetRows} from '../services/storage';
import {Budget, Transaction} from '../types/finance';
import styles from './AnalysisScreen.module.css';

const CATEGORY_COLORS = [
  '#4F46E5', '#7C3AED', '#0EA5E9', '#059669',
  '#D97706', '#DC2626', '#DB2777', '#0891B2'
];

const formatMoney = (v: number) => `$${Math.round(v).toLocaleString()}`;
const formatPercent = (v: number) => `${Math.round(v * 100)}%`;
const formatDelta = (v: number) => `${v >= 0 ? '+' : '-'}${formatMoney(Math.abs(v))}`;

function shiftMonth(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split('-').map(Number);
  const d = new Date(year, month - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return `${year} 年 ${month} 月`;
}

function getShortMonthLabel(monthKey: string): string {
  const [, month] = monthKey.split('-').map(Number);
  return `${month}月`;
}

function getDaysInMonth(monthKey: string): number {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(year, month, 0).getDate();
}

function getMonthRange(endMonth: string, count: number): string[] {
  return Array.from({length: count}, (_, index) => shiftMonth(endMonth, index - count + 1));
}

function getTotals(data: Transaction[]) {
  const income = data.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
  const expense = data.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
  return {income, expense, balance: income - expense};
}

function getExpenseCategoryMap(data: Transaction[]): Record<string, number> {
  const map: Record<string, number> = {};
  data.filter(t => t.type === 'expense').forEach(t => {
    map[t.category] = (map[t.category] || 0) + t.amount;
  });
  return map;
}

export function AnalysisScreen() {
  const currentMonth = getCurrentMonthKey();
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [monthlyTransactions, setMonthlyTransactions] = useState<Record<string, Transaction[]>>({});
  const [budgets, setBudgets] = useState<Budget[]>([]);

  useEffect(() => {
    let active = true;
    loadBudgetRows().then(data => {
      if (active) setBudgets(data);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const months = getMonthRange(selectedMonth, 6);
    Promise.all(months.map(month => getTransactionsByMonth(month))).then(results => {
      if (!active) return;
      const monthMap = Object.fromEntries(
        months.map((month, index) => [month, results[index]])
      );
      setMonthlyTransactions(monthMap);
      setTransactions(monthMap[selectedMonth] || []);
    });
    return () => { active = false; };
  }, [selectedMonth]);

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
  const monthlyBudget = budgets.reduce((sum, item) => sum + item.amount, 0);
  const projectedExpense = selectedMonth === currentMonth
    ? (expense / (activeDays || 1)) * daysInMonth
    : expense;

  const categoryMap = useMemo(() => getExpenseCategoryMap(transactions), [transactions]);

  const pieData = useMemo(
    () => Object.entries(categoryMap)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value], i) => ({name, value, color: CATEGORY_COLORS[i % CATEGORY_COLORS.length]})),
    [categoryMap]
  );

  const barDays = selectedMonth === currentMonth ? new Date().getDate() : daysInMonth;
  const barData = useMemo(() => {
    const arr = Array(barDays).fill(0);
    transactions.filter(t => t.type === 'expense').forEach(t => {
      const day = parseInt(t.date.split('-')[2], 10) - 1;
      if (day >= 0 && day < barDays) arr[day] += t.amount;
    });
    return arr.map((amount, i) => ({day: String(i + 1), amount: Math.round(amount)}));
  }, [transactions, barDays]);

  const hasBarData = barData.some(d => d.amount > 0);

  const trendData = useMemo(() => {
    return getMonthRange(selectedMonth, 6).map(month => {
      const totals = getTotals(monthlyTransactions[month] || []);
      return {
        month,
        label: getShortMonthLabel(month),
        income: Math.round(totals.income),
        expense: Math.round(totals.expense),
        balance: Math.round(totals.balance)
      };
    });
  }, [monthlyTransactions, selectedMonth]);
  const hasTrendData = trendData.some(item => item.income || item.expense);

  const previousMonth = shiftMonth(selectedMonth, -1);
  const previousTransactions = monthlyTransactions[previousMonth] || [];
  const previousTotals = useMemo(() => getTotals(previousTransactions), [previousTransactions]);
  const previousSavingsRate = previousTotals.income > 0
    ? Math.max(0, previousTotals.balance / previousTotals.income)
    : null;
  const previousCategoryMap = useMemo(() => getExpenseCategoryMap(previousTransactions), [previousTransactions]);

  const categoryChanges = useMemo(() => {
    const categories = new Set([...Object.keys(categoryMap), ...Object.keys(previousCategoryMap)]);
    return [...categories]
      .map(category => {
        const current = categoryMap[category] || 0;
        const previous = previousCategoryMap[category] || 0;
        return {category, current, previous, delta: current - previous};
      })
      .filter(item => item.current > 0 || item.previous > 0)
      .sort((a, b) => b.delta - a.delta || b.current - a.current)
      .slice(0, 5);
  }, [categoryMap, previousCategoryMap]);

  const insights = useMemo(() => {
    const next: {title: string; detail: string; tone: 'danger' | 'warning' | 'safe'}[] = [];

    if (selectedMonth === currentMonth && monthlyBudget > 0 && projectedExpense > monthlyBudget) {
      next.push({
        title: '月底可能超出預算',
        detail: `按目前日均支出推算，月底約 ${formatMoney(projectedExpense)}，比預算多 ${formatMoney(projectedExpense - monthlyBudget)}。`,
        tone: 'danger'
      });
    }

    if (previousSavingsRate !== null && previousTotals.income > 0 && savingsRate < previousSavingsRate) {
      next.push({
        title: '儲蓄率比上月下降',
        detail: `本月儲蓄率 ${formatPercent(savingsRate)}，比上月低 ${formatPercent(previousSavingsRate - savingsRate)}。`,
        tone: 'warning'
      });
    }

    const biggestIncrease = categoryChanges.find(item => item.delta > 0);
    if (biggestIncrease) {
      next.push({
        title: `${biggestIncrease.category} 支出增加最多`,
        detail: biggestIncrease.previous > 0
          ? `本月比上月多 ${formatMoney(biggestIncrease.delta)}，目前為 ${formatMoney(biggestIncrease.current)}。`
          : `上月沒有此分類支出，本月已花 ${formatMoney(biggestIncrease.current)}。`,
        tone: 'warning'
      });
    }

    if (!next.length && transactions.length > 0) {
      next.push({
        title: '本月暫時平穩',
        detail: '目前未看到明顯超支或分類支出急升，繼續保持記錄。',
        tone: 'safe'
      });
    }

    return next.slice(0, 3);
  }, [
    categoryChanges,
    currentMonth,
    monthlyBudget,
    previousSavingsRate,
    previousTotals.income,
    projectedExpense,
    savingsRate,
    selectedMonth,
    transactions.length
  ]);

  return (
    <Screen title="分析" subtitle={getMonthLabel(selectedMonth)}>
      <div className={styles.monthNav}>
        <button className={styles.navBtn} onClick={() => setSelectedMonth(m => shiftMonth(m, -1))}>
          ‹ 上月
        </button>
        <span className={styles.monthLabel}>{getMonthLabel(selectedMonth)}</span>
        <button
          className={styles.navBtn}
          disabled={selectedMonth >= currentMonth}
          onClick={() => setSelectedMonth(m => shiftMonth(m, 1))}
        >
          下月 ›
        </button>
      </div>

      <div className={styles.grid}>
        {([
          ['總收入', formatMoney(income), 'var(--color-success)'],
          ['總支出', formatMoney(expense), 'var(--color-danger)'],
          ['儲蓄率', formatPercent(savingsRate), 'var(--color-text)'],
          ['日均支出', formatMoney(avgDailyExpense), 'var(--color-text)']
        ] as [string, string, string][]).map(([label, value, color]) => (
          <div key={label} className={styles.metric}>
            <span className={styles.metricLabel}>{label}</span>
            <span className={styles.metricValue} style={{color}}>{value}</span>
          </div>
        ))}
      </div>

      <Card title="本月洞察">
        {insights.length ? (
          <div className={styles.insightList}>
            {insights.map(item => (
              <div key={item.title} className={[styles.insightRow, styles[item.tone]].join(' ')}>
                <span className={styles.insightTitle}>{item.title}</span>
                <span className={styles.insightDetail}>{item.detail}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className={styles.empty}>累積更多交易後會產生洞察。</p>
        )}
      </Card>

      <Card title="6 個月收支趨勢">
        {hasTrendData ? (
          <div className={styles.chartWrap}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={trendData} margin={{top: 8, right: 0, left: -20, bottom: 0}}>
                <XAxis dataKey="label" tick={{fontSize: 10}} />
                <YAxis tick={{fontSize: 10}} />
                <Tooltip formatter={(v: number) => formatMoney(v)} labelFormatter={(_, payload) => (
                  payload?.[0]?.payload?.month ? getMonthLabel(payload[0].payload.month) : ''
                )} />
                <Bar dataKey="income" name="收入" fill="var(--color-success)" radius={[2,2,0,0]} />
                <Bar dataKey="expense" name="支出" fill="var(--color-danger)" radius={[2,2,0,0]} />
                <Bar dataKey="balance" name="結餘" fill="var(--color-text-muted)" radius={[2,2,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className={styles.empty}>暫無跨月交易資料。</p>
        )}
      </Card>

      <Card title="支出分類分佈">
        {pieData.length > 0 ? (
          <>
            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}>
                    {pieData.map(entry => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatMoney(v)} />
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
                    {expense > 0 ? `${Math.round((item.value / expense) * 100)}%` : ''}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className={styles.empty}>本月尚無支出資料。</p>
        )}
      </Card>

      <Card title="分類變化">
        {categoryChanges.length ? (
          <div className={styles.changeList}>
            {categoryChanges.map(item => (
              <div key={item.category} className={styles.changeRow}>
                <div className={styles.changeMain}>
                  <span className={styles.changeTitle}>{item.category}</span>
                  <span className={styles.changeMeta}>
                    本月 {formatMoney(item.current)}
                    {item.previous > 0 ? ` · 上月 ${formatMoney(item.previous)}` : ' · 上月無資料'}
                  </span>
                </div>
                <span className={[
                  styles.changeDelta,
                  item.delta >= 0 ? styles.deltaUp : styles.deltaDown
                ].join(' ')}>
                  {formatDelta(item.delta)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className={styles.empty}>本月尚無分類支出可比較。</p>
        )}
      </Card>

      <Card title="每日支出趨勢">
        {hasBarData ? (
          <div className={styles.chartWrap}>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={barData} margin={{top: 4, right: 0, left: -20, bottom: 0}}>
                <XAxis dataKey="day" tick={{fontSize: 10}} interval={4} />
                <YAxis tick={{fontSize: 10}} />
                <Tooltip formatter={(v: number) => formatMoney(v)} />
                <Bar dataKey="amount" fill="var(--color-danger)" radius={[2,2,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className={styles.empty}>本月尚無支出資料。</p>
        )}
      </Card>
    </Screen>
  );
}
