import { it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateCampaign } from '../src/core/campaigns.js';
import { exportCampaignReport } from '../src/core/campaign-report.js';
import { escapeCsvCell } from '../src/core/safe-csv.js';
import { translate } from '../src/core/i18n.js';
const campaign = {
  name: '=SECRET,"NAME"',
  bankId: 'bochk',
  currency: 'HKD',
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  period: 'statement',
  statementDay: '25',
  dateBasis: 'posting',
  channel: 'any',
  ratePercent: '5',
  rewardCap: '7',
  spendingCap: '',
  minSpend: '',
  registrationConfirmed: true,
  last4: '1234',
};
const tx = (amount, day, direction = 'debit') => ({
  bankId: 'bochk',
  currency: 'HKD',
  day,
  amount,
  direction,
  category: 'spend',
  last4: '1234',
  description: 'PRIVATE TRANSACTION',
  sources: [{ fileName: 'PRIVATE.pdf' }],
});
it('核对表与封顶退款计算一致，带截止日和周期，投影不含卡号及交易', () => {
  const result = calculateCampaign(
    [tx('200', '2026-01-26'), tx('10', '2026-02-25', 'credit')],
    campaign,
    { today: '2026-03-01' },
  );
  const report = exportCampaignReport(result);
  const lines = report.slice(1).split('\r\n');
  assert.equal(lines.length, 3);
  assert.ok(report.startsWith('\uFEFF'));
  assert.ok(report.includes('2026-01-26 → 2026-02-25'));
  assert.ok(report.includes('2026-03-01'));
  assert.ok(
    lines[1].endsWith(
      '"0.50","6.50","独立估算，不代表银行实际入账；退款不回补额度，不自动合并其他活动。"',
    ),
  );
  assert.ok(lines[2].includes('"活动合计"'));
  assert.ok(report.includes('"\'=SECRET,""NAME"""'));
  for (const secret of [
    '1234',
    'PRIVATE',
    'statementDay',
    'registrationConfirmed',
  ])
    assert.ok(!report.includes(secret));
});
it('未确认和零匹配活动明确导出资格及零合计，不伪造周期', () => {
  for (const registrationConfirmed of [true, false]) {
    const report = exportCampaignReport(
      calculateCampaign(
        [],
        { ...campaign, registrationConfirmed },
        { today: '2026-03-01' },
      ),
      (text) => translate('zh-TW', text),
    );
    assert.equal(report.split('\r\n').length, 2);
    assert.ok(report.includes('活動合計'));
    assert.ok(report.includes('"0.00"'));
    assert.ok(
      report.includes(registrationConfirmed ? '已確認資格' : '未確認資格'),
    );
  }
});
it('CSV 单元格统一防公式、转义引号及换行，空值保持空白', () => {
  for (const value of ['=1', '+1', '-1', '@SUM(A1)', '\t=1', '\r=1'])
    assert.ok(escapeCsvCell(value).startsWith('"\''));
  assert.equal(escapeCsvCell('a,"b"\nc'), '"a,""b""\nc"');
  assert.equal(escapeCsvCell(null), '""');
});
