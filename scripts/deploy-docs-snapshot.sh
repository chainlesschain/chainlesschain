#!/usr/bin/env bash
# Build outputs must exist before running this script. Publishes all three sites
# with one server lock, unique staging directories, retained live files and rollback.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
server="${DOCS_DEPLOY_SERVER:-root@47.111.5.128}"
source_head="$(git -C "$repo_root" rev-parse HEAD)"
test -z "$(git -C "$repo_root" status --porcelain)" || { echo "Commit documentation changes before deploying" >&2; exit 1; }
stamp="$(date -u +%Y%m%d-%H%M%S)-${source_head:0:10}-docs"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/chainlesschain-docs-$stamp.XXXXXX")"
manifest="$work_dir/manifest.tsv"
remote_prefix="/tmp/chainlesschain-docs-$stamp"
ssh_opts=(-o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=yes -o UpdateHostKeys=no)

case "$stamp" in *[!a-zA-Z0-9-]*) echo "Unsafe deployment stamp" >&2; exit 1 ;; esac
printf 'Deployment stamp: %s\nSource commit: %s\nLocal evidence: %s\n' "$stamp" "$source_head" "$work_dir"

for site in docs design www; do
  case "$site" in
    docs) dist="$repo_root/docs-site/docs/.vitepress/dist"; minimum=600; required="chainlesschain/cli-ide-update-2026-10-29-131.html" ;;
    design) dist="$repo_root/docs-site-design/docs/.vitepress/dist"; minimum=250; required="release-runtime-update-2026-10-29-131.html" ;;
    www) dist="$repo_root/docs-website-v2/dist"; minimum=18; required="index.html" ;;
  esac
  test -f "$dist/index.html" && test -f "$dist/$required"
  if [ "$site" != www ]; then
    grep -Fq '0.166.131' "$dist/$required"
  fi
  html_count="$(find "$dist" -type f -name '*.html' | wc -l | tr -d ' ')"
  file_count="$(find "$dist" -type f | wc -l | tr -d ' ')"
  test "$html_count" -ge "$minimum"
  if [ "$site" = www ]; then
    grep -Fq '0.166.131' "$dist/index.html"
    grep -Fq '0.37.169' "$dist/index.html"
    grep -Fq '0.4.186' "$dist/index.html"
    grep -Fq 'v5.0.3.143' "$dist/index.html"
    grep -Fq '6 万+' "$dist/index.html"
  fi
  if find "$dist" ! -type f ! -type d -print -quit | grep -q .; then
    echo "Build output contains a link or special file: $site" >&2
    exit 1
  fi
  tar -czf "$work_dir/$site.tar.gz" -C "$dist" .
  archive_sha="$(sha256sum "$work_dir/$site.tar.gz")"
  archive_sha="${archive_sha%% *}"
  printf '%s\t%s\t%s\t%s\n' "$site" "$archive_sha" "$html_count" "$file_count" >> "$manifest"
  printf '%s: %s HTML, %s files, %s\n' "$site" "$html_count" "$file_count" "$archive_sha"
done

if [ "${DOCS_DEPLOY_PREPARE_ONLY:-0}" = "1" ]; then
  echo "Prepared archives only; use scripts/deploy-docs-snapshot.ps1 for PowerShell SSH transport."
  exit 0
fi

# Do not replace a server upload belonging to a previous attempt.
ssh "${ssh_opts[@]}" "$server" "for path in '$remote_prefix-manifest.tsv' '$remote_prefix-docs.tar.gz' '$remote_prefix-design.tar.gz' '$remote_prefix-www.tar.gz'; do test ! -e \"\$path\" && test ! -L \"\$path\" || exit 1; done"
scp "${ssh_opts[@]}" "$manifest" "$server:$remote_prefix-manifest.tsv"
for site in docs design www; do
  scp "${ssh_opts[@]}" "$work_dir/$site.tar.gz" "$server:$remote_prefix-$site.tar.gz"
done

ssh "${ssh_opts[@]}" "$server" "bash -s -- '$stamp' '$source_head'" <<'REMOTE'
set -euo pipefail
umask 022
stamp="$1"
source_head="$2"
case "$stamp" in *[!a-zA-Z0-9-]*) exit 1 ;; esac
[[ "$source_head" =~ ^[0-9a-f]{40}$ ]]
root=/www/wwwroot
prefix="/tmp/chainlesschain-docs-$stamp"
exec 9>"$root/.chainlesschain-docs-deploy.lock"
flock -n 9

