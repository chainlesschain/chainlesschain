/**
 * Integration: CLI memory/session/config commands ↔ session-core singletons.
 *
 * Boundary: command action handlers invoking the session-core singletons with
 * a mocked home directory. Verifies that:
 *   - `memory store` + `memory recall` round-trip through MemoryStore and
 *     persist to `memory-store.json` under the mocked home dir.
 *   - `config beta enable/disable/list` persist to `beta-flags.json` and the
 *     list view reflects enabled + disabled known flags.
 *   - `session policy --set <p>` persists per-session policies to
 *     `approval-policies.json` so they survive a fresh singleton instance.
 *
 * These exercise the Commander action functions directly (without spawning the
 * CLI) so we can assert the disk state the e2e tests later replay.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";

let tmpHome;

async function makeProgram(commandRegistrarName) {
  vi.resetModules();
  vi.doMock("../../src/lib/paths.js", () => ({
    getHomeDir: () => tmpHome,
    getBinDir: () => path.join(tmpHome, "bin"),
    getConfigPath: () => path.join(tmpHome, "config.json"),
    getStatePath: () => path.join(tmpHome, "state"),
    getPidFilePath: () => path.join(tmpHome, "state", "app.pid"),
    getServicesDir: () => path.join(tmpHome, "services"),
    getLogsDir: () => path.join(tmpHome, "logs"),
    getCacheDir: () => path.join(tmpHome, "cache"),
    ensureDir: (p) => {
      if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
      return p;
    },
    ensureHomeDir: () => tmpHome,
  }));
  const mod = await import(`../../src/commands/${commandRegistrarName}.js`);
  const program = new Command();
  program.exitOverride(); // prevent process.exit from killing the test runner
  const registrar =
    mod.registerMemoryCommand ||
    mod.registerSessionCommand ||
    mod.registerConfigCommand;
  registrar(program);
  return program;
}

function captureStdout(fn) {
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => logs.push(args.join(" "));
  return Promise.resolve(fn())
    .then(() => logs)
    .finally(() => {
      console.log = origLog;
    });
}

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "cli-mgmt-agents-"));
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  vi.doUnmock("../../src/lib/paths.js");
});

describe("integration: memory store/recall round-trip", () => {
  it("stores a global memory, persists to disk, recall returns it as JSON", async () => {
    const program = await makeProgram("memory");

    const logs1 = await captureStdout(() =>
      program.parseAsync(
        ["memory", "store", "--scope", "global", "--json", "alpha beta gamma"],
        { from: "user" },
      ),
    );
    // store prints the memory object as JSON when --json
    const stored = JSON.parse(logs1.find((l) => l.startsWith("{")));
    expect(stored.scope).toBe("global");
    expect(stored.content).toBe("alpha beta gamma");

    // on-disk persistence
    const dataPath = path.join(tmpHome, "memory-store.json");
    expect(fs.existsSync(dataPath)).toBe(true);
    const persisted = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
    expect(persisted.memories).toHaveLength(1);
    expect(persisted.memories[0].content).toBe("alpha beta gamma");

    // recall via the same singleton — should return the entry
    const logs2 = await captureStdout(() =>
      program.parseAsync(
        ["memory", "recall", "--json", "--scope", "global", "beta"],
        { from: "user" },
      ),
    );
    const recalled = JSON.parse(logs2.find((l) => l.startsWith("[")));
    expect(recalled).toHaveLength(1);
    expect(recalled[0].content).toBe("alpha beta gamma");
    expect(recalled[0].relevance).toBeGreaterThan(0);
  });

  it("memory store validates scope=session requires --scope-id", async () => {
    const program = await makeProgram("memory");

    // With exitOverride, process.exit(1) becomes a thrown CommanderError.
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    await expect(
      program.parseAsync(
        ["memory", "store", "--scope", "session", "--json", "needs-id"],
        { from: "user" },
      ),
    ).rejects.toThrow(/process\.exit\(1\)/);
    exitSpy.mockRestore();
  });

  it("memory recall filters by tags", async () => {
    const program = await makeProgram("memory");

    await program.parseAsync(
      [
        "memory",
        "store",
        "--scope",
        "global",
        "--tags",
        "alpha,beta",
        "--json",
        "tagged one",
      ],
      { from: "user" },
    );
    await program.parseAsync(
      [
        "memory",
        "store",
        "--scope",
        "global",
        "--tags",
        "gamma",
        "--json",
        "tagged two",
      ],
      { from: "user" },
    );

    const logs = await captureStdout(() =>
      program.parseAsync(["memory", "recall", "--json", "--tags", "alpha"], {
        from: "user",
      }),
    );
    const recalled = JSON.parse(logs.find((l) => l.startsWith("[")));
    expect(recalled).toHaveLength(1);
    expect(recalled[0].content).toBe("tagged one");
  });
});

describe("integration: config beta flags", () => {
  it("enable writes to beta-flags.json; list reports enabled + known", async () => {
    const program = await makeProgram("config");

    await program.parseAsync(
      ["config", "beta", "enable", "idle-park-2026-05-01"],
      { from: "user" },
    );

    // wait a microtask for async persist
    await new Promise((r) => setImmediate(r));

    const file = path.join(tmpHome, "beta-flags.json");
    expect(fs.existsSync(file)).toBe(true);
    const on = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(on.flags).toContain("idle-park-2026-05-01");

    const logs = await captureStdout(() =>
      program.parseAsync(["config", "beta", "list", "--json"], {
        from: "user",
      }),
    );
    const out = JSON.parse(logs.find((l) => l.startsWith("{")));
    expect(out.enabled).toContain("idle-park-2026-05-01");
  });

  it("disable removes from persistence", async () => {
    const program = await makeProgram("config");

    await program.parseAsync(
      ["config", "beta", "enable", "memory-consolidate-2026-04-15"],
      { from: "user" },
    );
    await new Promise((r) => setImmediate(r));
    await program.parseAsync(
      ["config", "beta", "disable", "memory-consolidate-2026-04-15"],
      { from: "user" },
    );
    await new Promise((r) => setImmediate(r));

    const file = path.join(tmpHome, "beta-flags.json");
    const on = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(on.flags).not.toContain("memory-consolidate-2026-04-15");
  });

  it("rejects malformed flag name (not <feature>-<YYYY-MM-DD>)", async () => {
    const program = await makeProgram("config");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    await expect(
      program.parseAsync(["config", "beta", "enable", "notaflag"], {
        from: "user",
      }),
    ).rejects.toThrow(/process\.exit\(1\)/);
    exitSpy.mockRestore();
  });
});

describe("integration: session policy", () => {
  it("set persists to approval-policies.json; fresh singleton rehydrates", async () => {
    const program = await makeProgram("session");

    await program.parseAsync(
      ["session", "policy", "sess_abc", "--set", "trusted", "--json"],
      { from: "user" },
    );
    await new Promise((r) => setImmediate(r));

    const file = path.join(tmpHome, "approval-policies.json");
    expect(fs.existsSync(file)).toBe(true);
    const on = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(on.policies).toEqual({ sess_abc: "trusted" });

    // reset singletons then query through the command — default should still
    // return "trusted" because the file was rehydrated.
    const singletonsMod =
      await import("../../src/lib/session-core-singletons.js");
    singletonsMod.resetSessionCoreSingletonsForTests();

    const logs = await captureStdout(() =>
      program.parseAsync(["session", "policy", "sess_abc", "--json"], {
        from: "user",
      }),
    );
    const out = JSON.parse(logs.find((l) => l.startsWith("{")));
    expect(out.policy).toBe("trusted");
  });

  it("rejects invalid policy value", async () => {
    const program = await makeProgram("session");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    await expect(
      program.parseAsync(["session", "policy", "sess_x", "--set", "bogus"], {
        from: "user",
      }),
    ).rejects.toThrow(/process\.exit\(1\)/);
    exitSpy.mockRestore();
  });
});
