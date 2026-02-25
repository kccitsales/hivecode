class PaneManager {
  constructor(rootElement, splitTree) {
    this.rootElement = rootElement;
    this.splitTree = splitTree;
    this.terminals = new Map(); // terminalId -> { xterm, fitAddon, webglAddon, cleanupData, cleanupExit, element, name }
    this.nodeElements = new Map();
    this.nextTerminalId = 1;
    this.toolbar = null;
    this.activeTerminalId = null;
    this.activeAccount = null; // { id, name, apiKey } or null for default OAuth
    this._saveTimer = null;
    this.chainRules = []; // { id, sourceId, targetId, command, once }
  }

  createTerminal(cwd, autoRun) {
    const id = this.nextTerminalId++;

    const xterm = new Terminal({
      fontSize: 14,
      fontFamily: 'Cascadia Code, Consolas, monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#cccccc',
        cursor: '#ffffff'
      },
      cursorBlink: true,
      rightClickSelectsWord: true,
      allowProposedApi: true
    });

    const fitAddon = new FitAddon.FitAddon();
    xterm.loadAddon(fitAddon);

    // Ctrl+C: copy if text selected, otherwise send interrupt
    // Ctrl+V: paste from clipboard
    xterm.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && e.ctrlKey) {
        if (e.code === 'KeyC' && xterm.hasSelection()) {
          window.terminalAPI.clipboardWrite(xterm.getSelection());
          xterm.clearSelection();
          return false; // prevent sending to shell
        }
        if (e.code === 'KeyV') {
          e.preventDefault();
          if (window.terminalAPI.clipboardHasImage()) {
            window.terminalAPI.clipboardSaveImage().then(filePath => {
              if (filePath) window.terminalAPI.write(id, filePath);
            });
          } else {
            const text = window.terminalAPI.clipboardRead();
            if (text) {
              // Respect bracketed paste mode if active
              if (xterm.modes.bracketedPasteMode) {
                window.terminalAPI.write(id, '\x1b[200~' + text + '\x1b[201~');
              } else {
                window.terminalAPI.write(id, text);
              }
            }
          }
          return false;
        }
      }
      return true;
    });

    // Tell main process to spawn PowerShell (with optional cwd, autoRun, apiKey)
    const apiKey = this.activeAccount ? this.activeAccount.apiKey : undefined;
    window.terminalAPI.create(id, cwd || undefined, autoRun || undefined, apiKey);

    // Bidirectional data flow
    xterm.onData(data => window.terminalAPI.write(id, data));
    const cleanupData = window.terminalAPI.onData(id, data => xterm.write(data));
    const cleanupExit = window.terminalAPI.onExit(id, () => this.handleTerminalExit(id));

    this.terminals.set(id, { xterm, fitAddon, webglAddon: null, cleanupData, cleanupExit, element: null, name: `PowerShell ${id}` });
    return id;
  }

  createTerminalWithName(name, cwd, autoRun) {
    const id = this.createTerminal(cwd, autoRun);
    const termInfo = this.terminals.get(id);
    if (termInfo) termInfo.name = name;
    return id;
  }

  handleTerminalExit(id) {
    this.closePane(id);
  }

  render() {
    this.rootElement.innerHTML = '';
    this.nodeElements.clear();

    if (!this.splitTree.root) return;

    const rootEl = this._renderNode(this.splitTree.root);
    this.rootElement.appendChild(rootEl);

    // Re-open xterm instances into their new DOM containers
    for (const [id, termInfo] of this.terminals) {
      if (termInfo.pendingContainer) {
        xterm_open(termInfo, id, this);
      }
    }

    // Fit all terminals after DOM is stable
    requestAnimationFrame(() => this.fitAll());
  }

  _renderNode(node) {
    if (node.isLeaf()) {
      return this._renderLeaf(node);
    }
    return this._renderSplit(node);
  }

  _renderLeaf(node) {
    const pane = document.createElement('div');
    pane.className = 'terminal-pane';
    pane.style.flex = '1';
    pane.dataset.terminalId = node.terminalId;

    const termInfo = this.terminals.get(node.terminalId);

    // Header bar
    const header = document.createElement('div');
    header.className = 'pane-header';

    const nameLabel = document.createElement('span');
    nameLabel.className = 'pane-name';
    nameLabel.textContent = termInfo ? termInfo.name : `PowerShell ${node.terminalId}`;

    // Double-click to rename
    nameLabel.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      this._startRename(nameLabel, node.terminalId);
    });

    const exportBtn = document.createElement('button');
    exportBtn.className = 'pane-export-btn';
    exportBtn.textContent = '\ud83d\udccb';
    exportBtn.title = 'Export pane (Ctrl+Shift+E)';
    exportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.exportPane(node.terminalId);
    });

    const closeBtn = document.createElement('button');
    closeBtn.className = 'pane-close-btn';
    closeBtn.textContent = '\u00d7';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closePane(node.terminalId);
    });

    header.appendChild(nameLabel);
    header.appendChild(exportBtn);
    header.appendChild(closeBtn);
    pane.appendChild(header);

    // Drop zone overlay
    const dropOverlay = document.createElement('div');
    dropOverlay.className = 'drop-overlay';
    dropOverlay.innerHTML =
      '<div class="drop-zone drop-top"></div>' +
      '<div class="drop-zone drop-bottom"></div>' +
      '<div class="drop-zone drop-left"></div>' +
      '<div class="drop-zone drop-right"></div>' +
      '<div class="drop-zone drop-center"></div>';
    pane.appendChild(dropOverlay);

    // Drag start from header
    header.draggable = true;
    header.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', String(node.terminalId));
      e.dataTransfer.effectAllowed = 'move';
      // Delay adding class so the drag image is captured first
      requestAnimationFrame(() => pane.classList.add('dragging'));
    });
    header.addEventListener('dragend', () => {
      pane.classList.remove('dragging');
      this._clearDropZones();
    });

    // Drag over: detect zone
    pane.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const zone = this._getDropZone(pane, e.clientX, e.clientY);
      this._clearDropZones();
      if (zone) {
        dropOverlay.querySelector(`.drop-${zone}`).classList.add('active');
      }
      dropOverlay.classList.add('visible');
    });
    pane.addEventListener('dragleave', (e) => {
      // Only hide if truly leaving the pane
      if (!pane.contains(e.relatedTarget)) {
        dropOverlay.classList.remove('visible');
        this._clearDropZones();
      }
    });
    pane.addEventListener('drop', (e) => {
      e.preventDefault();
      dropOverlay.classList.remove('visible');
      this._clearDropZones();
      const fromId = parseInt(e.dataTransfer.getData('text/plain'));
      const toId = node.terminalId;
      if (fromId === toId) return;

      const zone = this._getDropZone(pane, e.clientX, e.clientY);
      if (zone === 'center') {
        this.swapPanes(fromId, toId);
      } else if (zone) {
        this.movePaneTo(fromId, toId, zone);
      }
    });

    // Terminal container
    const xtermContainer = document.createElement('div');
    xtermContainer.className = 'xterm-container';
    pane.appendChild(xtermContainer);

    // Focus tracking
    pane.addEventListener('mousedown', () => {
      this.setActiveTerminal(node.terminalId);
    });

    // Mark pending container for xterm.open()
    if (termInfo) {
      termInfo.pendingContainer = xtermContainer;
    }

    this.nodeElements.set(node.id, pane);
    return pane;
  }

  _startRename(labelEl, terminalId) {
    const termInfo = this.terminals.get(terminalId);
    if (!termInfo) return;

    const input = document.createElement('input');
    input.className = 'pane-name-input';
    input.value = termInfo.name;
    input.maxLength = 30;

    const commit = () => {
      const newName = input.value.trim() || termInfo.name;
      termInfo.name = newName;
      labelEl.textContent = newName;
      input.replaceWith(labelEl);
      this.saveState();
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { commit(); }
      if (e.key === 'Escape') {
        labelEl.textContent = termInfo.name;
        input.replaceWith(labelEl);
      }
    });

    labelEl.replaceWith(input);
    input.focus();
    input.select();
  }

  _renderSplit(node) {
    const container = document.createElement('div');
    container.className = `split-container ${node.direction}`;

    const firstChild = this._renderNode(node.children[0]);
    const secondChild = this._renderNode(node.children[1]);

    const percent1 = (node.ratio * 100).toFixed(2);
    const percent2 = ((1 - node.ratio) * 100).toFixed(2);
    firstChild.style.flex = `0 0 calc(${percent1}% - 2px)`;
    secondChild.style.flex = `0 0 calc(${percent2}% - 2px)`;

    const splitter = Splitter.create(node, this);

    container.appendChild(firstChild);
    container.appendChild(splitter);
    container.appendChild(secondChild);

    this.nodeElements.set(node.id, container);
    return container;
  }

  setActiveTerminal(id) {
    // Remove active from previous
    if (this.activeTerminalId !== null) {
      const prevPane = this.rootElement.querySelector(`.terminal-pane[data-terminal-id="${this.activeTerminalId}"]`);
      if (prevPane) prevPane.classList.remove('active');
    }
    this.activeTerminalId = id;

    // Add active to new
    const newPane = this.rootElement.querySelector(`.terminal-pane[data-terminal-id="${id}"]`);
    if (newPane) newPane.classList.add('active');

    // Focus the xterm instance
    const termInfo = this.terminals.get(id);
    if (termInfo && termInfo.xterm) {
      termInfo.xterm.focus();
    }
  }

  fitAll() {
    for (const [id, termInfo] of this.terminals) {
      const { fitAddon, xterm } = termInfo;
      try {
        const prevCols = xterm.cols;
        const prevRows = xterm.rows;
        fitAddon.fit();
        // Only send IPC if size actually changed
        if (xterm.cols !== prevCols || xterm.rows !== prevRows) {
          window.terminalAPI.resize(id, xterm.cols, xterm.rows);
        }
      } catch (e) {
        // ignore fit errors on not-yet-rendered terminals
      }
    }
  }

  _getDropZone(pane, clientX, clientY) {
    const rect = pane.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;

    // Edge zones are the outer 25%
    if (y < 0.25) return 'top';
    if (y > 0.75) return 'bottom';
    if (x < 0.25) return 'left';
    if (x > 0.75) return 'right';
    return 'center';
  }

  _clearDropZones() {
    document.querySelectorAll('.drop-zone.active').forEach(el => el.classList.remove('active'));
  }

  movePaneTo(fromId, toId, zone) {
    const fromLeaf = this.splitTree.findLeaf(fromId);
    const toLeaf = this.splitTree.findLeaf(toId);
    if (!fromLeaf || !toLeaf) return;

    // First, detach the source leaf from its current position
    this.splitTree.remove(fromLeaf);

    // Now split the target leaf in the appropriate direction
    const direction = (zone === 'left' || zone === 'right') ? 'horizontal' : 'vertical';

    // Re-find the target leaf (tree may have changed after remove)
    const target = this.splitTree.findLeaf(toId);
    if (!target) return;

    // Create an internal node replacing the target
    const internal = new SplitNode();
    internal.direction = direction;
    internal.ratio = 0.5;
    internal.parent = target.parent;

    // Reattach the source leaf
    fromLeaf.parent = internal;
    target.parent = internal;

    // Order depends on zone: top/left = source first, bottom/right = source second
    if (zone === 'top' || zone === 'left') {
      internal.children = [fromLeaf, target];
    } else {
      internal.children = [target, fromLeaf];
    }

    // Replace target in the tree
    if (target === this.splitTree.root) {
      this.splitTree.root = internal;
    } else {
      const parent = internal.parent;
      const idx = parent.children.indexOf(target);
      parent.children[idx] = internal;
    }

    this.render();
    this.setActiveTerminal(fromId);
    this.saveState();
  }

  swapPanes(fromId, toId) {
    const leafA = this.splitTree.findLeaf(fromId);
    const leafB = this.splitTree.findLeaf(toId);
    if (!leafA || !leafB) return;

    // Swap terminalIds in the tree nodes
    leafA.terminalId = toId;
    leafB.terminalId = fromId;

    this.render();
    this.setActiveTerminal(fromId);
    this.saveState();
  }

  splitPane(terminalId, direction) {
    const leaf = this.splitTree.findLeaf(terminalId);
    if (!leaf) return;

    const newTerminalId = this.createTerminal();
    this.splitTree.split(leaf, direction, newTerminalId);
    this.render();
    this.setActiveTerminal(newTerminalId);
    this.saveState();
  }

  async openProject() {
    const folder = await window.terminalAPI.openFolder();
    if (!folder) return;
    this._openProjectFolder(folder);
  }

  _openProjectFolder(folder) {
    // Use folder name as tab name
    const folderName = folder.split(/[/\\]/).pop();

    if (!this.splitTree.root) {
      const id = this.createTerminalWithName(folderName, folder, 'claude');
      const leaf = this.splitTree.createLeaf(id);
      this.splitTree.root = leaf;
      this.render();
      this.setActiveTerminal(id);
    } else {
      const leaf = this.splitTree.findLeaf(this.activeTerminalId);
      if (!leaf) return;
      const id = this.createTerminalWithName(folderName, folder, 'claude');
      this.splitTree.split(leaf, 'horizontal', id);
      this.render();
      this.setActiveTerminal(id);
    }
    this.saveState();
    this.addRecentProject(folder);
  }

  openRecentProject(folder) {
    this._openProjectFolder(folder);
  }

  setActiveAccount(account) {
    this.activeAccount = account;
    if (this.toolbar) this.toolbar.updateAccountLabel();
  }

  async addRecentProject(folder) {
    let recents = await window.terminalAPI.loadRecentProjects();
    // Remove if already exists, add to front
    recents = recents.filter(p => p.path !== folder);
    recents.unshift({ path: folder, name: folder.split(/[/\\]/).pop(), time: Date.now() });
    // Keep max 10
    if (recents.length > 10) recents = recents.slice(0, 10);
    window.terminalAPI.saveRecentProjects(recents);
  }

  setupChainListener() {
    window.terminalAPI.onCommandComplete(({ id }) => {
      const toExecute = this.chainRules.filter(r => r.sourceId === id);
      toExecute.forEach(rule => {
        // Only execute if target terminal still exists
        if (this.terminals.has(rule.targetId)) {
          window.terminalAPI.write(rule.targetId, rule.command + '\r');
        }
      });
      // Remove one-time rules that fired
      this.chainRules = this.chainRules.filter(r => !(r.sourceId === id && r.once));
    });
  }

  closePane(terminalId) {
    const termInfo = this.terminals.get(terminalId);
    if (!termInfo) return;

    // Cleanup IPC listeners
    termInfo.cleanupData();
    termInfo.cleanupExit();

    // Dispose WebGL addon first, then xterm
    if (termInfo.webglAddon) {
      try { termInfo.webglAddon.dispose(); } catch (e) {}
    }
    termInfo.xterm.dispose();

    // Tell main process to kill pty
    window.terminalAPI.close(terminalId);

    // Remove from map
    this.terminals.delete(terminalId);

    // Clean up chain rules involving this terminal
    this.chainRules = this.chainRules.filter(r => r.sourceId !== terminalId && r.targetId !== terminalId);

    // Update tree
    const leaf = this.splitTree.findLeaf(terminalId);
    if (leaf) {
      this.splitTree.remove(leaf);
    }

    // Re-render or clear
    if (this.splitTree.root) {
      this.render();
      // Set active to first remaining terminal
      const firstId = this.terminals.keys().next().value;
      if (firstId !== undefined) {
        this.setActiveTerminal(firstId);
      }
    } else {
      this.rootElement.innerHTML = '';
      this.activeTerminalId = null;
    }
    this.saveState();
  }

  // --- State serialization (async: fetches CWDs from main process) ---

  async serializeState() {
    if (!this.splitTree.root) return null;
    const cwds = await window.terminalAPI.getCwds();
    return this._serializeNode(this.splitTree.root, cwds);
  }

  _serializeNode(node, cwds) {
    if (node.isLeaf()) {
      const termInfo = this.terminals.get(node.terminalId);
      return {
        type: 'terminal',
        name: termInfo ? termInfo.name : 'PowerShell',
        cwd: cwds[node.terminalId] || null
      };
    }
    return {
      type: 'split',
      direction: node.direction,
      ratio: node.ratio,
      children: [
        this._serializeNode(node.children[0], cwds),
        this._serializeNode(node.children[1], cwds)
      ]
    };
  }

  // --- State restore ---

  restoreState(state) {
    if (!state) return false;
    try {
      this.splitTree.root = this._restoreNode(state, null);
      this.render();
      const firstId = this.terminals.keys().next().value;
      if (firstId !== undefined) this.setActiveTerminal(firstId);
      return true;
    } catch (e) {
      return false;
    }
  }

  _restoreNode(data, parent) {
    if (data.type === 'terminal') {
      const id = this.createTerminalWithName(data.name, data.cwd);
      const leaf = this.splitTree.createLeaf(id);
      leaf.parent = parent;
      return leaf;
    }
    // split node
    const node = new SplitNode();
    node.direction = data.direction;
    node.ratio = data.ratio;
    node.parent = parent;
    node.children = [
      this._restoreNode(data.children[0], node),
      this._restoreNode(data.children[1], node)
    ];
    return node;
  }

  async exportPane(terminalId) {
    const termInfo = this.terminals.get(terminalId);
    if (!termInfo) return;

    const buffer = termInfo.xterm.buffer.active;
    const lines = [];
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i);
      if (line) lines.push(line.translateToString(true));
    }
    const content = lines.join('\n').trimEnd();
    const markdown = `# ${termInfo.name}\n\n\`\`\`\n${content}\n\`\`\`\n`;

    const filePath = await window.terminalAPI.saveFileDialog();
    if (filePath) {
      window.terminalAPI.writeFile(filePath, markdown);
    }
  }

  saveState() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(async () => {
      const state = await this.serializeState();
      window.terminalAPI.saveState(state);
    }, 500);
  }
}

// Helper: open xterm into a DOM container
function xterm_open(termInfo, id, manager) {
  const container = termInfo.pendingContainer;
  if (!container) return;

  if (!termInfo.opened) {
    termInfo.xterm.open(container);
    termInfo.opened = true;
    // Load WebGL addon for GPU-accelerated rendering
    try {
      const webglAddon = new WebglAddon.WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
        termInfo.webglAddon = null;
      });
      termInfo.xterm.loadAddon(webglAddon);
      termInfo.webglAddon = webglAddon;
    } catch (e) {
      // WebGL not available, fall back to canvas renderer
    }
  } else {
    // Re-attach existing xterm element
    if (termInfo.xterm.element) {
      container.appendChild(termInfo.xterm.element);
    }
  }
  termInfo.element = container;
  termInfo.pendingContainer = null;
}

window.PaneManager = PaneManager;
