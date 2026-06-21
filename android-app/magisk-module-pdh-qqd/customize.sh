#!/system/bin/sh
ui_print "- PDH QQ Staging Daemon"
ui_print "- Stages QQ data for on-device collection (MIUI workaround)"
set_perm_recursive "$MODPATH" 0 0 0755 0755
set_perm "$MODPATH/pdh-qqd.sh" 0 0 0700
set_perm "$MODPATH/service.sh" 0 0 0700
