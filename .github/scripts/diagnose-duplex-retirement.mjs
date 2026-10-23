// Read-only host diagnostics; every sample is retained, including failures.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  observeChildCompletion,
  retireDuplexProcessTree,
} from "../../packages/cli/scripts/cli-reliability-soak.mjs";

function processRows(pids) {
  if (process.platform === "win32") return null;
  const result = spawnSync(
    "ps",
    ["-p", pids.join(","), "-o", "pid=,ppid=,pgid=,state="],
    { encoding: "utf8", timeout: 1000 },
  );
  return {
    status: result.status,
    errorCode: result.error?.code ?? null,
    rows: String(result.stdout || "")
      .trim()
      .split(/\r?\n/u)
      .map((line) => line.trim().split(/\s+/u))
      .filter(
        (row) =>
          row.length === 4 &&
          row.slice(0, 3).every((value) => /^\d+$/u.test(value)) &&
          /^[A-Za-z+<N\-]+$/u.test(row[3]),
      )
      .map(([pid, parentPid, groupPid, state]) => ({
        pid: Number(pid),
        parentPid: Number(parentPid),
        groupPid: Number(groupPid),
        state,
      })),
  };
}

const report = {
  schema: "chainlesschain.duplex-retirement-host-diagnostic/v1",
  sourceSha: process.env.CC_RETIREMENT_SOURCE_SHA || null,
  runtime: {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
  },
  cleanupDeadlineMs: 10_000,
  samples: [],
};
const output = path.resolve("test-results/process-retirement.json");
fs.mkdirSync(path.dirname(output), { recursive: true });
const checkpoint = () =>
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);

const tempRoot = fs.realpathSync.native(os.tmpdir());
for (let index = 0; index < 4; index++) {
  const root = fs.mkdtempSync(path.join(tempRoot, "cc-retirement-probe-"));
  const source = `const fs=require('fs'), cp=require('child_process');
    fs.openSync(process.argv[1],'w');
    const leaf=cp.spawn(process.execPath,['-e',"require('fs').openSync(process.argv[1],'w');process.stdout.write('ready');setInterval(()=>{},1000)",process.argv[2]],{stdio:['ignore','pipe','ignore'],windowsHide:true});
    leaf.stdout.once('data',()=>process.stdout.write(JSON.stringify({leaf:leaf.pid})+'\\n'));
    setInterval(()=>{},1000);`;
  const child = spawn(
    process.execPath,
    [
      "-e",
      source,
      path.join(root, "root-held.db"),
      path.join(root, "leaf-held.db"),
    ],
    {
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const completion = observeChildCompletion(child);
  child.stderr.resume();
  const sample = { index, ready: false, confirmed: false };
  report.samples.push(sample);
  try {
    const [chunk] = await once(child.stdout, "data", {
      signal: AbortSignal.timeout(10_000),
    });
    const leaf = JSON.parse(String(chunk)).leaf;
    if (!Number.isSafeInteger(leaf) || leaf <= 0)
      throw new Error("invalid-leaf");
    sample.ready = fs.existsSync(path.join(root, "leaf-held.db"));
    sample.before = processRows([child.pid, leaf]);
    sample.result = await retireDuplexProcessTree(child, completion, 10_000);
    sample.confirmed = sample.ready && sample.result.confirmed;
    sample.exit = completion.exit();
    sample.after = processRows([child.pid, leaf]);
    if (sample.confirmed) {
      const resolved = fs.realpathSync.native(root);
      if (
        path.dirname(resolved) !== tempRoot ||
        !path.basename(resolved).startsWith("cc-retirement-probe-")
      ) {
        throw new Error("invalid-temporary-root");
      }
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  } catch (error) {
    sample.error = { name: error?.name ?? null, code: error?.code ?? null };
  } finally {
    sample.directoryRetained = fs.existsSync(root);
    if (completion.exit() === null) {
      // The live ChildProcess still identifies this owned root. Never signal
      // a remembered leaf PID or an exited root that the OS could have reused.
      child.kill("SIGKILL");
      await completion.wait(10_000).catch(() => {});
    }
    checkpoint();
  }
}
console.log(
  JSON.stringify({
    output,
    samples: report.samples.length,
    confirmed: report.samples.filter((item) => item.confirmed).length,
  }),
);
if (report.samples.some((item) => !item.confirmed)) process.exitCode = 1;
