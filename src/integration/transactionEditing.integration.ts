import {afterAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {signInAnonymously, signOut} from 'firebase/auth';
import {deleteDoc, doc, getDoc} from 'firebase/firestore';
import {auth, db} from '../services/firebase';
import {getAccountBalance, getTransactionById, loadGoals, loadMerchants, loadTransactions, loadTransfers, saveTransactionEdit, saveTransactionWithGoalLink, upsertAccount, upsertGoal, upsertTransaction} from '../services/storage';
import {TransactionEditConflict} from '../services/transactionEditing';
import type {Transaction} from '../types/finance';
const faults = vi.hoisted(() => ({goalCacheReads: false}));
vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {...actual, getDoc: (...args: Parameters<typeof actual.getDoc>) => {
    if (faults.goalCacheReads && args[0].path.includes('/goals/')) return Promise.reject(new Error('Injected post-commit cache failure'));
    return actual.getDoc(...args);
  }};
});
const tx = (patch: Partial<Transaction> = {}): Transaction => ({id: 'one', type: 'expense', amount: 100, currency: 'HKD', date: '2026-09-12', category: '飲食', createdAt: '2026-09-12T00:00:00Z', ...patch});
const ref = (name: string, id: string) => doc(db, 'users', auth.currentUser!.uid, name, id);
beforeEach(async () => { faults.goalCacheReads = false; if (auth.currentUser) await signOut(auth); await signInAnonymously(auth); });
afterAll(async () => { if (auth.currentUser) await signOut(auth); });
describe('guarded transaction edits', () => {
  it('fetches latest by ID and rejects editing another user record', async () => {
    const original = tx(); await upsertTransaction(original);
    expect(await getTransactionById(original.id)).toEqual(original);
    const foreignRef = ref('transactions', original.id);
    await signOut(auth); await signInAnonymously(auth);
    expect(await getTransactionById(original.id)).toBeNull();
    await expect(saveTransactionEdit(original, {...original, amount: 200})).rejects.toBeInstanceOf(TransactionEditConflict);
    await expect(getDoc(foreignRef)).rejects.toThrow();
    expect(await loadTransactions()).toEqual([]);
  });
  it('allows exactly one of two concurrent edits of the same snapshot', async () => {
    const original = tx(); await upsertTransaction(original);
    const results = await Promise.allSettled([saveTransactionEdit(original, {...original, amount: 200}), saveTransactionEdit(original, {...original, amount: 300})]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(r => r.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(TransactionEditConflict);
    expect([200, 300]).toContain((await getTransactionById(original.id))?.amount);
    expect(await loadTransactions()).toHaveLength(1);
  });
  it('does not recreate a concurrently deleted transaction or create its proposed merchant', async () => {
    const original = tx(); await upsertTransaction(original); await deleteDoc(ref('transactions', original.id));
    await expect(saveTransactionEdit(original, {...original, merchantId: 'new'}, {id: 'new', name: '新商戶', aliases: [], createdAt: ''})).rejects.toMatchObject({latest: null});
    expect(await getTransactionById(original.id)).toBeNull(); expect(await loadMerchants()).toEqual([]);
  });
  it('rejects stale edits without changing the linked goal or transfer', async () => {
    await upsertAccount({id: 'bank', name: '戶口', type: 'bank', initialBalance: 1000, currency: 'HKD', createdAt: ''});
    await upsertGoal({id: 'goal', name: '目標', targetAmount: 2000, savedAmount: 1000, accountId: 'bank'});
    const original = await saveTransactionWithGoalLink(tx({goalId: 'goal'}));
    const saved = await saveTransactionEdit(original, {...original, amount: 250});
    await expect(saveTransactionEdit(original, {...original, amount: 400})).rejects.toMatchObject({latest: saved.transaction});
    expect(await getAccountBalance('bank')).toBe(750);
    expect((await loadGoals())[0].savedAmount).toBe(750);
    expect(await loadTransfers()).toEqual([expect.objectContaining({amount: 250, transactionId: 'one'})]);
  });
  it('updates standalone goal withdrawal once and removes it on switching to income', async () => {
    await upsertGoal({id: 'goal', name: '目標', targetAmount: 2000, savedAmount: 1000});
    const original = await saveTransactionWithGoalLink(tx({goalId: 'goal'}));
    const saved = (await saveTransactionEdit(original, {...original, amount: 250})).transaction;
    expect((await loadGoals())[0].savedAmount).toBe(750);
    expect((await loadGoals())[0].deposits?.filter(e => e.linkedTransactionId === original.id)).toHaveLength(1);
    await saveTransactionEdit(saved, {...saved, type: 'income', goalId: undefined});
    expect((await loadGoals())[0].savedAmount).toBe(1000);
  });
  it('atomically relinks and unlinks an account without leaving an old transfer', async () => {
    for (const id of ['a', 'b']) await upsertAccount({id, name: id, type: 'bank', currency: 'HKD', initialBalance: 1000, createdAt: ''});
    const original = await saveTransactionWithGoalLink(tx({accountId: 'a'}));
    const saved = (await saveTransactionEdit(original, {...original, accountId: 'b', amount: 250})).transaction;
    expect(await getAccountBalance('a')).toBe(1000); expect(await getAccountBalance('b')).toBe(750); expect(await loadTransfers()).toHaveLength(1);
    const unlinked = (await saveTransactionEdit(saved, {...saved, accountId: undefined})).transaction;
    expect(unlinked.linkedTransferId).toBeUndefined(); expect(await loadTransfers()).toEqual([]); expect(await getAccountBalance('b')).toBe(1000);
  });
  it('keeps the account ledger in sync when an empty standalone goal cannot fund an edit', async () => {
    await upsertAccount({id: 'bank', name: '戶口', type: 'bank', initialBalance: 1000, currency: 'HKD', createdAt: ''});
    await upsertGoal({id: 'empty', name: '空目標', targetAmount: 2000, savedAmount: 0});
    const original = await saveTransactionWithGoalLink(tx({accountId: 'bank'}));
    const saved = (await saveTransactionEdit(original, {...original, goalId: 'empty', amount: 200})).transaction;
    expect(saved.goalId).toBeUndefined();
    expect(await getAccountBalance('bank')).toBe(800);
    expect(await loadTransfers()).toEqual([expect.objectContaining({amount: 200, transactionId: original.id})]);
  });
  it('reports a committed edit when the goal cache sync fails and prevents repeating it', async () => {
    await upsertAccount({id: 'bank', name: '戶口', type: 'bank', initialBalance: 1000, currency: 'HKD', createdAt: ''});
    await upsertGoal({id: 'goal', name: '目標', targetAmount: 2000, savedAmount: 1000, accountId: 'bank'});
    const original = await saveTransactionWithGoalLink(tx({goalId: 'goal'}));
    faults.goalCacheReads = true;
    const result = await saveTransactionEdit(original, {...original, amount: 300});
    expect(result.warnings).toEqual(['儲蓄目標餘額未能重新整理']);
    expect((await getTransactionById(original.id))?.amount).toBe(300);
    expect(await getAccountBalance('bank')).toBe(700);
    await expect(saveTransactionEdit(original, {...original, amount: 300})).rejects.toBeInstanceOf(TransactionEditConflict);
    expect(await loadTransfers()).toHaveLength(1);
    faults.goalCacheReads = false;
  });
});
