const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const { EventEmitter } = require('events');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { Readable } = require('stream');
const { URL } = require('url');

const { SerialPort } = require('serialport');
const pkg = require('./package.json');

const WIFI_PROXY_TARGETS = ['http://fpvgate.local', 'http://192.168.4.1'];
const MAX_DEBUG_LOGS = 500;
const SERIAL_COMMAND_TIMEOUT_MS = 5000;
const SERIAL_LONG_COMMAND_TIMEOUT_MS = 180000;
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
const STATIC_MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.mp3', 'audio/mpeg'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.wav', 'audio/wav'],
]);

let mainWindow = null;
let osdWindow = null;
let localServer = null;
let localServerBaseUrl = null;

let serialPort = null;
let serialPortPath = null;
let serialCommandId = 1;
let serialTextBuffer = '';
let serialCommandQueue = Promise.resolve();

const serialPending = new Map();
const serialEvents = new EventEmitter();
const serialSseClients = new Set();
const debugLogs = [];

function getDataDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'data')
    : path.join(__dirname, '..', 'data');
}

function getIconPath() {
  const baseDir = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
  return path.join(baseDir, 'logo', 'WhiteLogo.png');
}

function addDebugLog(message) {
  debugLogs.push({
    timestamp: Date.now(),
    message: String(message),
  });

  while (debugLogs.length > MAX_DEBUG_LOGS) {
    debugLogs.shift();
  }
}

function sanitizePortInfo(port) {
  return {
    path: port.path,
    manufacturer: port.manufacturer || '',
    serialNumber: port.serialNumber || '',
    pnpId: port.pnpId || '',
    vendorId: port.vendorId || '',
    productId: port.productId || '',
    friendlyName: port.friendlyName || '',
  };
}

function looksLikeFpvgatePort(port) {
  const manufacturer = (port.manufacturer || '').toLowerCase();
  const friendlyName = (port.friendlyName || '').toLowerCase();
  const pnpId = (port.pnpId || '').toLowerCase();
  const vendorId = (port.vendorId || '').toLowerCase();

  return (
    manufacturer.includes('espressif') ||
    manufacturer.includes('silicon labs') ||
    manufacturer.includes('wch') ||
    friendlyName.includes('usb') ||
    pnpId.includes('usb') ||
    vendorId === '303a'
  );
}

function copyResponseHeaders(sourceHeaders, response) {
  for (const [key, value] of sourceHeaders.entries()) {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      response.setHeader(key, value);
    }
  }
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
}

function writeSseEvent(response, eventName, payload) {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const lines = String(raw).split(/\r?\n/);
  response.write(`event: ${eventName}\n`);
  for (const line of lines) {
    response.write(`data: ${line}\n`);
  }
  response.write('\n');
}

function broadcastSerialEvent(eventName, payload) {
  serialEvents.emit(eventName, payload);

  for (const client of serialSseClients) {
    try {
      writeSseEvent(client, eventName, payload);
    } catch (error) {
      serialSseClients.delete(client);
    }
  }
}

function notifyRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function isSerialConnected() {
  return Boolean(serialPort && serialPort.isOpen);
}

function rejectPendingSerialCommands(message) {
  for (const pending of serialPending.values()) {
    clearTimeout(pending.timeoutId);
    pending.reject(new Error(message));
  }
  serialPending.clear();
}

function handleSerialLine(line) {
  notifyRenderer('serial-data', line);

  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    addDebugLog(line);
    return;
  }

  if (parsed.event) {
    broadcastSerialEvent(parsed.event, parsed.data);
    return;
  }

  if (parsed.id !== undefined) {
    const pending = serialPending.get(parsed.id);
    if (pending) {
      clearTimeout(pending.timeoutId);
      serialPending.delete(parsed.id);
      pending.resolve(parsed);
    }
  }
}

