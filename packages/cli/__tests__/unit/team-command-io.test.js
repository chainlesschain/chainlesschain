import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  loadRegistry,
  MAX_TEAM_STATE_BYTES,
  readTeamStateSnapshot,
  writeTeamStateSnapshot,
} from "../../src/commands/team.js";
import { readCollaborationRun } from "../../src/lib/collaboration-run-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, "..", "..", "bin", "chainlesschain.js");

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-team-io-"));
});
afterEach(() => {
  vi.restoreAllMocks();
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

function statProjection(stat, overrides) {
  return new Proxy(stat, {
    get(target, property) {
      if (Object.hasOwn(overrides, property)) return overrides[property];
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function createDirectoryAlias(target, alias) {
  try {
    fs.symlinkSync(
      target,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    return true;
  } catch (error) {
    if (
      process.platform === "win32" &&
      ["EACCES", "EPERM", "ENOTSUP"].includes(error?.code)
    ) {
      return false;
    }
    throw error;
  }
}

function mockParentIdentitySwap(authorityParent) {
  const nativeOpenSync = fs.openSync.bind(fs);
  const nativeFstatSync = fs.fstatSync.bind(fs);
  const nativeLstatSync = fs.lstatSync.bind(fs);
  const authorityIdentity = path
    .resolve(fs.realpathSync.native(authorityParent))
    .toLowerCase();
  let parentDescriptor = null;
  let parentFstats = 0;
  let parentChanged = false;

  vi.spyOn(fs, "openSync").mockImplementation((requested, ...args) => {
    const descriptor = nativeOpenSync(requested, ...args);
    if (
      parentDescriptor === null &&
      path.resolve(String(requested)).toLowerCase() === authorityIdentity
    ) {
      parentDescriptor = descriptor;
    }
    return descriptor;
  });
  vi.spyOn(fs, "fstatSync").mockImplementation((descriptor, options) => {
    const stat = nativeFstatSync(descriptor, options);
    if (descriptor === parentDescriptor) {
      parentFstats += 1;
      if (parentFstats === 2) parentChanged = true;
    }
    return stat;
  });
  vi.spyOn(fs, "lstatSync").mockImplementation((requested, options) => {
    const stat = nativeLstatSync(requested, options);
    if (
      parentChanged &&
      path.resolve(String(requested)).toLowerCase() === authorityIdentity
    ) {
      return statProjection(stat, {
        ino: typeof stat.ino === "bigint" ? stat.ino + 1n : stat.ino + 1,
      });
    }
    return stat;
  });
}

function writeGraph(name, tasks) {
  const f = path.join(dir, name);
  fs.writeFileSync(f, JSON.stringify({ tasks }), "utf8");
  return f;
}

describe("cc team loadRegistry dependsOn validation", () => {
  it("rejects a dependsOn key that names no task (typo guard)", () => {
    // Pre-fix: the typo'd dependency made the task permanently unclaimable —
    // the run silently exited 1 and `plan` dropped it from the waves with no
    // diagnosis at all.
    const f = writeGraph("bad.json", [
      { key: "build", title: "build", command: "echo build" },
      {
        key: "test",
        title: "test",
        dependsOn: ["biuld"], // typo
        command: "echo test",
      },
    ]);
    expect(() => loadRegistry(f)).toThrow(/unknown task "biuld"/);
  });

  it("accepts a valid graph (including deps declared before their tasks)", () => {
    const f = writeGraph("good.json", [
      { key: "test", title: "test", dependsOn: ["build"], command: "x" },
      { key: "build", title: "build", command: "y" },
    ]);
    const reg = loadRegistry(f);
    expect(
      reg
        .list()
        .map((t) => t.key)
        .sort(),
    ).toEqual(["build", "test"]);
  });

  it("rejects a graph beyond the bounded 10,000-task governance limit", () => {
    const f = writeGraph(
      "too-large.json",
      Array.from({ length: 10_001 }, (_, index) => ({
        key: `task-${index}`,
        title: `Task ${index}`,
      })),
    );
    expect(() => loadRegistry(f)).toThrow(/safe maximum is 10000/);
  });

  it("rejects an oversized task file before parsing it", () => {
    const f = path.join(dir, "oversized.json");
    fs.writeFileSync(f, "{}", "utf8");
    fs.truncateSync(f, MAX_TEAM_STATE_BYTES + 1);

    expect(() => loadRegistry(f)).toThrow(/task file exceeds the safe/);
  });

  it("rejects unstable task keys and malformed dependency containers", () => {
    const badKey = writeGraph("bad-key.json", [
      { key: "  unstable  ", title: "bad" },
    ]);
    expect(() => loadRegistry(badKey)).toThrow(/stable non-empty string key/);

    const badDeps = writeGraph("bad-deps.json", [
      { key: "a", title: "bad", dependsOn: "not-an-array" },
    ]);
    expect(() => loadRegistry(badDeps)).toThrow(
      /dependencies must be an array/,
    );
  });
});

describe(
  "cc team run --state atomic persistence (CLI-level)",
  { timeout: 60_000 },
  () => {
    it("writes through a directory alias to the canonical state parent", () => {
      const canonicalParent = path.join(dir, "canonical-state");
      const aliasParent = path.join(dir, "state-alias");
      fs.mkdirSync(canonicalParent);
      if (!createDirectoryAlias(canonicalParent, aliasParent)) return;

      const aliasedState = path.join(aliasParent, "state.json");
      const canonicalState = path.join(
        fs.realpathSync.native(canonicalParent),
        "state.json",
      );
      writeTeamStateSnapshot(aliasedState, {
        version: 6,
        stateId: "team_state_alias_writer",
      });

      expect(JSON.parse(fs.readFileSync(canonicalState, "utf8"))).toMatchObject(
        {
          version: 6,
          stateId: "team_state_alias_writer",
        },
      );
      expect(
        fs.readdirSync(canonicalParent).filter((name) => name.endsWith(".tmp")),
      ).toEqual([]);
    });

    it("maps a parent identity swap to a team-state domain error", () => {
      const authorityParent = path.join(dir, "trusted-state");
      fs.mkdirSync(authorityParent);
      const state = path.join(authorityParent, "state.json");
      mockParentIdentitySwap(authorityParent);

      let failure = null;
      try {
        writeTeamStateSnapshot(state, {
          version: 6,
          stateId: "team_state_parent_swap",
        });
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeTruthy();
      expect(failure.message).toMatch(/Team state parent identity is unsafe/u);
      expect(String(failure.code || "")).not.toMatch(/^SECURE_/u);
      expect(
        fs.readdirSync(authorityParent).filter((name) => name.endsWith(".tmp")),
      ).toEqual([]);
    });

    it("maps a read-side parent swap without leaking a SECURE code", () => {
      const authorityParent = path.join(dir, "trusted-read-state");
      fs.mkdirSync(authorityParent);
      const state = path.join(authorityParent, "state.json");
      writeTeamStateSnapshot(state, {
        version: 6,
        stateId: "team_state_read_parent_swap",
      });
      mockParentIdentitySwap(authorityParent);

      let failure = null;
      try {
        readTeamStateSnapshot(state);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeTruthy();
      expect(failure.message).toMatch(/Team state parent identity is unsafe/u);
      expect(String(failure.code || "")).not.toMatch(/^SECURE_/u);
      expect(failure.cause?.code).toMatch(/^SECURE_/u);
    });

    it("preserves an O_EXCL collision that this writer did not create", () => {
      const authorityParent = path.join(dir, "exclusive-state");
      fs.mkdirSync(authorityParent);
      const state = path.join(authorityParent, "state.json");
      const nativeOpenSync = fs.openSync.bind(fs);
      let collisionPath = null;

      vi.spyOn(fs, "openSync").mockImplementation(
        (requested, flags, ...args) => {
          if (
            collisionPath === null &&
            typeof requested === "string" &&
            requested.endsWith(".tmp") &&
            flags === "wx"
          ) {
            collisionPath = requested;
            const descriptor = nativeOpenSync(requested, "wx", 0o600);
            fs.writeFileSync(descriptor, "foreign\n", "utf8");
            fs.closeSync(descriptor);
            const error = new Error("simulated exclusive-create collision");
            error.code = "EEXIST";
            throw error;
          }
          return nativeOpenSync(requested, flags, ...args);
        },
      );

      expect(() =>
        writeTeamStateSnapshot(state, {
          version: 6,
          stateId: "team_state_exclusive_collision",
        }),
      ).toThrowError(expect.objectContaining({ code: "EEXIST" }));
      expect(collisionPath).toBeTruthy();
      expect(fs.readFileSync(collisionPath, "utf8")).toBe("foreign\n");
      expect(fs.existsSync(state)).toBe(false);
    });

    it("writes the state file via tmp+rename and leaves no .tmp behind", () => {
      const graph = writeGraph("g.json", [
        { key: "a", title: "a", command: "echo a" },
        { key: "b", title: "b", dependsOn: ["a"], command: "echo b" },
      ]);
      const state = path.join(dir, "state.json");
      // Default mode is a dry-run (no side effects) but --state still persists
      // after each settle + at the end.
      execFileSync(
        process.execPath,
        [BIN, "team", "run", "--tasks", graph, "--state", state],
        {
          encoding: "utf8",
          timeout: 60000,
          cwd: dir,
          env: {
            ...process.env,
            CC_COLLABORATION_RUNS_DIR: path.join(dir, "collaboration-runs"),
          },
        },
      );
      const snap = JSON.parse(fs.readFileSync(state, "utf8"));
      expect(snap.version).toBe(6);
      expect(snap.stateId).toMatch(/^team_state_/);
      expect(snap).toHaveProperty("controlCursor");
      expect(snap.adjudicationRunId).toBe(snap.collaborationRunId);
      expect(snap).toHaveProperty("adjudicationCursor");
      expect(snap.registry).toBeTruthy();
      expect(snap.execution).toMatchObject({
        mode: "dry-run",
        permissionMode: "acceptEdits",
      });
      expect(snap.graphProjection).toMatchObject({
        schema: "chainlesschain.team-graph-projection/v1",
        runId: `team:${snap.stateId}`,
        revisionDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        authorityDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        sourceDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        projectionDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        messageGraph: { messages: [], edges: [] },
        handoffs: [],
        custodyEdges: [],
      });
      expect(snap.collaborationCursor).toMatchObject({
        runId: snap.collaborationRunId,
        lastSeq: expect.any(Number),
        journalDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      expect(snap.collaborationRunId).toMatch(/^team-/);
      const runFile = path.join(
        dir,
        "collaboration-runs",
        `${snap.collaborationRunId}.json`,
      );
      expect(fs.existsSync(runFile)).toBe(true);
      const priorRunsDir = process.env.CC_COLLABORATION_RUNS_DIR;
      process.env.CC_COLLABORATION_RUNS_DIR = path.join(
        dir,
        "collaboration-runs",
      );
      let governance;
      try {
        governance = readCollaborationRun(snap.collaborationRunId);
      } finally {
        if (priorRunsDir == null) delete process.env.CC_COLLABORATION_RUNS_DIR;
        else process.env.CC_COLLABORATION_RUNS_DIR = priorRunsDir;
      }
      expect(governance).toMatchObject({
        kind: "team",
        status: "completed",
        owner: `team:${snap.collaborationRunId}`,
        units: [
          { key: "a", status: "completed" },
          { key: "b", status: "completed" },
        ],
      });
      expect(JSON.stringify(governance)).not.toContain("echo a");
      // Atomicity contract: the temp file must have been renamed away.
      expect(
        fs
          .readdirSync(dir)
          .some(
            (name) => name.startsWith("state.json.") && name.endsWith(".tmp"),
          ),
      ).toBe(false);
      expect(fs.existsSync(`${state}.run-lock`)).toBe(false);
    });

    it("fails closed when --resume has no state file", () => {
      const graph = writeGraph("resume-missing.json", [
        { key: "a", title: "a" },
      ]);
      const state = path.join(dir, "missing-state.json");
      let failed = null;
      try {
        execFileSync(
          process.execPath,
          [BIN, "team", "run", "--tasks", graph, "--resume", "--state", state],
          {
            encoding: "utf8",
            timeout: 60000,
            cwd: dir,
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
      } catch (error) {
        failed = error;
      }
      expect(failed).toBeTruthy();
      expect(`${failed.stdout || ""}${failed.stderr || ""}`).toMatch(
        /resume state not found/,
      );
      expect(fs.existsSync(`${state}.run-lock`)).toBe(false);
    });

    it("rejects real execution state inside the agent-writable repository", () => {
      const marker = path.join(dir, "must-not-run.txt");
      const graph = writeGraph("trusted-state.json", [
        {
          key: "a",
          title: "a",
          command: `${JSON.stringify(process.execPath)} -e "require('fs').writeFileSync(${JSON.stringify(marker)}, 'bad')"`,
        },
      ]);
      const state = path.join(dir, "state.json");
      let failed = null;
      try {
        execFileSync(
          process.execPath,
          [BIN, "team", "run", "--tasks", graph, "--exec", "--state", state],
          {
            encoding: "utf8",
            timeout: 60000,
            cwd: dir,
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
      } catch (error) {
        failed = error;
      }
      expect(failed).toBeTruthy();
      expect(`${failed.stdout || ""}${failed.stderr || ""}`).toMatch(
        /outside the agent-writable repository/,
      );
      expect(fs.existsSync(marker)).toBe(false);
      expect(fs.existsSync(`${state}.run-lock`)).toBe(false);
    });

    it("rejects a same-sequence collaboration journal rollback", () => {
      const graph = writeGraph("rollback.json", [{ key: "a", title: "a" }]);
      const state = path.join(dir, "rollback-state.json");
      const collaborationDir = path.join(dir, "collaboration-runs");
      const environment = {
        ...process.env,
        CC_COLLABORATION_RUNS_DIR: collaborationDir,
      };
      execFileSync(
        process.execPath,
        [BIN, "team", "run", "--tasks", graph, "--state", state],
        {
          encoding: "utf8",
          timeout: 60000,
          cwd: dir,
          env: environment,
        },
      );

      const snapshot = JSON.parse(fs.readFileSync(state, "utf8"));
      const journal = path.join(
        collaborationDir,
        `${snapshot.collaborationRunId}.journal.jsonl`,
      );
      const events = fs
        .readFileSync(journal, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(events.at(-1)).toMatchObject({
        seq: snapshot.collaborationCursor.lastSeq,
        type: "run.finalize",
        status: "completed",
      });
      events.at(-1).status = "cancelled";
      fs.writeFileSync(
        journal,
        `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
        "utf8",
      );

      let failed = null;
      try {
        execFileSync(
          process.execPath,
          [BIN, "team", "run", "--tasks", graph, "--resume", "--state", state],
          {
            encoding: "utf8",
            timeout: 60000,
            cwd: dir,
            stdio: ["ignore", "pipe", "pipe"],
            env: environment,
          },
        );
      } catch (error) {
        failed = error;
      }
      expect(failed).toBeTruthy();
      expect(`${failed.stdout || ""}${failed.stderr || ""}`).toMatch(
        /journal diverges from the recovery anchor/,
      );
      expect(fs.existsSync(`${state}.run-lock`)).toBe(false);
    });

    it("surfaces the unknown-dependency error to the CLI user (exit 1 + message)", () => {
      const graph = writeGraph("bad.json", [
        { key: "build", title: "build", command: "echo build" },
        { key: "test", title: "test", dependsOn: ["biuld"], command: "echo t" },
      ]);
      let failed = null;
      try {
        execFileSync(process.execPath, [BIN, "team", "run", "--tasks", graph], {
          encoding: "utf8",
          timeout: 60000,
          cwd: dir,
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            CC_COLLABORATION_RUNS_DIR: path.join(dir, "collaboration-runs"),
          },
        });
      } catch (err) {
        failed = err;
      }
      expect(failed).toBeTruthy();
      const output = `${failed.stdout || ""}${failed.stderr || ""}`;
      expect(output).toMatch(/unknown task "biuld"/);
    });
  },
);
