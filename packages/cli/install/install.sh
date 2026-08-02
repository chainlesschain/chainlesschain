#!/usr/bin/env sh
set -eu
umask 077

REPOSITORY="${CC_CLI_REPOSITORY:-chainlesschain/chainlesschain}"
BASE_URL="${CC_CLI_RELEASE_BASE_URL:-https://github.com/$REPOSITORY/releases/download/cli-stable}"
INSTALL_DIR="${CC_CLI_INSTALL_DIR:-$HOME/.local/bin}"
MANIFEST_URL="$BASE_URL/chainlesschain-update.json"
IDENTITY="^https://github.com/${REPOSITORY}/.github/workflows/cli-native-release.yml@refs/tags/cli-v"

command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 2; }
command -v cosign >/dev/null 2>&1 || {
  echo "cosign is required to verify the signed CLI release" >&2
  exit 2
}
command -v python3 >/dev/null 2>&1 || { echo "python3 is required" >&2; exit 2; }

case "$(uname -s)" in
  Linux) OS=linux ;;
  Darwin) OS=macos ;;
  *) echo "unsupported operating system: $(uname -s)" >&2; exit 2 ;;
esac
case "$(uname -m)" in
  x86_64|amd64) ARCH=x64 ;;
  arm64|aarch64) ARCH=arm64 ;;
  *) echo "unsupported architecture: $(uname -m)" >&2; exit 2 ;;
esac
TARGET="node20-$OS-$ARCH"

STAGING=""
LOCK_PATH=""
LOCK_TOKEN=""
LOCK_IDENTITY=""
LOCK_HELD=0
CANDIDATE_PATH=""
BACKUP_TEMP_PATH=""
ROLLBACK_TEMP_PATH=""
ALIAS_TEMP_PATH=""
PRIOR_BACKUP_PATH=""
PRIOR_LINEAGE_PATH=""
PRIOR_ALIAS_PATH=""
BACKUP_RESTORE_PATH=""
LINEAGE_RESTORE_PATH=""
ALIAS_RESTORE_PATH=""
HAD_TARGET=0
HAD_BACKUP=0
HAD_LINEAGE=0
HAD_ALIAS=0
SWAPPED=0
COMMITTED=0
BACKUP_COMMITTED=0
ALIAS_COMMITTED=0
LINEAGE_COMMIT_STARTED=0
PRESERVE_RECOVERY=0
TRANSACTION_ID=""
OLD_TARGET_SHA256=""
OLD_BACKUP_SHA256=""
OLD_BACKUP_IDENTITY=""
OLD_LINEAGE_SHA256=""
OLD_LINEAGE_IDENTITY=""

cleanup() {
  status=$?
  set +e
  trap - 0 HUP INT TERM
  if [ "$SWAPPED" -eq 1 ] && [ "$COMMITTED" -eq 0 ]; then
    if rollback_install; then
      SWAPPED=0
      echo "incomplete install transaction was rolled back" >&2
    else
      PRESERVE_RECOVERY=1
      echo "incomplete install transaction could not be rolled back" >&2
    fi
  fi
  cleanup_failed=0
  cleanup_removed=0
  if [ "$PRESERVE_RECOVERY" -eq 0 ]; then
    for cleanup_path in \
      "$CANDIDATE_PATH" \
      "$BACKUP_TEMP_PATH" \
      "$ROLLBACK_TEMP_PATH" \
      "$ALIAS_TEMP_PATH" \
      "$PRIOR_BACKUP_PATH" \
      "$PRIOR_LINEAGE_PATH" \
      "$PRIOR_ALIAS_PATH" \
      "$BACKUP_RESTORE_PATH" \
      "$LINEAGE_RESTORE_PATH" \
      "$ALIAS_RESTORE_PATH"
    do
      if [ -n "$cleanup_path" ] && { [ -e "$cleanup_path" ] || [ -L "$cleanup_path" ]; }; then
        if rm -f "$cleanup_path"; then
          cleanup_removed=1
        else
          cleanup_failed=1
        fi
      fi
    done
    if [ "$cleanup_failed" -eq 0 ] && [ "$cleanup_removed" -eq 1 ] && [ -d "$INSTALL_DIR" ]; then
      fsync_dir "$INSTALL_DIR" || cleanup_failed=1
    fi
    if [ "$cleanup_failed" -ne 0 ]; then
      PRESERVE_RECOVERY=1
      [ "$status" -ne 0 ] || status=1
      echo "native install transaction cleanup was not durable" >&2
    fi
  fi
  if [ "$PRESERVE_RECOVERY" -eq 1 ]; then
    for recovery_path in \
      "$CANDIDATE_PATH" \
      "$BACKUP_TEMP_PATH" \
      "$ROLLBACK_TEMP_PATH" \
      "$ALIAS_TEMP_PATH" \
      "$PRIOR_BACKUP_PATH" \
      "$PRIOR_LINEAGE_PATH" \
      "$PRIOR_ALIAS_PATH" \
      "$BACKUP_RESTORE_PATH" \
      "$LINEAGE_RESTORE_PATH" \
      "$ALIAS_RESTORE_PATH"
    do
      if [ -n "$recovery_path" ] && { [ -e "$recovery_path" ] || [ -L "$recovery_path" ]; }; then
        echo "recovery artifact preserved at $recovery_path" >&2
      fi
    done
  fi
  if [ "$LOCK_HELD" -eq 1 ] && assert_lock_owned 2>/dev/null; then
    if [ "$PRESERVE_RECOVERY" -eq 1 ]; then
      echo "native update lock retained for manual recovery at $LOCK_PATH" >&2
    else
      rm -f "$LOCK_PATH"
    fi
  fi
  [ -n "$STAGING" ] && rm -rf "$STAGING"
  exit "$status"
}
trap cleanup 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

