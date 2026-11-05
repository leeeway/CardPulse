import { useEffect, useRef } from 'react';
import { createIdleLockTimer, IDLE_LOCK_MINUTES } from '../core/idle-lock.js';

const activityEvents = [
  'pointerdown',
  'pointermove',
  'keydown',
  'input',
  'wheel',
  'touchstart',
];

export default function useIdleLock({ minutes, active, blocked, onLock }) {
  const callbackRef = useRef(onLock);
  callbackRef.current = onLock;
  useEffect(() => {
    if (!active || blocked || !IDLE_LOCK_MINUTES.includes(minutes) || !minutes)
      return;
    const timer = createIdleLockTimer({
      minutes,
      onLock: () => callbackRef.current(),
    });
    const activity = (event) => {
      if (!timer.activity()) return;
      if (event.cancelable) event.preventDefault();
      event.stopImmediatePropagation();
    };
    const check = () => timer.check();
    const options = { capture: true, passive: false };
    for (const name of activityEvents)
      window.addEventListener(name, activity, options);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      timer.stop();
      for (const name of activityEvents)
        window.removeEventListener(name, activity, options);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [minutes, active, blocked]);
}
