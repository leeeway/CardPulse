import React from 'react';
import { IDLE_LOCK_MINUTES } from '../core/idle-lock.js';

export default function IdleLockSettings({
  minutes,
  active,
  blocked,
  disabled,
  onChange,
  t,
}) {
  return (
    <div className="idle-lock-settings" aria-labelledby="idle-lock-heading">
      <h3 id="idle-lock-heading">{t('空闲自动锁定')}</h3>
      <label className="field">
        <span>{t('空闲锁定时限')}</span>
        <select
          value={minutes}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
        >
          {IDLE_LOCK_MINUTES.map((value) => (
            <option key={value} value={value}>
              {t(value ? '空闲 {minutes} 分钟' : '关闭自动锁定', {
                minutes: value,
              })}
            </option>
          ))}
        </select>
      </label>
      <p
        className={
          minutes > 0 && active && blocked ? 'notice-inline' : 'muted small'
        }
        aria-live="polite"
      >
        {t(
          !minutes
            ? '自动锁定已关闭。'
            : !active
              ? '自动锁定仅在已保存并解锁的真实保险库中启用。'
              : blocked
                ? '自动锁定暂缓：有未保存内容、正在编辑或处理任务。数据仍可见，请保存或结束编辑；也可手动锁定。'
                : '本窗口空闲达到时限后会锁定。解除暂缓后重新计时，休眠或后台返回时检查期限。',
        )}
      </p>
      <p className="muted small">
        {t('不会自动保存或丢弃草稿，不缓存主密码；此设置不等同于系统锁屏。')}
      </p>
    </div>
  );
}
