const path = require('node:path');
const APP_URL = 'cardpulse://app/';
const EXTERNAL_HOSTS = new Set([
  'github.com',
  'www.hsbc.com.hk',
  'www.bochk.com',
  'www.cncbinternational.com',
  'www.hangseng.com',
  'www.sc.com',
  'www.citibank.com.hk',
  'www.dbs.com.hk',
]);
function isAppUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'cardpulse:' &&
      url.host === 'app' &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
function resolveAsset(value, root) {
  if (!isAppUrl(value)) return null;
  try {
    const name = decodeURIComponent(new URL(value).pathname);
    if (name.includes('\0') || name.includes('\\')) return null;
    const target = path.resolve(
      root,
      `.${name === '/' ? '/index.html' : name}`,
    );
    const relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return target;
  } catch {
    return null;
  }
}
function isExternalUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === '443') &&
      EXTERNAL_HOSTS.has(url.hostname) &&
      (url.hostname !== 'github.com' ||
        /^\/leeeway\/CardPulse(?:\/|$)/.test(url.pathname))
    );
  } catch {
    return false;
  }
}
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'";
module.exports = { APP_URL, CSP, isAppUrl, resolveAsset, isExternalUrl };
