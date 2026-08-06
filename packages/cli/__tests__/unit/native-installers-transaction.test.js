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
  "cc-ps-install-crash-",
  "cc-ps-install-fresh-",
  "cc-ps-stale-lock-",
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

const wslDistribution = process.env.CC_TEST_WSL_DISTRO || "Ubuntu";

function windowsPathToWsl(filePath) {
  const normalized = path.resolve(filePath).replaceAll("\\", "/");
  const match = /^([A-Za-z]):(\/.*)$/.exec(normalized);
  if (!match) {
    throw new Error(`cannot map path into WSL: ${filePath}`);
  }
  return `/mnt/${match[1].toLowerCase()}${match[2]}`;
}

function wslSupportsOrphanRaceFixtures() {
  if (process.platform !== "win32") return false;
  const probe = spawnSync(
    "wsl.exe",
    [
      "-d",
      wslDistribution,
      "--",
      "/bin/sh",
      "-c",
      "test -x /bin/bash && test -x /bin/dash && command -v python3 >/dev/null",
    ],
    { encoding: "utf8", timeout: 15_000 },
  );
  return probe.status === 0;
}

const hasWslOrphanRaceFixture = wslSupportsOrphanRaceFixtures();

function runWslOrphanRaceFixture({ posixShell, orphanState }) {
  const root = fs.mkdtempSync(path.join(fixtureTempRoot, "cc-sh-install-tx-"));
  temporaryDirectories.push(root);
  const fixtureDir = path.join(root, "fixtures");
  const fakeBin = path.join(root, "fake-bin");
  const targetDir = path.join(root, "bin");
  fs.mkdirSync(fixtureDir, { recursive: true });
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.mkdirSync(targetDir, { recursive: true });

  const artifactPath = path.join(fixtureDir, "artifact");
  const artifactCopy = spawnSync(
    "wsl.exe",
    [
      "-d",
      wslDistribution,
      "--",
      "cp",
      "/bin/true",
      windowsPathToWsl(artifactPath),
    ],
    { encoding: "utf8", timeout: 15_000 },
  );
  expect(artifactCopy.status, artifactCopy.stderr || artifactCopy.stdout).toBe(
    0,
  );
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

  const mutationRaceSentinel = path.join(root, "mutation-race-injected");
  const orphanRetentionFaultBootstrap = path.join(
    root,
    "orphan-retention-fault-bootstrap.py",
  );
  fs.writeFileSync(
    orphanRetentionFaultBootstrap,
    `import sys

helper_argv = sys.argv[1:]
source = sys.stdin.read()
needle = "    before = os.fstat(fd)"
if source.count(needle) != 1:
    raise SystemExit('could not instrument fd-bound orphan retention helper')
injection = r'''    race = os.environ.get('CC_TEST_MUTATION_RACE', 'none')
    successor_path = orphan_path + '.same-uid-successor'
    payload = (
        b'successor-orphan-backup-must-survive'
        if race == 'orphan-backup'
        else b'successor-orphan-lineage-must-survive'
    )
    descriptor = os.open(
        successor_path,
        os.O_CREAT | os.O_EXCL | os.O_WRONLY,
        stat.S_IMODE(os.fstat(fd).st_mode),
    )
    try:
        os.write(descriptor, payload)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    os.replace(successor_path, orphan_path)
    with open(os.environ['CC_TEST_MUTATION_RACE_SENTINEL'], 'wb'):
        pass
    before = os.fstat(fd)'''
source = source.replace(needle, injection, 1)
sys.argv = helper_argv
exec(compile(source, '<retain-regular-orphan>', 'exec'), {'__name__': '__main__'})
`,
  );
  writeShellTool(
    fakeBin,
    "python3",
    `#!/usr/bin/env sh
if [ "\${1:-}" = "-" ] && [ "\${2:-}" = "retain-regular-orphan" ]; then
  exec /usr/bin/python3 "$CC_TEST_ORPHAN_RETENTION_FAULT_BOOTSTRAP" "$@"
fi
exec /usr/bin/python3 "$@"
`,
  );

  const targetPath = path.join(targetDir, "chainlesschain");
  const backupPath = `${targetPath}.previous`;
  const lineagePath = `${targetPath}.update-lineage.json`;
  const orphanPath = orphanState === "backup" ? backupPath : lineagePath;
  fs.writeFileSync(orphanPath, `orphan-${orphanState}-must-survive`);
  const orphanStat = fs.lstatSync(orphanPath, { bigint: true });

  const wslRoot = windowsPathToWsl(root);
  const wslTargetDir = windowsPathToWsl(targetDir);
  const environment = [
    `TMPDIR=${wslRoot}`,
    `PATH=${windowsPathToWsl(fakeBin)}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
    `FIXTURE_MANIFEST=${windowsPathToWsl(manifestPath)}`,
    `FIXTURE_BUNDLE=${windowsPathToWsl(bundlePath)}`,
    `FIXTURE_ARTIFACT=${windowsPathToWsl(artifactPath)}`,
    "CC_CLI_RELEASE_BASE_URL=https://fixture/base",
    `CC_CLI_INSTALL_DIR=${wslTargetDir}`,
    `CC_TEST_MUTATION_RACE=orphan-${orphanState}`,
    `CC_TEST_MUTATION_RACE_SENTINEL=${windowsPathToWsl(mutationRaceSentinel)}`,
    `CC_TEST_ORPHAN_RETENTION_FAULT_BOOTSTRAP=${windowsPathToWsl(orphanRetentionFaultBootstrap)}`,
  ];
  const run = spawnSync(
    "wsl.exe",
    [
      "-d",
      wslDistribution,
      "--",
      "env",
      ...environment,
      posixShell,
      windowsPathToWsl(shPath),
    ],
    { encoding: "utf8", timeout: 90_000 },
  );

  return {
    root,
    targetDir,
    targetPath,
    prestate: {
      orphanPath,
      orphanDev: orphanStat.dev,
      orphanIno: orphanStat.ino,
    },
    mutationRaceSentinel,
    run,
  };
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
  crashAfterPhase = "",
  terminateAfterPhase = "",
  tamperRecoveryPointerDuringRetire = false,
  mutationRace = "none",
  terminateAfterPublication = "none",
  terminateDuringRecoveryRetirement = false,
  failRecoveryStateCreate = false,
  replaceRecoveryFallbackSource = false,
  replaceCandidateDuringMaterialization = false,
  replaceStagingBeforeCleanup = false,
  orphanState = "none",
  posixShell: requestedPosixShell = null,
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
    requestedPosixShell ||
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
  const mutationRaceSentinel = path.join(root, "mutation-race-injected");
  const publicationTerminatedSentinel = path.join(
    root,
    "publication-termination-injected",
  );
  const recoveryRetirementTerminatedSentinel = path.join(
    root,
    "recovery-retirement-termination-injected",
  );
  const recoveryStateCreateFailedSentinel = path.join(
    root,
    "recovery-state-create-failure-injected",
  );
  const recoveryFallbackSourceReplacedSentinel = path.join(
    root,
    "recovery-fallback-source-replaced",
  );
  const lockEvidenceReplacedSentinel = path.join(
    root,
    "lock-evidence-replaced",
  );
  const candidateReplacedSentinel = path.join(root, "candidate-replaced");
  const stagingReplacedSentinel = path.join(root, "staging-replaced");
  const candidateVictimPath = path.join(root, "candidate-victim");
  fs.writeFileSync(candidateVictimPath, "candidate-victim-must-survive");
  fs.chmodSync(candidateVictimPath, 0o640);
  const successorLockValue = "successor-lock-must-survive";
  const releaseFaultBootstrap = path.join(root, "release-fault-bootstrap.py");
  fs.writeFileSync(
    releaseFaultBootstrap,
    `import errno
import os
import sys

fault = sys.argv[1]
helper_argv = sys.argv[2:]
source = sys.stdin.read()
if fault in ('replace-held', 'replace-anchor'):
    needle = "    released = True"
    if source.count(needle) != 1:
        raise SystemExit(f'could not inject release-lock replacement: {fault}')
    replacement = """    replacement_fault = os.environ['CC_TEST_LOCK_RELEASE_FAULT']
    replacement_target = held_path if replacement_fault == 'replace-held' else anchor_path
    successor_path = replacement_target + '.successor'
    with open(successor_path, 'wb') as successor:
        successor.write((replacement_fault + '-successor-must-survive').encode('utf-8'))
        successor.flush()
        os.fsync(successor.fileno())
    os.replace(successor_path, replacement_target)
    with open(os.environ['CC_TEST_LOCK_EVIDENCE_REPLACED_SENTINEL'], 'wb'):
        pass
    released = True"""
    source = source.replace(needle, replacement, 1)
else:
    needle = "    durability_barrier('renamed-parent', install_dir)\\n"
    if fault != 'fsync-renamed-parent' or source.count(needle) != 1:
        raise SystemExit(f'could not inject release-lock fault: {fault}')
    source = source.replace(
        needle,
        "    raise OSError(errno.EIO, 'injected fsync-renamed-parent failure')\\n",
        1,
    )
sys.argv = helper_argv
exec(compile(source, '<release-lock>', 'exec'), {'__name__': '__main__'})
`,
  );
  const candidateFaultBootstrap = path.join(
    root,
    "candidate-fault-bootstrap.py",
  );
  fs.writeFileSync(
    candidateFaultBootstrap,
    `import os
import sys

helper_argv = sys.argv[1:]
source = sys.stdin.read()
needle = "    candidate_fd = os.open(candidate_path, flags, 0o600)"
if source.count(needle) != 1:
    raise SystemExit('could not inject candidate pathname replacement')
replacement = needle + """
    successor_path = candidate_path + '.same-uid-successor'
    os.symlink(os.environ['CC_TEST_CANDIDATE_VICTIM_PATH'], successor_path)
    os.replace(successor_path, candidate_path)
    with open(os.environ['CC_TEST_CANDIDATE_REPLACED_SENTINEL'], 'wb'):
        pass"""
source = source.replace(needle, replacement, 1)
sys.argv = helper_argv
exec(compile(source, '<materialize-candidate>', 'exec'), {'__name__': '__main__'})
`,
  );
  const recoveryPointerFaultBootstrap = path.join(
    root,
    "recovery-pointer-fault-bootstrap.py",
  );
  fs.writeFileSync(
    recoveryPointerFaultBootstrap,
    `import errno
import os
import sys

helper_argv = sys.argv[1:]
source = sys.stdin.read()
if os.environ.get('CC_TEST_TAMPER_RECOVERY_POINTER_DURING_RETIRE', '0') == '1':
    needle = "        rename_noreplace(state_path, retired_path)"
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
        rename_noreplace(state_path, retired_path)"""
    source = source.replace(needle, replacement, 1)
if os.environ.get('CC_TEST_TERMINATE_DURING_RECOVERY_RETIREMENT', '0') == '1':
    needle = "                    flush=True,\\n                )"
    if source.count(needle) != 1:
        raise SystemExit('could not inject recovery-retirement termination')
    replacement = needle + """
                with open(os.environ['CC_TEST_RECOVERY_RETIREMENT_TERMINATED_SENTINEL'], 'wb'):
                    pass
                os.kill(os.getppid(), __import__('signal').SIGTERM)"""
    source = source.replace(needle, replacement, 1)
if os.environ.get('CC_TEST_REPLACE_RECOVERY_FALLBACK_SOURCE', '0') == '1':
    linux_needle = "    if sys.platform.startswith('linux'):"
    darwin_needle = "    elif sys.platform == 'darwin':"
    retire_needle = "        source_final = os.lstat(source)"
    if any(source.count(needle) != 1 for needle in (linux_needle, darwin_needle, retire_needle)):
        raise SystemExit('could not force recovery no-overwrite fallback')
    source = source.replace(
        linux_needle,
        "    force_link_fallback = True\\n    if not force_link_fallback and sys.platform.startswith('linux'):",
        1,
    )
    source = source.replace(
        darwin_needle,
        "    elif not force_link_fallback and sys.platform == 'darwin':",
        1,
    )
    replacement = """        with open(source, 'rb') as source_stream:
            source_bytes = source_stream.read()
        replacement_path = source + '.fallback-successor'
        with open(replacement_path, 'wb') as replacement_stream:
            replacement_stream.write(source_bytes)
            replacement_stream.flush()
            os.fsync(replacement_stream.fileno())
        os.replace(replacement_path, source)
        with open(os.environ['CC_TEST_RECOVERY_FALLBACK_SOURCE_REPLACED_SENTINEL'], 'wb'):
            pass
        source_final = os.lstat(source)"""
    source = source.replace(retire_needle, replacement, 1)
sys.argv = helper_argv
exec(compile(source, '<recovery-state>', 'exec'), {'__name__': '__main__'})
`,
  );
  const recoveryStateCreateFaultBootstrap = path.join(
    root,
    "recovery-state-create-fault-bootstrap.py",
  );
  fs.writeFileSync(
    recoveryStateCreateFaultBootstrap,
    `import os
import sys

helper_argv = sys.argv[1:]
source = sys.stdin.read()
needle = "        os.fsync(stream.fileno())"
if source.count(needle) != 1:
    raise SystemExit('could not inject recovery-state create failure')
replacement = needle + """
        replacement_path = state_path + '.create-successor'
        with open(replacement_path, 'wb') as successor:
            successor.write(b'recovery-pointer-successor-must-survive')
            successor.flush()
            os.fsync(successor.fileno())
        os.replace(replacement_path, state_path)
        with open(os.environ['CC_TEST_RECOVERY_STATE_CREATE_FAILED_SENTINEL'], 'wb'):
            pass
        raise OSError(5, 'injected recovery-state create failure')"""
source = source.replace(needle, replacement, 1)
sys.argv = helper_argv
exec(compile(source, '<create-recovery-state>', 'exec'), {'__name__': '__main__'})
`,
  );
  const lineageFsyncFaultBootstrap = path.join(
    root,
    "lineage-fsync-fault-bootstrap.py",
  );
  fs.writeFileSync(
    lineageFsyncFaultBootstrap,
    `import sys

helper_argv = sys.argv[1:]
source = sys.stdin.read()
needle = "            os.fsync(dir_fd)"
if source.count(needle) != 1:
    raise SystemExit('could not inject internal lineage directory fsync failure')
source = source.replace(
    needle,
    "            raise OSError(5, 'injected internal lineage directory fsync failure')",
    1,
)
sys.argv = helper_argv
exec(compile(source, '<write-lineage>', 'exec'), {'__name__': '__main__'})
`,
  );
  const mutationFaultBootstrap = path.join(root, "mutation-fault-bootstrap.py");
  fs.writeFileSync(
    mutationFaultBootstrap,
    `import os
import stat
import sys

helper_argv = sys.argv[1:]
source = sys.stdin.read()
claim_needle = "        rename_noreplace(public_path, tombstone_path)"
publish_needle = "        rename_noreplace(stage_path, public_path)"
retire_replace_needle = "\\n            retire_bound_name(current, tombstone_path)\\n"
retire_delete_needle = "\\n        retire_bound_name(current, tombstone_path)\\n"
publication_needle = "        verify(replacement, public_path)\\n    else:"
cleanup_needle = "try:\\n    if lexists(tombstone_path):"
native_linux_needle = "    if sys.platform.startswith('linux'):"
native_darwin_needle = "    elif sys.platform == 'darwin':"
link_retire_needle = "        source_final = os.lstat(source)"
needles = (
    claim_needle,
    publish_needle,
    retire_replace_needle,
    retire_delete_needle,
    publication_needle,
    cleanup_needle,
    native_linux_needle,
    native_darwin_needle,
    link_retire_needle,
)
if any(source.count(needle) != 1 for needle in needles):
    raise SystemExit('could not instrument public-path mutation helper')

race_helper = r'''
def inject_path_successor(path, kind, payload=None):
    replacement_path = path + '.identity-successor'
    if kind == 'regular':
        source_stat = os.lstat(path)
        if payload is None:
            with open(path, 'rb') as source_stream:
                payload = source_stream.read()
        descriptor = os.open(
            replacement_path,
            os.O_CREAT | os.O_EXCL | os.O_WRONLY,
            stat.S_IMODE(source_stat.st_mode),
        )
        try:
            os.write(descriptor, payload)
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        os.replace(replacement_path, path)
    elif kind == 'symlink':
        target = os.readlink(path)
        os.symlink(target, replacement_path)
        os.replace(replacement_path, path)
    else:
        raise AssertionError(f'cannot inject a successor for {kind}')
    with open(os.environ['CC_TEST_MUTATION_RACE_SENTINEL'], 'wb'):
        pass

def inject_identity_successor():
    inject_path_successor(public_path, current_kind)
'''
source = source.replace("replacement = None\\n", "replacement = None\\n" + race_helper, 1)

# Force the portable no-overwrite fallback without first performing a native
# rename. Once the hard-link claim is durable, replace the source pathname; the
# helper must retain both the claim and the successor instead of unlinking one.
source = source.replace(
    native_linux_needle,
    "    force_link_fallback = os.environ.get('CC_TEST_MUTATION_RACE', 'none') == 'link-fallback'\\n"
    "    if not force_link_fallback and sys.platform.startswith('linux'):",
    1,
)
source = source.replace(
    native_darwin_needle,
    "    elif not force_link_fallback and sys.platform == 'darwin':",
    1,
)
link_retire_injection = r'''        if os.environ.get('CC_TEST_MUTATION_RACE', 'none') == 'link-fallback':
            source_mode = os.lstat(source).st_mode
            source_kind = 'symlink' if stat.S_ISLNK(source_mode) else 'regular'
            inject_path_successor(source, source_kind)
        source_final = os.lstat(source)'''
source = source.replace(link_retire_needle, link_retire_injection, 1)

claim_injection = r'''        race = os.environ.get('CC_TEST_MUTATION_RACE', 'none')
        selected = (
            (race == 'rollback-target' and '.target-claimed-' in tombstone_path)
            or (race == 'rollback-backup' and '.backup-claimed-' in tombstone_path)
            or (race == 'rollback-lineage' and '.lineage-claimed-' in tombstone_path)
            or (race == 'rollback-alias' and '.cc.claimed-' in tombstone_path)
        )
        if race == 'lineage-publish-existing' and '.lineage-publish-claimed-' in tombstone_path:
            inject_path_successor(public_path, current_kind, b'successor-lineage-must-survive')
        elif selected:
            inject_identity_successor()
        rename_noreplace(public_path, tombstone_path)'''
source = source.replace(claim_needle, claim_injection, 1)

publish_injection = r'''        race = os.environ.get('CC_TEST_MUTATION_RACE', 'none')
        if (
            (race == 'backup-publish' and '.backup-publish-claimed-' in tombstone_path)
            or (race == 'lineage-publish-absent' and '.lineage-publish-claimed-' in tombstone_path)
        ):
            payload = (
                b'successor-backup-must-survive'
                if race == 'backup-publish'
                else b'successor-lineage-must-survive'
            )
            descriptor = os.open(public_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            try:
                os.write(descriptor, payload)
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
            with open(os.environ['CC_TEST_MUTATION_RACE_SENTINEL'], 'wb'):
                pass
        if (
            os.environ.get('CC_TEST_FAIL_LINEAGE_RESTORE', '0') == '1'
            and '.lineage-claimed-' in tombstone_path
        ):
            raise OSError(5, 'injected fd-bound lineage restore failure')
        rename_noreplace(stage_path, public_path)
        if (
            os.environ.get('CC_TEST_KILL_AFTER_TARGET_REPLACE', '0') == '1'
            and '.target-publish-claimed-' in tombstone_path
        ):
            with open(os.environ['CC_TEST_TARGET_REPLACED_SENTINEL'], 'wb'):
                pass
            os.kill(os.getppid(), __import__('signal').SIGKILL)'''
source = source.replace(publish_needle, publish_injection, 1)

retire_replace_injection = r'''
            if os.environ.get('CC_TEST_MUTATION_RACE', 'none') == 'retire-replace':
                inject_path_successor(tombstone_path, current_kind)
            retire_bound_name(current, tombstone_path)
'''
source = source.replace(retire_replace_needle, retire_replace_injection, 1)
retire_delete_injection = r'''
        if os.environ.get('CC_TEST_MUTATION_RACE', 'none') == 'retire-delete':
            inject_path_successor(tombstone_path, current_kind)
        retire_bound_name(current, tombstone_path)
'''
source = source.replace(retire_delete_needle, retire_delete_injection, 1)

publication_injection = r'''        verify(replacement, public_path)
        publication_phase = os.environ.get('CC_TEST_TERMINATE_AFTER_PUBLICATION', 'none')
        publication_selected = (
            (publication_phase == 'target' and '.target-publish-claimed-' in tombstone_path)
            or (publication_phase == 'backup' and '.backup-publish-claimed-' in tombstone_path)
            or (publication_phase == 'alias' and '.cc.publish-claimed-' in tombstone_path)
        )
        if publication_selected:
            with open(os.environ['CC_TEST_PUBLICATION_TERMINATED_SENTINEL'], 'wb'):
                pass
            os.kill(os.getppid(), __import__('signal').SIGTERM)
    else:'''
source = source.replace(publication_needle, publication_injection, 1)

cleanup_injection = r'''failure = os.environ.get('CC_TEST_FAIL_SNAPSHOT_CLEANUP', 'none')
mutation_race = os.environ.get('CC_TEST_MUTATION_RACE', 'none')
if action == 'delete' and (
    (mutation_race == 'cleanup-prior-alias' and '.cc.prior-' in public_path)
    or (mutation_race == 'cleanup-alias-anchor' and '.cc.identity-' in public_path)
):
    inject_path_successor(public_path, 'symlink')
if action == 'delete' and (
    (failure == 'prior-backup' and '.chainlesschain.backup-prior-' in public_path)
    or (failure == 'prior-lineage' and '.chainlesschain.lineage-prior-' in public_path)
    or (failure == 'retired-pointer' and '.chainlesschain.recovery-retired-' in public_path)
):
    raise OSError(5, f'injected {failure} cleanup failure')
try:
    if lexists(tombstone_path):'''
source = source.replace(cleanup_needle, cleanup_injection, 1)

sys.argv = helper_argv
exec(compile(source, '<mutate-public-path>', 'exec'), {'__name__': '__main__'})
`,
  );
  const orphanRetentionFaultBootstrap = path.join(
    root,
    "orphan-retention-fault-bootstrap.py",
  );
  fs.writeFileSync(
    orphanRetentionFaultBootstrap,
    `import sys

helper_argv = sys.argv[1:]
source = sys.stdin.read()
needle = "    before = os.fstat(fd)"
if source.count(needle) != 1:
    raise SystemExit('could not instrument fd-bound orphan retention helper')
injection = r'''    race = os.environ.get('CC_TEST_MUTATION_RACE', 'none')
    if race in ('orphan-backup', 'orphan-lineage'):
        successor_path = orphan_path + '.same-uid-successor'
        payload = (
            b'successor-orphan-backup-must-survive'
            if race == 'orphan-backup'
            else b'successor-orphan-lineage-must-survive'
        )
        descriptor = os.open(
            successor_path,
            os.O_CREAT | os.O_EXCL | os.O_WRONLY,
            stat.S_IMODE(os.fstat(fd).st_mode),
        )
        try:
            os.write(descriptor, payload)
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        os.replace(successor_path, orphan_path)
        with open(os.environ['CC_TEST_MUTATION_RACE_SENTINEL'], 'wb'):
            pass
    before = os.fstat(fd)'''
source = source.replace(needle, injection, 1)
sys.argv = helper_argv
exec(compile(source, '<retain-regular-orphan>', 'exec'), {'__name__': '__main__'})
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
      if [ "\${CC_TEST_FAIL_LINEAGE_DIR_FSYNC:-0}" = "1" ]; then
        "$REAL_PYTHON" "$CC_TEST_LINEAGE_FSYNC_FAULT_BOOTSTRAP" "$@"
        status=$?
        : > "$CC_TEST_LINEAGE_FAILED_SENTINEL"
        exit "$status"
      fi
      ;;
  esac
fi
if [ "\${CC_TEST_FAIL_LINEAGE_WRITE:-0}" = "after" ] && [ "\${1:-}" = "-" ] && [ "\${3:-}" = "$CC_TEST_TARGET_DIR/chainlesschain.update-lineage.json" ] && [ ! -f "$CC_TEST_LINEAGE_FAILED_SENTINEL" ]; then
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
if [ "\${1:-}" = "-" ] && [ "\${2:-}" = "recovery-state" ] && [ "\${3:-}" = "retire" ] && { [ "\${CC_TEST_TAMPER_RECOVERY_POINTER_DURING_RETIRE:-0}" = "1" ] || [ "\${CC_TEST_TERMINATE_DURING_RECOVERY_RETIREMENT:-0}" = "1" ] || [ "\${CC_TEST_REPLACE_RECOVERY_FALLBACK_SOURCE:-0}" = "1" ]; }; then
  exec "$REAL_PYTHON" "$CC_TEST_RECOVERY_POINTER_FAULT_BOOTSTRAP" "$@"
fi
if [ "\${1:-}" = "-" ] && [ "\${CC_TEST_FAIL_RECOVERY_STATE_CREATE:-0}" = "1" ]; then
  case "\${2:-}" in
    */.chainlesschain.recovery-*.json)
      exec "$REAL_PYTHON" "$CC_TEST_RECOVERY_STATE_CREATE_FAULT_BOOTSTRAP" "$@"
      ;;
  esac
fi
if [ "\${1:-}" = "-" ] && [ "\${2:-}" = "materialize-candidate" ] && [ "\${CC_TEST_REPLACE_CANDIDATE_DURING_MATERIALIZATION:-0}" = "1" ]; then
  exec "$REAL_PYTHON" "$CC_TEST_CANDIDATE_FAULT_BOOTSTRAP" "$@"
fi
if [ "\${1:-}" = "-" ] && [ "\${2:-}" = "materialize-candidate" ] && [ "\${CC_TEST_REPLACE_STAGING_BEFORE_CLEANUP:-0}" = "1" ]; then
  "$REAL_PYTHON" "$@"
  status=$?
  [ "$status" -eq 0 ] || exit "$status"
  staging_path=\${3%/*}
  "$REAL_MV" "$staging_path" "$staging_path.original"
  mkdir "$staging_path"
  printf '%s' 'staging-successor-must-survive' > "$staging_path/successor.txt"
  : > "$CC_TEST_STAGING_REPLACED_SENTINEL"
  exit 98
fi
if [ "\${1:-}" = "-" ] && [ "\${2:-}" = "retain-regular-orphan" ]; then
  case "\${CC_TEST_MUTATION_RACE:-none}" in
    orphan-backup|orphan-lineage)
      exec "$REAL_PYTHON" "$CC_TEST_ORPHAN_RETENTION_FAULT_BOOTSTRAP" "$@"
      ;;
  esac
fi
if [ "\${1:-}" = "-" ] && [ "\${2:-}" = "mutate-public-path" ]; then
  exec "$REAL_PYTHON" "$CC_TEST_MUTATION_FAULT_BOOTSTRAP" "$@"
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
  } else if (orphanState !== "none") {
    const orphanPath = orphanState === "backup" ? backupPath : lineagePath;
    const orphanBytes = Buffer.from(`orphan-${orphanState}-must-survive`);
    fs.writeFileSync(orphanPath, orphanBytes);
    fs.chmodSync(orphanPath, 0o640);
    const orphanStat = fs.lstatSync(orphanPath, { bigint: true });
    prestate = {
      orphanPath,
      orphanBytes,
      orphanDev: orphanStat.dev,
      orphanIno: orphanStat.ino,
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
      CC_CLI_INSTALL_CRASH_AFTER_PHASE: crashAfterPhase,
      CC_CLI_INSTALL_TERMINATE_AFTER_PHASE: terminateAfterPhase,
      CC_TEST_TAMPER_RECOVERY_POINTER_DURING_RETIRE:
        tamperRecoveryPointerDuringRetire ? "1" : "0",
      CC_TEST_MUTATION_RACE: mutationRace,
      CC_TEST_TERMINATE_AFTER_PUBLICATION: terminateAfterPublication,
      CC_TEST_TERMINATE_DURING_RECOVERY_RETIREMENT:
        terminateDuringRecoveryRetirement ? "1" : "0",
      CC_TEST_FAIL_RECOVERY_STATE_CREATE: failRecoveryStateCreate ? "1" : "0",
      CC_TEST_REPLACE_RECOVERY_FALLBACK_SOURCE: replaceRecoveryFallbackSource
        ? "1"
        : "0",
      CC_TEST_REPLACE_CANDIDATE_DURING_MATERIALIZATION:
        replaceCandidateDuringMaterialization ? "1" : "0",
      CC_TEST_REPLACE_STAGING_BEFORE_CLEANUP: replaceStagingBeforeCleanup
        ? "1"
        : "0",
      CC_TEST_LINEAGE_FAILED_SENTINEL: lineageFailedSentinel,
      CC_TEST_CANONICAL_INSTALL_DIR: fs.realpathSync(targetDir),
      CC_TEST_TARGET_DIR: targetDir,
      CC_TEST_LOCK_REPLACED_SENTINEL: lockReplacedSentinel,
      CC_TEST_TARGET_REPLACED_SENTINEL: targetReplacedSentinel,
      CC_TEST_RECOVERY_POINTER_TAMPERED_SENTINEL:
        recoveryPointerTamperedSentinel,
      CC_TEST_MUTATION_RACE_SENTINEL: mutationRaceSentinel,
      CC_TEST_PUBLICATION_TERMINATED_SENTINEL: publicationTerminatedSentinel,
      CC_TEST_RECOVERY_RETIREMENT_TERMINATED_SENTINEL:
        recoveryRetirementTerminatedSentinel,
      CC_TEST_RECOVERY_STATE_CREATE_FAILED_SENTINEL:
        recoveryStateCreateFailedSentinel,
      CC_TEST_RECOVERY_FALLBACK_SOURCE_REPLACED_SENTINEL:
        recoveryFallbackSourceReplacedSentinel,
      CC_TEST_LOCK_EVIDENCE_REPLACED_SENTINEL: lockEvidenceReplacedSentinel,
      CC_TEST_CANDIDATE_REPLACED_SENTINEL: candidateReplacedSentinel,
      CC_TEST_STAGING_REPLACED_SENTINEL: stagingReplacedSentinel,
      CC_TEST_CANDIDATE_VICTIM_PATH: candidateVictimPath,
      CC_TEST_TARGET_PATH: targetPath,
      CC_TEST_SUCCESSOR_LOCK_VALUE: successorLockValue,
      CC_TEST_RELEASE_FAULT_BOOTSTRAP: releaseFaultBootstrap,
      CC_TEST_CANDIDATE_FAULT_BOOTSTRAP: candidateFaultBootstrap,
      CC_TEST_ORPHAN_RETENTION_FAULT_BOOTSTRAP: orphanRetentionFaultBootstrap,
      CC_TEST_RECOVERY_POINTER_FAULT_BOOTSTRAP: recoveryPointerFaultBootstrap,
      CC_TEST_RECOVERY_STATE_CREATE_FAULT_BOOTSTRAP:
        recoveryStateCreateFaultBootstrap,
      CC_TEST_LINEAGE_FSYNC_FAULT_BOOTSTRAP: lineageFsyncFaultBootstrap,
      CC_TEST_MUTATION_FAULT_BOOTSTRAP: mutationFaultBootstrap,
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
    mutationRaceSentinel,
    publicationTerminatedSentinel,
    recoveryRetirementTerminatedSentinel,
    recoveryStateCreateFailedSentinel,
    recoveryFallbackSourceReplacedSentinel,
    lockEvidenceReplacedSentinel,
    candidateReplacedSentinel,
    stagingReplacedSentinel,
    candidateVictimPath,
    successorLockValue,
    prestate,
    posixShell,
    run,
  };
}

describe("native installer transaction contracts", () => {
  it("POSIX installer uses a locked same-filesystem commit and persistent rollback copy", () => {
    const source = fs.readFileSync(shPath, "utf8");
    expect(source).toContain("releases/download/cli-stable");
    expect(source).toContain('LOCK_PATH="$TARGET_PATH.update.lock"');
    expect(source).toContain(
      'JOURNAL_PATH="$TARGET_PATH.update-transaction.json"',
    );
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
    expect(source).toContain("materialize_candidate() {");
    expect(source).toContain(
      'CANDIDATE_PATH="$INSTALL_DIR/.chainlesschain.new.$TRANSACTION_ID"',
    );
    expect(source).toContain("candidate_fd = os.open(candidate_path, flags");
    expect(source).toContain("os.fchmod(candidate_fd, 0o755)");
    expect(source).toContain("hash_fd(candidate_fd)");
    expect(source).toContain(
      "startup_fd = os.open(candidate_path, os.O_RDONLY | nofollow)",
    );
    expect(source).toContain("if sys.platform != 'darwin':");
    expect(source).toContain("[descriptor_path, '--version']");
    expect(source).not.toContain("[candidate_path, '--version']");
    expect(source).toContain("pass_fds=(startup_fd,)");
    expect(source).not.toContain(
      'mktemp "$INSTALL_DIR/.chainlesschain.new.XXXXXX"',
    );
    expect(source).not.toContain('cp "$ARTIFACT" "$CANDIDATE_PATH"');
    expect(source).not.toContain('chmod 755 "$CANDIDATE_PATH"');
    expect(source).toContain("mutate_public_path() {");
    expect(source).toContain("renameat2");
    expect(source).toContain("renamex_np");
    expect(source).toContain("def retire_bound_name(bound, path):");
    expect(source).not.toContain("os.unlink(tombstone_path)");
    expect(source).not.toContain("os.unlink(source)");
    const retireBoundStart = source.indexOf(
      "def retire_bound_name(bound, path):",
    );
    const retireBoundEnd = source.indexOf("current = None", retireBoundStart);
    const retireBoundSource = source.slice(retireBoundStart, retireBoundEnd);
    expect(retireBoundSource).not.toContain("os.unlink(");
    expect(retireBoundSource).toContain("return path");
    expect(source).toContain("CLEANUP_PENDING=0");
    expect(source).toContain("record_retained_evidence() {");
    expect(source).toContain('RETAINED_EVIDENCE_PATHS=""');
    expect(source).toContain("notably WSL1/DrvFS");
    expect(source).toContain(
      "os.link(source, destination, follow_symlinks=False)",
    );
    expect(source.match(/fallback_errors = \{/g)).toHaveLength(3);
    expect(source).not.toContain("os.unlink(");
    expect(source).not.toContain("os.rmdir(");
    expect(source).not.toContain("rm -f");
    expect(source).not.toContain("rm -rf");
    expect(source).toContain(
      'TARGET_CLAIM_PATH="$INSTALL_DIR/.chainlesschain.target-publish-claimed-$TRANSACTION_ID"',
    );
    expect(source).toContain(
      'BACKUP_TEMP_PATH="$INSTALL_DIR/.chainlesschain.previous-$TRANSACTION_ID"',
    );
    expect(source).toContain('ln "$PRIOR_TARGET_PATH" "$BACKUP_TEMP_PATH"');
    expect(source).toContain(
      'BACKUP_CLAIM_PATH="$INSTALL_DIR/.chainlesschain.backup-publish-claimed-$TRANSACTION_ID"',
    );
    expect(source).toContain(
      'ROLLBACK_TEMP_PATH="$INSTALL_DIR/.chainlesschain.rollback-$TRANSACTION_ID"',
    );
    expect(source).toContain(
      'TARGET_CLAIM_PATH="$INSTALL_DIR/.chainlesschain.target-claimed-$TRANSACTION_ID"',
    );
    expect(source).toContain(".orphaned-$TRANSACTION_ID");
    expect(source).toContain("quarantine_regular_orphan() {");
    const orphanQuarantineStart = source.indexOf(
      "quarantine_regular_orphan() {",
    );
    const orphanQuarantineEnd = source.indexOf(
      "create_alias_restore_candidate() {",
      orphanQuarantineStart,
    );
    const orphanQuarantineSource = source.slice(
      orphanQuarantineStart,
      orphanQuarantineEnd,
    );
    expect(orphanQuarantineSource).toContain('"retain-regular-orphan"');
    expect(orphanQuarantineSource).toContain(
      "cannot be atomically quarantined by verified identity",
    );
    expect(orphanQuarantineSource).not.toContain("mutate_public_path");
    expect(orphanQuarantineSource).not.toContain("rename_noreplace");
    expect(source).not.toContain(
      'mv "$BACKUP_PATH" "$BACKUP_PATH.orphaned-$TRANSACTION_ID"',
    );
    expect(source).not.toContain(
      'mv "$LINEAGE_PATH" "$LINEAGE_PATH.orphaned-$TRANSACTION_ID"',
    );
    expect(source).toContain('RESULT_PATH="$TARGET_PATH.update-result.json"');
    expect(source).toContain("chainlesschain.native-update-result.v1");
    expect(source).toContain('PRIOR_BACKUP_PATH=""');
    expect(source).toContain('ln "$BACKUP_PATH" "$PRIOR_BACKUP_PATH"');
    expect(source).toContain('ln "$LINEAGE_PATH" "$PRIOR_LINEAGE_PATH"');
    expect(source).toContain(
      'snapshot_alias "$ALIAS_PATH" "$PRIOR_ALIAS_PATH"',
    );
    expect(source).toContain(
      "os.link(source, snapshot, follow_symlinks=False)",
    );
    expect(source).toContain('INSTALLED_ALIAS_ANCHOR_PATH=""');
    expect(source).toContain(
      'snapshot_alias "$ALIAS_TEMP_PATH" "$INSTALLED_ALIAS_ANCHOR_PATH"',
    );
    expect(source).toContain("ALIAS_COMMITTED=1");
    expect(source).toContain("LINEAGE_COMMIT_STARTED=1");
    expect(source).toContain(
      'LINEAGE_TEMP_PATH="$INSTALL_DIR/.chainlesschain.staged-$TRANSACTION_ID.update-lineage.json"',
    );
    expect(source).toContain(
      'LINEAGE_CLAIM_PATH="$INSTALL_DIR/.chainlesschain.lineage-publish-claimed-$TRANSACTION_ID"',
    );
    expect(source).not.toContain("os.replace(staging, lineage_path)");
    expect(source).toContain("discard_transaction_snapshots");
    expect(source).toContain('python3 - "write-lineage"');
    expect(source).toContain("if error.errno not in unsupported:");
    expect(source).toContain("chainlesschain.native-install-recovery.v1");
    expect(source).toContain("chainlesschain.native-install-transaction.v1");
    expect(source).toContain("write_install_transaction_journal() {");
    expect(source).toContain("recover_interrupted_install() {");
    expect(source).toContain("resolve_stale_install_lock() {");
    expect(source).toContain(
      "write_install_transaction_journal prepared rollback",
    );
    expect(source).toContain(
      "write_install_transaction_journal committed commit",
    );
    expect(source).toContain("CC_CLI_INSTALL_RECOVERY_ONLY");
    expect(source).toContain("'priorTarget': {");
    expect(source).toContain("'sha256': old_target_sha or None");
    expect(source).toContain("process_recovery_state() {");
    expect(source).not.toContain("validate_recovery_state() {");
    expect(source).not.toContain("retire_recovery_state() {");
    expect(source).toContain("rename_noreplace(state_path, retired_path)");
    expect(source).toContain(
      "(state_before.st_dev, state_before.st_ino) != (fd_now.st_dev, fd_now.st_ino)",
    );
    expect(source).not.toContain("active_now");
    expect(source).toContain("retired recovery-state pointer changed identity");
    expect(source).toContain("alias_matches_hash");
    expect(source).toContain('OLD_ALIAS_TARGET_SHA256=""');
    expect(source).toContain("'targetSha256': old_alias_target_sha or None");
    expect(source).toContain("'identity': old_alias_identity or None");
    expect(source).not.toContain("os.unlink(state_path)");
    expect(source).toContain("RECOVERY_RETIREMENT_GUARD=1");
    expect(source).not.toContain(
      'alias_matches_snapshot "$PRIOR_ALIAS_PATH" "$PRIOR_ALIAS_PATH"',
    );
    expect(source).toContain(
      "def restore_owned_without_overwrite(source_path):",
    );
    expect(source).toContain("rename_noreplace(lock_path, held_path)");
    expect(source).toContain("durability_barrier('renamed-release-dir'");
    expect(source).toContain("durability_barrier('renamed-parent'");
    expect(source).toContain("retained lock release evidence changed");
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
    expect(source).not.toContain('mv -f "$CANDIDATE_PATH" "$TARGET_PATH"');
    expect(source).not.toContain('mv -f "$BACKUP_TEMP_PATH" "$BACKUP_PATH"');
    expect(source).not.toContain('mv -f "$ROLLBACK_TEMP_PATH" "$TARGET_PATH"');
    expect(source).not.toContain('mv -f "$ALIAS_TEMP_PATH" "$ALIAS_PATH"');
    for (const [flag, publicationClaim] of [
      ["SWAPPED=1", ".chainlesschain.target-publish-claimed-"],
      ["BACKUP_COMMITTED=1", ".chainlesschain.backup-publish-claimed-"],
      ["ALIAS_COMMITTED=1", ".cc.publish-claimed-"],
    ]) {
      const flagIndex = source.indexOf(flag);
      const publicationIndex = source.indexOf(
        "mutate_public_path \\",
        source.indexOf(publicationClaim),
      );
      expect(flagIndex).toBeGreaterThan(-1);
      expect(publicationIndex).toBeGreaterThan(flagIndex);
    }
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
    expect(priorLineageRestore).toContain("mutate_public_path \\");
    expect(priorLineageRestore).not.toContain('rm -f "$LINEAGE_PATH"');
  });

  it.runIf(process.platform !== "win32").each([
    ["prepared", "rollback"],
    ["target-committed", "rollback"],
    ["backup-committed", "rollback"],
    ["alias-committed", "rollback"],
    ["verified", "rollback"],
    ["lineage-committed", "rollback"],
    ["commit-decision-started", "rollback"],
    ["committed", "commit"],
  ])(
    "POSIX installer recovers a hard crash after %s with a %s decision",
    (phase, decision) => {
      const fixture = runPosixInstallerFixture({
        existing: true,
        targetOnly: true,
        lineageFailure: "none",
        crashAfterPhase: phase,
      });
      const journalPath = `${fixture.targetPath}.update-transaction.json`;
      expect(
        fixture.run.status,
        fixture.run.stderr || fixture.run.stdout,
      ).not.toBe(0);
      expect(
        pathLexists(journalPath),
        fixture.run.stderr || fixture.run.stdout,
      ).toBe(true);
      expect(JSON.parse(fs.readFileSync(journalPath, "utf8"))).toMatchObject({
        phase:
          phase === "commit-decision-started" ? "lineage-committed" : phase,
        decision: decision === "commit" ? "commit" : "rollback",
      });
      expect(
        pathLexists(`${fixture.targetPath}.update.lock`),
        fixture.run.stderr || fixture.run.stdout,
      ).toBe(true);
      const recovered = spawnSync(fixture.posixShell, [shPath], {
        encoding: "utf8",
        timeout: 90_000,
        env: {
          ...process.env,
          CC_CLI_INSTALL_DIR: fixture.targetDir,
          CC_CLI_INSTALL_RECOVERY_ONLY: "1",
          CC_CLI_INSTALL_CRASH_AFTER_PHASE: "",
        },
      });
      expect(recovered.status, recovered.stderr || recovered.stdout).toBe(0);
      expect(pathLexists(journalPath)).toBe(false);
      expect(pathLexists(`${fixture.targetPath}.update.lock`)).toBe(false);

      const retiredJournal = JSON.parse(
        fs.readFileSync(`${journalPath}.last`, "utf8"),
      );
      expect(retiredJournal.decision).toBe(
        decision === "commit" ? "commit" : "rollback",
      );
      if (decision === "rollback") {
        expect(fs.readFileSync(fixture.targetPath)).toEqual(
          fixture.prestate.targetBytes,
        );
        expect(pathLexists(fixture.backupPath)).toBe(false);
        expect(pathLexists(fixture.aliasPath)).toBe(false);
        expect(pathLexists(fixture.lineagePath)).toBe(false);
      } else {
        expect(sha256File(fixture.targetPath)).toBe(fixture.artifactSha256);
        expect(fs.readFileSync(fixture.backupPath)).toEqual(
          fixture.prestate.targetBytes,
        );
        expect(pathLexists(fixture.aliasPath)).toBe(true);
        expect(
          JSON.parse(fs.readFileSync(fixture.lineagePath, "utf8")),
        ).toMatchObject({
          schema: "chainlesschain.native-update-lineage.v1",
          currentSha256: fixture.artifactSha256,
        });
      }
    },
    180_000,
  );

  it.runIf(process.platform !== "win32")(
    "POSIX TERM before the durable commit decision remains recoverable as rollback",
    () => {
      const fixture = runPosixInstallerFixture({
        existing: true,
        targetOnly: true,
        lineageFailure: "none",
        terminateAfterPhase: "commit-decision-started",
      });
      const journalPath = `${fixture.targetPath}.update-transaction.json`;
      expect(
        fixture.run.status,
        fixture.run.stderr || fixture.run.stdout,
      ).not.toBe(0);
      expect(pathLexists(journalPath)).toBe(true);
      expect(pathLexists(`${fixture.targetPath}.update.lock`)).toBe(true);
      expect(JSON.parse(fs.readFileSync(journalPath, "utf8"))).toMatchObject({
        phase: "lineage-committed",
        decision: "rollback",
      });

      const recovered = spawnSync(fixture.posixShell, [shPath], {
        encoding: "utf8",
        timeout: 90_000,
        env: {
          ...process.env,
          CC_CLI_INSTALL_DIR: fixture.targetDir,
          CC_CLI_INSTALL_RECOVERY_ONLY: "1",
          CC_CLI_INSTALL_CRASH_AFTER_PHASE: "",
          CC_CLI_INSTALL_TERMINATE_AFTER_PHASE: "",
        },
      });
      expect(recovered.status, recovered.stderr || recovered.stdout).toBe(0);
      expect(pathLexists(journalPath)).toBe(false);
      expect(pathLexists(`${fixture.targetPath}.update.lock`)).toBe(false);
      expect(
        JSON.parse(fs.readFileSync(`${journalPath}.last`, "utf8")),
      ).toMatchObject({ phase: "lineage-committed", decision: "rollback" });
      expect(fs.readFileSync(fixture.targetPath)).toEqual(
        fixture.prestate.targetBytes,
      );
      expect(pathLexists(fixture.backupPath)).toBe(false);
      expect(pathLexists(fixture.aliasPath)).toBe(false);
      expect(pathLexists(fixture.lineagePath)).toBe(false);
    },
    180_000,
  );

  it.runIf(process.platform !== "win32")(
    "POSIX TERM after the durable commit decision remains recoverable as committed",
    () => {
      const fixture = runPosixInstallerFixture({
        existing: true,
        targetOnly: true,
        lineageFailure: "none",
        terminateAfterPhase: "committed",
      });
      const journalPath = `${fixture.targetPath}.update-transaction.json`;
      expect(
        fixture.run.status,
        fixture.run.stderr || fixture.run.stdout,
      ).not.toBe(0);
      expect(pathLexists(journalPath)).toBe(true);
      expect(pathLexists(`${fixture.targetPath}.update.lock`)).toBe(true);
      expect(JSON.parse(fs.readFileSync(journalPath, "utf8"))).toMatchObject({
        phase: "committed",
        decision: "commit",
      });
      expect(sha256File(fixture.targetPath)).toBe(fixture.artifactSha256);
      expect(fs.readFileSync(fixture.backupPath)).toEqual(
        fixture.prestate.targetBytes,
      );

      const recovered = spawnSync(fixture.posixShell, [shPath], {
        encoding: "utf8",
        timeout: 90_000,
        env: {
          ...process.env,
          CC_CLI_INSTALL_DIR: fixture.targetDir,
          CC_CLI_INSTALL_RECOVERY_ONLY: "1",
          CC_CLI_INSTALL_CRASH_AFTER_PHASE: "",
          CC_CLI_INSTALL_TERMINATE_AFTER_PHASE: "",
        },
      });
      expect(recovered.status, recovered.stderr || recovered.stdout).toBe(0);
      expect(pathLexists(journalPath)).toBe(false);
      expect(pathLexists(`${fixture.targetPath}.update.lock`)).toBe(false);
      expect(
        JSON.parse(fs.readFileSync(`${journalPath}.last`, "utf8")),
      ).toMatchObject({ phase: "committed", decision: "commit" });
      expect(sha256File(fixture.targetPath)).toBe(fixture.artifactSha256);
      expect(fs.readFileSync(fixture.backupPath)).toEqual(
        fixture.prestate.targetBytes,
      );
      expect(pathLexists(fixture.aliasPath)).toBe(true);
      expect(
        JSON.parse(fs.readFileSync(fixture.lineagePath, "utf8")),
      ).toMatchObject({
        schema: "chainlesschain.native-update-lineage.v1",
        currentSha256: fixture.artifactSha256,
      });
    },
    180_000,
  );

  it.runIf(process.platform !== "win32")(
    "POSIX lineage failure restores public state and retains private cleanup tombstones",
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
      expect(run.stderr).toContain(
        "incomplete install transaction was rolled back",
      );
      expect(run.stderr).not.toContain(
        "incomplete install transaction could not be rolled back",
      );
      expect(
        fs
          .readdirSync(fixture.targetDir)
          .filter((name) => name.startsWith(".chainlesschain.")),
      ).not.toEqual([]);
    },
    120_000,
  );

  it.runIf(process.platform !== "win32")(
    "POSIX fresh rollback clears public lineage and retains private cleanup tombstones",
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
      ).not.toEqual([]);
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
    "POSIX fresh lineage failure removes public paths and retains private tombstones",
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
      ).not.toEqual([]);
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
        names.filter(
          (name) =>
            name.startsWith(".chainlesschain.backup-prior-") &&
            !name.includes(".cleanup-"),
        ),
      ).toHaveLength(0);
      expect(
        names.some(
          (name) =>
            name.startsWith(".chainlesschain.backup-prior-") &&
            name.includes(".cleanup-"),
        ),
      ).toBe(true);
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

  for (const cleanupFault of ["prior-backup", "retired-pointer"]) {
    it.runIf(process.platform !== "win32")(
      `POSIX ${cleanupFault} cleanup fault reaches fd-bound retirement and retains evidence`,
      () => {
        const fixture = runPosixInstallerFixture({
          existing: true,
          lineageFailure: "none",
          failSnapshotCleanup: cleanupFault,
        });
        const names = fs.readdirSync(fixture.targetDir);

        expect(
          fixture.run.status,
          fixture.run.stderr || fixture.run.stdout,
        ).not.toBe(0);
        if (cleanupFault === "prior-backup") {
          expect(
            names.some((name) =>
              name.startsWith(".chainlesschain.backup-prior-"),
            ),
          ).toBe(true);
        } else {
          expect(
            names.some((name) =>
              name.startsWith(".chainlesschain.recovery-retired-"),
            ),
          ).toBe(true);
        }
        expect(fixture.run.stderr).toContain(
          "remaining artifacts may be partial",
        );
        expect(pathLexists(`${fixture.targetPath}.update.lock`)).toBe(true);
      },
      120_000,
    );
  }

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
      ).toHaveLength(0);
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

  it.runIf(process.platform !== "win32")(
    "POSIX recovery hard-link fallback retains both pointer identities after source replacement",
    () => {
      const fixture = runPosixInstallerFixture({
        existing: true,
        targetOnly: true,
        lineageFailure: "none",
        replaceRecoveryFallbackSource: true,
      });

      expect(
        fixture.run.status,
        fixture.run.stderr || fixture.run.stdout,
      ).not.toBe(0);
      expect(pathLexists(fixture.recoveryFallbackSourceReplacedSentinel)).toBe(
        true,
      );
      expect(sha256File(fixture.targetPath)).toBe(fixture.artifactSha256);
      expect(fs.readFileSync(fixture.backupPath)).toEqual(
        fixture.prestate.targetBytes,
      );

      const names = fs.readdirSync(fixture.targetDir);
      const activeName = names.find(
        (name) =>
          name.startsWith(".chainlesschain.recovery-") &&
          !name.startsWith(".chainlesschain.recovery-retired-"),
      );
      const retiredName = names.find((name) =>
        name.startsWith(".chainlesschain.recovery-retired-"),
      );
      expect(activeName).toBeDefined();
      expect(retiredName).toBeDefined();
      const activePath = path.join(fixture.targetDir, activeName);
      const retiredPath = path.join(fixture.targetDir, retiredName);
      expect(fs.readFileSync(activePath)).toEqual(fs.readFileSync(retiredPath));
      const activeStat = fs.lstatSync(activePath, { bigint: true });
      const retiredStat = fs.lstatSync(retiredPath, { bigint: true });
      expect([activeStat.dev, activeStat.ino]).not.toEqual([
        retiredStat.dev,
        retiredStat.ino,
      ]);
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
        if (publicPath === "alias") {
          const aliasStat = fs.lstatSync(fixture.aliasPath, { bigint: true });
          const identityAnchorName = fs
            .readdirSync(fixture.targetDir)
            .find((name) => name.startsWith(".cc.identity-"));
          expect(identityAnchorName).toBeDefined();
          const identityAnchorPath = path.join(
            fixture.targetDir,
            identityAnchorName,
          );
          const identityAnchorStat = fs.lstatSync(identityAnchorPath, {
            bigint: true,
          });
          expect(identityAnchorStat.isSymbolicLink()).toBe(true);
          expect(fs.readlinkSync(identityAnchorPath)).toBe("chainlesschain");
          expect([aliasStat.dev, aliasStat.ino]).not.toEqual([
            identityAnchorStat.dev,
            identityAnchorStat.ino,
          ]);
        }
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

  for (const publicPath of ["target", "backup", "lineage", "alias"]) {
    it.runIf(process.platform !== "win32")(
      `POSIX rollback restores a ${publicPath} successor injected after fd binding`,
      () => {
        const fixture = runPosixInstallerFixture({
          existing: true,
          lineageFailure: "after",
          mutationRace: `rollback-${publicPath}`,
        });

        expect(
          fixture.run.status,
          fixture.run.stderr || fixture.run.stdout,
        ).not.toBe(0);
        expect(pathLexists(fixture.mutationRaceSentinel)).toBe(true);
        if (publicPath === "target") {
          expect(sha256File(fixture.targetPath)).toBe(fixture.artifactSha256);
        } else if (publicPath === "backup") {
          expect(fs.readFileSync(fixture.backupPath)).toEqual(
            fixture.prestate.targetBytes,
          );
        } else if (publicPath === "lineage") {
          expect(
            JSON.parse(fs.readFileSync(fixture.lineagePath, "utf8")),
          ).toMatchObject({ currentSha256: fixture.artifactSha256 });
        } else {
          expect(fs.readlinkSync(fixture.aliasPath)).toBe("chainlesschain");
        }
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
    "POSIX backup publication never overwrites a successor injected after old-backup occupation",
    () => {
      const fixture = runPosixInstallerFixture({
        existing: true,
        lineageFailure: "none",
        mutationRace: "backup-publish",
      });

      expect(
        fixture.run.status,
        fixture.run.stderr || fixture.run.stdout,
      ).not.toBe(0);
      expect(pathLexists(fixture.mutationRaceSentinel)).toBe(true);
      expect(fs.readFileSync(fixture.backupPath, "utf8")).toBe(
        "successor-backup-must-survive",
      );
      expect(sha256File(fixture.targetPath)).toBe(fixture.artifactSha256);
      const names = fs.readdirSync(fixture.targetDir);
      expect(
        names.some((name) =>
          name.startsWith(".chainlesschain.backup-publish-claimed-"),
        ),
      ).toBe(true);
      expect(
        names.some((name) => name.startsWith(".chainlesschain.previous-")),
      ).toBe(true);
      expect(pathLexists(`${fixture.targetPath}.update.lock`)).toBe(true);
    },
    120_000,
  );

  it.runIf(process.platform !== "win32")(
    "POSIX controlled replacement retirement retains a tombstone successor",
    () => {
      const fixture = runPosixInstallerFixture({
        existing: true,
        targetOnly: true,
        lineageFailure: "none",
        mutationRace: "retire-replace",
      });

      expect(
        fixture.run.status,
        fixture.run.stderr || fixture.run.stdout,
      ).not.toBe(0);
      expect(pathLexists(fixture.mutationRaceSentinel)).toBe(true);
      const claimName = fs
        .readdirSync(fixture.targetDir)
        .find((name) =>
          name.startsWith(".chainlesschain.target-publish-claimed-"),
        );
      expect(claimName).toBeDefined();
      expect(fs.readFileSync(path.join(fixture.targetDir, claimName))).toEqual(
        fixture.prestate.targetBytes,
      );
      expect(sha256File(fixture.targetPath)).toBe(fixture.artifactSha256);
      expect(pathLexists(`${fixture.targetPath}.update.lock`)).toBe(true);
    },
    120_000,
  );

  it.runIf(process.platform !== "win32")(
    "POSIX controlled deletion retirement retains a private-path successor",
    () => {
      const fixture = runPosixInstallerFixture({
        existing: true,
        targetOnly: true,
        lineageFailure: "none",
        mutationRace: "retire-delete",
      });

      expect(
        fixture.run.status,
        fixture.run.stderr || fixture.run.stdout,
      ).not.toBe(0);
      expect(pathLexists(fixture.mutationRaceSentinel)).toBe(true);
      expect(sha256File(fixture.targetPath)).toBe(fixture.artifactSha256);
      const retainedName = fs
        .readdirSync(fixture.targetDir)
        .find(
          (name) =>
            name.startsWith(".chainlesschain.target-prior-") &&
            name.includes(".cleanup-"),
        );
      expect(retainedName).toBeDefined();
      expect(
        fs.readFileSync(path.join(fixture.targetDir, retainedName)),
      ).toEqual(fixture.prestate.targetBytes);
      expect(pathLexists(`${fixture.targetPath}.update.lock`)).toBe(true);
    },
    120_000,
  );

  it.runIf(process.platform !== "win32")(
    "POSIX hard-link no-overwrite fallback retains both the claim and a source successor",
    () => {
      const fixture = runPosixInstallerFixture({
        existing: true,
        targetOnly: true,
        lineageFailure: "none",
        mutationRace: "link-fallback",
      });

      expect(
        fixture.run.status,
        fixture.run.stderr || fixture.run.stdout,
      ).not.toBe(0);
      expect(pathLexists(fixture.mutationRaceSentinel)).toBe(true);
      const claimName = fs
        .readdirSync(fixture.targetDir)
        .find((name) =>
          name.startsWith(".chainlesschain.target-publish-claimed-"),
        );
      expect(claimName).toBeDefined();
      const claimPath = path.join(fixture.targetDir, claimName);
      expect(fs.readFileSync(fixture.targetPath)).toEqual(
        fixture.prestate.targetBytes,
      );
      expect(fs.readFileSync(claimPath)).toEqual(fixture.prestate.targetBytes);
      const successorStat = fs.lstatSync(fixture.targetPath, { bigint: true });
      const claimStat = fs.lstatSync(claimPath, { bigint: true });
      expect([successorStat.dev, successorStat.ino]).not.toEqual([
        claimStat.dev,
        claimStat.ino,
      ]);
      expect(pathLexists(`${fixture.targetPath}.update.lock`)).toBe(true);
    },
    120_000,
  );

  it.runIf(process.platform !== "win32")(
    "POSIX candidate materialization never writes through a same-uid symlink replacement",
    () => {
      const fixture = runPosixInstallerFixture({
        existing: true,
        lineageFailure: "none",
        replaceCandidateDuringMaterialization: true,
      });

      expect(
        fixture.run.status,
        fixture.run.stderr || fixture.run.stdout,
      ).not.toBe(0);
      expect(pathLexists(fixture.candidateReplacedSentinel)).toBe(true);
      expect(fs.readFileSync(fixture.candidateVictimPath, "utf8")).toBe(
        "candidate-victim-must-survive",
      );
      expect(fs.statSync(fixture.candidateVictimPath).mode & 0o777).toBe(0o640);
      const candidateName = fs
        .readdirSync(fixture.targetDir)
        .find((name) => name.startsWith(".chainlesschain.new."));
      expect(candidateName).toBeDefined();
      const candidatePath = path.join(fixture.targetDir, candidateName);
      expect(fs.lstatSync(candidatePath).isSymbolicLink()).toBe(true);
      expect(fs.readlinkSync(candidatePath)).toBe(fixture.candidateVictimPath);
      expect(fs.readFileSync(fixture.targetPath)).toEqual(
        fixture.prestate.targetBytes,
      );
      expect(pathLexists(`${fixture.targetPath}.update.lock`)).toBe(false);
      expect(fixture.run.stderr).toContain("cleanup-pending/degraded");
    },
    120_000,
  );

  it.runIf(process.platform !== "win32")(
    "POSIX cleanup retains a replacement network-staging directory instead of recursively deleting it",
    () => {
      const fixture = runPosixInstallerFixture({
        existing: true,
        lineageFailure: "none",
        replaceStagingBeforeCleanup: true,
      });

      expect(
        fixture.run.status,
        fixture.run.stderr || fixture.run.stdout,
      ).not.toBe(0);
      expect(pathLexists(fixture.stagingReplacedSentinel)).toBe(true);
      const stagingName = fs
        .readdirSync(fixture.root)
        .find(
          (name) =>
            name.startsWith("chainlesschain-install.") &&
            pathLexists(path.join(fixture.root, name, "successor.txt")),
        );
      expect(stagingName).toBeDefined();
      expect(
        fs.readFileSync(
          path.join(fixture.root, stagingName, "successor.txt"),
          "utf8",
        ),
      ).toBe("staging-successor-must-survive");
      expect(fs.readFileSync(fixture.targetPath)).toEqual(
        fixture.prestate.targetBytes,
      );
      expect(pathLexists(`${fixture.targetPath}.update.lock`)).toBe(false);
      expect(fixture.run.stderr).toContain("cleanup-pending/degraded");
    },
    120_000,
  );

  const orphanRaceShells =
    process.platform === "win32"
      ? hasWslOrphanRaceFixture
        ? [
            { posixShell: "/bin/bash", viaWsl: true },
            { posixShell: "/bin/dash", viaWsl: true },
          ]
        : []
      : ["/bin/bash", "/bin/dash"]
          .filter((shell) => fs.existsSync(shell))
          .map((posixShell) => ({ posixShell, viaWsl: false }));
  for (const shellFixture of orphanRaceShells) {
    const { posixShell, viaWsl } = shellFixture;
    for (const orphanKind of ["backup", "lineage"]) {
      const shellName = path.basename(posixShell);
      it(`POSIX/WSL ${shellName} ${orphanKind} quarantine retains a same-uid successor at the public name`, () => {
        const fixture = viaWsl
          ? runWslOrphanRaceFixture({
              posixShell,
              orphanState: orphanKind,
            })
          : runPosixInstallerFixture({
              lineageFailure: "none",
              orphanState: orphanKind,
              mutationRace: `orphan-${orphanKind}`,
              posixShell,
            });

        expect(
          fixture.run.status,
          fixture.run.stderr || fixture.run.stdout,
        ).not.toBe(0);
        expect(pathLexists(fixture.mutationRaceSentinel)).toBe(true);
        expect(pathLexists(fixture.targetPath)).toBe(false);
        expect(fs.readFileSync(fixture.prestate.orphanPath, "utf8")).toBe(
          `successor-orphan-${orphanKind}-must-survive`,
        );
        const successorStat = fs.lstatSync(fixture.prestate.orphanPath, {
          bigint: true,
        });
        expect([successorStat.dev, successorStat.ino]).not.toEqual([
          fixture.prestate.orphanDev,
          fixture.prestate.orphanIno,
        ]);
        expect(
          fs
            .readdirSync(fixture.targetDir)
            .some((name) => name.includes(".orphaned-")),
        ).toBe(false);
        expect(pathLexists(`${fixture.targetPath}.update.lock`)).toBe(true);
        expect(fixture.run.stderr).toContain(
          `orphaned ${
            orphanKind === "backup"
              ? "last-known-good backup"
              : "native update lineage"
          } quarantine failed closed`,
        );
      }, 120_000);
    }
  }

  for (const publicationPhase of ["target", "backup", "alias"]) {
    it.runIf(process.platform !== "win32")(
      `POSIX ${publicationPhase} publication TERM rolls the complete transaction back`,
      () => {
        const fixture = runPosixInstallerFixture({
          existing: true,
          lineageFailure: "none",
          terminateAfterPublication: publicationPhase,
        });

        expect(
          fixture.run.status,
          fixture.run.stderr || fixture.run.stdout,
        ).not.toBe(0);
        expect(pathLexists(fixture.publicationTerminatedSentinel)).toBe(true);
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
        expect(fixture.run.stderr).toContain(
          "incomplete install transaction was rolled back",
        );
        expect(fixture.run.stderr).not.toContain(
          "incomplete install transaction could not be rolled back",
        );
      },
      120_000,
    );
  }

  it.runIf(process.platform !== "win32")(
    "POSIX TERM during recovery retirement retains the retired pointer and lock",
    () => {
      const fixture = runPosixInstallerFixture({
        existing: true,
        targetOnly: true,
        lineageFailure: "none",
        terminateDuringRecoveryRetirement: true,
      });

      expect(
        fixture.run.status,
        fixture.run.stderr || fixture.run.stdout,
      ).not.toBe(0);
      expect(pathLexists(fixture.recoveryRetirementTerminatedSentinel)).toBe(
        true,
      );
      expect(sha256File(fixture.targetPath)).toBe(fixture.artifactSha256);
      expect(fs.readFileSync(fixture.backupPath)).toEqual(
        fixture.prestate.targetBytes,
      );
      expect(fs.readlinkSync(fixture.aliasPath)).toBe("chainlesschain");
      expect(
        JSON.parse(fs.readFileSync(fixture.lineagePath, "utf8")),
      ).toMatchObject({
        schema: "chainlesschain.native-update-lineage.v1",
        currentSha256: fixture.artifactSha256,
      });
      const names = fs.readdirSync(fixture.targetDir);
      expect(
        names.filter((name) =>
          name.startsWith(".chainlesschain.recovery-retired-"),
        ),
      ).toHaveLength(1);
      expect(
        names.filter(
          (name) =>
            name.startsWith(".chainlesschain.recovery-") &&
            !name.startsWith(".chainlesschain.recovery-retired-"),
        ),
      ).toHaveLength(0);
      expect(pathLexists(`${fixture.targetPath}.update.lock`)).toBe(true);
    },
    120_000,
  );

  for (const cleanupRace of [
    ["cleanup-prior-alias", ".cc.prior-", "legacy-chainlesschain"],
    ["cleanup-alias-anchor", ".cc.identity-", "chainlesschain"],
  ]) {
    const [mutationRace, retainedPrefix, expectedTarget] = cleanupRace;
    it.runIf(process.platform !== "win32")(
      `POSIX ${mutationRace} preserves the identity-replaced symlink and recovery evidence`,
      () => {
        const fixture = runPosixInstallerFixture({
          existing: true,
          lineageFailure: "none",
          mutationRace,
        });

        expect(
          fixture.run.status,
          fixture.run.stderr || fixture.run.stdout,
        ).not.toBe(0);
        expect(pathLexists(fixture.mutationRaceSentinel)).toBe(true);
        const retainedName = fs
          .readdirSync(fixture.targetDir)
          .find((name) => name.startsWith(retainedPrefix));
        expect(retainedName).toBeDefined();
        expect(
          fs.readlinkSync(path.join(fixture.targetDir, retainedName)),
        ).toBe(expectedTarget);
        expect(fs.readlinkSync(fixture.aliasPath)).toBe("chainlesschain");
        expect(
          fs
            .readdirSync(fixture.targetDir)
            .some((name) =>
              name.startsWith(".chainlesschain.recovery-retired-"),
            ),
        ).toBe(true);
        expect(pathLexists(`${fixture.targetPath}.update.lock`)).toBe(true);
      },
      120_000,
    );
  }

  it.runIf(process.platform !== "win32")(
    "POSIX recovery-state creation failure never unlinks a same-name successor",
    () => {
      const fixture = runPosixInstallerFixture({
        existing: true,
        lineageFailure: "none",
        failRecoveryStateCreate: true,
      });

      expect(
        fixture.run.status,
        fixture.run.stderr || fixture.run.stdout,
      ).not.toBe(0);
      expect(pathLexists(fixture.recoveryStateCreateFailedSentinel)).toBe(true);
      expect(fs.readFileSync(fixture.targetPath)).toEqual(
        fixture.prestate.targetBytes,
      );
      const names = fs.readdirSync(fixture.targetDir);
      const pointerName = names.find(
        (name) =>
          name.startsWith(".chainlesschain.recovery-") &&
          !name.startsWith(".chainlesschain.recovery-retired-"),
      );
      expect(pointerName).toBeDefined();
      expect(
        fs.readFileSync(path.join(fixture.targetDir, pointerName), "utf8"),
      ).toBe("recovery-pointer-successor-must-survive");
      expect(
        names.some((name) => name.startsWith(".chainlesschain.target-prior-")),
      ).toBe(true);
      expect(pathLexists(`${fixture.targetPath}.update.lock`)).toBe(true);
    },
    120_000,
  );

  for (const lineageCase of [
    ["lineage-publish-existing", false],
    ["lineage-publish-absent", true],
  ]) {
    const [mutationRace, targetOnly] = lineageCase;
    it.runIf(process.platform !== "win32")(
      `POSIX ${mutationRace} never overwrites the injected lineage successor`,
      () => {
        const fixture = runPosixInstallerFixture({
          existing: true,
          targetOnly,
          lineageFailure: "none",
          mutationRace,
        });

        expect(
          fixture.run.status,
          fixture.run.stderr || fixture.run.stdout,
        ).not.toBe(0);
        expect(pathLexists(fixture.mutationRaceSentinel)).toBe(true);
        expect(fs.readFileSync(fixture.lineagePath, "utf8")).toBe(
          "successor-lineage-must-survive",
        );
        expect(sha256File(fixture.targetPath)).toBe(fixture.artifactSha256);
        expect(
          fs
            .readdirSync(fixture.targetDir)
            .some(
              (name) =>
                name.startsWith(".chainlesschain.staged-") &&
                name.endsWith(".update-lineage.json"),
            ),
        ).toBe(true);
        expect(pathLexists(`${fixture.targetPath}.update.lock`)).toBe(true);
      },
      120_000,
    );
  }

  it.runIf(process.platform !== "win32")(
    "POSIX committed transaction reports cleanup-pending while retaining fd-bound tombstones",
    () => {
      const fixture = runPosixInstallerFixture({
        existing: true,
        lineageFailure: "none",
      });

      expect(
        fixture.run.status,
        fixture.run.stderr || fixture.run.stdout,
      ).not.toBe(0);
      expect(sha256File(fixture.targetPath)).toBe(fixture.artifactSha256);
      expect(fs.readFileSync(fixture.backupPath)).toEqual(
        fixture.prestate.targetBytes,
      );
      expect(fs.readlinkSync(fixture.aliasPath)).toBe("chainlesschain");
      expect(pathLexists(`${fixture.targetPath}.update.lock`)).toBe(false);
      expect(fixture.run.stderr).toContain("cleanup-pending/degraded");
      expect(
        fs
          .readdirSync(fixture.targetDir)
          .filter(
            (name) =>
              name.startsWith(".chainlesschain.") || name.startsWith(".cc."),
          ),
      ).not.toEqual([]);
    },
    120_000,
  );

  for (const lockReleaseFault of ["replace-held", "replace-anchor"]) {
    it.runIf(process.platform !== "win32")(
      `POSIX ${lockReleaseFault} successor survives conservative lock release`,
      () => {
        const fixture = runPosixInstallerFixture({
          existing: true,
          lineageFailure: "none",
          lockReleaseFault,
        });
        const names = fs.readdirSync(fixture.targetDir);

        expect(
          fixture.run.status,
          fixture.run.stderr || fixture.run.stdout,
        ).not.toBe(0);
        expect(pathLexists(fixture.lockEvidenceReplacedSentinel)).toBe(true);
        expect(pathLexists(`${fixture.targetPath}.update.lock`)).toBe(false);
        const anchorName = names.find((name) =>
          name.startsWith(".chainlesschain.lock-anchor-"),
        );
        const releaseName = names.find((name) =>
          name.startsWith(".chainlesschain.lock-release-"),
        );
        expect(anchorName).toBeDefined();
        expect(releaseName).toBeDefined();
        const anchorPath = path.join(fixture.targetDir, anchorName);
        const heldPath = path.join(
          fixture.targetDir,
          releaseName,
          "owned.lock",
        );
        expect(pathLexists(heldPath)).toBe(true);
        const replacedPath =
          lockReleaseFault === "replace-held" ? heldPath : anchorPath;
        expect(fs.readFileSync(replacedPath, "utf8")).toBe(
          `${lockReleaseFault}-successor-must-survive`,
        );
        expect(fixture.run.stderr).toContain("cleanup-pending/degraded");
        expect(fixture.run.stderr).not.toContain(
          "native update lock release failed",
        );
      },
      120_000,
    );
  }

  it.runIf(process.platform !== "win32")(
    "POSIX lock release durability failure restores the public lock without deleting private evidence",
    () => {
      const fixture = runPosixInstallerFixture({
        existing: true,
        lineageFailure: "none",
        lockReleaseFault: "fsync-renamed-parent",
      });
      const names = fs.readdirSync(fixture.targetDir);

      expect(
        fixture.run.status,
        fixture.run.stderr || fixture.run.stdout,
      ).not.toBe(0);
      expect(sha256File(fixture.targetPath)).toBe(fixture.artifactSha256);
      expect(pathLexists(`${fixture.targetPath}.update.lock`)).toBe(true);
      expect(
        names.some((name) => name.startsWith(".chainlesschain.lock-anchor-")),
      ).toBe(true);
      expect(
        names.some((name) => name.startsWith(".chainlesschain.lock-release-")),
      ).toBe(true);
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
      '$JournalPath = "$TargetPath.update-transaction.json"',
    );
    expect(source).toContain(
      'schema = "chainlesschain.native-install-transaction.v1"',
    );
    expect(source).toContain("Resolve-StaleInstallLock $LockPath");
    expect(source).toContain("Invoke-InterruptedInstallRecovery");
    expect(source).toContain("Write-InstallTransactionJournal");
    expect(source).toContain('phase = "prepared"');
    expect(source).toContain('$TransactionJournal.phase = "target-committed"');
    expect(source).toContain('$TransactionJournal.phase = "alias-committed"');
    expect(source).toContain('$TransactionJournal.phase = "verified"');
    expect(source).toContain('$TransactionJournal.phase = "committed"');
    expect(source).toContain('$TransactionJournal.decision = "commit"');
    expect(source).toContain(
      '[Environment]::FailFast("CLI installer crash fixture after $Phase")',
    );
    expect(source).toContain(
      "[IO.File]::Copy($Artifact, $CandidatePath, $false)",
    );
    expect(source).toContain('(".chainlesschain.new-$TransactionId.exe")');
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
    "PowerShell installer quarantines a legacy GUID stale lock before recovery",
    () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-ps-stale-lock-"));
      temporaryDirectories.push(root);
      const targetDir = path.join(root, "bin");
      fs.mkdirSync(targetDir, { recursive: true });
      const lockPath = path.join(targetDir, "chainlesschain.exe.update.lock");
      const legacyToken = "9999999999:00000000-0000-4000-8000-000000000001";
      fs.writeFileSync(lockPath, legacyToken);

      const run = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          [
            `$env:CC_CLI_INSTALL_DIR = ${psQuote(targetDir)}`,
            `$env:CC_CLI_INSTALL_RECOVERY_ONLY = '1'`,
            `. ${psQuote(ps1Path)}`,
          ].join("; "),
        ],
        { encoding: "utf8", timeout: 60_000 },
      );

      expect(run.status, run.stderr || run.stdout).not.toBe(0);
      expect(fs.existsSync(lockPath)).toBe(false);
      const quarantined = fs
        .readdirSync(targetDir)
        .filter((name) =>
          name.startsWith("chainlesschain.exe.update.lock.orphaned-"),
        );
      expect(quarantined).toHaveLength(1);
      expect(
        fs.readFileSync(path.join(targetDir, quarantined[0]), "utf8"),
      ).toBe(legacyToken);
    },
    90_000,
  );

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
      fs.writeFileSync(`${targetPath}.previous`, "known-good-older-backup");

      const command = [
        `Import-Module Microsoft.PowerShell.Utility -ErrorAction Stop`,
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
        "known-good-older-backup",
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

  it.runIf(process.platform === "win32").each([
    ["prepared", "rollback"],
    ["target-committed", "rollback"],
    ["alias-committed", "rollback"],
    ["verified", "rollback"],
    ["committed", "commit"],
  ])(
    "PowerShell installer recovers a hard crash after %s with a %s decision",
    (phase, decision) => {
      const root = fs.mkdtempSync(
        path.join(os.tmpdir(), "cc-ps-install-crash-"),
      );
      temporaryDirectories.push(root);
      const fixtureDir = path.join(root, "fixtures");
      const targetDir = path.join(root, "bin");
      fs.mkdirSync(fixtureDir, { recursive: true });
      fs.mkdirSync(targetDir, { recursive: true });

      const artifactPath = path.join(fixtureDir, "artifact.exe");
      fs.copyFileSync(process.execPath, artifactPath);
      const expectedHash = crypto
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
                sha256: expectedHash,
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
      const journalPath = `${targetPath}.update-transaction.json`;
      const originalTarget = "hard-crash-known-good-primary";
      const originalAlias = "hard-crash-known-good-alias";
      const originalBackup = "hard-crash-older-rollback-generation";
      const originalLineage = `${JSON.stringify({
        schema: "chainlesschain.native-update-lineage.v1",
        transactionId: "00000000-0000-0000-0000-000000000001",
        operation: "install",
        currentSha256: crypto
          .createHash("sha256")
          .update(originalTarget)
          .digest("hex"),
        previousSha256: null,
        updatedAt: "2026-08-01T00:00:00.000Z",
      })}\n`;
      fs.writeFileSync(targetPath, originalTarget);
      fs.writeFileSync(aliasPath, originalAlias);
      fs.writeFileSync(backupPath, originalBackup);
      fs.writeFileSync(lineagePath, originalLineage);

      const fixtureSetup = [
        `Import-Module Microsoft.PowerShell.Utility -ErrorAction Stop`,
        `$env:CC_CLI_RELEASE_BASE_URL = 'https://fixture/base'`,
        `$env:CC_CLI_INSTALL_DIR = ${psQuote(targetDir)}`,
        `function cosign { $global:LASTEXITCODE = 0 }`,
        `function Invoke-WebRequest { param([string]$Uri, [string]$OutFile); if ($Uri.EndsWith('chainlesschain-update.json.sigstore.json')) { $Source = ${psQuote(bundlePath)} } elseif ($Uri.EndsWith('chainlesschain-update.json')) { $Source = ${psQuote(manifestPath)} } elseif ($Uri.EndsWith('artifact.sigstore.json')) { $Source = ${psQuote(bundlePath)} } elseif ($Uri.EndsWith('artifact.exe')) { $Source = ${psQuote(artifactPath)} } else { throw "unexpected fixture URL: $Uri" }; [IO.File]::Copy($Source, $OutFile, $true) }`,
      ];
      const crashed = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          [
            ...fixtureSetup,
            `$env:CC_CLI_INSTALL_CRASH_AFTER_PHASE = ${psQuote(phase)}`,
            `. ${psQuote(ps1Path)}`,
          ].join("; "),
        ],
        { encoding: "utf8", timeout: 90_000 },
      );
      expect(crashed.status, crashed.stderr || crashed.stdout).not.toBe(0);
      expect(fs.existsSync(journalPath)).toBe(true);
      expect(fs.existsSync(`${targetPath}.update.lock`)).toBe(true);

      const recovered = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          [
            `$env:CC_CLI_INSTALL_DIR = ${psQuote(targetDir)}`,
            `$env:CC_CLI_INSTALL_CRASH_AFTER_PHASE = $null`,
            `$env:CC_CLI_INSTALL_RECOVERY_ONLY = '1'`,
            `. ${psQuote(ps1Path)}`,
          ].join("; "),
        ],
        { encoding: "utf8", timeout: 90_000 },
      );
      expect(recovered.status, recovered.stderr || recovered.stdout).toBe(0);
      expect(fs.existsSync(journalPath)).toBe(false);
      expect(fs.existsSync(`${targetPath}.update.lock`)).toBe(false);

      if (decision === "rollback") {
        expect(fs.readFileSync(targetPath, "utf8")).toBe(originalTarget);
        expect(fs.readFileSync(aliasPath, "utf8")).toBe(originalAlias);
        expect(fs.readFileSync(backupPath, "utf8")).toBe(originalBackup);
        expect(fs.readFileSync(lineagePath, "utf8")).toBe(originalLineage);
      } else {
        expect(
          crypto
            .createHash("sha256")
            .update(fs.readFileSync(targetPath))
            .digest("hex"),
        ).toBe(expectedHash);
        expect(
          crypto
            .createHash("sha256")
            .update(fs.readFileSync(aliasPath))
            .digest("hex"),
        ).toBe(expectedHash);
        expect(JSON.parse(fs.readFileSync(lineagePath, "utf8"))).toMatchObject({
          schema: "chainlesschain.native-update-lineage.v1",
          operation: "install",
          currentSha256: expectedHash,
        });
        expect(fs.readFileSync(backupPath, "utf8")).toBe(originalTarget);
      }

      const remaining = fs.readdirSync(targetDir);
      expect(
        remaining.filter((name) =>
          /(?:update-transaction|\.new-|\.recovery-|\.rejected-|lineage-prior-|backup-prior-|\.cc\.previous-)/.test(
            name,
          ),
        ),
      ).toEqual([]);
      expect(
        remaining.some((name) => name.includes("update.lock.orphaned-")),
      ).toBe(true);
    },
    180_000,
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
        `Import-Module Microsoft.PowerShell.Utility -ErrorAction Stop`,
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
    expect(source).toContain("recoverPendingNativeGeneration();");
    expect(source).toContain("reportPendingNativeUpdateResult();");
    expect(source.indexOf("recoverPendingNativeGeneration();")).toBeLessThan(
      source.indexOf("reportPendingNativeUpdateResult();"),
    );
    expect(source.indexOf("reportPendingNativeUpdateResult();")).toBeLessThan(
      source.indexOf("runCli(process.argv)"),
    );
  });
});
