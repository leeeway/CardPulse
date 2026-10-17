import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  CreditCard,
  UploadCloud,
  ShieldCheck,
  Lock,
  Download,
  Trash2,
  Eye,
  FileText,
  ArrowUpRight,
} from 'lucide-react';
import { DEMO_TRANSACTIONS } from './core/demo.js';
import {
  calculateRewards,
  fromScaledBigInt,
  getHongKongDate,
} from './core/rewards.js';
import { filterTransactions, exportToSafeCsv } from './core/transactions.js';
import { fetchHkdCnyRate } from './core/exchange.js';
import { fingerprintFile, mergeStatement } from './core/imports.js';
import {
  saveToVault,
  loadFromVault,
  clearVault,
  hasEncryptedVault,
} from './core/storage.js';
import { BANKS, getBank, bankOf, cardsFor, cardName } from './core/banks.js';
import {
  CSV_TEMPLATE,
  MAX_CSV_BYTES,
  parseStandardCsv,
} from './core/csv-import.js';
import {
  readPreferences,
  savePreferences,
  THEMES,
} from './core/preferences.js';
import { translate, channelText } from './core/i18n.js';
import { normalizeWorkspace, emptyWorkspace } from './core/workspace.js';
import CampaignPanel from './components/CampaignPanel.jsx';
import BankWorkspace from './components/BankWorkspace.jsx';

