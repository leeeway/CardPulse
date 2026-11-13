import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';

/** Only public build identity is emitted; git output paths and filenames stay in this process. */
export function createBuildInfo({
  root,
  version,
  mode,
  now = new Date(),
  git = (args) =>
    execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }),
}) {
  let revision = null;
  let dirty = null;
  try {
    const top = git(['rev-parse', '--show-toplevel']).trim();
    if (realpathSync(top) === realpathSync(root)) {
      const candidate = git(['rev-parse', 'HEAD']).trim();
      if (/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(candidate)) {
        revision = candidate;
        try {
          dirty = Boolean(
            git(['status', '--porcelain', '--untracked-files=normal']).trim(),
          );
        } catch {
          dirty = null;
        }
      }
    }
  } catch {
    /* Source archives and machines without Git remain buildable. */
  }
  return {
    format: 'CardPulseBuild',
    schemaVersion: 1,
    version,
    revision,
    dirty,
    builtAt: now.toISOString(),
    mode,
  };
}
