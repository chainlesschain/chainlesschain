import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import {
  MCPClient,
  _deps as mcpClientDeps,
} from "../src/harness/mcp-client.js";
import {
  MCP_HEADERS_HELPER_MAX_HEADER_COUNT,
  MCP_HEADERS_HELPER_MAX_HEADER_VALUE_BYTES,
  MCP_HEADERS_HELPER_MAX_OUTPUT_BYTES,
  MCP_HEADERS_HELPER_TIMEOUT_MS,
} from "../src/lib/mcp-headers-helper.js";
import {
  McpLifecycleAuthority,
  MCP_LIFECYCLE_AUTHORITY_LIMITS,
} from "../src/lib/mcp-lifecycle-authority.js";
import {
  loadMcpTlsMaterial,
  provisionManagedMcpTlsConfig,
} from "../src/lib/mcp-tls.js";
import * as oauth from "../src/lib/mcp-oauth.js";
import {
  parseMcpServers,
  setupMcpFromConfig,
} from "../src/runtime/mcp-config.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = path.resolve(SCRIPT_DIR, "..");
const RESTART_CHILD_PATH = path.join(
  SCRIPT_DIR,
  "mcp-lifecycle-profile-child.mjs",
);
export const MCP_LIFECYCLE_PROFILE_VERSION =
  "claude-2.1.229-238-mcp-lifecycle/v2";
const RECOVERY_LATENCY_LIMIT_MS = 5_000;
const WAIT_LIMIT_MS = 5_000;
const SECRET_CANARIES = Object.freeze([
  "mcp-old-access-token-canary",
  "mcp-fresh-access-token-canary",
  "oauth-old-access-token-canary",
  "oauth-rotated-access-token-canary",
  "oauth-resurrected-access-token-canary",
  "oauth-refresh-token-canary",
]);

export const MCP_LIFECYCLE_PROFILE_TEST_IDS = Object.freeze([
  "mcp-lifecycle/disabled-outbound-count-zero",
  "mcp-lifecycle/initialize-before-discover-exact-order",
  "mcp-lifecycle/malformed-response-fail-fast",
  "mcp-lifecycle/unsupported-version-fail-fast",
  "mcp-lifecycle/oauth-expire-single-refresh",
  "mcp-lifecycle/oauth-revocation-cas-fence",
  "mcp-lifecycle/oauth-idp-revoke-tombstone",
  "mcp-lifecycle/mtls-identity-rotation",
  "mcp-lifecycle/mtls-invalid-material-no-dial",
  "mcp-lifecycle/v2-subscription-hot-reconnect",
  "mcp-lifecycle/cross-process-restart-takeover",
  "mcp-lifecycle/inflight-restart-failed-closed",
  "mcp-lifecycle/reconnect-single-flight-no-storm",
  "mcp-lifecycle/callback-generation-fence",
  "mcp-lifecycle/duplicate-callback-fence",
  "mcp-lifecycle/diagnostic-secret-hits-zero",
  "mcp-lifecycle/helper-hard-limits",
]);

export const MCP_LIFECYCLE_PROFILE_THRESHOLDS = Object.freeze({
  disabledOutboundCount: 0,
  rpcOrderExact: true,
  authenticationRefreshesPerRejection: 1,
  reconnectFlightsPerServer: 1,
  maxRecoveryLatencyMs: RECOVERY_LATENCY_LIMIT_MS,
  duplicateCallbacksAccepted: 0,
  staleCallbacksAccepted: 0,
  lostCallbacks: 0,
  revokedTokenResurrections: 0,
  invalidTlsOutboundCount: 0,
  logSecretHits: 0,
  helperTimeoutMs: 10_000,
  helperMaxOutputBytes: 64 * 1024,
  helperMaxHeaders: 128,
  helperMaxHeaderValueBytes: 16 * 1024,
});

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function derLength(length) {
  assert.ok(Number.isSafeInteger(length) && length >= 0);
  if (length < 0x80) return Buffer.from([length]);
  const bytes = [];
  for (let remaining = length; remaining > 0; remaining >>>= 8) {
    bytes.unshift(remaining & 0xff);
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function der(tag, ...parts) {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), derLength(body.length), body]);
}

function derOid(value) {
  const arcs = String(value).split(".").map(Number);
  assert.ok(arcs.length >= 2 && arcs[0] >= 0 && arcs[0] <= 2);
  const values = [arcs[0] * 40 + arcs[1], ...arcs.slice(2)];
  const bytes = [];
  for (const valuePart of values) {
    assert.ok(Number.isSafeInteger(valuePart) && valuePart >= 0);
    const encoded = [valuePart & 0x7f];
    for (let remaining = valuePart >>> 7; remaining > 0; remaining >>>= 7) {
      encoded.unshift(0x80 | (remaining & 0x7f));
    }
    bytes.push(...encoded);
  }
  return der(0x06, Buffer.from(bytes));
}

