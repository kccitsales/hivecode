const { contextBridge, ipcRenderer, clipboard } = require('electron');

contextBridge.exposeInMainWorld('terminalAPI', {
  clipboardRead: () => clipboard.readText(),
  clipboardWrite: (text) => clipboard.writeText(text),
  clipboardHasImage: () => !clipboard.readImage().isEmpty(),
  clipboardSaveImage: () => ipcRenderer.invoke('clipboard:saveImage'),
  create: (id, cwd, autoRun, apiKey) => ipcRenderer.send('terminal:create', { id, cwd, autoRun, apiKey }),
  write: (id, data) => ipcRenderer.send('terminal:write', { id, data }),
  resize: (id, cols, rows) => ipcRenderer.send('terminal:resize', { id, cols, rows }),
  close: (id) => ipcRenderer.send('terminal:close', { id }),
  onData: (id, callback) => {
    const channel = `terminal:data:${id}`;
    const listener = (_event, data) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  onExit: (id, callback) => {
    const channel = `terminal:exit:${id}`;
    const listener = (_event, data) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  saveFileDialog: () => ipcRenderer.invoke('dialog:saveFile'),
  writeFile: (filePath, content) => ipcRenderer.send('file:write', { filePath, content }),
  getCwds: () => ipcRenderer.invoke('terminal:getcwds'),
  saveState: (state) => ipcRenderer.send('state:save', state),
  loadState: () => ipcRenderer.invoke('state:load'),
  saveRecentProjects: (projects) => ipcRenderer.send('recent:save', projects),
  loadRecentProjects: () => ipcRenderer.invoke('recent:load'),
  saveAccounts: (data) => ipcRenderer.send('accounts:save', data),
  loadAccounts: () => ipcRenderer.invoke('accounts:load'),
  getVersion: () => ipcRenderer.invoke('app:version'),
  winMinimize: () => ipcRenderer.send('win:minimize'),
  winMaximize: () => ipcRenderer.send('win:maximize'),
  winClose: () => ipcRenderer.send('win:close'),
  loadPatchNotes: () => ipcRenderer.invoke('patchnotes:load'),
  markPatchNotesSeen: (version) => ipcRenderer.send('patchnotes:markSeen', version),
  onUpdateDownloadStarted: (callback) => ipcRenderer.on('update:download-started', () => callback()),
  onUpdateProgress: (callback) => ipcRenderer.on('update:download-progress', (_event, data) => callback(data)),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update:downloaded', () => callback()),
  onUpdateError: (callback) => ipcRenderer.on('update:error', (_event, message) => callback(message)),
  loadNotifySettings: () => ipcRenderer.invoke('notify:load-settings'),
  saveNotifySettings: (settings) => ipcRenderer.send('notify:save-settings', settings),
  onCommandComplete: (callback) => ipcRenderer.on('notify:command-complete', (_event, data) => callback(data))
});
