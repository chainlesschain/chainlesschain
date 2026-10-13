import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const proofSource = fileURLToPath(
  new URL("./windows-process-proof.cs", import.meta.url),
);
export const byteDigest = (bytes) =>
  `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;

// Build only into a new directory. Existing proof binaries and source receipts
// remain immutable; building does not run the helper or restart a workload.
export function buildWindowsProcessProof(outputDir) {
  if (process.platform !== "win32")
    throw new Error("Windows compiler required");
  const root = path.resolve(outputDir);
  fs.mkdirSync(root, { recursive: false });
  const bytes = fs.readFileSync(proofSource);
  const sourceDigest = byteDigest(bytes);
  const source = bytes.toString("utf8");
  const placeholder = "__PROCESS_PROOF_SOURCE_SHA256__";
  if (source.split(placeholder).length !== 2)
    throw new Error("Source digest placeholder must be unique");
  const compiledSource = path.join(root, "windows-process-proof.compiled.cs");
  fs.writeFileSync(
    compiledSource,
    source.replace(placeholder, sourceDigest.slice(7)),
    { flag: "wx" },
  );
  const compiler = path.join(
    process.env.SystemRoot || "C:\\Windows",
    "Microsoft.NET/Framework64/v4.0.30319/csc.exe",
  );
  const executable = path.join(root, "windows-process-proof.exe");
  const args = [
    "/nologo",
    "/target:exe",
    "/platform:x64",
    "/optimize+",
    "/reference:System.Runtime.Serialization.dll",
    `/out:${executable}`,
    compiledSource,
  ];
  const startedAt = new Date().toISOString();
  const result = spawnSync(compiler, args, {
    windowsHide: true,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  fs.writeFileSync(path.join(root, "build.stdout"), result.stdout || "", {
    flag: "wx",
  });
  fs.writeFileSync(path.join(root, "build.stderr"), result.stderr || "", {
    flag: "wx",
  });
  if (result.error || result.signal || result.status !== 0)
    throw new Error(
      `Process proof build failed: ${result.error?.message || result.stderr || result.stdout}`,
    );
  const receipt = {
    schema: "chainlesschain.windows-process-proof-build/v1",
    startedAt,
    completedAt: new Date().toISOString(),
    source: proofSource,
    sourceDigest,
    compiledSourceDigest: byteDigest(fs.readFileSync(compiledSource)),
    compiler,
    compilerDigest: byteDigest(fs.readFileSync(compiler)),
    args,
    executable,
    executableDigest: byteDigest(fs.readFileSync(executable)),
    status: "BUILT",
    hermeticToolchain: false,
    formalHostAcceptance: false,
  };
  fs.writeFileSync(
    path.join(root, "build.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
    { flag: "wx" },
  );
  return receipt;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { values } = parseArgs({ options: { output: { type: "string" } } });
    if (!values.output) throw new Error("--output NEW_DIRECTORY required");
    console.log(
      JSON.stringify(buildWindowsProcessProof(values.output), null, 2),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
