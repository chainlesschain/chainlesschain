#!/usr/bin/env bash
# Dependency-free contract tests; executes the production retry helper.
set -eu
helper=$(cd "$(dirname "$0")/../.." && pwd)/.github/scripts/ci-npm-retry.sh
fixture=$(mktemp -d)
trap 'rm -rf -- "$fixture"' EXIT
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