die() {
  echo "$1" >&2
  exit "${2:-1}"
}

assert_safe_install_dir() {
  python3 - "$1" <<'PY'
import os, stat, sys

path = os.path.abspath(os.path.expanduser(sys.argv[1]))
current = os.path.sep
for component in path.split(os.path.sep):
    if not component:
        continue
    current = os.path.join(current, component)
    try:
        mode = os.lstat(current).st_mode
    except FileNotFoundError:
        continue
    if stat.S_ISLNK(mode):
        raise SystemExit(f"refusing install path containing symlink: {current}")
    if current == path and not stat.S_ISDIR(mode):
        raise SystemExit(f"install path is not a directory: {current}")
PY
}

assert_regular_file_or_missing() {
  file_path=$1
  label=$2
  if [ -L "$file_path" ]; then
    die "$label must not be a symlink: $file_path"
  fi
  if [ -e "$file_path" ] && [ ! -f "$file_path" ]; then
    die "$label must be a regular file or absent: $file_path"
  fi
}

sha256_file() {
  python3 - "$1" <<'PY'
import hashlib, sys
h = hashlib.sha256()
with open(sys.argv[1], 'rb') as stream:
    for block in iter(lambda: stream.read(1024 * 1024), b''):
        h.update(block)
print(h.hexdigest())
PY
}

startup_check() {
  python3 - "$1" <<'PY'
import subprocess, sys

try:
    result = subprocess.run(
        [sys.argv[1], '--version'],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=30,
        check=False,
    )
except (OSError, subprocess.TimeoutExpired):
    raise SystemExit(1)
raise SystemExit(result.returncode)
PY
}

fsync_file() {
  python3 - "$1" <<'PY'
import os, sys
with open(sys.argv[1], 'rb') as stream:
    os.fsync(stream.fileno())
PY
}

fsync_dir() {
  python3 - "$1" <<'PY'
import errno, os, sys
fd = os.open(sys.argv[1], os.O_RDONLY)
try:
    try:
        os.fsync(fd)
    except OSError as error:
        if error.errno not in (errno.EBADF, errno.EINVAL, getattr(errno, 'ENOTSUP', errno.EINVAL)):
            raise
finally:
    os.close(fd)
PY
}

acquire_update_lock() {
  python3 - "$1" "$2" <<'PY'
import os, sys
lock_path, token = sys.argv[1:]
flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, 'O_NOFOLLOW', 0)
fd = os.open(lock_path, flags, 0o600)
try:
    os.write(fd, token.encode('utf-8'))
    os.fsync(fd)
    current = os.fstat(fd)
    print(f'{current.st_dev}:{current.st_ino}')
finally:
    os.close(fd)
PY
}

assert_lock_owned() {
  python3 - "$LOCK_PATH" "$LOCK_TOKEN" "$LOCK_IDENTITY" <<'PY'
import os, stat, sys

lock_path, token, expected_identity = sys.argv[1:]
expected_dev, expected_ino = (int(value) for value in expected_identity.split(':', 1))
flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
fd = os.open(lock_path, flags)
try:
    before = os.fstat(fd)
    path_before = os.lstat(lock_path)
    actual = os.read(fd, len(token.encode('utf-8')) + 1)
    after = os.fstat(fd)
    path_after = os.lstat(lock_path)
finally:
    os.close(fd)

regular = all(stat.S_ISREG(value.st_mode) for value in (before, path_before, after, path_after))
stable = (
    before.st_nlink > 0
    and after.st_nlink > 0
    and not (before.st_dev == 0 and before.st_ino == 0)
    and (before.st_dev, before.st_ino) == (expected_dev, expected_ino)
    and (before.st_dev, before.st_ino) == (path_before.st_dev, path_before.st_ino)
    and (before.st_dev, before.st_ino) == (after.st_dev, after.st_ino)
    and (after.st_dev, after.st_ino) == (path_after.st_dev, path_after.st_ino)
    and before.st_size == after.st_size == path_after.st_size
    and before.st_mtime_ns == after.st_mtime_ns == path_after.st_mtime_ns
    and before.st_ctime_ns == after.st_ctime_ns == path_after.st_ctime_ns
)
if not regular or not stable or actual != token.encode('utf-8'):
    raise SystemExit('native update lock ownership was lost')
PY
}

