/**
 * 客户端 PDF 结单读取与几何文本聚类解析模块
 * 结合 PDF.js 进行文字坐标还原，杜绝字符流阅读乱序
 */

import { getDocument, GlobalWorkerOptions, PasswordResponses } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { extractStatementData } from './statement.js';

GlobalWorkerOptions.workerSrc = workerUrl;

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_PAGES = 200;

export async function parsePdfStatement(file, { password, onProgress = () => {}, signal } = {}) {
  signal?.throwIfAborted();
  if (file.size > MAX_FILE_BYTES) throw new Error('文件超过 25 MB 限制');
  const data = new Uint8Array(await file.arrayBuffer());

  signal?.throwIfAborted();
  const assetRoot = `${import.meta.env.BASE_URL || '/'}pdf-assets/`;
  const task = getDocument({
    data,
    password,
    cMapUrl: `${assetRoot}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assetRoot}standard_fonts/`,
    wasmUrl: `${assetRoot}wasm/`,
    isEvalSupported: false,
    useSystemFonts: false
  });

  const abortHandler = () => void task.destroy();
  signal?.addEventListener('abort', abortHandler, { once: true });

  try {
    const doc = await task.promise;
    if (doc.numPages > MAX_PAGES) throw new Error('结单超过 200 页限制');

    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      if (signal?.aborted) throw new DOMException('解析已取消', 'AbortError');
      onProgress(i, doc.numPages);
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();

      pages.push({
        page: i,
        width: viewport.width,
        height: viewport.height,
        items: content.items
          .filter(item => 'str' in item)
          .map(item => ({
            text: item.str,
            x: item.transform[4],
            y: viewport.height - item.transform[5],
            width: item.width
          }))
      });
      page.cleanup();
    }

    return extractStatementData(pages, file.name);
  } catch (err) {
    if (err.name === 'PasswordException') {
      const pErr = new Error(err.code === PasswordResponses.INCORRECT_PASSWORD ? '结单密码错误' : 'PDF 已加密，请输入密码');
      pErr.code = 'password';
      throw pErr;
    }
    throw err;
  } finally {
    signal?.removeEventListener('abort', abortHandler);
    await task.destroy();
  }
}