function derInteger(bytes) {
  let value = Buffer.from(bytes);
  while (value.length > 1 && value[0] === 0 && (value[1] & 0x80) === 0) {
    value = value.subarray(1);
  }
  if ((value[0] & 0x80) !== 0) value = Buffer.concat([Buffer.from([0]), value]);
  return der(0x02, value);
}

function derName(commonName) {
  return der(
    0x30,
    der(
      0x31,
      der(0x30, derOid("2.5.4.3"), der(0x0c, Buffer.from(commonName, "utf8"))),
    ),
  );
}

function utcTime(value) {
  const year = value.getUTCFullYear();
  assert.ok(year >= 1950 && year <= 2049);
  const stamp = [
    String(year % 100).padStart(2, "0"),
    String(value.getUTCMonth() + 1).padStart(2, "0"),
    String(value.getUTCDate()).padStart(2, "0"),
    String(value.getUTCHours()).padStart(2, "0"),
    String(value.getUTCMinutes()).padStart(2, "0"),
    String(value.getUTCSeconds()).padStart(2, "0"),
    "Z",
  ].join("");
  return der(0x17, Buffer.from(stamp, "ascii"));
}

function pem(label, bytes) {
  const body =
    bytes
      .toString("base64")
      .match(/.{1,64}/gu)
      ?.join("\n") || "";
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

function createEphemeralClientIdentity(commonName) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicExponent: 0x10001,
  });
  const algorithm = der(0x30, derOid("1.2.840.113549.1.1.11"), der(0x05));
  const now = Date.now();
  const name = derName(commonName);
  const serial = crypto.randomBytes(16);
  serial[0] &= 0x7f;
  if (serial.every((byte) => byte === 0)) serial[serial.length - 1] = 1;
  const tbs = der(
    0x30,
    derInteger(serial),
    algorithm,
    name,
    der(
      0x30,
      utcTime(new Date(now - 24 * 60 * 60 * 1_000)),
      utcTime(new Date(now + 365 * 24 * 60 * 60 * 1_000)),
    ),
    name,
    publicKey.export({ type: "spki", format: "der" }),
  );
  const signature = crypto.sign("sha256", tbs, privateKey);
  const certificate = der(
    0x30,
    tbs,
    algorithm,
    der(0x03, Buffer.concat([Buffer.from([0]), signature])),
  );
  return {
    cert: pem("CERTIFICATE", certificate),
    key: privateKey.export({ type: "pkcs8", format: "pem" }),
  };
}

function responseEnvelope(id, result) {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}

function jsonResponse(response, id, result, status = 200, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json",
    ...headers,
  });
  response.end(id == null ? "" : responseEnvelope(id, result));
}

async function readRequestJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    assert.ok(bytes <= 1024 * 1024, "profile request body exceeded 1 MiB");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : null;
}

function waitFor(predicate, label, timeoutMs = WAIT_LIMIT_MS) {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) {
        resolve(performance.now() - started);
        return;
      }
      if (performance.now() - started >= timeoutMs) {
        reject(new Error(`timed out waiting for ${label}`));
        return;
      }
      setTimeout(poll, 5).unref?.();
    };
    poll();
  });
}

function runRestartChild({ statePath, serverUrl, sessionId, name }) {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [
        RESTART_CHILD_PATH,
        "--state-path",
        statePath,
        "--server-url",
        serverUrl,
        "--session-id",
        sessionId,
        "--name",
        name,
      ],
      {
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
        timeout: 15_000,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `MCP lifecycle restart child failed: ${String(stderr || error.message).slice(0, 2_000)}`,
            ),
          );
          return;
        }
        try {
          resolve(JSON.parse(String(stdout || "").trim()));
        } catch {
          reject(
            new Error("MCP lifecycle restart child returned invalid JSON"),
          );
        }
      },
    );
  });
}

