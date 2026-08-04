"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
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

function buildPlaywrightHostArgs({
  workspaceDir,
  profileArgs,
  extensionDevelopmentPath,
  extensionTestsPath,
}) {
  return [
    workspaceDir,
    ...profileArgs,
    "--no-sandbox",
    "--disable-gpu-sandbox",
    "--disable-updates",
    "--skip-welcome",
    "--skip-release-notes",
    "--no-cached-data",
    "--disable-workspace-trust",
    "--disable-extension-update-checks",
    "--disable-telemetry",
    "--disable-crash-reporter",
    "--enable-smoke-test-driver",
    `--extensionTestsPath=${extensionTestsPath}`,
    `--extensionDevelopmentPath=${extensionDevelopmentPath}`,
  ];
}

function describeFrames(electronApp) {
  return electronApp.windows().flatMap((page, pageIndex) =>
    page.frames().map((frame) => ({
      pageIndex,
      name: frame.name(),
      url: frame.url(),
    })),
  );
}

function createPlaywrightDomClient(frame, page) {
  return {
    evaluate(expression) {
      return frame.evaluate(expression);
    },
    async send(method) {
      if (method === "Page.enable") return {};
      if (method === "Page.captureScreenshot") {
        const data = await frame.locator("body").screenshot({ type: "png" });
        return { data: data.toString("base64") };
      }
      throw new Error(`unsupported Playwright DOM client method: ${method}`);
    },
    close() {},
    page,
  };
}

async function findChatWebviewFrame(
  electronApp,
  timeoutMs,
  signal = null,
  tracePath = null,
) {
  const deadline = Date.now() + timeoutMs;
  let lastFrames = [];
  let lastSnapshot = "";
  let lastError;
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    lastFrames = describeFrames(electronApp);
    const snapshot = JSON.stringify(lastFrames);
    if (tracePath && snapshot !== lastSnapshot) {
      appendTrace(tracePath, {
        status: "playwright-frame-snapshot",
        frames: lastFrames,
      });
      lastSnapshot = snapshot;
    }
    for (const page of electronApp.windows()) {
      for (const frame of page.frames()) {
        try {
          const isChat = await frame.evaluate(
            "Boolean(document.querySelector('#input') && document.querySelector('#send') && document.querySelector('#stop'))",
          );
          if (isChat) {
            return {
              client: createPlaywrightDomClient(frame, page),
              target: { type: "playwright-frame", url: frame.url() },
            };
          }
        } catch (error) {
          lastError = error;
        }
      }
    }
    await delay(100, signal);
  }
  throw new Error(
    `ChainlessChain chat webview was not found through Playwright; frames=${JSON.stringify(lastFrames.slice(-20))}; lastError=${String(lastError?.message || lastError || "none")}`,
    { cause: lastError },
  );
}

async function runPlaywrightHostJourney(options) {
  const {
    electronApp,
    readyFile,
    resultFile,
    phase,
    artifactDir,
    timeoutMs = 120_000,
    signal = null,
  } = options;
  if (!electronApp || typeof electronApp.windows !== "function") {
    throw new Error("Playwright Electron application is required");
  }
  if (!Object.hasOwn(JOURNEY_PHASES, phase)) {
    throw new Error(`unknown Playwright journey phase: ${phase}`);
  }
  fs.mkdirSync(artifactDir, { recursive: true });
  // Keep the established filename so the immutable evidence verifier and the
  // Windows/macOS artifacts retain one cross-platform schema. Playwright's
  // Electron transport is CDP-backed; the records identify the exact mode.
  const tracePath = path.join(artifactDir, "cdp-journey.jsonl");
  let client;
  let failure;
  try {
    await waitForFile(readyFile, timeoutMs, signal);
    const located = await findChatWebviewFrame(
      electronApp,
      timeoutMs,
      signal,
      tracePath,
    );
    client = located.client;
    appendTrace(tracePath, {
      phase,
      status: "target-found",
      targetType: located.target.type,
      targetUrl: located.target.url,
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
        `Playwright journey and result publication failed for ${phase}`,
      );
    }
  } finally {
    client?.close();
  }
  throw failure;
}

module.exports = {
  buildPlaywrightHostArgs,
  createPlaywrightDomClient,
  describeFrames,
  findChatWebviewFrame,
  runPlaywrightHostJourney,
};
