"use strict";

/**
 * Test-only CDP driver for the installed-VSIX host journey.
 *
 * VS Code is launched with a random loopback-only debugging endpoint. This
 * module locates the ChainlessChain webview target and drives its real DOM
 * without a production test command or extension export.
 */

const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const DEFAULT_TIMEOUT_MS = 60_000;
const JOURNEY_PHASES = Object.freeze({
  initial: Object.freeze([
    "stream",
    "retry",
    "plan-approval",
    "permission",
    "interrupt",
  ]),
  restart: Object.freeze(["ide-restart-resume"]),
});
const PHASE_DOM_MARKERS = Object.freeze({
  initial: Object.freeze([
    "fixture stream complete #1",
    "fixture stream complete #2",
    "fixture plan approve #3",
    "fixture permission approved #4",
    "interrupted",
  ]),
  restart: Object.freeze([
    "resumed previous conversation",
    "fixture stream complete #6",
  ]),
});
const REWIND_HOST_ACTIONS = Object.freeze([
  Object.freeze({ action: "restore-code", label: "Restore code" }),
  Object.freeze({
    action: "restore-conversation",
    label: "Restore conversation",
  }),
  Object.freeze({
    action: "restore-both",
    label: "Restore code + conversation",
  }),
  Object.freeze({ action: "summary-from", label: "Summarize from here" }),
  Object.freeze({ action: "summary-to", label: "Summarize up to here" }),
  Object.freeze({ action: "branch", label: "Branch from here" }),
]);
const CHAT_WEBVIEW_PROBE = [
  "document.body",
  "document.querySelector('#tabs')",
  "document.querySelector('#ctxbar')",
  "document.querySelector('textarea#input')",
  "document.querySelector('#send')",
  "document.querySelector('#planApprove')",
].join(" && ");

function abortError(signal) {
  const error = new Error(
    String(signal?.reason?.message || signal?.reason || "operation aborted"),
  );
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal);
}

function delay(milliseconds, signal) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    function done() {
      signal?.removeEventListener("abort", aborted);
      resolve();
    }
    function aborted() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
      reject(abortError(signal));
    }
    signal?.addEventListener("abort", aborted, { once: true });
  });
}

async function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else if (!port) reject(new Error("could not reserve a CDP port"));
        else resolve(port);
      });
    });
  });
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function createFixtureCli(runRoot, repoRoot) {
  const binDir = path.join(runRoot, "fixture-cli-bin");
  fs.mkdirSync(binDir, { recursive: true });
  const script = path.join(
    repoRoot,
    "tests",
    "fixtures",
    "ide-roadmap",
    "fake-stream-json-agent.mjs",
  );
  if (!fs.statSync(script, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`missing shared stream-json fixture: ${script}`);
  }

  const posix = path.join(binDir, "cc");
  fs.writeFileSync(
    posix,
    `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(script)} "$@"\n`,
    { encoding: "utf8", mode: 0o700, flag: "wx" },
  );
  fs.chmodSync(posix, 0o700);
  const windows = path.join(binDir, "cc.cmd");
  fs.writeFileSync(
    windows,
    `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`,
    { encoding: "utf8", mode: 0o700, flag: "wx" },
  );
  return {
    binDir,
    command: process.platform === "win32" ? windows : posix,
    statePath: path.join(runRoot, "fixture-cli-state.json"),
    tracePath: path.join(runRoot, "fixture-cli-protocol.jsonl"),
  };
}

async function waitForFile(
  filePath,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal = null,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    if (fs.statSync(filePath, { throwIfNoEntry: false })?.isFile()) {
      return filePath;
    }
    await delay(100, signal);
  }
  throw new Error(
    `host signal did not appear within ${timeoutMs}ms: ${filePath}`,
  );
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.sequence = 0;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!message.id || !this.pending.has(message.id)) return;
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(
          new Error(`CDP ${pending.method} failed: ${message.error.message}`),
        );
      } else {
        pending.resolve(message.result || {});
      }
    });
    const failPending = (error) => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      this.pending.clear();
    };
    socket.addEventListener("close", () => {
      failPending(new Error("CDP target closed"));
    });
    socket.addEventListener("error", (event) => {
      failPending(
        new Error(
          `CDP transport failed: ${String(event?.error?.message || event?.message || "unknown error")}`,
          { cause: event?.error },
        ),
      );
    });
  }

  static connect(webSocketUrl, WebSocketImpl = globalThis.WebSocket) {
    if (typeof WebSocketImpl !== "function") {
      throw new Error("this Node runtime has no WebSocket client");
    }
    return new Promise((resolve, reject) => {
      const socket = new WebSocketImpl(webSocketUrl);
      const timer = setTimeout(() => {
        try {
          socket.close();
        } catch {
          // best effort
        }
        reject(new Error(`CDP websocket timed out: ${webSocketUrl}`));
      }, 10_000);
      socket.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          resolve(new CdpClient(socket));
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        (event) => {
          clearTimeout(timer);
          const details = [
            event?.message,
            event?.error?.message,
            event?.error?.cause?.message,
          ]
            .filter(
              (value, index, values) =>
                Boolean(value) && values.indexOf(value) === index,
            )
            .join("; ");
          reject(
            new Error(
              `CDP websocket failed: ${webSocketUrl}${details ? `: ${details}` : ""}`,
            ),
          );
        },
        { once: true },
      );
    });
  }

  send(method, params = {}, timeoutMs = 15_000, sessionId = null) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      try {
        this.socket.send(
          JSON.stringify({
            id,
            method,
            params,
            ...(sessionId ? { sessionId } : {}),
          }),
        );
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async evaluate(expression, sessionId = null, contextId = null) {
    const response = await this.send(
      "Runtime.evaluate",
      {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
        ...(Number.isInteger(contextId) ? { contextId } : {}),
      },
      15_000,
      sessionId,
    );
    if (response.exceptionDetails) {
      throw new Error(
        `webview evaluation failed: ${response.exceptionDetails.text || "exception"}`,
      );
    }
    return response.result ? response.result.value : undefined;
  }

  session(sessionId, contextId = null) {
    if (!sessionId) throw new Error("CDP session id is required");
    return {
      evaluate: (expression) => this.evaluate(expression, sessionId, contextId),
      send: (method, params = {}, timeoutMs = 15_000) =>
        this.send(method, params, timeoutMs, sessionId),
      close: () => this.close(),
    };
  }

  close() {
    try {
      this.socket.close();
    } catch {
      // best effort
    }
  }
}