async function createLifecycleServer() {
  const state = {
    requests: [],
    outboundCount: 0,
    initializeCount: 0,
    oldToolResponses: [],
    heldToolResponses: [],
    tokenRequests: 0,
    heldTokenResponses: [],
    rejectOldToolCalls: false,
    holdToolCalls: false,
    holdTokenRefresh: false,
    rejectRefreshGrant: false,
  };
  const server = http.createServer(async (request, response) => {
    state.outboundCount += 1;
    if (request.url === "/oauth/token") {
      state.tokenRequests += 1;
      await readRequestJson(request).catch(() => null);
      if (state.rejectRefreshGrant) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "invalid_grant" }));
        return;
      }
      if (state.holdTokenRefresh) {
        state.heldTokenResponses.push(response);
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          access_token: "oauth-rotated-access-token-canary",
          refresh_token: "oauth-refresh-token-canary",
          expires_in: 3600,
        }),
      );
      return;
    }
    if (request.method === "DELETE") {
      jsonResponse(response, null, null, 202);
      return;
    }
    const envelope = await readRequestJson(request);
    if (!envelope || typeof envelope !== "object") {
      jsonResponse(response, null, null, 400);
      return;
    }
    let generation = Number(
      String(request.headers["mcp-session-id"] || "").replace(
        /^profile-session-/u,
        "",
      ),
    );
    if (envelope.method === "initialize") {
      state.initializeCount += 1;
      generation = state.initializeCount;
    }
    state.requests.push({
      generation: Number.isSafeInteger(generation) ? generation : 0,
      method: envelope.method,
      requestId: envelope.id ?? null,
      profileCase: request.url?.startsWith("/mcp-malformed")
        ? "malformed"
        : request.url?.startsWith("/mcp-unsupported-version")
          ? "unsupported-version"
          : "normal",
      authGeneration:
        request.headers.authorization === "Bearer mcp-fresh-access-token-canary"
          ? "fresh"
          : request.headers.authorization ===
              "Bearer mcp-old-access-token-canary"
            ? "old"
            : "none",
    });
    if (envelope.id == null) {
      jsonResponse(response, null, null, 202);
      return;
    }
    const sessionHeaders = {
      "mcp-session-id": `profile-session-${generation}`,
    };
    switch (envelope.method) {
      case "initialize": {
        if (request.url?.startsWith("/mcp-malformed")) {
          response.writeHead(200, {
            "content-type": "application/json",
            ...sessionHeaders,
          });
          response.end('{"jsonrpc":"2.0","id":');
          return;
        }
        jsonResponse(
          response,
          envelope.id,
          {
            protocolVersion: request.url?.startsWith("/mcp-unsupported-version")
              ? "2099-12-31"
              : "2025-11-25",
            capabilities: { tools: {}, resources: { subscribe: true } },
            serverInfo: { name: "mcp-lifecycle-profile" },
          },
          200,
          sessionHeaders,
        );
        return;
      }
      case "tools/list":
        jsonResponse(response, envelope.id, {
          tools: [
            {
              name: "echo",
              description: "profile echo",
              inputSchema: { type: "object" },
            },
          ],
        });
        return;
      case "resources/list":
        jsonResponse(response, envelope.id, { resources: [] });
        return;
      case "resources/templates/list":
        jsonResponse(response, envelope.id, { resourceTemplates: [] });
        return;
      case "prompts/list":
        jsonResponse(response, envelope.id, { prompts: [] });
        return;
      case "resources/subscribe":
      case "resources/unsubscribe":
        jsonResponse(response, envelope.id, {});
        return;
      case "tools/call": {
        if (
          state.rejectOldToolCalls &&
          request.headers.authorization === "Bearer mcp-old-access-token-canary"
        ) {
          state.rejectOldToolCalls = false;
          jsonResponse(response, null, null, 401);
          return;
        }
        if (state.holdToolCalls && envelope.params?.arguments?.hold === true) {
          state.heldToolResponses.push({ response, id: envelope.id });
          return;
        }
        jsonResponse(response, envelope.id, {
          content: [{ type: "text", text: "ok" }],
        });
        return;
      }
      default:
        jsonResponse(response, envelope.id, {});
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    state,
    server,
    url: `http://127.0.0.1:${address.port}/mcp`,
    malformedUrl: `http://127.0.0.1:${address.port}/mcp-malformed`,
    unsupportedVersionUrl: `http://127.0.0.1:${address.port}/mcp-unsupported-version`,
    tokenUrl: `http://127.0.0.1:${address.port}/oauth/token`,
    async close() {
      for (const pending of state.oldToolResponses.splice(0)) {
        pending.destroy();
      }
      for (const pending of state.heldToolResponses.splice(0)) {
        pending.response.destroy();
      }
      for (const pending of state.heldTokenResponses.splice(0)) {
        pending.destroy();
      }
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function assertDiscoveryOrder(requests) {
  const expected = [
    "initialize",
    "tools/list",
    "resources/list",
    "resources/templates/list",
    "prompts/list",
  ];
  const generations = new Set(
    requests
      .filter((request) => request.method === "initialize")
      .map((request) => request.generation),
  );
  for (const generation of generations) {
    const methods = requests
      .filter(
        (request) =>
          request.generation === generation &&
          request.method !== "notifications/initialized",
      )
      .map((request) => request.method);
    assert.deepEqual(
      methods.slice(0, expected.length),
      expected,
      `generation ${generation} discovery order`,
    );
    const subscribeIndex = methods.indexOf("resources/subscribe");
    if (subscribeIndex >= 0) {
      assert.ok(
        subscribeIndex >= expected.length,
        `generation ${generation} subscribed before discovery settled`,
      );
    }
  }
  return true;
}

async function runTransportScenario({ root, server }) {
  const statePath = path.join(root, "lifecycle-authority.json");
  const authority = new McpLifecycleAuthority({ statePath });
  const sessionId = "mcp-lifecycle-profile-session";

  const beforeDisabled = server.state.outboundCount;
  const disabledResult = await setupMcpFromConfig(
    parseMcpServers({
      mcpServers: {
        disabled: { url: server.url, transport: "http", disabled: true },
      },
    }),
    { mcpLifecycleAuthority: authority, sessionId },
  );
  assert.deepEqual(disabledResult.connected, []);
  const disabledOutboundCount = server.state.outboundCount - beforeDisabled;
  assert.equal(disabledOutboundCount, 0);

  const oldConfig = {
    url: server.url,
    transport: "http",
    headers: {
      Authorization: "Bearer mcp-old-access-token-canary",
    },
  };
  const freshConfig = {
    ...oldConfig,
    headers: {
      Authorization: "Bearer mcp-fresh-access-token-canary",
    },
  };
  const clients = [];
  let reconnectResolverCalls = 0;
  let authenticationRefreshesPerRejection = 0;
  let reconnectFlightsPerServer = 0;
  let hotReconnectLatencyMs = 0;
  let restartRecoveryLatencyMs = 0;
  let inFlightRestartLatencyMs = 0;
  let crossProcessRestartLatencyMs = 0;
  try {
    const first = new MCPClient({
      sessionId,
      lifecycleAuthority: authority,
    });
    clients.push(first);
    await first.connect("profile", oldConfig);
    await first.subscribeResource("profile", "res://profile/watched");
    first.setReconnector("profile", async () => {
      reconnectResolverCalls += 1;
      return freshConfig;
    });
    server.state.rejectOldToolCalls = true;
    const reconnectStarted = performance.now();
    const result = await first.callTool("profile", "echo", { request: 1 });
    hotReconnectLatencyMs = performance.now() - reconnectStarted;
    assert.ok(result);
    authenticationRefreshesPerRejection = reconnectResolverCalls;
    assert.equal(authenticationRefreshesPerRejection, 1);
    assert.equal(server.state.initializeCount, 2);

    const reconnectsBeforeNoStorm = reconnectResolverCalls;
    const initializesBeforeNoStorm = server.state.initializeCount;
    const noStormResults = await Promise.all([
      first._tryReconnect("profile"),
      first._tryReconnect("profile"),
    ]);
    assert.deepEqual(noStormResults, [true, true]);
    reconnectFlightsPerServer =
      reconnectResolverCalls - reconnectsBeforeNoStorm;
    assert.equal(reconnectFlightsPerServer, 1);
    assert.equal(server.state.initializeCount - initializesBeforeNoStorm, 1);

    const secondAuthority = new McpLifecycleAuthority({ statePath });
    const second = new MCPClient({
      sessionId,
      lifecycleAuthority: secondAuthority,
    });
    clients.push(second);
    const restartStarted = performance.now();
    await second.connect("profile", freshConfig);
    restartRecoveryLatencyMs = performance.now() - restartStarted;
    assert.ok(
      second.servers
        .get("profile")
        ?.resourceSubscriptions?.has("res://profile/watched"),
    );

    const outboundBeforeFence = server.state.outboundCount;
    await assert.rejects(
      first.callTool("profile", "echo", { stale: true }),
      (error) => error?.code === "CC_MCP_LIFECYCLE_FENCED",
    );
    assert.equal(server.state.outboundCount, outboundBeforeFence);

    server.state.holdToolCalls = true;
    const heldCall = second.callTool("profile", "echo", { hold: true });
    const heldOutcome = heldCall.then(
      () => ({ status: "fulfilled" }),
      (error) => ({ status: "rejected", error }),
    );
    await waitFor(
      () => server.state.heldToolResponses.length === 1,
      "in-flight MCP tool request",
    );
    const crossProcessRestartStarted = performance.now();
    const childTakeover = await runRestartChild({
      statePath,
      serverUrl: server.url,
      sessionId,
      name: "profile",
    });
    assert.equal(childTakeover.phase, "ready");
    assert.deepEqual(childTakeover.subscriptions, ["res://profile/watched"]);
    assert.ok(childTakeover.rpcRecoveredAfterRestart >= 1);
    crossProcessRestartLatencyMs =
      performance.now() - crossProcessRestartStarted;
    const thirdAuthority = new McpLifecycleAuthority({ statePath });
    const third = new MCPClient({
      sessionId,
      lifecycleAuthority: thirdAuthority,
    });
    clients.push(third);
    const inFlightRestartStarted = performance.now();
    await third.connect("profile", freshConfig);
    inFlightRestartLatencyMs = performance.now() - inFlightRestartStarted;

    for (const pending of server.state.heldToolResponses.splice(0)) {
      if (!pending.response.destroyed) {
        jsonResponse(pending.response, pending.id, {
          content: [{ type: "text", text: "late" }],
        });
      }
    }
    const settledHeldCall = await heldOutcome;
    assert.equal(settledHeldCall.status, "rejected");
    assert.equal(settledHeldCall.error?.code, "CC_MCP_LIFECYCLE_FENCED");
    await second.disconnectAll();

    const thirdEntry = third.servers.get("profile");
    third._handleMessage(
      "profile",
      {
        jsonrpc: "2.0",
        id: third._nextId - 1,
        result: {},
      },
      thirdEntry,
    );

    const snapshot = thirdAuthority.snapshot({ name: "profile", sessionId });
    assert.ok(snapshot);
    assert.equal(snapshot.pendingRpc.length, 0);
    assert.equal(snapshot.metrics.lostCallbacks, 0);
    assert.equal(snapshot.metrics.duplicateCallbacksAccepted, 0);
    assert.equal(snapshot.metrics.staleCallbacksAccepted, 0);
    assert.ok(snapshot.metrics.staleCallbacksRejected >= 1);
    assert.ok(snapshot.metrics.duplicateCallbacksRejected >= 1);
    assert.ok(snapshot.metrics.rpcRecoveredAfterRestart >= 1);
    assert.ok(snapshot.metrics.restartRecoveries >= 2);
    assert.ok(
      Math.max(
        hotReconnectLatencyMs,
        restartRecoveryLatencyMs,
        inFlightRestartLatencyMs,
        crossProcessRestartLatencyMs,
      ) <= RECOVERY_LATENCY_LIMIT_MS,
    );

    await third.disconnectAll();
    await first.disconnectAll();
    return {
      disabledOutboundCount,
      authenticationRefreshesPerRejection,
      reconnectFlightsPerServer,
      initializeCount: server.state.initializeCount,
      subscriptionRestoreCount: server.state.requests.filter(
        (request) => request.method === "resources/subscribe",
      ).length,
      hotReconnectLatencyMs,
      restartRecoveryLatencyMs,
      inFlightRestartLatencyMs,
      crossProcessRestartLatencyMs,
      crossProcessRestartTakeovers: 1,
      maxRecoveryLatencyMs: Math.max(
        hotReconnectLatencyMs,
        restartRecoveryLatencyMs,
        inFlightRestartLatencyMs,
        crossProcessRestartLatencyMs,
      ),
      rpcOrderExact: assertDiscoveryOrder(server.state.requests),
      lifecycleReceiptCount: snapshot.receipts.length,
      lifecycleReceiptDigest: sha256(
        Buffer.from(JSON.stringify(snapshot.receipts)),
      ),
      lifecycleMetrics: snapshot.metrics,
    };
  } finally {
    for (const client of clients.reverse()) {
      await client.disconnectAll().catch(() => {});
    }
  }
}

async function runOAuthScenario({ root, server }) {
  const originals = {
    fs: oauth._deps.fs,
    homedir: oauth._deps.homedir,
    fetch: oauth._deps.fetch,
    now: oauth._deps.now,
    withStoreLock: oauth._deps.withStoreLock,
  };
  const oauthHome = path.join(root, "oauth-home");
  fs.mkdirSync(oauthHome, { recursive: true });
  oauth._deps.fs = fs;
  oauth._deps.homedir = () => oauthHome;
  oauth._deps.fetch = (...args) => globalThis.fetch(...args);
  oauth._deps.now = () => Date.now();
  let firstRefreshRequests = 0;
  try {
    oauth.saveStoredToken(server.url, {
      access_token: "oauth-old-access-token-canary",
      refresh_token: "oauth-refresh-token-canary",
      expires_at: Date.now() - 1,
      client_id: "profile-client",
      endpoints: { token_endpoint: server.tokenUrl },
    });
    const before = server.state.tokenRequests;
    const refreshed = await Promise.all([
      oauth.ensureValidToken(server.url),
      oauth.ensureValidToken(server.url),
    ]);
    firstRefreshRequests = server.state.tokenRequests - before;
    assert.equal(firstRefreshRequests, 1);
    assert.deepEqual(refreshed, [
      "oauth-rotated-access-token-canary",
      "oauth-rotated-access-token-canary",
    ]);

    oauth.saveStoredToken(server.url, {
      access_token: "oauth-old-access-token-canary",
      refresh_token: "oauth-refresh-token-canary",
      expires_at: Date.now() - 1,
      client_id: "profile-client",
      endpoints: { token_endpoint: server.tokenUrl },
    });
    server.state.holdTokenRefresh = true;
    const revokeStartedAt = server.state.tokenRequests;
    const inFlight = oauth.ensureValidToken(server.url, { forceRefresh: true });
    await waitFor(
      () => server.state.heldTokenResponses.length === 1,
      "in-flight OAuth refresh",
    );
    assert.equal(oauth.deleteStoredToken(server.url), true);
    server.state.holdTokenRefresh = false;
    for (const response of server.state.heldTokenResponses.splice(0)) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          access_token: "oauth-resurrected-access-token-canary",
          expires_in: 3600,
        }),
      );
    }
    assert.equal(await inFlight, null);
    assert.equal(oauth.getStoredToken(server.url), null);
    const revokeRefreshRequests = server.state.tokenRequests - revokeStartedAt;
    assert.equal(revokeRefreshRequests, 1);

    oauth.saveStoredToken(server.url, {
      access_token: "oauth-old-access-token-canary",
      refresh_token: "oauth-refresh-token-canary",
      expires_at: Date.now() - 1,
      client_id: "profile-client",
      endpoints: { token_endpoint: server.tokenUrl },
    });
    server.state.rejectRefreshGrant = true;
    const idpRevokeStartedAt = server.state.tokenRequests;
    assert.equal(await oauth.ensureValidToken(server.url), null);
    assert.equal(await oauth.ensureValidToken(server.url), null);
    const idpRevokedRefreshRequests =
      server.state.tokenRequests - idpRevokeStartedAt;
    assert.equal(idpRevokedRefreshRequests, 1);
    assert.equal(oauth.getStoredToken(server.url), null);
    server.state.rejectRefreshGrant = false;
    return {
      expiredTokenRefreshRequests: firstRefreshRequests,
      revokeRefreshRequests,
      idpRevokedRefreshRequests,
      revokedTokenResurrections: 0,
    };
  } finally {
    Object.assign(oauth._deps, originals);
  }
}

