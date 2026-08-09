import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { expect, test } from "vitest";
import { applyWindowsSandbox } from "../../../src/lib/process-execution-broker/platform-sandbox.js";
import { relativeCanonicalWindowsSandboxAdapterPath } from "../../helpers/windows-sandbox-adapter-temp-root.js";

const mode = process.env.CC_WINDOWS_SANDBOX_CONTRACT_MODE;
const resultPath = process.env.CC_WINDOWS_SANDBOX_CONTRACT_RESULT;
const rootPath = process.env.CC_WINDOWS_SANDBOX_ADAPTER_TEMP_ROOT;

function writeResult(value) {
  fs.writeFileSync(resultPath, `${JSON.stringify(value)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

function sha256File(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
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

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    const timer = setTimeout(() => {
      reject(new Error(`helper READY timeout; stdout=${stdout}`));
    }, 10_000);
    timer.unref?.();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const ready = stdout.match(/READY:(\d+)\r?\n/);
      if (ready) {
        clearTimeout(timer);
        resolve(Number(ready[1]));
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(
        new Error(`helper exited before READY: code=${code} signal=${signal}`),
      );
    });
  });
}

function waitForPidExit(pid) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 10_000;
    const poll = () => {
      if (!isPidAlive(pid)) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(
          new Error(`sandbox target PID ${pid} survived helper termination`),
        );
        return;
      }
      setTimeout(poll, 25);
    };
    poll();
  });
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

test("exercises the selected global teardown contract", async () => {
  expect(process.platform).toBe("win32");
  expect(["success", "unknown", "hard-kill", "locked"]).toContain(mode);
  expect(resultPath).toBeTruthy();
  expect(rootPath).toBeTruthy();
  expect(fs.lstatSync(rootPath).isDirectory()).toBe(true);
  const rootRealPath = fs.realpathSync.native(rootPath);

  if (mode === "success") {
    const artifactPath = path.join(
      rootPath,
      `chainless-win-sandbox-identity-${"a".repeat(48)}.json`,
    );
    fs.writeFileSync(artifactPath, "{}", { flag: "wx" });
    writeResult({ mode, rootPath, artifactPath });
    return;
  }

  if (mode === "unknown") {
    const unknownPath = path.join(rootPath, "unknown-contract-artifact.txt");
    fs.writeFileSync(unknownPath, "preserve-me", { flag: "wx" });
    writeResult({ mode, rootPath, unknownPath });
    return;
  }

  if (mode === "locked") {
    const helperDirectory = path.join(
      rootPath,
      `chainless-win-sandbox-${"c".repeat(48)}`,
    );
    fs.mkdirSync(helperDirectory);
    const helperPath = path.join(helperDirectory, "windows-sandbox-helper.exe");
    fs.writeFileSync(helperPath, "locked-helper", { flag: "wx" });
    writeResult({ mode, rootPath, helperPath });
    return;
  }

  const checkedInHelperPath = path.resolve(
    import.meta.dirname,
    "../../../src/lib/process-execution-broker/windows-sandbox-helper.exe",
  );
  const plan = applyWindowsSandbox(
    fs.realpathSync.native(process.execPath),
    [
      "-e",
      "process.stdout.write(`READY:${process.pid}\\n`); setInterval(() => {}, 1000)",
    ],
    {
      cwd: rootPath,
      shell: false,
      detached: false,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
    { profileName: "default", sync: false },
    {
      platform: "win32",
      windowsAdapterIdleTtlMs: 60_000,
      windowsAdapterTempRoot: rootPath,
    },
  );
  expect(plan.applied, plan.reason).toBe(true);
  const helperPath = path.resolve(plan.command);
  const helperRelativePath = relativeCanonicalWindowsSandboxAdapterPath({
    rootRealPath,
    targetPath: helperPath,
  });
  expect(helperRelativePath).toEqual([
    expect.stringMatching(/^chainless-win-sandbox-[0-9a-f]{48}$/),
    "windows-sandbox-helper.exe",
  ]);
  const checkedInHelperSha256 = sha256File(checkedInHelperPath);
  const materializedHelperSha256 = sha256File(helperPath);
  expect(materializedHelperSha256).toBe(checkedInHelperSha256);

  const child = spawn(plan.command, [...plan.args], { ...plan.options });
  try {
    const targetPid = await waitForReady(child);
    const helperPid = child.pid;
    expect(targetPid).not.toBe(helperPid);
    const exitPromise = waitForExit(child);
    expect(child.kill("SIGKILL")).toBe(true);
    await exitPromise;
    await waitForPidExit(targetPid);
    expect(isPidAlive(helperPid)).toBe(false);
    expect(fs.existsSync(helperPath)).toBe(true);
    writeResult({
      mode,
      rootPath,
      helperPath,
      helperPid,
      targetPid,
      checkedInHelperSha256,
      materializedHelperSha256,
      helperExistedAfterForcedExit: true,
      planCleanupCalled: false,
    });
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }
});
