const { app, BrowserWindow, ipcMain, dialog, nativeImage, clipboard, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const pty = require('node-pty');
const { autoUpdater } = require('electron-updater');

// Enable GPU acceleration for WebGL xterm rendering
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

const terminals = new Map();
const terminalCwds = new Map();
const stateFile = path.join(app.getPath('userData'), 'layout-state.json');
const recentFile = path.join(app.getPath('userData'), 'recent-projects.json');
const accountsFile = path.join(app.getPath('userData'), 'accounts.json');
const patchnotesFile = path.join(app.getPath('userData'), 'patchnotes-seen.json');
const notifySettingsFile = path.join(app.getPath('userData'), 'notify-settings.json');
const commandStartTimes = new Map();
const promptSeen = new Map(); // true when PowerShell prompt is visible (OSC 7 received)
const idleTimers = new Map();
const inputBuffers = new Map();   // keystroke buffer per terminal
const commandLabels = new Map();  // captured command/message text per terminal
const IDLE_DETECT_MS = 2000; // 2 seconds idle = response complete (for TUI apps)
let notifySettings = { enabled: true, thresholdSeconds: 10 };

// Load notification settings from disk
function loadNotifySettings() {
  try {
    if (fs.existsSync(notifySettingsFile)) {
      notifySettings = JSON.parse(fs.readFileSync(notifySettingsFile, 'utf8'));
    }
  } catch (e) {
    // ignore read/parse errors
  }
  return notifySettings;
}
loadNotifySettings();

// PowerShell prompt override that emits OSC 7 with current directory
const PROMPT_INJECT = 'function prompt { $p = (Get-Location).Path; "$([char]27)]7;$p$([char]7)PS $p> " }; Set-Alias cc claude\r';

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'HiveCode',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile('renderer/index.html');

  ipcMain.handle('app:version', () => app.getVersion());

  // Window control IPC
  ipcMain.on('win:minimize', () => mainWindow.minimize());
  ipcMain.on('win:maximize', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });
  ipcMain.on('win:close', () => mainWindow.close());

  return mainWindow;
}

// IPC: create a new PowerShell pty
ipcMain.on('terminal:create', (event, { id, cwd, autoRun, apiKey }) => {
  const startDir = cwd || process.env.USERPROFILE || process.cwd();
  const env = { ...process.env, CLAUDECODE: undefined };
  if (apiKey) {
    env.ANTHROPIC_API_KEY = apiKey;
  }
  const ptyProcess = pty.spawn('powershell.exe', [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: startDir,
    env
  });

  terminalCwds.set(id, startDir);

  // Send Windows notification
  function sendNotification(label, cmdStart) {
    const elapsed = (Date.now() - cmdStart) / 1000;
    if (elapsed < notifySettings.thresholdSeconds) return;
    const minutes = Math.floor(elapsed / 60);
    const seconds = Math.floor(elapsed % 60);
    const duration = minutes > 0 ? `${minutes}분 ${seconds}초` : `${seconds}초`;
    const cmdLabel = commandLabels.get(id) || '';
    const body = cmdLabel
      ? `${label}: ${cmdLabel}\n${duration}`
      : `${label} (${duration})`;

    if (Notification.isSupported()) {
      new Notification({
        title: 'HiveCode',
        body,
        icon: path.join(__dirname, 'assets', 'icon.png')
      }).show();
    }
  }

  ptyProcess.onData((data) => {
    // Parse OSC 7 sequence to track CWD: ESC ] 7 ; PATH BEL
    const cwdMatch = data.match(/\x1b\]7;(.+?)\x07/);
    if (cwdMatch) {
      terminalCwds.set(id, cwdMatch[1]);
      promptSeen.set(id, true);

      // Clear any idle timer — prompt-based detection takes over
      if (idleTimers.has(id)) {
        clearTimeout(idleTimers.get(id));
        idleTimers.delete(id);
      }

      // OSC 7 = prompt appeared = previous command completed
      const cmdStart = commandStartTimes.get(id);
      if (cmdStart && notifySettings.enabled) {
        sendNotification('명령 완료', cmdStart);
        commandStartTimes.delete(id);
      }
    } else if (!promptSeen.get(id) && commandStartTimes.get(id) && notifySettings.enabled) {
      // Inside TUI app (e.g. claude) — use idle detection
      if (idleTimers.has(id)) {
        clearTimeout(idleTimers.get(id));
      }
      idleTimers.set(id, setTimeout(() => {
        const cmdStart = commandStartTimes.get(id);
        if (!cmdStart) { idleTimers.delete(id); return; }
        const elapsed = (Date.now() - cmdStart) / 1000;
        if (notifySettings.enabled && elapsed >= notifySettings.thresholdSeconds) {
          sendNotification('응답 완료', cmdStart);
        }
        // 2s idle = response done; always clear to prevent stale false positives
        commandStartTimes.delete(id);
        idleTimers.delete(id);
      }, IDLE_DETECT_MS));
    }

    if (!event.sender.isDestroyed()) {
      event.sender.send(`terminal:data:${id}`, data);
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    terminals.delete(id);
    terminalCwds.delete(id);
    commandStartTimes.delete(id);
    promptSeen.delete(id);
    inputBuffers.delete(id);
    commandLabels.delete(id);
    if (idleTimers.has(id)) {
      clearTimeout(idleTimers.get(id));
      idleTimers.delete(id);
    }
    if (!event.sender.isDestroyed()) {
      event.sender.send(`terminal:exit:${id}`, { exitCode });
    }
  });

  terminals.set(id, ptyProcess);

  // Inject custom prompt that emits OSC 7 with CWD
  ptyProcess.write(PROMPT_INJECT);

  // Auto-run a command after shell is ready
  if (autoRun) {
    setTimeout(() => {
      ptyProcess.write(autoRun + '\r');
    }, 500);
  }
});

