# Native price windows and expired-settlement recovery (2026-11-09)

Source commit: `44f56fe58aee36e6cc097755ce7c4ab3ec94b126`. Windows x64, Node 24.12.0, native SQLite, synthetic account contracts and CNY/FX fixtures. No real provider request or paid admission was performed.

The trusted-host authority now supports account-attested `host-dispatch` pricing windows while preserving worst-case reservations. Dispatch and the selected time/window witness commit atomically before physical fetch. Settlement retains that witness through time changes, process restart and contract/FX expiry. Unknown, missing, conflicting or malformed accounting evidence retains the full liability.

The expiry/reopen regression initially failed with `CC_BUDGET_EXPIRED`, proving that existing dispatched calls could not settle after restarting with expired contracts. The fix verifies the durable original activation time and identity on reopen, while every new reserve/dispatch still checks current expiry. Missing or duplicated activation evidence does not reopen.

Evidence:

- [authority-tests.xml](authority-tests.xml): **81/81**, including exact half-open boundaries, delayed credentials, real worker SIGKILL/restart after expiry, duplicate settlement, zero provider sends when witness persistence fails, and expired held-request refusal.
- [budget-tests.xml](budget-tests.xml): **234/234** across the listed formal-budget suites, including the 81 authority tests. These counts must not be added together. Host checkpoints, rollback detection, lineage binding, process races, cancelled and unknown liabilities remain covered.
- Additional egress inventory, diagnostic boundary and Memory budget-admission checks: **37/37** passed.
- Committed-source egress audit: 89 candidate files, zero unclassified files, zero parse errors, source review passed. Its 78 call-chain-unmapped candidates remain an explicit coverage boundary; static classification does not prove runtime containment.

The [receipt](receipt.json) records source/artifact hashes and the executed test-file set. JUnit paths and hostnames are normalized in this archive. The committed trusted-host source hashes were compared with the successfully tested candidate and matched.

The account verifier must attest the full schedule and its host-dispatch billing rule. This is not a claim that Volcengine's actual account bills on that clock. Real account contracts, FX ceilings including fees, invoice reconciliation, current-commit cross-platform CI and formal paid admission remain open. `paidReady:false`, `accountPriceVerified:false` and `invoiceReconciled:false` remain explicit.

Implementation/schema details: [progress record](../../../cli-ide/implementation/cli-ide-native-price-windows-progress-2026-11-09.md). PR: [#569](https://github.com/chainlesschain/chainlesschain/pull/569).
