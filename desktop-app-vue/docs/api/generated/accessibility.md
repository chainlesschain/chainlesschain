# accessibility

**Source**: `src/main/remote/browser-extension/handlers/accessibility.js`

---

## export async function getAccessibilityTree(tabId, selector = "body")

```javascript
export async function getAccessibilityTree(tabId, selector = "body")
```

* Accessibility command handlers for the ChainlessChain Browser Bridge.
 *
 * Covers the full accessibility.* namespace, which spanned two source sections
 * (the basic "Accessibility" section and the Phase 21 "Accessibility" section):
 * getTree, getRole, getARIA, checkContrast, getFocusOrder, getLandmarks,
 * getHeadingStructure, checkAlt, checkLabels, simulate, runAudit.
 *
 * Extracted verbatim from background.js (Phase 1 of the split). All handlers run
 * in page context via chrome.scripting.executeScript — no CDP, no shared-layer
 * dependency, no module-level state. runAudit composes several of the others.
 *
 * NOTE: background.js defined getAccessibilityTree TWICE (basic + Phase 21);
 * hoisting made the Phase 21 one (with selector="body" default) effective for
 * BOTH accessibility.getTree switch cases. This module keeps that effective
 * definition.
 *
 * ESM only. chrome.* is referenced lazily inside the handler bodies.

---