function createCdpPipeSocket(pipeWrite, pipeRead) {
  if (
    !pipeWrite ||
    typeof pipeWrite.write !== "function" ||
    !pipeRead ||
    typeof pipeRead.on !== "function"
  ) {
    throw new Error("CDP pipe requires writable FD 3 and readable FD 4");
  }
  const listeners = new Map();
  let pending = Buffer.alloc(0);
  let closed = false;

  const emit = (type, event = {}) => {
    for (const entry of [...(listeners.get(type) || [])]) {
      if (entry.once) listeners.get(type)?.delete(entry);
      entry.listener(event);
    }
  };
  const fail = (error) => {
    emit("error", {
      error,
      message: String(error?.message || error),
    });
  };
  pipeRead.on("data", (chunk) => {
    if (closed) return;
    pending = Buffer.concat([pending, Buffer.from(chunk)]);
    if (pending.length > 32 * 1024 * 1024) {
      fail(new Error("CDP pipe frame exceeds 32 MiB"));
      closed = true;
      emit("close", {});
      return;
    }
    let boundary = pending.indexOf(0);
    while (boundary !== -1) {
      const message = pending.subarray(0, boundary).toString("utf8");
      pending = pending.subarray(boundary + 1);
      if (message) emit("message", { data: message });
      boundary = pending.indexOf(0);
    }
  });
  pipeRead.on("error", fail);
  pipeWrite.on("error", fail);
  pipeRead.on("close", () => {
    if (closed) return;
    closed = true;
    emit("close", {});
  });
  pipeRead.on("end", () => {
    if (closed) return;
    closed = true;
    emit("close", {});
  });

  return {
    addEventListener(type, listener, options = {}) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add({ listener, once: Boolean(options.once) });
    },
    send(message) {
      if (closed) throw new Error("CDP pipe is closed");
      pipeWrite.write(String(message));
      pipeWrite.write("\0");
    },
    close() {
      if (closed) return;
      closed = true;
      emit("close", {});
    },
  };
}

function buildCdpWebSocketOptions(webSocketUrl) {
  const endpoint = new URL(webSocketUrl);
  if (
    endpoint.protocol !== "ws:" ||
    !["127.0.0.1", "[::1]", "::1"].includes(endpoint.hostname) ||
    !endpoint.port ||
    endpoint.username ||
    endpoint.password
  ) {
    throw new Error(`refusing non-loopback CDP websocket: ${webSocketUrl}`);
  }
  return {
    // Chromium accepts a DevTools websocket origin whose host/port exactly
    // matches the debugging endpoint. Supplying it explicitly avoids the
    // signed macOS Electron host closing Node's origin-less WHATWG handshake.
    origin: `http://${endpoint.host}`,
    perMessageDeflate: false,
    // Fire before CdpClient's 10-second outer deadline so a genuine handshake
    // error wins over its best-effort CONNECTING-state cleanup.
    handshakeTimeout: 8_000,
  };
}

function connectCdpWebSocket(webSocketUrl) {
  let WebSocketImpl;
  try {
    const ws = require("ws");
    WebSocketImpl = ws.WebSocket || ws;
  } catch (error) {
    throw new Error(
      "ws is required for the cross-platform CDP host journey; install the pinned test runtime first",
      { cause: error },
    );
  }
  return CdpClient.connect(
    webSocketUrl,
    class LoopbackCdpWebSocket extends WebSocketImpl {
      constructor(url) {
        super(url, buildCdpWebSocketOptions(url));
      }
    },
  );
}

async function listTargets(port, signal = null) {
  throwIfAborted(signal);
  const timeoutSignal = AbortSignal.timeout(2_000);
  const requestSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
    cache: "no-store",
    signal: requestSignal,
  });
  if (!response.ok)
    throw new Error(`CDP target list returned ${response.status}`);
  const targets = await response.json();
  return Array.isArray(targets) ? targets : [];
}

