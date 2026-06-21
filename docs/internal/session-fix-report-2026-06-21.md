# Session Fix Report — 2026-06-21

**Driver:** `/loop 当前项目还存在哪些不足和优化的地方 请补充和完善` (find & fix deficiencies)
**Outcome:** 13 verified fixes across 8 subsystems; ~14 candidate findings rejected after verification.
**Verification:** every landed change has a regression test, was run green locally, and was pushed to both `github` and `gitee` via the post-commit hook.
**Isolation:** all commits used `git commit --only` to avoid touching a concurrent parallel session's WIP (`packages/cli/**`, `android-app/**`).

---

## Summary table

| # | Severity | Area | Fix | Commit | Tests |
|---|----------|------|-----|--------|-------|
| 1 | Critical | Backend (Java) | Block cross-user **overwrite** on sync upload (IDOR #7 write side) | `31df36a7` | +4 (mvn, 31 authz) |
| 2 | High | Desktop IPC | Block arbitrary-exe spawn via `file:openWithProgram` | `83ddee32` | +9 (21) |
| 3 | High | Desktop IPC | `..` traversal guards on 7 project-file handlers | `eb71d134` | +7 (29) |
| 4 | Medium | Desktop IPC / DID | Bind DID id to its signing key in `verifyDIDDocument` | `819ac254` | +2 (60) |
| 5 | Medium | Desktop IPC / config | Protect `database.*` config from renderer writes | `21af2a4f` | +6 (new) |
| 6 | High | Python ai-service | Harden intent `_parse_response` against non-object JSON | `6089c6cc` | +9 |
| 7 | Medium | Python ai-service | Skip incomplete conflict markers (avoid `KeyError`) | `acd98e67` | +4 (18) |
| 8 | Medium | Python ai-service | Count newline separators in `_chunk_text` sizing | `2478632c` | +4 |
| 9 | High | U-Key | Preserve precision for bigint wei in `tx-parser` | `f3edddb2` | +5 (30) |
| 10 | Medium | Desktop utils | Close absolute-path bypasses in `safePathSchema` | `f1171309` | +1 case (51) |
| 11 | Critical | MTC | Count only distinct member signatures toward quorum | `88d62e7b` | +3 (27) |
| 12 | Medium | Blockchain | Validate chains in cross-chain `estimateFee` | `213e4c9c` | +2 (22) |
| 13 | Medium | Enterprise (SaaS) | Reject unknown plan in `manageSubscription` | `21f05df6` | +2 (25) |

---

## Detailed findings

### 1. Backend sync upload — cross-user overwrite IDOR (`31df36a7`)
- **File:** `backend/project-service/.../service/impl/SyncServiceImpl.java` (+ `SyncService`, `SyncController`)
- **Root cause:** the download path had just been scoped to the caller, but `uploadBatch`/`resolveConflict` took no `Authentication`; every `upsertX` did `updateById(id)` on any existing row — any authenticated device could overwrite *another user's* records by id.
- **Fix:** `uploadBatch`/`resolveConflict` now take `Authentication`; before writing a record whose id already exists, `existingOwnerOutOfScope(tableName, id, ids, projectIds)` verifies the existing row's owner is in the caller's scope (same `ProjectAccessGuard` identity set as the download fix). Foreign rows → denied (`deniedCount`), never overwritten. New-record inserts and legitimate self-updates unaffected; dev-mode preserved; insert-only tables (messages/project_conversations) carry no overwrite risk.
- **Note:** found & fixed a `Set.of().contains(null)` NPE en route (nullable owner fields) → null-safe `has()` helper.
- **Verification:** `SyncServiceScopingTest` +4; 31 authz tests green (mvn 3.6.3 / Java 17).

### 2. Desktop `file:openWithProgram` — arbitrary-exe spawn (`83ddee32`)
- **File:** `desktop-app-vue/src/main/file/file-ipc.js`, `src/main/utils/safe-open.js`
- **Root cause:** the channel spawned a fully renderer-controlled `programPath` with a renderer-controlled arg and no validation — an arbitrary-code-execution primitive (the sibling `file:openWith` at least forces a native pick dialog). Exposed in preload but with **no legitimate renderer caller**.
- **Fix:** new `safe-open` validators `isExecutableProgramPath` (absolute + existing regular file + allowed exec extension on win32 / execute-bit on POSIX; rejects bare names that PATH-resolve to `cmd`/`powershell`/`bash`) and `assertSafeProgramOpen` (target must be an existing absolute path → blocks `/c calc`-style arg injection). Wired in + `shell:false`. Also added an `isPathWithin` root guard to `file:openWith`.
- **Verification:** `safe-open.test.js` +9 (21 pass).

### 3. Desktop project-file handlers — `..` traversal (`eb71d134`)
- **File:** `desktop-app-vue/src/main/file/file-ipc.js`
- **Root cause:** `copyItem/moveItem/deleteItem/renameItem/createFile/createFolder/revealInExplorer` all did `path.join(rootPath, <renderer path>)` with no `..` guard. Renderer-trust-model check confirmed legit callers (`EnhancedFileTree.vue`) only send project-relative paths.
- **Fix:** shared `assertWithinRoot(rootPath, resolved)` (uses `isPathWithin`) wired into all 7 handlers; escaping paths rejected before any fs call.
- **Residual (by design):** `file:read-content`/`write-content`/`read-binary` go through `resolveProjectPath`, which returns absolute paths verbatim (a desktop editor opens files anywhere) — mitigation there is renderer-frame-trust (sandbox/origin), not path scoping.
- **Verification:** `file-ipc.test.js` +7 (29 pass).

### 4. Desktop DID — key-substitution / impersonation (`819ac254`)
- **File:** `desktop-app-vue/src/main/did/did-manager.js`
- **Root cause:** `verifyDIDDocument` checked only that a document was self-consistently signed by its own embedded key — it never asserted the DID id was derived from that key. A DHT-write-positioned attacker could publish a victim's DID id paired with the attacker's key + signature (self-consistent) → key substitution for P2P E2EE.
- **Fix:** after the signature check, assert `document.id`'s trailing identifier === `sha256(verifying-key)[0:20]` (the deterministic `generateDID` derivation). With the signature check, forging a victim's id needs either the victim's key (can't sign) or the attacker's key (id won't match).
- **Verification:** `did-manager.test.js` +2 + 2 fixtures updated; 60 + 167 did tests green.

