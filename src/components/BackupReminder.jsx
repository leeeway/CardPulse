import React from 'react';
import {
  backupReminderStatus,
  REMINDER_INTERVALS,
} from '../core/backup-reminder.js';

export default function BackupReminder({
  reminder,
  today,
  interval,
  dirty,
  disabled,
  onIntervalChange,
  onExport,
  t,
}) {
  const status = backupReminderStatus(reminder.record, today, interval);
  const messages = {
    off: '备份提醒已关闭。',
    never: '尚无已确认的备份，建议导出加密备份并妥善保存。',
    clock: '备份记录日期晚于当前香港日期，请核对系统时间。',
    passwordChanged: '保险库密码已修改，建议重新导出备份；旧备份仍使用原密码。',
    restored: '已恢复备份，建议重新导出当前工作区。',
    overdue: '距上次确认备份已 {days} 天，建议重新导出。',
    scheduled: '下次按日期提醒：{date}',
  };
  return (
    <div className="backup-reminder" aria-labelledby="backup-reminder-heading">
      <h3 id="backup-reminder-heading">{t('本地备份提醒')}</h3>
      <p className="backup-history muted small">
        {t('上次确认备份日期')}：
        {reminder.record.lastConfirmedOn || t('暂无记录')}
      </p>
      <p
        className={status.due ? 'notice-inline' : 'muted small'}
        aria-live="polite"
      >
        {t(messages[status.kind], { days: status.days, date: status.nextOn })}
      </p>
      <p className="muted small">
        {t('提醒按香港日期计算，仅表示确认过一次导出，不证明当前修改已备份。')}
      </p>
      {dirty && (
        <p className="muted small">
          {t(
            '当前有未保存的修改；导出备份不会自动保存保险库，也不包含未应用的活动编辑草稿。',
          )}
        </p>
      )}
      <div className="backup-controls">
        <label className="field">
          <span>{t('备份提醒频率')}</span>
          <select
            value={interval}
            disabled={disabled}
            onChange={(event) => onIntervalChange(Number(event.target.value))}
          >
            {REMINDER_INTERVALS.map((days) => (
              <option key={days} value={days}>
                {t(days ? '每 {days} 天' : '关闭提醒', { days })}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn btn-secondary"
          disabled={disabled}
          onClick={onExport}
        >
          {t('立即备份')}
        </button>
      </div>
      {reminder.pendingOn && (
        <div className="backup-confirmation">
          <p className="notice-inline">
            {t(
              '浏览器已发起下载，请检查文件确已保存后确认；取消下载请勿确认。',
            )}
          </p>
          <div className="form-actions">
            <button
              className="btn btn-secondary"
              disabled={disabled}
              onClick={reminder.dismissPending}
            >
              {t('取消确认')}
            </button>
            <button
              className="btn btn-primary"
              disabled={disabled}
              onClick={reminder.confirm}
            >
              {t('确认文件已保存')}
            </button>
          </div>
        </div>
      )}
      {reminder.storageUnavailable && (
        <p className="muted small">
          {t('提醒记录无法写入本地存储，本次记录仅在当前页面有效。')}
        </p>
      )}
    </div>
  );
}
