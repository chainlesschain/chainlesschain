# Final s100 source/documentation review

No release-fact or formal-evaluation blocker found. Two small consistency corrections were reported to the parent for repair before deployment:

1. `docs-site/docs/chainlesschain/installation.md:858` still calls CLI0.166.86 the current public version. Update to0.166.100 or remove that obsolete version qualifier; the statement about no generic backup/restore command can remain if still applicable.
2. `docs-website-v2/src/pages/en/ide.astro:146` describes OpenVSX144 and public JB161 together with CLI_VERSION100. Chinese counterpart already says each IDE's recommended CLI. Match that wording in English so JB161's recommendation99 is not blurred.

## Verified scope

- Worktree HEAD is baseline283634169a683ba5dcd0da4e51a64b66002217c2, PR435 merge. Runtime source remains release6a8; selected stream-retry, worktree-isolator and IDE CLI-identity source files have no baseline/release differences. Git diff --check passes.
- All65 publication-manifest files rehash correctly. Combined documentation record references the real archived CLI/VS/JB receipts; CLI receipt hash matches, VS public package fields match, and JB remains pending/null public package.
- Website central data and sizes cache agree on CLI100, OpenVSX144, public JB161/recommendedCLI99, candidateJB162/recommendedCLI100 and independent product140. Product sizes payload is unchanged except fresh timestamp and CLI version identity. The independent audit did not repeat the parent's fresh network fetch.
- README Chinese/English latest sections distinguish source6a8 from reviewed main283634, public CLI/OpenVSX from uploaded pending JB, and product/child versions. Optional Microsoft Marketplace is not portrayed as published by OpenVSX.
- PR436 remains outside runtime release and NOT_PAID_READY; formal36+9 remain NOT_RUN, native NOT_ADMITTED and promotion HOLD. Historic records retain dated scopes rather than being silently promoted.
- New runtime claims agree with sampled code: retry budget2/cap15,60-second accepted-wait ceiling (longer Retry-After is rejected rather than shortened), visible-output/HTTP-terminal refusal, and exact missing-lock read retries capped at3 with no mutation retry.
- SourceUpdate Chinese/English cards use normal upgrade/task descriptions, preserve public-versus-pending split and do not claim full budget/acceptance completion.
- New document links resolve to real files or known design-sync sources. Build scripts for both VitePress sites invoke sync from actual `docs/design` before building; the new generated mirror pages were absent at review time, as expected before sync. Navigation points to ASCII source filename supported by both sync scripts. Never deploy an old dist without performing those normal builds.

This is a source/content/evidence review, not rendered-page, server deployment or public-site verification. The parent must complete normal builds and deployment/readback checks. No s100 files, Git state, network services or release state were mutated by this reviewer. Static hashes in reviewed-file-hashes.json describe the reviewed snapshot; repairs/build artifacts require their own final check.

## Final follow-up

Parent corrected both findings. Independent reread confirms installation CLI100, English per-IDE recommendations, and the design entry/source wording now says uploaded with public listing/download unverified without inferring approval stage. Git diff --check passes again. No remaining source/content blocking findings; safe to freeze the documentation candidate and proceed with normal three-site builds and deployment validation. See final-followup.json for revised source hashes. The earlier summary records initial findings and is retained as history.

