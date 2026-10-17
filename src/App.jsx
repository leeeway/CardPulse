import React, { useState, useEffect, useMemo, useRef } from 'react';
import { CreditCard, UploadCloud, ShieldCheck, Lock, Download, Trash2, Eye } from 'lucide-react';

import { DEMO_TRANSACTIONS } from './core/demo.js';
import { calculateRewards, fromScaledBigInt } from './core/rewards.js';
import { filterTransactions, exportToSafeCsv } from './core/transactions.js';
import { fetchHkdCnyRate } from './core/exchange.js';
import { fingerprintFile, mergeStatement } from './core/imports.js';
import { saveToVault, loadFromVault, clearVault, hasEncryptedVault } from './core/storage.js';

export default function App() {
  const [workspace, setWorkspace] = useState({ transactions: [], statements: [] });
  const { transactions, statements } = workspace;
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState('');
  const [isDemo, setIsDemo] = useState(false);
  const [rateInfo, setRateInfo] = useState({ rate: null, date: '正在获取...' });
  const [filters, setFilters] = useState({
    search: '',
    direction: 'all',
    currency: 'all',
    category: 'all'
  });

  // 本地加密保险库状态
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

  // 初始化汇率与检查本地加密库
  useEffect(() => {
    fetchHkdCnyRate().then(info => setRateInfo(info));
    hasEncryptedVault().then(exists => {
      setHasVault(exists);
      setVaultLocked(exists);
      setVaultReady(true);
    }).catch(err => setNotice(`无法访问本地库：${err.message}。请刷新后重试。`));
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warnBeforeLeaving = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [dirty]);

  const activeTransactions = isDemo ? DEMO_TRANSACTIONS : transactions;

  // 返现计算
  const rewards = useMemo(() => {
    return calculateRewards(activeTransactions, {
      hkdCnyRate: rateInfo.rate
    });
  }, [activeTransactions, rateInfo]);

  // 筛选过滤
  const filteredList = useMemo(() => {
    return filterTransactions(activeTransactions, filters);
  }, [activeTransactions, filters]);

  // 切换演示数据
  const toggleDemo = () => {
    setIsDemo(prev => !prev);
  };

  // 导出 CSV
  const handleExportCsv = () => {
    const csvData = exportToSafeCsv(filteredList);
    const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `CardPulse_Export_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openPassword = mode => {
    setMasterPassword('');
    setPasswordError('');
    setPasswordMode(mode);
    setShowPasswordModal(true);
  };

  const closePassword = () => {
    if (busyRef.current) return;
    setMasterPassword('');
    setPasswordError('');
    setShowPasswordModal(false);
  };

  const handleClear = async () => {
    if (busyRef.current || vaultLocked || !vaultReady) return;
    if (isDemo) { setIsDemo(false); return; }
    if (!confirm('确认清空全部交易及浏览器中的加密保险库？此操作不可恢复。')) return;
    busyRef.current = true;
    setVaultBusy(true);
    try {
      await clearVault();
      setWorkspace({ transactions: [], statements: [] });
      setFilters({ search: '', direction: 'all', currency: 'all', category: 'all' });
      setHasVault(false);
      setDirty(false);
      setNotice('已清空交易及本地保险库');
    } catch (err) {
      setNotice(`清空失败：${err.message}`);
    } finally {
      busyRef.current = false;
      setVaultBusy(false);
    }
  };

  const handleLock = () => {
    if (busyRef.current) return;
    if (dirty && !confirm('存在尚未保存的修改，锁定将丢弃这些修改。确认锁定？')) return;
    setWorkspace({ transactions: [], statements: [] });
    setFilters({ search: '', direction: 'all', currency: 'all', category: 'all' });
    setNotice('保险库已锁定');
    setIsDemo(false);
    setDirty(false);
    setMasterPassword('');
    setVaultLocked(true);
  };

  const handleFiles = async files => {
    if (!files?.length || busyRef.current || vaultLocked || !vaultReady) return;
    busyRef.current = true;
    setLoadingFile(true);
    setIsDemo(false);
    const messages = [];
    let next = workspace;
    try {
      const { parsePdfStatement, MAX_FILE_BYTES } = await import('./core/pdf.js');
      for (const file of Array.from(files)) {
        try {
          if (!file.name.toLowerCase().endsWith('.pdf')) throw new Error('仅支持 PDF');
          if (file.size > MAX_FILE_BYTES) throw new Error('文件超过 25 MB 限制');
          const fingerprint = await fingerprintFile(file);
          if (next.statements.some(item => item.id === fingerprint)) {
            messages.push(`${file.name}：已导入，跳过重复文件`);
            continue;
          }
          let result;
          let password;
          while (!result) {
            try {
              result = await parsePdfStatement(file, { password });
            } catch (err) {
              if (err.code !== 'password') throw err;
              password = prompt(`${file.name}：${err.message}。请输入 PDF 密码（仅本地使用，取消则跳过）：`);
              if (password === null) break;
            }
          }
          if (!result) { messages.push(`${file.name}：已取消`); continue; }
          if (!result.transactions.length) {
            messages.push(`${file.name}：${result.warnings.join('；')}`);
            continue;
          }
          next = mergeStatement(next, result, fingerprint);
          setWorkspace({ transactions: next.transactions, statements: next.statements });
          setDirty(true);
          messages.push(`${file.name}：已导入 ${result.transactions.length} 笔交易`);
        } catch (err) {
          messages.push(`${file.name}：解析失败，${err.message}`);
        }
      }
    } catch (err) {
      messages.push(`无法加载解析器：${err.message}`);
    } finally {
      setNotice(messages.join('；'));
      setLoadingFile(false);
      busyRef.current = false;
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handlePasswordSubmit = async () => {
    if (busyRef.current) return;
    if (!masterPassword) { setPasswordError('请输入主密码'); return; }
    busyRef.current = true;
    setVaultBusy(true);
    try {
      if (passwordMode === 'unlock') {
        const data = await loadFromVault(masterPassword);
        if (!data || !Array.isArray(data.transactions)) throw new Error('本地库不存在或格式无效');
        setWorkspace({ transactions: data.transactions, statements: data.statements || [] });
        setIsDemo(false);
        setVaultLocked(false);
        setDirty(false);
      } else {
        // Verify the existing password before replacing an encrypted workspace.
        if (hasVault && !await loadFromVault(masterPassword)) throw new Error('本地库不存在，请刷新后重试');
        await saveToVault(workspace, masterPassword);
        setHasVault(true);
        setVaultLocked(false);
        setDirty(false);
        setNotice('已加密保存到本地保险库');
      }
      setMasterPassword('');
      setShowPasswordModal(false);
      setPasswordError('');
    } catch (err) {
      setPasswordError(err.message || '操作失败，请重试');
    } finally {
      busyRef.current = false;
      setVaultBusy(false);
    }
  };

  return (
    <div className="app-container">
      {/* 顶部导航 */}
      <header className="header">
        <div className="brand-wrapper">
          <div className="brand-logo">
            <CreditCard size={20} />
          </div>
          <div>
            <div className="brand-title">CardPulse</div>
            <div className="brand-subtitle">多币种信用卡电子结单本地解析与返现中枢 · 隐私零上报</div>
          </div>
        </div>

        <div className="header-actions">
          {hasVault && (
            <button 
              className={`btn ${vaultLocked ? 'btn-secondary' : 'btn-ghost'}`}
              disabled={loadingFile || vaultBusy}
              onClick={() => vaultLocked ? openPassword('unlock') : handleLock()}
            >
              <Lock size={14} />
              {vaultLocked ? '解锁本地库' : '锁定保险库'}
            </button>
          )}

          {vaultReady && !vaultLocked && transactions.length > 0 && !isDemo && (
            <button className="btn btn-secondary" disabled={loadingFile || vaultBusy} onClick={() => openPassword('save')}>
              <ShieldCheck size={14} />
              保存到加密库
            </button>
          )}

          <button 
            className={`btn ${isDemo ? 'btn-primary' : 'btn-secondary'}`}
            onClick={toggleDemo}
          >
            <Eye size={14} />
            {isDemo ? '退出演示数据' : '查看示例数据'}
          </button>

          {activeTransactions.length > 0 && (
            <>
              <button className="btn btn-secondary" onClick={handleExportCsv}>
                <Download size={14} />
                导出 CSV
              </button>
              <button className="btn btn-ghost" disabled={loadingFile || vaultBusy || vaultLocked || !vaultReady} onClick={handleClear} title="清空数据">
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      </header>

      <div className="workspace-status" role="status">
        {vaultLocked ? '本地保险库已锁定，请先解锁再导入。' : dirty ? '有未保存的修改，请点击“保存到加密库”。' : '数据仅在本地处理。'}
        {notice && <p>{notice}</p>}
        {rewards.pendingCount > 0 && <p>{rewards.pendingCount} 笔交易需要人工确认渠道或卡种；尚未支持的卡种不计入返现。</p>}
      </div>
      {!isDemo && statements.length > 0 && (
        <section className="statement-status" aria-label="结单与对账结果">
          {statements.map(statement => (
            <div key={statement.id}>
              <strong>{statement.fileName}</strong> · {statement.transactionCount} 笔
              {(statement.reconciliation || []).map(result => (
                <p key={result.currency}>{result.currency}：{result.status === 'matched' ? '对账一致' : result.status === 'mismatch' ? `对账不符，差额 ${result.difference}` : '缺少期初或期末结欠，未验证对账'}</p>
              ))}
              {statement.warnings?.map((warning, index) => <p key={index}>{warning}</p>)}
            </div>
          ))}
        </section>
      )}

      {/* 返现权益核心看板 */}
      <section className="rewards-grid">
        {/* 合计总返现 */}
        <div className="reward-card">
          <div className="reward-card-header">
            <span className="reward-card-title">本年预计总返现</span>
            <span className="reward-badge">Pulse 银联双币</span>
          </div>
          <div className="reward-card-value">
            <small>CNY</small>
            {rewards.totalCny !== null ? fromScaledBigInt(rewards.totalCny) : '—'}
          </div>
          <div className="progress-desc">
            <span>基础 + 赏世界 5x + PULSE 专属</span>
            <span>{rateInfo.rate ? `1 HKD ≈ ${rateInfo.rate} CNY（${rateInfo.date}）` : rateInfo.date}</span>
          </div>
        </div>

        {/* 基础返现 0.4% */}
        <div className="reward-card">
          <div className="reward-card-header">
            <span className="reward-card-title">基础净签账返现</span>
            <span className="reward-badge">0.4% 无上限</span>
          </div>
          <div className="reward-card-value">
            <small>CNY</small>
            {rewards.base.totalCny === null ? '—' : fromScaledBigInt(rewards.base.totalCny)}
          </div>
          <div className="progress-desc">
            <span>人民币与港币净签账合并折算</span>
            <span>折合港币: CNY {rewards.base.hkdConvertedCny === null ? '—' : fromScaledBigInt(rewards.base.hkdConvertedCny)}</span>
          </div>
        </div>

        {/* 赏世界 5x */}
        <div className="reward-card">
          <div className="reward-card-header">
            <span className="reward-card-title">赏世界 5x 奖赏</span>
            <span className="reward-badge">额外 2.0%</span>
          </div>
          <div className="reward-card-value">
            <small>CNY</small>
            {fromScaledBigInt(rewards.world.cashback)}
          </div>
          <div className="progress-bar-bg">
            <div 
              className="progress-bar-fill" 
              style={{ width: `${Math.min(100, rewards.world.progress)}%` }} 
            />
          </div>
          <div className="progress-desc">
            <span>已用额度: CNY {fromScaledBigInt(rewards.world.used)}</span>
            <span>年度封顶: 100,000 元</span>
          </div>
        </div>

        {/* PULSE 专属内地奖赏 */}
        <div className="reward-card">
          <div className="reward-card-header">
            <span className="reward-card-title">PULSE 专属内地奖赏</span>
            <span className="reward-badge">Apple Pay / 银联QR 2.0%</span>
          </div>
          <div className="reward-card-value">
            <small>CNY</small>
            {fromScaledBigInt(rewards.pulse.cashback)}
          </div>
          <div className="progress-bar-bg">
            <div 
              className="progress-bar-fill" 
              style={{ width: `${Math.min(100, rewards.pulse.progress)}%` }} 
            />
          </div>
          <div className="progress-desc">
            <span>{rewards.pulse.label || '当前半年'}额度已用 {rewards.pulse.progress.toFixed(1)}%</span>
            <span>半年度封顶: 80,000 元</span>
          </div>
        </div>
      </section>

      {/* PDF 拖拽上传区域 */}
      <section 
        className={`dropzone ${isDragging ? 'active' : ''}`}
        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={e => {
          e.preventDefault();
          setIsDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        role="button"
        tabIndex={0}
        aria-disabled={loadingFile || vaultBusy || vaultLocked || !vaultReady}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!busyRef.current && !vaultLocked && vaultReady) fileInputRef.current?.click(); } }}
        onClick={() => { if (!busyRef.current && !vaultLocked && vaultReady) fileInputRef.current?.click(); }}
      >
        <input 
          type="file" 
          ref={fileInputRef} 
          style={{ display: 'none' }} 
          accept="application/pdf" 
          multiple
          disabled={loadingFile || vaultBusy || vaultLocked || !vaultReady}
          onChange={e => handleFiles(e.target.files)} 
        />
        <UploadCloud size={32} className="dropzone-icon" />
        <div style={{ fontWeight: 600, marginBottom: 4 }}>
          {loadingFile ? '正在解析电子结单...' : '点击或将 HSBC 信用卡 PDF 结单拖曳至此处'}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          支持多月份批量导入 · 纯前端 Web Worker 本地解析 · 密码文件支持端侧解密 · 零隐私上报
        </div>
      </section>

      {/* 搜索与过滤工具栏 */}
      {activeTransactions.length > 0 && (
        <section className="filter-bar">
          <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
            <input 
              type="text" 
              className="search-input" 
              placeholder="搜索商户名、卡号末四位、备注..." 
              value={filters.search}
              onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
            />
          </div>

          <select 
            className="select-filter"
            value={filters.currency}
            onChange={e => setFilters(f => ({ ...f, currency: e.target.value }))}
          >
            <option value="all">所有币种</option>
            <option value="CNY">人民币 CNY</option>
            <option value="HKD">港币 HKD</option>
          </select>

          <select 
            className="select-filter"
            value={filters.direction}
            onChange={e => setFilters(f => ({ ...f, direction: e.target.value }))}
          >
            <option value="all">所有收支</option>
            <option value="debit">仅看消费支出</option>
            <option value="credit">仅看入账/退款/还款</option>
          </select>

          <select 
            className="select-filter"
            value={filters.category}
            onChange={e => setFilters(f => ({ ...f, category: e.target.value }))}
          >
            <option value="all">所有分类</option>
            <option value="spend">消费</option>
            <option value="repayment">还款</option>
            <option value="credit">退款</option>
            <option value="fee">费用 / 利息</option>
          </select>
        </section>
      )}

      {/* 交易表格 */}
      {filteredList.length > 0 ? (
        <section className="table-container">
          <table>
            <thead>
              <tr>
                <th>日期</th>
                <th>商户与描述</th>
                <th>卡号</th>
                <th>支付渠道与返现比例</th>
                <th>币种</th>
                <th style={{ textAlign: 'right' }}>金额</th>
              </tr>
            </thead>
            <tbody>
              {filteredList.map(tx => (
                <tr key={tx.id}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{tx.day}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      交易: {tx.transactionDay || tx.day}
                    </div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{tx.description}</div>
                    {tx.notes && tx.notes.length > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {tx.notes.join(' · ')}
                      </div>
                    )}
                  </td>
                  <td>···· {tx.last4 || '未知'}</td>
                  <td>
                    <span className={`badge-tag ${
                      tx.channel?.pulse ? (tx.channel?.key === 'applePay' ? 'badge-apple' : 'badge-qr') : 'badge-std'
                    }`}>
                      {tx.channel?.label || '普通消费'}
                    </span>
                  </td>
                  <td>{tx.currency}</td>
                  <td style={{ textAlign: 'right' }}>
                    <span className={tx.direction === 'credit' ? 'text-credit' : 'text-debit'}>
                      {tx.direction === 'credit' ? '-' : '+'}{tx.amount}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : activeTransactions.length > 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          未找到匹配筛选条件的交易记录
        </div>
      ) : null}

      {/* 解锁本地保险库弹窗 */}
      {showPasswordModal && (
        <div className="modal-overlay" onClick={closePassword}>
          <div role="dialog" aria-modal="true" aria-labelledby="vault-title" className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div id="vault-title" className="modal-title">{passwordMode === 'unlock' ? '解锁本地端侧加密库' : '保存到本地加密库'}</div>
              <button className="btn btn-ghost" onClick={closePassword}>✕</button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
              {passwordMode === 'unlock' || hasVault ? '请输入现有主密码。数据仅在浏览器本地加解密。' : '请设置主密码以加密保存。忘记密码后无法找回数据，请妥善保管。'}
            </p>
            <input 
              autoFocus
              aria-label="主密码"
              disabled={vaultBusy}
              type="password" 
              className="search-input" 
              style={{ width: '100%', marginBottom: 12 }} 
              placeholder="输入主密码..." 
              value={masterPassword} 
              onChange={e => setMasterPassword(e.target.value)} 
              onKeyDown={e => e.key === 'Enter' && handlePasswordSubmit()}
            />
            {passwordError && (
              <div style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 12 }}>
                {passwordError}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-ghost" onClick={closePassword}>
                取消
              </button>
              <button className="btn btn-primary" disabled={vaultBusy} onClick={handlePasswordSubmit}>
                {vaultBusy ? '处理中...' : passwordMode === 'unlock' ? '解锁数据' : '加密保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
