import {describe, expect, it} from 'vitest';
import type {Merchant, Transaction} from '../types/finance';
import {
  addMerchantAlias,
  compareMerchants,
  findExactMerchant,
  findMerchantMatches,
  mergeMerchantRecords,
  planMerchantSave,
  resolveTransactionMerchantDisplay,
  suggestDuplicateMerchants,
} from './merchantIdentity';

function merchant(patch: Partial<Merchant> = {}): Merchant {
  return {
    id: 'merch-1',
    name: '麥當勞',
    aliases: ['McDonald\'s', 'McDonalds'],
    createdAt: '2026-08-01T00:00:00.000Z',
    ...patch,
  };
}

function tx(patch: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    type: 'expense',
    amount: 42,
    currency: 'HKD',
    date: '2026-08-10',
    category: '餐飲',
    createdAt: '2026-08-10T00:00:00.000Z',
    ...patch,
  };
}

describe('merchant identity matching', () => {
  it('treats canonical name and aliases as the same merchant', () => {
    const mcdonalds = merchant();
    expect(findExactMerchant('麥當勞', [mcdonalds])?.id).toBe('merch-1');
    expect(findExactMerchant("McDonald's", [mcdonalds])?.id).toBe('merch-1');
    expect(findExactMerchant('mcdonalds', [mcdonalds])?.id).toBe('merch-1');
    expect(findMerchantMatches('M記', [mcdonalds])[0]?.confidence).not.toBe('high');
  });

  it('suggests similar merchants without merging them', () => {
    const suggestions = suggestDuplicateMerchants([
      merchant(),
      merchant({id: 'merch-2', name: 'McDonalds', aliases: []}),
      merchant({id: 'merch-3', name: '星巴克', aliases: ['Starbucks']}),
    ]);
    expect(suggestions.some(item => item.leftId === 'merch-1' && item.rightId === 'merch-2')).toBe(true);
    expect(suggestions.some(item => item.leftName === '星巴克' || item.rightName === '星巴克')).toBe(false);
  });
});

describe('merchant merge', () => {
  it('merges aliases, keeps the canonical name, and never touches merchantText', () => {
    const merged = mergeMerchantRecords(
      merchant({aliases: ['McDonald\'s']}),
      merchant({id: 'merch-2', name: 'M記', aliases: ['麥記']})
    );
    expect(merged.id).toBe('merch-1');
    expect(merged.name).toBe('麥當勞');
    expect(merged.aliases).toEqual(['McDonald\'s', '麥記', 'M記']);

    const withAlias = addMerchantAlias(merchant({aliases: []}), 'M記');
    expect(withAlias.aliases).toEqual(['M記']);
    expect(addMerchantAlias(withAlias, 'M記').aliases).toEqual(['M記']);
  });

  it('groups analysis by merchantId and preserves unlinked raw text separately', () => {
    const merchants = [merchant()];
    const current = [
      tx({id: 'a', amount: 80, merchantId: 'merch-1', merchantText: 'M記', merchant: '麥當勞'}),
      tx({id: 'b', amount: 20, merchantText: '茶記', merchant: '茶記'}),
    ];
    const previous = [
      tx({id: 'c', amount: 30, merchantId: 'merch-1', merchantText: "McDonald's", merchant: '麥當勞'}),
    ];
    const {linked, unlinked} = compareMerchants(current, previous, merchants);
    expect(linked[0]).toMatchObject({
      label: '麥當勞',
      currentAmount: 80,
      comparisonAmount: 30,
      currentCount: 1,
      linked: true,
    });
    expect(unlinked[0]).toMatchObject({label: '茶記', currentAmount: 20, linked: false});
    expect(resolveTransactionMerchantDisplay(current[0], merchants)).toBe('麥當勞');
    expect(current[0].merchantText).toBe('M記');
  });

  it('plans a confirmed link, a new merchant, and an alias addition', () => {
    const existing = merchant();
    expect(planMerchantSave('M記', 'merch-1', false, [existing]).upsert?.aliases).toContain('M記');
    const createdAt = new Date('2026-08-10T00:00:00.000Z');
    expect(planMerchantSave('茶記', undefined, true, [existing], createdAt)).toMatchObject({
      merchant: '茶記',
      merchantId: `merch-${createdAt.getTime()}`,
    });
    expect(planMerchantSave("McDonald's", undefined, false, [existing]).merchantId).toBe('merch-1');
  });
});