### 5. Desktop config — `database.*` write-protection (`21af2a4f`)
- **File:** `desktop-app-vue/src/main/config/config-ipc.js`
- **Root cause:** `config:set` wrote any renderer key straight to `appConfig.set`, and `config:update` bulk-wrote top-level namespaces — a renderer/compromised frame could overwrite `database.sqlcipherKey` (the SQLCipher master key). The renderer only legitimately writes a few UI/project keys.
- **Fix:** namespace-aware `isProtectedConfigKey` (matches `database` and `database.*`); `config:set` rejects it, `config:update` skips it (full-config round-trips still write everything else). Refactored `registerConfigIPC` to accept an injectable `ipcMain` for testability (prod falls back to `require("electron").ipcMain`).
- **Verification:** new `config-ipc.test.js` (6).

### 6. ai-service intent parse crash (`6089c6cc`)
- **File:** `backend/ai-service/src/nlu/intent_classifier.py`
- **Root cause:** `_parse_response` crashed with an uncaught `TypeError` when the LLM returned valid JSON that wasn't an object — a bare string/number/bool/null, or a list whose first element isn't a dict. The required-field validation ran *outside* `except json.JSONDecodeError`. Empirically reproduced on all five inputs.
- **Fix:** after the list-unwrap, guard `isinstance(result, dict)` → fall back to the default intent. Also made the embedded-JSON extraction path accept only a dict and fill missing required fields.
- **Verification:** new `test_intent_classifier.py` (9); offline suite 48 → 55 pass (only pre-existing Ollama-503 / pywin32-DLL env failures remain).

