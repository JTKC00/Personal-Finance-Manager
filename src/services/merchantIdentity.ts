import {compareSpendGroups, compareSpendGroupsAcrossMonths, type SpendGroupComparison} from './comparisonEngine';
import {normalizeMerchant} from './ocrLogic';
import type {Merchant, Transaction} from '../types/finance';

export type MerchantMatchConfidence = 'high' | 'medium' | 'low';

export type MerchantMatch = {
  merchant: Merchant;
  confidence: MerchantMatchConfidence;
  matchedOn: string;
  score: number;
};

export type DuplicateMerchantSuggestion = {
  leftId: string;
  rightId: string;
  leftName: string;
  rightName: string;
  reason: string;
  score: number;
};

const HIGH_SCORE = 1;
const MEDIUM_SCORE = 0.85;
const LOW_SCORE = 0.72;

export function merchantKeys(merchant: Merchant): string[] {
  return uniqueNonEmpty([merchant.name, ...merchant.aliases].map(normalizeMerchant));
}

export function findMerchantMatches(query: string, merchants: Merchant[]): MerchantMatch[] {
  const needle = normalizeMerchant(query);
  if (!needle) return [];

  return merchants
    .map(merchant => scoreMerchant(needle, query.trim(), merchant))
    .filter((item): item is MerchantMatch => Boolean(item))
    .sort((left, right) => right.score - left.score || left.merchant.name.localeCompare(right.merchant.name));
}

export function findExactMerchant(query: string, merchants: Merchant[]): Merchant | undefined {
  return findMerchantMatches(query, merchants).find(item => item.confidence === 'high')?.merchant;
}

export function suggestDuplicateMerchants(merchants: Merchant[]): DuplicateMerchantSuggestion[] {
  const suggestions: DuplicateMerchantSuggestion[] = [];
  for (let i = 0; i < merchants.length; i += 1) {
    for (let j = i + 1; j < merchants.length; j += 1) {
      const left = merchants[i];
      const right = merchants[j];
      const overlap = merchantKeys(left).find(key => merchantKeys(right).includes(key));
      if (overlap) {
        suggestions.push({
          leftId: left.id,
          rightId: right.id,
          leftName: left.name,
          rightName: right.name,
          reason: '名稱或別名正規化後相同',
          score: HIGH_SCORE,
        });
        continue;
      }
      const best = bestCrossScore(left, right);
      if (best && best.score >= LOW_SCORE) {
        suggestions.push({
          leftId: left.id,
          rightId: right.id,
          leftName: left.name,
          rightName: right.name,
          reason: best.score >= MEDIUM_SCORE ? '名稱非常接近' : '名稱相似，請確認是否同一商戶',
          score: best.score,
        });
      }
    }
  }
  return suggestions.sort((left, right) => right.score - left.score);
}

export function mergeMerchantRecords(target: Merchant, source: Merchant): Merchant {
  const aliases = uniqueNonEmpty([
    ...target.aliases,
    ...source.aliases,
    source.name !== target.name ? source.name : '',
  ]).filter(alias => normalizeMerchant(alias) !== normalizeMerchant(target.name));
  return {...target, aliases};
}

export function addMerchantAlias(merchant: Merchant, alias: string): Merchant {
  const trimmed = alias.trim();
  if (!trimmed) return merchant;
  if (normalizeMerchant(trimmed) === normalizeMerchant(merchant.name)) return merchant;
  if (merchant.aliases.some(item => normalizeMerchant(item) === normalizeMerchant(trimmed))) return merchant;
  return {...merchant, aliases: [...merchant.aliases, trimmed]};
}

export type MerchantSavePlan =
  | {ok: true; merchantText?: string; merchant?: string; merchantId?: string; upsert?: Merchant}
  | {ok: false; reason: 'unresolved_suggestion'; suggestion: MerchantMatch};

export function unresolvedMerchantSuggestion(
  text: string,
  merchantId: string | undefined,
  createNew: boolean,
  merchants: Merchant[]
): MerchantMatch | undefined {
  if (merchantId || createNew || !text.trim()) return undefined;
  if (findExactMerchant(text, merchants)) return undefined;
  return findMerchantMatches(text, merchants).find(item => item.confidence !== 'high');
}

