import {useCallback, useState} from 'react';
import {Alert, Platform, Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import DateTimePicker, {DateTimePickerEvent} from '@react-native-community/datetimepicker';
import {useFocusEffect} from '@react-navigation/native';
import {Card} from '../components/Card';
import {Screen} from '../components/Screen';
import {deleteGoal, getCurrentMonthKey, getMonthlySummary, loadGoals, trackEvent, upsertGoal} from '../services/storage';
import {colors, spacing} from '../theme';
import {Goal} from '../types/finance';

const formatMoney = (v: number) => `$${Math.round(v).toLocaleString()}`;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function GoalsScreen() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [monthlySaving, setMonthlySaving] = useState(0);

  // Add / edit form
  const [name, setName] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Inline deposit form
  const [depositGoalId, setDepositGoalId] = useState<string | null>(null);
  const [depositAmount, setDepositAmount] = useState('');

  const refresh = useCallback(async () => {
    const month = getCurrentMonthKey();
    const [nextGoals, summary] = await Promise.all([loadGoals(), getMonthlySummary(month)]);
    setGoals(nextGoals);
    setMonthlySaving(summary.balance);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  function resetForm() {
    setName('');
    setTargetAmount('');
    setTargetDate('');
    setEditingId(null);
  }

  async function saveGoal() {
    const amount = Number(targetAmount);
    if (!name.trim() || !amount || amount <= 0) {
      Alert.alert('請確認目標內容', '名稱與目標金額為必填。');
      return;
    }

    if (editingId) {
      const existing = goals.find(g => g.id === editingId);
      if (!existing) return;
      const updated: Goal = {
        ...existing,
        name: name.trim(),
        targetAmount: amount,
        targetDate: targetDate || undefined,
        savedAmount: Math.min(existing.savedAmount, amount)
      };
      await upsertGoal(updated);
      await trackEvent('goal_edit_success', {id: editingId});
    } else {
      const newGoal: Goal = {
        id: Date.now().toString(),
        name: name.trim(),
        targetAmount: amount,
        targetDate: targetDate || undefined,
        savedAmount: 0,
        deposits: []
      };
      await upsertGoal(newGoal);
      await trackEvent('goal_create_success', {name: name.trim()});
    }

    await refresh();
    resetForm();
    Alert.alert(editingId ? '已更新' : '已建立', editingId ? '目標已更新。' : '新目標已建立。');
  }

  function startEdit(goal: Goal) {
    setEditingId(goal.id);
    setName(goal.name);
    setTargetAmount(String(goal.targetAmount));
    setTargetDate(goal.targetDate || '');
    setDepositGoalId(null);
    setDepositAmount('');
  }

  function confirmDelete(goal: Goal) {
    Alert.alert('刪除目標', `確定刪除「${goal.name}」？`, [
      {text: '取消', style: 'cancel'},
      {
        text: '刪除',
        style: 'destructive',
        onPress: async () => {
          await deleteGoal(goal.id);
          await trackEvent('goal_delete_success', {id: goal.id});
          if (editingId === goal.id) resetForm();
          await refresh();
        }
      }
    ]);
  }

  async function confirmDeposit() {
    const goal = goals.find(g => g.id === depositGoalId);
    if (!goal) return;
    const amount = Number(depositAmount);
    if (!amount || amount <= 0) {
      Alert.alert('請輸入有效金額');
      return;
    }
    const newSaved = Math.min(goal.savedAmount + amount, goal.targetAmount);
    const deposits = [
      ...(goal.deposits || []),
      {amount, date: new Date().toISOString().split('T')[0]}
    ];
    await upsertGoal({...goal, savedAmount: newSaved, deposits});
    await trackEvent('goal_deposit_success', {goalId: goal.id, amount});
    setDepositGoalId(null);
    setDepositAmount('');
    await refresh();
  }

  function handleDateChange(event: DateTimePickerEvent, date?: Date) {
    if (Platform.OS === 'android') setShowDatePicker(false);
    if (event.type === 'dismissed' || !date) return;
    setTargetDate(formatDate(date));
  }

  const canSaveGoal = name.trim().length > 0 && Number(targetAmount) > 0;

  return (
    <Screen title="目標" subtitle="建立儲蓄目標、追蹤進度與手動存入">
      {/* Add / edit form */}
      <Card title={editingId ? '編輯目標' : '新增目標'}>
        <TextInput
          onChangeText={setName}
          placeholder="目標名稱（例：日本旅行）"
          style={styles.input}
          value={name}
        />
        <TextInput
          keyboardType="numeric"
          onChangeText={setTargetAmount}
          placeholder="目標金額"
          style={styles.input}
          value={targetAmount}
        />
        <Pressable
          accessibilityLabel="選擇目標日期"
          accessibilityRole="button"
          onPress={() => setShowDatePicker(true)}
          style={styles.dateButton}
        >
          <Text style={targetDate ? styles.dateText : styles.datePlaceholder}>
            {targetDate || '目標日期（選填）'}
          </Text>
        </Pressable>
        {showDatePicker ? (
          <DateTimePicker
            display={Platform.OS === 'ios' ? 'inline' : 'calendar'}
            minimumDate={new Date()}
            mode="date"
            onChange={handleDateChange}
            value={targetDate ? new Date(targetDate) : new Date()}
          />
        ) : null}
        <View style={styles.actionRow}>
          <Pressable
            disabled={!canSaveGoal}
            onPress={saveGoal}
            style={[styles.button, !canSaveGoal && styles.disabledButton]}
          >
            <Text style={styles.buttonText}>{editingId ? '儲存變更' : '新增目標'}</Text>
          </Pressable>
          {editingId ? (
            <Pressable onPress={resetForm} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>取消</Text>
            </Pressable>
          ) : null}
        </View>
      </Card>

      {/* Inline deposit form */}
      {depositGoalId ? (
        <Card title="手動存入">
          <Text style={styles.depositLabel}>
            {goals.find(g => g.id === depositGoalId)?.name ?? ''}
          </Text>
          <TextInput
            autoFocus
            keyboardType="numeric"
            onChangeText={setDepositAmount}
            placeholder="存入金額"
            style={styles.input}
            value={depositAmount}
          />
          <View style={styles.actionRow}>
            <Pressable
              disabled={!Number(depositAmount)}
              onPress={confirmDeposit}
              style={[styles.button, !Number(depositAmount) && styles.disabledButton]}
            >
              <Text style={styles.buttonText}>確認存入</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setDepositGoalId(null);
                setDepositAmount('');
              }}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>取消</Text>
            </Pressable>
          </View>
        </Card>
      ) : null}

      {/* Goals list */}
      <Card title="儲蓄目標">
        {goals.length === 0 ? (
          <Text style={styles.empty}>尚未建立目標，新增第一個目標開始追蹤！</Text>
        ) : (
          goals.map(goal => {
            const progress = goal.targetAmount > 0
              ? clamp(goal.savedAmount / goal.targetAmount, 0, 1)
              : 0;
            const remaining = goal.targetAmount - goal.savedAmount;
            const done = goal.savedAmount >= goal.targetAmount;
            return (
              <View key={goal.id} style={styles.goalRow}>
                <View style={styles.goalHeader}>
                  <Text style={styles.goalName}>{goal.name}</Text>
                  <Text style={[styles.goalPercent, done && styles.goalDone]}>
                    {done ? '✓ 完成' : `${Math.round(progress * 100)}%`}
                  </Text>
                </View>
                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      done ? styles.progressDone : styles.progressActive,
                      {width: `${Math.round(progress * 100)}%`}
                    ]}
                  />
                </View>
                <Text style={styles.goalMeta}>
                  已存 {formatMoney(goal.savedAmount)} / {formatMoney(goal.targetAmount)}
                  {!done ? ` · 還差 ${formatMoney(remaining)}` : ''}
                  {goal.targetDate ? ` · 目標日 ${goal.targetDate}` : ''}
                </Text>
                <View style={styles.goalActions}>
                  {!done ? (
                    <Pressable onPress={() => setDepositGoalId(goal.id)} style={styles.textButton}>
                      <Text style={styles.textButtonLabel}>存入</Text>
                    </Pressable>
                  ) : null}
                  <Pressable onPress={() => startEdit(goal)} style={styles.textButton}>
                    <Text style={styles.textButtonLabel}>編輯</Text>
                  </Pressable>
                  <Pressable onPress={() => confirmDelete(goal)} style={styles.textButton}>
                    <Text style={[styles.textButtonLabel, styles.deleteLabel]}>刪除</Text>
                  </Pressable>
                </View>
              </View>
            );
          })
        )}
      </Card>

      {/* Monthly suggestion */}
      <Card title="本月建議">
        <Text style={styles.tipText}>
          {monthlySaving > 0
            ? `本月結餘約 ${formatMoney(monthlySaving)}，建議優先存入距完成最近的目標。`
            : monthlySaving < 0
            ? `本月支出超過收入 ${formatMoney(Math.abs(monthlySaving))}，建議先降低非必要支出再存入目標。`
            : '本月尚無收支資料，新增交易後這裡會顯示建議。'}
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    color: colors.text,
    fontSize: 16,
    marginBottom: spacing.md,
    padding: spacing.md
  },
  dateButton: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.md,
    padding: spacing.md
  },
  dateText: {
    color: colors.text,
    fontSize: 16
  },
  datePlaceholder: {
    color: colors.textMuted,
    fontSize: 16
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm
  },
  button: {
    alignItems: 'center',
    backgroundColor: colors.text,
    borderRadius: 8,
    flex: 1,
    padding: spacing.md
  },
  disabledButton: {
    opacity: 0.4
  },
  buttonText: {
    color: colors.surface,
    fontWeight: '600'
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    padding: spacing.md
  },
  secondaryButtonText: {
    color: colors.text,
    fontWeight: '600'
  },
  depositLabel: {
    color: colors.text,
    fontWeight: '600',
    marginBottom: spacing.md
  },
  goalRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.md
  },
  goalHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm
  },
  goalName: {
    color: colors.text,
    flex: 1,
    fontSize: 15,
    fontWeight: '600'
  },
  goalPercent: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600'
  },
  goalDone: {
    color: colors.success
  },
  progressTrack: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 8,
    height: 8,
    marginBottom: spacing.sm,
    overflow: 'hidden'
  },
  progressFill: {
    borderRadius: 8,
    height: '100%'
  },
  progressActive: {
    backgroundColor: colors.text
  },
  progressDone: {
    backgroundColor: colors.success
  },
  goalMeta: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: spacing.sm
  },
  goalActions: {
    flexDirection: 'row',
    gap: spacing.md
  },
  textButton: {
    paddingVertical: 2
  },
  textButtonLabel: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600'
  },
  deleteLabel: {
    color: colors.danger
  },
  empty: {
    color: colors.textMuted,
    lineHeight: 20
  },
  tipText: {
    color: colors.text,
    lineHeight: 20
  }
});
