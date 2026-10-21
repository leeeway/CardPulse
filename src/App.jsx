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
  Archive,
  FolderOpen,
} from 'lucide-react';
import { DEMO_TRANSACTIONS } from './core/demo.js';
import {
  calculateRewards,
  fromScaledBigInt,
  getHongKongDate,
} from './core/rewards.js';
import { filterTransactions, exportToSafeCsv } from './core/transactions.js';
import { fetchHkdCnyRate } from './core/exchange.js';
import {
  fingerprintFile,
  mergeStatement,
  belongsToStatement,
  removeStatement,
} from './core/imports.js';
import { reviewTransaction, categoryText } from './core/review.js';
import TransactionReviewDialog from './components/TransactionReviewDialog.jsx';
import PulseBreakdown from './components/PulseBreakdown.jsx';
import { createVaultClient } from './core/storage.js';
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
import {
  normalizeWorkspace,
  emptyWorkspace,
  hasWorkspaceData,
} from './core/workspace.js';
import CampaignPanel from './components/CampaignPanel.jsx';
import useHongKongDate from './hooks/useHongKongDate.js';
import BankWorkspace from './components/BankWorkspace.jsx';
import DataSettings from './components/DataSettings.jsx';
import PdfPasswordDialog from './components/PdfPasswordDialog.jsx';
import {
  encryptWorkspace,
  decryptWorkspace,
  serializeBackup,
  parseBackup,
  MAX_BACKUP_BYTES,
} from './core/backup.js';
import { isIsoDate } from './core/campaigns.js';

