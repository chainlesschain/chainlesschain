# Independent release100 audit

Source: `6a8db627c87f33ce4f8e5d3db704868957aa685e`, PR435. This audit performed reads and evidence writes only. No publish, merge, tag, cancellation, rerun, or product-source mutation.

## Decision

No new release blocker found. All 37 current exact-head-associated workflow runs are completed/success. The seven selected gate matrices independently match the parent's strict preflight: 114 materialized jobs, 113 success and the expected IDE conditional skip. The parent's strict verifier and thirteen-child public tarball/SRI verification are recorded separately in `parent-strict-preflight-summary.json`; this independent audit does not claim to repeat its 71 CLI job log verification or child byte comparison.

The remaining release sequence is operational: publish CLI using its established Actions OIDC tag workflow, require that release's complete checks and public package retrieval/provenance, then publish paired IDE versions. IDE publication is not eligible before the CLI is publicly available. Current evidence does not constitute publication or formal paid VERIFY01 readiness.

## Seven complete gates

| Gate | Run | Jobs |
|---|---:|---:|
| CLI CI | 38291133155 | 71 success |
| CLI Strict Sandbox | 38291132939 | 5 success |
| IDE Extensions | 38291132858 | 18 success, 1 conditional skip |
| IDE ARM64 Host Validation | 38291132843 | 10 success |
| Memory Query Index Measurement | 38292480529 | 3 success |
| Context Memory Kernel CI | 38291132784 | 3 success |
| CLI Background Interaction E2E | 38292488262 | 3 success |

All 37 full run/job responses are saved. Parent strict preflight additionally establishes expected configured matrix/step contracts; overall success alone is not treated as sufficient proof.

## Additional actual-checkout audit

Saved `gh run view --log --job` output and `git log -1 --format=%H` output-line references establish:

- Independent Full Test dispatch 38294563150: Ubuntu, Windows, health check all actual 6a8 and successful. Failure-issue job is expected skipped.
- Accessibility/performance, safety matrix, and loopback trajectory: 4 successful jobs each, all actual 6a8. Real-provider trajectory jobs are skipped and provide no paid-provider acceptance.
- CI Tests: 7 successful jobs actual 6a8; 6 successful jobs actual merge14039. PR Tests: both successful jobs actual merge14039. VERIFY01 Host Diagnostics: all 7 successful jobs actual merge14039.
- Session Host Consistency (3 checkout observations), Scheduler Kernel (4), Session Scale (4), Clipboard Image (3), Team Fairness (4), Background Keeper (3), App Server Overload (1), Agent Team (3), Reliability (15): all 40 observed checkout results actual 6a8. Jobs without checkout commands are not assigned an inferred checkout SHA.

Merge `14039a029ad9d634667ccdfbdf1f61736d4ad949` and source6a8 have identical tree `cdfb6120fb2621d0ffa738d6b0901294424be07e`; saved commit objects substantiate content equality only. These 15 merge-checkout jobs must not be labelled exact-head execution. Metadata, event context and dependency resolution may differ. No results from budget31ff or another source are transferred.

The original Full Test attempt1 Windows ETARGET failure remains preserved in the earlier independent failure/attempt audit directories. Current original run attempt2 success and separate exact dispatch success do not erase it.

## Public versions and tags

Fresh public HTTP responses: CLI0.166.100 npm404; VS0.37.144 Open VSX404; JetBrains plugin32208 three pages/246 entries contain no0.4.162. All exact Git tag refs404: `v-npm-0-166-100`, `ide-vscode-v0.37.144`, `ide-jetbrains-v0.4.162`.

Binding was read and copied. It supplies exact versions, not tag fields; tag strings were confirmed using frozen npm/IDE workflow naming rules. No public collision observed. Public queries do not rule out vendor-side hidden/pending submissions. Recheck tags immediately before creating them, since this is a point-in-time snapshot.

Direct job-log REST calls returned403 in this audit; those error payloads remain `job-*.log`. Successful alternate log retrieval is stored as `job-*-view.log`. `actual-checkouts.json` and `soak-actual-checkouts.json` give successful log evidence and line numbers. A403 error is never interpreted as a test pass.
