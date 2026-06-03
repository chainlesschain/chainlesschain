/**
 * Characterization smoke test for the browser-extension handler split.
 *
 * The background service worker (background.js, ~15k lines) is being broken up
 * into per-domain handler modules under `handlers/`, dispatched through a
 * registry-first `commandHandlerRegistry`. There is no other automated coverage
 * of these files, so this test is the safety net for the incremental split:
 *
 *  - It fails loudly if any handler module has an import/syntax error.
 *  - It pins the shape of the shared primitive layer (`_shared.js`).
 *  - It pins the set of command methods already migrated into the registry, so
 *    a future extraction that accidentally drops a method is caught here.
 *
 * The handler files reference `chrome.*` only inside function bodies, so they
 * import cleanly under vitest/jsdom without a `chrome` global. Behavior of the
 * handlers themselves (which call chrome.*) is out of scope — that needs a real
 * extension load in Chrome.
 */

const EXT = "../../../src/main/remote/browser-extension";

describe("browser-extension/_shared.js (extracted primitive layer)", () => {
  it("exports the shared inject + CDP helpers as functions", async () => {
    const shared = await import(`${EXT}/handlers/_shared.js`);

    for (const name of [
      "executeScript",
      "executeScriptInFrame",
      "ensureDebuggerAttached",
      "captureScreenshot",
    ]) {
      expect(typeof shared[name], `_shared.${name}`).toBe("function");
    }
  });

  it("captureScreenshot is the single (de-shadowed) CDP variant", async () => {
    const { captureScreenshot } = await import(`${EXT}/handlers/_shared.js`);
    // The de-duplicated definition takes (tabId, options = {}).
    expect(captureScreenshot.length).toBeLessThanOrEqual(2);
  });
});

