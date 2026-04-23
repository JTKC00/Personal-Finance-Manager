import {useCallback, useEffect, useMemo, useState} from 'react';
import {Card} from '../components/Card';
import {Screen} from '../components/Screen';
import {deleteGoal, loadGoals, upsertGoal, trackEvent} from '../services/storage';
import {Goal} from '../types/finance';
import styles from './GoalsScreen.module.css';

type Draft = {
  name: string;
  targetAmount: string;
  savedAmount: string;
  targetDate: string;
};

const formatMoney = (v: number) => `$${Math.round(v).toLocaleString()}`;
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
  const [toast, setToast] = useState('');

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
    const goal: Goal = {
      id: editingId || Date.now().toString(),
      name: draft.name.trim(),
      targetAmount: target,
      savedAmount: saved,
      targetDate: draft.targetDate || undefined,
      deposits: existing?.deposits,
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
    if (!window.confirm(`確定刪除目標「${goal.name}」？這不會刪除關聯的交易記錄。`)) return;
    await deleteGoal(goal.id);
    await trackEvent('delete_goal_success', {goalName: goal.name});
    if (editingId === goal.id) resetForm();
    await refresh();
    showToast('目標已刪除。');
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
        <input
          type="number"
          inputMode="decimal"
          placeholder="目前存款"
          className={styles.input}
          value={draft.savedAmount}
          onChange={e => updateDraft({savedAmount: e.target.value})}
        />
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
            const remaining = Math.max(0, goal.targetAmount - goal.savedAmount);
            return (
              <Card key={goal.id} title={goal.name}>
                <div className={styles.goalHeader}>
                  <span className={styles.goalPct}>{pct}%</span>
                  <span className={styles.goalAmt}>{formatMoney(goal.savedAmount)} / {formatMoney(goal.targetAmount)}</span>
                </div>
                <div className={styles.progressTrack}>
                  <div
                    className={[styles.progressFill, pct >= 100 ? styles.fillDone : pct >= 60 ? styles.fillGood : ''].join(' ')}
                    style={{width: `${pct}%`}}
                  />
                </div>
                <div className={styles.goalMeta}>
                  <span className={styles.remaining}>還差 {formatMoney(remaining)}</span>
                  {goal.targetDate ? <span className={styles.deadline}>截止：{goal.targetDate}</span> : null}
                </div>
                <div className={styles.actionRow}>
                  <button className={styles.textBtn} onClick={() => startEdit(goal)}>編輯</button>
                  <button className={[styles.textBtn, styles.deleteBtn].join(' ')} onClick={() => confirmDelete(goal)}>刪除</button>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card title="">
          <p className={styles.hint}>尚無目標。建立第一個儲蓄目標吧！</p>
        </Card>
      )}

      {toast ? <div className={styles.toast}>{toast}</div> : null}
    </Screen>
  );
}
