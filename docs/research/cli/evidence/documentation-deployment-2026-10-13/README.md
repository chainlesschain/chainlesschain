# Documentation and website deployment — 2026-10-13

The three sites were deployed successfully from source commit `d898d4e04d036bc51909d24f24e58842af568ce6`. Documentation PR [437](https://github.com/chainlesschain/chainlesschain/pull/437) was merged as `1ac3b80f231951ebd5533c0e82c1f89d340645c0`. This evidence-only archive does not change the deployed source.

- User documentation: https://docs.chainlesschain.com — 636 built HTML pages.
- Design documentation: https://design.chainlesschain.com — 279 built HTML pages.
- Official website: https://www.chainlesschain.com — 20 built HTML pages.
- Total: 935 built HTML pages. [Docs-Site Build Gate 38336873726](https://github.com/chainlesschain/chainlesschain/actions/runs/38336873726) passed with actual checkout matching d898; it builds docs. Design and website builds were local from the same commit.
- Public checks: 17 HTML pages, 35 static resources and 3 source manifests match local bytes. Existing website analytics proxy `/u/script.js` passed a separate availability check, for 56 observations total.
- Astra independently rehashed all 56 cached responses, three archives and deployment script and checked the actual CI checkout. This was an offline retained-evidence review.

## Evidence

[Summary](../documentation-deployment-2026-10-13.json), [raw public receipt](deployment/public-deployment.json), [remote receipt](deployment/remote-deployment.json), [Astra assessment](astra-review/assessment.md) and [raw-file manifest](manifest.json) preserve source attribution and digests. `build/`, `github/` and `public/` retain original build logs, Actions receipts/log and the three public source manifests. Original raw bytes are preserved with narrow Git attributes. The remote receipt's `PENDING` field predates the final verified public receipt and is intentionally unchanged.

Deployment archives and page/resource response bodies remain in the local retained directories recorded in the summary; they are not included in this Git archive. The first readback attempt remains preserved locally. Its analytics-proxy classification error was corrected in the later verifier, without replacing the earlier observations.

## Deployment and acceptance boundaries

All three archives were staged and verified before per-site directory replacement, with distinct backup directories retained. This was not a transaction across all sites. Only website `.well-known` operational content was carried forward from the server; `preservedFiles=[]` and logos were already in the build artifacts.

JetBrains 0.4.162 remains uploaded / PENDING_NOT_PUBLIC. Formal 36+9 remains NOT_RUN (0/36 and 0/9). Budget PR436 remains outside this runtime release. These HTTP byte checks do not establish browser interaction, accessibility or complete native acceptance.