async function browserWebSocketUrl(port, signal = null) {
  throwIfAborted(signal);
  const timeoutSignal = AbortSignal.timeout(2_000);
  const requestSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;
  const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
    cache: "no-store",
    signal: requestSignal,
  });
  if (!response.ok) {
    throw new Error(`CDP browser metadata returned ${response.status}`);
  }
  const metadata = await response.json();
  if (!metadata || typeof metadata.webSocketDebuggerUrl !== "string") {
    throw new Error("CDP browser metadata has no websocket URL");
  }
  return metadata.webSocketDebuggerUrl;
}

function collectFrameIds(frameTree, result = []) {
  if (!frameTree || typeof frameTree !== "object") return result;
  if (typeof frameTree.frame?.id === "string") {
    result.push(frameTree.frame.id);
  }
  for (const child of Array.isArray(frameTree.childFrames)
    ? frameTree.childFrames
    : []) {
    collectFrameIds(child, result);
  }
  return result;
}

function isInspectableBrowserTarget(candidate) {
  return ["page", "iframe", "webview"].includes(candidate?.type);
}

async function findChatWebview(
  port,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal = null,
  tracePath = null,
  getBrowserWebSocketUrl = null,
  suppliedBrowserClient = null,
) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  let lastTargets = [];
  let lastTargetSnapshot = "";
  const targetInspections = new Map();
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    try {
      const announcedBrowserUrl =
        typeof getBrowserWebSocketUrl === "function"
          ? getBrowserWebSocketUrl()
          : null;
      // When Chromium has already announced its authoritative browser
      // endpoint, avoid both HTTP discovery requests. This matters on the
      // macOS Extension Host where /json/list and /json/version can remain
      // pending even while the websocket endpoint is accepting connections.
      const targets =
        announcedBrowserUrl || suppliedBrowserClient
          ? []
          : await listTargets(port, signal);
      lastTargets = targets.map((target) => ({
        id: target.id,
        type: target.type,
        title: target.title,
        url: target.url,
      }));
      for (const target of targets) {
        throwIfAborted(signal);
        if (!target.webSocketDebuggerUrl) continue;
        let client;
        try {
          client = await connectCdpWebSocket(target.webSocketDebuggerUrl);
          const found = await client.evaluate(`Boolean(${CHAT_WEBVIEW_PROBE})`);
          if (found) return { client, target };
        } catch (error) {
          lastError = error;
        }
        client?.close();
      }

      // Electron 39+ may keep Webview iframe targets off /json/list. Connect
      // to the browser endpoint (flattened sessions are brokered there), then
      // attach only to vscode-webview OOPIFs and evaluate their real DOM.
      const browserUrl = suppliedBrowserClient
        ? "pipe://browser"
        : announcedBrowserUrl || (await browserWebSocketUrl(port, signal));
      const browserClient =
        suppliedBrowserClient || (await connectCdpWebSocket(browserUrl));
      const ownsBrowserClient = !suppliedBrowserClient;
      let keepBrowserClient = false;
      try {
        const discovered = await browserClient.send("Target.getTargets");
        const targetInfos = Array.isArray(discovered.targetInfos)
          ? discovered.targetInfos
          : [];
        lastTargets = [
          ...lastTargets,
          ...targetInfos.map((info) => ({
            id: info.targetId,
            type: info.type,
            title: info.title,
            url: info.url,
          })),
        ];
        const targetSnapshot = JSON.stringify(lastTargets.slice(-20));
        if (tracePath && targetSnapshot !== lastTargetSnapshot) {
          appendTrace(tracePath, {
            status: "target-scan",
            targets: lastTargets.slice(-20),
          });
          lastTargetSnapshot = targetSnapshot;
        }
        // Electron versions differ in whether a Webview is surfaced as its
        // own iframe/webview target or as a frame under the workbench page.
        // Inspect every renderable target and let CHAT_WEBVIEW_PROBE provide
        // the strict identity check; browser and worker targets stay excluded.
        for (const info of targetInfos.filter(isInspectableBrowserTarget)) {
          let sessionId = null;
          try {
            const attached = await browserClient.send("Target.attachToTarget", {
              targetId: info.targetId,
              flatten: true,
            });
            sessionId = attached.sessionId;
            const contexts = [{ frameId: null, contextId: null }];
            if (sessionId) {
              const pageTree = await browserClient.send(
                "Page.getFrameTree",
                {},
                15_000,
                sessionId,
              );
              for (const frameId of collectFrameIds(pageTree.frameTree)) {
                const world = await browserClient.send(
                  "Page.createIsolatedWorld",
                  {
                    frameId,
                    worldName: "chainlesschain-host-journey",
                  },
                  15_000,
                  sessionId,
                );
                if (Number.isInteger(world.executionContextId)) {
                  contexts.push({
                    frameId,
                    contextId: world.executionContextId,
                  });
                }
              }
            }
            for (const context of contexts) {
              const inspection = sessionId
                ? await browserClient.evaluate(
                    `({
                      probe: Boolean(${CHAT_WEBVIEW_PROBE}),
                      readyState: document.readyState,
                      title: document.title,
                      url: location.href,
                      body: document.body ? document.body.innerText.slice(0, 500) : "",
                      frames: [...document.querySelectorAll("iframe, webview")].map((frame) => ({
                        tag: frame.tagName,
                        id: frame.id,
                        src: frame.getAttribute("src") || ""
                      }))
                    })`,
                    sessionId,
                    context.contextId,
                  )
                : null;
              const inspectionKey = `${info.targetId}:${context.frameId || "default"}`;
              const inspectionSnapshot = JSON.stringify(inspection);
              if (
                tracePath &&
                targetInspections.get(inspectionKey) !== inspectionSnapshot
              ) {
                appendTrace(tracePath, {
                  status: "target-inspection",
                  targetId: info.targetId,
                  frameId: context.frameId,
                  inspection,
                });
                targetInspections.set(inspectionKey, inspectionSnapshot);
              }
              if (sessionId && inspection?.probe) {
                keepBrowserClient = true;
                return {
                  client: browserClient.session(sessionId, context.contextId),
                  target: {
                    ...info,
                    id: info.targetId,
                    webSocketDebuggerUrl: browserUrl,
                  },
                };
              }
            }
          } catch (error) {
            lastError = error;
            const errorSnapshot = String(error?.message || error);
            if (
              tracePath &&
              targetInspections.get(info.targetId) !== errorSnapshot
            ) {
              appendTrace(tracePath, {
                status: "target-inspection-error",
                targetId: info.targetId,
                error: errorSnapshot,
              });
              targetInspections.set(info.targetId, errorSnapshot);
            }
          }
          if (sessionId) {
            await browserClient
              .send("Target.detachFromTarget", { sessionId })
              .catch(() => {});
          }
        }
      } finally {
        if (!keepBrowserClient && ownsBrowserClient) browserClient.close();
      }
    } catch (error) {
      if (signal?.aborted) throw abortError(signal);
      lastError = error;
    }
    await delay(250, signal);
  }
  throw new Error(
    `ChainlessChain chat webview was not found on CDP port ${port}; targets=${JSON.stringify(lastTargets.slice(-20))}; lastError=${String(lastError?.message || lastError || "none")}`,
    {
      cause: lastError,
    },
  );
}

