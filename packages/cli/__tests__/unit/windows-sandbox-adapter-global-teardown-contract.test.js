import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupWindowsSandboxAdapterTestRoot } from "../../test/helpers/windows-sandbox-adapter-temp-root.js";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(testDirectory, "../..");
const vitestExecutable = path.resolve(
  cliRoot,
  "../../node_modules/vitest/vitest.mjs",
);
const contractConfig = path.join(
  cliRoot,
  "test/fixtures/windows-sandbox-global-teardown/vitest.config.js",
);
const fixtureParents = new Set();

function createFixtureParent() {
  const fixtureParent = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-win-sandbox-contract-"),
  );
  fixtureParents.add(fixtureParent);
  return fixtureParent;
}

function removeFixtureTree(targetPath, depth = 0) {
  if (!fs.existsSync(targetPath)) return;
  if (depth > 3) {
    throw new Error(`contract fixture exceeded depth limit: ${targetPath}`);
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

function expectOwnedContractRoot(descriptor, ownerCapture) {
  expect(descriptor?.rootPath).toBeTruthy();
  expect(ownerCapture).toMatchObject({
    rootPath: descriptor.rootPath,
    systemTempPath: expect.any(String),
    systemTempRealPath: expect.any(String),
    rootRealPath: expect.any(String),
    rootIdentity: {
      dev: expect.any(String),
      ino: expect.any(String),
      birthtime: expect.any(String),
    },
  });
  expect(path.basename(descriptor.rootPath)).toMatch(
    /^cc-vitest-win-sandbox-[A-Za-z0-9_-]{6}$/,
  );
  expect(path.resolve(path.dirname(descriptor.rootPath)).toLowerCase()).toBe(
    path.resolve(ownerCapture.systemTempPath).toLowerCase(),
  );
}

function isPidAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function removeExplicitUnknownFile(rootPath, unknownPath) {
  if (!fs.existsSync(unknownPath)) return;
  expect(path.dirname(path.resolve(unknownPath))).toBe(path.resolve(rootPath));
  const rootStats = fs.lstatSync(rootPath, { bigint: true });
  const fileStats = fs.lstatSync(unknownPath, { bigint: true });
  expect(rootStats.isDirectory()).toBe(true);
  expect(rootStats.isSymbolicLink()).toBe(false);
  expect(fileStats.isFile()).toBe(true);
  expect(fileStats.isSymbolicLink()).toBe(false);
  expect(fileStats.nlink).toBe(1n);
  expect(fs.realpathSync.native(unknownPath).toLowerCase()).toBe(
    path.resolve(unknownPath).toLowerCase(),
  );
  fs.unlinkSync(unknownPath);
}

function cleanupPreservedRoot(descriptor, ownerCapture) {
  const rootPath = descriptor?.rootPath || ownerCapture?.rootPath;
  expect(rootPath).toBeTruthy();
  expect(ownerCapture?.rootPath).toBe(rootPath);
  if (!fs.existsSync(rootPath)) return;
  cleanupWindowsSandboxAdapterTestRoot({
    ...ownerCapture,
    retryOptions: { attempts: 40, delayMs: 25 },
  });
  expect(fs.existsSync(rootPath)).toBe(false);
}

function runContract(mode) {
  const fixtureParent = createFixtureParent();
  const resultPath = path.join(fixtureParent, `${mode}.json`);
  const ownerPath = path.join(fixtureParent, `${mode}.owner.json`);
  const result = spawnSync(
    process.execPath,
    [vitestExecutable, "run", "--config", contractConfig],
    {
      cwd: cliRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CC_WINDOWS_SANDBOX_CONTRACT_MODE: mode,
        CC_WINDOWS_SANDBOX_CONTRACT_OWNER: ownerPath,
        CC_WINDOWS_SANDBOX_CONTRACT_RESULT: resultPath,
        NO_COLOR: "1",
      },
      timeout: 120_000,
      windowsHide: true,
    },
  );
  const descriptor = fs.existsSync(resultPath)
    ? JSON.parse(fs.readFileSync(resultPath, "utf8"))
    : null;
  const ownerCapture = fs.existsSync(ownerPath)
    ? JSON.parse(fs.readFileSync(ownerPath, "utf8"))
    : null;
  return { descriptor, ownerCapture, result };
}

afterEach(() => {
  for (const fixtureParent of [...fixtureParents]) {
    removeFixtureTree(fixtureParent);
    fixtureParents.delete(fixtureParent);
  }
});

describe.runIf(process.platform === "win32")(
  "Windows sandbox adapter real Vitest global teardown contract",
  () => {
    it("exits zero and removes its root on successful teardown", () => {
      const { descriptor, ownerCapture, result } = runContract("success");

      try {
        expect(result.error).toBeUndefined();
        expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
        expect(descriptor?.mode).toBe("success");
        expectOwnedContractRoot(descriptor, ownerCapture);
        expect(fs.existsSync(descriptor.rootPath)).toBe(false);
        expect(fs.existsSync(descriptor.artifactPath)).toBe(false);
      } finally {
        cleanupPreservedRoot(descriptor, ownerCapture);
      }
    }, 150_000);

    it("exits nonzero and preserves unknown content", () => {
      const { descriptor, ownerCapture, result } = runContract("unknown");
      try {
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(1);
        expect(descriptor?.mode).toBe("unknown");
        expectOwnedContractRoot(descriptor, ownerCapture);
        expect(`${result.stdout}\n${result.stderr}`).toContain(
          "contains an unknown entry",
        );
        expect(fs.existsSync(descriptor.rootPath)).toBe(true);
        expect(fs.readFileSync(descriptor.unknownPath, "utf8")).toBe(
          "preserve-me",
        );
      } finally {
        if (descriptor) {
          expect(ownerCapture?.rootPath).toBe(descriptor.rootPath);
          removeExplicitUnknownFile(
            descriptor.rootPath,
            descriptor.unknownPath,
          );
        }
        cleanupPreservedRoot(descriptor, ownerCapture);
      }
      expect(fs.existsSync(ownerCapture.rootPath)).toBe(false);
      expect(fs.existsSync(descriptor.unknownPath)).toBe(false);
    }, 150_000);

    it("cleans a materialized helper after READY and forced termination", () => {
      const { descriptor, ownerCapture, result } = runContract("hard-kill");

      try {
        expect(result.error).toBeUndefined();
        expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
        expect(descriptor?.mode).toBe("hard-kill");
        expectOwnedContractRoot(descriptor, ownerCapture);
        const helperRelativePath = path
          .relative(descriptor.rootPath, descriptor.helperPath)
          .split(path.sep);
        expect(helperRelativePath).toEqual([
          expect.stringMatching(/^chainless-win-sandbox-[0-9a-f]{48}$/),
          "windows-sandbox-helper.exe",
        ]);
        expect(descriptor.materializedHelperSha256).toBe(
          descriptor.checkedInHelperSha256,
        );
        expect(descriptor.helperExistedAfterForcedExit).toBe(true);
        expect(descriptor.planCleanupCalled).toBe(false);
        expect(descriptor.helperPid).not.toBe(descriptor.targetPid);
        expect(isPidAlive(descriptor.helperPid)).toBe(false);
        expect(isPidAlive(descriptor.targetPid)).toBe(false);
        expect(fs.existsSync(descriptor.rootPath)).toBe(false);
        expect(fs.existsSync(descriptor.helperPath)).toBe(false);
      } finally {
        cleanupPreservedRoot(descriptor, ownerCapture);
      }
    }, 150_000);

    it("exits nonzero and preserves a deterministically locked helper", () => {
      const { descriptor, ownerCapture, result } = runContract("locked");
      try {
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(1);
        expect(descriptor?.mode, `${result.stdout}\n${result.stderr}`).toBe(
          "locked",
        );
        expectOwnedContractRoot(descriptor, ownerCapture);
        expect(`${result.stdout}\n${result.stderr}`).toContain(
          "injected locked Windows sandbox helper",
        );
        expect(fs.existsSync(descriptor.rootPath)).toBe(true);
        expect(fs.existsSync(descriptor.helperPath)).toBe(true);
      } finally {
        cleanupPreservedRoot(descriptor, ownerCapture);
      }
      expect(fs.existsSync(ownerCapture.rootPath)).toBe(false);
      expect(fs.existsSync(descriptor.helperPath)).toBe(false);
    }, 150_000);
  },
);
