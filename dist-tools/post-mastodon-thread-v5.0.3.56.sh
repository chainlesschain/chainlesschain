#!/usr/bin/env bash
# post-mastodon-thread-v5.0.3.56.sh — post v5.0.3.56 announcement as a 3-toot thread
#
# Usage:
#   export MASTODON_INSTANCE="https://fosstodon.org"   # or your instance
#   export MASTODON_TOKEN="your_access_token"          # write:statuses scope
#   bash dist-tools/post-mastodon-thread-v5.0.3.56.sh
#
# Dry-run (no posts, just prints curl commands):
#   DRY_RUN=1 bash dist-tools/post-mastodon-thread-v5.0.3.56.sh
#
# Get a token:
#   1. Visit ${MASTODON_INSTANCE}/settings/applications/new
#   2. App name: "ChainlessChain Release"
#   3. Scopes: tick `write:statuses` only
#   4. Save → copy "Your access token"
#
# Rate-limit: Mastodon caps at 300 toots/30min. 3 toots in 30s is trivially safe.

set -euo pipefail

: "${MASTODON_INSTANCE:?set MASTODON_INSTANCE (e.g. https://fosstodon.org)}"
: "${MASTODON_TOKEN:?set MASTODON_TOKEN (write:statuses scope)}"

DRY_RUN="${DRY_RUN:-0}"

# Toot bodies — keep in sync with dist-tools/mastodon-nostr-v5.0.3.56.md
read -r -d '' TOOT_1 <<'EOF' || true
🛠 ChainlessChain v5.0.3.56 ships.

Maintenance release, but interesting one: we caught 8 prior commits where iOS CI showed "success" — but never actually compiled.

Double-layer mask did it:
1️⃣ continue-on-error: true (job-level)
2️⃣ `xcodebuild | xcpretty || true` (pipe-level)

Both layers swallowed real failures into green checkmarks.

20 iter overnight to dig out. Now SPM Phase 1-5 truly compiles on every push.

🧵 1/3

#CI #OpenSource #DevHonesty
EOF

read -r -d '' TOOT_2 <<'EOF' || true
The 20-iter unmask chain:

✅ Lifted `continue-on-error` + `|| true` from build steps
✅ Pivoted to native `swift build --target CoreP2P` (xcodebuild + Package.swift CLI is a maze)
✅ Wired 5 local SPM products into .xcodeproj programmatically (script, not Xcode UI)
✅ Restored Data.bytes ext, SecKey force-cast, 4 missing crypto types

But honest truth: app target itself = **412 compile errors** across 30+ files. Pre-Phase-1-5 scaffold debt. Real iOS .ipa skipped this release.

2/3
EOF

read -r -d '' TOOT_3 <<'EOF' || true
Open-source. Decentralized personal AI on hardware-level security (U-Key / SIMKey). Knowledge · Social · Trading.

🖥 Win/macOS/Linux: github.com/chainlesschain/chainlesschain/releases/tag/v5.0.3.56
📱 Android: 4 ABI variants on the same release
⌨️ CLI: npm i -g chainlesschain → 0.162.0

The CI lessons:
📖 docs.chainlesschain.com/changelog
🎨 design.chainlesschain.com

#ChainlessChain #PrivacyTech
EOF

post_toot() {
    local body="$1"
    local reply_to_id="${2:-}"
    local form_args=(--data-urlencode "status=$body" --data-urlencode "visibility=public")
    if [ -n "$reply_to_id" ]; then
        form_args+=(--data-urlencode "in_reply_to_id=$reply_to_id")
    fi
    if [ "$DRY_RUN" = "1" ]; then
        echo "--- DRY-RUN curl ---"
        printf 'curl -X POST "%s/api/v1/statuses" \\\n' "$MASTODON_INSTANCE"
        printf '  -H "Authorization: Bearer ***" \\\n'
        for a in "${form_args[@]}"; do printf '  %s \\\n' "$(printf '%q' "$a")"; done
        echo
        echo "$body" | sed 's/^/    /'
        echo
        echo "(toot length: $(printf '%s' "$body" | wc -c) chars)"
        echo "--- end DRY-RUN ---"
        echo "DRY_RUN_ID_$(date +%s%N)"  # fake id for reply chain in dry-run
        return
    fi
    local resp
    resp=$(curl -s -X POST "${MASTODON_INSTANCE}/api/v1/statuses" \
        -H "Authorization: Bearer ${MASTODON_TOKEN}" \
        "${form_args[@]}")
    local id
    id=$(echo "$resp" | python -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null || true)
    if [ -z "$id" ]; then
        echo "ERROR: post failed. Response:" >&2
        echo "$resp" >&2
        exit 1
    fi
    echo "$id"
}

echo "Posting toot 1/3..."
ID1=$(post_toot "$TOOT_1")
echo "  → id=$ID1"
sleep 2

echo "Posting toot 2/3 (reply to $ID1)..."
ID2=$(post_toot "$TOOT_2" "$ID1")
echo "  → id=$ID2"
sleep 2

echo "Posting toot 3/3 (reply to $ID2)..."
ID3=$(post_toot "$TOOT_3" "$ID2")
echo "  → id=$ID3"

if [ "$DRY_RUN" = "1" ]; then
    echo
    echo "✅ DRY_RUN complete. No toots posted."
else
    echo
    echo "✅ Thread posted: ${MASTODON_INSTANCE}/@$(curl -s -H "Authorization: Bearer ${MASTODON_TOKEN}" "${MASTODON_INSTANCE}/api/v1/accounts/verify_credentials" | python -c "import sys,json; print(json.load(sys.stdin)['username'])" 2>/dev/null || echo "?")/$ID1"
fi
