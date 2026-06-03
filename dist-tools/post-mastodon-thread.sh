#!/usr/bin/env bash
# post-mastodon-thread.sh — post v5.0.3.55 announcement as a 3-toot thread
#
# Usage:
#   export MASTODON_INSTANCE="https://fosstodon.org"   # or your instance
#   export MASTODON_TOKEN="your_access_token"          # write:statuses scope
#   bash dist-tools/post-mastodon-thread.sh
#
# Dry-run (no posts, just prints curl commands):
#   DRY_RUN=1 bash dist-tools/post-mastodon-thread.sh
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

# Toot bodies — keep in sync with dist-tools/mastodon-nostr-v5.0.3.55.md
read -r -d '' TOOT_1 <<'EOF' || true
🚀 ChainlessChain v5.0.3.55 ships.

Android v1.0 GA was real-device validated last week. iOS mirror port started the next day — all 4 phases landed framework-complete inside 24h.

QR pairing · WebRTC remote terminal · remote-operate framework · push notifications. All on iOS now.

Open-source. Decentralized personal AI on hardware-level security (U-Key / SIMKey). Knowledge · Social · Trading.

🧵 1/3

#ChainlessChain #DecentralizedAI #PrivacyTech #SelfHosted
EOF

read -r -d '' TOOT_2 <<'EOF' || true
The "4 phases / 1 day" trick: mirror an already-validated Android version.

1️⃣ Pairing — Flow A/B QR + 6-digit fallback (71 tests)
2️⃣ Terminal — WebRTC DataChannel + xterm.js WKWebView (163 tests)
3️⃣ Remote-operate + 4 typed skills (~264 tests)
4️⃣ Notification skill — 11 RPC methods + UN center push (~313 tests)

UI 1:1 with Android Kt screens. HIG deviation: 6-item whitelist. Android validated on Xiaomi × Win desktop — confidence transfers.

2/3
EOF

read -r -d '' TOOT_3 <<'EOF' || true
Also in v5.0.3.55:

• CLI 0.162.0 — `cc pair preflight` Linux LAN diagnostics + `cc pair token` headless pairing
• Cross-chain bridge × m-of-n multisig provenance
• Wear → phone VoiceMode forward
• 2 P0 continuation-leak fixes

Releases: https://github.com/chainlesschain/chainlesschain/releases/tag/v5.0.3.55
Docs: https://docs.chainlesschain.com
Design: https://design.chainlesschain.com

3/3

#OpenSource #FOSS #ElectronJS #SwiftUI
EOF

post_toot() {
    local body="$1"
    local reply_to="${2:-}"

    # Diagnostic to stderr — only the toot ID goes to stdout for $(...) chaining
    local len
    len=$(printf '%s' "$body" | wc -c)
    echo "[mastodon] posting toot (${len} chars)..." >&2
    if [ -n "$reply_to" ]; then
        echo "[mastodon]   reply to: ${reply_to}" >&2
    fi

    if [ "$DRY_RUN" = "1" ]; then
        echo "[dry-run] would POST ${MASTODON_INSTANCE}/api/v1/statuses" >&2
        echo "[dry-run]   status: $(echo "$body" | head -3)..." >&2
        echo "DRY_RUN_$(date +%s%N)"
        return
    fi

    # Build form data
    local form_args=( --form "status=${body}" --form "visibility=public" )
    if [ -n "$reply_to" ]; then
        form_args+=( --form "in_reply_to_id=${reply_to}" )
    fi

    local response
    response=$(curl --silent --show-error --fail \
        --header "Authorization: Bearer ${MASTODON_TOKEN}" \
        "${form_args[@]}" \
        "${MASTODON_INSTANCE}/api/v1/statuses")

    local id url
    id=$(echo "$response" | python -c "import sys,json; print(json.load(sys.stdin)['id'])")
    url=$(echo "$response" | python -c "import sys,json; print(json.load(sys.stdin)['url'])")
    echo "[mastodon]   ok id=${id}  url=${url}" >&2
    echo "$id"
}

echo "=== Mastodon thread post — v5.0.3.55 ==="
echo "instance: ${MASTODON_INSTANCE}"
echo "dry-run:  ${DRY_RUN}"
echo

ID_1=$(post_toot "$TOOT_1" "")
sleep 3
ID_2=$(post_toot "$TOOT_2" "$ID_1")
sleep 3
ID_3=$(post_toot "$TOOT_3" "$ID_2")

echo
echo "=== Done. Thread head: ${MASTODON_INSTANCE}/web/statuses/${ID_1} ==="
echo
echo "Rollback (delete the thread):"
echo "  for id in ${ID_3} ${ID_2} ${ID_1}; do"
echo "    curl -X DELETE -H \"Authorization: Bearer \$MASTODON_TOKEN\" \\"
echo "      \"${MASTODON_INSTANCE}/api/v1/statuses/\$id\""
echo "  done"
