/** Append plain text while streaming; format each finished block only once.
 * Selected text keeps its DOM nodes until the selection leaves the block.
 * `text` is already bounded by the caller's transcript policy.
 */
function createStreamingTranscript({
  document,
  renderMarkdown,
  decorate,
  follow,
}) {
  const states = new WeakMap();
  const pending = new Map();
  const selected = (element) => {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed) return false;
    for (let i = 0; i < selection.rangeCount; i++) {
      if (selection.getRangeAt(i).intersectsNode(element)) return true;
    }
    return false;
  };
  function update(element, text, truncated = false) {
    let state = states.get(element);
    if (state?.formatted && state.text === text) return;
    if (!state || state.formatted) {
      const node = document.createTextNode("");
      element.textContent = "";
      element.appendChild(node);
      state = { node, length: 0, formatted: false, truncated: false };
      states.set(element, state);
    }
    if (truncated || state.truncated || text.length < state.length) {
      // Once a block reaches its cap the omission marker and tail can change.
      // It remains bounded; ordinary streams only append their new suffix.
      state.node.data = text;
    } else if (text.length > state.length) {
      state.node.appendData(text.slice(state.length));
    }
    state.length = text.length;
    state.truncated = truncated;
    follow();
  }
  function finish(element, text) {
    if (states.get(element)?.formatted && states.get(element).text === text)
      return;
    if (selected(element)) {
      pending.set(element, text);
      return;
    }
    pending.delete(element);
    element.innerHTML = renderMarkdown(text);
    decorate(element);
    states.set(element, { formatted: true, text });
    follow();
  }
  function onSelectionChange() {
    for (const [element, text] of pending) {
      if (!element.isConnected) pending.delete(element);
      else if (!selected(element)) finish(element, text);
    }
  }
  document.addEventListener("selectionchange", onSelectionChange);
  return {
    update,
    finish,
    dispose() {
      pending.clear();
      document.removeEventListener("selectionchange", onSelectionChange);
    },
  };
}

module.exports = { createStreamingTranscript };
