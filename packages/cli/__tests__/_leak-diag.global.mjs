/**
 * TEMP diagnostic (globalSetup teardown) — identify the orphan `node`
 * processes that survive the unit run and pin the forks-pool worker on POSIX
 * CI (the "Timeout terminating forks worker / Worker exited unexpectedly"
 * shard-2/4 flake). GitHub's post-job cleanup reports 6 leaked node procs but
 * only their pids; this prints their COMMAND LINES so the leaking suite can be
 * pinpointed. Runs once in the vitest MAIN process after the run — its stderr
 * is not subject to the reporter's --silent=passed-only. Remove once fixed.
 */
export async function teardown() {
  if (process.platform === "win32") return;
  try {
    const { execSync } = await import("node:child_process");
    let out = "";
    try {
      out = execSync("ps -eo pid,ppid,etimes,args", {
        encoding: "utf8",
        timeout: 5000,
      });
    } catch {
      out = execSync("ps -eo pid,ppid,args", { encoding: "utf8" });
    }
    const nodeLines = out.split("\n").filter((l) => /node/.test(l));
    // A leaked test child runs a test one-liner / worker / fake-cli — not the
    // vitest main process or its pool workers (those carry vitest/tinypool).
    const suspicious = nodeLines.filter(
      (l) =>
        /(setTimeout|fake-cli|background-agent-worker|update-notice-refresh|credential-proxy|\bcc-bg\b|\.job\.| -e )/.test(
          l,
        ) && !/vitest|tinypool/.test(l),
    );
    console.error(
      `\n=== LEAKDIAG: ${suspicious.length} suspicious node proc(s) at teardown (of ${nodeLines.length} node procs) ===`,
    );
    for (const l of suspicious) {
      console.error("LEAKDIAG " + l.trim().slice(0, 320));
    }
    // Fallback: if the cmdline filter matched nothing, dump every non-vitest
    // node proc so we still learn what leaked.
    if (suspicious.length === 0) {
      const others = nodeLines.filter((l) => !/vitest|tinypool|ps -eo/.test(l));
      for (const l of others.slice(0, 20)) {
        console.error("LEAKDIAG-ANY " + l.trim().slice(0, 320));
      }
    }
  } catch (e) {
    console.error("LEAKDIAG-ERR " + (e?.message || e));
  }
}
