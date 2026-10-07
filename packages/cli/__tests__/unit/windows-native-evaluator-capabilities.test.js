import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Script } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
const { createEvaluator } = vi.hoisted(() => ({ createEvaluator: vi.fn() }));
vi.mock(
  "../../src/lib/process-execution-broker/windows-native-evaluator.js",
  () => ({ createWindowsNativeEvaluator: createEvaluator }),
);
import {
  runWindowsNativeEvaluatorCapabilities,
  validateWindowsNativeEvaluatorCapabilitiesReport,
} from "../../src/lib/process-execution-broker/windows-native-evaluator-capabilities.js";

const hash = (value) =>
  "sha256:" + createHash("sha256").update(value).digest("hex");
const PREFIX = "CC_NATIVE_CAPABILITIES:";
const ids = [
  "scratch-environment",
  "esm",
  "worker-threads",
  "child-inherited-stdio",
  "child-file-stdio",
  "child-pipe-stdio",
  "child-fork-ipc",
];
function observation(id, payload) {
  const output = JSON.stringify(payload);
  return {
    id,
    status: "supported",
    timedOut: false,
    code: 0,
    signal: null,
    errorCode: null,
    error: null,
    output,
    outputSha256: hash(output),
    details: {},
    elapsedMs: 1,
  };
}
function rewriteRaw(report) {
  report.execution.stdout =
    PREFIX +
    JSON.stringify({
      version: report.probeId ? 2 : 1,
      ...(report.probeId ? { probeId: report.probeId } : {}),
      pid: 100,
      workspace: report.stage.workspace,
      scratch: report.stage.scratch,
      observations: report.observations,
    }) +
    "\n";
  report.execution.stdoutSha256 = hash(report.execution.stdout);
  const events = [
    { event: "initialization-started" },
    { event: "initialization-settled" },
    ...report.observations.flatMap((item) => [
      { event: "started", id: item.id },
      { event: "settled", id: item.id, observation: item },
    ]),
    { event: "completed" },
  ];
  const raw =
    events
      .map((event, index) =>
        JSON.stringify({
          version: 1,
          sequence: index + 1,
          pid: 100,
          elapsedMs: index,
          ...event,
        }),
      )
      .join("\n") + "\n";
  report.journal = {
    name: "capability-journal.jsonl",
    raw,
    sha256: hash(raw),
    bytes: Buffer.byteLength(raw),
  };
}
function syntheticReport() {
  const scratch = "C:\\private\\scratch",
    workspace = "C:\\private\\workspace";
  const derived = {
    TMP: scratch + "\\tmp",
    TEMP: scratch + "\\tmp",
    HOME: scratch + "\\home",
    USERPROFILE: scratch + "\\home",
    APPDATA: scratch + "\\home\\AppData\\Roaming",
    LOCALAPPDATA: scratch + "\\home\\AppData\\Local",
  };
  const environment = {
    credentialsAbsent: true,
    nodeOptionsAbsent: true,
    credentialKeys: [],
    inheritedKeys: ["PATH", "SystemRoot", "WINDIR"],
    derived,
    tmpdir: derived.TEMP,
    homedir: derived.USERPROFILE,
    proofs: Object.entries(derived).map(([key, value]) => ({
      key,
      path: value,
      value: key,
    })),
  };
  const observations = ids.map((id) =>
    observation(
      id,
      id === "scratch-environment"
        ? environment
        : id === "esm"
          ? { marker: "native-esm-ok" }
          : id === "worker-threads"
            ? { marker: "native-worker-ok", pid: 100, threadId: 1 }
            : {
                marker:
                  id === "child-fork-ipc"
                    ? "native-fork-ok"
                    : "native-child-ok",
                pid: 200,
              },
    ),
  );
  const manifest = {
    workspace,
    scratch,
    check: "C:\\private\\control\\check.cjs",
    files: [
      { path: "C:\\private\\control\\check.cjs", sha256: "b".repeat(64) },
    ],
  };
  const manifestDigest = hash(JSON.stringify(manifest));
  const report = {
    schema: "chainlesschain.windows-native-evaluator-capabilities/v1",
    formalSample: false,
    providerAssessed: false,
    fullReviewPackAssessed: false,
    manifest,
    manifestDigest,
    checkSourceSha256: "sha256:" + "b".repeat(64),
    stage: { workspace, scratch },
    settlement: {
      manifestDigest: manifestDigest.slice(7),
      cleanupConfirmed: true,
      capabilityCount: 0,
      loopbackExemptionAbsent: true,
      executionFailed: false,
      targetExitCode: 0,
      targetPid: 100,
      supervisorUserSidSha256: "a".repeat(64),
    },
    execution: {
      status: 0,
      signal: null,
      error: null,
      stdout: "",
      stderr: "",
      stderrSha256: hash(""),
    },
    observations,
  };
  rewriteRaw(report);
  return report;
}
function replacePayload(item, value) {
  item.output = JSON.stringify(value);
  item.outputSha256 = hash(item.output);
}

