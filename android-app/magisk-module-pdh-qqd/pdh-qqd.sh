#!/system/bin/sh
# PDH QQ staging daemon (module 101 QQNT 采集方案 — MIUI on-device path).
#
# Runs as root from a Magisk service (init context) — NOT an app process — so it
# CAN read another app's data dir on MIUI/HyperOS, where the ChainlessChain app's
# own su is blocked (kernel-level cross-app isolation). It watches each PDH app's
# cache for a `request`, then stages QQ's encrypted nt_msg.db + uid candidates
# into that app's cache (chown'd to the app) so the in-app `cc hub collect-qq`
# can decrypt+ingest fully on-device — no PC, no USB.
#
# IPC (all under <app>/cache/qqd/, app-writable):
#   app writes:   request            (trigger)
#   daemon writes: status            (staging|scanning-uids)
#                  nt_msg.enc.db      (encrypted DB, chown app, 600)
#                  uids.txt           (u_ candidates, chown app, 600)
#                  done | error       (terminal signal, chown app)

PKGS="com.chainlesschain.android com.chainlesschain.android.debug"
QQ=com.tencent.mobileqq
SCAN_MAX=90   # seconds budget for the uid scan (targeted dirs → fast)
# The self uid lives in files/mmkv (qq_uin_uid_map) + databases — NOT the multi-GB
# media cache. Scanning only these is fast + finds the self uid the brute needs.
SCAN_DIRS="files/mmkv databases files/kerneldb files/QWallet"

emit() { # emit <base> <file> <text> <uid>
  echo "$3" > "$1/$2" 2>/dev/null
  chown "$4:$4" "$1/$2" 2>/dev/null
}

stage_for() {
  BASE=$1; APPUID=$2
  rm -f "$BASE/done" "$BASE/error"
  emit "$BASE" status "staging" "$APPUID"
  D=$(find /data/data/$QQ/databases/nt_db -name nt_msg.db 2>/dev/null | head -1)
  if [ -z "$D" ]; then
    emit "$BASE" error "nt_msg.db not found (QQ not logged in?)" "$APPUID"
    return
  fi
  if ! cp "$D" "$BASE/nt_msg.enc.db" 2>/dev/null; then
    emit "$BASE" error "copy nt_msg.db failed" "$APPUID"
    return
  fi
  chown "$APPUID:$APPUID" "$BASE/nt_msg.enc.db" 2>/dev/null
  chmod 600 "$BASE/nt_msg.enc.db" 2>/dev/null
  emit "$BASE" status "scanning-uids" "$APPUID"
  # targeted uid scan (files/mmkv + databases) — fast, has the self uid.
  DIRS=""
  for d in $SCAN_DIRS; do DIRS="$DIRS /data/data/$QQ/$d"; done
  timeout $SCAN_MAX sh -c "find $DIRS -type f 2>/dev/null | while read f; do strings -a \"\$f\" 2>/dev/null; done | grep -oE 'u_[A-Za-z0-9_-]{15,30}' | sort -u" > "$BASE/uids.txt" 2>/dev/null
  chown "$APPUID:$APPUID" "$BASE/uids.txt" 2>/dev/null
  chmod 600 "$BASE/uids.txt" 2>/dev/null
  if [ -s "$BASE/uids.txt" ]; then
    emit "$BASE" done "ok" "$APPUID"
  else
    emit "$BASE" error "no uid candidates gathered" "$APPUID"
  fi
}

log -t pdh-qqd "daemon started" 2>/dev/null
while true; do
  for PKG in $PKGS; do
    BASE=/data/data/$PKG/cache/qqd
    [ -f "$BASE/request" ] || continue
    APPUID=$(stat -c %u "/data/data/$PKG" 2>/dev/null)
    rm -f "$BASE/request"
    [ -n "$APPUID" ] || continue
    stage_for "$BASE" "$APPUID"
  done
  sleep 2
done
