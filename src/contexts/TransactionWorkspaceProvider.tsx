import {useRef, useState, type ReactNode} from 'react';
import {TransactionEditor} from '../components/TransactionEditor';
import {dateKey} from '../services/analysisPeriod';
import {EMPTY_TRANSACTION_FILTERS} from '../services/transactionManagement';
import {TransactionWorkspaceContext, type EditCallbacks, type ListState} from './TransactionWorkspace';
type Request = EditCallbacks & {ids: string[]; sequential: boolean; saved: number; skipped: number};

/** Mounted under the auth user's key: no persistence across sign-out/account switches. */
export function TransactionWorkspaceProvider({children}: {children: ReactNode}) {
  const today = dateKey(new Date());
  const list = useRef<ListState>({period: {preset: 'month', month: today.slice(0, 7), start: `${today.slice(0, 7)}-01`, end: today}, filters: {...EMPTY_TRANSACTION_FILTERS}, limit: 50, scroll: 0});
  const [request, setRequest] = useState<Request | null>(null);
  const [notice, setNotice] = useState('');
  const focusReturn = useRef<{opener: HTMLElement | null; fallback: HTMLElement | null}>({opener: null, fallback: null});
  function close() {
    setRequest(null);
    requestAnimationFrame(() => {
      const {opener, fallback} = focusReturn.current;
      const target = opener?.isConnected ? opener : fallback?.isConnected ? fallback : document.querySelector<HTMLElement>('h1');
      if (target) { if (!target.matches('button,summary,a,input,select')) target.tabIndex = -1; target.focus({preventScroll: true}); }
    });
  }
  function next(action: 'saved' | 'skipped') {
    if (!request) return;
    const counts = {saved: request.saved + Number(action === 'saved'), skipped: request.skipped + Number(action === 'skipped')};
    if (request.ids.length > 1) setRequest({...request, ...counts, ids: request.ids.slice(1)});
    else { close(); setNotice(current => `${current} 本次已儲存 ${counts.saved} 筆、略過 ${counts.skipped} 筆，尚餘 0 筆未處理。略過或尚未補齊的資料仍會留在清單。`); }
  }
  return <TransactionWorkspaceContext.Provider value={{list, openEdit: (id, callbacks, queue) => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    focusReturn.current = {opener, fallback: opener?.closest('details')?.querySelector('summary') || document.querySelector<HTMLElement>('[data-transaction-list]')};
    setNotice('');
    setRequest({...callbacks, ids: queue?.length ? queue : [id], sequential: Boolean(queue), saved: 0, skipped: 0});
  }}}>
    {children}
    {notice && <div role="status" className="transactionWorkspaceNotice">{notice}<button onClick={() => setNotice('')} aria-label="關閉交易提示">×</button></div>}
    {request && <TransactionEditor key={request.ids[0]} id={request.ids[0]} remaining={request.sequential ? request.ids.length : undefined}
      onClose={close} onSkip={() => next('skipped')} onMissing={request.onMissing}
      onSaved={async (transaction, warnings) => {
        let detail = '';
        try { detail = await request.onSaved(transaction) || ''; } catch { warnings = [...warnings, '畫面未能重新整理']; }
        setNotice(`交易已儲存。${detail}${warnings.length ? ` ${warnings.join('、')}，可稍後重新整理，毋須再次儲存。` : ''}`);
        if (request.sequential) next('saved'); else close();
      }} />}
  </TransactionWorkspaceContext.Provider>;
}
