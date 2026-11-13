import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createBuildInfo } from '../scripts/build-info.mjs';
import { buildReport } from '../src/core/build-info.js';

const root = process.cwd();
const revision = 'a'.repeat(40);
const options = {
  root,
  version: '0.2.0',
  mode: 'production',
  now: new Date('2026-11-13T04:00:00Z'),
};
const git =
  (status = '') =>
  (args) =>
    args.includes('--show-toplevel')
      ? root
      : args.includes('HEAD')
        ? revision
        : status;
it('构建身份仅记录版本、提交、日期与状态，不暴露 Git 文件名、路径或环境', () => {
  const info = createBuildInfo({
    ...options,
    git: git(' M SECRET-FINANCIAL-NAME\n?? PRIVATE-PATH'),
  });
  assert.deepEqual(info, {
    format: 'CardPulseBuild',
    schemaVersion: 1,
    version: '0.2.0',
    revision,
    dirty: true,
    builtAt: '2026-11-13T04:00:00.000Z',
    mode: 'production',
  });
  assert.ok(!JSON.stringify(info).includes('SECRET'));
  assert.equal(createBuildInfo({ ...options, git: git() }).dirty, false);
});
it('无 Git、未知提交或外层仓库均明确标为未知，不误记为干净构建', () => {
  for (const execute of [
    () => {
      throw Error('no git');
    },
    () => '/private/tmp',
    (args) => (args.includes('--show-toplevel') ? root : 'not-a-revision'),
  ]) {
    const info = createBuildInfo({ ...options, git: execute });
    assert.equal(info.revision, null);
    assert.equal(info.dirty, null);
  }
  const info = createBuildInfo({
    ...options,
    git: (args) => {
      if (args.includes('--show-toplevel')) return root;
      if (args.includes('HEAD')) return revision;
      throw Error('status unavailable');
    },
  });
  assert.equal(info.revision, revision);
  assert.equal(info.dirty, null);
});
it('复制报告严格投影公开字段，保持跨语言格式稳定', () => {
  const info = createBuildInfo({ ...options, git: git() });
  const report = JSON.parse(
    buildReport(
      {
        ...info,
        transactions: ['SECRET'],
        filePath: '/PRIVATE',
        password: 'SECRET',
      },
      'browser',
    ),
  );
  assert.deepEqual(report, { ...info, runtime: 'browser' });
  assert.ok(!JSON.stringify(report).includes('PRIVATE'));
});
