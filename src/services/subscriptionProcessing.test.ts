import {describe, expect, it, vi} from 'vitest';
import {createSubscriptionProcessor, getSubscriptionCreatedCount, getSubscriptionFailureReason} from './subscriptionProcessing';

describe('subscription processing', () => {
  it('shares an in-flight run so concurrent callers cannot double-process subscriptions', async () => {
    let resolveRun: ((created: number) => void) | undefined;
    const process = vi.fn(() => new Promise<number>(resolve => { resolveRun = resolve; }));
    const callbacks = {
      onFailure: vi.fn(),
      onSettled: vi.fn(),
      onStart: vi.fn(),
      onSuccess: vi.fn(),
    };
    const run = createSubscriptionProcessor(process, callbacks);

    const first = run();
    const second = run();

    expect(second).toBe(first);
    expect(process).toHaveBeenCalledTimes(1);
    expect(callbacks.onStart).toHaveBeenCalledTimes(1);

    resolveRun?.(2);
    await expect(first).resolves.toBe(2);
    expect(callbacks.onSuccess).toHaveBeenCalledTimes(1);
    expect(callbacks.onSettled).toHaveBeenCalledTimes(1);
  });

  it('retains the failure reason and permits a later safe retry', async () => {
    const failure = new Error('Missing or insufficient permissions.');
    const process = vi.fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(1);
    const callbacks = {
      onFailure: vi.fn(),
      onSettled: vi.fn(),
      onStart: vi.fn(),
      onSuccess: vi.fn(),
    };
    const run = createSubscriptionProcessor(process, callbacks);

    await expect(run()).rejects.toBe(failure);
    expect(callbacks.onFailure).toHaveBeenCalledWith('Missing or insufficient permissions.', 0);

    await expect(run()).resolves.toBe(1);
    expect(process).toHaveBeenCalledTimes(2);
    expect(callbacks.onSuccess).toHaveBeenCalledTimes(1);
    expect(callbacks.onSettled).toHaveBeenCalledTimes(2);
  });

  it('passes partial-success counts to the failure callback', async () => {
    const failure = Object.assign(new Error('已成功補記 2 筆；仍有 1 筆訂閱未能入帳'), {created: 2});
    const callbacks = {
      onFailure: vi.fn(),
      onSettled: vi.fn(),
      onStart: vi.fn(),
      onSuccess: vi.fn(),
    };
    const run = createSubscriptionProcessor(vi.fn().mockRejectedValue(failure), callbacks);

    await expect(run()).rejects.toBe(failure);
    expect(callbacks.onFailure).toHaveBeenCalledWith(failure.message, 2);
    expect(getSubscriptionCreatedCount(failure)).toBe(2);
  });

  it('provides a safe fallback for errors without a readable reason', () => {
    expect(getSubscriptionFailureReason({})).toBe('未知錯誤');
  });
});
