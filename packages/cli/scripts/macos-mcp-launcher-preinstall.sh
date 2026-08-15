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
  optional=$3
  if [ ! -e "$candidate" ] && [ ! -L "$candidate" ]; then
    [ "$optional" = 1 ] && return 0
    echo "required macOS MCP launcher parent is absent: $candidate" >&2
    exit 77
  fi
  if [ -L "$candidate" ] || [ ! -d "$candidate" ]; then
    echo "refusing untrusted macOS MCP launcher directory: $candidate" >&2
    exit 77
  fi
  if [ "$(/usr/bin/stat -f '%u:%g:%Lp' "$candidate")" != "0:0:$expected_mode" ]; then
    echo "refusing macOS MCP launcher directory metadata: $candidate" >&2
    exit 77
  fi
}

verify_regular_if_present() {
  candidate=$1
  expected_mode=$2
  if [ ! -e "$candidate" ] && [ ! -L "$candidate" ]; then
    return 0
  fi
  if [ -L "$candidate" ] || [ ! -f "$candidate" ]; then
    echo "refusing untrusted macOS MCP launcher member: $candidate" >&2
    exit 77
  fi
  if [ "$(/usr/bin/stat -f '%u:%g:%Lp:%l' "$candidate")" != "0:0:$expected_mode:1" ]; then
    echo "refusing macOS MCP launcher member metadata: $candidate" >&2
    exit 77
  fi
}

# Every optional product component is either absent below a verified,
# non-user-writable root parent or already has the exact trusted metadata from
# an earlier signed install. A non-root caller therefore cannot swap it after
# this check; root compromise remains explicitly out of scope.
verify_directory '/Library' 755 0
verify_directory '/Library/Application Support' 755 0
verify_directory '/Library/PrivilegedHelperTools' 755 1
verify_directory "$base" 755 1
verify_directory "$launcher" 755 1
verify_directory "$snapshot_root" 711 1
verify_regular_if_present "$helper" 4555
verify_regular_if_present "$contract" 444
verify_regular_if_present "$lock" 600

exit 0
