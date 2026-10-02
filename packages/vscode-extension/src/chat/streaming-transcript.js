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
      state = {
        node,
        first: node,
        length: 0,
        formatted: false,
        truncated: false,
      };
      states.set(element, state);
    }
    if (truncated || state.truncated || text.length < state.length) {
      // Once a block reaches its cap the omission marker and tail can change.
      // It remains bounded; ordinary streams only append their new suffix.
      state.first.data = text;
      while (element.lastChild !== state.first)
        element.removeChild(element.lastChild);
      state.node = state.first;
    } else if (text.length > state.length) {
      // Mutating a single 200K text node invalidates its complete inline layout
      // on every frame, including the user's selected prefix. Keep finished
      // nodes stable and limit each mutable tail to 4K. Adjacent text nodes do
      // not insert whitespace or change the raw text/copy/selection contract.
      let offset = state.length;
      while (offset < text.length) {
        if (state.node.length >= 4096) {
          let pending = "";
          if (
            /[\uD800-\uDBFF]/u.test(state.node.data.slice(-1)) &&
            /[\uDC00-\uDFFF]/u.test(text[offset])
          ) {
            pending = state.node.data.slice(-1);
            state.node.deleteData(state.node.length - 1, 1);
          }
          state.node = document.createTextNode(pending);
          element.appendChild(state.node);
        }
        let end = Math.min(text.length, offset + 4096 - state.node.length);
        // Keep UTF-16 surrogate pairs in the same layout run. A pending high
        // surrogate can still arrive on its own and is completed in that tail.
        if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1])) end--;
        if (end === offset) {
          state.node = document.createTextNode("");
          element.appendChild(state.node);
          continue;
        }
        state.node.appendData(text.slice(offset, end));
        offset = end;
      }
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
