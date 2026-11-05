import React from 'react';
import { KeyRound } from 'lucide-react';

export default function VaultSettings({
  disabled,
  hasVault,
  onChangePassword,
  children,
  t,
}) {
  return (
    <section
      className="panel vault-settings"
      aria-labelledby="vault-settings-heading"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">VAULT SECURITY</p>
          <h2 id="vault-settings-heading">{t('保险库安全')}</h2>
          <p>{t('更新本地保险库密码，旧加密备份不会随之改密。')}</p>
        </div>
        <button
          className="btn btn-secondary"
          disabled={disabled || !hasVault}
          onClick={onChangePassword}
        >
          <KeyRound size={16} />
          {t('修改保险库密码')}
        </button>
      </div>
      {!hasVault && (
        <p className="muted small">{t('先保存到加密库，再修改密码。')}</p>
      )}
      {children}
    </section>
  );
}
