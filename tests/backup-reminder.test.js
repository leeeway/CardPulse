import { it } from 'node:test';
import assert from 'node:assert/strict';
import {
  backupReminderStatus,
  readBackupReminder,
  saveBackupReminder,
  emptyBackupReminder,
  createBackupReminderRecord,
  sameBackupReminder,
  readBackupReminderState,
} from '../src/core/backup-reminder.js';
import { readPreferences, savePreferences } from '../src/core/preferences.js';

it('备份提醒包含当天边界、跨年及闰日，未确认和时钟倒退不会被视为近期备份', () => {
  const record = { lastConfirmedOn: '2026-12-28', reason: null };
  assert.deepEqual(backupReminderStatus(record, '2027-01-03'), {
    kind: 'scheduled',
    due: false,
    nextOn: '2027-01-04',
  });
  assert.deepEqual(backupReminderStatus(record, '2027-01-04'), {
    kind: 'overdue',
    due: true,
    days: 7,
  });
  assert.equal(
    backupReminderStatus({ lastConfirmedOn: '2028-02-23' }, '2028-03-01').days,
    7,
  );
  assert.deepEqual(backupReminderStatus(emptyBackupReminder(), '2026-11-05'), {
    kind: 'never',
    due: true,
  });
  assert.equal(backupReminderStatus(record, '2026-12-27').kind, 'clock');
  assert.equal(backupReminderStatus(record, 'invalid').kind, 'clock');
});

it('改密或恢复后的提醒优先于日期，关闭提醒仍保留日期记录供以后启用', () => {
  for (const reason of ['passwordChanged', 'restored']) {
    const record = { lastConfirmedOn: '2026-11-05', reason };
    assert.deepEqual(backupReminderStatus(record, '2026-11-05'), {
      kind: reason,
      due: true,
    });
    assert.deepEqual(backupReminderStatus(record, '2026-11-05', 0), {
      kind: 'off',
      due: false,
    });
  }
});

it('只保存已确认日期和固定状态，不写入密码、账单及路径，损坏或不可用存储安全降级', () => {
  let stored;
  const storage = {
    setItem: (_key, value) => (stored = value),
    getItem: () => stored,
  };
  assert.equal(
    saveBackupReminder(
      {
        lastConfirmedOn: '2026-11-05',
        reason: 'restored',
        password: 'private',
        transactions: ['private'],
        filePath: '/private/file',
      },
      storage,
    ),
    true,
  );
  const parsed = JSON.parse(stored);
  assert.match(parsed.revision, /^[0-9a-f-]{36}$/);
  assert.deepEqual(parsed, {
    version: 1,
    lastConfirmedOn: '2026-11-05',
    reason: 'restored',
    revision: parsed.revision,
  });
  assert.deepEqual(readBackupReminder(storage), {
    lastConfirmedOn: '2026-11-05',
    reason: 'restored',
    revision: parsed.revision,
  });
  for (const value of [
    '{bad',
    'null',
    '{"version":99,"lastConfirmedOn":"2026-11-05"}',
    '{"version":1,"lastConfirmedOn":"2026-02-30","reason":"__proto__"}',
  ]) {
    assert.deepEqual(
      readBackupReminder({ getItem: () => value }),
      emptyBackupReminder(),
    );
  }
  const blocked = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  };
  assert.deepEqual(readBackupReminder(blocked), emptyBackupReminder());
  assert.equal(saveBackupReminder({}, blocked), false);
});

it('提醒间隔仅接受关闭或7/14/30天，并与语言配色一同恢复', () => {
  for (const interval of [0, 7, 14, 30, -1, 1, '7', null]) {
    const expected = [0, 7, 14, 30].includes(interval) ? interval : 7;
    let value;
    const storage = {
      setItem: (_key, raw) => (value = raw),
      getItem: () => value,
    };
    savePreferences(
      { locale: 'zh-CN', theme: 'jade', backupReminderDays: interval },
      storage,
    );
    assert.equal(readPreferences(storage).backupReminderDays, expected);
  }
});

it('同日相同提醒状态的每次更新都有独立随机代次，兼容没有代次的旧提醒记录', () => {
  const data = { lastConfirmedOn: '2026-11-05', reason: 'passwordChanged' };
  const a = createBackupReminderRecord(data);
  const b = createBackupReminderRecord(data);
  assert.notEqual(a.revision, b.revision);
  assert.equal(sameBackupReminder(a, b), false);
  assert.equal(sameBackupReminder(a, { ...a }), true);
  const legacy = readBackupReminder({
    getItem: () => JSON.stringify({ version: 1, ...data }),
  });
  assert.deepEqual(legacy, { ...data, revision: null });
  assert.equal(sameBackupReminder(legacy, a), false);
  let stored;
  const storage = {
    getItem: () => stored,
    setItem: (_key, value) => (stored = value),
  };
  assert.equal(saveBackupReminder(data, storage), true);
  const first = readBackupReminder(storage);
  assert.equal(saveBackupReminder(data, storage), true);
  assert.equal(sameBackupReminder(first, readBackupReminder(storage)), false);
});

it('空存储与不可用存储分别标识，禁止写入不会误报另一个页面更新了提醒', () => {
  assert.deepEqual(readBackupReminderState({ getItem: () => null }), {
    available: true,
    record: emptyBackupReminder(),
  });
  assert.deepEqual(
    readBackupReminderState({
      getItem() {
        throw new Error('blocked');
      },
    }),
    { available: false, record: emptyBackupReminder() },
  );
});
