class SplitNode {
  constructor() {
    this.id = SplitNode._nextId++;
    this.parent = null;
    // Leaf node properties
    this.terminalId = null;
    // Internal node properties
    this.direction = null; // 'horizontal' or 'vertical'
    this.ratio = 0.5;
    this.children = []; // always 0 (leaf) or 2 (split)
  }

  isLeaf() {
    return this.children.length === 0;
  }
}
SplitNode._nextId = 1;

class SplitTree {
  constructor() {
    this.root = null;
  }

  createLeaf(terminalId) {
    const node = new SplitNode();
    node.terminalId = terminalId;
    return node;
  }

  split(leafNode, direction, newTerminalId) {
    // Create a new internal node that replaces the leaf
    const internal = new SplitNode();
    internal.direction = direction;
    internal.ratio = 0.5;
    internal.parent = leafNode.parent;

    // Create new leaf for the new terminal
    const newLeaf = this.createLeaf(newTerminalId);

    // Set children: original leaf is first, new leaf is second
    internal.children = [leafNode, newLeaf];
    leafNode.parent = internal;
    newLeaf.parent = internal;

    // Replace leafNode in the parent
    if (leafNode === this.root) {
      this.root = internal;
    } else {
      const parent = internal.parent;
      const idx = parent.children.indexOf(leafNode);
      parent.children[idx] = internal;
    }

    return newLeaf;
  }

  remove(leafNode) {
    if (leafNode === this.root) {
      this.root = null;
      return;
    }

    const parent = leafNode.parent;
    // Find the sibling
    const sibling = parent.children[0] === leafNode
      ? parent.children[1]
      : parent.children[0];

    // Replace parent with sibling in grandparent
    sibling.parent = parent.parent;

    if (parent === this.root) {
      this.root = sibling;
    } else {
      const grandparent = parent.parent;
      const idx = grandparent.children.indexOf(parent);
      grandparent.children[idx] = sibling;
    }
  }

  findLeaf(terminalId) {
    return this._findLeafRecursive(this.root, terminalId);
  }

  _findLeafRecursive(node, terminalId) {
    if (!node) return null;
    if (node.isLeaf()) {
      return node.terminalId === terminalId ? node : null;
    }
    return this._findLeafRecursive(node.children[0], terminalId)
      || this._findLeafRecursive(node.children[1], terminalId);
  }

  forEachLeaf(callback) {
    this._forEachLeafRecursive(this.root, callback);
  }

  _forEachLeafRecursive(node, callback) {
    if (!node) return;
    if (node.isLeaf()) {
      callback(node);
      return;
    }
    this._forEachLeafRecursive(node.children[0], callback);
    this._forEachLeafRecursive(node.children[1], callback);
  }
}

window.SplitNode = SplitNode;
window.SplitTree = SplitTree;
