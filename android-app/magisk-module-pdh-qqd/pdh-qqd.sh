#!/system/bin/sh
# PDH staging daemon (module 101 — MIUI/HyperOS on-device collection path).
#
# Runs as root from a Magisk service (init context) — NOT an app process — so it
# CAN read another app's data dir on MIUI/HyperOS, where the ChainlessChain app's
# own su is blocked (kernel-level cross-app isolation). It watches each PDH app's
# cache for a `request`, then stages the requested app's data into that app's
# cache (chown'd to the app) so the in-app `cc hub collect-*` can decrypt/ingest
# fully on-device — no PC, no USB.
#
# Request grammar (first line of <app>/cache/qqd/request):
#   qq                  → stage QQ encrypted nt_msg.db + u_ uid candidates
#   wechat              → stage WeChat encrypted EnMicroMsg.db + uin/IMEI/androidId
#   plaintext <pkg>     → stage all PLAINTEXT *.db from <pkg>/databases (collect-db)
#   (empty)             → defaults to `qq` (back-compat with the QQ-only release)
#
# IPC (all under <app>/cache/qqd/, app-writable; outputs chown app, 600):
#   app writes:    request
#   daemon writes: status  (staging…)  + the staged files  + done | error
#     qq:        nt_msg.enc.db, uids.txt
#     wechat:    enmm.enc.db, uins.txt, imeis.txt
#     plaintext: plaintext/<dbname> (one per readable db)

PKGS="com.chainlesschain.android com.chainlesschain.android.debug"
QQ=com.tencent.mobileqq
WX=com.tencent.mm
SCAN_MAX=90   # seconds budget for the QQ uid scan (targeted dirs → fast)
# The QQ self uid lives in files/mmkv (qq_uin_uid_map) + databases — NOT the
# multi-GB media cache. Scanning only these is fast + finds the self uid.
SCAN_DIRS="files/mmkv databases files/kerneldb files/QWallet"

emit() { # emit <base> <file> <text> <uid>
  echo "$3" > "$1/$2" 2>/dev/null
  chown "$4:$4" "$1/$2" 2>/dev/null
}

stage_qq() {
  BASE=$1; APPUID=$2
  emit "$BASE" status "staging-qq" "$APPUID"
  D=$(find /data/data/$QQ/databases/nt_db -name nt_msg.db 2>/dev/null | head -1)
  if [ -z "$D" ]; then
    emit "$BASE" error "nt_msg.db not found (QQ not logged in?)" "$APPUID"; return
  fi
  if ! cp "$D" "$BASE/nt_msg.enc.db" 2>/dev/null; then
    emit "$BASE" error "copy nt_msg.db failed" "$APPUID"; return
  fi
  chown "$APPUID:$APPUID" "$BASE/nt_msg.enc.db" 2>/dev/null
  chmod 600 "$BASE/nt_msg.enc.db" 2>/dev/null
  emit "$BASE" status "scanning-uids" "$APPUID"
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

stage_wechat() {
  BASE=$1; APPUID=$2
  emit "$BASE" status "staging-wechat" "$APPUID"
  D=$(find /data/data/$WX/MicroMsg -name EnMicroMsg.db 2>/dev/null | head -1)
  if [ -z "$D" ]; then
    emit "$BASE" error "EnMicroMsg.db not found (WeChat not logged in?)" "$APPUID"; return
  fi
  if ! cp "$D" "$BASE/enmm.enc.db" 2>/dev/null; then
    emit "$BASE" error "copy EnMicroMsg.db failed" "$APPUID"; return
  fi
  chown "$APPUID:$APPUID" "$BASE/enmm.enc.db" 2>/dev/null
  chmod 600 "$BASE/enmm.enc.db" 2>/dev/null
  # uin candidates from shared_prefs (key = MD5(IMEI+uin)[:7])
  grep -rohE '\-?[0-9]{4,12}' /data/data/$WX/shared_prefs/ 2>/dev/null \
    | sort -u | head -200 > "$BASE/uins.txt" 2>/dev/null
  chown "$APPUID:$APPUID" "$BASE/uins.txt" 2>/dev/null
  chmod 600 "$BASE/uins.txt" 2>/dev/null
  # IMEI candidates (Android 13 usually blocks real IMEI → also androidId + empty;
  # collect-wechat always adds "" + a placeholder too).
  {
    settings get secure android_id 2>/dev/null
    service call iphonesubinfo 1 2>/dev/null | grep -oE "'.{8,}'" | tr -d "'. " | tr -d '\n'; echo
  } | sort -u > "$BASE/imeis.txt" 2>/dev/null
  chown "$APPUID:$APPUID" "$BASE/imeis.txt" 2>/dev/null
  chmod 600 "$BASE/imeis.txt" 2>/dev/null
  emit "$BASE" done "ok" "$APPUID"
}

stage_plaintext() {
  BASE=$1; APPUID=$2; PKG=$3
  if [ -z "$PKG" ]; then emit "$BASE" error "plaintext needs a package" "$APPUID"; return; fi
  emit "$BASE" status "staging-plaintext" "$APPUID"
  rm -rf "$BASE/plaintext" 2>/dev/null
  mkdir -p "$BASE/plaintext" 2>/dev/null
  n=0
  for f in /data/data/$PKG/databases/*.db; do
    [ -f "$f" ] || continue
    b=$(basename "$f")
    case "$b" in encrypted*) continue;; esac   # encrypted IM has its own collector
    if cp "$f" "$BASE/plaintext/$b" 2>/dev/null; then
      chown "$APPUID:$APPUID" "$BASE/plaintext/$b" 2>/dev/null
      chmod 600 "$BASE/plaintext/$b" 2>/dev/null
      n=$((n + 1))
    fi
  done
  chown -R "$APPUID:$APPUID" "$BASE/plaintext" 2>/dev/null
  if [ "$n" -gt 0 ]; then
    emit "$BASE" done "ok ($n dbs)" "$APPUID"
  else
    emit "$BASE" error "no plaintext dbs in $PKG" "$APPUID"
  fi
}

dispatch() {
  BASE=$1; APPUID=$2
  rm -f "$BASE/done" "$BASE/error" 2>/dev/null
  REQ=$(head -1 "$BASE/request" 2>/dev/null)
  rm -f "$BASE/request" 2>/dev/null
  # shellcheck disable=SC2086
  set -- $REQ
  MODE=${1:-qq}
  case "$MODE" in
    qq)        stage_qq "$BASE" "$APPUID" ;;
    wechat)    stage_wechat "$BASE" "$APPUID" ;;
    plaintext) stage_plaintext "$BASE" "$APPUID" "$2" ;;
    *)         emit "$BASE" error "unknown mode: $MODE" "$APPUID" ;;
  esac
}

log -t pdh-qqd "daemon started" 2>/dev/null
while true; do
  for PKG in $PKGS; do
    BASE=/data/data/$PKG/cache/qqd
    [ -f "$BASE/request" ] || continue
    APPUID=$(stat -c %u "/data/data/$PKG" 2>/dev/null)
    [ -n "$APPUID" ] || { rm -f "$BASE/request" 2>/dev/null; continue; }
    dispatch "$BASE" "$APPUID"
  done
  sleep 2
done