describe("native capability validator (synthetic unit controls, not native evidence)", () => {
  it("accepts complete observations with confirmed settlement", () => {
    const result =
      validateWindowsNativeEvaluatorCapabilitiesReport(syntheticReport());
    expect(result).toMatchObject({
      diagnosticCompleted: true,
      allCapabilitiesSupported: true,
    });
    expect(Object.keys(result.capabilities)).toEqual(ids);
  });
  it.each(["child-pipe-stdio", "child-fork-ipc"])(
    "preserves access rejection for %s",
    (id) => {
      const report = syntheticReport();
      Object.assign(
        report.observations.find((item) => item.id === id),
        {
          status: "blocked",
          code: null,
          errorCode: "EPERM",
          error: "spawn EPERM",
          output: "",
          outputSha256: hash(""),
        },
      );
      rewriteRaw(report);
      expect(
        validateWindowsNativeEvaluatorCapabilitiesReport(report),
      ).toMatchObject({
        diagnosticCompleted: true,
        allCapabilitiesSupported: false,
        capabilities: { [id]: "blocked" },
      });
    },
  );
  it("distinguishes a timeout from access denial", () => {
    const report = syntheticReport();
    Object.assign(report.observations.at(-1), {
      status: "timed-out",
      timedOut: true,
      code: null,
      output: "",
      outputSha256: hash(""),
      elapsedMs: 1200,
    });
    rewriteRaw(report);
    expect(
      validateWindowsNativeEvaluatorCapabilitiesReport(report).capabilities[
        "child-fork-ipc"
      ],
    ).toBe("timed-out");
    report.observations.at(-1).status = "blocked";
    rewriteRaw(report);
    expect(() =>
      validateWindowsNativeEvaluatorCapabilitiesReport(report),
    ).toThrow(/actual access error/);
  });
  it.each(["cleanupConfirmed", "loopbackExemptionAbsent"])(
    "rejects an unconfirmed %s fence",
    (key) => {
      const report = syntheticReport();
      report.settlement[key] = false;
      expect(() =>
        validateWindowsNativeEvaluatorCapabilitiesReport(report),
      ).toThrow(/settlement/);
    },
  );
  it("rejects grants, manifest substitution, raw tampering and summary substitution", () => {
    const changes = [
      (report) => {
        report.settlement.capabilityCount = 1;
      },
      (report) => {
        report.settlement.targetPid = 999;
      },
      (report) => {
        report.settlement.executionFailed = true;
      },
      (report) => {
        report.settlement.targetExitCode = 125;
      },
      (report) => {
        report.stage.workspace = "C:\\substituted-workspace";
        rewriteRaw(report);
      },
      (report) => {
        report.manifest.files[0].sha256 = "c".repeat(64);
      },
      (report) => {
        report.execution.stdout += "extra";
      },
      (report) => {
        report.observations = report.observations.slice(1);
      },
    ];
    for (const change of changes) {
      const report = syntheticReport();
      change(report);
      expect(() =>
        validateWindowsNativeEvaluatorCapabilitiesReport(report),
      ).toThrow();
    }
  });
  it("rejects relabeled failure and downgraded success", () => {
    const report = syntheticReport();
    report.observations[5].errorCode = "EPERM";
    rewriteRaw(report);
    expect(() =>
      validateWindowsNativeEvaluatorCapabilitiesReport(report),
    ).toThrow(/cannot advertise support/);
    const other = syntheticReport();
    other.observations[5].status = "failed";
    rewriteRaw(other);
    expect(() =>
      validateWindowsNativeEvaluatorCapabilitiesReport(other),
    ).toThrow(/contradicts raw result/);
  });
  it.each(["TMP", "HOME", "APPDATA"])(
    "rejects a rehashed %s path escaping scratch",
    (key) => {
      const report = syntheticReport(),
        item = report.observations[0],
        payload = JSON.parse(item.output);
      payload.derived[key] = "C:\\host-profile";
      replacePayload(item, payload);
      rewriteRaw(report);
      expect(() =>
        validateWindowsNativeEvaluatorCapabilitiesReport(report),
      ).toThrow(/environment escaped scratch/);
    },
  );
  it("rejects credentials and fabricated worker or child identities", () => {
    const report = syntheticReport(),
      payload = JSON.parse(report.observations[0].output);
    payload.credentialKeys = ["VOLCENGINE_API_KEY"];
    replacePayload(report.observations[0], payload);
    rewriteRaw(report);
    expect(() =>
      validateWindowsNativeEvaluatorCapabilitiesReport(report),
    ).toThrow(/credential environment/);
    for (const index of [2, 3]) {
      const other = syntheticReport(),
        body = JSON.parse(other.observations[index].output);
      body.pid = index === 2 ? 200 : 100;
      replacePayload(other.observations[index], body);
      rewriteRaw(other);
      expect(() =>
        validateWindowsNativeEvaluatorCapabilitiesReport(other),
      ).toThrow(/identity mismatch/);
    }
  });
  it("rejects omitted, duplicated or reordered probes after rehash", () => {
    for (const change of [
      (items) => items.pop(),
      (items) => items.push(items[0]),
      (items) => items.reverse(),
    ]) {
      const report = syntheticReport();
      change(report.observations);
      rewriteRaw(report);
      expect(() =>
        validateWindowsNativeEvaluatorCapabilitiesReport(report),
      ).toThrow(/probe sequence/);
    }
  });
  it("rejects a timed-out root despite successful-looking observations", () => {
    const report = syntheticReport();
    report.execution.status = 125;
    expect(() =>
      validateWindowsNativeEvaluatorCapabilitiesReport(report),
    ).toThrow(/execution incomplete/);
  });
  it("validates bounded partial journal prefixes without granting any capability", () => {
    const report = syntheticReport();
    report.execution.status = 125;
    report.execution.stdout = "";
    report.execution.stdoutSha256 = hash("");
    report.execution.stderr = "Windows sandbox wall-time limit exceeded";
    report.execution.stderrSha256 = hash(report.execution.stderr);
    report.settlement.targetExitCode = 125;
    report.settlement.executionFailed = true;
    const lines = report.journal.raw.trimEnd().split("\n").slice(0, 5);
    report.journal.raw = lines.join("\n") + "\n";
    report.journal.sha256 = hash(report.journal.raw);
    expect(() =>
      validateWindowsNativeEvaluatorCapabilitiesReport(report),
    ).toThrow(/execution timed out; native cleanup confirmed/);
    const result = validateWindowsNativeEvaluatorCapabilitiesReport(report, {
      allowPartial: true,
    });
    expect(result).toMatchObject({
      diagnosticCompleted: false,
      capabilities: {},
      failureKind: "execution-timeout",
      cleanupConfirmed: true,
      journal: { lastPhase: "esm", complete: false },
    });
    expect(result.observedPrefix).toHaveLength(1);
    report.journal.raw += '{"truncated';
    report.journal.sha256 = hash(report.journal.raw);
    expect(
      validateWindowsNativeEvaluatorCapabilitiesReport(report, {
        allowPartial: true,
      }).journal.trailingPartialBytes,
    ).toBeGreaterThan(0);
  });
  it("rejects rehashed journal identity/sequence/digest tampering and extra events", () => {
    for (const alter of [
      (rows) => {
        rows[0].pid = 101;
      },
      (rows) => {
        rows[2].id = "child-fork-ipc";
      },
      (rows) => {
        rows[3].observation.outputSha256 = hash("forged");
      },
      (rows) => {
        rows.push(rows[0]);
      },
    ]) {
      const report = syntheticReport(),
        rows = report.journal.raw.trimEnd().split("\n").map(JSON.parse);
      alter(rows);
      report.journal.raw =
        rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
      report.journal.sha256 = hash(report.journal.raw);
      expect(() =>
        validateWindowsNativeEvaluatorCapabilitiesReport(report),
      ).toThrow(/journal/);
    }
  });
  it("never accepts partial evidence before cleanup confirmation", () => {
    const report = syntheticReport();
    report.execution.status = 125;
    report.settlement.cleanupConfirmed = false;
    expect(() =>
      validateWindowsNativeEvaluatorCapabilitiesReport(report, {
        allowPartial: true,
      }),
    ).toThrow(/native cleanup settlement/);
  });
});

