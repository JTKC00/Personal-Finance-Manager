type SubscriptionProcessorCallbacks = {
  onFailure: (reason: string) => void;
  onSettled: () => void;
  onStart: () => void;
  onSuccess: () => void;
};

export function getSubscriptionFailureReason(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  const reason = String(error).trim();
  return reason && reason !== '[object Object]' ? reason : '未知錯誤';
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
        callbacks.onFailure(getSubscriptionFailureReason(error));
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
