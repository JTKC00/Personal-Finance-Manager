import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {Copy, Pencil, Trash2, Search} from 'lucide-react';
import {Card} from '../components/Card';
import {Screen} from '../components/Screen';
import {useTransactionWorkspace} from '../contexts/TransactionWorkspace';
import {expenseCategories, incomeCategories} from '../constants/categories';
import {resolveTransactionMerchantDisplay} from '../services/merchantIdentity';
import {formatInstrumentLabel} from '../services/paymentInstrument';
import {dateKey} from '../services/analysisPeriod';
import {shiftMonthKey} from '../services/comparisonEngine';
import {normalizeCurrency} from '../services/financeLogic';
import {CLEANUP_LABELS, EMPTY_TRANSACTION_FILTERS, cleanupReasons, filterTransactions, resolveTransactionPeriod, transactionCurrencyTotals, type CleanupReason, type TransactionDirectories, type TransactionFilters, type TransactionPeriod} from '../services/transactionManagement';
import {deleteTransactionWithGoalLink, getTransactionsByDateRange, loadAccounts, loadGoals, loadMerchants, loadPaymentInstruments, loadSubscriptions, trackEvent} from '../services/storage';
import type {Transaction} from '../types/finance';
import styles from './TransactionScreen.module.css';

const formatMoney = (value: number) => `$${value.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
type Loaded = {key: string; transactions: Transaction[]; directories: Partial<TransactionDirectories>; errors: string[]; failed?: boolean};
export function TransactionListScreen() {
  const navigate = useNavigate();
  const {list, openEdit} = useTransactionWorkspace();
  const [period, setPeriod] = useState(list.current.period);
  const [filters, setFilters] = useState(list.current.filters);
  const [limit, setLimit] = useState(list.current.limit);
  const [today, setToday] = useState(() => dateKey(new Date()));
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [pending, setPending] = useState(true);
  const [retry, setRetry] = useState(0);
  const [toast, setToast] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deleteBusy = useRef(false);
  const restored = useRef(false);
  const resolved = useMemo(() => { try { return {range: resolveTransactionPeriod(period, today), error: ''}; } catch (e) { return {range: null, error: e instanceof Error ? e.message : '日期無效'}; } }, [period, today]);
  const range = resolved.range;
  const key = JSON.stringify(range);
  useEffect(() => { list.current = {...list.current, period, filters, limit}; }, [list, period, filters, limit]);
  useLayoutEffect(() => {
    const anchor = document.querySelector('[data-transaction-list]');
    const capture = () => { if (restored.current && anchor?.isConnected && anchor.getClientRects().length) list.current.scroll = window.scrollY; };
    window.addEventListener('scroll', capture, {passive: true});
    const timer = window.setInterval(() => setToday(dateKey(new Date())), 60000);
    return () => { window.removeEventListener('scroll', capture); window.clearInterval(timer); };
  }, [list]);
  useEffect(() => {
    if (!range) { setPending(false); return; }
    let active = true;
    setPending(true);
    void Promise.all([
      getTransactionsByDateRange(range.start, range.end),
      Promise.allSettled([loadMerchants(), loadPaymentInstruments(), loadAccounts(), loadGoals(), loadSubscriptions()]),
    ]).then(([transactions, results]) => {
      if (!active) return;
      const directories: Partial<TransactionDirectories> = {};
      const names = ['merchants', 'instruments', 'accounts', 'goals', 'subscriptions'] as const;
      const labels = ['商戶', '付款工具', '帳戶', '儲蓄目標', '訂閱'];
      const errors: string[] = [];
      results.forEach((result, i) => { if (result.status === 'fulfilled') Object.assign(directories, {[names[i]]: result.value}); else errors.push(`${labels[i]}未能載入`); });
      setLoaded({key, transactions, directories, errors});
    }).catch(() => {
      if (active) setLoaded(current => current?.key === key ? {...current, errors: ['交易重新整理失敗，畫面保留上次資料。'], failed: true} : {key, transactions: [], directories: {}, errors: ['交易載入失敗。'], failed: true});
    }).finally(() => { if (active) setPending(false); });
    return () => { active = false; };
  }, [range, key, retry]);
  useEffect(() => {
    if (!pending && loaded?.key === key && !restored.current) {
      const frame = requestAnimationFrame(() => { window.scrollTo(0, list.current.scroll); restored.current = true; });
      return () => cancelAnimationFrame(frame);
    }
  }, [pending, loaded, key, list]);
  const transactions = loaded?.key === key ? loaded.transactions : [];
  const directories = loaded?.key === key ? loaded.directories : {};
  const {merchants = [], instruments = [], accounts = [], goals = [], subscriptions = []} = directories;
  const filteredTransactions = range ? filterTransactions(transactions, range, filters, directories) : [];
  const visibleTransactions = filteredTransactions.slice(0, limit);
  const totals = transactionCurrencyTotals(filteredTransactions);
  const cleanupBase = range ? filterTransactions(transactions, range, {...filters, cleanup: 'all'}, directories) : [];
  const cleanupCounts = Object.fromEntries((Object.keys(CLEANUP_LABELS) as CleanupReason[]).map(reason => [reason, cleanupBase.filter(t => cleanupReasons(t, directories).includes(reason)).length]));
  const cleanupQueue = filteredTransactions.filter(t => cleanupReasons(t, directories).length > 0);
  const categories = [...new Set([...expenseCategories, ...incomeCategories, ...transactions.map(t => t.category), ...(filters.category === 'all' ? [] : [filters.category])])];
  function updateFilters(patch: Partial<TransactionFilters>) { setFilters(f => ({...f, ...patch})); setLimit(50); }
  function updatePeriod(patch: Partial<TransactionPeriod>) { setPeriod(p => ({...p, ...patch})); setLimit(50); }
  function refresh() { setRetry(n => n + 1); }
  function merchantLabel(t: Transaction) { return t.merchantId && !directories.merchants ? '商戶未能載入' : t.merchantId && !merchants.some(m => m.id === t.merchantId) ? `已刪除商戶${t.merchantText ? ` · ${t.merchantText}` : ''}` : resolveTransactionMerchantDisplay(t, merchants) || t.note || t.category; }
  const callbacks = {
    onSaved: (t: Transaction) => {
      setLoaded(current => current ? {...current, transactions: [...current.transactions.filter(row => row.id !== t.id), t]} : current);
      refresh();
      return range && !filterTransactions([t], range, filters, directories).length ? '此筆已不符合目前篩選條件。' : '';
    },
    onMissing: (id: string) => { setLoaded(current => current ? {...current, transactions: current.transactions.filter(t => t.id !== id)} : current); refresh(); },
  };
  function startEdit(t: Transaction) { openEdit(t.id, callbacks); }
  function copyTransaction(transaction: Transaction) {
    navigate('/transaction', {
      state: {
        prefillTransaction: {
          type: transaction.type,
          amount: transaction.amount,
          category: transaction.category,
          merchant: transaction.merchantText || transaction.merchant || '',
          merchantId: transaction.merchantId,
          merchantText: transaction.merchantText,
          note: transaction.note || '',
          paymentMethod: transaction.paymentMethod || '',
          paymentInstrumentId: transaction.paymentInstrumentId,
          goalId: transaction.goalId || ''
        }
      }
    });
  }

  async function confirmDelete(t: Transaction) {
    if (deleteBusy.current) return;
    deleteBusy.current = true; setDeleting(true);
    try {
      await deleteTransactionWithGoalLink(t);
      setLoaded(current => current ? {...current, transactions: current.transactions.filter(row => row.id !== t.id)} : current);
      setConfirmDeleteId(null); setToast('交易已刪除。'); refresh();
      void trackEvent('delete_transaction_success', {category: t.category}).catch(() => {});
    } catch { setToast('刪除未能完成，請重新整理後確認交易狀態。'); }
    finally { deleteBusy.current = false; setDeleting(false); }
  }
  function identityOptions(items: Array<{id: string; name: string}>, value: string) {
    return <><option value="all">全部</option><option value="unspecified">未指定</option><option value="deleted">已刪除連結</option>{value.startsWith('id:') && !items.some(i => `id:${i.id}` === value) && <option value={value}>原先選擇（暫不可用）</option>}{items.map(i => <option key={i.id} value={`id:${i.id}`}>{i.name}</option>)}</>;
  }
  return <Screen wide title="交易" subtitle="搜尋、修改，逐筆補充收支資料">
    <Card title="交易記錄">
      <div className={styles.chips} aria-label="交易期間">{([['month', '月度'], ['recent90', '最近 90 日'], ['year', '今年至今'], ['custom', '自訂日期']] as const).map(([preset, label]) => <button key={preset} className={`${styles.chip} ${period.preset === preset ? styles.activeChip : ''}`} aria-pressed={period.preset === preset} onClick={() => updatePeriod({preset})}>{label}</button>)}</div>
      {period.preset === 'month' && <div className={styles.monthNav}><button className={styles.navBtn} disabled={period.month <= '1900-01'} onClick={() => updatePeriod({month: shiftMonthKey(period.month, -1)})}>‹ 上月</button><label>交易月份<input aria-label="交易月份" type="month" min="1900-01" className={styles.input} value={period.month} onChange={e => updatePeriod({month: e.target.value})} /></label><button className={styles.navBtn} onClick={() => updatePeriod({month: shiftMonthKey(period.month, 1)})}>下月 ›</button></div>}
      {period.preset === 'custom' && <div className={styles.managementFilters}><label>開始日期<input type="date" className={styles.input} value={period.start} min="1900-01-01" onChange={e => updatePeriod({start: e.target.value})} /></label><label>截止日期<input type="date" className={styles.input} value={period.end} min={period.start} onChange={e => updatePeriod({end: e.target.value})} /></label></div>}
      <p className={styles.hint}>{range && `${range.start} 至 ${range.end}（含首尾日期）`}{period.preset === 'month' || period.preset === 'custom' ? ' · 可管理未來日期交易；分析仍只計至今日。' : ''}</p>
      <div className={styles.searchField}><Search size={18} aria-hidden="true" /><input type="search" aria-label="搜尋交易" placeholder="商戶名稱、別名、備註或金額" className={styles.input} value={filters.query} onChange={e => updateFilters({query: e.target.value})} /></div>
      <div className={styles.managementFilters}>
        <label>類型<select className={styles.input} value={filters.type} onChange={e => updateFilters({type: e.target.value as TransactionFilters['type']})}><option value="all">全部</option><option value="expense">支出</option><option value="income">收入</option></select></label>
        <label>分類<select className={styles.input} value={filters.category} onChange={e => updateFilters({category: e.target.value})}><option value="all">全部分類</option>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
        <label>商戶<select className={styles.input} value={filters.merchant} onChange={e => updateFilters({merchant: e.target.value})}>{identityOptions(merchants, filters.merchant)}</select></label>
        <label>帳戶<select className={styles.input} value={filters.account} onChange={e => updateFilters({account: e.target.value})}>{identityOptions(accounts, filters.account)}</select></label>
        <label>付款工具<select className={styles.input} value={filters.instrument} onChange={e => updateFilters({instrument: e.target.value})}>{identityOptions(instruments.map(i => ({id: i.id, name: `${formatInstrumentLabel(i)}${i.active ? '' : '（已停用）'}`})), filters.instrument)}</select></label>
        <label>幣別<select className={styles.input} value={filters.currency} onChange={e => updateFilters({currency: e.target.value})}><option value="all">全部幣別</option>{[...new Set([...transactions.map(t => normalizeCurrency(t.currency)), ...(filters.currency === 'all' ? [] : [filters.currency])])].sort().map(c => <option key={c}>{c}</option>)}</select></label>
      </div>
      <details className={styles.cleanupPanel} open={filters.cleanup !== 'all'}><summary>待補充資料（{cleanupBase.filter(t => cleanupReasons(t, directories).length).length} 筆支出）</summary><p className={styles.hint}>以下為選填資料，可按需要補充；已停用但仍存在的付款工具不算缺漏。</p><div className={styles.chips}>
        <button className={`${styles.chip} ${filters.cleanup === 'all' ? styles.activeChip : ''}`} onClick={() => updateFilters({cleanup: 'all'})}>所有交易</button><button className={`${styles.chip} ${filters.cleanup === 'any' ? styles.activeChip : ''}`} onClick={() => updateFilters({cleanup: 'any'})}>所有待補充</button>
        {(Object.keys(CLEANUP_LABELS) as CleanupReason[]).map(reason => <button key={reason} className={`${styles.chip} ${filters.cleanup === reason ? styles.activeChip : ''}`} onClick={() => updateFilters({cleanup: reason})}>{CLEANUP_LABELS[reason]} · {cleanupCounts[reason]}</button>)}
      </div><button className={styles.secondaryBtn} disabled={!cleanupQueue.length || pending || Boolean(loaded?.failed)} onClick={() => openEdit(cleanupQueue[0].id, callbacks, cleanupQueue.map(t => t.id))}>逐筆整理目前清單（{cleanupQueue.length} 筆）</button></details>
      <div className={styles.filterBar} data-transaction-list tabIndex={-1}><strong role="status">{filteredTransactions.length} 筆交易</strong><button className={styles.navBtn} onClick={() => updateFilters({...EMPTY_TRANSACTION_FILTERS})}>清除篩選</button><button className={styles.navBtn} onClick={refresh}>重新整理</button></div>
      {totals.length > 0 && <div className={styles.currencyTotals}>{totals.map(t => <p key={t.currency}><strong>{t.currency}</strong> 收入 {formatMoney(t.income)} · 支出 {formatMoney(t.expense)} · 結餘 {formatMoney(t.balance)}</p>)}</div>}
      {resolved.error && <p role="alert">{resolved.error}</p>}
      {loaded?.key === key && loaded.errors.length > 0 && <p role="alert" className={styles.managementNotice}>{loaded.errors.join('、')}<button className={styles.navBtn} onClick={refresh}>重試</button></p>}
      {pending && <p role="status">正在載入交易…</p>}
      {deleting && <p role="status">正在刪除交易…</p>}
      {!resolved.error && (!pending || transactions.length > 0) && !(!transactions.length && loaded?.failed) && <>
        {filteredTransactions.length > 0 ? (
          <div className={styles.desktopTable}>
            <table>
              <caption className={styles.hidden}>交易記錄</caption>
              <thead><tr><th scope="col">日期</th><th scope="col">商戶／備註</th><th scope="col">分類</th><th scope="col">付款方式</th><th scope="col" className={styles.numericCell}>金額</th><th scope="col">操作</th></tr></thead>
              <tbody>{visibleTransactions.map(t => (
                <tr key={t.id}>
                  <td className={styles.dateCell}>{t.date}{t.date > today && <small className={styles.futureBadge}>尚未發生</small>}</td>
                  <td className={styles.merchantCell}><strong>{merchantLabel(t)}</strong>
                    {t.note && <small>{t.note}</small>}{cleanupReasons(t, directories).length > 0 && filters.cleanup !== 'all' && <small>{cleanupReasons(t, directories).map(r => CLEANUP_LABELS[r]).join(' · ')}</small>}{t.goalId ? <small>儲蓄目標：{goals.find(g => g.id === t.goalId)?.name || (directories.goals ? '已刪除目標' : '目標未能載入')}</small> : null}
                    {t.subscriptionId ? <small>訂閱：{subscriptions.find(item => item.id === t.subscriptionId)?.name || (directories.subscriptions ? '已刪除訂閱' : '訂閱未能載入')}</small> : null}
                  </td>
                  <td>{t.category}</td>
                  <td>{t.paymentInstrumentId ? formatInstrumentLabel(instruments.find(item => item.id === t.paymentInstrumentId) || {id: '', name: directories.instruments ? '已刪除付款工具' : '付款工具未能載入', type: 'other', active: true, createdAt: ''}) : (t.paymentMethod || '未指定')}</td>
                  <td className={styles.numericCell}><span className={t.type === 'income' ? styles.incomeText : styles.expenseText}>{t.type === 'income' ? '+' : '-'}{t.currency || 'HKD'} {formatMoney(t.amount).slice(1)}</span></td>
                  <td>
                    {confirmDeleteId === t.id ? <div className={styles.tableConfirm}><span>確定刪除？</span><button className={styles.confirmYes} onClick={() => confirmDelete(t)}>確定</button><button className={styles.confirmNo} onClick={() => setConfirmDeleteId(null)}>取消</button></div> :
                    <div className={styles.tableActions}>
                      <button className={styles.iconBtn} aria-label={`複製交易：${t.note || t.category}`} title="複製" onClick={() => copyTransaction(t)}><Copy size={17} /></button>
                      <button className={styles.iconBtn} aria-label={`編輯交易：${t.note || t.category}`} title="編輯" onClick={() => startEdit(t)}><Pencil size={17} /></button>
                      <button className={styles.iconBtnDanger} aria-label={`刪除交易：${t.note || t.category}`} title="刪除" onClick={() => setConfirmDeleteId(t.id)}><Trash2 size={17} /></button>
                    </div>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : null}
        {transactions.length ? filteredTransactions.length ? <div className={styles.mobileRows}>{visibleTransactions.map(t => (
          <div key={t.id} className={styles.txRow}>
            <div className={styles.txMain}>
              <span className={styles.txTitle}>{merchantLabel(t)}</span>
              <span className={styles.txMeta}>
                {t.date}{t.date > today ? '（尚未發生）' : ''} · {t.category} · {t.paymentInstrumentId
                  ? formatInstrumentLabel(instruments.find(item => item.id === t.paymentInstrumentId) || {id: '', name: directories.instruments ? '已刪除付款工具' : '付款工具未能載入', type: 'other', active: true, createdAt: ''})
                  : (t.paymentMethod || '未填付款方式')}
              </span>
              {t.goalId && t.type === 'expense' ? (
                <span className={styles.goalMeta}>
                  由 Goal 支付：{goals.find(g => g.id === t.goalId)?.name || (directories.goals ? '已刪除目標' : '目標未能載入')}
                </span>
              ) : null}
              {t.subscriptionId && t.type === 'expense' ? (
                <span className={styles.goalMeta}>
                  訂閱：{subscriptions.find(item => item.id === t.subscriptionId)?.name || (directories.subscriptions ? '已刪除訂閱' : '訂閱未能載入')}
                </span>
              ) : null}
            </div>
              <div className={styles.txActions}>
              <span className={t.type === 'income' ? styles.incomeText : styles.expenseText}>
                {t.type === 'income' ? '+' : '-'}{t.currency || 'HKD'} {formatMoney(t.amount).slice(1)}
              </span>
              {confirmDeleteId === t.id ? (
                <div className={styles.confirmRow}>
                  <span className={styles.confirmText}>確定刪除？</span>
                  <button className={styles.confirmYes} onClick={() => confirmDelete(t)}>確定</button>
                  <button className={styles.confirmNo} onClick={() => setConfirmDeleteId(null)}>取消</button>
                </div>
              ) : (
                <details className={styles.transactionOptions}>
                  <summary aria-label={`操作交易：${t.note || t.category}`}>操作</summary>
                  <div className={styles.actionRow}>
                  <button className={styles.iconBtn} aria-label="複製交易" title="複製" onClick={() => copyTransaction(t)}><Copy size={15} /></button>
                  <button className={styles.iconBtn} aria-label="編輯交易" title="編輯" onClick={() => startEdit(t)}><Pencil size={15} /></button>
                  <button className={styles.iconBtnDanger} aria-label="刪除交易" title="刪除" onClick={() => setConfirmDeleteId(t.id)}><Trash2 size={15} /></button>
                  </div>
                </details>
              )}
            </div>
          </div>
        ))}</div> : (
          <div className={styles.emptyState}><p className={styles.emptyTitle}>找不到符合條件的交易</p><p className={styles.hint}>試試其他關鍵字，或清除篩選。</p><button className={styles.secondaryBtn} onClick={() => {updateFilters({...EMPTY_TRANSACTION_FILTERS});}}>清除篩選</button></div>
        ) : (
          <div className={styles.emptyState}><p className={styles.emptyTitle}>這個期間尚無交易</p><button className={styles.primaryBtn} onClick={() => navigate('/transaction')}>新增交易</button></div>
        )}      </>}
      {filteredTransactions.length > limit && <button className={styles.secondaryBtn} onClick={() => setLimit(n => n + 50)}>再顯示 50 筆（已顯示 {visibleTransactions.length} / {filteredTransactions.length}）</button>}
    </Card>
    {toast && <p role="status" className={styles.managementNotice}>{toast}<button className={styles.navBtn} onClick={() => setToast('')}>關閉</button></p>}
  </Screen>;
}
