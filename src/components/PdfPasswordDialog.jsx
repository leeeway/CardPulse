import React, { useState } from 'react';
export default function PdfPasswordDialog({ request, onResolve, t }) {
  const [password, setPassword] = useState('');
  return (
    <div className="modal-overlay">
      <form
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pdf-password-title"
        onSubmit={(e) => {
          e.preventDefault();
          onResolve(password);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onResolve(null);
        }}
      >
        <div className="modal-header">
          <h2 id="pdf-password-title">{t('PDF 密码')}</h2>
          <button
            className="btn btn-ghost"
            type="button"
            aria-label={t('关闭')}
            onClick={() => onResolve(null)}
          >
            ✕
          </button>
        </div>
        <p className="small">{request.fileName}</p>
        <p className="muted small">{t(request.error)}</p>
        <label className="field">
          <span>{t('PDF 密码')}</span>
          <input
            autoFocus
            type="password"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <div className="form-actions">
          <button
            className="btn btn-secondary"
            type="button"
            onClick={() => onResolve(null)}
          >
            {t('取消')}
          </button>
          <button className="btn btn-primary" type="submit">
            {t('继续解析')}
          </button>
        </div>
      </form>
    </div>
  );
}
