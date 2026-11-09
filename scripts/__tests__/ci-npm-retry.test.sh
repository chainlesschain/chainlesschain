#!/usr/bin/env bash
# Dependency-free contract tests; executes the production retry helper.
set -eu
helper=$(cd "$(dirname "$0")/../.." && pwd)/.github/scripts/ci-npm-retry.sh
fixture=$(mktemp -d)
finish_writer() {
  [ -f "$fixture/writer.started" ] || return 0
  : > "$fixture/writer.release"
  for _ in $(seq 1 500); do
    [ ! -f "$fixture/writer.done" ] || return 0
    command sleep 0.01
  done
  echo 'FAIL: fixture writer did not finish'; return 1
}
trap 'finish_writer && command rm -rf -- "$fixture"' EXIT
export fixture
sleep() { :; }
export -f sleep
install_fixture() {
  local count=0
  [ ! -f "$fixture/count" ] || count=$(cat "$fixture/count")
  count=$((count + 1))
  echo "$count" > "$fixture/count"
  if [ "$count" -eq 1 ]; then
    mkdir -p "$fixture/root/node_modules/electron" "$PWD/node_modules/partial"
    echo dirty > "$fixture/root/node_modules/electron/partial"
    return 1
  fi
  if [ "${EXPECT_CLEAN:-0}" = 1 ]; then
    [ ! -d "$fixture/root/node_modules" ] && [ ! -d "$PWD/node_modules" ] || return 9
  else
    [ -f "$fixture/root/node_modules/electron/partial" ] || return 9
  fi
}
export -f install_fixture
mkdir -p "$fixture/root/desktop"
echo '{}' > "$fixture/root/package.json"
echo '{}' > "$fixture/root/desktop/package.json"
echo lock-preserved > "$fixture/root/package-lock.json"
cd "$fixture/root/desktop"
export EXPECT_CLEAN=1
CI_NPM_RETRY_CLEAN_WORKSPACE="$fixture/root" bash "$helper" install_fixture
[ "$(cat "$fixture/count")" = 2 ]
[ "$(cat "$fixture/root/package-lock.json")" = lock-preserved ]
echo 'PASS: failed install cleans hoisted and local trees; retry succeeds; lock retained'
rm "$fixture/count"
export EXPECT_CLEAN=0
bash "$helper" install_fixture
[ "$(cat "$fixture/count")" = 2 ]
echo 'PASS: default retry preserves existing dependencies'
if CI_NPM_RETRY_CLEAN_WORKSPACE="$fixture/root" bash "$helper" false; then
  echo 'FAIL: persistent failure returned success'; exit 1
fi
echo 'PASS: persistent failure remains nonzero'
if CI_NPM_RETRY_CLEAN_WORKSPACE="$fixture/missing" bash "$helper" false; then
  echo 'FAIL: invalid cleanup root accepted'; exit 1
fi
echo 'PASS: invalid cleanup root fails closed'
if bash "$helper"; then
  echo 'FAIL: empty command accepted'; exit 1
fi
echo 'PASS: empty command rejected'

# Model an npm lifecycle child that outlives its failed parent. The child
# writes real partial dependency bytes after the install function has returned.
# A controlled rm fault makes the cleanup/write collision deterministic across
# Linux, macOS, and Git Bash; production rm is used once the writer is quiet.
late_writer() {
  : > "$fixture/writer.active"
  : > "$fixture/writer.started"
  for _ in $(seq 1 500); do
    [ ! -f "$fixture/writer.release" ] || break
    command sleep 0.01
  done
  if [ -f "$fixture/writer.release" ]; then
    mkdir -p "$fixture/root/node_modules/native" "$PWD/node_modules/native"
    echo late-native-output > "$fixture/root/node_modules/native/late"
    echo late-native-output > "$PWD/node_modules/native/late"
  fi
  command rm -f -- "$fixture/writer.active"
  : > "$fixture/writer.done"
}
install_with_late_writer() {
  local count=0
  [ ! -f "$fixture/writer.count" ] || count=$(cat "$fixture/writer.count")
  count=$((count + 1))
  echo "$count" > "$fixture/writer.count"
  if [ "$count" -eq 1 ]; then
    late_writer > "$fixture/writer.log" 2>&1 &
    for _ in $(seq 1 500); do
      [ ! -f "$fixture/writer.started" ] || return 1
      command sleep 0.01
    done
    return 8
  fi
  [ -f "$fixture/writer.done" ] || return 9
  [ ! -d "$fixture/root/node_modules" ] && [ ! -d "$PWD/node_modules" ] || return 9
}
sleep() {
  echo "$1" >> "$fixture/backoff"
  if [ "${WRITER_OUTLIVES_BACKOFF:-0}" = 0 ]; then
    : > "$fixture/writer.release"
    for _ in $(seq 1 500); do
      if [ -f "$fixture/writer.done" ]; then
        [ "$(cat "$fixture/root/node_modules/native/late")" = late-native-output ] || return 8
        [ "$(cat "$PWD/node_modules/native/late")" = late-native-output ] || return 8
        return 0
      fi
      command sleep 0.01
    done
    return 8
  fi
}
rm() {
  if [ -f "$fixture/writer.active" ]; then
    for argument in "$@"; do
      case "$argument" in
        */node_modules)
          echo 'rm: cannot remove partial dependency tree: Directory not empty' >&2
          : > "$fixture/cleanup-collision"
          return 1
          ;;
      esac
    done
  fi
  command rm "$@"
}
export -f late_writer install_with_late_writer sleep rm
CI_NPM_RETRY_CLEAN_WORKSPACE="$fixture/root" bash "$helper" install_with_late_writer
[ "$(cat "$fixture/writer.count")" = 2 ]
[ "$(cat "$fixture/backoff")" = 15 ]
[ ! -f "$fixture/cleanup-collision" ]
[ "$(cat "$fixture/root/package-lock.json")" = lock-preserved ]
echo 'PASS: backoff precedes cleanup of a real delayed lifecycle writer; retry sees clean trees'

command rm -f -- "$fixture"/writer.* "$fixture/backoff"
if WRITER_OUTLIVES_BACKOFF=1 CI_NPM_RETRY_CLEAN_WORKSPACE="$fixture/root" bash "$helper" install_with_late_writer; then
  echo 'FAIL: cleanup collision returned success'; exit 1
fi
[ "$(cat "$fixture/writer.count")" = 1 ]
[ "$(cat "$fixture/backoff")" = 15 ]
[ -f "$fixture/cleanup-collision" ]
finish_writer
echo 'PASS: a writer that outlives backoff still prevents cleanup and another install'

# Preserve exactly three failed attempts and the original total 15+30 backoff.
command rm -f -- "$fixture/backoff" "$fixture/failure-count"
sleep() { echo "$1" >> "$fixture/backoff"; }
always_fail() {
  local count=0
  [ ! -f "$fixture/failure-count" ] || count=$(cat "$fixture/failure-count")
  echo "$((count + 1))" > "$fixture/failure-count"
  return 1
}
export -f sleep always_fail
if CI_NPM_RETRY_CLEAN_WORKSPACE="$fixture/root" bash "$helper" always_fail; then
  echo 'FAIL: persistent failure returned success'; exit 1
fi
[ "$(cat "$fixture/failure-count")" = 3 ]
[ "$(tr '\n' ',' < "$fixture/backoff")" = '15,30,' ]
echo 'PASS: persistent failure retains exactly three attempts and 15/30 second backoff'
