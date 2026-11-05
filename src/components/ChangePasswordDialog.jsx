import React, { useEffect, useRef, useState } from 'react';

export default function ChangePasswordDialog({
  busy,
  dirty,
  onSubmit,
  onClose,
  t,
}) {
  const dialogRef = useRef(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    dialog.querySelector('input').focus();
    return () => dialog.close();
  }, []);
  const field = (label, value, setValue, autoComplete, autoFocus = false) => (
    <label className="field">
      <span>{t(label)}</span>
      <input
        type="password"
        required
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        disabled={busy}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
    </label>
  );
  return (
    <dialog
      ref={dialogRef}
      className="modal-content vault-dialog"
      aria-labelledby="change-password-title"
      aria-describedby="change-password-help"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setError('');
          if (next !== confirmation) {
            setError('两次输入的新密码不一致');
            return;
          }
          try {
            await onSubmit(current, next);
            onClose();
          } catch (error) {
            setError(error.message || '操作失败，请重试');
          }
        }}
      >
        <div className="modal-header">
          <h2 id="change-password-title">{t('修改保险库密码')}</h2>
          <button
            type="button"
            className="btn btn-ghost"
            aria-label={t('关闭')}
            disabled={busy}
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <p id="change-password-help" className="muted small">
          {t(
            '请输入当前密码及新密码，仅在本地重新加密已保存的数据。旧备份仍需使用原密码。',
          )}
        </p>
        {dirty && (
          <p className="notice-inline">
            {t('当前有未保存的修改，改密后仍会保留，请使用新密码另行保存。')}
          </p>
        )}
        {field('当前密码', current, setCurrent, 'current-password', true)}
        {field('新密码', next, setNext, 'new-password')}
        {field('确认新密码', confirmation, setConfirmation, 'new-password')}
        <p className="muted small">
          {t('请使用较长且独有的密码，并妥善保管。忘记密码无法找回。')}
        </p>
        {error && (
          <p className="error" role="alert">
            {t(error)}
          </p>
        )}
        <div className="form-actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={onClose}
          >
            {t('取消')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {t(busy ? '处理中…' : '确认修改密码')}
          </button>
        </div>
      </form>
    </dialog>
  );
}