const emptyFilters = () => ({
  search: '',
  direction: 'all',
  currency: 'all',
  category: 'all',
});
function download(content, fileName, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
  const [preferences, setPreferences] = useState(() => readPreferences());
  const t = (text, values) => translate(preferences.locale, text, values);
  const bankName = (bank) =>
    bank
      ? preferences.locale === 'zh-TW'
        ? bank.traditional
        : bank.name
      : t('未知');
  const [workspace, setWorkspace] = useState(emptyWorkspace);
  const { transactions, statements, campaigns } = workspace;
  const [activeBank, setActiveBank] = useState('all');
  const [importBank, setImportBank] = useState('hsbc');
  const [importCard, setImportCard] = useState('hsbc_pulse');
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState([]);
  const [isDemo, setIsDemo] = useState(false);
  const [rateInfo, setRateInfo] = useState({ rate: null });
  const [filters, setFilters] = useState(emptyFilters);
  const [vaultLocked, setVaultLocked] = useState(false);
  const [hasVault, setHasVault] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [vaultReady, setVaultReady] = useState(false);
  const [vaultBusy, setVaultBusy] = useState(false);
  const [passwordMode, setPasswordMode] = useState('unlock');
  const [masterPassword, setMasterPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const busyRef = useRef(false);
  const fileInputRef = useRef(null);
  const unavailable = loadingFile || vaultBusy || vaultLocked || !vaultReady;

  useEffect(() => {
    document.documentElement.lang = preferences.locale;
    document.title = `CardPulse · ${translate(preferences.locale, '本地信用卡工作区')}`;
    document.documentElement.dataset.theme = preferences.theme;
    savePreferences(preferences);
  }, [preferences]);
  useEffect(() => {
    const controller = new AbortController();
    fetchHkdCnyRate({ signal: controller.signal })
      .then(setRateInfo)
      .catch(() => {});
    hasEncryptedVault()
      .then((exists) => {
        setHasVault(exists);
        setVaultLocked(exists);
        setVaultReady(true);
      })
      .catch(() => setNotice([{ text: '无法访问本地库，请刷新后重试。' }]));
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const activeTransactions = isDemo ? DEMO_TRANSACTIONS : transactions;
  const bankTransactions = useMemo(
    () =>
      activeTransactions.filter(
        (tx) => activeBank === 'all' || bankOf(tx) === activeBank,
      ),
    [activeTransactions, activeBank],
  );
  const filteredList = useMemo(
    () => filterTransactions(bankTransactions, filters),
    [bankTransactions, filters],
  );
  const rewards = useMemo(
    () => calculateRewards(bankTransactions, { hkdCnyRate: rateInfo.rate }),
    [bankTransactions, rateInfo.rate],
  );
  const showPulse = activeBank === 'all' || activeBank === 'hsbc';

  const openPassword = (mode) => {
    setMasterPassword('');
    setPasswordError('');
    setPasswordMode(mode);
    setShowPasswordModal(true);
  };
  const closePassword = () => {
    if (!busyRef.current) {
      setMasterPassword('');
      setPasswordError('');
      setShowPasswordModal(false);
    }
  };
  const clearMemory = () => {
    setWorkspace(emptyWorkspace());
    setFilters(emptyFilters());
    setActiveBank('all');
    setDirty(false);
    setMasterPassword('');
    setIsDemo(false);
  };
  const handleClear = async () => {
    if (unavailable || busyRef.current) return;
    if (isDemo) {
      setIsDemo(false);
      return;
    }
    if (!confirm(t('确认清空全部交易、活动及本地保险库？此操作不可恢复。')))
      return;
    busyRef.current = true;
    setVaultBusy(true);
    try {
      await clearVault();
      clearMemory();
      setHasVault(false);
      setNotice([{ text: '已清空交易及本地保险库' }]);
    } catch (error) {
      setNotice([{ text: error.message }]);
    } finally {
      busyRef.current = false;
      setVaultBusy(false);
    }
  };
  const handleLock = () => {
    if (busyRef.current) return;
    if (
      dirty &&
      !confirm(t('存在尚未保存的修改，锁定将丢弃这些修改。确认锁定？'))
    )
      return;
    clearMemory();
    setVaultLocked(true);
    setNotice([{ text: '保险库已锁定' }]);
  };
  const handleFiles = async (files) => {
    if (!files?.length || unavailable || busyRef.current) return;
    const selectedBank = importBank,
      selectedCard = importCard;
    const inputFiles = Array.from(files);
    busyRef.current = true;
    setLoadingFile(true);
    setIsDemo(false);
    setActiveBank('all');
    const messages = [];
    let next = workspace;
    try {
      for (const file of inputFiles) {
        try {
          const isPdf = /\.pdf$/i.test(file.name),
            isCsv = /\.csv$/i.test(file.name);
          if (!isPdf && !isCsv) throw new Error('仅支持 PDF 或 CSV 文件');
          if (file.size > (isPdf ? 25 * 1024 * 1024 : MAX_CSV_BYTES))
            throw new Error('文件超过大小限制');
          if (isPdf && !getBank(selectedBank)?.pdf)
            throw new Error('此银行的 PDF 版式尚未适配，请使用标准 CSV 导入');
          const fingerprint = await fingerprintFile(file, {
            bankId: selectedBank,
            cardId: selectedCard,
          });
          if (next.statements.some((item) => item.id === fingerprint)) {
            messages.push({ file: file.name, text: '已导入，跳过重复文件' });
            continue;
          }
          let result;
          if (isCsv)
            result = parseStandardCsv(await file.text(), file.name, {
              bankId: selectedBank,
              cardId: selectedCard,
            });
          else {
            const { parsePdfStatement } = await import('./core/pdf.js');
            let password;
            while (!result) {
              try {
                result = await parsePdfStatement(file, {
                  password,
                  cardId: selectedCard,
                });
              } catch (error) {
                if (error.code !== 'password') throw error;
                password = prompt(
                  `${file.name}：${t(error.message)}。${t('请输入 PDF 密码（仅本地使用，取消则跳过）')}`,
                );
                if (password === null) break;
              }
            }
          }
          if (!result) {
            messages.push({ file: file.name, text: '已取消' });
            continue;
          }
          if (!result.transactions.length) {
            result.warnings.forEach((text) =>
              messages.push({ file: file.name, text }),
            );
            continue;
          }
          next = mergeStatement(next, result, fingerprint);
          setWorkspace(normalizeWorkspace(next));
          setDirty(true);
          messages.push({
            file: file.name,
            text: '已导入 {count} 笔交易',
            values: { count: result.transactions.length },
          });
        } catch (error) {
          messages.push({ file: file.name, text: error.message });
        }
      }
    } finally {
      setNotice(messages);
      setLoadingFile(false);
      busyRef.current = false;
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };
  const handlePasswordSubmit = async (event) => {
    event?.preventDefault();
    if (busyRef.current) return;
    if (!masterPassword) {
      setPasswordError('请输入主密码');
      return;
    }
    busyRef.current = true;
    setVaultBusy(true);
    try {
      if (passwordMode === 'unlock') {
        const data = normalizeWorkspace(await loadFromVault(masterPassword));
        setWorkspace(data);
        setIsDemo(false);
        setVaultLocked(false);
        setDirty(false);
        setNotice([]);
      } else {
        if (hasVault && !(await loadFromVault(masterPassword)))
          throw new Error('本地库不存在，请刷新后重试');
        await saveToVault(workspace, masterPassword);
        setHasVault(true);
        setVaultLocked(false);
        setDirty(false);
        setNotice([{ text: '已加密保存到本地保险库' }]);
      }
      setMasterPassword('');
      setShowPasswordModal(false);
      setPasswordError('');
    } catch (error) {
      setPasswordError(error.message || '操作失败，请重试');
    } finally {
      busyRef.current = false;
      setVaultBusy(false);
    }
  };
  const mutateCampaigns = (next) => {
    if (!unavailable && !isDemo) {
      const updated = { ...workspace, campaigns: next(campaigns) };
      setWorkspace(updated);
      setDirty(
        hasVault ||
          updated.transactions.length > 0 ||
          updated.campaigns.length > 0,
      );
    }
  };

  return (
    <div className="app-container">
      <header className="header">
        <div className="brand-wrapper">
          <div className="brand-logo">
            <CreditCard size={23} />
          </div>
          <div>
            <div className="brand-title">
              CardPulse<span className="brand-version">LOCAL / PRIVATE</span>
            </div>
            <p className="brand-subtitle">{t('本地信用卡工作区')}</p>
          </div>
        </div>
        <div className="preferences">
          <label>
            {t('语言')}
            <select
              aria-label={t('语言')}
              value={preferences.locale}
              onChange={(e) =>
                setPreferences((prev) => ({ ...prev, locale: e.target.value }))
              }
            >
              <option value="zh-CN">简体中文</option>
              <option value="zh-TW">繁體中文</option>
            </select>
          </label>
          <label>
            {t('网站配色')}
            <select
              aria-label={t('网站配色')}
              value={preferences.theme}
              onChange={(e) =>
                setPreferences((prev) => ({ ...prev, theme: e.target.value }))
              }
            >
              {THEMES.map((theme, index) => (
                <option key={theme} value={theme}>
                  {t(['午夜蓝', '明亮白', '宝石红', '翡翠绿'][index])}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>
      <div className="page-intro">
        <div>
          <p className="eyebrow">STATEMENTS, MADE CLEAR.</p>
          <h1>{t('整理交易，核对结单，管理每一份奖赏。')}</h1>
        </div>
        <div className="header-actions">
          {hasVault && (
            <button
              className="btn btn-secondary"
              disabled={loadingFile || vaultBusy}
              onClick={() =>
                vaultLocked ? openPassword('unlock') : handleLock()
              }
            >
              <Lock size={14} />
              {t(vaultLocked ? '解锁本地库' : '锁定保险库')}
            </button>
          )}
          {!vaultLocked &&
            vaultReady &&
            !isDemo &&
            (hasVault || transactions.length > 0 || campaigns.length > 0) && (
              <button
                className="btn btn-primary"
                disabled={loadingFile || vaultBusy}
                onClick={() => openPassword('save')}
              >
                <ShieldCheck size={14} />
                {t('保存到加密库')}
                {dirty && <span className="unsaved-dot" />}
              </button>
            )}
          <button
            className="btn btn-secondary"
            disabled={loadingFile || vaultBusy}
            onClick={() => setIsDemo((prev) => !prev)}
          >
            <Eye size={14} />
            {t(isDemo ? '退出演示数据' : '查看示例数据')}
          </button>
          {activeTransactions.length > 0 && (
            <button
              className="btn btn-secondary"
              onClick={() =>
                download(
                  exportToSafeCsv(filteredList, t),
                  `CardPulse_${getHongKongDate()}.csv`,
                  'text/csv;charset=utf-8;',
                )
              }
            >
              <Download size={14} />
              {t('导出 CSV')}
            </button>
          )}
          {(hasVault ||
            activeTransactions.length > 0 ||
            campaigns.length > 0) && (
            <button
              className="btn btn-ghost"
              disabled={unavailable}
              onClick={handleClear}
              title={t('清空数据')}
              aria-label={t('清空数据')}
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>
      <div
        className={`workspace-status ${dirty ? 'has-changes' : ''}`}
        role="status"
      >
        <ShieldCheck size={16} />
        <div>
          {t(
            vaultLocked
              ? '本地保险库已锁定，请先解锁再导入。'
              : dirty
                ? '有未保存的修改，请保存到加密库。'
                : '数据仅在本地处理。',
          )}
          {notice.map((item, index) => (
            <p key={index}>
              {item.file && `${item.file}：`}
              {t(item.text, item.values)}
            </p>
          ))}
        </div>
      </div>
      <BankWorkspace
        selected={activeBank}
        onSelect={setActiveBank}
        transactions={activeTransactions}
        bankName={bankName}
        t={t}
      />
      {showPulse && (
        <section aria-label={t('Pulse 内置估算')} className="pulse-section">
          <div className="section-heading compact">
            <h2>{t('Pulse 内置估算')}</h2>
            <span className="muted small">
              {rateInfo.rate
                ? `1 HKD ≈ ${rateInfo.rate} CNY · ${rateInfo.date}`
                : t(rateInfo.isFallback ? '汇率暂不可用' : '正在获取汇率…')}
            </span>
          </div>
          <div className="rewards-grid">
            <RewardCard
              title={t('本年预计总返现')}
              badge="HSBC Pulse"
              value={rewards.totalCny}
              description={t('基础 + 赏世界 + Pulse 专属')}
              primary
            />
            <RewardCard
              title={t('基础净签账返现')}
              badge={t('0.4% 无上限')}
              value={rewards.base.totalCny}
              description={t('港币部分已折算')}
            />
            <RewardCard
              title={t('赏世界额外奖赏')}
              badge={t('额外 2%')}
              value={rewards.world.cashback}
              progress={rewards.world.progress}
              description={t('已用 {used} / {cap}', {
                used: fromScaledBigInt(rewards.world.used),
                cap: '100,000',
              })}
            />
            <RewardCard
              title={t('Pulse 内地奖赏')}
              badge="Apple Pay / QR +2%"
              value={rewards.pulse.cashback}
              progress={rewards.pulse.progress}
              description={`${t('当前半年额度')} · ${rewards.pulse.progress.toFixed(1)}%`}
            />
          </div>
          <p className="muted small">
            {t(
              '内置模型未核验最新活动资格，仅适用于 Pulse；其他卡片请配置自定义活动。',
            )}
            {rewards.pendingCount > 0 &&
              ` ${t('{count} 笔记录需要确认渠道或使用自定义规则。', { count: rewards.pendingCount })}`}
          </p>
        </section>
      )}
      <CampaignPanel
        key={`${vaultLocked}-${isDemo}`}
        campaigns={
          isDemo
            ? []
            : campaigns.filter(
                (c) => activeBank === 'all' || c.bankId === activeBank,
              )
        }
        transactions={isDemo ? [] : transactions}
        disabled={unavailable || isDemo}
        bankName={bankName}
        t={t}
        onSave={(campaign) =>
          mutateCampaigns((prev) =>
            prev.some((c) => c.id === campaign.id)
              ? prev.map((c) => (c.id === campaign.id ? campaign : c))
              : [...prev, campaign],
          )
        }
        onDelete={(id) =>
          mutateCampaigns((prev) => prev.filter((c) => c.id !== id))
        }
      />
      <section className="panel import-panel" aria-labelledby="import-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">LOCAL IMPORT</p>
            <h2 id="import-heading">{t('导入结单与交易')}</h2>
            <p>{t('HSBC 支持指定 PDF 布局；其他银行请使用标准 CSV。')}</p>
          </div>
          <button
            className="btn btn-secondary"
            onClick={() =>
              download(
                '\uFEFF' + CSV_TEMPLATE,
                'CardPulse_Import_Template.csv',
                'text/csv;charset=utf-8;',
              )
            }
          >
            <Download size={14} />
            {t('下载 CSV 模板')}
          </button>
        </div>
        <div className="import-options">
          <label className="field">
            <span>{t('导入银行')}</span>
            <select
              aria-label={t('导入银行')}
              value={importBank}
              disabled={unavailable}
              onChange={(e) => {
                setImportBank(e.target.value);
                setImportCard(cardsFor(e.target.value)[0]);
              }}
            >
              {BANKS.map((bank) => (
                <option key={bank.id} value={bank.id}>
                  {bankName(bank)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('导入卡片')}</span>
            <select
              aria-label={t('导入卡片')}
              value={importCard}
              disabled={unavailable}
              onChange={(e) => setImportCard(e.target.value)}
            >
              {cardsFor(importBank).map((id) => (
                <option key={id} value={id}>
                  {t(cardName(id))}
                </option>
              ))}
            </select>
          </label>
          <span className="badge-tag">
            {t(getBank(importBank)?.pdf ? '支持 PDF / CSV' : '支持标准 CSV')}
          </span>
        </div>
        <div
          className={`dropzone ${isDragging ? 'active' : ''}`}
          role="button"
          tabIndex={unavailable ? -1 : 0}
          aria-label={t('选择文件或拖入 PDF / CSV')}
          aria-disabled={unavailable}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            handleFiles(e.dataTransfer.files);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              if (!unavailable && !busyRef.current)
                fileInputRef.current?.click();
            }
          }}
          onClick={() => {
            if (!unavailable && !busyRef.current) fileInputRef.current?.click();
          }}
        >
          <input
            type="file"
            ref={fileInputRef}
            hidden
            accept=".pdf,.csv"
            multiple
            disabled={unavailable}
            onChange={(e) => handleFiles(e.target.files)}
          />
          <UploadCloud size={30} />
          <strong>
            {t(loadingFile ? '正在本地解析…' : '选择文件或拖入 PDF / CSV')}
          </strong>
          <p>{t('PDF 每份最多 25 MB / 200 页；CSV 每份最多 5 MB。')}</p>
        </div>
      </section>
      {!isDemo && statements.length > 0 && (
        <details className="statement-status">
          <summary>
            <FileText size={16} />
            {t('查看结单与对账')} · {statements.length}
          </summary>
          <div aria-label={t('结单与对账结果')}>
            {statements
              .filter(
                (s) =>
                  activeBank === 'all' || (s.bankId || 'hsbc') === activeBank,
              )
              .map((statement) => (
                <div key={statement.id} className="statement-row">
                  <strong>{statement.fileName}</strong> ·{' '}
                  {t('{count} 笔交易', { count: statement.transactionCount })}
                  {(statement.reconciliation || []).map((result) => (
                    <p key={result.currency}>
                      {result.currency}：
                      {t(
                        result.status === 'matched'
                          ? '对账一致'
                          : result.status === 'mismatch'
                            ? '对账不符，差额 {difference}'
                            : '缺少结欠，未验证对账',
                        { difference: result.difference },
                      )}
                    </p>
                  ))}
                  {statement.warnings?.map((warning, index) => (
                    <p key={index}>{t(warning)}</p>
                  ))}
                </div>
              ))}
          </div>
        </details>
      )}
      <section
        className="transactions-section"
        aria-labelledby="transactions-heading"
      >
        <div className="section-heading compact">
          <h2 id="transactions-heading">{t('交易记录')}</h2>
          <span className="muted small">
            {t('{count} 笔交易', { count: filteredList.length })}
          </span>
        </div>
        {activeTransactions.length > 0 && (
          <div className="filter-bar">
            <input
              className="search-input"
              type="search"
              aria-label={t('搜索商户、卡号或备注')}
              placeholder={t('搜索商户、卡号或备注')}
              value={filters.search}
              onChange={(e) =>
                setFilters((f) => ({ ...f, search: e.target.value }))
              }
            />
            <select
              aria-label={t('币种')}
              value={filters.currency}
              onChange={(e) =>
                setFilters((f) => ({ ...f, currency: e.target.value }))
              }
            >
              {[
                ['all', '所有币种'],
                ['CNY', '人民币 CNY'],
                ['HKD', '港币 HKD'],
              ].map(([value, label]) => (
                <option key={value} value={value}>
                  {t(label)}
                </option>
              ))}
            </select>
            <select
              aria-label={t('收支方向')}
              value={filters.direction}
              onChange={(e) =>
                setFilters((f) => ({ ...f, direction: e.target.value }))
              }
            >
              {[
                ['all', '所有收支'],
                ['debit', '消费支出'],
                ['credit', '入账 / 退款 / 还款'],
              ].map(([value, label]) => (
                <option key={value} value={value}>
                  {t(label)}
                </option>
              ))}
            </select>
            <select
              aria-label={t('分类')}
              value={filters.category}
              onChange={(e) =>
                setFilters((f) => ({ ...f, category: e.target.value }))
              }
            >
              {[
                ['all', '所有分类'],
                ['spend', '消费'],
                ['credit', '退款'],
                ['repayment', '还款'],
                ['fee', '费用 / 利息'],
              ].map(([value, label]) => (
                <option key={value} value={value}>
                  {t(label)}
                </option>
              ))}
            </select>
          </div>
        )}
        {filteredList.length ? (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  {[
                    '日期',
                    '银行与卡片',
                    '商户与描述',
                    '渠道',
                    '币种',
                    '金额',
                  ].map((label) => (
                    <th key={label}>{t(label)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredList.map((tx) => (
                  <tr key={tx.id}>
                    <td>
                      <strong>{tx.day}</strong>
                      <small>
                        {t('交易日期')}：{tx.transactionDay || '—'}
                      </small>
                    </td>
                    <td>
                      <span
                        className="bank-dot"
                        style={{ background: getBank(bankOf(tx))?.color }}
                      />
                      {bankName(getBank(bankOf(tx)))}
                      <small>
                        {t(cardName(tx.ruleId))} ···· {tx.last4 || t('未知')}
                      </small>
                    </td>
                    <td>
                      <strong>{tx.description}</strong>
                      {tx.notes?.length > 0 && (
                        <small>{tx.notes.join(' · ')}</small>
                      )}
                    </td>
                    <td>
                      <span
                        className={`badge-tag ${tx.channel?.pulse ? 'eligible-channel' : ''}`}
                      >
                        {t(
                          tx.channel?.uncertain
                            ? '待确认渠道'
                            : channelText(tx.channel?.key),
                        )}
                      </span>
                    </td>
                    <td>{tx.currency}</td>
                    <td
                      className={`amount ${tx.direction === 'credit' ? 'text-credit' : ''}`}
                    >
                      {tx.direction === 'credit' ? '−' : '+'}
                      {tx.amount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <CreditCard size={30} />
            <h3>
              {t(
                activeTransactions.length
                  ? '未找到匹配的交易记录'
                  : '从一份结单开始',
              )}
            </h3>
            {!activeTransactions.length && (
              <p>{t('导入 PDF 或标准 CSV，也可以先查看示例数据。')}</p>
            )}
          </div>
        )}
      </section>
      <footer>
        <span>CardPulse</span>
        <span>{t('本地估算工具 · 与银行无官方关联')}</span>
        <a
          href="https://github.com/leeeway/CardPulse"
          target="_blank"
          rel="noreferrer"
        >
          GitHub <ArrowUpRight size={13} />
        </a>
      </footer>
      {showPasswordModal && (
        <div className="modal-overlay" onClick={closePassword}>
          <form
            className="modal-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="vault-title"
            onClick={(e) => e.stopPropagation()}
            onSubmit={handlePasswordSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Escape') closePassword();
            }}
          >
            <div className="modal-header">
              <h2 id="vault-title">
                {t(
                  passwordMode === 'unlock'
                    ? '解锁本地加密库'
                    : '保存到本地加密库',
                )}
              </h2>
              <button
                className="btn btn-ghost"
                type="button"
                aria-label={t('关闭')}
                disabled={vaultBusy}
                onClick={closePassword}
              >
                ✕
              </button>
            </div>
            <p className="muted small">
              {t(
                passwordMode === 'unlock' || hasVault
                  ? '请输入现有主密码，数据仅在本地加解密。'
                  : '请设置主密码。忘记密码后无法找回，请妥善保管。',
              )}
            </p>
            <label className="field">
              <span>{t('主密码')}</span>
              <input
                autoFocus
                type="password"
                autoComplete={
                  passwordMode === 'save' && !hasVault
                    ? 'new-password'
                    : 'current-password'
                }
                disabled={vaultBusy}
                value={masterPassword}
                onChange={(e) => setMasterPassword(e.target.value)}
              />
            </label>
            {passwordError && (
              <p className="error" role="alert">
                {t(passwordError)}
              </p>
            )}
            <div className="form-actions">
              <button
                className="btn btn-secondary"
                type="button"
                disabled={vaultBusy}
                onClick={closePassword}
              >
                {t('取消')}
              </button>
              <button
                className="btn btn-primary"
                disabled={vaultBusy}
                type="submit"
              >
                {t(
                  vaultBusy
                    ? '处理中…'
                    : passwordMode === 'unlock'
                      ? '解锁数据'
                      : '加密保存',
                )}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
function RewardCard({ title, badge, value, description, progress, primary }) {
  return (
    <article className={`reward-card ${primary ? 'primary-reward' : ''}`}>
      <div className="reward-card-header">
        <span>{title}</span>
        <span className="reward-badge">{badge}</span>
      </div>
      <div className="reward-card-value">
        <small>CNY</small>
        {value === null ? '—' : fromScaledBigInt(value)}
      </div>
      {progress !== undefined && (
        <div className="progress-bar-bg">
          <div
            className="progress-bar-fill"
            style={{ width: `${Math.min(100, progress)}%` }}
          />
        </div>
      )}
      <p className="small muted">{description}</p>
    </article>
  );
}
