import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  runCliResult,
} = require("../../../vscode-extension/src/chat/introspect-commands.js");
const drafts = require("../../../vscode-extension/src/goal-drafts.js");
const input = {
  id: "g1",
  name: "creator",
  scope: "project",
  expectedStore: "project-goals-12345678-1234-1234-1234-123456789abc",
  connection: "selected.json",
  record: "reference.json",
  requestId: "stable",
};
const packet = {
  schema: "chainlesschain.goal-create-draft-submission/v1",
  type: "task.create",
  state: "saved",
  goalRef: {
    id: input.id,
    storeId: input.expectedStore,
    revision: 1,
    controlGeneration: 0,
  },
  plugin: { name: input.name, scope: input.scope, version: "1.0.0" },
  grantRef: { id: `goal-external-grant-${"a".repeat(64)}`, epoch: 1 },
  declarationDigest: `sha256:${"b".repeat(64)}`,
  inputDigest: `sha256:${"c".repeat(64)}`,
  requestId: input.requestId,
  record: input.record,
  proposalId: `goal-extension-${"d".repeat(64)}`,
};
describe("creation response capture with actual Node child processes", () => {
  it.each(["success", "nonzero", "oversized", "invalid-utf8", "timeout"])(
    "waits for bounded UTF-8 capture through %s",
    async (mode) => {
      const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), "cc-create-capture-"),
      );
      const script = path.join(directory, "child.cjs");
      const output =
        mode === "invalid-utf8"
          ? "process.stdout.write(Buffer.from([0xc3,0x28]));"
          : `process.stdout.write(${JSON.stringify(mode === "oversized" ? "x".repeat(20000) : JSON.stringify(packet))});`;
      fs.writeFileSync(
        script,
        output +
          (mode === "nonzero"
            ? "process.exitCode=1;"
            : mode === "timeout"
              ? "setInterval(()=>{},1000);"
              : ""),
      );
      let owned;
      try {
        const result = await runCliResult({
          command: process.execPath,
          args: [],
          cwd: directory,
          strictUtf8: true,
          maxBufferBytes: 16384,
          timeoutMs: mode === "timeout" ? 1000 : 10000,
          deps: {
            execFile(_command, _args, options, callback) {
              owned = execFile(
                process.execPath,
                [script],
                { ...options, shell: false },
                callback,
              );
              return owned;
            },
          },
        });
        expect(owned.exitCode !== null || owned.signalCode !== null).toBe(true);
        expect(result.ok).toBe(mode === "success");
        const parsed =
          result.ok && result.code === 0
            ? drafts.creation.parseGoalDraftSubmission(result.stdout, input)
            : null;
        if (mode === "success")
          expect(parsed).toMatchObject({
            state: "saved",
            type: "task.create",
            record: input.record,
          });
        else expect(parsed).toBeNull();
        if (mode === "invalid-utf8")
          expect(result.error).toBe("CLI_OUTPUT_INVALID_UTF8");
        if (mode === "timeout") expect(result.timedOut).toBe(true);
      } finally {
        owned?.kill();
        fs.rmSync(directory, { recursive: true, force: true });
      }
    },
    15000,
  );
});
