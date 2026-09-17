import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const fixture = fileURLToPath(
  new URL("../fixtures/pm-exploration-recovery-process.mjs", import.meta.url),
);

export function runPmExplorationRecoveryProcess(
  root,
  {
    mode = "verify",
    phase = null,
    suffix = "seed",
    barrier = null,
    participant = suffix,
    fault = null,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--max-old-space-size=256",
        fixture,
        root,
        mode,
        phase ?? "-",
        suffix,
        barrier ?? "-",
        participant,
        fault ?? "-",
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          CC_TEST_PM_ARTIFACT_SECRET: "test-only-pm-recovery-artifact-secret",
          CC_TEST_PM_LEDGER_SECRET: "test-only-pm-recovery-ledger-secret",
          CC_TEST_PM_WITNESS_SECRET: "test-only-pm-recovery-witness-secret",
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let stdout = "";
    let stderr = "";
    let failure = null;
    const timer = setTimeout(() => {
      failure = new Error(`PM recovery process exceeded its ${mode} deadline`);
      child.kill("SIGKILL");
    }, 60_000);
    const collect = (kind, chunk) => {
      if (failure) return;
      if (kind === "stdout") stdout += chunk;
      else stderr += chunk;
      if (stdout.length + stderr.length > 256 * 1024) {
        failure = new Error("PM recovery process output limit exceeded");
        child.kill("SIGKILL");
      }
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => collect("stdout", chunk));
    child.stderr.on("data", (chunk) => collect("stderr", chunk));
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (failure) {
        reject(failure);
        return;
      }
      try {
        resolve(
          Object.freeze({
            code,
            signal,
            stderr,
            result: JSON.parse(stdout.trim()),
          }),
        );
      } catch (cause) {
        reject(
          new Error(`invalid PM recovery process output: ${stdout || stderr}`, {
            cause,
          }),
        );
      }
    });
  });
}
