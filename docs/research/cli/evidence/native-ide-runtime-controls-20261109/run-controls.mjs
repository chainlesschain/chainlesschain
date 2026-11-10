import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const [output, ...executables] = process.argv.slice(2);
if (
  !output ||
  !executables.length ||
  executables.some((p) => !path.isAbsolute(p))
)
  throw new Error(
    "Usage: node run-controls.mjs <new-output.json> <absolute java executable> [...]",
  );
const source = fileURLToPath(
  new URL("./loopback-health.java", import.meta.url),
);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const receipt = {
  schema: "chainlesschain.native-java-runtime-controls/v1",
  startedAt: new Date().toISOString(),
  platform: process.platform,
  architecture: process.arch,
  sourceSha256: sha256(readFileSync(source)),
  extensionLoaded: false,
  gradleLoaded: false,
  cases: [],
};
for (const [index, executable] of executables.entries()) {
  const result = spawnSync(executable, ["--source", "11", source], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 12000,
    maxBuffer: 65536,
  });
  const row = {
    label: `java-${index + 1}`,
    executableSha256: sha256(readFileSync(executable)),
    exitCode: result.status,
    errorCode: result.error?.code || null,
  };
  if (result.status === 0) row.probe = JSON.parse(result.stdout);
  receipt.cases.push(row);
}
receipt.finishedAt = new Date().toISOString();
writeFileSync(output, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ output, runtimes: receipt.cases.length }));
