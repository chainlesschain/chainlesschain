/** Browser-side keyed display reconciliation; never interprets execution cards. */
function createTranscriptReconciler({ document, log, create, write }) {
  const rendered = new WeakMap();
  let pending = null;
  const selected = (element) => {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed) return false;
    for (let i = 0; i < selection.rangeCount; i++)
      if (selection.getRangeAt(i).intersectsNode(element)) return true;
    return false;
  };
  const keyOf = (row) => row.viewId || row.id;
  const nodes = () =>
    Array.from(log.children).filter((el) => el.dataset.transcriptViewId);
  function markSource(element, row) {
    element.dataset.transcriptSource = row.id ? "saved" : "live";
    const description = row.id
      ? "Saved conversation message"
      : "Live output; no matching saved message";
    element.setAttribute("aria-description", description);
    element.title =
      description +
      (row.truncated ? ". Shortened for display; saved text is retained." : "");
  }
  function rememberRow(element, row) {
    const key = keyOf(row);
    if (key) element.dataset.transcriptViewId = key;
    if (row.id) element.dataset.savedRowId = row.id;
    markSource(element, row);
    rendered.set(element, {
      text: row.text,
      role: row.role,
      streaming: !!row.streaming,
    });
  }
  function apply(rows) {
    const existing = nodes();
    const byKey = new Map(
      existing.map((el) => [el.dataset.transcriptViewId, el]),
    );
    const retained = new Set(rows.map(keyOf).filter(Boolean));
    const remove = existing.filter(
      (el) =>
        !retained.has(el.dataset.transcriptViewId) &&
        (el.dataset.savedRowId ||
          el.dataset.transcriptViewId.startsWith("live:")),
    );
    const ordered = rows.map((row) => byKey.get(keyOf(row))).filter(Boolean);
    const remaining = existing.filter((el) =>
      retained.has(el.dataset.transcriptViewId),
    );
    const moving = ordered.some((el, i) => remaining[i] !== el);
    if (remove.some(selected) || (moving && ordered.some(selected))) {
      pending = rows;
      return;
    }
    pending = null;
    for (const el of remove) el.remove();
    let previous = null;
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      let el = byKey.get(keyOf(row));
      if (!el) {
        el = create(row);
        const next = rows
          .slice(index + 1)
          .map((r) => byKey.get(keyOf(r)))
          .find(Boolean);
        if (next) log.insertBefore(el, next);
      } else {
        const old = rendered.get(el);
        if (
          !old ||
          old.text !== row.text ||
          old.role !== row.role ||
          old.streaming !== !!row.streaming
        ) {
          if (
            selected(el) &&
            (!old || !row.streaming || !row.text.startsWith(old.text))
          ) {
            // Retain a single bounded latest projection until selection leaves.
            pending = rows;
          } else {
            write(el, row);
            rememberRow(el, row);
          }
        }
      }
      if (
        previous &&
        Array.from(log.children).indexOf(el) <
          Array.from(log.children).indexOf(previous)
      )
        log.insertBefore(el, previous.nextSibling);
      if (row.id) el.dataset.savedRowId = row.id;
      markSource(el, row);
      if (!rendered.has(el)) rememberRow(el, row);
      previous = el;
    }
  }
  function selectionChanged() {
    if (pending) apply(pending);
  }
  document.addEventListener("selectionchange", selectionChanged);
  return {
    apply,
    renderedSource(element) {
      const source = rendered.get(element);
      return source ? { ...source } : null;
    },
    remember(element, row) {
      // A newer live event invalidates any deferred older host projection.
      pending = null;
      rememberRow(element, row);
    },
    reset() {
      pending = null;
    },
    dispose() {
      pending = null;
      document.removeEventListener("selectionchange", selectionChanged);
    },
  };
}

module.exports = { createTranscriptReconciler };
