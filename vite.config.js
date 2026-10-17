import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// 将 PDF.js 静态字体、CMap 与 WASM 随站点本地分发，解析时零第三方 CDN 依赖
const require = createRequire(import.meta.url);
try {
  const pdfRoot = dirname(require.resolve('pdfjs-dist/package.json'));
  const version = JSON.parse(readFileSync(join(pdfRoot, 'package.json'), 'utf8')).version;
  const output = join(import.meta.dirname, 'public', 'pdf-assets');
  const stamp = join(output, '.version');
  if (!existsSync(stamp) || readFileSync(stamp, 'utf8') !== version) {
    mkdirSync(output, { recursive: true });
    for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
      const srcDir = join(pdfRoot, directory);
      if (existsSync(srcDir)) {
        cpSync(srcDir, join(output, directory), { recursive: true });
      }
    }
    writeFileSync(stamp, version);
  }
  const licenseSrc = join(pdfRoot, 'LICENSE');
  if (existsSync(licenseSrc)) {
    cpSync(licenseSrc, join(output, 'LICENSE'));
  }
} catch {
  // 依赖未安装时静默跳过
}

export default defineConfig({
  plugins: [react()],
  esbuild: { jsx: 'automatic' }
});
