#!/system/bin/sh
# PDH 免密钥内存扫描：从已 root 真机的 App 进程内存里 dump 出解密后的 SQLite 库。
#
# 原理：WCDB/SQLCipher 打开 DB 后，解密页进入进程页缓存（明文）。root 直接读
# /proc/<pid>/mem（不用 ptrace，绕过 App 反调试），把**含 SQLite 内容**的内存区域整段
# dump 成 .db——内容标记 = 文件头 "SQLite format 3"（标准 SQLCipher）或解密页里的明文
# schema "CREATE TABLE"（WCDB2 如抖音，内存里没有文件头）。下游 leaf-salvage 扫 0x0D
# 叶子页打捞记录，不依赖文件头，两种加密通吃。
#
# ⚠️ 64 位地址：toybox sh 的 $(()) 算术是 32 位，原生堆在 0x66xxxxxxxx（>4GB）会
#    溢出成负数 → dd seek 到错误偏移、扫不到任何东西（血泪 bug）。所以地址换算一律用
#    `printf "%d"`（解析 0x 十六进制为 64 位十进制）+ `bc`（大数运算）+
#    `dd iflag=skip_bytes`（skip 直接按字节，避免 /4096 溢出）。
#
# 授权边界：仅用于你本人拥有的设备 / 你本人的账号 / 你本人的 App，与你自己的 PDH 互通。
# 用法：  su -c 'sh /data/local/tmp/pdh-mem-sqlite-scan.sh <pid>'
#         （pid 须是已登录、且已打开过目标 DB 的“热”进程；进程必须真的用起来——刷信息流
#          /进消息——库才会被打开、明文页才进内存。冷启动/后台进程内存里没有明文页。）
# 输出：  /data/local/tmp/ccmem/*.db  （chmod 666 后 adb pull 出来用 sqlite3 读）
# 详见：  docs/internal/pdh-db-decryption-runbook.md

PID="$1"
[ -z "$PID" ] && { echo "usage: $0 <pid>"; exit 1; }
[ -r "/proc/$PID/maps" ] || { echo "cannot read /proc/$PID/maps (need root, valid pid)"; exit 1; }

# Self-cleanup: kill the whole process group (this script + any in-flight `dd`
# child) on exit/termination. Without this, when the Android collector hits its
# timeout and destroyForcibly()'s the `su` wrapper, the root-owned grandchild
# (this script + its dd) keeps running orphaned, hammering /proc/<pid>/mem
# (real-device repro 2026-06-17: 4 orphaned scans survived a button timeout).
# `timeout` (toybox) wrapping from the caller + this trap together guarantee
# the scan never outlives the button.
trap 'kill 0 2>/dev/null' EXIT INT TERM

OUT=/data/local/tmp/ccmem
mkdir -p "$OUT"; rm -f "$OUT"/*.db "$OUT"/_r.bin

# D1 (2026-06-17): dump regions by SQLite *content*, not just the file header.
# 抖音/WCDB2 解密页在内存里**不带** "SQLite format 3" 文件头 → 旧的纯头匹配 0 命中
# （真机实证）。改为：只要区域里出现 SQLite 内容标记——文件头（标准 SQLCipher，如
# 微信）或解密页缓存里的明文 schema "CREATE TABLE"（WCDB2，如抖音）——就把**整段
# 原始区域**落盘。下游 `cc hub salvage`(leaf-salvage --unaligned) 不靠文件头、直接扫
# 0x0D 叶子页打捞记录，对两种加密形态通吃。带上限防爆盘/超时。
MAX_DUMPS=30
RAW_CAP=67108864       # 单区域 raw dump 上限 64MB（再大不 cp，leaf-salvage 成本+盘）
dumped=0
awk '/rw-p/{print $1}' "/proc/$PID/maps" | while read range; do
  [ "$dumped" -ge "$MAX_DUMPS" ] && break
  sh=$(echo "$range" | cut -d- -f1); eh=$(echo "$range" | cut -d- -f2)
  sdec=$(printf "%d" "0x$sh"); edec=$(printf "%d" "0x$eh")   # 64-bit hex->dec
  size=$(echo "$edec - $sdec" | bc)
  [ "$(echo "$size < 8192" | bc)" = 1 ] && continue
  [ "$(echo "$size > $RAW_CAP" | bc)" = 1 ] && continue      # 跳过大区域（dalvik 堆等）
  cnt=$(echo "$size / 4096" | bc)
  # iflag=skip_bytes: skip 按字节，避免 $((addr/4096)) 32 位溢出
  dd if="/proc/$PID/mem" bs=4096 skip="$sdec" count="$cnt" iflag=skip_bytes 2>/dev/null > "$OUT/_r.bin" || continue
  # 内容标记：文件头 OR 明文 schema。命中即落整段供 leaf-salvage。
  if grep -qaE "SQLite format 3|CREATE TABLE" "$OUT/_r.bin" 2>/dev/null; then
    nm="cc_${sh}"
    cp "$OUT/_r.bin" "$OUT/$nm.db" 2>/dev/null || continue
    dumped=$((dumped + 1))
    echo "DUMP $nm size=$size"
  fi
done

rm -f "$OUT/_r.bin"
chmod 666 "$OUT"/*.db 2>/dev/null
echo "TOTAL=$(ls "$OUT"/*.db 2>/dev/null | wc -l)  (dir: $OUT)"
