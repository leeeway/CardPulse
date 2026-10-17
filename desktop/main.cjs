const {
  app,
  BrowserWindow,
  Menu,
  protocol,
  net,
  session,
  ipcMain,
  dialog,
  shell,
} = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  APP_URL,
  CSP,
  isAppUrl,
  resolveAsset,
  isExternalUrl,
} = require('./security.cjs');
const { readVault, writeVault, validatePayload } = require('./vault.cjs');

app.setName('CardPulse');
app.setAppUserModelId('io.cardpulse.desktop');
app.commandLine.appendSwitch('disable-background-networking');
const profileArgument = process.argv.find((value) =>
  value.startsWith('--user-data-dir='),
);
if (profileArgument)
  app.setPath(
    'userData',
    path.resolve(profileArgument.slice('--user-data-dir='.length)),
  );
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'cardpulse',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);
let window;
const dist = path.join(__dirname, '..', 'dist');
const vaultPath = () => path.join(app.getPath('userData'), 'vault.cardpulse');

function registerHandler(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (
      !event.senderFrame ||
      event.senderFrame.parent ||
      !isAppUrl(event.senderFrame.url)
    )
      throw new Error('不允许的应用请求');
    return handler(...args);
  });
}
function registerStorage() {
  registerHandler('vault:read', () => readVault(vaultPath()));
  registerHandler('vault:write', async (payload) => {
    await writeVault(vaultPath(), payload);
    return true;
  });
  registerHandler('vault:clear', async () => {
    await fs.rm(vaultPath(), { force: true });
    return true;
  });
  registerHandler('backup:export', async (payload) => {
    validatePayload(payload);
    const result = await dialog.showSaveDialog(window, {
      title: 'Export encrypted backup / 导出加密备份',
      defaultPath: `CardPulse-${new Date().toISOString().slice(0, 10)}.cardpulse`,
      filters: [
        { name: 'CardPulse encrypted backup', extensions: ['cardpulse'] },
      ],
    });
    if (result.canceled || !result.filePath) return false;
    // Never allow an export to silently overwrite the active application vault.
    if (path.resolve(result.filePath) === path.resolve(vaultPath()))
      throw new Error('请选择其他备份位置');
    await writeVault(result.filePath, payload);
    return true;
  });
  registerHandler('backup:import', async () => {
    const result = await dialog.showOpenDialog(window, {
      title: 'Restore encrypted backup / 恢复加密备份',
      properties: ['openFile'],
      filters: [
        { name: 'CardPulse encrypted backup', extensions: ['cardpulse'] },
      ],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return readVault(result.filePaths[0]);
  });
  registerHandler('rates:fetch', async () => {
    // Only this explicit user action can fetch a fixed public rate endpoint. No vault data is sent.
    const response = await fetch(
      'https://api.frankfurter.dev/v2/rate/HKD/CNY',
      {
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
      },
    );
    if (!response.ok) throw new Error('汇率暂不可用');
    const data = await response.json();
    const rate = Number(data.rate || data.rates?.CNY);
    if (!(rate > 0) || !Number.isFinite(rate)) throw new Error('汇率暂不可用');
    return { rate, date: String(data.date || ''), source: 'Frankfurter' };
  });
}
function openExternal(url) {
  if (isExternalUrl(url)) void shell.openExternal(url).catch(() => {});
}
function createWindow() {
  window = new BrowserWindow({
    width: 1360,
    height: 940,
    minWidth: 840,
    minHeight: 640,
    show: false,
    backgroundColor: '#0c1220',
    title: 'CardPulse',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      openExternal(url);
    }
  });
  window.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(window, {
      type: 'question',
      buttons: ['Keep editing / 继续编辑', 'Discard changes / 放弃修改'],
      defaultId: 0,
      cancelId: 0,
      message: 'Unsaved changes / 存在未保存修改',
      detail:
        'Save to the encrypted vault before closing to keep your changes. / 请先保存到加密库。',
    });
    if (choice === 1) event.preventDefault();
  });
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    window = null;
  });
  void window.loadURL(APP_URL);
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  app
    .whenReady()
    .then(() => {
      session.defaultSession.setPermissionRequestHandler(
        (contents, permission, callback) => callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        const scheme = new URL(details.url).protocol;
        callback({
          cancel:
            !isAppUrl(details.url) &&
            !['file:', 'data:', 'blob:', 'devtools:'].includes(scheme),
        });
      });
      protocol.handle('cardpulse', async (request) => {
        const file = resolveAsset(request.url, dist);
        if (!file || !['GET', 'HEAD'].includes(request.method))
          return new Response('Not found', { status: 404 });
        try {
          const response = await net.fetch(pathToFileURL(file).href);
          const headers = new Headers(response.headers);
          headers.set('Content-Security-Policy', CSP);
          headers.set('X-Content-Type-Options', 'nosniff');
          return new Response(
            request.method === 'HEAD' ? null : response.body,
            { status: response.status, headers },
          );
        } catch {
          return new Response('Not found', { status: 404 });
        }
      });
      registerStorage();
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
          {
            label: 'File',
            submenu: [
              { role: process.platform === 'darwin' ? 'close' : 'quit' },
            ],
          },
          { role: 'editMenu' },
          { role: 'viewMenu' },
          { role: 'windowMenu' },
          {
            role: 'help',
            submenu: [
              {
                label: 'CardPulse on GitHub',
                click: () =>
                  openExternal('https://github.com/leeeway/CardPulse'),
              },
            ],
          },
        ]),
      );
      createWindow();
      app.on('activate', () => {
        if (!BrowserWindow.getAllWindows().length) createWindow();
      });
    })
    .catch((error) => {
      console.error('CardPulse could not start:', error.message);
      app.exit(1);
    });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
