# Independent IDE publication review

No new publication blocker found. Continue after the parent's complete CLI0.166.100 public readback succeeds, preserving CLI then IDE order and the existing exact6a8 gate evidence. This review made no GitHub write or Actions query, did not inspect credentials, and did not publish. Formal36+9 remain NOT_RUN.

## Current slot observations

2026-10-13T01:17:06Z: OpenVSX exact0.37.144 endpoint returns404. JetBrains plugin32208 pages0–2 return246 records, none0.4.162. No public collision is observed. Public absence cannot prove no private submission exists or distinguish no upload from an unexposed pending upload; authenticated vendor-console state was not available/read. Treat the future authorized upload response as evidence, rather than claiming these empty public slots prove no pending submission.

## Frozen publication contract

Four inspected production source files match frozen6a8 bytes; hashes and frozen copies are saved. IDE workflow pins checkout to IDE_RELEASE_COMMIT (line130), verifies tag/version correspondence, and executes the published CLI prerequisite for VS Code (755–761) and JetBrains (1066–1070). The composite prerequisite installs exact paired CLI from public npm, probes version/capabilities and verifies integrity-bearing dependency installation before upload.

VS tag `ide-vscode-v0.37.144` publishes OpenVSX. Microsoft VS Code Marketplace is a separate explicit exact-tag workflow_dispatch/backfill, not an automatic tag-push result; do not report Microsoft publication based only on an OpenVSX release.

JetBrains `publishPlugin` success proves upload, not public approval. The post-publish job (1110 onward) uses `--allow-pending`, warns on pending and may complete successfully. Thus workflow green alone cannot establish public JetBrains completion.

## Pending versus public completion

Frozen marketplace verifier:

- JetBrains absent version produces pending with reason version-not-visible, not proven approval-pending. Nonboolean metadata/malformed response/hidden=true are fatal. approve/listed false produces pending. Only approve=true, listed=true, hidden=false classifies ready.
- `--allow-pending` is accepted only for JetBrains; HTTP/network failures do not become pending success.
- Base JetBrains verifier ready is metadata-only. The independent readback helper adds the essential actual ZIP download and exact entry-content comparison against the digest-bound Actions candidate.
- OpenVSX checks exact activation/downloadable before fetching latest listing, then requires latest/listed and validates downloaded archive SHA256 and canonical contents against the candidate when --artifact is supplied. The helper supplies --artifact and independently downloads the archive again.

Current `.work/readback-ide-release100-final.mjs` helperSHA256 `d76ba0adbf2d8a215612a709437ab1aa4ed850b05b4f225a7463cc5e548f6702`:

- Exact tag push run/source/workflow binding, expected jobs/steps, candidate artifact digest and embedded paired CLI pin are checked first.
- Only the separate JetBrains post-publish verification job may remain incomplete after every publisher/non-post prerequisite passes. Such an observation is explicitly `PENDING_NOT_PUBLIC`, publicPackage=null, downloadable=false, even if registry metadata currently appears ready (lines131–141).
- Completed workflow plus pending registry remains `PENDING_NOT_PUBLIC` (line178).
- Completed workflow plus ready JetBrains requires approved/listed/nonhidden metadata, downloadable public ZIP and every ZIP entry byte matching the exact Actions artifact (159–176).

The helper invokes the root marketplace verifier by relative path; its observed hash matches the frozen verifier, and root/r100 verify-vsix parsers also match. These are point-in-time source observations, not protection against future concurrent edits. The old preparation handoff carries preparationSHAff292; live invocation must continue to use frozen6a8, not copy the stale preparation command literally.

Validation: frozen marketplace verifier's offline self-test passed. No new tests/source edits were created. Uploaded/pending, workflow successful, and publicly downloadable/verified must remain distinct states in the release report. No real-provider formal acceptance is implied by IDE publication.
