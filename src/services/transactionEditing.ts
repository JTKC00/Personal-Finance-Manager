import type {Transaction} from '../types/finance';

export class TransactionEditConflict extends Error {
  constructor(public latest: Transaction | null) {
    super(latest ? '這筆交易已在其他地方更新。你的輸入已保留，請查看最新版本後再編輯。' : '這筆交易已被刪除。你的輸入已保留，無法儲存回原交易。');
    this.name = 'TransactionEditConflict';
  }
}

/** Compare persisted values, ignoring absent optional fields and object key order. */
export function sameTransaction(left: Transaction, right: Transaction): boolean {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, normalize(v)]));
    return value;
  };
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

export type TransactionSaveResult = {transaction: Transaction; warnings: string[]};

/** Only the commit may reject. Follow-up failures must never invite a second write. */
export async function completeTransactionSave(transaction: Transaction, followups: Array<{label: string; run: () => Promise<unknown>}>, timeoutMs = 5000): Promise<TransactionSaveResult> {
  const results = await Promise.allSettled(followups.map(async task => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Firestore may leave an offline cache write pending indefinitely after the ledger committed.
      await Promise.race([Promise.resolve().then(task.run), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('後續更新逾時')), timeoutMs);
      })]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }));
  return {transaction, warnings: results.flatMap((result, i) => result.status === 'rejected' ? [followups[i].label] : [])};
}