write_lineage() {
  current_sha=$1
  previous_sha=$2
  operation=$3
  python3 - "$LINEAGE_PATH" "$TRANSACTION_ID" "$operation" "$current_sha" "$previous_sha" <<'PY'
import json, os, sys, tempfile
lineage_path, transaction_id, operation, current_sha, previous_sha = sys.argv[1:]
directory = os.path.dirname(lineage_path)
payload = {
    'schema': 'chainlesschain.native-update-lineage.v1',
    'transactionId': transaction_id,
    'operation': operation,
    'currentSha256': current_sha,
    'previousSha256': None if previous_sha == 'null' else previous_sha,
    'updatedAt': __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat().replace('+00:00', 'Z'),
}
fd, staging = tempfile.mkstemp(prefix='.chainlesschain.lineage.', dir=directory)
try:
    with os.fdopen(fd, 'w', encoding='utf-8') as stream:
        json.dump(payload, stream, separators=(',', ':'))
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(staging, lineage_path)
    dir_fd = os.open(directory, os.O_RDONLY)
    try:
        try:
            os.fsync(dir_fd)
        except OSError:
            pass
    finally:
        os.close(dir_fd)
except BaseException:
    try:
        os.unlink(staging)
    except FileNotFoundError:
        pass
    raise
PY
}

lineage_matches_transaction() {
  expected_current_sha=$1
  expected_previous_sha=$2
  python3 - "$TRANSACTION_ID" "$LINEAGE_PATH" "$expected_current_sha" "$expected_previous_sha" <<'PY'
import json, os, stat, sys

transaction_id, lineage_path, expected_current_sha, expected_previous_sha = sys.argv[1:]
flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
try:
    fd = os.open(lineage_path, flags)
except FileNotFoundError:
    raise SystemExit(1)
try:
    value_stat = os.fstat(fd)
    if not stat.S_ISREG(value_stat.st_mode):
        raise SystemExit(1)
    with os.fdopen(fd, 'r', encoding='utf-8') as stream:
        fd = -1
        value = json.load(stream)
finally:
    if fd >= 0:
        os.close(fd)
expected_previous = None if expected_previous_sha == 'null' else expected_previous_sha
valid = (
    isinstance(value, dict)
    and value.get('schema') == 'chainlesschain.native-update-lineage.v1'
    and value.get('transactionId') == transaction_id
    and value.get('operation') == 'install'
    and value.get('currentSha256') == expected_current_sha
    and value.get('previousSha256') == expected_previous
)
raise SystemExit(0 if valid else 1)
PY
}

file_identity() {
  python3 - "$1" <<'PY'
import os, stat, sys
value = os.lstat(sys.argv[1])
if not stat.S_ISREG(value.st_mode) or (value.st_dev == 0 and value.st_ino == 0):
    raise SystemExit('regular file has no stable identity')
print(f'{value.st_dev}:{value.st_ino}:{value.st_mode}')
PY
}

snapshot_alias() {
  python3 - "$1" "$2" <<'PY'
import os, stat, sys
source, snapshot = sys.argv[1:]
value = os.lstat(source)
if not stat.S_ISLNK(value.st_mode):
    raise SystemExit('CLI alias changed before it could be snapshotted')
os.symlink(os.readlink(source), snapshot)
PY
}

alias_matches_snapshot() {
  python3 - "$1" "$2" <<'PY'
import os, stat, sys
alias_path, snapshot_path = sys.argv[1:]
try:
    alias_stat = os.lstat(alias_path)
    snapshot_stat = os.lstat(snapshot_path)
except FileNotFoundError:
    raise SystemExit(1)
if not stat.S_ISLNK(alias_stat.st_mode) or not stat.S_ISLNK(snapshot_stat.st_mode):
    raise SystemExit(1)
raise SystemExit(0 if os.readlink(alias_path) == os.readlink(snapshot_path) else 1)
PY
}

create_alias_restore_candidate() {
  python3 - "$1" "$2" <<'PY'
import os, stat, sys
snapshot_path, restore_path = sys.argv[1:]
value = os.lstat(snapshot_path)
if not stat.S_ISLNK(value.st_mode):
    raise SystemExit('CLI alias recovery snapshot is not a symlink')
os.symlink(os.readlink(snapshot_path), restore_path)
PY
}

discard_transaction_snapshots() {
  removed=0
  for snapshot_path in \
    "$BACKUP_TEMP_PATH" \
    "$PRIOR_BACKUP_PATH" \
    "$PRIOR_LINEAGE_PATH" \
    "$PRIOR_ALIAS_PATH"
  do
    [ -n "$snapshot_path" ] || continue
    { [ -e "$snapshot_path" ] || [ -L "$snapshot_path" ]; } || return 1
    assert_lock_owned || return 1
    rm -f "$snapshot_path" || return 1
    removed=1
  done
  if [ "$removed" -eq 1 ]; then
    fsync_dir "$INSTALL_DIR" || return 1
  fi
  BACKUP_TEMP_PATH=""
  PRIOR_BACKUP_PATH=""
  PRIOR_LINEAGE_PATH=""
  PRIOR_ALIAS_PATH=""
}

