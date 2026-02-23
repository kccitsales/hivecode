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
    resizeTimeout = setTimeout(() => paneManager.fitAll(), 50);
  });
})();
