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
HAD_TARGET=0
SWAPPED=0
COMMITTED=0
BACKUP_COMMITTED=0
PRESERVE_RECOVERY=0
TRANSACTION_ID=""
OLD_TARGET_SHA256=""

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
  [ -n "$CANDIDATE_PATH" ] && rm -f "$CANDIDATE_PATH"
  if [ "$PRESERVE_RECOVERY" -eq 0 ]; then
    [ -n "$BACKUP_TEMP_PATH" ] && rm -f "$BACKUP_TEMP_PATH"
    [ -n "$ROLLBACK_TEMP_PATH" ] && rm -f "$ROLLBACK_TEMP_PATH"
  else
    [ -n "$BACKUP_TEMP_PATH" ] && echo "recovery snapshot preserved at $BACKUP_TEMP_PATH" >&2
    [ -n "$ROLLBACK_TEMP_PATH" ] && echo "rollback candidate preserved at $ROLLBACK_TEMP_PATH" >&2
  fi
  [ -n "$ALIAS_TEMP_PATH" ] && rm -f "$ALIAS_TEMP_PATH"
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
    if [ "$BACKUP_COMMITTED" -eq 1 ]; then
      assert_lock_owned || return 1
      write_lineage "$OLD_TARGET_SHA256" "$OLD_TARGET_SHA256" "rolled-back" || return 1
    fi
  else
    [ ! -L "$TARGET_PATH" ] || return 1
    assert_lock_owned || return 1
    rm -f "$TARGET_PATH" || return 1
  fi
  fsync_dir "$INSTALL_DIR"
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
  assert_lock_owned || die "native update lock ownership was lost before backup commit"
  mv -f "$BACKUP_TEMP_PATH" "$BACKUP_PATH"
  BACKUP_TEMP_PATH=""
  BACKUP_COMMITTED=1
  fsync_dir "$INSTALL_DIR"
fi

ALIAS_TEMP_PATH="$INSTALL_DIR/.cc.link-$TRANSACTION_ID"
[ ! -e "$ALIAS_TEMP_PATH" ] && [ ! -L "$ALIAS_TEMP_PATH" ] || die "alias staging path already exists"
ln -s chainlesschain "$ALIAS_TEMP_PATH"
assert_lock_owned || die "native update lock ownership was lost before alias commit"
mv -f "$ALIAS_TEMP_PATH" "$ALIAS_PATH"
ALIAS_TEMP_PATH=""
fsync_dir "$INSTALL_DIR"
if [ "$HAD_TARGET" -eq 1 ]; then
  assert_lock_owned || die "native update lock ownership was lost before lineage commit"
  write_lineage "$ARTIFACT_SHA256" "$OLD_TARGET_SHA256" "install"
else
  assert_lock_owned || die "native update lock ownership was lost before lineage commit"
  write_lineage "$ARTIFACT_SHA256" "null" "install"
fi
COMMITTED=1
echo "Installed ChainlessChain CLI at $TARGET_PATH"