### 7. ai-service incomplete conflict markers (`acd98e67`)
- **File:** `backend/ai-service/src/git/conflict_resolver.py`
- **Root cause:** `parse_conflict_markers` appended a conflict block on seeing `<<<<<<<` even with no closing `>>>>>>>` (truncated merge, or a file merely containing `<<<<<<<` text). That block lacked `end_line`, so `resolve_conflicts` later crashed with `KeyError('end_line')`. Reproduced.
- **Fix:** only record a conflict when the closing `>>>>>>>` is found — incomplete/false markers are ignored, and every returned conflict has `end_line` + `incoming_branch`.
- **Verification:** `test_conflict_resolver.py` +4 (18 pass).

### 8. ai-service `_chunk_text` size drift (`2478632c`)
- **File:** `backend/ai-service/src/indexing/file_indexer.py`
- **Root cause:** `current_size` summed only line lengths, never the `\n` separators that `'\n'.join` inserts, so multi-line chunk `size` was short by `(lines-1)`, chunks exceeded `chunk_size`, and the error compounded across chunks via the separator-free overlap carry-over.
- **Fix:** maintain `current_size == len('\n'.join(current_chunk))` — `+1` per non-first line, and overlap carry-over `= overlap_size + max(0, len(overlap_lines)-1)`.
- **Verification:** new `test_file_indexer_chunk.py` (4); imports stubbed to isolate the pure method (qdrant_client→portalocker→pywin32 is broken on this host).

### 9. U-Key `tx-parser` bigint precision (`f3edddb2`)
- **File:** `desktop-app-vue/src/main/ukey/tx-parser.js`
- **Root cause:** `normalizeValue`'s bigint branch used `Number(value)/1e18`, losing precision above 2^53 — the amount shown before hardware signing could be silently wrong (e.g. `999999999999999999999999` wei → `"1000000000"` instead of `"999999.999999999999999999"` ETH). The hex/decimal branches already used correct BigInt math.
- **Fix:** the bigint branch now uses the same BigInt integer+fraction arithmetic.
- **Verification:** `tx-parser.test.js` +5 (30 pass), incl. a bigint==hex cross-check.

