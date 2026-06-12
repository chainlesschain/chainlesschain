# network

**Source**: `src/main/remote/browser-extension/handlers/network.js`

---

## import

```javascript
import
```

* Network command handlers for the ChainlessChain Browser Bridge.
 *
 * Unifies four network-related areas that were scattered across background.js:
 *  - Interception (CDP Network/Fetch + declarativeNetRequest): enable/disable,
 *    request blocking, captured-request log, response mocking
 *  - Throttling (CDP Network.emulateNetworkConditions): set/clear throttling,
 *    profiles, offline mode
 *  - Timing (page-context Performance API): timing, waterfall, analyze
 *  - Network Information API (page-context navigator.connection): get, onChange
 *
 * Extracted verbatim from background.js (Phase 1 of the split). This is the first
 * handler module with its own module-level state (the interception Maps below)
 * and the first to depend on the shared CDP helper. As an ES module that is
 * imported once, the module-level state is a singleton for the service-worker
 * lifetime — identical semantics to the original background.js top-level consts.
 *
 * The `Network.*` debugger-event constants (Network.requestWillBeSent etc.) live
 * inside the handler bodies as CDP event names; the separate `Network.webSocket*`
 * switch arms in background.js belong to the WebSocket-debugging handler, not here.
 *
 * ESM only. chrome.* is referenced lazily inside the handler bodies.

---

