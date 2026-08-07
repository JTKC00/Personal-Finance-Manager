import {createContext, PropsWithChildren, useCallback, useContext, useEffect, useRef, useState} from 'react';
import {processDueSubscriptions} from '../services/storage';
import {createSubscriptionProcessor} from '../services/subscriptionProcessing';

type SubscriptionProcessingContextValue = {
  error: string | null;
  processing: boolean;
  revision: number;
  retry: () => Promise<number>;
};

const SubscriptionProcessingContext = createContext<SubscriptionProcessingContextValue | null>(null);

export function SubscriptionProcessingProvider({children}: PropsWithChildren) {
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [revision, setRevision] = useState(0);
  const processor = useRef<(() => Promise<number>) | null>(null);

  if (!processor.current) {
    processor.current = createSubscriptionProcessor(processDueSubscriptions, {
      onStart: () => setProcessing(true),
      onSuccess: () => {
        setError(null);
        setRevision(current => current + 1);
      },
      onFailure: reason => setError(reason),
      onSettled: () => setProcessing(false),
    });
  }

  const retry = useCallback((): Promise<number> => {
    return processor.current!();
  }, []);

  useEffect(() => {
    void retry().catch(() => undefined);
  }, [retry]);

  return (
    <SubscriptionProcessingContext.Provider value={{error, processing, revision, retry}}>
      {children}
    </SubscriptionProcessingContext.Provider>
  );
}

export function useSubscriptionProcessing(): SubscriptionProcessingContextValue {
  const context = useContext(SubscriptionProcessingContext);
  if (!context) {
    throw new Error('useSubscriptionProcessing must be used inside SubscriptionProcessingProvider');
  }
  return context;
}
