# CLI 0.166.148 / IDE capability status projection

## Release boundary

The exact release source is `146b3fbd438eece981aa14327d9481156683acd4`.
CLI `0.166.148` passed CLI CI 76/76 and Strict Sandbox. Open VSX `0.37.187`
is public. JetBrains `0.4.202` passed build, host and upload gates; public
Marketplace listing remains pending manual review.

## Self-evolution status contract

CLI `evolution deployment status` is the source of truth for the CLI, VS Code
and JetBrains configuration surfaces. The projection separates source wiring
from runtime evidence:

```json
{
  "automaticPromotion": "hold",
  "productionAuthority": false,
  "runtimeEvidence": false
}
```

This release exposes wiring evidence only. It does not claim a production
producer/storage graph, A/B experiment acceptance, business-effect acceptance,
or automatic promotion authority. IDEs render the state and never receive
governance private keys, review authority, publication authority or runner
access.

## Verification limits

`NOT_PAID_READY / NOT_ADMITTED / HOLD` remain. Runtime evidence, protected
deployment approval and public Marketplace listing are separate follow-up
gates. The user-facing upgrade guide is
`docs-site/docs/chainlesschain/cli-ide-update-2026-11-13-148.md`.