rollback_install() {
  assert_lock_owned || return 1
  if [ "$HAD_TARGET" -eq 1 ]; then
    rollback_source=$BACKUP_PATH
    if [ "$BACKUP_COMMITTED" -eq 0 ]; then
      rollback_source=$BACKUP_TEMP_PATH
    fi
    [ -n "$rollback_source" ] || return 1
    [ ! -L "$rollback_source" ] || return 1
    [ -f "$rollback_source" ] || return 1
    ROLLBACK_TEMP_PATH=$(mktemp "$INSTALL_DIR/.chainlesschain.rollback.XXXXXX") || return 1
    cp -p "$rollback_source" "$ROLLBACK_TEMP_PATH" || return 1
    [ "$(sha256_file "$ROLLBACK_TEMP_PATH")" = "$OLD_TARGET_SHA256" ] || return 1
    fsync_file "$ROLLBACK_TEMP_PATH" || return 1
    assert_lock_owned || return 1
    mv -f "$ROLLBACK_TEMP_PATH" "$TARGET_PATH" || return 1
    ROLLBACK_TEMP_PATH=""
    [ "$(sha256_file "$TARGET_PATH")" = "$OLD_TARGET_SHA256" ] || return 1
  else
    [ ! -L "$TARGET_PATH" ] || return 1
    assert_lock_owned || return 1
    rm -f "$TARGET_PATH" || return 1
  fi

  if [ "$BACKUP_COMMITTED" -eq 1 ]; then
    if [ "$HAD_BACKUP" -eq 1 ]; then
      [ -n "$PRIOR_BACKUP_PATH" ] || return 1
      [ -f "$PRIOR_BACKUP_PATH" ] && [ ! -L "$PRIOR_BACKUP_PATH" ] || return 1
      [ "$(sha256_file "$PRIOR_BACKUP_PATH")" = "$OLD_BACKUP_SHA256" ] || return 1
      [ "$(file_identity "$PRIOR_BACKUP_PATH")" = "$OLD_BACKUP_IDENTITY" ] || return 1
      BACKUP_RESTORE_PATH="$INSTALL_DIR/.chainlesschain.backup-restore-$TRANSACTION_ID"
      [ ! -e "$BACKUP_RESTORE_PATH" ] && [ ! -L "$BACKUP_RESTORE_PATH" ] || return 1
      ln "$PRIOR_BACKUP_PATH" "$BACKUP_RESTORE_PATH" || return 1
      [ "$(sha256_file "$BACKUP_RESTORE_PATH")" = "$OLD_BACKUP_SHA256" ] || return 1
      [ "$(file_identity "$BACKUP_RESTORE_PATH")" = "$OLD_BACKUP_IDENTITY" ] || return 1
      assert_lock_owned || return 1
      mv -f "$BACKUP_RESTORE_PATH" "$BACKUP_PATH" || return 1
      BACKUP_RESTORE_PATH=""
      [ "$(sha256_file "$BACKUP_PATH")" = "$OLD_BACKUP_SHA256" ] || return 1
      [ "$(file_identity "$BACKUP_PATH")" = "$OLD_BACKUP_IDENTITY" ] || return 1
    else
      assert_regular_file_or_missing "$BACKUP_PATH" "last-known-good backup" || return 1
      assert_lock_owned || return 1
      rm -f "$BACKUP_PATH" || return 1
      [ ! -e "$BACKUP_PATH" ] && [ ! -L "$BACKUP_PATH" ] || return 1
    fi

  fi

  # The lineage writer uses an atomic replace, but a signal or write-helper
  # failure can arrive after that replace and before control returns here. Once
  # a lineage commit has started, rollback must therefore restore its exact
  # pre-transaction state independently of whether a backup was published.
  if [ "$LINEAGE_COMMIT_STARTED" -eq 1 ]; then
    if [ "$HAD_LINEAGE" -eq 1 ]; then
      [ -n "$PRIOR_LINEAGE_PATH" ] || return 1
      [ -f "$PRIOR_LINEAGE_PATH" ] && [ ! -L "$PRIOR_LINEAGE_PATH" ] || return 1
      [ "$(sha256_file "$PRIOR_LINEAGE_PATH")" = "$OLD_LINEAGE_SHA256" ] || return 1
      assert_regular_file_or_missing "$LINEAGE_PATH" "native update lineage" || return 1
      [ "$(file_identity "$PRIOR_LINEAGE_PATH")" = "$OLD_LINEAGE_IDENTITY" ] || return 1
      lineage_is_prior=0
      if [ -f "$LINEAGE_PATH" ] && \
        [ "$(sha256_file "$LINEAGE_PATH")" = "$OLD_LINEAGE_SHA256" ] && \
        [ "$(file_identity "$LINEAGE_PATH")" = "$OLD_LINEAGE_IDENTITY" ]; then
        lineage_is_prior=1
      fi
      if [ "$lineage_is_prior" -eq 0 ]; then
        LINEAGE_RESTORE_PATH="$INSTALL_DIR/.chainlesschain.lineage-restore-$TRANSACTION_ID"
        [ ! -e "$LINEAGE_RESTORE_PATH" ] && [ ! -L "$LINEAGE_RESTORE_PATH" ] || return 1
        ln "$PRIOR_LINEAGE_PATH" "$LINEAGE_RESTORE_PATH" || return 1
        [ "$(sha256_file "$LINEAGE_RESTORE_PATH")" = "$OLD_LINEAGE_SHA256" ] || return 1
        [ "$(file_identity "$LINEAGE_RESTORE_PATH")" = "$OLD_LINEAGE_IDENTITY" ] || return 1
        assert_lock_owned || return 1
        # mv(1) maps to rename(2) for these same-directory paths, so the old
        # public lineage remains continuously present if replacement fails.
        mv -f "$LINEAGE_RESTORE_PATH" "$LINEAGE_PATH" || return 1
        LINEAGE_RESTORE_PATH=""
        [ "$(sha256_file "$LINEAGE_PATH")" = "$OLD_LINEAGE_SHA256" ] || return 1
        [ "$(file_identity "$LINEAGE_PATH")" = "$OLD_LINEAGE_IDENTITY" ] || return 1
      fi
    else
      assert_regular_file_or_missing "$LINEAGE_PATH" "native update lineage" || return 1
      if [ -f "$LINEAGE_PATH" ]; then
        lineage_previous_sha=null
        if [ "$HAD_TARGET" -eq 1 ]; then
          lineage_previous_sha=$OLD_TARGET_SHA256
        fi
        lineage_matches_transaction "$ARTIFACT_SHA256" "$lineage_previous_sha" || return 1
        assert_lock_owned || return 1
        rm -f "$LINEAGE_PATH" || return 1
      fi
      [ ! -e "$LINEAGE_PATH" ] && [ ! -L "$LINEAGE_PATH" ] || return 1
    fi
    LINEAGE_COMMIT_STARTED=0
  fi

  if [ "$ALIAS_COMMITTED" -eq 1 ]; then
    if [ "$HAD_ALIAS" -eq 1 ]; then
      [ -n "$PRIOR_ALIAS_PATH" ] || return 1
      alias_matches_snapshot "$PRIOR_ALIAS_PATH" "$PRIOR_ALIAS_PATH" || return 1
      ALIAS_RESTORE_PATH="$INSTALL_DIR/.cc.restore-$TRANSACTION_ID"
      [ ! -e "$ALIAS_RESTORE_PATH" ] && [ ! -L "$ALIAS_RESTORE_PATH" ] || return 1
      create_alias_restore_candidate "$PRIOR_ALIAS_PATH" "$ALIAS_RESTORE_PATH" || return 1
      alias_matches_snapshot "$ALIAS_RESTORE_PATH" "$PRIOR_ALIAS_PATH" || return 1
      assert_lock_owned || return 1
      mv -f "$ALIAS_RESTORE_PATH" "$ALIAS_PATH" || return 1
      ALIAS_RESTORE_PATH=""
      alias_matches_snapshot "$ALIAS_PATH" "$PRIOR_ALIAS_PATH" || return 1
    else
      [ ! -L "$ALIAS_PATH" ] || {
        assert_lock_owned || return 1
        rm -f "$ALIAS_PATH" || return 1
      }
      [ ! -e "$ALIAS_PATH" ] && [ ! -L "$ALIAS_PATH" ] || return 1
    fi
    ALIAS_COMMITTED=0
  fi

  fsync_dir "$INSTALL_DIR" || return 1
  discard_transaction_snapshots || return 1
}