describe.runIf(process.platform === "win32")(
  "native runner failure preservation (mocked factory)",
  () => {
    const roots = [];
    function isolatedFactory({
      timeoutProbe,
      unconfirmedProbe,
      badJournalProbe,
      trace = [],
    } = {}) {
      createEvaluator.mockImplementation((request) => {
        const probeId = JSON.parse(
          request.checkSource.match(/const probeId=("[^"]+");/u)[1],
        );
        trace.push(`create:${probeId}`);
        expect(() => new Script(request.checkSource)).not.toThrow();
        const root = fs.mkdtempSync(
          path.join(fs.realpathSync.native(os.tmpdir()), "cc-isolated-unit-"),
        );
        roots.push(root);
        const scratch = path.join(root, "scratch"),
          workspace = path.join(root, "workspace");
        fs.mkdirSync(scratch);
        const stat = fs.lstatSync(scratch, { bigint: true });
        const check = path.join(root, "check.cjs");
        const manifest = {
          root,
          scratch,
          workspace,
          check,
          wallTimeMs: request.wallTimeMs,
          runtime: {
            path: path.join(root, "node.exe"),
            sha256: "c".repeat(64),
            bytes: 1024,
          },
          directories: [
            { path: scratch, dev: String(stat.dev), ino: String(stat.ino) },
          ],
          files: [
            { path: check, sha256: hash(request.checkSource).slice(7) },
            ...request.files.map((name) => ({
              path: path.join(workspace, name),
              sha256: hash(
                fs.readFileSync(path.join(request.sourceRoot, name)),
              ).slice(7),
            })),
          ],
        };
        const manifestDigest = hash(JSON.stringify(manifest)).slice(7);
        const fixture = syntheticReport();
        fixture.probeId = probeId;
        fixture.stage = { root, scratch, workspace };
        fixture.observations = fixture.observations.filter(
          (item) => item.id === probeId,
        );
        if (probeId === "scratch-environment") {
          const payload = JSON.parse(fixture.observations[0].output);
          for (const key of Object.keys(payload.derived)) {
            payload.derived[key] = path.join(
              scratch,
              path.win32.relative("C:\\private\\scratch", payload.derived[key]),
            );
          }
          payload.tmpdir = payload.derived.TEMP;
          payload.homedir = payload.derived.USERPROFILE;
          payload.proofs = Object.entries(payload.derived).map(
            ([key, directory]) => ({ key, path: directory, value: key }),
          );
          replacePayload(fixture.observations[0], payload);
        }
        rewriteRaw(fixture);
        if (timeoutProbe === probeId) {
          fixture.journal.raw =
            fixture.journal.raw.split("\n").slice(0, 3).join("\n") + "\n";
        }
        if (badJournalProbe === probeId)
          fixture.journal.raw = fixture.journal.raw.replace(
            '"pid":100',
            '"pid":999',
          );
        return {
          root,
          manifest,
          manifestDigest,
          execute: vi.fn(async () => {
            trace.push(`execute:${probeId}`);
            if (unconfirmedProbe === probeId)
              throw new Error("native settlement unconfirmed");
            fs.writeFileSync(
              path.join(scratch, "capability-journal.jsonl"),
              fixture.journal.raw,
              { flag: "wx" },
            );
            trace.push(`settle:${probeId}`);
            return {
              receipt: {
                ...fixture.settlement,
                manifestDigest,
                targetExitCode: timeoutProbe === probeId ? 125 : 0,
                executionFailed: timeoutProbe === probeId,
              },
              result:
                timeoutProbe === probeId
                  ? {
                      status: 125,
                      stdout: "",
                      stderr: "Windows sandbox wall-time limit exceeded",
                    }
                  : { status: 0, stdout: fixture.execution.stdout, stderr: "" },
            };
          }),
          dispose: vi.fn(() => trace.push(`dispose:${probeId}`)),
        };
      });
      return trace;
    }
    afterEach(() => {
      vi.resetAllMocks();
      for (const root of roots.splice(0))
        fs.rmSync(root, { recursive: true, force: true });
    });
    it("isolates all seven probes and validates the v2 report without trusting stored summaries", async () => {
      const trace = isolatedFactory();
      const report = await runWindowsNativeEvaluatorCapabilities();
      expect(report.error).toBeUndefined();
      expect(report.validation).toMatchObject({
        diagnosticCompleted: true,
        allCapabilitiesSupported: true,
      });
      expect(report.runs.map((run) => run.probeId)).toEqual(ids);
      expect(new Set(report.runs.map((run) => run.stage.root)).size).toBe(7);
      expect(
        new Set(report.runs.map((run) => run.checkSourceSha256)).size,
      ).toBe(7);
      expect(trace).toEqual(
        ids.flatMap((id) => [
          `create:${id}`,
          `execute:${id}`,
          `settle:${id}`,
          `dispose:${id}`,
        ]),
      );
      report.validation = { capabilities: { esm: "blocked" } };
      expect(
        validateWindowsNativeEvaluatorCapabilitiesReport(report)
          .allCapabilitiesSupported,
      ).toBe(true);
      for (const alter of [
        (r) => r.runs.reverse(),
        (r) => r.runs.pop(),
        (r) => {
          r.runs[1].stage.root = r.runs[0].stage.root;
        },
        (r) => {
          r.runs[6].settlement.cleanupConfirmed = false;
        },
        (r) => {
          r.runs[6].settlement.targetPid = 999;
        },
        (r) => {
          r.runs[6].checkSourceSha256 = r.runs[5].checkSourceSha256;
        },
        (r) => {
          r.runs[6].brokerFiles = [];
        },
        (r) => {
          r.runs[6].sourceFiles[0].sha256 = hash("substitution");
        },
        (r) => {
          r.runs[6].manifest.wallTimeMs += 1;
        },
        (r) => {
          r.runs[6].execution.stdout += "forged";
        },
      ]) {
        const changed = structuredClone(report);
        alter(changed);
        expect(() =>
          validateWindowsNativeEvaluatorCapabilitiesReport(changed, {
            allowPartial: true,
          }),
        ).toThrow();
      }
    });
    it("continues to fork IPC after cleanup-confirmed pipe timeout without granting partial support", async () => {
      const trace = isolatedFactory({ timeoutProbe: "child-pipe-stdio" });
      const root = fs.mkdtempSync(
        path.join(os.tmpdir(), "cc-isolated-evidence-unit-"),
      );
      roots.push(root);
      const evidenceDirectory = path.join(root, "evidence");
      const report = await runWindowsNativeEvaluatorCapabilities({
        evidenceDirectory,
      });
      expect(report.error).toBeUndefined();
      expect(report.runs).toHaveLength(7);
      expect(report.validation).toMatchObject({
        diagnosticCompleted: false,
        allCapabilitiesSupported: false,
        capabilities: {},
      });
      expect(report.validation.probeResults.slice(-2)).toMatchObject([
        {
          id: "child-pipe-stdio",
          status: "timed-out",
          diagnosticCompleted: false,
        },
        {
          id: "child-fork-ipc",
          status: "supported",
          diagnosticCompleted: true,
        },
      ]);
      expect(trace.indexOf("settle:child-pipe-stdio")).toBeLessThan(
        trace.indexOf("create:child-fork-ipc"),
      );
      expect(trace).not.toContain("dispose:child-pipe-stdio");
      expect(report.runs[5]).toMatchObject({
        stageRetained: true,
        retentionReason: "diagnostic-incomplete",
      });
      expect(() =>
        validateWindowsNativeEvaluatorCapabilitiesReport(report),
      ).toThrow(/timed out/);
      expect(
        validateWindowsNativeEvaluatorCapabilitiesReport(report, {
          allowPartial: true,
        }).capabilities,
      ).toEqual({});
      const relabeled = structuredClone(report);
      relabeled.diagnosticCompleted = true;
      expect(() =>
        validateWindowsNativeEvaluatorCapabilitiesReport(relabeled, {
          allowPartial: true,
        }),
      ).toThrow(/aggregate completion summary/);
      expect(
        JSON.parse(
          fs.readFileSync(path.join(evidenceDirectory, "report.json"), "utf8"),
        ),
      ).toEqual(report);
      expect(
        fs.readFileSync(
          path.join(evidenceDirectory, "child-fork-ipc", "stdout.txt"),
          "utf8",
        ),
      ).toContain("native-fork-ok");
      report.runs[5].observations = [
        observation("child-pipe-stdio", {
          marker: "native-child-ok",
          pid: 200,
        }),
      ];
      expect(
        validateWindowsNativeEvaluatorCapabilitiesReport(report, {
          allowPartial: true,
        }).probeResults[5].status,
      ).toBe("timed-out");
    });
    it("rejects incomplete aggregate labels on fully completed runs", async () => {
      isolatedFactory();
      const report = await runWindowsNativeEvaluatorCapabilities();
      for (const value of [false, undefined, "true"]) {
        report.diagnosticCompleted = value;
        expect(() =>
          validateWindowsNativeEvaluatorCapabilitiesReport(report),
        ).toThrow(/aggregate completion summary/);
      }
    });
    it.each(["platform", "architecture", "nodeVersion", "osRelease"])(
      "binds every Job to the aggregate %s",
      async (field) => {
        isolatedFactory();
        const report = await runWindowsNativeEvaluatorCapabilities();
        const changedHost = structuredClone(report);
        changedHost[field] =
          field === "platform" ? "darwin" : "different-host-value";
        expect(() =>
          validateWindowsNativeEvaluatorCapabilitiesReport(changedHost),
        ).toThrow(/host\/runtime identity/);
        const changedRun = structuredClone(report);
        changedRun.runs[6][field] = "different-host-value";
        expect(() =>
          validateWindowsNativeEvaluatorCapabilitiesReport(changedRun),
        ).toThrow(/host\/runtime identity/);
        for (const row of [report, ...report.runs]) delete row[field];
        expect(() =>
          validateWindowsNativeEvaluatorCapabilitiesReport(report),
        ).toThrow(/host\/runtime identity/);
      },
    );
    it.each(["sha256", "bytes"])(
      "rejects a rehashed %s runtime substitution between Jobs",
      async (field) => {
        isolatedFactory();
        const report = await runWindowsNativeEvaluatorCapabilities();
        const run = report.runs[6];
        run.manifest.runtime[field] =
          field === "sha256" ? "d".repeat(64) : run.manifest.runtime.bytes + 1;
        run.manifestDigest = hash(JSON.stringify(run.manifest));
        run.settlement.manifestDigest = run.manifestDigest.slice(7);
        expect(() =>
          validateWindowsNativeEvaluatorCapabilitiesReport(report),
        ).toThrow(/runtime bytes or digest/);
      },
    );
    it("executes only the selected child probe in the generated fixture (VM mocks)", async () => {
      isolatedFactory();
      await runWindowsNativeEvaluatorCapabilities();
      for (const probeId of ["child-pipe-stdio", "child-fork-ipc"]) {
        const stdout = [],
          journal = [];
        const childProcess = {
          spawnSync: vi.fn(() => ({
            status: 0,
            stdout: JSON.stringify({ marker: "native-child-ok", pid: 200 }),
          })),
          fork: vi.fn(() => {
            const child = new EventEmitter();
            queueMicrotask(() => {
              child.emit("message", { marker: "native-fork-ok", pid: 200 });
              child.emit("exit", 0, null);
            });
            return child;
          }),
        };
        const fixtureFs = {
          openSync: () => 1,
          fsyncSync: () => {},
          closeSync: () => {},
          mkdirSync: () => {},
          writeSync: (_fd, buffer, offset, length) => {
            journal.push(buffer.subarray(offset, offset + length).toString());
            return length;
          },
        };
        const modules = {
          "node:fs": fixtureFs,
          "node:path": path.win32,
          "node:os": {},
          "node:crypto": { createHash },
          "node:child_process": childProcess,
          "node:url": { pathToFileURL },
          "node:worker_threads": { Worker: class {} },
        };
        const source =
          createEvaluator.mock.calls[ids.indexOf(probeId)][0].checkSource;
        await new Script(source).runInNewContext({
          require: (name) => modules[name],
          Buffer,
          setTimeout,
          clearTimeout,
          console,
          process: {
            pid: 100,
            execPath: "C:\\private\\node.exe",
            argv: [
              "node",
              "check",
              "C:\\private\\workspace",
              "C:\\private\\scratch",
            ],
            env: {},
            stdout: { write: (value) => stdout.push(value) },
          },
        });
        const target = JSON.parse(stdout.join("").trim().slice(PREFIX.length));
        expect(target.observations).toHaveLength(1);
        expect(target.observations[0]).toMatchObject({
          id: probeId,
          status: "supported",
        });
        expect(childProcess.spawnSync).toHaveBeenCalledTimes(
          probeId === "child-pipe-stdio" ? 1 : 0,
        );
        expect(childProcess.fork).toHaveBeenCalledTimes(
          probeId === "child-fork-ipc" ? 1 : 0,
        );
        expect(
          journal
            .join("")
            .trim()
            .split("\n")
            .map(JSON.parse)
            .map((event) => event.event),
        ).toEqual([
          "initialization-started",
          "initialization-settled",
          "started",
          "settled",
          "completed",
        ]);
      }
    });
    it.each(["cleanup", "journal"])(
      "stops before another Job when %s validation fails",
      async (kind) => {
        const trace = isolatedFactory(
          kind === "cleanup"
            ? { unconfirmedProbe: "child-pipe-stdio" }
            : { badJournalProbe: "child-pipe-stdio" },
        );
        const report = await runWindowsNativeEvaluatorCapabilities();
        expect(report).toMatchObject({
          diagnosticCompleted: false,
          stoppedAfter: "child-pipe-stdio",
          stageRetained: true,
        });
        expect(createEvaluator).toHaveBeenCalledTimes(6);
        expect(trace).not.toContain("create:child-fork-ipc");
        expect(trace).not.toContain("dispose:child-pipe-stdio");
        expect(() =>
          validateWindowsNativeEvaluatorCapabilitiesReport(report, {
            allowPartial: true,
          }),
        ).toThrow(/sequence/);
      },
    );
    it("archives factory failure and refuses to overwrite evidence", async () => {
      const root = fs.mkdtempSync(
        path.join(os.tmpdir(), "cc-capability-unit-"),
      );
      roots.push(root);
      const evidenceDirectory = path.join(root, "evidence");
      createEvaluator.mockImplementation(() => {
        throw new Error("native capability unavailable");
      });
      const report = await runWindowsNativeEvaluatorCapabilities({
        evidenceDirectory,
      });
      expect(report.diagnosticCompleted).toBe(false);
      expect(report.error).toMatch(/native capability unavailable/);
      expect(
        JSON.parse(
          fs.readFileSync(path.join(evidenceDirectory, "report.json"), "utf8"),
        ),
      ).toEqual(report);
      expect(createEvaluator).toHaveBeenCalledOnce();
      const request = createEvaluator.mock.calls[0][0];
      expect(request.files).toHaveLength(5);
      expect(Buffer.byteLength(request.checkSource)).toBeLessThan(1024 * 1024);
      expect(() => new Script(request.checkSource)).not.toThrow();
      expect(fs.existsSync(request.sourceRoot)).toBe(false);
      await expect(
        runWindowsNativeEvaluatorCapabilities({ evidenceDirectory }),
      ).rejects.toThrow();
      expect(createEvaluator).toHaveBeenCalledOnce();
    });
    it("retains a stage when native settlement is unconfirmed", async () => {
      const dispose = vi.fn(() => {
        throw new Error("unconfirmed native cleanup; stage retained");
      });
      createEvaluator.mockReturnValue({
        root: "C:\\private-stage",
        manifestDigest: "a".repeat(64),
        manifest: {
          workspace: "C:\\private-stage\\workspace",
          scratch: "C:\\private-stage\\scratch",
        },
        execute: vi
          .fn()
          .mockRejectedValue(new Error("native settlement unconfirmed")),
        dispose,
      });
      const report = await runWindowsNativeEvaluatorCapabilities();
      expect(report.runs[0]).toMatchObject({
        diagnosticCompleted: false,
        stageRetained: true,
        retentionReason: "cleanup-unconfirmed",
      });
      expect(report.error).toMatch(/native settlement unconfirmed/);
      expect(dispose).not.toHaveBeenCalled();
    });
    it("rejects unbounded deadlines before policy issuance", async () => {
      for (const options of [
        { probeTimeoutMs: 0 },
        { wallTimeMs: 2000 },
        { wallTimeMs: 60001 },
        { probeTimeoutMs: 5001 },
      ])
        await expect(
          runWindowsNativeEvaluatorCapabilities(options),
        ).rejects.toThrow(/deadlines/);
      expect(createEvaluator).not.toHaveBeenCalled();
    });
    it.each([
      "partial",
      "descriptor-projection",
      "descriptor-substitution",
      "oversize",
      "hardlink",
    ])(
      "retains a cleanup-confirmed incomplete stage and bounds %s journal reads",
      async (kind) => {
        const root = fs.mkdtempSync(
          path.join(fs.realpathSync.native(os.tmpdir()), "cc-capability-unit-"),
        );
        roots.push(root);
        const scratch = path.join(root, "scratch");
        fs.mkdirSync(scratch);
        const journalPath = path.join(scratch, "capability-journal.jsonl");
        const raw =
          syntheticReport()
            .journal.raw.trimEnd()
            .split("\n")
            .slice(0, 3)
            .join("\n") + "\n";
        if (kind === "hardlink") {
          const other = path.join(root, "other.txt");
          fs.writeFileSync(other, raw);
          fs.linkSync(other, journalPath);
        } else
          fs.writeFileSync(
            journalPath,
            kind === "oversize" ? "x".repeat(65537) : raw,
          );
        const dispose = vi.fn();
        createEvaluator.mockImplementation((request) => {
          if (createEvaluator.mock.calls.length > 1)
            throw new Error("stop mock after bounded read");
          const stat = fs.lstatSync(scratch, { bigint: true });
          const manifest = {
            root,
            workspace: path.join(root, "workspace"),
            scratch,
            check: path.join(root, "check.cjs"),
            directories: [
              { path: scratch, dev: String(stat.dev), ino: String(stat.ino) },
            ],
            files: [
              {
                path: path.join(root, "check.cjs"),
                sha256: hash(request.checkSource).slice(7),
              },
            ],
          };
          const digest = hash(JSON.stringify(manifest)).slice(7);
          return {
            root,
            manifest,
            manifestDigest: digest,
            dispose,
            execute: vi.fn().mockResolvedValue({
              receipt: {
                manifestDigest: digest,
                cleanupConfirmed: true,
                capabilityCount: 0,
                loopbackExemptionAbsent: true,
                targetPid: 100,
                targetExitCode: 125,
                executionFailed: true,
                supervisorUserSidSha256: "a".repeat(64),
              },
              result: {
                status: 125,
                signal: null,
                stdout: "",
                stderr: "Windows sandbox wall-time limit exceeded",
              },
            }),
          };
        });
        const evidenceDirectory = path.join(root, "evidence");
        const fstat = fs.fstatSync;
        let reads = 0;
        const statSpy = kind.startsWith("descriptor-")
          ? vi.spyOn(fs, "fstatSync").mockImplementation((...args) => {
              const stat = fstat(...args);
              // Reproduce Windows' pathname/descriptor identity domains.
              // A substitution changes only the second opened handle's ID.
              stat.dev += 100n;
              stat.ino += 100n;
              if (kind === "descriptor-substitution" && ++reads === 2)
                stat.ino += 1n;
              return stat;
            })
          : null;
        let report;
        try {
          const aggregate = await runWindowsNativeEvaluatorCapabilities({
            evidenceDirectory,
          });
          report = aggregate.runs[0];
        } finally {
          statSpy?.mockRestore();
        }
        expect(report).toMatchObject({
          diagnosticCompleted: false,
          stageRetained: true,
          retentionReason: "diagnostic-incomplete",
          settlement: { cleanupConfirmed: true },
        });
        expect(dispose).not.toHaveBeenCalled();
        expect(fs.existsSync(scratch)).toBe(true);
        if (["partial", "descriptor-projection"].includes(kind)) {
          expect(report.validation, report.error).toMatchObject({
            failureKind: "execution-timeout",
            capabilities: {},
            journal: { lastPhase: "scratch-environment" },
          });
          expect(
            fs.readFileSync(
              path.join(
                evidenceDirectory,
                "scratch-environment",
                "capability-journal.jsonl",
              ),
              "utf8",
            ),
          ).toBe(raw);
        } else {
          expect(report.error).toMatch(
            kind === "descriptor-substitution"
              ? /journal identity changed while opening/
              : /journal is linked or exceeds byte bound/,
          );
          expect(report.journal).toBeUndefined();
          expect(
            fs.existsSync(
              path.join(
                evidenceDirectory,
                "scratch-environment",
                "capability-journal.jsonl",
              ),
            ),
          ).toBe(false);
        }
      },
    );
  },
);
