import React, {
  useState,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
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
  estimatePulseTransaction,
  fromScaledBigInt,
  getHongKongDate,
  isPulseTransaction,
  PULSE_REASONS,
} from './core/rewards.js';
import { filterTransactions, exportToSafeCsv } from './core/transactions.js';
import { fetchHkdCnyRate } from './core/exchange.js';
import {
  fingerprintFile,
  mergeStatement,
  stageStatementSupplement,
  applyStatementImportSelection,
  belongsToStatement,
  removeStatement,
} from './core/imports.js';
import {
  reviewTransaction,
  reviewTransactions,
  restoreImportedReview,
  undoBatchReview,
  categoryText,
  MAX_BATCH_REVIEW,
} from './core/review.js';
import TransactionReviewDialog from './components/TransactionReviewDialog.jsx';
import BatchReviewDialog from './components/BatchReviewDialog.jsx';
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
import BuildInfo from './components/BuildInfo.jsx';
import DuplicateTransactions from './components/DuplicateTransactions.jsx';
import useHongKongDate from './hooks/useHongKongDate.js';
import useBackupReminder from './hooks/useBackupReminder.js';
import useIdleLock from './hooks/useIdleLock.js';
import BankWorkspace from './components/BankWorkspace.jsx';
import DataSettings from './components/DataSettings.jsx';
import VaultSettings from './components/VaultSettings.jsx';
import BackupReminder from './components/BackupReminder.jsx';
import IdleLockSettings from './components/IdleLockSettings.jsx';
import ChangePasswordDialog from './components/ChangePasswordDialog.jsx';
import PdfPasswordDialog from './components/PdfPasswordDialog.jsx';
import ImportPreviewDialog from './components/ImportPreviewDialog.jsx';
import { findImportDuplicates } from './core/duplicate-transactions.js';
import {
  encryptWorkspace,
  decryptWorkspace,
  serializeBackup,
  parseBackup,
  MAX_BACKUP_BYTES,
} from './core/backup.js';
import { isIsoDate } from './core/campaigns.js';
import { instantiateCampaignRules } from './core/campaign-rules.js';