STAGING=$(mktemp -d "${TMPDIR:-/tmp}/chainlesschain-install.XXXXXX")
curl -fL "$MANIFEST_URL" -o "$STAGING/manifest.json"
curl -fL "$MANIFEST_URL.sigstore.json" -o "$STAGING/manifest.sigstore.json"
cosign verify-blob \
  --bundle "$STAGING/manifest.sigstore.json" \
  --certificate-identity-regexp "$IDENTITY" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  "$STAGING/manifest.json" >/dev/null

eval "$(python3 - "$STAGING/manifest.json" "$TARGET" <<'PY'
import json, shlex, sys
m = json.load(open(sys.argv[1], encoding='utf-8'))
a = next((x for x in m['latest']['artifacts'] if x['target'] == sys.argv[2]), None)
if not a:
    raise SystemExit('release has no artifact for ' + sys.argv[2])
for key, value in [('ARTIFACT_URL', a['url']), ('ARTIFACT_SHA256', a['sha256']), ('SIGNATURE_URL', a['signature'])]:
    print(f'{key}={shlex.quote(value)}')
PY
)"

ARTIFACT="$STAGING/chainlesschain"
curl -fL "$ARTIFACT_URL" -o "$ARTIFACT"
curl -fL "$SIGNATURE_URL" -o "$STAGING/artifact.sigstore.json"
ACTUAL_SHA256=$(sha256_file "$ARTIFACT")
if [ "$ACTUAL_SHA256" != "$ARTIFACT_SHA256" ]; then
  die "artifact SHA-256 mismatch"
fi
cosign verify-blob \
  --bundle "$STAGING/artifact.sigstore.json" \
  --certificate-identity-regexp "$IDENTITY" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  "$ARTIFACT" >/dev/null

# The network staging directory may be on another filesystem. Only verified
# bytes cross into INSTALL_DIR, and every rename below stays within that dir.
assert_safe_install_dir "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
assert_safe_install_dir "$INSTALL_DIR"
INSTALL_DIR=$(cd -P "$INSTALL_DIR" && pwd)

