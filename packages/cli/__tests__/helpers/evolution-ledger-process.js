import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const fixture = fileURLToPath(
  new URL(
    "../fixtures/evolution-ledger-file-backend-process.mjs",
    import.meta.url,
  ),
);

export function runBackendProcess(
  root,
  { mode = "verify", count = 0, onProgress = () => {} } = {},
) {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const child = spawn(
      process.execPath,
      ["--max-old-space-size=256", fixture, root, mode, String(count)],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          CC_TEST_LEDGER_SECRET: "test-only-process-ledger-secret",
          CC_TEST_WITNESS_SECRET: "test-only-process-witness-secret",
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let stdout = "";
    let stderr = "";
    let failure = null;
    const timer = setTimeout(
      () => {
        failure = new Error(`backend process exceeded its ${mode} deadline`);
        child.kill();
      },
      mode === "seed" ? 3_600_000 : 60_000,
    );
    const collect = (kind, chunk) => {
      if (failure) return;
      if (kind === "stdout") stdout += chunk;
      else {
        stderr += chunk;
        if (count > 0 && chunk.includes("seeded")) onProgress(chunk.trim());
      }
      if (stdout.length + stderr.length > 512 * 1024) {
        failure = new Error("backend process output limit exceeded");
        child.kill();
      }
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      collect("stdout", chunk);
    });
    child.stderr.on("data", (chunk) => {
      collect("stderr", chunk);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (failure) {
        const resourceSamples = stderr
          .split(/\r?\n/u)
          .filter((line) => line.startsWith("resource-sample "))
          .map((line) => {
            try {
              return JSON.parse(line.slice("resource-sample ".length));
            } catch {
              return null;
            }
          })
          .filter(Boolean);
        const completedEvents = [...stderr.matchAll(/seeded (\d+)\/\d+/gu)]
          .map((match) => Number(match[1]))
          .at(-1);
        failure.backendDiagnostics = Object.freeze({
          completedEvents: completedEvents ?? 0,
          elapsedMs: performance.now() - startedAt,
          mode,
          requestedEvents: count,
          resourceSamples: Object.freeze(resourceSamples),
          signal,
        });
        reject(failure);
        return;
      }
      try {
        resolve({
          code,
          signal,
          stderr,
          result: JSON.parse(stdout.trim()),
        });
      } catch (cause) {
        reject(
          new Error(`invalid backend process output: ${stdout || stderr}`, {
            cause,
          }),
        );
      }
    });
  });
}
