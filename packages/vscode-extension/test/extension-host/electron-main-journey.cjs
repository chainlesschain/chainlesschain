"use strict";

/**
 * Test-only real-DOM driver that uses Electron's Node inspector to reach the
 * main-process `webContents` API. This avoids Chromium's browser-target
 * websocket while still evaluating and capturing the installed VSIX's real
 * Webview DOM.
 */

const fs = require("node:fs");
const path = require("node:path");
const {
  CdpClient,
  CHAT_WEBVIEW_PROBE,
  JOURNEY_PHASES,
  appendTrace,
  captureWebview,
  drivePhase,
  waitForFile,
  writeJsonSignal,
} = require("./cdp-journey.cjs");

function abortError(signal) {
  return new DOMException(
    String(signal?.reason?.message || signal?.reason || "operation aborted"),
    "AbortError",
  );
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal);
}

function delay(milliseconds, signal = null) {
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

function buildElectronInspectorWebSocketOptions(webSocketUrl) {
  const endpoint = new URL(webSocketUrl);
  if (
    endpoint.protocol !== "ws:" ||
    !["127.0.0.1", "[::1]", "::1"].includes(endpoint.hostname) ||
    !endpoint.port ||
    endpoint.pathname === "/" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error(
      `refusing non-loopback Electron inspector websocket: ${webSocketUrl}`,
    );
  }
  return {
    perMessageDeflate: false,
    handshakeTimeout: 8_000,
  };
}

function connectElectronInspector(webSocketUrl) {
  let WebSocketImpl;
  try {
    const ws = require("ws");
    WebSocketImpl = ws.WebSocket || ws;
  } catch (error) {
    throw new Error(
      "ws is required for the Electron main-process inspector journey",
      { cause: error },
    );
  }
  return CdpClient.connect(
    webSocketUrl,
    class LoopbackElectronInspectorWebSocket extends WebSocketImpl {
      constructor(url) {
        super(url, buildElectronInspectorWebSocketOptions(url));
      }
    },
  );
}

async function evaluateMain(inspector, expression) {
  const response = await inspector.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    includeCommandLineAPI: true,
  });
  if (response.exceptionDetails) {
    const details =
      response.exceptionDetails.exception?.description ||
      response.exceptionDetails.text ||
      "exception";
    throw new Error(`Electron main-process evaluation failed: ${details}`);
  }
  return response.result ? response.result.value : undefined;
}

function inspectWebContentsExpression() {
  return `(async () => {
    const { webContents } = require("electron");
    const entries = [];
    for (const contents of webContents.getAllWebContents()) {
      const entry = {
        id: contents.id,
        type: contents.getType(),
        url: contents.getURL(),
        destroyed: contents.isDestroyed(),
        probe: false,
      };
      if (!entry.destroyed) {
        try {
          entry.probe = Boolean(await contents.executeJavaScript(${JSON.stringify(
            `Boolean(${CHAT_WEBVIEW_PROBE})`,
          )}, true));
        } catch (error) {
          entry.error = String(error && error.message ? error.message : error);
        }
      }
      entries.push(entry);
    }
    return entries;
  })()`;
}

function webContentsEvaluationExpression(webContentsId, expression) {
  return `(async () => {
    const { webContents } = require("electron");
    const contents = webContents.fromId(${JSON.stringify(webContentsId)});
    if (!contents || contents.isDestroyed()) {
      throw new Error("Electron WebContents ${String(webContentsId)} is unavailable");
    }
    return await contents.executeJavaScript(${JSON.stringify(expression)}, true);
  })()`;
}

function webContentsScreenshotExpression(webContentsId) {
  return `(async () => {
    const { webContents } = require("electron");
    const contents = webContents.fromId(${JSON.stringify(webContentsId)});
    if (!contents || contents.isDestroyed()) {
      throw new Error("Electron WebContents ${String(webContentsId)} is unavailable");
    }
    const image = await contents.capturePage();
    return { data: image.toPNG().toString("base64") };
  })()`;
}