const TRANSACTION_PAGE_SIZE = 25;
const emptyFilters = () => ({
  search: '',
  direction: 'all',
  currency: 'all',
  category: 'all',
  from: '',
  to: '',
  statementId: '',
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
  const backupReminder = useBackupReminder();
  const [
    {
      saveToVault,
      loadFromVault,
      clearVault,
      hasEncryptedVault,
      changePassword,
    },
  ] = useState(createVaultClient);
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
  const statementNumbers = useMemo(
    () =>
      new Map(statements.map((statement, index) => [statement.id, index + 1])),
    [statements],
  );
  const workspaceHasData = hasWorkspaceData(workspace);
  const [activeBank, setActiveBank] = useState('all');
  const bankStatements = useMemo(
    () =>
      statements.filter(
        (statement) =>
          activeBank === 'all' || (statement.bankId || 'hsbc') === activeBank,
      ),
    [statements, activeBank],
  );
  const [importBank, setImportBank] = useState('hsbc');
  const [importCard, setImportCard] = useState('hsbc_pulse');
  const [dirty, setDirty] = useState(false);
  const [campaignEditing, setCampaignEditing] = useState(false);
  const [rateEditing, setRateEditing] = useState(false);
  const [notice, setNotice] = useState([]);
  const [isDemo, setIsDemo] = useState(false);
  const visibleCampaigns = useMemo(
    () =>
      isDemo
        ? []
        : campaigns.filter(
            (c) => activeBank === 'all' || c.bankId === activeBank,
          ),
    [campaigns, activeBank, isDemo],
  );
  const rateInfo = workspace.exchangeRate || { rate: null, isFallback: true };
  const [rateBusy, setRateBusy] = useState(false);
  const [pendingBackup, setPendingBackup] = useState(null);
  const [pdfPasswordRequest, setPdfPasswordRequest] = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  const [filters, setFilters] = useState(emptyFilters);
  const [page, setPage] = useState(0);
  const [reviewId, setReviewId] = useState(null);
  const [batchIds, setBatchIds] = useState(null);
  const [batchReviewOpen, setBatchReviewOpen] = useState(false);
  const [lastBatchReview, setLastBatchReview] = useState(null);
  const [vaultLocked, setVaultLocked] = useState(false);
  const [hasVault, setHasVault] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [vaultReady, setVaultReady] = useState(false);
  const [vaultBusy, setVaultBusy] = useState(false);
  const [passwordMode, setPasswordMode] = useState('unlock');
  const [masterPassword, setMasterPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const busyRef = useRef(false);
  const fileInputRef = useRef(null);
  const supplementInputRef = useRef(null);
  const supplementTargetRef = useRef(null);
  const workspaceHeaderRef = useRef(null);
  const transactionsHeadingRef = useRef(null);
  const topTransactionPagerRef = useRef(null);
  const backupInputRef = useRef(null);
  const pdfPasswordResolver = useRef(null);
  const unavailable =
    loadingFile ||
    Boolean(importPreview) ||
    vaultBusy ||
    rateBusy ||
    vaultLocked ||
    !vaultReady;
  const idleLockActive = hasVault && vaultReady && !vaultLocked && !isDemo;
  const idleLockBlocked =
    dirty ||
    campaignEditing ||
    rateEditing ||
    showPasswordModal ||
    showChangePassword ||
    Boolean(reviewId) ||
    batchReviewOpen ||
    Boolean(pdfPasswordRequest) ||
    Boolean(importPreview) ||
    loadingFile ||
    vaultBusy ||
    rateBusy;

  useLayoutEffect(() => {
    const header = workspaceHeaderRef.current;
    if (!header) return;
    const workspace = header.parentElement;
    const measureHeader = () => {
      workspace.style.setProperty(
        '--workspace-header-height',
        `${header.getBoundingClientRect().height}px`,
      );
    };
    measureHeader();
    const observer = new ResizeObserver(measureHeader);
    observer.observe(header, { box: 'border-box' });
    return () => observer.disconnect();
  }, []);

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
    () =>
      filterTransactions(
        bankTransactions,
        isDemo ? { ...filters, statementId: '' } : filters,
      ),
    [bankTransactions, filters, isDemo],
  );
  const showPulseEstimates = useMemo(
    () => bankTransactions.some(isPulseTransaction),
    [bankTransactions],
  );
  const pageCount = showPulseEstimates
    ? Math.max(1, Math.ceil(filteredList.length / TRANSACTION_PAGE_SIZE))
    : 1;
  const currentPage = Math.min(page, pageCount - 1);
  const visibleTransactions = showPulseEstimates
    ? filteredList.slice(
        currentPage * TRANSACTION_PAGE_SIZE,
        (currentPage + 1) * TRANSACTION_PAGE_SIZE,
      )
    : filteredList;
  // Changes to the bank or filters reset the list and its selection together.
  useEffect(() => {
    setPage(0);
    setBatchIds(null);
    setBatchReviewOpen(false);
  }, [activeBank, filters, isDemo, vaultLocked, workspaceSession]);
  useEffect(() => {
    setPage((previous) => Math.min(previous, pageCount - 1));
  }, [pageCount]);
  const batchRows = useMemo(
    () =>
      batchIds?.size ? filteredList.filter((tx) => batchIds.has(tx.id)) : [],
    [batchIds, filteredList],
  );
  const toggleBatchRow = (id) =>
    setBatchIds((current) => {
      if (!current || (!current.has(id) && current.size >= MAX_BATCH_REVIEW))
        return current;
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const rewards = useMemo(
    () =>
      calculateRewards(bankTransactions, {
        today,
        hkdCnyRate: rateInfo.rate,
        allocateTransactions: showPulseEstimates,
      }),
    [bankTransactions, rateInfo.rate, showPulseEstimates, today],
  );
  const invalidDateRange = Boolean(
    filters.from && filters.to && filters.from > filters.to,
  );
  const reviewTarget = transactions.find((tx) => tx.id === reviewId);
  const showPulse = activeBank === 'all' || activeBank === 'hsbc';
  const selectBank = (bankId) => {
    if (bankId !== activeBank)
      setFilters((previous) => ({ ...previous, statementId: '' }));
    setActiveBank(bankId);
  };
  const viewStatement = (statement) => {
    if (unavailable || isDemo || busyRef.current) return;
    // Reuse the current scope unless the source lies outside it.
    if (!bankStatements.some(({ id }) => id === statement.id))
      setActiveBank('all');
    setFilters({ ...emptyFilters(), statementId: statement.id });
    const heading = transactionsHeadingRef.current;
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: 'start' });
  };

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
    supplementTargetRef.current = null;
    backupReminder.dismissPending();
    setWorkspaceSession((value) => value + 1);
    setReviewId(null);
    setBatchIds(null);
    setBatchReviewOpen(false);
    setLastBatchReview(null);
    setWorkspace(emptyWorkspace());
    setFilters(emptyFilters());
    setActiveBank('all');
    setDirty(false);
    setMasterPassword('');
    setPasswordError('');
    setShowPasswordModal(false);
    setShowChangePassword(false);
    setPendingBackup(null);
    setImportPreview(null);
    setCampaignEditing(false);
    setRateEditing(false);
    setIsDragging(false);
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
      backupReminder.clear();
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
      (dirty || campaignEditing || rateEditing) &&
      !confirm(t('存在尚未保存的修改，锁定将丢弃这些修改。确认锁定？'))
    )
      return;
    clearMemory();
    setVaultLocked(true);
    setNotice([{ text: '保险库已锁定' }]);
  };
  useIdleLock({
    minutes: preferences.idleLockMinutes,
    active: idleLockActive,
    blocked: idleLockBlocked,
    onLock: () => {
      if (!idleLockActive || idleLockBlocked || busyRef.current) return false;
      clearMemory();
      setVaultLocked(true);
      setNotice([{ text: '已因空闲自动锁定保险库。' }]);
      return true;
    },
  });
  const handleFiles = async (files, supplementId) => {
    if (!files?.length || unavailable || busyRef.current) return;
    const supplement =
      supplementId && statements.find(({ id }) => id === supplementId);
    if (supplementId && !supplement?.skippedTransactionCount) return;
    const selectedBank = supplement?.bankId ?? importBank;
    const selectedCard = supplement?.ruleId ?? importCard;
    const inputFiles = Array.from(files);
    busyRef.current = true;
    setLoadingFile(true);
    const results = [];
    const pendingStatementIds = new Set();
    const existingIds = new Set(workspace.statements.map(({ id }) => id));
    let next = workspace;
    try {
      for (const file of inputFiles) {
        const entry = { fileName: file.name, messages: [] };
        results.push(entry);
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
          if (supplement && fingerprint !== supplement.id)
            throw new Error('文件内容与所选结单不符，请选择原文件。');
          if (!supplement && existingIds.has(fingerprint)) {
            entry.messages.push('已导入，跳过重复文件');
            continue;
          }
          if (pendingStatementIds.has(fingerprint)) {
            entry.messages.push('与本批文件内容相同，已跳过');
            continue;
          }
          let result;
          const sourceName = supplement?.fileName ?? file.name;
          if (isCsv)
            result = parseStandardCsv(await file.text(), sourceName, {
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
                  fileName: sourceName,
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
            entry.messages.push('已取消');
            continue;
          }
          if (!result.transactions.length && !supplement) {
            entry.messages = result.warnings;
            continue;
          }
          const previousCount = next.transactions.length;
          next = normalizeWorkspace(
            supplement
              ? stageStatementSupplement(next, result, fingerprint)
              : mergeStatement(next, result, fingerprint),
          );
          pendingStatementIds.add(fingerprint);
          entry.statementNumber = supplement
            ? statementNumbers.get(fingerprint)
            : next.statements.length;
          entry.statement = next.statements[entry.statementNumber - 1];
          entry.pendingCount = next.transactions.length - previousCount;
        } catch (error) {
          entry.messages.push(error.message);
        }
      }
      if (pendingStatementIds.size) {
        const pendingTransactions = next.transactions.slice(
          workspace.transactions.length,
        );
        const pendingTransactionIds = new Set(
          pendingTransactions.map(({ id }) => id),
        );
        setImportPreview({
          base: workspace,
          next,
          files: results,
          supplementId,
          pendingTransactionIds,
          transactions: pendingTransactions,
          duplicates: findImportDuplicates(next, pendingTransactionIds),
        });
      } else {
        setNotice(
          results.flatMap(({ fileName, messages }) =>
            messages.map((text) => ({ file: fileName, text })),
          ),
        );
      }
    } finally {
      setLoadingFile(false);
      busyRef.current = false;
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };
  const pickSupplementFile = (statement) => {
    if (unavailable || busyRef.current) return;
    const input = supplementInputRef.current;
    if (!input) return;
    supplementTargetRef.current = statement.id;
    input.accept = statement.id.startsWith('csv:') ? '.csv' : '.pdf';
    input.click();
  };
  const confirmImport = (skippedIds) => {
    if (!importPreview || busyRef.current || vaultLocked) return;
    if (workspace !== importPreview.base) {
      setImportPreview(null);
      setNotice([{ text: '工作区已变更，请重新选择文件以核对导入预览。' }]);
      return;
    }
    const next = applyStatementImportSelection(
      importPreview.next,
      importPreview.pendingTransactionIds,
      skippedIds,
    );
    if (next.transactions.length === workspace.transactions.length) return;
    const importedStatements = new Map(
      next.statements.map((statement) => [statement.id, statement]),
    );
    setImportPreview(null);
    setWorkspace(next);
    setDirty(true);
    setIsDemo(false);
    if (importPreview.supplementId) {
      const statement = importedStatements.get(importPreview.supplementId);
      setNotice([
        {
          file: statement.fileName,
          text: '已补录 {count} 笔交易，剩余 {remaining} 笔待补录。',
          values: {
            count: next.transactions.length - workspace.transactions.length,
            remaining: statement.skippedTransactionCount || 0,
          },
        },
      ]);
      return;
    }
    setActiveBank('all');
    setNotice(
      importPreview.files.flatMap(({ fileName, statement, messages }) => {
        if (!statement)
          return messages.map((text) => ({ file: fileName, text }));
        const imported = importedStatements.get(statement.id);
        if (!imported) return [{ file: fileName, text: '全部交易已跳过' }];
        return [
          {
            file: fileName,
            text: imported.skippedTransactionCount
              ? '已导入 {count} 笔交易，跳过 {skipped} 笔'
              : '已导入 {count} 笔交易',
            values: {
              count: imported.transactionCount,
              skipped: imported.skippedTransactionCount,
            },
          },
        ];
      }),
    );
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
        backupReminder.invalidate('restored');
        setWorkspaceSession((value) => value + 1);
        setReviewId(null);
        setLastBatchReview(null);
        supplementTargetRef.current = null;
        setImportPreview(null);
        setWorkspace(data);
        setHasVault(true);
        setVaultLocked(false);
        setDirty(false);
        setIsDemo(false);
        setActiveBank('all');
        setFilters(emptyFilters());
        setNotice([{ text: '已恢复加密备份' }]);
      } else if (passwordMode === 'backup') {
        const exportToken = backupReminder.beginExport();
        // Export remains available after a conflict without rebasing this page.
        if (hasVault)
          await loadFromVault(masterPassword, { checkSnapshot: false });
        const payload = await encryptWorkspace(workspace, masterPassword);
        let reminderCurrent;
        if (globalThis.cardpulseDesktop) {
          if (!(await globalThis.cardpulseDesktop.exportBackup(payload)))
            return;
          reminderCurrent = backupReminder.exported(true, exportToken);
        } else {
          download(
            serializeBackup(payload),
            `CardPulse-${getHongKongDate()}.cardpulse`,
            'application/json',
          );
          reminderCurrent = backupReminder.exported(false, exportToken);
        }
        setNotice([
          {
            text: !reminderCurrent
              ? '已发起备份导出，但提醒状态已变化；请核对文件并重新导出以更新提醒。'
              : globalThis.cardpulseDesktop
                ? '已导出加密备份，未保存的修改仍需保存到加密库'
                : '已发起加密备份下载，请检查文件已保存并在保险库安全中确认。',
          },
        ]);
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
  const handleChangePassword = async (currentPassword, newPassword) => {
    if (unavailable || isDemo || !hasVault || busyRef.current)
      throw new Error('操作失败，请重试');
    busyRef.current = true;
    setVaultBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
      backupReminder.invalidate('passwordChanged');
      setNotice([
        {
          text: '保险库密码已更新，旧备份仍使用原密码。未保存的修改请使用新密码保存。',
        },
      ]);
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
  const restoreReviewedTransaction = () => {
    if (unavailable || isDemo || busyRef.current || !reviewTarget) return;
    const updated = restoreImportedReview(workspace, reviewTarget.id);
    if (updated !== workspace) {
      setWorkspace(updated);
      setDirty(true);
      setNotice([{ text: '已恢复交易的导入状态，请保存到加密库。' }]);
    }
    setReviewId(null);
  };
  const applyBatchReview = (preview) => {
    if (unavailable || isDemo || busyRef.current || workspace !== preview.base)
      throw new Error('工作区已变化，请重新预览');
    const visibleIds = new Set(batchRows.map((tx) => tx.id));
    if (
      visibleIds.size !== preview.ids.length ||
      preview.ids.some((id) => !visibleIds.has(id))
    )
      throw new Error('工作区已变化，请重新预览');
    const applied = reviewTransactions(workspace, preview.ids, preview.patch);
    if (!applied.changes.length) throw new Error('工作区已变化，请重新预览');
    setWorkspace(normalizeWorkspace(applied.workspace));
    setLastBatchReview(applied.changes);
    setDirty(true);
    setBatchReviewOpen(false);
    setBatchIds(null);
    setNotice([
      {
        text: '已修正 {count} 笔交易，请保存到加密库。',
        values: { count: applied.changes.length },
      },
    ]);
  };
  const undoLastBatchReview = () => {
    if (unavailable || isDemo || busyRef.current || !lastBatchReview) return;
    const count = lastBatchReview.length;
    try {
      const updated = undoBatchReview(workspace, lastBatchReview);
      if (
        !confirm(
          t(
            '撤销上次批量修正的 {count} 笔交易？将恢复批次应用前的状态，并保留撤销记录。',
            { count },
          ),
        )
      )
        return;
      setWorkspace(updated);
      setDirty(true);
      setNotice([
        {
          text: '已撤销 {count} 笔批量修正，请保存到加密库。',
          values: { count },
        },
      ]);
    } catch (failure) {
      setNotice([{ text: failure.message }]);
    }
    setLastBatchReview(null);
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
    setFilters((previous) =>
      previous.statementId === statement.id
        ? { ...previous, statementId: '' }
        : previous,
    );
    setReviewId(null);
    setBatchIds(null);
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
      const updated = normalizeWorkspace({
        ...workspace,
        campaigns: next(campaigns),
      });
      setWorkspace(updated);
      setDirty(hasVault || hasWorkspaceData(updated));
    }
  };
  const importCampaignRules = (rules) => {
    if (unavailable || isDemo || busyRef.current)
      throw new Error('操作失败，请重试');
    const added = instantiateCampaignRules(rules, campaigns);
    const next = normalizeWorkspace({
      ...workspace,
      campaigns: [...campaigns, ...added],
    });
    setWorkspace(next);
    setDirty(true);
    setActiveBank('all');
    setNotice([
      {
        text: '已新增 {count} 个活动，请逐个核对资格并保存到加密库。',
        values: { count: added.length },
      },
    ]);
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
    return true;
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
      return info;
    } catch {
      setNotice([{ text: '汇率暂不可用' }]);
    } finally {
      busyRef.current = false;
      setRateBusy(false);
    }
  };

  const isMac = globalThis.cardpulseDesktop?.platform === 'darwin';
  const compactPulseLedger = isMac && showPulseEstimates;
  const macPulsePageRange =
    compactPulseLedger && pageCount > 1
      ? t('第 {start}–{end} 笔，共 {count} 笔', {
          start: currentPage * TRANSACTION_PAGE_SIZE + 1,
          end: currentPage * TRANSACTION_PAGE_SIZE + visibleTransactions.length,
          count: filteredList.length,
        })
      : undefined;
  const changeMacPulsePage = (nextPage, fromFooter = false) => {
    setPage(nextPage);
    const pager = topTransactionPagerRef.current;
    if (fromFooter || nextPage === 0 || nextPage === pageCount - 1)
      pager?.focus({ preventScroll: true });
    if (fromFooter) pager?.scrollIntoView({ block: 'start' });
  };
  const themeLabel = t(isMac ? '配色' : '网站配色');
  const settingsPanels = (
    <>
      <DataSettings
        key={`rate-${workspaceSession}-${vaultLocked}-${isDemo}`}
        rateInfo={rateInfo}
        disabled={unavailable || isDemo}
        rateBusy={rateBusy}
        onApplyRate={applyRate}
        onFetchRate={refreshRate}
        onDraftChange={setRateEditing}
        t={t}
      />
      <VaultSettings
        disabled={unavailable || isDemo}
        hasVault={hasVault}
        onChangePassword={() => setShowChangePassword(true)}
        t={t}
      >
        <IdleLockSettings
          minutes={preferences.idleLockMinutes}
          active={idleLockActive}
          blocked={idleLockBlocked}
          disabled={loadingFile || vaultBusy || rateBusy || !vaultReady}
          onChange={(minutes) =>
            setPreferences((previous) => ({
              ...previous,
              idleLockMinutes: minutes,
            }))
          }
          t={t}
        />
        {!isDemo && !vaultLocked && (hasVault || workspaceHasData) && (
          <BackupReminder
            reminder={backupReminder}
            today={today}
            interval={preferences.backupReminderDays}
            dirty={dirty}
            disabled={unavailable}
            onIntervalChange={(days) =>
              setPreferences((previous) => ({
                ...previous,
                backupReminderDays: days,
              }))
            }
            onExport={() => openPassword('backup')}
            t={t}
          />
        )}
      </VaultSettings>
    </>
  );
  const campaignPanel = (
    <CampaignPanel
      key={`${workspaceSession}-${vaultLocked}-${isDemo}`}
      today={today}
      campaigns={visibleCampaigns}
      transactions={isDemo ? [] : transactions}
      onEditingChange={setCampaignEditing}
      allCampaignNames={campaigns.map((campaign) => campaign.name)}
      onImportRules={importCampaignRules}
      onExportReport={(content) =>
        download(
          content,
          `CardPulse-rewards-${getHongKongDate()}.csv`,
          'text/csv;charset=utf-8',
        )
      }
      onExportRules={(content) =>
        download(
          content,
          `CardPulse-campaigns-${getHongKongDate()}.json`,
          'application/json',
        )
      }
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
  );
  const importPanel = (
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
            if (!unavailable && !busyRef.current) fileInputRef.current?.click();
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
  );
  const exportButton = activeTransactions.length > 0 && (
    <button
      className="btn btn-secondary"
      disabled={invalidDateRange}
      onClick={() =>
        download(
          exportToSafeCsv(filteredList, t, {
            pulseAllocations: rewards.allocations,
          }),
          `CardPulse_${getHongKongDate()}.csv`,
          'text/csv;charset=utf-8;',
        )
      }
    >
      <Download size={14} />
      {t('导出 CSV')}
    </button>
  );
  const resetFilters = (
    <button
      type="button"
      className="btn btn-ghost"
      onClick={() => setFilters(emptyFilters())}
    >
      {t('重置筛选')}
    </button>
  );
  const dateFilters = (
    <div className="date-filter" role="group" aria-label={t('按记账日期筛选')}>
      <label>
        <span>{t('记账起始日期')}</span>
        <input
          type="date"
          aria-label={t('记账起始日期')}
          value={filters.from}
          max={filters.to || undefined}
          aria-invalid={invalidDateRange}
          aria-describedby={invalidDateRange ? 'date-filter-error' : undefined}
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
          aria-describedby={invalidDateRange ? 'date-filter-error' : undefined}
          onChange={(event) =>
            setFilters((prev) => ({ ...prev, to: event.target.value }))
          }
        />
      </label>
      {!isMac && resetFilters}
      <p className="muted small">
        {t('筛选范围适用于交易列表和导出的 CSV。奖赏按银行范围内的记录估算。')}
      </p>
      {invalidDateRange && (
        <p className="error" id="date-filter-error" role="alert">
          {t('起始日期不能晚于结束日期')}
        </p>
      )}
    </div>
  );
  return (
    <div className={isMac ? 'app-container mac-workspace' : 'app-container'}>
      <header className="header" ref={isMac ? workspaceHeaderRef : undefined}>
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
        {isMac && (
          <nav className="workspace-nav" aria-label={t('工作区导航')}>
            <a href="#import-heading">{t('导入结单')}</a>
            <a href="#transactions-heading">{t('交易记录')}</a>
            <a href="#campaign-heading">{t('自定义活动')}</a>
            <a href="#workspace-settings-heading">{t('设置')}</a>
          </nav>
        )}
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
            {themeLabel}
            <select
              aria-label={themeLabel}
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
          <h1>
            {t(isMac ? '交易工作区' : '整理交易，核对结单，管理每一份奖赏。')}
          </h1>
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
          {!isMac && exportButton}
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
              : isMac && isDemo
                ? '正在查看示例数据。'
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
      {!isMac && settingsPanels}
      <BankWorkspace
        selected={activeBank}
        onSelect={selectBank}
        transactions={activeTransactions}
        bankName={bankName}
        t={t}
      />
      {isMac && importPanel}
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
      {!isMac && campaignPanel}
      {!isMac && importPanel}
      {!isDemo && statements.length > 0 && (
        <details className="statement-status">
          <summary>
            <FileText size={16} />
            {t('查看结单与对账')} · {bankStatements.length}
          </summary>
          <input
            type="file"
            hidden
            ref={supplementInputRef}
            aria-label={t('选择原始结单文件')}
            disabled={unavailable}
            onChange={(event) => {
              const statementId = supplementTargetRef.current;
              supplementTargetRef.current = null;
              const files = Array.from(event.target.files);
              event.target.value = '';
              if (statementId) handleFiles(files, statementId);
            }}
          />
          <div aria-label={t('结单与对账结果')}>
            {bankStatements.map((statement) => (
              <div key={statement.id} className="statement-row">
                <strong>{statement.fileName}</strong> ·{' '}
                <span className="badge-tag">
                  {t('结单 {number}', {
                    number: statementNumbers.get(statement.id),
                  })}
                </span>{' '}
                {t('{count} 笔交易', { count: statement.transactionCount })}
                {statement.skippedTransactionCount > 0 && (
                  <p>
                    {t(
                      '导入时跳过 {count} 笔交易。对账基于原文件解析的全部交易。',
                      { count: statement.skippedTransactionCount },
                    )}
                  </p>
                )}
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
                  onClick={() => viewStatement(statement)}
                >
                  {t('查看该结单交易')}
                </button>
                {statement.skippedTransactionCount > 0 && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={unavailable}
                    onClick={() => pickSupplementFile(statement)}
                  >
                    {t('补录跳过的交易')}
                  </button>
                )}
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
      {!isDemo && bankTransactions.length > 0 && (
        <DuplicateTransactions
          key={`duplicates-${workspaceSession}-${vaultLocked}-${activeBank}`}
          transactions={bankTransactions}
          statements={statements}
          disabled={unavailable}
          onReview={setReviewId}
          onViewStatement={viewStatement}
          bankName={bankName}
          t={t}
        />
      )}
      <section
        className="transactions-section"
        aria-labelledby="transactions-heading"
      >
        <div className="section-heading compact">
          <h2
            id="transactions-heading"
            ref={transactionsHeadingRef}
            tabIndex={-1}
          >
            {t('交易记录')}
          </h2>
          <div className="transaction-heading-actions">
            <span className="muted small">
              {t('{count} 笔交易', { count: filteredList.length })}
            </span>
            {isMac && exportButton}
          </div>
        </div>
        {activeTransactions.length > 0 && (
          <div className="filter-bar">
            {!isDemo && bankStatements.length > 0 && (
              <select
                className="statement-filter"
                aria-label={t('结单来源')}
                value={filters.statementId}
                onChange={(event) => {
                  const statementId = event.target.value;
                  setFilters((previous) => ({ ...previous, statementId }));
                }}
              >
                <option value="">{t('全部结单及记录')}</option>
                {bankStatements.map((statement) => (
                  <option key={statement.id} value={statement.id}>
                    {t('结单 {number}', {
                      number: statementNumbers.get(statement.id),
                    })}{' '}
                    · {statement.fileName || t('未知结单')}
                  </option>
                ))}
              </select>
            )}
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
            {isMac ? (
              <>
                {resetFilters}
                <details className="transaction-date-filters">
                  <summary>{t('按记账日期筛选')}</summary>
                  {dateFilters}
                </details>
              </>
            ) : (
              dateFilters
            )}
          </div>
        )}
        {!isDemo && (filteredList.length > 0 || lastBatchReview) && (
          <div className="batch-review-controls">
            {filteredList.length > 0 && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={unavailable}
                onClick={() => setBatchIds(batchIds ? null : new Set())}
              >
                {t(batchIds ? '退出交易选择' : '选择交易')}
              </button>
            )}
            {lastBatchReview && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={unavailable}
                onClick={undoLastBatchReview}
              >
                {t('撤销上次批量修正')}
              </button>
            )}
            {batchIds && (
              <>
                <span className="muted small" aria-live="polite">
                  {t('已选 {count} 笔交易', { count: batchRows.length })} ·{' '}
                  {t('每次最多 {limit} 笔', { limit: MAX_BATCH_REVIEW })}
                </span>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={unavailable || !batchRows.length}
                  onClick={() => setBatchReviewOpen(true)}
                >
                  {t('批量核对交易')}
                </button>
              </>
            )}
          </div>
        )}
        {showPulseEstimates && filteredList.length > 0 && (
          <PulseEstimateMethod compact={isMac} today={today} t={t} />
        )}
        {macPulsePageRange && (
          <TransactionPagination
            page={currentPage}
            pageCount={pageCount}
            range={macPulsePageRange}
            navigationRef={topTransactionPagerRef}
            onPageChange={changeMacPulsePage}
            t={t}
          />
        )}
        {filteredList.length ? (
          <div>
            <div className="table-container">
              <table
                className={compactPulseLedger ? 'mac-pulse-table' : undefined}
              >
                <thead>
                  <tr>
                    {batchIds && <th scope="col">{t('选择')}</th>}
                    {[
                      isMac ? '记账日期' : '日期',
                      ...(compactPulseLedger ? [] : ['银行与卡片']),
                      '商户与描述',
                      ...(compactPulseLedger ? [] : ['渠道']),
                      ...(isMac ? [] : ['币种']),
                      '金额',
                    ].map((label) => (
                      <th
                        key={label}
                        scope="col"
                        className={
                          label === '金额' && compactPulseLedger
                            ? 'transaction-amount-column'
                            : undefined
                        }
                      >
                        {t(label)}
                      </th>
                    ))}
                    {showPulseEstimates &&
                      (isMac ? (
                        <th scope="col" className="pulse-estimate-column">
                          {t('Pulse 返现')}
                        </th>
                      ) : (
                        <>
                          <th scope="col" className="pulse-estimate-column">
                            {t('适用返现比例')}
                          </th>
                          <th scope="col" className="pulse-estimate-column">
                            {t('封顶前返现估算')}
                          </th>
                          <th scope="col" className="pulse-estimate-column">
                            {t('封顶后返现估算')}
                          </th>
                          <th scope="col" className="pulse-estimate-column">
                            {t('退款扣回估算')}
                          </th>
                        </>
                      ))}
                    <th scope="col">{t('操作')}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleTransactions.map((tx) => (
                    <tr key={tx.id}>
                      {batchIds && (
                        <td>
                          <input
                            type="checkbox"
                            aria-label={t('选择交易 {description}', {
                              description: tx.description,
                            })}
                            checked={batchIds.has(tx.id)}
                            disabled={
                              unavailable ||
                              (!batchIds.has(tx.id) &&
                                batchIds.size >= MAX_BATCH_REVIEW)
                            }
                            onChange={() => toggleBatchRow(tx.id)}
                          />
                        </td>
                      )}
                      <td>
                        <strong>{tx.day}</strong>
                        {(!isMac ||
                          (tx.transactionDay &&
                            tx.transactionDay !== tx.day)) && (
                          <small>
                            {t('交易日期')}：{tx.transactionDay || '—'}
                          </small>
                        )}
                      </td>
                      {!compactPulseLedger && (
                        <td>
                          <TransactionCard
                            transaction={tx}
                            bankName={bankName}
                            t={t}
                          />
                        </td>
                      )}
                      <td
                        className={
                          compactPulseLedger ? 'transaction-merchant' : undefined
                        }
                      >
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
                        {compactPulseLedger && (
                          <div className="transaction-meta">
                            <span>
                              <TransactionCard
                                compact
                                transaction={tx}
                                bankName={bankName}
                                t={t}
                              />
                            </span>
                            <TransactionChannel transaction={tx} t={t} />
                          </div>
                        )}
                      </td>
                      {!compactPulseLedger && (
                        <td>
                          <TransactionChannel transaction={tx} t={t} />
                        </td>
                      )}
                      {!isMac && <td>{tx.currency}</td>}
                      <td
                        className={`amount ${compactPulseLedger ? 'transaction-amount-column' : ''} ${tx.direction === 'credit' ? 'text-credit' : ''}`}
                      >
                        {isMac && (
                          <>
                            <span className="transaction-currency">
                              {tx.currency}
                            </span>
                            {' '}
                          </>
                        )}
                        <span className="transaction-value">
                          {tx.direction === 'credit' ? '−' : '+'}
                          {tx.amount}
                        </span>
                      </td>
                      {showPulseEstimates && (
                        <PulseTransactionEstimate
                          transaction={tx}
                          allocation={rewards.allocations.get(tx.id)}
                          compact={isMac}
                          today={today}
                          t={t}
                        />
                      )}
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
            {pageCount > 1 && (
              <TransactionPagination
                page={currentPage}
                pageCount={pageCount}
                footer={compactPulseLedger}
                range={macPulsePageRange}
                onPageChange={
                  compactPulseLedger
                    ? (nextPage) => changeMacPulsePage(nextPage, true)
                    : setPage
                }
                t={t}
              />
            )}
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
      {isMac && (
        <>
          {campaignPanel}
          <section
            className="workspace-settings"
            aria-labelledby="workspace-settings-heading"
          >
            <h2 id="workspace-settings-heading">{t('设置')}</h2>
            <div className="workspace-settings-grid">{settingsPanels}</div>
          </section>
        </>
      )}
      <BuildInfo t={t} />
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
      {showChangePassword && (
        <ChangePasswordDialog
          busy={vaultBusy}
          dirty={dirty}
          t={t}
          onSubmit={handleChangePassword}
          onClose={() => setShowChangePassword(false)}
        />
      )}
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
          onRestoreImported={restoreReviewedTransaction}
          onClose={() => setReviewId(null)}
          t={t}
          locale={preferences.locale}
        />
      )}
      {batchReviewOpen && batchRows.length > 0 && !isDemo && !unavailable && (
        <BatchReviewDialog
          workspace={workspace}
          selected={batchRows}
          today={today}
          onApply={applyBatchReview}
          onClose={() => setBatchReviewOpen(false)}
          bankName={bankName}
          t={t}
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
      {importPreview && (
        <ImportPreviewDialog
          preview={importPreview}
          bankName={bankName}
          t={t}
          onClose={() => setImportPreview(null)}
          onConfirm={confirmImport}
        />
      )}
    </div>
  );
}
function TransactionPagination({
  page,
  pageCount,
  range,
  footer,
  navigationRef,
  onPageChange,
  t,
}) {
  return (
    <nav
      className={
        footer
          ? 'transaction-pagination transaction-pagination-footer'
          : 'transaction-pagination'
      }
      aria-label={t(footer ? '列表底部交易分页' : '交易分页')}
      ref={navigationRef}
      tabIndex={navigationRef ? -1 : undefined}
    >
      <button
        type="button"
        className="btn btn-ghost"
        disabled={page === 0}
        onClick={() => onPageChange(page - 1)}
      >
        {t('上一页')}
      </button>
      <span
        className="transaction-page-status"
        aria-live={footer ? undefined : 'polite'}
        aria-atomic={footer ? undefined : true}
      >
        <span>
          {t('第 {page} / {pages} 页', { page: page + 1, pages: pageCount })}
        </span>
        {range && <span className="transaction-page-range">{range}</span>}
      </span>
      <button
        type="button"
        className="btn btn-ghost"
        disabled={page === pageCount - 1}
        onClick={() => onPageChange(page + 1)}
      >
        {t('下一页')}
      </button>
    </nav>
  );
}
function TransactionCard({ transaction, compact, bankName, t }) {
  const bank = getBank(bankOf(transaction));
  const card =
    compact && isPulseTransaction(transaction)
      ? 'hsbc_pulse'
      : transaction.ruleId;
  return (
    <>
      <span className="bank-dot" style={{ background: bank?.color }} />
      {bankName(bank)}
      {compact && ' · '}
      <small className="transaction-card">
        {t(cardName(card))} ···· {transaction.last4 || t('未知')}
      </small>
    </>
  );
}
function TransactionChannel({ transaction, t }) {
  return (
    <span
      className={`badge-tag ${transaction.channel?.pulse ? 'eligible-channel' : ''}`}
    >
      {t(
        transaction.channel?.uncertain
          ? '待确认渠道'
          : channelText(transaction.channel?.key),
      )}
    </span>
  );
}
function PulseEstimateMethod({ compact, today, t }) {
  const explanation = (
    <p className="muted small pulse-estimate-summary">
      {t(
        'Pulse 逐笔返现按本年度截至 {date} 的交易估算，金额以原币显示。渠道待确认时按识别结果估算。',
        { date: today },
      )}{' '}
      {t(
        '年度和半年额度按记账日期分配，同日沿用工作区顺序。退款按记账顺序扣回本年奖赏，保留已用消费额度。',
      )}
    </p>
  );
  return compact ? (
    <details className="transaction-reward-method">
      <summary>{t('返现计算口径')}</summary>
      {explanation}
    </details>
  ) : (
    explanation
  );
}
function PulseTransactionEstimate({
  transaction,
  allocation,
  compact,
  today,
  t,
}) {
  const excluded =
    !allocation && isPulseTransaction(transaction)
      ? estimatePulseTransaction(transaction, { today })
      : null;
  const refund = transaction.direction === 'credit';
  const components =
    allocation &&
    transaction.currency === 'CNY' &&
    t('基础 {base} · 年度 {annual} · 半年 {halfYear}', {
      base: fromScaledBigInt(allocation.base),
      annual: fromScaledBigInt(allocation.annual),
      halfYear: fromScaledBigInt(allocation.halfYear),
    });
  if (compact) {
    return (
      <td className="pulse-estimate-column transaction-reward">
        {allocation ? (
          <>
            <div className="transaction-reward-result">
              <span className="transaction-reward-label">
                {t(refund ? '退款扣回估算' : '封顶后返现估算')}
              </span>{' '}
              <span className="amount">
                {transaction.currency}{'\u00a0'}
                {fromScaledBigInt(
                  refund ? -allocation.clawback : allocation.cashback,
                )}
              </span>
            </div>
            <span className="transaction-reward-label">
              {t('适用比例')}{' '}
              <strong>{allocation.ratePercent.toFixed(1)}%</strong>
            </span>
            <details>
              <summary>{t('返现明细')}</summary>
              <small>
                {t('封顶前返现估算')} · {transaction.currency}{' '}
                {fromScaledBigInt(allocation.beforeCapCashback)}
              </small>
              {components && <small>{components}</small>}
            </details>
          </>
        ) : (
          <>
            <span className="muted">—</span>
            {excluded?.reason && (
              <small>{t(PULSE_REASONS[excluded.reason])}</small>
            )}
          </>
        )}
      </td>
    );
  }
  return (
    <>
      <td className="pulse-estimate-column">
        {allocation ? `${allocation.ratePercent.toFixed(1)}%` : '—'}
      </td>
      <td className="pulse-estimate-column">
        {allocation ? (
          <span className="amount">
            {transaction.currency}{' '}
            {fromScaledBigInt(allocation.beforeCapCashback)}
          </span>
        ) : (
          '—'
        )}
        {excluded?.reason && <small>{t(PULSE_REASONS[excluded.reason])}</small>}
      </td>
      <td className="pulse-estimate-column">
        {allocation && !refund ? (
          <>
            <span className="amount">
              {transaction.currency} {fromScaledBigInt(allocation.cashback)}
            </span>
            {components && <small>{components}</small>}
          </>
        ) : (
          '—'
        )}
      </td>
      <td className="pulse-estimate-column">
        {allocation && refund ? (
          <>
            <span className="amount">
              {transaction.currency} {fromScaledBigInt(-allocation.clawback)}
            </span>
            {components && <small>{components}</small>}
          </>
        ) : (
          '—'
        )}
      </td>
    </>
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