const emptyFilters = () => ({
  search: '',
  direction: 'all',
  currency: 'all',
  category: 'all',
  from: '',
  to: '',
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
  const today = useHongKongDate();
  const [{ saveToVault, loadFromVault, clearVault, hasEncryptedVault }] =
    useState(createVaultClient);
  const [preferences, setPreferences] = useState(() => readPreferences());
  const t = (text, values) => translate(preferences.locale, text, values);
  const bankName = (bank) =>
    bank
      ? preferences.locale === 'zh-TW'
        ? bank.traditional
        : bank.name
      : t('未知');
  const [workspace, setWorkspace] = useState(emptyWorkspace);
  const [workspaceSession, setWorkspaceSession] = useState(0);
  const { transactions, statements, campaigns } = workspace;
  const workspaceHasData = hasWorkspaceData(workspace);
  const [activeBank, setActiveBank] = useState('all');
  const [importBank, setImportBank] = useState('hsbc');
  const [importCard, setImportCard] = useState('hsbc_pulse');
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState([]);
  const [isDemo, setIsDemo] = useState(false);
  const rateInfo = workspace.exchangeRate || { rate: null, isFallback: true };
  const [rateBusy, setRateBusy] = useState(false);
  const [pendingBackup, setPendingBackup] = useState(null);
  const [pdfPasswordRequest, setPdfPasswordRequest] = useState(null);
  const [filters, setFilters] = useState(emptyFilters);
  const [reviewId, setReviewId] = useState(null);
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
  const backupInputRef = useRef(null);
  const pdfPasswordResolver = useRef(null);
  const unavailable =
    loadingFile || vaultBusy || rateBusy || vaultLocked || !vaultReady;

  useEffect(() => {
    document.documentElement.lang = preferences.locale;
    document.title = `CardPulse · ${translate(preferences.locale, '本地信用卡工作区')}`;
    document.documentElement.dataset.theme = preferences.theme;
    savePreferences(preferences);
  }, [preferences]);
  useEffect(() => {
    hasEncryptedVault()
      .then((exists) => {
        setHasVault(exists);
        setVaultLocked(exists);
        setVaultReady(true);
      })
      .catch(() => setNotice([{ text: '无法访问本地库，请刷新后重试。' }]));
    return () => {
      pdfPasswordResolver.current?.(null);
    };
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
    () =>
      calculateRewards(bankTransactions, { today, hkdCnyRate: rateInfo.rate }),
    [bankTransactions, rateInfo.rate, today],
  );
  const invalidDateRange = Boolean(
    filters.from && filters.to && filters.from > filters.to,
  );
  const reviewTarget = transactions.find((tx) => tx.id === reviewId);
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
      setPendingBackup(null);
    }
  };
  const clearMemory = () => {
    setWorkspaceSession((value) => value + 1);
    setReviewId(null);
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
                password = await new Promise((resolve) => {
                  pdfPasswordResolver.current = resolve;
                  setPdfPasswordRequest({
                    fileName: file.name,
                    error: error.message,
                  });
                });
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
          next = normalizeWorkspace(mergeStatement(next, result, fingerprint));
          setWorkspace(next);
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
        const data = normalizeWorkspace(
          await loadFromVault(masterPassword, { refresh: true }),
        );
        setWorkspace(data);
        setIsDemo(false);
        setVaultLocked(false);
        setDirty(false);
        setNotice([]);
      } else if (passwordMode === 'restore') {
        const data = await decryptWorkspace(pendingBackup, masterPassword);
        if (
          !confirm(
            t(
              '恢复将替换本地交易、活动和汇率设置，请先备份现有数据。确认恢复？',
            ),
          )
        )
          return;
        await saveToVault(data, masterPassword);
        setWorkspaceSession((value) => value + 1);
        setReviewId(null);
        setWorkspace(data);
        setHasVault(true);
        setVaultLocked(false);
        setDirty(false);
        setIsDemo(false);
        setActiveBank('all');
        setFilters(emptyFilters());
        setNotice([{ text: '已恢复加密备份' }]);
      } else if (passwordMode === 'backup') {
        // Export remains available after a conflict without rebasing this page.
        if (hasVault)
          await loadFromVault(masterPassword, { checkSnapshot: false });
        const payload = await encryptWorkspace(workspace, masterPassword);
        if (globalThis.cardpulseDesktop) {
          if (!(await globalThis.cardpulseDesktop.exportBackup(payload)))
            return;
        } else
          download(
            serializeBackup(payload),
            `CardPulse-${getHongKongDate()}.cardpulse`,
            'application/json',
          );
        setNotice([{ text: '已导出加密备份，未保存的修改仍需保存到加密库' }]);
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
      setPendingBackup(null);
    } catch (error) {
      setPasswordError(error.message || '操作失败，请重试');
    } finally {
      busyRef.current = false;
      setVaultBusy(false);
    }
  };
  const applyReview = (patch) => {
    if (unavailable || isDemo || busyRef.current || !reviewTarget) return;
    try {
      const updated = reviewTransaction(workspace, reviewId, patch);
      if (updated !== workspace) {
        setWorkspace(normalizeWorkspace(updated));
        setDirty(true);
        setNotice([{ text: '交易已修正，奖赏已重新计算；请保存到加密库。' }]);
      }
      setReviewId(null);
    } catch (error) {
      setNotice([{ text: error.message }]);
    }
  };
  const deleteStatement = (statement) => {
    if (unavailable || isDemo || busyRef.current) return;
    const count = transactions.filter((tx) =>
      belongsToStatement(tx, statement.id),
    ).length;
    if (
      !confirm(
        t(
          '删除结单「{file}」及其 {count} 笔交易？奖赏将重新计算。删除后需保存到加密库。',
          { file: statement.fileName || statement.id, count },
        ),
      )
    )
      return;
    const updated = removeStatement(workspace, statement.id);
    const needsSave = hasVault || hasWorkspaceData(updated);
    setWorkspace(updated);
    setReviewId(null);
    setDirty(needsSave);
    setNotice([
      {
        text: needsSave
          ? '结单及关联交易已删除，请保存到加密库。'
          : '已移除未保存的导入记录。',
      },
    ]);
  };
  const mutateCampaigns = (next) => {
    if (!unavailable && !isDemo) {
      const updated = { ...workspace, campaigns: next(campaigns) };
      setWorkspace(updated);
      setDirty(hasVault || hasWorkspaceData(updated));
    }
  };
  const resolvePdfPassword = (password) => {
    const resolve = pdfPasswordResolver.current;
    pdfPasswordResolver.current = null;
    setPdfPasswordRequest(null);
    resolve?.(password);
  };
  const pickBackup = async () => {
    if (busyRef.current || !vaultReady) return;
    if (!globalThis.cardpulseDesktop) {
      backupInputRef.current?.click();
      return;
    }
    busyRef.current = true;
    setVaultBusy(true);
    try {
      const payload = await globalThis.cardpulseDesktop.importBackup();
      if (payload) {
        setPendingBackup(payload);
        openPassword('restore');
      }
    } catch (error) {
      setNotice([{ text: error.message }]);
    } finally {
      busyRef.current = false;
      setVaultBusy(false);
    }
  };
  const readBackupFile = async (file) => {
    if (!file || busyRef.current || !vaultReady) return;
    busyRef.current = true;
    setVaultBusy(true);
    try {
      if (file.size > MAX_BACKUP_BYTES + 1024)
        throw new Error('备份文件过大或格式无效');
      setPendingBackup(parseBackup(await file.text()));
      openPassword('restore');
    } catch (error) {
      setNotice([{ text: error.message }]);
    } finally {
      busyRef.current = false;
      setVaultBusy(false);
      if (backupInputRef.current) backupInputRef.current.value = '';
    }
  };
  const applyRate = (value) => {
    if (unavailable || isDemo || busyRef.current) return;
    if (
      !/^\d+(?:\.\d{1,8})?$/.test(value) ||
      !(Number(value) > 0) ||
      Number(value) > 10000
    ) {
      setNotice([{ text: '汇率格式无效' }]);
      return;
    }
    setWorkspace((prev) => ({
      ...prev,
      exchangeRate: {
        rate: Number(value),
        date: getHongKongDate(),
        source: 'manual',
      },
    }));
    setDirty(true);
  };
  const refreshRate = async () => {
    if (unavailable || isDemo || busyRef.current) return;
    busyRef.current = true;
    setRateBusy(true);
    try {
      const info = await fetchHkdCnyRate({
        signal: AbortSignal.timeout(10000),
      });
      if (!(info.rate > 0) || !isIsoDate(info.date))
        throw new Error('汇率暂不可用');
      setWorkspace((prev) => ({ ...prev, exchangeRate: info }));
      setDirty(true);
    } catch {
      setNotice([{ text: '汇率暂不可用' }]);
    } finally {
      busyRef.current = false;
      setRateBusy(false);
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
              CardPulse
              <span className="brand-version">
                {globalThis.cardpulseDesktop
                  ? 'DESKTOP / PRIVATE'
                  : 'LOCAL / PRIVATE'}
              </span>
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
          <input
            ref={backupInputRef}
            type="file"
            hidden
            accept=".cardpulse"
            aria-label={t('选择加密备份')}
            onChange={(e) => readBackupFile(e.target.files?.[0])}
          />
          <button
            className="btn btn-secondary"
            disabled={loadingFile || vaultBusy || rateBusy || !vaultReady}
            onClick={pickBackup}
          >
            <FolderOpen size={14} />
            {t('恢复加密备份')}
          </button>
          {!vaultLocked && !isDemo && (workspaceHasData || hasVault) && (
            <button
              className="btn btn-secondary"
              disabled={unavailable}
              onClick={() => openPassword('backup')}
            >
              <Archive size={14} />
              {t('导出加密备份')}
            </button>
          )}
          {hasVault && (
            <button
              className="btn btn-secondary"
              disabled={loadingFile || vaultBusy || rateBusy}
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
            (hasVault || workspaceHasData) && (
              <button
                className="btn btn-primary"
                disabled={loadingFile || vaultBusy || rateBusy}
                onClick={() => openPassword('save')}
              >
                <ShieldCheck size={14} />
                {t('保存到加密库')}
                {dirty && <span className="unsaved-dot" />}
              </button>
            )}
          <button
            className="btn btn-secondary"
            disabled={loadingFile || vaultBusy || rateBusy}
            onClick={() => setIsDemo((prev) => !prev)}
          >
            <Eye size={14} />
            {t(isDemo ? '退出演示数据' : '查看示例数据')}
          </button>
          {activeTransactions.length > 0 && (
            <button
              className="btn btn-secondary"
              disabled={invalidDateRange}
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
          {(hasVault || workspaceHasData || activeTransactions.length > 0) && (
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
      <DataSettings
        rateInfo={rateInfo}
        disabled={unavailable || isDemo}
        rateBusy={rateBusy}
        onApplyRate={applyRate}
        onFetchRate={refreshRate}
        t={t}
      />
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
              description={t(
                rewards.base.hkdConvertedCny === null
                  ? '缺少汇率，港币部分尚未折算'
                  : '港币部分已折算',
              )}
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
          <PulseBreakdown
            key={`${workspaceSession}-${vaultLocked}-${isDemo}-${activeBank}`}
            result={rewards}
            transactions={bankTransactions}
            rate={rateInfo.rate}
            t={t}
          />
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
        key={`${workspaceSession}-${vaultLocked}-${isDemo}`}
        today={today}
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
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={unavailable}
                    onClick={() => deleteStatement(statement)}
                  >
                    <Trash2 size={14} />
                    {t('删除结单')}
                  </button>
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
            <div
              className="date-filter"
              role="group"
              aria-label={t('按记账日期筛选')}
            >
              <label>
                <span>{t('记账起始日期')}</span>
                <input
                  type="date"
                  aria-label={t('记账起始日期')}
                  value={filters.from}
                  max={filters.to || undefined}
                  aria-invalid={invalidDateRange}
                  aria-describedby={
                    invalidDateRange ? 'date-filter-error' : undefined
                  }
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      from: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                <span>{t('记账截止日期')}</span>
                <input
                  type="date"
                  aria-label={t('记账截止日期')}
                  value={filters.to}
                  min={filters.from || undefined}
                  aria-invalid={invalidDateRange}
                  aria-describedby={
                    invalidDateRange ? 'date-filter-error' : undefined
                  }
                  onChange={(event) =>
                    setFilters((prev) => ({ ...prev, to: event.target.value }))
                  }
                />
              </label>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setFilters(emptyFilters())}
              >
                {t('重置筛选')}
              </button>
              <p className="muted small">
                {t('日期筛选仅影响交易列表和 CSV 导出，不改变奖赏计算。')}
              </p>
              {invalidDateRange && (
                <p className="error" id="date-filter-error" role="alert">
                  {t('起始日期不能晚于结束日期')}
                </p>
              )}
            </div>
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
                    '操作',
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
                      <small>
                        {t(
                          categoryText(
                            tx.category ||
                              (tx.direction === 'credit' ? 'credit' : 'spend'),
                          ),
                        )}
                        {tx.reviewHistory?.length > 0 &&
                          ` · ${t('已人工修正')}`}
                      </small>
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
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={unavailable || isDemo}
                        onClick={() => setReviewId(tx.id)}
                      >
                        {t('核对交易')}
                      </button>
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
                  passwordMode === 'backup'
                    ? '导出加密备份'
                    : passwordMode === 'restore'
                      ? '恢复加密备份'
                      : passwordMode === 'unlock'
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
                passwordMode === 'restore'
                  ? '请输入备份文件的密码，验证成功后才会替换本地数据。'
                  : passwordMode === 'unlock' || hasVault
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
                    : passwordMode === 'restore'
                      ? '确认恢复'
                      : passwordMode === 'backup'
                        ? '导出加密备份'
                        : passwordMode === 'unlock'
                          ? '解锁数据'
                          : '加密保存',
                )}
              </button>
            </div>
          </form>
        </div>
      )}
      {reviewTarget && !isDemo && !unavailable && (
        <TransactionReviewDialog
          key={reviewTarget.id}
          transaction={reviewTarget}
          onSave={applyReview}
          onClose={() => setReviewId(null)}
          t={t}
          locale={preferences.locale}
        />
      )}
      {pdfPasswordRequest && (
        <PdfPasswordDialog
          key={`${pdfPasswordRequest.fileName}-${pdfPasswordRequest.error}`}
          request={pdfPasswordRequest}
          onResolve={resolvePdfPassword}
          t={t}
        />
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
