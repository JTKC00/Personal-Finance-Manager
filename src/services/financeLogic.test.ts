import {describe, expect, it} from 'vitest';
import {
  calculateBudgetUsage,
  formatDateKey,
  getCurrentMonthKey,
  getGoalSavedAmount,
  getGoalWithSavedAmount,
  getMonthDateRange,
  getNextMonthKey,
  getNextSubscriptionBillingDate,
  getSubscriptionChargesForMonth,
  normalizeGoal,
  sumExpensesByCategory,
  sumSubscriptionChargesByCategory,
  type SubscriptionCharge,
} from './financeLogic';
import {roundMoney} from './money';
import type {Goal, GoalDeposit, Subscription, Transaction} from '../types/finance';

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

function makeCharge(patch: Partial<SubscriptionCharge> = {}): SubscriptionCharge {
  return {
    subscription: makeSubscription(),
    date: '2026-06-15',
    amount: 88,
    ...patch
  };
}

describe('sumExpensesByCategory', () => {
  it('sums each expense category at cent precision and ignores income', () => {
    const transactions = [
      makeTransaction({category: '飲食', amount: 0.1}),
      makeTransaction({category: '飲食', amount: 0.2}),
      makeTransaction({category: '飲食', amount: 10.1}),
      makeTransaction({category: '交通', amount: 0.3}),
      makeTransaction({category: '薪水', type: 'income', amount: 5000}),
    ];

    expect(sumExpensesByCategory(transactions)).toEqual({飲食: 10.4, 交通: 0.3});
  });

  it('removes the floating-point drift the old naive accumulation left', () => {
    const transactions = [
      makeTransaction({category: '飲食', amount: 0.1}),
      makeTransaction({category: '飲食', amount: 0.2}),
      makeTransaction({category: '娛樂', amount: 0.7}),
      makeTransaction({category: '娛樂', amount: 0.1}),
      makeTransaction({category: '交通', amount: 7}),
    ];
    // Reproduce the old getCategoryBreakdown behaviour: naive floating-point accumulation.
    const naive: Record<string, number> = {};
    transactions.forEach(item => {
      naive[item.category] = (naive[item.category] || 0) + item.amount;
    });

    const clean = sumExpensesByCategory(transactions);

    // Same categories, and each clean total equals the naive sum rounded to cents.
    expect(Object.keys(clean).sort()).toEqual(Object.keys(naive).sort());
    for (const category of Object.keys(naive)) {
      expect(clean[category]).toBe(Math.round(naive[category] * 100) / 100);
    }
    // The naive sums genuinely carried FP noise that the new code clears.
    expect(naive['飲食']).not.toBe(0.3);
    expect(clean['飲食']).toBe(0.3);
    expect(clean['娛樂']).toBe(0.8);
  });

  it('is unaffected by pre-filtering to expenses (idempotent with the screens filter)', () => {
    const transactions = [
      makeTransaction({category: '飲食', amount: 12.3}),
      makeTransaction({category: '薪水', type: 'income', amount: 5000}),
      makeTransaction({category: '交通', amount: 4.5}),
    ];

    expect(sumExpensesByCategory(transactions.filter(t => t.type === 'expense')))
      .toEqual(sumExpensesByCategory(transactions));
  });
});

