import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  executeControlledExecutionLocationResultApply,
  terminalExecutionLocationResultApplyTransaction,
  verifyExecutionLocationResultApplySourceGit,
} from "../../src/lib/execution-location-result-apply.js";

const temporaryDirectories = [];

function makeDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-result-apply-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function sessionAuthority(root, commit = "a".repeat(40)) {
  return {
    binding: {
      source: { git: { root, commit } },
    },
  };
}

function fakeTransaction() {
  const state = {
    id: "result-apply-transaction",
    checkpointId: "checkpoint-result-apply-transaction",
    state: "prepared",
    requestedCoverage: "partial",
    externalSideEffects: false,
    checkpoint: { digest: `sha256:${"1".repeat(64)}` },
    evidence: null,
  };
  const evidence = (outcome) => ({
    transactionId: state.id,
    checkpointId: state.checkpointId,
    checkpointDigest: state.checkpoint.digest,
    evidenceDigest: `sha256:${(outcome === "committed" ? "2" : "3").repeat(
      64,
    )}`,
    writeManifestDigest: `sha256:${"4".repeat(64)}`,
    coverage: "partial",
    fileCoverage: "partial",
    externalSideEffects: false,
    uncoveredPaths: [".git"],
    outcome,
  });
  return {
    id: state.id,
    checkpointId: state.checkpointId,
    snapshot: vi.fn(() => structuredClone(state)),
    accept: vi.fn(() => {
      state.state = "committed";
      state.evidence = evidence("committed");
      return structuredClone(state.evidence);
    }),
    rollback: vi.fn(() => {
      state.state = "rolled_back";
      state.evidence = evidence("rolled_back");
      return structuredClone(state.evidence);
    }),
  };
}

function brokerWithTransaction(transaction, statuses = [0, 0]) {
  const calls = [];
  return {
    calls,
    beginWorkspaceTransaction: vi.fn(() => transaction),
    spawnSync: vi.fn((command, args, options) => {
      calls.push({ command, args, options });
      const status = statuses.shift();
      return {
        status,
        signal: null,
        stdout: Buffer.alloc(0),
        stderr: status === 0 ? Buffer.alloc(0) : Buffer.from("private error"),
      };
    }),
  };
}

