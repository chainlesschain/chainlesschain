#!/usr/bin/env bash
# audit-ci-masks.sh — detect CI false-green mask patterns added in a PR's
# `.github/workflows/` diff.
#
# Wraps the 4 grep patterns from memory `feedback_ci_false_green_audit_checklist.md`:
#   1. `continue-on-error: true`
#   2. `|| true` (run-block mask)
#   3. `xcpretty` (silent-drops xcodebuild errors)
#   4. Hardcoded `✅` in pwsh/cmd `Write-Host` / `Write-Output`
#
# Diff-scoped (not whole-tree) so existing whitelisted advisories don't trip on
# every PR — only NEWLY added lines are checked. Excludes `ci-mask-audit.yml`
# itself (meta-recursion).
#
# Usage:
#   bash scripts/audit-ci-masks.sh               # default base = origin/main
#   bash scripts/audit-ci-masks.sh HEAD~5        # vs 5 commits back
#   bash scripts/audit-ci-masks.sh origin/v1.x   # vs specific branch
#
# Exit codes:
#   0 — clean (no new mask in workflow diff)
#   1 — mask patterns detected (see stdout for details)
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

# Get added lines in workflow diff, excluding self
# Pathspec `:!*ci-mask-audit*` excludes our own audit file (meta-recursion)
diff_output=$(git diff "$BASE"...HEAD -- '.github/workflows/' ':!*ci-mask-audit*' 2>/dev/null)

if [ -z "$diff_output" ]; then
  echo "✅ No workflow diff vs $BASE. Audit clean."
  exit 0
fi

# Extract only NEWLY added lines (start with `+` but not `+++` header)
added_lines=$(echo "$diff_output" | grep '^+' | grep -v '^+++' || true)

if [ -z "$added_lines" ]; then
  echo "✅ Workflow diff vs $BASE has no added lines. Audit clean."
  exit 0
fi

# 4 patterns from memory checklist
declare -a patterns=(
  'continue-on-error:[[:space:]]*true'
  '\|\|[[:space:]]*true'
  'xcpretty'
  '(Write-Host|Write-Output).*✅'
)

declare -a labels=(
  'continue-on-error: true (test/publish mask)'
  '|| true (run-block mask)'
  'xcpretty (silent-drops xcodebuild errors)'
  'pwsh/cmd hardcoded ✅ (no $? check)'
)

declare -a hints=(
  'Lint/jacoco/advisory = OK · tests/publish/regression-gate = CRITICAL'
  'Cleanup (git rebase abort / security delete-keychain / probe) = OK · test mask = CRITICAL'
  'ALWAYS rewrite to `2>&1 | tee build/<name>.log` + upload-artifact'
  'Use `${{ steps.X.outcome }}` mark() helper instead of literal ✅'
)

found=0
echo "Scanning workflow diff vs $BASE for CI mask patterns..."
echo ""

for i in "${!patterns[@]}"; do
  hits=$(echo "$added_lines" | grep -E "${patterns[$i]}" || true)
  if [ -n "$hits" ]; then
    echo "❌ Pattern ${i}: ${labels[$i]}"
    echo "   Hint: ${hints[$i]}"
    echo "$hits" | sed 's/^/   /'
    echo ""
    found=1
  fi
done

if [ $found -eq 0 ]; then
  echo "✅ No CI mask patterns in added lines. Audit clean."
  exit 0
fi

echo ""
echo "----------------------------------------------------------------------"
echo "❌ New CI mask patterns detected in this PR's workflow changes."
echo ""
echo "Reviewer next step:"
echo "  1. Verify hits are LEGITIMATE advisories (cleanup / lint / probe)"
echo "  2. If TEST / PUBLISH / GATE mask → require source fix per Pattern A/B/C"
echo "  3. Document new whitelist entry in feedback_ci_false_green_audit_checklist.md"
echo ""
echo 'Full judgment matrix in memory `feedback_ci_false_green_audit_checklist.md`.'
echo "----------------------------------------------------------------------"
exit 1
