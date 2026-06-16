#!/system/bin/sh
# PDH 免密钥内存扫描：从已 root 真机的 App 进程内存里 dump 出解密后的 SQLite 库。
#
# 原理：WCDB/SQLCipher 打开 DB 后，解密页进入进程页缓存（明文）。root 直接读
# /proc/<pid>/mem（不用 ptrace，绕过 App 反调试），扫描 "SQLite format 3" 页头，
# 按页头 page_size/page_count dump 成 .db。
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

OUT=/data/local/tmp/ccmem
mkdir -p "$OUT"; rm -f "$OUT"/*.db "$OUT"/_r.bin

awk '/rw-p/{print $1}' "/proc/$PID/maps" | while read range; do
  sh=$(echo "$range" | cut -d- -f1); eh=$(echo "$range" | cut -d- -f2)
  sdec=$(printf "%d" "0x$sh"); edec=$(printf "%d" "0x$eh")   # 64-bit hex->dec
  size=$(echo "$edec - $sdec" | bc)
  [ "$(echo "$size < 8192" | bc)" = 1 ] && continue
  [ "$(echo "$size > 268435456" | bc)" = 1 ] && continue     # 跳过 >256MB（dalvik 大空间）
  cnt=$(echo "$size / 4096" | bc)
  # iflag=skip_bytes: skip 按字节，避免 $((addr/4096)) 32 位溢出
  dd if="/proc/$PID/mem" bs=4096 skip="$sdec" count="$cnt" iflag=skip_bytes 2>/dev/null > "$OUT/_r.bin" || continue
  grep -abo "SQLite format 3" "$OUT/_r.bin" 2>/dev/null | cut -d: -f1 | while read off; do
    # 区域内偏移 off 较小，$(()) 32 位足够
    ps=$(dd if="$OUT/_r.bin" bs=1 skip=$((off + 16)) count=2 2>/dev/null | od -A n -t u1 | tr -s ' ')
    p1=$(echo "$ps" | cut -d' ' -f1); p2=$(echo "$ps" | cut -d' ' -f2)
    pagesize=$((p1 * 256 + p2)); [ "$pagesize" -eq 1 ] && pagesize=65536
    pc=$(dd if="$OUT/_r.bin" bs=1 skip=$((off + 28)) count=4 2>/dev/null | od -A n -t u1 | tr -s ' ')
    c1=$(echo "$pc" | cut -d' ' -f1); c2=$(echo "$pc" | cut -d' ' -f2)
    c3=$(echo "$pc" | cut -d' ' -f3); c4=$(echo "$pc" | cut -d' ' -f4)
    pagecount=$((c1 * 16777216 + c2 * 65536 + c3 * 256 + c4))
    [ "$pagesize" -lt 512 ] && continue;  [ "$pagesize" -gt 65536 ] && continue
    [ "$pagecount" -lt 2 ] && continue;   [ "$pagecount" -gt 500000 ] && continue
    bytes=$((pagesize * pagecount)); [ "$bytes" -gt 83886080 ] && bytes=83886080  # cap 80MB
    nm="cc_${sh}_$off"
    dd if="$OUT/_r.bin" bs=1 skip="$off" count="$bytes" 2>/dev/null > "$OUT/$nm.db"
    echo "DUMP $nm pages=$pagecount ps=$pagesize"
  done
done

rm -f "$OUT/_r.bin"
chmod 666 "$OUT"/*.db 2>/dev/null
echo "TOTAL=$(ls "$OUT"/*.db 2>/dev/null | wc -l)  (dir: $OUT)"
