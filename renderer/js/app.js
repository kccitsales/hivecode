(async function () {
  const splitTree = new SplitTree();
  const rootElement = document.getElementById('pane-root');
  const toolbarElement = document.getElementById('toolbar');

  const paneManager = new PaneManager(rootElement, splitTree);
  const toolbar = new Toolbar(toolbarElement, paneManager);
  paneManager.toolbar = toolbar;

  // Try to restore saved layout
  const savedState = await window.terminalAPI.loadState();
  let restored = false;

  if (savedState) {
    restored = paneManager.restoreState(savedState);
  }

  // Fallback: create a single terminal if no saved state
  if (!restored) {
    const firstId = paneManager.createTerminal();
    const leaf = splitTree.createLeaf(firstId);
    splitTree.root = leaf;
    paneManager.render();
    paneManager.setActiveTerminal(firstId);
  }

  // Handle window resize
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => paneManager.fitAll(), 150);
  });

  // --- Patch notes auto-show on first run / update ---
  try {
    const patchData = await window.terminalAPI.loadPatchNotes();
    if (patchData && patchData.currentVersion && patchData.seenVersion !== patchData.currentVersion) {
      toolbar.showPatchNotes();
    }
  } catch (e) {
    // ignore patch notes errors
  }

  // --- Update download progress overlay ---
  let updateOverlay = null;

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function showUpdateOverlay() {
    if (updateOverlay) return;
    updateOverlay = document.createElement('div');
    updateOverlay.className = 'update-overlay';
    updateOverlay.innerHTML = `
      <div class="update-modal">
        <div class="update-modal-title">업데이트 다운로드 중...</div>
        <div class="update-progress-bar"><div class="update-progress-fill"></div></div>
        <div class="update-progress-text">
          <span class="update-percent">0%</span>
          <span class="update-speed"></span>
          <span class="update-size"></span>
        </div>
      </div>`;
    document.body.appendChild(updateOverlay);
  }

  function removeUpdateOverlay() {
    if (updateOverlay) {
      updateOverlay.remove();
      updateOverlay = null;
    }
  }

  window.terminalAPI.onUpdateDownloadStarted(() => {
    showUpdateOverlay();
  });

  window.terminalAPI.onUpdateProgress((data) => {
    if (!updateOverlay) showUpdateOverlay();
    const fill = updateOverlay.querySelector('.update-progress-fill');
    const pct = updateOverlay.querySelector('.update-percent');
    const speed = updateOverlay.querySelector('.update-speed');
    const size = updateOverlay.querySelector('.update-size');
    fill.style.width = data.percent.toFixed(1) + '%';
    pct.textContent = data.percent.toFixed(1) + '%';
    speed.textContent = formatBytes(data.bytesPerSecond) + '/s';
    size.textContent = formatBytes(data.transferred) + ' / ' + formatBytes(data.total);
  });

  window.terminalAPI.onUpdateDownloaded(() => {
    removeUpdateOverlay();
  });

  window.terminalAPI.onUpdateError((message) => {
    if (!updateOverlay) showUpdateOverlay();
    const modal = updateOverlay.querySelector('.update-modal');
    modal.innerHTML = `
      <div class="update-modal-title">업데이트 오류</div>
      <div class="update-error-msg">${message}</div>
      <button class="update-close-btn">닫기</button>`;
    modal.querySelector('.update-close-btn').addEventListener('click', removeUpdateOverlay);
  });
})();