describe("execution-location controlled result apply", () => {
  it("binds the live canonical Git root and exact HEAD", () => {
    const root = makeDirectory();
    const broker = {
      spawnSync: vi
        .fn()
        .mockReturnValueOnce({
          status: 0,
          stdout: Buffer.from(`${root}\n`),
          stderr: Buffer.alloc(0),
        })
        .mockReturnValueOnce({
          status: 0,
          stdout: Buffer.from(`${"a".repeat(40)}\n`),
          stderr: Buffer.alloc(0),
        }),
    };
    const source = verifyExecutionLocationResultApplySourceGit(
      sessionAuthority(root),
      { broker, workspaceRoot: root },
    );
    expect(source).toMatchObject({
      // Match the production canonicalization on Windows, where os.tmpdir()
      // can use an 8.3 alias such as RUNNER~1 on GitHub-hosted runners.
      workspaceRoot: (fs.realpathSync.native || fs.realpathSync)(root),
      sourceGit: { commit: "a".repeat(40) },
    });
    expect(source.sourceGit.rootDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(broker.spawnSync.mock.calls.map((call) => call[1])).toEqual([
      ["rev-parse", "--show-toplevel"],
      ["rev-parse", "--verify", "HEAD"],
    ]);
  });

  it("rejects live Git root or commit drift before a transaction", () => {
    const root = makeDirectory();
    const broker = {
      spawnSync: vi
        .fn()
        .mockReturnValueOnce({
          status: 0,
          stdout: Buffer.from(`${root}\n`),
          stderr: Buffer.alloc(0),
        })
        .mockReturnValueOnce({
          status: 0,
          stdout: Buffer.from(`${"b".repeat(40)}\n`),
          stderr: Buffer.alloc(0),
        }),
    };
    expect(() =>
      verifyExecutionLocationResultApplySourceGit(sessionAuthority(root), {
        broker,
      }),
    ).toThrow(/identity changed/u);
  });

  it("reserves before fixed check/apply commands and commits digest-only evidence", () => {
    const root = makeDirectory();
    const transaction = fakeTransaction();
    const broker = brokerWithTransaction(transaction);
    const order = [];
    broker.spawnSync.mockImplementation((command, args, options) => {
      order.push(args.includes("--check") ? "check" : "apply");
      broker.calls.push({ command, args, options });
      return {
        status: 0,
        signal: null,
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
      };
    });
    const diffBytes = Buffer.from("diff --git a/a b/a\nprivate patch bytes\n");
    const result = executeControlledExecutionLocationResultApply({
      broker,
      sessionId: "apply-session-1",
      applyId: "apply-1",
      workspaceRoot: root,
      diffBytes,
      onPrepared: (prepared) => {
        order.push("reserved");
        expect(prepared).toMatchObject({
          checkpointDigest: `sha256:${"1".repeat(64)}`,
          externalSideEffects: false,
        });
      },
    });

    expect(order).toEqual(["reserved", "check", "apply"]);
    expect(result).toMatchObject({
      ok: true,
      outcome: "applied",
      stage: "complete",
      transaction: {
        evidenceDigest: `sha256:${"2".repeat(64)}`,
        writeManifestDigest: `sha256:${"4".repeat(64)}`,
        externalSideEffects: false,
      },
    });
    expect(transaction.accept).toHaveBeenCalledOnce();
    expect(transaction.rollback).not.toHaveBeenCalled();
    expect(broker.calls.map((call) => call.args)).toEqual([
      ["apply", "--check", "--whitespace=error-all", "-"],
      ["apply", "--whitespace=error-all", "-"],
    ]);
    expect(
      broker.calls.every(
        (call) =>
          call.options.shell === false &&
          call.options.detached === false &&
          call.options.input.equals(diffBytes) &&
          call.options.requiredBoundaries.includes("process-tree"),
      ),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toContain("private patch bytes");
  });

  it("rolls back a failed check without dispatching apply", () => {
    const root = makeDirectory();
    const transaction = fakeTransaction();
    const broker = brokerWithTransaction(transaction, [1]);
    const result = executeControlledExecutionLocationResultApply({
      broker,
      sessionId: "apply-session-2",
      applyId: "apply-2",
      workspaceRoot: root,
      diffBytes: Buffer.from("invalid private patch"),
      onPrepared: vi.fn(),
    });

    expect(result).toMatchObject({
      ok: false,
      outcome: "rolled_back",
      stage: "check",
      process: { exitCode: 1 },
    });
    expect(broker.spawnSync).toHaveBeenCalledOnce();
    expect(transaction.rollback).toHaveBeenCalledOnce();
    expect(transaction.accept).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("private error");
  });

  it("rolls back a failed reservation before any Git apply process", () => {
    const root = makeDirectory();
    const transaction = fakeTransaction();
    const broker = brokerWithTransaction(transaction);
    const error = new Error("private reservation failure");
    const result = executeControlledExecutionLocationResultApply({
      broker,
      sessionId: "apply-session-3",
      applyId: "apply-3",
      workspaceRoot: root,
      diffBytes: Buffer.from("private patch"),
      onPrepared: () => {
        throw error;
      },
    });

    expect(result).toMatchObject({
      ok: false,
      outcome: "rolled_back",
      stage: "reservation",
      error,
    });
    expect(broker.spawnSync).not.toHaveBeenCalled();
    expect(transaction.rollback).toHaveBeenCalledOnce();
  });

  it("rejects nonterminal or evidence-free transaction readback", () => {
    expect(() =>
      terminalExecutionLocationResultApplyTransaction({
        id: "transaction",
        state: "running",
        evidence: null,
      }),
    ).toThrow(/not terminal/u);
  });
});