function processSerialChunk(chunk) {
  serialTextBuffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);

  while (serialTextBuffer.length > 0) {
    const trimmedStart = serialTextBuffer.match(/^\s*/);
    const leadingWhitespaceLength = trimmedStart ? trimmedStart[0].length : 0;
    if (leadingWhitespaceLength > 0) {
      serialTextBuffer = serialTextBuffer.slice(leadingWhitespaceLength);
      continue;
    }

    if (!serialTextBuffer.length) {
      return;
    }

    if (serialTextBuffer[0] !== '{') {
      // Recover from occasional CDC framing noise where a valid JSON payload
      // is prefixed by stray bytes on the same line.
      const jsonStartIndex = serialTextBuffer.indexOf('{"');
      if (jsonStartIndex > 0) {
        const debugPrefix = serialTextBuffer.slice(0, jsonStartIndex).trim();
        if (debugPrefix) {
          addDebugLog(`[serial:prefix] ${debugPrefix}`);
        }
        serialTextBuffer = serialTextBuffer.slice(jsonStartIndex);
        continue;
      }
      const newlineIndex = serialTextBuffer.search(/\r?\n/);
      if (newlineIndex === -1) {
        if (serialTextBuffer.length > 4096) {
          addDebugLog(serialTextBuffer.slice(0, 4096));
          serialTextBuffer = '';
        }
        return;
      }

      const debugLine = serialTextBuffer.slice(0, newlineIndex).trim();
      if (debugLine) {
        handleSerialLine(debugLine);
      }
      const newlineLength =
        serialTextBuffer[newlineIndex] === '\r' && serialTextBuffer[newlineIndex + 1] === '\n'
          ? 2
          : 1;
      serialTextBuffer = serialTextBuffer.slice(newlineIndex + newlineLength);
      serialTextBuffer = serialTextBuffer.slice(newlineIndex + 1);
      continue;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;
    let completeIndex = -1;

    for (let i = 0; i < serialTextBuffer.length; i++) {
      const ch = serialTextBuffer[i];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (ch === '\\') {
        escaped = true;
        continue;
      }

      if (ch === '"') {
        inString = !inString;
        continue;
      }

      if (inString) {
        continue;
      }

      if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          completeIndex = i;
          break;
        }
      }
    }

    if (completeIndex === -1) {
      const newlineIndex = serialTextBuffer.search(/\r?\n/);
      if (newlineIndex !== -1) {
        const maybeCorruptLine = serialTextBuffer.slice(0, newlineIndex).trim();
        if (maybeCorruptLine) {
          handleSerialLine(maybeCorruptLine);
        }
        const newlineLength =
          serialTextBuffer[newlineIndex] === '\r' && serialTextBuffer[newlineIndex + 1] === '\n'
            ? 2
            : 1;
        serialTextBuffer = serialTextBuffer.slice(newlineIndex + newlineLength);
        continue;
      }
      return;
    }

    const jsonLine = serialTextBuffer.slice(0, completeIndex + 1).trim();
    if (jsonLine) {
      handleSerialLine(jsonLine);
    }

    serialTextBuffer = serialTextBuffer.slice(completeIndex + 1);
  }
}

async function listPorts() {
  const ports = await SerialPort.list();
  return ports.map(sanitizePortInfo);
}

async function disconnectSerialPort() {
  if (!serialPort) {
    return;
  }

  const portToClose = serialPort;
  serialPort = null;
  serialPortPath = null;
  serialTextBuffer = '';
  serialCommandQueue = Promise.resolve();

  rejectPendingSerialCommands('Serial port disconnected');

  await new Promise((resolve) => {
    if (!portToClose.isOpen) {
      resolve();
      return;
    }

    portToClose.close(() => resolve());
  });
}

