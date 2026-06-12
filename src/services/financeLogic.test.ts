import {describe, expect, it} from 'vitest';
import {
  calculateBudgetUsage,
  getCurrentMonthKey,
  getGoalSavedAmount,
  getGoalWithSavedAmount,
  getMonthDateRange,
  getNextSubscriptionBillingDate,
  getSubscriptionChargesForMonth,
} from './financeLogic';
import type {Goal, Subscription, Transaction} from '../types/finance';

function makeSubscription(patch: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub-1',
    name: 'Streaming',
    amount: 88,
    currency: 'HKD',
    category: '娛樂',
    paymentMethod: '信用卡',
    frequency: 'monthly',
    nextBillingDate: '2026-01-31',
    reminderDays: 7,
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...patch
  };
}

function makeTransaction(patch: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    type: 'expense',
    amount: 88,
    currency: 'HKD',
    date: '2026-06-10',
    category: '娛樂',
    createdAt: '2026-06-10T00:00:00.000Z',
    ...patch
  };
}

function makeGoal(patch: Partial<Goal> = {}): Goal {
  return {
    id: 'goal-1',
    name: 'Trip',
    targetAmount: 1000,
    savedAmount: 0,
    ...patch
  };
}

describe('subscription billing logic', () => {
  it('clamps monthly billing dates at month end', () => {
    const subscription = makeSubscription({frequency: 'monthly', nextBillingDate: '2026-01-31'});

    expect(getNextSubscriptionBillingDate(subscription)).toBe('2026-02-28');
  });

  it('preserves yearly day and month where valid', () => {
    const subscription = makeSubscription({frequency: 'yearly', nextBillingDate: '2026-06-12'});

    expect(getNextSubscriptionBillingDate(subscription)).toBe('2027-06-12');
  });

  it('adds seven days for weekly billing', () => {
    const subscription = makeSubscription({frequency: 'weekly', nextBillingDate: '2026-06-26'});

    expect(getNextSubscriptionBillingDate(subscription)).toBe('2026-07-03');
  });

  it('adds three months for quarterly billing with clamping', () => {
    const subscription = makeSubscription({frequency: 'quarterly', nextBillingDate: '2026-11-30'});

    expect(getNextSubscriptionBillingDate(subscription)).toBe('2027-02-28');
  });

  it('does not create monthly charges for inactive subscriptions', () => {
    const charges = getSubscriptionChargesForMonth(
      [makeSubscription({active: false, nextBillingDate: '2026-06-10'})],
      '2026-06',
      [],
      '2026-06-01'
    );

    expect(charges).toEqual([]);
  });

  it('ignores already posted upcoming subscription charges', () => {
    const subscription = makeSubscription({id: 'sub-1', nextBillingDate: '2026-06-10'});
    const posted = makeTransaction({subscriptionId: 'sub-1', date: '2026-06-10'});

    const charges = getSubscriptionChargesForMonth([subscription], '2026-06', [posted], '2026-06-01', true);

    expect(charges).toEqual([]);
  });
});

describe('goal logic', () => {
  it('sums deposits and withdrawals without going below zero', () => {
    const goal = makeGoal({
      deposits: [
        {id: 'a', amount: 300, date: '2026-06-01', type: 'deposit'},
        {id: 'b', amount: 125, date: '2026-06-02', type: 'withdraw'},
        {id: 'c', amount: 250, date: '2026-06-03', type: 'withdraw'},
        {id: 'd', amount: 50, date: '2026-06-04', type: 'deposit'},
      ]
    });

    expect(getGoalSavedAmount(goal)).toBe(50);
  });

  it('clamps saved amount to the target amount', () => {
    const goal = getGoalWithSavedAmount(makeGoal({
      targetAmount: 500,
      deposits: [
        {id: 'a', amount: 300, date: '2026-06-01', type: 'deposit'},
        {id: 'b', amount: 300, date: '2026-06-02', type: 'deposit'},
      ]
    }));

    expect(goal.savedAmount).toBe(500);
  });
});

describe('budget logic', () => {
  it('calculates usage percentage and warning status', () => {
    const usage = calculateBudgetUsage(600, 150, 1000);

    expect(usage.projected).toBe(750);
    expect(usage.ratio).toBe(0.75);
    expect(usage.percentage).toBe(75);
    expect(usage.status).toBe('warning');
  });

  it('classifies danger threshold and caps the ratio at 100 percent', () => {
    const usage = calculateBudgetUsage(900, 300, 1000);

    expect(usage.ratio).toBe(1);
    expect(usage.percentage).toBe(100);
    expect(usage.status).toBe('danger');
  });

  it('handles zero budget without crashing', () => {
    const usage = calculateBudgetUsage(100, 50, 0);

    expect(usage.ratio).toBe(0);
    expect(usage.percentage).toBe(0);
    expect(usage.status).toBe('none');
  });
});

describe('month helpers', () => {
  it('creates deterministic month keys from fixed dates', () => {
    expect(getCurrentMonthKey(new Date(2026, 0, 15))).toBe('2026-01');
    expect(getCurrentMonthKey(new Date(2026, 11, 31))).toBe('2026-12');
  });

  it('returns selected month date ranges with exclusive next-month end', () => {
    expect(getMonthDateRange('2026-12')).toEqual({
      start: '2026-12-01',
      endExclusive: '2027-01-01'
    });
  });
});
