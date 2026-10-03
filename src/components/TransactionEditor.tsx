import {useEffect, useRef, useState} from 'react';
import {MerchantField} from './MerchantField';
import {PaymentInstrumentField} from './PaymentInstrumentField';
import {expenseCategories, incomeCategories} from '../constants/categories';
import {planMerchantSave} from '../services/merchantIdentity';
import {paymentMethodFromType, paymentTypeFromMethod, resolveInstrumentAccount} from '../services/paymentInstrument';
import {isValidDate} from '../services/analysisPeriod';
import {getTransactionById, loadAccounts, loadGoals, loadMerchants, loadPaymentInstruments, loadSubscriptions, saveTransactionEdit, trackEvent, upsertPaymentInstrument} from '../services/storage';
import {completeTransactionSave, TransactionEditConflict} from '../services/transactionEditing';
import type {TransactionDirectories} from '../services/transactionManagement';
import type {PaymentInstrumentType, Transaction} from '../types/finance';
import styles from '../screens/TransactionScreen.module.css';
import modal from './TransactionEditor.module.css';

type Draft = {type: 'income' | 'expense'; amount: string; category: string; merchant: string; merchantId?: string; createNewMerchant: boolean; note: string; date: string; paymentType: PaymentInstrumentType | ''; paymentInstrumentId?: string; accountLinkChoice?: 'instrument' | 'keep'; goalId: string; accountId?: string; subscriptionId?: string};
function createDraft(t: Transaction, dirs: TransactionDirectories): Draft {
  return {type: t.type, amount: String(t.amount), category: t.category, merchant: t.merchantText || t.merchant || '', merchantId: t.merchantId,
    createNewMerchant: false, note: t.note || '', date: t.date, paymentType: dirs.instruments.find(i => i.id === t.paymentInstrumentId)?.type || paymentTypeFromMethod(t.paymentMethod) || '',
    paymentInstrumentId: t.paymentInstrumentId, goalId: t.goalId || '', accountId: t.accountId, subscriptionId: t.subscriptionId};
}
type Props = {id: string; remaining?: number; onClose: () => void; onSkip: () => void; onMissing: (id: string) => void; onSaved: (t: Transaction, warnings: string[]) => Promise<void>};
export function TransactionEditor({id, remaining, onClose, onSkip, onMissing, onSaved}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const busyRef = useRef(false);
  const active = useRef(true);
  const initialDraft = useRef('');
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirs, setDirs] = useState<TransactionDirectories | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<TransactionEditConflict | null>(null);
  const [dismiss, setDismiss] = useState<'close' | 'skip' | null>(null);
  const missingCallback = useRef(onMissing);
  missingCallback.current = onMissing;
  useEffect(() => {
    active.current = true;
    const element = dialog.current!;
    element.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { active.current = false; element.close(); document.body.style.overflow = overflow; };
  }, []);
  useEffect(() => {
    let valid = true;
    setLoading(true); setError('');
    void Promise.all([getTransactionById(id), loadMerchants(), loadPaymentInstruments(), loadAccounts(), loadGoals(), loadSubscriptions()]).then(([t, merchants, instruments, accounts, goals, subscriptions]) => {
      if (!valid) return;
      if (!t) { setMissing(true); setError('這筆交易已不存在，清單已重新整理。'); missingCallback.current(id); return; }
      const directories = {merchants, instruments, accounts, goals, subscriptions};
      const nextDraft = createDraft(t, directories);
      setDirs(directories); setEditingTransaction(t); setDraft(nextDraft); initialDraft.current = JSON.stringify(nextDraft);
    }).catch(() => { if (valid) setError('交易或連結資料載入失敗，請重試。'); }).finally(() => { if (valid) setLoading(false); });
    return () => { valid = false; };
  }, [id, retry]);
  useEffect(() => { if (draft) dialog.current?.querySelector<HTMLInputElement>('input[aria-label="金額"]')?.focus(); }, [loading, Boolean(draft)]);
  useEffect(() => { if (error) dialog.current?.scrollTo({top: 0}); }, [error]);
  const {merchants = [], instruments = [], accounts = [], goals = [], subscriptions = []} = dirs || {};
  const setInstruments = (update: (current: TransactionDirectories['instruments']) => TransactionDirectories['instruments']) => setDirs(current => current ? {...current, instruments: update(current.instruments)} : current);
  const canSave = Boolean(draft && Number.isFinite(Number(draft.amount)) && Number(draft.amount) > 0 && isValidDate(draft.date) && !busy && !conflict);
  function updateDraft(patch: Partial<Draft>) { setDraft(current => current ? {...current, ...patch} : current); }
  function requestDismiss(action: 'close' | 'skip') {
    if (busyRef.current) return;
    if (draft && JSON.stringify(draft) !== initialDraft.current) setDismiss(action);
    else (action === 'close' ? onClose : onSkip)();
  }
  async function saveEdit() {
    if (!draft || !editingTransaction || !canSave || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    let result;
    try {
      const planned = planMerchantSave(draft.merchant, draft.merchantId, draft.createNewMerchant, merchants);
      if (!planned.ok) throw new Error(`請先確認商戶：這可能是「${planned.suggestion.merchant.name}」。`);
      const account = resolveInstrumentAccount({instrument: instruments.find(i => i.id === draft.paymentInstrumentId), explicitAccountId: draft.accountId,
        previousInstrumentAccountId: instruments.find(i => i.id === editingTransaction.paymentInstrumentId)?.accountId, choice: draft.accountLinkChoice});
      if (!account.ok) throw new Error('請先處理付款工具與帳戶的連結衝突。');
      const transaction: Transaction = {...editingTransaction, type: draft.type, amount: Number(draft.amount), category: draft.category, date: draft.date,
        merchant: planned.merchant, merchantId: planned.merchantId, merchantText: planned.merchantText, note: draft.note,
        goalId: draft.type === 'expense' ? draft.goalId || undefined : undefined, accountId: account.accountId, subscriptionId: draft.subscriptionId,
        paymentMethod: draft.paymentType ? paymentMethodFromType(draft.paymentType) : undefined, paymentInstrumentId: draft.paymentInstrumentId};
      result = await saveTransactionEdit(editingTransaction, transaction, planned.upsert);
    } catch (failure) {
      if (active.current) { setError(failure instanceof Error ? failure.message : '未能儲存，輸入已保留。'); if (failure instanceof TransactionEditConflict) { setConflict(failure); if (!failure.latest) missingCallback.current(id); } setBusy(false); }
      busyRef.current = false; return;
    }
    // No path below this point can re-enable Save for the committed snapshot.
    if (!active.current) return;
    const followup = await completeTransactionSave(result.transaction, [{label: '操作紀錄未能更新', run: () => trackEvent('edit_transaction_success', {category: result.transaction.category})}]);
    if (active.current) await onSaved(result.transaction, [...result.warnings, ...followup.warnings]);
  }
  return <dialog ref={dialog} className={modal.dialog} aria-labelledby="transaction-editor-title" onKeyDown={event => {
    if (event.key !== 'Tab') return;
    const nodes = [...event.currentTarget.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')]
      .filter(node => !node.matches(':disabled') && node.getClientRects().length > 0);
    const first = nodes[0]; const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }} onCancel={event => { event.preventDefault(); requestDismiss('close'); }}>
    <div className={modal.heading}><h2 id="transaction-editor-title">編輯交易</h2><button className={styles.iconBtn} aria-label="關閉編輯" disabled={busy} onClick={() => requestDismiss('close')}>×</button></div>
    {remaining !== undefined && <p className={styles.hint}>逐筆整理 · 本次尚餘 {remaining} 筆（含此筆），可略過選填資料。</p>}
    {loading && <p role="status">正在載入最新交易…</p>}
    {error && <div role="alert" className={modal.notice}>{error}{!draft && !loading && !missing && <button className={styles.navBtn} onClick={() => setRetry(n => n + 1)}>重試載入</button>}</div>}
    {conflict?.latest && <details className={modal.notice}><summary>查看最新版本</summary><p>{conflict.latest.date} · {conflict.latest.category} · {conflict.latest.currency} {conflict.latest.amount}</p><p>{conflict.latest.merchantText || conflict.latest.merchant} · {conflict.latest.note}</p>
      <button className={styles.secondaryBtn} onClick={() => {
        if (!dirs || !conflict.latest) return;
        const nextDraft = createDraft(conflict.latest, dirs); setEditingTransaction(conflict.latest); setDraft(nextDraft); initialDraft.current = JSON.stringify(nextDraft); setConflict(null); setError('');
      }}>捨棄此草稿，使用最新版本重新編輯</button></details>}
    {draft && <fieldset className={modal.fields} disabled={busy}>
      <p className={styles.hint}>幣別：{editingTransaction?.currency || 'HKD'}</p>
          <p className={styles.sectionLabel}>類型</p>
          <div className={styles.chips}>
            <button
              type="button"
              onClick={() => updateDraft({type: 'expense', category: expenseCategories[0], goalId: ''})}
              className={[styles.chip, draft.type === 'expense' ? styles.activeChip : ''].join(' ')}
            >支出</button>
            <button
              type="button"
              onClick={() => updateDraft({type: 'income', category: incomeCategories[0], goalId: ''})}
              className={[styles.chip, draft.type === 'income' ? styles.activeChip : ''].join(' ')}
            >收入</button>
          </div>
          <input
            type="number"
            inputMode="decimal"
            aria-label="金額"
            placeholder="金額"
            className={styles.input}
            value={draft.amount}
            onChange={e => updateDraft({amount: e.target.value})}
          />
          <MerchantField
            merchants={merchants}
            text={draft.merchant}
            merchantId={draft.merchantId}
            createNew={draft.createNewMerchant}
            onChange={next => updateDraft({
              merchant: next.text,
              merchantId: next.merchantId,
              createNewMerchant: next.createNew,
            })}
          />
          <input
            type="text"
            aria-label="備註"
            placeholder="備註（選填）"
            className={styles.input}
            value={draft.note}
            onChange={e => updateDraft({note: e.target.value})}
          />
          <input
            type="date"
            aria-label="交易日期"
            className={styles.input}
            value={draft.date}
            onChange={e => updateDraft({date: e.target.value})}
          />

          <p className={styles.sectionLabel}>分類</p>
          <div className={styles.chips}>
            {(draft.type === 'income' ? incomeCategories : expenseCategories).map(item => (
              <button
                key={item}
                type="button"
                onClick={() => updateDraft({category: item})}
                className={[styles.chip, item === draft.category ? styles.activeChip : ''].join(' ')}
              >
                {item}
              </button>
            ))}
          </div>

          <p className={styles.sectionLabel}>付款方式</p>
          <PaymentInstrumentField
            instruments={instruments}
            accounts={accounts}
            type={draft.paymentType}
            instrumentId={draft.paymentInstrumentId}
            onChange={next => updateDraft({
              paymentType: next.type,
              paymentInstrumentId: next.instrumentId,
              accountLinkChoice: undefined,
            })}
            onCreate={async instrument => {
              try { await upsertPaymentInstrument(instrument); } catch { setError('付款工具未能儲存，請重試。'); throw new Error('付款工具未能儲存'); }
              setInstruments(current => [...current.filter(item => item.id !== instrument.id), instrument]);
            }}
          />
          {(() => {
            if (!draft || !editingTransaction) return null;
            const selectedInstrument = instruments.find(item => item.id === draft.paymentInstrumentId);
            const previousInstrument = instruments.find(item => item.id === editingTransaction.paymentInstrumentId);
            const accountLink = resolveInstrumentAccount({
              instrument: selectedInstrument,
              explicitAccountId: draft.accountId,
              previousInstrumentAccountId: previousInstrument?.accountId,
              choice: draft.accountLinkChoice,
            });
            if (accountLink.ok) return null;
            const instrumentAccount = accounts.find(item => item.id === accountLink.instrumentAccountId);
            const currentAccount = accounts.find(item => item.id === accountLink.transactionAccountId);
            return (
              <div className={styles.hint}>
                <p>此付款工具連結「{instrumentAccount?.name || '另一個帳戶'}」，但這筆交易目前連結「{currentAccount?.name || '現有帳戶'}」。請選擇要使用哪一個，系統不會自動覆寫。</p>
                <div className={styles.actionRow}>
                  <button className={styles.secondaryBtn} onClick={() => updateDraft({accountLinkChoice: 'instrument', accountId: accountLink.instrumentAccountId})}>
                    改用付款工具的帳戶
                  </button>
                  <button className={styles.secondaryBtn} onClick={() => updateDraft({accountLinkChoice: 'keep'})}>
                    保留現有帳戶
                  </button>
                </div>
              </div>
            );
          })()}

          {goals.length > 0 && draft.type === 'expense' ? (
            <>
              <p className={styles.sectionLabel}>由哪個 Goal 支付（選填）</p>
              <div className={styles.chips}>
                <button
                  type="button"
                  onClick={() => updateDraft({goalId: ''})}
                  className={[styles.chip, !draft.goalId ? styles.activeChip : ''].join(' ')}
                >
                  不指定
                </button>
                {goals.map(goal => (
                  <button
                    key={goal.id}
                    type="button"
                    onClick={() => updateDraft({goalId: goal.id})}
                    className={[styles.chip, goal.id === draft.goalId ? styles.activeChip : ''].join(' ')}
                  >
                    {goal.name}
                  </button>
                ))}
              </div>
              <p className={styles.helperText}>如果指定 Goal，這筆支出會自動從該目標提取相同金額。</p>
            </>
          ) : null}

      <label className={styles.fieldLabel}>交易帳戶（選填）<select className={styles.input} value={draft.accountId || ''} onChange={e => updateDraft({accountId: e.target.value || undefined, accountLinkChoice: undefined})}>
        <option value="">不指定帳戶</option>{draft.accountId && !accounts.some(a => a.id === draft.accountId) && <option value={draft.accountId}>已刪除帳戶</option>}{accounts.map(a => <option key={a.id} value={a.id}>{a.name} · {a.currency}</option>)}
      </select></label>
      {draft.goalId && !goals.some(g => g.id === draft.goalId) && <p className={styles.hint}>已刪除的儲蓄目標將在儲存時解除連結。</p>}
      {editingTransaction?.subscriptionId && !subscriptions.some(s => s.id === editingTransaction.subscriptionId) && <label className={styles.fieldLabel}><input type="checkbox" checked={!draft.subscriptionId} onChange={e => updateDraft({subscriptionId: e.target.checked ? undefined : editingTransaction.subscriptionId})} />解除已刪除訂閱的連結</label>}
      <div className={styles.actionRow}><button disabled={!canSave} className={`${styles.primaryBtn} ${!canSave ? styles.disabledBtn : ''}`} onClick={() => void saveEdit()}>{busy ? '正在儲存…' : remaining === undefined ? '儲存變更' : '儲存並下一筆'}</button></div>
    </fieldset>}
    <div className={styles.actionRow}>{remaining !== undefined && <button className={styles.secondaryBtn} disabled={busy} onClick={() => requestDismiss('skip')}>略過此筆</button>}<button className={styles.secondaryBtn} disabled={busy} onClick={() => requestDismiss('close')}>取消</button></div>
    {dismiss && <div className={modal.discard} role="alert"><p>尚有未儲存變更。確定捨棄這次輸入？</p><div className={styles.actionRow}><button autoFocus className={styles.secondaryBtn} onClick={() => setDismiss(null)}>繼續編輯</button><button className={styles.secondaryBtn} onClick={() => (dismiss === 'close' ? onClose : onSkip)()}>捨棄變更</button></div></div>}
  </dialog>;
}
