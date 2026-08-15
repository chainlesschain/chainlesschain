#!/bin/sh

set -eu

helper='/Library/PrivilegedHelperTools/com.chainlesschain.cli.mcp-launcher'
contract='/Library/PrivilegedHelperTools/com.chainlesschain.cli.mcp-launcher.json'
base='/Library/Application Support/ChainlessChain'
launcher="$base/McpLauncher"
snapshot_root="$launcher/runtime"
lock="$snapshot_root/launcher.lock"

verify_directory() {
  candidate=$1
  expected_mode=$2
  if [ -L "$candidate" ] || [ ! -d "$candidate" ]; then
    echo "invalid macOS MCP launcher directory: $candidate" >&2
    exit 77
  fi
  if [ "$(/usr/bin/stat -f '%u:%g:%Lp' "$candidate")" != "0:0:$expected_mode" ]; then
    echo "untrusted macOS MCP launcher directory metadata: $candidate" >&2
    exit 77
  fi
}

verify_regular() {
  candidate=$1
  expected_mode=$2
  if [ -L "$candidate" ] || [ ! -f "$candidate" ]; then
    echo "invalid macOS MCP launcher member: $candidate" >&2
    exit 77
  fi
  if [ "$(/usr/bin/stat -f '%u:%g:%Lp:%l' "$candidate")" != "0:0:$expected_mode:1" ]; then
    echo "untrusted macOS MCP launcher member metadata: $candidate" >&2
    exit 77
  fi
}

# This script deliberately never repairs pre-existing ownership or modes. The
# signed pkg payload installs the helper, contract, and directories. The helper
# creates the lock with openat(O_CREAT|O_EXCL|O_NOFOLLOW) only when absent; an
# exact existing lock is verified and preserved across upgrades.
verify_directory '/Library' 755
verify_directory '/Library/PrivilegedHelperTools' 755
verify_directory '/Library/Application Support' 755
verify_directory "$base" 755
verify_directory "$launcher" 755
verify_directory "$snapshot_root" 711
verify_regular "$helper" 4555
verify_regular "$contract" 444
/usr/bin/codesign --verify --strict --verbose=4 "$helper"
"$helper" --install-lock-v1
verify_regular "$lock" 600

exit 0
