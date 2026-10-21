import { useEffect, useState } from 'react';
import { getHongKongDate } from '../core/rewards.js';

// Recheck after sleep or a background tab resumes, as well as while open.
export default function useHongKongDate() {
  const [today, setToday] = useState(() => getHongKongDate());
  useEffect(() => {
    const refresh = () => setToday(getHongKongDate());
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    refresh();
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  return today;
}
