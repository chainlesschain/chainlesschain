import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execute = promisify(execFile);
const fixture = fileURLToPath(
  new URL("../fixtures/evolution-storage-acl-process.mjs", import.meta.url),
);

describe.skipIf(process.platform !== "win32")(
  "Evolution production Windows ACL backend",
  () => {
    it.each([
      "default",
      "explicit-default",
      "local-ui",
      "custom",
      "custom-local-ui",
    ])(
      "publishes and reopens private durable stores with %s filesystem ports",
      async (mode) => {
        const { stdout } = await execute(process.execPath, [fixture, mode], {
          windowsHide: true,
          timeout: 75_000,
          maxBuffer: 256 * 1024,
        });
        const report = JSON.parse(stdout);
        expect(report.mode).toBe(mode);
        expect(report.observations.map((row) => row.kind)).toEqual([
          "catalog",
          "head",
          "witness",
        ]);
        for (const store of report.observations) {
          expect(store.ownerOnly).toBe(true);
          expect(store.durableReadback).toBe(true);
          if (mode.startsWith("custom")) {
            expect(store.shellCalls).toBeGreaterThan(0);
          } else {
            expect(store.shellCalls).toBe(0);
            expect(store.nativeCalls).toBeGreaterThan(0);
          }
        }
        if (mode.startsWith("custom"))
          expect(report.customReads).toBeGreaterThan(0);
      },
    );
  },
);
