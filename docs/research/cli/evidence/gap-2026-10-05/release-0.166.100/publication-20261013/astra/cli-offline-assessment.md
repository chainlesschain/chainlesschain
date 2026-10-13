# CLI offline verification and archive review

CLI evidence binding independently passed offline:14 registry tarballs match recorded bytes/SHA256/SHA512, npm metadata names/versions/URLs and SRI;3 Actions ZIPs match GitHub artifact digests and12 contained files match extracted evidence. CLI public tarball exactly equals immutable candidate. Four workflow signature-audit receipts match preserved provenance files, package SHA512, exact-release or trusted-reuse commit/tree identities, and zero invalid/missing audit outcomes. Public-install lock entries for all14 packages match versions, public resolved URLs and integrity; invocation explicitly uses --ignore-scripts and public npm. Source6a8, tag v-npm-0-166-100 and successful run38322183193 agree.

This is offline evidence/hash consistency, not a new cryptographic signature verification or fresh network query. The original receipt correctly states signature verification was performed by the successful OIDC workflow.

## Archive script review

The initial script's text correctly distinguished pending from public completion and retained formal NOT_RUN/0/36/0/9/shared99 with Volcengine18+9 and OpenAI18. It did not execute samples or alter formal result records. Initial gaps were weak IDE receipt binding, accepting VS pending, copying a fixed filename instead of the supplied receipt, silently omitting required evidence, and validating the second document only after the first could be written.

Parent revised the script following review. Re-review confirms fixed expected IDE run IDs/tags/channels, recomputed workflow observation, candidate/Actions/public archive hashes, complete-workflow requirement for ready, pending only JetBrains with PENDING_NOT_PUBLIC/publicPackage=null, direct supplied-receipt copy, required source evidence/four provenance files, and prevalidation of both target documents. Syntax check passes. It is adequate for archiving the current trusted helper outputs without promoting pending or formal observations.

One small independent-verification improvement remains recommended: the VS ready branch verifies candidate and public hashes separately while relying on the helper's prior canonical-content comparison. Reuse the existing JetBrains ZIP entry-content comparison for both ready platforms so the archive script independently validates matching VSIX contents too. This is not evidence of a wrong VS artifact; the upstream helper already requires canonical equality.

The archive script writes only evidence and two research documents in isolated `.work/p100`; it is not a publication action. Preserve the readback roots and record their hashes. Large archives are intentionally retained in original roots rather than duplicated into documentation. Formal36+9 remain NOT_RUN regardless of either IDE release's eventual ready/pending state.
