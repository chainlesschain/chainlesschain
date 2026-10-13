# Open VSX activation wait and non-upload recovery review

Observed release state is supplied by parent's current capture: exact6a8 VS run38331570568 host gates success, publisher115087472223 OpenVSX upload step success, listing verifier started about01:44UTC, exact0.37.144 endpoint still404 at01:48. This agent did not duplicate Actions polling or registry polling. CLI public readback remains verified; JB matrix progress is separate.

## Frozen retry contract

`.github/workflows/ide-extensions.yml:689` gives the Linux publisher job a210-minute total timeout, covering earlier work as well as registry verification. The verification step at811 onward sets90 activation attempts with30s delays, then75 listing attempts with60s delays. `scripts/verify-ide-marketplace.mjs:179,539` checks exact version/downloadable before reading latest/listing; listing loop begins at557. Every network request has its own20s timeout.

The advertised45/75-minute windows describe retry sleeps approximately, not hard wall deadlines: activation has89 sleeps=44.5min plus up to90 request durations; listing has74 sleeps=74min plus metadata/download request time. The overall210-minute job limit can end the work sooner. At01:48 the activation phase is only around4 minutes old, so the supplied404 is not a timeout or rejection finding. Avoid reading latest during exact404 because the verifier deliberately delays that potentially cached projection.

## Platform explanation and limits

Fetched official OpenVSX publishing wiki and upstream ExtensionService.java are retained with URLs in platform-sources.json. Publishing guide lines60–68 describes automatic scanning and possible rejection. ExtensionService.java lines162–199 show scan-enabled handling and `publishHandler.publishAsync`, including a comment that it requests long-running scans. Lines241–244 evict extension/latest caches on update.

These establish an asynchronous publishing/scanning mechanism and cache handling, not the deployed revision or this specific submission's scan state. Do not assert malware, quarantine, rejection, a global outage, or guaranteed eventual publication from404 alone. The optional scanning-wiki retrieval failed at TLS transport and is not used as evidence. No fixed one-hour cache duration was independently established from these upstream files; that duration is documented in this repository's frozen workflow contract.

## If the verifier finally fails

1. Preserve the original exact-tag run attempt, per-step outcomes/logs, failure class, accepted-upload log, tag commit, Actions candidate ZIP/VSIX and digest. Distinguish activation404, stale latest, network/TLS failure, hash/content mismatch and outer job timeout. Do not classify all as platform delay.
2. Keep tag/version/source6a8 unchanged. Do not rerun the original publisher job: frozen workflow invokes `ovsx publish --skip-duplicate` again. Duplicate tolerance does not make that a read-only action. Ordinary dispatch false skips publishing/verifying and cannot supply a missing release readback; dispatch true also targets Microsoft and is inappropriate.
3. For recovery evidence, run only the frozen marketplace verifier against an independently downloaded, digest-checked candidate from original run38331570568. Use bounded single-attempt exact activation checks; only after exact downloadable=true permit latest/listed checks. Preserve raw metadata, public checksum, downloaded VSIX, SHA256 and canonical ZIP-content comparison with the original candidate. No credentials or upload command are needed. Keep all seven frozen-source preflight receipts and original publisher/host success evidence.
4. If later public bytes/listing match, report `PUBLIC_BYTES_VERIFIED_AFTER_POSTCHECK_FAILURE` (or equivalent explicit supplemental state), with the failed original run still visible. The current full IDE readback helper requires a successful complete VS workflow and must continue rejecting the original failed run; do not edit its original result or label it completed/success.
5. If a fully green Actions recovery gate is required, review and authorize a dedicated readback-only workflow/tool that pins checkout6a8 and the original run/artifact digest, performs no publishing, preserves the failed attempt, and issues a separate recovery receipt. It may execute from separately reviewed recovery-controller source, but must not claim that controller is the release commit or transfer unrelated old-SHA tests. This is a proposed next implementation, not an existing proved route or an action performed here.
6. If exact version stays unavailable beyond the retained window, seek registry-side submission/scan status using an authorized publisher view or support evidence. A content mismatch is a hard stop; do not relax the digest checks or reupload the same immutable version to hide it.

No recovery action is needed at the currently supplied01:48 snapshot. Parent's existing watch can continue. Formal36+9 remain NOT_RUN; an upload or subsequent registry verification is not a formal model-evaluation observation.
