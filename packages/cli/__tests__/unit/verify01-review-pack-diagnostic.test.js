import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  selectDiagnosticTasks,
  diagnosticCandidate,
  readDiagnosticReceipt,
} from "../../scripts/verify01-review-pack-diagnostic.mjs";
import { VERIFY01_REVIEW_SPECS } from "../../scripts/verify01-review-specs.mjs";

describe("real Docker review diagnostic admission", () => {
  it("partitions all 36 tasks exactly once and rejects invalid shards", () => {
    const tasks = VERIFY01_REVIEW_SPECS.map(({ taskId }) => ({ id: taskId }));
    const shards = Array.from({ length: 6 }, (_, i) =>
      selectDiagnosticTasks(tasks, `${i + 1}/6`),
    );
    expect(shards.every((shard) => shard.length === 6)).toBe(true);
    expect(new Set(shards.flat().map(({ id }) => id)).size).toBe(36);
    for (const shard of ["0/6", "7/6", "1/37", "NaN/6", "1.5/6", "1", "1/0"])
      expect(() => selectDiagnosticTasks(tasks, shard)).toThrow();
  });

  it("imports frozen definitions with their original module identity across workspaces", () => {
    const task = {
      expectedFiles: ["packages/vscode-extension/__tests__/verify-25.test.js"],
    };
    const spec = VERIFY01_REVIEW_SPECS.find(
      ({ taskId }) => taskId === "verify-25",
    );
    const body = diagnosticCandidate(task, spec);
    expect(body).toContain(
      'import "../../cli/__tests__/unit/vscode-ext-draft-store.test.js";',
    );
    expect(body).toContain("not an agent task outcome");
    expect(body).not.toContain("it.skip");
    expect(() => diagnosticCandidate({ expectedFiles: [] }, spec)).toThrow();
  });

  it("binds the actual raw receipt bytes, task, stage and verdict", () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "review-diagnostic-receipt-"),
    );
    fs.mkdirSync(path.join(root, "acceptance-evidence"));
    const name = "verify-01-check-abcd.json";
    const file = path.join(root, "acceptance-evidence", name);
    const receipt = {
      taskId: "verify-01",
      stage: "check",
      pass: false,
      providerAssessed: false,
      productionAttested: false,
    };
    const bytes = Buffer.from(JSON.stringify(receipt));
    const digest = "sha256:" + createHash("sha256").update(bytes).digest("hex");
    const verdict = { pass: false, receipt: name, receiptDigest: digest };
    fs.writeFileSync(file, bytes);
    try {
      expect(
        readDiagnosticReceipt(
          root,
          "verify-01",
          "check",
          JSON.stringify(verdict),
        ).receipt,
      ).toEqual(receipt);
      expect(() =>
        readDiagnosticReceipt(
          root,
          "verify-02",
          "check",
          JSON.stringify(verdict),
        ),
      ).toThrow();
      expect(() =>
        readDiagnosticReceipt(
          root,
          "verify-01",
          "setup",
          JSON.stringify(verdict),
        ),
      ).toThrow();
      expect(() =>
        readDiagnosticReceipt(
          root,
          "verify-01",
          "check",
          JSON.stringify({ ...verdict, pass: true }),
        ),
      ).toThrow();
      expect(() =>
        readDiagnosticReceipt(
          root,
          "verify-01",
          "check",
          JSON.stringify({ ...verdict, receipt: "../forged.json" }),
        ),
      ).toThrow();
      fs.appendFileSync(file, " ");
      expect(() =>
        readDiagnosticReceipt(
          root,
          "verify-01",
          "check",
          JSON.stringify(verdict),
        ),
      ).toThrow(/bytes changed/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
