/**
 * Unit tests for the pdh-im-collect skill handler.
 *
 * Covers the WeChat/QQ chat-collection guidance + dispatch logic:
 * readiness probing, per-action guidance, opt-in --run execution,
 * passphrase handling (masked, never echoed), and cc-CLI-absent
 * degradation. The cc CLI is stubbed via the handler's _deps seam
 * (vi.mock("child_process") does not work for inlined CJS —
 * see .claude/rules/testing.md), so no real subprocess is spawned.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

vi.mock("../../../../utils/logger.js", () => {
  const fake = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: fake, default: fake };
});

const handler = require("../builtin/pdh-im-collect/handler.js");

const origExecSync = handler._deps.execSync;
const origFs = handler._deps.fs;

// cc CLI absent: `cc --version` throws and no workspace CLI on disk →
// resolveCcPrefix() returns null and the skill degrades to guidance-only.
function ccAbsent() {
  handler._deps.execSync = vi.fn(() => {
    throw new Error("command not found: cc");
  });
  handler._deps.fs = { existsSync: vi.fn(() => false) };
}

// cc CLI present: `cc --version` succeeds; every other invocation is routed
// to `responder(cmd)`, which returns the fake stdout (or throws to simulate
// a failing command).
function ccPresent(responder) {
  handler._deps.execSync = vi.fn((cmd) => {
    if (cmd === "cc --version") {
      return "chainlesschain 0.1.0\n";
    }
    return responder(cmd);
  });
  handler._deps.fs = { existsSync: vi.fn(() => false) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  handler._deps.execSync = origExecSync;
  handler._deps.fs = origFs;
});

describe("pdh-im-collect handler", () => {
  describe("init()", () => {
    it("initializes without throwing", async () => {
      await expect(
        handler.init({ name: "pdh-im-collect" }),
      ).resolves.not.toThrow();
    });
  });

  describe("readiness (default action)", () => {
    it("degrades to guidance when cc CLI is unavailable", async () => {
      ccAbsent();
      const res = await handler.execute({ params: { input: "readiness" } }, {});
      expect(res.success).toBe(true);
      expect(res.result.action).toBe("readiness");
      expect(res.result.ok).toBe(false);
      expect(res.message).toContain("就绪探测未完成");
      // still surfaces both collection paths
      expect(res.message).toContain("微信");
      expect(res.message).toContain("QQ NT");
    });

    it("defaults to readiness when no action token is given", async () => {
      ccAbsent();
      const res = await handler.execute({ params: { input: "" } }, {});
      expect(res.success).toBe(true);
      expect(res.result.action).toBe("readiness");
    });

    it("parses an array-shaped readiness report", async () => {
      ccPresent((cmd) => {
        expect(cmd).toContain("hub readiness --json");
        return JSON.stringify([
          { id: "wechat-pc", status: "ready" },
          { id: "qq-pc", status: "DB_FOUND_NEEDS_KEY" },
        ]);
      });
      const res = await handler.execute({ params: { input: "readiness" } }, {});
      expect(res.success).toBe(true);
      expect(res.result.ok).toBe(true);
      expect(res.result.wechat.status).toBe("ready");
      expect(res.result.qq.status).toBe("DB_FOUND_NEEDS_KEY");
      expect(res.message).toContain("**wechat-pc**: ready");
      expect(res.message).toContain("**qq-pc**: DB_FOUND_NEEDS_KEY");
    });

    it("parses a keyed-object readiness report (status via .state)", async () => {
      ccPresent(() =>
        JSON.stringify({
          "wechat-pc": { state: "APP_NOT_INSTALLED" },
          "qq-pc": { status: "ready" },
        }),
      );
      const res = await handler.execute({ params: { input: "status" } }, {});
      expect(res.result.ok).toBe(true);
      expect(res.result.wechat.status).toBe("APP_NOT_INSTALLED");
      expect(res.result.qq.status).toBe("ready");
    });

    it("tolerates noisy stdout around the JSON blob", async () => {
      ccPresent(
        () => 'chcp 65001\n[{"id":"wechat-pc","status":"ready"}]\nDone.\n',
      );
      const res = await handler.execute({ params: { input: "readiness" } }, {});
      expect(res.result.ok).toBe(true);
      expect(res.result.wechat.status).toBe("ready");
    });
  });

  describe("wechat action", () => {
    it("returns guidance only (no ingestion) without --run", async () => {
      const responder = vi.fn(() => "");
      ccPresent(responder);
      const res = await handler.execute({ params: { input: "wechat" } }, {});
      expect(res.success).toBe(true);
      expect(res.result.command).toBe("cc hub sync-adapter wechat-pc");
      expect(res.message).toContain("cc hub sync-adapter wechat-pc");
      // only the `cc --version` probe ran — never a sync-adapter call
      expect(responder.mock.calls.some((c) => /sync-adapter/.test(c[0]))).toBe(
        false,
      );
    });

    it("executes ingestion with --run when cc is available", async () => {
      ccPresent((cmd) => {
        expect(cmd).toContain("hub sync-adapter wechat-pc");
        return "ingested 42 messages\n";
      });
      const res = await handler.execute(
        { params: { input: "wechat --run" } },
        {},
      );
      expect(res.success).toBe(true);
      expect(res.result.ran).toContain("sync-adapter wechat-pc");
      expect(res.message).toContain("ingested 42 messages");
    });

    it("fails clearly with --run when cc is unavailable", async () => {
      ccAbsent();
      const res = await handler.execute(
        { params: { input: "wechat --run" } },
        {},
      );
      expect(res.success).toBe(false);
      expect(res.error).toBe("cc CLI not found");
      expect(res.message).toContain("cc hub sync-adapter wechat-pc");
    });
  });

  describe("qq action", () => {
    it("returns key-extraction guidance without --run", async () => {
      ccAbsent();
      const res = await handler.execute({ params: { input: "qq" } }, {});
      expect(res.success).toBe(true);
      expect(res.message).toContain("qq-win-db-key");
    });

    it("rejects --run without a passphrase", async () => {
      ccPresent(() => "");
      const res = await handler.execute({ params: { input: "qq --run" } }, {});
      expect(res.success).toBe(false);
      expect(res.error).toBe("missing passphrase");
    });

    it("runs ingestion with passphrase but never echoes the key back", async () => {
      const KEY = "5{sww#,6aq=)8=A@";
      ccPresent((cmd) => {
        expect(cmd).toContain("hub sync-adapter qq-pc");
        return "ingested 7 私聊 + 3 群聊\n";
      });
      const res = await handler.execute(
        { params: { input: `qq --run --passphrase "${KEY}"` } },
        {},
      );
      expect(res.success).toBe(true);
      // the passphrase must not leak into the structured result or message
      expect(JSON.stringify(res.result)).not.toContain(KEY);
      expect(res.message).not.toContain(KEY);
      expect(res.message).toContain("密钥已隐去");
    });

    it("fails clearly with --run+passphrase when cc is unavailable", async () => {
      ccAbsent();
      const res = await handler.execute(
        { params: { input: 'qq --run --passphrase "abc123"' } },
        {},
      );
      expect(res.success).toBe(false);
      expect(res.error).toBe("cc CLI not found");
    });
  });

  describe("verify action", () => {
    it("runs `hub stats` when cc is available", async () => {
      ccPresent((cmd) => {
        expect(cmd).toContain("hub stats");
        return "entities: 1234\nevents: 5678\n";
      });
      const res = await handler.execute({ params: { input: "verify" } }, {});
      expect(res.success).toBe(true);
      expect(res.result.action).toBe("verify");
      expect(res.message).toContain("entities: 1234");
    });

    it("fails clearly when cc is unavailable", async () => {
      ccAbsent();
      const res = await handler.execute({ params: { input: "verify" } }, {});
      expect(res.success).toBe(false);
      expect(res.error).toBe("cc CLI not found");
    });
  });

  describe("input shapes & routing", () => {
    it("accepts task.input (not just task.params.input)", async () => {
      ccAbsent();
      const res = await handler.execute({ input: "wechat" }, {});
      expect(res.result.action).toBe("wechat");
    });

    it("accepts task.action", async () => {
      ccAbsent();
      const res = await handler.execute({ action: "qq" }, {});
      expect(res.message).toContain("qq-win-db-key");
    });

    it("routes an unknown action to help", async () => {
      ccAbsent();
      const res = await handler.execute(
        { params: { input: "frobnicate" } },
        {},
      );
      expect(res.success).toBe(true);
      expect(res.result.action).toBe("help");
      expect(res.message).toContain("用法");
    });
  });

  describe("error handling", () => {
    it("catches a thrown CLI error during --run and reports failure", async () => {
      ccPresent((cmd) => {
        if (/sync-adapter/.test(cmd)) {
          throw new Error("KEY_VERIFY_FAILED");
        }
        return "";
      });
      const res = await handler.execute(
        { params: { input: "wechat --run" } },
        {},
      );
      expect(res.success).toBe(false);
      expect(res.message).toContain("PDH 采集执行失败");
      expect(res.error).toContain("KEY_VERIFY_FAILED");
    });
  });
});
