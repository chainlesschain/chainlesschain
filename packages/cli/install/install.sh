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
LOCK_RELEASE_DIR=""
LOCK_ANCHOR_PATH=""
CANDIDATE_PATH=""
CANDIDATE_IDENTITY=""
BACKUP_TEMP_PATH=""
ROLLBACK_TEMP_PATH=""
ALIAS_TEMP_PATH=""
PRIOR_TARGET_PATH=""
PRIOR_BACKUP_PATH=""
PRIOR_LINEAGE_PATH=""
PRIOR_ALIAS_PATH=""
BACKUP_RESTORE_PATH=""
LINEAGE_RESTORE_PATH=""
ALIAS_RESTORE_PATH=""
RECOVERY_STATE_PATH=""
RECOVERY_RETIRED_PATH=""
RECOVERY_RETIRED=0
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
OLD_TARGET_IDENTITY=""
INSTALLED_TARGET_IDENTITY=""
OLD_BACKUP_SHA256=""
OLD_BACKUP_IDENTITY=""
OLD_LINEAGE_SHA256=""
OLD_LINEAGE_IDENTITY=""
INSTALLED_LINEAGE_SHA256=""
INSTALLED_LINEAGE_IDENTITY=""
OLD_ALIAS_TARGET_SHA256=""
OLD_ALIAS_IDENTITY=""
CANONICAL_ALIAS_TARGET_SHA256=""
INSTALLED_ALIAS_IDENTITY=""

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
  if [ "$PRESERVE_RECOVERY" -eq 0 ] && [ -n "$RECOVERY_STATE_PATH" ] && { [ -e "$RECOVERY_STATE_PATH" ] || [ -L "$RECOVERY_STATE_PATH" ]; }; then
    if ! discard_transaction_snapshots; then
      PRESERVE_RECOVERY=1
      [ "$status" -ne 0 ] || status=1
      echo "native recovery-set retirement or cleanup failed" >&2
    fi
  fi
  if [ "$PRESERVE_RECOVERY" -eq 0 ]; then
    for cleanup_path in \
      "$CANDIDATE_PATH" \
      "$ROLLBACK_TEMP_PATH" \
      "$ALIAS_TEMP_PATH" \
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
  # Snapshot creation can fail before the durable recovery-state pointer is
  # published. At that point no public commit has happened, so these are only
  # unregistered staging files and may be cleaned independently.
  if [ "$PRESERVE_RECOVERY" -eq 0 ] && \
    ! { [ -n "$RECOVERY_STATE_PATH" ] && { [ -e "$RECOVERY_STATE_PATH" ] || [ -L "$RECOVERY_STATE_PATH" ]; }; } && \
    ! { [ -n "$RECOVERY_RETIRED_PATH" ] && { [ -e "$RECOVERY_RETIRED_PATH" ] || [ -L "$RECOVERY_RETIRED_PATH" ]; }; }; then
    for cleanup_path in \
      "$BACKUP_TEMP_PATH" \
      "$PRIOR_TARGET_PATH" \
      "$PRIOR_BACKUP_PATH" \
      "$PRIOR_LINEAGE_PATH" \
      "$PRIOR_ALIAS_PATH"
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
      echo "native install staging cleanup was not durable" >&2
    fi
  fi
  if [ "$PRESERVE_RECOVERY" -eq 1 ]; then
    if [ "$RECOVERY_RETIRED" -eq 1 ] || { [ -n "$RECOVERY_RETIRED_PATH" ] && { [ -e "$RECOVERY_RETIRED_PATH" ] || [ -L "$RECOVERY_RETIRED_PATH" ]; }; }; then
      echo "retired recovery-set cleanup is incomplete; remaining artifacts may be partial" >&2
    fi
    for recovery_path in \
      "$CANDIDATE_PATH" \
      "$BACKUP_TEMP_PATH" \
      "$ROLLBACK_TEMP_PATH" \
      "$ALIAS_TEMP_PATH" \
      "$PRIOR_TARGET_PATH" \
      "$PRIOR_BACKUP_PATH" \
      "$PRIOR_LINEAGE_PATH" \
      "$PRIOR_ALIAS_PATH" \
      "$BACKUP_RESTORE_PATH" \
      "$LINEAGE_RESTORE_PATH" \
      "$ALIAS_RESTORE_PATH" \
      "$RECOVERY_STATE_PATH" \
      "$RECOVERY_RETIRED_PATH" \
      "$LOCK_RELEASE_DIR" \
      "$LOCK_ANCHOR_PATH"
    do
      if [ -n "$recovery_path" ] && { [ -e "$recovery_path" ] || [ -L "$recovery_path" ]; }; then
        echo "remaining transaction artifact at $recovery_path" >&2
      fi
    done
  fi
  if [ "$LOCK_HELD" -eq 1 ]; then
    if [ "$PRESERVE_RECOVERY" -eq 1 ]; then
      if assert_lock_owned 2>/dev/null; then
        echo "native update lock retained for manual recovery at $LOCK_PATH" >&2
      else
        echo "native update lock ownership was lost; no lock path was deleted" >&2
      fi
    else
      if release_update_lock; then
        LOCK_HELD=0
      else
        PRESERVE_RECOVERY=1
        [ "$status" -ne 0 ] || status=1
        echo "native update lock release failed; no unverified lock was deleted" >&2
        for lock_evidence in "$LOCK_PATH" "$LOCK_ANCHOR_PATH" "$LOCK_RELEASE_DIR"; do
          if [ -n "$lock_evidence" ] && { [ -e "$lock_evidence" ] || [ -L "$lock_evidence" ]; }; then
            echo "lock release evidence retained at $lock_evidence" >&2
          fi
        done
      fi
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

