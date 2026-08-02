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

function sha256File(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function writeShellTool(directory, name, source) {
  const filePath = path.join(directory, name);
  fs.writeFileSync(filePath, source.replaceAll("\r\n", "\n"));
  fs.chmodSync(filePath, 0o755);
  return filePath;
}

function runPosixInstallerFixture({
  existing = false,
  lineageFailure = "before",
  failBackupRestore = false,
  failLineageRestore = false,
  failSnapshotCleanup = false,
  failRollbackFsync = false,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-sh-install-tx-"));
  temporaryDirectories.push(root);
  const fixtureDir = path.join(root, "fixtures");
  const fakeBin = path.join(root, "fake-bin");
  const targetDir = path.join(root, "bin");
  fs.mkdirSync(fixtureDir, { recursive: true });
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.mkdirSync(targetDir, { recursive: true });

  const artifactPath = path.join(fixtureDir, "artifact");
  fs.copyFileSync(process.execPath, artifactPath);
  fs.chmodSync(artifactPath, 0o755);
  const artifactSha256 = sha256File(artifactPath);
  const manifestPath = path.join(fixtureDir, "manifest.json");
  const bundlePath = path.join(fixtureDir, "bundle.json");
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      latest: {
        artifacts: [
          {
            target: "node20-linux-x64",
            url: "https://fixture/artifact",
            sha256: artifactSha256,
            signature: "https://fixture/artifact.sigstore.json",
          },
        ],
      },
    }),
  );
  fs.writeFileSync(bundlePath, "{}");

  writeShellTool(
    fakeBin,
    "uname",
    `#!/usr/bin/env sh
if [ "\${1:-}" = "-s" ]; then echo Linux; else echo x86_64; fi
`,
  );
  writeShellTool(
    fakeBin,
    "cosign",
    `#!/usr/bin/env sh
exit 0
`,
  );
  writeShellTool(
    fakeBin,
    "curl",
    `#!/usr/bin/env sh
url=""
output=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) output=$2; shift 2 ;;
    -*) shift ;;
    *) url=$1; shift ;;
  esac
done
case "$url" in
  */chainlesschain-update.json.sigstore.json) source_path=$FIXTURE_BUNDLE ;;
  */chainlesschain-update.json) source_path=$FIXTURE_MANIFEST ;;
  https://fixture/artifact.sigstore.json) source_path=$FIXTURE_BUNDLE ;;
  https://fixture/artifact) source_path=$FIXTURE_ARTIFACT ;;
  *) echo "unexpected fixture URL: $url" >&2; exit 80 ;;
esac
cp "$source_path" "$output"
`,
  );

  const toolLookup = spawnSync(
    "bash",
    ["-lc", "command -v python3; command -v ln; command -v rm; command -v mv"],
    { encoding: "utf8" },
  );
  expect(toolLookup.status, toolLookup.stderr).toBe(0);
  const [realPython, realLn, realRm, realMv] = toolLookup.stdout
    .trim()
    .split(/\r?\n/);
  const lineageFailedSentinel = path.join(root, "lineage-write-failed");
  writeShellTool(
    fakeBin,
    "python3",
    `#!/usr/bin/env sh
if [ "\${1:-}" = "-" ] && [ "$#" -eq 6 ] && [ "\${4:-}" = "install" ]; then
  case "\${2:-}" in
    *.update-lineage.json)
      if [ "\${CC_TEST_FAIL_LINEAGE_WRITE:-0}" = "before" ]; then
        : > "$CC_TEST_LINEAGE_FAILED_SENTINEL"
        exit 91
      fi
      if [ "\${CC_TEST_FAIL_LINEAGE_WRITE:-0}" = "after" ]; then
        "$REAL_PYTHON" "$@"
        status=$?
        [ "$status" -eq 0 ] || exit "$status"
        : > "$CC_TEST_LINEAGE_FAILED_SENTINEL"
        exit 91
      fi
      ;;
  esac
fi
if [ "\${CC_TEST_FAIL_ROLLBACK_FSYNC:-0}" = "1" ] && [ -f "$CC_TEST_LINEAGE_FAILED_SENTINEL" ] && [ "\${1:-}" = "-" ] && [ "\${2:-}" = "$CC_TEST_CANONICAL_INSTALL_DIR" ]; then
  exit 92
fi
exec "$REAL_PYTHON" "$@"
`,
  );
  writeShellTool(
    fakeBin,
    "ln",
    `#!/usr/bin/env sh
if [ "\${CC_TEST_FAIL_BACKUP_RESTORE:-0}" = "1" ]; then
  for candidate in "$@"; do
    case "$candidate" in
      */.chainlesschain.backup-restore-*) exit 93 ;;
    esac
  done
fi
exec "$REAL_LN" "$@"
`,
  );
  writeShellTool(
    fakeBin,
    "rm",
    `#!/usr/bin/env sh
if [ "\${CC_TEST_FAIL_SNAPSHOT_CLEANUP:-0}" = "1" ]; then
  for candidate in "$@"; do
    case "$candidate" in
      */.chainlesschain.backup-prior-*) exit 94 ;;
    esac
  done
fi
exec "$REAL_RM" "$@"
`,
  );
  writeShellTool(
    fakeBin,
    "mv",
    `#!/usr/bin/env sh
if [ "\${CC_TEST_FAIL_LINEAGE_RESTORE:-0}" = "1" ]; then
  for candidate in "$@"; do
    case "$candidate" in
      */.chainlesschain.lineage-restore-*) exit 95 ;;
    esac
  done
fi
exec "$REAL_MV" "$@"
`,
  );

  const targetPath = path.join(targetDir, "chainlesschain");
  const backupPath = `${targetPath}.previous`;
  const lineagePath = `${targetPath}.update-lineage.json`;
  const aliasPath = path.join(targetDir, "cc");
  let prestate = null;
  if (existing) {
    const rawLineage = ` { "schema" : "legacy-lineage", "opaque" : true } \n`;
    fs.writeFileSync(targetPath, "current-known-good");
    fs.chmodSync(targetPath, 0o755);
    fs.writeFileSync(backupPath, "older-known-good");
    fs.chmodSync(backupPath, 0o640);
    fs.writeFileSync(lineagePath, rawLineage);
    fs.symlinkSync("legacy-chainlesschain", aliasPath);
    const backupStat = fs.statSync(backupPath, { bigint: true });
    prestate = {
      targetBytes: fs.readFileSync(targetPath),
      backupBytes: fs.readFileSync(backupPath),
      backupDev: backupStat.dev,
      backupIno: backupStat.ino,
      backupMode: backupStat.mode,
      rawLineage,
      aliasTarget: fs.readlinkSync(aliasPath),
    };
  }

  const run = spawnSync("bash", [shPath], {
    encoding: "utf8",
    timeout: 90_000,
    env: {
      ...process.env,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
      REAL_PYTHON: realPython,
      REAL_LN: realLn,
      REAL_RM: realRm,
      REAL_MV: realMv,
      FIXTURE_MANIFEST: manifestPath,
      FIXTURE_BUNDLE: bundlePath,
      FIXTURE_ARTIFACT: artifactPath,
      CC_CLI_RELEASE_BASE_URL: "https://fixture/base",
      CC_CLI_INSTALL_DIR: targetDir,
      CC_TEST_FAIL_LINEAGE_WRITE: lineageFailure,
      CC_TEST_FAIL_BACKUP_RESTORE: failBackupRestore ? "1" : "0",
      CC_TEST_FAIL_LINEAGE_RESTORE: failLineageRestore ? "1" : "0",
      CC_TEST_FAIL_SNAPSHOT_CLEANUP: failSnapshotCleanup ? "1" : "0",
      CC_TEST_FAIL_ROLLBACK_FSYNC: failRollbackFsync ? "1" : "0",
      CC_TEST_LINEAGE_FAILED_SENTINEL: lineageFailedSentinel,
      CC_TEST_CANONICAL_INSTALL_DIR: fs.realpathSync(targetDir),
    },
  });
  return {
    root,
    targetDir,
    targetPath,
    backupPath,
    lineagePath,
    aliasPath,
    artifactSha256,
    prestate,
    run,
  };
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
    expect(source).toContain('PRIOR_BACKUP_PATH=""');
    expect(source).toContain('ln "$BACKUP_PATH" "$PRIOR_BACKUP_PATH"');
    expect(source).toContain('ln "$LINEAGE_PATH" "$PRIOR_LINEAGE_PATH"');
    expect(source).toContain(
      'snapshot_alias "$ALIAS_PATH" "$PRIOR_ALIAS_PATH"',
    );
    expect(source).toContain("ALIAS_COMMITTED=1");
    expect(source).toContain("LINEAGE_COMMIT_STARTED=1");
    expect(source).toContain("discard_transaction_snapshots");
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
    const priorLineageRestoreStart = source.indexOf(
      'if [ "$HAD_LINEAGE" -eq 1 ]; then',
      source.indexOf("rollback_install()"),
    );
    const absentLineageRestoreStart = source.indexOf(
      "    else",
      priorLineageRestoreStart,
    );
    const priorLineageRestore = source.slice(
      priorLineageRestoreStart,
      absentLineageRestoreStart,
    );
    expect(priorLineageRestore).toContain(
      'mv -f "$LINEAGE_RESTORE_PATH" "$LINEAGE_PATH"',
    );
    expect(priorLineageRestore).not.toContain('rm -f "$LINEAGE_PATH"');
  });

  it.runIf(process.platform !== "win32")(
    "POSIX lineage failure restores the prior backup generation, raw lineage, and alias target",
    () => {
      const fixture = runPosixInstallerFixture({
        existing: true,
        lineageFailure: "after",
      });
      const { run, prestate } = fixture;

      expect(run.status, run.stderr || run.stdout).not.toBe(0);
      expect(fs.readFileSync(fixture.targetPath)).toEqual(prestate.targetBytes);
      expect(fs.readFileSync(fixture.backupPath)).toEqual(prestate.backupBytes);
      const restoredBackup = fs.statSync(fixture.backupPath, { bigint: true });
      expect(restoredBackup.dev).toBe(prestate.backupDev);
      expect(restoredBackup.ino).toBe(prestate.backupIno);
      expect(restoredBackup.mode).toBe(prestate.backupMode);
      expect(fs.readFileSync(fixture.lineagePath, "utf8")).toBe(
        prestate.rawLineage,
      );
      expect(fs.readlinkSync(fixture.aliasPath)).toBe(prestate.aliasTarget);
      expect(fs.existsSync(`${fixture.targetPath}.update.lock`)).toBe(false);
      expect(
        fs
          .readdirSync(fixture.targetDir)
          .filter((name) => name.startsWith(".chainlesschain.")),
      ).toEqual([]);
    },
    120_000,
  );

  it.runIf(process.platform !== "win32")(
    "POSIX fresh install clears lineage when the writer fails after atomic replacement",
    () => {
      const fixture = runPosixInstallerFixture({ lineageFailure: "after" });

      expect(
        fixture.run.status,
        fixture.run.stderr || fixture.run.stdout,
      ).not.toBe(0);
      expect(fs.existsSync(fixture.targetPath)).toBe(false);
      expect(fs.existsSync(fixture.aliasPath)).toBe(false);
      expect(fs.existsSync(fixture.lineagePath)).toBe(false);
      expect(fs.existsSync(`${fixture.targetPath}.update.lock`)).toBe(false);
      expect(
        fs
          .readdirSync(fixture.targetDir)
          .filter((name) => name.startsWith(".chainlesschain.")),
      ).toEqual([]);
    },
    120_000,
  );

  it.runIf(process.platform !== "win32")(
    "POSIX failed lineage restore keeps a valid public lineage until atomic replacement succeeds",
    () => {
      const fixture = runPosixInstallerFixture({
        existing: true,
        lineageFailure: "after",
        failLineageRestore: true,
      });

      expect(
        fixture.run.status,
        fixture.run.stderr || fixture.run.stdout,
      ).not.toBe(0);
      expect(fs.existsSync(fixture.lineagePath)).toBe(true);
      expect(fs.readFileSync(fixture.lineagePath, "utf8")).not.toBe(
        fixture.prestate.rawLineage,
      );
      expect(
        JSON.parse(fs.readFileSync(fixture.lineagePath, "utf8")),
      ).toMatchObject({
        schema: "chainlesschain.native-update-lineage.v1",
        operation: "install",
        currentSha256: fixture.artifactSha256,
        previousSha256: sha256File(fixture.targetPath),
      });
      const names = fs.readdirSync(fixture.targetDir);
      expect(
        names.some((name) =>
          name.startsWith(".chainlesschain.lineage-restore-"),
        ),
      ).toBe(true);
      expect(
        names.some((name) => name.startsWith(".chainlesschain.lineage-prior-")),
      ).toBe(true);
      expect(fs.existsSync(`${fixture.targetPath}.update.lock`)).toBe(true);
    },
    120_000,
  );

  it.runIf(process.platform !== "win32")(
    "POSIX fresh install removes the target and dangling alias after lineage failure",
    () => {
      const fixture = runPosixInstallerFixture();

      expect(
        fixture.run.status,
        fixture.run.stderr || fixture.run.stdout,
      ).not.toBe(0);
      expect(fs.existsSync(fixture.targetPath)).toBe(false);
      expect(fs.existsSync(fixture.aliasPath)).toBe(false);
      expect(fs.lstatSync(fixture.targetDir).isDirectory()).toBe(true);
      expect(fs.existsSync(`${fixture.targetPath}.update.lock`)).toBe(false);
      expect(
        fs
          .readdirSync(fixture.targetDir)
          .filter((name) => name.startsWith(".chainlesschain.")),
      ).toEqual([]);
    },
    120_000,
  );

  it.runIf(process.platform !== "win32")(
    "POSIX rollback failure preserves the prior generation snapshots and update lock",
    () => {
      const fixture = runPosixInstallerFixture({
        existing: true,
        failBackupRestore: true,
      });

      expect(
        fixture.run.status,
        fixture.run.stderr || fixture.run.stdout,
      ).not.toBe(0);
      expect(fs.readFileSync(fixture.targetPath)).toEqual(
        fixture.prestate.targetBytes,
      );
      expect(fs.readFileSync(fixture.backupPath)).toEqual(
        fixture.prestate.targetBytes,
      );
      const names = fs.readdirSync(fixture.targetDir);
      const backupSnapshot = names.find((name) =>
        name.startsWith(".chainlesschain.backup-prior-"),
      );
      expect(backupSnapshot).toBeDefined();
      const backupSnapshotPath = path.join(fixture.targetDir, backupSnapshot);
      expect(fs.readFileSync(backupSnapshotPath)).toEqual(
        fixture.prestate.backupBytes,
      );
      const snapshotStat = fs.statSync(backupSnapshotPath, { bigint: true });
      expect(snapshotStat.dev).toBe(fixture.prestate.backupDev);
      expect(snapshotStat.ino).toBe(fixture.prestate.backupIno);
      expect(snapshotStat.mode).toBe(fixture.prestate.backupMode);
      expect(
        names.some((name) => name.startsWith(".chainlesschain.lineage-prior-")),
      ).toBe(true);
      expect(names.some((name) => name.startsWith(".cc.prior-"))).toBe(true);
      expect(fs.existsSync(`${fixture.targetPath}.update.lock`)).toBe(true);
    },
    120_000,
  );

  it.runIf(process.platform !== "win32")(
    "POSIX recovery cleanup failure retains snapshots and the update lock",
    () => {
      const fixture = runPosixInstallerFixture({
        existing: true,
        failSnapshotCleanup: true,
      });

      expect(
        fixture.run.status,
        fixture.run.stderr || fixture.run.stdout,
      ).not.toBe(0);
      expect(fs.readFileSync(fixture.targetPath)).toEqual(
        fixture.prestate.targetBytes,
      );
      expect(fs.readFileSync(fixture.backupPath)).toEqual(
        fixture.prestate.backupBytes,
      );
      expect(fs.readFileSync(fixture.lineagePath, "utf8")).toBe(
        fixture.prestate.rawLineage,
      );
      expect(fs.readlinkSync(fixture.aliasPath)).toBe(
        fixture.prestate.aliasTarget,
      );
      const names = fs.readdirSync(fixture.targetDir);
      expect(
        names.some((name) => name.startsWith(".chainlesschain.backup-prior-")),
      ).toBe(true);
      expect(fs.existsSync(`${fixture.targetPath}.update.lock`)).toBe(true);
    },
    120_000,
  );

  it.runIf(process.platform !== "win32")(
    "POSIX rollback fsync failure retains every recovery snapshot and the update lock",
    () => {
      const fixture = runPosixInstallerFixture({
        existing: true,
        failRollbackFsync: true,
      });

      expect(
        fixture.run.status,
        fixture.run.stderr || fixture.run.stdout,
      ).not.toBe(0);
      expect(fs.readFileSync(fixture.targetPath)).toEqual(
        fixture.prestate.targetBytes,
      );
      expect(fs.readFileSync(fixture.backupPath)).toEqual(
        fixture.prestate.backupBytes,
      );
      expect(fs.readFileSync(fixture.lineagePath, "utf8")).toBe(
        fixture.prestate.rawLineage,
      );
      expect(fs.readlinkSync(fixture.aliasPath)).toBe(
        fixture.prestate.aliasTarget,
      );
      const names = fs.readdirSync(fixture.targetDir);
      expect(
        names.filter(
          (name) =>
            name.startsWith(".chainlesschain.backup-prior-") ||
            name.startsWith(".chainlesschain.lineage-prior-") ||
            name.startsWith(".cc.prior-"),
        ),
      ).toHaveLength(3);
      expect(fs.existsSync(`${fixture.targetPath}.update.lock`)).toBe(true);
    },
    120_000,
  );

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
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          command,
        ],
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
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          command,
        ],
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