declare -a staged=() switched=()
declare -A expected_html=() expected_files=()
rollback() {
  local rc=$? site live backup failed restore_failed=0
  if [ "$rc" -ne 0 ]; then
    set +e
    for ((i=${#switched[@]}-1; i>=0; i--)); do
      site="${switched[$i]}"
      live="$root/$site.chainlesschain.com"
      backup="$live.bak-$stamp"
      failed="$live.failed-$stamp"
      if [ -d "$backup" ] && [ ! -e "$failed" ] && [ ! -L "$failed" ]; then
        if [ -e "$live" ] || [ -L "$live" ]; then
          if ! mv -T -- "$live" "$failed"; then
            echo "ROLLBACK_FAILED $site: cannot move $live to $failed; backup at $backup" >&2
            restore_failed=1
            continue
          fi
        fi
        if mv -T -- "$backup" "$live" && [ -f "$live/index.html" ]; then
          echo "ROLLED_BACK $site"
        else
          echo "ROLLBACK_FAILED $site: inspect $live, $backup and $failed" >&2
          restore_failed=1
        fi
      else
        echo "ROLLBACK_FAILED $site: expected backup $backup; inspect $live and $failed" >&2
        restore_failed=1
      fi
    done
    if [ "$restore_failed" -ne 0 ]; then echo "ROLLBACK_INCOMPLETE $stamp" >&2; fi
  fi
}
trap rollback EXIT

while IFS=$'\t' read -r site sha html files; do
  case "$site" in docs|design|www) ;; *) echo "Unknown site: $site" >&2; exit 1 ;; esac
  [[ "$sha" =~ ^[0-9a-f]{64}$ ]]
  [[ "$html" =~ ^[0-9]+$ && "$files" =~ ^[0-9]+$ ]]
  live="$root/$site.chainlesschain.com"
  stage="$live.new-$stamp"
  backup="$live.bak-$stamp"
  test -d "$live" && test ! -L "$live"
  test ! -e "$stage" && test ! -L "$stage"
  test ! -e "$backup" && test ! -L "$backup"
  test ! -e "$live.failed-$stamp" && test ! -L "$live.failed-$stamp"
  printf '%s  %s\n' "$sha" "$prefix-$site.tar.gz" | sha256sum -c -
  tar -tzf "$prefix-$site.tar.gz" | while IFS= read -r member; do
    case "$member" in /*|..|../*|*/../*|*/..) echo "Unsafe archive member" >&2; exit 1 ;; esac
  done
  tar -tvzf "$prefix-$site.tar.gz" | awk 'substr($0, 1, 1) != "-" && substr($0, 1, 1) != "d" { exit 1 }'
  mkdir -- "$stage"
  tar -xzf "$prefix-$site.tar.gz" -C "$stage"
  test -f "$stage/index.html"
  test "$(find "$stage" -type f -name '*.html' | wc -l)" -eq "$html"
  test "$(find "$stage" -type f | wc -l)" -eq "$files"
  case "$site" in
    docs) test -f "$stage/chainlesschain/cli-ide-update-2026-10-29-131.html"; grep -Fq '0.166.131' "$stage/chainlesschain/cli-ide-update-2026-10-29-131.html"; test -f "$stage/chainlesschain/agent-input-and-recovery.html" ;;
    design) test -f "$stage/release-runtime-update-2026-10-29-131.html"; grep -Fq '0.166.131' "$stage/release-runtime-update-2026-10-29-131.html" ;;
    www) grep -Fq '0.166.131' "$stage/index.html"; grep -Fq '0.37.169' "$stage/index.html"; grep -Fq '0.4.186' "$stage/index.html"; grep -Fq 'v5.0.3.143' "$stage/index.html"; grep -Fq '6 万+' "$stage/index.html" ;;
  esac
  # Keep operational files, old pages, and hashed assets still used by cached HTML.
  # New build files win where the paths are identical.
  rsync -a --ignore-existing --exclude='/deployment-files.sha256' --exclude='/deployment-source.json' "$live/" "$stage/"
  printf '{"schema":"chainlesschain.site-deployment/v1","stamp":"%s","sourceHeadCommit":"%s","sourceStatus":"clean-commit","site":"%s","archiveSha256":"%s","newHtmlPages":%s,"newFiles":%s}\n' "$stamp" "$source_head" "$site" "$sha" "$html" "$files" > "$stage/deployment-source.json"
  (cd "$stage" && find . -type f ! -name deployment-files.sha256 -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > deployment-files.sha256)
  (cd "$stage" && sha256sum -c deployment-files.sha256 >/dev/null)
  chown -R www:www "$stage"
  expected_html[$site]="$html"
  expected_files[$site]="$files"
  staged+=("$site")
  echo "STAGED $site: $html HTML / $files new files"
done < "$prefix-manifest.tsv"

test "${#staged[@]}" -eq 3
test "${staged[0]}" = docs && test "${staged[1]}" = design && test "${staged[2]}" = www
for site in "${staged[@]}"; do
  live="$root/$site.chainlesschain.com"
  stage="$live.new-$stamp"
  backup="$live.bak-$stamp"
  mv -T -- "$live" "$backup"
  switched+=("$site")
  mv -T -- "$stage" "$live"
  test -f "$live/index.html"
  echo "LIVE $site; rollback directory: $backup"
done
curl --resolve docs.chainlesschain.com:443:127.0.0.1 -fsSL --max-time 30 https://docs.chainlesschain.com/chainlesschain/cli-ide-update-2026-10-29-131.html -o "$prefix-origin-docs.html"
curl --resolve design.chainlesschain.com:443:127.0.0.1 -fsSL --max-time 30 https://design.chainlesschain.com/release-runtime-update-2026-10-29-131.html -o "$prefix-origin-design.html"
curl --resolve www.chainlesschain.com:443:127.0.0.1 -fsSL --max-time 30 https://www.chainlesschain.com/ -o "$prefix-origin-www.html"
for site in docs design www; do
  for version in 0.166.131 0.37.169 0.4.186; do
    grep -Fq "$version" "$prefix-origin-$site.html"
  done
done
grep -Fq 'v5.0.3.143' "$prefix-origin-www.html"
grep -Fq '6 万+' "$prefix-origin-www.html"
trap - EXIT
echo "DEPLOYED_ALL $stamp"
REMOTE

echo "All three sites switched. Verify public pages before considering the deployment complete."