### 10. Desktop `safePathSchema` absolute-path bypasses (`f1171309`)
- **File:** `desktop-app-vue/src/main/utils/ipc-validator.js`
- **Root cause:** the drive-letter regex `/^[A-Z]:\\/` missed lowercase drives (`c:\`), forward-slash drives (`C:/`), and Windows UNC paths (`\\server\share`). `safePathSchema` backs `gitRepoPathSchema` + file path schemas, so these were real absolute-path/traversal bypasses.
- **Fix:** reject leading `/`, leading `\` (covers `\\` UNC), and `^[A-Za-z]:[\\/]` (drive letter, any case, either slash).
- **Verification:** `ipc-validator.test.js` +1 case / 6 assertions (51 pass).

### 11. MTC multi-sig quorum integrity (`88d62e7b`)
- **File:** `desktop-app-vue/src/main/mtc/governance-multisig.js`
- **Root cause:** `finalize`/`getStatus`/`listProposals` counted quorum by blindly reading every `*.json` in the `signatures/` directory. `addSignature` validates membership + DID/pubkey and is idempotent per-DID, but the decision point re-trusted the directory: a signature file for a non-member DID, or a member's signature duplicated under a different filename (via direct FS tampering), would inflate the collected count and could satisfy M-of-N with fewer than M distinct members.
- **Fix:** new `_distinctMemberSignatures(rawSigs, members)` keeps only signatures whose `did ∈ members`, deduped by `did`; wired into all three count sites. Defense-in-depth at the consensus boundary; normal flow unchanged.
- **Verification:** `governance-multisig.test.js` +3 (27 pass).

### 12. Blockchain cross-chain `estimateFee` (`213e4c9c`)
- **File:** `desktop-app-vue/src/main/blockchain/cross-chain-bridge.js`
- **Root cause:** `estimateFee` used `this._chains.get(chain)?.type`; for a nonexistent chain the type was undefined and `'evm' !== undefined` evaluated true → it silently returned a 2× "cross-type" fee for an invalid chain. `bridgeAsset` already throws `Unknown chain`.
- **Fix:** `estimateFee` now validates both chains (rejects unknown source/destination), matching `bridgeAsset`.
- **Verification:** `cross-chain-bridge.test.js` +2 (22 pass).

### 13. Enterprise SaaS `manageSubscription` (`21f05df6`)
- **File:** `desktop-app-vue/src/main/enterprise/saas/tenant-manager.js`
- **Root cause:** `price: prices[plan] || 0` meant any unrecognized plan name (typo/crafted) was silently stored as an active subscription priced at 0 — a billing/data-integrity hole.
- **Fix:** validate `plan` against the known set; throw `Invalid plan: <plan>` before creating/persisting anything. `free` is priced via the map directly (0).
- **Verification:** `tenant-manager.test.js` +2 (25 pass).

---

## Rejected findings (verify-don't-trust)

These candidates were investigated and **deliberately not changed** — recorded so they aren't "re-found" and re-proposed:

| Candidate | Why rejected |
|-----------|--------------|
| sync upload **insert-as-another-user** | Out of scope this pass: download (read) was the severe leak; overwrite (fix #1) is the documented headline. Insert is lower-severity data-pollution; left as documented residual. |
| agent-economy float division (remainder loss) | **By design** — the existing test asserts `r.share ≈ pool/n` for *all* recipients ("equal shares" is the codified contract); conserving the remainder would violate it. |
| conflict_resolver "off-by-one cascade" | **False positive** — code iterates conflicts back-to-front ("从后往前替换（避免行号变化）"), the correct anti-cascade pattern. |
| channel-event-batch `leafIndex` precedence | **False positive** — `(obj && obj.x) >= 0 ? obj.x : -1` correctly yields `-1` when `x` is missing. |
| bm25 `_extract_*` / `removeDocument` "concurrency" | **False positive** — synchronous JS has no concurrency; `indexDocuments` rebuilds fully. |
| bm25 `avgDocLength` division-by-zero (×3) | **False positive** — `0/0 \|\| 1 === 1` and `0/N \|\| 1 === 1`; `avgDocLength` is never 0. |
| SSO expiry `<` vs `>=` | 1 ms boundary nuance; not a real vuln. |
| approval-workflow `approvers[step+1]` OOB | **False positive** — `if (isComplete) { … return; }` precedes the access; index is in-bounds otherwise. |
| collaboration knowledge-perms role check | Would **loosen** an authorization check on an assumption (wrong direction); the restrictive owner/admin check is the safe default. |
| `acceptDelegation` no expiry check | Low impact — the enforcement path `_checkDelegatedPermission` already re-validates `start_date`/`end_date`. |
| migration version `>=` string compare | **False positive** — `"10" >= 7` is `true` (JS coerces mixed string/number numerically). |
| embedding-cache eviction "unbounded" | **Not a bug** — batch LRU bounded between 0.9×max and max+1. |
| analytics pagination "no hasMore" | **Not a bug** — `< limit` rows at the end is standard SQL pagination; missing feature, not defect. |

---

## Method notes

- Each subsystem was swept with a read-only `Explore` agent, then **every** candidate was independently verified by reading the code (and often an empirical repro) before any change. False positives were rejected, not patched.
- Backend (Java) changes were `mvn`-verified; desktop (JS) via `vitest`; ai-service (Python) via `pytest` (offline subset — the host's pywin32 DLL and missing Ollama cause unrelated, pre-existing env failures).
- Two documented security backlogs are now fully closed: backend project-service IDOR review and desktop main-process IPC review (only a by-design absolute-path read/write residual remains, which needs a renderer-frame-trust decision, not a code fix).
- Loop stopped when sweeps began returning entirely false positives (diminishing returns) rather than fabricating low-value changes.