async function connectSerialPort(portPath) {
  if (isSerialConnected() && serialPortPath === portPath) {
    return { success: true };
  }

  if (serialPort) {
    await disconnectSerialPort();
  }

  const port = new SerialPort({
    path: portPath,
    baudRate: 115200,
    autoOpen: false,
  });

  await new Promise((resolve, reject) => {
    port.open((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });

  port.on('error', (error) => {
    addDebugLog(`[serial:error] ${error.message}`);
    notifyRenderer('serial-error', error.message);
  });

  port.on('close', () => {
    serialPort = null;
    serialPortPath = null;
    serialTextBuffer = '';
    serialCommandQueue = Promise.resolve();
    rejectPendingSerialCommands('Serial port disconnected');
    broadcastSerialEvent('disconnect', null);
    notifyRenderer('serial-disconnected');
  });

  port.on('data', (chunk) => {
    processSerialChunk(chunk);
  });

  serialPort = port;
  serialPortPath = portPath;
  serialTextBuffer = '';
  addDebugLog(`[serial] connected to ${portPath}`);

  return { success: true };
}

async function tryAutoConnectSerial() {
  if (isSerialConnected()) {
    return;
  }

  const ports = await listPorts();
  const preferredPort = ports.find(looksLikeFpvgatePort) || ports.find((port) => /^COM\d+$/i.test(port.path));
  if (preferredPort) {
    try {
      await connectSerialPort(preferredPort.path);
    } catch (error) {
      addDebugLog(`[serial] auto-connect failed: ${error.message}`);
    }
  }
}

function getSerialCommandTimeout(rawCommand) {
  switch (rawCommand) {
    case 'selftest':
      return SERIAL_LONG_COMMAND_TIMEOUT_MS;
    case 'session/open':
    case 'config/get':
    case 'config/set':
    case 'rssi/start':
    case 'rssi/stop':
      return 15000;
    default:
      return 8000;
  }
}

async function sendSerialCommand(rawCommand, data = null, timeoutMs = getSerialCommandTimeout(rawCommand)) {
  const runCommand = async () => {
    if (!isSerialConnected()) {
      throw new Error('Serial port not connected');
    }

    const id = serialCommandId++;
    const payload = { cmd: rawCommand, id };
    if (data !== null && data !== undefined) {
      payload.data = data;
    }

    const serialized = JSON.stringify(payload);

    return await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        serialPending.delete(id);
        reject(new Error('Command timeout'));
      }, timeoutMs);

      serialPending.set(id, { resolve, reject, timeoutId });

      serialPort.write(`${serialized}\n`, (error) => {
        if (error) {
          clearTimeout(timeoutId);
          serialPending.delete(id);
          reject(error);
        }
      });
    });
  };

  const queuedCommand = serialCommandQueue
    .catch(() => undefined)
    .then(runCommand);

  serialCommandQueue = queuedCommand.then(
    () => undefined,
    () => undefined
  );

  return await queuedCommand;
}

function getStaticFilePath(pathname) {
  let normalized = pathname === '/' ? '/index.html' : pathname;
  if (normalized === '/handcamOverlay') {
    normalized = '/handcamOverlay.html';
  } else if (normalized === '/vert-OSD') {
    normalized = '/vert-osd.html';
  }
  const requestedPath = path.normalize(path.join(getDataDir(), normalized));
  const dataDir = path.normalize(getDataDir());

  if (!requestedPath.startsWith(dataDir)) {
    return null;
  }

  if (!fs.existsSync(requestedPath) || !fs.statSync(requestedPath).isFile()) {
    return null;
  }

  return requestedPath;
}

function serveStaticFile(filePath, response) {
  const extension = path.extname(filePath).toLowerCase();
  const contentType = STATIC_MIME_TYPES.get(extension) || 'application/octet-stream';

  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': contentType,
  });

  fs.createReadStream(filePath).pipe(response);
}

