#!/usr/bin/env sh
set -eu
umask 077

REPOSITORY="${CC_CLI_REPOSITORY:-chainlesschain/chainlesschain}"
BASE_URL="${CC_CLI_RELEASE_BASE_URL:-https://github.com/$REPOSITORY/releases/download/cli-stable}"
INSTALL_DIR="${CC_CLI_INSTALL_DIR:-$HOME/.local/bin}"
MANIFEST_URL="$BASE_URL/chainlesschain-update.json"
IDENTITY="^https://github.com/${REPOSITORY}/.github/workflows/cli-native-release.yml@refs/tags/cli-v"

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
INSTALLED_ALIAS_ANCHOR_PATH=""
PRIOR_TARGET_PATH=""
PRIOR_BACKUP_PATH=""
PRIOR_LINEAGE_PATH=""
PRIOR_ALIAS_PATH=""
BACKUP_RESTORE_PATH=""
LINEAGE_RESTORE_PATH=""
LINEAGE_TEMP_PATH=""
ALIAS_RESTORE_PATH=""
TARGET_CLAIM_PATH=""
BACKUP_CLAIM_PATH=""
LINEAGE_CLAIM_PATH=""
ALIAS_CLAIM_PATH=""
BACKUP_ORPHAN_PATH=""
LINEAGE_ORPHAN_PATH=""
RECOVERY_STATE_PATH=""
JOURNAL_PATH=""
RECOVERY_RETIRED_PATH=""
RECOVERY_RETIRED_SHA256=""
RECOVERY_RETIRED_IDENTITY=""
RECOVERY_DELETE_PATH=""
RECOVERY_RETIRED=0
RECOVERY_RETIREMENT_GUARD=0
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
CLEANUP_PENDING=0
RETAINED_EVIDENCE_PATHS=""
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

record_retained_evidence() {
  retained_evidence_path=$1
  [ -n "$retained_evidence_path" ] || return 0
  if [ -e "$retained_evidence_path" ] || [ -L "$retained_evidence_path" ]; then
    CLEANUP_PENDING=1
    if [ -z "$RETAINED_EVIDENCE_PATHS" ]; then
      RETAINED_EVIDENCE_PATHS=$retained_evidence_path
    else
      RETAINED_EVIDENCE_PATHS="$RETAINED_EVIDENCE_PATHS
$retained_evidence_path"
    fi
  fi
}

