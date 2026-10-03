import {useEffect, useRef, useState} from 'react';
import {expenseCategories} from '../constants/categories';
import {shiftMonthKey} from '../services/comparisonEngine';
import {getCurrentMonthKey, loadBudgetMonthSnapshot, saveBudgetMonth} from '../services/storage';
import {BudgetEditConflict, budgetDraft, isBudgetMonth, parseBudgetDraft, type BudgetMonthSnapshot, type BudgetRecord} from '../services/budgetEditing';
import {formatMoney} from '../services/chartFormatters';
import styles from './BudgetEditor.module.css';

type Props = {initialMonth: string; onClose: () => void; onSaved: (result: {month: string; budgets: BudgetRecord}) => void};
type Dismiss = {kind: 'close'} | {kind: 'month'; month: string};

export function BudgetEditor({initialMonth, onClose, onSaved}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const active = useRef(true);
  const busyRef = useRef(false);
  const initialDraft = useRef('');
  const [month, setMonth] = useState(initialMonth);
  const [snapshot, setSnapshot] = useState<BudgetMonthSnapshot | null>(null);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [dismiss, setDismiss] = useState<Dismiss | null>(null);
  const [copying, setCopying] = useState(false);
  const [copy, setCopy] = useState<BudgetMonthSnapshot | null>(null);
  const currentMonth = getCurrentMonthKey();
  const validMonth = isBudgetMonth(month) && month <= currentMonth;
  const ready = validMonth && snapshot?.month === month && draft !== null && !loading;
  const parsed = parseBudgetDraft(draft || {});
  const dirty = Boolean(draft && JSON.stringify(draft) !== initialDraft.current);
  const locked = busy || loading || copying || committed || Boolean(dismiss);
  const canSave = ready && !locked && !conflict && !copy && !Object.keys(parsed.errors).length && (dirty || snapshot?.monthRecord === null);

  useEffect(() => {
    active.current = true;
    const element = dialog.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const scroll = window.scrollY;
    const overflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      active.current = false;
      element.close();
      document.body.style.overflow = overflow;
      if (opener?.isConnected) { opener.focus({preventScroll: true}); window.scrollTo({top: scroll}); }
    };
  }, []);
  useEffect(() => {
    let valid = true;
    setLoading(true); setError(''); setNotice(''); setCopy(null); setConflict(false);
    if (!validMonth) { setError('請選擇本月或歷史月份。'); setLoading(false); return; }
    void loadBudgetMonthSnapshot(month).then(next => {
      if (!valid) return;
      const nextDraft = budgetDraft(next.budgets, expenseCategories);
      setSnapshot(next); setDraft(nextDraft); initialDraft.current = JSON.stringify(nextDraft);
    }).catch(() => { if (valid) { setSnapshot(null); setDraft(null); setError('預算載入失敗，請重試。'); } })
      .finally(() => { if (valid) setLoading(false); });
    return () => { valid = false; };
  }, [month, retry, validMonth]);
  useEffect(() => {
    const selector = dismiss ? '[data-keep-draft]' : copy ? '[data-apply-copy]' : '[data-budget-input]';
    if (ready) dialog.current?.querySelector<HTMLElement>(selector)?.focus();
  }, [ready, copy, dismiss]);
  useEffect(() => { if (error || notice || copy || dismiss) dialog.current?.scrollTo({top: 0}); }, [error, notice, copy, dismiss]);

  function perform(action: Dismiss) {
    setDismiss(null);
    if (action.kind === 'close') onClose();
    else { setSnapshot(null); setDraft(null); setMonth(action.month); }
  }
  function request(action: Dismiss) {
    if (busyRef.current || (copying && action.kind === 'month')) return;
    if (action.kind === 'month' && (action.month === month || !isBudgetMonth(action.month) || action.month > currentMonth)) return;
    if (dirty && !committed) setDismiss(action);
    else perform(action);
  }
  async function copyPrevious() {
    if (!ready || locked || conflict || month <= '1900-01') return;
    setCopying(true); setError(''); setNotice('');
    try {
      const previous = await loadBudgetMonthSnapshot(shiftMonthKey(month, -1));
      if (!active.current) return;
      if (previous.budgets === null) setNotice(`${previous.month} 沒有預算紀錄，目前草稿保持不變。`);
      else setCopy(previous);
    } catch { if (active.current) setError('上月預算載入失敗，目前草稿已保留，請重試。'); }
    finally { if (active.current) setCopying(false); }
  }
  async function save() {
    if (!canSave || !snapshot || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    let result;
    try { result = await saveBudgetMonth(snapshot, parsed.budgets); }
    catch (failure) {
      if (active.current) { setError(failure instanceof Error ? failure.message : '儲存失敗，草稿已保留。'); setConflict(failure instanceof BudgetEditConflict); setBusy(false); }
      busyRef.current = false;
      return;
    }
    if (!active.current) return;
    setCommitted(true);
    // A confirmed write is never offered as a second save, even if rendering the result fails.
    try { onSaved(result); onClose(); }
    catch { setError('預算已儲存，畫面未能更新。關閉後請重新整理，毋須再次儲存。'); setBusy(false); busyRef.current = false; }
  }

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="budget-editor-title" onCancel={event => { event.preventDefault(); if (dismiss) setDismiss(null); else request({kind: 'close'}); }} onKeyDown={event => {
    if (event.key !== 'Tab') return;
    const nodes = [...event.currentTarget.querySelectorAll<HTMLElement>('button, input, select, summary, [tabindex]:not([tabindex="-1"])')].filter(node => !node.matches(':disabled') && node.getClientRects().length > 0);
    const first = nodes[0]; const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}>
    <div className={styles.heading}><div><p className={styles.eyebrow}>每月預算 · HKD</p><h2 id="budget-editor-title">管理分類預算</h2></div><button className={styles.close} aria-label="關閉預算編輯" disabled={busy || Boolean(dismiss)} onClick={() => request({kind: 'close'})}>×</button></div>
    {dismiss && <div className={styles.notice} role="alert"><p>尚有未儲存的預算，是否捨棄草稿？</p><div className={styles.actions}><button data-keep-draft className={styles.secondary} onClick={() => setDismiss(null)}>繼續編輯</button><button className={styles.secondary} onClick={() => perform(dismiss)}>{dismiss.kind === 'close' ? '捨棄並關閉' : '捨棄並切換'}</button></div></div>}
    {error && <div className={styles.notice} role="alert"><p>{error}</p>{!snapshot && !loading && <button className={styles.secondary} onClick={() => setRetry(n => n + 1)}>重試載入</button>}{conflict && <button className={styles.secondary} disabled={Boolean(dismiss)} onClick={() => { setDraft(null); setSnapshot(null); setRetry(n => n + 1); }}>捨棄草稿並載入最新版</button>}</div>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    <fieldset className={styles.fields} disabled={locked}>
      <div className={styles.monthNav}><button className={styles.secondary} disabled={locked || month <= '1900-01'} onClick={() => request({kind: 'month', month: shiftMonthKey(month, -1)})}>‹ 上月</button><label className={styles.monthLabel}>預算月份<input type="month" min="1900-01" max={currentMonth} value={month} onChange={event => request({kind: 'month', month: event.target.value})} /></label><button className={styles.secondary} disabled={locked || month >= currentMonth} onClick={() => request({kind: 'month', month: shiftMonthKey(month, 1)})}>下月 ›</button></div>
      <p className={styles.hint}>{month === currentMonth ? '本月修改會更新總覽、分析和訂閱的預算進度。' : '此處只修改所選歷史月份的預算。'}空白或 0 表示不設定分類上限。</p>
      {loading && <p className={styles.hint} role="status">正在載入 {month} 預算…</p>}
      {ready && <>
        {snapshot.budgets === null && <p className={styles.hint}>這個月份尚無預算紀錄。儲存後會建立該月紀錄。</p>}
        <div className={styles.summary}><div><span>{month} 預算總額</span><strong>{formatMoney(parsed.total)}</strong><small>{Object.keys(parsed.budgets).length} 個分類已設定</small></div><button className={styles.secondary} disabled={locked || conflict || month <= '1900-01'} onClick={copyPrevious}>{copying ? '讀取上月…' : '複製上月預算'}</button></div>
        {copy && <div className={styles.notice} role="status"><strong>{copy.month} 預算預覽</strong><p>{Object.values(copy.budgets || {}).filter(amount => amount > 0).length} 個分類 · {formatMoney(parseBudgetDraft(budgetDraft(copy.budgets, [])).total)}</p><details className={styles.preview}><summary>查看上月分類金額</summary><dl>{Object.entries(copy.budgets || {}).filter(([, amount]) => amount > 0).map(([category, amount]) => <div key={category}><dt>{category}</dt><dd>{formatMoney(amount)}</dd></div>)}</dl></details><p>套用會取代目前草稿；按「儲存預算」後才生效。</p><div className={styles.actions}><button data-apply-copy className={styles.secondary} onClick={() => { setDraft(budgetDraft(copy.budgets, [...expenseCategories, ...Object.keys(draft)])); setCopy(null); setNotice('已套用上月預算，尚未儲存。'); }}>套用上月預算</button><button className={styles.secondary} onClick={() => setCopy(null)}>取消複製</button></div></div>}
        <div className={styles.grid}>{Object.entries(draft).map(([category, value], index) => <label key={category} className={styles.row}><span>{category}</span><input data-budget-input type="text" inputMode="decimal" placeholder="不設定" value={value} aria-label={`${category}預算`} aria-invalid={Boolean(parsed.errors[category])} aria-describedby={parsed.errors[category] ? `budget-error-${index}` : undefined} onChange={event => { const amount = event.target.value; setDraft(previous => ({...previous, [category]: amount})); }} />{parsed.errors[category] && <small id={`budget-error-${index}`} className={styles.error}>{parsed.errors[category]}</small>}</label>)}</div>
        {parsed.errors.total && <p className={styles.error} role="alert">{parsed.errors.total}</p>}
      </>}
    </fieldset>
    <div className={styles.footer}><button className={styles.secondary} disabled={busy || Boolean(dismiss)} onClick={() => request({kind: 'close'})}>取消</button><button className={styles.primary} disabled={!canSave} onClick={save}>{busy ? '儲存中…' : '儲存預算'}</button></div>
  </dialog>;
}
