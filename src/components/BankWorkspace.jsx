import React from 'react';
import { Landmark, ArrowUpRight } from 'lucide-react';
import { BANKS, bankOf } from '../core/banks.js';
export default function BankWorkspace({
  selected,
  onSelect,
  transactions,
  bankName,
  t,
}) {
  const bank = BANKS.find((bank) => bank.id === selected);
  return (
    <section className="bank-workspace" aria-labelledby="bank-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">YOUR CARD PORTFOLIO</p>
          <h2 id="bank-heading">{t('银行工作区')}</h2>
          <p>{t('选择银行可筛选交易。导入银行由下方独立设置。')}</p>
        </div>
        <span className="local-chip">
          <span />
          {t('本地处理')}
        </span>
      </div>
      <div className="bank-list" role="group" aria-label={t('银行')}>
        <button
          className={`bank-tile ${selected === 'all' ? 'selected' : ''}`}
          aria-pressed={selected === 'all'}
          onClick={() => onSelect('all')}
        >
          <span className="bank-monogram all-banks">
            <Landmark size={22} />
          </span>
          <span>{t('全部银行')}</span>
          <small>{transactions.length}</small>
        </button>
        {BANKS.map((bank) => (
          <button
            key={bank.id}
            className={`bank-tile ${selected === bank.id ? 'selected' : ''}`}
            aria-pressed={selected === bank.id}
            onClick={() => onSelect(bank.id)}
          >
            <span className="bank-monogram" style={{ background: bank.color }}>
              {bank.short}
            </span>
            <span>{bankName(bank)}</span>
            <small>
              {transactions.filter((tx) => bankOf(tx) === bank.id).length}
            </small>
          </button>
        ))}
      </div>
      {bank && (
        <div className="bank-capability">
          <span className="badge-tag">
            {t(bank.pdf ? '支持 PDF / CSV' : '支持标准 CSV')}
          </span>
          <span>
            {bank.id === 'hsbc'
              ? 'HSBC Pulse / Red'
              : t('自定义规则 · 不预置官方费率')}
          </span>
          {bank.url && (
            <a href={bank.url} target="_blank" rel="noreferrer">
              {t('银行官方资料')}
              <ArrowUpRight size={14} />
            </a>
          )}
        </div>
      )}
    </section>
  );
}
