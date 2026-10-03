import {afterAll, beforeEach, describe, expect, it} from 'vitest';
import {signInAnonymously, signOut} from 'firebase/auth';
import {deleteDoc, doc, getDoc, setDoc} from 'firebase/firestore';
import {auth, db} from '../services/firebase';
import {createFinanceBackup, getCurrentMonthKey, loadBudgetMonth, loadBudgetMonthSnapshot, saveBudgetMonth, saveCurrentMonthBudgets} from '../services/storage';
import {BudgetEditConflict, budgetDraft, parseBudgetDraft} from '../services/budgetEditing';
import {shiftMonthKey} from '../services/comparisonEngine';
const ref = (collection: string, id: string) => doc(db, 'users', auth.currentUser!.uid, collection, id);
beforeEach(async () => { if (auth.currentUser) await signOut(auth); await signInAnonymously(auth); });
afterAll(async () => { if (auth.currentUser) await signOut(auth); });

describe('monthly budget persistence', () => {
  it('saves a historical month without changing the current budget and includes it in backups', async () => {
    const current = getCurrentMonthKey(), past = shiftMonthKey(current, -1);
    await saveCurrentMonthBudgets({餐飲: 3000});
    const snapshot = await loadBudgetMonthSnapshot(past);
    expect(snapshot.budgets).toBeNull();
    await saveBudgetMonth(snapshot, {餐飲: 1200, 交通: 800});
    expect(await loadBudgetMonth(past)).toEqual({餐飲: 1200, 交通: 800});
    expect(await loadBudgetMonth(current)).toEqual({餐飲: 3000});
    expect((await getDoc(ref('meta', 'budgets'))).data()).toEqual({餐飲: 3000});
    expect((await createFinanceBackup('budget-test@example.test')).budgetMonths).toContainEqual({month: past, budgets: {餐飲: 1200, 交通: 800}});
  });
  it('reads the latest legacy current budget and atomically updates both documents', async () => {
    const month = getCurrentMonthKey();
    await saveCurrentMonthBudgets({餐飲: 100});
    await setDoc(ref('meta', 'budgets'), {餐飲: 150, 舊分類: 20});
    const snapshot = await loadBudgetMonthSnapshot(month);
    expect(snapshot.budgets).toEqual({餐飲: 150, 舊分類: 20});
    const budgets = parseBudgetDraft({...budgetDraft(snapshot.budgets, ['餐飲']), 餐飲: '200'}).budgets;
    await saveBudgetMonth(snapshot, budgets);
    for (const reference of [ref('meta', 'budgets'), ref('budgetMonths', month)]) expect((await getDoc(reference)).data()).toEqual({餐飲: 200, 舊分類: 20});
  });
  it('keeps copied data as a draft until saving and distinguishes a cleared month', async () => {
    const current = getCurrentMonthKey(), source = shiftMonthKey(current, -1);
    await saveCurrentMonthBudgets({餐飲: 999});
    await saveBudgetMonth(await loadBudgetMonthSnapshot(source), {餐飲: .1, 交通: .2});
    const copied = budgetDraft((await loadBudgetMonthSnapshot(source)).budgets, ['餐飲', '交通']);
    expect(await loadBudgetMonth(current)).toEqual({餐飲: 999});
    await saveBudgetMonth(await loadBudgetMonthSnapshot(current), parseBudgetDraft(copied).budgets);
    expect(await loadBudgetMonth(current)).toEqual({餐飲: .1, 交通: .2});
    await saveBudgetMonth(await loadBudgetMonthSnapshot(source), {});
    expect(await loadBudgetMonth(source)).toEqual({});
    expect(await loadBudgetMonth(shiftMonthKey(source, -1))).toBeNull();
  });
  it('allows only one of two concurrent saves of the same month', async () => {
    const month = getCurrentMonthKey();
    await saveCurrentMonthBudgets({餐飲: 100});
    const snapshot = await loadBudgetMonthSnapshot(month);
    const results = await Promise.allSettled([saveBudgetMonth(snapshot, {餐飲: 200}), saveBudgetMonth(snapshot, {餐飲: 300})]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({reason: expect.any(BudgetEditConflict)});
    const legacy = (await getDoc(ref('meta', 'budgets'))).data();
    expect((await getDoc(ref('budgetMonths', month))).data()).toEqual(legacy);
  });
  it('detects current-month legacy changes from an older client and rejects stale writes', async () => {
    const month = getCurrentMonthKey();
    await saveCurrentMonthBudgets({餐飲: 100});
    const snapshot = await loadBudgetMonthSnapshot(month);
    await setDoc(ref('meta', 'budgets'), {餐飲: 150});
    await expect(saveBudgetMonth(snapshot, {餐飲: 200})).rejects.toBeInstanceOf(BudgetEditConflict);
    expect(await loadBudgetMonth(month)).toEqual({餐飲: 150});
    expect((await getDoc(ref('budgetMonths', month))).data()).toEqual({餐飲: 100});
  });
  it('rejects a deleted historical record without silently recreating it', async () => {
    const month = shiftMonthKey(getCurrentMonthKey(), -1);
    await saveBudgetMonth(await loadBudgetMonthSnapshot(month), {餐飲: 100});
    const snapshot = await loadBudgetMonthSnapshot(month);
    await deleteDoc(ref('budgetMonths', month));
    await expect(saveBudgetMonth(snapshot, {餐飲: 200})).rejects.toBeInstanceOf(BudgetEditConflict);
    expect(await loadBudgetMonth(month)).toBeNull();
  });
  it('rejects invalid money, future months and a month rollover before any write', async () => {
    const month = getCurrentMonthKey();
    const snapshot = await loadBudgetMonthSnapshot(month);
    await expect(saveBudgetMonth(snapshot, {餐飲: -1})).rejects.toThrow();
    await expect(saveBudgetMonth(await loadBudgetMonthSnapshot(shiftMonthKey(month, 1)), {餐飲: 100})).rejects.toThrow('本月或歷史');
    await expect(saveBudgetMonth({...snapshot, currentMonth: shiftMonthKey(month, -1)}, {餐飲: 100})).rejects.toThrow('月份已改變');
    expect((await getDoc(ref('meta', 'budgets'))).exists()).toBe(false);
    expect((await getDoc(ref('budgetMonths', month))).exists()).toBe(false);
  });
  it('keeps snapshots and direct Firestore reads isolated between users', async () => {
    await saveCurrentMonthBudgets({餐飲: 100});
    const snapshot = await loadBudgetMonthSnapshot(getCurrentMonthKey());
    const foreignRef = ref('budgetMonths', snapshot.month);
    await signOut(auth); await signInAnonymously(auth);
    await expect(saveBudgetMonth(snapshot, {餐飲: 999})).rejects.toThrow('登入帳戶已改變');
    await expect(getDoc(foreignRef)).rejects.toThrow();
    expect(await loadBudgetMonth(snapshot.month)).toEqual({});
  });
});
