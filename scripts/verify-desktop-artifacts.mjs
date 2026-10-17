import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { listPackage, extractFile } from '@electron/asar';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
async function find(paths) {
  for (const path of paths) {
    try {
      await access(path);
      return path;
    } catch {}
  }
  throw new Error(`Missing artifact: ${paths.join(' or ')}`);
}
async function verifyArchive(file) {
  const entries = listPackage(file);
  for (const required of [
    'desktop/main.cjs',
    'desktop/preload.cjs',
    'desktop/vault.cjs',
    'desktop/security.cjs',
    'dist/index.html',
  ])
    assert(entries.includes(`/${required}`), `${file}: missing ${required}`);
  assert(entries.some((value) => /pdf.worker.*\.mjs$/.test(value)));
  assert(entries.some((value) => value.includes('/pdf-assets/cmaps/')));
  assert(
    entries.some((value) => value.includes('/pdf-assets/standard_fonts/')),
  );
  assert.equal(
    JSON.parse(extractFile(file, 'package.json').toString()).version,
    version,
  );
  assert.equal(
    extractFile(file, 'desktop/main.cjs').toString(),
    await readFile('desktop/main.cjs', 'utf8'),
  );
  assert.equal(
    extractFile(file, 'dist/index.html').toString(),
    await readFile('dist/index.html', 'utf8'),
  );
}
function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}
if (process.platform === 'darwin')
  for (const [folder, arch] of [
    ['mac-arm64', 'arm64'],
    ['mac', 'x86_64'],
  ]) {
    const bundle = await find([
      join('release', 'mac', folder, 'CardPulse.app'),
      join('release', folder, 'CardPulse.app'),
    ]);
    assert.equal(
      run('lipo', ['-archs', join(bundle, 'Contents/MacOS/CardPulse')]).trim(),
      arch,
    );
    run('codesign', ['--verify', '--deep', '--strict', bundle]);
    await verifyArchive(join(bundle, 'Contents/Resources/app.asar'));
  }
const windows = await find([
  'release/windows/win-unpacked',
  'release/win-unpacked',
]);
await verifyArchive(join(windows, 'resources/app.asar'));
const exe = await readFile(join(windows, 'CardPulse.exe'));
assert.equal(exe.toString('ascii', 0, 2), 'MZ');
assert.equal(exe.readUInt16LE(exe.readUInt32LE(0x3c) + 4), 0x8664);
if (process.platform === 'darwin')
  for (const arch of ['arm64', 'x64']) {
    for (const ext of ['dmg', 'zip']) {
      const file = await find([
        `release/mac/CardPulse-${version}-mac-${arch}.${ext}`,
        `release/CardPulse-${version}-mac-${arch}.${ext}`,
      ]);
      if (ext === 'dmg') run('hdiutil', ['verify', file]);
      else run('unzip', ['-t', file]);
    }
  }
console.log(
  'PASS: both Mac architectures and signatures, DMG/ZIP integrity, Windows x64 executable, bundled PDF assets, and source-matching application archives.',
);
