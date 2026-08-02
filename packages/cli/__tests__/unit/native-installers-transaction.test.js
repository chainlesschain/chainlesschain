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
const fixtureTempRoot = fs.realpathSync(os.tmpdir());
const fixtureDirectoryPrefixes = [
  "cc-sh-install-tx-",
  "cc-ps-install-tx-",
  "cc-ps-install-fresh-",
];

afterEach(() => {
  while (temporaryDirectories.length) {
    const temporaryDirectory = fs.realpathSync(temporaryDirectories.pop());
    if (
      path.dirname(temporaryDirectory) !== fixtureTempRoot ||
      !fixtureDirectoryPrefixes.some((prefix) =>
        path.basename(temporaryDirectory).startsWith(prefix),
      )
    ) {
      throw new Error(
        `refusing to remove a non-fixture directory: ${temporaryDirectory}`,
      );
    }
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
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

function pathLexists(filePath) {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function writeShellTool(directory, name, source) {
  const filePath = path.join(directory, name);
  fs.writeFileSync(filePath, source.replaceAll("\r\n", "\n"));
  fs.chmodSync(filePath, 0o755);
  return filePath;
}

function runPosixInstallerFixture({
  existing = false,
  targetOnly = false,
  lineageFailure = "before",
  failLineageDirectoryFsync = false,
  failBackupRestore = false,
  failLineageRestore = false,
  failSnapshotCleanup = "none",
  failRollbackFsync = false,
  tamperAliasSnapshot = false,
  replacePublicBeforeRollback = "none",
  replaceLockOnRelease = false,
  lockReleaseFault = "none",
  killAfterTargetReplace = false,
  tamperRecoveryPointerDuringRetire = false,
} = {}) {
  const root = fs.mkdtempSync(path.join(fixtureTempRoot, "cc-sh-install-tx-"));
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

  const posixShell =
    process.env.CC_TEST_POSIX_SHELL ||
    (process.platform === "win32" ? "bash" : "/bin/sh");
  const toolLookup = spawnSync(
    posixShell,
    ["-c", "command -v python3; command -v ln; command -v rm; command -v mv"],
    { encoding: "utf8" },
  );
  expect(toolLookup.status, toolLookup.stderr).toBe(0);
  const [realPython, realLn, realRm, realMv] = toolLookup.stdout
    .trim()
    .split(/\r?\n/);
  const lineageFailedSentinel = path.join(root, "lineage-write-failed");
  const lockReplacedSentinel = path.join(root, "lock-replaced");
  const targetReplacedSentinel = path.join(root, "target-replaced-before-kill");
  const recoveryPointerTamperedSentinel = path.join(
    root,
    "recovery-pointer-tampered",
  );
  const successorLockValue = "successor-lock-must-survive";
  const releaseFaultBootstrap = path.join(root, "release-fault-bootstrap.py");
  fs.writeFileSync(
    releaseFaultBootstrap,
    `import errno
import sys

fault = sys.argv[1]
helper_argv = sys.argv[2:]
source = sys.stdin.read()
injections = {
    'unlink-held': "    os.unlink(held_path)\\n",
    'fsync-release-dir': "    durability_barrier('unlinked-release-dir', release_dir)\\n",
    'rmdir-release': "    os.rmdir(release_dir)\\n",
    'fsync-release-parent': "    durability_barrier('removed-release-dir-parent', install_dir)\\n",
    'unlink-anchor': "        os.unlink(anchor_path)\\n",
    'fsync-anchor-parent-final': "        durability_barrier('anchor-removed-parent', install_dir)\\n",
}
needle = injections.get(fault)
if needle is None or source.count(needle) != 1:
    raise SystemExit(f'could not inject release-lock fault: {fault}')
indent = needle[:len(needle) - len(needle.lstrip())]
source = source.replace(
    needle,
    indent + f"raise OSError(errno.EIO, 'injected {fault} failure')\\n",
    1,
)
sys.argv = helper_argv
exec(compile(source, '<release-lock>', 'exec'), {'__name__': '__main__'})
`,
  );
  const recoveryPointerFaultBootstrap = path.join(
    root,
    "recovery-pointer-fault-bootstrap.py",
  );
  fs.writeFileSync(
    recoveryPointerFaultBootstrap,
    `import os
import sys

helper_argv = sys.argv[1:]
source = sys.stdin.read()
needle = "        os.link(state_path, retired_path, follow_symlinks=False)"
if source.count(needle) != 1:
    raise SystemExit('could not inject recovery-pointer identity replacement')
replacement = """        with open(state_path, 'rb') as pointer_stream:
            pointer_bytes = pointer_stream.read()
        replacement_path = state_path + '.identity-replacement'
        with open(replacement_path, 'wb') as replacement_stream:
            replacement_stream.write(pointer_bytes)
            replacement_stream.flush()
            os.fsync(replacement_stream.fileno())
        os.replace(replacement_path, state_path)
        with open(os.environ['CC_TEST_RECOVERY_POINTER_TAMPERED_SENTINEL'], 'wb'):
            pass
        os.link(state_path, retired_path, follow_symlinks=False)"""
source = source.replace(needle, replacement, 1)
sys.argv = helper_argv
exec(compile(source, '<recovery-state>', 'exec'), {'__name__': '__main__'})
`,
  );
  writeShellTool(
    fakeBin,
    "python3",
    `#!/usr/bin/env sh
if [ "\${1:-}" = "-" ] && [ "\${2:-}" = "write-lineage" ] && [ "$#" -eq 7 ] && [ "\${5:-}" = "install" ]; then
  case "\${3:-}" in
    *.update-lineage.json)
      if [ "\${CC_TEST_TAMPER_ALIAS_SNAPSHOT:-0}" = "1" ]; then
        for candidate in "$CC_TEST_TARGET_DIR"/.cc.prior-*; do
          [ -L "$candidate" ] || continue
          "$REAL_RM" -f "$candidate"
          "$REAL_LN" -s attacker-controlled-target "$candidate"
        done
      fi
      if [ "\${CC_TEST_FAIL_LINEAGE_WRITE:-0}" = "before" ]; then
        : > "$CC_TEST_LINEAGE_FAILED_SENTINEL"
        exit 91
      fi
      if [ "\${CC_TEST_FAIL_LINEAGE_WRITE:-0}" = "after" ]; then
        "$REAL_PYTHON" "$@"
        status=$?
        [ "$status" -eq 0 ] || exit "$status"
        case "\${CC_TEST_REPLACE_PUBLIC_BEFORE_ROLLBACK:-none}" in
          target)
            cp "$CC_TEST_TARGET_DIR/chainlesschain" "$CC_TEST_TARGET_DIR/.successor-target"
            chmod 755 "$CC_TEST_TARGET_DIR/.successor-target"
            "$REAL_MV" -f "$CC_TEST_TARGET_DIR/.successor-target" "$CC_TEST_TARGET_DIR/chainlesschain"
            ;;
          backup)
            cp "$CC_TEST_TARGET_DIR/chainlesschain.previous" "$CC_TEST_TARGET_DIR/.successor-backup"
            chmod 755 "$CC_TEST_TARGET_DIR/.successor-backup"
            "$REAL_MV" -f "$CC_TEST_TARGET_DIR/.successor-backup" "$CC_TEST_TARGET_DIR/chainlesschain.previous"
            ;;
          lineage)
            cp "$CC_TEST_TARGET_DIR/chainlesschain.update-lineage.json" "$CC_TEST_TARGET_DIR/.successor-lineage"
            chmod 600 "$CC_TEST_TARGET_DIR/.successor-lineage"
            "$REAL_MV" -f "$CC_TEST_TARGET_DIR/.successor-lineage" "$CC_TEST_TARGET_DIR/chainlesschain.update-lineage.json"
            ;;
          alias)
            "$REAL_RM" -f "$CC_TEST_TARGET_DIR/cc"
            "$REAL_LN" -s chainlesschain "$CC_TEST_TARGET_DIR/cc"
            ;;
        esac
        : > "$CC_TEST_LINEAGE_FAILED_SENTINEL"
        exit 91
      fi
      if [ "\${CC_TEST_FAIL_LINEAGE_DIR_FSYNC:-0}" = "1" ]; then
        "$REAL_PYTHON" "$@"
        status=$?
        [ "$status" -eq 0 ] || exit "$status"
        : > "$CC_TEST_LINEAGE_FAILED_SENTINEL"
        exit 96
      fi
      ;;
  esac
fi
if [ "\${CC_TEST_FAIL_ROLLBACK_FSYNC:-0}" = "1" ] && [ -f "$CC_TEST_LINEAGE_FAILED_SENTINEL" ] && [ "\${1:-}" = "-" ] && [ "\${2:-}" = "$CC_TEST_CANONICAL_INSTALL_DIR" ]; then
  exit 92
fi
if [ "\${1:-}" = "-" ] && [ "\${2:-}" = "release-lock" ] && [ "\${CC_TEST_REPLACE_LOCK_ON_RELEASE:-0}" = "1" ] && [ ! -f "$CC_TEST_LOCK_REPLACED_SENTINEL" ]; then
  "$REAL_RM" -f "\${3:-}"
  printf '%s' "$CC_TEST_SUCCESSOR_LOCK_VALUE" > "\${3:-}"
  : > "$CC_TEST_LOCK_REPLACED_SENTINEL"
fi
if [ "\${1:-}" = "-" ] && [ "\${2:-}" = "release-lock" ] && [ "\${CC_TEST_LOCK_RELEASE_FAULT:-none}" != "none" ]; then
  exec "$REAL_PYTHON" "$CC_TEST_RELEASE_FAULT_BOOTSTRAP" "$CC_TEST_LOCK_RELEASE_FAULT" "$@"
fi
if [ "\${1:-}" = "-" ] && [ "\${2:-}" = "recovery-state" ] && [ "\${3:-}" = "retire" ] && [ "\${CC_TEST_TAMPER_RECOVERY_POINTER_DURING_RETIRE:-0}" = "1" ]; then
  exec "$REAL_PYTHON" "$CC_TEST_RECOVERY_POINTER_FAULT_BOOTSTRAP" "$@"
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
if [ "\${CC_TEST_FAIL_SNAPSHOT_CLEANUP:-none}" != "none" ]; then
  for candidate in "$@"; do
    if [ "$CC_TEST_FAIL_SNAPSHOT_CLEANUP" = "prior-backup" ]; then
      case "$candidate" in */.chainlesschain.backup-prior-*) exit 94 ;; esac
    fi
    if [ "$CC_TEST_FAIL_SNAPSHOT_CLEANUP" = "prior-lineage" ]; then
      case "$candidate" in */.chainlesschain.lineage-prior-*) exit 94 ;; esac
    fi
    if [ "$CC_TEST_FAIL_SNAPSHOT_CLEANUP" = "retired-pointer" ]; then
      case "$candidate" in */.chainlesschain.recovery-retired-*.json) exit 94 ;; esac
    fi
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
if [ "\${CC_TEST_KILL_AFTER_TARGET_REPLACE:-0}" = "1" ]; then
  previous=""
  destination=""
  for candidate in "$@"; do
    previous=$destination
    destination=$candidate
  done
  case "$previous" in
    */.chainlesschain.new.*)
      if [ "$destination" = "$CC_TEST_TARGET_PATH" ]; then
        "$REAL_MV" "$@"
        : > "$CC_TEST_TARGET_REPLACED_SENTINEL"
        kill -KILL "$PPID"
        exit 97
      fi
      ;;
  esac
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
    if (!targetOnly) {
      fs.writeFileSync(backupPath, "older-known-good");
      fs.chmodSync(backupPath, 0o640);
      fs.writeFileSync(lineagePath, rawLineage);
      fs.symlinkSync("legacy-chainlesschain", aliasPath);
    }
    const backupStat = targetOnly
      ? null
      : fs.statSync(backupPath, { bigint: true });
    prestate = {
      targetBytes: fs.readFileSync(targetPath),
      backupBytes: targetOnly ? null : fs.readFileSync(backupPath),
      backupDev: backupStat?.dev ?? null,
      backupIno: backupStat?.ino ?? null,
      backupMode: backupStat?.mode ?? null,
      rawLineage: targetOnly ? null : rawLineage,
      aliasTarget: targetOnly ? null : fs.readlinkSync(aliasPath),
    };
  }

  const run = spawnSync(posixShell, [shPath], {
    encoding: "utf8",
    timeout: 90_000,
    env: {
      ...process.env,
      TMPDIR: root,
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
      CC_TEST_FAIL_LINEAGE_DIR_FSYNC: failLineageDirectoryFsync ? "1" : "0",
      CC_TEST_FAIL_BACKUP_RESTORE: failBackupRestore ? "1" : "0",
      CC_TEST_FAIL_LINEAGE_RESTORE: failLineageRestore ? "1" : "0",
      CC_TEST_FAIL_SNAPSHOT_CLEANUP: failSnapshotCleanup,
      CC_TEST_FAIL_ROLLBACK_FSYNC: failRollbackFsync ? "1" : "0",
      CC_TEST_TAMPER_ALIAS_SNAPSHOT: tamperAliasSnapshot ? "1" : "0",
      CC_TEST_REPLACE_PUBLIC_BEFORE_ROLLBACK: replacePublicBeforeRollback,
      CC_TEST_REPLACE_LOCK_ON_RELEASE: replaceLockOnRelease ? "1" : "0",
      CC_TEST_LOCK_RELEASE_FAULT: lockReleaseFault,
      CC_TEST_KILL_AFTER_TARGET_REPLACE: killAfterTargetReplace ? "1" : "0",
      CC_TEST_TAMPER_RECOVERY_POINTER_DURING_RETIRE:
        tamperRecoveryPointerDuringRetire ? "1" : "0",
      CC_TEST_LINEAGE_FAILED_SENTINEL: lineageFailedSentinel,
      CC_TEST_CANONICAL_INSTALL_DIR: fs.realpathSync(targetDir),
      CC_TEST_TARGET_DIR: targetDir,
      CC_TEST_LOCK_REPLACED_SENTINEL: lockReplacedSentinel,
      CC_TEST_TARGET_REPLACED_SENTINEL: targetReplacedSentinel,
      CC_TEST_RECOVERY_POINTER_TAMPERED_SENTINEL:
        recoveryPointerTamperedSentinel,
      CC_TEST_TARGET_PATH: targetPath,
      CC_TEST_SUCCESSOR_LOCK_VALUE: successorLockValue,
      CC_TEST_RELEASE_FAULT_BOOTSTRAP: releaseFaultBootstrap,
      CC_TEST_RECOVERY_POINTER_FAULT_BOOTSTRAP: recoveryPointerFaultBootstrap,
    },
  });
  if (
    lineageFailure === "before" ||
    lineageFailure === "after" ||
    failLineageDirectoryFsync
  ) {
    expect(
      pathLexists(lineageFailedSentinel),
      `fixture never reached the lineage writer; stderr:\n${run.stderr}`,
    ).toBe(true);
  }
  return {
    root,
    targetDir,
    targetPath,
    backupPath,
    lineagePath,
    aliasPath,
    artifactSha256,
    lineageFailedSentinel,
    lockReplacedSentinel,
    targetReplacedSentinel,
    recoveryPointerTamperedSentinel,
    successorLockValue,
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
      'BACKUP_TEMP_PATH="$INSTALL_DIR/.chainlesschain.previous-$TRANSACTION_ID"',
    );
    expect(source).toContain('ln "$PRIOR_TARGET_PATH" "$BACKUP_TEMP_PATH"');
    expect(source).toContain('mv -f "$BACKUP_TEMP_PATH" "$BACKUP_PATH"');
    expect(source).toContain(
      'ROLLBACK_TEMP_PATH="$INSTALL_DIR/.chainlesschain.rollback-$TRANSACTION_ID"',
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
    expect(source).toContain('python3 - "write-lineage"');
    expect(source).toContain("if error.errno not in unsupported:");
    expect(source).toContain("chainlesschain.native-install-recovery.v1");
    expect(source).toContain("'priorTarget': {");
    expect(source).toContain("'sha256': old_target_sha or None");
    expect(source).toContain("process_recovery_state() {");
    expect(source).not.toContain("validate_recovery_state() {");
    expect(source).not.toContain("retire_recovery_state() {");
    expect(source).toContain(
      "os.link(state_path, retired_path, follow_symlinks=False)",
    );
    expect(source).toContain("retired recovery-state pointer changed identity");
    expect(source).toContain("alias_matches_hash");
    expect(source).toContain('OLD_ALIAS_TARGET_SHA256=""');
    expect(source).toContain("'targetSha256': old_alias_target_sha or None");
    expect(source).not.toContain(
      'alias_matches_snapshot "$PRIOR_ALIAS_PATH" "$PRIOR_ALIAS_PATH"',
    );
    expect(source).toContain(
      "def restore_owned_without_overwrite(source_path):",
    );
    expect(source).toContain("durability_barrier('unlinked-release-dir'");
    expect(source).toContain("durability_barrier('removed-release-dir-parent'");
    expect(source).toContain("durability_barrier('anchor-removed-parent'");
    expect(source).toContain("os.rename(lock_path, held_path)");
    expect(source).toContain(
      "refusing to delete a successor native update lock",
    );
    expect(source).toContain(
      "native update lock retained for manual recovery at $LOCK_PATH",
    );
    expect(source).toContain("os.lstat(current)");
    expect(source).toContain('INSTALLED_LINEAGE_IDENTITY=""');
    expect(source).toContain('INSTALLED_ALIAS_IDENTITY=""');
    expect(source).toContain("alias_matches_identity");
    expect(source).toContain(
      'regular_file_matches "$BACKUP_TEMP_PATH" "$OLD_TARGET_SHA256" "$OLD_TARGET_IDENTITY"',
    );
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
      expect(pathLexists(fixture.aliasPath)).toBe(false);
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
      expect(pathLexists(fixture.aliasPath)).toBe(false);
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
    "POSIX retired recovery cleanup reports a partial set and retains the update lock",
    () => {
      const fixture = runPosixInstallerFixture({
        existing: true,
        failSnapshotCleanup: "prior-lineage",
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
      ).toBe(false);
      expect(
        names.some((name) => name.startsWith(".chainlesschain.lineage-prior-")),
      ).toBe(true);
      expect(names.some((name) => name.startsWith(".cc.prior-"))).toBe(true);
      expect(
        names.some((name) =>
          name.startsWith(".chainlesschain.recovery-retired-"),
        ),
      ).toBe(true);
      expect(fixture.run.stderr).toContain(
        "remaining artifacts may be partial",
      );
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

  it.runIf(process.platform !== "win32")(
    "POSIX lineage directory durability failure rolls every public path back and retains no stale lock",
    () => {
      const fixture = runPosixInstallerFixture({
        existing: true,
        lineageFailure: "none",
        failLineageDirectoryFsync: true,
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
      expect(pathLexists(`${fixture.targetPath}.update.lock`)).toBe(false);
    },
    120_000,
  );

  it.runIf(process.platform !== "win32")(
    "POSIX alias recovery fails closed when its symlink snapshot target is tampered",
    () => {
      const fixture = runPosixInstallerFixture({
        existing: true,
        tamperAliasSnapshot: true,
      });

      expect(
        fixture.run.status,
        fixture.run.stderr || fixture.run.stdout,
      ).not.toBe(0);
      expect(fs.readlinkSync(fixture.aliasPath)).not.toBe(
        "attacker-controlled-target",
      );
      expect(fs.readlinkSync(fixture.aliasPath)).toBe("chainlesschain");
      const names = fs.readdirSync(fixture.targetDir);
      const aliasSnapshot = names.find((name) => name.startsWith(".cc.prior-"));
      expect(aliasSnapshot).toBeDefined();
      expect(fs.readlinkSync(path.join(fixture.targetDir, aliasSnapshot))).toBe(
        "attacker-controlled-target",
      );
      expect(pathLexists(`${fixture.targetPath}.update.lock`)).toBe(true);
    },
    120_000,
  );

  it.runIf(process.platform !== "win32")(
    "POSIX target-only prestate is represented by a durable recovery pointer",
    () => {
      const fixture = runPosixInstallerFixture({
        existing: true,
        targetOnly: true,
        failRollbackFsync: true,
      });

      expect(
        fixture.run.status,
        fixture.run.stderr || fixture.run.stdout,
      ).not.toBe(0);
      expect(fs.readFileSync(fixture.targetPath)).toEqual(
        fixture.prestate.targetBytes,
      );
      const names = fs.readdirSync(fixture.targetDir);
      const pointerName = names.find(
        (name) =>
          name.startsWith(".chainlesschain.recovery-") &&
          !name.startsWith(".chainlesschain.recovery-retired-"),
      );
      const priorTargetName = names.find((name) =>
        name.startsWith(".chainlesschain.target-prior-"),
      );
      expect(pointerName).toBeDefined();
      expect(priorTargetName).toBeDefined();
      const pointer = JSON.parse(
        fs.readFileSync(path.join(fixture.targetDir, pointerName), "utf8"),
      );
      expect(pointer).toMatchObject({
        schema: "chainlesschain.native-install-recovery.v1",
        members: {
          priorTarget: {
            path: path.join(fixture.targetDir, priorTargetName),
            sha256: sha256File(fixture.targetPath),
          },
          priorBackup: { path: null },
          priorLineage: { path: null },
          priorAlias: { path: null },
        },
      });
      expect(fs.readFileSync(pointer.members.priorTarget.path)).toEqual(
        fixture.prestate.targetBytes,
      );
      expect(pathLexists(`${fixture.targetPath}.update.lock`)).toBe(true);
    },
    120_000,
  );

  it.runIf(process.platform !== "win32")(
    "POSIX SIGKILL after target replacement leaves the prior target recoverable from its durable pointer",
    () => {
      const fixture = runPosixInstallerFixture({
        existing: true,
        targetOnly: true,
        lineageFailure: "none",
        killAfterTargetReplace: true,
      });

      expect(
        fixture.run.status,
        fixture.run.stderr || fixture.run.stdout,
      ).not.toBe(0);
      expect(
        pathLexists(fixture.targetReplacedSentinel),
        fixture.run.stderr || fixture.run.stdout,
      ).toBe(true);
      expect(sha256File(fixture.targetPath)).toBe(fixture.artifactSha256);
      expect(pathLexists(fixture.backupPath)).toBe(false);

      const names = fs.readdirSync(fixture.targetDir);
      const pointerName = names.find(
        (name) =>
          name.startsWith(".chainlesschain.recovery-") &&
          !name.startsWith(".chainlesschain.recovery-retired-"),
      );
      expect(pointerName).toBeDefined();
      const pointer = JSON.parse(
        fs.readFileSync(path.join(fixture.targetDir, pointerName), "utf8"),
      );
      const priorTargetPath = pointer.members.priorTarget.path;
      expect(priorTargetPath).toBeTruthy();
      expect(fs.readFileSync(priorTargetPath)).toEqual(
        fixture.prestate.targetBytes,
      );
      expect(pointer.members.priorTarget.sha256).toBe(
        sha256File(priorTargetPath),
      );

      // Exercise the recovery member, rather than merely checking that its
      // filename survived. A same-directory hard-link + rename restores the
      // exact prior inode without relying on the not-yet-published backup.
      const manualRestorePath = path.join(
        fixture.targetDir,
        ".chainlesschain.manual-restore",
      );
      fs.linkSync(priorTargetPath, manualRestorePath);
      fs.renameSync(manualRestorePath, fixture.targetPath);
      expect(fs.readFileSync(fixture.targetPath)).toEqual(
        fixture.prestate.targetBytes,
      );
      expect(pathLexists(`${fixture.targetPath}.update.lock`)).toBe(true);
    },
    120_000,
  );

  it.runIf(process.platform !== "win32")(
    "POSIX recovery retirement rejects a byte-identical pointer replacement after validation",
    () => {
      const fixture = runPosixInstallerFixture({
        existing: true,
        targetOnly: true,
        lineageFailure: "none",
        tamperRecoveryPointerDuringRetire: true,
      });

      expect(
        fixture.run.status,
        fixture.run.stderr || fixture.run.stdout,
      ).not.toBe(0);
      expect(pathLexists(fixture.recoveryPointerTamperedSentinel)).toBe(true);
      expect(fixture.run.stderr).toContain(
        "retired recovery-state pointer changed identity",
      );
      expect(sha256File(fixture.targetPath)).toBe(fixture.artifactSha256);
      expect(fs.readFileSync(fixture.backupPath)).toEqual(
        fixture.prestate.targetBytes,
      );

      const names = fs.readdirSync(fixture.targetDir);
      expect(
        names.filter(
          (name) =>
            name.startsWith(".chainlesschain.recovery-") &&
            !name.startsWith(".chainlesschain.recovery-retired-"),
        ),
      ).toHaveLength(1);
      expect(
        names.filter((name) =>
          name.startsWith(".chainlesschain.recovery-retired-"),
        ),
      ).toHaveLength(1);
      const priorTargetName = names.find((name) =>
        name.startsWith(".chainlesschain.target-prior-"),
      );
      expect(priorTargetName).toBeDefined();
      expect(
        fs.readFileSync(path.join(fixture.targetDir, priorTargetName)),
      ).toEqual(fixture.prestate.targetBytes);
      expect(pathLexists(`${fixture.targetPath}.update.lock`)).toBe(true);
    },
    120_000,
  );

  for (const publicPath of ["target", "backup", "lineage", "alias"]) {
    it.runIf(process.platform !== "win32")(
      `POSIX rollback preserves an identity-replaced ${publicPath} successor`,
      () => {
        const fixture = runPosixInstallerFixture({
          existing: true,
          lineageFailure: "after",
          replacePublicBeforeRollback: publicPath,
        });

        expect(
          fixture.run.status,
          fixture.run.stderr || fixture.run.stdout,
        ).not.toBe(0);
        // Preflight validates every public path before the first destructive
        // rollback step, so no other committed path is partially rolled back.
        expect(sha256File(fixture.targetPath)).toBe(fixture.artifactSha256);
        expect(fs.readFileSync(fixture.backupPath)).toEqual(
          fixture.prestate.targetBytes,
        );
        expect(
          JSON.parse(fs.readFileSync(fixture.lineagePath, "utf8")),
        ).toMatchObject({
          schema: "chainlesschain.native-update-lineage.v1",
          operation: "install",
          currentSha256: fixture.artifactSha256,
        });
        expect(fs.readlinkSync(fixture.aliasPath)).toBe("chainlesschain");
        expect(pathLexists(`${fixture.targetPath}.update.lock`)).toBe(true);
        expect(
          fs
            .readdirSync(fixture.targetDir)
            .some((name) => name.startsWith(".chainlesschain.recovery-")),
        ).toBe(true);
      },
      120_000,
    );
  }

  it.runIf(process.platform !== "win32")(
    "POSIX successful transaction removes every snapshot, pointer, temporary, and lock path",
    () => {
      const fixture = runPosixInstallerFixture({
        existing: true,
        lineageFailure: "none",
      });

      expect(fixture.run.status, fixture.run.stderr || fixture.run.stdout).toBe(
        0,
      );
      expect(sha256File(fixture.targetPath)).toBe(fixture.artifactSha256);
      expect(fs.readFileSync(fixture.backupPath)).toEqual(
        fixture.prestate.targetBytes,
      );
      expect(fs.readlinkSync(fixture.aliasPath)).toBe("chainlesschain");
      expect(pathLexists(`${fixture.targetPath}.update.lock`)).toBe(false);
      expect(
        fs
          .readdirSync(fixture.targetDir)
          .filter(
            (name) =>
              name.startsWith(".chainlesschain.") || name.startsWith(".cc."),
          ),
      ).toEqual([]);
    },
    120_000,
  );

  for (const lockReleaseFault of [
    "unlink-held",
    "fsync-release-dir",
    "rmdir-release",
    "fsync-release-parent",
    "unlink-anchor",
  ]) {
    it.runIf(process.platform !== "win32")(
      `POSIX ${lockReleaseFault} lock-release failure retains owned recovery evidence`,
      () => {
        const fixture = runPosixInstallerFixture({
          existing: true,
          lineageFailure: "none",
          lockReleaseFault,
        });
        const lockPath = `${fixture.targetPath}.update.lock`;
        const names = fs.readdirSync(fixture.targetDir);

        expect(
          fixture.run.status,
          fixture.run.stderr || fixture.run.stdout,
        ).not.toBe(0);
        expect(fs.lstatSync(lockPath).isFile()).toBe(true);
        expect(fs.readFileSync(lockPath).length).toBeGreaterThan(0);
        expect(
          names.some((name) => name.startsWith(".chainlesschain.lock-anchor-")),
        ).toBe(true);
        if (lockReleaseFault === "fsync-release-parent") {
          expect(
            names.some((name) =>
              name.startsWith(".chainlesschain.lock-release-"),
            ),
          ).toBe(false);
        } else if (lockReleaseFault !== "unlink-anchor") {
          expect(
            names.some((name) =>
              name.startsWith(".chainlesschain.lock-release-"),
            ),
          ).toBe(true);
        }
        expect(fixture.run.stderr).toContain(
          "native update lock release failed",
        );
      },
      120_000,
    );
  }

  it.runIf(process.platform !== "win32")(
    "POSIX final lock-anchor directory fsync failure is reported instead of claiming durable release",
    () => {
      const fixture = runPosixInstallerFixture({
        existing: true,
        lineageFailure: "none",
        lockReleaseFault: "fsync-anchor-parent-final",
      });
      const names = fs.readdirSync(fixture.targetDir);

      expect(
        fixture.run.status,
        fixture.run.stderr || fixture.run.stdout,
      ).not.toBe(0);
      expect(sha256File(fixture.targetPath)).toBe(fixture.artifactSha256);
      expect(pathLexists(`${fixture.targetPath}.update.lock`)).toBe(false);
      expect(
        names.some(
          (name) =>
            name.startsWith(".chainlesschain.lock-anchor-") ||
            name.startsWith(".chainlesschain.lock-release-"),
        ),
      ).toBe(false);
      expect(fixture.run.stderr).toContain("native update lock release failed");
    },
    120_000,
  );

  it.runIf(process.platform !== "win32")(
    "POSIX lock release never deletes a successor installed at the public lock path",
    () => {
      const fixture = runPosixInstallerFixture({
        existing: true,
        lineageFailure: "none",
        replaceLockOnRelease: true,
      });
      const lockPath = `${fixture.targetPath}.update.lock`;

      expect(
        fixture.run.status,
        fixture.run.stderr || fixture.run.stdout,
      ).not.toBe(0);
      expect(pathLexists(fixture.lockReplacedSentinel)).toBe(true);
      expect(fs.readFileSync(lockPath, "utf8")).toBe(
        fixture.successorLockValue,
      );
      expect(fixture.run.stderr).toContain("no unverified lock was deleted");
      expect(
        fs
          .readdirSync(fixture.targetDir)
          .some((name) => name.startsWith(".chainlesschain.lock-release-")),
      ).toBe(false);
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
    const posixShells =
      process.platform === "win32"
        ? ["sh", "bash"]
        : ["/bin/sh", "dash", "bash"];
    for (const shell of posixShells) {
      const parsed = spawnSync(shell, ["-n", shPath], { encoding: "utf8" });
      if (!parsed.error || parsed.error.code !== "ENOENT") {
        expect(parsed.status, `${shell}: ${parsed.stderr}`).toBe(0);
      }
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