release_update_lock() {
  LOCK_RELEASE_DIR="$INSTALL_DIR/.chainlesschain.lock-release-$TRANSACTION_ID"
  LOCK_ANCHOR_PATH="$INSTALL_DIR/.chainlesschain.lock-anchor-$TRANSACTION_ID"
  python3 - "release-lock" "$LOCK_PATH" "$LOCK_TOKEN" "$LOCK_IDENTITY" "$LOCK_RELEASE_DIR" "$LOCK_ANCHOR_PATH" "$INSTALL_DIR" <<'PY'
import errno, os, stat, sys

marker, lock_path, token, expected_identity, release_dir, anchor_path, install_dir = sys.argv[1:]
if marker != 'release-lock':
    raise SystemExit('invalid lock release invocation')
expected_dev, expected_ino = (int(value) for value in expected_identity.split(':', 1))
token_bytes = token.encode('utf-8')

unsupported_fsync = {
    errno.EBADF,
    errno.EINVAL,
    getattr(errno, 'ENOTSUP', errno.EINVAL),
    getattr(errno, 'EOPNOTSUPP', errno.EINVAL),
}

def durability_barrier(label, path):
    fd = os.open(path, os.O_RDONLY)
    try:
        try:
            os.fsync(fd)
        except OSError as error:
            if error.errno not in unsupported_fsync:
                raise
    finally:
        os.close(fd)

def lexists(path):
    try:
        os.lstat(path)
        return True
    except FileNotFoundError:
        return False

def read_lock(path):
    flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
    fd = os.open(path, flags)
    try:
        before = os.fstat(fd)
        path_before = os.lstat(path)
        actual = os.read(fd, len(token_bytes) + 1)
        after = os.fstat(fd)
        path_after = os.lstat(path)
    finally:
        os.close(fd)
    stable = (
        stat.S_ISREG(before.st_mode)
        and stat.S_ISREG(path_before.st_mode)
        and stat.S_ISREG(after.st_mode)
        and stat.S_ISREG(path_after.st_mode)
        and before.st_nlink > 0
        and (before.st_dev, before.st_ino) == (path_before.st_dev, path_before.st_ino)
        and (before.st_dev, before.st_ino) == (after.st_dev, after.st_ino)
        and (after.st_dev, after.st_ino) == (path_after.st_dev, path_after.st_ino)
        and before.st_size == after.st_size == path_after.st_size
        and before.st_mtime_ns == after.st_mtime_ns == path_after.st_mtime_ns
        and before.st_ctime_ns == after.st_ctime_ns == path_after.st_ctime_ns
    )
    return after, actual, stable

def expected_lock(path):
    value, actual, stable = read_lock(path)
    return (
        stable
        and (value.st_dev, value.st_ino) == (expected_dev, expected_ino)
        and actual == token_bytes
    )

def link_without_overwrite(source_path):
    source_before = os.lstat(source_path)
    if not stat.S_ISREG(source_before.st_mode):
        return False
    try:
        os.link(source_path, lock_path, follow_symlinks=False)
    except FileExistsError:
        return False
    source_after = os.lstat(source_path)
    public_after = os.lstat(lock_path)
    if (
        not stat.S_ISREG(source_after.st_mode)
        or not stat.S_ISREG(public_after.st_mode)
        or (source_before.st_dev, source_before.st_ino) != (source_after.st_dev, source_after.st_ino)
        or (source_after.st_dev, source_after.st_ino) != (public_after.st_dev, public_after.st_ino)
    ):
        return False
    try:
        durability_barrier('failure-restore-parent', install_dir)
    except OSError:
        # The public name exists in the live namespace. Preserve every anchor
        # and the original exception so manual recovery still has all evidence.
        pass
    return True

def restore_owned_without_overwrite(source_path):
    if not expected_lock(source_path):
        return False
    if not link_without_overwrite(source_path):
        return False
    return expected_lock(lock_path)

if lexists(release_dir) or lexists(anchor_path):
    raise SystemExit('lock release recovery path already exists')

# Keep a stable hard-link anchor until every rename, directory fsync, held-link
# unlink, tombstone rmdir, and parent fsync has succeeded. Thus every failure
# before the final anchor unlink can restore the owned public lock without
# touching a successor.
os.link(lock_path, anchor_path, follow_symlinks=False)
if not expected_lock(anchor_path):
    raise SystemExit('native update lock changed before release anchoring')
durability_barrier('anchor-parent', install_dir)
os.mkdir(release_dir, 0o700)
durability_barrier('release-dir-parent', install_dir)

held_path = os.path.join(release_dir, 'owned.lock')
try:
    # Rename first and validate the moved inode afterwards. If a successor won
    # the race, restore it without overwriting any newer public lock and retain
    # both the tombstone and our original anchor as evidence.
    os.rename(lock_path, held_path)
    if not expected_lock(held_path):
        link_without_overwrite(held_path)
        raise SystemExit('refusing to delete a successor native update lock')
    durability_barrier('renamed-release-dir', release_dir)
    durability_barrier('renamed-parent', install_dir)
    os.unlink(held_path)
    durability_barrier('unlinked-release-dir', release_dir)
    os.rmdir(release_dir)
    durability_barrier('removed-release-dir-parent', install_dir)
    try:
        # This is deliberately the final fallible operation. The parent was
        # already synchronized with no public lock and no tombstone directory;
        # a crash may conservatively resurrect this private anchor, never grant
        # two owners. An unlink failure restores the public lock and is reported.
        os.unlink(anchor_path)
        durability_barrier('anchor-removed-parent', install_dir)
    except OSError:
        if lexists(anchor_path):
            restore_owned_without_overwrite(anchor_path)
        raise
finally:
    if lexists(held_path):
        try:
            if expected_lock(held_path):
                restore_owned_without_overwrite(held_path)
            else:
                link_without_overwrite(held_path)
        except OSError:
            pass
    elif lexists(anchor_path):
        try:
            restore_owned_without_overwrite(anchor_path)
        except OSError:
            pass
PY
  release_status=$?
  if [ "$release_status" -eq 0 ]; then
    LOCK_RELEASE_DIR=""
    LOCK_ANCHOR_PATH=""
  fi
  return "$release_status"
}

