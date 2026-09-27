import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireLinuxSubreaperHelper,
  consumeLinuxSubreaperHelper,
  LINUX_SUBREAPER_SOURCE_DIGEST,
} from "../../src/lib/process-execution-broker/linux-subreaper-helper.js";
import { spawnLinuxSubreaper } from "../../src/lib/process-execution-broker/linux-subreaper-process.js";

afterEach(() => vi.restoreAllMocks());

describe.skipIf(process.platform !== "linux")(
  "trusted Linux subreaper installation",
  () => {
    const options = { cwd: os.tmpdir(), env: {}, graceMs: 50 };
    const descriptors = () => fs.readdirSync("/proc/self/fd").sort();

    it("builds once, brands single-use leases and pins the unlinked image across launches", async () => {
      const compile = vi.fn(spawnSync);
      const lease = acquireLinuxSubreaperHelper({ spawnSync: compile });
      expect(() => consumeLinuxSubreaperHelper({ ...lease })).toThrow(
        "invalid-or-consumed",
      );
      const borrowed = consumeLinuxSubreaperHelper(lease);
      expect(() => consumeLinuxSubreaperHelper(lease)).toThrow(
        "invalid-or-consumed",
      );
      expect(fs.fstatSync(borrowed.descriptor).nlink).toBe(0);
      expect(borrowed.sourceDigest).toBe(LINUX_SUBREAPER_SOURCE_DIGEST);
      expect(borrowed.imageDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      borrowed.release();
      borrowed.release();
      expect(() => fs.fstatSync(borrowed.descriptor)).toThrow();
      const second = acquireLinuxSubreaperHelper({ spawnSync: compile });
      let inherited;
      const native = (...args) => {
        expect(args[0]).toBe("/proc/self/fd/4");
        inherited = args[2].stdio[4];
        return spawn(...args);
      };
      // A tiny native target observes inherited descriptors before a runtime can
      // reuse their numbers for event-loop handles.
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-helper-fd-test-"));
      try {
        const target = path.join(root, "check-fds");
        const built = spawnSync("/usr/bin/cc", ["-x", "c", "-", "-o", target], {
          input:
            "#include <fcntl.h>\n#include <errno.h>\nint main(void){for(int n=3;n<16;n++){errno=0;if(fcntl(n,F_GETFD)!=-1||errno!=EBADF)return n;}return 0;}\n",
          timeout: 30000,
        });
        expect(built.status).toBe(0);
        const owner = spawnLinuxSubreaper(
          target,
          [],
          { ...options, helper: second },
          { spawn: native },
        );
        expect(() => fs.fstatSync(inherited)).toThrow();
        const receipt = await owner.completion;
        expect(receipt.target).toEqual({ code: 0, signal: 0, spawnErrno: 0 });
        expect(receipt.cleanup.confirmed).toBe(true);
        expect(receipt.helper).toMatchObject({
          sourceDigest: LINUX_SUBREAPER_SOURCE_DIGEST,
          imageDigest: borrowed.imageDigest,
          binding: "unlinked-inherited-fd",
        });
        expect(compile).toHaveBeenCalledOnce();
        expect(compile.mock.calls[0][2].env).toEqual({
          PATH: "/usr/bin:/bin",
          LC_ALL: "C",
        });
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it.each(["native", "platform", "option", "identity", "frame", "spawn"])(
      "releases a valid lease when %s validation fails",
      (kind) => {
        // Warm the image cache before comparing descriptors; one cache FD remains
        // owned for later launches, but failed attempts must not retain leases.
        consumeLinuxSubreaperHelper(
          acquireLinuxSubreaperHelper({ spawnSync }),
        ).release();
        const before = descriptors();
        const helper = acquireLinuxSubreaperHelper({ spawnSync });
        const native = {
          spawn: vi.fn(() => {
            throw new Error("fixture native throw");
          }),
        };
        const plan = { ...options, helper };
        if (kind === "native") native.spawn = null;
        if (kind === "platform") native.platform = "win32";
        if (kind === "option") plan.shell = true;
        if (kind === "identity") plan.helperPath = "/unapproved-helper";
        expect(() =>
          spawnLinuxSubreaper(
            kind === "frame" ? "bad\0command" : "node",
            [],
            plan,
            native,
          ),
        ).toThrow();
        expect(descriptors()).toEqual(before);
        expect(() => consumeLinuxSubreaperHelper(helper)).toThrow(
          "invalid-or-consumed",
        );
      },
    );

    it("redacts failed compiler diagnostics and does not cache the failed build", () => {
      const compile = vi.fn(() => ({
        status: 1,
        stderr: "secret-native-diagnostics",
        error: new Error("private path"),
      }));
      const before = descriptors();
      for (let i = 0; i < 2; i++) {
        expect(() =>
          acquireLinuxSubreaperHelper({ spawnSync: compile }),
        ).toThrow("native-build-failed");
      }
      expect(compile).toHaveBeenCalledTimes(2);
      expect(descriptors()).toEqual(before);
    });

    it("rejects a substituted image even when the compiler seam reports success", () => {
      const before = descriptors();
      const compile = (_command, _args, opts) => {
        fs.writeFileSync(
          `/proc/self/fd/${opts.stdio[3]}/supervisor`,
          "not an ELF image",
        );
        return { status: 0, signal: null };
      };
      expect(() => acquireLinuxSubreaperHelper({ spawnSync: compile })).toThrow(
        "unexpected-helper-image",
      );
      expect(descriptors()).toEqual(before);
    });

    it("rejects changed source bytes before invoking a compiler", () => {
      const read = fs.readSync;
      vi.spyOn(fs, "readSync").mockImplementation((...args) => {
        const count = read(...args);
        if (count > 0) args[1][args[2]] ^= 1;
        return count;
      });
      const compile = vi.fn(spawnSync);
      expect(() => acquireLinuxSubreaperHelper({ spawnSync: compile })).toThrow(
        "source-digest-mismatch",
      );
      expect(compile).not.toHaveBeenCalled();
    });
  },
);