function createWebContentsClient(inspector, webContentsId) {
  if (!inspector || typeof inspector.send !== "function") {
    throw new Error("Electron inspector client is required");
  }
  if (!Number.isInteger(webContentsId) || webContentsId < 1) {
    throw new Error(`invalid Electron WebContents id: ${webContentsId}`);
  }
  return {
    evaluate(expression) {
      return evaluateMain(
        inspector,
        webContentsEvaluationExpression(webContentsId, expression),
      );
    },
    send(method) {
      if (method === "Page.enable") return Promise.resolve({});
      if (method === "Page.captureScreenshot") {
        return evaluateMain(
          inspector,
          webContentsScreenshotExpression(webContentsId),
        );
      }
      throw new Error(`unsupported Electron WebContents method: ${method}`);
    },
    close() {
      inspector.close();
    },
  };
}

async function waitForInspectorEndpoint(
  getInspectorWebSocketUrl,
  timeoutMs,
  signal = null,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    const endpoint = getInspectorWebSocketUrl?.();
    if (endpoint) return endpoint;
    await delay(50, signal);
  }
  throw new Error(
    `Electron main-process inspector endpoint did not appear within ${timeoutMs}ms`,
  );
}

async function findChatWebContents(
  inspector,
  timeoutMs,
  signal = null,
  tracePath = null,
) {
  const deadline = Date.now() + timeoutMs;
  let lastEntries = [];
  let lastSnapshot = "";
  let lastError;
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    try {
      const entries = await evaluateMain(
        inspector,
        inspectWebContentsExpression(),
      );
      if (!Array.isArray(entries)) {
        throw new Error("Electron WebContents scan returned a non-array value");
      }
      lastEntries = entries;
      const snapshot = JSON.stringify(lastEntries);
      if (tracePath && snapshot !== lastSnapshot) {
        appendTrace(tracePath, {
          status: "electron-webcontents-scan",
          webContents: lastEntries,
        });
        lastSnapshot = snapshot;
      }
      const match = lastEntries.find((entry) => entry.probe === true);
      if (match) {
        return {
          client: createWebContentsClient(inspector, match.id),
          target: match,
        };
      }
    } catch (error) {
      lastError = error;
    }
    await delay(100, signal);
  }
  throw new Error(
    `ChainlessChain chat webview was not found through Electron main-process inspection; webContents=${JSON.stringify(lastEntries.slice(-20))}; lastError=${String(lastError?.message || lastError || "none")}`,
    { cause: lastError },
  );
}

async function runElectronMainHostJourney(options) {
  const {
    getInspectorWebSocketUrl,
    readyFile,
    resultFile,
    phase,
    artifactDir,
    timeoutMs = 120_000,
    signal = null,
  } = options;
  if (!Object.hasOwn(JOURNEY_PHASES, phase)) {
    throw new Error(`unknown Electron main-process journey phase: ${phase}`);
  }
  fs.mkdirSync(artifactDir, { recursive: true });
  const tracePath = path.join(artifactDir, "cdp-journey.jsonl");
  let inspector;
  let client;
  let failure;
  try {
    await waitForFile(readyFile, timeoutMs, signal);
    const endpoint = await waitForInspectorEndpoint(
      getInspectorWebSocketUrl,
      10_000,
      signal,
    );
    inspector = await connectElectronInspector(endpoint);
    await inspector.send("Runtime.enable");
    const located = await findChatWebContents(
      inspector,
      timeoutMs,
      signal,
      tracePath,
    );
    client = located.client;
    appendTrace(tracePath, {
      phase,
      status: "target-found",
      targetType: `electron-${located.target.type}`,
      targetUrl: located.target.url,
      webContentsId: located.target.id,
    });
    await drivePhase(client, phase, tracePath, signal);
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
        // Retain the original journey failure.
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
        `Electron main-process journey and result publication failed for ${phase}`,
      );
    }
  } finally {
    if (client) client.close();
    else inspector?.close();
  }
  throw failure;
}

module.exports = {
  buildElectronInspectorWebSocketOptions,
  createWebContentsClient,
  evaluateMain,
  findChatWebContents,
  inspectWebContentsExpression,
  runElectronMainHostJourney,
  waitForInspectorEndpoint,
};