TARGET_PATH="$INSTALL_DIR/chainlesschain"
BACKUP_PATH="$TARGET_PATH.previous"
ALIAS_PATH="$INSTALL_DIR/cc"
LOCK_PATH="$TARGET_PATH.update.lock"
LINEAGE_PATH="$TARGET_PATH.update-lineage.json"
RESULT_PATH="$TARGET_PATH.update-result.json"
LAST_RESULT_PATH="$TARGET_PATH.update-result.last.json"

assert_regular_file_or_missing "$TARGET_PATH" "install target"
assert_regular_file_or_missing "$BACKUP_PATH" "last-known-good backup"
assert_regular_file_or_missing "$LINEAGE_PATH" "native update lineage"
assert_regular_file_or_missing "$LOCK_PATH" "native update lock"
assert_regular_file_or_missing "$RESULT_PATH" "native update result"
assert_regular_file_or_missing "$LAST_RESULT_PATH" "last consumed native update result"
if [ -e "$ALIAS_PATH" ] && [ ! -L "$ALIAS_PATH" ]; then
  die "CLI alias must be a symlink or absent: $ALIAS_PATH"
fi
LOCK_TOKEN="$$:$(python3 -c 'import uuid; print(uuid.uuid4().hex)')"
TRANSACTION_ID=$(python3 -c 'import uuid; print(uuid.uuid4())')
if LOCK_IDENTITY=$(acquire_update_lock "$LOCK_PATH" "$LOCK_TOKEN" 2>/dev/null); then
  :
else
  die "another ChainlessChain CLI install/update is already in progress"
fi
LOCK_HELD=1
assert_lock_owned || die "native update lock ownership was lost immediately after acquisition"
fsync_dir "$INSTALL_DIR"

# Revalidate every existing install-directory ancestor after acquiring the
# lock; a concurrent attacker may have replaced a component while we waited.
assert_safe_install_dir "$INSTALL_DIR"
assert_regular_file_or_missing "$TARGET_PATH" "install target"
assert_regular_file_or_missing "$BACKUP_PATH" "last-known-good backup"
assert_regular_file_or_missing "$LINEAGE_PATH" "native update lineage"
assert_regular_file_or_missing "$RESULT_PATH" "native update result"
assert_regular_file_or_missing "$LAST_RESULT_PATH" "last consumed native update result"
[ ! -f "$RESULT_PATH" ] || die "an unconsumed native update result must be handled before installing"
if [ -f "$LAST_RESULT_PATH" ] && python3 - "$LAST_RESULT_PATH" <<'PY'
import json, re, sys, uuid
try:
    value = json.load(open(sys.argv[1], encoding='utf-8'))
except Exception:
    raise SystemExit(0)
try:
    transaction_id_valid = str(uuid.UUID(value.get('transactionId', ''))) == value.get('transactionId', '').lower()
except (AttributeError, TypeError, ValueError):
    transaction_id_valid = False
valid = (
    isinstance(value, dict)
    and value.get('schema') == 'chainlesschain.native-update-result.v1'
    and transaction_id_valid
    and value.get('operation') in ('install', 'update', 'rescue')
    and isinstance(value.get('status'), str)
    and re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', value['status']) is not None
    and type(value.get('exitCode')) is int
    and value['exitCode'] in (0, 1)
    and ((value['status'] == 'success') == (value['exitCode'] == 0))
)
if not valid:
    raise SystemExit(0)
raise SystemExit(0 if value['status'].endswith('rollback-failed') else 1)
PY
then
  die "the previous native update requires manual recovery before installing"
fi

if [ ! -f "$TARGET_PATH" ]; then
  if [ -f "$BACKUP_PATH" ]; then
    assert_lock_owned || die "native update lock ownership was lost before backup quarantine"
    mv "$BACKUP_PATH" "$BACKUP_PATH.orphaned-$TRANSACTION_ID"
  fi
  if [ -f "$LINEAGE_PATH" ]; then
    assert_lock_owned || die "native update lock ownership was lost before lineage quarantine"
    mv "$LINEAGE_PATH" "$LINEAGE_PATH.orphaned-$TRANSACTION_ID"
  fi
  fsync_dir "$INSTALL_DIR"
fi
CANDIDATE_PATH=$(mktemp "$INSTALL_DIR/.chainlesschain.new.XXXXXX")
cp "$ARTIFACT" "$CANDIDATE_PATH"
chmod 755 "$CANDIDATE_PATH"
if [ "$(sha256_file "$CANDIDATE_PATH")" != "$ARTIFACT_SHA256" ]; then
  die "same-filesystem staging copy failed SHA-256 verification"
fi
fsync_file "$CANDIDATE_PATH"
if [ "$(sha256_file "$CANDIDATE_PATH")" != "$ARTIFACT_SHA256" ]; then
  die "same-filesystem candidate changed before pre-install startup check"
fi
if ! startup_check "$CANDIDATE_PATH"; then
  die "verified artifact failed its pre-install startup check"
fi

