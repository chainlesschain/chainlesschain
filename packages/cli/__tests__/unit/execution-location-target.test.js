import {
  existsSync,
  linkSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExecutionLocationBinding } from "../../src/lib/execution-location-contract.js";
import { canonicalJson } from "../../src/lib/scheduler-kernel/contract.js";
import {
  collectExecutionLocationTargetResult,
  createExecutionLocationTargetResultCollectionRequest,
  EXECUTION_LOCATION_PROFILE_SCHEMA,
  attestExecutionLocationTarget,
  normalizeExecutionLocationProfile,
  readExecutionLocationProfile,
  resumeExecutionLocationTarget,
} from "../../src/lib/execution-location-target.js";
import { createExecutionLocationResultBundle } from "../../src/lib/execution-location-result.js";

const COMMIT = "a".repeat(40);
const HEAD_HASH = "b".repeat(64);
const TARGET_HEAD_HASH = "c".repeat(64);
const TRANSCRIPT_BYTES = Buffer.from('{"replica":"exact"}\n', "utf8");

function handoffReceipt(attestation, installed = true) {
  const material = {
    schema: "chainlesschain.session-execution-location-handoff-install/v1",
    sessionId: "session-target-1",
    sourceHeadHash: HEAD_HASH,
    sourceEventCount: 7,
    transcriptDigest: `sha256:${createHash("sha256")
      .update(TRANSCRIPT_BYTES)
      .digest("hex")}`,
    handoffId: `sha256:${"d".repeat(64)}`,
    targetHeadHash: TARGET_HEAD_HASH,
    targetEventCount: 8,
    targetFactsDigest: attestation.targetFactsDigest,
    profileDigest: attestation.profileDigest,
    targetEvidenceId: "container-evidence-1",
    attestationDigest: attestation.attestationDigest,
    replicaInstalled: installed,
    handoffAppended: installed,
  };
  return {
    ...material,
    receiptDigest: `sha256:${createHash("sha256")
      .update(
        "chainlesschain.session-execution-location-handoff-install.v1\0",
        "utf8",
      )
      .update(canonicalJson(material, "testHandoffReceipt"), "utf8")
      .digest("hex")}`,
  };
}

function rawProfile(target = "container", overrides = {}) {
  const transport =
    target === "container"
      ? { container: "cc-target" }
      : target === "wsl"
        ? { distro: "Ubuntu-24.04" }
        : overrides.transport;
  return {
    schema: EXECUTION_LOCATION_PROFILE_SCHEMA,
    id: `${target}-profile-1`,
    target,
    evidenceId: `${target}-evidence-1`,
    cliCommand: "/usr/local/bin/chainlesschain",
    cwd: "/work/repo",
    transport,
    expected: {
      platform: "linux",
      arch: "x64",
      cliVersion: "0.200.0-test",
      gitCommit: COMMIT,
      tools: ["chainlesschain-cli", "node"],
    },
    sessionStore: {
      mode: "replicated",
      targetSessionId: "session-target-1",
      headHash: HEAD_HASH,
      eventCount: 7,
    },
    ...overrides,
  };
}

function handoff(target = "container") {
  return {
    allowed: true,
    target: {
      location: target,
      evidenceId: `${target}-evidence-1`,
      dataBoundary: { kind: "declared", root: "/work/repo" },
    },
    transfer: { git: { baseCommit: COMMIT } },
    session: {
      sessionId: "session-target-1",
      headHash: HEAD_HASH,
      eventCount: 7,
    },
  };
}

function currentProjection(
  target = "container",
  observedAt = "2026-08-18T07:00:00.000Z",
  commit = COMMIT,
) {
  return {
    schema: "cc-session-execution-location-authority/v1",
    authority: "current-process-observation",
    binding: createExecutionLocationBinding({
      location: target,
      observed: true,
      observedAt,
      source: {
        cwd: "/work/repo",
        git: {
          root: "/work/repo",
          head: "refs/heads/main",
          commit,
        },
      },
      runtime: {
        platform: "linux",
        arch: "x64",
        nodeVersion: "v22.12.0",
        cliVersion: "0.200.0-test",
        tools: ["chainlesschain-cli", "node"],
      },
      policy: {
        network: "unknown",
        sandbox: "unknown",
        dataBoundary: { kind: "repository", root: "/work/repo" },
      },
    }),
  };
}

