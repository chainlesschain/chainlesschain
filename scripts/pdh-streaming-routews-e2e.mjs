/**
 * PDH streaming E2E via Playwright routeWebSocket.
 *
 * Bypasses the real cc backend (which needs bs3mc native binding rebuilt
 * for the workspace Node) by intercepting EVERY WS connection and
 * replying with fake-but-shape-correct frames. This validates that the
 * web-panel SPA bundle (the one cc ui serves) handles the streaming
 * protocol correctly end-to-end:
 *
 *   1. SPA dials WS
 *   2. SPA fires personal-data-hub.{health,stats,list-adapters,...}
 *   3. We reply with one MockAdapter so the table renders
 *   4. User-side: click 同步 on the mock row
 *   5. SPA fires personal-data-hub.sync-adapter-stream with a fresh id
 *   6. We reply with two `.event` frames then one `.end` carrying a
 *      complete SyncReport in `result`
 *   7. SPA's lastSync.value must be that report (NOT one of the
 *      `.event` envelopes — the original regression)
 *   8. Alert renders "同步 mock-stream: ok" + "events=8 persons=0 |
 *      raw=8 invalid=0 | KG triples=0 RAG docs=0 | 42ms"
 *
 * Run (with cc ui already running on 19700):
 *   node scripts/pdh-streaming-routews-e2e.mjs
 */

import { chromium } from "playwright";

const URL_BASE = process.env.PDH_E2E_URL || "http://127.0.0.1:19700/";

// Canonical SyncReport the mock returns on .end. Field-for-field
// matches the AdapterRegistry.syncAdapter contract.
const MOCK_REPORT = {
  adapter: "mock-stream",
  status: "ok",
  rawCount: 8,
  entityCounts: { events: 8, persons: 0, places: 0, items: 0, topics: 0 },
  invalidCount: 0,
  kgTripleCount: 0,
  ragDocCount: 0,
  durationMs: 42,
  error: null,
  watermark: "8",
};

