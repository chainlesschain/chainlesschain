#!/system/bin/sh
# PDH raw native-heap dump: dump libc_malloc / jemalloc rw-p regions RAW (no
# "SQLite format 3" anchor) so leaf-salvage --unaligned can recover b-tree leaf
# pages of WCDB2/SQLCipher DBs whose decrypted page-1 header is NOT cached.
#
# 64-bit safe (printf/bc/dd iflag=skip_bytes) — same as pdh-mem-sqlite-scan.sh.
# Authorization: your own device / account / app only.
# usage: su -c 'sh /data/local/tmp/cc-raw.sh <pid>'
# output: /data/local/tmp/ccraw/heap_<addr>.bin  (chmod 666)

PID="$1"
[ -z "$PID" ] && { echo "usage: $0 <pid>"; exit 1; }
[ -r "/proc/$PID/maps" ] || { echo "cannot read /proc/$PID/maps"; exit 1; }

OUT=/data/local/tmp/ccraw
mkdir -p "$OUT"; rm -f "$OUT"/*.bin

# native heap regions: libc_malloc + scudo/jemalloc + bare anon rw-p (skip dalvik/code)
grep -E 'rw-p' "/proc/$PID/maps" | grep -E 'libc_malloc|jemalloc|scudo' | while read line; do
  range=$(echo "$line" | awk '{print $1}')
  sh=$(echo "$range" | cut -d- -f1); eh=$(echo "$range" | cut -d- -f2)
  sdec=$(printf "%d" "0x$sh"); edec=$(printf "%d" "0x$eh")
  size=$(echo "$edec - $sdec" | bc)
  [ "$(echo "$size < 8192" | bc)" = 1 ] && continue
  [ "$(echo "$size > 268435456" | bc)" = 1 ] && continue
  cnt=$(echo "$size / 4096" | bc)
  dd if="/proc/$PID/mem" bs=4096 skip="$sdec" count="$cnt" iflag=skip_bytes 2>/dev/null > "$OUT/heap_${sh}.bin" || continue
  echo "DUMP heap_${sh}.bin size=$(echo "$size/1048576" | bc)MB"
done

chmod 666 "$OUT"/*.bin 2>/dev/null
echo "TOTAL=$(ls "$OUT"/*.bin 2>/dev/null | wc -l)  bytes=$(du -sk "$OUT" 2>/dev/null | awk '{print $1}')KB  (dir: $OUT)"
