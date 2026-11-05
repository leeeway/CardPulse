export const IDLE_LOCK_MINUTES = [0, 5, 15, 30];

export function idleLockRemaining(minutes, lastActivity, now) {
  if (!IDLE_LOCK_MINUTES.includes(minutes) || minutes === 0) return null;
  const duration = minutes * 60_000;
  if (!Number.isFinite(lastActivity) || !Number.isFinite(now)) return duration;
  return Math.max(0, duration - Math.max(0, now - lastActivity));
}

// The DOM-independent timer also checks deadlines on wake and before accepting
// an activity event. A delayed timeout must not let the first click bypass a lock.
export function createIdleLockTimer({
  minutes,
  onLock,
  now = Date.now,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
}) {
  const duration = idleLockRemaining(minutes, 0, 0);
  let lastActivity = now();
  let timer = null;
  let fired = false;
  let stopped = false;
  const clear = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const schedule = (delay) => {
    clear();
    timer = setTimer(check, delay);
  };
  const lock = () => {
    if (onLock() === false) {
      lastActivity = now();
      schedule(duration);
      return false;
    }
    fired = true;
    clear();
    return true;
  };
  function check() {
    if (stopped || duration === null) return false;
    if (fired) return true;
    const current = now();
    // Clock corrections cannot keep an old, future last-activity timestamp alive.
    if (current < lastActivity) lastActivity = current;
    const remaining = idleLockRemaining(minutes, lastActivity, current);
    if (remaining === 0) return lock();
    schedule(remaining);
    return false;
  }
  const activity = () => {
    if (stopped || duration === null) return false;
    if (fired) return true;
    const current = now();
    if (idleLockRemaining(minutes, lastActivity, current) === 0) return lock();
    lastActivity = current;
    // Frequent pointer events only update the timestamp. The existing timeout
    // checks the new deadline rather than creating a timer for every movement.
    return false;
  };
  if (duration !== null) schedule(duration);
  return {
    activity,
    check,
    stop() {
      stopped = true;
      clear();
    },
  };
}
