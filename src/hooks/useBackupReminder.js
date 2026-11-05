import { useEffect, useState } from 'react';
import {
  BACKUP_REMINDER_KEY,
  emptyBackupReminder,
  readBackupReminder,
  saveBackupReminder,
} from '../core/backup-reminder.js';
import { getHongKongDate } from '../core/rewards.js';

export default function useBackupReminder() {
  const [record, setRecord] = useState(readBackupReminder);
  const [pendingOn, setPendingOn] = useState(null);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  useEffect(() => {
    const sync = (event) => {
      if (event.key !== null && event.key !== BACKUP_REMINDER_KEY) return;
      setRecord(readBackupReminder());
      setPendingOn(null);
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const commit = (next) => {
    setRecord(next);
    setStorageUnavailable(!saveBackupReminder(next));
  };
  return {
    record,
    pendingOn,
    storageUnavailable,
    exported(confirmed) {
      const date = getHongKongDate();
      if (confirmed) {
        commit({ lastConfirmedOn: date, reason: null });
        setPendingOn(null);
      } else setPendingOn(date);
    },
    confirm() {
      if (!pendingOn) return;
      commit({ lastConfirmedOn: pendingOn, reason: null });
      setPendingOn(null);
    },
    dismissPending() {
      setPendingOn(null);
    },
    invalidate(reason) {
      setPendingOn(null);
      commit({ ...record, reason });
    },
    clear() {
      setPendingOn(null);
      commit(emptyBackupReminder());
    },
  };
}