export function planMerchantSave(
  text: string,
  merchantId: string | undefined,
  createNew: boolean,
  merchants: Merchant[],
  now = new Date()
): MerchantSavePlan {
  const trimmed = text.trim();
  if (!trimmed) return {ok: true};

  const blocked = unresolvedMerchantSuggestion(trimmed, merchantId, createNew, merchants);
  if (blocked) {
    return {ok: false, reason: 'unresolved_suggestion', suggestion: blocked};
  }

  if (merchantId) {
    const existing = merchants.find(item => item.id === merchantId);
    if (!existing) {
      return {ok: true, merchantText: trimmed, merchant: trimmed};
    }
    const next = addMerchantAlias(existing, trimmed);
    return {
      ok: true,
      merchantText: trimmed,
      merchant: existing.name,
      merchantId: existing.id,
      upsert: next.aliases.length !== existing.aliases.length ? next : undefined,
    };
  }

  const exact = findExactMerchant(trimmed, merchants);
  if (exact && !createNew) {
    return {
      ok: true,
      merchantText: trimmed,
      merchant: exact.name,
      merchantId: exact.id,
    };
  }

  const created: Merchant = {
    id: `merch-${now.getTime()}`,
    name: trimmed,
    aliases: [],
    createdAt: now.toISOString(),
  };
  return {
    ok: true,
    merchantText: trimmed,
    merchant: trimmed,
    merchantId: created.id,
    upsert: created,
  };
}

export function resolveTransactionMerchantDisplay(transaction: Transaction, merchants: Merchant[]): string {
  if (transaction.merchantId) {
    const linked = merchants.find(item => item.id === transaction.merchantId);
    if (linked) return linked.name;
  }
  return transaction.merchantText || transaction.merchant || '';
}

function resolveMerchantGroup(transaction: Transaction, merchants: Merchant[]) {
  if (transaction.merchantId) {
    const linked = merchants.find(item => item.id === transaction.merchantId);
    return {
      key: `id:${transaction.merchantId}`,
      label: linked?.name || '已刪除商戶',
      linked: Boolean(linked),
    };
  }
  const raw = (transaction.merchantText || transaction.merchant || '').trim();
  if (!raw) return null;
  return {
    key: `text:${normalizeMerchant(raw)}`,
    label: raw,
    linked: false,
  };
}

function splitMerchantRows(rows: SpendGroupComparison[]) {
  return {
    linked: rows.filter(item => item.linked),
    unlinked: rows.filter(item => !item.linked),
  };
}

export function compareMerchants(
  currentTransactions: Transaction[],
  comparisonTransactions: Transaction[],
  merchants: Merchant[]
): {linked: SpendGroupComparison[]; unlinked: SpendGroupComparison[]} {
  return splitMerchantRows(compareSpendGroups(currentTransactions, comparisonTransactions, transaction => {
    return resolveMerchantGroup(transaction, merchants);
  }));
}

export function compareMerchantsAcrossMonths(
  currentTransactions: Transaction[],
  monthlyComparison: Record<string, Transaction[]>,
  availableMonths: string[],
  merchants: Merchant[]
): {linked: SpendGroupComparison[]; unlinked: SpendGroupComparison[]} {
  return splitMerchantRows(compareSpendGroupsAcrossMonths(
    currentTransactions,
    monthlyComparison,
    availableMonths,
    transaction => resolveMerchantGroup(transaction, merchants)
  ));
}

function scoreMerchant(needle: string, rawQuery: string, merchant: Merchant): MerchantMatch | null {
  const candidates = uniqueNonEmpty([merchant.name, ...merchant.aliases]);
  let best: MerchantMatch | null = null;
  for (const candidate of candidates) {
    const key = normalizeMerchant(candidate);
    if (!key) continue;
    const score = key === needle
      ? HIGH_SCORE
      : key.includes(needle) || needle.includes(key)
        ? roundScore(Math.min(key.length, needle.length) / Math.max(key.length, needle.length))
        : similarity(key, needle);
    const confidence: MerchantMatchConfidence = key === needle
      ? 'high'
      : score >= MEDIUM_SCORE ? 'medium' : 'low';
    if (score < LOW_SCORE) continue;
    if (!best || score > best.score) {
      best = {merchant, confidence, matchedOn: candidate, score};
    }
  }
  if (best && rawQuery && best.merchant.name === rawQuery) {
    return {...best, confidence: 'high', score: HIGH_SCORE};
  }
  return best;
}

function bestCrossScore(left: Merchant, right: Merchant): {score: number} | null {
  let best = 0;
  for (const leftKey of merchantKeys(left)) {
    for (const rightKey of merchantKeys(right)) {
      const score = leftKey === rightKey ? HIGH_SCORE : similarity(leftKey, rightKey);
      if (score > best) best = score;
    }
  }
  return best >= LOW_SCORE ? {score: best} : null;
}

function similarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const distance = levenshtein(left, right);
  return roundScore(1 - distance / Math.max(left.length, right.length));
}

function levenshtein(left: string, right: string): number {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const grid = Array.from({length: rows}, () => Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i += 1) grid[i][0] = i;
  for (let j = 0; j < cols; j += 1) grid[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      grid[i][j] = Math.min(grid[i - 1][j] + 1, grid[i][j - 1] + 1, grid[i - 1][j - 1] + cost);
    }
  }
  return grid[left.length][right.length];
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach(value => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const key = normalizeMerchant(trimmed) || trimmed;
    if (seen.has(key)) return;
    seen.add(key);
    result.push(trimmed);
  });
  return result;
}

function roundScore(value: number): number {
  return Math.round(value * 1000) / 1000;
}
