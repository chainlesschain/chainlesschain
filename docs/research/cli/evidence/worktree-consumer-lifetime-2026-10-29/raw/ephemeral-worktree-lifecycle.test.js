import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

describe("ephemeral checkout consumer lifetime with real local processes", () => {
  it("refuses unowned background work and retains checkout until foreground settlement", async () => {
    const parent = fs.realpathSync.native(os.tmpdir());
    const directory = fs.mkdtempSync(
      path.join(parent, "cc-worktree-lifetime-"),
    );
    const fixture = fileURLToPath(
      new URL("../fixtures/ephemeral-worktree-lifecycle.mjs", import.meta.url),
    );
    try {
      const result = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [fixture, directory], {
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
        let stdout = "",
          stderr = "";
        const timer = setTimeout(() => child.kill(), 90_000);
        child.on("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.stdout.on("data", (chunk) => {
          stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
        });
        child.on("close", (code, signal) => {
          clearTimeout(timer);
          resolve({ code, signal, stdout, stderr });
        });
      });
      expect(result.code, JSON.stringify(result)).toBe(0);
      const receipt = JSON.parse(
        fs.readFileSync(path.join(directory, "receipt.json"), "utf8"),
      );
      expect(receipt.failure).toBeUndefined();
      expect(receipt.sourcesStable).toBe(true);
      expect(receipt.mainWorktreePathsUnchanged).toBe(true);
      expect(receipt.cases).toHaveLength(5);
      expect(receipt.cases.every((row) => row.passed)).toBe(true);
      const cancelled = receipt.cases.find(
        (row) => row.mode === "foreground-cancel",
      );
      expect(cancelled.atAbort).toMatchObject({
        runSettled: false,
        childAlive: true,
        worktreeExists: true,
        fileExists: true,
      });
      for (const row of receipt.cases.filter(
        (row) => row.mode !== "ordinary-background",
      ))
        expect(row.worktreeExistsAfter).toBe(false);
    } finally {
      if (
        path.dirname(directory) !== parent ||
        !path.basename(directory).startsWith("cc-worktree-lifetime-") ||
        fs.realpathSync.native(directory) !== directory
      )
        throw new Error("Unsafe worktree lifetime fixture cleanup");
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }, 100_000);
});
