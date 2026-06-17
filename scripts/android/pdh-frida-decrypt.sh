#!/usr/bin/env bash
# PDH Method C — frida 在线解密加密 App 库（sqlcipher_export），一键复现。
#
#   bash scripts/android/pdh-frida-decrypt.sh <serial> <package> [outdir] [seconds]
#
# 例：bash scripts/android/pdh-frida-decrypt.sh 5lhyaqu8lbwstc6x com.ss.android.article.news ~/pdh-data 60
#
# 前提：① 设备已 root；② 目标 App 已登录且**前台用起来**（关键：要进到会查询目标库的
#       界面，IM 类必须打开「私信/消息」，否则库不被查询、hook 不命中）；③ 目标 App 无强反
#       frida（头条可、抖音有 libmsaoaidsec 可能杀 frida）。
# 产出：明文副本 *.plain.db 拉到 <outdir>（默认 ~/pdh-data，**仓库外、绝不入 git**，含个人数据）。
# 授权边界：仅本人设备/账号/App。用完务必清设备 + 本地（脚本已清设备侧；本地副本你自行保管）。
set -u
SERIAL="${1:?用法: pdh-frida-decrypt.sh <serial> <package> [outdir] [seconds]}"
PKG="${2:?缺 package（如 com.ss.android.article.news）}"
OUTDIR="${3:-$HOME/pdh-data}"
SECS="${4:-60}"
HERE="$(cd "$(dirname "$0")" && pwd)"
FRIDA="$HERE/../../android-app/app/src/main/assets/frida/frida-inject-arm64"
HOOK="$HERE/pdh-frida-sqlcipher-export.js"
A() { MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' adb -s "$SERIAL" "$@"; }

[ -f "$FRIDA" ] || { echo "缺 frida-inject-arm64: $FRIDA"; exit 1; }
[ -f "$HOOK" ]  || { echo "缺 hook: $HOOK"; exit 1; }
mkdir -p "$OUTDIR"

PID=$(A shell "su -c 'pidof $PKG'" 2>/dev/null | tr -d '\r' | awk '{print $1}')
[ -n "${PID:-}" ] || { echo "App 未运行：先打开 $PKG 并进到「私信/消息」界面再跑"; exit 2; }
echo "[*] $PKG pid=$PID  → 解密 ${SECS}s（请确保已进到会查询目标库的界面，如 IM 私信）"

A push "$FRIDA" /data/local/tmp/fj >/dev/null 2>&1
A push "$HOOK"  /data/local/tmp/ccexport.js >/dev/null 2>&1
A shell "su -c 'chmod 755 /data/local/tmp/fj; mkdir -p /data/local/tmp/dec; rm -f /data/local/tmp/dec/*.db'" 2>/dev/null

A shell "su -c 'timeout $SECS /data/local/tmp/fj -p $PID -s /data/local/tmp/ccexport.js 2>&1'" 2>&1 \
  | tr -d '\r' | grep -iE 'export|ready|hook|err'

echo "[*] 拉取明文副本 → $OUTDIR"
for f in $(A shell "su -c 'ls /data/local/tmp/dec/*.plain.db 2>/dev/null'" 2>/dev/null | tr -d '\r'); do
  A shell "su -c 'chmod 644 \"$f\"'" 2>/dev/null
  A pull "$f" "$OUTDIR/" 2>&1 | tail -1
done

echo "[*] 善后：清设备侧明文副本 + frida + hook（含个人数据）"
A shell "su -c 'pkill -9 -f /data/local/tmp/fj 2>/dev/null; rm -f /data/local/tmp/dec/*.db /data/local/tmp/fj /data/local/tmp/ccexport.js; rmdir /data/local/tmp/dec 2>/dev/null'" 2>/dev/null

echo "[✓] 完成。明文库在 $OUTDIR （仓库外，勿提交）。读法："
echo "    sqlite3 \"$OUTDIR/<name>.plain.db\" '.tables'   # 或 better-sqlite3 / cc hub salvage 接 PDH"
