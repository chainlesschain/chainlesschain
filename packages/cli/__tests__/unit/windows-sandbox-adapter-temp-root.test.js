import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installWindowsSandboxAdapterTestRoot,
  relativeCanonicalWindowsSandboxAdapterPath,
  wrapWindowsSandboxAdapterGlobalTeardown,
  WINDOWS_SANDBOX_ADAPTER_TEMP_ROOT_ENV,
} from "../../test/helpers/windows-sandbox-adapter-temp-root.js";

const fixtureParents = new Set();

function createFixtureParent() {
  const fixtureParent = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-win-sandbox-root-test-"),
  );
  fixtureParents.add(fixtureParent);
  return fixtureParent;
}

function removeFixtureTree(targetPath, depth = 0) {
  if (!fs.existsSync(targetPath)) return;
  if (depth > 4) {
    throw new Error(`fixture cleanup exceeded its depth limit: ${targetPath}`);
  }
  const stats = fs.lstatSync(targetPath);
  if (stats.isDirectory() && !stats.isSymbolicLink()) {
    for (const entry of fs.readdirSync(targetPath)) {
      removeFixtureTree(path.join(targetPath, entry), depth + 1);
    }
    fs.rmdirSync(targetPath);
    return;
  }
  fs.unlinkSync(targetPath);
}

function createTrackingFs(overrides = {}) {
  const unlinkSync = vi.fn((...args) => fs.unlinkSync(...args));
  const rmdirSync = vi.fn((...args) => fs.rmdirSync(...args));
  const rmSync = vi.fn(() => {
    throw new Error("recursive rm must never be used");
  });
  return {
    fsApi: {
      ...fs,
      unlinkSync,
      rmdirSync,
      rmSync,
      ...overrides,
    },
    rmSync,
    rmdirSync,
    unlinkSync,
  };
}

function helperDirectory(rootPath, character = "a") {
  return path.join(rootPath, `chainless-win-sandbox-${character.repeat(48)}`);
}

afterEach(() => {
  for (const fixtureParent of [...fixtureParents]) {
    removeFixtureTree(fixtureParent);
    fixtureParents.delete(fixtureParent);
  }
});

