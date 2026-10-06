import { createHash } from "node:crypto";
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
      version: 1,
      pid: 100,
      workspace: report.stage.workspace,
      scratch: report.stage.scratch,
      observations: report.observations,
    }) +
    "\n";
  report.execution.stdoutSha256 = hash(report.execution.stdout);
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
});

describe.runIf(process.platform === "win32")(
  "native runner failure preservation (mocked factory)",
  () => {
    const roots = [];
    afterEach(() => {
      vi.resetAllMocks();
      for (const root of roots.splice(0))
        fs.rmSync(root, { recursive: true, force: true });
    });
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
      expect(report).toMatchObject({
        diagnosticCompleted: false,
        stageRetained: true,
      });
      expect(report.cleanupError).toMatch(/unconfirmed native cleanup/);
      expect(dispose).toHaveBeenCalledOnce();
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
  },
);