# Preserve the exact pre-transaction rollback generation. Hard-linking the
# regular state files keeps their inode, mode, and bytes available even after
# the public names are atomically replaced. The alias snapshot preserves the
# raw symlink target without following it.
if [ -f "$BACKUP_PATH" ]; then
  HAD_BACKUP=1
  OLD_BACKUP_SHA256=$(sha256_file "$BACKUP_PATH")
  OLD_BACKUP_IDENTITY=$(file_identity "$BACKUP_PATH")
  PRIOR_BACKUP_PATH="$INSTALL_DIR/.chainlesschain.backup-prior-$TRANSACTION_ID"
  [ ! -e "$PRIOR_BACKUP_PATH" ] && [ ! -L "$PRIOR_BACKUP_PATH" ] || die "backup recovery snapshot path already exists"
  ln "$BACKUP_PATH" "$PRIOR_BACKUP_PATH"
  [ "$(sha256_file "$PRIOR_BACKUP_PATH")" = "$OLD_BACKUP_SHA256" ] || die "backup recovery snapshot failed SHA-256 verification"
  [ "$(file_identity "$PRIOR_BACKUP_PATH")" = "$OLD_BACKUP_IDENTITY" ] || die "backup recovery snapshot lost file identity"
fi
if [ -f "$LINEAGE_PATH" ]; then
  HAD_LINEAGE=1
  OLD_LINEAGE_SHA256=$(sha256_file "$LINEAGE_PATH")
  OLD_LINEAGE_IDENTITY=$(file_identity "$LINEAGE_PATH")
  PRIOR_LINEAGE_PATH="$INSTALL_DIR/.chainlesschain.lineage-prior-$TRANSACTION_ID"
  [ ! -e "$PRIOR_LINEAGE_PATH" ] && [ ! -L "$PRIOR_LINEAGE_PATH" ] || die "lineage recovery snapshot path already exists"
  ln "$LINEAGE_PATH" "$PRIOR_LINEAGE_PATH"
  [ "$(sha256_file "$PRIOR_LINEAGE_PATH")" = "$OLD_LINEAGE_SHA256" ] || die "lineage recovery snapshot failed SHA-256 verification"
  [ "$(file_identity "$PRIOR_LINEAGE_PATH")" = "$OLD_LINEAGE_IDENTITY" ] || die "lineage recovery snapshot lost file identity"
fi
if [ -L "$ALIAS_PATH" ]; then
  HAD_ALIAS=1
  PRIOR_ALIAS_PATH="$INSTALL_DIR/.cc.prior-$TRANSACTION_ID"
  [ ! -e "$PRIOR_ALIAS_PATH" ] && [ ! -L "$PRIOR_ALIAS_PATH" ] || die "alias recovery snapshot path already exists"
  snapshot_alias "$ALIAS_PATH" "$PRIOR_ALIAS_PATH"
  alias_matches_snapshot "$ALIAS_PATH" "$PRIOR_ALIAS_PATH" || die "alias recovery snapshot changed during creation"
elif [ -e "$ALIAS_PATH" ]; then
  die "CLI alias must remain a symlink or absent: $ALIAS_PATH"
fi
if [ "$HAD_BACKUP" -eq 1 ] || [ "$HAD_LINEAGE" -eq 1 ] || [ "$HAD_ALIAS" -eq 1 ]; then
  fsync_dir "$INSTALL_DIR" || die "could not persist native recovery snapshots"
fi

if [ -f "$TARGET_PATH" ]; then
  HAD_TARGET=1
  OLD_TARGET_SHA256=$(sha256_file "$TARGET_PATH")
  BACKUP_TEMP_PATH=$(mktemp "$INSTALL_DIR/.chainlesschain.previous.XXXXXX")
  cp -p "$TARGET_PATH" "$BACKUP_TEMP_PATH"
  if [ "$(sha256_file "$BACKUP_TEMP_PATH")" != "$(sha256_file "$TARGET_PATH")" ]; then
    die "could not verify the last-known-good backup copy"
  fi
  fsync_file "$BACKUP_TEMP_PATH"
fi

# Re-check the manifest-bound bytes immediately before the commit point.
assert_safe_install_dir "$INSTALL_DIR"
assert_regular_file_or_missing "$TARGET_PATH" "install target"
assert_regular_file_or_missing "$BACKUP_PATH" "last-known-good backup"
assert_regular_file_or_missing "$LINEAGE_PATH" "native update lineage"
assert_regular_file_or_missing "$RESULT_PATH" "native update result"
assert_regular_file_or_missing "$LAST_RESULT_PATH" "last consumed native update result"
if [ "$HAD_TARGET" -eq 1 ] && [ "$(sha256_file "$TARGET_PATH")" != "$OLD_TARGET_SHA256" ]; then
  die "install target changed while the transaction was staged"
fi
if [ "$HAD_BACKUP" -eq 1 ]; then
  [ -f "$BACKUP_PATH" ] && [ ! -L "$BACKUP_PATH" ] || die "last-known-good backup changed while the transaction was staged"
  [ "$(sha256_file "$BACKUP_PATH")" = "$OLD_BACKUP_SHA256" ] || die "last-known-good backup changed while the transaction was staged"
  [ "$(file_identity "$BACKUP_PATH")" = "$OLD_BACKUP_IDENTITY" ] || die "last-known-good backup identity changed while the transaction was staged"
  [ "$(sha256_file "$PRIOR_BACKUP_PATH")" = "$OLD_BACKUP_SHA256" ] || die "backup recovery snapshot changed while the transaction was staged"
elif [ -e "$BACKUP_PATH" ] || [ -L "$BACKUP_PATH" ]; then
  die "last-known-good backup appeared while the transaction was staged"
