import {describe, expect, it} from 'vitest';
import type {Account, PaymentInstrument, Transaction} from '../types/finance';
import {
  compareAccounts,
  comparePaymentInstruments,
  comparePaymentTypes,
  formatInstrumentLabel,
  paymentMethodFromType,
  paymentTypeFromMethod,
  resolveInstrumentAccount,
  resolveSubscriptionPosting,
  subscriptionPaymentFromDraft,
  subscriptionPaymentLabel,
  validateLast4,
} from './paymentInstrument';

function instrument(patch: Partial<PaymentInstrument> = {}): PaymentInstrument {
  return {
    id: 'pay-1',
    name: 'HSBC Red Card',
    type: 'credit_card',
    last4: '1234',
    active: true,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...patch,
  };
}

function tx(patch: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    type: 'expense',
    amount: 100,
    currency: 'HKD',
    date: '2026-08-10',
    category: '購物',
    createdAt: '2026-08-10T00:00:00.000Z',
    ...patch,
  };
}

describe('payment instrument helpers', () => {
  it('creates, labels, and maps types without storing a full card number', () => {
    const card = instrument({accountId: 'account-1'});
    expect(formatInstrumentLabel(card)).toBe('HSBC Red Card ••••1234');
    expect(paymentMethodFromType('e_wallet')).toBe('電子錢包');
    expect(paymentTypeFromMethod('信用卡')).toBe('credit_card');
    expect(validateLast4('1234')).toEqual({ok: true, last4: '1234'});
    expect(validateLast4('')).toEqual({ok: true});
    expect(validateLast4('1234567890123456').ok).toBe(false);
    expect(validateLast4('12 34').ok).toBe(false);
    expect(card.accountId).toBe('account-1');
  });

  it('keeps inactive instruments out of the happy-path type mapping but still readable', () => {
    const inactive = instrument({id: 'pay-old', name: '舊卡', active: false, last4: '9999'});
    expect(inactive.active).toBe(false);
    expect(formatInstrumentLabel(inactive)).toBe('舊卡 ••••9999');
  });

  it('compares payment type and specific instrument separately', () => {
    const instruments = [
      instrument(),
      instrument({id: 'pay-2', name: 'AlipayHK', type: 'e_wallet', last4: undefined}),
    ];
    const current = [
      tx({id: 'c1', amount: 300, paymentInstrumentId: 'pay-1', paymentMethod: '信用卡'}),
      tx({id: 'c2', amount: 50, paymentInstrumentId: 'pay-2', paymentMethod: '電子錢包'}),
      tx({id: 'c3', amount: 20, paymentMethod: '現金'}),
    ];
    const previous = [
      tx({id: 'p1', amount: 100, paymentInstrumentId: 'pay-1', paymentMethod: '信用卡'}),
    ];

    const types = comparePaymentTypes(current, previous, instruments);
    expect(types.find(item => item.key === 'credit_card')).toMatchObject({
      currentAmount: 300,
      comparisonAmount: 100,
      currentCount: 1,
    });
    expect(types.find(item => item.key === 'cash')?.currentAmount).toBe(20);

    const {linked, unlinked} = comparePaymentInstruments(current, previous, instruments);
    expect(linked.find(item => item.key === 'id:pay-1')).toMatchObject({
      label: 'HSBC Red Card ••••1234',
      currentAmount: 300,
      comparisonAmount: 100,
    });
    expect(unlinked.find(item => item.key === 'legacy:cash')?.currentAmount).toBe(20);
  });

  it('groups optional account spend without inventing a second account system', () => {
    const accounts: Account[] = [{
      id: 'account-1', name: 'HSBC Red Card 信用卡帳戶', type: 'credit',
      initialBalance: 0, currency: 'HKD', createdAt: '2026-08-01T00:00:00.000Z',
    }];
    const rows = compareAccounts(
      [tx({accountId: 'account-1', amount: 80}), tx({amount: 20})],
      [tx({accountId: 'account-1', amount: 10})],
      accounts
    );
    expect(rows.find(item => item.key === 'id:account-1')).toMatchObject({
      label: 'HSBC Red Card 信用卡帳戶',
      currentAmount: 80,
    });
    expect(rows.find(item => item.key === 'unspecified')?.currentAmount).toBe(20);
  });

  it('applies a linked instrument account and never silently overwrites a conflicting explicit account', () => {
    const card = instrument({accountId: 'account-1'});
    expect(resolveInstrumentAccount({instrument: card})).toEqual({ok: true, accountId: 'account-1'});
    expect(resolveInstrumentAccount({instrument: instrument({accountId: undefined})}).ok).toBe(true);
    expect(resolveInstrumentAccount({
      instrument: instrument({accountId: undefined}),
      explicitAccountId: 'keep-me',
    })).toEqual({ok: true, accountId: 'keep-me'});
    expect(resolveInstrumentAccount({
      instrument: card,
      explicitAccountId: 'account-2',
    })).toEqual({ok: false, transactionAccountId: 'account-2', instrumentAccountId: 'account-1'});
    expect(resolveInstrumentAccount({
      instrument: card,
      explicitAccountId: 'account-2',
      choice: 'keep',
    })).toEqual({ok: true, accountId: 'account-2'});
    expect(resolveInstrumentAccount({
      instrument: card,
      explicitAccountId: 'old-instrument-account',
      previousInstrumentAccountId: 'old-instrument-account',
    })).toEqual({ok: true, accountId: 'account-1'});
  });

  it('resolves subscription posting from a linked instrument and falls back when it is missing', () => {
    const card = instrument({id: 'card-1', accountId: 'account-1'});
    expect(resolveSubscriptionPosting({paymentMethod: '信用卡'}, [card])).toEqual({
      paymentMethod: '信用卡',
    });
    expect(resolveSubscriptionPosting({
      paymentMethod: '電子錢包',
      paymentInstrumentId: 'card-1',
    }, [card])).toEqual({
      paymentMethod: '信用卡',
      paymentInstrumentId: 'card-1',
      accountId: 'account-1',
    });
    expect(resolveSubscriptionPosting({
      paymentMethod: '現金',
      paymentInstrumentId: 'deleted',
    }, [card])).toEqual({paymentMethod: '現金'});
    expect(subscriptionPaymentLabel({
      paymentMethod: '信用卡',
      paymentInstrumentId: 'card-1',
    }, [card])).toBe('HSBC Red Card ••••1234');
    expect(subscriptionPaymentLabel({
      paymentMethod: '信用卡',
      paymentInstrumentId: 'deleted',
    }, [card])).toBe('信用卡');
  });

  it('does not turn an unspecified subscription payment type into 信用卡', () => {
    expect(subscriptionPaymentFromDraft('', undefined)).toBeNull();
    expect(subscriptionPaymentFromDraft('credit_card', undefined)).toEqual({
      paymentMethod: '信用卡',
      paymentInstrumentId: undefined,
    });
    expect(subscriptionPaymentFromDraft('credit_card', 'card-1')).toEqual({
      paymentMethod: '信用卡',
      paymentInstrumentId: 'card-1',
    });
  });
});
