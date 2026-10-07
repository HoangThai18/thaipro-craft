const { app, BrowserWindow, Menu, dialog, session, shell } = require('electron');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const HOST = '127.0.0.1';
const PREFERRED_PORT = 47635;
const PAGE = 'https://thaipro.store/phan-mem/thaicutcut';

let server = null;
let win = null;
let origin = '';

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

function canListen(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, HOST);
  });
}

async function pickPort() {
  for (let port = PREFERRED_PORT; port < PREFERRED_PORT + 20; port += 1) {
    if (await canListen(port)) return port;
  }
  throw new Error('no free port');
}

function webRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, 'web');
}

function startServer(port) {
  const script = path.join(webRoot(), 'apps', 'web', 'server.js');
  server = spawn(process.execPath, [script], {
    cwd: path.dirname(script),
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
      PORT: String(port),
      HOSTNAME: HOST,
      NEXT_PUBLIC_SITE_URL: `http://${HOST}:${port}`,
      NEXT_PUBLIC_MARBLE_API_URL: 'https://api.marblecms.com',
      DATABASE_URL: 'postgres://thaicutcut:none@127.0.0.1:1/none',
      BETTER_AUTH_SECRET: crypto.randomBytes(24).toString('hex'),
      UPSTASH_REDIS_REST_URL: 'http://127.0.0.1:1',
      UPSTASH_REDIS_REST_TOKEN: 'none',
      MARBLE_WORKSPACE_KEY: 'none',
      FREESOUND_CLIENT_ID: 'none',
      FREESOUND_API_KEY: 'none',
    },
  });
  server.on('exit', () => {
    server = null;
    if (!app.isQuitting) app.quit();
  });
}

function waitUntilReady(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get({ host: HOST, port, path: '/api/health', timeout: 1500 }, (response) => {
        response.resume();
        if (response.statusCode === 200) resolve();
        else retry();
      });
      request.on('error', retry);
      request.on('timeout', () => request.destroy());
    };
    const retry = () => {
      if (Date.now() > deadline) reject(new Error('server did not start'));
      else setTimeout(attempt, 250);
    };
    attempt();
  });
}

function stopServer() {
  if (server) {
    server.removeAllListeners('exit');
    server.kill();
    server = null;
  }
}

function buildMenu() {
  const template = [
    {
      label: 'Tệp',
      submenu: [{ role: 'quit', label: 'Thoát' }],
    },
    {
      label: 'Sửa',
      submenu: [
        { role: 'undo', label: 'Hoàn tác' },
        { role: 'redo', label: 'Làm lại' },
        { type: 'separator' },
        { role: 'cut', label: 'Cắt' },
        { role: 'copy', label: 'Sao chép' },
        { role: 'paste', label: 'Dán' },
        { role: 'selectAll', label: 'Chọn tất cả' },
      ],
    },
    {
      label: 'Xem',
      submenu: [
        { role: 'resetZoom', label: 'Cỡ chữ gốc' },
        { role: 'zoomIn', label: 'Phóng to' },
        { role: 'zoomOut', label: 'Thu nhỏ' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Toàn màn hình' },
      ],
    },
    {
      label: 'Trợ giúp',
      submenu: [
        { label: 'Trang tải về và hướng dẫn', click: () => shell.openExternal(PAGE) },
        { label: 'Mã nguồn của OpenCut (bản gốc)', click: () => shell.openExternal('https://github.com/opencut-app/opencut-classic') },
      ],
    },
  ];
  if (process.platform === 'darwin') {
    template.unshift({ label: app.name, submenu: [{ role: 'about', label: 'Giới thiệu ThaiCutCut' }, { type: 'separator' }, { role: 'hide', label: 'Ẩn' }, { role: 'quit', label: 'Thoát' }] });
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function isLocal(url) {
  return url.startsWith(origin + '/') || url === origin;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    title: 'ThaiCutCut',
    backgroundColor: '#0b0b0b',
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    win = null;
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isLocal(url)) {
      event.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });
  win.loadURL(`${origin}/projects`);
}

app.whenReady().then(async () => {
  try {
    const port = await pickPort();
    origin = `http://${HOST}:${port}`;
    startServer(port);
    await waitUntilReady(port, 60000);
  } catch {
    dialog.showErrorBox('ThaiCutCut', 'Không khởi động được ThaiCutCut. Hãy đóng app rồi mở lại.');
    app.quit();
    return;
  }

  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const allowed = ['fullscreen', 'clipboard-sanitized-write', 'clipboard-read', 'media'];
    callback(allowed.includes(permission) && isLocal(details.requestingUrl || ''));
  });
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  app.isQuitting = true;
  stopServer();
});

app.on('window-all-closed', () => {
  app.quit();
});