write_lineage() {
  current_sha=$1
  previous_sha=$2
  operation=$3
  python3 - "write-lineage" "$LINEAGE_PATH" "$TRANSACTION_ID" "$operation" "$current_sha" "$previous_sha" <<'PY'
import errno, hashlib, json, os, stat, sys, tempfile
marker, lineage_path, transaction_id, operation, current_sha, previous_sha = sys.argv[1:]
if marker != 'write-lineage':
    raise SystemExit('invalid lineage writer invocation')
directory = os.path.dirname(lineage_path)
payload = {
    'schema': 'chainlesschain.native-update-lineage.v1',
    'transactionId': transaction_id,
    'operation': operation,
    'currentSha256': current_sha,
    'previousSha256': None if previous_sha == 'null' else previous_sha,
    'updatedAt': __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat().replace('+00:00', 'Z'),
}
payload_bytes = (json.dumps(payload, separators=(',', ':')) + '\n').encode('utf-8')
fd, staging = tempfile.mkstemp(prefix='.chainlesschain.lineage.', dir=directory)
held_fd = -1
try:
    with os.fdopen(fd, 'wb') as stream:
        fd = -1
        stream.write(payload_bytes)
        stream.flush()
        os.fsync(stream.fileno())
    held_fd = os.open(staging, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    held_before = os.fstat(held_fd)
    if not stat.S_ISREG(held_before.st_mode) or (held_before.st_dev == 0 and held_before.st_ino == 0):
        raise SystemExit('lineage staging file has no stable identity')
    os.replace(staging, lineage_path)
    published = os.lstat(lineage_path)
    held_after = os.fstat(held_fd)
    if (
        not stat.S_ISREG(published.st_mode)
        or (held_before.st_dev, held_before.st_ino) != (held_after.st_dev, held_after.st_ino)
        or (held_after.st_dev, held_after.st_ino) != (published.st_dev, published.st_ino)
        or held_before.st_size != held_after.st_size
        or held_after.st_size != len(payload_bytes)
    ):
        raise SystemExit('published lineage changed at the commit boundary')
    # Emit exact rollback metadata before the directory barrier. If that barrier
    # fails after os.replace(), the caller can still distinguish this generation
    # from an identically-shaped successor and fail closed during rollback.
    print(
        f'{held_after.st_dev}:{held_after.st_ino}:{held_after.st_mode} '
        f'{hashlib.sha256(payload_bytes).hexdigest()}',
        flush=True,
    )
    dir_fd = os.open(directory, os.O_RDONLY)
    try:
        try:
            os.fsync(dir_fd)
        except OSError as error:
            unsupported = {
                errno.EBADF,
                errno.EINVAL,
                getattr(errno, 'ENOTSUP', errno.EINVAL),
                getattr(errno, 'EOPNOTSUPP', errno.EINVAL),
            }
            if error.errno not in unsupported:
                raise
    finally:
        os.close(dir_fd)
except BaseException:
    try:
        os.unlink(staging)
    except FileNotFoundError:
        pass
    raise
finally:
    if fd >= 0:
        os.close(fd)
    if held_fd >= 0:
        os.close(held_fd)
PY
}

commit_lineage() {
  lineage_current_sha=$1
  lineage_previous_sha=$2
  lineage_operation=$3
  lineage_metadata=""
  lineage_status=0
  if lineage_metadata=$(write_lineage "$lineage_current_sha" "$lineage_previous_sha" "$lineage_operation"); then
    :
  else
    lineage_status=$?
  fi
  if [ -n "$lineage_metadata" ] && [ "${lineage_metadata#* }" != "$lineage_metadata" ]; then
    INSTALLED_LINEAGE_IDENTITY=${lineage_metadata%% *}
    INSTALLED_LINEAGE_SHA256=${lineage_metadata#* }
  fi
  [ "$lineage_status" -eq 0 ] || return "$lineage_status"
  [ -n "$INSTALLED_LINEAGE_IDENTITY" ] && [ -n "$INSTALLED_LINEAGE_SHA256" ] || return 1
  lineage_matches_transaction "$lineage_current_sha" "$lineage_previous_sha" "$INSTALLED_LINEAGE_IDENTITY" "$INSTALLED_LINEAGE_SHA256"
}

lineage_matches_transaction() {
  expected_current_sha=$1
  expected_previous_sha=$2
  expected_identity=$3
  expected_lineage_sha=$4
  [ -n "$expected_identity" ] && [ -n "$expected_lineage_sha" ] || return 1
  python3 - "$TRANSACTION_ID" "$LINEAGE_PATH" "$expected_current_sha" "$expected_previous_sha" "$expected_identity" "$expected_lineage_sha" <<'PY'
import hashlib, json, os, stat, sys

(
    transaction_id,
    lineage_path,
    expected_current_sha,
    expected_previous_sha,
    expected_identity,
    expected_lineage_sha,
) = sys.argv[1:]
flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
try:
    fd = os.open(lineage_path, flags)
except FileNotFoundError:
    raise SystemExit(1)
try:
    before = os.fstat(fd)
    path_before = os.lstat(lineage_path)
    blocks = []
    while True:
        block = os.read(fd, 1024 * 1024)
        if not block:
            break
        blocks.append(block)
    payload = b''.join(blocks)
    after = os.fstat(fd)
    path_after = os.lstat(lineage_path)
finally:
    os.close(fd)
identity = f'{after.st_dev}:{after.st_ino}:{after.st_mode}'
stable = (
    stat.S_ISREG(before.st_mode)
    and stat.S_ISREG(path_before.st_mode)
    and stat.S_ISREG(after.st_mode)
    and stat.S_ISREG(path_after.st_mode)
    and before.st_nlink > 0
    and (before.st_dev, before.st_ino) == (path_before.st_dev, path_before.st_ino)
    and (before.st_dev, before.st_ino) == (after.st_dev, after.st_ino)
    and (after.st_dev, after.st_ino) == (path_after.st_dev, path_after.st_ino)
    and before.st_size == after.st_size == path_after.st_size
    and before.st_mtime_ns == after.st_mtime_ns == path_after.st_mtime_ns
    and before.st_ctime_ns == after.st_ctime_ns == path_after.st_ctime_ns
)
try:
    value = json.loads(payload)
except Exception:
    raise SystemExit(1)
expected_previous = None if expected_previous_sha == 'null' else expected_previous_sha
valid = (
    stable
    and identity == expected_identity
    and hashlib.sha256(payload).hexdigest() == expected_lineage_sha
    and isinstance(value, dict)
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

regular_file_matches() {
  python3 - "$1" "$2" "$3" <<'PY'
import hashlib, os, stat, sys
path, expected_sha, expected_identity = sys.argv[1:]
flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
try:
    fd = os.open(path, flags)
except (FileNotFoundError, OSError):
    raise SystemExit(1)
try:
    before = os.fstat(fd)
    path_before = os.lstat(path)
    digest = hashlib.sha256()
    for block in iter(lambda: os.read(fd, 1024 * 1024), b''):
        digest.update(block)
    after = os.fstat(fd)
    path_after = os.lstat(path)
finally:
    os.close(fd)
identity = f'{after.st_dev}:{after.st_ino}:{after.st_mode}'
stable = (
    stat.S_ISREG(before.st_mode)
    and stat.S_ISREG(path_before.st_mode)
    and stat.S_ISREG(after.st_mode)
    and stat.S_ISREG(path_after.st_mode)
    and before.st_nlink > 0
    and (before.st_dev, before.st_ino) == (path_before.st_dev, path_before.st_ino)
    and (before.st_dev, before.st_ino) == (after.st_dev, after.st_ino)
    and (after.st_dev, after.st_ino) == (path_after.st_dev, path_after.st_ino)
    and before.st_size == after.st_size == path_after.st_size
    and before.st_mtime_ns == after.st_mtime_ns == path_after.st_mtime_ns
    and before.st_ctime_ns == after.st_ctime_ns == path_after.st_ctime_ns
)
raise SystemExit(0 if stable and digest.hexdigest() == expected_sha and identity == expected_identity else 1)
PY
}

snapshot_alias() {
  python3 - "$1" "$2" <<'PY'
import hashlib, os, stat, sys
source, snapshot = sys.argv[1:]
before = os.lstat(source)
if not stat.S_ISLNK(before.st_mode):
    raise SystemExit('CLI alias changed before it could be snapshotted')
target = os.readlink(source)
after = os.lstat(source)
stable = (
    stat.S_ISLNK(after.st_mode)
    and (before.st_dev, before.st_ino) == (after.st_dev, after.st_ino)
    and before.st_size == after.st_size
    and before.st_mtime_ns == after.st_mtime_ns
    and before.st_ctime_ns == after.st_ctime_ns
)
if not stable:
    raise SystemExit('CLI alias changed while it was being snapshotted')
os.symlink(target, snapshot)
if os.readlink(snapshot) != target:
    raise SystemExit('CLI alias recovery snapshot changed during creation')
print(hashlib.sha256(os.fsencode(target)).hexdigest())
PY
}

alias_matches_hash() {
  python3 - "$1" "$2" <<'PY'
import hashlib, os, stat, sys
alias_path, expected_hash = sys.argv[1:]
try:
    alias_stat = os.lstat(alias_path)
except FileNotFoundError:
    raise SystemExit(1)
if not stat.S_ISLNK(alias_stat.st_mode):
    raise SystemExit(1)
actual_hash = hashlib.sha256(os.fsencode(os.readlink(alias_path))).hexdigest()
raise SystemExit(0 if actual_hash == expected_hash else 1)
PY
}

symlink_identity() {
  python3 - "$1" <<'PY'
import os, stat, sys
path = sys.argv[1]
before = os.lstat(path)
if not stat.S_ISLNK(before.st_mode) or (before.st_dev == 0 and before.st_ino == 0):
    raise SystemExit('symlink has no stable identity')
os.readlink(path)
after = os.lstat(path)
if (
    not stat.S_ISLNK(after.st_mode)
    or (before.st_dev, before.st_ino) != (after.st_dev, after.st_ino)
    or before.st_size != after.st_size
    or before.st_mtime_ns != after.st_mtime_ns
    or before.st_ctime_ns != after.st_ctime_ns
):
    raise SystemExit('symlink changed while its identity was captured')
print(f'{after.st_dev}:{after.st_ino}:{after.st_mode}')
PY
}

alias_matches_identity() {
  python3 - "$1" "$2" "$3" <<'PY'
import hashlib, os, stat, sys
path, expected_hash, expected_identity = sys.argv[1:]
try:
    before = os.lstat(path)
    target = os.readlink(path)
    after = os.lstat(path)
except (FileNotFoundError, OSError):
    raise SystemExit(1)
identity = f'{after.st_dev}:{after.st_ino}:{after.st_mode}'
stable = (
    stat.S_ISLNK(before.st_mode)
    and stat.S_ISLNK(after.st_mode)
    and (before.st_dev, before.st_ino) == (after.st_dev, after.st_ino)
    and before.st_size == after.st_size
    and before.st_mtime_ns == after.st_mtime_ns
    and before.st_ctime_ns == after.st_ctime_ns
)
raise SystemExit(
    0
    if stable
    and identity == expected_identity
    and hashlib.sha256(os.fsencode(target)).hexdigest() == expected_hash
    else 1
)
PY
}

create_alias_restore_candidate() {
  python3 - "$1" "$2" "$3" <<'PY'
import hashlib, os, stat, sys
snapshot_path, restore_path, expected_hash = sys.argv[1:]
value = os.lstat(snapshot_path)
if not stat.S_ISLNK(value.st_mode):
    raise SystemExit('CLI alias recovery snapshot is not a symlink')
target = os.readlink(snapshot_path)
if hashlib.sha256(os.fsencode(target)).hexdigest() != expected_hash:
    raise SystemExit('CLI alias recovery snapshot target changed')
os.symlink(target, restore_path)
if hashlib.sha256(os.fsencode(os.readlink(restore_path))).hexdigest() != expected_hash:
    raise SystemExit('CLI alias restore candidate changed during creation')
PY
}

create_recovery_state() {
  python3 - \
    "$RECOVERY_STATE_PATH" \
    "$TRANSACTION_ID" \
    "$PRIOR_TARGET_PATH" \
    "$OLD_TARGET_SHA256" \
    "$OLD_TARGET_IDENTITY" \
    "$PRIOR_BACKUP_PATH" \
    "$OLD_BACKUP_SHA256" \
    "$OLD_BACKUP_IDENTITY" \
    "$PRIOR_LINEAGE_PATH" \
    "$OLD_LINEAGE_SHA256" \
    "$OLD_LINEAGE_IDENTITY" \
    "$PRIOR_ALIAS_PATH" \
    "$OLD_ALIAS_TARGET_SHA256" <<'PY'
import json, os, sys

(
    state_path,
    transaction_id,
    prior_target_path,
    old_target_sha,
    old_target_identity,
    prior_backup_path,
    old_backup_sha,
    old_backup_identity,
    prior_lineage_path,
    old_lineage_sha,
    old_lineage_identity,
    prior_alias_path,
    old_alias_target_sha,
) = sys.argv[1:]
payload = {
    'schema': 'chainlesschain.native-install-recovery.v1',
    'transactionId': transaction_id,
    'members': {
        'priorTarget': {
            'path': prior_target_path or None,
            'sha256': old_target_sha or None,
            'identity': old_target_identity or None,
        },
        'priorBackup': {
            'path': prior_backup_path or None,
            'sha256': old_backup_sha or None,
            'identity': old_backup_identity or None,
        },
        'priorLineage': {
            'path': prior_lineage_path or None,
            'sha256': old_lineage_sha or None,
            'identity': old_lineage_identity or None,
        },
        'priorAlias': {
            'path': prior_alias_path or None,
            'targetSha256': old_alias_target_sha or None,
        },
    },
}
flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, 'O_NOFOLLOW', 0)
fd = os.open(state_path, flags, 0o600)
try:
    with os.fdopen(fd, 'w', encoding='utf-8') as stream:
        json.dump(payload, stream, separators=(',', ':'), sort_keys=True)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
except BaseException:
    try:
        os.unlink(state_path)
    except FileNotFoundError:
        pass
    raise
PY
  fsync_dir "$INSTALL_DIR"
}

process_recovery_state() {
  recovery_action=$1
  python3 - \
    "recovery-state" \
    "$recovery_action" \
    "$RECOVERY_STATE_PATH" \
    "$RECOVERY_RETIRED_PATH" \
    "$INSTALL_DIR" \
    "$TRANSACTION_ID" \
    "$PRIOR_TARGET_PATH" \
    "$OLD_TARGET_SHA256" \
    "$OLD_TARGET_IDENTITY" \
    "$PRIOR_BACKUP_PATH" \
    "$OLD_BACKUP_SHA256" \
    "$OLD_BACKUP_IDENTITY" \
    "$PRIOR_LINEAGE_PATH" \
    "$OLD_LINEAGE_SHA256" \
    "$OLD_LINEAGE_IDENTITY" \
    "$PRIOR_ALIAS_PATH" \
    "$OLD_ALIAS_TARGET_SHA256" <<'PY'
import errno, hashlib, json, os, stat, sys

(
    marker,
    action,
    state_path,
    retired_path,
    directory,
    transaction_id,
    prior_target_path,
    old_target_sha,
    old_target_identity,
    prior_backup_path,
    old_backup_sha,
    old_backup_identity,
    prior_lineage_path,
    old_lineage_sha,
    old_lineage_identity,
    prior_alias_path,
    old_alias_target_sha,
) = sys.argv[1:]
if marker != 'recovery-state' or action not in ('validate', 'retire'):
    raise SystemExit('invalid recovery-state invocation')

unsupported = {
    errno.EBADF,
    errno.EINVAL,
    getattr(errno, 'ENOTSUP', errno.EINVAL),
    getattr(errno, 'EOPNOTSUPP', errno.EINVAL),
}

def recovery_barrier(label, path):
    fd = os.open(path, os.O_RDONLY)
    try:
        try:
            os.fsync(fd)
        except OSError as error:
            if error.errno not in unsupported:
                raise
    finally:
        os.close(fd)

def read_fd(fd):
    os.lseek(fd, 0, os.SEEK_SET)
    blocks = []
    while True:
        block = os.read(fd, 1024 * 1024)
        if not block:
            return b''.join(blocks)
        blocks.append(block)

def regular_metadata(path):
    flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
    fd = os.open(path, flags)
    try:
        before = os.fstat(fd)
        path_before = os.lstat(path)
        payload = read_fd(fd)
        after = os.fstat(fd)
        path_after = os.lstat(path)
    finally:
        os.close(fd)
    stable = (
        stat.S_ISREG(before.st_mode)
        and stat.S_ISREG(path_before.st_mode)
        and stat.S_ISREG(after.st_mode)
        and stat.S_ISREG(path_after.st_mode)
        and before.st_nlink > 0
        and (before.st_dev, before.st_ino) == (path_before.st_dev, path_before.st_ino)
        and (before.st_dev, before.st_ino) == (after.st_dev, after.st_ino)
        and (after.st_dev, after.st_ino) == (path_after.st_dev, path_after.st_ino)
        and before.st_size == after.st_size == path_after.st_size
        and before.st_mtime_ns == after.st_mtime_ns == path_after.st_mtime_ns
        and before.st_ctime_ns == after.st_ctime_ns == path_after.st_ctime_ns
    )
    if not stable:
        raise SystemExit('recovery member changed while it was validated')
    return hashlib.sha256(payload).hexdigest(), f'{after.st_dev}:{after.st_ino}:{after.st_mode}'

expected = {
    'schema': 'chainlesschain.native-install-recovery.v1',
    'transactionId': transaction_id,
    'members': {
        'priorTarget': {
            'path': prior_target_path or None,
            'sha256': old_target_sha or None,
            'identity': old_target_identity or None,
        },
        'priorBackup': {
            'path': prior_backup_path or None,
            'sha256': old_backup_sha or None,
            'identity': old_backup_identity or None,
        },
        'priorLineage': {
            'path': prior_lineage_path or None,
            'sha256': old_lineage_sha or None,
            'identity': old_lineage_identity or None,
        },
        'priorAlias': {
            'path': prior_alias_path or None,
            'targetSha256': old_alias_target_sha or None,
        },
    },
}
expected_bytes = (json.dumps(expected, separators=(',', ':'), sort_keys=True) + '\n').encode('utf-8')
state_flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
state_fd = os.open(state_path, state_flags)
try:
    state_before = os.fstat(state_fd)
    state_path_before = os.lstat(state_path)
    state_bytes = read_fd(state_fd)
    state_after = os.fstat(state_fd)
    state_path_after = os.lstat(state_path)
    state_stable = (
        stat.S_ISREG(state_before.st_mode)
        and stat.S_ISREG(state_path_before.st_mode)
        and (state_before.st_dev, state_before.st_ino) == (state_path_before.st_dev, state_path_before.st_ino)
        and (state_before.st_dev, state_before.st_ino) == (state_after.st_dev, state_after.st_ino)
        and (state_after.st_dev, state_after.st_ino) == (state_path_after.st_dev, state_path_after.st_ino)
        and state_before.st_size == state_after.st_size == state_path_after.st_size
        and state_before.st_mtime_ns == state_after.st_mtime_ns == state_path_after.st_mtime_ns
    )
    if not state_stable or state_bytes != expected_bytes:
        raise SystemExit('native recovery-state pointer changed')
    if json.loads(state_bytes) != expected:
        raise SystemExit('native recovery-state pointer is not canonical')

    for name in ('priorTarget', 'priorBackup', 'priorLineage'):
        member = expected['members'][name]
        if member['path'] is None:
            continue
        actual_sha, actual_identity = regular_metadata(member['path'])
        if actual_sha != member['sha256'] or actual_identity != member['identity']:
            raise SystemExit(f'{name} recovery member changed')
    alias = expected['members']['priorAlias']
    if alias['path'] is not None:
        alias_before = os.lstat(alias['path'])
        target = os.readlink(alias['path'])
        alias_after = os.lstat(alias['path'])
        if (
            not stat.S_ISLNK(alias_before.st_mode)
            or not stat.S_ISLNK(alias_after.st_mode)
            or (alias_before.st_dev, alias_before.st_ino) != (alias_after.st_dev, alias_after.st_ino)
            or hashlib.sha256(os.fsencode(target)).hexdigest() != alias['targetSha256']
        ):
            raise SystemExit('priorAlias recovery target changed')

    if action == 'retire':
        # The same O_NOFOLLOW descriptor stays open across validation and
        # publication. The no-replace hard link must resolve to this exact inode
        # and canonical byte stream before any active pointer is unlinked.
        os.link(state_path, retired_path, follow_symlinks=False)
        retired_fd = os.open(retired_path, state_flags)
        try:
            retired_value = os.fstat(retired_fd)
            retired_path_value = os.lstat(retired_path)
            retired_bytes = read_fd(retired_fd)
            active_now = os.lstat(state_path)
            fd_now = os.fstat(state_fd)
            same_pointer = (
                (state_before.st_dev, state_before.st_ino) == (fd_now.st_dev, fd_now.st_ino)
                and (fd_now.st_dev, fd_now.st_ino) == (active_now.st_dev, active_now.st_ino)
                and (fd_now.st_dev, fd_now.st_ino) == (retired_value.st_dev, retired_value.st_ino)
                and (retired_value.st_dev, retired_value.st_ino) == (retired_path_value.st_dev, retired_path_value.st_ino)
                and retired_bytes == state_bytes == expected_bytes
            )
            if not same_pointer:
                raise SystemExit('retired recovery-state pointer changed identity or content')
            recovery_barrier('retired-published', directory)
            active_now = os.lstat(state_path)
            retired_now = os.lstat(retired_path)
            fd_now = os.fstat(state_fd)
            retired_fd_now = os.fstat(retired_fd)
            active_bytes_now = read_fd(state_fd)
            retired_bytes_now = read_fd(retired_fd)
            if (
                (active_now.st_dev, active_now.st_ino) != (fd_now.st_dev, fd_now.st_ino)
                or (retired_now.st_dev, retired_now.st_ino) != (retired_fd_now.st_dev, retired_fd_now.st_ino)
                or (fd_now.st_dev, fd_now.st_ino) != (retired_fd_now.st_dev, retired_fd_now.st_ino)
                or active_bytes_now != expected_bytes
                or retired_bytes_now != expected_bytes
            ):
                raise SystemExit('active or retired recovery-state pointer changed before retirement')
            os.unlink(state_path)
            recovery_barrier('active-removed', directory)
        finally:
            os.close(retired_fd)
finally:
    os.close(state_fd)
PY
}

discard_transaction_snapshots() {
  if [ -z "$PRIOR_TARGET_PATH" ] && [ -z "$PRIOR_BACKUP_PATH" ] && [ -z "$PRIOR_LINEAGE_PATH" ] && [ -z "$PRIOR_ALIAS_PATH" ]; then
    if [ -n "$BACKUP_TEMP_PATH" ] && { [ -e "$BACKUP_TEMP_PATH" ] || [ -L "$BACKUP_TEMP_PATH" ]; }; then
      assert_lock_owned || return 1
      rm -f "$BACKUP_TEMP_PATH" || return 1
      fsync_dir "$INSTALL_DIR" || return 1
    fi
    BACKUP_TEMP_PATH=""
    RECOVERY_STATE_PATH=""
    RECOVERY_RETIRED_PATH=""
    RECOVERY_RETIRED=0
    return 0
  fi
  [ -n "$RECOVERY_STATE_PATH" ] || return 1
  [ -n "$RECOVERY_RETIRED_PATH" ] || return 1
  assert_lock_owned || return 1
  process_recovery_state retire || return 1
  RECOVERY_RETIRED=1
  removed=0
  for snapshot_path in \
    "$BACKUP_TEMP_PATH" \
    "$PRIOR_TARGET_PATH" \
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
  assert_lock_owned || return 1
  rm -f "$RECOVERY_RETIRED_PATH" || return 1
  fsync_dir "$INSTALL_DIR" || return 1
  BACKUP_TEMP_PATH=""
  PRIOR_TARGET_PATH=""
  PRIOR_BACKUP_PATH=""
  PRIOR_LINEAGE_PATH=""
  PRIOR_ALIAS_PATH=""
  RECOVERY_STATE_PATH=""
  RECOVERY_RETIRED_PATH=""
  RECOVERY_RETIRED=0
}

validate_rollback_public_state() {
  assert_lock_owned || return 1
  if [ -n "$RECOVERY_STATE_PATH" ]; then
    process_recovery_state validate || return 1
  fi
  [ -n "$INSTALLED_TARGET_IDENTITY" ] || return 1
  regular_file_matches "$TARGET_PATH" "$ARTIFACT_SHA256" "$INSTALLED_TARGET_IDENTITY" || return 1

  if [ "$BACKUP_COMMITTED" -eq 1 ]; then
    [ -n "$OLD_TARGET_IDENTITY" ] || return 1
    regular_file_matches "$BACKUP_PATH" "$OLD_TARGET_SHA256" "$OLD_TARGET_IDENTITY" || return 1
  fi

  if [ "$LINEAGE_COMMIT_STARTED" -eq 1 ]; then
    lineage_previous_sha=null
    if [ "$HAD_TARGET" -eq 1 ]; then
      lineage_previous_sha=$OLD_TARGET_SHA256
    fi
    if [ "$HAD_LINEAGE" -eq 1 ]; then
      if regular_file_matches "$LINEAGE_PATH" "$OLD_LINEAGE_SHA256" "$OLD_LINEAGE_IDENTITY"; then
        :
      else
        lineage_matches_transaction "$ARTIFACT_SHA256" "$lineage_previous_sha" "$INSTALLED_LINEAGE_IDENTITY" "$INSTALLED_LINEAGE_SHA256" || return 1
      fi
    elif [ -e "$LINEAGE_PATH" ] || [ -L "$LINEAGE_PATH" ]; then
      lineage_matches_transaction "$ARTIFACT_SHA256" "$lineage_previous_sha" "$INSTALLED_LINEAGE_IDENTITY" "$INSTALLED_LINEAGE_SHA256" || return 1
    fi
  fi

  if [ "$ALIAS_COMMITTED" -eq 1 ]; then
    [ -n "$INSTALLED_ALIAS_IDENTITY" ] || return 1
    alias_matches_identity "$ALIAS_PATH" "$CANONICAL_ALIAS_TARGET_SHA256" "$INSTALLED_ALIAS_IDENTITY" || return 1
  fi
}

rollback_install() {
  assert_lock_owned || return 1
  validate_rollback_public_state || return 1
  if [ "$HAD_TARGET" -eq 1 ]; then
    [ -n "$PRIOR_TARGET_PATH" ] || return 1
    regular_file_matches "$PRIOR_TARGET_PATH" "$OLD_TARGET_SHA256" "$OLD_TARGET_IDENTITY" || return 1
    ROLLBACK_TEMP_PATH="$INSTALL_DIR/.chainlesschain.rollback-$TRANSACTION_ID"
    [ ! -e "$ROLLBACK_TEMP_PATH" ] && [ ! -L "$ROLLBACK_TEMP_PATH" ] || return 1
    ln "$PRIOR_TARGET_PATH" "$ROLLBACK_TEMP_PATH" || return 1
    regular_file_matches "$ROLLBACK_TEMP_PATH" "$OLD_TARGET_SHA256" "$OLD_TARGET_IDENTITY" || return 1
    assert_lock_owned || return 1
    regular_file_matches "$TARGET_PATH" "$ARTIFACT_SHA256" "$INSTALLED_TARGET_IDENTITY" || return 1
    mv -f "$ROLLBACK_TEMP_PATH" "$TARGET_PATH" || return 1
    ROLLBACK_TEMP_PATH=""
    regular_file_matches "$TARGET_PATH" "$OLD_TARGET_SHA256" "$OLD_TARGET_IDENTITY" || return 1
  else
    assert_lock_owned || return 1
    regular_file_matches "$TARGET_PATH" "$ARTIFACT_SHA256" "$INSTALLED_TARGET_IDENTITY" || return 1
    rm -f "$TARGET_PATH" || return 1
    [ ! -e "$TARGET_PATH" ] && [ ! -L "$TARGET_PATH" ] || return 1
  fi

  if [ "$BACKUP_COMMITTED" -eq 1 ]; then
    if [ "$HAD_BACKUP" -eq 1 ]; then
      [ -n "$PRIOR_BACKUP_PATH" ] || return 1
      regular_file_matches "$PRIOR_BACKUP_PATH" "$OLD_BACKUP_SHA256" "$OLD_BACKUP_IDENTITY" || return 1
      BACKUP_RESTORE_PATH="$INSTALL_DIR/.chainlesschain.backup-restore-$TRANSACTION_ID"
      [ ! -e "$BACKUP_RESTORE_PATH" ] && [ ! -L "$BACKUP_RESTORE_PATH" ] || return 1
      ln "$PRIOR_BACKUP_PATH" "$BACKUP_RESTORE_PATH" || return 1
      regular_file_matches "$BACKUP_RESTORE_PATH" "$OLD_BACKUP_SHA256" "$OLD_BACKUP_IDENTITY" || return 1
      assert_lock_owned || return 1
      regular_file_matches "$BACKUP_PATH" "$OLD_TARGET_SHA256" "$OLD_TARGET_IDENTITY" || return 1
      mv -f "$BACKUP_RESTORE_PATH" "$BACKUP_PATH" || return 1
      BACKUP_RESTORE_PATH=""
      regular_file_matches "$BACKUP_PATH" "$OLD_BACKUP_SHA256" "$OLD_BACKUP_IDENTITY" || return 1
    else
      assert_lock_owned || return 1
      regular_file_matches "$BACKUP_PATH" "$OLD_TARGET_SHA256" "$OLD_TARGET_IDENTITY" || return 1
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
      regular_file_matches "$PRIOR_LINEAGE_PATH" "$OLD_LINEAGE_SHA256" "$OLD_LINEAGE_IDENTITY" || return 1
      assert_regular_file_or_missing "$LINEAGE_PATH" "native update lineage" || return 1
      lineage_is_prior=0
      if regular_file_matches "$LINEAGE_PATH" "$OLD_LINEAGE_SHA256" "$OLD_LINEAGE_IDENTITY"; then
        lineage_is_prior=1
      fi
      if [ "$lineage_is_prior" -eq 0 ]; then
        lineage_previous_sha=null
        if [ "$HAD_TARGET" -eq 1 ]; then
          lineage_previous_sha=$OLD_TARGET_SHA256
        fi
        lineage_matches_transaction "$ARTIFACT_SHA256" "$lineage_previous_sha" "$INSTALLED_LINEAGE_IDENTITY" "$INSTALLED_LINEAGE_SHA256" || return 1
        LINEAGE_RESTORE_PATH="$INSTALL_DIR/.chainlesschain.lineage-restore-$TRANSACTION_ID"
        [ ! -e "$LINEAGE_RESTORE_PATH" ] && [ ! -L "$LINEAGE_RESTORE_PATH" ] || return 1
        ln "$PRIOR_LINEAGE_PATH" "$LINEAGE_RESTORE_PATH" || return 1
        regular_file_matches "$LINEAGE_RESTORE_PATH" "$OLD_LINEAGE_SHA256" "$OLD_LINEAGE_IDENTITY" || return 1
        assert_lock_owned || return 1
        lineage_matches_transaction "$ARTIFACT_SHA256" "$lineage_previous_sha" "$INSTALLED_LINEAGE_IDENTITY" "$INSTALLED_LINEAGE_SHA256" || return 1
        # mv(1) maps to rename(2) for these same-directory paths, so the old
        # public lineage remains continuously present if replacement fails.
        mv -f "$LINEAGE_RESTORE_PATH" "$LINEAGE_PATH" || return 1
        LINEAGE_RESTORE_PATH=""
        regular_file_matches "$LINEAGE_PATH" "$OLD_LINEAGE_SHA256" "$OLD_LINEAGE_IDENTITY" || return 1
      fi
    else
      assert_regular_file_or_missing "$LINEAGE_PATH" "native update lineage" || return 1
      if [ -f "$LINEAGE_PATH" ]; then
        lineage_previous_sha=null
        if [ "$HAD_TARGET" -eq 1 ]; then
          lineage_previous_sha=$OLD_TARGET_SHA256
        fi
        lineage_matches_transaction "$ARTIFACT_SHA256" "$lineage_previous_sha" "$INSTALLED_LINEAGE_IDENTITY" "$INSTALLED_LINEAGE_SHA256" || return 1
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
      [ -n "$OLD_ALIAS_TARGET_SHA256" ] || return 1
      alias_matches_hash "$PRIOR_ALIAS_PATH" "$OLD_ALIAS_TARGET_SHA256" || return 1
      ALIAS_RESTORE_PATH="$INSTALL_DIR/.cc.restore-$TRANSACTION_ID"
      [ ! -e "$ALIAS_RESTORE_PATH" ] && [ ! -L "$ALIAS_RESTORE_PATH" ] || return 1
      create_alias_restore_candidate "$PRIOR_ALIAS_PATH" "$ALIAS_RESTORE_PATH" "$OLD_ALIAS_TARGET_SHA256" || return 1
      alias_matches_hash "$ALIAS_RESTORE_PATH" "$OLD_ALIAS_TARGET_SHA256" || return 1
      assert_lock_owned || return 1
      alias_matches_identity "$ALIAS_PATH" "$CANONICAL_ALIAS_TARGET_SHA256" "$INSTALLED_ALIAS_IDENTITY" || return 1
      mv -f "$ALIAS_RESTORE_PATH" "$ALIAS_PATH" || return 1
      ALIAS_RESTORE_PATH=""
      alias_matches_hash "$ALIAS_PATH" "$OLD_ALIAS_TARGET_SHA256" || return 1
    else
      alias_matches_identity "$ALIAS_PATH" "$CANONICAL_ALIAS_TARGET_SHA256" "$INSTALLED_ALIAS_IDENTITY" || return 1
      assert_lock_owned || return 1
      alias_matches_identity "$ALIAS_PATH" "$CANONICAL_ALIAS_TARGET_SHA256" "$INSTALLED_ALIAS_IDENTITY" || return 1
      rm -f "$ALIAS_PATH" || return 1
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
CANONICAL_ALIAS_TARGET_SHA256=$(python3 -c "import hashlib; print(hashlib.sha256(b'chainlesschain').hexdigest())")
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
  OLD_ALIAS_IDENTITY=$(symlink_identity "$ALIAS_PATH")
  PRIOR_ALIAS_PATH="$INSTALL_DIR/.cc.prior-$TRANSACTION_ID"
  [ ! -e "$PRIOR_ALIAS_PATH" ] && [ ! -L "$PRIOR_ALIAS_PATH" ] || die "alias recovery snapshot path already exists"
  OLD_ALIAS_TARGET_SHA256=$(snapshot_alias "$ALIAS_PATH" "$PRIOR_ALIAS_PATH")
  alias_matches_identity "$ALIAS_PATH" "$OLD_ALIAS_TARGET_SHA256" "$OLD_ALIAS_IDENTITY" || die "CLI alias changed during recovery snapshot creation"
  alias_matches_hash "$PRIOR_ALIAS_PATH" "$OLD_ALIAS_TARGET_SHA256" || die "alias recovery snapshot changed during creation"
elif [ -e "$ALIAS_PATH" ]; then
  die "CLI alias must remain a symlink or absent: $ALIAS_PATH"
fi
if [ -f "$TARGET_PATH" ]; then
  HAD_TARGET=1
  OLD_TARGET_SHA256=$(sha256_file "$TARGET_PATH")
  OLD_TARGET_IDENTITY=$(file_identity "$TARGET_PATH")
  PRIOR_TARGET_PATH="$INSTALL_DIR/.chainlesschain.target-prior-$TRANSACTION_ID"
  [ ! -e "$PRIOR_TARGET_PATH" ] && [ ! -L "$PRIOR_TARGET_PATH" ] || die "target recovery snapshot path already exists"
  ln "$TARGET_PATH" "$PRIOR_TARGET_PATH"
  regular_file_matches "$PRIOR_TARGET_PATH" "$OLD_TARGET_SHA256" "$OLD_TARGET_IDENTITY" || die "target recovery snapshot changed during creation"
  fsync_file "$PRIOR_TARGET_PATH"
  BACKUP_TEMP_PATH="$INSTALL_DIR/.chainlesschain.previous-$TRANSACTION_ID"
  [ ! -e "$BACKUP_TEMP_PATH" ] && [ ! -L "$BACKUP_TEMP_PATH" ] || die "backup staging path already exists"
  ln "$PRIOR_TARGET_PATH" "$BACKUP_TEMP_PATH"
  regular_file_matches "$BACKUP_TEMP_PATH" "$OLD_TARGET_SHA256" "$OLD_TARGET_IDENTITY" || die "could not verify the last-known-good backup snapshot"
fi
if [ "$HAD_TARGET" -eq 1 ] || [ "$HAD_BACKUP" -eq 1 ] || [ "$HAD_LINEAGE" -eq 1 ] || [ "$HAD_ALIAS" -eq 1 ]; then
  fsync_dir "$INSTALL_DIR" || die "could not persist native recovery snapshots"
fi
if [ -n "$PRIOR_TARGET_PATH" ] || [ -n "$PRIOR_BACKUP_PATH" ] || [ -n "$PRIOR_LINEAGE_PATH" ] || [ -n "$PRIOR_ALIAS_PATH" ]; then
  RECOVERY_STATE_PATH="$INSTALL_DIR/.chainlesschain.recovery-$TRANSACTION_ID.json"
  RECOVERY_RETIRED_PATH="$INSTALL_DIR/.chainlesschain.recovery-retired-$TRANSACTION_ID.json"
  [ ! -e "$RECOVERY_STATE_PATH" ] && [ ! -L "$RECOVERY_STATE_PATH" ] || die "native recovery-state pointer already exists"
  [ ! -e "$RECOVERY_RETIRED_PATH" ] && [ ! -L "$RECOVERY_RETIRED_PATH" ] || die "retired native recovery-state pointer already exists"
  create_recovery_state || die "could not persist native recovery-state pointer"
  process_recovery_state validate || die "native recovery-state pointer failed validation"
fi

# Re-check the manifest-bound bytes immediately before the commit point.
assert_safe_install_dir "$INSTALL_DIR"
assert_regular_file_or_missing "$TARGET_PATH" "install target"
assert_regular_file_or_missing "$BACKUP_PATH" "last-known-good backup"
assert_regular_file_or_missing "$LINEAGE_PATH" "native update lineage"
assert_regular_file_or_missing "$RESULT_PATH" "native update result"
assert_regular_file_or_missing "$LAST_RESULT_PATH" "last consumed native update result"
if [ "$HAD_TARGET" -eq 1 ]; then
  regular_file_matches "$TARGET_PATH" "$OLD_TARGET_SHA256" "$OLD_TARGET_IDENTITY" || die "install target changed while the transaction was staged"
  regular_file_matches "$PRIOR_TARGET_PATH" "$OLD_TARGET_SHA256" "$OLD_TARGET_IDENTITY" || die "target recovery snapshot changed while the transaction was staged"
  regular_file_matches "$BACKUP_TEMP_PATH" "$OLD_TARGET_SHA256" "$OLD_TARGET_IDENTITY" || die "backup staging snapshot changed while the transaction was staged"
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
  alias_matches_identity "$ALIAS_PATH" "$OLD_ALIAS_TARGET_SHA256" "$OLD_ALIAS_IDENTITY" || die "CLI alias changed while the transaction was staged"
  alias_matches_hash "$PRIOR_ALIAS_PATH" "$OLD_ALIAS_TARGET_SHA256" || die "alias recovery snapshot changed while the transaction was staged"
elif [ -e "$ALIAS_PATH" ] || [ -L "$ALIAS_PATH" ]; then
  die "CLI alias appeared while the transaction was staged"
fi
if [ "$(sha256_file "$CANDIDATE_PATH")" != "$ARTIFACT_SHA256" ]; then
  die "same-filesystem candidate changed before commit"
fi
CANDIDATE_IDENTITY=$(file_identity "$CANDIDATE_PATH")
regular_file_matches "$CANDIDATE_PATH" "$ARTIFACT_SHA256" "$CANDIDATE_IDENTITY" || die "same-filesystem candidate identity changed before commit"
INSTALLED_TARGET_IDENTITY=$CANDIDATE_IDENTITY
# Both paths are siblings, so this is the sole atomic commit point.
assert_lock_owned || die "native update lock ownership was lost before target commit"
mv -f "$CANDIDATE_PATH" "$TARGET_PATH"
CANDIDATE_PATH=""
SWAPPED=1
fsync_dir "$INSTALL_DIR"

if [ "$(sha256_file "$TARGET_PATH")" != "$ARTIFACT_SHA256" ]; then
  die "installed target changed at the commit boundary"
fi
regular_file_matches "$TARGET_PATH" "$ARTIFACT_SHA256" "$INSTALLED_TARGET_IDENTITY" || die "installed target identity was unstable at the commit boundary"
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
  regular_file_matches "$PRIOR_TARGET_PATH" "$OLD_TARGET_SHA256" "$OLD_TARGET_IDENTITY" || die "target recovery snapshot changed before backup commit"
  regular_file_matches "$BACKUP_TEMP_PATH" "$OLD_TARGET_SHA256" "$OLD_TARGET_IDENTITY" || die "backup staging snapshot changed before backup commit"
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
INSTALLED_ALIAS_IDENTITY=$(symlink_identity "$ALIAS_TEMP_PATH")
alias_matches_identity "$ALIAS_TEMP_PATH" "$CANONICAL_ALIAS_TARGET_SHA256" "$INSTALLED_ALIAS_IDENTITY" || die "CLI alias staging path changed before commit"
if [ "$HAD_ALIAS" -eq 1 ]; then
  alias_matches_identity "$ALIAS_PATH" "$OLD_ALIAS_TARGET_SHA256" "$OLD_ALIAS_IDENTITY" || die "CLI alias changed before alias commit"
  alias_matches_hash "$PRIOR_ALIAS_PATH" "$OLD_ALIAS_TARGET_SHA256" || die "alias recovery snapshot changed before alias commit"
elif [ -e "$ALIAS_PATH" ] || [ -L "$ALIAS_PATH" ]; then
  die "CLI alias appeared before alias commit"
fi
assert_lock_owned || die "native update lock ownership was lost before alias commit"
mv -f "$ALIAS_TEMP_PATH" "$ALIAS_PATH"
ALIAS_TEMP_PATH=""
ALIAS_COMMITTED=1
alias_matches_identity "$ALIAS_PATH" "$CANONICAL_ALIAS_TARGET_SHA256" "$INSTALLED_ALIAS_IDENTITY" || die "CLI alias changed at the commit boundary"
fsync_dir "$INSTALL_DIR"
LINEAGE_COMMIT_STARTED=1
if [ "$HAD_TARGET" -eq 1 ]; then
  assert_lock_owned || die "native update lock ownership was lost before lineage commit"
  if ! commit_lineage "$ARTIFACT_SHA256" "$OLD_TARGET_SHA256" "install"; then
    die "could not persist native update lineage"
  fi
else
  assert_lock_owned || die "native update lock ownership was lost before lineage commit"
  if ! commit_lineage "$ARTIFACT_SHA256" "null" "install"; then
    die "could not persist native update lineage"
  fi
fi
COMMITTED=1
if ! discard_transaction_snapshots; then
  PRESERVE_RECOVERY=1
  die "install committed but prior-generation cleanup failed; the native update lock was retained"
fi
echo "Installed ChainlessChain CLI at $TARGET_PATH"
