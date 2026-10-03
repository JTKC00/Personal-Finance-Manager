import {Card} from './Card';
import {normalizeCurrency} from '../services/financeLogic';
import {buildMonthlyBudgetTotal, type MonthlySpending} from '../services/monthlySpending';
import type {Budget} from '../types/finance';
import styles from './MonthlyCommitments.module.css';

const money = (amount: number, currency: string) => `${currency} ${amount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

export function MonthlyCommitments({spending, budgets}: {spending: MonthlySpending; budgets?: Budget[] | null}) {
  const total = budgets ? buildMonthlyBudgetTotal(budgets, spending) : null;
  return <Card title="本月待發生收支">
    <p className={styles.hint}>未來日期的交易與待扣訂閱分開列示，不計入實際收支。已預填的同筆訂閱不重複預留。</p>
    <div className={styles.currencyList}>{spending.byCurrency.map(row => <section className={styles.currency} key={row.currency} aria-label={`${row.currency} 待發生收支`}>
      <strong>{row.currency}</strong>
      <dl className={styles.metrics}>
        <div><dt>未來交易支出</dt><dd>{money(row.future.expense, row.currency)}</dd></div>
        <div><dt>待扣訂閱</dt><dd>{row.pendingSubscriptionExpense === null ? '未能載入' : money(row.pendingSubscriptionExpense, row.currency)}</dd></div>
        <div><dt>未來交易收入</dt><dd>{money(row.future.income, row.currency)}</dd></div>
        <div><dt>已知支出合計</dt><dd>{row.knownExpense === null ? '暫不可計算' : money(row.knownExpense, row.currency)}</dd></div>
      </dl>
      {row.currency === 'HKD' && total && total.budgetAmount > 0 && <p className={styles.remaining}>
        {total.projectedRemaining === null ? '待扣訂閱尚未載入，暫不可計算預計剩餘預算。'
          : total.projectedRemaining >= 0 ? `預計剩餘預算 ${money(total.projectedRemaining, 'HKD')}`
            : `預計超支 ${money(Math.abs(total.projectedRemaining), 'HKD')}`}
      </p>}
    </section>)}</div>
    <p className={styles.hint}>已知支出合計＝截至 {spending.today} 的已花費＋未來交易支出＋待扣訂閱；不包含尚未記錄的日常消費，也不作匯率換算。</p>
    {spending.futureTransactions.length > 0 && <details className={styles.details}>
      <summary>查看 {spending.futureTransactions.length} 筆未來交易</summary>
      <ul>{spending.futureTransactions.map(t => <li key={t.id}>
        <div><strong>{t.note || t.merchantText || t.merchant || t.category}</strong><span>{t.date} · {t.category}{t.subscriptionId ? ' · 已預填訂閱' : ''}</span></div>
        <strong>{t.type === 'income' ? '+' : '−'}{money(t.amount, normalizeCurrency(t.currency))}</strong>
      </li>)}</ul>
    </details>}
    {spending.pendingCharges === null ? <p className={styles.hint}>訂閱資料未能載入，待扣金額未知。</p>
      : spending.pendingCharges.length > 0 ? <details className={styles.details}>
        <summary>查看 {spending.pendingCharges.length} 筆待扣訂閱</summary>
        <ul>{spending.pendingCharges.map(c => <li key={`${c.subscription.id}:${c.date}`}>
          <div><strong>{c.subscription.name}</strong><span>{c.date} · {c.subscription.category}{c.date < spending.today ? ' · 已到期，未入帳' : c.date === spending.today ? ' · 今日到期，未入帳' : ''}</span></div>
          <strong>{money(c.amount, normalizeCurrency(c.subscription.currency))}</strong>
        </li>)}</ul>
      </details> : <p className={styles.hint}>本月沒有待扣訂閱。</p>}
  </Card>;
}
