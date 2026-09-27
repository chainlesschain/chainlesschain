import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import broker from "../../src/lib/process-execution-broker/index.js";

const originalNative = broker._native;
afterEach(() => {
  broker._native = originalNative;
  vi.restoreAllMocks();
});

describe.skipIf(process.platform !== "linux")(
  "Broker admission before Linux lifecycle wrapping",
  () => {
    const options = {
      cwd: os.tmpdir(),
      origin: "linux-subreaper-test",
      policy: "allow",
      linuxSubreaper: { graceMs: 50 },
    };
    it("preserves admitted argv, cwd, environment and resource backend", async () => {
      const dir = fs.mkdtempSync(
        path.join(os.tmpdir(), "cc-broker-tree-plan-"),
      );
      try {
        const child = broker.spawn(
          process.execPath,
          [
            "-e",
            "process.stdout.write(JSON.stringify({argv:process.argv.slice(1),cwd:process.cwd(),value:process.env.CC_PLAN_VALUE}))",
            "",
            "中文😀",
          ],
          {
            ...options,
            cwd: dir,
            env: { PATH: "/usr/bin:/bin", CC_PLAN_VALUE: "kept" },
          },
        );
        const errors = [];
        child.on("error", (error) => errors.push(error));
        let output = "";
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
          output += chunk;
        });
        const receipt = await child.ownedProcessTreeClosed;
        expect(errors).toEqual([]);
        expect(JSON.parse(output)).toEqual({
          argv: ["", "中文😀"],
          cwd: dir,
          value: "kept",
        });
        expect(receipt.cleanup.confirmed).toBe(true);
        const audit = broker
          .getAuditLog()
          .findLast((entry) => entry.pid === child.pid);
        expect(audit.sandboxBackend).toBe("linux-prlimit");
        expect(audit.sandboxGuarantees).not.toContain("process-tree");
        expect(audit.processLifecycleReceipt).toEqual(receipt);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("retains a real target exec failure and confirms cleanup separately", async () => {
      const child = broker.spawn("/missing-cc-external-agent", [], options);
      const errors = [];
      child.on("error", (error) => errors.push(error.code));
      child.stdout.resume();
      child.stderr.resume();
      const receipt = await child.ownedProcessTreeClosed;
      // prlimit is the admitted executable. Failure to exec its payload is its
      // actual nonzero exit, not a fabricated supervisor spawn error.
      expect(receipt.cleanup.confirmed).toBe(true);
      expect(child.exitCode).not.toBe(0);
      expect(errors).toEqual([]);
    });

    it.each([
      { shell: true },
      { detached: true },
      { stdio: "inherit" },
      { uid: 0 },
      { linuxSubreaper: { graceMs: 50, helperPath: "/unapproved" } },
    ])(
      "rejects an unsupported launch before native execution: %j",
      (changes) => {
        const native = vi.fn(spawn);
        const compile = vi.fn(spawnSync);
        broker._native = {
          ...originalNative,
          spawn: native,
          spawnSync: compile,
        };
        expect(() =>
          broker.spawn(process.execPath, ["-e", "process.exit(0)"], {
            ...options,
            ...changes,
          }),
        ).toThrow();
        expect(native).not.toHaveBeenCalled();
        expect(compile).not.toHaveBeenCalled();
      },
    );

    it("cannot use supervision to bypass a denied command", () => {
      const native = vi.fn(spawn);
      const compile = vi.fn(spawnSync);
      broker._native = { ...originalNative, spawn: native, spawnSync: compile };
      expect(() =>
        broker.spawn(process.execPath, ["-e", "process.exit(0)"], {
          ...options,
          policy: "deny",
        }),
      ).toThrow();
      expect(native).not.toHaveBeenCalled();
      expect(compile).not.toHaveBeenCalled();
    });
  },
);