describe("Windows sandbox adapter Vitest dedicated temp root", () => {
  it("uses the canonical root for a direct child reached through an 8.3 TEMP alias", () => {
    const rawRootPath = String.raw`C:\Users\RUNNER~1\AppData\Local\Temp\cc-vitest-win-sandbox-Ab12_c`;
    const rootRealPath = String.raw`C:\Users\runneradmin\AppData\Local\Temp\cc-vitest-win-sandbox-Ab12_c`;
    const targetPath = path.win32.join(
      rootRealPath,
      "unknown-contract-artifact.txt",
    );

    expect(
      relativeCanonicalWindowsSandboxAdapterPath({
        rootRealPath,
        targetPath,
        pathApi: path.win32,
      }),
    ).toEqual(["unknown-contract-artifact.txt"]);
    expect(() =>
      relativeCanonicalWindowsSandboxAdapterPath({
        rootRealPath: rawRootPath,
        targetPath,
        pathApi: path.win32,
      }),
    ).toThrow("target is outside the captured canonical root");
  });

  it("derives a nested helper path from the canonical root on every host", () => {
    const rootRealPath = String.raw`C:\Users\runneradmin\AppData\Local\Temp\cc-vitest-win-sandbox-Ab12_c`;
    const helperDirectory = `chainless-win-sandbox-${"a".repeat(48)}`;
    const targetPath = path.win32.join(
      rootRealPath,
      helperDirectory,
      "windows-sandbox-helper.exe",
    );

    expect(
      relativeCanonicalWindowsSandboxAdapterPath({
        rootRealPath,
        targetPath,
        pathApi: path.win32,
      }),
    ).toEqual([helperDirectory, "windows-sandbox-helper.exe"]);
  });

  it("does nothing outside Windows", () => {
    const env = { [WINDOWS_SANDBOX_ADAPTER_TEMP_ROOT_ENV]: "preserve" };
    const fsApi = {
      mkdtempSync: vi.fn(() => {
        throw new Error("must not create a root outside Windows");
      }),
    };

    expect(
      installWindowsSandboxAdapterTestRoot({
        platform: "linux",
        env,
        fsApi,
      }),
    ).toEqual({ installed: false });
    expect(env[WINDOWS_SANDBOX_ADAPTER_TEMP_ROOT_ENV]).toBe("preserve");
    expect(fsApi.mkdtempSync).not.toHaveBeenCalled();
  });

  it("removes only validated direct artifacts with unlink and rmdir", () => {
    const fixtureParent = createFixtureParent();
    const env = { [WINDOWS_SANDBOX_ADAPTER_TEMP_ROOT_ENV]: "previous" };
    const tracking = createTrackingFs();
    const state = installWindowsSandboxAdapterTestRoot({
      platform: "win32",
      env,
      fsApi: tracking.fsApi,
      systemTempDirectory: fixtureParent,
      retryOptions: { attempts: 1 },
    });
    const populatedHelperDirectory = helperDirectory(state.rootPath, "a");
    const emptyHelperDirectory = helperDirectory(state.rootPath, "b");
    fs.mkdirSync(populatedHelperDirectory);
    fs.mkdirSync(emptyHelperDirectory);
    fs.writeFileSync(
      path.join(populatedHelperDirectory, "windows-sandbox-helper.exe"),
      "helper",
      { mode: 0o600 },
    );
    for (const name of [
      `chainless-win-sandbox-${"c".repeat(48)}.dll`,
      `chainless-win-sandbox-invocation-${"d".repeat(48)}.json`,
      `chainless-win-sandbox-identity-${"e".repeat(48)}.json`,
    ]) {
      fs.writeFileSync(path.join(state.rootPath, name), "artifact");
    }

    expect(env[WINDOWS_SANDBOX_ADAPTER_TEMP_ROOT_ENV]).toBe(state.rootPath);
    state.teardown();

    expect(fs.existsSync(state.rootPath)).toBe(false);
    expect(env[WINDOWS_SANDBOX_ADAPTER_TEMP_ROOT_ENV]).toBe("previous");
    expect(tracking.unlinkSync).toHaveBeenCalledTimes(4);
    expect(tracking.rmdirSync).toHaveBeenCalledTimes(3);
    expect(tracking.rmSync).not.toHaveBeenCalled();
  });

  it("rejects unknown content before deleting any validated artifact", () => {
    const fixtureParent = createFixtureParent();
    const env = { [WINDOWS_SANDBOX_ADAPTER_TEMP_ROOT_ENV]: "previous" };
    const tracking = createTrackingFs();
    const state = installWindowsSandboxAdapterTestRoot({
      platform: "win32",
      env,
      fsApi: tracking.fsApi,
      systemTempDirectory: fixtureParent,
      retryOptions: { attempts: 1 },
    });
    const knownPath = path.join(
      state.rootPath,
      `chainless-win-sandbox-${"a".repeat(48)}.dll`,
    );
    const unknownPath = path.join(state.rootPath, "do-not-delete.txt");
    fs.writeFileSync(knownPath, "known");
    fs.writeFileSync(unknownPath, "unknown");

    expect(() => state.teardown()).toThrow(/unknown entry/);

    expect(fs.existsSync(knownPath)).toBe(true);
    expect(fs.existsSync(unknownPath)).toBe(true);
    expect(fs.existsSync(state.rootPath)).toBe(true);
    expect(tracking.unlinkSync).not.toHaveBeenCalled();
    expect(tracking.rmdirSync).not.toHaveBeenCalled();
    expect(env[WINDOWS_SANDBOX_ADAPTER_TEMP_ROOT_ENV]).toBe("previous");
  });

  it("rejects a reparse helper directory and preserves the root", () => {
    const fixtureParent = createFixtureParent();
    let spoofedPath;
    const tracking = createTrackingFs({
      lstatSync(targetPath, options) {
        const stats = fs.lstatSync(targetPath, options);
        if (spoofedPath && path.resolve(targetPath) === spoofedPath) {
          return new Proxy(stats, {
            get(target, property) {
              if (property === "isSymbolicLink") return () => true;
              const value = Reflect.get(target, property, target);
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
        }
        return stats;
      },
    });
    const state = installWindowsSandboxAdapterTestRoot({
      platform: "win32",
      env: {},
      fsApi: tracking.fsApi,
      systemTempDirectory: fixtureParent,
      retryOptions: { attempts: 1 },
    });
    const directoryPath = helperDirectory(state.rootPath);
    fs.mkdirSync(directoryPath);
    spoofedPath = path.resolve(directoryPath);

    expect(() => state.teardown()).toThrow(/non-reparse directory/);

    expect(fs.existsSync(directoryPath)).toBe(true);
    expect(fs.existsSync(state.rootPath)).toBe(true);
    expect(tracking.unlinkSync).not.toHaveBeenCalled();
    expect(tracking.rmdirSync).not.toHaveBeenCalled();
  });

  it("rejects a special file even when it uses an allowed artifact name", () => {
    const fixtureParent = createFixtureParent();
    let specialPath;
    const tracking = createTrackingFs({
      lstatSync(targetPath, options) {
        const stats = fs.lstatSync(targetPath, options);
        if (specialPath && path.resolve(targetPath) === specialPath) {
          return new Proxy(stats, {
            get(target, property) {
              if (property === "isFile") return () => false;
              if (property === "isFIFO") return () => true;
              const value = Reflect.get(target, property, target);
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
        }
        return stats;
      },
    });
    const state = installWindowsSandboxAdapterTestRoot({
      platform: "win32",
      env: {},
      fsApi: tracking.fsApi,
      systemTempDirectory: fixtureParent,
      retryOptions: { attempts: 1 },
    });
    specialPath = path.resolve(
      state.rootPath,
      `chainless-win-sandbox-${"f".repeat(48)}.dll`,
    );
    fs.writeFileSync(specialPath, "special");

    expect(() => state.teardown()).toThrow(/regular, non-link file/);

    expect(fs.existsSync(specialPath)).toBe(true);
    expect(fs.existsSync(state.rootPath)).toBe(true);
    expect(tracking.unlinkSync).not.toHaveBeenCalled();
    expect(tracking.rmdirSync).not.toHaveBeenCalled();
  });

  it("rejects a replaced root identity and restores the environment", () => {
    const fixtureParent = createFixtureParent();
    const env = {};
    let capturedRootPath;
    let spoofIdentity = false;
    const tracking = createTrackingFs({
      lstatSync(targetPath, options) {
        const stats = fs.lstatSync(targetPath, options);
        if (
          spoofIdentity &&
          capturedRootPath &&
          path.resolve(targetPath) === capturedRootPath
        ) {
          return new Proxy(stats, {
            get(target, property) {
              if (property === "ino") {
                return typeof target.ino === "bigint"
                  ? target.ino + 1n
                  : target.ino + 1;
              }
              const value = Reflect.get(target, property, target);
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
        }
        return stats;
      },
    });
    const state = installWindowsSandboxAdapterTestRoot({
      platform: "win32",
      env,
      fsApi: tracking.fsApi,
      systemTempDirectory: fixtureParent,
      retryOptions: { attempts: 1 },
    });
    capturedRootPath = path.resolve(state.rootPath);
    spoofIdentity = true;

    expect(() => state.teardown()).toThrow(/identity changed/);

    expect(fs.existsSync(state.rootPath)).toBe(true);
    expect(env).not.toHaveProperty(WINDOWS_SANDBOX_ADAPTER_TEMP_ROOT_ENV);
    expect(tracking.rmdirSync).not.toHaveBeenCalled();
  });

  it("rejects multiply-linked regular files before deletion", () => {
    const fixtureParent = createFixtureParent();
    const tracking = createTrackingFs();
    const state = installWindowsSandboxAdapterTestRoot({
      platform: "win32",
      env: {},
      fsApi: tracking.fsApi,
      systemTempDirectory: fixtureParent,
      retryOptions: { attempts: 1 },
    });
    const knownPath = path.join(
      state.rootPath,
      `chainless-win-sandbox-${"a".repeat(48)}.dll`,
    );
    const secondLink = path.join(fixtureParent, "second-link.dll");
    fs.writeFileSync(knownPath, "linked");
    fs.linkSync(knownPath, secondLink);

    expect(() => state.teardown()).toThrow(/exactly one filesystem link/);

    expect(fs.existsSync(knownPath)).toBe(true);
    expect(fs.existsSync(secondLink)).toBe(true);
    expect(tracking.unlinkSync).not.toHaveBeenCalled();
    expect(tracking.rmdirSync).not.toHaveBeenCalled();
  });

  it("revalidates the captured root immediately before child deletion", () => {
    const fixtureParent = createFixtureParent();
    let capturedRootPath;
    let rootInspectionCount = 0;
    const tracking = createTrackingFs({
      lstatSync(targetPath, options) {
        const stats = fs.lstatSync(targetPath, options);
        if (capturedRootPath && path.resolve(targetPath) === capturedRootPath) {
          rootInspectionCount += 1;
          if (rootInspectionCount >= 2) {
            return new Proxy(stats, {
              get(target, property) {
                if (property === "ino") {
                  return typeof target.ino === "bigint"
                    ? target.ino + 1n
                    : target.ino + 1;
                }
                const value = Reflect.get(target, property, target);
                return typeof value === "function" ? value.bind(target) : value;
              },
            });
          }
        }
        return stats;
      },
    });
    const state = installWindowsSandboxAdapterTestRoot({
      platform: "win32",
      env: {},
      fsApi: tracking.fsApi,
      systemTempDirectory: fixtureParent,
      retryOptions: { attempts: 1 },
    });
    capturedRootPath = path.resolve(state.rootPath);
    const knownPath = path.join(
      state.rootPath,
      `chainless-win-sandbox-${"a".repeat(48)}.dll`,
    );
    fs.writeFileSync(knownPath, "known");

    expect(() => state.teardown()).toThrow(/identity changed/);

    expect(rootInspectionCount).toBeGreaterThanOrEqual(2);
    expect(fs.existsSync(knownPath)).toBe(true);
    expect(tracking.unlinkSync).not.toHaveBeenCalled();
  });

  it("marks cleanup failures as process failures before rethrowing", () => {
    const processApi = { exitCode: 0 };
    const failure = new Error("cleanup failed");
    const wrapped = wrapWindowsSandboxAdapterGlobalTeardown(
      () => {
        throw failure;
      },
      { processApi },
    );

    expect(() => wrapped()).toThrow(failure);
    expect(processApi.exitCode).toBe(1);
  });

  it("leaves the process exit code unchanged after successful cleanup", () => {
    const processApi = { exitCode: 23 };
    const teardown = vi.fn(() => "clean");
    const wrapped = wrapWindowsSandboxAdapterGlobalTeardown(teardown, {
      processApi,
    });

    expect(wrapped()).toBe("clean");
    expect(teardown).toHaveBeenCalledOnce();
    expect(processApi.exitCode).toBe(23);
  });

  it.runIf(process.platform === "win32")(
    "is inherited by real children and restores the outer global root",
    () => {
      const fixtureParent = createFixtureParent();
      const previousValue = process.env[WINDOWS_SANDBOX_ADAPTER_TEMP_ROOT_ENV];
      const state = installWindowsSandboxAdapterTestRoot({
        env: process.env,
        systemTempDirectory: fixtureParent,
        retryOptions: { attempts: 1 },
      });

      const child = spawnSync(
        process.execPath,
        ["-p", `process.env.${WINDOWS_SANDBOX_ADAPTER_TEMP_ROOT_ENV}`],
        { encoding: "utf8" },
      );
      expect(child.status).toBe(0);
      expect(child.stdout.trim()).toBe(state.rootPath);

      state.teardown();
      expect(process.env[WINDOWS_SANDBOX_ADAPTER_TEMP_ROOT_ENV]).toBe(
        previousValue,
      );
    },
  );
});
