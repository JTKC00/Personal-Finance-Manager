import {useEffect, useMemo, useState} from 'react';
import {
  Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts';
import {Card} from '../components/Card';
import {Screen} from '../components/Screen';
import {getCurrentMonthKey, getTransactionsByMonth} from '../services/storage';
import {Transaction} from '../types/finance';
import styles from './AnalysisScreen.module.css';

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

export function AnalysisScreen() {
  const currentMonth = getCurrentMonthKey();
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  useEffect(() => {
    let active = true;
    getTransactionsByMonth(selectedMonth).then(data => {
      if (active) setTransactions(data);
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

  const categoryMap = useMemo(() => {
    const map: Record<string, number> = {};
    transactions.filter(t => t.type === 'expense').forEach(t => {
      map[t.category] = (map[t.category] || 0) + t.amount;
    });
    return map;
  }, [transactions]);

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
