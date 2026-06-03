/**
 * mtc.* WS handler 单元测试 — 2026-05-07.
 *
 * 测试结构：
 *   - 3 个 handler (audit-status / bridge-status / bridge-sla) 都走纯文件读
 *     (audit-mtc / cross-chain-mtc lib)，不需要 SQLite。tmp dir + 手动写
 *     config.json 即可端到端。
 *   - 经 dynamic import 进 ESM CLI lib，所以测试 mock 不到 lib —— 直接让 lib
 *     在隔离 tmpdir 中跑。每个 handler 接受可选的 getHomeDir 注入，测试用
 *     `() => tmpHome` 强制隔离，避免污染用户 ~/.chainlesschain。
 *   - 错误路径用既存的非目录文件挡 lib 的 ensureDirs，断言 handler 转成
 *     {success:false, error} 而不是 throw（dispatcher 不能 trip）。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
  createMtcStatusHandlers,
  createAuditStatusHandler,
  createBridgeStatusHandler,
  createBridgeSlaHandler,
} = require("../handlers/mtc-status-handlers");

let tmpHome;

function freshTmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mtc-handlers-test-"));
}

function homeDir() {
  return tmpHome;
}

beforeEach(() => {
  tmpHome = freshTmpHome();
});

afterEach(() => {
  try {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("createMtcStatusHandlers", () => {
  it("registers exactly 3 topics with the expected names", () => {
    const handlers = createMtcStatusHandlers();
    expect(Object.keys(handlers).sort()).toEqual([
      "mtc.audit-status",
      "mtc.bridge-sla",
      "mtc.bridge-status",
    ]);
    for (const fn of Object.values(handlers)) {
      expect(typeof fn).toBe("function");
    }
  });
});

describe("mtc.audit-status handler", () => {
  it("returns a fully-shaped status object on a fresh state dir", async () => {
    const handler = createAuditStatusHandler({ getHomeDir: homeDir });
    const reply = await handler();
    expect(reply.success).toBe(true);
    expect(reply.status).toBeDefined();
    expect(reply.status.config).toBeDefined();
    expect(reply.status.config.enabled).toBe(false);
    expect(reply.status.staging).toMatchObject({ count: 0 });
    expect(reply.status.batches).toMatchObject({ count: 0 });
  });

  it("reflects custom config written to disk", async () => {
    const auditDir = path.join(tmpHome, "audit-mtc");
    fs.mkdirSync(auditDir, { recursive: true });
    fs.writeFileSync(
      path.join(auditDir, "config.json"),
      JSON.stringify({
        enabled: true,
        batch_interval_seconds: 120,
        namespace_prefix: "test/audit/",
        issuer: "did:test:issuer",
      }),
    );

    const handler = createAuditStatusHandler({ getHomeDir: homeDir });
    const reply = await handler();
    expect(reply.success).toBe(true);
    expect(reply.status.config.enabled).toBe(true);
    expect(reply.status.config.batch_interval_seconds).toBe(120);
    expect(reply.status.config.issuer).toBe("did:test:issuer");
  });

  it("returns success:false (not throw) when home dir is unwritable", async () => {
    // Point homeDir at a path whose parent is a regular file — ensureDirs
    // (called by getStatus) will fail to mkdir-recursive on that. Asserts
    // the handler converts the throw into a structured envelope so the
    // dispatcher never trips.
    const blocker = path.join(tmpHome, "blocker");
    fs.writeFileSync(blocker, "i am a file, not a dir");
    const handler = createAuditStatusHandler({
      getHomeDir: () => path.join(blocker, "subdir"),
    });
    const reply = await handler();
    expect(reply.success).toBe(false);
    expect(typeof reply.error).toBe("string");
  });
});

describe("mtc.bridge-status handler", () => {
  it("returns disabled-by-default status on a fresh state dir", async () => {
    const handler = createBridgeStatusHandler({ getHomeDir: homeDir });
    const reply = await handler();
    expect(reply.success).toBe(true);
    expect(reply.status).toBeDefined();
    expect(reply.status.enabled).toBe(false);
    expect(reply.status.mode).toBe("independent");
    expect(reply.status.trust_anchors).toMatchObject({
      chain_count: 0,
      total: 0,
    });
    expect(reply.status.staging).toMatchObject({ pending: 0 });
    expect(reply.status.batches).toMatchObject({ total: 0 });
  });

  it("reflects custom config + trust anchors", async () => {
    const bridgeDir = path.join(tmpHome, "cross-chain-mtc");
    fs.mkdirSync(bridgeDir, { recursive: true });
    fs.writeFileSync(
      path.join(bridgeDir, "config.json"),
      JSON.stringify({
        enabled: true,
        mode: "federated",
        alg: "slh-dsa-128f",
        batch_interval_seconds: 30,
        issuer: "did:test:bridge-issuer",
      }),
    );
    fs.writeFileSync(
      path.join(bridgeDir, "trust-anchors.json"),
      JSON.stringify({
        schema: "mtc-bridge-trust-anchors/v1",
        anchors: {
          ethereum: [{ alg: "ed25519", pubkey_id: "id1", issuer: "iss1" }],
        },
      }),
    );

    const handler = createBridgeStatusHandler({ getHomeDir: homeDir });
    const reply = await handler();
    expect(reply.success).toBe(true);
    expect(reply.status.enabled).toBe(true);
    expect(reply.status.mode).toBe("federated");
    expect(reply.status.alg).toBe("slh-dsa-128f");
    expect(reply.status.trust_anchors.chain_count).toBe(1);
    expect(reply.status.trust_anchors.total).toBe(1);
    expect(reply.status.trust_anchors.by_chain.ethereum).toBe(1);
  });
});

describe("mtc.bridge-sla handler", () => {
  it("returns sla metrics with the documented shape", async () => {
    const handler = createBridgeSlaHandler({ getHomeDir: homeDir });
    const reply = await handler();
    expect(reply.success).toBe(true);
    expect(reply.metrics).toBeDefined();
    expect(typeof reply.metrics.sla_status).toBe("string");
    expect("staged_pending_count" in reply.metrics).toBe(true);
    expect("batches_total" in reply.metrics).toBe(true);
  });
});
