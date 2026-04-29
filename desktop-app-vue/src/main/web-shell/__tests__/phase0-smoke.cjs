/**
 * Phase 0 end-to-end smoke. Not part of the vitest suite — run with:
 *   node src/main/web-shell/__tests__/phase0-smoke.cjs
 *
 * Mirrors what main/index.js does in WEB_SHELL_MODE: starts the bootstrap,
 * fetches the SPA, asks ukey.status over WS, then tears down. Useful as a
 * one-shot validation that the integration code path actually works without
 * launching Electron.
 */

const path = require("path");
const WebSocket = require("ws");
const {
  startWebShell,
} = require(path.resolve(__dirname, "..", "web-shell-bootstrap.js"));

(async () => {
  const handle = await startWebShell({
    mode: "global",
    projectName: "ChainlessChain Desktop",
    ukeyManager: {
      async detect() {
        return {
          detected: false,
          unlocked: false,
          simulationMode: process.platform !== "win32",
        };
      },
    },
  });
  console.log("[smoke] HTTP url:", handle.httpUrl);
  console.log("[smoke] WS   url:", handle.wsUrl);

  const indexRes = await fetch(handle.httpUrl);
  const html = await indexRes.text();
  console.log(
    "[smoke] index.html status:",
    indexRes.status,
    "size:",
    html.length,
  );
  console.log(
    "[smoke] __CC_CONFIG__ injected:",
    html.includes("window.__CC_CONFIG__"),
  );
  console.log(
    "[smoke] wsPort matches:",
    html.includes(`"wsPort":${handle.wsPort}`),
  );
  console.log(
    "[smoke] placeholder gone:",
    !html.includes("__CC_CONFIG_PLACEHOLDER__"),
  );

  const m = html.match(/\/assets\/[A-Za-z0-9_.\-]+\.js/);
  if (m) {
    const assetRes = await fetch(
      handle.httpUrl.replace(/\/$/, "") + m[0],
    );
    const buf = await assetRes.arrayBuffer();
    console.log(
      "[smoke] asset:",
      m[0],
      "status:",
      assetRes.status,
      "bytes:",
      buf.byteLength,
      "mime:",
      assetRes.headers.get("content-type"),
    );
  }

  const dashRes = await fetch(handle.httpUrl + "dashboard");
  console.log("[smoke] /dashboard SPA fallback status:", dashRes.status);

  const ws = new WebSocket(handle.wsUrl);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  const reply = await new Promise((resolve, reject) => {
    ws.once("message", (raw) => resolve(JSON.parse(raw.toString())));
    ws.once("error", reject);
    ws.send(JSON.stringify({ type: "ukey.status", id: "smoke-1" }));
  });
  console.log("[smoke] ukey.status reply:", JSON.stringify(reply));
  ws.close();

  await handle.close();
  console.log("[smoke] DONE — Phase 0 end-to-end verified");
})().catch((err) => {
  console.error("[smoke] FAIL:", err.message);
  console.error(err.stack);
  process.exit(1);
});
