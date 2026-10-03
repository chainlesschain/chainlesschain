import fs from "node:fs";
import path from "node:path";
import { delay, event, snapshot, writeJson } from "./shared.mjs";
const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
writeJson(path.join(config.output, `${config.id}.observer-ready`), {
  at: Date.now(),
  pid: process.pid,
});
let previous = "";
const observationLimit = Date.now() + 180_000;
while (Date.now() < observationLimit) {
  const files = snapshot(config);
  const serialized = JSON.stringify(files);
  const startedPath = path.join(config.output, `${config.id}.started.json`);
  const returnedPath = path.join(config.output, `${config.id}.returned.json`);
  const startedAt = fs.existsSync(startedPath)
    ? JSON.parse(fs.readFileSync(startedPath, "utf8")).at
    : null;
  const returnedAt = fs.existsSync(returnedPath)
    ? JSON.parse(fs.readFileSync(returnedPath, "utf8")).at
    : null;
  // The first test starts its 60s result wait after schedule.mjs returns.
  // Direct sidecar calls have their original spawnSync timeout from call start.
  const deadlineAt =
    config.kind === "schedule-helper"
      ? returnedAt
        ? returnedAt + 60_000
        : null
      : config.synchronous && startedAt
        ? startedAt + config.timeoutMs
        : null;
  if (serialized !== previous) {
    event(config, "files-observed", {
      files,
      nativeElapsedMs: startedAt ? Date.now() - startedAt : null,
      deadlineAt,
      afterOriginalDeadline: deadlineAt ? Date.now() > deadlineAt : null,
    });
    previous = serialized;
  }
  if (files.RESULT_FILE?.sha256 && files.LOCK_FILE?.error === "ENOENT") break;
  await delay(100);
}
event(config, "observation-ended", {
  files: snapshot(config),
  releaseEligible: false,
});
writeJson(path.join(config.output, `${config.id}.observer-done`), {
  at: Date.now(),
});
