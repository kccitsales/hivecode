class Toolbar {
  constructor(toolbarElement, paneManager) {
    this.element = toolbarElement;
    this.paneManager = paneManager;
    this.render();
  }

  render() {
    this.element.innerHTML = '';

    const addBtn = this._createButton('+ New', () => {
      if (!this.paneManager.splitTree.root) {
        const id = this.paneManager.createTerminal();
        const leaf = this.paneManager.splitTree.createLeaf(id);
        this.paneManager.splitTree.root = leaf;
        this.paneManager.render();
        this.paneManager.setActiveTerminal(id);
      } else if (this.paneManager.activeTerminalId) {
        this.paneManager.splitPane(this.paneManager.activeTerminalId, 'horizontal');
      }
    });

    const projectBtn = this._createButton('+ Project', (e) => {
      this._showProjectMenu(e.target);
    });

    const splitHBtn = this._createButton('Split \u2194', () => {
      if (this.paneManager.activeTerminalId) {
        this.paneManager.splitPane(this.paneManager.activeTerminalId, 'horizontal');
      }
    });

    const splitVBtn = this._createButton('Split \u2195', () => {
      if (this.paneManager.activeTerminalId) {
        this.paneManager.splitPane(this.paneManager.activeTerminalId, 'vertical');
      }
    });

    // Spacer
    const spacer = document.createElement('div');
    spacer.style.flex = '1';

    // App icon + title
    const icon = document.createElement('img');
    icon.className = 'toolbar-icon';
    icon.src = '../assets/icon.svg';

    const title = document.createElement('span');
    title.className = 'toolbar-title';
    title.textContent = 'HiveCode';

    const version = document.createElement('span');
    version.className = 'toolbar-version';
    window.terminalAPI.getVersion().then(v => { version.textContent = `v${v}`; });

    // Account button
    this.accountBtn = this._createButton('\u{1F464} 기본', (e) => this._showAccountMenu(e.target));
    this.accountBtn.className = 'toolbar-account-btn';

    const helpBtn = this._createButton('?', () => this._showHelp());
    helpBtn.className = 'toolbar-help-btn';

    // Window controls
    const winControls = document.createElement('div');
    winControls.className = 'win-controls';

    const minBtn = this._createButton('\u2013', () => window.terminalAPI.winMinimize());
    minBtn.className = 'win-btn';
    const maxBtn = this._createButton('\u25a1', () => window.terminalAPI.winMaximize());
    maxBtn.className = 'win-btn';
    const closeBtn = this._createButton('\u00d7', () => window.terminalAPI.winClose());
    closeBtn.className = 'win-btn win-close';

    winControls.append(minBtn, maxBtn, closeBtn);

    this.element.append(icon, title, version, addBtn, projectBtn, splitHBtn, splitVBtn, spacer, this.accountBtn, helpBtn, winControls);

    // Load saved active account
    this._loadActiveAccount();
  }

  _createButton(text, onClick) {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    return btn;
  }

  async _loadActiveAccount() {
    const data = await window.terminalAPI.loadAccounts();
    if (data.activeId && data.accounts) {
      const acc = data.accounts.find(a => a.id === data.activeId);
      if (acc) {
        this.paneManager.activeAccount = acc;
        this.updateAccountLabel();
      }
    }
  }

  updateAccountLabel() {
    if (!this.accountBtn) return;
    const acc = this.paneManager.activeAccount;
    this.accountBtn.textContent = acc ? '\u{1F464} ' + acc.name : '\u{1F464} 기본';
  }

  async _showAccountMenu(anchorBtn) {
    const existing = document.getElementById('account-menu');
    if (existing) { existing.remove(); return; }

    const data = await window.terminalAPI.loadAccounts();
    const accounts = data.accounts || [];
    const activeId = this.paneManager.activeAccount ? this.paneManager.activeAccount.id : null;

    const menu = document.createElement('div');
    menu.id = 'account-menu';
    menu.className = 'project-menu';

    // Default (OAuth) option
    const defaultItem = document.createElement('div');
    defaultItem.className = 'project-menu-item account-item' + (!activeId ? ' account-active' : '');
    defaultItem.innerHTML = '<span class="account-check">' + (!activeId ? '\u2713' : '') + '</span>' +
      '<span class="project-menu-name">\uae30\ubcf8 (OAuth)</span>';
    defaultItem.addEventListener('click', () => {
      menu.remove();
      this.paneManager.setActiveAccount(null);
      this._saveActiveAccount(null, accounts);
    });
    menu.appendChild(defaultItem);

    if (accounts.length > 0) {
      const sep = document.createElement('div');
      sep.className = 'project-menu-sep';
      menu.appendChild(sep);

      accounts.forEach(acc => {
        const item = document.createElement('div');
        item.className = 'project-menu-item account-item' + (activeId === acc.id ? ' account-active' : '');

        const check = document.createElement('span');
        check.className = 'account-check';
        check.textContent = activeId === acc.id ? '\u2713' : '';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'project-menu-name';
        nameSpan.textContent = acc.name;

        const keyHint = document.createElement('span');
        keyHint.className = 'project-menu-path';
        keyHint.textContent = acc.apiKey ? 'sk-...' + acc.apiKey.slice(-6) : '';

        const delBtn = document.createElement('span');
        delBtn.className = 'account-del-btn';
        delBtn.textContent = '\u00d7';
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          menu.remove();
          this._deleteAccount(acc.id, accounts);
        });

        item.appendChild(check);
        const textWrap = document.createElement('div');
        textWrap.style.flex = '1';
        textWrap.style.overflow = 'hidden';
        textWrap.appendChild(nameSpan);
        textWrap.appendChild(keyHint);
        item.appendChild(textWrap);
        item.appendChild(delBtn);

        item.addEventListener('click', () => {
          menu.remove();
          this.paneManager.setActiveAccount(acc);
          this._saveActiveAccount(acc.id, accounts);
        });
        menu.appendChild(item);
      });
    }

    // Separator + Add account button
    const sep2 = document.createElement('div');
    sep2.className = 'project-menu-sep';
    menu.appendChild(sep2);

    const addItem = document.createElement('div');
    addItem.className = 'project-menu-item project-menu-browse';
    addItem.textContent = '+ \uacc4\uc815 \ucd94\uac00 (API Key)';
    addItem.addEventListener('click', () => {
      menu.remove();
      this._showAddAccountDialog();
    });
    menu.appendChild(addItem);

    // Position below button
    const rect = anchorBtn.getBoundingClientRect();
    menu.style.top = rect.bottom + 2 + 'px';
    menu.style.left = Math.max(0, rect.right - 320) + 'px';

    document.body.appendChild(menu);

    const closeMenu = (e) => {
      if (!menu.contains(e.target) && e.target !== anchorBtn) {
        menu.remove();
        document.removeEventListener('mousedown', closeMenu);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', closeMenu), 0);
  }

  async _saveActiveAccount(activeId, accounts) {
    window.terminalAPI.saveAccounts({ accounts, activeId });
  }

  async _deleteAccount(accId, accounts) {
    const filtered = accounts.filter(a => a.id !== accId);
    if (this.paneManager.activeAccount && this.paneManager.activeAccount.id === accId) {
      this.paneManager.setActiveAccount(null);
    }
    window.terminalAPI.saveAccounts({ accounts: filtered, activeId: this.paneManager.activeAccount ? this.paneManager.activeAccount.id : null });
  }

  _showAddAccountDialog() {
    const existing = document.getElementById('account-dialog');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'account-dialog';
    overlay.className = 'help-overlay';

    const modal = document.createElement('div');
    modal.className = 'help-modal account-dialog';
    modal.innerHTML = `
      <div class="help-header">
        <span class="help-title">\uacc4\uc815 \ucd94\uac00</span>
        <button class="help-close-btn">\u00d7</button>
      </div>
      <div class="help-body">
        <div class="account-form">
          <label class="account-label">\uacc4\uc815 \uc774\ub984</label>
          <input class="account-input" id="acc-name-input" placeholder="\uc608: \uac1c\uc778, \ud68c\uc0ac" maxlength="20">
          <label class="account-label">API Key</label>
          <input class="account-input" id="acc-key-input" type="password" placeholder="sk-ant-...">
          <div class="account-form-actions">
            <button class="account-cancel-btn" id="acc-cancel">\ucde8\uc18c</button>
            <button class="account-save-btn" id="acc-save">\uc800\uc7a5</button>
          </div>
        </div>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const nameInput = modal.querySelector('#acc-name-input');
    const keyInput = modal.querySelector('#acc-key-input');

    const close = () => overlay.remove();

    modal.querySelector('.help-close-btn').addEventListener('click', close);
    modal.querySelector('#acc-cancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    modal.querySelector('#acc-save').addEventListener('click', async () => {
      const name = nameInput.value.trim();
      const apiKey = keyInput.value.trim();
      if (!name || !apiKey) return;

      const data = await window.terminalAPI.loadAccounts();
      const accounts = data.accounts || [];
      const newAcc = { id: 'acc_' + Date.now(), name, apiKey };
      accounts.push(newAcc);

      // Set as active
      this.paneManager.setActiveAccount(newAcc);
      window.terminalAPI.saveAccounts({ accounts, activeId: newAcc.id });
      close();
    });

    nameInput.focus();

    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); }
    });
  }

  async _showProjectMenu(anchorBtn) {
    // Remove existing menu if any
    const existing = document.getElementById('project-menu');
    if (existing) { existing.remove(); return; }

    const recents = await window.terminalAPI.loadRecentProjects();

    const menu = document.createElement('div');
    menu.id = 'project-menu';
    menu.className = 'project-menu';

    // "Browse folder..." option always at top
    const browseItem = document.createElement('div');
    browseItem.className = 'project-menu-item project-menu-browse';
    browseItem.textContent = '\ud83d\udcc2 폴더 찾아보기...';
    browseItem.addEventListener('click', () => {
      menu.remove();
      this.paneManager.openProject();
    });
    menu.appendChild(browseItem);

    if (recents.length > 0) {
      const sep = document.createElement('div');
      sep.className = 'project-menu-sep';
      menu.appendChild(sep);

      const header = document.createElement('div');
      header.className = 'project-menu-header';
      header.textContent = '\ucd5c\uadfc \ud504\ub85c\uc81d\ud2b8';
      menu.appendChild(header);

      recents.forEach(proj => {
        const item = document.createElement('div');
        item.className = 'project-menu-item';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'project-menu-name';
        nameSpan.textContent = proj.name;

        const pathSpan = document.createElement('span');
        pathSpan.className = 'project-menu-path';
        pathSpan.textContent = proj.path;

        item.appendChild(nameSpan);
        item.appendChild(pathSpan);
        item.addEventListener('click', () => {
          menu.remove();
          this.paneManager.openRecentProject(proj.path);
        });
        menu.appendChild(item);
      });
    }

    // Position menu below the button
    const rect = anchorBtn.getBoundingClientRect();
    menu.style.top = rect.bottom + 2 + 'px';
    menu.style.left = rect.left + 'px';

    document.body.appendChild(menu);

    // Close on outside click
    const closeMenu = (e) => {
      if (!menu.contains(e.target) && e.target !== anchorBtn) {
        menu.remove();
        document.removeEventListener('mousedown', closeMenu);
      }
    };
    // Delay to avoid immediate close
    setTimeout(() => document.addEventListener('mousedown', closeMenu), 0);
  }

  _showHelp() {
    // Remove existing modal if any
    const existing = document.getElementById('help-modal');
    if (existing) { existing.remove(); return; }

    const overlay = document.createElement('div');
    overlay.id = 'help-modal';
    overlay.className = 'help-overlay';

    const modal = document.createElement('div');
    modal.className = 'help-modal';

    modal.innerHTML = `
      <div class="help-header">
        <span class="help-title">HiveCode 도움말</span>
        <button class="help-close-btn">\u00d7</button>
      </div>
      <div class="help-body">
        <div class="help-section">
          <h3>도구 모음</h3>
          <table>
            <tr><td class="help-key">+ New</td><td>새 PowerShell 터미널 추가 (좌우 분할)</td></tr>
            <tr><td class="help-key">+ Project</td><td>최근 프로젝트 또는 폴더 선택 후 Claude Code 자동 실행</td></tr>
            <tr><td class="help-key">\u{1F464} 계정</td><td>API Key 계정 전환 (새 터미널에 적용)</td></tr>
            <tr><td class="help-key">Split \u2194</td><td>활성 패인을 좌우로 분할</td></tr>
            <tr><td class="help-key">Split \u2195</td><td>활성 패인을 상하로 분할</td></tr>
          </table>
        </div>
        <div class="help-section">
          <h3>패인 헤더</h3>
          <table>
            <tr><td class="help-key">이름 더블클릭</td><td>탭 이름 변경</td></tr>
            <tr><td class="help-key">\u00d7 버튼</td><td>터미널 닫기</td></tr>
            <tr><td class="help-key">헤더 드래그</td><td>패인을 다른 위치로 이동</td></tr>
          </table>
        </div>
        <div class="help-section">
          <h3>드래그 & 드롭</h3>
          <table>
            <tr><td class="help-key">위쪽에 드롭</td><td>대상 패인 위에 배치</td></tr>
            <tr><td class="help-key">아래쪽에 드롭</td><td>대상 패인 아래에 배치</td></tr>
            <tr><td class="help-key">왼쪽에 드롭</td><td>대상 패인 왼쪽에 배치</td></tr>
            <tr><td class="help-key">오른쪽에 드롭</td><td>대상 패인 오른쪽에 배치</td></tr>
            <tr><td class="help-key">중앙에 드롭</td><td>두 패인의 위치 교환</td></tr>
          </table>
        </div>
        <div class="help-section">
          <h3>구분선 (스플리터)</h3>
          <table>
            <tr><td class="help-key">드래그</td><td>패인 크기 조절</td></tr>
            <tr><td class="help-key">더블클릭</td><td>분할 방향 전환 (좌우 \u2194 상하)</td></tr>
          </table>
        </div>
        <div class="help-section">
          <h3>키보드</h3>
          <table>
            <tr><td class="help-key">Ctrl+C</td><td>선택된 텍스트 복사 (선택 없으면 인터럽트)</td></tr>
            <tr><td class="help-key">Ctrl+V</td><td>클립보드에서 붙여넣기</td></tr>
          </table>
        </div>
        <div class="help-section">
          <h3>명령어</h3>
          <table>
            <tr><td class="help-key">cc</td><td>현재 터미널에서 Claude Code 실행</td></tr>
          </table>
        </div>
        <div class="help-section">
          <h3>자동 저장</h3>
          <p>레이아웃, 탭 이름, 분할 비율, 마지막 작업 디렉토리가 자동으로 저장되며 재실행 시 복원됩니다.</p>
        </div>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Close handlers
    overlay.querySelector('.help-close-btn').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', onEsc);
      }
    });
  }
}

window.Toolbar = Toolbar;
