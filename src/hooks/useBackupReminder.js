import { useEffect, useRef, useState } from 'react';
import {
  BACKUP_REMINDER_KEY,
  createBackupReminderRecord,
  emptyBackupReminder,
  readBackupReminderState,
  sameBackupReminder,
  saveBackupReminder,
} from '../core/backup-reminder.js';
import { getHongKongDate } from '../core/rewards.js';

export default function useBackupReminder() {
  const [initial] = useState(readBackupReminderState);
  const [record, setRecord] = useState(initial.record);
  const [pendingOn, setPendingOn] = useState(null);
  const [storageUnavailable, setStorageUnavailable] = useState(
    !initial.available,
  );
  const current = useRef(initial.record);
  const persisted = useRef(initial.available ? initial.record : null);
  const generation = useRef(0);
  const pending = useRef(null);

  const dismissPending = () => {
    generation.current++;
    pending.current = null;
    setPendingOn(null);
  };
  const synchronize = () => {
    const latest = readBackupReminderState();
    if (!latest.available) return latest;
    if (
      persisted.current === null ||
      !sameBackupReminder(latest.record, persisted.current)
    ) {
      persisted.current = latest.record;
      current.current = latest.record;
      setRecord(latest.record);
      dismissPending();
    }
    return latest;
  };
  useEffect(() => {
    const sync = (event) => {
      if (event.key !== null && event.key !== BACKUP_REMINDER_KEY) return;
      synchronize();
      // Even a repeated/legacy write invalidates a pending confirmation.
      dismissPending();
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const commit = (value) => {
    const next = createBackupReminderRecord(value);
    current.current = next;
    setRecord(next);
    const saved = saveBackupReminder(next);
    if (saved) persisted.current = next;
    setStorageUnavailable(!saved);
    dismissPending();
  };
  const isCurrent = (token) => {
    const latest = synchronize();
    return (
      token &&
      token.generation === generation.current &&
      token.revision === current.current.revision &&
      token.available === latest.available &&
      (!latest.available || sameBackupReminder(token.stored, latest.record))
    );
  };
  return {
    record,
    pendingOn,
    storageUnavailable,
    beginExport() {
      const latest = synchronize();
      dismissPending();
      return {
        generation: generation.current,
        revision: current.current.revision,
        available: latest.available,
        stored: latest.record,
      };
    },
    exported(confirmed, token) {
      if (!isCurrent(token)) {
        dismissPending();
        return false;
      }
      const date = getHongKongDate();
      if (confirmed) commit({ lastConfirmedOn: date, reason: null });
      else {
        pending.current = { on: date, token };
        setPendingOn(date);
      }
      return true;
    },
    confirm() {
      const receipt = pending.current;
      if (!receipt || !isCurrent(receipt.token)) {
        dismissPending();
        return;
      }
      commit({ lastConfirmedOn: receipt.on, reason: null });
    },
    dismissPending,
    invalidate(reason) {
      synchronize();
      commit({ ...current.current, reason });
    },
    clear() {
      commit(emptyBackupReminder());
    },
  };
}
