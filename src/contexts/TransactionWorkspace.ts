import {createContext, useContext, type MutableRefObject} from 'react';
import type {TransactionFilters, TransactionPeriod} from '../services/transactionManagement';
import type {Transaction} from '../types/finance';

export type EditCallbacks = {
  onSaved: (transaction: Transaction) => string | void | Promise<string | void>;
  onMissing: (id: string) => void;
};
export type ListState = {period: TransactionPeriod; filters: TransactionFilters; limit: number; scroll: number};
export const TransactionWorkspaceContext = createContext<{
  list: MutableRefObject<ListState>;
  openEdit: (id: string, callbacks: EditCallbacks, queue?: string[]) => void;
} | null>(null);

export function useTransactionWorkspace() {
  const context = useContext(TransactionWorkspaceContext);
  if (!context) throw new Error('TransactionWorkspaceProvider is required');
  return context;
}
