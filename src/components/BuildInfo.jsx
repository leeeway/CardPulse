import React, { useState } from 'react';
import { buildInfo, buildReport } from '../core/build-info.js';

export default function BuildInfo({ t }) {
  const [notice, setNotice] = useState('');
  if (!buildInfo) return null;
  const desktop = globalThis.cardpulseDesktop;
  const runtime = desktop
    ? `desktop/${desktop.platform}/${desktop.arch}`
    : 'browser';
  const report = buildReport(buildInfo, runtime);
  return (
    <details className="build-info">
      <summary>
        {t('版本与构建信息')} · v{buildInfo.version}
      </summary>
      <dl>
        {[
          ['应用版本', buildInfo.version],
          ['源码提交', buildInfo.revision || t('未记录')],
          [
            '源码状态',
            t(
              buildInfo.dirty === true
                ? '含未提交修改'
                : buildInfo.dirty === false
                  ? '无未提交修改'
                  : '未知',
            ),
          ],
          ['构建时间（UTC）', buildInfo.builtAt],
          ['运行方式', runtime],
          [
            '构建类型',
            t(buildInfo.mode === 'production' ? '发布构建' : '开发预览'),
          ],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{t(label)}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="muted small">
        {t(
          '同版本号可能包含不同更新，请用提交标识和构建时间辨识；安装包仍以发布页 SHA-256 为准。',
        )}
      </p>
      <p className="muted small">
        {t(
          '复制内容仅含公开构建信息及运行方式，不含交易、卡号、密码、设备名称或本地路径。不会自动发送。',
        )}
      </p>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={async () => {
          try {
            if (desktop?.copyBuildInfo) await desktop.copyBuildInfo();
            else await navigator.clipboard.writeText(report);
            setNotice('构建信息已复制');
          } catch {
            setNotice('复制失败，请选中文本手动复制');
          }
        }}
      >
        {t('复制构建信息')}
      </button>
      <p className="muted small" aria-live="polite">
        {t(notice)}
      </p>
      <label className="field">
        <span>{t('构建信息文本')}</span>
        <textarea
          aria-label={t('构建信息文本')}
          readOnly
          value={report}
          rows={10}
          spellCheck={false}
        />
      </label>
    </details>
  );
}