async function findWorkbenchWindow(
  port,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal = null,
  getBrowserWebSocketUrl = null,
  suppliedBrowserClient = null,
) {
  const deadline = Date.now() + timeoutMs;
  let lastTargets = [];
  let lastError;
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    try {
      const announcedBrowserUrl =
        typeof getBrowserWebSocketUrl === "function"
          ? getBrowserWebSocketUrl()
          : null;
      const targets =
        announcedBrowserUrl || suppliedBrowserClient
          ? []
          : await listTargets(port, signal);
      lastTargets = targets.map((target) => ({
        type: target.type,
        title: target.title,
        url: target.url,
      }));
      for (const target of targets) {
        if (target.type !== "page" || !target.webSocketDebuggerUrl) continue;
        let client;
        try {
          client = await connectCdpWebSocket(target.webSocketDebuggerUrl);
          const found = await client.evaluate(
            "Boolean(document.querySelector('.monaco-workbench') && document.querySelector('.quick-input-widget'))",
          );
          if (found) return { client, target };
        } catch (error) {
          lastError = error;
        }
        client?.close();
      }

      // Electron 39+ can expose the workbench only through the browser-level
      // Target domain. Attach to that page exactly as the Webview discovery
      // path above attaches to OOPIFs; do not infer readiness from its URL.
      const browserUrl = suppliedBrowserClient
        ? "pipe://browser"
        : announcedBrowserUrl || (await browserWebSocketUrl(port, signal));
      const browserClient =
        suppliedBrowserClient || (await connectCdpWebSocket(browserUrl));
      const ownsBrowserClient = !suppliedBrowserClient;
      let keepBrowserClient = false;
      try {
        const discovered = await browserClient.send("Target.getTargets");
        const targetInfos = Array.isArray(discovered.targetInfos)
          ? discovered.targetInfos
          : [];
        lastTargets = [
          ...lastTargets,
          ...targetInfos.map((info) => ({
            type: info.type,
            title: info.title,
            url: info.url,
          })),
        ];
        for (const info of targetInfos.filter(
          (candidate) => candidate.type === "page",
        )) {
          let sessionId = null;
          try {
            const attached = await browserClient.send("Target.attachToTarget", {
              targetId: info.targetId,
              flatten: true,
            });
            sessionId = attached.sessionId;
            const workbenchClient = browserClient.session(sessionId);
            const found = await workbenchClient.evaluate(
              "Boolean(document.querySelector('.monaco-workbench') && document.querySelector('.quick-input-widget'))",
            );
            if (found) {
              keepBrowserClient = true;
              return {
                client: workbenchClient,
                target: {
                  ...info,
                  id: info.targetId,
                  webSocketDebuggerUrl: browserUrl,
                },
              };
            }
          } catch (error) {
            lastError = error;
          }
          if (sessionId) {
            await browserClient
              .send("Target.detachFromTarget", { sessionId })
              .catch(() => {});
          }
        }
      } finally {
        if (!keepBrowserClient && ownsBrowserClient) browserClient.close();
      }
    } catch (error) {
      lastError = error;
    }
    await delay(100, signal);
  }
  throw new Error(
    `VS Code workbench target was not found; targets=${JSON.stringify(lastTargets.slice(-20))}; lastError=${String(lastError?.message || lastError || "none")}`,
  );
}

