import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, stat, access } from 'node:fs/promises';
import { basename, join } from 'node:path';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const candidates = [
  ...['arm64', 'x64'].flatMap((arch) =>
    ['dmg', 'zip'].map((ext) =>
      join('release', 'mac', `CardPulse-${version}-mac-${arch}.${ext}`),
    ),
  ),
  join('release', 'windows', `CardPulse-${version}-win-x64.exe`),
];
const files = [];
for (const original of candidates) {
  const alternatives = [original, join('release', basename(original))];
  let found;
  for (const file of alternatives) {
    try {
      await access(file);
      found = file;
      break;
    } catch {}
  }
  if (!found)
    throw new Error(`Missing desktop artifact: ${basename(original)}`);
  files.push(found);
}
const lines = [];
for (const file of files) {
  if ((await stat(file)).size < 1024 * 1024)
    throw new Error(`Artifact unexpectedly small: ${file}`);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  lines.push(`${hash.digest('hex')}  ${basename(file)}`);
}
await writeFile('release/SHA256SUMS.txt', lines.join('\n') + '\n');
console.log(`Checksums generated for ${files.length} desktop artifacts.`);
