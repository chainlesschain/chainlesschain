/**
 * Shared helpers for mtc-federation-governance-*-cli.test.js suites.
 *
 * The original mtc-federation-governance-cli.test.js was a single 41-test /
 * 1334-line file whose ~110-200s wall time on CI blew vitest's hardcoded
 * 60s onTaskUpdate RPC heartbeat (issue #4). Splitting the file into core /
 * sync / trust suites keeps each under the heartbeat ceiling; this module
 * is the de-duplicated subprocess driver they share.
 *
 * `makeCliRunner(getTmpHome)` accepts a thunk so the runner reads the
 * current per-test tmp HOME lazily — call sites do `let tmpHome; const
 * {runCli} = makeCliRunner(() => tmpHome);` then assign `tmpHome` in
 * beforeEach without rebuilding the runner.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

export const CLI_BIN = path.resolve(process.cwd(), "bin/chainlesschain.js");

export function extractJson(text) {
  const lines = text.split(/\r?\n/);
  for (let s = 0; s < lines.length; s++) {
    const t = lines[s].trimStart();
    if (t.startsWith("{") || t.startsWith("[")) {
      for (let e = lines.length; e > s; e--) {
        try {
          return JSON.parse(lines.slice(s, e).join("\n"));
        } catch (_err) {
          /* shorter */
        }
      }
    }
  }
  throw new Error(`No JSON in: ${text.slice(0, 300)}`);
}

export function makeCliRunner(getTmpHome) {
  function runCli(args) {
    return spawnSync(process.execPath, [CLI_BIN, ...args], {
      encoding: "utf-8",
      timeout: 30_000,
      env: {
        ...process.env,
        USERPROFILE: getTmpHome(),
        HOME: getTmpHome(),
      },
    });
  }

  function mustRun(args) {
    const r = runCli(args);
    if (r.status !== 0) {
      throw new Error(
        `cc ${args.join(" ")} exit=${r.status}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`,
      );
    }
    return r;
  }

  function joinAs(memberId, fedId = "fed-test") {
    return mustRun([
      "mtc",
      "federation",
      "join",
      fedId,
      "--member-id",
      memberId,
      "--json",
    ]);
  }

  return { runCli, mustRun, joinAs };
}