describe('sumSubscriptionChargesByCategory', () => {
  it('sums charges per category at cent precision, reading the amount from the charge', () => {
    const charges = [
      makeCharge({subscription: makeSubscription({category: '娛樂', amount: 999}), amount: 0.1}),
      makeCharge({subscription: makeSubscription({category: '娛樂'}), amount: 0.2}),
      makeCharge({subscription: makeSubscription({category: '學習'}), amount: 45.5}),
      makeCharge({subscription: makeSubscription({category: ''}), amount: 3}),
    ];

    expect(sumSubscriptionChargesByCategory(charges)).toEqual({'娛樂': 0.3, '學習': 45.5, '': 3});
  });

  it('returns an empty map for no charges', () => {
    expect(sumSubscriptionChargesByCategory([])).toEqual({});
  });

  it('removes the floating-point drift the old naive screen accumulation left', () => {
    const charges = [
      makeCharge({subscription: makeSubscription({category: '娛樂'}), amount: 0.1}),
      makeCharge({subscription: makeSubscription({category: '娛樂'}), amount: 0.2}),
      makeCharge({subscription: makeSubscription({category: '保險'}), amount: 0.7}),
      makeCharge({subscription: makeSubscription({category: '保險'}), amount: 0.1}),
      makeCharge({subscription: makeSubscription({category: '居住'}), amount: 7}),
    ];
    // Reproduce the old DashboardScreen/SubscriptionsScreen reduce: naive accumulation.
    const naive: Record<string, number> = {};
    charges.forEach(item => {
      naive[item.subscription.category] = (naive[item.subscription.category] || 0) + item.amount;
    });

    const clean = sumSubscriptionChargesByCategory(charges);

    // Same categories, and each clean total equals the naive sum rounded to cents.
    expect(Object.keys(clean).sort()).toEqual(Object.keys(naive).sort());
    for (const category of Object.keys(naive)) {
      expect(clean[category]).toBe(Math.round(naive[category] * 100) / 100);
    }
    // The naive sums genuinely carried FP noise that the new code clears.
    expect(naive['娛樂']).not.toBe(0.3);
    expect(clean['娛樂']).toBe(0.3);
    expect(clean['保險']).toBe(0.8);
  });

  it('keeps the deterministic budget-alert boundary after rounding', () => {
    expect(roundMoney(60.35 + 14.65)).toBe(75);
    expect(roundMoney(60.35 + 14.65) / 100).toBeGreaterThanOrEqual(0.75);
  });
});

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

  it('rounds the summed amount to avoid floating-point drift', () => {
    const goal = makeGoal({
      deposits: [
        {id: 'a', amount: 0.1, date: '2026-06-01', type: 'deposit'},
        {id: 'b', amount: 0.2, date: '2026-06-02', type: 'deposit'},
      ]
    });

    expect(getGoalSavedAmount(goal)).toBe(0.3);
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

  it('rounds the projected total to avoid floating-point drift', () => {
    const usage = calculateBudgetUsage(0.1, 0.2, 1);

    expect(usage.projected).toBe(0.3);
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

describe('normalizeGoal', () => {
  it('returns an empty deposits array when none are provided', () => {
    expect(normalizeGoal(makeGoal()).deposits).toEqual([]);
  });

  it('stores deposit amounts as absolute values', () => {
    const goal = normalizeGoal(makeGoal({
      deposits: [{id: 'a', amount: -120, date: '2026-06-01', type: 'withdraw'}]
    }));

    expect(goal.deposits?.[0].amount).toBe(120);
  });

  it('keeps an explicit type even when it disagrees with the amount sign', () => {
    const goal = normalizeGoal(makeGoal({
      deposits: [{id: 'a', amount: -40, date: '2026-06-01', type: 'deposit'}]
    }));

    expect(goal.deposits?.[0]).toMatchObject({type: 'deposit', amount: 40});
  });

  it('generates an id for entries that are missing one', () => {
    const goal = normalizeGoal(makeGoal({
      id: 'goal-9',
      deposits: [{id: '', amount: 75, date: '2026-06-01', type: 'deposit'}]
    }));

    expect(goal.deposits?.[0].id).toBe('goal-9-2026-06-01-75-deposit');
  });

  it('infers the type from the amount sign for untyped legacy entries', () => {
    // Goals created before the `type` field existed can arrive untyped from
    // Firestore; normalizeGoal backfills it from the amount sign.
    const legacyEntry = {amount: -30, date: '2026-06-02'} as unknown as GoalDeposit;
    const goal = normalizeGoal(makeGoal({deposits: [legacyEntry]}));

    expect(goal.deposits?.[0]).toMatchObject({type: 'withdraw', amount: 30});
  });
});

describe('getNextMonthKey', () => {
  it('advances to the following month', () => {
    expect(getNextMonthKey('2026-01')).toBe('2026-02');
    expect(getNextMonthKey('2026-09')).toBe('2026-10');
  });

  it('rolls over into the next year from December', () => {
    expect(getNextMonthKey('2026-12')).toBe('2027-01');
  });
});

describe('formatDateKey', () => {
  it('zero-pads month and day from local date parts', () => {
    expect(formatDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(formatDateKey(new Date(2026, 8, 9))).toBe('2026-09-09');
  });

  it('formats end-of-year dates', () => {
    expect(formatDateKey(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});