function sessionProjection(attestation, receipt) {
  const binding = currentProjection("container").binding;
  return {
    schema: "cc-session-execution-location-authority/v1",
    authority: "verified-session-location-handoff",
    sessionId: "session-target-1",
    headHash: receipt.targetHeadHash,
    eventCount: receipt.targetEventCount,
    bindingEventHash: receipt.targetHeadHash,
    bindingEventCount: receipt.targetEventCount,
    locationHandoff: {
      schema: "chainlesschain.session-execution-location-handoff/v1",
      handoffId: receipt.handoffId,
      source: {
        sessionId: "session-target-1",
        headHash: HEAD_HASH,
        eventCount: 7,
        transcriptDigest: receipt.transcriptDigest,
      },
      target: {
        profileDigest: attestation.profileDigest,
        targetEvidenceId: "container-evidence-1",
        targetFactsDigest: attestation.targetFactsDigest,
        attestationDigest: attestation.attestationDigest,
        binding,
      },
      eventHash: receipt.targetHeadHash,
      eventCount: receipt.targetEventCount,
      at: "2026-08-18T07:00:01.000Z",
    },
    binding,
  };
}

function sourceAuthority(overrides = {}) {
  return {
    sessionId: "session-target-1",
    headHash: HEAD_HASH,
    eventCount: 7,
    ...overrides,
  };
}

function success(stdout = "") {
  return { status: 0, stdout, stderr: "" };
}

