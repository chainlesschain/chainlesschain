#!/usr/bin/env bash
set -euo pipefail

target_env="${CC_IDE_TARGET_ENV_FILE:-/tmp/cc-ide-roadmap-target.env}"
if [[ ! -f "$target_env" || -L "$target_env" ]]; then
  echo "execution-location target environment is unavailable" >&2
  exit 70
fi

# The workflow creates this owner-only file inside the isolated target. It has
# paths only; no credential values are permitted in the execution-location
# fixture or evidence envelope.
# shellcheck disable=SC1090
source "$target_env"
: "${CC_IDE_TARGET_NODE:?missing target Node path}"
: "${CC_IDE_TARGET_ENTRY:?missing target CLI entry path}"
: "${CC_IDE_TARGET_HOME:?missing target home}"
: "${CC_IDE_TARGET_SECURITY_HOME:?missing target security home}"

export CHAINLESSCHAIN_HOME="$CC_IDE_TARGET_HOME"
export CHAINLESSCHAIN_SECURITY_ANCHOR_HOME="$CC_IDE_TARGET_SECURITY_HOME"
export NO_COLOR=1
export FORCE_COLOR=0

if [[ -n "${CC_EXECUTION_LOCATION_RUNNER_ID:-}" ]]; then
  : "${CC_EXECUTION_LOCATION_BASE_DIR:?missing target base directory fence}"
  : "${CC_EXECUTION_LOCATION_CPU_SECONDS:?missing target CPU fence}"
  : "${CC_EXECUTION_LOCATION_GENERATION:?missing runner generation fence}"
  : "${CC_EXECUTION_LOCATION_LEASE_GENERATION:?missing lease generation fence}"
  : "${CC_EXECUTION_LOCATION_LEASE_ID:?missing lease identity fence}"
  : "${CC_EXECUTION_LOCATION_LEASE_EXPIRES_AT:?missing lease expiry fence}"
  : "${CC_EXECUTION_LOCATION_MEMORY_BYTES:?missing target memory fence}"
  : "${CC_EXECUTION_LOCATION_POST_SESSION_HOOK_DIGEST:?missing post-session hook fence}"
  : "${CC_EXECUTION_LOCATION_POST_SESSION_HOOK_GENERATION:?missing post-session hook generation fence}"
  : "${CC_EXECUTION_LOCATION_PROXY_AUTHORITY_ID:?missing proxy authority fence}"
  : "${CC_EXECUTION_LOCATION_PROXY_EXPIRES_AT:?missing proxy expiry fence}"
  : "${CC_EXECUTION_LOCATION_PROXY_ISSUED_AT:?missing proxy issuance fence}"
  : "${CC_EXECUTION_LOCATION_PROXY_REVISION:?missing proxy revision fence}"
  : "${CC_EXECUTION_LOCATION_STATE:?missing runner lifecycle state}"
  [[ "$CC_EXECUTION_LOCATION_STATE" == "accepting" || \
     "$CC_EXECUTION_LOCATION_STATE" == "draining" ]] || {
    echo "execution-location runner is not accepting leased work" >&2
    exit 75
  }
  [[ "$CC_EXECUTION_LOCATION_GENERATION" =~ ^[1-9][0-9]*$ && \
     "$CC_EXECUTION_LOCATION_LEASE_GENERATION" =~ ^[1-9][0-9]*$ && \
     "$CC_EXECUTION_LOCATION_POST_SESSION_HOOK_GENERATION" =~ ^[1-9][0-9]*$ && \
     "$CC_EXECUTION_LOCATION_PROXY_REVISION" =~ ^[1-9][0-9]*$ && \
     "$CC_EXECUTION_LOCATION_CPU_SECONDS" =~ ^[1-9][0-9]*$ && \
     "$CC_EXECUTION_LOCATION_MEMORY_BYTES" =~ ^[1-9][0-9]*$ ]] || {
    echo "execution-location target fence is malformed" >&2
    exit 65
  }
  (( CC_EXECUTION_LOCATION_LEASE_GENERATION <= CC_EXECUTION_LOCATION_GENERATION )) || {
    echo "execution-location lease generation is ahead of runner authority" >&2
    exit 75
  }
  (( CC_EXECUTION_LOCATION_POST_SESSION_HOOK_GENERATION == CC_EXECUTION_LOCATION_LEASE_GENERATION )) || {
    echo "execution-location post-session hook generation is stale" >&2
    exit 75
  }
  target_base="$(cd -- "$CC_EXECUTION_LOCATION_BASE_DIR" 2>/dev/null && pwd -P)" || {
    echo "execution-location target base directory is unavailable" >&2
    exit 73
  }
  [[ "$target_base" == "$(pwd -P)" ]] || {
    echo "execution-location target base directory drifted" >&2
    exit 73
  }
  writable_probe="$(mktemp "$target_base/.cc-location-preflight.XXXXXX")" || {
    echo "execution-location target base directory is not writable" >&2
    exit 73
  }
  trap 'rm -f -- "$writable_probe"' EXIT
  printf 'preflight\n' > "$writable_probe"
  rm -f -- "$writable_probe"
  trap - EXIT

  memory_kib=$(( (CC_EXECUTION_LOCATION_MEMORY_BYTES + 1023) / 1024 ))
  ulimit -v "$memory_kib"
  ulimit -t "$CC_EXECUTION_LOCATION_CPU_SECONDS"
  export CC_EXECUTION_LOCATION_RESOURCE_ENFORCEMENT=posix-rlimit
fi

if [[ "${1:-}" == "session" && "${2:-}" == "resume" ]]; then
  printf '/exit\n' | "$CC_IDE_TARGET_NODE" "$CC_IDE_TARGET_ENTRY" "$@"
else
  exec "$CC_IDE_TARGET_NODE" "$CC_IDE_TARGET_ENTRY" "$@"
fi
