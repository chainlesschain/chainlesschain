import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const brokerDir = fileURLToPath(
  new URL("../../src/lib/process-execution-broker/", import.meta.url),
);
const source = fs.readFileSync(
  path.join(brokerDir, "windows-sandbox.cs"),
  "utf8",
);

it("uses closed, flushed, non-overwriting identity publication for success and failure", () => {
  const implementation = source
    .split("public static void PublishTargetIdentity(")[1]
    .split("public static int Run(")[0];
  expect(implementation).toContain("FileMode.CreateNew");
  expect(implementation).toContain("FileShare.None");
  expect(implementation.indexOf("stream.Flush(true)")).toBeLessThan(
    implementation.indexOf("File.Move(pendingPath, identityPath)"),
  );
  expect(source).toContain("PublishTargetIdentity(identityPath, identity);");
  expect(source).toContain(
    "Native.PublishTargetIdentity(spec.identityPath, failure);",
  );
  expect(source).not.toContain("File.WriteAllText(");
});

it.runIf(process.platform === "win32")(
  "the compiled helper preserves an already-published identity when a late failure competes",
  () => {
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync.native(os.tmpdir()), "cc-identity-publish-"),
    );
    const quote = (value) => `'${value.replaceAll("'", "''")}'`;
    const script = `
    $ErrorActionPreference = 'Stop'
    [void][Reflection.Assembly]::Load([IO.File]::ReadAllBytes(${quote(path.join(brokerDir, "windows-sandbox-helper.dll"))}))
    $identityTarget = ${quote(path.join(root, "identity.json"))}
    $publishedValue = '{"targetPid":5103,"helperPid":4102}'
    [ChainlessChain.WindowsSandbox.Native]::PublishTargetIdentity($identityTarget, $publishedValue)
    $collisionRejected = $false
    try { [ChainlessChain.WindowsSandbox.Native]::PublishTargetIdentity($identityTarget, '{"error":"late failure"}') }
    catch { $collisionRejected = $true }
    @{ preserved = ([IO.File]::ReadAllText($identityTarget) -ceq $publishedValue); collisionRejected = $collisionRejected; files = @([IO.Directory]::GetFiles(${quote(root)}) | ForEach-Object { [IO.Path]::GetFileName($_) }) } | ConvertTo-Json -Compress
  `;
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      { encoding: "utf8", windowsHide: true, timeout: 10_000 },
    );
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      preserved: true,
      collisionRejected: true,
      files: ["identity.json"],
    });
  },
  15_000,
);