const MOCK_ADAPTER_ROW = {
  name: "mock-stream",
  version: "1.0.0",
  capabilities: ["mock", "demo"],
  sensitivity: "low",
  legalGate: false,
};

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const pageLogs = [];
  page.on("console", (m) => pageLogs.push(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => pageLogs.push(`[pageerror] ${e.message}`));

  // Sniff page-level WS framesent so we know if SPA is even sending.
  page.on("websocket", (ws) => {
    pageLogs.push(`[ws-open] ${ws.url()}`);
    ws.on("framesent", (f) => pageLogs.push(`[ws-sent] ${String(f.payload).substring(0, 200)}`));
    ws.on("framereceived", (f) => pageLogs.push(`[ws-recv] ${String(f.payload).substring(0, 200)}`));
    ws.on("close", () => pageLogs.push(`[ws-close]`));
  });

  // Stats: count what's sent vs what we reply with so we can spot misses
  const reqLog = [];
  let lastSyncStreamId = null;

  // Intercept every WS the page opens. Use a permissive regex —
  // playwright globs don't always match ws:// schemes cleanly.
  let routeCount = 0;
  // NOTE: handler MUST be synchronous (no async) — otherwise Playwright
  // may buffer client-sent frames during the await window and we miss
  // the initial boot probes from the SPA's WS store.
  await page.routeWebSocket(/.*/, (route) => {
    const rid = ++routeCount;
    console.log(`[routeWebSocket #${rid}] fired, url:`, route.url());
    route.onClose(() => console.log(`[routeWebSocket #${rid}] CLOSED`));
    // Sit BETWEEN the SPA and origin. We don't forward to the real
    // server — we synthesize replies directly.
    const ws = route;
    const send = (obj) => ws.send(JSON.stringify(obj));

    ws.onMessage((data) => {
      const raw = typeof data === "string" ? data : data?.toString?.("utf8") || String(data);
      console.log(`[routeWebSocket #${rid}] inbound:`, raw.substring(0, 200));
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      reqLog.push({ type: msg.type, id: msg.id });

      const t = msg.type;
      const id = msg.id;

      // Boot probes
      if (t === "auth") return send({ id, type: "auth-success" });
      if (t === "ping") return send({ id, type: "pong", serverTime: Date.now() });
      // `execute` runs an arbitrary CLI command — for the boot mobile-bridge
      // probe (`p2p devices --type mobile --json`), return an empty array
      // shaped like the real CLI would so the SPA's MobileBridge poller
      // settles and doesn't busy-loop.
      if (t === "execute") {
        return send({ id, type: "command-result", output: "[]", stderr: "", exitCode: 0 });
      }

      // PDH boot calls — return shape-correct fixtures
      if (t === "personal-data-hub.health") {
        return send({ id, type: `${t}.response`, result: {
          vault: { ok: true }, llm: { ok: true, provider: "mock" },
          kgSink: { ok: true }, ragSink: { ok: true },
        }});
      }
      if (t === "personal-data-hub.stats") {
        return send({ id, type: `${t}.response`, result: {
          adapters: 1, events: 0, persons: 0, items: 0, places: 0, topics: 0,
        }});
      }
      if (t === "personal-data-hub.list-adapters") {
        return send({ id, type: `${t}.response`, result: [MOCK_ADAPTER_ROW] });
      }
      if (t === "personal-data-hub.resolver-stats") {
        return send({ id, type: `${t}.response`, result: { pending: 0, decided: 0 } });
      }
      if (t === "personal-data-hub.list-aichat-accounts") {
        return send({ id, type: `${t}.response`, result: [] });
      }
      if (t === "personal-data-hub.list-email-accounts") {
        return send({ id, type: `${t}.response`, result: [] });
      }
      if (t === "personal-data-hub.list-alipay-accounts") {
        return send({ id, type: `${t}.response`, result: [] });
      }
      if (t === "personal-data-hub.recent-audit") {
        return send({ id, type: `${t}.response`, result: [] });
      }

      // The streaming sync — THE THING WE'RE TESTING
      if (t === "personal-data-hub.sync-adapter-stream") {
        lastSyncStreamId = id;
        // Emit two .event frames then .end. Mirrors what the real
        // registry would push (registry emits sync.start, then
        // ingest-batch progress, then sync.ok).
        setTimeout(() => send({ id, type: `${t}.event`, event: {
          kind: "sync.start", adapter: msg.name, scope: "", sinceWatermark: null,
        }}), 50);
        setTimeout(() => send({ id, type: `${t}.event`, event: {
          kind: "sync.ok", adapter: msg.name, rawCount: 8,
        }}), 150);
        setTimeout(() => send({ id, type: `${t}.end`, result: MOCK_REPORT }), 250);
        return;
      }

      // Any other PDH topic — generic empty response so we don't break
      // unrelated page init.
      if (t && t.startsWith("personal-data-hub.")) {
        return send({ id, type: `${t}.response`, result: null });
      }

      // Default: keep silent. SPA probably has a timeout but most boot
      // probes are best-effort.
    });

    // SPA expects the connection to "open" before sending; routeWebSocket
    // gives us a connected handle implicitly when we don't call
    // route.connectToServer(). Send a hello-style frame is unnecessary.
  });

  // Tiny dwell — routeWebSocket needs a moment for internal IPC plumbing
  // to settle, otherwise the FIRST connection occasionally races and the
  // boot frames are dropped.
  await page.waitForTimeout(500);

  // Navigate
  const url = new URL("#/personal-data-hub", URL_BASE).href;
  console.log("→ navigate", url);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });

  // Wait until the adapter table is populated (which happens after boot
  // probes complete + listAdapters returns + Vue re-renders). Polling is
  // tighter than fixed sleep for this kind of multi-step boot.
  console.log("→ wait for adapter row");
  await page.waitForFunction(
    () => document.querySelectorAll("tr.ant-table-row").length > 0,
    { timeout: 15_000 },
  ).catch((e) => console.log("   (timed out:", e.message + ")"));

  // Dump WS status + console pre-click
  const preState = await page.evaluate(() => {
    const text = document.body.textContent || "";
    return {
      连接count: (text.match(/已连接/g) || []).length,
      未连接count: (text.match(/未连接/g) || []).length,
      断开count: (text.match(/断开/g) || []).length,
      bodyLen: text.length,
      appChildren: document.getElementById("app")?.children?.length || 0,
      routePathInUrl: window.location.hash,
      hasAdapterCol: !!document.querySelector("th"),
      tableRows: document.querySelectorAll("tr.ant-table-row").length,
      emptyMsg: document.querySelector(".ant-empty-description")?.textContent || null,
    };
  });
  console.log("→ pre-click state:", JSON.stringify(preState, null, 2));
  console.log("→ ALL page logs (count " + pageLogs.length + "):");
  for (const l of pageLogs) console.log("  ", l);

  // Probe the ws state directly via Pinia's __pinia globally exposed in DEV
  // (or via the app's exposed instance if any). Since Pinia 2 doesn't auto-
  // expose, we instead try to find the socket by enumerating sockets via
  // any global hint. Failing that, just try calling sendRaw manually.
  const wsProbe = await page.evaluate(async () => {
    // Try to manually create a WebSocket and see if routeWebSocket
    // intercepts that one (testing if interception is even working).
    return new Promise((resolve) => {
      try {
        const ws = new WebSocket("ws://127.0.0.1:19701/probe");
        const result = { ctor: "ok", urls: ws.url };
        ws.onopen = () => {
          result.openedAt = Date.now();
          ws.send(JSON.stringify({ type: "manual-probe", id: "probe-1" }));
          result.sent = true;
        };
        ws.onmessage = (e) => { result.recv = String(e.data).substring(0, 100); resolve(result); };
        ws.onerror = () => { result.error = true; resolve(result); };
        ws.onclose = () => { result.closed = true; resolve(result); };
        setTimeout(() => resolve(result), 1500);
      } catch (e) {
        resolve({ error: e.message });
      }
    });
  });
  console.log("→ manual ws probe:", JSON.stringify(wsProbe));

  // Click 同步 on the mock row
  console.log("→ click 同步 on mock-stream row");
  const clicked = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("tr.ant-table-row"));
    for (const row of rows) {
      const name = (row.querySelector("td")?.textContent || "").trim();
      if (name === "mock-stream" || name.startsWith("mock-stream")) {
        const buttons = Array.from(row.querySelectorAll("button"));
        const btnStates = buttons.map((b) => ({
          text: (b.textContent || "").trim(),
          disabledProp: b.disabled,
          ariaDisabled: b.getAttribute("aria-disabled"),
          classList: b.className,
        }));
        // Click any button whose normalized text starts with "同步".
        // Ant Design auto-injects a space between adjacent CJK chars so
        // the DOM text is "同 步", not "同步" — normalize by stripping
        // whitespace before comparing.
        const target = buttons.find((b) => {
          const t = (b.textContent || "").replace(/\s+/g, "");
          return t === "同步";
        });
        if (target) { target.click(); return { ok: true, name, btnStates }; }
        return { ok: false, name, reason: "no 同步 btn", btnStates };
      }
    }
    return { ok: false, reason: "no mock-stream row", rowCount: rows.length };
  });
  console.log("   →", JSON.stringify(clicked));
  if (!clicked.ok) {
    // Dump table for diagnosis
    const dump = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("tr.ant-table-row"));
      return rows.map((r) => ({
        cells: Array.from(r.querySelectorAll("td")).slice(0,2).map((c) => c.textContent.trim()),
      }));
    });
    console.log("   table dump:", JSON.stringify(dump));
    console.log("   req log:", JSON.stringify(reqLog, null, 2));
    await browser.close();
    process.exitCode = 1;
    return;
  }

  // Wait for the sync alert
  await page.waitForTimeout(2500);

  const alert = await page.evaluate(() => {
    const al = document.querySelector(".ant-alert-success, .ant-alert-error");
    if (!al) return null;
    const msg = al.querySelector(".ant-alert-message")?.textContent || "";
    const desc = al.querySelector(".ant-alert-description")?.textContent || "";
    const isSuccess = al.classList.contains("ant-alert-success");
    return { type: isSuccess ? "success" : "error", message: msg, description: desc };
  });

  console.log("\n=== Sync alert ===");
  console.log(JSON.stringify(alert, null, 2));
  console.log("\n=== WS req log ===");
  for (const r of reqLog) console.log(" ", JSON.stringify(r));
  console.log("\nlastSyncStreamId =", lastSyncStreamId);

  // Verdict
  let verdict = "✅ PASS";
  const failures = [];
  if (!alert) failures.push("alert never rendered");
  else {
    if (alert.message.includes("undefined")) failures.push("alert.message has undefined");
    if (alert.type !== "success") failures.push(`alert is ${alert.type}, expected success`);
    if (!alert.message.includes("mock-stream")) failures.push("alert.message missing adapter name");
    if (!alert.message.includes("ok")) failures.push("alert.message missing status");
    if (!alert.description.includes("42ms")) failures.push("alert.description missing 42ms");
    if (!alert.description.includes("events=8")) failures.push("alert.description missing events=8");
  }
  if (!lastSyncStreamId) failures.push("server never received sync-adapter-stream");

  if (failures.length) verdict = "❌ FAIL: " + failures.join("; ");
  console.log("\n=== Verdict ===\n" + verdict);

  await browser.close();
  if (failures.length) process.exitCode = 1;
}

main().catch((e) => { console.error("FATAL:", e); process.exitCode = 1; });