// IPC: write data to pty
ipcMain.on('terminal:write', (_event, { id, data }) => {
  const ptyProcess = terminals.get(id);
  if (ptyProcess) {
    if (data.includes('\r')) {
      // Save buffered input as command label
      const buf = (inputBuffers.get(id) || '').trim();
      if (buf) {
        commandLabels.set(id, buf.length > 60 ? buf.substring(0, 60) + '...' : buf);
      }
      inputBuffers.set(id, '');

      if (promptSeen.get(id)) {
        commandStartTimes.set(id, Date.now());
        promptSeen.set(id, false);
      } else {
        commandStartTimes.set(id, Date.now());
      }
    } else if (data === '\x7f' || data === '\b') {
      // Backspace — remove last char from buffer
      const buf = inputBuffers.get(id) || '';
      inputBuffers.set(id, buf.slice(0, -1));
    } else if (data === '\x03') {
      // Ctrl+C — clear buffer
      inputBuffers.set(id, '');
    } else if (!data.startsWith('\x1b')) {
      // Printable character — append to buffer
      inputBuffers.set(id, (inputBuffers.get(id) || '') + data);
    }
    ptyProcess.write(data);
  }
});

// IPC: resize pty
ipcMain.on('terminal:resize', (_event, { id, cols, rows }) => {
  const ptyProcess = terminals.get(id);
  if (ptyProcess) {
    try {
      ptyProcess.resize(cols, rows);
    } catch (e) {
      // ignore resize errors on already-closed pty
    }
  }
});

// IPC: close pty
ipcMain.on('terminal:close', (_event, { id }) => {
  const ptyProcess = terminals.get(id);
  if (ptyProcess) {
    ptyProcess.kill();
    terminals.delete(id);
  }
});

// IPC: open folder picker dialog
ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Select Project Folder'
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// IPC: get all terminal CWDs
ipcMain.handle('terminal:getcwds', () => {
  const cwds = {};
  for (const [id, cwd] of terminalCwds) {
    cwds[id] = cwd;
  }
  return cwds;
});