async function readRequestBody(request) {
  if (request.method === 'GET' || request.method === 'HEAD') {
    return Buffer.alloc(0);
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function parseJsonBody(bodyBuffer) {
  if (!bodyBuffer || bodyBuffer.length === 0) {
    return {};
  }

  try {
    return JSON.parse(bodyBuffer.toString('utf8'));
  } catch (error) {
    return {};
  }
}

async function handleSerialApi(pathname, method, bodyBuffer, response) {
  if (!isSerialConnected()) {
    return false;
  }

  if (pathname === '/events') {
    response.writeHead(200, {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
    });
    response.write(': connected\n\n');
    serialSseClients.add(response);

    const keepAlive = setInterval(() => {
      if (!response.writableEnded) {
        writeSseEvent(response, 'keepalive', 'ping');
      }
    }, 15000);

    const cleanup = () => {
      clearInterval(keepAlive);
      serialSseClients.delete(response);
    };

    response.on('close', cleanup);
    response.on('error', cleanup);
    return true;
  }

  if (pathname === '/api/debuglog') {
    writeJson(response, 200, { logs: debugLogs });
    return true;
  }

  if (pathname === '/version') {
    try {
      const serialResponse = await sendSerialCommand('version');
      const versionText = serialResponse.data && serialResponse.data.version
        ? serialResponse.data.version
        : app.getVersion();
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
      });
      response.end(versionText);
      return true;
    } catch (error) {
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
      });
      response.end(app.getVersion());
      return true;
    }
  }

  const bodyJson = parseJsonBody(bodyBuffer);

  try {
    if (pathname === '/config' && method === 'GET') {
      const serialResponse = await sendSerialCommand('config/get');
      writeJson(response, 200, serialResponse.data || {});
      return true;
    }

    if (pathname === '/config' && method === 'POST') {
      await sendSerialCommand('config/set', bodyJson);
      writeJson(response, 200, { status: 'OK' });
      return true;
    }

    if (pathname === '/timer/start' && method === 'POST') {
      await sendSerialCommand('timer/start');
      writeJson(response, 200, { status: 'OK' });
      return true;
    }

    if (pathname === '/timer/stop' && method === 'POST') {
      await sendSerialCommand('timer/stop');
      writeJson(response, 200, { status: 'OK' });
      return true;
    }

    if (pathname === '/timer/countdown' && method === 'POST') {
      writeJson(response, 200, { status: 'OK' });
      return true;
    }

    if (pathname === '/timer/clearLaps' && method === 'POST') {
      await sendSerialCommand('timer/clearLaps');
      writeJson(response, 200, { status: 'OK' });
      return true;
    }

    if (pathname === '/timer/addLap' && method === 'POST') {
      await sendSerialCommand('timer/addLap', bodyJson);
      writeJson(response, 200, { status: 'OK' });
      return true;
    }

    if (pathname === '/timer/rssiStart' && method === 'POST') {
      await sendSerialCommand('rssi/start');
      writeJson(response, 200, { status: 'OK' });
      return true;
    }

    if (pathname === '/timer/rssiStop' && method === 'POST') {
      await sendSerialCommand('rssi/stop');
      writeJson(response, 200, { status: 'OK' });
      return true;
    }

    if (pathname === '/api/selftest' && method === 'GET') {
      const serialResponse = await sendSerialCommand('selftest');
      writeJson(response, 200, serialResponse.data || {});
      return true;
    }

    if (pathname === '/races' && method === 'GET') {
      const serialResponse = await sendSerialCommand('races/get');
      writeJson(response, 200, serialResponse.data || {});
      return true;
    }

    if (pathname === '/races/save' && method === 'POST') {
      await sendSerialCommand('races/save', bodyJson);
      writeJson(response, 200, { status: 'OK' });
      return true;
    }

    if (pathname === '/races/clear' && method === 'POST') {
      await sendSerialCommand('races/clear');
      writeJson(response, 200, { status: 'OK' });
      return true;
    }

    if (pathname === '/reboot' && method === 'POST') {
      await sendSerialCommand('reboot');
      writeJson(response, 200, { status: 'OK' });
      return true;
    }
  } catch (error) {
    writeJson(response, 502, {
      status: 'ERROR',
      message: error.message,
    });
    return true;
  }

  return false;
}

async function proxyRequest(pathnameWithSearch, method, headers, bodyBuffer, response) {
  const requestHeaders = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (!value || HOP_BY_HOP_HEADERS.has(String(key).toLowerCase()) || String(key).toLowerCase() === 'host') {
      continue;
    }
    requestHeaders.set(key, value);
  }

  let lastError = null;

  for (const target of WIFI_PROXY_TARGETS) {
    try {
      const targetUrl = `${target}${pathnameWithSearch}`;
      const proxiedResponse = await fetch(targetUrl, {
        method,
        headers: requestHeaders,
        body: bodyBuffer.length > 0 ? bodyBuffer : undefined,
      });

      const contentType = proxiedResponse.headers.get('content-type') || '';

      copyResponseHeaders(proxiedResponse.headers, response);
      response.writeHead(proxiedResponse.status, proxiedResponse.statusText || undefined);

      if (contentType.includes('text/event-stream')) {
        const bodyStream = Readable.fromWeb(proxiedResponse.body);
        bodyStream.pipe(response);
      } else {
        const arrayBuffer = await proxiedResponse.arrayBuffer();
        response.end(Buffer.from(arrayBuffer));
      }

      return;
    } catch (error) {
      lastError = error;
    }
  }

  writeJson(response, 502, {
    status: 'ERROR',
    message: lastError ? lastError.message : 'Unable to reach FPVGate over WiFi',
  });
}