async function chooseQuickPickItem(client, label, signal = null) {
  const labelJson = JSON.stringify(label);
  const visibleWidget =
    "[...document.querySelectorAll('.quick-input-widget')].find((element) => getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden')";
  await waitForDom(
    client,
    `(() => { const widget = ${visibleWidget}; return Boolean(widget && [...widget.querySelectorAll('.monaco-list-row')].some((row) => (row.textContent || '').includes(${labelJson}))); })()`,
    `quick pick item ${label}`,
    45_000,
    signal,
  );
  const selected = await client.evaluate(`(() => {
    const widget = ${visibleWidget};
    const row = widget && [...widget.querySelectorAll('.monaco-list-row')]
      .find((candidate) => (candidate.textContent || '').includes(${labelJson}));
    if (!row) return false;
    row.scrollIntoView({ block: 'center' });
    for (const type of ['mousedown', 'mouseup', 'click']) {
      row.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    return true;
  })()`);
  if (!selected) throw new Error(`could not choose quick pick item ${label}`);
}

async function confirmNativeTimelineAction(client, signal = null) {
  await waitForDom(
    client,
    `(() => {
      const dialogs = [...document.querySelectorAll('.monaco-dialog-box')]
        .filter((element) => getComputedStyle(element).display !== 'none');
      const dialog = dialogs.at(-1);
      const text = dialog ? (dialog.textContent || '') : '';
      return text.includes('Confirm action') && document.body.innerText.includes('vendor/cache')
        && document.body.innerText.includes('publish release');
    })()`,
    "partial-coverage rewind confirmation",
    45_000,
    signal,
  );
  const clicked = await client.evaluate(`(() => {
    const dialogs = [...document.querySelectorAll('.monaco-dialog-box')]
      .filter((element) => getComputedStyle(element).display !== 'none');
    const dialog = dialogs.at(-1);
    const button = dialog && [...dialog.querySelectorAll('button, .monaco-button')]
      .find((candidate) => (candidate.textContent || '').trim() === 'Confirm action');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error("could not confirm native timeline action");
}

async function driveRewindAction(
  webviewClient,
  workbenchClient,
  action,
  tracePath,
  signal = null,
) {
  await sendComposer(webviewClient, "/rewind");
  await chooseQuickPickItem(workbenchClient, "turn-2", signal);
  await chooseQuickPickItem(workbenchClient, action.label, signal);
  await confirmNativeTimelineAction(workbenchClient, signal);
  await waitForDom(
    webviewClient,
    containsText(`${action.label} completed at turn-2`),
    `${action.action} completion`,
    45_000,
    signal,
  );
  appendTrace(tracePath, {
    phase: "initial",
    action: action.action,
    coverage: "partial",
    status: "rewind-action-observed",
  });
}

async function waitForDom(
  client,
  expression,
  label,
  timeoutMs = 45_000,
  signal = null,
) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    try {
      if (await client.evaluate(expression)) return;
    } catch (error) {
      lastError = error;
    }
    await delay(100, signal);
  }
  throw new Error(`${label} did not become true within ${timeoutMs}ms`, {
    cause: lastError,
  });
}

function containsText(text) {
  return `Boolean(document.body && document.body.innerText.includes(${JSON.stringify(text)}))`;
}

async function sendComposer(client, text) {
  const sent = await client.evaluate(`(() => {
    const input = document.querySelector('#input');
    const button = document.querySelector('#send');
    if (!input || !button) return false;
    input.value = ${JSON.stringify(text)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    button.click();
    return true;
  })()`);
  if (!sent) throw new Error(`could not send composer text: ${text}`);
}

async function clickSelector(client, selector, label, signal = null) {
  const literal = JSON.stringify(selector);
  await waitForDom(
    client,
    `Boolean(document.querySelector(${literal}) && !document.querySelector(${literal}).disabled)`,
    `${label} button`,
    45_000,
    signal,
  );
  const clicked = await client.evaluate(`(() => {
    const button = document.querySelector(${literal});
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`could not click ${label}`);
}

async function clickApproval(client, signal = null) {
  const finder = `(() => {
    const cards = [...document.querySelectorAll('.approval[id^="appr-"]')];
    const card = cards[cards.length - 1];
    if (!card) return null;
    return [...card.querySelectorAll('button')].find(
      (button) => button.textContent.trim() === 'Approve' && !button.disabled
    ) || null;
  })()`;
  await waitForDom(
    client,
    `Boolean(${finder})`,
    "approval card",
    45_000,
    signal,
  );
  const clicked = await client.evaluate(`(() => {
    const button = ${finder};
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error("could not approve the fixture tool request");
}

function appendTrace(tracePath, record) {
  fs.appendFileSync(
    tracePath,
    `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

async function captureWebview(client, artifactDir, phase) {
  fs.mkdirSync(artifactDir, { recursive: true });
  const text = String(
    (await client.evaluate("document.body ? document.body.innerText : ''")) ||
      "",
  ).slice(-128 * 1024);
  if (!text.trim()) {
    throw new Error(`cannot capture empty webview DOM evidence for ${phase}`);
  }
  const domPath = path.join(artifactDir, `${phase}-dom.txt`);
  fs.writeFileSync(domPath, text, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  let screenshotPath = null;
  try {
    await client.send("Page.enable");
    const shot = await client.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    if (shot.data) {
      screenshotPath = path.join(artifactDir, `${phase}-webview.png`);
      fs.writeFileSync(screenshotPath, Buffer.from(shot.data, "base64"), {
        mode: 0o600,
        flag: "wx",
      });
    }
  } catch {
    // Some VS Code builds expose webviews as iframe targets without Page.
    // The DOM snapshot and protocol/host logs remain mandatory diagnostics.
  }
  return { domPath, screenshotPath };
}

async function drivePhase(
  client,
  phase,
  tracePath,
  signal = null,
  workbenchClient = null,
) {
  const step = async (name, action) => {
    throwIfAborted(signal);
    appendTrace(tracePath, { phase, step: name, status: "started" });
    await action();
    throwIfAborted(signal);
    appendTrace(tracePath, { phase, step: name, status: "passed" });
  };

  if (phase === "initial") {
    await step("stream", async () => {
      await sendComposer(client, "journey:stream");
      await waitForDom(
        client,
        containsText("fixture stream complete #1"),
        "first streamed turn",
        45_000,
        signal,
      );
    });
    await step("retry", async () => {
      await sendComposer(client, "/retry");
      await waitForDom(
        client,
        containsText("fixture stream complete #2"),
        "retried turn",
        45_000,
        signal,
      );
    });
    await step("plan-approval", async () => {
      await sendComposer(client, "journey:plan");
      await waitForDom(
        client,
        "Boolean(document.querySelector('#plan') && getComputedStyle(document.querySelector('#plan')).display !== 'none')",
        "plan card",
        45_000,
        signal,
      );
      await clickSelector(client, "#planApprove", "plan approve", signal);
      await waitForDom(
        client,
        containsText("fixture plan approve #3"),
        "plan continuation",
        45_000,
        signal,
      );
    });
    await step("permission", async () => {
      await sendComposer(client, "journey:permission");
      await clickApproval(client, signal);
      await waitForDom(
        client,
        containsText("fixture permission approved #4"),
        "permission continuation",
        45_000,
        signal,
      );
    });
    await step("interrupt", async () => {
      await sendComposer(client, "journey:stop");
      await clickSelector(client, "#stop", "interrupt", signal);
      await waitForDom(
        client,
        containsText("interrupted"),
        "interrupt result",
        45_000,
        signal,
      );
    });
    if (workbenchClient) {
      for (const action of REWIND_HOST_ACTIONS) {
        await step(`rewind-${action.action}`, async () => {
          await driveRewindAction(
            client,
            workbenchClient,
            action,
            tracePath,
            signal,
          );
        });
      }
    }
    return;
  }

  if (phase === "restart") {
    await step("ide-restart-resume", async () => {
      await sendComposer(client, "journey:resume");
      await waitForDom(
        client,
        containsText("resumed previous conversation"),
        "resume acknowledgement",
        45_000,
        signal,
      );
      await waitForDom(
        client,
        containsText("fixture stream complete #6"),
        "post-restart streamed turn",
        45_000,
        signal,
      );
    });
    return;
  }

  throw new Error(`unknown CDP journey phase: ${phase}`);
}

function writeJsonSignal(filePath, value) {
  const parent = path.dirname(filePath);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (fs.existsSync(filePath)) {
    throw new Error(`refusing to overwrite host journey signal: ${filePath}`);
  }
  const temporary = path.join(
    parent,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  try {
    fs.renameSync(temporary, filePath);
  } catch (error) {
    try {
      fs.unlinkSync(temporary);
    } catch {
      // best effort
    }
    throw error;
  }
}

function readJsonLines(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  if (!text.trim()) throw new Error(`journey trace is empty: ${filePath}`);
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(
          `journey trace has invalid JSON at ${filePath}:${index + 1}`,
          { cause: error },
        );
      }
    });
}

function readJourneyResult(resultFile, expectedPhase) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  } catch (error) {
    throw new Error(`host journey result is unreadable: ${resultFile}`, {
      cause: error,
    });
  }
  if (!value || value.phase !== expectedPhase || value.ok !== true) {
    throw new Error(
      `host journey ${expectedPhase} failed: ${String(value?.error || "invalid result")}`,
    );
  }
  return value;
}

function normalizePathForCompare(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isExactIsoTimestamp(value) {
  if (typeof value !== "string") return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function assertHostReadySignal({
  readyFile,
  phase,
  extensionsDir,
  workspaceDir,
}) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(readyFile, "utf8"));
  } catch (error) {
    throw new Error(`host ready signal is unreadable: ${readyFile}`, {
      cause: error,
    });
  }
  if (!value || value.phase !== phase) {
    throw new Error(`host ready signal phase mismatch: ${phase}`);
  }
  let installedPath;
  let isolatedExtensions;
  let signaledWorkspace;
  let expectedWorkspace;
  try {
    installedPath = normalizePathForCompare(
      fs.realpathSync(value.extensionPath || ""),
    );
    isolatedExtensions = normalizePathForCompare(
      fs.realpathSync(extensionsDir),
    );
    signaledWorkspace = normalizePathForCompare(
      fs.realpathSync(value.workspaceDir || ""),
    );
    expectedWorkspace = normalizePathForCompare(fs.realpathSync(workspaceDir));
  } catch (error) {
    throw new Error(`host ready signal contains an unresolved path: ${phase}`, {
      cause: error,
    });
  }
  const relative = path.relative(isolatedExtensions, installedPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      `host ready signal does not prove an installed extension under ${extensionsDir}`,
    );
  }
  if (signaledWorkspace !== expectedWorkspace) {
    throw new Error(`host ready signal workspace mismatch: ${phase}`);
  }
  if (!isExactIsoTimestamp(value.readyAt)) {
    throw new Error(`host ready signal has no exact timestamp: ${phase}`);
  }
  return value;
}

