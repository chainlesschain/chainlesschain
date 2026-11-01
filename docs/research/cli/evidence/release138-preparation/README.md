# CLI 0.166.138 and SDK 0.2.17 preparation

CLI .137 passed all 75 required CLI CI jobs and all 6 Strict Sandbox jobs, then stopped before CLI npm upload because Agent SDK 0.2.16 had a changed protocol-fixture test after its signed source anchor. Keep its release tag immutable. The SDK patch advances package identity to 0.2.17; runtime JS stays byte-identical and the existing protocol/build/vendor checks pass.

CLI .138 and the unchanged IDE versions .174 / .190 require a new complete exact-source CLI CI and Strict Sandbox matrix. The CLI CI final Linux, Windows and macOS matrices also build and test the SDK. The established OIDC workflow publishes and verifies SDK .17 before CLI .138; independent public CLI readback precedes IDE tags.

The user explicitly waived five-task success. The recorded .137 candidate cohort remains 0/5, historical 41/45 stays separate, and this metadata follow-up starts no new model calls. The deferred review-budget patch is not included. Production release protections are unchanged.