async function handleLocalRequest(request, response) {
  const url = new URL(request.url, 'http://127.0.0.1');
  const staticFile = getStaticFilePath(url.pathname);

  if (staticFile) {
    serveStaticFile(staticFile, response);
    return;
  }

  const bodyBuffer = await readRequestBody(request);

  if (await handleSerialApi(url.pathname, request.method, bodyBuffer, response)) {
    return;
  }

  await proxyRequest(`${url.pathname}${url.search}`, request.method, request.headers, bodyBuffer, response);
}

async function createLocalServer() {
  if (localServer) {
    return;
  }

  localServer = http.createServer((request, response) => {
    handleLocalRequest(request, response).catch((error) => {
      writeJson(response, 500, {
        status: 'ERROR',
        message: error.message,
      });
    });
  });

  await new Promise((resolve, reject) => {
    localServer.once('error', reject);
    localServer.listen(0, '127.0.0.1', () => {
      const address = localServer.address();
      localServerBaseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1200,
    minHeight: 760,
    icon: getIconPath(),
    title: 'FPVGate Desktop',
    backgroundColor: '#10161e',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false,
    },
  });

  mainWindow.loadURL(localServerBaseUrl);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  createMenu();
}

function createOSDWindow() {
  if (osdWindow && !osdWindow.isDestroyed()) {
    osdWindow.focus();
    return;
  }

  osdWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    icon: getIconPath(),
    title: 'FPVGate OSD Overlay',
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false,
    },
  });

  osdWindow.loadURL(`${localServerBaseUrl}/osd.html`);
  osdWindow.on('closed', () => {
    osdWindow = null;
  });
}

function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open OSD Overlay',
          accelerator: 'CmdOrCtrl+O',
          click: () => createOSDWindow(),
        },
        {
          label: 'Refresh UI',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.reload();
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: 'Alt+F4',
          click: () => app.quit(),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Fullscreen',
          accelerator: 'F11',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.setFullScreen(!mainWindow.isFullScreen());
            }
          },
        },
        {
          label: 'Toggle DevTools',
          accelerator: 'F12',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.toggleDevTools();
            }
          },
        },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Project Page',
          click: () => shell.openExternal('https://github.com/LouisHitchcock/FPVGate'),
        },
        { type: 'separator' },
        {
          label: 'About',
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: 'About FPVGate Desktop',
              message: `FPVGate Desktop v${app.getVersion()}`,
              detail: `Desktop shell for the FPVGate ${pkg.version} web UI.\n\nLoads the current frontend from the repository data bundle and bridges USB serial plus WiFi access for desktop use.`,
            });
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle('list-ports', async () => {
  try {
    return await listPorts();
  } catch (error) {
    addDebugLog(`[serial] failed to list ports: ${error.message}`);
    return [];
  }
});

ipcMain.handle('connect-serial', async (_event, portPath) => {
  try {
    return await connectSerialPort(portPath);
  } catch (error) {
    addDebugLog(`[serial] connect failed: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('disconnect-serial', async () => {
  try {
    await disconnectSerialPort();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('write-serial', async (_event, rawData) => {
  try {
    if (!isSerialConnected()) {
      throw new Error('Serial port not connected');
    }

    await new Promise((resolve, reject) => {
      serialPort.write(`${rawData}\n`, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('send-serial-command', async (_event, payload) => {
  try {
    const rawCommand = payload && payload.cmd ? payload.cmd : '';
    const data = payload ? payload.data : null;
    const timeoutMs = payload ? payload.timeoutMs : undefined;
    return await sendSerialCommand(rawCommand, data, timeoutMs);
  } catch (error) {
    return {
      status: 'ERROR',
      message: error.message,
    };
  }
});

ipcMain.handle('serial-status', async () => ({
  connected: isSerialConnected(),
  path: serialPortPath,
}));

ipcMain.handle('open-osd', async () => {
  try {
    createOSDWindow();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

app.whenReady().then(async () => {
  await createLocalServer();
  await tryAutoConnectSerial();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', async () => {
  if (localServer) {
    localServer.close();
    localServer = null;
  }

  if (serialPort) {
    await disconnectSerialPort();
  }
});
