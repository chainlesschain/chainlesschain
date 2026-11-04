import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { input, packet } = require("../fixtures/goal-history.cjs");
const {
  startGoalReplay,
} = require("../../../vscode-extension/src/goal-history.js");
describe("retained history real process lifecycle", () => {
  it.each(["success", "nonzero", "invalid", "cancel"])(
    "waits for a real child through %s",
    async (mode) => {
      const directory = fs.mkdtempSync(
          path.join(os.tmpdir(), "cc-history-process-"),
        ),
        script = path.join(directory, "fixture.cjs");
      fs.writeFileSync(
        script,
        `process.stderr.write('NEVER DISPLAY private path');process.stdout.write(${JSON.stringify(mode === "invalid" ? "invalid" : JSON.stringify(packet()))});${mode === "cancel" ? "setInterval(()=>{},1000);" : mode === "nonzero" ? "process.exitCode=1;" : ""}`,
      );
      let owned, seen;
      const ready = new Promise((resolve) => {
        seen = resolve;
      });
      const outcomes = [];
      const replay = startGoalReplay({
        command: process.execPath,
        cwd: directory,
        input,
        onEnd: (result) => outcomes.push(result),
        deps: {
          spawn(command, args, options) {
            if (command !== process.execPath)
              return spawn(command, args, options);
            owned = spawn(command, [script, ...args], {
              ...options,
              shell: false,
            });
            owned.stdout.once("data", seen);
            return owned;
          },
        },
      });
      try {
        if (mode === "cancel") {
          await ready;
          expect(outcomes).toHaveLength(0);
          await replay.stop();
        }
        const result = await replay.completion;
        expect(result.state).toBe(
          mode === "success"
            ? "saved"
            : mode === "cancel"
              ? "cancelled"
              : "unconfirmed",
        );
        expect(owned.exitCode !== null || owned.signalCode !== null).toBe(true);
        expect(JSON.stringify(result)).not.toContain("NEVER DISPLAY");
      } finally {
        await replay.stop();
        fs.rmSync(directory, { recursive: true, force: true });
      }
    },
    15000,
  );
});
