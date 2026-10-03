type SubscriptionProcessorCallbacks = {
  onFailure: (reason: string, created: number) => void;
  onSettled: () => void;
  onStart: () => void;
  onSuccess: () => void;
};

export function getSubscriptionFailureReason(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  const reason = String(error).trim();
  return reason && reason !== '[object Object]' ? reason : '未知錯誤';
}

export function getSubscriptionCreatedCount(error: unknown): number {
  if (!error || typeof error !== 'object' || !('created' in error)) return 0;
  const created = (error as {created?: unknown}).created;
  return typeof created === 'number' && Number.isInteger(created) && created > 0 ? created : 0;
}

export function createSubscriptionProcessor(
  process: () => Promise<number>,
  callbacks: SubscriptionProcessorCallbacks
): () => Promise<number> {
  let inFlight: Promise<number> | null = null;

  return () => {
    if (inFlight) return inFlight;

    callbacks.onStart();
    const request = process()
      .then(created => {
        callbacks.onSuccess();
        return created;
      })
      .catch((error: unknown) => {
        callbacks.onFailure(getSubscriptionFailureReason(error), getSubscriptionCreatedCount(error));
        throw error;
      })
      .finally(() => {
        if (inFlight === request) inFlight = null;
        callbacks.onSettled();
      });

    inFlight = request;
    return request;
  };
}