cleanup() {
  status=$?
  set +e
  trap - 0 HUP INT TERM
  if [ -n "$JOURNAL_PATH" ] && [ -f "$JOURNAL_PATH" ]; then
    journal_cleanup_decision=""
    if journal_cleanup_decision=$(read_install_transaction_decision); then
      if [ "$journal_cleanup_decision" = commit ]; then
        COMMITTED=1
      fi
    else
      PRESERVE_RECOVERY=1
      [ "$status" -ne 0 ] || status=1
      echo "native install journal decision is invalid; recovery evidence was retained" >&2
    fi
  fi
  # Once commit-decision publication starts, an asynchronous signal must not
  # race an in-process rollback against the journal write. Keep the journal,
  # recovery set, and lock together so the next process applies whichever
  # decision reached durable storage.
  if [ "$COMMITTED" -eq 1 ] && [ -n "$JOURNAL_PATH" ] && \
    { [ -e "$JOURNAL_PATH" ] || [ -L "$JOURNAL_PATH" ]; }; then
    PRESERVE_RECOVERY=1
  fi
  if [ "$RECOVERY_RETIREMENT_GUARD" -eq 1 ] || \
    { [ -n "$RECOVERY_RETIRED_PATH" ] && { [ -e "$RECOVERY_RETIRED_PATH" ] || [ -L "$RECOVERY_RETIRED_PATH" ]; }; }; then
    PRESERVE_RECOVERY=1
  fi
  if [ "$SWAPPED" -eq 1 ] && [ "$COMMITTED" -eq 0 ] && [ "$PRESERVE_RECOVERY" -eq 0 ]; then
    if rollback_install; then
      if retire_install_transaction_journal rollback; then
        SWAPPED=0
        echo "incomplete install transaction was rolled back" >&2
      else
        PRESERVE_RECOVERY=1
        echo "incomplete install transaction rolled back but its journal could not be retired" >&2
      fi
    else
      PRESERVE_RECOVERY=1
      echo "incomplete install transaction could not be rolled back" >&2
    fi
  fi
  if [ "$PRESERVE_RECOVERY" -eq 0 ] && [ -n "$RECOVERY_STATE_PATH" ] && { [ -e "$RECOVERY_STATE_PATH" ] || [ -L "$RECOVERY_STATE_PATH" ]; }; then
    if ! discard_transaction_snapshots; then
      [ "$status" -ne 0 ] || status=1
      if [ "$CLEANUP_PENDING" -eq 1 ] && [ "$RECOVERY_RETIREMENT_GUARD" -eq 0 ]; then
        echo "native recovery-set cleanup is pending; retained tombstones require later garbage collection" >&2
      else
        PRESERVE_RECOVERY=1
        echo "native recovery-set retirement or cleanup failed" >&2
      fi
    fi
  fi
  if [ "$PRESERVE_RECOVERY" -eq 0 ] && [ -n "$JOURNAL_PATH" ] && [ -f "$JOURNAL_PATH" ]; then
    cleanup_decision=rollback
    [ "$COMMITTED" -eq 0 ] || cleanup_decision=commit
    if ! retire_install_transaction_journal "$cleanup_decision"; then
      PRESERVE_RECOVERY=1
      [ "$status" -ne 0 ] || status=1
      echo "native install journal could not be retired after cleanup" >&2
    fi
  fi
  if [ "$PRESERVE_RECOVERY" -eq 0 ]; then
    for cleanup_path in \
      "$CANDIDATE_PATH" \
      "$ROLLBACK_TEMP_PATH" \
      "$ALIAS_TEMP_PATH" \
      "$INSTALLED_ALIAS_ANCHOR_PATH" \
      "$BACKUP_RESTORE_PATH" \
      "$LINEAGE_RESTORE_PATH" \
      "$LINEAGE_TEMP_PATH" \
      "$ALIAS_RESTORE_PATH"
    do
      if [ -n "$cleanup_path" ] && { [ -e "$cleanup_path" ] || [ -L "$cleanup_path" ]; }; then
        record_retained_evidence "$cleanup_path"
      fi
    done
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
        record_retained_evidence "$cleanup_path"
      fi
    done
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
      "$INSTALLED_ALIAS_ANCHOR_PATH" \
      "$PRIOR_TARGET_PATH" \
      "$PRIOR_BACKUP_PATH" \
      "$PRIOR_LINEAGE_PATH" \
      "$PRIOR_ALIAS_PATH" \
      "$BACKUP_RESTORE_PATH" \
      "$LINEAGE_RESTORE_PATH" \
      "$LINEAGE_TEMP_PATH" \
      "$ALIAS_RESTORE_PATH" \
      "$TARGET_CLAIM_PATH" \
      "$BACKUP_CLAIM_PATH" \
      "$LINEAGE_CLAIM_PATH" \
      "$ALIAS_CLAIM_PATH" \
      "$BACKUP_ORPHAN_PATH" \
      "$LINEAGE_ORPHAN_PATH" \
      "$RECOVERY_STATE_PATH" \
      "$RECOVERY_RETIRED_PATH" \
      "$RECOVERY_DELETE_PATH" \
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
  if [ -n "$STAGING" ] && { [ -e "$STAGING" ] || [ -L "$STAGING" ]; }; then
    record_retained_evidence "$STAGING"
  fi
  if [ "$CLEANUP_PENDING" -eq 1 ]; then
    echo "native transaction is cleanup-pending/degraded; private transaction names were retained instead of deleted by pathname" >&2
    if [ -n "$RETAINED_EVIDENCE_PATHS" ]; then
      printf '%s\n' "$RETAINED_EVIDENCE_PATHS" >&2
    fi
  fi
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

materialize_candidate() {
  python3 - "materialize-candidate" "$1" "$2" "$3" <<'PY'
import hashlib, os, stat, subprocess, sys

marker, source_path, candidate_path, expected_sha = sys.argv[1:]
if marker != 'materialize-candidate':
    raise SystemExit('invalid candidate materialization invocation')

nofollow = getattr(os, 'O_NOFOLLOW', 0)
source_fd = os.open(source_path, os.O_RDONLY | nofollow)
candidate_fd = -1
startup_fd = -1

def hash_fd(fd):
    os.lseek(fd, 0, os.SEEK_SET)
    digest = hashlib.sha256()
    while True:
        block = os.read(fd, 1024 * 1024)
        if not block:
            return digest.hexdigest()
        digest.update(block)

try:
    source_before = os.fstat(source_fd)
    source_path_before = os.lstat(source_path)
    if (
        not stat.S_ISREG(source_before.st_mode)
        or not stat.S_ISREG(source_path_before.st_mode)
        or (source_before.st_dev, source_before.st_ino) != (source_path_before.st_dev, source_path_before.st_ino)
    ):
        raise RuntimeError('verified artifact source changed before materialization')

    flags = os.O_CREAT | os.O_EXCL | os.O_RDWR | nofollow
    candidate_fd = os.open(candidate_path, flags, 0o600)
    candidate_created = os.fstat(candidate_fd)
    if not stat.S_ISREG(candidate_created.st_mode) or (candidate_created.st_dev == 0 and candidate_created.st_ino == 0):
        raise RuntimeError('candidate has no stable regular-file identity')

    source_digest = hashlib.sha256()
    while True:
        block = os.read(source_fd, 1024 * 1024)
        if not block:
            break
        source_digest.update(block)
        view = memoryview(block)
        while view:
            written = os.write(candidate_fd, view)
            view = view[written:]
    if source_digest.hexdigest() != expected_sha:
        raise RuntimeError('verified artifact changed while it was copied')

    os.fchmod(candidate_fd, 0o755)
    os.fsync(candidate_fd)
    if hash_fd(candidate_fd) != expected_sha:
        raise RuntimeError('candidate changed after same-fd materialization')

    # Linux rejects executing an inode while any process holds it open for
    # writing (ETXTBSY). Bind a read-only descriptor through the no-follow
    # public name, prove that it is the exact inode just materialized, and only
    # then close the writable descriptor. All writes, chmod, fsync, hashing,
    # and the handoff identity check above remain bound to candidate_fd.
    candidate_materialized = os.fstat(candidate_fd)
    startup_fd = os.open(candidate_path, os.O_RDONLY | nofollow)
    startup_bound = os.fstat(startup_fd)
    candidate_path_bound = os.lstat(candidate_path)
    handoff_stable = (
        stat.S_ISREG(candidate_materialized.st_mode)
        and stat.S_ISREG(startup_bound.st_mode)
        and stat.S_ISREG(candidate_path_bound.st_mode)
        and (candidate_created.st_dev, candidate_created.st_ino)
            == (candidate_materialized.st_dev, candidate_materialized.st_ino)
        and (candidate_materialized.st_dev, candidate_materialized.st_ino)
            == (startup_bound.st_dev, startup_bound.st_ino)
        and (startup_bound.st_dev, startup_bound.st_ino)
            == (candidate_path_bound.st_dev, candidate_path_bound.st_ino)
        and stat.S_IMODE(candidate_materialized.st_mode) == 0o755
        and candidate_materialized.st_size == startup_bound.st_size == candidate_path_bound.st_size
        and candidate_materialized.st_mtime_ns == startup_bound.st_mtime_ns == candidate_path_bound.st_mtime_ns
        and candidate_materialized.st_ctime_ns == startup_bound.st_ctime_ns == candidate_path_bound.st_ctime_ns
    )
    if not handoff_stable:
        raise RuntimeError('candidate identity changed during read-only fd handoff')

    os.close(candidate_fd)
    candidate_fd = -1

    # Darwin exposes readable /dev/fd names but rejects executing them with
    # EACCES and does not provide a supported fexecve/execveat equivalent.
    # Path existence is therefore not an execution-capability probe there.
    # Never fall back to candidate_path: doing so would reopen a same-UID
    # pathname race after the inode was bound. The signed-manifest SHA, fd-bound
    # materialization, mode/inode handoff, and final fd/path revalidation below
    # remain mandatory; only the unsupported fd-bound --version preflight is
    # omitted on Darwin.
    if sys.platform != 'darwin':
        descriptor_path = f'/proc/self/fd/{startup_fd}'
        if not os.path.exists(descriptor_path):
            descriptor_path = f'/dev/fd/{startup_fd}'
        if not os.path.exists(descriptor_path):
            raise RuntimeError('fd-bound candidate execution is unavailable')
        result = subprocess.run(
            [descriptor_path, '--version'],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=30,
            check=False,
            pass_fds=(startup_fd,),
        )
        if result.returncode != 0:
            raise RuntimeError('verified candidate failed its fd-bound startup check')

    candidate_after = os.fstat(startup_fd)
    candidate_path_after = os.lstat(candidate_path)
    source_after = os.fstat(source_fd)
    source_path_after = os.lstat(source_path)
    candidate_sha = hash_fd(startup_fd)
    source_stable = (
        stat.S_ISREG(source_after.st_mode)
        and stat.S_ISREG(source_path_after.st_mode)
        and (source_before.st_dev, source_before.st_ino) == (source_after.st_dev, source_after.st_ino)
        and (source_after.st_dev, source_after.st_ino) == (source_path_after.st_dev, source_path_after.st_ino)
        and source_before.st_size == source_after.st_size == source_path_after.st_size
        and source_before.st_mtime_ns == source_after.st_mtime_ns == source_path_after.st_mtime_ns
        and source_before.st_ctime_ns == source_after.st_ctime_ns == source_path_after.st_ctime_ns
    )
    candidate_stable = (
        stat.S_ISREG(candidate_after.st_mode)
        and stat.S_ISREG(candidate_path_after.st_mode)
        and (candidate_created.st_dev, candidate_created.st_ino) == (candidate_materialized.st_dev, candidate_materialized.st_ino)
        and (candidate_materialized.st_dev, candidate_materialized.st_ino) == (startup_bound.st_dev, startup_bound.st_ino)
        and (startup_bound.st_dev, startup_bound.st_ino) == (candidate_after.st_dev, candidate_after.st_ino)
        and (candidate_after.st_dev, candidate_after.st_ino) == (candidate_path_after.st_dev, candidate_path_after.st_ino)
        and stat.S_IMODE(candidate_after.st_mode) == 0o755
        and candidate_after.st_size == candidate_path_after.st_size
        and candidate_after.st_mtime_ns == candidate_path_after.st_mtime_ns
        and candidate_after.st_ctime_ns == candidate_path_after.st_ctime_ns
    )
    if not source_stable or not candidate_stable or candidate_sha != expected_sha:
        raise RuntimeError('candidate identity changed during fd-bound validation')
    print(
        f'{candidate_after.st_dev}:{candidate_after.st_ino}:{candidate_after.st_mode} {candidate_sha}',
        flush=True,
    )
finally:
    if candidate_fd >= 0:
        os.close(candidate_fd)
    if startup_fd >= 0:
        os.close(startup_fd)
    os.close(source_fd)
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
import ctypes, errno, os, stat, sys

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

def rename_noreplace(source, destination):
    libc = ctypes.CDLL(None, use_errno=True)
    source_bytes = os.fsencode(source)
    destination_bytes = os.fsencode(destination)
    result = -1
    error_number = errno.ENOTSUP
    if sys.platform.startswith('linux'):
        function = getattr(libc, 'renameat2', None)
        if function is not None:
            function.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
            function.restype = ctypes.c_int
            result = function(-100, source_bytes, -100, destination_bytes, 1)
            error_number = ctypes.get_errno()
    elif sys.platform == 'darwin':
        function = getattr(libc, 'renamex_np', None)
        if function is not None:
            function.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
            function.restype = ctypes.c_int
            result = function(source_bytes, destination_bytes, 0x00000004)
            error_number = ctypes.get_errno()
    if result == 0:
        return
    fallback_errors = {
        errno.EINVAL,
        errno.ENOSYS,
        getattr(errno, 'ENOTSUP', errno.EINVAL),
        getattr(errno, 'EOPNOTSUPP', errno.EINVAL),
    }
    if error_number not in fallback_errors:
        raise OSError(error_number, os.strerror(error_number), destination)

    # Without atomic no-overwrite rename, retain both hard-link names and fail
    # closed. There is no conditional unlink-by-inode for retiring the public
    # lock without risking deletion of a same-name successor.
    source_value = os.lstat(source)
    if not stat.S_ISREG(source_value.st_mode):
        raise OSError(errno.EINVAL, 'lock release fallback requires a regular file')
    held_fd = os.open(source, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    try:
        held_value = os.fstat(held_fd)
        if (held_value.st_dev, held_value.st_ino) != (source_value.st_dev, source_value.st_ino):
            raise RuntimeError('public lock changed before fallback anchoring')
        os.link(source, destination, follow_symlinks=False)
        source_now = os.lstat(source)
        destination_now = os.lstat(destination)
        held_now = os.fstat(held_fd)
        identities = {
            (held_value.st_dev, held_value.st_ino),
            (held_now.st_dev, held_now.st_ino),
            (source_now.st_dev, source_now.st_ino),
            (destination_now.st_dev, destination_now.st_ino),
        }
        if len(identities) != 1:
            raise RuntimeError('lock release fallback changed identity')
        durability_barrier('fallback-held-dir', release_dir)
        durability_barrier('fallback-parent', install_dir)
        raise OSError(
            errno.ENOTSUP,
            'atomic no-overwrite lock release is unavailable; retained dual-name evidence',
            destination,
        )
    finally:
        os.close(held_fd)

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

# Keep a stable hard-link anchor permanently as transaction evidence. POSIX
# cannot safely unlink this private name after pathname validation.
os.link(lock_path, anchor_path, follow_symlinks=False)
if not expected_lock(anchor_path):
    raise SystemExit('native update lock changed before release anchoring')
durability_barrier('anchor-parent', install_dir)
os.mkdir(release_dir, 0o700)
durability_barrier('release-dir-parent', install_dir)

held_path = os.path.join(release_dir, 'owned.lock')
released = False
try:
    # Atomically remove only the exact public name into an absent private name.
    # The held file, anchor, and containing directory are never path-deleted.
    rename_noreplace(lock_path, held_path)
    if not expected_lock(held_path):
        link_without_overwrite(held_path)
        raise SystemExit('refusing to delete a successor native update lock')
    durability_barrier('renamed-release-dir', release_dir)
    durability_barrier('renamed-parent', install_dir)
    if not expected_lock(held_path) or not expected_lock(anchor_path):
        raise SystemExit('retained lock release evidence changed')
    released = True
finally:
    if not released and lexists(held_path):
        try:
            if expected_lock(held_path):
                restore_owned_without_overwrite(held_path)
            else:
                link_without_overwrite(held_path)
        except OSError:
            pass
    elif not released and lexists(anchor_path):
        try:
            restore_owned_without_overwrite(anchor_path)
        except OSError:
            pass
PY
  release_status=$?
  if [ "$release_status" -eq 0 ]; then
    record_retained_evidence "$LOCK_RELEASE_DIR"
    record_retained_evidence "$LOCK_ANCHOR_PATH"
  fi
  return "$release_status"
}

write_lineage() {
  current_sha=$1
  previous_sha=$2
  operation=$3
  python3 - "write-lineage" "$LINEAGE_TEMP_PATH" "$TRANSACTION_ID" "$operation" "$current_sha" "$previous_sha" <<'PY'
import errno, hashlib, json, os, stat, sys
marker, staging, transaction_id, operation, current_sha, previous_sha = sys.argv[1:]
if marker != 'write-lineage':
    raise SystemExit('invalid lineage writer invocation')
directory = os.path.dirname(staging)
payload = {
    'schema': 'chainlesschain.native-update-lineage.v1',
    'transactionId': transaction_id,
    'operation': operation,
    'currentSha256': current_sha,
    'previousSha256': None if previous_sha == 'null' else previous_sha,
    'updatedAt': __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat().replace('+00:00', 'Z'),
}
payload_bytes = (json.dumps(payload, separators=(',', ':')) + '\n').encode('utf-8')
flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, 'O_NOFOLLOW', 0)
fd = os.open(staging, flags, 0o600)
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
    staged = os.lstat(staging)
    held_after = os.fstat(held_fd)
    if (
        not stat.S_ISREG(staged.st_mode)
        or (held_before.st_dev, held_before.st_ino) != (held_after.st_dev, held_after.st_ino)
        or (held_after.st_dev, held_after.st_ino) != (staged.st_dev, staged.st_ino)
        or held_before.st_size != held_after.st_size
        or held_after.st_size != len(payload_bytes)
    ):
        raise SystemExit('staged lineage changed before publication')
    # Emit exact metadata before the directory barrier. The shell publishes this
    # fd-bound staging inode through mutate_public_path only after the barrier.
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
  LINEAGE_TEMP_PATH="$INSTALL_DIR/.chainlesschain.staged-$TRANSACTION_ID.update-lineage.json"
  [ ! -e "$LINEAGE_TEMP_PATH" ] && [ ! -L "$LINEAGE_TEMP_PATH" ] || return 1
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
  LINEAGE_CLAIM_PATH="$INSTALL_DIR/.chainlesschain.lineage-publish-claimed-$TRANSACTION_ID"
  if [ "$HAD_LINEAGE" -eq 1 ]; then
    if ! mutate_public_path \
      replace \
      "$LINEAGE_PATH" \
      "$LINEAGE_TEMP_PATH" \
      "$LINEAGE_CLAIM_PATH" \
      regular \
      "$OLD_LINEAGE_SHA256" \
      "$OLD_LINEAGE_IDENTITY" \
      regular \
      "$INSTALLED_LINEAGE_SHA256" \
      "$INSTALLED_LINEAGE_IDENTITY"; then
      PRESERVE_RECOVERY=1
      return 1
    fi
  else
    if ! mutate_public_path \
      replace \
      "$LINEAGE_PATH" \
      "$LINEAGE_TEMP_PATH" \
      "$LINEAGE_CLAIM_PATH" \
      absent \
      "" \
      "" \
      regular \
      "$INSTALLED_LINEAGE_SHA256" \
      "$INSTALLED_LINEAGE_IDENTITY"; then
      PRESERVE_RECOVERY=1
      return 1
    fi
  fi
  LINEAGE_TEMP_PATH=""
  LINEAGE_CLAIM_PATH=""
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
# Keep a second hard link to the symlink inode. Besides preserving the raw
# target for recovery, this pins the inode until the transaction retires the
# snapshot, so unlink-and-recreate cannot masquerade as the same alias through
# immediate inode-number reuse.
os.link(source, snapshot, follow_symlinks=False)
source_pinned = os.lstat(source)
snapshot_pinned = os.lstat(snapshot)
if (
    not stat.S_ISLNK(source_pinned.st_mode)
    or not stat.S_ISLNK(snapshot_pinned.st_mode)
    or (source_pinned.st_dev, source_pinned.st_ino) != (snapshot_pinned.st_dev, snapshot_pinned.st_ino)
    or source_pinned.st_nlink < 2
    or snapshot_pinned.st_nlink < 2
    or os.readlink(source) != target
    or os.readlink(snapshot) != target
):
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

mutate_public_path() {
  mutation_action=$1
  mutation_public_path=$2
  mutation_stage_path=$3
  mutation_tombstone_path=$4
  mutation_current_kind=$5
  mutation_current_digest=$6
  mutation_current_identity=$7
  mutation_replacement_kind=$8
  mutation_replacement_digest=$9
  shift 9
  mutation_replacement_identity=$1
  mutation_status=0
  python3 - \
    "mutate-public-path" \
    "$mutation_action" \
    "$mutation_public_path" \
    "$mutation_stage_path" \
    "$mutation_tombstone_path" \
    "$INSTALL_DIR" \
    "$mutation_current_kind" \
    "$mutation_current_digest" \
    "$mutation_current_identity" \
    "$mutation_replacement_kind" \
    "$mutation_replacement_digest" \
    "$mutation_replacement_identity" <<'PY' || mutation_status=$?
import ctypes, errno, hashlib, os, stat, sys

(
    marker,
    action,
    public_path,
    stage_path,
    tombstone_path,
    directory,
    current_kind,
    current_digest,
    current_identity,
    replacement_kind,
    replacement_digest,
    replacement_identity,
) = sys.argv[1:]
if marker != 'mutate-public-path' or action not in ('replace', 'delete'):
    raise SystemExit('invalid public-path mutation invocation')
if current_kind not in ('absent', 'regular', 'symlink'):
    raise SystemExit('invalid current public-path kind')
if replacement_kind not in ('absent', 'regular', 'symlink'):
    raise SystemExit('invalid replacement public-path kind')
if action == 'replace' and replacement_kind == 'absent':
    raise SystemExit('replacement metadata is required')
if action == 'delete' and replacement_kind != 'absent':
    raise SystemExit('delete must not provide replacement metadata')

unsupported_fsync = {
    errno.EBADF,
    errno.EINVAL,
    getattr(errno, 'ENOTSUP', errno.EINVAL),
    getattr(errno, 'EOPNOTSUPP', errno.EINVAL),
}

def lexists(path):
    try:
        os.lstat(path)
        return True
    except FileNotFoundError:
        return False

def barrier():
    fd = os.open(directory, os.O_RDONLY)
    try:
        try:
            os.fsync(fd)
        except OSError as error:
            if error.errno not in unsupported_fsync:
                raise
    finally:
        os.close(fd)

def rename_noreplace(source, destination):
    libc = ctypes.CDLL(None, use_errno=True)
    source_bytes = os.fsencode(source)
    destination_bytes = os.fsencode(destination)
    result = -1
    error_number = errno.ENOTSUP
    if sys.platform.startswith('linux'):
        function = getattr(libc, 'renameat2', None)
        if function is not None:
            function.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
            function.restype = ctypes.c_int
            result = function(-100, source_bytes, -100, destination_bytes, 1)
            error_number = ctypes.get_errno()
    elif sys.platform == 'darwin':
        function = getattr(libc, 'renamex_np', None)
        if function is not None:
            function.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
            function.restype = ctypes.c_int
            result = function(source_bytes, destination_bytes, 0x00000004)
            error_number = ctypes.get_errno()
    if result == 0:
        return
    fallback_errors = {
        errno.EINVAL,
        errno.ENOSYS,
        getattr(errno, 'ENOTSUP', errno.EINVAL),
        getattr(errno, 'EOPNOTSUPP', errno.EINVAL),
    }
    if error_number not in fallback_errors:
        raise OSError(error_number, os.strerror(error_number), destination)

    # Some otherwise POSIX filesystems (notably WSL1/DrvFS) reject
    # RENAME_NOREPLACE. A no-follow hard link is still useful as a durable
    # no-overwrite claim, but POSIX has no portable unlink-by-handle primitive.
    # Retain both names and fail closed instead of validating one pathname and
    # then risking deletion of a successor installed before unlink().
    source_value = os.lstat(source)
    if stat.S_ISREG(source_value.st_mode):
        held_fd = os.open(source, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    elif stat.S_ISLNK(source_value.st_mode):
        if hasattr(os, 'O_PATH'):
            held_fd = os.open(source, os.O_PATH | getattr(os, 'O_NOFOLLOW', 0))
        elif hasattr(os, 'O_SYMLINK'):
            held_fd = os.open(source, os.O_RDONLY | os.O_SYMLINK)
        else:
            raise OSError(errno.ENOTSUP, 'an fd-bindable symlink link fallback is required')
    else:
        raise OSError(errno.EINVAL, 'link fallback only supports regular files and symlinks')
    try:
        held_value = os.fstat(held_fd)
        if (held_value.st_dev, held_value.st_ino) != (source_value.st_dev, source_value.st_ino):
            raise RuntimeError('source changed before no-overwrite link claim')
        os.link(source, destination, follow_symlinks=False)
        destination_value = os.lstat(destination)
        source_now = os.lstat(source)
        held_now = os.fstat(held_fd)
        identities = {
            (held_value.st_dev, held_value.st_ino),
            (held_now.st_dev, held_now.st_ino),
            (source_now.st_dev, source_now.st_ino),
            (destination_value.st_dev, destination_value.st_ino),
        }
        if len(identities) != 1:
            raise RuntimeError('no-overwrite link claim changed identity')
        barrier()
        source_final = os.lstat(source)
        held_final = os.fstat(held_fd)
        if (source_final.st_dev, source_final.st_ino) != (held_final.st_dev, held_final.st_ino):
            raise RuntimeError('source successor appeared before link-claim retirement')
        raise OSError(
            errno.ENOTSUP,
            'no-overwrite hard-link claim retained because source cannot be retired by handle',
            source,
        )
    finally:
        os.close(held_fd)

def read_regular(fd):
    os.lseek(fd, 0, os.SEEK_SET)
    digest = hashlib.sha256()
    while True:
        block = os.read(fd, 1024 * 1024)
        if not block:
            return digest.hexdigest()
        digest.update(block)

def open_symlink(path):
    if hasattr(os, 'O_PATH'):
        return os.open(path, os.O_PATH | getattr(os, 'O_NOFOLLOW', 0))
    if hasattr(os, 'O_SYMLINK'):
        return os.open(path, os.O_RDONLY | os.O_SYMLINK)
    raise OSError(errno.ENOTSUP, 'an fd-bindable symlink open primitive is required')

def bind(path, kind, expected_digest, expected_identity):
    if kind == 'regular':
        fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    elif kind == 'symlink':
        fd = open_symlink(path)
    else:
        raise AssertionError('cannot bind an absent path')
    try:
        before = os.fstat(fd)
        path_before = os.lstat(path)
        if kind == 'regular':
            digest = read_regular(fd)
        else:
            digest = hashlib.sha256(os.fsencode(os.readlink(path))).hexdigest()
        after = os.fstat(fd)
        path_after = os.lstat(path)
        expected_mode = stat.S_ISREG if kind == 'regular' else stat.S_ISLNK
        identity = f'{after.st_dev}:{after.st_ino}:{after.st_mode}'
        stable = (
            expected_mode(before.st_mode)
            and expected_mode(path_before.st_mode)
            and expected_mode(after.st_mode)
            and expected_mode(path_after.st_mode)
            and before.st_nlink > 0
            and not (before.st_dev == 0 and before.st_ino == 0)
            and (before.st_dev, before.st_ino) == (path_before.st_dev, path_before.st_ino)
            and (before.st_dev, before.st_ino) == (after.st_dev, after.st_ino)
            and (after.st_dev, after.st_ino) == (path_after.st_dev, path_after.st_ino)
            and before.st_size == after.st_size == path_after.st_size
            and before.st_mtime_ns == after.st_mtime_ns == path_after.st_mtime_ns
            and before.st_ctime_ns == after.st_ctime_ns == path_after.st_ctime_ns
        )
        if not stable or digest != expected_digest or identity != expected_identity:
            raise RuntimeError(f'{kind} path changed before it could be occupied')
        return {'fd': fd, 'kind': kind, 'digest': digest, 'identity': identity}
    except BaseException:
        os.close(fd)
        raise

def verify(bound, path):
    value = os.fstat(bound['fd'])
    path_value = os.lstat(path)
    if bound['kind'] == 'regular':
        kind_matches = stat.S_ISREG(value.st_mode) and stat.S_ISREG(path_value.st_mode)
        digest = read_regular(bound['fd'])
    else:
        kind_matches = stat.S_ISLNK(value.st_mode) and stat.S_ISLNK(path_value.st_mode)
        digest = hashlib.sha256(os.fsencode(os.readlink(path))).hexdigest()
    identity = f'{value.st_dev}:{value.st_ino}:{value.st_mode}'
    if (
        not kind_matches
        or value.st_nlink <= 0
        or identity != bound['identity']
        or (value.st_dev, value.st_ino) != (path_value.st_dev, path_value.st_ino)
        or digest != bound['digest']
    ):
        raise RuntimeError('occupied path no longer resolves to its bound object')

def retire_bound_name(bound, path):
    # POSIX has no conditional unlink-by-inode. Keep this fd-validated private
    # name as durable evidence; deleting it by pathname after verification
    # could delete a same-name successor installed in the following instant.
    verify(bound, path)
    barrier()
    verify(bound, path)
    return path

current = None
replacement = None
claimed = False
published = False
try:
    if lexists(tombstone_path):
        raise FileExistsError(errno.EEXIST, 'transaction tombstone already exists', tombstone_path)
    if current_kind == 'absent':
        if lexists(public_path):
            raise FileExistsError(errno.EEXIST, 'public path appeared before publication', public_path)
    else:
        current = bind(public_path, current_kind, current_digest, current_identity)
    if action == 'replace':
        replacement = bind(stage_path, replacement_kind, replacement_digest, replacement_identity)

    if current is not None:
        rename_noreplace(public_path, tombstone_path)
        claimed = True
        try:
            verify(current, tombstone_path)
        except BaseException:
            if not lexists(public_path):
                try:
                    rename_noreplace(tombstone_path, public_path)
                    claimed = False
                    barrier()
                except OSError:
                    pass
            raise
        barrier()
        verify(current, tombstone_path)
        if lexists(public_path):
            raise FileExistsError(errno.EEXIST, 'successor appeared after public path occupation', public_path)

    if action == 'replace':
        rename_noreplace(stage_path, public_path)
        published = True
        verify(replacement, public_path)
        barrier()
        verify(replacement, public_path)
        if current is not None:
            retire_bound_name(current, tombstone_path)
        verify(replacement, public_path)
    else:
        if lexists(public_path):
            raise FileExistsError(errno.EEXIST, 'successor appeared before deletion retirement', public_path)
        retire_bound_name(current, tombstone_path)
        if lexists(public_path):
            raise FileExistsError(errno.EEXIST, 'successor appeared while deletion was retired', public_path)
except BaseException:
    # Before publication, restore only the exact fd-bound object and never
    # overwrite a successor. After publication, reverse only if both public and
    # tombstone names still resolve to the held descriptors.
    try:
        can_restore_current = current is None or (claimed and lexists(tombstone_path))
        if published and replacement is not None and can_restore_current and lexists(public_path):
            verify(replacement, public_path)
            if current is not None:
                verify(current, tombstone_path)
            if not lexists(stage_path):
                rename_noreplace(public_path, stage_path)
                published = False
                verify(replacement, stage_path)
        if claimed and current is not None and lexists(tombstone_path):
            verify(current, tombstone_path)
            if not lexists(public_path):
                rename_noreplace(tombstone_path, public_path)
                claimed = False
                verify(current, public_path)
        barrier()
    except BaseException:
        pass
    raise
finally:
    if current is not None:
        os.close(current['fd'])
    if replacement is not None:
        os.close(replacement['fd'])
PY
  record_retained_evidence "$mutation_tombstone_path"
  return "$mutation_status"
}

quarantine_regular_orphan() {
  orphan_public_path=$1
  orphan_tombstone_path=$2
  orphan_label=$3
  orphan_sha=$(sha256_file "$orphan_public_path") || return 1
  orphan_identity=$(file_identity "$orphan_public_path") || return 1
  regular_file_matches "$orphan_public_path" "$orphan_sha" "$orphan_identity" || return 1
  assert_lock_owned || return 1
  orphan_retention_status=0
  python3 - \
    "retain-regular-orphan" \
    "$orphan_public_path" \
    "$orphan_sha" \
    "$orphan_identity" <<'PY' || orphan_retention_status=$?
import hashlib, os, stat, sys

marker, orphan_path, expected_digest, expected_identity = sys.argv[1:]
if marker != 'retain-regular-orphan':
    raise SystemExit('invalid orphan-retention invocation')

flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
fd = os.open(orphan_path, flags)
try:
    before = os.fstat(fd)
    path_before = os.lstat(orphan_path)
    digest = hashlib.sha256()
    while True:
        block = os.read(fd, 1024 * 1024)
        if not block:
            break
        digest.update(block)
    after = os.fstat(fd)
    path_after = os.lstat(orphan_path)
    identity = f'{after.st_dev}:{after.st_ino}:{after.st_mode}'
    stable = (
        stat.S_ISREG(before.st_mode)
        and stat.S_ISREG(path_before.st_mode)
        and stat.S_ISREG(after.st_mode)
        and stat.S_ISREG(path_after.st_mode)
        and before.st_nlink > 0
        and not (before.st_dev == 0 and before.st_ino == 0)
        and (before.st_dev, before.st_ino) == (path_before.st_dev, path_before.st_ino)
        and (before.st_dev, before.st_ino) == (after.st_dev, after.st_ino)
        and (after.st_dev, after.st_ino) == (path_after.st_dev, path_after.st_ino)
        and before.st_size == after.st_size == path_after.st_size
        and before.st_mtime_ns == after.st_mtime_ns == path_after.st_mtime_ns
        and before.st_ctime_ns == after.st_ctime_ns == path_after.st_ctime_ns
    )
    if not stable or digest.hexdigest() != expected_digest or identity != expected_identity:
        raise SystemExit('orphan public path changed while it was fd-bound')
finally:
    os.close(fd)

# POSIX has no rename-if-path-still-resolves-to-this-fd operation. Even after
# the checks above, a same-uid process can replace orphan_path before a
# pathname rename. Retain the public name and force manual adjudication.
raise SystemExit(75)
PY
  record_retained_evidence "$orphan_public_path"
  echo "$orphan_label retained at $orphan_public_path; the public name cannot be atomically quarantined by verified identity" >&2
  [ "$orphan_retention_status" -ne 0 ] || return 1
  return 1
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
    "$OLD_ALIAS_TARGET_SHA256" \
    "$OLD_ALIAS_IDENTITY" <<'PY'
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
    old_alias_identity,
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
            'identity': old_alias_identity or None,
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
    # The public pointer name may have been replaced while this fd was being
    # written. Never unlink by pathname on failure; cleanup will retain the
    # pointer, snapshots, and update lock for manual adjudication.
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
    "$OLD_ALIAS_TARGET_SHA256" \
    "$OLD_ALIAS_IDENTITY" <<'PY'
import ctypes, errno, hashlib, json, os, stat, sys

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
    old_alias_identity,
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

def rename_noreplace(source, destination):
    libc = ctypes.CDLL(None, use_errno=True)
    source_bytes = os.fsencode(source)
    destination_bytes = os.fsencode(destination)
    result = -1
    error_number = errno.ENOTSUP
    if sys.platform.startswith('linux'):
        function = getattr(libc, 'renameat2', None)
        if function is not None:
            function.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
            function.restype = ctypes.c_int
            result = function(-100, source_bytes, -100, destination_bytes, 1)
            error_number = ctypes.get_errno()
    elif sys.platform == 'darwin':
        function = getattr(libc, 'renamex_np', None)
        if function is not None:
            function.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
            function.restype = ctypes.c_int
            result = function(source_bytes, destination_bytes, 0x00000004)
            error_number = ctypes.get_errno()
    if result == 0:
        return
    fallback_errors = {
        errno.EINVAL,
        errno.ENOSYS,
        getattr(errno, 'ENOTSUP', errno.EINVAL),
        getattr(errno, 'EOPNOTSUPP', errno.EINVAL),
    }
    if error_number not in fallback_errors:
        raise OSError(error_number, os.strerror(error_number), destination)

    source_value = os.lstat(source)
    if not stat.S_ISREG(source_value.st_mode):
        raise OSError(errno.EINVAL, 'recovery pointer link fallback requires a regular file')
    held_fd = os.open(source, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    try:
        held_value = os.fstat(held_fd)
        if (held_value.st_dev, held_value.st_ino) != (source_value.st_dev, source_value.st_ino):
            raise RuntimeError('recovery pointer changed before link claim')
        os.link(source, destination, follow_symlinks=False)
        source_now = os.lstat(source)
        destination_now = os.lstat(destination)
        held_now = os.fstat(held_fd)
        identities = {
            (held_value.st_dev, held_value.st_ino),
            (held_now.st_dev, held_now.st_ino),
            (source_now.st_dev, source_now.st_ino),
            (destination_now.st_dev, destination_now.st_ino),
        }
        if len(identities) != 1:
            raise RuntimeError('recovery pointer link claim changed identity')
        recovery_barrier('recovery-link-claimed', directory)
        source_final = os.lstat(source)
        held_final = os.fstat(held_fd)
        if (source_final.st_dev, source_final.st_ino) != (held_final.st_dev, held_final.st_ino):
            raise RuntimeError('recovery pointer successor appeared before link retirement')
        raise OSError(
            errno.ENOTSUP,
            'recovery hard-link claim retained because active pointer cannot be retired by handle',
            source,
        )
    finally:
        os.close(held_fd)

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
            'identity': old_alias_identity or None,
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
        alias_identity = f'{alias_after.st_dev}:{alias_after.st_ino}:{alias_after.st_mode}'
        if (
            not stat.S_ISLNK(alias_before.st_mode)
            or not stat.S_ISLNK(alias_after.st_mode)
            or (alias_before.st_dev, alias_before.st_ino) != (alias_after.st_dev, alias_after.st_ino)
            or hashlib.sha256(os.fsencode(target)).hexdigest() != alias['targetSha256']
            or alias_identity != alias['identity']
        ):
            raise SystemExit('priorAlias recovery target changed')

    if action == 'retire':
        # Atomically occupy the active public name into a no-overwrite private
        # tombstone. The original O_NOFOLLOW descriptor remains open, so a
        # same-name successor can never be mistaken for or deleted with it.
        rename_noreplace(state_path, retired_path)
        retired_fd = os.open(retired_path, state_flags)
        try:
            retired_value = os.fstat(retired_fd)
            retired_path_value = os.lstat(retired_path)
            retired_bytes = read_fd(retired_fd)
            fd_now = os.fstat(state_fd)
            same_pointer = (
                (state_before.st_dev, state_before.st_ino) == (fd_now.st_dev, fd_now.st_ino)
                and (fd_now.st_dev, fd_now.st_ino) == (retired_value.st_dev, retired_value.st_ino)
                and (retired_value.st_dev, retired_value.st_ino) == (retired_path_value.st_dev, retired_path_value.st_ino)
                and retired_bytes == state_bytes == expected_bytes
            )
            if not same_pointer:
                try:
                    os.lstat(state_path)
                except FileNotFoundError:
                    try:
                        rename_noreplace(retired_path, state_path)
                    except OSError:
                        pass
                raise SystemExit('retired recovery-state pointer changed identity or content')
            recovery_barrier('retired-published', directory)
            retired_now = os.lstat(retired_path)
            fd_now = os.fstat(state_fd)
            retired_fd_now = os.fstat(retired_fd)
            active_bytes_now = read_fd(state_fd)
            retired_bytes_now = read_fd(retired_fd)
            if (
                (state_before.st_dev, state_before.st_ino) != (fd_now.st_dev, fd_now.st_ino)
                or (retired_now.st_dev, retired_now.st_ino) != (retired_fd_now.st_dev, retired_fd_now.st_ino)
                or (fd_now.st_dev, fd_now.st_ino) != (retired_fd_now.st_dev, retired_fd_now.st_ino)
                or active_bytes_now != expected_bytes
                or retired_bytes_now != expected_bytes
            ):
                raise SystemExit('retired recovery-state tombstone changed before retirement')
            try:
                os.lstat(state_path)
            except FileNotFoundError:
                print(
                    f'{retired_fd_now.st_dev}:{retired_fd_now.st_ino}:{retired_fd_now.st_mode} '
                    f'{hashlib.sha256(retired_bytes_now).hexdigest()}',
                    flush=True,
                )
            else:
                raise SystemExit('active recovery-state successor appeared during retirement')
        finally:
            os.close(retired_fd)
finally:
    os.close(state_fd)
PY
}

discard_regular_artifact() {
  artifact_path=$1
  artifact_sha=$2
  artifact_identity=$3
  [ -n "$artifact_path" ] || return 0
  RECOVERY_DELETE_PATH="$artifact_path.cleanup-$TRANSACTION_ID"
  assert_lock_owned || return 1
  mutate_public_path \
    delete \
    "$artifact_path" \
    "" \
    "$RECOVERY_DELETE_PATH" \
    regular \
    "$artifact_sha" \
    "$artifact_identity" \
    absent \
    "" \
    "" || return 1
  RECOVERY_DELETE_PATH=""
}

discard_symlink_artifact() {
  artifact_path=$1
  artifact_target_sha=$2
  artifact_identity=$3
  [ -n "$artifact_path" ] || return 0
  alias_matches_identity "$artifact_path" "$artifact_target_sha" "$artifact_identity" || return 1
  RECOVERY_DELETE_PATH="$artifact_path.cleanup-$TRANSACTION_ID"
  assert_lock_owned || return 1
  mutate_public_path \
    delete \
    "$artifact_path" \
    "" \
    "$RECOVERY_DELETE_PATH" \
    symlink \
    "$artifact_target_sha" \
    "$artifact_identity" \
    absent \
    "" \
    "" || return 1
  RECOVERY_DELETE_PATH=""
}

discard_transaction_snapshots() {
  if [ -z "$PRIOR_TARGET_PATH" ] && [ -z "$PRIOR_BACKUP_PATH" ] && [ -z "$PRIOR_LINEAGE_PATH" ] && [ -z "$PRIOR_ALIAS_PATH" ]; then
    if [ -n "$BACKUP_TEMP_PATH" ]; then
      discard_regular_artifact "$BACKUP_TEMP_PATH" "$OLD_TARGET_SHA256" "$OLD_TARGET_IDENTITY" || return 1
      BACKUP_TEMP_PATH=""
    fi
    if [ -n "$INSTALLED_ALIAS_ANCHOR_PATH" ]; then
      discard_symlink_artifact "$INSTALLED_ALIAS_ANCHOR_PATH" "$CANONICAL_ALIAS_TARGET_SHA256" "$INSTALLED_ALIAS_IDENTITY" || return 1
      INSTALLED_ALIAS_ANCHOR_PATH=""
    fi
    RECOVERY_STATE_PATH=""
    RECOVERY_RETIRED_PATH=""
    RECOVERY_RETIRED_SHA256=""
    RECOVERY_RETIRED_IDENTITY=""
    RECOVERY_RETIRED=0
    RECOVERY_RETIREMENT_GUARD=0
    [ "$CLEANUP_PENDING" -eq 0 ]
    return $?
  fi
  [ -n "$RECOVERY_STATE_PATH" ] || return 1
  [ -n "$RECOVERY_RETIRED_PATH" ] || return 1
  assert_lock_owned || return 1
  RECOVERY_RETIREMENT_GUARD=1
  recovery_retired_metadata=""
  if recovery_retired_metadata=$(process_recovery_state retire); then
    :
  else
    return 1
  fi
  [ -n "$recovery_retired_metadata" ] && [ "${recovery_retired_metadata#* }" != "$recovery_retired_metadata" ] || return 1
  RECOVERY_RETIRED_IDENTITY=${recovery_retired_metadata%% *}
  RECOVERY_RETIRED_SHA256=${recovery_retired_metadata#* }
  RECOVERY_STATE_PATH=""
  RECOVERY_RETIRED=1

  if [ -n "$BACKUP_TEMP_PATH" ]; then
    discard_regular_artifact "$BACKUP_TEMP_PATH" "$OLD_TARGET_SHA256" "$OLD_TARGET_IDENTITY" || return 1
    BACKUP_TEMP_PATH=""
  fi
  if [ -n "$PRIOR_TARGET_PATH" ]; then
    discard_regular_artifact "$PRIOR_TARGET_PATH" "$OLD_TARGET_SHA256" "$OLD_TARGET_IDENTITY" || return 1
    PRIOR_TARGET_PATH=""
  fi
  if [ -n "$PRIOR_BACKUP_PATH" ]; then
    discard_regular_artifact "$PRIOR_BACKUP_PATH" "$OLD_BACKUP_SHA256" "$OLD_BACKUP_IDENTITY" || return 1
    PRIOR_BACKUP_PATH=""
  fi
  if [ -n "$PRIOR_LINEAGE_PATH" ]; then
    discard_regular_artifact "$PRIOR_LINEAGE_PATH" "$OLD_LINEAGE_SHA256" "$OLD_LINEAGE_IDENTITY" || return 1
    PRIOR_LINEAGE_PATH=""
  fi
  if [ -n "$PRIOR_ALIAS_PATH" ]; then
    discard_symlink_artifact "$PRIOR_ALIAS_PATH" "$OLD_ALIAS_TARGET_SHA256" "$OLD_ALIAS_IDENTITY" || return 1
    PRIOR_ALIAS_PATH=""
  fi
  if [ -n "$INSTALLED_ALIAS_ANCHOR_PATH" ]; then
    discard_symlink_artifact "$INSTALLED_ALIAS_ANCHOR_PATH" "$CANONICAL_ALIAS_TARGET_SHA256" "$INSTALLED_ALIAS_IDENTITY" || return 1
    INSTALLED_ALIAS_ANCHOR_PATH=""
  fi

  assert_lock_owned || return 1
  RECOVERY_DELETE_PATH="$RECOVERY_RETIRED_PATH.cleanup-$TRANSACTION_ID"
  mutate_public_path \
    delete \
    "$RECOVERY_RETIRED_PATH" \
    "" \
    "$RECOVERY_DELETE_PATH" \
    regular \
    "$RECOVERY_RETIRED_SHA256" \
    "$RECOVERY_RETIRED_IDENTITY" \
    absent \
    "" \
    "" || return 1
  RECOVERY_DELETE_PATH=""
  RECOVERY_RETIRED_PATH=""
  RECOVERY_RETIRED_SHA256=""
  RECOVERY_RETIRED_IDENTITY=""
  RECOVERY_RETIRED=0
  RECOVERY_RETIREMENT_GUARD=0
  [ "$CLEANUP_PENDING" -eq 0 ]
}

write_install_transaction_journal() {
  journal_phase=$1
  journal_decision=$2
  python3 - \
    "$JOURNAL_PATH" \
    "$INSTALL_DIR" \
    "$TRANSACTION_ID" \
    "$journal_phase" \
    "$journal_decision" \
    "$ARTIFACT_SHA256" \
    "$HAD_TARGET" \
    "$OLD_TARGET_SHA256" \
    "$HAD_BACKUP" \
    "$OLD_BACKUP_SHA256" \
    "$HAD_ALIAS" \
    "$OLD_ALIAS_TARGET_SHA256" \
    "$HAD_LINEAGE" \
    "$OLD_LINEAGE_SHA256" <<'PY'
import datetime, errno, json, os, re, stat, sys, uuid

(
    journal_path,
    directory,
    transaction_id,
    phase,
    decision,
    expected_sha,
    had_target,
    target_before_sha,
    had_backup,
    backup_before_sha,
    had_alias,
    alias_before_sha,
    had_lineage,
    lineage_before_sha,
) = sys.argv[1:]
phases = {
    'prepared',
    'target-committed',
    'backup-committed',
    'alias-committed',
    'verified',
    'lineage-committed',
    'committed',
}

if phase not in phases or decision not in ('rollback', 'commit'):
    raise SystemExit('invalid native install transaction phase or decision')
if (phase == 'committed') != (decision == 'commit'):
    raise SystemExit('native install transaction decision does not match its phase')
try:
    transaction_id = str(uuid.UUID(transaction_id))
except ValueError as error:
    raise SystemExit('invalid native install transaction ID') from error
hash_pattern = re.compile(r'^[0-9a-f]{64}$')
if hash_pattern.fullmatch(expected_sha) is None:
    raise SystemExit('invalid native install expected SHA-256')

def before_state(flag, value):
    present = flag == '1'
    if flag not in ('0', '1'):
        raise SystemExit('invalid native install pre-state flag')
    if present:
        if hash_pattern.fullmatch(value) is None:
            raise SystemExit('invalid native install pre-state SHA-256')
        return True, value
    if value:
        raise SystemExit('absent native install pre-state has a digest')
    return False, None

had_target, target_before_sha = before_state(had_target, target_before_sha)
had_backup, backup_before_sha = before_state(had_backup, backup_before_sha)
had_alias, alias_before_sha = before_state(had_alias, alias_before_sha)
had_lineage, lineage_before_sha = before_state(had_lineage, lineage_before_sha)
payload = {
    'schema': 'chainlesschain.native-install-transaction.v1',
    'transactionId': transaction_id,
    'operation': 'install',
    'phase': phase,
    'decision': decision,
    'expectedSha256': expected_sha,
    'hadTarget': had_target,
    'targetBeforeSha256': target_before_sha,
    'hadBackup': had_backup,
    'backupBeforeSha256': backup_before_sha,
    'hadAlias': had_alias,
    'aliasBeforeSha256': alias_before_sha,
    'hadLineage': had_lineage,
    'lineageBeforeSha256': lineage_before_sha,
    'updatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z'),
}
payload_bytes = (json.dumps(payload, separators=(',', ':'), sort_keys=True) + '\n').encode()
temporary_path = os.path.join(directory, f'.chainlesschain.install-journal-{transaction_id}.tmp')
if os.path.lexists(temporary_path):
    raise SystemExit('native install journal staging path already exists')
if os.path.lexists(journal_path):
    existing = os.lstat(journal_path)
    if not stat.S_ISREG(existing.st_mode):
        raise SystemExit('native install journal is not a regular file')
    flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
    fd = os.open(journal_path, flags)
    try:
        current = json.loads(os.read(fd, 1024 * 1024))
    finally:
        os.close(fd)
    if current.get('transactionId') != transaction_id:
        raise SystemExit('another native install transaction journal exists')
flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, 'O_NOFOLLOW', 0)
fd = os.open(temporary_path, flags, 0o600)
try:
    os.write(fd, payload_bytes)
    os.fsync(fd)
finally:
    os.close(fd)
os.replace(temporary_path, journal_path)
dir_fd = os.open(directory, os.O_RDONLY)
try:
    try:
        os.fsync(dir_fd)
    except OSError as error:
        if error.errno not in (errno.EBADF, errno.EINVAL, getattr(errno, 'ENOTSUP', errno.EINVAL), getattr(errno, 'EOPNOTSUPP', errno.EINVAL)):
            raise
finally:
    os.close(dir_fd)
PY
}

read_install_transaction_decision() {
  python3 - "$JOURNAL_PATH" "$TRANSACTION_ID" <<'PY'
import json, os, stat, sys

journal_path, transaction_id = sys.argv[1:]
flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
fd = os.open(journal_path, flags)
try:
    before = os.fstat(fd)
    path_before = os.lstat(journal_path)
    payload = os.read(fd, 1024 * 1024)
    after = os.fstat(fd)
    path_after = os.lstat(journal_path)
finally:
    os.close(fd)
values = (before, path_before, after, path_after)
if (
    not all(stat.S_ISREG(value.st_mode) for value in values)
    or len({(value.st_dev, value.st_ino) for value in values}) != 1
    or before.st_size != after.st_size
    or after.st_size != len(payload)
):
    raise SystemExit('native install journal changed while its decision was read')
value = json.loads(payload)
decision = value.get('decision')
if (
    value.get('schema') != 'chainlesschain.native-install-transaction.v1'
    or value.get('transactionId') != transaction_id
    or decision not in ('rollback', 'commit')
    or ((value.get('phase') == 'committed') != (decision == 'commit'))
):
    raise SystemExit('native install journal decision is invalid')
print(decision)
PY
}

retire_install_transaction_journal() {
  expected_decision=$1
  [ -n "$JOURNAL_PATH" ] || return 0
  [ -e "$JOURNAL_PATH" ] || return 0
  python3 - "$JOURNAL_PATH" "$JOURNAL_PATH.last" "$INSTALL_DIR" "$TRANSACTION_ID" "$expected_decision" <<'PY'
import errno, json, os, stat, sys

journal_path, retired_path, directory, transaction_id, expected_decision = sys.argv[1:]
flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
fd = os.open(journal_path, flags)
try:
    before = os.fstat(fd)
    path_before = os.lstat(journal_path)
    payload = os.read(fd, 1024 * 1024)
    after = os.fstat(fd)
    path_after = os.lstat(journal_path)
finally:
    os.close(fd)
if not all(stat.S_ISREG(value.st_mode) for value in (before, path_before, after, path_after)):
    raise SystemExit('native install journal is not a regular file')
identities = {(value.st_dev, value.st_ino) for value in (before, path_before, after, path_after)}
if len(identities) != 1 or before.st_size != after.st_size or after.st_size != len(payload):
    raise SystemExit('native install journal changed before retirement')
value = json.loads(payload)
if value.get('transactionId') != transaction_id or value.get('decision') != expected_decision:
    raise SystemExit('native install journal does not match its retirement decision')
if (value.get('phase') == 'committed') != (expected_decision == 'commit'):
    raise SystemExit('native install journal phase does not match its retirement decision')
if os.path.lexists(retired_path) and not stat.S_ISREG(os.lstat(retired_path).st_mode):
    raise SystemExit('retired native install journal is not a regular file')
os.replace(journal_path, retired_path)
dir_fd = os.open(directory, os.O_RDONLY)
try:
    try:
        os.fsync(dir_fd)
    except OSError as error:
        if error.errno not in (errno.EBADF, errno.EINVAL, getattr(errno, 'ENOTSUP', errno.EINVAL), getattr(errno, 'EOPNOTSUPP', errno.EINVAL)):
            raise
finally:
    os.close(dir_fd)
PY
  JOURNAL_PATH=""
}

crash_after_install_phase() {
  crash_phase=$1
  if [ "${CC_CLI_INSTALL_CRASH_AFTER_PHASE:-}" = "$crash_phase" ]; then
    kill -KILL "$$"
  fi
  if [ "${CC_CLI_INSTALL_TERMINATE_AFTER_PHASE:-}" = "$crash_phase" ]; then
    kill -TERM "$$"
  fi
}

resolve_stale_install_lock() {
  python3 - "$LOCK_PATH" "$INSTALL_DIR" <<'PY'
import errno, os, re, stat, sys, uuid

lock_path, directory = sys.argv[1:]
try:
    path_before = os.lstat(lock_path)
except FileNotFoundError:
    raise SystemExit(0)
if not stat.S_ISREG(path_before.st_mode):
    raise SystemExit('native update lock is not a regular file')
flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
fd = os.open(lock_path, flags)
try:
    before = os.fstat(fd)
    token = os.read(fd, 129).decode('utf-8')
    after = os.fstat(fd)
    path_after = os.lstat(lock_path)
finally:
    os.close(fd)
identities = {(value.st_dev, value.st_ino) for value in (path_before, before, after, path_after)}
if (
    len(identities) != 1
    or not all(stat.S_ISREG(value.st_mode) for value in (before, after, path_after))
    or before.st_size != after.st_size
    or after.st_size != len(token.encode('utf-8'))
):
    raise SystemExit('native update lock changed during stale-lock validation')
match = re.fullmatch(
    r'([1-9][0-9]*):(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})',
    token,
)
if match is None:
    raise SystemExit('native update lock token is invalid and requires manual recovery')
owner_pid = int(match.group(1))
try:
    os.kill(owner_pid, 0)
except ProcessLookupError:
    pass
except PermissionError:
    raise SystemExit(f'native update lock owner PID {owner_pid} is still live')
else:
    raise SystemExit(f'native update lock owner PID {owner_pid} is still live')
orphan_path = f'{lock_path}.orphaned-{uuid.uuid4().hex}'
os.rename(lock_path, orphan_path)
orphan = os.lstat(orphan_path)
if (orphan.st_dev, orphan.st_ino) != (after.st_dev, after.st_ino):
    raise SystemExit('stale native update lock changed during quarantine')
dir_fd = os.open(directory, os.O_RDONLY)
try:
    try:
        os.fsync(dir_fd)
    except OSError as error:
        if error.errno not in (errno.EBADF, errno.EINVAL, getattr(errno, 'ENOTSUP', errno.EINVAL), getattr(errno, 'EOPNOTSUPP', errno.EINVAL)):
            raise
finally:
    os.close(dir_fd)
print(orphan_path)
PY
}

recover_interrupted_install() {
  python3 - \
    "$JOURNAL_PATH" \
    "$JOURNAL_PATH.last" \
    "$INSTALL_DIR" \
    "$TARGET_PATH" \
    "$BACKUP_PATH" \
    "$ALIAS_PATH" \
    "$LINEAGE_PATH" <<'PY'
import errno, hashlib, json, os, re, shutil, stat, sys, uuid

journal_path, retired_journal_path, directory, target_path, backup_path, alias_path, lineage_path = sys.argv[1:]
hash_pattern = re.compile(r'^[0-9a-f]{64}$')
phases = {
    'prepared', 'target-committed', 'backup-committed', 'alias-committed',
    'verified', 'lineage-committed', 'committed',
}
unsupported_fsync = {
    errno.EBADF, errno.EINVAL, getattr(errno, 'ENOTSUP', errno.EINVAL),
    getattr(errno, 'EOPNOTSUPP', errno.EINVAL),
}

def barrier():
    fd = os.open(directory, os.O_RDONLY)
    try:
        try:
            os.fsync(fd)
        except OSError as error:
            if error.errno not in unsupported_fsync:
                raise
    finally:
        os.close(fd)

def read_regular(path, capture=False, max_capture_bytes=1024 * 1024):
    flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
    fd = os.open(path, flags)
    try:
        before = os.fstat(fd)
        path_before = os.lstat(path)
        digest = hashlib.sha256()
        blocks = []
        while True:
            block = os.read(fd, 1024 * 1024)
            if not block:
                break
            digest.update(block)
            if capture:
                blocks.append(block)
                if sum(len(value) for value in blocks) > max_capture_bytes:
                    raise RuntimeError(f'recovery metadata is oversized: {path}')
        after = os.fstat(fd)
        path_after = os.lstat(path)
    finally:
        os.close(fd)
    values = (before, path_before, after, path_after)
    identities = {(value.st_dev, value.st_ino) for value in values}
    if (
        not all(stat.S_ISREG(value.st_mode) for value in values)
        or len(identities) != 1
        or before.st_size != after.st_size
        or before.st_mtime_ns != after.st_mtime_ns
        or before.st_ctime_ns != after.st_ctime_ns
    ):
        raise RuntimeError(f'regular recovery path changed while read: {path}')
    return b''.join(blocks), digest.hexdigest(), f'{after.st_dev}:{after.st_ino}:{after.st_mode}'

journal_bytes, _, _ = read_regular(journal_path, capture=True)
try:
    journal = json.loads(journal_bytes)
    transaction_id = str(uuid.UUID(journal.get('transactionId', '')))
except (AttributeError, TypeError, ValueError, json.JSONDecodeError) as error:
    raise SystemExit('native install transaction journal is invalid') from error
required = {
    'schema', 'transactionId', 'operation', 'phase', 'decision', 'expectedSha256',
    'hadTarget', 'targetBeforeSha256', 'hadBackup', 'backupBeforeSha256',
    'hadAlias', 'aliasBeforeSha256', 'hadLineage', 'lineageBeforeSha256', 'updatedAt',
}
if set(journal) != required:
    raise SystemExit('native install transaction journal fields are invalid')
if (
    journal['schema'] != 'chainlesschain.native-install-transaction.v1'
    or journal['transactionId'] != transaction_id
    or journal['operation'] != 'install'
    or journal['phase'] not in phases
    or journal['decision'] not in ('rollback', 'commit')
    or (journal['phase'] == 'committed') != (journal['decision'] == 'commit')
    or hash_pattern.fullmatch(journal.get('expectedSha256', '')) is None
):
    raise SystemExit('native install transaction journal failed schema validation')

def prestate(flag_name, hash_name):
    present = journal.get(flag_name)
    digest = journal.get(hash_name)
    if type(present) is not bool:
        raise SystemExit(f'native install transaction {flag_name} is invalid')
    if (present and (not isinstance(digest, str) or hash_pattern.fullmatch(digest) is None)) or (not present and digest is not None):
        raise SystemExit(f'native install transaction {hash_name} is invalid')
    return present, digest

had_target, target_before = prestate('hadTarget', 'targetBeforeSha256')
had_backup, backup_before = prestate('hadBackup', 'backupBeforeSha256')
had_alias, alias_before = prestate('hadAlias', 'aliasBeforeSha256')
had_lineage, lineage_before = prestate('hadLineage', 'lineageBeforeSha256')
expected = journal['expectedSha256']
prior_target = os.path.join(directory, f'.chainlesschain.target-prior-{transaction_id}')
prior_backup = os.path.join(directory, f'.chainlesschain.backup-prior-{transaction_id}')
prior_lineage = os.path.join(directory, f'.chainlesschain.lineage-prior-{transaction_id}')
prior_alias = os.path.join(directory, f'.cc.prior-{transaction_id}')
pointer = os.path.join(directory, f'.chainlesschain.recovery-{transaction_id}.json')

members = {
    'priorTarget': (prior_target, had_target, target_before, 'regular'),
    'priorBackup': (prior_backup, had_backup, backup_before, 'regular'),
    'priorLineage': (prior_lineage, had_lineage, lineage_before, 'regular'),
    'priorAlias': (prior_alias, had_alias, alias_before, 'symlink'),
}
if any(value[1] for value in members.values()):
    pointer_bytes, _, _ = read_regular(pointer, capture=True)
    pointer_value = json.loads(pointer_bytes)
    if pointer_value.get('schema') != 'chainlesschain.native-install-recovery.v1' or pointer_value.get('transactionId') != transaction_id:
        raise SystemExit('native install recovery pointer does not match its journal')
    if set(pointer_value.get('members', {})) != set(members):
        raise SystemExit('native install recovery pointer members are invalid')
    for name, (member_path, present, digest, kind) in members.items():
        value = pointer_value['members'][name]
        expected_path = member_path if present else None
        digest_key = 'targetSha256' if kind == 'symlink' else 'sha256'
        if value.get('path') != expected_path or value.get(digest_key) != digest:
            raise SystemExit(f'{name} recovery pointer member is not canonical')
        if not present:
            continue
        if kind == 'regular':
            _, actual_digest, actual_identity = read_regular(member_path)
        else:
            before = os.lstat(member_path)
            raw_target = os.readlink(member_path)
            after = os.lstat(member_path)
            if not stat.S_ISLNK(before.st_mode) or (before.st_dev, before.st_ino) != (after.st_dev, after.st_ino):
                raise SystemExit('native install alias recovery snapshot changed')
            actual_digest = hashlib.sha256(os.fsencode(raw_target)).hexdigest()
            actual_identity = f'{after.st_dev}:{after.st_ino}:{after.st_mode}'
        if actual_digest != digest or value.get('identity') != actual_identity:
            raise SystemExit(f'{name} recovery member changed')
elif os.path.lexists(pointer):
    raise SystemExit('unexpected native install recovery pointer')

def regular_digest_or_none(path):
    try:
        value = os.lstat(path)
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(value.st_mode):
        raise SystemExit(f'native install public path has an unsafe type: {path}')
    return read_regular(path)[1]

def alias_digest_or_none(path):
    try:
        value = os.lstat(path)
    except FileNotFoundError:
        return None
    if not stat.S_ISLNK(value.st_mode):
        raise SystemExit('native install alias has an unsafe type')
    return hashlib.sha256(os.fsencode(os.readlink(path))).hexdigest()

def lineage_matches_new():
    digest = regular_digest_or_none(lineage_path)
    if digest is None:
        return False
    value = json.loads(read_regular(lineage_path, capture=True)[0])
    return (
        value.get('schema') == 'chainlesschain.native-update-lineage.v1'
        and value.get('transactionId') == transaction_id
        and value.get('currentSha256') == expected
    )

def restore_regular(source, destination, digest, label):
    _, source_digest, _ = read_regular(source)
    if source_digest != digest:
        raise SystemExit(f'{label} recovery source changed')
    staging = f'{destination}.restart-recovery-{transaction_id}'
    if os.path.lexists(staging):
        raise SystemExit(f'{label} recovery staging path exists')
    shutil.copyfile(source, staging, follow_symlinks=False)
    os.chmod(staging, stat.S_IMODE(os.lstat(source).st_mode))
    fd = os.open(staging, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
    if read_regular(staging)[1] != digest:
        raise SystemExit(f'{label} recovery staging changed')
    os.replace(staging, destination)
    barrier()
    if read_regular(destination)[1] != digest:
        raise SystemExit(f'{label} recovery failed verification')

def remove_known_regular(path, allowed, label):
    digest = regular_digest_or_none(path)
    if digest is None:
        return
    if digest not in {value for value in allowed if value}:
        raise SystemExit(f'{label} has an unknown generation')
    retired = f'{path}.restart-retired-{transaction_id}'
    if os.path.lexists(retired):
        raise SystemExit(f'{label} retirement path already exists')
    os.rename(path, retired)
    barrier()

canonical_alias_digest = hashlib.sha256(b'chainlesschain').hexdigest()
if journal['decision'] == 'commit':
    if regular_digest_or_none(target_path) != expected:
        raise SystemExit('committed native install target does not match its decision')
    expected_backup = target_before if had_target else None
    if regular_digest_or_none(backup_path) != expected_backup:
        raise SystemExit('committed native install backup does not match its decision')
    if alias_digest_or_none(alias_path) != canonical_alias_digest:
        raise SystemExit('committed native install alias does not match its decision')
    if not lineage_matches_new():
        raise SystemExit('committed native install lineage does not match its decision')
    outcome = 'committed'
else:
    current_target = regular_digest_or_none(target_path)
    if had_target:
        if current_target not in (target_before, expected, None):
            raise SystemExit('interrupted native install target has an unknown generation')
        if current_target != target_before:
            restore_regular(prior_target, target_path, target_before, 'target')
    else:
        remove_known_regular(target_path, (expected,), 'fresh native install target')

    current_backup = regular_digest_or_none(backup_path)
    if had_backup:
        if current_backup not in (backup_before, target_before, None):
            raise SystemExit('interrupted native install backup has an unknown generation')
        if current_backup != backup_before:
            restore_regular(prior_backup, backup_path, backup_before, 'backup')
    else:
        remove_known_regular(backup_path, (target_before,), 'fresh native install backup')

    current_alias = alias_digest_or_none(alias_path)
    if had_alias:
        if current_alias not in (alias_before, canonical_alias_digest, None):
            raise SystemExit('interrupted native install alias has an unknown generation')
        if current_alias != alias_before:
            raw_target = os.readlink(prior_alias)
            staging = f'{alias_path}.restart-recovery-{transaction_id}'
            if os.path.lexists(staging):
                raise SystemExit('alias recovery staging path exists')
            os.symlink(raw_target, staging)
            os.replace(staging, alias_path)
            barrier()
            if alias_digest_or_none(alias_path) != alias_before:
                raise SystemExit('alias recovery failed verification')
    elif current_alias is not None:
        if current_alias != canonical_alias_digest:
            raise SystemExit('fresh native install alias has an unknown generation')
        retired_alias = f'{alias_path}.restart-retired-{transaction_id}'
        if os.path.lexists(retired_alias):
            raise SystemExit('fresh native install alias retirement path already exists')
        os.rename(alias_path, retired_alias)
        barrier()

    current_lineage = regular_digest_or_none(lineage_path)
    if had_lineage:
        if current_lineage != lineage_before:
            if current_lineage is not None and not lineage_matches_new():
                raise SystemExit('interrupted native install lineage has an unknown generation')
            restore_regular(prior_lineage, lineage_path, lineage_before, 'lineage')
    elif current_lineage is not None:
        if not lineage_matches_new():
            raise SystemExit('fresh native install lineage has an unknown generation')
        retired_lineage = f'{lineage_path}.restart-retired-{transaction_id}'
        if os.path.lexists(retired_lineage):
            raise SystemExit('fresh native install lineage retirement path already exists')
        os.rename(lineage_path, retired_lineage)
        barrier()
    outcome = 'rolled-back'

if os.path.lexists(retired_journal_path) and not stat.S_ISREG(os.lstat(retired_journal_path).st_mode):
    raise SystemExit('retired native install journal has an unsafe type')
os.replace(journal_path, retired_journal_path)
barrier()

# Once the fixed journal name has been durably retired, leftovers are private,
# transaction-derived evidence only. POSIX has no conditional unlink-by-inode;
# a bounded, identity-aware GC owns their later retirement.
print(outcome)
PY
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
    TARGET_CLAIM_PATH="$INSTALL_DIR/.chainlesschain.target-claimed-$TRANSACTION_ID"
    assert_lock_owned || return 1
    regular_file_matches "$TARGET_PATH" "$ARTIFACT_SHA256" "$INSTALLED_TARGET_IDENTITY" || return 1
    mutate_public_path \
      replace \
      "$TARGET_PATH" \
      "$ROLLBACK_TEMP_PATH" \
      "$TARGET_CLAIM_PATH" \
      regular \
      "$ARTIFACT_SHA256" \
      "$INSTALLED_TARGET_IDENTITY" \
      regular \
      "$OLD_TARGET_SHA256" \
      "$OLD_TARGET_IDENTITY" || return 1
    ROLLBACK_TEMP_PATH=""
    TARGET_CLAIM_PATH=""
    regular_file_matches "$TARGET_PATH" "$OLD_TARGET_SHA256" "$OLD_TARGET_IDENTITY" || return 1
  else
    TARGET_CLAIM_PATH="$INSTALL_DIR/.chainlesschain.target-claimed-$TRANSACTION_ID"
    assert_lock_owned || return 1
    regular_file_matches "$TARGET_PATH" "$ARTIFACT_SHA256" "$INSTALLED_TARGET_IDENTITY" || return 1
    mutate_public_path \
      delete \
      "$TARGET_PATH" \
      "" \
      "$TARGET_CLAIM_PATH" \
      regular \
      "$ARTIFACT_SHA256" \
      "$INSTALLED_TARGET_IDENTITY" \
      absent \
      "" \
      "" || return 1
    TARGET_CLAIM_PATH=""
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
      BACKUP_CLAIM_PATH="$INSTALL_DIR/.chainlesschain.backup-claimed-$TRANSACTION_ID"
      assert_lock_owned || return 1
      regular_file_matches "$BACKUP_PATH" "$OLD_TARGET_SHA256" "$OLD_TARGET_IDENTITY" || return 1
      mutate_public_path \
        replace \
        "$BACKUP_PATH" \
        "$BACKUP_RESTORE_PATH" \
        "$BACKUP_CLAIM_PATH" \
        regular \
        "$OLD_TARGET_SHA256" \
        "$OLD_TARGET_IDENTITY" \
        regular \
        "$OLD_BACKUP_SHA256" \
        "$OLD_BACKUP_IDENTITY" || return 1
      BACKUP_RESTORE_PATH=""
      BACKUP_CLAIM_PATH=""
      regular_file_matches "$BACKUP_PATH" "$OLD_BACKUP_SHA256" "$OLD_BACKUP_IDENTITY" || return 1
    else
      BACKUP_CLAIM_PATH="$INSTALL_DIR/.chainlesschain.backup-claimed-$TRANSACTION_ID"
      assert_lock_owned || return 1
      regular_file_matches "$BACKUP_PATH" "$OLD_TARGET_SHA256" "$OLD_TARGET_IDENTITY" || return 1
      mutate_public_path \
        delete \
        "$BACKUP_PATH" \
        "" \
        "$BACKUP_CLAIM_PATH" \
        regular \
        "$OLD_TARGET_SHA256" \
        "$OLD_TARGET_IDENTITY" \
        absent \
        "" \
        "" || return 1
      BACKUP_CLAIM_PATH=""
      [ ! -e "$BACKUP_PATH" ] && [ ! -L "$BACKUP_PATH" ] || return 1
    fi
    # Publication consumes BACKUP_TEMP_PATH by moving its exact inode to the
    # public backup name. A signal can arrive after that durable publication but
    # before the caller clears the shell variable. Once the backup rollback has
    # completed and validated the prior public generation above, the old staging
    # pathname is stale. Clear it here so snapshot retirement does not treat its
    # expected absence as lost recovery evidence. Do not delete by that pathname:
    # a same-name successor may already exist.
    BACKUP_TEMP_PATH=""
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
        LINEAGE_CLAIM_PATH="$INSTALL_DIR/.chainlesschain.lineage-claimed-$TRANSACTION_ID"
        assert_lock_owned || return 1
        lineage_matches_transaction "$ARTIFACT_SHA256" "$lineage_previous_sha" "$INSTALLED_LINEAGE_IDENTITY" "$INSTALLED_LINEAGE_SHA256" || return 1
        # Occupy the current public lineage without overwrite before publishing
        # the exact fd-bound prior generation from its same-directory stage.
        mutate_public_path \
          replace \
          "$LINEAGE_PATH" \
          "$LINEAGE_RESTORE_PATH" \
          "$LINEAGE_CLAIM_PATH" \
          regular \
          "$INSTALLED_LINEAGE_SHA256" \
          "$INSTALLED_LINEAGE_IDENTITY" \
          regular \
          "$OLD_LINEAGE_SHA256" \
          "$OLD_LINEAGE_IDENTITY" || return 1
        LINEAGE_RESTORE_PATH=""
        LINEAGE_CLAIM_PATH=""
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
        LINEAGE_CLAIM_PATH="$INSTALL_DIR/.chainlesschain.lineage-claimed-$TRANSACTION_ID"
        assert_lock_owned || return 1
        mutate_public_path \
          delete \
          "$LINEAGE_PATH" \
          "" \
          "$LINEAGE_CLAIM_PATH" \
          regular \
          "$INSTALLED_LINEAGE_SHA256" \
          "$INSTALLED_LINEAGE_IDENTITY" \
          absent \
          "" \
          "" || return 1
        LINEAGE_CLAIM_PATH=""
      fi
      [ ! -e "$LINEAGE_PATH" ] && [ ! -L "$LINEAGE_PATH" ] || return 1
    fi
    LINEAGE_COMMIT_STARTED=0
  fi

  if [ "$ALIAS_COMMITTED" -eq 1 ]; then
    if [ "$HAD_ALIAS" -eq 1 ]; then
      [ -n "$PRIOR_ALIAS_PATH" ] || return 1
      [ -n "$OLD_ALIAS_TARGET_SHA256" ] || return 1
      alias_matches_identity "$PRIOR_ALIAS_PATH" "$OLD_ALIAS_TARGET_SHA256" "$OLD_ALIAS_IDENTITY" || return 1
      ALIAS_RESTORE_PATH="$INSTALL_DIR/.cc.restore-$TRANSACTION_ID"
      [ ! -e "$ALIAS_RESTORE_PATH" ] && [ ! -L "$ALIAS_RESTORE_PATH" ] || return 1
      create_alias_restore_candidate "$PRIOR_ALIAS_PATH" "$ALIAS_RESTORE_PATH" "$OLD_ALIAS_TARGET_SHA256" || return 1
      alias_matches_hash "$ALIAS_RESTORE_PATH" "$OLD_ALIAS_TARGET_SHA256" || return 1
      alias_restore_identity=$(symlink_identity "$ALIAS_RESTORE_PATH") || return 1
      ALIAS_CLAIM_PATH="$INSTALL_DIR/.cc.claimed-$TRANSACTION_ID"
      assert_lock_owned || return 1
      alias_matches_identity "$ALIAS_PATH" "$CANONICAL_ALIAS_TARGET_SHA256" "$INSTALLED_ALIAS_IDENTITY" || return 1
      mutate_public_path \
        replace \
        "$ALIAS_PATH" \
        "$ALIAS_RESTORE_PATH" \
        "$ALIAS_CLAIM_PATH" \
        symlink \
        "$CANONICAL_ALIAS_TARGET_SHA256" \
        "$INSTALLED_ALIAS_IDENTITY" \
        symlink \
        "$OLD_ALIAS_TARGET_SHA256" \
        "$alias_restore_identity" || return 1
      ALIAS_RESTORE_PATH=""
      ALIAS_CLAIM_PATH=""
      alias_matches_hash "$ALIAS_PATH" "$OLD_ALIAS_TARGET_SHA256" || return 1
    else
      ALIAS_CLAIM_PATH="$INSTALL_DIR/.cc.claimed-$TRANSACTION_ID"
      alias_matches_identity "$ALIAS_PATH" "$CANONICAL_ALIAS_TARGET_SHA256" "$INSTALLED_ALIAS_IDENTITY" || return 1
      assert_lock_owned || return 1
      alias_matches_identity "$ALIAS_PATH" "$CANONICAL_ALIAS_TARGET_SHA256" "$INSTALLED_ALIAS_IDENTITY" || return 1
      mutate_public_path \
        delete \
        "$ALIAS_PATH" \
        "" \
        "$ALIAS_CLAIM_PATH" \
        symlink \
        "$CANONICAL_ALIAS_TARGET_SHA256" \
        "$INSTALLED_ALIAS_IDENTITY" \
        absent \
        "" \
        "" || return 1
      ALIAS_CLAIM_PATH=""
      [ ! -e "$ALIAS_PATH" ] && [ ! -L "$ALIAS_PATH" ] || return 1
    fi
    ALIAS_COMMITTED=0
  fi

  fsync_dir "$INSTALL_DIR" || return 1
  if ! discard_transaction_snapshots; then
    # Every public path is already restored and durably validated. Retained
    # private tombstones make cleanup degraded, not the semantic rollback.
    [ "$CLEANUP_PENDING" -eq 1 ] && [ "$RECOVERY_RETIREMENT_GUARD" -eq 0 ] || return 1
  fi
}

# Recover the fixed durable journal before release tooling or network access is
# required. This path intentionally performs no manifest download.
assert_safe_install_dir "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
assert_safe_install_dir "$INSTALL_DIR"
INSTALL_DIR=$(cd -P "$INSTALL_DIR" && pwd)
TARGET_PATH="$INSTALL_DIR/chainlesschain"
BACKUP_PATH="$TARGET_PATH.previous"
ALIAS_PATH="$INSTALL_DIR/cc"
LOCK_PATH="$TARGET_PATH.update.lock"
LINEAGE_PATH="$TARGET_PATH.update-lineage.json"
JOURNAL_PATH="$TARGET_PATH.update-transaction.json"
RESULT_PATH="$TARGET_PATH.update-result.json"
LAST_RESULT_PATH="$TARGET_PATH.update-result.last.json"
assert_regular_file_or_missing "$JOURNAL_PATH" "native install transaction journal"

stale_lock_path=$(resolve_stale_install_lock)
if [ -n "$stale_lock_path" ]; then
  echo "quarantined stale native update lock at $stale_lock_path" >&2
fi
recovered_transaction=""
if [ -f "$JOURNAL_PATH" ]; then
  TRANSACTION_ID=$(python3 -c 'import uuid; print(uuid.uuid4())')
  LOCK_TOKEN="$$:$(python3 -c 'import uuid; print(uuid.uuid4().hex)')"
  if LOCK_IDENTITY=$(acquire_update_lock "$LOCK_PATH" "$LOCK_TOKEN" 2>/dev/null); then
    LOCK_HELD=1
  else
    die "another ChainlessChain CLI install/update is already in progress"
  fi
  if recovered_transaction=$(recover_interrupted_install); then
    :
  else
    PRESERVE_RECOVERY=1
    die "interrupted native install recovery failed closed"
  fi
  if release_update_lock; then
    LOCK_HELD=0
  else
    PRESERVE_RECOVERY=1
    die "interrupted native install recovered but its lock could not be retired"
  fi
  echo "recovered interrupted native install transaction ($recovered_transaction)" >&2
fi
if [ "${CC_CLI_INSTALL_RECOVERY_ONLY:-0}" = "1" ]; then
  [ -n "$recovered_transaction" ] || die "recovery-only mode found no interrupted native install transaction"
  exit 0
fi

command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 2; }
command -v cosign >/dev/null 2>&1 || {
  echo "cosign is required to verify the signed CLI release" >&2
  exit 2
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
JOURNAL_PATH="$TARGET_PATH.update-transaction.json"
RESULT_PATH="$TARGET_PATH.update-result.json"
LAST_RESULT_PATH="$TARGET_PATH.update-result.last.json"

assert_regular_file_or_missing "$TARGET_PATH" "install target"
assert_regular_file_or_missing "$BACKUP_PATH" "last-known-good backup"
assert_regular_file_or_missing "$LINEAGE_PATH" "native update lineage"
assert_regular_file_or_missing "$JOURNAL_PATH" "native install transaction journal"
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
    BACKUP_ORPHAN_PATH="$BACKUP_PATH.orphaned-$TRANSACTION_ID"
    quarantine_regular_orphan "$BACKUP_PATH" "$BACKUP_ORPHAN_PATH" "orphaned last-known-good backup" || {
      PRESERVE_RECOVERY=1
      die "orphaned last-known-good backup quarantine failed closed"
    }
  fi
  if [ -f "$LINEAGE_PATH" ]; then
    LINEAGE_ORPHAN_PATH="$LINEAGE_PATH.orphaned-$TRANSACTION_ID"
    quarantine_regular_orphan "$LINEAGE_PATH" "$LINEAGE_ORPHAN_PATH" "orphaned native update lineage" || {
      PRESERVE_RECOVERY=1
      die "orphaned native update lineage quarantine failed closed"
    }
  fi
  fsync_dir "$INSTALL_DIR"
fi
CANDIDATE_PATH="$INSTALL_DIR/.chainlesschain.new.$TRANSACTION_ID"
[ ! -e "$CANDIDATE_PATH" ] && [ ! -L "$CANDIDATE_PATH" ] || die "candidate path already exists"
candidate_metadata=""
if candidate_metadata=$(materialize_candidate "$ARTIFACT" "$CANDIDATE_PATH" "$ARTIFACT_SHA256"); then
  :
else
  die "same-filesystem candidate materialization failed closed"
fi
[ -n "$candidate_metadata" ] && [ "${candidate_metadata#* }" != "$candidate_metadata" ] || die "candidate materialization returned invalid metadata"
CANDIDATE_IDENTITY=${candidate_metadata%% *}
candidate_sha=${candidate_metadata#* }
[ "$candidate_sha" = "$ARTIFACT_SHA256" ] || die "candidate materialization returned the wrong SHA-256"

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
  OLD_ALIAS_TARGET_SHA256=$(snapshot_alias "$ALIAS_PATH" "$PRIOR_ALIAS_PATH")
  OLD_ALIAS_IDENTITY=$(symlink_identity "$PRIOR_ALIAS_PATH")
  alias_matches_identity "$ALIAS_PATH" "$OLD_ALIAS_TARGET_SHA256" "$OLD_ALIAS_IDENTITY" || die "CLI alias changed during recovery snapshot creation"
  alias_matches_identity "$PRIOR_ALIAS_PATH" "$OLD_ALIAS_TARGET_SHA256" "$OLD_ALIAS_IDENTITY" || die "alias recovery snapshot changed during creation"
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
write_install_transaction_journal prepared rollback || die "could not persist native install transaction intent"
crash_after_install_phase prepared

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
  alias_matches_identity "$PRIOR_ALIAS_PATH" "$OLD_ALIAS_TARGET_SHA256" "$OLD_ALIAS_IDENTITY" || die "alias recovery snapshot changed while the transaction was staged"
elif [ -e "$ALIAS_PATH" ] || [ -L "$ALIAS_PATH" ]; then
  die "CLI alias appeared while the transaction was staged"
fi
regular_file_matches "$CANDIDATE_PATH" "$ARTIFACT_SHA256" "$CANDIDATE_IDENTITY" || die "same-filesystem candidate identity changed before commit"
INSTALLED_TARGET_IDENTITY=$CANDIDATE_IDENTITY
# Both paths are siblings, so this is the sole atomic commit point.
TARGET_CLAIM_PATH="$INSTALL_DIR/.chainlesschain.target-publish-claimed-$TRANSACTION_ID"
assert_lock_owned || die "native update lock ownership was lost before target commit"
SWAPPED=1
if [ "$HAD_TARGET" -eq 1 ]; then
  mutate_public_path \
    replace \
    "$TARGET_PATH" \
    "$CANDIDATE_PATH" \
    "$TARGET_CLAIM_PATH" \
    regular \
    "$OLD_TARGET_SHA256" \
    "$OLD_TARGET_IDENTITY" \
    regular \
    "$ARTIFACT_SHA256" \
    "$INSTALLED_TARGET_IDENTITY" || { PRESERVE_RECOVERY=1; die "install target publication failed closed"; }
else
  mutate_public_path \
    replace \
    "$TARGET_PATH" \
    "$CANDIDATE_PATH" \
    "$TARGET_CLAIM_PATH" \
    absent \
    "" \
    "" \
    regular \
    "$ARTIFACT_SHA256" \
    "$INSTALLED_TARGET_IDENTITY" || { PRESERVE_RECOVERY=1; die "install target publication failed closed"; }
fi
CANDIDATE_PATH=""
TARGET_CLAIM_PATH=""
fsync_dir "$INSTALL_DIR"
write_install_transaction_journal target-committed rollback || { PRESERVE_RECOVERY=1; die "could not persist target commit phase"; }
crash_after_install_phase target-committed

if [ "$(sha256_file "$TARGET_PATH")" != "$ARTIFACT_SHA256" ]; then
  die "installed target changed at the commit boundary"
fi
regular_file_matches "$TARGET_PATH" "$ARTIFACT_SHA256" "$INSTALLED_TARGET_IDENTITY" || die "installed target identity was unstable at the commit boundary"

# Publish the pending backup only after the canonical candidate has passed its
# fd-bound startup check. Before this point any failure restores from the
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
  BACKUP_CLAIM_PATH="$INSTALL_DIR/.chainlesschain.backup-publish-claimed-$TRANSACTION_ID"
  assert_lock_owned || die "native update lock ownership was lost before backup commit"
  BACKUP_COMMITTED=1
  if [ "$HAD_BACKUP" -eq 1 ]; then
    mutate_public_path \
      replace \
      "$BACKUP_PATH" \
      "$BACKUP_TEMP_PATH" \
      "$BACKUP_CLAIM_PATH" \
      regular \
      "$OLD_BACKUP_SHA256" \
      "$OLD_BACKUP_IDENTITY" \
      regular \
      "$OLD_TARGET_SHA256" \
      "$OLD_TARGET_IDENTITY" || { PRESERVE_RECOVERY=1; die "last-known-good backup publication failed closed"; }
  else
    mutate_public_path \
      replace \
      "$BACKUP_PATH" \
      "$BACKUP_TEMP_PATH" \
      "$BACKUP_CLAIM_PATH" \
      absent \
      "" \
      "" \
      regular \
      "$OLD_TARGET_SHA256" \
      "$OLD_TARGET_IDENTITY" || { PRESERVE_RECOVERY=1; die "last-known-good backup publication failed closed"; }
  fi
  BACKUP_TEMP_PATH=""
  BACKUP_CLAIM_PATH=""
  fsync_dir "$INSTALL_DIR"
fi
write_install_transaction_journal backup-committed rollback || { PRESERVE_RECOVERY=1; die "could not persist backup commit phase"; }
crash_after_install_phase backup-committed

ALIAS_TEMP_PATH="$INSTALL_DIR/.cc.link-$TRANSACTION_ID"
[ ! -e "$ALIAS_TEMP_PATH" ] && [ ! -L "$ALIAS_TEMP_PATH" ] || die "alias staging path already exists"
ln -s chainlesschain "$ALIAS_TEMP_PATH"
INSTALLED_ALIAS_ANCHOR_PATH="$INSTALL_DIR/.cc.identity-$TRANSACTION_ID"
[ ! -e "$INSTALLED_ALIAS_ANCHOR_PATH" ] && [ ! -L "$INSTALLED_ALIAS_ANCHOR_PATH" ] || die "alias identity anchor path already exists"
INSTALLED_ALIAS_TARGET_SHA256=$(snapshot_alias "$ALIAS_TEMP_PATH" "$INSTALLED_ALIAS_ANCHOR_PATH")
[ "$INSTALLED_ALIAS_TARGET_SHA256" = "$CANONICAL_ALIAS_TARGET_SHA256" ] || die "CLI alias identity anchor changed during creation"
INSTALLED_ALIAS_IDENTITY=$(symlink_identity "$ALIAS_TEMP_PATH")
alias_matches_identity "$ALIAS_TEMP_PATH" "$CANONICAL_ALIAS_TARGET_SHA256" "$INSTALLED_ALIAS_IDENTITY" || die "CLI alias staging path changed before commit"
if [ "$HAD_ALIAS" -eq 1 ]; then
  alias_matches_identity "$ALIAS_PATH" "$OLD_ALIAS_TARGET_SHA256" "$OLD_ALIAS_IDENTITY" || die "CLI alias changed before alias commit"
  alias_matches_identity "$PRIOR_ALIAS_PATH" "$OLD_ALIAS_TARGET_SHA256" "$OLD_ALIAS_IDENTITY" || die "alias recovery snapshot changed before alias commit"
elif [ -e "$ALIAS_PATH" ] || [ -L "$ALIAS_PATH" ]; then
  die "CLI alias appeared before alias commit"
fi
assert_lock_owned || die "native update lock ownership was lost before alias commit"
ALIAS_CLAIM_PATH="$INSTALL_DIR/.cc.publish-claimed-$TRANSACTION_ID"
ALIAS_COMMITTED=1
if [ "$HAD_ALIAS" -eq 1 ]; then
  mutate_public_path \
    replace \
    "$ALIAS_PATH" \
    "$ALIAS_TEMP_PATH" \
    "$ALIAS_CLAIM_PATH" \
    symlink \
    "$OLD_ALIAS_TARGET_SHA256" \
    "$OLD_ALIAS_IDENTITY" \
    symlink \
    "$CANONICAL_ALIAS_TARGET_SHA256" \
    "$INSTALLED_ALIAS_IDENTITY" || { PRESERVE_RECOVERY=1; die "CLI alias publication failed closed"; }
else
  mutate_public_path \
    replace \
    "$ALIAS_PATH" \
    "$ALIAS_TEMP_PATH" \
    "$ALIAS_CLAIM_PATH" \
    absent \
    "" \
    "" \
    symlink \
    "$CANONICAL_ALIAS_TARGET_SHA256" \
    "$INSTALLED_ALIAS_IDENTITY" || { PRESERVE_RECOVERY=1; die "CLI alias publication failed closed"; }
fi
ALIAS_TEMP_PATH=""
ALIAS_CLAIM_PATH=""
alias_matches_identity "$ALIAS_PATH" "$CANONICAL_ALIAS_TARGET_SHA256" "$INSTALLED_ALIAS_IDENTITY" || die "CLI alias changed at the commit boundary"
fsync_dir "$INSTALL_DIR"
write_install_transaction_journal alias-committed rollback || { PRESERVE_RECOVERY=1; die "could not persist alias commit phase"; }
crash_after_install_phase alias-committed
write_install_transaction_journal verified rollback || { PRESERVE_RECOVERY=1; die "could not persist verification phase"; }
crash_after_install_phase verified
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
write_install_transaction_journal lineage-committed rollback || { PRESERVE_RECOVERY=1; die "could not persist lineage commit phase"; }
crash_after_install_phase lineage-committed
crash_after_install_phase commit-decision-started
write_install_transaction_journal committed commit || { PRESERVE_RECOVERY=1; die "could not persist native install commit decision"; }
COMMITTED=1
crash_after_install_phase committed
if ! discard_transaction_snapshots; then
  if [ "$CLEANUP_PENDING" -eq 1 ] && [ "$RECOVERY_RETIREMENT_GUARD" -eq 0 ]; then
    die "install committed in cleanup-pending/degraded state; fd-bound tombstones were retained for later garbage collection"
  fi
  PRESERVE_RECOVERY=1
  die "install committed but recovery retirement failed; evidence and the native update lock were retained"
fi
retire_install_transaction_journal commit || { PRESERVE_RECOVERY=1; die "install committed but its transaction journal could not be retired"; }
echo "Installed ChainlessChain CLI at $TARGET_PATH"