function requireTextMarkers(filePath, markers) {
  const text = fs.readFileSync(filePath, "utf8");
  if (!text.trim()) throw new Error(`DOM evidence is empty: ${filePath}`);
  const missing = markers.filter((marker) => !text.includes(marker));
  if (missing.length > 0) {
    throw new Error(
      `DOM evidence ${path.basename(filePath)} is missing: ${missing.join(", ")}`,
    );
  }
}

function hasFixtureEvent(records, predicate) {
  return records.some((record) => {
    try {
      return predicate(record);
    } catch {
      return false;
    }
  });
}

/**
 * Fail-closed validation of the raw evidence produced by the two real hosts.
 * A DOM screenshot is best-effort across Electron versions; the DOM snapshot,
 * CDP action ledger, and independent fixture protocol ledger are mandatory.
 */
function assertJourneyArtifacts({
  artifactDir,
  fixtureTracePath,
  runtimeDir,
  extensionsDir,
  workspaceDir,
}) {
  const tracePath = path.join(artifactDir, "cdp-journey.jsonl");
  const cdpRecords = readJsonLines(tracePath);
  const failed = cdpRecords.find((record) => record.status === "failed");
  if (failed) {
    throw new Error(
      `CDP journey contains a failed record for ${failed.phase || "unknown phase"}`,
    );
  }
  for (const [phase, steps] of Object.entries(JOURNEY_PHASES)) {
    const targetRecord = cdpRecords.find(
      (record) => record.phase === phase && record.status === "target-found",
    );
    if (!targetRecord) {
      throw new Error(`CDP journey has no real webview target for ${phase}`);
    }
    if (
      typeof targetRecord.targetType !== "string" ||
      !targetRecord.targetType ||
      typeof targetRecord.targetUrl !== "string" ||
      !targetRecord.targetUrl
    ) {
      throw new Error(`CDP target identity is incomplete for ${phase}`);
    }
    for (const step of steps) {
      if (
        !cdpRecords.some(
          (record) =>
            record.phase === phase &&
            record.step === step &&
            record.status === "passed",
        )
      ) {
        throw new Error(`CDP journey step did not pass: ${phase}/${step}`);
      }
    }
    requireTextMarkers(
      path.join(artifactDir, `${phase}-dom.txt`),
      PHASE_DOM_MARKERS[phase],
    );
  }
  for (const phase of Object.keys(JOURNEY_PHASES)) {
    assertHostReadySignal({
      readyFile: path.join(runtimeDir, `${phase}-host-ready.json`),
      phase,
      extensionsDir,
      workspaceDir,
    });
    const result = readJourneyResult(
      path.join(runtimeDir, `${phase}-cdp-result.json`),
      phase,
    );
    if (!isExactIsoTimestamp(result.completedAt)) {
      throw new Error(`host journey result has no exact timestamp: ${phase}`);
    }
  }

  const fixtureRecords = readJsonLines(fixtureTracePath);
  const nativeTimeline = cdpRecords.some(
    (record) =>
      record.phase === "initial" && record.status === "native-workbench-found",
  );
  if (nativeTimeline) {
    const timelineReads = fixtureRecords.filter(
      (record) =>
        record.direction === "command" &&
        record.command === "checkpoint-timeline",
    ).length;
    if (timelineReads < REWIND_HOST_ACTIONS.length) {
      throw new Error(
        `fixture ledger proves only ${timelineReads} canonical timeline read(s)`,
      );
    }
    for (const action of REWIND_HOST_ACTIONS) {
      if (
        !cdpRecords.some(
          (record) =>
            record.phase === "initial" &&
            record.step === `rewind-${action.action}` &&
            record.status === "passed",
        )
      ) {
        throw new Error(`native rewind journey did not pass: ${action.action}`);
      }
      for (const mode of ["preview", "confirm"]) {
        if (
          !fixtureRecords.some(
            (record) =>
              record.direction === "command" &&
              record.command === "checkpoint-action" &&
              record.action === action.action &&
              record.mode === mode,
          )
        ) {
          throw new Error(
            `fixture ledger does not prove ${action.action}/${mode}`,
          );
        }
      }
    }
  }
  const requiredInbound = [
    (event) => event.type === "user" && event.text === "journey:stream",
    (event) => event.type === "plan" && event.action === "approve",
    (event) => event.type === "user" && event.text === "journey:permission",
    (event) => event.type === "approval" && event.approve === true,
    (event) => event.type === "user" && event.text === "journey:stop",
    (event) => event.type === "interrupt",
    (event) => event.type === "user" && event.text === "journey:resume",
  ];
  for (const predicate of requiredInbound) {
    if (
      !hasFixtureEvent(
        fixtureRecords,
        (record) => record.direction === "in" && predicate(record.event || {}),
      )
    ) {
      throw new Error(
        "fixture protocol ledger is missing a required UI action",
      );
    }
  }
  const streamSends = fixtureRecords.filter(
    (record) =>
      record.direction === "in" &&
      record.event?.type === "user" &&
      record.event?.text === "journey:stream",
  ).length;
  if (streamSends < 2) {
    throw new Error("fixture protocol ledger does not prove the retry action");
  }
  if (
    !hasFixtureEvent(
      fixtureRecords,
      (record) =>
        record.direction === "out" &&
        record.event?.type === "system" &&
        Number(record.event?.resumed_messages) >= 10,
    )
  ) {
    throw new Error("fixture protocol ledger does not prove restart/resume");
  }
  return {
    tracePath,
    fixtureTracePath,
    domPaths: Object.keys(JOURNEY_PHASES).map((phase) =>
      path.join(artifactDir, `${phase}-dom.txt`),
    ),
  };
}

