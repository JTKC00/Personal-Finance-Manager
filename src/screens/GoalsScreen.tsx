import {useCallback, useEffect, useMemo, useState} from 'react';
import {Trash2} from 'lucide-react';
import {Card} from '../components/Card';
import {Screen} from '../components/Screen';
import {appendGoalEntry, deleteGoal, loadGoals, removeGoalEntry, upsertGoal, trackEvent} from '../services/storage';
import {roundMoney} from '../services/money';
import {formatDateKey} from '../services/financeLogic';
import {Goal, GoalDeposit} from '../types/finance';
import styles from './GoalsScreen.module.css';

type Draft = {
  name: string;
  targetAmount: string;
  savedAmount: string;
  targetDate: string;
};

const formatMoney = (v: number) => `$${v.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
const emptyDraft = (): Draft => ({
  name: '',
  targetAmount: '',
  savedAmount: '0',
  targetDate: '',
});

export function GoalsScreen() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [depositGoalId, setDepositGoalId] = useState<string | null>(null);
  const [depositAmount, setDepositAmount] = useState('');
  const [depositNote, setDepositNote] = useState('');
  const [historyGoalId, setHistoryGoalId] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmRemoveEntryId, setConfirmRemoveEntryId] = useState<string | null>(null);

  const canSave = useMemo(
    () => Boolean(draft.name.trim()) && Number(draft.targetAmount) > 0,
    [draft.name, draft.targetAmount]
  );

  const refresh = useCallback(async () => {
    const data = await loadGoals();
    setGoals(data);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }

  function updateDraft(patch: Partial<Draft>) {
    setDraft(current => ({...current, ...patch}));
  }

  function resetForm() {
    setDraft(emptyDraft());
    setEditingId(null);
  }

  async function save() {
    const target = Number(draft.targetAmount);
    const saved = Number(draft.savedAmount);
    if (!draft.name.trim() || !target) {
      showToast('名稱與目標金額為必填。');
      return;
    }
    const existing = editingId ? goals.find(g => g.id === editingId) : undefined;
    const goalId = editingId || Date.now().toString();
    const openingDeposits: GoalDeposit[] = !existing && saved > 0 ? [{
      id: `${goalId}-opening-balance`,
      amount: saved,
      date: formatDateKey(new Date()),
      type: 'deposit',
      note: '期初存款',
    }] : [];
    const goal: Goal = {
      id: goalId,
      name: draft.name.trim(),
      targetAmount: target,
      savedAmount: existing?.savedAmount || 0,
      targetDate: draft.targetDate || undefined,
      deposits: existing?.deposits || openingDeposits,
      accountId: existing?.accountId,
    };
    await upsertGoal(goal);
    await trackEvent(editingId ? 'edit_goal_success' : 'save_goal_success', {goalName: goal.name});
    await refresh();
    resetForm();
    showToast(editingId ? '目標已更新。' : '目標已建立。');
  }

  function startEdit(goal: Goal) {
    setEditingId(goal.id);
    setDraft({
      name: goal.name,
      targetAmount: String(goal.targetAmount),
      savedAmount: String(goal.savedAmount),
      targetDate: goal.targetDate || '',
    });
  }

  async function confirmDelete(goal: Goal) {
    await deleteGoal(goal.id);
    await trackEvent('delete_goal_success', {goalName: goal.name});
    if (editingId === goal.id) resetForm();
    if (depositGoalId === goal.id) setDepositGoalId(null);
    setConfirmDeleteId(null);
    await refresh();
    showToast('目標已刪除。');
  }

  async function handleDeposit(goalId: string) {
    const amount = Number(depositAmount);
    if (!amount || amount <= 0) {
      showToast('請輸入有效金額。');
      return;
    }
    await appendGoalEntry(goalId, {
      amount,
      date: formatDateKey(new Date()),
      type: 'deposit',
      note: depositNote.trim() || '手動入金',
    });
    await trackEvent('goal_deposit_success', {goalId, amount});
    setDepositGoalId(null);
    setDepositAmount('');
    setDepositNote('');
    await refresh();
    showToast('入金成功！');
  }

  async function handleRemoveEntry(goalId: string, entry: GoalDeposit) {
    await removeGoalEntry(goalId, entry.id);
    await trackEvent('goal_entry_remove', {goalId, entryId: entry.id});
    setConfirmRemoveEntryId(null);
    await refresh();
    showToast('記錄已移除。');
  }

  return (
    <Screen title="目標" subtitle="設定儲蓄與消費目標">
      <Card title={editingId ? '編輯目標' : '新增目標'}>
        <input
          type="text"
          placeholder="目標名稱（如：旅遊基金）"
          className={styles.input}
          value={draft.name}
          onChange={e => updateDraft({name: e.target.value})}
        />
        <input
          type="number"
          inputMode="decimal"
          placeholder="目標金額"
          className={styles.input}
          value={draft.targetAmount}
          onChange={e => updateDraft({targetAmount: e.target.value})}
        />
        {!editingId ? (
          <>
            <label className={styles.fieldLabel}>期初存款（選填）</label>
            <input
              type="number"
              inputMode="decimal"
              placeholder="0"
              className={styles.input}
              value={draft.savedAmount}
              onChange={e => updateDraft({savedAmount: e.target.value})}
            />
          </>
        ) : (
          <p className={styles.hint}>目前存款是帳本衍生值；請使用下方「入金」或記錄移除調整。</p>
        )}
        <label className={styles.fieldLabel}>截止日期（選填）</label>
        <input
          type="date"
          className={styles.input}
          value={draft.targetDate}
          onChange={e => updateDraft({targetDate: e.target.value})}
        />
        <div className={styles.actionRow}>
          <button
            disabled={!canSave}
            className={[styles.primaryBtn, !canSave ? styles.disabledBtn : ''].join(' ')}
            onClick={save}
          >
            {editingId ? '儲存變更' : '建立目標'}
          </button>
          {editingId ? (
            <button className={styles.secondaryBtn} onClick={resetForm}>取消</button>
          ) : null}
        </div>
      </Card>

      {goals.length ? (
        <div className={styles.goalList}>
          {goals.map(goal => {
            const progress = goal.targetAmount > 0 ? Math.min(1, goal.savedAmount / goal.targetAmount) : 0;
            const pct = Math.round(progress * 100);
            const remaining = roundMoney(Math.max(0, goal.targetAmount - goal.savedAmount));
            return (
              <Card key={goal.id} title={goal.name}>
                <div className={styles.goalHeader}>
                  <span className={styles.goalPct}>{pct}%</span>
                  <span className={styles.goalAmt}>{formatMoney(goal.savedAmount)} / {formatMoney(goal.targetAmount)}</span>
                </div>
                <div className={styles.progressTrack}>
                  <div
                    className={[
                      styles.progressFill,
                      pct >= 100 ? styles.fillDone : pct >= 75 ? styles.fillGood : pct >= 50 ? styles.fillWarning : ''
                    ].join(' ')}
                    style={{width: `${pct}%`}}
                  />
                </div>
                <div className={styles.goalMeta}>
                  <span className={styles.remaining}>還差 {formatMoney(remaining)}</span>
                  {goal.targetDate ? <span className={styles.deadline}>截止：{goal.targetDate}</span> : null}
                </div>
                {goal.accountId ? (
                  <p className={styles.hint}>此目標以連結帳戶餘額為準；入金與提取會建立帳戶 Transfer。</p>
                ) : null}
                <div className={styles.actionRow}>
                  <button className={styles.textBtn} onClick={() => startEdit(goal)}>編輯</button>
                  <button
                    className={styles.textBtn}
                    onClick={() => {
                      setDepositGoalId(depositGoalId === goal.id ? null : goal.id);
                      setDepositAmount('');
                      setDepositNote('');
                    }}
                  >{depositGoalId === goal.id ? '取消入金' : '入金'}</button>
                  <button
                    className={styles.textBtn}
                    onClick={() => setHistoryGoalId(historyGoalId === goal.id ? null : goal.id)}
                  >{historyGoalId === goal.id ? '收起記錄' : `記錄 (${(goal.deposits || []).length})`}</button>
                  {confirmDeleteId === goal.id ? (
                    <div className={styles.confirmRow}>
                      <span className={styles.confirmText}>確定刪除？</span>
                      <button className={styles.confirmYes} onClick={() => confirmDelete(goal)}>確定</button>
                      <button className={styles.confirmNo} onClick={() => setConfirmDeleteId(null)}>取消</button>
                    </div>
                  ) : (
                    <button className={[styles.textBtn, styles.deleteBtn].join(' ')} onClick={() => setConfirmDeleteId(goal.id)}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                {depositGoalId === goal.id ? (
                  <div className={styles.depositForm}>
                    <input
                      autoFocus
                      type="number"
                      inputMode="decimal"
                      placeholder="入金金額"
                      className={styles.input}
                      value={depositAmount}
                      onChange={e => setDepositAmount(e.target.value)}
                    />
                    <input
                      type="text"
                      placeholder="備註（選填）"
                      className={styles.input}
                      value={depositNote}
                      onChange={e => setDepositNote(e.target.value)}
                    />
                    <button
                      className={[styles.primaryBtn, (!depositAmount || Number(depositAmount) <= 0) ? styles.disabledBtn : ''].join(' ')}
                      disabled={!depositAmount || Number(depositAmount) <= 0}
                      onClick={() => handleDeposit(goal.id)}
                    >確認入金</button>
                  </div>
                ) : null}
                {historyGoalId === goal.id ? (
                  <div className={styles.historyList}>
                    {(goal.deposits || []).length === 0 ? (
                      <p className={styles.hint}>尚無存款記錄。</p>
                    ) : (
                      [...(goal.deposits || [])]
                        .sort((a, b) => b.date.localeCompare(a.date))
                        .map(entry => (
                          <div key={entry.id} className={styles.entryRow}>
                            <div className={styles.entryInfo}>
                              <span className={entry.type === 'deposit' ? styles.entryDeposit : styles.entryWithdraw}>
                                {entry.type === 'deposit' ? '+' : '-'}${entry.amount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                              </span>
                              <span className={styles.entryMeta}>
                                {entry.id.endsWith('-legacy-opening-balance') ? '日期不詳' : entry.date}
                                {' · '}{entry.note || (entry.type === 'deposit' ? '入金' : '提取')}
                              </span>
                            </div>
                            {!entry.linkedTransactionId ? (
                              confirmRemoveEntryId === entry.id ? (
                                <div className={styles.confirmRow}>
                                  <span className={styles.confirmText}>確定移除？</span>
                                  <button className={styles.confirmYes} onClick={() => handleRemoveEntry(goal.id, entry)}>確定</button>
                                  <button className={styles.confirmNo} onClick={() => setConfirmRemoveEntryId(null)}>取消</button>
                                </div>
                              ) : (
                                <button
                                  className={[styles.textBtn, styles.deleteBtn].join(' ')}
                                  onClick={() => setConfirmRemoveEntryId(entry.id)}
                                ><Trash2 size={14} /></button>
                              )
                            ) : (
                              <span className={styles.linkedBadge}>交易</span>
                            )}
                          </div>
                        ))
                    )}
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      ) : (
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon}>🎯</span>
          <p className={styles.emptyTitle}>尚未建立儲蓄目標</p>
          <p className={styles.emptyHint}>在上方表單建立第一個目標，開始追蹤存款進度！</p>
        </div>
      )}

      {toast ? <div className={styles.toast}>{toast}</div> : null}
    </Screen>
  );
}
