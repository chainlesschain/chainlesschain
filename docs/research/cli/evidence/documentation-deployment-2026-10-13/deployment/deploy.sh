#!/usr/bin/env bash
set -euo pipefail
umask 022
exec 9>/www/wwwroot/.chainlesschain-docs-deploy.lock
flock -n 9
declare -A live_identity
completed=()
rollback(){ local site; for ((i=${#completed[@]}-1;i>=0;i--)); do site=${completed[$i]}; case "$site" in docs|design|www) ;; *) exit 1;; esac; local live="/www/wwwroot/$site.chainlesschain.com"; local backup="$live.bak-20261013-docs-d898d4e04d03-023354"; local failed="$live.failed-20261013-docs-d898d4e04d03-023354"; if [ -d "$backup" ] && [ ! -e "$failed" ] && [ ! -L "$failed" ]; then mv -T -- "$live" "$failed"; mv -T -- "$backup" "$live"; fi; done; }
trap 'rc=$?; if [ "$rc" -ne 0 ]; then rollback; fi' EXIT
test -d '/www/wwwroot/docs.chainlesschain.com' && test ! -L '/www/wwwroot/docs.chainlesschain.com'
test ! -e '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354' && test ! -e '/www/wwwroot/docs.chainlesschain.com.bak-20261013-docs-d898d4e04d03-023354' && test ! -L '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354' && test ! -L '/www/wwwroot/docs.chainlesschain.com.bak-20261013-docs-d898d4e04d03-023354'
live_identity[docs]="$(stat -c %d:%i '/www/wwwroot/docs.chainlesschain.com')"
printf '%s  %s\n' '0447f82b2aab8af69c551b6de6c21ac7dc29f4159bbce2d26ff0f96ac6dc5a70' '/tmp/20261013-docs-d898d4e04d03-023354-docs.tar.gz' | sha256sum -c -
mkdir '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354'
tar -xzf '/tmp/20261013-docs-d898d4e04d03-023354-docs.tar.gz' -C '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354'
test -f '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/index.html'
test "$(find '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354' -name '*.html' | wc -l)" -eq 636
test "$(find '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354' -type f | wc -l)" -eq 1937
(cd '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354' && sha256sum -c deployment-files.sha256 >/dev/null)
chown -R www:www '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354'
echo 'STAGED docs: 636 HTML / 1937 files'
if { test -e '/www/wwwroot/docs.chainlesschain.com/.well-known' || test -L '/www/wwwroot/docs.chainlesschain.com/.well-known'; } && test ! -e '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/.well-known' && test ! -L '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/.well-known'; then
  cp -a -- '/www/wwwroot/docs.chainlesschain.com/.well-known' '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/.well-known'
  echo 'PRESERVED_OPERATIONAL docs .well-known'
fi
if test -e '/www/wwwroot/docs.chainlesschain.com/logo-128.png' && test ! -e '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-128.png' && test ! -L '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-128.png'; then
  test -f '/www/wwwroot/docs.chainlesschain.com/logo-128.png' || exit 1
  test ! -L '/www/wwwroot/docs.chainlesschain.com/logo-128.png' || exit 1
  cp -a -- '/www/wwwroot/docs.chainlesschain.com/logo-128.png' '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-128.png'
  retained_sha=$(sha256sum -- '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-128.png'); retained_sha=${retained_sha%% *}
  retained_bytes=$(stat -c %s '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-128.png')
  echo "PRESERVED_FILE docs logo-128.png $retained_sha $retained_bytes"
fi
if test -e '/www/wwwroot/docs.chainlesschain.com/logo-32.png' && test ! -e '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-32.png' && test ! -L '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-32.png'; then
  test -f '/www/wwwroot/docs.chainlesschain.com/logo-32.png' || exit 1
  test ! -L '/www/wwwroot/docs.chainlesschain.com/logo-32.png' || exit 1
  cp -a -- '/www/wwwroot/docs.chainlesschain.com/logo-32.png' '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-32.png'
  retained_sha=$(sha256sum -- '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-32.png'); retained_sha=${retained_sha%% *}
  retained_bytes=$(stat -c %s '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-32.png')
  echo "PRESERVED_FILE docs logo-32.png $retained_sha $retained_bytes"
fi
if test -e '/www/wwwroot/docs.chainlesschain.com/logo-64.png' && test ! -e '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-64.png' && test ! -L '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-64.png'; then
  test -f '/www/wwwroot/docs.chainlesschain.com/logo-64.png' || exit 1
  test ! -L '/www/wwwroot/docs.chainlesschain.com/logo-64.png' || exit 1
  cp -a -- '/www/wwwroot/docs.chainlesschain.com/logo-64.png' '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-64.png'
  retained_sha=$(sha256sum -- '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-64.png'); retained_sha=${retained_sha%% *}
  retained_bytes=$(stat -c %s '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-64.png')
  echo "PRESERVED_FILE docs logo-64.png $retained_sha $retained_bytes"
fi
if test -e '/www/wwwroot/docs.chainlesschain.com/logo-optimized.png' && test ! -e '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-optimized.png' && test ! -L '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-optimized.png'; then
  test -f '/www/wwwroot/docs.chainlesschain.com/logo-optimized.png' || exit 1
  test ! -L '/www/wwwroot/docs.chainlesschain.com/logo-optimized.png' || exit 1
  cp -a -- '/www/wwwroot/docs.chainlesschain.com/logo-optimized.png' '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-optimized.png'
  retained_sha=$(sha256sum -- '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-optimized.png'); retained_sha=${retained_sha%% *}
  retained_bytes=$(stat -c %s '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-optimized.png')
  echo "PRESERVED_FILE docs logo-optimized.png $retained_sha $retained_bytes"
fi
if test -e '/www/wwwroot/docs.chainlesschain.com/logo.png' && test ! -e '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo.png' && test ! -L '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo.png'; then
  test -f '/www/wwwroot/docs.chainlesschain.com/logo.png' || exit 1
  test ! -L '/www/wwwroot/docs.chainlesschain.com/logo.png' || exit 1
  cp -a -- '/www/wwwroot/docs.chainlesschain.com/logo.png' '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo.png'
  retained_sha=$(sha256sum -- '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo.png'); retained_sha=${retained_sha%% *}
  retained_bytes=$(stat -c %s '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo.png')
  echo "PRESERVED_FILE docs logo.png $retained_sha $retained_bytes"
fi
if test -e '/www/wwwroot/docs.chainlesschain.com/logo.webp' && test ! -e '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo.webp' && test ! -L '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo.webp'; then
  test -f '/www/wwwroot/docs.chainlesschain.com/logo.webp' || exit 1
  test ! -L '/www/wwwroot/docs.chainlesschain.com/logo.webp' || exit 1
  cp -a -- '/www/wwwroot/docs.chainlesschain.com/logo.webp' '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo.webp'
  retained_sha=$(sha256sum -- '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo.webp'); retained_sha=${retained_sha%% *}
  retained_bytes=$(stat -c %s '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo.webp')
  echo "PRESERVED_FILE docs logo.webp $retained_sha $retained_bytes"
fi
if test -e '/www/wwwroot/docs.chainlesschain.com/og-image.svg' && test ! -e '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/og-image.svg' && test ! -L '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/og-image.svg'; then
  test -f '/www/wwwroot/docs.chainlesschain.com/og-image.svg' || exit 1
  test ! -L '/www/wwwroot/docs.chainlesschain.com/og-image.svg' || exit 1
  cp -a -- '/www/wwwroot/docs.chainlesschain.com/og-image.svg' '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/og-image.svg'
  retained_sha=$(sha256sum -- '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/og-image.svg'); retained_sha=${retained_sha%% *}
  retained_bytes=$(stat -c %s '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/og-image.svg')
  echo "PRESERVED_FILE docs og-image.svg $retained_sha $retained_bytes"
fi
test -d '/www/wwwroot/design.chainlesschain.com' && test ! -L '/www/wwwroot/design.chainlesschain.com'
test ! -e '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354' && test ! -e '/www/wwwroot/design.chainlesschain.com.bak-20261013-docs-d898d4e04d03-023354' && test ! -L '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354' && test ! -L '/www/wwwroot/design.chainlesschain.com.bak-20261013-docs-d898d4e04d03-023354'
live_identity[design]="$(stat -c %d:%i '/www/wwwroot/design.chainlesschain.com')"
printf '%s  %s\n' 'ff8c21155ef73b5801b458a8ed1aa7fff01c9c8a72b0d197e738993d32d2f831' '/tmp/20261013-docs-d898d4e04d03-023354-design.tar.gz' | sha256sum -c -
mkdir '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354'
tar -xzf '/tmp/20261013-docs-d898d4e04d03-023354-design.tar.gz' -C '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354'
test -f '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/index.html'
test "$(find '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354' -name '*.html' | wc -l)" -eq 279
test "$(find '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354' -type f | wc -l)" -eq 865
(cd '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354' && sha256sum -c deployment-files.sha256 >/dev/null)
chown -R www:www '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354'
echo 'STAGED design: 279 HTML / 865 files'
if { test -e '/www/wwwroot/design.chainlesschain.com/.well-known' || test -L '/www/wwwroot/design.chainlesschain.com/.well-known'; } && test ! -e '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/.well-known' && test ! -L '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/.well-known'; then
  cp -a -- '/www/wwwroot/design.chainlesschain.com/.well-known' '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/.well-known'
  echo 'PRESERVED_OPERATIONAL design .well-known'
fi
if test -e '/www/wwwroot/design.chainlesschain.com/logo-128.png' && test ! -e '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-128.png' && test ! -L '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-128.png'; then
  test -f '/www/wwwroot/design.chainlesschain.com/logo-128.png' || exit 1
  test ! -L '/www/wwwroot/design.chainlesschain.com/logo-128.png' || exit 1
  cp -a -- '/www/wwwroot/design.chainlesschain.com/logo-128.png' '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-128.png'
  retained_sha=$(sha256sum -- '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-128.png'); retained_sha=${retained_sha%% *}
  retained_bytes=$(stat -c %s '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-128.png')
  echo "PRESERVED_FILE design logo-128.png $retained_sha $retained_bytes"
fi
if test -e '/www/wwwroot/design.chainlesschain.com/logo-32.png' && test ! -e '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-32.png' && test ! -L '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-32.png'; then
  test -f '/www/wwwroot/design.chainlesschain.com/logo-32.png' || exit 1
  test ! -L '/www/wwwroot/design.chainlesschain.com/logo-32.png' || exit 1
  cp -a -- '/www/wwwroot/design.chainlesschain.com/logo-32.png' '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-32.png'
  retained_sha=$(sha256sum -- '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-32.png'); retained_sha=${retained_sha%% *}
  retained_bytes=$(stat -c %s '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-32.png')
  echo "PRESERVED_FILE design logo-32.png $retained_sha $retained_bytes"
fi
if test -e '/www/wwwroot/design.chainlesschain.com/logo-64.png' && test ! -e '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-64.png' && test ! -L '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-64.png'; then
  test -f '/www/wwwroot/design.chainlesschain.com/logo-64.png' || exit 1
  test ! -L '/www/wwwroot/design.chainlesschain.com/logo-64.png' || exit 1
  cp -a -- '/www/wwwroot/design.chainlesschain.com/logo-64.png' '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-64.png'
  retained_sha=$(sha256sum -- '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-64.png'); retained_sha=${retained_sha%% *}
  retained_bytes=$(stat -c %s '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-64.png')
  echo "PRESERVED_FILE design logo-64.png $retained_sha $retained_bytes"
fi
if test -e '/www/wwwroot/design.chainlesschain.com/logo-optimized.png' && test ! -e '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-optimized.png' && test ! -L '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-optimized.png'; then
  test -f '/www/wwwroot/design.chainlesschain.com/logo-optimized.png' || exit 1
  test ! -L '/www/wwwroot/design.chainlesschain.com/logo-optimized.png' || exit 1
  cp -a -- '/www/wwwroot/design.chainlesschain.com/logo-optimized.png' '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-optimized.png'
  retained_sha=$(sha256sum -- '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-optimized.png'); retained_sha=${retained_sha%% *}
  retained_bytes=$(stat -c %s '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-optimized.png')
  echo "PRESERVED_FILE design logo-optimized.png $retained_sha $retained_bytes"
fi
if test -e '/www/wwwroot/design.chainlesschain.com/logo.png' && test ! -e '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo.png' && test ! -L '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo.png'; then
  test -f '/www/wwwroot/design.chainlesschain.com/logo.png' || exit 1
  test ! -L '/www/wwwroot/design.chainlesschain.com/logo.png' || exit 1
  cp -a -- '/www/wwwroot/design.chainlesschain.com/logo.png' '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo.png'
  retained_sha=$(sha256sum -- '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo.png'); retained_sha=${retained_sha%% *}
  retained_bytes=$(stat -c %s '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo.png')
  echo "PRESERVED_FILE design logo.png $retained_sha $retained_bytes"
fi
if test -e '/www/wwwroot/design.chainlesschain.com/logo.webp' && test ! -e '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo.webp' && test ! -L '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo.webp'; then
  test -f '/www/wwwroot/design.chainlesschain.com/logo.webp' || exit 1
  test ! -L '/www/wwwroot/design.chainlesschain.com/logo.webp' || exit 1
  cp -a -- '/www/wwwroot/design.chainlesschain.com/logo.webp' '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo.webp'
  retained_sha=$(sha256sum -- '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo.webp'); retained_sha=${retained_sha%% *}
  retained_bytes=$(stat -c %s '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo.webp')
  echo "PRESERVED_FILE design logo.webp $retained_sha $retained_bytes"
fi
if test -e '/www/wwwroot/design.chainlesschain.com/og-image.svg' && test ! -e '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/og-image.svg' && test ! -L '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/og-image.svg'; then
  test -f '/www/wwwroot/design.chainlesschain.com/og-image.svg' || exit 1
  test ! -L '/www/wwwroot/design.chainlesschain.com/og-image.svg' || exit 1
  cp -a -- '/www/wwwroot/design.chainlesschain.com/og-image.svg' '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/og-image.svg'
  retained_sha=$(sha256sum -- '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/og-image.svg'); retained_sha=${retained_sha%% *}
  retained_bytes=$(stat -c %s '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/og-image.svg')
  echo "PRESERVED_FILE design og-image.svg $retained_sha $retained_bytes"
fi
test -d '/www/wwwroot/www.chainlesschain.com' && test ! -L '/www/wwwroot/www.chainlesschain.com'
test ! -e '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354' && test ! -e '/www/wwwroot/www.chainlesschain.com.bak-20261013-docs-d898d4e04d03-023354' && test ! -L '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354' && test ! -L '/www/wwwroot/www.chainlesschain.com.bak-20261013-docs-d898d4e04d03-023354'
live_identity[www]="$(stat -c %d:%i '/www/wwwroot/www.chainlesschain.com')"
printf '%s  %s\n' '765599cff7ac759a4a5053e130f7f08fbff1f251098d109130f0eab37d6a1297' '/tmp/20261013-docs-d898d4e04d03-023354-www.tar.gz' | sha256sum -c -
mkdir '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354'
tar -xzf '/tmp/20261013-docs-d898d4e04d03-023354-www.tar.gz' -C '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354'
test -f '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/index.html'
test "$(find '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354' -name '*.html' | wc -l)" -eq 20
test "$(find '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354' -type f | wc -l)" -eq 37
(cd '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354' && sha256sum -c deployment-files.sha256 >/dev/null)
chown -R www:www '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354'
echo 'STAGED www: 20 HTML / 37 files'
if { test -e '/www/wwwroot/www.chainlesschain.com/.well-known' || test -L '/www/wwwroot/www.chainlesschain.com/.well-known'; } && test ! -e '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/.well-known' && test ! -L '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/.well-known'; then
  cp -a -- '/www/wwwroot/www.chainlesschain.com/.well-known' '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/.well-known'
  echo 'PRESERVED_OPERATIONAL www .well-known'
fi
if test -e '/www/wwwroot/www.chainlesschain.com/logo-128.png' && test ! -e '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-128.png' && test ! -L '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-128.png'; then
  test -f '/www/wwwroot/www.chainlesschain.com/logo-128.png' || exit 1
  test ! -L '/www/wwwroot/www.chainlesschain.com/logo-128.png' || exit 1
  cp -a -- '/www/wwwroot/www.chainlesschain.com/logo-128.png' '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-128.png'
  retained_sha=$(sha256sum -- '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-128.png'); retained_sha=${retained_sha%% *}
  retained_bytes=$(stat -c %s '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-128.png')
  echo "PRESERVED_FILE www logo-128.png $retained_sha $retained_bytes"
fi
if test -e '/www/wwwroot/www.chainlesschain.com/logo-32.png' && test ! -e '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-32.png' && test ! -L '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-32.png'; then
  test -f '/www/wwwroot/www.chainlesschain.com/logo-32.png' || exit 1
  test ! -L '/www/wwwroot/www.chainlesschain.com/logo-32.png' || exit 1
  cp -a -- '/www/wwwroot/www.chainlesschain.com/logo-32.png' '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-32.png'
  retained_sha=$(sha256sum -- '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-32.png'); retained_sha=${retained_sha%% *}
  retained_bytes=$(stat -c %s '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-32.png')
  echo "PRESERVED_FILE www logo-32.png $retained_sha $retained_bytes"
fi
if test -e '/www/wwwroot/www.chainlesschain.com/logo-64.png' && test ! -e '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-64.png' && test ! -L '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-64.png'; then
  test -f '/www/wwwroot/www.chainlesschain.com/logo-64.png' || exit 1
  test ! -L '/www/wwwroot/www.chainlesschain.com/logo-64.png' || exit 1
  cp -a -- '/www/wwwroot/www.chainlesschain.com/logo-64.png' '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-64.png'
  retained_sha=$(sha256sum -- '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-64.png'); retained_sha=${retained_sha%% *}
  retained_bytes=$(stat -c %s '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-64.png')
  echo "PRESERVED_FILE www logo-64.png $retained_sha $retained_bytes"
fi
if test -e '/www/wwwroot/www.chainlesschain.com/logo-optimized.png' && test ! -e '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-optimized.png' && test ! -L '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-optimized.png'; then
  test -f '/www/wwwroot/www.chainlesschain.com/logo-optimized.png' || exit 1
  test ! -L '/www/wwwroot/www.chainlesschain.com/logo-optimized.png' || exit 1
  cp -a -- '/www/wwwroot/www.chainlesschain.com/logo-optimized.png' '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-optimized.png'
  retained_sha=$(sha256sum -- '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-optimized.png'); retained_sha=${retained_sha%% *}
  retained_bytes=$(stat -c %s '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo-optimized.png')
  echo "PRESERVED_FILE www logo-optimized.png $retained_sha $retained_bytes"
fi
if test -e '/www/wwwroot/www.chainlesschain.com/logo.png' && test ! -e '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo.png' && test ! -L '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo.png'; then
  test -f '/www/wwwroot/www.chainlesschain.com/logo.png' || exit 1
  test ! -L '/www/wwwroot/www.chainlesschain.com/logo.png' || exit 1
  cp -a -- '/www/wwwroot/www.chainlesschain.com/logo.png' '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo.png'
  retained_sha=$(sha256sum -- '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo.png'); retained_sha=${retained_sha%% *}
  retained_bytes=$(stat -c %s '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo.png')
  echo "PRESERVED_FILE www logo.png $retained_sha $retained_bytes"
fi
if test -e '/www/wwwroot/www.chainlesschain.com/logo.webp' && test ! -e '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo.webp' && test ! -L '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo.webp'; then
  test -f '/www/wwwroot/www.chainlesschain.com/logo.webp' || exit 1
  test ! -L '/www/wwwroot/www.chainlesschain.com/logo.webp' || exit 1
  cp -a -- '/www/wwwroot/www.chainlesschain.com/logo.webp' '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo.webp'
  retained_sha=$(sha256sum -- '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo.webp'); retained_sha=${retained_sha%% *}
  retained_bytes=$(stat -c %s '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/logo.webp')
  echo "PRESERVED_FILE www logo.webp $retained_sha $retained_bytes"
fi
if test -e '/www/wwwroot/www.chainlesschain.com/og-image.svg' && test ! -e '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/og-image.svg' && test ! -L '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/og-image.svg'; then
  test -f '/www/wwwroot/www.chainlesschain.com/og-image.svg' || exit 1
  test ! -L '/www/wwwroot/www.chainlesschain.com/og-image.svg' || exit 1
  cp -a -- '/www/wwwroot/www.chainlesschain.com/og-image.svg' '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/og-image.svg'
  retained_sha=$(sha256sum -- '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/og-image.svg'); retained_sha=${retained_sha%% *}
  retained_bytes=$(stat -c %s '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354/og-image.svg')
  echo "PRESERVED_FILE www og-image.svg $retained_sha $retained_bytes"
fi
test "$(stat -c %d:%i '/www/wwwroot/docs.chainlesschain.com')" = "${live_identity[docs]}"
mv -T -- '/www/wwwroot/docs.chainlesschain.com' '/www/wwwroot/docs.chainlesschain.com.bak-20261013-docs-d898d4e04d03-023354'
if ! mv -T -- '/www/wwwroot/docs.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354' '/www/wwwroot/docs.chainlesschain.com'; then mv -T -- '/www/wwwroot/docs.chainlesschain.com.bak-20261013-docs-d898d4e04d03-023354' '/www/wwwroot/docs.chainlesschain.com'; exit 1; fi
completed+=('docs')
echo 'LIVE docs: backup /www/wwwroot/docs.chainlesschain.com.bak-20261013-docs-d898d4e04d03-023354'
test "$(stat -c %d:%i '/www/wwwroot/design.chainlesschain.com')" = "${live_identity[design]}"
mv -T -- '/www/wwwroot/design.chainlesschain.com' '/www/wwwroot/design.chainlesschain.com.bak-20261013-docs-d898d4e04d03-023354'
if ! mv -T -- '/www/wwwroot/design.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354' '/www/wwwroot/design.chainlesschain.com'; then mv -T -- '/www/wwwroot/design.chainlesschain.com.bak-20261013-docs-d898d4e04d03-023354' '/www/wwwroot/design.chainlesschain.com'; exit 1; fi
completed+=('design')
echo 'LIVE design: backup /www/wwwroot/design.chainlesschain.com.bak-20261013-docs-d898d4e04d03-023354'
test "$(stat -c %d:%i '/www/wwwroot/www.chainlesschain.com')" = "${live_identity[www]}"
mv -T -- '/www/wwwroot/www.chainlesschain.com' '/www/wwwroot/www.chainlesschain.com.bak-20261013-docs-d898d4e04d03-023354'
if ! mv -T -- '/www/wwwroot/www.chainlesschain.com.new-20261013-docs-d898d4e04d03-023354' '/www/wwwroot/www.chainlesschain.com'; then mv -T -- '/www/wwwroot/www.chainlesschain.com.bak-20261013-docs-d898d4e04d03-023354' '/www/wwwroot/www.chainlesschain.com'; exit 1; fi
completed+=('www')
echo 'LIVE www: backup /www/wwwroot/www.chainlesschain.com.bak-20261013-docs-d898d4e04d03-023354'
trap - EXIT
echo DEPLOYMENT_COMPLETE