async function runCdpHostJourney(options) {
  const {
    port,
    readyFile,
    resultFile,
    phase,
    artifactDir,
    timeoutMs = 120_000,
    signal = null,
    getBrowserWebSocketUrl = null,
    browserClient = null,
  } = options;
  if (
    !browserClient &&
    (!Number.isInteger(port) || port < 1 || port > 65_535)
  ) {
    throw new Error(`invalid loopback CDP port: ${port}`);
  }
  if (!Object.hasOwn(JOURNEY_PHASES, phase)) {
    throw new Error(`unknown CDP journey phase: ${phase}`);
  }
  fs.mkdirSync(artifactDir, { recursive: true });
  const tracePath = path.join(artifactDir, "cdp-journey.jsonl");
  let client;
  let workbenchClient;
  let failure;
  try {
    await waitForFile(readyFile, timeoutMs, signal);
    const located = await findChatWebview(
      port,
      timeoutMs,
      signal,
      tracePath,
      getBrowserWebSocketUrl,
      browserClient,
    );
    client = located.client;
    appendTrace(tracePath, {
      phase,
      status: "target-found",
      targetType: located.target.type,
      targetUrl: located.target.url,
    });
    if (phase === "initial" && !browserClient) {
      const workbench = await findWorkbenchWindow(
        port,
        timeoutMs,
        signal,
        getBrowserWebSocketUrl,
      );
      workbenchClient = workbench.client;
      appendTrace(tracePath, {
        phase,
        status: "native-workbench-found",
        targetType: workbench.target.type,
        targetUrl: workbench.target.url,
      });
    }
    await drivePhase(client, phase, tracePath, signal, workbenchClient);
    await captureWebview(client, artifactDir, phase);
    writeJsonSignal(resultFile, {
      ok: true,
      phase,
      completedAt: new Date().toISOString(),
    });
    return { ok: true, phase };
  } catch (error) {
    failure = error;
    appendTrace(tracePath, {
      phase,
      status: "failed",
      error: String(error && error.stack ? error.stack : error),
    });
    if (client) {
      try {
        await captureWebview(client, artifactDir, `${phase}-failed`);
      } catch {
        // retain the original failure
      }
    }
    try {
      writeJsonSignal(resultFile, {
        ok: false,
        phase,
        error: String(error.message || error),
        completedAt: new Date().toISOString(),
      });
    } catch (resultError) {
      failure = new AggregateError(
        [error, resultError],
        `CDP journey and result publication failed for ${phase}`,
      );
    }
  } finally {
    workbenchClient?.close();
    client?.close();
  }
  throw failure;
}

module.exports = {
  CdpClient,
  CHAT_WEBVIEW_PROBE,
  JOURNEY_PHASES,
  PHASE_DOM_MARKERS,
  assertHostReadySignal,
  assertJourneyArtifacts,
  buildCdpWebSocketOptions,
  createCdpPipeSocket,
  createFixtureCli,
  isExactIsoTimestamp,
  isInspectableBrowserTarget,
  findWorkbenchWindow,
  readJsonLines,
  readJourneyResult,
  reserveLoopbackPort,
  runCdpHostJourney,
  waitForFile,
  writeJsonSignal,
};