// IPC: save layout state
ipcMain.on('state:save', (_event, state) => {
  try {
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {
    // ignore write errors
  }
});

// IPC: save recent projects
ipcMain.on('recent:save', (_event, projects) => {
  try {
    fs.writeFileSync(recentFile, JSON.stringify(projects, null, 2), 'utf8');
  } catch (e) {
    // ignore write errors
  }
});

// IPC: load recent projects
ipcMain.handle('recent:load', () => {
  try {
    if (fs.existsSync(recentFile)) {
      return JSON.parse(fs.readFileSync(recentFile, 'utf8'));
    }
  } catch (e) {
    // ignore read/parse errors
  }
  return [];
});

// IPC: save accounts
ipcMain.on('accounts:save', (_event, data) => {
  try {
    fs.writeFileSync(accountsFile, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    // ignore write errors
  }
});

// IPC: load accounts
ipcMain.handle('accounts:load', () => {
  try {
    if (fs.existsSync(accountsFile)) {
      return JSON.parse(fs.readFileSync(accountsFile, 'utf8'));
    }
  } catch (e) {
    // ignore read/parse errors
  }
  return { accounts: [], activeId: null };
});

// IPC: load layout state
ipcMain.handle('state:load', () => {
  try {
    if (fs.existsSync(stateFile)) {
      return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    }
  } catch (e) {
    // ignore read/parse errors
  }
  return null;
});

// IPC: load patch notes (CHANGELOG + version info)
ipcMain.handle('patchnotes:load', () => {
  let changelog = '';
  try {
    const changelogPath = path.join(__dirname, 'CHANGELOG.md');
    if (fs.existsSync(changelogPath)) {
      changelog = fs.readFileSync(changelogPath, 'utf8');
    }
  } catch (e) {
    // ignore read errors
  }

  let seenVersion = null;
  try {
    if (fs.existsSync(patchnotesFile)) {
      const data = JSON.parse(fs.readFileSync(patchnotesFile, 'utf8'));
      seenVersion = data.seenVersion || null;
    }
  } catch (e) {
    // ignore read/parse errors
  }

  return { changelog, currentVersion: app.getVersion(), seenVersion };
});

// IPC: mark patch notes as seen
ipcMain.on('patchnotes:markSeen', (_event, version) => {
  try {
    fs.writeFileSync(patchnotesFile, JSON.stringify({ seenVersion: version }, null, 2), 'utf8');
  } catch (e) {
    // ignore write errors
  }
});

// IPC: save clipboard image to temp file and return path
ipcMain.handle('clipboard:saveImage', async () => {
  const img = clipboard.readImage();
  if (img.isEmpty()) return null;
  const dir = path.join(app.getPath('temp'), 'hivecode-images');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const filePath = path.join(dir, `clipboard-${Date.now()}.png`);
  fs.writeFileSync(filePath, img.toPNG());
  return filePath;
});

// IPC: load notification settings
ipcMain.handle('notify:load-settings', () => {
  return loadNotifySettings();
});

// IPC: save notification settings
ipcMain.on('notify:save-settings', (_event, settings) => {
  notifySettings = settings;
  try {
    fs.writeFileSync(notifySettingsFile, JSON.stringify(settings, null, 2), 'utf8');
  } catch (e) {
    // ignore write errors
  }
});

app.whenReady().then(() => {
  const mainWindow = createWindow();

  // Auto-update (GitHub)
  autoUpdater.autoDownload = false;
  autoUpdater.checkForUpdates().catch((err) => {
    console.error('Update check failed:', err.message);
  });

  autoUpdater.on('update-available', (info) => {
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Available',
      message: `새 버전 ${info.version}이 있습니다. 다운로드하시겠습니까?`,
      buttons: ['다운로드', '나중에']
    }).then(({ response }) => {
      if (response === 0) {
        mainWindow.webContents.send('update:download-started');
        autoUpdater.downloadUpdate();
      }
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    mainWindow.webContents.send('update:download-progress', {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total
    });
  });

  autoUpdater.on('update-downloaded', () => {
    mainWindow.webContents.send('update:downloaded');
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: '업데이트가 다운로드되었습니다. 앱을 재시작하여 적용하시겠습니까?',
      buttons: ['재시작', '나중에']
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
  });

  autoUpdater.on('error', (err) => {
    mainWindow.webContents.send('update:error', err.message);
  });
});

app.on('window-all-closed', () => {
  // Kill all pty processes
  for (const [id, ptyProcess] of terminals) {
    ptyProcess.kill();
  }
  terminals.clear();
  app.quit();
});
