#!/usr/bin/env bash
# audit-secrets.sh — detect newly-added hard-coded secrets in a PR diff.
#
# Closes the "no local/CI secret-scan layer" gap: the repo had zero secret
# scanning, while the DID at-rest issue (hard-coded master key) showed how easy
# it is to land a credential silently. This is the regression guard for FUTURE
# additions.
#
# Design (mirrors scripts/audit-ci-masks.sh):
#   - Diff-scoped: only NEWLY added lines are checked, so the existing legit
#     U-Key default PIN `123456`, doc examples (`did:example:123456`), and test
#     fixtures don't trip on every PR.
#   - High-confidence patterns only: PEM private-key blocks, cloud-provider keys
#     and well-known token formats. The noisy generic `password = "..."` pattern
#     is intentionally NOT included (this repo has legit hard-coded values such
#     as the U-Key PIN), which would drown the signal in false positives.
#   - Advisory: exit 1 on hit so the workflow can comment, but it does NOT block
#     merge — a reviewer confirms each hit.
#   - Excludes this script + its workflow (meta-recursion).
#
# Usage:
#   bash scripts/audit-secrets.sh               # default base = origin/main
#   bash scripts/audit-secrets.sh HEAD~20       # vs 20 commits back
#   bash scripts/audit-secrets.sh origin/v1.x   # vs specific branch
#
# Exit codes:
#   0 — clean (no new secrets in diff)
#   1 — secret patterns detected (see stdout)
#   2 — diff failure (e.g. base ref unknown)

set -uo pipefail

BASE="${1:-origin/main}"

# Resolve base — if origin/main unfetched, fall back to local main
if ! git rev-parse --verify --quiet "$BASE" >/dev/null 2>&1; then
  if git rev-parse --verify --quiet main >/dev/null 2>&1; then
    echo "::warning::Base '$BASE' not found, falling back to 'main'"
    BASE="main"
  else
    echo "::error::Cannot resolve base ref '$BASE' or fallback 'main'"
    exit 2
  fi
fi

# Added lines across the whole tree, excluding this audit's own files and
# lockfiles (lockfiles carry long integrity hashes that look key-ish).
diff_output=$(git diff "$BASE"...HEAD -- '.' \
  ':!*audit-secrets*' \
  ':!*secret-scan-audit*' \
  ':!*package-lock.json' \
  ':!*pnpm-lock.yaml' \
  ':!*yarn.lock' 2>/dev/null)

if [ -z "$diff_output" ]; then
  echo "✅ No diff vs $BASE. Secret audit clean."
  exit 0
fi

# Only NEWLY added lines (start with `+` but not the `+++` file header)
added_lines=$(echo "$diff_output" | grep '^+' | grep -v '^+++' || true)

if [ -z "$added_lines" ]; then
  echo "✅ Diff vs $BASE has no added lines. Secret audit clean."
  exit 0
fi

# High-confidence secret patterns (low false-positive rate).
declare -a patterns=(
  '-----BEGIN[[:space:]]+([A-Z]+[[:space:]]+)?PRIVATE[[:space:]]+KEY-----'
  'AKIA[0-9A-Z]{16}'
  'ghp_[0-9A-Za-z]{36}'
  'github_pat_[0-9A-Za-z_]{82}'
  'xox[baprs]-[0-9A-Za-z-]{10,}'
  'AIza[0-9A-Za-z_-]{35}'
  'sk_live_[0-9A-Za-z]{24,}'
  '"private_key"[[:space:]]*:[[:space:]]*"-----BEGIN'
)

declare -a labels=(
  'PEM private-key block'
  'AWS access key id (AKIA...)'
  'GitHub personal access token (ghp_...)'
  'GitHub fine-grained PAT (github_pat_...)'
  'Slack token (xox[baprs]-...)'
  'Google API key (AIza...)'
  'Stripe live secret key (sk_live_...)'
  'PEM private key embedded in JSON'
)

found=0
echo "Scanning diff vs $BASE for hard-coded secrets..."
echo ""

for i in "${!patterns[@]}"; do
  hits=$(echo "$added_lines" | grep -nE -e "${patterns[$i]}" || true)
  if [ -n "$hits" ]; then
    echo "❌ ${labels[$i]}"
    echo "$hits" | sed 's/^/   /'
    echo ""
    found=1
  fi
done

if [ $found -eq 0 ]; then
  echo "✅ No high-confidence secret patterns in added lines. Audit clean."
  exit 0
fi

echo ""
echo "----------------------------------------------------------------------"
echo "❌ Possible hard-coded secret(s) added in this PR."
echo ""
echo "Reviewer next step:"
echo "  1. Confirm whether the hit is a REAL credential or a test/example value."
echo "  2. If real → remove it, rotate the credential, and load it from env /"
echo "     OS keychain (see desktop did-keystore.js safeStorage pattern)."
echo "  3. If a legitimate example/fixture → it is a false positive; this gate is"
echo "     advisory and does not block merge."
echo "----------------------------------------------------------------------"
exit 1
