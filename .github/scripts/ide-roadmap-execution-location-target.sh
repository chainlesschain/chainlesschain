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

if [[ "${1:-}" == "session" && "${2:-}" == "resume" ]]; then
  printf '/exit\n' | "$CC_IDE_TARGET_NODE" "$CC_IDE_TARGET_ENTRY" "$@"
else
  exec "$CC_IDE_TARGET_NODE" "$CC_IDE_TARGET_ENTRY" "$@"
fi
