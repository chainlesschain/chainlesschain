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
 * Capture and response-mock state is bounded by count and UTF-8 bytes. Active
 * tabs own removable debugger listeners; completed capture metadata is retained
 * only within the registry limits and local to the service-worker lifetime.
 *
 * The `Network.*` debugger-event constants (Network.requestWillBeSent etc.) live
 * inside the handler bodies as CDP event names; the separate `Network.webSocket*`
 * switch arms in background.js belong to the WebSocket-debugging handler, not here.
 *
 * ESM only. chrome.* is referenced lazily inside the handler bodies.

---