describe("execution location target launch and resume", () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "cc-execution-location-target-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("attests a fixed Docker target command and exposes stable facts separately from time", () => {
    const spawnSync = vi.fn(() =>
      success(JSON.stringify(currentProjection("container"))),
    );
    const profile = rawProfile();
    const first = attestExecutionLocationTarget(
      { profile, handoff: handoff() },
      { spawnSync },
    );
    const second = attestExecutionLocationTarget(
      { profile, handoff: handoff() },
      {
        spawnSync: vi.fn(() =>
          success(
            JSON.stringify(
              currentProjection("container", "2026-08-18T07:01:00.000Z"),
            ),
          ),
        ),
      },
    );

    expect(first.targetFactsDigest).toBe(second.targetFactsDigest);
    expect(first.attestationDigest).not.toBe(second.attestationDigest);
    expect(first.verified).toMatchObject({
      ambientLocation: true,
      gitCommit: true,
      networkPolicy: false,
      sandboxStrength: false,
    });
    expect(spawnSync).toHaveBeenCalledWith(
      "docker",
      [
        "exec",
        "--workdir",
        "/work/repo",
        "cc-target",
        "/usr/local/bin/chainlesschain",
        "session",
        "location",
        "current",
        "--json",
      ],
      expect.objectContaining({
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  });

  it("re-attests, verifies an exact canonical session replica, then resumes with fixed argv", () => {
    const profile = rawProfile();
    const initial = attestExecutionLocationTarget(
      { profile, handoff: handoff() },
      {
        spawnSync: () => success(JSON.stringify(currentProjection())),
      },
    );
    const prepared = handoffReceipt(initial);
    const spawnSync = vi
      .fn()
      .mockReturnValueOnce(success(JSON.stringify(currentProjection())))
      .mockReturnValueOnce(success(JSON.stringify(prepared)))
      .mockReturnValueOnce(
        success(JSON.stringify(sessionProjection(initial, prepared))),
      )
      .mockReturnValueOnce(success());

    const receipt = resumeExecutionLocationTarget(
      {
        profile,
        handoff: handoff(),
        expectedTargetFactsDigest: initial.targetFactsDigest,
        transcriptBytes: TRANSCRIPT_BYTES,
        readSourceAuthority: () => sourceAuthority(),
      },
      { spawnSync },
    );

    expect(receipt).toMatchObject({
      target: "container",
      command: "session-resume",
      exitStatus: 0,
      sessionStore: {
        mode: "replicated",
        sessionId: "session-target-1",
        headHash: TARGET_HEAD_HASH,
        eventCount: 8,
        authority: "verified-session-location-handoff",
        handoffId: prepared.handoffId,
        transfer: {
          mode: "replicated",
          performed: true,
          installed: true,
          handoffAppended: true,
        },
      },
    });
    expect(receipt.receiptDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(spawnSync.mock.calls[1][1]).toEqual(
      expect.arrayContaining([
        "-i",
        "session",
        "location",
        "prepare",
        "session-target-1",
      ]),
    );
    expect(spawnSync.mock.calls[1][2]).toMatchObject({
      shell: false,
      input: TRANSCRIPT_BYTES,
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect(spawnSync.mock.calls[2][1]).toEqual(
      expect.arrayContaining([
        "session",
        "location",
        "show",
        "session-target-1",
        "--json",
      ]),
    );
    expect(spawnSync.mock.calls[3][1].slice(-3)).toEqual([
      "session",
      "resume",
      "session-target-1",
    ]);
    expect(spawnSync.mock.calls[3][2]).toMatchObject({
      shell: false,
      stdio: "inherit",
    });
  });

  it("collects a result bundle through one fixed target command and revalidates source", () => {
    const profile = rawProfile();
    const initial = attestExecutionLocationTarget(
      { profile, handoff: handoff() },
      { spawnSync: () => success(JSON.stringify(currentProjection())) },
    );
    const prepared = handoffReceipt(initial);
    const bundle = createExecutionLocationResultBundle({
      sessionAuthority: sessionProjection(initial, prepared),
      resultId: "result-collect-1",
      summaryBytes: Buffer.from("completed remotely"),
      diffBytes: Buffer.from("diff --git a/a b/a\n"),
      artifacts: [
        { mediaType: "application/json", bytes: Buffer.from('{"ok":true}') },
      ],
      evidence: [],
    });
    const spawnSync = vi
      .fn()
      .mockReturnValueOnce(success(JSON.stringify(currentProjection())))
      .mockReturnValueOnce(success(JSON.stringify(bundle)));
    const readSourceAuthority = vi.fn(() => sourceAuthority());

    const collected = collectExecutionLocationTargetResult(
      {
        requestId: "collect-request-1",
        profile,
        handoff: handoff(),
        expectedTargetFactsDigest: initial.targetFactsDigest,
        expectedHandoffId: prepared.handoffId,
        resultId: "result-collect-1",
        summaryPath: "summary.txt",
        diffPath: "result.diff",
        artifacts: [{ mediaType: "application/json", path: "artifact.json" }],
        evidence: [],
        readSourceAuthority,
      },
      { spawnSync },
    );

    expect(collected).toMatchObject({
      schema: "cc-execution-location-target-result-collection/v1",
      requestId: "collect-request-1",
      requestDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      resultId: "result-collect-1",
      handoffId: prepared.handoffId,
      bundleDigest: bundle.bundleDigest,
      bundle,
      verification: { applied: false },
      applied: false,
      continuity: "single-fixed-command-response",
      gaps: [
        "returned-result-bytes-not-durable",
        "cross-host-concurrent-writer-fencing-not-durable",
        "returned-result-not-applied",
      ],
    });
    expect(readSourceAuthority).toHaveBeenCalledTimes(2);
    expect(spawnSync.mock.calls[1][1]).toEqual(
      expect.arrayContaining([
        "session",
        "location",
        "result-pack",
        "session-target-1",
        "--result-id",
        "result-collect-1",
        "--summary",
        "summary.txt",
        "--diff",
        "result.diff",
        "--artifact",
        "application/json=artifact.json",
        "--json",
      ]),
    );
    expect(spawnSync.mock.calls[1][2]).toMatchObject({
      shell: false,
      maxBuffer: 24 * 1024 * 1024,
    });
  });

  it("binds a stable collection request id to every fixed target input", () => {
    const input = {
      requestId: "collect-request-stable",
      sessionId: "session-target-1",
      target: "container",
      profile: rawProfile(),
      expectedTargetFactsDigest: `sha256:${"1".repeat(64)}`,
      expectedHandoffId: `sha256:${"2".repeat(64)}`,
      resultId: "result-stable-1",
      summaryPath: "summary.txt",
      diffPath: "result.diff",
      artifacts: [{ mediaType: "application/json", path: "artifact.json" }],
      evidence: [],
    };
    const first = createExecutionLocationTargetResultCollectionRequest(input);
    const retry = createExecutionLocationTargetResultCollectionRequest(input);
    expect(retry.requestDigest).toBe(first.requestDigest);
    expect(
      createExecutionLocationTargetResultCollectionRequest({
        ...input,
        diffPath: "different.diff",
      }).requestDigest,
    ).not.toBe(first.requestDigest);
    expect(() =>
      createExecutionLocationTargetResultCollectionRequest({
        ...input,
        target: "ssh",
      }),
    ).toThrow(/does not match profile/u);
  });

  it("blocks target drift, stale facts approval, and a mismatched session replica", () => {
    const profile = rawProfile();
    const targetDrift = currentProjection(
      "container",
      "2026-08-18T07:00:00.000Z",
      "c".repeat(40),
    );
    expect(() =>
      attestExecutionLocationTarget(
        { profile, handoff: handoff() },
        { spawnSync: () => success(JSON.stringify(targetDrift)) },
      ),
    ).toThrow(/do not match the profile/u);

    expect(() =>
      resumeExecutionLocationTarget(
        {
          profile,
          handoff: handoff(),
          expectedTargetFactsDigest: `sha256:${"d".repeat(64)}`,
          readSourceAuthority: () => sourceAuthority(),
        },
        {
          spawnSync: () => success(JSON.stringify(currentProjection())),
        },
      ),
    ).toThrow(/facts digest changed/u);

    const initial = attestExecutionLocationTarget(
      { profile, handoff: handoff() },
      { spawnSync: () => success(JSON.stringify(currentProjection())) },
    );
    const prepared = handoffReceipt(initial);
    const wrongSession = {
      ...sessionProjection(initial, prepared),
      eventCount: 6,
    };
    const spawnSync = vi
      .fn()
      .mockReturnValueOnce(success(JSON.stringify(currentProjection())))
      .mockReturnValueOnce(success(JSON.stringify(prepared)))
      .mockReturnValueOnce(success(JSON.stringify(wrongSession)));
    expect(() =>
      resumeExecutionLocationTarget(
        {
          profile,
          handoff: handoff(),
          expectedTargetFactsDigest: initial.targetFactsDigest,
          transcriptBytes: TRANSCRIPT_BYTES,
          readSourceAuthority: () => sourceAuthority(),
        },
        { spawnSync },
      ),
    ).toThrow(/canonical session authority does not match/u);
    expect(spawnSync).toHaveBeenCalledTimes(3);
  });

  it("blocks a source head advance after target replica readback", () => {
    const profile = rawProfile();
    const initial = attestExecutionLocationTarget(
      { profile, handoff: handoff() },
      { spawnSync: () => success(JSON.stringify(currentProjection())) },
    );
    const prepared = handoffReceipt(initial);
    const spawnSync = vi
      .fn()
      .mockReturnValueOnce(success(JSON.stringify(currentProjection())))
      .mockReturnValueOnce(success(JSON.stringify(prepared)))
      .mockReturnValueOnce(
        success(JSON.stringify(sessionProjection(initial, prepared))),
      );

    expect(() =>
      resumeExecutionLocationTarget(
        {
          profile,
          handoff: handoff(),
          expectedTargetFactsDigest: initial.targetFactsDigest,
          transcriptBytes: TRANSCRIPT_BYTES,
          readSourceAuthority: () => sourceAuthority({ eventCount: 8 }),
        },
        { spawnSync },
      ),
    ).toThrow(/source session authority changed/u);
    expect(spawnSync).toHaveBeenCalledTimes(3);
  });

  it("uses strict pinned known-hosts SSH invocation and rejects pin drift", () => {
    const knownHosts = join(root, "known_hosts");
    writeFileSync(knownHosts, "example.test ssh-ed25519 AAAATEST\n", "utf8");
    const knownHostsDigest = `sha256:${createHash("sha256")
      .update("example.test ssh-ed25519 AAAATEST\n")
      .digest("hex")}`;
    const profile = rawProfile("ssh", {
      transport: {
        host: "example.test",
        user: "runner",
        port: 2222,
        identityFile: null,
        knownHostsFile: knownHosts,
        knownHostsDigest,
      },
    });
    const spawnSync = vi.fn(() =>
      success(JSON.stringify(currentProjection("ssh"))),
    );
    attestExecutionLocationTarget(
      { profile, handoff: handoff("ssh") },
      { spawnSync },
    );
    const args = spawnSync.mock.calls[0][1];
    expect(args).toContain("StrictHostKeyChecking=yes");
    expect(args).toContain("BatchMode=yes");
    const pinnedAuthorityArg = args.find((arg) =>
      arg.startsWith("UserKnownHostsFile="),
    );
    expect(pinnedAuthorityArg).toBeDefined();
    expect(pinnedAuthorityArg).not.toBe(`UserKnownHostsFile=${knownHosts}`);
    expect(
      existsSync(pinnedAuthorityArg.slice("UserKnownHostsFile=".length)),
    ).toBe(false);
    expect(args).not.toContain("StrictHostKeyChecking=no");
    expect(args.at(-1)).toContain("'session' 'location' 'current' '--json'");

    writeFileSync(knownHosts, "example.test ssh-ed25519 CHANGED\n", "utf8");
    expect(() =>
      attestExecutionLocationTarget(
        { profile, handoff: handoff("ssh") },
        { spawnSync },
      ),
    ).toThrow(/known-hosts authority digest mismatch/u);
    expect(spawnSync).toHaveBeenCalledTimes(1);
  });

  it("builds WSL argv only on Windows hosts", () => {
    const profile = rawProfile("wsl");
    expect(() =>
      attestExecutionLocationTarget(
        { profile, handoff: handoff("wsl") },
        {
          platform: "linux",
          spawnSync: () => success(JSON.stringify(currentProjection("wsl"))),
        },
      ),
    ).toThrow(/requires a Windows host/u);

    const spawnSync = vi.fn(() =>
      success(JSON.stringify(currentProjection("wsl"))),
    );
    attestExecutionLocationTarget(
      { profile, handoff: handoff("wsl") },
      { platform: "win32", spawnSync },
    );
    expect(spawnSync.mock.calls[0][0]).toBe("wsl.exe");
    expect(spawnSync.mock.calls[0][1].slice(0, 7)).toEqual([
      "--distribution",
      "Ubuntu-24.04",
      "--cd",
      "/work/repo",
      "--exec",
      "/usr/local/bin/chainlesschain",
      "session",
    ]);
  });

  it("rejects secret-shaped or schema-drifting profiles", () => {
    expect(() =>
      normalizeExecutionLocationProfile({
        ...rawProfile(),
        token: "sk-abcdefghijklmnopqrstuvwxyz",
      }),
    ).toThrow(/invalid schema/u);
    expect(() =>
      normalizeExecutionLocationProfile({
        ...rawProfile(),
        cliCommand: "Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz",
      }),
    ).toThrow(/secret-shaped/u);
  });

  it("reads strict UTF-8 JSON but rejects hard-linked profile authority", () => {
    const profilePath = join(root, "profile.json");
    writeFileSync(profilePath, JSON.stringify(rawProfile()), "utf8");
    expect(readExecutionLocationProfile(profilePath).profileDigest).toMatch(
      /^sha256:[a-f0-9]{64}$/u,
    );
    linkSync(profilePath, join(root, "profile-link.json"));
    expect(() => readExecutionLocationProfile(profilePath)).toThrow(
      /regular, single-link/u,
    );
  });
});