describe("browser-extension/handlers/index.js (command registry)", () => {
  it("loads without import/syntax errors and exports a registry object", async () => {
    const mod = await import(`${EXT}/handlers/index.js`);
    expect(mod.commandHandlerRegistry).toBeTypeOf("object");
    expect(mod.commandHandlerRegistry).not.toBeNull();
    expect(mod.listTabs).toBeTypeOf("function");
  });

  it("keeps every registered method mapped to a function", async () => {
    const { commandHandlerRegistry } = await import(`${EXT}/handlers/index.js`);
    const entries = Object.entries(commandHandlerRegistry);
    expect(entries.length).toBeGreaterThan(0);
    for (const [method, handler] of entries) {
      expect(typeof handler, `registry["${method}"]`).toBe("function");
    }
  });

  it("pins the already-migrated command methods (regression guard)", async () => {
    const { commandHandlerRegistry } = await import(`${EXT}/handlers/index.js`);
    // Methods extracted so far. As new domains are migrated, ADD their methods
    // here — never silently remove one.
    const migrated = [
      "tabs.list",
      "tabs.get",
      "tabs.create",
      "tabs.close",
      "tabs.focus",
      "tabs.navigate",
      "tabs.reload",
      "tabs.goBack",
      "tabs.goForward",
      "bookmarks.getTree",
      "bookmarks.search",
      "bookmarks.create",
      "bookmarks.remove",
      "history.search",
      "history.getVisits",
      "history.delete",
      "clipboard.read",
      "clipboard.write",
      "clipboard.readRich",
      "clipboard.writeRich",
      "clipboard.getFormats",
      "clipboard.writeImage",
      "notification.show",
      "notifications.getPermission",
      "notifications.requestPermission",
      "notifications.create",
      "downloads.list",
      "downloads.download",
      "downloads.cancel",
      "downloads.pause",
      "downloads.resume",
      "downloads.open",
      "downloads.show",
      "downloads.erase",
      "windows.getAll",
      "windows.get",
      "windows.create",
      "windows.update",
      "windows.remove",
      "windows.getCurrent",
      "tabGroups.create",
      "tabGroups.get",
      "tabGroups.getAll",
      "tabGroups.update",
      "tabGroups.move",
      "tabGroups.ungroup",
      "cookies.getAll",
      "cookies.get",
      "cookies.set",
      "cookies.remove",
      "cookies.clear",
      "storage.getLocal",
      "storage.setLocal",
      "storage.getSession",
      "storage.setSession",
      "storage.clearLocal",
      "storage.clearSession",
      "storage.getQuota",
      "storage.getUsage",
      "storage.exportAll",
      "storage.importAll",
      "browsingData.clear",
      "indexedDB.getDatabases",
      "indexedDB.getData",
      "indexedDB.setData",
      "indexedDB.deleteData",
      "indexedDB.clearStore",
      "indexeddb.listDatabases",
      "indexeddb.getDatabaseInfo",
      "indexeddb.getObjectStores",
      "indexeddb.getStoreData",
      "indexeddb.getStoreIndexes",
      "indexeddb.queryByIndex",
      "indexeddb.countRecords",
      "indexeddb.deleteDatabase",
      "indexeddb.clearStore",
      "indexeddb.exportDatabase",
      "cache.listCaches",
      "cache.listEntries",
      "cache.getEntry",
      "cache.deleteEntry",
      "cache.deleteCache",
      "cache.addEntry",
      "network.enableInterception",
      "network.disableInterception",
      "network.setRequestBlocking",
      "network.clearRequestBlocking",
      "network.getRequests",
      "network.mockResponse",
      "network.setThrottling",
      "network.clearThrottling",
      "network.getThrottlingProfiles",
      "network.setOffline",
      "network.getTiming",
      "network.getWaterfall",
      "network.analyzeRequests",
      "networkInfo.get",
      "networkInfo.onChange",
      "websocket.enable",
      "websocket.disable",
      "websocket.getConnections",
      "websocket.getMessages",
      "websocket.send",
      "websocket.close",
      "serviceWorker.list",
      "serviceWorker.getInfo",
      "serviceWorker.unregister",
      "serviceWorker.update",
      "serviceWorker.postMessage",
      "security.getCertificate",
      "security.getSecurityState",
      "security.checkMixedContent",
      "security.getPermissions",
      "animation.list",
      "animation.pause",
      "animation.play",
      "animation.setSpeed",
      "animation.seekTo",
      "animation.cancel",
      "layout.getBoxModel",
      "layout.getComputedLayout",
      "layout.highlightNode",
      "layout.hideHighlight",
      "layout.getNodeInfo",
      "layout.forceElementState",
      "coverage.startJSCoverage",
      "coverage.stopJSCoverage",
      "coverage.startCSSCoverage",
      "coverage.stopCSSCoverage",
      "coverage.getJSCoverage",
      "coverage.getCSSCoverage",
      "memory.getInfo",
      "memory.takeHeapSnapshot",
      "memory.startSampling",
      "memory.stopSampling",
      "memory.forceGC",
      "page.getContent",
      "page.executeScript",
      "page.screenshot",
      "page.print",
      "page.pdf",
      "page.emulateDevice",
      "page.setGeolocation",
      "css.inject",
      "css.remove",
      "article.extract",
      "article.getReadable",
      "article.getMetadata",
      "annotation.highlight",
      "annotation.add",
      "annotation.getAll",
      "annotation.remove",
      "annotation.clear",
      "annotation.export",
      "element.hover",
      "element.focus",
      "element.blur",
      "element.select",
      "element.getAttribute",
      "element.setAttribute",
      "element.getBoundingRect",
      "element.isVisible",
      "element.waitForSelector",
      "element.dragDrop",
      "dom.observeMutations",
      "dom.stopObserving",
      "dom.getMutations",
      "dom.clearMutations",
      "dragdrop.simulateDrag",
      "dragdrop.simulateFileDrop",
      "dragdrop.getDropZones",
      "dragdrop.getDraggableElements",
      "selection.getSelection",
      "selection.setSelection",
      "selection.selectAll",
      "selection.clearSelection",
      "selection.getSelectedHTML",
    ];
    for (const method of migrated) {
      expect(
        commandHandlerRegistry[method],
        `expected "${method}" in registry`,
      ).toBeTypeOf("function");
    }
  });
});
