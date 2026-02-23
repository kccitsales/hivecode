class Splitter {
  static create(splitNode, paneManager) {
    const el = document.createElement('div');
    el.className = `splitter ${splitNode.direction}`;

    let startPos = 0;
    let startRatio = 0;
    let containerSize = 0;
    let fitPending = false;

    const onMouseDown = (e) => {
      e.preventDefault();
      el.classList.add('active');

      startRatio = splitNode.ratio;
      const container = el.parentElement;
      containerSize = splitNode.direction === 'horizontal'
        ? container.offsetWidth
        : container.offsetHeight;
      startPos = splitNode.direction === 'horizontal' ? e.clientX : e.clientY;

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    const onMouseMove = (e) => {
      const currentPos = splitNode.direction === 'horizontal' ? e.clientX : e.clientY;
      const delta = currentPos - startPos;
      const deltaRatio = delta / containerSize;
      let newRatio = startRatio + deltaRatio;

      // Clamp to prevent collapsing panes
      newRatio = Math.max(0.1, Math.min(0.9, newRatio));
      splitNode.ratio = newRatio;

      // Update flex-basis directly without full re-render
      const firstChild = el.previousElementSibling;
      const secondChild = el.nextElementSibling;
      const percent1 = (newRatio * 100).toFixed(2);
      const percent2 = ((1 - newRatio) * 100).toFixed(2);
      firstChild.style.flex = `0 0 calc(${percent1}% - 2px)`;
      secondChild.style.flex = `0 0 calc(${percent2}% - 2px)`;

      // Throttle fitAll with requestAnimationFrame
      if (!fitPending) {
        fitPending = true;
        requestAnimationFrame(() => {
          paneManager.fitAll();
          fitPending = false;
        });
      }
    };

    const onMouseUp = () => {
      el.classList.remove('active');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      paneManager.fitAll();
    };

    el.addEventListener('mousedown', onMouseDown);

    // Double-click to toggle split direction
    el.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      splitNode.direction = splitNode.direction === 'horizontal' ? 'vertical' : 'horizontal';
      paneManager.render();
      paneManager.saveState();
    });

    return el;
  }
}

window.Splitter = Splitter;
