import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  CreditCard, 
  UploadCloud, 
  ShieldCheck, 
  Lock, 
  Unlock, 
  Download, 
  RefreshCw, 
  Trash2, 
  Eye, 
  Search, 
  Filter, 
  Gift, 
  CheckCircle2, 
  AlertTriangle, 
  ChevronRight,
  ExternalLink 
} from 'lucide-react';

import { DEMO_TRANSACTIONS } from './core/demo.js';
import { calculateRewards, fromScaledBigInt } from './core/rewards.js';
import { filterTransactions, exportToSafeCsv } from './core/transactions.js';
import { fetchHkdCnyRate } from './core/exchange.js';
import { saveToVault, loadFromVault, clearVault, hasEncryptedVault } from './core/storage.js';

export default function App() {
  const [transactions, setTransactions] = useState([]);
  const [isDemo, setIsDemo] = useState(false);
  const [rateInfo, setRateInfo] = useState({ rate: 0.93, date: '正在获取...' });
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
  const [masterPassword, setMasterPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);

  const fileInputRef = useRef(null);

  // 初始化汇率与检查本地加密库
  useEffect(() => {
    fetchHkdCnyRate().then(info => setRateInfo(info));
    hasEncryptedVault().then(exists => {
      setHasVault(exists);
      if (exists) {
        setVaultLocked(true);
      }
    });
  }, []);

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

  // 清空数据
  const handleClear = () => {
    if (confirm('确认清空当前界面的全部交易数据吗？')) {
      setTransactions([]);
      setIsDemo(false);
    }
  };

  // 处理文件导入
  const handleFiles = async (files) => {
    if (!files || !files.length) return;
    setLoadingFile(true);
    setIsDemo(false);

    try {
      const { parsePdfStatement } = await import('./core/pdf.js');
      for (const file of files) {
        if (!file.name.toLowerCase().endsWith('.pdf')) continue;
        const result = await parsePdfStatement(file);
        setTransactions(prev => [...prev, ...result.transactions]);
      }
    } catch (err) {
      alert(`解析失败: ${err.message}`);
    } finally {
      setLoadingFile(false);
    }
  };

  // 解密保险库
  const handleUnlockVault = async () => {
    if (!masterPassword) {
      setPasswordError('请输入主密码');
      return;
    }
    try {
      const data = await loadFromVault(masterPassword);
      if (data && data.transactions) {
        setTransactions(data.transactions);
      }
      setVaultLocked(false);
      setShowPasswordModal(false);
      setPasswordError('');
    } catch (err) {
      setPasswordError(err.message || '密码错误');
    }
  };

  // 保存并加密到保险库
  const handleSaveToVault = async () => {
    const pwd = prompt('请输入设置的主密码以加密保存到浏览器本地（零云端上报）：');
    if (!pwd) return;
    await saveToVault({ transactions }, pwd);
    setHasVault(true);
    setVaultLocked(false);
    alert('已成功加密存入本地 IndexedDB！');
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
              onClick={() => setShowPasswordModal(true)}
            >
              {vaultLocked ? <Lock size={14} /> : <Unlock size={14} />}
              {vaultLocked ? '解锁本地库' : '已解锁保险库'}
            </button>
          )}

          {!hasVault && activeTransactions.length > 0 && !isDemo && (
            <button className="btn btn-secondary" onClick={handleSaveToVault}>
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
              <button className="btn btn-ghost" onClick={handleClear} title="清空数据">
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      </header>

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
            <span>1 HKD ≈ {rateInfo.rate} CNY</span>
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
            {fromScaledBigInt(rewards.base.cny)}
          </div>
          <div className="progress-desc">
            <span>人民币与港币净签账合并折算</span>
            <span>折合港币: CNY {fromScaledBigInt(rewards.base.hkdConvertedCny || 0n)}</span>
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
        onClick={() => fileInputRef.current?.click()}
      >
        <input 
          type="file" 
          ref={fileInputRef} 
          style={{ display: 'none' }} 
          accept="application/pdf" 
          multiple 
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
                  <td>···· {tx.last4 || '8812'}</td>
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
        <div className="modal-overlay" onClick={() => setShowPasswordModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">解锁本地端侧加密库</div>
              <button className="btn btn-ghost" onClick={() => setShowPasswordModal(false)}>✕</button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
              您的历史账单数据使用 AES-GCM-256 加密保存在浏览器本地 IndexedDB 中，请输入主密码进行解密：
            </p>
            <input 
              type="password" 
              className="search-input" 
              style={{ width: '100%', marginBottom: 12 }} 
              placeholder="输入主密码..." 
              value={masterPassword} 
              onChange={e => setMasterPassword(e.target.value)} 
              onKeyDown={e => e.key === 'Enter' && handleUnlockVault()}
            />
            {passwordError && (
              <div style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 12 }}>
                {passwordError}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => setShowPasswordModal(false)}>
                取消
              </button>
              <button className="btn btn-primary" onClick={handleUnlockVault}>
                解锁数据
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
