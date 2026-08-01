import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const installDir = path.resolve(testDir, "../../install");
const shPath = path.join(installDir, "install.sh");
const ps1Path = path.join(installDir, "install.ps1");
const binPath = path.resolve(testDir, "../../bin/chainlesschain.js");
const temporaryDirectories = [];

afterEach(() => {
  while (temporaryDirectories.length) {
    fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

describe("native installer transaction contracts", () => {
  it("POSIX installer uses a locked same-filesystem commit and persistent rollback copy", () => {
    const source = fs.readFileSync(shPath, "utf8");
    expect(source).toContain("releases/download/cli-stable");
    expect(source).toContain('LOCK_PATH="$TARGET_PATH.update.lock"');
    expect(source).toContain('acquire_update_lock "$LOCK_PATH" "$LOCK_TOKEN"');
    expect(source).toContain("getattr(os, 'O_NOFOLLOW', 0)");
    expect(source).toContain('LOCK_IDENTITY=""');
    expect(source).toContain("expected_dev, expected_ino");
    expect(source).toContain("before = os.fstat(fd)");
    expect(source).toContain("assert_lock_owned 2>/dev/null");
    expect(source).toContain("subprocess.run(");
    expect(source).toContain("timeout=30");
    expect(source).toContain("uuid.UUID(value.get('transactionId', ''))");
    expect(source).toContain(
      "re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', value['status'])",
    );
    expect(source).toContain(
      'mktemp "$INSTALL_DIR/.chainlesschain.new.XXXXXX"',
    );
    expect(source).toContain('mv -f "$CANDIDATE_PATH" "$TARGET_PATH"');
    expect(source).toContain(
      'mktemp "$INSTALL_DIR/.chainlesschain.previous.XXXXXX"',
    );
    expect(source).toContain('mv -f "$BACKUP_TEMP_PATH" "$BACKUP_PATH"');
    expect(source).toContain(
      'mktemp "$INSTALL_DIR/.chainlesschain.rollback.XXXXXX"',
    );
    expect(source).toContain('mv -f "$ROLLBACK_TEMP_PATH" "$TARGET_PATH"');
    expect(source).toContain(".orphaned-$TRANSACTION_ID");
    expect(source).toContain('RESULT_PATH="$TARGET_PATH.update-result.json"');
    expect(source).toContain("chainlesschain.native-update-result.v1");
    expect(source).toContain(
      "native update lock retained for manual recovery at $LOCK_PATH",
    );
    expect(source).toContain("os.lstat(current)");
    expect(source).toContain('[ -L "$file_path" ]');
    expect(source).not.toContain('mv "$ARTIFACT" "$TARGET_PATH"');
    expect(source).not.toContain('mv "$BACKUP_PATH" "$TARGET_PATH"');
    expect(
      source.indexOf('acquire_update_lock "$LOCK_PATH" "$LOCK_TOKEN"'),
    ).toBeLessThan(source.indexOf('mv -f "$CANDIDATE_PATH" "$TARGET_PATH"'));
    expect(
      source.indexOf(
        'assert_lock_owned || die "native update lock ownership was lost before target commit"',
      ),
    ).toBeLessThan(source.indexOf('mv -f "$CANDIDATE_PATH" "$TARGET_PATH"'));
    expect(
      source.indexOf(
        'assert_lock_owned || die "native update lock ownership was lost before backup commit"',
      ),
    ).toBeLessThan(source.indexOf('mv -f "$BACKUP_TEMP_PATH" "$BACKUP_PATH"'));
    expect(
      source.indexOf(
        'assert_lock_owned || die "native update lock ownership was lost before alias commit"',
      ),
    ).toBeLessThan(source.indexOf('mv -f "$ALIAS_TEMP_PATH" "$ALIAS_PATH"'));
  });

  it("PowerShell installer uses an exclusive handle, File.Replace, and catch-all rollback", () => {
    const source = fs.readFileSync(ps1Path, "utf8");
    expect(source).toContain("releases/download/cli-stable");
    expect(source).toContain("[IO.FileMode]::CreateNew");
    expect(source).toContain("[IO.FileShare]::None");
    expect(source).toContain("[IO.FileAttributes]::ReparsePoint");
    expect(source).toContain('$LockPath = "$TargetPath.update.lock"');
    expect(source).toContain("Move-StaleStateToQuarantine");
    expect(source).toContain('$ResultPath = "$TargetPath.update-result.json"');
    expect(source).toContain(
      "[IO.File]::Copy($Artifact, $CandidatePath, $false)",
    );
    expect(source).toContain(
      '(".chainlesschain.new-" + [guid]::NewGuid().ToString("N") + ".exe")',
    );
    expect(source).toContain(
      "[IO.File]::Replace($CandidatePath, $TargetPath, $BackupPath, $true)",
    );
    expect(source).toContain("Invoke-BinaryStartupCheck $TargetPath");
    expect(source).toContain("$Process.WaitForExit(30000)");
    expect(source).toContain("$Process.WaitForExit(5000)");
    expect(source).toContain("$Process.Kill()");
    expect(source).toContain("if ($Swapped -and -not $Committed)");
    expect(source).toContain(
      "[IO.File]::Replace($RollbackTempPath, $TargetPath, $FailedPath, $true)",
    );
    expect(source).toContain("Last-known-good backup changed before rollback");
    expect(source).toContain(
      "Restored install target failed SHA-256 verification",
    );
    expect(source).toContain("$PreserveRecovery = $true");
    expect(source).toContain(
      "Native update lock retained for manual recovery at $($InstallLock.Path)",
    );
    expect(source).toContain("chainlesschain.native-update-result.v1");
    expect(source).not.toContain("Move-Item -Force $Artifact $TargetPath");
    const transactionStart = source.indexOf("$Swapped = $false");
    const aliasCommit = source.indexOf(
      "[IO.File]::Replace($AliasCandidatePath, $AliasPath",
    );
    const transactionCatch = source.indexOf("} catch {", transactionStart);
    expect(transactionStart).toBeGreaterThan(-1);
    expect(aliasCommit).toBeGreaterThan(transactionStart);
    expect(aliasCommit).toBeLessThan(transactionCatch);
    expect(source.indexOf("$Committed = $true")).toBeLessThan(transactionCatch);
  });

  it.runIf(process.platform === "win32")(
    "PowerShell installer rolls the primary binary back when alias commit fails",
    () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-ps-install-tx-"));
      temporaryDirectories.push(root);
      const fixtureDir = path.join(root, "fixtures");
      const targetDir = path.join(root, "bin");
      fs.mkdirSync(fixtureDir, { recursive: true });
      fs.mkdirSync(targetDir, { recursive: true });

      const artifactPath = path.join(fixtureDir, "artifact.exe");
      fs.copyFileSync(process.execPath, artifactPath);
      const sha256 = crypto
        .createHash("sha256")
        .update(fs.readFileSync(artifactPath))
        .digest("hex");
      const target =
        process.arch === "arm64" ? "node20-win-arm64" : "node20-win-x64";
      const manifestPath = path.join(fixtureDir, "manifest.json");
      const bundlePath = path.join(fixtureDir, "bundle.json");
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({
          latest: {
            artifacts: [
              {
                target,
                url: "https://fixture/artifact.exe",
                sha256,
                signature: "https://fixture/artifact.sigstore.json",
              },
            ],
          },
        }),
      );
      fs.writeFileSync(bundlePath, "{}");

      const targetPath = path.join(targetDir, "chainlesschain.exe");
      const aliasPath = path.join(targetDir, "cc.exe");
      fs.writeFileSync(targetPath, "known-good-primary");
      fs.writeFileSync(aliasPath, "known-good-alias");

      const command = [
        `$env:CC_CLI_RELEASE_BASE_URL = 'https://fixture/base'`,
        `$env:CC_CLI_INSTALL_DIR = ${psQuote(targetDir)}`,
        `function cosign { $global:LASTEXITCODE = 0 }`,
        `function Invoke-WebRequest { param([string]$Uri, [string]$OutFile); if ($Uri.EndsWith('chainlesschain-update.json.sigstore.json')) { $Source = ${psQuote(bundlePath)} } elseif ($Uri.EndsWith('chainlesschain-update.json')) { $Source = ${psQuote(manifestPath)} } elseif ($Uri.EndsWith('artifact.sigstore.json')) { $Source = ${psQuote(bundlePath)} } elseif ($Uri.EndsWith('artifact.exe')) { $Source = ${psQuote(artifactPath)} } else { throw "unexpected fixture URL: $Uri" }; [IO.File]::Copy($Source, $OutFile, $true) }`,
        `$AliasLock = [IO.File]::Open(${psQuote(aliasPath)}, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)`,
        `try { . ${psQuote(ps1Path)} } finally { $AliasLock.Dispose() }`,
      ].join("; ");
      const run = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", command],
        { encoding: "utf8", timeout: 60_000 },
      );

      expect(run.status, run.stderr || run.stdout).not.toBe(0);
      expect(fs.readFileSync(targetPath, "utf8")).toBe("known-good-primary");
      expect(
        fs.existsSync(`${targetPath}.previous`),
        run.stderr || run.stdout,
      ).toBe(true);
      expect(fs.readFileSync(`${targetPath}.previous`, "utf8")).toBe(
        "known-good-primary",
      );
      expect(fs.readFileSync(aliasPath, "utf8")).toBe("known-good-alias");
      expect(fs.existsSync(`${targetPath}.update.lock`)).toBe(false);
      expect(
        fs
          .readdirSync(targetDir)
          .filter((name) => /\.(?:new|rollback)-/.test(name)),
      ).toEqual([]);
    },
    90_000,
  );

  it.runIf(process.platform === "win32")(
    "PowerShell fresh install quarantines stale backup and lineage generations",
    () => {
      const root = fs.mkdtempSync(
        path.join(os.tmpdir(), "cc-ps-install-fresh-"),
      );
      temporaryDirectories.push(root);
      const fixtureDir = path.join(root, "fixtures");
      const targetDir = path.join(root, "bin");
      fs.mkdirSync(fixtureDir, { recursive: true });
      fs.mkdirSync(targetDir, { recursive: true });

      const artifactPath = path.join(fixtureDir, "artifact.exe");
      fs.copyFileSync(process.execPath, artifactPath);
      const sha256 = crypto
        .createHash("sha256")
        .update(fs.readFileSync(artifactPath))
        .digest("hex");
      const target =
        process.arch === "arm64" ? "node20-win-arm64" : "node20-win-x64";
      const manifestPath = path.join(fixtureDir, "manifest.json");
      const bundlePath = path.join(fixtureDir, "bundle.json");
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({
          latest: {
            artifacts: [
              {
                target,
                url: "https://fixture/artifact.exe",
                sha256,
                signature: "https://fixture/artifact.sigstore.json",
              },
            ],
          },
        }),
      );
      fs.writeFileSync(bundlePath, "{}");

      const targetPath = path.join(targetDir, "chainlesschain.exe");
      const aliasPath = path.join(targetDir, "cc.exe");
      const backupPath = `${targetPath}.previous`;
      const lineagePath = `${targetPath}.update-lineage.json`;
      fs.writeFileSync(backupPath, "stale-previous");
      fs.writeFileSync(lineagePath, '{"schema":"stale"}');

      const command = [
        `$env:CC_CLI_RELEASE_BASE_URL = 'https://fixture/base'`,
        `$env:CC_CLI_INSTALL_DIR = ${psQuote(targetDir)}`,
        `function cosign { $global:LASTEXITCODE = 0 }`,
        `function Invoke-WebRequest { param([string]$Uri, [string]$OutFile); if ($Uri.EndsWith('chainlesschain-update.json.sigstore.json')) { $Source = ${psQuote(bundlePath)} } elseif ($Uri.EndsWith('chainlesschain-update.json')) { $Source = ${psQuote(manifestPath)} } elseif ($Uri.EndsWith('artifact.sigstore.json')) { $Source = ${psQuote(bundlePath)} } elseif ($Uri.EndsWith('artifact.exe')) { $Source = ${psQuote(artifactPath)} } else { throw "unexpected fixture URL: $Uri" }; [IO.File]::Copy($Source, $OutFile, $true) }`,
        `. ${psQuote(ps1Path)}`,
      ].join("; ");
      const run = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", command],
        { encoding: "utf8", timeout: 60_000 },
      );

      expect(run.status, run.stderr || run.stdout).toBe(0);
      expect(
        crypto
          .createHash("sha256")
          .update(fs.readFileSync(targetPath))
          .digest("hex"),
      ).toBe(sha256);
      expect(
        crypto
          .createHash("sha256")
          .update(fs.readFileSync(aliasPath))
          .digest("hex"),
      ).toBe(sha256);
      expect(fs.existsSync(backupPath)).toBe(false);
      const names = fs.readdirSync(targetDir);
      expect(
        names.some((name) =>
          name.startsWith("chainlesschain.exe.previous.orphaned-"),
        ),
      ).toBe(true);
      expect(
        names.some((name) =>
          name.startsWith("chainlesschain.exe.update-lineage.json.orphaned-"),
        ),
      ).toBe(true);
      expect(JSON.parse(fs.readFileSync(lineagePath, "utf8"))).toMatchObject({
        schema: "chainlesschain.native-update-lineage.v1",
        operation: "install",
        currentSha256: sha256,
        previousSha256: null,
      });
      expect(fs.existsSync(`${targetPath}.update.lock`)).toBe(false);
    },
    90_000,
  );

  it("both installer scripts parse on available local shells", () => {
    const bash = spawnSync("bash", ["-n", shPath], { encoding: "utf8" });
    if (!bash.error || bash.error.code !== "ENOENT") {
      expect(bash.status, bash.stderr).toBe(0);
    }

    const escapedPath = ps1Path.replaceAll("'", "''");
    const parserCommand = [
      "$errors = $null",
      `[System.Management.Automation.Language.Parser]::ParseFile('${escapedPath}', [ref]$null, [ref]$errors) | Out-Null`,
      "if ($errors.Count) { $errors | ForEach-Object { Write-Error $_ }; exit 1 }",
    ].join("; ");
    const shellName = process.platform === "win32" ? "powershell.exe" : "pwsh";
    const powershell = spawnSync(
      shellName,
      ["-NoProfile", "-NonInteractive", "-Command", parserCommand],
      { encoding: "utf8" },
    );
    if (!powershell.error || powershell.error.code !== "ENOENT") {
      expect(powershell.status, powershell.stderr).toBe(0);
    }
  }, 15_000);

  it("packed CLI startup consumes detached native update results", () => {
    const source = fs.readFileSync(binPath, "utf8");
    expect(source).toContain("reportPendingNativeUpdateResult();");
    expect(source.indexOf("reportPendingNativeUpdateResult();")).toBeLessThan(
      source.indexOf("runCli(process.argv)"),
    );
  });
});
