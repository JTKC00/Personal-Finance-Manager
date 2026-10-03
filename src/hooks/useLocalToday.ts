import {useEffect, useState} from 'react';
import {formatDateKey} from '../services/financeLogic';

/** Refresh the date after midnight or returning to a suspended browser tab. */
export function useLocalToday() {
  const [today, setToday] = useState(() => formatDateKey(new Date()));
  useEffect(() => {
    const refresh = () => setToday(formatDateKey(new Date()));
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  return today;
}
