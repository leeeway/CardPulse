import React, { useCallback } from 'react';
import {
  explainPulseTransactions,
  PULSE_REASONS,
  fromScaledBigInt,
} from '../core/rewards.js';
import TransactionExplanations from './TransactionExplanations.jsx';

export default function PulseBreakdown({ result, transactions, rate, t }) {
  const getEntries = useCallback(
    () => explainPulseTransactions(transactions, { today: result.today }),
    [transactions, result.today],
  );
  const money = (value, currency = 'CNY') =>
    value === null ? t('待折算') : `${currency} ${fromScaledBigInt(value)}`;
  const net = (gross, refunds) => (gross > refunds ? gross - refunds : 0n);
  return (
    <div className="pulse-breakdown">
      <details className="pulse-calculation-details">
        <summary>{t('Pulse 计算明细')}</summary>
        <p className="muted small">
          {t('估算截止日')}：{result.today} · {t('按记账日期')}
        </p>
        <div className="pulse-calculation-grid">
          <Calculation
            title="人民币基础返现"
            t={t}
            rows={[
              ['匹配消费总额', money(result.base.cnyGross)],
              ['匹配退款总额', money(result.base.cnyRefunds)],
              [
                '退款后净消费',
                money(net(result.base.cnyGross, result.base.cnyRefunds)),
              ],
              ['回赠比例', '0.4%'],
              ['本期预计奖赏', money(result.base.cny)],
            ]}
          />
          <Calculation
            title="港币基础返现"
            t={t}
            rows={[
              ['匹配消费总额', money(result.base.hkdGross, 'HKD')],
              ['匹配退款总额', money(result.base.hkdRefunds, 'HKD')],
              [
                '退款后净消费',
                money(net(result.base.hkdGross, result.base.hkdRefunds), 'HKD'),
              ],
              ['回赠比例', '0.4%'],
              ['本期预计奖赏', money(result.base.hkd, 'HKD')],
              ['参考汇率', rate ? `1 HKD ≈ ${rate} CNY` : t('未设置')],
              ['人民币折算', money(result.base.hkdConvertedCny)],
            ]}
          />
          <Calculation
            title="赏世界年度额外奖赏"
            t={t}
            rows={[
              ['匹配消费总额', money(result.world.gross)],
              ['匹配退款总额', money(result.world.refunds)],
              ['消费上限', money(result.world.cap)],
              ['参与计奖消费', money(result.world.used)],
              ['剩余消费额度', money(result.world.remaining)],
              ['封顶后扣回前奖赏', money(result.world.beforeRefund)],
              ['本期退款扣回', money(result.world.clawback)],
              ['本期预计奖赏', money(result.world.cashback)],
            ]}
          />
          <section className="period-calculation">
            <h4>{t('Pulse 半年额外奖赏')}</h4>
            {result.pulse.periods.map((period) => (
              <div className="pulse-half" key={period.label}>
                <h5>
                  {result.year} · {t(period.label)}
                </h5>
                <dl>
                  {[
                    ['匹配消费总额', money(period.gross)],
                    ['消费上限', money(period.cap)],
                    ['参与计奖消费', money(period.used)],
                    ['剩余消费额度', money(period.remaining)],
                    ['封顶后扣回前奖赏', money(period.beforeRefund)],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt>{t(label)}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
            <dl>
              {[
                ['两半年扣回前合计', money(result.pulse.beforeRefund)],
                ['本年度匹配退款', money(result.pulse.refunds)],
                ['本年度退款扣回', money(result.pulse.clawback)],
                ['本年预计专属奖赏', money(result.pulse.cashback)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{t(label)}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
        <p className="notice-inline">
          {t(
            '当前模型先合并两半年封顶后的奖赏，再按本年度匹配退款扣回；不追溯退款原单，退款不回补额度。',
          )}
        </p>
        <p className="muted small">
          {t(
            '内置规则仅作估算，未确认渠道会保留提醒；显示金额舍入可能产生尾差。',
          )}
        </p>
      </details>
      <TransactionExplanations
        getEntries={getEntries}
        matchedCount={result.includedCount}
        reasonLabels={PULSE_REASONS}
        title="Pulse 逐笔说明"
        t={t}
      />
    </div>
  );
}
function Calculation({ title, rows, t }) {
  return (
    <section className="period-calculation">
      <h4>{t(title)}</h4>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{t(label)}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
