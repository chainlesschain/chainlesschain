#!/system/bin/sh
# Start the PDH QQ staging daemon after boot (late_start service context = root,
# non-app → can read cross-app data on MIUI).
MODDIR=${0%/*}
until [ "$(getprop sys.boot_completed)" = "1" ]; do sleep 3; done
sleep 12
# single instance
if ! pgrep -f pdh-qqd.sh >/dev/null 2>&1; then
  nohup sh "$MODDIR/pdh-qqd.sh" >/dev/null 2>&1 &
fi
