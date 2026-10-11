import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installCanonicalWindowsTestTemp } from "../../test/helpers/canonical-windows-test-temp.js";
import setupWindowsSandboxAdapterTempRoot from "../../test/global-setup/windows-sandbox-adapter-temp-root.js";
import { WINDOWS_SANDBOX_ADAPTER_TEMP_ROOT_ENV } from "../../test/helpers/windows-sandbox-adapter-temp-root.js";
import { SegmentedMemoryPort } from "../../src/lib/context-memory-kernel/segmented-memory-port.js";
import { createDurableMemoryFixture } from "../../scripts/persistent-capacity-benchmark.mjs";

const roots = [];
const cleanups = [];
const initialExitCode = process.exitCode;
const realpath = (directory) =>
  (fs.realpathSync.native || fs.realpathSync)(directory);

function aliasedTemporaryRoot() {
  const base = realpath(os.tmpdir());
  const root = fs.mkdtempSync(path.join(base, "cc-canonical-test-temp-"));
  roots.push({ base, root });
  const actual = path.join(root, "actual");
  const alias = path.join(root, "trusted-alias");
  fs.mkdirSync(actual);
  fs.symlinkSync(
    actual,
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  for (const key of ["TEMP", "TMP", "TMPDIR"]) vi.stubEnv(key, alias);
  return { actual, alias };
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = initialExitCode;
  for (const { base, root } of roots.splice(0)) {
    // Only remove the canonical, directly allocated fixture owned by this test.
    if (
      path.dirname(realpath(root)) !== base ||
      !path.basename(root).startsWith("cc-canonical-test-temp-")
    )
      throw new Error(
        "fixture cleanup target escaped its captured temporary root",
      );
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("canonical Windows test temporary environment", () => {
  it("allows a Memory write after resolving the trusted allocator alias while rejecting an explicit redirected store", async () => {
    const { actual, alias } = aliasedTemporaryRoot();
    expect(os.tmpdir()).toBe(alias);
    const teardown =
      process.platform === "win32"
        ? setupWindowsSandboxAdapterTempRoot()
        : installCanonicalWindowsTestTemp({ platform: "win32" }).teardown;
    cleanups.push(teardown);
    expect(os.tmpdir()).toBe(actual);
    for (const key of ["TEMP", "TMP", "TMPDIR"])
      expect(process.env[key]).toBe(actual);
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "ordinary-memory-"),
    );
    const filePath = path.join(directory, "memory.json");
    const state = createDurableMemoryFixture(1);
    await new SegmentedMemoryPort({ filePath }).importSnapshot(state);
    expect(
      await new SegmentedMemoryPort({ filePath }).exportSnapshot(),
    ).toEqual(state);

    const redirected = new SegmentedMemoryPort({
      filePath: path.join(alias, "redirected", "memory.json"),
    });
    await expect(redirected.importSnapshot(state)).rejects.toMatchObject({
      code: "CONTEXT_MEMORY_STORE_CORRUPT",
    });
    expect(fs.existsSync(path.join(actual, "redirected"))).toBe(false);
    teardown();
    for (const key of ["TEMP", "TMP", "TMPDIR"])
      expect(process.env[key]).toBe(alias);
  });

  it("restores unset and present values exactly, and is inert outside Windows", () => {
    const env = { TEMP: "original", TMP: "" };
    const original = { ...env };
    const state = installCanonicalWindowsTestTemp({ platform: "win32", env });
    expect(env.TMPDIR).toBe(realpath(os.tmpdir()));
    state.teardown();
    state.teardown();
    expect(env).toEqual(original);
    expect(
      installCanonicalWindowsTestTemp({
        platform: "linux",
        env,
        osApi: {
          tmpdir: () => {
            throw new Error("must not inspect non-Windows temp");
          },
        },
      }),
    ).toEqual({ installed: false });
    expect(env).toEqual(original);
  });

  it.runIf(process.platform === "win32")(
    "restores the aliased environment if sandbox setup fails",
    () => {
      const { alias } = aliasedTemporaryRoot();
      vi.spyOn(fs, "mkdtempSync").mockImplementation(() => {
        throw new Error("injected sandbox setup failure");
      });
      expect(setupWindowsSandboxAdapterTempRoot).toThrow(
        "injected sandbox setup failure",
      );
      for (const key of ["TEMP", "TMP", "TMPDIR"])
        expect(process.env[key]).toBe(alias);
    },
  );

  it.runIf(process.platform === "win32")(
    "restores the environment while preserving a failing sandbox teardown",
    () => {
      const { actual, alias } = aliasedTemporaryRoot();
      const previousSandboxRoot =
        process.env[WINDOWS_SANDBOX_ADAPTER_TEMP_ROOT_ENV];
      const teardown = setupWindowsSandboxAdapterTempRoot();
      cleanups.push(teardown);
      const sandboxRoot = process.env[WINDOWS_SANDBOX_ADAPTER_TEMP_ROOT_ENV];
      expect(path.dirname(sandboxRoot)).toBe(actual);
      const unknown = path.join(sandboxRoot, "preserved-unknown.txt");
      fs.writeFileSync(unknown, "retain failure evidence");
      expect(teardown).toThrow(/unknown entry/);
      expect(fs.readFileSync(unknown, "utf8")).toBe("retain failure evidence");
      expect(process.exitCode).toBe(1);
      expect(process.env[WINDOWS_SANDBOX_ADAPTER_TEMP_ROOT_ENV]).toBe(
        previousSandboxRoot,
      );
      for (const key of ["TEMP", "TMP", "TMPDIR"])
        expect(process.env[key]).toBe(alias);
    },
  );
});
