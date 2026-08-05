import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  collectCheckupSections,
  runCheckupFixes,
  unsafeFixCommands,
  CHECK_LEVELS,
} from "../../src/lib/doctor-checkup.js";
import { _deps as registryDeps } from "../../src/lib/lsp/lsp-server-registry.js";
import { getConfigPath, getHomeDir } from "../../src/lib/paths.js";
import { join } from "node:path";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

/** Dir-agnostic fake fs deps: nothing exists except what the test opts into. */
function fakeDeps(overrides = {}) {
  return {
    existsSync: () => false,
    readFileSync: () => "",
    readdirSync: () => [],
    statSync: () => ({ mtimeMs: 0 }),
    rmSync: vi.fn(),
    execFileSync: vi.fn(() => ""),
    now: () => 10_000_000,
    ...overrides,
  };
}

const t = it.runIf(process.platform !== "win32");

describe("doctor-checkup", () => {
  it("collects all layered sections without throwing", async () => {
    const sections = await collectCheckupSections({ deps: fakeDeps() });
    const ids = sections.map((s) => s.id);
    expect(ids).toEqual([
      "config",
      "provider",
      "mcp",
      "ide",
      "plugins",
      "subagents",
      "transcripts",
      "background",
      "worktrees",
      "runtime",
      "execution",
    ]);
    for (const s of sections) {
      expect(Array.isArray(s.checks)).toBe(true);
      expect(s.checks.length).toBeGreaterThan(0);
      for (const c of s.checks) {
        expect(Object.values(CHECK_LEVELS)).toContain(c.level);
      }
    }
  });

  it("reports missing transcripts and restored tombstone conflicts as integrity errors", async () => {
    const previousHome = process.env.CHAINLESSCHAIN_HOME;
    const home = mkdtempSync(join(tmpdir(), "cc-doctor-transcripts-"));
    process.env.CHAINLESSCHAIN_HOME = home;
    try {
      const store = await import("../../src/harness/jsonl-session-store.js");
      const missingId = store.startSession("doctor-missing", {
        title: "missing",
      });
      rmSync(store.sessionPath(missingId), { force: true });

      const conflictId = store.startSession("doctor-conflict", {
        title: "conflict",
      });
      const restored = readFileSync(store.sessionPath(conflictId), "utf8");
      expect(store.deleteJsonlSession(conflictId)).toBe(true);
      writeFileSync(store.sessionPath(conflictId), restored, "utf8");

      const sections = await collectCheckupSections({ deps: fakeDeps() });
      const transcriptCheck = sections
        .find((section) => section.id === "transcripts")
        .checks.find((entry) => entry.id === "transcript-tamper");
      expect(transcriptCheck.level).toBe(CHECK_LEVELS.ERR);
      expect(transcriptCheck.detail).toContain(`${missingId} [missing]`);
      expect(transcriptCheck.detail).toContain(`${conflictId} [conflict]`);
    } finally {
      if (previousHome === undefined) delete process.env.CHAINLESSCHAIN_HOME;
      else process.env.CHAINLESSCHAIN_HOME = previousHome;
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("flags an invalid config.json as err with a manual fix command", async () => {
    const deps = fakeDeps({
      existsSync: (p) => String(p).endsWith("config.json"),
      readFileSync: () => "{definitely-not-json",
    });
    const sections = await collectCheckupSections({ deps });
    const config = sections.find((s) => s.id === "config");
    const check = config.checks.find((c) => c.id === "config-json");
    expect(check.level).toBe(CHECK_LEVELS.ERR);
    expect(check.fix).toBeTruthy();
    expect(check.fix.safe).toBe(false);
    // and it surfaces in the copyable-commands list
    const manual = unsafeFixCommands(sections);
    expect(manual.some((m) => m.command.includes("config.json"))).toBe(true);
  });

  it("reports the .corrupted backup when present", async () => {
    const deps = fakeDeps({
      existsSync: (p) => String(p).endsWith("config.json.corrupted"),
    });
    const sections = await collectCheckupSections({ deps });
    const config = sections.find((s) => s.id === "config");
    expect(config.checks.some((c) => c.id === "config-corrupted-backup")).toBe(
      true,
    );
  });

  t("discovers and repairs legacy config.json backup siblings", async () => {
    const home = getHomeDir();
    const backup = `${getConfigPath()}.bak-20260101`;
    const modes = new Map([
      [home, 0o700],
      [backup, 0o644],
    ]);
    const deps = fakeDeps({
      platform: () => "linux",
      existsSync: (target) => modes.has(String(target)),
      readdirSync: (target) =>
        String(target) === home ? ["config.json.bak-20260101"] : [],
      lstatSync: (target) => ({
        mode: modes.get(String(target)),
        uid: typeof process.getuid === "function" ? process.getuid() : 0,
        isDirectory: () => String(target) === home,
        isSymbolicLink: () => false,
      }),
      chmodSync: (target, mode) => modes.set(String(target), mode),
    });

    const sections = await collectCheckupSections({ deps });
    const permissionCheck = sections
      .find((section) => section.id === "config")
      .checks.find((entry) => entry.id === "private-storage-permissions");
    expect(permissionCheck.fix).toMatchObject({
      id: "repair-private-storage",
      safe: true,
    });
    await runCheckupFixes(sections, { deps });
    expect(modes.get(backup)).toBe(0o600);
  });

  t("detects and safely repairs legacy private-storage modes", async () => {
    const home = getHomeDir();
    const configPath = getConfigPath();
    const modes = new Map([
      [home, 0o755],
      [configPath, 0o644],
    ]);
    const deps = fakeDeps({
      platform: () => "linux",
      existsSync: (target) => modes.has(String(target)),
      lstatSync: (target) => ({
        mode: modes.get(String(target)),
        uid: typeof process.getuid === "function" ? process.getuid() : 0,
        isDirectory: () => String(target) === home,
        isSymbolicLink: () => false,
      }),
      chmodSync: (target, mode) => modes.set(String(target), mode),
    });
    const sections = await collectCheckupSections({ deps });
    const permissionCheck = sections
      .find((section) => section.id === "config")
      .checks.find((check) => check.id === "private-storage-permissions");
    expect(permissionCheck).toMatchObject({
      level: CHECK_LEVELS.ERR,
      fix: { id: "repair-private-storage", safe: true },
    });

    const results = await runCheckupFixes(sections, { deps });
    expect(results).toContainEqual(
      expect.objectContaining({
        id: "repair-private-storage",
        applied: true,
      }),
    );
    expect(modes.get(home)).toBe(0o700);
    expect(modes.get(configPath)).toBe(0o600);
  });

  it("batch-checks and repairs protected Windows storage children", async () => {
    const home = getHomeDir();
    const configPath = getConfigPath();
    const sessions = join(home, "sessions");
    const sessionFile = join(sessions, "unsafe.jsonl");
    const existing = new Set([home, configPath, sessions, sessionFile]);
    const powershellCalls = [];
    const deps = fakeDeps({
      platform: () => "win32",
      existsSync: (target) => existing.has(String(target)),
      readFileSync: () => "{}",
      readdirSync: (target) =>
        String(target) === sessions ? ["unsafe.jsonl"] : [],
      lstatSync: () => ({ isSymbolicLink: () => false }),
      spawnSync: (file, args, options) => {
        if (file !== "powershell.exe") {
          return { status: 0, stdout: "", stderr: "" };
        }
        const request = JSON.parse(options.input);
        powershellCalls.push({ args, request });
        const repairing = request.operation === "repair";
        const details = request.targets.map((target) => ({
          target,
          exists: true,
          ok: repairing || target !== sessionFile,
          protected: repairing || target !== sessionFile,
          aceCount: repairing || target !== sessionFile ? 1 : 2,
        }));
        return {
          status: repairing ? 0 : 4,
          stdout: JSON.stringify(details),
          stderr: "",
        };
      },
    });

    const sections = await collectCheckupSections({
      deps,
      verifyWindowsAcl: true,
    });
    const permissionCheck = sections
      .find((section) => section.id === "config")
      .checks.find((entry) => entry.id === "private-storage-permissions");
    expect(permissionCheck).toMatchObject({
      level: CHECK_LEVELS.ERR,
      fix: { id: "repair-private-storage", safe: true },
    });
    expect(powershellCalls).toHaveLength(1);
    expect(powershellCalls[0].request.targets).toContain(sessionFile);

    const results = await runCheckupFixes(sections, { deps });
    expect(results).toContainEqual(
      expect.objectContaining({ id: "repair-private-storage", applied: true }),
    );
    expect(powershellCalls).toHaveLength(2);
    expect(powershellCalls[1].request.operation).toBe("repair");
  });

  it("never enumerates children through a private-storage symlink", async () => {
    const home = getHomeDir();
    const sessions = join(home, "sessions");
    const readdirSync = vi.fn((target) => {
      if (String(target) === home) return [];
      throw new Error("must not enumerate a linked directory");
    });
    const deps = fakeDeps({
      platform: () => "linux",
      existsSync: (target) => [home, sessions].includes(String(target)),
      readdirSync,
      lstatSync: (target) => ({
        mode: String(target) === home ? 0o700 : 0o777,
        uid: typeof process.getuid === "function" ? process.getuid() : 0,
        isDirectory: () => true,
        isSymbolicLink: () => String(target) === sessions,
      }),
      chmodSync: vi.fn(),
    });
    const sections = await collectCheckupSections({ deps });
    const permissionCheck = sections
      .find((section) => section.id === "config")
      .checks.find((entry) => entry.id === "private-storage-permissions");
    expect(permissionCheck.level).toBe(CHECK_LEVELS.ERR);
    expect(readdirSync).not.toHaveBeenCalledWith(sessions);
  });

  it("never discovers descendants through a linked CLI home", async () => {
    const home = getHomeDir();
    const readdirSync = vi.fn(() => {
      throw new Error("must not enumerate a linked home");
    });
    const deps = fakeDeps({
      platform: () => "linux",
      existsSync: (target) => String(target) === home,
      readdirSync,
      lstatSync: (target) => ({
        mode: 0o777,
        uid: typeof process.getuid === "function" ? process.getuid() : 0,
        isDirectory: () => true,
        isSymbolicLink: () => String(target) === home,
      }),
      chmodSync: vi.fn(),
    });
    const sections = await collectCheckupSections({ deps });
    const permissionCheck = sections
      .find((section) => section.id === "config")
      .checks.find((entry) => entry.id === "private-storage-permissions");
    expect(permissionCheck.level).toBe(CHECK_LEVELS.ERR);
    expect(
      readdirSync.mock.calls.some(([target]) =>
        String(target).startsWith(home),
      ),
    ).toBe(false);
  });

  t(
    "marks capped scans partial but repairs the full explicit inventory",
    async () => {
      const home = getHomeDir();
      const sessions = join(home, "sessions");
      const entries = Array.from(
        { length: 1001 },
        (_, index) => `session-${String(index).padStart(4, "0")}.jsonl`,
      );
      const modes = new Map([
        [home, 0o700],
        [sessions, 0o700],
        ...entries.map((entry, index) => [
          join(sessions, entry),
          index === 1000 ? 0o644 : 0o600,
        ]),
      ]);
      const deps = fakeDeps({
        platform: () => "linux",
        existsSync: (target) => modes.has(String(target)),
        readdirSync: (target) => (String(target) === sessions ? entries : []),
        lstatSync: (target) => ({
          mode: modes.get(String(target)),
          uid: typeof process.getuid === "function" ? process.getuid() : 0,
          isDirectory: () => [home, sessions].includes(String(target)),
          isSymbolicLink: () => false,
        }),
        chmodSync: (target, mode) => modes.set(String(target), mode),
      });

      const sections = await collectCheckupSections({ deps });
      const permissionCheck = sections
        .find((section) => section.id === "config")
        .checks.find((entry) => entry.id === "private-storage-permissions");
      expect(permissionCheck).toMatchObject({
        level: CHECK_LEVELS.WARN,
        fix: { id: "repair-private-storage", safe: true },
      });
      expect(permissionCheck.detail).toMatch(/partial scan/);

      await runCheckupFixes(sections, { deps });
      expect(modes.get(join(sessions, entries[1000]))).toBe(0o600);
    },
  );

  it("flags an invalid settings layer as err", async () => {
    const deps = fakeDeps({
      existsSync: (p) => String(p).endsWith("settings.json"),
      readFileSync: (p) =>
        String(p).endsWith("settings.json") ? "{broken" : "",
    });
    const sections = await collectCheckupSections({ deps });
    const config = sections.find((s) => s.id === "config");
    const bad = config.checks.filter(
      (c) => c.id === "settings-json" && c.level === CHECK_LEVELS.ERR,
    );
    expect(bad.length).toBeGreaterThan(0);
    expect(bad[0].detail).toMatch(/IGNORED/);
  });

  it("flags stale git worktree entries with a SAFE fix", async () => {
    const execFileSync = vi.fn((_file, args) => {
      if (args.includes("rev-parse")) return "true";
      if (args.includes("--dry-run"))
        return "Removing worktrees/dead: gitdir file points to non-existent location\n";
      return "";
    });
    const deps = fakeDeps({
      execFileSync,
    });
    const sections = await collectCheckupSections({ deps });
    const wt = sections.find((s) => s.id === "worktrees");
    const check = wt.checks.find((c) => c.id === "worktree-prune");
    expect(check.level).toBe(CHECK_LEVELS.WARN);
    expect(check.fix).toEqual(
      expect.objectContaining({ id: "git-worktree-prune", safe: true }),
    );
    expect(execFileSync.mock.calls).toEqual([
      [
        "git",
        ["rev-parse", "--is-inside-work-tree"],
        expect.objectContaining({
          origin: "doctor:git-worktree",
          policy: "allow",
          scope: "diagnostics",
          shell: false,
        }),
      ],
      [
        "git",
        ["worktree", "prune", "--dry-run", "-v"],
        expect.objectContaining({
          origin: "doctor:git-worktree",
          policy: "allow",
          scope: "diagnostics",
          shell: false,
        }),
      ],
    ]);
  });

  it("reports a clean worktree state as ok", async () => {
    const deps = fakeDeps({
      execFileSync: vi.fn((_file, args) =>
        args.includes("rev-parse") ? "true" : "",
      ),
    });
    const sections = await collectCheckupSections({ deps });
    const wt = sections.find((s) => s.id === "worktrees");
    expect(wt.checks[0].level).toBe(CHECK_LEVELS.OK);
  });

  it("flags a settings.json hook under an unknown event in the runtime section", async () => {
    const badSettings = JSON.stringify({
      hooks: {
        PreToolYuse: [{ matcher: "Bash", hooks: [{ command: "./x.sh" }] }],
      },
    });
    const deps = fakeDeps({
      existsSync: (p) => String(p).endsWith("settings.json"),
      readFileSync: (p) =>
        String(p).endsWith("settings.json") ? badSettings : "",
    });
    const sections = await collectCheckupSections({ deps });
    const runtime = sections.find((s) => s.id === "runtime");
    const finding = runtime.checks.find((c) => c.id === "hook-unknown-event");
    expect(finding).toBeTruthy();
    expect(finding.level).toBe(CHECK_LEVELS.WARN);
    expect(finding.name).toMatch(/settings\.json/);
  });

  it("surfaces a circuit-broken async hook from the persisted stats in the runtime section", async () => {
    const statsJson = JSON.stringify({
      "PostToolUse::flaky": {
        id: "PostToolUse::flaky",
        command: "flaky",
        event: "PostToolUse",
        runs: 5,
        failures: 5,
        consecutiveFailures: 5,
        totalMs: 500,
        maxMs: 120,
        lastRunAt: 9,
      },
    });
    const deps = fakeDeps({
      existsSync: (p) => String(p).endsWith("hook-stats.json"),
      readFileSync: (p) =>
        String(p).endsWith("hook-stats.json") ? statsJson : "",
    });
    const sections = await collectCheckupSections({ deps });
    const runtime = sections.find((s) => s.id === "runtime");
    const finding = runtime.checks.find((c) => c.id === "hook-circuit-open");
    expect(finding).toBeTruthy();
    expect(finding.level).toBe(CHECK_LEVELS.ERR);
    expect(finding.name).toMatch(/flaky/);
  });

  it("flags a silently-degraded sandbox (configured but engine unavailable) in the runtime section", async () => {
    const settingsJson = JSON.stringify({
      sandbox: { enabled: true, engine: "docker" },
    });
    const deps = fakeDeps({
      existsSync: (p) => String(p).endsWith("settings.json"),
      readFileSync: (p) =>
        String(p).endsWith("settings.json") ? settingsJson : "",
      // docker probe fails → engine unavailable
      spawnSync: () => ({ error: { code: "ENOENT" }, status: null }),
    });
    const sections = await collectCheckupSections({ deps });
    const runtime = sections.find((s) => s.id === "runtime");
    const finding = runtime.checks.find(
      (c) => c.id === "sandbox-silent-degrade",
    );
    expect(finding).toBeTruthy();
    expect(finding.level).toBe(CHECK_LEVELS.ERR);
    expect(finding.detail).toMatch(/WITHOUT isolation/);
  });

  it("reports an available sandbox as an info (no false degradation alarm)", async () => {
    const settingsJson = JSON.stringify({
      sandbox: { enabled: true, engine: "docker" },
    });
    const deps = fakeDeps({
      existsSync: (p) => String(p).endsWith("settings.json"),
      readFileSync: (p) =>
        String(p).endsWith("settings.json") ? settingsJson : "",
      spawnSync: () => ({ status: 0, stdout: "24.0.0" }),
    });
    const sections = await collectCheckupSections({ deps });
    const runtime = sections.find((s) => s.id === "runtime");
    expect(runtime.checks.some((c) => c.id === "sandbox-silent-degrade")).toBe(
      false,
    );
    expect(runtime.checks.some((c) => c.id === "sandbox-active")).toBe(true);
  });

  it("flags a duplicate skill id (silent shadowing) in the runtime section", async () => {
    const sections = await collectCheckupSections({
      deps: fakeDeps(),
      skillLayerEntries: [
        { id: "deploy", layer: "cli-bundled" },
        { id: "deploy", layer: "project" },
        { id: "unique", layer: "user" },
      ],
    });
    const runtime = sections.find((s) => s.id === "runtime");
    const finding = runtime.checks.find((c) => c.id === "skill-duplicate");
    expect(finding).toBeTruthy();
    expect(finding.level).toBe(CHECK_LEVELS.WARN);
    expect(finding.name).toMatch(/deploy/);
  });

  it("does not flag skills when every id is unique (injected entries)", async () => {
    const sections = await collectCheckupSections({
      deps: fakeDeps(),
      skillLayerEntries: [
        { id: "a", layer: "user" },
        { id: "b", layer: "project" },
      ],
    });
    const runtime = sections.find((s) => s.id === "runtime");
    expect(runtime.checks.some((c) => c.id === "skill-duplicate")).toBe(false);
  });

  it("flags a leaked agent subprocess (worker dead, child alive) with a kill command", async () => {
    const sections = await collectCheckupSections({
      deps: fakeDeps(),
      // Injected snapshot (mirrors opts.skillLayerEntries): an agent child that
      // is alive while its worker parent has died → an orphaned subprocess.
      backgroundProcesses: [
        { pid: 4242, alive: true, parentAlive: false, kind: "agent-child" },
      ],
      activeSessionIds: [],
    });
    const runtime = sections.find((s) => s.id === "runtime");
    const finding = runtime.checks.find((c) => c.id === "orphan-process");
    expect(finding).toBeTruthy();
    expect(finding.level).toBe(CHECK_LEVELS.ERR);
    expect(finding.name).toMatch(/4242/);
    expect(finding.fix).toBeTruthy();
    expect(finding.fix.safe).toBe(false); // killing a process needs judgement
    expect(finding.fix.command).toMatch(/4242/);
  });

  it("flags an agent child whose session is gone as orphaned", async () => {
    const sections = await collectCheckupSections({
      deps: fakeDeps(),
      backgroundProcesses: [
        {
          pid: 99,
          alive: true,
          parentAlive: true,
          sessionId: "sess-gone",
          kind: "agent-child",
        },
      ],
      activeSessionIds: ["sess-live"], // sess-gone is not active
    });
    const runtime = sections.find((s) => s.id === "runtime");
    expect(runtime.checks.some((c) => c.id === "orphan-process")).toBe(true);
  });

  it("does not flag a healthy agent child (parent alive, session active)", async () => {
    const sections = await collectCheckupSections({
      deps: fakeDeps(),
      backgroundProcesses: [
        {
          pid: 7,
          alive: true,
          parentAlive: true,
          sessionId: "s1",
          kind: "agent-child",
        },
      ],
      activeSessionIds: ["s1"],
    });
    const runtime = sections.find((s) => s.id === "runtime");
    expect(runtime.checks.some((c) => c.id === "orphan-process")).toBe(false);
  });

  describe("execution section (P1-7)", () => {
    it("reports a local trusted machine as OK with no policy advisory", async () => {
      const sections = await collectCheckupSections({
        deps: fakeDeps(),
        env: {}, // no SSH/WSL/container markers → local
      });
      const exec = sections.find((s) => s.id === "execution");
      const loc = exec.checks.find((c) => c.id === "execution-location");
      expect(loc.level).toBe(CHECK_LEVELS.OK);
      expect(loc.name).toMatch(/local/);
      expect(exec.checks.some((c) => c.id === "execution-policy")).toBe(false);
    });

    it("warns on a remote SSH environment and lists the fail-closed advisory", async () => {
      const sections = await collectCheckupSections({
        deps: fakeDeps(),
        env: { SSH_CONNECTION: "10.0.0.1 22 10.0.0.2 22" },
      });
      const exec = sections.find((s) => s.id === "execution");
      const loc = exec.checks.find((c) => c.id === "execution-location");
      expect(loc.level).toBe(CHECK_LEVELS.WARN);
      expect(loc.name).toMatch(/ssh/);
      // Remote box + no configured return path → surfaced as a policy advisory.
      const policy = exec.checks.find((c) => c.id === "execution-policy");
      expect(policy.detail).toMatch(/remote-without-return-path/);
    });

    it("detects a container via the /.dockerenv marker", async () => {
      const sections = await collectCheckupSections({
        deps: fakeDeps({ existsSync: (p) => String(p) === "/.dockerenv" }),
        env: {},
      });
      const loc = sections
        .find((s) => s.id === "execution")
        .checks.find((c) => c.id === "execution-location");
      expect(loc.name).toMatch(/container/);
      expect(loc.level).toBe(CHECK_LEVELS.WARN);
    });
  });

  describe("runCheckupFixes", () => {
    it("applies the SAFE stale-job prune, deleting only old .job files", async () => {
      const rmSync = vi.fn();
      const NOW = 100_000_000; // > 24h past epoch, so mtime 0 is stale
      const deps = fakeDeps({
        readdirSync: () => [
          "bg-1.job.111.json", // stale (mtime 0)
          "bg-2.job.222.json", // fresh (mtime == now)
          "bg-1.json", // state file — never touched
        ],
        statSync: (p) =>
          String(p).includes("bg-2") ? { mtimeMs: NOW } : { mtimeMs: 0 },
        rmSync,
        now: () => NOW,
      });
      const sections = [
        {
          id: "background",
          checks: [
            {
              id: "bg-stale-jobs",
              level: "warn",
              fix: { id: "prune-stale-jobs", safe: true },
            },
          ],
        },
      ];
      const results = await runCheckupFixes(sections, { deps });
      expect(results).toEqual([
        expect.objectContaining({ id: "prune-stale-jobs", applied: true }),
      ]);
      expect(rmSync).toHaveBeenCalledTimes(1);
      expect(String(rmSync.mock.calls[0][0])).toContain("bg-1.job.111.json");
    });

    it("runs git worktree prune for the worktree fix", async () => {
      const execFileSync = vi.fn(() => "");
      const sections = [
        {
          id: "worktrees",
          checks: [
            {
              id: "worktree-prune",
              level: "warn",
              fix: { id: "git-worktree-prune", safe: true },
            },
          ],
        },
      ];
      const results = await runCheckupFixes(sections, {
        deps: fakeDeps({ execFileSync }),
      });
      expect(results[0].applied).toBe(true);
      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        ["worktree", "prune"],
        expect.objectContaining({
          origin: "doctor:git-worktree-fix",
          policy: "allow",
          scope: "diagnostics",
          shell: false,
        }),
      );
    });

    it("never executes unsafe fixes", async () => {
      const execFileSync = vi.fn(() => "");
      const rmSync = vi.fn();
      const sections = [
        {
          id: "config",
          checks: [
            {
              id: "config-json",
              level: "err",
              fix: {
                id: "config-invalid",
                safe: false,
                command: "notepad config.json",
              },
            },
          ],
        },
      ];
      const results = await runCheckupFixes(sections, {
        deps: fakeDeps({ execFileSync, rmSync }),
      });
      expect(results).toEqual([]);
      expect(execFileSync).not.toHaveBeenCalled();
      expect(rmSync).not.toHaveBeenCalled();
    });
  });

  it("unsafeFixCommands lists only unsafe fixes with commands", () => {
    const sections = [
      {
        id: "x",
        checks: [
          { id: "a", fix: { id: "a", safe: true, command: "never-shown" } },
          {
            id: "b",
            fix: { id: "b", safe: false, command: "run-me", description: "d" },
          },
          { id: "c", fix: { id: "c", safe: false } }, // no command → skipped
          { id: "d" },
        ],
      },
    ];
    expect(unsafeFixCommands(sections)).toEqual([
      { description: "d", command: "run-me" },
    ]);
  });
});

describe("doctor-checkup — LSP readiness (runtime section)", () => {
  const ROOT = "/proj";
  // A fake project tree: root has a src/ dir + a README; src/ holds two .ts files.
  const lspDeps = () => ({
    readdirSync: (dir) => {
      const d = String(dir).replace(/\\/g, "/");
      if (d === ROOT) return ["src", "README.md"];
      if (d.endsWith("/src")) return ["a.ts", "b.ts"];
      return [];
    },
    statSync: (p) => ({
      isDirectory: () => String(p).replace(/\\/g, "/").endsWith("/src"),
      mtimeMs: 0,
    }),
    existsSync: () => false, // keep every OTHER doctor section a no-op
    readFileSync: () => "",
    rmSync: vi.fn(),
    execFileSync: vi.fn(() => ""),
    now: () => 10_000_000,
  });

  const runtimeChecks = async (deps) => {
    const sections = await collectCheckupSections({ deps, cwd: ROOT });
    return sections.find((s) => s.id === "runtime").checks;
  };

  let origExists;
  beforeEach(() => {
    origExists = registryDeps.existsSync;
  });
  afterEach(() => {
    registryDeps.existsSync = origExists;
  });

  it("warns when the project has TS files but no server is installed", async () => {
    registryDeps.existsSync = () => false; // nothing on PATH / node_modules
    const checks = await runtimeChecks(lspDeps());
    const lsp = checks.find((c) => c.id === "lsp-server-missing");
    expect(lsp).toBeTruthy();
    expect(lsp.level).toBe(CHECK_LEVELS.WARN);
    expect(lsp.detail).toMatch(/typescript file/);
    expect(lsp.detail).toMatch(/text-search/);
  });

  it("stays silent when the language server IS installed", async () => {
    registryDeps.existsSync = () => true; // resolveBin finds a server
    const checks = await runtimeChecks(lspDeps());
    expect(checks.find((c) => c.id === "lsp-server-missing")).toBeUndefined();
  });

  it("emits no LSP finding for a project with no source files", async () => {
    registryDeps.existsSync = () => false;
    const emptyDeps = {
      ...lspDeps(),
      readdirSync: () => ["README.md", "LICENSE"],
      statSync: () => ({ isDirectory: () => false, mtimeMs: 0 }),
    };
    const checks = await runtimeChecks(emptyDeps);
    expect(checks.find((c) => c.id === "lsp-server-missing")).toBeUndefined();
  });
});