fi
if [ "$HAD_LINEAGE" -eq 1 ]; then
  [ -f "$LINEAGE_PATH" ] && [ ! -L "$LINEAGE_PATH" ] || die "native update lineage changed while the transaction was staged"
  [ "$(sha256_file "$LINEAGE_PATH")" = "$OLD_LINEAGE_SHA256" ] || die "native update lineage changed while the transaction was staged"
  [ "$(sha256_file "$PRIOR_LINEAGE_PATH")" = "$OLD_LINEAGE_SHA256" ] || die "lineage recovery snapshot changed while the transaction was staged"
elif [ -e "$LINEAGE_PATH" ] || [ -L "$LINEAGE_PATH" ]; then
  die "native update lineage appeared while the transaction was staged"
fi
if [ "$HAD_ALIAS" -eq 1 ]; then
  alias_matches_snapshot "$ALIAS_PATH" "$PRIOR_ALIAS_PATH" || die "CLI alias changed while the transaction was staged"
elif [ -e "$ALIAS_PATH" ] || [ -L "$ALIAS_PATH" ]; then
  die "CLI alias appeared while the transaction was staged"
fi
if [ "$(sha256_file "$CANDIDATE_PATH")" != "$ARTIFACT_SHA256" ]; then
  die "same-filesystem candidate changed before commit"
fi
# Both paths are siblings, so this is the sole atomic commit point.
assert_lock_owned || die "native update lock ownership was lost before target commit"
mv -f "$CANDIDATE_PATH" "$TARGET_PATH"
CANDIDATE_PATH=""
SWAPPED=1
fsync_dir "$INSTALL_DIR"

if [ "$(sha256_file "$TARGET_PATH")" != "$ARTIFACT_SHA256" ]; then
  die "installed target changed at the commit boundary"
fi
if ! startup_check "$TARGET_PATH"; then
  echo "installed binary failed verification; rolling back" >&2
  if ! rollback_install; then
    die "installed binary failed verification and rollback also failed"
  fi
  SWAPPED=0
  die "installed binary failed verification; the previous version was restored"
fi

# Publish the pending backup only after the canonical candidate has passed its
# post-commit startup check. Before this point any failure restores from the
# transaction-local snapshot and leaves the previous lineage generation alone.
if [ "$HAD_TARGET" -eq 1 ]; then
  assert_regular_file_or_missing "$BACKUP_PATH" "last-known-good backup"
  if [ "$HAD_BACKUP" -eq 1 ]; then
    [ "$(sha256_file "$BACKUP_PATH")" = "$OLD_BACKUP_SHA256" ] || die "last-known-good backup changed before backup commit"
    [ "$(file_identity "$BACKUP_PATH")" = "$OLD_BACKUP_IDENTITY" ] || die "last-known-good backup identity changed before backup commit"
    [ "$(sha256_file "$PRIOR_BACKUP_PATH")" = "$OLD_BACKUP_SHA256" ] || die "backup recovery snapshot changed before backup commit"
  elif [ -e "$BACKUP_PATH" ] || [ -L "$BACKUP_PATH" ]; then
    die "last-known-good backup appeared before backup commit"
  fi
  assert_lock_owned || die "native update lock ownership was lost before backup commit"
  mv -f "$BACKUP_TEMP_PATH" "$BACKUP_PATH"
  BACKUP_TEMP_PATH=""
  BACKUP_COMMITTED=1
  fsync_dir "$INSTALL_DIR"
fi

ALIAS_TEMP_PATH="$INSTALL_DIR/.cc.link-$TRANSACTION_ID"
[ ! -e "$ALIAS_TEMP_PATH" ] && [ ! -L "$ALIAS_TEMP_PATH" ] || die "alias staging path already exists"
ln -s chainlesschain "$ALIAS_TEMP_PATH"
if [ "$HAD_ALIAS" -eq 1 ]; then
  alias_matches_snapshot "$ALIAS_PATH" "$PRIOR_ALIAS_PATH" || die "CLI alias changed before alias commit"
elif [ -e "$ALIAS_PATH" ] || [ -L "$ALIAS_PATH" ]; then
  die "CLI alias appeared before alias commit"
fi
assert_lock_owned || die "native update lock ownership was lost before alias commit"
mv -f "$ALIAS_TEMP_PATH" "$ALIAS_PATH"
ALIAS_TEMP_PATH=""
ALIAS_COMMITTED=1
fsync_dir "$INSTALL_DIR"
LINEAGE_COMMIT_STARTED=1
if [ "$HAD_TARGET" -eq 1 ]; then
  assert_lock_owned || die "native update lock ownership was lost before lineage commit"
  write_lineage "$ARTIFACT_SHA256" "$OLD_TARGET_SHA256" "install"
else
  assert_lock_owned || die "native update lock ownership was lost before lineage commit"
  write_lineage "$ARTIFACT_SHA256" "null" "install"
fi
COMMITTED=1
if ! discard_transaction_snapshots; then
  PRESERVE_RECOVERY=1
  die "install committed but prior-generation cleanup failed; the native update lock was retained"
fi
echo "Installed ChainlessChain CLI at $TARGET_PATH"
