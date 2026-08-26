import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

import { CcAppServer } from "../src/lib/app-server/server.js";
import { MemoryRolloutStore } from "../src/lib/app-server/rollout-store.js";
import {
  APP_SERVER_WEBSOCKET_PROTOCOL,
  WebSocketAppServerHost,
} from "../src/lib/app-server/websocket-transport.js";
import { APP_SERVER_PROTOCOL_VERSION } from "../src/lib/app-server/protocol.js";

const RESULT_SCHEMA = "chainlesschain.app-server-overload-soak.v1";
const MINIMUM_FORMAL_DURATION_SECONDS = 30 * 60;
const MAX_RSS_GROWTH_RATIO = 0.1;
const SERVER_QUEUE_CAP = 8;
const SERVER_QUEUE_BYTES = 256 * 1024;
const CLIENT_OUTSTANDING_CAP = 256;
const SOAK_TOKEN = "app-server-overload-soak-token-0001";

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function positiveNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
  return parsed;
}

function git(args) {
  return execFileSync("git", args, {
    cwd: new URL("../../..", import.meta.url),
    encoding: "utf8",
    windowsHide: true,
  }).trim();
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function openSocket(url) {
  const socket = new WebSocket(url, [
    APP_SERVER_WEBSOCKET_PROTOCOL,
    `bearer.${Buffer.from(SOAK_TOKEN).toString("base64url")}`,
  ]);
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function waitForResponse(socket, expectedId) {
  return new Promise((resolve, reject) => {
    const onMessage = (data) => {
      try {
        const message = JSON.parse(data.toString("utf8"));
        if (message.id !== expectedId) return;
        cleanup();
        resolve(message);
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off("message", onMessage);
      socket.off("error", onError);
    };
    socket.on("message", onMessage);
    socket.on("error", onError);
  });
}

async function main() {
  const smoke =
    process.argv.includes("--smoke") ||
    process.env.CC_APP_SERVER_SOAK_MODE === "smoke";
  const durationSeconds = positiveNumber(
    argument(
      "--duration-seconds",
      process.env.CC_APP_SERVER_SOAK_DURATION_SECONDS ||
        MINIMUM_FORMAL_DURATION_SECONDS,
    ),
    "soak duration",
  );
  const outputPath =
    argument("--output", process.env.CC_APP_SERVER_SOAK_OUTPUT) ||
    join(tmpdir(), `cc-app-server-overload-soak-${process.pid}.json`);
  const expectedSha =
    argument("--expected-sha", process.env.CC_APP_SERVER_SOAK_EXPECTED_SHA) ||
    null;
  const formal = !smoke;
  const allowDirtySmoke = smoke && process.argv.includes("--allow-dirty");
  if (formal && durationSeconds < MINIMUM_FORMAL_DURATION_SECONDS) {
    throw new Error(
      `formal App Server soak requires at least ${MINIMUM_FORMAL_DURATION_SECONDS} seconds`,
    );
  }
  if (formal && !/^[a-f0-9]{40}$/u.test(expectedSha || "")) {
    throw new Error("formal App Server soak requires an exact expected SHA");
  }

  const headSha = git(["rev-parse", "HEAD"]);
  if (expectedSha && headSha !== expectedSha) {
    throw new Error(
      `exact SHA mismatch: expected ${expectedSha}, got ${headSha}`,
    );
  }
  if (
    !allowDirtySmoke &&
    git(["status", "--porcelain", "--untracked-files=no"])
  ) {
    throw new Error("tracked source tree must be clean before App Server soak");
  }

  const startedAt = new Date().toISOString();
  const startedMonotonic = performance.now();
  const durationMs = durationSeconds * 1000;
  const warmupMs = formal ? 5 * 60 * 1000 : Math.min(1_000, durationMs / 4);
  const sampleIntervalMs = formal ? 10_000 : Math.max(100, durationMs / 10);
  const samples = [];
  const servers = [];
  const store = new MemoryRolloutStore();
  const host = new WebSocketAppServerHost({
    host: "127.0.0.1",
    port: 0,
    token: SOAK_TOKEN,
    maxPendingReceives: CLIENT_OUTSTANDING_CAP,
    serverFactory: ({ send }) => {
      const server = new CcAppServer({
        send,
        store,
        kernel: { close: async () => {} },
        transport: "websocket",
        maxQueuedRequests: SERVER_QUEUE_CAP,
        maxQueuedRequestBytes: SERVER_QUEUE_BYTES,
        maxConcurrentRequests: 1,
      });
      server._threadList = async () => {
        await sleep(25);
        return { threads: [] };
      };
      servers.push(server);
      return server;
    },
  });
  const info = await host.start();
  const socket = await openSocket(info.url);
  let nextId = 1;
  const initialization = waitForResponse(socket, nextId);
  socket.send(
    JSON.stringify({
      jsonrpc: "2.0",
      id: nextId,
      method: "initialize",
      params: {
        protocolVersion: APP_SERVER_PROTOCOL_VERSION,
        minimumProtocolVersion: 1,
        client: { name: "app-server-overload-soak", version: "1" },
        features: ["thread_turn_item", "bounded_transport"],
      },
    }),
  );
  const initializationResponse = await initialization;
  if (initializationResponse.error) {
    throw new Error(
      `App Server initialize failed: ${initializationResponse.error.message}`,
    );
  }

  const outstanding = new Set();
  let responses = 0;
  let successes = 0;
  let overloaded = 0;
  let unexpectedErrors = 0;
  let maximumOutstanding = 0;
  let maximumServerQueueItems = 0;
  let maximumServerQueueBytes = 0;
  let maximumOutputQueueItems = 0;
  let maximumOutputQueueBytes = 0;
  let socketFailure = null;

  socket.on("error", (error) => {
    socketFailure ||= error;
  });
  socket.on("message", (data) => {
    let message;
    try {
      message = JSON.parse(data.toString("utf8"));
    } catch (error) {
      socketFailure ||= error;
      return;
    }
    if (!outstanding.delete(message.id)) return;
    responses += 1;
    if (!message.error) successes += 1;
    else if (
      message.error.code === -32001 &&
      Number(message.error.data?.retry_after_ms) > 0
    ) {
      overloaded += 1;
    } else unexpectedErrors += 1;
  });

  let nextSampleAt = performance.now();
  const deadline = startedMonotonic + durationMs;
  try {
    while (performance.now() < deadline) {
      if (socketFailure) throw socketFailure;
      while (outstanding.size < CLIENT_OUTSTANDING_CAP) {
        nextId += 1;
        outstanding.add(nextId);
        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: nextId,
            method: "thread/list",
            params: { limit: 1 },
          }),
        );
        if (nextId % 16 === 0) break;
      }
      maximumOutstanding = Math.max(maximumOutstanding, outstanding.size);

      const now = performance.now();
      if (now >= nextSampleAt) {
        global.gc?.();
        const serverQueue = servers[0]?.status().queue;
        const outputQueue = [
          ...host.connections.values(),
        ][0]?.transport.queue.snapshot();
        maximumServerQueueItems = Math.max(
          maximumServerQueueItems,
          serverQueue?.queuedItems || 0,
        );
        maximumServerQueueBytes = Math.max(
          maximumServerQueueBytes,
          serverQueue?.queuedBytes || 0,
        );
        maximumOutputQueueItems = Math.max(
          maximumOutputQueueItems,
          outputQueue?.queuedItems || 0,
        );
        maximumOutputQueueBytes = Math.max(
          maximumOutputQueueBytes,
          outputQueue?.queuedBytes || 0,
        );
        samples.push({
          elapsedMs: now - startedMonotonic,
          rssBytes: process.memoryUsage().rss,
          outstanding: outstanding.size,
          serverQueueItems: serverQueue?.queuedItems || 0,
          serverQueueBytes: serverQueue?.queuedBytes || 0,
          outputQueueItems: outputQueue?.queuedItems || 0,
          outputQueueBytes: outputQueue?.queuedBytes || 0,
        });
        nextSampleAt = now + sampleIntervalMs;
      }
      await sleep(10);
    }
    const drainDeadline = Date.now() + 10_000;
    while (outstanding.size > 0 && Date.now() < drainDeadline) await sleep(10);
  } finally {
    socket.close();
    await Promise.race([onceClose(socket), sleep(2_000)]);
    await host.close();
  }

  const endedMonotonic = performance.now();
  const measurement = samples.filter((sample) => sample.elapsedMs >= warmupMs);
  const windowSize = Math.max(1, Math.floor(measurement.length * 0.2));
  const baselineRssBytes = median(
    measurement.slice(0, windowSize).map((sample) => sample.rssBytes),
  );
  const finalRssBytes = median(
    measurement.slice(-windowSize).map((sample) => sample.rssBytes),
  );
  const rssGrowthRatio =
    baselineRssBytes && finalRssBytes
      ? (finalRssBytes - baselineRssBytes) / baselineRssBytes
      : null;
  const violations = [];
  if (formal && endedMonotonic - startedMonotonic < durationMs) {
    violations.push("soak duration was shorter than the formal minimum");
  }
  if (overloaded === 0)
    violations.push("workload produced no OVERLOADED response");
  if (unexpectedErrors > 0)
    violations.push("workload produced unexpected RPC errors");
  if (outstanding.size > 0)
    violations.push("client requests did not drain within 10 seconds");
  if (maximumOutstanding > CLIENT_OUTSTANDING_CAP) {
    violations.push("client outstanding request cap was exceeded");
  }
  if (maximumServerQueueItems > SERVER_QUEUE_CAP) {
    violations.push("server request item cap was exceeded");
  }
  if (maximumServerQueueBytes > SERVER_QUEUE_BYTES) {
    violations.push("server request byte cap was exceeded");
  }
  if (
    formal &&
    (rssGrowthRatio == null || rssGrowthRatio > MAX_RSS_GROWTH_RATIO)
  ) {
    violations.push("post-warmup RSS growth exceeded 10%");
  }
  if (git(["rev-parse", "HEAD"]) !== headSha) {
    violations.push("source SHA changed during soak");
  }
  if (
    !allowDirtySmoke &&
    git(["status", "--porcelain", "--untracked-files=no"])
  ) {
    violations.push("tracked source tree changed during soak");
  }

  const report = {
    schema: RESULT_SCHEMA,
    qualifying: formal && violations.length === 0,
    mode: formal ? "formal" : "smoke-non-qualifying",
    source: { expectedSha, headSha },
    startedAt,
    completedAt: new Date().toISOString(),
    durationSeconds: (endedMonotonic - startedMonotonic) / 1000,
    profile: {
      minimumFormalDurationSeconds: MINIMUM_FORMAL_DURATION_SECONDS,
      warmupSeconds: warmupMs / 1000,
      maximumRssGrowthRatio: MAX_RSS_GROWTH_RATIO,
      serverQueueCap: SERVER_QUEUE_CAP,
      serverQueueBytes: SERVER_QUEUE_BYTES,
      clientOutstandingCap: CLIENT_OUTSTANDING_CAP,
    },
    traffic: {
      sent: nextId - 1,
      responses,
      successes,
      overloaded,
      unexpectedErrors,
      outstandingAfterDrain: outstanding.size,
      maximumOutstanding,
    },
    queues: {
      maximumServerQueueItems,
      maximumServerQueueBytes,
      maximumOutputQueueItems,
      maximumOutputQueueBytes,
    },
    rss: {
      sampleCount: samples.length,
      measurementSampleCount: measurement.length,
      baselineBytes: baselineRssBytes,
      finalBytes: finalRssBytes,
      growthRatio: rssGrowthRatio,
    },
    violations,
  };
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(
    `App Server ${report.mode} soak: ${report.durationSeconds.toFixed(2)}s, ` +
      `${overloaded} overloaded, RSS growth ${rssGrowthRatio == null ? "n/a" : `${(rssGrowthRatio * 100).toFixed(2)}%`}\n` +
      `evidence: ${outputPath}\n`,
  );
  if (violations.length > 0) {
    throw new Error(`App Server soak failed: ${violations.join("; ")}`);
  }
}

function onceClose(socket) {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => socket.once("close", resolve));
}

await main();