async function runProtocolFailureScenario(server) {
  const client = new MCPClient({ sessionId: "mcp-protocol-failure-profile" });
  let protocolBoundaryFailures = 0;
  let invalidProtocolPostInitializeRequests = 0;
  try {
    for (const [name, url] of [
      ["malformed", server.malformedUrl],
      ["unsupported-version", server.unsupportedVersionUrl],
    ]) {
      const before = server.state.requests.length;
      await assert.rejects(client.connect(name, { url, transport: "http" }));
      protocolBoundaryFailures += 1;
      const requests = server.state.requests.slice(before);
      assert.deepEqual(
        requests.map((request) => request.method),
        ["initialize"],
      );
      invalidProtocolPostInitializeRequests += Math.max(0, requests.length - 1);
    }
  } finally {
    await client.disconnectAll().catch(() => {});
  }
  return {
    protocolBoundaryFailures,
    invalidProtocolPostInitializeRequests,
  };
}

async function createTlsMcpServer({ serverIdentity, clientCertificates }) {
  const peerFingerprints = new Set();
  let unauthorizedRequests = 0;
  const server = https.createServer(
    {
      key: serverIdentity.key,
      cert: serverIdentity.cert,
      ca: clientCertificates,
      requestCert: true,
      rejectUnauthorized: true,
    },
    async (request, response) => {
      if (!request.socket.authorized) unauthorizedRequests += 1;
      const peer = request.socket.getPeerCertificate?.();
      if (peer?.fingerprint256) peerFingerprints.add(peer.fingerprint256);
      if (request.method === "DELETE") {
        jsonResponse(response, null, null, 202);
        return;
      }
      const envelope = await readRequestJson(request);
      const result =
        envelope?.method === "initialize"
          ? {
              protocolVersion: "2025-11-25",
              capabilities: {},
              serverInfo: { name: "mcp-mtls-profile" },
            }
          : envelope?.method === "tools/list"
            ? { tools: [] }
            : envelope?.method === "resources/list"
              ? { resources: [] }
              : envelope?.method === "resources/templates/list"
                ? { resourceTemplates: [] }
                : envelope?.method === "prompts/list"
                  ? { prompts: [] }
                  : {};
      jsonResponse(response, envelope?.id, result);
    },
  );
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    server,
    peerFingerprints,
    get unauthorizedRequests() {
      return unauthorizedRequests;
    },
    url: `https://127.0.0.1:${address.port}/mcp`,
    async close() {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function runTlsScenario(root) {
  const activeCert = path.join(root, "active-client-cert.pem");
  const activeKey = path.join(root, "active-client-key.pem");
  const serverCa = path.join(root, "mcp-server-ca.pem");
  const firstIdentity = createEphemeralClientIdentity("MCP Profile Client One");
  const secondIdentity = createEphemeralClientIdentity(
    "MCP Profile Client Two",
  );
  const serverIdentity = createEphemeralClientIdentity("localhost");
  fs.writeFileSync(serverCa, serverIdentity.cert, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.writeFileSync(activeCert, firstIdentity.cert, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.writeFileSync(activeKey, firstIdentity.key, {
    encoding: "utf8",
    mode: 0o600,
  });
  const managedTls = provisionManagedMcpTlsConfig({
    certFile: activeCert,
    keyFile: activeKey,
    caFile: serverCa,
    serverName: "localhost",
  });
  const first = loadMcpTlsMaterial(managedTls, { configScope: "managed" });
  const tlsServer = await createTlsMcpServer({
    serverIdentity,
    clientCertificates: [firstIdentity.cert, secondIdentity.cert],
  });
  const client = new MCPClient({ sessionId: "mcp-mtls-rotation-profile" });
  let second = null;
  try {
    await client.connect("mtls-profile", {
      url: tlsServer.url,
      configScope: "managed",
      tls: managedTls,
    });
    assert.equal(
      client.lifecycleSnapshot("mtls-profile")?.tlsIdentityDigest,
      first.identityDigest,
    );
    await client.disconnect("mtls-profile");

    fs.writeFileSync(activeCert, secondIdentity.cert, { encoding: "utf8" });
    fs.writeFileSync(activeKey, secondIdentity.key, { encoding: "utf8" });
    second = loadMcpTlsMaterial(managedTls, { configScope: "managed" });
    assert.notEqual(first.identityDigest, second.identityDigest);
    await client.connect("mtls-profile", {
      url: tlsServer.url,
      configScope: "managed",
      tls: managedTls,
    });
    assert.equal(
      client.lifecycleSnapshot("mtls-profile")?.tlsIdentityDigest,
      second.identityDigest,
    );
    assert.equal(tlsServer.unauthorizedRequests, 0);
    assert.equal(tlsServer.peerFingerprints.size, 2);
    await client.disconnectAll();
  } finally {
    await client.disconnectAll().catch(() => {});
    await tlsServer.close();
  }

  fs.writeFileSync(activeCert, "malformed certificate material", {
    encoding: "utf8",
  });
  const originalFetch = mcpClientDeps.fetch;
  let invalidTlsOutboundCount = 0;
  mcpClientDeps.fetch = (...args) => {
    invalidTlsOutboundCount += 1;
    return originalFetch(...args);
  };
  const invalidClient = new MCPClient({ sessionId: "invalid-tls-profile" });
  let invalidTlsLifecycleFailed = 0;
  try {
    await assert.rejects(
      invalidClient.connect("invalid-tls", {
        url: "https://127.0.0.1:9/mcp",
        configScope: "managed",
        tls: provisionManagedMcpTlsConfig({
          certFile: activeCert,
          keyFile: activeKey,
        }),
      }),
      (error) => error?.code === "CC_MCP_TLS_MATERIAL_INVALID",
    );
    assert.equal(invalidTlsOutboundCount, 0);
    assert.equal(
      invalidClient.lifecycleSnapshot("invalid-tls")?.phase,
      "failed",
    );
    invalidTlsLifecycleFailed = 1;
  } finally {
    mcpClientDeps.fetch = originalFetch;
    await invalidClient.disconnectAll().catch(() => {});
  }
  return {
    tlsIdentityRotations: 1,
    mtlsAuthorizedConnections: tlsServer.peerFingerprints.size,
    distinctTlsIdentityDigests: new Set([
      first.identityDigest,
      second.identityDigest,
    ]).size,
    invalidTlsMaterialRejected: 1,
    invalidTlsOutboundCount,
    invalidTlsLifecycleFailed,
  };
}

export async function runMcpLifecycleProfile() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-mcp-profile-"));
  const server = await createLifecycleServer();
  try {
    const transport = await runTransportScenario({ root, server });
    const protocolFailures = await runProtocolFailureScenario(server);
    const oauthMeasurements = await runOAuthScenario({ root, server });
    const tls = await runTlsScenario(root);
    const measurements = {
      disabledOutboundCount: transport.disabledOutboundCount,
      rpcOrderExact: transport.rpcOrderExact,
      authenticationRefreshesPerRejection:
        transport.authenticationRefreshesPerRejection,
      reconnectFlightsPerServer: transport.reconnectFlightsPerServer,
      initializeCount: transport.initializeCount,
      subscriptionRestoreCount: transport.subscriptionRestoreCount,
      maxRecoveryLatencyMs: Number(transport.maxRecoveryLatencyMs.toFixed(3)),
      hotReconnectLatencyMs: Number(transport.hotReconnectLatencyMs.toFixed(3)),
      restartRecoveryLatencyMs: Number(
        transport.restartRecoveryLatencyMs.toFixed(3),
      ),
      inFlightRestartLatencyMs: Number(
        transport.inFlightRestartLatencyMs.toFixed(3),
      ),
      crossProcessRestartLatencyMs: Number(
        transport.crossProcessRestartLatencyMs.toFixed(3),
      ),
      crossProcessRestartTakeovers: transport.crossProcessRestartTakeovers,
      lifecycleReceiptCount: transport.lifecycleReceiptCount,
      lifecycleReceiptDigest: transport.lifecycleReceiptDigest,
      rpcRegistered: transport.lifecycleMetrics.rpcRegistered,
      rpcSettled: transport.lifecycleMetrics.rpcSettled,
      rpcRecoveredAfterRestart:
        transport.lifecycleMetrics.rpcRecoveredAfterRestart,
      duplicateCallbacksAccepted:
        transport.lifecycleMetrics.duplicateCallbacksAccepted,
      staleCallbacksAccepted: transport.lifecycleMetrics.staleCallbacksAccepted,
      lostCallbacks: transport.lifecycleMetrics.lostCallbacks,
      staleCallbacksRejected: transport.lifecycleMetrics.staleCallbacksRejected,
      duplicateCallbacksRejected:
        transport.lifecycleMetrics.duplicateCallbacksRejected,
      ...protocolFailures,
      ...oauthMeasurements,
      ...tls,
      helperTimeoutMs: MCP_HEADERS_HELPER_TIMEOUT_MS,
      helperMaxOutputBytes: MCP_HEADERS_HELPER_MAX_OUTPUT_BYTES,
      helperMaxHeaders: MCP_HEADERS_HELPER_MAX_HEADER_COUNT,
      helperMaxHeaderValueBytes: MCP_HEADERS_HELPER_MAX_HEADER_VALUE_BYTES,
      lifecycleMaxPendingRpc: MCP_LIFECYCLE_AUTHORITY_LIMITS.maxPendingRpc,
    };
    const serialized = JSON.stringify(measurements);
    const logSecretHits = SECRET_CANARIES.filter((secret) =>
      serialized.includes(secret),
    ).length;
    measurements.logSecretHits = logSecretHits;

    const thresholds = { ...MCP_LIFECYCLE_PROFILE_THRESHOLDS };
    assert.equal(measurements.disabledOutboundCount, 0);
    assert.equal(measurements.rpcOrderExact, true);
    assert.equal(measurements.authenticationRefreshesPerRejection, 1);
    assert.equal(measurements.reconnectFlightsPerServer, 1);
    assert.ok(
      measurements.maxRecoveryLatencyMs <= thresholds.maxRecoveryLatencyMs,
    );
    assert.equal(measurements.duplicateCallbacksAccepted, 0);
    assert.equal(measurements.staleCallbacksAccepted, 0);
    assert.equal(measurements.lostCallbacks, 0);
    assert.equal(measurements.revokedTokenResurrections, 0);
    assert.equal(measurements.invalidTlsOutboundCount, 0);
    assert.equal(measurements.logSecretHits, 0);
    assert.equal(measurements.helperTimeoutMs, thresholds.helperTimeoutMs);
    assert.equal(
      measurements.helperMaxOutputBytes,
      thresholds.helperMaxOutputBytes,
    );
    assert.equal(measurements.helperMaxHeaders, thresholds.helperMaxHeaders);
    assert.equal(
      measurements.helperMaxHeaderValueBytes,
      thresholds.helperMaxHeaderValueBytes,
    );
    return {
      profileVersion: MCP_LIFECYCLE_PROFILE_VERSION,
      thresholds,
      measurements,
      testIds: [...MCP_LIFECYCLE_PROFILE_TEST_IDS],
    };
  } finally {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}
